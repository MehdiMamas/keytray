# Keytray

Chrome, Edge, and Brave extension that reads verification codes and sign-in links from Gmail accounts. One account is free. A one-time purchase unlocks more. For each new code it can auto-fill the page, copy the code, or only keep it in the popup. A verification link can be opened from the popup. Mail is read in the browser with the Gmail readonly scope. Checkout for extra accounts is ExtensionPay and Stripe.

[Chrome Web Store](https://chromewebstore.google.com/detail/keytray/kfkmcgkbicdmgdodjjindmnpofbcmoji)

See [SETUP.md](SETUP.md) for the Google Cloud project, test users, and how to install it unpacked.

You can remove the purchase code and build a copy for yourself. Selling it, charging for a copy, or profiting from it is reserved to the author. See [LICENSE](LICENSE).

- [Home](https://mehdimamas.dev/keytray/)
- [Privacy policy](https://mehdimamas.dev/keytray/privacy/)
- [Terms of service](https://mehdimamas.dev/keytray/terms/)

## Agent sign-in

A program on your computer (for example an AI agent driving Chrome) can ask Keytray to fill the newest verification code into a tab, or open the newest sign-in link in it. The program never sees the code or the link. It is off by default.

Set up:

1. Run `native/install.sh`. It registers a small helper (`com.keytray.agent`) with Chrome, Edge and Brave. Python 3 is required.
2. Open Keytray Options, go to "Agent sign-in" and turn it on. Chrome asks for the native messaging permission.
3. Use the CLI:

```
native/keytray-agent-cli.py status
native/keytray-agent-cli.py pending <tabId>
native/keytray-agent-cli.py fill_code <tabId> [--wait 60]
native/keytray-agent-cli.py open_link <tabId>
```

`pending` says whether the tab has a code field and whether a fresh code or link is waiting (sender and age only). `fill_code` fills the newest unused code that is at most 10 minutes old. With `--wait N` (up to 120 seconds) it checks Gmail every 5 seconds until one arrives. `open_link` navigates the tab to the newest sign-in link.

Safety rules:

- Only sites on the allowlist work (default github.com, google.com, vercel.com, apple.com; exact host or subdomain). Edit it in Options. Every frame that receives a code must match too, and a link is only opened if its own host is allowed.
- Fill never submits the form. The agent clicks the button itself.
- A code is filled once, then marked used.
- At most 10 requests per 10 minutes. The last 200 requests are listed in Options with time, command, site and result. They never contain codes or links.
- Replies strip any field named code, otp, link, url, token, secret or password.
- The helper listens on `~/Library/Application Support/Keytray/agent.sock` (Linux: `~/.local/share/Keytray/agent.sock`), readable only by your user. Anything running as you can reach it, which is why the allowlist and the off switch exist.
