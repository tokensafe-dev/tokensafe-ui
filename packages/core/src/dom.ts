import type { AgentVNode, AgentChild, ComponentInstance } from './types.js';
import { effect } from './signals.js';

export function h(
  type: string | ((props: any) => AgentVNode),
  props: Record<string, any> | null,
  ...children: any[]
): AgentVNode {
  const normalizedProps = props || {};
  const flatChildren: AgentChild[] = children
    .flat()
    .filter((c) => c !== null && c !== undefined);

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
