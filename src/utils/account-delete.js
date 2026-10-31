'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — BORRADO DE CUENTA (RGPD art. 17, derecho de supresión)

   Flujo: confirmar → escribir ELIMINAR → cuenta atrás → reautenticar
   → el servidor borra lo suyo → se limpia el navegador → landing.

   Dos reglas que gobiernan todo este fichero:

   1. El cliente NO borra nada local hasta que el servidor responde 200.
      Si se limpiara antes y el servidor fallara, el usuario se quedaría sin
      sus datos Y con la cuenta viva, sin forma de reintentar.
   2. Tras reautenticar hay que pedir el token con getIdToken(true). El
      servidor exige auth_time reciente, y auth_time solo cambia en un token
      recién emitido: con el de la caché el borrado se rechaza con
      REAUTH_REQUIRED aunque el usuario acabe de meter su contraseña.

   Se carga en diferido desde Ajustes (_LAZY_SCRIPTS.accountDelete).
═══════════════════════════════════════════════════════════════ */

let _adCountdownTimer = null;

/** Muestra un error dentro del modal, en una región que se anuncia. */
function _adError(msg) {
  const el = document.getElementById('ad-error');
  if (!el) { if (typeof showToast === 'function') showToast(msg, 'error'); return; }
  el.textContent   = msg;
  el.style.display = 'block';
}

