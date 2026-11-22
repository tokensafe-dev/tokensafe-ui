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

    // 2. Wrap deterministic actions
    const emit = {} as ActionEmitters<TActions>;
    for (const [actionName, handler] of Object.entries(config.actions)) {
      (emit as any)[actionName] = (payload?: any) => {
        // Collect current state snapshot
        const currentSnapshot: Record<string, any> = {};
        for (const [k, sig] of Object.entries(stateSignals)) {
          currentSnapshot[k] = sig.peek();
        }

        // Apply pure mutation
        const nextState = handler(currentSnapshot as any, payload);

        // Validate mutated state against schema
        const validated = zodSchema.parse(nextState);

        // Update signals
        for (const [k, v] of Object.entries(validated)) {
          if (k in stateSignals && !Object.is(stateSignals[k].peek(), v)) {
            stateSignals[k].value = v;
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
    };

    activeInstances.set(config.id, instance);
    return instance;
  };
}
