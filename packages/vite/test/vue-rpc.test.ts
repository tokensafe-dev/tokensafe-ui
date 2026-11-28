import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  resolveFrameworkMode,
  tokensafeUi,
  createVueOumvController,
  getVueBridgeClientCode,
  VUE_BRIDGE_PUBLIC_PATH,
} from '../src/index.js';

const sha = (text: string) => 'sha256:' + crypto.createHash('sha256').update(text, 'utf-8').digest('hex');

interface FakeServer {
  handlers: Map<string, (data: any) => void>;
  sent: Array<{ event: string; data: any }>;
  ws: {
    on: (event: string, handler: (data: any) => void) => void;
    send: (event: string, data: any) => void;
  };
  emit: (event: string, data: any) => void;
}

function makeFakeServer(): FakeServer {
  const handlers = new Map<string, (data: any) => void>();
  const sent: Array<{ event: string; data: any }> = [];
  return {
    handlers,
    sent,
    ws: {
      on: (event, handler) => {
        handlers.set(event, handler);
      },
      send: (event, data) => {
        sent.push({ event, data });
      },
    },
    emit: (event, data) => {
      handlers.get(event)?.(data);
    },
  };
}

const appVue = `<template>
  <main>
    <h1>OUMV Vue certification app</h1>
    <button data-agent-id="probe-btn" @click="bump">Probe {{ probes }}</button>
  </main>
</template>

<script setup>
import { ref } from 'vue';
const probes = ref(0);
function bump() {
  probes.value += 1;
}
</script>
`;

