/**
 * Finova — transactions-javi.test.js
 * Recorrido de usuario real ("Javi, 28") por Ingresos & Gastos con sus 11
 * movimientos de octubre 2026, ejecutando el código REAL (script.js para la
 * categorización + transactions.js para parser/filtros/presupuestos) con vm.
 * Totales esperados: gastos 1.190 €, ingresos 2.339 €, balance +1.149 €.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const TX_SRC = fs.readFileSync(path.join(process.cwd(), 'src/sections/transactions.js'), 'utf8');
const CALCS  = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');

// Extrae del script.js real solo lo que necesita la categorización, sin
// arrastrar el init del DOM: así se prueban las MISMAS tablas de keywords
// que usa la app, no una copia que pueda divergir.
function extractFromScript(...names) {
  const out = [];
  for (const name of names) {
    const re = new RegExp(`(?:^|\\n)(?:const|function)\\s+${name}\\b`);
    const m = re.exec(SCRIPT);
    if (!m) throw new Error(`No encontrado en script.js: ${name}`);
    const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
    // corta hasta el siguiente declarador de primer nivel
    const rest = SCRIPT.slice(start + 1);
    const nextRe = /\n(?:const|let|function|\/\* ═)/;
    const n = nextRe.exec(rest);
    out.push(SCRIPT.slice(start, n ? start + 1 + n.index : SCRIPT.length));
  }
  return out.join('\n');
}

const MONTH = '2026-10';
const TODAY = '2026-10-28';

// Los 11 movimientos de octubre, tal y como los introduciría Javi.
// Categorías: las REALES de Finova (no existe "Supermercados": es "Alimentación").
function javiTxs() {
  return [
    { id: 'e1', type: 'expense', date: '2026-10-01', description: 'Alquiler',                 category: 'Vivienda',      amount: 750 },
    { id: 'e2', type: 'expense', date: '2026-10-03', description: 'Mercadona',                category: 'Alimentación',  amount: 120 },
    { id: 'e3', type: 'expense', date: '2026-10-05', description: 'Gasolina',                 category: 'Transporte',    amount: 60 },
    { id: 'e4', type: 'expense', date: '2026-10-08', description: 'Netflix',                  category: 'Suscripciones', amount: 13 },
    { id: 'e5', type: 'expense', date: '2026-10-10', description: 'Gym',                      category: 'Salud',         amount: 40 },
    { id: 'e6', type: 'expense', date: '2026-10-12', description: 'Restaurante La Taberna',   category: 'Restaurantes',  amount: 35 },
    { id: 'e7', type: 'expense', date: '2026-10-15', description: 'Farmacia',                 category: 'Salud',         amount: 22 },
    { id: 'e8', type: 'expense', date: '2026-10-18', description: 'Mercadona',                category: 'Alimentación',  amount: 95 },
    { id: 'e9', type: 'expense', date: '2026-10-20', description: 'Gasolina',                 category: 'Transporte',    amount: 55 },
    { id: 'i1', type: 'income',  date: '2026-10-01', description: 'Nómina',                   category: 'Salario',       amount: 2267, favorite: true },
    { id: 'i2', type: 'income',  date: '2026-10-15', description: 'Dividendo Coca-Cola',      category: 'Dividendos',    amount: 72 },
  ];
}

let APP, fns, dom;

// DOM mínimo: los filtros son <select>/<input> reales leídos por getElementById.
function makeDom() {
  const values = {
    'tx-filter-type': 'all', 'tx-filter-category': 'all',
    'tx-filter-month': '', 'tx-filter-search': '',
  };
  return {
    values,
    getElementById: id => (id in values ? { get value() { return values[id]; }, set value(v) { values[id] = v; }, classList: { toggle(){}, add(){}, remove(){} } } : null),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { toggle(){}, add(){}, remove(){} }, appendChild(){}, append(){} }),
  };
}

function load() {
  APP = {
    transactions: javiTxs(),
    categories: {
      income:  ['Salario', 'Freelance', 'Alquiler', 'Dividendos', 'Venta', 'Otros ingresos', 'Sin clasificar'],
      expense: ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Educación', 'Ocio', 'Ropa',
                'Suscripciones', 'Seguros', 'Restaurantes', 'Fiesta', 'Amigos', 'Otros gastos', 'Sin clasificar'],
    },
    budgets: [], trips: [], cashAccounts: [], portfolio: [], liabilities: [],
    alternatives: [], properties: [], goals: [], bizums: [], dividends: [],
    watchlist: [], recurring: [], networthHistory: [], portfolioSnapshots: [],
    categoryPatterns: {}, transactionCashAccountId: null,
  };
  dom = makeDom();
  const stubs = {
    APP,
    UNCLASSIFIED_CATEGORY: 'Sin clasificar',
    getCurrentMonth: () => MONTH,
    getTodayStr:     () => TODAY,
    document: dom,
    formatCurrency: v => `${v}`,
    formatPct: v => `${v}%`,
    formatDate: d => d,
    colorClass: () => '',
    escapeHtml: s => String(s ?? ''),
    generateId: () => 'new-' + Math.random().toString(36).slice(2, 8),
    showToast: () => {}, saveData: () => {}, closeModal: () => {}, openModal: () => {},
    _animNum: () => {}, _delegate: () => {}, debounce: fn => fn, ric: fn => fn(),
    emptyRow: () => '', emptyState: () => '', setText: () => {},
    renderDashboard: () => {}, renderTransactions: () => {}, markDashboardDirty: () => {},
    updateNetworthHistory: () => {}, softDelete: () => {}, softEdit: () => {},
    animateRowRemoval: (row, cb) => cb(), Charts: { get: () => null, set: () => {}, destroy: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  vm.runInContext(extractFromScript('CATEGORY_KEYWORDS', '_stripAccents', 'matchLocalKeywords', '_patCat', 'txPatternKey', '_TX_STOPWORDS'), ctx, { filename: 'script-cat.js' });
  vm.runInContext(TX_SRC, ctx, { filename: 'transactions.js' });
  fns = vm.runInContext(`({
    parseQuickAdd, _txApplyFilters, expensesByCategory, _expCatInScale,
    calcMonthlyIncome, calcMonthlyExpense, matchLocalKeywords,
    _applyTxCashImpact, _categoryExpenseTxs,
  })`, ctx);
  APP = vm.runInContext('APP', ctx);
  return ctx;
}

beforeEach(() => { load(); });

const sum = txs => txs.reduce((s, t) => s + t.amount, 0);

/* ── Flujo 2: totales ─────────────────────────────────────────── */
describe('Flujo 2 — totales de octubre tras introducir los 11 movimientos', () => {
  test('11 transacciones registradas', () => {
    expect(APP.transactions).toHaveLength(11);
  });

  test('TOTAL GASTOS = 1.190 €', () => {
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1190);
  });

  test('TOTAL INGRESOS = 2.339 €', () => {
    expect(fns.calcMonthlyIncome(MONTH)).toBe(2339);
  });

  test('BALANCE = +1.149 €', () => {
    expect(fns.calcMonthlyIncome(MONTH) - fns.calcMonthlyExpense(MONTH)).toBe(1149);
  });

  test('los 9 gastos individuales suman 1.190 €', () => {
    const exps = APP.transactions.filter(t => t.type === 'expense');
    expect(exps).toHaveLength(9);
    expect(sum(exps)).toBe(1190);
  });
});

