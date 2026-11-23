import { signal, Signal, untrack } from './signals.js';

interface HookSlot {
  type: 'state' | 'ref' | 'memo';
  data: any;
}

export interface ComponentHookContext {
  slots: HookSlot[];
  effects: { fn: () => void | (() => void); cleanup?: () => void; deps?: any[]; isMounted?: boolean }[];
  hookIndex: number;
  effectIndex: number;
}

let currentHookContext: ComponentHookContext | null = null;

export function setCurrentHookContext(ctx: ComponentHookContext | null): void {
  currentHookContext = ctx;
}

export function getCurrentHookContext(): ComponentHookContext | null {
  return currentHookContext;
}

export function createHookContext(): ComponentHookContext {
  return {
    slots: [],
    effects: [],
    hookIndex: 0,
    effectIndex: 0,
  };
}

export function flushComponentEffects(ctx: ComponentHookContext): void {
  for (const eff of ctx.effects) {
    if (eff.cleanup) {
      try {
        eff.cleanup();
      } catch (err) {
        console.error('[TokenSafe UI Hook Error] Error in effect cleanup:', err);
      }
      eff.cleanup = undefined;
    }
    try {
      const cleanup = eff.fn();
      if (typeof cleanup === 'function') {
        eff.cleanup = cleanup;
      }
    } catch (err) {
      console.error('[TokenSafe UI Hook Error] Error in effect execution:', err);
    }
    eff.isMounted = true;
  }
}

export function disposeComponentEffects(ctx: ComponentHookContext): void {
  for (const eff of ctx.effects) {
    if (eff.cleanup) {
      try {
        eff.cleanup();
      } catch (err) {}
      eff.cleanup = undefined;
    }
  }
}

function depsChanged(prev?: any[], next?: any[]): boolean {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return true;
  }
  return false;
}

export function useState<T>(
  initialState: T | (() => T)
): [T, (nextState: T | ((prevState: T) => T)) => void] {
  const ctx = currentHookContext;
  if (!ctx) {
    const sig = signal<T>(
      typeof initialState === 'function' ? (initialState as any)() : initialState
    );
    const set = (next: any) => {
      sig.value = typeof next === 'function' ? next(sig.value) : next;
    };
    return [sig.value, set];
  }

  const idx = ctx.hookIndex++;
  if (idx >= ctx.slots.length) {
    const val = typeof initialState === 'function' ? (initialState as any)() : initialState;
    ctx.slots.push({
      type: 'state',
      data: signal(val, { name: `hook:state:${idx}` }),
    });
  }

  const sig: Signal<T> = ctx.slots[idx].data;
  const set = (next: any) => {
    const nextVal = typeof next === 'function' ? next(sig.peek()) : next;
    sig.value = nextVal;
  };

  return [sig.value, set];
}

export function useRef<T>(initialValue: T): { current: T } {
  const ctx = currentHookContext;
  if (!ctx) return { current: initialValue };

  const idx = ctx.hookIndex++;
  if (idx >= ctx.slots.length) {
    ctx.slots.push({
      type: 'ref',
      data: { current: initialValue },
    });
  }

  return ctx.slots[idx].data;
}

export function useMemo<T>(factory: () => T, deps?: any[]): T {
  const ctx = currentHookContext;
  if (!ctx) return factory();

  const idx = ctx.hookIndex++;
  if (idx >= ctx.slots.length) {
    const val = factory();
    ctx.slots.push({
      type: 'memo',
      data: { value: val, deps },
    });
    return val;
  }

  const entry = ctx.slots[idx].data;
  if (depsChanged(entry.deps, deps)) {
    entry.value = factory();
    entry.deps = deps;
  }

  return entry.value;
}

export function useCallback<T extends Function>(callback: T, deps?: any[]): T {
  return useMemo(() => callback, deps);
}

export function useEffect(
  effectFn: () => void | (() => void),
  deps?: any[]
): void {
  const ctx = currentHookContext;
  if (!ctx) {
    setTimeout(effectFn, 0);
    return;
  }

  const idx = ctx.effectIndex++;
  if (idx >= ctx.effects.length) {
    ctx.effects.push({
      fn: effectFn,
      deps,
      isMounted: false,
    });
  } else {
    const existing = ctx.effects[idx];
    if (depsChanged(existing.deps, deps)) {
      existing.fn = effectFn;
      existing.deps = deps;
      existing.isMounted = false;
    }
  }
}
