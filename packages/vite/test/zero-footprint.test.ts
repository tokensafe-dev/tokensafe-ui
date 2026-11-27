import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  clearWorkspaceRuntimeDescriptor,
  getGlobalContractsPath,
  getGlobalRuntimeDescriptorPath,
  isTokensafeIgnoredInRepo,
  tokensafeReact,
  tokensafeUi,
  writeWorkspaceRuntimeDescriptor,
} from '../src/index.js';
import { createReactOumvController } from '../src/react-rpc.js';

describe('@tokensafe-ui/vite Zero-Footprint Vite+React Mode', () => {
  let tmpRepo: string;
  let tmpHome: string;
  const origHome = process.env.TOKENSAFE_HOME;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-zf-repo-'));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-zf-home-'));
    process.env.TOKENSAFE_HOME = tmpHome;
    fs.mkdirSync(path.join(tmpRepo, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRepo, 'package.json'),
      JSON.stringify({ name: 'sample-vite-react', dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^6.0.0' } }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpRepo, 'src', 'App.tsx'),
      'export function App() { return <button>Hi</button>; }\n',
      'utf-8'
    );
  });

  afterEach(() => {
    if (origHome === undefined) {
      delete process.env.TOKENSAFE_HOME;
    } else {
      process.env.TOKENSAFE_HOME = origHome;
    }
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes runtime descriptor globally without creating .tokensafe inside clean repos', () => {
    expect(isTokensafeIgnoredInRepo(tmpRepo)).toBe(false);

    writeWorkspaceRuntimeDescriptor(tmpRepo, 'frontend', {
      name: 'react',
      url: 'http://localhost:5173/__oumv/rpc',
      sessionToken: 'tok-zf',
    });

    const globalPath = getGlobalRuntimeDescriptorPath(tmpRepo);
    expect(fs.existsSync(globalPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpRepo, '.tokensafe'))).toBe(false);

    const parsed = JSON.parse(fs.readFileSync(globalPath, 'utf-8'));
    expect(parsed.frontend.url).toBe('http://localhost:5173/__oumv/rpc');

    clearWorkspaceRuntimeDescriptor(tmpRepo, 'frontend');
    expect(fs.existsSync(globalPath)).toBe(false);
  });

  it('mirrors runtime descriptor locally only when .gitignore ignores .tokensafe/', () => {
    fs.writeFileSync(path.join(tmpRepo, '.gitignore'), 'node_modules/\n.tokensafe/\n', 'utf-8');
    expect(isTokensafeIgnoredInRepo(tmpRepo)).toBe(true);

    writeWorkspaceRuntimeDescriptor(tmpRepo, 'frontend', {
      name: 'react',
      url: 'http://localhost:5173/__oumv/rpc',
    });

    expect(fs.existsSync(getGlobalRuntimeDescriptorPath(tmpRepo))).toBe(true);
    expect(fs.existsSync(path.join(tmpRepo, '.tokensafe', 'runtime.json'))).toBe(true);
  });

  it('loads sidecar L2 contracts from TOKENSAFE_HOME without editing src/main.tsx', async () => {
    const contractsPath = getGlobalContractsPath(tmpRepo);
    fs.mkdirSync(path.dirname(contractsPath), { recursive: true });
    fs.writeFileSync(
      contractsPath,
      JSON.stringify({
        App: {
          description: 'Zero-footprint sidecar contract for App',
          actions: { navigate: { description: 'Switch view' } },
          constraints: ['Keep root view mounted'],
        },
      }),
      'utf-8'
    );

    const controller = createReactOumvController({ rootDir: tmpRepo });
    const l2 = await controller.handleRpcPayload({
      id: 1,
      method: 'oumv/observe',
      params: { level: 'L2', target: 'App' },
    });

    expect(l2.body.error).toBeUndefined();
    expect(l2.body.result.data.contracts).toHaveLength(1);
    expect(l2.body.result.data.contracts[0].description).toBe('Zero-footprint sidecar contract for App');
    expect(l2.body.result.evidence.provenance).toBe('contract');
  });

  it('mounts the OUMV endpoints and the Vue bridge for a Vue app', () => {
    const plugin = tokensafeUi();
    (plugin as any).configResolved({ command: 'serve', root: tmpRepo });
    let middlewareCount = 0;
    const fakeServer: any = {
      config: { root: tmpRepo, server: { port: 5173 } },
      ws: { on: () => {}, send: () => {} },
      middlewares: { use: () => middlewareCount++ },
      httpServer: null,
    };
    fs.writeFileSync(
      path.join(tmpRepo, 'package.json'),
      JSON.stringify({ name: 'vue-app', dependencies: { vue: '^3.5.0' } }),
      'utf-8'
    );
    (plugin.configureServer as Function)(fakeServer);
    // /__oumv/rpc (and its two legacy aliases) plus the SSE/WS paths.
    expect(middlewareCount).toBeGreaterThan(0);
    const html = (plugin.transformIndexHtml as Function)('<html><body><div id="app"></div></body></html>');
    expect(html.tags[0].attrs.src).toBe('/@oumv/vue-bridge.js');
  });

  it('deduplicates multiple tokensafeReact plugin instances cleanly', () => {
    const p1 = tokensafeReact();
    const p2 = tokensafeReact();

    const firstTransform = (p1.transformIndexHtml as Function)('<html><body><div id="root"></div></body></html>');
    expect(firstTransform).toMatchObject({ tags: expect.any(Array) });

    const secondTransform = (p2.transformIndexHtml as Function)(
      '<html><body><div id="root"></div><script type="module" src="/@oumv/react-bridge.js"></script></body></html>'
    );
    expect(typeof secondTransform).toBe('string');

    let middlewareCount = 0;
    const fakeServer: any = {
      config: { root: tmpRepo, server: { port: 5173 } },
      ws: { on: () => {}, send: () => {} },
      middlewares: {
        use: () => {
          middlewareCount++;
        },
      },
    };
    (p1.configureServer as Function)(fakeServer);
    const countAfterFirst = middlewareCount;
    // Three RPC aliases (HTTP POST) + three SSE aliases (§2.3); WS is an upgrade listener.
    expect(countAfterFirst).toBe(6);

    (p2.configureServer as Function)(fakeServer);
    expect(middlewareCount).toBe(countAfterFirst);
  });
});
