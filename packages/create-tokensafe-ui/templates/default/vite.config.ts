import { defineConfig } from 'vite';
import { tokensafePlugin } from 'tokensafe-ui/vite';

export default defineConfig({
  plugins: [tokensafePlugin()],
  server: {
    port: 5173,
  },
});
