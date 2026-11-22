import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'tokensafe-ui/observer': path.resolve(__dirname, 'packages/tokensafe-ui/src/observer.ts'),
      'tokensafe-ui/oumv': path.resolve(__dirname, 'packages/tokensafe-ui/src/oumv.ts'),
      'tokensafe-ui/patcher': path.resolve(__dirname, 'packages/tokensafe-ui/src/patcher.ts'),
      'tokensafe-ui/testing': path.resolve(__dirname, 'packages/tokensafe-ui/src/testing.ts'),
      'tokensafe-ui': path.resolve(__dirname, 'packages/tokensafe-ui/src/index.ts'),
      '@tokensafe/ui/observer': path.resolve(__dirname, 'packages/ui/src/observer.ts'),
      '@tokensafe/ui/oumv': path.resolve(__dirname, 'packages/ui/src/oumv.ts'),
      '@tokensafe/ui/patcher': path.resolve(__dirname, 'packages/ui/src/patcher.ts'),
      '@tokensafe/ui/testing': path.resolve(__dirname, 'packages/ui/src/testing.ts'),
      '@tokensafe/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
      '@agent-dom/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@agent-dom/observer': path.resolve(__dirname, 'packages/observer/src/index.ts'),
      '@agent-dom/mcp': path.resolve(__dirname, 'packages/mcp/src/index.ts'),
      '@agent-dom/patcher': path.resolve(__dirname, 'packages/patcher/src/index.ts'),
      '@agent-dom/oumv': path.resolve(__dirname, 'packages/oumv/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});

