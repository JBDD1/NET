'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — ANALÍTICA SIN COOKIES

   Script clásico a propósito (no módulo): lo tiene que poder llamar cualquier
   parte de la app, y el resto de src/** son scripts clásicos.

   ── Lo que NUNCA sale de aquí ──
   Ni un importe, ni un saldo, ni un ticker, ni un nombre, ni un correo, ni el
   uid. La función track() tiene DOS listas blancas —nombres de evento y
   nombres de propiedad— y todo lo que no esté en ellas se descarta en
   silencio. No es una recomendación: es el único camino por el que puede
   salir un evento.

   La herramienta concreta se configura por variables de entorno. Si no están,
   no se carga ningún script de terceros y track() no hace nada. Ver
   MONITORING_SETUP.md.
═══════════════════════════════════════════════════════════════ */

// Dominio del script y identificador del sitio. Vacíos = analítica apagada.
// VITE_ANALYTICS_SRC tiene que estar permitido en la CSP (script-src y
// connect-src) de vercel.json y de server.cjs.
const _AN_SRC = import.meta.env.VITE_ANALYTICS_SRC || '';
const _AN_ID  = import.meta.env.VITE_ANALYTICS_ID  || '';
const _AN_ENV = import.meta.env.VITE_APP_ENV       || 'development';

const _AN_OPT_OUT_KEY = 'finova_analytics_off';
const _AN_IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/* ─── Lista blanca de eventos ─────────────────────────────────── */

// Los únicos nombres que se pueden enviar. Añadir uno es una decisión
// consciente, no un efecto secundario de escribir una llamada nueva.
const _AN_EVENTS = new Set([
  'registro_completado',
  'primer_transaccion',
  'primer_activo_cartera',
  'importacion_csv_ok',
  'asesor_ia_usado',
  'informe_pdf_descargado',
  'feedback_enviado',
  'cuenta_borrada',
]);

// Y las únicas propiedades. Fíjate en que ninguna admite una cifra del
// usuario: 'banco' es el nombre del formato detectado (p.ej. "BBVA"), no sus
// movimientos; 'proveedor' es "claude" o "groq", no la pregunta.
const _AN_PROPS = new Set([
  'banco',       // formato de extracto detectado
  'proveedor',   // proveedor de IA usado
  'tipo',        // tipo de informe, de feedback…
  'metodo',      // 'email' | 'google'
  'origen',      // 'app' | 'landing'
]);

// Valores permitidos por propiedad, cuando tiene sentido cerrarlos. Lo que no
// encaje se manda como 'otro': así un valor inesperado no se convierte en una
// fuga por la puerta de atrás.
const _AN_PROP_VALORES = {
  metodo:    new Set(['email', 'google']),
  origen:    new Set(['app', 'landing']),
  proveedor: new Set(['claude', 'openai', 'gemini', 'groq', 'servidor']),
};

const _AN_MAX_VALOR = 40;   // ningún valor de propiedad más largo que esto

/* ─── Estado ──────────────────────────────────────────────────── */

let _anLoaded = false;

function _anOptedOut() {
  try { return localStorage.getItem(_AN_OPT_OUT_KEY) === '1'; } catch (_) { return false; }
}

/** Las cinco razones para no cargar nada. */
function _anAllowed() {
  if (!_AN_SRC || !_AN_ID) return false;                    // sin configurar
  if (_AN_ENV !== 'production') return false;               // solo en producción
  if (_AN_IS_LOCAL) return false;                           // nunca en local
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
  if (navigator.globalPrivacyControl === true) return false; // señal GPC
  if (_anOptedOut()) return false;                           // el usuario lo apagó
  if (typeof _isDemoMode !== 'undefined' && _isDemoMode) return false;
  return true;
}

/**
 * Inyecta el script de la herramienta.
 *
 * Se hace desde JavaScript y no con una etiqueta en el HTML por dos razones:
 * una etiqueta con src vacío (si la variable no está configurada) pediría la
 * propia página, y así se puede comprobar Do Not Track ANTES de cargar nada de
 * un tercero.
 */
function _anLoad() {
  if (_anLoaded || !_anAllowed()) return;
  _anLoaded = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = _AN_SRC;
  // Umami lee el identificador de este atributo. Si cambias de herramienta,
  // esto es lo único que hay que tocar aquí (ver MONITORING_SETUP.md).
  s.setAttribute('data-website-id', _AN_ID);
  // Sin cookies ni almacenamiento del lado del cliente para identificar.
  s.setAttribute('data-do-not-track', 'true');
  s.onerror = () => { _anLoaded = false; };
  document.head.appendChild(s);
}

/* ─── La única puerta de salida ───────────────────────────────── */

/**
 * Envía un evento, si está permitido.
 *
 * @param {string} event  tiene que estar en _AN_EVENTS
 * @param {object} [props] solo claves de _AN_PROPS; el resto se descarta
 * @returns {boolean} si se envió
 */
function track(event, props) {
  if (!_anAllowed()) return false;

  // Nombre no reconocido: no se envía. Mejor perder un evento que mandar algo
  // que nadie ha revisado.
  if (!_AN_EVENTS.has(event)) return false;

  let limpias;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    limpias = {};
    for (const [k, v] of Object.entries(props)) {
      if (!_AN_PROPS.has(k)) continue;                 // propiedad no permitida
      if (v == null) continue;
      // Nada de números: un número es lo único que puede ser un importe.
      if (typeof v === 'number') continue;
      let val = String(v).slice(0, _AN_MAX_VALOR);
      const permitidos = _AN_PROP_VALORES[k];
      if (permitidos && !permitidos.has(val)) val = 'otro';
      // Por si acaso: si el valor tiene pinta de cifra, fuera.
      if (/\d{3,}|[.,]\d{2}\b|€/.test(val)) continue;
      limpias[k] = val;
    }
    if (!Object.keys(limpias).length) limpias = undefined;
  }

  try {
    if (window.umami && typeof window.umami.track === 'function') {
      limpias ? window.umami.track(event, limpias) : window.umami.track(event);
      return true;
    }
    // Plausible, por si se cambia de herramienta: misma llamada, otra forma.
    if (typeof window.plausible === 'function') {
      window.plausible(event, limpias ? { props: limpias } : undefined);
      return true;
    }
  } catch (_) { /* la analítica nunca puede romper nada */ }
  return false;
}

/** Apaga la analítica y lo recuerda. Lo llama el interruptor de Ajustes. */
function analyticsOptOut() {
  try { localStorage.setItem(_AN_OPT_OUT_KEY, '1'); } catch (_) {}
}

function analyticsOptIn() {
  try { localStorage.removeItem(_AN_OPT_OUT_KEY); } catch (_) {}
}

function analyticsOptedOut() { return _anOptedOut(); }

/** ¿Está activa de verdad? Lo usa Ajustes para no mentir sobre el estado. */
function analyticsActive() { return _anAllowed() && _anLoaded; }

// Se carga al final del arranque, no al evaluar este fichero: así no compite
// con el render de la app por el ancho de banda.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _anLoad, { once: true });
  } else {
    _anLoad();
  }
}
