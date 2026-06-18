/* ═══════════════════════════════════════════════════════════════
   FINOVA — goals.js
   Sección 13: Objetivos financieros — render y CRUD
═══════════════════════════════════════════════════════════════ */

function _notifyGoalProgress(tx) {
  if (!APP.goals?.length) return;
  APP.goals.forEach(g => {
    if (!g.linkedCategory || g.linkedCategory !== tx.category) return;
    if (g.linkedType && g.linkedType !== tx.type) return;
    const since = g.linkedSince || g.createdAt || '1970-01-01';
    if (tx.date < since) return;
    const current = _calcGoalProgress(g);
    const pct = g.targetAmount > 0 ? Math.min(100, Math.round((current / g.targetAmount) * 100)) : null;
    const pctStr = pct !== null ? ` · ${pct}% completado` : '';
    showToast(`${g.emoji || '🎯'} ${escapeHtml(g.name)}: +${formatCurrency(tx.amount)}${pctStr}`, 'success');
  });
}

function _calcGoalProgress(g, txByCategory) {
  const contribTotal = (g.contributions || []).reduce((s, c) => s + c.amount, 0);
  let auto = 0;
  if (g.linkedAccount) {
    const acct = APP.cashAccounts.find(a => a.id === g.linkedAccount);
    auto = acct ? (acct.balance || 0) : 0;
  } else if (g.linkedCategory) {
    // linkedSince bounds the sum — without it, 2 years of "Viajes" spending
    // would appear as "ahorrado" toward a new Japan trip goal
    const since = g.linkedSince || g.createdAt || '1970-01-01';
    const pool = txByCategory
      ? (txByCategory.get(g.linkedCategory) || [])
      : APP.transactions.filter(t => t.category === g.linkedCategory);
    auto = pool
      .filter(t => (!g.linkedType || t.type === g.linkedType) && t.date >= since)
      .reduce((s, t) => {
        // When tracking both directions, use net flow: income adds, expense subtracts
        if (!g.linkedType) return s + (t.type === 'income' ? t.amount : -t.amount);
        return s + t.amount;
      }, 0);
  }
  return (g.currentAmount || 0) + contribTotal + auto;
}

