#!/usr/bin/env python3
"""Smoke test: spawn keytray-agent.py with a fake extension on stdio, run the CLI against it."""
import json, os, struct, subprocess, sys, tempfile, threading, time

here = os.path.dirname(os.path.abspath(__file__))
sock = os.path.join(tempfile.mkdtemp(), "k", "agent.sock")
env = dict(os.environ, KEYTRAY_AGENT_SOCK=sock)
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

threading.Thread(target=fake_extension, daemon=True).start()
for _ in range(50):
    if os.path.exists(sock):
        break
    time.sleep(0.1)

mode = oct(os.stat(sock).st_mode & 0o777)
assert mode == "0o600", mode
cli = os.path.join(here, "keytray-agent-cli.py")
failed = False
for argv in (["status"], ["pending", "7"], ["fill_code", "7", "--wait", "30"], ["open_link", "7"]):
    p = subprocess.run([sys.executable, cli] + argv, env=env, capture_output=True, text=True)
    print(argv, p.returncode, p.stdout.strip())
    out = json.loads(p.stdout)
    if p.returncode != 0 or out["echo"] != argv[0]:
        failed = True
bad = subprocess.run([sys.executable, cli, "fill_code", "x"], env=env, capture_output=True, text=True)
print("bad args", bad.returncode, bad.stdout.strip())
failed |= bad.returncode == 0
host.stdin.close()
host.wait(timeout=5)
print("socket removed on exit:", not os.path.exists(sock))
print("sock mode", mode)
sys.exit(1 if failed else 0)
