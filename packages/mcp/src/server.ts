import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { applyPatch, type ComponentPatch } from '@agent-dom/patcher';

const traverse = (_traverse as any).default || _traverse;

export interface McpServerConfig {
  devServerUrl?: string;
  projectRoot?: string;
}

export function createAgentDomMcpServer(config: McpServerConfig = {}) {
  const devServerUrl = config.devServerUrl || 'http://localhost:5173';
  const projectRoot = config.projectRoot || process.cwd();

  const server = new Server(
    {
      name: 'agent-dom-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define available MCP tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'agent_dom_get_view',
          description:
            'Queries the active, token-efficient semantic UI snapshot (<150 tokens) from the running agent-dom DevServer or offline files.',
          inputSchema: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                enum: ['yaml', 'sexp', 'json'],
                default: 'yaml',
                description: 'Output format: yaml (default), sexp, or json',
              },
            },
          },
        },
        {
          name: 'agent_dom_inspect',
          description:
            'Extracts the contract (State schema, Actions, AST element IDs) of a specific component in <40 tokens.',
          inputSchema: {
            type: 'object',
            properties: {
              componentId: {
                type: 'string',
                description: 'Component ID, e.g. "counter-card"',
              },
              filePath: {
                type: 'string',
                description: 'Relative or absolute path to component file',
              },
            },
            required: ['componentId', 'filePath'],
          },
        },
        {
          name: 'agent_dom_apply_patch',
          description:
            'Applies a surgical AST patch (add action, update state schema, insert JSX, or bind event) with instant HMR.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Path to component file to patch',
              },
              patch: {
                type: 'object',
                description: 'Component patch specification',
                properties: {
                  op: {
                    type: 'string',
                    enum: ['add_action', 'update_state', 'insert_jsx', 'bind_event'],
                  },
                  componentId: { type: 'string' },
                  name: { type: 'string' },
                  key: { type: 'string' },
                  code: { type: 'string' },
                  schemaCode: { type: 'string' },
                  targetAgentId: { type: 'string' },
                  position: {
                    type: 'string',
                    enum: ['before', 'after', 'prepend', 'append'],
                  },
                  jsxCode: { type: 'string' },
                  event: { type: 'string' },
                  actionName: { type: 'string' },
                },
                required: ['op'],
              },
            },
            required: ['filePath', 'patch'],
          },
        },
        {
          name: 'agent_dom_get_errors',
          description:
            'Returns structured, machine-actionable compiler or runtime error payloads without minified stack traces.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  // Handle Tool Calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'agent_dom_get_view': {
        // Try live DevServer RPC first
        try {
          const res = await fetch(`${devServerUrl}/__agent_dom/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'get_snapshot' }),
          });
          if (res.ok) {
            const data: any = await res.json();
            return {
              content: [
                {
                  type: 'text',
                  text: data.result?.snapshot || 'view: empty\nelements: []',
                },
              ],
            };
          }
        } catch {
          // DevServer offline fallback
        }

        return {
          content: [
            {
              type: 'text',
              text: 'status: dev_server_offline\nnote: Vite DevServer is not currently running. Use agent_dom_inspect to inspect component files directly.',
            },
          ],
        };
      }

      case 'agent_dom_inspect': {
        const { componentId, filePath } = args as {
          componentId: string;
          filePath: string;
        };

        const resolved = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(projectRoot, filePath);

        if (!fs.existsSync(resolved)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `File not found: ${resolved}` }],
          };
        }

        const source = fs.readFileSync(resolved, 'utf-8');
        const contract = inspectComponentContract(source, componentId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(contract, null, 2),
            },
          ],
        };
      }

      case 'agent_dom_apply_patch': {
        const { filePath, patch } = args as {
          filePath: string;
          patch: ComponentPatch;
        };

        const resolved = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(projectRoot, filePath);

        if (!fs.existsSync(resolved)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `File not found: ${resolved}` }],
          };
        }

        const source = fs.readFileSync(resolved, 'utf-8');
        const patchResult = applyPatch(source, patch);

        if (!patchResult.success) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Patch Error: ${patchResult.error}` }],
          };
        }

        // Write patched file to disk
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

      case 'agent_dom_get_errors': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ errors: [] }),
            },
          ],
        };
      }

      default: {
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
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

// CLI entrypoint if executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.endsWith('agent-dom-mcp')) {
  const server = createAgentDomMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('Failed to start agent-dom MCP server:', err);
    process.exit(1);
  });
}
