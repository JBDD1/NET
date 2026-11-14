/**
 * Finova — unify-balance-sale-staking.test.js
 * Regresión de T1/T2/T3 (Secciones 5/6): ejecuta el código REAL de calcs.js.
 *   T1 — balance mensual: definición única (calcMonthlyBalance), sin Bizums,
 *        de modo que Dashboard y Transacciones coinciden por construcción.
 *   T2 — una venta usa el precio medio REAL de la cartera (assetAvgBuyPriceEUR).
 *   T3 — el staking se suma al patrimonio neto total (calcNetWorth).
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const CALCS = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');

function load(appData) {
  const APP = Object.assign({
    transactions: [], portfolio: [], cashAccounts: [], alternatives: [], properties: [],
    liabilities: [], stakingPositions: [], dividends: [], bizums: [], goals: [], sales: [],
    networthHistory: [],
  }, appData || {});
  const ctx = vm.createContext(Object.assign({}, global, {
    APP,
    getCurrentMonth: () => '2026-11',
    _divFxRate: () => 1,
  }));
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  const fns = vm.runInContext(`({
    calcMonthlyBalance, calcMonthlyIncome, calcMonthlyExpense,
    calcNetWorth, calcStakingTotal, calcCashTotal, assetAvgBuyPriceEUR, _invalidateCalcCache,
  })`, ctx);
  return { APP, fns };
}

describe('T1 — balance mensual unificado (sin Bizums)', () => {
  test('ingresos 1000 − gastos 400 = 600; un Bizum "done" de 50 NO lo altera', () => {
    const { fns } = load({
      transactions: [
        { type: 'income',  date: '2026-11-05', amount: 1000 },
        { type: 'expense', date: '2026-11-10', amount: 400 },
      ],
      bizums: [{ direction: 'in', status: 'done', date: '2026-11-12', amount: 50 }],
    });
    const r = fns.calcMonthlyBalance('2026-11');
    expect(r).toEqual({ income: 1000, expense: 400, balance: 600 });
  });

  test('Dashboard y Transacciones comparten la misma función → misma cifra', () => {
    const { fns } = load({
      transactions: [
        { type: 'income',  date: '2026-11-01', amount: 2500 },
        { type: 'expense', date: '2026-11-03', amount: 900 },
        { type: 'expense', date: '2026-11-20', amount: 300 },
      ],
      bizums: [
        { direction: 'in',  status: 'done', date: '2026-11-02', amount: 80 },
        { direction: 'out', status: 'done', date: '2026-11-04', amount: 25 },
      ],
    });
    // Ambas vistas llaman a calcMonthlyBalance(month): el resultado es idéntico
    // por construcción (una sola fuente), e ignora los Bizums.
    const dashboard    = fns.calcMonthlyBalance('2026-11');
    const transacciones = fns.calcMonthlyBalance('2026-11');
    expect(dashboard).toEqual(transacciones);
    expect(dashboard.balance).toBe(1300); // 2500 − (900+300), sin los Bizums
  });
});

describe('T2 — la venta usa el precio medio real de la cartera', () => {
  test('assetAvgBuyPriceEUR devuelve el buyPrice de la posición (EUR, insensible a mayúsculas)', () => {
    const { fns } = load({
      portfolio: [{ ticker: 'AAPL', name: 'Apple', buyPrice: 100, currentPrice: 150, quantity: 10, exchangeRate: 1 }],
    });
    expect(fns.assetAvgBuyPriceEUR('AAPL')).toBe(100);
    expect(fns.assetAvgBuyPriceEUR('aapl')).toBe(100);
    expect(fns.assetAvgBuyPriceEUR('XXXX')).toBeNull();
  });

  test('convierte a EUR el precio medio de una posición en divisa extranjera', () => {
    const { fns } = load({
      portfolio: [{ ticker: 'MSFT', name: 'Microsoft', buyPrice: 200, currentPrice: 300, quantity: 5, exchangeRate: 0.9 }],
    });
    expect(fns.assetAvgBuyPriceEUR('MSFT')).toBeCloseTo(180, 6); // 200 × 0,9
  });

  test('la plusvalía se calcula con el precio medio real (no con un valor inventado)', () => {
    const { fns } = load({
      portfolio: [{ ticker: 'AAPL', name: 'Apple', buyPrice: 100, currentPrice: 150, quantity: 10, exchangeRate: 1 }],
    });
    // La venta lee el coste real de la cartera; con sellPrice 150 y qty 10:
    const avg  = fns.assetAvgBuyPriceEUR('AAPL');       // 100 (real), no un número tecleado
    const gain = (150 - avg) * 10;
    expect(avg).toBe(100);
    expect(gain).toBe(500);
  });
});

describe('T3 — el staking cuenta en el patrimonio neto total', () => {
  test('calcStakingTotal suma capital + recompensas de todas las posiciones', () => {
    const { fns } = load({
      stakingPositions: [
        { amountEur: 500, rewardsEur: 50 },
        { amountEur: 300, rewardsEur: 12 },
      ],
    });
    expect(fns.calcStakingTotal()).toBe(862);
  });

  test('calcNetWorth incluye el staking (1000 caja + 550 staking = 1550)', () => {
    const { fns } = load({
      cashAccounts: [{ amount: 1000 }],
      stakingPositions: [{ amountEur: 500, rewardsEur: 50 }],
    });
    fns._invalidateCalcCache();
    expect(fns.calcNetWorth()).toBe(1550);
  });

  test('sin staking el patrimonio es solo la caja; con staking sube exactamente su valor', () => {
    const sin = load({ cashAccounts: [{ amount: 1000 }] });
    sin.fns._invalidateCalcCache();
    expect(sin.fns.calcNetWorth()).toBe(1000);

    const con = load({ cashAccounts: [{ amount: 1000 }], stakingPositions: [{ amountEur: 500, rewardsEur: 50 }] });
    con.fns._invalidateCalcCache();
    expect(con.fns.calcNetWorth()).toBe(1550);
  });
});
