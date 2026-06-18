/* ═══════════════════════════════════════════════════════════════
   FINOVA — onboarding.js
   Flujo conversacional: una pregunta, un número, siguiente.
   90 segundos → el usuario ve su patrimonio real.
═══════════════════════════════════════════════════════════════ */

'use strict';

let _obStep = 0;
let _obData = {};

function _obDataDefaults() {
  return {
    cashTotal:      '',
    hasInvestments: null,   // null = sin responder, true/false tras elegir
    invTotal:       '',
    goalType:       'emergencia',
    goalTarget:     '',
  };
}

/* ── Entrada / salida ──────────────────────────────────────── */

function showOnboarding() {
  const el = document.getElementById('onboarding-overlay');
  if (!el) return;
  _obStep = 0;
  _obData = _obDataDefaults();

  // Demo data behind overlay so the app looks alive
  const isEmpty = APP.transactions.length === 0 && APP.portfolio.length === 0 && APP.cashAccounts.length === 0;
  if (isEmpty && !APP.onboardingDone) {
    loadDemoData();
    APP._obPreviewActive = true;
    if (typeof renderDashboard === 'function') renderDashboard();
  }

  // Appear instantly — no 420ms CSS fade-in, no empty-frame flash
  el.style.cssText = 'display:flex;opacity:1;';
  document.body.style.overflow = 'hidden';

  _obRender(0, 'none');  // synchronous — content is painted before the loading screen fades
}

function hideOnboarding() {
  const el = document.getElementById('onboarding-overlay');
  if (!el) return;
  el.style.transition = 'opacity .25s ease';
  el.style.opacity    = '0';
  setTimeout(() => { el.style.cssText = 'display:none;opacity:0;transition:none;'; }, 270);
  document.body.style.overflow = '';
}

/* ── Navegación ────────────────────────────────────────────── */

function obNext()  { _obSave(); _obRender(_obStep + 1, 'forward'); }
function obPrev()  { _obSave(); _obRender(_obStep - 1, 'back'); }
function obGoTo(n) { _obSave(); _obRender(n, n > _obStep ? 'forward' : 'back'); }

function _obRender(step, dir) {
  _obStep = step;
  const content = document.getElementById('ob-content');
  if (!content) return;

  _obUpdateProgress();

  if (dir === 'none') {
    content.innerHTML = _obTemplate(step);
    _obAfterRender(step);
    return;
  }

  const exitX  = dir === 'forward' ? '-28px' : '28px';
  const enterX = dir === 'forward' ? '28px'  : '-28px';

  content.style.transition = 'opacity .14s ease, transform .14s ease';
  content.style.opacity    = '0';
  content.style.transform  = 'translateX(' + exitX + ')';

  setTimeout(function() {
    content.style.transition = 'none';
    content.style.opacity    = '0';
    content.style.transform  = 'translateX(' + enterX + ')';
    content.innerHTML = _obTemplate(step);
    void content.offsetHeight;
    content.style.transition = 'opacity .18s ease, transform .18s ease';
    content.style.opacity    = '1';
    content.style.transform  = 'translateX(0)';
    _obAfterRender(step);
  }, 160);
}

function _obAfterRender(step) {
  setTimeout(function() {
    const inp = document.querySelector('#ob-content input[type=number],#ob-content input[type=text]');
    if (inp) inp.focus();
  }, 220);
}

function _obUpdateProgress() {
  const el = document.getElementById('ob-dots');
  if (!el) return;
  el.innerHTML = ''; // progress is now inside each step header
}

function _obStepHeader(step, showBack) {
  const pct  = Math.round((step / 3) * 100);
  const back = showBack
    ? '<button class="ob-step-back" onclick="obGoTo(' + (step - 1) + ')" aria-label="Atrás">←</button>'
    : '<span></span>';
  return '<div class="ob-step-header">' +
    back +
    '<div class="ob-step-progress-wrap"><div class="ob-step-progress-bar" style="width:' + pct + '%"></div></div>' +
    '<span class="ob-step-counter">' + step + ' de 3</span>' +
  '</div>';
}

function _obSave() {
  if (_obStep === 1) {
    const inp = document.getElementById('ob-cash-input');
    _obData.cashTotal = inp ? inp.value : '';
  }
  if (_obStep === 2) {
    const inv = document.getElementById('ob-inv-input');
    _obData.invTotal = inv ? inv.value : '';
  }
  if (_obStep === 3) {
    const tgt = document.getElementById('ob-goal-target');
    _obData.goalTarget = tgt ? tgt.value : '';
    _obData.goalType   = document.querySelector('.ob-goal-pill.active')?.dataset.type || 'emergencia';
  }
}

