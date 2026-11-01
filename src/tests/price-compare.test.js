/**
 * Finova — price-compare.test.js
 * Comparador universal de precios.
 *
 * El encargo puso la precisión por encima de la cobertura, así que la mitad
 * de estos tests comprueban que el motor se NIEGA a comparar. Una comparación
 * de menos es una molestia; una comparación falsa es un número inventado que
 * el usuario se cree.
 *
 * Todos los valores esperados están calculados a mano. Donde la cuenta no es
 * evidente va escrita en un comentario al lado.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC_HIST = fs.readFileSync(path.join(process.cwd(), 'src/utils/tx-history.js'), 'utf8');
const SRC_PC   = fs.readFileSync(path.join(process.cwd(), 'src/utils/price-compare.js'), 'utf8');

/**
 * Carga los módulos REALES. price-compare depende de mhMerchantKey, que vive
 * en tx-history: se cargan los dos, como en producción.
 */
function load(transactions) {
  const ctx = vm.createContext({
    APP: { transactions: transactions || [], theme: 'dark', categories: { expense: [] } },
    UNCLASSIFIED_CATEGORY: 'Sin clasificar',
    formatCurrency: v => Number(v).toFixed(2) + ' €',
    formatDate: d => d,
    escapeHtml: s => String(s),
    formatPct: (v, s = true) => {
      const n = parseFloat(v) || 0;
      const a = Math.abs(n).toFixed(2);
      return s ? (n >= 0 ? '+' : '-') + a + '%' : (n < 0 ? '-' : '') + a + '%';
    },
    showToast() {}, openModal() {}, closeModal() {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: { getSelection: () => '' },
    Chart: undefined, safeDestroyChart: () => null, getChartDefaults: undefined,
    loadPhoto: undefined, openAddTransaction: undefined,
    console, Date, Math, Number, String, Array, Map, Set, Object, JSON,
    parseFloat, parseInt, isNaN, isFinite, setTimeout,
  });
  vm.runInContext(SRC_HIST, ctx);
  vm.runInContext(SRC_PC, ctx);
  return ctx;
}
const get = (ctx, name) => vm.runInContext(name, ctx);

let _n = 0;
/** Transacción de gasto. Con `items` se le cuelga un ticket escaneado. */
const tx = (description, amount, date, category, items) => {
  const t = {
    id: 'p' + (++_n), type: 'expense', description, amount, date,
    category: category || 'Alimentación', note: '', favorite: false,
  };
  if (items) t.receipt = { merchant: description, total: amount, date, items };
  return t;
};
/** Línea de ticket. */
const it = (name, o) => Object.assign({ name, brand: null, size: null, sizeUnit: null, qty: 1, unitPrice: null, total: null }, o);

/** Descriptor de una línea con el contexto mínimo. */
const desc = (ctx, item, extra) => get(ctx, 'pcDescribeItem')(item, Object.assign({
  txId: 'p0', date: '2026-10-01', merchantKey: 'x', merchantLabel: 'X', category: 'Alimentación',
}, extra));

/* ═══ 1. Tamaño escrito dentro del nombre ══════════════════════ */

describe('Tamaño leído del nombre — los tickets antiguos no traen size', () => {
  let parse;
  beforeEach(() => { parse = get(load([]), 'pcParseSizeFromName'); });

  test('formatos habituales de un ticket español', () => {
    expect(parse('LECHE SEMI 1 L')).toEqual({ value: 1, unit: 'l' });
    expect(parse('Pan de molde 500g')).toEqual({ value: 500, unit: 'g' });
    expect(parse('Cerveza 33 cl')).toEqual({ value: 33, unit: 'cl' });
    expect(parse('Aceite 1,5L')).toEqual({ value: 1.5, unit: 'l' });
    expect(parse('Arroz 250 gr')).toEqual({ value: 250, unit: 'g' });
    expect(parse('Jamón 1 kilo')).toEqual({ value: 1, unit: 'kg' });
    expect(parse('Cable 2 m')).toEqual({ value: 2, unit: 'm' });
  });

  test('sin tamaño en el nombre devuelve null, no un tamaño inventado', () => {
    expect(parse('Pollo entero')).toBeNull();
    expect(parse('Consulta dentista')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse(null)).toBeNull();
  });

  test('un tamaño de 0 o negativo no es un tamaño', () => {
    expect(parse('Agua 0 l')).toBeNull();
  });

  test('el tamaño del escáner manda sobre el del nombre', () => {
    const ctx = load([]);
    // El nombre dice 1 L, el escáner dice 750 ml: gana el escáner, que ha
    // leído el campo del ticket en vez de adivinarlo del texto.
    const d = desc(ctx, it('Aceite 1 L', { size: 750, sizeUnit: 'ml', unitPrice: 6 }));
    expect(d.size).toEqual({ value: 750, unit: 'ml' });
    expect(d.sizeFuente).toBe('escaner');
    // 6 € / 0,75 l = 8 €/l
    expect(d.precioCanonico).toBeCloseTo(8, 6);
  });
});

/* ═══ 2. Unidades canónicas ════════════════════════════════════ */

describe('Precio por unidad canónica — convertir antes de comparar', () => {
  let ctx;
  beforeEach(() => { ctx = load([]); });

  test('gramos a kilos', () => {
    // 1,85 € / 0,5 kg = 3,70 €/kg
    const d = desc(ctx, it('Pan de molde', { size: 500, sizeUnit: 'g', unitPrice: 1.85 }));
    expect(d.magnitud).toBe('peso');
    expect(d.metrica).toBe('€/kg');
    expect(d.precioCanonico).toBeCloseTo(3.70, 6);
  });

  test('centilitros a litros', () => {
    // 0,89 € / 0,33 l = 2,6969… €/l
    const d = desc(ctx, it('Cerveza', { size: 33, sizeUnit: 'cl', unitPrice: 0.89 }));
    expect(d.metrica).toBe('€/l');
    expect(d.precioCanonico).toBeCloseTo(0.89 / 0.33, 6);
  });

  test('sin tamaño ni pista, el precio es por unidad', () => {
    const d = desc(ctx, it('Pollo entero', { unitPrice: 7.40 }));
    expect(d.magnitud).toBe('unidad');
    expect(d.precioCanonico).toBeCloseTo(7.40, 6);
  });

  test('el combustible se reconoce por el nombre, no por la categoría', () => {
    // En un ticket de gasolinera, qty son litros y unitPrice es €/l, pero
    // nada en los datos lo dice: lo delata el nombre.
    const d = desc(ctx, it('Gasolina 95 sin plomo', { qty: 42, unitPrice: 1.70 }), { category: 'Transporte' });
    expect(d.magnitud).toBe('volumen');
    expect(d.metrica).toBe('€/l');
    expect(d.precioCanonico).toBeCloseTo(1.70, 6);
  });

  test('un abono de transporte NO se convierte a litros por estar en Transporte', () => {
    const d = desc(ctx, it('Abono mensual metro', { unitPrice: 54.60 }), { category: 'Transporte' });
    expect(d.magnitud).toBe('unidad');
  });

  test('sin unitPrice se deduce del total y la cantidad', () => {
    // 11,40 € / 6 = 1,90 € la unidad
    const d = desc(ctx, it('Yogur', { qty: 6, total: 11.40 }));
    expect(d.precioUnidad).toBeCloseTo(1.90, 6);
  });

  test('sin precio de ninguna forma, la línea no es comparable', () => {
    const d = desc(ctx, it('Bolsa reutilizable', { qty: 1 }));
    expect(d.comparable).toBe(false);
    expect(d.precioCanonico).toBeNull();
  });

  test('una línea sin nombre no produce descriptor', () => {
    expect(desc(ctx, it('', { unitPrice: 2 }))).toBeNull();
    expect(desc(ctx, { unitPrice: 2 })).toBeNull();
  });
});

/* ═══ 3. Equivalencia ══════════════════════════════════════════ */

describe('Equivalencia — la regla que evita los ahorros falsos', () => {
  let ctx, eq;
  beforeEach(() => { ctx = load([]); eq = get(ctx, 'pcEquivalence'); });

  const nivel = (a, b) => eq(desc(ctx, a), desc(ctx, b));

  test('IDÉNTICO: mismo producto, misma marca, mismo tamaño', () => {
    expect(nivel(
      it('Leche semidesnatada', { brand: 'Hacendado', size: 1, sizeUnit: 'l', unitPrice: 0.89 }),
      it('Leche semidesnatada', { brand: 'Hacendado', size: 1, sizeUnit: 'l', unitPrice: 0.95 }),
    )).toBe('identico');
  });

  test('IDÉNTICO: el tamaño escrito «1L» y «1 L» es el mismo', () => {
    expect(nivel(
      it('Leche semidesnatada 1L', { unitPrice: 0.89 }),
      it('Leche semidesnatada 1 L', { unitPrice: 0.95 }),
    )).toBe('identico');
  });

  test('IDÉNTICO: el tamaño del lote no cambia el producto', () => {
    // Un pack de 12 y uno de 6 de la misma cerveza de 33 cl son el mismo
    // producto en otro formato: el número de unidades va en qty.
    expect(nivel(
      it('Pack 12 cervezas', { size: 33, sizeUnit: 'cl', qty: 12, unitPrice: 0.65 }),
      it('Pack 6 cervezas', { size: 33, sizeUnit: 'cl', qty: 6, unitPrice: 0.72 }),
    )).toBe('identico');
  });

  test('EQUIVALENTE: mismo producto, otro tamaño — comparable por €/l', () => {
    expect(nivel(
      it('Leche semidesnatada', { brand: 'Hacendado', size: 1, sizeUnit: 'l', unitPrice: 0.89 }),
      it('Leche semidesnatada', { brand: 'Milbona', size: 500, sizeUnit: 'ml', unitPrice: 0.49 }),
    )).toBe('equivalente');
  });

  test('SIMILAR: dos variedades del mismo producto NO se comparan en precio', () => {
    // Entera y semidesnatada no cuestan lo mismo, y nada en los datos dice
    // cuál debería costar más.
    expect(nivel(
      it('Leche entera', { size: 1, sizeUnit: 'l', unitPrice: 0.89 }),
      it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 0.95 }),
    )).toBe('similar');
  });

  test('SIMILAR: dos modelos de móvil no son el mismo móvil', () => {
    // Este es el caso que se colaba: con un filtro de 3 caracteres los
    // números cortos desaparecían, «iPhone 15 128GB» y «iPhone 16 128GB»
    // daban el mismo núcleo y se comparaban como IDÉNTICOS.
    expect(nivel(
      it('iPhone 15 128GB', { unitPrice: 909 }),
      it('iPhone 16 128GB', { unitPrice: 959 }),
    )).toBe('similar');
  });

  test('SIMILAR: dos zapatillas del mismo modelo con número distinto', () => {
    expect(nivel(
      it('Nike Air 90', { unitPrice: 119 }),
      it('Nike Air 95', { unitPrice: 139 }),
    )).toBe('similar');
  });

  test('SIMILAR: el mismo portátil con otra memoria', () => {
    // El núcleo no puede recortarse a las primeras palabras: justo lo que se
    // perdería al recortar es lo que distingue los dos precios.
    expect(nivel(
      it('Portatil Lenovo IdeaPad 15 16GB', { unitPrice: 799 }),
      it('Portatil Lenovo IdeaPad 15 8GB', { unitPrice: 829 }),
    )).toBe('similar');
  });

  test('NO COMPARABLE: productos de mundos distintos', () => {
    expect(nivel(
      it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 0.89 }),
      it('Taladro percutor', { unitPrice: 59 }),
    )).toBe('no-comparable');
  });

  test('NO COMPARABLE: sin descriptor no se afirma nada', () => {
    expect(eq(null, null)).toBe('no-comparable');
    expect(eq(desc(ctx, it('Leche 1 L', { unitPrice: 1 })), null)).toBe('no-comparable');
  });

  test('SIMILAR, no equivalente, cuando falta el tamaño de uno de los dos', () => {
    // Mismo producto y misma magnitud, pero sin los dos tamaños no se puede
    // normalizar a €/kg: se enseña, no se compara.
    const a = desc(ctx, it('Jamón serrano', { size: 100, sizeUnit: 'g', unitPrice: 3.20 }));
    const b = desc(ctx, it('Jamón serrano', { unitPrice: 4.10 }));
    // b no tiene tamaño, así que su magnitud es 'unidad' y a es 'peso':
    // magnitudes distintas, mismo primer término → similar.
    expect(eq(a, b)).toBe('similar');
  });
});

