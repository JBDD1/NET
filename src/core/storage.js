'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — STORAGE
   All persistence: localStorage, IndexedDB (state + photos),
   API key encryption (AES-GCM), version history, server sync.
   Depends on: state.js, utils.js, calcs.js.
═══════════════════════════════════════════════════════════════ */

const STORAGE_KEY  = 'finova_data_v1'; // clave legacy (sin auth)
const _HAS_SERVER  = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

function _getStorageKey() {
  return (typeof APP !== 'undefined' && APP && APP.uid)
    ? `finova_${APP.uid}_data_v1`
    : STORAGE_KEY;
}

/* ── Almacenamiento cifrado de API Keys (AES-GCM via Web Crypto) ── */
const AI_KEYS = {
  claude: 'finova_api_key',
  openai: 'finova_openai_key',
  gemini: 'finova_gemini_key',
  groq:   'finova_groq_key',
};
const AI_KEYS_ENC = {
  claude: 'finova_api_key_enc',
  openai: 'finova_openai_key_enc',
  gemini: 'finova_gemini_key_enc',
  groq:   'finova_groq_key_enc',
};
const ENC_KEY_STORE = 'finova_enc_k';
let _cryptoKey = null;

async function _getOrCreateCryptoKey() {
  if (_cryptoKey) return _cryptoKey;
  try {
    let stored = sessionStorage.getItem(ENC_KEY_STORE);
    if (!stored) {
      const legacy = localStorage.getItem(ENC_KEY_STORE);
      if (legacy) {
        stored = legacy;
        sessionStorage.setItem(ENC_KEY_STORE, stored);
        localStorage.removeItem(ENC_KEY_STORE);
      } else {
        const raw = crypto.getRandomValues(new Uint8Array(32));
        stored = btoa(String.fromCharCode(...raw));
        sessionStorage.setItem(ENC_KEY_STORE, stored);
      }
    }
    const bytes = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    _cryptoKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return _cryptoKey;
  } catch { return null; }
}

async function saveApiKey(provider, value) {
  const encStorageKey = AI_KEYS_ENC[provider];
  if (!encStorageKey) return;
  localStorage.removeItem(AI_KEYS[provider]);
  if (!value) { localStorage.removeItem(encStorageKey); return; }
  try {
    const key = await _getOrCreateCryptoKey();
    if (!key) { localStorage.setItem(encStorageKey, value); return; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)
    );
    const combined = new Uint8Array(12 + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), 12);
    localStorage.setItem(encStorageKey, btoa(String.fromCharCode(...combined)));
  } catch { localStorage.setItem(encStorageKey, value); }
}

async function loadApiKey(provider) {
  const encStorageKey = AI_KEYS_ENC[provider];
  const legacyPlain = localStorage.getItem(AI_KEYS[provider]);
  if (legacyPlain) {
    await saveApiKey(provider, legacyPlain);
    return legacyPlain;
  }
  const stored = localStorage.getItem(encStorageKey);
  if (!stored) return '';
  try {
    const key = await _getOrCreateCryptoKey();
    if (!key) return stored;
    const combined = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12)
    );
    return new TextDecoder().decode(plaintext);
  } catch { return ''; }
}

async function loadAllApiKeys() {
  APP.claudeApiKey = await loadApiKey('claude');
  APP.openaiApiKey = await loadApiKey('openai');
  APP.geminiApiKey = await loadApiKey('gemini');
  APP.groqApiKey   = await loadApiKey('groq');
}

function getStorageUsage() {
  let bytes = 0;
  try {
    for (const key of Object.keys(localStorage)) {
      bytes += (key.length + (localStorage.getItem(key) || '').length) * 2;
    }
  } catch {}
  const limit = 5 * 1024 * 1024;
  return { bytes, limit, pct: (bytes / limit) * 100 };
}

let _warnedAt80 = false;
let _warnedAt95 = false;

