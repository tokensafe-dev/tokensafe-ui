import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveFrameworkMode,
  tokensafeUi,
  tokensafeReact,
  createReactOumvController,
  getReactBridgeClientCode,
} from '../src/index.js';

describe('@tokensafe-ui/vite - React OUMV Support', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-vite-react-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-react-app',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { 'tokensafe-ui': '0.1.18' },
      }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'Counter.tsx'),
      `import React from 'react';
export function Counter() {
  return <button data-agent-id="btn-inc" onClick={() => {}}>Inc</button>;
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

  it('auto-detects React mode and skips SolidJS JSX transformation', () => {
    expect(resolveFrameworkMode(tmpDir, 'auto')).toBe('react');

    const plugin = tokensafeReact();
    (plugin as any).configResolved({ command: 'serve', root: tmpDir });
    const transformed = (plugin as any).transform(
      'export function App() { return <div />; }',
      path.join(tmpDir, 'src', 'App.tsx')
    );
    expect(transformed).toBeNull();

    const htmlResult = (plugin as any).transformIndexHtml('<html><body></body></html>');
    expect(htmlResult.tags[0].attrs.src).toBe('/@oumv/react-bridge.js');
    expect(getReactBridgeClientCode()).toContain('__OUMV_REACT_BRIDGE_INSTALLED__');
  });

  it('serves handshake, static fallback observe, impact, OCC mutate, and honest verify when browser offline', async () => {
    const controller = createReactOumvController({ rootDir: tmpDir });

    const hs = await controller.handleRpcPayload({ id: 1, method: 'oumv/handshake' });
    expect(hs.body.result.runtimeInfo.name).toBe('react');
    expect(hs.body.result.capabilities.observe.levels).toContain('L4');

    const l0 = await controller.handleRpcPayload({
      id: 2,
      method: 'oumv/observe',
      params: { level: 'L0' },
    });
    expect(l0.body.result.browserConnected).toBe(false);
    expect(l0.body.result.staticComponentsCount).toBeGreaterThanOrEqual(2);

    const l1 = await controller.handleRpcPayload({
      id: 3,
      method: 'oumv/observe',
      params: { level: 'L1' },
    });
    expect(l1.body.result.format).toBe('yaml');
    expect(l1.body.result.payload).toContain('Counter');
    expect(l1.body.result.components.some((c: any) => c.name === 'Counter')).toBe(true);
    expect(JSON.stringify(l1.body.result).length).toBeLessThan(2000);

    const l1Json = await controller.handleRpcPayload({
      id: 31,
      method: 'oumv/observe',
      params: { level: 'L1', format: 'json' },
    });
    expect(l1Json.body.result.format).toBe('json');
    expect(Array.isArray(l1Json.body.result.resources)).toBe(true);
    expect(l1Json.body.result.components.some((c: any) => c.name === 'Counter')).toBe(true);

    const impact = await controller.handleRpcPayload({
      id: 4,
      method: 'oumv/understand',
      params: { query: 'impact', target: 'Counter' },
    });
    expect(impact.body.result.directlyAffected).toContain('src/App.tsx');

    const src = await controller.handleRpcPayload({
      id: 5,
      method: 'oumv/getSource',
      params: { path: 'src/Counter.tsx', symbol: 'Counter' },
    });
    expect(src.body.result.version).toMatch(/^sha256:/);
    expect(src.body.result.source).toContain('btn-inc');

    // Syntax error rejected (-32002)
    const badEdit = await controller.handleRpcPayload({
      id: 6,
      method: 'oumv/applyEdit',
      params: {
        path: 'src/Counter.tsx',
        replacement: 'export function Counter() { return <div>; }',
        expectedVersion: src.body.result.version,
      },
    });
    expect(badEdit.body.error.code).toBe(-32002);

    // Conflict rejected (-32001)
    const conflict = await controller.handleRpcPayload({
      id: 7,
      method: 'oumv/applyEdit',
      params: {
        path: 'src/Counter.tsx',
        replacement: 'export function Counter() { return <button>Ok</button>; }',
        expectedVersion: 'sha256:0000',
      },
    });
    expect(conflict.body.error.code).toBe(-32001);

    // Missing expectedVersion rejected (-32011)
    const missingVer = await controller.handleRpcPayload({
      id: 71,
      method: 'oumv/applyEdit',
      params: {
        path: 'src/Counter.tsx',
        replacement: 'export function Counter() { return <button>Ok</button>; }',
      },
    });
    expect(missingVer.body.error.code).toBe(-32011);

    // Offline verify returns RUNTIME_UNAVAILABLE (-32008) honestly
    const verify = await controller.handleRpcPayload({
      id: 8,
      method: 'oumv/verify',
      params: { target: 'btn-inc', action: 'click' },
    });
    expect(verify.body.error.code).toBe(-32008);
  });

  it('dispatches live browser snapshot, traces, and verify over Vite WS', async () => {
    const handlers: Record<string, Function> = {};
    const fakeServer: any = {
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
                route: '/pricing',
                title: 'Pricing',
                elementCount: 42,
                mountedComponents: [{ id: 'frontend.component:PricingView', name: 'PricingView', instances: 1, propsKeys: [], hooksCount: 2 }],
                interactiveSurface: [{ id: 'btn-annual', tag: 'button', role: 'button', label: 'Annual', action: 'click', component: 'PricingView' }],
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
              diff: { text: { before: 'Monthly', after: 'Annual' } },
              surfaceDiff: [{ op: 'text', target: 'btn-annual', before: 'Monthly', after: 'Annual' }],
              durationMs: 4.2,
              latency: { actionMs: 1.1, totalMs: 4.2 },
            });
          }
        },
      },
    };

    const controller = createReactOumvController({ rootDir: tmpDir, server: fakeServer });
    handlers['oumv:react-snapshot']?.({
      framework: 'react',
      route: '/pricing',
      title: 'Pricing',
      elementCount: 42,
      mountedComponents: [{ id: 'frontend.component:PricingView', name: 'PricingView', instances: 1, propsKeys: [], hooksCount: 2 }],
      interactiveSurface: [{ id: 'btn-annual', tag: 'button', role: 'button', label: 'Annual', action: 'click', component: 'PricingView' }],
      registeredStores: {},
      registeredComponents: {},
      contracts: [],
      errorsCount: 0,
      errors: [],
      tracesCount: 0,
      timestamp: Date.now(),
    });
    handlers['oumv:react-trace']?.({ type: 'fetch', method: 'GET', url: '/api/stats', status: 200, durationMs: 12 });

    const l1 = await controller.handleRpcPayload({ id: 1, method: 'oumv/observe', params: { level: 'L1', format: 'json' } });
    expect(l1.body.result.browserConnected).toBe(true);
    expect(l1.body.result.route).toBe('/pricing');
    expect(l1.body.result.elements[0].id).toBe('btn-annual');

    const l1Yaml = await controller.handleRpcPayload({ id: 11, method: 'oumv/observe', params: { level: 'L1' } });
    expect(l1Yaml.body.result.format).toBe('yaml');
    expect(l1Yaml.body.result.payload).toContain('btn-annual');
    expect(JSON.stringify(l1Yaml.body.result).length).toBeLessThan(2000);

    const l4 = await controller.handleRpcPayload({ id: 2, method: 'oumv/observe', params: { level: 'L4' } });
    expect(l4.body.result.traces).toHaveLength(1);
    expect(l4.body.result.traces[0].url).toBe('/api/stats');

    const verify = await controller.handleRpcPayload({
      id: 3,
      method: 'oumv/verify',
      params: { target: 'btn-annual', action: 'click' },
    });
    expect(verify.body.result.status).toBe('passed');
    expect(verify.body.result.diff.text.after).toBe('Annual');
    expect(verify.body.result.evidence.provenance).toBe('runtime');
  });

  it('keeps tokensafe-ui mode when @tokensafe-ui/core is in dependencies', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'native-app', dependencies: { '@tokensafe-ui/core': '^0.1.0' } }),
      'utf-8'
    );
    expect(resolveFrameworkMode(tmpDir, 'auto')).toBe('tokensafe-ui');
    const plugin = tokensafeUi();
    expect(plugin.name).toBe('tokensafe-ui');
  });
});
