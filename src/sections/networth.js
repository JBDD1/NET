/* ═══════════════════════════════════════════════════════════════
   FINOVA — networth.js
   Sección: Patrimonio Neto, cuentas de efectivo e inmuebles
═══════════════════════════════════════════════════════════════ */
'use strict';

const PROPERTY_TYPE_LABELS = {
  vivienda_habitual: 'Vivienda habitual',
  alquiler:          'Inversión / Alquiler',
  segunda_vivienda:  'Segunda residencia',
  comercial:         'Local comercial',
  terreno:           'Terreno',
  otro:              'Otro',
};

function renderNetworth() {
  _delegate('section-networth', {
    'edit-cash':     id => editCashAccount(id),
    'delete-cash':   id => deleteCashAccount(id),
    'edit-prop':     id => editProperty(id),
    'delete-prop':   id => deleteProperty(id),
  });
  const cash         = calcCashTotal();
  const investments  = calcPortfolioValue();
  const alternatives = calcAlternativesTotal();
  const properties   = calcPropertiesTotal();
  const liabilities  = calcLiabilitiesTotal();
  const totalAssets  = cash + investments + alternatives + properties;
  const total        = totalAssets - liabilities;

  _animNum(document.getElementById('nw-total'),        total,       formatCurrency, 600);
  _animNum(document.getElementById('nw-cash'),         cash,        formatCurrency, 500);
  _animNum(document.getElementById('nw-investments'),  investments, formatCurrency, 500);
  _animNum(document.getElementById('nw-alternatives'), alternatives,formatCurrency, 500);
  _animNum(document.getElementById('nw-real-estate'),  properties,  formatCurrency, 500);
  _animNum(document.getElementById('nw-liabilities'),  liabilities, formatCurrency, 500);
  _animNum(document.getElementById('nw-total-assets'), totalAssets, formatCurrency, 500);

  const debtRatio = totalAssets > 0 ? (liabilities / totalAssets) * 100 : 0;
  const ratioEl = document.getElementById('nw-debt-ratio');
  if (ratioEl) {
    ratioEl.textContent = debtRatio.toFixed(1) + '%';
    ratioEl.className = 'kpi-value ' + (debtRatio > 50 ? 'negative' : debtRatio > 25 ? '' : 'positive');
  }
  const hintEl = document.getElementById('nw-liabilities-hint');
  if (hintEl) hintEl.textContent = liabilities > 0 ? `⊖ Deuda: ${formatCurrency(liabilities)}` : '';

  // Month-over-month change indicator
  const momEl = document.getElementById('nw-mom-change');
  if (momEl && APP.networthHistory.length >= 2) {
    const sorted = [...APP.networthHistory].sort((a, b) => a.date.localeCompare(b.date));
    const prev   = sorted[sorted.length - 2]?.value ?? null;
    const curr   = sorted[sorted.length - 1]?.value ?? null;
    if (prev !== null && curr !== null) {
      const diff = curr - prev;
      const pct  = prev !== 0 ? (diff / Math.abs(prev)) * 100 : null;
      const sign = diff >= 0 ? '+' : '';
      momEl.textContent = `${sign}${formatCurrency(diff)}${pct !== null ? ` (${sign}${pct.toFixed(1)}%)` : ''} vs mes anterior`;
      momEl.className   = 'kpi-change ' + (diff >= 0 ? 'positive' : 'negative');
      momEl.style.display = '';
    } else {
      momEl.style.display = 'none';
    }
  } else if (momEl) {
    momEl.style.display = 'none';
  }

  renderCashAccounts();
  renderPropertiesList();
  renderBreakdownBars(totalAssets, cash, investments, alternatives, properties, liabilities);
}

/* ─── Cuentas de efectivo ────────────────────────────────────── */

