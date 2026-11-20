/**
 * Finova — sync-sessions.test.js
 *
 * Sincronización por cuenta entre sesiones. La subida ya era automática
 * (_debouncedServerSync); lo que faltaba era la BAJADA: con datos locales ya
 * presentes, una segunda sesión no bajaba nunca lo que había subido la
 * primera y, al seguir subiendo lo suyo, sobrescribía los cambios de la otra.
 *
 * Aquí se prueban las piezas puras que deciden si hay conflicto:
 *  · _syncFingerprint — huella del CONTENIDO, para no preguntar por cambios
 *    que no son de datos (tema, sección abierta, orden del dashboard),
 *  · _syncSummary / _syncFmtWhen — el resumen que ve el usuario al elegir.
 *
 * storage.js no se puede cargar entero sin todo su entorno, así que se
 * extraen sus declaraciones de primer nivel igual que hace
 * transactions-javi.test.js con script.js: así se prueba el código REAL y no
 * una copia que pueda divergir.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const STORAGE = fs.readFileSync(path.join(process.cwd(), 'src/core/storage.js'), 'utf8');

function extractFromStorage(...names) {
  const out = [];
  for (const name of names) {
    const re = new RegExp(`(?:^|\\n)(?:const|function)\\s+${name}\\b`);
    const m = re.exec(STORAGE);
    if (!m) throw new Error(`No encontrado en storage.js: ${name}`);
    const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const rest = STORAGE.slice(start + 1);
    const n = /\n(?:const|let|function|\/\* ═)/.exec(rest);
    out.push(STORAGE.slice(start, n ? start + 1 + n.index : STORAGE.length));
  }
  return out.join('\n');
}

let fns;

beforeEach(() => {
  const ctx = vm.createContext(Object.assign({}, global));
  vm.runInContext(
    extractFromStorage('_SYNC_CONTENT_KEYS', '_syncFingerprint', '_syncSummary', '_syncFmtWhen'),
    ctx, { filename: 'storage-sync.js' }
  );
  fns = vm.runInContext('({_syncFingerprint,_syncSummary,_syncFmtWhen,_SYNC_CONTENT_KEYS})', ctx);
});

const copia = (over = {}) => ({
  transactions: [{ id: 't1', date: '2026-10-05', description: 'MERCADONA', amount: 42.1, type: 'expense', category: 'Alimentación' }],
  portfolio: [{ id: 'p1', ticker: 'VWCE', quantity: 10, buyPrice: 100 }],
  goals: [],
  categories: { income: ['Salario'], expense: ['Alimentación'] },
  categoryPatterns: { mercadona: { cat: 'Alimentación', hits: 2 } },
  theme: 'dark',
  activeSection: 'dashboard',
  lastSavedAt: '2026-11-20T10:00:00.000Z',
  ...over,
});

describe('_syncFingerprint — detecta si los DATOS difieren', () => {
  test('dos copias con los mismos datos dan la misma huella', () => {
    expect(fns._syncFingerprint(copia())).toBe(fns._syncFingerprint(copia()));
  });

  test('una transacción distinta cambia la huella', () => {
    const otra = copia({ transactions: [{ id: 't1', date: '2026-10-05', description: 'MERCADONA', amount: 99.9, type: 'expense', category: 'Alimentación' }] });
    expect(fns._syncFingerprint(otra)).not.toBe(fns._syncFingerprint(copia()));
  });

  test('una transacción de más cambia la huella', () => {
    const base = copia();
    const otra = copia({ transactions: [...base.transactions, { id: 't2', date: '2026-10-06', description: 'LUZ', amount: 60, type: 'expense', category: 'Vivienda' }] });
    expect(fns._syncFingerprint(otra)).not.toBe(fns._syncFingerprint(base));
  });

  test('un cambio en la cartera cambia la huella', () => {
    expect(fns._syncFingerprint(copia({ portfolio: [] }))).not.toBe(fns._syncFingerprint(copia()));
  });

  test('las reglas de categorización aprendidas cuentan como datos', () => {
    // Importa: son datos del usuario y deben viajar entre sesiones.
    const otra = copia({ categoryPatterns: { mercadona: { cat: 'Otros gastos', hits: 2 } } });
    expect(fns._syncFingerprint(otra)).not.toBe(fns._syncFingerprint(copia()));
    expect(fns._SYNC_CONTENT_KEYS).toContain('categoryPatterns');
  });

  test('NO cambia por diferencias de interfaz: no se pregunta por eso', () => {
    // Que un dispositivo tenga otro tema, otra sección abierta u otro orden
    // de widgets no es un conflicto de datos.
    const soloUI = copia({
      theme: 'light',
      activeSection: 'portfolio',
      privacyMode: true,
      dashboardLayout: ['a', 'b'],
      sectionOrder: ['x'],
      lastSavedAt: '2026-11-20T23:59:59.000Z',
    });
    expect(fns._syncFingerprint(soloUI)).toBe(fns._syncFingerprint(copia()));
  });

  test('la propia marca de tiempo no altera la huella', () => {
    expect(fns._syncFingerprint(copia({ lastSavedAt: '2020-01-01T00:00:00.000Z' })))
      .toBe(fns._syncFingerprint(copia()));
  });

  test('una copia vacía o inválida no revienta', () => {
    expect(fns._syncFingerprint(null)).toBe('0');
    expect(fns._syncFingerprint(undefined)).toBe('0');
    expect(typeof fns._syncFingerprint({})).toBe('string');
  });

  test('una copia vacía y una con datos nunca dan la misma huella', () => {
    expect(fns._syncFingerprint({})).not.toBe(fns._syncFingerprint(copia()));
  });
});

describe('_syncSummary — lo que el usuario ve para decidir', () => {
  test('cuenta transacciones, posiciones y objetivos', () => {
    const s = fns._syncSummary(copia({ goals: [{ id: 'g1' }, { id: 'g2' }] }));
    expect(s).toMatchObject({ tx: 1, pos: 1, goals: 2 });
    expect(s.savedAt).toBe('2026-11-20T10:00:00.000Z');
  });

  test('una copia sin datos se resume a ceros, sin fallar', () => {
    expect(fns._syncSummary({})).toMatchObject({ tx: 0, pos: 0, goals: 0, savedAt: '' });
    expect(fns._syncSummary(null)).toMatchObject({ tx: 0, pos: 0, goals: 0 });
  });

  test('ignora un campo con el tipo equivocado en vez de romper', () => {
    expect(fns._syncSummary({ transactions: 'no es un array' }).tx).toBe(0);
  });

  test('una marca de tiempo que no es texto no se propaga', () => {
    expect(fns._syncSummary({ lastSavedAt: 12345 }).savedAt).toBe('');
  });
});

describe('_syncFmtWhen — fecha legible', () => {
  test('una fecha válida se formatea', () => {
    const out = fns._syncFmtWhen('2026-11-20T10:00:00.000Z');
    expect(out).not.toBe('fecha desconocida');
    expect(out).toMatch(/2026/);
  });

  test('sin fecha o con una fecha inválida se dice explícitamente', () => {
    expect(fns._syncFmtWhen('')).toBe('fecha desconocida');
    expect(fns._syncFmtWhen(undefined)).toBe('fecha desconocida');
    expect(fns._syncFmtWhen('no es una fecha')).toBe('fecha desconocida');
  });
});

describe('comparación de recencia entre copias', () => {
  test('las marcas ISO se ordenan como texto, así que basta comparar', () => {
    // Es lo que usa _syncShowConflictModal para señalar "la más reciente".
    const vieja = '2026-11-20T10:00:00.000Z';
    const nueva = '2026-11-20T18:30:00.000Z';
    expect(nueva > vieja).toBe(true);
    expect(vieja > nueva).toBe(false);
  });
});
