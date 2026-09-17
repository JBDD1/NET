import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// Copia archivos estáticos que no pasan por Rollup al directorio dist/
// (iconos, manifest, sw.js, páginas HTML simples, etc.)
//
// IMPORTANTE: index.html y landing.html cargan sus scripts con <script src="...">
// clásico (sin type="module"), a propósito — el HTML usa onclick="fn()" que necesita
// que las funciones vivan en el scope global, algo que un <script type="module"> no
// da por defecto. Rollup solo empaqueta <script type="module">, así que estos archivos
// (landing.js y todo src/**/*.js) NUNCA pasan por su pipeline de bundling/transform:
// hay que copiarlos a mano, igual que los demás estáticos. Como tampoco pasan por el
// transform de Vite, hay que sustituir aquí mismo los import.meta.env.VITE_* que usan
// (auth.js, ai.js, api.js, portfolio.js) por su valor literal del modo de build.
function copyStaticAssets(outDir = 'dist', mode = 'production') {
  const staticFiles = [
    'manifest.json', 'sw.js', 'robots.txt', 'sitemap.xml',
    'privacidad.html', 'privacy.html', 'terminos.html', 'terms.html',
    'landing.js',
  ];
  // Cubre tanto "import.meta.env.VITE_X" como "import.meta.env?.VITE_X" (optional chaining).
  const envAssignRe = /import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g;
  // Cualquier "import.meta" que quede (p.ej. dentro de "typeof import.meta !== 'undefined'")
  // es un SyntaxError en un <script> clásico, se resuelva o no en tiempo de ejecución — el
  // parser lo rechaza igual. Se sustituye por "undefined", que preserva la semántica de esos
  // guards (fuera de un módulo, "import.meta" no existe).
  const bareImportMetaRe = /import\.meta\b/g;

  function copyJsDir(srcDir, destDir, env) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      // Los tests (src/tests/**) son solo para desarrollo, no se despliegan.
      if (entry.name === 'tests' && srcDir === 'src') continue;
      const srcPath  = resolve(srcDir, entry.name);
      const destPath = resolve(destDir, entry.name);
      if (entry.isDirectory()) { copyJsDir(srcPath, destPath, env); continue; }
      if (!entry.name.endsWith('.js')) { fs.copyFileSync(srcPath, destPath); continue; }
      let code = fs.readFileSync(srcPath, 'utf8');
      if (/import\.meta/.test(code)) {
        code = code
          .replace(envAssignRe, (_, key) => JSON.stringify(env[key] ?? ''))
          .replace(bareImportMetaRe, 'undefined');
      }
      fs.writeFileSync(destPath, code, 'utf8');
    }
  }

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
      // Módulos clásicos de la app (ver comentario arriba de copyStaticAssets)
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      copyJsDir('src', resolve(outDir, 'src'), env);
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

    plugins: [copyStaticAssets('dist', mode)],

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
