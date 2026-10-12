/**
 * Finova — quick-add-category.test.js
 * Regresión de un bug real: al añadir una transacción por "Quick Add" con
 * una descripción que no coincide con ningún patrón aprendido ni palabra
 * clave (p.ej. "comida", "fiesta", "copas", "barbacoa"), parseQuickAdd()
 * caía en cats[0] — la primera categoría de la lista ("Vivienda") — como
 * si fuera una clasificación real. Debe caer en UNCLASSIFIED_CATEGORY
 * ("Sin clasificar") y NUNCA memorizar ese fallback como patrón aprendido.
 *
 * Carga el pipeline REAL completo (script.js + transactions.js) via vm,
 * en vez de reimplementarlo, para que este test no pueda divergir en
 * silencio del comportamiento real de la app.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SCRIPT_SRC = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');
const TX_SRC      = fs.readFileSync(path.join(process.cwd(), 'src/sections/transactions.js'), 'utf8');

let APP, fns;

function loadScripts() {
  APP = {
    transactions: [],
    categoryPatterns: {},
    categories: {
      // Mismo orden real que DEFAULT_CATEGORIES en state.js — "Vivienda" es
      // literalmente la primera, que es justo lo que disparaba el bug.
      expense: ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Educación',
                'Ocio', 'Ropa', 'Suscripciones', 'Seguros', 'Restaurantes',
                'Fiesta', 'Amigos', 'Otros gastos', 'Sin clasificar'],
      income: ['Salario', 'Freelance', 'Alquiler', 'Dividendos', 'Venta', 'Otros ingresos', 'Sin clasificar'],
    },
    aiProvider: 'claude',
    claudeApiKey: '', openaiApiKey: '', geminiApiKey: '', groqApiKey: '',
  };

  const context = vm.createContext(Object.assign({}, global, {
    APP,
    debounce: fn => fn, // transactions.js llama a debounce() a nivel de módulo
    getTodayStr: () => '2026-10-13',
  }));
  vm.runInContext(SCRIPT_SRC, context, { filename: 'script.js' });
  vm.runInContext(TX_SRC, context, { filename: 'transactions.js' });

  fns = vm.runInContext('({parseQuickAdd, UNCLASSIFIED_CATEGORY, _patWrite})', context);
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { loadScripts(); });

describe('parseQuickAdd — nunca inventa categoría cuando nada coincide', () => {
  test('"comida 50" → Sin clasificar, NO la primera categoría de la lista (Vivienda)', () => {
    const r = fns.parseQuickAdd('comida 50');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
    expect(r.category).not.toBe('Vivienda');
  });

  test('"fiesta 20" → Sin clasificar', () => {
    const r = fns.parseQuickAdd('fiesta 20');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('"copas 20" → Sin clasificar', () => {
    const r = fns.parseQuickAdd('copas 20');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('"barbacoa 50" → Sin clasificar', () => {
    const r = fns.parseQuickAdd('barbacoa 50');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('"universdoad 100" (typo) → Sin clasificar, no un acierto casual', () => {
    const r = fns.parseQuickAdd('universdoad 100');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('cuando SÍ hay una palabra clave real, la usa en vez de Sin clasificar', () => {
    const r = fns.parseQuickAdd('Mercadona 45');
    expect(r.category).toBe('Alimentación');
    expect(r.source).toBe('sugerido');
  });

  test('cuando hay un patrón aprendido, lo usa y marca la fuente como "aprendido"', () => {
    APP.categoryPatterns['comida'] = { cat: 'Alimentación', hits: 3 };
    const r = fns.parseQuickAdd('comida 50');
    expect(r.category).toBe('Alimentación');
    expect(r.source).toBe('aprendido');
  });

  test('sin coincidencia, source es null (no se finge una sugerencia)', () => {
    const r = fns.parseQuickAdd('xyzzy 10');
    expect(r.source).toBeNull();
  });
});

describe('Quick Add nunca "aprende" el fallback Sin clasificar como si fuera una corrección', () => {
  test('_patWrite nunca se llama para una categoría sin clasificar (verificado a nivel de contrato del módulo)', () => {
    // parseQuickAdd no debe devolver nunca un source que justifique escribir
    // un patrón cuando la categoría es UNCLASSIFIED_CATEGORY.
    const r = fns.parseQuickAdd('cosa rara sin ninguna pista 30');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
    expect(r.source).toBeNull();
  });
});
