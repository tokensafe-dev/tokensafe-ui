import { activeInstances } from '@tokensafe-ui/core';

export interface SemanticElement {
  id: string;
  tag: string;
  role: string;
  text?: string;
  value?: any;
  state?: Record<string, any>;
  action?: string;
}

export interface SemanticSnapshot {
  view: string;
  state: Record<string, any>;
  elements: SemanticElement[];
}

export interface SnapshotOptions {
  format?: 'yaml' | 'sexp' | 'json';
  maxElements?: number;
}

/**
 * Extracts a compact semantic projection of the UI (<150 tokens)
 * designed specifically for AI agent context windows.
 */
export function getSemanticSnapshot(
  root: HTMLElement,
  options: SnapshotOptions = {}
): string | SemanticSnapshot {
  const format = options.format || 'yaml';
  const maxElements = options.maxElements || 50;

  // Determine root component view id
  const rootAgentId = root.getAttribute('data-agent-id') || 'root';
  const componentId = rootAgentId.split(':')[0] || 'app';

  // Read active state from component instance if registered
  const instance = activeInstances.get(componentId);
  const stateSnapshot: Record<string, any> = {};
  if (instance) {
    for (const [k, sig] of Object.entries(instance.signals)) {
      stateSnapshot[k] = sig.peek();
    }
  }

  // Collect semantic elements
  const elements: SemanticElement[] = [];
  collectSemanticElements(root, elements, maxElements);

  const snapshot: SemanticSnapshot = {
    view: componentId,
    state: stateSnapshot,
    elements,
  };

  if (format === 'json') {
    return snapshot;
  }

  if (format === 'sexp') {
    return formatAsSExp(snapshot);
  }

  return formatAsYaml(snapshot);
}

function collectSemanticElements(
  el: Element,
  elements: SemanticElement[],
  max: number
): void {
  if (elements.length >= max) return;

  const agentId = el.getAttribute('data-agent-id');
  const role = el.getAttribute('role') || inferRole(el);
  const isInteractive = isInteractiveElement(el, role);

  if (agentId || isInteractive) {
    const semEl: SemanticElement = {
      id: agentId || `${el.tagName.toLowerCase()}#${elements.length}`,
      tag: el.tagName.toLowerCase(),
      role,
    };

    // Extract clean text (excluding child elements text if too deep)
    const text = getDirectText(el).trim();
    if (text) {
      semEl.text = text;
    }

    // Extract form values & interactive states
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') {
        semEl.state = { checked: el.checked };
      } else {
        semEl.value = el.value;
      }
    } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      semEl.value = el.value;
    }

    if ((el as any).disabled) {
      semEl.state = { ...(semEl.state || {}), disabled: true };
    }

    const action = el.getAttribute('data-agent-action');
    if (action) {
      semEl.action = action;
    }

    elements.push(semEl);
  }

  for (const child of Array.from(el.children)) {
    collectSemanticElements(child, elements, max);
  }
}

function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'button':
      return 'button';
    case 'input':
      return (el as HTMLInputElement).type || 'input';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'a':
      return 'link';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'form':
      return 'form';
    case 'table':
      return 'table';
    default:
      return 'generic';
  }
}

function isInteractiveElement(el: Element, role: string): boolean {
  if (['button', 'input', 'combobox', 'textbox', 'link', 'checkbox', 'radio'].includes(role)) {
    return true;
  }
  return el.hasAttribute('onclick') || el.hasAttribute('data-agent-action');
}

function getDirectText(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  }
  return text || el.textContent || '';
}

function formatAsYaml(snapshot: SemanticSnapshot): string {
  const lines: string[] = [];
  lines.push(`view: ${snapshot.view}`);

  if (Object.keys(snapshot.state).length > 0) {
    lines.push(`state: ${JSON.stringify(snapshot.state)}`);
  }

  lines.push('elements:');
  for (const el of snapshot.elements) {
    let line = `  - ${el.tag}#${el.id}`;
    const meta: string[] = [];
    if (el.role && el.role !== 'generic' && el.role !== el.tag) {
      meta.push(`role: ${el.role}`);
    }
    if (el.action) {
      meta.push(`action: ${el.action}`);
    }
    if (el.state) {
      meta.push(`state: ${JSON.stringify(el.state)}`);
    }
    if (el.value !== undefined) {
      meta.push(`val: ${JSON.stringify(el.value)}`);
    }
    if (meta.length > 0) {
      line += ` [${meta.join(', ')}]`;
    }
    if (el.text) {
      line += `: ${JSON.stringify(el.text)}`;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

function formatAsSExp(snapshot: SemanticSnapshot): string {
  const stateStr = Object.entries(snapshot.state)
    .map(([k, v]) => `(${k} ${JSON.stringify(v)})`)
    .join(' ');

  const elementsStr = snapshot.elements
    .map((el) => {
      const parts = [`${el.tag}#${el.id}`];
      if (el.action) parts.push(`:act ${el.action}`);
      if (el.text) parts.push(`"${el.text}"`);
      return `(${parts.join(' ')})`;
    })
    .join(' ');

  return `(view ${snapshot.view} (state ${stateStr}) (elements ${elementsStr}))`;
}
