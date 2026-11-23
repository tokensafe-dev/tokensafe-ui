import type { AgentVNode, AgentChild, ComponentInstance } from './types.js';
import { effect, signal, Signal, createScope, ReactiveScope, untrack } from './signals.js';
import { Show, For, ErrorBoundary } from './control.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline',
  'ellipse', 'g', 'defs', 'clipPath', 'mask', 'pattern', 'text',
  'tspan', 'use', 'image', 'symbol', 'linearGradient', 'radialGradient', 'stop'
]);

export function h(
  type: any,
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

export function Fragment(props: any): any {
  return props?.children || [];
}

export function mount(
  instanceOrVNode: ComponentInstance<any, any, any> | AgentChild,
  container?: HTMLElement
): HTMLElement {
  const targetContainer = container || document.createElement('div');
  // If container already hosts an active component, unmount it cleanly first
  const prevInstance = (targetContainer as any).__tokensafe_instance__;
  if (prevInstance && typeof prevInstance.unmount === 'function') {
    prevInstance.unmount();
  }

  let root: Node;
  let instance: any = null;

  if (instanceOrVNode && typeof instanceOrVNode === 'object' && 'vnode' in (instanceOrVNode as any)) {
    instance = instanceOrVNode as ComponentInstance<any, any, any>;
    root = instance.scope
      ? instance.scope.run(() => renderVNode(instance.vnode, instance))
      : renderVNode(instance.vnode, instance);
    instance.isMounted = true;
    (targetContainer as any).__tokensafe_instance__ = instance;
  } else {
    root = renderVNode(instanceOrVNode as any);
  }

  targetContainer.innerHTML = '';
  targetContainer.appendChild(root);

  if (instance) {
    if (root instanceof HTMLElement) {
      instance.rootElement = root;
    } else {
      const wrapper = document.createElement('div');
      wrapper.appendChild(root);
      instance.rootElement = wrapper;
    }

    // Execute onMount lifecycle hook if provided
    if (typeof instance.config?.onMount === 'function') {
      try {
        const mountCleanup = instance.config.onMount({
          state: instance.state,
          emit: instance.emit,
          dispatch: instance.dispatch,
        });
        if (typeof mountCleanup === 'function') {
          (instance as any)._cleanups?.add(mountCleanup);
        }
      } catch (err: any) {
        instance.runtimeLog?.push({
          timestamp: Date.now(),
          type: 'error',
          error: `onMount hook error: ${err.message}`,
        });
      }
    }

    return instance.rootElement;
  }

  return root instanceof HTMLElement ? root : targetContainer;
}

export function unmount(target: ComponentInstance<any, any, any> | HTMLElement): void {
  if (!target) return;
  if ('unmount' in target && typeof (target as any).unmount === 'function') {
    (target as any).unmount();
  } else if (target instanceof HTMLElement && (target as any).__tokensafe_instance__) {
    (target as any).__tokensafe_instance__.unmount();
    delete (target as any).__tokensafe_instance__;
  }
}

export interface FormBindingProps {
  value?: any;
  checked?: boolean;
  onInput?: (e: any) => void;
  onChange?: (e: any) => void;
}

/**
 * Two-way form binding helper for inputs, checkboxes, and select elements.
 * Supports:
 * - bind(emit.setTitle, state.title)
 * - bind(emit, 'title', state)
 * - bind(signal)
 */
export function bind<T = any>(
  target: any,
  valueOrKey?: any,
  stateObj?: any
): FormBindingProps {
  // Case 1: Raw Signal passed: bind(mySignal)
  if (target && typeof target === 'object' && 'value' in target && typeof target.peek === 'function') {
    const sig = target as Signal<any>;
    const isBool = typeof sig.peek() === 'boolean';
    if (isBool) {
      return {
        checked: sig.peek(),
        onChange: (e: any) => {
          sig.value = e && e.target !== undefined ? e.target.checked : Boolean(e);
        },
      };
    }
    return {
      value: sig.peek(),
      onInput: (e: any) => {
        sig.value = e && e.target !== undefined ? e.target.value : e;
      },
      onChange: (e: any) => {
        sig.value = e && e.target !== undefined ? e.target.value : e;
      },
    };
  }

  // Case 2: Component Emitters object: bind(emit, 'title', state)
  if (typeof target === 'object' && typeof valueOrKey === 'string' && stateObj) {
    const key = valueOrKey;
    const actionName =
      target[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`] ||
      target[key];
    const val = stateObj[key];
    return bind(actionName, val);
  }

  // Case 3: Action emitter function and value: bind(emit.setTitle, state.title)
  if (typeof target === 'function') {
    const emitter = target;
    const isBool = typeof valueOrKey === 'boolean';
    if (isBool) {
      return {
        checked: Boolean(valueOrKey),
        onChange: (e: any) => {
          emitter(e && e.target !== undefined ? e.target.checked : Boolean(e));
        },
      };
    }

    return {
      value: valueOrKey !== undefined && valueOrKey !== null ? valueOrKey : '',
      onInput: (e: any) => {
        const val =
          e && e.target !== undefined
            ? e.target.type === 'checkbox'
              ? e.target.checked
              : e.target.value
            : e;
        emitter(val);
      },
      onChange: (e: any) => {
        const val =
          e && e.target !== undefined
            ? e.target.type === 'checkbox'
              ? e.target.checked
              : e.target.value
            : e;
        emitter(val);
      },
    };
  }

  return {};
}

/**
 * Isomorphic Client-Side Hydration Engine.
 * Attaches event listeners and reactive signal bindings to server-rendered HTML nodes
 * without wiping the container or recreating DOM elements.
 */
export function hydrate(
  instance: ComponentInstance<any, any, any>,
  container: HTMLElement
): HTMLElement {
  const existingRoot = container.firstElementChild;
  if (!existingRoot) {
    return mount(instance, container);
  }

  try {
    hydrateNode(existingRoot, instance.vnode, instance);
    instance.rootElement = existingRoot as HTMLElement;
    return existingRoot as HTMLElement;
  } catch (err: any) {
    console.warn(`[TokenSafe UI Hydration Warning] Mismatch: ${err.message}. Re-mounting on client.`);
    return mount(instance, container);
  }
}

function hydrateNode(
  domNode: Node,
  vnode: AgentChild,
  instance: ComponentInstance<any, any, any>
): void {
  if (!vnode || typeof vnode !== 'object') return;

  if (typeof vnode.type === 'function') {
    return;
  }

  if (domNode.nodeType === 1 && typeof vnode.type === 'string') {
    const el = domNode as HTMLElement;

    // Attach event listeners & reactive property effects
    for (const [key, value] of Object.entries(vnode.props || {})) {
      if (key === 'children') continue;

      if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.slice(2).toLowerCase();
        el.addEventListener(eventName, value);
      } else if (key === 'class' || key === 'className') {
        if (typeof value === 'function') {
          const agentId = el.getAttribute('data-agent-id') || el.tagName.toLowerCase();
          effect(() => {
            el.className = String(value());
          }, {
            name: `dom:${agentId}.class`,
            kind: 'dom_binding',
          });
        }
      } else if (typeof value === 'function') {
        const agentId = el.getAttribute('data-agent-id') || el.tagName.toLowerCase();
        effect(() => {
          const val = value();
          if (typeof val === 'boolean') {
            if (val) el.setAttribute(key, '');
            else el.removeAttribute(key);
          } else {
            el.setAttribute(key, String(val));
          }
        }, {
          name: `dom:${agentId}.${key}`,
          kind: 'dom_binding',
        });
      }
    }

    // Hydrate children
    const childNodes = Array.from(el.childNodes);
    const vnodeChildren = vnode.children || [];
    let childDomIdx = 0;

    for (let i = 0; i < vnodeChildren.length; i++) {
      const vChild = vnodeChildren[i];
      if (typeof vChild === 'function') {
        // Find matching text node
        const targetTextNode = childNodes[childDomIdx];
        if (targetTextNode && targetTextNode.nodeType === 3) {
          const parentAgentId = el.getAttribute('data-agent-id') || el.tagName.toLowerCase();
          effect(() => {
            targetTextNode.textContent = String(vChild());
          }, {
            name: `dom:${parentAgentId}.text`,
            kind: 'dom_binding',
          });
          childDomIdx++;
        }
      } else if (vChild && typeof vChild === 'object' && 'type' in vChild) {
        while (childDomIdx < childNodes.length && childNodes[childDomIdx].nodeType !== 1) {
          childDomIdx++;
        }
        if (childDomIdx < childNodes.length) {
          hydrateNode(childNodes[childDomIdx], vChild, instance);
          childDomIdx++;
        }
      } else if (typeof vChild === 'string' || typeof vChild === 'number') {
        childDomIdx++;
      }
    }
  }
}

function convertReactNode(rn: any): any {
  if (!rn || typeof rn !== 'object') return rn;
  if (Array.isArray(rn)) return rn.map(convertReactNode);
  if ('props' in rn && 'type' in rn) {
    const props = { ...(rn.props || {}) };
    const rawChildren = props.children;
    delete props.children;
    let children: any[] = [];
    if (Array.isArray(rawChildren)) {
      children = rawChildren.flat().filter((c: any) => c !== null && c !== undefined).map(convertReactNode);
    } else if (rawChildren !== null && rawChildren !== undefined) {
      children = [convertReactNode(rawChildren)];
    }
    return {
      type: rn.type,
      props,
      children,
      agentId: props['data-agent-id'],
    };
  }
  return rn;
}

function renderVNode(node: AgentChild, instance?: ComponentInstance<any, any, any>): Node {
  if (typeof node === 'function') {
    return renderVNode((node as any)(), instance);
  }

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

  // Handle nested ComponentInstance if passed directly or returned by a component factory
  if ('vnode' in (node as any) && (node as any).vnode) {
    const childInstance = node as any;
    const root = childInstance.scope
      ? childInstance.scope.run(() => renderVNode(childInstance.vnode, childInstance))
      : renderVNode(childInstance.vnode, childInstance);
    if (root instanceof HTMLElement) {
      childInstance.rootElement = root;
    }
    childInstance.isMounted = true;
    if (typeof childInstance.config?.onMount === 'function') {
      try {
        const cleanup = childInstance.config.onMount({
          state: childInstance.state,
          emit: childInstance.emit,
          dispatch: childInstance.dispatch,
        });
        if (typeof cleanup === 'function') {
          (childInstance as any)._cleanups = (childInstance as any)._cleanups || new Set();
          (childInstance as any)._cleanups.add(cleanup);
        }
      } catch (err) {}
    }
    return root;
  }

  let targetType = node.type;
  if (typeof targetType === 'object' && targetType !== null) {
    if ((targetType as any).$$typeof && (targetType as any).type) {
      targetType = (targetType as any).type;
    }
    if (typeof (targetType as any).render === 'function') {
      const rendered = (targetType as any).render(node.props, (node.props as any)?.ref || null);
      return renderVNode(convertReactNode(rendered), instance);
    }
  }

  if (typeof targetType === 'function') {
    if (targetType === Fragment) {
      const fragment = document.createDocumentFragment();
      for (const child of node.children) {
        fragment.appendChild(renderVNode(child, instance));
      }
      return fragment;
    }

    // 1. Show Component
    if (targetType === Show) {
      const container = document.createDocumentFragment();
      const startAnchor = document.createComment('agent-dom:show-start');
      const endAnchor = document.createComment('agent-dom:show-end');
      container.appendChild(startAnchor);
      container.appendChild(endAnchor);

      let currentNodes: Node[] = [];
      let currentScope: ReactiveScope | null = null;

      effect(() => {
        const whenVal =
          typeof node.props.when === 'function' ? node.props.when() : node.props.when;

        if (currentScope) {
          currentScope.dispose();
          currentScope = null;
        }

        for (const n of currentNodes) {
          if (n.parentNode) n.parentNode.removeChild(n);
        }
        currentNodes = [];

        if (whenVal) {
          const { result: rendered, scope: branchScope } = createScope(() => {
            const branch = untrack(() =>
              typeof node.props.children === 'function'
                ? node.props.children(whenVal)
                : node.props.children
            );
            return untrack(() => (branch ? renderVNode(branch, instance) : null));
          });
          currentScope = branchScope;
          if (rendered) {
            const parent = endAnchor.parentNode || container;
            parent.insertBefore(rendered, endAnchor);
            currentNodes.push(rendered);
          }
        } else if (node.props.fallback) {
          const { result: rendered, scope: branchScope } = createScope(() => {
            return untrack(() => renderVNode(node.props.fallback, instance));
          });
          currentScope = branchScope;
          if (rendered) {
            const parent = endAnchor.parentNode || container;
            parent.insertBefore(rendered, endAnchor);
            currentNodes.push(rendered);
          }
        }
      }, {
        name: `control:show:${instance?.id || 'root'}`,
        kind: 'dom_binding',
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
        scope?: ReactiveScope;
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
            const { result: rendered, scope: itemScope } = createScope(() => {
              const childVNode = untrack(() => node.props.children(item, () => indexSignal.value));
              return untrack(() => renderVNode(childVNode, instance));
            });
            existing = { key: itemKey, node: rendered, indexSignal, scope: itemScope };
            newMap.set(itemKey, existing);
            parent.insertBefore(rendered, endAnchor);
          }
        });

        // Clean up removed items
        for (const [_, item] of currentMap) {
          if (item.scope) {
            item.scope.dispose();
          }
          if (item.node.parentNode) {
            item.node.parentNode.removeChild(item.node);
          }
        }

        currentMap = newMap;
      }, {
        name: `control:for:${instance?.id || 'root'}`,
        kind: 'dom_binding',
      });

      return container;
    }

    // 3. Error Boundary Component
    if (targetType === ErrorBoundary) {
      try {
        return renderVNode(node.props.children, instance);
      } catch (err: any) {
        if (instance?.runtimeLog) {
          instance.runtimeLog.push({
            timestamp: Date.now(),
            type: 'error',
            error: `ErrorBoundary: ${err.message}`,
          });
        }
        return renderVNode(node.props.fallback(err), instance);
      }
    }

    let childVNode = targetType(node.props);
    if (typeof childVNode === 'function') {
      childVNode = childVNode();
    }
    return renderVNode(childVNode, instance);
  }

  // Create native HTML or SVG Element
  const tagName = typeof node.type === 'string' ? node.type : String(node.type);
  const isSvg = SVG_TAGS.has(tagName.toLowerCase());
  const el = isSvg
    ? document.createElementNS(SVG_NS, tagName)
    : document.createElement(tagName);
  const cleanups = (instance as any)?._cleanups;

  // Set props and reactive bindings
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'children') continue;

    if (key === 'ref') {
      if (typeof value === 'function') {
        value(el);
      } else if (value && typeof value === 'object' && 'current' in value) {
        value.current = el;
      }
      continue;
    }

    if (key === 'dangerouslySetInnerHTML' && value && typeof value === 'object' && '__html' in value) {
      el.innerHTML = String(value.__html);
      continue;
    }

    if (key === 'innerHTML') {
      if (typeof value === 'function') {
        const stop = effect(() => {
          el.innerHTML = String(value());
        }, {
          name: `dom:${el.tagName.toLowerCase()}.innerHTML`,
          kind: 'dom_binding',
        });
        if (cleanups) cleanups.add(stop);
      } else {
        el.innerHTML = String(value);
      }
      continue;
    }

    if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, value);
      if ((value as any)?._actionName && !node.props['data-agent-action']) {
        el.setAttribute('data-agent-action', (value as any)._actionName);
      }
    } else if (key === 'class' || key === 'className') {
      if (typeof value === 'function') {
        const agentId = el.getAttribute('data-agent-id') || el.tagName.toLowerCase();
        const stop = effect(() => {
          el.setAttribute('class', String(value()));
        }, {
          name: `dom:${agentId}.class`,
          kind: 'dom_binding',
        });
        if (cleanups) cleanups.add(stop);
      } else {
        el.setAttribute('class', String(value));
      }
    } else if (key === 'style') {
      if (typeof value === 'function') {
        const stop = effect(() => {
          const s = value();
          if (typeof s === 'object' && s) {
            Object.assign(el.style, s);
          } else {
            el.setAttribute('style', String(s));
          }
        }, {
          name: `dom:${el.tagName.toLowerCase()}.style`,
          kind: 'dom_binding',
        });
        if (cleanups) cleanups.add(stop);
      } else if (typeof value === 'object' && value) {
        Object.assign(el.style, value);
      } else {
        el.setAttribute('style', String(value));
      }
    } else if (typeof value === 'function') {
      // Dynamic reactive attribute binding
      const agentId = el.getAttribute('data-agent-id') || el.tagName.toLowerCase();
      const stop = effect(() => {
        const val = value();
        if (typeof val === 'boolean') {
          if (val) el.setAttribute(key, '');
          else el.removeAttribute(key);
        } else {
          el.setAttribute(key, String(val));
        }
      }, {
        name: `dom:${agentId}.${key}`,
        kind: 'dom_binding',
      });
      if (cleanups) cleanups.add(stop);
    } else if (value !== false && value !== null && value !== undefined) {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }

  // Render children
  for (const child of node.children) {
    if (typeof child === 'function') {
      const parentAgentId = el.getAttribute('data-agent-id') || el.tagName.toLowerCase();
      // Use dynamic anchors for reactive child rendering
      const startAnchor = document.createComment(`tokensafe:dyn-start`);
      const endAnchor = document.createComment(`tokensafe:dyn-end`);
      el.appendChild(startAnchor);
      el.appendChild(endAnchor);

      let currentNodes: Node[] = [];
      const textNode = document.createTextNode('');

      const stop = effect(() => {
        const val = child();

        // 1. Array of VNodes / children: [h('li', ...), h('li', ...)]
        if (Array.isArray(val)) {
          for (const n of currentNodes) {
            if (n.parentNode) n.parentNode.removeChild(n);
          }
          currentNodes = [];
          for (const item of val) {
            if (item !== null && item !== undefined && typeof item !== 'boolean') {
              const rendered = renderVNode(item, instance);
              endAnchor.parentNode?.insertBefore(rendered, endAnchor);
              currentNodes.push(rendered);
            }
          }
          return;
        }

        // 2. Single VNode object: { type: ..., props: ... }
        if (val && typeof val === 'object' && ('type' in val || 'props' in val)) {
          for (const n of currentNodes) {
            if (n.parentNode) n.parentNode.removeChild(n);
          }
          currentNodes = [];
          const rendered = renderVNode(val, instance);
          endAnchor.parentNode?.insertBefore(rendered, endAnchor);
          currentNodes.push(rendered);
          return;
        }

        // 3. Null or false or undefined: render nothing
        if (val === null || val === undefined || typeof val === 'boolean') {
          for (const n of currentNodes) {
            if (n.parentNode) n.parentNode.removeChild(n);
          }
          currentNodes = [];
          return;
        }

        // 4. Primitive text / number: bind to text node
        for (const n of currentNodes) {
          if (n !== textNode && n.parentNode) n.parentNode.removeChild(n);
        }
        textNode.textContent = String(val);
        if (!textNode.parentNode) {
          endAnchor.parentNode?.insertBefore(textNode, endAnchor);
        }
        currentNodes = [textNode];
      }, {
        name: `dom:${parentAgentId}.reactive-child`,
        kind: 'dom_binding',
      });
      if (cleanups) cleanups.add(stop);
    } else {
      el.appendChild(renderVNode(child, instance));
    }
  }

  return el;
}

export function renderToString(instanceOrVNode: ComponentInstance<any, any, any> | AgentChild): string {
  if (instanceOrVNode && typeof instanceOrVNode === 'object' && 'vnode' in (instanceOrVNode as any)) {
    const instance = instanceOrVNode as ComponentInstance<any, any, any>;
    const html = vnodeToString(instance.vnode);
    const stateSnapshot: Record<string, any> = {};
    for (const [k, sig] of Object.entries(instance.signals)) {
      stateSnapshot[k] = sig.peek();
    }

    const stateScript = `<script id="__TOKENSAFE_UI_STATE__" type="application/json">${JSON.stringify({
      [instance.id]: stateSnapshot,
    })}</script>`;

    return `${html}\n${stateScript}`;
  }
  return vnodeToString(instanceOrVNode as any);
}

function vnodeToString(node: AgentChild): string {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return escapeHtml(String(node));
  }
  if (typeof node === 'function') {
    try {
      const val = (node as any)();
      return vnodeToString(val);
    } catch {
      return '';
    }
  }
  if (!node || typeof node !== 'object') {
    return '';
  }
  if ('vnode' in (node as any) && (node as any).vnode) {
    return vnodeToString((node as any).vnode);
  }
  if (Array.isArray(node)) {
    return node.map(vnodeToString).join('');
  }

  let targetType = node.type;
  if (typeof targetType === 'object' && targetType !== null) {
    if ((targetType as any).$$typeof && (targetType as any).type) {
      targetType = (targetType as any).type;
    }
    if (typeof (targetType as any).render === 'function') {
      const rendered = (targetType as any).render(node.props, (node.props as any)?.ref || null);
      return vnodeToString(convertReactNode(rendered));
    }
  }

  if (typeof targetType === 'function') {
    if (targetType === Fragment) {
      return (node.children || []).map(vnodeToString).join('');
    }
    if (targetType === Show) {
      const whenVal =
        typeof node.props.when === 'function' ? node.props.when() : node.props.when;
      const branch = whenVal
        ? typeof node.props.children === 'function'
          ? node.props.children(whenVal)
          : node.props.children
        : node.props.fallback;
      return branch ? vnodeToString(branch) : '';
    }
    if (targetType === For) {
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
    if (targetType === ErrorBoundary) {
      try {
        return vnodeToString(node.props.children);
      } catch (err: any) {
        return vnodeToString(node.props.fallback(err));
      }
    }
    return vnodeToString(targetType(node.props));
  }

  const attrs: string[] = [];
  for (let [key, value] of Object.entries(node.props)) {
    if (key === 'children' || key.startsWith('on')) continue;
    if (typeof value === 'function') {
      try {
        value = value();
      } catch {
        continue;
      }
    }
    if (key === 'class' || key === 'className') {
      attrs.push(`class="${escapeHtml(String(value))}"`);
    } else if (typeof value === 'boolean') {
      if (value) attrs.push(key);
    } else if (value !== null && value !== undefined) {
      attrs.push(`${key}="${escapeHtml(String(value))}"`);
    }
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  if (node.props?.dangerouslySetInnerHTML?.__html) {
    return `<${node.type}${attrStr}>${node.props.dangerouslySetInnerHTML.__html}</${node.type}>`;
  }
  if (node.props?.innerHTML) {
    const raw = typeof node.props.innerHTML === 'function' ? node.props.innerHTML() : node.props.innerHTML;
    return `<${node.type}${attrStr}>${raw}</${node.type}>`;
  }
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
