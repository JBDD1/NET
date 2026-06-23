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
  _initNavScroll();
  _initMouseGlow();
  _initTiltCards();
  _initMagneticBtns();
  _initParticles();
  _initSparkles();
  _initTextSplit();

  // Safety: reveal all still-hidden elements after 1.5 s
  // (fallback if IntersectionObserver never fires — e.g. hidden iframe, print)
  setTimeout(() => {
    document.querySelectorAll('.lp-ani:not(.in),.lp-ani-left:not(.in),.lp-ani-right:not(.in)')
      .forEach(el => el.classList.add('in'));
  }, 1500);
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

  // Reveal elements already in the viewport immediately (synchronous, same frame → no flash)
  const vh = window.innerHeight;
  els.forEach(el => {
    const top = el.getBoundingClientRect().top;
    if (top < vh - 20) el.classList.add('in');
  });

  // Observe the rest as user scrolls
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -28px 0px' });

  els.forEach(el => { if (!el.classList.contains('in')) io.observe(el); });
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

/* ── Feature detail modals ────────────────────────────────────── */
function lpOpenFeat(id) {
  const f = _LP_FEAT_DATA[id];
  if (!f) return;
  document.getElementById('featIc').textContent    = f.ic;
  document.getElementById('featTitle').textContent = f.title;
  document.getElementById('featTag').textContent   = f.tag;
  document.getElementById('featMock').innerHTML    = f.mock();
  document.getElementById('featPts').innerHTML     =
    f.pts.map(p => `<div class="feat-pt"><span class="feat-check">✓</span>${p}</div>`).join('');
  document.getElementById('featOverlay').classList.add('open');
  document.addEventListener('keydown', _featEsc);
}
function lpCloseFeat() {
  document.getElementById('featOverlay')?.classList.remove('open');
  document.removeEventListener('keydown', _featEsc);
}
function _featEsc(e) { if (e.key === 'Escape') lpCloseFeat(); }

function _mockDashboard() {
  const bars = [38,52,55,60,58,68,72,70,80,85,90,100]
    .map((h,i) => `<div class="fm-bar${i===11?' active':''}" style="height:${h}%"></div>`).join('');
  return `<div class="fm-screen">
    <div class="fm-kpis">
      <div class="fm-kpi"><div class="fm-kpi-l">Patrimonio neto</div><div class="fm-kpi-v">84.200 €</div><div class="fm-kpi-d up">↑ +3,4 % este mes</div></div>
      <div class="fm-kpi"><div class="fm-kpi-l">Ingresos / mes</div><div class="fm-kpi-v">3.200 €</div><div class="fm-kpi-d">Nómina + freelance</div></div>
      <div class="fm-kpi"><div class="fm-kpi-l">Gastos / mes</div><div class="fm-kpi-v">1.960 €</div><div class="fm-kpi-d down">↑ +120 € vs anterior</div></div>
    </div>
    <div class="fm-chart-label">Evolución patrimonial — últimos 12 meses</div>
    <div class="fm-chart">${bars}</div>
  </div>`;
}

function _mockPortfolio() {
  const rows = [
    {ic:'🌍',n:'MSCI World ETF',s:'Vanguard',v:'18.240 €',r:'+14,2 %',c:'up'},
    {ic:'🍎',n:'Apple Inc.',s:'NASDAQ',v:'9.100 €',r:'+8,7 %',c:'up'},
    {ic:'🏦',n:'Santander',s:'BME',v:'4.300 €',r:'−2,1 %',c:'down'},
    {ic:'📄',n:'Renta Fija EU',s:'iShares',v:'11.160 €',r:'+3,4 %',c:'up'},
  ].map(p=>`<div class="fm-row"><div class="fm-row-ic">${p.ic}</div><div class="fm-row-info"><div class="fm-row-name">${p.n}</div><div class="fm-row-sub">${p.s}</div></div><div class="fm-row-right"><div class="fm-row-v">${p.v}</div><div class="fm-row-r ${p.c}">${p.r}</div></div></div>`).join('');
  return `<div class="fm-screen">
    <div class="fm-port-head">
      <div><div class="fm-kpi-l">Valor total cartera</div><div class="fm-kpi-v">42.800 €</div></div>
      <div class="fm-badge up">+12,4 % rentabilidad total</div>
    </div>
    <div class="fm-positions">${rows}</div>
  </div>`;
}