/* ── Templates ─────────────────────────────────────────────── */

function _obTemplate(step) {
  return [_obSplash, _obBank, _obInvestments, _obGoal, _obResult][step]?.() || '';
}

/* ─ Step 0: Splash ──────────────────────────────────────────── */
function _obSplash() {
  return '<div class="ob-splash ob-splash-story">' +
    '<div class="ob-logo-block">' +
      '<span class="ob-logo-icon">◈</span>' +
      '<span class="ob-logo-word">Finova</span>' +
    '</div>' +
    '<h1 class="ob-splash-h1">Tu patrimonio real,<br><span class="ob-splash-h1-accent">en 90 segundos.</span></h1>' +
    '<p class="ob-splash-p">Solo tres preguntas. Sin tarjetas.<br>Solo tú ves tus números.</p>' +
    '<div class="ob-feature-chips">' +
      '<div class="ob-feature-chip"><span class="ob-fc-icon">💳</span>Efectivo</div>' +
      '<div class="ob-feature-chip"><span class="ob-fc-icon">📈</span>Inversiones</div>' +
      '<div class="ob-feature-chip"><span class="ob-fc-icon">🎯</span>Objetivo</div>' +
    '</div>' +
    '<button class="ob-btn-cta ob-btn-cta-lg" onclick="obNext()">Empezar →</button>' +
    '<button class="ob-skip-link" onclick="obSkip()">Saltar y explorar primero</button>' +
  '</div>';
}

/* ─ Step 1: Banco ───────────────────────────────────────────── */
function _obBank() {
  const val = _obData.cashTotal || '';
  return '<div class="ob-q-screen">' +
    _obStepHeader(1, false) +
    '<div class="ob-q-icon">💳</div>' +
    '<h2 class="ob-q-title">¿Cuánto tienes<br>en el banco?</h2>' +
    '<p class="ob-q-hint">Suma todas tus cuentas. Solo tú ves este número.</p>' +
    '<div class="ob-big-input-wrap">' +
      '<input id="ob-cash-input" type="number" class="ob-big-input" placeholder="0"' +
        ' aria-label="Total en cuentas bancarias (euros)"' +
        ' value="' + escapeHtml(val) + '" min="0" step="100"' +
        ' oninput="_obLiveTotal(\'ob-cash-input\',\'ob-cash-live\')"' +
        ' onkeydown="if(event.key===\'Enter\'){obNext();}" />' +
      '<span class="ob-big-currency">€</span>' +
    '</div>' +
    '<div class="ob-live-total" id="ob-cash-live">' + (val ? formatCurrency(parseFloat(val) || 0) : '') + '</div>' +
    '<div class="ob-nav-row ob-nav-solo">' +
      '<button class="ob-btn-cta" onclick="obNext()">Continuar →</button>' +
    '</div>' +
    '<p class="ob-micro-hint">Puedes desglosar por cuenta en Ajustes después</p>' +
  '</div>';
}

/* ─ Step 2: Inversiones ─────────────────────────────────────── */
function _obInvestments() {
  const hasInv = _obData.hasInvestments;
  const val    = _obData.invTotal || '';
  const yesAct = hasInv === true  ? ' ob-yn-active' : '';
  const noAct  = hasInv === false ? ' ob-yn-active' : '';
  return '<div class="ob-q-screen">' +
    _obStepHeader(2, true) +
    '<div class="ob-q-icon">📈</div>' +
    '<h2 class="ob-q-title">¿Tienes dinero<br>invertido?</h2>' +
    '<p class="ob-q-hint">Fondos, ETFs, acciones, cripto, pensiones…</p>' +
    '<div class="ob-yn-cards">' +
      '<button class="ob-yn-card' + yesAct + '" onclick="obSetHasInv(true)"><span class="ob-yn-emoji">💰</span>Sí, tengo</button>' +
      '<button class="ob-yn-card' + noAct  + '" onclick="obSetHasInv(false)"><span class="ob-yn-emoji">✦</span>Todavía no</button>' +
    '</div>' +
    '<div id="ob-inv-amount-section" class="ob-inv-amount-section' + (hasInv === true ? '' : ' ob-hidden') + '">' +
      '<p class="ob-q-sub">¿Cuánto en total (aprox.)?</p>' +
      '<div class="ob-big-input-wrap">' +
        '<input id="ob-inv-input" type="number" class="ob-big-input" placeholder="0"' +
          ' aria-label="Total en inversiones (euros)"' +
          ' value="' + escapeHtml(val) + '" min="0" step="100"' +
          ' oninput="_obLiveTotal(\'ob-inv-input\',\'ob-inv-live\')"' +
          ' onkeydown="if(event.key===\'Enter\'){obNext();}" />' +
        '<span class="ob-big-currency">€</span>' +
      '</div>' +
      '<div class="ob-live-total" id="ob-inv-live">' + (val ? formatCurrency(parseFloat(val) || 0) : '') + '</div>' +
    '</div>' +
    '<div class="ob-nav-row ob-nav-solo">' +
      '<button class="ob-btn-cta" id="ob-inv-next" onclick="obNext()"' + (hasInv === null ? ' disabled' : '') + '>Continuar →</button>' +
    '</div>' +
  '</div>';
}

