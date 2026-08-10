'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — NAVIGATION
   Section routing, scroll restoration, sidebar group toggles,
   and the renderSection() dispatcher.
   Depends on: state.js (APP), utils.js (_lazyLoad, _LAZY_SCRIPTS).
═══════════════════════════════════════════════════════════════ */

const SECTION_TITLES = {
  dashboard:    'Dashboard',
  transactions: 'Ingresos & Gastos',
  portfolio:    'Inversiones — Cartera',
  watchlist:    'Inversiones — Watchlist',
  dividends:    'Inversiones — Dividendos',
  networth:     'Patrimonio Neto',
  pasivos:      'Pasivos & Deudas',
  alternatives: 'Activos Alternativos',
  bizums:       'Bizums',
  goals:        'Objetivos Financieros',
  simulator:    'Simulador',
  fiscalidad:   'Fiscalidad',
  ai:           'Asesor IA',
  settings:     'Ajustes',
  recurring:    'Recurrentes',
};

const INVERSIONES_SUBS   = ['portfolio', 'watchlist', 'dividends'];
const TRANSACCIONES_SUBS = ['transactions', 'bizums', 'recurring'];

const _sectionScroll = {};

function navigateTo(sectionId) {
  _clearConfetti();
  if (APP.activeSection) _sectionScroll[APP.activeSection] = window.scrollY;

  if (document.startViewTransition) {
    document.startViewTransition(() => _execNavigateTo(sectionId)).finished.catch(() => {});
  } else {
    const prev = document.querySelector('.section.active');
    if (prev && prev.id !== `section-${sectionId}`) {
      prev.style.transition = 'opacity .15s ease';
      prev.style.opacity    = '0';
      setTimeout(() => _execNavigateTo(sectionId), 150);
    } else {
      _execNavigateTo(sectionId);
    }
  }
}

function _execNavigateTo(sectionId) {
  document.querySelectorAll('.section').forEach(el => {
    el.classList.remove('active');
    el.style.opacity    = '';
    el.style.transition = '';
  });
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active');
    el.removeAttribute('aria-current');
  });

  const section = document.getElementById(`section-${sectionId}`);
  if (section) section.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (navItem) {
    navItem.classList.add('active');
    navItem.setAttribute('aria-current', 'page');
  }

  if (INVERSIONES_SUBS.includes(sectionId)) {
    const groupHeader = document.getElementById('nav-group-toggle-inversiones');
    const subPanel    = document.getElementById('nav-sub-inversiones');
    if (groupHeader) groupHeader.classList.add('open');
    if (subPanel)    subPanel.classList.add('open');
  }

  if (TRANSACCIONES_SUBS.includes(sectionId)) {
    const groupHeader = document.getElementById('nav-group-toggle-transacciones');
    const subPanel    = document.getElementById('nav-sub-transacciones');
    if (groupHeader) groupHeader.classList.add('open');
    if (subPanel)    subPanel.classList.add('open');
  }

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) {
    titleEl.innerHTML = SECTION_TITLES[sectionId]
      ? SECTION_TITLES[sectionId].replace(' — ', ' — <em>') + (SECTION_TITLES[sectionId].includes(' — ') ? '</em>' : '')
      : sectionId;
    titleEl.style.animation = 'none';
    titleEl.offsetWidth;
    titleEl.style.animation = '';
  }

  APP.activeSection = sectionId;
  document.getElementById('sidebar').classList.remove('mobile-open');

  const _mobileNavSections = ['dashboard', 'transactions', 'portfolio', 'settings'];
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.classList.remove('active'));
  if (_mobileNavSections.includes(sectionId)) {
    document.querySelector(`.mobile-nav-btn[data-section="${sectionId}"]`)?.classList.add('active');
  } else {
    document.getElementById('mobileNavMenuBtn')?.classList.add('active');
  }

  document.querySelectorAll('.mh-tab').forEach(b => b.classList.toggle('active', b.dataset.section === sectionId));
  const mhBottom = document.getElementById('mhBottom');
  if (mhBottom) mhBottom.classList.toggle('hidden', sectionId !== 'dashboard');
  if (window.innerWidth <= 768) updateMobileHeader();

  renderSection(sectionId);

  const savedY = _sectionScroll[sectionId] ?? 0;
  requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: 'instant' }));
}

function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarOverlay')?.classList.remove('active');
}

function toggleTransaccionesGroup() {
  const header = document.getElementById('nav-group-toggle-transacciones');
  const sub    = document.getElementById('nav-sub-transacciones');
  if (!header || !sub) return;
  const isOpen = sub.classList.contains('open');
  header.classList.toggle('open', !isOpen);
  sub.classList.toggle('open', !isOpen);
}

function toggleInversionesGroup() {
  const header = document.getElementById('nav-group-toggle-inversiones');
  const sub    = document.getElementById('nav-sub-inversiones');
  if (!header || !sub) return;
  const isOpen = sub.classList.contains('open');
  header.classList.toggle('open', !isOpen);
  sub.classList.toggle('open', !isOpen);
}

function renderSection(sectionId) {
  switch (sectionId) {
    case 'dashboard':    renderDashboard();    break;
    case 'transactions': renderTransactions(); break;
    case 'portfolio':    renderPortfolio();    break;
    case 'watchlist':    renderWatchlist();    break;
    case 'dividends':    renderDividends();    break;
    case 'networth':     renderNetworth();     break;
    case 'pasivos':      renderPasivos();      break;
    case 'alternatives': renderAlternatives(); break;
    case 'bizums':       renderBizums();       break;
    case 'goals':        renderGoals();        break;
    case 'simulator':
      if (typeof renderSimulator === 'function') { renderSimulator(); }
      else { _lazyLoad(_LAZY_SCRIPTS.simulator).then(() => renderSimulator()).catch(console.error); }
      break;
    case 'fiscalidad':
      if (typeof renderFiscalidad === 'function') { renderFiscalidad(); }
      else { _lazyLoad(_LAZY_SCRIPTS.fiscalidad).then(() => renderFiscalidad()).catch(console.error); }
      break;
    case 'ai':        renderAI(); setTimeout(() => document.getElementById('ai-input')?.focus(), 80); break;
    case 'settings':  renderSettings();  break;
    case 'recurring': renderRecurring(); break;
    case 'admin':     if (typeof renderAdminSection === 'function') renderAdminSection(); break;
  }
  _trackSectionVisit(sectionId);
}

function _trackSectionVisit(section) {
  if (_isDemoMode || !APP.clientId || !_HAS_SERVER) return;
  try {
    fetch('/api/session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clientId: APP.clientId, txCount: APP.transactions?.length || 0, section }),
    }).catch(() => {});
  } catch (_) {}
}
