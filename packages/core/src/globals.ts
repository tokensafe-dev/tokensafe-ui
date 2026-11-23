// Unified global symbols for TokenSafe UI runtime singletons
export const GLOBAL_KEYS = {
  ACTIVE_INSTANCES: Symbol.for('tokensafe-ui.activeInstances'),
  RUNTIME_SIGNALS: Symbol.for('tokensafe-ui.runtimeSignals'),
  CAUSALITY_GRAPH: Symbol.for('tokensafe-ui.causalityGraph'),
  TELEMETRY_LOG: Symbol.for('tokensafe-ui.telemetryLog'),
  RUNTIME_VERSION: Symbol.for('tokensafe-ui.runtimeVersion'),
  HEADLESS_DOM_INITIALIZED: Symbol.for('tokensafe-ui.headlessDomInitialized'),
} as const;

export function getGlobalRegistry<T>(key: symbol, factory: () => T): T {
  const g = globalThis as any;
  if (!g[key]) {
    g[key] = factory();
  }
  return g[key];
}

// Multi-instance collision detection in development
export function checkMultiInstanceGuard(moduleVersion: string) {
  const g = globalThis as any;
  const existing = g[GLOBAL_KEYS.RUNTIME_VERSION];
  if (existing && existing !== moduleVersion) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[tokensafe-ui] Multi-Instance Warning: Detected competing versions (${existing} vs ${moduleVersion}). Synchronizing shared global state.`
      );
    }
  }
  g[GLOBAL_KEYS.RUNTIME_VERSION] = moduleVersion;
}

// Auto-run version guard
checkMultiInstanceGuard('0.2.0');
