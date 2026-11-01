/* ═══════════════════════════════════════════════════════════════
   FINOVA — transactions.js
   Sección 7: Ingresos & Gastos — render, charts, CRUD, quick-add, categorías
═══════════════════════════════════════════════════════════════ */

/* _txPhotoState machine:
 *   null                          — sin foto
 *   { type:'existing', id }       — foto guardada en IDB, sin cambios
 *   { type:'new', url, oldId }    — nueva foto local pendiente de guardar (oldId puede ser null)
 *   { type:'removed', oldId }     — foto existente marcada para borrar
 */
let _txPhotoState = null;

// Ajusta la cuenta de efectivo vinculada a transacciones (ver
// APP.transactionCashAccountId), si el usuario ha elegido una — un ingreso
// suma, un gasto resta. sign=1 al añadir una transacción, sign=-1 al
// quitarla (eliminar, o deshacer una edición/alta). No hace nada si no hay
// ninguna cuenta vinculada: el patrimonio neto sigue siendo un snapshot
// manual por defecto, igual que antes de esta función existir.
function _applyTxCashImpact(tx, sign) {
  if (!APP.transactionCashAccountId || !tx) return;
  const acct = (APP.cashAccounts || []).find(a => a.id === APP.transactionCashAccountId);
  if (!acct) return;
  const delta = tx.type === 'income' ? tx.amount : -tx.amount;
  acct.amount = (parseFloat(acct.amount) || 0) + delta * sign;
}

function _txUpdateMonthLabel() {
  const monthEl = document.getElementById('tx-filter-month');
  const labelEl = document.getElementById('tx-month-label');
  if (!labelEl) return;
  const val = monthEl?.value || '';
  if (val) {
    const [y, m] = val.split('-').map(Number);
    labelEl.textContent = new Date(y, m - 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  } else {
    labelEl.textContent = 'Todo el período';
  }
  const now  = new Date();
  const cur  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const d    = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  document.querySelectorAll('.tx-period-presets .btn-ghost-sm').forEach(btn => {
    const a = btn.dataset.action;
    btn.classList.toggle('preset-active',
      (a === 'tx-period-current' && val === cur)  ||
      (a === 'tx-period-prev'    && val === prev)  ||
      (a === 'tx-period-all'     && val === ''));
  });
}

// Resumen compacto de recurrentes pendientes/próximas arriba de la tabla de
// transacciones — la gestión completa (crear, editar, pausar, eliminar)
// sigue viviendo en su propia sección (ver recurring.js → renderRecurring).
// Oculto si no hay ninguna plantilla recurrente creada; si las hay pero
// ninguna vence pronto, muestra un estado vacío en vez de desaparecer, para
// que "arriba de transacciones" sea un sitio fiable donde mirar.
function _renderTxRecurringWidget() {
  const container = document.getElementById('tx-widget-recurring');
  if (!container) return;
  const all = APP.recurring || [];
  if (!all.length) { container.innerHTML = ''; return; }

  const today      = getTodayStr();
  const horizon     = new Date();
  horizon.setDate(horizon.getDate() + 14);
  const horizonStr  = horizon.toISOString().slice(0, 10);

  const relevant = all
    .filter(r => r.active && r.nextDate && r.nextDate <= horizonStr)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const dueCount = relevant.filter(r => r.nextDate <= today).length;

  const MAX_SHOWN = 4;
  const shown = relevant.slice(0, MAX_SHOWN);
  const extra = relevant.length - shown.length;

  const rowsHtml = shown.length ? shown.map(r => {
    const overdue = r.nextDate <= today;
    const diff = Math.ceil((new Date(r.nextDate + 'T00:00:00') - new Date()) / 86400000);
    const whenLabel = overdue ? (diff === 0 ? 'hoy' : `hace ${-diff}d`) : (diff === 1 ? 'mañana' : `en ${diff}d`);
    return `
      <div class="tx-rec-row${overdue ? ' tx-rec-row--due' : ''}">
        <span class="tx-rec-desc">${escapeHtml(r.description)}</span>
        <span class="tx-rec-when">${whenLabel}</span>
        <span class="tx-rec-amount pvt ${r.type === 'income' ? 'positive' : 'negative'}">${formatCurrency(r.amount)}</span>
        <button type="button" class="btn-secondary btn-sm" onclick="applyRecurring('${r.id}')" title="Registrar como transacción hoy">Registrar</button>
      </div>`;
  }).join('') : `<div class="tx-rec-empty">Sin recurrentes pendientes en los próximos 14 días</div>`;

  container.innerHTML = `
    <div class="card tx-rec-widget">
      <div class="tx-rec-head">
        <span class="tx-rec-title">⟳ Recurrentes${dueCount ? ` <span class="rec-due-badge">${dueCount} pendiente${dueCount > 1 ? 's' : ''}</span>` : ''}</span>
        <button type="button" class="btn-ghost-sm" onclick="navigateTo('recurring')">Ver todas →</button>
      </div>
      ${rowsHtml}
      ${extra > 0 ? `<div class="tx-rec-more">+${extra} más en Recurrentes</div>` : ''}
    </div>`;
}

function renderTransactions() {
  _renderTxRecurringWidget();
  // Restore persisted month filter
  const monthEl = document.getElementById('tx-filter-month');
  if (monthEl && APP.txFilterMonth) {
    monthEl.value = APP.txFilterMonth;
    monthEl.classList.toggle('filter-active', !!APP.txFilterMonth);
  }
  _txUpdateMonthLabel();
  // Wire month input change (native picker or keyboard)
  if (monthEl && !monthEl._labelWired) {
    monthEl._labelWired = true;
    monthEl.addEventListener('change', () => { APP.txFilterMonth = monthEl.value; _txUpdateMonthLabel(); updateTransactionSummary(); renderTransactionTable(); });
  }
  // Wire search input (once)
  const searchEl = document.getElementById('tx-filter-search');
  if (searchEl && !searchEl._txSearchWired) {
    searchEl._txSearchWired = true;
    searchEl.addEventListener('input', debounce(() => { _txUpdateClearBtn(); updateTransactionSummary(); renderTransactionTable(); }, 200));
  }
  // Wire sortable column headers (once)
  document.querySelectorAll('.sortable-th:not([data-sort-wired])').forEach(th => {
    th.dataset.sortWired = '1';
    th.style.cursor = 'pointer';
    // tabindex + keydown: un <th> no es nativamente operable por teclado.
    // Sin esto, ordenar la tabla de transacciones era imposible sin ratón.
    th.tabIndex = 0;
    const doSort = () => {
      if (_txSortCol === th.dataset.sort) { _txSortAsc = !_txSortAsc; }
      else { _txSortCol = th.dataset.sort; _txSortAsc = th.dataset.sort === 'amount' ? false : true; }
      renderTransactionTable();
    };
    th.addEventListener('click', doSort);
    th.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      doSort();
    });
  });
  _delegate('section-transactions', {
    'edit-tx':    id => editTransaction(id),
    'delete-tx':  id => deleteTransaction(id),
    'fav-tx':     id => toggleTxFavorite(id),
    'view-photo': id => viewTransactionPhoto(id),
    'view-trip':  id => openTripDetail(id),
  });
  _txWireRowOpen();
  updateTransactionSummary();   // renderBudgets() is called inside here
  renderTransactionTable();
  populateCategoryFilter();
  document.querySelectorAll('#section-transactions .chart-wrapper').forEach(el => el.classList.add('loading'));
  ric(() => {
    renderTransactionCharts();
    document.querySelectorAll('#section-transactions .chart-wrapper.loading').forEach(el => el.classList.remove('loading'));
  });
}

/*
 * Pulsar una fila abre su ficha de historial.
 *
 * Va con delegación en el <tbody> y no con un listener por fila a propósito:
 * la tabla usa scroll virtual (_renderVirtualRow reescribe el innerHTML a
 * cada scroll), así que cualquier listener puesto en una fila se perdería en
 * el primer desplazamiento.
 */
function _txWireRowOpen() {
  const tbody = document.getElementById('transactions-tbody');
  if (!tbody || tbody._rowOpenWired) return;
  tbody._rowOpenWired = true;

  const abrir = (target) => {
    // Un clic en los botones de la fila (favorito, editar, borrar) o en una
    // insignia navegable no debe abrir la ficha: ya hacen otra cosa.
    if (target.closest('[data-action]')) return;
    // Y tampoco si el usuario está seleccionando texto.
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 2) return;
    const tr = target.closest('tr[data-id]');
    if (!tr || !tr.dataset.id) return;
    if (typeof _withTxHistory === 'function') _withTxHistory(tr.dataset.id);
  };

  tbody.addEventListener('click', e => abrir(e.target));

  // Las filas ya tienen tabindex="0", así que son alcanzables con Tab pero
  // hasta ahora Enter no hacía nada: sin esto, la ficha quedaría fuera del
  // alcance de alguien que navegue solo con teclado (WCAG 2.1.1).
  tbody.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest && e.target.closest('tr[data-id]');
    if (!tr || e.target !== tr) return;   // solo con el foco en la fila
    e.preventDefault();
    abrir(tr);
  });
}

