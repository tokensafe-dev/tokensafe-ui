import type { ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
import { scanSourceForComponents } from '@tokensafe-ui/oumv/static';
import { getCanonicalWorkspaceRoot } from './runtime-store.js';
import { applyEditBatch } from './batch-edit.js';
import { isReadOnlyAbsentMethod } from './read-only.js';

const loadMcpTools = () => import('@tokensafe-ui/mcp');

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

export interface VueRpcOptions {
  rootDir: string;
  sessionToken?: string;
  server?: ViteDevServer;
  /** §8.5: register only the read methods; mutating methods answer -32601. */
  readOnly?: boolean;
}

export interface VueComponentInfo {
  id: string;
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  propsKeys: string[];
  actions: string[];
  scripts: number;
}

export interface VueRouteInfo {
  path: string;
  name?: string;
  componentName?: string;
  filePath: string;
}

export interface VueStaticIndex {
  components: VueComponentInfo[];
  routes: VueRouteInfo[];
  files: string[];
  imports: Map<string, string[]>;
  totalScannedFiles: number;
}

export interface VueBridgeSnapshot {
  framework: string;
  route: string;
  title?: string;
  elementCount: number;
  mountedComponents: Array<{
    id: string;
    name: string;
    instances: number;
    propsKeys: string[];
    stateKeys: string[];
    source?: { fileName?: string };
  }>;
  interactiveSurface: Array<{
    id: string;
    tag: string;
    role?: string;
    label?: string;
    value?: unknown;
    disabled?: boolean;
    action?: string;
  }>;
  registeredStores?: Record<string, { state: Record<string, unknown>; actions: string[] }>;
  registeredComponents?: Record<string, { state: Record<string, unknown>; actions: string[] }>;
  contracts?: Array<Record<string, unknown>>;
  errorsCount?: number;
  tracesCount?: number;
  timestamp: number;
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.tokensafe',
  '.vite',
  '.nuxt',
  '.output',
]);

const SOURCE_EXTENSIONS = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx', '.mjs']);

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSourceFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (SOURCE_EXTENSIONS.has(ext)) out.push(path.join(dir, entry.name));
  }
  return out;
}

function sha256(content: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function lineCount(content: string): number {
  return content.split('\n').length;
}

interface SfcParts {
  script: string;
  scriptStartLine: number;
}

function extractSfcScript(source: string): SfcParts {
  const lines = source.split('\n');
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(source);
  if (!match || match.index === undefined) return { script: '', scriptStartLine: 1 };
  const before = source.slice(0, match.index + match[0].indexOf('>') + 1);
  return { script: match[1], scriptStartLine: before.split('\n').length };
}

function extractSfcTemplate(source: string): { template: string; templateStartLine: number } {
  const match = /<template\b[^>]*>([\s\S]*?)<\/template>/i.exec(source);
  if (!match || match.index === undefined) return { template: '', templateStartLine: 1 };
  const before = source.slice(0, match.index + match[0].indexOf('>') + 1);
  return { template: match[1], templateStartLine: before.split('\n').length };
}

function parseScriptAst(script: string): { program: { body: any[] } } | null {
  if (!script.trim()) return null;
  try {
    return parser.parse(script, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
      errorRecovery: false,
    });
  } catch {
    return null;
  }
}

function nodeName(node: any): string | null {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  return null;
}

/** Top-level declaration ranges of a script block, used for symbol edits and L3 slices. */
function collectScriptSymbols(script: string): Array<{ name: string; startLine: number; endLine: number }> {
  const ast = parseScriptAst(script);
  if (!ast) return [];
  const found: Array<{ name: string; startLine: number; endLine: number }> = [];
  const push = (name: string | null, node: any) => {
    if (!name || !node.loc) return;
    found.push({ name, startLine: node.loc.start.line, endLine: node.loc.end.line });
  };
  for (const node of ast.program.body as any[]) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      push(node.id ? node.id.name : null, node);
      continue;
    }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      if (!decl) continue;
      if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
        push(decl.id ? decl.id.name : null, decl);
      } else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) push(nodeName(d.id), d);
      }
    }
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) push(nodeName(d.id), d);
    }
  }
  return found;
}

function extractSymbolRange(source: string, filePath: string, symbol: string): { source: string; startLine: number; endLine: number } | null {
  const ext = path.extname(filePath);
  const isSfc = ext === '.vue';
  const parts = isSfc ? extractSfcScript(source) : { script: source, scriptStartLine: 1 };
  const symbols = collectScriptSymbols(parts.script);
  const hit = symbols.find((s) => s.name === symbol);
  const lines = source.split('\n');
  if (!hit) {
    // A Vue component's implicit symbol is the file itself.
    if (isSfc && symbol === path.basename(filePath, ext)) {
      return { source, startLine: 1, endLine: lines.length };
    }
    return null;
  }
  const offset = parts.scriptStartLine - 1;
  const startLine = hit.startLine + offset;
  const endLine = hit.endLine + offset;
  return { source: lines.slice(startLine - 1, endLine).join('\n'), startLine, endLine };
}

