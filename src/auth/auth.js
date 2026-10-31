/*
 * ─────────────────────────────────────────────────────────────────
 *  FINOVA — Módulo de Autenticación (Firebase Auth)
 *
 *  SETUP (una sola vez):
 *  1. Ve a https://console.firebase.google.com
 *  2. Crea un proyecto (ej: "finova-app")
 *  3. Authentication → Sign-in method → habilita "Email/Contraseña" y "Google"
 *  4. Project Settings (⚙) → Your apps → Add app (web) → copia el firebaseConfig
 *  5. Pega aquí los valores de tu config (reemplaza los PASTE_YOUR_... de abajo)
 *  6. En Authentication → Settings → Authorized domains → añade tu dominio si lo deploys
 * ─────────────────────────────────────────────────────────────────
 */

const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || '',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || '',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || '',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '',
};

// ─── Correos con rol administrador ───────────────────────────────
// La lista maestra se gestiona server-side con FINOVA_ADMIN_EMAILS.
// Esta lista solo controla el badge de admin en el cliente.
const ADMIN_EMAILS = ['MyFinova1@gmail.com'];

// ─── Correos con el panel de monitorización de desarrollo ─────────
// Solo en local (ver DEV_HOSTNAME_RE más abajo) y solo para estos correos —
// nunca se carga en producción ni para el resto de usuarios. Lista aparte de
// ADMIN_EMAILS a propósito: no todo admin tiene por qué querer este panel, y
// mañana puede haber más de una persona depurando sin que eso implique rol admin.
const DEV_MONITOR_EMAILS = ['myfinova1@gmail.com'];
const DEV_HOSTNAME_RE = /^(localhost|127\.0\.0\.1)$/;

// ─── Estado interno ───────────────────────────────────────────────
let _fbAuth          = null;
let _appInitialized  = false;
let _loginMode       = 'signin'; // 'signin' | 'signup' | 'reset' | 'verify'
// createUserWithEmailAndPassword dispara onAuthStateChanged de inmediato. Sin
// esta bandera, el listener metía al recién registrado directo en la app y la
// pantalla "Revisa tu correo" no llegaba a verse nunca.
let _signupPendingVerify = false;
let _pendingPhoto    = null;     // foto pendiente de confirmar en el modal

// ─── Punto de entrada ─────────────────────────────────────────────
async function initAuth() {
  // Firebase Auth solo acepta 'localhost', no la IP 127.0.0.1
  if (location.hostname === '127.0.0.1') {
    location.replace(`http://localhost:${location.port || 3000}${location.pathname}${location.search}`);
    return;
  }

  // El modo demo siempre saltea la autenticación
  if (new URLSearchParams(location.search).has('demo')) {
    return init();
  }

  // Si Firebase no está configurado → modo local sin auth
  if (!FIREBASE_CONFIG.apiKey) {
    console.warn(
      '[Finova Auth] Firebase no configurado.\n' +
      'Edita src/auth/auth.js y pega tu firebaseConfig para activar el login.\n' +
      'Mientras tanto la app funciona en modo local (sin autenticación).'
    );
    return init();
  }

  console.log('[Finova Auth] Iniciando desde:', location.origin, '| hostname:', location.hostname);

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    _fbAuth = firebase.auth();
    _fbAuth.languageCode = 'es';
    // Permite que el SDK use cookies de terceros en desarrollo local
    _fbAuth.settings = _fbAuth.settings || {};

    _fbAuth.onAuthStateChanged(async user => {
      if (!user) {
        _showLoginScreen();
        return;
      }

      // Configurar estado de usuario en APP
      APP.uid       = user.uid;
      APP.userEmail = user.email || '';
      APP.userName  = APP.userName || user.displayName || '';
      APP.userPhoto = user.photoURL || '';
      // Los usuarios de Google llegan ya verificados por Google.
      APP.emailVerified = !!user.emailVerified;
      APP.isAdmin   = ADMIN_EMAILS.some(e => e.toLowerCase() === (user.email || '').toLowerCase());

      _maybeStartDevMonitor(user.email);

      // Persistir último UID para que el boot-script lea el tema correcto
      try { localStorage.setItem('finova_last_uid', user.uid); } catch (_) {}

      // Guardar metadatos en servidor (email, nombre, último acceso)
      _saveUserMeta(user.uid, user.email, user.displayName);

      // Cargar datos del servidor si no hay datos locales para este UID
      await _loadUserDataFromServer(user.uid);

      // Acaba de registrarse y aún no ha verificado: se le enseña "Revisa tu
      // correo" en vez de entrar directo. No es un muro — desde ahí puede
      // seguir a la app, que es la política acordada: explorar sí, gastar
      // dinero o subir datos al servidor no (ver fvVerifiedOrWarn).
      // _signupPendingVerify cubre el registro hecho DENTRO de la app.
      // ?verify=1 cubre el hecho en la landing, que llega aquí como una carga
      // de página nueva: la bandera no sobrevive a la navegación.
      const _wantsVerify = _signupPendingVerify ||
        new URLSearchParams(location.search).get('verify') === '1';
      if (_wantsVerify && !user.emailVerified) {
        _signupPendingVerify = false;
        // Se consume para que un F5 no reabra la pantalla si el usuario ya
        // eligió seguir explorando.
        try { history.replaceState({}, '', location.pathname); } catch (_) {}
        _showVerifyScreen(user.email || '');
        return;
      }
      // Verificado ya (o es de Google): si venía con ?verify=1 se limpia igual,
      // para que el parámetro no quede pegado en la barra de direcciones.
      if (_wantsVerify) {
        _signupPendingVerify = false;
        try { history.replaceState({}, '', location.pathname); } catch (_) {}
      }

      if (!_appInitialized) {
        await _enterApp();
      } else {
        // Re-login con usuario diferente en la misma pestaña → recarga limpia
        location.reload();
      }
    });
  } catch (err) {
    console.error('[Finova Auth] Error al inicializar Firebase:', err);
    init(); // fallback sin auth
  }
}

