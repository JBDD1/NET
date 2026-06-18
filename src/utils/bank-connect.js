/* ═══════════════════════════════════════════════════════════════
   FINOVA — bank-connect.js
   Conexión bancaria Open Banking via GoCardless (PSD2).
   Solo lectura — Finova nunca puede mover dinero ni ve tus
   credenciales bancarias. El usuario autoriza directamente en
   el portal de su banco.

   Setup (una vez):
   1. Regístrate gratis en bankaccountdata.gocardless.com
   2. Crea un Secret ID + Secret Key
   3. FINOVA_GC_SECRET_ID=xxx FINOVA_GC_SECRET_KEY=xxx node server.js
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── Render — sección en Ajustes ────────────────────────────── */

function renderBankConnect() {
  const el = document.getElementById('bank-connect-section');
  if (!el) return;
  const connections = APP.bankConnections || [];

  let html =
    '<div class="bank-disclaimer">' +
      '<strong>⚠️ Función experimental</strong> — Para resultados más fiables te recomendamos ' +
      '<strong>importar CSV</strong> desde la web de tu banco.' +
    '</div>';

  if (connections.length) {
    const lastSync = APP.bankLastAutoSync
      ? new Date(APP.bankLastAutoSync).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : null;
    html +=
      '<div class="bank-autosync-bar">' +
        '<span class="bank-autosync-label">' +
          (_bankSyncRunning
            ? '⟳ Sincronizando…'
            : lastSync ? '✓ Última sincronización: ' + lastSync : 'Sincronización automática activa') +
        '</span>' +
        '<button class="btn-secondary" style="font-size:11px;padding:4px 10px"' +
          ' onclick="_bankAutoSync(false)"' + (_bankSyncRunning ? ' disabled' : '') + '>⟳ Sincronizar ahora</button>' +
      '</div>';
  }

  connections.forEach((conn, idx) => {
    const lastImport = conn.lastImport
      ? new Date(conn.lastImport).toLocaleString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : 'Nunca';
    const n = (conn.accounts || []).length;
    html +=
      '<div class="bank-conn-row">' +
        '<div class="bank-conn-info">' +
          (conn.bankLogo
            ? '<img src="' + escapeHtml(conn.bankLogo) + '" class="bank-conn-logo" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
            : '') +
          '<div>' +
            '<div class="bank-conn-name">' + escapeHtml(conn.bankName) + '</div>' +
            '<div class="bank-conn-meta">' +
              n + ' cuenta' + (n !== 1 ? 's' : '') + ' · Última importación: ' + lastImport +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bank-conn-actions">' +
          '<button class="btn-primary" onclick="_bankImportConn(' + idx + ')">↓ Importar</button>' +
          '<button class="btn-icon-sm" onclick="disconnectBank(' + idx + ')" title="Desconectar">×</button>' +
        '</div>' +
      '</div>';
  });

  html +=
    '<div style="margin-top:' + (connections.length ? '14' : '0') + 'px">' +
      '<button class="btn-secondary" onclick="openBankConnectModal()">+ Conectar banco</button>' +
    '</div>';

  el.innerHTML = html;
}

/* ── Modal: disclaimer ──────────────────────────────────────── */

let _bankInstitutionsList = null;

async function openBankConnectModal() {
  openModal('🏦 Conectar banco', _gcDisclaimerHtml(), null);
  const btn = document.getElementById('gc-disclaimer-continue');
  if (btn) btn.onclick = _gcLoadPicker;
}

function _gcDisclaimerHtml() {
  return (
    '<div class="bank-modal-disclaimer">' +
      '<div class="bank-modal-disclaimer-icon">⚠️</div>' +
      '<div>' +
        '<strong>Función experimental</strong>' +
        '<p style="margin:8px 0 6px;font-size:13px;color:var(--text-secondary)">' +
          'La conexión directa usa <strong>GoCardless Open Banking</strong> (PSD2). ' +
          'No compartirás tu contraseña con Finova — autorizarás desde la web de tu banco.' +
        '</p>' +
        '<p style="margin:0 0 12px;font-size:13px;color:var(--text-secondary)">' +
          'Para el mejor resultado te recomendamos <strong>importar CSV</strong> desde la web de tu banco.' +
        '</p>' +
        '<div class="bank-modal-steps">' +
          '<div class="bank-modal-step"><span>1</span>Elige tu banco</div>' +
          '<div class="bank-modal-step"><span>2</span>Autoriza en la web de tu banco</div>' +
          '<div class="bank-modal-step"><span>3</span>Vuelve y confirma</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
      '<button class="btn-ghost" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn-primary" id="gc-disclaimer-continue">Continuar →</button>' +
    '</div>'
  );
}

