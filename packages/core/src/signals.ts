/**
 * @agent-dom/core - Fine-Grained Reactive Signals
 * Zero-dependency, zero-closure-trap reactive primitives.
 */

export type CleanupFn = () => void;
export type EffectFn = () => void | CleanupFn;

export interface Signal<T> {
  value: T;
  peek(): T;
  subscribe(fn: (val: T) => void): CleanupFn;
}

export interface ReadonlySignal<T> {
  readonly value: T;
  peek(): T;
  subscribe(fn: (val: T) => void): CleanupFn;
}

// Global active effect stack for auto-dependency tracking
let activeEffect: EffectRunner | null = null;
let isBatching = false;
const pendingEffects = new Set<EffectRunner>();

class EffectRunner {
  private fn: EffectFn;
  private cleanup: CleanupFn | null = null;
  public dependencies = new Set<Set<EffectRunner>>();
  public isDisposed = false;

  constructor(fn: EffectFn) {
    this.fn = fn;
  }

  run(): void {
    if (this.isDisposed) return;
    this.cleanupPrev();

    const prevEffect = activeEffect;
    activeEffect = this;
    try {
      const res = this.fn();
      if (typeof res === 'function') {
        this.cleanup = res;
      }
    } finally {
      activeEffect = prevEffect;
    }
  }

  cleanupPrev(): void {
    if (this.cleanup) {
      try {
        this.cleanup();
      } catch (err) {
        console.error('Error during effect cleanup:', err);
      }
      this.cleanup = null;
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.cleanupPrev();
    for (const depSet of this.dependencies) {
      depSet.delete(this);
    }
    this.dependencies.clear();
  }
}

class SignalImpl<T> implements Signal<T> {
  private _val: T;
  private subscribers = new Set<EffectRunner>();

  constructor(initialVal: T) {
    this._val = initialVal;
  }

  get value(): T {
    if (activeEffect && !activeEffect.isDisposed) {
      this.subscribers.add(activeEffect);
      activeEffect.dependencies.add(this.subscribers);
    }
    return this._val;
  }

  set value(newVal: T) {
    if (Object.is(this._val, newVal)) return;
    this._val = newVal;
    this.notify();
  }

  peek(): T {
    return this._val;
  }

  subscribe(fn: (val: T) => void): CleanupFn {
    return effect(() => {
      fn(this.value);
    });
  }

  private notify(): void {
    for (const sub of Array.from(this.subscribers)) {
      if (sub.isDisposed) {
        this.subscribers.delete(sub);
        continue;
      }
      if (isBatching) {
        pendingEffects.add(sub);
      } else {
        sub.run();
      }
    }
  }
}

export function signal<T>(initialValue: T): Signal<T> {
  return new SignalImpl<T>(initialValue);
}

export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const compSignal = signal<T>(undefined as unknown as T);
  effect(() => {
    compSignal.value = fn();
  });
  return {
    get value() {
      return compSignal.value;
    },
    peek() {
      return compSignal.peek();
    },
    subscribe(cb) {
      return compSignal.subscribe(cb);
    },
  };
}

export function effect(fn: EffectFn): CleanupFn {
  const runner = new EffectRunner(fn);
  runner.run();
  return () => runner.dispose();
}

export function batch(fn: () => void): void {
  const wasBatching = isBatching;
  isBatching = true;
  try {
    fn();
  } finally {
    isBatching = wasBatching;
    if (!isBatching) {
      const effectsToRun = Array.from(pendingEffects);
      pendingEffects.clear();
      for (const eff of effectsToRun) {
        eff.run();
      }
    }
  }
}
