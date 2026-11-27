import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as parser from '@babel/parser';
import { validateWorkspacePath, atomicApplySourceEdit } from '@tokensafe-ui/mcp';

export interface VueComponentDefinition {
  id: string;
  name?: string;
  filePath?: string;
  props?: Record<string, any>;
  getState?: () => Record<string, any>;
  actions?: Record<string, (payload?: any) => any | Promise<any>>;
  dependencies?: string[];
  dependents?: string[];
}

export interface VueAdapterConfig {
  projectRoot?: string;
  rootElement?: HTMLElement;
  components?: Record<string, VueComponentDefinition>;
}

export interface VueTraceEvent {
  timestamp: number;
  type: string;
  componentId: string;
  details: string;
  diff?: Record<string, any>;
}

export class VueProtocolError extends Error {
  code: number;
  data?: Record<string, unknown>;
  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const ERR_CONFLICT = -32001;
const ERR_SYNTAX = -32002;
const ERR_SECURITY = -32003;
const ERR_COMPONENT_NOT_FOUND = -32004;
const ERR_ACTION_NOT_FOUND = -32005;
const ERR_UNSUPPORTED = -32006;
const ERR_RESOURCE_NOT_FOUND = -32009;
const ERR_VALIDATION_FAILED = -32011;
const ERR_INVALID_PARAMS = -32602;

const PROTOCOL_VERSION = '1.3.0';

function sha256(content: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function validateVueSFC(source: string): void {
  const hasTemplate = /<template[\s>]/i.test(source);
  const hasScript = /<script[\s>]/i.test(source);
  if (!hasTemplate && !hasScript) {
    throw new VueProtocolError(ERR_SYNTAX, '[OUMV SYNTAX_ERROR] Invalid Vue SFC: missing <template> or <script> block');
  }
  const scriptMatch = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch && scriptMatch[1].trim()) {
    try {
      parser.parse(scriptMatch[1], { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch (err: any) {
      throw new VueProtocolError(ERR_SYNTAX, `[OUMV SYNTAX_ERROR] Invalid script in Vue SFC: ${err.message}`);
    }
  }
}

function scriptSymbolRange(source: string, symbol: string): { startLine: number; endLine: number } | null {
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(source);
  if (!match || match.index === undefined) return null;
  const before = source.slice(0, match.index + match[0].indexOf('>') + 1);
  const offset = before.split('\n').length - 1;
  let ast: { program: { body: any[] } };
  try {
    ast = parser.parse(match[1], { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch {
    return null;
  }
  const hit = (ast.program.body as any[]).find((node) => {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return node.id?.name === symbol;
    if (node.type === 'VariableDeclaration') {
      return node.declarations.some((d: any) => d.id?.type === 'Identifier' && d.id.name === symbol);
    }
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') return decl.id?.name === symbol;
      if (decl.type === 'VariableDeclaration') {
        return decl.declarations.some((d: any) => d.id?.type === 'Identifier' && d.id.name === symbol);
      }
    }
    return false;
  });
  if (!hit || !hit.loc) return null;
  return { startLine: hit.loc.start.line + offset, endLine: hit.loc.end.line + offset };
}

function applyHunks(
  source: string,
  hunks: Array<{ target: string; replacement: string; startLine?: number; endLine?: number; replaceAll?: boolean }>
): string {
  let current = source;
  hunks.forEach((hunk, index) => {
    const target = String(hunk.target ?? '');
    if (!target) {
      throw new VueProtocolError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: hunk ${index} has an empty target`, { hunk: index });
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
      throw new VueProtocolError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: hunk ${index} target does not occur in the file`, {
        hunk: index,
        reason: 'target_not_found',
      });
    }
    if (positions.length > 1 && !hunk.replaceAll) {
      const lineNumbers = positions.map((pos) => from + (windowText.slice(0, pos).match(/\n/g) || []).length);
      throw new VueProtocolError(ERR_VALIDATION_FAILED, `VALIDATION_FAILED: hunk ${index} target occurs ${positions.length} times`, {
        hunk: index,
        reason: 'target_not_unique',
        count: positions.length,
        lines: lineNumbers,
        suggestedHunks: lineNumbers.map((line) => ({
          target,
          replacement: hunk.replacement,
          startLine: Math.max(1, line - 3),
          endLine: Math.max(1, line + target.split('\n').length + 2),
        })),
      });
    }
    const replaced = hunk.replaceAll
      ? windowText.split(target).join(hunk.replacement)
      : windowText.slice(0, positions[0]) + hunk.replacement + windowText.slice(positions[0] + target.length);
    current = [...lines.slice(0, from - 1), ...replaced.split('\n'), ...lines.slice(to)].join('\n');
  });
  return current;
}

/**
 * In-memory OUMV adapter for Vue 3 (wire 1.3.0).
 *
 * This is the embeddable shape: an app hands over its component registry and,
 * when one exists, its live root element. The Vite plugin's JSON-RPC surface is
 * `createVueOumvController` in `@tokensafe-ui/vite`; both answer the same wire.
 */
export function createVueAdapter(config: VueAdapterConfig = {}) {
  const projectRoot = config.projectRoot || process.cwd();
  const componentRegistry = new Map<string, VueComponentDefinition>();
  const traceEvents: VueTraceEvent[] = [];

  if (config.components) {
    for (const [id, comp] of Object.entries(config.components)) {
      componentRegistry.set(id, comp);
    }
  }

  const getRoot = (): HTMLElement | null => {
    if (config.rootElement) return config.rootElement;
    if (typeof document !== 'undefined') {
      return document.getElementById('app') || document.body;
    }
    return null;
  };

  const registerComponent = (comp: VueComponentDefinition) => {
    componentRegistry.set(comp.id, comp);
  };

  return {
    name: 'vue',
    version: '3.x',
    registerComponent,

    async handshake(params: { protocolVersion?: string; requestedCapabilities?: any } = {}) {
      const requested = String(params?.protocolVersion ?? '').trim();
      if (requested) {
        const [majorRaw, minorRaw] = requested.split('.');
        if (
          !Number.isInteger(Number(majorRaw)) ||
          !Number.isInteger(Number(minorRaw)) ||
          Number(majorRaw) !== 1 ||
          Number(minorRaw) > 3
        ) {
          throw new VueProtocolError(
            ERR_UNSUPPORTED,
            `UNSUPPORTED_CAPABILITY: protocol version ${requested} (this runtime serves ${PROTOCOL_VERSION})`
          );
        }
      }
      const capabilities: any = {
        observe: { levels: ['L0', 'L1', 'L2', 'L3', 'L4'], formats: ['yaml', 'json'] },
        understand: { causality: true, signalsGraph: false, componentGraph: true, impactAnalysis: true },
        mutate: { occ: true, syntaxGuard: true, ephemeralDispatch: true },
        verify: { multiMetric: true, surfaceDiff: true },
      };
      const wanted = params?.requestedCapabilities;
      if (wanted && typeof wanted === 'object') {
        if (Array.isArray(wanted.observe?.levels) && wanted.observe.levels.length > 0) {
          capabilities.observe.levels = capabilities.observe.levels.filter((l: string) => wanted.observe.levels.includes(l));
        }
        if (Array.isArray(wanted.observe?.formats) && wanted.observe.formats.length > 0) {
          capabilities.observe.formats = capabilities.observe.formats.filter((f: string) => wanted.observe.formats.includes(f));
        }
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        profile: 'frontend' as const,
        sessionId: `sess-${crypto.randomBytes(8).toString('hex')}`,
        ttlSeconds: 3600,
        runtimeInfo: { name: 'vue', version: '3.x', framework: 'Vue 3' },
        capabilities,
      };
    },

    async observe(params: {
      level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
      format?: 'yaml' | 'json';
      componentId?: string;
      target?: string;
    }) {
      const format = params.format || 'json';
      const root = getRoot();
      const mounted = Array.from(componentRegistry.keys());
      const targetId = params.componentId || params.target || '';

      if (params.level === 'L0') {
        const route = typeof window !== 'undefined' && window.location ? window.location.pathname || '/' : '/';
        const data = {
          status: 'ok',
          framework: 'vue',
          route,
          mounted,
          elements: root ? root.querySelectorAll('*').length : 0,
          errors: traceEvents.filter((t) => t.type === 'error').length,
          traces: traceEvents.length,
        };
        return { level: 'L0' as const, format, data, tokenEstimate: Math.ceil(JSON.stringify(data).length / 4) };
      }

      if (params.level === 'L1') {
        const elements: Array<Record<string, unknown>> = [];
        if (root) {
          const nodes = root.querySelectorAll(
            'button, input, select, textarea, a[href], [role="button"], [data-agent-id], [data-testid]'
          );
          nodes.forEach((node, index) => {
            const el = node as HTMLElement;
            let value: unknown;
            if (el instanceof HTMLInputElement) value = el.type === 'checkbox' ? el.checked : el.value;
            else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) value = el.value;
            elements.push({
              id:
                el.getAttribute('data-agent-id') ||
                el.getAttribute('data-testid') ||
                el.id ||
                `${el.tagName.toLowerCase()}_${index}`,
              role: el.getAttribute('role') || el.tagName.toLowerCase(),
              value,
              disabled: (el as any).disabled || undefined,
            });
          });
        }
        const data = { view: targetId || 'vue-root', framework: 'vue', mounted, elements, items: elements, total: elements.length };
        return { level: 'L1' as const, format, data, tokenEstimate: Math.ceil(JSON.stringify(data).length / 4) };
      }

      if (params.level === 'L2') {
        const compId = targetId || mounted[0] || '';
        if (!compId) throw new VueProtocolError(ERR_INVALID_PARAMS, 'target (componentId) is required for L2 observe');
        const comp = componentRegistry.get(compId);
        if (!comp) {
          throw new VueProtocolError(ERR_COMPONENT_NOT_FOUND, `COMPONENT_NOT_FOUND: '${compId}' is not registered`, { target: compId });
        }
        const data = {
          target: comp.name || compId,
          componentId: compId,
          name: comp.name || compId,
          filePath: comp.filePath,
          state: comp.getState ? comp.getState() : {},
          props: comp.props || {},
          actions: comp.actions ? Object.keys(comp.actions) : [],
          evidence: { provenance: 'runtime' as const, sourceAdapter: 'tokensafe-ui-vue', confidence: 'confirmed' as const },
        };
        return {
          level: 'L2' as const,
          format,
          data,
          tokenEstimate: Math.ceil(JSON.stringify(data).length / 4),
          evidence: data.evidence,
        };
      }

      if (params.level === 'L3') {
        const compId = targetId || mounted[0] || '';
        const comp = componentRegistry.get(compId);
        if (!comp) {
          throw new VueProtocolError(ERR_COMPONENT_NOT_FOUND, `COMPONENT_NOT_FOUND: '${compId}' is not registered`, { target: compId });
        }
        const relPath = comp.filePath || `${compId}.vue`;
        const resolved = validateWorkspacePath(relPath, projectRoot);
        if (!fs.existsSync(resolved)) {
          throw new VueProtocolError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: ${relPath} not found`, { path: relPath });
        }
        const source = fs.readFileSync(resolved, 'utf-8');
        const data = {
          symbol: comp.name || compId,
          path: relPath,
          source,
          version: sha256(source),
          startLine: 1,
          endLine: source.split('\n').length,
        };
        return {
          level: 'L3' as const,
          format,
          data,
          tokenEstimate: Math.ceil(source.length / 4),
          evidence: { provenance: 'static' as const, sourceAdapter: 'tokensafe-ui-vue', confidence: 'confirmed' as const },
        };
      }

      const relevant = targetId ? traceEvents.filter((e) => e.componentId === targetId) : traceEvents;
      const data = { traces: relevant.slice(-20), count: relevant.length, total: traceEvents.length };
      return { level: 'L4' as const, format, data, tokenEstimate: Math.ceil(JSON.stringify(data).length / 4) };
    },

    async understand(params: { query: 'impact' | 'dependencies' | 'causality' | 'why_state'; target?: string }) {
      const targetId = params.target || '';
      if (!targetId && params.query !== 'dependencies') {
        throw new VueProtocolError(ERR_INVALID_PARAMS, 'target is required');
      }

      if (params.query === 'impact') {
        const comp = componentRegistry.get(targetId);
        if (!comp) {
          throw new VueProtocolError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: '${targetId}' is not registered`, { target: targetId });
        }
        const directlyAffected = comp.dependents || [];
        const indirectlyAffected: string[] = [];
        for (const depId of directlyAffected) {
          for (const d of componentRegistry.get(depId)?.dependents || []) {
            if (!directlyAffected.includes(d) && !indirectlyAffected.includes(d)) indirectlyAffected.push(d);
          }
        }
        return {
          query: 'impact',
          target: targetId,
          impact: {
            target: targetId,
            affectedSymbols: directlyAffected.map((id) => ({ symbol: id, reason: 'dependent' })),
            directlyAffected,
            indirectlyAffected,
            breakingRisk: directlyAffected.length === 0 ? 'low' : directlyAffected.length <= 3 ? 'medium' : 'high',
            summary:
              directlyAffected.length > 0
                ? `Modify with care: affects ${directlyAffected.join(', ')}`
                : 'Safe: isolated component with 0 dependents',
            observed: true,
            evidence: { provenance: 'contract', sourceAdapter: 'tokensafe-ui-vue', confidence: 'confirmed' },
          },
        };
      }

      if (params.query === 'causality' || params.query === 'why_state') {
        const comp = componentRegistry.get(targetId);
        const lastTrace = [...traceEvents].reverse().find((e) => e.componentId === targetId);
        return {
          query: 'causality',
          target: targetId,
          causality: {
            target: targetId,
            observed: Boolean(lastTrace),
            state: comp?.getState ? comp.getState() : {},
            lastTrace,
            rootCause: lastTrace ? `state changed by action '${lastTrace.type}'` : null,
            note: lastTrace ? undefined : 'No trace recorded for this component yet.',
            evidence: {
              provenance: lastTrace ? 'runtime' : 'contract',
              sourceAdapter: 'tokensafe-ui-vue',
              confidence: lastTrace ? 'confirmed' : 'unknown',
            },
          },
        };
      }

      const graph = Array.from(componentRegistry.entries()).map(([id, comp]) => ({
        component: id,
        dependencies: comp.dependencies || [],
        dependents: comp.dependents || [],
        stateKeys: comp.getState ? Object.keys(comp.getState()) : [],
      }));
      return { query: 'dependencies', target: targetId, dependencyGraph: graph };
    },

    async getSource(params: {
      path?: string;
      filePath?: string;
      symbol?: string;
      startLine?: number;
      endLine?: number;
      ifVersion?: string;
    }) {
      const inputPath = params.path || params.filePath || '';
      if (!inputPath) throw new VueProtocolError(ERR_INVALID_PARAMS, 'path is required');
      const resolved = validateWorkspacePath(inputPath, projectRoot);
      if (!fs.existsSync(resolved)) {
        throw new VueProtocolError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: ${inputPath} not found`, { path: inputPath });
      }
      const full = fs.readFileSync(resolved, 'utf-8');
      const version = sha256(full);
      if (params.ifVersion && String(params.ifVersion) === version) {
        return { path: inputPath, version, unchanged: true };
      }
      if (params.symbol) {
        const lines = full.split('\n');
        const range = scriptSymbolRange(full, params.symbol);
        if (!range) {
          if (params.symbol === path.basename(inputPath, path.extname(inputPath))) {
            return { path: inputPath, symbol: params.symbol, source: full, version, startLine: 1, endLine: lines.length };
          }
          throw new VueProtocolError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: symbol ${params.symbol} not found`, {
            path: inputPath,
            symbol: params.symbol,
          });
        }
        return {
          path: inputPath,
          symbol: params.symbol,
          source: lines.slice(range.startLine - 1, range.endLine).join('\n'),
          version,
          startLine: range.startLine,
          endLine: range.endLine,
        };
      }
      const lines = full.split('\n');
      const from = params.startLine && params.startLine > 0 ? Math.min(params.startLine, lines.length) : 1;
      const to = params.endLine && params.endLine >= from ? Math.min(params.endLine, lines.length) : lines.length;
      return { path: inputPath, source: lines.slice(from - 1, to).join('\n'), version, startLine: from, endLine: to };
    },

    async applyEdit(params: {
      path?: string;
      filePath?: string;
      source?: string;
      replacement?: string;
      symbol?: string;
      expectedVersion?: string;
      mode?: 'replace' | 'create' | 'delete' | 'rename' | 'symbol' | 'patch';
      renameTo?: string;
      hunks?: Array<{ target: string; replacement: string; startLine?: number; endLine?: number; replaceAll?: boolean }>;
    }) {
      const inputPath = params.path || params.filePath || '';
      if (!inputPath) throw new VueProtocolError(ERR_INVALID_PARAMS, 'path is required');
      const mode = params.mode || 'replace';

      let resolved: string;
      try {
        resolved = validateWorkspacePath(inputPath, projectRoot);
      } catch (err: any) {
        throw new VueProtocolError(ERR_SECURITY, err.message);
      }
      const exists = fs.existsSync(resolved);

      if (mode === 'create') {
        if (exists) {
          throw new VueProtocolError(ERR_CONFLICT, 'CONFLICT_DETECTED: file already exists; use mode=replace with its version');
        }
        if (params.expectedVersion) {
          throw new VueProtocolError(ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion must be omitted for mode=create', {
            reason: 'version_forbidden',
          });
        }
        const content = String(params.replacement ?? params.source ?? '');
        if (!content) throw new VueProtocolError(ERR_INVALID_PARAMS, 'replacement is required for mode=create');
        validateVueSFC(content);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        const tmp = resolved + '.oumv.tmp';
        fs.writeFileSync(tmp, content, 'utf-8');
        fs.renameSync(tmp, resolved);
        return {
          status: 'APPLIED' as const,
          path: inputPath,
          newVersion: sha256(content),
          created: true,
          syntaxCheck: 'passed' as const,
        };
      }

      if (!exists) throw new VueProtocolError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: ${inputPath} not found`, { path: inputPath });
      const original = fs.readFileSync(resolved, 'utf-8');
      const currentVersion = sha256(original);
      const requireVersion = () => {
        if (!params.expectedVersion) {
          throw new VueProtocolError(ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: expectedVersion is required to edit an existing file', {
            reason: 'version_required',
          });
        }
        if (String(params.expectedVersion) !== currentVersion) {
          throw new VueProtocolError(ERR_CONFLICT, 'CONFLICT_DETECTED: version mismatch', {
            expectedVersion: params.expectedVersion,
            actualVersion: currentVersion,
          });
        }
      };

      if (mode === 'delete') {
        if (params.replacement !== undefined && params.replacement !== '') {
          throw new VueProtocolError(ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: replacement must be omitted for mode=delete', {
            reason: 'replacement_forbidden',
          });
        }
        requireVersion();
        fs.rmSync(resolved, { force: true });
        return { status: 'APPLIED' as const, path: inputPath, deleted: true, newVersion: null };
      }

      if (mode === 'rename') {
        if (!params.renameTo) {
          throw new VueProtocolError(ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: renameTo is required for mode=rename', {
            reason: 'rename_to_required',
          });
        }
        if (params.replacement !== undefined && params.replacement !== '') {
          throw new VueProtocolError(ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: replacement must be omitted for mode=rename', {
            reason: 'replacement_forbidden',
          });
        }
        const targetPath = validateWorkspacePath(params.renameTo, projectRoot);
        if (fs.existsSync(targetPath)) {
          throw new VueProtocolError(ERR_CONFLICT, 'CONFLICT_DETECTED: rename target already exists');
        }
        requireVersion();
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.renameSync(resolved, targetPath);
        return { status: 'APPLIED' as const, path: inputPath, newPath: params.renameTo, newVersion: currentVersion };
      }

      let nextSource: string;
      let hunksApplied: number | undefined;
      if (mode === 'patch') {
        if (!Array.isArray(params.hunks) || params.hunks.length === 0) {
          throw new VueProtocolError(ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: hunks is required for mode=patch', {
            reason: 'hunks_required',
          });
        }
        requireVersion();
        nextSource = applyHunks(original, params.hunks);
        hunksApplied = params.hunks.length;
      } else if (mode === 'symbol') {
        if (!params.symbol) {
          throw new VueProtocolError(ERR_VALIDATION_FAILED, 'VALIDATION_FAILED: symbol is required for mode=symbol', {
            reason: 'symbol_required',
          });
        }
        const replacement = String(params.replacement ?? '');
        if (!replacement) throw new VueProtocolError(ERR_INVALID_PARAMS, 'replacement is required for mode=symbol');
        requireVersion();
        const lines = original.split('\n');
        const range = scriptSymbolRange(original, params.symbol);
        if (!range) {
          throw new VueProtocolError(ERR_RESOURCE_NOT_FOUND, `RESOURCE_NOT_FOUND: symbol ${params.symbol} not found`);
        }
        nextSource =
          lines.slice(0, range.startLine - 1).join('\n') +
          (range.startLine > 1 ? '\n' : '') +
          replacement.replace(/\n$/, '') +
          '\n' +
          lines.slice(range.endLine).join('\n');
      } else if (mode === 'replace') {
        requireVersion();
        if (params.replacement === undefined && params.source === undefined) {
          throw new VueProtocolError(ERR_INVALID_PARAMS, 'replacement is required for mode=replace');
        }
        nextSource = String(params.replacement ?? params.source);
      } else {
        throw new VueProtocolError(ERR_UNSUPPORTED, `UNSUPPORTED_CAPABILITY: unknown applyEdit mode ${mode}`);
      }

      validateVueSFC(nextSource);
      const res = atomicApplySourceEdit(resolved, nextSource, { expectedVersion: currentVersion, validateTypeScript: false });
      return {
        status: 'APPLIED' as const,
        path: inputPath,
        ...(params.symbol ? { symbol: params.symbol } : {}),
        newVersion: res.version,
        syntaxCheck: 'passed' as const,
        ...(hunksApplied !== undefined ? { hunksApplied } : {}),
        ...(res.backupPath ? { backupPath: res.backupPath } : {}),
      };
    },

    async verify(params: { componentId?: string; target?: string; action: string; payload?: any }) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const compId = params.componentId || params.target || '';
      const comp = componentRegistry.get(compId);
      if (!comp) {
        throw new VueProtocolError(ERR_COMPONENT_NOT_FOUND, `COMPONENT_NOT_FOUND: '${compId}' is not registered`, { target: compId });
      }

      const stateBefore = comp.getState ? JSON.parse(JSON.stringify(comp.getState())) : {};
      const actionFn = comp.actions ? comp.actions[params.action] : null;
      if (!actionFn) {
        throw new VueProtocolError(ERR_ACTION_NOT_FOUND, `ACTION_NOT_FOUND: '${params.action}' is not defined on '${compId}'`, {
          target: compId,
          action: params.action,
        });
      }

      const tActionStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const result = actionFn(params.payload);
      if (result instanceof Promise) await result;
      const actionMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tActionStart;
      const stateAfter = comp.getState ? JSON.parse(JSON.stringify(comp.getState())) : {};

      const diff: Record<string, { before: any; after: any }> = {};
      for (const k of new Set([...Object.keys(stateBefore), ...Object.keys(stateAfter)])) {
        if (!Object.is(stateBefore[k], stateAfter[k])) diff[k] = { before: stateBefore[k], after: stateAfter[k] };
      }
      traceEvents.push({
        timestamp: Date.now(),
        type: params.action,
        componentId: compId,
        details: `Action '${params.action}' executed on '${compId}'`,
        diff,
      });

      const total = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return {
        status: 'passed' as const,
        target: compId,
        action: params.action,
        diff,
        surfaceDiff: Object.keys(diff).map((key) => ({ op: 'state', target: key, before: diff[key].before, after: diff[key].after })),
        durationMs: Number(total.toFixed(2)),
        timings: { t_action_ms: Number(actionMs.toFixed(2)), t_total_ms: Number(total.toFixed(2)) },
        scope: {
          checked: [`${compId}:${params.action}`],
          notExecuted: ['browser DOM events outside the in-memory adapter'],
          notSupported: [],
        },
      };
    },
  };
}
