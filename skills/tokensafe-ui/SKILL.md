---
name: tokensafe-ui
description: "Author reactive web interfaces and inspect, mutate, and verify UI components using the tokensafe-ui micro-framework, React/Vue OUMV protocol adapters, and OUMV MCP server. Trigger on: 'tokensafe-ui', 'agent-dom', 'reactive components', 'UI mutation', 'test action', 'defineComponent', 'OUMV UI', 'React adapter', 'Vue adapter', 'Zustand adapter', 'Redux adapter', 'useReducer adapter', 'React Context adapter', 'build component'."
---

# TokenSafe-UI Skill Guide

`tokensafe-ui` is the native reactive micro-framework and universal **OUMV Protocol** runtime designed specifically for autonomous AI coding agents. It implements the OUMV Protocol (Observe, Understand, Mutate, Verify) to close the feedback loop between the agent and running interfaces with zero context waste (<100 tokens per inspection) and single-digit millisecond local verification across native components, React (18/19), and Vue.

---

## 1. Core Component Contract (`defineComponent`)

Every component is defined via `defineComponent` with four distinct, decoupled sections:

```typescript
import { defineComponent, z } from 'tokensafe-ui';

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

## 2. Glitch-Free Reactive Substrate (`signals`, `batch`, `untrack`, `scopes`)

`tokensafe-ui` includes an internal glitch-free topological reactive scheduler with automatic memory disposal:

```typescript
import { signal, computed, effect, batch, untrack, createScope, createRoot } from 'tokensafe-ui';

// 1. Signals & Computeds with Diamond Dependency Glitch-Free Ordering
const count = signal(0);
const double = computed(() => count.value * 2);

// 2. Atomic Multi-field Transactions with batch()
batch(() => {
  count.value = 10;
  // Observers only run ONCE after all mutations in the batch complete
});

// 3. Untracked reads (telemetry, logging) without creating subscriptions
effect(() => {
  const current = count.value;
  const meta = untrack(() => debugSignal.value);
});

// 4. Reactive Ownership Tree (Auto-cleanup to prevent memory leaks)
const scope = createScope((dispose) => {
  const tempComputed = computed(() => count.value * 10);
  effect(() => console.log(tempComputed.value));
});
scope.dispose(); // Instantly frees all child subscriptions and computeds
```

---

## 3. Integration with Existing React & Vue Projects (Zero Rewrite)

**Do NOT rewrite existing React or Vue projects.** Use the official OUMV protocol adapters to give coding agents 100% inspection, mutation, and verification capabilities.

### 3.1 React Integration (`tokensafe-ui/react`)

Supports **Zustand**, **Redux**, **useReducer**, and **React Context** with automatic action discovery and live trace subscriptions:

```typescript
import {
  createReactAdapter,
  connectZustand,
  connectRedux,
  connectReducer,
  connectContext,
} from 'tokensafe-ui/react';
import { useCartStore } from './stores/cartStore';
import { store as reduxStore } from './stores/authStore';

if (process.env.NODE_ENV === 'development') {
  (window as any).__OUMV_ADAPTER__ = createReactAdapter({
    rootElement: document.getElementById('root')!,

    // 1. External stores (auto-discovery of state & actions + L4 trace updates)
    stores: {
      cart: useCartStore,          // Zustand: auto-discovers functions as actions
      auth: reduxStore,            // Redux: dispatch & action creators mapped
      counterReducer: [state, dispatch], // useReducer tuple
    },

    // 2. React Context values (state properties & updater functions)
    contexts: {
      session: sessionContextValue, // auto-extracts state and updaters
    },
  });
}
```

### 3.2 Vue Integration (`tokensafe-ui/vue`)

```typescript
import { createVueAdapter } from 'tokensafe-ui/vue';

if (process.env.NODE_ENV === 'development') {
  (window as any).__OUMV_ADAPTER__ = createVueAdapter({
    rootElement: document.getElementById('app')!,
    components: {
      todoApp: {
        id: 'todo-app',
        name: 'TodoApp',
        filePath: 'src/components/TodoApp.vue',
      },
    },
  });
}
```

---

## 4. The Golden OUMV Agent Workflow

When asked to inspect, debug, modify, or extend a `tokensafe-ui`, React, or Vue interface, ALWAYS execute the 4-step OUMV loop using MCP tools:

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

### 4.1 High-Velocity Turn Folding (`tokensafe_batch_mutate_verify`)
To achieve ~18x–20x AER (Agent Efficiency Ratio), execute mutation and verification in a single turn:
```json
{
  "filePath": "src/components/Cart.tsx",
  "componentId": "cart",
  "source": "<updated code>",
  "expectedVersion": "sha256:...",
  "verifyActions": ["addItem", "clear"]
}
```
Commits to disk only if verifications pass!

---

## 5. Strict Rules & Anti-Patterns

1. **Do NOT Rewrite Existing React/Vue Code**:
   Use `tokensafe-ui/react` or `tokensafe-ui/vue` with Zustand/Redux/Context/useReducer connectors.
2. **NO Side-Effects in `actions`** (Native Components):
   `actions` MUST be pure synchronous state reducers `(state, payload) => newState`. Network requests, timers, and storage MUST be placed under `effects`.
3. **NO Blind File Overwriting**:
   Always retrieve the source version via `tokensafe_get_component_source` and mutate through `tokensafe_apply_source_edit(expectedVersion)` to prevent race conditions.
4. **Mandatory `data-agent-id`**:
   Every actionable element and component root should have `data-agent-id="<component-id>:<element-name>"`.

---

## 6. MCP Server Configuration

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
