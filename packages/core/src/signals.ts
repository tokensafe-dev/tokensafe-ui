/**
 * @tokensafe-ui/core - Fine-Grained Reactive Signals
 * Built on top of SolidJS fine-grained reactive primitives.
 * Provides direct SolidJS interop alongside TokenSafe Signal abstractions.
 */

import {
  createSignal as solidCreateSignal,
  createMemo as solidCreateMemo,
  createEffect as solidCreateEffect,
  createRenderEffect as solidCreateRenderEffect,
  createRoot as solidCreateRoot,
  onCleanup as solidOnCleanup,
  onMount as solidOnMount,
  batch as solidBatch,
  untrack as solidUntrack,
  getOwner as solidGetOwner,
  runWithOwner as solidRunWithOwner,
  type Accessor,
  type Setter,
  type Owner,
} from 'solid-js';

// Re-export native SolidJS reactive primitives
export {
  solidCreateSignal as createSignal,
  solidCreateMemo as createMemo,
  solidCreateEffect as createEffect,
  solidCreateRenderEffect as createRenderEffect,
  solidOnMount as onMount,
  solidBatch as batch,
  solidGetOwner as getOwner,
  solidRunWithOwner as runWithOwner,
};

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
  readonly read?: Accessor<T>;
  readonly write?: Setter<T>;
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
  readonly read?: Accessor<T>;
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

// Global active scope tracking
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
  public solidOwner: Owner | null = null;

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

export function onCleanup(fn: CleanupFn): void {
  let ran = false;
  const wrapped = () => {
    if (!ran) {
      ran = true;
      fn();
    }
  };
  if (activeScope && !activeScope.isDisposed) {
    activeScope.cleanups.add(wrapped);
  } else {
    try {
      solidOnCleanup(wrapped);
    } catch {}
  }
}

export function untrack<T>(fn: () => T): T {
  const prevSub = currentSubscriber;
  currentSubscriber = null;
  try {
    return solidUntrack(fn);
  } finally {
    currentSubscriber = prevSub;
  }
}

