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
  sourcemap: true,
});
