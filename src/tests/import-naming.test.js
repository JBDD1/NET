/**
 * Finova — import-naming.test.js
 *
 * Paso OPCIONAL de la pantalla de revisión: para los movimientos que la
 * categorización automática no ha resuelto, el usuario puede escribir un
 * nombre más claro que el texto crudo del banco. Nunca es obligatorio.
 *
 * Lo que se verifica aquí:
 *  · se puede confirmar la importación COMPLETA sin rellenar ningún nombre
 *    («Omitir y continuar» no bloquea nada),
 *  · si el usuario escribe un nombre, se guarda con ese movimiento,
 *  · el nombre refuerza el sistema de reglas por palabra clave que ya existe,
 *    de modo que una importación FUTURA con un texto parecido se beneficia.
 *
 * Carga el código REAL de src/core/script.js (vm + jsdom) en vez de
 * reimplementar la lógica aquí.
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
      expense: ['Vivienda', 'Alimentación', 'Transporte', 'Ocio', 'Otros gastos', 'Sin clasificar'],
      income: ['Salario', 'Dividendos', 'Otros ingresos', 'Sin clasificar'],
    },
    aiProvider: 'claude',
    claudeApiKey: '', openaiApiKey: '', geminiApiKey: '', groqApiKey: '',
  };
  global.api = { ai: jest.fn(async () => ({ ok: true, json: async () => ({ text: '[]' }) })) };
  global._serverAI = true;

  // generateId vive en src/core/utils.js, que no se carga en este contexto.
  let seq = 0;
  const generateId = () => 'tx-' + (++seq);

  const context = vm.createContext(Object.assign({}, global, { APP, api: global.api, _serverAI: true, generateId }));
  vm.runInContext(SRC, context, { filename: 'script.js' });
  fns = vm.runInContext(
    '({_buildImportTx,_importPendingRows,_computeImportRowStatus,_classifyLocal,' +
    '_patWrite,_patCat,txPatternKey,_txSignature,_txDupIndex,_txIsDuplicate,' +
    'UNCLASSIFIED_CATEGORY})',
    context
  );
  APP = vm.runInContext('APP', context);
  return context;
}

// Texto crudo tal y como lo trae un extracto real, ilegible de por sí.
const RAW_DESCONOCIDO = 'COMPRA TARJ. 4521** KORVANA 28 MADR';

/** Fila de importación sin categoría resuelta, como la deja el pipeline. */
const filaSinCategoria = (description, amount, date = '2026-10-05') => ({
  date, description, amount, type: 'expense',
  category: 'Sin clasificar',
  categoryConfidence: 'low', categoryConfidenceScore: 0, categorySource: 'unknown',
  merchant: null,
});

/** Fila que SÍ se ha categorizado automáticamente. */
const filaCategorizada = (description, amount, category, date = '2026-10-06') => ({
  date, description, amount, type: 'expense',
  category, categoryConfidence: 'high', categoryConfidenceScore: 0.85,
  categorySource: 'rule', merchant: 'Comercio',
});

beforeEach(() => { loadScript(); });