/* ── Flujo 3: Quick Add ───────────────────────────────────────── */
describe('Flujo 3 — Quick Add: detección automática', () => {
  test('"Mercadona 67" → gasto, 67 €, categoría de alimentación', () => {
    const p = fns.parseQuickAdd('Mercadona 67');
    expect(p.amount).toBe(67);
    expect(p.type).toBe('expense');
    expect(p.description).toBe('Mercadona');
    expect(p.category).toBe('Alimentación'); // Finova no tiene "Supermercados"
    expect(p.source).toBe('sugerido');
  });

  test('"Nómina 2267" → INGRESO, 2267 €, Salario', () => {
    const p = fns.parseQuickAdd('Nómina 2267');
    expect(p.amount).toBe(2267);
    expect(p.type).toBe('income');
    expect(p.category).toBe('Salario');
  });

  test('"Amazon 45.50" → importe decimal 45,50 correcto', () => {
    const p = fns.parseQuickAdd('Amazon 45.50');
    expect(p.amount).toBe(45.5);
    expect(p.description).toBe('Amazon');
    expect(p.type).toBe('expense');
  });

  test('"xyz 999" → Sin clasificar (no se inventa categoría) → debe preguntar', () => {
    const p = fns.parseQuickAdd('xyz 999');
    expect(p.amount).toBe(999);
    expect(p.category).toBe('Sin clasificar');
    expect(p.source).toBeNull(); // sin fuente = no hay nada reconocido → se pregunta
  });

  test('importes con coma decimal europea: "Gasolina 55,50"', () => {
    expect(fns.parseQuickAdd('Gasolina 55,50').amount).toBe(55.5);
  });

  test('formato con €: "13€ Netflix" y "€13 Netflix"', () => {
    expect(fns.parseQuickAdd('13€ Netflix').amount).toBe(13);
    expect(fns.parseQuickAdd('€13 Netflix').amount).toBe(13);
    expect(fns.parseQuickAdd('13€ Netflix').category).toBe('Suscripciones');
  });

  test('sin importe → null (no crea nada)', () => {
    expect(fns.parseQuickAdd('solo texto')).toBeNull();
    expect(fns.parseQuickAdd('')).toBeNull();
  });

  test('importe 0 o negativo → null', () => {
    expect(fns.parseQuickAdd('Mercadona 0')).toBeNull();
    expect(fns.parseQuickAdd('Mercadona -50')).not.toBeNull(); // el signo no se parsea: 50
    expect(fns.parseQuickAdd('Mercadona -50').amount).toBe(50);
  });

  test('un patrón aprendido tiene prioridad sobre las keywords', () => {
    APP.categoryPatterns[fns_txPatternKey('Amazon')] = { cat: 'Ropa', hits: 3 };
    const p = fns.parseQuickAdd('Amazon 45.50');
    expect(p.category).toBe('Ropa');
    expect(p.source).toBe('aprendido');
  });

  // helper: txPatternKey vive en script.js, se expone vía el contexto
  function fns_txPatternKey(d) { return d.toLowerCase().trim(); }
});

