/* ═══════════════════════════════════════════════════════════════
   FINOVA — Panel de administrador
═══════════════════════════════════════════════════════════════ */

async function renderAdminSection() {
  if (!APP.isAdmin) return;
  // Asegurar que el metadata está guardado antes de llamar a endpoints admin
  await _ensureAdminMeta();
  await Promise.all([adminLoadStats(), adminRefreshUsers()]);
}

async function _ensureAdminMeta() {
  if (!APP.uid || !APP.userEmail) return;
  try {
    await fetch('/api/user-meta', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ uid: APP.uid, email: APP.userEmail, displayName: APP.userName || '' }),
      signal:  AbortSignal.timeout(5000),
    });
  } catch (_) {}
}

async function adminLoadStats() {
  try {
    const [statsRes, healthRes] = await Promise.all([
      fetch(`/api/admin/stats?adminUid=${encodeURIComponent(APP.uid)}`),
      fetch(`/api/admin/health?adminUid=${encodeURIComponent(APP.uid)}`),
    ]);
    if (statsRes.status === 404 || healthRes.status === 404) {
      const kpis = document.getElementById('admin-kpis');
      if (kpis) kpis.innerHTML = `<div style="grid-column:1/-1;padding:14px;background:rgba(220,50,50,.08);border:1px solid rgba(220,50,50,.2);border-radius:8px;color:var(--danger);font-size:13px">
        ⚠️ El servidor necesita reiniciarse para activar los endpoints de admin. Ejecuta: <code>node server.js</code></div>`;
      return;
    }
    const stats  = await statsRes.json();
    const health = await healthRes.json();

    if (stats.ok) {
      _setAdminKpi('akpi-users',    stats.total);
      _setAdminKpi('akpi-active7',  stats.active7);
      _setAdminKpi('akpi-active30', stats.active30);
      _setAdminKpi('akpi-sessions', stats.totalSessions);
      _renderTopSections(stats.topSections || []);
    }
    if (health.ok) {
      _setAdminKpi('akpi-mem',    health.memoryMB + ' MB');
      _setAdminKpi('akpi-uptime', health.uptime);
    }
  } catch (e) {
    console.error('[Admin] Error cargando stats:', e);
  }
}

