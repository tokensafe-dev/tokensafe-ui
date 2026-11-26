import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function getTokensafeHomeDir(): string {
  return process.env.TOKENSAFE_HOME
    ? path.resolve(process.env.TOKENSAFE_HOME)
    : path.join(os.homedir(), '.tokensafe');
}

export function getCanonicalWorkspaceRoot(rootDir: string): string {
  const abs = path.resolve(rootDir);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

export function getWorkspaceRuntimeId(rootDir: string): string {
  const canonical = getCanonicalWorkspaceRoot(rootDir);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function getGlobalRuntimeDescriptorPath(rootDir: string): string {
  return path.join(getTokensafeHomeDir(), 'runtimes', `${getWorkspaceRuntimeId(rootDir)}.json`);
}

export function getGlobalContractsPath(rootDir: string): string {
  return path.join(getTokensafeHomeDir(), 'contracts', `${getWorkspaceRuntimeId(rootDir)}.json`);
}

export function isTokensafeIgnoredInRepo(rootDir: string): boolean {
  const tokensafeDir = path.join(rootDir, '.tokensafe');
  if (fs.existsSync(tokensafeDir)) {
    return true;
  }
  try {
    const gitignorePath = path.join(rootDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      return content
        .split(/\r?\n/)
        .some((line) => /^\s*\/?\.tokensafe\/?\s*(#.*)?$/.test(line));
    }
  } catch {}
  return false;
}

function writeJsonDescriptorFile(
  filePath: string,
  updater: (existing: Record<string, any>) => Record<string, any> | null
): void {
  try {
    let existing: Record<string, any> = {};
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {};
      } catch {}
    }
    const next = updater(existing);
    if (next === null) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {}
  } catch {}
}

export function writeWorkspaceRuntimeDescriptor(
  rootDir: string,
  section: 'frontend' | 'backend',
  entry: Record<string, unknown>
): void {
  const canonicalRoot = getCanonicalWorkspaceRoot(rootDir);
  const globalFile = getGlobalRuntimeDescriptorPath(rootDir);
  const updater = (existing: Record<string, any>) => ({
    ...existing,
    workspaceRoot: canonicalRoot,
    pid: process.pid,
    updatedAt: Date.now(),
    [section]: entry,
  });

  writeJsonDescriptorFile(globalFile, updater);

  // Zero repo footprint: only write inside <rootDir>/.tokensafe if it already exists or is gitignored
  if (isTokensafeIgnoredInRepo(rootDir)) {
    const localFile = path.join(rootDir, '.tokensafe', 'runtime.json');
    writeJsonDescriptorFile(localFile, updater);
  }
}

export function clearWorkspaceRuntimeDescriptor(rootDir: string, section: 'frontend' | 'backend'): void {
  const updater = (existing: Record<string, any>) => {
    if (!existing || typeof existing !== 'object') return null;
    if (existing.pid && existing.pid !== process.pid) return existing;
    const copy = { ...existing };
    delete copy[section];
    if (!copy.frontend && !copy.backend) {
      return null;
    }
    return copy;
  };

  writeJsonDescriptorFile(getGlobalRuntimeDescriptorPath(rootDir), updater);
  const localFile = path.join(rootDir, '.tokensafe', 'runtime.json');
  if (fs.existsSync(localFile)) {
    writeJsonDescriptorFile(localFile, updater);
  }
}
