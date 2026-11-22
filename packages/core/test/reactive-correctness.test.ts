import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect, batch } from '../src/index.js';

describe('Reactive Correctness & Edge-Case Protection', () => {
  it('correctly tracks nested dependencies (A -> B -> C)', () => {
    const a = signal(2);
    const b = computed(() => a.value * 10);
    const c = computed(() => b.value + 5);

    expect(c.value).toBe(25);

    a.value = 3;
    expect(b.value).toBe(30);
    expect(c.value).toBe(35);
  });

  it('dynamically unbinds unused branches on conditional switching', () => {
    const condition = signal(true);
    const branchA = signal('Branch A');
    const branchB = signal('Branch B');

    const spy = vi.fn();

    effect(() => {
      const selected = condition.value ? branchA.value : branchB.value;
      spy(selected);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith('Branch A');

    // Mutating branchB while condition is true should NOT trigger the effect!
    branchB.value = 'Branch B Modified';
    expect(spy).toHaveBeenCalledTimes(1);

    // Switch condition to false
    condition.value = false;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('Branch B Modified');

    // Now mutating branchA should NOT trigger the effect!
    branchA.value = 'Branch A Modified';
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('batches multiple updates and executes subscribers exactly once', () => {
    const x = signal(0);
    const y = signal(0);
    const spy = vi.fn();

    effect(() => {
      spy(x.value + y.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);

    // Without batch, updating x then y would trigger twice
    batch(() => {
      x.value = 10;
      y.value = 20;
    });

    // With batch, effect should trigger exactly ONCE more
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(30);
  });

  it('intercepts cyclic infinite updates with recursion depth guard', () => {
    const loopSignal = signal(0);

    expect(() => {
      effect(() => {
        // Mutating the dependency inside the effect creates a cycle
        loopSignal.value = loopSignal.value + 1;
      });
    }).toThrow(/Maximum reactive update depth/);
  });

  it('guarantees complete memory cleanup when disposing effects', () => {
    const sourceSig = signal('active');
    expect(sourceSig.getSubscribers().size).toBe(0);

    const dispose = effect(() => {
      // Access signal
      const _ = sourceSig.value;
    });

    expect(sourceSig.getSubscribers().size).toBe(1);

    // Dispose effect
    dispose();

    // Subscriber set must be empty (preventing memory leaks)
    expect(sourceSig.getSubscribers().size).toBe(0);
  });
});
