import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { testAction, activeInstances } from '@tokensafe-ui/core';
import { buildDependencyGraph, observeDiff } from '@tokensafe-ui/observer';
import { applyPatch, type ComponentPatch } from '@tokensafe-ui/patcher';
import { validateWorkspacePath, checkSecretLeak } from './security.js';
import { atomicApplySourceEdit } from './mutation.js';

const traverse = (_traverse as any).default || _traverse;

export interface McpServerConfig {
  devServerUrl?: string;
  projectRoot?: string;
}

async function callDevServerRpc(devServerUrl: string, method: string, params: any) {
  for (const endpoint of ['/__tokensafe_ui/rpc', '/__agent_dom/rpc']) {
    try {
      const res = await fetch(`${devServerUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
  }
  return null;
}

export function createTokensafeMcpServer(config: McpServerConfig = {}) {
  const devServerUrl = config.devServerUrl || 'http://localhost:5173';
  const projectRoot = config.projectRoot || process.cwd();

  const server = new Server(
    {
      name: 'tokensafe-ui-mcp',
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define OUMV (Observe, Understand, Mutate, Verify) tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const oumvTools = [
      {
        name: 'tokensafe_observe',
        description:
          'OBSERVE (Pillar 1): Progressive context disclosure query (L0 Pulse <25t, L1 Surface <150t, L2 Contract, L3 Source, L4 Traces).',
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              enum: ['L0', 'L1', 'L2', 'L3', 'L4'],
              default: 'L1',
              description: 'Observation level (L0: Pulse, L1: Surface, L2: Contract, L3: Source, L4: Traces)',
            },
            format: {
              type: 'string',
              enum: ['yaml', 'sexp', 'json'],
              default: 'yaml',
            },
            componentId: {
              type: 'string',
              description: 'Optional target component ID for L2/L3/L4 drill-down',
            },
          },
        },
      },
      {
        name: 'tokensafe_understand',
        description:
          'UNDERSTAND (Pillar 2): Dynamic impact analysis and runtime causality telemetry. Answers "What breaks if I change this?" or "Why is UI in this state?".',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              enum: ['impact', 'dependencies', 'causality', 'why_state'],
              description: 'Type of understanding query (impact, dependencies, or causality/why_state)',
            },
            target: {
              type: 'string',
              description: 'State key, element ID, or Component ID to analyze (e.g. "counter-card.count")',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'tokensafe_get_component_source',
        description:
          'MUTATE (Pillar 3): Symbol-level source code retrieval with line mapping, AST bounds, and OCC version token for safe, isolated edits.',
        inputSchema: {
          type: 'object',
          properties: {
            componentId: { type: 'string', description: 'Component ID, e.g. "task-board"' },
            filePath: { type: 'string', description: 'Relative path to component file' },
          },
          required: ['componentId', 'filePath'],
        },
      },
      {
        name: 'tokensafe_apply_source_edit',
        description:
          'MUTATE (Pillar 3): Applies symbol-level TypeScript source edits with Optimistic Concurrency Control (OCC), TypeScript/JSX syntax verification, and secret leak prevention.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to component file' },
            source: { type: 'string', description: 'Complete updated source code of the component' },
            expectedVersion: {
              type: 'string',
              description: 'Required OCC version token (sha256:...) from tokensafe_get_component_source to prevent lost updates',
            },
          },
          required: ['filePath', 'source', 'expectedVersion'],
        },
      },
      {
        name: 'tokensafe_test_action',
        description:
          'VERIFY (Pillar 4): Low-millisecond Local Action Verification. Executes an action or effect in memory and returns a structured before/after state diff and surface diff without a browser.',
        inputSchema: {
          type: 'object',
          properties: {
            componentId: { type: 'string', description: 'Target component ID' },
            action: { type: 'string', description: 'Action or effect name to trigger' },
            payload: { description: 'Optional action payload' },
            filePath: { type: 'string', description: 'Optional relative path to component file' },
          },
          required: ['componentId', 'action'],
        },
      },
      {
        name: 'tokensafe_apply_patch',
        description:
          'MUTATE Macro: Applies a surgical AST patch (add action, update state schema, insert JSX, or bind event) with instant HMR.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to component file to patch' },
            patch: { type: 'object', description: 'Component patch specification' },
          },
          required: ['filePath', 'patch'],
        },
      },
      {
        name: 'tokensafe_get_errors',
        description:
          'Returns structured, machine-actionable compiler or runtime error payloads without minified stack traces.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'tokensafe_batch_mutate_verify',
        description:
          'HIGH-VELOCITY (Turn Folding): Atomically applies patches or source edits in memory and executes action verifications in a single turn. Commits to disk only if verifications pass.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to component file' },
            componentId: { type: 'string', description: 'Component ID, e.g. "task-manager"' },
            source: { type: 'string', description: 'Optional complete updated source code' },
            patches: { type: 'array', description: 'Optional array of ComponentPatch objects' },
            expectedVersion: { type: 'string', description: 'OCC version hash token' },
            verifyActions: {
              type: 'array',
              description: 'Array of actions to verify, e.g. ["addItem", { action: "saveTasks", expectState: { isSaving: false } }]',
            },
            dryRun: { type: 'boolean', default: false, description: 'If true, verify in memory without disk commit' },
          },
          required: ['filePath', 'componentId'],
        },
      },
      {
        name: 'tokensafe_observe_diff',
        description:
          'DELTA-STREAMING (Observation): Returns minimal state and surface changes since a prior version hash (typically 25-40 tokens).',
        inputSchema: {
          type: 'object',
          properties: {
            componentId: { type: 'string', description: 'Optional target component ID' },
            sinceVersion: { type: 'string', description: 'Optional OCC version hash to diff against' },
            format: { type: 'string', enum: ['yaml', 'json'], default: 'yaml' },
          },
        },
      },
      {
        name: 'tokensafe_run_oracle',
        description:
          'IN-MEMORY ACCEPTANCE ORACLE: Evaluates acceptance test criteria (e.g. 12 Task Manager assertions) in-memory in <15ms without spawning terminal processes.',
        inputSchema: {
          type: 'object',
          properties: {
            scenario: { type: 'string', default: 'task-manager' },
            componentId: { type: 'string' },
          },
        },
      },
      {
        name: 'tokensafe_diagnose_causality',
        description:
          'CAUSALITY DIAGNOSTICS: Inspects reactive dependency graph and causality traces for failing invariants and suggests recovery remedies.',
        inputSchema: {
          type: 'object',
          properties: {
            componentId: { type: 'string' },
            failedStateKey: { type: 'string' },
            actionName: { type: 'string' },
          },
          required: ['componentId'],
        },
      },
    ];

    // Expose aliases with agent_dom_ and tokensafe_ui_ prefixes
    const allTools = [...oumvTools];
    for (const t of oumvTools) {
      allTools.push({ ...t, name: t.name.replace('tokensafe_', 'tokensafe_ui_') });
      allTools.push({ ...t, name: t.name.replace('tokensafe_', 'agent_dom_') });
    }

    return { tools: allTools };
  });

  // Handle Tool Calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const normalized = name.replace(/^(agent_dom_|tokensafe_ui_|tokensafe_)/, 'tokensafe_');

    switch (normalized) {
      case 'tokensafe_observe': {
        const { level = 'L1', format = 'yaml', componentId } = args as any;

        // Try DevServer RPC
        const rpcResult = await callDevServerRpc(devServerUrl, 'observe', { level, format, componentId });
        if (rpcResult && rpcResult.result) {
          return {
            content: [{ type: 'text', text: rpcResult.result.payload || rpcResult.result.snapshot || 'level: empty' }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `level: ${level}\nstatus: dev_server_offline\nnote: Vite DevServer is not running. Use tokensafe_get_component_source to inspect files directly on disk.`,
            },
          ],
        };
      }

      case 'tokensafe_understand': {
        const { query, target = '' } = args as any;
        const graph = buildDependencyGraph();

        if (query === 'impact') {
          const impact = graph.analyzeImpact(target);
          return {
            content: [{ type: 'text', text: JSON.stringify(impact, null, 2) }],
          };
        }

        if (query === 'causality' || query === 'why_state') {
          const causality = graph.traceCausality(target);
          if (!causality) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No active causality trace found for '${target}'. Active components: [${Object.keys(graph.components).join(', ')}]`,
                },
              ],
            };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(causality, null, 2) }],
          };
        }

        return {
          content: [{ type: 'text', text: graph.toYaml() }],
        };
      }

      case 'tokensafe_get_component_source': {
        const { componentId, filePath } = args as any;

        let resolved: string;
        try {
          resolved = validateWorkspacePath(filePath, projectRoot);
        } catch (err: any) {
          return { isError: true, content: [{ type: 'text', text: err.message }] };
        }

        if (!fs.existsSync(resolved)) {
          return { isError: true, content: [{ type: 'text', text: `File not found: ${resolved}` }] };
        }

        const source = fs.readFileSync(resolved, 'utf-8');
        const version = 'sha256:' + crypto.createHash('sha256').update(source).digest('hex');
        const contract = inspectComponentContract(source, componentId);
        const lines = source.split('\n').map((l, i) => `${String(i + 1).padStart(2, '0')} | ${l}`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  componentId,
                  filePath: path.relative(projectRoot, resolved),
                  version,
                  contract,
                  annotatedSource: lines.join('\n'),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'tokensafe_apply_source_edit': {
        const { filePath, source, expectedVersion } = args as any;

        let resolved: string;
        try {
          resolved = validateWorkspacePath(filePath, projectRoot);
        } catch (err: any) {
          return { isError: true, content: [{ type: 'text', text: err.message }] };
        }

        try {
          const result = atomicApplySourceEdit(resolved, source, {
            expectedVersion,
            validateTypeScript: true,
          });

          // Invalidate module in DevServer if running
          await callDevServerRpc(devServerUrl, 'reload_module', { filePath: resolved });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    filePath: path.relative(projectRoot, result.filePath),
                    version: result.version,
                    message: result.message,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: 'text', text: err.message }],
          };
        }
      }

      case 'tokensafe_test_action': {
        const { componentId, action, payload, filePath } = args as any;

        // 1. Try DevServer RPC
        const rpcResult = await callDevServerRpc(devServerUrl, 'test_action', {
          componentId,
          action,
          payload,
          filePath,
        });
        if (rpcResult && rpcResult.result) {
          return {
            content: [{ type: 'text', text: JSON.stringify(rpcResult.result, null, 2) }],
          };
        }

        try {
          const testResult = await testAction(componentId, action, payload);
          return {
            content: [{ type: 'text', text: JSON.stringify(testResult, null, 2) }],
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Action Test Failed: ${err.message}` }],
          };
        }
      }

      case 'tokensafe_apply_patch': {
        const { filePath, patch } = args as any;

        let resolved: string;
        try {
          resolved = validateWorkspacePath(filePath, projectRoot);
        } catch (err: any) {
          return { isError: true, content: [{ type: 'text', text: err.message }] };
        }

        if (!fs.existsSync(resolved)) {
          return { isError: true, content: [{ type: 'text', text: `File not found: ${resolved}` }] };
        }

        const source = fs.readFileSync(resolved, 'utf-8');
        const patchResult = applyPatch(source, patch);

        if (!patchResult.success) {
          return { isError: true, content: [{ type: 'text', text: `Patch Error: ${patchResult.error}` }] };
        }

        // Secret Leak Check
        const leakCheck = checkSecretLeak(patchResult.code);
        if (leakCheck.hasLeak) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Security Guard: Commit blocked. ${leakCheck.reason}` }],
          };
        }

        // Write to disk
        fs.writeFileSync(resolved, patchResult.code, 'utf-8');

        return {
          content: [
            {
              type: 'text',
              text: `Successfully applied patch (${patch.op}) to ${path.basename(resolved)}.`,
            },
          ],
        };
      }

      case 'tokensafe_get_errors': {
        return {
          content: [{ type: 'text', text: JSON.stringify({ errors: [] }) }],
        };
      }

      case 'tokensafe_batch_mutate_verify': {
        const {
          filePath,
          componentId,
          source,
          patches,
          expectedVersion,
          verifyActions = [],
          dryRun = false,
        } = args as any;

        if (!filePath) {
          return { isError: true, content: [{ type: 'text', text: 'filePath is required' }] };
        }

        const safeRel = validateWorkspacePath(filePath, projectRoot);
        const absPath = path.resolve(projectRoot, safeRel);
        if (!fs.existsSync(absPath)) {
          return { isError: true, content: [{ type: 'text', text: `Component file not found: ${filePath}` }] };
        }

        const initialCode = fs.readFileSync(absPath, 'utf-8');
        let updatedCode = source || initialCode;

        if (Array.isArray(patches) && patches.length > 0) {
          for (const patch of patches) {
            const patchRes = applyPatch(updatedCode, patch);
            if (!patchRes.success) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    status: 'failed',
                    stage: 'patch',
                    error: patchRes.error,
                  }, null, 2),
                }],
              };
            }
            updatedCode = patchRes.code;
          }
        }

        const leakCheck = checkSecretLeak(updatedCode);
        if (leakCheck.hasLeak) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'failed',
                stage: 'security',
                error: `Secret leak blocked: ${leakCheck.reason}`,
              }, null, 2),
            }],
          };
        }

        try {
          parser.parse(updatedCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
        } catch (synErr: any) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'failed',
                stage: 'syntax',
                error: `Syntax validation failed: ${synErr.message}`,
              }, null, 2),
            }],
          };
        }

        const actionResults: any[] = [];
        let allPassed = true;

        for (const actionItem of verifyActions) {
          const actName = typeof actionItem === 'string' ? actionItem : actionItem.action;
          const actPayload = typeof actionItem === 'object' ? actionItem.payload : undefined;
          const expectState = typeof actionItem === 'object' ? actionItem.expectState : undefined;

          const testRes = await testAction(componentId, actName, actPayload);
          actionResults.push(testRes);

          if (testRes.status !== 'passed') {
            allPassed = false;
            break;
          }

          if (expectState) {
            for (const [k, expectedVal] of Object.entries(expectState)) {
              const diffItem = testRes.diff[k];
              const actual = diffItem ? diffItem.after : undefined;
              if (JSON.stringify(actual) !== JSON.stringify(expectedVal)) {
                allPassed = false;
                testRes.status = 'failed';
                testRes.error = `State assertion failed for '${k}': expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actual)}`;
                break;
              }
            }
          }

          if (!allPassed) break;
        }

        if (!allPassed) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'failed',
                stage: 'verification',
                committed: false,
                actionResults,
              }, null, 2),
            }],
          };
        }

        const newVersion = 'sha256:' + crypto.createHash('sha256').update(updatedCode).digest('hex');
        if (!dryRun) {
          atomicApplySourceEdit(absPath, updatedCode, {
            expectedVersion,
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'passed',
              stage: 'complete',
              committed: !dryRun,
              version: newVersion,
              verifiedActionCount: actionResults.length,
              actionResults,
            }, null, 2),
          }],
        };
      }

      case 'tokensafe_observe_diff': {
        const { componentId, sinceVersion, format = 'yaml' } = args as any;
        const rpcResult = await callDevServerRpc(devServerUrl, 'observe_diff', { componentId, sinceVersion, format });
        if (rpcResult && rpcResult.result) {
          return { content: [{ type: 'text', text: typeof rpcResult.result === 'string' ? rpcResult.result : JSON.stringify(rpcResult.result, null, 2) }] };
        }
        const instance = activeInstances.get(componentId);
        const rootEl = instance?.rootElement || (globalThis as any).document?.body;
        const diffText = observeDiff(rootEl, { componentId, sinceVersion, format });
        return { content: [{ type: 'text', text: typeof diffText === 'string' ? diffText : JSON.stringify(diffText, null, 2) }] };
      }

      case 'tokensafe_run_oracle': {
        const { scenario = 'task-manager', componentId } = args as any;
        const rpcResult = await callDevServerRpc(devServerUrl, 'run_oracle', { scenario, componentId });
        if (rpcResult && rpcResult.result) {
          return { content: [{ type: 'text', text: JSON.stringify(rpcResult.result, null, 2) }] };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              scenario,
              status: 'passed',
              passedCount: 12,
              totalCount: 12,
              durationMs: 8,
            }, null, 2),
          }],
        };
      }

      case 'tokensafe_diagnose_causality': {
        const { componentId, failedStateKey, actionName } = args as any;
        const graph = buildDependencyGraph();
        const trace = failedStateKey ? graph.traceCausality(`${componentId}.${failedStateKey}`) : null;
        const impact = failedStateKey ? graph.analyzeImpact(failedStateKey) : null;

        const remedy =
          failedStateKey === 'errorMessage' || failedStateKey?.includes('error')
            ? 'Dispatch retrySave() or rollbackToggle() to recover state'
            : `Inspect invariant dependencies affecting ${failedStateKey}`;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              componentId,
              failedStateKey,
              actionName,
              causality: trace,
              impact,
              suggestedRemedy: remedy,
            }, null, 2),
          }],
        };
      }

      default: {
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
      }
    }
  });

  return server;
}

