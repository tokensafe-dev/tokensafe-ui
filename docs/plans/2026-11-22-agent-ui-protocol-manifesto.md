# The Agent-UI Protocol Manifesto: OUMV Architecture

**Date**: 2026-11-22  
**Status**: Adopted as Project Core Philosophy  
**Repository**: [github.com/NekoSin4eG/agent-dom](https://github.com/NekoSin4eG/agent-dom)

---

## 1. The Core Philosophy

> **"Do not try to build a framework that is merely easier for AI agents to write.  
> Build a framework where an AI agent can Observe, Understand, Mutate, and Verify the interface through a standardized protocol."**

Competing with React or Vue on JSX authoring alone is a dead end—LLMs already possess vast training on standard web syntax. The fundamental breakthrough is creating an **isomorphic reactive substrate and standardized protocol** that closes the feedback loop between the autonomous agent and the running interface.

The core of `agent-dom` is the **OUMV Protocol**:

$$\mathbf{Observe} \longrightarrow \mathbf{Understand} \longrightarrow \mathbf{Mutate} \longrightarrow \mathbf{Verify}$$

---

## 2. The Four Pillars of OUMV

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

---

### Pillar 1: OBSERVE (Hierarchical Semantic Projection L0–L4)

Rather than imposing an arbitrary flat token limit or flooding the model with 20,000 tokens of raw DOM, the agent observes the interface through **Progressive Context Disclosure**:

| Level | Name | Purpose | Token Budget |
| :--- | :--- | :--- | :--- |
| **L0** | **Page Pulse** | Active URL, mounted root components, global error/loading flags. | ~20 tokens |
| **L1** | **Interactive Surface** | Focused map of actionable elements (buttons, inputs, forms), roles, states, and action triggers. | ~100–250 tokens |
| **L2** | **Component Contract** | Schema, props, signals, and invariants of a targeted component. | ~80 tokens |
| **L3** | **Isolated Source** | Symbol-level source code of the component with line mapping. | ~300–600 tokens |
| **L4** | **Runtime Traces** | Live event log, signal mutation timeline, and active subscriptions. | On-demand |

The agent queries **L0 + L1** by default. When an anomaly is detected, it drills down into **L2** or **L3** for the specific component without polluting its context window.

---

### Pillar 2: UNDERSTAND (Dependency Graphs & Causality Telemetry)

Traditional frameworks leave agents guessing why an interface is in a given state. `agent-dom` provides built-in answers to two fundamental questions:

#### 1. "Why is the UI in this state?" (Cause-and-Effect Telemetry)
The Runtime Inspector tracks causal chains:
```yaml
event: click#task-board:btn-save
triggered_action: saveTask
mutated_signal: isSaving = true -> false
effect_triggered: disableButton#task-board:btn-save
validation_failure: field "title" is empty
root_cause: InvariantViolation in TaskSchema.title
```

#### 2. "What will break if I modify this node?" (Component Dependency Graph)
Before touching code, the agent queries the component graph:
```yaml
query_impact: UserState.avatarUrl
affects:
  - Header: [reads avatarUrl]
  - ProfileModal: [writes avatarUrl]
  - SettingsView: [reads avatarUrl]
safe_to_edit:
  - TaskList: [no shared state]
```

---

### Pillar 3: MUTATE (Controlled Symbol-Level & Runtime Mutation)

AST micro-patching (`insert_jsx`) is fragile for complex feature additions. `agent-dom` establishes two distinct mutation tiers:

1. **Code-Level Mutation (Symbol-Level Source Edits)**:
   - The agent retrieves the component's exact boundaries via `get_component_source(id)`.
   - The agent writes idiomatic TypeScript edits.
   - **Post-Edit Type Guard**: The compiler immediately runs isolated type-checking (`tsc --noEmit`) and auto-formatting before triggering HMR. If types are broken, the agent gets a precise error payload before the browser breaks.
2. **Runtime Mutation (Ephemeral Sandbox)**:
   - The agent can trigger actions and test state transitions live in memory (`agent_dom_dispatch`) without persisting changes to disk.

---

### Pillar 4: VERIFY (5ms Instant Component-Level Verification)

Instead of relying solely on heavy end-to-end browser tests (Playwright/Puppeteer):

* **Action Testing API**:
  The agent dispatches an action against a component and instantly receives a structured state diff:
  ```json
  {
    "action": "toggleFilter",
    "status": "passed",
    "diff": {
      "filter": { "before": "all", "after": "completed" }
    },
    "durationMs": 4
  }
  ```
* **Contract Invariant Assertions**: Every mutation is validated against the component's Zod schema in real time.

---

## 3. Reactivity & Complex UI Primitives

To eliminate closure traps and memory leaks, `agent-dom` establishes strict reactive invariants:

### 1. Control-Flow Components
Raw JavaScript conditionals and loops are replaced with reactive lifecycle primitives that manage subscription teardowns automatically:
* `<Show when={state.isLoading} fallback={<Content />}>...</Show>`
* `<For each={state.tasks} key="id">{(task) => <TaskItem task={task} />}</For>`
* `<Portal target="#modal-root">...</Portal>`
* `<ErrorBoundary fallback={(err) => <ErrorView error={err} />}>...</ErrorBoundary>`

### 2. Async Actions & Race-Condition Defense
Actions natively support asynchronous workflows and auto-injected `AbortSignal`s to cancel stale in-flight requests on rapid user triggers:
```typescript
actions: {
  loadData: async ({ state, signal }, query: string) => {
    state.status = 'loading';
    try {
      const result = await api.search(query, { signal });
      state.data = result;
      state.status = 'ready';
    } catch (err: any) {
      if (signal.aborted) return;
      state.status = 'error';
    }
  }
}
```

---

## 4. MCP Security & Workspace Boundaries

Because the protocol grants agents introspection and mutation capabilities, security is enforced at the protocol layer:
1. **Workspace Boundary Guard**: All file paths are strictly jailed within the project root; directory traversal (`..`) is hard-blocked.
2. **Secret Leak Interceptor**: The protocol blocks commits or disk writes containing hardcoded credentials or API secrets.
3. **Execution Jails**: Prevents arbitrary shell execution through MCP tool parameters.

---

## 5. Summary

`agent-dom` is not just another reactive frontend library. It is an **open standard and execution engine** where human developers and autonomous AI agents collaborate over an interface with complete determinism, instant verification, and zero context waste.
