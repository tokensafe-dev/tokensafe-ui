import { describe, it, expect } from 'vitest';
import { defineComponent, z, h, mount } from '@tokensafe-ui/core';
import { observe } from '../src/index.js';

describe('Progressive Context Disclosure (Observer L0–L4)', () => {
  const Dashboard = defineComponent({
    id: 'dashboard-view',
    state: {
      user: z.string().default('Alice'),
      status: z.string().default('Online'),
    },
    actions: {
      setStatus: (s, status: string) => ({ ...s, status }),
    },
    render: ({ state, emit }) =>
      h(
        'div',
        { 'data-agent-id': 'dashboard-view:root' },
        h('h1', { 'data-agent-id': 'dashboard-view:title' }, 'User Dashboard'),
        h('button', {
          'data-agent-id': 'dashboard-view:btn-away',
          'data-agent-action': 'setStatus',
          onClick: () => emit.setStatus('Away'),
        }, 'Set Away')
      ),
  });

  it('L0 (Pulse): generates ultra-lean bird-eye view under 30 tokens', () => {
    const instance = Dashboard();
    const container = document.createElement('div');
    mount(instance, container);

    const l0 = observe(container.firstElementChild as HTMLElement, {
      level: 'L0',
      format: 'yaml',
    }) as string;

    expect(l0).toContain('level: L0');
    expect(l0).toContain('mounted: [');
    expect(l0).toContain('elements_count:');
    expect(l0).toContain('errors_count:');

    // Token count estimate: < 30 tokens!
    const tokens = l0.split(/\s+/).length;
    expect(tokens).toBeLessThan(30);
  });

  it('L1 (Surface): generates focused actionable surface under 150 tokens', () => {
    const instance = Dashboard();
    const container = document.createElement('div');
    mount(instance, container);

    const l1 = observe(container.firstElementChild as HTMLElement, {
      level: 'L1',
      format: 'yaml',
    }) as string;

    expect(l1).toContain('level: L1');
    expect(l1).toContain('view: dashboard-view');
    expect(l1).toContain('button#dashboard-view:btn-away [action: setStatus]: "Set Away"');
    expect(l1.split(/\s+/).length).toBeLessThan(100);
  });

  it('L2 (Contract): returns explicit schema and available actions', () => {
    const instance = Dashboard();
    const container = document.createElement('div');
    mount(instance, container);

    const l2 = observe(container.firstElementChild as HTMLElement, {
      level: 'L2',
      componentId: 'dashboard-view',
      format: 'json',
    }) as any;

    expect(l2.level).toBe('L2');
    expect(l2.componentId).toBe('dashboard-view');
    expect(l2.actions).toContain('setStatus');
    expect(l2.state.user.current).toBe('Alice');
    expect(l2.state.status.current).toBe('Online');
  });

  it('L3 (Source): extracts isolated component AST slice and maps agent IDs', () => {
    const multiComponentFile = `import { defineComponent } from 'tokensafe-ui';

export const Header = defineComponent({
  id: 'header-view',
  render: () => <div data-agent-id="header-view:root">Header</div>
});

export const Dashboard = defineComponent({
  id: 'dashboard-view',
  render: () => <button data-agent-id="dashboard-view:btn-away">Away</button>
});
`;

    const instance = Dashboard();
    const container = document.createElement('div');
    mount(instance, container);

    const l3 = observe(container.firstElementChild as HTMLElement, {
      level: 'L3',
      componentId: 'dashboard-view',
      sourceCode: multiComponentFile,
      format: 'json',
    }) as any;

    expect(l3.level).toBe('L3');
    expect(l3.startLine).toBe(8);
    expect(l3.isolatedSource).toContain("id: 'dashboard-view'");
    expect(l3.isolatedSource).not.toContain("id: 'header-view'");
    expect(l3.agentIdLineMap['dashboard-view:btn-away']).toBe(10);
  });

  it('L3 (Source): synthesizes isolated component contract when sourceCode is omitted', () => {
    const instance = Dashboard();
    const container = document.createElement('div');
    mount(instance, container);

    const l3 = observe(container.firstElementChild as HTMLElement, {
      level: 'L3',
      componentId: 'dashboard-view',
      format: 'json',
    }) as any;

    expect(l3.level).toBe('L3');
    expect(l3.isolatedSource).toContain("id: 'dashboard-view'");
    expect(l3.isolatedSource).toContain("setStatus:");
  });

  it('L4 (Traces): provides runtime causality telemetry of actions and signal changes', async () => {
    const instance = Dashboard();
    const container = document.createElement('div');
    mount(instance, container);

    // Trigger action
    await instance.emit.setStatus('Away');

    const l4 = observe(container.firstElementChild as HTMLElement, {
      level: 'L4',
      componentId: 'dashboard-view',
      format: 'yaml',
    }) as string;

    expect(l4).toContain('level: L4');
    expect(l4).toContain('component: dashboard-view');
    expect(l4).toContain("Action 'setStatus' started");
    expect(l4).toContain("Signal 'status' changed: \"Online\" -> \"Away\"");
    expect(l4).toContain("Action 'setStatus' completed in");
  });
});