function obSetHasInv(val) {
  _obData.hasInvestments = val;
  document.querySelectorAll('.ob-yn-card').forEach(function(b) { b.classList.remove('ob-yn-active'); });
  const cards = document.querySelectorAll('.ob-yn-card');
  if (val) cards[0].classList.add('ob-yn-active');
  else     cards[1].classList.add('ob-yn-active');
  const section = document.getElementById('ob-inv-amount-section');
  if (section) section.classList.toggle('ob-hidden', !val);
  const nextBtn = document.getElementById('ob-inv-next');
  if (nextBtn) nextBtn.disabled = false;
  if (val) setTimeout(function() { document.getElementById('ob-inv-input')?.focus(); }, 80);
  else     setTimeout(obNext, 340);
}

/* ─ Step 3: Objetivo ────────────────────────────────────────── */
var OB_GOAL_TYPES = [
  { type: 'emergencia', emoji: '🛡',  label: 'Fondo emergencia', placeholder: 'Fondo emergencia', months: 18  },
  { type: 'ahorro',     emoji: '💰',  label: 'Ahorrar más',      placeholder: 'Fondo de ahorro',  months: 12  },
  { type: 'vivienda',   emoji: '🏠',  label: 'Comprar vivienda', placeholder: 'Entrada del piso', months: 36  },
  { type: 'viaje',      emoji: '✈',   label: 'Viaje',            placeholder: 'Viaje a Japón',    months: 8   },
  { type: 'jubilacion', emoji: '🌅',  label: 'Jubilación',       placeholder: 'Jubilación',       months: 240 },
  { type: 'otro',       emoji: '🎯',  label: 'Otro objetivo',    placeholder: 'Mi objetivo',      months: 12  },
];

function _obGoal() {
  const sel = _obData.goalType || 'emergencia';
  const val = _obData.goalTarget || '';

  const pillsHtml = OB_GOAL_TYPES.map(function(g) {
    return '<button class="ob-goal-pill' + (g.type === sel ? ' active' : '') + '" data-type="' + g.type + '"' +
      ' onclick="obSetGoalType(\'' + g.type + '\')">' +
      '<span class="ob-goal-pill-emoji">' + g.emoji + '</span>' +
      '<span>' + g.label + '</span>' +
    '</button>';
  }).join('');

  return '<div class="ob-q-screen">' +
    _obStepHeader(3, true) +
    '<div class="ob-q-icon">🎯</div>' +
    '<h2 class="ob-q-title">¿Cuál es tu<br>objetivo ahora?</h2>' +
    '<div class="ob-goal-pills ob-goal-pills-grid" id="ob-goal-pills">' + pillsHtml + '</div>' +
    '<p class="ob-q-sub">¿Cuánto necesitas acumular?</p>' +
    '<div class="ob-big-input-wrap">' +
      '<input id="ob-goal-target" type="number" class="ob-big-input" placeholder="0"' +
        ' aria-label="Importe objetivo a acumular (euros)"' +
        ' value="' + escapeHtml(val) + '" min="0" step="500"' +
        ' oninput="_obLiveTotal(\'ob-goal-target\',\'ob-goal-live\')"' +
        ' onkeydown="if(event.key===\'Enter\'){obFinish();}" />' +
      '<span class="ob-big-currency">€</span>' +
    '</div>' +
    '<div class="ob-live-total" id="ob-goal-live">' + (val ? formatCurrency(parseFloat(val) || 0) : '') + '</div>' +
    '<div class="ob-nav-row ob-nav-solo">' +
      '<button class="ob-btn-cta" onclick="obFinish()">Ver mi patrimonio →</button>' +
    '</div>' +
  '</div>';
}

