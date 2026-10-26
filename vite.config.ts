import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo-name>/.
export default defineConfig({
  base: '/cardtester/',
  plugins: [react()],
  worker: { format: 'es' },
  // Some tests play hundreds of full games, which can exceed the 5 s default on slower machines.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
