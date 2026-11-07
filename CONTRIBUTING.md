# Contributing

Thanks for helping with Keytray. Bug reports, fixes and small improvements are welcome.

## License terms

Keytray uses a custom license (see [LICENSE](LICENSE)). You may use, modify and share it for your own use, and you may remove the purchase code for a copy you run yourself. You may not sell it, charge for a copy or profit from it; that right stays with the author. By sending a change you agree it can be distributed under the same terms. If that does not suit you, please do not send code.

## Setup

You need Node.js and [pnpm](https://pnpm.io) (the version is pinned in `package.json`).

```bash
pnpm install
pnpm exec wxt prepare
cp .env.example .env   # add your own Google OAuth client id and secret, see SETUP.md
```

## Before you open a pull request

```bash
pnpm compile   # type check
pnpm test      # vitest
pnpm build     # production build into .output/chrome-mv3
```

CI runs the same three commands. To try the extension, load `.output/chrome-mv3` unpacked from `chrome://extensions`. `test-pages/index.html` has pages for checking code detection by hand.

## Guidelines

- Keep a change small and focused; one fix or feature per pull request.
- Add or update a test in `tests/` when you change code extraction or detection.
- Describe what changed and how you checked it in the pull request.
- Do not commit `.env`, tokens or real email content. Test fixtures use made-up addresses and codes.
- Security problems: please do not open a public issue; use GitHub's private vulnerability reporting on this repository.

Questions and ideas are welcome in Discussions.