function renderGoals() {
  _delegate('section-goals', {
    'edit-goal':   id => editGoal(id),
    'delete-goal': id => deleteGoal(id),
    'add-contrib': id => openContributions(id),
  });
  const grid = document.getElementById('goals-grid');
  if (!grid) return;

  const toolbar = document.getElementById('goals-toolbar');
  if (toolbar) toolbar.style.display = APP.goals.length > 1 ? '' : 'none';

  if (APP.goals.length === 0) {
    grid.innerHTML = emptyState('◎', 'Sin objetivos financieros',
      'Define metas de ahorro o inversión y haz seguimiento visual de tu progreso.',
      '+ Crear objetivo', 'openAddGoal()');
    return;
  }

  const avgSurplus = calcAvgMonthlySurplus();

  // Pre-index transactions by category: O(n) once instead of O(n) per goal
  const txByCategory = new Map();
  APP.transactions.forEach(t => {
    let bucket = txByCategory.get(t.category);
    if (!bucket) { bucket = []; txByCategory.set(t.category, bucket); }
    bucket.push(t);
  });

  const sortKey = document.getElementById('goals-sort-select')?.value || 'completion-desc';
  const sortedGoals = [...APP.goals].sort((a, b) => {
    const pa = _calcGoalProgress(a, txByCategory);
    const pb = _calcGoalProgress(b, txByCategory);
    const pcta = a.targetAmount > 0 ? pa / a.targetAmount : 0;
    const pctb = b.targetAmount > 0 ? pb / b.targetAmount : 0;
    if (sortKey === 'completion-desc') return pctb - pcta;
    if (sortKey === 'completion-asc')  return pcta - pctb;
    if (sortKey === 'name')            return (a.name || '').localeCompare(b.name || '');
    if (sortKey === 'deadline')        return (a.deadline || '9999').localeCompare(b.deadline || '9999');
    if (sortKey === 'remaining') {
      return (b.targetAmount - pb) - (a.targetAmount - pa);
    }
    return 0;
  });

  grid.innerHTML = sortedGoals.map(g => {
    const effectiveAmount = _calcGoalProgress(g, txByCategory);
    const pct       = g.targetAmount > 0 ? Math.min((effectiveAmount / g.targetAmount) * 100, 100) : 0;
    const remaining = g.targetAmount - effectiveAmount;
    const deadline  = g.deadline ? `Fecha límite: ${formatDate(g.deadline)}` : '';

    let sourceLabel = '';
    if (g.linkedAccount) {
      const acct = APP.cashAccounts.find(a => a.id === g.linkedAccount);
      if (acct) sourceLabel = `↔ ${escapeHtml(acct.name)}`;
    } else if (g.linkedCategory) {
      const since = g.linkedSince || g.createdAt;
      sourceLabel = `↔ ${escapeHtml(g.linkedCategory)}`
        + (g.linkedType ? ' · ' + (g.linkedType === 'income' ? 'ingresos' : 'gastos') : '')
        + (since ? ' · desde ' + formatDate(since) : '');
    }

    const contribCount = (g.contributions || []).length;
    const contribTotal = (g.contributions || []).reduce((s, c) => s + c.amount, 0);

    let monthlyNeeded = null;
    let onTrack       = false;
    let etaStr        = null;
    let noSavings     = false;

    if (remaining > 0) {
      const now = new Date();

      if (g.deadline) {
        const dl         = new Date(g.deadline + 'T00:00:00');
        const monthsLeft = (dl.getFullYear() - now.getFullYear()) * 12 + (dl.getMonth() - now.getMonth());
        if (monthsLeft > 0) {
          monthlyNeeded = remaining / monthsLeft;
          if (avgSurplus >= monthlyNeeded) {
            onTrack = true;
          } else if (avgSurplus > 0) {
            const eta = new Date(now.getFullYear(), now.getMonth() + Math.ceil(remaining / avgSurplus), 1);
            etaStr = eta.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
          } else {
            noSavings = true;
          }
        }
      }

      if (!monthlyNeeded && !etaStr && !noSavings) {
        if (avgSurplus > 0) {
          const eta = new Date(now.getFullYear(), now.getMonth() + Math.ceil(remaining / avgSurplus), 1);
          etaStr = eta.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        } else if (avgSurplus <= 0 && APP.transactions.length > 0) {
          noSavings = true;
        }
      }
    }

    let insightHtml = '';
    if (remaining > 0 && (monthlyNeeded !== null || etaStr || noSavings)) {
      insightHtml = `<div class="goal-insight">`;
      if (monthlyNeeded !== null) {
        if (onTrack) {
          insightHtml += `<div class="goal-insight-row goal-insight-ok">✓ Vas bien · necesitas <strong>${formatCurrency(monthlyNeeded)}/mes</strong> · tu ritmo: ~${formatCurrency(avgSurplus)}/mes</div>`;
        } else {
          insightHtml += `<div class="goal-insight-row">Necesitas <strong>${formatCurrency(monthlyNeeded)}/mes</strong> para llegar a tiempo</div>`;
          if (etaStr) {
            insightHtml += `<div class="goal-insight-row goal-insight-warn">A tu ritmo (~${formatCurrency(avgSurplus)}/mes) llegarías en <strong>${etaStr}</strong></div>`;
          } else if (noSavings) {
            insightHtml += `<div class="goal-insight-row goal-insight-warn">Con el ahorro actual no alcanzarías este objetivo</div>`;
          }
        }
      } else if (etaStr) {
        insightHtml += `<div class="goal-insight-row">A tu ritmo (~${formatCurrency(avgSurplus)}/mes) llegarías en <strong>${etaStr}</strong></div>`;
      } else if (noSavings) {
        insightHtml += `<div class="goal-insight-row goal-insight-warn">Registra ingresos y gastos para calcular tu ritmo de ahorro</div>`;
      }
      insightHtml += `</div>`;
    }

    const isComplete = pct >= 100;
    let daysLeft = null;
    let daysLeftCls = '';
    if (!isComplete && g.deadline) {
      daysLeft = Math.ceil((new Date(g.deadline + 'T00:00:00') - new Date()) / 86400000);
      daysLeftCls = daysLeft < 0 ? 'goal-days--overdue' : daysLeft <= 30 ? 'goal-days--urgent' : '';
    }
    return `
      <div class="goal-card${isComplete ? ' goal-card--complete' : ''}" data-id="${g.id}">
        <div class="goal-actions">
          <button class="btn-edit btn-icon" data-action="edit-goal" aria-label="Editar objetivo ${escapeHtml(g.name)}">✎</button>
          <button class="btn-danger btn-icon" data-action="delete-goal" aria-label="Eliminar objetivo ${escapeHtml(g.name)}">✕</button>
        </div>
        ${isComplete ? '<div class="goal-complete-badge">✓ Completado</div>' : ''}
        ${daysLeft !== null ? `<div class="goal-days-badge ${daysLeftCls}">${daysLeft < 0 ? `Venció hace ${-daysLeft}d` : daysLeft === 0 ? 'Vence hoy' : `${daysLeft}d restantes`}</div>` : ''}
        <span class="goal-emoji">${escapeHtml(g.emoji || '🎯')}</span>
        <div class="goal-name">${escapeHtml(g.name)}</div>
        <div class="goal-deadline">${deadline}</div>
        ${sourceLabel ? `<div class="goal-link-badge">${sourceLabel}</div>` : ''}
        <div class="goal-amounts">
          <div class="goal-current">${formatCurrency(effectiveAmount)}</div>
          <div class="goal-target">de ${formatCurrency(g.targetAmount)}</div>
        </div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill" style="width:0%" data-pct="${pct.toFixed(2)}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="goal-progress-pct">${pct.toFixed(1)}% completado</div>
          ${remaining > 0
            ? `<div style="font-size:12px;color:var(--text-muted)">Faltan ${formatCurrency(remaining)}</div>`
            : `<div style="font-size:12px;color:var(--positive);font-weight:700">¡Objetivo alcanzado! 🎉</div>`
          }
        </div>
        ${insightHtml}
        ${g.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:8px;font-style:italic">${escapeHtml(g.description)}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
          ${contribCount > 0
            ? `<span style="font-size:11px;color:var(--text-muted)">${contribCount} contribución${contribCount !== 1 ? 'es' : ''} · ${formatCurrency(contribTotal)}</span>`
            : `<span></span>`
          }
          <button class="btn-secondary" data-action="add-contrib" style="font-size:11px;padding:3px 10px">+ Contribución</button>
        </div>
      </div>
    `;
  }).join('');

  // Trigger progress bar entrance animation: bars were rendered at width:0%,
  // now set the real width so the CSS transition plays from 0 → target.
  requestAnimationFrame(() => {
    grid.querySelectorAll('.goal-progress-fill[data-pct]').forEach(el => {
      const pct = parseFloat(el.dataset.pct);
      el.style.width = pct + '%';
      el.style.background = pct >= 100 ? 'var(--up)'
        : pct >= 75 ? 'var(--accent)'
        : pct >= 40 ? 'var(--text-secondary)'
        : 'var(--text-muted)';
    });
  });
}