/* ═══ 4. Índice ════════════════════════════════════════════════ */

describe('Índice de precios', () => {
  const T = [
    tx('Mercadona', 20, '2026-08-05', 'Alimentación', [
      it('Leche semidesnatada', { size: 1, sizeUnit: 'l', qty: 6, unitPrice: 0.89 }),
      it('Pan de molde', { size: 500, sizeUnit: 'g', unitPrice: 1.85 }),
    ]),
    tx('Lidl', 15, '2026-09-14', 'Alimentación', [
      it('Leche semidesnatada', { size: 500, sizeUnit: 'ml', qty: 12, unitPrice: 0.49 }),
    ]),
    tx('Bar Manolo', 12, '2026-09-20', 'Restaurantes'),
  ];

  test('agrupa por producto y cuenta las líneas', () => {
    const idx = get(load(T), 'pcIndex')();
    // 3 líneas en total (dos de Mercadona, una de Lidl); la del bar no tiene
    // ticket. Dos productos distintos: leche y pan.
    expect(idx.lineas).toBe(3);
    expect(idx.conPrecio).toBe(3);
    expect(idx.porProducto.size).toBe(2);
  });

  test('las dos leches, de formatos distintos, caen en el mismo grupo', () => {
    const ctx = load(T);
    const idx = get(ctx, 'pcIndex')();
    const clave = get(ctx, 'pcItemKey')(desc(ctx, it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 1 })));
    expect(idx.porProducto.get(clave).descs).toHaveLength(2);
  });

  test('los ingresos no entran: una devolución no es un precio pagado', () => {
    const dev = tx('Mercadona', 5, '2026-09-01', 'Alimentación', [it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 0.10 })]);
    dev.type = 'income';
    const idx = get(load([...T, dev]), 'pcIndex')();
    expect(idx.lineas).toBe(3);
  });

  test('se memoiza, y se invalida si cambia un importe', () => {
    const copia = JSON.parse(JSON.stringify(T));
    const ctx = load(copia);
    const pcIndex = get(ctx, 'pcIndex');
    expect(pcIndex()).toBe(pcIndex());
    const antes = pcIndex();
    // Editar un importe sin añadir transacciones también tiene que recalcular.
    vm.runInContext('APP.transactions[0].amount = 999', ctx);
    expect(pcIndex()).not.toBe(antes);
  });

  test('un historial vacío no explota', () => {
    const idx = get(load([]), 'pcIndex')();
    expect(idx.lineas).toBe(0);
    expect(idx.porProducto.size).toBe(0);
  });
});