function _mockTax() {
  return `<div class="fm-screen">
    <div class="fm-tax-head">Resumen Fiscal 2024 — IRPF</div>
    <div class="fm-tax-rows">
      <div class="fm-tax-row"><span>Ganancias realizadas</span><span class="up">+6.840 €</span></div>
      <div class="fm-tax-row"><span>Pérdidas realizadas</span><span class="down">−1.120 €</span></div>
      <div class="fm-tax-row fm-tax-total"><span>Base imponible del ahorro</span><span>5.720 €</span></div>
      <div class="fm-tax-row"><span>Tramo hasta 6.000 € (19 %)</span><span>1.140 €</span></div>
      <div class="fm-tax-row"><span>Tramo 6.000–50.000 € (21 %)</span><span>151 €</span></div>
      <div class="fm-tax-row fm-tax-total accent"><span>Cuota estimada</span><span>1.291 €</span></div>
    </div>
    <div class="fm-tax-note">Cálculo orientativo. Consulta siempre a un asesor fiscal cualificado.</div>
  </div>`;
}

function _mockAI() {
  return `<div class="fm-screen">
    <div class="fm-chat">
      <div class="fm-msg user">¿Cómo está mi situación fiscal este año?</div>
      <div class="fm-msg ai">Tu base imponible del ahorro es de <strong>5.720 €</strong>, principalmente por la venta de tu ETF MSCI World en mayo. Estás en el primer tramo (19 %), así que la cuota estimada es <strong>1.291 €</strong>. Si tienes pérdidas pendientes de años anteriores, podrías reducirla. ¿Quieres que lo revise?</div>
      <div class="fm-msg user">¿Qué ETFs me recomiendas para diversificar?</div>
      <div class="fm-msg ai">Tu cartera tiene un 42 % en renta variable global y un 26 % en renta fija. Para equilibrar el riesgo, considera un ETF de bonos de corta duración o ampliar exposición a mercados emergentes si tu horizonte es largo.</div>
    </div>
  </div>`;
}

function _mockGoals() {
  const goals = [
    {ic:'🏖️',n:'Fondo vacaciones',t:'3.000',c:'2.100',p:70},
    {ic:'🏠',n:'Entrada piso',t:'40.000',c:'18.400',p:46},
    {ic:'🛡️',n:'Fondo emergencia',t:'12.000',c:'12.000',p:100},
  ].map(g=>`<div class="fm-goal">
    <div class="fm-goal-head">
      <span class="fm-goal-ic">${g.ic}</span>
      <div class="fm-goal-info"><div class="fm-goal-name">${g.n}</div><div class="fm-goal-sub">${g.c} € / ${g.t} €</div></div>
      <div class="fm-goal-pct${g.p===100?' done':''}">${g.p} %</div>
    </div>
    <div class="fm-goal-bar"><div class="fm-goal-fill${g.p===100?' done':''}" style="width:${g.p}%"></div></div>
  </div>`).join('');
  return `<div class="fm-screen"><div class="fm-goals">${goals}</div></div>`;
}

function _mockTransactions() {
  const txs = [
    {ic:'💰',n:'Nómina diciembre',cat:'Ingresos',a:'+3.200 €',c:'up'},
    {ic:'🛒',n:'Mercadona',cat:'Alimentación',a:'−89 €',c:'down'},
    {ic:'📈',n:'MSCI World ETF',cat:'Inversión',a:'+1.840 €',c:'up'},
    {ic:'🏠',n:'Alquiler',cat:'Vivienda',a:'−950 €',c:'down'},
    {ic:'⚡',n:'Factura luz',cat:'Suministros',a:'−78 €',c:'down'},
  ].map(t=>`<div class="fm-tx"><div class="fm-tx-ic">${t.ic}</div><div class="fm-tx-info"><div class="fm-tx-name">${t.n}</div><div class="fm-tx-cat">${t.cat}</div></div><div class="fm-tx-a ${t.c}">${t.a}</div></div>`).join('');
  return `<div class="fm-screen">
    <div class="fm-tx-head"><div class="fm-tx-search">🔍  Buscar transacciones…</div></div>
    <div class="fm-txs">${txs}</div>
  </div>`;
}

