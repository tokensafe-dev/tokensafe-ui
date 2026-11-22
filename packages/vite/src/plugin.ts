import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { transformAgentDomJsx } from './transformer.js';
import { applyPatch, type ComponentPatch } from '@agent-dom/patcher';

export interface AgentDomPluginOptions {
  enableRpc?: boolean;
}

export function agentDom(options: AgentDomPluginOptions = {}): Plugin {
  const enableRpc = options.enableRpc !== false;
  let latestLiveSnapshot = 'view: empty\nelements: []';

  return {
    name: 'agent-dom',
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
          this.error(`agent-dom JSX transformation error in ${id}: ${err.message}`);
        }
      }
      return null;
    },

    configureServer(server: ViteDevServer) {
      if (!enableRpc) return;

      // Handle custom client snapshot events from browser HMR
      server.ws.on('agent-dom:snapshot', (data: any) => {
        if (data && typeof data.snapshot === 'string') {
          latestLiveSnapshot = data.snapshot;
        }
      });

      // JSON-RPC / HTTP Bridge endpoint for AI agents
      server.middlewares.use('/__agent_dom/rpc', async (req, res) => {
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

              case 'get_snapshot': {
                res.end(
                  JSON.stringify({
                    result: { snapshot: latestLiveSnapshot },
                  })
                );
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
      });
    },
  };
}
