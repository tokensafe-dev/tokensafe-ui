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
│  • Multi-Level Snapshot L0–L4 │  • Component Dependency Graph          │
│  • A11y & Interactive Surface │  • Cause-and-Effect Telemetry Log      │
│  • Active State Values        │  • Invariant & Schema Contracts        │
├───────────────────────────────┼────────────────────────────────────────┤
│  3. MUTATE (Изменение)        │  4. VERIFY (Верификация)               │
│  • Symbol-Level Source Edits  │  • 5ms Component-Level Action Testing  │
│  • Ephemeral Action Trigger   │  • Structured State Diffs              │
│  • Safe Hot Reloading (HMR)   │  • Type Guard & Diagnostics Intercept  │
└───────────────────────────────┴────────────────────────────────────────┘
```

### 1. OBSERVE: Multi-Level Context (L0–L4)
Progressive context disclosure guarantees the agent never wastes tokens:
- **L0 (Pulse)**: Current route, mounted root components, error count (~20 tokens).
- **L1 (Interactive Surface)**: Actionable controls, ARIA roles, current values, and triggers (~100–250 tokens).
- **L2 (Component Contract)**: Targeted state schema, props, and actions (~80 tokens).
- **L3 (Isolated Source)**: Symbol-level component source code with AST line numbers.
- **L4 (Runtime Traces)**: Event stream, signal mutations, and active subscriptions.

### 2. UNDERSTAND: Dependency Graph & Cause Telemetry
- **Component Dependency Graph**: Instant impact analysis answering *"What components will be affected if this state changes?"*
- **Runtime Causality Inspector**: Identifies root causes of UI states (e.g., *"Why is the Submit button disabled?"* $\rightarrow$ validation invariant failure in `email` field).

### 3. MUTATE: Controlled Symbol-Level & Runtime Mutation
- **Symbol-Level Source Editing**: Agents modify clean, isolated TypeScript components with automated post-edit type checking (`tsc --noEmit`) and auto-formatting before triggering HMR.
- **Ephemeral Sandbox**: Test state transitions and dispatch actions in memory without touching disk files.

### 4. VERIFY: 5ms Instant Action Testing
- **Action Testing API**: Directly execute actions against components and receive structured before/after state diffs in milliseconds—without launching headless browsers.
- **Invariant Assertions**: Real-time schema validation via Zod contracts.

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
  },

  // 2. Deterministic Actions (No side-effect spaghetti)
  actions: {
    toggle: (s) => ({ ...s, completed: !s.completed }),
    rename: (s, newTitle: string) => ({ ...s, title: newTitle }),
  },

  // 3. Pure Projection
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
state: { id: "t-1", title: "Ship agent-dom", completed: false }
elements:
  - input#checkbox [role: checkbox, checked: false, action: toggle]
  - span#title: "Ship agent-dom"
```

---

## Roadmap

- [ ] **Phase 1: Core Runtime**
  - [ ] Micro-signals implementation (dependency-free, zero-closure traps).
  - [ ] Virtual DOM / Direct Reactive DOM mounting.
  - [ ] Component contract specification (`defineComponent`, schema validation).
- [ ] **Phase 2: Semantic Observer**
  - [ ] Accessibility tree & reactive state projection serializer.
  - [ ] YAML & Lean S-Expression formats for LLM prompt injections.
- [ ] **Phase 3: Surgical AST Patcher**
  - [ ] AST mutation engine (Babel / TypeScript compiler API).
  - [ ] Agent CLI & MCP server tools (`agent-dom-cli patch`).
- [ ] **Phase 4: Generative Runtime Sandbox**
  - [ ] Safe in-browser execution of agent-streamed UI specs.
  - [ ] Interactive developer playground.

---

## License

[MIT](LICENSE) © 2026 NekoSin4eG & Contributors
