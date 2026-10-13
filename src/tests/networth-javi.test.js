/**
 * Finova — networth-javi.test.js
 * Patrimonio completo de "Javi" ejecutando el código REAL (calcs.js +
 * transactions.js para _applyTxCashImpact) con vm.
 * PATRIMONIO NETO ESPERADO: 12.700 + 20.810 − 8.400 = 25.110 €.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const CALCS = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');
const TX    = fs.readFileSync(path.join(process.cwd(), 'src/sections/transactions.js'), 'utf8');

const SANT = 'acc-santander';
const ING  = 'acc-ing';

function javiApp() {
  return {
    cashAccounts: [
      { id: SANT, name: 'Cuenta corriente Santander', amount: 4200 },
      { id: ING,  name: 'Cuenta ahorro ING',          amount: 8500 },
    ],
    // Cartera de la sesión anterior: 20.810 € (valor), 12.290 € (coste)
    portfolio: [
      { id: 'vwrl', name: 'Vanguard FTSE All-World', ticker: 'VWRL', quantity: 45,  buyPrice: 82,  currentPrice: 98,  exchangeRate: 1 },
      { id: 'itx',  name: 'Inditex',                 ticker: 'ITX',  quantity: 100, buyPrice: 38,  currentPrice: 46,  exchangeRate: 1 },
      { id: 'nvda', name: 'NVIDIA',                  ticker: 'NVDA', quantity: 10,  buyPrice: 210, currentPrice: 890, exchangeRate: 1 },
      { id: 'ko',   name: 'Coca-Cola',               ticker: 'KO',   quantity: 50,  buyPrice: 54,  currentPrice: 58,  exchangeRate: 1 },
    ],
    liabilities: [],
    alternatives: [], properties: [], transactions: [], dividends: [],
    watchlist: [], goals: [], bizums: [], recurring: [], trips: [], sales: [],
    networthHistory: [], portfolioSnapshots: [],
    categories: { income: [], expense: [] },
    transactionCashAccountId: null,
  };
}

const COCHE = {
  id: 'liab-coche', name: 'Préstamo coche', type: 'loan',
  originalAmount: 15000, remainingAmount: 8400, monthlyPayment: 280, interestRate: 4.5,
};

let APP, fns;

function load() {
  APP = javiApp();
  const stubs = {
    APP,
    getCurrentMonth: () => '2026-10', getTodayStr: () => '2026-10-13',
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} }, appendChild(){}, append(){} }) },
    formatCurrency: v => `${v}`, formatPct: v => `${v}%`, formatDate: d => d,
    colorClass: v => (v > 0 ? 'positive' : v < 0 ? 'negative' : ''),
    escapeHtml: s => String(s ?? ''), generateId: () => 'id' + Math.random(),
    showToast: () => {}, saveData: () => {}, closeModal: () => {}, openModal: () => {},
    setText: () => {}, _animNum: () => {}, _delegate: () => {}, ric: fn => fn(),
    debounce: fn => fn, emptyRow: () => '', emptyState: () => '',
    renderDashboard: () => {}, renderTransactions: () => {}, markDashboardDirty: () => {},
    softDelete: () => {}, softEdit: () => {}, animateRowRemoval: (r, cb) => cb(),
    Charts: { get: () => null, set: () => {}, destroy: () => {} },
    UNCLASSIFIED_CATEGORY: 'Sin clasificar',
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    _divFxRate: () => 1,
  };
  const ctx = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  vm.runInContext(TX, ctx, { filename: 'transactions.js' });
  fns = vm.runInContext(`({
    calcNetWorth, calcCashTotal, calcPortfolioValue, calcLiabilitiesTotal,
    calcAlternativesTotal, calcAltCurrentValue, calcPropertiesTotal,
    _applyTxCashImpact, _invalidateCalcCache,
  })`, ctx);
  APP = vm.runInContext('APP', ctx);
  return ctx;
}

beforeEach(() => { load(); });

const nw      = () => { fns._invalidateCalcCache(); return fns.calcNetWorth(); };
const sant    = () => APP.cashAccounts.find(a => a.id === SANT);
const ingAcct = () => APP.cashAccounts.find(a => a.id === ING);

/* ── Flujo 1: cuentas de efectivo ─────────────────────────────── */
describe('Flujo 1 — añadir cuentas de efectivo', () => {
  test('solo Santander → efectivo 4.200 €', () => {
    APP.cashAccounts = [{ id: SANT, name: 'Santander', amount: 4200 }];
    expect(fns.calcCashTotal()).toBe(4200);
  });

  test('Santander + ING → efectivo exactamente 12.700 €', () => {
    expect(fns.calcCashTotal()).toBe(12700);
  });

  test('el patrimonio sube con cada cuenta (sin pasivos aún)', () => {
    APP.cashAccounts = [{ id: SANT, name: 'Santander', amount: 4200 }];
    expect(nw()).toBeCloseTo(4200 + 20810, 2);
    APP.cashAccounts.push({ id: ING, name: 'ING', amount: 8500 });
    expect(nw()).toBeCloseTo(12700 + 20810, 2);
  });

  test('un saldo guardado como string no rompe el total', () => {
    APP.cashAccounts[0].amount = '4200';
    expect(fns.calcCashTotal()).toBe(12700);
  });
});