/* ── Modal: selector de banco ───────────────────────────────── */

async function _gcLoadPicker() {
  const body = document.getElementById('modalBody');
  if (!body) return;
  body.innerHTML = '<div class="bank-loading">Cargando bancos…</div>';
  try {
    if (!_bankInstitutionsList) {
      let r;
      try { r = await fetch('/api/bank/institutions'); }
      catch { throw new Error('No se pudo contactar con el servidor. ¿Está en marcha?'); }
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        throw new Error(r.ok ? 'El servidor devolvió una respuesta inesperada.' : 'El servidor no responde (error ' + r.status + ').');
      }
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      _bankInstitutionsList = data;
    }
    _bankRenderPicker('');
  } catch (e) {
    body.innerHTML =
      '<p style="color:var(--down);font-size:13px;margin-bottom:12px">' + escapeHtml(e.message) + '</p>' +
      '<div class="bank-modal-tip">' +
        '<strong>Para configurar GoCardless:</strong>' +
        '<ol style="margin:8px 0 0 16px;line-height:1.9;font-size:12px">' +
          '<li>Regístrate gratis en <strong>bankaccountdata.gocardless.com</strong></li>' +
          '<li>Crea un <strong>Secret ID</strong> + <strong>Secret Key</strong></li>' +
          '<li>Arranca el servidor con:<br>' +
            '<code style="display:block;margin:4px 0;padding:6px 8px;background:var(--bg-elevated);border-radius:4px;font-size:11px;word-break:break-all">' +
              'FINOVA_GC_SECRET_ID=xxx FINOVA_GC_SECRET_KEY=xxx node server.js' +
            '</code>' +
          '</li>' +
        '</ol>' +
      '</div>' +
      '<p style="font-size:12px;color:var(--text-muted);margin-top:12px">' +
        'O usa <strong>importación CSV</strong> desde la sección de transacciones.' +
      '</p>';
  }
}

function _bankRenderPicker(filter) {
  const body = document.getElementById('modalBody');
  if (!body || !_bankInstitutionsList) return;
  const q        = filter.toLowerCase();
  const filtered = q
    ? _bankInstitutionsList.filter(i => i.name.toLowerCase().includes(q))
    : _bankInstitutionsList;

  const rows = filtered.slice(0, 50).map(i =>
    '<div class="bank-picker-row"' +
      ' data-id="'   + escapeHtml(i.id)       + '"' +
      ' data-name="' + escapeHtml(i.name)      + '"' +
      ' data-logo="' + escapeHtml(i.logo || '') + '"' +
      ' onclick="_bankPickerClick(this)">' +
      (i.logo
        ? '<img src="' + escapeHtml(i.logo) + '" class="bank-picker-logo" alt="" loading="lazy"' +
          ' onerror="this.replaceWith(document.createTextNode(\'🏦\'))">'
        : '<span class="bank-picker-logo-ph">🏦</span>') +
      '<span class="bank-picker-name">' + escapeHtml(i.name) + '</span>' +
    '</div>'
  ).join('');

  body.innerHTML =
    '<input type="text" class="text-input" id="bank-search" placeholder="Buscar banco…"' +
      ' style="width:100%;margin-bottom:12px"' +
      ' oninput="_bankRenderPicker(this.value)" value="' + escapeHtml(filter) + '" />' +
    '<div class="bank-picker-list">' +
      (rows || '<p style="font-size:13px;color:var(--text-muted)">Sin resultados.</p>') +
    '</div>' +
    '<p style="font-size:11px;color:var(--text-muted);margin-top:10px">' +
      '🔒 Open Banking PSD2 · Finova nunca ve tu contraseña' +
    '</p>';

  setTimeout(() => document.getElementById('bank-search')?.focus(), 40);
}

