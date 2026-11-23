import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTokensafeMcpServer } from '../src/server.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('New MCP Tools: tokensafe_test_effect & tokensafe_patch_component', () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokensafe-mcp-test-'));
    testFile = path.join(tmpDir, 'Counter.tsx');
    fs.writeFileSync(
      testFile,
      `import { defineComponent, z } from 'tokensafe-ui';

export const Counter = defineComponent({
  id: 'counter',
  state: { count: z.number().default(0) },
  actions: {
    inc: (s) => ({ ...s, count: s.count + 1 }),
  },
  render: ({ state }) => <div data-agent-id="root">{state.count}</div>,
});
`
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('exposes tokensafe_test_effect and tokensafe_patch_component in listTools', async () => {
    const server = createTokensafeMcpServer({ projectRoot: tmpDir });
    const listHandler = (server as any)._requestHandlers.get('tools/list');
    const result = await listHandler({ method: 'tools/list' });
    const toolNames = result.tools.map((t: any) => t.name);

    expect(toolNames).toContain('tokensafe_test_effect');
    expect(toolNames).toContain('tokensafe_patch_component');
    expect(toolNames).toContain('tokensafe_ui_test_effect');
    expect(toolNames).toContain('tokensafe_ui_patch_component');
  });

  it('patches component AST using tokensafe_patch_component', async () => {
    const server = createTokensafeMcpServer({ projectRoot: tmpDir });
    const callHandler = (server as any)._requestHandlers.get('tools/call');

    const res = await callHandler({
      method: 'tools/call',
      params: {
        name: 'tokensafe_patch_component',
        arguments: {
          componentId: 'counter',
          filePath: 'Counter.tsx',
          target: 'action',
          name: 'inc',
          code: '(s, step = 5) => ({ ...s, count: s.count + step })',
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.name).toBe('inc');

    const updated = fs.readFileSync(testFile, 'utf-8');
    expect(updated).toContain('count: s.count + step');
  });
});