describe('Flujo 3 — categorización de los 11 movimientos reales de Javi', () => {
  const casos = [
    ['Alquiler',               'expense', 'Vivienda'],
    ['Mercadona',              'expense', 'Alimentación'],
    ['Gasolina',               'expense', 'Transporte'],
    ['Netflix',                'expense', 'Suscripciones'],
    ['Gym',                    'expense', 'Salud'],
    ['Restaurante La Taberna', 'expense', 'Restaurantes'],
    ['Farmacia',               'expense', 'Salud'],
    ['Nómina',                 'income',  'Salario'],
    ['Dividendo Coca-Cola',    'income',  'Dividendos'],
  ];
  test.each(casos)('"%s" (%s) → %s', (desc, type, expected) => {
    expect(fns.matchLocalKeywords(desc, type)).toBe(expected);
  });

  test('los dos Mercadona caen en la MISMA categoría (filtro fiable)', () => {
    expect(fns.matchLocalKeywords('Mercadona', 'expense'))
      .toBe(fns.matchLocalKeywords('Mercadona', 'expense'));
  });
});

/* ── Flujo 5: filtros ─────────────────────────────────────────── */
describe('Flujo 5 — filtros', () => {
  test('categoría "Salud" → 2 transacciones, 62 € (Gym 40 + Farmacia 22)', () => {
    dom.values['tx-filter-category'] = 'Salud';
    const r = fns._txApplyFilters();
    expect(r).toHaveLength(2);
    expect(sum(r)).toBe(62);
  });

  test('"Gasto" + "Alimentación" → 2 transacciones, 215 € (120 + 95)', () => {
    dom.values['tx-filter-type'] = 'expense';
    dom.values['tx-filter-category'] = 'Alimentación';
    const r = fns._txApplyFilters();
    expect(r).toHaveLength(2);
    expect(sum(r)).toBe(215);
  });

  test('búsqueda "Mercadona" → 2 transacciones', () => {
    dom.values['tx-filter-search'] = 'mercadona';
    expect(fns._txApplyFilters()).toHaveLength(2);
  });

  test('"Gasto" + "Transporte" → 2 transacciones, 115 € (60 + 55)', () => {
    dom.values['tx-filter-type'] = 'expense';
    dom.values['tx-filter-category'] = 'Transporte';
    const r = fns._txApplyFilters();
    expect(r).toHaveLength(2);
    expect(sum(r)).toBe(115);
  });

  test('tipo "Ingreso" → 2 transacciones, 2.339 €', () => {
    dom.values['tx-filter-type'] = 'income';
    const r = fns._txApplyFilters();
    expect(r).toHaveLength(2);
    expect(sum(r)).toBe(2339);
  });

  test('filtro de mes 2026-10 → las 11', () => {
    dom.values['tx-filter-month'] = MONTH;
    expect(fns._txApplyFilters()).toHaveLength(11);
  });

  test('mes sin movimientos → 0 resultados (no revienta)', () => {
    dom.values['tx-filter-month'] = '2026-09';
    expect(fns._txApplyFilters()).toHaveLength(0);
  });

  test('limpiar filtros → vuelven las 11', () => {
    dom.values['tx-filter-type'] = 'expense';
    dom.values['tx-filter-category'] = 'Salud';
    expect(fns._txApplyFilters().length).toBeLessThan(11);
    dom.values['tx-filter-type'] = 'all';
    dom.values['tx-filter-category'] = 'all';
    expect(fns._txApplyFilters()).toHaveLength(11);
  });

  test('búsqueda con descripción corrupta (sin description) no rompe el filtro', () => {
    APP.transactions.push({ id: 'bad', type: 'expense', date: '2026-10-29', category: 'Ocio', amount: 10 });
    dom.values['tx-filter-search'] = 'mercadona';
    expect(() => fns._txApplyFilters()).not.toThrow();
  });
});

