import type { ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
// Static discovery + contracts are solid-free entry points: importing the oumv
// index here would evaluate the native runtime for a React-only project.
import { scanProjectStaticResources, scanSourceForComponents } from '@tokensafe-ui/oumv/static';
import { listOUMVComponentContracts, type OumvContractRecord, type OumvStreamTrace } from '@tokensafe-ui/oumv/contracts';
// Loaded lazily: the React controller must not evaluate the native runtime (or its
// solid-js dependency) just to serve observe/verify.
const loadMcpTools = () => import('@tokensafe-ui/mcp');
import { getCanonicalWorkspaceRoot, getGlobalContractsPath } from './runtime-store.js';

function readSidecarContracts(rootDir: string): OumvContractRecord[] {
  const candidateFiles = [
    getGlobalContractsPath(rootDir),
    path.join(rootDir, '.tokensafe', 'contracts.json'),
  ];
  const out: OumvContractRecord[] = [];
  for (const file of candidateFiles) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.contracts)
          ? parsed.contracts
          : parsed && typeof parsed === 'object'
            ? Object.entries(parsed).map(([componentId, body]: [string, any]) => ({
                componentId,
                ...(body && typeof body === 'object' ? body : {}),
              }))
            : [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const componentId = String(item.componentId || item.id || '').trim();
        if (!componentId) continue;
        const componentName = String(item.componentName || item.name || componentId).trim();
        out.push({
          componentId,
          componentName,
          description: String(item.description || ''),
          ...(item.actions ? { actions: item.actions } : {}),
          ...(item.constraints ? { constraints: item.constraints } : {}),
          ...(item.stateNotes ? { stateNotes: item.stateNotes } : {}),
          evidence: {
            provenance: 'contract',
            sourceAdapter: 'tokensafe-ui-react-vite-sidecar',
            confidence: 'confirmed',
          },
        });
      }
    } catch {}
  }
  return out;
}

export interface ReactBridgeComponent {
  id: string;
  name: string;
  instances: number;
  propsKeys: string[];
  hooksCount: number;
  source?: { fileName?: string; lineNumber?: number };
}

export interface ReactBridgeSurfaceItem {
  id: string;
  tag: string;
  role: string;
  label?: string;
  value?: unknown;
  disabled?: boolean;
  href?: string;
  action?: string;
  component?: string;
}

export interface ReactBridgeSnapshot {
  framework: 'react';
  route: string;
  title: string;
  elementCount: number;
  mountedComponents: ReactBridgeComponent[];
  interactiveSurface: ReactBridgeSurfaceItem[];
  registeredStores: Record<string, { state: Record<string, unknown>; actions: string[] }>;
  registeredComponents: Record<string, { state: Record<string, unknown>; actions: string[] }>;
  contracts: OumvContractRecord[];
  errorsCount: number;
  errors: Array<{ message: string; filename?: string; lineno?: number }>;
  tracesCount: number;
  timestamp: number;
}

export interface ReactRpcOptions {
  rootDir: string;
  sessionToken?: string;
  server?: ViteDevServer;
}

const ERR_CONFLICT = -32001;
const ERR_SYNTAX = -32002;
const ERR_SECURITY = -32003;
const ERR_COMPONENT_NOT_FOUND = -32004;
const ERR_ACTION_NOT_FOUND = -32005;
const ERR_UNSUPPORTED = -32006;
const ERR_PERMISSION_DENIED = -32007;
const ERR_RUNTIME_UNAVAILABLE = -32008;
const ERR_RESOURCE_NOT_FOUND = -32009;
const ERR_STALE_RESOURCE_VERSION = -32010;
const ERR_VALIDATION_FAILED = -32011;
const ERR_INVALID_PARAMS = -32602;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INTERNAL = -32603;

export type OumvEvidenceProvenance = 'static' | 'runtime' | 'contract' | 'inferred' | 'external';
export type OumvEvidenceConfidence = 'confirmed' | 'probable' | 'unknown';

export interface OumvEvidenceMetadata {
  provenance: OumvEvidenceProvenance;
  sourceAdapter: string;
  confidence: OumvEvidenceConfidence;
  observedAt?: number;
  filePath?: string;
  lineRange?: [number, number];
}

export interface OumvResourceReference {
  id: string;
  type: 'frontend.component' | 'frontend.route' | 'frontend.action' | 'frontend.state' | 'frontend.effect';
  name: string;
  parentRef?: string;
  sourceLocation?: {
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
  };
  versionToken?: string;
  evidence: OumvEvidenceMetadata;
  availableOperations: string[];
}

export interface OumvResourceCollection {
  resources: OumvResourceReference[];
  total: number;
  provenanceSummary: Record<OumvEvidenceProvenance, number>;
}

function summarizeProvenance(resources: OumvResourceReference[]): Record<OumvEvidenceProvenance, number> {
  const summary: Record<OumvEvidenceProvenance, number> = {
    static: 0,
    runtime: 0,
    contract: 0,
    inferred: 0,
    external: 0,
  };
  for (const r of resources) {
    summary[r.evidence.provenance] = (summary[r.evidence.provenance] || 0) + 1;
  }
  return summary;
}

function readReactVersion(rootDir: string): string {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.dependencies?.react || pkg.devDependencies?.react || '18.x/19.x';
    }
  } catch {}
  return '18.x/19.x';
}

