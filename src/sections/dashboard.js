/* ═══════════════════════════════════════════════════════════════
   FINOVA — dashboard.js
   Sección 6: Dashboard, charts de inicio y funciones de demo/reset
═══════════════════════════════════════════════════════════════ */

/* ─── Dashboard layout system ────────────────────────────────── */
const DASH_BLOCK_DEFS = [
  { id: 'dash-block-kpis',            label: 'Indicadores (KPIs)',        icon: '📊', full: true,  kpis: true },
  { id: 'dash-block-chart-networth',  label: 'Evolución del patrimonio',  icon: '📈', full: true  },
  { id: 'dash-block-chart-dist',      label: 'Distribución patrimonio',   icon: '🥧', full: false },
  { id: 'dash-block-investments',     label: 'Top inversiones',           icon: '🏆', full: false },
  { id: 'dash-block-activity',        label: 'Actividad reciente',        icon: '🕐', full: false },
  { id: 'dash-block-goals',           label: 'Objetivos financieros',     icon: '🎯', full: false },
  { id: 'dash-block-expcats',         label: 'Gastos por categoría',      icon: '💸', full: false },
  { id: 'dash-block-rule5030',        label: 'Regla 50/30/20',            icon: '⚖',  full: false },
  { id: 'dash-block-wealth-score',    label: 'Wealth Score',              icon: '◉',  full: false },
  { id: 'dash-block-timeline',        label: 'Timeline financiero',       icon: '⏳', full: true  },
  { id: 'dash-block-heatmap',         label: 'Heatmap de gastos',         icon: '◫',  full: true  },
];

const DASH_KPI_DEFS = [
  { id: 'dash-kpi-networth',  label: 'Patrimonio neto' },
  { id: 'dash-kpi-balance',   label: 'Balance del mes' },
  { id: 'dash-kpi-portfolio', label: 'Cartera de inversión' },
  { id: 'dash-kpi-cash',      label: 'Efectivo disponible' },
  { id: 'dash-kpi-savings',   label: 'Tasa de ahorro' },
  { id: 'dash-kpi-dividends', label: 'Dividendos anuales' },
];

function getEffectiveDashLayout() {
  const stored = APP.dashboardLayout;
  if (!stored || !Array.isArray(stored)) {
    return DASH_BLOCK_DEFS.map(d => ({ id: d.id, visible: true }));
  }
  const ids = stored.map(b => b.id);
  const result = [...stored];
  DASH_BLOCK_DEFS.forEach(d => {
    if (!ids.includes(d.id)) result.push({ id: d.id, visible: true });
  });
  return result;
}

function applyDashboardLayout() {
  const container = document.getElementById('dash-blocks-container');
  if (!container) return;

  const layout = getEffectiveDashLayout();
  const kpis   = APP.dashboardKpis || {};

  layout.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) container.appendChild(el);
  });

  layout.forEach(({ id, visible }) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  });

  DASH_KPI_DEFS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (kpis[id] !== false) ? '' : 'none';
  });
}

/* ─── Dashboard editor ───────────────────────────────────────── */
let _dashEditLayout    = null;
let _dashEditKpis      = null;
let _dashEditorDragSrc = null;
let _dashEditorGhost   = null;

function openDashboardEditor() {
  _dashEditLayout = getEffectiveDashLayout().map(b => ({ ...b }));
  _dashEditKpis   = { ...(APP.dashboardKpis || {}) };

  openModal('Personalizar Dashboard', '', null, _renderDashEditor);
  setTimeout(_renderDashEditor, 50);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
}

function _renderDashEditor() {
  const body = document.getElementById('modalBody');
  if (!body) return;

  const rows = _dashEditLayout.map((block, idx) => {
    const def = DASH_BLOCK_DEFS.find(d => d.id === block.id);
    if (!def) return '';
    const opacity = block.visible ? '1' : '0.45';

    let kpiSub = '';
    if (def.kpis) {
      kpiSub = `<div class="dash-editor-kpi-subs">` +
        DASH_KPI_DEFS.map(k => {
          const vis = _dashEditKpis[k.id] !== false;
          return `<label class="dash-editor-kpi-check">
            <input type="checkbox" ${vis ? 'checked' : ''} onchange="_toggleDashKpi('${k.id}',this.checked)" />
            ${escapeHtml(k.label)}
          </label>`;
        }).join('') +
        `</div>`;
    }

    return `<div class="dash-editor-row" draggable="true" data-idx="${idx}" data-id="${escapeHtml(block.id)}" style="opacity:${opacity}">
      <span class="dash-editor-handle">⠿</span>
      <span class="dash-editor-icon">${def.icon}</span>
      <div class="dash-editor-info">
        <div class="dash-editor-label">${escapeHtml(def.label)}</div>
        ${kpiSub}
      </div>
      <label class="toggle-switch" style="flex-shrink:0;margin-top:2px">
        <input type="checkbox" ${block.visible ? 'checked' : ''} onchange="_toggleDashBlock('${escapeHtml(block.id)}',this.checked)" />
        <span class="toggle-slider"></span>
      </label>
    </div>`;
  }).join('');

  body.innerHTML = `
    <p class="modal-help-text">
      Arrastra para reordenar · activa o desactiva cada bloque con el toggle.<br>
      <strong>Los datos nunca se borran</strong> al ocultar un bloque.
    </p>
    <div id="dash-editor-list">${rows}</div>
    <div class="modal-footer-btns">
      <button class="btn-secondary" onclick="_resetDashLayout()">↺ Restaurar por defecto</button>
      <div class="modal-footer-btns-right">
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn-primary" onclick="_saveDashLayout()">Guardar cambios</button>
      </div>
    </div>`;

  _attachDashEditorDrag();
}

function _attachDashEditorDrag() {
  const list = document.getElementById('dash-editor-list');
  if (!list) return;

  list.querySelectorAll('.dash-editor-row').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      _dashEditorDragSrc = row;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => {
        _dashEditorGhost = document.createElement('div');
        _dashEditorGhost.className = 'dash-editor-ghost';
        _dashEditorGhost.style.height = row.offsetHeight + 'px';
        row.parentNode.insertBefore(_dashEditorGhost, row);
        row.style.display = 'none';
      }, 0);
    });
    row.addEventListener('dragend', () => {
      if (_dashEditorGhost?.parentNode) _dashEditorGhost.remove();
      _dashEditorGhost = null;
      row.style.display = '';
      list.querySelectorAll('.dash-editor-row').forEach(r => r.classList.remove('dash-editor-drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (_dashEditorDragSrc && _dashEditorDragSrc !== row) {
        list.querySelectorAll('.dash-editor-row').forEach(r => r.classList.remove('dash-editor-drag-over'));
        row.classList.add('dash-editor-drag-over');
      }
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('dash-editor-drag-over');
      if (!_dashEditorDragSrc || _dashEditorDragSrc === row) return;
      const fromIdx = parseInt(_dashEditorDragSrc.dataset.idx);
      const toIdx   = parseInt(row.dataset.idx);
      const moved = _dashEditLayout.splice(fromIdx, 1)[0];
      _dashEditLayout.splice(toIdx, 0, moved);
      _renderDashEditor();
    });
  });
}

function _toggleDashBlock(id, visible) {
  const block = _dashEditLayout.find(b => b.id === id);
  if (block) block.visible = visible;
  _renderDashEditor();
}

function _toggleDashKpi(id, visible) {
  _dashEditKpis[id] = visible;
}

function _resetDashLayout() {
  _dashEditLayout = DASH_BLOCK_DEFS.map(d => ({ id: d.id, visible: true }));
  _dashEditKpis   = DASH_KPI_DEFS.reduce((o, d) => ({ ...o, [d.id]: true }), {});
  _renderDashEditor();
}

