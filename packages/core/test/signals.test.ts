import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect, batch } from '../src/signals.js';

describe('Fine-Grained Signals', () => {
  it('creates and reads signal values', () => {
    const count = signal(0);
    expect(count.value).toBe(0);
    expect(count.peek()).toBe(0);

    count.value = 5;
    expect(count.value).toBe(5);
  });

  it('triggers effect on mutation', () => {
    const name = signal('agent');
    const spy = vi.fn();

    const dispose = effect(() => {
      spy(name.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('agent');

    name.value = 'agent-dom';
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('agent-dom');

    dispose();
    name.value = 'another';
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('computes derived values reactively', () => {
    const first = signal('Agent');
    const last = signal('DOM');
    const full = computed(() => `${first.value} ${last.value}`);

    expect(full.value).toBe('Agent DOM');

    first.value = 'Reactive';
    expect(full.value).toBe('Reactive DOM');
  });

  it('supports effect cleanups', () => {
    const count = signal(1);
    const cleanupSpy = vi.fn();

    const dispose = effect(() => {
      const val = count.value;
      return () => cleanupSpy(val);
    });

    count.value = 2;
    expect(cleanupSpy).toHaveBeenCalledWith(1);

    dispose();
    expect(cleanupSpy).toHaveBeenCalledWith(2);
  });

  it('batches updates without redundant effect executions', () => {
    const a = signal(1);
    const b = signal(10);
    const spy = vi.fn();

    effect(() => {
      spy(a.value + b.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(11);

    batch(() => {
      a.value = 2;
      b.value = 20;
    });

    // Should only run once after batch ends
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(22);
  });
});
