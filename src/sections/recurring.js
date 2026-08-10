/* ═══════════════════════════════════════════════════════════════
   FINOVA — recurring.js
   Sección: Transacciones Recurrentes
═══════════════════════════════════════════════════════════════ */
'use strict';

const RECURRING_FREQ_LABELS = {
  weekly:    'Semanal',
  biweekly:  'Quincenal',
  monthly:   'Mensual',
  quarterly: 'Trimestral',
  annual:    'Anual',
};

let _recurringConfirmShown = false;

function _recFreqChange(val) {
  const w = document.getElementById('f-rec-renewal-wrap');
  if (w) w.style.display = val === 'monthly' ? '' : 'none';
}

function _recRenewalDayInput(val) {
  const day = parseInt(val);
  if (!day || day < 1 || day > 28) return;
  const today = new Date();
  const m = today.getDate() <= day ? today.getMonth() : today.getMonth() + 1;
  const target = new Date(today.getFullYear(), m, day);
  const el = document.getElementById('f-rec-date');
  if (el) el.value = target.toISOString().slice(0, 10);
}

function _checkAndOfferAutoApply() {
  if (_recurringConfirmShown) return;
  const today = getTodayStr();
  const due = (APP.recurring || []).filter(r => r.active && r.nextDate && r.nextDate <= today);
  if (!due.length) return;
  _recurringConfirmShown = true;

  // Auto-apply silently — no confirmation needed
  due.forEach(r => applyRecurring(r.id, true));

  const names = due.slice(0, 2).map(r => escapeHtml(r.description)).join(', ');
  const extra = due.length > 2 ? ` y ${due.length - 2} más` : '';
  showToast(`⟳ ${due.length} recurrente${due.length > 1 ? 's registrados' : ' registrado'} automáticamente: ${names}${extra}`, 'success');
}

