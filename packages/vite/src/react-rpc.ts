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
import { getGlobalContractsPath } from './runtime-store.js';

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

function extractSymbolRange(source: string, symbolName: string): { source: string; startLine: number; endLine: number } | null {
  try {
    const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    const lines = source.split('\n');
    for (const node of ast.program.body) {
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

export function createReactOumvController(options: ReactRpcOptions) {
  const { rootDir, server } = options;
  const reactVersion = readReactVersion(rootDir);
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
  const SESSION_TTL_SECONDS = 3600;

  /** Canonical envelope for every method: extras belong inside `data`, never beside it. */
  const normalizeResult = (method: string, out: { statusCode: number; body: any }) => {
    const result = out?.body?.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return out;
    if (method === 'oumv/observe') {
      const { level, format, data, payload, tokenEstimate, evidence, ...rest } = result as Record<string, any>;
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
            data: { ...(data && typeof data === 'object' ? data : {}), ...rest },
            ...(payload !== undefined ? { payload } : {}),
            ...(tokenEstimate !== undefined ? { tokenEstimate } : {}),
            ...(evidence ? { evidence } : {}),
          },
        },
      };
    }
    if (method === 'oumv/understand') {
      const { query, target, impact, causality, ...rest } = result as Record<string, any>;
      const narrowed: Record<string, any> = { query, target };
      if (impact) narrowed.impact = { ...impact, ...rest };
      else if (causality) narrowed.causality = { ...causality, ...rest };
      else narrowed.impact = { ...rest };
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
        const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;
        sessions.set(sessionId, Date.now() + SESSION_TTL_SECONDS * 1000);
        const capabilities = {
          observe: { levels: ['L0', 'L1', 'L2', 'L3', 'L4'], formats: ['yaml', 'json'] },
          understand: { causality: true, signalsGraph: false, impactAnalysis: true },
          mutate: { occ: true, syntaxGuard: true, ephemeralDispatch: true },
          verify: { multiMetric: true, surfaceDiff: true },
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
          protocolVersion: '1.1.0',
          profile: 'frontend',
          sessionId,
          ttlSeconds: SESSION_TTL_SECONDS,
          runtimeInfo: {
            name: 'react',
            version: reactVersion,
            framework: 'React + Vite',
          },
          capabilities,
        });
      }

      case 'oumv/observe': {
        const level = String(params?.level || 'L0').toUpperCase();
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

          return rpcSuccess(id, {
            ...pulse,
            format,
            payload: payloadStr,
            tokenEstimate: Math.ceil(payloadStr.length / 4),
            timestamp: now,
            data: pulse,
          });
        }

        if (level === 'L1') {
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
              return rpcSuccess(id, {
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
                },
                evidence: {
                  provenance: 'runtime',
                  sourceAdapter: 'tokensafe-ui-react-vite',
                  confidence: 'confirmed',
                },
              });
            }

            const jsonPayload = JSON.stringify(collection);
            return rpcSuccess(id, {
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
            return rpcSuccess(id, {
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
              components: staticComponents.slice(0, 15).map((c) => ({ id: c.id, name: c.name })),
              data: {
                total: collection.total,
                provenanceSummary: collection.provenanceSummary,
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
          return rpcSuccess(id, {
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
            },
            components: staticComponents,
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

          return rpcSuccess(id, {
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
              const maybe = (await loadMcpTools()).validateWorkspacePath(candidate, rootDir);
              if (fs.existsSync(maybe) && fs.statSync(maybe).isFile()) {
                relPath = candidate;
                cleanName = cname;
                break;
              }
            } catch {}
          }

          let resolved: string;
          try {
            resolved = (await loadMcpTools()).validateWorkspacePath(relPath, rootDir);
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

          return rpcSuccess(id, {
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
          evidence: {
            provenance: 'runtime' as const,
            sourceAdapter: 'tokensafe-ui-react-vite',
            confidence: (isBrowserConnected() ? 'confirmed' : 'unknown') as OumvEvidenceConfidence,
          },
        };
        const l4Payload = JSON.stringify(l4Data.traces);

        return rpcSuccess(id, {
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
          return rpcSuccess(id, {
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
          return rpcSuccess(id, {
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
          return rpcSuccess(id, {
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
        return rpcSuccess(id, {
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
          resolved = (await loadMcpTools()).validateWorkspacePath(relPath, rootDir);
        } catch (err: any) {
          return rpcError(id, ERR_SECURITY, err.message);
        }
        if (!fs.existsSync(resolved)) {
          return rpcError(id, ERR_RESOURCE_NOT_FOUND, `File not found: ${relPath}`);
        }
        const fullSource = fs.readFileSync(resolved, 'utf-8');
        const version = 'sha256:' + crypto.createHash('sha256').update(fullSource).digest('hex');

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
        }

        return rpcSuccess(id, {
          symbol: symbol || undefined,
          path: path.relative(rootDir, resolved),
          filePath: path.relative(rootDir, resolved),
          version,
          source: fullSource,
          startLine: 1,
          endLine: fullSource.split('\n').length,
        });
      }

      case 'oumv/applyEdit':
      case 'oumv/mutate': {
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

        if (!relPath || typeof newSource !== 'string') {
          return rpcError(id, ERR_INVALID_PARAMS, 'path and replacement/source string are required');
        }

        let resolved: string;
        try {
          resolved = (await loadMcpTools()).validateWorkspacePath(relPath, rootDir);
        } catch (err: any) {
          return rpcError(id, ERR_SECURITY, err.message);
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

          return rpcSuccess(id, {
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
        if (!target) {
          return rpcError(id, ERR_INVALID_PARAMS, 'target is required for oumv/verify');
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

    return handleSingleRpc(payload);
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
    reactVersion,
  };
}
