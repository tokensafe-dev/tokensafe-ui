import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
import { validateWorkspacePath, atomicApplySourceEdit } from '@tokensafe-ui/mcp';

export interface ReactComponentDefinition {
  id: string;
  name?: string;
  filePath?: string;
  props?: Record<string, any>;
  getState?: () => Record<string, any>;
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
  dependencies?: string[];
  dependents?: string[];
}

/**
 * Duck-typed interface for Zustand stores or hook-backed vanilla stores (e.g. useCartStore).
 */
export interface ZustandStoreLike {
  getState: () => Record<string, any>;
  setState?: (partial: any, replace?: boolean) => void;
  subscribe: (listener: (state: any, prevState?: any) => void) => (() => void) | void;
}

export interface ZustandConnectorOptions {
  id?: string;
  name?: string;
  filePath?: string;
  dependencies?: string[];
  dependents?: string[];
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
}

/**
 * Duck-typed interface for Redux stores (e.g. configureStore() from RTK or legacy createStore).
 */
export interface ReduxStoreLike {
  getState: () => any;
  dispatch: (action: any) => any;
  subscribe: (listener: () => void) => (() => void) | void;
}

export interface ReduxConnectorOptions {
  id?: string;
  name?: string;
  filePath?: string;
  dependencies?: string[];
  dependents?: string[];
  actionCreators?: Record<string, (payload?: any) => any>;
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
}

/**
 * Duck-typed interface for React useReducer tuple [state, dispatch] or object { state, dispatch }.
 */
export type ReducerTuple<S = any, A = any> = [S, (action: A) => void];

export interface ReducerObject<S = any, A = any> {
  state: S;
  dispatch: (action: A) => void;
}

export type ReducerLike<S = any, A = any> =
  | ReducerTuple<S, A>
  | ReducerObject<S, A>
  | (() => ReducerTuple<S, A> | ReducerObject<S, A>);

export interface ReducerConnectorOptions {
  id?: string;
  name?: string;
  filePath?: string;
  dependencies?: string[];
  dependents?: string[];
  actionCreators?: Record<string, (payload?: any) => any>;
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
}

/**
 * Duck-typed interface for React Context values (state objects with updater functions, provider values, or state tuples).
 */
export interface ContextConnectorOptions {
  id?: string;
  name?: string;
  filePath?: string;
  dependencies?: string[];
  dependents?: string[];
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
}

export type ContextValueLike =
  | Record<string, any>
  | [any, (valOrAction: any) => void]
  | (() => any);

export type StoreLike =
  | ZustandStoreLike
  | ReduxStoreLike
  | ReducerLike
  | ContextValueLike
  | ReactComponentDefinition;

export interface ConnectedStoreComponent extends ReactComponentDefinition {
  subscribeToTraces?: (onTrace: (event: ReactTraceEvent) => void) => () => void;
  unsubscribe?: () => void;
}

export interface ReactAdapterConfig {
  projectRoot?: string;
  rootElement?: HTMLElement;
  components?: Record<string, ReactComponentDefinition>;
  stores?: Record<string, StoreLike>;
  contexts?: Record<string, ContextValueLike | ConnectedStoreComponent>;
}

export interface ReactTraceEvent {
  timestamp: number;
  type: string;
  componentId: string;
  details: string;
  diff?: Record<string, any>;
}

export function isZustandStore(store: any): store is ZustandStoreLike {
  return (
    store != null &&
    typeof store.getState === 'function' &&
    typeof store.subscribe === 'function' &&
    (typeof store.setState === 'function' || !('dispatch' in store))
  );
}

export function isReduxStore(store: any): store is ReduxStoreLike {
  return (
    store != null &&
    typeof store.getState === 'function' &&
    typeof store.dispatch === 'function' &&
    typeof store.subscribe === 'function'
  );
}

