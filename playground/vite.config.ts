import { defineConfig } from 'vite';
import { agentDom } from 'tokensafe-ui/vite';

export default defineConfig({
  plugins: [agentDom()],
  server: {
    port: 5173,
  },
});
