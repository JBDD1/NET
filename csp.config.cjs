'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — Content-Security-Policy: FUENTE ÚNICA DE VERDAD

   Antes la CSP vivía por duplicado en server.cjs (_CSP) y en vercel.json, y
   ya habían divergido (Umami solo estaba en vercel.json; las APIs de
   cotizaciones/divisas solo en server.cjs). Ahora los dos derivan de este
   único fichero:

     · server.cjs      → const _CSP = require('./csp.config.cjs').buildCSP({...})
     · vercel.json      → el valor de la cabecera lo ESCRIBE
                          scripts/generate-vercel-csp.cjs desde buildCSP()
     · tests/csp-sync   → falla si vercel.json o la cabecera servida dejan de
                          coincidir con buildCSP()

   `DIRECTIVES` es la UNIÓN de todo lo que tenía CUALQUIERA de las dos
   versiones: nada se quita, y por diseño no se puede volver a desincronizar.
═══════════════════════════════════════════════════════════════ */

/**
 * Cada directiva → array de orígenes permitidos. Una directiva con array vacío
 * (p. ej. upgrade-insecure-requests) se emite sin valor.
 * El ORDEN de aquí es el que sale en la cabecera; da igual para el navegador,
 * pero se mantiene estable para que el test de igualdad sea determinista.
 */
const DIRECTIVES = {
  // Por defecto no se permite NADA; cada recurso se habilita explícitamente.
  'default-src': ["'none'"],

  'script-src': [
    "'self'",
    'https://cdn.jsdelivr.net',       // Chart.js (gráficas) por CDN
    'https://cdnjs.cloudflare.com',   // librerías auxiliares por CDN
    'https://www.gstatic.com',        // SDK de Firebase
    'https://apis.google.com',        // Google Sign-In
    'https://cloud.umami.is',         // Umami — analítica sin cookies (script)
  ],

  'style-src': [
    "'self'",
    "'unsafe-inline'",                // estilos en línea de la propia app
    'https://fonts.googleapis.com',   // CSS de Google Fonts
  ],

  'font-src': [
    "'self'",
    'https://fonts.gstatic.com',      // ficheros de fuente de Google Fonts
    'data:',                          // fuentes embebidas como data: URI
  ],

  'img-src': [
    "'self'",
    'data:',                          // imágenes embebidas (iconos, data: URIs)
    'blob:',                          // imágenes generadas en cliente (IndexedDB)
    'https://lh3.googleusercontent.com', // foto de perfil de Google
    'https://jbdd1.github.io',        // iconos/og:image en el dominio provisional
  ],

  'connect-src': [
    "'self'",
    // ── Datos de mercado ──
    'https://query1.finance.yahoo.com',  // cotizaciones (Yahoo Finance)
    'https://query2.finance.yahoo.com',
    'https://open.er-api.com',           // tipos de cambio de divisas
    // ── Proveedores de IA (Asesor) ──
    'https://api.anthropic.com',         // Claude
    'https://api.openai.com',            // ChatGPT
    'https://generativelanguage.googleapis.com', // Gemini
    'https://api.groq.com',              // Groq
    // ── Firebase (Auth + backend) ──
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://www.googleapis.com',
    'https://*.firebaseapp.com',
    'https://*.firebase.com',
    'https://*.firebaseio.com',
    // ── Sentry — envío de informes de error del cliente ──
    // Comodines porque el host de ingesta depende de la región del proyecto
    // (EE. UU. / UE) y del número de organización. Se pueden apretar al host
    // exacto con SENTRY_INGEST_ORIGIN (ver buildCSP más abajo).
    'https://*.ingest.sentry.io',        // Sentry (EE. UU.)
    'https://*.ingest.de.sentry.io',     // Sentry (UE)
    // ── Analítica ──
    'https://cloud.umami.is',            // Umami — envío de eventos de visita
  ],

  'frame-src': [
    'https://*.firebaseapp.com',      // handler de Firebase Auth
    'https://accounts.google.com',    // selector de cuenta de Google
  ],

  'manifest-src': ["'self'"],         // manifest.json de la PWA
  'worker-src': ["'self'"],           // service worker
  'object-src': ["'none'"],           // sin <object>/<embed>/<applet>
  'base-uri': ["'self'"],             // <base> no puede apuntar fuera
  'form-action': ["'self'"],          // los formularios solo envían a sí mismo
  'frame-ancestors': ["'none'"],      // nadie puede meter Finova en un iframe
  'upgrade-insecure-requests': [],    // fuerza https en subrecursos (sin valor)
};

/**
 * Construye el string de la cabecera Content-Security-Policy a partir de
 * DIRECTIVES. Opciones (solo las usa server.cjs; vercel.json y el test usan la
 * versión SIN opciones, que es la canónica):
 *
 *   - sentryIngestOrigin: si se da, SUSTITUYE los comodines de Sentry por ese
 *     host exacto en connect-src (apretar la CSP, nunca ampliarla).
 *   - analyticsOrigin: si se da, AÑADE ese origen a script-src y connect-src
 *     (p. ej. una instancia de Umami autoalojada en otro dominio).
 *
 * Sin opciones, el resultado es exactamente la unión de las dos CSP antiguas.
 */
function buildCSP(opts = {}) {
  const { sentryIngestOrigin, analyticsOrigin } = opts;

  // Copia profunda para no mutar DIRECTIVES.
  const d = {};
  for (const [k, v] of Object.entries(DIRECTIVES)) d[k] = v.slice();

  if (sentryIngestOrigin) {
    const exact = String(sentryIngestOrigin).split(/\s+/).filter(Boolean);
    d['connect-src'] = d['connect-src']
      .filter(o => !/ingest\.(de\.)?sentry\.io/.test(o))
      .concat(exact);
  }

  if (analyticsOrigin) {
    const extra = String(analyticsOrigin).split(/\s+/).filter(Boolean);
    for (const key of ['script-src', 'connect-src']) {
      for (const o of extra) if (!d[key].includes(o)) d[key].push(o);
    }
  }

  return Object.entries(d)
    .map(([name, vals]) => (vals.length ? `${name} ${vals.join(' ')}` : name))
    .join('; ');
}

module.exports = { DIRECTIVES, buildCSP };
