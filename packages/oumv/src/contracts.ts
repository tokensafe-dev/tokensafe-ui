/**
 * Level 3 semantic component contracts for the OUMV Frontend Profile (spec §6.4/§10.4).
 *
 * Declares what a component MEANS — purpose, actions, constraints — so agents
 * understand intent, not just structure. Works for retrofit React and Vue
 * components without rewriting them; registration is opt-in and incremental:
 * the wrapped component keeps working exactly as before.
 *
 *   defineOUMVComponent(CheckoutForm, {
 *     description: 'Checkout form',
 *     actions: { submit: { description: 'Submit the current order', input: CheckoutInputSchema } },
 *     constraints: ['A cart must contain at least one item'],
 *   });
 */

export interface OumvActionContract {
  /** Human/agent-readable purpose of the action. */
  description: string;
  /** Optional input schema (Zod schema, JSON Schema object, or descriptive map). */
  input?: unknown;
  /** Optional expected state changes after the action runs. */
  expectedChanges?: string[];
}

export interface OumvComponentContract {
  /** Component purpose, one sentence. */
  description: string;
  /** Declared actions keyed by name (must match real handlers where possible). */
  actions?: Record<string, OumvActionContract>;
  /** Business invariants that must remain true. */
  constraints?: string[];
  /** Explicit state semantics for non-obvious fields. */
  stateNotes?: Record<string, string>;
}

export interface OumvContractRecord extends OumvComponentContract {
  componentId: string;
  componentName: string;
  evidence: {
    provenance: 'contract';
    sourceAdapter: string;
    confidence: 'confirmed';
  };
}

const registry = new Map<string, OumvContractRecord>();

function componentKey(component: any): string {
  if (typeof component === 'string') return component;
  return (
    component?.id ||
    component?.name ||
    component?.displayName ||
    component?.__tokensafe_id__ ||
    'anonymous-component'
  );
}

/**
 * Attaches an OUMV semantic contract to a component (React function component,
 * Vue component options object, or a tokensafe-ui `defineComponent` factory).
 * Returns the SAME component so call sites remain unchanged.
 */
export function defineOUMVComponent<T>(component: T, contract: OumvComponentContract): T {
  const record: OumvContractRecord = {
    ...contract,
    componentId: componentKey(component),
    componentName: componentKey(component),
    evidence: {
      provenance: 'contract',
      sourceAdapter: 'tokensafe-ui-contracts',
      confidence: 'confirmed',
    },
  };

  registry.set(record.componentId, record);

  // Best-effort non-invasive attachment for runtime introspection
  try {
    if (component && typeof component === 'object') {
      (component as any).__oumv_contract__ = record;
    }
  } catch {
    /* frozen components are still registered by id */
  }

  // Forward to live browser React OUMV bridge if active
  try {
    const bridge = (globalThis as any).__OUMV_REACT__;
    if (bridge && typeof bridge.registerContract === 'function') {
      bridge.registerContract(record);
    }
  } catch {
    /* ignore non-browser environments */
  }

  return component;
}

/** Returns a registered contract for a component or component id. */
export function getOUMVComponentContract(component: any): OumvContractRecord | undefined {
  const key = componentKey(component);
  return (
    registry.get(key) ||
    (component && typeof component === 'object' ? (component as any).__oumv_contract__ : undefined)
  );
}

/** Returns all declared component contracts (contract provenance). */
export function listOUMVComponentContracts(): OumvContractRecord[] {
  return Array.from(registry.values());
}

/** Clears the registry (test isolation). */
export function resetOUMVComponentContracts(): void {
  registry.clear();
}

/**
 * One L4 trace entry as it appears on the streaming transports (spec §2.3/§2.4):
 * `id:` of SSE `trace` events is `seq`, and WS pushes it as
 * `notifications/oumv.trace` params.trace.
 */
export interface OumvStreamTrace {
  /** Monotonic per-runtime sequence (SSE `Last-Event-ID`). */
  seq: number;
  /** HTTP method for backend traces, RPC method or browser action for frontend ones. */
  method: string;
  path: string;
  route: string;
  handler: string;
  statusCode: number;
  durationMs: number;
  /** RFC3339 timestamp. */
  timestamp: string;
}