function renderCashAccounts() {
  const el = document.getElementById('cash-entries-list');
  if (!el) return;
  if (APP.cashAccounts.length === 0) {
    el.innerHTML = emptyState('🏦', 'Sin cuentas de efectivo',
      'Añade tus cuentas bancarias o de ahorro para controlar tu liquidez total.',
      '+ Añadir cuenta', 'openAddCashAccount()');
    return;
  }
  const sorted = [...APP.cashAccounts].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  el.innerHTML = sorted.map(acc => `
    <div class="cash-entry" data-id="${acc.id}">
      <div class="cash-entry-name">${escapeHtml(acc.name)}</div>
      <div class="cash-entry-amount">${formatCurrency(acc.amount)}</div>
      <div class="cash-entry-actions">
        <button class="btn-edit btn-icon" data-action="edit-cash" aria-label="Editar cuenta ${escapeHtml(acc.name)}">✎</button>
        <button class="btn-danger btn-icon" data-action="delete-cash" aria-label="Eliminar cuenta ${escapeHtml(acc.name)}">✕</button>
      </div>
    </div>
  `).join('');
}

function openAddCashAccount(prefill = null) {
  const isEdit = !!prefill;
  const acc = prefill || {};
  openModal(isEdit ? 'Editar cuenta' : 'Añadir cuenta', `
    <div class="form-group">
      <label class="form-label">Nombre de la cuenta</label>
      <input type="text" id="f-cash-name" class="text-input" placeholder="Ej: Cuenta corriente BBVA" value="${escapeHtml(acc.name || '')}" />
    </div>
    <div class="form-group">
      <label class="form-label">Saldo actual (€)</label>
      <input type="number" id="f-cash-amount" class="text-input" placeholder="0.00" value="${acc.amount || ''}" step="0.01" />
    </div>
  `, () => {
    const name   = document.getElementById('f-cash-name').value.trim();
    const amount = parseFloat(document.getElementById('f-cash-amount').value) || 0;
    if (!name) return showToast('El nombre es obligatorio', 'error');
    if (isEdit) {
      const idx = APP.cashAccounts.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.cashAccounts[idx] = { ...prefill, name, amount };
      showToast('Cuenta actualizada ✓', 'success');
    } else {
      APP.cashAccounts.push({ id: generateId(), name, amount });
      showToast('Cuenta añadida ✓', 'success');
    }
    saveData();
    closeModal();
    renderNetworth();
    if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  });
}

function editCashAccount(id) {
  const acc = APP.cashAccounts.find(x => x.id === id);
  if (acc) openAddCashAccount(acc);
}

function deleteCashAccount(id) {
  const acc = APP.cashAccounts.find(x => x.id === id);
  if (!acc) return;
  APP.cashAccounts = APP.cashAccounts.filter(x => x.id !== id);
  updateNetworthHistory();
  renderNetworth();
  softDelete(`Cuenta "${acc.name}" eliminada`, () => {
    APP.cashAccounts.push(acc);
    saveData();
    renderNetworth();
  });
}

/* ─── Distribución del patrimonio ───────────────────────────── */

function renderBreakdownBars(total, cash, investments, alternatives, properties, liabilities = 0) {
  const el = document.getElementById('nw-breakdown-bars');
  if (!el || total === 0) {
    if (el) el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">Añade activos para ver la distribución</div>';
    return;
  }
  const items = [
    { label: '💰 Efectivo & Cuentas',  value: cash,         color: '#c9a84c' },
    { label: '📈 Inversiones',          value: investments,  color: '#5b6aff' },
    { label: '🏠 Inmuebles',            value: properties,   color: '#26a0b5' },
    { label: '💎 Activos Alternativos', value: alternatives, color: '#3ddc84' },
    ...(liabilities > 0 ? [{ label: '⊖ Pasivos & Deudas', value: -liabilities, color: '#ff6b6b' }] : []),
  ];
  el.innerHTML = items.filter(item => item.value !== 0).map(item => {
    const rawPct  = total > 0 ? (Math.abs(item.value) / total) * 100 : 0;
    const pctDisp = (item.value < 0 ? '−' : '') + rawPct.toFixed(1) + '%';
    return `
      <div class="breakdown-bar-item">
        <div class="breakdown-bar-header">
          <span class="breakdown-bar-label">${item.label}</span>
          <div class="breakdown-bar-values">
            <span>${formatCurrency(item.value, item.value < 0)}</span>
            <strong style="color:${item.color}">${pctDisp}</strong>
          </div>
        </div>
        <div class="breakdown-track">
          <div class="breakdown-fill" style="width:${rawPct.toFixed(1)}%;background:${item.color}"></div>
        </div>
      </div>
    `;
  }).join('');
}

