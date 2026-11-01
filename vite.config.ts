import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so Electron loadFile (file://) resolves ./assets/... correctly.
  base: './',
  plugins: [react()],
  root: '.',
  build: { outDir: 'dist/renderer' },
  server: { port: 5173 },
});
