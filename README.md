# agent-dom

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/badge/npm-agent--dom-orange)](https://www.npmjs.com/package/agent-dom)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> **The deterministic, token-efficient frontend micro-framework engineered for AI coding agents and generative runtimes.**

Traditional frontend frameworks (React, Vue, Angular) were designed for human developers working inside desktop IDEs. When AI agents interact with them, they hit severe friction:
- **Reactivity Traps**: Stale closures (`useEffect`, dependency arrays) cause hallucinations and infinite render loops.
- **Context Bloat**: Feeding raw HTML or DOM trees to an LLM costs tens of thousands of tokens per inspection.
- **Fragile File Diffs**: Modifying a 500-line `.tsx` file via string diffs frequently breaks syntax and indentation.
- **Noisy Diagnostics**: 100-line minified stack traces consume context without giving the agent an actionable fix path.

**`agent-dom`** reimagines the frontend component model with **AI agents as first-class citizens**—both as developers authoring and refactoring code, and as autonomous runtimes driving interactive UI.

---

## Core Pillars

```
┌────────────────────────────────────────────────────────────────────────┐
│                               AGENT-DOM                                │
├───────────────────────┬────────────────────────┬───────────────────────┤
│    Zero-Trap Core     │    Semantic Vision     │    Surgical Hands     │
│  (Signals & Schema)   │  (<150 Token Snapshots)│   (AST Patch Protocol)│
└───────────────────────┴────────────────────────┴───────────────────────┘
```

### 1. Zero-Trap Reactivity (`agent-dom/core`)
- **Explicit Component Contracts**: Components are decomposed into **State Schema** (Zod / JSON Schema), **Intents/Actions** (pure deterministic mutations), and **View**.
- **Fine-Grained Signals**: Built on micro-signals. No dependency arrays, no stale closures, no unexpected re-render cascades.
- **Lightweight**: Zero bloat, ~2KB core runtime.

### 2. Semantic Observer (`agent-dom/observer`)
- **Agent Vision**: Translates live DOM trees and app state into a compact semantic ledger (S-expression or YAML) taking **< 150 tokens** instead of 20,000+ tokens of raw HTML.
- **Interactive Role Tracking**: Automatically tracks interactive elements with deterministic agent IDs, roles, and allowed action triggers.

### 3. Surgical Mutation Protocol (`agent-dom/patcher`)
- **Agent Hands**: AI coding agents never need to re-write full files or gamble on regex string diffs.
- **Deterministic AST Operations**: Provides a structured RPC/CLI protocol (`insert_node`, `bind_action`, `update_schema`) that validates syntax and TypeScript contracts before committing.

### 4. LLM-Native Diagnostic Channel
- **Actionable Error Payloads**: Intercepts compiler and runtime errors and converts them into machine-actionable repair objects:
  ```json
  {
    "type": "ContractMismatch",
    "target": "UserCard.render.Badge",
    "expected": "status in ['active', 'idle']",
    "received": "'pending'",
    "patchHint": "Update state schema or coerce value"
  }
  ```

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
