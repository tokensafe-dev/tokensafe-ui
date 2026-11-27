export const VUE_BRIDGE_PUBLIC_PATH = '/@oumv/vue-bridge.js';
export const VUE_BRIDGE_VIRTUAL_ID = '\0tokensafe-oumv-vue-bridge';

/**
 * Generates the dev-only browser bridge module for Vue 3 applications.
 *
 * It reads the Vue app instance Vue's own dev build leaves on the mount element
 * (`el.__vue_app__`), so it needs no instrumented build and no app import. The
 * surface, trace and verify logic mirrors the React bridge: the wire contract is
 * framework-neutral, only component discovery differs.
 */
export function getVueBridgeClientCode(): string {
  return `
if (typeof window !== 'undefined' && !window.__OUMV_VUE_BRIDGE_INSTALLED__) {
  window.__OUMV_VUE_BRIDGE_INSTALLED__ = true;

  var MAX_TRACES = 128;
  var MAX_ERRORS = 50;
  var stores = new Map();
  var components = new Map();
  var contracts = new Map();
  var traces = [];
  var errors = [];

  var pushTrace = function (entry) {
    traces.push(entry);
    if (traces.length > MAX_TRACES) traces.shift();
    if (import.meta.hot) {
      try { import.meta.hot.send('oumv:vue-trace', entry); } catch (e) {}
    }
  };

  var pushError = function (errInfo) {
    errors.push(errInfo);
    if (errors.length > MAX_ERRORS) errors.shift();
    var merged = { type: 'error', timestamp: Date.now(), route: window.location.pathname || '/' };
    for (var k in errInfo) merged[k] = errInfo[k];
    pushTrace(merged);
  };

  var safeSerialize = function (val, depth) {
    depth = depth || 0;
    if (val === null || val === undefined) return val;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
    if (typeof val === 'function') return '[Function]';
    if (depth >= 2) return Array.isArray(val) ? '[Array(' + val.length + ')]' : '[Object]';
    if (Array.isArray(val)) return val.slice(0, 15).map(function (item) { return safeSerialize(item, depth + 1); });
    if (typeof val === 'object') {
      var out = {};
      var keys = Object.keys(val).slice(0, 20);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.charAt(0) === '_' || k === 'children') continue;
        try { out[k] = safeSerialize(val[k], depth + 1); } catch (e) { out[k] = '[Unserializable]'; }
      }
      return out;
    }
    return String(val);
  };

  var getRoot = function () {
    return document.getElementById('app') || document.querySelector('[data-v-app]') || document.getElementById('root') || document.body;
  };

  var getVueApp = function () {
    var root = getRoot();
    if (root && root.__vue_app__) return root.__vue_app__;
    if (window.__OUMV_VUE_APP__) return window.__OUMV_VUE_APP__;
    var nodes = document.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__vue_app__) return nodes[i].__vue_app__;
    }
    return null;
  };

  var componentName = function (vnode) {
    var t = vnode && vnode.type;
    if (!t) return null;
    if (typeof t === 'function') return t.name || null;
    if (typeof t === 'object') {
      if (t.name) return t.name;
      if (t.__name) return t.__name;
      if (t.__file) {
        var parts = String(t.__file).split('/');
        var base = parts[parts.length - 1].replace(/\\.vue$/, '');
        if (base) return base;
      }
    }
    return null;
  };

  var walkVNodes = function (vnode, visit, budget) {
    if (!vnode || typeof vnode !== 'object' || budget.visited > 1200) return;
    budget.visited += 1;
    visit(vnode);
    var children = vnode.children;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) walkVNodes(children[i], visit, budget);
    }
    if (vnode.component && vnode.component.subTree) walkVNodes(vnode.component.subTree, visit, budget);
    if (vnode.suspense) {
      if (vnode.suspense.activeBranch) walkVNodes(vnode.suspense.activeBranch, visit, budget);
      if (vnode.suspense.fallback) walkVNodes(vnode.suspense.fallback, visit, budget);
    }
  };

  var collectVueComponents = function () {
    var app = getVueApp();
    if (!app || !app._instance) return [];
    var byName = new Map();
    var budget = { visited: 0 };
    var addInstance = function (name, inst, file) {
      if (!name || !/^[A-Z]/.test(name) || byName.has(name)) return;
      var propKeys = [];
      var stateKeys = [];
      try {
        propKeys = inst && inst.props ? Object.keys(inst.props).slice(0, 12) : [];
        var setup = inst && inst.setupState ? inst.setupState : {};
        stateKeys = Object.keys(setup).filter(function (k) { return k.charAt(0) !== '_'; }).slice(0, 20);
      } catch (e) {}
      byName.set(name, {
        id: 'frontend.component:' + name,
        name: name,
        instances: 1,
        propsKeys: propKeys,
        stateKeys: stateKeys,
        source: file ? { fileName: String(file) } : undefined,
      });
    };
    // The root component lives on the app instance, not in its own subTree.
    var rootInst = app._instance;
    var rootType = rootInst.type || {};
    var rootFile = rootType.__file;
    var rootBase = rootFile ? String(rootFile).split('/').pop().replace(/\.vue$/, '') : '';
    addInstance(rootType.name || rootType.__name || rootBase, rootInst, rootFile);

    walkVNodes(rootInst.subTree, function (vnode) {
      var name = componentName(vnode);
      if (!name || !/^[A-Z]/.test(name)) return;
      var existing = byName.get(name);
      if (existing) { existing.instances += 1; return; }
      var inst = vnode.component;
      var file = vnode.type && vnode.type.__file;
      addInstance(name, inst, file);
    }, budget);
    return Array.from(byName.values());
  };

  var componentState = function (name) {
    var app = getVueApp();
    if (!app || !app._instance) return null;
    var read = function (inst, file) {
      var state = {};
      try {
        var setup = inst.setupState || {};
        for (var k in setup) {
          if (k.charAt(0) === '_') continue;
          state[k] = safeSerialize(setup[k]);
        }
      } catch (e) {}
      try {
        var props = inst.props || {};
        for (var p in props) state[p] = safeSerialize(props[p]);
      } catch (e) {}
      return { state: state, props: safeSerialize(inst.props || {}), file: file ? String(file) : undefined };
    };
    var rootInst = app._instance;
    var rootType = rootInst.type || {};
    var rootFile = rootType.__file;
    var rootBase = rootFile ? String(rootFile).split('/').pop().replace(/\.vue$/, '') : '';
    if ((rootType.name || rootType.__name || rootBase) === name) return read(rootInst, rootFile);
    var found = null;
    var budget = { visited: 0 };
    walkVNodes(rootInst.subTree, function (vnode) {
      if (found) return;
      if (componentName(vnode) === name && vnode.component) {
        found = read(vnode.component, vnode.type && vnode.type.__file);
      }
    }, budget);
    return found;
  };

  var isVisibleElement = function (el) {
    try {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    } catch (e) { return true; }
  };

  var slugify = function (txt) {
    return String(txt || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  };

  var resolveElementId = function (el, index) {
    var explicit = el.getAttribute('data-agent-id') || el.getAttribute('data-testid') || el.id;
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    var label = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || (el.textContent || '').trim();
    var slug = slugify(label);
    return slug ? tag + ':' + slug : tag + '_' + index;
  };

  var collectInteractiveSurface = function () {
    var root = getRoot();
    if (!root) return [];
    var selector = 'button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [data-agent-id], [data-testid]';
    var nodes = root.querySelectorAll(selector);
    var items = [];
    var seenIds = new Set();
    for (var i = 0; i < nodes.length && items.length < 80; i++) {
      var el = nodes[i];
      if (!isVisibleElement(el)) continue;
      var id = resolveElementId(el, i);
      if (seenIds.has(id)) id = id + '_' + i;
      seenIds.add(id);
      var tag = el.tagName.toLowerCase();
      var label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
      var value;
      if (el instanceof HTMLInputElement) value = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
      else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) value = el.value;
      items.push({
        id: id,
        tag: tag,
        role: el.getAttribute('role') || tag,
        label: label || undefined,
        value: value !== '' ? value : undefined,
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true') || undefined,
        href: tag === 'a' ? el.getAttribute('href') || undefined : undefined,
        action: el.getAttribute('data-action') || el.getAttribute('data-agent-action') || (tag === 'input' || tag === 'textarea' || tag === 'select' ? 'input' : 'click'),
      });
    }
    return items;
  };

  var buildSnapshot = function () {
    var root = getRoot();
    var mounted = collectVueComponents();
    var surface = collectInteractiveSurface();
    var registeredStores = {};
    stores.forEach(function (store, id) {
      try {
        registeredStores[id] = { state: safeSerialize(store.getState ? store.getState() : {}), actions: Object.keys(store.actions || {}) };
      } catch (e) {}
    });
    var registeredComponents = {};
    components.forEach(function (comp, id) {
      try {
        registeredComponents[id] = { state: safeSerialize(comp.getState ? comp.getState() : {}), actions: Object.keys(comp.actions || {}) };
      } catch (e) {}
    });
    var contractList = [];
    contracts.forEach(function (c) { contractList.push(c); });
    return {
      framework: 'vue',
      route: (window.location.pathname || '/') + (window.location.search || ''),
      title: document.title || '',
      elementCount: root ? root.querySelectorAll('*').length : 0,
      mountedComponents: mounted,
      interactiveSurface: surface,
      registeredStores: registeredStores,
      registeredComponents: registeredComponents,
      contracts: contractList,
      errorsCount: errors.length,
      errors: errors.slice(-10),
      tracesCount: traces.length,
      timestamp: Date.now(),
    };
  };

  var sendSnapshot = function () {
    if (!import.meta.hot) return;
    try { import.meta.hot.send('oumv:vue-snapshot', buildSnapshot()); } catch (e) {}
  };

  var snapshotTimer = null;
  var scheduleSnapshot = function () {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(sendSnapshot, 150);
  };

  window.__OUMV_VUE__ = {
    registerStore: function (id, storeOrGetter, actions) {
      var getState = typeof storeOrGetter === 'function'
        ? storeOrGetter
        : function () { return storeOrGetter && typeof storeOrGetter.getState === 'function' ? storeOrGetter.getState() : {}; };
      var discovered = {};
      if (actions) for (var k in actions) discovered[k] = actions[k];
      try {
        var s = getState();
        if (s && typeof s === 'object') {
          for (var key in s) {
            if (typeof s[key] === 'function' && !discovered[key]) discovered[key] = s[key];
          }
        }
      } catch (e) {}
      stores.set(id, { id: id, getState: getState, actions: discovered });
      var unsub = null;
      if (storeOrGetter && typeof storeOrGetter.subscribe === 'function') {
        try {
          unsub = storeOrGetter.subscribe(function () { pushTrace({ type: 'store:update', storeId: id, route: window.location.pathname || '/', timestamp: Date.now() }); scheduleSnapshot(); });
        } catch (e) {}
      }
      scheduleSnapshot();
      return function () { stores.delete(id); if (typeof unsub === 'function') unsub(); };
    },
    registerComponent: function (def) {
      if (!def || !def.id) return function () {};
      components.set(def.id, def);
      scheduleSnapshot();
      return function () { components.delete(def.id); };
    },
    registerContract: function (record) {
      if (!record || !record.componentId) return;
      contracts.set(record.componentId, record);
      scheduleSnapshot();
    },
    getSnapshot: buildSnapshot,
    getTraces: function () { return traces.slice(); },
    getComponentState: componentState,
  };

  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/__oumv/') === 0 || url.indexOf('/@vite/') === 0 || url.indexOf('/@oumv/') === 0) {
        return origFetch(input, init);
      }
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var t0 = performance.now();
      return origFetch(input, init).then(function (resp) {
        pushTrace({ type: 'fetch', method: method, url: url, status: resp.status, ok: resp.ok, durationMs: Number((performance.now() - t0).toFixed(2)), route: window.location.pathname || '/', timestamp: Date.now() });
        return resp;
      }, function (err) {
        pushTrace({ type: 'fetch', method: method, url: url, status: 0, ok: false, error: err && err.message ? err.message : String(err), durationMs: Number((performance.now() - t0).toFixed(2)), route: window.location.pathname || '/', timestamp: Date.now() });
        throw err;
      });
    };
  }

  window.addEventListener('error', function (ev) {
    pushError({ message: ev.message || 'Unhandled error', filename: ev.filename, lineno: ev.lineno });
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev.reason;
    pushError({ message: reason && reason.message ? reason.message : String(reason || 'Unhandled rejection') });
  });
  window.addEventListener('popstate', scheduleSnapshot);

  var origPushState = history.pushState.bind(history);
  history.pushState = function () { var res = origPushState.apply(null, arguments); scheduleSnapshot(); return res; };
  var origReplaceState = history.replaceState.bind(history);
  history.replaceState = function () { var res = origReplaceState.apply(null, arguments); scheduleSnapshot(); return res; };

  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(scheduleSnapshot);
    var startObserve = function () {
      var root = getRoot();
      if (root) observer.observe(root, { childList: true, subtree: true, attributes: true });
      sendSnapshot();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserve, { once: true });
    else startObserve();
  }

  var findDomTarget = function (target) {
    var root = getRoot() || document;
    if (!target) return null;
    var byAttr = root.querySelector('[data-agent-id="' + CSS.escape(target) + '"]') ||
      root.querySelector('[data-testid="' + CSS.escape(target) + '"]') ||
      document.getElementById(target);
    if (byAttr) return byAttr;
    var surface = collectInteractiveSurface();
    var match = surface.find(function (item) { return item.id === target || (item.label && item.label.toLowerCase() === target.toLowerCase()); });
    if (match) {
      var candidates = root.querySelectorAll('button, input, select, textarea, a[href], [role], [data-agent-id], [data-testid]');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (!isVisibleElement(el)) continue;
        if (resolveElementId(el, i) === match.id) return el;
      }
    }
    try { return root.querySelector(target); } catch (e) { return null; }
  };

  var setNativeInputValue = function (el, val) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, String(val));
    else el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  if (import.meta.hot) {
    import.meta.hot.on('oumv:vue-observe', function (req) {
      try {
        import.meta.hot.send('oumv:vue-observe-res', { requestId: req && req.requestId, snapshot: buildSnapshot(), traces: traces.slice() });
      } catch (err) {
        import.meta.hot.send('oumv:vue-observe-res', { requestId: req && req.requestId, error: err && err.message ? err.message : String(err) });
      }
    });

    import.meta.hot.on('oumv:vue-verify', function (req) {
      var requestId = req && req.requestId;
      var target = (req && req.target) || '';
      var action = (req && req.action) || 'click';
      var payload = req && req.payload;
      var t0 = performance.now();
      try {
        var reg = stores.get(target) || components.get(target);
        if (reg && reg.actions && typeof reg.actions[action] === 'function') {
          var beforeState = safeSerialize(reg.getState ? reg.getState() : {});
          var tAct = performance.now();
          var result = reg.actions[action](payload);
          if (result && typeof result.then === 'function') {
            result.then(function () { finishAction(); }, function (err) { failAction(err); });
            return;
          }
          finishAction();
          return;
        }
        function finishAction() {
          setTimeout(function () {
            var actionMs = Number((performance.now() - tAct).toFixed(2));
            var afterState = safeSerialize(reg.getState ? reg.getState() : {});
            var diff = {};
            var keys = Object.keys(beforeState || {}).concat(Object.keys(afterState || {}));
            for (var i = 0; i < keys.length; i++) {
              var k = keys[i];
              if (diff[k]) continue;
              if (JSON.stringify(beforeState[k]) !== JSON.stringify(afterState[k])) diff[k] = { before: beforeState[k], after: afterState[k] };
            }
            pushTrace({ type: 'verify:' + action, target: target, route: window.location.pathname || '/', diff: diff, timestamp: Date.now() });
            import.meta.hot.send('oumv:vue-snapshot', buildSnapshot());
            import.meta.hot.send('oumv:vue-verify-res', {
              requestId: requestId, status: 'passed', target: target, action: action, diff: diff,
              surfaceDiff: [], durationMs: Number((performance.now() - t0).toFixed(2)),
              latency: { actionMs: actionMs, totalMs: Number((performance.now() - t0).toFixed(2)) },
            });
          }, 20);
        }
        function failAction(err) {
          import.meta.hot.send('oumv:vue-verify-res', { requestId: requestId, status: 'failed', target: target, action: action, error: err && err.message ? err.message : String(err) });
        }

        var el = findDomTarget(target);
        if (!el) {
          import.meta.hot.send('oumv:vue-verify-res', { requestId: requestId, status: 'failed', errorCode: -32004, error: "Target element or component '" + target + "' not found in live Vue DOM" });
          return;
        }

        var beforeRoute = (window.location.pathname || '/') + (window.location.search || '');
        var beforeText = (el.textContent || '').trim().slice(0, 80);
        var beforeValue = 'value' in el ? el.value : undefined;
        var beforeDisabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
        var beforeSurface = collectInteractiveSurface();
        var tActDom = performance.now();

        if (action === 'click' || action === 'invoke') el.click();
        else if (action === 'input' || action === 'setValue' || action === 'change') {
          var val = payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload;
          setNativeInputValue(el, val === undefined || val === null ? '' : val);
        } else if (action === 'submit') {
          var form = el.tagName === 'FORM' ? el : el.closest('form');
          if (form && typeof form.requestSubmit === 'function') form.requestSubmit(); else el.click();
        } else if (action === 'focus') el.focus();
        else {
          import.meta.hot.send('oumv:vue-verify-res', { requestId: requestId, status: 'failed', errorCode: -32005, error: "Action '" + action + "' is not supported on DOM target '" + target + "'" });
          return;
        }
        var actionMsDom = Number((performance.now() - tActDom).toFixed(2));

        setTimeout(function () {
          var afterRoute = (window.location.pathname || '/') + (window.location.search || '');
          var afterText = (el.textContent || '').trim().slice(0, 80);
          var afterValue = 'value' in el ? el.value : undefined;
          var afterDisabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
          var afterSurface = collectInteractiveSurface();
          var diff = {};
          if (beforeRoute !== afterRoute) diff.route = { before: beforeRoute, after: afterRoute };
          if (beforeText !== afterText) diff.text = { before: beforeText, after: afterText };
          if (beforeValue !== afterValue) diff.value = { before: beforeValue, after: afterValue };
          if (beforeDisabled !== afterDisabled) diff.disabled = { before: beforeDisabled, after: afterDisabled };
          var surfaceDiff = [];
          var beforeMap = new Map(beforeSurface.map(function (s) { return [s.id, s]; }));
          var afterMap = new Map(afterSurface.map(function (s) { return [s.id, s]; }));
          afterMap.forEach(function (item, id) {
            var prev = beforeMap.get(id);
            if (!prev) surfaceDiff.push({ op: 'visibility', target: id, before: false, after: true });
            else if (prev.label !== item.label) surfaceDiff.push({ op: 'text', target: id, before: prev.label, after: item.label });
          });
          beforeMap.forEach(function (item, id) { if (!afterMap.has(id)) surfaceDiff.push({ op: 'visibility', target: id, before: true, after: false }); });
          pushTrace({ type: 'verify:' + action, target: target, route: afterRoute, diff: diff, timestamp: Date.now() });
          import.meta.hot.send('oumv:vue-snapshot', buildSnapshot());
          import.meta.hot.send('oumv:vue-verify-res', {
            requestId: requestId, status: 'passed', target: target, action: action, diff: diff,
            surfaceDiff: surfaceDiff.slice(0, 30), durationMs: Number((performance.now() - t0).toFixed(2)),
            latency: { actionMs: actionMsDom, totalMs: Number((performance.now() - t0).toFixed(2)) },
          });
        }, 35);
      } catch (err) {
        import.meta.hot.send('oumv:vue-verify-res', { requestId: requestId, status: 'failed', error: err && err.message ? err.message : String(err) });
      }
    });
  }
}
`;
}