/* ── Flujo 2: vínculo con transacciones (el flujo crítico) ────── */
describe('Flujo 2 — cuenta vinculada a transacciones', () => {
  beforeEach(() => { APP.transactionCashAccountId = SANT; });

  test('A) gasto nuevo de 50 € → Santander 4.200 → 4.150 €', () => {
    const tx = { id: 't1', type: 'expense', amount: 50, date: '2026-10-05', category: 'Ocio', description: 'Cine' };
    APP.transactions.push(tx);
    fns._applyTxCashImpact(tx, 1);
    expect(sant().amount).toBe(4150);
  });

  test('B) editar 50 → 80 € da 4.120 €, NO 4.100 (se revierte lo anterior)', () => {
    const tx = { id: 't1', type: 'expense', amount: 50, date: '2026-10-05', category: 'Ocio', description: 'Cine' };
    APP.transactions.push(tx);
    fns._applyTxCashImpact(tx, 1);
    // Exactamente lo que hace _txSave al editar:
    const oldSnapshot = { ...tx };
    const updated = { ...tx, amount: 80 };
    fns._applyTxCashImpact(oldSnapshot, -1);
    fns._applyTxCashImpact(updated, 1);
    expect(sant().amount).toBe(4120);
  });

  test('C) eliminar ese gasto → vuelve exactamente a 4.200 €', () => {
    const tx = { id: 't1', type: 'expense', amount: 80, date: '2026-10-05', category: 'Ocio', description: 'Cine' };
    APP.transactions.push(tx);
    fns._applyTxCashImpact(tx, 1);
    fns._applyTxCashImpact(tx, -1);
    expect(sant().amount).toBe(4200);
  });

  test('D) alquiler de 750 € → 3.450 €', () => {
    const tx = { id: 'alq', type: 'expense', amount: 750, date: '2026-10-01', category: 'Vivienda', description: 'Alquiler' };
    APP.transactions.push(tx);
    fns._applyTxCashImpact(tx, 1);
    expect(sant().amount).toBe(3450);
  });

  test('E) la fórmula se cumple: saldo = inicial − gastos + ingresos', () => {
    const inicial = 4200;
    const movs = [
      { id: 'm1', type: 'expense', amount: 750 },
      { id: 'm2', type: 'expense', amount: 120 },
      { id: 'm3', type: 'income',  amount: 2267 },
      { id: 'm4', type: 'expense', amount: 60 },
      { id: 'm5', type: 'income',  amount: 72 },
    ];
    movs.forEach(t => { APP.transactions.push(t); fns._applyTxCashImpact(t, 1); });
    const gastos   = movs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const ingresos = movs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    expect(sant().amount).toBeCloseTo(inicial - gastos + ingresos, 10);
    expect(sant().amount).toBeCloseTo(4200 - 930 + 2339, 10);
  });

  test('E) 100 altas y bajas alternas no dejan deriva', () => {
    for (let i = 0; i < 100; i++) {
      const t = { id: 'x' + i, type: i % 2 ? 'income' : 'expense', amount: 33.33 };
      fns._applyTxCashImpact(t, 1);
      fns._applyTxCashImpact(t, -1);
    }
    expect(sant().amount).toBeCloseTo(4200, 8);
  });

  test('un ingreso SUMA al saldo', () => {
    const tx = { id: 'nom', type: 'income', amount: 2267 };
    fns._applyTxCashImpact(tx, 1);
    expect(sant().amount).toBe(6467);
  });

  test('la cuenta NO vinculada (ING) nunca se toca', () => {
    const tx = { id: 't1', type: 'expense', amount: 50 };
    fns._applyTxCashImpact(tx, 1);
    expect(ingAcct().amount).toBe(8500);
  });

  test('sin cuenta vinculada no se mueve ningún saldo', () => {
    APP.transactionCashAccountId = null;
    fns._applyTxCashImpact({ id: 't', type: 'expense', amount: 500 }, 1);
    expect(sant().amount).toBe(4200);
    expect(ingAcct().amount).toBe(8500);
  });

  test('el gasto vinculado reduce el patrimonio neto total', () => {
    const base = nw();
    const tx = { id: 't1', type: 'expense', amount: 50 };
    APP.transactions.push(tx);
    fns._applyTxCashImpact(tx, 1);
    expect(nw()).toBeCloseTo(base - 50, 2);
  });
});

