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
    const authH = await _getAuthHeader();
    await fetch('/api/user-meta', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authH },
      body:    JSON.stringify({ uid: APP.uid, email: APP.userEmail, displayName: APP.userName || '' }),
      signal:  AbortSignal.timeout(5000),
    });
  } catch (_) {}
}

async function adminLoadStats() {
  try {
    const authH = await _getAuthHeader();
    const [statsRes, healthRes, retentionRes] = await Promise.all([
      fetch('/api/admin/stats',  { headers: authH }),
      fetch('/api/admin/health', { headers: authH }),
      fetch('/api/stats',        { headers: authH }),
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
    if (retentionRes.ok) {
      _renderRetention(await retentionRes.json());
    }
  } catch (e) {
    console.error('[Admin] Error cargando stats:', e);
  }
}

// D1/D7/D30 — definiciones y objetivos:
//   D1  = % de usuarios que vuelven al día siguiente de registrarse (objetivo >20%)
//   D7  = % que vuelven dentro de los 7 días  (objetivo >10%; por debajo del 8% el
//         problema es el producto, no el marketing)
//   D30 = % que vuelven dentro de los 30 días (objetivo >5%)
function _renderRetention(r) {
  _setRetentionKpi('akpi-d1',  r.D1,  20);
  _setRetentionKpi('akpi-d7',  r.D7,  10);
  _setRetentionKpi('akpi-d30', r.D30,  5);

  const noteEl = document.getElementById('admin-retention-note');
  if (!noteEl) return;
  if (r.D7 === null) {
    noteEl.textContent = 'Aún no hay usuarios con 7+ días de antigüedad — vuelve cuando haya datos.';
  } else if (r.D7 < 8) {
    noteEl.innerHTML = '<strong style="color:var(--down)">⚠ D7 por debajo del 8%: el problema es el producto, no el marketing.</strong> Habla directamente con los primeros 10 usuarios que se registren — es el feedback más valioso que vas a recibir.';
  } else {
    noteEl.textContent = '';
  }
}

function _setRetentionKpi(id, pct, target) {
  const el = document.getElementById(id);
  if (!el) return;
  if (pct === null) { el.textContent = '—'; el.style.color = ''; return; }
  el.textContent = pct + '%';
  el.style.color = pct >= target ? 'var(--up)' : 'var(--down)';
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
    const authH = await _getAuthHeader();
    const res  = await fetch('/api/admin/users', { headers: authH });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      el.innerHTML = `<p style="color:var(--danger);font-size:12px">Respuesta inesperada del servidor (${res.status}). Reinicia el servidor con <code>node server.js</code> y recarga.</p>`;
      return;
    }
    if (!data.ok) { el.innerHTML = `<p style="color:var(--danger)">${escapeHtml(data.error)}</p>`; return; }
    _setAdminKpi('akpi-users', data.users.length);
    el.innerHTML = _renderUsersTable(data.users);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger)">Error: ${escapeHtml(e.message)}</p>`;
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
            <div class="admin-user-avatar">${escapeHtml((u.email[0] || '?').toUpperCase())}</div>
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
    const authH = await _getAuthHeader();
    const res  = await fetch('/api/admin/block', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authH },
      body:    JSON.stringify({ targetUid, blocked }),
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
    const authH = await _getAuthHeader();
    const res  = await fetch('/api/admin/set-admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authH },
      body:    JSON.stringify({ targetEmail, isAdmin }),
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
    const authH = await _getAuthHeader();
    const res  = await fetch('/api/admin/health', { headers: authH });
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
      el.innerHTML = `<span style="color:var(--danger)">Error: ${escapeHtml(data.error)}</span>`;
    }
  } catch (e) {
    el.innerHTML = `<span style="color:var(--danger)">Sin respuesta del servidor (${escapeHtml(e.message)})</span>`;
  }
}

/* ─── Feedback de usuarios ───────────────────────────────────── */

const _ADMIN_FB_LABEL = {
  bug: 'Algo no funciona', idea: 'Idea', question: 'Pregunta', other: 'Otro',
};

