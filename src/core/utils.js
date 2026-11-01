'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — UTILS
   Demo mode flag, lazy script loader, and all general-purpose
   utility functions. Depends only on state.js (APP).
═══════════════════════════════════════════════════════════════ */

/* Modo demo: ?demo en la URL carga datos ficticios sin tocar localStorage */
const _isDemoMode = new URLSearchParams(location.search).has('demo');

/* ─── Versión de la app ────────────────────────────────────────────
   Se manda en el informe técnico del feedback para saber sobre qué build
   está el usuario. Mantener en sintonía con "version" de package.json.
   Además, al enviar se añade el nombre de la caché del service worker
   (finova-vNN en sw.js), que es el dato que de verdad dice qué build tiene
   cargado el navegador: la constante puede quedarse atrás, la caché no. */
const FINOVA_VERSION = '1.0.0';

/* ─── Buffer de errores en memoria (para el feedback) ──────────────
   Los últimos 5 errores de la sesión, para poder adjuntarlos al informe
   técnico cuando el usuario reporta un fallo. Sin esto, un "no me funciona
   el botón" llega sin ninguna pista de qué reventó.

   Tres decisiones deliberadas:
   · EN MEMORIA, nunca en localStorage: un error puede llevar dentro un
     fragmento de datos del usuario, y persistirlo sería guardar información
     personal que nadie ha pedido guardar.
   · Solo mensaje, archivo y línea. Ni el stack completo (suele arrastrar
     valores) ni nada de APP.
   · Truncado a 200 caracteres: lo que no quepa es ruido, y un mensaje
     kilométrico es justo el que puede llevar datos dentro.

   El build elimina console.* (drop_console en vite.config.js), así que esto
   NO depende de la consola: engancha window.onerror y unhandledrejection,
   que siguen funcionando en producción. */
const _FV_ERR_MAX = 5;
const _fvErrorBuffer = [];

function _fvRecordError(kind, message, file, line) {
  const clean = v => String(v == null ? '' : v).slice(0, 200);
  const entry = {
    kind,
    message: clean(message),
    // Solo el nombre del archivo, no la URL completa: una URL puede llevar
    // parámetros, y los parámetros pueden llevar cualquier cosa.
    file: clean(String(file || '').split('/').pop().split('?')[0]),
    line: Number(line) || 0,
    at: new Date().toISOString(),
  };
  _fvErrorBuffer.push(entry);
  // Se tiran los más antiguos: en un bucle de errores, los últimos son los
  // que importan.
  while (_fvErrorBuffer.length > _FV_ERR_MAX) _fvErrorBuffer.shift();
}

/** Copia del buffer, lo más reciente primero. */
function fvRecentErrors() {
  return _fvErrorBuffer.slice().reverse();
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', e => {
    // Los errores de carga de recursos (<img>, <script>) llegan aquí sin
    // mensaje: se registra el recurso, que es la información útil.
    if (e && e.target && e.target !== window && e.target.tagName) {
      _fvRecordError('resource', 'No se pudo cargar ' + e.target.tagName.toLowerCase(),
        e.target.src || e.target.href, 0);
      return;
    }
    _fvRecordError('error', e?.message, e?.filename, e?.lineno);
  }, true);

  window.addEventListener('unhandledrejection', e => {
    const r = e?.reason;
    _fvRecordError('promise', (r && (r.message || r.code)) || r, '', 0);
  });
}

/* ─── Scroll reveal — fade-in sutil al entrar en viewport ──────────
   Marca cualquier elemento con [data-reveal] (o [data-reveal-group]
   para un conjunto con [data-reveal-item] hijos) y llama a
   initScrollReveal() tras renderizar. Idempotente: solo observa
   elementos nuevos, no vuelve a animar los ya revelados. Sin soporte
   de IntersectionObserver o con reduced-motion, revela todo al instante
   (el contenido nunca depende de JS para ser legible). ─────────────── */
const _revealMotionOK = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let _revealObserver = null;

function initScrollReveal(root = document) {
  const targets = root.querySelectorAll('[data-reveal]:not(.reveal-observed), [data-reveal-group]:not(.reveal-observed)');
  if (!targets.length) return;

  if (!_revealMotionOK || typeof IntersectionObserver === 'undefined') {
    targets.forEach(el => { el.classList.add('reveal-observed', 'is-visible'); });
    return;
  }

  if (!_revealObserver) {
    _revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        _revealObserver.unobserve(entry.target);
      });
    }, { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
  }

  targets.forEach(el => {
    el.classList.add('reveal-observed');
    // Ya visible en el viewport inicial (p. ej. above-the-fold) → mostrar sin esperar al scroll
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      requestAnimationFrame(() => el.classList.add('is-visible'));
    } else {
      _revealObserver.observe(el);
    }
  });
}

