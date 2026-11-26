import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createReactOumvController } from '../src/index.js';

const require = createRequire(import.meta.url);

// Load optional @oumv/conformance runner & fixtures from sibling agent-oumv workspace when present locally
const AGENT_OUMV_ROOT = path.resolve(__dirname, '../../../../agent-oumv');
const CONFORMANCE_CJS = path.join(AGENT_OUMV_ROOT, 'packages/conformance/dist/index.cjs');
const SCHEMA_CJS = path.join(AGENT_OUMV_ROOT, 'packages/schema/dist/index.cjs');
const FIXTURES_PATH = path.join(AGENT_OUMV_ROOT, 'fixtures/conformance-cases.json');
const hasSiblingOumv =
  fs.existsSync(CONFORMANCE_CJS) && fs.existsSync(SCHEMA_CJS) && fs.existsSync(FIXTURES_PATH);

interface ConformanceCase {
  id: string;
  level: 1 | 2 | 3;
  method: string;
  params: Record<string, any>;
  preconditions?: string[];
  expectResultFields?: string[];
  expectError?: { code: number };
  expectLevelEquals?: string;
  expectEvidence?: boolean;
  expectSha256Field?: string;
  expectArrayField?: string;
  expectVersionMatchesContent?: string;
}

function getByJsonPath(obj: any, dotPath: string): any {
  return dotPath.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

describe('@tokensafe-ui/vite React Adapter — @oumv/conformance Certification', () => {
  let tmpDir: string;

  const createInstrumentedFakeServer = () => {
    const handlers: Record<string, Function> = {};
    const server: any = {
      ws: {
        on: (ev: string, fn: Function) => {
          handlers[ev] = fn;
        },
        send: (ev: string, payload: any) => {
          if (ev === 'oumv:react-observe') {
            handlers['oumv:react-observe-res']?.({
              requestId: payload.requestId,
              snapshot: {
                framework: 'react',
                route: '/',
                title: 'Test React App',
                elementCount: 12,
                mountedComponents: [
                  {
                    id: 'frontend.component:Counter',
                    name: 'Counter',
                    instances: 1,
                    propsKeys: ['initial'],
                    hooksCount: 1,
                  },
                ],
                interactiveSurface: [
                  {
                    id: 'btn-inc',
                    tag: 'button',
                    role: 'button',
                    label: 'Increment',
                    action: 'click',
                    component: 'Counter',
                  },
                ],
                registeredStores: {},
                registeredComponents: {},
                contracts: [],
                errorsCount: 0,
                errors: [],
                tracesCount: 1,
                timestamp: Date.now(),
              },
            });
          } else if (ev === 'oumv:react-verify') {
            handlers['oumv:react-verify-res']?.({
              requestId: payload.requestId,
              status: 'passed',
              target: payload.target,
              action: payload.action,
              diff: { count: { before: 0, after: 1 } },
              surfaceDiff: [{ op: 'text', target: 'btn-inc', before: '0', after: '1' }],
              durationMs: 2.5,
              latency: { actionMs: 1.0, totalMs: 2.5 },
            });
          }
        },
      },
      moduleGraph: { getModuleById: () => null, invalidateModule: () => {} },
      reloadModule: async () => {},
    };
    return { server, handlers };
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-react-conformance-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'Counter.tsx'),
      `import React, { useState } from 'react';
export function Counter() {
  const [count, setCount] = useState(0);
  return <button data-agent-id="btn-inc" onClick={() => setCount(count + 1)}>{count}</button>;
}
`,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'App.tsx'),
      `import { Counter } from './Counter';
export default function App() {
  return <main><Counter /></main>;
}
`,
      'utf-8'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.runIf(hasSiblingOumv)('passes @oumv/conformance runConformanceSuite at Level 3 (13/13)', async () => {
    const { runConformanceSuite } = require(CONFORMANCE_CJS);
    const { server, handlers } = createInstrumentedFakeServer();
    const controller = createReactOumvController({ rootDir: tmpDir, server });

    // Seed initial snapshot and runtime trace as an active browser tab does
    handlers['oumv:react-snapshot']?.({
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
    });
    handlers['oumv:react-trace']?.({
      type: 'verify:click',
      target: 'Counter',
      route: '/',
      timestamp: Date.now(),
    });

    const adapter = controller.asOumvAdapter();
    const report = await runConformanceSuite(adapter, {
      componentId: 'Counter',
      filePath: 'src/Counter.tsx',
      action: 'click',
    });

    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.passed).toBe(13);
    expect(report.total).toBe(13);
    expect(report.attainedLevel).toBe(3);
    expect(report.levels).toEqual({ 1: 'passed', 2: 'passed', 3: 'passed' });
  });

  it.runIf(hasSiblingOumv)('validates canonical ResourceCollection & ResourceReference[] schema at L1', async () => {
    const { ResourceReferenceSchema } = require(SCHEMA_CJS);
    const { server, handlers } = createInstrumentedFakeServer();
    const controller = createReactOumvController({ rootDir: tmpDir, server });

    handlers['oumv:react-snapshot']?.({
      framework: 'react',
      route: '/',
      title: 'Test',
      elementCount: 5,
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
    });

    const l1 = await controller.handleRpcPayload({
      id: 1,
      method: 'oumv/observe',
      params: { level: 'L1', format: 'json' },
    });

    const res = l1.body.result;
    expect(Array.isArray(res.resources)).toBe(true);
    expect(res.total).toBe(res.resources.length);
    expect(res.total).toBeGreaterThanOrEqual(2);
    expect(res.provenanceSummary.runtime).toBeGreaterThanOrEqual(2);
    expect(res.provenanceSummary.static).toBeGreaterThanOrEqual(1);

    for (const item of res.resources) {
      expect(() => ResourceReferenceSchema.parse(item)).not.toThrow();
    }
  });

  it.runIf(hasSiblingOumv)('passes language-neutral conformance-cases.json fixtures (SPEC §10)', async () => {
    const fixtureData = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8')) as {
      cases: ConformanceCase[];
    };
    const { server, handlers } = createInstrumentedFakeServer();
    const controller = createReactOumvController({ rootDir: tmpDir, server });

    handlers['oumv:react-snapshot']?.({
      framework: 'react',
      route: '/',
      title: 'Test',
      elementCount: 5,
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
    });

    const editTargetRel = 'src/EditTarget.tsx';
    const editTargetAbs = path.join(tmpDir, editTargetRel);
    const initialEditContent = `export function EditTarget() { return <div>Initial</div>; }\n`;
    fs.writeFileSync(editTargetAbs, initialEditContent, 'utf-8');
    const editTargetVersion =
      'sha256:' + crypto.createHash('sha256').update(initialEditContent).digest('hex');

    const validReplacement = `export function EditTarget() { return <div>Updated</div>; }\n`;
    const brokenReplacement = `export function EditTarget() { return <div>Broken; }\n`;

    const substitute = (val: any): any => {
      if (typeof val === 'string') {
        return val
          .replaceAll('${FIXTURE_FILE}', 'src/Counter.tsx')
          .replaceAll('${MISSING_FILE}', 'src/DoesNotExist.tsx')
          .replaceAll('${EDIT_TARGET_FILE}', editTargetRel)
          .replaceAll('${EDIT_TARGET_VERSION}', editTargetVersion)
          .replaceAll('${EDIT_CONTENT}', validReplacement)
          .replaceAll('${BROKEN_CONTENT}', brokenReplacement)
          .replaceAll('${L2_TARGET}', 'Counter')
          .replaceAll('${L3_TARGET}', 'src/Counter.tsx')
          .replaceAll('${VERIFY_TARGET}', 'btn-inc');
      }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) out[k] = substitute(v);
        return out;
      }
      return val;
    };

    for (const tc of fixtureData.cases) {
      if (tc.preconditions?.includes('verify')) {
        await controller.handleRpcPayload({
          id: `pre-${tc.id}`,
          method: 'oumv/verify',
          params: { target: 'btn-inc', action: 'click' },
        });
        handlers['oumv:react-trace']?.({
          type: 'verify:click',
          target: 'btn-inc',
          route: '/',
          timestamp: Date.now(),
        });
      }

      const params = substitute(tc.params);
      const resp = await controller.handleRpcPayload({
        id: tc.id,
        method: tc.method,
        params,
      });

      if (tc.expectError) {
        expect(resp.body.error, `${tc.id} should return error`).toBeDefined();
        expect(resp.body.error.code, `${tc.id} error code`).toBe(tc.expectError.code);
        continue;
      }

      expect(resp.body.error, `${tc.id} unexpected error`).toBeUndefined();
      const result = resp.body.result;

      for (const field of tc.expectResultFields || []) {
        expect(getByJsonPath(result, field), `${tc.id}: missing ${field}`).toBeDefined();
      }
      if (tc.expectLevelEquals) {
        expect(result.level, `${tc.id} level`).toBe(tc.expectLevelEquals);
      }
      if (tc.expectEvidence) {
        expect(result.evidence?.provenance || result.data?.evidence?.provenance).toBeTruthy();
      }
      if (tc.expectSha256Field) {
        expect(getByJsonPath(result, tc.expectSha256Field)).toMatch(/^sha256:[a-f0-9]{64}$/);
      }
      if (tc.expectArrayField) {
        expect(Array.isArray(getByJsonPath(result, tc.expectArrayField))).toBe(true);
      }
      if (tc.expectVersionMatchesContent) {
        const expectedContent = substitute(tc.expectVersionMatchesContent);
        const expectedSha =
          'sha256:' + crypto.createHash('sha256').update(expectedContent).digest('hex');
        expect(result.newVersion).toBe(expectedSha);
      }
    }
  });

  it('passes self-contained CI OUMV Level 1-3 checks without external sibling repo', async () => {
    const { server, handlers } = createInstrumentedFakeServer();
    const controller = createReactOumvController({ rootDir: tmpDir, server });

    handlers['oumv:react-snapshot']?.({
      framework: 'react',
      route: '/',
      title: 'Test',
      elementCount: 5,
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
    });

    const hs = await controller.handleRpcPayload({ id: 1, method: 'oumv/handshake', params: { protocolVersion: '1.0.0' } });
    expect(hs.body.result.runtimeInfo.name).toBe('react');

    const l1 = await controller.handleRpcPayload({ id: 2, method: 'oumv/observe', params: { level: 'L1', format: 'json' } });
    expect(Array.isArray(l1.body.result.resources)).toBe(true);
    expect(l1.body.result.total).toBe(l1.body.result.resources.length);
    expect(l1.body.result.provenanceSummary.runtime).toBeGreaterThanOrEqual(2);

    const l3 = await controller.handleRpcPayload({ id: 3, method: 'oumv/observe', params: { level: 'L3', target: 'src/Counter.tsx' } });
    expect(l3.body.result.data.version).toMatch(/^sha256:[a-f0-9]{64}$/);

    const conflict = await controller.handleRpcPayload({
      id: 4,
      method: 'oumv/applyEdit',
      params: { path: 'src/Counter.tsx', replacement: 'export const X = 1;\n', expectedVersion: 'sha256:bad' },
    });
    expect(conflict.body.error.code).toBe(-32001);

    const verify = await controller.handleRpcPayload({
      id: 5,
      method: 'oumv/verify',
      params: { target: 'btn-inc', action: 'click' },
    });
    expect(verify.body.result.status).toBe('passed');
  });
});
