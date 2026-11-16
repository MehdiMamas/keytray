#!/usr/bin/env python3
"""Smoke test: spawn keytray-agent.py with a fake extension on stdio, run the CLI against it.

Works on Unix (socket) and Windows (named pipe + key file). Exits non-zero on any failure.
"""
import json, os, queue, shutil, struct, subprocess, sys, tempfile, threading, time, uuid

here = os.path.dirname(os.path.abspath(__file__))
windows = os.name == "nt"
tmp = tempfile.mkdtemp()
env = dict(os.environ, KEYTRAY_NO_WSL_REEXEC="1")
cfgfile = os.path.join(tmp, "cfg", "config.json")
os.makedirs(os.path.dirname(cfgfile))
env["KEYTRAY_APPDIR"] = os.path.dirname(cfgfile)
if windows:
    appdir = os.path.join(tmp, "Keytray")
    pipe = r"\\.\pipe\keytray-test-" + uuid.uuid4().hex
    env.update(KEYTRAY_APPDIR=appdir, KEYTRAY_AGENT_PIPE=pipe)
    os.makedirs(appdir)
    cfgfile = os.path.join(appdir, "config.json")
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


config_replies = queue.Queue()


def ask_config():
    raw = json.dumps({"kind": "getConfig"}).encode()
    host.stdin.write(struct.pack("<I", len(raw)) + raw)
    host.stdin.flush()
    try:
        return config_replies.get(timeout=10)
    except queue.Empty:
        return "timeout"


def fake_extension():
    while True:
        h = host.stdout.read(4)
        if len(h) < 4:
            return
        msg = json.loads(host.stdout.read(struct.unpack("<I", h)[0]))
        if msg.get("kind") == "config":
            config_replies.put(msg)
            continue
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

    def cfg_case(content, want, what):
        if content is None:
            if os.path.exists(cfgfile):
                os.remove(cfgfile)
        else:
            with open(cfgfile, "wb") as f:
                f.write(content)
        got = ask_config()
        check(got == {"kind": "config", "config": want}, "getConfig %s: got %r" % (what, got))

    cfg_case(None, None, "no file")
    cfg_case(b'{"agentSignIn": true, "allowAll": true}', {"agentSignIn": True, "allowAll": True}, "valid")
    cfg_case(b'{"agentSignIn": true}', {"agentSignIn": True}, "one key")
    cfg_case(b'{"agentSignIn": true, "allowAll": false, "sites": ["a.com"], "x": 1}',
             {"agentSignIn": True, "allowAll": False}, "extra keys ignored")
    cfg_case(b'{"agentSignIn": "yes", "allowAll": 1}', {}, "non-boolean values")
    cfg_case(b'{not json', None, "unparsable")
    cfg_case(b'[true]', None, "not an object")
    cfg_case(b'{"agentSignIn": true, "pad": "' + b"x" * 5000 + b'"}', None, "too big")
    os.remove(cfgfile)
    os.mkdir(cfgfile)  # a directory at the path
    got = ask_config()
    check(got == {"kind": "config", "config": None}, "getConfig directory: got %r" % (got,))
    os.rmdir(cfgfile)
    check(run(["status"]).returncode == 0, "host stopped answering after config requests")

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
