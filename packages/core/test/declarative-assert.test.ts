import { describe, it, expect } from 'vitest';
import { defineComponent, hotReloadComponent } from '../src/component.js';
import { testAction } from '../src/testing.js';
import { z } from 'zod';

describe('Declarative Assertions in testAction', () => {
  const Counter = defineComponent({
    id: 'test-counter',
    state: {
      count: z.number().default(0),
      label: z.string().default('items'),
    },
    actions: {
      inc: (s, amount = 1) => ({ ...s, count: s.count + amount }),
      setLabel: (s, label: string) => ({ ...s, label }),
    },
    render: ({ state }) => ({
      type: 'div',
      props: { 'data-agent-id': 'root' },
      children: [`Count: ${state.count} ${state.label}`],
    }),
  });

  it('passes when expected state matches exactly', async () => {
    const inst = Counter();
    const res = await testAction(inst, 'inc', 5, {
      expect: { count: 5, label: 'items' },
    });
    expect(res.status).toBe('passed');
    expect(res.diff.count).toEqual({ before: 0, after: 5 });
    expect(res.assertionMismatch).toBeUndefined();
  });

  it('fails with structured mismatch when expected state does not match', async () => {
    const inst = Counter();
    const res = await testAction(inst, 'inc', 2, {
      expect: { count: 10 },
    });
    expect(res.status).toBe('failed');
    expect(res.assertionMismatch).toBeDefined();
    expect(res.assertionMismatch?.key).toBe('count');
    expect(res.assertionMismatch?.expected).toBe(10);
    expect(res.assertionMismatch?.received).toBe(2);
    expect(res.error).toContain("Assertion mismatch: expected count=10, received 2");
  });

  it('supports custom assert function', async () => {
    const inst = Counter();
    const res = await testAction(inst, 'inc', 1, {
      assert: (state) => state.count > 0 || 'Count must be positive',
    });
    expect(res.status).toBe('passed');

    const failedRes = await testAction(inst, 'inc', 1, {
      assert: (state) => state.count > 100 || 'Count must exceed 100',
    });
    expect(failedRes.status).toBe('failed');
    expect(failedRes.error).toBe('Count must exceed 100');
  });

  it('hotReloadComponent preserves existing state while updating actions', async () => {
    const inst = Counter();
    await testAction(inst, 'inc', 42);
    expect(inst.state.count).toBe(42);

    // Hot-reload with modified multiplier
    const UpdatedCounter = defineComponent({
      id: 'test-counter',
      state: {
        count: z.number().default(0),
        label: z.string().default('items'),
      },
      actions: {
        inc: (s, amount = 1) => ({ ...s, count: s.count + amount * 10 }),
      },
      render: ({ state }) => ({
        type: 'div',
        props: { 'data-agent-id': 'root' },
        children: [`Hot: ${state.count}`],
      }),
    });

    const reloaded = hotReloadComponent('test-counter', UpdatedCounter);
    expect(reloaded).toBe(inst);
    // Preserved prior state
    expect(reloaded?.state.count).toBe(42);

    // Runs new logic
    await testAction(reloaded!, 'inc', 2);
    expect(reloaded?.state.count).toBe(62); // 42 + 2 * 10 = 62
  });
});
