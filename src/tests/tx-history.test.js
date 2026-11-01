/**
 * Finova — tx-history.test.js
 * Ficha de historial de una transacción.
 *
 * Dos cosas importan aquí por encima del resto:
 *
 *  1. Que NO se agrupen establecimientos distintos. Fundir «Farmacia López»
 *     con «Farmacia Ruiz» no es un detalle estético: le enseña al usuario
 *     estadísticas de un negocio en el que no ha estado.
 *  2. Que las cuentas cuadren. Los valores esperados de abajo están
 *     calculados a mano, no copiados de la salida de la implementación.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/utils/tx-history.js'), 'utf8');

/** Carga el módulo real en un contexto con los globales que usa. */
function load(transactions) {
  const ctx = vm.createContext({
    APP: { transactions: transactions || [], theme: 'dark' },
    UNCLASSIFIED_CATEGORY: 'Sin clasificar',
    formatCurrency: v => Number(v).toFixed(2) + ' €',
    formatDate: d => d,
    escapeHtml: s => String(s),
    // El helper real de utils.js: la ficha lo reutiliza para que los
    // porcentajes salgan igual que en el dashboard y en la cartera.
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
    console, Date, Math, Number, String, Array, Map, Set, Object, JSON, isNaN,
    setTimeout,
  });
  vm.runInContext(SRC, ctx);
  return ctx;
}
const get = (ctx, name) => vm.runInContext(name, ctx);

/** Atajo para fabricar transacciones de prueba. */
let _n = 0;
const tx = (o) => Object.assign({
  id: 't' + (++_n), type: 'expense', date: '2026-01-15',
  description: 'Compra', category: 'Alimentación', amount: 10, note: '', favorite: false,
}, o);

/* ═══ 1. Identidad del establecimiento ═════════════════════════ */

describe('Identidad del establecimiento — no agrupar lo que no es lo mismo', () => {
  let key;
  beforeEach(() => { key = get(load([]), 'mhMerchantKey'); });

  const k = d => key({ description: d }).key;

  test('las sucursales de una misma cadena SÍ se agrupan', () => {
    expect(k('MERCADONA GRAN VIA BCN')).toBe(k('MERCADONA CALLAO MAD'));
    expect(k('MERCADONA')).toBe(k('Mercadona S.A.'));
    expect(k('CARREFOUR EXPRESS')).toBe(k('CARREFOUR MARKET'));
    expect(k('COMPRA TPV DECATHLON 4411')).toBe(k('Decathlon Alcorcón'));
  });

  test('negocios DISTINTOS con el mismo tipo NO se agrupan', () => {
    // Esto es lo que txPatternKey hacía mal: 5 de estos 6 pares los fundía.
    const pares = [
      ['FARMACIA LOPEZ',       'FARMACIA RUIZ'],
      ['BAR MANOLO',           'BAR PEPE'],
      ['RESTAURANTE EL FARO',  'RESTAURANTE LA MINA'],
      ['PANADERIA SOL',        'PANADERIA LUNA'],
      ['GASOLINERA REPSOL A2', 'GASOLINERA CEPSA M30'],
      ['CLINICA DENTAL NORTE', 'CLINICA SAN JOSE'],
    ];
    for (const [a, b] of pares) {
      expect(k(a)).not.toBe(k(b));
    }
  });

  test('las marcas cortas no se parten por sucursal', () => {
    // Una regla de "5 letras o más" habría partido estas.
    expect(k('ZARA GRAN VIA')).toBe(k('ZARA CALLAO'));
    expect(k('DIA MADRID SUR')).toBe(k('Dia Retail'));
    expect(k('IKEA ENSANCHE')).toBe(k('IKEA Alcorcon'));
    expect(k('BP AUTOPISTA A6')).toBe(k('BP Las Rozas'));
  });

  test('ignora el ruido del extracto bancario', () => {
    expect(k('COMPRA TARJ. 1234 MERCADONA')).toBe(k('MERCADONA'));
    expect(k('PAGO TPV REDSYS LIDL CALLE MAYOR')).toBe(k('LIDL'));
    expect(k('RECIBO FACTURA VODAFONE ESPANA SA')).toBe(k('Vodafone'));
  });

  test('ignora sufijos societarios y acentos', () => {
    expect(k('Panadería Sol')).toBe(k('PANADERIA SOL SL'));
    expect(k('Óptica Vista')).toBe(k('OPTICA VISTA S.L.U.'));
  });

  test('un genérico sin nombre detrás se queda como está', () => {
    // «Farmacia» a secas: el sitio se llama así en el extracto y no hay más.
    expect(k('FARMACIA')).toBe('farmacia');
    expect(k('Farmacia')).toBe('farmacia');
  });

  test('prefiere el nombre del escáner al de la descripción', () => {
    const r = key({ description: 'COMPRA TPV 4411 ****', receipt: { merchant: 'Mercadona' } });
    expect(r.source).toBe('receipt');
    expect(r.key).toBe('mercadona');
  });

  test('una descripción vacía o solo ruido no revienta', () => {
    expect(key({ description: '' })).toBe(null);
    expect(key({ description: '   ' })).toBe(null);
    expect(key({ description: '1234 5678' })).toBeTruthy();  // cae al normalizado
    expect(key(null)).toBe(null);
  });

  test('los genéricos NUMERADOS no se funden', () => {
    // Encontrado probando: los números puros se descartaban siempre como
    // ruido de extracto, así que «HOTEL 4» y «HOTEL 55» daban la misma clave
    // — dos hoteles distintos con estadísticas fundidas. «PARKING 24H» se
    // salvaba de casualidad, porque «24h» es alfanumérico.
    expect(k('HOTEL 4')).not.toBe(k('HOTEL 55'));
    expect(k('BAR 100')).not.toBe(k('BAR 200'));
    expect(k('PARKING 24H')).not.toBe(k('PARKING 365'));
    // Pero el número de terminal NO debe separar sucursales de una marca.
    expect(k('MERCADONA 4411')).toBe(k('MERCADONA 9988'));
  });

  test('el prefijo TARJ/TARJETA del extracto no impide agrupar', () => {
    // Es una de las formas más habituales en los extractos españoles.
    expect(k('COMPRA TARJ. 1234 MERCADONA')).toBe(k('MERCADONA'));
    expect(k('PAGO TARJETA LIDL')).toBe(k('LIDL'));
  });

  test('NUNCA agrupa por parecido, solo por clave exacta', () => {
    // Sin coincidencia difusa: «Mercadona» y «Mercadina» son distintos.
    expect(k('MERCADONA')).not.toBe(k('MERCADINA'));
    expect(k('CARREFOUR')).not.toBe(k('CARREFUOR'));
  });
});

