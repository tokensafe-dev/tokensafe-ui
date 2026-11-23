import { z } from 'zod';
import { signal, Signal } from './signals.js';
import type {
  StateSchema,
  ActionMap,
  EffectMap,
  EffectItem,
  EffectHandler,
  ConcurrencyPolicy,
  ComponentConfig,
  ComponentInstance,
  InferState,
  ActionEmitters,
  RuntimeTelemetryEvent,
} from './types.js';

import { GLOBAL_KEYS, getGlobalRegistry } from './globals.js';

// Global registry for live component instances (used by observer & patcher)
export const activeInstances: Map<string, ComponentInstance<any, any, any, any>> =
  getGlobalRegistry(GLOBAL_KEYS.ACTIVE_INSTANCES, () => new Map<string, ComponentInstance<any, any, any, any>>());

export function defineComponent<
  TSchema extends StateSchema,
  TActions extends ActionMap<InferState<TSchema>>,
  TEffects extends EffectMap<InferState<TSchema>> = {},
  TProps = Record<string, any>
>(config: ComponentConfig<TSchema, TActions, TEffects, TProps>) {
  // Schema validator
  const zodSchema = z.object(config.state);

  return function createComponent(props: TProps = {} as TProps): ComponentInstance<TSchema, TActions, TEffects, TProps> {
    let instance: ComponentInstance<TSchema, TActions, TEffects, TProps>;

    // 1. Initialize state with defaults or provided values
    const initialOverrides = (props as any)?.initialState || config.initialState || {};
    const rawDefault = zodSchema.parse(initialOverrides);
    const existingSignals = (props as any)?._existingSignals;
    const stateSignals: Record<string, Signal<any>> = {};

    for (const [key, val] of Object.entries(rawDefault)) {
      if (existingSignals && existingSignals[key]) {
        stateSignals[key] = existingSignals[key];
        stateSignals[key].value = val;
      } else {
        stateSignals[key] = signal(val, { name: `${config.id}.${key}` });
      }
    }

    // Proxy to read/write reactive values seamlessly via state.<key>
    const stateProxy = new Proxy({} as InferState<TSchema>, {
      get(_, prop: string) {
        if (prop in stateSignals) {
          return stateSignals[prop].value;
        }
        return undefined;
      },
      set(_, prop: string, value) {
        if (prop in stateSignals) {
          stateSignals[prop].value = value;
          return true;
        }
        return false;
      },
    });

    const runtimeLog: RuntimeTelemetryEvent[] = [];
    const activeAbortControllers = new Set<AbortController>();

    // 2. Pure Synchronous Reducer Dispatcher
    const dispatch = (actionName: keyof TActions | string, payload?: any): InferState<TSchema> => {
      const handler = config.actions[actionName as string];
      if (!handler) {
        throw new Error(`Action '${String(actionName)}' not defined on component '${config.id}'.`);
      }

      const startTime = Date.now();
      runtimeLog.push({
        timestamp: startTime,
        type: 'action_start',
        actionName: String(actionName),
      });

      // Snapshot current state
      const currentSnapshot: Record<string, any> = {};
      for (const [k, sig] of Object.entries(stateSignals)) {
        currentSnapshot[k] = sig.peek();
      }

      try {
        const nextState = handler(currentSnapshot as any, payload);

        // Check if legacy async returned a promise
        if (nextState instanceof Promise) {
          throw new Error(
            `Action '${String(actionName)}' returned a Promise. Asynchronous operations must be defined under 'effects', not 'actions'.`
          );
        }

        if (nextState && typeof nextState === 'object') {
          const validated = zodSchema.parse(nextState);
          for (const [k, v] of Object.entries(validated)) {
            if (k in stateSignals && !Object.is(stateSignals[k].peek(), v)) {
              const oldVal = stateSignals[k].peek();
              stateSignals[k].value = v;
              runtimeLog.push({
                timestamp: Date.now(),
                type: 'signal_mutation',
                actionName: String(actionName),
                signalKey: k,
                oldValue: oldVal,
                newValue: v,
              });
            }
          }
        }

        runtimeLog.push({
          timestamp: Date.now(),
          type: 'action_end',
          actionName: String(actionName),
          durationMs: Date.now() - startTime,
        });

        return stateProxy;
      } catch (err: any) {
        runtimeLog.push({
          timestamp: Date.now(),
          type: 'error',
          actionName: String(actionName),
          error: err.message,
          durationMs: Date.now() - startTime,
        });
        throw err;
      }
    };

    // 3. Effect Runtime & Concurrency Manager
    const effectControllers = new Map<string, AbortController>();
    const inFlightEffects = new Map<string, boolean>();
    const effectQueues = new Map<string, Promise<any>>();

    const executeEffectSingle = async (
      effectName: string,
      handler: EffectHandler<InferState<TSchema>>,
      payload: any,
      isTakeLeading = false
    ): Promise<void> => {
      const controller = new AbortController();
      effectControllers.set(effectName, controller);
      activeAbortControllers.add(controller);
      if (isTakeLeading) inFlightEffects.set(effectName, true);

      const startTime = Date.now();
      runtimeLog.push({
        timestamp: startTime,
        type: 'action_start',
        actionName: effectName,
      });

      try {
        const ctx = {
          dispatch: (name: string, p?: any) => (instance ? instance.dispatch(name as any, p) : dispatch(name as any, p)),
          signal: controller.signal,
          state: stateProxy,
        };

        const res = handler(ctx, payload);
        if (res instanceof Promise) {
          await res;
        }

        runtimeLog.push({
          timestamp: Date.now(),
          type: 'action_end',
          actionName: effectName,
          durationMs: Date.now() - startTime,
        });
      } catch (err: any) {
        if (controller.signal.aborted) {
          return;
        }
        runtimeLog.push({
          timestamp: Date.now(),
          type: 'error',
          actionName: effectName,
          error: err.message,
          durationMs: Date.now() - startTime,
        });
        throw err;
      } finally {
        activeAbortControllers.delete(controller);
        if (effectControllers.get(effectName) === controller) {
          effectControllers.delete(effectName);
        }
        if (isTakeLeading) inFlightEffects.delete(effectName);
      }
    };

    const runEffect = async (
      effectName: string,
      effectDef: EffectItem<InferState<TSchema>>,
      payload?: any
    ): Promise<void> => {
      let concurrency: ConcurrencyPolicy = 'latest-wins';
      let handler: EffectHandler<InferState<TSchema>>;

      if (typeof effectDef === 'function') {
        handler = effectDef;
      } else {
        concurrency = effectDef.concurrency || 'latest-wins';
        handler = effectDef.handler;
      }

      // 3.1 'take-leading' policy: drop invocations while one is in-flight
      if (concurrency === 'take-leading') {
        if (inFlightEffects.get(effectName)) {
          return;
        }
      }

      // 3.2 'queue' policy: sequential execution chain
      if (concurrency === 'queue') {
        const prevQueue = effectQueues.get(effectName) || Promise.resolve();
        const nextPromise = prevQueue.then(async () => {
          await executeEffectSingle(effectName, handler, payload);
        }).catch(() => {
          // Keep queue moving even if previous invocation threw
        });
        effectQueues.set(effectName, nextPromise);
        return nextPromise;
      }

      // 3.3 'latest-wins' policy: abort previous in-flight invocation
      if (concurrency === 'latest-wins') {
        const prev = effectControllers.get(effectName);
        if (prev) {
          prev.abort();
          activeAbortControllers.delete(prev);
        }
      }

      // 3.4 Execute 'latest-wins', 'parallel', or 'take-leading'
      await executeEffectSingle(effectName, handler, payload, concurrency === 'take-leading');
    };

    // 4. Construct emit object combining actions & effects
    const emit = {} as ActionEmitters<TActions, TEffects>;

    // 4.1 Bind actions
    if (config.actions) {
      for (const [actionName, actionHandler] of Object.entries(config.actions)) {
        // Backward compatibility: detect if handler is async or receives `{ state, signal }`
        const isAsync =
          actionHandler.constructor.name === 'AsyncFunction' ||
          actionHandler.toString().includes('signal') ||
          actionHandler.toString().includes('{ state');

        if (isAsync) {
          const fn = (payload?: any) =>
            runEffect(
              actionName,
              {
                concurrency: 'latest-wins',
                handler: async (ctx, p) => {
                  return (actionHandler as any)(ctx, p);
                },
              },
              payload
            );
          (fn as any)._actionName = actionName;
          (emit as any)[actionName] = fn;
        } else {
          const fn = (payload?: any) => dispatch(actionName, payload);
          (fn as any)._actionName = actionName;
          (emit as any)[actionName] = fn;
        }
      }
    }

    // 4.2 Bind effects
    if (config.effects) {
      for (const [effectName, effectItem] of Object.entries(config.effects)) {
        const fn = (payload?: any) => runEffect(effectName, effectItem, payload);
        (fn as any)._actionName = effectName;
        (emit as any)[effectName] = fn;
      }
    }

    // 5. Render pure vnode
    const vnode = config.render({
      state: stateProxy,
      signals: stateSignals as any,
      emit,
      dispatch,
      props,
    });

    // Automatically ensure top-level root data-agent-id
    if (!vnode.props['data-agent-id']) {
      vnode.props['data-agent-id'] = `${config.id}:root`;
    }

    const abortAll = () => {
      for (const controller of activeAbortControllers) {
        controller.abort();
      }
      activeAbortControllers.clear();
      effectControllers.clear();
      inFlightEffects.clear();
    };

    const cleanups = new Set<() => void>();
    let isMounted = false;

    const unmount = () => {
      if (!isMounted && !activeInstances.has(config.id)) return;
      isMounted = false;

      // 1. Abort any in-flight async effects
      abortAll();

      // 2. Run all registered cleanups
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {}
      }
      cleanups.clear();

      // 3. Remove DOM element from document if present
      if (instance.rootElement && instance.rootElement.parentNode) {
        instance.rootElement.parentNode.removeChild(instance.rootElement);
      }

      // 4. Remove instance from activeInstances registry
      if (activeInstances.get(config.id) === instance) {
        activeInstances.delete(config.id);
      }

      // 5. Fire onUnmount hook
      if (typeof config.onUnmount === 'function') {
        try {
          config.onUnmount();
        } catch {}
      }
    };

    instance = {
      id: config.id,
      config,
      signals: stateSignals as any,
      state: stateProxy,
      emit,
      dispatch,
      props,
      vnode,
      runtimeLog,
      abortAll,
      unmount,
      get isMounted() {
        return isMounted;
      },
      set isMounted(val: boolean) {
        isMounted = val;
      },
    };

    (instance as any)._cleanups = cleanups;

    activeInstances.set(config.id, instance);
    return instance;
  };
}