function _saveDashLayout() {
  APP.dashboardLayout = _dashEditLayout.map(b => ({ ...b }));
  APP.dashboardKpis   = { ..._dashEditKpis };
  saveData();
  markDashboardDirty(); // newly visible blocks need content — force immediate re-render
  applyDashboardLayout();
  renderDashboard();
  closeModal();
  showToast('Dashboard personalizado ✓', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   6. DASHBOARD
═══════════════════════════════════════════════════════════════ */
// Dirty flag: O(1) guard set by saveData() instead of O(n) fingerprint
let _dashboardDirty = true;
function markDashboardDirty() { _dashboardDirty = true; _heatmapCache = null; }

// Returns true when a block should be rendered (default visible when no layout saved)
function _isDashBlockVisible(blockId) {
  const layout = APP.dashboardLayout;
  if (!layout || !Array.isArray(layout)) return true;
  const b = layout.find(b => b.id === blockId);
  return !b || b.visible !== false;
}

function loadDemo() {
  loadDemoData();
  saveData();
  markDashboardDirty();
  renderDashboard();
  showToast('Datos de ejemplo cargados ✓', 'success');
}

function startFresh() {
  APP.transactions    = [];
  APP.portfolio       = [];
  APP.watchlist       = [];
  APP.dividends       = [];
  APP.cashAccounts    = [];
  APP.alternatives    = [];
  APP.properties      = [];
  APP.goals           = [];
  APP.bizums          = [];
  APP.networthHistory = [];
  APP.sales           = [];
  APP.scenarios       = [];
  APP.liabilities     = [];
  APP.trabajo         = { salarioBruto: 0, retencionEmpresa: 0, seguridadSocial: 0, dietas: 0, sindicatos: 0, otrosGastos: 0 };
  APP.minimos         = { edad: 0, discapacidad: 0, hijos: [], ascendientes: [], movilidadGeografica: false };
  APP.freshStart      = true;
  saveData();
  markDashboardDirty();
  renderDashboard();
  showToast('Listo — empieza a añadir tus datos ✓', 'success');
}

function resetAllData() {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

let _resetCountdownTimer = null;

function openResetDialog() {
  if (_resetCountdownTimer) { clearInterval(_resetCountdownTimer); _resetCountdownTimer = null; }
  let secs = 5;

  openModal('⚠ Eliminar todos los datos', `
    <div class="modal-danger-box">
      <span class="modal-danger-icon">⚠️</span>
      <div>
        <div class="modal-danger-title">Esta acción es permanente e irreversible</div>
        <div class="modal-danger-body">
          Se eliminarán <strong>todas las transacciones, cartera de inversión, objetivos, bizums, datos laborales, historial de patrimonio y API keys</strong>.
          Si no tienes un backup descargado, los datos se perderán para siempre.
        </div>
        <div class="modal-note">
          💡 Si solo quieres ocultar secciones, usa <strong>Personalizar Dashboard</strong> en Ajustes sin borrar nada.
        </div>
      </div>
    </div>
    <div class="modal-footer-btns">
      <span class="modal-wait-msg" id="reset-wait-msg">Espera <strong id="reset-secs">5</strong>s para confirmar…</span>
      <div class="modal-footer-btns-right">
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button id="reset-confirm-btn" class="btn-danger" disabled onclick="resetAllData()" style="opacity:.4;cursor:not-allowed">
          Eliminar todo (5)
        </button>
      </div>
    </div>`, null);

  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';

  setTimeout(() => {
    _resetCountdownTimer = setInterval(() => {
      secs--;
      const btn  = document.getElementById('reset-confirm-btn');
      const secsEl = document.getElementById('reset-secs');
      if (!btn) { clearInterval(_resetCountdownTimer); _resetCountdownTimer = null; return; }
      if (secs <= 0) {
        clearInterval(_resetCountdownTimer); _resetCountdownTimer = null;
        btn.disabled    = false;
        btn.style.opacity = '1';
        btn.style.cursor  = 'pointer';
        btn.textContent   = '⚠ Eliminar todo';
        const msg = document.getElementById('reset-wait-msg');
        if (msg) msg.style.display = 'none';
      } else {
        btn.textContent = `Eliminar todo (${secs})`;
        if (secsEl) secsEl.textContent = secs;
      }
    }, 1000);
  }, 100);
}

function _dashCalcValues() {
  const networth      = calcNetWorth();
  const portfolio     = calcPortfolioValue();
  const cash          = calcCashTotal();
  // Sync history immediately so charts always reflect the current networth,
  // even if _saveDataNow's debounce hasn't fired yet.
  updateNetworthHistory(networth);
  const month         = getCurrentMonth();
  const bizumIncome   = (APP.bizums || []).filter(b => b.direction === 'in'  && b.status === 'done' && (b.date || month).startsWith(month)).reduce((s, b) => s + b.amount, 0);
  const bizumExpense  = (APP.bizums || []).filter(b => b.direction === 'out' && b.status === 'done' && (b.date || month).startsWith(month)).reduce((s, b) => s + b.amount, 0);
  const income        = calcMonthlyIncome() + bizumIncome;
  const expense       = calcMonthlyExpense() + bizumExpense;
  const balance       = income - expense;
  const prevNW        = APP.networthHistory.find(h => h.date === getPreviousMonth(getCurrentMonth()))?.value || 0;
  const portfolioCost = APP.portfolio.reduce((s, a) => s + a.buyPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1), 0);
  const annualDiv     = APP.dividends.reduce((s, d) => {
    return s + d.dividendPerShare * d.shares * ({ annual: 1, semiannual: 2, quarterly: 4, monthly: 12 }[d.frequency] || 1) * _divFxRate(d);
  }, 0);
  const savingsRate   = income > 0 ? (balance / income) * 100 : null;
  return { networth, portfolio, cash, income, expense, balance, prevNW, portfolioCost, annualDiv, savingsRate };
}

function _dashUpdateKPIs(v) {
  const { networth, portfolio, cash, income, expense, balance, prevNW, portfolioCost, annualDiv, savingsRate } = v;
  const nwChange      = networth - prevNW;
  const portfolioGain = portfolio - portfolioCost;

  _animNum(document.getElementById('dash-networth'),        networth,  formatCurrency, 700);
  _animNum(document.getElementById('dash-monthly-balance'), balance,   formatCurrency, 700);
  _animNum(document.getElementById('dash-portfolio-value'), portfolio, formatCurrency, 700);
  _animNum(document.getElementById('dash-cash'),            cash,      formatCurrency, 700);

  const nwChangeEl = document.getElementById('dash-networth-change');
  if (nwChangeEl) {
    const nwDir = nwChange >= 0 ? '▲ ' : '▼ ';
    nwChangeEl.textContent = prevNW > 0 ? `${nwDir}${formatCurrency(nwChange, true)} vs mes anterior` : 'Sin datos anteriores';
    nwChangeEl.className   = 'kpi-change ' + colorClass(nwChange);
  }
  const portChangeEl = document.getElementById('dash-portfolio-change');
  if (portChangeEl) {
    const portDir = portfolioGain >= 0 ? '▲ ' : '▼ ';
    portChangeEl.textContent = portfolioCost > 0
      ? `${portDir}${formatCurrency(portfolioGain, true)} (${formatPct(portfolioGain / portfolioCost * 100)})`
      : 'Sin activos';
    portChangeEl.className = 'kpi-change ' + colorClass(portfolioGain);
  }
  const monthSubEl = document.getElementById('dash-monthly-sub');
  if (monthSubEl) {
    monthSubEl.textContent = `↑ ${formatCurrency(income)}  ↓ ${formatCurrency(expense)}`;
    monthSubEl.className   = 'kpi-change ' + colorClass(balance);
  }
  const savingsEl    = document.getElementById('dash-savings-rate');
  const savingsSubEl = document.getElementById('dash-savings-sub');
  if (savingsEl) {
    if (savingsRate !== null) _animNum(savingsEl, savingsRate, v => `${v.toFixed(1)}%`, 600);
    else savingsEl.textContent = '—';
    savingsEl.className = 'kpi-value ' + (savingsRate !== null ? colorClass(savingsRate) : '');
  }
  if (savingsSubEl) savingsSubEl.textContent = income > 0 ? `${formatCurrency(income)} ingresado este mes` : 'Sin ingresos este mes';

  _animNum(document.getElementById('dash-dividends'), annualDiv, formatCurrency, 700);
  const divSubEl = document.getElementById('dash-dividends-sub');
  if (divSubEl) divSubEl.textContent = annualDiv > 0
    ? `≈ ${formatCurrency(annualDiv / 12)}/mes`
    : APP.dividends.length === 0 ? 'Sin dividendos registrados' : 'Proyección anual';

  _setKpiNarrative('dash-networth-narrative',  _narrativeNetworth(networth));
  _setKpiNarrative('dash-balance-narrative',   _narrativeBalance(balance));
  _setKpiNarrative('dash-portfolio-narrative', _narrativePortfolio());
  _setKpiNarrative('dash-cash-narrative',      _narrativeCash());
  _setKpiNarrative('dash-savings-narrative',   _narrativeSavings(savingsRate));
  _setKpiNarrative('dash-dividends-narrative', _narrativeDividends(annualDiv));

  const heroCard = document.getElementById('dash-kpi-networth');
  if (heroCard) heroCard.classList.toggle('kpi-negative', networth < 0);
}

function _dashUpdateSparklines(annualDiv) {
  try {
    _drawSparkline('spark-networth',  _sparkNetworthData(7), true);
    _drawSparkline('spark-balance',   _sparkMonthlyData(7, 'balance'), false);
    _drawSparkline('spark-portfolio', _sparkHistoryField(7, 'portfolioValue'), false);
    _drawSparkline('spark-savings',   _sparkMonthlyData(7, 'savings'), false, v => v.toFixed(1) + '%');
    _drawSparkline('spark-cash',      _sparkHistoryField(7, 'cashValue'), false);
    _drawSparkline('spark-dividends', _sparkDividendsData(annualDiv, 7), false);
  } catch(e) { console.warn('sparklines:', e); }
}

function _dashDeferredRender(cash, portfolio) {
  const showNetworth  = _isDashBlockVisible('dash-block-chart-networth');
  const showDist      = _isDashBlockVisible('dash-block-chart-dist');
  const showActivity  = _isDashBlockVisible('dash-block-activity');
  const showInv       = _isDashBlockVisible('dash-block-investments');
  const showGoals     = _isDashBlockVisible('dash-block-goals');
  const showExpCats   = _isDashBlockVisible('dash-block-expcats');

  if (showNetworth || showDist)
    document.querySelectorAll('#section-dashboard .chart-wrapper, #section-dashboard .chart-donut-wrapper')
      .forEach(el => el.classList.add('loading'));
  if (showActivity)  _skelList('recent-transactions',  5);
  if (showInv)       _skelList('top-investments-list', 4);
  if (showGoals)     _skelList('dash-goals-list',      3);
  if (showExpCats)   _skelList('dash-expense-cats',    4);

  ric(() => {
    if (showNetworth) try { renderChartNetworthHistory(); } catch(e) { console.warn('chart networth:', e); }
    if (showDist)     try { renderChartDistribution(cash, portfolio, calcAlternativesTotal(), calcPropertiesTotal()); } catch(e) { console.warn('chart dist:', e); }
    if (showInv)      try { renderTopInvestments(); }  catch(e) { console.warn('top investments:', e); }
    if (showActivity) try { renderRecentActivity(); }  catch(e) { console.warn('recent activity:', e); }
    if (showGoals)    try { renderDashGoals(); }       catch(e) { console.warn('dash goals:', e); }
    if (showExpCats)  try { renderDashExpenseCats(); } catch(e) { console.warn('dash expense cats:', e); }
    document.querySelectorAll('#section-dashboard .chart-wrapper.loading, #section-dashboard .chart-donut-wrapper.loading')
      .forEach(el => el.classList.remove('loading'));
  });
}

function renderDashboard() {
  if (!_dashboardDirty) return;
  _dashboardDirty = false;

  // Personalized greeting
  const greetEl = document.getElementById('dash-greeting');
  if (greetEl) {
    const hour  = new Date().getHours();
    const sal   = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
    const name  = (APP.userName || '').trim();
    greetEl.textContent = name ? `${sal}, ${name}` : 'Dashboard';
  }

  const v = _dashCalcValues();

  if (_isDashBlockVisible('dash-block-kpis')) {
    _dashUpdateKPIs(v);
    _dashUpdateSparklines(v.annualDiv);
  }

  try { renderMonthlyRecap(); }      catch(e) { console.warn('recap:', e); }
  try { renderDashboardInsight(); }  catch(e) { console.warn('insight:', e); }
  try { renderDashboardAlerts(); }   catch(e) { console.warn('alerts:', e); }
  if (_isDashBlockVisible('dash-block-rule5030'))    try { renderRule5030(); }        catch(e) { console.warn('rule5030:', e); }
  if (_isDashBlockVisible('dash-block-wealth-score')) try { renderWealthScore(); }        catch(e) { console.warn('wealth-score:', e); }
  if (_isDashBlockVisible('dash-block-timeline'))     try { renderFinancialTimeline(); }  catch(e) { console.warn('timeline:', e); }
  if (_isDashBlockVisible('dash-block-heatmap'))      try { renderSpendingHeatmap(); }    catch(e) { console.warn('heatmap:', e); }
  try { applyDashboardLayout(); }    catch(e) { console.warn('layout:', e); }

  _dashDeferredRender(v.cash, v.portfolio);
}

/* ─── Sparklines ──────────────────────────────────────────────── */

function _sparkNetworthData(n) {
  return APP.networthHistory.slice(-n).map(h => h.value);
}

function _sparkHistoryField(n, field) {
  const pts = APP.networthHistory.slice(-n).map(h => h[field] ?? null).filter(v => v !== null);
  return pts.length >= 2 ? pts : [];
}

function _sparkDividendsData(annualDiv, n) {
  if (annualDiv <= 0 || APP.networthHistory.length < 2) return [];
  return APP.networthHistory.slice(-n).map(() => annualDiv / 12);
}

function _sparkMonthlyData(n, type) {
  const now = new Date();
  const pts = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const txs = APP.transactions.filter(t => (t.date || getCurrentMonth()).startsWith(m));
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    if (type === 'balance')   pts.push(inc - exp);
    else if (type === 'savings') pts.push(inc > 0 ? (inc - exp) / inc * 100 : 0);
    else if (type === 'portfolio') {
      const snap = APP.networthHistory.find(h => h.date === m);
      pts.push(snap ? snap.value : null);
    }
  }
  const valid = pts.filter(v => v !== null && v !== 0);
  return valid.length >= 2 ? pts.filter(v => v !== null) : [];
}

function _drawSparkline(id, data, isHero, formatter) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (!data || data.length < 2) { canvas.style.display = 'none'; return; }

  const W = canvas.parentElement.offsetWidth || 200;
  const H = 44;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.style.display = 'block';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 4;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - pad - ((v - min) / range) * (H - pad * 2)
  }));

  const trend = data[data.length - 1] - data[0];
  let lineColor, r, g, b;
  if (isHero) {
    lineColor = 'rgba(255,253,248,0.80)';
    r = 255; g = 253; b = 248;
  } else {
    const cs = getComputedStyle(document.documentElement);
    const hex = (trend >= 0
      ? cs.getPropertyValue('--up').trim()
      : cs.getPropertyValue('--down').trim()
    ).replace('#', '');
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    lineColor = `rgb(${r},${g},${b})`;
  }

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

  ctx.beginPath();
  ctx.moveTo(pts[0].x, H);
  ctx.lineTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(pts[pts.length - 1].x, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  ctx.stroke();

  // Inject sr-only data table so screen readers can access the sparkline values
  const fmt = formatter || formatCurrency;
  canvas.parentElement.querySelector('table.sr-only')?.remove();
  const tbl = document.createElement('table');
  tbl.className = 'sr-only';
  tbl.innerHTML = '<tbody><tr>' + data.map(v => `<td>${fmt(v)}</td>`).join('') + '</tr></tbody>';
  canvas.insertAdjacentElement('afterend', tbl);
}

function getPreviousMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

let _networthScale = '6m'; // '6m' | '1y' | 'all'