function isMutateDisabled(rootDir: string): boolean {
  try {
    const oumvCfg = path.join(rootDir, '.tokensafe', 'oumv.json');
    if (fs.existsSync(oumvCfg)) {
      const cfg = JSON.parse(fs.readFileSync(oumvCfg, 'utf-8'));
      return cfg?.permissions?.mutate === false;
    }
  } catch {}
  return false;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.isFile() && /\.(tsx|jsx|ts|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function buildImportDependencyMap(rootDir: string): Map<string, string[]> {
  const files = collectSourceFiles(path.join(rootDir, 'src'));
  const importersOf = new Map<string, string[]>();

  for (const file of files) {
    const relFromRoot = path.relative(rootDir, file).replace(/\\/g, '/');
    let src = '';
    try {
      src = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(src)) !== null) {
      const spec = m[1];
      const base = path.resolve(path.dirname(file), spec);
      const candidates = [
        base,
        `${base}.tsx`,
        `${base}.ts`,
        `${base}.jsx`,
        `${base}.js`,
        path.join(base, 'index.tsx'),
        path.join(base, 'index.ts'),
      ];
      const target = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (target) {
        const relTarget = path.relative(rootDir, target).replace(/\\/g, '/');
        const list = importersOf.get(relTarget) || [];
        if (!list.includes(relFromRoot)) list.push(relFromRoot);
        importersOf.set(relTarget, list);
      }
    }
  }

  return importersOf;
}

function replaceLinesAt(source: string, startLine: number, endLine: number, replacement: string): string {
  const lines = source.split('\n');
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  const middle = replacement.split('\n');
  if (replacement.endsWith('\n')) middle.pop();
  let patched = [...before, ...middle, ...after].join('\n');
  if (source.endsWith('\n') && !patched.endsWith('\n')) patched += '\n';
  return patched;
}

function pageSlice<T>(items: T[], limitRaw: unknown, cursorRaw: unknown): { page: T[]; hasMore?: boolean; nextCursor?: string } {
  const raw = Number(limitRaw);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  let start = Number.parseInt(String(cursorRaw ?? ''), 10);
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (start > items.length) start = items.length;
  if (limit && start + limit < items.length) {
    return { page: items.slice(start, start + limit), hasMore: true, nextCursor: String(start + limit) };
  }
  return { page: items.slice(start), ...(limit ? { hasMore: false } : {}) };
}

function extractSymbolRange(source: string, symbolName: string): { source: string; startLine: number; endLine: number } | null {
  try {
    const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    const lines = source.split('\n');
    const slice = (startLine: number, endLine: number) => ({
      source: lines.slice(startLine - 1, endLine).join('\n'),
      startLine,
      endLine,
    });
    const classMatches = (node: any): { source: string; startLine: number; endLine: number } | null => {
      const declaration =
        node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
      if (!declaration || (declaration.type !== 'ClassDeclaration' && declaration.type !== 'ClassExpression')) return null;
      if (!declaration.loc) return null;
      const className: string = declaration.id?.name || '';
      if (className && className === symbolName) return slice(declaration.loc.start.line, declaration.loc.end.line);
      for (const member of declaration.body?.body || []) {
        const key = member.key;
        const memberName = key?.type === 'Identifier' ? key.name : key?.type === 'StringLiteral' ? key.value : undefined;
        // `toggleTask` and `TaskManagerStore.toggleTask` both address a method.
        if (member.loc && memberName && (memberName === symbolName || `${className}.${memberName}` === symbolName)) {
          return slice(member.loc.start.line, member.loc.end.line);
        }
      }
      return null;
    };
    for (const node of ast.program.body) {
      const member = classMatches(node);
      if (member) return member;
      let name: string | undefined;
      if (node.type === 'FunctionDeclaration' && node.id) {
        name = node.id.name;
      } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          name = node.declaration.id.name;
        } else if (node.declaration.type === 'VariableDeclaration') {
          const first = node.declaration.declarations[0];
          if (first?.id.type === 'Identifier') name = first.id.name;
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          name = node.declaration.id.name;
        }
      } else if (node.type === 'VariableDeclaration') {
        const first = node.declarations[0];
        if (first?.id.type === 'Identifier') name = first.id.name;
      }
      if (name === symbolName && node.loc) {
        const startLine = node.loc.start.line;
        const endLine = node.loc.end.line;
        return {
          source: lines.slice(startLine - 1, endLine).join('\n'),
          startLine,
          endLine,
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Realpath jail for every file operation the controller performs. Same semantics
 * as the MCP guard, kept local on purpose: importing the MCP bundle just to resolve
 * a path cost ~200-400 ms on the first getSource/observe L3.
 */
function validateProjectPath(inputPath: string, projectRoot: string): string {
  let canonicalRoot = path.resolve(projectRoot);
  try {
    if (fs.existsSync(canonicalRoot)) canonicalRoot = fs.realpathSync(canonicalRoot);
  } catch {}
  let resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(canonicalRoot, inputPath);
  try {
    if (fs.existsSync(resolved)) resolved = fs.realpathSync(resolved);
  } catch {}
  const rootWithSep = canonicalRoot.endsWith(path.sep) ? canonicalRoot : canonicalRoot + path.sep;
  if (resolved !== canonicalRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(
      `Security Violation: Path traversal blocked. Target '${inputPath}' escapes workspace root '${projectRoot}'.`
    );
  }
  return resolved;
}

export function createReactOumvController(options: ReactRpcOptions) {
  // Every path the controller reports is relative to the canonical root. Without
  // this, a symlinked root (macOS /var → /private/var, a linked checkout) leaks
  // `../../..` into `path`/`backupPath`: the jail realpaths the file, not the root.
  const rootDir = getCanonicalWorkspaceRoot(options.rootDir);
  const { server } = options;
  const reactVersion = readReactVersion(rootDir);
  // applyEdit is the only path that needs the edit engine; warm it in the
  // background so the first mutation does not pay the bundle import.
  setTimeout(() => {
    void loadMcpTools().catch(() => {});
  }, 0);
  const traces: Array<OumvStreamTrace & Record<string, any>> = [];
  const MAX_TRACES = 128;
  let traceSeq = 0;

  let latestSnapshot: ReactBridgeSnapshot | null = null;
  let lastClientSeenAt = 0;

  const pendingObserve = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const pendingVerify = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const toIsoTimestamp = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = typeof value === 'number' ? value : Date.parse(value);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
  };

  const recordTrace = (trace: Record<string, any>) => {
    if (!trace || typeof trace !== 'object') return;
    // Keep the raw browser fields (url/status/type) for L4 observe and add the
    // canonical stream fields (seq/timestamp/path/statusCode) for SSE and WS.
    const path = String(trace.path ?? trace.route ?? trace.target ?? trace.url ?? '');
    const statusCode = Number(trace.statusCode ?? trace.status ?? 200);
    const durationMs = Number(trace.durationMs ?? trace.duration ?? 0);
    traces.push({
      ...trace,
      seq: ++traceSeq,
      method: String(trace.method ?? trace.action ?? 'BROWSER'),
      path,
      route: String(trace.route ?? path),
      handler: String(trace.handler ?? 'react-bridge'),
      statusCode: Number.isFinite(statusCode) ? statusCode : 200,
      durationMs: Number.isFinite(durationMs) ? durationMs : 0,
      timestamp: toIsoTimestamp(trace.timestamp),
    });
    if (traces.length > MAX_TRACES) traces.shift();
  };

  /** Traces newer than `seq` (SSE `Last-Event-ID` / WS notification cursor). */
  const getTracesSince = (seq: number): OumvStreamTrace[] =>
    traces.filter((trace) => trace.seq > seq);

  // Mutations publish `state` on the same monotonic id space as traces, so SSE
  // `Last-Event-ID` and WS notifications replay both in order (spec §2.3/§2.4).
  const stateEvents: Array<{ seq: number; path: string; version: string; operation: string }> = [];
  const recordState = (path: string, version: string, operation: string) => {
    stateEvents.push({ seq: ++traceSeq, path, version, operation });
    if (stateEvents.length > MAX_TRACES) stateEvents.shift();
  };
  // §2.6 (wire 1.6.0): build/HMR failures the dev server already observes flow
  // on the push transports instead of dying in a swallowed catch block.
  const diagnosticEvents: Array<{ seq: number; diagnostic: Record<string, unknown> }> = [];
  const recordDiagnostic = (diagnostic: Record<string, unknown>) => {
    if (!diagnostic || typeof diagnostic !== 'object') return;
    const entry = {
      seq: ++traceSeq,
      diagnostic: {
        severity: String(diagnostic.severity ?? 'error'),
        source: String(diagnostic.source ?? 'hmr'),
        message: String(diagnostic.message ?? ''),
        ...(diagnostic.file ? { file: String(diagnostic.file) } : {}),
        ...(Number.isFinite(Number(diagnostic.line)) ? { line: Number(diagnostic.line) } : {}),
        ...(diagnostic.tool ? { tool: String(diagnostic.tool) } : {}),
        ts: Date.now(),
      },
    };
    diagnosticEvents.push(entry);
    if (diagnosticEvents.length > MAX_TRACES) diagnosticEvents.shift();
  };
  const getEventsSince = (seq: number) =>
    [
      ...traces
        .filter((trace) => trace.seq > seq)
        .map((trace) => ({ seq: trace.seq, type: 'trace' as const, data: trace as Record<string, unknown> })),
      ...stateEvents
        .filter((event) => event.seq > seq)
        .map((event) => ({
          seq: event.seq,
          type: 'state' as const,
          data: { path: event.path, version: event.version, operation: event.operation },
        })),
      ...diagnosticEvents
        .filter((event) => event.seq > seq)
        .map((event) => ({ seq: event.seq, type: 'diagnostic' as const, data: event.diagnostic })),
    ].sort((a, b) => a.seq - b.seq);

  if (server) {
    server.ws.on('oumv:react-snapshot', (data: ReactBridgeSnapshot) => {
      if (data && typeof data === 'object') {
        latestSnapshot = data;
        lastClientSeenAt = Date.now();
      }
    });

    server.ws.on('oumv:react-trace', (data: Record<string, any>) => {
      if (data && typeof data === 'object') {
        lastClientSeenAt = Date.now();
        recordTrace(data);
      }
    });

    server.ws.on('oumv:react-observe-res', (data: any) => {
      const pending = data?.requestId ? pendingObserve.get(data.requestId) : null;
      if (pending) {
        clearTimeout(pending.timer);
        pendingObserve.delete(data.requestId);
        if (data.snapshot) {
          latestSnapshot = data.snapshot;
          lastClientSeenAt = Date.now();
        }
        pending.resolve(data);
      }
    });

    server.ws.on('oumv:react-verify-res', (data: any) => {
      const pending = data?.requestId ? pendingVerify.get(data.requestId) : null;
      if (pending) {
        clearTimeout(pending.timer);
        pendingVerify.delete(data.requestId);
        lastClientSeenAt = Date.now();
        pending.resolve(data);
      }
    });
  }

  const isBrowserConnected = () =>
    Boolean(latestSnapshot) || (lastClientSeenAt > 0 && Date.now() - lastClientSeenAt < 60_000);

  const requestFreshBrowserObserve = async (timeoutMs = 800): Promise<void> => {
    if (!server || !isBrowserConnected()) return;
    const requestId = crypto.randomUUID();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        pendingObserve.delete(requestId);
        resolve();
      }, timeoutMs);
      pendingObserve.set(requestId, {
        resolve: () => resolve(),
        reject: () => resolve(),
        timer,
      });
      server.ws.send('oumv:react-observe', { requestId });
    });
  };

  const requestBrowserVerify = async (
    target: string,
    action: string,
    payload?: unknown,
    timeoutMs = 4000
  ): Promise<any> => {
    if (!server || !isBrowserConnected()) {
      return {
        status: 'failed',
        errorCode: ERR_RUNTIME_UNAVAILABLE,
        error: 'No live browser tab connected to Vite DevServer. Open the app URL in a browser to verify React actions live.',
      };
    }
    const requestId = crypto.randomUUID();
    return await new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        pendingVerify.delete(requestId);
        resolve({
          status: 'failed',
          errorCode: ERR_RUNTIME_UNAVAILABLE,
          error: 'Timed out waiting for live browser verification response.',
        });
      }, timeoutMs);
      pendingVerify.set(requestId, {
        resolve,
        reject: (err) =>
          resolve({ status: 'failed', errorCode: ERR_INTERNAL, error: err.message }),
        timer,
      });
      server.ws.send('oumv:react-verify', { requestId, target, action, payload });
    });
  };

  const getMergedContracts = (): OumvContractRecord[] => {
    const byId = new Map<string, OumvContractRecord>();
    for (const c of listOUMVComponentContracts()) {
      byId.set(c.componentId, c);
    }
    for (const c of readSidecarContracts(rootDir)) {
      byId.set(c.componentId, c);
    }
    for (const c of latestSnapshot?.contracts || []) {
      byId.set(c.componentId, c);
    }
    return Array.from(byId.values());
  };

  const rpcSuccess = (id: any, result: any) => ({
    statusCode: 200,
    body: { jsonrpc: '2.0', id: id ?? 1, result },
  });

  const rpcError = (id: any, code: number, message: string, data?: any, statusCode = 200) => ({
    statusCode,
    body: {
      jsonrpc: '2.0',
      id: id ?? 1,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    },
  });

  const sessions = new Map<string, number>();

/**
 * §3 idempotent retries (wire 1.6.0): per-session key -> first final result.
 * A retried mutation replays the original answer instead of re-applying it.
 */
const idempotencyCache = new Map<string, Record<string, unknown>>();

/** §4.1 result versioning: skip-list for the workspace inventory walk. */
const DIGEST_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.tokensafe', '.oumv', 'coverage', '.next',
  '.cache', '.turbo', '.output',
]);

/**
 * §4.1 result versioning (wire 1.6.0): a sha256 over the workspace inventory
 * (relative path, size, mtime). Recomputed per call — a cached token would defeat
 * the freshness check it exists for.
 */