function checkStorageWarning() {
  const { pct } = getStorageUsage();
  if (pct >= 95 && !_warnedAt95) {
    _warnedAt95 = true;
    showToast('⚠ Almacenamiento casi lleno (>95%). Exporta un backup ahora desde Ajustes.', 'error');
  } else if (pct >= 80 && !_warnedAt80) {
    _warnedAt80 = true;
    showToast(`Almacenamiento local al ${Math.round(pct)}%. Considera exportar un backup.`, 'error');
  }
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      if (!quota) return;
      const realPct = (usage / quota) * 100;
      if (realPct >= 90 && !_warnedAt95) {
        _warnedAt95 = true;
        showToast(`⚠ Almacenamiento del navegador al ${Math.round(realPct)}%. Exporta un backup.`, 'error');
      }
    }).catch(() => {});
  }
}

/* ── Guardado en localStorage ── */
let _lastSavedNW = null;
let _pendingOfflineChanges = 0;

function _renderOfflineBanner() {
  let bar = document.getElementById('offline-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offline-banner';
    bar.className = 'offline-banner';
    document.body.prepend(bar);
  }
  const n = _pendingOfflineChanges;
  bar.innerHTML = `<span>📶 Sin conexión — ${n} ${n === 1 ? 'cambio pendiente' : 'cambios pendientes'} de sincronizar</span><button class="offline-banner-dismiss" onclick="document.getElementById('offline-banner').remove()">✕</button>`;
}

window.addEventListener('online', () => {
  const bar = document.getElementById('offline-banner');
  if (bar) bar.remove();
  if (_pendingOfflineChanges > 0 && APP.syncCode) {
    const n = _pendingOfflineChanges;
    _pendingOfflineChanges = 0;
    showToast(`Conexión restaurada — sincronizando ${n} ${n === 1 ? 'cambio' : 'cambios'}…`, 'success');
    syncUpload();
  } else {
    _pendingOfflineChanges = 0;
    showToast('Conexión restaurada', 'success');
  }
});

window.addEventListener('offline', () => {
  showToast('Sin conexión — los cambios se guardan localmente', 'error');
  if (APP.syncCode && !document.getElementById('offline-banner')) _renderOfflineBanner();
});

function _saveDataNow() {
  if (_isDemoMode) return;
  _haptic(8);
  const nw = calcNetWorth();
  updateNetworthHistory(nw);
  if (nw !== _lastSavedNW) {
    _lastSavedNW = nw;
    checkMilestones(nw);
  }
  try {
    const { claudeApiKey, openaiApiKey, geminiApiKey, groqApiKey,
            uid, userEmail, userPhoto, isAdmin,
            ...toSave } = APP;
    const MAX_PATTERNS = 500;
    if (toSave.categoryPatterns) {
      const entries = Object.entries(toSave.categoryPatterns);
      if (entries.length > MAX_PATTERNS) {
        const trimmed = {};
        entries
          .sort((a, b) => {
            const ha = typeof a[1] === 'object' ? (a[1].hits || 0) : 0;
            const hb = typeof b[1] === 'object' ? (b[1].hits || 0) : 0;
            return hb - ha;
          })
          .slice(0, MAX_PATTERNS)
          .forEach(([k, v]) => { trimmed[k] = v; });
        APP.categoryPatterns = trimmed;
        toSave.categoryPatterns = trimmed;
      }
    }
    localStorage.setItem(_getStorageKey(), JSON.stringify(toSave));
    _saveStateToIDB(toSave);
    if (toSave.syncCode) _setSyncCodeCookie(toSave.syncCode);
    if (APP.uid) _debouncedServerSync();
    _saveVersionSnapshot();
    checkStorageWarning();
    _flashAutosave();
    if (!navigator.onLine && toSave.syncCode) {
      _pendingOfflineChanges++;
      _renderOfflineBanner();
    }
    return true;
  } catch (e) {
    console.error('Error guardando datos:', e);
    const isQuota = e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
    if (isQuota) {
      const txCount   = APP.transactions.length;
      const cutoffYear = new Date().getFullYear() - 3;
      const oldCount  = APP.transactions.filter(t => t.date < `${cutoffYear}-01-01`).length;
      const txKB      = Math.round(JSON.stringify(APP.transactions).length / 512);
      const oldHint   = oldCount > 0
        ? `<p style="margin:8px 0 0;font-size:13px;color:var(--text-muted)">
             Tienes <strong>${oldCount}</strong> transacciones de antes de ${cutoffYear} que podrías
             archivar desde <strong>Ajustes → Datos</strong> para liberar espacio.
           </p>`
        : '';
      openModal(
        '⚠ Almacenamiento lleno',
        `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:var(--text-secondary)">
           <strong>Los últimos cambios no se han guardado.</strong>
         </p>
         <p style="margin:0 0 4px;font-size:13px;color:var(--text-muted)">
           Transacciones: <strong>${txCount}</strong> (~${txKB} KB) · Límite del navegador: ~5 MB
         </p>
         ${oldHint}
         <p style="margin:10px 0 0;font-size:13px;color:var(--text-muted)">
           Descarga un backup ahora para no perder datos.
         </p>`,
        downloadBackup
      );
      const btn = document.getElementById('modalConfirm');
      if (btn) btn.textContent = 'Descargar backup';
    } else {
      showToast('Error al guardar datos. Comprueba la consola.', 'error');
    }
    return false;
  }
}

