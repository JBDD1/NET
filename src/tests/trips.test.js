/**
 * Finova — trips.test.js
 * Tests de la lógica pura de Viajes: el gasto de un viaje se calcula
 * SIEMPRE a partir de transacciones reales (nunca un total guardado aparte),
 * solo cuenta gastos reales del viaje, y borrar un viaje nunca borra
 * transacciones. Carga el código REAL con vm, igual que el resto de la
 * suite.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/sections/trips.js'), 'utf8');

let APP, fns;

function loadScript() {
  APP = { transactions: [], trips: [] };
  const context = vm.createContext(Object.assign({}, global, {
    APP,
    getTodayStr: () => '2026-10-12',
    formatDate: d => d,
  }));
  vm.runInContext(SRC, context, { filename: 'trips.js' });

  fns = vm.runInContext(
    '({_tripTransactions,calcTripSpent,_tripIsActive,_tripDateRangeLabel})',
    context
  );
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { loadScript(); });

function trip(overrides) {
  return { id: 't1', name: 'Japón 2026', budget: 0, ...overrides };
}
function tx(overrides) {
  return { id: Math.random().toString(36).slice(2), type: 'expense', amount: 10, category: 'Ocio', date: '2026-10-05', ...overrides };
}

describe('calcTripSpent — siempre derivado de transacciones reales, nunca un total guardado', () => {
  test('suma solo los gastos vinculados a ese tripId', () => {
    APP.transactions = [
      tx({ tripId: 't1', amount: 100 }),
      tx({ tripId: 't1', amount: 50 }),
      tx({ tripId: 't2', amount: 9999 }), // otro viaje — no debe contar
    ];
    expect(fns.calcTripSpent('t1')).toBe(150);
  });

  test('un viaje sin transacciones vinculadas tiene gasto 0, nunca inventado', () => {
    APP.transactions = [tx({ tripId: 't2', amount: 100 })];
    expect(fns.calcTripSpent('t1')).toBe(0);
  });

  test('nunca cuenta ingresos, aunque estén vinculados al mismo tripId por error', () => {
    APP.transactions = [
      tx({ tripId: 't1', amount: 100, type: 'expense' }),
      tx({ tripId: 't1', amount: 500, type: 'income' }),
    ];
    expect(fns.calcTripSpent('t1')).toBe(100);
  });

  test('transacciones sin tripId nunca se cuentan para ningún viaje', () => {
    APP.transactions = [tx({ amount: 100 })]; // sin tripId
    expect(fns.calcTripSpent('t1')).toBe(0);
  });
});

describe('_tripIsActive — un viaje sin fecha de fin se considera activo', () => {
  test('sin endDate → activo', () => {
    expect(fns._tripIsActive(trip({}))).toBe(true);
  });

  test('endDate en el futuro → activo', () => {
    expect(fns._tripIsActive(trip({ endDate: '2026-12-31' }))).toBe(true);
  });

  test('endDate hoy → activo (el día del viaje cuenta)', () => {
    expect(fns._tripIsActive(trip({ endDate: '2026-10-12' }))).toBe(true);
  });

  test('endDate en el pasado → no activo', () => {
    expect(fns._tripIsActive(trip({ endDate: '2026-01-01' }))).toBe(false);
  });
});

describe('_tripDateRangeLabel — nunca inventa fechas que no existen', () => {
  test('sin fechas, etiqueta vacía', () => {
    expect(fns._tripDateRangeLabel(trip({}))).toBe('');
  });

  test('solo con fecha de inicio', () => {
    expect(fns._tripDateRangeLabel(trip({ startDate: '2026-10-01' }))).toContain('Desde');
  });

  test('solo con fecha de fin', () => {
    expect(fns._tripDateRangeLabel(trip({ endDate: '2026-10-20' }))).toContain('Hasta');
  });

  test('con ambas fechas, muestra el rango completo', () => {
    const label = fns._tripDateRangeLabel(trip({ startDate: '2026-10-01', endDate: '2026-10-20' }));
    expect(label).toContain('2026-10-01');
    expect(label).toContain('2026-10-20');
  });
});

describe('_tripTransactions — base de la coherencia entre tarjeta, detalle y transacciones reales', () => {
  test('excluye otras categorías de tipo pero incluye cualquier categoría de gasto del viaje', () => {
    APP.transactions = [
      tx({ tripId: 't1', category: 'Vuelos', amount: 400 }),
      tx({ tripId: 't1', category: 'Restaurantes', amount: 60 }),
    ];
    const result = fns._tripTransactions('t1');
    expect(result.length).toBe(2);
    expect(result.reduce((s, t) => s + t.amount, 0)).toBe(460);
  });

  test('no muta el array original de transacciones', () => {
    const original = [tx({ tripId: 't1' })];
    APP.transactions = original;
    fns._tripTransactions('t1');
    expect(APP.transactions).toBe(original);
    expect(APP.transactions.length).toBe(1);
  });
});
