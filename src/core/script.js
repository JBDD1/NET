/**
 * ═══════════════════════════════════════════════════════════════
 * FINOVA — GESTIÓN FINANCIERA PERSONAL
 * Archivo: script.js  (core orchestrator)
 *
 * Depende de los módulos cargados antes en index.html:
 *   core/state.js      — APP state, Store, categorías
 *   core/utils.js      — formato, fetch, debounce, delegación
 *   core/charts.js     — registro Chart.js, colores, defaults
 *   core/calcs.js      — calcNetWorth, calcPortfolio, etc.
 *   core/storage.js    — saveData, loadData, IDB, API keys
 *   core/navigation.js — navigateTo, renderSection
 *
 * Contiene:
 *   Modal, Toast, Tema, DOM utils, loadDemoData,
 *   init(), globalClickDispatch, Export, Settings,
 *   Búsqueda, Milestones, Sincronización, IA, etc.
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';
/* ═══════════════════════════════════════════════════════════════
   15. MODALES (sistema genérico)
═══════════════════════════════════════════════════════════════ */
let _modalConfirmHandler = null;

/**
 * Abre el modal genérico.
 * @param {string}   title    - Título del modal
 * @param {string}   bodyHTML - Contenido HTML del cuerpo
 * @param {Function} onConfirm - Callback al pulsar "Guardar"
 * @param {Function} afterRender - Callback después de insertar el HTML (opcional)
 */
let _modalFocusTrapHandler = null;
let _modalPreviousFocus    = null;

let _modalClosingTimer = null;

function openModal(title, body, onConfirm = null, afterRender = null) {
  // Abort any in-progress close animation so we can reuse the overlay immediately
  if (_modalClosingTimer) {
    clearTimeout(_modalClosingTimer);
    _modalClosingTimer = null;
    const ol = document.getElementById('modalOverlay');
    ol.classList.remove('closing');
  }

  document.getElementById('modalTitle').textContent = title;
  const bodyEl = document.getElementById('modalBody');
  if (typeof body === 'string') {
    bodyEl.innerHTML = body;
  } else {
    bodyEl.innerHTML = '';
    if (body) bodyEl.appendChild(body);
  }
  document.getElementById('modalOverlay').classList.add('open');

  // Restaurar footer si fue ocultado
  const footer = document.getElementById('modal').querySelector('.modal-footer');
  if (footer) footer.style.display = '';

  _modalConfirmHandler = onConfirm;
  _modalPreviousFocus  = document.activeElement;

  if (afterRender) afterRender();

  // Focus trap + primer input
  setTimeout(() => {
    const modal     = document.getElementById('modal');
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);

    const firstInput = document.getElementById('modalBody').querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
    else { const els = getFocusable(); if (els.length) els[0].focus(); }

    if (_modalFocusTrapHandler) modal.removeEventListener('keydown', _modalFocusTrapHandler);
    _modalFocusTrapHandler = (e) => {
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _fireModalConfirm(); return; }
      if (e.key !== 'Tab') return;
      const els  = getFocusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    modal.addEventListener('keydown', _modalFocusTrapHandler);
  }, 50);
}

/**
 * createFormModal — utility wrapper around openModal for standardized forms.
 * @param {string} title
 * @param {Array<{id,label,type?,value?,placeholder?,options?,required?,step?,min?,max?,maxlength?,hint?}>} fields
 * @param {function(values: Object<string,string>): void} onSave
 */
function createFormModal(title, fields, onSave) {
  const html = fields.map(f => {
    const lbl = escapeHtml(f.label) + (f.required ? ' <span style="color:var(--down)">*</span>' : '');
    const hint = f.hint ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escapeHtml(f.hint)}</div>` : '';
    let control;
    if (f.type === 'select') {
      const opts = (f.options || []).map(o =>
        `<option value="${escapeHtml(String(o.value))}"${String(f.value) === String(o.value) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
      ).join('');
      control = `<select id="${f.id}" class="select-input">${opts}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea id="${f.id}" class="text-input" placeholder="${escapeHtml(f.placeholder || '')}" rows="3">${escapeHtml(String(f.value ?? ''))}</textarea>`;
    } else {
      const attrs = [
        `type="${f.type || 'text'}"`,
        `id="${f.id}"`,
        `class="text-input"`,
        `placeholder="${escapeHtml(f.placeholder || '')}"`,
        `value="${escapeHtml(String(f.value ?? ''))}"`,
        f.step     != null ? `step="${f.step}"` : '',
        f.min      != null ? `min="${f.min}"` : '',
        f.max      != null ? `max="${f.max}"` : '',
        f.maxlength != null ? `maxlength="${f.maxlength}"` : '',
      ].filter(Boolean).join(' ');
      control = `<input ${attrs} />`;
    }
    return `<div class="form-group"><label class="form-label">${lbl}</label>${control}${hint}</div>`;
  }).join('');

  openModal(title, html, () => {
    const values = Object.fromEntries(fields.map(f => [f.id, document.getElementById(f.id)?.value ?? '']));
    onSave(values);
  });
}

let _modalOnClose = null;

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal   = document.getElementById('modal');
  if (!overlay.classList.contains('open')) return;
  if (_modalFocusTrapHandler) { modal.removeEventListener('keydown', _modalFocusTrapHandler); _modalFocusTrapHandler = null; }
  // Restore focus immediately — don't wait for the animation to finish
  if (_modalPreviousFocus) { _modalPreviousFocus.focus(); _modalPreviousFocus = null; }

  overlay.classList.add('closing');
  _modalClosingTimer = setTimeout(() => {
    _modalClosingTimer = null;
    overlay.classList.remove('open', 'closing');
    _modalConfirmHandler = null;
    if (_modalOnClose) { try { _modalOnClose(); } catch(e) { console.warn(e); } _modalOnClose = null; }
    const btn = document.getElementById('modalConfirm');
    if (btn) { btn.textContent = 'Guardar'; btn.className = 'btn-primary'; btn.style.display = ''; }
    const cancelBtn = document.getElementById('modalCancel');
    if (cancelBtn) cancelBtn.textContent = 'Cancelar';
  }, 150);
}

async function _fireModalConfirm() {
  if (!_modalConfirmHandler) { closeModal(); return; }
  try {
    const result = _modalConfirmHandler();
    if (result && typeof result.then === 'function') {
      await result;
    }
  } catch(e) {
    console.error('Error en confirmación del modal:', e);
    showToast('Error al guardar: ' + e.message, 'error');
    return;
  }
  if (!document.getElementById('modalOverlay')?.classList.contains('open')) saveData();
}

function modalConfirmClick() {
  _fireModalConfirm();
}

/**
 * Confirmación destructiva segura — reemplaza confirm() nativo.
 * Usa el modal existente con botón rojo de confirmación.
 */
function confirmAction(message, onConfirm) {
  document.getElementById('modalTitle').textContent = 'Confirmar acción';
  document.getElementById('modalBody').innerHTML =
    `<p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary)">${escapeHtml(message)}</p>`;
  document.getElementById('modalOverlay').classList.add('open');

  const footer  = document.getElementById('modal').querySelector('.modal-footer');
  if (footer) footer.style.display = '';

  const confirmBtn = document.getElementById('modalConfirm');
  if (confirmBtn) {
    confirmBtn.textContent = 'Eliminar';
    confirmBtn.className   = 'btn-danger';
  }

  _modalConfirmHandler = () => {
    closeModal();
    // Restaurar botón a su estilo normal para el próximo modal
    if (confirmBtn) { confirmBtn.textContent = 'Guardar'; confirmBtn.className = 'btn-primary'; }
    onConfirm();
  };
}

/* ═══════════════════════════════════════════════════════════════
   16. TOASTS
═══════════════════════════════════════════════════════════════ */
function showToast(message, type = 'success', opts = {}) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Deduplicate: if same message+type already visible, just reset its timer
  const existing = [...container.querySelectorAll('.toast')].find(
    t => t.dataset.msg === message && t.dataset.type === type
  );
  if (existing) {
    existing._toastDismiss?.();
    existing._toastDismiss = _scheduleToastDismiss(existing, type, opts.duration);
    return;
  }

  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.dataset.msg  = message;
  toast.dataset.type = type;

  const actionHtml = opts.action
    ? `<button class="toast-action btn-primary" data-action="${escapeHtml(opts.action.action)}">${escapeHtml(opts.action.label)}</button>`
    : '';

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-undo-msg">${escapeHtml(message)}</span>
    ${actionHtml}
    <button class="toast-close" aria-label="Cerrar">✕</button>
  `;
  toast.querySelector('.toast-close').addEventListener('click', () => toast._toastDismiss?.());
  if (opts.action) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      toast._toastDismiss?.();
      if (typeof opts.action.callback === 'function') opts.action.callback();
      else handleAction(opts.action.action);
    });
  } else {
    toast.addEventListener('click', (e) => {
      if (!e.target.classList.contains('toast-close')) toast._toastDismiss?.();
    });
  }

  container.appendChild(toast);
  toast._toastDismiss = _scheduleToastDismiss(toast, type, opts.duration);
}

function _scheduleToastDismiss(toast, type, customDuration) {
  const defaults = { success: 3000, error: 7000, info: 4000 };
  let t = setTimeout(() => {
    if (!toast.isConnected) return;
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, customDuration ?? defaults[type] ?? 3000);
  return () => {
    clearTimeout(t);
    if (!toast.isConnected) return;
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  };
}

function showKeyboardHelp() {
  openModal('Atajos de teclado', `
    <div class="kbd-help-grid">
      <div>
        <div class="kbd-help-section-title">Navegación</div>
        <div class="kbd-help-row"><kbd>⌘K</kbd><span>Búsqueda global</span></div>
        <div class="kbd-help-row"><kbd>G</kbd><span>Ir al dashboard</span></div>
        <div class="kbd-help-row"><kbd>Esc</kbd><span>Cerrar / cancelar</span></div>
        <div class="kbd-help-row"><kbd>⌘↵</kbd><span>Confirmar formulario</span></div>
      </div>
      <div>
        <div class="kbd-help-section-title">Crear</div>
        <div class="kbd-help-row"><kbd>N</kbd><span>Nueva transacción</span></div>
        <div class="kbd-help-row"><kbd>I</kbd><span>Nueva inversión</span></div>
      </div>
      <div>
        <div class="kbd-help-section-title">Vista</div>
        <div class="kbd-help-row"><kbd>T</kbd><span>Cambiar tema claro/oscuro</span></div>
        <div class="kbd-help-row"><kbd>P</kbd><span>Activar / desactivar privacidad</span></div>
        <div class="kbd-help-row"><kbd>/</kbd><span>Buscar transacciones</span></div>
        <div class="kbd-help-row"><kbd>?</kbd><span>Mostrar atajos de teclado</span></div>
      </div>
    </div>
  `, null, () => {
    const footer = document.getElementById('modal')?.querySelector('.modal-footer');
    if (footer) footer.style.display = 'none';
  });
}

/* ═══════════════════════════════════════════════════════════════
   17. TEMA
═══════════════════════════════════════════════════════════════ */
function toggleTheme() {
  APP.theme = APP.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveData();
  // Destroy all charts so they recreate with the new theme's colors
  Object.keys(Charts._r).forEach(k => Charts.destroy(k));
  if (typeof markDashboardDirty === 'function') markDashboardDirty();
  setTimeout(() => renderSection(APP.activeSection), 50);
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', APP.theme);
  const themeIcon  = document.getElementById('themeIcon');
  const themeLabel = document.querySelector('#themeToggle .nav-label');
  if (themeIcon)  themeIcon.textContent  = APP.theme === 'dark' ? '☀' : '☾';
  if (themeLabel) themeLabel.textContent = APP.theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
}

const VALID_VARIANTS = ['obsidian-brass', 'linen-editorial', 'midnight-emerald', 'soft-mono', 'terracotta-warmth'];

function applyVariant() {
  const v = VALID_VARIANTS.includes(APP.variant) ? APP.variant : 'obsidian-brass';
  APP.variant = v;
  document.documentElement.setAttribute('data-variant', v);
  // Sincronizar estado visual de los cards + live preview on hover
  document.querySelectorAll('#variantGrid .variant-card').forEach(card => {
    card.classList.toggle('active', card.dataset.variant === v);
    card.setAttribute('aria-pressed', card.dataset.variant === v ? 'true' : 'false');
    if (!card._variantPreviewWired) {
      card._variantPreviewWired = true;
      card.addEventListener('mouseenter', () => document.documentElement.setAttribute('data-variant', card.dataset.variant));
      card.addEventListener('mouseleave', () => document.documentElement.setAttribute('data-variant', APP.variant));
    }
  });
}

function setVariant(newVariant) {
  if (!VALID_VARIANTS.includes(newVariant)) return;
  if (APP.variant === newVariant) return;
  APP.variant = newVariant;
  applyVariant();
  saveData();
  // Destroy all charts so they recreate with the new variant's accent color
  Object.keys(Charts._r).forEach(k => Charts.destroy(k));
  if (typeof markDashboardDirty === 'function') markDashboardDirty();
  setTimeout(() => renderSection(APP.activeSection), 50);
  showToast?.('Apariencia actualizada ✓', 'success');
}


function togglePrivacy() {
  APP.privacyMode = !APP.privacyMode;
  applyPrivacy();
  saveData();
}

function applyPrivacy() {
  document.documentElement.classList.toggle('privacy-mode', APP.privacyMode);
  const icon  = document.getElementById('privacyIcon');
  const label = document.getElementById('privacyLabel');
  const btn   = document.getElementById('btnPrivacy');
  if (icon)  icon.textContent  = APP.privacyMode ? '🙈' : '👁';
  if (label) label.textContent = APP.privacyMode ? 'Mostrar' : 'Privacidad';
  if (btn)   btn.title         = APP.privacyMode ? 'Mostrar valores' : 'Ocultar valores';
}

/* ═══════════════════════════════════════════════════════════════
   18. UTILIDADES DOM
═══════════════════════════════════════════════════════════════ */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _validateTextInput(val, fieldName) {
  if (val.length > 60) { showToast(`${fieldName}: máximo 60 caracteres`, 'error'); return false; }
  if (/[<>"]/.test(val)) { showToast(`${fieldName} contiene caracteres no permitidos (< > ")`, 'error'); return false; }
  return true;
}

/** Dato demo de patrimonio: añadir línea de llamada */
function loadDemoData() {
  const today    = getTodayStr();
  const thisYear = new Date().getFullYear();
  const now      = new Date();

  // Months relative to today so the active month always has data regardless of when demo is run
  const _monthStr = (offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const m0 = _monthStr(0);  // current month
  const m1 = _monthStr(-1); // last month
  const m2 = _monthStr(-2); // 2 months ago

  // Transacciones de ejemplo
  APP.transactions = [
    { id: generateId(), type: 'income',  date: `${m2}-02`, description: 'Nómina',              category: 'Salario',      amount: 2800 },
    { id: generateId(), type: 'expense', date: `${m2}-05`, description: 'Hipoteca / Alquiler', category: 'Vivienda',     amount: 850  },
    { id: generateId(), type: 'expense', date: `${m2}-10`, description: 'Supermercado',         category: 'Alimentación', amount: 210  },
    { id: generateId(), type: 'expense', date: `${m2}-15`, description: 'Netflix + Spotify',   category: 'Suscripciones',amount: 22   },
    { id: generateId(), type: 'income',  date: `${m1}-03`, description: 'Nómina',              category: 'Salario',      amount: 2800 },
    { id: generateId(), type: 'expense', date: `${m1}-08`, description: 'Hipoteca / Alquiler', category: 'Vivienda',     amount: 850  },
    { id: generateId(), type: 'expense', date: `${m1}-12`, description: 'Restaurantes',         category: 'Restaurantes', amount: 145  },
    { id: generateId(), type: 'income',  date: `${m0}-02`, description: 'Nómina',              category: 'Salario',      amount: 2800 },
    { id: generateId(), type: 'expense', date: `${m0}-05`, description: 'Hipoteca / Alquiler', category: 'Vivienda',     amount: 850  },
    { id: generateId(), type: 'income',  date: today,      description: 'Freelance diseño web',category: 'Freelance',    amount: 600  },
    { id: generateId(), type: 'expense', date: today,      description: 'Gasolina',            category: 'Transporte',   amount: 80   },
  ];

  // Cartera
  APP.portfolio = [
    { id: generateId(), name: 'Microsoft',  ticker: 'MSFT', buyPrice: 290,   currentPrice: 415,   quantity: 10,  country: '🇺🇸 EEUU'    },
    { id: generateId(), name: 'Apple Inc.', ticker: 'AAPL', buyPrice: 150,   currentPrice: 185,   quantity: 20,  country: '🇺🇸 EEUU'    },
    { id: generateId(), name: 'Inditex',    ticker: 'ITX',  buyPrice: 28,    currentPrice: 42.5,  quantity: 50,  country: '🇪🇸 España'  },
    { id: generateId(), name: 'NVIDIA',     ticker: 'NVDA', buyPrice: 450,   currentPrice: 875,   quantity: 5,   country: '🇺🇸 EEUU'    },
    { id: generateId(), name: 'Santander',  ticker: 'SAN',  buyPrice: 4.20,  currentPrice: 3.80,  quantity: 200, country: '🇪🇸 España'  },
  ];

  // Watchlist
  APP.watchlist = [
    { id: generateId(), name: 'Tesla',    ticker: 'TSLA', currentPrice: 175,  targetPrice: 220, alertType: 'above', notes: 'Esperar corrección' },
    { id: generateId(), name: 'Amazon',   ticker: 'AMZN', currentPrice: 195,  targetPrice: 180, alertType: 'below', notes: 'Objetivo entrada' },
    { id: generateId(), name: 'LVMH',     ticker: 'MC',   currentPrice: 690,  targetPrice: 750, alertType: 'above', notes: 'Largo plazo' },
  ];

  // Presupuestos de ejemplo
  APP.budgets = [
    { id: generateId(), category: 'Restaurantes', monthlyAmount: 300 },
    { id: generateId(), category: 'Ocio',         monthlyAmount: 150 },
    { id: generateId(), category: 'Alimentación', monthlyAmount: 400 },
  ];

  // Dividendos
  APP.dividends = [
    { id: generateId(), assetName: 'Santander',  ticker: 'SAN', dividendPerShare: 0.10, frequency: 'quarterly', shares: 200 },
    { id: generateId(), assetName: 'Inditex',    ticker: 'ITX', dividendPerShare: 1.40, frequency: 'annual',    shares: 50  },
  ];

  // Cuentas de efectivo
  APP.cashAccounts = [
    { id: generateId(), name: 'Cuenta corriente BBVA',  amount: 4200  },
    { id: generateId(), name: 'Cuenta ahorro Revolut',  amount: 8500  },
    { id: generateId(), name: 'Fondo emergencia',       amount: 12000 },
  ];

  // Activos alternativos
  APP.alternatives = [
    { id: generateId(), name: 'Rolex Submariner 116610LN', category: 'Relojería', buyPrice: 8500,  currentPrice: 11200, purchaseDate: `${thisYear - 2}-03-15`, notes: 'Caja y papeles completos' },
    { id: generateId(), name: 'Litografía Miró',           category: 'Arte',      buyPrice: 2000,  currentPrice: 2800,  purchaseDate: `${thisYear - 1}-07-20`, notes: 'Firmada y numerada' },
  ];

  // Inmuebles de ejemplo
  APP.properties = [
    { id: generateId(), name: 'Piso Madrid Centro', type: 'vivienda_habitual', address: 'Calle Gran Vía, 28, Madrid', purchasePrice: 220000, currentValue: 265000, purchaseDate: `${thisYear - 4}-06-01`, notes: 'Hipoteca Santander pendiente' },
    { id: generateId(), name: 'Local comercial Valencia', type: 'alquiler', address: 'Av. del Puerto, 12, Valencia', purchasePrice: 95000, currentValue: 112000, monthlyRent: 750, purchaseDate: `${thisYear - 2}-09-15` },
  ];

  // Objetivos
  APP.goals = [
    { id: generateId(), emoji: '🏠', name: 'Entrada piso',        targetAmount: 50000, currentAmount: 20500, deadline: `${thisYear + 2}-06-01`, description: 'Para la entrada de la hipoteca' },
    { id: generateId(), emoji: '✈️', name: 'Viaje a Japón',       targetAmount: 5000,  currentAmount: 1800,  deadline: `${thisYear + 1}-04-01`, description: 'Tokyo + Kyoto + Osaka' },
    { id: generateId(), emoji: '🛡️', name: 'Fondo de emergencia', targetAmount: 15000, currentAmount: 12000, deadline: '',                     description: '6 meses de gastos' },
  ];

  // Ventas de demo
  APP.sales = [
    { id: generateId(), name: 'Amazon',  ticker: 'AMZN', buyDate: `${thisYear-1}-03-10`, sellDate: `${m2}-15`, buyPrice: 120,   sellPrice: 165,   quantity: 10,  isCrypto: false },
    { id: generateId(), name: 'Meta',    ticker: 'META', buyDate: `${thisYear-2}-06-01`, sellDate: `${m1}-20`, buyPrice: 280,   sellPrice: 210,   quantity: 5,   isCrypto: false },
    { id: generateId(), name: 'Bitcoin', ticker: 'BTC',  buyDate: `${thisYear-1}-11-01`, sellDate: `${m1}-01`, buyPrice: 35000, sellPrice: 58000, quantity: 0.5, isCrypto: true  },
  ];

  // Histórico patrimonial (últimos 8 meses simulados)
  const nowDate  = new Date();
  APP.networthHistory = [];
  for (let i = 7; i >= 1; i--) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const randomVariation = 1 + (Math.random() * 0.06 - 0.02);
    const baseValue = 48000 * Math.pow(randomVariation, 8 - i);
    APP.networthHistory.push({ date: month, value: Math.round(baseValue) });
  }

  updateNetworthHistory();

  // Bizums de demostración
  loadDemoBizums();
}