function _adClearError() {
  const el = document.getElementById('ad-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

/** Traduce los códigos de Firebase a algo que un humano pueda accionar. */
function _adErrMsg(code) {
  return ({
    'auth/wrong-password':         'Contraseña incorrecta. Vuelve a intentarlo.',
    'auth/invalid-credential':     'Contraseña incorrecta. Vuelve a intentarlo.',
    'auth/invalid-login-credentials': 'Contraseña incorrecta. Vuelve a intentarlo.',
    'auth/missing-password':       'Introduce tu contraseña para confirmar.',
    'auth/too-many-requests':      'Demasiados intentos. Espera unos minutos antes de volver a probar.',
    'auth/network-request-failed': 'Sin conexión. Comprueba tu red y vuelve a intentarlo.',
    'auth/popup-blocked':          'El navegador bloqueó la ventana de Google. Permite los popups e inténtalo de nuevo.',
    'auth/popup-closed-by-user':   'Has cerrado la ventana de Google sin confirmar. No se ha borrado nada.',
    'auth/user-mismatch':          'Has iniciado sesión con otra cuenta distinta a la que quieres borrar.',
    'auth/requires-recent-login':  'Vuelve a confirmar tu identidad para continuar.',
  })[code] || `No se pudo confirmar tu identidad (${code || 'error desconocido'}).`;
}

/** 'password' | 'google.com' | null */
function _adProvider(user) {
  if (!user) return null;
  const ids = (user.providerData || []).map(p => p && p.providerId).filter(Boolean);
  if (ids.includes('password'))   return 'password';
  if (ids.includes('google.com')) return 'google.com';
  return ids[0] || null;
}

function _adCurrentUser() {
  try {
    const auth = (typeof _fbAuth !== 'undefined' && _fbAuth) ? _fbAuth
               : (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null);
    return auth?.currentUser || null;
  } catch (_) { return null; }
}

/* ─── Limpieza del navegador ──────────────────────────────────── */

/**
 * Borra TODO rastro del usuario en este navegador. Se llama solo tras un 200.
 *
 * Nada de esto lanza: si una pieza falla (IndexedDB bloqueado por otra
 * pestaña, Cache API no disponible) se sigue con el resto, porque dejar
 * localStorage a medias sería peor que un fallo parcial silencioso. Devuelve
 * lo que no se pudo borrar para poder avisar.
 */
async function _adWipeBrowserData() {
  const failed = [];

  // 1. localStorage y sessionStorage: se recorren las claves en vez de usar
  //    una lista fija, porque la del dataset lleva el uid dentro
  //    (finova_<uid>_data_v1) y las versiones antiguas dejaron claves que ya
  //    no están en el código actual.
  //
  //    Se incluye el prefijo 'firebase:' además del nuestro: el SDK guarda la
  //    sesión en 'firebase:authUser:<apiKey>:[DEFAULT]', que contiene el
  //    correo y el uid del usuario. signOut() normalmente la limpia, pero si
  //    falla quedaría ahí un dato personal después de un borrado de cuenta.
  const _MINE = k => {
    const low = String(k).toLowerCase();
    return low.startsWith('finova') || low.startsWith('firebase:');
  };
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      const s = window[store];
      const keys = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && _MINE(k)) keys.push(k);
      }
      keys.forEach(k => { try { s.removeItem(k); } catch (_) {} });
    } catch (_) { failed.push(store); }
  }

  // 2. IndexedDB: las fotos de tickets, la copia del estado completo y la
  //    base donde el SDK de Firebase guarda la sesión (también con el correo
  //    y el uid dentro).
  //    indexedDB.databases() no existe en Firefox ni en Safari antiguo, así
  //    que la lista conocida va primero y la enumeración solo añade.
  const dbs = new Set(['finova_photos', 'finova_state', 'firebaseLocalStorageDb']);
  try {
    if (typeof indexedDB.databases === 'function') {
      for (const d of await indexedDB.databases()) {
        const low = String(d && d.name || '').toLowerCase();
        if (low.startsWith('finova') || low.startsWith('firebase')) dbs.add(d.name);
      }
    }
  } catch (_) { /* se sigue con la lista conocida */ }

  await Promise.all([...dbs].map(name => new Promise(resolve => {
    try {
      const req = indexedDB.deleteDatabase(name);
      // onblocked = otra pestaña tiene la base abierta. No se espera
      // indefinidamente: se avisa y se sigue.
      req.onsuccess = req.onerror = () => resolve();
      req.onblocked = () => { failed.push('IndexedDB (' + name + ')'); resolve(); };
      setTimeout(resolve, 3000);
    } catch (_) { failed.push('IndexedDB (' + name + ')'); resolve(); }
  })));

  // 3. Cachés del Service Worker. El shell estático puede quedarse —no tiene
  //    datos personales— pero finova-api-v1 guarda respuestas de /api/yahoo
  //    cuyas propias URL revelan los tickers de la cartera.
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter(k => /api/i.test(k))
        .map(k => caches.delete(k).catch(() => { failed.push('caché ' + k); })));
    }
  } catch (_) { failed.push('cachés'); }

  // 4. La cookie del código de sincronización (30 días de vida).
  try {
    document.cookie = 'finova_sync=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict';
  } catch (_) { failed.push('cookie'); }

  return failed;
}

/* ─── Modo demo / sin cuenta ──────────────────────────────────── */

function _adDemoDialog() {
  openModal('Eliminar los datos de esta demo', `
    <div class="modal-danger-box">
      <span class="modal-danger-icon"><svg class="icon icon-lg" aria-hidden="true"><use href="#icon-alert-triangle"></use></svg></span>
      <div>
        <div class="modal-danger-title">No hay ninguna cuenta que borrar</div>
        <div class="modal-danger-body">
          Estás en <strong>modo demo</strong>: nunca se ha creado una cuenta ni se ha
          enviado nada a nuestros servidores. Todo lo que ves vive solo en este
          navegador.
        </div>
        <div class="modal-note">
          <svg class="icon icon-xs" aria-hidden="true"><use href="#icon-info"></use></svg>
          Al confirmar se borrarán los datos locales de la demo y volverás a empezar.
        </div>
      </div>
    </div>`, async () => {
    await _adWipeBrowserData();
    location.href = 'landing.html';
  });
  const btn = document.getElementById('modalConfirm');
  if (btn) { btn.textContent = 'Borrar datos locales'; btn.className = 'btn-danger'; }
}

/* ─── Paso 1: confirmación ────────────────────────────────────── */