function renderRecurring() {
  _delegate('section-recurring', {
    'edit-rec':    id => editRecurring(id),
    'delete-rec':  id => deleteRecurring(id),
    'apply-rec':   id => applyRecurring(id),
    'toggle-rec':  id => toggleRecurringActive(id),
  });

  const el = document.getElementById('recurring-list');
  if (!el) return;

  if (!APP.recurring || APP.recurring.length === 0) {
    el.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 20px;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:12px">⟳</div>
        <div style="font-size:15px;font-weight:500;margin-bottom:6px">Sin plantillas recurrentes</div>
        <div style="font-size:13px;margin-bottom:18px">Crea plantillas para gastos o ingresos que se repiten (alquiler, nómina, suscripciones…)</div>
        <button class="btn-primary" onclick="openAddRecurring()">+ Añadir recurrente</button>
      </div>`;
    return;
  }

  const FREQ_TO_MONTHLY = { weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1/3, annual: 1/12 };
  const active = (APP.recurring || []).filter(r => r.active);
  const monthlyIncome  = active.filter(r => r.type === 'income').reduce((s, r) => s + r.amount * (FREQ_TO_MONTHLY[r.frequency] || 1), 0);
  const monthlyExpense = active.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount * (FREQ_TO_MONTHLY[r.frequency] || 1), 0);
  const monthlyBalance = monthlyIncome - monthlyExpense;

  el.innerHTML = `
    <div class="rec-summary-bar">
      <div class="rec-summary-item"><span class="rec-summary-label">Ingresos/mes</span><span class="rec-summary-val positive">${formatCurrency(monthlyIncome)}</span></div>
      <div class="rec-summary-item"><span class="rec-summary-label">Gastos/mes</span><span class="rec-summary-val negative">${formatCurrency(monthlyExpense)}</span></div>
      <div class="rec-summary-item"><span class="rec-summary-label">Balance/mes</span><span class="rec-summary-val ${monthlyBalance >= 0 ? 'positive' : 'negative'}">${formatCurrency(monthlyBalance)}</span></div>
    </div>
    <div class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th>Descripción</th>
            <th>Categoría</th>
            <th>Tipo</th>
            <th class="text-right">Importe</th>
            <th>Frecuencia</th>
            <th>Próxima fecha</th>
            <th>Activo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${(APP.recurring || []).map(r => {
            const overdue = r.active && r.nextDate && r.nextDate <= getTodayStr();
            return `
            <tr data-id="${r.id}" class="${r.active ? (overdue ? 'rec-overdue' : '') : 'rec-inactive'}" tabindex="0">
              <td><strong>${escapeHtml(r.description)}</strong>${overdue ? ' <span class="rec-due-badge">pendiente</span>' : ''}</td>
              <td><span class="cat-chip">${escapeHtml(r.category)}</span></td>
              <td><span class="badge badge-${r.type}">${r.type === 'income' ? 'Ingreso' : 'Gasto'}</span></td>
              <td class="text-right ${r.type === 'income' ? 'positive' : 'negative'}">${formatCurrency(r.amount)}</td>
              <td>${RECURRING_FREQ_LABELS[r.frequency] || r.frequency}${r.frequency === 'monthly' && r.renewalDay ? `<br><span style="font-size:11px;color:var(--text-muted)">día ${r.renewalDay}</span>` : ''}</td>
              <td${overdue ? ' style="color:var(--down);font-weight:600"' : ''}>${(() => {
                if (!r.nextDate) return '—';
                const diff = Math.ceil((new Date(r.nextDate + 'T00:00:00') - new Date()) / 86400000);
                const label = diff < 0 ? ` <span class="rec-due-days negative">hace ${-diff}d</span>` :
                              diff === 0 ? ` <span class="rec-due-days" style="color:var(--accent)">hoy</span>` :
                              diff <= 7  ? ` <span class="rec-due-days" style="color:var(--text-muted)">en ${diff}d</span>` : '';
                return formatDate(r.nextDate) + label;
              })()}</td>
              <td>
                <button class="btn-icon rec-status-btn" data-action="toggle-rec"
                  title="${r.active ? 'Pausar' : 'Activar'}"
                  aria-label="${overdue ? 'Vencida — pulsa para reactivar' : r.active ? 'Activa — pulsa para pausar' : 'Pausada — pulsa para activar'}">
                  ${overdue ? '<span class="rec-status-badge rec-status--overdue">⚠ Vencida</span>'
                             : r.active ? '<span class="rec-status-badge rec-status--active">● Activa</span>'
                                        : '<span class="rec-status-badge rec-status--paused">⏸ Pausada</span>'}
                </button>
              </td>
              <td>
                <div class="action-buttons">
                  <button class="btn-secondary btn-sm" data-action="apply-rec" title="Registrar como transacción hoy">Registrar</button>
                  <button class="btn-edit btn-icon" data-action="edit-rec">✎</button>
                  <button class="btn-danger btn-icon" data-action="delete-rec">✕</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const recTbody = el.querySelector('tbody');
  if (recTbody && !recTbody._kbNav) {
    recTbody._kbNav = true;
    recTbody.addEventListener('keydown', _tableKeydown);
  }

  setTimeout(_checkAndOfferAutoApply, 0);
}

function openAddRecurring(prefill = null) {
  const isEdit = !!prefill;
  const r = prefill || {};
  const allCats = [...APP.categories.income, ...APP.categories.expense];
  const catOptions = allCats.map(c => `<option value="${escapeHtml(c)}" ${r.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  openModal(isEdit ? 'Editar recurrente' : 'Nueva transacción recurrente', `
    <div class="form-group">
      <label class="form-label">Descripción *</label>
      <input type="text" id="f-rec-desc" class="text-input" placeholder="Ej: Alquiler, Nómina, Netflix…" value="${escapeHtml(r.description || '')}" />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Tipo</label>
        <select id="f-rec-type" class="select-input">
          <option value="expense" ${(r.type || 'expense') === 'expense' ? 'selected' : ''}>Gasto</option>
          <option value="income"  ${r.type === 'income' ? 'selected' : ''}>Ingreso</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Importe (€) *</label>
        <input type="number" id="f-rec-amount" class="text-input" placeholder="0.00" value="${r.amount || ''}" step="0.01" min="0" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Categoría</label>
      <select id="f-rec-cat" class="select-input">${catOptions}</select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Frecuencia</label>
        <select id="f-rec-freq" class="select-input" onchange="_recFreqChange(this.value)">
          ${Object.entries(RECURRING_FREQ_LABELS).map(([v, l]) => `<option value="${v}" ${(r.frequency || 'monthly') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="f-rec-renewal-wrap" ${(r.frequency || 'monthly') !== 'monthly' ? 'style="display:none"' : ''}>
        <label class="form-label">Día de renovación</label>
        <input type="number" id="f-rec-renewal" class="text-input" placeholder="1 – 28" min="1" max="28" value="${r.renewalDay || ''}" oninput="_recRenewalDayInput(this.value)" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Próxima fecha</label>
      <input type="date" id="f-rec-date" class="text-input" value="${r.nextDate || getTodayStr()}" />
    </div>
  `, () => {
    const description = document.getElementById('f-rec-desc').value.trim();
    const type        = document.getElementById('f-rec-type').value;
    const amount      = parseFloat(document.getElementById('f-rec-amount').value) || 0;
    const category    = document.getElementById('f-rec-cat').value;
    const frequency   = document.getElementById('f-rec-freq').value;
    const nextDate    = document.getElementById('f-rec-date').value;
    const renewalDay  = frequency === 'monthly' ? (parseInt(document.getElementById('f-rec-renewal').value) || null) : null;

    if (!description) return showToast('La descripción es obligatoria', 'error');
    if (!_validateTextInput(description, 'La descripción')) return;
    if (!amount)      return showToast('El importe debe ser mayor que 0', 'error');

    const entry = { ...(r.id ? r : {}), id: r.id || generateId(), description, type, amount, category, frequency, nextDate, renewalDay, active: r.active !== false };

    if (!APP.recurring) APP.recurring = [];
    if (isEdit) {
      const idx = APP.recurring.findIndex(x => x.id === r.id);
      if (idx >= 0) APP.recurring[idx] = entry;
      showToast('Recurrente actualizado ✓', 'success');
    } else {
      APP.recurring.push(entry);
      showToast('Recurrente añadido ✓', 'success');
    }
    saveData();
    closeModal();
    renderRecurring();
  });
}

function editRecurring(id) {
  const r = (APP.recurring || []).find(x => x.id === id);
  if (r) openAddRecurring(r);
}

function deleteRecurring(id) {
  const r = (APP.recurring || []).find(x => x.id === id);
  if (!r) return;
  APP.recurring = APP.recurring.filter(x => x.id !== id);
  saveData();
  renderRecurring();
  softDelete(`"${r.description}" eliminado`, () => {
    APP.recurring.push(r);
    saveData();
    renderRecurring();
  });
}

function toggleRecurringActive(id) {
  const r = (APP.recurring || []).find(x => x.id === id);
  if (!r) return;
  r.active = !r.active;
  saveData();
  renderRecurring();
}

function applyRecurring(id, silent = false) {
  const r = (APP.recurring || []).find(x => x.id === id);
  if (!r) return;

  const tx = {
    id: generateId(),
    type: r.type,
    date: getTodayStr(),
    description: r.description,
    category: r.category,
    amount: r.amount,
    recurringId: r.id,
  };
  APP.transactions.push(tx);

  // Flush save now — if storage is full, roll back the transaction and stop
  const saved = _debouncedSaveNow.flush();
  if (saved === false) {
    APP.transactions.pop();
    return;
  }

  // Advance nextDate only after the transaction was persisted
  if (r.nextDate) r.nextDate = _advanceRecurringDate(r.nextDate, r.frequency, r.renewalDay);
  saveData();
  renderRecurring();
  checkDueRecurring();
  if (APP.activeSection === SECTIONS.TRANSACTIONS) renderTransactions();
  if (APP.activeSection === SECTIONS.DASHBOARD)   renderDashboard();
  if (!silent) showToast(`"${r.description}" registrado ✓`, 'success');
}

function checkDueRecurring() {
  const today = getTodayStr();
  const due = (APP.recurring || []).filter(r => r.active && r.nextDate && r.nextDate <= today);
  const badge = document.getElementById('nav-badge-recurring');
  if (badge) {
    if (due.length > 0) { badge.textContent = due.length; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
  if (!due.length) return;
  const total = due.reduce((s, r) => s + r.amount, 0);
  const label = due.length === 1
    ? `"${due[0].description}"`
    : `${due.length} transacciones recurrentes`;
  showToast(`⟳ ${label} pendiente${due.length > 1 ? 's' : ''} de registrar — ${formatCurrency(total)} en Recurrentes`, 'info');
}
