import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  atomicApplySourceEdit,
  validateSourceSyntaxAndTypes,
} from '../src/index.js';

describe('Atomic Mutation Engine & Type Guard', () => {
  let tmpDir: string;
  let testFile: string;
  const initialSource = `export const Counter = defineComponent({
  id: 'counter',
  state: { count: z.number().default(0) },
  actions: { inc: (s) => ({ ...s, count: s.count + 1 }) },
  render: ({ state }) => h('div', null, state.count)
});
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokensafe-mutation-test-'));
    testFile = path.join(tmpDir, 'Counter.tsx');
    fs.writeFileSync(testFile, initialSource, 'utf-8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('validates clean syntax and TypeScript successfully', () => {
    expect(() => {
      validateSourceSyntaxAndTypes(initialSource, 'Counter.tsx');
    }).not.toThrow();
  });

  it('rejects invalid syntax without touching disk', () => {
    const invalidSyntax = `export const Broken = { syntax error !!!`;
    expect(() => {
      atomicApplySourceEdit(testFile, invalidSyntax);
    }).toThrow(/SYNTAX_ERROR/);

    // Original file must remain pristine
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(initialSource);
  });

  it('rejects secret leaks before writing', () => {
    const prefix = 'ghp_';
    const fakeKey = prefix + '111122223333444455556666777788889999';
    const leakSource = `const token = "${fakeKey}";\n` + initialSource;
    expect(() => {
      atomicApplySourceEdit(testFile, leakSource);
    }).toThrow(/SECURITY_VIOLATION/);

    expect(fs.readFileSync(testFile, 'utf-8')).toBe(initialSource);
  });

  it('enforces OCC token matching', () => {
    const wrongVersion = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const newValidSource = initialSource.replace('count + 1', 'count + 2');

    expect(() => {
      atomicApplySourceEdit(testFile, newValidSource, { expectedVersion: wrongVersion });
    }).toThrow(/CONFLICT_DETECTED/);

    expect(fs.readFileSync(testFile, 'utf-8')).toBe(initialSource);
  });

  it('atomically applies valid source edit with new version hash', () => {
    const currentVersion =
      'sha256:' + crypto.createHash('sha256').update(initialSource).digest('hex');
    const newValidSource = initialSource.replace('count + 1', 'count + 5');

    const result = atomicApplySourceEdit(testFile, newValidSource, {
      expectedVersion: currentVersion,
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(newValidSource);
    expect(result.version).toBe(
      'sha256:' + crypto.createHash('sha256').update(newValidSource).digest('hex')
    );
  });
});
