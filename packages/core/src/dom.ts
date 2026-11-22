import type { AgentVNode, AgentChild, ComponentInstance } from './types.js';
import { effect, signal, Signal } from './signals.js';
import { Show, For, ErrorBoundary } from './control.js';

export function h(
  type: string | ((props: any) => AgentVNode),
  props: Record<string, any> | null,
  ...children: any[]
): AgentVNode {
  const normalizedProps = props || {};
  const flatChildren: AgentChild[] = children
    .flat()
    .filter((c) => c !== null && c !== undefined);

  if (flatChildren.length > 0 && !normalizedProps.children) {
    normalizedProps.children = flatChildren.length === 1 ? flatChildren[0] : flatChildren;
  }

  return {
    type,
    props: normalizedProps,
    children: flatChildren,
    agentId: normalizedProps['data-agent-id'],
  };
}

export function mount(instance: ComponentInstance<any, any, any>, container: HTMLElement): HTMLElement {
  const root = renderVNode(instance.vnode, instance);
  container.innerHTML = '';
  container.appendChild(root);
  if (root instanceof HTMLElement) {
    instance.rootElement = root;
    return root;
  }
  const wrapper = document.createElement('div');
  wrapper.appendChild(root);
  instance.rootElement = wrapper;
  return wrapper;
}

function renderVNode(node: AgentChild, instance: ComponentInstance<any, any, any>): Node {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return document.createTextNode(String(node));
  }

  if (Array.isArray(node)) {
    const fragment = document.createDocumentFragment();
    for (const child of node) {
      fragment.appendChild(renderVNode(child, instance));
    }
    return fragment;
  }

  if (!node || typeof node !== 'object') {
    return document.createTextNode('');
  }

  if (typeof node.type === 'function') {
    // 1. Show Component
    if (node.type === Show) {
      const container = document.createDocumentFragment();
      const startAnchor = document.createComment('agent-dom:show-start');
      const endAnchor = document.createComment('agent-dom:show-end');
      container.appendChild(startAnchor);
      container.appendChild(endAnchor);

      let currentNodes: Node[] = [];

      effect(() => {
        const whenVal =
          typeof node.props.when === 'function' ? node.props.when() : node.props.when;

        for (const n of currentNodes) {
          if (n.parentNode) n.parentNode.removeChild(n);
        }
        currentNodes = [];

        const branch = whenVal
          ? typeof node.props.children === 'function'
            ? node.props.children(whenVal)
            : node.props.children
          : node.props.fallback;

        if (branch !== null && branch !== undefined) {
          const rendered = renderVNode(branch, instance);
          const parent = endAnchor.parentNode || container;
          parent.insertBefore(rendered, endAnchor);
          currentNodes.push(rendered);
        }
      });

      return container;
    }

    // 2. For Component
    if (node.type === For) {
      const container = document.createDocumentFragment();
      const startAnchor = document.createComment('agent-dom:for-start');
      const endAnchor = document.createComment('agent-dom:for-end');
      container.appendChild(startAnchor);
      container.appendChild(endAnchor);

      type KeyItem = {
        key: any;
        node: Node;
        indexSignal: Signal<number>;
      };
      let currentMap = new Map<any, KeyItem>();

      effect(() => {
        const rawItems =
          typeof node.props.each === 'function'
            ? node.props.each()
            : node.props.each || [];
        const items = Array.isArray(rawItems) ? rawItems : [];
        const newMap = new Map<any, KeyItem>();
        const parent = endAnchor.parentNode || container;

        items.forEach((item: any, idx: number) => {
          let itemKey: any;
          if (typeof node.props.key === 'function') {
            itemKey = node.props.key(item, idx);
          } else if (node.props.key && typeof item === 'object') {
            itemKey = item[node.props.key];
          } else {
            itemKey = item?.id ?? item?.key ?? (typeof item === 'string' ? item : idx);
          }

          let existing = currentMap.get(itemKey);
          if (existing) {
            existing.indexSignal.value = idx;
            newMap.set(itemKey, existing);
            currentMap.delete(itemKey);
            parent.insertBefore(existing.node, endAnchor);
          } else {
            const indexSignal = signal(idx);
            const childVNode = node.props.children(item, () => indexSignal.value);
            const rendered = renderVNode(childVNode, instance);
            existing = { key: itemKey, node: rendered, indexSignal };
            newMap.set(itemKey, existing);
            parent.insertBefore(rendered, endAnchor);
          }
        });

        // Clean up removed items
        for (const [_, item] of currentMap) {
          if (item.node.parentNode) {
            item.node.parentNode.removeChild(item.node);
          }
        }

        currentMap = newMap;
      });

      return container;
    }

    // 3. Error Boundary Component
    if (node.type === ErrorBoundary) {
      try {
        return renderVNode(node.props.children, instance);
      } catch (err: any) {
        instance.runtimeLog.push({
          timestamp: Date.now(),
          type: 'error',
          error: `ErrorBoundary: ${err.message}`,
        });
        return renderVNode(node.props.fallback(err), instance);
      }
    }

    const childVNode = node.type(node.props);
    return renderVNode(childVNode, instance);
  }

  // Create native HTML Element
  const el = document.createElement(node.type);

  // Set props and reactive bindings
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'children') continue;

    if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, value);
    } else if (key === 'class' || key === 'className') {
      if (typeof value === 'function') {
        effect(() => {
          el.className = String(value());
        });
      } else {
        el.className = String(value);
      }
    } else if (key === 'style') {
      if (typeof value === 'object') {
        Object.assign(el.style, value);
      } else {
        el.setAttribute('style', String(value));
      }
    } else if (typeof value === 'function') {
      // Dynamic reactive attribute binding
      effect(() => {
        const val = value();
        if (typeof val === 'boolean') {
          if (val) el.setAttribute(key, '');
          else el.removeAttribute(key);
        } else {
          el.setAttribute(key, String(val));
        }
      });
    } else if (value !== false && value !== null && value !== undefined) {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }

  // Render children
  for (const child of node.children) {
    if (typeof child === 'function') {
      // Reactive text child binding
      const textNode = document.createTextNode('');
      effect(() => {
        textNode.textContent = String(child());
      });
      el.appendChild(textNode);
    } else {
      el.appendChild(renderVNode(child, instance));
    }
  }

  return el;
}