/* ═══ 5. Comparación de producto ═══════════════════════════════ */

describe('Comparación de un producto entre comercios', () => {
  /*
   * Leche semidesnatada en tres sitios:
   *   Mercadona  1 L   a 0,89 € → 0,89 €/l
   *   Lidl       500ml a 0,49 € → 0,98 €/l   (0,49 / 0,5)
   *   Carrefour  1 L   a 1,05 € → 1,05 €/l
   */
  const T = [
    tx('Mercadona Gran Via', 20, '2026-08-05', 'Alimentación', [it('Leche semidesnatada', { brand: 'Hacendado', size: 1, sizeUnit: 'l', qty: 6, unitPrice: 0.89 })]),
    tx('Lidl Calle Mayor', 15, '2026-09-14', 'Alimentación', [it('Leche semidesnatada', { brand: 'Milbona', size: 500, sizeUnit: 'ml', qty: 12, unitPrice: 0.49 })]),
    tx('Carrefour Market', 25, '2026-10-02', 'Alimentación', [it('Leche semidesnatada', { brand: 'Carrefour', size: 1, sizeUnit: 'l', qty: 6, unitPrice: 1.05 })]),
  ];
  let ctx, cmp;
  beforeEach(() => {
    ctx = load(T);
    const ref = desc(ctx, it('Leche semidesnatada', { brand: 'Carrefour', size: 1, sizeUnit: 'l', qty: 6, unitPrice: 1.05 }),
      { merchantKey: 'carrefour', merchantLabel: 'Carrefour Market', date: '2026-10-02' });
    cmp = get(ctx, 'pcCompareProduct')(ref);
  });

  test('encuentra los tres comercios y los ordena por precio', () => {
    expect(cmp.nComercios).toBe(3);
    expect(cmp.comparacionValida).toBe(true);
    expect(cmp.alternativas.map(a => a.merchantLabel))
      .toEqual(['Mercadona Gran Via', 'Lidl Calle Mayor', 'Carrefour Market']);
  });

  test('normaliza los 500 ml a €/l', () => {
    const lidl = cmp.alternativas.find(a => a.merchantLabel === 'Lidl Calle Mayor');
    expect(lidl.ultimo).toBeCloseTo(0.98, 6);   // 0,49 / 0,5
  });

  test('señala el más barato y el más caro', () => {
    expect(cmp.barato.merchantLabel).toBe('Mercadona Gran Via');
    expect(cmp.caro.merchantLabel).toBe('Carrefour Market');
    expect(cmp.difUnidad).toBeCloseTo(0.16, 6);          // 1,05 − 0,89
    expect(cmp.pctDif).toBeCloseTo(17.977528, 4);        // 0,16 / 0,89
  });

  test('dice cuántos precios sostienen cada cifra', () => {
    for (const a of cmp.alternativas) expect(a.registros).toBe(1);
  });

  test('marca las comparaciones que son por unidad y no idénticas', () => {
    // Carrefour es la referencia: idéntico a sí mismo. Los otros dos son de
    // otra marca, así que la comparación es por €/l.
    expect(cmp.alternativas.find(a => a.merchantLabel === 'Carrefour Market').soloIdenticos).toBe(true);
    expect(cmp.alternativas.find(a => a.merchantLabel === 'Lidl Calle Mayor').soloIdenticos).toBe(false);
  });

  test('la métrica viaja con la comparación', () => {
    expect(cmp.metrica).toBe('€/l');
    expect(cmp.fuente).toBe('linea-ticket');
  });

  test('con un solo comercio NO hay comparación, y se dice', () => {
    const solo = load([T[0]]);
    const ref = desc(solo, it('Leche semidesnatada', { brand: 'Hacendado', size: 1, sizeUnit: 'l', unitPrice: 0.89 }),
      { merchantKey: 'mercadona', merchantLabel: 'Mercadona Gran Via' });
    const c = get(solo, 'pcCompareProduct')(ref);
    expect(c.nComercios).toBe(1);
    expect(c.comparacionValida).toBe(false);
    // Ni diferencia ni porcentaje: un 0 % parecería un dato.
    expect(c.difUnidad).toBeNull();
    expect(c.pctDif).toBeNull();
  });

  test('un producto que no está en el historial no devuelve comparación', () => {
    const ref = desc(ctx, it('Taladro percutor', { unitPrice: 59 }));
    expect(get(ctx, 'pcCompareProduct')(ref)).toBeNull();
  });

  test('sin referencia no se compara nada', () => {
    expect(get(ctx, 'pcCompareProduct')(null)).toBeNull();
  });
});

