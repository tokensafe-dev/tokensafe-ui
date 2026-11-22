import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
import { activeInstances, testAction } from '@agent-dom/core';
import {
  getSemanticSnapshot,
  observe,
  buildDependencyGraph,
} from '@agent-dom/observer';
import { validateWorkspacePath, checkSecretLeak } from '@agent-dom/mcp';

export interface OumvAdapterConfig {
  projectRoot?: string;
}

/**
 * Creates a native OUMV Protocol Adapter for agent-dom.
 * Complies with the standardized @oumv/protocol contract.
 */
export function createAgentDomAdapter(config: OumvAdapterConfig = {}) {
  const projectRoot = config.projectRoot || process.cwd();

  return {
    name: 'agent-dom',
    version: '0.3.0',

    async handshake(params?: any) {
      return {
        protocolVersion: '1.0.0',
        runtimeInfo: {
          name: 'agent-dom',
          version: '0.3.0',
        },
        capabilities: {
          observe: {
            levels: ['L0' as const, 'L1' as const, 'L2' as const, 'L3' as const, 'L4' as const],
            formats: ['yaml' as const, 'json' as const, 'sexp' as const],
          },
          understand: {
            causality: true,
            signalsGraph: true,
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
    }) {
      const format = params.format || 'yaml';
      let payload = '';

      const rootEl =
        typeof document !== 'undefined'
          ? document.getElementById('app') || document.body || document.createElement('div')
          : null;

      if (rootEl) {
        const obs = observe(rootEl, {
          level: params.level,
          format,
          componentId: params.componentId,
        });
        payload = typeof obs === 'string' ? obs : JSON.stringify(obs, null, 2);
      } else {
        payload = `level: ${params.level}\nstatus: detached\n`;
      }

      return {
        level: params.level,
        format,
        payload,
        tokenEstimate: Math.ceil(payload.length / 4),
        timestamp: Date.now(),
      };
    },

    async understand(params: {
      query: 'impact' | 'dependencies' | 'causality' | 'why_state' | 'signals';
      target?: string;
    }) {
      const graph = buildDependencyGraph();

      if (params.query === 'impact') {
        return graph.analyzeImpact(params.target || '');
      }

      if (params.query === 'causality' || params.query === 'why_state') {
        const res = graph.traceCausality(params.target || '');
        if (!res) {
          throw new Error(`No active causality trace found for '${params.target}'`);
        }
        return res;
      }

      return { yaml: graph.toYaml() };
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
      if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${resolved}`);
      }

      const currentContent = fs.readFileSync(resolved, 'utf-8');
      const currentVersion =
        'sha256:' +
        crypto.createHash('sha256').update(currentContent).digest('hex');

      if (params.expectedVersion && currentVersion !== params.expectedVersion) {
        throw new Error(
          `CONFLICT_DETECTED: File modified concurrently. Expected '${params.expectedVersion}', got '${currentVersion}'`
        );
      }

      // Pre-flight AST syntax check
      try {
        parser.parse(params.source, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });
      } catch (err: any) {
        throw new Error(`SYNTAX_ERROR: ${err.message}`);
      }

      // Security check
      const leak = checkSecretLeak(params.source);
      if (leak.hasLeak) {
        throw new Error(`SECURITY_VIOLATION: ${leak.reason}`);
      }

      fs.writeFileSync(resolved, params.source, 'utf-8');
      const newVersion =
        'sha256:' + crypto.createHash('sha256').update(params.source).digest('hex');

      return {
        success: true,
        filePath: path.relative(projectRoot, resolved),
        version: newVersion,
        message: 'Successfully applied OCC source edit',
      };
    },

    async verify(params: { componentId: string; action: string; payload?: any }) {
      return testAction(params.componentId, params.action, params.payload);
    },
  };
}