// Arranque de la app tras autenticarse. Extraído del listener porque la
// pantalla de verificación también necesita entrar por aquí cuando el usuario
// elige "Explorar la app mientras tanto".
async function _enterApp() {
  if (_appInitialized) return;
  _appInitialized = true;
  _hideLoginScreen();
  // init() oculta #app-loading en su ÚLTIMA línea. Si revienta antes (datos
  // corruptos en localStorage, una sección que falla al pintar), el spinner se
  // queda fijo a z-index 9999 tapando la app entera y el usuario ve un
  // "cargando" eterno tras iniciar sesión. Quien llama a esto es un listener
  // async de onAuthStateChanged, y nada recoge su rechazo, así que se captura
  // aquí dentro.
  try {
    await init();
    _injectAuthUI();
  } catch (err) {
    console.error('[Finova Auth] Fallo al arrancar la app:', err);
    const loading = document.getElementById('app-loading');
    if (loading) loading.classList.add('hidden');
    if (typeof showToast === 'function') {
      showToast('No se pudo cargar la app. Recarga la página.', 'error');
    }
  }
}

// ─── Panel de monitorización de desarrollo (errores + métricas reales) ───
// Carga perezosa (nunca entra en el bundle de nadie más) y solo si se cumplen
// AMBAS condiciones: estamos en local Y el usuario logueado es uno de
// DEV_MONITOR_EMAILS. _LAZY_SCRIPTS/_lazyLoad vienen de utils.js, cargado
// antes que este archivo (ver orden de <script> en index.html).
function _maybeStartDevMonitor(email) {
  if (!DEV_HOSTNAME_RE.test(location.hostname)) return;
  if (!DEV_MONITOR_EMAILS.includes((email || '').toLowerCase())) return;
  if (typeof _lazyLoad !== 'function' || !_LAZY_SCRIPTS?.devMonitor) return;
  _lazyLoad(_LAZY_SCRIPTS.devMonitor)
    .then(() => { if (typeof initDevMonitor === 'function') initDevMonitor(); })
    .catch(err => console.warn('[Finova DevMonitor] No se pudo cargar:', err));
}

// ─── Helper global: header de autorización Firebase ──────────
// Accesible desde cualquier script clásico de la página.
async function _getAuthHeader() {
  try {
    const auth = (typeof _fbAuth !== 'undefined' && _fbAuth) ? _fbAuth
               : (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null);
    const user = auth?.currentUser;
    if (!user) return {};
    const token = await user.getIdToken(false); // false = no forzar refresh innecesario
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  } catch (_) { return {}; }
}

// ─── Guarda metadatos en servidor ────────────────────────────
async function _saveUserMeta(uid, email, displayName) {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    let token = '';
    try { token = await _fbAuth?.currentUser?.getIdToken() || ''; } catch (_) {}
    fetch('/api/user-meta', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ uid, email: email || '', displayName: displayName || '' }),
    }).catch(() => {});
  } catch (_) {}
}

