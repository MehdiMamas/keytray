#!/usr/bin/env python3
"""Ask Keytray to act on a browser tab. Prints the JSON reply; exits non-zero on error.

  keytray-agent-cli.py status
  keytray-agent-cli.py pending <tabId>
  keytray-agent-cli.py fill_code <tabId> [--wait SECONDS]
  keytray-agent-cli.py open_link <tabId>

On Windows it talks to the helper over a named pipe; from WSL it re-runs itself
through the Windows install (%LOCALAPPDATA%\\Keytray\\keytray.cmd).
"""
import getpass
import json
import os
import socket
import subprocess
import sys

TIMEOUT = 140
WINDOWS = os.name == "nt"
NOT_RUNNING = "Keytray host is not running. Install it with native/install.sh (Windows: native\\windows\\install.ps1) and enable Agent sign-in in Options."


def socket_path():
    override = os.environ.get("KEYTRAY_AGENT_SOCK")
    if override:
        return override
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/Keytray")
    else:
        base = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "Keytray")
    return os.path.join(base, "agent.sock")


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


def fail(message, code=2):
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(code)


def under_wsl():
    # the pipe and agent.key exist only on the Windows side, so a WSL shell hands the call to Windows.
    # KEYTRAY_NO_WSL_REEXEC=1 turns it off
    if os.environ.get("KEYTRAY_NO_WSL_REEXEC"):
        return False
    try:
        with open("/proc/sys/kernel/osrelease") as f:
            return "microsoft" in f.read().lower()
    except OSError:
        return False


def wsl_reexec(argv):
    missing = "Keytray helper is not installed on Windows: run native\\windows\\install.ps1"
    try:
        local = subprocess.run(["cmd.exe", "/c", "echo %LOCALAPPDATA%"], capture_output=True, text=True,
                               cwd="/mnt/c", check=True).stdout.strip().replace("\r", "")
        if not local or "%" in local:
            fail(missing)
        target = local + "\\Keytray\\keytray.cmd"
        unix = subprocess.run(["wslpath", "-u", target], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        fail(missing)
    if not os.path.exists(unix):
        fail(missing)
    sys.exit(subprocess.call(["cmd.exe", "/c", target] + argv, cwd="/mnt/c"))


def parse(argv):
    if not argv:
        fail("usage: status | pending <tabId> | fill_code <tabId> [--wait N] | open_link <tabId>")
    command, rest = argv[0], argv[1:]
    if command == "status":
        return command, []
    if command not in ("pending", "fill_code", "open_link"):
        fail("unknown command: %s" % command)
    wait = None
    if "--wait" in rest:
        if command != "fill_code":
            fail("--wait only works with fill_code")
        i = rest.index("--wait")
        try:
            wait = int(rest[i + 1])
        except (IndexError, ValueError):
            fail("--wait needs a number of seconds")
        rest = rest[:i] + rest[i + 2:]
    if len(rest) != 1 or not rest[0].isdigit():
        fail("%s needs one numeric tab id" % command)
    args = [int(rest[0])]
    if wait is not None:
        args.append(wait)
    return command, args


def ask_unix(request):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(TIMEOUT)
    try:
        sock.connect(socket_path())
        sock.sendall((json.dumps(request) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
    except FileNotFoundError:
        fail(NOT_RUNNING)
    except (OSError, socket.timeout) as error:
        fail("could not reach Keytray: %s" % error)
    return buf.split(b"\n", 1)[0]


def ask_pipe(request):
    # send_bytes/recv_bytes only, never send()/recv() (pickle)
    from multiprocessing import AuthenticationError
    from multiprocessing.connection import Client

    try:
        with open(os.path.join(appdir(), "agent.key"), "rb") as f:
            key = f.read()
    except OSError:
        fail(NOT_RUNNING)
    if len(key) != 32:
        fail(NOT_RUNNING)
    try:
        conn = Client(pipe_name(), family="AF_PIPE", authkey=key)
    except AuthenticationError:
        fail("could not reach Keytray: key mismatch, rerun install.ps1")
    except (FileNotFoundError, OSError):
        fail(NOT_RUNNING)
    with conn:
        try:
            conn.send_bytes(json.dumps(request).encode())
            if not conn.poll(TIMEOUT):
                fail("could not reach Keytray: timed out")
            return conn.recv_bytes()
        except (EOFError, OSError):
            return b""


def main():
    argv = sys.argv[1:]
    if not WINDOWS and under_wsl():
        wsl_reexec(argv)
    command, args = parse(argv)
    request = {"command": command, "args": args}
    raw = ask_pipe(request) if WINDOWS else ask_unix(request)
    line = raw.decode("utf-8").strip()
    if not line:
        fail("empty reply from Keytray")
    try:
        reply = json.loads(line)
    except ValueError:
        fail("bad reply from Keytray")
    print(json.dumps(reply))
    sys.exit(0 if reply.get("ok") else 1)


if __name__ == "__main__":
    main()
