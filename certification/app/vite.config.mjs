import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tokensafeUi } from '../../packages/vite/dist/index.js';

// The zero-footprint integration under test: one plugin line, nothing in src/.
export default defineConfig({ plugins: [react(), tokensafeUi({ framework: 'react' })] });
