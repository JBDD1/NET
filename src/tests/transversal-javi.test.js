/**
 * Finova — transversal-javi.test.js
 * Funciones transversales: contexto del Asesor IA, búsqueda global, backup,
 * hitos y atajos. Carga el código REAL con vm.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SCRIPT = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');
const AI     = fs.readFileSync(path.join(process.cwd(), 'src/core/ai.js'), 'utf8');
const CALCS  = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');
const GOALS  = fs.readFileSync(path.join(process.cwd(), 'src/sections/goals.js'), 'utf8');
const TRIPS  = fs.readFileSync(path.join(process.cwd(), 'src/sections/trips.js'), 'utf8');

// Misma sustitución que hace vite.config.js (import.meta es SyntaxError en un
// <script> clásico).
const stripImportMeta = c => c
  .replace(/import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g, '""')
  .replace(/import\.meta\b/g, 'undefined');

function extract(...names) {
  const out = [];
  for (const n of names) {
    const re = new RegExp('(?:^|\\n)(?:const|function)\\s+' + n + '\\b');
    const m = re.exec(SCRIPT);
    if (!m) throw new Error('no encontrado en script.js: ' + n);
    const s = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const rest = SCRIPT.slice(s + 1);
    const nx = /\n(?:const|let|function|\/\* ═)/.exec(rest);
    out.push(SCRIPT.slice(s, nx ? s + 1 + nx.index : SCRIPT.length));
  }
  return out.join('\n');
}

const ING = 'acc-ing';

function javiApp() {
  return {
    cashAccounts: [
      { id: 'acc-santander', name: 'Cuenta corriente Santander', amount: 4200 },
      { id: ING,             name: 'Cuenta ahorro ING',          amount: 8500 },
    ],
    portfolio: [
      { id: 'vwrl', name: 'Vanguard FTSE All-World', ticker: 'VWRL', quantity: 45,  buyPrice: 82,  currentPrice: 98,  exchangeRate: 1, sector: 'ETF' },
      { id: 'itx',  name: 'Inditex',                 ticker: 'ITX',  quantity: 100, buyPrice: 38,  currentPrice: 46,  exchangeRate: 1, sector: 'Consumo' },
      { id: 'nvda', name: 'NVIDIA',                  ticker: 'NVDA', quantity: 10,  buyPrice: 210, currentPrice: 890, exchangeRate: 1, sector: 'Tecnología' },
      { id: 'ko',   name: 'Coca-Cola',               ticker: 'KO',   quantity: 50,  buyPrice: 54,  currentPrice: 58,  exchangeRate: 1, sector: 'Consumo' },
    ],
    liabilities: [{ id: 'coche', name: 'Préstamo coche', originalAmount: 15000, remainingAmount: 8400, monthlyPayment: 280 }],
    alternatives: [{ id: 'omega', name: 'Reloj Omega Seamaster', category: 'Relojes', buyPrice: 3500,
                     purchaseDate: new Date(Date.now() - 2 * 365.25 * 86400000).toISOString(), depreciationPct: 5 }],
    properties: [],
    transactions: [
      { id: 'e1', type: 'expense', date: '2026-10-01', description: 'Alquiler',  category: 'Vivienda',     amount: 750 },
      { id: 'e2', type: 'expense', date: '2026-10-03', description: 'Mercadona', category: 'Alimentación', amount: 120 },
      { id: 'e3', type: 'expense', date: '2026-10-18', description: 'Mercadona', category: 'Alimentación', amount: 95 },
      { id: 'e4', type: 'expense', date: '2026-10-05', description: 'Gasolina',  category: 'Transporte',   amount: 60 },
      { id: 'e5', type: 'expense', date: '2026-10-20', description: 'Gasolina',  category: 'Transporte',   amount: 55 },
      { id: 'e6', type: 'expense', date: '2026-10-08', description: 'Netflix',   category: 'Suscripciones', amount: 13 },
      { id: 'e7', type: 'expense', date: '2026-10-10', description: 'Gym',       category: 'Salud',        amount: 40 },
      { id: 'e8', type: 'expense', date: '2026-10-12', description: 'Restaurante La Taberna', category: 'Restaurantes', amount: 35 },
      { id: 'e9', type: 'expense', date: '2026-10-15', description: 'Farmacia',  category: 'Salud',        amount: 22 },
      { id: 'i1', type: 'income',  date: '2026-10-01', description: 'Nómina',    category: 'Salario',      amount: 2267 },
      { id: 'i2', type: 'income',  date: '2026-10-15', description: 'Dividendo Coca-Cola', category: 'Dividendos', amount: 72 },
    ],
    goals: [
      { id: 'g1', emoji: '🛡️', name: 'Fondo de emergencia', targetAmount: 15000, linkedAccount: ING, contributions: [] },
      { id: 'g2', emoji: '🔥', name: 'FIRE a los 50', targetAmount: 600000, linkedAccount: '__networth__', deadline: '2048-01-01', contributions: [] },
    ],
    trips: [{ id: 'roma', emoji: '🇮🇹', name: 'Roma 2026', destination: 'Roma', budget: 900,
              startDate: '2026-11-15', endDate: '2026-11-22' }],
    bizums: [
      { id: 'b1', person: 'María', date: '2026-10-05', concept: 'cena cumpleaños', direction: 'in', amount: 45, status: 'pending' },
      { id: 'b2', person: 'Pedro', date: '2026-10-11', concept: 'gasolina viaje', direction: 'in', amount: 30, status: 'pending' },
      { id: 'b3', person: 'Luis',  date: '2026-10-14', concept: 'entrada concierto', direction: 'out', amount: 20, status: 'pending' },
    ],
    recurring: [{ id: 'r1', description: 'Netflix', category: 'Suscripciones', type: 'expense', amount: 13, frequency: 'monthly', nextDate: '2026-11-08', active: true }],
    dividends: [{ id: 'd1', assetName: 'Coca-Cola', ticker: 'KO', dividendPerShare: 0.36, shares: 50, frequency: 'quarterly', retentionRate: 19 }],
    watchlist: [{ id: 'w1', name: 'Microsoft', ticker: 'MSFT', currentPrice: 460, targetPrice: 450, alertType: 'above' }],
    trabajo: { salarioBruto: 32000, retencionEmpresa: 4800, seguridadSocial: 2032 },
    minimos: {}, budgets: [{ id: 'bg1', category: 'Alimentación', monthlyAmount: 200 }],
    sales: [], scenarios: [], networthHistory: [], portfolioSnapshots: [],
    categories: { income: ['Salario', 'Dividendos'], expense: ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Suscripciones', 'Restaurantes'] },
    achievedMilestones: [], milestoneDates: {}, categoryPatterns: {},
    transactionCashAccountId: ING, hiddenSections: [], sectionOrder: [],
    dismissedAlerts: {}, customAlerts: [], categoryBudgetType: {},
  };
}

let APP, fns;

function load() {
  APP = javiApp();
  const stubs = {
    APP,
    getCurrentMonth: () => '2026-10', getTodayStr: () => '2026-10-13',
    getFiscalYear: () => 2024,
    _divFxRate: () => 1,
    UNCLASSIFIED_CATEGORY: 'Sin clasificar',
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} }, appendChild(){}, append(){} }),
                addEventListener: () => {} },
    window: { addEventListener: () => {}, location: { hostname: 'localhost' }, matchMedia: () => ({ matches: false }) },
    formatCurrency: v => `${Math.round(v * 100) / 100}`, formatPct: v => `${v}%`, formatDate: d => d,
    colorClass: v => (v > 0 ? 'positive' : v < 0 ? 'negative' : ''),
    escapeHtml: s => String(s ?? ''), generateId: () => 'id' + Math.random(),
    showToast: () => {}, saveData: () => {}, closeModal: () => {}, openModal: () => {},
    setText: () => {}, setHTML: () => {}, _animNum: () => {}, _delegate: () => {}, ric: fn => fn(),
    emptyState: () => '', emptyRow: () => '', softDelete: () => {}, softEdit: () => {},
    renderDashboard: () => {}, markDashboardDirty: () => {}, navigateTo: () => {},
    Charts: { get: () => null, set: () => {}, destroy: () => {} },
    calcAvgMonthlySurplus: () => 0, animateRowRemoval: (r, cb) => cb(),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    _patCat: v => (v && typeof v === 'object' ? v.cat : v),
  };
  const ctx = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  vm.runInContext(GOALS, ctx, { filename: 'goals.js' });
  vm.runInContext(TRIPS, ctx, { filename: 'trips.js' });
  vm.runInContext(extract('searchAll', 'MILESTONES', 'BACKUP_ARRAYS', 'BACKUP_ALLOWED_KEYS', 'validateBackup'),
                  ctx, { filename: 'script-part.js' });
  vm.runInContext(stripImportMeta(AI), ctx, { filename: 'ai.js' });
  fns = vm.runInContext(`({
    searchAll, MILESTONES, BACKUP_ARRAYS, BACKUP_ALLOWED_KEYS, validateBackup,
    buildFinancialContext, buildFinancialSnapshot, _buildFiscalContextLine,
    calcNetWorth, _calcGoalProgress, _invalidateCalcCache,
  })`, ctx);
  APP = vm.runInContext('APP', ctx);
  return ctx;
}

beforeEach(() => { load(); });

/* ── Flujo 1: contexto del Asesor IA ──────────────────────────── */
describe('Flujo 1 — el contexto que recibe el Asesor IA', () => {
  test('PREGUNTA 1 (gastos del mes): el contexto trae 1.190 € y el desglose', () => {
    const ctx = fns.buildFinancialContext();
    expect(ctx).toContain('gastos 1190');
    expect(ctx).toContain('ingresos 2339');
    expect(ctx).toContain('Vivienda:750');       // top categorías
    expect(ctx).toContain('Alimentación:215');
  });

  test('PREGUNTA 2 (activo más rentable): NVDA aparece con su % (regresión)', () => {
    const ctx = fns.buildFinancialContext();
    expect(ctx).toContain('NVDA');
    expect(ctx).toMatch(/NVDA\[[^\]]*\]:\d+\(\+\d+, \+323\.8%\)/);
  });

  test('PREGUNTA 3 (FIRE): objetivo con su progreso real sobre 600.000 €', () => {
    const ctx = fns.buildFinancialContext();
    expect(ctx).toMatch(/FIRE a los 50:[\d.]+\/600000/);
    expect(ctx).toContain('Fondo de emergencia:8500/15000');

    // Sin el reloj Omega, el progreso del objetivo FIRE es exactamente el
    // patrimonio neto de 25.110 €
    APP.alternatives = [];
    fns._invalidateCalcCache();
    expect(fns.buildFinancialContext()).toContain('FIRE a los 50:25110/600000');
  });

  test('PREGUNTA 4 (IRPF): el contexto incluye los datos fiscales (regresión)', () => {
    const ctx = fns.buildFinancialContext();
    expect(ctx).toContain('Fiscal 2024');
    expect(ctx).toContain('salario bruto 32000');
    expect(ctx).toContain('retención 4800');
    expect(ctx).toContain('SS 2032');
  });

  test('el patrimonio del contexto es el NETO (25.110), no los activos brutos', () => {
    const ctx = fns.buildFinancialContext();
    expect(ctx).toContain('Patrimonio: 28268.75'); // 25.110 + reloj 3.158,75
    expect(fns.calcNetWorth()).toBeCloseTo(28268.75, 2);
    expect(ctx).toContain('deuda:−8400');
  });

  test('sin deuda ni datos fiscales el contexto no inventa nada', () => {
    APP.liabilities = [];
    APP.trabajo = {};
    fns._invalidateCalcCache();
    const ctx = fns.buildFinancialContext();
    expect(ctx).not.toContain('deuda');
    expect(ctx).not.toContain('Fiscal');
  });

  test('el snapshot del servidor dice lo mismo que el texto', () => {
    const s = fns.buildFinancialSnapshot();
    expect(s.patrimony).toBeCloseTo(fns.calcNetWorth(), 2);
    expect(s.liabilities).toBe(8400);
    expect(s.salaryGross).toBe(32000);
    expect(s.salaryWithheld).toBe(4800);
    expect(s.monthlyExpenses).toBe(1190);
    expect(s.monthlyIncome).toBe(2339);
    expect(s.portfolio.find(p => p.ticker === 'NVDA').gainPct).toBeCloseTo(323.8, 1);
  });

  test('el contexto nunca incluye fotos de tickets', () => {
    APP.transactions[0].photo = 'data:image/png;base64,AAAA';
    APP.transactions[0].photoId = 'p1';
    const ctx = fns.buildFinancialContext();
    expect(ctx).not.toContain('base64');
    expect(ctx).not.toContain('photoId');
  });
});

