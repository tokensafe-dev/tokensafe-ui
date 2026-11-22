import { z } from 'zod';
import type { Signal } from './signals.js';

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

export interface ActionContext<TState> {
  state: TState;
  signal: AbortSignal;
}

export type ActionHandler<TState, TPayload = any> =
  | ((state: TState, payload: TPayload) => TState)
  | ((ctx: ActionContext<TState>, payload: TPayload) => Promise<void | TState> | void | TState);

export type ActionMap<TState> = Record<string, ActionHandler<TState, any>>;

export type ActionEmitters<TActions extends ActionMap<any>> = {
  [K in keyof TActions]: Parameters<TActions[K]>[1] extends undefined
    ? () => Promise<void>
    : (payload: Parameters<TActions[K]>[1]) => Promise<void>;
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
  TProps = Record<string, any>
> {
  id: string;
  state: TSchema;
  actions: TActions;
  render: (ctx: {
    state: InferState<TSchema>;
    signals: { [K in keyof InferState<TSchema>]: Signal<InferState<TSchema>[K]> };
    emit: ActionEmitters<TActions>;
    props: TProps;
  }) => AgentVNode;
}

export interface ComponentInstance<
  TSchema extends StateSchema,
  TActions extends ActionMap<InferState<TSchema>>,
  TProps = any
> {
  id: string;
  config: ComponentConfig<TSchema, TActions, TProps>;
  signals: { [K in keyof InferState<TSchema>]: Signal<InferState<TSchema>[K]> };
  state: InferState<TSchema>;
  emit: ActionEmitters<TActions>;
  props: TProps;
  vnode: AgentVNode;
  rootElement?: HTMLElement;
  runtimeLog: RuntimeTelemetryEvent[];
}
