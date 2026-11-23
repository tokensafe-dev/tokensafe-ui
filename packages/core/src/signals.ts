/**
 * @tokensafe-ui/core - Fine-Grained Reactive Signals
 * Zero-dependency, zero-closure-trap reactive primitives with dynamic dependency graph,
 * topological glitch-free scheduling, and reactive ownership scopes.
 */

export type CleanupFn = () => void;
export type EffectFn = () => void | CleanupFn;

export interface Subscriber {
  id: string;
  name?: string;
  kind: 'effect' | 'computed' | 'dom_binding';
  level: number;
  getDependencies(): Set<Signal<any>>;
}

export interface Signal<T> {
  id: string;
  name?: string;
  level: number;
  value: T;
  peek(): T;
  subscribe(fn: (val: T) => void): CleanupFn;
  getSubscribers(): Set<Subscriber>;
}

export interface ReadonlySignal<T> {
  id: string;
  name?: string;
  level: number;
  readonly value: T;
  peek(): T;
  subscribe(fn: (val: T) => void): CleanupFn;
  getSubscribers(): Set<Subscriber>;
  getDependencies(): Set<Signal<any>>;
}

export interface Computed<T> extends ReadonlySignal<T> {
  dispose(): void;
  readonly isDisposed: boolean;
}

export interface ReactiveScope {
  id: string;
  parent: ReactiveScope | null;
  children: Set<ReactiveScope>;
  cleanups: Set<CleanupFn>;
  disposables: Set<{ dispose(): void }>;
  dispose(): void;
  run<T>(fn: () => T): T;
  readonly isDisposed: boolean;
}

let subscriberCounter = 0;
let signalCounter = 0;
let scopeCounter = 0;

// Global active effect & active scope tracking
let activeEffect: EffectRunner | null = null;
let activeScope: ReactiveScope | null = null;

export function getActiveScope(): ReactiveScope | null {
  return activeScope;
}

export class ReactiveScopeImpl implements ReactiveScope {
  public id: string;
  public parent: ReactiveScope | null;
  public children = new Set<ReactiveScope>();
  public cleanups = new Set<CleanupFn>();
  public disposables = new Set<{ dispose(): void }>();
  public isDisposed = false;

  constructor(parent: ReactiveScope | null = null, namePrefix = 'scope') {
    this.id = `${namePrefix}_${++scopeCounter}`;
    this.parent = parent;
  }

  run<T>(fn: () => T): T {
    if (this.isDisposed) {
      throw new Error(`Cannot run in a disposed ReactiveScope (${this.id})`);
    }
    const prevScope = activeScope;
    activeScope = this;
    try {
      return fn();
    } finally {
      activeScope = prevScope;
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.parent) {
      this.parent.children.delete(this);
    }

    // 1. Dispose child scopes recursively
    for (const child of Array.from(this.children)) {
      try {
        child.dispose();
      } catch (err) {
        console.error(`Error disposing child scope '${child.id}':`, err);
      }
    }
    this.children.clear();

    // 2. Dispose owned effects & computeds
    for (const item of Array.from(this.disposables)) {
      try {
        item.dispose();
      } catch (err) {
        console.error(`Error disposing scoped item:`, err);
      }
    }
    this.disposables.clear();

    // 3. Execute cleanup handlers
    for (const cleanup of Array.from(this.cleanups)) {
      try {
        cleanup();
      } catch (err) {
        console.error(`Error executing scope cleanup '${this.id}':`, err);
      }
    }
    this.cleanups.clear();
  }
}

export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const scope = new ReactiveScopeImpl(null, 'root');
  const prevScope = activeScope;
  activeScope = scope;
  try {
    return fn(() => scope.dispose());
  } finally {
    activeScope = prevScope;
  }
}

export function createScope<T>(fn: (dispose: () => void) => T): {
  result: T;
  dispose: () => void;
  scope: ReactiveScope;
} {
  const scope = new ReactiveScopeImpl(activeScope, 'scope');
  if (activeScope && !activeScope.isDisposed) {
    activeScope.children.add(scope);
  }
  const prevScope = activeScope;
  activeScope = scope;
  try {
    const result = fn(() => scope.dispose());
    return {
      result,
      dispose: () => scope.dispose(),
      scope,
    };
  } finally {
    activeScope = prevScope;
  }
}

export function onCleanup(fn: CleanupFn): void {
  if (activeScope && !activeScope.isDisposed) {
    activeScope.cleanups.add(fn);
  } else if (activeEffect && !activeEffect.isDisposed) {
    activeEffect.registerCleanup(fn);
  }
}

export function untrack<T>(fn: () => T): T {
  const prevEffect = activeEffect;
  activeEffect = null;
  try {
    return fn();
  } finally {
    activeEffect = prevEffect;
  }
}

