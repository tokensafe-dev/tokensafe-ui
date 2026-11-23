import { z } from 'zod';
import type { Signal, ReactiveScope } from './signals.js';

export type AgentChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | ((...args: any[]) => any)
  | AgentVNode;

export type AgentNode = AgentChild | AgentChild[];

export interface AgentVNodeProps {
  [key: string]: any;
  class?: string | (() => string);
  className?: string | (() => string);
  style?: string | Record<string, string>;
  children?: any;
  'data-agent-id'?: string;
  onClick?: (e: any) => void;
  onChange?: (e: any) => void;
  onInput?: (e: any) => void;
  onSubmit?: (e: any) => void;
}

export interface AgentVNode {
  type: string | ((props: any) => any);
  props: AgentVNodeProps;
  children: AgentChild[];
  agentId?: string;
  isControlFlow?: boolean;
}

export type StateSchema = Record<string, z.ZodTypeAny>;

export type InferState<T extends StateSchema> = {
  [K in keyof T]: z.infer<T[K]>;
};

// Pure, deterministic synchronous state reducer
export type ActionReducer<TState, TPayload = any> = (state: TState, payload: TPayload) => TState;

export interface LegacyActionContext<TState> {
  state: TState;
  signal: AbortSignal;
}

export type ActionHandler<TState, TPayload = any> =
  | ActionReducer<TState, TPayload>
  | ((ctx: LegacyActionContext<TState>, payload: TPayload) => Promise<void | TState> | void | TState);

export type ActionMap<TState> = Record<string, ActionHandler<TState, any>>;

// Concurrency policies for async effects
export type ConcurrencyPolicy = 'latest-wins' | 'take-leading' | 'queue' | 'parallel';

export interface EffectContext<TState> {
  dispatch: (actionName: string, payload?: any) => TState;
  signal: AbortSignal;
  state: Readonly<TState>;
}

export type EffectHandler<TState, TPayload = any> = (
  ctx: EffectContext<TState>,
  payload: TPayload
) => Promise<void> | void;

export interface EffectConfig<TState, TPayload = any> {
  concurrency?: ConcurrencyPolicy;
  handler: EffectHandler<TState, TPayload>;
}

export type EffectItem<TState, TPayload = any> =
  | EffectHandler<TState, TPayload>
  | EffectConfig<TState, TPayload>;

export type EffectMap<TState> = Record<string, EffectItem<TState, any>>;

export type ActionEmitters<
  TActions extends ActionMap<any> = Record<string, any>,
  TEffects extends EffectMap<any> = Record<string, any>
> = {
  [K in keyof TActions]: Parameters<TActions[K]>[1] extends undefined
    ? () => any
    : (payload: Parameters<TActions[K]>[1]) => any;
} & {
  [K in keyof TEffects]: TEffects[K] extends EffectConfig<any, infer TPayload>
    ? (payload?: TPayload) => Promise<void>
    : TEffects[K] extends (ctx: any, payload: infer TPayload) => any
    ? (payload?: TPayload) => Promise<void>
    : (payload?: any) => Promise<void>;
};

export interface RuntimeTelemetryEvent {
  timestamp: number;
  type: 'action_start' | 'action_end' | 'signal_mutation' | 'error';
  actionName?: string;
  signalKey?: string;
  oldValue?: any;
  newValue?: any;
  error?: string;
  durationMs?: number;
}

export interface ComponentConfig<
  TSchema extends StateSchema,
  TActions extends ActionMap<InferState<TSchema>>,
  TEffects extends EffectMap<InferState<TSchema>> = {},
  TProps = Record<string, any>
> {
  id: string;
  state: TSchema;
  actions: TActions;
  effects?: TEffects;
  filePath?: string;
  initialState?: Partial<InferState<TSchema>>;
  onMount?: (ctx: {
    state: InferState<TSchema>;
    emit: ActionEmitters<TActions, TEffects>;
    dispatch: (actionName: keyof TActions, payload?: any) => InferState<TSchema>;
  }) => void | (() => void);
  onUnmount?: () => void;
  render: (ctx: {
    state: InferState<TSchema>;
    signals: { [K in keyof InferState<TSchema>]: Signal<InferState<TSchema>[K]> };
    emit: ActionEmitters<TActions, TEffects>;
    dispatch: (actionName: keyof TActions, payload?: any) => InferState<TSchema>;
    props: TProps;
  }) => AgentVNode;
}

export interface ComponentInstance<
  TSchema extends StateSchema,
  TActions extends ActionMap<InferState<TSchema>>,
  TEffects extends EffectMap<InferState<TSchema>> = {},
  TProps = any
> {
  id: string;
  config: ComponentConfig<TSchema, TActions, TEffects, TProps>;
  signals: { [K in keyof InferState<TSchema>]: Signal<InferState<TSchema>[K]> };
  state: InferState<TSchema>;
  emit: ActionEmitters<TActions, TEffects>;
  dispatch: (actionName: keyof TActions, payload?: any) => InferState<TSchema>;
  props: TProps;
  vnode: AgentVNode;
  rootElement?: HTMLElement;
  runtimeLog: RuntimeTelemetryEvent[];
  abortAll: () => void;
  unmount: () => void;
  isMounted: boolean;
  scope?: ReactiveScope;
}

declare global {
  namespace JSX {
    interface Element extends AgentVNode {}
    interface ElementClass {
      render(): any;
    }
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
