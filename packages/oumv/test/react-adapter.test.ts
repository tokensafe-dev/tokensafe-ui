import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createReactAdapter,
  connectZustand,
  connectRedux,
  isZustandStore,
  isReduxStore,
} from '../src/react.js';

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

  it('supports Zustand stores with auto-discovery of actions and real-time trace subscriptions', async () => {
    // Mock a standard Zustand store
    const listeners = new Set<(state: any) => void>();
    let storeState = {
      items: ['apple'],
      total: 10,
      addItem: (item: string) => {
        storeState = {
          ...storeState,
          items: [...storeState.items, item],
          total: storeState.total + 15,
        };
        listeners.forEach((l) => l(storeState));
      },
      clear: () => {
        storeState = {
          ...storeState,
          items: [],
          total: 0,
        };
        listeners.forEach((l) => l(storeState));
      },
    };

    const zustandStore = {
      getState: () => storeState,
      setState: (partial: any) => {
        storeState = { ...storeState, ...partial };
        listeners.forEach((l) => l(storeState));
      },
      subscribe: (listener: (state: any) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    expect(isZustandStore(zustandStore)).toBe(true);

    const adapter = createReactAdapter({
      projectRoot: tmpDir,
      stores: {
        cart: zustandStore,
      },
    });

    // 1. Observe L2 contract: functions should be auto-extracted to actions, state contains only data
    const l2 = await adapter.observe({ level: 'L2', componentId: 'cart', format: 'json' });
    const contract = JSON.parse(l2.payload);
    expect(contract.componentId).toBe('cart');
    expect(contract.state.items).toEqual(['apple']);
    expect(contract.state.total).toBe(10);
    expect(contract.actions).toContain('addItem');
    expect(contract.actions).toContain('clear');
    expect(contract.actions).toContain('setState');

    // 2. Verify: call auto-discovered action 'addItem' via adapter
    const verifyRes = await adapter.verify({
      componentId: 'cart',
      action: 'addItem',
      payload: 'orange',
    });

    expect(verifyRes.stateBefore.items).toEqual(['apple']);
    expect(verifyRes.stateAfter.items).toEqual(['apple', 'orange']);
    expect(verifyRes.stateAfter.total).toBe(25);
    expect(verifyRes.stateDiff.items).toBeDefined();

    // 3. Verify L4 traces automatically recorded the update via subscription
    const l4 = await adapter.observe({ level: 'L4', componentId: 'cart' });
    expect(l4.payload).toContain('cart');

    adapter.dispose?.();
  });

  it('supports Redux stores with action creators, dispatch, and trace updates', async () => {
    // Mock a Redux store
    const listeners = new Set<() => void>();
    let state = { count: 100, user: 'alice' };

    const reduxStore = {
      getState: () => state,
      dispatch: (action: { type: string; payload?: any }) => {
        if (action.type === 'counter/inc') {
          state = { ...state, count: state.count + (action.payload || 1) };
        } else if (action.type === 'user/set') {
          state = { ...state, user: action.payload };
        }
        listeners.forEach((l) => l());
        return action;
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    expect(isReduxStore(reduxStore)).toBe(true);

    const connectedRedux = connectRedux(reduxStore, {
      id: 'auth-store',
      actionCreators: {
        incrementCount: (by: number) => ({ type: 'counter/inc', payload: by }),
        setUser: (user: string) => ({ type: 'user/set', payload: user }),
      },
    });

    const adapter = createReactAdapter({
      projectRoot: tmpDir,
      components: {
        'auth-store': connectedRedux,
      },
    });

    // 1. Observe L2
    const l2 = await adapter.observe({ level: 'L2', componentId: 'auth-store', format: 'json' });
    const contract = JSON.parse(l2.payload);
    expect(contract.state.count).toBe(100);
    expect(contract.actions).toContain('dispatch');
    expect(contract.actions).toContain('incrementCount');
    expect(contract.actions).toContain('setUser');

    // 2. Verify action creator execution
    const verifyRes = await adapter.verify({
      componentId: 'auth-store',
      action: 'incrementCount',
      payload: 50,
    });

    expect(verifyRes.stateBefore.count).toBe(100);
    expect(verifyRes.stateAfter.count).toBe(150);
    expect(verifyRes.stateDiff.count).toEqual({ before: 100, after: 150 });

    // 3. Verify direct dispatch action
    const dispatchRes = await adapter.verify({
      componentId: 'auth-store',
      action: 'dispatch',
      payload: { type: 'user/set', payload: 'bob' },
    });

    expect(dispatchRes.stateAfter.user).toBe('bob');
    expect(dispatchRes.stateDiff.user).toEqual({ before: 'alice', after: 'bob' });

    connectedRedux.unsubscribe?.();
  });
});
