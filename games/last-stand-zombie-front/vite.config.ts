import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * YouTube Playables verlangt ein autarkes Bundle:
 * - relative Asset-Pfade (base: './')
 * - keine externen Requests zur Laufzeit
 * - index.html im Root des Build-Outputs
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 8192,
    sourcemap: false,
    modulePreload: { polyfill: false },
    // Babylon allein liegt ueber 500 kB; die Warnung waere Dauerrauschen.
    // Die harte Grenze prueft stattdessen "npm run youtube:validate".
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        // Ein einziges JS-Bundle: weniger Requests, kein dynamisches
        // Nachladen, das im Playables-Container fehlschlagen koennte.
        codeSplitting: false,
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { host: true, port: 5173 },
});
