'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — AUTH COMPARTIDO

   En el proyecto conviven DOS sistemas de autenticación:
   · src/auth/auth.js  — dentro de la app (index.html)
   · landing.js        — en la landing (landing.html)

   landing.html no carga nada de src/, así que hasta ahora cada uno tenía su
   propio mapa de errores y los dos iban divergiendo: uno traducía 18 códigos
   y el otro 12, con textos distintos para el mismo error. Este fichero es la
   pieza que cargan AMBAS páginas para no duplicar nada que importe:
   el mapa de errores, la política de contraseñas y la URL de los enlaces
   de los correos.

   Debe cargarse ANTES de auth.js y de landing.js.
═══════════════════════════════════════════════════════════════ */

/* ─── URL a la que vuelven los enlaces de los correos ─────────── */

// Firebase mete esta URL en los correos de verificación y de restablecimiento
// (actionCodeSettings.url). Tiene que ser un dominio que esté en
// Authentication → Settings → Authorized domains, o Firebase rechaza el envío
// con auth/unauthorized-continue-uri.
//
// Si VITE_APP_URL está vacía se usa location.origin, que es el comportamiento
// más robusto por defecto: el enlace devuelve al usuario al mismo sitio desde
// el que se registró. Conviene fijarla explícitamente cuando haya dominio
// propio, para que los correos apunten siempre al canónico. Ver
// AUTH_EMAIL_SETUP.md.
const FINOVA_APP_URL =
  (import.meta.env?.VITE_APP_URL || '').replace(/\/+$/, '') ||
  (typeof location !== 'undefined' ? location.origin : '');

/**
 * actionCodeSettings para sendEmailVerification y sendPasswordResetEmail.
 * @param {string} path  ruta relativa a la que volver (p.ej. 'index.html')
 */
function fvActionCodeSettings(path) {
  const base = FINOVA_APP_URL || (typeof location !== 'undefined' ? location.origin : '');
  const rel  = String(path || 'index.html').replace(/^\/+/, '');
  return {
    url: base + '/' + rel,
    // false = el enlace se abre en el navegador, no en una app móvil. Finova
    // es una PWA: no hay app nativa a la que redirigir.
    handleCodeInApp: false,
  };
}

/* ─── Mapa ÚNICO de errores de Firebase Auth ──────────────────── */

// Dos reglas que gobiernan estos textos:
//
// 1. Ninguno revela si una cuenta existe. 'user-not-found' y 'wrong-password'
//    dicen EXACTAMENTE lo mismo, porque si no, probar correos en el login es
//    una forma gratuita de averiguar quién está registrado. Antes auth.js
//    respondía "No existe ninguna cuenta con ese correo", que es precisamente
//    la fuga.
// 2. Ninguno muestra el código crudo salvo en el último recurso, y entonces
//    con una frase que el usuario pueda copiar y enviarnos.
const _FV_AUTH_ERRORS = {
  // ── Credenciales (todos el MISMO texto, a propósito) ──
  'auth/user-not-found':             'Correo o contraseña incorrectos.',
  'auth/wrong-password':             'Correo o contraseña incorrectos.',
  'auth/invalid-credential':         'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials':  'Correo o contraseña incorrectos.',

  // ── Formato y campos vacíos ──
  'auth/invalid-email':              'El correo no tiene un formato válido.',
  'auth/missing-email':              'Introduce tu correo electrónico.',
  'auth/missing-password':           'Introduce tu contraseña.',

  // ── Registro ──
  'auth/email-already-in-use':       'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.',
  'auth/weak-password':              'La contraseña es demasiado débil. Usa al menos 8 caracteres, con letras y números.',

  // ── Cuenta ──
  'auth/user-disabled':              'Esta cuenta está desactivada. Escríbenos a MyFinova1@gmail.com si crees que es un error.',
  'auth/user-mismatch':              'Has iniciado sesión con una cuenta distinta a la que intentas confirmar.',
  'auth/requires-recent-login':      'Por seguridad, vuelve a iniciar sesión antes de hacer este cambio.',

  // ── Límites y red ──
  'auth/too-many-requests':          'Demasiados intentos seguidos. Espera unos minutos antes de volver a probar.',
  'auth/network-request-failed':     'Sin conexión. Comprueba tu red y vuelve a intentarlo.',

  // ── Popup de Google ──
  'auth/popup-closed-by-user':       'Has cerrado la ventana de Google sin terminar. Inténtalo de nuevo.',
  'auth/cancelled-popup-request':    'Se ha cancelado el inicio de sesión anterior. Vuelve a pulsar el botón.',
  'auth/popup-blocked':              'El navegador ha bloqueado la ventana de Google. Permite las ventanas emergentes para este sitio.',
  'auth/account-exists-with-different-credential':
    'Ya existe una cuenta con ese correo creada con otro método. Inicia sesión con el que usaste al registrarte.',

  // ── Enlaces de los correos ──
  'auth/expired-action-code':        'El enlace ha caducado. Pide uno nuevo para continuar.',
  'auth/invalid-action-code':        'Este enlace ya no es válido. Puede que lo hayas usado antes o que haya caducado — pide uno nuevo.',

  // ── Configuración (le pasan al desarrollador, no al usuario) ──
  'auth/operation-not-allowed':      'Este método de inicio de sesión no está habilitado. Escríbenos a MyFinova1@gmail.com.',
  'auth/admin-restricted-operation': 'El registro de nuevas cuentas está desactivado temporalmente.',
  'auth/unauthorized-continue-uri':  'No se pudo enviar el correo por un problema de configuración. Escríbenos a MyFinova1@gmail.com.',
};

