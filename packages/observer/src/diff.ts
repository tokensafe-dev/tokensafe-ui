import { activeInstances } from '@tokensafe-ui/core';

export interface ObservationDiffOptions {
  componentId?: string;
  sinceVersion?: string;
  sinceSnapshot?: any;
  format?: 'yaml' | 'json';
}

export interface DeltaStateChange {
  added?: Record<string, any>;
  removed?: string[];
  updated?: Record<string, { before: any; after: any }>;
}

export interface DeltaSurfaceChange {
  addedElements?: Array<{ id: string; role?: string; text?: string; action?: string }>;
  removedElements?: string[];
  updatedElements?: Array<{ id: string; changes: Record<string, any> }>;
}

export interface ObservationDiffResult {
  status: 'changed' | 'unchanged';
  componentId: string;
  version?: string;
  stateDelta?: DeltaStateChange;
  surfaceDelta?: DeltaSurfaceChange;
  activeAlerts?: string[];
}

// In-memory snapshot cache for delta streaming across turns
const snapshotCache = new Map<string, { state: Record<string, any>; surface: Map<string, any> }>();

/**
 * Delta-Streaming Observer:
 * Compares the current live UI and component state against the prior snapshot or version,
 * generating a minimal delta representation (typically 25–40 tokens) instead of a full tree.
 */
export function observeDiff(
  root: HTMLElement,
  options: ObservationDiffOptions = {}
): string | ObservationDiffResult {
  const targetId = options.componentId || (root as any)?.__tokensafe_instance__?.id || 'root';
  const instance = activeInstances.get(targetId) || (root as any)?.__tokensafe_instance__;

  // Extract current state
  const currentState: Record<string, any> = {};
  if (instance && instance.signals) {
    for (const [k, sig] of Object.entries(instance.signals)) {
      currentState[k] = (sig as any).peek();
    }
  }

  // Extract current actionable surface
  const currentSurface = new Map<string, { id: string; role?: string; text?: string; action?: string }>();
  const activeAlerts: string[] = [];

  if (root && root.querySelectorAll) {
    const actionableElements = root.querySelectorAll<HTMLElement>(
      '[data-agent-id], [role="alert"], button, input, select, textarea'
    );
    actionableElements.forEach((el) => {
      const id = el.getAttribute('data-agent-id') || el.id || el.tagName.toLowerCase();
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const action = el.getAttribute('data-agent-action');
      const text = el.textContent?.trim().slice(0, 30);

      if (role === 'alert' || el.classList.contains('error-banner')) {
        activeAlerts.push(text || 'Alert');
      }

      currentSurface.set(id, {
        id,
        role,
        text,
        action: action || undefined,
      });
    });
  }

  // Get previous snapshot
  const prevSnapshot = options.sinceSnapshot || snapshotCache.get(targetId);

  // Compute State Delta
  const stateDelta: DeltaStateChange = {};
  if (prevSnapshot) {
    const prevState = prevSnapshot.state || {};
    const updated: Record<string, { before: any; after: any }> = {};
    const added: Record<string, any> = {};

    for (const [k, val] of Object.entries(currentState)) {
      if (!(k in prevState)) {
        added[k] = val;
      } else if (JSON.stringify(val) !== JSON.stringify(prevState[k])) {
        updated[k] = { before: prevState[k], after: val };
      }
    }

    const removed = Object.keys(prevState).filter((k) => !(k in currentState));

    if (Object.keys(updated).length > 0) stateDelta.updated = updated;
    if (Object.keys(added).length > 0) stateDelta.added = added;
    if (removed.length > 0) stateDelta.removed = removed;
  } else {
    stateDelta.added = { ...currentState };
  }

  // Compute Surface Delta
  const surfaceDelta: DeltaSurfaceChange = {};
  if (prevSnapshot && prevSnapshot.surface) {
    const prevMap = prevSnapshot.surface instanceof Map ? prevSnapshot.surface : new Map(Object.entries(prevSnapshot.surface));
    const addedElements: any[] = [];
    const removedElements: string[] = [];

    for (const [id, el] of currentSurface.entries()) {
      if (!prevMap.has(id)) {
        addedElements.push(el);
      }
    }
    for (const id of prevMap.keys()) {
      if (!currentSurface.has(id)) {
        removedElements.push(id);
      }
    }

    if (addedElements.length > 0) surfaceDelta.addedElements = addedElements;
    if (removedElements.length > 0) surfaceDelta.removedElements = removedElements;
  }

  // Update Cache
  snapshotCache.set(targetId, {
    state: JSON.parse(JSON.stringify(currentState)),
    surface: new Map(currentSurface),
  });

  const hasChanges =
    Boolean(stateDelta.updated || stateDelta.added || stateDelta.removed) ||
    Boolean(surfaceDelta.addedElements || surfaceDelta.removedElements) ||
    !prevSnapshot;

  const result: ObservationDiffResult = {
    status: hasChanges ? 'changed' : 'unchanged',
    componentId: targetId,
    version: instance?.versionToken,
    stateDelta: hasChanges ? stateDelta : undefined,
    surfaceDelta: hasChanges ? surfaceDelta : undefined,
    activeAlerts: activeAlerts.length > 0 ? activeAlerts : undefined,
  };

  if (options.format === 'json') {
    return result;
  }

  // Default compact YAML formatting (<40 tokens)
  if (!hasChanges) {
    return `diff: { component: "${targetId}", status: "unchanged" }`;
  }

  const lines: string[] = [`diff:`, `  component: ${targetId}`];
  if (activeAlerts.length > 0) {
    lines.push(`  alerts: [${activeAlerts.map((a) => `"${a}"`).join(', ')}]`);
  }
  if (stateDelta.updated) {
    lines.push(`  state:`);
    for (const [k, change] of Object.entries(stateDelta.updated)) {
      lines.push(`    ~ ${k}: ${JSON.stringify(change.after)} (was ${JSON.stringify(change.before)})`);
    }
  }
  if (stateDelta.added) {
    for (const [k, val] of Object.entries(stateDelta.added)) {
      lines.push(`    + ${k}: ${JSON.stringify(val)}`);
    }
  }
  if (surfaceDelta.addedElements) {
    lines.push(`  surface:`);
    for (const el of surfaceDelta.addedElements) {
      lines.push(`    + ${el.id}${el.action ? ` [action: ${el.action}]` : ''}`);
    }
  }
  if (surfaceDelta.removedElements) {
    for (const id of surfaceDelta.removedElements) {
      lines.push(`    - ${id}`);
    }
  }

  return lines.join('\n');
}
