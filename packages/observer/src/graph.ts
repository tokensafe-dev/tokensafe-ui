import { activeInstances } from '@agent-dom/core';

export interface ReactiveEdge {
  source: string; // e.g. "auth.user"
  target: string; // e.g. "header"
  kind: 'signal_subscription' | 'vnode_child' | 'action_dispatch';
}

export interface ComponentNode {
  id: string;
  stateKeys: string[];
  actions: string[];
  effects: string[];
  dependencies: string[]; // components this component depends on or renders
  dependents: string[];   // components that depend on this component
  signals: Record<
    string,
    {
      value: any;
      subscribers: { id: string; name?: string; kind: string }[];
    }
  >;
  reactiveEdges?: ReactiveEdge[];
}

export interface ImpactAnalysis {
  target: string;
  directlyAffected: string[];
  indirectlyAffected: string[];
  safeComponents: string[];
  blastRadiusDepth?: number;
  propagationPaths?: string[];
  recommendation: string;
}

export interface StateCausality {
  target: string;
  componentId: string;
  stateKey: string;
  value: any;
  subscribers: { id: string; name?: string; kind: string }[];
  lastMutation?: {
    actionName?: string;
    timestamp?: number;
    oldValue?: any;
    newValue?: any;
  };
  explanation: string;
}

export interface DependencyGraph {
  components: Record<string, ComponentNode>;
  analyzeImpact(targetIdOrStateKey: string): ImpactAnalysis;
  traceCausality(targetIdOrStateKey: string): StateCausality | null;
  toYaml(): string;
}

/**
 * Builds a dynamic Component & Signal Dependency Graph from active components
 * to enable instant impact analysis and runtime causality telemetry.
 */
