import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { tokensafeUi } from '../../packages/vite/dist/index.js';

// The zero-footprint integration under test: one plugin line, nothing in src/.
export default defineConfig({ plugins: [vue(), tokensafeUi({ framework: 'vue' })] });