// ─── Carga datos del servidor al primer login ─────────────────────
async function _loadUserDataFromServer(uid) {
  const key = `finova_${uid}_data_v1`;
  if (localStorage.getItem(key)) return; // ya hay datos locales para este UID
  try {
    let token = '';
    try { token = await _fbAuth?.currentUser?.getIdToken() || ''; } catch (_) {}
    const res  = await fetch(`/api/user-data?uid=${encodeURIComponent(uid)}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    if (json?.ok && json?.data) {
      localStorage.setItem(key, json.data);
    }
  } catch (_) {}
}

// ─── Login screen ─────────────────────────────────────────────────
function _showLoginScreen() {
  const loading = document.getElementById('app-loading');
  const login   = document.getElementById('login-screen');
  const main    = document.getElementById('mainContent');
  if (loading) loading.classList.add('hidden');
  if (login)   login.style.display = 'flex';
  // login-screen (role="main") es un overlay fixed que cubre <main>, pero
  // <main> sigue en el DOM sin aria-hidden ni display:none: con Tab, el
  // foco de teclado podía colarse detrás del overlay hacia contenido
  // invisible, y un lector de pantalla encontraba DOS landmarks "main"
  // simultáneos. inert lo sacan del árbol de accesibilidad y del orden de
  // tabulación a la vez (soportado en Safari 15.5+/Chrome 102+/Firefox 112+).
  if (main) main.inert = true;
  // ?signup=1 — llega desde el banner de modo demo ("Crear cuenta gratis")
  // y desde el CTA de la landing: abre directamente el formulario de
  // registro en vez del de inicio de sesión, para no obligar a un visitante
  // que ya decidió registrarse a elegir "¿No tienes cuenta?" él mismo. Solo
  // se consume la PRIMERA vez (history.replaceState) para que un F5
  // posterior no reabra siempre en modo registro si el usuario ya cambió
  // a "Iniciar sesión" manualmente.
  if (new URLSearchParams(location.search).get('signup') === '1') {
    _loginMode = 'signup';
    history.replaceState({}, '', location.pathname);
  }
  _renderLoginForm(_loginMode);
}

function _hideLoginScreen() {
  const login   = document.getElementById('login-screen');
  const loading = document.getElementById('app-loading');
  const main    = document.getElementById('mainContent');
  if (login)   login.style.display = 'none';
  if (loading) loading.classList.remove('hidden');
  if (main)    main.inert = false;
}

// ─── Renderiza el formulario de login / registro ──────────────────
function _renderLoginForm(mode) {
  // Si venía una cuenta atrás de reenvío, su botón está a punto de
  // desaparecer: el intervalo se limpia solo al no encontrarlo, pero dejarlo
  // corriendo hasta 60 s sin necesidad no tiene sentido.
  fvClearCooldowns();
  _loginMode = mode;
  const container = document.getElementById('login-form-container');
  if (!container) return;

  if (mode === 'signin') {
    container.innerHTML = `
      <div class="login-field">
        <label class="login-label" for="login-email">Correo electrónico</label>
        <input type="email" id="login-email" class="login-input"
          placeholder="tu@correo.com" autocomplete="email"
          onkeydown="if(event.key==='Enter')_submitLogin()" />
      </div>
      <div class="login-field">
        <label class="login-label" for="login-password">Contraseña</label>
        <div class="fv-pw-wrap">
          <input type="password" id="login-password" class="login-input"
            placeholder="••••••••" autocomplete="current-password"
            onkeydown="if(event.key==='Enter')_submitLogin()" />
          <button type="button" class="fv-pw-toggle" aria-pressed="false"
            aria-label="Mostrar contraseña"
            onclick="fvTogglePassword('login-password', this)"><svg class="icon fv-pw-eye" aria-hidden="true"><use href="#icon-eye"/></svg><svg class="icon fv-pw-eye-off" aria-hidden="true"><use href="#icon-eye-off"/></svg></button>
        </div>
      </div>
      <div id="login-error" class="login-msg" role="alert" aria-live="assertive" style="display:none"></div>
      <button type="button" class="login-btn-primary" id="login-submit-btn"
        onclick="_submitLogin()">Iniciar sesión</button>
      <button type="button" class="login-forgot" onclick="_renderResetForm()">
        ¿Has olvidado tu contraseña?
      </button>`;
  } else {
    container.innerHTML = `
      <div class="login-field">
        <label class="login-label" for="login-name">Tu nombre</label>
        <input type="text" id="login-name" class="login-input"
          placeholder="Nombre (opcional)" autocomplete="name"
          onkeydown="if(event.key==='Enter')_submitLogin()" />
      </div>
      <div class="login-field">
        <label class="login-label" for="login-email">Correo electrónico</label>
        <input type="email" id="login-email" class="login-input"
          placeholder="tu@correo.com" autocomplete="email"
          onkeydown="if(event.key==='Enter')_submitLogin()" />
      </div>
      <div class="login-field">
        <label class="login-label" for="login-password">Contraseña</label>
        <div class="fv-pw-wrap">
          <input type="password" id="login-password" class="login-input"
            placeholder="Mínimo ${FV_PASSWORD_MIN} caracteres" autocomplete="new-password"
            aria-describedby="login-pw-meter"
            oninput="fvRenderStrength('login-pw-meter', this.value)"
            onkeydown="if(event.key==='Enter')_submitLogin()" />
          <button type="button" class="fv-pw-toggle" aria-pressed="false"
            aria-label="Mostrar contraseña"
            onclick="fvTogglePassword('login-password', this)"><svg class="icon fv-pw-eye" aria-hidden="true"><use href="#icon-eye"/></svg><svg class="icon fv-pw-eye-off" aria-hidden="true"><use href="#icon-eye-off"/></svg></button>
        </div>
        <div id="login-pw-meter" class="fv-pw-meter" aria-live="polite" style="display:none"></div>
      </div>
      <div id="login-error" class="login-msg" role="alert" aria-live="assertive" style="display:none"></div>
      <button type="button" class="login-btn-primary" id="login-submit-btn"
        onclick="_submitLogin()">Crear cuenta</button>`;
  }

  setTimeout(() => {
    const first = container.querySelector('input');
    if (first) first.focus();
  }, 80);
}

function _submitLogin() {
  const email    = document.getElementById('login-email')?.value.trim();
  const password = document.getElementById('login-password')?.value;
  const name     = document.getElementById('login-name')?.value.trim() || '';
  if (!email || !password) return _showLoginMsg('Introduce tu correo y contraseña.', 'error');
  if (!fvIsValidEmail(email)) return _showLoginMsg('El correo no tiene un formato válido.', 'error');

  // La contraseña se valida en cliente SOLO al registrarse. En el inicio de
  // sesión no: una cuenta antigua puede tener 6 caracteres, y rechazarla aquí
  // dejaría a su dueño fuera de su propia cuenta.
  if (_loginMode === 'signup') {
    const problem = fvPasswordProblem(password);
    if (problem) return _showLoginMsg(problem, 'error');
    signUpEmail(email, password, name);
  } else {
    signInEmail(email, password);
  }
}

function _setLoginLoading(loading) {
  const btn = document.getElementById('login-submit-btn');
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? 'Cargando…'
    : (_loginMode === 'signup' ? 'Crear cuenta' : 'Iniciar sesión');
}

function _showLoginMsg(msg, type = 'error') {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent   = msg;
  el.style.display = 'block';
  el.className     = type === 'success' ? 'login-msg login-msg--ok' : 'login-msg login-msg--err';
}

// ─── Autenticación ────────────────────────────────────────────────
async function signInEmail(email, password) {
  _setLoginLoading(true);
  try {
    await _fbAuth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    console.error('[Finova Auth] signInEmail error:', err.code, err.message);
    _setLoginLoading(false);
    _showLoginMsg(_authErrMsg(err.code));
  }
}

async function signUpEmail(email, password, name) {
  const _pwProblem = fvPasswordProblem(password);
  if (_pwProblem) return _showLoginMsg(_pwProblem, 'error');
  _setLoginLoading(true);
  try {
    // createUserWithEmailAndPassword dispara onAuthStateChanged DE INMEDIATO,
    // y en ese momento user.displayName todavía es null porque updateProfile
    // no ha corrido: APP.userName se quedaba vacío y la app mostraba el
    // trozo del correo en vez del nombre recién escrito. Se fija aquí, antes
    // de llamar a updateProfile, para que el listener ya lo encuentre puesto
    // (usa `APP.userName || …`, así que respeta este valor).
    // El registro desde la landing no tenía el fallo porque encadena
    // updateProfile ANTES de navegar a index.html.
    if (name) APP.userName = name;
    // Se marca ANTES de crear la cuenta: el listener se dispara dentro de la
    // llamada de abajo, así que si se pusiera después ya habría pasado.
    _signupPendingVerify = true;
    const cred = await _fbAuth.createUserWithEmailAndPassword(email, password);
    if (name) {
      await cred.user.updateProfile({ displayName: name });
      // Si la UI ya se pintó con el listener, se refresca con el nombre bueno.
      if (typeof _injectAuthUI === 'function' && _appInitialized) _injectAuthUI();
    }
    // El correo de verificación va DESPUÉS de updateProfile para que la
    // plantilla pueda usar %DISPLAY_NAME%. Si falla el envío, la cuenta ya
    // existe: no se deshace nada, se avisa y se ofrece reenviar.
    try {
      await cred.user.sendEmailVerification(fvActionCodeSettings('index.html'));
    } catch (e) {
      _verifySendError = fvAuthErrMsg(e?.code);
    }
  } catch (err) {
    // Si la creación falla (correo ya en uso, red, contraseña débil…) hay que
    // DESHACER el nombre puesto arriba: si no, queda pegado en APP y, al
    // iniciar sesión después con otra cuenta, se mostraría ese nombre ajeno
    // (onAuthStateChanged hace `APP.userName || …`, así que lo respetaría).
    if (name && APP.userName === name) APP.userName = '';
    _signupPendingVerify = false;
    console.error('[Finova Auth] signUpEmail error:', err.code, err.message);
    _setLoginLoading(false);
    _showLoginMsg(_authErrMsg(err.code));
  }
}

async function signInGoogle() {
  _setLoginLoading(true);
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await _fbAuth.signInWithPopup(provider);
  } catch (err) {
    console.error('[Finova Auth] signInGoogle error:', err.code, err.message);
    _setLoginLoading(false);
    if (err.code !== 'auth/popup-closed-by-user') _showLoginMsg(_authErrMsg(err.code));
  }
}

// Mensaje ÚNICO del restablecimiento, pase lo que pase. Decir "no existe esa
// cuenta" convierte el formulario en un comprobador de quién está registrado.
const _RESET_GENERIC_MSG =
  'Si existe una cuenta con ese correo, te hemos enviado un enlace para restablecer la contraseña. Revisa también la carpeta de spam.';

function _renderResetForm() {
  fvClearCooldowns();
  _loginMode = 'reset';
  const container = document.getElementById('login-form-container');
  if (!container) return;

  // Si venía escrito en el login, se arrastra para no obligar a teclearlo otra vez.
  const prefill = document.getElementById('login-email')?.value || '';

  container.innerHTML = `
    <p class="login-hint" style="margin:0 0 14px;font-size:13px;color:var(--text-muted);line-height:1.55">
      Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.
    </p>
    <div class="login-field">
      <label class="login-label" for="reset-email">Correo electrónico</label>
      <input type="email" id="reset-email" class="login-input"
        placeholder="tu@correo.com" autocomplete="email"
        value="${String(prefill).replace(/"/g, '&quot;')}"
        onkeydown="if(event.key==='Enter')_submitPasswordReset()" />
    </div>
    <div id="login-error" class="login-msg" role="alert" aria-live="assertive" style="display:none"></div>
    <button type="button" class="login-btn-primary" id="reset-submit-btn"
      onclick="_submitPasswordReset()">Enviar enlace</button>
    <button type="button" class="login-forgot" onclick="_renderLoginForm('signin')">
      ← Volver a iniciar sesión
    </button>`;

  setTimeout(() => document.getElementById('reset-email')?.focus(), 80);
}

async function _submitPasswordReset() {
  const input = document.getElementById('reset-email');
  const email = (input?.value || '').trim();
  const btn   = document.getElementById('reset-submit-btn');

  if (!email)                 return _showLoginMsg('Introduce tu correo electrónico.', 'error');
  if (!fvIsValidEmail(email)) return _showLoginMsg('El correo no tiene un formato válido.', 'error');

  if (!navigator.onLine) {
    return _showLoginMsg('Sin conexión. Comprueba tu red y vuelve a intentarlo.', 'error');
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    await _fbAuth.sendPasswordResetEmail(email, fvActionCodeSettings('index.html'));
  } catch (err) {
    // auth/user-not-found NO se distingue: el mensaje de éxito se muestra
    // igual. Solo se separan los errores que no filtran nada y que el usuario
    // necesita para actuar (límite de intentos, red).
    if (err?.code === 'auth/too-many-requests' || err?.code === 'auth/network-request-failed') {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar enlace'; }
      return _showLoginMsg(fvAuthErrMsg(err.code), 'error');
    }
    // El resto se traga a propósito: lo que vea el usuario es el mismo
    // mensaje genérico que si hubiera funcionado.
  }
  _showLoginMsg(_RESET_GENERIC_MSG, 'success');
  // Cuenta atrás de 60 s antes de poder reenviar.
  if (btn) fvStartCooldown(btn, 'Enviar de nuevo', FV_RESEND_COOLDOWN_SEC);
}

// Compatibilidad: el nombre antiguo sigue existiendo por si algo lo llama.
async function sendPasswordReset(email) {
  _renderResetForm();
  const input = document.getElementById('reset-email');
  if (input && email) input.value = email;
}

/* ─── Pantalla "Revisa tu correo" ──────────────────────────────── */

// Si el envío del correo de verificación falló durante el registro, el motivo
// se guarda aquí para enseñarlo en la pantalla en vez de perderlo.
let _verifySendError = '';

function _showVerifyScreen(email) {
  fvClearCooldowns();
  _loginMode = 'verify';

  // La pantalla de login puede estar oculta si el registro vino de la landing.
  const login   = document.getElementById('login-screen');
  const loading = document.getElementById('app-loading');
  const main    = document.getElementById('mainContent');
  if (loading) loading.classList.add('hidden');
  if (login)   login.style.display = 'flex';
  if (main)    main.inert = true;

  const container = document.getElementById('login-form-container');
  if (!container) return;

  // Las pestañas Iniciar sesión / Registrarse no tienen sentido aquí.
  const tabs = document.querySelector('.login-tabs');
  if (tabs) tabs.style.display = 'none';
  const divider = document.querySelector('.login-divider');
  if (divider) divider.style.display = 'none';
  const gbtn = document.querySelector('.login-btn-google');
  if (gbtn) gbtn.style.display = 'none';

  const safeEmail = typeof escapeHtml === 'function'
    ? escapeHtml(email)
    : String(email).replace(/[<>&"]/g, '');

  container.innerHTML = `
    <h2 style="margin:0 0 10px;font-size:18px;font-weight:600">Revisa tu correo</h2>
    <p style="margin:0 0 4px;font-size:14px;color:var(--text-secondary);line-height:1.6">
      Hemos enviado un enlace de verificación a
    </p>
    <p style="margin:0 0 14px;font-size:14px" class="fv-verify-mail">${safeEmail}</p>

    <div class="fv-verify-note">
      Si no lo ves en unos minutos, mira en <strong>spam</strong> o en
      <strong>correo no deseado</strong>: al ser el primer correo que te
      enviamos, es donde suele acabar.
    </div>

    <div id="login-error" class="login-msg" role="alert" aria-live="assertive" style="display:none"></div>

    <div class="fv-verify-actions">
      <button type="button" class="login-btn-primary" id="verify-check-btn"
        onclick="_verifyCheckNow()">Ya lo he verificado</button>
      <button type="button" class="btn-secondary" id="verify-resend-btn"
        onclick="_verifyResend()">Reenviar correo</button>
    </div>

    <div class="fv-verify-links">
      <button type="button" onclick="_verifyContinue()">Explorar la app mientras tanto</button>
      <button type="button" onclick="_verifyChangeAccount()">Usar otra cuenta</button>
    </div>`;

  if (_verifySendError) {
    _showLoginMsg('No pudimos enviar el correo: ' + _verifySendError + ' Pulsa «Reenviar correo».', 'error');
    _verifySendError = '';
  }
  // El correo acaba de salir al registrarse: la cuenta atrás empieza ya, para
  // que nadie pulse "Reenviar" tres veces y acabe en auth/too-many-requests.
  const rb = document.getElementById('verify-resend-btn');
  if (rb) fvStartCooldown(rb, 'Reenviar correo', FV_RESEND_COOLDOWN_SEC);

  setTimeout(() => document.getElementById('verify-check-btn')?.focus(), 80);
}

async function _verifyResend() {
  const user = _fbAuth?.currentUser;
  const btn  = document.getElementById('verify-resend-btn');
  if (!user) return _showLoginMsg('Tu sesión ha caducado. Vuelve a iniciar sesión.', 'error');
  if (!navigator.onLine) return _showLoginMsg('Sin conexión. Comprueba tu red y vuelve a intentarlo.', 'error');

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    await user.sendEmailVerification(fvActionCodeSettings('index.html'));
    _showLoginMsg('Correo reenviado. Revisa tu bandeja y la carpeta de spam.', 'success');
    if (btn) fvStartCooldown(btn, 'Reenviar correo', FV_RESEND_COOLDOWN_SEC);
  } catch (err) {
    _showLoginMsg(fvAuthErrMsg(err?.code), 'error');
    // Con too-many-requests se deja la cuenta atrás puesta igualmente: volver
    // a pulsar de inmediato solo repetiría el error.
    if (btn) fvStartCooldown(btn, 'Reenviar correo', FV_RESEND_COOLDOWN_SEC);
  }
}

async function _verifyCheckNow() {
  const user = _fbAuth?.currentUser;
  const btn  = document.getElementById('verify-check-btn');
  if (!user) return _showLoginMsg('Tu sesión ha caducado. Vuelve a iniciar sesión.', 'error');

  if (btn) { btn.disabled = true; btn.textContent = 'Comprobando…'; }
  try {
    await user.reload();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Ya lo he verificado'; }
    return _showLoginMsg(fvAuthErrMsg(err?.code), 'error');
  }

  if (user.emailVerified) {
    APP.emailVerified = true;
    // Token nuevo: el servidor comprueba email_verified DENTRO del token, y el
    // de la caché todavía lo lleva en false. Sin este refresco, la IA y la
    // sincronización seguirían rechazadas después de verificar.
    try { await user.getIdToken(true); } catch (_) {}
    _showLoginMsg('Correo verificado. Entrando…', 'success');
    return _verifyContinue();
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Ya lo he verificado'; }
  _showLoginMsg('Todavía no nos consta verificado. Abre el enlace del correo y vuelve a pulsar aquí.', 'error');
}

/** Restaura la pantalla de login a su estado normal (tabs, Google, divider). */
function _restoreLoginChrome() {
  const tabs = document.querySelector('.login-tabs');
  if (tabs) tabs.style.display = '';
  const divider = document.querySelector('.login-divider');
  if (divider) divider.style.display = '';
  const gbtn = document.querySelector('.login-btn-google');
  if (gbtn) gbtn.style.display = '';
}

function _verifyContinue() {
  fvClearCooldowns();
  _restoreLoginChrome();
  _enterApp();
}

async function _verifyChangeAccount() {
  fvClearCooldowns();
  _restoreLoginChrome();
  try { await _fbAuth.signOut(); } catch (_) {}
  location.href = location.pathname;
}

/* ─── Verificación desde otro dispositivo ──────────────────────── */

// El usuario abre el enlace en el móvil mientras la app sigue abierta en el
// ordenador. Firebase NO avisa: emailVerified solo cambia al recargar el
// usuario. Sin esto habría que pedirle cerrar sesión y volver a entrar, que es
// exactamente lo que el encargo quería evitar.
let _verifyPollBusy = false;

async function _refreshVerifiedState() {
  if (_verifyPollBusy) return;
  const user = _fbAuth?.currentUser;
  if (!user || user.emailVerified) return;   // ya está: nada que refrescar
  _verifyPollBusy = true;
  try {
    await user.reload();
    if (user.emailVerified) {
      APP.emailVerified = true;
      // Token nuevo, o el servidor seguiría viendo email_verified:false.
      try { await user.getIdToken(true); } catch (_) {}
      if (typeof showToast === 'function') {
        showToast('Correo verificado. Ya tienes acceso completo.', 'success');
      }
      if (typeof _injectAuthUI === 'function' && _appInitialized) _injectAuthUI();
    }
  } catch (_) { /* sin conexión: se reintenta en el siguiente foco */ }
  finally { _verifyPollBusy = false; }
}

if (typeof document !== 'undefined') {
  // Al volver a la pestaña, que es justo cuando el usuario acaba de verificar
  // en el otro dispositivo. No hay sondeo periódico a propósito: gastaría
  // peticiones cada X segundos para algo que ocurre una vez.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _refreshVerifiedState();
  });
  window.addEventListener('focus', _refreshVerifiedState);
}

/* ─── Puerta de las funciones que exigen verificación ──────────── */

// Se usa desde ai.js y storage.js. Devuelve true si se puede seguir.
// El modo demo y el modo sin Firebase pasan: ahí no hay cuenta que verificar.
function fvVerifiedOrWarn(feature) {
  if (typeof _isDemoMode !== 'undefined' && _isDemoMode) return true;
  const user = _fbAuth?.currentUser;
  if (!user) return true;                 // sin auth configurada
  if (user.emailVerified) return true;

  const label = feature || 'esta función';
  if (typeof openModal === 'function') {
    openModal('Verifica tu correo', `
      <p style="margin:0 0 12px;font-size:14px;color:var(--text-secondary);line-height:1.6">
        Para usar <strong>${typeof escapeHtml === 'function' ? escapeHtml(label) : label}</strong>
        necesitamos confirmar que tu correo es tuyo.
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:var(--text-muted);line-height:1.6">
        Es lo que nos permite evitar que se creen cuentas falsas para consumir
        el Asesor IA, que tiene coste por consulta, y asegurarnos de que podemos
        devolverte el acceso si pierdes la contraseña.
      </p>
      <p style="margin:0;font-size:13px;color:var(--text-muted);line-height:1.6">
        Te enviamos el enlace a <strong>${typeof escapeHtml === 'function' ? escapeHtml(user.email || '') : (user.email || '')}</strong>.
        Mira también la carpeta de spam.
      </p>
      <div id="login-error" class="login-msg" role="alert" aria-live="assertive" style="display:none;margin-top:12px"></div>`,
      null);
    const btn = document.getElementById('modalConfirm');
    if (btn) {
      btn.textContent = 'Reenviar correo';
      btn.onclick = async (e) => {
        e?.preventDefault?.();
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          await user.sendEmailVerification(fvActionCodeSettings('index.html'));
          btn.textContent = 'Correo enviado ✓';
          if (typeof showToast === 'function') {
            showToast('Correo reenviado. Revisa tu bandeja y la carpeta de spam.', 'success');
          }
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Reenviar correo';
          if (typeof showToast === 'function') showToast(fvAuthErrMsg(err?.code), 'error');
        }
      };
    }
    const cancel = document.getElementById('modalCancel');
    if (cancel) cancel.textContent = 'Ya lo he verificado';
    if (cancel) cancel.onclick = async () => {
      await _refreshVerifiedState();
      if (typeof closeModal === 'function') closeModal();
    };
  } else if (typeof showToast === 'function') {
    showToast('Verifica tu correo para usar ' + label + '.', 'error');
  }
  return false;
}

async function authLogout() {
  try {
    await _fbAuth.signOut();
    // Recargar página para limpiar todo el estado de la app
    location.href = location.pathname;
  } catch (err) {
    console.error('[Finova Auth] Error al cerrar sesión:', err);
  }
}

// El mapa de errores vive en auth-shared.js, que cargan TANTO index.html
// como landing.html. Antes había uno aquí y otro en landing.js, con 18 y 12
// códigos y textos distintos para el mismo error. Esto queda como puente
// para no tocar los call sites.
function _authErrMsg(code) {
  return fvAuthErrMsg(code);
}

// ─── Inyectar UI de usuario en el sidebar existente ──────────────
function _injectAuthUI() {
  // El sync por código ya no es necesario con autenticación — ocultar
  const syncCard = document.getElementById('sync-device-card');
  if (syncCard) syncCard.style.display = 'none';

  // Panel admin — solo para emails admin
  if (APP.isAdmin) {
    const adminCard = document.getElementById('admin-panel-card');
    if (adminCard) adminCard.style.display = '';
    const navAdmin = document.getElementById('nav-admin');
    if (navAdmin) navAdmin.style.display = '';
    const devBtn = document.getElementById('btnDevMode');
    if (devBtn) devBtn.style.display = '';
  }

  const name     = APP.userName || APP.userEmail?.split('@')[0] || 'Usuario';
  const initials = _getInitials(name);

  // Avatar: foto personalizada > foto de Google > iniciales
  _refreshAvatars();

  // Nombre en sidebar y dropdown
  const displayName = APP.userName || APP.userEmail?.split('@')[0] || 'Usuario';
  const sidebarUser = document.getElementById('sidebar-username');
  const ddUser      = document.getElementById('dd-username');
  const ddEmail     = document.getElementById('dd-user-email');
  if (sidebarUser) sidebarUser.textContent = displayName;
  if (ddUser)      ddUser.textContent      = APP.userName || APP.userEmail?.split('@')[0] || 'Usuario';
  if (ddEmail)     ddEmail.textContent     = APP.userEmail || '';

  // Badge admin + botón demo (para admins)
  if (APP.isAdmin) _injectAdminElements();

  // Botón de cerrar sesión al final del dropdown
  _injectLogoutButton();
}

function _injectAdminElements() {
  const dd = document.getElementById('profile-dropdown');
  if (!dd || dd.querySelector('.auth-admin-badge')) return;

  // Badge admin dentro del header, debajo del email
  const header = dd.querySelector('.profile-dropdown-header');
  if (header) {
    const badge = document.createElement('div');
    badge.className = 'auth-admin-badge';
    badge.innerHTML = '👑 Administrador';
    header.appendChild(badge);
  }

  // Botón de demo
  const demoBtn = document.createElement('button');
  demoBtn.type      = 'button';
  demoBtn.className = 'profile-dropdown-item';
  demoBtn.innerHTML = '<span class="profile-dd-icon">🎭</span><span>Ver modo demo</span>';
  demoBtn.onclick   = () => { closeProfileDropdown(); location.href = location.pathname + '?demo'; };

  // Insertar antes del primer divider
  const firstDivider = dd.querySelector('.profile-dropdown-divider');
  if (firstDivider) dd.insertBefore(demoBtn, firstDivider);
}

function _injectLogoutButton() {
  const dd = document.getElementById('profile-dropdown');
  if (!dd || dd.querySelector('.auth-logout-btn')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="profile-dropdown-divider"></div>
    <button type="button" class="profile-dropdown-item auth-logout-btn" onclick="authLogout()">
      <span class="profile-dd-icon">⎋</span>
      <span>Cerrar sesión</span>
      <span class="auth-logout-email">${escapeHtml(APP.userEmail || '')}</span>
    </button>`;
  dd.appendChild(wrap);
}

