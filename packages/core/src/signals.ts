/**
 * @agent-dom/core - Fine-Grained Reactive Signals
 * Zero-dependency, zero-closure-trap reactive primitives with dynamic dependency graph.
 */

export type CleanupFn = () => void;
export type EffectFn = () => void | CleanupFn;

export interface Subscriber {
  id: string;
  name?: string;
  kind: 'effect' | 'computed' | 'dom_binding';
  getDependencies(): Set<Signal<any>>;
}

export interface Signal<T> {
  id: string;
  name?: string;
  value: T;
  peek(): T;
  subscribe(fn: (val: T) => void): CleanupFn;
  getSubscribers(): Set<Subscriber>;
}

export interface ReadonlySignal<T> {
  id: string;
  name?: string;
  readonly value: T;
  peek(): T;
  subscribe(fn: (val: T) => void): CleanupFn;
  getSubscribers(): Set<Subscriber>;
  getDependencies(): Set<Signal<any>>;
}

let subscriberCounter = 0;
let signalCounter = 0;

// Global active effect stack for auto-dependency tracking
let activeEffect: EffectRunner | null = null;
let isBatching = false;
const pendingEffects = new Set<EffectRunner>();

export interface EffectOptions {
  id?: string;
  name?: string;
  kind?: 'effect' | 'computed' | 'dom_binding';
}

export interface SignalOptions {
  id?: string;
  name?: string;
}

class EffectRunner implements Subscriber {
  public id: string;
  public name?: string;
  public kind: 'effect' | 'computed' | 'dom_binding';
  private fn: EffectFn;
  private cleanup: CleanupFn | null = null;
  public dependencies = new Set<SignalImpl<any>>();
  public isDisposed = false;
  private isRunning = false;
  private runCount = 0;
  private static MAX_RECURSION = 50;

  constructor(fn: EffectFn, options: EffectOptions = {}) {
    this.fn = fn;
    this.id = options.id || `sub_${++subscriberCounter}`;
    this.name = options.name;
    this.kind = options.kind || 'effect';
  }

  getDependencies(): Set<Signal<any>> {
    return new Set(this.dependencies);
  }

  run(): void {
    if (this.isDisposed) return;

    if (this.isRunning) {
      this.runCount++;
      if (this.runCount > EffectRunner.MAX_RECURSION) {
        throw new Error(
          `[TokenSafe Reactive Cycle] Maximum reactive update depth (${EffectRunner.MAX_RECURSION}) exceeded in effect '${this.name || this.id}'. Possible infinite loop detected.`
        );
      }
    } else {
      this.runCount = 0;
    }

    this.isRunning = true;
    this.cleanupPrev();

    // Dynamically unsubscribe from previous dependencies before re-evaluating
    for (const dep of this.dependencies) {
      dep.removeSubscriber(this);
    }
    this.dependencies.clear();

    const prevEffect = activeEffect;
    activeEffect = this;
    try {
      const res = this.fn();
      if (typeof res === 'function') {
        this.cleanup = res;
      }
    } finally {
      activeEffect = prevEffect;
      this.isRunning = false;
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
    for (const dep of this.dependencies) {
      dep.removeSubscriber(this);
    }
    this.dependencies.clear();
  }
}

class SignalImpl<T> implements Signal<T> {
  public id: string;
  public name?: string;
  private _val: T;
  private subscribers = new Set<EffectRunner>();

  constructor(initialVal: T, options: SignalOptions = {}) {
    this._val = initialVal;
    this.id = options.id || `sig_${++signalCounter}`;
    this.name = options.name;
  }

  get value(): T {
    if (activeEffect && !activeEffect.isDisposed) {
      this.subscribers.add(activeEffect);
      activeEffect.dependencies.add(this);
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
    }, { name: this.name ? `sub:${this.name}` : undefined });
  }

  getSubscribers(): Set<Subscriber> {
    return new Set(this.subscribers);
  }

  removeSubscriber(sub: EffectRunner): void {
    this.subscribers.delete(sub);
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

export function signal<T>(initialValue: T, options?: SignalOptions): Signal<T> {
  return new SignalImpl<T>(initialValue, options);
}

export function computed<T>(fn: () => T, options?: SignalOptions): ReadonlySignal<T> {
  const compSignal = new SignalImpl<T>(undefined as unknown as T, options);
  let runnerRef: EffectRunner | null = null;

  const runner = new EffectRunner(() => {
    compSignal.value = fn();
  }, {
    id: options?.id ? `comp_${options.id}` : undefined,
    name: options?.name,
    kind: 'computed',
  });
  runnerRef = runner;
  runner.run();

  return {
    id: compSignal.id,
    name: compSignal.name,
    get value() {
      // Accessing computed.value also tracks the outer active effect
      return compSignal.value;
    },
    peek() {
      return compSignal.peek();
    },
    subscribe(cb) {
      return compSignal.subscribe(cb);
    },
    getSubscribers() {
      return compSignal.getSubscribers();
    },
    getDependencies() {
      return runnerRef ? runnerRef.getDependencies() : new Set();
    },
  };
}

export function effect(fn: EffectFn, options?: EffectOptions): CleanupFn {
  const runner = new EffectRunner(fn, options);
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
      let iterations = 0;
      while (pendingEffects.size > 0) {
        iterations++;
        if (iterations > 50) {
          pendingEffects.clear();
          throw new Error(
            '[TokenSafe Reactive Cycle] Maximum batch flush iterations (50) exceeded. Infinite reactive loop detected during batch.'
          );
        }
        const effectsToRun = Array.from(pendingEffects);
        pendingEffects.clear();
        for (const eff of effectsToRun) {
          eff.run();
        }
      }
    }
  }
}