/* ─── Historial de versiones local ── */
const HISTORY_KEY    = 'finova_history_v1';
const HISTORY_MAX    = 5;
let   _lastHistoryTs = 0;

function _saveVersionSnapshot() {
  if (_isDemoMode) return;
  const now = Date.now();
  if (now - _lastHistoryTs < 60000) return;
  _lastHistoryTs = now;
  try {
    const { claudeApiKey, openaiApiKey, geminiApiKey, groqApiKey, ...snap } = APP;
    const entry = {
      ts:       now,
      txCount:  (APP.transactions || []).length,
      networth: calcNetWorth(),
      data:     snap,
    };
    const raw     = localStorage.getItem(HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    history.unshift(entry);
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    // quota or parse error — silently skip
  }
}

function restoreVersionSnapshot(index) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    const history = JSON.parse(raw);
    const entry   = history[index];
    if (!entry?.data) return;
    const label = new Date(entry.ts).toLocaleString('es-ES', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    openModal(
      'Restaurar versión',
      `<p style="margin:0 0 10px;font-size:14px;color:var(--text-secondary);line-height:1.6">
         ¿Restaurar la versión del <strong>${label}</strong>?
       </p>
       <p style="margin:0;font-size:13px;color:var(--text-muted)">
         ${entry.txCount} transacciones · ${formatCurrency(entry.networth)} patrimonio
       </p>
       <p style="margin:8px 0 0;font-size:12px;color:var(--down)">Esta acción reemplazará los datos actuales.</p>`,
      () => {
        closeModal();
        APP = { ...APP, ...entry.data };
        _attachAPPRedaction();
        _saveDataNow();
        navigateTo('dashboard');
        showToast('Versión restaurada ✓', 'success');
      }
    );
    const btn = document.getElementById('modalConfirm');
    if (btn) btn.textContent = 'Restaurar';
  } catch (e) {
    showToast('Error al restaurar la versión', 'error');
  }
}

