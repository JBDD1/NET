/* ═══════════════════════════════════════════════════════════════
   FINOVA — MONITORIZACIÓN DE ERRORES (Sentry, navegador)

   Este fichero es un MÓDULO ES, al revés que el resto de src/**: lo carga
   index.html y landing.html con <script type="module">, así que Rollup lo
   empaqueta junto a @sentry/browser. El resto del proyecto son scripts
   clásicos que no pasan por Rollup y no podrían hacer este import.

   Por eso no expone nada por ámbito global: deja una API mínima en
   window.fvMonitor, y los scripts clásicos la llaman SIEMPRE con guarda
   (window.fvMonitor?.capture(...)). Si no hay DSN, si el usuario lo ha
   rechazado o si este módulo no llegó a cargar, la app funciona igual y no se
   envía nada.

   ── La regla de privacidad ──
   Finova es una app de finanzas: un mensaje de error puede llevar dentro un
   importe, un IBAN, un correo o un token. Aquí se parte de que TODO texto que
   sale es sospechoso y se redacta con los patrones de redact-patterns.json
   antes de enviarlo. El mensaje sigue siendo legible; los datos no salen.
═══════════════════════════════════════════════════════════════ */

import * as Sentry from '@sentry/browser';
import REDACT from './redact-patterns.json';

/* ─── Configuración ───────────────────────────────────────────── */

const DSN         = import.meta.env.VITE_SENTRY_DSN || '';
const ENVIRONMENT = import.meta.env.VITE_APP_ENV   || 'development';
// Release: el hash del commit si el CI lo inyecta, si no la versión del
// package.json. Sin release, Sentry agrupa todo junto y no se puede saber si
// un error es nuevo o viene de antes.
const RELEASE     = import.meta.env.VITE_RELEASE || import.meta.env.VITE_APP_VERSION || '1.0.0';

// Clave del interruptor de Ajustes → Privacidad. Se lee de localStorage y no
// de APP porque este módulo corre antes de que exista APP.
const OPT_OUT_KEY = 'finova_error_reports_off';

const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/* ─── Redacción ───────────────────────────────────────────────── */

// Se compilan una vez: un RegExp con flag /g mantiene lastIndex entre usos, así
// que hay que crear instancias nuevas en cada aplicación o se saltan
// coincidencias. Se guarda el patrón en texto y se instancia al usar.
const PATTERNS = (REDACT.patterns || []).map(p => ({
  name: p.name,
  re: p.pattern,
  flags: p.flags || 'g',
  replace: p.replace,
}));

const QUERY_SENSIBLES = new Set((REDACT.queryKeysSensibles || []).map(k => k.toLowerCase()));

/** Redacta una cadena. Devuelve la misma si no hay nada que redactar. */
function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(new RegExp(p.re, p.flags), p.replace);
  }
  return out;
}

/**
 * Quita los parámetros sensibles de una URL y deja el resto.
 * Se conserva la ruta porque dice QUÉ falló; se tira el query porque es donde
 * viajan los uid y los tokens.
 */
function redactUrl(url) {
  if (typeof url !== 'string' || !url) return url;
  try {
    const u = new URL(url, location.origin);
    for (const k of [...u.searchParams.keys()]) {
      if (QUERY_SENSIBLES.has(k.toLowerCase())) u.searchParams.set(k, '[oculto]');
    }
    u.hash = '';
    return u.toString();
  } catch (_) {
    // No era una URL: se redacta como texto normal, por si lleva algo dentro.
    return redact(url);
  }
}

/**
 * Recorre un objeto redactando todas sus cadenas.
 * Profundidad limitada: un evento de Sentry puede traer estructuras grandes y
 * no merece la pena recorrerlas enteras en el hilo principal.
 */
function redactDeep(value, depth = 0) {
  if (depth > 6) return value;
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(v => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, depth + 1);
    return out;
  }
  return value;
}

/* ─── Limpieza del evento antes de enviarlo ───────────────────── */

function beforeSend(event) {
  // 1. Fuera todo lo que describe la PETICIÓN. Aunque HttpContext esté
  //    desactivado, otros caminos pueden rellenarlo.
  if (event.request) {
    const url = event.request.url;
    event.request = url ? { url: redactUrl(url) } : undefined;
  }

  // 2. El usuario: solo el hash del uid, nunca correo, nombre ni IP.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  // 3. Mensaje y excepciones: redactados, pero conservando el tipo de error.
  if (event.message) event.message = redact(event.message);
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redact(ex.value);
      // Los nombres de función y de archivo se dejan: son nuestro código, no
      // datos del usuario, y sin ellos la traza no sirve para nada. Lo que sí
      // se limpia es la URL del archivo, que puede llevar query.
      if (ex.stacktrace?.frames) {
        for (const f of ex.stacktrace.frames) {
          if (f.filename) f.filename = redactUrl(f.filename);
          if (f.abs_path) f.abs_path = redactUrl(f.abs_path);
          // vars: los valores de las variables locales. En una app de finanzas
          // esto es exactamente lo que no puede salir.
          delete f.vars;
          delete f.pre_context;
          delete f.post_context;
          delete f.context_line;
        }
      }
    }
  }

  // 4. Contextos y extras: se redactan en profundidad.
  if (event.contexts) event.contexts = redactDeep(event.contexts);
  if (event.extra)    event.extra    = redactDeep(event.extra);
  if (event.tags)     event.tags     = redactDeep(event.tags);

  // 5. Las migas ya pasaron por beforeBreadcrumb, pero se repasa el mensaje
  //    por si alguna llegó por otra vía.
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map(b => ({
      ...b,
      message: redact(b.message),
      data: b.data ? redactDeep(b.data) : undefined,
    }));
  }

  // 6. Nunca mandar el título de la página ni la URL completa por otra vía.
  if (event.transaction) event.transaction = redactUrl(event.transaction);
  if (event.server_name) delete event.server_name;

  return event;
}

