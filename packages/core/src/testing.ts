import { activeInstances } from './component.js';
import type { ComponentInstance } from './types.js';

export interface StateDiff {
  [key: string]: {
    before: any;
    after: any;
  };
}

export interface TestActionResult {
  status: 'passed' | 'failed';
  componentId: string;
  action: string;
  diff: StateDiff;
  durationMs: number;
  error?: string;
}

/**
 * 5ms Instant Action Verification API.
 * Allows AI agents to test state transitions and actions in memory
 * and receive structured before/after diffs without launching a browser.
 */
export async function testAction(
  target: ComponentInstance<any, any, any> | string,
  actionName: string,
  payload?: any
): Promise<TestActionResult> {
  const startTime = Date.now();

  const instance =
    typeof target === 'string' ? activeInstances.get(target) : target;

  if (!instance) {
    return {
      status: 'failed',
      componentId: typeof target === 'string' ? target : 'unknown',
      action: actionName,
      diff: {},
      durationMs: Date.now() - startTime,
      error: `Component instance not found: ${target}`,
    };
  }

  const emitter = instance.emit[actionName];
  if (!emitter || typeof emitter !== 'function') {
    return {
      status: 'failed',
      componentId: instance.id,
      action: actionName,
      diff: {},
      durationMs: Date.now() - startTime,
      error: `Action '${actionName}' not defined on component '${instance.id}'. Available actions: [${Object.keys(instance.config.actions).join(', ')}]`,
    };
  }

  // 1. Snapshot state before
  const stateBefore: Record<string, any> = {};
  for (const [k, sig] of Object.entries(instance.signals)) {
    stateBefore[k] = structuredCloneSafe(sig.peek());
  }

  try {
    // 2. Dispatch action
    await emitter(payload);

    // 3. Snapshot state after
    const stateAfter: Record<string, any> = {};
    for (const [k, sig] of Object.entries(instance.signals)) {
      stateAfter[k] = structuredCloneSafe(sig.peek());
    }

    // 4. Compute structured diff
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

    return {
      status: 'passed',
      componentId: instance.id,
      action: actionName,
      diff,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      status: 'failed',
      componentId: instance.id,
      action: actionName,
      diff: {},
      durationMs: Date.now() - startTime,
      error: err.message,
    };
  }
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