function _bankPickerClick(el) {
  _gcStartConnect(el.dataset.id, el.dataset.name, el.dataset.logo || null);
}

/* ── GoCardless: crear requisición y mostrar pasos ──────────── */

let _gcPendingReqId    = null;
let _gcPendingBankName = null;
let _gcPendingBankLogo = null;
let _gcPendingInstId   = null;

async function _gcStartConnect(institutionId, bankName, bankLogo) {
  const body = document.getElementById('modalBody');
  if (!body) return;
  _gcPendingBankName = bankName;
  _gcPendingBankLogo = bankLogo;
  _gcPendingInstId   = institutionId;
  body.innerHTML = '<div class="bank-loading">Preparando conexión con ' + escapeHtml(bankName) + '…</div>';

  try {
    const r = await fetch('/api/bank/connect', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ institutionId }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    _gcPendingReqId = data.requisitionId;

    body.innerHTML =
      '<button class="btn-ghost" style="margin-bottom:14px;font-size:12px" onclick="_gcLoadPicker()">← Elegir otro banco</button>' +
      '<div class="bank-modal-steps bank-modal-steps--active">' +
        '<div class="bank-modal-step bank-modal-step--done"><span>✓</span>Requisición creada</div>' +
        '<div class="bank-modal-step bank-modal-step--current"><span>2</span>Autoriza en tu banco</div>' +
        '<div class="bank-modal-step"><span>3</span>Confirmar</div>' +
      '</div>' +
      '<p style="font-size:13px;color:var(--text-secondary);margin:16px 0">' +
        'Se abrirá el portal de <strong>' + escapeHtml(bankName) + '</strong> en una nueva pestaña. ' +
        'Inicia sesión y autoriza el acceso de solo lectura. Luego vuelve aquí y pulsa «He autorizado».' +
      '</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<a href="' + escapeHtml(data.link) + '" target="_blank" rel="noopener noreferrer"' +
          ' class="btn-primary" style="text-align:center;text-decoration:none">Ir a ' + escapeHtml(bankName) + ' →</a>' +
        '<button class="btn-secondary" onclick="_gcFinishConnect()">He autorizado ✓</button>' +
      '</div>' +
      '<p style="font-size:11px;color:var(--text-muted);margin-top:12px">' +
        '🔒 Acceso solo lectura · Finova nunca puede mover dinero' +
      '</p>';

  } catch (e) {
    body.innerHTML =
      '<p style="color:var(--down);font-size:13px;margin-bottom:12px">' + escapeHtml(e.message) + '</p>' +
      '<div style="display:flex;justify-content:flex-end">' +
        '<button class="btn-ghost" onclick="_gcLoadPicker()">← Volver</button>' +
      '</div>';
  }
}

