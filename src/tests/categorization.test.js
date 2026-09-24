/**
 * Finova — categorization.test.js
 * Tests del pipeline de clasificación inteligente de transacciones:
 * reglas aprendidas → palabras clave → IA por lotes → "Sin clasificar".
 *
 * Carga el código REAL de src/core/script.js (vm + los globals de jsdom que
 * ya da el entorno de test por defecto) en vez de reimplementarlo aquí, para
 * que estos tests no puedan divergir en silencio del comportamiento real.
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');

let APP, fns, aiCalls;

function loadScript() {
  APP = {
    transactions:    [],
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

  aiCalls = [];
  // api.ai mockeado — nunca se hace una llamada de red real en estos tests.
  // _serverAI = true simula que el servidor tiene una clave de IA propia
  // disponible (modo habitual en producción), sin necesitar API key de usuario.
  global.api = {
    ai: jest.fn(async (body) => {
      aiCalls.push(body);
      return { ok: true, json: async () => ({ text: global.__aiMockResponse || '[]' }) };
    }),
  };
  global._serverAI = true;
  global.txPatternKey = undefined; // se define dentro del script real

  const context = vm.createContext(Object.assign({}, global, { APP, api: global.api, _serverAI: true }));
  vm.runInContext(SRC, context, { filename: 'script.js' });

  fns = vm.runInContext(
    '({_classifyLocal,_detectTransactionType,_extractMerchant,_batchClassifyWithAI,' +
    '_enrichImportWithAI,_rowsToBankTransactions,_cleanBankDescription,txPatternKey,' +
    'matchLocalKeywords,_patWrite,UNCLASSIFIED_CATEGORY})',
    context
  );
  // APP dentro del contexto vm es una copia distinta del objeto externo — nos
  // quedamos con la referencia real que usan las funciones cargadas.
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { loadScript(); global.__aiMockResponse = '[]'; });

describe('_classifyLocal — reglas locales (sin red)', () => {
  test('1. Mercadona → Alimentación (palabra clave)', () => {
    const r = fns._classifyLocal('Compra Tarj. Mercadona Bilbao', 'expense');
    expect(r.category).toBe('Alimentación');
    expect(r.source).toBe('rule');
    expect(r.confidence).toBe('high');
  });

  test('2. Restaurante → Restaurantes (palabra clave)', () => {
    const r = fns._classifyLocal('Pago restaurante La Toscana', 'expense');
    expect(r.category).toBe('Restaurantes');
  });

  test('3. Netflix → Suscripciones (palabra clave)', () => {
    const r = fns._classifyLocal('Compra Tarj. Netflix.com', 'expense');
    expect(r.category).toBe('Suscripciones');
  });

  test('4. Gasolinera → Transporte (palabra clave)', () => {
    const r = fns._classifyLocal('Compra Tarj. Repsol Gasolinera', 'expense');
    expect(r.category).toBe('Transporte');
  });

  test('5. Alquiler → Vivienda (palabra clave)', () => {
    const r = fns._classifyLocal('Pago alquiler piso', 'expense');
    expect(r.category).toBe('Vivienda');
  });

  test('6. Nómina → Salario, tipo income (palabra clave)', () => {
    const r = fns._classifyLocal('Nomina Empresa SL', 'income');
    expect(r.category).toBe('Salario');
  });

  test('10. Comercio totalmente desconocido → Sin clasificar, no inventa', () => {
    const r = fns._classifyLocal('XZQVK Comercio Inexistente 999', 'expense');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
    expect(r.source).toBe('unknown');
    expect(r.confidence).toBe('low');
  });

  test('11. Corrección manual del usuario se aprende (_patWrite) y se prioriza sobre palabra clave', () => {
    // Antes de aprender nada, "Amazon" no tiene keyword local -> sin clasificar
    const before = fns._classifyLocal('Compra Amazon', 'expense');
    expect(before.category).toBe(fns.UNCLASSIFIED_CATEGORY);

    fns._patWrite(fns.txPatternKey('Compra Amazon'), 'Suscripciones');
    const after = fns._classifyLocal('Compra Amazon', 'expense');
    expect(after.category).toBe('Suscripciones');
    expect(after.source).toBe('learned');
  });

  test('12. Una operación posterior del mismo comercio usa lo aprendido', () => {
    fns._patWrite(fns.txPatternKey('Compra Amazon Prime'), 'Suscripciones');
    const r1 = fns._classifyLocal('Compra Amazon Prime', 'expense');
    const r2 = fns._classifyLocal('Compra Amazon Prime Otra Ciudad', 'expense'); // misma clave de patrón
    expect(r1.category).toBe('Suscripciones');
    expect(r2.category).toBe('Suscripciones');
  });

  test('13. El aprendizaje es por usuario — un APP.categoryPatterns distinto no hereda nada', () => {
    fns._patWrite(fns.txPatternKey('Compra ComercioX'), 'Ocio');
    expect(fns._classifyLocal('Compra ComercioX', 'expense').category).toBe('Ocio');

    // Simula un usuario distinto: su propio APP.categoryPatterns, vacío
    const otherUserCtx = loadScript();
    const otherFns = vm.runInContext('({_classifyLocal, txPatternKey})', otherUserCtx);
    const r = otherFns._classifyLocal('Compra ComercioX', 'expense');
    expect(r.category).not.toBe('Ocio');
    expect(r.category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });
});

describe('_detectTransactionType — informativo, no cambia type', () => {
  test('9. Reembolso se detecta como refund', () => {
    expect(fns._detectTransactionType('Devolucion compra Zara', 'income')).toBe('refund');
  });

  test('8. Compra de acciones se detecta como investment', () => {
    expect(fns._detectTransactionType('Compra de acciones Interactive Brokers', 'expense')).toBe('investment');
  });

  test('7. Traspaso entre cuentas propias se detecta como transfer', () => {
    expect(fns._detectTransactionType('Traspaso entre cuentas propias', 'expense')).toBe('transfer');
  });

  test('un gasto normal conserva su type como transactionType', () => {
    expect(fns._detectTransactionType('Compra Mercadona', 'expense')).toBe('expense');
  });
});

describe('_extractMerchant', () => {
  test('quita jerga bancaria y deja el nombre del comercio', () => {
    expect(fns._extractMerchant('Compra Tarj. Revolut - Dublin')).toBe('Revolut');
    expect(fns._extractMerchant('Transferencia a Javier Baranda')).toBe('Javier Baranda');
  });
});

describe('Importación por lotes con IA (_enrichImportWithAI)', () => {
  test('14. Fallo del proveedor de IA no rompe la importación — filas quedan Sin clasificar', async () => {
    global.api.ai.mockImplementationOnce(async () => { throw new Error('network down'); });
    const txs = [
      { date: '2026-09-01', description: 'Comercio Desconocido A', type: 'expense', category: fns.UNCLASSIFIED_CATEGORY },
    ];
    await expect(fns._enrichImportWithAI(txs)).resolves.toBeDefined();
    expect(txs[0].category).toBe(fns.UNCLASSIFIED_CATEGORY); // no revienta, no inventa
  });

  test('agrupa comercios únicos en una sola llamada por lote (no una por transacción)', async () => {
    global.__aiMockResponse = JSON.stringify(['Alimentación']);
    const txs = Array.from({ length: 50 }, (_, i) => ({
      date: '2026-09-01', description: 'Comercio Repetido XYZ', type: 'expense',
      category: fns.UNCLASSIFIED_CATEGORY,
    }));
    await fns._enrichImportWithAI(txs);
    expect(aiCalls.length).toBe(1); // 50 filas, 1 comercio único -> 1 sola llamada
    expect(txs.every(t => t.category === 'Alimentación')).toBe(true);
    expect(txs.every(t => t.categorySource === 'ai')).toBe(true);
  });

  test('no llama a la IA si no hay filas sin clasificar', async () => {
    const txs = [{ date: '2026-09-01', description: 'X', type: 'expense', category: 'Alimentación' }];
    await fns._enrichImportWithAI(txs);
    expect(aiCalls.length).toBe(0);
  });

  test('respuesta de la IA con categoría inexistente se ignora (no inventa categorías nuevas)', async () => {
    global.__aiMockResponse = JSON.stringify(['Categoria Que No Existe']);
    const txs = [{ date: '2026-09-01', description: 'Comercio Raro', type: 'expense', category: fns.UNCLASSIFIED_CATEGORY }];
    await fns._enrichImportWithAI(txs);
    expect(txs[0].category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });
});

describe('Integración con _rowsToBankTransactions', () => {
  test('categoriza usando el pipeline en vez de un valor por defecto arbitrario', () => {
    const rows = [
      ['Fecha', 'Concepto', 'Importe', 'Divisa', 'Saldo'],
      ['05/09/2026', 'COMPRA TARJ. MERCADONA MADRID', '-45,30', 'EUR', '1000,00'],
      ['06/09/2026', 'COMERCIO TOTALMENTE DESCONOCIDO XYZ', '-10,00', 'EUR', '990,00'],
    ];
    const txs = fns._rowsToBankTransactions(rows);
    expect(txs.length).toBe(2);
    expect(txs[0].category).toBe('Alimentación');
    expect(txs[0].categorySource).toBe('rule');
    expect(txs[1].category).toBe(fns.UNCLASSIFIED_CATEGORY); // no "Vivienda" ni cats[0] por defecto
    expect(txs[1].categorySource).toBe('unknown');
  });
});