/* Carga dinámica de scripts de secciones no críticas */
const _lazyLoaded = new Set();
function _lazyLoad(src) {
  if (_lazyLoaded.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => { _lazyLoaded.add(src); resolve(); };
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}
// Secciones que NO se cargan en el arranque: se traen la primera vez que el
// usuario navega a ellas (ver renderSection en navigation.js). Dashboard,
// Transacciones y las de Inversiones se quedan fuera a propósito: son las
// más usadas y deben estar listas en el primer paint.
const _LAZY_SCRIPTS = {
  fiscalidad: 'src/sections/fiscal.js',
  simulator:  'src/sections/simulator.js',
  staking:    'src/sections/staking.js',
  ai:         'src/core/ai.js',
  admin:      'src/sections/admin.js',
  pdf:        'src/utils/pdf.js',
  devMonitor: 'src/core/devMonitor.js',
  // Importador de carteras de bróker: solo se usa al pulsar "Importar" en
  // Cartera, no tiene sentido descargarlo en cada visita.
  pfImport:   'src/utils/portfolio-import.js',
  // Escáner de tickets: se trae al pulsar "Escanear ticket".
  receiptScan: 'src/utils/receipt-scan.js',
  // Borrado de cuenta: se trae al pulsar el botón de la Zona de peligro.
  accountDelete: 'src/utils/account-delete.js',
  // Feedback y FAQ: comparten módulo porque el formulario enlaza a la FAQ y
  // la FAQ enlaza al formulario; separarlos obligaría a cargar los dos de
  // todas formas.
  feedback: 'src/utils/feedback.js',
  // Ficha de historial de una transacción: se trae al pulsar una fila. Lleva
  // dos gráficos, así que no tiene sentido descargarlo en cada visita.
  txHistory: 'src/utils/tx-history.js',
  // Comparador de precios: motor puro, sin interfaz. Lo usa la ficha de
  // historial, y se carga con ella (ver _withTxHistory). Va aparte porque no
  // depende de nada de la ficha y sirve igual a cualquier otra pantalla que
  // quiera comparar precios más adelante.
  priceCompare: 'src/utils/price-compare.js',
};

/* ── _ensureScript (cache-aware dynamic loader) ── */
const _scriptCache = new Map();
function _ensureScript(src) {
  if (_scriptCache.has(src)) return _scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Script load failed: ' + src));
    document.head.appendChild(s);
  });
  _scriptCache.set(src, p);
  return p;
}

/* ── Formato de moneda, porcentaje y fecha ── */

function formatCurrency(value, showSign = false) {
  const num = parseFloat(value) || 0;
  const abs = Math.abs(num);
  const formatted = abs.toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (showSign) {
    const sign = num >= 0 ? '+' : '-';
    return `${sign}${formatted} €`;
  }
  return (num < 0 ? '-' : '') + `${formatted} €`;
}

function formatPct(value, showSign = true) {
  const num = parseFloat(value) || 0;
  const abs = Math.abs(num).toFixed(2);
  if (!showSign) return `${num < 0 ? '-' : ''}${abs}%`;
  return `${num >= 0 ? '+' : '-'}${abs}%`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function generateId() {
  return crypto.randomUUID();
}

function _relativeTime(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  2) return 'hace un momento';
  if (hours <  1) return `hace ${mins}min`;
  if (hours < 24) return `hace ${hours}h`;
  if (days  <  7) return `hace ${days} día${days !== 1 ? 's' : ''}`;
  return `hace ${Math.floor(days / 7)} sem`;
}