/* ═══ 6. Productos parecidos que no se comparan ════════════════ */

describe('Parecidos — se enseñan, no se comparan', () => {
  const T = [
    tx('MediaMarkt', 799, '2026-06-10', 'Ocio', [it('Portatil Lenovo IdeaPad 15 16GB', { unitPrice: 799 })]),
    tx('PcComponentes', 749, '2026-07-01', 'Ocio', [it('Portatil Lenovo IdeaPad 15 16GB', { unitPrice: 749 })]),
    tx('Worten', 829, '2026-07-20', 'Ocio', [it('Portatil Lenovo IdeaPad 15 8GB', { unitPrice: 829 })]),
  ];
  let cmp;
  beforeEach(() => {
    const ctx = load(T);
    const ref = desc(ctx, it('Portatil Lenovo IdeaPad 15 16GB', { unitPrice: 799 }),
      { merchantKey: 'mediamarkt', merchantLabel: 'MediaMarkt', category: 'Ocio' });
    cmp = get(ctx, 'pcCompareProduct')(ref);
  });

  test('el de 8 GB NO entra en la comparación de precios', () => {
    expect(cmp.nComercios).toBe(2);
    expect(cmp.alternativas.map(a => a.merchantLabel).sort()).toEqual(['MediaMarkt', 'PcComponentes']);
    expect(cmp.alternativas.some(a => a.merchantLabel === 'Worten')).toBe(false);
  });

  test('pero SÍ aparece en la lista de parecidos', () => {
    // Sin el índice por familia esta lista salía siempre vacía: la
    // comparación solo miraba dentro del grupo del propio núcleo, donde por
    // definición todo tiene el mismo núcleo.
    expect(cmp.similaresPorProducto).toHaveLength(1);
    const s = cmp.similaresPorProducto[0];
    expect(s.nombre).toBe('Portatil Lenovo IdeaPad 15 8GB');
    expect(s.comercios).toEqual(['Worten']);
    expect(s.ultimo).toBeCloseTo(829, 6);
  });

  test('un parecido por producto, no uno por línea de ticket', () => {
    const repes = [...T,
      tx('Worten', 829, '2026-08-20', 'Ocio', [it('Portatil Lenovo IdeaPad 15 8GB', { unitPrice: 819 })]),
      tx('Worten', 829, '2026-09-20', 'Ocio', [it('Portatil Lenovo IdeaPad 15 8GB', { unitPrice: 809 })]),
    ];
    const ctx = load(repes);
    const ref = desc(ctx, it('Portatil Lenovo IdeaPad 15 16GB', { unitPrice: 799 }),
      { merchantKey: 'mediamarkt', merchantLabel: 'MediaMarkt', category: 'Ocio' });
    const c = get(ctx, 'pcCompareProduct')(ref);
    expect(c.similaresPorProducto).toHaveLength(1);
    expect(c.similaresPorProducto[0].registros).toBe(3);
    // El precio que se enseña es el más reciente, no el primero.
    expect(c.similaresPorProducto[0].ultimo).toBeCloseTo(809, 6);
  });
});

/* ═══ 7. Ahorro histórico ══════════════════════════════════════ */