function beforeBreadcrumb(crumb) {
  // Consola: puede llevar cualquier cosa que alguien haya imprimido al
  // depurar. Fuera, aunque la integración Console esté desactivada.
  if (crumb.category === 'console') return null;
  // Clics y teclas: el texto del elemento pulsado puede ser un importe o el
  // nombre de un contacto. Fuera.
  if (crumb.category === 'ui.click' || crumb.category === 'ui.input') return null;

  // Peticiones y navegación: se conservan porque son la pista más útil, pero
  // con las URL limpias.
  if (crumb.data) {
    const d = { ...crumb.data };
    if (d.url)  d.url  = redactUrl(d.url);
    if (d.to)   d.to   = redactUrl(d.to);
    if (d.from) d.from = redactUrl(d.from);
    // El cuerpo de una petición no tiene sitio en una miga.
    delete d.body; delete d.input; delete d.arguments;
    crumb.data = redactDeep(d);
  }
  if (crumb.message) crumb.message = redact(crumb.message);
  return crumb;
}

/* ─── Ruido que no interesa ───────────────────────────────────── */

const IGNORE_ERRORS = [
  // Clásicos de las extensiones del navegador y de los webviews.
  /^ResizeObserver loop/i,
  /^Non-Error promise rejection captured/i,
  'top.GLOBALS',
  /extension context invalidated/i,
  /chrome-extension/i, /moz-extension/i, /safari-extension/i,
  // Estar sin conexión no es un fallo de la app: la PWA está hecha para eso.
  /^Failed to fetch$/i,
  /^NetworkError/i,
  /^Load failed$/i,
  'Network request failed',
  'The Internet connection appears to be offline',
  /AbortError/i,
  // Cancelaciones del usuario, no errores.
  /The play\(\) request was interrupted/i,
  // Firebase: sesión caducada o popup cerrado. Esperados y ya tratados.
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/network-request-failed',
];

const DENY_URLS = [
  /extensions\//i, /^chrome:\/\//i, /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i, /^safari-(web)?extension:\/\//i,
  // Scripts de terceros: sus errores no los podemos arreglar y llenarían el
  // panel de ruido.
  /googletagmanager\.com/i, /google-analytics\.com/i,
  /cdn\.jsdelivr\.net/i, /cdnjs\.cloudflare\.com/i,
];

/* ─── Arranque ────────────────────────────────────────────────── */

let _enabled = false;

function userOptedOut() {
  try { return localStorage.getItem(OPT_OUT_KEY) === '1'; } catch (_) { return false; }
}