describe('la importación se puede confirmar completa sin rellenar ningún nombre', () => {
  test('«Omitir y continuar» importa TODAS las filas, con y sin categoría', () => {
    // _skipNamingAndImport delega en _importPendingRows con todas las filas
    // pendientes; aquí se prueba ese núcleo sin DOM.
    const rows = [
      filaSinCategoria(RAW_DESCONOCIDO, 42.1),
      filaSinCategoria('TRASPASO 0092 **** 7781', 15),
      filaCategorizada('NETFLIX', 13.99, 'Ocio'),
    ];
    const n = fns._importPendingRows(rows);

    expect(n).toBe(3);
    expect(APP.transactions).toHaveLength(3);
  });

  test('las filas sin categoría se guardan con la categoría genérica del proyecto', () => {
    fns._importPendingRows([filaSinCategoria(RAW_DESCONOCIDO, 42.1)]);
    expect(APP.transactions[0].category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('omitir no exige nombre: sin userName la descripción es la del banco', () => {
    fns._importPendingRows([filaSinCategoria(RAW_DESCONOCIDO, 42.1)]);
    expect(APP.transactions[0].description).toBe(RAW_DESCONOCIDO);
    expect(APP.transactions[0].originalDescription).toBeUndefined();
  });

  test('omitir no escribe ninguna regla de categorización', () => {
    // Nada que el usuario no haya confirmado se convierte en regla.
    fns._importPendingRows([filaSinCategoria(RAW_DESCONOCIDO, 42.1)]);
    expect(Object.keys(APP.categoryPatterns)).toHaveLength(0);
  });

  test('una fila sin categoría nunca queda con categoría vacía o undefined', () => {
    const sinNada = { date: '2026-10-05', description: 'X', amount: 10, type: 'expense' };
    const tx = fns._buildImportTx(sinNada);
    expect(tx.category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('no se altera el comportamiento de las filas ya categorizadas', () => {
    const fila = filaCategorizada('NETFLIX', 13.99, 'Ocio');
    const tx = fns._buildImportTx(fila);
    expect(tx.category).toBe('Ocio');
    expect(tx.description).toBe('NETFLIX');
    expect(tx.categoryConfidence).toBe('high');
    expect(tx.categorySource).toBe('rule');
  });
});

describe('si el usuario SÍ escribe un nombre, se guarda con ese movimiento', () => {
  test('el nombre escrito pasa a ser la descripción visible', () => {
    const fila = { ...filaSinCategoria(RAW_DESCONOCIDO, 42.1), userName: 'Panadería del barrio', category: 'Alimentación' };
    const tx = fns._buildImportTx(fila);
    expect(tx.description).toBe('Panadería del barrio');
  });

  test('el texto crudo del banco se conserva en originalDescription', () => {
    const fila = { ...filaSinCategoria(RAW_DESCONOCIDO, 42.1), userName: 'Panadería del barrio' };
    const tx = fns._buildImportTx(fila);
    expect(tx.originalDescription).toBe(RAW_DESCONOCIDO);
  });

  test('se guarda junto con la categoría que el usuario le asignó', () => {
    const fila = { ...filaSinCategoria(RAW_DESCONOCIDO, 42.1), userName: 'Panadería del barrio', category: 'Alimentación' };
    fns._importPendingRows([fila]);
    expect(APP.transactions[0]).toMatchObject({
      description: 'Panadería del barrio',
      originalDescription: RAW_DESCONOCIDO,
      category: 'Alimentación',
      amount: 42.1,
    });
  });

  test('un nombre en blanco o solo espacios se ignora (no se inventa nada)', () => {
    const tx = fns._buildImportTx({ ...filaSinCategoria(RAW_DESCONOCIDO, 42.1), userName: '   ' });
    expect(tx.description).toBe(RAW_DESCONOCIDO);
    expect(tx.originalDescription).toBeUndefined();
  });

  test('renombrar no rompe la detección de duplicados: se compara el texto crudo', () => {
    // Si se reimporta el mismo extracto, la fila cruda debe reconocerse como
    // duplicada del movimiento ya guardado AUNQUE se le cambiara el nombre.
    const fila = { ...filaSinCategoria(RAW_DESCONOCIDO, 42.1), userName: 'Panadería del barrio', category: 'Alimentación' };
    fns._importPendingRows([fila]);

    const index = fns._txDupIndex(APP.transactions);
    const reimportada = filaSinCategoria(RAW_DESCONOCIDO, 42.1);
    expect(fns._txIsDuplicate(reimportada, index)).toBe(true);
  });
});

describe('el nombre refuerza el sistema de reglas por palabra clave existente', () => {
  // Lo que hace _saveImportReview cuando el usuario nombra y categoriza una
  // fila: escribe la regla con la clave del texto CRUDO del banco, que es el
  // que traerán las próximas importaciones.
  const aprenderDeLaRevision = (rawDescription, categoria) => {
    fns._patWrite(fns.txPatternKey(rawDescription), categoria);
  };

  test('txPatternKey descarta la jerga bancaria y se queda con el comercio', () => {
    expect(fns.txPatternKey(RAW_DESCONOCIDO)).toBe('korvana');
  });

  test('una importación FUTURA con texto parecido se beneficia de la regla', () => {
    aprenderDeLaRevision(RAW_DESCONOCIDO, 'Alimentación');

    // Otro extracto, otra tarjeta, otra ciudad, otro importe: mismo comercio.
    const futura = 'COMPRA TARJ. 9988** KORVANA 12 BCN';
    const res = fns._classifyLocal(futura, 'expense');

    expect(res.category).toBe('Alimentación');
    expect(res.source).toBe('learned');
    expect(res.confidence).toBe('high');
  });

  test('sin la regla, ese mismo movimiento futuro habría quedado sin clasificar', () => {
    // Control: confirma que el beneficio viene de la regla y no de otra cosa.
    const futura = 'COMPRA TARJ. 9988** KORVANA 12 BCN';
    expect(fns._classifyLocal(futura, 'expense').category).toBe(fns.UNCLASSIFIED_CATEGORY);

    aprenderDeLaRevision(RAW_DESCONOCIDO, 'Alimentación');
    expect(fns._classifyLocal(futura, 'expense').category).toBe('Alimentación');
  });

  test('la regla no se aplica a un comercio distinto', () => {
    aprenderDeLaRevision(RAW_DESCONOCIDO, 'Alimentación');
    const otra = 'COMPRA TARJ. 9988** VELTRIX 12 BCN';
    expect(fns._classifyLocal(otra, 'expense').category).toBe(fns.UNCLASSIFIED_CATEGORY);
  });

  test('la regla aprendida queda registrada en APP.categoryPatterns', () => {
    aprenderDeLaRevision(RAW_DESCONOCIDO, 'Alimentación');
    expect(fns._patCat(APP.categoryPatterns['korvana'])).toBe('Alimentación');
  });
});

describe('la fila sin categoría es la única que recibe el campo de nombre', () => {
  test('_computeImportRowStatus sigue marcando como pendiente la fila sin categoría', () => {
    const r = { category: fns.UNCLASSIFIED_CATEGORY, categoryConfidence: 'low', merchant: 'X', isPossibleDuplicate: false };
    expect(fns._computeImportRowStatus(r).status).toBe('review_required');
  });

  test('una fila con categoría de alta confianza sigue estando lista', () => {
    const r = { category: 'Alimentación', categoryConfidence: 'high', merchant: 'Mercadona', isPossibleDuplicate: false };
    expect(fns._computeImportRowStatus(r).status).toBe('ready');
  });
});
