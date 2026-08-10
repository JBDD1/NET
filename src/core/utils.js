'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — UTILS
   Demo mode flag, lazy script loader, and all general-purpose
   utility functions. Depends only on state.js (APP).
═══════════════════════════════════════════════════════════════ */

/* Modo demo: ?demo en la URL carga datos ficticios sin tocar localStorage */
const _isDemoMode = new URLSearchParams(location.search).has('demo');

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
const _LAZY_SCRIPTS = {
  fiscalidad: 'src/sections/fiscal.js',
  simulator:  'src/sections/simulator.js',
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
    const res  = await fetch(`/api/yahoo?ticker=${encodeURIComponent(t)}`);
    const json = await res.json().catch(() => null);
    if (json?.error) throw new Error(json.error);
    if (res.ok && json) { const r = parse(json); if (r) return r; }
  } catch (e) {
    if (e.message && !e.message.includes('Failed to fetch') && !e.message.includes('NetworkError')) throw e;
  }
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=1d`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) { console.warn(`Yahoo Finance ${res.status} para ${t}`); return null; }
    return parse(await res.json());
  } catch (e) {
    console.warn(`Error obteniendo precio de ${t}:`, e.message);
    return null;
  }
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
      const url  = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=false&corsDomain=finance.yahoo.com`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(7000) });
      const json = await res.json();
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
    const res  = await fetch(`/api/quotes?symbols=${tickers.join(',')}`, { signal: AbortSignal.timeout(8000) });
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
    const res  = await fetch('https://open.er-api.com/v6/latest/EUR');
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
