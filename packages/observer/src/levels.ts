import { activeInstances } from '@agent-dom/core';
import type { SemanticElement, SemanticSnapshot } from './observer.js';

export type ObservationLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface ObservationOptions {
  level?: ObservationLevel;
  format?: 'yaml' | 'sexp' | 'json';
  componentId?: string;
  sourceCode?: string;
  maxElements?: number;
}

export interface PulseSnapshot {
  level: 'L0';
  route: string;
  mounted: string[];
  elements: number;
  errors: number;
}

export interface ContractSnapshot {
  level: 'L2';
  componentId: string;
  state: Record<string, { current: any; default?: any }>;
  actions: string[];
  elements: string[];
}

export interface SourceSnapshot {
  level: 'L3';
  componentId: string;
  lines: string[];
  agentIdLineMap: Record<string, number>;
}

export interface TraceSnapshot {
  level: 'L4';
  componentId: string;
  events: Array<{
    timestamp: number;
    type: string;
    details: string;
  }>;
}

/**
 * Progressive Context Disclosure Engine for AI Agents.
 * Generates L0–L4 observation payloads based on the agent's current focus.
 */
export function observe(
  root: HTMLElement,
  options: ObservationOptions = {}
): string | Record<string, any> {
  const level = options.level || 'L1';
  const format = options.format || 'yaml';

  switch (level) {
    case 'L0':
      return formatPayload(buildL0Pulse(root), format);
    case 'L1':
      return buildL1Surface(root, options, format);
    case 'L2':
      return formatPayload(buildL2Contract(root, options), format);
    case 'L3':
      return formatPayload(buildL3Source(root, options), format);
    case 'L4':
      return formatPayload(buildL4Traces(root, options), format);
  }
}

function buildL0Pulse(root: HTMLElement): PulseSnapshot {
  const mounted = Array.from(activeInstances.keys());
  let errorCount = 0;
  for (const instance of activeInstances.values()) {
    errorCount += instance.runtimeLog?.filter((e) => e.type === 'error').length || 0;
  }

  // Count interactive controls in root
  const interactiveCount = root.querySelectorAll(
    'button, input, select, textarea, a, [role="button"], [data-agent-action]'
  ).length;

  return {
    level: 'L0',
    route: typeof window !== 'undefined' ? window.location.pathname : '/',
    mounted,
    elements: interactiveCount,
    errors: errorCount,
  };
}

function buildL1Surface(
  root: HTMLElement,
  options: ObservationOptions,
  format: 'yaml' | 'sexp' | 'json'
): string | Record<string, any> {
  // L1 filters strictly for actionable controls (omits deep layout divs)
  const rootAgentId = root.getAttribute('data-agent-id') || 'root';
  const componentId = options.componentId || rootAgentId.split(':')[0] || 'app';

  const instance = activeInstances.get(componentId);
  const stateSnapshot: Record<string, any> = {};
  if (instance) {
    for (const [k, sig] of Object.entries(instance.signals)) {
      stateSnapshot[k] = sig.peek();
    }
  }

  const elements: SemanticElement[] = [];
  const allNodes = root.querySelectorAll(
    'button, input, select, textarea, a, h1, h2, h3, [role="button"], [data-agent-action], [data-agent-id]'
  );

  allNodes.forEach((node, idx) => {
    const el = node as HTMLElement;
    const agentId = el.getAttribute('data-agent-id');
    const action = el.getAttribute('data-agent-action');
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || tag;

    // Skip pure layout elements without agentId or action
    if (!agentId && !action && ['div', 'span', 'ul', 'li'].includes(tag)) {
      return;
    }

    const item: SemanticElement = {
      id: agentId || `${tag}#${idx}`,
      tag,
      role,
    };

    const text = (el.textContent || '').trim();
    if (text && text.length <= 40) {
      item.text = text;
    }

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') {
        item.state = { checked: el.checked };
      } else if (el.value) {
        item.value = el.value;
      }
    }

    if ((el as any).disabled) {
      item.state = { ...(item.state || {}), disabled: true };
    }

    if (action) {
      item.action = action;
    }

    elements.push(item);
  });

  const snapshot: SemanticSnapshot = {
    view: componentId,
    state: stateSnapshot,
    elements,
  };

  if (format === 'json') return snapshot;
  if (format === 'sexp') {
    const elementsStr = elements
      .map((e) => `(${e.tag}#${e.id}${e.action ? ` :act ${e.action}` : ''}${e.text ? ` "${e.text}"` : ''})`)
      .join(' ');
    return `(L1 view:${componentId} (elements ${elementsStr}))`;
  }

  // YAML
  const lines = [`level: L1`, `view: ${componentId}`];
  if (Object.keys(stateSnapshot).length > 0) {
    lines.push(`state: ${JSON.stringify(stateSnapshot)}`);
  }
  lines.push('elements:');
  for (const el of elements) {
    let line = `  - ${el.tag}#${el.id}`;
    const meta: string[] = [];
    if (el.action) meta.push(`action: ${el.action}`);
    if (el.state) meta.push(`state: ${JSON.stringify(el.state)}`);
    if (el.value !== undefined) meta.push(`val: ${JSON.stringify(el.value)}`);
    if (meta.length > 0) line += ` [${meta.join(', ')}]`;
    if (el.text) line += `: ${JSON.stringify(el.text)}`;
    lines.push(line);
  }
  return lines.join('\n');
}

