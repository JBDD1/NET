import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// Copia archivos estáticos que no pasan por Rollup al directorio dist/
// (iconos, manifest, sw.js, páginas HTML simples, etc.)
function copyStaticAssets(outDir = 'dist') {
  const staticFiles = [
    'manifest.json', 'sw.js', 'robots.txt', 'sitemap.xml',
    'privacidad.html', 'privacy.html', 'terminos.html', 'terms.html',
    // landing.js NO se copia: Vite lo procesa al tener landing.html como input de Rollup
  ];
  return {
    name: 'finova-copy-static',
    apply: 'build',
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      // Archivos específicos
      staticFiles.forEach(f => {
        if (fs.existsSync(f)) fs.copyFileSync(f, resolve(outDir, f));
      });
      // Todos los iconos (icon.svg, icon-*.png)
      fs.readdirSync('.').filter(f => /^icon[-.]/.test(f) || f === 'icon.svg').forEach(f => {
        fs.copyFileSync(f, resolve(outDir, f));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    root: '.',
    publicDir: false, // Los assets estáticos se copian vía el plugin copyStaticAssets

    // VITE_BASE permite builds para GitHub Pages sin cambiar este archivo
    base: process.env.VITE_BASE ?? '/',

    build: {
      outDir: 'dist',
      emptyOutDir: true,

      // CRÍTICO: sin source maps en producción — revelan el código original
      sourcemap: isProd ? false : 'inline',

      // Minificación con terser (más agresiva que esbuild por defecto)
      minify: isProd ? 'terser' : false,
      terserOptions: isProd ? {
        compress: {
          drop_console:  true,   // Elimina todos los console.* en producción
          drop_debugger: true,
          dead_code:     true,
          collapse_vars: true,
          evaluate:      true,
          passes:        2,
          // NO se usan: unsafe, unsafe_math, pure_getters
          // unsafe_math puede alterar resultados de aritmética float en apps fintech
        },
        mangle: {
          // toplevel:false (default) — NO renombra funciones globales:
          // el HTML usa onclick="openModal()" etc. que referencian funciones por nombre
          // properties:false (default) — NO renombra propiedades de objetos:
          // el JSON del servidor debe coincidir con las propiedades del frontend
        },
        format: {
          comments:   false,  // Elimina todos los comentarios
          ascii_only: false,  // Mantiene Unicode (español: ñ, é, ó…)
        },
        ecma: 2020,
      } : undefined,

      rollupOptions: {
        input: {
          main:    resolve('index.html'),
          landing: resolve('landing.html'),
        },
        output: {
          // Nombres con hash para cache-busting automático
          chunkFileNames: 'assets/[hash].js',
          entryFileNames: 'assets/[hash].js',
          assetFileNames: 'assets/[hash].[ext]',

          manualChunks(id) {
            if (id.includes('fiscal.js'))    return 'section-fiscal';
            if (id.includes('simulator.js')) return 'section-simulator';
          },
        },
      },

      // CSS también minificado en producción
      cssMinify: isProd,

      // Assets pequeños inlineados como data URIs
      assetsInlineLimit: 4096,

      // Target de navegadores modernos
      target: 'es2020',

      chunkSizeWarningLimit: 1000,
      reportCompressedSize:  true,
    },

    plugins: [copyStaticAssets('dist')],

    // Solo exponer al frontend variables con prefijo VITE_
    envPrefix: 'VITE_',

    // Servidor de desarrollo con proxy a Railway local
    server: {
      port: 5173,
      proxy: {
        '/api': process.env.VITE_SERVER_URL || 'http://localhost:3000',
      },
    },
  };
});