/* ── Nav compact on scroll ────────────────────────────────────── */
function _initNavScroll() {
  const hdr = document.querySelector('.lp-header');
  if (!hdr) return;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        hdr.classList.toggle('scrolled', window.scrollY > 60);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

/* ── Cursor glow ──────────────────────────────────────────────── */
function _initMouseGlow() {
  let glow = document.getElementById('lp-cursor-glow');
  if (!glow) {
    glow = document.createElement('div');
    glow.id = 'lp-cursor-glow';
    document.body.prepend(glow);
  }
  let mx = -999, my = -999, cx = -999, cy = -999;
  let raf = null;

  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });

  function tick() {
    cx += (mx - cx) * 0.08;
    cy += (my - cy) * 0.08;
    glow.style.left = cx + 'px';
    glow.style.top  = cy + 'px';
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  document.addEventListener('mouseleave', () => {
    cancelAnimationFrame(raf);
    glow.style.opacity = '0';
  });
  document.addEventListener('mouseenter', () => {
    glow.style.opacity = '1';
    raf = requestAnimationFrame(tick);
  });
}

/* ── 3-D tilt + spotlight on feature cards ────────────────────── */
function _initTiltCards() {
  const cards = document.querySelectorAll('.lp-feat, .lp-trust-card, .lp-price-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', e => {
      const r  = card.getBoundingClientRect();
      const x  = e.clientX - r.left;
      const y  = e.clientY - r.top;
      const cx = r.width  / 2;
      const cy = r.height / 2;
      const rx = ((y - cy) / cy) * -8;
      const ry = ((x - cx) / cx) *  8;
      card.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
      card.style.setProperty('--mx', (x / r.width  * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (y / r.height * 100).toFixed(1) + '%');
    }, { passive: true });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

/* ── Magnetic buttons ─────────────────────────────────────────── */
function _initMagneticBtns() {
  document.querySelectorAll('.btn-cta, .lp-btn-primary').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const r  = btn.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width  / 2)) * 0.3;
      const dy = (e.clientY - (r.top  + r.height / 2)) * 0.3;
      btn.style.transform = `translate(${dx}px, ${dy}px)`;
    }, { passive: true });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
  });
}

/* ── Floating particle canvas ─────────────────────────────────── */
function _initParticles() {
  let canvas = document.getElementById('lp-particles');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'lp-particles';
    document.body.prepend(canvas);
  }
  const ctx = canvas.getContext('2d');
  const NUM = 75;
  const LINK_DIST = 140;
  let mouseX = -9999, mouseY = -9999;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4a960';

  const particles = Array.from({ length: NUM }, () => ({
    x:   Math.random() * window.innerWidth,
    y:   Math.random() * window.innerHeight,
    r:   Math.random() * 1.8 + 0.3,
    vx:  (Math.random() - 0.5) * 0.28,
    vy:  (Math.random() - 0.5) * 0.28,
    a:   Math.random() * 0.45 + 0.08,
    ta:  Math.random() * 0.45 + 0.08,
    ts:  Math.random() * 0.008 + 0.003,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update particles
    particles.forEach(p => {
      // Twinkle
      if (Math.abs(p.a - p.ta) < 0.015) p.ta = Math.random() * 0.45 + 0.06;
      p.a += (p.ta - p.a) * p.ts;

      // Mouse repulsion
      const mdx = p.x - mouseX;
      const mdy = p.y - mouseY;
      const md  = Math.sqrt(mdx * mdx + mdy * mdy);
      if (md < 100 && md > 0) {
        const f = ((100 - md) / 100) * 0.6;
        p.vx += (mdx / md) * f;
        p.vy += (mdy / md) * f;
      }

      // Damping
      p.vx *= 0.97;
      p.vy *= 0.97;

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10)  p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) p.y = -10;
    });

    // Draw constellation lines
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < LINK_DIST) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = accent;
          ctx.globalAlpha = (1 - d / LINK_DIST) * 0.14;
          ctx.lineWidth   = 0.6;
          ctx.stroke();
        }
      }
    }

    // Draw particles
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle   = accent;
      ctx.globalAlpha = p.a;
      ctx.fill();
      // Soft glow on larger particles
      if (p.r > 1.2) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fillStyle   = accent;
        ctx.globalAlpha = p.a * 0.08;
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
}