function renderVersionHistory() {
  const el = document.getElementById('version-history-list');
  if (!el) return;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    if (!history.length) {
      el.innerHTML = '<p style="font-size:12px;color:var(--text-muted);margin:0">Aún no hay versiones guardadas. Se generan automáticamente al usar la app.</p>';
      return;
    }
    el.innerHTML = history.map((entry, i) => {
      const label = new Date(entry.ts).toLocaleString('es-ES', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      return `
        <div class="settings-row" style="margin-top:${i > 0 ? '10' : '0'}px">
          <div class="settings-info">
            <div class="settings-name" style="font-size:13px">${label}</div>
            <div class="settings-desc">${entry.txCount} transacciones · ${formatCurrency(entry.networth)}</div>
          </div>
          <button type="button" class="btn-secondary" style="font-size:12px;white-space:nowrap"
            onclick="restoreVersionSnapshot(${i})">Restaurar</button>
        </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<p style="font-size:12px;color:var(--text-muted);margin:0">No se pudo leer el historial.</p>';
  }
}

const _debouncedSaveNow = debounce(_saveDataNow, 350);
function saveData() {
  _invalidateCalcCache();
  if (typeof markDashboardDirty === 'function') markDashboardDirty();
  _debouncedSaveNow();
}

// Sincronización al servidor (debounced 3 s) — solo cuando el usuario está autenticado
const _debouncedServerSync = debounce(async () => {
  if (!APP.uid || _isDemoMode) return;
  const data = localStorage.getItem(_getStorageKey());
  if (!data) return;
  try {
    let token = '';
    try {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        token = await firebase.auth().currentUser?.getIdToken() || '';
      }
    } catch (_) {}
    await fetch('/api/user-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ uid: APP.uid, data }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (_) {}
}, 3000);

function loadData() {
  try {
    const raw = localStorage.getItem(_getStorageKey());
    if (raw) {
      const saved = JSON.parse(raw);
      APP = { ...APP, ...saved };

      ['income', 'expense'].forEach(type => {
        const existing = APP.categories[type] || [];
        DEFAULT_CATEGORIES[type].forEach(cat => {
          if (!existing.includes(cat)) existing.push(cat);
        });
        APP.categories[type] = existing;
      });
    }
  } catch (e) {
    console.error('Error cargando datos:', e);
  }

  const _arrays = [
    'transactions','portfolio','goals','cashAccounts','liabilities','alternatives',
    'watchlist','dividends','recurring','bizums','networthHistory','portfolioSnapshots',
    'sales','scenarios','properties','customAlerts',
  ];
  _arrays.forEach(k => { if (!Array.isArray(APP[k])) APP[k] = []; });
  if (!APP.categories || typeof APP.categories !== 'object') APP.categories = { income: [], expense: [] };
  if (!Array.isArray(APP.categories.income))  APP.categories.income  = [];
  if (!Array.isArray(APP.categories.expense)) APP.categories.expense = [];

  if (!APP.clientId) APP.clientId = crypto.randomUUID();

  const raw = localStorage.getItem(_getStorageKey());
  if (!raw || !JSON.parse(raw || '{}').theme) {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) APP.theme = 'light';
  }

  _attachAPPRedaction();
}

function _attachAPPRedaction() {
  Object.defineProperty(APP, 'toJSON', {
    value() {
      const r = { ...this };
      for (const k of Object.keys(r)) { if (k.endsWith('ApiKey')) r[k] = '[REDACTED]'; }
      return r;
    },
    enumerable: false, writable: true, configurable: true,
  });
}

function _pingSession() {
  if (_isDemoMode || !APP.clientId || !_HAS_SERVER) return;
  fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: APP.clientId, txCount: APP.transactions.length }),
    keepalive: true,
  }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════
   INDEXEDDB — espejo de estado (protección contra borrado Safari)
═══════════════════════════════════════════════════════════════ */
const _STATE_IDB_NAME  = 'finova_state';
const _STATE_IDB_STORE = 'backup';
let   _stateDb         = null;

function _initStateDB() {
  return new Promise((resolve, reject) => {
    if (_stateDb) { resolve(_stateDb); return; }
    const req = indexedDB.open(_STATE_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_STATE_IDB_STORE);
    req.onsuccess = e => { _stateDb = e.target.result; resolve(_stateDb); };
    req.onerror   = () => reject(req.error);
  });
}

function _saveStateToIDB(payload) {
  _initStateDB().then(db => {
    const tx = db.transaction(_STATE_IDB_STORE, 'readwrite');
    tx.objectStore(_STATE_IDB_STORE).put({ data: payload, ts: Date.now() }, 'main');
  }).catch(() => {});
}

async function _loadStateFromIDB() {
  try {
    const db  = await _initStateDB();
    const tx  = db.transaction(_STATE_IDB_STORE, 'readonly');
    const req = tx.objectStore(_STATE_IDB_STORE).get('main');
    return new Promise(res => { req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); });
  } catch { return null; }
}

function _setSyncCodeCookie(code) {
  if (!code) return;
  const exp = new Date(Date.now() + 30 * 86400000).toUTCString();
  document.cookie = `finova_sync=${code}; expires=${exp}; path=/; SameSite=Strict`;
}
function _getSyncCodeCookie() {
  const m = document.cookie.match(/(?:^|;\s*)finova_sync=([a-f0-9]{8,16})/);
  return m ? m[1] : null;
}

async function _checkStorageRecovery() {
  if (_isDemoMode) return;
  const hasData = APP.transactions.length > 0 || APP.portfolio.length > 0 ||
                  APP.cashAccounts.length > 0  || APP.alternatives.length > 0;
  if (hasData) return;

  const backup = await _loadStateFromIDB();
  if (backup?.data) {
    const saved  = backup.data;
    const hasTx  = (saved.transactions?.length || 0) + (saved.portfolio?.length || 0) +
                   (saved.cashAccounts?.length  || 0) + (saved.alternatives?.length || 0);
    if (hasTx > 0) {
      const date = new Date(backup.ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      openModal(
        'Restaurar datos',
        `<p>Se ha detectado una copia de seguridad automática del <strong>${date}</strong> con ${hasTx} entradas.</p>
         <p>¿Deseas restaurarla? Si borraste los datos intencionalmente, pulsa <em>Cancelar</em>.</p>`,
        () => {
          APP = { ...APP, ...saved };
          _attachAPPRedaction();
          _saveDataNow();
          navigateTo(APP.activeSection || 'dashboard');
          showToast(`Datos restaurados desde copia IDB del ${date} ✓`, 'success');
        }
      );
      return;
    }
  }

  const code = _getSyncCodeCookie();
  if (code) {
    APP.syncCode = code;
    saveData();
    setTimeout(() => showToast(
      `El navegador borró los datos locales. Código de sincronización recuperado: ${code}. Ve a Ajustes → Sincronización → ↓ Restaurar.`,
      'info'
    ), 1500);
  }
}

/* ═══════════════════════════════════════════════════════════════
   INDEXEDDB — almacenamiento de fotos
═══════════════════════════════════════════════════════════════ */
const _IDB_NAME  = 'finova_photos';
const _IDB_VER   = 1;
const _IDB_STORE = 'photos';
let   _photoDb   = null;
let   _idbFailed = false;
let   _photoLostCount = 0;

function _initPhotoDB() {
  return new Promise((resolve, reject) => {
    if (_photoDb) { resolve(_photoDb); return; }
    const req = indexedDB.open(_IDB_NAME, _IDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_IDB_STORE)) {
        db.createObjectStore(_IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { _photoDb = e.target.result; resolve(_photoDb); };
    req.onerror   = () => { _idbFailed = true; reject(req.error); };
  });
}

async function savePhoto(id, dataUrl) {
  try {
    const db    = await _initPhotoDB();
    const tx    = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put({ id, dataUrl });
    return new Promise((res, rej) => { tx.oncomplete = () => res(id); tx.onerror = () => rej(tx.error); });
  } catch (e) {
    console.error('savePhoto error:', e);
    const isQuota = e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
    if (isQuota) {
      openModal(
        '⚠ Almacenamiento de fotos lleno',
        `<p style="margin:0 0 10px;font-size:14px">No hay espacio para guardar la foto del ticket.</p>
         <p style="font-size:13px;color:var(--text-muted)">
           Puedes liberar espacio eliminando fotos antiguas desde
           <strong>Ajustes → Datos → Gestionar fotos</strong>, o descarga un backup
           y borra tickets con foto de meses anteriores.
         </p>`,
        () => {
          const settingsBtn = document.querySelector('[data-section="settings"]');
          if (settingsBtn) settingsBtn.click();
        }
      );
      const btn = document.getElementById('modalConfirm');
      if (btn) btn.textContent = 'Ir a Ajustes';
    } else {
      showToast('No se pudo guardar la foto. Comprueba que el navegador permite IndexedDB.', 'error');
    }
    throw e;
  }
}

async function loadPhoto(id) {
  if (!id) return null;
  if (!_idbFailed) {
    try {
      const db  = await _initPhotoDB();
      const tx  = db.transaction(_IDB_STORE, 'readonly');
      const req = tx.objectStore(_IDB_STORE).get(id);
      const hit = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result?.dataUrl || null);
        req.onerror   = () => rej(req.error);
      });
      if (hit) return hit;
    } catch { _idbFailed = true; }
  }
  const match = APP.transactions.find(t => t.photoId === id);
  if (match?.photo) return match.photo;
  if (!_isDemoMode) _photoLostCount++;
  return null;
}

async function deletePhoto(id) {
  if (!id) return;
  try {
    const db = await _initPhotoDB();
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).delete(id);
  } catch (e) {
    console.error('deletePhoto error:', e);
  }
}

async function _migratePhotosToIDB() {
  const toMigrate = APP.transactions.filter(t => t.photo && !t.photoId);
  if (toMigrate.length === 0) return;
  let migrated = 0, failed = 0;
  for (const tx of toMigrate) {
    try {
      const photoId = generateId();
      await savePhoto(photoId, tx.photo);
      const idx = APP.transactions.findIndex(t => t.id === tx.id);
      if (idx >= 0) APP.transactions[idx].photoId = photoId;
      migrated++;
    } catch { failed++; }
  }
  if (migrated > 0) {
    saveData();
    console.log(`Migradas ${migrated} fotos a IndexedDB`);
  }
  if (failed > 0) {
    console.warn(`_migratePhotosToIDB: ${failed} foto(s) no migradas`);
    if (migrated === 0) showToast('Almacenamiento de fotos no disponible en este modo de navegación. Las fotos existentes se conservan temporalmente.', 'error');
  }
}

function _renderPhotoSettings() {
  const lostEl    = document.getElementById('photo-loss-banner');
  const backupRow = document.getElementById('photo-backup-row');
  const backupLbl = document.getElementById('photo-backup-label');

  if (lostEl) {
    if (_photoLostCount > 0) {
      lostEl.style.display = 'block';
      lostEl.textContent = `⚠ ${_photoLostCount} foto${_photoLostCount > 1 ? 's' : ''} de recibos no se han podido cargar — IndexedDB puede haber sido limpiado por el navegador. Los datos restantes están a salvo.`;
    } else {
      lostEl.style.display = 'none';
    }
  }

  const backupCount = APP.transactions.filter(t => t.photoId && t.photo).length;
  if (backupRow && backupLbl) {
    if (backupCount > 0) {
      backupRow.style.cssText = 'display:flex;margin-top:10px;align-items:center;gap:10px;flex-wrap:wrap';
      const kbUsed = Math.round(APP.transactions.filter(t => t.photoId && t.photo).reduce((s, t) => s + t.photo.length, 0) / 1024);
      backupLbl.textContent = `${backupCount} foto${backupCount > 1 ? 's' : ''} con copia de reserva en localStorage (${kbUsed} KB ocupados)`;
    } else {
      backupRow.style.display = 'none';
    }
  }
}

function clearPhotoBackups() {
  const count = APP.transactions.filter(t => t.photoId && t.photo).length;
  if (!count) return showToast('No hay copias de reserva que liberar', 'info');
  APP.transactions.forEach(t => { if (t.photoId && t.photo) delete t.photo; });
  saveData();
  _renderPhotoSettings();
  showToast(`${count} copia${count > 1 ? 's' : ''} de reserva eliminada${count > 1 ? 's' : ''} ✓`, 'success');
}