function readPropsKeys(script: string, template: string): string[] {
  const keys = new Set<string>();
  const generic = /defineProps\s*<\s*\{([\s\S]*?)\}\s*>/.exec(script);
  if (generic) {
    for (const m of generic[1].matchAll(/([A-Za-z_$][\w$]*)\s*\??\s*:/g)) keys.add(m[1]);
  }
  const array = /defineProps\s*\(\s*\[([\s\S]*?)\]\s*\)/.exec(script);
  if (array) {
    for (const m of array[1].matchAll(/['"]([^'"]+)['"]/g)) keys.add(m[1]);
  }
  const object = /props\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(script);
  if (object) {
    for (const m of object[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) keys.add(m[1]);
  }
  for (const m of template.matchAll(/\bprops\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  return Array.from(keys).slice(0, 30);
}

function readActions(script: string, template: string): string[] {
  const actions = new Set<string>();
  for (const m of template.matchAll(/@[a-zA-Z][\w.-]*\s*=\s*"([^"]+)"/g)) {
    const expression = m[1].trim();
    const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expression);
    if (call) actions.add(call[1]);
  }
  for (const m of script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) actions.add(m[1]);
  for (const m of script.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)) {
    actions.add(m[1]);
  }
  for (const m of script.matchAll(/^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) actions.add(m[1]);
  return Array.from(actions).slice(0, 40);
}

function readImports(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/\bimport\s+[^'"]*?from\s+['"]([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
  return Array.from(out);
}

/** Static Vue project index: SFCs, routes, import graph — no code execution. */
export function scanVueProject(rootDir: string): VueStaticIndex {
  const components: VueComponentInfo[] = [];
  const routes: VueRouteInfo[] = [];
  const imports = new Map<string, string[]>();
  const files = walkSourceFiles(rootDir);
  const routeHits: Array<{ path: string; name?: string; componentName?: string; filePath: string }> = [];

  for (const file of files) {
    const rel = path.relative(rootDir, file).split(path.sep).join('/');
    let source = '';
    try {
      source = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    imports.set(rel, readImports(source));

    const ext = path.extname(file);
    if (ext === '.vue') {
      const { script } = extractSfcScript(source);
      const { template } = extractSfcTemplate(source);
      components.push({
        id: `frontend.component:${path.basename(file, ext)}`,
        name: path.basename(file, ext),
        filePath: rel,
        lineStart: 1,
        lineEnd: lineCount(source),
        propsKeys: readPropsKeys(script, template),
        actions: readActions(script, template),
        scripts: script ? 1 : 0,
      });
      continue;
    }

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs') {
      for (const discovered of scanSourceForComponents(source, rel)) {
        components.push({
          id: discovered.id,
          name: discovered.name,
          filePath: rel,
          lineStart: discovered.lineStart,
          lineEnd: discovered.lineEnd,
          propsKeys: discovered.propsInterface ? [discovered.propsInterface] : [],
          actions: discovered.actionTriggers || [],
          scripts: 1,
        });
      }
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const pathMatch = /path\s*:\s*['"]([^'"]+)['"]/.exec(lines[i]);
        if (!pathMatch) continue;
        const windowText = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 12)).join('\n');
        const componentMatch = /component\s*:\s*(?:\(\)\s*=>\s*)?(?:import\s*\(\s*['"][^'"]+['"]\s*\)|([A-Za-z_$][\w$]*))/.exec(windowText);
        const nameMatch = /name\s*:\s*['"]([^'"]+)['"]/.exec(windowText);
        routeHits.push({
          path: pathMatch[1],
          name: nameMatch ? nameMatch[1] : undefined,
          componentName: componentMatch && componentMatch[1] ? componentMatch[1] : undefined,
          filePath: rel,
        });
      }
    }
  }

  routes.push(...routeHits.slice(0, 100));
  return { components, routes, files, imports, totalScannedFiles: files.length };
}

function pageSlice<T>(items: T[], limitRaw: unknown, cursorRaw: unknown): { page: T[]; hasMore?: boolean; nextCursor?: string } {
  const limit = Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0 ? Math.min(Number(limitRaw), 100) : items.length;
  const cursor = Number.isFinite(Number(cursorRaw)) && Number(cursorRaw) > 0 ? Number(cursorRaw) : 0;
  const page = items.slice(cursor, cursor + limit);
  const next = cursor + page.length;
  return next < items.length ? { page, hasMore: true, nextCursor: String(next) } : { page };
}

export function validateVueSource(filePath: string, source: string): void {
  const ext = path.extname(filePath);
  if (ext === '.vue') {
    const hasTemplate = /<template[\s>]/i.test(source);
    const hasScript = /<script[\s>]/i.test(source);
    if (!hasTemplate && !hasScript) {
      throw new Error('SYNTAX_ERROR: invalid Vue SFC — missing <template> or <script> block');
    }
    const { script } = extractSfcScript(source);
    if (script.trim() && !parseScriptAst(script)) {
      throw new Error('SYNTAX_ERROR: the SFC <script> block does not parse');
    }
    const open = (source.match(/<template[\s>]/gi) || []).length;
    const close = (source.match(/<\/template>/gi) || []).length;
    if (open !== close) {
      throw new Error('SYNTAX_ERROR: unbalanced <template> block');
    }
    return;
  }
  try {
    parser.parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: false });
  } catch (err: any) {
    throw new Error(`SYNTAX_ERROR: pre-flight parse failed: ${err.message}`);
  }
}