// ─── Modal de foto de perfil ──────────────────────────────────────
function _openPhotoModal() {
  let overlay = document.getElementById('photo-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id        = 'photo-modal-overlay';
    overlay.className = 'photo-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) _closePhotoModal(); });
    overlay.innerHTML = `
      <div class="photo-modal-card" role="dialog" aria-modal="true" aria-label="Cambiar foto de perfil">
        <div class="photo-modal-header">
          <span class="photo-modal-title">Foto de perfil</span>
          <button type="button" class="photo-modal-close" aria-label="Cerrar" onclick="_closePhotoModal()">✕</button>
        </div>
        <div class="photo-modal-body">
          <div class="photo-preview-ring">
            <div class="photo-preview-avatar" id="photo-preview-avatar"></div>
          </div>
          <label class="photo-drop-zone" id="photo-drop-zone"
            ondragover="event.preventDefault();this.classList.add('drag-over')"
            ondragleave="this.classList.remove('drag-over')"
            ondrop="_onPhotoDrop(event)">
            <span class="photo-drop-icon">🖼</span>
            <span class="photo-drop-main">Arrastra una foto aquí</span>
            <span class="photo-drop-or">o</span>
            <span class="photo-drop-btn">Seleccionar archivo</span>
            <span class="photo-drop-hint">JPG, PNG, WEBP — máx. 10 MB</span>
            <input type="file" accept="image/*" style="display:none"
              onchange="_onPhotoFileSelected(this.files[0]);this.value=''" />
          </label>
        </div>
        <div class="photo-modal-footer">
          <button type="button" class="photo-remove-btn" id="photo-remove-btn" onclick="_removeProfilePhoto()">
            Eliminar foto
          </button>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn-ghost" onclick="_closePhotoModal()">Cancelar</button>
            <button type="button" class="btn-primary" id="photo-save-btn" onclick="_savePhotoFromModal()" disabled>Guardar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  _pendingPhoto = null;
  _updateModalPreview(APP.profilePhoto || APP.userPhoto || '');
  const saveBtn   = document.getElementById('photo-save-btn');
  const removeBtn = document.getElementById('photo-remove-btn');
  if (saveBtn)   saveBtn.disabled        = true;
  if (removeBtn) removeBtn.style.display = APP.profilePhoto ? '' : 'none';
  overlay.style.display = 'flex';
  document.addEventListener('keydown', _photoModalKeyHandler);
}

function _photoModalKeyHandler(e) {
  if (e.key === 'Escape') _closePhotoModal();
}

function _closePhotoModal() {
  const overlay = document.getElementById('photo-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  document.removeEventListener('keydown', _photoModalKeyHandler);
  _pendingPhoto = null;
}

function _updateModalPreview(src) {
  const el = document.getElementById('photo-preview-avatar');
  if (!el) return;
  if (src) {
    el.innerHTML = `<img src="${escapeHtml(src)}" alt="Vista previa" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  } else {
    el.innerHTML = '';
    el.textContent = _getInitials(APP.userName || APP.userEmail?.split('@')[0] || '?');
  }
}

