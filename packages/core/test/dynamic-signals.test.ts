import { describe, it, expect } from 'vitest';
import { signal, computed, effect } from '../src/index.js';

describe('Dynamic Reactive Signals Graph', () => {
  it('tracks subscribers on signals and dependencies on effects', () => {
    const count = signal(0, { name: 'count' });
    let observed = -1;

    const cleanup = effect(() => {
      observed = count.value;
    }, { name: 'trackCount', kind: 'effect' });

    expect(observed).toBe(0);

    // Verify subscriber tracking
    const subs = Array.from(count.getSubscribers());
    expect(subs.length).toBe(1);
    expect(subs[0].name).toBe('trackCount');
    expect(subs[0].kind).toBe('effect');

    // Mutate and check update
    count.value = 5;
    expect(observed).toBe(5);

    cleanup();
    // After disposal, subscriber is removed
    count.value = 10;
    expect(count.getSubscribers().size).toBe(0);
    expect(observed).toBe(5);
  });

  it('computeds track both upstream dependencies and downstream subscribers', () => {
    const firstName = signal('John', { name: 'firstName' });
    const lastName = signal('Doe', { name: 'lastName' });

    const fullName = computed(() => {
      return `${firstName.value} ${lastName.value}`;
    }, { name: 'fullName' });

    // Computed dependencies
    const deps = Array.from(fullName.getDependencies()).map((s) => s.name);
    expect(deps).toContain('firstName');
    expect(deps).toContain('lastName');

    // Add a subscriber to the computed
    let greet = '';
    const cleanup = effect(() => {
      greet = `Hello, ${fullName.value}!`;
    }, { name: 'greetEffect' });

    expect(greet).toBe('Hello, John Doe!');
    expect(fullName.getSubscribers().size).toBe(1);

    firstName.value = 'Jane';
    expect(greet).toBe('Hello, Jane Doe!');

    cleanup();
    expect(fullName.getSubscribers().size).toBe(0);
  });

  it('dynamically adapts dependencies when conditionals change branches', () => {
    const toggle = signal(true, { name: 'toggle' });
    const optionA = signal('Option A', { name: 'optionA' });
    const optionB = signal('Option B', { name: 'optionB' });

    let currentVal = '';
    let runCount = 0;

    effect(() => {
      runCount++;
      currentVal = toggle.value ? optionA.value : optionB.value;
    }, { name: 'conditionalBranch' });

    expect(currentVal).toBe('Option A');
    expect(optionA.getSubscribers().size).toBe(1);
    expect(optionB.getSubscribers().size).toBe(0);

    // Changing optionB should NOT trigger effect when toggle is true!
    optionB.value = 'Option B Modified';
    expect(runCount).toBe(1);
    expect(currentVal).toBe('Option A');

    // Switch branch
    toggle.value = false;
    expect(runCount).toBe(2);
    expect(currentVal).toBe('Option B Modified');
    expect(optionA.getSubscribers().size).toBe(0);
    expect(optionB.getSubscribers().size).toBe(1);

    // Now changing optionA should NOT trigger effect!
    optionA.value = 'Option A Modified';
    expect(runCount).toBe(2);

    // But changing optionB should trigger it!
    optionB.value = 'Option B Final';
    expect(runCount).toBe(3);
    expect(currentVal).toBe('Option B Final');
  });
});
