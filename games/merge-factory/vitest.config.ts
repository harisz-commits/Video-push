import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // This project sits inside a repository whose root belongs to a different
  // app. Declaring PostCSS inline stops Vite from walking up and picking up
  // that project's postcss.config.mjs.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The worker-thread pool leaked live workers in this container after the
    // run reported success. Forks exit cleanly, and the suite is fast enough
    // that the extra process startup does not matter.
    pool: 'forks',
  },
});
