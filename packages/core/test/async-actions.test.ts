import { describe, it, expect } from 'vitest';
import { defineComponent, z } from '../src/index.js';

describe('Async Actions & AbortSignal Race-Condition Defense', () => {
  it('executes async actions and updates state upon completion', async () => {
    const AsyncApp = defineComponent({
      id: 'async-app',
      state: {
        status: z.string().default('idle'),
        data: z.string().default(''),
      },
      actions: {
        fetchData: async ({ state, signal }) => {
          state.status = 'loading';
          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (signal.aborted) return;
          state.data = 'Fetched Result';
          state.status = 'success';
        },
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    const instance = AsyncApp();
    expect(instance.state.status).toBe('idle');

    const promise = instance.emit.fetchData();
    expect(instance.state.status).toBe('loading');

    await promise;
    expect(instance.state.status).toBe('success');
    expect(instance.state.data).toBe('Fetched Result');

    // Verify telemetry
    expect(instance.runtimeLog.some((e) => e.actionName === 'fetchData' && e.type === 'action_start')).toBe(true);
    expect(instance.runtimeLog.some((e) => e.actionName === 'fetchData' && e.type === 'action_end')).toBe(true);
  });

  it('aborts previous in-flight invocation when triggered rapidly', async () => {
    const abortedSignals: boolean[] = [];

    const SearchApp = defineComponent({
      id: 'search-app',
      state: {
        query: z.string().default(''),
        result: z.string().default(''),
      },
      actions: {
        search: async ({ state, signal }, query: string) => {
          state.query = query;
          await new Promise((resolve) => setTimeout(resolve, 30));
          abortedSignals.push(signal.aborted);
          if (signal.aborted) return;
          state.result = `Result for ${query}`;
        },
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    const instance = SearchApp();

    // Trigger call 1
    const p1 = instance.emit.search('first');
    // Trigger call 2 almost immediately (should abort call 1!)
    const p2 = instance.emit.search('second');

    await Promise.all([p1, p2]);

    // First call should have had signal.aborted === true
    expect(abortedSignals[0]).toBe(true);
    // Second call should NOT be aborted
    expect(abortedSignals[1]).toBe(false);
    // State reflects the second call only
    expect(instance.state.result).toBe('Result for second');
  });
});
