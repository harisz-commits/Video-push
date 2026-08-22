import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// `base: './'` is mandatory: YouTube Playables serves the bundle from an
// arbitrary path, so every emitted URL has to be relative.
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // This project sits inside a repository whose root belongs to a different
  // app. Declaring PostCSS inline stops Vite from walking up and picking up
  // that project's postcss.config.mjs.
  css: { postcss: { plugins: [] } },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        // Flat, predictable file names keep the ZIP layout trivial to validate.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { host: true, port: 5180 },
});