/* ═══ 2. Estadísticas ══════════════════════════════════════════ */

describe('Estadísticas del establecimiento', () => {
  // 4 compras: 20, 40, 60, 80 → total 200, media 50, max 80, min 20.
  const txs = [
    tx({ description: 'Mercadona', amount: 20, date: '2026-01-01' }),
    tx({ description: 'Mercadona', amount: 40, date: '2026-01-11' }),
    tx({ description: 'Mercadona', amount: 60, date: '2026-01-21' }),
    tx({ description: 'Mercadona', amount: 80, date: '2026-01-31' }),
  ];

  test('los totales, la media y los extremos cuadran', () => {
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    expect(st.n).toBe(4);
    expect(st.total).toBe(200);
    expect(st.media).toBe(50);
    expect(st.max).toBe(80);
    expect(st.min).toBe(20);
    expect(st.maxTx.amount).toBe(80);
    expect(st.minTx.amount).toBe(20);
  });

  test('la frecuencia se divide entre los INTERVALOS, no entre las compras', () => {
    // Del 1 al 31 de enero son 30 días y hay 3 intervalos → 10 días.
    // Dividir entre 4 daría 7,5, que es el error clásico.
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    expect(st.frecuencia).toBeCloseTo(10, 5);
  });

  test('con una sola compra no hay frecuencia (no un 0 engañoso)', () => {
    const uno = [tx({ description: 'Mercadona', amount: 30 })];
    const st = get(load(uno), 'mhStats')(uno, 'expense');
    expect(st.n).toBe(1);
    expect(st.frecuencia).toBe(null);
  });

  test('las DEVOLUCIONES no se suman al total gastado', () => {
    // Una devolución de Mercadona es un ingreso. Meterla en "total gastado"
    // daría un total menor que el real y una media falseada.
    const conDevolucion = [
      ...txs,
      tx({ description: 'Mercadona', amount: 15, type: 'income' }),
    ];
    const st = get(load(conDevolucion), 'mhStats')(conDevolucion, 'expense');
    expect(st.n).toBe(4);            // sigue contando 4 compras
    expect(st.total).toBe(200);      // y 200 €, no 215 ni 185
    expect(st.media).toBe(50);
    expect(st.otrasN).toBe(1);       // pero se informa de la devolución
    expect(st.otrasTotal).toBe(15);
  });

  test('sin movimientos del tipo pedido devuelve n:0, no un objeto a medias', () => {
    const soloIngresos = [tx({ description: 'Nomina', amount: 2000, type: 'income' })];
    const st = get(load(soloIngresos), 'mhStats')(soloIngresos, 'expense');
    expect(st.n).toBe(0);
    expect(st.otrasN).toBe(1);
  });
});

