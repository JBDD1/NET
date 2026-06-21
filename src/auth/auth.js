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
  apiKey:            'AIzaSyBw0RiwDM-vcqJ_mXDZGz1xXy-rF6JjBqw',
  authDomain:        'finova-92100.firebaseapp.com',
  projectId:         'finova-92100',
  storageBucket:     'finova-92100.firebasestorage.app',
  messagingSenderId: '387946044101',
  appId:             '1:387946044101:web:9d6435d177a4b7ad92eeac',
};

// ─── Correos con rol administrador ───────────────────────────────
// Añade aquí los correos que tendrán acceso admin (demo, estadísticas, etc.)
const ADMIN_EMAILS = [
  'verdpo@gmail.com',
];

// ─── Estado interno ───────────────────────────────────────────────
let _fbAuth          = null;
let _appInitialized  = false;
let _loginMode       = 'signin'; // 'signin' | 'signup'
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
  if (FIREBASE_CONFIG.apiKey === 'PASTE_YOUR_FIREBASE_API_KEY') {
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
      APP.isAdmin   = ADMIN_EMAILS.includes((user.email || '').toLowerCase());

      // Persistir último UID para que el boot-script lea el tema correcto
      try { localStorage.setItem('finova_last_uid', user.uid); } catch (_) {}

      // Guardar metadatos en servidor (email, nombre, último acceso)
      _saveUserMeta(user.uid, user.email, user.displayName);

      // Cargar datos del servidor si no hay datos locales para este UID
      await _loadUserDataFromServer(user.uid);

      if (!_appInitialized) {
        _appInitialized = true;
        _hideLoginScreen();
        await init();
        _injectAuthUI();
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

// ─── Guarda metadatos en servidor ────────────────────────────
function _saveUserMeta(uid, email, displayName) {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    fetch('/api/user-meta', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ uid, email: email || '', displayName: displayName || '' }),
    }).catch(() => {});
  } catch (_) {}
}

// ─── Carga datos del servidor al primer login ─────────────────────
async function _loadUserDataFromServer(uid) {
  const key = `finova_${uid}_data_v1`;
  if (localStorage.getItem(key)) return; // ya hay datos locales para este UID
  try {
    const res  = await fetch(`/api/user-data?uid=${encodeURIComponent(uid)}`, {
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
  if (loading) loading.classList.add('hidden');
  if (login)   login.style.display = 'flex';
  _renderLoginForm(_loginMode);
}

function _hideLoginScreen() {
  const login   = document.getElementById('login-screen');
  const loading = document.getElementById('app-loading');
  if (login)   login.style.display = 'none';
  if (loading) loading.classList.remove('hidden');
}

// ─── Renderiza el formulario de login / registro ──────────────────
function _renderLoginForm(mode) {
  _loginMode = mode;
  const container = document.getElementById('login-form-container');
  if (!container) return;

  if (mode === 'signin') {
    container.innerHTML = `
      <div class="login-field">
        <label class="login-label">Correo electrónico</label>
        <input type="email" id="login-email" class="login-input"
          placeholder="tu@correo.com" autocomplete="email" />
      </div>
      <div class="login-field">
        <label class="login-label">Contraseña</label>
        <input type="password" id="login-password" class="login-input"
          placeholder="••••••••" autocomplete="current-password"
          onkeydown="if(event.key==='Enter')_submitLogin()" />
      </div>
      <div id="login-error" class="login-msg" style="display:none"></div>
      <button type="button" class="login-btn-primary" id="login-submit-btn"
        onclick="_submitLogin()">Iniciar sesión</button>
      <button type="button" class="login-forgot"
        onclick="sendPasswordReset(document.getElementById('login-email')?.value)">
        ¿Olvidaste tu contraseña?
      </button>`;
  } else {
    container.innerHTML = `
      <div class="login-field">
        <label class="login-label">Tu nombre</label>
        <input type="text" id="login-name" class="login-input"
          placeholder="Nombre (opcional)" autocomplete="name" />
      </div>
      <div class="login-field">
        <label class="login-label">Correo electrónico</label>
        <input type="email" id="login-email" class="login-input"
          placeholder="tu@correo.com" autocomplete="email" />
      </div>
      <div class="login-field">
        <label class="login-label">Contraseña</label>
        <input type="password" id="login-password" class="login-input"
          placeholder="Mínimo 6 caracteres" autocomplete="new-password"
          onkeydown="if(event.key==='Enter')_submitLogin()" />
      </div>
      <div id="login-error" class="login-msg" style="display:none"></div>
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
  if (_loginMode === 'signup') signUpEmail(email, password, name);
  else                         signInEmail(email, password);
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
  if (password.length < 6) return _showLoginMsg('La contraseña debe tener al menos 6 caracteres.', 'error');
  _setLoginLoading(true);
  try {
    const cred = await _fbAuth.createUserWithEmailAndPassword(email, password);
    if (name) await cred.user.updateProfile({ displayName: name });
  } catch (err) {
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

async function sendPasswordReset(email) {
  if (!email) return _showLoginMsg('Introduce tu correo para recuperar la contraseña.', 'error');
  try {
    await _fbAuth.sendPasswordResetEmail(email);
    _showLoginMsg('Correo de recuperación enviado. Revisa tu bandeja de entrada.', 'success');
  } catch (err) {
    console.error('[Finova Auth] sendPasswordReset error:', err.code, err.message);
    _showLoginMsg(_authErrMsg(err.code));
  }
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

function _authErrMsg(code) {
  const MAP = {
    'auth/user-not-found':           'No existe ninguna cuenta con ese correo.',
    'auth/wrong-password':           'Contraseña incorrecta.',
    'auth/invalid-email':            'El correo no tiene un formato válido.',
    'auth/email-already-in-use':     'Ya existe una cuenta con ese correo. Inicia sesión.',
    'auth/weak-password':            'La contraseña es demasiado débil (mínimo 6 caracteres).',
    'auth/too-many-requests':        'Demasiados intentos fallidos. Espera unos minutos.',
    'auth/network-request-failed':   'Error de red. Comprueba tu conexión a internet.',
    'auth/popup-blocked':            'El navegador bloqueó el popup. Permite los popups para esta página.',
    'auth/invalid-credential':       'Correo o contraseña incorrectos.',
    'auth/user-disabled':            'Esta cuenta ha sido desactivada.',
    'auth/operation-not-allowed':    'Este método de inicio de sesión no está habilitado. Actívalo en Firebase Console → Authentication → Método de acceso.',
    'auth/admin-restricted-operation': 'El registro de nuevas cuentas está desactivado temporalmente.',
    'auth/missing-email':            'Introduce tu correo electrónico.',
    'auth/missing-password':         'Introduce tu contraseña.',
    'auth/invalid-login-credentials':'Correo o contraseña incorrectos.',
    'auth/account-exists-with-different-credential': 'Ya existe una cuenta con ese correo usando otro método de inicio de sesión.',
    'auth/unauthorized-domain':      `Dominio no autorizado (${location.hostname}). Accede desde http://localhost:3000 — no uses 127.0.0.1 ni ninguna otra IP.`,
  };
  return MAP[code] || `Error de autenticación (${code || 'desconocido'}). Inténtalo de nuevo.`;
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
      <span class="auth-logout-email">${APP.userEmail || ''}</span>
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
    el.innerHTML = `<img src="${src}" alt="Vista previa" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
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
    ? `<img src="${src}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
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