function renderChartNetworthHistory() {
  const ctx = document.getElementById('chart-networth-history');
  if (!ctx) return;

  const { gridColor, textColor, fontFamily, accent, accentFill } = getChartDefaults();

  // Filtrar según escala seleccionada
  const N = { '1m': 2, '3m': 3, '6m': 6, '1y': 12 }[_networthScale];
  const history = N ? APP.networthHistory.slice(-N) : APP.networthHistory;

  if (history.length === 0) {
    Charts.destroy('networth-history', 'chart-networth-history');
    ctx.parentElement.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center">Sin historial de patrimonio</div>';
    return;
  }

  const labels = history.map(h => {
    const [y, m] = h.date.split('-');
    return new Date(y, m - 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
  });
  const values = history.map(h => h.value);

  // Single point: duplicate so Chart.js renders a visible dot
  const isSingle = history.length === 1;
  const chartLabels = isSingle ? [labels[0], labels[0]] : labels;
  const chartValues = isSingle ? [values[0], values[0]] : values;

  const nwChart = Charts.get('networth-history');
  if (nwChart) {
    nwChart.data.labels = chartLabels;
    nwChart.data.datasets[0].data = chartValues;
    nwChart.data.datasets[0].borderColor = accent;
    nwChart.data.datasets[0].backgroundColor = accentFill;
    nwChart.data.datasets[0].pointBackgroundColor = accent;
    nwChart.data.datasets[0].pointRadius = isSingle ? 6 : 4;
    nwChart.data.datasets[0].tension = isSingle ? 0 : 0.4;
    nwChart.options.scales.x.grid.color = gridColor;
    nwChart.options.scales.x.ticks.color = textColor;
    nwChart.options.scales.y.grid.color = gridColor;
    nwChart.options.scales.y.ticks.color = textColor;
    nwChart.update('none');
    return;
  }

  Charts.destroy('networth-history', 'chart-networth-history');
  Charts.set('networth-history', new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Patrimonio Neto',
        data: chartValues,
        borderColor: accent,
        backgroundColor: accentFill,
        borderWidth: 2,
        pointBackgroundColor: accent,
        pointRadius: isSingle ? 6 : 4,
        pointHoverRadius: 6,
        tension: isSingle ? 0 : 0.4,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: c => formatCurrency(c.raw) }
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: fontFamily, size: 11 } }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { family: fontFamily, size: 11 },
            callback: v => '€' + Intl.NumberFormat('es-ES', { notation: 'compact' }).format(v)
          }
        }
      }
    }
  }));
}

function renderChartDistribution(cash, portfolio, alternatives, properties = 0) {
  const ctx = document.getElementById('chart-distribution');
  if (!ctx) return;

  const { textColor, fontFamily } = getChartDefaults();

  const allValues = [cash, portfolio, properties, alternatives];
  const allLabels = ['Efectivo', 'Inversiones', 'Inmuebles', 'Alt. Inv.'];
  const colors = ['#c9a84c', '#5b6aff', '#26a0b5', '#3ddc84'];
  const data   = allValues.filter(v => v > 0);
  const labels = allLabels.filter((_, i) => allValues[i] > 0);
  const filteredColors = colors.filter((_, i) => allValues[i] > 0);

  const distChart = Charts.get('distribution');
  if (distChart) {
    distChart.data.labels = labels;
    distChart.data.datasets[0].data = data;
    distChart.data.datasets[0].backgroundColor = filteredColors;
    distChart.update('none');
  } else {
    Charts.destroy('distribution', 'chart-distribution');
    Charts.set('distribution', new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: filteredColors,
          borderColor: 'transparent',
          borderWidth: 0,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)}`
            }
          }
        }
      }
    }));
  }

  // Leyenda manual
  const legendEl = document.getElementById('dist-legend');
  if (legendEl) {
    const total = data.reduce((s, v) => s + v, 0);
    legendEl.innerHTML = labels.map((l, i) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${filteredColors[i]}"></span>
        <span>${l}: ${total > 0 ? ((data[i] / total) * 100).toFixed(1) : 0}%</span>
      </div>
    `).join('');
  }
}

function renderTopInvestments() {
  const el = document.getElementById('top-investments-list');
  if (!el) return;

  if (APP.portfolio.length === 0) {
    el.innerHTML = `<div class="dash-empty">Sin inversiones aún — <span class="link-btn" onclick="navigateTo('portfolio')">Añadir activo</span></div>`;
    return;
  }

  const sorted = [...APP.portfolio]
    .map(a => ({
      ...a,
      gain: a.currentPrice - a.buyPrice,
      pct:  ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100
    }))
    .sort((a, b) => b.pct - a.pct);

  el.innerHTML = sorted.slice(0, 5).map((a, i) => `
    <div class="ranked-item">
      <div class="ranked-rank">#${i + 1}</div>
      <div class="ranked-info">
        <div class="ranked-name">${escapeHtml(a.name)}</div>
        <div class="ranked-ticker">${escapeHtml(a.ticker)}</div>
      </div>
      <div class="ranked-pct ${colorClass(a.pct)}">${formatPct(a.pct)}</div>
    </div>
  `).join('');
}

