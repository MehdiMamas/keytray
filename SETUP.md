# Setup

The extension id is fixed to the Chrome Web Store item, so every unpacked install uses the same Google sign-in redirect:

`https://kfkmcgkbicdmgdodjjindmnpofbcmoji.chromiumapp.org/`

You need a free Google Cloud project. No billing account. The OAuth app is published (In production) but not verified, so up to 100 people can connect and each sees an "unverified app" screen once and clicks Continue. Do not leave it in Testing: Google expires Testing-mode refresh tokens after 7 days, which forces a reconnect every week.

## 1. Google Cloud

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **Gmail API** (APIs & Services → Library → Gmail API → Enable).
3. APIs & Services → OAuth consent screen:
   - User type: **External**
   - App name: Keytray
   - Your email as support and developer contact
   - Scopes: add `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/userinfo.email`
   - Publishing status: **In production** (Audience → Publish app). Verification is not needed for up to 100 users.
4. APIs & Services → Credentials → Create credentials → **OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `https://kfkmcgkbicdmgdodjjindmnpofbcmoji.chromiumapp.org/`
5. Copy the client id (it ends in `.apps.googleusercontent.com`).
6. In the same client, **Add secret** and copy it right away. Google only shows it once. It ships inside the extension; that is expected, because the redirect URI above is the only place Google will send a sign-in.

## 2. Build

```bash
cp .env.example .env
```

Put the client id and secret in `.env`:

```
WXT_GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
WXT_GOOGLE_CLIENT_SECRET=GOCSPX-...
```

```bash
npm install
npm test
npm run build
```

Load `.output/chrome-mv3` unpacked. That folder includes the extension `key`, so the install id stays `kfkmcgkbicdmgdodjjindmnpofbcmoji`, the same id as the Chrome Web Store item.

To send that same unpacked build to friends:

```bash
npm run zip:sideload
```

The Chrome Web Store rejects a package that contains `key`. Use this zip for the store upload:

```bash
npm run zip
```

Zips are written under `.output`. The store package omits `key`; Chrome still assigns `kfkmcgkbicdmgdodjjindmnpofbcmoji` because that id belongs to this public key. The authorized redirect URI is `https://kfkmcgkbicdmgdodjjindmnpofbcmoji.chromiumapp.org/`.

## 3. Install (you and friends)

1. Unzip the build if you received a zip.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. **Load unpacked** and choose the folder that contains `manifest.json` (`.output/chrome-mv3` after a local build).
5. Open the extension's options (the Settings button in the popup, or "Extension options" on the extensions page).
6. **Add account**, pick the Gmail account, and on the unverified-app screen click **Continue**.
7. Repeat Add account for each mailbox.

Sign-in gives the extension a Google refresh token, so access renews in the background with no Google page, even after you sign out of Gmail or restart. **Reconnect** only shows if you revoke access at [Google Account permissions](https://myaccount.google.com/permissions) or change the account password. Accounts added before 0.5.0 have no refresh token; click Reconnect once on each.

## How it behaves

- The popup lists the last 5 codes for the account you pick, or for all accounts. Each row has a Copy button. **Sync** fetches immediately.
- Background checks run about every minute. While a code field is on screen, or while the popup is open, it checks about every 3 seconds for two minutes (popup: the whole time it stays open). Turn that off in Settings if you only want the Sync button and the one minute check.
- Per account, or as the default: **Auto-fill**, **Auto-copy**, or **Do nothing**.
- Auto-fill types into the code box on the active tab, including one-digit boxes. If it cannot find a field, it copies the code and notifies you.
- "Submit the form after auto-fill" is off. A wrong code submitted on its own can lock an account. Turn it on only if you want that.
- A **Fill** chip appears on the code field when a code from the last 10 minutes is stored. It works even when the account mode is Do nothing.

Email bodies are not stored. The extension keeps the code, sender, subject, and time (up to 50 codes).

## Tests

`npm test` covers code extraction and the page fixtures in `test-pages/`. Open `test-pages/index.html` in a browser with the extension loaded to try detection by hand.

## License

You may use, copy, modify, and share this project, including a personal build with the purchase code removed. You may not sell it, charge for a copy, or profit from it. That stays with the author. See `LICENSE`.
