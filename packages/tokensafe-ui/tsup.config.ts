import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/observer.ts',
    'src/oumv.ts',
    'src/react.ts',
    'src/vue.ts',
    'src/patcher.ts',
    'src/testing.ts',
    'src/vite.ts',
    'src/mcp.ts',
    'src/cli.ts',
  ],
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
  },
  clean: true,
  sourcemap: false,
  noExternal: [
    '@tokensafe-ui/core',
    '@tokensafe-ui/observer',
    '@tokensafe-ui/oumv',
    '@tokensafe-ui/patcher',
    '@tokensafe-ui/mcp',
    '@tokensafe-ui/vite',
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
});