/* ── Flujo 3: distribución ────────────────────────────────────── */
describe('Flujo 3 — distribución del patrimonio', () => {
  test('efectivo 37,9 % y cartera 62,1 % sobre 33.510 € de activos', () => {
    const cash = fns.calcCashTotal(), port = fns.calcPortfolioValue();
    const gross = cash + port;
    expect(gross).toBeCloseTo(33510, 2);
    expect((cash / gross) * 100).toBeCloseTo(37.9, 1);
    expect((port / gross) * 100).toBeCloseTo(62.1, 1);
  });

  test('los dos pesos suman 100 %', () => {
    const gross = fns.calcCashTotal() + fns.calcPortfolioValue();
    expect((fns.calcCashTotal() / gross) * 100 + (fns.calcPortfolioValue() / gross) * 100).toBeCloseTo(100, 6);
  });
});

/* ── Flujos 4 y 6: pasivo y patrimonio neto final ─────────────── */
describe('Flujos 4 y 6 — préstamo coche y PATRIMONIO NETO FINAL', () => {
  beforeEach(() => { APP.liabilities = [{ ...COCHE }]; });

  test('el pasivo resta exactamente 8.400 € del patrimonio', () => {
    const conDeuda = nw();
    APP.liabilities = [];
    expect(nw() - conDeuda).toBeCloseTo(8400, 2);
  });

  test('PATRIMONIO NETO = 25.110 € (12.700 + 20.810 − 8.400)', () => {
    expect(nw()).toBeCloseTo(25110, 2);
  });

  test('deuda total 8.400 € y cuota mensual 280 €', () => {
    expect(fns.calcLiabilitiesTotal()).toBe(8400);
    expect(APP.liabilities.reduce((s, l) => s + (parseFloat(l.monthlyPayment) || 0), 0)).toBe(280);
  });

  test('ratio deuda/activos = 25,1 %', () => {
    const activos = fns.calcCashTotal() + fns.calcPortfolioValue()
                  + fns.calcAlternativesTotal() + fns.calcPropertiesTotal();
    expect(activos).toBeCloseTo(33510, 2);
    expect((fns.calcLiabilitiesTotal() / activos) * 100).toBeCloseTo(25.1, 1);
  });

  test('desglose: efectivo 12.700 + cartera 20.810 − pasivos 8.400', () => {
    expect(fns.calcCashTotal()).toBe(12700);
    expect(fns.calcPortfolioValue()).toBeCloseTo(20810, 2);
    expect(fns.calcLiabilitiesTotal()).toBe(8400);
    expect(fns.calcCashTotal() + fns.calcPortfolioValue() - fns.calcLiabilitiesTotal()).toBeCloseTo(25110, 2);
  });
});

