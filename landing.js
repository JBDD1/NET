/* ═══════════════════════════════════════════════════════════════
   FINOVA — landing.js
═══════════════════════════════════════════════════════════════ */
'use strict';

const _LP_FIREBASE_CONFIG = {
  apiKey:            'AIzaSyBw0RiwDM-vcqJ_mXDZGz1xXy-rF6JjBqw',
  authDomain:        'finova-92100.firebaseapp.com',
  projectId:         'finova-92100',
  storageBucket:     'finova-92100.firebasestorage.app',
  messagingSenderId: '387946044101',
  appId:             '1:387946044101:web:9d6435d177a4b7ad92eeac',
};

let _lpAuth = null;
let _lpMode = 'signin';

(function lpInit() {
  try {
    const lu   = localStorage.getItem('finova_last_uid');
    const bk   = lu ? ('finova_' + lu + '_data_v1') : 'finova_data_v1';
    const data = JSON.parse(localStorage.getItem(bk) || localStorage.getItem('finova_data_v1') || '{}');
    if (data.variant) document.documentElement.setAttribute('data-variant', data.variant);
    if (data.theme)   document.documentElement.setAttribute('data-theme',   data.theme);
  } catch (_) {}

  try {
    firebase.initializeApp(_LP_FIREBASE_CONFIG);
    _lpAuth = firebase.auth();
    _lpAuth.languageCode = 'es';
    _lpAuth.onAuthStateChanged(_updateHeaderForAuth);
  } catch (e) {
    console.warn('[Landing] Firebase init:', e);
  }

  _initScrollAnimations();
  _initScrollProgress();
  _initSmoothScroll();
  _initCounters();
})();

function _updateHeaderForAuth(user) {
  const loginBtn = document.getElementById('headerLoginBtn');
  const appBtn   = document.getElementById('headerAppBtn');
  if (!loginBtn || !appBtn) return;
  if (user) {
    loginBtn.style.display = 'none';
    appBtn.textContent     = 'Mi dashboard →';
  } else {
    loginBtn.style.display = '';
    appBtn.textContent     = 'Ir a la app →';
  }
}

/* ── Modal ────────────────────────────────────────────────────── */
function lpOpenModal(mode) {
  _lpMode = mode || 'signin';
  document.getElementById('lpModalOverlay')?.classList.add('open');
  lpSwitchTab(_lpMode);
  document.addEventListener('keydown', _lpEsc);
  setTimeout(() => {
    (document.getElementById(_lpMode === 'signup' ? 'lpNameInput' : 'lpEmailInput'))?.focus();
  }, 80);
}

function lpCloseModal() {
  document.getElementById('lpModalOverlay')?.classList.remove('open');
  _clearError();
  document.removeEventListener('keydown', _lpEsc);
}

function _lpEsc(e) { if (e.key === 'Escape') lpCloseModal(); }

function lpSwitchTab(mode) {
  _lpMode = mode;
  document.getElementById('lpTabSignin')?.classList.toggle('active', mode === 'signin');
  document.getElementById('lpTabSignup')?.classList.toggle('active', mode === 'signup');
  const nf = document.getElementById('lpNameField');
  const fw = document.getElementById('lpForgotWrap');
  const sb = document.getElementById('lpSubmitBtn');
  const pi = document.getElementById('lpPasswordInput');
  if (nf) nf.style.display     = mode === 'signup' ? '' : 'none';
  if (fw) fw.style.display     = mode === 'signin' ? '' : 'none';
  if (sb) sb.textContent       = mode === 'signup' ? 'Crear cuenta' : 'Iniciar sesión';
  if (pi) pi.autocomplete      = mode === 'signup' ? 'new-password' : 'current-password';
  _clearError();
}

function _showError(msg) {
  const el = document.getElementById('lpFormError');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'lp-form-error visible';
}

function _showSuccess(msg) {
  const el = document.getElementById('lpFormError');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'lp-form-error visible lp-form-ok';
}

function _clearError() {
  const el = document.getElementById('lpFormError');
  if (el) el.className = 'lp-form-error';
}

function _setLoading(on) {
  const btn = document.getElementById('lpSubmitBtn');
  if (!btn) return;
  btn.disabled    = on;
  btn.textContent = on ? 'Cargando…' : (_lpMode === 'signup' ? 'Crear cuenta' : 'Iniciar sesión');
}