/* ── Flujo 8: búsqueda global ─────────────────────────────────── */
describe('Flujo 8 — búsqueda global (Ctrl+K)', () => {
  const titles = q => fns.searchAll(q).map(r => r.title);

  test('"Mercadona" → encuentra las 2 transacciones', () => {
    const r = fns.searchAll('Mercadona');
    expect(r.filter(x => x.type === 'transaction')).toHaveLength(2);
  });

  test('"NVIDIA" → encuentra el activo de cartera', () => {
    const r = fns.searchAll('NVIDIA');
    expect(r.some(x => x.type === 'asset' && x.title === 'NVIDIA')).toBe(true);
  });

  test('"Roma" → encuentra el VIAJE (regresión: antes no se buscaban viajes)', () => {
    const r = fns.searchAll('Roma');
    const trip = r.find(x => x.type === 'trip');
    expect(trip).toBeDefined();
    expect(trip.title).toBe('Roma 2026');
    expect(trip.section).toBe('trips');
  });

  test('"María" → encuentra el bizum', () => {
    expect(fns.searchAll('María').some(x => x.type === 'bizum')).toBe(true);
  });

  test('"emergencia" → encuentra el objetivo CON su progreso real 57 %', () => {
    const g = fns.searchAll('emergencia').find(x => x.type === 'goal');
    expect(g).toBeDefined();
    // antes mostraba 0% porque leía currentAmount en vez del progreso vinculado
    expect(g.sub).toContain('57% completado');
    expect(g.sub).toContain('8500');
  });

  test('"préstamo" → encuentra el PASIVO (regresión: antes no se buscaban)', () => {
    const l = fns.searchAll('préstamo').find(x => x.type === 'liability');
    expect(l).toBeDefined();
    expect(l.section).toBe('pasivos');
  });

  test('"omega" → activo alternativo con su valor DEPRECIADO, no 0', () => {
    const a = fns.searchAll('omega').find(x => x.type === 'alt');
    expect(a).toBeDefined();
    expect(a.sub).toContain('3158.75');
  });

  test('"netflix" → encuentra la transacción y la recurrente', () => {
    const r = fns.searchAll('netflix');
    expect(r.some(x => x.type === 'transaction')).toBe(true);
    expect(r.some(x => x.type === 'recurring')).toBe(true);
  });

  test('"Microsoft" → encuentra la watchlist', () => {
    expect(fns.searchAll('Microsoft').some(x => x.type === 'watchlist')).toBe(true);
  });

  test('todo resultado lleva una sección de destino válida', () => {
    const SECCIONES = ['transactions', 'portfolio', 'watchlist', 'goals', 'alternatives',
                       'bizums', 'trips', 'pasivos', 'networth', 'recurring'];
    ['Mercadona', 'NVIDIA', 'Roma', 'María', 'emergencia', 'préstamo', 'omega', 'netflix']
      .forEach(q => fns.searchAll(q).forEach(r => expect(SECCIONES).toContain(r.section)));
  });

  test('búsqueda sin resultados devuelve lista vacía, no revienta', () => {
    expect(fns.searchAll('zzzzzznoexiste')).toEqual([]);
  });

  test('el resultado está limitado a 12', () => {
    expect(fns.searchAll('a').length).toBeLessThanOrEqual(12);
  });
});