/* ─── Inmuebles ──────────────────────────────────────────────── */

function renderPropertiesList() {
  const el = document.getElementById('properties-list');
  if (!el) return;
  const props = APP.properties || [];
  if (props.length === 0) {
    el.innerHTML = emptyState('🏠', 'Sin inmuebles',
      'Añade propiedades para incluirlas en el cálculo de tu patrimonio neto.',
      '+ Añadir inmueble', 'openAddProperty()');
    return;
  }
  el.innerHTML = props.map(p => {
    const curVal  = parseFloat(p.currentValue) || 0;
    const gain    = curVal - (parseFloat(p.purchasePrice) || 0);
    const gainPct = p.purchasePrice > 0 ? (gain / p.purchasePrice) * 100 : 0;
    const cls     = gain >= 0 ? 'positive' : 'negative';
    const typeLabel = PROPERTY_TYPE_LABELS[p.type] || escapeHtml(p.type);
    return `
      <div class="property-entry" data-id="${p.id}">
        <div class="property-entry-main">
          <div class="property-entry-info">
            <span class="property-type-badge">${typeLabel}</span>
            <div class="property-entry-name">${escapeHtml(p.name)}</div>
            ${p.address ? `<div class="property-entry-address">📍 ${escapeHtml(p.address)}</div>` : ''}
          </div>
          <div class="property-entry-values">
            <div class="editable-price prop-value-input" style="justify-content:flex-end">
              <input type="number" value="${curVal}" step="1000" min="0"
                aria-label="Valor actual de ${escapeHtml(p.name)}"
                onchange="updatePropertyValue('${p.id}', this.value)"
                style="width:120px;text-align:right;font-size:15px;font-weight:600" />
            </div>
            <div class="property-entry-gain ${cls}">${formatCurrency(gain, true)} (${formatPct(gainPct)})</div>
            ${p.monthlyRent ? `<div class="property-entry-rent">Renta: ${formatCurrency(p.monthlyRent)}/mes</div>` : ''}
          </div>
        </div>
        <div class="property-entry-actions">
          <button class="btn-edit btn-icon" data-action="edit-prop" aria-label="Editar ${escapeHtml(p.name)}">✎</button>
          <button class="btn-danger btn-icon" data-action="delete-prop" aria-label="Eliminar ${escapeHtml(p.name)}">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function _parseMoney(raw) {
  const s = String(raw || '').trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes('.') && s.includes(','))
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2)
      return parseFloat(s.replace(',', '.')) || 0;
    return parseFloat(s.replace(/,/g, '')) || 0;
  }
  if (s.includes('.') && !s.includes(',')) {
    const parts = s.split('.');
    if (parts.length > 2) return parseFloat(s.replace(/\./g, '')) || 0;
    if (parts.length === 2 && parts[1].length === 3)
      return parseFloat(s.replace('.', '')) || 0;
  }
  return parseFloat(s) || 0;
}

function openAddProperty(prefill = null) {
  const isEdit = !!prefill;
  const p = prefill || {};
  const typeOptions = Object.entries(PROPERTY_TYPE_LABELS)
    .map(([val, lbl]) => `<option value="${val}" ${(p.type || 'vivienda_habitual') === val ? 'selected' : ''}>${lbl}</option>`)
    .join('');
  const fv = v => v ? String(v) : '';

  openModal(isEdit ? 'Editar inmueble' : 'Añadir inmueble', `
    <div class="form-group">
      <label class="form-label">Nombre del inmueble *</label>
      <input type="text" id="f-prop-name" class="text-input" placeholder="Ej: Piso Madrid Centro" value="${escapeHtml(p.name || '')}" />
    </div>
    <div class="form-group">
      <label class="form-label">Tipo de inmueble</label>
      <select id="f-prop-type" class="select-input">${typeOptions}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Dirección (opcional)</label>
      <input type="text" id="f-prop-address" class="text-input" placeholder="Calle, número, ciudad" value="${escapeHtml(p.address || '')}" />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Precio de compra (€) *</label>
        <input type="text" inputmode="decimal" id="f-prop-purchase" class="text-input" placeholder="Ej: 200000" value="${fv(p.purchasePrice)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Valor actual estimado (€) *</label>
        <input type="text" inputmode="decimal" id="f-prop-current" class="text-input" placeholder="Ej: 250000" value="${fv(p.currentValue)}" />
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Renta mensual (€, si aplica)</label>
        <input type="text" inputmode="decimal" id="f-prop-rent" class="text-input" placeholder="Ej: 800" value="${fv(p.monthlyRent)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de compra</label>
        <input type="date" id="f-prop-date" class="text-input" value="${p.purchaseDate || ''}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <textarea id="f-prop-notes" class="text-input" style="resize:vertical;min-height:60px" placeholder="Hipoteca pendiente, estado, etc.">${escapeHtml(p.notes || '')}</textarea>
    </div>
  `, () => {
    const name          = document.getElementById('f-prop-name').value.trim();
    const type          = document.getElementById('f-prop-type').value;
    const address       = document.getElementById('f-prop-address').value.trim();
    const purchasePrice = _parseMoney(document.getElementById('f-prop-purchase').value);
    const currentValue  = _parseMoney(document.getElementById('f-prop-current').value);
    const monthlyRent   = _parseMoney(document.getElementById('f-prop-rent').value);
    const purchaseDate  = document.getElementById('f-prop-date').value;
    const notes         = document.getElementById('f-prop-notes').value.trim();

    if (!name)          return showToast('El nombre es obligatorio', 'error');
    if (!purchasePrice) return showToast('Introduce el precio de compra (ej: 200000)', 'error');
    if (!currentValue)  return showToast('Introduce el valor actual (ej: 250000)', 'error');

    const entry = {
      ...(p.id ? p : {}),
      id:            p.id || generateId(),
      name, type, address, purchasePrice, currentValue,
      ...(monthlyRent  ? { monthlyRent }  : {}),
      ...(purchaseDate ? { purchaseDate } : {}),
      ...(notes        ? { notes }        : {}),
    };

    if (!APP.properties) APP.properties = [];
    if (isEdit) {
      const idx = APP.properties.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.properties[idx] = entry;
      showToast('Inmueble actualizado ✓', 'success');
    } else {
      APP.properties.push(entry);
      showToast('Inmueble añadido ✓', 'success');
    }
    saveData();
    closeModal();
    renderNetworth();
    if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  });
}

function updatePropertyValue(id, newValue) {
  const p = (APP.properties || []).find(x => x.id === id);
  if (!p) return;
  p.currentValue = parseFloat(newValue) || 0;
  updateNetworthHistory();
  saveData();
  renderNetworth();
  if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  showToast('Tasación actualizada ✓', 'success');
}

function editProperty(id) {
  const p = (APP.properties || []).find(x => x.id === id);
  if (p) openAddProperty(p);
}

function deleteProperty(id) {
  const prop = (APP.properties || []).find(x => x.id === id);
  if (!prop) return;
  APP.properties = (APP.properties || []).filter(x => x.id !== id);
  updateNetworthHistory();
  renderNetworth();
  if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  softDelete(`Inmueble "${prop.name}" eliminado`, () => {
    if (!APP.properties) APP.properties = [];
    APP.properties.push(prop);
    saveData();
    renderNetworth();
    if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  });
}

/* ═══════════════════════════════════════════════════════════════
   ACTIVOS ALTERNATIVOS
═══════════════════════════════════════════════════════════════ */

function renderAlternatives() {
  _delegate('section-alternatives', {
    'edit-alt':   id => editAlternative(id),
    'delete-alt': id => deleteAlternative(id),
  });
  const totalCurrent = calcAlternativesTotal();
  const totalCost    = APP.alternatives.reduce((s, a) => s + (parseFloat(a.buyPrice) || 0), 0);
  const totalGain    = totalCurrent - totalCost;

  setText('alt-total-current', formatCurrency(totalCurrent));
  setText('alt-total-cost',    formatCurrency(totalCost));
  const gainEl = document.getElementById('alt-total-gain');
  if (gainEl) {
    gainEl.textContent = formatCurrency(totalGain, true);
    gainEl.className   = 'kpi-value ' + colorClass(totalGain);
  }

  const grid = document.getElementById('alternatives-grid');
  if (!grid) return;

  if (APP.alternatives.length === 0) {
    grid.innerHTML = emptyState('◇', 'Sin activos alternativos',
      'Registra relojes, arte, inmuebles o cualquier activo tangible para incluirlo en tu patrimonio.',
      '+ Añadir activo', 'openAddAlternative()');
    return;
  }

  grid.innerHTML = APP.alternatives.map(a => {
    const curVal  = calcAltCurrentValue(a);
    const gain    = curVal - (parseFloat(a.buyPrice) || 0);
    const gainPct = a.buyPrice > 0 ? (gain / a.buyPrice) * 100 : 0;
    const cls     = colorClass(gain);
    const hasDepreciation = parseFloat(a.depreciationPct) > 0 && a.purchaseDate;
    return `
      <div class="alternative-card" data-id="${a.id}">
        <div class="alt-actions">
          <button class="btn-edit btn-icon" data-action="edit-alt" aria-label="Editar ${escapeHtml(a.name)}">✎</button>
          <button class="btn-danger btn-icon" data-action="delete-alt" aria-label="Eliminar ${escapeHtml(a.name)}">✕</button>
        </div>
        <div class="alt-category-badge">${escapeHtml(a.category)}</div>
        <div class="alt-name">${escapeHtml(a.name)}</div>
        <div class="alt-price-row">
          <div>
            <div class="alt-price-label">Precio compra</div>
            <div class="alt-price-val">${formatCurrency(a.buyPrice)}</div>
          </div>
          <div>
            <div class="alt-price-label">Valor actual${hasDepreciation ? ' <span class="alt-dep-badge" title="Calculado por depreciación anual">⟳</span>' : ''}</div>
            <div class="alt-price-val">${formatCurrency(curVal)}</div>
          </div>
        </div>
        ${hasDepreciation ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Depreciación: ${a.depreciationPct}% anual</div>` : ''}
        <div class="alt-gain ${cls}">${formatCurrency(gain, true)} · ${formatPct(gainPct)}</div>
        ${a.purchaseDate ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Comprado: ${formatDate(a.purchaseDate)}</div>` : ''}
        ${a.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:6px;font-style:italic">${escapeHtml(a.notes)}</div>` : ''}
      </div>
    `;
  }).join('');

  renderAltCharts();
}


function renderAltCharts() {
  const wrap = document.getElementById('alt-charts-wrap');
  if (wrap) wrap.style.display = APP.alternatives.length > 1 ? '' : 'none';
  if (APP.alternatives.length <= 1) return;

  const { gridColor, textColor, fontFamily } = getChartDefaults();

  const byCategory = {};
  APP.alternatives.forEach(a => {
    const key = a.category || 'Otro';
    byCategory[key] = (byCategory[key] || 0) + calcAltCurrentValue(a);
  });
  const catLabels = Object.keys(byCategory);
  const catValues = Object.values(byCategory);
  const catTotal  = catValues.reduce((s, v) => s + v, 0);

  const acChart = Charts.get('alt-category');
  if (acChart) {
    acChart.data.labels = catLabels;
    acChart.data.datasets[0].data = catValues;
    acChart.data.datasets[0].backgroundColor = CHART_COLORS.slice(0, catLabels.length);
    acChart.options.plugins.legend.labels.color = textColor;
    acChart.update('none');
  } else {
    Charts.set('alt-category', new Chart(document.getElementById('chart-alt-category'), {
      type: 'doughnut',
      data: { labels: catLabels, datasets: [{ data: catValues, backgroundColor: CHART_COLORS.slice(0, catLabels.length), borderColor: 'transparent', hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { color: textColor, font: { family: fontFamily, size: 11 }, boxWidth: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)} (${catTotal > 0 ? (ctx.raw / catTotal * 100).toFixed(1) : 0}%)` } }
        }
      }
    }));
  }

  const sorted      = [...APP.alternatives].sort((a, b) => calcAltCurrentValue(b) - calcAltCurrentValue(a));
  const assetLabels = sorted.map(a => a.name.length > 14 ? a.name.slice(0, 14) + '…' : a.name);
  const costVals    = sorted.map(a => parseFloat(a.buyPrice) || 0);
  const currVals    = sorted.map(a => calcAltCurrentValue(a));

  const aaChart = Charts.get('alt-assets');
  if (aaChart) {
    aaChart.data.labels = assetLabels;
    aaChart.data.datasets[0].data = costVals;
    aaChart.data.datasets[1].data = currVals;
    aaChart.options.scales.x.ticks.color = textColor;
    aaChart.options.scales.y.grid.color = gridColor;
    aaChart.options.scales.y.ticks.color = textColor;
    aaChart.update('none');
  } else {
    Charts.set('alt-assets', new Chart(document.getElementById('chart-alt-assets'), {
      type: 'bar',
      data: {
        labels: assetLabels,
        datasets: [
          { label: 'Coste',        data: costVals, backgroundColor: 'rgba(120,130,150,0.5)', borderRadius: 4 },
          { label: 'Valor actual', data: currVals, backgroundColor: getChartDefaults().accentFill.replace('0.09','0.75'), borderRadius: 4 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor, font: { family: fontFamily, size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { family: fontFamily, size: 11 } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: fontFamily, size: 11 }, callback: v => formatCurrency(v) } }
        }
      }
    }));
  }
}

