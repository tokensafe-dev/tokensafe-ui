import { describe, it, expect } from 'vitest';
import { applyPatch } from '../src/index.js';

describe('@agent-dom/patcher - Surgical AST Mutations', () => {
  const initialSource = `
import { defineComponent, z } from '@agent-dom/core';

export const Counter = defineComponent({
  id: 'counter-card',
  state: {
    count: z.number().default(0),
  },
  actions: {
    increment: (s) => ({ ...s, count: s.count + 1 }),
  },
  render: ({ state, emit }) => (
    <div class="card" data-agent-id="counter-card:root">
      <span data-agent-id="counter-card:display">{state.count}</span>
      <button data-agent-id="counter-card:btn-inc" onClick={emit.increment}>+</button>
    </div>
  ),
});
`;

  it('adds a new action to actions object without rewriting whole file', () => {
    const res = applyPatch(initialSource, {
      op: 'add_action',
      componentId: 'counter-card',
      name: 'reset',
      code: '(s) => ({ ...s, count: 0 })',
    });

    expect(res.success).toBe(true);
    expect(res.code).toContain('reset: s => ({');
    expect(res.code).toContain('count: 0');
    expect(res.code).toContain('increment: s => ({');
  });

  it('adds or updates state schema field', () => {
    const res = applyPatch(initialSource, {
      op: 'update_state',
      componentId: 'counter-card',
      key: 'step',
      schemaCode: 'z.number().default(1)',
    });

    expect(res.success).toBe(true);
    expect(res.code).toContain('step: z.number().default(1)');
    expect(res.code).toContain('count: z.number().default(0)');
  });

  it('inserts a JSX node relative to target agent id', () => {
    const res = applyPatch(initialSource, {
      op: 'insert_jsx',
      targetAgentId: 'counter-card:btn-inc',
      position: 'after',
      jsxCode: '<button data-agent-id="counter-card:btn-reset">Reset</button>',
    });

    expect(res.success).toBe(true);
    expect(res.code).toContain('<button data-agent-id="counter-card:btn-reset">Reset</button>');
  });

  it('binds an event to an action on target element', () => {
    const res = applyPatch(initialSource, {
      op: 'bind_event',
      targetAgentId: 'counter-card:btn-inc',
      event: 'onDoubleClick',
      actionName: 'increment',
    });

    expect(res.success).toBe(true);
    expect(res.code).toContain('onDoubleClick={emit.increment}');
  });

  it('gracefully returns error when target is not found', () => {
    const res = applyPatch(initialSource, {
      op: 'insert_jsx',
      targetAgentId: 'non-existent:element',
      position: 'after',
      jsxCode: '<div />',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Target not found');
  });
});