function updateTransactionSummary() {
  const monthFilter = document.getElementById('tx-filter-month')?.value;
  const month       = monthFilter || getCurrentMonth();

  // Mismo filtro que antes, pero reutilizando calcs.js: una única fuente de
  // verdad con el dashboard (y ya blindadas contra importes guardados como
  // string, que aquí se concatenaban: 0 + "750" + "120" → "0750120").
  const income  = calcMonthlyIncome(month);
  const expense = calcMonthlyExpense(month);
  const balance = income - expense;

  const [y, m] = month.split('-');
  const monthLabel = new Date(+y, +m - 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  _animNum(document.getElementById('tx-total-income'),  income,  formatCurrency, 450);
  _animNum(document.getElementById('tx-total-expense'), expense, formatCurrency, 450);
  const inSubEl = document.getElementById('tx-income-sub');
  if (inSubEl) inSubEl.textContent = monthLabel;
  const exSubEl = document.getElementById('tx-expense-sub');
  if (exSubEl) exSubEl.textContent = monthLabel;

  const balEl = document.getElementById('tx-balance');
  if (balEl) {
    balEl.className = 'kpi-value ' + colorClass(balance);
    _animNum(balEl, balance, formatCurrency, 500);
  }
  const balSubEl = document.getElementById('tx-balance-sub');
  if (balSubEl) balSubEl.textContent = monthLabel;

  renderBudgets();
}

function renderTransactionCharts() {
  renderChartIncomeExpense();
  renderChartExpenseByCategory();
}

function renderChartIncomeExpense() {
  const ctx = document.getElementById('chart-income-expense');
  if (!ctx || typeof Chart === 'undefined') return;

  const { gridColor, textColor, fontFamily } = getChartDefaults();

  const months = getLast6Months();
  const incomeData  = months.map(m => calcMonthlyIncome(m));
  const expenseData = months.map(m => calcMonthlyExpense(m));
  const labels = months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(y, mo - 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
  });

  const ieChart = Charts.get('income-expense');
  if (ieChart) {
    ieChart.data.labels = labels;
    ieChart.data.datasets[0].data = incomeData;
    ieChart.data.datasets[1].data = expenseData;
    ieChart.options.plugins.legend.labels.color = textColor;
    ieChart.options.scales.x.ticks.color = textColor;
    ieChart.options.scales.y.grid.color = gridColor;
    ieChart.options.scales.y.ticks.color = textColor;
    ieChart.update('none');
    return;
  }

  Charts.set('income-expense', new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: incomeData,  backgroundColor: 'rgba(61, 220, 132, 0.7)', borderRadius: 6 },
        { label: 'Gastos',   data: expenseData, backgroundColor: 'rgba(255, 92, 92, 0.7)',  borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, font: { family: fontFamily, size: 12 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { family: fontFamily, size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: fontFamily, size: 11 }, callback: v => '€' + Intl.NumberFormat('es-ES', { notation: 'compact' }).format(v) } }
      }
    }
  }));
}

/* ═══════════════════════════════════════════════════════════════
   GASTOS POR CATEGORÍA — agregación compartida por el gráfico de
   Transacciones y el widget del Dashboard, y por el modal de detalle
   que ambos abren al pulsar una porción. Una sola función de filtrado
   de fecha para los tres sitios garantiza que el total del detalle
   SIEMPRE coincide con lo que muestra el gráfico — nunca se recalcula
   dos veces con criterios distintos.
═══════════════════════════════════════════════════════════════ */

// 'all' = todo el historial (comportamiento original, sigue siendo el
// valor por defecto para no cambiar los cálculos existentes). El resto
// reutiliza el mismo vocabulario que ya usa el selector de "Evolución
// del patrimonio" del dashboard (1M/3M/6M/1A) para que resulte familiar.
const EXP_CAT_SCALES = ['1m', '3m', '6m', '1y', 'all'];
const EXP_CAT_SCALE_SHORT = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1A', all: 'Todo' };

function expCatScaleLabel(scale) {
  if (scale === '1m') return new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  if (scale === '3m') return 'Últimos 3 meses';
  if (scale === '6m') return 'Últimos 6 meses';
  if (scale === '1y') return 'Último año';
  return 'Todo el historial';
}

