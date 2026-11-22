import { describe, it, expect, vi } from 'vitest';
import {
  defineComponent,
  z,
  h,
  mount,
  unmount,
  activeInstances,
} from '../src/index.js';

describe('Component Lifecycle & Instance Registry', () => {
  it('respects initial state overrides passed in props or config', () => {
    const Card = defineComponent({
      id: 'lifecycle-card',
      state: {
        score: z.number().default(0),
        title: z.string().default('Untitled'),
      },
      actions: {
        setScore: (s, score: number) => ({ ...s, score }),
      },
      render: ({ state }) => h('div', null, state.title),
    });

    // Pass custom initial state override
    const instance = Card({ initialState: { score: 42, title: 'Custom Title' } });
    expect(instance.state.score).toBe(42);
    expect(instance.state.title).toBe('Custom Title');

    // Clean up
    instance.unmount();
  });

  it('runs onMount and onUnmount lifecycle hooks with cleanups', () => {
    const onMountCleanup = vi.fn();
    const onMount = vi.fn(() => onMountCleanup);
    const onUnmount = vi.fn();

    const LifecycleComponent = defineComponent({
      id: 'hook-test',
      state: { count: z.number().default(1) },
      actions: {},
      onMount,
      onUnmount,
      render: ({ state }) => h('div', null, state.count),
    });

    const instance = LifecycleComponent();
    const container = document.createElement('div');

    expect(activeInstances.has('hook-test')).toBe(true);

    mount(instance, container);
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(instance.isMounted).toBe(true);

    // Unmount instance
    instance.unmount();

    expect(onMountCleanup).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(1);
    expect(instance.isMounted).toBe(false);

    // Crucial guarantee: must be removed from activeInstances!
    expect(activeInstances.has('hook-test')).toBe(false);
  });

  it('automatically unmounts previous component when mounting into same container', () => {
    const onUnmountA = vi.fn();
    const ComponentA = defineComponent({
      id: 'comp-a',
      state: { text: z.string().default('A') },
      actions: {},
      onUnmount: onUnmountA,
      render: ({ state }) => h('div', null, state.text),
    });

    const ComponentB = defineComponent({
      id: 'comp-b',
      state: { text: z.string().default('B') },
      actions: {},
      render: ({ state }) => h('div', null, state.text),
    });

    const container = document.createElement('div');
    const instA = ComponentA();
    mount(instA, container);
    expect(activeInstances.has('comp-a')).toBe(true);

    // Mount Component B into the same container
    const instB = ComponentB();
    mount(instB, container);

    // Component A must have been automatically unmounted!
    expect(onUnmountA).toHaveBeenCalledTimes(1);
    expect(activeInstances.has('comp-a')).toBe(false);
    expect(activeInstances.has('comp-b')).toBe(true);

    // Global unmount helper
    unmount(container);
    expect(activeInstances.has('comp-b')).toBe(false);
  });
});
