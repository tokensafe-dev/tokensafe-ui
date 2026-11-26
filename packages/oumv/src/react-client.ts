export {
  defineOUMVComponent,
  getOUMVComponentContract,
  listOUMVComponentContracts,
  resetOUMVComponentContracts,
  type OumvActionContract,
  type OumvComponentContract,
  type OumvContractRecord,
} from './contracts.js';

export interface BrowserStoreRegistration {
  id: string;
  getState: () => Record<string, any>;
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
  subscribe?: (listener: () => void) => (() => void) | void;
}

/**
 * Registers a React store or state getter with the live browser OUMV bridge
 * (injected by tokensafe-ui/vite in dev mode). Safe no-op in production or SSR.
 */
export function registerReactStore(
  id: string,
  storeOrGetter:
    | (() => Record<string, any>)
    | { getState: () => Record<string, any>; subscribe?: (fn: () => void) => any; [k: string]: any },
  actions?: Record<string, (payload?: any) => any | Promise<any>>
): () => void {
  const bridge = (globalThis as any).__OUMV_REACT__;
  if (!bridge || typeof bridge.registerStore !== 'function') {
    return () => {};
  }
  return bridge.registerStore(id, storeOrGetter, actions);
}

/**
 * Registers an ad-hoc React component state/actions descriptor with the live
 * browser OUMV bridge. Safe no-op when dev bridge is absent.
 */
export function registerReactComponent(def: BrowserStoreRegistration): () => void {
  const bridge = (globalThis as any).__OUMV_REACT__;
  if (!bridge || typeof bridge.registerComponent !== 'function') {
    return () => {};
  }
  return bridge.registerComponent(def);
}