async function _gcFinishConnect() {
  const body = document.getElementById('modalBody');
  if (!body || !_gcPendingReqId) return;
  body.innerHTML = '<div class="bank-loading">Verificando autorización…</div>';

  try {
    const sr   = await fetch('/api/bank/requisition?id=' + encodeURIComponent(_gcPendingReqId));
    const stat = await sr.json();
    if (stat.error) throw new Error(stat.error);

    if (stat.status !== 'LN') {
      const msg =
        stat.status === 'CR' ? 'Aún no has autorizado el acceso en tu banco. Pulsa el enlace y completa la autorización.' :
        stat.status === 'EX' ? 'La solicitud ha expirado. Cierra este diálogo e inténtalo de nuevo.' :
        'Estado: ' + stat.status + '. Si ya autorizaste, espera unos segundos e inténtalo de nuevo.';
      body.innerHTML =
        '<p style="color:var(--down);font-size:13px;margin-bottom:16px">' + escapeHtml(msg) + '</p>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px">' +
          '<button class="btn-ghost" onclick="_gcLoadPicker()">← Volver</button>' +
          '<button class="btn-primary" onclick="_gcFinishConnect()">Reintentar</button>' +
        '</div>';
      return;
    }

    body.innerHTML = '<div class="bank-loading">Importando transacciones…</div>';

    const ir         = await fetch('/api/bank/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ requisitionId: _gcPendingReqId }),
    });
    const importData = await ir.json();
    if (importData.error) throw new Error(importData.error);

    const { added, skipped, accounts } = _gcProcessImport(importData, -1);

    if (!APP.bankConnections) APP.bankConnections = [];
    APP.bankConnections.push({
      id:            'gc_' + Date.now().toString(36),
      institutionId: _gcPendingInstId,
      bankName:      _gcPendingBankName,
      bankLogo:      _gcPendingBankLogo || null,
      requisitionId: _gcPendingReqId,
      accounts,
      lastImport:    new Date().toISOString(),
    });
    saveData();

    closeModal();
    renderBankConnect();
    if (typeof updateTransactionSummary === 'function') updateTransactionSummary();
    if (typeof renderTransactionTable   === 'function') renderTransactionTable();
    if (added > 0 && typeof markDashboardDirty === 'function') {
      markDashboardDirty(); if (typeof renderDashboard === 'function') renderDashboard();
    }
    const s  = added !== 1;
    const sk = skipped > 0 ? ', ' + skipped + ' ya existían' : '';
    showToast(_gcPendingBankName + ' conectado ✓ · ' + added + ' transacción' + (s ? 'es' : '') + ' importada' + (s ? 's' : '') + sk, 'success');

  } catch (e) {
    if (body) {
      body.innerHTML =
        '<p style="color:var(--down);font-size:13px;margin-bottom:12px">' + escapeHtml(e.message) + '</p>' +
        '<div style="display:flex;justify-content:flex-end">' +
          '<button class="btn-ghost" onclick="closeModal()">Cerrar</button>' +
        '</div>';
    }
    showToast('Error: ' + e.message, 'error');
  }
}

/* ── Procesar respuesta GoCardless → APP ─────────────────────── */

function _gcProcessImport(data, connIdx) {
  const accounts    = [];
  const existingIds = new Set(APP.transactions.filter(t => t.bankTxId).map(t => t.bankTxId));
  let added = 0, skipped = 0;

  (data.accounts || []).forEach(acc => {
    const balance = acc.balance ?? null;
    const iban    = acc.iban    || null;
    const accName = acc.name   || 'Cuenta bancaria';
    const accKey  = iban || acc.id || accName;

    accounts.push({ product: accName, balance, iban, id: acc.id });

    if (balance !== null) {
      const existing = APP.cashAccounts.find(a => a.bankAccountId === accKey);
      if (existing) {
        existing.amount   = balance;
        existing.lastSync = new Date().toISOString();
      } else {
        APP.cashAccounts.push({
          id:            generateId(),
          name:          accName + (iban ? ' (···' + iban.slice(-4) + ')' : ''),
          amount:        balance,
          bankAccountId: accKey,
          lastSync:      new Date().toISOString(),
        });
      }
    }

    (acc.transactions || []).forEach(t => {
      const txId = t.transactionId || null;
      if (txId && existingIds.has(txId)) { skipped++; return; }
      let category = '';
      if (APP.categoryPatterns) {
        const descUp = (t.description || '').toUpperCase();
        for (const [kw, v] of Object.entries(APP.categoryPatterns)) {
          if (descUp.includes(kw.toUpperCase())) { category = (v && typeof v === 'object') ? (v.cat || '') : v; break; }
        }
      }
      const amount = Math.abs(t.amount || 0);
      const type   = (t.amount || 0) >= 0 ? 'income' : 'expense';
      if (!category) category = type === 'income' ? 'Otros ingresos' : 'Otros gastos';
      APP.transactions.push({
        id:           generateId(),
        date:         t.date || new Date().toISOString().slice(0, 10),
        description:  (t.description || 'Transacción').trim(),
        category, type, amount,
        bankTxId:     txId,
        bankImported: true,
      });
      if (txId) existingIds.add(txId);
      added++;
    });
  });

  if (connIdx >= 0 && APP.bankConnections?.[connIdx]) {
    APP.bankConnections[connIdx].lastImport = new Date().toISOString();
    APP.bankConnections[connIdx].accounts   = accounts;
  }
  return { added, skipped, accounts };
}

/* ── Importar una conexión existente ─────────────────────────── */

