/* ═══════════════════════════════════════════════════════════════
   FINOVA — trips.js
   Sección: Viajes — agrupa gastos de transacciones reales por viaje.
   El gasto de un viaje NUNCA se guarda en APP.trips: se calcula siempre
   a partir de APP.transactions filtrando por tripId (campo opcional,
   solo en gastos). Borrar un viaje nunca borra transacciones — solo
   quita el vínculo tripId, los datos financieros se conservan.
═══════════════════════════════════════════════════════════════ */

function _tripTransactions(tripId) {
  return APP.transactions.filter(t => t.type === 'expense' && t.tripId === tripId);
}

function calcTripSpent(tripId) {
  return _tripTransactions(tripId).reduce((s, t) => s + t.amount, 0);
}

function _tripIsActive(trip) {
  return !trip.endDate || trip.endDate >= getTodayStr();
}

function _tripDateRangeLabel(trip) {
  if (trip.startDate && trip.endDate) return `${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}`;
  if (trip.startDate) return `Desde ${formatDate(trip.startDate)}`;
  if (trip.endDate)   return `Hasta ${formatDate(trip.endDate)}`;
  return '';
}

/* ─── Vista principal ─────────────────────────────────────────── */

function renderTrips() {
  _delegate('section-trips', {
    'view-trip':   id => openTripDetail(id),
    'edit-trip':   id => editTrip(id),
    'delete-trip': id => deleteTrip(id),
  });

  const grid = document.getElementById('trips-grid');
  const kpis = document.getElementById('trips-kpis');
  if (!grid) return;

  const trips = APP.trips || [];

  if (trips.length === 0) {
    grid.innerHTML = emptyState('✈', 'Sin viajes',
      'Crea un viaje y asígnalo a tus gastos desde el formulario de transacciones para llevar el control de lo que gastas en cada uno.',
      '+ Crear viaje', 'openAddTrip()');
    if (kpis) kpis.style.display = 'none';
    return;
  }
  if (kpis) kpis.style.display = '';

  const active       = trips.filter(_tripIsActive);
  const totalSpent   = trips.reduce((s, t) => s + calcTripSpent(t.id), 0);
  const withBudget   = trips.filter(t => t.budget > 0);
  const totalBudget  = withBudget.reduce((s, t) => s + t.budget, 0);

  setText('trip-kpi-active',       active.length);
  setText('trip-kpi-total-count',  `${trips.length} en total`);
  setText('trip-kpi-spent',        formatCurrency(totalSpent));
  setText('trip-kpi-budget',       formatCurrency(totalBudget));
  setText('trip-kpi-budget-sub',   `${withBudget.length} viaje${withBudget.length !== 1 ? 's' : ''} con presupuesto definido`);

  const sorted = [...trips].sort((a, b) => (b.startDate || b.createdAt || '').localeCompare(a.startDate || a.createdAt || ''));

  grid.innerHTML = sorted.map(trip => {
    const spent    = calcTripSpent(trip.id);
    const txCount  = _tripTransactions(trip.id).length;
    const hasBudget = trip.budget > 0;
    const pct      = hasBudget ? Math.min((spent / trip.budget) * 100, 100) : 0;
    const over     = hasBudget && spent > trip.budget;
    const isActive = _tripIsActive(trip);
    const dateLabel = _tripDateRangeLabel(trip);

    return `
      <div class="trip-card${!isActive ? ' trip-card--past' : ''}" data-id="${escapeHtml(trip.id)}" data-action="view-trip" role="button" tabindex="0" aria-label="Ver detalle de ${escapeHtml(trip.name)}">
        <div class="trip-card-actions">
          <button class="btn-edit btn-icon" data-action="edit-trip" aria-label="Editar viaje ${escapeHtml(trip.name)}">✎</button>
          <button class="btn-danger btn-icon" data-action="delete-trip" aria-label="Eliminar viaje ${escapeHtml(trip.name)}">✕</button>
        </div>
        <span class="trip-emoji">${escapeHtml(trip.emoji || '✈')}</span>
        <div class="trip-name">${escapeHtml(trip.name)}</div>
        ${trip.destination ? `<div class="trip-dest">${escapeHtml(trip.destination)}</div>` : ''}
        ${dateLabel ? `<div class="trip-dates">${dateLabel}</div>` : ''}
        <div class="trip-amounts">
          <div class="trip-current">${formatCurrency(spent)}</div>
          ${hasBudget ? `<div class="trip-target">de ${formatCurrency(trip.budget)}</div>` : `<div class="trip-target">sin presupuesto</div>`}
        </div>
        ${hasBudget ? `
          <div class="trip-bar">
            <div class="trip-bar-fill${over ? ' trip-bar-fill--over' : ''}" style="width:0%" data-pct="${pct.toFixed(2)}"></div>
          </div>
          <div class="trip-pct ${over ? 'trip-pct--over' : ''}">${over ? `${formatCurrency(spent - trip.budget)} por encima` : `${pct.toFixed(0)}% del presupuesto`}</div>
        ` : ''}
        <div class="trip-tx-count">${txCount} transacción${txCount !== 1 ? 'es' : ''}</div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    grid.querySelectorAll('.trip-bar-fill[data-pct]').forEach(el => {
      el.style.width = parseFloat(el.dataset.pct) + '%';
    });
  });

  // .trip-card es un <div role="button"> (no un <button> real, porque anida
  // sus propios botones de editar/eliminar) — _delegate solo escucha clicks,
  // así que Enter/Espacio necesitan su propio manejador para ser accesible.
  grid.querySelectorAll('.trip-card').forEach(card => {
    card.addEventListener('keydown', e => {
      if (e.target.closest('button')) return; // deja que el propio botón gestione su tecla
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTripDetail(card.dataset.id); }
    });
  });
}

/* ─── Selector de emoji ──────────────────────────────────────── */
// Reutiliza el componente .emoji-picker-* ya existente (usado por el
// selector de icono de las alertas personalizadas en el dashboard) — mismas
// clases y mismo patrón de apertura/cierre, solo con ids e id del conjunto
// de emojis propios de Viajes. _toggleEmojiPicker()/_selectAlertEmoji() de
// dashboard.js están codificados a los ids de esa alerta en concreto, así
// que no son reutilizables tal cual; estas son su equivalente para Viajes.
const TRIP_EMOJI_SET = [
  '✈️','🏖️','🏔️','🗺️','🧳','🌍','🌎','🌏',
  '🚗','🚆','🚢','🏕️','🏨','🎒','🗽','🗼',
  '🏛️','🌄','🌅','🏝️','⛰️','🎡','🎢','📸',
];

function _toggleTripEmojiPicker() {
  const dd = document.getElementById('tripEmojiDropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'grid';
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener('click', function _close(e) {
        if (!document.getElementById('tripEmojiPickerWrap')?.contains(e.target)) {
          dd.style.display = 'none';
          document.removeEventListener('click', _close);
        }
      });
    }, 10);
  }
}

function _selectTripEmoji(emoji) {
  const trigger = document.getElementById('tripEmojiTrigger');
  const input   = document.getElementById('f-trip-emoji');
  if (trigger) trigger.textContent = emoji;
  if (input)   input.value = emoji;
  const dd = document.getElementById('tripEmojiDropdown');
  if (dd) dd.style.display = 'none';
}

/* ─── Crear / editar viaje ───────────────────────────────────── */

function openAddTrip(prefill = null) {
  const isEdit = !!prefill;
  const t = prefill || {};
  const initialEmoji = t.emoji || '✈️';

  openModal(isEdit ? 'Editar viaje' : 'Nuevo viaje', `
    <div class="form-row">
      <div class="form-group" style="flex:0 0 auto">
        <label class="form-label">Emoji</label>
        <div class="emoji-picker-wrap" id="tripEmojiPickerWrap">
          <button type="button" class="emoji-picker-trigger" id="tripEmojiTrigger" style="height:48px"
            onclick="_toggleTripEmojiPicker()" title="Elegir emoji">${escapeHtml(initialEmoji)}</button>
          <input type="hidden" id="f-trip-emoji" value="${escapeHtml(initialEmoji)}" />
          <div class="emoji-picker-dropdown" id="tripEmojiDropdown" style="display:none">
            ${TRIP_EMOJI_SET.map(em => `<button type="button" class="emoji-picker-item" onclick="_selectTripEmoji('${em}')">${em}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nombre *</label>
        <input type="text" id="f-trip-name" class="text-input" placeholder="Ej: Japón 2026" value="${escapeHtml(t.name || '')}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Destino</label>
      <input type="text" id="f-trip-dest" class="text-input" placeholder="Ej: Tokio y Kioto" value="${escapeHtml(t.destination || '')}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha de inicio</label>
        <input type="date" id="f-trip-start" class="text-input" value="${t.startDate || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de fin</label>
        <input type="date" id="f-trip-end" class="text-input" value="${t.endDate || ''}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Presupuesto (€) <span style="color:var(--text-muted);font-weight:400">— opcional</span></label>
      <input type="number" id="f-trip-budget" class="text-input" placeholder="0.00 = sin presupuesto" value="${t.budget || ''}" step="0.01" min="0" />
    </div>
    <div class="form-group">
      <label class="form-label">Notas</label>
      <textarea id="f-trip-notes" class="text-input" rows="2" placeholder="Detalles adicionales...">${escapeHtml(t.notes || '')}</textarea>
    </div>
  `, () => {
    const emoji       = document.getElementById('f-trip-emoji').value.trim() || '✈️';
    const name        = document.getElementById('f-trip-name').value.trim();
    const destination = document.getElementById('f-trip-dest').value.trim();
    const startDate   = document.getElementById('f-trip-start').value;
    const endDate     = document.getElementById('f-trip-end').value;
    const budget      = parseFloat(document.getElementById('f-trip-budget').value) || 0;
    const notes       = document.getElementById('f-trip-notes').value.trim();

    if (!name) return showToast('El nombre del viaje es obligatorio', 'error');
    if (!_validateTextInput(name, 'El nombre')) return;
    if (startDate && endDate && endDate < startDate) return showToast('La fecha de fin no puede ser anterior a la de inicio', 'error');
    if (budget < 0) return showToast('El presupuesto no puede ser negativo', 'error');

    if (!APP.trips) APP.trips = [];
    if (isEdit) {
      const idx = APP.trips.findIndex(x => x.id === t.id);
      if (idx >= 0) APP.trips[idx] = { ...t, emoji, name, destination, startDate, endDate, budget, notes };
      showToast('Viaje actualizado ✓', 'success');
    } else {
      APP.trips.push({ id: generateId(), emoji, name, destination, startDate, endDate, budget, notes, createdAt: getTodayStr() });
      showToast('Viaje creado ✓', 'success');
    }
    saveData();
    closeModal();
    renderTrips();
  });
}

function editTrip(id) {
  const trip = (APP.trips || []).find(t => t.id === id);
  if (trip) openAddTrip(trip);
}

function deleteTrip(id) {
  const trip = (APP.trips || []).find(t => t.id === id);
  if (!trip) return;
  const affectedIds = _tripTransactions(id).map(t => t.id);
  const card = document.querySelector(`.trip-card[data-id="${id}"]`);

  animateRowRemoval(card, () => {
    APP.trips = APP.trips.filter(t => t.id !== id);
    affectedIds.forEach(txId => {
      const tx = APP.transactions.find(t => t.id === txId);
      if (tx) delete tx.tripId;
    });
    saveData();
    renderTrips();
    if (APP.activeSection === SECTIONS.TRANSACTIONS) renderTransactions();
    softDelete(`"${trip.name}" eliminado — sus transacciones se conservan sin vincular`, () => {
      APP.trips.push(trip);
      affectedIds.forEach(txId => {
        const tx = APP.transactions.find(t => t.id === txId);
        if (tx) tx.tripId = id;
      });
      saveData();
      renderTrips();
      if (APP.activeSection === SECTIONS.TRANSACTIONS) renderTransactions();
    });
  });
}

/* ─── Detalle de viaje ───────────────────────────────────────── */

let _tripDetailId = null;

function openTripDetail(id) {
  const trip = (APP.trips || []).find(t => t.id === id);
  if (!trip) return;
  _tripDetailId = id;
  openModal(`${trip.emoji || '✈'} ${trip.name}`, _tripDetailHTML(), null, null);
  document.getElementById('modal')?.classList.add('modal-wide');
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
  _wireTripDetail();
  _modalOnClose = () => { _tripDetailId = null; };
}

function _tripDetailHTML() {
  const trip = (APP.trips || []).find(t => t.id === _tripDetailId);
  if (!trip) return '';

  const txs   = [..._tripTransactions(trip.id)].sort((a, b) => b.date.localeCompare(a.date));
  const spent = txs.reduce((s, t) => s + t.amount, 0);
  const hasBudget = trip.budget > 0;
  const remaining = hasBudget ? trip.budget - spent : null;
  const dateLabel = _tripDateRangeLabel(trip);

  const header = `
    <div class="cat-detail-period">${[trip.destination, dateLabel].filter(Boolean).map(escapeHtml).join(' · ') || 'Sin destino ni fechas definidas'}</div>
    ${trip.notes ? `<p style="font-size:13px;color:var(--text-secondary);margin:0 0 14px;line-height:1.5">${escapeHtml(trip.notes)}</p>` : ''}
  `;

  if (txs.length === 0) {
    return header + emptyState('📂', 'Sin gastos todavía',
      'Asigna este viaje a tus gastos desde el formulario de transacciones para verlos aquí.', '', '');
  }

  const stats = `
    <div class="cat-detail-summary">
      <div class="cat-detail-stats">
        <div class="cat-detail-stat">
          <span class="cat-detail-stat-label">Gastado</span>
          <span class="cat-detail-stat-val negative">${formatCurrency(spent)}</span>
        </div>
        ${hasBudget ? `
          <div class="cat-detail-stat">
            <span class="cat-detail-stat-label">Presupuesto</span>
            <span class="cat-detail-stat-val">${formatCurrency(trip.budget)}</span>
          </div>
          <div class="cat-detail-stat">
            <span class="cat-detail-stat-label">${remaining >= 0 ? 'Restante' : 'Exceso'}</span>
            <span class="cat-detail-stat-val ${remaining >= 0 ? 'positive' : 'negative'}">${formatCurrency(Math.abs(remaining))}</span>
          </div>
        ` : ''}
        <div class="cat-detail-stat">
          <span class="cat-detail-stat-label">Operaciones</span>
          <span class="cat-detail-stat-val">${txs.length}</span>
        </div>
      </div>
      ${hasBudget ? `
        <div class="trip-bar" style="margin-top:12px">
          <div class="trip-bar-fill${spent > trip.budget ? ' trip-bar-fill--over' : ''}" style="width:${Math.min((spent / trip.budget) * 100, 100)}%"></div>
        </div>
      ` : ''}
    </div>`;

  const byCat = {};
  txs.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = catEntries[0][1];
  const catBreakdown = `
    <div class="trip-cat-breakdown">
      <div class="cat-detail-group-title">Por categoría</div>
      ${catEntries.map(([cat, amt]) => `
        <div class="trip-cat-row">
          <div class="trip-cat-name">${escapeHtml(cat)}</div>
          <div class="trip-cat-bar-bg"><div class="trip-cat-bar-fill" style="width:${(amt / maxCat) * 100}%"></div></div>
          <div class="trip-cat-amt">${formatCurrency(amt)}</div>
        </div>`).join('')}
    </div>`;

  const byMonth = {};
  txs.forEach(t => { const m = t.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + t.amount; });
  const monthKeys = Object.keys(byMonth).sort();
  const monthlySummary = monthKeys.length > 1 ? `
    <div class="recap-stats" style="margin:14px 0">
      ${monthKeys.map(m => {
        const label = new Date(m + '-01').toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
        return `<span class="recap-item"><span class="recap-label">${escapeHtml(label)}</span><span class="recap-val">${formatCurrency(byMonth[m])}</span></span>`;
      }).join('')}
    </div>` : '';

  const table = `
    <div class="cat-detail-group-title" style="margin-top:18px">Transacciones</div>
    <div class="cat-detail-table-wrap">
      <table class="cat-detail-table">
        <thead><tr><th>Fecha</th><th>Concepto</th><th class="text-right">Importe</th><th></th></tr></thead>
        <tbody>${txs.map(_catDetailRowHTML).join('')}</tbody>
      </table>
    </div>`;

  return header + stats + catBreakdown + monthlySummary + table;
}

function _refreshTripDetail() {
  const body = document.getElementById('modalBody');
  if (!body || !_tripDetailId) return;
  const trip = (APP.trips || []).find(t => t.id === _tripDetailId);
  if (!trip) { closeModal(); return; }
  document.getElementById('modalTitle').textContent = `${trip.emoji || '✈'} ${trip.name}`;
  body.innerHTML = _tripDetailHTML();
  _wireTripDetail();
}

function _wireTripDetail() {
  _delegate('modalBody', {
    'cd-edit':   id => editTransaction(id),
    'cd-delete': id => _tripDetailDeleteTx(id),
  });
}

function _tripDetailDeleteTx(id) {
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
    _refreshTripDetail();
    softDelete(`"${tx.description}" eliminado`, () => {
      APP.transactions.push(tx);
      _applyTxCashImpact(tx, 1);
      saveData();
      if (APP.activeSection === SECTIONS.TRANSACTIONS) renderTransactions();
      renderDashboard();
      _refreshTripDetail();
    }, () => {
      if (tx.photoId) deletePhoto(tx.photoId);
    });
  });
}
