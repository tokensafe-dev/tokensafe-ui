# React certification app

The smallest app that can be certified end to end: React 18, a probe store the
bridge can dispatch (`certificationProbe` + `conformance-probe`), and one `fetch`
on load so `observe` L4 has a real trace.

```bash
cd certification/app && npm install
cd ../.. && node packages/vite/scripts/certify-react-browser.mjs \
  --root certification/app \
  --certify ../agent-oumv/packages/conformance/dist/cli/certify.js \
  --report certification/react-vite-browser.json
```

The harness starts this app's Vite dev server, opens it in headless Chrome via
`playwright-core` (system Chrome, no browser download), waits for the bridge, then
runs `oumv-certify --url` and writes the report.
