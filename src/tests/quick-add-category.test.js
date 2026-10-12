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

  fns = vm.runInContext('({parseQuickAdd, UNCLASSIFIED_CATEGORY, _patWrite, _patCat, matchLocalKeywords, _migrateCorruptedQuickAddPatterns})', context);
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

  // "fiesta"/"copas"/"barbacoa" ahora SÍ tienen palabra clave real (ver
  // CATEGORY_KEYWORDS) — antes caían en Sin clasificar porque esas keywords
  // no existían, no por diseño. Confirmar que reconocen la categoría
  // correcta real, no que se queden sin clasificar.
  test('"fiesta 20" → Fiesta (palabra clave real, no el fallback de antes)', () => {
    const r = fns.parseQuickAdd('fiesta 20');
    expect(r.category).toBe('Fiesta');
    expect(r.category).not.toBe('Vivienda');
  });

  test('"copas 20" → Fiesta', () => {
    const r = fns.parseQuickAdd('copas 20');
    expect(r.category).toBe('Fiesta');
    expect(r.category).not.toBe('Vivienda');
  });

  test('"barbacoa 50" → Alimentación', () => {
    const r = fns.parseQuickAdd('barbacoa 50');
    expect(r.category).toBe('Alimentación');
    expect(r.category).not.toBe('Vivienda');
  });

  test('un término genuinamente sin keyword (no "fiesta"/"copas"/"barbacoa") sigue cayendo en Sin clasificar', () => {
    const r = fns.parseQuickAdd('xyzqwerty 15');
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

describe('Reconocimiento ampliado de palabras clave (CATEGORY_KEYWORDS)', () => {
  test.each([
    ['futbol 20', 'Ocio'],
    ['padel 30', 'Ocio'],
    ['tenis 15', 'Ocio'],
    ['baloncesto 10', 'Ocio'],
    ['cumpleaños 40', 'Fiesta'],
    ['boda 300', 'Fiesta'],
    ['taxi 12', 'Transporte'],
    ['bus 2', 'Transporte'],
  ])('"%s" → %s', (input, expected) => {
    expect(fns.parseQuickAdd(input).category).toBe(expected);
  });

  test('términos genuinamente ambiguos como "comida" NO se fuerzan a una categoría — mejor sin clasificar que adivinar', () => {
    // "comida" puede ser supermercado (Alimentación) o comer fuera
    // (Restaurantes) — adivinar cualquiera de las dos sería inventar.
    expect(fns.parseQuickAdd('comida 50').category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });
});

describe('_migrateCorruptedQuickAddPatterns — limpia solo lo que el bug realmente creó', () => {
  test('borra un patrón que apunta a la categoría-fallback (Vivienda) sin ninguna keyword real de respaldo', () => {
    // Palabras sin ninguna keyword real que las respalde — simulan lo que
    // "fiesta"/"copas" eran ANTES de ampliar CATEGORY_KEYWORDS: el bug
    // viejo las habría "aprendido" como Vivienda sin ninguna base real.
    APP.categoryPatterns['xyzqwerty']  = { cat: 'Vivienda', hits: 2 };
    APP.categoryPatterns['zzztestword'] = { cat: 'Vivienda', hits: 1 };
    const changed = fns._migrateCorruptedQuickAddPatterns();
    expect(changed).toBe(true);
    expect(APP.categoryPatterns['xyzqwerty']).toBeUndefined();
    expect(APP.categoryPatterns['zzztestword']).toBeUndefined();
  });

  test('NUNCA borra un patrón legítimo — una clave que sí coincide con una keyword real de Vivienda se conserva', () => {
    APP.categoryPatterns['alquiler'] = { cat: 'Vivienda', hits: 10 };
    fns._migrateCorruptedQuickAddPatterns();
    expect(APP.categoryPatterns['alquiler']).toEqual({ cat: 'Vivienda', hits: 10 });
  });

  test('NUNCA toca patrones de otras categorías, aunque tampoco tengan keyword de respaldo', () => {
    APP.categoryPatterns['mipeluqueria'] = { cat: 'Salud', hits: 1 };
    fns._migrateCorruptedQuickAddPatterns();
    expect(APP.categoryPatterns['mipeluqueria']).toEqual({ cat: 'Salud', hits: 1 });
  });

  test('se ejecuta una sola vez — no vuelve a borrar nada en una segunda pasada aunque haya más Vivienda sin keyword', () => {
    fns._migrateCorruptedQuickAddPatterns(); // primera pasada, marca quickAddPatternsCleaned
    APP.categoryPatterns['portero'] = { cat: 'Vivienda', hits: 1 }; // elegido a mano DESPUÉS del fix — legítimo
    const changedAgain = fns._migrateCorruptedQuickAddPatterns();
    expect(changedAgain).toBe(false);
    expect(APP.categoryPatterns['portero']).toEqual({ cat: 'Vivienda', hits: 1 });
  });

  test('no revienta si no hay patrones guardados', () => {
    APP.categoryPatterns = {};
    expect(() => fns._migrateCorruptedQuickAddPatterns()).not.toThrow();
  });
});
