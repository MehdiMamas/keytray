#!/usr/bin/env python3
"""Ask Keytray to act on a browser tab. Prints the JSON reply; exits non-zero on error.

  keytray-agent-cli.py status
  keytray-agent-cli.py pending <tabId>
  keytray-agent-cli.py fill_code <tabId> [--wait SECONDS]
  keytray-agent-cli.py open_link <tabId>
"""
import json
import os
import socket
import sys

TIMEOUT = 140


def socket_path():
    override = os.environ.get("KEYTRAY_AGENT_SOCK")
    if override:
        return override
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/Keytray")
    else:
        base = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "Keytray")
    return os.path.join(base, "agent.sock")


def fail(message, code=2):
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(code)


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


def main():
    command, args = parse(sys.argv[1:])
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(TIMEOUT)
    try:
        sock.connect(socket_path())
        sock.sendall((json.dumps({"command": command, "args": args}) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
    except FileNotFoundError:
        fail("Keytray host is not running. Install it with native/install.sh and enable Agent sign-in in Options.")
    except (OSError, socket.timeout) as error:
        fail("could not reach Keytray: %s" % error)
    line = buf.split(b"\n", 1)[0].decode("utf-8")
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