export interface EffectOptions {
  id?: string;
  name?: string;
  kind?: 'effect' | 'computed' | 'dom_binding';
}

export interface SignalOptions {
  id?: string;
  name?: string;
}

/**
 * Priority Topological Reactive Scheduler.
 * Coordinates execution phases:
 * Phase 1: Computeds (ordered by topological level ascending -> glitch-free)
 * Phase 2: User Effects
 * Phase 3: DOM Bindings
 */
class Scheduler {
  private isBatching = false;
  private isFlushing = false;
  private computedBuckets = new Map<number, Set<EffectRunner>>();
  private effectsQueue = new Set<EffectRunner>();
  private domQueue = new Set<EffectRunner>();
  private static MAX_FLUSH_CYCLES = 100;

  schedule(sub: EffectRunner): void {
    if (sub.isDisposed) return;

    if (sub.isRunning) {
      sub.recordSelfSchedule();
    }

    if (sub.kind === 'computed') {
      let bucket = this.computedBuckets.get(sub.level);
      if (!bucket) {
        bucket = new Set<EffectRunner>();
        this.computedBuckets.set(sub.level, bucket);
      }
      bucket.add(sub);
    } else if (sub.kind === 'dom_binding') {
      this.domQueue.add(sub);
    } else {
      this.effectsQueue.add(sub);
    }

    if (!this.isBatching && !this.isFlushing) {
      this.flush();
    }
  }

  batch<T>(fn: () => T): T {
    const wasBatching = this.isBatching;
    this.isBatching = true;
    try {
      return fn();
    } finally {
      this.isBatching = wasBatching;
      if (!this.isBatching && !this.isFlushing) {
        this.flush();
      }
    }
  }

  private hasPending(): boolean {
    if (this.effectsQueue.size > 0 || this.domQueue.size > 0) return true;
    for (const bucket of this.computedBuckets.values()) {
      if (bucket.size > 0) return true;
    }
    return false;
  }

  private clearAll(): void {
    this.computedBuckets.clear();
    this.effectsQueue.clear();
    this.domQueue.clear();
  }

  flush(): void {
    if (this.isFlushing) return;
    this.isFlushing = true;

    let cycles = 0;
    const errors: any[] = [];

    try {
      while (this.hasPending()) {
        cycles++;
        if (cycles > Scheduler.MAX_FLUSH_CYCLES) {
          this.clearAll();
          throw new Error(
            `[TokenSafe Reactive Cycle] Maximum scheduler flush iterations (${Scheduler.MAX_FLUSH_CYCLES}) exceeded. Infinite reactive loop detected.`
          );
        }

        // Phase 1: Drain Computeds by topological level ascending
        let hasComputeds = true;
        while (hasComputeds) {
          const sortedLevels = Array.from(this.computedBuckets.keys())
            .filter((lvl) => (this.computedBuckets.get(lvl)?.size || 0) > 0)
            .sort((a, b) => a - b);

          if (sortedLevels.length === 0) {
            hasComputeds = false;
            break;
          }

          const lowestLevel = sortedLevels[0];
          const bucket = this.computedBuckets.get(lowestLevel)!;
          const runner = bucket.values().next().value as EffectRunner;
          bucket.delete(runner);

          if (!runner.isDisposed) {
            try {
              runner.run();
            } catch (err) {
              errors.push(err);
            }
          }
        }

        // Phase 2: Drain user effects
        if (this.effectsQueue.size > 0) {
          const effectsToRun = Array.from(this.effectsQueue);
          this.effectsQueue.clear();
          for (const eff of effectsToRun) {
            if (!eff.isDisposed) {
              try {
                eff.run();
              } catch (err) {
                errors.push(err);
              }
            }
          }
          // After effects run, computeds might have been scheduled
          continue;
        }

        // Phase 3: Drain DOM bindings
        if (this.domQueue.size > 0) {
          const domToRun = Array.from(this.domQueue);
          this.domQueue.clear();
          for (const d of domToRun) {
            if (!d.isDisposed) {
              try {
                d.run();
              } catch (err) {
                errors.push(err);
              }
            }
          }
        }
      }
    } finally {
      this.isFlushing = false;
      if (errors.length > 0) {
        if (errors.length === 1) {
          throw errors[0];
        }
        const multiError = new Error(
          `[TokenSafe Reactive Error] Multiple errors occurred during reactive scheduler flush:\n` +
            errors.map((e) => (e instanceof Error ? e.message : String(e))).join('\n')
        );
        (multiError as any).errors = errors;
        throw multiError;
      }
    }
  }
}

export const scheduler = new Scheduler();

