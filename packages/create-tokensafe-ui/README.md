# create-tokensafe-ui

[![npm version](https://img.shields.io/npm/v/create-tokensafe-ui.svg)](https://www.npmjs.com/package/create-tokensafe-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Protocol: OUMV](https://img.shields.io/badge/protocol-OUMV%20v1.0-brightgreen.svg)](https://github.com/tokensafe-dev/oumv)

The official scaffolding CLI for **TokenSafe UI** — the reactive micro-framework built for AI coding agents implementing the **OUMV Protocol** (Observe · Understand · Mutate · Verify).

---

## Quick Start

### With npm:
```bash
npm create tokensafe-ui@latest my-app
```

### With pnpm:
```bash
pnpm create tokensafe-ui my-app
```

### With yarn:
```bash
yarn create tokensafe-ui my-app
```

### With bun:
```bash
bun create tokensafe-ui my-app
```

---

## What's Included

Every scaffolded TokenSafe UI application comes pre-configured with:

1. **Vite + TypeScript**: Ultra-fast dev server and optimized production build (`pnpm dev`, `pnpm build`).
2. **`tokensafe-ui`**: Complete reactive micro-framework with deterministic fine-grained signals and two-way form binding (`bind`).
3. **`tokensafe-ui/vite`**: Vite JSX transformation plugin and live DevServer RPC bridge for AI coding agents.
4. **Autonomous Agent Integration (`.mcp.json`)**:
   - Ready-to-use Model Context Protocol server configuration for **Antigravity**, **Claude Code**, and **Cursor**.
   - Enables coding agents to **Observe**, **Understand**, **Mutate**, and **Verify** the UI locally with zero context bloat.

---

## Development

```bash
cd my-app
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## License

MIT © [TokenSafe Dev](https://github.com/tokensafe-dev)