function toggleDevMode() {
  if (!APP.isAdmin) return;
  APP.devMode = !APP.devMode;
  const btn = document.getElementById('btnDevMode');
  if (btn) btn.classList.toggle('active', APP.devMode);
  const card = document.getElementById('admin-dev-card');
  if (card) card.style.display = APP.devMode ? '' : 'none';
  if (APP.devMode) {
    navigateTo('admin');
    _refreshDevCard();
  }
}

function _refreshDevCard() {
  const grid = document.getElementById('dev-info-grid');
  if (!grid) return;
  const lsSize = (() => { try { return (JSON.stringify(localStorage).length / 1024).toFixed(1) + ' KB'; } catch { return '?'; } })();
  const quota  = navigator.storage?.estimate ? '—' : '—';
  grid.innerHTML = `
    <div class="admin-health-item"><span>🔑</span><strong>UID:</strong> <code style="font-size:11px;word-break:break-all">${APP.uid || '—'}</code></div>
    <div class="admin-health-item"><span>📧</span><strong>Email:</strong> <code>${APP.userEmail || '—'}</code></div>
    <div class="admin-health-item"><span>📍</span><strong>Sección activa:</strong> <code>${APP.activeSection || '—'}</code></div>
    <div class="admin-health-item"><span>💾</span><strong>LocalStorage:</strong> <code>${lsSize}</code></div>
    <div class="admin-health-item"><span>💳</span><strong>Transacciones:</strong> <code>${APP.transactions?.length || 0}</code></div>
    <div class="admin-health-item"><span>📈</span><strong>Activos cartera:</strong> <code>${APP.portfolio?.length || 0}</code></div>
    <div class="admin-health-item"><span>🎯</span><strong>Objetivos:</strong> <code>${APP.goals?.length || 0}</code></div>
    <div class="admin-health-item"><span>🌐</span><strong>Online:</strong> <code>${navigator.onLine ? 'Sí' : 'No'}</code></div>
    <div class="admin-health-item"><span>🖥</span><strong>User Agent:</strong> <code style="font-size:10px">${navigator.userAgent.slice(0, 60)}…</code></div>
    <div class="admin-health-item"><span>⏱</span><strong>Timestamp:</strong> <code>${new Date().toLocaleTimeString('es-ES')}</code></div>`;
}

function _adminLoadDemoData() {
  if (!APP.isAdmin) return;
  openModal(
    '¿Cargar datos de ejemplo?',
    'Esto sobrescribirá todos tus datos actuales con datos de demostración. Esta acción no se puede deshacer.',
    () => {
      loadDemoData();
      saveData();
      renderSection(APP.activeSection);
      showToast('Datos de ejemplo cargados correctamente', 'success');
    }
  );
}

/* ═══════════════════════════════════════════════════════════════
   20. INICIALIZACIÓN
═══════════════════════════════════════════════════════════════ */
function _showDemoBanner() {
  const main = document.querySelector('.main-content');
  if (!main) return;
  const b = document.createElement('div');
  b.id = 'demo-banner';
  b.className = 'demo-banner';
  b.innerHTML = '🎭 Modo demo activo — datos ficticios, ningún cambio se guarda &nbsp;&nbsp;<a href="' + location.pathname + '" class="demo-banner-link">Salir del demo →</a>';
  main.prepend(b);
}

async function init() {
  if (_isDemoMode) {
    // Demo: cargar datos ficticios sin tocar localStorage
    loadDemoData();
    APP.onboardingDone = true;
  } else {
    // 1. Cargar datos guardados
    loadData();
    await _checkStorageRecovery(); // recuperar de IDB/cookie si Safari borró localStorage
    _pingSession();                // métricas de retención — fire-and-forget
    if (typeof checkBankCallback === 'function') checkBankCallback();
    checkStorageWarning();
    await loadAllApiKeys();

    // Migrar fotos base64 heredadas a IndexedDB
    _migratePhotosToIDB();

    // Auto-refresh tipos de cambio si hay activos en divisa extranjera y los datos tienen >7 días
    const _nonEurOnInit = APP.portfolio.filter(a => a.currency && a.currency !== 'EUR');
    if (_nonEurOnInit.length > 0) {
      const _lastFx = APP.exchangeRatesUpdated;
      const _fxAge  = _lastFx ? (Date.now() - new Date(_lastFx).getTime()) / 86400000 : Infinity;
      if (_fxAge > 7) refreshExchangeRates(true);
    }
  }

  // 2b. Onboarding — mostrar si es la primera vez (saltado en modo demo)
  if (!_isDemoMode) {
    // Usuarios con datos pre-existentes (sin la clave en localStorage) se marcan como ya onboarded
    // sin tocar a quienes sí tienen la clave pero la resetearon deliberadamente
    try {
      const _raw = JSON.parse(localStorage.getItem(_getStorageKey()) || '{}');
      const _onboardingKeyAbsent = !('onboardingDone' in _raw);
      const _hasExistingData = APP.transactions.length > 0 || APP.portfolio.length > 0 ||
        APP.cashAccounts.length > 0 || APP.alternatives.length > 0 || APP.freshStart;
      if (_onboardingKeyAbsent && _hasExistingData) APP.onboardingDone = true;
    } catch {}
  }
  // Flag checked before first render — no timeout, no flash
  const _needsOnboarding = !_isDemoMode && !APP.onboardingDone;

  // 3. Aplicar tema y privacidad
  applyTheme();
  applyVariant();
  applyPrivacy();

  // 4. Mostrar fecha actual
  const dateEl = document.getElementById('currentDate');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  // 5. Asignar eventos de navegación
  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });
  document.getElementById('nav-group-toggle-inversiones')?.addEventListener('click', toggleInversionesGroup);
  document.getElementById('nav-group-toggle-transacciones')?.addEventListener('click', toggleTransaccionesGroup);

  // 6. Sidebar: colapsar/expandir
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar       = document.getElementById('sidebar');
  if (sidebarToggle && sidebar) {
    // Restaurar estado al cargar
    if (APP.sidebarCollapsed) sidebar.classList.add('collapsed');
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      APP.sidebarCollapsed = sidebar.classList.contains('collapsed');
      saveData();
    });
  }

  // 7. Menú móvil
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
      sidebarOverlay?.classList.toggle('active');
    });
  }
  // Cerrar sidebar al tocar el overlay
  sidebarOverlay?.addEventListener('click', closeMobileSidebar);

  // 8. Modal: cerrar al hacer clic en el overlay (los botones ya tienen onclick)
  document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });

  // 11. Filtros de transacciones — debounce para evitar renders repetidos
  const debouncedTxRender = debounce(() => { _txPage = 1; updateTransactionSummary(); renderTransactionTable(); }, 200);
  ['tx-filter-type', 'tx-filter-category', 'tx-filter-month'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      el.classList.toggle('filter-active', el.value !== 'all' && el.value !== '');
      if (id === 'tx-filter-month') APP.txFilterMonth = el.value;
      if (typeof _txUpdateClearBtn === 'function') _txUpdateClearBtn();
      debouncedTxRender();
    });
  });

  // 11b. Filtros de bizums
  ['biz-filter-dir', 'biz-filter-status', 'biz-filter-person'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      el.classList.toggle('filter-active', el.value !== 'all' && el.value !== '');
      renderBizumTable();
    });
  });

  // 12. Global click dispatcher (replaces all inline onclick in HTML)
  document.addEventListener('click', _globalClickDispatch);

  // 13. Navegación inferior móvil
  document.querySelectorAll('.mobile-nav-btn[data-section]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  // Mobile menu drawer
  const _drawer   = document.getElementById('mobileMenuDrawer');
  const _backdrop = document.getElementById('mobileMenuBackdrop');

  const _MMG_MAP = {
    transactions: 'mmg-transacciones', bizums: 'mmg-transacciones', recurring: 'mmg-transacciones',
    portfolio: 'mmg-inversiones', watchlist: 'mmg-inversiones', dividends: 'mmg-inversiones',
  };

  const _openMobileMenu = () => {
    if (!_drawer) return;
    _drawer.classList.add('open');
    _backdrop.classList.add('open');
    _drawer.setAttribute('aria-hidden', 'false');
    const cur = APP.activeSection;
    // Mark active item
    _drawer.querySelectorAll('.mobile-menu-item[data-section]').forEach(item => {
      item.classList.toggle('active', item.dataset.section === cur);
    });
    // Auto-expand the group that contains the active section
    const activeGroup = _MMG_MAP[cur];
    _drawer.querySelectorAll('.mobile-menu-subitems').forEach(sub => {
      const shouldOpen = sub.id === activeGroup;
      sub.classList.toggle('open', shouldOpen);
      const hdr = sub.previousElementSibling;
      if (hdr) hdr.classList.toggle('open', shouldOpen);
    });
  };

  const _closeMobileMenu = () => {
    if (!_drawer) return;
    _drawer.classList.remove('open');
    _backdrop.classList.remove('open');
    _drawer.setAttribute('aria-hidden', 'true');
  };

  // Group toggle
  _drawer?.querySelectorAll('.mobile-menu-group-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const sub = document.getElementById(hdr.dataset.group);
      if (!sub) return;
      const isOpen = sub.classList.toggle('open');
      hdr.classList.toggle('open', isOpen);
    });
  });

  document.getElementById('mobileNavMenuBtn')?.addEventListener('click', _openMobileMenu);
  document.getElementById('mobileMenuClose')?.addEventListener('click', _closeMobileMenu);
  _backdrop?.addEventListener('click', _closeMobileMenu);
  _drawer?.querySelectorAll('.mobile-menu-item[data-section]').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.section);
      _closeMobileMenu();
    });
  });

  // Búsqueda global — input en tiempo real
  document.getElementById('searchInput')?.addEventListener('input', handleSearchInput);

  // IA — textarea y sugerencias ya tienen onkeydown/oninput/onclick en el HTML

  // 14. Teclas globales: modal, atajos y búsqueda
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('modalOverlay');
    const searching = document.getElementById('searchOverlay')?.classList.contains('open');

    // Escape cierra lo que esté abierto
    if (e.key === 'Escape') {
      if (searching) { closeSearch(); return; }
      closeModal();
      return;
    }

    // Enter confirma modal — ignorar si el foco está en un input/textarea
    if (e.key === 'Enter' && modal.classList.contains('open')) {
      const tag  = document.activeElement?.tagName;
      const type = document.activeElement?.type;
      if (tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && type !== 'checkbox' && type !== 'radio') return;
      _fireModalConfirm();
      return;
    }

    // Navegación en búsqueda (↑↓↵)
    if (searching) {
      if (e.key === 'ArrowDown') { e.preventDefault(); searchMoveActive(1);  return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); searchMoveActive(-1); return; }
      if (e.key === 'Enter')     { e.preventDefault(); searchConfirmActive(); return; }
      return; // no ejecutar atajos mientras busca
    }

    // No disparar atajos si el usuario está escribiendo en un input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Ctrl/Cmd+K → búsqueda global
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); return; }

    // Atajos de letra (sin modificadores — excepto ? que requiere Shift)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); showKeyboardHelp(); return; }
    if (e.key === '/') {
      const searchEl = document.getElementById('tx-filter-search');
      if (searchEl && APP.activeSection === SECTIONS.TRANSACTIONS) {
        e.preventDefault();
        searchEl.focus();
        searchEl.select();
        return;
      }
    }
    if (!e.key) return;
    switch (e.key.toLowerCase()) {
      case 'n': e.preventDefault(); openAddTransaction(); break;
      case 'i': e.preventDefault(); openAddAsset();       break;
      case 'g': e.preventDefault(); navigateTo('dashboard'); break;
      case 't': e.preventDefault(); toggleTheme(); break;
      case 'p': e.preventDefault(); togglePrivacy(); break;
    }
  });

  // 15b. Inicializar pestañas internas
  initInnerTabs();

  // 15c. Escala del gráfico
  initScaleButtons();

  // 15d. Ajustes iniciales
  initSettings();

  // 15. Si la sección activa es una sub-sección de Inversiones, abrir el grupo
  if (INVERSIONES_SUBS.includes(APP.activeSection)) {
    document.getElementById('nav-group-toggle-inversiones')?.classList.add('open');
    document.getElementById('nav-sub-inversiones')?.classList.add('open');
  }
  if (TRANSACCIONES_SUBS.includes(APP.activeSection)) {
    document.getElementById('nav-group-toggle-transacciones')?.classList.add('open');
    document.getElementById('nav-sub-transacciones')?.classList.add('open');
  }

  // 16. Renderizar sección inicial — onboarding shown first so overlay covers empty state
  if (_needsOnboarding) {
    _ensureScript('./src/utils/onboarding.js').then(() => { if (typeof showOnboarding === 'function') showOnboarding(); });
  }
  navigateTo(APP.activeSection || 'dashboard');

  // Ocultar pantalla de carga con fade-out
  const loadingEl = document.getElementById('app-loading');
  if (loadingEl) loadingEl.classList.add('hidden');

  // 17. Auto-actualización de precios cada 10 minutos (desactivado en demo)
  if (!_isDemoMode) {
    const PRICE_REFRESH_MS = 10 * 60 * 1000;
    const _hasTickers = () => APP.portfolio.some(a => a.ticker) || APP.watchlist.some(a => a.ticker);
    if (_hasTickers()) {
      const _age = APP.lastPriceRefresh ? Date.now() - APP.lastPriceRefresh : Infinity;
      if (_age > PRICE_REFRESH_MS) refreshAllPrices(true);
    }
    setInterval(() => { if (_hasTickers()) refreshAllPrices(true); }, PRICE_REFRESH_MS);
  }

  if (_isDemoMode) _showDemoBanner();

  // Notificar recurrentes vencidos después del render inicial
  if (!_isDemoMode && typeof checkDueRecurring === 'function') {
    setTimeout(checkDueRecurring, 1200);
  }

  // Bank auto-sync — start polling if there are connected accounts
  if (!_isDemoMode && (APP.bankConnections || []).length) {
    _ensureScript('./src/utils/bank-connect.js').then(() => {
      if (typeof _bankStartAutoSync === 'function') _bankStartAutoSync();
    });
  }

  // Handle PWA shortcut actions from manifest.json shortcuts
  const _startAction = new URLSearchParams(location.search).get('action');
  if (_startAction === 'quick-add') {
    setTimeout(() => openAddTransaction(), 600);
    history.replaceState({}, '', location.pathname);
  }

  // Monthly briefing prompt — first day of the month, once per month
  if (!_isDemoMode && new Date().getDate() === 1) {
    const prevMonth = getPreviousMonth(getCurrentMonth());
    if (APP.lastMonthlyBriefing !== prevMonth && APP.transactions.length > 0) {
      setTimeout(() => {
        showToast(
          '📊 Informe mensual listo — ' + new Date(prevMonth + '-01').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
          'info',
          { duration: 12000, action: { label: 'Descargar PDF', action: 'monthly-briefing' } }
        );
      }, 2500);
    }
  }

  // ── Inicializar header móvil
  if (window.innerWidth <= 768) initMobileHeader();
  window.addEventListener('resize', () => { if (window.innerWidth <= 768) initMobileHeader(); }, { once: true });

  // ── Personalización de secciones
  injectCustomizerButtons();
  applySectionLayouts();

  console.log('%c FINOVA iniciado ✓', 'color: #c8a96e; font-weight: bold; font-size: 14px;');
}

let _autosaveTimer = null;
function _flashAutosave() {
  const el = document.getElementById('autosave-indicator');
  if (!el) return;
  el.style.display = '';
  el.classList.add('autosave-visible');
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    el.classList.remove('autosave-visible');
    setTimeout(() => { el.style.display = 'none'; }, 400);
  }, 1500);
}

// PWA install prompt
let _pwaInstallEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaInstallEvent = e;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = '';
});
window.addEventListener('appinstalled', () => {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'none';
  _pwaInstallEvent = null;
});

function installPWA() {
  if (!_pwaInstallEvent) return;
  _pwaInstallEvent.prompt();
  _pwaInstallEvent.userChoice.then(() => {
    _pwaInstallEvent = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
  });
}

// Back-to-top button visibility
window.addEventListener('scroll', () => {
  const btn = document.getElementById('btn-back-to-top');
  if (btn) btn.style.display = window.scrollY > 300 ? '' : 'none';
}, { passive: true });

// Auto-select numeric input text on focus (better UX for amount fields)
document.addEventListener('focusin', e => {
  if (e.target.matches('input[type="number"], input[type="text"].amount-input')) {
    e.target.select();
  }
}, { capture: true });

// Double-click on a transaction amount cell to copy it to clipboard
document.addEventListener('dblclick', e => {
  const td = e.target.closest('#transactions-tbody td.pvt');
  if (!td) return;
  const text = td.textContent.trim().replace(/[^\d,.+-]/g, '').replace(',', '.');
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => {
    showToast(`Importe copiado: ${td.textContent.trim()}`, 'success');
  }).catch(() => {});
});

// Click on a ticker chip in portfolio/watchlist/dividends to copy ticker to clipboard
document.addEventListener('click', e => {
  const chip = e.target.closest('.ticker-chip');
  if (!chip) return;
  const ticker = chip.textContent.trim();
  if (!ticker) return;
  navigator.clipboard?.writeText(ticker).then(() => {
    showToast(`Ticker copiado: ${ticker}`, 'success');
  }).catch(() => {});
});

// Iniciar cuando el DOM esté listo
// Si auth.js está cargado (Firebase configurado) → initAuth() gestiona el flujo
// En caso contrario → arrancar directamente sin autenticación
document.addEventListener('DOMContentLoaded', () => {
  (typeof initAuth === 'function' ? initAuth() : init()).catch(console.error);
});