export function renderToString(instance: ComponentInstance<any, any, any>): string {
  const html = vnodeToString(instance.vnode);
  const stateSnapshot: Record<string, any> = {};
  for (const [k, sig] of Object.entries(instance.signals)) {
    stateSnapshot[k] = sig.peek();
  }

  const stateScript = `<script id="__AGENT_DOM_STATE__" type="application/json">${JSON.stringify({
    [instance.id]: stateSnapshot,
  })}</script>`;

  return `${html}\n${stateScript}`;
}

function vnodeToString(node: AgentChild): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return escapeHtml(String(node));
  }
  if (!node || typeof node !== 'object') {
    return '';
  }
  if (Array.isArray(node)) {
    return node.map(vnodeToString).join('');
  }
  if (typeof node.type === 'function') {
    if (node.type === Show) {
      const whenVal =
        typeof node.props.when === 'function' ? node.props.when() : node.props.when;
      const branch = whenVal
        ? typeof node.props.children === 'function'
          ? node.props.children(whenVal)
          : node.props.children
        : node.props.fallback;
      return branch ? vnodeToString(branch) : '';
    }
    if (node.type === For) {
      const rawItems =
        typeof node.props.each === 'function'
          ? node.props.each()
          : node.props.each || [];
      const items = Array.isArray(rawItems) ? rawItems : [];
      return items.map((item: any, idx: number) => {
        const childNode = node.props.children(item, () => idx);
        return vnodeToString(childNode);
      }).join('');
    }
    if (node.type === ErrorBoundary) {
      try {
        return vnodeToString(node.props.children);
      } catch (err: any) {
        return vnodeToString(node.props.fallback(err));
      }
    }
    return vnodeToString(node.type(node.props));
  }

  const attrs: string[] = [];
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'children' || key.startsWith('on')) continue;
    if (key === 'class' || key === 'className') {
      attrs.push(`class="${escapeHtml(String(value))}"`);
    } else if (typeof value === 'boolean') {
      if (value) attrs.push(key);
    } else if (value !== null && value !== undefined) {
      attrs.push(`${key}="${escapeHtml(String(value))}"`);
    }
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const childrenStr = node.children.map(vnodeToString).join('');

  return `<${node.type}${attrStr}>${childrenStr}</${node.type}>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