/* ═══ 3. Comparación ═══════════════════════════════════════════ */

describe('Comparación con compras anteriores', () => {
  test('el porcentaje frente a la media de las OTRAS compras', () => {
    // Otras: 20, 40, 60 → media 40. Actual 50 → +25 %.
    const txs = [
      tx({ id: 'a', description: 'Mercadona', amount: 20, date: '2026-01-01' }),
      tx({ id: 'b', description: 'Mercadona', amount: 40, date: '2026-01-10' }),
      tx({ id: 'c', description: 'Mercadona', amount: 60, date: '2026-01-20' }),
      tx({ id: 'd', description: 'Mercadona', amount: 50, date: '2026-01-30' }),
    ];
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    const c  = get(ctx, 'mhCompare')(txs[3], st);
    expect(c.mediaOtras).toBeCloseTo(40, 5);
    expect(c.pctMedia).toBeCloseTo(25, 5);
    expect(c.difMedia).toBeCloseTo(10, 5);
  });

  test('la "anterior" es la más reciente ANTES de esta, no la de la lista', () => {
    const txs = [
      tx({ id: 'a', description: 'Mercadona', amount: 20, date: '2026-01-01' }),
      tx({ id: 'b', description: 'Mercadona', amount: 90, date: '2026-01-20' }),
      tx({ id: 'c', description: 'Mercadona', amount: 50, date: '2026-01-30' }),
    ];
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    const c  = get(ctx, 'mhCompare')(txs[2], st);
    expect(c.anterior.id).toBe('b');
    expect(c.difAnterior).toBeCloseTo(-40, 5);
    expect(c.pctAnterior).toBeCloseTo(-44.444, 2);
  });

  test('con una sola compra NO se compara (null, no 0 %)', () => {
    const txs = [tx({ description: 'Mercadona', amount: 30 })];
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    expect(get(ctx, 'mhCompare')(txs[0], st)).toBe(null);
  });

  test('detecta máximo y mínimo', () => {
    const txs = [
      tx({ id: 'a', description: 'Mercadona', amount: 10, date: '2026-01-01' }),
      tx({ id: 'b', description: 'Mercadona', amount: 90, date: '2026-01-02' }),
    ];
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    expect(get(ctx, 'mhCompare')(txs[1], st).esMaximo).toBe(true);
    expect(get(ctx, 'mhCompare')(txs[0], st).esMinimo).toBe(true);
  });

  test('una media de 0 no produce Infinity ni NaN', () => {
    const txs = [
      tx({ id: 'a', description: 'Regalo', amount: 0, date: '2026-01-01' }),
      tx({ id: 'b', description: 'Regalo', amount: 5, date: '2026-01-02' }),
    ];
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    const c = get(ctx, 'mhCompare')(txs[1], st);
    expect(c.pctMedia).toBe(null);          // dividir entre 0 → null
    expect(Number.isNaN(c.difMedia)).toBe(false);
  });
});

/* ═══ 4. Series mensuales ══════════════════════════════════════ */

