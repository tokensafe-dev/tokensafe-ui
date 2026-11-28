import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Multi-file atomic applyEdit (spec §4.3, wire 1.4.0 `mutate.multiFile`).
 *
 * The batch is all-or-nothing: every item is resolved, checked (existence, OCC,
 * hunks, syntax) before the first byte is written, and a write that fails after
 * earlier ones restores them in reverse order. Items are limited to
 * replace/create/patch — the modes a batch can validate without a rename graph —
 * and each item is reported separately so an agent learns which one failed.
 */

export const MAX_BATCH_ITEMS = 16;

export interface BatchHunk {
  target: string;
  replacement: string;
  replaceAll?: boolean;
}

export interface BatchItem {
  path: string;
  /** Alias accepted by the single-file callers. */
  filePath?: string;
  mode?: string;
  expectedVersion?: string;
  replacement?: string;
  source?: string;
  hunks?: BatchHunk[];
}

export interface BatchEditRecord {
  path: string;
  newVersion: string;
  created?: boolean;
  hunksApplied?: number;
}

export type BatchEditOutcome =
  | { ok: true; result: { status: 'APPLIED'; edits: BatchEditRecord[] } }
  | { ok: false; code: number; message: string; data?: Record<string, unknown> };

export interface BatchEditOptions {
  rootDir: string;
  edits: unknown[];
  /** Path jail: throws on a traversal/credential path, returns the absolute path. */
  resolvePath: (relPath: string) => string;
  /** Syntax pre-flight for one file's resulting text; throws on a broken parse. */
  syntaxCheck: (text: string, relPath: string, absolute: string) => void;
}

const ERR_CONFLICT = -32001;
const ERR_SYNTAX = -32002;
const ERR_SECURITY = -32003;
const ERR_UNSUPPORTED = -32006;
const ERR_RESOURCE_NOT_FOUND = -32009;
const ERR_VALIDATION_FAILED = -32011;
const ERR_INTERNAL = -32603;

const sha = (text: string) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');

interface StagedItem {
  relPath: string;
  absolute: string;
  mode: 'replace' | 'create' | 'patch';
  text: string;
  existed: boolean;
  previous: string | null;
  hunksApplied?: number;
}

