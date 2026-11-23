import { describe, it, expect } from 'vitest';
import { defineComponent } from '../src/component.js';
import { testEffect } from '../src/testing.js';
import { z } from 'zod';

describe('testEffect Telemetry & Concurrency Testing', () => {
  const AsyncComponent = defineComponent({
    id: 'test-async-box',
    state: {
      status: z.enum(['idle', 'loading', 'success', 'error']).default('idle'),
      data: z.string().nullable().default(null),
    },
    actions: {
      setStatus: (s, status: any) => ({ ...s, status }),
      setData: (s, data: string) => ({ ...s, data, status: 'success' }),
    },
    effects: {
      fetchItem: {
        concurrency: 'latest-wins',
        handler: async ({ dispatch, signal, state }, payload: { text: string; delay?: number }) => {
          dispatch('setStatus', 'loading');
          await new Promise((r) => setTimeout(r, payload.delay || 20));
          if (!signal.aborted) {
            dispatch('setData', payload.text);
          }
        },
      },
    },
    render: ({ state }) => ({
      type: 'div',
      props: { 'data-agent-id': 'root' },
      children: [`Status: ${state.status}`],
    }),
  });

  it('executes effect, records dispatched actions and state transitions', async () => {
    const inst = AsyncComponent();
    const res = await testEffect(inst, 'fetchItem', {
      payload: { text: 'Hello OUMV', delay: 10 },
      expectDispatched: [
        { action: 'setStatus', payload: 'loading' },
        { action: 'setData', payload: 'Hello OUMV' },
      ],
      expect: {
        status: 'success',
        data: 'Hello OUMV',
      },
    });

    expect(res.status).toBe('passed');
    expect(res.dispatchedActions.length).toBe(2);
    expect(res.dispatchedActions[0].action).toBe('setStatus');
    expect(res.dispatchedActions[1].action).toBe('setData');
    expect(res.diff.data).toEqual({ before: null, after: 'Hello OUMV' });
  });

  it('fails if expected dispatched action was missing', async () => {
    const inst = AsyncComponent();
    const res = await testEffect(inst, 'fetchItem', {
      payload: { text: 'Test', delay: 10 },
      expectDispatched: [{ action: 'nonExistentAction' }],
    });

    expect(res.status).toBe('failed');
    expect(res.error).toContain("Expected action 'nonExistentAction' was not dispatched");
  });

  it('fails with timeout if effect takes longer than timeoutMs', async () => {
    const inst = AsyncComponent();
    const res = await testEffect(inst, 'fetchItem', {
      payload: { text: 'Slow', delay: 200 },
      timeoutMs: 30,
    });

    expect(res.status).toBe('failed');
    expect(res.error).toContain('timed out after 30ms');
  });
});
