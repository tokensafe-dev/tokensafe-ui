import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    conditions: ['browser', 'development'],
    alias: {
      'tokensafe-ui/observer': path.resolve(__dirname, 'packages/tokensafe-ui/src/observer.ts'),
      'tokensafe-ui/oumv': path.resolve(__dirname, 'packages/tokensafe-ui/src/oumv.ts'),
      'tokensafe-ui/react-client': path.resolve(__dirname, 'packages/tokensafe-ui/src/react-client.ts'),
      'tokensafe-ui/contracts': path.resolve(__dirname, 'packages/tokensafe-ui/src/contracts.ts'),
      'tokensafe-ui/patcher': path.resolve(__dirname, 'packages/tokensafe-ui/src/patcher.ts'),
      'tokensafe-ui/testing': path.resolve(__dirname, 'packages/tokensafe-ui/src/testing.ts'),
      'tokensafe-ui/vite': path.resolve(__dirname, 'packages/tokensafe-ui/src/vite.ts'),
      'tokensafe-ui/mcp': path.resolve(__dirname, 'packages/tokensafe-ui/src/mcp.ts'),
      'tokensafe-ui': path.resolve(__dirname, 'packages/tokensafe-ui/src/index.ts'),
      '@tokensafe-ui/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@tokensafe-ui/observer': path.resolve(__dirname, 'packages/observer/src/index.ts'),
      '@tokensafe-ui/mcp': path.resolve(__dirname, 'packages/mcp/src/index.ts'),
      '@tokensafe-ui/patcher': path.resolve(__dirname, 'packages/patcher/src/index.ts'),
      '@tokensafe-ui/oumv/react-client': path.resolve(__dirname, 'packages/oumv/src/react-client.ts'),
      '@tokensafe-ui/oumv/contracts': path.resolve(__dirname, 'packages/oumv/src/contracts.ts'),
      '@tokensafe-ui/oumv/static': path.resolve(__dirname, 'packages/oumv/src/static.ts'),
      '@tokensafe-ui/oumv': path.resolve(__dirname, 'packages/oumv/src/index.ts'),
      '@tokensafe-ui/vite': path.resolve(__dirname, 'packages/vite/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});

