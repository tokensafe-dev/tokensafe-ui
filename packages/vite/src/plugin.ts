import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transformAgentDomJsx } from './transformer.js';
import type { ComponentPatch } from '@tokensafe-ui/patcher';

// The native SolidJS runtime is loaded lazily and only by the native bridge.
// A React/Vue app must never evaluate solid-js just because it imports this plugin.
const loadNativeCore = () => import('@tokensafe-ui/core');
const loadNativePatcher = () => import('@tokensafe-ui/patcher');
import {
  REACT_BRIDGE_PUBLIC_PATH,
  REACT_BRIDGE_VIRTUAL_ID,
  getReactBridgeClientCode,
} from './react-bridge.js';
import { createReactOumvController } from './react-rpc.js';
import {
  VUE_BRIDGE_PUBLIC_PATH,
  VUE_BRIDGE_VIRTUAL_ID,
  getVueBridgeClientCode,
} from './vue-bridge.js';
import { createVueOumvController } from './vue-rpc.js';
import { attachStreamTransports } from './streams.js';
import {
  clearWorkspaceRuntimeDescriptor,
  writeWorkspaceRuntimeDescriptor,
} from './runtime-store.js';

const SERVER_ATTACHED_SYM = Symbol.for('tokensafe.oumv.attached');

export type TokensafeFrameworkMode = 'auto' | 'tokensafe-ui' | 'react' | 'vue';

export interface TokensafeUiPluginOptions {
  enableRpc?: boolean;
  sessionToken?: string;
  framework?: TokensafeFrameworkMode;
  requireAuth?: boolean;
}

export function resolveFrameworkMode(
  rootDir: string,
  requested: TokensafeFrameworkMode = 'auto'
): 'tokensafe-ui' | 'react' | 'vue' {
  if (requested === 'react' || requested === 'tokensafe-ui' || requested === 'vue') {
    return requested;
  }
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = pkg.dependencies || {};
      const allDeps = { ...deps, ...(pkg.devDependencies || {}) };
      // The framework wins even when tokensafe-ui is installed: a React app that
      // adds this plugin must NOT be JSX-rewritten into tokensafe-ui's own h().
      if (allDeps.react || allDeps['react-dom'] || allDeps.next) {
        return 'react';
      }
      if (allDeps.vue || allDeps.nuxt) {
        return 'vue';
      }
    }
  } catch {}
  return 'tokensafe-ui';
}

function writeRuntimeDescriptor(
  rootDir: string,
  frontendEntry: Record<string, unknown>
): void {
  writeWorkspaceRuntimeDescriptor(rootDir, 'frontend', frontendEntry);
}