// Primer mes (YYYY-MM) incluido por esa escala, o null si no hay límite inferior.
function _expCatScaleCutoff(scale) {
  if (scale === 'all') return null;
  const monthsBack = { '1m': 0, '3m': 2, '6m': 5, '1y': 11 }[scale] ?? 0;
  // El mes de referencia sale de getCurrentMonth(), no de un new Date() propio.
  // Antes había DOS fuentes de "qué mes es" a dos líneas de distancia: esta
  // usaba new Date() y _expCatInScale, justo debajo, usaba getCurrentMonth().
  // En producción dan lo mismo (getCurrentMonth lee la fecha real), pero la
  // divergencia hacía que la escala no se pudiera fijar en una prueba: el
  // reparto por categorías de octubre se quedó en blanco al cambiar el mes.
  const [y, m] = getCurrentMonth().split('-').map(Number);
  const d = new Date(y, (m - 1) - monthsBack, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _expCatInScale(dateStr, scale) {
  const cutoff = _expCatScaleCutoff(scale);
  if (!cutoff) return true;
  return (dateStr || getCurrentMonth()).slice(0, 7) >= cutoff;
}

// Mismo criterio que calcMonthlyExpense/renderDashExpenseCats: solo gastos
// (type==='expense'); Finova no modela transferencias ni reembolsos como
// líneas separadas, así que no hay nada adicional que excluir aquí.
function expensesByCategory(scale) {
  const byCategory = {};
  APP.transactions.forEach(t => {
    if (t.type !== 'expense' || !_expCatInScale(t.date, scale)) return;
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  return byCategory;
}

let _expCatScale = 'all';

function renderChartExpenseByCategory() {
  const ctx = document.getElementById('chart-expense-category');
  if (!ctx || typeof Chart === 'undefined') return;

  _initExpCatScaleButtons();

  const { textColor, fontFamily } = getChartDefaults();

  const byCategory = expensesByCategory(_expCatScale);
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const labels  = entries.map(e => e[0]);
  const data    = entries.map(e => e[1]);
  const colors  = CHART_COLORS.slice(0, data.length);

  const emptyEl = document.getElementById('chart-expense-category-empty');
  if (data.length === 0) {
    Charts.destroy('expense-category', 'chart-expense-category');
    ctx.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  ctx.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  const onSliceClick = (evt, elements, chart) => {
    const idx = elements[0]?.index;
    if (idx === undefined) return;
    openCategoryExpenseDetail(chart.data.labels[idx], _expCatScale);
  };

  const ecChart = Charts.get('expense-category');
  if (ecChart) {
    ecChart.data.labels = labels;
    ecChart.data.datasets[0].data = data;
    ecChart.data.datasets[0].backgroundColor = colors;
    ecChart.options.plugins.legend.labels.color = textColor;
    ecChart.options.onClick = onSliceClick;
    ecChart.options.plugins.legend.onClick = (e, item, legend) => onSliceClick(e, [{ index: item.index }], legend.chart);
    ecChart.update('none');
    return;
  }

  Charts.set('expense-category', new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: 'transparent', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      onClick: onSliceClick,
      onHover: (e, elements) => { e.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      plugins: {
        legend: {
          position: 'right',
          labels: { color: textColor, font: { family: fontFamily, size: 11 }, boxWidth: 10, padding: 10 },
          onClick: (e, item, legend) => onSliceClick(e, [{ index: item.index }], legend.chart),
        },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)}` } }
      }
    }
  }));
}

function _initExpCatScaleButtons() {
  const wrap = document.getElementById('expcat-scale-btns');
  if (!wrap || wrap.dataset.wired) return;
  wrap.dataset.wired = '1';
  wrap.querySelectorAll('.catchart-scale-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.catchart-scale-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _expCatScale = btn.dataset.scale;
      // El modal de detalle (si lo hay) solo puede abrirse DESPUÉS de pulsar una
      // porción, y su overlay bloquea los clics sobre estos botones mientras está
      // abierto — no existe un camino real para cambiar el periodo con el detalle
      // abierto, así que no hace falta refrescarlo desde aquí.
      renderChartExpenseByCategory();
    });
  });
}

/* ─── Modal de detalle: gastos de una categoría en un periodo ───── */
let _expDetailState = null; // { category, scale }

function openCategoryExpenseDetail(category, scale) {
  _expDetailState = { category, scale };
  openModal(`Gastos de ${category}`, _categoryExpenseDetailHTML(), null, null);
  document.getElementById('modal')?.classList.add('modal-wide');
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
  _wireCategoryExpenseDetail();
  // Mejor esfuerzo: si se abre "Editar" desde esta misma vista, openAddTransaction()
  // sustituye este _modalOnClose por el suyo propio antes de que se dispare — no pasa
  // nada, _expDetailState solo se lee mientras este modal está realmente abierto.
  _modalOnClose = () => { _expDetailState = null; };
}

function _categoryExpenseTxs() {
  if (!_expDetailState) return [];
  const { category, scale } = _expDetailState;
  return APP.transactions
    .filter(t => t.type === 'expense' && t.category === category && _expCatInScale(t.date, scale))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function _categoryExpenseDetailHTML() {
  if (!_expDetailState) return '';
  const { category, scale } = _expDetailState;
  const txs   = _categoryExpenseTxs();
  const total = txs.reduce((s, t) => s + t.amount, 0);

  if (txs.length === 0) {
    return `
      <div class="cat-detail-period">${escapeHtml(expCatScaleLabel(scale))}</div>
      ${emptyState('📂', 'Sin gastos', `No hay gastos de ${escapeHtml(category)} en el periodo seleccionado.`, '', '')}
    `;
  }

  return `
    <div class="cat-detail-summary">
      <div class="cat-detail-period">${escapeHtml(expCatScaleLabel(scale))}</div>
      <div class="cat-detail-stats">
        <div class="cat-detail-stat">
          <span class="cat-detail-stat-label">Total gastado</span>
          <span class="cat-detail-stat-val negative">${formatCurrency(total)}</span>
        </div>
        <div class="cat-detail-stat">
          <span class="cat-detail-stat-label">Operaciones</span>
          <span class="cat-detail-stat-val">${txs.length}</span>
        </div>
      </div>
    </div>
    <div class="cat-detail-table-wrap">
      <table class="cat-detail-table">
        <thead><tr><th>Fecha</th><th>Concepto</th><th class="text-right">Importe</th><th></th></tr></thead>
        <tbody>${txs.map(_catDetailRowHTML).join('')}</tbody>
      </table>
    </div>`;
}

function _catDetailRowHTML(t) {
  const extras = [
    t.merchant ? `<div class="cat-detail-sub">${escapeHtml(t.merchant)}</div>` : '',
    t.note     ? `<div class="cat-detail-sub">📝 ${escapeHtml(t.note)}</div>` : '',
  ].join('');
  return `
    <tr data-id="${escapeHtml(t.id)}">
      <td>${formatDate(t.date)}</td>
      <td><strong>${escapeHtml(t.description)}</strong>${extras}</td>
      <td class="text-right negative">${formatCurrency(t.amount)}</td>
      <td>
        <div class="action-buttons">
          <button class="btn-edit btn-icon" data-action="cd-edit" aria-label="Editar transacción">✎</button>
          <button class="btn-danger btn-icon" data-action="cd-delete" aria-label="Eliminar transacción">✕</button>
        </div>
      </td>
    </tr>`;
}

function _refreshCategoryExpenseDetail() {
  const body = document.getElementById('modalBody');
  if (!body || !_expDetailState) return;
  body.innerHTML = _categoryExpenseDetailHTML();
  _wireCategoryExpenseDetail();
}

function _wireCategoryExpenseDetail() {
  _delegate('modalBody', {
    'cd-edit':   id => editTransaction(id),
    'cd-delete': id => _categoryExpenseDetailDelete(id),
  });
}

function _categoryExpenseDetailDelete(id) {
  const tx = APP.transactions.find(t => t.id === id);
  if (!tx) return;
  const row = document.querySelector(`#modalBody tr[data-id="${id}"]`);
  animateRowRemoval(row, () => {
    APP.transactions = APP.transactions.filter(t => t.id !== id);
    _applyTxCashImpact(tx, -1);
    updateNetworthHistory();
    saveData();
    markDashboardDirty();
    if (APP.activeSection === SECTIONS.TRANSACTIONS) renderTransactions();
    renderDashboard();
    _refreshCategoryExpenseDetail();
    softDelete(`"${tx.description}" eliminado`, () => {
      APP.transactions.push(tx);
      _applyTxCashImpact(tx, 1);
      saveData();
      if (APP.activeSection === SECTIONS.TRANSACTIONS) renderTransactions();
      renderDashboard();
      _refreshCategoryExpenseDetail();
    }, () => {
      // Confirmado (sin deshacer) — igual que deleteTransaction(), limpia la foto de IDB
      if (tx.photoId) deletePhoto(tx.photoId);
    });
  });
}

function getLast6Months() {
  const months = [];
  const now    = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/* ─── Virtual scroll ─────────────────────────────────────────── */

const VROW_H_EST = 44; // fallback estimate before actual heights are measured
const VBUFFER    = 5;

let _vtxRows      = [];
let _rowHeights   = new Map(); // rowIndex → measured px height
let _rowOffsets   = [];        // prefix sums [0 .. n], length = rows.length + 1
let _offsetsDirty = true;

function _buildOffsets() {
  const n = _vtxRows.length;
  _rowOffsets = new Array(n + 1);
  _rowOffsets[0] = 0;
  for (let i = 0; i < n; i++) {
    _rowOffsets[i + 1] = _rowOffsets[i] + (_rowHeights.get(i) ?? VROW_H_EST);
  }
  _offsetsDirty = false;
}

function _virtualScrollFindRow(offset) {
  let lo = 0, hi = _vtxRows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (_rowOffsets[mid] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

function _vtxMeasure(tbody, fromIdx) {
  let changed = false;
  tbody.querySelectorAll('tr:not(.vspacer)').forEach((tr, i) => {
    const h = tr.offsetHeight;
    if (h > 0 && _rowHeights.get(fromIdx + i) !== h) {
      _rowHeights.set(fromIdx + i, h);
      changed = true;
    }
  });
  if (changed) _offsetsDirty = true;
}

function _buildVirtualRowHTML(t) {
  const safeNote = t.note ? escapeHtml(t.note).replace(/\n/g, '&#10;') : '';
  const indicators = [
    t.note ? `<span class="tx-note-tip tx-indicator" data-tip="${safeNote}" aria-label="Nota: ${safeNote}">📝</span>` : '',
    (t.photoId || t.photo) ? '<button class="tx-indicator tx-photo-view" data-action="view-photo" title="Ver foto del ticket" aria-label="Ver foto">📷</button>' : '',
  ].join('');
  const recurringBadge = t.recurringId   ? '<span class="tx-recurring-badge">⟳ Recurrente</span>' : '';
  const bankBadge      = t.bankImported  ? '<span class="tx-bank-badge">🏦 Banco</span>' : '';
  const trip            = t.tripId ? (APP.trips || []).find(tp => tp.id === t.tripId) : null;
  const tripBadge        = trip ? `<span class="trip-badge" data-action="view-trip" data-id="${escapeHtml(trip.id)}">${escapeHtml(trip.emoji || '✈')} ${escapeHtml(trip.name)}</span>` : '';
  const sign = t.type === 'income' ? '+' : '-';
  const favLabel = t.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos';
  const rowCls = ['tx-row-' + t.type, t.favorite ? 'tx-row-fav' : ''].filter(Boolean).join(' ');
  return `<tr data-id="${t.id}" class="${rowCls}" tabindex="0">
    <td>${formatDate(t.date)}</td>
    <td><span class="tx-desc-wrap"><strong>${escapeHtml(t.description)}</strong>${recurringBadge}${bankBadge}${tripBadge}${indicators ? `<span class="tx-indicators">${indicators}</span>` : ''}</span></td>
    <td>${escapeHtml(t.category)}</td>
    <td><span class="badge badge-${t.type}">${t.type === 'income' ? 'Ingreso' : 'Gasto'}</span></td>
    <td class="text-right pvt ${t.type === 'income' ? 'positive' : 'negative'}">${sign}${formatCurrency(t.amount)}</td>
    <td><div class="action-buttons">
      <button class="btn-fav btn-icon${t.favorite ? ' btn-fav--on' : ''}" data-action="fav-tx" aria-label="${favLabel}">♥</button>
      <button class="btn-edit btn-icon" data-action="edit-tx" aria-label="Editar transacción">✎</button>
      <button class="btn-danger btn-icon" data-action="delete-tx" aria-label="Eliminar transacción">✕</button>
    </div></td>
  </tr>`;
}

function _renderVirtualRow() {
  const wrap  = document.getElementById('tx-virtual-scroll');
  const tbody = document.getElementById('transactions-tbody');
  if (!wrap || !tbody || _vtxRows.length === 0) return;

  if (_offsetsDirty) _buildOffsets();

  const scrollTop = wrap.scrollTop;
  const total     = _vtxRows.length;
  const visStart  = _virtualScrollFindRow(scrollTop);
  const visEnd    = _virtualScrollFindRow(scrollTop + wrap.clientHeight);
  const from      = Math.max(0, visStart - VBUFFER);
  const to        = Math.min(total - 1, visEnd + VBUFFER);

  const topH = _rowOffsets[from];
  const botH = _rowOffsets[total] - _rowOffsets[to + 1];
  const rows = _vtxRows.slice(from, to + 1).map(_buildVirtualRowHTML).join('');

  tbody.innerHTML =
    `<tr class="vspacer" style="height:${topH}px"><td colspan="7"></td></tr>` +
    rows +
    `<tr class="vspacer" style="height:${botH}px"><td colspan="7"></td></tr>`;

  _vtxMeasure(tbody, from);
  if (_offsetsDirty) {
    _buildOffsets();
    requestAnimationFrame(_renderVirtualRow); // spacers were stale — re-render with measured heights
  }
}

function _txApplyFilters() {
  const typeFilter     = document.getElementById('tx-filter-type')?.value     || 'all';
  const categoryFilter = document.getElementById('tx-filter-category')?.value || 'all';
  const monthFilter    = document.getElementById('tx-filter-month')?.value    || '';
  const searchQuery    = (document.getElementById('tx-filter-search')?.value || '').trim().toLowerCase();
  let txs = [...APP.transactions];
  if (typeFilter !== 'all')     txs = txs.filter(t => t.type === typeFilter);
  if (categoryFilter !== 'all') txs = txs.filter(t => t.category === categoryFilter);
  if (monthFilter)              txs = txs.filter(t => (t.date || getCurrentMonth()).startsWith(monthFilter));
  if (_txShowFavoritesOnly)     txs = txs.filter(t => t.favorite);
  // (t.description || '') — una fila importada o corrupta sin descripción
  // lanzaba TypeError y dejaba la tabla entera en blanco al teclear en el buscador.
  if (searchQuery)              txs = txs.filter(t => (t.description || '').toLowerCase().includes(searchQuery) || (t.note || '').toLowerCase().includes(searchQuery) || (t.category || '').toLowerCase().includes(searchQuery));
  const col = _txSortCol;
  const dir = _txSortAsc ? 1 : -1;
  txs.sort((a, b) => {
    const av = col === 'amount' ? a.amount : (a[col] || '');
    const bv = col === 'amount' ? b.amount : (b[col] || '');
    const primary = typeof av === 'number' ? (av - bv) * dir : av.localeCompare(bv) * dir;
    if (primary !== 0) return primary;
    return APP.transactions.indexOf(b) - APP.transactions.indexOf(a);
  });
  // Update sort arrow indicators
  document.querySelectorAll('.sortable-th').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    const active = th.dataset.sort === col;
    if (arrow) arrow.textContent = active ? (_txSortAsc ? ' ▲' : ' ▼') : '';
    th.classList.toggle('sort-active', active);
    // aria-sort: mismo motivo que en la tabla de cartera — el indicador ▲/▼
    // es visual, aria-sort lo hace audible para quien usa lector de pantalla.
    th.setAttribute('aria-sort', active ? (_txSortAsc ? 'ascending' : 'descending') : 'none');
  });
  return txs;
}

function _tableKeydown(e) {
  if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) return;
  const tbody = e.currentTarget;
  const rows  = [...tbody.querySelectorAll('tr[data-id]')];
  const cur   = e.target.closest('tr[data-id]');
  if (!cur) return;
  e.preventDefault();
  const idx = rows.indexOf(cur);
  if (e.key === 'ArrowDown') { rows[idx + 1]?.focus(); }
  else if (e.key === 'ArrowUp') { rows[idx - 1]?.focus(); }
  else { cur.querySelector('[data-action^="edit"]')?.click(); }
}

function _txTableKeydown(e) { _tableKeydown(e); }

function renderTransactionTable() {
  const tbody = document.getElementById('transactions-tbody');
  if (!tbody) return;

  const doRender = () => {
    const txs = _txApplyFilters();
    const countEl = document.getElementById('tx-result-count');
    if (countEl) {
      const total = APP.transactions.length;
      countEl.textContent = txs.length < total ? `${txs.length} de ${total}` : `${total}`;
      countEl.style.display = '';
    }
    if (txs.length === 0) {
      _vtxRows = [];
      const hasFilters = APP.transactions.length > 0;
      const msg   = hasFilters ? 'Sin resultados para los filtros activos' : 'Sin transacciones';
      const sub   = hasFilters ? 'Prueba ajustando el periodo, tipo o búsqueda, o limpia los filtros.' : 'Registra ingresos y gastos para ver tu balance mensual.';
      const btnTxt = hasFilters ? '× Limpiar filtros' : '+ Añadir transacción';
      const btnAct = hasFilters ? 'clearTxFilters()' : 'openAddTransaction()';
      tbody.innerHTML = emptyRow(7, '⇄', msg, sub, btnTxt, btnAct);
      return;
    }
    // Skip full DOM rebuild if the filtered set is identical to what's already rendered
    if (txs.length === _vtxRows.length && txs.every((t, i) => t.id === _vtxRows[i].id)) return;
    _vtxRows = txs;
    _rowHeights = new Map();
    _offsetsDirty = true;
    const wrap = document.getElementById('tx-virtual-scroll');
    if (wrap && !wrap._vtxBound) {
      wrap._vtxBound = true;
      wrap.addEventListener('scroll', _renderVirtualRow, { passive: true });
    }
    if (!tbody._kbNav) {
      tbody._kbNav = true;
      tbody.addEventListener('keydown', _txTableKeydown);
    }
    if (wrap) wrap.scrollTop = 0;
    _renderVirtualRow();
  };

  if (APP.transactions.length > 200) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">Cargando…</td></tr>`;
    ric(doRender);
  } else {
    doRender();
  }
}

function populateCategoryFilter() {
  const sel = document.getElementById('tx-filter-category');
  if (!sel) return;
  // Reconstruir el <select> borraba la selección activa: al añadir o editar
  // una transacción (cualquier cosa que llame a renderTransactions) el filtro
  // de categoría se perdía en silencio — la tabla seguía mostrando las filas
  // filtradas pero el desplegable decía "Todas las categorías", y exportar
  // sacaba TODAS las transacciones creyendo el usuario que el filtro seguía
  // puesto. Se preserva el valor y solo cae a "all" si esa categoría ya no
  // existe en ninguna transacción.
  const prev = sel.value;
  const uniqueUsed = [...new Set(APP.transactions.map(t => t.category).filter(Boolean))];
  sel.innerHTML = '<option value="all">Todas las categorías</option>' +
    uniqueUsed.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (prev && prev !== 'all' && uniqueUsed.includes(prev)) sel.value = prev;
  sel.classList.toggle('filter-active', sel.value !== 'all');
}

/* ─── CRUD Transacciones ─────────────────────────────────────── */

function _txModalFill(tx) {
  const frag = document.getElementById('tpl-add-transaction').content.cloneNode(true);
  frag.querySelector('#f-tx-type').value  = tx.type || 'expense';
  frag.querySelector('#f-tx-date').value  = tx.date || getTodayStr();
  frag.querySelector('#f-tx-desc').value  = tx.description || '';
  frag.querySelector('#f-tx-amount').value = tx.amount || '';
  frag.querySelector('#f-tx-note').value  = tx.note || '';
  frag.querySelector('#f-tx-fav').checked = !!tx.favorite;
  const cats = tx.type === 'income' ? APP.categories.income : APP.categories.expense;
  const catSel = frag.querySelector('#f-tx-category');
  // Una transacción nueva no tiene categoría todavía — si no se marca ninguna
  // opción como selected, el <select> cae por defecto en la PRIMERA de la
  // lista (Vivienda) sin que eso signifique nada. Se parte siempre de
  // UNCLASSIFIED_CATEGORY y autoSuggestCategory() la sobrescribe si encuentra
  // una coincidencia real.
  const initialCategory = tx.category || UNCLASSIFIED_CATEGORY;
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === initialCategory) o.selected = true;
    catSel.appendChild(o);
  });
  frag.querySelector('#f-tx-photo').addEventListener('change', function() { onTxPhotoChange(this); });

  const tripSel = frag.querySelector('#f-tx-trip');
  if (tripSel) {
    (APP.trips || []).forEach(trip => {
      const o = document.createElement('option');
      o.value = trip.id; o.textContent = trip.name;
      if (trip.id === tx.tripId) o.selected = true;
      tripSel.appendChild(o);
    });
    const tripWrap = frag.querySelector('#f-tx-trip-wrap');
    if (tripWrap) tripWrap.style.display = (tx.type || 'expense') === 'income' ? 'none' : '';
  }

  // Build autocomplete datalist from unique historical descriptions
  const uniqueDescs = [...new Set(APP.transactions.map(t => t.description))].sort();
  let dl = document.getElementById('tx-desc-datalist');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'tx-desc-datalist'; document.body.appendChild(dl); }
  dl.innerHTML = uniqueDescs.map(d => `<option value="${escapeHtml(d)}">`).join('');
  return frag;
}

/**
 * Alta de una transacción: ÚNICA ruta de creación de la app.
 * La usan el formulario normal (_txSave) y el escáner de tickets, para que no
 * haya dos caminos que puedan divergir en los efectos secundarios (impacto en
 * la cuenta de efectivo vinculada y aviso de progreso de objetivos).
 * No guarda ni renderiza: de eso se encarga quien llama, que sabe si está en
 * mitad de un lote o de una sola alta.
 */
function _txCreate({ type, date, description, category, amount, note = '', favorite = false, photoId, tripId, receipt }) {
  // Hito del embudo: la primera transacción es el momento en que alguien
  // empieza a usar la app de verdad. Se mide ANTES de añadirla (longitud 0).
  if (typeof track === 'function' && (APP.transactions || []).length === 0) {
    track('primer_transaccion');
  }
  const entry = { id: generateId(), type, date, description, category, amount, note, favorite };
  if (photoId) entry.photoId = photoId;
  if (tripId)  entry.tripId  = tripId;
  // Datos extraídos de un ticket escaneado (productos, IVA, nº de ticket…).
  // Campo opcional: una transacción escrita a mano simplemente no lo lleva.
  if (receipt) entry.receipt = receipt;
  APP.transactions.push(entry);
  _applyTxCashImpact(entry, 1);
  if (typeof _notifyGoalProgress === 'function') _notifyGoalProgress(entry);
  return entry;
}

async function _txSave(prefill, isEdit) {
  const type        = document.getElementById('f-tx-type').value;
  const date        = document.getElementById('f-tx-date').value;
  const description = document.getElementById('f-tx-desc').value.trim();
  const category    = document.getElementById('f-tx-category').value;
  const amount      = parseFloat(document.getElementById('f-tx-amount').value);
  const note        = document.getElementById('f-tx-note')?.value.trim() || '';
  const favorite    = document.getElementById('f-tx-fav')?.checked || false;
  // Vínculo a un viaje: solo para gastos, campo opcional ("Sin viaje" = '')
  const tripId      = type === 'expense' ? (document.getElementById('f-tx-trip')?.value || '') : '';

  if (!description) return showToast('La descripción es obligatoria', 'error');
  if (!date)        return showToast('La fecha es obligatoria', 'error');
  if (!amount || amount <= 0) return showToast('El importe debe ser positivo', 'error');

  let photoId;
  try { photoId = await _commitPhotoState(); }
  catch { showToast('Error guardando la foto. La transacción se guardará sin ella.', 'error'); photoId = null; }

  let _oldTxSnapshot = null;
  let _updatedTx      = null;
  if (isEdit) {
    const idx = APP.transactions.findIndex(t => t.id === prefill.id);
    if (idx >= 0) {
      _oldTxSnapshot = { ...APP.transactions[idx] };
      const updated = { ...prefill, type, date, description, category, amount, note, favorite };
      if (photoId !== undefined) updated.photoId = photoId || undefined;
      if (tripId) updated.tripId = tripId; else delete updated.tripId;
      delete updated.photo;
      APP.transactions[idx] = updated;
      _updatedTx = updated;
      _applyTxCashImpact(_oldTxSnapshot, -1);
      _applyTxCashImpact(updated, 1);
    }
  } else {
    _txCreate({ type, date, description, category, amount, note, favorite, photoId, tripId });
  }

  _patWrite(txPatternKey(description), category);
  APP.txPhotoDraftId = null;
  _modalOnClose = null;
  saveData(); closeModal(); renderTransactions();
  if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();

  if (isEdit && _oldTxSnapshot) {
    softEdit(`"${description}" editado`, () => {
      const i = APP.transactions.findIndex(t => t.id === prefill.id);
      if (i >= 0) {
        APP.transactions[i] = _oldTxSnapshot;
        _applyTxCashImpact(_updatedTx, -1);
        _applyTxCashImpact(_oldTxSnapshot, 1);
        saveData(); renderTransactions();
        if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
      }
    });

    // Si cambió la categoría, ofrecer aplicarla a transacciones similares pasadas
    if (_oldTxSnapshot.category !== category) {
      const key     = txPatternKey(description);
      const similar = APP.transactions.filter(t =>
        t.id !== prefill.id &&
        txPatternKey(t.description) === key &&
        t.category !== category
      );
      if (similar.length > 0) {
        const n = similar.length;
        showToast(
          `Aplicar "${category}" a ${n} transacción${n > 1 ? 'es' : ''} de "${description}"`,
          'info',
          {
            duration: 9000,
            action: {
              label: 'Aplicar a todas',
              callback: () => {
                similar.forEach(t => {
                  const idx = APP.transactions.findIndex(x => x.id === t.id);
                  if (idx >= 0) APP.transactions[idx].category = category;
                });
                saveData(); renderTransactions();
                if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
                showToast(`${n} transacción${n > 1 ? 'es' : ''} actualizadas ✓`, 'success');
              },
            },
          }
        );
      }
    }
  } else if (!isEdit) {
    showToast('Transacción añadida ✓', 'success');
  }
}

/**
 * Muestra lo que el escáner leyó del ticket: productos, IVA y datos del
 * documento. Es solo lectura — los campos editables (importe, fecha,
 * categoría) son los del propio formulario, que ya existen: así no hay dos
 * sitios donde cambiar lo mismo.
 */
function _txRenderReceiptDetail(r) {
  const anchor = document.getElementById('tx-photo-preview');
  if (!anchor || anchor.parentElement.querySelector('.tx-receipt-detail')) return;

  const meta = [
    r.receiptNumber ? `Nº ${escapeHtml(r.receiptNumber)}` : null,
    r.time ? `${escapeHtml(r.time)}` : null,
    r.paymentMethod ? `Pago: ${escapeHtml(r.paymentMethod)}` : null,
    r.taxId ? `CIF ${escapeHtml(r.taxId)}` : null,
  ].filter(Boolean).join(' · ');

  const tax = [
    r.taxBase != null ? `Base ${formatCurrency(r.taxBase)}` : null,
    r.taxAmount != null ? `IVA${r.taxRate ? ` ${r.taxRate}%` : ''} ${formatCurrency(r.taxAmount)}` : null,
    r.discount ? `Dto. ${formatCurrency(r.discount)}` : null,
  ].filter(Boolean).join(' · ');

  const items = Array.isArray(r.items) && r.items.length
    ? `<table class="data-table" style="margin-top:8px">
         <thead><tr><th>Producto</th><th class="text-right">Uds</th><th class="text-right">Importe</th></tr></thead>
         <tbody>${r.items.map(it => `<tr>
           <td style="font-size:11.5px">${escapeHtml(it.name)}</td>
           <td class="text-right" style="font-size:11.5px">${it.qty ?? '—'}</td>
           <td class="text-right" style="font-size:11.5px">${it.total != null ? formatCurrency(it.total) : '—'}</td>
         </tr>`).join('')}</tbody>
       </table>` : '<div style="font-size:12px;color:var(--text-muted);margin-top:6px">No se detectaron productos individuales.</div>';

  const box = document.createElement('details');
  box.className = 'settings-collapsible tx-receipt-detail';
  box.style.marginTop = '10px';
  box.innerHTML = `
    <summary class="settings-collapsible-summary">
      <div class="settings-section-label" style="margin:0">🧾 Datos del ticket escaneado</div>
      <svg class="icon icon-sm settings-collapsible-chevron" aria-hidden="true"><use href="#icon-chevron-right"/></svg>
    </summary>
    <div style="margin-top:8px">
      ${meta ? `<div style="font-size:12px;color:var(--text-muted)">${meta}</div>` : ''}
      ${tax ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${tax}</div>` : ''}
      ${items}
    </div>`;
  anchor.parentElement.appendChild(box);
}

function _txModalSetupListeners(tx) {
  if (!tx.id && APP.txPhotoDraftId) {
    loadPhoto(APP.txPhotoDraftId).then(dataUrl => {
      if (!dataUrl) { APP.txPhotoDraftId = null; return; }
      const preview = document.getElementById('tx-photo-preview');
      if (preview && !preview.querySelector('img')) {
        _txPhotoState = { type: 'existing', id: APP.txPhotoDraftId };
        const img = document.createElement('img'); img.src = dataUrl; img.alt = 'borrador';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'tx-photo-remove'; btn.textContent = '✕'; btn.onclick = onTxPhotoRemove;
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px';
        note.textContent = 'Foto recuperada del borrador anterior';
        preview.append(img, btn, note);
      }
    });
  }

  const descInput = document.getElementById('f-tx-desc');
  if (!descInput) return;
  let debounceTimer = null;
  descInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const desc = descInput.value.trim();
    if (desc.length < 2) { hideCatBadge(); return; }
    debounceTimer = setTimeout(() => autoSuggestCategory(desc), 450);
  });
  document.getElementById('f-tx-type')?.addEventListener('change', () => {
    updateTxCategoryOptions();
    _txUpdateTripFieldVisibility();
    const desc = descInput.value.trim();
    if (desc.length >= 2) autoSuggestCategory(desc);
  });
  if (tx.description) setTimeout(() => autoSuggestCategory(tx.description), 80);

  // Desglose del ticket escaneado (productos, IVA, nº de ticket). Solo
  // aparece si la transacción vino del escáner; una escrita a mano no lo
  // lleva. Se inyecta junto a la foto, que ya se carga más abajo.
  if (tx.receipt) _txRenderReceiptDetail(tx.receipt);

  if (tx.photoId) {
    loadPhoto(tx.photoId).then(dataUrl => {
      if (!dataUrl) return;
      const preview = document.getElementById('tx-photo-preview');
      if (preview) {
        const img = document.createElement('img');
        img.src = dataUrl; img.alt = 'ticket';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'tx-photo-remove';
        btn.textContent = '✕'; btn.onclick = onTxPhotoRemove;
        preview.append(img, btn);
      }
    });
  }

  _setupFormValidation([
    { id: 'f-tx-desc',   test: () => !!document.getElementById('f-tx-desc')?.value.trim(),          msg: 'La descripción es obligatoria' },
    { id: 'f-tx-date',   test: () => !!document.getElementById('f-tx-date')?.value,                 msg: 'La fecha es obligatoria' },
    { id: 'f-tx-amount', test: () => parseFloat(document.getElementById('f-tx-amount')?.value) > 0, msg: 'Introduce un importe positivo' },
  ]);
}

function openAddTransaction(prefill = null) {
  const isEdit = !!prefill;
  const tx     = prefill || { date: getTodayStr(), type: 'expense' };
  _txPhotoState = tx.photoId ? { type: 'existing', id: tx.photoId } : null;
  _modalOnClose = () => {
    if (_txPhotoState?.type === 'new') {
      const draftId = generateId();
      savePhoto(draftId, _txPhotoState.url).then(() => {
        APP.txPhotoDraftId = draftId;
        saveData();
      }).catch(() => {});
    }
    _txPhotoState = null;
  };
  openModal(
    isEdit ? 'Editar transacción' : 'Nueva transacción',
    _txModalFill(tx),
    () => _txSave(prefill, isEdit),
    () => _txModalSetupListeners(tx),
  );
}

function updateTxCategoryOptions() {
  const type = document.getElementById('f-tx-type')?.value;
  const sel  = document.getElementById('f-tx-category');
  if (!sel || !type) return;
  const cats = type === 'income' ? APP.categories.income : APP.categories.expense;
  // Las categorías de Gasto e Ingreso son listas distintas — al cambiar de
  // tipo, la categoría marcada antes casi nunca existe en la nueva lista.
  // Se parte de UNCLASSIFIED_CATEGORY (igual que _txModalFill) en vez de
  // dejar que el navegador seleccione la primera opción por accidente;
  // autoSuggestCategory() la sustituye justo después si hay una coincidencia.
  sel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"${c === UNCLASSIFIED_CATEGORY ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

// El vínculo a un viaje solo tiene sentido en gastos (un ingreso, p.ej. un
// reembolso, no "pertenece" al presupuesto de viaje de la misma forma).
function _txUpdateTripFieldVisibility() {
  const type = document.getElementById('f-tx-type')?.value;
  const wrap = document.getElementById('f-tx-trip-wrap');
  if (wrap) wrap.style.display = type === 'income' ? 'none' : '';
}

function editTransaction(id) {
  const tx = APP.transactions.find(t => t.id === id);
  if (tx) openAddTransaction(tx);
}

function deleteTransaction(id) {
  const tx = APP.transactions.find(t => t.id === id);
  if (!tx) return;
  const row = document.querySelector(`tr[data-id="${id}"]`);

  animateRowRemoval(row, () => {
    APP.transactions = APP.transactions.filter(t => t.id !== id);
    _applyTxCashImpact(tx, -1);
    updateNetworthHistory();
    renderTransactions();
    markDashboardDirty();
    renderDashboard();
    softDelete(`"${tx.description}" eliminado`, () => {
      APP.transactions.push(tx);
      _applyTxCashImpact(tx, 1);
      saveData();
      renderTransactions();
      renderDashboard();
    }, () => {
      // Committed (no undo) — delete photo from IDB
      if (tx.photoId) deletePhoto(tx.photoId);
    });
  });
}

/* ─── Photo / Note / Favorite helpers ───────────────────────── */

function onTxPhotoChange(input) {
  const file = input.files[0];
  if (!file) return;
  _resizeImageForStorage(file, dataUrl => {
    const oldId = _txPhotoState?.type === 'existing' ? _txPhotoState.id : null;
    _txPhotoState = { type: 'new', url: dataUrl, oldId };
    const preview = document.getElementById('tx-photo-preview');
    if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="ticket" /><button type="button" class="tx-photo-remove" onclick="onTxPhotoRemove()">✕</button>`;
  });
}

