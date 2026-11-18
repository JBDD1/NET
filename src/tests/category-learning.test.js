/**
 * Finova — category-learning.test.js
 *
 * Categorización que APRENDE de las correcciones del usuario:
 *  · una corrección manual crea una regla aprendida (_patLearn),
 *  · esa regla se aplica a un movimiento futuro con texto parecido, aunque
 *    cambien el número de tarjeta, la fecha o la ciudad del texto crudo,
 *  · la normalización reconoce variantes del mismo comercio,
 *  · entre dos reglas que podrían aplicar al mismo movimiento gana la que
 *    tiene más confirmaciones,
 *  · y la coincidencia es por token completo: nunca confunde comercios
 *    distintos que comparten el principio de la palabra.
 *
 * Carga el código REAL de src/core/script.js (vm + jsdom).
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');

let APP, fns;

function loadScript() {
  APP = {
    transactions: [],
    categoryPatterns: {},
    categories: {
      expense: ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Educación',
                'Ocio', 'Ropa', 'Suscripciones', 'Seguros', 'Restaurantes',
                'Fiesta', 'Amigos', 'Otros gastos', 'Sin clasificar'],
      income: ['Salario', 'Freelance', 'Alquiler', 'Dividendos', 'Venta', 'Otros ingresos', 'Sin clasificar'],
    },
    aiProvider: 'claude',
    claudeApiKey: '', openaiApiKey: '', geminiApiKey: '', groqApiKey: '',
  };
  global.api = { ai: jest.fn(async () => ({ ok: true, json: async () => ({ text: '[]' }) })) };
  global._serverAI = true;

  const context = vm.createContext(Object.assign({}, global, { APP, api: global.api, _serverAI: true }));
  vm.runInContext(SRC, context, { filename: 'script.js' });
  fns = vm.runInContext(
    '({_patLearn,_patWrite,_patCat,_patHits,_patBestMatch,_classifyLocal,txPatternKey,' +
    '_txNormalizeText,_txMerchantTokens,matchLocalKeywords,_computeImportRowStatus,' +
    'UNCLASSIFIED_CATEGORY})',
    context
  );
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { loadScript(); });

describe('una corrección manual del usuario crea una regla aprendida', () => {
  test('_patLearn guarda la asociación texto -> categoría', () => {
    // "KORVANA" no lo reconoce ninguna regla genérica.
    expect(fns._classifyLocal('COMPRA TARJ. 4521** KORVANA 28 MADR', 'expense').category)
      .toBe(fns.UNCLASSIFIED_CATEGORY);

    fns._patLearn('COMPRA TARJ. 4521** KORVANA 28 MADR', 'Alimentación');

    expect(fns._patCat(APP.categoryPatterns['korvana'])).toBe('Alimentación');
    expect(fns._patHits(APP.categoryPatterns['korvana'])).toBe(1);
  });

  test('la regla aprendida tiene prioridad sobre la regla genérica', () => {
    // "mercadona" es palabra clave genérica de Alimentación; si el usuario la
    // corrige a otra categoría, manda su corrección.
    expect(fns._classifyLocal('COMPRA MERCADONA 2481', 'expense').category).toBe('Alimentación');

    fns._patLearn('COMPRA MERCADONA 2481', 'Otros gastos');
    const r = fns._classifyLocal('COMPRA MERCADONA 2481', 'expense');

    expect(r.category).toBe('Otros gastos');
    expect(r.source).toBe('learned');
  });

  test('nunca se aprende "Sin clasificar" como si fuera una corrección', () => {
    fns._patLearn('COMPRA TARJ. 4521** KORVANA 28 MADR', fns.UNCLASSIFIED_CATEGORY);
    expect(Object.keys(APP.categoryPatterns)).toHaveLength(0);
  });

  test('_patWrite tampoco lo acepta por la vía directa', () => {
    fns._patWrite('korvana', fns.UNCLASSIFIED_CATEGORY);
    expect(APP.categoryPatterns['korvana']).toBeUndefined();
  });

  test('cada confirmación incrementa el contador de la regla', () => {
    fns._patLearn('COMPRA KORVANA MADRID', 'Ocio');
    fns._patLearn('COMPRA KORVANA BARCELONA', 'Ocio');
    fns._patLearn('COMPRA KORVANA SEVILLA', 'Ocio');
    expect(fns._patHits(APP.categoryPatterns['korvana'])).toBe(3);
  });
});

describe('la regla aprendida se aplica a un movimiento futuro con texto parecido', () => {
  test('aunque cambien el número de tarjeta, la fecha y la ciudad', () => {
    fns._patLearn('COMPRA TARJ. 4521** KORVANA 28 MADR', 'Alimentación');

    const futuro = 'COMPRA TARJ. 9988** KORVANA 12 BCN';
    const r = fns._classifyLocal(futuro, 'expense');

    expect(r.category).toBe('Alimentación');
    expect(r.source).toBe('learned');
  });

  test('también con un comercio de nombre corto, de una tienda a otra', () => {
    // txPatternKey solo devuelve una palabra suelta con 5+ caracteres, así que
    // un comercio corto se guardaba con clave compuesta ("kora gran") y no se
    // reconocía en otra tienda. _patLearn guarda además el token suelto.
    expect(fns._classifyLocal('PAGO EN KORA CALLAO', 'expense').category).toBe(fns.UNCLASSIFIED_CATEGORY);

    fns._patLearn('PAGO EN KORA GRAN VIA', 'Ocio');

    expect(fns._classifyLocal('PAGO EN KORA CALLAO', 'expense').category).toBe('Ocio');
  });

  test('el aprendizaje sigue siendo por usuario: otro APP no hereda nada', () => {
    fns._patLearn('COMPRA TARJ. 4521** KORVANA 28 MADR', 'Alimentación');

    const otroCtx = loadScript();
    const otroFns = vm.runInContext('({_classifyLocal})', otroCtx);
    expect(otroFns._classifyLocal('COMPRA TARJ. 4521** KORVANA 28 MADR', 'expense').category)
      .toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('una regla que apunta a una categoría borrada no se aplica', () => {
    fns._patLearn('COMPRA KORVANA', 'Ocio');
    APP.categories.expense = APP.categories.expense.filter(c => c !== 'Ocio');
    expect(fns._classifyLocal('COMPRA KORVANA', 'expense').category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });
});

describe('normalización del texto antes de comparar', () => {
  test('quita mayúsculas, acentos, puntuación y asteriscos, y colapsa espacios', () => {
    expect(fns._txNormalizeText('COMPRA TARJ. 4521**  MERCADONA/BILBAO')).toBe('compra tarj 4521 mercadona bilbao');
    expect(fns._txNormalizeText('Nómina  Septiembre')).toBe('nomina septiembre');
  });

  test('los tokens de comercio descartan jerga bancaria y números', () => {
    const tokens = fns._txMerchantTokens('COMPRA TARJ. 4521** KORVANA 28 MADR');
    expect(tokens).toContain('korvana');
    expect(tokens).not.toContain('compra');  // jerga (_TX_STOPWORDS)
    expect(tokens).not.toContain('tarj');    // jerga
    expect(tokens).not.toContain('4521');    // número de tarjeta
  });

  test('variantes del mismo comercio escritas de forma distinta se reconocen igual', () => {
    const variantes = [
      'MERCADONA 2481',
      'Compra Mercadona',
      'COMPRA TARJ. 4521** MERCADONA 28 MADR',
      'mercadona/bilbao',
      'MERCADONA   GRAN  VIA',
    ];
    variantes.forEach(v => {
      expect(fns._txMerchantTokens(v)).toContain('mercadona');
      expect(fns._classifyLocal(v, 'expense').category).toBe('Alimentación');
    });
  });

  test('una corrección sobre una variante se aplica a las demás', () => {
    fns._patLearn('MERCADONA 2481', 'Otros gastos');
    expect(fns._classifyLocal('COMPRA TARJ. 9988** MERCADONA 12 BCN', 'expense').category).toBe('Otros gastos');
  });

  test('la puntuación ya no impide una coincidencia genérica', () => {
    // 'bp ' exige un espacio detrás para no disparar dentro de otra palabra;
    // antes "BP-GASOLINERA" no coincidía porque el guion no era un espacio.
    expect(fns.matchLocalKeywords('BP-GASOLINERA MADRID', 'expense')).toBe('Transporte');
  });

  test('una palabra clave acentuada del propio código funciona', () => {
    // 'covirán' se compara ahora normalizada en los dos lados.
    expect(fns.matchLocalKeywords('COMPRA COVIRAN', 'expense')).toBe('Alimentación');
  });
});

describe('prioridad por historial de confirmaciones', () => {
  // Movimiento en el que DOS reglas podrían aplicar: una por el comercio y
  // otra por otra palabra del texto.
  const MOV = 'COMPRA TARJ. 4521** KORVANA CENTRO 28 MADR';

  test('gana la regla con más confirmaciones', () => {
    fns._patWrite('korvana', 'Alimentación');          // 1 confirmación
    for (let i = 0; i < 4; i++) fns._patWrite('centro', 'Ocio');  // 4 confirmaciones

    const best = fns._patBestMatch(MOV, APP.categories.expense);
    expect(best.key).toBe('centro');
    expect(best.cat).toBe('Ocio');
    expect(fns._classifyLocal(MOV, 'expense').category).toBe('Ocio');
  });

  test('si se invierte el historial, gana la otra', () => {
    for (let i = 0; i < 5; i++) fns._patWrite('korvana', 'Alimentación');
    fns._patWrite('centro', 'Ocio');

    expect(fns._classifyLocal(MOV, 'expense').category).toBe('Alimentación');
  });

  test('a igualdad de confirmaciones gana la clave más específica (la más larga)', () => {
    // Las dos claves candidatas de este movimiento, con una confirmación cada
    // una: gana 'korvana' (7) sobre 'centro' (6), que es la más descriptiva.
    fns._patWrite('korvana', 'Alimentación');
    fns._patWrite('centro', 'Ocio');
    const best = fns._patBestMatch(MOV, APP.categories.expense);
    expect(best.key).toBe('korvana');
    expect(best.cat).toBe('Alimentación');
  });
});

describe('confianza: una regla poco confirmada es sugerencia revisable', () => {
  test('con una sola confirmación la categoría se marca como sugerencia', () => {
    fns._patLearn('COMPRA TARJ. 4521** KORVANA 28 MADR', 'Alimentación');
    const r = fns._classifyLocal('COMPRA TARJ. 9988** KORVANA 12 BCN', 'expense');

    expect(r.category).toBe('Alimentación');
    expect(r.confidence).toBe('medium');
    expect(r.hits).toBe(1);
  });

  test('a la segunda confirmación pasa a confianza alta', () => {
    fns._patLearn('COMPRA KORVANA MADRID', 'Alimentación');
    fns._patLearn('COMPRA KORVANA BARCELONA', 'Alimentación');
    const r = fns._classifyLocal('COMPRA KORVANA SEVILLA', 'expense');

    expect(r.confidence).toBe('high');
    expect(r.hits).toBeGreaterThanOrEqual(2);
  });

  test('la sugerencia poco confirmada llega a la pantalla de revisión', () => {
    // Reutiliza el concepto que ya existía: confianza distinta de 'high' no se
    // da por buena en silencio, se revisa.
    const r = { category: 'Alimentación', categoryConfidence: 'medium', categorySource: 'learned', merchant: 'Korvana', isPossibleDuplicate: false };
    const { status, reasons } = fns._computeImportRowStatus(r);
    expect(status).toBe('review_required');
    // Y el motivo dice que viene de una regla propia, no de la IA.
    expect(reasons.join(' ')).toMatch(/regla tuya/i);
  });

  test('una regla consolidada sí queda lista sin revisión', () => {
    const r = { category: 'Alimentación', categoryConfidence: 'high', categorySource: 'learned', merchant: 'Korvana', isPossibleDuplicate: false };
    expect(fns._computeImportRowStatus(r).status).toBe('ready');
  });
});

describe('conservador: antes no clasificar que clasificar mal', () => {
  test('la coincidencia es por token completo, no por fragmento', () => {
    // Una regla de "mercadona" no debe aplicarse a "Mercado Central".
    fns._patLearn('COMPRA MERCADONA 2481', 'Otros gastos');
    const tokens = fns._txMerchantTokens('COMPRA MERCADO CENTRAL');
    expect(tokens).toContain('mercado');
    expect(tokens).not.toContain('mercadona');
    expect(fns._patBestMatch('COMPRA MERCADO CENTRAL', APP.categories.expense)).toBeNull();
  });

  test('los tokens demasiado cortos no generan reglas sueltas', () => {
    // "DIA" (3 letras) es demasiado corto para una clave propia: se queda con
    // la clave compuesta y no puede disparar sobre cualquier texto.
    expect(fns._txMerchantTokens('COMPRA DIA 123')).not.toContain('dia');
  });

  test('un texto sin ninguna pista sigue quedando sin clasificar', () => {
    const r = fns._classifyLocal('XZQVK 999', 'expense');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
    expect(r.source).toBe('unknown');
    expect(r.confidence).toBe('low');
  });
});