function _onPhotoFileSelected(file) {
  if (!file || !file.type.startsWith('image/')) return;
  _resizeImage(file, 200).then(dataUrl => {
    _pendingPhoto = dataUrl;
    _updateModalPreview(dataUrl);
    const saveBtn = document.getElementById('photo-save-btn');
    if (saveBtn) saveBtn.disabled = false;
  }).catch(() => showToast('No se pudo procesar la imagen', 'error'));
}

function _onPhotoDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('photo-drop-zone');
  if (zone) zone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) _onPhotoFileSelected(file);
}

function _savePhotoFromModal() {
  if (!_pendingPhoto) return;
  APP.profilePhoto = _pendingPhoto;
  saveData();
  _refreshAvatars();
  _closePhotoModal();
  showToast('Foto de perfil actualizada', 'success');
}

function _removeProfilePhoto() {
  APP.profilePhoto = '';
  saveData();
  _refreshAvatars();
  _closePhotoModal();
  showToast('Foto eliminada', 'success');
}

function _resizeImage(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx  = (img.width  - min) / 2;
        const sy  = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _refreshAvatars() {
  const name     = APP.userName || APP.userEmail?.split('@')[0] || '?';
  const initials = _getInitials(name);
  const src      = APP.profilePhoto || APP.userPhoto || '';
  const imgHTML  = src
    ? `<img src="${escapeHtml(src)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : '';

  ['sidebar-avatar', 'dd-avatar', 'mh-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (src) el.innerHTML   = imgHTML;
    else     el.textContent = initials;
  });
}

function _getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}
