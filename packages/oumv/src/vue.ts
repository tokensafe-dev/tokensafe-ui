import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
import { validateWorkspacePath, atomicApplySourceEdit } from '@tokensafe-ui/mcp';

export interface VueComponentDefinition {
  id: string;
  name?: string;
  filePath?: string;
  props?: Record<string, any>;
  getState?: () => Record<string, any>;
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
  dependencies?: string[];
  dependents?: string[];
}

export interface VueAdapterConfig {
  projectRoot?: string;
  rootElement?: HTMLElement;
  components?: Record<string, VueComponentDefinition>;
}

export interface VueTraceEvent {
  timestamp: number;
  type: string;
  componentId: string;
  details: string;
  diff?: Record<string, any>;
}

/**
 * Validates Vue Single File Component (SFC) structure and scripts.
 */
function validateVueSFC(source: string): void {
  const hasTemplate = /<template[\s>]/i.test(source);
  const hasScript = /<script[\s>]/i.test(source);

  if (!hasTemplate && !hasScript) {
    throw new Error('[OUMV SYNTAX_ERROR] Invalid Vue SFC: missing <template> or <script> block');
  }

  // Extract script block content for AST validation
  const scriptMatch = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch && scriptMatch[1].trim()) {
    try {
      parser.parse(scriptMatch[1], {
        sourceType: 'module',
        plugins: ['typescript'],
      });
    } catch (err: any) {
      throw new Error(`[OUMV SYNTAX_ERROR] Invalid script in Vue SFC: ${err.message}`);
    }
  }
}

/**
 * Creates an official OUMV Protocol Adapter for Vue 3 runtimes.
 * Conforms to the @oumv/protocol specification.
 */
export function createVueAdapter(config: VueAdapterConfig = {}) {
  const projectRoot = config.projectRoot || process.cwd();
  const componentRegistry = new Map<string, VueComponentDefinition>();
  const traceEvents: VueTraceEvent[] = [];

  if (config.components) {
    for (const [id, comp] of Object.entries(config.components)) {
      componentRegistry.set(id, comp);
    }
  }

  const getRoot = (): HTMLElement | null => {
    if (config.rootElement) return config.rootElement;
    if (typeof document !== 'undefined') {
      return document.getElementById('app') || document.body;
    }
    return null;
  };

  const registerComponent = (comp: VueComponentDefinition) => {
    componentRegistry.set(comp.id, comp);
  };

  return {
    name: 'vue',
    version: '3.x',
    registerComponent,

    async handshake(params?: any) {
      return {
        protocolVersion: '1.0.0',
        runtimeInfo: {
          name: 'vue',
          version: '3.x',
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
          framework: 'vue',
          route,
          mounted: mountedCompIds,
          elements: root ? root.querySelectorAll('*').length : 0,
          errors: 0,
        };

        const payload =
          format === 'json'
            ? JSON.stringify(pulse, null, 2)
            : `level: L0\nframework: vue\nroute: ${route}\nmounted: [${mountedCompIds.join(', ')}]\nelements: ${pulse.elements}\nerrors: 0\n`;

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
            'button, input, select, textarea, a[href], [role="button"], [data-agent-id], [data-testid], [v-model]'
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
              (el.getAttribute('@click') ? 'click' : undefined);

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
          view: params.componentId || 'vue-root',
          framework: 'vue',
          elements,
        };

        let payload = '';
        if (format === 'json') {
          payload = JSON.stringify(surfaceData, null, 2);
        } else {
          payload = `view: ${surfaceData.view}\nframework: vue\nelements:\n` +
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
        const relPath = comp?.filePath || `${compId}.vue`;
        const resolved = validateWorkspacePath(relPath, projectRoot);

        let source = '';
        if (fs.existsSync(resolved)) {
          source = fs.readFileSync(resolved, 'utf-8');
        } else {
          source = `<template>\n  <div>${compId}</div>\n</template>\n<script setup lang="ts">\n// ${compId}\n</script>\n`;
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
            ? `State in Vue component '${targetId}' was modified by action '${lastTrace.type}'.`
            : `State in Vue component '${targetId}' holds default initial values.`,
          lastTrace,
        };
      }

      // 'dependencies'
      const lines: string[] = ['vue_dependency_graph:'];
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

      // Validate Vue SFC syntax
      validateVueSFC(params.source);

      const res = atomicApplySourceEdit(resolved, params.source, {
        expectedVersion: params.expectedVersion,
        validateTypeScript: false, // TS is already validated in script block
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
        throw new Error(`Component '${compId}' not found in Vue registry`);
      }

      const stateBefore = comp.getState ? JSON.parse(JSON.stringify(comp.getState())) : {};

      const actionFn = comp.actions ? comp.actions[params.action] : null;
      if (!actionFn) {
        throw new Error(`Action '${params.action}' not defined on Vue component '${compId}'`);
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

      const trace: VueTraceEvent = {
        timestamp: Date.now(),
        type: params.action,
        componentId: compId,
        details: `Action '${params.action}' executed on Vue component '${compId}'`,
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