function openDeleteAccountDialog() {
  if (_adCountdownTimer) { clearInterval(_adCountdownTimer); _adCountdownTimer = null; }

  // En demo no hay cuenta ni servidor: solo datos locales.
  if ((typeof _isDemoMode !== 'undefined' && _isDemoMode) || !_adCurrentUser()) {
    return _adDemoDialog();
  }

  let secs = 5;
  openModal('Eliminar mi cuenta', `
    <div class="modal-danger-box">
      <span class="modal-danger-icon"><svg class="icon icon-lg" aria-hidden="true"><use href="#icon-alert-triangle"></use></svg></span>
      <div>
        <div class="modal-danger-title">Esta acción es permanente e irreversible</div>
        <div class="modal-danger-body">
          Se eliminarán tu cuenta y <strong>todos</strong> tus datos:
          transacciones, cartera de inversión, objetivos, viajes, bizums,
          historial de patrimonio, fotos de tickets, API keys, las copias de
          seguridad guardadas en el servidor y tus códigos de sincronización.
          <br><br>
          No podremos recuperarlos después, y tendrás que registrarte de nuevo
          si quieres volver a usar Finova.
        </div>
        <div class="modal-note">
          <svg class="icon icon-xs" aria-hidden="true"><use href="#icon-info"></use></svg>
          Si solo quieres dejar de usar la app, cerrar sesión no borra nada.
        </div>
      </div>
    </div>

    <div style="margin:4px 0 14px">
      <button type="button" class="btn-secondary" id="ad-backup-btn" style="width:100%">
        <svg class="icon icon-xs" aria-hidden="true"><use href="#icon-download"></use></svg>
        Descargar copia de mis datos antes
      </button>
    </div>

    <div class="form-group">
      <label class="form-label" for="ad-confirm-input">
        Escribe <strong>ELIMINAR</strong> para continuar
      </label>
      <input type="text" id="ad-confirm-input" class="text-input"
        autocomplete="off" spellcheck="false" placeholder="ELIMINAR"
        aria-describedby="ad-error" />
    </div>

    <div id="ad-error" class="login-msg login-msg--err" role="alert"
      aria-live="assertive" style="display:none;margin-bottom:12px"></div>

    <div class="modal-footer-btns">
      <span class="modal-wait-msg" id="ad-wait-msg">Espera <strong id="ad-secs">5</strong>s para confirmar…</span>
      <div class="modal-footer-btns-right">
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button id="ad-confirm-btn" class="btn-danger" disabled
          style="opacity:.4;cursor:not-allowed">Eliminar mi cuenta (5)</button>
      </div>
    </div>`, null);

  // El footer propio del modal se oculta: este diálogo trae sus botones.
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';

  const input   = document.getElementById('ad-confirm-input');
  const confirm = document.getElementById('ad-confirm-btn');
  const backup  = document.getElementById('ad-backup-btn');

  // Reutiliza la exportación de backup que ya existe en Ajustes.
  if (backup) backup.onclick = () => {
    if (typeof downloadBackup === 'function') downloadBackup();
    else _adError('La exportación de backup no está disponible en esta pantalla.');
  };

  // El botón se habilita cuando se cumplen LAS DOS cosas: texto exacto y
  // cuenta atrás terminada.
  let elapsed = false;
  const refresh = () => {
    if (!confirm) return;
    const typed = (input?.value || '').trim().toUpperCase() === 'ELIMINAR';
    const on    = typed && elapsed;
    confirm.disabled      = !on;
    confirm.style.opacity = on ? '1' : '.4';
    confirm.style.cursor  = on ? 'pointer' : 'not-allowed';
  };
  if (input) input.addEventListener('input', () => { _adClearError(); refresh(); });

  setTimeout(() => {
    _adCountdownTimer = setInterval(() => {
      secs--;
      const btn    = document.getElementById('ad-confirm-btn');
      const secsEl = document.getElementById('ad-secs');
      // Si el modal se cerró, el intervalo se queda huérfano: hay que pararlo.
      if (!btn) { clearInterval(_adCountdownTimer); _adCountdownTimer = null; return; }
      if (secs <= 0) {
        clearInterval(_adCountdownTimer); _adCountdownTimer = null;
        elapsed = true;
        btn.textContent = 'Eliminar mi cuenta';
        const msg = document.getElementById('ad-wait-msg');
        if (msg) msg.style.display = 'none';
        refresh();
      } else {
        btn.textContent = `Eliminar mi cuenta (${secs})`;
        if (secsEl) secsEl.textContent = secs;
      }
    }, 1000);
  }, 0);

  if (confirm) confirm.onclick = () => _adReauthStep();
}