function buildL2Contract(root: HTMLElement, options: ObservationOptions): ContractSnapshot {
  const rootAgentId = root.getAttribute('data-agent-id') || 'root';
  const componentId = options.componentId || rootAgentId.split(':')[0] || 'app';
  const instance = activeInstances.get(componentId);

  const stateDetails: Record<string, { current: any }> = {};
  const actions: string[] = [];

  if (instance) {
    for (const [k, sig] of Object.entries(instance.signals)) {
      stateDetails[k] = { current: sig.peek() };
    }
    actions.push(...Object.keys(instance.config.actions));
  }

  const elements: string[] = [];
  root.querySelectorAll('[data-agent-id]').forEach((el) => {
    const id = el.getAttribute('data-agent-id');
    if (id) elements.push(id);
  });

  return {
    level: 'L2',
    componentId,
    state: stateDetails,
    actions,
    elements,
  };
}

function buildL3Source(root: HTMLElement, options: ObservationOptions): SourceSnapshot {
  const rootAgentId = root.getAttribute('data-agent-id') || 'root';
  const componentId = options.componentId || rootAgentId.split(':')[0] || 'app';
  const source = options.sourceCode || `// Component: ${componentId}\n// Use agent_dom_inspect to load source from disk.`;

  const lines = source.split('\n').map((l, i) => `${String(i + 1).padStart(2, '0')} | ${l}`);
  const agentIdLineMap: Record<string, number> = {};

  source.split('\n').forEach((line, idx) => {
    const match = line.match(/data-agent-id=["']([^"']+)["']/);
    if (match) {
      agentIdLineMap[match[1]] = idx + 1;
    }
  });

  return {
    level: 'L3',
    componentId,
    lines,
    agentIdLineMap,
  };
}

function buildL4Traces(root: HTMLElement, options: ObservationOptions): TraceSnapshot {
  const rootAgentId = root.getAttribute('data-agent-id') || 'root';
  const componentId = options.componentId || rootAgentId.split(':')[0] || 'app';
  const instance = activeInstances.get(componentId);

  const events = (instance?.runtimeLog || []).map((e) => {
    let details = '';
    if (e.type === 'action_start') details = `Action '${e.actionName}' started`;
    else if (e.type === 'action_end') details = `Action '${e.actionName}' completed in ${e.durationMs}ms`;
    else if (e.type === 'signal_mutation')
      details = `Signal '${e.signalKey}' changed: ${JSON.stringify(e.oldValue)} -> ${JSON.stringify(e.newValue)}`;
    else if (e.type === 'error') details = `Error: ${e.error}`;

    return {
      timestamp: e.timestamp,
      type: e.type,
      details,
    };
  });

  return {
    level: 'L4',
    componentId,
    events,
  };
}

function formatPayload(payload: any, format: 'yaml' | 'sexp' | 'json'): string | Record<string, any> {
  if (format === 'json') return payload;

  const lines: string[] = [];
  lines.push(`level: ${payload.level}`);

  if (payload.componentId) lines.push(`component: ${payload.componentId}`);
  if (payload.route) lines.push(`route: ${payload.route}`);
  if (payload.mounted) lines.push(`mounted: [${payload.mounted.join(', ')}]`);
  if (payload.elements !== undefined) {
    if (Array.isArray(payload.elements)) {
      lines.push('elements:');
      for (const el of payload.elements) lines.push(`  - ${el}`);
    } else {
      lines.push(`elements_count: ${payload.elements}`);
    }
  }
  if (payload.errors !== undefined) lines.push(`errors_count: ${payload.errors}`);
  if (payload.actions) lines.push(`actions: [${payload.actions.join(', ')}]`);
  if (payload.state) lines.push(`state: ${JSON.stringify(payload.state)}`);

  if (payload.events) {
    lines.push('traces:');
    for (const ev of payload.events) {
      lines.push(`  - [${ev.type}] ${ev.details}`);
    }
  }

  if (payload.lines) {
    lines.push('source:');
    for (const l of payload.lines) {
      lines.push(`  ${l}`);
    }
  }

  return lines.join('\n');
}