function onTxPhotoRemove() {
  const oldId = _txPhotoState?.type === 'existing' ? _txPhotoState.id
              : _txPhotoState?.type === 'new'      ? _txPhotoState.oldId
              : null;
  _txPhotoState = oldId ? { type: 'removed', oldId } : null;
  const preview = document.getElementById('tx-photo-preview');
  if (preview) preview.innerHTML = '';
  const input = document.getElementById('f-tx-photo');
  if (input) input.value = '';
}

async function _commitPhotoState() {
  if (!_txPhotoState) return null;
  if (_txPhotoState.type === 'existing') return _txPhotoState.id;
  if (_txPhotoState.type === 'removed') {
    await deletePhoto(_txPhotoState.oldId);
    return null;
  }
  if (_txPhotoState.type === 'new') {
    if (_txPhotoState.oldId) await deletePhoto(_txPhotoState.oldId);
    const newId = generateId();
    await savePhoto(newId, _txPhotoState.url);
    return newId;
  }
  return null;
}

function _resizeImageForStorage(file, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 640;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function toggleTxFavorite(id) {
  const tx = APP.transactions.find(t => t.id === id);
  if (!tx) return;
  tx.favorite = !tx.favorite;
  saveData();
  renderTransactionTable();
  showToast(tx.favorite ? 'Añadido a favoritos ✓' : 'Eliminado de favoritos', 'success');
}

async function viewTransactionPhoto(id) {
  const tx = APP.transactions.find(t => t.id === id);
  if (!tx) return;
  const dataUrl = tx.photoId ? await loadPhoto(tx.photoId) : tx.photo || null;
  if (!dataUrl) return showToast('No se pudo cargar la foto', 'error');
  openModal('📷 Foto del ticket', `
    <div style="text-align:center">
      <img src="${dataUrl}" alt="ticket" style="max-width:100%;max-height:60vh;border-radius:var(--r-sm);object-fit:contain" />
      <div style="font-size:12px;color:var(--text-muted);margin-top:8px">${escapeHtml(tx.description)} · ${formatDate(tx.date)}</div>
    </div>`, null);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
}

/* ─── Presupuestos por categoría ─────────────────────────────── */

function renderBudgets() {
  const container = document.getElementById('tx-budgets-list');
  if (!container) return;

  const m = document.getElementById('tx-filter-month')?.value || getCurrentMonth();

  if (!APP.budgets || APP.budgets.length === 0) {
    container.innerHTML = `<div class="budget-empty">
      Sin presupuestos · <button class="btn-link" onclick="openManageBudgets()">Añadir presupuesto</button>
    </div>`;
    return;
  }

  const budgetData = APP.budgets.map(b => {
    const spent = APP.transactions.filter(t => t.type === 'expense' && t.category === b.category && (t.date || getCurrentMonth()).startsWith(m)).reduce((s, t) => s + _num(t.amount), 0);
    // pct va limitado a 100 para que la barra no desborde su carril, pero
    // pctReal es el de verdad: con 215 € gastados de 200 el aviso decía
    // "100 % utilizado" en vez de "108 %", que es el dato que importa.
    const pctReal = b.monthlyAmount > 0 ? (spent / b.monthlyAmount) * 100 : 0;
    const pct   = Math.min(100, pctReal);
    const over  = spent > b.monthlyAmount;
    const left  = b.monthlyAmount - spent;
    return { b, spent, pct, pctReal, over, left };
  });

  container.innerHTML = budgetData.map(({ b, spent, pct, over, left }) => `
      <div class="budget-row${over ? ' budget-over' : ''}">
        <div class="budget-header">
          <span class="budget-cat">${escapeHtml(b.category)}</span>
          <span class="budget-amounts">
            <span class="${over ? 'negative' : ''}">${formatCurrency(spent)}</span>
            <span class="budget-sep">/ ${formatCurrency(b.monthlyAmount)}</span>
          </span>
        </div>
        <div class="budget-bar-bg">
          <div class="budget-bar-fill${over ? ' budget-bar-over' : ''}" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="budget-status">
          ${over
            ? `<span class="negative">+${formatCurrency(Math.abs(left))} sobre el límite</span>`
            : `<span style="color:var(--text-muted)">${formatCurrency(left)} restante (${(100 - pct).toFixed(0)}%)</span>`
          }
        </div>
      </div>`).join('');

  // Budget 80% alerts — one toast per category per month
  APP.dismissedAlerts = APP.dismissedAlerts || {};
  let alertsFired = false;
  budgetData.forEach(({ b, spent, pctReal, over }) => {
    if (b.monthlyAmount <= 0 || pctReal < 80) return;
    const alertKey = `budget80-${m}-${b.category}`;
    if (!APP.dismissedAlerts[alertKey]) {
      APP.dismissedAlerts[alertKey] = true;
      alertsFired = true;
      showToast(
        over
          ? `⚠ Presupuesto "${escapeHtml(b.category)}" SUPERADO: ${pctReal.toFixed(0)}% (${formatCurrency(b.monthlyAmount)} de límite)`
          : `⚠ Presupuesto "${escapeHtml(b.category)}": ${pctReal.toFixed(0)}% utilizado`,
        'error'
      );
    }
    // Notificación del sistema al cruzar el 90% — clave propia (budget90,
    // no budget80) para que no dependa de si el toast de arriba ya se
    // mostró o se descartó; se dispara en el momento real de guardar la
    // transacción que lo cruza, no en una recarga posterior.
    const pushKey = `budget90-${m}-${b.category}`;
    if (pctReal >= 90 && !APP.dismissedAlerts[pushKey]) {
      APP.dismissedAlerts[pushKey] = true;
      alertsFired = true;
      if (typeof sendLocalNotification === 'function') {
        sendLocalNotification(
          `Presupuesto de ${b.category} casi agotado`,
          `Has gastado ${formatCurrency(spent)} de ${formatCurrency(b.monthlyAmount)} (${pctReal.toFixed(0)}%)`
        );
      }
    }
  });
  if (alertsFired) setTimeout(saveData, 0);
}

function openManageBudgets() {
  const expCats  = APP.categories.expense || [];
  const existing = APP.budgets || [];
  const rowTpl   = document.getElementById('tpl-budget-row');
  const grid     = document.createElement('div');
  grid.className = 'budget-edit-grid';

  expCats.forEach(cat => {
    const row   = rowTpl.content.cloneNode(true);
    const label = row.querySelector('.budget-edit-label');
    const inp   = row.querySelector('.budget-edit-input');
    const b     = existing.find(x => x.category === cat);
    label.textContent  = cat;
    inp.dataset.cat    = cat;
    inp.value          = b ? b.monthlyAmount : '';
    grid.appendChild(row);
  });

  const wrap = document.createElement('div');
  wrap.innerHTML = '<p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">Deja vacío para sin límite. Los gastos se comparan al mes activo.</p>';
  wrap.appendChild(grid);

  openModal('Presupuestos mensuales', wrap, () => {
    const inputs = document.getElementById('modalBody')?.querySelectorAll('.budget-edit-input') || [];
    APP.budgets = [];
    inputs.forEach(inp => {
      const cat = inp.dataset.cat;
      const amt = parseFloat(inp.value);
      if (cat && amt > 0) APP.budgets.push({ id: generateId(), category: cat, monthlyAmount: amt });
    });
    saveData(); closeModal(); renderBudgets();
    showToast('Presupuestos guardados ✓', 'success');
  });
}

/* ─── Quick-add ──────────────────────────────────────────────── */

function parseQuickAdd(raw) {
  const text = raw.trim();
  if (!text) return null;

  const re = /€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*€|(\d+(?:[.,]\d{1,2})?)/;
  const m = re.exec(text);
  if (!m) return null;

  const numStr = (m[1] || m[2] || m[3] || '').replace(',', '.');
  const amount = parseFloat(numStr);
  if (!amount || amount <= 0) return null;

  const description = (text.slice(0, m.index) + text.slice(m.index + m[0].length))
    .replace(/\s+/g, ' ').trim() || 'Transacción';

  // _stripAccents (script.js) normaliza a NFD antes de quitar las marcas: sin
  // eso, "Nómina" precompuesta no coincidía con la keyword 'nomina' y la
  // nómina del usuario se guardaba como GASTO.
  const normDesc = _stripAccents(description);
  const incomeKws = ['nomina', 'salario', 'sueldo', 'ingreso', 'dividendo', 'dividendos', 'bonus', 'reembolso', 'devolucion', 'venta'];
  const type = incomeKws.some(kw => normDesc.includes(kw)) ? 'income' : 'expense';

  const learned = APP.categoryPatterns && _patCat(APP.categoryPatterns[txPatternKey(description)]);
  const local   = matchLocalKeywords(description, type);
  // Si no hay patrón aprendido ni coincidencia de palabra clave, no inventar
  // una categoría al azar (antes caía en la primera de la lista, "Vivienda",
  // para cualquier cosa sin clasificar: "comida", "fiesta", "copas"...).
  const category = learned || local || UNCLASSIFIED_CATEGORY;
  const source   = learned ? 'aprendido' : (local ? 'sugerido' : null);

  return { description, amount, type, category, source, date: getTodayStr() };
}

const _QA_IDS = {
  tx: { input: 'quick-add-input', type: 'quick-add-type-badge', cat: 'quick-add-cat-badge', trip: 'quick-add-trip-badge', hint: 'quick-add-hint', btn: 'quick-add-btn' },
};
const _qaOverrides = {};
let _qaPickCallback = null; // callback pendiente tras elegir categoría en el flujo de "pregunta al usuario"

let _txShowFavoritesOnly = false;
let _txSortCol = 'date';
let _txSortAsc = false;
function toggleTxFavorites() {
  _txShowFavoritesOnly = !_txShowFavoritesOnly;
  const btn = document.getElementById('btn-tx-favs');
  if (btn) btn.classList.toggle('filter-active', _txShowFavoritesOnly);
  renderTransactionTable();
}

function _qaUpdateUI(ids) {
  const input    = document.getElementById(ids.input);
  const badge    = document.getElementById(ids.cat);
  const tbadge   = document.getElementById(ids.type);
  const tripBadge = ids.trip ? document.getElementById(ids.trip) : null;
  const hint     = document.getElementById(ids.hint);
  const btn      = document.getElementById(ids.btn);
  const parsed   = input ? parseQuickAdd(input.value) : null;
  if (!parsed) {
    if (badge)     badge.style.display     = 'none';
    if (tbadge)    tbadge.style.display    = 'none';
    if (tripBadge) tripBadge.style.display = 'none';
    if (hint)      hint.style.display      = 'none';
    if (btn)       btn.disabled = true;
    return;
  }
  const ov = _qaOverrides[ids.input] || {};
  const effectiveType = ov.type     || parsed.type;
  const effectiveCat  = ov.category || parsed.category;
  if (badge) {
    const isUnclassified = effectiveCat === UNCLASSIFIED_CATEGORY;
    badge.textContent = (isUnclassified ? '⚠ ' : '') + effectiveCat + (parsed.source && !ov.category ? ' · ' + parsed.source : '');
    badge.classList.toggle('cat-ai-badge--unclassified', isUnclassified);
    badge.style.display = 'inline-block';
    badge.style.cursor = 'pointer';
    badge.title = isUnclassified ? 'Sin clasificar — clic para elegir categoría' : 'Clic para cambiar categoría';
    badge.onclick = () => _qaPickCategory(ids);
  }
  if (tbadge) {
    tbadge.textContent = effectiveType === 'income' ? 'Ingreso' : 'Gasto';
    tbadge.className = 'badge badge-' + effectiveType;
    tbadge.style.display = 'inline-block';
    tbadge.style.cursor = 'pointer';
    tbadge.title = 'Clic para cambiar tipo';
    tbadge.onclick = () => { _qaOverrides[ids.input] = { ...ov, type: effectiveType === 'income' ? 'expense' : 'income' }; _qaUpdateUI(ids); };
  }
  // El viaje solo tiene sentido en gastos, y solo si existe al menos un
  // viaje creado — igual que en el formulario completo de transacciones.
  if (tripBadge) {
    const showTrip = effectiveType === 'expense' && (APP.trips || []).length > 0;
    if (showTrip) {
      const trip = ov.tripId ? (APP.trips || []).find(t => t.id === ov.tripId) : null;
      tripBadge.textContent = trip ? `${trip.emoji || '✈'} ${trip.name}` : '+ Viaje';
      tripBadge.className = trip ? 'trip-badge' : 'trip-badge trip-badge--empty';
      tripBadge.style.display = 'inline-block';
      tripBadge.style.cursor = 'pointer';
      tripBadge.title = 'Clic para asignar a un viaje';
      tripBadge.onclick = () => _qaPickTrip(ids);
    } else {
      tripBadge.style.display = 'none';
    }
  }
  if (hint) { hint.textContent = parsed.description + ' · ' + formatCurrency(parsed.amount); hint.style.display = 'block'; }
  if (btn) btn.disabled = false;
}

// onPicked opcional: si se pasa, el flujo "pregunta al usuario" lo llama en
// cuanto se elige una categoría, para completar el guardado que quedó en
// espera (ver _qaSubmit). Sin onPicked, es el cambio manual de siempre.
function _qaPickCategory(ids, onPicked = null) {
  _qaPickCallback = onPicked;
  const allCats = [...APP.categories.income, ...APP.categories.expense].filter(c => c !== UNCLASSIFIED_CATEGORY);
  const intro = onPicked
    ? '<p class="modal-help-text">No he podido reconocer la categoría automáticamente. Elegirla ahora es recomendable, pero puedes dejarla para más tarde.</p>'
    : '';
  // "Más tarde" solo tiene sentido en el flujo que pregunta antes de guardar
  // (onPicked) — es lo que lo hace opcional en vez de obligatorio.
  const laterBtn = onPicked
    ? `<button type="button" class="btn-ghost-sm" style="margin-top:10px" onclick="_qaSkipCategory('${escapeHtml(ids.input)}')">Guardar sin clasificar — lo haré más tarde</button>`
    : '';
  openModal(onPicked ? '¿Qué categoría es?' : 'Cambiar categoría', `
    ${intro}
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">
      ${allCats.map(c => `<button class="cat-pick-btn" onclick="_qaSetCategory('${escapeHtml(ids.input)}','${escapeHtml(c)}')">${escapeHtml(c)}</button>`).join('')}
    </div>
    ${laterBtn}`, null);
  document.getElementById('modal')?.querySelector('.modal-footer')?.style.setProperty('display', 'none');
}

function _qaSetCategory(inputId, category) {
  _qaOverrides[inputId] = { ...(_qaOverrides[inputId] || {}), category };
  const ids = Object.values(_QA_IDS).find(i => i.input === inputId);
  if (ids) _qaUpdateUI(ids);
  closeModal();
  if (_qaPickCallback) { const cb = _qaPickCallback; _qaPickCallback = null; cb(); }
}

// El usuario decide explícitamente posponer la categorización — se guarda
// igualmente como "Sin clasificar" (nunca se inventa una), y el badge en la
// lista de transacciones lo deja visible para clasificarlo cuando quiera.
function _qaSkipCategory(inputId) {
  _qaOverrides[inputId] = { ...(_qaOverrides[inputId] || {}), skipCategoryCheck: true };
  closeModal();
  if (_qaPickCallback) { const cb = _qaPickCallback; _qaPickCallback = null; cb(); }
}

function _qaPickTrip(ids) {
  const trips = APP.trips || [];
  openModal('Asignar a un viaje', `
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">
      ${trips.map(t => `<button class="cat-pick-btn" onclick="_qaSetTrip('${escapeHtml(ids.input)}','${escapeHtml(t.id)}')">${escapeHtml(t.emoji || '✈')} ${escapeHtml(t.name)}</button>`).join('')}
    </div>`, null);
  document.getElementById('modal')?.querySelector('.modal-footer')?.style.setProperty('display', 'none');
}

function _qaSetTrip(inputId, tripId) {
  _qaOverrides[inputId] = { ...(_qaOverrides[inputId] || {}), tripId: tripId || null };
  const ids = Object.values(_QA_IDS).find(i => i.input === inputId);
  if (ids) _qaUpdateUI(ids);
  closeModal();
}

function _qaSubmit(ids) {
  const input  = document.getElementById(ids.input);
  const parsed = input ? parseQuickAdd(input.value) : null;
  if (!parsed) return;
  const ov       = _qaOverrides[ids.input] || {};
  const type     = ov.type     || parsed.type;
  const category = ov.category || parsed.category;

  // Si no hay una categoría clara, se recomienda elegirla antes de guardar
  // — pero es opcional: si el usuario ya pulsó "lo haré más tarde"
  // (skipCategoryCheck), se guarda igualmente como "Sin clasificar" sin
  // volver a preguntar para esta misma transacción.
  if (category === UNCLASSIFIED_CATEGORY && !ov.skipCategoryCheck) {
    _qaPickCategory(ids, () => _qaSubmit(ids));
    return;
  }

  const qaTx = { id: generateId(), type, date: parsed.date, description: parsed.description, category, amount: parsed.amount };
  if (type === 'expense' && ov.tripId) qaTx.tripId = ov.tripId;
  APP.transactions.push(qaTx);
  _applyTxCashImpact(qaTx, 1);
  if (typeof _notifyGoalProgress === 'function') _notifyGoalProgress(qaTx);
  // Solo "aprender" el patrón cuando la categoría viene de una señal real:
  // el usuario la eligió a mano (ov.category) o coincidió con un patrón ya
  // aprendido / una palabra clave (parsed.source). Nunca memorizar el
  // fallback "Sin clasificar" como si fuera una corrección confirmada.
  if (category !== UNCLASSIFIED_CATEGORY && (ov.category || parsed.source)) {
    _patWrite(txPatternKey(parsed.description), category);
  }
  _qaOverrides[ids.input] = {};
  saveData();
  showToast((type === 'income' ? 'Ingreso' : 'Gasto') + ' añadido → ' + category + ' ✓', 'success');
  input.value = '';
  _qaUpdateUI(ids);
  renderTransactions();
}

function onQuickAddInput() { _qaOverrides[_QA_IDS.tx.input] = {}; _qaUpdateUI(_QA_IDS.tx); }
function quickAddSubmit()  { _qaSubmit(_QA_IDS.tx); }

/* ─── Gestión de categorías y palabras clave ─────────────────── */

let _manageCatTab = 'keywords';
let _manageCatDragSrc = null;

function openManageCategories() {
  _manageCatTab = 'keywords';
  openModal('Palabras clave y Categorías', '', null, _renderManageCats);
  setTimeout(_renderManageCats, 50);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
}

function switchManageCatTab(tab) {
  _manageCatTab = tab;
  _renderManageCats();
}

function _renderManageCats() {
  const body = document.getElementById('modalBody');
  if (!body) return;

  const tabStyle = (id) => [
    'padding:9px 18px', 'font-size:12.5px', 'font-weight:600', 'border:none', 'cursor:pointer', 'background:none',
    `border-bottom:2px solid ${_manageCatTab === id ? 'var(--accent-primary)' : 'transparent'}`,
    `color:${_manageCatTab === id ? 'var(--accent-primary)' : 'var(--text-muted)'}`,
    'transition:color .15s',
  ].join(';');

  const tabs = `<div style="display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--border-subtle)">
    <button style="${tabStyle('keywords')}" onclick="switchManageCatTab('keywords')">🧠 Palabras clave</button>
    <button style="${tabStyle('cats')}" onclick="switchManageCatTab('cats')">📂 Categorías</button>
  </div>`;

  if (_manageCatTab === 'keywords') {
    body.innerHTML = tabs + _buildKeywordsTab();
  } else {
    body.innerHTML = tabs + _buildCatsTab();
    _attachCatsDrag();
  }
}

function _buildKeywordsTab() {
  const patterns   = APP.categoryPatterns || {};
  const incomeSet  = new Set(APP.categories.income);
  const isIncome   = (cat) => incomeSet.has(cat);

  const incomePatterns  = Object.entries(patterns).filter(([, v]) => isIncome(_patCat(v)));
  const expensePatterns = Object.entries(patterns).filter(([, v]) => !isIncome(_patCat(v)));

  const patRow = ([key, v]) => {
    const cat = _patCat(v);
    const hits = (v && typeof v === 'object' && v.hits) ? v.hits : null;
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid var(--border-subtle)">
      <span style="flex:1;font-size:12.5px;font-family:monospace;color:var(--text-primary)">${escapeHtml(key)}${hits ? `<span style="font-size:10px;color:var(--text-muted);margin-left:5px">×${hits}</span>` : ''}</span>
      <span style="font-size:11px;color:var(--text-muted)">→</span>
      <span style="font-size:12px;padding:2px 8px;border-radius:20px;background:var(--bg-elevated);color:var(--text-secondary)">${escapeHtml(cat)}</span>
      <button class="btn-danger" style="padding:2px 7px;font-size:11px" onclick="deleteCategoryPattern('${escapeHtml(key).replace(/'/g, "\\'")}')">✕</button>
    </div>`;
  };

  const emptyMsg = '<div style="color:var(--text-muted);font-size:12px;padding:10px 4px;font-style:italic">Sin palabras clave aún</div>';

  const allCatOptions = [
    '<optgroup label="↑ Ingresos">',
    ...APP.categories.income.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
    '</optgroup>',
    '<optgroup label="↓ Gastos">',
    ...APP.categories.expense.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
    '</optgroup>',
  ].join('');

  return `
    <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:16px;line-height:1.6">
      Enseña a la IA a reconocer tus transacciones. Cuando escribas una palabra clave al añadir un movimiento, la categoría se seleccionará automáticamente.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div>
        <h4 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px">↑ Ingresos</h4>
        <div>${incomePatterns.length ? incomePatterns.map(patRow).join('') : emptyMsg}</div>
      </div>
      <div>
        <h4 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px">↓ Gastos</h4>
        <div>${expensePatterns.length ? expensePatterns.map(patRow).join('') : emptyMsg}</div>
      </div>
    </div>
    <div style="padding-top:16px;border-top:1px solid var(--border-subtle)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" id="new-pat-keyword" class="text-input" placeholder="Palabra clave (ej: Mercadona)" style="flex:1;min-width:140px" />
        <span style="color:var(--text-muted);font-size:13px">→</span>
        <select id="new-pat-category" class="select-input" style="flex:1;min-width:140px">${allCatOptions}</select>
        <button class="btn-primary" onclick="addCategoryPattern()">+ Añadir</button>
      </div>
    </div>`;
}

function _buildCatsTab() {
  const buildList = (type, cats) => cats.map((c, i) => `
    <div draggable="true" data-type="${type}" data-index="${i}"
         style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--border-subtle)">
      <span style="color:var(--text-muted);font-size:17px;cursor:grab;padding:0 3px;user-select:none;line-height:1">⠿</span>
      <span style="flex:1;font-size:13.5px">${escapeHtml(c)}</span>
      <button class="btn-danger" style="padding:3px 8px;font-size:11px" onclick="deleteCategory('${type}','${escapeHtml(c).replace(/'/g, "\\'")}')">✕</button>
    </div>
  `).join('');

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <h4 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px">Ingresos</h4>
        <div id="cat-list-income">${buildList('income', APP.categories.income)}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="new-cat-income" class="text-input" placeholder="Nueva categoría" style="flex:1" />
          <button class="btn-secondary" onclick="addCategory('income')">+</button>
        </div>
      </div>
      <div>
        <h4 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px">Gastos</h4>
        <div id="cat-list-expense">${buildList('expense', APP.categories.expense)}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="new-cat-expense" class="text-input" placeholder="Nueva categoría" style="flex:1" />
          <button class="btn-secondary" onclick="addCategory('expense')">+</button>
        </div>
      </div>
    </div>`;
}

