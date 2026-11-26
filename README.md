# tokensafe-ui

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/tokensafe-dev/tokensafe-ui/blob/main/LICENSE)
[![npm version](https://img.shields.io/npm/v/tokensafe-ui.svg)](https://www.npmjs.com/package/tokensafe-ui)
[![Protocol: OUMV](https://img.shields.io/badge/protocol-OUMV%20v1.4--canonical-brightgreen.svg)](https://github.com/tokensafe-dev/oumv)

> **OUMV Frontend Profile adapters for the stack you already use** — React 18/19 with a zero-footprint Vite bridge (certified Level 3 in a browser), plus a programmatic Vue 3 adapter that is not yet wired into Vite or certified. A native SolidJS reactive runtime ships in the same package as a legacy reference implementation; it is not the recommended path. Protocol: OUMV — the Universal Agent-Runtime Protocol, Frontend Profile (Observe · Understand · Mutate · Verify).**

Part of the **[TokenSafe](https://github.com/tokensafe-dev)** autonomous agent developer ecosystem.

---

## The Philosophy

> *"Do not try to build a framework that is merely easier for AI agents to write.  
> Build a framework where an AI agent can Observe, Understand, Mutate, and Verify the interface through a standardized protocol."*

Traditional frontend frameworks (React, Vue, Angular) were designed for human developers working inside desktop IDEs. When AI agents interact with them, they hit severe friction:
- **Reactivity Traps**: Stale closures (`useEffect`, dependency arrays) cause hallucinations and infinite render loops.
- **Context Bloat**: Feeding raw HTML or DOM trees to an LLM costs tens of thousands of tokens per inspection.
- **Invisible Causality**: The agent cannot see *why* an element is in a given state or what will break if a state changes.
- **Fragile Verification Loops**: Verifying a minor UI mutation requires launching heavy, slow browser automation suites.

**`tokensafe-ui`** establishes an isomorphic reactive runtime and natively implements **[OUMV: the Universal Agent-Runtime Protocol (UARP), Frontend Profile](https://github.com/tokensafe-dev/oumv)** (Observe · Understand · Mutate · Verify) to close the autonomous feedback loop between AI agents and user interfaces.

---

## OUMV Frontend Profile Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                      TOKENSAFE-UI RUNTIME ENGINE                       │
├───────────────────────────────┬────────────────────────────────────────┤
│  1. OBSERVE                   │  2. UNDERSTAND                         │
│  • Multi-Level Snapshot L0–L4 │  • Dynamic Reactive Signals Graph      │
│  • A11y & Interactive Surface │  • Causality Engine (Why this state?)  │
│  • Active State Values        │  • Invariant & Schema Contracts        │
├───────────────────────────────┼────────────────────────────────────────┤
│  3. MUTATE                    │  4. VERIFY                             │
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
- **Dynamic Reactive Signals Graph**: Tracks runtime dependencies (`signal -> computed -> effect -> DOM binding`) with topological depth (`level`) and ownership scope isolation (`scopeId`) without relying solely on static AST imports.
- **Glitch-Free Topological Ordering**: Multi-phase scheduler resolves diamond dependency convergence without transient intermediate states.
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

## Installation

```bash
# Using pnpm
pnpm add tokensafe-ui zod

# Using npm
npm install tokensafe-ui zod
```

### Quickstart Scaffolding

Create a new TokenSafe UI project with pre-configured Vite, TypeScript, and AI Agent MCP integration:

```bash
pnpm create tokensafe-ui my-app
# or
npm create tokensafe-ui my-app
```

---

## Quick Example

### Defining an Agent-Friendly Component

```typescript
import { defineComponent, z, bind } from 'tokensafe-ui';

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

  // 4. Pure Projection with Two-Way Binding
  render: ({ state, emit }) => (
    <div class="task-card" data-agent-id="root">
      <input
        type="checkbox"
        data-agent-id="checkbox"
        {...bind(emit.toggle, state.completed)}
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
import { getSemanticSnapshot } from 'tokensafe-ui/observer';

const snapshot = getSemanticSnapshot(document.getElementById('app'));
console.log(snapshot);
```

**Output (<60 tokens for the LLM context):**
```yaml
view: task-item#root
state: { id: "t-1", title: "Ship tokensafe-ui", completed: false, status: "idle" }
elements:
  - input#checkbox [role: checkbox, checked: false, action: toggle]
  - span#title: "Ship tokensafe-ui"
  - button#btn-save: "Save" [action: save]
```

### Standalone Reactive Primitives & Scopes (Substrate API)

For advanced state architectures, data pipelines, and fine-grained logic outside components, `tokensafe-ui` exposes a zero-dependency, glitch-free reactive substrate:

```typescript
import {
  signal,
  computed,
  effect,
  batch,
  untrack,
  createRoot,
  createScope,
  onCleanup,
} from 'tokensafe-ui';

// 1. Signals & Glitch-Free Topological Computeds
const source = signal(1);
const a = computed(() => source.value * 2);
const b = computed(() => source.value * 3);

// Diamond convergence: evaluated strictly ONCE without transient intermediate states
const sum = computed(() => a.value + b.value);

// 2. Controlled Lifecycle: Explicit Disposal
sum.dispose(); // Unhooks runner from 'a' and 'b' to guarantee zero memory leaks

// 3. Reactive Scopes & Ownership Tree
createRoot((dispose) => {
  const { scope } = createScope(() => {
    effect(() => {
      // 4. untrack: read state without registering unwanted subscriptions
      const current = a.value;
      const debugCount = untrack(() => source.value);
      console.log(`a=${current}, debug=${debugCount}`);
    });

    onCleanup(() => {
      console.log('Scope teardown: cleanly unregistering child effects & computeds');
    });
  });

  // Cascading cleanup of the entire child tree
  dispose();
});

// 5. Atomic Multi-Field Batching (Also integrated into Component.dispatch())
batch(() => {
  source.value = 10;
});
```

---

## Frontend Adapters: React & Vue Retrofit

`tokensafe-ui` is the **OUMV Frontend Profile accumulator**: adapters for React and Vue plus the Vite bridge, with zero-rewrite retrofit adapters for existing React and Vue applications:

### 1. React Adapter (`tokensafe-ui/react`)
Connects React components, hooks, and stores to OUMV:
- **Zustand**: `connectZustand(useCartStore, { name: 'cart' })`
- **Redux / Redux Toolkit**: `connectRedux(store, { actionCreators: { ... } })`
- **useReducer**: `connectReducer([state, dispatch], { name: 'orderReducer' })`
- **React Context**: `connectContext(contextValue, { name: 'authContext' })`
- **Static Discovery**: `scanSourceForComponents(source, filePath)` extracts components and routes directly from TSX/JSX AST via Babel without running a headless browser.

### 2. Vue Adapter (programmatic, `@tokensafe-ui/oumv/vue`)
Registers Vue 3 components and Pinia stores manually for the in-process adapter.
There is **no Vite integration and no conformance report yet**: a Vue app served by
the plugin exposes no OUMV endpoints, so agents should use static analysis for Vue
until that lands.

### 3. Vite Dev-Server Bridge (`tokensafe-ui/vite`)
Automatically mounts `/__oumv/rpc` and generates session token descriptors (`.tokensafe/runtime.json`, mode `0600`) in dev mode.

---

## Measured results

### 1. Conformance: Level 3 in a real browser

`certification/react-vite-browser.json` — **25/25 cases (fixtures v6), Level 3**, produced by
`packages/vite/scripts/certify-react-browser.mjs`: it starts the committed
`certification/app` through Vite, opens it in headless Chrome, waits for the bridge and
runs `oumv-certify --url` against the dev server. `oumv/verify` dispatches real synthetic
events, and L4 traces are the ones the bridge actually recorded.

The offline stdio run (`certification/react-vite.json`) attains Level 1 for a reason worth
stating: `oumv/verify` answers `-32008` without a browser tab and L4/causality have no
traces, so the four browser-only failures are named in the report instead of hidden.

### 2. Adapter latency (measured on `certification/app`)

| Operation | Before | After |
| :--- | ---: | ---: |
| `getSource`, first call | 198.5 ms | **0.1 ms** |
| `applyEdit`, first call | 202.8 ms | **7.2 ms** (preload window) / 1.2 ms warm |
| `observe` L1 | 1.9 ms | 1.6 ms |

The first two were dominated by importing the 216 KB MCP bundle just to resolve a path;
the controller now carries a local realpath jail and imports the edit engine only for
edits, warming it in the background at startup.

### 3. Agent-level benchmark: measured

3 regression tasks × 3 runs × 2 arms on `deepseek-chat` (temperature 0). Each session starts
from a throwaway copy of the sandbox and the real 12-assertion oracle is re-run after every
step. Both arms get the same search/read/write/command tools and the same bug report
(including a repro); the `oumv` arm additionally gets `observe`/`getSource`/`applyEdit` from
the shipped static controller over stdio. Tokens and cost are the provider's `usage` payload.

| Arm | Solved | Mean steps | Mean input tokens | Mean output tokens | Cost |
| :--- | ---: | ---: | ---: | ---: | ---: |
| `baseline` | 9/9 | 4.8 | 17,541 | 1,574 | $0.0316 |
| `oumv` | 9/9 | 3.4 | 7,938 | 1,465 | $0.0235 |
| **Delta** | — | **−29.2%** | **−54.7%** | −6.9% | **−25.6%** |

Deterministic adapter numbers (no model): `getSource` on one symbol returns **634 chars** where
the file is **4,483**; `getSource` answers in **1.0 ms** against **874 ms** for the oracle run;
a stale `expectedVersion` is rejected with `-32001`. Per-task table, method and limits:
[benchmarks/REACT_AGENT_MATRIX.md](benchmarks/REACT_AGENT_MATRIX.md).

The earlier AER scorecard (7.62×/21.0×) was computed from **replay traces**, not from a
measured agent run, so it stays withdrawn: the replay harness (`pnpm aub:replay`) is a
regression check, not a productivity claim.

### Empirical Case Study: Autonomous MCP Debugging in Order Checkout (v0.2.0)

In a real-world validation run on `OrderCheckout.tsx` (featuring Zod validation, multi-category item filtering, and `latest-wins` asynchronous coupon lookup), an autonomous AI agent with **zero filesystem permissions** was tasked with finding and fixing an intentional logic bug strictly through `tokensafe-ui` CLI and MCP tools:

1. **Observe & Test (`tokensafe_test_action` with declarative `expect`)**: Agent tested `applyDiscount` with `--expect='{"total":223}'`. In **`0.59 ms`**, TokenSafe UI caught an assertion mismatch: `expected total=223, received 327` without requiring synthetic throw guards in production code.
2. **Verify Async Effects (`tokensafe_test_effect`)**: Agent tested `lookupCoupon`. In **`31.47 ms`**, the runtime validated the full debounce and action dispatch sequence (`setCouponStatus(validating) -> applyDiscount(SAVE20)`) under `latest-wins` concurrency.
3. **Understand (`tokensafe_get_component_source`)**: Agent inspected the TypeScript source and received the Optimistic Concurrency Control (OCC) hash `sha256:e07230...`.
4. **Mutate (`tokensafe_patch_component`)**: Agent applied a semantic AST patch to the `applyDiscount` reducer (`Math.max(0, s.subtotal - discountAmount + s.shippingFee)`). TokenSafe UI executed automated Biome formatting and hot-reloaded the SSR component in-memory with signal states preserved.
5. **Verify on First Attempt (`tokensafe_test_action`)**: Agent re-tested the action. Execution passed on the **FIRST ATTEMPT in `0.33 ms`** with structured state transition `total: 327 -> 223`.

👉 Read the complete step-by-step trace in [docs/case-studies/2026-11-23-autonomous-mcp-agent-debugging.md](docs/case-studies/2026-11-23-autonomous-mcp-agent-debugging.md).

---

## Roadmap

- [x] **P0: Core Reactive Substrate & Observer Foundation**
  - [x] Micro-signals implementation (dependency-free, zero-closure traps).
  - [x] Glitch-free topological scheduler (phased execution: computeds by level → effects → DOM).
  - [x] Reactive ownership tree & scopes (`createRoot`, `createScope`, `onCleanup`).
  - [x] Leak-free computeds with explicit `.dispose()` and `untrack()` API.
  - [x] Atomic multi-field state transactions via `batch()` in component dispatchers.
  - [x] Virtual DOM / Direct Reactive DOM mounting.
  - [x] Control-flow reactive primitives (`Show`, `For`, `Portal`, `ErrorBoundary`) with branch/item scope disposal.
  - [x] Component contract specification (`defineComponent`, schema validation).
  - [x] Multi-Level Observer L0–L2 (`getSemanticSnapshot`, `getPulse`, `getComponentContract`).
  - [x] Vite plugin & DevServer JSON-RPC bridge.
- [x] **P1: Causality Engine & Local Verification**
  - [x] Actions vs Effects separation with concurrency policies (`latest-wins`, `take-leading`, `queue`, `parallel`).
  - [x] Dynamic Reactive Signals Graph (`signal -> computed -> effect -> DOM binding`).
  - [x] Causality Engine query tool (`why_state`).
  - [x] Local low-millisecond Action Testing API with structured state & A11y diffs.
  - [x] Model Context Protocol (MCP) server tools for OUMV.
- [x] **P2: Resilient Mutations & Optimistic Concurrency Control**
  - [x] Symbol-level mutation manager with OCC versioning (`version`, `expectedVersion`, atomic rollback).
  - [x] Automated post-edit type-checking and formatting guard.
  - [x] Native OUMV Protocol Adapter (`tokensafe-ui/oumv`).
  - [x] Observer L3 (Isolated Source) & L4 (Runtime Traces).
- [ ] **P3: Ecosystem & Benchmarking**
  - [x] AUI-Bench autonomous agent benchmark suite.
  - [x] React adapter for the OUMV protocol (Level 3, certified in a real browser).
- [ ] Vue adapter: Vite integration and certification.
  - [x] Isomorphic SSR hydration runtime (`renderToString` + `hydrate`).
  - [x] Two-way form binding helpers (`bind`).
  - [x] Scaffolding CLI (`create-tokensafe-ui`).

---

## License

[Apache-2.0](LICENSE) © 2026 TokenSafe & Contributors

`packages/create-tokensafe-ui` remains MIT: that grant was issued before the repository moved
to Apache-2.0 and cannot be revoked. "OUMV Certified" and the certification badge are marks
and are not licensed by either grant.