export class EffectRunner implements Subscriber {
  public id: string;
  public name?: string;
  public kind: 'effect' | 'computed' | 'dom_binding';
  public level = 1;
  public ownerScope: ReactiveScope | null = null;
  private fn: EffectFn;
  private cleanups: CleanupFn[] = [];
  public dependencies = new Set<SignalImpl<any>>();
  public isDisposed = false;
  public isRunning = false;
  private runCount = 0;
  private scheduledSelf = false;
  private static MAX_RECURSION = 50;

  constructor(fn: EffectFn, options: EffectOptions = {}) {
    this.fn = fn;
    this.id = options.id || `sub_${++subscriberCounter}`;
    this.name = options.name;
    this.kind = options.kind || 'effect';
    this.ownerScope = activeScope && !activeScope.isDisposed ? activeScope : null;
    if (this.ownerScope) {
      this.ownerScope.disposables.add(this);
    }
  }

  getDependencies(): Set<Signal<any>> {
    return new Set(this.dependencies);
  }

  registerCleanup(cleanup: CleanupFn): void {
    this.cleanups.push(cleanup);
  }

  recordSelfSchedule(): void {
    this.scheduledSelf = true;
    this.runCount++;
    if (this.runCount > EffectRunner.MAX_RECURSION) {
      throw new Error(
        `[TokenSafe Reactive Cycle] Maximum reactive update depth (${EffectRunner.MAX_RECURSION}) exceeded in effect '${this.name || this.id}'. Possible infinite loop detected.`
      );
    }
  }

  run(): void {
    if (this.isDisposed) return;

    this.scheduledSelf = false;
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
        this.cleanups.push(res);
      }

      // Recompute topological level dynamically based on actual dependencies
      let maxDepLevel = 0;
      for (const dep of this.dependencies) {
        if (dep.level > maxDepLevel) {
          maxDepLevel = dep.level;
        }
      }
      this.level = this.dependencies.size === 0 ? 1 : maxDepLevel + 1;
    } finally {
      activeEffect = prevEffect;
      this.isRunning = false;
      if (!this.scheduledSelf) {
        this.runCount = 0;
      }
    }
  }

  cleanupPrev(): void {
    if (this.cleanups.length > 0) {
      const toRun = [...this.cleanups];
      this.cleanups = [];
      for (const c of toRun) {
        try {
          c();
        } catch (err) {
          console.error(`Error during effect cleanup '${this.name || this.id}':`, err);
        }
      }
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
    if (this.ownerScope) {
      this.ownerScope.disposables.delete(this);
      this.ownerScope = null;
    }
  }
}

export class SignalImpl<T> implements Signal<T> {
  public id: string;
  public name?: string;
  public level = 0;
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
    batch(() => {
      this.notify();
    });
  }

  peek(): T {
    return this._val;
  }

  subscribe(fn: (val: T) => void): CleanupFn {
    return effect(
      () => {
        fn(this.value);
      },
      { name: this.name ? `sub:${this.name}` : undefined }
    );
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
      scheduler.schedule(sub);
    }
  }
}

export function signal<T>(initialValue: T, options?: SignalOptions): Signal<T> {
  return new SignalImpl<T>(initialValue, options);
}

export function computed<T>(fn: () => T, options?: SignalOptions): Computed<T> {
  const compSignal = new SignalImpl<T>(undefined as unknown as T, options);
  let isDisposed = false;
  const ownerScope = activeScope && !activeScope.isDisposed ? activeScope : null;

  const runner = new EffectRunner(
    () => {
      const newVal = fn();
      let maxDep = 0;
      for (const dep of runner.dependencies) {
        if (dep.level > maxDep) {
          maxDep = dep.level;
        }
      }
      runner.level = runner.dependencies.size === 0 ? 1 : maxDep + 1;
      compSignal.level = runner.level;
      compSignal.value = newVal;
    },
    {
      id: options?.id ? `comp_${options.id}` : undefined,
      name: options?.name,
      kind: 'computed',
    }
  );

  runner.run();

  const computedObj: Computed<T> = {
    id: compSignal.id,
    name: compSignal.name,
    get level() {
      return compSignal.level;
    },
    get value() {
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
      return runner.getDependencies();
    },
    get isDisposed() {
      return isDisposed;
    },
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      runner.dispose();
      if (ownerScope && !ownerScope.isDisposed) {
        ownerScope.disposables.delete(computedObj);
      }
    },
  };

  // Register in active scope if present
  if (ownerScope && !ownerScope.isDisposed) {
    ownerScope.disposables.add(computedObj);
  }

  return computedObj;
}

export function effect(fn: EffectFn, options?: EffectOptions): CleanupFn {
  const runner = new EffectRunner(fn, options);
  runner.run();
  return () => runner.dispose();
}

export function batch<T>(fn: () => T): T {
  return scheduler.batch(fn);
}