function openAddAlternative(prefill = null) {
  const isEdit = !!prefill;
  const a = prefill || {};

  openModal(isEdit ? 'Editar activo alternativo' : 'Nuevo activo alternativo', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nombre del activo</label>
        <input type="text" id="f-alt-name" class="text-input" placeholder="Ej: Rolex Submariner" value="${escapeHtml(a.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Categoría</label>
        <select id="f-alt-category" class="select-input">
          ${['Relojería', 'Arte', 'Inmueble', 'Joyería', 'Vehículo', 'Coleccionismo', 'Criptomonedas', 'Vino', 'Otro']
            .map(c => `<option value="${c}" ${a.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Precio de compra (€)</label>
        <input type="number" id="f-alt-buy" class="text-input" placeholder="0.00" value="${a.buyPrice || ''}" step="0.01" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Precio actual (€)</label>
        <input type="number" id="f-alt-current" class="text-input" placeholder="0.00" value="${a.currentPrice || ''}" step="0.01" min="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha de compra</label>
        <input type="date" id="f-alt-date" class="text-input" value="${a.purchaseDate || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Depreciación anual (%, opcional)</label>
        <input type="number" id="f-alt-dep" class="text-input" placeholder="Ej: 15 para vehículo" value="${a.depreciationPct || ''}" step="0.1" min="0" max="100" />
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Si se indica, el valor actual se calcula automáticamente</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notas</label>
      <input type="text" id="f-alt-notes" class="text-input" placeholder="Referencias, condición..." value="${escapeHtml(a.notes || '')}" />
    </div>
  `, () => {
    const name            = document.getElementById('f-alt-name').value.trim();
    const category        = document.getElementById('f-alt-category').value;
    const buyPrice        = parseFloat(document.getElementById('f-alt-buy').value) || 0;
    const currentPrice    = parseFloat(document.getElementById('f-alt-current').value) || 0;
    const purchaseDate    = document.getElementById('f-alt-date').value;
    const depreciationPct = parseFloat(document.getElementById('f-alt-dep').value) || 0;
    const notes           = document.getElementById('f-alt-notes').value.trim();

    if (!name) return showToast('El nombre es obligatorio', 'error');

    const entry = { ...(isEdit ? prefill : {}), id: isEdit ? prefill.id : generateId(), name, category, buyPrice, currentPrice, purchaseDate, notes };
    if (depreciationPct > 0) entry.depreciationPct = depreciationPct;
    else delete entry.depreciationPct;

    if (isEdit) {
      const idx = APP.alternatives.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.alternatives[idx] = entry;
      showToast('Activo actualizado ✓', 'success');
    } else {
      APP.alternatives.push(entry);
      showToast('Activo añadido ✓', 'success');
    }

    saveData();
    closeModal();
    renderAlternatives();
    if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  });
}

function editAlternative(id) {
  const a = APP.alternatives.find(x => x.id === id);
  if (a) openAddAlternative(a);
}

function deleteAlternative(id) {
  const alt = APP.alternatives.find(x => x.id === id);
  if (!alt) return;
  APP.alternatives = APP.alternatives.filter(x => x.id !== id);
  updateNetworthHistory();
  renderAlternatives();
  softDelete(`"${alt.name}" eliminado`, () => {
    APP.alternatives.push(alt);
    saveData();
    renderAlternatives();
  });
}

/* ═══════════════════════════════════════════════════════════════
   PASIVOS & DEUDAS
═══════════════════════════════════════════════════════════════ */

const LIABILITY_LABELS = { hipoteca: 'Hipoteca', prestamo: 'Préstamo', tarjeta: 'Tarjeta crédito', otro: 'Otro' };

function renderPasivos() {
  _delegate('section-pasivos', {
    'edit-liab':   id => editLiability(id),
    'delete-liab': id => deleteLiability(id),
  });
  const tbody        = document.getElementById('liabilities-tbody');
  if (!tbody) return;

  const liabilities  = APP.liabilities || [];
  const total        = calcLiabilitiesTotal();
  const totalMonthly = liabilities.reduce((s, l) => s + (parseFloat(l.monthlyPayment) || 0), 0);
  const totalAssets  = calcCashTotal() + calcPortfolioValue() + calcAlternativesTotal() + calcPropertiesTotal();
  const ratio        = totalAssets > 0 ? (total / totalAssets) * 100 : 0;

  setText('liab-total',   formatCurrency(total));
  setText('liab-monthly', formatCurrency(totalMonthly));
  const ratioEl = document.getElementById('liab-ratio');
  if (ratioEl) { ratioEl.textContent = ratio.toFixed(1) + '%'; ratioEl.className = 'kpi-value ' + (ratio > 50 ? 'negative' : ratio > 25 ? '' : 'positive'); }

  if (liabilities.length === 0) {
    tbody.innerHTML = emptyRow(8, '📋', 'Sin pasivos registrados',
      'Añade hipotecas, préstamos o deudas para visualizar tu nivel de endeudamiento.',
      '+ Añadir pasivo', 'openAddLiability()');
    return;
  }

  tbody.innerHTML = liabilities.map(l => {
    const paidPct = l.originalAmount > 0 ? Math.min(((l.originalAmount - l.remainingAmount) / l.originalAmount) * 100, 100) : 0;
    return `
      <tr data-id="${l.id}">
        <td><strong>${escapeHtml(l.name)}</strong>
          ${l.notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(l.notes)}</div>` : ''}
        </td>
        <td><span class="ticker-chip">${LIABILITY_LABELS[l.type] || escapeHtml(l.type)}</span></td>
        <td class="text-right">${formatCurrency(l.originalAmount)}</td>
        <td class="text-right negative" style="font-weight:600">${formatCurrency(l.remainingAmount)}</td>
        <td class="text-right">${formatCurrency(l.monthlyPayment)}/mes</td>
        <td class="text-right">${l.interestRate ? l.interestRate + '%' : '—'}</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="breakdown-track" style="width:60px;flex-shrink:0">
              <div class="breakdown-fill" style="width:${paidPct.toFixed(0)}%;background:#3ddc84"></div>
            </div>
            <span style="font-size:11px;color:var(--text-muted)">${paidPct.toFixed(0)}%</span>
          </div>
        </td>
        <td>
          <div class="action-buttons">
            <button class="btn-edit btn-icon" data-action="edit-liab" aria-label="Editar ${escapeHtml(l.name)}">✎</button>
            <button class="btn-danger btn-icon" data-action="delete-liab" aria-label="Eliminar ${escapeHtml(l.name)}">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddLiability(prefill = null) {
  const isEdit = !!prefill;
  const l = prefill || {};

  openModal(isEdit ? 'Editar pasivo' : 'Añadir deuda', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nombre</label>
        <input type="text" id="f-l-name" class="text-input" placeholder="Ej: Hipoteca vivienda" value="${escapeHtml(l.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Tipo</label>
        <select id="f-l-type" class="select-input">
          <option value="hipoteca" ${(l.type||'hipoteca')==='hipoteca' ? 'selected' : ''}>Hipoteca</option>
          <option value="prestamo" ${l.type==='prestamo' ? 'selected' : ''}>Préstamo</option>
          <option value="tarjeta"  ${l.type==='tarjeta'  ? 'selected' : ''}>Tarjeta crédito</option>
          <option value="otro"     ${l.type==='otro'     ? 'selected' : ''}>Otro</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Importe original (€)</label>
        <input type="number" id="f-l-original" class="text-input" placeholder="0.00" value="${l.originalAmount || ''}" step="0.01" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Saldo pendiente (€)</label>
        <input type="number" id="f-l-remaining" class="text-input" placeholder="0.00" value="${l.remainingAmount || ''}" step="0.01" min="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Cuota mensual (€)</label>
        <input type="number" id="f-l-monthly" class="text-input" placeholder="0.00" value="${l.monthlyPayment || ''}" step="0.01" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Tipo de interés anual (%)</label>
        <input type="number" id="f-l-rate" class="text-input" placeholder="Ej: 3.5" value="${l.interestRate || ''}" step="0.01" min="0" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <input type="text" id="f-l-notes" class="text-input" placeholder="Banco, referencia..." value="${escapeHtml(l.notes || '')}" />
    </div>
  `, () => {
    const name            = document.getElementById('f-l-name').value.trim();
    const type            = document.getElementById('f-l-type').value;
    const originalAmount  = parseFloat(document.getElementById('f-l-original').value) || 0;
    const remainingAmount = parseFloat(document.getElementById('f-l-remaining').value) || 0;
    const monthlyPayment  = parseFloat(document.getElementById('f-l-monthly').value) || 0;
    const interestRate    = parseFloat(document.getElementById('f-l-rate').value) || 0;
    const notes           = document.getElementById('f-l-notes').value.trim();

    if (!name) return showToast('El nombre es obligatorio', 'error');

    if (!APP.liabilities) APP.liabilities = [];
    if (isEdit) {
      const idx = APP.liabilities.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.liabilities[idx] = { ...prefill, name, type, originalAmount, remainingAmount, monthlyPayment, interestRate, notes };
      showToast('Pasivo actualizado ✓', 'success');
    } else {
      APP.liabilities.push({ id: generateId(), name, type, originalAmount, remainingAmount, monthlyPayment, interestRate, notes });
      showToast('Pasivo añadido ✓', 'success');
    }

    saveData();
    closeModal();
    renderPasivos();
    if (APP.activeSection === SECTIONS.NETWORTH)  renderNetworth();
    if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  });
}

function editLiability(id) {
  const l = (APP.liabilities || []).find(x => x.id === id);
  if (l) openAddLiability(l);
}

function deleteLiability(id) {
  const liab = (APP.liabilities || []).find(x => x.id === id);
  if (!liab) return;
  APP.liabilities = (APP.liabilities || []).filter(x => x.id !== id);
  updateNetworthHistory();
  renderPasivos();
  if (APP.activeSection === SECTIONS.NETWORTH)  renderNetworth();
  if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  softDelete(`Pasivo "${liab.name}" eliminado`, () => {
    if (!APP.liabilities) APP.liabilities = [];
    APP.liabilities.push(liab);
    saveData();
    renderPasivos();
    if (APP.activeSection === SECTIONS.NETWORTH)  renderNetworth();
    if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
  });
}