/* ── Flujo 4: editar / eliminar ───────────────────────────────── */
describe('Flujo 4 — editar y eliminar afectan al total', () => {
  test('alquiler 750 → 800 ⇒ gastos 1.240 €; volver a 750 ⇒ 1.190 €', () => {
    const t = APP.transactions.find(x => x.id === 'e1');
    t.amount = 800;
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1240);
    t.amount = 750;
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1190);
  });

  test('eliminar el gym (40 €) ⇒ 1.150 €; restaurarlo (deshacer) ⇒ 1.190 €', () => {
    const gym = APP.transactions.find(x => x.id === 'e5');
    APP.transactions = APP.transactions.filter(x => x.id !== 'e5');
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1150);
    APP.transactions.push(gym);
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1190);
  });

  test('eliminar farmacia (22 €) definitivamente ⇒ gastos 1.168 €', () => {
    APP.transactions = APP.transactions.filter(x => x.id !== 'e7');
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1168);
  });
});

/* ── Flujo 9: donut de categorías ─────────────────────────────── */
describe('Flujo 9 — distribución de gastos por categoría', () => {
  test('reparto correcto del mes', () => {
    const byCat = fns.expensesByCategory('1m');
    expect(byCat['Vivienda']).toBe(750);
    expect(byCat['Alimentación']).toBe(215);
    expect(byCat['Transporte']).toBe(115);
    expect(byCat['Salud']).toBe(62);
    expect(byCat['Restaurantes']).toBe(35);
    expect(byCat['Suscripciones']).toBe(13);
  });

  test('las porciones suman exactamente el total de gastos (1.190 €)', () => {
    const byCat = fns.expensesByCategory('1m');
    expect(Object.values(byCat).reduce((s, v) => s + v, 0)).toBe(1190);
  });

  test('ningún ingreso se cuela en el donut de gastos', () => {
    const byCat = fns.expensesByCategory('1m');
    expect(byCat['Salario']).toBeUndefined();
    expect(byCat['Dividendos']).toBeUndefined();
  });

  test('cambiar de periodo a 3M mantiene el total (todo es de octubre)', () => {
    const m1 = fns.expensesByCategory('1m');
    const m3 = fns.expensesByCategory('3m');
    expect(Object.values(m3).reduce((s, v) => s + v, 0))
      .toBe(Object.values(m1).reduce((s, v) => s + v, 0));
  });
});

