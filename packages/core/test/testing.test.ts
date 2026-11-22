import { describe, it, expect } from 'vitest';
import { defineComponent, z, testAction } from '../src/index.js';

describe('Component-Level Testing API (Instant 5ms Verification)', () => {
  const CounterApp = defineComponent({
    id: 'test-counter',
    state: {
      count: z.number().default(0),
      label: z.string().default('Active'),
    },
    actions: {
      increment: (s) => ({ ...s, count: s.count + 1 }),
      setLabel: (s, label: string) => ({ ...s, label }),
      asyncIncrement: async ({ state }) => {
        state.count = state.count + 10;
      },
    },
    render: () => ({ type: 'div', props: {}, children: [] }),
  });

  it('tests synchronous actions and returns structured state diff', async () => {
    const instance = CounterApp();

    const result = await testAction(instance, 'increment');
    expect(result.status).toBe('passed');
    expect(result.componentId).toBe('test-counter');
    expect(result.action).toBe('increment');
    expect(result.diff).toEqual({
      count: { before: 0, after: 1 },
    });
    expect(result.durationMs).toBeLessThan(50);
  });

  it('tests actions with payloads and tracks specific field changes', async () => {
    const instance = CounterApp();

    const result = await testAction(instance, 'setLabel', 'Completed');
    expect(result.status).toBe('passed');
    expect(result.diff).toEqual({
      label: { before: 'Active', after: 'Completed' },
    });
  });

  it('tests async actions in memory without browser launch', async () => {
    const instance = CounterApp();

    const result = await testAction(instance, 'asyncIncrement');
    expect(result.status).toBe('passed');
    expect(result.diff).toEqual({
      count: { before: 0, after: 10 },
    });
  });

  it('gracefully reports failure when action does not exist', async () => {
    const instance = CounterApp();

    const result = await testAction(instance, 'nonExistentAction');
    expect(result.status).toBe('failed');
    expect(result.error).toContain("Action 'nonExistentAction' not defined");
    expect(result.error).toContain('increment, setLabel, asyncIncrement');
  });
});
