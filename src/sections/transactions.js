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

function renderTransactions() {
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
    th.addEventListener('click', () => {
      if (_txSortCol === th.dataset.sort) { _txSortAsc = !_txSortAsc; }
      else { _txSortCol = th.dataset.sort; _txSortAsc = th.dataset.sort === 'amount' ? false : true; }
      renderTransactionTable();
    });
  });
  _delegate('section-transactions', {
    'edit-tx':    id => editTransaction(id),
    'delete-tx':  id => deleteTransaction(id),
    'fav-tx':     id => toggleTxFavorite(id),
    'view-photo': id => viewTransactionPhoto(id),
  });
  updateTransactionSummary();   // renderBudgets() is called inside here
  renderTransactionTable();
  populateCategoryFilter();
  document.querySelectorAll('#section-transactions .chart-wrapper').forEach(el => el.classList.add('loading'));
  ric(() => {
    renderTransactionCharts();
    document.querySelectorAll('#section-transactions .chart-wrapper.loading').forEach(el => el.classList.remove('loading'));
  });
}

function updateTransactionSummary() {
  const monthFilter = document.getElementById('tx-filter-month')?.value;
  const month       = monthFilter || getCurrentMonth();

  const income  = APP.transactions.filter(t => t.type === 'income'  && (t.date || getCurrentMonth()).startsWith(month)).reduce((s, t) => s + t.amount, 0);
  const expense = APP.transactions.filter(t => t.type === 'expense' && (t.date || getCurrentMonth()).startsWith(month)).reduce((s, t) => s + t.amount, 0);
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
  if (!ctx) return;

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

function renderChartExpenseByCategory() {
  const ctx = document.getElementById('chart-expense-category');
  if (!ctx) return;

  const { textColor, fontFamily } = getChartDefaults();

  const byCategory = {};
  APP.transactions.filter(t => t.type === 'expense').forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });

  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const labels  = entries.map(e => e[0]);
  const data    = entries.map(e => e[1]);

  if (data.length === 0) {
    Charts.destroy('expense-category', 'chart-expense-category');
    return;
  }

  const ecChart = Charts.get('expense-category');
  if (ecChart) {
    ecChart.data.labels = labels;
    ecChart.data.datasets[0].data = data;
    ecChart.data.datasets[0].backgroundColor = CHART_COLORS.slice(0, data.length);
    ecChart.options.plugins.legend.labels.color = textColor;
    ecChart.update('none');
    return;
  }

  Charts.set('expense-category', new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS.slice(0, data.length), borderColor: 'transparent', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { color: textColor, font: { family: fontFamily, size: 11 }, boxWidth: 10, padding: 10 } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)}` } }
      }
    }
  }));
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
  const sign = t.type === 'income' ? '+' : '-';
  const favLabel = t.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos';
  const rowCls = ['tx-row-' + t.type, t.favorite ? 'tx-row-fav' : ''].filter(Boolean).join(' ');
  return `<tr data-id="${t.id}" class="${rowCls}" tabindex="0">
    <td>${formatDate(t.date)}</td>
    <td><span class="tx-desc-wrap"><strong>${escapeHtml(t.description)}</strong>${recurringBadge}${bankBadge}${indicators ? `<span class="tx-indicators">${indicators}</span>` : ''}</span></td>
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
  if (searchQuery)              txs = txs.filter(t => t.description.toLowerCase().includes(searchQuery) || (t.note || '').toLowerCase().includes(searchQuery) || t.category.toLowerCase().includes(searchQuery));
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
    if (!arrow) return;
    if (th.dataset.sort === col) arrow.textContent = _txSortAsc ? ' ▲' : ' ▼';
    else arrow.textContent = '';
    th.classList.toggle('sort-active', th.dataset.sort === col);
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
  const uniqueUsed = [...new Set(APP.transactions.map(t => t.category))];
  sel.innerHTML = '<option value="all">Todas las categorías</option>' +
    uniqueUsed.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
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
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === tx.category) o.selected = true;
    catSel.appendChild(o);
  });
  frag.querySelector('#f-tx-photo').addEventListener('change', function() { onTxPhotoChange(this); });
  // Build autocomplete datalist from unique historical descriptions
  const uniqueDescs = [...new Set(APP.transactions.map(t => t.description))].sort();
  let dl = document.getElementById('tx-desc-datalist');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'tx-desc-datalist'; document.body.appendChild(dl); }
  dl.innerHTML = uniqueDescs.map(d => `<option value="${escapeHtml(d)}">`).join('');
  return frag;
}

