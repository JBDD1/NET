import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import { minify as terserMinify } from 'terser';
import crypto from 'crypto';

// Mismas opciones que build.terserOptions más abajo (ver ese comentario) —
// se reutilizan aquí para minificar los scripts clásicos de src/** y
// landing.js, que Rollup NUNCA toca (no son type="module", así que no
// forman parte de su grafo de módulos y build.minify no les aplica nada).
const PROD_TERSER_OPTIONS = {
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
};

async function _minifyClassicJs(code, label) {
  const result = await terserMinify(code, PROD_TERSER_OPTIONS);
  if (result.error) {
    console.error(`[vite.config] Terser falló minificando ${label}:`, result.error);
    throw result.error;
  }
  return result.code;
}

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
  const isProd = mode === 'production';
  const staticFiles = [
    'manifest.json', 'sw.js', 'robots.txt', 'sitemap.xml',
    'privacidad.html', 'privacy.html', 'terminos.html', 'terms.html', 'faq.html',
  ];

  async function copyJsDir(srcDir, destDir, env) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      // Los tests (src/tests/**) son solo para desarrollo, no se despliegan.
      if (entry.name === 'tests' && srcDir === 'src') continue;
      // monitoring.js es un MÓDULO ES (importa @sentry/browser), no un script
      // clásico: lo empaqueta Rollup desde el <script type="module"> de
      // index.html y landing.html. Copiarlo aquí dejaría en dist/ un fichero
      // muerto con un import sin resolver que nadie carga.
      if (entry.name === 'monitoring.js') continue;
      const srcPath  = resolve(srcDir, entry.name);
      const destPath = resolve(destDir, entry.name);
      if (entry.isDirectory()) { await copyJsDir(srcPath, destPath, env); continue; }
      if (!entry.name.endsWith('.js')) { fs.copyFileSync(srcPath, destPath); continue; }
      let code = stripImportMeta(fs.readFileSync(srcPath, 'utf8'), env);
      if (isProd) code = await _minifyClassicJs(code, srcPath);
      fs.writeFileSync(destPath, code, 'utf8');
    }
  }

  return {
    name: 'finova-copy-static',
    apply: 'build',
    async closeBundle() {
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
      await copyJsDir('src', resolve(outDir, 'src'), env);
      // landing.js es un script clásico igual que src/**/*.js (mismo motivo:
      // landing.html lo carga sin type="module") — mismo tratamiento.
      if (fs.existsSync('landing.js')) {
        let code = stripImportMeta(fs.readFileSync('landing.js', 'utf8'), env);
        if (isProd) code = await _minifyClassicJs(code, 'landing.js');
        fs.writeFileSync(resolve(outDir, 'landing.js'), code, 'utf8');
      }
    },
  };
}

/**
 * Cache busting de los scripts clásicos + versión de caché del service worker.
 *
 * Tiene que ejecutarse DESPUÉS de copyStaticAssets, porque hashea ficheros
 * que ese plugin acaba de escribir. Y eso NO lo garantiza el orden del array
 * de plugins: closeBundle es un hook paralelo en Rollup, así que todos los
 * plugins lo arrancan a la vez. Lo garantiza `sequential: true` en el hook,
 * más abajo.
 *
 * ── Por qué hace falta el cache busting ──
 * Las etiquetas son <script src="src/core/script.js"> sin hash en el nombre,
 * porque Rollup no las toca (no son módulos) y renombrarlas obligaría a
 * reescribir el HTML fuente. Al no cambiar nunca la URL, el navegador sirve
 * su copia cacheada después de un despliegue y la aplicación se queda en la
 * versión anterior. El ?v=<hash> cambia la URL solo cuando cambia el
 * contenido, que es exactamente lo que se quiere.
 *
 * ── Por qué el nombre de caché del SW sale del build ──
 * Era una constante a mano ('finova-v27'). Si un despliegue se olvidaba de
 * subirla, sw.js quedaba byte-idéntico, el navegador no detectaba ninguna
 * actualización, 'activate' no borraba nada y el usuario seguía con la
 * aplicación vieja indefinidamente. Derivarla del contenido hace que eso no
 * pueda pasar: si el build cambia, el nombre cambia.
 */