/**
 * Traduce un código de Firebase Auth a un mensaje en español.
 * Nunca devuelve el código a secas.
 */
function fvAuthErrMsg(code) {
  if (_FV_AUTH_ERRORS[code]) return _FV_AUTH_ERRORS[code];
  // 'auth/unauthorized-domain' depende del hostname, así que se compone aquí
  // en vez de guardarse en el mapa.
  if (code === 'auth/unauthorized-domain') {
    const host = (typeof location !== 'undefined' ? location.hostname : '') || 'este dominio';
    return `El dominio ${host} no está autorizado en Firebase. Si estás en local, entra por http://localhost:3000 (no por 127.0.0.1).`;
  }
  // Último recurso: el usuario necesita algo que podamos identificar si nos
  // escribe, pero no un volcado técnico.
  return `No se ha podido completar la operación. Inténtalo de nuevo o escríbenos a MyFinova1@gmail.com (código: ${code || 'desconocido'}).`;
}

/* ─── Política de contraseñas ─────────────────────────────────── */

// 8 caracteres. Firebase permite 6 por defecto, así que el cliente es MÁS
// estricto que el servidor: eso es seguro, pero conviene subir también el
// mínimo en la consola para que las dos políticas coincidan. Ver
// AUTH_EMAIL_SETUP.md.
const FV_PASSWORD_MIN = 8;

/**
 * Devuelve el motivo por el que una contraseña no vale, o null si vale.
 * Se comprueba en cliente ANTES de llamar a Firebase: así el usuario ve el
 * problema al instante y no gastamos una petición.
 */
function fvPasswordProblem(pwd) {
  const p = String(pwd || '');
  if (!p)                      return 'Introduce una contraseña.';
  if (p.length < FV_PASSWORD_MIN) return `La contraseña debe tener al menos ${FV_PASSWORD_MIN} caracteres.`;
  // Firebase corta en 4096; avisar antes es mejor que un error del servidor.
  if (p.length > 4096)         return 'La contraseña es demasiado larga.';
  if (/^\s+$/.test(p))         return 'La contraseña no puede ser solo espacios.';
  return null;
}

/**
 * Fortaleza orientativa, 0-4. No bloquea nada: es solo información.
 * Deliberadamente simple y sin diccionarios — una librería de 400 KB para
 * esto no se justifica, y un medidor que exagera acaba ignorándose.
 */