export function isReducerLike(target: any): target is ReducerLike {
  if (Array.isArray(target) && target.length >= 2 && typeof target[1] === 'function') {
    return true;
  }
  if (target && typeof target === 'object' && 'state' in target && typeof target.dispatch === 'function') {
    return true;
  }
  return false;
}

/**
 * Connects a React useReducer instance ([state, dispatch] or { state, dispatch }) to the OUMV protocol.
 */
export function connectReducer(
  reducerTarget: ReducerLike,
  options: ReducerConnectorOptions = {}
): ConnectedStoreComponent {
  const storeId = options.id || options.name || 'use-reducer';

  const resolve = () => {
    const raw = typeof reducerTarget === 'function' ? reducerTarget() : reducerTarget;
    if (Array.isArray(raw)) {
      return { state: raw[0], dispatch: raw[1] };
    }
    return { state: raw.state, dispatch: raw.dispatch };
  };

  const getState = (): Record<string, any> => {
    const { state } = resolve();
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(state)) {
        if (typeof v !== 'function') clean[k] = v;
      }
      return clean;
    }
    return { value: state };
  };

  const actions: Record<string, (payload?: any) => any> = {
    dispatch: (action: any) => {
      const { dispatch } = resolve();
      return dispatch(action);
    },
  };

  if (options.actionCreators) {
    for (const [name, creator] of Object.entries(options.actionCreators)) {
      actions[name] = (payload?: any) => {
        const { dispatch } = resolve();
        return dispatch(creator(payload));
      };
    }
  }

  if (options.actions) {
    Object.assign(actions, options.actions);
  }

  return {
    id: storeId,
    name: options.name || storeId,
    filePath: options.filePath,
    dependencies: options.dependencies,
    dependents: options.dependents,
    getState,
    actions,
  };
}

/**
 * Connects a React Context value (object with state properties & updater functions, or Provider value) to the OUMV protocol.
 * Auto-discovers state properties and actions.
 */
export function connectContext(
  contextValue: ContextValueLike,
  options: ContextConnectorOptions = {}
): ConnectedStoreComponent {
  const contextId = options.id || options.name || 'react-context';

  const resolve = () => {
    return typeof contextValue === 'function' ? contextValue() : contextValue;
  };

  const getState = (): Record<string, any> => {
    const val = resolve();
    if (Array.isArray(val) && val.length >= 2 && typeof val[1] === 'function') {
      const s = val[0];
      return s && typeof s === 'object' && !Array.isArray(s) ? s : { value: s };
    }
    if (val && typeof val === 'object') {
      if ('state' in val && typeof val.dispatch === 'function') {
        const s = val.state;
        return s && typeof s === 'object' && !Array.isArray(s) ? s : { value: s };
      }
      const state: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        if (typeof v !== 'function') {
          state[k] = v;
        }
      }
      return state;
    }
    return { value: val };
  };

  const actions: Record<string, (payload?: any) => any> = {};

  const val = resolve();
  if (Array.isArray(val) && val.length >= 2 && typeof val[1] === 'function') {
    actions['set'] = (payload: any) => val[1](payload);
    actions['dispatch'] = (payload: any) => val[1](payload);
  } else if (val && typeof val === 'object') {
    if (typeof val.dispatch === 'function') {
      actions['dispatch'] = (action: any) => {
        const latest = resolve();
        return latest.dispatch(action);
      };
    }
    for (const [k, v] of Object.entries(val)) {
      if (typeof v === 'function' && k !== 'dispatch') {
        actions[k] = async (payload?: any) => {
          const latest = resolve();
          const fn = typeof latest[k] === 'function' ? latest[k] : v;
          return fn(payload);
        };
      }
    }
  }

  if (options.actions) {
    Object.assign(actions, options.actions);
  }

  return {
    id: contextId,
    name: options.name || contextId,
    filePath: options.filePath,
    dependencies: options.dependencies,
    dependents: options.dependents,
    getState,
    actions,
  };
}