describe('Gasto por mes', () => {
  test('rellena con 0 los meses sin gasto', () => {
    // Sin esto, el gráfico uniría enero con marzo como si febrero no existiera.
    const hoy = new Date();
    const ym = (delta) => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - delta, 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    };
    const txs = [
      tx({ amount: 100, date: ym(2) + '-05' }),
      tx({ amount: 300, date: ym(0) + '-05' }),
    ];
    const meses = get(load(txs), 'mhPorMes')(txs, 'expense', 3);
    expect(meses).toHaveLength(3);
    expect(meses[0].total).toBe(100);
    expect(meses[1].total).toBe(0);     // el mes vacío está, con 0
    expect(meses[2].total).toBe(300);
  });

  test('no mezcla ingresos con gastos', () => {
    const hoy = new Date();
    const ym = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
    const txs = [
      tx({ amount: 100, date: ym + '-05', type: 'expense' }),
      tx({ amount: 900, date: ym + '-06', type: 'income' }),
    ];
    const meses = get(load(txs), 'mhPorMes')(txs, 'expense', 1);
    expect(meses[0].total).toBe(100);
  });
});

describe('Dónde más se gasta en una categoría', () => {
  test('agrupa por establecimiento y ordena por total', () => {
    const txs = [
      tx({ description: 'Mercadona', amount: 50 }),
      tx({ description: 'Mercadona centro', amount: 30 }),
      tx({ description: 'Lidl', amount: 100 }),
      tx({ description: 'Carrefour', amount: 10 }),
    ];
    const top = get(load(txs), 'mhTopMerchants')(txs, 'expense', 5);
    expect(top[0].total).toBe(100);           // Lidl
    expect(top[1].total).toBe(80);            // Mercadona: 50 + 30 agrupados
    expect(top[1].n).toBe(2);
    expect(top[2].total).toBe(10);
  });
});

/* ═══ 5. Productos ═════════════════════════════════════════════ */

describe('Clave de producto', () => {
  let pk;
  beforeEach(() => { pk = get(load([]), 'mhProductKey'); });
  const k = n => { const r = pk(n); return r && r.key; };

  test('el mismo producto con distinto formato de cantidad se agrupa', () => {
    expect(k('Leche semidesnatada 1L')).toBe(k('LECHE SEMIDESNATADA 1 L'));
    expect(k('Pan de molde 500g')).toBe(k('PAN DE MOLDE 500 G'));
    expect(k('Yogur natural x6')).toBe(k('YOGUR NATURAL X 6'));
  });

  test('productos DISTINTOS no se juntan', () => {
    expect(k('Leche entera 1L')).not.toBe(k('Leche semidesnatada 1L'));
    expect(k('Aceite de oliva')).not.toBe(k('Aceite de girasol'));
    expect(k('Pan integral')).not.toBe(k('Pan blanco'));
  });

  test('un nombre que solo son cifras o símbolos no da clave', () => {
    expect(pk('1 L')).toBe(null);
    expect(pk('---')).toBe(null);
    expect(pk('')).toBe(null);
  });
});

describe('Historial de precios de un producto', () => {
  test('usa unitPrice cuando está', () => {
    const e = [
      { date: '2026-01-01', unitPrice: 0.95, total: 1.9, qty: 2 },
      { date: '2026-01-10', unitPrice: 1.05, total: 1.05, qty: 1 },
    ];
    const st = get(load([]), 'mhProductStats')(e);
    expect(st.n).toBe(2);
    expect(st.ultimo).toBeCloseTo(1.05, 5);
    expect(st.medio).toBeCloseTo(1.00, 5);
    expect(st.min).toBeCloseTo(0.95, 5);
    expect(st.max).toBeCloseTo(1.05, 5);
  });

  test('si no hay unitPrice, lo deduce de total/qty', () => {
    const e = [{ date: '2026-01-01', unitPrice: null, total: 3.0, qty: 3 }];
    const st = get(load([]), 'mhProductStats')(e);
    expect(st.ultimo).toBeCloseTo(1.0, 5);
  });

  test('sin ningún precio lo dice, no inventa un 0', () => {
    const e = [{ date: '2026-01-01', unitPrice: null, total: null, qty: null }];
    const st = get(load([]), 'mhProductStats')(e);
    expect(st.sinPrecio).toBe(true);
    expect(st.medio).toBeUndefined();
  });
});

/* ═══ 6. El índice ═════════════════════════════════════════════ */