function _divFxRate(d) {
  const divCurrency = d.currency?.toUpperCase();
  if (divCurrency && divCurrency !== 'EUR') {
    const match = APP.portfolio.find(a => a.currency?.toUpperCase() === divCurrency && a.exchangeRate > 0);
    if (match) return match.exchangeRate;
  }
  const asset = APP.portfolio.find(a => a.ticker === d.ticker);
  return (asset?.exchangeRate > 0 ? asset.exchangeRate : 1);
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

/* ── Precios en tiempo real (Yahoo Finance, sin API key) ── */
async function fetchTickerData(ticker) {
  if (!ticker) return null;
  const t = ticker.trim().toUpperCase();
  const parse = (json) => {
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice || meta.regularMarketPreviousClose || meta.chartPreviousClose || meta.postMarketPrice || meta.preMarketPrice || 0;
    const prev  = meta.regularMarketPreviousClose || meta.chartPreviousClose || 0;
    return {
      name:          meta.longName || meta.shortName || t,
      price,
      previousClose: prev,
      change:        meta.regularMarketChange        || (prev > 0 ? price - prev : 0),
      changePct:     meta.regularMarketChangePercent || (prev > 0 ? ((price - prev) / prev) * 100 : 0),
      currency:      meta.currency || 'USD',
    };
  };
  try {
    const res  = await api.yahoo(t);
    const json = await res.json().catch(() => null);
    if (json?.error) throw new Error(json.error);
    if (res.ok && json) { const r = parse(json); if (r) return r; }
  } catch (e) {
    if (e.message && !e.message.includes('Failed to fetch') && !e.message.includes('NetworkError')) throw e;
  }
  return null;
}

async function autoFillTicker(tickerId, nameId, priceId, badgeId, buyPriceId) {
  const ticker = document.getElementById(tickerId)?.value?.trim().toUpperCase();
  if (!ticker) return;
  const badge = badgeId ? document.getElementById(badgeId) : null;
  if (badge) { badge.textContent = '⟳'; badge.style.display = 'inline'; badge.style.color = 'var(--text-muted)'; }
  const data = await fetchTickerData(ticker);
  if (!data) {
    if (badge) { badge.textContent = '— no encontrado'; badge.style.color = 'var(--danger)'; }
    return;
  }
  const nameEl     = nameId     ? document.getElementById(nameId)     : null;
  const priceEl    = priceId    ? document.getElementById(priceId)    : null;
  const buyPriceEl = buyPriceId ? document.getElementById(buyPriceId) : null;
  if (nameEl     && !nameEl.value.trim()) nameEl.value     = data.name;
  if (priceEl    && !priceEl.value)       priceEl.value    = data.price > 0 ? data.price.toFixed(4) : '';
  if (buyPriceEl && !buyPriceEl.value)    buyPriceEl.value = data.price > 0 ? data.price.toFixed(4) : '';
  if (badge) { badge.textContent = '✓ auto'; badge.style.color = 'var(--accent)'; }
}

async function _fetchPricesDirect(tickers) {
  const out = {};
  await Promise.all(tickers.map(async ticker => {
    try {
      const res  = await api.yahoo(ticker);
      const json = await res.json().catch(() => null);
      if (!json || json.error) return;
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) return;
      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose || meta.regularMarketPreviousClose || price;
      out[ticker] = {
        price,
        previousClose: prev,
        change:    price - prev,
        changePct: prev > 0 ? ((price - prev) / prev) * 100 : 0,
      };
    } catch (_) {}
  }));
  return out;
}

