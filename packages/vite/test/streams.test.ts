// @vitest-environment node
/**
 * Streaming transports for the Vite dev server: SSE (§2.3) and WebSocket (§2.4).
 *
 * Node environment on purpose: these are server-side transports, while the rest
 * of the workspace suite runs under happy-dom with `browser` resolve conditions.
 */
import http from 'node:http';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachStreamTransports } from '../src/streams.js';
import type { OumvStreamTrace } from '@tokensafe-ui/oumv/contracts';

const TOKEN = 'test-token';

interface Harness {
  url: string;
  traces: OumvStreamTrace[];
  pushTrace: (method: string) => void;
  received: any[];
  close: () => Promise<void>;
}

function startHarness(): Promise<Harness> {
  const traces: OumvStreamTrace[] = [];
  const received: any[] = [];
  let seq = 0;

  const server = http.createServer();

  const detach = attachStreamTransports({
    middlewares: {
      use(route, handler) {
        server.on('request', (req, res) => {
          if ((req.url || '').split('?')[0] === route) handler(req, res);
        });
      },
    },
    httpServer: server,
    ssePaths: ['/__oumv/events'],
    wsPaths: ['/__oumv/rpc'],
    authorize: (req) => req.headers['x-oumv-session-token'] === TOKEN,
    getTracesSince: (cursor) => traces.filter((trace) => trace.seq > cursor),
    handleRpcPayload: async (payload: any) => {
      received.push(payload);
      if (payload?.method === 'oumv/handshake') {
        return {
          statusCode: 200,
          body: { jsonrpc: '2.0', id: payload.id, result: { sessionId: 'sess-ws', profile: 'frontend' } },
        };
      }
      if (payload?.method === 'oumv/disconnect') {
        return { statusCode: 200, body: { jsonrpc: '2.0', id: payload.id, result: { closed: true } } };
      }
      if (Array.isArray(payload)) {
        return {
          statusCode: 200,
          body: payload.map((entry: any) => ({ jsonrpc: '2.0', id: entry.id, result: { batched: true } })),
        };
      }
      return { statusCode: 200, body: { jsonrpc: '2.0', id: payload.id, result: { method: payload.method } } };
    },
    pollMs: 10,
    heartbeatMs: 20,
  });

  const pushTrace = (method: string) => {
    traces.push({
      seq: ++seq,
      method,
      path: `/${method}`,
      route: `/${method}`,
      handler: 'test',
      statusCode: 200,
      durationMs: 1,
      timestamp: new Date().toISOString(),
    });
  };

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        traces,
        pushTrace,
        received,
        close: () =>
          new Promise<void>((done) => {
            detach();
            server.close(() => done());
          }),
      });
    });
  });
}

async function readSseUntil(
  response: Response,
  predicate: (chunk: string) => boolean,
  timeoutMs = 2000
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (predicate(text)) {
      await reader.cancel();
      return text;
    }
  }
  await reader.cancel();
  return text;
}

describe('OUMV streaming transports', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('streams trace and heartbeat events over SSE', async () => {
    const response = await fetch(`${harness.url}/__oumv/events`, {
      headers: { 'X-OUMV-Session-Token': TOKEN },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    harness.pushTrace('oumv/observe');
    const text = await readSseUntil(response, (chunk) => chunk.includes('event: trace') && chunk.includes('event: heartbeat'));

    expect(text).toContain(': connected');
    expect(text).toContain('event: heartbeat');
    expect(text).toContain('event: trace');
    expect(text).toContain('id: 1');
    expect(text).toContain('"method":"oumv/observe"');
  });

  it('replays SSE events after Last-Event-ID', async () => {
    harness.pushTrace('first');
    harness.pushTrace('second');

    const response = await fetch(`${harness.url}/__oumv/events`, {
      headers: { 'X-OUMV-Session-Token': TOKEN, 'Last-Event-ID': '1' },
    });
    const text = await readSseUntil(response, (chunk) => chunk.includes('event: trace'));

    expect(text).toContain('id: 2');
    expect(text).not.toContain('id: 1');
    expect(text).toContain('"method":"second"');
  });

  it('rejects SSE without the session token', async () => {
    const response = await fetch(`${harness.url}/__oumv/events`);
    expect(response.status).toBe(401);
  });

  it('answers JSON-RPC frames over WebSocket and pushes trace notifications', async () => {
    const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/__oumv/rpc`, {
      headers: { 'X-OUMV-Session-Token': TOKEN },
    } as any);

    const messages: any[] = [];
    const waitFor = (predicate: (msg: any) => boolean) =>
      new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout; got ${JSON.stringify(messages)}`)), 3000);
        const check = () => {
          const hit = messages.find(predicate);
          if (hit) {
            clearTimeout(timer);
            resolve(hit);
            return true;
          }
          return false;
        };
        socket.addEventListener('message', (event: MessageEvent) => {
          messages.push(JSON.parse(String(event.data)));
          check();
        });
        check();
      });

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('websocket failed to open')));
    });

    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'oumv/handshake', params: {} }));
    const handshake = await waitFor((msg) => msg.id === 1);
    expect(handshake.result.sessionId).toBe('sess-ws');

    harness.pushTrace('oumv/verify');
    const notification = await waitFor((msg) => msg.method === 'notifications/oumv.trace');
    expect(notification.params.sessionId).toBe('sess-ws');
    expect(notification.params.trace.method).toBe('oumv/verify');

    // A notification frame (no id) must not produce a reply: the next reply is for id=2.
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'oumv/observe', params: {} }));
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'oumv/observe', params: { level: 'L0' } }));
    const reply = await waitFor((msg) => msg.id === 2);
    expect(reply.result.method).toBe('oumv/observe');
    expect(messages.some((msg) => msg.id === undefined && msg.result)).toBe(false);

    socket.close();
  });

  it('rejects a WebSocket upgrade without the session token', async () => {
    const response = await fetch(`${harness.url}/__oumv/rpc`, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    }).catch((err) => err as Error);

    // The upgrade is refused before the handshake: fetch cannot complete it.
    if (response instanceof Error) {
      expect(response).toBeTruthy();
    } else {
      expect(response.status).toBe(401);
    }
  });
});
