/* ═══════════════════════════════════════════════════════════════
   FINOVA — bizums.js
   Estructura: { id, date, person, concept, direction:'in'|'out',
                 amount, status:'pending'|'done' }
   direction 'in'  = te deben (positivo para ti)
   direction 'out' = debes tú (negativo para ti)
═══════════════════════════════════════════════════════════════ */

function renderBizums() {
  _delegate('section-bizums', {
    'mark-biz':   id => markBizumDone(id),
    'edit-biz':   id => editBizum(id),
    'delete-biz': id => deleteBizum(id),
  });
  updateBizumKPIs();
  renderBizumTable();
  renderBizumByPerson();
  populateBizumPersonFilter();
}

function updateBizumKPIs() {
  const bizums = APP.bizums;

  const pendingIn  = bizums.filter(b => b.direction === 'in'  && b.status === 'pending');
  const pendingOut = bizums.filter(b => b.direction === 'out' && b.status === 'pending');

  const totalIn  = pendingIn.reduce((s, b)  => s + b.amount, 0);
  const totalOut = pendingOut.reduce((s, b) => s + b.amount, 0);
  const balance  = totalIn - totalOut;

  const balEl = document.getElementById('biz-balance');
  if (balEl) {
    balEl.textContent = formatCurrency(balance, true);
    balEl.className   = 'kpi-value ' + colorClass(balance);
  }
  setText('biz-pending-in',        formatCurrency(totalIn));
  setText('biz-pending-out',       formatCurrency(totalOut));
  setText('biz-pending-in-count',  `${pendingIn.length} bizum${pendingIn.length !== 1 ? 's' : ''}`);
  setText('biz-pending-out-count', `${pendingOut.length} bizum${pendingOut.length !== 1 ? 's' : ''}`);
}

