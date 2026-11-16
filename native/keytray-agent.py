#!/usr/bin/env python3
"""Keytray native messaging host (com.keytray.agent).

Chrome starts this process and talks to it over stdio with 4-byte length-prefixed
JSON. Local programs talk to it over a unix socket (mode 0600): they send one
JSON line and get one JSON line back. On Windows they use a named pipe instead,
authenticated with the key in agent.key. Python 3 standard library only.
"""
import getpass
import json
import os
import socket
import struct
import sys
import threading
import time
import uuid

REPLY_TIMEOUT = 130
WINDOWS = os.name == "nt"


def appdir():
    override = os.environ.get("KEYTRAY_APPDIR")
    if override:
        return override
    return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Keytray")


def pipe_name():
    override = os.environ.get("KEYTRAY_AGENT_PIPE")
    if override:
        return override
    return "\\\\.\\pipe\\keytray-agent-" + getpass.getuser()


def load_key():
    # 32 random bytes made on first start; a missing or wrong-sized file counts as missing.
    # Written to a temp file and moved into place so two racing starts end up with one key.
    directory = appdir()
    keyfile = os.path.join(directory, "agent.key")
    os.makedirs(directory, exist_ok=True)

    def read():
        try:
            with open(keyfile, "rb") as f:
                data = f.read()
        except OSError:
            return None
        return data if len(data) == 32 else None

    key = read()
    if key:
        return key
    tmp = os.path.join(directory, "agent.key.%s.tmp" % uuid.uuid4().hex)
    with open(tmp, "wb") as f:
        f.write(os.urandom(32))
    os.replace(tmp, keyfile)
    return read() or load_key()


def socket_path():
    override = os.environ.get("KEYTRAY_AGENT_SOCK")
    if override:
        return override
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/Keytray")
    else:
        base = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "Keytray")
    return os.path.join(base, "agent.sock")


def config_dir():
    override = os.environ.get("KEYTRAY_APPDIR")
    if override:
        return override
    if WINDOWS:
        return appdir()
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/Keytray")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "Keytray")


CONFIG_MAX = 4096


def read_config():
    """The per-machine config.json: only the booleans agentSignIn and allowAll count.

    Returns None when the file is missing, too big, unparsable or not an object. Never raises.
    """
    try:
        path = os.path.join(config_dir(), "config.json")
        if os.path.islink(path) or not os.path.isfile(path):
            return None
        with open(path, "rb") as f:
            data = f.read(CONFIG_MAX + 1)
        if len(data) > CONFIG_MAX:
            return None
        parsed = json.loads(data.decode("utf-8-sig"))
        if not isinstance(parsed, dict):
            return None
        return {k: parsed[k] for k in ("agentSignIn", "allowAll") if isinstance(parsed.get(k), bool)}
    except Exception:
        return None


out_lock = threading.Lock()
pending = {}  # id -> {"event": Event, "reply": dict | None}
pending_lock = threading.Lock()


def read_exact(stream, n):
    data = b""
    while len(data) < n:
        chunk = stream.read(n - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def send_to_extension(message):
    raw = json.dumps(message).encode("utf-8")
    with out_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(raw)))
        sys.stdout.buffer.write(raw)
        sys.stdout.buffer.flush()


def relay(raw):
    try:
        request = json.loads(raw.decode("utf-8"))
        if not isinstance(request, dict):
            raise ValueError("request must be an object")
    except ValueError as error:
        return {"ok": False, "error": "bad request: %s" % error}
    req_id = uuid.uuid4().hex
    slot = {"event": threading.Event(), "reply": None}
    with pending_lock:
        pending[req_id] = slot
    try:
        send_to_extension({"id": req_id, "command": request.get("command"), "args": request.get("args", [])})
        if slot["event"].wait(REPLY_TIMEOUT):
            reply = slot["reply"]
        else:
            reply = {"ok": False, "error": "no reply from the extension"}
    finally:
        with pending_lock:
            pending.pop(req_id, None)
    reply = dict(reply)
    reply.pop("id", None)
    return reply


def handle_client(conn):
    try:
        conn.settimeout(10)
        buf = b""
        while b"\n" not in buf and len(buf) < 65536:
            chunk = conn.recv(4096)
            if not chunk:
                break
            buf += chunk
        line = buf.split(b"\n", 1)[0]
        conn.sendall((json.dumps(relay(line)) + "\n").encode())
    except OSError:
        pass
    finally:
        conn.close()


def handle_pipe_client(conn):
    try:
        if not conn.poll(10):
            return
        try:
            raw = conn.recv_bytes(65536)
        except (OSError, EOFError):
            return
        conn.send_bytes(json.dumps(relay(raw)).encode())
    except (OSError, EOFError):
        pass
    finally:
        try:
            conn.close()
        except Exception:
            pass


def serve_pipe():
    from multiprocessing.connection import Listener

    while True:
        try:
            listener = Listener(address=pipe_name(), family="AF_PIPE", authkey=load_key())
        except Exception:
            time.sleep(5)  # an old helper may still hold the pipe
            continue
        while True:
            try:
                conn = listener.accept()
            except Exception:
                time.sleep(0.05)  # failed key handshake: drop it, keep listening, never spin
                continue
            threading.Thread(target=handle_pipe_client, args=(conn,), daemon=True).start()


def serve(path):
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old_umask = os.umask(0o177)
    try:
        server.bind(path)
    finally:
        os.umask(old_umask)
    os.chmod(path, 0o600)
    server.listen(8)
    while True:
        conn, _ = server.accept()
        threading.Thread(target=handle_client, args=(conn,), daemon=True).start()


def main():
    path = None if WINDOWS else socket_path()
    if WINDOWS:
        threading.Thread(target=serve_pipe, daemon=True).start()
    else:
        threading.Thread(target=serve, args=(path,), daemon=True).start()
    stdin = sys.stdin.buffer
    try:
        while True:
            header = read_exact(stdin, 4)
            if header is None:
                break
            (length,) = struct.unpack("<I", header)
            body = read_exact(stdin, length)
            if body is None:
                break
            try:
                message = json.loads(body.decode("utf-8"))
            except ValueError:
                continue
            if isinstance(message, dict) and message.get("kind") == "getConfig":
                send_to_extension({"kind": "config", "config": read_config()})
                continue
            with pending_lock:
                slot = pending.get(message.get("id")) if isinstance(message, dict) else None
            if slot:
                slot["reply"] = message
                slot["event"].set()
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


if __name__ == "__main__":
    main()
