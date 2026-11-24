import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transformAgentDomJsx } from './transformer.js';
import { applyPatch, type ComponentPatch } from '@tokensafe-ui/patcher';
import { testAction, testEffect, hotReloadComponent, activeInstances } from '@tokensafe-ui/core';

export interface TokensafeUiPluginOptions {
  enableRpc?: boolean;
  sessionToken?: string;
}

export function tokensafeUi(options: TokensafeUiPluginOptions = {}): Plugin {
  const enableRpc = options.enableRpc !== false;
  const sessionToken = options.sessionToken || crypto.randomBytes(16).toString('hex');
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
        req.on('data', (chunk: any) => {
          body += chunk;
        });

        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');

          try {
            const payload = JSON.parse(body || '{}');
            const { method, params } = payload;

            switch (method) {
              case 'oumv/handshake':
              case 'handshake': {
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: payload.id ?? 1,
                    result: {
                      protocolVersion: '1.0.0',
                      runtimeInfo: {
                        name: 'tokensafe-ui',
                        version: '0.1.16',
                        framework: 'SolidJS + TokenSafe',
                      },
                      capabilities: {
                        observe: { levels: ['L0', 'L1', 'L2'] },
                        understand: { causality: true },
                        mutate: { occ: true },
                        verify: { synthetic: true },
                      },
                    },
                  })
                );
                break;
              }

              case 'oumv/observe': {
                const level = String(params?.level || 'L0').toUpperCase();
                const resultData: any = {
                  pulse: 'healthy',
                  runtime: 'tokensafe-ui',
                  version: '0.1.16',
                  activeComponentsCount: activeInstances.size,
                };

                if (level === 'L0') {
                  resultData.summary = `tokensafe-ui active (${activeInstances.size} components registered)`;
                  resultData.componentIds = Array.from(activeInstances.keys());
                } else if (level === 'L1') {
                  resultData.snapshot = latestLiveSnapshot;
                  resultData.components = Array.from(activeInstances.entries()).map(([id, inst]) => ({
                    id,
                    state: inst.state,
                    signals: Object.keys(inst.signals || {}),
                  }));
                } else {
                  resultData.snapshot = latestLiveSnapshot;
                  resultData.components = Array.from(activeInstances.entries()).map(([id, inst]) => ({
                    id,
                    state: inst.state,
                    signals: inst.signals,
                    vnode: inst.vnode,
                  }));
                }

                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: payload.id ?? 1,
                    result: resultData,
                  })
                );
                break;
              }

              case 'oumv/understand': {
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: payload.id ?? 1,
                    result: {
                      query: params?.query || 'causality',
                      target: params?.target || null,
                      activeComponents: Array.from(activeInstances.keys()),
                      snapshot: latestLiveSnapshot,
                      causalityTrace: 'Reactive dependency graph tracked by SolidJS + TokenSafe signals',
                    },
                  })
                );
                break;
              }

              case 'oumv/verify': {
                const targetId = params?.target || params?.componentId;
                const actionName = params?.action;
                const actionPayload = params?.payload;
                try {
                  const testResult = await testAction(targetId, actionName, actionPayload);
                  res.end(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      id: payload.id ?? 1,
                      result: testResult,
                    })
                  );
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      id: payload.id ?? 1,
                      error: { message: err.message },
                    })
                  );
                }
                break;
              }

              case 'oumv/mutate': {
                const filePath = params?.path || params?.filePath;
                const patch = params?.patch;
                if (!filePath || !patch) {
                  res.statusCode = 400;
                  res.end(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      id: payload.id ?? 1,
                      error: { message: 'Missing filePath or patch in mutate' },
                    })
                  );
                  break;
                }
                const resolvedPath = path.isAbsolute(filePath)
                  ? filePath
                  : path.resolve(server.config.root, filePath);
                if (!fs.existsSync(resolvedPath)) {
                  res.statusCode = 404;
                  res.end(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      id: payload.id ?? 1,
                      error: { message: `File not found: ${resolvedPath}` },
                    })
                  );
                  break;
                }
                const source = fs.readFileSync(resolvedPath, 'utf-8');
                const patchResult = applyPatch(source, patch);
                if (!patchResult.success) {
                  res.statusCode = 400;
                  res.end(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      id: payload.id ?? 1,
                      error: { message: patchResult.error },
                    })
                  );
                  break;
                }
                fs.writeFileSync(resolvedPath, patchResult.code, 'utf-8');
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: payload.id ?? 1,
                    result: { success: true, filePath: resolvedPath },
                  })
                );
                break;
              }

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
                const { componentId, action, payload, filePath, expect, assert } = (params || {}) as any;
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

                  const testResult = await testAction(componentId, action, payload, { expect, assert });
                  res.end(JSON.stringify({ result: testResult }));
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
                break;
              }

              case 'test_effect': {
                const { componentId, effect, payload, filePath, timeoutMs, expectDispatched, expect } = (params || {}) as any;
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

                  const effectResult = await testEffect(componentId, effect, {
                    payload,
                    timeoutMs,
                    expectDispatched,
                    expect,
                  });
                  res.end(JSON.stringify({ result: effectResult }));
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
                break;
              }

              case 'reload_module': {
                const { filePath, componentId } = (params || {}) as any;
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
                          if (componentId) {
                            hotReloadComponent(componentId, exp as any);
                          } else {
                            const inst = (exp as any)();
                            if (inst && inst.id) {
                              hotReloadComponent(inst.id, exp as any);
                            }
                          }
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

                // Trigger Vite HMR & SSR reload
                const mod = server.moduleGraph.getModuleById(resolvedPath);
                if (mod) {
                  server.moduleGraph.invalidateModule(mod);
                  server.reloadModule(mod);
                }
                try {
                  const freshMod = await server.ssrLoadModule(resolvedPath);
                  const cid = (patch as any).componentId;
                  for (const exp of Object.values(freshMod)) {
                    if (typeof exp === 'function') {
                      try {
                        if (cid) {
                          hotReloadComponent(cid, exp as any);
                        } else {
                          const inst = (exp as any)();
                          if (inst && inst.id) hotReloadComponent(inst.id, exp as any);
                        }
                      } catch {}
                    }
                  }
                } catch {}

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

      server.middlewares.use('/__oumv/rpc', handleRpc);
      server.middlewares.use('/__tokensafe_ui/rpc', handleRpc);
      server.middlewares.use('/__agent_dom/rpc', handleRpc);

      // Register .tokensafe/runtime.json descriptor
      const rootDir = server.config?.root || process.cwd();
      const tokensafeDir = path.join(rootDir, '.tokensafe');
      const writeDescriptor = () => {
        try {
          fs.mkdirSync(tokensafeDir, { recursive: true });
          const runtimeFile = path.join(tokensafeDir, 'runtime.json');
          let existing: any = {};
          if (fs.existsSync(runtimeFile)) {
            try { existing = JSON.parse(fs.readFileSync(runtimeFile, 'utf-8')); } catch {}
          }
          const port = server.config?.server?.port || 5173;
          existing.frontend = {
            name: 'tokensafe-ui',
            version: '0.1.16',
            url: `http://localhost:${port}/__oumv/rpc`,
            sessionToken,
            capabilities: {
              observeLevels: ['L0', 'L1', 'L2'],
              causality: true,
              occ: true,
            },
          };
          fs.writeFileSync(runtimeFile, JSON.stringify(existing, null, 2), 'utf-8');
          try { fs.chmodSync(runtimeFile, 0o600); } catch {}
        } catch {}
      };

      if (server.httpServer) {
        server.httpServer.once('listening', writeDescriptor);
      } else {
        writeDescriptor();
      }
    },
  };
}

export const agentDom = tokensafeUi;
