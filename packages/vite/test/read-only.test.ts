import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  createReactOumvController,
  createVueOumvController,
  tokensafeReact,
} from '../src/index.js';

// §8.5 read-only deployment: these methods are absent from the RPC registry.
const ABSENT_METHODS = [
  'oumv/applyEdit',
  'oumv/previewEdit',
  'oumv/verify',
  'oumv/build',
  'oumv/mutate',
] as const;

const sha = (text: string) => 'sha256:' + createHash('sha256').update(text, 'utf-8').digest('hex');

function callMiddleware(
  handler: (req: any, res: any) => void,
  token: string | undefined,
  body: unknown
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve) => {
    const listeners = new Map<string, (chunk?: any) => void>();
    const req: any = {
      method: 'POST',
      headers: token ? { 'x-oumv-session-token': token } : {},
      on: (event: string, cb: (chunk?: any) => void) => {
        listeners.set(event, cb);
      },
    };
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(chunk?: string) {
        resolve({ statusCode: res.statusCode, body: chunk ? JSON.parse(chunk) : undefined });
      },
    };
    handler(req, res);
    setImmediate(() => {
      listeners.get('data')?.(JSON.stringify(body));
      listeners.get('end')?.();
    });
  });
}

describe('OUMV §8.5 read-only deployment', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-read-only-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'read-only-app',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', vue: '^3.5.0' },
      }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'App.tsx'),
      'export default function App() { return <main>ready</main>; }\n',
      'utf-8'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('React: answers -32601 for every mutating method, including with a stale session token', async () => {
    const controller = createReactOumvController({ rootDir: tmpDir, readOnly: true });

    for (const method of ABSENT_METHODS) {
      const bare = await controller.handleRpcPayload({ id: method, method, params: {} });
      expect(bare.body.error?.code).toBe(-32601);
      expect(bare.body.error?.code).not.toBe(-32007);

      // The registry check runs before session validation: a dead sessionId
      // must not turn absence into -32011.
      const stale = await controller.handleRpcPayload({
        id: `${method}:stale`,
        method,
        params: {
          sessionId: 'sess-dead',
          path: 'src/App.tsx',
          mode: 'replace',
          replacement: 'export default 0;\n',
          target: 'App',
          action: 'click',
        },
      });
      expect(stale.body.error?.code).toBe(-32601);
      expect(stale.body.error?.code).not.toBe(-32011);
    }

    // Control: the same stale session in the default read-write profile still
    // reports the session error, so the -32601 above is the absence check.
    const readWrite = createReactOumvController({ rootDir: tmpDir });
    const staleReadWrite = await readWrite.handleRpcPayload({
      id: 'rw-stale',
      method: 'oumv/applyEdit',
      params: { sessionId: 'sess-dead', path: 'src/App.tsx', mode: 'replace', replacement: 'x' },
    });
    expect(staleReadWrite.body.error?.code).toBe(-32011);
  });

  it('React: handshake advertises readOnly and omits mutate/verify while reads still work', async () => {
    const controller = createReactOumvController({ rootDir: tmpDir, readOnly: true });

    const hs = await controller.handleRpcPayload({ id: 1, method: 'oumv/handshake' });
    expect(hs.body.error).toBeUndefined();
    expect(hs.body.result.protocolVersion).toBe('1.6.0');
    expect(hs.body.result.profile).toBe('frontend');
    expect(hs.body.result.capabilities.readOnly).toBe(true);
    expect(hs.body.result.capabilities.mutate).toBeUndefined();
    expect(hs.body.result.capabilities.verify).toBeUndefined();
    expect(hs.body.result.capabilities.observe.levels).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
    expect(hs.body.result.capabilities.index.symbols).toBe(true);
    expect(hs.body.result.capabilities.sessions.cancel).toBe(true);

    const sessionId = hs.body.result.sessionId;

    const l0 = await controller.handleRpcPayload({ id: 2, method: 'oumv/observe', params: { level: 'L0' } });
    expect(l0.body.error).toBeUndefined();
    expect(l0.body.result.level).toBe('L0');

    const l1 = await controller.handleRpcPayload({ id: 3, method: 'oumv/observe', params: { level: 'L1' } });
    expect(l1.body.error).toBeUndefined();
    expect(l1.body.result.data.components.some((c: any) => c.name === 'App')).toBe(true);

    const index = await controller.handleRpcPayload({ id: 4, method: 'oumv/index', params: { query: 'App' } });
    expect(index.body.error).toBeUndefined();

    const understand = await controller.handleRpcPayload({ id: 5, method: 'oumv/understand', params: { query: 'App' } });
    expect(understand.body.error).toBeUndefined();

    const source = await controller.handleRpcPayload({
      id: 6,
      method: 'oumv/getSource',
      params: { path: 'src/App.tsx' },
    });
    expect(source.body.error).toBeUndefined();

    const cancel = await controller.handleRpcPayload({ id: 7, method: 'oumv/cancel', params: { requestId: 'nope' } });
    expect(cancel.body.error).toBeUndefined();

    const disconnect = await controller.handleRpcPayload({
      id: 8,
      method: 'oumv/disconnect',
      params: { sessionId },
    });
    expect(disconnect.body.error).toBeUndefined();
    expect(disconnect.body.result.closed).toBe(true);

    // Absence is per item inside a batch: the write is refused, the read is served.
    const batch = await controller.handleRpcPayload([
      { id: 'b1', method: 'oumv/applyEdit', params: { path: 'src/App.tsx', mode: 'replace', replacement: 'x' } },
      { id: 'b2', method: 'oumv/observe', params: { level: 'L0' } },
    ]);
    expect(batch.body[0].error.code).toBe(-32601);
    expect(batch.body[1].result.level).toBe('L0');
  });

  it('React: the default profile is unchanged (read-write, mutate/verify advertised)', async () => {
    const controller = createReactOumvController({ rootDir: tmpDir });

    const hs = await controller.handleRpcPayload({ id: 1, method: 'oumv/handshake' });
    expect(hs.body.result.capabilities.readOnly).toBeUndefined();
    expect(hs.body.result.capabilities.mutate.occ).toBe(true);
    expect(hs.body.result.capabilities.verify.multiMetric).toBe(true);

    const source = fs.readFileSync(path.join(tmpDir, 'src', 'App.tsx'), 'utf-8');
    const applied = await controller.handleRpcPayload({
      id: 2,
      method: 'oumv/applyEdit',
      params: {
        path: 'src/App.tsx',
        mode: 'replace',
        expectedVersion: sha(source),
        replacement: 'export default function App() { return <main>edited</main>; }\n',
      },
    });
    expect(applied.body.error).toBeUndefined();
    expect(applied.body.result.status).toBe('APPLIED');
  });

  it('Vue: drops the mutating methods, keeps the read surface and advertises readOnly', async () => {
    const controller = createVueOumvController({ rootDir: tmpDir, readOnly: true });

    const hs = await controller.handleRpcPayload({ id: 1, method: 'oumv/handshake' });
    expect(hs.body.result.capabilities.readOnly).toBe(true);
    expect(hs.body.result.capabilities.mutate).toBeUndefined();
    expect(hs.body.result.capabilities.verify).toBeUndefined();

    for (const method of ABSENT_METHODS) {
      const res = await controller.handleRpcPayload({ id: method, method, params: { sessionId: 'sess-dead' } });
      expect(res.body.error?.code).toBe(-32601);
      expect(res.body.error?.code).not.toBe(-32011);
      expect(res.body.error?.code).not.toBe(-32007);
    }

    const l0 = await controller.handleRpcPayload({ id: 2, method: 'oumv/observe', params: { level: 'L0' } });
    expect(l0.body.error).toBeUndefined();
    expect(l0.body.result.level).toBe('L0');

    const index = await controller.handleRpcPayload({ id: 3, method: 'oumv/index', params: { query: 'App' } });
    expect(index.body.error).toBeUndefined();

    const readWrite = createVueOumvController({ rootDir: tmpDir });
    const rwHs = await readWrite.handleRpcPayload({ id: 4, method: 'oumv/handshake' });
    expect(rwHs.body.result.capabilities.readOnly).toBeUndefined();
    expect(rwHs.body.result.capabilities.mutate.occ).toBe(true);
  });

  it('HTTP middleware: absence wins over an invalid session token', async () => {
    const plugin = tokensafeReact({ readOnly: true, sessionToken: 'expected-token', requireAuth: true });
    (plugin as any).configResolved({ command: 'serve', root: tmpDir });
    const handlers = new Map<string, (req: any, res: any) => void>();
    const fakeServer: any = {
      config: { root: tmpDir, server: { port: 5173 } },
      ws: { on: () => {}, send: () => {} },
      middlewares: {
        use: (route: string, handler: (req: any, res: any) => void) => {
          handlers.set(route, handler);
        },
      },
      httpServer: null,
    };
    (plugin.configureServer as Function)(fakeServer);
    const rpcHandler = handlers.get('/__oumv/rpc');
    expect(typeof rpcHandler).toBe('function');

    const refused = await callMiddleware(
      rpcHandler!,
      'stale-token',
      { id: 1, method: 'oumv/applyEdit', params: { path: 'src/App.tsx', mode: 'replace', replacement: 'x' } }
    );
    expect(refused.statusCode).toBe(200);
    expect(refused.body.error.code).toBe(-32601);

    // The read path still enforces the token: absence did not disable auth.
    const unauthorizedRead = await callMiddleware(rpcHandler!, 'stale-token', {
      id: 2,
      method: 'oumv/observe',
      params: { level: 'L0' },
    });
    expect(unauthorizedRead.statusCode).toBe(401);
    expect(unauthorizedRead.body.error.code).toBe(-32007);

    // A valid token sees the same absence answer.
    const authorized = await callMiddleware(rpcHandler!, 'expected-token', {
      id: 3,
      method: 'oumv/applyEdit',
      params: { path: 'src/App.tsx', mode: 'replace', replacement: 'x' },
    });
    expect(authorized.body.error.code).toBe(-32601);
  });
});