async function refreshAllPrices(silent = false) {
  const btn = document.querySelector('.btn-refresh-prices');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Actualizando...'; }

  const targets = [
    ...APP.portfolio.map(a => ({ arr: 'portfolio', id: a.id, ticker: a.ticker })),
    ...APP.watchlist.map(a => ({ arr: 'watchlist',  id: a.id, ticker: a.ticker })),
  ].filter(t => t.ticker);

  if (!targets.length) { _refreshBtnDone(btn); return; }

  const tickers    = [...new Set(targets.map(t => t.ticker))];
  let   quotes     = {};
  let   fetchError = '';

  try {
    const res  = await api.quotes(tickers);
    const json = await res.json().catch(() => ({}));
    if (json && !json.error) quotes = json;
    else if (json?.error) fetchError = json.error;
  } catch (e) {
    fetchError = e.message || 'Error de red';
  }

  const missingTickers = tickers.filter(t => !quotes[t] || !(quotes[t].price > 0));
  if (missingTickers.length > 0) {
    const direct = await _fetchPricesDirect(missingTickers);
    Object.assign(quotes, direct);
    if (Object.keys(direct).length > 0) fetchError = '';
  }

  let updated = 0, failed = 0;
  const updatedPortfolioIds = new Set();
  const reachedAlerts = [];

  for (const t of targets) {
    const q   = quotes[t.ticker];
    const idx = APP[t.arr].findIndex(a => a.id === t.id);
    if (q && q.price > 0 && idx >= 0) {
      APP[t.arr][idx].currentPrice   = q.price;
      APP[t.arr][idx].previousClose  = q.previousClose  || 0;
      APP[t.arr][idx].dailyChange    = q.change         || 0;
      APP[t.arr][idx].dailyChangePct = q.changePct      || 0;
      APP[t.arr][idx].priceDate      = Date.now();
      if (t.arr === 'portfolio') {
        recordAssetPriceHistory(APP.portfolio[idx]);
        updatedPortfolioIds.add(t.id);
      }
      if (t.arr === 'watchlist') {
        const w = APP[t.arr][idx];
        if (_checkWatchlistTargetAlert(w)) reachedAlerts.push(w);
      }
      updated++;
    } else {
      failed++;
    }
  }

  APP.lastPriceRefresh = Date.now();
  if (updated > 0) saveData();

  if      (APP.activeSection === SECTIONS.PORTFOLIO) renderPortfolio();
  else if (APP.activeSection === SECTIONS.WATCHLIST) renderWatchlist();
  else if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();

  if (updatedPortfolioIds.size > 0 && APP.activeSection === SECTIONS.PORTFOLIO) {
    requestAnimationFrame(() => {
      updatedPortfolioIds.forEach(id => {
        const input = document.querySelector(`tr[data-id="${id}"] .editable-price input`);
        if (input) { input.classList.add('price-flash'); setTimeout(() => input.classList.remove('price-flash'), 1800); }
      });
    });
  }

  _refreshBtnDone(btn);

  // Las alertas de precio objetivo se muestran siempre, incluso en refresh
  // silencioso (automático cada 10 min) — es la única forma de que el
  // usuario se entere si no está mirando la sección Watchlist en ese momento.
  reachedAlerts.forEach(w => {
    const dirLabel = (w.alertType || 'above') === 'below' ? 'por debajo de' : 'por encima de';
    showToast(`🔔 ${w.ticker} ha alcanzado tu objetivo: ${formatCurrency(w.currentPrice)} (${dirLabel} ${formatCurrency(w.targetPrice)})`, 'success');
  });

  if (!silent) {
    if (fetchError && updated === 0) {
      showToast('No se pudo obtener precios — usando últimos datos disponibles.', 'error');
    } else if (updated === 0) {
      showToast('Sin precios disponibles. Verifica los tickers o la conexión.', 'error');
    } else if (failed > 0) {
      showToast(`${updated} precio${updated !== 1 ? 's' : ''} actualizados, ${failed} sin datos`, 'error');
    } else {
      showToast(`${updated} precio${updated !== 1 ? 's' : ''} actualizados ✓`, 'success');
    }
  }
}

// Devuelve true solo en la transición de "no alcanzado" a "alcanzado" (no
// repite el aviso cada 10 min mientras el precio se mantenga por encima/
// debajo del objetivo) y se resetea si el precio vuelve a alejarse.
function _checkWatchlistTargetAlert(w) {
  const hasTarget = w.targetPrice && w.targetPrice > 0;
  if (!hasTarget) { w.alertFired = false; return false; }
  const alertType = w.alertType || 'above';
  const reached = alertType === 'below' ? w.currentPrice <= w.targetPrice : w.currentPrice >= w.targetPrice;
  if (reached && !w.alertFired) { w.alertFired = true; return true; }
  if (!reached) w.alertFired = false;
  return false;
}

function _refreshBtnDone(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (APP.lastPriceRefresh) {
    const t    = new Date(APP.lastPriceRefresh);
    const hhmm = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
    btn.textContent = `⟳ Precios (${hhmm})`;
    btn.title       = `Última actualización: ${hhmm}`;
  } else {
    btn.textContent = '⟳ Actualizar precios';
  }
  btn.style.color   = '';
  btn.style.opacity = '';
}

async function refreshExchangeRates(silent = false) {
  const nonEur = APP.portfolio.filter(a => a.currency && a.currency !== 'EUR');
  if (nonEur.length === 0) { if (!silent) showToast('No hay activos en divisa extranjera', 'error'); return; }

  if (!silent) showToast('Actualizando tipos de cambio…', 'success');
  try {
    const res  = await api.exchange();
    const data = await res.json();
    if (!data.rates) throw new Error('Sin datos');

    let updated = 0;
    APP.portfolio.forEach(a => {
      if (!a.currency || a.currency === 'EUR') return;
      const rate = data.rates[a.currency];
      if (!rate) return;
      a.exchangeRate = parseFloat((1 / rate).toFixed(6));
      updated++;
    });

    APP.exchangeRatesUpdated = getTodayStr();
    saveData();
    renderPortfolio();
    if (!silent) showToast(`Tipos actualizados para ${updated} activo${updated !== 1 ? 's' : ''} ✓`, 'success');
  } catch {
    if (!silent) showToast('No se pudo obtener los tipos. Actualiza manualmente en cada activo.', 'error');
  }
}

function debounce(fn, ms = 250) {
  let t;
  const debounced = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  debounced.flush = (...args) => { clearTimeout(t); fn(...args); };
  return debounced;
}