/**
 * Connects a Zustand store to the OUMV protocol.
 * Auto-discovers state properties and actions, and subscribes to state transitions for L4 traces.
 */
export function connectZustand(
  store: ZustandStoreLike,
  options: ZustandConnectorOptions = {}
): ConnectedStoreComponent {
  const storeId = options.id || options.name || 'zustand-store';

  const getState = (): Record<string, any> => {
    const raw = store.getState() || {};
    const state: Record<string, any> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'function') {
        state[key] = value;
      }
    }
    return state;
  };

  const actions: Record<string, (payload?: any) => any> = {};

  // Auto-discover actions from store.getState()
  const rawInitial = store.getState() || {};
  for (const [key, value] of Object.entries(rawInitial)) {
    if (typeof value === 'function') {
      actions[key] = async (payload?: any) => {
        const current = store.getState() || {};
        const fn = typeof current[key] === 'function' ? current[key] : value;
        return fn(payload);
      };
    }
  }

  // Expose generic setState if present
  if (typeof store.setState === 'function') {
    actions['setState'] = (payload: any) => {
      store.setState!(payload);
    };
  }

  if (options.actions) {
    Object.assign(actions, options.actions);
  }

  let traceCallback: ((event: ReactTraceEvent) => void) | null = null;
  let lastState = getState();

  let unsub: (() => void) | void;
  try {
    unsub = store.subscribe((nextOrState: any, prevOrUndefined?: any) => {
      const currentState = getState();
      const diff: Record<string, { before: any; after: any }> = {};
      const keys = new Set([...Object.keys(lastState), ...Object.keys(currentState)]);
      let hasChanges = false;

      for (const k of keys) {
        if (!Object.is(lastState[k], currentState[k])) {
          diff[k] = { before: lastState[k], after: currentState[k] };
          hasChanges = true;
        }
      }

      if (hasChanges && traceCallback) {
        traceCallback({
          timestamp: Date.now(),
          type: 'zustand:update',
          componentId: storeId,
          details: `Zustand store '${storeId}' state updated`,
          diff,
        });
      }

      lastState = currentState;
    });
  } catch {}

  return {
    id: storeId,
    name: options.name || storeId,
    filePath: options.filePath,
    dependencies: options.dependencies,
    dependents: options.dependents,
    getState,
    actions,
    subscribeToTraces: (onTrace) => {
      traceCallback = onTrace;
      return () => {
        traceCallback = null;
      };
    },
    unsubscribe: () => {
      if (typeof unsub === 'function') unsub();
    },
  };
}

/**
 * Connects a Redux store to the OUMV protocol.
 * Subscribes to store updates for L4 traces and maps action creators.
 */
export function connectRedux(
  store: ReduxStoreLike,
  options: ReduxConnectorOptions = {}
): ConnectedStoreComponent {
  const storeId = options.id || options.name || 'redux-store';

  const getState = (): Record<string, any> => {
    const raw = store.getState();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const state: Record<string, any> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== 'function') {
          state[key] = value;
        }
      }
      return state;
    }
    return { value: raw };
  };

  const actions: Record<string, (payload?: any) => any> = {
    dispatch: (action: any) => store.dispatch(action),
  };

  if (options.actionCreators) {
    for (const [name, creator] of Object.entries(options.actionCreators)) {
      actions[name] = (payload?: any) => store.dispatch(creator(payload));
    }
  }

  if (options.actions) {
    Object.assign(actions, options.actions);
  }

  let traceCallback: ((event: ReactTraceEvent) => void) | null = null;
  let lastState = getState();

  let unsub: (() => void) | void;
  try {
    unsub = store.subscribe(() => {
      const currentState = getState();
      const diff: Record<string, { before: any; after: any }> = {};
      const keys = new Set([...Object.keys(lastState), ...Object.keys(currentState)]);
      let hasChanges = false;

      for (const k of keys) {
        if (!Object.is(lastState[k], currentState[k])) {
          diff[k] = { before: lastState[k], after: currentState[k] };
          hasChanges = true;
        }
      }

      if (hasChanges && traceCallback) {
        traceCallback({
          timestamp: Date.now(),
          type: 'redux:update',
          componentId: storeId,
          details: `Redux store '${storeId}' state updated`,
          diff,
        });
      }

      lastState = currentState;
    });
  } catch {}

  return {
    id: storeId,
    name: options.name || storeId,
    filePath: options.filePath,
    dependencies: options.dependencies,
    dependents: options.dependents,
    getState,
    actions,
    subscribeToTraces: (onTrace) => {
      traceCallback = onTrace;
      return () => {
        traceCallback = null;
      };
    },
    unsubscribe: () => {
      if (typeof unsub === 'function') unsub();
    },
  };
}

