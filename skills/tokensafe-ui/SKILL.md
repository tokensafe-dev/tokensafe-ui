---
name: tokensafe-ui
description: "Author reactive web interfaces and inspect, mutate, and verify UI components using the tokensafe-ui micro-framework and OUMV MCP server. Trigger on: 'tokensafe-ui', 'agent-dom', 'reactive components', 'UI mutation', 'test action', 'defineComponent', 'OUMV UI', 'build component'."
---

# TokenSafe-UI Skill Guide

`tokensafe-ui` is the native reactive micro-framework designed specifically for autonomous AI coding agents. It implements the **OUMV Protocol** (Observe, Understand, Mutate, Verify) to close the feedback loop between the agent and the running interface with zero context waste (<100 tokens per inspection) and single-digit millisecond local verification.

---

## 1. Core Component Contract (`defineComponent`)

Every component is defined via `defineComponent` with four distinct, decoupled sections:

```typescript
import { defineComponent, z } from '@agent-dom/core';

export const TaskItem = defineComponent({
  id: 'task-item',

  // 1. Explicit State Contract (validated via Zod)
  state: {
    id: z.string(),
    title: z.string(),
    completed: z.boolean().default(false),
    status: z.enum(['idle', 'saving', 'saved', 'error']).default('idle'),
  },

  // 2. Pure Synchronous Actions (Deterministic reducers: (state, payload) => newState)
  actions: {
    toggle: (s) => ({ ...s, completed: !s.completed }),
    rename: (s, title: string) => ({ ...s, title }),
    setStatus: (s, status: 'idle' | 'saving' | 'saved' | 'error') => ({ ...s, status }),
  },

  // 3. Managed Effects (Decoupled async workflows with concurrency policies)
  effects: {
    save: {
      concurrency: 'latest-wins', // 'latest-wins' | 'take-leading' | 'queue' | 'parallel'
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

  // 4. Pure Reactive Projection (No closures, fine-grained signal subscriptions)
  render: ({ state, emit }) => (
    <div class="task-card" data-agent-id="task-item:root">
      <input
        type="checkbox"
        data-agent-id="task-item:checkbox"
        checked={state.completed}
        onChange={emit.toggle}
      />
      <span
        data-agent-id="task-item:title"
        class={state.completed ? 'completed' : ''}
      >
        {state.title}
      </span>
      <button
        data-agent-id="task-item:btn-save"
        onClick={emit.save}
        disabled={state.status === 'saving'}
      >
        {state.status === 'saving' ? 'Saving...' : 'Save'}
      </button>
    </div>
  ),
});
```

### 1.1 Concurrency Policies for Effects
- **`latest-wins`** *(default)*: Aborts any active in-flight request when triggered again (ideal for search inputs, debounced filters).
- **`take-leading`**: Drops subsequent invocations while one is in-flight (ideal for form submissions, payments).
- **`queue`**: Queues triggers sequentially in FIFO order (ideal for message queues, activity logs).
- **`parallel`**: Runs invocations concurrently without cancellation.

### 1.2 Control-Flow Primitives
Never use raw JS array mapping or ternaries that break fine-grained subscriptions. Use reactive lifecycle primitives:
- `<Show when={state.isLoading} fallback={<Content />}>...</Show>`
- `<For each={state.tasks} key="id">{(task) => <TaskItem task={task} />}</For>`
- `<ErrorBoundary fallback={(err) => <ErrorView error={err} />}>...</ErrorBoundary>`

---

## 2. The Golden OUMV Agent Workflow

When asked to inspect, debug, modify, or extend a `tokensafe-ui` interface, ALWAYS execute the 4-step OUMV loop using MCP tools:

```text
 1. OBSERVE       ──► Query agent_dom_observe(level: 'L1')
                       Focused interactive map (<150 tokens)
 2. UNDERSTAND    ──► Query agent_dom_understand(query: 'causality' | 'impact')
                       Trace causality ("Why is button disabled?")
 3. MUTATE        ──► agent_dom_get_component_source -> get version sha256
                       agent_dom_apply_source_edit(expectedVersion)
 4. VERIFY        ──► agent_dom_test_action(componentId, action)
                       Local sub-millisecond state & surface diff verification
```

### Step 1: OBSERVE
- Do NOT read raw HTML or grep source code.
- Call `agent_dom_observe`:
  - `level: 'L0'` (~20 tokens): Active route, mounted components, errors.
  - `level: 'L1'` (~100–150 tokens): Interactive surface (buttons, inputs, roles, triggers).
  - `level: 'L2'` (~80 tokens): Component contract, Zod schema, available actions/effects.

### Step 2: UNDERSTAND
- If an element is unexpectedly disabled or state is incorrect:
  Call `agent_dom_understand(query: 'causality', target: '<componentId>.<stateKey>')`.
  The runtime causality engine traces:
  $$\text{Signal} \longrightarrow \text{Computed} \longrightarrow \text{Effect} \longrightarrow \text{DOM Binding}$$
- Before modifying shared state:
  Call `agent_dom_understand(query: 'impact', target: '<stateKey>')` to discover dependent components.

### Step 3: MUTATE with Optimistic Concurrency Control (OCC)
- Step 3.1: Call `agent_dom_get_component_source(componentId, filePath)`.
  Extract the concurrency token: `version: "sha256:..."`.
- Step 3.2: Perform isolated TypeScript edits.
- Step 3.3: Call `agent_dom_apply_source_edit`:
  ```json
  {
    "filePath": "src/TaskItem.tsx",
    "source": "<full updated source>",
    "expectedVersion": "sha256:..."
  }
  ```
  If another process edited the file, it safely aborts with `CONFLICT_DETECTED`. Pre-flight AST syntax guards prevent saving syntax errors.

### Step 4: VERIFY
- Never launch heavy, slow browser automation (Playwright/Puppeteer) for state transitions.
- Call `agent_dom_test_action`:
  ```json
  {
    "componentId": "task-item",
    "action": "toggle"
  }
  ```
- Receive structured state diffs (`diff`), accessibility surface diffs (`surfaceDiff`), and 5-metric timing breakdowns in <2ms.

---

## 3. Strict Rules & Anti-Patterns

1. **NO React Hooks (`useState`, `useEffect`, `useCallback`)**:
   `tokensafe-ui` uses fine-grained signals. State is declared in the `state` schema, and read via `state.<key>`.
2. **NO Side-Effects in `actions`**:
   `actions` MUST be pure synchronous state reducers `(state, payload) => newState`. Network requests, timers, and storage MUST be placed under `effects`.
3. **NO Blind File Overwriting**:
   Always retrieve the source version via `agent_dom_get_component_source` and mutate through `agent_dom_apply_source_edit(expectedVersion)`.
4. **Mandatory `data-agent-id`**:
   Every actionable element and component root must have `data-agent-id="<component-id>:<element-name>"`.

---

## 4. MCP Server Configuration

To connect your coding agent to the `tokensafe-ui` MCP server, add to your MCP settings (`claude_desktop_config.json`, Antigravity `mcp.json`, or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "tokensafe-ui": {
      "command": "node",
      "args": ["packages/mcp/dist/index.cjs"],
      "env": {
        "PORT": "5173"
      }
    }
  }
}
```