describe('Ahorro histórico — nunca presentado como oferta de hoy', () => {
  const T = [
    tx('Mercadona', 20, '2026-08-05', 'Alimentación', [it('Leche semidesnatada', { size: 1, sizeUnit: 'l', qty: 6, unitPrice: 0.89 })]),
    tx('Carrefour', 25, '2026-10-02', 'Alimentación', [it('Leche semidesnatada', { size: 1, sizeUnit: 'l', qty: 6, unitPrice: 1.05 })]),
  ];
  let ctx, ref, cmp, ah;
  beforeEach(() => {
    ctx = load(T);
    ref = desc(ctx, it('Leche semidesnatada', { size: 1, sizeUnit: 'l', qty: 6, unitPrice: 1.05 }),
      { merchantKey: 'carrefour', merchantLabel: 'Carrefour', date: '2026-10-02' });
    cmp = get(ctx, 'pcCompareProduct')(ref);
    ah = get(ctx, 'pcAhorroHistorico')(cmp, ref);
  });

  test('la cuenta: diferencia por litro × litros comprados', () => {
    // 1,05 − 0,89 = 0,16 €/l · 6 unidades de 1 L = 6 l · 0,16 × 6 = 0,96 €
    expect(ah.porUnidad).toBeCloseTo(0.16, 6);
    expect(ah.enEstaCompra).toBeCloseTo(0.96, 6);
    expect(ah.donde).toBe('Mercadona');
    expect(ah.registros).toBe(1);
    expect(ah.metrica).toBe('€/l');
  });

  test('cuenta los litros de verdad, no las unidades', () => {
    // 12 botellas de 500 ml son 6 litros: el mismo ahorro que 6 de 1 L.
    const r = desc(ctx, it('Leche semidesnatada', { size: 500, sizeUnit: 'ml', qty: 12, unitPrice: 0.525 }),
      { merchantKey: 'carrefour', merchantLabel: 'Carrefour' });
    const c = get(ctx, 'pcCompareProduct')(r);
    const a = get(ctx, 'pcAhorroHistorico')(c, r);
    // 0,525 / 0,5 = 1,05 €/l → misma diferencia, mismos 6 litros.
    expect(a.enEstaCompra).toBeCloseTo(0.96, 6);
  });

  test('si aquí fue el más barato, NO se inventa un ahorro', () => {
    const r = desc(ctx, it('Leche semidesnatada', { size: 1, sizeUnit: 'l', qty: 6, unitPrice: 0.89 }),
      { merchantKey: 'mercadona', merchantLabel: 'Mercadona' });
    const c = get(ctx, 'pcCompareProduct')(r);
    expect(get(ctx, 'pcAhorroHistorico')(c, r)).toBeNull();
  });

  test('sin comparación válida no hay ahorro', () => {
    expect(get(ctx, 'pcAhorroHistorico')(null, ref)).toBeNull();
    expect(get(ctx, 'pcAhorroHistorico')({ comparacionValida: false }, ref)).toBeNull();
  });
});

/* ═══ 8. Cadencia ══════════════════════════════════════════════ */

describe('Cadencia — medida con las fechas, no deducida de la categoría', () => {
  let cad;
  beforeEach(() => { cad = get(load([]), 'pcDetectaCadencia'); });

  const mensuales = n => Array.from({ length: n }, (_, i) =>
    ({ date: new Date(Date.UTC(2026, 4 + i, 8)).toISOString().slice(0, 10) }));

  test('seis cobros el día 8 de cada mes son mensuales', () => {
    const c = cad(mensuales(6));
    expect(c.id).toBe('mensual');
    expect(c.label).toBe('€/mes');
    // 08/05 → 08/10 son 153 días en 5 intervalos: 30,6 de media.
    expect(c.mediaDias).toBeCloseTo(30.6, 1);
  });

  test('cobros anuales', () => {
    const c = cad([{ date: '2024-03-01' }, { date: '2025-03-01' }, { date: '2026-03-01' }]);
    expect(c.id).toBe('anual');
    expect(c.label).toBe('€/año');
  });

  test('trimestrales y semanales también', () => {
    expect(cad([{ date: '2026-01-10' }, { date: '2026-04-10' }, { date: '2026-07-10' }]).id).toBe('trimestral');
    expect(cad([{ date: '2026-01-05' }, { date: '2026-01-12' }, { date: '2026-01-19' }]).id).toBe('semanal');
  });

  test('compras irregulares NO son una cadencia', () => {
    // Un restaurante al que se va cuando apetece no es una suscripción.
    expect(cad([{ date: '2026-01-03' }, { date: '2026-02-19' }, { date: '2026-02-24' }, { date: '2026-08-01' }])).toBeNull();
  });

  test('con menos de tres fechas no se afirma ninguna cadencia', () => {
    expect(cad([{ date: '2026-01-08' }, { date: '2026-02-08' }])).toBeNull();
    expect(cad([])).toBeNull();
  });

  test('un intervalo que no cae en ningún rango conocido devuelve null', () => {
    // Cada ~60 días: no es mensual ni trimestral, y no se fuerza a ninguno.
    expect(cad([{ date: '2026-01-01' }, { date: '2026-03-02' }, { date: '2026-05-01' }])).toBeNull();
  });
});

/* ═══ 9. Servicios, por sectores ═══════════════════════════════ */

