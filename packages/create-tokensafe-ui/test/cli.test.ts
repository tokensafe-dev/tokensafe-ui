import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../bin/index.js');

describe('Scaffolding CLI (create-tokensafe-ui)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokensafe-cli-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('scaffolds a complete starter project with config and components', () => {
    const targetProject = path.join(tmpDir, 'test-app');
    execSync(`node "${cliPath}" "${targetProject}"`, { stdio: 'pipe' });

    expect(fs.existsSync(path.join(targetProject, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetProject, 'tsconfig.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetProject, 'vite.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(targetProject, 'src/main.ts'))).toBe(true);
    expect(fs.existsSync(path.join(targetProject, 'src/App.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(targetProject, '.mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetProject, '.gitignore'))).toBe(true);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(targetProject, 'package.json'), 'utf-8')
    );
    expect(pkg.name).toBe('test-app');
    expect(pkg.dependencies['tokensafe-ui']).toBeDefined();
  });
});
