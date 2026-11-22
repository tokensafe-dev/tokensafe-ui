import type { AgentNode, AgentVNode } from './types.js';

export interface ShowProps<T = any> {
  when: T | (() => T);
  fallback?: AgentNode;
  children: AgentNode | ((item: NonNullable<T>) => AgentNode);
}

export function Show<T>(props: ShowProps<T>): any {
  return props;
}

export interface ForProps<T = any> {
  each: T[] | (() => T[]);
  key?: keyof T | ((item: T, index: number) => any);
  children: (item: T, index: () => number) => AgentNode;
}

export function For<T>(props: ForProps<T>): any {
  return props;
}

export interface ErrorBoundaryProps {
  fallback: (error: Error) => AgentNode;
  children?: AgentNode;
}

export function ErrorBoundary(props: ErrorBoundaryProps): any {
  return props;
}