/* ── Flujo 5: barra de amortización ───────────────────────────── */
describe('Flujo 5 — amortización del préstamo', () => {
  // Misma fórmula que renderPasivos (con el clamp ya corregido)
  const paidPct = l => (l.originalAmount > 0
    ? Math.max(0, Math.min(((l.originalAmount - l.remainingAmount) / l.originalAmount) * 100, 100))
    : 0);

  test('pagado 6.600 € de 15.000 € → 44 %', () => {
    expect(COCHE.originalAmount - COCHE.remainingAmount).toBe(6600);
    expect(paidPct(COCHE)).toBeCloseTo(44, 6);
  });

  test('préstamo recién abierto (pendiente = original) → 0 %', () => {
    expect(paidPct({ originalAmount: 15000, remainingAmount: 15000 })).toBe(0);
  });

  test('préstamo liquidado → 100 %', () => {
    expect(paidPct({ originalAmount: 15000, remainingAmount: 0 })).toBe(100);
  });

  test('pendiente MAYOR que el original → 0 %, nunca negativo (regresión)', () => {
    expect(paidPct({ originalAmount: 15000, remainingAmount: 20000 })).toBe(0);
  });

  test('importe original 0 → 0 %, sin división por cero', () => {
    expect(paidPct({ originalAmount: 0, remainingAmount: 0 })).toBe(0);
    expect(Number.isFinite(paidPct({ originalAmount: 0, remainingAmount: 500 }))).toBe(true);
  });
});

/* ── Flujo 7: activos alternativos con depreciación ───────────── */
describe('Flujo 7 — reloj Omega con 5 % de depreciación anual', () => {
  // Timestamp ISO COMPLETO: la depreciación es continua (años fraccionarios,
  // sin escalón en el aniversario), así que truncar a "YYYY-MM-DD" dejaría
  // 2 años "y pico" y el valor saldría unos céntimos por debajo.
  const hace2anos = () => new Date(Date.now() - 2 * 365.25 * 86400000).toISOString();
  const reloj = () => ({ id: 'omega', name: 'Reloj Omega Seamaster', category: 'Relojes',
                         buyPrice: 3500, purchaseDate: hace2anos(), depreciationPct: 5 });

  test('valor actual a los 2 años exactos = 3.500 × 0,95² = 3.158,75 €', () => {
    expect(fns.calcAltCurrentValue(reloj())).toBeCloseTo(3158.75, 2);
  });

  test('la depreciación es continua: a 2 años y medio vale menos que a 2', () => {
    const dosAnos    = fns.calcAltCurrentValue(reloj());
    const dosYMedio  = fns.calcAltCurrentValue({ ...reloj(),
      purchaseDate: new Date(Date.now() - 2.5 * 365.25 * 86400000).toISOString() });
    expect(dosYMedio).toBeLessThan(dosAnos);
    expect(dosYMedio).toBeCloseTo(3500 * Math.pow(0.95, 2.5), 2);
  });

  test('el patrimonio pasa de 25.110 € a 28.268,75 €', () => {
    APP.liabilities = [{ ...COCHE }];
    expect(nw()).toBeCloseTo(25110, 2);
    APP.alternatives.push(reloj());
    expect(nw()).toBeCloseTo(28268.75, 2);
  });

  test('al eliminarlo vuelve a 25.110 € exactos', () => {
    APP.liabilities = [{ ...COCHE }];
    APP.alternatives.push(reloj());
    expect(nw()).toBeCloseTo(28268.75, 2);
    APP.alternatives = [];
    expect(nw()).toBeCloseTo(25110, 2);
  });

  test('sin depreciación usa el precio actual tal cual', () => {
    expect(fns.calcAltCurrentValue({ buyPrice: 3500, currentPrice: 3200 })).toBe(3200);
  });

  test('con depreciación pero sin fecha de compra, cae al precio actual', () => {
    expect(fns.calcAltCurrentValue({ buyPrice: 3500, currentPrice: 3000, depreciationPct: 5 })).toBe(3000);
  });

  test('la depreciación nunca lleva el valor por debajo de 0', () => {
    const viejo = { buyPrice: 3500, depreciationPct: 50, purchaseDate: '2000-01-01' };
    const v = fns.calcAltCurrentValue(viejo);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v)).toBe(true);
  });
});