/* ── Flujo 4: backup completo ─────────────────────────────────── */
describe('Flujo 4 — el backup no debe dejarse datos fuera', () => {
  test('contiene las colecciones que pide el guion', () => {
    ['transactions', 'portfolio', 'trips', 'bizums', 'goals'].forEach(k =>
      expect(fns.BACKUP_ARRAYS).toContain(k));
  });

  test('budgets y hiddenSections ya están incluidos (regresión)', () => {
    expect(fns.BACKUP_ARRAYS).toContain('budgets');
    expect(fns.BACKUP_ARRAYS).toContain('customAlerts');
    expect(fns.BACKUP_ARRAYS).toContain('hiddenSections');
  });

  test('transactionCashAccountId se preserva (regresión: su pérdida rompía el vínculo)', () => {
    expect(fns.BACKUP_ALLOWED_KEYS).toContain('transactionCashAccountId');
  });

  test('ninguna clave de APP con datos del usuario queda fuera de la lista blanca', () => {
    const DEBEN_ESTAR = [
      'transactions', 'portfolio', 'watchlist', 'dividends', 'cashAccounts',
      'alternatives', 'goals', 'bizums', 'liabilities', 'properties', 'recurring',
      'trips', 'budgets', 'sales', 'scenarios', 'networthHistory',
      'stakingPositions', 'stakingHistory', 'categories', 'trabajo', 'minimos',
      'categoryBudgetType', 'categoryPatterns', 'transactionCashAccountId',
      'achievedMilestones', 'milestoneDates', 'dashboardLayout', 'sectionOrder',
      'hiddenSections', 'customAlerts', 'userName',
    ];
    const faltan = DEBEN_ESTAR.filter(k => !fns.BACKUP_ALLOWED_KEYS.includes(k));
    expect(faltan).toEqual([]);
  });

  test('restaurar aplica solo claves conocidas y descarta basura ajena', () => {
    const data = { transactions: [], portfolio: [], budgets: [{ id: 'x' }], __proto__hack: 'no' };
    expect(fns.validateBackup(data)).toBe(true);
    const safe = {};
    for (const k of fns.BACKUP_ALLOWED_KEYS) if (k in data) safe[k] = data[k];
    expect(safe.budgets).toHaveLength(1);
    expect('__proto__hack' in safe).toBe(false);
  });

  test('un backup sin las dos colecciones obligatorias se rechaza', () => {
    expect(fns.validateBackup({ portfolio: [] })).toBe(false);
    expect(fns.validateBackup({ transactions: [], portfolio: 'no-array' })).toBe(false);
    expect(fns.validateBackup(null)).toBe(false);
  });

  test('un backup de una versión futura incompatible se rechaza', () => {
    expect(fns.validateBackup({ transactions: [], portfolio: [], _schemaVersion: 99 })).toBe(false);
  });
});

