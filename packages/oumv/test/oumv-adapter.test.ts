import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defineComponent, z } from '@agent-dom/core';
import { createAgentDomAdapter } from '../src/index.js';

describe('@agent-dom/oumv - Native OUMV Protocol Adapter', () => {
  let tmpDir: string;
  let testFile: string;

  const sampleSource = `import { defineComponent, z } from '@agent-dom/core';

export const TaskCard = defineComponent({
  id: 'task-card',
  state: {
    title: z.string().default('Initial Task'),
    done: z.boolean().default(false),
  },
  actions: {
    toggle: (s) => ({ ...s, done: !s.done }),
  },
  render: ({ state }) => <div>{state.title}</div>,
});
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-adapter-'));
    testFile = path.join(tmpDir, 'TaskCard.tsx');
    fs.writeFileSync(testFile, sampleSource, 'utf-8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('performs protocol handshake and exchanges full capabilities', async () => {
    const adapter = createAgentDomAdapter({ projectRoot: tmpDir });
    const handshake = await adapter.handshake();

    expect(handshake.protocolVersion).toBe('1.0.0');
    expect(handshake.runtimeInfo.name).toBe('agent-dom');
    expect(handshake.capabilities.observe.levels).toContain('L1');
    expect(handshake.capabilities.understand.causality).toBe(true);
    expect(handshake.capabilities.mutate.occ).toBe(true);
    expect(handshake.capabilities.verify.multiMetric).toBe(true);
  });

  it('observes L0 pulse and L1 surface', async () => {
    const adapter = createAgentDomAdapter({ projectRoot: tmpDir });

    const l0 = await adapter.observe({ level: 'L0' });
    expect(l0.level).toBe('L0');
    expect(l0.payload).toContain('route:');

    const l1 = await adapter.observe({ level: 'L1' });
    expect(l1.level).toBe('L1');
    expect(l1.payload).toBeDefined();
  });

  it('understands impact analysis and queries dependency graph', async () => {
    const adapter = createAgentDomAdapter({ projectRoot: tmpDir });

    const impact: any = await adapter.understand({ query: 'impact', target: 'task-card' });
    expect(impact.target).toBe('task-card');
    expect(impact.safeComponents).toBeDefined();

    const deps: any = await adapter.understand({ query: 'dependencies' });
    expect(deps.yaml).toContain('dependency_graph:');
  });

  it('enforces OCC tokens on getSource and applyEdit', async () => {
    const adapter = createAgentDomAdapter({ projectRoot: tmpDir });

    const src = await adapter.getSource({
      componentId: 'task-card',
      filePath: 'TaskCard.tsx',
    });

    expect(src.version).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(src.source).toBe(sampleSource);

    // Test rejection of stale token
    await expect(
      adapter.applyEdit({
        filePath: 'TaskCard.tsx',
        source: sampleSource.replace('Initial Task', 'Hacked Task'),
        expectedVersion: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      })
    ).rejects.toThrow('CONFLICT_DETECTED');

    // Test successful edit with valid token
    const editRes = await adapter.applyEdit({
      filePath: 'TaskCard.tsx',
      source: sampleSource.replace('Initial Task', 'Updated Task'),
      expectedVersion: src.version,
    });

    expect(editRes.success).toBe(true);
    expect(editRes.version).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fs.readFileSync(testFile, 'utf-8')).toContain('Updated Task');
  });

  it('verifies actions with low-millisecond local testing API', async () => {
    const Component = defineComponent({
      id: 'verify-task-card',
      state: {
        done: z.boolean().default(false),
      },
      actions: {
        toggle: (s) => ({ ...s, done: !s.done }),
      },
      render: () => ({ type: 'div', props: {}, children: [] }),
    });

    Component(); // instantiate
    const adapter = createAgentDomAdapter({ projectRoot: tmpDir });

    const result = await adapter.verify({
      componentId: 'verify-task-card',
      action: 'toggle',
    });

    expect(result.status).toBe('passed');
    expect(result.diff.done).toEqual({ before: false, after: true });
    expect(result.timings.t_total_ms).toBeGreaterThan(0);
  });
});