function _setAdminKpi(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function _renderTopSections(sections) {
  const el = document.getElementById('admin-top-sections');
  if (!el) return;
  if (!sections.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Sin datos todavía</p>'; return; }
  const max = sections[0].count || 1;
  const LABELS = {
    dashboard: 'Dashboard', transactions: 'Transacciones', portfolio: 'Cartera',
    goals: 'Objetivos', networth: 'Patrimonio', settings: 'Ajustes',
    ai: 'Asesor IA', bizums: 'Bizums', recurring: 'Recurrentes',
    fiscalidad: 'Fiscal', simulator: 'Simulador',
  };
  el.innerHTML = sections.map(({ section, count }) => `
    <div class="admin-section-bar-row">
      <span class="admin-section-bar-label">${LABELS[section] || section}</span>
      <div class="admin-section-bar-track">
        <div class="admin-section-bar-fill" style="width:${Math.round(count / max * 100)}%"></div>
      </div>
      <span class="admin-section-bar-count">${count}</span>
    </div>`).join('');
}

async function adminRefreshUsers() {
  const el = document.getElementById('admin-users-table');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">Cargando…</p>';
  try {
    const res  = await fetch(`/api/admin/users?adminUid=${encodeURIComponent(APP.uid)}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      el.innerHTML = `<p style="color:var(--danger);font-size:12px">Respuesta inesperada del servidor (${res.status}). Reinicia el servidor con <code>node server.js</code> y recarga.</p>`;
      return;
    }
    if (!data.ok) { el.innerHTML = `<p style="color:var(--danger)">${data.error}</p>`; return; }
    _setAdminKpi('akpi-users', data.users.length);
    el.innerHTML = _renderUsersTable(data.users);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger)">Error: ${e.message}</p>`;
  }
}

function _renderUsersTable(users) {
  if (!users.length) return '<p style="color:var(--text-muted);font-size:13px">No hay usuarios registrados.</p>';
  const rows = users.map(u => {
    const size     = u.sizeBytes > 1024 * 1024
      ? (u.sizeBytes / 1024 / 1024).toFixed(2) + ' MB'
      : Math.round(u.sizeBytes / 1024) + ' KB';
    const created  = u.createdAt  ? new Date(u.createdAt).toLocaleDateString('es-ES')  : '—';
    const lastSeen = u.lastAccess ? new Date(u.lastAccess).toLocaleDateString('es-ES') : '—';
    const adminBadge = u.isAdmin ? '<span class="admin-badge-tag">Admin</span>' : '';
    const blockedBadge = u.blocked ? '<span class="admin-blocked-tag">Bloqueado</span>' : '';
    return `
      <tr class="admin-user-row${u.blocked ? ' admin-user-blocked' : ''}">
        <td class="admin-td">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="admin-user-avatar">${(u.email[0] || '?').toUpperCase()}</div>
            <div>
              <div style="font-size:13px;font-weight:500;color:var(--text-primary)">${escapeHtml(u.email)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(u.displayName || '')}</div>
            </div>
          </div>
        </td>
        <td class="admin-td" style="font-size:12px;color:var(--text-muted)">${created}</td>
        <td class="admin-td" style="font-size:12px;color:var(--text-muted)">${lastSeen}</td>
        <td class="admin-td" style="font-size:12px">${size}</td>
        <td class="admin-td">${adminBadge}${blockedBadge}</td>
        <td class="admin-td">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn-ghost-sm" title="${u.blocked ? 'Desbloquear' : 'Bloquear'}"
              onclick="adminToggleBlock('${escapeHtml(u.uid)}', ${!u.blocked})">
              ${u.blocked ? '🔓 Desbloquear' : '🔒 Bloquear'}
            </button>
            <button type="button" class="btn-ghost-sm"
              onclick="adminToggleAdminRole('${escapeHtml(u.email)}', ${!u.isAdmin})">
              ${u.isAdmin ? '⬇ Quitar admin' : '⬆ Dar admin'}
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto">
      <table class="admin-table">
        <thead>
          <tr>
            <th class="admin-th">Usuario</th>
            <th class="admin-th">Registro</th>
            <th class="admin-th">Último acceso</th>
            <th class="admin-th">Tamaño datos</th>
            <th class="admin-th">Estado</th>
            <th class="admin-th">Acciones</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function adminToggleBlock(targetUid, blocked) {
  try {
    const res  = await fetch('/api/admin/block', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ adminUid: APP.uid, targetUid, blocked }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(blocked ? 'Usuario bloqueado' : 'Usuario desbloqueado', blocked ? 'warning' : 'success');
      adminRefreshUsers();
    } else {
      showToast(data.error || 'Error', 'error');
    }
  } catch (e) { showToast('Error de red', 'error'); }
}

async function adminToggleAdminRole(targetEmail, isAdmin) {
  try {
    const res  = await fetch('/api/admin/set-admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ adminUid: APP.uid, targetEmail, isAdmin }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(isAdmin ? `${targetEmail} ahora es admin` : `${targetEmail} ya no es admin`, 'success');
      adminRefreshUsers();
    } else {
      showToast(data.error || 'Error', 'error');
    }
  } catch (e) { showToast('Error de red', 'error'); }
}

async function adminHealthCheck() {
  const el = document.getElementById('admin-health-result');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--text-muted);font-size:13px">Verificando…</span>';
  const t0 = Date.now();
  try {
    const res  = await fetch(`/api/admin/health?adminUid=${encodeURIComponent(APP.uid)}`);
    const data = await res.json();
    const ms   = Date.now() - t0;
    if (data.ok) {
      el.innerHTML = `
        <div class="admin-health-grid">
          <div class="admin-health-item"><span class="admin-health-dot ok"></span><strong>Estado:</strong> Activo</div>
          <div class="admin-health-item"><span>🕐</span><strong>Respuesta:</strong> ${ms}ms</div>
          <div class="admin-health-item"><span>⏱</span><strong>Uptime:</strong> ${data.uptime}</div>
          <div class="admin-health-item"><span>💾</span><strong>RAM:</strong> ${data.memoryMB} MB</div>
          <div class="admin-health-item"><span>👥</span><strong>Usuarios:</strong> ${data.users}</div>
          <div class="admin-health-item"><span>📦</span><strong>Datos totales:</strong> ${data.totalDataMB} MB</div>
          <div class="admin-health-item"><span>🟢</span><strong>Node:</strong> ${data.nodeVersion}</div>
          <div class="admin-health-item"><span>🕰</span><strong>Timestamp:</strong> ${new Date(data.timestamp).toLocaleTimeString('es-ES')}</div>
        </div>`;
    } else {
      el.innerHTML = `<span style="color:var(--danger)">Error: ${data.error}</span>`;
    }
  } catch (e) {
    el.innerHTML = `<span style="color:var(--danger)">Sin respuesta del servidor (${e.message})</span>`;
  }
}
