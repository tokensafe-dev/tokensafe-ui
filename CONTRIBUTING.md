# Contributing to tokensafe-ui

## Sign-off (DCO)

This project uses the **Developer Certificate of Origin 1.1** ([DCO](DCO)). Sign every
commit:

```bash
git commit -s -m "feat(react): ..."
```

There is no separate CLA.

## Licence of contributions

**Apache-2.0** (`packages/create-tokensafe-ui` remains MIT). By contributing you agree your
contribution is licensed under the same terms.

## Before opening a PR

```bash
pnpm install && pnpm build && pnpm test
```

- Adapter changes re-run certification and commit the reports:
  `node packages/vite/scripts/certify-react-browser.mjs --root certification/app --certify
  ../agent-oumv/packages/conformance/dist/cli/certify.js --report certification/react-vite-browser.json`,
  plus the offline stdio report (`certification/react-vite.json`).
- There are no native runtimes: a framework is supported through an adapter with the
  canonical envelope, not a bespoke JSX transform. Vue/Solid remain adapter work.
- The Vite bridge must keep zero `tokensafe-ui` imports in the client bundle; the
  `no-solid-in-react` test guards the React path.
