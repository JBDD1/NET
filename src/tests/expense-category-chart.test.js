/**
 * Finova — expense-category-chart.test.js
 * Tests de la agregación de gastos por categoría y el filtro de periodo
 * compartidos por el donut interactivo de Transacciones y el widget del
 * Dashboard (transactions.js: expensesByCategory, _expCatInScale,
 * expCatScaleLabel). Carga el código REAL con vm, igual que el resto de
 * la suite, para que estos tests no puedan divergir del comportamiento
 * real de la app.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/sections/transactions.js'), 'utf8');

let APP, fns;

function _todayYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _monthsAgoYM(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function loadScript() {
  APP = { transactions: [] };
  const context = vm.createContext(Object.assign({}, global, {
    APP,
    debounce: fn => fn, // transactions.js llama a debounce() a nivel de módulo
    getCurrentMonth: () => _todayYM(),
  }));
  vm.runInContext(SRC, context, { filename: 'transactions.js' });

  fns = vm.runInContext(
    '({expensesByCategory,_expCatInScale,_expCatScaleCutoff,expCatScaleLabel,EXP_CAT_SCALES})',
    context
  );
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { loadScript(); });

function tx(overrides) {
  return { id: Math.random().toString(36).slice(2), type: 'expense', amount: 10, category: 'Ocio', date: _todayYM() + '-15', ...overrides };
}

describe('expensesByCategory — agregación real usada tanto por el donut como por el detalle', () => {
  test('suma solo gastos (type === "expense"), nunca ingresos', () => {
    APP.transactions = [
      tx({ category: 'Vivienda', amount: 100 }),
      { id: 'i1', type: 'income', category: 'Vivienda', amount: 9999, date: _todayYM() + '-01' },
    ];
    const byCat = fns.expensesByCategory('all');
    expect(byCat['Vivienda']).toBe(100);
  });

  test('agrupa por categoría sumando importes', () => {
    APP.transactions = [
      tx({ category: 'Vivienda', amount: 850 }),
      tx({ category: 'Vivienda', amount: 65 }),
      tx({ category: 'Ocio', amount: 30 }),
    ];
    const byCat = fns.expensesByCategory('all');
    expect(byCat['Vivienda']).toBe(915);
    expect(byCat['Ocio']).toBe(30);
  });

  test('con scale "all" no excluye nada por fecha, cualquiera que sea su antigüedad', () => {
    APP.transactions = [
      tx({ category: 'Vivienda', amount: 50, date: '2019-01-15' }),
      tx({ category: 'Vivienda', amount: 50, date: _todayYM() + '-15' }),
    ];
    expect(fns.expensesByCategory('all')['Vivienda']).toBe(100);
  });

  test('con scale "1m" solo incluye el mes actual — no el anterior ni el siguiente', () => {
    APP.transactions = [
      tx({ category: 'Vivienda', amount: 10, date: _monthsAgoYM(1) + '-20' }), // mes anterior
      tx({ category: 'Vivienda', amount: 20, date: _todayYM() + '-01' }),      // mes actual
    ];
    expect(fns.expensesByCategory('1m')['Vivienda']).toBe(20);
  });

  test('con scale "3m" incluye el mes actual y los 2 anteriores, no el tercero', () => {
    APP.transactions = [
      tx({ category: 'Ocio', amount: 1, date: _monthsAgoYM(3) + '-10' }), // fuera de rango
      tx({ category: 'Ocio', amount: 2, date: _monthsAgoYM(2) + '-10' }), // dentro
      tx({ category: 'Ocio', amount: 4, date: _monthsAgoYM(1) + '-10' }), // dentro
      tx({ category: 'Ocio', amount: 8, date: _todayYM() + '-10' }),      // dentro
    ];
    expect(fns.expensesByCategory('3m')['Ocio']).toBe(14);
  });

  test('no inventa categorías — una categoría sin transacciones no aparece en el resultado', () => {
    APP.transactions = [tx({ category: 'Vivienda' })];
    const byCat = fns.expensesByCategory('all');
    expect(byCat['Transporte']).toBeUndefined();
    expect(Object.keys(byCat)).toEqual(['Vivienda']);
  });

  test('sin transacciones, devuelve un objeto vacío (no un estado inventado)', () => {
    APP.transactions = [];
    expect(fns.expensesByCategory('all')).toEqual({});
  });
});

describe('_expCatInScale — filtro de fecha puro, mismo criterio para gráfico y detalle', () => {
  test('"all" acepta cualquier fecha', () => {
    expect(fns._expCatInScale('2000-01-01', 'all')).toBe(true);
  });

  test('"1m" rechaza el mes anterior', () => {
    expect(fns._expCatInScale(_monthsAgoYM(1) + '-28', '1m')).toBe(false);
  });

  test('"1m" acepta el mes actual', () => {
    expect(fns._expCatInScale(_todayYM() + '-01', '1m')).toBe(true);
  });

  test('"1y" acepta hace 11 meses pero no hace 12', () => {
    expect(fns._expCatInScale(_monthsAgoYM(11) + '-01', '1y')).toBe(true);
    expect(fns._expCatInScale(_monthsAgoYM(12) + '-01', '1y')).toBe(false);
  });
});

describe('expCatScaleLabel — coherencia del periodo mostrado en el detalle', () => {
  test('"all" se etiqueta como todo el historial', () => {
    expect(fns.expCatScaleLabel('all')).toBe('Todo el historial');
  });

  test('"1m" se etiqueta con el mes y año actuales, no un mes inventado', () => {
    const label = fns.expCatScaleLabel('1m');
    const now = new Date();
    expect(label.toLowerCase()).toContain(String(now.getFullYear()));
  });

  test('cada escala del selector tiene una etiqueta definida', () => {
    fns.EXP_CAT_SCALES.forEach(scale => {
      expect(typeof fns.expCatScaleLabel(scale)).toBe('string');
      expect(fns.expCatScaleLabel(scale).length).toBeGreaterThan(0);
    });
  });
});
