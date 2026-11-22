# tokensafe-ui

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/tokensafe-dev/tokensafe-ui/blob/main/LICENSE)
[![npm version](https://img.shields.io/npm/v/tokensafe-ui.svg)](https://www.npmjs.com/package/tokensafe-ui)
[![Protocol: OUMV](https://img.shields.io/badge/protocol-OUMV%20v1.0-brightgreen.svg)](https://github.com/tokensafe-dev/oumv)

> **The native reactive micro-framework and runtime for AI coding agents implementing OUMV: The Universal Agent-UI Protocol (Observe · Understand · Mutate · Verify).**

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

**`tokensafe-ui`** establishes an isomorphic reactive runtime and natively implements **[OUMV: The Universal Agent-UI Protocol](https://github.com/tokensafe-dev/oumv)** (Observe · Understand · Mutate · Verify) to close the autonomous feedback loop between AI agents and user interfaces.

---

## OUMV: The Universal Agent-UI Protocol Architecture

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

---

## Agent Usability Benchmark (AUB): React vs. TokenSafe UI

To scientifically test whether TokenSafe UI genuinely accelerates autonomous AI development rather than merely saving reading tokens, the **Agent Usability Benchmark (AUB / AUI-Bench)** evaluates autonomous AI agents solving identical, production-grade tasks on both **React 18/19** and **TokenSafe UI**.

### Benchmark Task: Full-Featured Task Manager
Agents implement a multi-dimensional Task Manager with:
- Multi-criteria filtering (Status: Active/Completed; Priority: High/Medium/Low).
- Real-time search query matching titles and tags.
- Asynchronous persistence with simulated network latency and loading states.
- HTTP 500 network failure handling, retry recovery, and optimistic update rollback.

### The North Star Metric: Functional Yield per Token (FYpT)
Traditional benchmarks only measure tokens saved. AUB measures **working software delivered per token**:
$$\text{FYpT} = \frac{\text{Passed Functional Assertions}}{\text{Total Tokens Spent}} \times 1,000$$

$$\text{Autonomous Efficiency Ratio (AER)} = \frac{\text{FYpT}_{\text{TokenSafe}}}{\text{FYpT}_{\text{React}}} = \mathbf{7.62\times}$$

### Comparative Scorecard (12-Assertion Shared Behavioral Oracle)

| Metric | React 18/19 Baseline | TokenSafe UI (OUMV) | Delta |
| :--- | :---: | :---: | :---: |
| **Autonomous Efficiency Ratio (AER)** | $1.0\times$ | **$7.62\times$ (WINNER)** | **+662% higher yield** |
| **Functional Yield / 1k Tokens (FYpT)** | `0.3687` | **`2.8103`** | **+662% productivity** |
| **Total Tokens Consumed** | `32,550` | **`4,270`** | **-86.9% tokens saved** |
| **Agent Iterations (Turns to Green)** | `6` | **`3`** | **-50% fewer roundtrips** |
| **Diagnostics Errors Encountered** | `3` | **`0`** | **Zero syntax or type errors** |
| **Regressions Encountered** | `2` | **`0`** | **Zero broken tests** |
| **Self-Recovery Rate (SRR)** | `100%` | **`100%`** | **100% resilient** |
| **Estimated Run Cost (USD)** | `$0.1502` | **`$0.0262`** | **-82.6% cost reduction** |

Run the benchmark locally:
```bash
pnpm aub:replay
```

👉 Read the full methodology and architectural analysis in [docs/benchmarks/agent-usability-benchmark.md](docs/benchmarks/agent-usability-benchmark.md).

### Empirical Case Study: Autonomous MCP Debugging in Order Checkout

In a real-world validation run on `OrderCheckout.tsx` (featuring Zod validation, multi-category item filtering, and `latest-wins` asynchronous coupon lookup), an autonomous AI agent with **zero filesystem permissions** was tasked with finding and fixing an intentional logic bug strictly through `tokensafe-ui-mcp` tools:

1. **Observe & Test (`tokensafe_test_action`)**: Agent dispatched `applyCoupon({ code: 'SAVE20' })`. In **`0.34 ms`**, TokenSafe UI caught an invariant violation: `total ($327) exceeds subtotal + shipping ($275)`.
2. **Understand (`tokensafe_get_component_source`)**: Agent inspected the TypeScript source with AST line numbers and received the Optimistic Concurrency Control (OCC) hash `sha256:3792799...`.
3. **Mutate (`tokensafe_apply_source_edit`)**: Agent applied an atomic OCC patch (`- discount` instead of `+ discount`). TokenSafe UI executed automated pre-flight `tsc --noEmit` and Biome format checks, hot-reloading the SSR component instance.
4. **Verify (`tokensafe_test_action`)**: Agent re-tested the action. Execution passed on the **FIRST ATTEMPT in `0.25 ms`** with structured state diff `total: 275 -> 223`.

👉 Read the complete step-by-step trace in [docs/case-studies/2026-11-23-autonomous-mcp-agent-debugging.md](docs/case-studies/2026-11-23-autonomous-mcp-agent-debugging.md).

---

## Roadmap

- [x] **P0: Core Reactive Substrate & Observer Foundation**
  - [x] Micro-signals implementation (dependency-free, zero-closure traps).
  - [x] Virtual DOM / Direct Reactive DOM mounting.
  - [x] Control-flow reactive primitives (`Show`, `For`, `Portal`, `ErrorBoundary`).
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
  - [x] Native OUMV Protocol Adapter (`@tokensafe-ui/oumv`).
  - [x] Observer L3 (Isolated Source) & L4 (Runtime Traces).
- [ ] **P3: Ecosystem & Benchmarking**
  - [x] AUI-Bench autonomous agent benchmark suite.
  - [ ] React / Vue adapters for the OUMV protocol.
  - [x] Isomorphic SSR hydration runtime (`renderToString` + `hydrate`).
  - [x] Two-way form binding helpers (`bind`).
  - [x] Scaffolding CLI (`create-tokensafe-ui`).

---

## License

[MIT](LICENSE) © 2026 TokenSafe & Contributors
