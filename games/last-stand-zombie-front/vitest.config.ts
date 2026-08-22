import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Nur Logik wird getestet. Babylon-Code laeuft nicht in Node und wird
    // daher bewusst nicht importiert (PLAN.md A7).
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