/* ─ Step 4: Resultado ───────────────────────────────────────── */
function _obResult() {
  const cash  = parseFloat(_obData.cashTotal) || 0;
  const inv   = _obData.hasInvestments ? (parseFloat(_obData.invTotal) || 0) : 0;
  const total = cash + inv;

  const gt      = OB_GOAL_TYPES.find(function(g) { return g.type === (_obData.goalType || 'emergencia'); }) || OB_GOAL_TYPES[0];
  const goalAmt = parseFloat(_obData.goalTarget) || 0;
  const pct     = goalAmt > 0 ? Math.min(100, Math.round((total / goalAmt) * 100)) : 0;

  const cashRow = cash > 0 ?
    '<div class="ob-res-row">' +
      '<span class="ob-res-label"><span class="ob-res-row-icon">💳</span>Efectivo</span>' +
      '<span class="ob-res-value">' + formatCurrency(cash) + '</span>' +
    '</div>' : '';

  const invRow = inv > 0 ?
    '<div class="ob-res-row">' +
      '<span class="ob-res-label"><span class="ob-res-row-icon">📈</span>Inversiones</span>' +
      '<span class="ob-res-value">' + formatCurrency(inv) + '</span>' +
    '</div>' : '';

  const hasData = cash > 0 || inv > 0;

  const goalRow = goalAmt > 0 ?
    '<div class="ob-res-goal">' +
      '<div class="ob-res-goal-header">' +
        '<span class="ob-res-goal-icon">' + gt.emoji + '</span>' +
        '<div>' +
          '<div class="ob-res-goal-name">' + gt.label + '</div>' +
          '<div class="ob-res-goal-target">' + formatCurrency(goalAmt) + ' objetivo</div>' +
        '</div>' +
        '<span class="ob-res-goal-pct">' + pct + '%</span>' +
      '</div>' +
      '<div class="ob-res-progress-track">' +
        '<div class="ob-res-progress-bar" style="width:' + pct + '%"></div>' +
      '</div>' +
    '</div>' : '';

  return '<div class="ob-result-screen">' +
    '<div class="ob-res-celebrate">' +
      '<div class="ob-res-celebrate-ring">✦</div>' +
      '<p class="ob-res-celebrate-label">¡Ya tienes tu punto de partida!</p>' +
    '</div>' +
    (hasData ?
      '<div class="ob-res-total-hero">' + formatCurrency(total) + '</div>' +
      '<p class="ob-res-total-caption">patrimonio total</p>'
    : '') +
    (hasData ?
      '<div class="ob-res-breakdown">' + cashRow + invRow + '</div>'
    : '<div class="ob-res-zero">Puedes añadir tus datos cuando quieras desde la app.</div>') +
    goalRow +
    '<button class="ob-btn-cta ob-btn-cta-lg" onclick="_obLaunch()">Abrir Finova →</button>' +
  '</div>';
}

/* ── Commit data + launch ──────────────────────────────────── */
function _obLaunch() {
  _obClearPreview();

  const cash = parseFloat(_obData.cashTotal) || 0;
  if (cash > 0) {
    APP.cashAccounts.push({ id: generateId(), name: 'Mi cuenta', amount: cash });
  }

  if (_obData.hasInvestments) {
    const inv = parseFloat(_obData.invTotal) || 0;
    if (inv > 0) {
      APP.portfolio.push({
        id:           generateId(),
        name:         'Mis inversiones',
        ticker:       'INV',
        buyPrice:     inv,
        currentPrice: inv,
        quantity:     1,
        buyDate:      new Date().toISOString().slice(0, 10),
        country:      'ES',
        sector:       'Fondos',
        currency:     'EUR',
        exchangeRate: 1,
      });
    }
  }

  const goalAmt = parseFloat(_obData.goalTarget) || 0;
  if (goalAmt > 0) {
    const gt = OB_GOAL_TYPES.find(function(g) { return g.type === _obData.goalType; }) || OB_GOAL_TYPES[0];
    APP.goals.push({
      id:             generateId(),
      emoji:          gt.emoji,
      name:           gt.placeholder,
      targetAmount:   goalAmt,
      currentAmount:  0,
      deadline:       _obDefaultDeadline(gt.months),
      description:    '',
      linkedCategory: '',
      linkedType:     'expense',
    });
  }

  updateNetworthHistory();
  APP.onboardingDone = true;
  saveData();
  hideOnboarding();
  navigateTo('dashboard');
  showToast('¡Bienvenido/a a Finova! 🎉', 'success');
}