/* ─── Paso 2: reautenticación ─────────────────────────────────── */

function _adReauthStep() {
  const user = _adCurrentUser();
  if (!user) return _adError('Tu sesión ha caducado. Vuelve a iniciar sesión.');
  const provider = _adProvider(user);

  if (provider === 'password') {
    openModal('Confirma tu identidad', `
      <p style="margin:0 0 14px;font-size:14px;color:var(--text-secondary);line-height:1.6">
        Por seguridad, introduce tu contraseña para confirmar que eres tú quien
        borra la cuenta <strong>${escapeHtml(user.email || '')}</strong>.
      </p>
      <div class="form-group">
        <label class="form-label" for="ad-password">Contraseña</label>
        <input type="password" id="ad-password" class="text-input"
          autocomplete="current-password" placeholder="••••••••"
          aria-describedby="ad-error" />
      </div>
      <div id="ad-error" class="login-msg login-msg--err" role="alert"
        aria-live="assertive" style="display:none;margin-bottom:12px"></div>
      <div class="modal-footer-btns">
        <div class="modal-footer-btns-right">
          <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
          <button id="ad-final-btn" class="btn-danger">Confirmar y eliminar</button>
        </div>
      </div>`, null);

    const footer = document.getElementById('modal')?.querySelector('.modal-footer');
    if (footer) footer.style.display = 'none';

    const run = () => _adRunDelete('password');
    const pw  = document.getElementById('ad-password');
    if (pw) pw.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    const fb = document.getElementById('ad-final-btn');
    if (fb) fb.onclick = run;
    return;
  }

  // Google (y cualquier otro proveedor federado): no hay contraseña que pedir,
  // la confirmación es el propio popup.
  openModal('Confirma tu identidad', `
    <p style="margin:0 0 14px;font-size:14px;color:var(--text-secondary);line-height:1.6">
      Por seguridad, vuelve a iniciar sesión con Google para confirmar que eres
      tú quien borra la cuenta <strong>${escapeHtml(user.email || '')}</strong>.
    </p>
    <div id="ad-error" class="login-msg login-msg--err" role="alert"
      aria-live="assertive" style="display:none;margin-bottom:12px"></div>
    <div class="modal-footer-btns">
      <div class="modal-footer-btns-right">
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button id="ad-final-btn" class="btn-danger">Confirmar con Google y eliminar</button>
      </div>
    </div>`, null);

  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
  const fb = document.getElementById('ad-final-btn');
  if (fb) fb.onclick = () => _adRunDelete('google.com');
}

/* ─── Paso 3: reautenticar, borrar, limpiar ───────────────────── */

// El proyecto no tiene componente de spinner: los botones en curso se
// deshabilitan y cambian el texto (igual que _withPdf con "Generando…").
function _adSetBusy(on, label) {
  const btn = document.getElementById('ad-final-btn');
  if (!btn) return;
  if (on && !btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
  btn.disabled      = on;
  btn.style.opacity = on ? '.6' : '1';
  btn.style.cursor  = on ? 'wait' : 'pointer';
  btn.textContent   = on ? (label || 'Eliminando…') : (btn.dataset.origLabel || 'Confirmar y eliminar');
  const cancel = btn.previousElementSibling;
  if (cancel) cancel.disabled = on;
}

async function _adReauthenticate(provider) {
  const user = _adCurrentUser();
  if (!user) throw Object.assign(new Error('sin sesión'), { code: 'auth/user-mismatch' });

  if (provider === 'password') {
    const pwd = document.getElementById('ad-password')?.value || '';
    if (!pwd) throw Object.assign(new Error('sin contraseña'), { code: 'auth/missing-password' });
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, pwd);
    await user.reauthenticateWithCredential(cred);
  } else {
    await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
  }

  // Imprescindible: auth_time solo se actualiza en un token recién emitido.
  // Con el de la caché el servidor responde REAUTH_REQUIRED aunque el usuario
  // acabe de reautenticarse ahora mismo.
  return user.getIdToken(true);
}