function buildScripts(outDir = 'dist', mode = 'production') {
  const isProd = mode === 'production';

  /** sha256 corto y estable del contenido de un fichero. */
  const hashFichero = (p) =>
    crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 8);

  const esExterna = (u) =>
    /^(https?:)?\/\//i.test(u) || u.startsWith('data:') || u.startsWith('#')
    || u.startsWith('mailto:') || u.startsWith('blob:');

  return {
    name: 'finova-build-scripts',
    apply: 'build',
    // sequential: closeBundle es un hook PARALELO en Rollup, así que por
    // defecto este plugin arranca al mismo tiempo que copyStaticAssets en vez
    // de después. El síntoma era desconcertante: el plugin avisaba de que no
    // existía ninguno de los 26 scripts y añadía ?v= a cero etiquetas, porque
    // los estaba buscando antes de que el otro plugin los escribiera. Con
    // sequential, Rollup espera a los hooks de los plugins anteriores.
    closeBundle: {
      sequential: true,
      async handler() {
      if (!fs.existsSync(outDir)) return;

      const htmls = fs.readdirSync(outDir).filter(f => f.endsWith('.html'));
      const hashes = new Map();   // ruta relativa -> hash
      let etiquetas = 0;

      for (const nombre of htmls) {
        const rutaHtml = resolve(outDir, nombre);
        let html = fs.readFileSync(rutaHtml, 'utf8');

        // Solo <script src> LOCAL y NO módulo. Los módulos ya llevan hash en
        // el nombre de fichero (los pone Rollup) y las librerías externas no
        // se tocan.
        html = html.replace(
          /<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>/gi,
          (completo, antes, q, src, despues) => {
            const attrs = antes + despues;
            if (/\btype\s*=\s*["']module["']/i.test(attrs)) return completo;
            if (esExterna(src)) return completo;
            if (src.includes('?')) return completo;   // ya versionado

            // La base (VITE_BASE para GitHub Pages) va delante de la ruta en
            // el HTML pero no forma parte de la ruta dentro de dist/.
            const sinBase = src.replace(/^\.?\//, '');
            const destino = resolve(outDir, sinBase);
            if (!fs.existsSync(destino)) {
              // No se inventa un hash de algo que no está: el fallo lo
              // reporta verify-dist con un mensaje mucho más claro.
              this.warn(`[finova-build-scripts] ${nombre} referencia ${src}, que no existe en ${outDir}/`);
              return completo;
            }
            if (!hashes.has(sinBase)) hashes.set(sinBase, hashFichero(destino));
            etiquetas++;
            return `<script${antes}src=${q}${src}?v=${hashes.get(sinBase)}${q}${despues}>`;
          },
        );

        fs.writeFileSync(rutaHtml, html, 'utf8');
      }

      console.log(`[finova-build-scripts] ?v= añadido a ${etiquetas} etiquetas de script en ${htmls.length} HTML`);

      /* ── Versión de caché del service worker ── */
      const rutaSw = resolve(outDir, 'sw.js');
      if (fs.existsSync(rutaSw)) {
        // El hash se calcula sobre TODO lo que el SW puede servir, no solo
        // sobre los scripts: si cambia el CSS o un icono, la caché vieja
        // también tiene que morir.
        const acumulado = crypto.createHash('sha256');
        const ficheros = [];
        (function recorre(d) {
          for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const p = resolve(d, e.name);
            if (e.isDirectory()) { recorre(p); continue; }
            // sw.js se excluye a propósito: su propio contenido depende del
            // hash, y meterlo dentro sería una dependencia circular.
            if (p === rutaSw) continue;
            ficheros.push(p);
          }
        })(resolve(outDir));
        for (const p of ficheros) {
          acumulado.update(p.replace(/\\/g, '/').split('/dist/').pop());
          acumulado.update(fs.readFileSync(p));
        }
        const versionBuild = acumulado.digest('hex').slice(0, 12);

        let sw = fs.readFileSync(rutaSw, 'utf8');
        const marcador = /const CACHE_NAME = '[^']*';\s*\/\* __FINOVA_CACHE_NAME__ \*\//;
        if (!marcador.test(sw)) {
          // Fallar y no seguir: un SW sin versión de build es justo el
          // problema que esto viene a arreglar, y pasaría desapercibido.
          throw new Error(
            '[finova-build-scripts] No se encontró el marcador __FINOVA_CACHE_NAME__ en sw.js. '
            + 'Sin él, la versión de caché no se inyecta y un despliegue puede dejar a los '
            + 'usuarios con la aplicación anterior. Revisa sw.js.',
          );
        }
        sw = sw.replace(marcador, `const CACHE_NAME = 'finova-${versionBuild}';`);
        fs.writeFileSync(rutaSw, sw, 'utf8');
        console.log(`[finova-build-scripts] sw.js: CACHE_NAME = finova-${versionBuild} (${ficheros.length} ficheros hasheados)`);
      }

      if (!isProd) {
        console.log('[finova-build-scripts] build de desarrollo: los scripts clásicos van sin minificar');
      }
      },
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
          // Un fichero con imports REALES es un módulo ES, no un script
          // clásico: lo tiene que transformar Vite para resolver los bare
          // imports ('@sentry/browser' no es una ruta que el navegador sepa
          // cargar). Este middleware existe solo para los clásicos.
          if (/^\s*import\s[\s\S]*?\sfrom\s/m.test(data)) return next();
          res.setHeader('Content-Type', 'text/javascript');
          res.end(stripImportMeta(data, env));
        });
      });
    },
  };
}

