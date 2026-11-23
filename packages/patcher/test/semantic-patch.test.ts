import { describe, it, expect } from 'vitest';
import { applyPatch, patchComponent } from '../src/patcher.js';

describe('Semantic AST Patcher - update_action and update_render', () => {
  const sampleComponent = `import { defineComponent, z } from 'tokensafe-ui';

export const TaskItem = defineComponent({
  id: 'task-item',
  state: {
    count: z.number().default(0),
  },
  actions: {
    inc: (s) => ({ ...s, count: s.count + 1 }),
  },
  render: ({ state }) => (
    <div data-agent-id="root">
      <span>{state.count}</span>
    </div>
  ),
});
`;

  it('updates an existing action using update_action without line drift', () => {
    const res = patchComponent(sampleComponent, {
      op: 'update_action',
      componentId: 'task-item',
      name: 'inc',
      code: '(s, amount = 10) => ({ ...s, count: s.count + amount })',
    });

    expect(res.success).toBe(true);
    expect(res.code).toContain('inc: (s, amount = 10) => ({');
    expect(res.code).toContain('count: s.count + amount');
    // Still valid syntax
    expect(res.code).toContain('id: \'task-item\'');
  });

  it('updates the render function using update_render', () => {
    const res = applyPatch(sampleComponent, {
      op: 'update_render',
      componentId: 'task-item',
      code: '({ state }) => <div data-agent-id="root"><strong>Count: {state.count}</strong></div>',
    });

    expect(res.success).toBe(true);
    expect(res.code).toContain('<strong>Count: {state.count}</strong>');
  });
});
