import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { defineComponent, z, h, mount, testAction, unmount } from 'tokensafe-ui';
import { observe, buildDependencyGraph } from 'tokensafe-ui/observer';
import { atomicApplySourceEdit } from 'tokensafe-ui/mcp';

describe('Real Agent Workflow: Autonomous Observe -> Understand -> Mutate -> Verify Loop', () => {
  let tmpDir: string;
  let componentFilePath: string;

  const initialComponentSource = `import { defineComponent, z, h } from 'tokensafe-ui';

export const TaskBoard = defineComponent({
  id: 'task-board',
  state: {
    title: z.string().default('TokenSafe Tasks'),
    count: z.number().default(1),
    status: z.enum(['Active', 'Completed']).default('Active'),
  },
  actions: {
    increment: (s) => ({ ...s, count: s.count + 1 }),
    decrement: (s) => ({ ...s, count: Math.max(0, s.count - 1) }),
    reset: (s) => ({ ...s, count: 0 }),
  },
  render: ({ state, emit }) =>
    h(
      'div',
      { class: 'task-board', 'data-agent-id': 'task-board:root' },
      h('h1', { 'data-agent-id': 'task-board:title' }, () => state.title),
      h('span', { 'data-agent-id': 'task-board:count' }, () => state.count),
      h('button', { 'data-agent-id': 'task-board:btn-inc', onClick: emit.increment }, '+'),
      h('button', { 'data-agent-id': 'task-board:btn-dec', onClick: emit.decrement }, '-'),
      h('button', { 'data-agent-id': 'task-board:btn-reset', onClick: emit.reset }, 'Reset')
    ),
});
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokensafe-workflow-test-'));
    componentFilePath = path.join(tmpDir, 'TaskBoard.tsx');
    fs.writeFileSync(componentFilePath, initialComponentSource, 'utf-8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('autonomously completes the full OUMV cycle on a live application', async () => {
    // -------------------------------------------------------------
    // PHASE 1: OBSERVE
    // -------------------------------------------------------------
    const TaskBoard = defineComponent({
      id: 'task-board',
      filePath: componentFilePath,
      state: {
        title: z.string().default('TokenSafe Tasks'),
        count: z.number().default(1),
        status: z.enum(['Active', 'Completed']).default('Active'),
      },
      actions: {
        increment: (s) => ({ ...s, count: s.count + 1 }),
        decrement: (s) => ({ ...s, count: Math.max(0, s.count - 1) }),
        reset: (s) => ({ ...s, count: 0 }),
      },
      render: ({ state, emit }) =>
        h(
          'div',
          { class: 'task-board', 'data-agent-id': 'task-board:root' },
          h('h1', { 'data-agent-id': 'task-board:title' }, () => state.title),
          h('span', { 'data-agent-id': 'task-board:count' }, () => state.count),
          h('button', { 'data-agent-id': 'task-board:btn-inc', onClick: emit.increment }, '+'),
          h('button', { 'data-agent-id': 'task-board:btn-dec', onClick: emit.decrement }, '-'),
          h('button', { 'data-agent-id': 'task-board:btn-reset', onClick: emit.reset }, 'Reset')
        ),
    });

    const instance = TaskBoard();
    const container = document.createElement('div');
    mount(instance, container);

    // 1.1 L0 Pulse (Bird-eye overview)
    const l0 = observe(container.firstElementChild as HTMLElement, {
      level: 'L0',
      format: 'json',
    }) as any;
    expect(l0.mounted).toContain('task-board');
    expect(l0.errors).toBe(0);

    // 1.2 L1 Surface (Actionable controls)
    const l1 = observe(container.firstElementChild as HTMLElement, {
      level: 'L1',
      format: 'json',
    }) as any;
    expect(l1.view).toBe('task-board');
    expect(l1.elements.some((e: any) => e.id === 'task-board:btn-inc' && e.action === 'increment')).toBe(true);

    // 1.3 L2 Contract (State Schema & Actions)
    const l2 = observe(container.firstElementChild as HTMLElement, {
      level: 'L2',
      format: 'json',
    }) as any;
    expect(l2.actions).toEqual(['increment', 'decrement', 'reset']);
    expect(l2.state.count.current).toBe(1);

    // 1.4 L3 Isolated AST Source Slice
    const l3 = observe(container.firstElementChild as HTMLElement, {
      level: 'L3',
      filePath: componentFilePath,
      format: 'json',
    }) as any;
    expect(l3.isolatedSource).toContain("id: 'task-board'");
    expect(l3.agentIdLineMap['task-board:btn-inc']).toBeGreaterThan(0);

    // -------------------------------------------------------------
    // PHASE 2: UNDERSTAND (Dependency Graph & Causality)
    // -------------------------------------------------------------
    // Agent dispatches increment to trigger a state change
    instance.emit.increment();
    expect(instance.state.count).toBe(2);

    const graph = buildDependencyGraph();

    // 2.1 Impact Analysis
    const impact = graph.analyzeImpact('count');
    expect(impact.directlyAffected).toContain('task-board');
    expect(impact.recommendation).toContain("Editing 'count' directly impacts: [task-board]");

    // 2.2 Causality Telemetry (Why is count = 2?)
    const causality = graph.traceCausality('task-board.count');
    expect(causality).not.toBeNull();
    expect(causality?.value).toBe(2);
    expect(causality?.lastMutation?.actionName).toBe('increment');
    expect(causality?.explanation).toContain("Last mutated by action 'increment'");

    // -------------------------------------------------------------
    // PHASE 3: MUTATE (Safe OCC Symbol Mutation & Rollback)
    // -------------------------------------------------------------
    const currentVersion =
      'sha256:' + crypto.createHash('sha256').update(initialComponentSource).digest('hex');

    // 3.1 Attempt invalid syntax mutation -> Must be rejected with rollback
    const brokenSource = initialComponentSource.replace('count: 0', 'count: ;;; broken syntax');
    expect(() => {
      atomicApplySourceEdit(componentFilePath, brokenSource, { expectedVersion: currentVersion });
    }).toThrow(/SYNTAX_ERROR/);
    expect(fs.readFileSync(componentFilePath, 'utf-8')).toBe(initialComponentSource);

    // 3.2 Add new 'double' action with valid TypeScript and matching OCC version
    const updatedSource = initialComponentSource.replace(
      'reset: (s) => ({ ...s, count: 0 }),',
      `reset: (s) => ({ ...s, count: 0 }),\n    double: (s) => ({ ...s, count: s.count * 2 }),`
    );

    const mutateResult = atomicApplySourceEdit(componentFilePath, updatedSource, {
      expectedVersion: currentVersion,
    });
    expect(mutateResult.success).toBe(true);
    expect(fs.readFileSync(componentFilePath, 'utf-8')).toBe(updatedSource);

    // -------------------------------------------------------------
    // PHASE 4: VERIFY (Low-Latency Action Execution & State Diffs)
    // -------------------------------------------------------------
    // Define updated component contract in memory to test action execution
    const UpdatedTaskBoard = defineComponent({
      id: 'task-board-v2',
      state: {
        title: z.string().default('TokenSafe Tasks'),
        count: z.number().default(3),
        status: z.enum(['Active', 'Completed']).default('Active'),
      },
      actions: {
        increment: (s) => ({ ...s, count: s.count + 1 }),
        decrement: (s) => ({ ...s, count: Math.max(0, s.count - 1) }),
        reset: (s) => ({ ...s, count: 0 }),
        double: (s) => ({ ...s, count: s.count * 2 }),
      },
      render: ({ state }) => h('div', null, state.count),
    });

    UpdatedTaskBoard();

    // Verify the newly added action in single-digit milliseconds
    const testResult = await testAction('task-board-v2', 'double');
    expect(testResult.status).toBe('passed');
    expect(testResult.diff.count.before).toBe(3);
    expect(testResult.diff.count.after).toBe(6);
    expect(testResult.durationMs).toBeLessThan(50);

    // Clean up
    unmount(container);
  });
});
