import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createReactAdapter } from '../src/react.js';

describe('@tokensafe-ui/oumv - React Runtime Adapter', () => {
  let tmpDir: string;
  let testFile: string;

  const sampleReactSource = `import React, { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="counter" data-agent-id="counter:root">
      <span data-agent-id="counter:value">{count}</span>
      <button data-agent-id="counter:btn-inc" onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-react-'));
    testFile = path.join(tmpDir, 'Counter.tsx');
    fs.writeFileSync(testFile, sampleReactSource, 'utf-8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('performs protocol handshake with React runtime metadata', async () => {
    const adapter = createReactAdapter({ projectRoot: tmpDir });
    const handshake = await adapter.handshake();

    expect(handshake.protocolVersion).toBe('1.0.0');
    expect(handshake.runtimeInfo.name).toBe('react');
    expect(handshake.runtimeInfo.version).toBeDefined();
    expect(handshake.capabilities.observe.levels).toContain('L1');
    expect(handshake.capabilities.understand.componentGraph).toBe(true);
    expect(handshake.capabilities.mutate.occ).toBe(true);
    expect(handshake.capabilities.verify.multiMetric).toBe(true);
  });

  it('observes L0 pulse and L1 interactive surface from DOM container', async () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div data-agent-id="todo-app:root">
        <input type="text" data-agent-id="todo:input" value="Learn OUMV" />
        <input type="checkbox" data-agent-id="todo:check" checked />
        <button data-agent-id="todo:submit" data-action="add">Add</button>
        <button data-agent-id="todo:clear" disabled>Clear</button>
      </div>
    `;

    const adapter = createReactAdapter({
      projectRoot: tmpDir,
      rootElement: container,
      components: {
        'todo-app': {
          id: 'todo-app',
          name: 'TodoApp',
          filePath: 'Counter.tsx',
          getState: () => ({ itemsCount: 1 }),
          actions: { add: () => {} },
        },
      },
    });

    const l0 = await adapter.observe({ level: 'L0' });
    expect(l0.level).toBe('L0');
    expect(l0.payload).toContain('framework: react');
    expect(l0.payload).toContain('mounted: [todo-app]');

    const l1 = await adapter.observe({ level: 'L1' });
    expect(l1.level).toBe('L1');
    expect(l1.payload).toContain('todo:input');
    expect(l1.payload).toContain('value: "Learn OUMV"');
    expect(l1.payload).toContain('todo:check');
    expect(l1.payload).toContain('todo:submit [role: button');
    expect(l1.payload).toContain('todo:clear [role: button');
    expect(l1.payload).toContain('disabled: true');
  });

  it('observes L2 component contract and L3 isolated source code with OCC versioning', async () => {
    let internalState = { count: 42, active: true };

    const adapter = createReactAdapter({
      projectRoot: tmpDir,
      components: {
        counter: {
          id: 'counter',
          name: 'Counter',
          filePath: 'Counter.tsx',
          getState: () => internalState,
          actions: {
            increment: () => {
              internalState.count++;
            },
          },
        },
      },
    });

    const l2 = await adapter.observe({ level: 'L2', componentId: 'counter' });
    expect(l2.level).toBe('L2');
    expect(l2.payload).toContain('count":42');
    expect(l2.payload).toContain('increment');

    const l3 = await adapter.observe({ level: 'L3', componentId: 'counter' });
    expect(l3.level).toBe('L3');
    expect(l3.payload).toContain('1 | import React');
    expect(l3.payload).toContain('Counter()');
  });

  it('performs impact analysis and understands React component dependencies', async () => {
    const adapter = createReactAdapter({
      projectRoot: tmpDir,
      components: {
        button: {
          id: 'button',
          name: 'Button',
          dependents: ['form'],
        },
        form: {
          id: 'form',
          name: 'Form',
          dependencies: ['button'],
          dependents: ['page'],
        },
        page: {
          id: 'page',
          name: 'Page',
          dependencies: ['form'],
        },
        unrelated: {
          id: 'unrelated',
          name: 'Sidebar',
        },
      },
    });

    const impact = await adapter.understand({ query: 'impact', target: 'button' });
    expect(impact.target).toBe('button');
    expect(impact.directlyAffected).toContain('form');
    expect(impact.indirectlyAffected).toContain('page');
    expect(impact.safeComponents).toContain('unrelated');

    const graph = await adapter.understand({ query: 'dependencies' });
    expect(graph.yaml).toContain('react_dependency_graph:');
    expect(graph.yaml).toContain('component: button');
  });

  it('enforces OCC tokens and catches JSX syntax errors during applyEdit', async () => {
    const adapter = createReactAdapter({ projectRoot: tmpDir });

    const src = await adapter.getSource({
      componentId: 'counter',
      filePath: 'Counter.tsx',
    });

    expect(src.version).toMatch(/^sha256:[a-f0-9]{64}$/);

    // 1. Syntax guard rejection
    const brokenJsx = `export function Bad() { return <div><span>unclosed</div>; }`;
    await expect(
      adapter.applyEdit({
        filePath: 'Counter.tsx',
        source: brokenJsx,
        expectedVersion: src.version,
      })
    ).rejects.toThrow(/OUMV SYNTAX_ERROR/);

    // 2. OCC Conflict Rejection
    const validEdit = `export function Updated() { return <div>Updated Counter</div>; }`;
    await expect(
      adapter.applyEdit({
        filePath: 'Counter.tsx',
        source: validEdit,
        expectedVersion: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      })
    ).rejects.toThrow();

    // 3. Valid edit with correct version
    const result = await adapter.applyEdit({
      filePath: 'Counter.tsx',
      source: validEdit,
      expectedVersion: src.version,
    });

    expect(result.success).toBe(true);
    expect(result.version).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(validEdit);
  });

  it('verifies local component actions with state diffs and latency telemetry', async () => {
    let state = { count: 0, lastAction: 'none' };

    const adapter = createReactAdapter({
      projectRoot: tmpDir,
      components: {
        counter: {
          id: 'counter',
          name: 'Counter',
          getState: () => state,
          actions: {
            increment: (payload: { by: number }) => {
              state.count += payload?.by || 1;
              state.lastAction = 'increment';
            },
          },
        },
      },
    });

    const verifyRes = await adapter.verify({
      componentId: 'counter',
      action: 'increment',
      payload: { by: 5 },
    });

    expect(verifyRes.componentId).toBe('counter');
    expect(verifyRes.action).toBe('increment');
    expect(verifyRes.stateBefore.count).toBe(0);
    expect(verifyRes.stateAfter.count).toBe(5);
    expect(verifyRes.stateDiff.count).toEqual({ before: 0, after: 5 });
    expect(verifyRes.stateDiff.lastAction).toEqual({ before: 'none', after: 'increment' });
    expect(verifyRes.latency.totalMs).toBeGreaterThanOrEqual(0);

    // Verify L4 traces recorded the action
    const l4 = await adapter.observe({ level: 'L4', componentId: 'counter' });
    expect(l4.payload).toContain('increment');
  });
});
