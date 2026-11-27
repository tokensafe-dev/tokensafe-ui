#!/usr/bin/env node
/**
 * Captures golden wire examples for the frontend profile from the real React
 * controller (offline: no Vite server, no browser — the same mode the headless
 * certification adapter uses).
 *
 *   node packages/vite/scripts/capture-wire-examples.mjs \
 *     --root packages/benchmark/sandboxes/react-task-manager \
 *     --out ../agent-oumv/examples/wire/frontend
 *
 * The output is the human-readable counterpart of agent-oumv's schemas: every
 * captured result is validated against the method schema in that repo's suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createReactOumvController } from '../dist/index.js';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const rootDir = path.resolve(arg('--root', process.cwd()));
const outDir = path.resolve(arg('--out', 'examples/wire/frontend'));

const controller = createReactOumvController({ rootDir });
fs.mkdirSync(outDir, { recursive: true });

const files = new Map();
let seq = 0;

async function capture(method, name, params) {
  const request = { jsonrpc: '2.0', id: `${method}:${name}`, method, params };
  const out = await controller.handleRpcPayload(request);
  if (!files.has(method)) {
    files.set(method, {
      method,
      profile: 'frontend',
      specVersion: '1.3.0',
      adapter: 'frontend/react',
      note: 'captured from the React/Vite controller without a browser tab; verify answers -32008 and L4 has no traces, which is the honest offline shape',
      cases: [],
    });
  }
  files.get(method).cases.push({ name, request, response: out.body });
  seq += 1;
}

await capture('oumv/handshake', 'negotiates capabilities', {
  protocolVersion: '1.3.0',
  clientInfo: { name: 'oumv-examples', version: '1.0.0' },
});
await capture('oumv/handshake', 'narrows requested observe levels', {
  protocolVersion: '1.3.0',
  requestedCapabilities: { observe: { levels: ['L0', 'L1'] } },
});
await capture('oumv/observe', 'L0 pulse (yaml)', { level: 'L0' });
await capture('oumv/observe', 'L0 pulse (json)', { level: 'L0', format: 'json' });
await capture('oumv/observe', 'L1 surface (json)', { level: 'L1', format: 'json' });
await capture('oumv/observe', 'L2 component contract', { level: 'L2', target: 'TaskManager', format: 'json' });
await capture('oumv/observe', 'L3 component source', { level: 'L3', target: 'src/TaskManager.tsx', format: 'json' });
await capture('oumv/observe', 'L4 traces without a browser', { level: 'L4', format: 'json' });
await capture('oumv/understand', 'impact from the static graph', { query: 'impact', target: 'TaskManager' });
await capture('oumv/getSource', 'component source with OCC token', { path: 'src/store.ts' });
await capture('oumv/verify', 'browser-only verification, no tab', {
  target: 'component:TaskManager',
  action: 'conformance-probe',
});

for (const [method, file] of files) {
  const name = {
    'oumv/handshake': 'handshake.json',
    'oumv/observe': 'observe.json',
    'oumv/understand': 'understand.json',
    'oumv/getSource': 'getSource.json',
    'oumv/applyEdit': 'applyEdit.json',
    'oumv/verify': 'verify.json',
  }[method];
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(file, null, 2) + '\n', 'utf-8');
  console.log(`${method}: ${file.cases.length} case(s) → ${name}`);
}
console.log(`\n${seq} case(s) written to ${outDir}`);
