import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { InlineConfig, ViteDevServer } from 'vite';
import { tokensafeReact, type TokensafeFrameworkMode } from './plugin.js';
import { getGlobalRuntimeDescriptorPath } from './runtime-store.js';

export interface ZeroFootprintViteOptions {
  rootDir?: string;
  port?: number;
  host?: string | boolean;
  open?: boolean;
  sessionToken?: string;
  enableRpc?: boolean;
  framework?: TokensafeFrameworkMode;
  log?: boolean;
}

export async function resolveProjectVite(rootDir: string): Promise<typeof import('vite')> {
  const absRoot = path.resolve(rootDir);
  const anchorPkg = path.join(absRoot, 'package.json');
  try {
    if (fs.existsSync(anchorPkg)) {
      const req = createRequire(anchorPkg);
      const viteEntry = req.resolve('vite');
      return await import(pathToFileURL(viteEntry).href);
    }
  } catch {}
  return await import('vite');
}

export async function startZeroFootprintViteServer(
  options: ZeroFootprintViteOptions = {}
): Promise<ViteDevServer> {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const vite = await resolveProjectVite(rootDir);
  // The mode must be forwarded: without it the plugin defaults to React and a Vue
  // app gets the React controller and bridge.
  const plugin = tokensafeReact({
    enableRpc: options.enableRpc,
    sessionToken: options.sessionToken,
    ...(options.framework ? { framework: options.framework } : {}),
  });

  const serverConfig: InlineConfig['server'] = {};
  if (typeof options.port === 'number' && Number.isFinite(options.port)) {
    serverConfig.port = options.port;
  }
  if (options.host !== undefined) {
    serverConfig.host = options.host;
  }
  if (options.open !== undefined) {
    serverConfig.open = options.open;
  }

  const inlineConfig: InlineConfig = {
    root: rootDir,
    plugins: [plugin],
    ...(Object.keys(serverConfig).length > 0 ? { server: serverConfig } : {}),
  };

  const server = await vite.createServer(inlineConfig);
  await server.listen();

  if (options.log !== false) {
    const addr = server.httpServer?.address();
    const port =
      addr && typeof addr === 'object' && addr.port
        ? addr.port
        : server.config?.server?.port || 5173;
    console.log(`\n⚡ TokenSafe OUMV Zero-Footprint Vite+React DevServer running`);
    console.log(`  App URL:        http://localhost:${port}/`);
    console.log(`  OUMV RPC:       http://localhost:${port}/__oumv/rpc`);
    console.log(`  Repo footprint: 0 files modified (runtime stored in ${getGlobalRuntimeDescriptorPath(rootDir)})\n`);
  }

  return server;
}
