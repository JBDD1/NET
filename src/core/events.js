'use strict';
// Centralises all static DOM event bindings so that index.html contains
// zero inline handlers — a prerequisite for removing 'unsafe-inline' from
// Content-Security-Policy script-src.
//
// Loaded as the LAST <script> in index.html so every target element exists.
(function () {

  function _on(id, type, fn) {
    var el = (typeof id === 'string') ? document.getElementById(id) : id;
    if (el) el.addEventListener(type, fn);
  }

  // ── Login ──────────────────────────────────────────────────────
  function _loginTabClick(mode) {
    return function () {
      _renderLoginForm(mode);
      document.querySelectorAll('.login-tab').forEach(function (t) {
        t.classList.remove('active');
      });
      this.classList.add('active');
    };
  }
  _on('login-tab-signin', 'click', _loginTabClick('signin'));
  _on('login-tab-signup', 'click', _loginTabClick('signup'));
  // Guardado con typeof: si auth.js no llegó a cargar (p.ej. fallo de red o
  // de build), signInGoogle no existe — una referencia directa aquí lanzaría
  // un ReferenceError sin capturar que abortaría el resto de esta función,
  // dejando sin enganchar TODOS los listeners que vienen después (incluida
  // la importación de CSV/Excel más abajo). Con la guarda, en el peor caso
  // solo falla el login con Google; todo lo demás se sigue enganchando.
  var googleBtn = document.querySelector('.login-btn-google');
  if (googleBtn && typeof signInGoogle === 'function') googleBtn.addEventListener('click', signInGoogle);

  // ── Profile dropdown ───────────────────────────────────────────
  _on('avatar-change-wrap', 'click', function (e) {
    _openPhotoModal();
    e.stopPropagation();
  });
  _on('profile-name-input', 'keydown', function (e) {
    if (e.key === 'Enter') saveProfileName();
  });
  _on('restore-file-header', 'change', function () {
    handleRestore(this);
    closeProfileDropdown();
  });

  // ── Top bar ────────────────────────────────────────────────────
  _on('btnDevMode', 'click', toggleDevMode);

  // ── Dashboard ──────────────────────────────────────────────────
  _on('btn-dashboard-editor', 'click', openDashboardEditor);

  // ── Transactions ───────────────────────────────────────────────
  _on('csv-import-input', 'change', function () { handleCSVImportFile(this); });
  _on('ofx-import-input', 'change', function () { handleOFXImportFile(this); });
  _on('quick-add-input', 'input', onQuickAddInput);
  _on('quick-add-input', 'keydown', function (e) {
    if (e.key === 'Enter') quickAddSubmit();
  });

  // ── Dividends / staking tabs ───────────────────────────────────
  _on('stk-tab-dividends', 'click', function () { switchDivTab('dividends'); });
  _on('stk-tab-staking',   'click', function () { switchDivTab('staking');   });

  // ── Goals ──────────────────────────────────────────────────────
  _on('goals-sort-select', 'change', renderGoals);

  // ── AI advisor ────────────────────────────────────────────────
  _on('ai-input', 'keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); }
  });
  _on('ai-input', 'input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ── Admin panel ────────────────────────────────────────────────
  _on('btn-dev-refresh',        'click', _refreshDevCard);
  _on('btn-admin-refresh-users','click', adminRefreshUsers);
  _on('btn-admin-load-demo',    'click', _adminLoadDemoData);
  _on('btn-admin-health-check', 'click', adminHealthCheck);

  // ── Settings ──────────────────────────────────────────────────
  _on('btn-notifications-manager', 'click', openNotificationsManager);
  _on('fileRestore', 'change', function () { handleRestore(this); });
  _on('btn-load-demo-settings', 'click', _adminLoadDemoData);
  _on('settings-webhook-url', 'input', function () {
    var btn = document.getElementById('btnTestWebhook');
    if (btn) btn.disabled = !this.value.trim();
  });

  // ── Misc ───────────────────────────────────────────────────────
  _on('btn-back-to-top', 'click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  _on('btn-pwa-install', 'click', installPWA);
  _on('btn-pwa-close', 'click', function () {
    var banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
  });

  // ── Service Worker ─────────────────────────────────────────────
  // sw.js ya llama a self.skipWaiting() + self.clients.claim() para tomar
  // el control lo antes posible, pero la pestaña ya abierta sigue servida
  // por el Service Worker viejo hasta la próxima navegación — de ahí que
  // antes hiciera falta recargar dos veces a mano. Con esto, en cuanto el
  // nuevo Service Worker toma el control, la página se recarga sola UNA
  // vez — el usuario solo tiene que recargar (o simplemente volver a
  // visitar la página) una sola vez.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    var _swReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (_swReloading) return; // por si el evento se dispara más de una vez
      _swReloading = true;
      window.location.reload();
    });
  }

})();
