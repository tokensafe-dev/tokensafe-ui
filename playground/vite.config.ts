import { defineConfig } from 'vite';
import { agentDom } from '@agent-dom/vite';

export default defineConfig({
  plugins: [agentDom()],
  server: {
    port: 5173,
  },
});
