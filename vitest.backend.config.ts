// Backend-only vitest config (Electron main / fee logic).
// Frontend keeps its own vite.config.ts — do not merge.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/main/**/*.spec.ts', 'src/shared/**/*.spec.ts'],
  },
});