/* ── Helpers ────────────────────────────────────────────────── */
function _obLiveTotal(inputId, liveId) {
  const inp = document.getElementById(inputId);
  const lv  = document.getElementById(liveId);
  if (!inp || !lv) return;
  const n = parseFloat(inp.value) || 0;
  lv.textContent = n > 0 ? formatCurrency(n) : '';
}

function obSetGoalType(type) {
  _obData.goalType = type;
  document.querySelectorAll('.ob-goal-pill').forEach(function(p) {
    p.classList.toggle('active', p.dataset.type === type);
  });
}

function _obDefaultDeadline(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 7);
}

/* ── Skip / Clear preview ──────────────────────────────────── */
function obSkip() {
  _obClearPreview();
  APP.onboardingDone = true;
  saveData();
  hideOnboarding();
  renderDashboard();
}

function _obClearPreview() {
  if (!APP._obPreviewActive) return;
  APP.transactions    = [];
  APP.portfolio       = [];
  APP.cashAccounts    = [];
  APP.goals           = [];
  APP.alternatives    = [];
  APP.properties      = [];
  APP.watchlist       = [];
  APP.dividends       = [];
  APP.budgets         = [];
  APP.sales           = [];
  APP.networthHistory = [];
  APP._obPreviewActive = false;
}

function obFinish() {
  _obSave();
  _obRender(4, 'forward');
}

/* Legacy aliases */
function resetOnboarding() { showOnboarding(); }
function obWelcomeDone() {
  navigateTo('dashboard');
  // Auto-start the guided tour for users who just finished onboarding
  setTimeout(() => {
    if (typeof obStartTour === 'function') obStartTour();
  }, 600);
}

/* ═══════════════════════════════════════════════════════════════
   TOUR GUIADO — recorre todas las secciones de la app
═══════════════════════════════════════════════════════════════ */

var _obTourStep              = 0;
var _obTourHighlighted        = null;
var _obTourContentHighlighted = null;