async function _adRunDelete(provider) {
  _adClearError();
  _adSetBusy(true, 'Confirmando…');

  let token;
  try {
    token = await _adReauthenticate(provider);
  } catch (err) {
    _adSetBusy(false);
    // requires-recent-login aquí significa que la propia reautenticación se
    // quedó obsoleta: se vuelve a pedir en vez de dar el borrado por fallido.
    // requires-recent-login aqui significa que la propia reautenticacion se
    // quedo obsoleta. El boton sigue activo: pulsarlo vuelve a pedirla, que es
    // lo que pedia el encargo (reintentar en vez de fallar).
    if (err?.code === 'auth/requires-recent-login') {
      return _adError('Necesitamos confirmarlo otra vez. Vuelve a pulsar el botón.');
    }
    return _adError(_adErrMsg(err?.code));
  }

  _adSetBusy(true, 'Eliminando…');

  let res, json = {};
  try {
    res  = await api.account.delete({ clientId: APP.clientId || null }, token);
    try { json = await res.json(); } catch (_) { json = {}; }
  } catch (err) {
    _adSetBusy(false);
    return _adError('No se pudo contactar con el servidor. Tus datos siguen intactos — inténtalo de nuevo.');
  }

  if (!res.ok) {
    _adSetBusy(false);
    // El servidor pide reautenticar: se vuelve al paso anterior en vez de
    // fallar, que es justo lo que pedía el encargo.
    if (json.code === 'REAUTH_REQUIRED') {
      return _adError('La confirmación ha caducado. Vuelve a pulsar el botón para confirmar de nuevo.');
    }
    if (res.status === 429) {
      return _adError(json.error || 'Demasiados intentos. Espera una hora antes de volver a probar.');
    }
    // NO se borra nada local: el usuario tiene que poder reintentar.
    return _adError(json.error || 'El servidor no pudo completar el borrado. Tus datos siguen intactos.');
  }

  /* A partir de aquí el servidor ya borró lo suyo. */
  _adSetBusy(true, 'Limpiando este dispositivo…');

  // Si el servidor no tiene el Admin SDK no pudo tocar Firebase Auth, así que
  // la cuenta la borra el cliente — puede, porque acaba de reautenticarse.
  if (json.authDeleted === false) {
    try { await _adCurrentUser()?.delete(); }
    catch (err) {
      // user-not-found = ya no está. Cualquier otra cosa se registra, pero no
      // se detiene la limpieza: los datos del servidor ya no existen.
      if (err?.code !== 'auth/user-not-found') {
        console.error('[Finova] No se pudo borrar la cuenta de Auth desde el cliente:', err?.code);
      }
    }
  }

  // Si lo de arriba borró la cuenta, ya no hay sesión que cerrar.
  try { if (_adCurrentUser()) await _fbAuth?.signOut?.(); } catch (_) {}

  const failed = await _adWipeBrowserData();
  if (failed.length) {
    console.error('[Finova] Restos que no se pudieron borrar en este navegador:', failed);
  }

  // Se mide ANTES de redirigir: después ya no corre nada de esta página. Sin
  // ninguna propiedad: saber cuántas bajas hay es útil, saber de quién no.
  if (typeof track === 'function') track('cuenta_borrada');

  // El mensaje final lo muestra la landing: aquí ya no queda storage donde
  // dejarlo, así que viaja en la URL.
  location.replace('landing.html?deleted=1');
}
