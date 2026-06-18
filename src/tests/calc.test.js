/**
 * Finova — calc.test.js
 * Unit tests for critical calculation functions.
 * Run: npm test  (requires: npm install --save-dev jest @jest/globals)
 *
 * Functions are inlined here since the source files target browser globals.
 * Keep these implementations in sync with src/core/script.js and src/sections/fiscal.js.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';

// ── IRPF brackets (mirrors fiscal.js IRPF_TRAMOS) ─────────────
const IRPF_TRAMOS = [
  { hasta:   6000, tipo: 19 },
  { hasta:  50000, tipo: 21 },
  { hasta: 200000, tipo: 23 },
  { hasta: 300000, tipo: 26 },
  { hasta: Infinity, tipo: 28 },
];

function calcIRPF(base) {
  if (base <= 0) return 0;
  let tax = 0, prev = 0;
  for (const tramo of IRPF_TRAMOS) {
    const chunk = Math.min(base, tramo.hasta) - prev;
    if (chunk <= 0) break;
    tax  += chunk * (tramo.tipo / 100);
    prev  = tramo.hasta;
    if (base <= tramo.hasta) break;
  }
  return tax;
}

// ── APP mock + helpers (mirrors script.js) ────────────────────
let APP;

function resetApp() {
  APP = {
    cashAccounts:  [],
    portfolio:     [],
    alternatives:  [],
    properties:    [],
    liabilities:   [],
    transactions:  [],
    dividends:     [],
    recurring:     [],
  };
}

function assetValue(a) {
  return a.currentPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1);
}

function assetCost(a) {
  return a.buyPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1);
}

function calcCashTotal()        { return APP.cashAccounts.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0); }
function calcPortfolioValue()   { return APP.portfolio.reduce((s, a) => s + assetValue(a), 0); }
function calcAlternativesTotal(){ return APP.alternatives.reduce((s, a) => s + (parseFloat(a.currentPrice) || 0), 0); }
function calcPropertiesTotal()  { return APP.properties.reduce((s, p) => s + (parseFloat(p.currentValue) || 0), 0); }
function calcLiabilitiesTotal() { return APP.liabilities.reduce((s, l) => s + (parseFloat(l.remainingAmount) || 0), 0); }

function calcNetWorth() {
  return calcCashTotal() + calcPortfolioValue() + calcAlternativesTotal() + calcPropertiesTotal() - calcLiabilitiesTotal();
}

function calcPortfolioCAGR() {
  const assets = APP.portfolio.filter(a => a.buyDate && a.buyPrice > 0 && a.currentPrice > 0);
  if (!assets.length) return null;
  const totalCost = assets.reduce((s, a) => s + assetCost(a), 0);
  if (totalCost <= 0) return null;
  const weightedDays = assets.reduce((s, a) => {
    const days = Math.floor((Date.now() - new Date(a.buyDate)) / 86400000);
    return s + days * (assetCost(a) / totalCost);
  }, 0);
  if (weightedDays < 30) return null;
  const years = weightedDays / 365.25;
  const totalValue = assets.reduce((s, a) => s + assetValue(a), 0);
  return (Math.pow(totalValue / totalCost, 1 / years) - 1) * 100;
}

function _advanceRecurringDate(dateStr, frequency) {
  const d = new Date(dateStr);
  const freq = { weekly: [7, 'day'], biweekly: [14, 'day'], monthly: [1, 'month'], quarterly: [3, 'month'], annual: [1, 'year'] }[frequency];
  if (!freq) return dateStr;
  if (freq[1] === 'day')   d.setDate(d.getDate() + freq[0]);
  if (freq[1] === 'month') d.setMonth(d.getMonth() + freq[0]);
  if (freq[1] === 'year')  d.setFullYear(d.getFullYear() + freq[0]);
  return d.toISOString().slice(0, 10);
}

function applyRecurring(id) {
  const r = (APP.recurring || []).find(x => x.id === id);
  if (!r) return { ok: false, reason: 'not_found' };
  const tx = { id: 'tx-mock', type: r.type, date: new Date().toISOString().slice(0, 10), description: r.description, category: r.category, amount: r.amount };
  APP.transactions.push(tx);
  if (r.nextDate) r.nextDate = _advanceRecurringDate(r.nextDate, r.frequency);
  return { ok: true, tx };
}

// ── calcIRPF ──────────────────────────────────────────────────
describe('calcIRPF', () => {
  test('base 0 → 0', () => expect(calcIRPF(0)).toBe(0));
  test('base negativa → 0', () => expect(calcIRPF(-1000)).toBe(0));

  test('primer tramo exacto: 6000 → 1140', () => {
    expect(calcIRPF(6000)).toBeCloseTo(6000 * 0.19);
  });

  test('límite segundo tramo: 50000', () => {
    const expected = 6000 * 0.19 + 44000 * 0.21;
    expect(calcIRPF(50000)).toBeCloseTo(expected);
  });

  test('límite tercer tramo: 200000', () => {
    const expected = 6000 * 0.19 + 44000 * 0.21 + 150000 * 0.23;
    expect(calcIRPF(200000)).toBeCloseTo(expected);
  });

  test('cuarto tramo: 250000', () => {
    const expected = 6000 * 0.19 + 44000 * 0.21 + 150000 * 0.23 + 50000 * 0.26;
    expect(calcIRPF(250000)).toBeCloseTo(expected);
  });

  test('quinto tramo: 350000', () => {
    const expected = 6000 * 0.19 + 44000 * 0.21 + 150000 * 0.23 + 100000 * 0.26 + 50000 * 0.28;
    expect(calcIRPF(350000)).toBeCloseTo(expected);
  });

  test('valor arbitrario 10000 — cálculo incremental correcto', () => {
    const expected = 6000 * 0.19 + 4000 * 0.21;
    expect(calcIRPF(10000)).toBeCloseTo(expected);
  });
});

// ── calcNetWorth ──────────────────────────────────────────────
describe('calcNetWorth', () => {
  beforeEach(resetApp);

  test('estado vacío → 0', () => expect(calcNetWorth()).toBe(0));

  test('solo efectivo', () => {
    APP.cashAccounts = [{ amount: 5000 }];
    expect(calcNetWorth()).toBe(5000);
  });

  test('activos menos pasivos', () => {
    APP.cashAccounts = [{ amount: 10000 }];
    APP.liabilities  = [{ remainingAmount: 3000 }];
    expect(calcNetWorth()).toBe(7000);
  });

  test('patrimonio neto negativo (deuda > activos)', () => {
    APP.cashAccounts = [{ amount: 1000 }];
    APP.liabilities  = [{ remainingAmount: 5000 }];
    expect(calcNetWorth()).toBe(-4000);
  });

  test('inmuebles incluidos', () => {
    APP.properties  = [{ currentValue: 200000 }];
    APP.liabilities = [{ remainingAmount: 150000 }];
    expect(calcNetWorth()).toBe(50000);
  });

  test('cartera + efectivo + pasivos', () => {
    APP.cashAccounts = [{ amount: 2000 }];
    APP.portfolio    = [{ buyPrice: 100, currentPrice: 150, quantity: 10, exchangeRate: 0 }];
    APP.liabilities  = [{ remainingAmount: 500 }];
    expect(calcNetWorth()).toBe(2000 + 1500 - 500);
  });
});

// ── calcPortfolioCAGR ─────────────────────────────────────────
describe('calcPortfolioCAGR', () => {
  beforeEach(resetApp);

  test('cartera vacía → null', () => expect(calcPortfolioCAGR()).toBeNull());

  test('activo sin buyDate → null', () => {
    APP.portfolio = [{ buyPrice: 100, currentPrice: 150, quantity: 1, exchangeRate: 0 }];
    expect(calcPortfolioCAGR()).toBeNull();
  });

  test('activo con buyDate = hoy (< 30 días) → null', () => {
    APP.portfolio = [{ buyDate: new Date().toISOString().slice(0, 10), buyPrice: 100, currentPrice: 150, quantity: 1, exchangeRate: 0 }];
    expect(calcPortfolioCAGR()).toBeNull();
  });

  test('buyPrice 0 → null', () => {
    const buyDate = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    APP.portfolio = [{ buyDate, buyPrice: 0, currentPrice: 200, quantity: 1, exchangeRate: 0 }];
    expect(calcPortfolioCAGR()).toBeNull();
  });

  test('activo a 1 año con +100% → CAGR ≈ 100%', () => {
    const buyDate = new Date(Date.now() - 365.25 * 86400000).toISOString().slice(0, 10);
    APP.portfolio = [{ buyDate, buyPrice: 100, currentPrice: 200, quantity: 1, exchangeRate: 0 }];
    const cagr = calcPortfolioCAGR();
    expect(cagr).not.toBeNull();
    expect(cagr).toBeCloseTo(100, 0);
  });

  test('activo a 2 años sin cambio → CAGR ≈ 0%', () => {
    const buyDate = new Date(Date.now() - 2 * 365.25 * 86400000).toISOString().slice(0, 10);
    APP.portfolio = [{ buyDate, buyPrice: 100, currentPrice: 100, quantity: 1, exchangeRate: 0 }];
    const cagr = calcPortfolioCAGR();
    expect(cagr).not.toBeNull();
    expect(cagr).toBeCloseTo(0, 1);
  });
});

// ── applyRecurring ────────────────────────────────────────────
describe('applyRecurring', () => {
  beforeEach(resetApp);

  test('id inexistente → ok: false', () => {
    expect(applyRecurring('no-existe').ok).toBe(false);
  });

  test('crea transacción con datos del recurrente', () => {
    APP.recurring = [{ id: 'r1', type: 'expense', description: 'Netflix', category: 'Suscripciones', amount: 15.99, nextDate: '2026-05-01', frequency: 'monthly', active: true }];
    const result = applyRecurring('r1');
    expect(result.ok).toBe(true);
    expect(APP.transactions).toHaveLength(1);
    expect(APP.transactions[0].amount).toBe(15.99);
    expect(APP.transactions[0].description).toBe('Netflix');
  });

  test('amount 0 — aún crea la transacción', () => {
    APP.recurring = [{ id: 'r1', type: 'expense', description: 'Test', category: 'Otros', amount: 0, nextDate: '2026-05-01', frequency: 'monthly', active: true }];
    expect(applyRecurring('r1').ok).toBe(true);
  });

  test('avanza nextDate mensual', () => {
    APP.recurring = [{ id: 'r1', type: 'expense', description: 'Alquiler', category: 'Vivienda', amount: 800, nextDate: '2026-05-15', frequency: 'monthly', active: true }];
    applyRecurring('r1');
    expect(APP.recurring[0].nextDate).toBe('2026-06-15');
  });

  test('avanza nextDate semanal', () => {
    APP.recurring = [{ id: 'r1', type: 'expense', description: 'Gym', category: 'Salud', amount: 50, nextDate: '2026-05-01', frequency: 'weekly', active: true }];
    applyRecurring('r1');
    expect(APP.recurring[0].nextDate).toBe('2026-05-08');
  });

  test('avanza nextDate anual', () => {
    APP.recurring = [{ id: 'r1', type: 'income', description: 'Prima', category: 'Salario', amount: 1000, nextDate: '2026-03-15', frequency: 'annual', active: true }];
    applyRecurring('r1');
    expect(APP.recurring[0].nextDate).toBe('2027-03-15');
  });
});

// ── _advanceRecurringDate ─────────────────────────────────────
describe('_advanceRecurringDate', () => {
  test('semanal +7 días', () => expect(_advanceRecurringDate('2026-05-01', 'weekly')).toBe('2026-05-08'));
  test('quincenal +14 días', () => expect(_advanceRecurringDate('2026-05-01', 'biweekly')).toBe('2026-05-15'));
  test('mensual +1 mes', () => expect(_advanceRecurringDate('2026-01-15', 'monthly')).toBe('2026-02-15'));
  test('trimestral +3 meses', () => expect(_advanceRecurringDate('2026-01-01', 'quarterly')).toBe('2026-04-01'));
  test('anual +1 año', () => expect(_advanceRecurringDate('2026-01-01', 'annual')).toBe('2027-01-01'));
  test('fin de mes — desbordamiento natural de JS Date', () => {
    // Jan 31 + 1 month = Feb 31 → Mar 3 (JS Date overflow)
    expect(_advanceRecurringDate('2026-01-31', 'monthly')).toBe('2026-03-03');
  });
  test('frecuencia desconocida → fecha sin cambios', () => {
    expect(_advanceRecurringDate('2026-05-01', 'daily')).toBe('2026-05-01');
  });
});
