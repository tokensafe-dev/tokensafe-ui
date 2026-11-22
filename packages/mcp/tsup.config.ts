import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    'typescript',
    '@modelcontextprotocol/sdk',
    'zod',
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