/* ═══════════════════════════════════════════════════════════════
   GLOBAL CLICK DISPATCHER — routes data-action attributes
   (replaces all inline onclick="..." in index.html)
═══════════════════════════════════════════════════════════════ */
function _globalClickDispatch(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;

  // Search overlay backdrop — only close when the overlay itself is clicked
  if (a === 'search-overlay-close') { if (e.target === el) closeSearch(); return; }

  switch (a) {
    // Profile / Sidebar
    case 'save-profile-name':          saveProfileName(); break;
    case 'toggle-theme-dropdown':      toggleTheme(); updateProfileDropdown(); break;
    case 'toggle-privacy-dropdown':    togglePrivacy(); updateProfileDropdown(); break;
    case 'open-milestones-dropdown':   closeProfileDropdown(); openMilestoneGallery(); break;
    case 'download-backup-dropdown':   downloadBackup(); closeProfileDropdown(); break;
    case 'toggle-profile-dropdown':    toggleProfileDropdown(); break;
    case 'toggle-theme-btn':           e.stopPropagation(); toggleTheme(); break;
    case 'download-backup-btn':        e.stopPropagation(); downloadBackup(); break;
    case 'open-search':                openSearch(); break;
    case 'toggle-privacy':             togglePrivacy(); break;
    // Dashboard
    case 'export-monthly-pdf':         exportMonthlyPDF(); break;
    case 'monthly-briefing':           exportMonthlyBriefingPDF(); break;
    case 'quick-add-nav':              navigateTo('transactions'); setTimeout(() => document.getElementById('quick-add-input')?.focus(), 120); break;
    case 'navigate':                   navigateTo(el.dataset.section); break;
    case 'rule5030-settings':          openRule5030Settings(); break;
    // Transactions
    case 'toggle-io-dropdown':         toggleIODropdown(e); break;
    case 'export-csv':                 exportTransactionsCSV(); closeIODropdown(); break;
    case 'import-csv':                 importTransactionsCSV(); closeIODropdown(); break;
    case 'import-ofx':                 importOFXFile(); closeIODropdown(); break;
    case 'add-transaction':            openAddTransaction(); break;
    case 'manage-categories':          openManageCategories(); break;
    case 'quick-add-submit':           quickAddSubmit(); break;
    case 'toggle-tx-favorites':        toggleTxFavorites(); break;
    case 'export-tx-csv':              exportTransactionsCSV(); break;
    case 'clear-tx-filters':           clearTxFilters(); break;
    case 'tx-prev-month':              _txNavigateMonth(-1); break;
    case 'tx-next-month':              _txNavigateMonth(1); break;
    case 'tx-period-current':          _txSetPeriodPreset('current'); break;
    case 'tx-period-prev':             _txSetPeriodPreset('prev'); break;
    case 'tx-period-all':              _txSetPeriodPreset('all'); break;
    case 'manage-budgets':             e.preventDefault(); openManageBudgets(); break;
    case 'add-recurring':              openAddRecurring(); break;
    case 'add-bizum':                  openAddBizum(); break;
    // Portfolio
    case 'export-excel':               exportPortfolioExcel(); break;
    case 'refresh-prices':             refreshAllPrices(); break;
    case 'refresh-fx':                 refreshExchangeRates(); break;
    case 'add-asset':                  openAddAsset(); break;
    case 'portfolio-sort':             setPortfolioSort(el.dataset.col); break;
    case 'add-watchlist':              openAddWatchlistItem(); break;
    case 'add-dividend':               openAddDividend(); break;
    // Net worth
    case 'open-milestones':            openMilestoneGallery(); break;
    case 'add-cash':                   openAddCashAccount(); break;
    case 'add-property':               openAddProperty(); break;
    case 'add-liability':              openAddLiability(); break;
    // Other sections
    case 'add-alternative':            openAddAlternative(); break;
    case 'add-goal':                   openAddGoal(); break;
    case 'run-simulator':              runSimulator(); break;
    case 'save-scenario':              saveSimulatorScenario(); break;
    case 'export-fiscal-pdf':          exportFiscalPDF(); break;
    case 'add-sale':                   openAddSale(); break;
    case 'add-crypto-sale':            openAddSale(null, true); break;
    case 'run-fiscal-sim':             runFiscalSimulator(); break;
    case 'edit-trabajo':               openEditTrabajo(); break;
    case 'edit-minimos':               openEditMinimos(); break;
    // AI
    case 'ai-clear':                   aiClearHistory(); break;
    case 'set-ai-provider':            setAiProvider(el.dataset.provider); break;
    case 'ai-suggest':                 aiAsk(el.dataset.prompt); break;
    case 'ai-habits':                  aiAnalyzeHabits(); break;
    case 'ai-toggle-ctx':              toggleAiContext(); break;
    case 'ai-send':                    aiSend(); break;
    // Settings
    case 'ob-welcome-done':            obWelcomeDone(); break;
    case 'open-dashboard-editor':      openDashboardEditor(); break;
    case 'toggle-settings-disclaimer': toggleSettingsDisclaimer(el); break;
    case 'download-backup':            downloadBackup(); break;
    case 'sync-generate':              syncGenerateCode(el); break;
    case 'sync-upload':                syncUpload(); break;
    case 'sync-download':              syncDownload(); break;
    case 'save-webhook':               saveWebhookUrl(); break;
    case 'test-webhook':               testWebhook(); break;
    case 'webhook-export-full':        exportViaWebhook('full'); break;
    case 'webhook-export-month':       exportViaWebhook('month'); break;
    case 'show-onboarding':            _ensureScript('./src/utils/onboarding.js').then(() => showOnboarding()); break;
    case 'show-keyboard-help':         showKeyboardHelp(); break;
    case 'start-tour':                 _ensureScript('./src/utils/onboarding.js').then(() => obStartTour()); break;
    case 'run-tests':                  _ensureScript('./src/utils/tests.js').then(() => runTests()); break;
    case 'clear-photo-backups':        clearPhotoBackups(); break;
    case 'reset-dialog':               openResetDialog(); break;
    // Modal
    case 'close-modal':                closeModal(); break;
    case 'modal-confirm':              modalConfirmClick(); break;
    // Search
    case 'close-search':               closeSearch(); break;
    // Tour
    case 'ob-tour-skip':               obTourSkip(); break;
    case 'ob-tour-prev':               obTourPrev(); break;
    case 'ob-tour-next':               obTourNext(); break;
  }
}