const ric = typeof requestIdleCallback !== 'undefined'
  ? cb => requestIdleCallback(cb, { timeout: 300 })
  : cb => setTimeout(cb, 16);

function _setupFormValidation(fields) {
  const submitBtn = document.getElementById('modalConfirm');
  const dirty     = new Set();

  function _errEl(input) {
    let el = input.parentElement.querySelector('.field-error-msg');
    if (!el) {
      el = document.createElement('div');
      el.className = 'field-error-msg';
      input.parentElement.appendChild(el);
    }
    return el;
  }

  function _validateOne(f, forceShow) {
    const input = document.getElementById(f.id);
    if (!input) return true;
    const valid = f.test();
    const show  = forceShow || dirty.has(f.id);
    const err   = _errEl(input);
    if (!valid && show) {
      input.classList.add('input-error');
      err.textContent  = f.msg;
      err.style.display = '';
    } else {
      input.classList.remove('input-error');
      err.style.display = 'none';
    }
    return valid;
  }

  function _updateSubmit() {
    if (!submitBtn) return;
    const ok = fields.every(f => {
      const el = document.getElementById(f.id);
      return !el || f.test();
    });
    submitBtn.disabled     = !ok;
    submitBtn.style.opacity = ok ? '' : '0.45';
    submitBtn.style.cursor  = ok ? '' : 'not-allowed';
  }

  fields.forEach(f => {
    const input = document.getElementById(f.id);
    if (!input || input.dataset.fvBound) return;
    input.dataset.fvBound = '1';
    ['input', 'change'].forEach(evt => {
      input.addEventListener(evt, () => { dirty.add(f.id); _validateOne(f, false); _updateSubmit(); });
    });
    input.addEventListener('blur', () => { dirty.add(f.id); _validateOne(f, true); _updateSubmit(); });
  });

  _updateSubmit();
}

/* ─── Salida animada antes de eliminar ──────────────────────────
   Aplica un fundido/encogido muy sutil al elemento (fila, card) y
   espera a que termine antes de ejecutar la mutación real de datos
   + re-render, para que el usuario vea la salida en vez de un corte
   instantáneo. Si el elemento no existe o reduced-motion está
   activo, ejecuta la mutación al instante (nunca bloquea el borrado). */
function animateRowRemoval(el, onDone) {
  if (!el || !_revealMotionOK) { onDone(); return; }
  el.classList.add('row-removing');
  let done = false;
  const finish = () => { if (done) return; done = true; onDone(); };
  el.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 220); // fallback si transitionend no llega (display cambiado antes, etc.)
}

/* ─── Soft-delete with undo toast ────────────────────────────── */
let _undoSeq = 0;

function softDelete(message, onUndo, onCommit) {
  const container = document.getElementById('toastContainer');
  if (!container) { saveData(); if (onCommit) onCommit(); return; }

  const uid    = ++_undoSeq;
  let   undone = false;

  const toast = document.createElement('div');
  toast.className = 'toast toast-undo';
  toast.innerHTML = `
    <span class="toast-icon">🗑</span>
    <span class="toast-undo-msg">${escapeHtml(message)}</span>
    <button class="toast-undo-btn">Deshacer</button>
  `;

  function _dismiss() {
    clearTimeout(timer);
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }

  toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
    if (undone) return;
    undone = true;
    _dismiss();
    onUndo();
  });

  container.appendChild(toast);

  const timer = setTimeout(() => {
    if (!undone) { saveData(); if (onCommit) onCommit(); }
    _dismiss();
  }, 5000);
}

function softEdit(message, onUndo) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast toast-undo';
  toast.innerHTML = `
    <span class="toast-icon">✎</span>
    <span class="toast-undo-msg">${escapeHtml(message)}</span>
    <button class="toast-undo-btn">Deshacer</button>
  `;

  function _dismiss() {
    clearTimeout(timer);
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }

  toast.querySelector('.toast-undo-btn').addEventListener('click', () => { _dismiss(); onUndo(); });
  container.appendChild(toast);
  const timer = setTimeout(_dismiss, 5000);
}

/* ── Delegación de eventos ── */
const _delegated = new WeakMap();
function _delegate(containerId, actionMap) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (_delegated.has(el)) {
    const live = _delegated.get(el);
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, actionMap);
    return;
  }

  const live = Object.assign({}, actionMap);
  _delegated.set(el, live);
  el.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !el.contains(btn)) return;
    const fn = live[btn.dataset.action];
    if (!fn) return;
    const id = btn.closest('[data-id]')?.dataset.id ?? btn.dataset.id ?? null;
    fn(id, btn);
  });
}
