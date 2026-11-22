import { activeInstances } from '@agent-dom/core';

export interface ComponentNode {
  id: string;
  stateKeys: string[];
  actions: string[];
  dependencies: string[]; // components this component depends on or renders
  dependents: string[];   // components that depend on this component
}

export interface ImpactAnalysis {
  target: string;
  directlyAffected: string[];
  indirectlyAffected: string[];
  safeComponents: string[];
  recommendation: string;
}

export interface DependencyGraph {
  components: Record<string, ComponentNode>;
  analyzeImpact(targetIdOrStateKey: string): ImpactAnalysis;
  toYaml(): string;
}

/**
 * Builds a Component Dependency Graph from active components
 * to enable instant agent impact analysis before making code edits.
 */
export function buildDependencyGraph(): DependencyGraph {
  const components: Record<string, ComponentNode> = {};

  // 1. Build initial component nodes
  for (const [id, instance] of activeInstances.entries()) {
    const stateKeys = Object.keys(instance.signals || {});
    const actions = Object.keys(instance.config.actions || {});

    components[id] = {
      id,
      stateKeys,
      actions,
      dependencies: [],
      dependents: [],
    };
  }

  // 2. Discover parent-child connections through vnode traversal
  for (const [id, instance] of activeInstances.entries()) {
    const childComponentIds = new Set<string>();
    findChildComponents(instance.vnode, childComponentIds);

    for (const childId of childComponentIds) {
      if (childId !== id && components[childId]) {
        components[id].dependencies.push(childId);
        if (!components[childId].dependents.includes(id)) {
          components[childId].dependents.push(id);
        }
      }
    }
  }

  return {
    components,

    analyzeImpact(target: string): ImpactAnalysis {
      const directlyAffected = new Set<string>();
      const indirectlyAffected = new Set<string>();

      // Check if target is a component ID
      if (components[target]) {
        directlyAffected.add(target);
        for (const dep of components[target].dependents) {
          directlyAffected.add(dep);
        }
      } else {
        // Target is a state key (e.g. "user" or "count")
        for (const [id, comp] of Object.entries(components)) {
          if (comp.stateKeys.includes(target)) {
            directlyAffected.add(id);
            for (const dep of comp.dependents) {
              indirectlyAffected.add(dep);
            }
          }
        }
      }

      const allAffected = new Set([...directlyAffected, ...indirectlyAffected]);
      const safeComponents = Object.keys(components).filter(
        (id) => !allAffected.has(id)
      );

      const affectedList = Array.from(directlyAffected);
      const indirectList = Array.from(indirectlyAffected);

      return {
        target,
        directlyAffected: affectedList,
        indirectlyAffected: indirectList,
        safeComponents,
        recommendation:
          affectedList.length === 0
            ? `Target '${target}' is not bound to any active components. Safe to introduce or edit.`
            : `Editing '${target}' directly impacts: [${affectedList.join(', ')}]. Verify contract before commit.`,
      };
    },

    toYaml(): string {
      const lines: string[] = ['dependency_graph:'];
      for (const [id, node] of Object.entries(components)) {
        lines.push(`  - component: ${id}`);
        lines.push(`    state: [${node.stateKeys.join(', ')}]`);
        lines.push(`    actions: [${node.actions.join(', ')}]`);
        if (node.dependencies.length > 0) {
          lines.push(`    dependencies: [${node.dependencies.join(', ')}]`);
        }
        if (node.dependents.length > 0) {
          lines.push(`    dependents: [${node.dependents.join(', ')}]`);
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
