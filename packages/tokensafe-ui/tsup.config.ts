import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/observer.ts',
    'src/oumv.ts',
    'src/patcher.ts',
    'src/testing.ts',
    'src/vite.ts',
    'src/mcp.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  noExternal: [
    '@agent-dom/core',
    '@agent-dom/observer',
    '@agent-dom/oumv',
    '@agent-dom/patcher',
    '@agent-dom/mcp',
    '@agent-dom/vite',
  ],
  external: [
    'zod',
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
    '@babel/generator',
    '@modelcontextprotocol/sdk',
    'vite',
    'typescript',
  ],
  esbuildOptions(options) {
    options.external = [
      ...(options.external || []),
      'typescript',
      'zod',
      'vite',
      '@modelcontextprotocol/sdk',
    ];
  },
  banner: {
    js: `import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirnameFunc } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameFunc(__filename);`,
  },
});

