import { describe, it, expect, vi } from 'vitest';
import {
  signal,
  computed,
  effect,
  batch,
  untrack,
  createRoot,
  createScope,
  onCleanup,
  defineComponent,
  z,
  mount,
  unmount,
  h,
  Show,
  For,
} from '../src/index.js';

describe('Advanced Reactive Scheduler, Scopes & Topological Ordering', () => {
  describe('1. Topological Ordering & Diamond Glitch-Free Execution', () => {
    it('guarantees glitch-free execution in a classic diamond graph (Source -> A, B -> C -> Effect)', () => {
      const source = signal(1, { name: 'source' });

      // Computed A: double
      const compA = computed(() => source.value * 2, { name: 'compA' });
      // Computed B: triple
      const compB = computed(() => source.value * 3, { name: 'compB' });

      // Computed C depends on both A and B
      const intermediateStates: Array<{ a: number; b: number; sum: number }> = [];
      const compC = computed(() => {
        const a = compA.value;
        const b = compB.value;
        const sum = a + b;
        intermediateStates.push({ a, b, sum });
        return sum;
      }, { name: 'compC' });

      const effectSpy = vi.fn();
      effect(() => {
        effectSpy(compC.value);
      });

      // Initial evaluation: source=1, A=2, B=3, C=5
      expect(compC.value).toBe(5);
      expect(effectSpy).toHaveBeenCalledTimes(1);
      expect(effectSpy).toHaveBeenLastCalledWith(5);
      expect(intermediateStates).toEqual([{ a: 2, b: 3, sum: 5 }]);

      intermediateStates.length = 0;

      // Mutate source: source=10 -> A should be 20, B should be 30, C should be 50
      // In a glitched system without topological ordering, C might evaluate with (A=20, B=3, sum=23)
      // or (A=2, B=30, sum=32) before evaluating with (A=20, B=30, sum=50).
      source.value = 10;

      expect(compC.value).toBe(50);
      expect(effectSpy).toHaveBeenCalledTimes(2);
      expect(effectSpy).toHaveBeenLastCalledWith(50);

      // Verify C evaluated EXACTLY ONCE with fully synchronized dependencies
      expect(intermediateStates).toHaveLength(1);
      expect(intermediateStates[0]).toEqual({ a: 20, b: 30, sum: 50 });
    });

    it('handles nested multi-tier diamond graphs without glitches', () => {
      // Tier 0: Root
      const root = signal(1);

      // Tier 1
      const t1_a = computed(() => root.value + 1); // 2 -> 11
      const t1_b = computed(() => root.value + 2); // 3 -> 12

      // Tier 2
      const t2_a = computed(() => t1_a.value * 2); // 4 -> 22
      const t2_b = computed(() => t1_b.value * 3); // 9 -> 36

      // Tier 3: Convergence
      const valuesSeen: number[] = [];
      const finalComp = computed(() => {
        const val = t2_a.value + t2_b.value;
        valuesSeen.push(val);
        return val;
      });

      const spy = vi.fn();
      effect(() => {
        spy(finalComp.value);
      });

      expect(spy).toHaveBeenLastCalledWith(13); // 4 + 9 = 13
      expect(valuesSeen).toEqual([13]);

      valuesSeen.length = 0;
      root.value = 10;

      expect(finalComp.value).toBe(58); // 22 + 36 = 58
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith(58);
      // Evaluated only once without any intermediate transient state
      expect(valuesSeen).toEqual([58]);
    });
  });

  describe('2. Computed Disposal & Lifecycle Management', () => {
    it('explicitly disposes computed signals and unhooks from sources', () => {
      const source = signal('init');
      expect(source.getSubscribers().size).toBe(0);

      const upper = computed(() => source.value.toUpperCase());
      expect(source.getSubscribers().size).toBe(1);
      expect(upper.value).toBe('INIT');
      expect(upper.isDisposed).toBe(false);

      source.value = 'updated';
      expect(upper.value).toBe('UPDATED');

      // Dispose computed explicitly
      upper.dispose();
      expect(upper.isDisposed).toBe(true);

      // Source subscriber set should now be completely empty
      expect(source.getSubscribers().size).toBe(0);

      // Mutating source should not trigger disposed computed
      source.value = 'ignored';
      expect(upper.peek()).toBe('UPDATED');
    });

    it('automatically disposes computeds when their parent ReactiveScope disposes', () => {
      const source = signal(10);
      let compRef: any = null;

      const { dispose } = createScope(() => {
        compRef = computed(() => source.value * 5);
      });

      expect(source.getSubscribers().size).toBe(1);
      expect(compRef.value).toBe(50);
      expect(compRef.isDisposed).toBe(false);

      // Dispose owner scope
      dispose();

      expect(compRef.isDisposed).toBe(true);
      expect(source.getSubscribers().size).toBe(0);
    });
  });

  describe('3. Reactive Ownership Tree (createRoot, createScope, onCleanup)', () => {
    it('manages nested scopes and cascades cleanup handlers', () => {
      const parentCleanup = vi.fn();
      const child1Cleanup = vi.fn();
      const child2Cleanup = vi.fn();

      let disposeParent!: () => void;

      createRoot((dispose) => {
        disposeParent = dispose;

        onCleanup(parentCleanup);

        createScope(() => {
          onCleanup(child1Cleanup);

          createScope(() => {
            onCleanup(child2Cleanup);
          });
        });
      });

      expect(parentCleanup).not.toHaveBeenCalled();
      expect(child1Cleanup).not.toHaveBeenCalled();
      expect(child2Cleanup).not.toHaveBeenCalled();

      // Disposing parent root should cascade cleanup down the entire tree
      disposeParent();

      expect(parentCleanup).toHaveBeenCalledTimes(1);
      expect(child1Cleanup).toHaveBeenCalledTimes(1);
      expect(child2Cleanup).toHaveBeenCalledTimes(1);
    });

    it('supports onCleanup inside effect during re-evaluations and upon disposal', () => {
      const count = signal(1);
      const cleanups: number[] = [];

      const dispose = effect(() => {
        const val = count.value;
        onCleanup(() => {
          cleanups.push(val);
        });
      });

      expect(cleanups).toEqual([]);

      count.value = 2;
      expect(cleanups).toEqual([1]);

      count.value = 3;
      expect(cleanups).toEqual([1, 2]);

      dispose();
      expect(cleanups).toEqual([1, 2, 3]);
    });
  });

  describe('4. untrack() API', () => {
    it('reads signal values without establishing reactive subscriptions', () => {
      const primary = signal('apple');
      const telemetry = signal(0);
      const spy = vi.fn();

      effect(() => {
        const p = primary.value;
        const t = untrack(() => telemetry.value);
        spy({ p, t });
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenLastCalledWith({ p: 'apple', t: 0 });

      // Mutating untracked signal should NOT trigger the effect!
      telemetry.value = 1;
      telemetry.value = 2;
      expect(spy).toHaveBeenCalledTimes(1);

      // Mutating tracked primary signal DOES trigger the effect
      primary.value = 'banana';
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith({ p: 'banana', t: 2 });
    });
  });

  describe('5. Atomic Multi-Field Component Dispatch', () => {
    it('batches action updates in dispatch() so subscribers observe all fields atomically', () => {
      const observedStates: Array<{ loading: boolean; data: string | null; error: string | null }> = [];

      const AsyncComponent = defineComponent({
        id: 'atomic-test',
        state: {
          loading: z.boolean(),
          data: z.string().nullable(),
          error: z.string().nullable(),
        },
        actions: {
          setData: (state, payload: { data: string }) => ({
            ...state,
            loading: false,
            data: payload.data,
            error: null,
          }),
        },
        initialState: {
          loading: true,
          data: null,
          error: null,
        },
        render: ({ state }) => h('div', null, state.data || 'loading'),
      });

      const instance = AsyncComponent();

      // An observer/watcher tracking all 3 signals
      effect(() => {
        observedStates.push({
          loading: instance.signals.loading.value,
          data: instance.signals.data.value,
          error: instance.signals.error.value,
        });
      });

      // Initial state observation
      expect(observedStates).toEqual([
        { loading: true, data: null, error: null },
      ]);

      observedStates.length = 0;

      // Dispatch action updating multiple fields simultaneously
      instance.dispatch('setData', { data: 'payload-resolved' });

      // Effect must have triggered EXACTLY ONCE with all fields synchronized
      expect(observedStates).toHaveLength(1);
      expect(observedStates[0]).toEqual({
        loading: false,
        data: 'payload-resolved',
        error: null,
      });

      unmount(instance);
    });
  });

  describe('6. Error Isolation in Scheduler', () => {
    it('isolates errors in one effect without preventing other scheduled effects from running', () => {
      const sig = signal(0);
      const effect1Spy = vi.fn();
      const effect3Spy = vi.fn();

      effect(() => {
        effect1Spy(sig.value);
      });

      effect(() => {
        if (sig.value === 1) {
          throw new Error('Effect 2 deliberate failure');
        }
      });

      effect(() => {
        effect3Spy(sig.value);
      });

      expect(effect1Spy).toHaveBeenCalledTimes(1);
      expect(effect3Spy).toHaveBeenCalledTimes(1);

      // Mutate signal: Effect 2 throws, but Effect 1 and 3 must still run!
      expect(() => {
        sig.value = 1;
      }).toThrow('Effect 2 deliberate failure');

      expect(effect1Spy).toHaveBeenCalledTimes(2);
      expect(effect1Spy).toHaveBeenLastCalledWith(1);
      expect(effect3Spy).toHaveBeenCalledTimes(2);
      expect(effect3Spy).toHaveBeenLastCalledWith(1);
    });
  });

  describe('7. DOM & Control Flow Scope Cleanup (<Show> and <For>)', () => {
    it('disposes inner effects and computeds when <Show> switches branch', () => {
      const toggle = signal(true);
      const branchSource = signal('active');

      const innerEffectSpy = vi.fn();
      let innerCompRef: any = null;

      const TestApp = defineComponent({
        id: 'show-cleanup-test',
        state: {},
        actions: {},
        render: () =>
          h(
            'div',
            null,
            h(Show, {
              when: () => toggle.value,
              children: () => {
                innerCompRef = computed(() => `prefix:${branchSource.value}`);
                effect(() => {
                  innerEffectSpy(branchSource.value);
                });
                return h('span', null, branchSource.value);
              },
              fallback: h('span', null, 'inactive'),
            })
          ),
      });

      const instance = TestApp();
      const container = document.createElement('div');
      mount(instance, container);

      expect(innerEffectSpy).toHaveBeenCalledTimes(1);
      expect(innerEffectSpy).toHaveBeenCalledWith('active');
      expect(innerCompRef.value).toBe('prefix:active');
      expect(branchSource.getSubscribers().size).toBe(2); // 1 effect + 1 computed

      // Switch Show to false (fallback)
      toggle.value = false;

      // The inner effect and computed from the true branch MUST be disposed!
      expect(innerCompRef.isDisposed).toBe(true);
      expect(branchSource.getSubscribers().size).toBe(0);

      // Mutating branchSource should NOT trigger the disposed inner effect!
      branchSource.value = 'modified-while-hidden';
      expect(innerEffectSpy).toHaveBeenCalledTimes(1);

      unmount(instance);
    });

    it('disposes item scopes and reactive effects when items are removed from <For>', () => {
      const items = signal([
        { id: '1', text: 'item 1' },
        { id: '2', text: 'item 2' },
      ]);

      const itemCleanups: string[] = [];

      const TestList = defineComponent({
        id: 'for-cleanup-test',
        state: {},
        actions: {},
        render: () =>
          h(
            'ul',
            null,
            h(For, {
              each: () => items.value,
              key: (item: any) => item.id,
              children: (item: any) => {
                onCleanup(() => {
                  itemCleanups.push(item.id);
                });
                return h('li', null, item.text);
              },
            })
          ),
      });

      const instance = TestList();
      const container = document.createElement('div');
      mount(instance, container);

      expect(itemCleanups).toEqual([]);

      // Remove item '1'
      items.value = [{ id: '2', text: 'item 2' }];

      // Item 1 scope cleanup must have fired!
      expect(itemCleanups).toEqual(['1']);

      // Clear remaining items
      items.value = [];
      expect(itemCleanups).toEqual(['1', '2']);

      unmount(instance);
    });
  });

  describe('8. Scale & Stress Test (Leak Prevention)', () => {
    it('allocates and cleanly destroys 1,000 dynamic computeds and effects without memory leaks', () => {
      const rootSource = signal(1);
      expect(rootSource.getSubscribers().size).toBe(0);

      const { dispose } = createScope(() => {
        for (let i = 0; i < 1000; i++) {
          const comp = computed(() => rootSource.value + i);
          effect(() => {
            const _ = comp.value;
          });
        }
      });

      // 1000 computeds subscribed to rootSource
      expect(rootSource.getSubscribers().size).toBe(1000);

      // Mutate root source once
      rootSource.value = 2;

      // Dispose entire scope
      dispose();

      // All 1000 subscribers must be completely detached!
      expect(rootSource.getSubscribers().size).toBe(0);
    });
  });
});