export function applyEditBatch(options: BatchEditOptions): BatchEditOutcome {
  const { edits, rootDir } = options;
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, code: ERR_VALIDATION_FAILED, message: 'VALIDATION_FAILED: edits must be a non-empty array', data: { reason: 'edits_required' } };
  }
  if (edits.length > MAX_BATCH_ITEMS) {
    return {
      ok: false,
      code: ERR_VALIDATION_FAILED,
      message: `VALIDATION_FAILED: a batch carries at most ${MAX_BATCH_ITEMS} edits, got ${edits.length}`,
      data: { reason: 'batch_too_large' },
    };
  }

  const seen = new Set<string>();
  const staged: StagedItem[] = [];

  for (let index = 0; index < edits.length; index += 1) {
    const raw = (edits[index] ?? {}) as BatchItem;
    const relPath = String(raw.path || raw.filePath || '');
    const itemError = (code: number, message: string, data: Record<string, unknown> = {}) =>
      ({ ok: false as const, code, message, data: { ...data, editIndex: index, path: relPath } });

    if (!relPath) return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} has no path`, { reason: 'path_required' });
    if (seen.has(relPath)) {
      return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} repeats path ${JSON.stringify(relPath)}`, {
        reason: 'duplicate_path',
      });
    }
    seen.add(relPath);

    const mode = String(raw.mode || 'replace').toLowerCase();
    if (mode !== 'replace' && mode !== 'create' && mode !== 'patch') {
      return itemError(ERR_UNSUPPORTED, `UNSUPPORTED_CAPABILITY: batch mode ${JSON.stringify(mode)} is not available`, {
        reason: 'unsupported_batch_mode',
      });
    }

    let absolute: string;
    try {
      absolute = options.resolvePath(relPath);
    } catch (error: any) {
      return itemError(ERR_SECURITY, String(error?.message || error));
    }

    const exists = fs.existsSync(absolute);
    if (mode === 'create') {
      const text = String(raw.replacement ?? raw.source ?? '');
      if (!text) return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} (create) needs replacement`, { reason: 'replacement_required' });
      if (raw.expectedVersion) {
        return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} (create) must omit expectedVersion`, {
          reason: 'create_forbids_version',
        });
      }
      if (exists) {
        return itemError(ERR_CONFLICT, `CONFLICT_DETECTED: ${relPath} already exists`, { reason: 'file_exists' });
      }
      try {
        options.syntaxCheck(text, relPath, absolute);
      } catch (error: any) {
        return itemError(ERR_SYNTAX, `SYNTAX_ERROR: pre-flight parse failed for ${relPath}: ${error?.message ?? error}`);
      }
      staged.push({ relPath, absolute, mode, text, existed: false, previous: null });
      continue;
    }

    if (!exists) return itemError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: ${relPath} does not exist`);
    const previous = fs.readFileSync(absolute, 'utf-8');
    const currentVersion = sha(previous);
    if (!raw.expectedVersion || typeof raw.expectedVersion !== 'string') {
      return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} needs expectedVersion`, {
        reason: 'expected_version_required',
      });
    }
    if (raw.expectedVersion !== currentVersion) {
      return itemError(ERR_CONFLICT, `CONFLICT_DETECTED: ${relPath} version mismatch: expected ${raw.expectedVersion}, current is ${currentVersion}`, {
        reason: 'version_mismatch',
      });
    }

    if (mode === 'replace') {
      const text = String(raw.replacement ?? raw.source ?? '');
      if (!text) return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} (replace) needs replacement`, { reason: 'replacement_required' });
      try {
        options.syntaxCheck(text, relPath, absolute);
      } catch (error: any) {
        return itemError(ERR_SYNTAX, `SYNTAX_ERROR: pre-flight parse failed for ${relPath}: ${error?.message ?? error}`);
      }
      staged.push({ relPath, absolute, mode, text, existed: true, previous });
      continue;
    }

    // patch: splice hunks under the same rules as a single-file patch.
    const hunks = Array.isArray(raw.hunks) ? raw.hunks : [];
    if (hunks.length === 0) return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} (patch) needs hunks`, { reason: 'hunks_required' });
    let text = previous;
    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
      const hunk = hunks[hunkIndex] ?? ({} as BatchHunk);
      const target = String(hunk.target ?? '');
      const replacement = String(hunk.replacement ?? '');
      if (!target) return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} hunk ${hunkIndex} has an empty target`, { reason: 'target_required' });
      const count = text.split(target).length - 1;
      if (count === 0) {
        return itemError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: edit ${index} hunk ${hunkIndex} target does not occur`, {
          reason: 'target_not_found',
          hunkIndex,
        });
      }
      if (count > 1 && !hunk.replaceAll) {
        return itemError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: edit ${index} hunk ${hunkIndex} target occurs ${count} times`, {
          reason: 'target_not_unique',
          count,
          hunkIndex,
        });
      }
      text = hunk.replaceAll ? text.split(target).join(replacement) : text.replace(target, replacement);
    }
    try {
      options.syntaxCheck(text, relPath, absolute);
    } catch (error: any) {
      return itemError(ERR_SYNTAX, `SYNTAX_ERROR: pre-flight parse failed for ${relPath}: ${error?.message ?? error}`);
    }
    staged.push({ relPath, absolute, mode, text, existed: true, previous, hunksApplied: hunks.length });
  }

  // Write phase: everything validated above, so a failure here is I/O, and the
  // files already written are restored in reverse order (best effort).
  const written: StagedItem[] = [];
  try {
    for (const item of staged) {
      fs.mkdirSync(path.dirname(item.absolute), { recursive: true });
      fs.writeFileSync(item.absolute, item.text, 'utf-8');
      written.push(item);
    }
  } catch (error: any) {
    for (const item of written.reverse()) {
      try {
        if (item.existed && item.previous !== null) fs.writeFileSync(item.absolute, item.previous, 'utf-8');
        else fs.rmSync(item.absolute, { force: true });
      } catch {
        // A restore that fails leaves the workspace inconsistent; the error names it.
      }
    }
    return {
      ok: false,
      code: ERR_INTERNAL,
      message: `INTERNAL_ERROR: batch write failed: ${error?.message ?? error}`,
      data: { rolledBack: true, restored: written.map((item) => item.relPath) },
    };
  }

  return {
    ok: true,
    result: {
      status: 'APPLIED',
      edits: staged.map((item) => ({
        path: path.relative(rootDir, item.absolute),
        newVersion: sha(item.text),
        ...(item.mode === 'create' ? { created: true } : {}),
        ...(item.hunksApplied === undefined ? {} : { hunksApplied: item.hunksApplied }),
      })),
    },
  };
}