function workspaceDigest(rootDir: string): string {
  const entries: string[] = [];
  const walk = (dir: string): void => {
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      const full = path.join(dir, child.name);
      if (child.isDirectory()) {
        if (!DIGEST_SKIP_DIRS.has(child.name)) walk(full);
        continue;
      }
      // Process-local artifacts are not source: a db journal or a log file
      // rewrites itself on every request and would make the token flap.
      if (/\.(db|db-wal|db-shm|sqlite3?|sqlite-wal|sqlite-shm|log)$/i.test(child.name)) continue;
      try {
        const stat = fs.statSync(full);
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        entries.push(`${rel}:${stat.size}:${stat.mtimeMs}`);
      } catch {
        // an unreadable entry contributes nothing
      }
    }
  };
  walk(rootDir);
  entries.sort();
  return 'sha256:' + crypto.createHash('sha256').update(entries.join('\n')).digest('hex');
}
  const SESSION_TTL_SECONDS = 3600;

  /** Canonical envelope for every method: extras belong inside `data`, never beside it. */
  const normalizeResult = (method: string, out: { statusCode: number; body: any }) => {
    const result = out?.body?.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return out;
    if (method === 'oumv/observe') {
      // §4.1 `workspaceVersion`/`unchanged` are envelope fields: they stay beside
      // `data`, never folded into it (the freshness token must be addressable).
      const { level, format, data, tokenEstimate, evidence, workspaceVersion, unchanged, ...rest } =
        result as Record<string, any>;
      return {
        ...out,
        body: {
          ...out.body,
          result: {
            level,
            format,
            // Per-level `data` is the profile's extension point (schema: no
            // additionalProperties restriction there), so browser/static metadata
            // lives there instead of beside the envelope.
            // An empty payload is omitted: the §4.1 short envelope carries no data.
            ...(Object.keys({ ...(data && typeof data === 'object' ? data : {}), ...rest }).length
              ? { data: { ...(data && typeof data === 'object' ? data : {}), ...rest } }
              : {}),
            // `payload` is the deprecated §4.6 alias for `data`; emitting both
            // doubled every observation without adding information.
            ...(tokenEstimate !== undefined ? { tokenEstimate } : {}),
            ...(evidence ? { evidence } : {}),
            ...(workspaceVersion !== undefined ? { workspaceVersion } : {}),
            ...(unchanged !== undefined ? { unchanged } : {}),
          },
        },
      };
    }
    if (method === 'oumv/understand') {
      const { query, target, impact, causality, workspaceVersion, unchanged, ...rest } =
        result as Record<string, any>;
      const narrowed: Record<string, any> = { query, target };
      if (impact) narrowed.impact = { ...impact, ...rest };
      else if (causality) narrowed.causality = { ...causality, ...rest };
      else if (rest && Object.keys(rest).length) narrowed.impact = { ...rest };
      // §4.1: the freshness token is an envelope field, mirroring observe.
      if (workspaceVersion !== undefined) narrowed.workspaceVersion = workspaceVersion;
      if (unchanged !== undefined) narrowed.unchanged = unchanged;
      return { ...out, body: { ...out.body, result: narrowed } };
    }
    if (method === 'oumv/getSource' && 'filePath' in (result as Record<string, any>)) {
      const { filePath, ...rest } = result as Record<string, any>;
      void filePath;
      return { ...out, body: { ...out.body, result: rest } };
    }
    return out;
  };

  const dispatchRpc = async (payload: any): Promise<{ statusCode: number; body: any }> => {
    const { id, method, params = {} } = payload || {};

    // Spec §3: a supplied sessionId must be live; an absent one means stateless.
    if (method === 'oumv/disconnect') {
      const closed = sessions.delete(String(params.sessionId || ''));
      return rpcSuccess(id, { closed });
    }
    if (method !== 'oumv/handshake' && method !== 'handshake' && params.sessionId) {
      const expiresAt = sessions.get(String(params.sessionId));
      if (!expiresAt || Date.now() > expiresAt) {
        sessions.delete(String(params.sessionId));
        return rpcError(
          id,
          ERR_VALIDATION_FAILED,
          'VALIDATION_FAILED: unknown or expired sessionId — re-run oumv/handshake',
          { reason: 'session_expired', sessionId: params.sessionId }
        );
      }
    }

    switch (method) {
      case 'oumv/handshake':
      case 'handshake': {
        // §11: serve our own MINOR and every earlier one; another MAJOR is -32006.
        const requestedVersion = String(params?.protocolVersion ?? '').trim();
        if (requestedVersion) {
          const [majorRaw, minorRaw] = requestedVersion.split('.');
          const major = Number(majorRaw);
          const minor = Number(minorRaw);
          if (!Number.isInteger(major) || !Number.isInteger(minor) || major !== 1 || minor > 6) {
            return rpcError(
              id,
              ERR_UNSUPPORTED,
              `UNSUPPORTED_CAPABILITY: protocol version ${requestedVersion} (this runtime serves 1.6.0)`,
            );
          }
        }
        const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;
        // Wire 1.5.0: honour a client-requested lifetime, clamped to [1, 86400].
        const rawTtl = Number(params?.sessionTtlSeconds);
        const grantedTtl =
          Number.isFinite(rawTtl) && rawTtl > 0 ? Math.min(Math.max(Math.floor(rawTtl), 1), 86400) : SESSION_TTL_SECONDS;
        sessions.set(sessionId, Date.now() + grantedTtl * 1000);
        const capabilities = {
          observe: { levels: ['L0', 'L1', 'L2', 'L3', 'L4'], formats: ['yaml', 'json'] },
          understand: { causality: true, signalsGraph: false, impactAnalysis: true },
          // Wire 1.6.0: preview advertises the §4.4 dry-run (same guard order, no write).
          mutate: { occ: true, syntaxGuard: true, ephemeralDispatch: true, preview: true },
          verify: { multiMetric: true, surfaceDiff: true },
          // Wire 1.6.0: §14.1 symbol search over the static discovery index.
          index: { symbols: true },
          // Wire 1.5.0/1.6.0: TTL negotiation, best-effort cancel, idempotent retries.
          sessions: { ttlSeconds: true, cancel: true, idempotency: true },
        };
        // §3.1: narrow the advertised set to the client's request; an empty
        // intersection stays empty instead of being widened back.
        const requested = params?.requestedCapabilities;
        if (requested && typeof requested === 'object') {
          const reqLevels = Array.isArray(requested.observe?.levels) ? requested.observe.levels : [];
          const reqFormats = Array.isArray(requested.observe?.formats) ? requested.observe.formats : [];
          if (reqLevels.length > 0) {
            capabilities.observe.levels = capabilities.observe.levels.filter((level) => reqLevels.includes(level));
          }
          if (reqFormats.length > 0) {
            capabilities.observe.formats = capabilities.observe.formats.filter((format) => reqFormats.includes(format));
          }
        }
        return rpcSuccess(id, {
          protocolVersion: '1.6.0',
          profile: 'frontend',
          sessionId,
          ttlSeconds: grantedTtl,
          runtimeInfo: {
            name: 'react',
            version: reactVersion,
            framework: 'React + Vite',
          },
          capabilities,
        });
      }

      case 'oumv/observe': {

        // §4.1 result versioning (wire 1.6.0): the ifVersion handshake runs before
        // any scan, so a fresh caller pays nothing and a stale one is told to refetch.
        const observeWorkspaceVersion = workspaceDigest(rootDir);
        const observeIfVersion = typeof params?.ifVersion === 'string' ? params.ifVersion.trim() : '';
        if (observeIfVersion) {
          if (observeIfVersion !== observeWorkspaceVersion) {
            return rpcError(
              id,
              ERR_STALE_RESOURCE_VERSION,
              `STALE_RESOURCE_VERSION: the workspace changed since the caller's snapshot (expected ${observeIfVersion}, current is ${observeWorkspaceVersion}) — refetch without ifVersion`,
              { reason: 'stale_version', current: observeWorkspaceVersion, expected: observeIfVersion }
            );
          }
          return rpcSuccess(id, {
            level: String(params?.level || 'L0').toUpperCase(),
            format: String(params?.format || 'json').toLowerCase(),
            unchanged: true,
            workspaceVersion: observeWorkspaceVersion,
          });
        }
        const observeRespond = (payload: any) => rpcSuccess(id, { ...payload, workspaceVersion: observeWorkspaceVersion });
        const level = String(params?.level || 'L0').toUpperCase();
        if (!['L0', 'L1', 'L2', 'L3', 'L4'].includes(level)) {
          return rpcError(id, ERR_UNSUPPORTED, `UNSUPPORTED_CAPABILITY: unknown observe level ${level}`);
        }
        const defaultFormat = level === 'L0' || level === 'L1' ? 'yaml' : 'json';
        const format = String(params?.format || defaultFormat).toLowerCase() as 'yaml' | 'json' | 'sexp';
        const target = String(params?.componentId || params?.target || '').trim();
        const rawLimit = Number(params?.limit);
        const hasFilter = target.length > 0;
        const itemLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : hasFilter ? 50 : 25;
        const staticLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : hasFilter ? 50 : 15;
        const now = Date.now();

        if (isBrowserConnected() && (level === 'L0' || level === 'L1' || level === 'L2' || level === 'L4')) {
          await requestFreshBrowserObserve();
        }

        const snap = latestSnapshot;
        const staticRes = scanProjectStaticResources(rootDir);
        const contracts = getMergedContracts();

        if (level === 'L0') {
          const pulse = snap
            ? {
                level: 'L0' as const,
                framework: 'react',
                browserConnected: true,
                route: snap.route,
                mountedCount: snap.mountedComponents.length,
                mounted: snap.mountedComponents.slice(0, 15).map((c) => c.name),
                elements: snap.elementCount,
                interactiveCount: snap.interactiveSurface.length,
                errors: snap.errorsCount,
                traces: traces.length,
                staticComponentsCount: staticRes.components.length,
                evidence: {
                  provenance: 'runtime' as const,
                  sourceAdapter: 'tokensafe-ui-react-vite',
                  confidence: 'confirmed' as const,
                },
              }
            : {
                level: 'L0' as const,
                framework: 'react',
                browserConnected: false,
                route: '/',
                mounted: [] as string[],
                elements: 0,
                errors: 0,
                staticComponentsCount: staticRes.components.length,
                staticFilesScanned: staticRes.totalScannedFiles,
                note: 'Vite React DevServer is online; open the app in a browser tab for live DOM/Fiber telemetry.',
                evidence: {
                  provenance: 'static' as const,
                  sourceAdapter: 'tokensafe-ui-react-vite',
                  confidence: 'confirmed' as const,
                },
              };

          const payloadStr =
            format === 'yaml'
              ? `level: L0\nframework: react\nbrowserConnected: ${pulse.browserConnected}\nroute: ${pulse.route}\nmounted: [${(pulse.mounted || []).join(', ')}]\nelements: ${pulse.elements}\nerrors: ${pulse.errors}\nstaticComponents: ${pulse.staticComponentsCount}\n`
              : JSON.stringify(pulse);

          return observeRespond({
            ...pulse,
            format,
            payload: payloadStr,
            tokenEstimate: Math.ceil(payloadStr.length / 4),
            timestamp: now,
            data: pulse,
          });
        }

        if (level === 'L1') {
          const staticPage = pageSlice(staticRes.components, params?.limit, params?.cursor);
          const filterLower = target.toLowerCase();
          const allMatchingStatic = staticRes.components.filter(
            (c) =>
              !filterLower ||
              c.name.toLowerCase().includes(filterLower) ||
              c.filePath.toLowerCase().includes(filterLower)
          );
          const staticComponents = allMatchingStatic.slice(0, staticLimit);
          const staticByName = new Map(staticRes.components.map((c) => [c.name, c]));
          const contractIds = new Set(contracts.map((c) => c.componentId));
          const resources: OumvResourceReference[] = [];
          const seenResourceIds = new Set<string>();

          if (snap) {
            const allElements = snap.interactiveSurface.filter(
              (el) =>
                !filterLower ||
                el.id.toLowerCase().includes(filterLower) ||
                (el.label || '').toLowerCase().includes(filterLower) ||
                (el.component || '').toLowerCase().includes(filterLower)
            );
            const elements = allElements.slice(0, itemLimit);
            const allMounted = snap.mountedComponents.filter(
              (c) => !filterLower || c.name.toLowerCase().includes(filterLower)
            );
            const mounted = allMounted.slice(0, itemLimit);

            for (const comp of mounted) {
              const staticMatch = staticByName.get(comp.name);
              const resId = `frontend.component:${comp.name}`;
              if (!seenResourceIds.has(resId)) {
                seenResourceIds.add(resId);
                resources.push({
                  id: resId,
                  type: 'frontend.component',
                  name: comp.name,
                  sourceLocation: staticMatch
                    ? {
                        filePath: staticMatch.filePath,
                        lineStart: staticMatch.lineStart,
                        lineEnd: staticMatch.lineEnd,
                      }
                    : comp.source?.fileName
                      ? { filePath: comp.source.fileName, lineStart: comp.source.lineNumber }
                      : undefined,
                  evidence: {
                    provenance: contractIds.has(comp.name) ? 'contract' : 'runtime',
                    sourceAdapter: 'tokensafe-ui-react-vite',
                    confidence: 'confirmed',
                    observedAt: now,
                  },
                  availableOperations: staticMatch
                    ? ['observe', 'understand', 'getSource', 'applyEdit']
                    : ['observe', 'understand'],
                });
              }
            }

            for (const el of elements) {
              const resId = `frontend.action:${el.id}`;
              if (!seenResourceIds.has(resId)) {
                seenResourceIds.add(resId);
                resources.push({
                  id: resId,
                  type: 'frontend.action',
                  name: el.label || el.id,
                  parentRef: el.component ? `frontend.component:${el.component}` : undefined,
                  evidence: {
                    provenance: 'runtime',
                    sourceAdapter: 'tokensafe-ui-react-vite',
                    confidence: 'confirmed',
                    observedAt: now,
                  },
                  availableOperations: ['verify'],
                });
              }
            }

            for (const sc of staticComponents) {
              if (!seenResourceIds.has(sc.id)) {
                seenResourceIds.add(sc.id);
                resources.push({
                  id: sc.id,
                  type: 'frontend.component',
                  name: sc.name,
                  sourceLocation: {
                    filePath: sc.filePath,
                    lineStart: sc.lineStart,
                    lineEnd: sc.lineEnd,
                  },
                  evidence: {
                    provenance: contractIds.has(sc.name) ? 'contract' : 'static',
                    sourceAdapter: 'tokensafe-ui-react-vite',
                    confidence: contractIds.has(sc.name) ? 'confirmed' : 'probable',
                    filePath: sc.filePath,
                    lineRange: [sc.lineStart, sc.lineEnd],
                  },
                  availableOperations: ['observe', 'understand', 'getSource', 'applyEdit'],
                });
              }
            }

            const provenanceSummary = summarizeProvenance(resources);
            const collection: OumvResourceCollection = {
              resources,
              total: resources.length,
              provenanceSummary,
            };

            const yamlLines = [
              `view: ${snap.route}`,
              `framework: react`,
              `mountedComponents: [${mounted.map((c) => c.name).join(', ')}]`,
              `totals: { mounted: ${allMounted.length}, interactive: ${allElements.length}, staticComponents: ${allMatchingStatic.length} }`,
              `elements:`,
              ...elements.map(
                (e) =>
                  `  - ${e.id} [role: ${e.role}${e.label ? `, label: ${JSON.stringify(e.label)}` : ''}${e.component ? `, component: ${e.component}` : ''}${e.disabled ? ', disabled: true' : ''}]`
              ),
            ];
            if (allElements.length > elements.length) {
              yamlLines.push(`  # +${allElements.length - elements.length} more (pass target="..." or limit=${allElements.length} to inspect)`);
            }

            if (format === 'yaml') {
              const yamlPayload = yamlLines.join('\n');
              return observeRespond({
                level: 'L1',
                format: 'yaml',
                payload: yamlPayload,
                tokenEstimate: Math.ceil(yamlPayload.length / 4),
                timestamp: now,
                framework: 'react',
                browserConnected: true,
                route: snap.route,
                // Spec §4.1 L1: interactive elements are the frontend surface.
                elements: elements.map((e) => ({
                  id: e.id,
                  tag: e.tag,
                  ...(e.role ? { role: e.role } : {}),
                  ...(e.label ? { label: e.label } : {}),
                  ...(e.action ? { action: e.action } : {}),
                })),
                total: collection.total,
                provenanceSummary: collection.provenanceSummary,
                components: mounted.slice(0, 15).map((c) => ({ id: c.id, name: c.name })),
                data: {
                  route: snap.route,
                  total: collection.total,
                  provenanceSummary: collection.provenanceSummary,
                  ...(staticPage.hasMore !== undefined ? { hasMore: staticPage.hasMore } : {}),
                  ...(staticPage.nextCursor ? { nextCursor: staticPage.nextCursor } : {}),
                },
                evidence: {
                  provenance: 'runtime',
                  sourceAdapter: 'tokensafe-ui-react-vite',
                  confidence: 'confirmed',
                },
              });
            }

            const jsonPayload = JSON.stringify(collection);
            return observeRespond({
              level: 'L1',
              format,
              payload: jsonPayload,
              tokenEstimate: Math.ceil(jsonPayload.length / 4),
              timestamp: now,
              framework: 'react',
              browserConnected: true,
              route: snap.route,
              resources: collection.resources,
              total: collection.total,
              provenanceSummary: collection.provenanceSummary,
              data: {
                total: collection.total,
                provenanceSummary: collection.provenanceSummary,
                route: snap.route,
                ...(staticPage.hasMore !== undefined ? { hasMore: staticPage.hasMore } : {}),
                ...(staticPage.nextCursor ? { nextCursor: staticPage.nextCursor } : {}),
              },
              components: mounted,
              elements,
              staticComponents,
              contractsCount: contracts.length,
              evidence: {
                provenance: 'runtime',
                sourceAdapter: 'tokensafe-ui-react-vite',
                confidence: 'confirmed',
              },
            });
          }

          for (const sc of staticComponents) {
            if (!seenResourceIds.has(sc.id)) {
              seenResourceIds.add(sc.id);
              resources.push({
                id: sc.id,
                type: 'frontend.component',
                name: sc.name,
                sourceLocation: {
                  filePath: sc.filePath,
                  lineStart: sc.lineStart,
                  lineEnd: sc.lineEnd,
                },
                evidence: {
                  provenance: contractIds.has(sc.name) ? 'contract' : 'static',
                  sourceAdapter: 'tokensafe-ui-react-vite',
                  confidence: contractIds.has(sc.name) ? 'confirmed' : 'probable',
                  filePath: sc.filePath,
                  lineRange: [sc.lineStart, sc.lineEnd],
                },
                availableOperations: ['observe', 'understand', 'getSource', 'applyEdit'],
              });
            }
          }
          for (const sr of staticRes.routes.slice(0, itemLimit)) {
            if (!seenResourceIds.has(sr.id)) {
              seenResourceIds.add(sr.id);
              resources.push({
                id: sr.id,
                type: 'frontend.route',
                name: sr.path,
                sourceLocation: { filePath: sr.filePath },
                evidence: {
                  provenance: 'static',
                  sourceAdapter: 'tokensafe-ui-react-vite',
                  confidence: 'probable',
                  filePath: sr.filePath,
                },
                availableOperations: ['observe'],
              });
            }
          }

          const provenanceSummary = summarizeProvenance(resources);
          const collection: OumvResourceCollection = {
            resources,
            total: resources.length,
            provenanceSummary,
          };

          const offlineYamlLines = [
            `view: offline-static`,
            `framework: react`,
            `totals: { staticComponents: ${allMatchingStatic.length}, routes: ${staticRes.routes.length} }`,
            `resources:`,
            ...resources.map(
              (r) =>
                `  - ${r.id} [${r.type}${r.sourceLocation ? `, file: ${r.sourceLocation.filePath}` : ''}]`
            ),
          ];
          if (allMatchingStatic.length > staticComponents.length) {
            offlineYamlLines.push(`  # +${allMatchingStatic.length - staticComponents.length} more static components (pass target="..." to filter)`);
          }

          if (format === 'yaml') {
            const yamlPayload = offlineYamlLines.join('\n');
            return observeRespond({
              level: 'L1',
              format: 'yaml',
              payload: yamlPayload,
              tokenEstimate: Math.ceil(yamlPayload.length / 4),
              timestamp: now,
              framework: 'react',
              browserConnected: false,
              // No tab, no interactive surface: an empty list plus the note below.
              elements: [],
              total: collection.total,
              provenanceSummary: collection.provenanceSummary,
              components: (staticPage.hasMore !== undefined ? staticPage.page : staticComponents)
                .slice(0, 15)
                .map((c) => ({ id: c.id, name: c.name })),
              data: {
                total: collection.total,
                provenanceSummary: collection.provenanceSummary,
                ...(staticPage.hasMore !== undefined ? { hasMore: staticPage.hasMore } : {}),
                ...(staticPage.nextCursor ? { nextCursor: staticPage.nextCursor } : {}),
              },
              note: 'No browser tab connected yet — returning compact static AST React surface.',
              evidence: {
                provenance: 'static',
                sourceAdapter: 'tokensafe-ui-react-vite',
                confidence: 'probable',
              },
            });
          }

          const jsonPayload = JSON.stringify(collection);
          return observeRespond({
            level: 'L1',
            format,
            payload: jsonPayload,
            tokenEstimate: Math.ceil(jsonPayload.length / 4),
            timestamp: now,
            framework: 'react',
            browserConnected: false,
            elements: [],
            resources: collection.resources,
            total: collection.total,
            provenanceSummary: collection.provenanceSummary,
            data: {
              total: collection.total,
              provenanceSummary: collection.provenanceSummary,
              ...(staticPage.hasMore !== undefined ? { hasMore: staticPage.hasMore } : {}),
              ...(staticPage.nextCursor ? { nextCursor: staticPage.nextCursor } : {}),
            },
            components: staticPage.hasMore !== undefined ? staticPage.page : staticComponents,
            routes: staticRes.routes,
            contractsCount: contracts.length,
            note: 'No browser tab connected yet — returning static AST React component surface.',
            evidence: {
              provenance: 'static',
              sourceAdapter: 'tokensafe-ui-react-vite',
              confidence: 'probable',
            },
          });
        }

        if (level === 'L2') {
          const cleanName = target.replace(/^frontend\.component:/, '');
          const staticMatches = staticRes.components.filter(
            (c) => !cleanName || c.name === cleanName || c.id === target || c.filePath.includes(cleanName)
          );
          const liveComp = snap?.mountedComponents.find(
            (c) => c.name === cleanName || c.id === target
          );
          const regStore = snap?.registeredStores[cleanName] || snap?.registeredComponents[cleanName];
          const matchingContracts = contracts.filter(
            (c) => !cleanName || c.componentId === cleanName || c.componentName === cleanName
          );
          const l2Evidence = {
            provenance: (liveComp || regStore ? 'runtime' : matchingContracts.length > 0 ? 'contract' : 'static') as OumvEvidenceProvenance,
            sourceAdapter: 'tokensafe-ui-react-vite',
            confidence: (liveComp || regStore || matchingContracts.length > 0 ? 'confirmed' : 'probable') as OumvEvidenceConfidence,
          };
          const l2Data = {
            target: target || 'all',
            componentId: cleanName || 'all',
            liveComponent: liveComp || null,
            registeredState: regStore || null,
            staticMatches: staticMatches.slice(0, 10),
            contracts: matchingContracts,
            evidence: l2Evidence,
          };
          const payloadStr =
            format === 'yaml'
              ? `level: L2\ntarget: ${l2Data.target}\nstaticMatches: ${l2Data.staticMatches.length}\ncontracts: ${matchingContracts.length}\n`
              : JSON.stringify(l2Data);

          return observeRespond({
            level: 'L2',
            format,
            payload: payloadStr,
            tokenEstimate: Math.ceil(payloadStr.length / 4),
            timestamp: now,
            framework: 'react',
            data: l2Data,
            ...l2Data,
          });
        }

        if (level === 'L3') {
          const primary = String(params?.target || params?.componentId || '').trim();
          const secondary = String(params?.componentId || params?.target || '').trim();
          if (!primary && !secondary) {
            return rpcError(id, ERR_INVALID_PARAMS, 'target (component name or filePath) is required for L3 observe');
          }

          let relPath = primary;
          let cleanName = primary.replace(/^frontend\.component:/, '');
          for (const candidate of [primary, secondary].filter(Boolean)) {
            const cname = candidate.replace(/^frontend\.component:/, '');
            const match = staticRes.components.find(
              (c) => c.name === cname || c.id === candidate || c.filePath === candidate
            );
            if (match) {
              relPath = match.filePath;
              cleanName = match.name;
              break;
            }
            try {
              const maybe = validateProjectPath(candidate, rootDir);
              if (fs.existsSync(maybe) && fs.statSync(maybe).isFile()) {
                relPath = candidate;
                cleanName = cname;
                break;
              }
            } catch {}
          }

          let resolved: string;
          try {
            resolved = validateProjectPath(relPath, rootDir);
          } catch (err: any) {
            return rpcError(id, ERR_SECURITY, err.message);
          }
          if (!fs.existsSync(resolved)) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `Resource not found: ${relPath}`);
          }
          const source = fs.readFileSync(resolved, 'utf-8');
          const version = 'sha256:' + crypto.createHash('sha256').update(source).digest('hex');
          const lines = source.split('\n');
          const numberedSource = lines.map((l, idx) => `${idx + 1} | ${l}`).join('\n');
          const matchingContracts = contracts.filter((c) => c.componentId === cleanName);
          const l3Data = {
            target: primary || secondary,
            filePath: path.relative(rootDir, resolved),
            version,
            source: numberedSource,
            contracts: matchingContracts,
            evidence: {
              provenance: 'static' as const,
              sourceAdapter: 'tokensafe-ui-react-vite',
              confidence: 'confirmed' as const,
            },
          };
          const payloadStr =
            format === 'yaml'
              ? `// file: ${l3Data.filePath}\n// version: ${version}\n${numberedSource}`
              : JSON.stringify(l3Data);

          return observeRespond({
            level: 'L3',
            format,
            payload: payloadStr,
            tokenEstimate: Math.ceil(payloadStr.length / 4),
            timestamp: now,
            data: l3Data,
            ...l3Data,
          });
        }

        // L4: Traces
        const allFilteredTraces = target
          ? traces.filter((t) => JSON.stringify(t).toLowerCase().includes(target.toLowerCase()))
          : traces;
        const filteredTraces = allFilteredTraces.slice(-itemLimit);
        const l4Data = {
          browserConnected: isBrowserConnected(),
          traces: filteredTraces,
          errors: snap?.errors || [],
          // §2.6 (wire 1.6.0): the diagnostics the dev server already observed
          // (build/HMR failures) ride on L4 for pull-based consumers too.
          diagnostics: diagnosticEvents.map((event) => event.diagnostic).slice(-itemLimit),
          evidence: {
            provenance: 'runtime' as const,
            sourceAdapter: 'tokensafe-ui-react-vite',
            confidence: (isBrowserConnected() ? 'confirmed' : 'unknown') as OumvEvidenceConfidence,
          },
        };
        const l4Payload = JSON.stringify(l4Data.traces);

        return observeRespond({
          level: 'L4',
          format,
          payload: l4Payload,
          tokenEstimate: Math.ceil(l4Payload.length / 4),
          timestamp: now,
          framework: 'react',
          data: l4Data,
          ...l4Data,
        });
      }

      case 'oumv/understand': {

      // §4.1: understand honours the same freshness handshake as observe.
      const understandWorkspaceVersion = workspaceDigest(rootDir);
      const understandIfVersion = typeof params?.ifVersion === 'string' ? params.ifVersion.trim() : '';
      if (understandIfVersion) {
        if (understandIfVersion !== understandWorkspaceVersion) {
          return rpcError(
            id,
            ERR_STALE_RESOURCE_VERSION,
            `STALE_RESOURCE_VERSION: the workspace changed since the caller's snapshot (expected ${understandIfVersion}, current is ${understandWorkspaceVersion}) — refetch without ifVersion`,
            { reason: 'stale_version', current: understandWorkspaceVersion, expected: understandIfVersion }
          );
        }
        return rpcSuccess(id, {
          query: String(params?.query || 'causality'),
          unchanged: true,
          workspaceVersion: understandWorkspaceVersion,
        });
      }
      const understandRespond = (payload: any) => rpcSuccess(id, { ...payload, workspaceVersion: understandWorkspaceVersion });
        const query = String(params?.query || 'causality');
        const target = String(params?.target || params?.componentId || '').trim();
        const importersOf = buildImportDependencyMap(rootDir);
        const staticRes = scanProjectStaticResources(rootDir);
        const contracts = getMergedContracts();

        if (query === 'impact') {
          const cleanName = target.replace(/^frontend\.component:/, '');
          const matchedComp = staticRes.components.find(
            (c) => c.name === cleanName || c.id === target || c.filePath === target
          );
          const targetFile = matchedComp?.filePath || target;
          const directlyAffected = importersOf.get(targetFile) || [];
          const indirectlyAffected: string[] = [];
          for (const f of directlyAffected) {
            for (const parent of importersOf.get(f) || []) {
              if (!directlyAffected.includes(parent) && !indirectlyAffected.includes(parent)) {
                indirectlyAffected.push(parent);
              }
            }
          }
          const safeComponents = Array.from(
            new Set(
              staticRes.components
                .filter(
                  (c) =>
                    c.filePath !== targetFile &&
                    !directlyAffected.includes(c.filePath) &&
                    !indirectlyAffected.includes(c.filePath)
                )
                .map((c) => c.name)
            )
          );
          const recommendation =
            directlyAffected.length > 0
              ? `Modify with care: ${directlyAffected.length} direct importer(s) affected (${directlyAffected.join(', ')}).`
              : `Safe: no direct importers found for '${target}'.`;
          const matchingContracts = contracts.filter((c) => c.componentId === cleanName);
          const impactObj = {
            target,
            filePath: targetFile || undefined,
            directlyAffected,
            indirectlyAffected,
            safeComponents,
            recommendation,
            contracts: matchingContracts,
            observed: directlyAffected.length > 0 || Boolean(matchedComp),
            evidence: {
              provenance: 'static' as const,
              sourceAdapter: 'tokensafe-ui-react-vite',
              confidence: 'probable' as const,
            },
          };
          return understandRespond({
            query: 'impact',
            ...impactObj,
            impact: impactObj,
          });
        }

        if (query === 'dependencies') {
          const graphObj: Record<string, string[]> = {};
          const yamlLines = ['react_dependency_graph:'];
          for (const [file, deps] of importersOf.entries()) {
            graphObj[file] = deps;
            yamlLines.push(`  - file: ${file}`);
            yamlLines.push(`    importedBy: [${deps.join(', ')}]`);
          }
          return understandRespond({
            query: 'dependencies',
            yaml: yamlLines.join('\n'),
            importers: graphObj,
            componentsCount: staticRes.components.length,
            evidence: {
              provenance: 'static',
              sourceAdapter: 'tokensafe-ui-react-vite',
              confidence: 'probable',
            },
          });
        }

        // causality / why_state
        const matchingTraces = target
          ? traces.filter((t) => JSON.stringify(t).toLowerCase().includes(target.toLowerCase()))
          : traces;
        const latestTrace = matchingTraces[matchingTraces.length - 1];
        const disabledSurface = latestSnapshot?.interactiveSurface.find(
          (el) =>
            (el.id === target || el.label === target || el.component === target) && el.disabled
        );
        const runtimeErrors = latestSnapshot?.errors || [];

        if (!isBrowserConnected() || (!latestTrace && !disabledSurface && runtimeErrors.length === 0)) {
          const causalityObj = {
            target,
            observed: false,
            rootCause: 'unknown',
            traceChain: [] as string[],
            note: isBrowserConnected()
              ? 'Browser connected, but no failing fetch, error, or store trace observed for this target yet.'
              : 'No browser tab connected yet — cannot report runtime causality without observed browser events.',
            evidence: {
              provenance: 'runtime' as const,
              sourceAdapter: 'tokensafe-ui-react-vite',
              confidence: 'unknown' as const,
            },
          };
          return understandRespond({
            query,
            ...causalityObj,
            causality: causalityObj,
          });
        }

        const traceChain: string[] = [];
        if (latestTrace) {
          traceChain.push(`${latestTrace.type}:${latestTrace.url || latestTrace.target || target}`);
        }
        if (disabledSurface) {
          traceChain.push(`dom:disabled:${disabledSurface.id}`);
        }
        const causalityObj = {
          target,
          observed: true,
          rootCause: latestTrace?.error
            ? String(latestTrace.error)
            : disabledSurface
              ? `Element '${disabledSurface.id}' is disabled`
              : `Observed ${latestTrace?.type || 'runtime'} event`,
          traceChain,
          lastTrace: latestTrace || null,
          disabledElement: disabledSurface || null,
          recentErrors: runtimeErrors.slice(-5),
          evidence: {
            provenance: 'runtime' as const,
            sourceAdapter: 'tokensafe-ui-react-vite',
            confidence: 'confirmed' as const,
          },
        };
        return understandRespond({
          query,
          ...causalityObj,
          causality: causalityObj,
        });
      }

      case 'oumv/getSource': {
        const relPath = String(params?.path || params?.filePath || '');
        const symbol = String(params?.symbol || '').trim();
        let resolved: string;
        try {
          resolved = validateProjectPath(relPath, rootDir);
        } catch (err: any) {
          return rpcError(id, ERR_SECURITY, err.message);
        }
        if (!fs.existsSync(resolved)) {
          return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
        }
        const fullSource = fs.readFileSync(resolved, 'utf-8');
        const version = 'sha256:' + crypto.createHash('sha256').update(fullSource).digest('hex');

        const ifVersion = String(params?.ifVersion || '').trim();
        if (ifVersion && ifVersion === version) {
          return rpcSuccess(id, { path: path.relative(rootDir, resolved), version, unchanged: true });
        }

        if (symbol) {
          const sliced = extractSymbolRange(fullSource, symbol);
          if (sliced) {
            return rpcSuccess(id, {
              symbol,
              path: path.relative(rootDir, resolved),
              filePath: path.relative(rootDir, resolved),
              version,
              source: sliced.source,
              startLine: sliced.startLine,
              endLine: sliced.endLine,
            });
          }
          // §4.3: an unknown symbol is -32009, never the whole file under a label.
          return rpcError(id, ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: symbol ${symbol} not found`);
        }

        const allLines = fullSource.split('\n');
        const windowStart = Math.max(1, Number(params?.startLine) || 1);
        let windowEnd = Number(params?.endLine) || allLines.length;
        windowEnd = Math.min(Math.max(windowEnd, windowStart), allLines.length);
        return rpcSuccess(id, {
          symbol: undefined,
          path: path.relative(rootDir, resolved),
          filePath: path.relative(rootDir, resolved),
          version,
          source: allLines.slice(windowStart - 1, windowEnd).join('\n'),
          startLine: windowStart,
          endLine: fullSource.split('\n').length,
        });
      }

      case 'oumv/previewEdit': {
        // §4.4 (wire 1.6.0): applyEdit's guard order as a dry-run, no bytes written.
        if (isMutateDisabled(rootDir)) {
          return rpcError(
            id,
            ERR_PERMISSION_DENIED,
            'Workspace policy explicitly prohibits mutations (.tokensafe/oumv.json: permissions.mutate=false)'
          );
        }
        const editItems: any[] = Array.isArray(params?.edits) && params.edits.length > 0 ? params.edits : [params];
        if (editItems.length > 16) {
          return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: batch must hold 1..16 items', {
            reason: 'batch_size',
          });
        }
        const previews: any[] = [];
        for (const item of editItems) {
          const relPath = String(item?.path || item?.filePath || '');
          const mode = String(item?.mode || 'replace').toLowerCase();
          const expectedVersion = item?.expectedVersion;
          const replacement = item?.replacement ?? item?.source ?? '';
          if (!relPath) {
            return rpcError(id, ERR_INVALID_PARAMS, 'path is required');
          }
          if (!['replace', 'create', 'symbol', 'delete', 'rename', 'patch'].includes(mode)) {
            return rpcError(id, -32006, `UNSUPPORTED_CAPABILITY: unknown preview mode ${JSON.stringify(mode)}`);
          }
          let resolved: string;
          try {
            resolved = validateProjectPath(relPath, rootDir);
          } catch (err: any) {
            return rpcError(id, ERR_SECURITY, err.message);
          }
          const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
          if (mode === 'create') {
            if (expectedVersion) {
              return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion must be omitted for mode=create', {
                reason: 'create_forbids_version',
                path: relPath,
              });
            }
            if (exists) {
              return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: file already exists; use mode=replace with its version', {
                reason: 'file_exists',
                path: relPath,
              });
            }
          } else {
            if (!exists) {
              return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
            }
            const currentText = fs.readFileSync(resolved, 'utf-8');
            const currentVersion = 'sha256:' + crypto.createHash('sha256').update(currentText).digest('hex');
            if (!expectedVersion || typeof expectedVersion !== 'string') {
              return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to preview an edit of an existing file', {
                reason: 'expected_version_required',
                path: relPath,
                current: currentVersion,
              });
            }
            if (expectedVersion !== currentVersion) {
              return rpcError(id, ERR_CONFLICT, `CONFLICT_DETECTED: version mismatch: expected ${expectedVersion}, current is ${currentVersion}`, {
                reason: 'version_mismatch',
                path: relPath,
              });
            }
          }
          let syntaxCheck: Record<string, string> = { status: 'skipped', tool: '@babel/parser' };
          if (mode !== 'delete' && mode !== 'rename') {
            try {
              parser.parse(String(replacement), { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
              syntaxCheck = { status: 'passed', tool: '@babel/parser' };
            } catch (err: any) {
              return rpcError(id, ERR_SYNTAX, `SYNTAX_ERROR: pre-flight parse failed: ${err.message}`);
            }
          }
          const currentText = exists ? fs.readFileSync(resolved, 'utf-8') : '';
          const newVersion = 'sha256:' + crypto.createHash('sha256').update(String(replacement)).digest('hex');
          previews.push({
            path: relPath,
            mode,
            unchanged: currentText === String(replacement),
            ...(exists ? { currentVersion: 'sha256:' + crypto.createHash('sha256').update(currentText).digest('hex') } : {}),
            newVersion,
            syntaxCheck,
            wouldApply: true,
          });
        }
        return rpcSuccess(id, { status: 'PREVIEW', applied: false, previews });
      }

      case 'oumv/index': {
        // §14.1 repo-wide symbol search: the static discovery index IS the
        // frontend's symbol table (components + routes), so an agent can find
        // what to read instead of crawling files.
        const query = String(params?.query ?? '').trim();
        if (!query) return rpcError(id, ERR_INVALID_PARAMS, 'INVALID_PARAMS: query is required');
        const lowerQuery = query.toLowerCase();
        const kinds = Array.isArray(params?.kinds)
          ? params.kinds.map((kind: unknown) => String(kind).toLowerCase())
          : [];
        const wants = (kind: string) => kinds.length === 0 || kinds.includes(kind);
        const scope = String(params?.scope ?? '').trim().replace(/\\/g, '/');
        const inScope = (file: string) => !scope || file.replace(/\\/g, '/').startsWith(scope);
        const limit = Math.max(1, Math.min(Number(params?.limit) || 50, 200));

        const staticRes = scanProjectStaticResources(rootDir);
        type Candidate = {
          resourceId: string;
          name: string;
          kind: string;
          file: string;
          lines: [number, number];
          signature?: string;
          qualified?: string;
        };
        const candidates: Candidate[] = [];
        if (wants('component')) {
          for (const component of staticRes.components) {
            if (!inScope(component.filePath)) continue;
            candidates.push({
              resourceId: component.id,
              name: component.name,
              kind: 'component',
              file: component.filePath,
              lines: [component.lineStart, component.lineEnd],
              ...(component.propsInterface ? { signature: `${component.name}(${component.propsInterface})` } : {}),
            });
          }
        }
        if (wants('route')) {
          for (const route of staticRes.routes) {
            if (!inScope(route.filePath)) continue;
            candidates.push({
              resourceId: route.id,
              name: route.path,
              kind: 'route',
              file: route.filePath,
              lines: [1, 1],
              ...(route.componentName ? { qualified: route.componentName } : {}),
            });
          }
        }

        const rank = (candidate: Candidate): number => {
          const name = candidate.name.toLowerCase();
          if (name === lowerQuery) return 0;
          if (name.startsWith(lowerQuery)) return 1;
          const tail = name.split('.').pop() ?? name;
          if (tail === lowerQuery) return 2;
          const qualifiedTail = (candidate.qualified ?? '').toLowerCase();
          if (qualifiedTail && qualifiedTail.endsWith(`.${lowerQuery}`)) return 2;
          if (name.includes(lowerQuery) || qualifiedTail.includes(lowerQuery)) return 3;
          return -1;
        };

        const scored = candidates
          .map((candidate) => ({ candidate, tier: rank(candidate) }))
          .filter((entry) => entry.tier >= 0)
          .sort((a, b) => a.tier - b.tier || b.candidate.lines[1] - a.candidate.lines[1]);
        const matches = scored.slice(0, limit).map(({ candidate, tier }) => ({
          resourceId: candidate.resourceId,
          name: candidate.name,
          kind: candidate.kind,
          file: candidate.file,
          lines: candidate.lines,
          ...(candidate.signature ? { signature: candidate.signature } : {}),
          match: (['exact', 'prefix', 'qualified-suffix', 'substring'] as const)[tier],
        }));
        return rpcSuccess(id, {
          matches,
          truncated: scored.length > matches.length,
          totalMatches: scored.length,
        });
      }

      case 'oumv/cancel': {
        // §3 best-effort: requests here are answered within one dispatch, so
        // nothing is observably in-flight — the contract says that is a result.
        if (params?.target === 'last') return rpcSuccess(id, { cancelled: false, finished: true });
        return rpcSuccess(id, { cancelled: false, requestId: params?.requestId });
      }

      case 'oumv/applyEdit':
      case 'oumv/mutate': {
        // §3 idempotent retries (wire 1.6.0): a keyed mutation that already ran
        // replays its first final result instead of re-applying (and re-conflicting).
        const editIdempotencyKey = typeof params?.idempotencyKey === 'string' ? params.idempotencyKey.trim() : '';
        const editIdempotencyScope = `${String(params?.sessionId ?? 'anon')}:${editIdempotencyKey}`;
        if (editIdempotencyKey && idempotencyCache.has(editIdempotencyScope)) {
          return rpcSuccess(id, idempotencyCache.get(editIdempotencyScope) as Record<string, unknown>);
        }
        const editRespond = (payload: Record<string, unknown>) => {
          if (editIdempotencyKey) idempotencyCache.set(editIdempotencyScope, payload);
          return rpcSuccess(id, payload);
        };
        if (isMutateDisabled(rootDir)) {
          return rpcError(
            id,
            ERR_PERMISSION_DENIED,
            'Workspace policy explicitly prohibits mutations (.tokensafe/oumv.json: permissions.mutate=false)'
          );
        }

        const relPath = String(params?.path || params?.filePath || '');
        const newSource = params?.replacement ?? params?.source;
        const expectedVersion = params?.expectedVersion;
        const mode = String(params?.mode || 'replace').toLowerCase();

        if (!relPath) {
          return rpcError(id, ERR_INVALID_PARAMS, 'path is required');
        }
        if (!['replace', 'create', 'symbol', 'delete', 'rename', 'patch'].includes(mode)) {
          return rpcError(id, -32006, `UNSUPPORTED_CAPABILITY: unknown applyEdit mode ${JSON.stringify(mode)}`);
        }

        let resolved: string;
        try {
          resolved = validateProjectPath(relPath, rootDir);
        } catch (err: any) {
          return rpcError(id, ERR_SECURITY, err.message);
        }

        // create mode (spec §4.3): new file, no expectedVersion, never an overwrite.
        if (mode === 'create') {
          if (typeof newSource !== 'string' || newSource.length === 0) {
            return rpcError(id, ERR_INVALID_PARAMS, 'replacement is required for mode=create');
          }
          if (expectedVersion) {
            return rpcError(
              id,
              ERR_VALIDATION_FAILED,
              'VALIDATION_FAILED: expectedVersion must be omitted for mode=create',
              { reason: 'create_forbids_version' }
            );
          }
          if (fs.existsSync(resolved)) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: file already exists; use mode=replace with its version', {
              reason: 'file_exists',
            });
          }
          try {
            parser.parse(newSource, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
          } catch (err: any) {
            return rpcError(id, ERR_SYNTAX, `SYNTAX_ERROR: pre-flight parse failed: ${err.message}`);
          }
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.writeFileSync(resolved, newSource, 'utf-8');
          return editRespond({
            status: 'APPLIED',
            path: path.relative(rootDir, resolved),
            newVersion: 'sha256:' + crypto.createHash('sha256').update(newSource).digest('hex'),
            syntaxCheck: { status: 'passed', tool: '@babel/parser' },
            created: true,
          });
        }

        // patch mode (spec §4.3, wire 1.3.0): splice exact snippets under OCC,
        // with no bytes written when a hunk fails.
        if (mode === 'patch') {
          if (!fs.existsSync(resolved)) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
          }
          if (!expectedVersion || typeof expectedVersion !== 'string') {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to edit an existing file', {
              reason: 'expected_version_required',
            });
          }
          const currentText = fs.readFileSync(resolved, 'utf-8');
          const currentVersion = 'sha256:' + crypto.createHash('sha256').update(currentText).digest('hex');
          if (expectedVersion !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on patch');
          }
          const hunks: any[] = Array.isArray(params?.hunks) ? params.hunks : [];
          if (hunks.length === 0) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: hunks is required for mode=patch', {
              reason: 'hunks_required',
            });
          }
          let text = currentText;
          for (let index = 0; index < hunks.length; index += 1) {
            const hunk = hunks[index] ?? {};
            const target = String(hunk.target ?? '');
            const replacement = String(hunk.replacement ?? '');
            if (!target) {
              return rpcError(id, ERR_VALIDATION_FAILED, `VALIDATION_FAILED: hunk ${index} has an empty target`, {
                reason: 'target_required',
              });
            }
            const count = text.split(target).length - 1;
            if (count === 0) {
              return rpcError(id, ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: hunk ${index} target does not occur in the file`, {
                reason: 'target_not_found',
              });
            }
            if (count > 1 && !hunk.replaceAll) {
              return rpcError(id, ERR_VALIDATION_FAILED, `VALIDATION_FAILED: hunk ${index} target occurs ${count} times`, {
                reason: 'target_not_unique',
                count,
              });
            }
            text = hunk.replaceAll ? text.split(target).join(replacement) : text.replace(target, replacement);
          }
          try {
            parser.parse(text, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
          } catch (err: any) {
            return rpcError(id, ERR_SYNTAX, `SYNTAX_ERROR: pre-flight parse failed: ${err.message}`);
          }
          fs.writeFileSync(resolved, text, 'utf-8');
          return editRespond({
            status: 'APPLIED',
            path: path.relative(rootDir, resolved),
            newVersion: 'sha256:' + crypto.createHash('sha256').update(text).digest('hex'),
            syntaxCheck: { status: 'passed', tool: '@babel/parser' },
            hunksApplied: hunks.length,
          });
        }

        if (mode === 'delete') {
          if (newSource !== undefined && String(newSource) !== '') {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: replacement must be omitted for mode=delete', {
              reason: 'replacement_forbidden',
            });
          }
          if (!fs.existsSync(resolved)) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
          }
          if (!expectedVersion || typeof expectedVersion !== 'string') {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to delete a file', {
              reason: 'expected_version_required',
            });
          }
          const currentVersion = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
          if (expectedVersion !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on delete');
          }
          fs.unlinkSync(resolved);
          return editRespond({
            status: 'APPLIED',
            path: path.relative(rootDir, resolved),
            syntaxCheck: { status: 'skipped' },
            deleted: true,
          });
        }

        if (mode === 'rename') {
          const renameTo = String(params?.renameTo || '').trim();
          if (!renameTo) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: renameTo is required for mode=rename', {
              reason: 'rename_to_required',
            });
          }
          if (newSource !== undefined && String(newSource) !== '') {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: replacement must be omitted for mode=rename', {
              reason: 'replacement_forbidden',
            });
          }
          let target: string;
          try {
            target = validateProjectPath(renameTo, rootDir);
          } catch (err: any) {
            return rpcError(id, ERR_SECURITY, err.message);
          }
          if (!fs.existsSync(resolved)) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
          }
          if (fs.existsSync(target)) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: rename target already exists', {
              reason: 'target_exists',
            });
          }
          if (!expectedVersion || typeof expectedVersion !== 'string') {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to rename a file', {
              reason: 'expected_version_required',
            });
          }
          const currentVersion = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
          if (expectedVersion !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on rename');
          }
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.renameSync(resolved, target);
          return editRespond({
            status: 'APPLIED',
            path: path.relative(rootDir, resolved),
            newPath: renameTo.split(path.sep).join('/'),
            syntaxCheck: { status: 'skipped' },
          });
        }

        if (!fs.existsSync(resolved)) {
          return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
        }

        if (!expectedVersion || typeof expectedVersion !== 'string') {
          return rpcError(
            id,
            ERR_VALIDATION_FAILED,
            'VALIDATION_FAILED: expectedVersion (sha256 OCC token) is required for oumv/applyEdit'
          );
        }

        if (mode === 'symbol') {
          const symbol = String(params?.symbol || '').trim();
          if (!symbol) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: symbol is required for mode=symbol', {
              reason: 'symbol_required',
            });
          }
          if (typeof newSource !== 'string' || newSource.length === 0) {
            return rpcError(id, ERR_INVALID_PARAMS, 'replacement is required for mode=symbol');
          }
          const current = fs.readFileSync(resolved, 'utf-8');
          const currentVersion = 'sha256:' + crypto.createHash('sha256').update(current).digest('hex');
          if (expectedVersion !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on symbol edit');
          }
          const range = extractSymbolRange(current, symbol);
          if (!range) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: symbol ${JSON.stringify(symbol)} not found`);
          }
          const patched = replaceLinesAt(current, range.startLine, range.endLine, newSource);
          try {
            parser.parse(patched, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
          } catch (err: any) {
            return rpcError(id, ERR_SYNTAX, `SYNTAX_ERROR: pre-flight parse failed: ${err.message}`);
          }
          let backupPath: string | undefined;
          try {
            const backupDir = path.join(rootDir, '.tokensafe', 'backups');
            fs.mkdirSync(backupDir, { recursive: true });
            const target = path.join(backupDir, `${Date.now()}-${path.basename(resolved)}`);
            fs.writeFileSync(target, current, 'utf-8');
            backupPath = path.relative(rootDir, target);
          } catch {
            backupPath = undefined;
          }
          fs.writeFileSync(resolved, patched, 'utf-8');
          return editRespond({
            status: 'APPLIED',
            path: path.relative(rootDir, resolved),
            symbol,
            newVersion: 'sha256:' + crypto.createHash('sha256').update(patched).digest('hex'),
            syntaxCheck: { status: 'passed', tool: '@babel/parser' },
            ...(backupPath ? { backupPath } : {}),
          });
        }

        try {
          const res = (await loadMcpTools()).atomicApplySourceEdit(resolved, newSource, {
            expectedVersion,
            validateTypeScript: /\.(tsx?|jsx?)$/.test(resolved),
            createBackup: true,
          });

          // HMR invalidation is a nicety: embedded/headless controllers (fixture
          // runs, certification) have a server without a module graph.
          if (server?.moduleGraph) {
            const mod = server.moduleGraph.getModuleById(resolved);
            if (mod) {
              server.moduleGraph.invalidateModule(mod);
              await server.reloadModule(mod);
            }
          }

          return editRespond({
            success: true,
            status: 'APPLIED',
            path: path.relative(rootDir, res.filePath),
            filePath: path.relative(rootDir, res.filePath),
            newVersion: res.version,
            version: res.version,
            backupPath: res.backupPath,
            message: res.message,
          });
        } catch (err: any) {
          const msg = String(err?.message || err);
          if (msg.includes('CONFLICT_DETECTED')) {
            return rpcError(id, ERR_CONFLICT, msg);
          }
          if (msg.includes('SYNTAX_ERROR') || msg.includes('TYPESCRIPT_DIAGNOSTIC_ERROR')) {
            return rpcError(id, ERR_SYNTAX, msg);
          }
          if (msg.includes('SECURITY_VIOLATION')) {
            return rpcError(id, ERR_SECURITY, msg);
          }
          return rpcError(id, ERR_INTERNAL, msg);
        }
      }

      case 'oumv/verify': {
        const target = String(params?.target || params?.componentId || '').trim();
        const action = String(params?.action || 'click').trim();
        const steps = Array.isArray(params?.steps) ? params.steps : [];
        if (!target && steps.length === 0) {
          return rpcError(id, ERR_INVALID_PARAMS, 'target is required for oumv/verify');
        }

        if (steps.length > 0) {
          const results: Array<{ target: string; statusCode: number; status: string; responseBody: unknown }> = [];
          let total = 0;
          for (const step of steps) {
            const stepTarget = String(step?.target || '').trim();
            if (!stepTarget) {
              return rpcError(id, ERR_INVALID_PARAMS, 'every verify step needs a target');
            }
            const stepAction = String(step?.action || 'click').trim();
            const stepRes = await requestBrowserVerify(stepTarget, stepAction, step?.payload);
            if (stepRes.errorCode) {
              return rpcError(id, stepRes.errorCode, stepRes.error);
            }
            const stepMs = Number(stepRes.durationMs ?? 0);
            total += stepMs;
            results.push({
              target: stepRes.target || stepTarget,
              statusCode: stepRes.status === 'failed' ? 500 : 200,
              status: stepRes.status === 'failed' ? 'failed' : 'passed',
              responseBody: stepRes.diff ?? {},
            });
          }
          const last = results[results.length - 1];
          return rpcSuccess(id, {
            status: 'passed',
            target: target || last.target,
            statusCode: last.statusCode,
            steps: results,
            diff: { stepCount: results.length },
            timings: { t_action_ms: total, t_schema_ms: 0, t_propagation_ms: 0, t_dom_ms: 0, t_total_ms: total },
            durationMs: total,
            scope: {
              checked: ['ordered browser-bridge dispatch'],
              notExecuted: ['native OS events', 'real network'],
              notSupported: ['multi-tab coordination'],
            },
          });
        }

        const verifyRes = await requestBrowserVerify(target, action, params?.payload);
        if (verifyRes.errorCode) {
          return rpcError(id, verifyRes.errorCode, verifyRes.error);
        }
        if (verifyRes.status === 'failed') {
          return rpcError(id, ERR_ACTION_NOT_FOUND, verifyRes.error || 'Verification failed');
        }
        const totalMs = Number(verifyRes.durationMs ?? 0);
        const actionMs = Number(verifyRes.latency?.actionMs ?? 0);
        const domMs = Number(Math.max(0, totalMs - actionMs).toFixed(2));
        return rpcSuccess(id, {
          status: 'passed',
          target: verifyRes.target || target,
          componentId: params?.componentId || verifyRes.target || target,
          action: verifyRes.action || action,
          diff: verifyRes.diff || {},
          surfaceDiff: verifyRes.surfaceDiff || [],
          timings: {
            t_action_ms: actionMs,
            t_schema_ms: 0,
            t_propagation_ms: 0,
            t_dom_ms: domMs,
            t_total_ms: totalMs,
          },
          durationMs: totalMs,
          scope: {
            checked: ['browser bridge dispatch (synthetic events)'],
            notExecuted: ['native OS events', 'real network'],
            notSupported: ['multi-tab coordination'],
          },
          latency: verifyRes.latency,
          evidence: {
            provenance: 'runtime',
            sourceAdapter: 'tokensafe-ui-react-vite',
            confidence: 'confirmed',
          },
        });
      }

      default:
        return rpcError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  const handleSingleRpc = async (payload: any): Promise<{ statusCode: number; body: any }> => {
    const out = await dispatchRpc(payload);
    // §2.1 (wire 1.6.0): echo params.requestId so agents can correlate replies.
    const requestId = payload?.params?.requestId;
    if (requestId && out && typeof out.body === 'object' && out.body !== null && !Array.isArray(out.body)) {
      out.body = { requestId, ...out.body };
    }
    return normalizeResult(String(payload?.method ?? ''), out);
  };

  const handleRpcPayload = async (payload: any): Promise<{ statusCode: number; body: any }> => {
    // Spec §2.2: batch arrays are accepted over HTTP bodies and WS frames.
    if (Array.isArray(payload)) {
      const responses: any[] = [];
      for (const item of payload) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          responses.push({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'INVALID_REQUEST: batch entries must be JSON-RPC objects' },
          });
          continue;
        }
        const isNotification = item.id === undefined;
        const out = await handleRpcPayload(item);
        if (isNotification && !out.body?.error) continue;
        responses.push(out.body);
      }
      return { statusCode: 200, body: responses };
    }

    return handleSingleRpcWithState(payload);
  };

  // One hook for every editing method: the result is already persisted when the
  // handler returns APPLIED, so the event never announces a mutation that failed.
  const handleSingleRpcWithState = async (payload: any) => {
    const out = await handleSingleRpc(payload);
    const result = out.body?.result;
    if (!Array.isArray(payload) && payload?.method === 'oumv/applyEdit' && result?.status === 'APPLIED') {
      recordState(
        String(result.path ?? payload.params?.path ?? ''),
        String(result.newVersion ?? ''),
        String(payload.params?.mode ?? 'replace').toLowerCase()
      );
    }
    return out;
  };

  const callAdapterMethod = async (method: string, params: any = {}) => {
    const out = await handleRpcPayload({ id: 1, method, params });
    if (out.body?.error) {
      const err: any = new Error(`[${out.body.error.code}] ${out.body.error.message}`);
      err.code = out.body.error.code;
      throw err;
    }
    return out.body?.result;
  };

  const asOumvAdapter = () => ({
    name: 'react',
    version: reactVersion,
    handshake: (params?: any) => callAdapterMethod('oumv/handshake', params),
    observe: (params: any) => callAdapterMethod('oumv/observe', params),
    understand: (params: any) => callAdapterMethod('oumv/understand', params),
    getSource: (params: any) => callAdapterMethod('oumv/getSource', params),
    applyEdit: (params: any) => callAdapterMethod('oumv/applyEdit', params),
    verify: (params: any) => callAdapterMethod('oumv/verify', params),
  });

  return {
    handleRpcPayload,
    asOumvAdapter,
    isBrowserConnected,
    getLatestSnapshot: () => latestSnapshot,
    getTraces: () => traces.slice(),
    getTracesSince,
    getEventsSince,
    // §2.6: the plugin forwards build/HMR failures the dev server already observes.
    recordDiagnostic,
    reactVersion,
  };
}