/* ── Click sparkle burst ──────────────────────────────────────── */
function _initSparkles() {
  document.addEventListener('click', e => {
    if (e.target.closest('button, a, input, textarea, select, label')) return;
    _burst(e.clientX, e.clientY, 10);
  });

  document.querySelectorAll('.btn-cta, .lp-btn-primary').forEach(btn => {
    btn.addEventListener('click', e => {
      _burst(e.clientX, e.clientY, 16);
    });
  });
}

function _burst(cx, cy, count) {
  for (let i = 0; i < count; i++) {
    const s  = document.createElement('div');
    const angle = (i / count) * Math.PI * 2;
    const dist  = 28 + Math.random() * 44;
    s.className = 'lp-sparkle';
    s.style.cssText = `left:${cx}px;top:${cy}px;`
      + `--sdx:${Math.cos(angle) * dist}px;--sdy:${Math.sin(angle) * dist}px;`
      + `--sr:${Math.random() * 3 + 2}px;`
      + `animation-delay:${i * 0.028}s;animation-duration:${0.5 + Math.random() * 0.3}s`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

/* ── Split headline text into staggered chars ─────────────────── */
function _initTextSplit() {
  const targets = document.querySelectorAll('.lp-headline-split');
  targets.forEach(el => {
    const text = el.textContent;
    el.textContent = '';
    el.style.visibility = 'visible';
    [...text].forEach((ch, i) => {
      const span = document.createElement('span');
      span.className = 'lp-char';
      span.textContent = ch === ' ' ? ' ' : ch;
      span.style.animationDelay = (i * 0.035) + 's';
      el.appendChild(span);
    });
  });

  if (!window.IntersectionObserver) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.querySelectorAll('.lp-char').forEach(c => c.classList.add('in'));
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.2 });
  targets.forEach(el => io.observe(el));
}

const _LP_FEAT_DATA = {
  dashboard:    { ic:'📊', title:'Dashboard',             tag:'Tu situación financiera de un vistazo',     mock:_mockDashboard,    pts:['Patrimonio neto actualizado en tiempo real','Balance de ingresos vs gastos mensual','Evolución histórica con gráficos interactivos','Resumen de todas tus cuentas en un solo lugar'] },
  portfolio:    { ic:'📈', title:'Cartera de inversión',  tag:'Seguimiento profesional de tus activos',    mock:_mockPortfolio,    pts:['Cotizaciones en tiempo real de acciones y ETFs','Rentabilidad total y anualizada por posición','Diversificación por activo, sector y geografía','Historial completo de compras y ventas'] },
  tax:          { ic:'🧾', title:'Fiscalidad IRPF',       tag:'Sin sorpresas en tu declaración de la renta',mock:_mockTax,         pts:['Cálculo automático de plusvalías y pérdidas patrimoniales','Base imponible del ahorro desglosada por activo','Compensación inteligente de ganancias y pérdidas','Resumen listo para incluir en tu declaración'] },
  ai:           { ic:'🤖', title:'Asesor con IA',         tag:'Tu asesor financiero personal, 24/7',       mock:_mockAI,           pts:['Consultas en lenguaje natural sobre tus finanzas','Análisis de tu situación patrimonial actual','Sugerencias de optimización fiscal personalizadas','Estrategias de ahorro e inversión adaptadas a ti'] },
  goals:        { ic:'🎯', title:'Objetivos financieros', tag:'Convierte tus metas en planes concretos',   mock:_mockGoals,        pts:['Define objetivos con cantidad objetivo y fecha límite','Seguimiento del progreso en tiempo real','Proyecciones basadas en tu capacidad de ahorro actual','Alertas al alcanzar hitos importantes'] },
  transactions: { ic:'💳', title:'Transacciones',         tag:'Control total de cada euro que entra y sale',mock:_mockTransactions, pts:['Importa CSV desde cualquier banco español en segundos','Categorización automática por tipo de gasto','Búsqueda y filtrado avanzado por fecha o categoría','Exporta en PDF, Excel o CSV cuando quieras'] },
};