function renderRecentActivity() {
  _delegate('dash-block-activity', {
    'edit-tx':   id => editTransaction(id),
    'delete-tx': id => { deleteTransaction(id); },
  });

  const el = document.getElementById('recent-transactions');
  if (!el) return;

  const recent = [...APP.transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  if (recent.length === 0) {
    el.innerHTML = `<div class="dash-empty">Sin actividad reciente — <span class="link-btn" onclick="navigateTo('transactions')">Añadir transacción</span></div>`;
    return;
  }

  el.innerHTML = recent.map(t => {
    const isIncome = t.type === 'income';
    return `
      <div class="activity-item" data-id="${escapeHtml(t.id)}">
        <div class="activity-dot" style="background:${isIncome ? 'var(--positive)' : 'var(--negative)'}"></div>
        <div class="activity-info">
          <div class="activity-desc">${escapeHtml(t.description)}</div>
          <div class="activity-date">${formatDate(t.date)} · ${escapeHtml(t.category)}</div>
        </div>
        <div class="activity-amount ${isIncome ? 'positive' : 'negative'}">
          ${isIncome ? '+' : '-'}${formatCurrency(t.amount)}
        </div>
        <div class="activity-actions">
          <button class="btn-icon-xs" data-action="edit-tx" title="Editar">✏</button>
          <button class="btn-icon-xs btn-icon-xs-danger" data-action="delete-tx" title="Eliminar">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderDashGoals() {
  const el = document.getElementById('dash-goals-list');
  if (!el) return;
  if (APP.goals.length === 0) {
    el.innerHTML = `<div class="dash-empty">Sin objetivos — <span class="link-btn" onclick="navigateTo('goals')">Crea uno</span></div>`;
    return;
  }
  const sorted = [...APP.goals]
    .sort((a, b) => (b.currentAmount / (b.targetAmount || 1)) - (a.currentAmount / (a.targetAmount || 1)))
    .slice(0, 4);
  el.innerHTML = sorted.map(g => {
    const pct = g.targetAmount > 0 ? Math.min((g.currentAmount / g.targetAmount) * 100, 100) : 0;
    const daysLeft = g.deadline ? Math.ceil((new Date(g.deadline) - new Date()) / 86400000) : null;
    return `
      <div class="dash-goal-row">
        <div class="dash-goal-header">
          <span class="dash-goal-name">${g.emoji || '🎯'} ${escapeHtml(g.name)}</span>
          <span class="dash-goal-pct">${pct.toFixed(0)}%</span>
        </div>
        <div class="dash-goal-bar-bg">
          <div class="dash-goal-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="dash-goal-amounts">
          <span>${formatCurrency(g.currentAmount)}</span>
          <span style="color:var(--text-muted)">${formatCurrency(g.targetAmount)}${daysLeft !== null ? ` · ${daysLeft > 0 ? daysLeft + 'd' : 'Vencido'}` : ''}</span>
        </div>
      </div>`;
  }).join('');
}

function renderDashExpenseCats() {
  const el     = document.getElementById('dash-expense-cats');
  const subEl  = document.getElementById('dash-expense-month');
  if (!el) return;
  const currentMonth = getCurrentMonth();
  if (subEl) subEl.textContent = new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const monthExp = APP.transactions.filter(t => t.type === 'expense' && (t.date || getCurrentMonth()).startsWith(currentMonth));
  if (monthExp.length === 0) {
    el.innerHTML = `<div class="dash-empty">Sin gastos este mes</div>`;
    return;
  }
  const byCat = {};
  monthExp.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const sorted  = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxAmt  = sorted[0][1];

  el.innerHTML = sorted.map(([cat, amt]) => {
    const pct = (amt / maxAmt) * 100;
    return `
      <div class="dash-cat-row">
        <div class="dash-cat-name">${escapeHtml(cat)}</div>
        <div class="dash-cat-bar-bg">
          <div class="dash-cat-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="dash-cat-amt">${formatCurrency(amt)}</div>
      </div>`;
  }).join('');
}

/* ─── Insight inteligente ─────────────────────────────────────── */

function calcDashboardInsight() {
  const currentMonth = getCurrentMonth();
  const months6      = getLast6Months();     // includes current month
  const past5        = months6.slice(0, 5);  // exclude current month

  const insights = [];

  // Gasto del mes vs media de los 5 meses anteriores
  const pastExps = past5.map(m => calcMonthlyExpense(m)).filter(v => v > 0);
  if (pastExps.length >= 2) {
    const currentExp = calcMonthlyExpense(currentMonth);
    if (currentExp > 0) {
      const avg = pastExps.reduce((s, v) => s + v, 0) / pastExps.length;
      const pct = ((currentExp - avg) / avg) * 100;
      if (Math.abs(pct) >= 10) {
        insights.push({
          type:  pct > 0 ? 'warning' : 'positive',
          icon:  pct > 0 ? '📈' : '📉',
          text:  pct > 0
            ? `Este mes gastas un <strong>${Math.abs(pct).toFixed(0)}% más</strong> que tu media de los últimos 6 meses (media: ${formatCurrency(avg)}/mes)`
            : `Este mes gastas un <strong>${Math.abs(pct).toFixed(0)}% menos</strong> que tu media de los últimos 6 meses — ¡buen ritmo!`,
          score: Math.abs(pct) + 20,
        });
      }
    }
  }

  // Objetivo cercano a completarse
  const nearGoal = (APP.goals || []).find(g => {
    const p = g.targetAmount > 0 ? ((g.currentAmount || 0) / g.targetAmount) * 100 : 0;
    return p >= 75 && p < 100;
  });
  if (nearGoal) {
    const p         = ((nearGoal.currentAmount || 0) / nearGoal.targetAmount) * 100;
    const remaining = nearGoal.targetAmount - (nearGoal.currentAmount || 0);
    insights.push({
      type:  'positive',
      icon:  nearGoal.emoji || '🎯',
      text:  `Estás al <strong>${p.toFixed(0)}%</strong> de tu objetivo <em>${escapeHtml(nearGoal.name)}</em> — solo faltan <strong>${formatCurrency(remaining)}</strong>`,
      score: p * 0.8,
    });
  }

  // Crecimiento del patrimonio mes anterior
  const hist = APP.networthHistory || [];
  if (hist.length >= 2) {
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    if (prev.value > 0) {
      const pct  = ((last.value - prev.value) / prev.value) * 100;
      const diff = last.value - prev.value;
      if (Math.abs(pct) >= 2) {
        insights.push({
          type:  pct > 0 ? 'positive' : 'warning',
          icon:  '💰',
          text:  pct > 0
            ? `Tu patrimonio creció <strong>${formatCurrency(diff)}</strong> (+${pct.toFixed(1)}%) respecto al mes anterior`
            : `Tu patrimonio bajó <strong>${formatCurrency(Math.abs(diff))}</strong> (${pct.toFixed(1)}%) respecto al mes anterior`,
          score: Math.abs(pct) * 1.5,
        });
      }
    }
  }

  // Categoría de gasto dominante este mes
  const currentExp = calcMonthlyExpense(currentMonth);
  if (currentExp > 50) {
    const byCat = {};
    APP.transactions.filter(t => t.type === 'expense' && (t.date || getCurrentMonth()).startsWith(currentMonth))
      .forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / currentExp >= 0.40) {
      insights.push({
        type:  'neutral',
        icon:  '💸',
        text:  `<strong>${escapeHtml(top[0])}</strong> representa el <strong>${((top[1] / currentExp) * 100).toFixed(0)}%</strong> de tus gastos este mes (${formatCurrency(top[1])})`,
        score: (top[1] / currentExp) * 40,
      });
    }
  }

  if (!insights.length) return null;
  return insights.sort((a, b) => b.score - a.score)[0];
}

function renderMonthlyRecap() {
  const el = document.getElementById('dash-monthly-recap');
  if (!el) return;

  // Only show for the previous month, once per month-transition
  const now   = new Date();
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;

  if (APP.lastRecapShown === prevMonth) { el.style.display = 'none'; return; }

  // Need at least some transactions in the previous month to show anything meaningful
  const prevTxs = APP.transactions.filter(t => (t.date || getCurrentMonth()).startsWith(prevMonth));
  if (prevTxs.length === 0) { el.style.display = 'none'; return; }

  const prevIncome  = prevTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const prevExpense = prevTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const prevBalance = prevIncome - prevExpense;
  const savingsRate = prevIncome > 0 ? (prevBalance / prevIncome * 100) : null;

  // Top expense category and comparison to 3-month average
  const byCategory = {};
  prevTxs.filter(t => t.type === 'expense').forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  // 3-month average for the top category
  let catCompareItem = '';
  if (topCat) {
    const histMonths = [-2, -3, -4].map(o => {
      const d = new Date(now.getFullYear(), now.getMonth() + o, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const histAvg = histMonths.reduce((sum, m) => {
      const mTxs = APP.transactions.filter(t => t.type === 'expense' && t.category === topCat[0] && (t.date || getCurrentMonth()).startsWith(m));
      return sum + mTxs.reduce((s, t) => s + t.amount, 0);
    }, 0) / 3;
    if (histAvg > 0) {
      const diff = topCat[1] - histAvg;
      const cls  = diff > 0 ? 'negative' : 'positive';
      catCompareItem = `<span class="recap-item"><span class="recap-label">${escapeHtml(topCat[0])} vs media</span><span class="recap-val ${cls}">${formatCurrency(diff, true)}</span></span>`;
    }
  }

  // Active goals progress (top 2 by % completion)
  const goalItems = (APP.goals || [])
    .filter(g => g.targetAmount > 0 && g.currentAmount < g.targetAmount)
    .sort((a, b) => (b.currentAmount / b.targetAmount) - (a.currentAmount / a.targetAmount))
    .slice(0, 2)
    .map(g => {
      const pct = Math.round(g.currentAmount / g.targetAmount * 100);
      return `<span class="recap-item"><span class="recap-label">${g.emoji || '◎'} ${escapeHtml(g.name)}</span><span class="recap-val">${pct}%</span></span>`;
    });

  const monthName = prevD.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const balClass  = prevBalance >= 0 ? 'positive' : 'negative';

  const recapItems = [
    `<span class="recap-item"><span class="recap-label">Ingresos</span><span class="recap-val positive">+${formatCurrency(prevIncome)}</span></span>`,
    `<span class="recap-item"><span class="recap-label">Gastos</span><span class="recap-val negative">-${formatCurrency(prevExpense)}</span></span>`,
    `<span class="recap-item"><span class="recap-label">Balance</span><span class="recap-val ${balClass}">${formatCurrency(prevBalance, true)}</span></span>`,
    savingsRate !== null
      ? `<span class="recap-item"><span class="recap-label">Tasa ahorro</span><span class="recap-val">${savingsRate.toFixed(1)}%</span></span>`
      : '',
    catCompareItem,
    ...goalItems,
  ].filter(Boolean).join('');

  el.style.display = '';
  el.innerHTML = `
    <div class="recap-banner">
      <div class="recap-header">
        <span class="recap-icon">📅</span>
        <span class="recap-title">Estado de ${monthName}</span>
        <button class="recap-close" onclick="dismissMonthlyRecap('${prevMonth}')" aria-label="Cerrar resumen">✕</button>
      </div>
      <div class="recap-stats">${recapItems}</div>
    </div>
  `;
}

function dismissMonthlyRecap(month) {
  APP.lastRecapShown = month;
  saveData();
  const el = document.getElementById('dash-monthly-recap');
  if (el) el.style.display = 'none';
}

function renderDashboardInsight() {
  const el = document.getElementById('dash-insight-banner');
  if (!el) return;
  const insight = calcDashboardInsight();
  if (!insight) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.className     = `dash-insight-banner dash-insight-${insight.type}`;
  el.innerHTML     = `<span class="dash-insight-icon">${insight.icon}</span><span class="dash-insight-text">${insight.text}</span>`;
}

/* ─── Sistema de alertas ─────────────────────────────────────── */

function _isAlertDismissed(key) {
  const ts = (APP.dismissedAlerts || {})[key];
  if (!ts) return false;
  return (Date.now() - ts) < 7 * 24 * 60 * 60 * 1000;
}

function dismissAlert(key) {
  if (!APP.dismissedAlerts) APP.dismissedAlerts = {};
  APP.dismissedAlerts[key] = Date.now();
  saveData();
  renderDashboardAlerts();
}

function calcAlerts() {
  const alerts = [];
  const today  = new Date();
  const day    = today.getDate();

  // Goal stagnation: linked category with no transactions in the past 90 days
  const cutoff90 = new Date(today);
  cutoff90.setDate(cutoff90.getDate() - 90);
  const cutoff90Str = cutoff90.toISOString().slice(0, 10);

  (APP.goals || []).forEach(g => {
    if (!g.linkedCategory) return;
    const pct = g.targetAmount > 0 ? (g.currentAmount || 0) / g.targetAmount * 100 : 0;
    if (pct >= 100) return;
    const hasRecent = APP.transactions.some(t =>
      t.category === g.linkedCategory && t.date >= cutoff90Str
    );
    if (!hasRecent) {
      const key = `goal-stagnant-${g.id}`;
      if (!_isAlertDismissed(key)) {
        alerts.push({ key, type: 'warning', icon: g.emoji || '🎯',
          text: `Tu objetivo <strong>${escapeHtml(g.name)}</strong> lleva más de 3 meses sin progreso` });
      }
    }
  });

  // Goal deadline approaching (within 60 days, < 100%)
  (APP.goals || []).forEach(g => {
    if (!g.deadline) return;
    const pct = g.targetAmount > 0 ? (g.currentAmount || 0) / g.targetAmount * 100 : 0;
    if (pct >= 100) return;
    const daysLeft = Math.ceil((new Date(g.deadline) - today) / 86400000);
    if (daysLeft > 0 && daysLeft <= 60) {
      const key = `goal-deadline-${g.id}`;
      if (!_isAlertDismissed(key)) {
        alerts.push({ key, type: 'warning', icon: g.emoji || '🎯',
          text: `Tu objetivo <strong>${escapeHtml(g.name)}</strong> vence en <strong>${daysLeft} días</strong> — llevas el <strong>${pct.toFixed(0)}%</strong>` });
      }
    }
  });

  // Goal overdue
  (APP.goals || []).forEach(g => {
    if (!g.deadline) return;
    const pct = g.targetAmount > 0 ? (g.currentAmount || 0) / g.targetAmount * 100 : 0;
    if (pct >= 100) return;
    const daysOverdue = Math.floor((today - new Date(g.deadline)) / 86400000);
    if (daysOverdue > 0) {
      const key = `goal-overdue-${g.id}`;
      if (!_isAlertDismissed(key)) {
        alerts.push({ key, type: 'danger', icon: '⚠️',
          text: `El plazo del objetivo <strong>${escapeHtml(g.name)}</strong> venció hace <strong>${daysOverdue} días</strong> — al <strong>${pct.toFixed(0)}%</strong>` });
      }
    }
  });

  // Negative monthly balance
  const currentMonth = getCurrentMonth();
  const income  = calcMonthlyIncome(currentMonth);
  const expense = calcMonthlyExpense(currentMonth);
  if (income > 0 || expense > 0) {
    const balance = income - expense;
    if (balance < 0) {
      const key = `neg-balance-${currentMonth}`;
      if (!_isAlertDismissed(key)) {
        alerts.push({ key, type: 'danger', icon: '📉',
          text: `Tu balance de este mes es negativo: <strong>${formatCurrency(balance)}</strong> — gastos por encima de ingresos` });
      }
    }
  }

  // No income after day 15
  if (day >= 15 && income === 0) {
    const key = `no-income-${currentMonth}`;
    if (!_isAlertDismissed(key)) {
      alerts.push({ key, type: 'info', icon: '💡',
        text: `Aún no has registrado ningún ingreso este mes` });
    }
  }

  // Watchlist price alerts
  (APP.watchlist || []).forEach(w => {
    if (!w.targetPrice || w.targetPrice <= 0) return;
    const alertType = w.alertType || 'above';
    const reached   = alertType === 'below' ? w.currentPrice <= w.targetPrice : w.currentPrice >= w.targetPrice;
    if (!reached) return;
    const key = `watch-alert-${w.id}-${alertType}`;
    if (!_isAlertDismissed(key)) {
      const dir = alertType === 'below' ? 'por debajo de' : 'por encima de';
      alerts.push({ key, type: 'warning', icon: '🔔',
        text: `<strong>${escapeHtml(w.name)} (${escapeHtml(w.ticker)})</strong> está ${dir} tu precio objetivo <strong>${formatCurrency(w.targetPrice)}</strong>` });
    }
  });

  // Overdue recurring transactions
  const dueRec = (APP.recurring || []).filter(r => r.active && r.nextDate && r.nextDate <= today.toISOString().slice(0, 10));
  if (dueRec.length > 0) {
    const key = `rec-due-${today.toISOString().slice(0, 7)}`;
    if (!_isAlertDismissed(key)) {
      const total = dueRec.reduce((s, r) => s + r.amount, 0);
      const names = dueRec.slice(0, 2).map(r => escapeHtml(r.description)).join(', ');
      const extra = dueRec.length > 2 ? ` y ${dueRec.length - 2} más` : '';
      alerts.push({ key, type: 'info', icon: '⟳',
        text: `Tienes <strong>${dueRec.length} transacción${dueRec.length > 1 ? 'es' : ''} recurrente${dueRec.length > 1 ? 's' : ''}</strong> pendiente${dueRec.length > 1 ? 's' : ''} de registrar: ${names}${extra} — <strong>${formatCurrency(total)}</strong>` });
    }
  }

  // Budget overrun alerts
  (APP.budgets || []).forEach(b => {
    const spent = APP.transactions.filter(t => t.type === 'expense' && t.category === b.category && (t.date || getCurrentMonth()).startsWith(currentMonth)).reduce((s, t) => s + t.amount, 0);
    if (spent <= b.monthlyAmount) return;
    const key = `budget-over-${b.category}-${currentMonth}`;
    if (!_isAlertDismissed(key)) {
      const over = spent - b.monthlyAmount;
      alerts.push({ key, type: 'warning', icon: '💸',
        text: `Presupuesto de <strong>${escapeHtml(b.category)}</strong> superado en <strong>${formatCurrency(over)}</strong> este mes` });
    }
  });

  // ── Smart alerts ──────────────────────────────────────────

  // Savings rate significant drop vs rolling average (last 6 complete months)
  const ratesLast6 = [];
  for (let i = 1; i <= 6; i++) {
    const d   = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const txs = APP.transactions.filter(t => (t.date || '').startsWith(key));
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    if (inc > 0) ratesLast6.push((inc - exp) / inc * 100);
  }
  if (ratesLast6.length >= 2 && income > 0) {
    const avgRate     = ratesLast6.reduce((s, r) => s + r, 0) / ratesLast6.length;
    const currentRate = (income - expense) / income * 100;
    const dropThresh  = (APP.smartAlertsConfig?.savingsDropPct) ?? 30;
    if (avgRate > 5 && currentRate < avgRate) {
      const dropPct = (avgRate - currentRate) / Math.abs(avgRate) * 100;
      if (dropPct >= dropThresh) {
        const alertKey = `savings-drop-${currentMonth}`;
        if (!_isAlertDismissed(alertKey)) {
          alerts.push({ key: alertKey, type: 'warning', icon: '📉',
            text: `Tu tasa de ahorro bajó un <strong>${dropPct.toFixed(0)}%</strong> este mes respecto a tu media de los últimos 6 meses (<strong>${avgRate.toFixed(1)}%</strong> → <strong>${currentRate.toFixed(1)}%</strong>)` });
        }
      }
    }
  }

  // Portfolio concentration warning
  const totalPortValue = calcPortfolioValue();
  const concentrationLimit = (APP.smartAlertsConfig?.concentrationPct) ?? 30;
  if (totalPortValue > 0) {
    (APP.portfolio || []).forEach(a => {
      const val = assetValue(a);
      const pct = val / totalPortValue * 100;
      if (pct < concentrationLimit) return;
      const alertKey = `concentration-${a.id}-${currentMonth}`;
      if (!_isAlertDismissed(alertKey)) {
        const ticker = a.ticker ? ` (${escapeHtml(a.ticker)})` : '';
        alerts.push({ key: alertKey, type: 'warning', icon: '⚠️',
          text: `<strong>${escapeHtml(a.name)}${ticker}</strong> representa el <strong>${pct.toFixed(0)}%</strong> de tu cartera — supera tu límite de concentración del <strong>${concentrationLimit}%</strong>` });
      }
    });
  }

  // Tax 2-month holding period countdown (regla de los 2 meses, España)
  (APP.portfolio || []).forEach(a => {
    if (!a.buyDate) return;
    const buyTs   = new Date(a.buyDate + 'T00:00:00').getTime();
    const daysSince = Math.floor((today.getTime() - buyTs) / 86400000);
    if (daysSince < 0 || daysSince >= 60) return;
    const daysLeft  = 60 - daysSince;
    const alertKey  = `tax-hold-${a.id}`;
    if (!_isAlertDismissed(alertKey)) {
      const ticker = a.ticker ? ` (${escapeHtml(a.ticker)})` : '';
      alerts.push({ key: alertKey, type: 'info', icon: '⏱',
        text: `Quedan <strong>${daysLeft} días</strong> para que puedas vender <strong>${escapeHtml(a.name)}${ticker}</strong> sin infringir la regla de los 2 meses` });
    }
  });

  // ── Alertas personalizadas del usuario ────────────────────────
  (APP.customAlerts || []).filter(ca => ca.active !== false).forEach(ca => {
    const monthKey = `custom-${ca.id}-${currentMonth}`;
    if (_isAlertDismissed(monthKey)) return;
    let triggered = false;
    let text = '';

    switch (ca.type) {
      case 'price_above':
      case 'price_below': {
        const asset = (APP.portfolio || []).find(p => p.id === ca.params.assetId);
        if (!asset) return;
        triggered = ca.type === 'price_above'
          ? asset.currentPrice >= ca.params.threshold
          : asset.currentPrice <= ca.params.threshold;
        const dir = ca.type === 'price_above' ? 'alcanzado' : 'bajado a';
        text = `<strong>${escapeHtml(asset.name)}</strong> ha ${dir} <strong>${formatCurrency(asset.currentPrice)}</strong> (umbral: ${formatCurrency(ca.params.threshold)})`;
        break;
      }
      case 'networth_above':
      case 'networth_below': {
        const nw = calcNetWorth();
        triggered = ca.type === 'networth_above' ? nw >= ca.params.threshold : nw <= ca.params.threshold;
        const dir2 = ca.type === 'networth_above' ? 'superado' : 'bajado de';
        text = `Tu patrimonio ha ${dir2} <strong>${formatCurrency(ca.params.threshold)}</strong> — actual: <strong>${formatCurrency(nw)}</strong>`;
        break;
      }
      case 'expense_month': {
        const expM = calcMonthlyExpense(currentMonth);
        triggered = expM >= ca.params.threshold;
        text = `Gasto mensual superó <strong>${formatCurrency(ca.params.threshold)}</strong> — llevas <strong>${formatCurrency(expM)}</strong>`;
        break;
      }
      case 'income_below': {
        if (day >= 20) {
          const incM = calcMonthlyIncome(currentMonth);
          triggered = incM <= ca.params.threshold;
          text = `Ingresos este mes <strong>${formatCurrency(incM)}</strong> por debajo de <strong>${formatCurrency(ca.params.threshold)}</strong>`;
        }
        break;
      }
      case 'savings_rate_below': {
        const incS = calcMonthlyIncome(currentMonth);
        if (incS > 0) {
          const rate = (incS - calcMonthlyExpense(currentMonth)) / incS * 100;
          triggered = rate < ca.params.threshold;
          text = `Tasa de ahorro <strong>${rate.toFixed(1)}%</strong> por debajo de tu objetivo del <strong>${ca.params.threshold}%</strong>`;
        }
        break;
      }
      case 'category_spend': {
        const catSpent = (APP.transactions || []).filter(t => t.type === 'expense' && t.category === ca.params.category && (t.date || '').startsWith(currentMonth)).reduce((s, t) => s + t.amount, 0);
        triggered = catSpent >= ca.params.threshold;
        text = `Gasto en <strong>${escapeHtml(ca.params.category)}</strong> superó <strong>${formatCurrency(ca.params.threshold)}</strong> — llevas <strong>${formatCurrency(catSpent)}</strong>`;
        break;
      }
      case 'goal_pct': {
        const gobj = (APP.goals || []).find(g => g.id === ca.params.goalId);
        if (gobj) {
          const gpct = gobj.targetAmount > 0 ? (gobj.currentAmount || 0) / gobj.targetAmount * 100 : 0;
          triggered = gpct >= ca.params.threshold;
          text = `Objetivo <strong>${escapeHtml(gobj.name)}</strong> ha alcanzado el <strong>${gpct.toFixed(0)}%</strong>`;
        }
        break;
      }
    }

    if (triggered) {
      const fullText = ca.label ? `<strong>${escapeHtml(ca.label)}:</strong> ${text}` : text;
      alerts.push({ key: monthKey, type: ca.severity || 'info', icon: ca.icon || '🔔', text: fullText });
    }
  });

  return alerts;
}

/* ─── KPI Narrative helpers ──────────────────────────────────── */

function _skelList(id, n) {
  const el = document.getElementById(id);
  if (!el || el.children.length > 0) return;
  el.innerHTML = Array.from({ length: n }, () =>
    `<div class="skel-row">
       <div class="skel skel-dot"></div>
       <div class="skel-body">
         <div class="skel skel-line"></div>
         <div class="skel skel-line skel-line-sm"></div>
       </div>
       <div class="skel skel-end"></div>
     </div>`
  ).join('');
}

function _setKpiNarrative(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function _narrativeNetworth(networth) {
  const hist = APP.networthHistory;
  if (hist.length < 2) return '';

  // All-time high (requires at least 3 data points to be meaningful)
  if (hist.length >= 3) {
    const max = Math.max(...hist.map(h => h.value));
    if (networth >= max) return '<span class="kpi-narrative-star">✦ Máximo histórico</span>';
  }

  // YTD change — compare against first entry of current year
  const yr   = new Date().getFullYear().toString();
  const jan  = hist.find(h => h.date.startsWith(yr + '-01')) || hist.find(h => h.date.startsWith(yr));
  if (jan && jan.value > 0 && networth !== jan.value) {
    const ytd    = networth - jan.value;
    const ytdPct = (ytd / jan.value) * 100;
    if (Math.abs(ytdPct) >= 0.5) {
      const s = ytd >= 0 ? '+' : '';
      return `${s}${formatCurrency(ytd)} este año (${s}${ytdPct.toFixed(1)}%)`;
    }
  }

  // Consecutive positive months
  const recent = hist.slice(-6);
  let streak = 0;
  for (let i = recent.length - 1; i > 0; i--) {
    if (recent[i].value > recent[i - 1].value) streak++;
    else break;
  }
  if (streak >= 3) return `${streak} meses consecutivos al alza`;

  return '';
}

function _narrativeBalance(balance) {
  // Best month of the year?
  const now = new Date();
  const yr  = now.getFullYear();
  const yearBalances = [];
  for (let i = 0; i <= now.getMonth(); i++) {
    const m   = `${yr}-${String(i + 1).padStart(2, '0')}`;
    const txs = APP.transactions.filter(t => (t.date || getCurrentMonth()).startsWith(m));
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    yearBalances.push(inc - exp);
  }
  const maxYear = Math.max(...yearBalances);
  if (yearBalances.length >= 3 && balance > 0 && balance >= maxYear) {
    return '<span class="kpi-narrative-star">Mejor mes del año</span>';
  }

  // Compare vs 6-month average (exclude current month)
  const past5 = _getLastNMonthsBalances(6).slice(0, 5);
  if (past5.length >= 3) {
    const avg  = past5.reduce((s, v) => s + v, 0) / past5.length;
    const diff = balance - avg;
    const pct  = avg !== 0 ? (diff / Math.abs(avg)) * 100 : 0;
    if (Math.abs(pct) >= 15) {
      const s = diff >= 0 ? '+' : '';
      return `${s}${Math.round(pct)}% vs tu media de 6 meses`;
    }
  }

  return '';
}

function _getLastNMonthsBalances(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d   = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const m   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const txs = APP.transactions.filter(t => (t.date || getCurrentMonth()).startsWith(m));
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return inc - exp;
  });
}

function _narrativePortfolio() {
  if (!APP.portfolio.length) return '';
  const assets = APP.portfolio.map(a => ({
    label: a.ticker || a.name,
    pct:   a.buyPrice > 0 ? ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100 : 0,
  }));
  const positives = assets.filter(a => a.pct > 0).length;
  const best      = [...assets].sort((a, b) => b.pct - a.pct)[0];
  const s         = best.pct >= 0 ? '+' : '';
  const bestStr   = Math.abs(best.pct) >= 0.5
    ? `Mejor: ${escapeHtml(best.label)} ${s}${best.pct.toFixed(1)}%`
    : '';
  const countStr  = `${positives}/${APP.portfolio.length} en positivo`;
  return bestStr ? `${bestStr} · ${countStr}` : countStr;
}

function _narrativeCash() {
  const n = APP.cashAccounts.length;
  if (!n) return '';
  return n === 1 ? '1 cuenta' : `${n} cuentas`;
}

// Offline savings benchmarks — Eurostat 2023 data, no API needed
const _SAVINGS_BENCHMARKS = { es: 17, eu: 28 };

function _narrativeSavings(rate) {
  if (rate === null) return '';

  // 6-month personal average (exclude current month)
  const now   = new Date();
  const rates = [];
  for (let i = 1; i <= 5; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const txs = APP.transactions.filter(t => (t.date || getCurrentMonth()).startsWith(m));
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    if (inc > 0) rates.push((inc - exp) / inc * 100);
  }

  const { es, eu } = _SAVINGS_BENCHMARKS;
  let bench = '';
  if (rate >= eu)      bench = `<span class="kpi-narrative-star">Superas la media europea (${eu}%) ✦</span>`;
  else if (rate >= es) bench = `Por encima de la media española (${es}%), por debajo de la europea (${eu}%)`;
  else                 bench = `Media española ${es}% · europea ${eu}%`;

  if (rates.length >= 2) {
    const avg  = rates.reduce((s, v) => s + v, 0) / rates.length;
    const diff = rate - avg;
    const personal = Math.abs(diff) >= 3
      ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp vs tu media (${avg.toFixed(1)}%)`
      : `Media 6m: ${avg.toFixed(1)}%`;
    return `${personal} · ${bench}`;
  }
  return bench;
}

function _narrativeDividends(annualDiv) {
  const n = APP.dividends.length;
  if (!n) return '';
  const label = `${n} activo${n !== 1 ? 's' : ''} con dividendo`;
  const portVal = calcPortfolioValue();
  if (portVal > 0 && annualDiv > 0) {
    const yld = (annualDiv / portVal) * 100;
    return `${label} · yield ${yld.toFixed(2)}%`;
  }
  return label;
}

/* ─── Regla 50/30/20 ──────────────────────────────────────────── */

function renderRule5030() {
  const el = document.getElementById('rule5030-content');
  if (!el) return;

  const m      = getCurrentMonth();
  const txs    = APP.transactions.filter(t => (t.date || getCurrentMonth()).startsWith(m));
  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);

  if (income === 0) {
    el.innerHTML = '<p class="empty-state-text" style="padding:20px 0">Sin ingresos este mes para calcular la regla.</p>';
    return;
  }

  const expenses = txs.filter(t => t.type === 'expense');
  const needsAmt = expenses.filter(t => getCategoryBudgetType(t.category) === 'needs').reduce((s, t) => s + t.amount, 0);
  const skipAmt  = expenses.filter(t => getCategoryBudgetType(t.category) === 'skip').reduce((s, t) => s + t.amount, 0);
  const wantsAmt = expenses.reduce((s, t) => s + t.amount, 0) - needsAmt - skipAmt;
  const savingsAmt = Math.max(0, income - needsAmt - wantsAmt - skipAmt);

  const rows = [
    { label: 'Necesidades', target: 50, amt: needsAmt,   cls: 'needs'   },
    { label: 'Deseos',      target: 30, amt: wantsAmt,   cls: 'wants'   },
    { label: 'Ahorro',      target: 20, amt: savingsAmt, cls: 'savings' },
  ];

  el.innerHTML = rows.map(r => {
    const actual     = income > 0 ? r.amt / income * 100 : 0;
    const barWidth   = Math.min(100, actual / r.target * 100);
    const isOver     = r.cls !== 'savings' && actual > r.target;
    const isLow      = r.cls === 'savings' && actual < r.target * 0.5;
    const statusCls  = (isOver || isLow) ? 'over' : actual >= r.target * 0.85 ? 'warn' : 'ok';
    return `
      <div class="rule5030-row">
        <div class="rule5030-row-header">
          <span class="rule5030-row-label">${r.label}</span>
          <span class="rule5030-pct rule5030-pct--${statusCls}">${actual.toFixed(0)}% <small>/ ${r.target}%</small></span>
        </div>
        <div class="rule5030-track">
          <div class="rule5030-fill rule5030-fill--${r.cls}${isOver ? ' rule5030-fill--over' : ''}" style="width:${barWidth}%"></div>
          <div class="rule5030-target-line"></div>
        </div>
        <div class="rule5030-row-detail">${formatCurrency(r.amt)} de ${formatCurrency(r.target / 100 * income)}</div>
      </div>`;
  }).join('');
}

function openRule5030Settings() {
  const cats = APP.categories.expense || [];
  const rows = cats.map(cat => {
    const type = getCategoryBudgetType(cat);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border-faint)">
        <span style="font-size:14px">${escapeHtml(cat)}</span>
        <select data-cat="${escapeHtml(cat)}" style="font-size:13px;padding:4px 8px;border-radius:var(--r-xs);background:var(--input-bg);border:1px solid var(--border-faint);color:var(--text-primary)">
          <option value="needs" ${type === 'needs' ? 'selected' : ''}>Necesidad (50%)</option>
          <option value="wants" ${type === 'wants' || (!APP.categoryBudgetType[cat] && !DEFAULT_BUDGET_TYPE[cat]) ? 'selected' : ''}>Deseo (30%)</option>
          <option value="skip"  ${type === 'skip'  ? 'selected' : ''}>Ignorar</option>
        </select>
      </div>`;
  }).join('');

  openModal(
    'Clasificar categorías — Regla 50/30/20',
    `<p style="font-size:13px;color:var(--text-secondary);margin:0 0 14px">
       Clasifica cada categoría de gasto para calcular la regla correctamente.
       Los valores por defecto se basan en patrones habituales de finanzas personales.
     </p>
     <div style="max-height:380px;overflow-y:auto;padding-right:4px">${rows}</div>`,
    () => {
      document.querySelectorAll('#modalBody [data-cat]').forEach(sel => {
        APP.categoryBudgetType[sel.dataset.cat] = sel.value;
      });
      saveData();
      renderRule5030();
    }
  );
}

function renderDashboardAlerts() {
  const el = document.getElementById('dash-alerts-container');
  if (!el) return;
  const alerts = calcAlerts();
  if (!alerts.length) { el.innerHTML = ''; return; }
  el.innerHTML = alerts.map(a => `
    <div class="dash-alert dash-alert-${a.type}">
      <span class="dash-alert-icon">${a.icon}</span>
      <span class="dash-alert-text">${a.text}</span>
      <button class="dash-alert-dismiss" onclick="dismissAlert('${escapeHtml(a.key)}')" title="Descartar">✕</button>
    </div>
  `).join('');
}

/* ─── Heatmap de gastos ───────────────────────────────────────── */

let _hmYear = new Date().getFullYear();
let _heatmapCache = null;

function renderSpendingHeatmap(year) {
  const el = document.getElementById('heatmap-content');
  if (!el) return;
  if (year !== undefined) { _hmYear = year; _heatmapCache = null; }

  const expTxs  = APP.transactions.filter(t => t.type === 'expense' && (t.date || getCurrentMonth()).startsWith(String(_hmYear)));
  const cacheKey = `${_hmYear}|${expTxs.length}`;
  if (_heatmapCache?.key === cacheKey) { el.innerHTML = _heatmapCache.html; return; }

  // Build day → expense amount map for the selected year
  const dayMap = {};
  expTxs.forEach(t => { dayMap[t.date] = (dayMap[t.date] || 0) + t.amount; });

  const amounts = Object.values(dayMap).filter(v => v > 0).sort((a, b) => a - b);
  const p25 = amounts[Math.floor(amounts.length * 0.25)] || 0;
  const p50 = amounts[Math.floor(amounts.length * 0.50)] || 0;
  const p75 = amounts[Math.floor(amounts.length * 0.75)] || 0;

  const getLevel = amt => {
    if (!amt) return 0;
    if (amt <= p25) return 1;
    if (amt <= p50) return 2;
    if (amt <= p75) return 3;
    return 4;
  };

  // Jan 1 of the year — what day of week is it? (Mon=0 … Sun=6, Spanish convention)
  const jan1   = new Date(_hmYear, 0, 1);
  const offset = (jan1.getDay() + 6) % 7;
  const isLeap = _hmYear % 4 === 0 && (_hmYear % 100 !== 0 || _hmYear % 400 === 0);
  const total  = isLeap ? 366 : 365;
  const today  = new Date().toISOString().slice(0, 10);

  const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const DAY_LABELS  = ['L','M','X','J','V','S','D'];

  // Build cell data: flatten into [col][row] grid
  const cells   = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 0; d < total; d++) {
    const dt  = new Date(_hmYear, 0, d + 1);
    const iso = `${_hmYear}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    cells.push({ iso, amt: dayMap[iso] || 0, month: dt.getMonth(), day: dt.getDate() });
  }
  const totalWeeks = Math.ceil(cells.length / 7);

  // Month label positions: first week containing each month's 1st
  const monthCols = {};
  cells.forEach((c, i) => {
    if (c && c.day === 1 && monthCols[c.month] === undefined) monthCols[c.month] = Math.floor(i / 7);
  });

  // Build month label row
  const monthHtml = Array.from({ length: totalWeeks }, (_, w) => {
    const entry = Object.entries(monthCols).find(([, col]) => col === w);
    return `<div class="hm-month-label">${entry ? MONTH_NAMES[Number(entry[0])] : ''}</div>`;
  }).join('');

  // Build cell grid (column-major: week columns, day rows)
  const colsHtml = Array.from({ length: totalWeeks }, (_, w) => {
    const colCells = Array.from({ length: 7 }, (__, d) => {
      const c = cells[w * 7 + d];
      if (!c) return `<div class="hm-cell hm-cell--empty"></div>`;
      const lv    = getLevel(c.amt);
      const label = c.amt > 0
        ? `${c.iso}: ${formatCurrency(c.amt)}`
        : c.iso;
      const isFuture = c.iso > today;
      return `<div class="hm-cell hm-cell--l${lv}${isFuture ? ' hm-cell--future' : ''}" title="${label}" aria-label="${label}"></div>`;
    }).join('');
    return `<div class="hm-col">${colCells}</div>`;
  }).join('');

  const totalSpend  = Object.values(dayMap).reduce((s, v) => s + v, 0);
  const activeDays  = Object.keys(dayMap).length;
  const currentYear = new Date().getFullYear();

  // Monthly totals for mobile view
  const monthlyTotals = Array.from({ length: 12 }, (_, mo) => {
    const prefix = `${_hmYear}-${String(mo + 1).padStart(2, '0')}`;
    return Object.entries(dayMap)
      .filter(([k]) => k.startsWith(prefix))
      .reduce((s, [, v]) => s + v, 0);
  });
  const maxMonthly = Math.max(...monthlyTotals, 1);
  const monthlyHtml = monthlyTotals.map((amt, mo) => {
    const pct = Math.round((amt / maxMonthly) * 100);
    return `<div class="hm-mo-row">
      <span class="hm-mo-label">${MONTH_NAMES[mo]}</span>
      <div class="hm-mo-bar-wrap"><div class="hm-mo-bar" style="width:${pct}%"></div></div>
      <span class="hm-mo-val">${amt > 0 ? formatCurrency(amt) : '—'}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="hm-toolbar">
      <button class="btn-ghost-sm" onclick="renderSpendingHeatmap(${_hmYear - 1})">← ${_hmYear - 1}</button>
      <span class="hm-year-label">${_hmYear}</span>
      <button class="btn-ghost-sm" onclick="renderSpendingHeatmap(${_hmYear + 1})"${_hmYear >= currentYear ? ' disabled' : ''}>${_hmYear + 1} →</button>
    </div>
    <div class="hm-wrap">
      <div class="hm-day-labels">${DAY_LABELS.map(l => `<div class="hm-day-label">${l}</div>`).join('')}</div>
      <div class="hm-grid-wrap">
        <div class="hm-months-row">${monthHtml}</div>
        <div class="hm-grid">${colsHtml}</div>
      </div>
    </div>
    <div class="hm-monthly">${monthlyHtml}</div>
    <div class="hm-footer">
      <span class="hm-stat">${activeDays} días con gasto · Total ${formatCurrency(totalSpend)}</span>
      <div class="hm-legend">
        <span class="hm-legend-label">Menos</span>
        ${[0,1,2,3,4].map(l => `<div class="hm-cell hm-cell--l${l} hm-legend-cell"></div>`).join('')}
        <span class="hm-legend-label">Más</span>
      </div>
    </div>`;

  _heatmapCache = { key: cacheKey, html: el.innerHTML };
}

/* ═══════════════════════════════════════════════════════════════
   WEALTH SCORE — indicador único 0–100 de salud financiera
═══════════════════════════════════════════════════════════════ */

function calcWealthScore() {
  const nw    = calcNetWorth();
  const liabs = calcLiabilitiesTotal();
  const gross = nw + liabs; // total activos brutos

  // ── 1. Tasa de ahorro (0–25 pts) — media últimos 3 meses completos
  const now = new Date();
  const savingsRates = [];
  for (let i = 1; i <= 3; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const txs = APP.transactions.filter(t => (t.date || '').startsWith(key));
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    if (inc > 0) savingsRates.push((inc - exp) / inc * 100);
  }
  const avgRate      = savingsRates.length ? savingsRates.reduce((s, r) => s + r, 0) / savingsRates.length : null;
  const savingsScore = avgRate !== null ? Math.max(0, Math.min(25, avgRate / 20 * 25)) : 0;

  // ── 2. Diversificación (0–20 pts) — por activos y tipos
  const port = APP.portfolio || [];
  let divScore = port.length >= 7 ? 20 : port.length >= 4 ? 14 : port.length >= 2 ? 8 : port.length === 1 ? 3 : 0;
  if (port.length > 0) {
    const tv  = calcPortfolioValue();
    const top = Math.max(...port.map(a => assetValue(a)));
    if (tv > 0 && top / tv > 0.6) divScore = Math.max(0, divScore - 7);
  }
  const assetTypes = [calcCashTotal() > 0, calcPortfolioValue() > 0, calcAlternativesTotal() > 0, calcPropertiesTotal() > 0].filter(Boolean).length;
  divScore = Math.min(20, divScore + (assetTypes >= 3 ? 4 : assetTypes >= 2 ? 2 : 0));

  // ── 3. Progreso FIRE (0–25 pts) — regla 4%: número FIRE = gastos anuales × 25
  const annualExp = calcMonthlyExpense() * 12;
  let fireScore = 0;
  let firePct   = null;
  if (annualExp > 0) {
    firePct    = Math.min(100, Math.max(0, nw / (annualExp * 25) * 100));
    fireScore  = firePct / 100 * 25;
  } else if (nw > 0) {
    fireScore = 5; // tiene patrimonio pero sin datos de gasto
  }

  // ── 4. Cobertura con dividendos (0–15 pts) — cubre ≥50% gastos anuales
  const FREQ = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const annualDiv = (APP.dividends || []).reduce((s, d) => s + d.dividendPerShare * d.shares * (FREQ[d.frequency] || 1) * (d.exchangeRate > 0 ? d.exchangeRate : 1), 0);
  let divCovScore = 0;
  let divCovPct   = 0;
  if (annualExp > 0 && annualDiv > 0) {
    divCovPct   = Math.min(100, annualDiv / (annualExp * 0.5) * 100);
    divCovScore = divCovPct / 100 * 15;
  }

  // ── 5. Salud de deuda (0–15 pts)
  const debtScore = gross > 0 ? Math.max(0, (1 - liabs / gross)) * 15 : 15;
  const debtPct   = gross > 0 ? Math.max(0, 100 - liabs / gross * 100) : 100;

  const total = Math.min(100, Math.round(savingsScore + divScore + fireScore + divCovScore + debtScore));

  const grade = total >= 80 ? 'Excelente' : total >= 65 ? 'Bueno' : total >= 40 ? 'En progreso' : 'Crítico';
  const color = total >= 80 ? 'excellent' : total >= 65 ? 'good' : total >= 40 ? 'fair' : 'poor';

  const comps = [
    { key: 'savings', pts: savingsScore, max: 25, label: 'Tasa de ahorro',    detail: avgRate !== null ? `${avgRate.toFixed(1)}%` : '—',  advice: 'Aumenta tu tasa de ahorro al 20 % de los ingresos mensuales.' },
    { key: 'div',     pts: divScore,     max: 20, label: 'Diversificación',   detail: `${port.length} activos`,                            advice: 'Amplía tu cartera con más activos y distintos tipos de inversión.' },
    { key: 'fire',    pts: fireScore,    max: 25, label: 'Progreso FIRE',     detail: firePct !== null ? `${firePct.toFixed(1)}%` : '—',   advice: 'Invierte hasta alcanzar 25× tus gastos anuales (regla del 4 %).' },
    { key: 'divcov',  pts: divCovScore,  max: 15, label: 'Renta pasiva',      detail: `${divCovPct.toFixed(0)}% cubierto`,                advice: 'Construye una cartera de dividendos que cubra el 50 % de tus gastos.' },
    { key: 'debt',    pts: debtScore,    max: 15, label: 'Salud de deuda',    detail: `${debtPct.toFixed(0)}% libre`,                     advice: 'Reduce tu deuda para mejorar tu ratio activos netos.' },
  ];

  const weakest = [...comps].sort((a, b) => a.pts / a.max - b.pts / b.max).slice(0, 2).map(c => c.advice);

  return { score: total, grade, color, comps, advice: weakest };
}

function renderWealthScore() {
  const el = document.getElementById('wealth-score-content');
  if (!el) return;
  const ws = calcWealthScore();

  const arcDeg = ws.score * 1.8; // 0-100 → 0-180° (half circle)
  const ring   = Math.round(ws.score * 2.51); // circumference fraction (r=40 → c≈251)

  el.innerHTML = `
    <div class="ws-layout">
      <div class="ws-gauge-wrap">
        <svg class="ws-gauge" viewBox="0 0 100 56" aria-hidden="true">
          <path class="ws-gauge-track" d="M9,50 A41,41 0 0,1 91,50" fill="none" stroke-width="10"/>
          <path class="ws-gauge-fill ws-gauge-fill--${ws.color}" d="M9,50 A41,41 0 0,1 91,50" fill="none" stroke-width="10"
            stroke-dasharray="${arcDeg * 1.28} 230" stroke-dashoffset="0"/>
        </svg>
        <div class="ws-score-num ws-score-num--${ws.color}">${ws.score}</div>
        <div class="ws-grade ws-grade--${ws.color}">${ws.grade}</div>
      </div>
      <div class="ws-comps">
        ${ws.comps.map(c => {
          const pct = Math.min(100, c.pts / c.max * 100);
          return `
          <div class="ws-comp">
            <div class="ws-comp-header">
              <span class="ws-comp-label">${c.label}</span>
              <span class="ws-comp-detail">${c.detail}</span>
              <span class="ws-comp-pts">${Math.round(c.pts)}/${c.max}</span>
            </div>
            <div class="ws-comp-bar"><div class="ws-comp-fill ws-comp-fill--${ws.color}" style="width:${pct}%"></div></div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${ws.advice.length ? `
    <div class="ws-advice">
      ${ws.advice.map(a => `<div class="ws-advice-item">↑ ${a}</div>`).join('')}
    </div>` : ''}`;
}

/* ═══════════════════════════════════════════════════════════════
   FINANCIAL TIMELINE — diario cronológico de eventos financieros
═══════════════════════════════════════════════════════════════ */

function _buildTimelineEvents() {
  const events = [];
  const today  = new Date().toISOString().slice(0, 10);

  // Portfolio purchases
  (APP.portfolio || []).forEach(a => {
    if (!a.buyDate) return;
    events.push({
      date: a.buyDate, type: 'investment', icon: '📈',
      title: `Compra: ${escapeHtml(a.name || a.ticker || 'Activo')}`,
      text:  `${a.quantity} uds. a ${formatCurrency(a.buyPrice)}`,
    });
  });

  // Wealth milestones crossed (detected from networthHistory)
  const MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
  const hist = APP.networthHistory || [];
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1].value;
    const curr = hist[i].value;
    MILESTONES.forEach(m => {
      if (prev < m && curr >= m) {
        events.push({
          date: hist[i].date + '-01', type: 'milestone', icon: '🏆',
          title: `Patrimonio supera ${formatCurrency(m)}`,
          text:  `Hito alcanzado en ${hist[i].date}`,
        });
      }
    });
  }

  // Liabilities / debts registered
  (APP.liabilities || []).forEach(l => {
    if (!l.startDate) return;
    events.push({
      date: l.startDate, type: 'debt', icon: '💳',
      title: `Deuda registrada: ${escapeHtml(l.name || l.type)}`,
      text:  `${formatCurrency(l.originalAmount)} — ${l.type}`,
    });
  });

  // Completed goals
  (APP.goals || []).forEach(g => {
    if (!g.targetAmount || (g.currentAmount || 0) < g.targetAmount) return;
    const date = g.deadline || today;
    events.push({
      date, type: 'goal', icon: g.emoji || '🎯',
      title: `Objetivo completado: ${escapeHtml(g.name)}`,
      text:  `${formatCurrency(g.targetAmount)} alcanzados`,
    });
  });

  // Manual annotations
  (APP.timelineAnnotations || []).forEach(a => {
    events.push({
      date: a.date, type: 'note', icon: a.emoji || '📝',
      title: escapeHtml(a.text), text: '', id: a.id, manual: true,
    });
  });

  return events.sort((a, b) => b.date.localeCompare(a.date));
}

function renderFinancialTimeline() {
  const el = document.getElementById('timeline-content');
  if (!el) return;
  const events = _buildTimelineEvents();
  const today  = new Date().toISOString().slice(0, 10);

  const listHtml = events.length
    ? events.map(e => `
      <div class="tl-item tl-item--${e.type}">
        <div class="tl-dot">${e.icon}</div>
        <div class="tl-body">
          <div class="tl-date">${formatDate(e.date)}</div>
          <div class="tl-title">${e.title}</div>
          ${e.text ? `<div class="tl-desc">${e.text}</div>` : ''}
          ${e.manual ? `<button class="tl-del" onclick="deleteTimelineAnnotation('${e.id}')" title="Eliminar">✕</button>` : ''}
        </div>
      </div>`).join('')
    : `<div class="tl-empty">Añade transacciones e inversiones para ver tu historial financiero aquí.</div>`;

  el.innerHTML = `
    <div class="tl-add-row">
      <input type="text" id="tl-note-text" class="text-input tl-note-input" placeholder="Añadir anotación..." maxlength="200" />
      <input type="date" id="tl-note-date" class="text-input" style="width:160px" value="${today}" />
      <input type="text" id="tl-note-emoji" class="text-input" style="width:58px;text-align:center" placeholder="📝" maxlength="4" />
      <button class="btn-primary" onclick="_addTimelineNote()">+ Añadir</button>
    </div>
    <div class="tl-list">${listHtml}</div>`;
}

function _addTimelineNote() {
  const textEl  = document.getElementById('tl-note-text');
  const dateEl  = document.getElementById('tl-note-date');
  const emojiEl = document.getElementById('tl-note-emoji');
  const text  = (textEl?.value || '').trim();
  const date  = dateEl?.value || '';
  const emoji = (emojiEl?.value || '').trim() || '📝';
  if (!text) { showToast('Escribe una anotación', 'error'); return; }
  if (!date) { showToast('Selecciona una fecha',  'error'); return; }
  if (!APP.timelineAnnotations) APP.timelineAnnotations = [];
  APP.timelineAnnotations.push({ id: generateId(), date, text: text.slice(0, 200), emoji: emoji.slice(0, 4) });
  saveData();
  if (textEl)  textEl.value  = '';
  if (emojiEl) emojiEl.value = '';
  renderFinancialTimeline();
  showToast('Anotación añadida ✓', 'success');
}

function deleteTimelineAnnotation(id) {
  APP.timelineAnnotations = (APP.timelineAnnotations || []).filter(a => a.id !== id);
  saveData();
  renderFinancialTimeline();
}

/* ═══════════════════════════════════════════════════════════════
   EMOJI PICKER — selector de icono para alertas
═══════════════════════════════════════════════════════════════ */
function _toggleEmojiPicker() {
  const dd = document.getElementById('notifEmojiDropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'grid';
  if (!isOpen) {
    // Cerrar al hacer click fuera
    setTimeout(() => {
      document.addEventListener('click', function _close(e) {
        if (!document.getElementById('notifEmojiPickerWrap')?.contains(e.target)) {
          dd.style.display = 'none';
          document.removeEventListener('click', _close);
        }
      });
    }, 10);
  }
}

function _selectAlertEmoji(emoji) {
  const trigger = document.getElementById('notifEmojiTrigger');
  const input   = document.getElementById('notifAlertIcon');
  if (trigger) trigger.textContent = emoji;
  if (input)   input.value = emoji;
  const dd = document.getElementById('notifEmojiDropdown');
  if (dd) dd.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════════
   GESTOR DE NOTIFICACIONES — central de alertas in-app
═══════════════════════════════════════════════════════════════ */

function openNotificationsManager() {
  openModal('Gestión de notificaciones', '', null, _renderNotifManager);
  setTimeout(_renderNotifManager, 50);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
}

function _renderNotifManager() {
  const body = document.getElementById('modalBody');
  if (!body) return;

  const active    = calcAlerts();
  const dismissed = Object.entries(APP.dismissedAlerts || {}).sort((a, b) => b[1] - a[1]);
  const custom    = APP.customAlerts || [];

  const activeHtml = active.length
    ? active.map(a => `
      <div class="dash-alert dash-alert-${a.type}" style="position:relative">
        <span class="dash-alert-icon">${a.icon}</span>
        <span class="dash-alert-text">${a.text}</span>
        <button class="dash-alert-dismiss"
          onclick="dismissAlert('${escapeHtml(a.key)}');_renderNotifManager()"
          title="Descartar">✕</button>
      </div>`).join('')
    : '<div class="notif-empty">No hay alertas activas — todo en orden ✓</div>';

  const customHtml = custom.length
    ? custom.map(ca => `
      <div class="notif-custom-row${ca.active === false ? ' notif-custom-inactive' : ''}">
        <div class="notif-custom-icon">${ca.icon || '🔔'}</div>
        <div class="notif-custom-info">
          <div class="notif-custom-name">${escapeHtml(ca.label || _alertTypeLabel(ca.type))}</div>
          <div class="notif-custom-params">${_fmtAlertParams(ca)}</div>
        </div>
        <label class="notif-toggle" title="${ca.active === false ? 'Activar' : 'Desactivar'}">
          <input type="checkbox" ${ca.active !== false ? 'checked' : ''}
            onchange="_toggleCustomAlert('${ca.id}', this.checked)">
          <span class="notif-toggle-track"></span>
        </label>
        <button class="dash-alert-dismiss" style="position:static"
          onclick="_deleteCustomAlert('${ca.id}')" title="Eliminar">✕</button>
      </div>`).join('')
    : '<div style="font-size:13px;color:var(--text-muted);padding:6px 0">Aún no hay alertas personalizadas</div>';

  const dismissedHtml = dismissed.length ? dismissed.map(([key, ts]) => `
    <div class="notif-dismissed-row">
      <span class="notif-dismissed-key">${escapeHtml(key)}</span>
      <span class="notif-dismissed-time">${_relativeTime(ts) || '—'}</span>
      <button class="btn-ghost-sm" onclick="_undismissAlert('${escapeHtml(key)}')">Restaurar</button>
    </div>`).join('') : '';

  const portfolioOpts = (APP.portfolio || []).map(a =>
    `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}${a.ticker ? ' (' + escapeHtml(a.ticker) + ')' : ''}</option>`
  ).join('');
  const cats = [...new Set((APP.transactions || []).map(t => t.category).filter(Boolean))].sort();
  const catOpts = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const goalOpts = (APP.goals || []).map(g =>
    `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`
  ).join('');

  body.innerHTML = `
    <div class="notif-section-label">Alertas activas (${active.length})</div>
    <div style="margin-bottom:16px">${activeHtml}</div>

    <div class="notif-section-label" style="margin-top:20px">Mis alertas (${custom.length})</div>
    <div class="notif-custom-list">${customHtml}</div>

    <div class="notif-add-wrap">
      <button class="btn-secondary notif-add-btn" id="notifAddToggle" onclick="_toggleAddAlertForm()">+ Nueva alerta</button>
      <div class="notif-add-form" id="notifAddForm">
        <div class="notif-form-row">
          <label class="notif-form-label">Tipo de alerta</label>
          <select class="text-input" id="notifTypeSelect" onchange="_renderAlertTypeFields()">
            <option value="">— Selecciona —</option>
            <option value="price_above">📈 Activo de cartera sube por encima de</option>
            <option value="price_below">📉 Activo de cartera baja por debajo de</option>
            <option value="networth_above">🏦 Patrimonio neto supera</option>
            <option value="networth_below">⚠️ Patrimonio neto baja de</option>
            <option value="expense_month">💸 Gasto mensual supera</option>
            <option value="income_below">💰 Ingresos mensuales bajan de</option>
            <option value="savings_rate_below">📊 Tasa de ahorro mensual baja del</option>
            <option value="category_spend">🏷️ Gasto en categoría supera</option>
            <option value="goal_pct">🎯 Objetivo alcanza el</option>
          </select>
        </div>
        <div id="notifTypeFields"
          data-portfolio="${escapeHtml(portfolioOpts)}"
          data-cats="${escapeHtml(catOpts)}"
          data-goals="${escapeHtml(goalOpts)}"></div>
        <div class="notif-form-row">
          <label class="notif-form-label">Nombre <span style="color:var(--text-muted)">(opcional)</span></label>
          <input type="text" class="text-input" id="notifAlertLabel" placeholder="Ej: Mi alerta MSFT" style="flex:1" />
        </div>
        <div class="notif-form-row">
          <label class="notif-form-label">Icono emoji</label>
          <div class="emoji-picker-wrap" id="notifEmojiPickerWrap">
            <button type="button" class="emoji-picker-trigger" id="notifEmojiTrigger"
              onclick="_toggleEmojiPicker()" title="Seleccionar emoji">🔔</button>
            <input type="hidden" id="notifAlertIcon" value="" />
            <div class="emoji-picker-dropdown" id="notifEmojiDropdown" style="display:none">
              ${[
                '🔔','🚨','⚠️','📉','📈','💸','🎯','🔴','🟡','🟢',
                '💰','💳','🏦','📊','⚡','🔥','❄️','🌊','💎','👑',
                '🎪','🛒','🏠','✈️','🎓','🏋️','🌙','☀️','⭐','🦋',
              ].map(e => `<button type="button" class="emoji-picker-item" onclick="_selectAlertEmoji('${e}')">${e}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="notif-form-actions">
          <button class="btn-primary" onclick="_addCustomAlert()">Guardar alerta</button>
        </div>
      </div>
    </div>

    ${dismissed.length ? `
    <div class="notif-section-label" style="margin-top:24px">
      Descartadas (${dismissed.length})
      <button class="btn-ghost-sm" style="font-size:11px;margin-left:8px"
        onclick="_clearDismissedAlerts()">Limpiar todo</button>
    </div>
    <div class="notif-dismissed-list">${dismissedHtml}</div>` : ''}

    <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border-subtle)">
      <div class="notif-section-label" style="margin-bottom:14px">Configuración automática</div>
      <div class="notif-config-row">
        <span class="notif-config-label">Límite concentración cartera</span>
        <input type="number" class="text-input" style="width:70px;text-align:right"
          id="notif-conc-input"
          value="${(APP.smartAlertsConfig?.concentrationPct) ?? 30}" min="10" max="90" step="5" />
        <span style="font-size:13px;color:var(--text-muted)">%</span>
        <button class="btn-secondary" style="font-size:12px" onclick="_saveNotifConfig()">Guardar</button>
      </div>
    </div>`;
}

function _alertTypeLabel(type) {
  const MAP = {
    price_above: 'Precio por encima', price_below: 'Precio por debajo',
    networth_above: 'Patrimonio supera', networth_below: 'Patrimonio baja de',
    expense_month: 'Gasto mensual supera', income_below: 'Ingresos bajan de',
    savings_rate_below: 'Tasa de ahorro baja del', category_spend: 'Categoría supera',
    goal_pct: 'Objetivo alcanza',
  };
  return MAP[type] || type;
}

function _fmtAlertParams(ca) {
  switch (ca.type) {
    case 'price_above': { const a = (APP.portfolio || []).find(p => p.id === ca.params.assetId); return `${a ? escapeHtml(a.name) : 'Activo'} ≥ ${formatCurrency(ca.params.threshold)}`; }
    case 'price_below': { const a = (APP.portfolio || []).find(p => p.id === ca.params.assetId); return `${a ? escapeHtml(a.name) : 'Activo'} ≤ ${formatCurrency(ca.params.threshold)}`; }
    case 'networth_above':     return `Patrimonio ≥ ${formatCurrency(ca.params.threshold)}`;
    case 'networth_below':     return `Patrimonio ≤ ${formatCurrency(ca.params.threshold)}`;
    case 'expense_month':      return `Gasto mes ≥ ${formatCurrency(ca.params.threshold)}`;
    case 'income_below':       return `Ingresos mes ≤ ${formatCurrency(ca.params.threshold)}`;
    case 'savings_rate_below': return `Tasa ahorro < ${ca.params.threshold}%`;
    case 'category_spend':     return `${escapeHtml(ca.params.category || '')} ≥ ${formatCurrency(ca.params.threshold)}`;
    case 'goal_pct': { const g = (APP.goals || []).find(g => g.id === ca.params.goalId); return `${g ? escapeHtml(g.name) : 'Objetivo'} ≥ ${ca.params.threshold}%`; }
    default: return '';
  }
}

function _toggleAddAlertForm() {
  const form = document.getElementById('notifAddForm');
  const btn  = document.getElementById('notifAddToggle');
  if (!form) return;
  const isOpen = form.classList.contains('open');
  form.classList.toggle('open', !isOpen);
  if (btn) btn.textContent = isOpen ? '+ Nueva alerta' : '− Cancelar';
}

function _renderAlertTypeFields() {
  const type      = document.getElementById('notifTypeSelect')?.value;
  const container = document.getElementById('notifTypeFields');
  if (!container) return;
  if (!type) { container.innerHTML = ''; return; }

  const portfolioOpts = container.dataset.portfolio || '';
  const catOpts       = container.dataset.cats     || '';
  const goalOpts      = container.dataset.goals    || '';

  let html = '';
  if (type === 'price_above' || type === 'price_below') {
    html = `<div class="notif-form-row"><label class="notif-form-label">Activo</label><select class="text-input" id="notif-assetId" style="flex:1">${portfolioOpts || '<option value="">Sin activos en cartera</option>'}</select></div>
            <div class="notif-form-row"><label class="notif-form-label">Precio umbral (€)</label><input type="number" class="text-input" id="notif-threshold" placeholder="0.00" min="0" step="0.01" style="width:130px"/></div>`;
  } else if (type === 'category_spend') {
    html = `<div class="notif-form-row"><label class="notif-form-label">Categoría</label><select class="text-input" id="notif-category" style="flex:1">${catOpts || '<option value="">Sin categorías</option>'}</select></div>
            <div class="notif-form-row"><label class="notif-form-label">Importe umbral (€)</label><input type="number" class="text-input" id="notif-threshold" placeholder="0.00" min="0" step="0.01" style="width:130px"/></div>`;
  } else if (type === 'goal_pct') {
    html = `<div class="notif-form-row"><label class="notif-form-label">Objetivo</label><select class="text-input" id="notif-goalId" style="flex:1">${goalOpts || '<option value="">Sin objetivos</option>'}</select></div>
            <div class="notif-form-row"><label class="notif-form-label">Porcentaje alcanzado (%)</label><input type="number" class="text-input" id="notif-threshold" placeholder="50" min="1" max="100" step="1" style="width:100px"/></div>`;
  } else if (type === 'savings_rate_below') {
    html = `<div class="notif-form-row"><label class="notif-form-label">Tasa mínima (%)</label><input type="number" class="text-input" id="notif-threshold" placeholder="20" min="0" max="100" step="1" style="width:100px"/></div>`;
  } else {
    html = `<div class="notif-form-row"><label class="notif-form-label">Importe umbral (€)</label><input type="number" class="text-input" id="notif-threshold" placeholder="0.00" min="0" step="0.01" style="width:130px"/></div>`;
  }
  container.innerHTML = html;
}

function _addCustomAlert() {
  const type = document.getElementById('notifTypeSelect')?.value;
  if (!type) { showToast('Selecciona un tipo de alerta', 'error'); return; }

  const rawThresh = document.getElementById('notif-threshold')?.value;
  const threshold = parseFloat(rawThresh);
  if (isNaN(threshold) || threshold < 0) { showToast('Introduce un umbral válido', 'error'); return; }

  const label = document.getElementById('notifAlertLabel')?.value.trim() || '';
  const icon  = document.getElementById('notifAlertIcon')?.value.trim()
             || document.getElementById('notifEmojiTrigger')?.textContent.trim()
             || '';
  const params = { threshold };

  if (type === 'price_above' || type === 'price_below') {
    const assetId = document.getElementById('notif-assetId')?.value;
    if (!assetId) { showToast('Selecciona un activo', 'error'); return; }
    params.assetId = assetId;
  }
  if (type === 'category_spend') {
    const cat = document.getElementById('notif-category')?.value;
    if (!cat) { showToast('Selecciona una categoría', 'error'); return; }
    params.category = cat;
  }
  if (type === 'goal_pct') {
    const goalId = document.getElementById('notif-goalId')?.value;
    if (!goalId) { showToast('Selecciona un objetivo', 'error'); return; }
    params.goalId = goalId;
  }

  const severityMap = {
    price_above: 'info', price_below: 'warning', networth_above: 'info', networth_below: 'danger',
    expense_month: 'warning', income_below: 'warning', savings_rate_below: 'warning',
    category_spend: 'warning', goal_pct: 'info',
  };

  if (!APP.customAlerts) APP.customAlerts = [];
  APP.customAlerts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type, params, label,
    icon: icon || undefined,
    severity: severityMap[type] || 'info',
    active: true,
    createdAt: Date.now(),
  });
  saveData();
  showToast('Alerta creada ✓', 'success');
  _renderNotifManager();
}

function _deleteCustomAlert(id) {
  if (!APP.customAlerts) return;
  APP.customAlerts = APP.customAlerts.filter(a => a.id !== id);
  saveData();
  renderDashboardAlerts();
  _renderNotifManager();
}

function _toggleCustomAlert(id, active) {
  const ca = (APP.customAlerts || []).find(a => a.id === id);
  if (!ca) return;
  ca.active = active;
  saveData();
  renderDashboardAlerts();
}

function _clearDismissedAlerts() {
  APP.dismissedAlerts = {};
  saveData();
  renderDashboardAlerts();
  _renderNotifManager();
}

function _undismissAlert(key) {
  if (APP.dismissedAlerts) delete APP.dismissedAlerts[key];
  saveData();
  renderDashboardAlerts();
  _renderNotifManager();
}

function _saveNotifConfig() {
  const val = parseInt(document.getElementById('notif-conc-input')?.value || '30', 10);
  if (!APP.smartAlertsConfig) APP.smartAlertsConfig = {};
  APP.smartAlertsConfig.concentrationPct = Math.max(10, Math.min(90, val || 30));
  saveData();
  showToast('Configuración de alertas guardada ✓', 'success');
  _renderNotifManager();
}