async function _txSave(prefill, isEdit) {
  const type        = document.getElementById('f-tx-type').value;
  const date        = document.getElementById('f-tx-date').value;
  const description = document.getElementById('f-tx-desc').value.trim();
  const category    = document.getElementById('f-tx-category').value;
  const amount      = parseFloat(document.getElementById('f-tx-amount').value);
  const note        = document.getElementById('f-tx-note')?.value.trim() || '';
  const favorite    = document.getElementById('f-tx-fav')?.checked || false;

  if (!description) return showToast('La descripción es obligatoria', 'error');
  if (!date)        return showToast('La fecha es obligatoria', 'error');
  if (!amount || amount <= 0) return showToast('El importe debe ser positivo', 'error');

  let photoId;
  try { photoId = await _commitPhotoState(); }
  catch { showToast('Error guardando la foto. La transacción se guardará sin ella.', 'error'); photoId = null; }

  let _oldTxSnapshot = null;
  if (isEdit) {
    const idx = APP.transactions.findIndex(t => t.id === prefill.id);
    if (idx >= 0) {
      _oldTxSnapshot = { ...APP.transactions[idx] };
      const updated = { ...prefill, type, date, description, category, amount, note, favorite };
      if (photoId !== undefined) updated.photoId = photoId || undefined;
      delete updated.photo;
      APP.transactions[idx] = updated;
    }
  } else {
    const entry = { id: generateId(), type, date, description, category, amount, note, favorite };
    if (photoId) entry.photoId = photoId;
    APP.transactions.push(entry);
    if (typeof _notifyGoalProgress === 'function') _notifyGoalProgress(entry);
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
    const desc = descInput.value.trim();
    if (desc.length >= 2) autoSuggestCategory(desc);
  });
  if (tx.description) setTimeout(() => autoSuggestCategory(tx.description), 80);

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
  sel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function editTransaction(id) {
  const tx = APP.transactions.find(t => t.id === id);
  if (tx) openAddTransaction(tx);
}

