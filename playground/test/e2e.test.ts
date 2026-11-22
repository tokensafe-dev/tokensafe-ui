import { describe, it, expect } from 'vitest';
import { mount, renderToString } from 'tokensafe-ui';
import { getSemanticSnapshot } from 'tokensafe-ui/observer';
import { applyPatch } from 'tokensafe-ui/patcher';
import { TaskBoard } from '../src/App.js';

describe('agent-dom End-to-End Agent Loop', () => {
  it('executes full Agent-to-UI perception, mutation, and verification cycle', () => {
    // 1. Initial Mount & SSR
    const instance = TaskBoard();
    const container = document.createElement('div');
    mount(instance, container);

    const ssrOutput = renderToString(instance);
    expect(ssrOutput).toContain('data-agent-id="task-board:root"');
    expect(ssrOutput).toContain('<script id="__AGENT_DOM_STATE__"');

    // 2. Agent Perception (Vision Snapshot < 100 tokens)
    const snapshot = getSemanticSnapshot(container.firstElementChild as HTMLElement) as string;
    expect(snapshot).toContain('view: task-board');
    expect(snapshot).toContain('state: {"title":"agent-dom Tasks","count":0,"status":"Active"}');
    expect(snapshot).toContain('button#task-board:btn-inc [action: increment]: "+ Add Task"');

    // Verify token budget
    const tokens = snapshot.split(/\s+/).length;
    expect(tokens).toBeLessThan(100);

    // 3. User interaction simulation
    instance.emit.increment();
    instance.emit.increment();
    expect(instance.state.count).toBe(2);

    const updatedSnapshot = getSemanticSnapshot(container.firstElementChild as HTMLElement) as string;
    expect(updatedSnapshot).toContain('"count":2');

    // 4. Agent Hands (Surgical AST patch to add 'completeAll' action & button)
    const sourceCode = `
import { defineComponent, z, h } from 'tokensafe-ui';

export const TaskBoard = defineComponent({
  id: 'task-board',
  state: {
    title: z.string().default('agent-dom Tasks'),
    count: z.number().default(0),
    status: z.string().default('Active'),
  },
  actions: {
    increment: (s) => ({ ...s, count: s.count + 1 }),
  },
  render: ({ state, emit }) => (
    <div class="task-board" data-agent-id="task-board:root">
      <button data-agent-id="task-board:btn-inc" onClick={emit.increment}>+</button>
    </div>
  ),
});
`;

    // Apply action patch
    const patchActionRes = applyPatch(sourceCode, {
      op: 'add_action',
      componentId: 'task-board',
      name: 'completeAll',
      code: '(s) => ({ ...s, status: "All Done" })',
    });
    expect(patchActionRes.success).toBe(true);
    expect(patchActionRes.code).toContain('completeAll: s => ({');

    // Apply JSX insertion patch
    const patchJsxRes = applyPatch(patchActionRes.code, {
      op: 'insert_jsx',
      targetAgentId: 'task-board:btn-inc',
      position: 'after',
      jsxCode: '<button data-agent-id="task-board:btn-done" onClick={emit.completeAll}>Finish</button>',
    });
    expect(patchJsxRes.success).toBe(true);
    expect(patchJsxRes.code).toContain('data-agent-id="task-board:btn-done"');
    expect(patchJsxRes.code).toContain('onClick={emit.completeAll}');
  });
});