var OB_TOUR_STEPS = [
  {
    section:    'dashboard',
    navSel:     '.nav-item[data-section="dashboard"]',
    contentSel: '#section-dashboard .kpi-grid',
    icon:       '▤',
    title:      'Dashboard financiero',
    desc:       'Tu centro de mando. De un vistazo ves tu patrimonio neto total, el balance del mes, la evolución histórica de tu riqueza y todos los indicadores que importan. Puedes reordenar y ocultar cada bloque desde Ajustes → Personalizar.',
  },
  {
    section:    'transactions',
    navSel:     '#nav-group-transacciones',
    contentSel: '#section-transactions .section-header',
    icon:       '⇅',
    title:      'Ingresos & Gastos',
    desc:       'Registra y categoriza todos tus movimientos. La barra de entrada rápida entiende lenguaje natural: escribe "Mercadona 47€" y Finova lo añade y categoriza automáticamente. También hay una sección de Bizums para pagos entre amigos.',
  },
  {
    section:    'portfolio',
    navSel:     '#nav-group-inversiones',
    contentSel: '#section-portfolio .highlights-row',
    icon:       '◈',
    title:      'Cartera de inversión',
    desc:       'Sigue tus activos financieros con precios actualizados en tiempo real. Acciones, ETFs, fondos… Consulta la rentabilidad de cada posición, añade activos a tu Watchlist para seguir oportunidades y registra los dividendos que cobras.',
  },
  {
    section:    'networth',
    navSel:     '.nav-item[data-section="networth"]',
    contentSel: '#section-networth .section-header',
    icon:       '◐',
    title:      'Patrimonio Neto',
    desc:       'La foto completa de tu riqueza: efectivo + inversiones + activos alternativos + inmuebles − deudas. Finova registra una instantánea cada mes para que veas si tu patrimonio crece con el tiempo. Incluye gráfico de distribución.',
  },
  {
    section:    'pasivos',
    navSel:     '.nav-item[data-section="pasivos"]',
    contentSel: '#section-pasivos .section-header',
    icon:       '▽',
    title:      'Pasivos y deudas',
    desc:       'Hipoteca, préstamo del coche, tarjeta de crédito… Registra todas tus deudas aquí. Se restan automáticamente de tu patrimonio neto para que siempre veas tu situación real, no solo los activos.',
  },
  {
    section:    'alternatives',
    navSel:     '.nav-item[data-section="alternatives"]',
    contentSel: '#section-alternatives .section-header',
    icon:       '◇',
    title:      'Activos Alternativos',
    desc:       'Relojes de lujo, arte, vino de inversión, coleccionables, cripto en frío… Todo activo con valor que no encaja en las otras categorías. Se suma a tu patrimonio neto igual que el resto.',
  },
  {
    section:    'goals',
    navSel:     '.nav-item[data-section="goals"]',
    contentSel: '#goals-grid',
    icon:       '◎',
    title:      'Objetivos financieros',
    desc:       'Define metas con importe y fecha límite — vivienda, fondo de emergencia, jubilación, viaje. Finova calcula cuánto necesitas ahorrar cada mes para llegar a tiempo y visualiza tu progreso en tiempo real.',
  },
  {
    section:    'simulator',
    navSel:     '.nav-item[data-section="simulator"]',
    contentSel: '#section-simulator .section-header',
    icon:       '§',
    title:      'Simulador de inversión',
    desc:       'Introduce capital inicial, aportación mensual y rentabilidad esperada. El simulador proyecta el crecimiento de tu inversión año a año gracias al interés compuesto. Muy útil para comparar escenarios antes de tomar decisiones.',
  },
  {
    section:    'fiscalidad',
    navSel:     '.nav-item[data-section="fiscalidad"]',
    contentSel: '#section-fiscalidad .section-header',
    icon:       '§',
    title:      'Fiscalidad IRPF',
    desc:       'Calcula tus ganancias y pérdidas patrimoniales para la declaración de la renta. Aplica las compensaciones legales entre plusvalías y minusvalías, y obtén una estimación de tu cuota fiscal antes de presentar la declaración.',
  },
  {
    section:    'ai',
    navSel:     '.nav-item[data-section="ai"]',
    contentSel: '#section-ai .section-header',
    icon:       '✦',
    title:      'Asesor con Inteligencia Artificial',
    desc:       'Haz preguntas sobre tu cartera, pide un análisis de tus hábitos de gasto o busca estrategias de inversión. Compatible con Claude (Anthropic), GPT-4 (OpenAI) y Gemini (Google). Tus datos financieros nunca salen de tu navegador.',
  },
  {
    section:    'settings',
    navSel:     '.sidebar-footer .nav-item[data-section="settings"]',
    contentSel: '#section-settings .section-header',
    icon:       '⚙',
    title:      'Ajustes y personalización',
    desc:       'Configura Finova a tu gusto: reordena y oculta secciones del menú lateral, edita los bloques del Dashboard, gestiona copias de seguridad y elige entre tema oscuro y claro. Todo se guarda localmente en tu dispositivo.',
  },
];

/* ── API pública ────────────────────────────────────────────── */

function obStartTour() {
  var saved = parseInt(localStorage.getItem('finova_tour_step') || '0', 10);
  _obTourStep = (!isNaN(saved) && saved > 0 && saved < OB_TOUR_STEPS.length) ? saved : 0;
  var overlay = document.getElementById('ob-tour-overlay');
  var card    = document.getElementById('ob-tour-card');
  if (!overlay || !card) return;
  overlay.style.display = 'block';
  card.style.display    = 'block';
  requestAnimationFrame(function() {
    overlay.classList.add('ob-tour-visible');
    card.classList.add('ob-tour-visible');
    _obTourRender(_obTourStep);
  });
}

function obTourNext() {
  if (_obTourStep >= OB_TOUR_STEPS.length - 1) { obTourEnd(); return; }
  _obTourRender(_obTourStep + 1);
}

function obTourPrev() {
  if (_obTourStep <= 0) return;
  _obTourRender(_obTourStep - 1);
}

