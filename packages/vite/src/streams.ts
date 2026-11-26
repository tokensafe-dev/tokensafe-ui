/**
 * Streaming OUMV transports for the Vite dev server (spec §2.3 SSE, §2.4 WS).
 *
 * Both bindings are optional and must be advertised; they are attached to the
 * same HTTP server as the POST /__oumv/rpc endpoint. The WebSocket server is a
 * minimal RFC 6455 implementation (handshake + text frames + ping/pong) so the
 * plugin keeps its dependency surface unchanged — `ws` would be resolved to its
 * browser shim by the workspace's `browser` export conditions.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { createHash } from 'node:crypto';
import type { OumvStreamTrace } from '@tokensafe-ui/oumv/contracts';

/** Minimal `http.Server` surface needed for the WS upgrade listener. */
export interface UpgradeHost {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex) => void): unknown;
  off(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex) => void): unknown;
}

export interface StreamTransportOptions {
  /** `ViteDevServer.middlewares` of the dev server. */
  middlewares: { use: (route: string, handler: (req: any, res: any, next?: () => void) => void) => void };
  /** `ViteDevServer.httpServer` (upgrade listener target). */
  httpServer: UpgradeHost | null | undefined;
  /** SSE routes, canonical first. */
  ssePaths: string[];
  /** WebSocket routes, canonical first. */
  wsPaths: string[];
  /** True when the request may use the runtime (same token check as HTTP). */
  authorize: (req: IncomingMessage) => boolean;
  /** Traces newer than the cursor (monotonic `seq`). */
  getTracesSince: (seq: number) => OumvStreamTrace[];
  /** Same dispatcher as POST /__oumv/rpc. */
  handleRpcPayload: (payload: any) => Promise<{ statusCode: number; body: any }>;
  heartbeatMs?: number;
  pollMs?: number;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(text: string, opcode = 0x1): Buffer {
  const payload = Buffer.from(text, 'utf-8');
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  size: number;
}

function decodeFrame(buffer: Buffer): Frame | null {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  let payload = buffer.subarray(offset, offset + length);
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  }
  return { fin, opcode, payload, size: offset + length };
}

class WebSocketPeer {
  private buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  sessionId = '';
  closed = false;

  constructor(
    private socket: Duplex,
    private onMessage: (peer: WebSocketPeer, text: string) => void
  ) {
    socket.on('data', (chunk: Buffer) => this.feed(chunk));
    socket.on('close', () => {
      this.closed = true;
    });
    socket.on('error', () => {
      this.closed = true;
    });
  }

  send(text: string): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(text));
    } catch {
      this.closed = true;
    }
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    try {
      const body = Buffer.alloc(2 + Buffer.byteLength(reason));
      body.writeUInt16BE(code, 0);
      body.write(reason, 2);
      this.socket.write(Buffer.concat([Buffer.from([0x88, body.length]), body]));
    } catch {}
    this.socket.end();
  }

  private feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = decodeFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.size);
      if (frame.opcode === 0x8) {
        this.close(1000);
        return;
      }
      if (frame.opcode === 0x9) {
        try {
          this.socket.write(encodeFrame(frame.payload.toString('utf-8'), 0xa));
        } catch {}
        continue;
      }
      if (frame.opcode === 0xa) continue;
      if (frame.opcode === 0x0 || frame.opcode === 0x1 || frame.opcode === 0x2) {
        this.fragments.push(frame.payload);
        if (!frame.fin) continue;
        const text = Buffer.concat(this.fragments).toString('utf-8');
        this.fragments = [];
        this.onMessage(this, text);
        continue;
      }
      this.close(1002, 'unsupported opcode');
      return;
    }
  }
}

/**
 * Attaches `GET /__oumv/events` (SSE) and WS upgrade handling for
 * `/__oumv/rpc` to the dev server. Returns an unsubscribe function.
 */
export function attachStreamTransports(options: StreamTransportOptions): () => void {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const pollMs = options.pollMs ?? 300;
  const peers: WebSocketPeer[] = [];
  const cursors = new Map<WebSocketPeer, number>();

  const sseHandler = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'SSE requires GET' }));
      return;
    }
    if (!options.authorize(req)) {
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

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const lastEventId = String(req.headers['last-event-id'] ?? '');
    let cursor = Number.parseInt(lastEventId, 10);
    if (!Number.isFinite(cursor)) cursor = 0;

    const flush = () => {
      for (const trace of options.getTracesSince(cursor)) {
        res.write(`id: ${trace.seq}\nevent: trace\ndata: ${JSON.stringify(trace)}\n\n`);
        cursor = trace.seq;
      }
    };
    flush();

    const poll = setInterval(flush, pollMs);
    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${JSON.stringify(new Date().toISOString())}\n\n`);
    }, heartbeatMs);

    const stop = () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      res.end();
    };
    req.on('close', stop);
  };

  for (const route of options.ssePaths) {
    options.middlewares.use(route, sseHandler);
  }

  const handleUpgrade = (req: IncomingMessage, socket: Duplex) => {
    const pathname = String(req.url || '').split('?')[0];
    if (!options.wsPaths.includes(pathname)) return; // Vite HMR owns the rest.
    if (!options.authorize(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    ];
    if (String(req.headers['sec-websocket-protocol'] ?? '').trim()) {
      headers.push(`Sec-WebSocket-Protocol: ${String(req.headers['sec-websocket-protocol']).split(',')[0].trim()}`);
    }
    socket.write(headers.join('\r\n') + '\r\n\r\n');

    const peer = new WebSocketPeer(socket, (self, text) => {
      void handleFrame(self, text);
    });
    peers.push(peer);
    socket.on('close', () => {
      const index = peers.indexOf(peer);
      if (index >= 0) peers.splice(index, 1);
      cursors.delete(peer);
      // Spec §2.4: closing the socket ends the session bound to it.
      if (peer.sessionId) {
        void options.handleRpcPayload({
          jsonrpc: '2.0',
          id: 0,
          method: 'oumv/disconnect',
          params: { sessionId: peer.sessionId },
        });
      }
    });
  };

  const handleFrame = async (peer: WebSocketPeer, text: string) => {
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch (err: any) {
      peer.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` },
        })
      );
      return;
    }

    const isNotification =
      !Array.isArray(payload) && payload && typeof payload === 'object' && payload.id === undefined;
    const out = await options.handleRpcPayload(payload);
    if (isNotification && !out.body?.error) return;
    if (out.body !== undefined && out.body !== null) peer.send(JSON.stringify(out.body));
    if (!Array.isArray(payload) && payload?.method === 'oumv/handshake' && out.body?.result?.sessionId) {
      peer.sessionId = String(out.body.result.sessionId);
    }
  };

  if (options.httpServer) {
    options.httpServer.on('upgrade', handleUpgrade);
  }

  // Push new traces to handshaken WS peers as `notifications/oumv.trace`.
  const notify = setInterval(() => {
    if (peers.length === 0) return;
    for (const peer of peers) {
      if (!peer.sessionId || peer.closed) continue;
      const cursor = cursors.get(peer) ?? 0;
      for (const trace of options.getTracesSince(cursor)) {
        peer.notify('notifications/oumv.trace', { sessionId: peer.sessionId, trace });
        cursors.set(peer, trace.seq);
      }
    }
  }, pollMs);

  return () => {
    clearInterval(notify);
    for (const peer of peers) peer.close();
    if (options.httpServer) options.httpServer.off('upgrade', handleUpgrade);
  };
}
