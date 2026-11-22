# Design Document: agent-dom Micro-Framework

**Date**: 2026-11-22  
**Status**: Approved  
**Repository**: [github.com/NekoSin4eG/agent-dom](https://github.com/NekoSin4eG/agent-dom)

---

## 1. Executive Summary

`agent-dom` is a lightweight, isomorphic frontend micro-framework engineered from first principles for **AI coding agents** and **generative runtimes**.

Traditional frontend libraries (React, Vue) impose severe friction on LLM agents:
* Reactivity traps (hooks dependencies, stale closures, unexpected re-render cascades).
* High token overhead when reading raw HTML / DOM trees (20,000+ tokens per view).
* Fragile file-level string diffs that break syntax when modifying components.
* Noisy minified compiler/runtime error traces.

`agent-dom` solves these problems by providing:
1. **Zero-Trap Reactivity**: Fine-grained signals with single-execution component bodies and zero dependency arrays.
2. **Explicit Component Contracts**: Pure separation into `state` (Zod schema), `actions` (deterministic state mutations), and `render` (pure view projection).
3. **Semantic Observer**: Real-time projection of UI state and accessible interactive elements into compact YAML/S-expressions (< 150 tokens).
4. **Surgical AST Patcher**: Programmatic AST-level mutation engine (TS/Babel) to edit components without risking file corruption.
5. **Hybrid Agent Protocol**: Vite DevServer plugin for live runtime introspection & HMR + an MCP (Model Context Protocol) server for native agent tool calling with offline fallback.

---

## 2. Monorepo Architecture & Tech Stack

Organized as a `pnpm` workspace:

```text
agent-dom/
├── packages/
│   ├── core/           # @agent-dom/core: signals, defineComponent, DOM runtime
│   ├── vite/           # @agent-dom/vite: JSX transform plugin, dev-server bridge, HMR
│   ├── observer/       # @agent-dom/observer: semantic UI projector (<150 tokens)
│   ├── patcher/        # @agent-dom/patcher: surgical AST mutation engine
│   └── mcp/            # @agent-dom/mcp: Model Context Protocol server for AI agents
├── playground/         # Isomorphic demo application for E2E tests & verification
├── docs/               # Architecture specs and plans
├── package.json
└── pnpm-workspace.yaml
```

### Core Technologies
* **Language**: TypeScript (`strict: true`, clean `.d.ts` declaration generation).
* **Package Manager**: `pnpm` workspaces.
* **Build System**: `tsup` (fast Dual ESM/CJS compilation via esbuild).
* **Dev Server & Bundling**: `Vite` (HMR, SSR pipeline, plugin ecosystem).
* **AST Engine**: `@babel/parser`, `@babel/traverse`, `@babel/generator` / `ts-morph`.
* **Schema Validation**: Lightweight Zod (or zero-dep micro-validator).
* **Test Runner**: `Vitest` for ultra-fast unit and integration testing.

---

## 3. Core Reactivity & Component Contract (`@agent-dom/core` & `@agent-dom/vite`)

### 3.1 Reactive Primitives (Signals)
* `signal<T>(initialValue)`: Fine-grained getter/setter tuple with dependency subscription.
* `computed<T>(fn)`: Memoized derived reactive value.
* `effect(fn)`: Targeted DOM subscription, automatically executed when referenced signals mutate.

**Zero-Trap Guarantee**: The component function is executed **only once** upon mounting. Dynamic bindings in the DOM subscribe directly to signals; the parent component never re-renders.

### 3.2 Component Specification
```tsx
import { defineComponent, z } from '@agent-dom/core';

export const TaskCard = defineComponent({
  id: 'task-card',

  // 1. Explicit State Contract
  state: {
    title: z.string(),
    isDone: z.boolean().default(false),
  },

  // 2. Deterministic Actions
  actions: {
    toggle: (s) => ({ ...s, isDone: !s.isDone }),
    setTitle: (s, newTitle: string) => ({ ...s, title: newTitle }),
  },

  // 3. Pure Projection
  render: ({ state, emit, props }) => (
    <div class="card" data-agent-id="root">
      <span class={state.isDone ? 'done' : ''} data-agent-id="title">
        {state.title}
      </span>
      <button onClick={emit.toggle} data-agent-id="btn-toggle">
        Done
      </button>
    </div>
  ),
});
```

### 3.3 Vite Compiler Transform & SSR
* **Client Compilation**:
  * Static DOM nodes are converted to native `<template>` elements cloned via `template.content.cloneNode(true)`.
  * Dynamic expressions are bound via `effect(() => node.textContent = signal.value)`.
  * `data-agent-id` attributes are automatically injected if omitted.
* **Isomorphic SSR**:
  * `renderToString()` produces static HTML markup + injects serialized initial state:
    `<script id="__AGENT_DOM_STATE__">...</script>`.
  * Client hydration reuses existing DOM nodes and attaches event listeners and signals without DOM recreation.

---

## 4. Agent Protocol: Observer, Patcher & MCP

### 4.1 Semantic Observer (`@agent-dom/observer`)
Extracts a lean accessibility and state tree by filtering out presentational styling classes:
```yaml
view: task-card
state: { title: "Buy groceries", isDone: false }
elements:
  - span#title: "Buy groceries"
  - button#btn-toggle [role: button, label: "Done", action: toggle]
```
Context budget: **< 150 tokens** per view.

### 4.2 Surgical AST Patcher (`@agent-dom/patcher`)
Performs deterministic, syntax-safe code mutations without whole-file rewrites:
* `add_action(componentId, actionName, mutationCode)`
* `update_state(componentId, key, schemaCode)`
* `insert_jsx(targetAgentId, position: 'before' | 'after' | 'prepend' | 'append', jsxNode)`
* `bind_event(targetAgentId, event, actionName)`

All patches undergo AST syntax validation before disk write.

### 4.3 MCP Server (`@agent-dom/mcp`)
Exposes 4 standard tools to coding agents:
1. `agent_dom_get_view()`: Queries the active UI snapshot from the browser/Vite dev-server.
2. `agent_dom_inspect(componentId)`: Returns component schema, actions, and AST element IDs (<40 tokens).
3. `agent_dom_apply_patch(patchSpec)`: Executes an AST patch and triggers Vite HMR.
4. `agent_dom_get_errors()`: Returns structured compiler or runtime error envelopes.

**Offline Fallback**: When the Vite DevServer is offline or crashed, the MCP server automatically falls back to static AST inspection and file editing on disk.

### 4.4 LLM-Native Diagnostic Payloads
Errors bypass minified framework stack traces and return clean, actionable objects:
```json
{
  "status": "error",
  "component": "task-card",
  "nodeId": "task-card:btn-toggle",
  "reason": "Action 'delete' is not defined in actions schema",
  "availableActions": ["toggle", "setTitle"],
  "suggestedPatch": { "op": "add_action", "name": "delete" }
}
```

---

## 5. Verification & Testing Strategy

1. **Unit Testing (`vitest`)**:
   - Signal reactivity, computed dependency graphs, and effect cleanup.
   - Component contract parsing and validation.
   - AST patch accuracy (snapshots of source before and after mutation).
2. **Integration & E2E Testing**:
   - SSR render output and client hydration in `playground/`.
   - Simulated agent loop:
     1. Agent queries `agent_dom_get_view()`.
     2. Agent applies AST patch `agent_dom_apply_patch()`.
     3. Vite HMR updates the running DOM.
     4. Verified updated semantic snapshot.
