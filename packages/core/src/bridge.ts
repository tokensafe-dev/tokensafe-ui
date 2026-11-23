import { h } from './dom.js';
import type { Signal } from './signals.js';

export interface ReactBridgeProps {
  component: any;
  props?: Record<string, any>;
  className?: string;
  class?: string;
  wrapperProps?: Record<string, any>;
}

/**
 * Universal Production-Grade React Bridge for TokenSafe UI.
 * Mounts any React 18/19 component inside a TokenSafe UI reactive tree.
 * - Handles createRoot and root.render
 * - Automatically updates props reactively on re-renders
 * - Safely unmounts React tree when the DOM container is detached
 */
export function ReactBridge({
  component: Component,
  props = {},
  className = '',
  class: cls = '',
  wrapperProps = {},
}: ReactBridgeProps) {
  let rootInstance: any = null;
  const combinedClass = `${cls} ${className}`.trim();

  const handleRef = (el: HTMLElement | null) => {
    if (!el) {
      if (rootInstance) {
        try {
          rootInstance.unmount();
        } catch {}
        rootInstance = null;
      }
      return;
    }

    try {
      const React = (globalThis as any).React || (typeof window !== 'undefined' && (window as any).React);
      const ReactDOMClient = (globalThis as any).ReactDOM || (typeof window !== 'undefined' && (window as any).ReactDOM);

      if (ReactDOMClient && typeof ReactDOMClient.createRoot === 'function') {
        if (!rootInstance) {
          rootInstance = ReactDOMClient.createRoot(el);
        }
        rootInstance.render(React ? React.createElement(Component, props) : Component(props));
      } else {
        const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
        dynamicImport('react-dom/client').then(({ createRoot }: any) => {
          dynamicImport('react').then((ReactModule: any) => {
            if (!rootInstance) {
              rootInstance = createRoot(el);
            }
            rootInstance.render(ReactModule.createElement(Component, props));
          }).catch(() => {
            if (!rootInstance) {
              rootInstance = createRoot(el);
            }
            rootInstance.render(Component(props));
          });
        }).catch((err: any) => {
          console.warn('[TokenSafe ReactBridge Warning]: react-dom/client could not be loaded:', err);
        });
      }
    } catch (err) {
      console.error('[TokenSafe ReactBridge Error]:', err);
    }
  };

  return h('div', {
    ref: handleRef,
    class: combinedClass || 'tokensafe-react-bridge',
    ...wrapperProps,
  });
}

/**
 * React 18/19 useSyncExternalStore Hook Adapter.
 * Allows React components to consume TokenSafe UI signals reactively.
 */
export function createUseSignal(useSyncExternalStore: any) {
  return function useSignal<T>(sig: Signal<T>): T {
    if (!sig || typeof sig.subscribe !== 'function') {
      return (sig as any)?.value;
    }
    return useSyncExternalStore(
      (notify: () => void) => sig.subscribe(notify),
      () => sig.value,
      () => sig.peek()
    );
  };
}