function validateProjectPath(inputPath: string, projectRoot: string): string {
  let canonicalRoot = path.resolve(projectRoot);
  try {
    if (fs.existsSync(canonicalRoot)) canonicalRoot = fs.realpathSync(canonicalRoot);
  } catch {}
  let resolved = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(canonicalRoot, inputPath);
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

interface Hunk {
  target: string;
  replacement: string;
  startLine?: number;
  endLine?: number;
  replaceAll?: boolean;
}

function applyHunksToSource(source: string, hunks: Hunk[]): { source: string; hunksApplied: number } {
  let current = source;
  hunks.forEach((hunk, index) => {
    const target = String(hunk.target ?? '');
    if (!target) {
      const err: any = new Error(`VALIDATION_FAILED: hunk ${index} has an empty target`);
      err.rpcCode = ERR_VALIDATION_FAILED;
      err.rpcData = { hunk: index, reason: 'empty_target' };
      throw err;
    }
    const lines = current.split('\n');
    const from = hunk.startLine && hunk.startLine > 0 ? Math.min(hunk.startLine, lines.length) : 1;
    const to = hunk.endLine && hunk.endLine >= from ? Math.min(hunk.endLine, lines.length) : lines.length;
    const windowText = lines.slice(from - 1, to).join('\n');

    const positions: number[] = [];
    let cursor = windowText.indexOf(target);
    while (cursor !== -1 && positions.length < 50) {
      positions.push(cursor);
      cursor = windowText.indexOf(target, cursor + Math.max(1, target.length));
    }
    if (positions.length === 0) {
      const err: any = new Error(`RESOURCE_NOT_FOUND: hunk ${index} target does not occur in the file`);
      err.rpcCode = ERR_RESOURCE_NOT_FOUND;
      err.rpcData = { hunk: index, reason: 'target_not_found', startLine: from, endLine: to };
      throw err;
    }
    if (positions.length > 1 && !hunk.replaceAll) {
      const lineNumbers = positions.map(
        (pos) => from + (windowText.slice(0, pos).match(/\n/g) || []).length
      );
      const err: any = new Error(`VALIDATION_FAILED: hunk ${index} target occurs ${positions.length} times`);
      err.rpcCode = ERR_VALIDATION_FAILED;
      // Machine-actionable: every occurrence, plus a scoped retry the caller can apply verbatim.
      err.rpcData = {
        hunk: index,
        reason: 'target_not_unique',
        count: positions.length,
        lines: lineNumbers,
        target: target.slice(0, 120),
        suggestedHunks: lineNumbers.map((line) => ({
          target,
          replacement: hunk.replacement,
          startLine: Math.max(1, line - 3),
          endLine: Math.max(1, line + target.split('\n').length + 2),
        })),
      };
      throw err;
    }

    const replacedWindow = hunk.replaceAll
      ? windowText.split(target).join(hunk.replacement)
      : windowText.slice(0, positions[0]) + hunk.replacement + windowText.slice(positions[0] + target.length);
    current = [...lines.slice(0, from - 1), ...replacedWindow.split('\n'), ...lines.slice(to)].join('\n');
  });
  return { source: current, hunksApplied: hunks.length };
}

export function createVueOumvController(options: VueRpcOptions) {
  // Same canonical-root rule as the React controller: reported paths stay relative
  // even when the root is reached through a symlink (macOS /var → /private/var).
  const rootDir = getCanonicalWorkspaceRoot(options.rootDir);
  const { server } = options;
  const readOnly = options.readOnly === true;
  const packagePath = path.join(rootDir, 'package.json');
  let vueVersion = '3.x';
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.vue) vueVersion = String(deps.vue).replace(/^[^\d]*/, '');
  } catch {}
  setTimeout(() => {
    void loadMcpTools().catch(() => {});
  }, 0);

  const traces: Array<Record<string, any>> = [];
  const MAX_TRACES = 128;
  let traceSeq = 0;
  let staticIndexCache: { at: number; index: VueStaticIndex } | null = null;
  let latestSnapshot: VueBridgeSnapshot | null = null;
  let lastClientSeenAt = 0;

  const pendingObserve = new Map<string, { resolve: (val: any) => void; timer: ReturnType<typeof setTimeout> }>();
  const pendingVerify = new Map<string, { resolve: (val: any) => void; timer: ReturnType<typeof setTimeout> }>();

  const staticIndex = (): VueStaticIndex => {
    const now = Date.now();
    if (staticIndexCache && now - staticIndexCache.at < 750) return staticIndexCache.index;
    const index = scanVueProject(rootDir);
    staticIndexCache = { at: now, index };
    return index;
  };

  const toIso = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = typeof value === 'number' ? value : Date.parse(value);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
  };

  const recordTrace = (trace: Record<string, any>) => {
    if (!trace || typeof trace !== 'object') return;
    const route = String(trace.route ?? trace.path ?? trace.url ?? '');
    const statusCode = Number(trace.statusCode ?? trace.status ?? 200);
    traces.push({
      ...trace,
      seq: ++traceSeq,
      method: String(trace.method ?? trace.action ?? 'BROWSER'),
      path: String(trace.path ?? route),
      route,
      handler: String(trace.handler ?? 'vue-bridge'),
      statusCode: Number.isFinite(statusCode) ? statusCode : 200,
      durationMs: Number(trace.durationMs ?? 0) || 0,
      timestamp: toIso(trace.timestamp),
    });
    if (traces.length > MAX_TRACES) traces.shift();
  };

  // Mutations share the trace id space so SSE `Last-Event-ID` and WS
  // notifications replay trace and state events in one ordered stream.
  const stateEvents: Array<{ seq: number; path: string; version: string; operation: string }> = [];
  const recordState = (path: string, version: string, operation: string) => {
    stateEvents.push({ seq: ++traceSeq, path, version, operation });
    if (stateEvents.length > MAX_TRACES) stateEvents.shift();
  };
  // §2.6 (wire 1.6.0): dev-server build/HMR failures flow on the push transports.
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
    server.ws.on('oumv:vue-snapshot', (data: VueBridgeSnapshot) => {
      if (data && typeof data === 'object') {
        latestSnapshot = data;
        lastClientSeenAt = Date.now();
      }
    });
    server.ws.on('oumv:vue-trace', (data: Record<string, any>) => {
      if (data && typeof data === 'object') {
        lastClientSeenAt = Date.now();
        recordTrace(data);
      }
    });
    server.ws.on('oumv:vue-observe-res', (data: any) => {
      const pending = data?.requestId ? pendingObserve.get(data.requestId) : null;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingObserve.delete(data.requestId);
      if (data.snapshot) {
        latestSnapshot = data.snapshot;
        lastClientSeenAt = Date.now();
      }
      pending.resolve(data);
    });
    server.ws.on('oumv:vue-verify-res', (data: any) => {
      const pending = data?.requestId ? pendingVerify.get(data.requestId) : null;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingVerify.delete(data.requestId);
      lastClientSeenAt = Date.now();
      pending.resolve(data);
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
      pendingObserve.set(requestId, { resolve: () => resolve(), timer });
      server.ws.send('oumv:vue-observe', { requestId });
    });
  };

  const requestBrowserVerify = async (target: string, action: string, payload?: unknown, timeoutMs = 4000): Promise<any> => {
    if (!server || !isBrowserConnected()) {
      return {
        status: 'failed',
        errorCode: ERR_RUNTIME_UNAVAILABLE,
        error: 'No live browser tab connected to Vite DevServer. Open the app URL in a browser to verify Vue actions live.',
      };
    }
    const requestId = crypto.randomUUID();
    return await new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        pendingVerify.delete(requestId);
        resolve({ status: 'failed', errorCode: ERR_RUNTIME_UNAVAILABLE, error: 'Timed out waiting for live browser verification response.' });
      }, timeoutMs);
      pendingVerify.set(requestId, { resolve, timer });
      server.ws.send('oumv:vue-verify', { requestId, target, action, payload });
    });
  };

  const rpcSuccess = (id: any, result: any) => ({ statusCode: 200, body: { jsonrpc: '2.0', id: id ?? 1, result } });
  const rpcError = (id: any, code: number, message: string, data?: any, statusCode = 200) => ({
    statusCode,
    body: { jsonrpc: '2.0', id: id ?? 1, error: { code, message, ...(data !== undefined ? { data } : {}) } },
  });

  const sessions = new Map<string, number>();

/**
 * §3 idempotent retries (wire 1.6.0): per-session key -> first final result.
 */
const idempotencyCache = new Map<string, Record<string, unknown>>();