/**
 * Hot-reloads an active component instance in memory while preserving its active state signals.
 * Replaces actions, effects, and render function with the new configuration.
 */
export function hotReloadComponent(
  id: string,
  newConfigOrFactory: ComponentConfig<any, any, any, any> | ((...args: any[]) => any)
): ComponentInstance<any, any, any, any> | null {
  const existing = activeInstances.get(id);

  if (!existing) {
    if (typeof newConfigOrFactory === 'function') {
      return (newConfigOrFactory as any)();
    }
    return null;
  }

  let newConfig: ComponentConfig<any, any, any, any>;
  if (typeof newConfigOrFactory === 'function') {
    const tempInstance = (newConfigOrFactory as any)(existing.props);
    newConfig = tempInstance.config;
    // Restore existing in activeInstances
    activeInstances.set(id, existing);
  } else {
    newConfig = newConfigOrFactory;
  }

  // 1. Preserve and validate existing signals
  const currentState: Record<string, any> = {};
  for (const [k, sig] of Object.entries(existing.signals)) {
    currentState[k] = (sig as any).peek();
  }

  // 2. Abort any previous in-flight effects
  existing.abortAll();

  // 3. Update config reference
  existing.config = newConfig;

  // 4. Re-bind actions and effects using the new component factory logic, passing existing signals
  const factory = defineComponent(newConfig);
  const freshInstance = factory({
    ...existing.props,
    initialState: currentState,
    _existingSignals: existing.signals,
  } as any);

  // Transfer methods & emitters to existing instance
  existing.dispatch = freshInstance.dispatch;
  existing.emit = freshInstance.emit;
  existing.vnode = freshInstance.vnode;
  existing.abortAll = freshInstance.abortAll;

  // Keep same instance identity in registry
  activeInstances.set(id, existing);

  return existing;
}