function start() {
  // Cuatro razones para no arrancar. Cualquiera de ellas y no se envía nada.
  if (!DSN) return;                 // sin configurar: la app funciona igual
  if (IS_LOCAL) return;             // en desarrollo los errores se ven en la consola
  if (userOptedOut()) return;       // el usuario lo ha desactivado en Ajustes
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,

    // Nada de PII automática: ni IP, ni cookies, ni cabeceras.
    sendDefaultPii: false,

    // Trazas de rendimiento desactivadas. No son el objetivo del lanzamiento
    // y cada traza lleva URL y tiempos de cada petición.
    tracesSampleRate: 0,

    // Migas: pocas y limpias. 10 bastan para saber qué pasó justo antes.
    maxBreadcrumbs: 10,

    integrations: (defaults) => {
      // Se quitan por nombre, no se construye la lista a mano: así, si una
      // versión nueva de Sentry añade una integración, entra sola y solo hay
      // que decidir si estorba.
      const FUERA = new Set([
        // Captura console.* como migas y como logs. Puede llevar cualquier cosa.
        'Console',
        // Añade al evento la URL completa, las cabeceras y el user agent como
        // "request data". Es justo lo que el encargo pedía quitar.
        'HttpContext',
        // No sé qué envía exactamente (es nueva en v11) y no voy a enviar algo
        // que no puedo describir en la política de privacidad.
        'ConversationId',
      ]);
      const out = defaults.filter(i => !FUERA.has(i.name));

      // Breadcrumbs se SUSTITUYE por una versión configurada en vez de
      // quitarse: las migas de fetch y de navegación son la pista más útil
      // para reproducir un fallo, y las de consola y de clic son las que
      // filtran texto.
      const i = out.findIndex(x => x.name === 'Breadcrumbs');
      const configurada = Sentry.breadcrumbsIntegration({
        console: false,   // sin migas de consola
        dom: false,       // sin migas de clic ni de teclado
        fetch: true,
        xhr: true,
        history: true,
        sentry: true,
      });
      if (i >= 0) out[i] = configurada; else out.push(configurada);

      return out;
    },

    // SIN Session Replay: no se añade replayIntegration en ningún caso. Graba
    // la pantalla del usuario, y en esta app la pantalla ES el dato sensible.

    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,

    beforeSend,
    beforeBreadcrumb,
  });

  _enabled = true;

  // Los errores que ocurrieron ANTES de que esto cargara están en el buffer en
  // memoria de utils.js. Se reenvían para no perder justo los de arranque, que
  // son los más difíciles de reproducir.
  //
  // Se espera a DOMContentLoaded y no se hace aquí mismo porque este módulo se
  // carga a propósito ANTES de los scripts clásicos (para que Sentry capture
  // cuanto antes), y en ese momento fvRecentErrors todavía no existe.
  // DOMContentLoaded es exactamente el punto en que todos los defer han
  // terminado.
  const replay = () => {
    try {
      const previos = typeof window.fvRecentErrors === 'function' ? window.fvRecentErrors() : [];
      for (const e of previos.slice(0, 5)) {
        Sentry.captureMessage(redact('[previo] ' + (e.message || '?')), {
          level: 'error',
          tags: { fase: 'antes-de-sentry', tipo: e.kind || '?' },
          extra: { archivo: e.file || '', linea: e.line || 0 },
        });
      }
    } catch (_) { /* nunca romper el arranque por esto */ }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', replay, { once: true });
  } else {
    replay();
  }
}

/* ─── API para los scripts clásicos ───────────────────────────── */

const fvMonitor = {
  /** ¿Está enviando? Lo usa Ajustes para decir el estado real. */
  get enabled() { return _enabled; },

  /**
   * Captura una excepción con una etiqueta de dónde ocurrió.
   * @param {Error|any} err
   * @param {string} where  p.ej. 'import-csv', 'fiscal', 'sync', 'ia'
   * @param {object} [extra] solo valores no sensibles; se redactan igual
   */
  capture(err, where, extra) {
    if (!_enabled) return;
    try {
      Sentry.withScope(scope => {
        if (where) scope.setTag('donde', String(where).slice(0, 40));
        if (extra) scope.setContext('detalle', redactDeep(extra));
        Sentry.captureException(err instanceof Error ? err : new Error(redact(String(err))));
      });
    } catch (_) { /* la monitorización nunca puede romper la app */ }
  },

  /** Mensaje sin excepción, para condiciones anómalas que no lanzan. */
  message(msg, where, level) {
    if (!_enabled) return;
    try {
      Sentry.withScope(scope => {
        if (where) scope.setTag('donde', String(where).slice(0, 40));
        Sentry.captureMessage(redact(String(msg)), level || 'warning');
      });
    } catch (_) {}
  },

  /**
   * Identifica al usuario SOLO con un hash del uid. Nunca correo ni nombre.
   * El hash se calcula aquí, en el navegador: el uid en claro no sale nunca.
   */
  async setUser(uid) {
    if (!_enabled) return;
    try {
      if (!uid) { Sentry.setUser(null); return; }
      const buf = new TextEncoder().encode('finova-monitor:' + uid);
      const dig = await crypto.subtle.digest('SHA-256', buf);
      const hex = [...new Uint8Array(dig)].map(b => b.toString(16).padStart(2, '0')).join('');
      Sentry.setUser({ id: hex.slice(0, 16) });
    } catch (_) { /* sin crypto.subtle: mejor sin usuario que con el uid */ }
  },

  /** Deja de enviar y lo recuerda. Lo llama el interruptor de Ajustes. */
  optOut() {
    try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch (_) {}
    _enabled = false;
    try { Sentry.getClient()?.getOptions && (Sentry.getClient().getOptions().enabled = false); } catch (_) {}
  },

  /** Vuelve a enviar. Requiere recargar para inicializar el SDK. */
  optIn() {
    try { localStorage.removeItem(OPT_OUT_KEY); } catch (_) {}
  },

  get optedOut() { return userOptedOut(); },

  /** Para la función de prueba de Ajustes (solo admin). */
  _testError() {
    const err = new Error('Error de prueba de Finova — 1.234,56 € para carlos@ejemplo.com');
    this.capture(err, 'prueba-monitorizacion');
    return 'enviado (si hay DSN configurado)';
  },

  // Expuestas para los tests: son funciones puras.
  _redact: redact,
  _redactUrl: redactUrl,
  _beforeSend: beforeSend,
  _beforeBreadcrumb: beforeBreadcrumb,
};

window.fvMonitor = fvMonitor;

start();