/* ── Flujo 10: hitos de patrimonio ────────────────────────────── */
describe('Flujo 10 — hitos de patrimonio', () => {
  test('existen los umbrales que pide el guion', () => {
    const vals = fns.MILESTONES.map(m => m.value);
    [10000, 25000, 50000, 100000, 250000, 500000, 1000000].forEach(v =>
      expect(vals).toContain(v));
  });

  test('cada hito tiene etiqueta, icono y descripción', () => {
    fns.MILESTONES.forEach(m => {
      expect(typeof m.label).toBe('string');
      expect(m.label.length).toBeGreaterThan(0);
      expect(typeof m.icon).toBe('string');
      expect(typeof m.desc).toBe('string');
    });
  });

  test('con 25.110 € de patrimonio corresponden los hitos hasta 25.000 €', () => {
    const nw = 25110;
    const alcanzados = fns.MILESTONES.filter(m => nw >= m.value).map(m => m.value);
    expect(alcanzados).toEqual([1000, 5000, 10000, 25000]);
  });

  test('un hito ya registrado no se vuelve a disparar', () => {
    const nw = 25110;
    APP.achievedMilestones = [1000, 5000, 10000, 25000];
    const nuevos = fns.MILESTONES.filter(m => nw >= m.value && !APP.achievedMilestones.includes(m.value));
    expect(nuevos).toEqual([]);
  });

  test('los umbrales están en orden ascendente', () => {
    const vals = fns.MILESTONES.map(m => m.value);
    expect([...vals].sort((a, b) => a - b)).toEqual(vals);
  });
});