function _attachCatsDrag() {
  ['income', 'expense'].forEach(type => {
    const listEl = document.getElementById(`cat-list-${type}`);
    if (!listEl) return;
    listEl.querySelectorAll('[draggable]').forEach(item => {
      item.addEventListener('dragstart', () => {
        _manageCatDragSrc = item;
        setTimeout(() => { item.style.opacity = '0.35'; }, 0);
      });
      item.addEventListener('dragend', () => {
        item.style.opacity = '';
        listEl.querySelectorAll('[draggable]').forEach(el => el.classList.remove('cat-drag-over'));
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        if (_manageCatDragSrc && _manageCatDragSrc.dataset.type === type) {
          listEl.querySelectorAll('[draggable]').forEach(el => el.classList.remove('cat-drag-over'));
          item.classList.add('cat-drag-over');
        }
      });
      item.addEventListener('drop', e => {
        e.preventDefault();
        item.classList.remove('cat-drag-over');
        if (!_manageCatDragSrc || _manageCatDragSrc === item || _manageCatDragSrc.dataset.type !== type) return;
        const from = parseInt(_manageCatDragSrc.dataset.index);
        const to   = parseInt(item.dataset.index);
        APP.categories[type].splice(to, 0, APP.categories[type].splice(from, 1)[0]);
        saveData();
        _renderManageCats();
      });
    });
  });
}

