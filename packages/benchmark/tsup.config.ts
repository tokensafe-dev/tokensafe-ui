import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/aub.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
});
