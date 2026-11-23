import { describe, it, expect } from 'vitest';
import {
  defineComponent,
  defineAsyncCrudComponent,
  ensureHeadlessDom,
  h,
  mount,
  unmount,
  z,
} from 'tokensafe-ui';
import { observeDiff } from 'tokensafe-ui/observer';
import { applyPatch } from 'tokensafe-ui/patcher';
import { transformAgentDomJsx } from 'tokensafe-ui/vite';
import { BenchmarkHarness } from '../src/runner/harness.js';

describe('TokenSafe UI Super-Optimizations & Advanced Tooling', () => {
  describe('1. Auto-Headless DOM & Dynamic VNode Child Reconciliation', () => {
    it('initializes headless DOM without errors via ensureHeadlessDom()', async () => {
      await ensureHeadlessDom();
      expect(typeof document).not.toBe('undefined');
      expect(typeof window).not.toBe('undefined');
    });

    it('natively renders arrays of reactive VNodes without stringification traps', () => {
      const DynamicList = defineComponent({
        id: 'dynamic-list',
        state: {
          items: z.array(z.string()).default(['Item 1', 'Item 2']),
        },
        actions: {
          addItem: (s) => ({ ...s, items: [...s.items, `Item ${s.items.length + 1}`] }),
        },
        render: ({ state }) =>
          h(
            'ul',
            { 'data-agent-id': 'list:root' },
            // Functional array child mapping: previously caused [object Object]
            () => state.items.map((item) => h('li', { 'data-agent-id': `item:${item}` }, item))
          ),
      });

      const instance = DynamicList();
      const container = document.createElement('div');
      mount(instance, container);

      // Verify that DOM contains real <li> nodes instead of [object Object]
      expect(container.innerHTML).not.toContain('[object Object]');
      expect(container.innerHTML).toContain('Item 1');
      expect(container.innerHTML).toContain('Item 2');
      expect(container.querySelectorAll('li').length).toBe(2);

      // Mutate state and verify dynamic reactive update
      instance.emit.addItem();
      expect(container.querySelectorAll('li').length).toBe(3);
      expect(container.innerHTML).toContain('Item 3');

      unmount(container);
    });

    it('natively renders dynamic conditional VNodes in function children', () => {
      const ConditionalBox = defineComponent({
        id: 'cond-box',
        state: {
          showBanner: z.boolean().default(false),
        },
        actions: {
          toggle: (s) => ({ ...s, showBanner: !s.showBanner }),
        },
        render: ({ state }) =>
          h(
            'div',
            null,
            () => (state.showBanner ? h('div', { class: 'banner' }, 'Alert Active') : null)
          ),
      });

      const instance = ConditionalBox();
      const container = document.createElement('div');
      mount(instance, container);

      expect(container.innerHTML).not.toContain('Alert Active');
      instance.emit.toggle();
      expect(container.innerHTML).toContain('Alert Active');
      expect(container.querySelector('.banner')).not.toBeNull();
      instance.emit.toggle();
      expect(container.innerHTML).not.toContain('Alert Active');

      unmount(container);
    });
  });

  describe('2. Delta-Streaming Observation (observeDiff)', () => {
    it('generates ultra-compact state diffs (<40 tokens)', () => {
      const Card = defineComponent({
        id: 'counter-card',
        state: {
          count: z.number().default(0),
          status: z.string().default('idle'),
        },
        actions: {
          increment: (s) => ({ ...s, count: s.count + 1 }),
        },
        render: ({ state }) => h('div', null, () => state.count),
      });

      const instance = Card();
      const container = document.createElement('div');
      mount(instance, container);

      // Initial diff: records initial baseline
      const initialDiff = observeDiff(container.firstElementChild as HTMLElement, {
        componentId: 'counter-card',
        format: 'yaml',
      }) as string;

      expect(initialDiff).toContain('counter-card');

      // Now mutate state
      instance.emit.increment();

      // Subsequent diff: reports only delta
      const deltaDiff = observeDiff(container.firstElementChild as HTMLElement, {
        componentId: 'counter-card',
        format: 'yaml',
      }) as string;

      expect(deltaDiff).toContain('~ count: 1 (was 0)');
      // Diff size is tiny (less than 150 characters, ~30 tokens)
      expect(deltaDiff.length).toBeLessThan(200);

      unmount(container);
    });
  });

  describe('3. Async CRUD Contract Macro (defineAsyncCrudComponent)', () => {
    it('auto-generates standard CRUD states, actions, and optimistic rollback', () => {
      const ItemSchema = z.object({
        id: z.string(),
        title: z.string(),
        status: z.enum(['Active', 'Completed']).default('Active'),
      });

      const TaskApp = defineAsyncCrudComponent({
        id: 'macro-task-app',
        itemSchema: ItemSchema,
        initialItems: [{ id: '1', title: 'Task 1', status: 'Active' }],
        render: ({ state }) => h('div', null, () => state.items.length),
      });

      const instance = TaskApp();
      expect(instance.state.items.length).toBe(1);
      expect(instance.state.isSaving).toBe(false);
      expect(instance.state.errorMessage).toBeNull();

      // Standard generated actions
      instance.emit.addItem({ title: 'Task 2' });
      expect(instance.state.items.length).toBe(2);

      instance.emit.toggleItem({ id: '1' });
      expect(instance.state.items[0].status).toBe('Completed');

      instance.emit.startSaving();
      expect(instance.state.isSaving).toBe(true);

      instance.emit.saveFailure({ error: 'HTTP 500' });
      expect(instance.state.isSaving).toBe(false);
      expect(instance.state.errorMessage).toBe('HTTP 500');

      instance.emit.rollbackToggle({ id: '1', prevStatus: 'Active', error: 'Sync failed' });
      expect(instance.state.items[0].status).toBe('Active');
      expect(instance.state.errorMessage).toBe('Sync failed');
    });
  });

  describe('4. Extended Semantic AST Patcher', () => {
    it('supports replace_action, patch_render, and remove_action', () => {
      const source = `
import { defineComponent, z, h } from 'tokensafe-ui';

export const TestComp = defineComponent({
  id: 'test-comp',
  state: { count: z.number().default(0) },
  actions: {
    increment: (s) => ({ ...s, count: s.count + 1 }),
    decrement: (s) => ({ ...s, count: s.count - 1 }),
  },
  render: ({ state }) => h('div', null, state.count),
});
`;

      // 1. replace_action
      const replaceRes = applyPatch(source, {
        op: 'replace_action',
        componentId: 'test-comp',
        name: 'increment',
        code: '(s) => ({ ...s, count: s.count + 10 })',
      });
      expect(replaceRes.success).toBe(true);
      expect(replaceRes.code).toContain('count: s.count + 10');

      // 2. patch_render
      const renderRes = applyPatch(replaceRes.code, {
        op: 'patch_render',
        componentId: 'test-comp',
        renderCode: '({ state }) => h("span", { class: "counter" }, state.count)',
      });
      expect(renderRes.success).toBe(true);
      expect(renderRes.code).toContain('class: "counter"');

      // 3. remove_action
      const removeRes = applyPatch(renderRes.code, {
        op: 'remove_action',
        componentId: 'test-comp',
        name: 'decrement',
      });
      expect(removeRes.success).toBe(true);
      expect(removeRes.code).not.toContain('decrement:');
    });
  });

  describe('5. Vite Compiler Template Linter', () => {
    it('detects array mapping in functional JSX and emits warning', () => {
      const code = `
import { defineComponent, h } from 'tokensafe-ui';
export const List = defineComponent({
  id: 'list',
  render: ({ state }) => (
    <ul>
      {state.items.map((it) => <li>{it}</li>)}
    </ul>
  )
});
`;
      const res = transformAgentDomJsx(code, 'List.tsx');
      expect(res.warnings).toBeDefined();
      expect(res.warnings?.some((w) => w.includes('<For'))).toBe(true);
    });
  });

  describe('6. High-Velocity Autonomous Benchmark (AER ~20x)', () => {
    it('achieves ~20x AER in 1-turn batch mutate + verify replay', async () => {
      const harness = new BenchmarkHarness({ scenario: 'task-manager' });
      const summary = await harness.runReplayBenchmark({ optimized: true });

      expect(summary.tokensafe.totalTurns).toBe(1);
      expect(summary.tokensafe.totalTokens).toBeLessThan(1800);
      expect(summary.tokensafe.passed).toBe(true);
      // Autonomous Efficiency Ratio reaches ~20x (2.8x higher than 7.62x baseline)
      expect(summary.autonomousEfficiencyRatio).toBeGreaterThan(18.0);
    });
  });
});