function addCategoryPattern() {
  const kwInput = document.getElementById('new-pat-keyword');
  const catSel  = document.getElementById('new-pat-category');
  if (!kwInput || !catSel) return;
  const raw = kwInput.value.trim();
  const cat = catSel.value;
  if (!raw) return showToast('Escribe una palabra clave', 'error');
  if (!cat) return showToast('Elige una categoría', 'error');
  _patWrite(txPatternKey(raw), cat);
  saveData();
  kwInput.value = '';
  _renderManageCats();
  showToast('Palabra clave guardada ✓', 'success');
}

function deleteCategoryPattern(key) {
  if (APP.categoryPatterns) delete APP.categoryPatterns[key];
  saveData();
  _renderManageCats();
  showToast('Palabra clave eliminada', 'success');
}

function addCategory(type) {
  const input = document.getElementById(`new-cat-${type}`);
  if (!input) return;
  const name = input.value.trim();
  if (!name) return showToast('Escribe un nombre', 'error');
  if (!_validateTextInput(name, 'La categoría')) return;
  if (APP.categories[type].includes(name)) return showToast('Ya existe', 'error');
  APP.categories[type].push(name);
  saveData();
  input.value = '';
  _renderManageCats();
  showToast('Categoría añadida ✓', 'success');
}

