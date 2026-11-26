export const REACT_BRIDGE_PUBLIC_PATH = '/@oumv/react-bridge.js';
export const REACT_BRIDGE_VIRTUAL_ID = '\0tokensafe-oumv-react-bridge';

/**
 * Generates the dev-only browser bridge module for React 18/19 applications.
 * Served via Vite's module pipeline so `import.meta.hot` is automatically injected.
 */
export function getReactBridgeClientCode(): string {
  return `
if (typeof window !== 'undefined' && !window.__OUMV_REACT_BRIDGE_INSTALLED__) {
  window.__OUMV_REACT_BRIDGE_INSTALLED__ = true;

  const MAX_TRACES = 128;
  const MAX_ERRORS = 50;
  const stores = new Map();
  const components = new Map();
  const contracts = new Map();
  const traces = [];
  const errors = [];

  const pushTrace = (entry) => {
    traces.push(entry);
    if (traces.length > MAX_TRACES) traces.shift();
    if (import.meta.hot) {
      try {
        import.meta.hot.send('oumv:react-trace', entry);
      } catch {}
    }
  };

  const pushError = (errInfo) => {
    errors.push(errInfo);
    if (errors.length > MAX_ERRORS) errors.shift();
    pushTrace({
      type: 'error',
      timestamp: Date.now(),
      route: window.location.pathname || '/',
      ...errInfo,
    });
  };

  const safeSerialize = (val, depth = 0) => {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
    if (typeof val === 'function') return '[Function]';
    if (depth >= 2) return Array.isArray(val) ? '[Array(' + val.length + ')]' : '[Object]';
    if (Array.isArray(val)) return val.slice(0, 15).map((item) => safeSerialize(item, depth + 1));
    if (typeof val === 'object') {
      const out = {};
      const keys = Object.keys(val).slice(0, 20);
      for (const k of keys) {
        if (k.startsWith('__') || k === 'children') continue;
        try {
          out[k] = safeSerialize(val[k], depth + 1);
        } catch {
          out[k] = '[Unserializable]';
        }
      }
      return out;
    }
    return String(val);
  };

  const getRoot = () =>
    document.getElementById('root') ||
    document.getElementById('app') ||
    document.body;

  const findFiberOnNode = (node) => {
    if (!node || typeof node !== 'object') return null;
    const keys = Object.keys(node);
    for (const k of keys) {
      if (k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')) {
        const val = node[k];
        if (val && typeof val === 'object') {
          return val.current ? val.current : val;
        }
      }
    }
    return null;
  };

  const getFiberDisplayName = (fiber) => {
    if (!fiber || !fiber.type) return null;
    const t = fiber.type;
    if (typeof t === 'function') {
      return t.displayName || t.name || null;
    }
    if (typeof t === 'object') {
      if (t.displayName) return t.displayName;
      if (t.render && (t.render.displayName || t.render.name)) {
        return t.render.displayName || t.render.name;
      }
      if (t.type && (t.type.displayName || t.type.name)) {
        return t.type.displayName || t.type.name;
      }
    }
    return null;
  };

  const countHooks = (fiber) => {
    let count = 0;
    let cur = fiber && fiber.memoizedState;
    while (cur && count < 64) {
      count++;
      cur = cur.next;
    }
    return count;
  };

  const findNearestComponentName = (el) => {
    let fiber = findFiberOnNode(el);
    let steps = 0;
    while (fiber && steps < 40) {
      const name = getFiberDisplayName(fiber);
      if (name && !name.startsWith('Clerk') && name !== 'Anonymous') {
        return name;
      }
      fiber = fiber.return;
      steps++;
    }
    return undefined;
  };

  const collectReactComponents = () => {
    const root = getRoot();
    if (!root) return [];
    let rootFiber = findFiberOnNode(root);
    if (!rootFiber && root.firstElementChild) {
      rootFiber = findFiberOnNode(root.firstElementChild);
    }
    if (!rootFiber) return [];

    const byName = new Map();
    const stack = [rootFiber];
    let visited = 0;
    const MAX_FIBERS = 800;

    while (stack.length > 0 && visited < MAX_FIBERS) {
      const fiber = stack.pop();
      if (!fiber) continue;
      visited++;

      const name = getFiberDisplayName(fiber);
      if (name && /^[A-Z]/.test(name)) {
        const existing = byName.get(name);
        const propKeys =
          fiber.memoizedProps && typeof fiber.memoizedProps === 'object'
            ? Object.keys(fiber.memoizedProps).filter((k) => k !== 'children').slice(0, 12)
            : [];
        const src = fiber._debugSource
          ? { fileName: fiber._debugSource.fileName, lineNumber: fiber._debugSource.lineNumber }
          : undefined;
        if (!existing) {
          byName.set(name, {
            id: 'frontend.component:' + name,
            name,
            instances: 1,
            propsKeys: propKeys,
            hooksCount: countHooks(fiber),
            source: src,
          });
        } else {
          existing.instances += 1;
        }
      }

      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }

    return Array.from(byName.values());
  };

  const isVisibleElement = (el) => {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    } catch {
      return true;
    }
  };

  const slugify = (txt) =>
    String(txt || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);

  const resolveElementId = (el, index) => {
    const explicit =
      el.getAttribute('data-agent-id') ||
      el.getAttribute('data-testid') ||
      el.id;
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('name') ||
      el.getAttribute('placeholder') ||
      (el.textContent || '').trim();
    const slug = slugify(label);
    return slug ? tag + ':' + slug : tag + '_' + index;
  };

  const collectInteractiveSurface = () => {
    const root = getRoot();
    if (!root) return [];
    const selector =
      'button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [data-agent-id], [data-testid]';
    const nodes = root.querySelectorAll(selector);
    const items = [];
    const seenIds = new Set();

    for (let i = 0; i < nodes.length && items.length < 80; i++) {
      const el = nodes[i];
      if (!isVisibleElement(el)) continue;

      let id = resolveElementId(el, i);
      if (seenIds.has(id)) {
        id = id + '_' + i;
      }
      seenIds.add(id);

      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tag;
      const label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.textContent ||
        ''
      )
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 60);

      let value = undefined;
      if (el instanceof HTMLInputElement) {
        value = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
      } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        value = el.value;
      }

      const item = {
        id,
        tag,
        role,
        label: label || undefined,
        value: value !== '' ? value : undefined,
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true') || undefined,
        href: tag === 'a' ? el.getAttribute('href') || undefined : undefined,
        action:
          el.getAttribute('data-action') ||
          el.getAttribute('data-agent-action') ||
          (tag === 'input' || tag === 'textarea' || tag === 'select' ? 'input' : 'click'),
        component: findNearestComponentName(el),
      };
      items.push(item);
    }

    return items;
  };

  const buildSnapshot = () => {
    const root = getRoot();
    const mountedComponents = collectReactComponents();
    const interactiveSurface = collectInteractiveSurface();
    const registeredStores = {};
    for (const [id, store] of stores.entries()) {
      try {
        registeredStores[id] = {
          state: safeSerialize(store.getState ? store.getState() : {}),
          actions: Object.keys(store.actions || {}),
        };
      } catch {}
    }
    const registeredComponents = {};
    for (const [id, comp] of components.entries()) {
      try {
        registeredComponents[id] = {
          state: safeSerialize(comp.getState ? comp.getState() : {}),
          actions: Object.keys(comp.actions || {}),
        };
      } catch {}
    }

    return {
      framework: 'react',
      route: (window.location.pathname || '/') + (window.location.search || ''),
      title: document.title || '',
      elementCount: root ? root.querySelectorAll('*').length : 0,
      mountedComponents,
      interactiveSurface,
      registeredStores,
      registeredComponents,
      contracts: Array.from(contracts.values()),
      errorsCount: errors.length,
      errors: errors.slice(-10),
      tracesCount: traces.length,
      timestamp: Date.now(),
    };
  };

  const sendSnapshot = () => {
    if (!import.meta.hot) return;
    try {
      import.meta.hot.send('oumv:react-snapshot', buildSnapshot());
    } catch {}
  };

  let snapshotTimer = null;
  const scheduleSnapshot = () => {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(sendSnapshot, 150);
  };

  // Expose browser registry API for tokensafe-ui/react-client & defineOUMVComponent
  window.__OUMV_REACT__ = {
    registerStore: (id, storeOrGetter, actions = {}) => {
      const getState =
        typeof storeOrGetter === 'function'
          ? storeOrGetter
          : () => (storeOrGetter && typeof storeOrGetter.getState === 'function' ? storeOrGetter.getState() : {});
      const discoveredActions = { ...actions };
      try {
        const s = getState();
        if (s && typeof s === 'object') {
          for (const [k, v] of Object.entries(s)) {
            if (typeof v === 'function' && !discoveredActions[k]) {
              discoveredActions[k] = v;
            }
          }
        }
      } catch {}
      stores.set(id, { id, getState, actions: discoveredActions });
      let unsub = null;
      if (storeOrGetter && typeof storeOrGetter.subscribe === 'function') {
        try {
          unsub = storeOrGetter.subscribe(() => {
            pushTrace({
              type: 'store:update',
              storeId: id,
              route: window.location.pathname || '/',
              timestamp: Date.now(),
            });
            scheduleSnapshot();
          });
        } catch {}
      }
      scheduleSnapshot();
      return () => {
        stores.delete(id);
        if (typeof unsub === 'function') unsub();
      };
    },
    registerComponent: (def) => {
      if (!def || !def.id) return () => {};
      components.set(def.id, def);
      scheduleSnapshot();
      return () => {
        components.delete(def.id);
      };
    },
    registerContract: (record) => {
      if (!record || !record.componentId) return;
      contracts.set(record.componentId, record);
      scheduleSnapshot();
    },
    getSnapshot: buildSnapshot,
    getTraces: () => traces.slice(),
  };

  // Instrument window.fetch for live cross-stack runtime evidence
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/__oumv/') || url.includes('/@vite/') || url.includes('/@oumv/')) {
        return origFetch(input, init);
      }
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const t0 = performance.now();
      try {
        const resp = await origFetch(input, init);
        pushTrace({
          type: 'fetch',
          method,
          url,
          status: resp.status,
          ok: resp.ok,
          durationMs: Number((performance.now() - t0).toFixed(2)),
          route: window.location.pathname || '/',
          timestamp: Date.now(),
        });
        return resp;
      } catch (err) {
        pushTrace({
          type: 'fetch',
          method,
          url,
          status: 0,
          ok: false,
          error: err && err.message ? err.message : String(err),
          durationMs: Number((performance.now() - t0).toFixed(2)),
          route: window.location.pathname || '/',
          timestamp: Date.now(),
        });
        throw err;
      }
    };
  }

  window.addEventListener('error', (ev) => {
    pushError({
      message: ev.message || 'Unhandled error',
      filename: ev.filename,
      lineno: ev.lineno,
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    pushError({
      message: reason && reason.message ? reason.message : String(reason || 'Unhandled rejection'),
    });
  });

  window.addEventListener('popstate', scheduleSnapshot);
  const origPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    const res = origPushState(...args);
    scheduleSnapshot();
    return res;
  };
  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    const res = origReplaceState(...args);
    scheduleSnapshot();
    return res;
  };

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(scheduleSnapshot);
    const startObserve = () => {
      const root = getRoot();
      if (root) {
        observer.observe(root, { childList: true, subtree: true, attributes: true });
      }
      sendSnapshot();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserve, { once: true });
    } else {
      startObserve();
    }
  }

  const findDomTarget = (target) => {
    const root = getRoot() || document;
    if (!target) return null;
    const byAttr =
      root.querySelector('[data-agent-id="' + CSS.escape(target) + '"]') ||
      root.querySelector('[data-testid="' + CSS.escape(target) + '"]') ||
      document.getElementById(target);
    if (byAttr) return byAttr;

    const surface = collectInteractiveSurface();
    const surfaceMatch = surface.find(
      (item) => item.id === target || (item.label && item.label.toLowerCase() === target.toLowerCase())
    );
    if (surfaceMatch) {
      const candidates = root.querySelectorAll('button, input, select, textarea, a[href], [role], [data-agent-id], [data-testid]');
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (!isVisibleElement(el)) continue;
        if (resolveElementId(el, i) === surfaceMatch.id) return el;
        const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (txt && txt.toLowerCase() === target.toLowerCase()) return el;
      }
    }

    try {
      return root.querySelector(target);
    } catch {
      return null;
    }
  };

  const setNativeInputValue = (el, val) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, String(val));
    } else {
      el.value = String(val);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  if (import.meta.hot) {
    import.meta.hot.on('oumv:react-observe', (req) => {
      try {
        const snap = buildSnapshot();
        import.meta.hot.send('oumv:react-observe-res', {
          requestId: req && req.requestId,
          snapshot: snap,
          traces: traces.slice(),
        });
      } catch (err) {
        import.meta.hot.send('oumv:react-observe-res', {
          requestId: req && req.requestId,
          error: err && err.message ? err.message : String(err),
        });
      }
    });

    import.meta.hot.on('oumv:react-verify', async (req) => {
      const requestId = req && req.requestId;
      const target = (req && req.target) || '';
      const action = (req && req.action) || 'click';
      const payload = req && req.payload;
      const t0 = performance.now();

      try {
        // 1. Check registered stores or components first
        const reg = stores.get(target) || components.get(target);
        if (reg && reg.actions && typeof reg.actions[action] === 'function') {
          const beforeState = safeSerialize(reg.getState ? reg.getState() : {});
          const tAct = performance.now();
          await reg.actions[action](payload);
          await new Promise((r) => setTimeout(r, 20));
          const actionMs = Number((performance.now() - tAct).toFixed(2));
          const afterState = safeSerialize(reg.getState ? reg.getState() : {});
          const diff = {};
          for (const k of new Set([...Object.keys(beforeState || {}), ...Object.keys(afterState || {})])) {
            if (JSON.stringify(beforeState[k]) !== JSON.stringify(afterState[k])) {
              diff[k] = { before: beforeState[k], after: afterState[k] };
            }
          }
          const snap = buildSnapshot();
          import.meta.hot.send('oumv:react-snapshot', snap);
          import.meta.hot.send('oumv:react-verify-res', {
            requestId,
            status: 'passed',
            target,
            action,
            diff,
            surfaceDiff: [],
            durationMs: Number((performance.now() - t0).toFixed(2)),
            latency: { actionMs, totalMs: Number((performance.now() - t0).toFixed(2)) },
          });
          return;
        }

        // 2. Live DOM interaction verification
        const el = findDomTarget(target);
        if (!el) {
          import.meta.hot.send('oumv:react-verify-res', {
            requestId,
            status: 'failed',
            errorCode: -32004,
            error: "Target element or component '" + target + "' not found in live React DOM",
          });
          return;
        }

        const beforeRoute = (window.location.pathname || '/') + (window.location.search || '');
        const beforeText = (el.textContent || '').trim().slice(0, 80);
        const beforeValue = 'value' in el ? el.value : undefined;
        const beforeDisabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
        const beforeSurface = collectInteractiveSurface();

        const tAct = performance.now();
        if (action === 'click' || action === 'invoke') {
          el.click();
        } else if (action === 'input' || action === 'setValue' || action === 'change') {
          const val = payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload;
          setNativeInputValue(el, val ?? '');
        } else if (action === 'submit') {
          const form = el.tagName === 'FORM' ? el : el.closest('form');
          if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            el.click();
          }
        } else if (action === 'focus') {
          el.focus();
        } else {
          import.meta.hot.send('oumv:react-verify-res', {
            requestId,
            status: 'failed',
            errorCode: -32005,
            error: "Action '" + action + "' is not supported on DOM target '" + target + "'",
          });
          return;
        }
        const actionMs = Number((performance.now() - tAct).toFixed(2));

        await new Promise((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 35))
        );

        const afterRoute = (window.location.pathname || '/') + (window.location.search || '');
        const afterText = (el.textContent || '').trim().slice(0, 80);
        const afterValue = 'value' in el ? el.value : undefined;
        const afterDisabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
        const afterSurface = collectInteractiveSurface();

        const diff = {};
        if (beforeRoute !== afterRoute) diff.route = { before: beforeRoute, after: afterRoute };
        if (beforeText !== afterText) diff.text = { before: beforeText, after: afterText };
        if (beforeValue !== afterValue) diff.value = { before: beforeValue, after: afterValue };
        if (beforeDisabled !== afterDisabled) diff.disabled = { before: beforeDisabled, after: afterDisabled };
        if (beforeSurface.length !== afterSurface.length) {
          diff.interactiveCount = { before: beforeSurface.length, after: afterSurface.length };
        }

        const surfaceDiff = [];
        const beforeMap = new Map(beforeSurface.map((s) => [s.id, s]));
        const afterMap = new Map(afterSurface.map((s) => [s.id, s]));
        for (const [id, item] of afterMap.entries()) {
          const prev = beforeMap.get(id);
          if (!prev) {
            surfaceDiff.push({ op: 'visibility', target: id, before: false, after: true });
          } else if (prev.label !== item.label) {
            surfaceDiff.push({ op: 'text', target: id, before: prev.label, after: item.label });
          } else if (prev.disabled !== item.disabled) {
            surfaceDiff.push({ op: 'attr', target: id, attr: 'disabled', before: prev.disabled, after: item.disabled });
          }
        }
        for (const id of beforeMap.keys()) {
          if (!afterMap.has(id)) {
            surfaceDiff.push({ op: 'visibility', target: id, before: true, after: false });
          }
        }

        pushTrace({
          type: 'verify:' + action,
          target,
          route: afterRoute,
          diff,
          timestamp: Date.now(),
        });

        const snap = buildSnapshot();
        import.meta.hot.send('oumv:react-snapshot', snap);
        import.meta.hot.send('oumv:react-verify-res', {
          requestId,
          status: 'passed',
          target,
          action,
          diff,
          surfaceDiff: surfaceDiff.slice(0, 30),
          durationMs: Number((performance.now() - t0).toFixed(2)),
          latency: { actionMs, totalMs: Number((performance.now() - t0).toFixed(2)) },
        });
      } catch (err) {
        import.meta.hot.send('oumv:react-verify-res', {
          requestId,
          status: 'failed',
          error: err && err.message ? err.message : String(err),
        });
      }
    });
  }
}
`;
}
