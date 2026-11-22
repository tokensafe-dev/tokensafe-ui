import { describe, it, expect } from 'vitest';
import { defineComponent, z } from '../src/index.js';

describe('Actions vs Effects Architecture & Concurrency Policies', () => {
  it('executes pure synchronous actions and rejects promise-returning actions in actions block', () => {
    const Component = defineComponent({
      id: 'pure-calc',
      state: {
        val: z.number().default(0),
      },
      actions: {
        add: (s, amount: number) => ({ ...s, val: s.val + amount }),
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    const instance = Component();
    expect(instance.state.val).toBe(0);

    instance.dispatch('add', 5);
    expect(instance.state.val).toBe(5);

    instance.emit.add(10);
    expect(instance.state.val).toBe(15);
  });

  it('supports latest-wins concurrency policy in effects', async () => {
    const callOrder: string[] = [];
    const abortedCalls: string[] = [];

    const SearchComponent = defineComponent({
      id: 'search-box',
      state: {
        query: z.string().default(''),
        result: z.string().default(''),
      },
      actions: {
        setResult: (s, result: string) => ({ ...s, result }),
      },
      effects: {
        search: {
          concurrency: 'latest-wins',
          handler: async ({ dispatch, signal }, query: string) => {
            callOrder.push(`start:${query}`);
            await new Promise((r) => setTimeout(r, 40));
            if (signal.aborted) {
              abortedCalls.push(query);
              return;
            }
            dispatch('setResult', `Result for ${query}`);
            callOrder.push(`finish:${query}`);
          },
        },
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    const instance = SearchComponent();
    const p1 = instance.emit.search('first');
    const p2 = instance.emit.search('second');

    await Promise.all([p1, p2]);

    expect(abortedCalls).toContain('first');
    expect(instance.state.result).toBe('Result for second');
    expect(callOrder).toContain('finish:second');
    expect(callOrder).not.toContain('finish:first');
  });

  it('supports take-leading concurrency policy in effects', async () => {
    const executed: string[] = [];

    const SubmitComponent = defineComponent({
      id: 'submit-form',
      state: {
        status: z.string().default('idle'),
      },
      actions: {
        setStatus: (s, status: string) => ({ ...s, status }),
      },
      effects: {
        submit: {
          concurrency: 'take-leading',
          handler: async ({ dispatch }, id: string) => {
            executed.push(id);
            dispatch('setStatus', 'submitting');
            await new Promise((r) => setTimeout(r, 30));
            dispatch('setStatus', 'done');
          },
        },
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    const instance = SubmitComponent();
    const p1 = instance.emit.submit('req-1');
    const p2 = instance.emit.submit('req-2'); // should be dropped!

    await Promise.all([p1, p2]);

    expect(executed).toEqual(['req-1']);
    expect(instance.state.status).toBe('done');
  });

  it('supports queue concurrency policy in effects', async () => {
    const log: string[] = [];

    const QueueComponent = defineComponent({
      id: 'queue-app',
      state: {
        counter: z.number().default(0),
      },
      actions: {
        inc: (s) => ({ ...s, counter: s.counter + 1 }),
      },
      effects: {
        logItem: {
          concurrency: 'queue',
          handler: async ({ dispatch }, msg: string) => {
            log.push(`start:${msg}`);
            await new Promise((r) => setTimeout(r, 20));
            dispatch('inc');
            log.push(`end:${msg}`);
          },
        },
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    const instance = QueueComponent();
    const p1 = instance.emit.logItem('A');
    const p2 = instance.emit.logItem('B');

    await Promise.all([p1, p2]);

    expect(log).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
    expect(instance.state.counter).toBe(2);
  });

  it('abortAll cancels all active effects on demand', async () => {
    let wasAborted = false;

    const App = defineComponent({
      id: 'cancel-app',
      state: { val: z.string().default('') },
      actions: {},
      effects: {
        longTask: async ({ signal }) => {
          await new Promise((r) => setTimeout(r, 50));
          if (signal.aborted) {
            wasAborted = true;
          }
        },
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    const instance = App();
    const taskPromise = instance.emit.longTask();
    instance.abortAll();

    await taskPromise;
    expect(wasAborted).toBe(true);
  });
});
