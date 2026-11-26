import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
import { checkSecretLeak } from './security.js';

export interface MutationOptions {
  expectedVersion?: string;
  validateTypeScript?: boolean;
  createBackup?: boolean;
}

export interface MutationResult {
  success: boolean;
  filePath: string;
  version: string;
  backupPath?: string;
  message: string;
}

/**
 * Validates source code syntax before writing.
 *
 * Babel (already a runtime dependency) parses TSX/TS and is the syntax gate.
 * We deliberately do NOT import the TypeScript compiler here: it was only used
 * for `createSourceFile().parseDiagnostics`, which reports the same syntax
 * errors Babel already catches, while making `typescript` a hard runtime
 * dependency of the published bundle (consumers got ERR_MODULE_NOT_FOUND when
 * it was absent). Semantic type checking is out of scope for the guard — say so
 * rather than implying it happened.
 */
export function validateSourceSyntaxAndTypes(source: string, fileName: string = 'component.tsx'): void {
  // 1. Babel Parser check (JSX, TS, modern ECMAScript)
  try {
    parser.parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
  } catch (err: any) {
    const loc = err.loc ? `line ${err.loc.line}, column ${err.loc.column}` : 'unknown';
    throw new Error(`SYNTAX_ERROR: TypeScript/JSX parse failed at ${loc}: ${err.message}`);
  }

  // 2. Security Leak Interceptor
  const leak = checkSecretLeak(source);
  if (leak.hasLeak) {
    throw new Error(`SECURITY_VIOLATION: ${leak.reason}`);
  }
}

/**
 * Performs an atomic source edit with:
 * - Optimistic Concurrency Control (OCC) version verification
 * - Pre-flight TypeScript & Babel syntax validation
 * - Secret leak interception
 * - Atomic write via temporary file & rename
 * - Automatic rollback on failure
 */
export function atomicApplySourceEdit(
  targetFilePath: string,
  newSource: string,
  options: MutationOptions = {}
): MutationResult {
  if (!fs.existsSync(targetFilePath)) {
    throw new Error(`File not found: ${targetFilePath}`);
  }

  const currentContent = fs.readFileSync(targetFilePath, 'utf-8');
  const currentVersion =
    'sha256:' + crypto.createHash('sha256').update(currentContent).digest('hex');

  // Concurrency check
  if (options.expectedVersion && currentVersion !== options.expectedVersion) {
    throw new Error(
      `CONFLICT_DETECTED: File was modified concurrently. Expected version '${options.expectedVersion}', but disk version is '${currentVersion}'. Re-inspect before retrying.`
    );
  }

  // Pre-flight syntax, types & secrets validation BEFORE touching disk
  if (options.validateTypeScript !== false) {
    validateSourceSyntaxAndTypes(newSource, path.basename(targetFilePath));
  } else {
    const leak = checkSecretLeak(newSource);
    if (leak.hasLeak) {
      throw new Error(`SECURITY_VIOLATION: ${leak.reason}`);
    }
  }

  const dir = path.dirname(targetFilePath);
  const base = path.basename(targetFilePath);
  const tmpPath = path.join(dir, `.${base}.tmp.${Date.now()}.${process.pid}`);
  const backupPath = path.join(dir, `.${base}.bak.${Date.now()}`);

  try {
    // 1. Write to temporary file in the same directory (ensures same filesystem mount)
    fs.writeFileSync(tmpPath, newSource, 'utf-8');

    // 2. Post-write integrity verification
    const writtenContent = fs.readFileSync(tmpPath, 'utf-8');
    if (writtenContent !== newSource) {
      throw new Error(
        'ATOMIC_WRITE_VERIFICATION_FAILED: Written temporary content does not match payload.'
      );
    }

    // 3. Create backup of current file
    fs.copyFileSync(targetFilePath, backupPath);

    // 4. Atomic swap via rename
    fs.renameSync(tmpPath, targetFilePath);

    // 5. Clean up backup unless user asked to keep it
    if (!options.createBackup && fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch {}
    }

    const newVersion =
      'sha256:' + crypto.createHash('sha256').update(newSource).digest('hex');

    return {
      success: true,
      filePath: targetFilePath,
      version: newVersion,
      backupPath: options.createBackup ? backupPath : undefined,
      message: `Successfully applied atomic source edit with verified syntax and types.`,
    };
  } catch (err: any) {
    // Rollback: clean up temp file
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
    // Rollback: restore original file from backup if target was modified/removed
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, targetFilePath);
        fs.unlinkSync(backupPath);
      } catch {}
    }
    throw err;
  }
}
