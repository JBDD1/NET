import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: false,
  // VITE_BASE env var lets CI/GitHub Actions set '/FinovaKimi/' at build time
  // without affecting local dev (which defaults to '/')
  base: process.env.VITE_BASE ?? '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
      output: {
        manualChunks(id) {
          if (id.includes('fiscal.js'))    return 'section-fiscal';
          if (id.includes('simulator.js')) return 'section-simulator';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
