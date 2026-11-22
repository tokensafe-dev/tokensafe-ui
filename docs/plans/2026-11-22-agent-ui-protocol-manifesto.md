# The Agent-UI Protocol Manifesto: OUMV Architecture (v0.3 Specification)

**Date**: 2026-11-22  
**Status**: Adopted Specification & Architecture Standard  
**Runtime Repository**: [github.com/tokensafe-dev/tokensafe-ui](https://github.com/tokensafe-dev/tokensafe-ui)  
**Protocol Repository**: [github.com/tokensafe-dev/oumv](https://github.com/tokensafe-dev/oumv)

---

## 1. The Core Philosophy

> **"Do not try to build a framework that is merely easier for AI agents to write.  
> Build a framework where an AI agent can Observe, Understand, Mutate, and Verify the interface through a standardized protocol."**

Competing with React or Vue on JSX authoring alone is a dead end—LLMs already possess vast training on standard web syntax. The fundamental breakthrough is creating an **isomorphic reactive substrate and an independent protocol** that closes the feedback loop between the autonomous agent and the running interface.

The core of `agent-dom` is the **OUMV Protocol**:

$$\mathbf{Observe} \longrightarrow \mathbf{Understand} \longrightarrow \mathbf{Mutate} \longrightarrow \mathbf{Verify}$$

---

## 2. Decoupled Protocol Architecture

OUMV is an independent protocol layer that can interface with multiple frontend runtimes:

```text
       AI Coding Agent (Claude Code / Codex / Antigravity)
                             │
                             ▼
               [ OUMV Protocol Specification ]
        (Observe · Understand · Mutate · Verify Interfaces)
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [ agent-dom Adapter ]             [ React Adapter ]
            │                                 │
     agent-dom Runtime                  React + Hooks
```

---

## 3. The Four Pillars of OUMV

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

### Pillar 3: MUTATE (Symbol-Level Edits with Optimistic Concurrency Control)

AST micro-patching (`insert_jsx`) is fragile for complex feature additions and refactorings. `agent-dom` adopts **Symbol-Level Source Editing** combined with **Optimistic Concurrency Control (OCC)**:

1. **Symbol-Level Source Retrieval**:
   - The agent retrieves the component's exact boundaries and content hash via `get_component_source(id)`.
   - The response includes a concurrency token: `version: "sha256:..."`.
2. **Optimistic Concurrency & Atomic Writes**:
   - The agent submits standard TypeScript edits along with `expectedVersion`.
   - If human developers or other background workers touched the file concurrently, the edit is rejected safely without data loss.
   - **Post-Edit Type Guard & Rollback**: The compiler immediately runs isolated type-checking (`tsc --noEmit`) and auto-formatting. If syntax or types fail, an atomic rollback restores the file, and the agent receives a precise diagnostics payload before the dev server crashes.
3. **Runtime Ephemeral Sandbox**:
   - The agent can trigger actions and test state transitions in memory (`agent_dom_dispatch`) before committing edits to disk.

---

### Pillar 4: VERIFY (Local Low-Millisecond Multi-Metric Verification)

Rather than setting unrealistic blanket latency claims (such as "always under 5ms" regardless of tree complexity), `agent-dom` promises:
> **"Sub-millisecond to low-millisecond synchronous action verification for lightweight components."**

The testing engine breaks down execution time across 5 telemetry vectors:
$$\Delta t = t_{\text{action}} + t_{\text{schema}} + t_{\text{propagation}} + t_{\text{dom}} + t_{\text{surface}}$$

* **Action Testing API**:
  The agent dispatches an action against a component and instantly receives a structured state and accessibility diff:
  ```json
  {
    "action": "toggleFilter",
    "status": "passed",
    "timings": {
      "t_action_ms": 0.42,
      "t_schema_ms": 0.18,
      "t_propagation_ms": 0.31,
      "t_dom_ms": 0.55,
      "t_total_ms": 1.46
    },
    "diff": {
      "state": {
        "filter": { "before": "all", "after": "completed" }
      },
      "surface": [
        { "op": "update", "id": "task-1", "visible": false },
        { "op": "attr", "id": "btn-filter-all", "attr": "aria-pressed", "before": "true", "after": "false" }
      ]
    }
  }
  ```
* **Contract Invariant Assertions**: Every mutation is validated against the component's Zod schema in real time.
* **Role in Full E2E Testing**: Local component verification guarantees 95% of state, logic, and a11y surface bugs are caught in single-digit milliseconds. Full end-to-end browser automation (Playwright/Puppeteer) remains the complementary standard for high-fidelity cross-page user flows and visual regression checks.

---

## 4. Actions vs Effects Architecture (Decoupled Concurrency)

Conflating pure synchronous state transformations with asynchronous, side-effectful network requests creates cognitive friction and non-deterministic agent hallucinations. `agent-dom` strictly separates **Actions** from **Effects**:

```text
 ┌─────────────────────────────────────────────────────────────┐
 │                     defineComponent                         │
 │                                                             │
 │   actions: { [name]: (state, payload) => newState }         │
 │   ──► Pure, synchronous, deterministic state reducers       │
 │                                                             │
 │   effects: { [name]: { concurrency, handler } }             │
 │   ──► Managed async workflows, network I/O, timers          │
 └─────────────────────────────────────────────────────────────┘
```

### 1. Pure Synchronous Actions (Reducers)
Actions are deterministic pure functions. Given the current state and payload, they synchronously return the next state:
```typescript
actions: {
  setFilter: (state, filter: FilterType) => ({
    ...state,
    filter,
  }),
  reset: (state) => ({
    ...state,
    count: 0,
  }),
}
```

### 2. Managed Effects with Explicit Concurrency Policies
Effects handle async I/O, cancellation, and external APIs. They cannot directly mutate state; instead, they receive `{ dispatch, signal, state }` and invoke pure actions:
```typescript
effects: {
  search: {
    concurrency: 'latest-wins', // Automatically aborts previous in-flight requests!
    handler: async ({ dispatch, signal }, query: string) => {
      dispatch('setStatus', 'loading');
      try {
        const results = await api.search(query, { signal });
        if (!signal.aborted) {
          dispatch('setResults', results);
          dispatch('setStatus', 'ready');
        }
      } catch (err: any) {
        if (!signal.aborted) {
          dispatch('setError', err.message);
          dispatch('setStatus', 'error');
        }
      }
    },
  },
}
```

#### Supported Concurrency Policies:
1. **`latest-wins` (default for search/filtering)**: Triggers an `AbortSignal` on the previous active invocation before starting the new one.
2. **`take-leading` (default for form submits/payments)**: Drops or ignores incoming triggers while an effect is already running.
3. **`queue` (default for message logs/analytics)**: Enqueues triggers to execute strictly one after another in order.
4. **`parallel` (default for independent fetches)**: Runs all invocations concurrently without cancellation or queuing.

---

## 5. Dynamic Reactive Signals Graph & Causality Engine

Static AST inspection of source code cannot account for dynamic runtime conditionals (`if (user.isAdmin)`). `agent-dom` embeds dependency tracking directly into its signal runtime:

```text
  Signal (state.email)
         │
         ▼
  Computed (isValid)
         │
         ▼
  Effect (updateSubmitState)
         │
         ▼
  DOM Binding (button#submit[disabled])
```

1. **Bidirectional Graph Introspection**:
   - Every `signal` tracks its active set of `computed` and `effect` subscribers.
   - Every `effect` tracks its active upstream signal dependencies.
2. **Runtime Causality Engine (`why_state`)**:
   When an agent asks *"Why is button#submit disabled?"*, the runtime answers deterministically:
   ```yaml
   element: button#submit
   property: disabled = true
   cause_chain:
     - element.disabled depends on computed "isFormValid"
     - computed "isFormValid" evaluates state.email and state.password
     - state.email is "" (empty string)
     - invariant failed: EmailSchema min length 5
   ```

---

## 6. Symbol-Level Mutations & OCC Versioning

To safeguard against concurrent edits and stale states:
1. **Hash Versioning**: Every component inspected via `agent_dom_get_component_source` returns a sha256 `version` hash.
2. **Atomic Compare-and-Swap**: When invoking `agent_dom_apply_source_edit`, the agent must provide `expectedVersion`. If the file was changed on disk since retrieval, the mutation fails with `CONFLICT_DETECTED`.
3. **Canonical Symlink Resolution**: All paths are resolved via `fs.realpathSync` to prevent symlink traversal attacks escaping the workspace jail.

---

## 7. AUI-Bench: Autonomous Agent UI Benchmark

To scientifically measure agent productivity and error recovery, `agent-dom` defines the **AUI-Bench** suite:

### Standardized Evaluation Scenarios:
1. **Scenario 1: Bug Fix in Nested State** (Resolve mutation error in deeply nested list items).
2. **Scenario 2: Dynamic Form Validation** (Add conditional input validation with error banner).
3. **Scenario 3: Async Search with Race Conditions** (Implement debounced search with `latest-wins` concurrency).
4. **Scenario 4: Accessibility & Keyboard Navigation** (Implement ARIA compliant listbox with keyboard focus).
5. **Scenario 5: Cross-Component Reactive Sync** (Share reactive state between Cart and Header badges).

### Comparative Metrics:
* **Token Efficiency**: Total input and output tokens consumed to complete the task.
* **Agent Iterations**: Number of Observe-Mutate-Verify cycles needed to reach passing tests.
* **First-Pass Success Rate**: Percentage of tasks solved without diagnostics failures.
* **Regression Rate**: Number of previously passing components broken by the change.
* **Agent Recovery Rate (ARR)**: Probability of the agent diagnosing and fixing its own broken edit given compiler/runtime error feedback.

---

## 8. Reactivity & Complex UI Primitives

To eliminate closure traps and memory leaks, `agent-dom` establishes strict reactive invariants:

### 1. Control-Flow Components
Raw JavaScript conditionals and loops are replaced with reactive lifecycle primitives that manage subscription teardowns automatically:
* `<Show when={state.isLoading} fallback={<Content />}>...</Show>`
* `<For each={state.tasks} key="id">{(task) => <TaskItem task={task} />}</For>`
* `<Portal target="#modal-root">...</Portal>`
* `<ErrorBoundary fallback={(err) => <ErrorView error={err} />}>...</ErrorBoundary>`

---

## 9. MCP Security & Workspace Boundaries

Because the protocol grants agents introspection and mutation capabilities, security is enforced at the protocol layer:
1. **Workspace Boundary Guard**: All file paths are strictly jailed within the project root; directory traversal (`..`) and symlink escapes are hard-blocked.
2. **Secret Leak Interceptor**: The protocol blocks commits or disk writes containing hardcoded credentials or API secrets.
3. **Execution Jails**: Prevents arbitrary shell execution through MCP tool parameters.

---

## 10. Summary

`agent-dom` is not just another reactive frontend library. It is an **open standard and execution engine** where human developers and autonomous AI agents collaborate over an interface with complete determinism, instant verification, and zero context waste.

`agent-dom` is not just another reactive frontend library. It is an **open standard and execution engine** where human developers and autonomous AI agents collaborate over an interface with complete determinism, instant verification, and zero context waste.
