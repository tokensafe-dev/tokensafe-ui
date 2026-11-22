# agent-dom

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/badge/npm-agent--dom-orange)](https://www.npmjs.com/package/agent-dom)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> **The standardized reactive substrate and protocol for AI coding agents to Observe, Understand, Mutate, and Verify frontend interfaces.**

---

## The Philosophy

> *"Do not try to build a framework that is merely easier for AI agents to write.  
> Build a framework where an AI agent can Observe, Understand, Mutate, and Verify the interface through a standardized protocol."*

Traditional frontend frameworks (React, Vue, Angular) were designed for human developers working inside desktop IDEs. When AI agents interact with them, they hit severe friction:
- **Reactivity Traps**: Stale closures (`useEffect`, dependency arrays) cause hallucinations and infinite render loops.
- **Context Bloat**: Feeding raw HTML or DOM trees to an LLM costs tens of thousands of tokens per inspection.
- **Invisible Causality**: The agent cannot see *why* an element is in a given state or what will break if a state changes.
- **Fragile Verification Loops**: Verifying a minor UI mutation requires launching heavy, slow browser automation suites.

**`agent-dom`** establishes an isomorphic reactive runtime and the **OUMV Protocol** (Observe, Understand, Mutate, Verify) to close the autonomous feedback loop between AI agents and user interfaces.

---

## The OUMV Protocol

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT-DOM RUNTIME ENGINE                        │
├────────────────────────────────────────────────────────────────────────┤
│  1. OBSERVE (Наблюдение)      │  2. UNDERSTAND (Понимание)            │
│  • Multi-Level Snapshot L0–L4 │  • Dynamic Reactive Signals Graph      │
│  • A11y & Interactive Surface │  • Causality Engine (Why this state?)  │
│  • Active State Values        │  • Invariant & Schema Contracts        │
├───────────────────────────────┼────────────────────────────────────────┤
│  3. MUTATE (Изменение)        │  4. VERIFY (Верификация)               │
│  • Symbol-Level Edits with OCC│  • Low-ms Sync Action Testing          │
│  • Transactions & Rollbacks   │  • Structured State & A11y Diffs       │
│  • Ephemeral Sandbox State    │  • Type Guard & Diagnostics Intercept  │
└───────────────────────────────┴────────────────────────────────────────┘
```

### 1. OBSERVE: Multi-Level Context (L0–L4)
Progressive context disclosure guarantees the agent never wastes tokens:
- **L0 (Pulse)**: Current route, mounted root components, error count (~20 tokens).
- **L1 (Interactive Surface)**: Actionable controls, ARIA roles, current values, and triggers (~100–250 tokens).
- **L2 (Component Contract)**: Targeted state schema, props, and actions (~80 tokens).
- **L3 (Isolated Source)**: Symbol-level component source code with AST line numbers.
- **L4 (Runtime Traces)**: Event stream, signal mutations, and active subscriptions.

### 2. UNDERSTAND: Dynamic Dependency Graph & Causality Telemetry
- **Dynamic Reactive Signals Graph**: Tracks runtime dependencies (`signal -> computed -> effect -> DOM binding`) without relying solely on static AST imports.
- **Runtime Causality Inspector (`why_state`)**: Identifies root causes of UI states (e.g., *"Why is the Submit button disabled?"* $\rightarrow$ validation invariant failure in `email` field).

### 3. MUTATE: Symbol-Level Edits with Optimistic Concurrency Control (OCC)
- **Symbol-Level Source Editing**: Agents modify clean, isolated TypeScript components with automated post-edit type checking (`tsc --noEmit`) and auto-formatting before triggering HMR.
- **Optimistic Concurrency Control (OCC)**: Every component inspection returns a content version hash; mutations require `expectedVersion` to prevent overwriting concurrent edits.
- **Ephemeral Sandbox**: Test state transitions and dispatch actions in memory without touching disk files.

### 4. VERIFY: Local Low-Millisecond Multi-Metric Verification
- **Action Testing API**: Directly execute actions against components and receive structured state diffs and A11y surface diffs in single-digit milliseconds—without launching headless browsers.
- **Multi-Metric Latency Telemetry**: Telemetry breaks down timing across action reducer execution, schema validation, signal propagation, and DOM binding updates.
- **Contract Invariant Assertions**: Real-time schema validation via Zod contracts.

---

## Documentation

- [OUMV Protocol Manifesto](docs/plans/2026-11-22-agent-ui-protocol-manifesto.md)
- [Architecture & Design Specification](docs/plans/2026-11-22-agent-dom-framework-design.md)
- [MVP Implementation Plan](docs/plans/2026-11-22-agent-dom-implementation-plan.md)

---

## Quick Example

### Defining an Agent-Friendly Component

```typescript
import { defineComponent, z } from 'agent-dom';

export const TaskItem = defineComponent({
  id: 'task-item',
  
  // 1. Explicit State Contract (AI inspects schema in <30 tokens)
  state: {
    id: z.string(),
    title: z.string(),
    completed: z.boolean().default(false),
    status: z.enum(['idle', 'saving', 'saved', 'error']).default('idle'),
  },

  // 2. Pure Synchronous Actions (Deterministic reducers)
  actions: {
    toggle: (s) => ({ ...s, completed: !s.completed }),
    rename: (s, newTitle: string) => ({ ...s, title: newTitle }),
    setStatus: (s, status) => ({ ...s, status }),
  },

  // 3. Managed Effects (Decoupled async with concurrency policy)
  effects: {
    save: {
      concurrency: 'latest-wins',
      handler: async ({ dispatch, signal, state }) => {
        dispatch('setStatus', 'saving');
        try {
          await api.saveTask(state.id, { completed: state.completed }, { signal });
          if (!signal.aborted) dispatch('setStatus', 'saved');
        } catch (err: any) {
          if (!signal.aborted) dispatch('setStatus', 'error');
        }
      },
    },
  },

  // 4. Pure Projection
  render: ({ state, emit }) => (
    <div class="task-card" data-agent-id="root">
      <input
        type="checkbox"
        data-agent-id="checkbox"
        checked={state.completed}
        onChange={emit.toggle}
      />
      <span data-agent-id="title" class={state.completed ? 'done' : ''}>
        {state.title}
      </span>
      <button data-agent-id="btn-save" onClick={emit.save} disabled={state.status === 'saving'}>
        {state.status === 'saving' ? 'Saving...' : 'Save'}
      </button>
    </div>
  ),
});
```

### Inspecting the Semantic Snapshot (Agent Vision)

```typescript
import { getSemanticSnapshot } from 'agent-dom/observer';

const snapshot = getSemanticSnapshot(document.getElementById('app'));
console.log(snapshot);
```

**Output (<60 tokens for the LLM context):**
```yaml
view: task-item#root
state: { id: "t-1", title: "Ship agent-dom", completed: false, status: "idle" }
elements:
  - input#checkbox [role: checkbox, checked: false, action: toggle]
  - span#title: "Ship agent-dom"
  - button#btn-save: "Save" [action: save]
```

---

## Roadmap

- [x] **P0: Core Reactive Substrate & Observer Foundation**
  - [x] Micro-signals implementation (dependency-free, zero-closure traps).
  - [x] Virtual DOM / Direct Reactive DOM mounting.
  - [x] Control-flow reactive primitives (`Show`, `For`, `Portal`, `ErrorBoundary`).
  - [x] Component contract specification (`defineComponent`, schema validation).
  - [x] Multi-Level Observer L0–L2 (`getSemanticSnapshot`, `getPulse`, `getComponentContract`).
  - [x] Vite plugin & DevServer JSON-RPC bridge.
- [ ] **P1: Causality Engine & Local Verification**
  - [ ] Actions vs Effects separation with concurrency policies (`latest-wins`, `take-leading`, `queue`, `parallel`).
  - [ ] Dynamic Reactive Signals Graph (`signal -> computed -> effect -> DOM binding`).
  - [ ] Causality Engine query tool (`why_state`).
  - [ ] Local low-millisecond Action Testing API with structured state & A11y diffs.
  - [ ] Model Context Protocol (MCP) server tools for OUMV.
- [ ] **P2: Resilient Mutations & Optimistic Concurrency Control**
  - [ ] Symbol-level mutation manager with OCC versioning (`version`, `expectedVersion`, atomic rollback).
  - [ ] Automated post-edit type-checking and formatting guard.
  - [ ] Observer L3 (Isolated Source) & L4 (Runtime Traces).
- [ ] **P3: Ecosystem & Benchmarking**
  - [ ] AUI-Bench autonomous agent benchmark suite.
  - [ ] React / Vue adapters for the OUMV protocol.
  - [ ] Isomorphic SSR hydration runtime.

---

## License

[MIT](LICENSE) © 2026 NekoSin4eG & Contributors