function deleteCategory(type, name) {
  APP.categories[type] = APP.categories[type].filter(c => c !== name);
  saveData();
  _renderManageCats();
  showToast('Categoría eliminada', 'success');
}

const debouncedTxRender = debounce(() => { updateTransactionSummary(); renderTransactionTable(); }, 200);

function _txUpdateClearBtn() {
  const clearBtn = document.getElementById('btn-tx-clear-filters');
  if (!clearBtn) return;
  const type     = document.getElementById('tx-filter-type')?.value     || 'all';
  const cat      = document.getElementById('tx-filter-category')?.value || 'all';
  const month    = document.getElementById('tx-filter-month')?.value    || '';
  const search   = document.getElementById('tx-filter-search')?.value   || '';
  const active   = type !== 'all' || cat !== 'all' || !!month || !!search || _txShowFavoritesOnly;
  clearBtn.style.display = active ? '' : 'none';
}

function _txNavigateMonth(dir) {
  const monthEl = document.getElementById('tx-filter-month');
  if (!monthEl) return;
  const cur = monthEl.value || getCurrentMonth();
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  monthEl.value = next;
  monthEl.classList.toggle('filter-active', true);
  APP.txFilterMonth = next;
  _txUpdateMonthLabel();
  _txUpdateClearBtn();
  updateTransactionSummary();
  renderTransactionTable();
}

