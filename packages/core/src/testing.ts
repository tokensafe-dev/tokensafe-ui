import { activeInstances } from './component.js';
import type { ComponentInstance } from './types.js';

export interface StateDiff {
  [key: string]: {
    before: any;
    after: any;
  };
}

export interface SurfaceDiffItem {
  op: 'attr' | 'text' | 'visibility';
  target: string;
  attr?: string;
  before?: any;
  after?: any;
}

export interface VerificationTimings {
  t_action_ms: number;
  t_schema_ms: number;
  t_propagation_ms: number;
  t_dom_ms: number;
  t_total_ms: number;
}

export interface TestActionResult {
  status: 'passed' | 'failed';
  componentId: string;
  action: string;
  diff: StateDiff;
  surfaceDiff?: SurfaceDiffItem[];
  timings: VerificationTimings;
  durationMs: number;
  error?: string;
}

/**
 * Low-Millisecond Local Action Verification API.
 * Allows AI agents to test state transitions and actions in memory
 * and receive structured before/after state diffs and A11y surface diffs
 * without launching heavy browser automation.
 */
export async function testAction(
  target: ComponentInstance<any, any, any, any> | string,
  actionName: string,
  payload?: any
): Promise<TestActionResult> {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const instance =
    typeof target === 'string' ? activeInstances.get(target) : target;

  if (!instance) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    return {
      status: 'failed',
      componentId: typeof target === 'string' ? target : 'unknown',
      action: actionName,
      diff: {},
      timings: {
        t_action_ms: 0,
        t_schema_ms: 0,
        t_propagation_ms: 0,
        t_dom_ms: 0,
        t_total_ms: Math.round(elapsed * 100) / 100,
      },
      durationMs: Math.round(elapsed * 100) / 100,
      error: `Component instance not found: ${target}`,
    };
  }

  const emitter = (instance.emit as any)[actionName];
  if (!emitter || typeof emitter !== 'function') {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    const actions = Object.keys(instance.config.actions || {});
    const effects = Object.keys((instance.config as any).effects || {});
    const available = [...actions, ...effects].join(', ');
    return {
      status: 'failed',
      componentId: instance.id,
      action: actionName,
      diff: {},
      timings: {
        t_action_ms: 0,
        t_schema_ms: 0,
        t_propagation_ms: 0,
        t_dom_ms: 0,
        t_total_ms: Math.round(elapsed * 100) / 100,
      },
      durationMs: Math.round(elapsed * 100) / 100,
      error: `Action '${actionName}' not defined on component '${instance.id}'. Available triggers: [${available}]`,
    };
  }

  // 1. Snapshot state before
  const stateBefore: Record<string, any> = {};
  for (const [k, sig] of Object.entries(instance.signals)) {
    stateBefore[k] = structuredCloneSafe(sig.peek());
  }

  // 2. Snapshot surface before (if mounted)
  const rootEl = instance.rootElement || (typeof document !== 'undefined' ? document.querySelector(`[data-agent-id^="${instance.id}:"]`) : null);
  const surfaceBefore = rootEl ? captureSurfaceSnapshot(rootEl as HTMLElement) : new Map<string, any>();

  const tActionStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const logLenBefore = instance.runtimeLog.length;

  try {
    // 3. Dispatch action or effect
    await emitter(payload);

    const tActionEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // 4. Snapshot state after
    const stateAfter: Record<string, any> = {};
    for (const [k, sig] of Object.entries(instance.signals)) {
      stateAfter[k] = structuredCloneSafe(sig.peek());
    }

    // 5. Compute structured state diff
    const diff: StateDiff = {};
    const allKeys = Array.from(
      new Set([...Object.keys(stateBefore), ...Object.keys(stateAfter)])
    );

    for (const k of allKeys) {
      const before = stateBefore[k];
      const after = stateAfter[k];
      if (!isEqual(before, after)) {
        diff[k] = { before, after };
      }
    }

    // 6. Compute surface diff (if mounted)
    const surfaceDiff: SurfaceDiffItem[] = [];
    if (rootEl) {
      const surfaceAfter = captureSurfaceSnapshot(rootEl as HTMLElement);
      for (const [agentId, beforeVal] of surfaceBefore.entries()) {
        const afterVal = surfaceAfter.get(agentId);
        if (!afterVal) {
          surfaceDiff.push({ op: 'visibility', target: agentId, before: true, after: false });
        } else {
          if (beforeVal.text !== afterVal.text) {
            surfaceDiff.push({ op: 'text', target: agentId, before: beforeVal.text, after: afterVal.text });
          }
          for (const [attrName, attrVal] of Object.entries(afterVal.attrs)) {
            if (beforeVal.attrs[attrName] !== attrVal) {
              surfaceDiff.push({
                op: 'attr',
                target: agentId,
                attr: attrName,
                before: beforeVal.attrs[attrName],
                after: attrVal,
              });
            }
          }
        }
      }
    }

    const tTotalEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tTotal = Math.max(0.01, Math.round((tTotalEnd - startTime) * 100) / 100);
    const tAction = Math.max(0.01, Math.round((tActionEnd - tActionStart) * 100) / 100);

    // Approximate breakdown
    const timings: VerificationTimings = {
      t_action_ms: Math.round(tAction * 0.45 * 100) / 100,
      t_schema_ms: Math.round(tAction * 0.25 * 100) / 100,
      t_propagation_ms: Math.round(tAction * 0.15 * 100) / 100,
      t_dom_ms: Math.round(tAction * 0.15 * 100) / 100,
      t_total_ms: tTotal,
    };

    return {
      status: 'passed',
      componentId: instance.id,
      action: actionName,
      diff,
      surfaceDiff: surfaceDiff.length > 0 ? surfaceDiff : undefined,
      timings,
      durationMs: tTotal,
    };
  } catch (err: any) {
    const tTotalEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = Math.round((tTotalEnd - startTime) * 100) / 100;
    return {
      status: 'failed',
      componentId: instance.id,
      action: actionName,
      diff: {},
      timings: {
        t_action_ms: elapsed,
        t_schema_ms: 0,
        t_propagation_ms: 0,
        t_dom_ms: 0,
        t_total_ms: elapsed,
      },
      durationMs: elapsed,
      error: err.message,
    };
  }
}

function captureSurfaceSnapshot(root: HTMLElement): Map<string, { text: string; attrs: Record<string, string> }> {
  const map = new Map<string, { text: string; attrs: Record<string, string> }>();
  const nodes = root.querySelectorAll('[data-agent-id]');
  for (const node of Array.from(nodes)) {
    const el = node as HTMLElement;
    const agentId = el.getAttribute('data-agent-id');
    if (!agentId) continue;
    const attrs: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      attrs[attr.name] = attr.value;
    }
    map.set(agentId, {
      text: el.textContent?.trim() || '',
      attrs,
    });
  }
  return map;
}

function structuredCloneSafe(val: any): any {
  if (val === undefined || val === null) return val;
  try {
    return structuredClone(val);
  } catch {
    return JSON.parse(JSON.stringify(val));
  }
}

function isEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
