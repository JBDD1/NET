#!/usr/bin/env node
'use strict';

/**
 * Finova — verify-dist.cjs
 *
 * Guardia posterior al build. Falla con exit 1 si dist/ no es desplegable.
 *
 * Existe por un fallo concreto y muy caro: index.html carga ~20 scripts
 * clásicos (<script src> sin type="module"), que Rollup NO empaqueta. Vite
 * avisa («can't be bundled without type=module») y sigue, así que un build
 * que deje esos ficheros fuera de dist/ termina en verde y despliega una
 * página en blanco con 404 en todos los scripts. Un aviso que no rompe nada
 * es un aviso que nadie lee.
 *
 * Lo que comprueba:
 *   1. Toda referencia local de todo dist/*.html existe en dist/.
 *   2. No hay ficheros .map (exponen el código original).
 *   3. Ningún .js de dist/ contiene console.log( ni sourceMappingURL.
 *   4. No hay ninguna clave de API real.
 *   5. El service worker tiene su versión de caché inyectada por el build.
 *
 * Se ejecuta con `npm run verify:dist`, y `npm run build` lo encadena.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// VITE_BASE la usa el build de GitHub Pages: el HTML referencia
// «/NET/src/...» pero dentro de dist/ el fichero está en «src/...».
const BASE = (process.env.VITE_BASE || '/').replace(/\/+$/, '');

const errores = [];
const avisos = [];

/* ─── 0. Que dist exista y no esté vacío ───────────────────────── */

if (!fs.existsSync(DIST)) {
  console.error('[verify-dist] No existe dist/. Ejecuta primero el build.');
  process.exit(1);
}

/** Todos los ficheros de dist/, como rutas relativas con barras normales. */
function listar(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listar(p, acc);
    else acc.push(path.relative(DIST, p).replace(/\\/g, '/'));
  }
  return acc;
}
const FICHEROS = listar(DIST);
const EXISTE = new Set(FICHEROS);

/* ─── 1. Referencias de los HTML ───────────────────────────────── */

const esExterna = (u) =>
  /^(https?:)?\/\//i.test(u) || u.startsWith('data:') || u.startsWith('#')
  || u.startsWith('mailto:') || u.startsWith('tel:') || u.startsWith('blob:')
  || u.startsWith('javascript:');

/**
 * Normaliza una URL del HTML a una ruta relativa dentro de dist/.
 * Devuelve null si la referencia no apunta a un fichero de dist/.
 */
