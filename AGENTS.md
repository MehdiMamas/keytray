# AGENTS.md

## What it is
Keytray: a Chrome, Edge and Brave extension (WXT, React, TypeScript) that reads verification codes and sign-in links from Gmail (readonly scope) and can auto-fill, copy or show them. One account is free; extra accounts are a one-time purchase through ExtensionPay. An optional native helper lets a local program ask it to fill a code (`docs/agent-protocol.md`). See `README.md` and `SETUP.md`.

## Setup
- Needs pnpm (version pinned in `package.json`). `pnpm install --frozen-lockfile`, then `pnpm exec wxt prepare`.
- Copy `.env.example` to `.env` and set `WXT_GOOGLE_CLIENT_ID` and `WXT_GOOGLE_CLIENT_SECRET` (Google Cloud OAuth client; steps in `SETUP.md`). Never commit `.env`.
- Native helper (agent sign-in): `native/install.sh` (needs Python 3).

## Commands
- `pnpm dev` (WXT dev), `pnpm build`, `pnpm zip` (store build), `pnpm zip:sideload`.
- `pnpm compile` (typecheck), `pnpm test` (vitest).
- Release: `scripts/release.sh <x.y.z>` bumps `package.json` commits and tags, never pushes.

## Where things live
- `entrypoints/`: background, content scripts, popup, options, offscreen. `lib/`: Gmail access, code and link extraction, OTP detection and autofill, billing, agent bridge, storage.
- `tests/`: vitest tests and fixtures. `native/`: Python helper and CLI. `public/`, `keytray_store_assets/`, `video-kit/`: assets.
- `docs/`: agent protocol plus copies of the site pages. `.github/workflows`: `ci.yml` (compile, test, build), `release.yml`.

## Gotchas
- The extension id is fixed to the Chrome Web Store item, so unpacked installs use the same Google redirect URI (`SETUP.md`).
- A Google client saved in Settings → Advanced (storage key `customOAuth`, never part of `PersistedState`) overrides the build-time `WXT_GOOGLE_CLIENT_ID`/`SECRET`; `resolveClient()` in `lib/auth.ts` picks the pair.
- The live home, privacy and terms pages are on the author's personal site, not the `docs/*.html` files here; editing those does not change the site (see `.cursor/rules/public-pages.mdc`). The privacy page is `public/keytray/privacy.html` in the mehdimamas.dev repo, not `docs/`.
- The Web Store upload in `release.yml` uses Workload Identity Federation (repository variables `GCP_WIF_PROVIDER`, `CWS_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID`), so there is no stored token to expire. Setup is in `SETUP.md`.
