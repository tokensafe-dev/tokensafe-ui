#!/usr/bin/env node
/**
 * Headless OUMV adapter for the React/Vite controller (spec §2.5).
 *
 * `tokensafe dev` is the normal way to expose a React app, but certification must
 * not depend on a browser being open. This entry point serves the same controller
 * over newline-delimited JSON-RPC on stdio, so `oumv-certify --stdio` can run the
 * fixtures against the real adapter:
 *
 *   node packages/vite/scripts/oumv-stdio.mjs --root ./my-app
 *
 * With no Vite server attached the controller reports browserConnected=false and
 * answers L0-L3 from the static AST — L4 traces stay empty on purpose.
 */
import readline from 'node:readline';
import path from 'node:path';
import { createReactOumvController } from '../dist/index.js';

const rootFlag = process.argv.indexOf('--root');
const rootDir = path.resolve(rootFlag > -1 ? process.argv[rootFlag + 1] : process.cwd());

const controller = createReactOumvController({ rootDir });

const write = (body) => {
  if (body !== undefined && body !== null) process.stdout.write(JSON.stringify(body) + '\n');
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  void (async () => {
    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (err) {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${err.message}` } });
      return;
    }
    const isNotification =
      !Array.isArray(payload) && payload && typeof payload === 'object' && payload.id === undefined;
    const out = await controller.handleRpcPayload(payload);
    if (isNotification && !out.body?.error) return;
    write(out.body);
  })();
});
