import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAgentDomMcpServer } from '../src/index.js';

describe('Optimistic Concurrency Control (OCC) & Source Mutation Guard', () => {
  let tmpDir: string;
  let testFilePath: string;
  let server: any;

  const initialSource = `import { defineComponent, z } from '@agent-dom/core';

export const Todo = defineComponent({
  id: 'todo-item',
  state: {
    title: z.string().default('Todo'),
  },
  actions: {},
  render: ({ state }) => <div>{state.title}</div>,
});
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dom-occ-'));
    testFilePath = path.join(tmpDir, 'Todo.tsx');
    fs.writeFileSync(testFilePath, initialSource, 'utf-8');

    server = createAgentDomMcpServer({ projectRoot: tmpDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // Helper to call server request handler
  const callTool = async (name: string, args: any) => {
    const handler = (server as any)._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Tool call handler not found');
    return handler({ method: 'tools/call', params: { name, arguments: args } }, {});
  };

  it('retrieves component source with a sha256 version concurrency token', async () => {
    const res = await callTool('agent_dom_get_component_source', {
      componentId: 'todo-item',
      filePath: 'Todo.tsx',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.componentId).toBe('todo-item');
    expect(data.version).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('applies source edit successfully when expectedVersion matches', async () => {
    const getRes = await callTool('agent_dom_get_component_source', {
      componentId: 'todo-item',
      filePath: 'Todo.tsx',
    });
    const version = JSON.parse(getRes.content[0].text).version;

    const newSource = initialSource.replace("id: 'todo-item'", "id: 'updated-todo-item'");
    const editRes = await callTool('agent_dom_apply_source_edit', {
      filePath: 'Todo.tsx',
      source: newSource,
      expectedVersion: version,
    });

    expect(editRes.isError).toBeFalsy();
    const diskContent = fs.readFileSync(testFilePath, 'utf-8');
    expect(diskContent).toContain('updated-todo-item');
  });

  it('rejects source edit with CONFLICT_DETECTED if file was modified concurrently', async () => {
    const getRes = await callTool('agent_dom_get_component_source', {
      componentId: 'todo-item',
      filePath: 'Todo.tsx',
    });
    const staleVersion = JSON.parse(getRes.content[0].text).version;

    // Simulate concurrent external edit on disk
    fs.writeFileSync(testFilePath, initialSource + '\n// external concurrent change', 'utf-8');

    const editRes = await callTool('agent_dom_apply_source_edit', {
      filePath: 'Todo.tsx',
      source: initialSource.replace('Todo', 'My Conflict'),
      expectedVersion: staleVersion,
    });

    expect(editRes.isError).toBe(true);
    expect(editRes.content[0].text).toContain('CONFLICT_DETECTED');
    // Verify file was NOT modified by the rejected edit
    const diskContent = fs.readFileSync(testFilePath, 'utf-8');
    expect(diskContent).not.toContain('My Conflict');
  });

  it('rejects source edit with SYNTAX_ERROR if TypeScript/JSX is invalid', async () => {
    const getRes = await callTool('agent_dom_get_component_source', {
      componentId: 'todo-item',
      filePath: 'Todo.tsx',
    });
    const version = JSON.parse(getRes.content[0].text).version;

    const invalidSource = `export const Broken = { def::: broken syntax !!! };`;

    const editRes = await callTool('agent_dom_apply_source_edit', {
      filePath: 'Todo.tsx',
      source: invalidSource,
      expectedVersion: version,
    });

    expect(editRes.isError).toBe(true);
    expect(editRes.content[0].text).toContain('SYNTAX_ERROR');
    // Verify disk content unchanged
    expect(fs.readFileSync(testFilePath, 'utf-8')).toBe(initialSource);
  });
});