function fvPasswordStrength(pwd) {
  const p = String(pwd || '');
  if (!p) return { score: 0, label: '', pct: 0 };

  let score = 0;
  if (p.length >= FV_PASSWORD_MIN) score++;
  if (p.length >= 12)              score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p))                score++;
  if (/[^A-Za-z0-9]/.test(p))      score++;

  // Penalizar lo que un atacante prueba primero, por larga que sea.
  const low = p.toLowerCase();
  const OBVIAS = ['password', 'contrasena', 'contraseña', '12345678', '123456789',
                  'qwerty', 'finova', 'iloveyou', 'admin123'];
  if (OBVIAS.some(o => low.includes(o))) score = Math.min(score, 1);
  if (/^(.)\1+$/.test(p))              score = Math.min(score, 1); // "aaaaaaaa"

  score = Math.max(0, Math.min(4, score));
  const LABELS = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Muy buena'];
  return { score, label: LABELS[score], pct: ((score + 1) / 5) * 100 };
}

/** Validación de formato de correo, suficiente para no gastar una petición. */
function fvIsValidEmail(email) {
  const e = String(email || '').trim();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

/* ─── Utilidades de interfaz compartidas ──────────────────────── */

/** Alterna un campo de contraseña entre visible y oculto. */
function fvTogglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  if (btn) {
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    btn.classList.toggle('is-visible', show);
  }
}

/**
 * Pinta el medidor de fortaleza. Discreto: una barra fina y una palabra, y
 * nada en absoluto mientras el campo está vacío.
 *
 * El texto va en aria-live="polite" (no assertive): es información de apoyo,
 * no un error, y anunciarlo a cada tecla sería insoportable con un lector.
 */
function fvRenderStrength(containerId, pwd) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const { score, label, pct } = fvPasswordStrength(pwd);
  if (!pwd) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'block';
  const COLORS = ['var(--down)', 'var(--down)', 'var(--warn, #d08a2a)', 'var(--up)', 'var(--up)'];
  el.innerHTML =
    '<div class="fv-pw-track" aria-hidden="true">' +
      '<div class="fv-pw-fill" style="width:' + pct + '%;background:' + (COLORS[score] || COLORS[0]) + '"></div>' +
    '</div>' +
    '<span class="fv-pw-label">' + label + '</span>';
}

/* ─── Cuenta atrás para reenviar correos ──────────────────────── */

// 60 s entre envíos. Firebase también limita por su cuenta y devuelve
// auth/too-many-requests, pero su ventana es opaca y el usuario no la ve: sin
// esto, pulsar "Reenviar" tres veces seguidas acaba en un error en vez de en
// un correo, y parece que la app está rota.
const FV_RESEND_COOLDOWN_SEC = 60;

const _fvTimers = {};

/**
 * Deshabilita un botón y le pone una cuenta atrás. Idempotente: volver a
 * llamarla sobre el mismo botón reinicia el contador en vez de acumular
 * intervalos (que es como se duplican los tictacs y el texto empieza a
 * parpadear entre dos valores).
 *
 * @param {HTMLElement} btn
 * @param {string} label  texto del botón cuando vuelve a estar disponible
 * @param {number} secs
 */
function fvStartCooldown(btn, label, secs) {
  if (!btn) return;
  const id = btn.id || ('fv-cd-' + Math.random().toString(36).slice(2));
  btn.id = id;
  if (_fvTimers[id]) { clearInterval(_fvTimers[id]); delete _fvTimers[id]; }

  let left = Math.max(1, Math.floor(secs || FV_RESEND_COOLDOWN_SEC));
  btn.disabled = true;
  btn.textContent = `${label} (${left})`;

  _fvTimers[id] = setInterval(() => {
    left--;
    const live = document.getElementById(id);
    // El botón puede haber desaparecido al cambiar de pantalla: si no se
    // limpia aquí, el intervalo sigue corriendo para siempre.
    if (!live) { clearInterval(_fvTimers[id]); delete _fvTimers[id]; return; }
    if (left <= 0) {
      clearInterval(_fvTimers[id]); delete _fvTimers[id];
      live.disabled = false;
      live.textContent = label;
    } else {
      live.textContent = `${label} (${left})`;
    }
  }, 1000);
}

/** Cancela todas las cuentas atrás vivas (al cambiar de pantalla). */
function fvClearCooldowns() {
  for (const id of Object.keys(_fvTimers)) {
    clearInterval(_fvTimers[id]);
    delete _fvTimers[id];
  }
}