describe('Índice', () => {
  test('agrupa por establecimiento, categoría y producto en una pasada', () => {
    const txs = [
      tx({ description: 'Mercadona', amount: 50, category: 'Alimentación',
           receipt: { merchant: 'Mercadona', items: [{ name: 'Leche 1L', qty: 1, unitPrice: 1.05, total: 1.05 }] } }),
      tx({ description: 'Mercadona centro', amount: 30, category: 'Alimentación' }),
      tx({ description: 'Bar Pepe', amount: 12, category: 'Restaurantes' }),
    ];
    const ctx = load(txs);
    const idx = get(ctx, '_mhIndex')();
    expect(idx.byMerchant.get('mercadona').txs).toHaveLength(2);
    expect(idx.byCategory.get('Alimentación')).toHaveLength(2);
    expect(idx.byCategory.get('Restaurantes')).toHaveLength(1);
    expect(idx.products.size).toBe(1);
  });

  test('se memoiza mientras los datos no cambien', () => {
    const txs = [tx({ description: 'Mercadona', amount: 50 })];
    const ctx = load(txs);
    const a = get(ctx, '_mhIndex')();
    const b = get(ctx, '_mhIndex')();
    expect(a).toBe(b);                       // misma instancia: no recalculó
  });

  test('se invalida al cambiar un importe (no solo al añadir)', () => {
    // Editar un importe sin cambiar el número de transacciones tiene que
    // invalidar: si no, las estadísticas se quedan con el valor viejo.
    const txs = [tx({ description: 'Mercadona', amount: 50 })];
    const ctx = load(txs);
    const a = get(ctx, '_mhIndex')();
    vm.runInContext('APP.transactions[0].amount = 999;', ctx);
    const b = get(ctx, '_mhIndex')();
    expect(b).not.toBe(a);
    expect(get(ctx, '_mhIndex')().byMerchant.get('mercadona').txs[0].amount).toBe(999);
  });

  test('NO modifica las transacciones originales', () => {
    const txs = [
      tx({ description: 'B', amount: 2, date: '2026-02-01' }),
      tx({ description: 'A', amount: 1, date: '2026-01-01' }),
    ];
    const antes = JSON.stringify(txs);
    const ctx = load(txs);
    get(ctx, '_mhIndex')();
    // El índice ordena sus propias listas, no el array de APP.
    expect(JSON.stringify(vm.runInContext('APP.transactions', ctx))).toBe(antes);
  });

  test('una transacción sin fecha se ignora sin romper nada', () => {
    const txs = [tx({ description: 'Mercadona', amount: 10 }), { id: 'x', amount: 5 }];
    const ctx = load(txs);
    expect(() => get(ctx, '_mhIndex')()).not.toThrow();
    expect(get(ctx, '_mhIndex')().byMerchant.get('mercadona').txs).toHaveLength(1);
  });

  test('aguanta 5.000 transacciones en un tiempo razonable', () => {
    // La lista usa scroll virtual, así que puede haber muchas. El índice se
    // construye una vez y se memoiza, pero esa vez tiene que ser rápida.
    // Nombres realistas: con «Comercio 1», «Comercio 2»… los números se
    // descartan como ruido de extracto y las 5.000 colapsaban en UNA clave,
    // así que el test no medía nada.
    const NOMBRES = ['Mercadona', 'Lidl', 'Carrefour', 'Dia', 'Alcampo', 'Eroski',
                     'Zara', 'Decathlon', 'Ikea', 'Fnac', 'Primor', 'Druni'];
    const muchas = [];
    for (let i = 0; i < 5000; i++) {
      muchas.push(tx({
        description: NOMBRES[i % NOMBRES.length] + ' sucursal ' + (i % 7),
        amount: (i % 90) + 1,
        date: '2025-' + String((i % 12) + 1).padStart(2, '0') + '-' + String((i % 28) + 1).padStart(2, '0'),
        category: ['Alimentación', 'Transporte', 'Ocio'][i % 3],
      }));
    }
    const ctx = load(muchas);
    const t0 = Date.now();
    const idx = get(ctx, '_mhIndex')();
    const ms = Date.now() - t0;
    expect(idx.byMerchant.size).toBe(12);
    expect(ms).toBeLessThan(1500);
  });
});

/* ═══ 7. Patrones ══════════════════════════════════════════════ */