/* ═══════════════════════════════════════════════════════════════
   21. EXPORTACIÓN CSV
═══════════════════════════════════════════════════════════════ */
function downloadCSV(filename, headers, rows) {
  const esc = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map(r => r.map(esc).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportTransactionsCSV() {
  const headers = ['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Importe (€)'];
  const rows = [...APP.transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(t => [t.date, t.description, t.category, t.type === 'income' ? 'Ingreso' : 'Gasto', t.amount.toFixed(2)]);
  downloadCSV(`finova-transacciones-${getTodayStr()}.csv`, headers, rows);
  showToast(`${rows.length} transacciones exportadas ✓`, 'success');
}

function exportPortfolioExcel() {
  // ── Cálculos ─────────────────────────────────────────────────
  const totalValue   = calcPortfolioValue();
  const totalCost    = APP.portfolio.reduce((s,a) => s + a.buyPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1), 0);
  const totalGain    = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const annualDiv    = APP.dividends.reduce((s,d) => {
    const mult = { annual:1, semiannual:2, quarterly:4, monthly:12 }[d.frequency] || 1;
    return s + d.dividendPerShare * d.shares * mult;
  }, 0);
  const cashTotal = (APP.cashAccounts||[]).reduce((s,a) => s + (a.balance||0), 0);
  const liabTotal = (APP.liabilities||[]).reduce((s,l) => s + (l.amount||0), 0);
  const altTotal  = (APP.alternatives||[]).reduce((s,a) => s + (a.value||0), 0);
  const netWorth  = totalValue + cashTotal + altTotal - liabTotal;

  // ── Helpers ──────────────────────────────────────────────────
  // xe: escapa XML + elimina caracteres de control inválidos en XML 1.0
  const xe  = v => String(v??'')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const sc  = (v,s) => `<Cell ss:StyleID="${s}"><Data ss:Type="String">${xe(v)}</Data></Cell>`;
  const nc  = (v,s) => `<Cell ss:StyleID="${s}"><Data ss:Type="Number">${isNaN(+v)?0:+v}</Data></Cell>`;
  const hc  = l => `<Cell ss:StyleID="s_hdr"><Data ss:Type="String">${xe(l)}</Data></Cell>`;
  const col = w => `<Column ss:Width="${w}"/>`;
  const freeze = () => `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>`;
  const af  = n => `<x:AutoFilter x:Range="R1C1:R1C${n}"/>`;

  // ── Estilos ──────────────────────────────────────────────────
  const STYLES = `
<Style ss:ID="s_title"><Font ss:Bold="1" ss:Size="16" ss:Color="#c8a96e"/><Interior ss:Color="#0f0d09" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_subtitle"><Font ss:Italic="1" ss:Size="9" ss:Color="#786846"/><Interior ss:Color="#0f0d09" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_section"><Font ss:Bold="1" ss:Size="9" ss:Color="#c8a96e"/><Interior ss:Color="#1a1510" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#c8a96e"/></Borders><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_hdr"><Font ss:Bold="1" ss:Size="10" ss:Color="#f5edd6"/><Interior ss:Color="#2b2416" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#c8a96e"/></Borders><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="s_kl"><Font ss:Bold="1" ss:Size="11" ss:Color="#a89060"/><Interior ss:Color="#181510" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_kv"><Font ss:Bold="1" ss:Size="12" ss:Color="#f5edd6"/><Interior ss:Color="#181510" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_kp"><Font ss:Bold="1" ss:Size="12" ss:Color="#f5edd6"/><Interior ss:Color="#181510" ss:Pattern="Solid"/><NumberFormat ss:Format="0.00&quot;%&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_kn"><Font ss:Bold="1" ss:Size="12" ss:Color="#f5edd6"/><Interior ss:Color="#181510" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_e"><Interior ss:Color="#19170f" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_o"><Interior ss:Color="#211e14" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_ne"><Interior ss:Color="#19170f" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><NumberFormat ss:Format="#,##0.0000"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_no"><Interior ss:Color="#211e14" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><NumberFormat ss:Format="#,##0.0000"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_ee"><Interior ss:Color="#19170f" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_oe"><Interior ss:Color="#211e14" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_ep"><Interior ss:Color="#19170f" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><NumberFormat ss:Format="0.00&quot;%&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_op"><Interior ss:Color="#211e14" ss:Pattern="Solid"/><Font ss:Color="#d4cabb" ss:Size="10"/><NumberFormat ss:Format="0.00&quot;%&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_gp"><Interior ss:Color="#0b1c0f" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#4caf78" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_gn"><Interior ss:Color="#1c0b0b" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#e05353" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_pp"><Interior ss:Color="#0b1c0f" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#4caf78" ss:Size="10"/><NumberFormat ss:Format="0.00&quot;%&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_pn"><Interior ss:Color="#1c0b0b" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#e05353" ss:Size="10"/><NumberFormat ss:Format="0.00&quot;%&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_tot"><Interior ss:Color="#2b2416" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#c8a96e" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#c8a96e"/></Borders><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_totl"><Interior ss:Color="#2b2416" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#c8a96e" ss:Size="10"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#c8a96e"/></Borders><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_totp"><Interior ss:Color="#2b2416" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#c8a96e" ss:Size="10"/><NumberFormat ss:Format="0.00&quot;%&quot;"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#c8a96e"/></Borders><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_de"><Interior ss:Color="#19170f" ss:Pattern="Solid"/><Font ss:Color="#a89060" ss:Size="10"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="s_do"><Interior ss:Color="#211e14" ss:Pattern="Solid"/><Font ss:Color="#a89060" ss:Size="10"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="s_rm_ttl"><Font ss:Bold="1" ss:Size="20" ss:Color="#c8a96e"/><Interior ss:Color="#0a0804" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_rm_sub"><Font ss:Italic="1" ss:Size="10" ss:Color="#786846"/><Interior ss:Color="#0a0804" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_rm_bg"><Interior ss:Color="#0a0804" ss:Pattern="Solid"/><Font ss:Color="#0a0804" ss:Size="10"/></Style>
<Style ss:ID="s_rm_sec"><Font ss:Bold="1" ss:Size="11" ss:Color="#c8a96e"/><Interior ss:Color="#111009" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#c8a96e"/></Borders><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_rm_sht"><Font ss:Bold="1" ss:Size="10" ss:Color="#f5edd6"/><Interior ss:Color="#1a1510" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_rm_txt"><Font ss:Size="10" ss:Color="#a89878"/><Interior ss:Color="#1a1510" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_rm_tip"><Font ss:Italic="1" ss:Size="9" ss:Color="#5c5040"/><Interior ss:Color="#1a1510" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_inc_e"><Interior ss:Color="#0c1810" ss:Pattern="Solid"/><Font ss:Color="#9dd6b3" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_inc_o"><Interior ss:Color="#0f1d13" ss:Pattern="Solid"/><Font ss:Color="#9dd6b3" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_inc_ne"><Interior ss:Color="#0c1810" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#4caf78" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_inc_no"><Interior ss:Color="#0f1d13" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#4caf78" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_exp_e"><Interior ss:Color="#180b0b" ss:Pattern="Solid"/><Font ss:Color="#d4a3a3" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_exp_o"><Interior ss:Color="#1c0e0e" ss:Pattern="Solid"/><Font ss:Color="#d4a3a3" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="s_exp_ne"><Interior ss:Color="#180b0b" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#e05353" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_exp_no"><Interior ss:Color="#1c0e0e" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#e05353" ss:Size="10"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_nw_pos"><Font ss:Bold="1" ss:Size="13" ss:Color="#4caf78"/><Interior ss:Color="#181510" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
<Style ss:ID="s_nw_neg"><Font ss:Bold="1" ss:Size="13" ss:Color="#e05353"/><Interior ss:Color="#181510" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00&quot; €&quot;"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>`;

  // ── Hoja Leame ────────────────────────────────────────────────
  const readmeSheet = `<Worksheet ss:Name="Léame"><Table>
${col(260)}${col(400)}
<Row ss:Height="48"><Cell ss:StyleID="s_rm_ttl" ss:MergeAcross="1"><Data ss:Type="String">FINOVA — Libro de Inversión</Data></Cell></Row>
<Row ss:Height="20"><Cell ss:StyleID="s_rm_sub" ss:MergeAcross="1"><Data ss:Type="String">Exportado el ${getTodayStr()}  -  Generado por MyFinova</Data></Cell></Row>
<Row ss:Height="8"><Cell ss:StyleID="s_rm_bg"><Data ss:Type="String"></Data></Cell></Row>
<Row ss:Height="26"><Cell ss:StyleID="s_rm_sec" ss:MergeAcross="1"><Data ss:Type="String">  CONTENIDO DEL LIBRO</Data></Cell></Row>
<Row ss:Height="22">${sc('Léame','s_rm_sht')}${sc('Esta hoja - índice y guía del libro de Excel','s_rm_txt')}</Row>
<Row ss:Height="22">${sc('Resumen','s_rm_sht')}${sc('Visión consolidada: cartera, dividendos, efectivo y patrimonio neto','s_rm_txt')}</Row>
<Row ss:Height="22">${sc('Cartera','s_rm_sht')}${sc('Todos los activos con precio de compra, precio actual, ganancia y peso','s_rm_txt')}</Row>
<Row ss:Height="22">${sc('Dividendos','s_rm_sht')}${sc('Ingresos pasivos por dividendos con proyección anual y mensual','s_rm_txt')}</Row>
<Row ss:Height="22">${sc('Watchlist','s_rm_sht')}${sc('Activos en seguimiento con objetivo de precio y gap de entrada','s_rm_txt')}</Row>
<Row ss:Height="22">${sc('Transacciones','s_rm_sht')}${sc('Historial completo de ingresos y gastos personales','s_rm_txt')}</Row>
<Row ss:Height="22">${sc('Historial','s_rm_sht')}${sc('Evolución mensual del patrimonio neto con cartera, efectivo y variación mensual','s_rm_txt')}</Row>
<Row ss:Height="8"><Cell ss:StyleID="s_rm_bg"><Data ss:Type="String"></Data></Cell></Row>
<Row ss:Height="26"><Cell ss:StyleID="s_rm_sec" ss:MergeAcross="1"><Data ss:Type="String">  NOTAS</Data></Cell></Row>
<Row ss:Height="20"><Cell ss:StyleID="s_rm_tip" ss:MergeAcross="1"><Data ss:Type="String">- Las hojas de datos tienen filtros automáticos y la primera fila congelada para facilitar la navegación.</Data></Cell></Row>
<Row ss:Height="20"><Cell ss:StyleID="s_rm_tip" ss:MergeAcross="1"><Data ss:Type="String">- Los importes están en euros. Los activos en divisa extranjera se convierten al tipo de cambio registrado.</Data></Cell></Row>
<Row ss:Height="20"><Cell ss:StyleID="s_rm_tip" ss:MergeAcross="1"><Data ss:Type="String">- Las filas de TOTAL están separadas por un borde dorado para distinguirlas de los datos.</Data></Cell></Row>
<Row ss:Height="20"><Cell ss:StyleID="s_rm_tip" ss:MergeAcross="1"><Data ss:Type="String">- Compatible con Microsoft Excel y LibreOffice Calc.</Data></Cell></Row>
</Table></Worksheet>`;

  // ── Hoja Resumen ──────────────────────────────────────────────
  const nwStyle = netWorth >= 0 ? 's_nw_pos' : 's_nw_neg';
  const summarySheet = `<Worksheet ss:Name="Resumen"><Table>
${col(240)}${col(170)}
<Row ss:Height="40"><Cell ss:StyleID="s_title" ss:MergeAcross="1"><Data ss:Type="String">FINOVA — RESUMEN PATRIMONIAL</Data></Cell></Row>
<Row ss:Height="22"><Cell ss:StyleID="s_subtitle" ss:MergeAcross="1"><Data ss:Type="String">Exportado el ${getTodayStr()}  -  ${APP.portfolio.length} activos  -  ${APP.dividends.length} dividendos  -  ${(APP.transactions||[]).length} transacciones</Data></Cell></Row>
<Row ss:Height="10"><Cell><Data ss:Type="String"></Data></Cell></Row>
<Row ss:Height="24"><Cell ss:StyleID="s_section" ss:MergeAcross="1"><Data ss:Type="String">  CARTERA DE INVERSIÓN</Data></Cell></Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Valor total de cartera</Data></Cell>${nc(totalValue,'s_kv')}</Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Coste total invertido</Data></Cell>${nc(totalCost,'s_kv')}</Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Ganancia / Pérdida (€)</Data></Cell>${nc(totalGain,'s_kv')}</Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Rentabilidad total (%)</Data></Cell>${nc(totalGainPct,'s_kp')}</Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Activos en cartera</Data></Cell>${nc(APP.portfolio.length,'s_kn')}</Row>
<Row ss:Height="10"><Cell><Data ss:Type="String"></Data></Cell></Row>
<Row ss:Height="24"><Cell ss:StyleID="s_section" ss:MergeAcross="1"><Data ss:Type="String">  DIVIDENDOS</Data></Cell></Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Dividendos anuales proyectados</Data></Cell>${nc(annualDiv,'s_kv')}</Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Dividendos mensuales estimados</Data></Cell>${nc(annualDiv/12,'s_kv')}</Row>
<Row ss:Height="10"><Cell><Data ss:Type="String"></Data></Cell></Row>
<Row ss:Height="24"><Cell ss:StyleID="s_section" ss:MergeAcross="1"><Data ss:Type="String">  EFECTIVO Y PATRIMONIO NETO</Data></Cell></Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Efectivo (cuentas)</Data></Cell>${nc(cashTotal,'s_kv')}</Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Activos alternativos</Data></Cell>${nc(altTotal,'s_kv')}</Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Pasivos / Deudas</Data></Cell>${nc(liabTotal,'s_kv')}</Row>
<Row ss:Height="30"><Cell ss:StyleID="s_kl"><Data ss:Type="String">PATRIMONIO NETO TOTAL</Data></Cell>${nc(netWorth,nwStyle)}</Row>
<Row ss:Height="10"><Cell><Data ss:Type="String"></Data></Cell></Row>
<Row ss:Height="24"><Cell ss:StyleID="s_section" ss:MergeAcross="1"><Data ss:Type="String">  WATCHLIST</Data></Cell></Row>
<Row ss:Height="26"><Cell ss:StyleID="s_kl"><Data ss:Type="String">Activos en seguimiento</Data></Cell>${nc(APP.watchlist.length,'s_kn')}</Row>
</Table></Worksheet>`;

  // ── Hoja Cartera ──────────────────────────────────────────────
  const portfolioHdr = ['Activo','Ticker','País','Sector','Divisa','P. Compra','P. Actual','Cantidad','Coste (€)','Valor (€)','G/P (€)','G/P (%)','% Cartera','F. Compra'];
  const portfolioRows = APP.portfolio.map((a,i) => {
    const exr   = a.exchangeRate > 0 ? a.exchangeRate : 1;
    const cost  = a.buyPrice * a.quantity * exr;
    const value = a.currentPrice * a.quantity * exr;
    const gain  = value - cost;
    const gPct  = cost > 0 ? (gain/cost)*100 : 0;
    const cPct  = totalValue > 0 ? (value/totalValue)*100 : 0;
    const s     = i%2===0 ? 'e' : 'o';
    const gs    = gain >= 0 ? 's_gp' : 's_gn';
    const ps    = gain >= 0 ? 's_pp' : 's_pn';
    return `<Row ss:Height="20">${sc(a.name,`s_${s}`)}${sc(a.ticker||'-',`s_${s}`)}${sc(a.country||'-',`s_${s}`)}${sc(a.sector||'-',`s_${s}`)}${sc(a.currency||'EUR',`s_${s}`)}${nc(a.buyPrice,`s_n${s}`)}${nc(a.currentPrice,`s_n${s}`)}${nc(a.quantity,`s_n${s}`)}${nc(cost,`s_e${s}`)}${nc(value,`s_e${s}`)}${nc(gain,gs)}${nc(gPct,ps)}${nc(cPct,`s_${s}p`)}${sc(a.buyDate||'-',`s_d${s}`)}</Row>`;
  }).join('');
  const blankCols7 = Array(7).fill('').map(()=>`<Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell>`).join('');
  const portfolioSheet = `<Worksheet ss:Name="Cartera"><Table>
${col(170)}${col(65)}${col(85)}${col(110)}${col(60)}${col(85)}${col(85)}${col(72)}${col(105)}${col(105)}${col(95)}${col(78)}${col(78)}${col(90)}
<Row ss:Height="30">${portfolioHdr.map(hc).join('')}</Row>
${portfolioRows}
<Row ss:Height="26">${sc('TOTAL','s_totl')}${blankCols7}${nc(totalCost,'s_tot')}${nc(totalValue,'s_tot')}${nc(totalGain,'s_tot')}${nc(totalGainPct,'s_totp')}${nc(100,'s_totp')}<Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell></Row>
</Table>${af(14)}${freeze()}</Worksheet>`;

  // ── Hoja Dividendos ───────────────────────────────────────────
  const FREQ_L = { annual:'Anual', semiannual:'Semestral', quarterly:'Trimestral', monthly:'Mensual' };
  const FREQ_M = { annual:1, semiannual:2, quarterly:4, monthly:12 };
  const divHdr = ['Activo','Ticker','Divid./Acción (€)','Frecuencia','Acciones','Divid. Anual (€)','Divid. Mensual Est. (€)'];
  const divRows = APP.dividends.map((d,i) => {
    const mult = FREQ_M[d.frequency]||1;
    const ann  = d.dividendPerShare * d.shares * mult;
    const s    = i%2===0 ? 'e' : 'o';
    return `<Row ss:Height="20">${sc(d.assetName||'',`s_${s}`)}${sc(d.ticker||'-',`s_${s}`)}${nc(d.dividendPerShare,`s_n${s}`)}${sc(FREQ_L[d.frequency]||d.frequency,`s_${s}`)}${nc(d.shares,`s_n${s}`)}${nc(ann,`s_e${s}`)}${nc(ann/12,`s_e${s}`)}</Row>`;
  }).join('');
  const divTotalShares = APP.dividends.reduce((s,d) => s + d.shares, 0);
  const dividendsSheet = `<Worksheet ss:Name="Dividendos"><Table>
${col(170)}${col(70)}${col(120)}${col(105)}${col(85)}${col(130)}${col(135)}
<Row ss:Height="30">${divHdr.map(hc).join('')}</Row>
${divRows || `<Row ss:Height="24"><Cell ss:StyleID="s_e"><Data ss:Type="String">Sin dividendos registrados</Data></Cell></Row>`}
${APP.dividends.length ? `<Row ss:Height="26">${sc('TOTAL','s_totl')}<Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell><Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell><Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell>${nc(divTotalShares,'s_tot')}${nc(annualDiv,'s_tot')}${nc(annualDiv/12,'s_tot')}</Row>` : ''}
</Table>${af(7)}${freeze()}</Worksheet>`;

  // ── Hoja Watchlist ────────────────────────────────────────────
  const watchHdr = ['Activo','Ticker','P. Actual (€)','P. Objetivo (€)','Diferencia (€)','Gap (%)','Notas'];
  const watchRows = APP.watchlist.map((w,i) => {
    const diff = (w.targetPrice||0) - (w.currentPrice||0);
    const dpct = w.currentPrice > 0 ? (diff/w.currentPrice)*100 : 0;
    const s    = i%2===0 ? 'e' : 'o';
    const ds   = diff >= 0 ? 's_gp' : 's_gn';
    const ps   = diff >= 0 ? 's_pp' : 's_pn';
    return `<Row ss:Height="20">${sc(w.name||'',`s_${s}`)}${sc(w.ticker||'-',`s_${s}`)}${nc(w.currentPrice||0,`s_n${s}`)}${nc(w.targetPrice||0,`s_n${s}`)}${nc(diff,ds)}${nc(dpct,ps)}${sc(w.notes||'',`s_${s}`)}</Row>`;
  }).join('');
  const watchlistSheet = `<Worksheet ss:Name="Watchlist"><Table>
${col(170)}${col(70)}${col(105)}${col(110)}${col(100)}${col(78)}${col(210)}
<Row ss:Height="30">${watchHdr.map(hc).join('')}</Row>
${watchRows || `<Row ss:Height="24"><Cell ss:StyleID="s_e"><Data ss:Type="String">Watchlist vacía</Data></Cell></Row>`}
</Table>${af(7)}${freeze()}</Worksheet>`;

  // ── Hoja Transacciones ────────────────────────────────────────
  const txsSorted = [...(APP.transactions||[])].sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const recurringMap = {};
  (APP.recurring||[]).forEach(r => { recurringMap[r.id] = r.description; });
  const sumInc = txsSorted.filter(t => t.type==='income').reduce((s,t) => s+(t.amount||0), 0);
  const sumExp = txsSorted.filter(t => t.type==='expense').reduce((s,t) => s+(t.amount||0), 0);
  const fmtDateXls = iso => {
    if (!iso) return '';
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const txHdr = ['Fecha','Descripción','Categoría','Tipo','Importe (€)','Nota','Recurrente'];
  const txRows = txsSorted.map((t,i) => {
    const isInc = t.type === 'income';
    const pfx   = isInc ? 'inc' : 'exp';
    const s     = i%2===0 ? 'e' : 'o';
    const label = isInc ? 'Ingreso' : 'Gasto';
    return `<Row ss:Height="20">${sc(fmtDateXls(t.date),`s_${pfx}_${s}`)}${sc(t.description||'',`s_${pfx}_${s}`)}${sc(t.category||'',`s_${pfx}_${s}`)}${sc(label,`s_${pfx}_${s}`)}${nc(t.amount||0,`s_${pfx}_n${s}`)}${sc(t.note||'',`s_${pfx}_${s}`)}${sc(t.recurringId?(recurringMap[t.recurringId]||'Sí'):'',`s_${pfx}_${s}`)}</Row>`;
  }).join('');
  const txBlanks3 = `<Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell><Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell><Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell>`;
  const txBlanks2 = `<Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell><Cell ss:StyleID="s_totl"><Data ss:Type="String"></Data></Cell>`;
  const transSheet = `<Worksheet ss:Name="Transacciones"><Table>
${col(80)}${col(200)}${col(120)}${col(75)}${col(105)}${col(170)}${col(130)}
<Row ss:Height="30">${txHdr.map(hc).join('')}</Row>
${txRows || `<Row ss:Height="24"><Cell ss:StyleID="s_e"><Data ss:Type="String">Sin transacciones registradas</Data></Cell></Row>`}
${txsSorted.length ? `<Row ss:Height="26">${sc('INGRESOS','s_totl')}${txBlanks3}${nc(sumInc,'s_tot')}${txBlanks2}</Row><Row ss:Height="26">${sc('GASTOS','s_totl')}${txBlanks3}${nc(sumExp,'s_tot')}${txBlanks2}</Row>` : ''}
</Table>${af(7)}${freeze()}</Worksheet>`;

  // ── Hoja Historial Patrimonial ────────────────────────────────
  const histSorted = [...(APP.networthHistory || [])].sort((a, b) => a.date.localeCompare(b.date));
  const histHdr = ['Mes', 'Patrimonio Neto (€)', 'Cartera (€)', 'Efectivo (€)', 'Cambio (€)', 'Cambio (%)'];
  const histRows = histSorted.map((h, i) => {
    const prev     = i > 0 ? histSorted[i - 1].value : h.value;
    const delta    = h.value - prev;
    const deltaPct = prev !== 0 ? (delta / Math.abs(prev)) * 100 : 0;
    const s  = i % 2 === 0 ? 'e' : 'o';
    const gs = delta >= 0 ? 's_gp' : 's_gn';
    const ps = delta >= 0 ? 's_pp' : 's_pn';
    return `<Row ss:Height="20">${sc(h.date,`s_d${s}`)}${nc(h.value,`s_e${s}`)}${nc(h.portfolioValue||0,`s_e${s}`)}${nc(h.cashValue||0,`s_e${s}`)}${nc(i>0?delta:0,i>0?gs:`s_e${s}`)}${nc(i>0?deltaPct:0,i>0?ps:`s_${s}p`)}</Row>`;
  }).join('');
  const historialSheet = `<Worksheet ss:Name="Historial"><Table>
${col(75)}${col(150)}${col(115)}${col(110)}${col(110)}${col(100)}
<Row ss:Height="30">${histHdr.map(hc).join('')}</Row>
${histRows || `<Row ss:Height="24"><Cell ss:StyleID="s_e"><Data ss:Type="String">Sin historial patrimonial registrado</Data></Cell></Row>`}
</Table>${af(6)}${freeze()}</Worksheet>`;

  // ── Ensamblar SpreadsheetML ───────────────────────────────────
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:o="urn:schemas-microsoft-com:office:office">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Author>Finova</Author><Created>${new Date().toISOString()}</Created><Title>Cartera Finova</Title></DocumentProperties>
<Styles>${STYLES}</Styles>
${readmeSheet}
${summarySheet}
${portfolioSheet}
${dividendsSheet}
${watchlistSheet}
${transSheet}
${historialSheet}
</Workbook>`;

  const blob = new Blob(['﻿' + xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `finova-cartera-${getTodayStr()}.xls`; a.click();
  URL.revokeObjectURL(url);
  showToast(`${APP.portfolio.length} activos exportados`, 'success');
}

function toggleIODropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('io-dropdown-menu');
  if (!menu) return;
  const isOpen = menu.classList.toggle('open');
  if (isOpen) {
    const close = () => { menu.classList.remove('open'); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

function closeIODropdown() {
  document.getElementById('io-dropdown-menu')?.classList.remove('open');
}


/* ─── Hitos de patrimonio ──────────────────────────────────────── */

const MILESTONES = [
  { value:    1000, label: 'Primer Paso',   tier: 'bronze',    icon: '🌱', desc: '¡Tu primer €1.000 en patrimonio neto! La bola de nieve empieza a rodar.' },
  { value:    5000, label: 'Momentum',      tier: 'silver',    icon: '🚀', desc: '€5.000. Constancia y disciplina — ya se nota la diferencia.' },
  { value:   10000, label: 'Cinco Cifras',  tier: 'gold',      icon: '⭐', desc: '¡€10.000! Un hito que menos del 30% de la gente alcanza.' },
  { value:   25000, label: 'Tracción Real', tier: 'emerald',   icon: '🔥', desc: '€25.000. El interés compuesto ya trabaja visiblemente para ti.' },
  { value:   50000, label: 'Sólido',        tier: 'sapphire',  icon: '💎', desc: 'Medio camino al primer €100K. Vas por el buen camino.' },
  { value:  100000, label: 'Seis Cifras',   tier: 'platinum',  icon: '👑', desc: '¡€100.000! Estás en el top 5% de ahorradores de tu generación.' },
  { value:  250000, label: 'Élite',         tier: 'ruby',      icon: '🦅', desc: 'Un cuarto de millón. La libertad financiera es tangible.' },
  { value:  500000, label: 'Maestría',      tier: 'crystal',   icon: '🏛️', desc: 'Medio millón. Tu capital genera más que muchos salarios.' },
  { value: 1000000, label: 'El Millón',     tier: 'legendary', icon: '🏆', desc: '¡Has llegado al millón de euros! Eres Financial Independence.' },
];

/* ── Helpers para hitos de comportamiento ─────────────────────── */
function _bmTxCount()   { return (APP.transactions || []).length; }
function _bmGoalsDone() { return (APP.goals || []).filter(g => g.targetAmount > 0 && _calcGoalProgress(g) >= g.targetAmount).length; }
function _bmAssetCount(){ return (APP.portfolio || []).length; }
function _bmCalcAnnualDiv() {
  return (APP.dividends || []).reduce((sum, d) => {
    const fx   = _divFxRate(d);
    const mult = d.frequency === 'monthly' ? 12 : d.frequency === 'quarterly' ? 4 : d.frequency === 'semiannual' ? 2 : 1;
    return sum + (d.dividendPerShare || 0) * (d.shares || 0) * mult * fx;
  }, 0);
}
function _bmCheckSavingsRate(pct) {
  const months = {};
  (APP.transactions || []).forEach(t => {
    const mo = (t.date || '').slice(0, 7);
    if (!mo) return;
    if (!months[mo]) months[mo] = { inc: 0, exp: 0 };
    if (t.type === 'income')  months[mo].inc += t.amount || 0;
    if (t.type === 'expense') months[mo].exp += t.amount || 0;
  });
  return Object.values(months).some(m => m.inc > 0 && (m.inc - m.exp) / m.inc >= pct / 100);
}
function _bmCheckBalanceStreak(months) {
  const byMonth = {};
  (APP.transactions || []).forEach(t => {
    const mo = (t.date || '').slice(0, 7);
    if (!mo) return;
    if (!byMonth[mo]) byMonth[mo] = 0;
    if (t.type === 'income')  byMonth[mo] += t.amount || 0;
    if (t.type === 'expense') byMonth[mo] -= t.amount || 0;
  });
  const sorted = Object.keys(byMonth).sort();
  let streak = 0;
  for (const mo of sorted) {
    if (byMonth[mo] > 0) { streak++; if (streak >= months) return true; }
    else streak = 0;
  }
  return false;
}
function _bmCheckDebtFree() {
  const libs = APP.liabilities || [];
  return libs.length > 0 && libs.every(l => (l.remainingAmount || 0) <= 0);
}
function _bmCheckEmergencyFund() {
  return (APP.goals || []).some(g =>
    /emergenc|colch[oó]n|fondo.*emerg|blindad|reserva/i.test(g.name || '') &&
    g.targetAmount > 0 && _calcGoalProgress(g) >= g.targetAmount
  );
}
function _bmAnnualExpense12m() {
  const now = new Date();
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    total += (APP.transactions || []).filter(t => t.type === 'expense' && (t.date || '').startsWith(key)).reduce((s, t) => s + t.amount, 0);
  }
  return total;
}
function _bmCheckDivExpenses(pct) {
  const annualExp = _bmAnnualExpense12m();
  return annualExp > 0 && _bmCalcAnnualDiv() >= annualExp * (pct / 100);
}
function _bmCheckFirePct(pct) {
  const annualExp = _bmAnnualExpense12m();
  if (annualExp <= 0) return false;
  return calcNetWorth() >= (annualExp * 25) * (pct / 100);
}
function _bmCheckTrackingAnniversary() {
  const txs = APP.transactions || [];
  if (!txs.length) return false;
  const oldest = txs.reduce((a, b) => ((a.date || '') < (b.date || '') ? a : b));
  if (!oldest.date) return false;
  return Date.now() - new Date(oldest.date + 'T00:00:00').getTime() >= 365 * 86400000;
}

const BEHAVIOR_MILESTONES = [
  { key: 'onboarded',    label: 'Bienvenido',           tier: 'bronze',   icon: '🧭', rarity: 98,  desc: 'Completaste la configuración inicial de Finova.',                          check: () => !!APP.onboardingDone },
  { key: 'bank_connect', label: 'Conectado',             tier: 'bronze',   icon: '🔌', rarity: 42,  desc: 'Conectaste tu banco para importar movimientos automáticamente.',             check: () => (APP.bankConnections || []).some(c => c.lastImport) },
  { key: 'documented',   label: 'Documentado',           tier: 'bronze',   icon: '📤', rarity: 67,  desc: 'Exportaste tus datos por primera vez.',                                     check: () => !!APP._hasExported },
  { key: 'first_tx',     label: 'El Primer Registro',    tier: 'bronze',   icon: '✍️', rarity: 95,  desc: 'Registraste tu primera transacción. El viaje de mil millas comienza aquí.',  check: () => _bmTxCount() >= 1 },
  { key: 'tx_10',        label: 'En Marcha',             tier: 'silver',   icon: '🏃', rarity: 78,  desc: '10 transacciones registradas. Estás cogiendo el ritmo.',                    check: () => _bmTxCount() >= 10 },
  { key: 'tx_50',        label: 'Analista',              tier: 'gold',     icon: '🔬', rarity: 52,  desc: '50 transacciones. Ya tienes una foto real de tus finanzas.',                check: () => _bmTxCount() >= 50 },
  { key: 'tx_200',       label: 'Consistente',           tier: 'emerald',  icon: '⚙️', rarity: 28,  desc: '200 transacciones. La consistencia es el superpoder más infravalorado.',     check: () => _bmTxCount() >= 200 },
  { key: 'tx_500',       label: 'Comprometido',          tier: 'sapphire', icon: '🦾', rarity: 11,  desc: '500 transacciones. Pocos llegan aquí. Tú sí.',                              check: () => _bmTxCount() >= 500 },
  { key: 'goal_done_1',  label: 'Meta Alcanzada',        tier: 'gold',     icon: '🎯', rarity: 34,  desc: 'Completaste tu primer objetivo financiero. Los sueños tienen precio.',      check: () => _bmGoalsDone() >= 1 },
  { key: 'goal_done_3',  label: 'Planificador',          tier: 'sapphire', icon: '🗺️', rarity: 14,  desc: '3 objetivos completados. Planificar es la mitad de ganar.',                check: () => _bmGoalsDone() >= 3 },
  { key: 'first_asset',  label: 'Inversor',              tier: 'silver',   icon: '💹', rarity: 61,  desc: 'Registraste tu primer activo en cartera. El dinero trabaja para ti.',       check: () => _bmAssetCount() >= 1 },
  { key: 'diversified',  label: 'Diversificado',         tier: 'gold',     icon: '🌐', rarity: 29,  desc: '5 activos en cartera. La diversificación es la única comida gratis.',       check: () => _bmAssetCount() >= 5 },
  { key: 'save_20',      label: 'Veinte Por Ciento',     tier: 'silver',   icon: '🐷', rarity: 48,  desc: 'Ahorraste el 20% o más en un mes. El 20% cambia tu futuro.',               check: () => _bmCheckSavingsRate(20) },
  { key: 'save_50',      label: 'Medio Sueldo Guardado', tier: 'ruby',     icon: '🏰', rarity: 16,  desc: 'Ahorraste el 50% de tus ingresos en un mes. Nivel élite.',                 check: () => _bmCheckSavingsRate(50) },
  { key: 'streak_3',     label: 'Racha',                 tier: 'gold',     icon: '🌀', rarity: 41,  desc: '3 meses consecutivos con balance positivo. El hábito está formado.',        check: () => _bmCheckBalanceStreak(3) },
  { key: 'streak_12',    label: 'El Año Perfecto',       tier: 'legendary',icon: '🌟', rarity: 4.2, desc: '12 meses consecutivos en positivo. Eso es maestría financiera.',            check: () => _bmCheckBalanceStreak(12) },
  { key: 'debt_free',    label: 'Libre de Deudas',       tier: 'crystal',  icon: '🕊️', rarity: 22,  desc: 'Todas tus deudas están saldadas. Libertad real.',                          check: () => _bmCheckDebtFree() },
  { key: 'first_div',    label: 'Primer Dividendo',      tier: 'silver',   icon: '🌻', rarity: 38,  desc: 'Registraste tu primer dividendo. La renta pasiva empieza a fluir.',         check: () => (APP.dividends || []).length >= 1 },
  { key: 'div_1000',     label: 'Renta Pasiva',          tier: 'emerald',  icon: '🌴', rarity: 18,  desc: '€1.000 anuales en dividendos. El dinero ya trabaja de noche.',              check: () => _bmCalcAnnualDiv() >= 1000 },
  { key: 'div_12000',    label: 'Sueldo Pasivo',         tier: 'legendary',icon: '♾️', rarity: 3.1, desc: '€12.000 anuales en dividendos. Tu cartera te paga un sueldo.',              check: () => _bmCalcAnnualDiv() >= 12000 },
  { key: 'emergency',    label: 'Blindado',              tier: 'sapphire', icon: '🛡️', rarity: 26,  desc: 'Tu fondo de emergencia está al 100%. Preparado para lo inesperado.',       check: () => _bmCheckEmergencyFund() },
  { key: 'habit_30',     label: 'Hábito Formado',        tier: 'silver',   icon: '🧘', rarity: 35,  desc: '30 días registrando tu patrimonio. El hábito ya es parte de ti.',           check: () => (APP.networthHistory || []).length >= 30 },
  { key: 'habit_365',    label: 'Un Año Contigo',        tier: 'legendary',icon: '🎂', rarity: 8.3, desc: '365 entradas de historial. Un año de conciencia financiera plena.',         check: () => (APP.networthHistory || []).length >= 365 },
  { key: 'div_10pct',   label: 'Renta que Respira',     tier: 'silver',   icon: '🍀', rarity: 31,  desc: 'Tus dividendos cubren el 10% de tus gastos anuales. El dinero trabaja.',      check: () => _bmCheckDivExpenses(10) },
  { key: 'div_50pct',   label: 'Renta que Vuela',       tier: 'ruby',     icon: '🦋', rarity: 9.4, desc: 'Tus dividendos cubren el 50% de tus gastos anuales. Medio camino a la FI.',   check: () => _bmCheckDivExpenses(50) },
  { key: 'fire_10pct',  label: 'Encendido',             tier: 'silver',   icon: '🔭', rarity: 44,  desc: 'Llevas el 10% del camino a la libertad financiera. El viaje FIRE ha comenzado.', check: () => _bmCheckFirePct(10) },
  { key: 'fire_25pct',  label: 'Cuarto de Siglo',       tier: 'emerald',  icon: '⚡', rarity: 22,  desc: 'Al 25% de tu número FIRE. Un cuarto del camino recorrido. Mantén el ritmo.',  check: () => _bmCheckFirePct(25) },
  { key: 'fire_50pct',  label: 'A Mitad de Camino',     tier: 'sapphire', icon: '🌅', rarity: 11,  desc: 'Al 50% de tu número FIRE. La segunda mitad del viaje siempre es más rápida.',  check: () => _bmCheckFirePct(50) },
  { key: 'anniversary', label: 'El Primer Aniversario', tier: 'legendary',icon: '🥂', rarity: 12,  desc: 'Llevas un año registrando tus finanzas. La constancia es el verdadero superpoder.', check: () => _bmCheckTrackingAnniversary() },
];

function checkMilestones(preNW) {
  if (_isDemoMode) return;
  const nw       = preNW !== undefined ? preNW : calcNetWorth();
  const achieved = APP.achievedMilestones || [];
  MILESTONES.forEach(m => {
    if (nw >= m.value && !achieved.includes(m.value)) {
      APP.achievedMilestones = [...achieved, m.value];
      if (!APP.milestoneDates) APP.milestoneDates = {};
      APP.milestoneDates[m.value] = new Date().toISOString().slice(0, 10);
      setTimeout(() => _showMilestoneCelebration(m, 0), 600);
    }
  });
  if (!APP.achievedBehaviorMilestones) APP.achievedBehaviorMilestones = [];
  BEHAVIOR_MILESTONES.forEach(m => {
    try {
      if (!APP.achievedBehaviorMilestones.includes(m.key) && m.check()) {
        APP.achievedBehaviorMilestones = [...APP.achievedBehaviorMilestones, m.key];
        if (!APP.milestoneDates) APP.milestoneDates = {};
        APP.milestoneDates[m.key] = new Date().toISOString().slice(0, 10);
        setTimeout(() => _showMilestoneCelebration(m, 0), 800);
      }
    } catch (_) {}
  });
}

function _showMilestoneCelebration(m, attempt = 0) {
  const overlay = document.getElementById('modalOverlay');
  if (overlay && overlay.classList.contains('open')) {
    if (attempt < 5) setTimeout(() => _showMilestoneCelebration(m, attempt + 1), 1000);
    return;
  }
  _launchConfetti(m.tier);

  const isBehavior = m.key !== undefined;
  const isEpic     = _EPIC_TIERS.has(m.tier);
  let badgeValue, subHint;

  if (isBehavior) {
    const rarityStr = Number.isInteger(m.rarity) ? `${m.rarity}` : m.rarity.toFixed(1).replace('.', ',');
    badgeValue = `<div class="mb-value" style="font-size:10px;opacity:.75">Top ${rarityStr}%</div>`;
    subHint    = `<p class="milestone-sub">Desbloqueado por el <strong>${rarityStr}%</strong> de usuarios</p>`;
  } else {
    const fmtVal = m.value >= 1000000 ? '€1M' : m.value >= 1000 ? `€${m.value / 1000}K` : `€${m.value}`;
    badgeValue   = `<div class="mb-value">${fmtVal}</div>`;
    const nextM  = MILESTONES.find(x => x.value > m.value);
    subHint      = nextM
      ? `<p class="milestone-sub">Próximo hito: <strong>${nextM.label}</strong> a ${nextM.value >= 1000 ? `€${nextM.value / 1000}K` : `€${nextM.value}`}</p>`
      : `<p class="milestone-sub">¡Has alcanzado el hito máximo! 🏆</p>`;
  }

  const shortDesc = (m.desc.match(/^[^.!]+[.!]/) || [m.desc])[0];

  openModal(
    isEpic ? '🎉 ¡Hito épico desbloqueado!' : '¡Hito desbloqueado!',
    `<div class="milestone-celebrate${isEpic ? ' milestone-celebrate--epic' : ''}">
       <div class="milestone-badge milestone-badge--${m.tier} milestone-badge--enter"
            style="cursor:pointer" title="Ver todas mis insignias"
            onclick="closeModal();setTimeout(openMilestoneGallery,120)">
         <div class="mb-glow"></div>
         <div class="mb-icon">${m.icon}</div>
         ${badgeValue}
         <div class="mb-label">${m.label}</div>
       </div>
       <p class="milestone-desc">${m.desc}</p>
       ${subHint}
       <div class="milestone-share-row">
         <button class="milestone-share-btn"
           data-icon="${escapeHtml(m.icon)}"
           data-label="${escapeHtml(m.label)}"
           data-desc="${escapeHtml(shortDesc)}"
           data-tier="${m.tier}"
           onclick="_shareMilestoneCard(this)">↗ Compartir</button>
         <button class="btn-ghost" style="font-size:12px"
           onclick="closeModal();setTimeout(openMilestoneGallery,120)">Ver insignias →</button>
       </div>
     </div>`,
    null
  );
  const btn = document.getElementById('modalConfirm');
  if (btn) { btn.textContent = '¡Gracias!'; btn.style.width = '100%'; }
}

function openMilestoneGallery() {
  const achieved  = new Set(APP.achievedMilestones || []);
  const achievedB = new Set(APP.achievedBehaviorMilestones || []);
  const dates     = APP.milestoneDates || {};
  const nw        = calcNetWorth();

  const doneNW  = MILESTONES.filter(m => achieved.has(m.value) || nw >= m.value).length;
  const doneB   = BEHAVIOR_MILESTONES.filter(m => achievedB.has(m.key)).length;
  const doneAll = doneNW + doneB;
  const totalAll = MILESTONES.length + BEHAVIOR_MILESTONES.length;
  const pctAll  = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;

  const next = MILESTONES.find(m => !(achieved.has(m.value) || nw >= m.value));
  const nextPct = next && next.value > 0 ? Math.min(99, Math.round((nw / next.value) * 100)) : 100;
  const nextBar = next
    ? `<div style="margin:0 0 20px">
         <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px">
           <span>Próximo patrimonio: <strong style="color:var(--text-primary)">${next.label}</strong> · ${next.value >= 1000 ? `€${next.value / 1000}K` : `€${next.value}`}</span>
           <span>${nextPct}%</span>
         </div>
         <div style="height:6px;background:var(--surface-3);border-radius:3px">
           <div style="height:6px;background:var(--accent);border-radius:3px;width:${nextPct}%;transition:width .5s"></div>
         </div>
       </div>`
    : '';

  const nwItems = MILESTONES.map(m => {
    const done    = achieved.has(m.value) || nw >= m.value;
    const fmtVal  = m.value >= 1000000 ? '€1M' : m.value >= 1000 ? `€${m.value / 1000}K` : `€${m.value}`;
    const dateStr = dates[m.value] ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px">${formatDate(dates[m.value])}</div>` : '';
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        <div class="milestone-badge milestone-badge--${m.tier}${done ? '' : ' milestone-badge--locked'}" title="${m.label}">
          <div class="mb-glow"></div>
          <div class="mb-icon">${done ? m.icon : '🔒'}</div>
          <div class="mb-value">${fmtVal}</div>
          <div class="mb-label">${done ? m.label : '—'}</div>
        </div>
        ${done ? dateStr : ''}
        <div style="font-size:11px;color:var(--text-muted);text-align:center;max-width:100px;line-height:1.3">${done ? m.desc.split('!')[0] + '!' : '?'}</div>
      </div>`;
  }).join('');

  const bItems = BEHAVIOR_MILESTONES.map(m => {
    const done      = achievedB.has(m.key);
    const rarityStr = Number.isInteger(m.rarity) ? `${m.rarity}` : m.rarity.toFixed(1).replace('.', ',');
    const dateStr   = dates[m.key] ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px">${formatDate(dates[m.key])}</div>` : '';
    const rarityLine = done
      ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Desbloqueado por el ${rarityStr}% de usuarios</div>`
      : '';
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        <div class="milestone-badge milestone-badge--${m.tier}${done ? '' : ' milestone-badge--locked'}" title="${m.label}">
          <div class="mb-glow"></div>
          <div class="mb-icon">${done ? m.icon : '🔒'}</div>
          <div class="mb-value" style="font-size:10px;opacity:.75">${done ? `Top ${rarityStr}%` : '—'}</div>
          <div class="mb-label">${done ? m.label : '—'}</div>
        </div>
        ${done ? dateStr : ''}
        ${rarityLine}
        <div style="font-size:11px;color:var(--text-muted);text-align:center;max-width:100px;line-height:1.3">${done ? m.desc.split('.')[0] + '.' : '?'}</div>
      </div>`;
  }).join('');

  openModal(
    'Mis insignias',
    `<div style="text-align:center;margin-bottom:16px">
       <div style="font-size:28px;font-weight:700;color:var(--accent)">${doneAll}<span style="font-size:16px;color:var(--text-muted);font-weight:400"> / ${totalAll}</span></div>
       <div style="font-size:13px;color:var(--text-secondary)">insignias desbloqueadas</div>
       <div style="margin-top:10px;height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden">
         <div style="height:6px;background:var(--accent);border-radius:3px;width:${pctAll}%;transition:width .6s"></div>
       </div>
       <div style="font-size:12px;color:var(--text-muted);margin-top:5px">Progreso: <strong style="color:var(--text-primary)">${pctAll}%</strong> desbloqueado</div>
     </div>
     ${nextBar}
     <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px">Patrimonio</div>
     <div class="milestone-gallery" style="gap:20px;margin-bottom:28px">${nwItems}</div>
     <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px">Comportamiento &amp; Hábitos</div>
     <div class="milestone-gallery" style="gap:20px">${bItems}</div>`,
    null
  );
  const btn = document.getElementById('modalConfirm');
  if (btn) btn.style.display = 'none';
}

const _confettiTimers = [];

function _clearConfetti() {
  _confettiTimers.forEach(clearTimeout);
  _confettiTimers.length = 0;
  document.querySelectorAll('.confetti-container').forEach(c => c.remove());
}

const _EPIC_TIERS = new Set(['platinum', 'ruby', 'crystal', 'legendary']);

function _launchConfetti(tier = 'bronze') {
  const epic    = _EPIC_TIERS.has(tier);
  const count   = epic ? 200 : 90;
  const maxDur  = epic ? 8   : 5;
  const spreadMs = epic ? 1.4 : 0.8;

  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const base   = ['#c9a84c','#5b6aff','#e05c7a','#50c878','#ffd700','#ff6b6b','#4fc3f7','#ffffff'];
  const gold   = ['#ffd700','#ffe566','#c8a840','#fff0a0','#ffcc00'];
  const colors = epic ? [...base, ...gold] : base;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    const size = epic ? (8 + Math.floor(Math.random() * 10)) : (6 + Math.floor(Math.random() * 7));
    const baseDur = epic ? 3.8 : 2.2;
    el.style.cssText = [
      `left:${Math.random() * 100}%`,
      `background:${colors[Math.floor(Math.random() * colors.length)]}`,
      `animation-delay:${(Math.random() * spreadMs).toFixed(2)}s`,
      `animation-duration:${(baseDur + Math.random() * (epic ? 4 : 1.8)).toFixed(2)}s`,
      `width:${size}px`,
      `height:${size}px`,
      `border-radius:${Math.random() > 0.4 ? '50%' : '2px'}`,
    ].join(';');
    container.appendChild(el);
  }
  const t = setTimeout(() => {
    container.remove();
    const idx = _confettiTimers.indexOf(t);
    if (idx >= 0) _confettiTimers.splice(idx, 1);
  }, (maxDur + 1) * 1000);
  _confettiTimers.push(t);
}

