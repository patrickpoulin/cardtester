import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo-name>/.
export default defineConfig({
  base: '/cardtester/',
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
