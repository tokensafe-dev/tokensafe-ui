import { describe, it, expect } from 'vitest';
import { validateWorkspacePath, checkSecretLeak } from '../src/index.js';

describe('MCP Security Guard', () => {
  const root = '/Users/test/project';

  it('allows paths strictly within project root', () => {
    const valid = validateWorkspacePath('src/App.tsx', root);
    expect(valid).toBe('/Users/test/project/src/App.tsx');
  });

  it('blocks path traversal attacks (escapes workspace)', () => {
    expect(() => {
      validateWorkspacePath('../../etc/shadow', root);
    }).toThrow('Security Violation: Path traversal blocked');
  });

  it('blocks sibling directory traversal with prefix match (/project-evil vs /project)', () => {
    expect(() => {
      validateWorkspacePath('/Users/test/project-evil/file.ts', root);
    }).toThrow('Security Violation: Path traversal blocked');

    expect(() => {
      validateWorkspacePath('../project-sibling/file.ts', root);
    }).toThrow('Security Violation: Path traversal blocked');
  });

  it('detects and intercepts hardcoded private keys', () => {
    const code = ['const key = "', '-----BEGIN PRIVATE KEY-----', '\\nMII...'].join('');
    const check = checkSecretLeak(code);
    expect(check.hasLeak).toBe(true);
    expect(check.reason).toContain('private key detected');
  });

  it('detects and intercepts unmasked API tokens', () => {
    const prefix = 'ghp_';
    const fakeToken = prefix + '1234567890abcdef1234567890abcdef1234';
    const code = `const token = "${fakeToken}";`;
    const check = checkSecretLeak(code);
    expect(check.hasLeak).toBe(true);
    expect(check.reason).toContain('secret or API token');
  });

  it('passes clean source code', () => {
    const code = `export const UserCard = defineComponent({ id: 'user-card' });`;
    const check = checkSecretLeak(code);
    expect(check.hasLeak).toBe(false);
  });
});