function _txSetPeriodPreset(preset) {
  const monthEl = document.getElementById('tx-filter-month');
  if (!monthEl) return;
  if (preset === 'all') {
    monthEl.value = '';
    monthEl.classList.remove('filter-active');
    APP.txFilterMonth = '';
  } else {
    const now = new Date();
    if (preset === 'prev') now.setMonth(now.getMonth() - 1);
    const val = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthEl.value = val;
    monthEl.classList.add('filter-active');
    APP.txFilterMonth = val;
  }
  _txUpdateMonthLabel();
  _txUpdateClearBtn();
  updateTransactionSummary();
  renderTransactionTable();
}

function clearTxFilters() {
  const typeEl   = document.getElementById('tx-filter-type');
  const catEl    = document.getElementById('tx-filter-category');
  const monthEl  = document.getElementById('tx-filter-month');
  const searchEl = document.getElementById('tx-filter-search');
  if (typeEl)   { typeEl.value  = 'all'; typeEl.classList.remove('filter-active'); }
  if (catEl)    { catEl.value   = 'all'; catEl.classList.remove('filter-active'); }
  if (monthEl)  { monthEl.value = '';    monthEl.classList.remove('filter-active'); }
  if (searchEl) { searchEl.value = ''; }
  _txShowFavoritesOnly = false;
  const favBtn = document.getElementById('btn-tx-favs');
  if (favBtn) favBtn.classList.remove('filter-active');
  APP.txFilterMonth = '';
  _txUpdateMonthLabel();
  _txUpdateClearBtn();
  updateTransactionSummary();
  renderTransactionTable();
}