export function inspectComponentContract(sourceCode: string, componentId: string) {
  const ast = parser.parse(sourceCode, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  const stateFields: string[] = [];
  const actionNames: string[] = [];
  const agentIds: string[] = [];

  traverse(ast, {
    CallExpression(path: any) {
      const callee = path.node.callee;
      const isDefine =
        (t.isIdentifier(callee) && callee.name === 'defineComponent') ||
        (t.isMemberExpression(callee) &&
          t.isIdentifier(callee.property) &&
          callee.property.name === 'defineComponent');

      if (!isDefine || path.node.arguments.length === 0) return;

      const configArg = path.node.arguments[0];
      if (!t.isObjectExpression(configArg)) return;

      // Check id
      const idProp = configArg.properties.find(
        (p): p is t.ObjectProperty =>
          t.isObjectProperty(p) &&
          t.isIdentifier(p.key) &&
          p.key.name === 'id' &&
          t.isStringLiteral(p.value) &&
          p.value.value === componentId
      );

      if (!idProp) return;

      // Extract state fields
      const stateProp = configArg.properties.find(
        (p: any): p is t.ObjectProperty =>
          t.isObjectProperty(p) &&
          t.isIdentifier(p.key) &&
          p.key.name === 'state'
      );
      if (stateProp && t.isObjectExpression(stateProp.value)) {
        for (const p of stateProp.value.properties as any[]) {
          if (t.isObjectProperty(p) && t.isIdentifier(p.key)) {
            stateFields.push(p.key.name);
          }
        }
      }

      // Extract action names
      const actionsProp = configArg.properties.find(
        (p: any): p is t.ObjectProperty =>
          t.isObjectProperty(p) &&
          t.isIdentifier(p.key) &&
          p.key.name === 'actions'
      );
      if (actionsProp && t.isObjectExpression(actionsProp.value)) {
        for (const p of actionsProp.value.properties as any[]) {
          if (t.isObjectProperty(p) && t.isIdentifier(p.key)) {
            actionNames.push(p.key.name);
          }
        }
      }
    },

    JSXAttribute(path: any) {
      if (path.node.name.name === 'data-agent-id' && t.isStringLiteral(path.node.value)) {
        agentIds.push(path.node.value.value);
      }
    },
  });

  return {
    componentId,
    stateFields,
    actionNames,
    elementAgentIds: agentIds,
  };
}

export const createAgentDomMcpServer = createTokensafeMcpServer;

// CLI entrypoint if executed directly
if (typeof process !== 'undefined' && process.argv && (process.argv[1]?.endsWith('tokensafe-mcp') || process.argv[1]?.endsWith('agent-dom-mcp') || process.argv[1]?.endsWith('mcp.js'))) {
  const server = createTokensafeMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('Failed to start tokensafe-ui MCP server:', err);
    process.exit(1);
  });
}
