import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli.js';

describe('tokensafe-ui CLI Runner', () => {
  it('prints usage when invoked with --help or help', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      await runCli(['node', 'tokensafe-ui', 'help']);
      const output = logs.join('\n');
      expect(output).toContain('TokenSafe UI Agent CLI');
      expect(output).toContain('tokensafe-ui test-action');
      expect(output).toContain('tokensafe-ui test-effect');
      expect(output).toContain('tokensafe-ui patch');
      expect(output).toContain('tokensafe-ui oracle');
    } finally {
      console.log = origLog;
    }
  });
});
