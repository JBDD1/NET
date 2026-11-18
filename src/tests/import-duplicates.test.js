/**
 * Finova — import-duplicates.test.js
 *
 * La detección de duplicados al importar debe comparar el CONTENIDO real de
 * cada movimiento (fecha exacta + importe exacto con su signo + descripción
 * normalizada) y NUNCA el rango de fechas: un extracto nuevo puede solaparse
 * en el tiempo con otro ya importado sin que los movimientos sean los mismos
 * (otra cuenta, otro banco, otro exchange operan esos mismos días).
 *
 * Carga el código REAL de src/core/script.js (vm + jsdom) en vez de
 * reimplementar la lógica aquí, para que el test no pueda divergir en
 * silencio del comportamiento real.
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

  const context = vm.createContext(Object.assign({}, global, { APP, api: global.api, _serverAI: true }));
  vm.runInContext(SRC, context, { filename: 'script.js' });
  fns = vm.runInContext('({_txSignature,_txDupIndex,_txIsDuplicate,_txDupDesc})', context);
  APP = vm.runInContext('APP', context);
  return context;
}

/**
 * Reproduce el paso de deduplicación de _showOFXPreview: cada movimiento
 * entrante se compara contra lo que YA hay en la app, uno a uno.
 * Devuelve { imported, discarded }.
 */
function dedupe(incoming, existing) {
  const index = fns._txDupIndex(existing);
  const imported = [], discarded = [];
  incoming.forEach(r => {
    if (fns._txIsDuplicate(r, index)) discarded.push(r);
    else imported.push(r);
  });
  return { imported, discarded };
}

const tx = (date, description, amount, type = 'expense') => ({ date, description, amount, type });

beforeEach(() => { loadScript(); });

describe('caso del enunciado: dos extractos con rangos de fechas solapados', () => {
  // PRIMER ARCHIVO ya importado: del 1/9/2026 al 1/12/2026.
  const primerArchivo = [
    tx('2026-09-01', 'MERCADONA GRAN VIA', 42.10),
    tx('2026-09-15', 'NOMINA SEPTIEMBRE', 2100, 'income'),
    tx('2026-10-05', 'IBERDROLA LUZ OCTUBRE', 78.33),   // dentro del solape
    tx('2026-10-20', 'MERCADONA GRAN VIA', 31.55),      // dentro del solape
    tx('2026-11-10', 'NETFLIX', 13.99),                 // dentro del solape
    tx('2026-12-01', 'ALQUILER DICIEMBRE', 850),        // borde del solape
  ];

  // SEGUNDO ARCHIVO: del 5/10/2026 al 28/3/2027.
  // Tramo solapado (5/10 → 1/12): unos idénticos a los ya importados y otros
  // distintos (otra cuenta / otro exchange que opera los mismos días).
  const identicosEnSolape = [
    tx('2026-10-05', 'IBERDROLA LUZ OCTUBRE', 78.33),
    tx('2026-10-20', 'MERCADONA GRAN VIA', 31.55),
    tx('2026-11-10', 'NETFLIX', 13.99),
    tx('2026-12-01', 'ALQUILER DICIEMBRE', 850),
  ];
  const distintosEnSolape = [
    tx('2026-10-05', 'BINANCE COMPRA BTC', 500),          // misma fecha, otro movimiento
    tx('2026-10-20', 'MERCADONA GRAN VIA', 31.56),        // mismo texto, 1 céntimo distinto
    tx('2026-11-10', 'SPOTIFY', 13.99),                   // mismo importe, otra descripción
    tx('2026-11-28', 'REVOLUT TRANSFERENCIA', 200, 'income'),
  ];
  const fueraDelSolape = [
    tx('2026-12-15', 'CENA NAVIDAD', 120),
    tx('2027-01-09', 'GIMNASIO ENERO', 39.99),
    tx('2027-02-14', 'DIVIDENDO SAN', 64.20, 'income'),
    tx('2027-03-28', 'MERCADONA GRAN VIA', 55.40),
  ];

  test('los duplicados exactos del tramo solapado se descartan', () => {
    const segundoArchivo = [...identicosEnSolape, ...distintosEnSolape, ...fueraDelSolape];
    const { discarded } = dedupe(segundoArchivo, primerArchivo);

    expect(discarded).toHaveLength(identicosEnSolape.length);
    expect(discarded.map(r => r.description).sort()).toEqual(
      identicosEnSolape.map(r => r.description).sort()
    );
  });

  test('los movimientos DISTINTOS del tramo solapado se importan igualmente', () => {
    const segundoArchivo = [...identicosEnSolape, ...distintosEnSolape, ...fueraDelSolape];
    const { imported } = dedupe(segundoArchivo, primerArchivo);

    // Ninguno de los distintos se pierde por caer dentro del rango ya cubierto.
    distintosEnSolape.forEach(r => {
      expect(imported).toContainEqual(r);
    });
  });

  test('todo el tramo fuera del solape (1/12/2026 → 28/3/2027) se importa', () => {
    const segundoArchivo = [...identicosEnSolape, ...distintosEnSolape, ...fueraDelSolape];
    const { imported } = dedupe(segundoArchivo, primerArchivo);

    fueraDelSolape.forEach(r => {
      expect(imported).toContainEqual(r);
    });
  });

  test('recuento final: se importa todo menos los duplicados exactos', () => {
    const segundoArchivo = [...identicosEnSolape, ...distintosEnSolape, ...fueraDelSolape];
    const { imported, discarded } = dedupe(segundoArchivo, primerArchivo);

    expect(imported).toHaveLength(distintosEnSolape.length + fueraDelSolape.length);
    expect(discarded).toHaveLength(identicosEnSolape.length);
    expect(imported.length + discarded.length).toBe(segundoArchivo.length);
  });

  test('el solape de fechas por sí solo NO descarta nada', () => {
    // Un segundo archivo cuyo rango se solapa por completo con el primero,
    // pero sin un solo movimiento coincidente: se importa entero.
    const soloDistintos = [
      tx('2026-10-06', 'KRAKEN COMPRA ETH', 300),
      tx('2026-10-21', 'FARMACIA CENTRAL', 12.40),
      tx('2026-11-11', 'UBER', 9.80),
    ];
    const { imported, discarded } = dedupe(soloDistintos, primerArchivo);
    expect(imported).toHaveLength(3);
    expect(discarded).toHaveLength(0);
  });
});