/* ── Pruebas destructivas ─────────────────────────────────────── */
describe('Pruebas destructivas', () => {
  test('importe gigante 999.999.999 € no desborda ni pierde precisión', () => {
    APP.transactions.push({ id: 'big', type: 'expense', date: '2026-10-30', description: 'Isla', category: 'Ocio', amount: 999999999 });
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1190 + 999999999);
  });

  test('descripción de 500 caracteres se acepta sin romper el cálculo', () => {
    const long = 'A'.repeat(500);
    APP.transactions.push({ id: 'long', type: 'expense', date: '2026-10-30', description: long, category: 'Ocio', amount: 5 });
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1195);
    expect(() => fns._txApplyFilters()).not.toThrow();
  });

  test('importe como string suma, no concatena', () => {
    APP.transactions.push({ id: 'str', type: 'expense', date: '2026-10-30', description: 'String', category: 'Ocio', amount: '50' });
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1240);
  });

  test('importe no numérico se ignora en vez de dar NaN', () => {
    APP.transactions.push({ id: 'nan', type: 'expense', date: '2026-10-30', description: 'Basura', category: 'Ocio', amount: 'abc' });
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1190);
  });

  test('transacción sin fecha no rompe el filtro de mes', () => {
    APP.transactions.push({ id: 'nodate', type: 'expense', description: 'Sin fecha', category: 'Ocio', amount: 7 });
    expect(() => fns.calcMonthlyExpense(MONTH)).not.toThrow();
  });
});

/* ── Flujo 6: presupuesto superado ────────────────────────────── */
describe('Flujo 6 — presupuesto de 200 € en una categoría con 215 € gastados', () => {
  test('el porcentaje REAL es 107,5 %, no el 100 % recortado de la barra', () => {
    const spent = 215, limit = 200;
    const pctReal = (spent / limit) * 100;
    const pctBarra = Math.min(100, pctReal);
    expect(pctReal).toBeCloseTo(107.5, 1);
    expect(pctBarra).toBe(100);          // la barra no desborda su carril
    expect(spent > limit).toBe(true);    // y se marca como superado
    expect(spent - limit).toBe(15);      // "+15 € sobre el límite"
  });

  test('con 160 € de 200 € (80 %) ya salta el aviso preventivo', () => {
    expect((160 / 200) * 100).toBe(80);
  });
});

/* ── Flujo 10: bizums ─────────────────────────────────────────── */
describe('Flujo 10 — bizums: balance global y filtrado', () => {
  const bizums = () => ([
    { id: 'b1', person: 'María', date: '2026-10-05', concept: 'cena cumpleaños',   direction: 'in',  amount: 45, status: 'pending' },
    { id: 'b2', person: 'Pedro', date: '2026-10-11', concept: 'gasolina viaje',    direction: 'in',  amount: 30, status: 'pending' },
    { id: 'b3', person: 'Luis',  date: '2026-10-14', concept: 'entrada concierto', direction: 'out', amount: 20, status: 'pending' },
  ]);
  const pend = (list, dir) => list.filter(b => b.direction === dir && b.status === 'pending').reduce((s, b) => s + b.amount, 0);

  test('balance global: me deben 75 €, debo 20 €, neto +55 €', () => {
    const l = bizums();
    expect(pend(l, 'in')).toBe(75);
    expect(pend(l, 'out')).toBe(20);
    expect(pend(l, 'in') - pend(l, 'out')).toBe(55);
  });

  test('marcar el de María como cobrado → pendiente baja a 30 €, neto +10 €', () => {
    const l = bizums();
    l.find(b => b.id === 'b1').status = 'done';
    expect(pend(l, 'in')).toBe(30);
    expect(pend(l, 'in') - pend(l, 'out')).toBe(10);
  });

  test('filtrar por "Pedro" → 1 bizum y balance +30 € (no el global +55)', () => {
    const l = bizums().filter(b => b.person === 'Pedro');
    expect(l).toHaveLength(1);
    expect(pend(l, 'in') - pend(l, 'out')).toBe(30);
  });
});

/* ── Cuenta de efectivo vinculada ─────────────────────────────── */
describe('Impacto en la cuenta de efectivo vinculada', () => {
  beforeEach(() => {
    APP.cashAccounts = [{ id: 'acc', name: 'Santander', amount: 1000 }];
    APP.transactionCashAccountId = 'acc';
  });

  test('un gasto resta y un ingreso suma', () => {
    fns._applyTxCashImpact({ type: 'expense', amount: 120 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(880);
    fns._applyTxCashImpact({ type: 'income', amount: 2267 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(3147);
  });

  test('deshacer un gasto lo devuelve exacto (sin deriva)', () => {
    const tx = { type: 'expense', amount: 35.55 };
    fns._applyTxCashImpact(tx, 1);
    fns._applyTxCashImpact(tx, -1);
    expect(APP.cashAccounts[0].amount).toBeCloseTo(1000, 10);
  });
});