function _shareMilestoneCard(btn) {
  const icon  = btn.dataset.icon  || '🏆';
  const label = btn.dataset.label || '';
  const desc  = btn.dataset.desc  || '';
  const tier  = btn.dataset.tier  || 'gold';

  const TIER_COLORS = {
    bronze:    ['#f0a060','#a0522d'], silver:    ['#d8d8e8','#9090a8'],
    gold:      ['#ffe060','#c8a010'], emerald:   ['#70e8a0','#1a8040'],
    sapphire:  ['#80b0ff','#2040b0'], platinum:  ['#f0f0ff','#b0b0c8'],
    ruby:      ['#ff8080','#900020'], crystal:   ['#c0f0e8','#40a090'],
    legendary: ['#ffe080','#6040a0'],
  };
  const [c1, c2] = TIER_COLORS[tier] || TIER_COLORS.gold;

  try {
    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(0, 0, W, H);

    // Decorative ring
    ctx.beginPath();
    ctx.arc(W / 2, 380, 200, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 40;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, 380, 155, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Icon
    ctx.font = '160px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#ffffff';
    ctx.fillText(icon, W / 2, 380);

    // "HITO DESBLOQUEADO" header
    ctx.font         = '700 40px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle    = 'rgba(255,255,255,0.65)';
    ctx.fillText('HITO DESBLOQUEADO', W / 2, 610);

    // Milestone label
    ctx.font      = '700 88px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, W / 2, 720);

    // Description (word-wrap at ~820px)
    ctx.font      = '36px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    const words = desc.split(' ');
    let line = '', y = 810;
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > 820 && line) {
        ctx.fillText(line.trim(), W / 2, y);
        line = word + ' ';
        y += 52;
      } else { line = test; }
    }
    if (line.trim()) ctx.fillText(line.trim(), W / 2, y);

    // Finova branding
    ctx.font      = '700 30px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.fillText('Finova — Tu libertad financiera', W / 2, 1030);

    // Download
    const a     = document.createElement('a');
    a.download  = `finova-${label.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.png`;
    a.href      = canvas.toDataURL('image/png');
    a.click();
    showToast('Imagen descargada — ¡compártela! ✓', 'success');
  } catch (_) {
    const text = `🏆 ¡Acabo de desbloquear "${label}" en Finova!\n${icon} ${desc}\n#FIRE #LibertadFinanciera #Finova`;
    navigator.clipboard?.writeText(text)
      .then(() => showToast('Texto copiado al portapapeles ✓', 'success'))
      .catch(() => showToast('Descarga no disponible en este navegador', 'error'));
  }
}

/* ─── Exportación vía Webhook ──────────────────────────────────── */

function saveWebhookUrl() {
  const url = document.getElementById('settings-webhook-url')?.value.trim() || '';
  if (url) {
    try { new URL(url); } catch { showToast('URL de webhook no válida', 'error'); return; }
  }
  APP.webhookUrl = url;
  saveData();
  showToast(url ? 'Webhook guardado ✓' : 'Webhook eliminado', 'success');
}

async function testWebhook() {
  const url = APP.webhookUrl || document.getElementById('settings-webhook-url')?.value.trim();
  if (!url) { showToast('Introduce una URL de webhook primero', 'error'); return; }
  try { new URL(url); } catch { showToast('URL de webhook no válida', 'error'); return; }
  const btn = document.getElementById('btnTestWebhook');
  if (btn) btn.disabled = true;
  try {
    const payload = _buildWebhookPayload('test');
    const res     = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showToast(res.ok ? `Webhook OK — respuesta ${res.status}` : `Error ${res.status}`, res.ok ? 'success' : 'error');
  } catch (e) {
    showToast('No se pudo conectar con el webhook. Revisa la URL y CORS.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function exportViaWebhook(type = 'full') {
  const url = APP.webhookUrl;
  if (!url) { showToast('Configura un webhook en Ajustes primero', 'error'); return; }
  try {
    const payload = _buildWebhookPayload(type);
    const res     = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showToast(res.ok ? `Datos enviados al webhook ✓` : `Error ${res.status}`, res.ok ? 'success' : 'error');
  } catch (e) {
    showToast('Error al enviar datos al webhook.', 'error');
  }
}

function _buildWebhookPayload(type) {
  const now = new Date().toISOString();
  const m   = getCurrentMonth();
  return {
    source:    'finova',
    version:   '1.0',
    type,
    timestamp: now,
    month:     m,
    summary: {
      networth:        calcNetWorth(),
      monthlyIncome:   calcMonthlyIncome(m),
      monthlyExpense:  calcMonthlyExpense(m),
      monthlyBalance:  calcMonthlyIncome(m) - calcMonthlyExpense(m),
      portfolioValue:  calcPortfolioValue(),
      cashTotal:       calcCashTotal(),
    },
    transactions: APP.transactions.map(({ photo, photoId, ...t }) => t),
    portfolio:    APP.portfolio,
    goals:        APP.goals,
    cashAccounts: APP.cashAccounts,
    budgets:      APP.budgets,
    networthHistory: APP.networthHistory,
  };
}

/* ─── Importación OFX/QFX (extractos bancarios) ────────────────── */

function importOFXFile() {
  document.getElementById('ofx-import-input')?.click();
}

function handleOFXImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const txs = _parseOFXSGML(e.target.result);
      if (!txs.length) return showToast('No se encontraron transacciones en el archivo OFX/QFX', 'error');
      _showOFXPreview(txs);
    } catch (err) {
      console.error('OFX parse error:', err);
      showToast('No se pudo leer el archivo OFX/QFX. Comprueba que es un extracto válido.', 'error');
    }
  };
  reader.onerror = () => showToast('Error al leer el archivo. Vuelve a intentarlo.', 'error');
  reader.readAsText(file, 'latin1');
}

function _parseOFXSGML(text) {
  const txs = [];
  const skippedBlocks = [];
  const blockRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;
  let blockIndex = 0;
  while ((match = blockRe.exec(text)) !== null) {
    blockIndex++;
    try {
      const block = match[1];
      const get = tag => {
        const m = new RegExp(`<${tag}>([^<\r\n]*)`, 'i').exec(block);
        return m ? m[1].trim() : '';
      };

      const rawDate   = get('DTPOSTED') || get('DTUSER');
      const rawAmt    = get('TRNAMT');
      const fitid     = get('FITID');
      const name      = get('NAME');
      const memo      = get('MEMO');
      const trntype   = get('TRNTYPE').toUpperCase();
      const description = memo || name || 'Transacción bancaria';

      let date = '';
      const dm = rawDate.match(/^(\d{4})(\d{2})(\d{2})/);
      if (dm) date = `${dm[1]}-${dm[2]}-${dm[3]}`;

      const amount = parseFloat(rawAmt.replace(',', '.')) || 0;
      if (!date || amount === 0) continue;

      const isIncome = trntype === 'CREDIT' || trntype === 'DEP' || amount > 0;
      const type     = isIncome ? 'income' : 'expense';

      const cats     = type === 'expense' ? APP.categories.expense : APP.categories.income;
      const learned  = APP.categoryPatterns && _patCat(APP.categoryPatterns[txPatternKey(description)]);
      const local    = typeof matchLocalKeywords === 'function' ? matchLocalKeywords(description, type) : null;
      const category = learned || local || cats[0] || 'Otros';

      txs.push({ fitid, date, description, category, type, amount: Math.abs(amount) });
    } catch (e) {
      skippedBlocks.push(blockIndex);
    }
  }
  if (skippedBlocks.length > 0) {
    const list = skippedBlocks.slice(0, 5).join(', ') + (skippedBlocks.length > 5 ? '…' : '');
    setTimeout(() => showToast(`Se ignoraron ${skippedBlocks.length} transacción${skippedBlocks.length > 1 ? 'es' : ''} por error (bloque${skippedBlocks.length > 1 ? 's' : ''} ${list})`, 'error'), 500);
  }
  return txs;
}

let _pendingOFXRows = [];
let _pendingImportSource = 'OFX/QFX';

