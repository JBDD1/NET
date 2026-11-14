/**
 * Finova — median-surplus.test.js
 * Regresión de F16 (S5-A2): calcAvgMonthlySurplus devuelve la MEDIANA del
 * superávit mensual (robusta a meses atípicos), no la media. Ejecuta el código
 * REAL de calcs.js con vm. Los meses se construyen igual que la función (a
 * partir de new Date()) para que el test sea determinista cualquier día.
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const CALCS = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');

// Clave YYYY-MM del mes `i` hacia atrás desde hoy (igual que calcAvgMonthlySurplus).
function monthKeyBack(i) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function load(transactions) {
  const APP = { transactions };
  const ctx = vm.createContext(Object.assign({}, global, {
    APP, getCurrentMonth: () => monthKeyBack(0),
  }));
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  return vm.runInContext('({ calcAvgMonthlySurplus })', ctx);
}

// Construye un mes con un superávit neto exacto (un ingreso y un gasto).
function monthTxs(i, surplus) {
  const key = monthKeyBack(i);
  return [
    { type: 'income',  date: `${key}-05`, amount: 1000 },
    { type: 'expense', date: `${key}-20`, amount: 1000 - surplus },
  ];
}

describe('F16 — calcAvgMonthlySurplus devuelve la mediana, no la media', () => {
  test('superávits [100, 200, 900] → mediana 200 (la media sería 400)', () => {
    const txs = [...monthTxs(1, 100), ...monthTxs(2, 200), ...monthTxs(3, 900)];
    const fns = load(txs);
    expect(fns.calcAvgMonthlySurplus()).toBe(200);
  });

  test('un mes atípico no arrastra el resultado como lo haría la media', () => {
    // [50, 60, 70, 2000]: media = 545; mediana (par) = (60+70)/2 = 65.
    const txs = [...monthTxs(1, 50), ...monthTxs(2, 60), ...monthTxs(3, 70), ...monthTxs(4, 2000)];
    const fns = load(txs);
    expect(fns.calcAvgMonthlySurplus()).toBe(65);
  });

  test('sin datos devuelve 0', () => {
    expect(load([]).calcAvgMonthlySurplus()).toBe(0);
  });
});