describe('Servicios sin líneas de ticket — comparación por importe', () => {
  /** n cobros del mismo proveedor, el mismo día de n meses seguidos. */
  const serie = (nombre, importe, cat, n, dia) => Array.from({ length: n }, (_, i) =>
    tx(nombre, importe, new Date(Date.UTC(2026, 3 + i, dia)).toISOString().slice(0, 10), cat));

  test('suscripciones: €/mes, porque las fechas lo demuestran', () => {
    const T = [...serie('Netflix', 13.99, 'Suscripciones', 6, 8),
               ...serie('Spotify', 10.99, 'Suscripciones', 6, 15),
               ...serie('HBO Max', 9.99, 'Suscripciones', 6, 22)];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Suscripciones', T[0], 'netflix');
    expect(srv.metrica).toBe('€/mes');
    expect(srv.alternativas).toHaveLength(3);
    expect(srv.barato.merchantLabel).toBe('HBO Max');
    expect(srv.caro.merchantLabel).toBe('Netflix');
    expect(srv.caro.medio - srv.barato.medio).toBeCloseTo(4, 6);   // 13,99 − 9,99
    expect(srv.fuente).toBe('importe-total');
  });

  test('seguros: dos pólizas anuales se comparan en €/año', () => {
    const T = [
      tx('Mapfre', 412, '2024-02-10', 'Seguros'), tx('Mapfre', 428, '2025-02-10', 'Seguros'), tx('Mapfre', 441, '2026-02-10', 'Seguros'),
      tx('Linea Directa', 318, '2024-06-01', 'Seguros'), tx('Linea Directa', 329, '2025-06-01', 'Seguros'), tx('Linea Directa', 340, '2026-06-01', 'Seguros'),
    ];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Seguros', T[2], 'mapfre');
    expect(srv.metrica).toBe('€/año');
    expect(srv.barato.merchantLabel).toBe('Linea Directa');
    // (318 + 329 + 340) / 3 = 329
    expect(srv.barato.medio).toBeCloseTo(329, 6);
    // (412 + 428 + 441) / 3 = 427
    expect(srv.caro.medio).toBeCloseTo(427, 6);
  });

  test('gimnasios: dos cuotas mensuales', () => {
    const T = [...serie('Basic Fit', 24.99, 'Salud', 5, 3), ...serie('Altafit', 19.99, 'Salud', 5, 10)];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Salud', T[0], 'basic fit');
    expect(srv.metrica).toBe('€/mes');
    expect(srv.barato.merchantLabel).toBe('Altafit');
  });

  test('restaurantes: sin cadencia, se compara por operación', () => {
    const T = [
      tx('Restaurante El Faro', 48, '2026-09-05', 'Restaurantes'),
      tx('Restaurante El Faro', 52, '2026-10-09', 'Restaurantes'),
      tx('Bar Manolo', 14.50, '2026-09-18', 'Restaurantes'),
      tx('Bar Manolo', 16, '2026-10-21', 'Restaurantes'),
    ];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Restaurantes', T[0], 'restaurante faro');
    // Ni mensual ni anual: no se finge un coste periódico.
    expect(srv.metrica).toBe('€/operación');
    expect(srv.barato.merchantLabel).toBe('Bar Manolo');
    expect(srv.barato.medio).toBeCloseTo(15.25, 6);   // (14,50 + 16) / 2
    expect(srv.caro.medio).toBeCloseTo(50, 6);        // (48 + 52) / 2
  });

  test('hoteles: se compara el importe, y se avisa de que no hay noches', () => {
    const T = [
      tx('Hotel Riu Palace', 410, '2026-07-10', 'Ocio'),
      tx('Hotel Riu Palace', 455, '2026-08-14', 'Ocio'),
      tx('Hotel Ibis Centro', 128, '2026-09-02', 'Ocio'),
    ];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Ocio', T[0], 'hotel riu');
    expect(srv.metrica).toBe('€/operación');
    // El dato es real; la equivalencia de lo contratado NO está verificada, y
    // el usuario tiene que saberlo.
    expect(srv.advertencia).toMatch(/no guarda las condiciones/i);
    expect(srv.advertencia).toMatch(/puede que no sean equivalentes/i);
  });

  test('transporte: dos compañías, por operación', () => {
    const T = [
      tx('Renfe', 42.50, '2026-05-10', 'Transporte'), tx('Renfe', 48, '2026-07-19', 'Transporte'),
      tx('Alsa', 21.90, '2026-06-03', 'Transporte'), tx('Alsa', 24.50, '2026-08-11', 'Transporte'),
    ];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Transporte', T[0], 'renfe');
    expect(srv.barato.merchantLabel).toBe('Alsa');
    expect(srv.barato.medio).toBeCloseTo(23.20, 6);   // (21,90 + 24,50) / 2
  });

  test('servicios profesionales: dos despachos', () => {
    const T = [
      tx('Gestoria Perez', 60, '2026-01-20', 'Otros gastos'), tx('Gestoria Perez', 60, '2026-04-20', 'Otros gastos'),
      tx('Asesoria Lopez', 45, '2026-02-15', 'Otros gastos'), tx('Asesoria Lopez', 50, '2026-05-15', 'Otros gastos'),
    ];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Otros gastos', T[0], 'gestoria perez');
    expect(srv.barato.merchantLabel).toBe('Asesoria Lopez');
    expect(srv.barato.medio).toBeCloseTo(47.50, 6);
  });

  test('con un solo proveedor devuelve null, no una comparación de uno', () => {
    const T = serie('Basic Fit', 24.99, 'Salud', 4, 3);
    const ctx = load(T);
    expect(get(ctx, 'pcCompareService')('Salud', T[0], 'basic fit')).toBeNull();
  });

  test('cadencias MEZCLADAS no se presentan como coste mensual', () => {
    // Uno mensual (12 €) y otro anual (120 €): compararlos como si fueran lo
    // mismo sería decir que el anual es diez veces más caro.
    const T = [
      ...serie('Mensual SA', 12, 'Suscripciones', 6, 8),
      tx('Anual SL', 120, '2024-03-01', 'Suscripciones'),
      tx('Anual SL', 125, '2025-03-01', 'Suscripciones'),
      tx('Anual SL', 130, '2026-03-01', 'Suscripciones'),
    ];
    const ctx = load(T);
    const srv = get(ctx, 'pcCompareService')('Suscripciones', T[0], 'mensual sa');
    expect(srv.metrica).toBe('€/operación');
    // Cada proveedor conserva su propia cadencia medida, para poder enseñarla.
    expect(srv.alternativas.find(a => a.merchantLabel === 'Mensual SA').cadencia.id).toBe('mensual');
    expect(srv.alternativas.find(a => a.merchantLabel === 'Anual SL').cadencia.id).toBe('anual');
  });

  test('sin categoría o sin transacción de referencia, null', () => {
    const ctx = load([]);
    expect(get(ctx, 'pcCompareService')(null, {}, 'x')).toBeNull();
    expect(get(ctx, 'pcCompareService')('Salud', null, 'x')).toBeNull();
  });
});

/* ═══ 10. Evolución del precio ═════════════════════════════════ */

