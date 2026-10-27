# Agent sign-in: client protocol

How a local program talks to Keytray's agent bridge (`native/keytray-agent.py`). `native/keytray-agent-cli.py` is the reference client.

## Socket

- macOS: `~/Library/Application Support/Keytray/agent.sock`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/Keytray/agent.sock`
- Override: `KEYTRAY_AGENT_SOCK` (read by both the host and the CLI).
- Unix stream socket, mode 0600, directory 0700. The host is started by the extension (`connectNative`) only while Agent sign-in is on in Options and the `nativeMessaging` permission is granted. The host removes the socket when it exits. So "off" usually shows up as a missing socket, not as a reply.

## Framing

One request per connection. The client sends one line of UTF-8 JSON ending in `\n` (65,536 bytes max; the host stops reading after 10 s). The host writes one line of JSON ending in `\n` and closes the connection. The host waits up to 130 s for the extension's reply, so clients should time out after at least 140 s (the CLI uses 140 s).

## Requests

```json
{"command": "status"}
{"command": "pending",   "args": [TAB_ID]}
{"command": "fill_code", "args": [TAB_ID]}
{"command": "fill_code", "args": [TAB_ID, WAIT_SECONDS]}
{"command": "open_link", "args": [TAB_ID]}
```

`args` is positional. `TAB_ID` is the Chrome tab id, a non-negative integer, the same id Claude in Chrome uses. `WAIT_SECONDS` applies only to `fill_code`: 0 or missing means don't wait. It is capped at 120. While waiting, Keytray polls Gmail about every 5 s.

## Replies

Every reply has `ok` (boolean). When `ok` is false, `error` holds one of the strings below. Replies never contain a code, link or URL: the extension drops any key named code, otp, link, url, token, secret or password before replying.

| Command | Fields when `ok: true` |
|---|---|
| `status` | `enabled` (bool), `allowlist` (string[] of hosts), `rateLeft` (requests left in the current 10 min) |
| `pending` | `hasField` (bool: the tab has a code field), `codeAvailable`, `linkAvailable`: each `null` or `{sender, ageSeconds}` |
| `fill_code` | `filled: true`, `sender`, `ageSeconds` |
| `open_link` | `opened: true`, `sender`, `ageSeconds` |

`sender` is the display name from the mail's From header. `ageSeconds` is how old the mail is. A code or link counts as fresh for 10 minutes and is used once: after an agent fill or open it is not offered again. `fill_code` fills only. It never submits, so the agent clicks the submit button itself.

## Errors

From the extension:

| `error` | Meaning |
|---|---|
| `agent sign-in is off` | Turned off in Options (only seen in the moment before the host shuts down) |
| `unknown command` | `command` is not one of the four |
| `tab id required` | `args[0]` is missing or not a non-negative integer |
| `rate limit reached` | More than 10 requests in a rolling 10 min (`status` is not counted) |
| `tab not found` | No tab with that id |
| `site is not allowlisted` | The tab's host is not in the allowlist (exact host or subdomain, https only) |
| `no fresh code` | `fill_code` without wait: no unused code from the last 10 min |
| `timed out waiting for a code` | `fill_code` with wait: none arrived in time |
| `no code field filled on this tab` | A code exists but no allowlisted frame had a field that took it |
| `no fresh sign-in link` | `open_link`: no unused link from the last 10 min |
| `link site is not allowlisted` | The link's own host is not in the allowlist |
| any other text | An exception inside the extension (its message) |

From the host:

| `error` | Meaning |
|---|---|
| `bad request: <detail>` | The line was not a JSON object |
| `no reply from the extension` | No answer within 130 s (extension reloaded, service worker gone) |

From the client side (no reply at all):

| Situation | Meaning |
|---|---|
| Socket file missing (ENOENT) | Host not running: Agent sign-in is off, the permission is not granted, `native/install.sh` was not run, or the browser is closed |
| Connection refused (ECONNREFUSED) | Stale socket from a host that crashed; the browser will start a new host when it reconnects |
| Empty reply / closed early | Host exited mid-request |
