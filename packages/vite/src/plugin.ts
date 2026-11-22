import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { transformAgentDomJsx } from './transformer.js';
import { applyPatch, type ComponentPatch } from '@tokensafe-ui/patcher';
import { testAction, activeInstances } from '@tokensafe-ui/core';

export interface TokensafeUiPluginOptions {
  enableRpc?: boolean;
}

export function tokensafeUi(options: TokensafeUiPluginOptions = {}): Plugin {
  const enableRpc = options.enableRpc !== false;
  let latestLiveSnapshot = 'view: empty\nelements: []';

  return {
    name: 'tokensafe-ui',
    enforce: 'pre',

    transform(code: string, id: string) {
      if (id.endsWith('.tsx') || id.endsWith('.jsx')) {
        try {
          const res = transformAgentDomJsx(code, id);
          return {
            code: res.code,
            map: res.map,
          };
        } catch (err: any) {
          this.error(`tokensafe-ui JSX transformation error in ${id}: ${err.message}`);
        }
      }
      return null;
    },

    configureServer(server: ViteDevServer) {
      if (!enableRpc) return;

      // Handle custom client snapshot events from browser HMR
      const handleSnapshot = (data: any) => {
        if (data && typeof data.snapshot === 'string') {
          latestLiveSnapshot = data.snapshot;
        }
      };
      server.ws.on('tokensafe-ui:snapshot', handleSnapshot);
      server.ws.on('agent-dom:snapshot', handleSnapshot);

      // JSON-RPC / HTTP Bridge endpoint for AI agents
      const handleRpc = async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');

          try {
            const payload = JSON.parse(body || '{}');
            const { method, params } = payload;

            switch (method) {
              case 'get_status': {
                res.end(
                  JSON.stringify({
                    result: { status: 'ready', version: '0.1.0' },
                  })
                );
                break;
              }

              case 'get_snapshot':
              case 'observe': {
                res.end(
                  JSON.stringify({
                    result: { snapshot: latestLiveSnapshot, payload: latestLiveSnapshot },
                  })
                );
                break;
              }

              case 'test_action': {
                const { componentId, action, payload, filePath } = (params || {}) as any;
                try {
                  if (!activeInstances.has(componentId)) {
                    const candidates = [
                      filePath,
                      path.join(server.config.root, 'src', `${componentId}.tsx`),
                      path.join(server.config.root, 'src', 'OrderCheckout.tsx'),
                      path.join(server.config.root, 'src', 'App.tsx'),
                      path.join(server.config.root, 'src', 'main.ts'),
                    ].filter(Boolean);

                    for (const cand of candidates) {
                      const resolvedCand = path.isAbsolute(cand)
                        ? cand
                        : path.resolve(server.config.root, cand);
                      if (fs.existsSync(resolvedCand)) {
                        try {
                          const mod = await server.ssrLoadModule(resolvedCand);
                          for (const exp of Object.values(mod)) {
                            if (typeof exp === 'function' && !activeInstances.has(componentId)) {
                              try {
                                exp();
                              } catch {}
                            }
                          }
                        } catch {}
                        if (activeInstances.has(componentId)) break;
                      }
                    }
                  }

                  const testResult = await testAction(componentId, action, payload);
                  res.end(JSON.stringify({ result: testResult }));
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
                break;
              }

              case 'reload_module': {
                const { filePath } = (params || {}) as any;
                if (filePath) {
                  const resolvedPath = path.isAbsolute(filePath)
                    ? filePath
                    : path.resolve(server.config.root, filePath);
                  const mod = server.moduleGraph.getModuleById(resolvedPath);
                  if (mod) {
                    server.moduleGraph.invalidateModule(mod);
                    server.reloadModule(mod);
                  }
                  try {
                    const freshMod = await server.ssrLoadModule(resolvedPath);
                    for (const exp of Object.values(freshMod)) {
                      if (typeof exp === 'function') {
                        try {
                          exp();
                        } catch {}
                      }
                    }
                  } catch {}
                }
                res.end(JSON.stringify({ result: { success: true } }));
                break;
              }

              case 'apply_patch': {
                const { filePath, patch } = params as {
                  filePath: string;
                  patch: ComponentPatch;
                };

                const resolvedPath = path.isAbsolute(filePath)
                  ? filePath
                  : path.resolve(server.config.root, filePath);

                if (!fs.existsSync(resolvedPath)) {
                  res.statusCode = 404;
                  res.end(
                    JSON.stringify({ error: `File not found: ${resolvedPath}` })
                  );
                  return;
                }

                const source = fs.readFileSync(resolvedPath, 'utf-8');
                const patchResult = applyPatch(source, patch);

                if (!patchResult.success) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: patchResult.error }));
                  return;
                }

                // Write modified file
                fs.writeFileSync(resolvedPath, patchResult.code, 'utf-8');

                // Trigger Vite HMR
                const mod = server.moduleGraph.getModuleById(resolvedPath);
                if (mod) {
                  server.reloadModule(mod);
                }

                res.end(
                  JSON.stringify({
                    result: { success: true, filePath: resolvedPath },
                  })
                );
                break;
              }

              default: {
                res.statusCode = 400;
                res.end(
                  JSON.stringify({ error: `Unknown method: ${method}` })
                );
              }
            }
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      };

      server.middlewares.use('/__tokensafe_ui/rpc', handleRpc);
      server.middlewares.use('/__agent_dom/rpc', handleRpc);
    },
  };
}

export const agentDom = tokensafeUi;