/**
 * Creates an official OUMV Protocol Adapter for React (18/19) runtimes.
 * Conforms to the @oumv/protocol specification.
 */
export function createReactAdapter(config: ReactAdapterConfig = {}) {
  const projectRoot = config.projectRoot || process.cwd();
  const componentRegistry = new Map<string, ReactComponentDefinition>();
  const traceEvents: ReactTraceEvent[] = [];

  if (config.components) {
    for (const [id, comp] of Object.entries(config.components)) {
      componentRegistry.set(id, comp);
    }
  }

  const getRoot = (): HTMLElement | null => {
    if (config.rootElement) return config.rootElement;
    if (typeof document !== 'undefined') {
      return document.getElementById('root') || document.getElementById('app') || document.body;
    }
    return null;
  };

  const unsubs: Array<() => void> = [];

  const registerComponent = (comp: ReactComponentDefinition) => {
    componentRegistry.set(comp.id, comp);
  };

  const registerStore = (id: string, store: StoreLike) => {
    let comp: ConnectedStoreComponent;
    if (isZustandStore(store)) {
      comp = connectZustand(store, { id });
    } else if (isReduxStore(store)) {
      comp = connectRedux(store, { id });
    } else if (isReducerLike(store)) {
      comp = connectReducer(store, { id });
    } else if (typeof store === 'object' && ('getState' in store || 'actions' in store)) {
      comp = store as ConnectedStoreComponent;
    } else {
      comp = connectContext(store as ContextValueLike, { id });
    }

    if (comp.subscribeToTraces) {
      const unsubTrace = comp.subscribeToTraces((ev) => {
        traceEvents.push(ev);
      });
      unsubs.push(unsubTrace);
    }
    if (comp.unsubscribe) {
      unsubs.push(comp.unsubscribe);
    }

    componentRegistry.set(id, comp);
    return comp;
  };

  const registerContext = (id: string, contextVal: ContextValueLike) => {
    return registerStore(id, contextVal);
  };

  if (config.stores) {
    for (const [id, store] of Object.entries(config.stores)) {
      registerStore(id, store);
    }
  }

  if (config.contexts) {
    for (const [id, ctx] of Object.entries(config.contexts)) {
      registerContext(id, ctx);
    }
  }

  return {
    name: 'react',
    version: '18.x/19.x',
    registerComponent,
    registerStore,
    registerContext,
    connectZustand,
    connectRedux,
    connectReducer,
    connectContext,
    recordTrace: (event: ReactTraceEvent) => {
      traceEvents.push(event);
    },
    dispose: () => {
      for (const u of unsubs) {
        try {
          u();
        } catch {}
      }
    },

    async handshake(params?: any) {
      // §11: serve our own MINOR and every earlier one; another MAJOR is -32006.
      const requested = String(params?.protocolVersion ?? '').trim();
      if (requested) {
        const [majorRaw, minorRaw] = requested.split('.');
        const major = Number(majorRaw);
        const minor = Number(minorRaw);
        if (!Number.isInteger(major) || !Number.isInteger(minor) || major !== 1 || minor > 5) {
          const err: any = new Error(
            `UNSUPPORTED_CAPABILITY: protocol version ${requested} (this runtime serves 1.5.0)`,
          );
          err.code = -32006;
          throw err;
        }
      }
      return {
        protocolVersion: '1.5.0',
        profile: 'frontend' as const,
        sessionId: `sess-react-${Math.random().toString(36).slice(2, 10)}`,
        runtimeInfo: {
          name: 'react',
          version: '18.x/19.x',
        },
        capabilities: {
          observe: {
            levels: ['L0' as const, 'L1' as const, 'L2' as const, 'L3' as const, 'L4' as const],
            formats: ['yaml' as const, 'json' as const, 'sexp' as const],
          },
          understand: {
            causality: true,
            signalsGraph: false,
            componentGraph: true,
            impactAnalysis: true,
          },
          mutate: {
            occ: true,
            syntaxGuard: true,
            ephemeralDispatch: true,
          },
          verify: {
            multiMetric: true,
            surfaceDiff: true,
          },
        },
      };
    },

    async observe(params: {
      level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
      format?: 'yaml' | 'json' | 'sexp';
      componentId?: string;
      target?: string;
    }) {
      const format = params.format || 'yaml';
      const root = getRoot();
      const mountedCompIds = Array.from(componentRegistry.keys());
      const targetCompId = params.componentId || params.target;

      // L0: Page Pulse
      if (params.level === 'L0') {
        const route =
          typeof window !== 'undefined' && window.location ? window.location.pathname || '/' : '/';
        const pulse = {
          level: 'L0',
          framework: 'react',
          route,
          mounted: mountedCompIds,
          elements: root ? root.querySelectorAll('*').length : 0,
          errors: 0,
        };

        const payload =
          format === 'json'
            ? JSON.stringify(pulse, null, 2)
            : `level: L0\nframework: react\nroute: ${route}\nmounted: [${mountedCompIds.join(', ')}]\nelements: ${pulse.elements}\nerrors: 0\n`;

        return {
          level: 'L0' as const,
          format,
          payload,
          tokenEstimate: Math.ceil(payload.length / 4),
          timestamp: Date.now(),
        };
      }

      // L1: Interactive Surface
      if (params.level === 'L1') {
        const elements: Array<{
          id: string;
          role: string;
          value?: any;
          action?: string;
          disabled?: boolean;
        }> = [];

        if (root) {
          const interactiveNodes = root.querySelectorAll(
            'button, input, select, textarea, a[href], [role="button"], [data-agent-id], [data-testid]'
          );

          interactiveNodes.forEach((node, i) => {
            const el = node as HTMLElement;
            const agentId =
              el.getAttribute('data-agent-id') ||
              el.getAttribute('data-testid') ||
              el.id ||
              `${el.tagName.toLowerCase()}_${i}`;
            const role =
              el.getAttribute('role') || el.tagName.toLowerCase();
            const action =
              el.getAttribute('data-action') ||
              el.getAttribute('data-agent-action') ||
              (el.getAttribute('onClick') ? 'click' : undefined);

            let val: any = undefined;
            if (el instanceof HTMLInputElement) {
              val = el.type === 'checkbox' ? el.checked : el.value;
            } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
              val = el.value;
            }

            elements.push({
              id: agentId,
              role,
              value: val,
              action,
              disabled: (el as any).disabled || undefined,
            });
          });
        }

        const surfaceData = {
          view: params.componentId || 'react-root',
          framework: 'react',
          elements,
        };

        let payload = '';
        if (format === 'json') {
          payload = JSON.stringify(surfaceData, null, 2);
        } else {
          payload = `view: ${surfaceData.view}\nframework: react\nelements:\n` +
            elements
              .map(
                (e) =>
                  `  - ${e.id} [role: ${e.role}${e.value !== undefined ? `, value: ${JSON.stringify(e.value)}` : ''}${e.action ? `, action: ${e.action}` : ''}${e.disabled ? ', disabled: true' : ''}]`
              )
              .join('\n') + '\n';
        }

        return {
          level: 'L1' as const,
          format,
          payload,
          tokenEstimate: Math.ceil(payload.length / 4),
          timestamp: Date.now(),
        };
      }

      // L2: Component Contract
      if (params.level === 'L2') {
        const compId = targetCompId || mountedCompIds[0] || 'default';
        const comp = componentRegistry.get(compId);

        const state = comp?.getState ? comp.getState() : {};
        const actions = comp?.actions ? Object.keys(comp.actions) : [];

        const contract = {
          level: 'L2',
          componentId: compId,
          name: comp?.name || compId,
          state,
          actions,
          props: comp?.props || {},
        };

        const payload =
          format === 'json'
            ? JSON.stringify(contract, null, 2)
            : `level: L2\ncomponent: ${compId}\nstate: ${JSON.stringify(state)}\nactions: [${actions.join(', ')}]\n`;

        return {
          level: 'L2' as const,
          format,
          payload,
          tokenEstimate: Math.ceil(payload.length / 4),
          timestamp: Date.now(),
        };
      }

      // L3: Isolated Source
      if (params.level === 'L3') {
        const compId = targetCompId || mountedCompIds[0] || 'default';
        const comp = componentRegistry.get(compId);
        const relPath = comp?.filePath || `${compId}.tsx`;
        const resolved = validateWorkspacePath(relPath, projectRoot);

        let source = '';
        if (fs.existsSync(resolved)) {
          source = fs.readFileSync(resolved, 'utf-8');
        } else {
          source = `// React Component: ${compId}\nexport function ${comp?.name || 'Component'}() {\n  return <div>${compId}</div>;\n}\n`;
        }

        const lines = source.split('\n');
        const payload = lines.map((l, idx) => `${idx + 1} | ${l}`).join('\n');

        return {
          level: 'L3' as const,
          format,
          payload,
          tokenEstimate: Math.ceil(payload.length / 4),
          timestamp: Date.now(),
        };
      }

      // L4: Traces
      const relevantTraces = targetCompId
        ? traceEvents.filter((e) => e.componentId === targetCompId)
        : traceEvents;

      const payload = JSON.stringify(relevantTraces, null, 2);
      return {
        level: 'L4' as const,
        format,
        payload,
        tokenEstimate: Math.ceil(payload.length / 4),
        timestamp: Date.now(),
      };
    },

    async understand(params: {
      query: 'impact' | 'dependencies' | 'causality' | 'why_state';
      target?: string;
    }) {
      const targetId = params.target || '';

      if (params.query === 'impact') {
        const comp = componentRegistry.get(targetId);
        const directlyAffected = comp?.dependents || [];
        const indirectlyAffected: string[] = [];

        for (const depId of directlyAffected) {
          const parent = componentRegistry.get(depId);
          if (parent?.dependents) {
            for (const d of parent.dependents) {
              if (!directlyAffected.includes(d) && !indirectlyAffected.includes(d)) {
                indirectlyAffected.push(d);
              }
            }
          }
        }

        const safeComponents = Array.from(componentRegistry.keys()).filter(
          (id) => id !== targetId && !directlyAffected.includes(id) && !indirectlyAffected.includes(id)
        );

        return {
          target: targetId,
          directlyAffected,
          indirectlyAffected,
          safeComponents,
          blastRadiusDepth: directlyAffected.length > 0 ? 1 : 0,
          recommendation: directlyAffected.length > 0
            ? `Modify with care: affects ${directlyAffected.join(', ')}`
            : `Safe: isolated component with 0 dependents`,
        };
      }

      if (params.query === 'causality' || params.query === 'why_state') {
        const comp = componentRegistry.get(targetId);
        const state = comp?.getState ? comp.getState() : {};
        const lastTrace = [...traceEvents]
          .reverse()
          .find((e) => e.componentId === targetId);

        return {
          target: targetId,
          componentId: targetId,
          state,
          explanation: lastTrace
            ? `State in React component '${targetId}' was modified by action '${lastTrace.type}'.`
            : `State in React component '${targetId}' holds default initial values.`,
          lastTrace,
        };
      }

      // 'dependencies'
      const lines: string[] = ['react_dependency_graph:'];
      for (const [id, comp] of componentRegistry.entries()) {
        lines.push(`  - component: ${id}`);
        lines.push(`    dependencies: [${(comp.dependencies || []).join(', ')}]`);
        lines.push(`    dependents: [${(comp.dependents || []).join(', ')}]`);
        if (comp.getState) {
          lines.push(`    stateKeys: [${Object.keys(comp.getState()).join(', ')}]`);
        }
      }

      return { yaml: lines.join('\n') };
    },

    async getSource(params: { componentId: string; filePath: string }) {
      const resolved = validateWorkspacePath(params.filePath, projectRoot);
      if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${resolved}`);
      }
      const source = fs.readFileSync(resolved, 'utf-8');
      const version =
        'sha256:' + crypto.createHash('sha256').update(source).digest('hex');

      return {
        componentId: params.componentId,
        filePath: path.relative(projectRoot, resolved),
        version,
        source,
      };
    },

    async applyEdit(params: {
      filePath: string;
      source: string;
      expectedVersion: string;
    }) {
      const resolved = validateWorkspacePath(params.filePath, projectRoot);

      // Validate JSX/TSX syntax using Babel parser
      try {
        parser.parse(params.source, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
        });
      } catch (err: any) {
        throw new Error(`[OUMV SYNTAX_ERROR] Invalid JSX/TSX syntax: ${err.message}`);
      }

      const res = atomicApplySourceEdit(resolved, params.source, {
        expectedVersion: params.expectedVersion,
        validateTypeScript: true,
      });

      return {
        success: true,
        filePath: path.relative(projectRoot, res.filePath),
        version: res.version,
        message: res.message,
      };
    },

    async verify(params: { componentId?: string; target?: string; action: string; payload?: any }) {
      const t0 = performance.now();
      const compId = params.componentId || params.target || '';
      const comp = componentRegistry.get(compId);

      if (!comp) {
        throw new Error(`Component '${compId}' not found in React registry`);
      }

      const stateBefore = comp.getState ? JSON.parse(JSON.stringify(comp.getState())) : {};

      const actionFn = comp.actions ? comp.actions[params.action] : null;
      if (!actionFn) {
        throw new Error(`Action '${params.action}' not defined on React component '${compId}'`);
      }

      const tActionStart = performance.now();
      const res = actionFn(params.payload);
      if (res instanceof Promise) {
        await res;
      }
      const actionMs = performance.now() - tActionStart;

      const stateAfter = comp.getState ? JSON.parse(JSON.stringify(comp.getState())) : {};

      // Compute diff
      const stateDiff: Record<string, { before: any; after: any }> = {};
      for (const k of Object.keys({ ...stateBefore, ...stateAfter })) {
        if (!Object.is(stateBefore[k], stateAfter[k])) {
          stateDiff[k] = { before: stateBefore[k], after: stateAfter[k] };
        }
      }

      const totalMs = performance.now() - t0;

      const trace: ReactTraceEvent = {
        timestamp: Date.now(),
        type: params.action,
        componentId: compId,
        details: `Action '${params.action}' executed on React component '${compId}'`,
        diff: stateDiff,
      };
      traceEvents.push(trace);

      return {
        componentId: compId,
        action: params.action,
        stateBefore,
        stateAfter,
        stateDiff,
        surfaceDiff: {
          changed: Object.keys(stateDiff).length,
        },
        latency: {
          actionMs: Number(actionMs.toFixed(2)),
          totalMs: Number(totalMs.toFixed(2)),
        },
      };
    },
  };
}