async function adminRefreshFeedback() {
  const box  = document.getElementById('admin-fb-list');
  const warn = document.getElementById('admin-fb-warning');
  if (!box) return;
  box.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">Cargando…</p>';

  const type = document.getElementById('admin-fb-filter')?.value || '';
  let json;
  try {
    const res = await api.admin.feedback(type);
    json = await res.json();
    if (!res.ok) throw new Error(json.error || ('Error ' + res.status));
  } catch (e) {
    box.innerHTML = '<p style="color:var(--down);font-size:13px;padding:8px 0">No se pudo cargar el feedback.</p>';
    return;
  }

  // Aviso del disco efímero: sin volumen, lo que se ve aquí desaparece en el
  // siguiente despliegue. Mejor decirlo que descubrirlo cuando ya no está.
  if (warn) {
    if (json.persistent === false) {
      warn.style.display = '';
      warn.innerHTML =
        '<div style="padding:10px 12px;margin-bottom:12px;font-size:12.5px;line-height:1.55;' +
        'color:var(--text-secondary);background:var(--bg-elevated);' +
        'border:1px solid var(--down);border-radius:var(--r-sm)">' +
        '<strong style="color:var(--down)">Disco efímero.</strong> El servidor no tiene volumen ' +
        'persistente, así que este listado se borra en cada despliegue. El canal fiable es el ' +
        'webhook (FEEDBACK_WEBHOOK_URL) — ver FEEDBACK_SETUP.md.</div>';
    } else {
      warn.style.display = 'none';
    }
  }

  const items = json.items || [];
  if (!items.length) {
    box.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">' +
      (type ? 'Sin mensajes de ese tipo.' : 'Todavía no hay feedback.') + '</p>';
    return;
  }

  box.innerHTML = '';
  for (const e of items) {
    const card = document.createElement('div');
    card.className = 'admin-fb-item' + (e.read ? ' is-read' : '');

    const head = document.createElement('div');
    head.className = 'admin-fb-head';
    const tag = document.createElement('span');
    tag.className = 'admin-fb-type t-' + (e.type || 'other');
    tag.textContent = _ADMIN_FB_LABEL[e.type] || e.type || '—';
    head.appendChild(tag);

    const meta = document.createElement('span');
    const when = e.at ? new Date(e.at) : null;
    meta.textContent = [
      when && !isNaN(when) ? when.toLocaleString('es-ES') : '',
      e.rating ? e.rating + '/5' : '',
      e.uidHash ? 'uid ' + e.uidHash : 'anónimo',
    ].filter(Boolean).join('  ·  ');
    head.appendChild(meta);

    if (e.email) {
      const mail = document.createElement('a');
      mail.href = 'mailto:' + encodeURIComponent(e.email) +
        '?subject=' + encodeURIComponent('Re: tu mensaje en Finova');
      // textContent, nunca innerHTML: el correo lo escribe el usuario.
      mail.textContent = e.email;
      mail.style.color = 'var(--accent)';
      head.appendChild(mail);
    }
    card.appendChild(head);

    const msg = document.createElement('div');
    msg.className = 'admin-fb-msg';
    // textContent: el mensaje es texto que ha escrito un desconocido. Con
    // innerHTML, un mensaje con etiquetas dentro se ejecutaría en el
    // navegador del admin.
    msg.textContent = e.message || '';
    card.appendChild(msg);

    if (e.tech) {
      const t = e.tech;
      const tech = document.createElement('div');
      tech.className = 'admin-fb-tech';
      const lines = [
        [t.section, t.build || t.version, t.viewport, t.theme, t.lang].filter(Boolean).join(' · '),
        t.ua || '',
      ];
      if (Array.isArray(t.errors) && t.errors.length) {
        lines.push('Errores:');
        for (const err of t.errors) {
          lines.push('  · ' + [err.message, err.file, err.line || null].filter(Boolean).join(' @ '));
        }
      }
      tech.textContent = lines.filter(Boolean).join('\n');
      card.appendChild(tech);
    }

    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'btn-ghost-sm';
    act.style.marginTop = '8px';
    act.textContent = e.read ? 'Marcar como no leído' : 'Marcar como leído';
    act.onclick = () => adminMarkFeedbackRead(e.id, !e.read, act);
    card.appendChild(act);

    box.appendChild(card);
  }
}

async function adminMarkFeedbackRead(id, read, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const res = await api.admin.feedbackRead({ id, read });
    if (!res.ok) throw new Error('Error ' + res.status);
    adminRefreshFeedback();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = read ? 'Marcar como leído' : 'Marcar como no leído'; }
    if (typeof showToast === 'function') showToast('No se pudo guardar', 'error');
  }
}

/* ─── Pruebas de monitorización (solo admin) ─────────────────── */

function _adminMonResult(html) {
  const el = document.getElementById('admin-mon-result');
  if (el) el.innerHTML = html;
}

/** Lanza un error en el NAVEGADOR y comprueba que Sentry está activo. */
function adminTestErrorFront() {
  const mon = window.fvMonitor;
  if (!mon) {
    _adminMonResult('<p style="color:var(--down);font-size:13px">El módulo de monitorización no está cargado (¿falta VITE_SENTRY_DSN?).</p>');
    return;
  }
  if (!mon.enabled) {
    _adminMonResult('<p style="color:var(--text-muted);font-size:13px">Sentry no está enviando: falta <code>VITE_SENTRY_DSN</code>, estás en localhost, o lo has desactivado en Ajustes → Privacidad.</p>');
    return;
  }
  mon._testError();
  _adminMonResult('<p style="color:var(--up);font-size:13px">Error de prueba enviado desde el navegador. Debe aparecer en Sentry en unos segundos, con el importe, el correo y el token <strong>redactados</strong>.</p>');
}

/** Lanza un error en el SERVIDOR vía el endpoint protegido. */
async function adminTestErrorServer() {
  _adminMonResult('<p style="font-size:13px;color:var(--text-muted)">Enviando…</p>');
  try {
    const authH = await _getAuthHeader();
    const res = await fetch('/api/admin/test-error', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authH),
      body: '{}',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || ('Error ' + res.status));
    _adminMonResult('<p style="color:' + (json.enviado ? 'var(--up)' : 'var(--text-muted)') +
      ';font-size:13px">' + (typeof escapeHtml === 'function' ? escapeHtml(json.mensaje) : json.mensaje) + '</p>');
  } catch (e) {
    _adminMonResult('<p style="color:var(--down);font-size:13px">No se pudo lanzar el error de prueba en el servidor.</p>');
  }
}