export function buildDependencyGraph(): DependencyGraph {
  const components: Record<string, ComponentNode> = {};

  // 1. Build component nodes with dynamic signal subscribers & effects
  for (const [id, instance] of activeInstances.entries()) {
    const stateKeys = Object.keys(instance.signals || {});
    const actions = Object.keys(instance.config.actions || {});
    const effects = Object.keys((instance.config as any).effects || {});

    const signalMap: Record<
      string,
      { value: any; subscribers: { id: string; name?: string; kind: string }[] }
    > = {};

    for (const [key, sig] of Object.entries(instance.signals || {})) {
      const subs = Array.from((sig as any).getSubscribers?.() || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
      }));
      signalMap[key] = {
        value: (sig as any).peek?.(),
        subscribers: subs,
      };
    }

    components[id] = {
      id,
      stateKeys,
      actions,
      effects,
      dependencies: [],
      dependents: [],
      signals: signalMap,
    };
  }

  // 2. Discover parent-child connections through vnode traversal
  for (const [id, instance] of activeInstances.entries()) {
    const childComponentIds = new Set<string>();
    findChildComponents(instance.vnode, childComponentIds);

    for (const childId of childComponentIds) {
      if (childId !== id && components[childId]) {
        if (!components[id].dependencies.includes(childId)) {
          components[id].dependencies.push(childId);
        }
        if (!components[childId].dependents.includes(id)) {
          components[childId].dependents.push(id);
        }
      }
    }
  }

  // 3. Discover dynamic cross-component signal subscriptions
  for (const [id, comp] of Object.entries(components)) {
    for (const [stateKey, sigData] of Object.entries(comp.signals)) {
      for (const sub of sigData.subscribers) {
        for (const otherId of Object.keys(components)) {
          if (
            otherId !== id &&
            (sub.name?.startsWith(`${otherId}:`) || sub.id?.startsWith(`${otherId}:`))
          ) {
            if (!components[otherId].dependencies.includes(id)) {
              components[otherId].dependencies.push(id);
            }
            if (!components[id].dependents.includes(otherId)) {
              components[id].dependents.push(otherId);
            }
          }
        }
      }
    }
  }

  return {
    components,

    analyzeImpact(target: string): ImpactAnalysis {
      const directlyAffected = new Set<string>();
      const indirectlyAffected = new Set<string>();
      const paths: string[] = [];

      let seedComponents: string[] = [];
      let sourceLabel = target;

      if (components[target]) {
        seedComponents = [target];
        directlyAffected.add(target);
      } else {
        let targetComp = '';
        let targetKey = target;
        if (target.includes('.')) {
          const parts = target.split('.');
          targetComp = parts[0];
          targetKey = parts.slice(1).join('.');
        }

        for (const [id, comp] of Object.entries(components)) {
          if ((!targetComp || targetComp === id) && comp.stateKeys.includes(targetKey)) {
            seedComponents.push(id);
            directlyAffected.add(id);
            sourceLabel = `${id}.${targetKey}`;
          }
        }
      }

      for (const seed of seedComponents) {
        for (const dep of components[seed]?.dependents || []) {
          directlyAffected.add(dep);
          paths.push(`${sourceLabel} -> ${dep}`);

          const queue: Array<{ node: string; path: string[]; depth: number }> = [
            { node: dep, path: [sourceLabel, dep], depth: 1 },
          ];
          const visited = new Set<string>([seed, dep]);

          while (queue.length > 0) {
            const current = queue.shift()!;
            for (const nextDep of components[current.node]?.dependents || []) {
              if (!visited.has(nextDep)) {
                visited.add(nextDep);
                indirectlyAffected.add(nextDep);
                const nextPath = [...current.path, nextDep];
                paths.push(nextPath.join(' -> '));
                queue.push({ node: nextDep, path: nextPath, depth: current.depth + 1 });
              }
            }
          }
        }
      }

      const allAffected = new Set([...directlyAffected, ...indirectlyAffected]);
      const safeComponents = Object.keys(components).filter((id) => !allAffected.has(id));

      const directList = Array.from(directlyAffected);
      const indirectList = Array.from(indirectlyAffected);
      const blastDepth = paths.reduce((max, p) => Math.max(max, p.split(' -> ').length), 1);

      let recommendation = `Target '${target}' is not bound to any active components. Safe to introduce or edit.`;
      if (directList.length > 0) {
        recommendation = `Editing '${target}' directly impacts: [${directList.join(', ')}]`;
        if (indirectList.length > 0) {
          recommendation += ` and cascades to: [${indirectList.join(', ')}] (blast depth: ${blastDepth}). Verify contracts before commit.`;
        } else {
          recommendation += `. Verify contract before commit.`;
        }
      }

      return {
        target,
        directlyAffected: directList,
        indirectlyAffected: indirectList,
        safeComponents,
        blastRadiusDepth: blastDepth,
        propagationPaths: paths,
        recommendation,
      };
    },

    traceCausality(target: string): StateCausality | null {
      // Parses "componentId.stateKey" or "stateKey"
      let compId = '';
      let stateKey = '';

      if (target.includes('.')) {
        const parts = target.split('.');
        compId = parts[0];
        stateKey = parts.slice(1).join('.');
      } else {
        // Search across active components for the state key
        for (const [id, comp] of Object.entries(components)) {
          if (comp.stateKeys.includes(target)) {
            compId = id;
            stateKey = target;
            break;
          }
        }
      }

      if (!compId || !components[compId]) {
        return null;
      }

      const instance = activeInstances.get(compId);
      const node = components[compId];
      const sigData = node.signals[stateKey];

      if (!instance || !sigData) {
        return null;
      }

      // Find last mutation in runtime telemetry log
      const lastMutation = [...instance.runtimeLog]
        .reverse()
        .find((e) => e.type === 'signal_mutation' && e.signalKey === stateKey);

      const subSummary = sigData.subscribers.map((s) => s.name || s.id).join(', ');
      const mutationDesc = lastMutation
        ? `Last mutated by action '${lastMutation.actionName}' (${JSON.stringify(lastMutation.oldValue)} -> ${JSON.stringify(lastMutation.newValue)}).`
        : 'Initial default value (unmodified since mount).';

      const explanation = `State '${compId}.${stateKey}' = ${JSON.stringify(sigData.value)}. ${mutationDesc} Active subscribers: [${subSummary || 'none'}].`;

      return {
        target,
        componentId: compId,
        stateKey,
        value: sigData.value,
        subscribers: sigData.subscribers,
        lastMutation,
        explanation,
      };
    },

    toYaml(): string {
      const lines: string[] = ['dependency_graph:'];
      for (const [id, node] of Object.entries(components)) {
        lines.push(`  - component: ${id}`);
        lines.push(`    state: [${node.stateKeys.join(', ')}]`);
        lines.push(`    actions: [${node.actions.join(', ')}]`);
        if (node.effects.length > 0) {
          lines.push(`    effects: [${node.effects.join(', ')}]`);
        }
        if (node.dependencies.length > 0) {
          lines.push(`    dependencies: [${node.dependencies.join(', ')}]`);
        }
        if (node.dependents.length > 0) {
          lines.push(`    dependents: [${node.dependents.join(', ')}]`);
        }
        if (Object.keys(node.signals).length > 0) {
          lines.push(`    signals:`);
          for (const [k, s] of Object.entries(node.signals)) {
            const subs = s.subscribers.map((sub) => sub.name || sub.id).join(', ');
            lines.push(`      ${k}: { value: ${JSON.stringify(s.value)}, subscribers: [${subs}] }`);
          }
        }
      }
      return lines.join('\n');
    },
  };
}

function findChildComponents(node: any, set: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  const agentId = node.agentId || node.props?.['data-agent-id'];
  if (agentId) {
    const compId = agentId.split(':')[0];
    if (compId) set.add(compId);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      findChildComponents(child, set);
    }
  }
}