function aRutaDist(url) {
  let u = url.split('?')[0].split('#')[0].trim();
  if (!u) return null;
  // Quitar la base del despliegue si la lleva.
  if (BASE && u.startsWith(BASE + '/')) u = u.slice(BASE.length);
  u = u.replace(/^\.?\//, '');
  if (!u) return 'index.html';          // «/» y «./» son la portada
  if (u.endsWith('/')) return u + 'index.html';
  return u;
}

const htmls = FICHEROS.filter(f => f.endsWith('.html'));
if (!htmls.length) errores.push('dist/ no contiene ningún .html');

let nRefs = 0;
for (const h of htmls) {
  const html = fs.readFileSync(path.join(DIST, h), 'utf8');
  const re = /<(script|link|img|source|video|audio|embed)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const src = (attrs.match(/\b(?:src|href)\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (!src || esExterna(src)) continue;
    if (tag === 'link') {
      const rel = (attrs.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      // Solo lo que el navegador va a pedir de verdad.
      if (!/\b(stylesheet|icon|apple-touch-icon|manifest|preload|modulepreload)\b/i.test(rel)) continue;
    }
    const rel = aRutaDist(src);
    if (!rel) continue;
    nRefs++;
    if (!EXISTE.has(rel)) {
      errores.push(`${h} referencia «${src}» y dist/${rel} no existe`);
    }
  }
}

/* ─── 2. Sourcemaps ────────────────────────────────────────────── */

const maps = FICHEROS.filter(f => f.endsWith('.map'));
for (const f of maps) {
  errores.push(`dist/${f} es un sourcemap: expone el código original sin minificar`);
}

/* ─── 3. console.log y sourceMappingURL en el JS ───────────────── */

// En desarrollo (build:dev) los scripts clásicos van sin minificar y los
// console.log son legítimos: solo se exige en producción.
const ES_PROD = process.env.NODE_ENV !== 'development' && process.env.FINOVA_VERIFY_DEV !== '1';

const jsDist = FICHEROS.filter(f => f.endsWith('.js'));
if (!jsDist.length) errores.push('dist/ no contiene ningún .js');

for (const f of jsDist) {
  const code = fs.readFileSync(path.join(DIST, f), 'utf8');
  if (/\/\/[#@]\s*sourceMappingURL/.test(code)) {
    errores.push(`dist/${f} contiene sourceMappingURL`);
  }
  if (ES_PROD && /console\s*\.\s*log\s*\(/.test(code)) {
    errores.push(`dist/${f} contiene console.log( — drop_console no se le aplicó`);
  }
}

/* ─── 3b. Lo mismo en los <script> EN LÍNEA de los HTML ────────── */

/*
 * Los bloques en línea no pasan por Terser: Rollup solo toca los módulos y
 * el plugin de scripts clásicos solo toca ficheros. Son poco código (unos
 * 6 kB, el 0,7 % del JS desplegado), pero «poco» no es «nada», y un
 * console.log ahí sale igual en la consola del usuario.
 *
 * Esta comprobación existe porque el repaso de ficheros .js de arriba NO
 * los veía: un console.log movido de un .js a un bloque en línea habría
 * pasado la guardia sin más.
 */
let nInline = 0, bytesInline = 0;
for (const h of htmls) {
  const html = fs.readFileSync(path.join(DIST, h), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue;                    // tiene src: no es en línea
    const tipo = (m[1].match(/\btype\s*=\s*["']([^"']+)/i) || [])[1] || '';
    if (tipo && !/javascript|module/i.test(tipo)) continue;    // ld+json y demás no son código
    const cuerpo = m[2];
    if (!cuerpo.trim()) continue;
    nInline++;
    bytesInline += Buffer.byteLength(cuerpo);
    // Número de línea donde empieza el bloque, para poder encontrarlo.
    const linea = html.slice(0, m.index).split('\n').length;
    if (ES_PROD && /console\s*\.\s*log\s*\(/.test(cuerpo)) {
      errores.push(`dist/${h}: bloque <script> en línea que empieza en la línea ${linea} contiene console.log(`);
    }
    if (ES_PROD && /\bdebugger\b/.test(cuerpo)) {
      errores.push(`dist/${h}: bloque <script> en línea que empieza en la línea ${linea} contiene debugger`);
    }
    if (/\/\/[#@]\s*sourceMappingURL/.test(cuerpo)) {
      errores.push(`dist/${h}: bloque <script> en línea que empieza en la línea ${linea} contiene sourceMappingURL`);
    }
  }
}

/* ─── 4. Claves de API reales ──────────────────────────────────── */

/*
 * Solo lo que de verdad es una clave. Los marcadores de posición del propio
 * código (un prefijo de Anthropic seguido de puntos suspensivos, o uno de
 * Groq seguido de «tu_clave_aqui») NO deben disparar la alarma: un detector
 * que grita con los ejemplos se desactiva a la semana y entonces no detecta
 * nada.
 *
 * Tanto las expresiones como esta explicación tienen los prefijos partidos o
 * descritos en prosa a propósito: el escáner de secretos del pre-commit
 * detectaba al detector, y bloqueaba el commit por sus propios ejemplos.
 */
const PATRONES_CLAVE = [
  { nombre: 'Anthropic', re: new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}', 'g') },
  { nombre: 'Groq',      re: new RegExp('gsk' + '_[A-Za-z0-9]{20,}', 'g') },
  { nombre: 'OpenAI',    re: new RegExp('sk-' + 'proj-[A-Za-z0-9_-]{20,}', 'g') },
];
// Un valor que sea claramente un hueco por rellenar.
const ES_MARCADOR = (s) =>
  /\.\.\.|xxx|XXX|tu[_-]?clave|your[_-]?key|placeholder|aqui|here|ejemplo|example|COMPLETAR|<|>/.test(s);

for (const f of FICHEROS) {
  if (/\.(png|jpe?g|webp|svg|ico|woff2?|map)$/i.test(f)) continue;
  const texto = fs.readFileSync(path.join(DIST, f), 'utf8');
  for (const { nombre, re } of PATRONES_CLAVE) {
    for (const hit of texto.match(re) || []) {
      if (ES_MARCADOR(hit)) continue;
      // No se imprime la clave entera en el log: el log acaba en CI.
      errores.push(`dist/${f} contiene lo que parece una clave de ${nombre} (${hit.slice(0, 12)}…)`);
    }
  }
}

/* ─── 5. El service worker lleva su versión de build ──────────── */

if (EXISTE.has('sw.js')) {
  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  const m = sw.match(/const CACHE_NAME = '([^']+)'/);
  if (!m) {
    errores.push('dist/sw.js no declara CACHE_NAME');
  } else if (/__FINOVA_CACHE_NAME__/.test(sw)) {
    errores.push('dist/sw.js conserva el marcador __FINOVA_CACHE_NAME__: el build no inyectó la versión de caché');
  } else if (!/^finova-[0-9a-f]{8,}$/.test(m[1])) {
    // Un nombre a mano («finova-v27») significa que un despliegue que se
    // olvide de subirlo dejará a los usuarios con la aplicación anterior.
    errores.push(`dist/sw.js tiene CACHE_NAME = '${m[1]}', que no viene del hash del build`);
  }
} else {
  avisos.push('dist/sw.js no existe: la aplicación no funcionará sin conexión');
}

/* ─── Informe ──────────────────────────────────────────────────── */

console.log(`[verify-dist] ${FICHEROS.length} ficheros en dist/ · ${htmls.length} HTML · ${nRefs} referencias locales comprobadas · ${jsDist.length} .js revisados`);
console.log(`[verify-dist] ${nInline} bloque(s) <script> en línea · ${(bytesInline/1024).toFixed(1)} kB que NO pasan por Terser (se revisan igual)`);
if (BASE) console.log(`[verify-dist] base del despliegue: «${BASE}»`);
console.log(`[verify-dist] modo: ${ES_PROD ? 'producción (se exige drop_console)' : 'desarrollo (console.log permitido)'}`);

for (const a of avisos) console.warn(`[verify-dist] aviso: ${a}`);

if (errores.length) {
  console.error(`\n[verify-dist] ${errores.length} problema(s) — dist/ NO es desplegable:\n`);
  for (const e of errores) console.error(`  · ${e}`);
  console.error('');
  process.exit(1);
}

console.log('[verify-dist] dist/ es desplegable.');
