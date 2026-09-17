import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// IMPORTANTE: index.html y landing.html cargan sus scripts con <script src="...">
// clásico (sin type="module"), a propósito — el HTML usa onclick="fn()" que necesita
// que las funciones vivan en el scope global, algo que un <script type="module"> no
// da por defecto. Por eso estos archivos (landing.js y todo src/**/*.js) NUNCA pasan
// por el pipeline normal de Vite/Rollup, ni en build (Rollup solo empaqueta
// type="module") ni en dev (el servidor de Vite solo transforma peticiones que
// resuelve como parte del grafo de módulos ES — un <script src> clásico es una
// petición HTTP normal que Vite sirve tal cual, sin pasar por su transform).
// Unos pocos archivos (auth.js, ai.js, api.js, portfolio.js) usan
// import.meta.env.VITE_* — un token que es SyntaxError fuera de un módulo ES,
// se llegue a ejecutar o no esa línea. Hay que sustituirlo por su valor literal
// nosotros mismos, tanto al copiar a dist/ (build) como al servir en dev.

// Cubre tanto "import.meta.env.VITE_X" como "import.meta.env?.VITE_X" (optional chaining).
const _envAssignRe = /import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g;
// Cualquier "import.meta" que quede (p.ej. dentro de "typeof import.meta !== 'undefined'")
// es un SyntaxError en un <script> clásico, se resuelva o no en tiempo de ejecución — el
// parser lo rechaza igual. Se sustituye por "undefined", que preserva la semántica de esos
// guards (fuera de un módulo, "import.meta" no existe).
const _bareImportMetaRe = /import\.meta\b/g;

function stripImportMeta(code, env) {
  if (!/import\.meta/.test(code)) return code;
  return code
    .replace(_envAssignRe, (_, key) => JSON.stringify(env[key] ?? ''))
    .replace(_bareImportMetaRe, 'undefined');
}

// Copia archivos estáticos que no pasan por Rollup al directorio dist/
// (iconos, manifest, sw.js, páginas HTML simples, etc.)
function copyStaticAssets(outDir = 'dist', mode = 'production') {
  const staticFiles = [
    'manifest.json', 'sw.js', 'robots.txt', 'sitemap.xml',
    'privacidad.html', 'privacy.html', 'terminos.html', 'terms.html',
    'landing.js',
  ];

  function copyJsDir(srcDir, destDir, env) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      // Los tests (src/tests/**) son solo para desarrollo, no se despliegan.
      if (entry.name === 'tests' && srcDir === 'src') continue;
      const srcPath  = resolve(srcDir, entry.name);
      const destPath = resolve(destDir, entry.name);
      if (entry.isDirectory()) { copyJsDir(srcPath, destPath, env); continue; }
      if (!entry.name.endsWith('.js')) { fs.copyFileSync(srcPath, destPath); continue; }
      const code = stripImportMeta(fs.readFileSync(srcPath, 'utf8'), env);
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
      // Módulos clásicos de la app (ver comentario arriba)
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      copyJsDir('src', resolve(outDir, 'src'), env);
    },
  };
}

// Sirve src/**/*.js con import.meta.env ya resuelto cuando `vite` (servidor de
// desarrollo) los sirve como <script src> clásico — sin esto, Vite devuelve el
// archivo tal cual (con "import.meta.env.VITE_X" literal en el texto), que el
// navegador rechaza al parsear un script no-módulo con SyntaxError.
function devClassicScripts(mode) {
  return {
    name: 'finova-dev-classic-scripts',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (req.method !== 'GET' || !url.startsWith('/src/') || !url.endsWith('.js')) return next();
        const filePath = resolve('.' + url);
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) return next();
          if (!data.includes('import.meta')) return next(); // deja pasar los que no lo necesitan
          res.setHeader('Content-Type', 'text/javascript');
          res.end(stripImportMeta(data, env));
        });
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

    plugins: [copyStaticAssets('dist', mode), devClassicScripts(mode)],

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