async function _bankImportConn(connIdx) {
  const conn = (APP.bankConnections || [])[connIdx];
  if (!conn) return;
  if (!conn.requisitionId) {
    showToast('Esta conexión no tiene autorización guardada. Vuelve a conectar el banco.', 'error');
    return;
  }
  showToast('Importando ' + conn.bankName + '…', 'info');
  try {
    const r = await fetch('/api/bank/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ requisitionId: conn.requisitionId }),
    });
    const data = await r.json();
    if (data.error) {
      const expired = data.error.toLowerCase().includes('expir') || data.error.toLowerCase().includes('authorized');
      showToast(expired
        ? 'La sesión bancaria ha expirado. Desconecta y vuelve a conectar ' + conn.bankName + '.'
        : 'Error al importar ' + conn.bankName + ': ' + data.error,
        'error');
      return;
    }
    const { added, skipped } = _gcProcessImport(data, connIdx);
    saveData();
    renderBankConnect();
    if (typeof updateTransactionSummary === 'function') updateTransactionSummary();
    if (typeof renderTransactionTable   === 'function') renderTransactionTable();
    if (added > 0 && typeof markDashboardDirty === 'function') {
      markDashboardDirty(); if (typeof renderDashboard === 'function') renderDashboard();
    }
    const s  = added !== 1;
    const sk = skipped > 0 ? ', ' + skipped + ' ya existían' : '';
    showToast(added + ' transacción' + (s ? 'es' : '') + ' importada' + (s ? 's' : '') + sk + ' ✓', 'success');
  } catch (e) {
    showToast('Error al importar ' + conn.bankName + ': ' + e.message, 'error');
  }
}

/* ── Auto-sync ───────────────────────────────────────────────── */

let _bankSyncTimer    = null;
let _bankSyncRunning  = false;
let _bankLastAutoSync = 0;
const _BANK_SYNC_INTERVAL_MS = 30 * 60 * 1000;

async function _bankAutoSync(silent = true) {
  const connections = APP.bankConnections || [];
  if (!connections.length || _bankSyncRunning) return;
  if (Date.now() - _bankLastAutoSync < 15 * 60 * 1000) return;
  _bankSyncRunning     = true;
  _bankLastAutoSync    = Date.now();
  APP.bankLastAutoSync = new Date().toISOString();

  let totalAdded = 0;
  try {
    for (let ci = 0; ci < connections.length; ci++) {
      const conn = connections[ci];
      if (!conn.requisitionId) continue;
      try {
        const r = await fetch('/api/bank/import', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ requisitionId: conn.requisitionId }),
        });
        const data = await r.json();
        if (!data.error) {
          const { added } = _gcProcessImport(data, ci);
          totalAdded += added;
        }
      } catch {}
    }
  } finally {
    _bankSyncRunning = false;
  }

  saveData();
  renderBankConnect();
  if (totalAdded > 0) {
    if (typeof updateTransactionSummary === 'function') updateTransactionSummary();
    if (typeof renderTransactionTable   === 'function') renderTransactionTable();
    if (typeof markDashboardDirty === 'function') {
      markDashboardDirty(); if (typeof renderDashboard === 'function') renderDashboard();
    }
    if (!silent) {
      const s = totalAdded !== 1;
      showToast('🏦 ' + totalAdded + ' transacción' + (s ? 'es' : '') + ' nueva' + (s ? 's' : '') + ' del banco ✓', 'success');
    }
  } else if (!silent) {
    showToast('🏦 Todo al día — no hay nuevas transacciones', 'info');
  }
}

function _bankStartAutoSync() {
  if (_bankSyncTimer) return;
  setTimeout(() => _bankAutoSync(true), 4000);
  _bankSyncTimer = setInterval(() => _bankAutoSync(true), _BANK_SYNC_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _bankAutoSync(true); });
}

/* ── Desconectar ─────────────────────────────────────────────── */

function disconnectBank(connIdx) {
  const conn = (APP.bankConnections || [])[connIdx];
  if (!conn) return;
  openModal(
    'Desconectar banco',
    '<p>¿Desconectar <strong>' + escapeHtml(conn.bankName) + '</strong>? Las transacciones ya importadas no se borran.</p>',
    () => {
      APP.bankConnections.splice(connIdx, 1);
      saveData();
      renderBankConnect();
      showToast(conn.bankName + ' desconectado', 'info');
    }
  );
}