describe('Evolución del precio de un producto', () => {
  const T = [
    tx('Mercadona', 20, '2026-08-05', 'Alimentación', [it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 0.89 })]),
    tx('Lidl', 15, '2026-09-14', 'Alimentación', [it('Leche semidesnatada', { size: 500, sizeUnit: 'ml', unitPrice: 0.49 })]),
    tx('Carrefour', 25, '2026-10-02', 'Alimentación', [it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 1.05 })]),
  ];
  let ctx, h;
  beforeEach(() => {
    ctx = load(T);
    const ref = desc(ctx, it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 1.05 }));
    h = get(ctx, 'pcPriceHistory')(ref);
  });

  test('una serie en orden, con el comercio de cada punto', () => {
    expect(h.suficiente).toBe(true);
    expect(h.puntos.map(p => p.date)).toEqual(['2026-08-05', '2026-09-14', '2026-10-02']);
    expect(h.puntos.map(p => p.merchantLabel)).toEqual(['Mercadona', 'Lidl', 'Carrefour']);
    expect(h.comercios).toEqual(['Mercadona', 'Lidl', 'Carrefour']);
  });

  test('las cuentas de la serie', () => {
    // 0,89 · 0,98 · 1,05 → media 0,97333…, variación (1,05 − 0,89) / 0,89
    expect(h.primero).toBeCloseTo(0.89, 6);
    expect(h.ultimo).toBeCloseTo(1.05, 6);
    expect(h.medio).toBeCloseTo((0.89 + 0.98 + 1.05) / 3, 6);
    expect(h.min).toBeCloseTo(0.89, 6);
    expect(h.max).toBeCloseTo(1.05, 6);
    expect(h.variacionPct).toBeCloseTo(17.977528, 4);
  });

  test('con un solo punto se dice que no es suficiente', () => {
    const solo = load([T[0]]);
    const ref = desc(solo, it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 0.89 }));
    const r = get(solo, 'pcPriceHistory')(ref);
    expect(r.suficiente).toBe(false);
    expect(r.puntos).toHaveLength(1);
    expect(r.variacionPct).toBeUndefined();
  });

  test('los parecidos no contaminan la serie', () => {
    const conEntera = [...T, tx('Alcampo', 18, '2026-10-20', 'Alimentación', [it('Leche entera', { size: 1, sizeUnit: 'l', unitPrice: 0.75 })])];
    const c2 = load(conEntera);
    const ref = desc(c2, it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 1.05 }));
    expect(get(c2, 'pcPriceHistory')(ref).puntos).toHaveLength(3);
  });
});

/* ═══ 11. Resumen para la ficha ════════════════════════════════ */

describe('Resumen de una transacción', () => {
  const T = [
    tx('Mercadona', 20, '2026-08-05', 'Alimentación', [
      it('Leche semidesnatada', { size: 1, sizeUnit: 'l', qty: 6, unitPrice: 0.89 }),
      it('Aceite de oliva', { size: 1, sizeUnit: 'l', unitPrice: 8.95 }),
    ]),
  ];
  const compra = tx('Carrefour', 25, '2026-10-02', 'Alimentación', [
    it('Leche semidesnatada', { size: 1, sizeUnit: 'l', qty: 6, unitPrice: 1.05 }),
    it('Aceite de oliva', { size: 1, sizeUnit: 'l', unitPrice: 9.80 }),
    it('Pollo entero', { unitPrice: 7.40 }),
    it('Bolsa reutilizable', {}),
  ]);

  test('una entrada por línea, y el ahorro sumado', () => {
    const ctx = load([...T, compra]);
    const s = get(ctx, 'pcSummaryForTx')(compra);
    expect(s.tipo).toBe('productos');
    expect(s.lineas).toHaveLength(4);
    // Comparables entre dos comercios: la leche y el aceite.
    expect(s.conComparacion).toBe(2);
    // leche (1,05 − 0,89) × 6 l = 0,96 · aceite (9,80 − 8,95) × 1 l = 0,85
    expect(s.ahorroTotal).toBeCloseTo(1.81, 6);
  });

  test('la línea sin precio se incluye, marcada como no comparable', () => {
    const ctx = load([...T, compra]);
    const s = get(ctx, 'pcSummaryForTx')(compra);
    const bolsa = s.lineas.find(l => l.desc.nombre === 'Bolsa reutilizable');
    expect(bolsa.desc.comparable).toBe(false);
    expect(bolsa.ahorro).toBeNull();
  });

  test('sin líneas cae a la comparación de servicio', () => {
    const a = tx('Netflix', 13.99, '2026-09-08', 'Suscripciones');
    const b = tx('Netflix', 13.99, '2026-10-08', 'Suscripciones');
    const c = tx('Netflix', 13.99, '2026-11-08', 'Suscripciones');
    const d = tx('Spotify', 10.99, '2026-09-15', 'Suscripciones');
    const e = tx('Spotify', 10.99, '2026-10-15', 'Suscripciones');
    const f = tx('Spotify', 10.99, '2026-11-15', 'Suscripciones');
    const ctx = load([a, b, c, d, e, f]);
    const s = get(ctx, 'pcSummaryForTx')(c);
    expect(s.tipo).toBe('servicio');
    expect(s.sinLineas).toBe(true);
    expect(s.servicio.metrica).toBe('€/mes');
  });

  test('si no hay nada con lo que comparar, el ahorro es null y no 0', () => {
    const sola = tx('Carrefour', 25, '2026-10-02', 'Alimentación', [it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 1.05 })]);
    const ctx = load([sola]);
    const s = get(ctx, 'pcSummaryForTx')(sola);
    expect(s.ahorroTotal).toBeNull();
    expect(s.conComparacion).toBe(0);
  });

  test('sin transacción no devuelve nada', () => {
    expect(get(load([]), 'pcSummaryForTx')(null)).toBeNull();
  });
});

/* ═══ 12. Dónde hay más diferencia ═════════════════════════════ */

