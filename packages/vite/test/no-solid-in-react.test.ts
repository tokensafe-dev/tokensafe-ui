import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A React/Vue project installs `tokensafe-ui/vite`; that entry must not evaluate
 * the native SolidJS runtime. We assert it structurally on the built bundle: no
 * module in the STATIC import graph of `dist/vite.js` may contain solid-js code.
 *
 * Skipped when dist is absent (unit-test-only runs); CI builds before testing.
 */

const DIST_VITE = path.resolve(__dirname, '../../tokensafe-ui/dist/vite.js');

function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf-8');
    for (const match of source.matchAll(/(?:from|import)\s*["'](\.\/[^"']+)["']/g)) {
      stack.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  return seen;
}

describe('tokensafe-ui/vite is solid-free', () => {
  const hasDist = fs.existsSync(DIST_VITE);

  it.runIf(hasDist)('static import graph of dist/vite.js contains no solid-js', () => {
    const graph = staticGraph(DIST_VITE);
    expect(graph.size).toBeGreaterThan(0);

    const offenders = [...graph].filter((file) => {
      const source = fs.readFileSync(file, 'utf-8');
      return source.includes('solid-js') || source.includes('createSignal(');
    });

    expect(offenders.map((f) => path.basename(f))).toEqual([]);
  });

  it.runIf(hasDist)('the native runtime is reachable only through a dynamic import', () => {
    const graph = staticGraph(DIST_VITE);
    const dynamicSpecifiers = [...graph].flatMap((file) => {
      const source = fs.readFileSync(file, 'utf-8');
      return [...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    });
    // The native runtime (and the MCP mutation helpers) must be reached lazily,
    // never through the static graph.
    expect(dynamicSpecifiers.some((spec) => spec.startsWith('./'))).toBe(true);
  });
});
