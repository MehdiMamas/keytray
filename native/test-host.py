#!/usr/bin/env python3
"""Smoke test: spawn keytray-agent.py with a fake extension on stdio, run the CLI against it.

Works on Unix (socket) and Windows (named pipe + key file). Exits non-zero on any failure.
"""
import json, os, shutil, struct, subprocess, sys, tempfile, threading, time, uuid

here = os.path.dirname(os.path.abspath(__file__))
windows = os.name == "nt"
tmp = tempfile.mkdtemp()
env = dict(os.environ, KEYTRAY_NO_WSL_REEXEC="1")
if windows:
    appdir = os.path.join(tmp, "Keytray")
    pipe = r"\\.\pipe\keytray-test-" + uuid.uuid4().hex
    env.update(KEYTRAY_APPDIR=appdir, KEYTRAY_AGENT_PIPE=pipe)
    os.makedirs(appdir)
    keyfile = os.path.join(appdir, "agent.key")
    with open(keyfile, "wb") as f:
        f.write(b"short")  # a wrong-sized key must be replaced
else:
    sock = os.path.join(tmp, "k", "agent.sock")
    env["KEYTRAY_AGENT_SOCK"] = sock

cli = os.path.join(here, "keytray-agent-cli.py")
failures = []


def check(ok, what):
    if not ok:
        failures.append(what)
        print("FAIL:", what)


host = subprocess.Popen([sys.executable, os.path.join(here, "keytray-agent.py")],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)


def fake_extension():
    while True:
        h = host.stdout.read(4)
        if len(h) < 4:
            return
        msg = json.loads(host.stdout.read(struct.unpack("<I", h)[0]))
        reply = {"id": msg["id"], "ok": True, "echo": msg["command"], "args": msg["args"]}
        raw = json.dumps(reply).encode()
        host.stdin.write(struct.pack("<I", len(raw)) + raw)
        host.stdin.flush()


def run(argv):
    return subprocess.run([sys.executable, cli] + argv, env=env, capture_output=True, text=True)


try:
    threading.Thread(target=fake_extension, daemon=True).start()
    if windows:
        deadline = time.time() + 10
        while time.time() < deadline:
            p = run(["status"])
            if p.returncode == 0:
                break
            time.sleep(0.2)
        check(p.returncode == 0, "host did not answer status within 10 s: " + p.stdout.strip())
    else:
        for _ in range(50):
            if os.path.exists(sock):
                break
            time.sleep(0.1)
        mode = oct(os.stat(sock).st_mode & 0o777)
        check(mode == "0o600", "socket mode " + mode)

    for argv in (["status"], ["pending", "7"], ["fill_code", "7", "--wait", "30"], ["open_link", "7"]):
        p = run(argv)
        print(argv, p.returncode, p.stdout.strip())
        try:
            out = json.loads(p.stdout)
            check(p.returncode == 0 and out["echo"] == argv[0], "bad reply for %s" % argv)
        except (ValueError, KeyError):
            check(False, "unparsable reply for %s: %r" % (argv, p.stdout))
    bad = run(["fill_code", "x"])
    print("bad args", bad.returncode, bad.stdout.strip())
    check(bad.returncode != 0, "bad args accepted")

    if windows:
        from multiprocessing import AuthenticationError
        from multiprocessing.connection import Client

        with open(keyfile, "rb") as f:
            check(len(f.read()) == 32, "short agent.key was not replaced by a 32-byte key")
        try:
            c = Client(pipe, family="AF_PIPE", authkey=b"x" * 32)
            c.send_bytes(b'{"command": "status", "args": []}')
            c.recv_bytes()
            check(False, "client with a wrong key got an answer")
        except (AuthenticationError, EOFError, OSError):
            pass
        p = run(["status"])
        check(p.returncode == 0, "host stopped answering after a wrong-key client: " + p.stdout.strip())
finally:
    host.stdin.close()
    try:
        host.wait(timeout=5)
    except subprocess.TimeoutExpired:
        host.kill()
    if not windows:
        check(not os.path.exists(sock), "socket not removed on exit")
    shutil.rmtree(tmp, ignore_errors=True)

if failures:
    sys.exit(1)
print("test-host: pass (%s)" % ("windows pipe" if windows else "unix socket"))