function renderBizumTable() {
  const tbody = document.getElementById('bizums-tbody');
  if (!tbody) return;

  const dirFilter    = document.getElementById('biz-filter-dir')?.value    || 'all';
  const statusFilter = document.getElementById('biz-filter-status')?.value || 'all';
  const personFilter = document.getElementById('biz-filter-person')?.value || 'all';

  let list = [...APP.bizums].sort((a, b) => b.date.localeCompare(a.date));
  if (dirFilter    !== 'all') list = list.filter(b => b.direction === dirFilter);
  if (statusFilter !== 'all') list = list.filter(b => b.status    === statusFilter);
  if (personFilter !== 'all') list = list.filter(b => b.person    === personFilter);

  if (list.length === 0) {
    tbody.innerHTML = emptyRow(7, '⇄', 'Sin bizums',
      'Lleva el control de lo que te deben y lo que debes a tus amigos.',
      '+ Añadir bizum', 'openAddBizum()');
    return;
  }

  tbody.innerHTML = list.map(b => {
    const isIn      = b.direction === 'in';
    const isPending = b.status === 'pending';
    const amtClass  = isIn ? 'positive' : 'negative';
    const amtSign   = isIn ? '+' : '-';

    return `
      <tr data-id="${b.id}">
        <td>${formatDate(b.date)}</td>
        <td><strong>${escapeHtml(b.person)}</strong></td>
        <td>${escapeHtml(b.concept)}</td>
        <td><span class="badge badge-${isIn ? 'in' : 'out'}">${isIn ? '↓ Me deben' : '↑ Debo yo'}</span></td>
        <td class="text-right ${amtClass}"><span class="pvt">${amtSign}${formatCurrency(b.amount)}</span></td>
        <td><span class="badge badge-${isPending ? 'pending' : 'done'}">${isPending ? 'Pendiente' : (isIn ? 'Cobrado' : 'Pagado')}</span></td>
        <td>
          <div class="action-buttons">
            ${isPending ? `<button class="btn-mark" data-action="mark-biz" aria-label="Marcar cobrado/pagado">✓ ${isIn ? 'Cobrado' : 'Pagado'}</button>` : ''}
            <button class="btn-edit btn-icon" data-action="edit-biz" aria-label="Editar bizum con ${escapeHtml(b.person)}">✎</button>
            <button class="btn-danger btn-icon" data-action="delete-biz" aria-label="Eliminar bizum con ${escapeHtml(b.person)}">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderBizumByPerson() {
  const el = document.getElementById('biz-by-person');
  if (!el) return;

  const byPerson = {};
  APP.bizums
    .filter(b => b.status === 'pending')
    .forEach(b => {
      if (!byPerson[b.person]) byPerson[b.person] = 0;
      byPerson[b.person] += b.direction === 'in' ? b.amount : -b.amount;
    });

  const entries = Object.entries(byPerson).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  if (entries.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Sin pendientes</div>';
    return;
  }

  el.innerHTML = `<div class="biz-person-list">` + entries.map(([person, balance]) => {
    const cls      = colorClass(balance);
    const label    = balance > 0 ? 'Te debe' : 'Le debes';
    const initials = person.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `
      <div class="biz-person-item">
        <div class="biz-person-avatar">${escapeHtml(initials)}</div>
        <div>
          <div class="biz-person-name">${escapeHtml(person)}</div>
          <div class="biz-person-detail">${label} (pendiente)</div>
        </div>
        <div class="biz-person-amount ${cls}"><span class="pvt">${formatCurrency(Math.abs(balance))}</span></div>
      </div>
    `;
  }).join('') + `</div>`;
}

function populateBizumPersonFilter() {
  const sel = document.getElementById('biz-filter-person');
  if (!sel) return;
  const people = [...new Set(APP.bizums.map(b => b.person))].sort();
  sel.innerHTML = '<option value="all">Todas las personas</option>' +
    people.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
}

/* ─── CRUD Bizums ────────────────────────────────────────────── */

function openAddBizum(prefill = null) {
  const isEdit = !!prefill;
  const b = prefill || { date: getTodayStr(), direction: 'in', status: 'pending' };

  openModal(isEdit ? 'Editar bizum' : 'Nuevo bizum', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Persona</label>
        <input type="text" id="f-biz-person" class="text-input" placeholder="Nombre o apellido" value="${escapeHtml(b.person || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha</label>
        <input type="date" id="f-biz-date" class="text-input" value="${b.date || getTodayStr()}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Concepto</label>
      <input type="text" id="f-biz-concept" class="text-input" placeholder="Ej: Cena del viernes" value="${escapeHtml(b.concept || '')}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Dirección</label>
        <select id="f-biz-dir" class="select-input">
          <option value="in"  ${b.direction === 'in'  ? 'selected' : ''}>↓ Me deben (positivo)</option>
          <option value="out" ${b.direction === 'out' ? 'selected' : ''}>↑ Debo yo (negativo)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Importe (€)</label>
        <input type="number" id="f-biz-amount" class="text-input" placeholder="0.00" value="${b.amount || ''}" step="0.01" min="0" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Estado</label>
      <select id="f-biz-status" class="select-input">
        <option value="pending" ${b.status === 'pending' ? 'selected' : ''}>Pendiente</option>
        <option value="done"    ${b.status === 'done'    ? 'selected' : ''}>Cobrado / Pagado</option>
      </select>
    </div>
  `, () => {
    const person    = document.getElementById('f-biz-person').value.trim();
    const date      = document.getElementById('f-biz-date').value;
    const concept   = document.getElementById('f-biz-concept').value.trim();
    const direction = document.getElementById('f-biz-dir').value;
    const amount    = parseFloat(document.getElementById('f-biz-amount').value);
    const status    = document.getElementById('f-biz-status').value;

    if (!person)                   return showToast('El nombre es obligatorio', 'error');
    if (!date)                     return showToast('La fecha es obligatoria', 'error');
    if (!concept)                  return showToast('El concepto es obligatorio', 'error');
    if (isNaN(amount) || amount <= 0) return showToast('El importe debe ser positivo', 'error');

    if (isEdit) {
      const idx = APP.bizums.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.bizums[idx] = { ...prefill, person, date, concept, direction, amount, status };
      showToast('Bizum actualizado ✓', 'success');
    } else {
      APP.bizums.push({ id: generateId(), person, date, concept, direction, amount, status });
      showToast('Bizum añadido ✓', 'success');
    }

    saveData();
    closeModal();
    renderBizums();
  });
}

function editBizum(id) {
  const b = APP.bizums.find(x => x.id === id);
  if (b) openAddBizum(b);
}

function deleteBizum(id) {
  const biz = APP.bizums.find(x => x.id === id);
  if (!biz) return;
  APP.bizums = APP.bizums.filter(x => x.id !== id);
  renderBizums();
  softDelete(`Bizum con "${biz.person}" eliminado`, () => {
    APP.bizums.push(biz);
    saveData();
    renderBizums();
  });
}

function markBizumDone(id) {
  const b = APP.bizums.find(x => x.id === id);
  if (!b) return;
  b.status = 'done';
  saveData();
  renderBizums();
  showToast(b.direction === 'in' ? '¡Cobrado! ✓' : '¡Pagado! ✓', 'success');
}

function loadDemoBizums() {
  const today    = getTodayStr();
  const thisYear = new Date().getFullYear();
  APP.bizums = [
    { id: generateId(), person: 'Carlos',  date: `${thisYear}-01-15`, concept: 'Cena cumpleaños',     direction: 'in',  amount: 32.50, status: 'pending' },
    { id: generateId(), person: 'Laura',   date: `${thisYear}-02-03`, concept: 'Gasolina viaje',      direction: 'out', amount: 45.00, status: 'pending' },
    { id: generateId(), person: 'Miguel',  date: `${thisYear}-02-20`, concept: 'Entradas concierto',  direction: 'in',  amount: 60.00, status: 'done'    },
    { id: generateId(), person: 'Carlos',  date: `${thisYear}-03-10`, concept: 'Compra supermercado', direction: 'out', amount: 18.75, status: 'pending' },
    { id: generateId(), person: 'Ana',     date: today,               concept: 'Cena del viernes',   direction: 'in',  amount: 27.00, status: 'pending' },
  ];
}