function _showOFXPreview(allRows, source = 'OFX/QFX') {
  _pendingImportSource = source;
  // Deduplicate only by FITID — date+amount dedup silently drops legitimate same-day same-amount transactions
  const existingFitids = new Set(APP.transactions.map(t => t.fitid).filter(Boolean));

  const rows     = allRows.filter(r => !(r.fitid && existingFitids.has(r.fitid)));
  const dupCount = allRows.length - rows.length;

  if (!rows.length) {
    showToast(`Todas las transacciones ya existen en Finova (${dupCount} duplicadas omitidas)`, 'info');
    return;
  }

  _pendingOFXRows = rows;

  const dupNote = dupCount > 0
    ? `<span style="color:var(--text-muted)"> · ${dupCount} duplicadas omitidas</span>`
    : '';

  const tableRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.category)}</td>
      <td><span class="badge badge-${r.type}">${r.type === 'income' ? 'Ingreso' : 'Gasto'}</span></td>
      <td class="text-right ${r.type === 'income' ? 'positive' : 'negative'}">${r.type === 'income' ? '+' : '-'}${formatCurrency(r.amount)}</td>
    </tr>
  `).join('');

  openModal(
    `Importar ${_pendingImportSource} — ${rows.length} transacciones`,
    `<p style="font-size:13px;color:var(--text-secondary);margin:0 0 12px">
       Se van a importar <strong>${rows.length}</strong> transacciones nuevas.${dupNote}
       Las categorías se han asignado automáticamente y puedes editarlas después.
     </p>
     <div style="max-height:360px;overflow-y:auto">
       <table class="data-table" style="font-size:12px">
         <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Tipo</th><th>Importe</th></tr></thead>
         <tbody>${tableRows}</tbody>
       </table>
     </div>`,
    () => _confirmOFXImport(),
    () => {
      const btn = document.getElementById('modalConfirm');
      if (btn) btn.textContent = `Importar ${rows.length}`;
    }
  );
}

function _confirmOFXImport() {
  _pendingOFXRows.forEach(r => {
    const tx = { id: generateId(), date: r.date, description: r.description,
                 category: r.category, type: r.type, amount: r.amount };
    if (r.fitid) tx.fitid = r.fitid;
    APP.transactions.push(tx);
  });
  APP.transactions.sort((a, b) => b.date.localeCompare(a.date));
  const count = _pendingOFXRows.length;
  _pendingOFXRows = [];
  saveData();
  closeModal();
  renderTransactions();
  showToast(`${count} transacciones importadas desde ${_pendingImportSource} ✓`, 'success');
}

/* ─── Importación CSV bancario (Santander, BBVA, CaixaBank…) ─────── */

function importTransactionsCSV() {
  document.getElementById('csv-import-input')?.click();
}

function handleCSVImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const txs = _parseCSVBank(e.target.result);
      if (!txs.length) return showToast('No se encontraron transacciones en el CSV. Verifica que es un extracto bancario válido.', 'error');
      _showOFXPreview(txs, 'CSV');
    } catch (err) {
      console.error('CSV parse error:', err);
      showToast('No se pudo leer el CSV. Comprueba que el archivo es un extracto bancario.', 'error');
    }
  };
  reader.onerror = () => showToast('Error al leer el archivo.', 'error');
  reader.readAsText(file, 'UTF-8');
}

function _parseCSVDate(str) {
  const s = str.replace(/"/g, '').trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function _parseCSVAmt(str) {
  const s = str.replace(/"/g, '').trim();
  // Handle European format: "1.234,56" → remove thousands dot, replace decimal comma
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function _csvSplit(line, sep) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === sep && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  result.push(cur.trim());
  return result;
}

function _parseCSVBank(text) {
  const raw   = text.replace(/^﻿/, ''); // strip BOM
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect separator (semicolon wins if more splits)
  const h1  = lines[0];
  const sep = h1.split(';').length >= h1.split(',').length ? ';' : ',';
  const hdrs = _csvSplit(h1, sep).map(h => h.replace(/"/g, '').toLowerCase().trim());

  const col = name => hdrs.findIndex(h => h.includes(name));

  // Bank detection by header fingerprint
  const hasFechaValor = hdrs.some(h => h.includes('fecha valor') || h === 'fecha valor');
  const hasConcepto   = hdrs.some(h => h === 'concepto');
  const hasDivisa     = hdrs.some(h => h.includes('divisa'));
  const hasData       = hdrs.some(h => h === 'data'); // Catalan CaixaBank
  const hasImport     = hdrs.some(h => h === 'import'); // Catalan "importe"
  const hasDescripcio = hdrs.some(h => h.includes('descripc'));

  let dateCol, descCol, amtCol;

  if (hasFechaValor && hasConcepto) {
    // BBVA: Fecha | Fecha valor | Descripción | Concepto | Importe | Saldo
    dateCol = col('fecha');                              // first "fecha" = operation date
    descCol = hdrs.findIndex(h => h.includes('descripci') || h === 'concepto');
    amtCol  = col('importe');
  } else if (hasData && (hasImport || hasDescripcio)) {
    // CaixaBank (Catalan): Data | Descripció | Import | Saldo
    dateCol = col('data');
    descCol = col('descripc');
    amtCol  = hasImport ? hdrs.findIndex(h => h === 'import') : col('importe');
  } else if (hasDivisa) {
    // Santander (classic): Fecha | Concepto | Importe | Divisa | Saldo…
    dateCol = col('fecha');
    descCol = hdrs.findIndex(h => h.includes('concepto') || h.includes('descripci'));
    amtCol  = col('importe');
  } else {
    // Generic — look for typical column names
    dateCol = hdrs.findIndex(h => /fecha|date|data/.test(h));
    descCol = hdrs.findIndex(h => /descripci|concepto|concept|moviment|detail/.test(h));
    amtCol  = hdrs.findIndex(h => /importe|import|amount/.test(h));
  }

  if (dateCol < 0 || amtCol < 0) return [];
  if (descCol < 0) descCol = (dateCol === 0 ? 1 : 0); // last-resort fallback

  const txs = [];
  const skippedRows = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const cols = _csvSplit(lines[i], sep);
      if (cols.length <= Math.max(dateCol, descCol, amtCol)) continue;
      const date   = _parseCSVDate(cols[dateCol] || '');
      const desc   = (cols[descCol] || '').replace(/"/g, '').trim() || 'Transacción bancaria';
      const amount = _parseCSVAmt(cols[amtCol] || '0');
      if (!date || amount === 0) continue;
      const type    = amount > 0 ? 'income' : 'expense';
      const cats    = type === 'expense' ? APP.categories.expense : APP.categories.income;
      const learned = APP.categoryPatterns && _patCat(APP.categoryPatterns[txPatternKey(desc)]);
      const local   = typeof matchLocalKeywords === 'function' ? matchLocalKeywords(desc, type) : null;
      txs.push({ date, description: desc, category: learned || local || cats[0] || 'Otros', type, amount: Math.abs(amount) });
    } catch (e) {
      skippedRows.push(i + 1); // 1-based line number for user display
    }
  }
  if (skippedRows.length > 0) {
    const rowList = skippedRows.slice(0, 5).join(', ') + (skippedRows.length > 5 ? '…' : '');
    setTimeout(() => showToast(`Se ignoraron ${skippedRows.length} fila${skippedRows.length > 1 ? 's' : ''} por error (fila${skippedRows.length > 1 ? 's' : ''} ${rowList})`, 'error'), 500);
  }
  return txs;
}

/* ═══════════════════════════════════════════════════════════════
   22. BACKUP
═══════════════════════════════════════════════════════════════ */
function downloadBackup() {
  const { claudeApiKey, openaiApiKey, geminiApiKey, groqApiKey, ...exportable } = APP;
  const data     = JSON.stringify({ _schemaVersion: 1, ...exportable }, null, 2);
  const blob     = new Blob([data], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const date     = new Date().toISOString().split('T')[0];
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `finova-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  APP.lastBackupDate = new Date().toISOString().slice(0, 10);
  saveData();
  showToast('Backup descargado ✓', 'success');
}

function exportTransactionsCSV() {
  if (!APP.transactions.length) return showToast('No hay transacciones para exportar', 'info');
  const txs = typeof _txApplyFilters === 'function'
    ? _txApplyFilters().sort((a, b) => a.date.localeCompare(b.date))
    : [...APP.transactions].sort((a, b) => a.date.localeCompare(b.date));
  if (!txs.length) return showToast('No hay transacciones con los filtros activos', 'info');

  const fmtDate = iso => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const fmtAmt = v => String(v.toFixed(2)).replace('.', ',');
  const esc    = v => {
    const s = String(v ?? '');
    return (s.includes(';') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const recurringMap = {};
  (APP.recurring || []).forEach(r => { recurringMap[r.id] = r.description; });

  const totalInc = txs.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const totalExp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);

  const meta = [
    ['FINOVA — Exportación de Transacciones', '', '', '', '', '', ''],
    ['Fecha de exportación:', getTodayStr(), '', '', '', '', ''],
    ['Transacciones exportadas:', String(txs.length), '', '', '', '', ''],
    ['Total ingresos:', fmtAmt(totalInc) + ' €', '', '', '', '', ''],
    ['Total gastos:', fmtAmt(totalExp) + ' €', '', '', '', '', ''],
    ['Balance neto:', fmtAmt(totalInc - totalExp) + ' €', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
  ];

  const headers = ['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Importe (€)', 'Nota', 'Recurrente'];
  const rows = txs.map(t => [
    fmtDate(t.date),
    t.description,
    t.category,
    t.type === 'income' ? 'Ingreso' : 'Gasto',
    fmtAmt(t.amount),
    t.note || '',
    t.recurringId ? (recurringMap[t.recurringId] || 'Sí') : '',
  ]);

  const lines = [...meta, headers, ...rows].map(r => r.map(esc).join(';'));
  const blob  = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = `finova-transacciones-${getTodayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${txs.length} transacciones exportadas`, 'success');
}

const BACKUP_ARRAYS = [
  'transactions', 'portfolio', 'watchlist', 'dividends',
  'cashAccounts', 'alternatives', 'goals', 'bizums',
  'networthHistory', 'sales', 'scenarios', 'liabilities',
  'stakingPositions', 'stakingHistory',
];
const BACKUP_ALLOWED_KEYS = [
  ...BACKUP_ARRAYS,
  'categories', 'trabajo', 'minimos',
  'theme', 'privacyMode', 'activeSection',
  'syncCode', 'lastBackupDate', 'portfolioSnapshots',
];

function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  // Require the two core arrays that every Finova backup must contain
  if (!Array.isArray(data.transactions) || !Array.isArray(data.portfolio)) return false;
  // Reject backups from a future incompatible schema version
  if ('_schemaVersion' in data && data._schemaVersion !== 1) return false;
  // Any other BACKUP_ARRAYS field present must actually be an array
  for (const key of BACKUP_ARRAYS) {
    if (key in data && !Array.isArray(data[key])) return false;
  }
  return true;
}

function restoreBackup(file) {
  const reader = new FileReader();
  reader.onerror = () => showToast(`No se pudo leer el archivo "${file.name}". Comprueba que no esté dañado o bloqueado.`, 'error');
  reader.onload = (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch (parseErr) {
      showToast(`El archivo no contiene JSON válido. ${parseErr.message}`, 'error');
      return;
    }
    if (!validateBackup(data)) {
      showToast('El archivo no parece un backup de Finova válido (falta la firma o los campos esperados).', 'error');
      return;
    }
    // Only apply whitelisted fields — ignore unknown keys from foreign files
    const safe = {};
    for (const key of BACKUP_ALLOWED_KEYS) {
      if (key in data) safe[key] = data[key];
    }
    APP = { ...APP, ...safe };
    _attachAPPRedaction();
    _saveDataNow();
    showToast('Backup restaurado ✓', 'success');
    setTimeout(() => location.reload(), 800);
  };
  reader.readAsText(file);
}

/* ─── Sincronización entre dispositivos ────────────────────────── */

function syncGenerateCode(btn) {
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  APP.syncCode = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  saveData();
  _renderSyncUI();
  navigator.clipboard?.writeText(APP.syncCode).then(() => {
    showToast('Código generado y copiado ✓', 'success');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copiado';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    }
  }).catch(() => {
    showToast('Código generado. Cópialo para usarlo en otros dispositivos.', 'success');
  });
}