describe('Mayores diferencias del historial', () => {
  const T = [
    tx('Mercadona', 20, '2026-08-05', 'Alimentación', [
      it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 0.89 }),
      it('Aceite de oliva', { size: 1, sizeUnit: 'l', unitPrice: 8.95 }),
    ]),
    tx('Carrefour', 25, '2026-10-02', 'Alimentación', [
      it('Leche semidesnatada', { size: 1, sizeUnit: 'l', unitPrice: 1.05 }),
      it('Aceite de oliva', { size: 1, sizeUnit: 'l', unitPrice: 9.80 }),
    ]),
    // Solo en un comercio: no puede entrar en la lista.
    tx('Carrefour', 25, '2026-10-02', 'Alimentación', [it('Pollo entero', { unitPrice: 7.40 })]),
  ];

  test('ordena por diferencia porcentual y excluye lo no comparable', () => {
    const top = get(load(T), 'pcTopAhorros')(10);
    expect(top).toHaveLength(2);
    // leche 0,16 / 0,89 = 17,98 % · aceite 0,85 / 8,95 = 9,50 %
    expect(top[0].pctDif).toBeCloseTo(17.977528, 4);
    expect(top[1].pctDif).toBeCloseTo(9.497207, 4);
    expect(top.some(t => t.ref.nombre === 'Pollo entero')).toBe(false);
  });

  test('respeta el límite', () => {
    expect(get(load(T), 'pcTopAhorros')(1)).toHaveLength(1);
  });

  test('cuenta cuántos precios sostienen cada fila', () => {
    const top = get(load(T), 'pcTopAhorros')(10);
    expect(top[0].registros).toBe(2);
    expect(top[0].nComercios).toBe(2);
  });

  test('un historial sin tickets devuelve lista vacía', () => {
    expect(get(load([tx('Bar Manolo', 12, '2026-09-20', 'Restaurantes')]), 'pcTopAhorros')(10)).toEqual([]);
  });
});

/* ═══ 13. Robustez ═════════════════════════════════════════════ */

describe('Datos imperfectos — nada de esto debe romper ni mentir', () => {
  test('items que no son un array', () => {
    const t = tx('Mercadona', 20, '2026-08-05', 'Alimentación');
    t.receipt = { merchant: 'Mercadona', items: 'no soy un array' };
    const ctx = load([t]);
    expect(get(ctx, 'pcIndex')().lineas).toBe(0);
    expect(get(ctx, 'pcSummaryForTx')(t).tipo).toBe('servicio');
  });

  test('líneas nulas dentro del array', () => {
    const t = tx('Mercadona', 20, '2026-08-05', 'Alimentación', [null, it('Leche 1 L', { unitPrice: 1 }), undefined]);
    expect(get(load([t]), 'pcIndex')().lineas).toBe(1);
  });

  test('precios y cantidades absurdos no producen comparaciones', () => {
    const t = tx('Mercadona', 20, '2026-08-05', 'Alimentación', [
      it('Leche 1 L', { unitPrice: 0 }),
      it('Pan 500 g', { unitPrice: -3 }),
      it('Arroz 1 kg', { qty: 0, total: 5 }),
    ]);
    const idx = get(load([t]), 'pcIndex')();
    expect(idx.conPrecio).toBe(0);
  });

  test('una unidad desconocida no se convierte a nada', () => {
    const ctx = load([]);
    // «oz» no está en la tabla de factores: se trata como producto por unidad
    // en vez de inventar un factor de conversión.
    const d = desc(ctx, it('Café', { size: 12, sizeUnit: 'oz', unitPrice: 6 }));
    expect(d.magnitud).toBe('unidad');
    expect(d.precioCanonico).toBeCloseTo(6, 6);
  });

  test('una transacción sin comercio identificable no entra en el índice', () => {
    // Sin descripción no hay clave de comercio, y un precio sin comercio no
    // responde a «¿dónde he pagado menos?».
    const t = tx('', 20, '2026-08-05', 'Alimentación', [it('Leche 1 L', { unitPrice: 1 })]);
    expect(get(load([t]), 'pcIndex')().lineas).toBe(0);
  });

  test('fechas ausentes no rompen la serie', () => {
    const a = tx('Mercadona', 20, '2026-08-05', 'Alimentación', [it('Leche 1 L', { unitPrice: 0.89 })]);
    const b = tx('Lidl', 15, '2026-09-05', 'Alimentación', [it('Leche 1 L', { unitPrice: 0.95 })]);
    delete b.date;
    const ctx = load([a, b]);
    expect(() => get(ctx, 'pcIndex')()).not.toThrow();
  });
});

/* ═══ 14. Rendimiento ══════════════════════════════════════════ */

describe('Rendimiento', () => {
  test('5.000 transacciones con ticket se indexan en un tiempo razonable', () => {
    const comercios = ['Mercadona', 'Lidl', 'Carrefour', 'Alcampo', 'Dia'];
    const productos = ['Leche semidesnatada', 'Pan de molde', 'Aceite de oliva', 'Arroz redondo', 'Pollo entero'];
    const T = [];
    for (let i = 0; i < 5000; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + (i % 700))).toISOString().slice(0, 10);
      T.push(tx(comercios[i % 5], 20 + (i % 40), d, 'Alimentación', [
        it(productos[i % 5], { size: 1, sizeUnit: 'l', qty: 1 + (i % 4), unitPrice: 0.8 + ((i % 30) / 100) }),
        it(productos[(i + 2) % 5], { size: 500, sizeUnit: 'g', unitPrice: 1.5 + ((i % 20) / 100) }),
      ]));
    }
    const ctx = load(T);
    const t0 = Date.now();
    const idx = get(ctx, 'pcIndex')();
    const ms = Date.now() - t0;
    expect(idx.lineas).toBe(10000);
    expect(ms).toBeLessThan(4000);
    // Y la segunda vez es gratis.
    const t1 = Date.now();
    get(ctx, 'pcIndex')();
    expect(Date.now() - t1).toBeLessThan(50);
  });
});
