import { defineConfig } from 'vite';
import { agentDomPlugin } from '@agent-dom/vite';

export default defineConfig({
  plugins: [agentDomPlugin()],
  server: {
    port: 5173,
  },
});