function openAddGoal(prefill = null) {
  const isEdit = !!prefill;
  const g      = prefill || {};
  const today  = new Date().toISOString().slice(0, 10);

  const initSource = g.linkedAccount ? 'account' : (g.linkedCategory ? 'category' : 'manual');

  const accountOptions = APP.cashAccounts.length
    ? APP.cashAccounts.map(a =>
        `<option value="${escapeHtml(a.id)}"${g.linkedAccount === a.id ? ' selected' : ''}>${escapeHtml(a.name)} (${formatCurrency(a.balance || 0)})</option>`
      ).join('')
    : '<option value="" disabled>No hay cuentas configuradas</option>';

  const incomeCats  = APP.categories.income.map(c =>
    `<option value="${escapeHtml(c)}"${g.linkedCategory === c ? ' selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');
  const expenseCats = APP.categories.expense.map(c =>
    `<option value="${escapeHtml(c)}"${g.linkedCategory === c ? ' selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');

  openModal(isEdit ? 'Editar objetivo' : 'Nuevo objetivo', `
    <div class="form-row">
      <div class="form-group" style="flex:0 0 64px">
        <label class="form-label">Emoji</label>
        <input type="text" id="f-g-emoji" class="text-input" placeholder="🎯" value="${escapeHtml(g.emoji || '🎯')}" maxlength="2" style="text-align:center;font-size:22px" />
      </div>
      <div class="form-group">
        <label class="form-label">Nombre del objetivo</label>
        <input type="text" id="f-g-name" class="text-input" placeholder="Ej: Fondo de emergencia" value="${escapeHtml(g.name || '')}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Importe objetivo (€)</label>
        <input type="number" id="f-g-target" class="text-input" placeholder="0.00" value="${g.targetAmount || ''}" step="0.01" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha límite (opcional)</label>
        <input type="date" id="f-g-deadline" class="text-input" value="${g.deadline || ''}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Descripción</label>
      <input type="text" id="f-g-desc" class="text-input" placeholder="Breve descripción..." value="${escapeHtml(g.description || '')}" />
    </div>

    <div class="form-group" style="margin-top:8px">
      <label class="form-label">¿Cómo medir el progreso?</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);font-size:13px">
          <input type="radio" name="g-source" value="manual" ${initSource === 'manual' ? 'checked' : ''} onchange="goalSourceChange()"> Manual
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);font-size:13px">
          <input type="radio" name="g-source" value="account" ${initSource === 'account' ? 'checked' : ''} onchange="goalSourceChange()"> Cuenta de ahorro
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);font-size:13px">
          <input type="radio" name="g-source" value="category" ${initSource === 'category' ? 'checked' : ''} onchange="goalSourceChange()"> Categoría
        </label>
      </div>
    </div>

    <div id="f-g-manual-wrap" style="display:${initSource === 'manual' ? 'block' : 'none'}">
      <div class="form-group">
        <label class="form-label">Importe ahorrado (€)</label>
        <input type="number" id="f-g-current" class="text-input" placeholder="0.00" value="${initSource === 'manual' ? (g.currentAmount || '') : ''}" step="0.01" min="0" />
      </div>
    </div>

    <div id="f-g-account-wrap" style="display:${initSource === 'account' ? 'block' : 'none'}">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Cuenta</label>
          <select id="f-g-link-acct" class="select-input">
            <option value="">— Sin vincular —</option>
            ${accountOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Importe adicional (€)</label>
          <input type="number" id="f-g-extra-acct" class="text-input" placeholder="0.00" value="${initSource === 'account' ? (g.currentAmount || '') : ''}" step="0.01" min="0" />
        </div>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px">El saldo de la cuenta seleccionada se usa como progreso automático.</p>
    </div>

    <div id="f-g-category-wrap" style="display:${initSource === 'category' ? 'block' : 'none'}">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Categoría</label>
          <select id="f-g-link-cat" class="select-input">
            <option value="">— Sin vincular —</option>
            <optgroup label="Ingresos">${incomeCats}</optgroup>
            <optgroup label="Gastos">${expenseCats}</optgroup>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Tipo de transacción</label>
          <select id="f-g-link-type" class="select-input">
            <option value=""        ${!g.linkedType              ? 'selected' : ''}>Ingresos y gastos</option>
            <option value="income"  ${g.linkedType === 'income'  ? 'selected' : ''}>Solo ingresos</option>
            <option value="expense" ${g.linkedType === 'expense' ? 'selected' : ''}>Solo gastos</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Contabilizar desde</label>
          <input type="date" id="f-g-linked-since" class="text-input" value="${g.linkedSince || g.createdAt || today}" />
        </div>
        <div class="form-group">
          <label class="form-label">Importe adicional (€)</label>
          <input type="number" id="f-g-extra-cat" class="text-input" placeholder="0.00" value="${initSource === 'category' ? (g.currentAmount || '') : ''}" step="0.01" min="0" />
        </div>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px">Solo se suman transacciones de esa categoría a partir de la fecha indicada.</p>
    </div>
  `, () => {
    const emoji        = document.getElementById('f-g-emoji').value.trim()         || '🎯';
    const name         = document.getElementById('f-g-name').value.trim();
    const targetAmount = parseFloat(document.getElementById('f-g-target').value)   || 0;
    const deadline     = document.getElementById('f-g-deadline').value;
    const description  = document.getElementById('f-g-desc').value.trim();
    const source       = document.querySelector('input[name="g-source"]:checked')?.value || 'manual';

    let linkedAccount  = '';
    let linkedCategory = '';
    let linkedType     = '';
    let linkedSince    = '';
    let currentAmount  = 0;

    if (source === 'manual') {
      currentAmount = parseFloat(document.getElementById('f-g-current').value)    || 0;
    } else if (source === 'account') {
      linkedAccount = document.getElementById('f-g-link-acct')?.value             || '';
      currentAmount = parseFloat(document.getElementById('f-g-extra-acct').value) || 0;
    } else if (source === 'category') {
      linkedCategory = document.getElementById('f-g-link-cat')?.value             || '';
      linkedType     = document.getElementById('f-g-link-type')?.value            || '';
      linkedSince    = document.getElementById('f-g-linked-since')?.value         || '';
      currentAmount  = parseFloat(document.getElementById('f-g-extra-cat').value) || 0;
    }

    if (!name)             return showToast('El nombre es obligatorio', 'error');
    if (!_validateTextInput(name, 'El nombre')) return;
    if (description && !_validateTextInput(description, 'La descripción')) return;
    if (targetAmount <= 0) return showToast('El importe objetivo debe ser mayor que 0', 'error');

    if (isEdit) {
      const idx = APP.goals.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.goals[idx] = {
        ...prefill,
        emoji, name, targetAmount, currentAmount, deadline, description,
        linkedAccount, linkedCategory, linkedType, linkedSince,
      };
      showToast('Objetivo actualizado ✓', 'success');
    } else {
      APP.goals.push({
        id: generateId(),
        createdAt: new Date().toISOString().slice(0, 10),
        emoji, name, targetAmount, currentAmount, deadline, description,
        linkedAccount, linkedCategory, linkedType, linkedSince,
        contributions: [],
      });
      showToast('Objetivo creado ✓', 'success');
    }

    saveData();
    closeModal();
    renderGoals();
  });
}

function goalSourceChange() {
  const source = document.querySelector('input[name="g-source"]:checked')?.value || 'manual';
  document.getElementById('f-g-manual-wrap').style.display   = source === 'manual'   ? 'block' : 'none';
  document.getElementById('f-g-account-wrap').style.display  = source === 'account'  ? 'block' : 'none';
  document.getElementById('f-g-category-wrap').style.display = source === 'category' ? 'block' : 'none';
}

function openContributions(goalId) {
  const g = APP.goals.find(x => x.id === goalId);
  if (!g) return;

  function buildBody() {
    const contribs = [...(g.contributions || [])].sort((a, b) => b.date.localeCompare(a.date));
    const total    = contribs.reduce((s, c) => s + c.amount, 0);
    const today    = new Date().toISOString().slice(0, 10);

    const listHtml = contribs.length
      ? `<div style="max-height:210px;overflow-y:auto;margin-bottom:16px;border:1px solid var(--border);border-radius:8px">
          ${contribs.map(c => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)">
              <span style="font-size:12px;color:var(--text-muted);min-width:82px">${formatDate(c.date)}</span>
              <span style="font-size:13px;color:var(--positive);font-weight:600;min-width:72px">${formatCurrency(c.amount)}</span>
              <span style="font-size:12px;color:var(--text-secondary);flex:1">${escapeHtml(c.note || '')}</span>
              <button onclick="deleteContrib('${goalId}','${c.id}')" class="btn-danger btn-icon" style="font-size:11px;padding:2px 6px">✕</button>
            </div>
          `).join('')}
          <div style="padding:8px 10px;font-size:12px;color:var(--text-muted);text-align:right">Total: <strong>${formatCurrency(total)}</strong></div>
        </div>`
      : `<p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Sin contribuciones registradas.</p>`;

    return `
      ${listHtml}
      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input type="date" id="f-c-date" class="text-input" value="${today}" />
          </div>
          <div class="form-group">
            <label class="form-label">Importe (€)</label>
            <input type="number" id="f-c-amount" class="text-input" placeholder="0.00" step="0.01" min="0.01" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Nota (opcional)</label>
          <input type="text" id="f-c-note" class="text-input" placeholder="Ej: Nómina extra, transferencia..." />
        </div>
      </div>
    `;
  }

  openModal(
    `Contribuciones · ${escapeHtml(g.name)}`,
    buildBody(),
    () => {
      const date   = document.getElementById('f-c-date')?.value   || '';
      const amount = parseFloat(document.getElementById('f-c-amount')?.value) || 0;
      const note   = document.getElementById('f-c-note')?.value?.trim()       || '';

      if (!date)       return showToast('La fecha es obligatoria', 'error');
      if (amount <= 0) return showToast('El importe debe ser mayor que 0', 'error');

      const wasComplete = _calcGoalProgress(g) >= (g.targetAmount || Infinity);
      if (!g.contributions) g.contributions = [];
      g.contributions.push({ id: generateId(), date, amount, note });
      const nowComplete = _calcGoalProgress(g) >= (g.targetAmount || Infinity);
      saveData();
      closeModal();
      renderGoals();
      showToast('Contribución añadida ✓', 'success');
      if (!wasComplete && nowComplete && typeof _launchConfetti === 'function') {
        setTimeout(_launchConfetti, 300);
        showToast(`🎉 ¡Objetivo "${escapeHtml(g.name)}" completado!`, 'success');
      }
    },
    () => {
      const btn = document.getElementById('modalConfirm');
      if (btn) btn.textContent = 'Añadir contribución';
    }
  );
}

function deleteContrib(goalId, contribId) {
  const g = APP.goals.find(x => x.id === goalId);
  if (!g || !g.contributions) return;
  g.contributions = g.contributions.filter(c => c.id !== contribId);
  saveData();
  renderGoals();
  closeModal();
  openContributions(goalId);
}

function editGoal(id) {
  const g = APP.goals.find(x => x.id === id);
  if (g) openAddGoal(g);
}

function deleteGoal(id) {
  const goal = APP.goals.find(x => x.id === id);
  if (!goal) return;
  APP.goals = APP.goals.filter(x => x.id !== id);
  renderGoals();
  softDelete(`Objetivo "${goal.name}" eliminado`, () => {
    APP.goals.push(goal);
    saveData();
    renderGoals();
  });
}