function deleteTransaction(id) {
  const tx = APP.transactions.find(t => t.id === id);
  if (!tx) return;
  APP.transactions = APP.transactions.filter(t => t.id !== id);
  updateNetworthHistory();
  renderTransactions();
  markDashboardDirty();
  renderDashboard();
  softDelete(`"${tx.description}" eliminado`, () => {
    APP.transactions.push(tx);
    saveData();
    renderTransactions();
    renderDashboard();
  }, () => {
    // Committed (no undo) — delete photo from IDB
    if (tx.photoId) deletePhoto(tx.photoId);
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
    const spent = APP.transactions.filter(t => t.type === 'expense' && t.category === b.category && (t.date || getCurrentMonth()).startsWith(m)).reduce((s, t) => s + t.amount, 0);
    const pct   = b.monthlyAmount > 0 ? Math.min(100, (spent / b.monthlyAmount) * 100) : 0;
    const over  = spent > b.monthlyAmount;
    const left  = b.monthlyAmount - spent;
    return { b, spent, pct, over, left };
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
  budgetData.forEach(({ b, pct }) => {
    if (b.monthlyAmount <= 0 || pct < 80) return;
    const alertKey = `budget80-${m}-${b.category}`;
    if (!APP.dismissedAlerts[alertKey]) {
      APP.dismissedAlerts[alertKey] = true;
      alertsFired = true;
      showToast(`⚠ Presupuesto "${escapeHtml(b.category)}": ${pct.toFixed(0)}% utilizado`, 'error');
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

  const normDesc = description.toLowerCase()
    .split('').filter(function(c){var cc=c.charCodeAt(0);return cc<768||cc>879;}).join('');
  const incomeKws = ['nomina', 'salario', 'sueldo', 'ingreso', 'dividendo', 'dividendos', 'bonus', 'reembolso', 'devolucion', 'venta'];
  const type = incomeKws.some(kw => normDesc.includes(kw)) ? 'income' : 'expense';

  const learned = APP.categoryPatterns && _patCat(APP.categoryPatterns[txPatternKey(description)]);
  const local   = matchLocalKeywords(description, type);
  const cats    = type === 'expense' ? APP.categories.expense : APP.categories.income;
  const category = learned || local || cats[0] || 'Otros';
  const source   = learned ? 'aprendido' : (local ? 'sugerido' : null);

  return { description, amount, type, category, source, date: getTodayStr() };
}

const _QA_IDS = {
  tx: { input: 'quick-add-input', type: 'quick-add-type-badge', cat: 'quick-add-cat-badge', hint: 'quick-add-hint', btn: 'quick-add-btn' },
};
const _qaOverrides = {};

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
  const input  = document.getElementById(ids.input);
  const badge  = document.getElementById(ids.cat);
  const tbadge = document.getElementById(ids.type);
  const hint   = document.getElementById(ids.hint);
  const btn    = document.getElementById(ids.btn);
  const parsed = input ? parseQuickAdd(input.value) : null;
  if (!parsed) {
    if (badge)  badge.style.display  = 'none';
    if (tbadge) tbadge.style.display = 'none';
    if (hint)   hint.style.display   = 'none';
    if (btn)    btn.disabled = true;
    return;
  }
  const ov = _qaOverrides[ids.input] || {};
  const effectiveType = ov.type     || parsed.type;
  const effectiveCat  = ov.category || parsed.category;
  if (badge) {
    badge.textContent = effectiveCat + (parsed.source && !ov.category ? ' · ' + parsed.source : '');
    badge.style.display = 'inline-block';
    badge.style.cursor = 'pointer';
    badge.title = 'Clic para cambiar categoría';
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
  if (hint) { hint.textContent = parsed.description + ' · ' + formatCurrency(parsed.amount); hint.style.display = 'block'; }
  if (btn) btn.disabled = false;
}

function _qaPickCategory(ids) {
  const allCats = [...APP.categories.income, ...APP.categories.expense];
  openModal('Cambiar categoría', `
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">
      ${allCats.map(c => `<button class="cat-pick-btn" onclick="_qaSetCategory('${escapeHtml(ids.input)}','${escapeHtml(c)}');closeModal()">${escapeHtml(c)}</button>`).join('')}
    </div>`, null);
  document.getElementById('modal')?.querySelector('.modal-footer')?.style.setProperty('display', 'none');
}

function _qaSetCategory(inputId, category) {
  _qaOverrides[inputId] = { ...(_qaOverrides[inputId] || {}), category };
  const ids = Object.values(_QA_IDS).find(i => i.input === inputId);
  if (ids) _qaUpdateUI(ids);
}

function _qaSubmit(ids) {
  const input  = document.getElementById(ids.input);
  const parsed = input ? parseQuickAdd(input.value) : null;
  if (!parsed) return;
  const ov = _qaOverrides[ids.input] || {};
  const type     = ov.type     || parsed.type;
  const category = ov.category || parsed.category;
  const qaTx = { id: generateId(), type, date: parsed.date, description: parsed.description, category, amount: parsed.amount };
  APP.transactions.push(qaTx);
  if (typeof _notifyGoalProgress === 'function') _notifyGoalProgress(qaTx);
  _patWrite(txPatternKey(parsed.description), category);
  _qaOverrides[ids.input] = {};
  saveData();
  showToast((parsed.type === 'income' ? 'Ingreso' : 'Gasto') + ' añadido → ' + parsed.category + ' ✓', 'success');
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