export function createRoot<T>(fn: (dispose: () => void) => T): T {
  let disposer!: () => void;
  let result!: T;
  const scope = new ReactiveScopeImpl(activeScope, 'root');
  if (activeScope && !activeScope.isDisposed) {
    activeScope.children.add(scope);
  }
  solidCreateRoot((dispose) => {
    disposer = () => {
      dispose();
      scope.dispose();
    };
    scope.cleanups.add(dispose);
    scope.solidOwner = solidGetOwner();
    result = scope.run(() => fn(disposer));
  });
  return result;
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
  scope.solidOwner = solidGetOwner();
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

let currentSubscriber: Subscriber | null = null;

export class SubscriberImpl implements Subscriber {
  public id: string;
  public name?: string;
  public kind: 'effect' | 'computed' | 'dom_binding';
  public level = 1;
  public dependencies = new Set<Signal<any>>();

  constructor(id: string, name?: string, kind: 'effect' | 'computed' | 'dom_binding' = 'effect') {
    this.id = id;
    this.name = name;
    this.kind = kind;
  }

  getDependencies(): Set<Signal<any>> {
    return new Set(this.dependencies);
  }

  cleanupDeps() {
    for (const dep of this.dependencies) {
      dep.getSubscribers().delete(this);
    }
    this.dependencies.clear();
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

let activeSignalWrites = 0;
let lastEffectError: any = null;

export function signal<T>(initialValue: T, options?: SignalOptions): Signal<T> {
  const [read, write] = solidCreateSignal<T>(initialValue, {
    equals: false,
    name: options?.name,
  });
  const id = options?.id || `sig_${++signalCounter}`;
  const subscribers = new Set<Subscriber>();

  let setDepth = 0;
  const sig: Signal<T> = {
    id,
    name: options?.name,
    level: 0,
    get value(): T {
      if (currentSubscriber) {
        subscribers.add(currentSubscriber);
        (currentSubscriber as any).dependencies.add(sig);
      }
      return read();
    },
    set value(v: T) {
      if (Object.is(solidUntrack(read), v)) return;
      setDepth++;
      if (setDepth > 50) {
        setDepth = 0;
        throw new Error(
          `[TokenSafe Reactive Cycle] Maximum reactive update depth (50) exceeded in signal '${options?.name || id}'. Possible infinite loop detected.`
        );
      }
      activeSignalWrites++;
      try {
        write(() => v);
      } finally {
        activeSignalWrites--;
        setDepth--;
      }
      if (activeSignalWrites === 0 && lastEffectError) {
        const err = lastEffectError;
        lastEffectError = null;
        throw err;
      }
    },
    peek(): T {
      return solidUntrack(read);
    },
    subscribe(fn: (val: T) => void): CleanupFn {
      let isFirst = true;
      let cleanup: CleanupFn | undefined;
      solidCreateRoot((dispose) => {
        solidCreateEffect(() => {
          const val = read();
          if (isFirst) {
            isFirst = false;
            return;
          }
          fn(val);
        });
        cleanup = dispose;
      });
      return () => {
        if (cleanup) cleanup();
      };
    },
    getSubscribers(): Set<Subscriber> {
      return subscribers;
    },
    get read() {
      return read;
    },
    get write() {
      return write;
    },
  };

  return sig;
}

export function computed<T>(fn: () => T, options?: SignalOptions): Computed<T> {
  const id = options?.id || `cmp_${++subscriberCounter}`;
  const sub = new SubscriberImpl(id, options?.name, 'computed');
  let isDisposed = false;
  let disposer: (() => void) | null = null;
  let memoAccessor!: Accessor<T>;
  const subscribers = new Set<Subscriber>();

  solidCreateRoot((dispose) => {
    disposer = dispose;
    memoAccessor = solidCreateMemo(() => {
      sub.cleanupDeps();
      const prevSub = currentSubscriber;
      currentSubscriber = sub;
      try {
        return fn();
      } finally {
        currentSubscriber = prevSub;
      }
    }, undefined, { name: options?.name });
  });

  const comp: Computed<T> = {
    id,
    name: options?.name,
    level: 1,
    get value(): T {
      if (isDisposed) {
        throw new Error(`Computed '${id}' has been disposed.`);
      }
      if (currentSubscriber) {
        subscribers.add(currentSubscriber);
        (currentSubscriber as any).dependencies.add(comp as any);
      }
      return memoAccessor();
    },
    peek(): T {
      return solidUntrack(memoAccessor);
    },
    subscribe(fnCallback: (val: T) => void): CleanupFn {
      let isFirst = true;
      let cleanup: CleanupFn | undefined;
      solidCreateRoot((dispose) => {
        solidCreateEffect(() => {
          const val = memoAccessor();
          if (isFirst) {
            isFirst = false;
            return;
          }
          fnCallback(val);
        });
        cleanup = dispose;
      });
      return () => {
        if (cleanup) cleanup();
      };
    },
    getSubscribers(): Set<Subscriber> {
      return subscribers;
    },
    getDependencies(): Set<Signal<any>> {
      return sub.getDependencies();
    },
    dispose(): void {
      if (!isDisposed) {
        isDisposed = true;
        sub.cleanupDeps();
        if (disposer) disposer();
      }
    },
    get isDisposed(): boolean {
      return isDisposed;
    },
    get read(): Accessor<T> {
      return memoAccessor;
    },
  };

  if (activeScope && !activeScope.isDisposed) {
    activeScope.disposables.add(comp);
  }

  return comp;
}

export function effect(fn: EffectFn, options?: EffectOptions): CleanupFn {
  const sub = new SubscriberImpl(
    options?.id || `sub_${++subscriberCounter}`,
    options?.name,
    options?.kind || 'effect'
  );
  let disposer: (() => void) | undefined;
  let runCount = 0;
  const MAX_RECURSION = 50;
  const createEffectRunner = options?.kind === 'dom_binding' ? solidCreateRenderEffect : solidCreateEffect;

  const runEffectBody = () => {
    createEffectRunner(() => {
      runCount++;
      if (runCount > MAX_RECURSION) {
        runCount = 0;
        throw new Error(
          `[TokenSafe Reactive Cycle] Maximum reactive update depth (${MAX_RECURSION}) exceeded in effect '${sub.name || sub.id}'. Possible infinite loop detected.`
        );
      }
      sub.cleanupDeps();
      const prevSub = currentSubscriber;
      currentSubscriber = sub;
      let cleanup: CleanupFn | void = undefined;
      try {
        cleanup = fn();
      } catch (err) {
        if (activeSignalWrites > 0) {
          lastEffectError = lastEffectError || err;
        } else {
          throw err;
        }
      } finally {
        currentSubscriber = prevSub;
      }
      if (typeof cleanup === 'function') {
        solidOnCleanup(cleanup);
      }
      queueMicrotask(() => {
        runCount = 0;
      });
    });
  };

  if (solidGetOwner()) {
    runEffectBody();
    disposer = () => sub.cleanupDeps();
  } else {
    solidCreateRoot((dispose) => {
      disposer = () => {
        sub.cleanupDeps();
        dispose();
      };
      runEffectBody();
    });
  }

  const cleanupFn: CleanupFn = () => {
    if (disposer) disposer();
  };

  if (activeScope && !activeScope.isDisposed) {
    activeScope.cleanups.add(cleanupFn);
  }

  return cleanupFn;
}