async function syncUpload() {
  const code = APP.syncCode;
  if (!code) return showToast('Genera un código primero', 'error');
  const btn = document.getElementById('btn-sync-upload');
  if (btn) btn.disabled = true;
  try {
    const { claudeApiKey, openaiApiKey, geminiApiKey, groqApiKey, ...exportable } = APP;
    const authH = await _getAuthHeader();
    const res = await fetch('/api/sync-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authH },
      body: JSON.stringify({ code, data: JSON.stringify(exportable) }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
    APP.lastBackupDate = new Date().toISOString().slice(0, 10);
    saveData();
    _renderSyncUI();
    showToast('Datos subidos al servidor ✓', 'success');
  } catch (e) {
    showToast(`No se pudo subir: ${e.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function syncDownload() {
  const input = document.getElementById('sync-code-input');
  const code  = (input?.value.trim() || APP.syncCode || '').toLowerCase();
  if (!code) return showToast('Introduce el código de sincronización', 'error');
  const btn = document.getElementById('btn-sync-download');
  if (btn) btn.disabled = true;
  try {
    const authH = await _getAuthHeader();
    const res  = await fetch(`/api/sync-download?code=${encodeURIComponent(code)}`, { headers: authH });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
    const data = JSON.parse(json.data);
    if (!validateBackup(data)) throw new Error('Los datos del servidor no son válidos');
    const safe = {};
    for (const key of BACKUP_ALLOWED_KEYS) { if (key in data) safe[key] = data[key]; }
    APP = { ...APP, ...safe };
    _attachAPPRedaction();
    if (code !== APP.syncCode) APP.syncCode = code;
    _saveDataNow();
    showToast('Datos restaurados desde el servidor ✓', 'success');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    showToast(`No se pudo descargar: ${e.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _renderSyncUI() {
  const codeEl = document.getElementById('sync-code-display');
  const upBtn  = document.getElementById('btn-sync-upload');
  if (codeEl) {
    if (APP.syncCode) { codeEl.textContent = APP.syncCode; codeEl.style.display = 'inline'; }
    else codeEl.style.display = 'none';
  }
  if (upBtn) upBtn.disabled = !APP.syncCode;
}

/* ═══════════════════════════════════════════════════════════════
   22. PESTAÑAS INTERNAS — Ingresos & Gastos
═══════════════════════════════════════════════════════════════ */
function initInnerTabs() {
  document.querySelectorAll('.inner-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;

      // Activar pestaña
      document.querySelectorAll('.inner-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Mostrar panel
      document.querySelectorAll('.inner-tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(targetId)?.classList.add('active');

      // Mostrar botón correcto
      const btnTx  = document.getElementById('btnAddTransaction');
      const btnBiz = document.getElementById('btnAddBizum');
      if (targetId === 'tab-tx') {
        if (btnTx)  btnTx.style.display  = '';
        if (btnBiz) btnBiz.style.display = 'none';
        renderTransactions();
      } else {
        if (btnTx)  btnTx.style.display  = 'none';
        if (btnBiz) btnBiz.style.display = '';
        renderBizums();
      }
    });
  });

  // Mostrar botón de transacciones por defecto
  const btnTx = document.getElementById('btnAddTransaction');
  if (btnTx) btnTx.style.display = '';
}

/* ═══════════════════════════════════════════════════════════════
   23. AJUSTES
═══════════════════════════════════════════════════════════════ */

/** Lee qué secciones están ocultas desde APP.hiddenSections */
function initSettings() {
  if (!APP.hiddenSections) APP.hiddenSections = [];

  // Migrate old 'transactions' toggle key → 'transacciones' (whole group)
  if (APP.hiddenSections.includes('transactions')) {
    APP.hiddenSections = APP.hiddenSections.filter(s => s !== 'transactions');
    if (!APP.hiddenSections.includes('transacciones')) APP.hiddenSections.push('transacciones');
    saveData();
  }

  // Initialize section order from default if missing
  if (!APP.sectionOrder || !APP.sectionOrder.length) {
    APP.sectionOrder = NAV_SECTIONS.map(s => s.key);
  }

  // Aplicar secciones ocultas al cargar
  APP.hiddenSections.forEach(sec => hideSectionNav(sec));

  // Apply saved sidebar order
  applySectionOrder();

  // Render profile
  renderSidebarProfile();
}

function renderSettings() {
  _photoLostCount = 0;

  // ─── Banner bienvenida ────────────────────────────────────────
  const welcomeBanner = document.getElementById('ob-welcome-banner');
  if (welcomeBanner) {
    if (window._obJustFinished) {
      welcomeBanner.style.display = 'flex';
      welcomeBanner.style.opacity = '1';
      welcomeBanner.style.maxHeight = '300px';
    } else {
      welcomeBanner.style.display = 'none';
    }
  }

  // Render section visibility list (replaces static toggle wiring)
  renderSectionVisibility();

  // ─── Perfil y tema ────────────────────────────────────────────
  const usernameInput = document.getElementById('settings-username');
  if (usernameInput) usernameInput.value = APP.userName || '';

  // Tema toggle en ajustes
  const themeInput = document.getElementById('settings-theme-toggle');
  if (themeInput) {
    themeInput.checked = APP.theme === 'dark';
    themeInput.onchange = () => toggleTheme();
  }

  // Selector de variante de diseño
  const variantGrid = document.getElementById('variantGrid');
  if (variantGrid) {
    variantGrid.querySelectorAll('.variant-card').forEach(card => {
      card.classList.toggle('active', card.dataset.variant === APP.variant);
      card.setAttribute('aria-pressed', card.dataset.variant === APP.variant ? 'true' : 'false');
      card.onclick = () => setVariant(card.dataset.variant);
    });
  }

  // Backup reminder
  const reminderEl = document.getElementById('backup-reminder');
  if (reminderEl) {
    const last = APP.lastBackupDate;
    if (!last) {
      reminderEl.textContent = 'Nunca has descargado un backup. Hazlo ahora para no perder tus datos.';
      reminderEl.style.display = 'block';
    } else {
      const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
      if (days >= 7) {
        reminderEl.textContent = `Tu último backup fue hace ${days} días. Te recomendamos uno nuevo.`;
        reminderEl.style.display = 'block';
      } else {
        reminderEl.style.display = 'none';
      }
    }
  }

  // Bank connections — load lazily; non-critical path
  _ensureScript('./src/utils/bank-connect.js').then(() => {
    if (typeof renderBankConnect === 'function') renderBankConnect();
  });

  // Server AI banner (ai.js may not have checked yet — kick off the check)
  if (typeof _renderServerAIBanner === 'function') _renderServerAIBanner();
  if (typeof initServerAI === 'function' && typeof _serverAI !== 'undefined' && _serverAI === null) initServerAI();

  // Sync UI
  _renderSyncUI();
  const syncInput = document.getElementById('sync-code-input');
  if (syncInput && APP.syncCode) syncInput.placeholder = APP.syncCode;

  // ─── API Keys ─────────────────────────────────────────────────
  const claudeInput  = document.getElementById('settings-claude-key');
  const openaiInput  = document.getElementById('settings-openai-key');
  const geminiInput  = document.getElementById('settings-gemini-key');
  const groqInput    = document.getElementById('settings-groq-key');
  if (claudeInput) claudeInput.value = APP.claudeApiKey || '';
  if (openaiInput) openaiInput.value = APP.openaiApiKey || '';
  if (geminiInput) geminiInput.value = APP.geminiApiKey || '';
  if (groqInput)   groqInput.value   = APP.groqApiKey   || '';

  // Webhook URL
  const webhookInput = document.getElementById('settings-webhook-url');
  const testBtn      = document.getElementById('btnTestWebhook');
  if (webhookInput) webhookInput.value = APP.webhookUrl || '';
  if (testBtn) testBtn.disabled = !APP.webhookUrl;

  // Foto integrity / backup warning
  _renderPhotoSettings();

  // Uso de almacenamiento
  const storageEl = document.getElementById('storage-usage-bar');
  if (storageEl) {
    const { bytes, limit, pct } = getStorageUsage();
    const usedMB  = (bytes / 1024 / 1024).toFixed(2);
    const limitMB = (limit / 1024 / 1024).toFixed(0);
    const color   = pct >= 95 ? 'var(--danger)' : pct >= 80 ? 'var(--accent)' : 'var(--up)';
    const txCount = APP.transactions.length;
    storageEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px">
        <span>${usedMB} MB usados · ${txCount} transacciones</span>
        <span style="color:${color};font-weight:600">${Math.round(pct)}% de ~${limitMB} MB</span>
      </div>
      <div style="height:8px;border-radius:4px;background:var(--border-default);overflow:hidden">
        <div style="height:100%;width:${Math.min(pct,100).toFixed(1)}%;background:${color};border-radius:4px;transition:width .6s cubic-bezier(.16,1,.3,1)"></div>
      </div>
      ${pct >= 80 ? `<div style="font-size:11px;color:${color};margin-top:6px">⚠ Considera exportar un backup para liberar espacio.</div>` : ''}
    `;
    // Try to get real browser quota via Storage API
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (!quota || !storageEl.isConnected) return;
        const realPct = (usage / quota * 100).toFixed(1);
        const realMB  = (usage / 1024 / 1024).toFixed(2);
        const totalMB = (quota / 1024 / 1024).toFixed(0);
        const hint = storageEl.querySelector('.storage-real-hint');
        if (!hint) {
          const d = document.createElement('div');
          d.className = 'storage-real-hint';
          d.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px';
          d.textContent = `Cuota real del navegador: ${realMB} MB de ${totalMB} MB (${realPct}%)`;
          storageEl.appendChild(d);
        }
      }).catch(() => {});
    }
  }

  // ─── Eventos de guardado ─────────────────────────────────────
  const saveKey = (inputId, field, provider, label) => {
    const btn = document.getElementById(`btnSave${label}Key`);
    if (!btn) return;
    btn.onclick = async () => {
      const key = (document.getElementById(inputId)?.value || '').trim();
      APP[field] = key;
      await saveApiKey(provider, key);
      saveData();
      showToast(key ? `API Key de ${label} guardada ✓` : `API Key de ${label} eliminada`, 'success');
      if (APP.aiProvider === provider) renderAI();
    };
  };
  saveKey('settings-claude-key', 'claudeApiKey', 'claude', 'Claude');
  saveKey('settings-openai-key', 'openaiApiKey', 'openai', 'OpenAI');
  saveKey('settings-gemini-key', 'geminiApiKey', 'gemini', 'Gemini');
  saveKey('settings-groq-key',   'groqApiKey',   'groq',   'Groq');

  renderVersionHistory();
  renderSettingsCategories();
  applyCategoriesCollapsed();
}

/* ─── Section visibility + drag reorder ─────────────────────── */
let _navSectionDragSrc = null;

function getNavElement(key) {
  if (key === 'transacciones') return document.getElementById('nav-group-transacciones');
  if (key === 'inversiones')   return document.getElementById('nav-group-inversiones');
  return document.querySelector(`.nav-item[data-section="${key}"]`);
}

function applySectionOrder() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;

  const order = (APP.sectionOrder && APP.sectionOrder.length)
    ? APP.sectionOrder
    : NAV_SECTIONS.map(s => s.key);

  // Ensure new sections added later are appended at end
  const fullOrder = [...new Set([...order, ...NAV_SECTIONS.map(s => s.key)])];

  fullOrder.forEach(key => {
    const el = getNavElement(key);
    if (el) nav.appendChild(el);
  });
}

function renderSectionVisibility() {
  const container = document.getElementById('section-visibility-list');
  if (!container) return;

  const order = (APP.sectionOrder && APP.sectionOrder.length)
    ? APP.sectionOrder
    : NAV_SECTIONS.map(s => s.key);

  const fullOrder = [...new Set([...order, ...NAV_SECTIONS.map(s => s.key)])];

  container.innerHTML = fullOrder.map(key => {
    const meta   = NAV_SECTIONS.find(s => s.key === key);
    if (!meta) return '';
    const hidden = APP.hiddenSections && APP.hiddenSections.includes(key);
    return `
      <div class="settings-row" draggable="true" data-order-key="${key}" style="cursor:default">
        <span class="settings-drag-handle" title="Arrastrar para reordenar">≡</span>
        <div class="settings-info">
          <div class="settings-name">${escapeHtml(meta.label)}</div>
          <div class="settings-desc">${escapeHtml(meta.desc)}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" data-section-toggle="${key}" ${hidden ? '' : 'checked'} />
          <span class="toggle-slider"></span>
        </label>
      </div>`;
  }).join('');

  // Wire toggle events
  container.querySelectorAll('[data-section-toggle]').forEach(input => {
    const sec = input.dataset.sectionToggle;
    input.onchange = () => {
      if (input.checked) showSectionNav(sec); else hideSectionNav(sec);
      saveData();
    };
  });

  // Wire drag-and-drop events
  container.querySelectorAll('[data-order-key]').forEach(row => {
    row.addEventListener('dragstart', () => {
      _navSectionDragSrc = row;
      setTimeout(() => { row.style.opacity = '0.4'; }, 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      container.querySelectorAll('[data-order-key]').forEach(r => r.classList.remove('section-drag-over'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      container.querySelectorAll('[data-order-key]').forEach(r => r.classList.remove('section-drag-over'));
      row.classList.add('section-drag-over');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('section-drag-over');
      if (!_navSectionDragSrc || _navSectionDragSrc === row) return;
      const rows   = [...container.querySelectorAll('[data-order-key]')];
      const fromIdx = rows.indexOf(_navSectionDragSrc);
      const toIdx   = rows.indexOf(row);
      if (fromIdx === -1 || toIdx === -1) return;
      if (fromIdx < toIdx) container.insertBefore(_navSectionDragSrc, row.nextSibling);
      else container.insertBefore(_navSectionDragSrc, row);
      APP.sectionOrder = [...container.querySelectorAll('[data-order-key]')].map(r => r.dataset.orderKey);
      saveData();
      applySectionOrder();
    });
  });
}

function renderSidebarProfile() {
  const nameEl   = document.getElementById('sidebar-username');
  const avatarEl = document.getElementById('sidebar-avatar');
  const name     = (APP.userName || '').trim() || 'Usuario';
  if (nameEl)   nameEl.textContent   = name;
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
  updateProfileDropdown();
}

function saveUserName() {
  const input = document.getElementById('settings-username');
  const raw   = (input?.value || '').trim();
  const name  = raw.replace(/<[^>]*>/g, '').slice(0, 50);
  APP.userName = name;
  saveData();
  renderSidebarProfile();
  showToast('Nombre actualizado ✓', 'success');
}

/* ─── Profile dropdown ─────────────────────────────────────── */
function toggleProfileDropdown() {
  const dd = document.getElementById('profile-dropdown');
  if (!dd) return;
  dd.style.display === 'none' ? openProfileDropdown() : closeProfileDropdown();
}

function openProfileDropdown() {
  const dd = document.getElementById('profile-dropdown');
  if (!dd) return;
  dd.style.display = 'block';
  updateProfileDropdown();
  const input = document.getElementById('profile-name-input');
  if (input) input.value = APP.userName || '';
  requestAnimationFrame(() => {
    document.addEventListener('click', _profileDropdownClickAway);
  });
}

function closeProfileDropdown() {
  const dd = document.getElementById('profile-dropdown');
  if (dd) dd.style.display = 'none';
  document.removeEventListener('click', _profileDropdownClickAway);
}

function _profileDropdownClickAway(e) {
  const wrap = document.getElementById('sidebar-profile-wrap');
  if (wrap && !wrap.contains(e.target)) {
    closeProfileDropdown();
  } else {
    document.addEventListener('click', _profileDropdownClickAway);
  }
}

function updateProfileDropdown() {
  const name = (APP.userName || '').trim() || 'Usuario';
  const av = document.getElementById('dd-avatar');
  const nm = document.getElementById('dd-username');
  if (av) av.textContent = name.charAt(0).toUpperCase();
  if (nm) nm.textContent = name;

  // Variant dots — mark active and wire clicks (idempotent)
  document.querySelectorAll('#dd-variant-swatches .dd-variant-dot').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.variant === APP.variant);
    if (!btn._vwired) {
      btn._vwired = true;
      btn.addEventListener('click', e => { e.stopPropagation(); setVariant(btn.dataset.variant); updateProfileDropdown(); });
    }
  });

  const themeIcon  = document.getElementById('dd-theme-icon');
  const themeLabel = document.getElementById('dd-theme-label');
  if (themeIcon)  themeIcon.textContent  = APP.theme === 'dark' ? '☀' : '☾';
  if (themeLabel) themeLabel.textContent = APP.theme === 'dark' ? 'Modo claro' : 'Modo oscuro';

  const privacyIcon  = document.getElementById('dd-privacy-icon');
  const privacyLabel = document.getElementById('dd-privacy-label');
  if (privacyIcon)  privacyIcon.textContent  = APP.privacyMode ? '🙈' : '👁';
  if (privacyLabel) privacyLabel.textContent = APP.privacyMode ? 'Desactivar privacidad' : 'Activar privacidad';

  const nw        = calcNetWorth();
  const achievedB = new Set(APP.achievedBehaviorMilestones || []);
  const doneNW    = MILESTONES.filter(m => (APP.achievedMilestones || []).includes(m.value) || nw >= m.value).length;
  const doneB     = BEHAVIOR_MILESTONES.filter(m => achievedB.has(m.key)).length;
  const doneAll   = doneNW + doneB;
  const totalAll  = MILESTONES.length + BEHAVIOR_MILESTONES.length;

  const countEl = document.getElementById('dd-milestone-count');
  if (countEl) countEl.textContent = doneAll > 0 ? `${doneAll}/${totalAll}` : '';

  // Sidebar profile milestone bar
  const sbMs = document.getElementById('sidebar-milestone-bar');
  if (sbMs) {
    const pct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;
    sbMs.innerHTML = `
      <div class="sidebar-ms-row" onclick="openMilestoneGallery()" title="Ver todas las insignias">
        <span class="sidebar-ms-label">★ ${doneAll}/${totalAll} insignias</span>
        <div class="sidebar-ms-track"><div class="sidebar-ms-fill" style="width:${pct}%"></div></div>
      </div>`;
  }
}

function saveProfileName() {
  const input = document.getElementById('profile-name-input');
  const raw   = (input?.value || '').trim();
  const name  = raw.replace(/<[^>]*>/g, '').slice(0, 50);
  APP.userName = name;
  if (input) input.value = name;
  saveData();
  renderSidebarProfile();
  updateProfileDropdown();
  showToast('Nombre actualizado ✓', 'success');
}

function renderSettingsCategories() {
  let _dragSrc = null;

  ['income', 'expense'].forEach(type => {
    const listEl = document.getElementById(`settings-cat-${type}`);
    if (!listEl) return;

    listEl.innerHTML = APP.categories[type].map((c, i) => `
      <div class="settings-cat-item" draggable="true" data-type="${type}" data-index="${i}">
        <span class="settings-cat-handle" title="Arrastrar para reordenar">≡</span>
        <span style="flex:1;font-size:13.5px">${escapeHtml(c)}</span>
        <button class="btn-danger" style="padding:3px 8px;font-size:11px"
          onclick="settingsDeleteCategory('${type}','${escapeHtml(c)}')">✕</button>
      </div>
    `).join('');

    listEl.querySelectorAll('[draggable]').forEach(item => {
      item.addEventListener('dragstart', () => {
        _dragSrc = item;
        setTimeout(() => item.style.opacity = '0.3', 0);
      });
      item.addEventListener('dragend', () => {
        item.style.opacity = '';
        listEl.querySelectorAll('[draggable]').forEach(el => el.classList.remove('cat-drag-over'));
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        if (_dragSrc && _dragSrc.dataset.type === type) {
          listEl.querySelectorAll('[draggable]').forEach(el => el.classList.remove('cat-drag-over'));
          item.classList.add('cat-drag-over');
        }
      });
      item.addEventListener('drop', e => {
        e.preventDefault();
        item.classList.remove('cat-drag-over');
        if (!_dragSrc || _dragSrc === item || _dragSrc.dataset.type !== type) return;
        const from = parseInt(_dragSrc.dataset.index);
        const to   = parseInt(item.dataset.index);
        APP.categories[type].splice(to, 0, APP.categories[type].splice(from, 1)[0]);
        saveData();
        renderSettingsCategories();
        // Refresh dropdowns if the transaction section is open
        if (APP.activeSection === SECTIONS.TRANSACTIONS) populateCategoryFilter();
      });
    });
  });
}

function toggleCategoriesSection() {
  APP.categoriesCollapsed = !APP.categoriesCollapsed;
  applyCategoriesCollapsed();
  saveData();
}

function applyCategoriesCollapsed() {
  const body    = document.getElementById('settings-cat-body');
  const label   = document.getElementById('catToggleLabel');
  const icon    = document.getElementById('catToggleIcon');
  if (!body) return;
  body.style.display  = APP.categoriesCollapsed ? 'none' : '';
  if (label) label.textContent = APP.categoriesCollapsed ? 'Mostrar' : 'Ocultar';
  if (icon)  icon.textContent  = APP.categoriesCollapsed ? '☰' : '✕';
}

function settingsAddCategory(type) {
  const input = document.getElementById(`settings-new-cat-${type}`);
  if (!input) return;
  const name = input.value.trim();
  if (!name) return showToast('Escribe un nombre', 'error');
  if (APP.categories[type].includes(name)) return showToast('Ya existe esta categoría', 'error');
  APP.categories[type].push(name);
  saveData();
  input.value = '';
  renderSettingsCategories();
  showToast('Categoría añadida ✓', 'success');
}

function settingsDeleteCategory(type, name) {
  APP.categories[type] = APP.categories[type].filter(c => c !== name);
  saveData();
  renderSettingsCategories();
  if (APP.activeSection === SECTIONS.TRANSACTIONS) populateCategoryFilter();
  showToast('Categoría eliminada', 'success');
}

function toggleSettingsDisclaimer(btn) {
  const disc = btn.closest('.settings-ai-key-row')?.nextElementSibling;
  if (disc && disc.classList.contains('ai-key-disclaimer')) {
    disc.style.display = disc.style.display === 'none' ? 'block' : 'none';
  }
}

function hideSectionNav(sec) {
  if (!APP.hiddenSections) APP.hiddenSections = [];
  if (!APP.hiddenSections.includes(sec)) APP.hiddenSections.push(sec);

  const btn = document.querySelector(`.nav-item[data-section="${sec}"]`);
  if (btn) btn.style.display = 'none';

  if (sec === 'inversiones') {
    const group = document.getElementById('nav-group-inversiones');
    if (group) group.style.display = 'none';
  }
  if (sec === 'transacciones') {
    const group = document.getElementById('nav-group-transacciones');
    if (group) group.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════════════════════
   26. EMPTY STATES CON INTENCIÓN
═══════════════════════════════════════════════════════════════ */
function emptyState(icon, title, desc, btnText, btnFn) {
  return `<div class="empty-cta">
    <div class="empty-cta-icon">${icon}</div>
    <h4 class="empty-cta-title">${title}</h4>
    <p class="empty-cta-desc">${desc}</p>
    ${btnText ? `<button class="btn-primary" style="margin-top:6px" onclick="${btnFn}">${btnText}</button>` : ''}
  </div>`;
}
function emptyRow(cols, icon, title, desc, btnText, btnFn) {
  return `<tr><td colspan="${cols}" class="empty-cta-td">${emptyState(icon, title, desc, btnText, btnFn)}</td></tr>`;
}

/* ═══════════════════════════════════════════════════════════════
   27. BÚSQUEDA GLOBAL — COMMAND PALETTE
═══════════════════════════════════════════════════════════════ */
let _searchActive = -1;

function openSearch() {
  const overlay = document.getElementById('searchOverlay');
  const input   = document.getElementById('searchInput');
  if (!overlay || !input) return;
  overlay.classList.add('open');
  input.value = '';
  _searchActive = -1;
  renderSearchResults('');
  setTimeout(() => input.focus(), 50);
}

function closeSearch() {
  document.getElementById('searchOverlay')?.classList.remove('open');
}

function handleSearchInput() {
  const q = document.getElementById('searchInput')?.value || '';
  _searchActive = -1;
  renderSearchResults(q.trim());
}

function searchAll(q) {
  const ql = q.toLowerCase();
  const results = [];

  // Transacciones
  APP.transactions.forEach(t => {
    if ([t.description, t.category, String(t.amount)].some(f => f?.toLowerCase().includes(ql))) {
      results.push({ type: 'transaction', icon: '⇄', badge: 'Transacción',
        title: t.description, sub: `${t.category} · ${formatCurrency(t.amount)}`,
        section: 'transactions' });
    }
  });

  // Portfolio
  APP.portfolio.forEach(a => {
    if ([a.name, a.ticker].some(f => f?.toLowerCase().includes(ql))) {
      results.push({ type: 'asset', icon: '◈', badge: 'Cartera',
        title: a.name, sub: `${a.ticker || '—'} · ${formatCurrency(a.currentPrice * a.quantity)}`,
        section: 'portfolio' });
    }
  });

  // Watchlist
  APP.watchlist.forEach(w => {
    if ([w.name, w.ticker].some(f => f?.toLowerCase().includes(ql))) {
      results.push({ type: 'watchlist', icon: '▸', badge: 'Watchlist',
        title: w.name, sub: `${w.ticker || '—'} · ${formatCurrency(w.currentPrice || 0)}`,
        section: 'watchlist' });
    }
  });

  // Objetivos
  APP.goals.forEach(g => {
    if (g.name?.toLowerCase().includes(ql)) {
      const pct = g.targetAmount > 0 ? ((g.currentAmount / g.targetAmount) * 100).toFixed(0) : 0;
      results.push({ type: 'goal', icon: '◎', badge: 'Objetivo',
        title: `${g.emoji || ''} ${g.name}`, sub: `${pct}% completado · ${formatCurrency(g.currentAmount)} / ${formatCurrency(g.targetAmount)}`,
        section: 'goals' });
    }
  });

  // Activos alternativos
  APP.alternatives.forEach(a => {
    if (a.name?.toLowerCase().includes(ql)) {
      results.push({ type: 'alt', icon: '◇', badge: 'Alternativo',
        title: a.name, sub: `${a.category || ''} · ${formatCurrency(a.currentPrice || 0)}`,
        section: 'alternatives' });
    }
  });

  // Bizums
  APP.bizums.forEach(b => {
    if ([b.person, b.concept].some(f => f?.toLowerCase().includes(ql))) {
      results.push({ type: 'bizum', icon: '⇄', badge: 'Bizum',
        title: `${b.person} — ${b.concept}`,
        sub: `${formatCurrency(b.amount)} · ${b.status === 'pending' ? 'Pendiente' : 'Liquidado'}`,
        section: 'bizums' });
    }
  });

  return results.slice(0, 12);
}

function highlightMatch(text, q) {
  if (!q) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx))
    + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>'
    + escapeHtml(text.slice(idx + q.length));
}

function renderSearchResults(q) {
  const container = document.getElementById('searchResults');
  if (!container) return;

  if (!q) {
    container.innerHTML = '<div class="search-hint">Escribe para buscar en todos tus datos financieros</div>';
    return;
  }

  const results = searchAll(q);

  if (results.length === 0) {
    container.innerHTML = `<div class="search-no-results">Sin resultados para "<strong>${escapeHtml(q)}</strong>"</div>`;
    return;
  }

  container.innerHTML = results.map((r, i) => `
    <div class="search-result${i === _searchActive ? ' active' : ''}" data-idx="${i}" onclick="searchGoTo(${i})">
      <div class="search-result-icon">${r.icon}</div>
      <div class="search-result-info">
        <div class="search-result-title">${highlightMatch(r.title, q)}</div>
        <div class="search-result-sub">${escapeHtml(r.sub)}</div>
      </div>
      <span class="search-result-badge">${r.badge}</span>
    </div>
  `).join('');
}

let _searchResults = [];
function searchAll_cached(q) {
  _searchResults = searchAll(q);
  return _searchResults;
}

function searchGoTo(idx) {
  const q = document.getElementById('searchInput')?.value.trim() || '';
  const results = searchAll(q);
  const r = results[idx];
  if (!r) return;
  closeSearch();
  navigateTo(r.section);
}

function searchMoveActive(dir) {
  const q = document.getElementById('searchInput')?.value.trim() || '';
  const results = searchAll(q);
  if (!results.length) return;
  _searchActive = Math.max(0, Math.min(results.length - 1, _searchActive + dir));
  // Update active class
  document.querySelectorAll('.search-result').forEach((el, i) => {
    el.classList.toggle('active', i === _searchActive);
    if (i === _searchActive) el.scrollIntoView({ block: 'nearest' });
  });
}

function searchConfirmActive() {
  if (_searchActive >= 0) searchGoTo(_searchActive);
  else {
    const q = document.getElementById('searchInput')?.value.trim() || '';
    const results = searchAll(q);
    if (results.length > 0) searchGoTo(0);
  }
}

/* ─── IA/Gemini → ai.js ────────────────────────────────────────────────── */
/* ─── Secciones de la sidebar ───────────────────────────────────────────── */
const SECTIONS = {
  DASHBOARD:    'dashboard',
  TRANSACTIONS: 'transactions',
  PORTFOLIO:    'portfolio',
  WATCHLIST:    'watchlist',
  NETWORTH:     'networth',
  GOALS:        'goals',
  ALTERNATIVES: 'alternatives',
  PASIVOS:      'pasivos',
  FISCALIDAD:   'fiscalidad',
  SIMULATOR:    'simulator',
  AI:           'ai',
  RECURRING:    'recurring',
  SETTINGS:     'settings',
};

const NAV_SECTIONS = [
  { key: 'dashboard',     label: 'Dashboard',            desc: 'Visión general del patrimonio' },
  { key: 'transacciones', label: 'Ingresos & Gastos',    desc: 'Transacciones y Bizums' },
  { key: 'inversiones',   label: 'Inversiones',           desc: 'Cartera, Watchlist y Dividendos' },
  { key: 'networth',      label: 'Patrimonio Neto',       desc: 'Efectivo, inversiones y distribución' },
  { key: 'pasivos',       label: 'Pasivos',               desc: 'Deudas y préstamos' },
  { key: 'alternatives',  label: 'Activos Alternativos',  desc: 'Relojes, arte y otros activos' },
  { key: 'goals',         label: 'Objetivos',             desc: 'Metas de ahorro e inversión' },
  { key: 'simulator',     label: 'Simulador',             desc: 'Cálculo de interés compuesto' },
  { key: 'fiscalidad',    label: 'Fiscalidad',            desc: 'IRPF y declaración de la renta' },
  { key: 'ai',            label: 'Asesor IA',             desc: 'Análisis financiero con inteligencia artificial' },
];

/* ═══════════════════════════════════════════════════════════════
   27. CATEGORIZACIÓN AUTOMÁTICA DE TRANSACCIONES
   Flujo: 1) Patrones aprendidos → 2) Keywords locales → 3) Claude AI
═══════════════════════════════════════════════════════════════ */

const CATEGORY_KEYWORDS = {
  expense: {
    'Alimentación':  ['mercadona', 'carrefour', 'lidl', 'aldi', 'dia ', ' dia', 'alcampo', 'eroski', 'consum', 'spar', 'supermercado', 'hipercor', 'ahorra mas', 'froiz', 'supercor', 'covirán', 'masymas', 'bonarea', 'panaderia', 'fruteria', 'pescaderia', 'carniceria', 'verduleria', 'colmado'],
    'Restaurantes':  ['restaurante', 'cafeteria', 'mcdonalds', 'burger king', 'kfc', 'telepizza', 'dominos', 'pizzeria', 'sushi', 'kebab', 'taberna', 'mesón', 'glovo', 'just eat', 'deliveroo', 'uber eats', 'bar ', 'tapas', 'hamburgueseria'],
    'Transporte':    ['gasolinera', 'gasolina', 'repsol', 'cepsa', 'bp ', 'shell', 'renfe', 'metro', 'cabify', 'uber', 'bolt', 'blablacar', 'autopista', 'peaje', 'parking', 'aparcamiento', 'itv', 'taller', 'autobus', 'avion', 'vueling', 'iberia', 'ryanair', 'easyjet'],
    'Vivienda':      ['alquiler', 'hipoteca', 'comunidad', 'endesa', 'iberdrola', 'naturgy', 'agua ', 'gas nat', 'vodafone', 'movistar', 'orange ', 'jazztel', 'masmovil', 'internet', 'adsl', 'fibra', 'seguro hogar', 'ikea', 'leroy merlin', 'bricomart'],
    'Salud':         ['farmacia', 'medico', 'dentista', 'clinica', 'hospital', 'sanitas', 'adeslas', 'asisa', 'mapfre salud', 'fisioterapia', 'optica', 'gym', 'gimnasio', 'sport', 'wellness'],
    'Ocio':          ['cine', 'teatro', 'concierto', 'museo', 'parque', 'viaje', 'hotel', 'airbnb', 'booking', 'expedia', 'steam', 'playstation', 'xbox', 'nintendo', 'twitch'],
    'Suscripciones': ['netflix', 'spotify', 'hbo', 'disney', 'amazon prime', 'prime video', 'apple', 'icloud', 'dropbox', 'adobe', 'microsoft 365', 'google one', 'youtube premium', 'dazn', 'filmin'],
    'Ropa':          ['zara', 'h&m', 'mango', 'pull&bear', 'bershka', 'stradivarius', 'massimo dutti', 'primark', 'el corte ingles', 'decathlon', 'nike', 'adidas', 'zapateria'],
    'Educación':     ['universidad', 'academia', 'udemy', 'coursera', 'master', 'matricula', 'formacion', 'libro', 'fnac', 'casa del libro'],
    'Seguros':       ['seguro', 'axa', 'mapfre', 'mutua madrilena', 'allianz', 'generali', 'zurich', 'helvetia'],
    'Fiesta':        ['discoteca', 'club ', 'botellon', 'copa ', 'chupito', 'nightclub'],
  },
  income: {
    'Salario':    ['nomina', 'salario', 'sueldo', 'empresa', 'trabajo', 'mensual'],
    'Freelance':  ['freelance', 'factura', 'cliente', 'proyecto', 'honorarios', 'consulting'],
    'Dividendos': ['dividendo', 'cupon', 'renta fija', 'interes'],
    'Alquiler':   ['alquiler', 'arrendamiento', 'inquilino', 'renta'],
    'Venta':      ['venta', 'wallapop', 'ebay', 'vendido', 'segunda mano', 'vinted'],
  },
};

const _TX_STOPWORDS = new Set([
  // transaction type prefixes
  'cargo', 'compra', 'pago', 'tpv', 'pos', 'trans', 'transferencia', 'transf',
  'bizum', 'recibo', 'domiciliacion', 'domicil', 'abono', 'ingreso', 'reintegro',
  'retiro', 'disposicion', 'liquidacion', 'tarjeta', 'tarj',
  // TPV/POS variants seen in Spanish bank exports
  'tpveuro', 'tpvplus', 'redsys', 'visa', 'mastercard',
  // prepositions / articles
  'de', 'a', 'en', 'por', 'del', 'los', 'las', 'una', 'unos', 'via',
  // generic billing noise
  'factura', 'fac', 'online', 'servicio', 'servicios', 'comercio',
  // location noise (street types)
  'calle', 'avda', 'avd', 'paseo', 'pso', 'plaza', 'plz', 'pol',
  // company-suffix noise
  'slu', 'sau', 'ses', 'soc', 'corp', 'group', 'grup', 'ltd', 'inc',
]);

function txPatternKey(description) {
  const norm = description.toLowerCase()
    .split('').filter(function(c){var cc=c.charCodeAt(0);return cc<768||cc>879;}).join('')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = norm.split(/\s+/);
  const meaningful = words.filter(w => w.length >= 3 && !_TX_STOPWORDS.has(w) && !/^\d+$/.test(w));
  if (!meaningful.length) return words.slice(0, 2).join(' ');
  // Distinctive word (>=5 chars) → use it alone so "MERCADONA GRAN VIA BCN" and
  // "MERCADONA CALLAO MAD" both key to "mercadona" instead of diverging by branch
  if (meaningful[0].length >= 5) return meaningful[0];
  return meaningful.slice(0, 2).join(' ');
}

// Pattern values are { cat, hits } objects; legacy string values are supported via _patCat
function _patCat(p) { return p && typeof p === 'object' ? p.cat : p; }
function _patWrite(key, cat) {
  if (!APP.categoryPatterns) APP.categoryPatterns = {};
  const existing = APP.categoryPatterns[key];
  const hits = (existing && typeof existing === 'object' ? existing.hits : 0) + 1;
  APP.categoryPatterns[key] = { cat, hits };
}

function matchLocalKeywords(description, type) {
  const norm = description.toLowerCase()
    .split('').filter(function(c){var cc=c.charCodeAt(0);return cc<768||cc>879;}).join('');

  const map       = CATEGORY_KEYWORDS[type] || {};
  const available = type === 'income' ? APP.categories.income : APP.categories.expense;

  for (const [cat, keywords] of Object.entries(map)) {
    if (!available.includes(cat)) continue;
    if (keywords.some(kw => norm.includes(kw))) return cat;
  }
  return null;
}

async function autoSuggestCategory(description) {
  const type = document.getElementById('f-tx-type')?.value || 'expense';

  // 1. Patrones aprendidos del usuario
  if (APP.categoryPatterns) {
    const key     = txPatternKey(description);
    const learned = _patCat(APP.categoryPatterns[key]);
    if (learned) { applyCatSuggestion(learned, 'aprendido'); return; }
  }

  // 2. Keywords locales (instantáneo)
  const local = matchLocalKeywords(description, type);
  if (local) { applyCatSuggestion(local, 'sugerido'); return; }

  // 3. AI como fallback (si tiene alguna API key o el servidor tiene clave)
  const anyKey = [APP.claudeApiKey, APP.openaiApiKey, APP.geminiApiKey, APP.groqApiKey].some(k => (k || '').trim());
  if (!anyKey && (typeof _serverAI === 'undefined' || _serverAI !== true)) return;

  const available = type === 'income' ? APP.categories.income : APP.categories.expense;
  try {
    const suggested = await categorizeTxWithAI(description, type, available);
    if (suggested) applyCatSuggestion(suggested, 'IA ✦');
  } catch {}
}

function applyCatSuggestion(category, source) {
  const sel = document.getElementById('f-tx-category');
  if (!sel) return;
  const exists = Array.from(sel.options).some(o => o.value === category);
  if (!exists) return;
  sel.value = category;

  const badge = document.getElementById('cat-ai-badge');
  if (badge) {
    badge.textContent = source;
    badge.style.display = 'inline-block';
  }
}

function hideCatBadge() {
  const badge = document.getElementById('cat-ai-badge');
  if (badge) badge.style.display = 'none';
}

async function categorizeTxWithAI(description, type, available) {
  const prompt = `Categoriza este ${type === 'expense' ? 'gasto' : 'ingreso'}: "${description}"\nCategorías disponibles: ${available.join(', ')}\nResponde SOLO con el nombre exacto de la categoría, sin explicación.`;
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: APP.aiProvider || 'claude',
        apiKey:   (APP[({ claude: 'claudeApiKey', openai: 'openaiApiKey', gemini: 'geminiApiKey', groq: 'groqApiKey' })[APP.aiProvider]] || '').trim(),
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: 'Eres un clasificador de transacciones financieras. Responde SOLO con el nombre exacto de la categoría.',
      }),
    });
    if (res.status === 429) { showToast('Límite de IA alcanzado, espera 60 s', 'error'); return null; }
    if (!res.ok) return null;
    const data = await res.json();
    const suggested = (data.text || '').trim();
    return available.includes(suggested) ? suggested : null;
  } catch { return null; }
}

function showSectionNav(sec) {
  if (APP.hiddenSections) {
    APP.hiddenSections = APP.hiddenSections.filter(s => s !== sec);
  }

  const btn = document.querySelector(`.nav-item[data-section="${sec}"]`);
  if (btn) btn.style.display = '';

  if (sec === 'inversiones') {
    const group = document.getElementById('nav-group-inversiones');
    if (group) group.style.display = '';
  }
  if (sec === 'transacciones') {
    const group = document.getElementById('nav-group-transacciones');
    if (group) group.style.display = '';
  }
}

function handleRestore(input) {
  const file = input.files[0];
  if (!file) return;
  openModal(
    'Importar copia de seguridad',
    `<p>Esto <strong>reemplazará todos tus datos actuales</strong> con los del archivo <em>${file.name}</em>.</p>
     <p>Esta acción no se puede deshacer. ¿Continuar?</p>`,
    () => restoreBackup(file)
  );
  input.value = '';
}

/* ═══════════════════════════════════════════════════════════════
   24. ESCALA GRÁFICO NETWORTH
═══════════════════════════════════════════════════════════════ */
function initScaleButtons() {
  document.querySelectorAll('.scale-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _networthScale = btn.dataset.scale;
      renderChartNetworthHistory();
    });
  });
}

/* ─── Análisis cartera → portfolio.js ──────────────────────────────────── */
/* ─── Fiscalidad → fiscal.js ───────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════
   25. SISTEMA DE ERRORES GLOBAL
═══════════════════════════════════════════════════════════════ */
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason?.message || String(e.reason) || 'Error asíncrono desconocido';
  console.error('[Finova] Promesa rechazada:', e.reason);
  if (typeof showToast === 'function') showToast(`Error: ${msg.slice(0, 80)}`, 'error');
});

window.onerror = (message, source, lineno, colno, error) => {
  console.error('[Finova] Error global:', { message, source, lineno, error });
  if (message && !String(message).includes('ResizeObserver') && typeof showToast === 'function') {
    showToast(`Error inesperado: ${String(message).slice(0, 70)}`, 'error');
  }
};

/* ═══════════════════════════════════════════════════════════════
   MOBILE HEADER
═══════════════════════════════════════════════════════════════ */

let _mhChart = null;
let _mhScale = '6m';
let _mhInited = false;

function initMobileHeader() {
  updateMobileHeader();
  if (_mhInited) return;
  _mhInited = true;

  // Tabs
  document.querySelectorAll('.mh-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      navigateTo(section);
    });
  });

  // Botones escala gráfico
  document.querySelectorAll('.mh-scale-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _mhScale = btn.dataset.scale;
      document.querySelectorAll('.mh-scale-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMobileChart();
    });
  });
}

function updateMobileHeader() {
  if (window.innerWidth > 768) return;

  // Saludo
  const name = APP.profile?.name || 'Finova';
  const hour = new Date().getHours();
  const greeting = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const greetEl = document.getElementById('mh-greeting');
  if (greetEl) greetEl.textContent = `${greeting}, ${name}`;

  // Avatar
  const avatarEl = document.getElementById('mh-avatar');
  if (avatarEl) avatarEl.textContent = (name[0] || 'U').toUpperCase();

  // Net worth
  const nw = calcNetWorth();
  const networthEl = document.getElementById('mh-networth');
  if (networthEl) networthEl.textContent = formatCurrency(nw);

  // Cambio mensual (último período del historial)
  const changeEl = document.getElementById('mh-change');
  if (changeEl) {
    const hist = APP.networthHistory || [];
    if (hist.length >= 2) {
      const prev = hist[hist.length - 2]?.value || 0;
      const curr = hist[hist.length - 1]?.value || nw;
      const diff = curr - prev;
      const pct  = prev > 0 ? ((diff / prev) * 100).toFixed(1) : '0.0';
      changeEl.textContent = `${diff >= 0 ? '↑' : '↓'} ${formatCurrency(Math.abs(diff))} · ${Math.abs(pct)}%`;
      changeEl.className = 'mh-change' + (diff < 0 ? ' negative' : '');
    } else {
      changeEl.textContent = '—';
    }
  }

  // KPI Cartera
  const portfolioVal = calcPortfolioValue();
  const portEl = document.getElementById('mh-kpi-portfolio');
  if (portEl) portEl.textContent = formatCurrency(portfolioVal);

  // KPI Ahorro mes
  const income  = (APP.transactions || []).filter(t => t.type === 'income'  && isCurrentMonth(t.date)).reduce((s, t) => s + t.amount, 0);
  const expense = (APP.transactions || []).filter(t => t.type === 'expense' && isCurrentMonth(t.date)).reduce((s, t) => s + t.amount, 0);
  const savings = income - expense;
  const savEl = document.getElementById('mh-kpi-savings');
  if (savEl) savEl.textContent = formatCurrency(savings);
  const savChgEl = document.getElementById('mh-kpi-savings-change');
  if (savChgEl) {
    const rate = income > 0 ? ((savings / income) * 100).toFixed(1) : '0.0';
    savChgEl.textContent = `${rate}% tasa`;
    savChgEl.className = 'mh-kpi-change' + (savings < 0 ? ' negative' : '');
  }

  // KPI FIRE
  const fireGoal = (APP.goals || []).find(g =>
    g.name?.toLowerCase().includes('fire') || g.name?.toLowerCase().includes('independencia')
  );
  const firePct = fireGoal && fireGoal.targetAmount > 0
    ? Math.min((fireGoal.currentAmount / fireGoal.targetAmount) * 100, 100)
    : 0;
  const fireEl   = document.getElementById('mh-kpi-fire');
  const fireFill = document.getElementById('mh-kpi-fire-fill');
  if (fireEl)   fireEl.textContent  = `${firePct.toFixed(0)}%`;
  if (fireFill) fireFill.style.width = `${firePct}%`;

  // Actividad reciente
  const recentList = document.getElementById('mh-recent-list');
  if (recentList) {
    const recent = [...(APP.transactions || [])]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 3);
    recentList.innerHTML = recent.length
      ? recent.map(t => `
          <div class="mh-recent-item">
            <div class="mh-recent-name">${escapeHtml(t.description || t.category || '—')}</div>
            <div class="mh-recent-amount ${t.type === 'income' ? 'positive' : 'negative'}">
              ${t.type === 'income' ? '+' : '−'}${formatCurrency(t.amount)}
            </div>
          </div>`).join('')
      : `<div style="font-size:11px;opacity:.4;color:var(--sidebar-text)">Sin actividad reciente</div>`;
  }

  // Gráfico
  renderMobileChart();
}

function renderMobileChart() {
  const canvas = document.getElementById('mh-sparkline-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  let hist = [...(APP.networthHistory || [])];
  if (_mhScale === '6m')  hist = hist.slice(-6);
  else if (_mhScale === '1y') hist = hist.slice(-12);
  if (hist.length < 2) return;

  const labels = hist.map(h => h.date || '');
  const data   = hist.map(h => h.value);
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--sidebar-accent').trim() || '#c8a96e';

  if (_mhChart) { _mhChart.destroy(); _mhChart = null; }

  _mhChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: accentColor,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      animation: { duration: 400 }
    }
  });
}

function isCurrentMonth(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const d   = new Date(dateStr);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/* ═══════════════════════════════════════════════════════════════
   SECTION LAYOUT CUSTOMIZER
   Permite ocultar/mostrar widgets por sección sin borrar datos.
   Visibilidad persiste en APP.layoutConfig.
═══════════════════════════════════════════════════════════════ */

const SECTION_WIDGETS = {
  'section-dashboard': [
    { id: 'dash-block-kpis',           label: 'KPIs principales',       icon: '📊' },
    { id: 'dash-block-chart-networth', label: 'Evolución patrimonio',    icon: '📈' },
    { id: 'dash-block-chart-dist',     label: 'Distribución cartera',    icon: '🥧' },
    { id: 'dash-block-investments',    label: 'Mejores inversiones',     icon: '🏆' },
    { id: 'dash-block-activity',       label: 'Actividad reciente',      icon: '⟳'  },
    { id: 'dash-block-goals',          label: 'Objetivos',               icon: '🎯' },
    { id: 'dash-block-expcats',        label: 'Gastos por categoría',    icon: '🏷' },
    { id: 'dash-block-rule5030',       label: 'Regla 50/30/20',          icon: '⚖️' },
    { id: 'dash-block-wealth-score',   label: 'Wealth Score',            icon: '💎' },
    { id: 'dash-block-timeline',       label: 'Timeline financiero',     icon: '📅' },
    { id: 'dash-block-heatmap',        label: 'Mapa de calor gastos',    icon: '🗓' },
  ],
  'section-transactions': [
    { id: 'tx-widget-quickadd', label: 'Añadir rápido',          icon: '⚡' },
    { id: 'tx-widget-kpis',     label: 'KPIs del mes',           icon: '📊' },
    { id: 'tx-widget-txlist',   label: 'Lista de transacciones', icon: '📋' },
    { id: 'tx-widget-charts',   label: 'Gráficos',               icon: '📈' },
    { id: 'tx-budgets-section', label: 'Presupuestos',           icon: '🎯' },
  ],
  'section-portfolio': [
    { id: 'port-widget-kpis',         label: 'KPIs cartera',          icon: '📊' },
    { id: 'port-widget-highlights',   label: 'Mejor / Peor activo',   icon: '🏆' },
    { id: 'port-widget-table',        label: 'Tabla de activos',      icon: '📋' },
    { id: 'port-widget-analysis',     label: 'Concentración',         icon: '🔍' },
    { id: 'port-widget-correlation',  label: 'Correlación activos',   icon: '🔗' },
    { id: 'port-widget-charts',       label: 'Gráficos',              icon: '📈' },
  ],
  'section-networth': [
    { id: 'nw-widget-kpis',        label: 'KPIs patrimonio',    icon: '📊' },
    { id: 'nw-widget-cash',        label: 'Efectivo & Cuentas', icon: '🏦' },
    { id: 'nw-widget-properties',  label: 'Inmuebles',          icon: '🏠' },
    { id: 'nw-widget-breakdown',   label: 'Distribución',       icon: '🥧' },
  ],
  'section-fiscalidad': [
    { id: 'fisc-widget-kpis',      label: 'KPIs fiscales',          icon: '📊' },
    { id: 'fisc-tramos',           label: 'Tramos IRPF',            icon: '📊' },
    { id: 'fisc-compensation',     label: 'Compensación ganancias', icon: '⚖️' },
    { id: 'fisc-dividends',        label: 'Dividendos fiscales',    icon: '💰' },
    { id: 'fisc-two-months',       label: 'Regla 2 meses',         icon: '⏱' },
    { id: 'fisc-optimization',     label: 'Optimización fiscal',   icon: '💡' },
    { id: 'fisc-resumen-completo', label: 'Resumen IRPF completo', icon: '📋' },
  ],
  'section-goals': [
    { id: 'goals-grid', label: 'Mis objetivos', icon: '🎯' },
  ],
};

function applySectionLayouts() {
  const cfg = APP.layoutConfig || {};
  Object.entries(SECTION_WIDGETS).forEach(([sectionId, widgets]) => {
    const secCfg = cfg[sectionId] || {};
    widgets.forEach(w => {
      const el = document.getElementById(w.id);
      if (!el) return;
      const hidden = secCfg[w.id] === false;
      el.classList.toggle('widget-hidden', hidden);
    });
  });
}

function toggleSectionWidget(sectionId, widgetId, visible) {
  if (!APP.layoutConfig) APP.layoutConfig = {};
  if (!APP.layoutConfig[sectionId]) APP.layoutConfig[sectionId] = {};
  if (visible) {
    delete APP.layoutConfig[sectionId][widgetId];
  } else {
    APP.layoutConfig[sectionId][widgetId] = false;
  }
  if (!Object.keys(APP.layoutConfig[sectionId]).length) {
    delete APP.layoutConfig[sectionId];
  }
  const el = document.getElementById(widgetId);
  if (el) el.classList.toggle('widget-hidden', !visible);
  saveData();
}

function injectCustomizerButtons() {
  Object.keys(SECTION_WIDGETS).forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const header = section.querySelector('.section-header');
    if (!header) return;
    if (header.querySelector('.btn-customize')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-ghost btn-customize';
    btn.title = 'Personalizar sección';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="2.5"/><path d="M7 1v1.5M7 11.5V13M13 7h-1.5M2.5 7H1M10.9 3.1l-1.06 1.06M4.16 9.84l-1.06 1.06M10.9 10.9l-1.06-1.06M4.16 4.16l-1.06-1.06"/></svg> Personalizar';
    btn.onclick = () => openSectionCustomizer(sectionId);
    const btnRow = header.querySelector('.btn-row');
    if (btnRow) {
      btnRow.insertBefore(btn, btnRow.firstChild);
    } else {
      header.appendChild(btn);
    }
  });
}

function openSectionCustomizer(sectionId) {
  const widgets = SECTION_WIDGETS[sectionId];
  if (!widgets) return;
  const secCfg = (APP.layoutConfig || {})[sectionId] || {};
  const sectionNames = {
    'section-dashboard':     'Dashboard',
    'section-transactions':  'Ingresos & Gastos',
    'section-portfolio':     'Cartera',
    'section-networth':      'Patrimonio Neto',
    'section-fiscalidad':    'Fiscalidad',
    'section-goals':         'Objetivos',
  };

  const rows = widgets.map(w => {
    const isVisible = secCfg[w.id] !== false;
    return `<label class="cust-widget-row${isVisible ? '' : ' cust-widget-hidden'}">
      <div class="cust-widget-left">
        <span class="cust-widget-icon">${w.icon}</span>
        <span class="cust-widget-label">${w.label}</span>
      </div>
      <label class="notif-toggle">
        <input type="checkbox" ${isVisible ? 'checked' : ''}
          onchange="toggleSectionWidget('${sectionId}','${w.id}',this.checked);this.closest('.cust-widget-row').classList.toggle('cust-widget-hidden',!this.checked)">
        <span class="notif-toggle-track"></span>
      </label>
    </label>`;
  }).join('');

  const hiddenCount = widgets.filter(w => secCfg[w.id] === false).length;

  openModal(`Personalizar — ${sectionNames[sectionId] || sectionId}`, `
    <p class="cust-hint">Desactiva los bloques que no necesitas. Los datos no se eliminan.</p>
    <div class="cust-widget-list">${rows}</div>
    ${hiddenCount > 0 ? `<button class="btn-ghost-sm cust-reset-btn" onclick="_resetSectionLayout('${sectionId}')">Restaurar todo</button>` : ''}
  `, null, null);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
}

function _resetSectionLayout(sectionId) {
  if (APP.layoutConfig) delete APP.layoutConfig[sectionId];
  saveData();
  applySectionLayouts();
  openSectionCustomizer(sectionId);
}