// Redirige 127.0.0.1 → localhost en el servidor de desarrollo de Vite. Firebase
// Auth solo acepta 'localhost' como dominio autorizado (no 127.0.0.1, aunque sea
// la misma máquina) — mismo fix que ya existe para `npm start` en server.cjs.
// Arreglarlo aquí, a nivel de servidor, cubre TODAS las páginas (index.html y
// landing.html, y cualquiera futura) de una vez, en vez de parchear cada script
// de auth por separado.
function devHostRedirect() {
  return {
    name: 'finova-dev-host-redirect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host || '';
        if (!host.startsWith('127.0.0.1')) return next();
        const port = host.split(':')[1];
        res.writeHead(301, { Location: `http://localhost${port ? ':' + port : ''}${req.url}` });
        res.end();
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

      // CRÍTICO: sin source maps en producción — revelan el código original.
      //
      // VITE_SOURCEMAP=1 los genera igualmente, para el flujo OPCIONAL de
      // subirlos a Sentry y borrarlos antes de desplegar
      // (npm run build:sentry). Nunca se activa por accidente: hay que pasar
      // la variable a mano.
      //
      // Nota: en este proyecto los source maps importan MENOS que en un
      // bundle normal, porque mangle.toplevel es false y los nombres de
      // función se conservan en dist/. Ver MONITORING_SETUP.md.
      sourcemap: isProd ? (process.env.VITE_SOURCEMAP === '1' ? true : false) : 'inline',

      // Minificación con terser (más agresiva que esbuild por defecto).
      // Mismas opciones que PROD_TERSER_OPTIONS arriba (compartidas con el
      // minificado manual de los scripts clásicos en copyStaticAssets).
      minify: isProd ? 'terser' : false,
      terserOptions: isProd ? PROD_TERSER_OPTIONS : undefined,

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

    // El orden importa: buildScripts hashea ficheros que copyStaticAssets acaba
    // de escribir, y closeBundle se ejecuta en orden de registro.
    plugins: [copyStaticAssets('dist', mode), buildScripts('dist', mode), devHostRedirect(), devClassicScripts(mode)],

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