describe('dos cuentas distintas con la misma fecha', () => {
  const existente = [tx('2026-10-05', 'COMPRA SUPERMERCADO', 50)];

  test('misma fecha pero distinto importe NO es duplicado', () => {
    const { imported, discarded } = dedupe([tx('2026-10-05', 'COMPRA SUPERMERCADO', 50.01)], existente);
    expect(imported).toHaveLength(1);
    expect(discarded).toHaveLength(0);
  });

  test('misma fecha pero distinta descripción NO es duplicado', () => {
    const { imported, discarded } = dedupe([tx('2026-10-05', 'COMPRA GASOLINERA', 50)], existente);
    expect(imported).toHaveLength(1);
    expect(discarded).toHaveLength(0);
  });

  test('misma fecha e importe pero signo contrario NO es duplicado', () => {
    // Un ingreso de 50 € no es el mismo movimiento que un gasto de 50 €.
    const { imported, discarded } = dedupe([tx('2026-10-05', 'COMPRA SUPERMERCADO', 50, 'income')], existente);
    expect(imported).toHaveLength(1);
    expect(discarded).toHaveLength(0);
  });

  test('misma descripción e importe pero otra fecha NO es duplicado', () => {
    const { imported, discarded } = dedupe([tx('2026-10-06', 'COMPRA SUPERMERCADO', 50)], existente);
    expect(imported).toHaveLength(1);
    expect(discarded).toHaveLength(0);
  });
});

describe('criterio de coincidencia de la descripción', () => {
  test('normaliza mayúsculas, acentos y espacios', () => {
    const existente = [tx('2026-10-05', 'CAFÉ   SOL', 3.5)];
    const { discarded } = dedupe([tx('2026-10-05', 'cafe sol', 3.5)], existente);
    expect(discarded).toHaveLength(1);
  });

  test('no se trunca la descripción: dos conceptos largos con el mismo principio son distintos', () => {
    const base = 'TRANSFERENCIA A JUAN PEREZ GOMEZ CONCEPTO ';
    const existente = [tx('2026-10-05', base + 'ALQUILER', 500)];
    const { imported, discarded } = dedupe([tx('2026-10-05', base + 'PRESTAMO', 500)], existente);
    expect(imported).toHaveLength(1);
    expect(discarded).toHaveLength(0);
  });

  test('el importe nunca es aproximado, ni por un céntimo', () => {
    const existente = [tx('2026-10-05', 'GASOLINERA REPSOL', 60.00)];
    const { discarded } = dedupe([tx('2026-10-05', 'GASOLINERA REPSOL', 59.99)], existente);
    expect(discarded).toHaveLength(0);
  });

  test('sin descripción legible solo coincide con otro también sin descripción', () => {
    // Criterio documentado en _txSignature: un movimiento sin concepto nunca
    // se confunde con uno que sí lo trae, aunque compartan fecha e importe.
    const sinDesc = [tx('2026-10-05', '', 20)];
    expect(dedupe([tx('2026-10-05', '', 20)], sinDesc).discarded).toHaveLength(1);
    expect(dedupe([tx('2026-10-05', 'CAJERO', 20)], sinDesc).discarded).toHaveLength(0);
    expect(dedupe([tx('2026-10-05', '', 20)], [tx('2026-10-05', 'CAJERO', 20)]).discarded).toHaveLength(0);
  });
});

describe('recuento 1:1 (no se pierden movimientos repetidos reales)', () => {
  test('si existe UNO y el archivo trae DOS idénticos, se descarta uno y se importa el otro', () => {
    // Dos cafés iguales el mismo día son posibles: solo uno estaba ya.
    const existente = [tx('2026-10-05', 'CAFE', 1.5)];
    const { imported, discarded } = dedupe(
      [tx('2026-10-05', 'CAFE', 1.5), tx('2026-10-05', 'CAFE', 1.5)],
      existente
    );
    expect(discarded).toHaveLength(1);
    expect(imported).toHaveLength(1);
  });

  test('si existen DOS y el archivo trae DOS idénticos, se descartan los dos', () => {
    const existente = [tx('2026-10-05', 'CAFE', 1.5), tx('2026-10-05', 'CAFE', 1.5)];
    const { imported, discarded } = dedupe(
      [tx('2026-10-05', 'CAFE', 1.5), tx('2026-10-05', 'CAFE', 1.5)],
      existente
    );
    expect(discarded).toHaveLength(2);
    expect(imported).toHaveLength(0);
  });
});

describe('robustez de la firma', () => {
  test('un importe en texto no rompe la comparación', () => {
    const existente = [{ date: '2026-10-05', description: 'LUZ', amount: '78.33', type: 'expense' }];
    const { discarded } = dedupe([tx('2026-10-05', 'LUZ', 78.33)], existente);
    expect(discarded).toHaveLength(1);
  });

  test('_txDupDesc normaliza a minúsculas, sin acentos y con espacios colapsados', () => {
    expect(fns._txDupDesc('  CAFÉ   SOL  ')).toBe('cafe sol');
    expect(fns._txDupDesc(null)).toBe('');
  });
});