export function tokensafeUi(options: TokensafeUiPluginOptions = {}): Plugin {
  const enableRpc = options.enableRpc !== false;
  const sessionToken = options.sessionToken || crypto.randomBytes(16).toString('hex');
  let latestLiveSnapshot = 'view: empty\nelements: []';
  let resolvedMode: 'tokensafe-ui' | 'react' | 'vue' = resolveFrameworkMode(process.cwd(), options.framework);
  let isServeCommand = true;

  return {
    name: 'tokensafe-ui',
    enforce: 'pre',

    configResolved(config: ResolvedConfig) {
      isServeCommand = config.command === 'serve';
      resolvedMode = resolveFrameworkMode(config.root || process.cwd(), options.framework);
    },

    resolveId(id: string) {
      if (!isServeCommand) return null;
      if (resolvedMode === 'react' && id === REACT_BRIDGE_PUBLIC_PATH) return REACT_BRIDGE_VIRTUAL_ID;
      if (resolvedMode === 'vue' && id === VUE_BRIDGE_PUBLIC_PATH) return VUE_BRIDGE_VIRTUAL_ID;
      return null;
    },

    load(id: string) {
      if (!isServeCommand) return null;
      if (resolvedMode === 'react' && id === REACT_BRIDGE_VIRTUAL_ID) return getReactBridgeClientCode();
      if (resolvedMode === 'vue' && id === VUE_BRIDGE_VIRTUAL_ID) return getVueBridgeClientCode();
      return null;
    },

    transformIndexHtml(html: string) {
      if (!isServeCommand || !enableRpc) {
        return html;
      }
      const bridgePath =
        resolvedMode === 'react'
          ? REACT_BRIDGE_PUBLIC_PATH
          : resolvedMode === 'vue'
            ? VUE_BRIDGE_PUBLIC_PATH
            : null;
      if (!bridgePath || html.includes(bridgePath)) {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { type: 'module', src: bridgePath },
            injectTo: 'body' as const,
          },
        ],
      };
    },

    transform(code: string, id: string) {
      // Only a native tokensafe-ui app gets its JSX rewritten into h(); React and
      // Vue apps keep their own JSX runtime untouched.
      if (resolvedMode !== 'tokensafe-ui') {
        return null;
      }
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
      if ((server as any)[SERVER_ATTACHED_SYM]) return;
      (server as any)[SERVER_ATTACHED_SYM] = true;

      const rootDir = server.config?.root || process.cwd();
      resolvedMode = resolveFrameworkMode(rootDir, options.framework);

      if (resolvedMode === 'react' || resolvedMode === 'vue') {
        const controller =
          resolvedMode === 'react'
            ? createReactOumvController({ rootDir, sessionToken, server })
            : createVueOumvController({ rootDir, sessionToken, server });
        const runtimeVersion =
          resolvedMode === 'react' ? (controller as any).reactVersion : (controller as any).vueVersion;

        // §2.6 (wire 1.6.0): compile errors the dev server already observes —
        // including HMR reloads — flow on the push transports instead of only
        // lighting the browser overlay. transformRequest is invoked for every
        // module load, so this captures build and HMR failures at one seam.
        const recordDevDiagnostic = (err: any, url: string): void => {
          const diagnostic: Record<string, unknown> = {
            severity: 'error',
            source: 'build',
            message: String(err?.message ?? err ?? 'transform failed').slice(0, 500),
            tool: 'vite',
            ts: Date.now(),
          };
          const file = typeof url === 'string' ? url.replace(/^\//, '').split(/[?#]/)[0] : '';
          if (file) diagnostic.file = file;
          (controller as any).recordDiagnostic?.(diagnostic);
        };
        const transformRequest = typeof server.transformRequest === 'function' ? server.transformRequest.bind(server) : null;
        if (transformRequest) {
          (server as any).transformRequest = async (url: string, options?: any) => {
            try {
              return await transformRequest(url, options);
            } catch (err: any) {
              recordDevDiagnostic(err, url);
              throw err;
            }
          };
        }

        const isAuthorized = (req: any): boolean => {
          const providedToken = String(
            req.headers?.['x-oumv-session-token'] ||
              (typeof req.headers?.authorization === 'string' &&
              req.headers.authorization.toLowerCase().startsWith('bearer ')
                ? req.headers.authorization.slice(7).trim()
                : '') ||
              ''
          );
          return !(
            (options.requireAuth && providedToken !== sessionToken) ||
            (providedToken && providedToken !== sessionToken)
          );
        };

        const handleReactRpc = async (req: any, res: any) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-OUMV-Session-Token');
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          if (!isAuthorized(req)) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32007, message: 'PERMISSION_DENIED: invalid OUMV session token' },
              })
            );
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
              const out = await controller.handleRpcPayload(payload);
              res.statusCode = out.statusCode;
              res.end(JSON.stringify(out.body));
            } catch (err: any) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: { code: -32700, message: `Parse error: ${err.message}` },
                })
              );
            }
          });
        };

        server.middlewares.use('/__oumv/rpc', handleReactRpc);
        server.middlewares.use('/__tokensafe_ui/rpc', handleReactRpc);
        server.middlewares.use('/__agent_dom/rpc', handleReactRpc);

        const detachStreams = attachStreamTransports({
          middlewares: server.middlewares,
          httpServer: server.httpServer,
          ssePaths: ['/__oumv/events', '/__tokensafe_ui/events', '/__agent_dom/events'],
          wsPaths: ['/__oumv/rpc', '/__tokensafe_ui/rpc', '/__agent_dom/rpc'],
          authorize: isAuthorized,
          getTracesSince: (seq: number) => controller.getTracesSince(seq) as any,
          getEventsSince: (controller as any).getEventsSince,
          handleRpcPayload: controller.handleRpcPayload,
        });
        if (server.httpServer) {
          server.httpServer.once('close', detachStreams);
        }

        const emitDescriptor = () => {
          const addr = server.httpServer?.address();
          const boundPort =
            addr && typeof addr === 'object' && addr.port
              ? addr.port
              : server.config?.server?.port || 5173;
          writeRuntimeDescriptor(rootDir, {
            type: 'frontend',
            name: resolvedMode,
            version: runtimeVersion,
            url: `http://localhost:${boundPort}/__oumv/rpc`,
            sseUrl: `http://localhost:${boundPort}/__oumv/events`,
            wsUrl: `ws://localhost:${boundPort}/__oumv/rpc`,
            sessionToken,
            capabilities: {
              observeLevels: ['L0', 'L1', 'L2', 'L3', 'L4'],
              transports: ['http', 'sse', 'ws'],
              causality: true,
              occ: true,
              verify: true,
            },
          });
        };

        if (server.httpServer) {
          server.httpServer.once('listening', emitDescriptor);
          server.httpServer.once('close', () => clearWorkspaceRuntimeDescriptor(rootDir, 'frontend'));
        } else {
          emitDescriptor();
        }
        return;
      }

      // The native tokensafe-ui runtime owns this branch; React and Vue are
      // handled above, so a framework app never evaluates the SolidJS core.

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
        const [core, patcher] = await Promise.all([loadNativeCore(), loadNativePatcher()]);
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
                      protocolVersion: '1.5.0',
                      profile: 'frontend',
                      runtimeInfo: {
                        name: 'tokensafe-ui',
                        version: '0.1.18',
                        framework: 'SolidJS + TokenSafe',
                      },
                      // Honest capability set: the native bridge serves L0-L2 from
                      // registered instances. It does not read source or trace
                      // requests, so L3/L4 are not advertised.
                      capabilities: {
                        observe: { levels: ['L0', 'L1', 'L2'], formats: ['yaml', 'json'] },
                        understand: { causality: true, signalsGraph: true, impactAnalysis: true },
                        mutate: { occ: true, syntaxGuard: false, ephemeralDispatch: true },
                        verify: { multiMetric: true, surfaceDiff: true },
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
                  activeComponentsCount: core.activeInstances.size,
                };

                if (level === 'L0') {
                  resultData.summary = `tokensafe-ui active (${core.activeInstances.size} components registered)`;
                  resultData.componentIds = Array.from(core.activeInstances.keys());
                } else if (level === 'L1') {
                  resultData.snapshot = latestLiveSnapshot;
                  resultData.components = Array.from(core.activeInstances.entries()).map(([id, inst]) => ({
                    id,
                    state: inst.state,
                    signals: Object.keys(inst.signals || {}),
                  }));
                } else {
                  resultData.snapshot = latestLiveSnapshot;
                  resultData.components = Array.from(core.activeInstances.entries()).map(([id, inst]) => ({
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
                      activeComponents: Array.from(core.activeInstances.keys()),
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
                  const testResult = await core.testAction(targetId, actionName, actionPayload);
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
                const patchResult = patcher.applyPatch(source, patch);
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
                  if (!core.activeInstances.has(componentId)) {
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
                            if (typeof exp === 'function' && !core.activeInstances.has(componentId)) {
                              try {
                                exp();
                              } catch {}
                            }
                          }
                        } catch {}
                        if (core.activeInstances.has(componentId)) break;
                      }
                    }
                  }

                  const testResult = await core.testAction(componentId, action, payload, { expect, assert });
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
                  if (!core.activeInstances.has(componentId)) {
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
                            if (typeof exp === 'function' && !core.activeInstances.has(componentId)) {
                              try {
                                exp();
                              } catch {}
                            }
                          }
                        } catch {}
                        if (core.activeInstances.has(componentId)) break;
                      }
                    }
                  }

                  const effectResult = await core.testEffect(componentId, effect, {
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
                            core.hotReloadComponent(componentId, exp as any);
                          } else {
                            const inst = (exp as any)();
                            if (inst && inst.id) {
                              core.hotReloadComponent(inst.id, exp as any);
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
                const patchResult = patcher.applyPatch(source, patch);

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
                          core.hotReloadComponent(cid, exp as any);
                        } else {
                          const inst = (exp as any)();
                          if (inst && inst.id) core.hotReloadComponent(inst.id, exp as any);
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

      const writeDescriptor = () => {
        const port = server.config?.server?.port || 5173;
        writeRuntimeDescriptor(rootDir, {
          name: 'tokensafe-ui',
          version: '0.1.19',
          url: `http://localhost:${port}/__oumv/rpc`,
          sessionToken,
          capabilities: {
            observeLevels: ['L0', 'L1', 'L2'],
            causality: true,
            occ: true,
          },
        });
      };

      if (server.httpServer) {
        server.httpServer.once('listening', writeDescriptor);
        server.httpServer.once('close', () => clearWorkspaceRuntimeDescriptor(rootDir, 'frontend'));
      } else {
        writeDescriptor();
      }
    },
  };
}

export function tokensafeReact(options: Omit<TokensafeUiPluginOptions, 'framework'> = {}): Plugin {
  return tokensafeUi({ ...options, framework: 'react' });
}

export const agentDom = tokensafeUi;