function obTourEnd() {
  localStorage.removeItem('finova_tour_step');
  _obTourClearHighlight();
  var overlay = document.getElementById('ob-tour-overlay');
  var card    = document.getElementById('ob-tour-card');
  if (overlay) {
    overlay.classList.remove('ob-tour-visible');
    setTimeout(function() { overlay.style.display = 'none'; }, 300);
  }
  if (card) {
    card.classList.remove('ob-tour-visible');
    setTimeout(function() { card.style.display = 'none'; }, 300);
  }
  navigateTo('dashboard');
  showToast('¡Tour completado! Ya conoces todo Finova. 🎉', 'success');
}

function obTourSkip() {
  localStorage.setItem('finova_tour_step', String(_obTourStep));
  _obTourClearHighlight();
  var overlay = document.getElementById('ob-tour-overlay');
  var card    = document.getElementById('ob-tour-card');
  if (overlay) {
    overlay.classList.remove('ob-tour-visible');
    setTimeout(function() { overlay.style.display = 'none'; }, 300);
  }
  if (card) {
    card.classList.remove('ob-tour-visible');
    setTimeout(function() { card.style.display = 'none'; }, 300);
  }
  showToast('Tour pausado — retómalo desde Ajustes cuando quieras', 'info');
}

/* ── Renderizado interno ────────────────────────────────────── */

function _obTourRender(step) {
  _obTourStep = step;
  localStorage.setItem('finova_tour_step', String(step));
  var s = OB_TOUR_STEPS[step];
  if (!s) return;

  navigateTo(s.section);
  _obTourClearHighlight();

  var navEl = document.querySelector(s.navSel);
  if (navEl) {
    navEl.classList.add('ob-tour-nav-highlight');
    _obTourHighlighted = navEl;
  }

  if (s.contentSel) {
    var contentEl = document.querySelector(s.contentSel);
    if (contentEl) {
      contentEl.classList.add('ob-tour-content-highlight');
      _obTourContentHighlighted = contentEl;
    }
  }

  var total = OB_TOUR_STEPS.length;

  var dotsEl = document.getElementById('ob-tour-dots');
  if (dotsEl) {
    dotsEl.innerHTML = OB_TOUR_STEPS.map(function(_, i) {
      var cls = i < step ? 'done' : i === step ? 'active' : '';
      return '<span class="ob-tour-dot ' + cls + '"></span>';
    }).join('');
  }

  var labelEl = document.getElementById('ob-tour-step-label');
  if (labelEl) labelEl.textContent = (step + 1) + ' / ' + total;

  var iconEl = document.getElementById('ob-tour-icon');
  if (iconEl) iconEl.textContent = s.icon;

  var titleEl = document.getElementById('ob-tour-title');
  if (titleEl) titleEl.textContent = s.title;

  var descEl = document.getElementById('ob-tour-desc');
  if (descEl) descEl.textContent = s.desc;

  var prevBtn = document.getElementById('ob-tour-prev');
  if (prevBtn) prevBtn.style.visibility = step === 0 ? 'hidden' : 'visible';

  var nextBtn = document.getElementById('ob-tour-next');
  if (nextBtn) nextBtn.textContent = step === total - 1 ? '¡Listo! 🎉' : 'Siguiente →';

  /* Animate card content swap */
  var card = document.getElementById('ob-tour-card');
  if (card) {
    card.style.transition = 'none';
    card.style.opacity = '0.7';
    requestAnimationFrame(function() {
      card.style.transition = 'opacity .18s ease';
      card.style.opacity = '1';
    });
  }

  _obTourPosition();
}

function _obTourClearHighlight() {
  if (_obTourHighlighted) {
    _obTourHighlighted.classList.remove('ob-tour-nav-highlight');
    _obTourHighlighted = null;
  }
  if (_obTourContentHighlighted) {
    _obTourContentHighlighted.classList.remove('ob-tour-content-highlight');
    _obTourContentHighlighted = null;
  }
}

function _obTourPosition() {
  var card = document.getElementById('ob-tour-card');
  if (!card) return;
  if (window.innerWidth <= 768) {
    card.style.left  = '';
    card.style.width = '';
    return;
  }
  var sidebar = document.getElementById('sidebar');
  var sbarW   = sidebar ? sidebar.getBoundingClientRect().width : 248;
  var vw      = window.innerWidth;
  var cardW   = Math.min(420, vw - sbarW - 48);
  var left    = sbarW + Math.max(24, (vw - sbarW - cardW) / 2);
  left = Math.max(sbarW + 16, Math.min(left, vw - cardW - 16));
  card.style.width = cardW + 'px';
  card.style.left  = left + 'px';
}