/* ── Invariante estructural: ningún alta sin ajustar la cuenta ─── */
// El saldo de la cuenta vinculada es un ACUMULADO: no se recalcula nunca, así
// que cualquier camino que cree una transacción sin llamar a
// _applyTxCashImpact deja un desfase permanente e invisible. Fue exactamente
// el bug de la importación CSV/OFX. Este test recorre el fuente y falla si
// aparece un alta nueva sin su ajuste.
describe('Invariante: toda alta de transacción ajusta la cuenta vinculada', () => {
  const SRC_DIR = path.join(process.cwd(), 'src');

  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'tests') walk(p, out); }
      else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  }

  test('todo "transactions.push(" tiene su _applyTxCashImpact cerca', () => {
    const offenders = [];
    for (const file of walk(SRC_DIR)) {
      // bank-connect.js es la excepción documentada: el saldo de una cuenta
      // sincronizada lo fija el propio banco (amount = balance) en cada
      // sincronización, así que aplicar además el impacto lo contaría doble.
      if (file.endsWith('bank-connect.js')) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/transactions\.push\(/.test(line)) return;
        const window = lines.slice(i, i + 16).join('\n');
        if (!/_applyTxCashImpact/.test(window)) {
          offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

/* ── Pruebas destructivas ─────────────────────────────────────── */
describe('Pruebas destructivas', () => {
  test('cambiar el vínculo a ING desvincula Santander (solo una a la vez)', () => {
    APP.transactionCashAccountId = SANT;
    const tx1 = { id: 'a', type: 'expense', amount: 100 };
    fns._applyTxCashImpact(tx1, 1);
    expect(sant().amount).toBe(4100);

    APP.transactionCashAccountId = ING;          // vincular ING
    const tx2 = { id: 'b', type: 'expense', amount: 200 };
    fns._applyTxCashImpact(tx2, 1);
    expect(ingAcct().amount).toBe(8300);
    expect(sant().amount).toBe(4100);            // Santander ya no se mueve
  });

  test('editar el saldo de Santander de 4.200 a 5.000 sube el patrimonio en 800', () => {
    APP.liabilities = [{ ...COCHE }];
    const base = nw();
    sant().amount = 5000;
    expect(nw()).toBeCloseTo(base + 800, 2);
    expect(nw()).toBeCloseTo(25910, 2);
  });

  test('pasivo de 0 € no altera el patrimonio ni da NaN', () => {
    APP.liabilities = [{ id: 'z', name: 'Vacío', type: 'loan', originalAmount: 0, remainingAmount: 0, monthlyPayment: 0 }];
    expect(nw()).toBeCloseTo(33510, 2);
    expect(Number.isFinite(fns.calcLiabilitiesTotal())).toBe(true);
  });

  test('un pasivo con saldo corrupto cuenta 0 en vez de envenenar el total', () => {
    APP.liabilities = [{ id: 'z', name: 'Raro', remainingAmount: 'ocho mil' }];
    expect(fns.calcLiabilitiesTotal()).toBe(0);
    expect(Number.isFinite(nw())).toBe(true);
  });

  test('deuda mayor que los activos → patrimonio neto negativo correcto', () => {
    APP.liabilities = [{ id: 'big', name: 'Hipoteca', remainingAmount: 50000 }];
    expect(nw()).toBeCloseTo(33510 - 50000, 2);
    expect(nw()).toBeLessThan(0);
  });

  test('una cuenta eliminada mientras estaba vinculada no revienta el ajuste', () => {
    APP.transactionCashAccountId = SANT;
    APP.cashAccounts = APP.cashAccounts.filter(a => a.id !== SANT);
    expect(() => fns._applyTxCashImpact({ id: 't', type: 'expense', amount: 10 }, 1)).not.toThrow();
    expect(fns.calcCashTotal()).toBe(8500);
  });
});