/** §4.1 result versioning: directories whose churn is not source. */
const DIGEST_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.tokensafe', '.oumv', 'coverage', '.next',
  '.cache', '.turbo', '.output',
]);

/**
 * §4.1 result versioning (wire 1.6.0): sha256 over the workspace inventory
 * (relative path, size, mtime). Recomputed per call — a cached token would
 * defeat the freshness check it exists for.
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

  const findComponent = (index: VueStaticIndex, targetRaw: string) => {
    const target = targetRaw.replace(/^frontend\.component:/, '');
    const normalized = target.split('/').join(path.sep);
    return (
      index.components.find((c) => c.name === target) ||
      index.components.find((c) => c.filePath === targetRaw || c.filePath === normalized) ||
      index.components.find((c) => c.filePath.endsWith('/' + target)) ||
      null
    );
  };

  const fileOfTarget = (index: VueStaticIndex, targetRaw: string): string | null => {
    if (!targetRaw) return null;
    const direct = path.resolve(rootDir, targetRaw);
    if (fs.existsSync(direct)) {
      const rel = path.relative(rootDir, direct).split(path.sep).join('/');
      return rel;
    }
    const comp = findComponent(index, targetRaw);
    return comp ? comp.filePath : null;
  };

  const l1Data = (limitRaw: unknown, cursorRaw: unknown, filterRaw: string) => {
    const index = staticIndex();
    const snap = latestSnapshot;
    const filter = filterRaw.toLowerCase().replace(/^frontend\.component:/, '');
    const mounted = (snap?.mountedComponents || []).filter((c) => !filter || c.name.toLowerCase().includes(filter));
    const elements = (snap?.interactiveSurface || []).filter(
      (el) => !filter || el.id.toLowerCase().includes(filter) || (el.label || '').toLowerCase().includes(filter)
    );
    const staticComponents = index.components.filter(
      (c) => !filter || c.name.toLowerCase().includes(filter) || c.filePath.toLowerCase().includes(filter)
    );
    const items = [
      ...mounted.map((c) => ({ kind: 'mounted', id: c.id, name: c.name, instances: c.instances, props: c.propsKeys })),
      ...elements.map((el) => ({ kind: 'element', id: el.id, tag: el.tag, role: el.role, label: el.label, value: el.value, action: el.action })),
      ...staticComponents.map((c) => ({ kind: 'static', id: c.id, name: c.name, filePath: c.filePath, props: c.propsKeys, actions: c.actions })),
    ];
    const page = pageSlice(items, limitRaw, cursorRaw);
    return {
      view: filter || snap?.route || '/',
      framework: 'vue',
      browserConnected: Boolean(snap),
      route: snap?.route || '/',
      mounted: (snap?.mountedComponents || []).map((c) => c.name),
      elements,
      components: staticComponents.slice(0, 40).map((c) => ({ name: c.name, filePath: c.filePath, props: c.propsKeys })),
      items: page.page,
      total: items.length,
      hasMore: Boolean(page.hasMore),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      evidence: {
        provenance: snap ? ('runtime' as const) : ('static' as const),
        sourceAdapter: 'tokensafe-ui-vue-vite',
        confidence: 'confirmed' as const,
      },
    };
  };

  const impactFor = (index: VueStaticIndex, target: string) => {
    const comp = findComponent(index, target);
    const file = comp ? comp.filePath : fileOfTarget(index, target);
    const affected: Array<{ file: string; symbol: string; reason: string }> = [];
    if (file) {
      const base = path.basename(file).replace(path.extname(file), '');
      for (const [from, specifiers] of index.imports) {
        for (const specifier of specifiers) {
          if (specifier.includes(base) || specifier.includes(file.replace(/\.[^.]+$/, ''))) {
            affected.push({ file: from, symbol: base, reason: `imports ${specifier}` });
          }
        }
      }
    }
    for (const route of index.routes) {
      if (comp && route.componentName === comp.name) {
        affected.push({ file: route.filePath, symbol: route.componentName || '', reason: `route ${route.path}` });
      }
    }
    const seen = new Set<string>();
    const affectedSymbols = affected.filter((a) => {
      const key = `${a.file}#${a.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      target: comp ? comp.name : target,
      affectedSymbols,
      breakingRisk: affectedSymbols.length === 0 ? 'low' : affectedSymbols.length <= 3 ? 'medium' : 'high',
      summary: comp
        ? `${comp.name} (${comp.filePath}) is referenced by ${affectedSymbols.length} static site(s)`
        : `No static component matched '${target}'`,
      observed: Boolean(comp),
      evidence: {
        provenance: 'static' as const,
        sourceAdapter: 'tokensafe-ui-vue-vite',
        confidence: comp ? ('confirmed' as const) : ('unknown' as const),
      },
    };
  };

  const dispatchOne = async (payload: any): Promise<{ statusCode: number; body: any }> => {
    const { id, method, params = {} } = payload || {};

    // §8.5 (read-only deployment): the mutating methods are absent from the
    // registry, so the answer is -32601 before any sessionId validation — a
    // stale token must not turn absence into -32011 (or -32007).
    if (readOnly && isReadOnlyAbsentMethod(method)) {
      return rpcError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }

    if (method === 'oumv/disconnect') {
      return rpcSuccess(id, { closed: sessions.delete(String(params.sessionId || '')) });
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
        const requested = String(params?.protocolVersion ?? '').trim();
        if (requested) {
          const [majorRaw, minorRaw] = requested.split('.');
          const major = Number(majorRaw);
          const minor = Number(minorRaw);
          if (!Number.isInteger(major) || !Number.isInteger(minor) || major !== 1 || minor > 6) {
            return rpcError(id, ERR_UNSUPPORTED, `UNSUPPORTED_CAPABILITY: protocol version ${requested} (this runtime serves 1.6.0)`);
          }
        }
        const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;
        // Wire 1.5.0: honour a client-requested lifetime, clamped to [1, 86400].
        const rawTtl = Number(params?.sessionTtlSeconds);
        const grantedTtl =
          Number.isFinite(rawTtl) && rawTtl > 0 ? Math.min(Math.max(Math.floor(rawTtl), 1), 86400) : SESSION_TTL_SECONDS;
        sessions.set(sessionId, Date.now() + grantedTtl * 1000);
        // §8.5 (read-only deployment, wire 1.6.0): the mutating methods are not
        // registered, so the handshake advertises `readOnly: true` and omits
        // `mutate`/`verify`. The shipped default profile stays read-write.
        const capabilities: any = {
          ...(readOnly ? { readOnly: true } : {}),
          observe: { levels: ['L0', 'L1', 'L2', 'L3', 'L4'], formats: ['yaml', 'json'] },
          understand: { causality: true, signalsGraph: false, componentGraph: true, impactAnalysis: true },
          ...(readOnly
            ? {}
            : {
                mutate: { occ: true, syntaxGuard: true, preview: true, ephemeralDispatch: true, multiFile: true },
                verify: { multiMetric: true, surfaceDiff: true },
              }),
          // Wire 1.6.0: §14.1 symbol search over the static Vue index.
          index: { symbols: true },
          // Wire 1.5.0: the handshake honours sessionTtlSeconds and echoes ttlSeconds.
          sessions: { ttlSeconds: true, cancel: true, idempotency: true },
        };
        const requestedCapabilities = params?.requestedCapabilities;
        if (requestedCapabilities && typeof requestedCapabilities === 'object') {
          const levels = Array.isArray(requestedCapabilities.observe?.levels) ? requestedCapabilities.observe.levels : [];
          const formats = Array.isArray(requestedCapabilities.observe?.formats) ? requestedCapabilities.observe.formats : [];
          if (levels.length > 0) capabilities.observe.levels = capabilities.observe.levels.filter((l: string) => levels.includes(l));
          if (formats.length > 0) capabilities.observe.formats = capabilities.observe.formats.filter((f: string) => formats.includes(f));
        }
        return rpcSuccess(id, {
          protocolVersion: '1.6.0',
          profile: 'frontend',
          sessionId,
          ttlSeconds: grantedTtl,
          runtimeInfo: { name: 'vue', version: vueVersion, framework: `Vue ${vueVersion} + Vite` },
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
        const format = String(params?.format || 'json').toLowerCase() as 'yaml' | 'json';
        const target = String(params?.componentId || params?.target || '').trim();
        if (level === 'L0' || level === 'L1' || level === 'L2' || level === 'L4') {
          await requestFreshBrowserObserve();
        }
        const index = staticIndex();
        const snap = latestSnapshot;

        if (level === 'L0') {
          const data = snap
            ? {
                status: 'ok',
                framework: 'vue',
                browserConnected: true,
                route: snap.route,
                uptimeSeconds: Math.round((Date.now() - (snap.timestamp || Date.now())) / 1000),
                mountedCount: snap.mountedComponents.length,
                mounted: snap.mountedComponents.slice(0, 15).map((c) => c.name),
                elements: snap.elementCount,
                interactiveCount: snap.interactiveSurface.length,
                errors: snap.errorsCount ?? 0,
                traces: traces.length,
                staticComponentsCount: index.components.length,
                staticFilesScanned: index.totalScannedFiles,
              }
            : {
                status: 'ok',
                framework: 'vue',
                browserConnected: false,
                route: '/',
                uptimeSeconds: 0,
                mounted: [],
                elements: 0,
                errors: 0,
                staticComponentsCount: index.components.length,
                staticFilesScanned: index.totalScannedFiles,
                note: 'Vite DevServer is online; open the app in a browser tab for live Vue telemetry.',
              };
          return observeRespond({
            level: 'L0',
            format,
            data,
            tokenEstimate: Math.ceil(JSON.stringify(data).length / 4),
            evidence: {
              provenance: snap ? 'runtime' : 'static',
              sourceAdapter: 'tokensafe-ui-vue-vite',
              confidence: 'confirmed',
            },
          });
        }

        if (level === 'L1') {
          const data = l1Data(params?.limit, params?.cursor, target);
          return observeRespond({ level: 'L1', format, data, tokenEstimate: Math.ceil(JSON.stringify(data).length / 4) });
        }

        if (level === 'L2') {
          if (!target) {
            return rpcError(id, ERR_INVALID_PARAMS, 'target (component name or filePath) is required for L2 observe');
          }
          const comp = findComponent(index, target);
          const registered = snap?.registeredComponents?.[target] || snap?.registeredStores?.[target];
          const live = snap?.mountedComponents?.find((c) => c.name === target);
          if (!comp && !registered && !live) {
            return rpcError(id, ERR_COMPONENT_NOT_FOUND, `COMPONENT_NOT_FOUND: '${target}' is neither a Vue component nor a registered store`, {
              target,
            });
          }
          const data = {
            target: comp ? comp.name : target,
            componentId: comp ? comp.id : `frontend.component:${target}`,
            name: comp ? comp.name : target,
            filePath: comp?.filePath,
            props: comp?.propsKeys || [],
            propsState: live?.propsKeys || null,
            state: registered?.state || live?.stateKeys?.reduce((acc, key) => ({ ...acc, [key]: '[state]' }), {}) || {},
            actions: comp?.actions || registered?.actions || [],
            observed: Boolean(registered || live),
            evidence: {
              provenance: registered || live ? 'runtime' : 'static',
              sourceAdapter: 'tokensafe-ui-vue-vite',
              confidence: 'confirmed',
            },
          };
          return observeRespond({
            level: 'L2',
            format,
            data,
            tokenEstimate: Math.ceil(JSON.stringify(data).length / 4),
            evidence: data.evidence,
          });
        }

        if (level === 'L3') {
          const comp = findComponent(index, target);
          const relPath = comp ? comp.filePath : fileOfTarget(index, target);
          if (!relPath) {
            return rpcError(id, ERR_INVALID_PARAMS, 'target (component name or filePath) is required for L3 observe');
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
          const data = {
            symbol: comp ? comp.name : path.basename(relPath, path.extname(relPath)),
            path: relPath,
            source,
            version: sha256(source),
            startLine: 1,
            endLine: lineCount(source),
            framework: 'vue',
          };
          return observeRespond({
            level: 'L3',
            format,
            data,
            tokenEstimate: Math.ceil(source.length / 4),
            evidence: { provenance: 'static', sourceAdapter: 'tokensafe-ui-vue-vite', confidence: 'confirmed' },
          });
        }

        const page = pageSlice(traces.slice().reverse(), params?.limit, params?.cursor);
        const data = {
          traces: page.page,
          count: page.page.length,
          total: traces.length,
          // §2.6 (wire 1.6.0): dev-server build/HMR diagnostics ride on L4.
          diagnostics: diagnosticEvents.map((event) => event.diagnostic).slice(-Math.max(1, params?.limit ?? 25)),
          ...(page.hasMore ? { hasMore: true, nextCursor: page.nextCursor } : {}),
        };
        return observeRespond({ level: 'L4', format, data, tokenEstimate: Math.ceil(JSON.stringify(data).length / 4) });
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
        const query = String(params?.query || 'impact');
        const target = String(params?.target || '').trim();
        const index = staticIndex();
        if (query === 'impact') {
          if (!target) {
            return rpcError(id, ERR_INVALID_PARAMS, 'target is required for understand(impact)');
          }
          const comp = findComponent(index, target);
          if (!comp && !fileOfTarget(index, target)) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: no static component or file matches '${target}'`, { target });
          }
          return understandRespond({ query: 'impact', target, impact: impactFor(index, target) });
        }
        if (query === 'causality' || query === 'why_state') {
          const relevant = traces.filter((t) => String(t.target ?? t.path ?? '').includes(target));
          const last = relevant[relevant.length - 1];
          return understandRespond({
            query: 'causality',
            target,
            causality: {
              target,
              observed: Boolean(last),
              traceCount: relevant.length,
              traceChain: relevant.slice(-10),
              rootCause: last ? `last ${last.type || last.method} on ${last.path || last.route}` : null,
              note: last ? undefined : 'No live trace matched the target; run oumv/verify with a browser tab connected.',
              evidence: { provenance: last ? 'runtime' : 'static', sourceAdapter: 'tokensafe-ui-vue-vite', confidence: last ? 'confirmed' : 'unknown' },
            },
          });
        }
        if (query === 'dependencies') {
          const graph = index.components.map((c) => ({ component: c.name, filePath: c.filePath, imports: index.imports.get(c.filePath) || [] }));
          return understandRespond({ query: 'dependencies', target, dependencyGraph: graph });
        }
        return rpcError(id, ERR_UNSUPPORTED, `UNSUPPORTED_CAPABILITY: unknown understand query ${query}`);
      }

      case 'oumv/getSource': {
        const relPath = String(params?.path || '');
        if (!relPath) return rpcError(id, ERR_INVALID_PARAMS, 'path is required');
        let resolved: string;
        try {
          resolved = validateProjectPath(relPath, rootDir);
        } catch (err: any) {
          return rpcError(id, ERR_SECURITY, err.message);
        }
        if (!fs.existsSync(resolved)) {
          return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
        }
        const full = fs.readFileSync(resolved, 'utf-8');
        const version = sha256(full);
        if (params?.ifVersion && String(params.ifVersion) === version) {
          return rpcSuccess(id, { path: relPath, version, unchanged: true });
        }
        const symbol = params?.symbol ? String(params.symbol) : '';
        if (symbol) {
          const range = extractSymbolRange(full, resolved, symbol);
          if (!range) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: symbol ${symbol} not found`, { path: relPath, symbol });
          }
          return rpcSuccess(id, { path: relPath, symbol, source: range.source, version, startLine: range.startLine, endLine: range.endLine });
        }
        const lines = full.split('\n');
        const from = Number(params?.startLine) > 0 ? Math.min(Number(params.startLine), lines.length) : 1;
        const to = Number(params?.endLine) >= from ? Math.min(Number(params.endLine), lines.length) : lines.length;
        return rpcSuccess(id, {
          path: relPath,
          source: lines.slice(from - 1, to).join('\n'),
          version,
          startLine: from,
          endLine: to,
        });
      }

      case 'oumv/previewEdit': {


        // §4.4 (wire 1.6.0): dry-run of applyEdit — same guard order, no bytes written.


        const item = params ?? {};


        const relPath = String(item?.path || item?.filePath || '');


        const mode = String(item?.mode || 'replace').toLowerCase();


        if (!['replace', 'create', 'symbol', 'delete', 'rename', 'patch'].includes(mode)) {

          return rpcError(id, ERR_UNSUPPORTED, `UNSUPPORTED_CAPABILITY: unknown preview mode ${JSON.stringify(mode)}`);

        }


        // A batch preview would have to run the whole guard chain per item; until it
        // does, the adapter refuses it instead of previewing only the first file.
        if (Array.isArray(item?.edits) && item.edits.length > 0) {

          return rpcError(id, ERR_UNSUPPORTED, 'UNSUPPORTED_CAPABILITY: batch preview is not implemented on this adapter', { reason: 'batch_preview_unsupported' });

        }


        const expectedVersion = item?.expectedVersion;


        const replacement = item?.replacement ?? item?.source ?? '';


        if (!relPath) return rpcError(id, ERR_INVALID_PARAMS, 'path is required');


        let resolved: string;


        try {


          resolved = validateProjectPath(relPath, rootDir);


        } catch (err: any) {


          return rpcError(id, ERR_SECURITY, err.message);


        }


        const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();


        if (mode === 'create') {


          if (expectedVersion) {


            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion must be omitted for mode=create', { reason: 'create_forbids_version', path: relPath });


          }


          if (exists) return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: file already exists', { reason: 'file_exists', path: relPath });


        } else {


          if (!exists) return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);


          const currentText = fs.readFileSync(resolved, 'utf-8');


          const currentVersion = 'sha256:' + crypto.createHash('sha256').update(currentText).digest('hex');


          if (!expectedVersion) {


            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required', { reason: 'expected_version_required', path: relPath, current: currentVersion });


          }


          if (expectedVersion !== currentVersion) {


            return rpcError(id, ERR_CONFLICT, `CONFLICT_DETECTED: version mismatch`, { reason: 'version_mismatch', path: relPath });


          }


        }


        const currentText = exists ? fs.readFileSync(resolved, 'utf-8') : '';


        return rpcSuccess(id, {


          status: 'PREVIEW',


          applied: false,


          previews: [{


            path: relPath,


            mode,


            unchanged: currentText === String(replacement),


            ...(exists ? { currentVersion: 'sha256:' + crypto.createHash('sha256').update(currentText).digest('hex') } : {}),


            newVersion: 'sha256:' + crypto.createHash('sha256').update(String(replacement)).digest('hex'),


            wouldApply: true,


          }],


        });


      }



      case 'oumv/index': {
        // §14.1 symbol search over the Vue static index (components + routes).
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
        const index = staticIndex();

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
          for (const component of index.components) {
            if (!inScope(component.filePath)) continue;
            candidates.push({
              resourceId: component.id,
              name: component.name,
              kind: 'component',
              file: component.filePath,
              lines: [component.lineStart, component.lineEnd],
              signature: `${component.name}(${component.propsKeys.join(', ')})`,
            });
          }
        }
        if (wants('route')) {
          for (const route of index.routes) {
            if (!inScope(route.filePath)) continue;
            candidates.push({
              resourceId: `frontend.route:${route.path}`,
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
          const qualifiedTail = (candidate.qualified ?? '').toLowerCase();
          if (qualifiedTail === lowerQuery || qualifiedTail.endsWith(`.${lowerQuery}`)) return 2;
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


        // §3 best-effort: single-dispatch runtime — nothing is observably in-flight.


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
        if (options.sessionToken && params?.disableMutations) {
          return rpcError(id, ERR_PERMISSION_DENIED, 'PERMISSION_DENIED: mutations are disabled');
        }
        // §4.3 batch (wire 1.4.0 `mutate.multiFile`): all-or-nothing over 1..16
        // replace/create/patch items, every one validated before the first write.
        if (Array.isArray(params?.edits) && params.edits.length > 0) {
          const batch = applyEditBatch({
            rootDir,
            edits: params.edits,
            resolvePath: (rel) => validateProjectPath(rel, rootDir),
            syntaxCheck: (text, _relPath, absolute) => validateVueSource(absolute, text),
          });
          if (!batch.ok) return rpcError(id, batch.code, batch.message, batch.data);
          return editRespond(batch.result);
        }

        const relPath = String(params?.path || '');
        if (!relPath) return rpcError(id, ERR_INVALID_PARAMS, 'path is required');
        const mode = String(params?.mode || 'replace');

        // Guard order (§4.6): jail → exists → syntax → version-rules → OCC.
        let resolved: string;
        try {
          resolved = validateProjectPath(relPath, rootDir);
        } catch (err: any) {
          return rpcError(id, ERR_SECURITY, err.message);
        }
        const exists = fs.existsSync(resolved);

        if (mode === 'create') {
          if (exists) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: file already exists; use mode=replace with its version', {
              path: relPath,
            });
          }
          if (params?.expectedVersion) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion must be omitted for mode=create', {
              reason: 'version_forbidden',
            });
          }
          const content = String(params?.replacement ?? '');
          if (!content) return rpcError(id, ERR_INVALID_PARAMS, 'replacement is required for mode=create');
          try {
            validateVueSource(resolved, content);
          } catch (err: any) {
            return rpcError(id, ERR_SYNTAX, err.message);
          }
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          const tmp = resolved + '.oumv.tmp';
          fs.writeFileSync(tmp, content, 'utf-8');
          fs.renameSync(tmp, resolved);
          return editRespond({
            status: 'APPLIED',
            path: relPath,
            newVersion: sha256(content),
            created: true,
            syntaxCheck: 'passed',
          });
        }

        if (!exists) {
          return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`, { path: relPath });
        }

        const original = fs.readFileSync(resolved, 'utf-8');
        const currentVersion = sha256(original);

        if (mode === 'delete') {
          if (params?.replacement !== undefined && params?.replacement !== '') {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: replacement must be omitted for mode=delete', {
              reason: 'replacement_forbidden',
            });
          }
          if (!params?.expectedVersion) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to delete a file', {
              reason: 'version_required',
            });
          }
          if (String(params.expectedVersion) !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on delete', {
              expectedVersion: params.expectedVersion,
              actualVersion: currentVersion,
            });
          }
          fs.rmSync(resolved, { force: true });
          return editRespond({ status: 'APPLIED', path: relPath, deleted: true, newVersion: null });
        }

        if (mode === 'rename') {
          const renameTo = String(params?.renameTo || '');
          if (!renameTo) return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: renameTo is required for mode=rename', {
            reason: 'rename_to_required',
          });
          if (params?.replacement !== undefined && params?.replacement !== '') {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: replacement must be omitted for mode=rename', {
              reason: 'replacement_forbidden',
            });
          }
          let targetPath: string;
          try {
            targetPath = validateProjectPath(renameTo, rootDir);
          } catch (err: any) {
            return rpcError(id, ERR_SECURITY, err.message);
          }
          if (fs.existsSync(targetPath)) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: rename target already exists', { path: renameTo });
          }
          if (!params?.expectedVersion) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to rename a file', {
              reason: 'version_required',
            });
          }
          if (String(params.expectedVersion) !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on rename', {
              expectedVersion: params.expectedVersion,
              actualVersion: currentVersion,
            });
          }
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.renameSync(resolved, targetPath);
          return editRespond({ status: 'APPLIED', path: relPath, newPath: String(renameTo), newVersion: currentVersion });
        }

        let nextSource: string;
        let hunksApplied: number | undefined;
        if (mode === 'patch' || mode === 'hunks') {
          const hunks = Array.isArray(params?.hunks) ? (params.hunks as Hunk[]) : [];
          if (hunks.length === 0) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: hunks is required for mode=patch', { reason: 'hunks_required' });
          }
          if (!params?.expectedVersion) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to edit an existing file', {
              reason: 'version_required',
            });
          }
          if (String(params.expectedVersion) !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on patch', {
              expectedVersion: params.expectedVersion,
              actualVersion: currentVersion,
            });
          }
          try {
            const applied = applyHunksToSource(original, hunks);
            nextSource = applied.source;
            hunksApplied = applied.hunksApplied;
          } catch (err: any) {
            return rpcError(id, err.rpcCode ?? ERR_INTERNAL, err.message, err.rpcData);
          }
        } else if (mode === 'symbol') {
          const symbol = String(params?.symbol || '');
          if (!symbol) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: symbol is required for mode=symbol', { reason: 'symbol_required' });
          }
          const replacement = String(params?.replacement ?? '');
          if (!replacement) return rpcError(id, ERR_INVALID_PARAMS, 'replacement is required for mode=symbol');
          if (!params?.expectedVersion) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to edit a symbol', {
              reason: 'version_required',
            });
          }
          if (String(params.expectedVersion) !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch on symbol edit', {
              expectedVersion: params.expectedVersion,
              actualVersion: currentVersion,
            });
          }
          const range = extractSymbolRange(original, resolved, symbol);
          if (!range) {
            return rpcError(id, ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: symbol ${JSON.stringify(symbol)} not found`);
          }
          const lines = original.split('\n');
          const head = lines.slice(0, range.startLine - 1).join('\n');
          const tail = lines.slice(range.endLine).join('\n');
          // Preserve the original byte layout: no extra EOF newline, no lost separator.
          nextSource =
            (head ? head + '\n' : '') +
            replacement.replace(/\n$/, '') +
            (tail ? '\n' + tail : '');
        } else if (mode === 'replace' || mode === '') {
          if (!params?.expectedVersion) {
            return rpcError(id, ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to edit an existing file', {
              reason: 'version_required',
            });
          }
          if (String(params.expectedVersion) !== currentVersion) {
            return rpcError(id, ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch', {
              expectedVersion: params.expectedVersion,
              actualVersion: currentVersion,
            });
          }
          if (params?.replacement === undefined) {
            return rpcError(id, ERR_INVALID_PARAMS, 'replacement is required for mode=replace');
          }
          nextSource = String(params.replacement);
        } else {
          return rpcError(id, ERR_UNSUPPORTED, `UNSUPPORTED_CAPABILITY: unknown applyEdit mode ${mode}`);
        }

        try {
          validateVueSource(resolved, nextSource);
        } catch (err: any) {
          return rpcError(id, ERR_SYNTAX, err.message);
        }

        try {
          const res = await (await loadMcpTools()).atomicApplySourceEdit(resolved, nextSource, {
            expectedVersion: currentVersion,
            validateTypeScript: false,
          });
          return editRespond({
            status: 'APPLIED',
            path: relPath,
            ...(params?.symbol ? { symbol: String(params.symbol) } : {}),
            newVersion: res.version,
            syntaxCheck: 'passed',
            ...(hunksApplied !== undefined ? { hunksApplied } : {}),
            ...(res.backupPath ? { backupPath: res.backupPath } : {}),
          });
        } catch (err: any) {
          const message = String(err?.message || err);
          if (/version/i.test(message) && /mismatch/i.test(message)) {
            return rpcError(id, ERR_CONFLICT, `CONFLICT_DETECTED: ${message}`);
          }
          if (/SYNTAX/i.test(message)) return rpcError(id, ERR_SYNTAX, `SYNTAX_ERROR: ${message}`);
          if (/SECURITY|traversal/i.test(message)) return rpcError(id, ERR_SECURITY, message);
          return rpcError(id, ERR_INTERNAL, message);
        }
      }

      case 'oumv/verify': {
        const stepsRaw = Array.isArray(params?.steps) ? params.steps : [];
        const singleTarget = String(params?.target || '');
        const singleAction = String(params?.action || 'click');
        if (stepsRaw.length === 0 && !singleTarget) {
          return rpcError(id, ERR_INVALID_PARAMS, 'target is required for oumv/verify');
        }
        if (stepsRaw.length > 0 && stepsRaw.some((s: any) => !s?.target)) {
          return rpcError(id, ERR_INVALID_PARAMS, 'every verify step needs a target');
        }
        const t0 = Date.now();
        const execute = async (target: string, action: string, payload?: unknown) => {
          const result = await requestBrowserVerify(target, action, payload);
          if (result?.status === 'failed') {
            return {
              status: 'failed' as const,
              target,
              action,
              durationMs: Number(result.durationMs ?? 0),
              statusCode: result.statusCode ?? 0,
              responseBody: result.error,
            };
          }
          return {
            status: 'passed' as const,
            target,
            action,
            diff: result?.diff ?? {},
            surfaceDiff: result?.surfaceDiff ?? [],
            durationMs: Number(result?.durationMs ?? 0),
            timings: result?.latency ?? {},
          };
        };

        if (stepsRaw.length > 0) {
          const steps: any[] = [];
          for (const step of stepsRaw) {
            steps.push(await execute(String(step.target), String(step.action || 'click'), step.payload));
          }
          const total = Date.now() - t0;
          return rpcSuccess(id, {
            status: steps.every((s) => s.status === 'passed') ? 'passed' : 'failed',
            target: singleTarget || steps[0].target,
            steps,
            timings: { t_total_ms: total },
            durationMs: total,
            scope: {
              checked: steps.map((s) => `${s.target}:${s.action}`),
              notExecuted: ['native browser events outside the bridge', 'server-side effects'],
              notSupported: [],
            },
          });
        }

        const one = await execute(singleTarget, singleAction, params?.payload);
        if (one.status === 'failed' && !isBrowserConnected()) {
          return rpcError(id, ERR_RUNTIME_UNAVAILABLE, 'RUNTIME_UNAVAILABLE: no live browser tab is connected', {
            target: singleTarget,
            action: singleAction,
          });
        }
        const total = Date.now() - t0;
        return rpcSuccess(id, {
          ...one,
          timings: { ...(one.timings || {}), t_total_ms: total },
          durationMs: total,
          scope: {
            checked: [`${singleTarget}:${singleAction}`],
            notExecuted: ['native browser events outside the bridge', 'server-side effects'],
            notSupported: [],
          },
        });
      }

      default:
        return rpcError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  const dispatchWithState = async (payload: any): Promise<{ statusCode: number; body: any }> => {
    const out = await dispatchOne(payload);
    const result = out.body?.result;
    if (payload?.method === 'oumv/applyEdit' && result?.status === 'APPLIED') {
      // The handler only returns APPLIED after the bytes are on disk.
      recordState(
        String(result.path ?? payload.params?.path ?? ''),
        String(result.newVersion ?? ''),
        String(payload.params?.mode ?? 'replace').toLowerCase()
      );
    }
    return out;
  };

  const handleRpcPayload = async (payload: any): Promise<{ statusCode: number; body: any }> => {
    if (Array.isArray(payload)) {
      const results: any[] = [];
      for (const item of payload) {
        const out = await dispatchWithState(item);
        results.push(out.body);
      }
      return { statusCode: 200, body: results };
    }
    return dispatchWithState(payload);
  };

  return {
    vueVersion,
    staticIndex,
    getTracesSince: (seq: number) => traces.filter((trace) => trace.seq > seq),
    getEventsSince,
    handleRpcPayload,
    isBrowserConnected,
    // §2.6: the plugin forwards build/HMR failures the dev server already observes.
    recordDiagnostic,
  };
}