/* ── Auth ─────────────────────────────────────────────────────── */
function lpSubmit() {
  if (!_lpAuth) return _showError('Firebase no disponible.');
  const email = document.getElementById('lpEmailInput')?.value.trim();
  const pass  = document.getElementById('lpPasswordInput')?.value;
  const name  = document.getElementById('lpNameInput')?.value.trim() || '';
  if (!email) return _showError('Introduce tu correo electrónico.');
  if (!pass)  return _showError('Introduce tu contraseña.');
  _setLoading(true); _clearError();

  if (_lpMode === 'signup') {
    if (pass.length < 6) { _setLoading(false); return _showError('La contraseña debe tener al menos 6 caracteres.'); }
    _lpAuth.createUserWithEmailAndPassword(email, pass)
      .then(cred => name ? cred.user.updateProfile({ displayName: name }) : null)
      .then(() => { location.href = 'index.html'; })
      .catch(err => { _setLoading(false); _showError(_lpErrMsg(err.code)); });
  } else {
    _lpAuth.signInWithEmailAndPassword(email, pass)
      .then(() => { location.href = 'index.html'; })
      .catch(err => { _setLoading(false); _showError(_lpErrMsg(err.code)); });
  }
}

function lpSignInGoogle() {
  if (!_lpAuth) return _showError('Firebase no disponible.');
  _lpAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
    .then(() => { location.href = 'index.html'; })
    .catch(err => { if (err.code !== 'auth/popup-closed-by-user') _showError(_lpErrMsg(err.code)); });
}

function lpSendReset() {
  const email = document.getElementById('lpEmailInput')?.value.trim();
  if (!email) return _showError('Introduce tu correo para recuperar la contraseña.');
  _lpAuth.sendPasswordResetEmail(email)
    .then(() => _showSuccess('Correo de recuperación enviado. Revisa tu bandeja.'))
    .catch(err => _showError(_lpErrMsg(err.code)));
}

function _lpErrMsg(code) {
  return ({
    'auth/user-not-found':            'No existe ninguna cuenta con ese correo.',
    'auth/wrong-password':            'Contraseña incorrecta.',
    'auth/invalid-email':             'El correo no tiene un formato válido.',
    'auth/email-already-in-use':      'Ya existe una cuenta con ese correo. Inicia sesión.',
    'auth/weak-password':             'Contraseña demasiado débil (mínimo 6 caracteres).',
    'auth/too-many-requests':         'Demasiados intentos fallidos. Espera unos minutos.',
    'auth/network-request-failed':    'Error de red. Comprueba tu conexión.',
    'auth/popup-blocked':             'El navegador bloqueó el popup. Permite los popups para esta página.',
    'auth/invalid-credential':        'Correo o contraseña incorrectos.',
    'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
    'auth/unauthorized-domain':       `Dominio no autorizado (${location.hostname}). Añádelo en Firebase Console → Authentication → Authorized domains.`,
  })[code] || `Error (${code || 'desconocido'}).`;
}

/* ── Themes ───────────────────────────────────────────────────── */
function lpSetTheme(variant, theme, cardEl) {
  document.documentElement.setAttribute('data-variant', variant);
  document.documentElement.setAttribute('data-theme',   theme || 'dark');
  document.querySelectorAll('.lp-theme-card').forEach(c => c.classList.remove('active'));
  if (cardEl) cardEl.classList.add('active');
}

/* ── FAQ accordion ────────────────────────────────────────────── */
function lpFaqToggle(btn) {
  const item   = btn.closest('.lp-faq-item');
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.lp-faq-item.open').forEach(el => el.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

/* ── Scroll animations ────────────────────────────────────────── */
function _initScrollAnimations() {
  const selector = '.lp-ani, .lp-ani-left, .lp-ani-right';
  const els = document.querySelectorAll(selector);
  if (!els.length) return;
  if (!window.IntersectionObserver) {
    els.forEach(el => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -28px 0px' });
  els.forEach(el => io.observe(el));
}

/* ── Number counters ──────────────────────────────────────────── */
function _initCounters() {
  const els = document.querySelectorAll('[data-count]');
  if (!els.length || !window.IntersectionObserver) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el      = e.target;
      const target  = +el.dataset.count;
      const suffix  = el.dataset.suffix  || '';
      const prefix  = el.dataset.prefix  || '';
      const dur     = 1200;
      const start   = performance.now();
      (function tick(now) {
        const p = Math.min((now - start) / dur, 1);
        const v = Math.round(_ease(p) * target);
        el.textContent = prefix + v + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(start);
    });
  }, { threshold: 0.5 });
  els.forEach(el => io.observe(el));
}

function _ease(t) { return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

/* ── Scroll progress ──────────────────────────────────────────── */
function _initScrollProgress() {
  const bar = document.getElementById('scrollLine');
  if (!bar) return;
  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
  }, { passive: true });
}

/* ── Smooth scroll ────────────────────────────────────────────── */
function _initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
    });
  });
}
