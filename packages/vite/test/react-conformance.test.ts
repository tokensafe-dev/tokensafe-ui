import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createReactOumvController } from '../src/index.js';

const require = createRequire(import.meta.url);

// The fixture suite lives in the sibling agent-oumv workspace; CI without that
// checkout skips the certification cases instead of silently passing them.
const AGENT_OUMV_ROOT = path.resolve(__dirname, '../../../../agent-oumv');
const CONFORMANCE_CJS = path.join(AGENT_OUMV_ROOT, 'packages/conformance/dist/index.cjs');
const SCHEMA_CJS = path.join(AGENT_OUMV_ROOT, 'packages/schema/dist/index.cjs');
const FIXTURES_PATH = path.join(AGENT_OUMV_ROOT, 'fixtures/conformance-cases.json');
const hasSiblingOumv =
  fs.existsSync(CONFORMANCE_CJS) && fs.existsSync(SCHEMA_CJS) && fs.existsSync(FIXTURES_PATH);

const sha = (content: string) => `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;

const EDIT_CONTENT = 'export const edited = true;\n';
const BROKEN_CONTENT = 'export function Broken( {\n';
const SYMBOL_BEFORE = 'export function probe(value) {\n  return 41;\n}\n';
const SYMBOL_AFTER = 'export function probe(value) {\n  return 42;\n}\n';
const DELETE_SOURCE = 'export const deleteMe = true;\n';
const RENAME_SOURCE = 'export const renameMe = true;\n';

function snapshotPayload() {
  return {
    framework: 'react',
    route: '/',
    title: 'Test React App',
    elementCount: 12,
    mountedComponents: [
      { id: 'frontend.component:Counter', name: 'Counter', instances: 1, propsKeys: [], hooksCount: 1 },
    ],
    interactiveSurface: [
      { id: 'btn-inc', tag: 'button', role: 'button', label: 'Increment', action: 'click', component: 'Counter' },
    ],
    registeredStores: {},
    registeredComponents: {},
    contracts: [],
    errorsCount: 0,
    errors: [],
    tracesCount: 0,
    timestamp: Date.now(),
  };
}

function createInstrumentedFakeServer() {
  const handlers: Record<string, Function> = {};
  const fakeServer: any = {
    ws: {
      on: (event: string, handler: Function) => {
        handlers[event] = handler;
      },
      send: (event: string, payload: any) => {
        if (event === 'oumv:react-observe') {
          handlers['oumv:react-observe-res']?.({
            requestId: payload.requestId,
            snapshot: snapshotPayload(),
          });
        } else if (event === 'oumv:react-verify') {
          handlers['oumv:react-verify-res']?.({
            requestId: payload.requestId,
            status: 'passed',
            target: payload.target,
            action: payload.action,
            diff: { text: { before: 'Increment', after: 'Increment' } },
            surfaceDiff: [{ op: 'text', target: 'btn-inc', before: 'a', after: 'b' }],
            durationMs: 4.2,
            latency: { actionMs: 1.1, totalMs: 4.2 },
          });
        }
      },
    },
  };
  return { fakeServer, handlers };
}

describe('@tokensafe-ui/vite React Adapter — OUMV fixture certification', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-react-cert-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'react-fixture-app', dependencies: { react: '^18.3.1' } }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'Counter.tsx'),
      `export function Counter() {\n  return <button data-agent-id="btn-inc">Increment</button>;\n}\n`,
      'utf-8'
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'EditTarget.tsx'), `export const value = 41;\n`, 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'SymbolTarget.tsx'), SYMBOL_BEFORE, 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'DeleteTarget.tsx'), DELETE_SOURCE, 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'RenameSource.tsx'), RENAME_SOURCE, 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function markers() {
    return {
      fixtureFile: 'src/Counter.tsx',
      missingFile: 'src/Missing.tsx',
      editTarget: 'src/EditTarget.tsx',
      newFile: 'src/Created_New.tsx',
      editVersion: sha('export const value = 41;\n'),
      editContent: EDIT_CONTENT,
      brokenContent: BROKEN_CONTENT,
      l2Target: 'Counter',
      l3Target: 'src/Counter.tsx',
      verifyTarget: 'Counter',
      symbolFile: 'src/SymbolTarget.tsx',
      symbolName: 'probe',
      symbolReplacement: SYMBOL_AFTER,
      symbolVersion: sha(SYMBOL_BEFORE),
      symbolFileContent: SYMBOL_AFTER,
      deleteFile: 'src/DeleteTarget.tsx',
      deleteVersion: sha(DELETE_SOURCE),
      renameSource: 'src/RenameSource.tsx',
      renameTarget: 'src/RenameTarget.tsx',
      renameVersion: sha(RENAME_SOURCE),
    };
  }

  async function runFixtures(withBrowser: boolean) {
    const { loadFixtures, runFixtureSuite, memoryTransport } = require(CONFORMANCE_CJS);
    let server: any;
    let handlers: Record<string, Function> = {};
    if (withBrowser) {
      ({ fakeServer: server, handlers } = createInstrumentedFakeServer());
    }
    const controller = createReactOumvController({ rootDir: tmpDir, ...(server ? { server } : {}) });
    if (withBrowser) {
      handlers['oumv:react-snapshot']?.(snapshotPayload());
      handlers['oumv:react-trace']?.({
        type: 'verify:click',
        target: 'Counter',
        route: '/',
        timestamp: Date.now(),
      });
    }

    const transport = memoryTransport(async (request: any) => {
      const out = await controller.handleRpcPayload(request);
      return out.body;
    });
    const spec = loadFixtures(FIXTURES_PATH);
    return runFixtureSuite(transport, spec, markers(), {
      adapterName: 'frontend/react',
      environment: { browser: withBrowser },
    });
  }

  it('answers the canonical observe envelope (level/format/data)', async () => {
    const controller = createReactOumvController({ rootDir: tmpDir });
    const l0 = await controller.handleRpcPayload({ id: 1, method: 'oumv/observe', params: { level: 'L0' } });

    expect(l0.body.result.level).toBe('L0');
    expect(l0.body.result.format).toBe('yaml');
    expect(typeof l0.body.result.data).toBe('object');
    expect(l0.body.result.browserConnected).toBeUndefined();
    // §4.6: the deprecated `payload` alias must never be emitted; `data` carries it.
    expect(l0.body.result.payload).toBeUndefined();
    expect(typeof l0.body.result.data.staticComponentsCount).toBe('number');
  });

  it('narrows handshake capabilities to the requested levels', async () => {
    const controller = createReactOumvController({ rootDir: tmpDir });
    const full = await controller.handleRpcPayload({ id: 1, method: 'oumv/handshake' });
    expect(full.body.result.capabilities.observe.levels).toHaveLength(5);

    const narrowed = await controller.handleRpcPayload({
      id: 2,
      method: 'oumv/handshake',
      params: { requestedCapabilities: { observe: { levels: ['L0', 'L1'] } } },
    });
    expect(narrowed.body.result.capabilities.observe.levels).toEqual(['L0', 'L1']);
  });

  it.runIf(hasSiblingOumv)(
    'attains Level 3 when a browser tab answers the bridge',
    async () => {
      const report = await runFixtures(true);
      if (report.failed > 0) {
        console.log(report.cases.filter((c: any) => c.status !== 'passed'));
      }
      expect(report.passed).toBe(report.total);
      expect(report.attainedLevel).toBe(3);
      expect(report.levels).toEqual({ 1: 'passed', 2: 'passed', 3: 'passed' });
    },
    20_000
  );

  it.runIf(hasSiblingOumv)(
    'attains Level 1 offline and names the browser-only failures',
    async () => {
      const report = await runFixtures(false);
      expect(report.attainedLevel).toBe(1);
      const failed = report.cases.filter((c: any) => c.status === 'failed').map((c: any) => c.id);
      expect(failed).toEqual(
        expect.arrayContaining([
          'observe-l4-returns-recorded-traces',
          'understand-causality-after-execution',
          'verify-returns-status-timings-and-scope',
        ])
      );
      const verifyCase = report.cases.find((c: any) => c.id === 'verify-returns-status-timings-and-scope');
      expect(verifyCase.error).toContain('-32008');
    },
    20_000
  );

  it.runIf(hasSiblingOumv)('exposes a canonical ResourceCollection at L1', async () => {
    const { ResourceReferenceSchema } = require(SCHEMA_CJS);
    const { fakeServer, handlers } = createInstrumentedFakeServer();
    const controller = createReactOumvController({ rootDir: tmpDir, server: fakeServer });
    handlers['oumv:react-snapshot']?.(snapshotPayload());

    const l1 = await controller.handleRpcPayload({
      id: 1,
      method: 'oumv/observe',
      params: { level: 'L1', format: 'json' },
    });

    const data = l1.body.result.data;
    expect(Array.isArray(data.resources)).toBe(true);
    expect(data.total).toBe(data.resources.length);
    expect(data.total).toBeGreaterThanOrEqual(2);
    expect(data.provenanceSummary.runtime).toBeGreaterThanOrEqual(2);
    for (const resource of data.resources) {
      expect(ResourceReferenceSchema.safeParse(resource).success).toBe(true);
    }
  });
});