describe('@tokensafe-ui/vite - Vue OUMV support (wire 1.6.0)', () => {

  it('applies a multi-file batch atomically (wire 1.4.0 mutate.multiFile)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-vue-batch-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'App.vue'), '<template><main /></template>\n', 'utf-8');
      fs.writeFileSync(path.join(tmp, 'src', 'Extra.vue'), '<template><span /></template>\n', 'utf-8');
      const appVersion = sha(fs.readFileSync(path.join(tmp, 'src', 'App.vue'), 'utf-8'));

      const controller = createVueOumvController({ rootDir: tmp, server: makeFakeServer() as any });
      const applied = await controller.handleRpcPayload({
        id: 'batch',
        method: 'oumv/applyEdit',
        params: {
          edits: [
            { path: 'src/App.vue', mode: 'replace', expectedVersion: appVersion, replacement: '<template><div /></template>\n' },
            { path: 'src/New.vue', mode: 'create', replacement: '<template><b /></template>\n' },
          ],
        },
      });
      expect(applied.body.result?.status).toBe('APPLIED');
      expect(applied.body.result?.edits).toHaveLength(2);
      expect(fs.existsSync(path.join(tmp, 'src', 'New.vue'))).toBe(true);

      // A stale version on the second item must leave the first file untouched.
      const before = fs.readFileSync(path.join(tmp, 'src', 'App.vue'), 'utf-8');
      const refused = await controller.handleRpcPayload({
        id: 'batch-atomic',
        method: 'oumv/applyEdit',
        params: {
          edits: [
            { path: 'src/App.vue', mode: 'replace', expectedVersion: sha(before), replacement: '<template><p /></template>\n' },
            { path: 'src/Extra.vue', mode: 'replace', expectedVersion: 'sha256:' + '0'.repeat(64), replacement: '<template><i /></template>\n' },
          ],
        },
      });
      expect(refused.body.error?.code).toBe(-32001);
      expect(refused.body.error?.data?.editIndex).toBe(1);
      expect(fs.readFileSync(path.join(tmp, 'src', 'App.vue'), 'utf-8')).toBe(before);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-vite-vue-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'sample-vue-app', dependencies: { vue: '^3.5.13' }, devDependencies: { vite: '^6.0.7' } }),
      'utf-8'
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'App.vue'), appVue, 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'ProbeCard.vue'),
      '<template>\n  <section data-agent-id="probe-card">Probe</section>\n</template>\n\n<script setup>\nconst label = "probe";\n</script>\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'main.js'),
      `import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n`,
      'utf-8'
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'EditTarget.js'), 'export const value = 42;\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-detects Vue mode and injects the Vue bridge instead of the native runtime', () => {
    expect(resolveFrameworkMode(tmpDir, 'auto')).toBe('vue');
    const plugin = tokensafeUi();
    (plugin as any).configResolved({ command: 'serve', root: tmpDir });
    const html = (plugin as any).transformIndexHtml('<html><body></body></html>');
    expect(html.tags[0].attrs.src).toBe(VUE_BRIDGE_PUBLIC_PATH);
    expect(getVueBridgeClientCode()).toContain('__OUMV_VUE_BRIDGE_INSTALLED__');
  });

  it('answers handshake, sessions and observe with the canonical envelope', async () => {
    const server = makeFakeServer();
    const controller = createVueOumvController({ rootDir: tmpDir, server: server as any });

    const handshake = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 1,
      method: 'oumv/handshake',
      params: { protocolVersion: '1.0.0' },
    });
    const result = handshake.body.result;
    expect(result.protocolVersion).toBe('1.6.0');
    expect(result.profile).toBe('frontend');
    expect(result.sessionId).toMatch(/^sess-/);
    expect(result.capabilities.observe.levels).toContain('L3');

    const sessionExpired = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 2,
      method: 'oumv/observe',
      params: { level: 'L1', sessionId: 'sess-unknown' },
    });
    expect(sessionExpired.body.error.code).toBe(-32011);

    const unknownVersion = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 3,
      method: 'oumv/handshake',
      params: { protocolVersion: '9.9.9' },
    });
    expect(unknownVersion.body.error.code).toBe(-32006);

    const l0 = await controller.handleRpcPayload({ jsonrpc: '2.0', id: 4, method: 'oumv/observe', params: { level: 'L0' } });
    expect(l0.body.result.level).toBe('L0');
    expect(l0.body.result.data.framework).toBe('vue');
    expect(l0.body.result.data.staticComponentsCount).toBeGreaterThan(0);

    const l1 = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 5,
      method: 'oumv/observe',
      params: { level: 'L1', limit: 1 },
    });
    expect(l1.body.result.level).toBe('L1');
    expect(l1.body.result.data.hasMore).toBe(true);
    expect(l1.body.result.data.items.length).toBe(1);

    const l2 = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 6,
      method: 'oumv/observe',
      params: { level: 'L2', target: 'App' },
    });
    expect(l2.body.result.data.target).toBe('App');
    expect(l2.body.result.evidence).toBeTruthy();

    const l3 = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 7,
      method: 'oumv/observe',
      params: { level: 'L3', target: 'src/App.vue' },
    });
    expect(l3.body.result.data.path).toBe('src/App.vue');
    expect(l3.body.result.data.version).toBe(sha(appVue));
    expect(l3.body.result.data.endLine).toBe(appVue.split('\n').length);

    const unknownLevel = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 8,
      method: 'oumv/observe',
      params: { level: 'L9' },
    });
    expect(unknownLevel.body.error.code).toBe(-32006);
  });

  it('serves getSource windows/dedup and understand impact from the static index', async () => {
    const server = makeFakeServer();
    const controller = createVueOumvController({ rootDir: tmpDir, server: server as any });

    const full = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 1,
      method: 'oumv/getSource',
      params: { path: 'src/App.vue' },
    });
    expect(full.body.result.version).toBe(sha(appVue));

    const unchanged = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 2,
      method: 'oumv/getSource',
      params: { path: 'src/App.vue', ifVersion: full.body.result.version },
    });
    expect(unchanged.body.result.unchanged).toBe(true);
    expect(unchanged.body.result.source).toBeUndefined();

    const windowed = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 3,
      method: 'oumv/getSource',
      params: { path: 'src/App.vue', startLine: 1, endLine: 3 },
    });
    expect(windowed.body.result.startLine).toBe(1);
    expect(windowed.body.result.endLine).toBe(3);

    const unknownSymbol = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 4,
      method: 'oumv/getSource',
      params: { path: 'src/App.vue', symbol: 'NoSuchSymbol' },
    });
    expect(unknownSymbol.body.error.code).toBe(-32009);

    const impact = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 5,
      method: 'oumv/understand',
      params: { query: 'impact', target: 'App' },
    });
    expect(impact.body.result.query).toBe('impact');
    expect(impact.body.result.impact.affectedSymbols.some((s: any) => s.file === 'src/main.js')).toBe(true);
  });

  it('enforces guards and returns a scoped retry on a non-unique patch target', async () => {
    const server = makeFakeServer();
    const controller = createVueOumvController({ rootDir: tmpDir, server: server as any });

    const traversal = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 1,
      method: 'oumv/applyEdit',
      params: { path: '../outside.js', replacement: 'x', expectedVersion: sha('x') },
    });
    expect(traversal.body.error.code).toBe(-32003);

    const missing = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 2,
      method: 'oumv/applyEdit',
      params: { path: 'src/Missing.js', replacement: 'x', expectedVersion: sha('x') },
    });
    expect(missing.body.error.code).toBe(-32009);

    const noVersion = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 3,
      method: 'oumv/applyEdit',
      params: { path: 'src/EditTarget.js', replacement: 'export const value = 43;\n' },
    });
    expect(noVersion.body.error.code).toBe(-32011);

    const broken = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 4,
      method: 'oumv/applyEdit',
      params: {
        path: 'src/EditTarget.js',
        replacement: 'export function Broken( {',
        expectedVersion: sha('export const value = 42;\n'),
      },
    });
    expect(broken.body.error.code).toBe(-32002);

    const unknownMode = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 5,
      method: 'oumv/applyEdit',
      params: { path: 'src/EditTarget.js', replacement: 'x', expectedVersion: sha('export const value = 42;\n'), mode: 'splice' },
    });
    expect(unknownMode.body.error.code).toBe(-32006);

    const duplicateSource =
      'export function one() {\n  return value();\n}\nexport function two() {\n  return value();\n}\n';
    fs.writeFileSync(path.join(tmpDir, 'src', 'Duplicate.js'), duplicateSource, 'utf-8');
    const duplicate = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 6,
      method: 'oumv/applyEdit',
      params: {
        path: 'src/Duplicate.js',
        mode: 'patch',
        expectedVersion: sha(duplicateSource),
        hunks: [{ target: 'return value();', replacement: 'return other();' }],
      },
    });
    expect(duplicate.body.error.code).toBe(-32011);
    expect(duplicate.body.error.data.reason).toBe('target_not_unique');
    expect(duplicate.body.error.data.lines).toEqual([2, 5]);
    expect(duplicate.body.error.data.suggestedHunks.length).toBe(2);
    expect(fs.readFileSync(path.join(tmpDir, 'src', 'Duplicate.js'), 'utf-8')).toBe(duplicateSource);

    const scoped = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 7,
      method: 'oumv/applyEdit',
      params: {
        path: 'src/Duplicate.js',
        mode: 'patch',
        expectedVersion: sha(duplicateSource),
        hunks: [{ target: 'return value();', replacement: 'return other();', startLine: 5, endLine: 5 }],
      },
    });
    expect(scoped.body.result.status).toBe('APPLIED');
    expect(scoped.body.result.hunksApplied).toBe(1);
    expect(fs.readFileSync(path.join(tmpDir, 'src', 'Duplicate.js'), 'utf-8')).toBe(
      'export function one() {\n  return value();\n}\nexport function two() {\n  return other();\n}\n'
    );
  });

  it('verifies through the browser bridge and refuses to pretend without a tab', async () => {
    const server = makeFakeServer();
    const controller = createVueOumvController({ rootDir: tmpDir, server: server as any });

    const offline = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 1,
      method: 'oumv/verify',
      params: { target: 'certificationProbe', action: 'conformance-probe' },
    });
    expect(offline.body.error.code).toBe(-32008);

    server.emit('oumv:vue-snapshot', {
      framework: 'vue',
      route: '/',
      elementCount: 4,
      mountedComponents: [{ id: 'frontend.component:App', name: 'App', instances: 1, propsKeys: [], stateKeys: [] }],
      interactiveSurface: [],
      registeredStores: { certificationProbe: { state: { probes: 0 }, actions: ['conformance-probe'] } },
      timestamp: Date.now(),
    });
    server.ws.send = (event, data) => {
      server.sent.push({ event, data });
      if (event === 'oumv:vue-verify') {
        server.emit('oumv:vue-verify-res', {
          requestId: data.requestId,
          status: 'passed',
          target: data.target,
          action: data.action,
          diff: { probes: { before: 0, after: 1 } },
          surfaceDiff: [],
          durationMs: 3,
          latency: { actionMs: 1, totalMs: 3 },
        });
      }
    };

    const verify = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 2,
      method: 'oumv/verify',
      params: { target: 'certificationProbe', action: 'conformance-probe' },
    });
    expect(verify.body.result.status).toBe('passed');
    expect(verify.body.result.timings.t_total_ms).toBeGreaterThanOrEqual(0);
    expect(verify.body.result.scope.checked).toContain('certificationProbe:conformance-probe');

    const multi = await controller.handleRpcPayload({
      jsonrpc: '2.0',
      id: 3,
      method: 'oumv/verify',
      params: {
        target: 'certificationProbe',
        steps: [
          { target: 'certificationProbe', action: 'conformance-probe' },
          { target: 'certificationProbe', action: 'conformance-probe' },
        ],
      },
    });
    expect(multi.body.result.steps.length).toBe(2);

    const l4 = await controller.handleRpcPayload({ jsonrpc: '2.0', id: 4, method: 'oumv/observe', params: { level: 'L4' } });
    expect(Array.isArray(l4.body.result.data.traces)).toBe(true);
  });

  it('answers batch payloads with one response per request', async () => {
    const server = makeFakeServer();
    const controller = createVueOumvController({ rootDir: tmpDir, server: server as any });
    const batch = await controller.handleRpcPayload([
      { jsonrpc: '2.0', id: 'a', method: 'oumv/observe', params: { level: 'L0' } },
      { jsonrpc: '2.0', id: 'b', method: 'oumv/nonexistentMethod', params: {} },
    ]);
    expect(Array.isArray(batch.body)).toBe(true);
    expect(batch.body[0].result.level).toBe('L0');
    expect(batch.body[1].error.code).toBe(-32601);
  });
});
