# Implementation Plan: agent-dom Micro-Framework (MVP)

This implementation plan translates the validated [Architecture and Design Specification](2026-11-22-agent-dom-framework-design.md) into concrete execution phases.

---

## Architecture Overview

```
agent-dom/
├── packages/
│   ├── core/           # Signals reactivity, defineComponent contract, client mount/hydrate
│   ├── observer/       # Semantic tree projector (<150 tokens)
│   ├── patcher/        # AST surgical mutation engine (TS/Babel)
│   ├── vite/           # JSX compiler plugin & Live DevServer RPC bridge
│   └── mcp/            # Model Context Protocol server exposing agent tools
└── playground/         # Isomorphic demo app verifying the full agent loop
```

---

## Proposed Phases & Milestones

### Phase 1: Workspace & Tooling Scaffolding
- [ ] Initialize `pnpm-workspace.yaml`, root `package.json`, and base `tsconfig.json`.
- [ ] Configure `tsup` for dual ESM/CJS builds and `vitest` for the test suite across workspaces.
- [ ] Scaffold package directories (`core`, `observer`, `patcher`, `vite`, `mcp`, `playground`).

### Phase 2: `@agent-dom/core` — Signals & Component Contract
- [ ] Implement dependency-free fine-grained signals (`signal`, `computed`, `effect`, `batch`).
- [ ] Implement `defineComponent({ id, state, actions, render })` contract with Zod validation.
- [ ] Implement DOM mounting and single-run reactive binding mechanism (`mount`, `renderToString`).
- [ ] Write Vitest unit tests covering reactivity, subscriptions, and memory cleanup.

### Phase 3: `@agent-dom/observer` — Semantic Agent Vision
- [ ] Implement DOM tree crawler targeting `data-agent-id` and ARIA accessibility roles.
- [ ] Build lean YAML / S-expression serializer projecting state + interactive actions (<150 tokens).
- [ ] Unit test semantic serialization against realistic component trees.

### Phase 4: `@agent-dom/patcher` — Surgical AST Mutation Engine
- [ ] Implement AST parser and mutator using `@babel/parser`, `@babel/traverse`, `@babel/generator`.
- [ ] Support operations: `add_action`, `update_state`, `insert_jsx`, `bind_event`.
- [ ] Add AST syntax validation and code formatting prior to disk writes.
- [ ] Write snapshot tests verifying accurate file modification without syntax disruption.

### Phase 5: `@agent-dom/vite` — JSX Transform & Live DevServer Bridge
- [ ] Implement Vite plugin transforming JSX into template clones and fine-grained signal subscriptions.
- [ ] Auto-inject `data-agent-id` annotations during compilation.
- [ ] Embed local HTTP/WebSocket RPC server (`/__agent_dom/rpc`) inside Vite DevServer to stream live UI snapshots.

### Phase 6: `@agent-dom/mcp` — Model Context Protocol Server
- [ ] Create standalone MCP server binary exposing:
  - `agent_dom_get_view()`: live view or SSR snapshot.
  - `agent_dom_inspect(componentId)`: component contract & AST pointers.
  - `agent_dom_apply_patch(spec)`: AST mutation with HMR trigger.
  - `agent_dom_get_errors()`: structured LLM-friendly diagnostic payloads.
- [ ] Implement automatic offline fallback to disk AST parsing when Vite DevServer is down.

### Phase 7: `playground/` & E2E Validation
- [ ] Create an interactive isomorphic task application in `playground/`.
- [ ] Verify SSR rendering and client-side hydration.
- [ ] Execute an automated end-to-end agent loop test:
  1. Inspect semantic view (`< 100 tokens`).
  2. Send AST patch to add a new action and button.
  3. Verify Vite HMR update.
  4. Verify updated semantic snapshot.

---

## Verification & Acceptance Criteria
- 100% of unit tests pass across all packages (`pnpm test`).
- Semantic snapshot size remains strictly under 150 tokens for standard dashboard/card views.
- AST patcher applies modifications cleanly with zero syntax errors or formatting corruption.
- Complete agent loop successfully executes against the playground.