describe('Patrones — solo se afirma lo que se puede sostener', () => {
  test('con menos de 3 compras no se afirma nada', () => {
    const txs = [
      tx({ description: 'Mercadona', amount: 10, date: '2026-01-01' }),
      tx({ description: 'Mercadona', amount: 20, date: '2026-01-02' }),
    ];
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    expect(get(ctx, 'mhPatrones')(st, txs[1])).toEqual([]);
  });

  test('detecta el día de la semana cuando de verdad domina', () => {
    // Cinco lunes seguidos (2026-01-05 es lunes).
    const lunes = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02'];
    const txs = lunes.map((d, i) => tx({ description: 'Mercadona', amount: 10 + i, date: d }));
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    const ps = get(ctx, 'mhPatrones')(st, txs[4]);
    expect(ps.some(p => /lunes/.test(p.texto))).toBe(true);
  });

  test('NO afirma un día cuando están repartidos', () => {
    const fechas = ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-11', '2026-01-14', '2026-01-17'];
    const txs = fechas.map((d, i) => tx({ description: 'Mercadona', amount: 10 + i, date: d }));
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    const ps = get(ctx, 'mhPatrones')(st, txs[5]);
    const NOMBRES = /lunes|martes|miércoles|jueves|viernes|sábado|domingo/;
    expect(ps.filter(p => NOMBRES.test(p.texto))).toHaveLength(0);
  });

  test('avisa de las devoluciones y dice que no se cuentan', () => {
    const txs = [
      tx({ description: 'Zara', amount: 40, date: '2026-01-01' }),
      tx({ description: 'Zara', amount: 60, date: '2026-01-05' }),
      tx({ description: 'Zara', amount: 50, date: '2026-01-09' }),
      tx({ description: 'Zara', amount: 20, date: '2026-01-10', type: 'income' }),
    ];
    const ctx = load(txs);
    const st = get(ctx, 'mhStats')(txs, 'expense');
    const ps = get(ctx, 'mhPatrones')(st, txs[2]);
    expect(ps.some(p => /devoluciones/.test(p.texto))).toBe(true);
  });
});

/* ═══ 8. Textos relativos ══════════════════════════════════════ */

describe('mhHace', () => {
  let hace;
  beforeEach(() => { hace = get(load([]), 'mhHace'); });
  const diasAtras = n => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  test('hoy, ayer y días', () => {
    expect(hace(diasAtras(0))).toBe('hoy');
    expect(hace(diasAtras(1))).toBe('ayer');
    expect(hace(diasAtras(5))).toBe('hace 5 días');
  });

  test('pasa a meses y a años', () => {
    expect(hace(diasAtras(60))).toMatch(/hace 2 meses/);
    expect(hace(diasAtras(400))).toMatch(/año/);
  });

  test('una fecha inválida no produce "NaN"', () => {
    expect(hace('no-es-fecha')).toBe('—');
    expect(hace('')).toBe('—');
  });
});

/* ═══ 9. Honestidad ════════════════════════════════════════════ */

describe('No se inventa nada', () => {
  test('no hay datos de ejemplo ni importes escritos a mano', () => {
    // Nada de "Mercadona: 24 compras" de muestra en producción.
    expect(SRC).not.toMatch(/1\.284,50|53,52|87,30|18,40/);
    expect(SRC).not.toMatch(/DATOS_EJEMPLO|MOCK|FAKE|demoData/i);
  });

  test('no crea ni modifica transacciones', () => {
    // La ficha es de solo lectura: ni push, ni splice, ni saveData.
    expect(SRC).not.toMatch(/APP\.transactions\.(push|splice|pop|shift|unshift)/);
    expect(SRC).not.toMatch(/\bsaveData\s*\(/);
    expect(SRC).not.toMatch(/_txCreate|deleteTransaction/);
  });

  test('el módulo avisa cuando no hay datos en vez de rellenar', () => {
    expect(SRC).toMatch(/function _mhVacio/);
    // Los siete bloques tienen su camino de "no hay datos".
    expect((SRC.match(/_mhVacio\(/g) || []).length).toBeGreaterThanOrEqual(7);
  });

  test('dice explícitamente que no hay subcategorías', () => {
    // Finova no las tiene: ni en el modelo, ni en la UI, ni en el escáner.
    expect(SRC).toMatch(/no usa subcategorías|NO existen subcategorías/);
  });

  test('ni alert() ni console.log', () => {
    expect(SRC).not.toMatch(/\balert\s*\(/);
    expect(SRC).not.toMatch(/console\.log\s*\(/);
  });
});
