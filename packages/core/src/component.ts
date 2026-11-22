import { z } from 'zod';
import { signal, Signal } from './signals.js';
import type {
  StateSchema,
  ActionMap,
  ComponentConfig,
  ComponentInstance,
  InferState,
  ActionEmitters,
} from './types.js';

// Global registry for live component instances (used by observer & patcher)
export const activeInstances = new Map<string, ComponentInstance<any, any, any>>();

export function defineComponent<
  TSchema extends StateSchema,
  TActions extends ActionMap<InferState<TSchema>>,
  TProps = Record<string, any>
>(config: ComponentConfig<TSchema, TActions, TProps>) {
  // Schema validator
  const zodSchema = z.object(config.state);

  return function createComponent(props: TProps = {} as TProps): ComponentInstance<TSchema, TActions, TProps> {
    // 1. Initialize state with defaults or provided values
    const rawDefault = zodSchema.parse({});
    const stateSignals: Record<string, Signal<any>> = {};

    for (const [key, val] of Object.entries(rawDefault)) {
      stateSignals[key] = signal(val);
    }

    // Proxy to read reactive values seamlessly via state.<key>
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

    // 2. Wrap deterministic actions with AbortSignal and runtime telemetry
    const emit = {} as ActionEmitters<TActions>;
    const abortControllers = new Map<string, AbortController>();
    const runtimeLog: any[] = [];

    for (const [actionName, handler] of Object.entries(config.actions)) {
      (emit as any)[actionName] = async (payload?: any) => {
        const startTime = Date.now();

        // 2.1 Cancel previous in-flight invocation of this action
        const prevController = abortControllers.get(actionName);
        if (prevController) {
          prevController.abort();
        }
        const controller = new AbortController();
        abortControllers.set(actionName, controller);

        runtimeLog.push({
          timestamp: startTime,
          type: 'action_start',
          actionName,
        });

        try {
          // Collect current state snapshot
          const currentSnapshot: Record<string, any> = {};
          for (const [k, sig] of Object.entries(stateSignals)) {
            currentSnapshot[k] = sig.peek();
          }

          // Call handler supporting both sync (s, p) and async ({ state, signal }, p)
          let res: any;
          if (handler.length > 0 && typeof handler === 'function') {
            const firstArg =
              handler.toString().includes('signal') || handler.toString().includes('{ state')
                ? { state: stateProxy, signal: controller.signal }
                : currentSnapshot;
            res = (handler as any)(firstArg, payload);
          } else {
            res = (handler as any)(currentSnapshot, payload);
          }

          if (res instanceof Promise) {
            res = await res;
          }

          // If handler returned an updated state object, apply and validate
          if (res && typeof res === 'object') {
            const validated = zodSchema.parse(res);
            for (const [k, v] of Object.entries(validated)) {
              if (k in stateSignals && !Object.is(stateSignals[k].peek(), v)) {
                const oldVal = stateSignals[k].peek();
                stateSignals[k].value = v;
                runtimeLog.push({
                  timestamp: Date.now(),
                  type: 'signal_mutation',
                  actionName,
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
            actionName,
            durationMs: Date.now() - startTime,
          });
        } catch (err: any) {
          // If aborted, silently ignore
          if (controller.signal.aborted) {
            return;
          }
          runtimeLog.push({
            timestamp: Date.now(),
            type: 'error',
            actionName,
            error: err.message,
            durationMs: Date.now() - startTime,
          });
          throw err;
        } finally {
          if (abortControllers.get(actionName) === controller) {
            abortControllers.delete(actionName);
          }
        }
      };
    }

    // 3. Render pure vnode
    const vnode = config.render({
      state: stateProxy,
      signals: stateSignals as any,
      emit,
      props,
    });

    // Automatically ensure top-level root data-agent-id
    if (!vnode.props['data-agent-id']) {
      vnode.props['data-agent-id'] = `${config.id}:root`;
    }

    const instance: ComponentInstance<TSchema, TActions, TProps> = {
      id: config.id,
      config,
      signals: stateSignals as any,
      state: stateProxy,
      emit,
      props,
      vnode,
      runtimeLog,
    };

    activeInstances.set(config.id, instance);
    return instance;
  };
}
