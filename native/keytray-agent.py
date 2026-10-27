#!/usr/bin/env python3
"""Keytray native messaging host (com.keytray.agent).

Chrome starts this process and talks to it over stdio with 4-byte length-prefixed
JSON. Local programs talk to it over a unix socket (mode 0600): they send one
JSON line and get one JSON line back. Python 3 standard library only.
"""
import json
import os
import socket
import struct
import sys
import threading
import uuid

REPLY_TIMEOUT = 130


def socket_path():
    override = os.environ.get("KEYTRAY_AGENT_SOCK")
    if override:
        return override
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/Keytray")
    else:
        base = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "Keytray")
    return os.path.join(base, "agent.sock")


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
        try:
            request = json.loads(line.decode("utf-8"))
            if not isinstance(request, dict):
                raise ValueError("request must be an object")
        except ValueError as error:
            conn.sendall((json.dumps({"ok": False, "error": "bad request: %s" % error}) + "\n").encode())
            return
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
        conn.sendall((json.dumps(reply) + "\n").encode())
    except OSError:
        pass
    finally:
        conn.close()


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
    path = socket_path()
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
            with pending_lock:
                slot = pending.get(message.get("id")) if isinstance(message, dict) else None
            if slot:
                slot["reply"] = message
                slot["event"].set()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
