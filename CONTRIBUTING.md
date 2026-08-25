# Contributing to SendAPigeon

Thanks for helping make SendAPigeon better. Bug reports, documentation fixes,
tests and focused pull requests are welcome.

## Before you start

- Search existing issues before opening a new one.
- Open an issue before a large feature or data-format change so the approach
  can be discussed before substantial work begins.
- Never commit a real CRM vault, customer data, credentials, access tokens or
  private contact details. Use invented fixture data in tests and screenshots.

## Development

SendAPigeon requires Node.js 20 or newer.

```bash
npm ci
npm run build
npm test
npm run typecheck
```

Keep the core model independent from its adapters: `src/core` owns the data
model, while `src/cli`, `src/server`, `src/mcp` and `web` consume it. Include a
regression test for bug fixes and tests for new behavior. Do not commit build
output from `dist/` or `web/dist/`.

## Pull requests

- Keep each pull request focused on one problem.
- Explain the user-facing behavior and any data-format implications.
- Note how the change was tested.
- Update the README or other documentation when behavior changes.

By submitting a contribution, you agree that it may be distributed under the
project's [MIT License](LICENSE).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.
