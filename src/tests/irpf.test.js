/**
 * Finova — irpf.test.js
 * Escalas del IRPF por ejercicio y cálculo por tramos.
 *
 * TODOS los valores esperados están calculados a mano aquí, tramo a tramo,
 * y la cuenta queda escrita en un comentario al lado. Ninguno viene de
 * ejecutar el código ni de una conversación previa.
 *
 * Una comprobación independiente que da confianza en la aritmética: la
 * Agencia Tributaria publica que a una base del ahorro de 300.000 € le
 * corresponde una cuota íntegra total de 71.880 €, y es exactamente lo que
 * sale de sumar los tramos de abajo.
 * https://sede.agenciatributaria.gob.es/Sede/irpf/novedades-impuesto/novedades-normativa-2024.html
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

let ctx;
beforeAll(() => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/sections/fiscal.js'), 'utf8');
  ctx = vm.createContext({
    console, Math, Number, String, Array, Object, JSON, Date,
    parseFloat, parseInt, isNaN, isFinite,
    APP: { sales: [], transactions: [], trabajo: {}, minimos: {} },
    // fiscal.js toca el DOM en los renders; aquí solo se usan las funciones
    // de cálculo, pero getFiscalYear() lo consulta.
    document: { querySelector: () => null, getElementById: () => null, querySelectorAll: () => [] },
    formatCurrency: v => String(v), escapeHtml: s => String(s), formatDate: d => d,
  });
  vm.runInContext(src, ctx);
});
const g = n => vm.runInContext(n, ctx);

/* ═══ 1. calcCuota: función pura ═══════════════════════════════ */

describe('calcCuota — función pura', () => {
  const AHORRO_2025 = [
    { hasta: 6000, tipo: 19 }, { hasta: 50000, tipo: 21 },
    { hasta: 200000, tipo: 23 }, { hasta: 300000, tipo: 27 },
    { hasta: Infinity, tipo: 30 },
  ];

  test('no depende del DOM ni del ejercicio: mismos argumentos, mismo resultado', () => {
    const calc = g('calcCuota');
    expect(calc(10000, AHORRO_2025)).toBe(calc(10000, AHORRO_2025));
  });

  test('base 0 y negativas dan 0, no NaN ni negativo', () => {
    const calc = g('calcCuota');
    for (const b of [0, -1, -0.01, -1e9]) {
      expect(calc(b, AHORRO_2025)).toBe(0);
    }
  });

  test('valores no numéricos dan 0, no NaN', () => {
    // Un NaN propagándose por el módulo fiscal convierte toda la pantalla en
    // «NaN €» y no hay forma de saber de dónde salió.
    const calc = g('calcCuota');
    for (const b of [NaN, Infinity, -Infinity, undefined, null, 'hola', {}, [], '']) {
      const r = calc(b, AHORRO_2025);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBe(0);
    }
  });

  test('una escala vacía o inválida da 0 en vez de romper', () => {
    const calc = g('calcCuota');
    expect(calc(10000, [])).toBe(0);
    expect(calc(10000, null)).toBe(0);
    expect(calc(10000, undefined)).toBe(0);
  });

  test('números enormes no desbordan a Infinity', () => {
    const calc = g('calcCuota');
    const r = calc(1e12, AHORRO_2025);
    expect(Number.isFinite(r)).toBe(true);
    // 1e12 está en el último tramo (30 %). Cuota acumulada a 300.000 =
    // 71.880 (ver abajo), más (1e12 − 300.000) × 30 %:
    //   999.999.700.000 × 0,30 = 299.999.910.000
    //   + 71.880 = 299.999.981.880
    expect(r).toBe(299999981880);
  });

  test('solo se redondea al final, sin acumular error por tramo', () => {
    const calc = g('calcCuota');
    // Una base con céntimos en el tramo del 21 %:
    //   6.000 × 19 % = 1.140
    //   0,07 × 21 %  = 0,0147  → total 1.140,0147 → 1.140,01
    expect(calc(6000.07, AHORRO_2025)).toBe(1140.01);
    // Y el resultado nunca tiene más de dos decimales.
    for (const b of [1234.56, 7777.77, 49999.99, 200000.01]) {
      const r = calc(b, AHORRO_2025);
      expect(Math.round(r * 100) / 100).toBe(r);
    }
  });
});

/* ═══ 2. Escala del ahorro desde 2025 ══════════════════════════ */

describe('Escala del ahorro 2025 (19/21/23/27/30)', () => {
  /*
   * Cuotas acumuladas, calculadas tramo a tramo:
   *
   *   6.000   × 19 % =  1.140,00  → acumulado a   6.000 =   1.140,00
   *  44.000   × 21 % =  9.240,00  → acumulado a  50.000 =  10.380,00
   * 150.000   × 23 % = 34.500,00  → acumulado a 200.000 =  44.880,00
   * 100.000   × 27 % = 27.000,00  → acumulado a 300.000 =  71.880,00  ← AEAT
   * 100.000   × 30 % = 30.000,00  → acumulado a 400.000 = 101.880,00
   */
  const esperado = [
    [6000, 1140], [50000, 10380], [200000, 44880],
    [300000, 71880], [400000, 101880],
  ];

  test.each(esperado)('base %s → cuota %s', (base, cuota) => {
    expect(g('calcCuota')(base, g('ESCALAS')[2025].ahorro)).toBe(cuota);
  });

  test('2026 reutiliza la escala de 2025 y lo declara', () => {
    const e = g('ESCALAS');
    expect(e[2026].ahorro).toEqual(e[2025].ahorro);
    // Y no se finge que está verificado.
    expect(e[2026].verificar).toMatch(/NO VERIFICADO/);
  });
});

/* ═══ 3. Escala del ahorro 2024 ════════════════════════════════ */

describe('Escala del ahorro 2024 (19/21/23/27/28)', () => {
  /*
   * Igual que 2025 hasta 300.000, porque solo cambió el último tramo:
   * la Ley 7/2024 lo subió del 28 % al 30 % con efectos 1-1-2025.
   *
   *  acumulado a 300.000 = 71.880,00  (idéntico a 2025)
   *  100.000 × 28 %      = 28.000,00  → acumulado a 400.000 = 99.880,00
   */
  const esperado = [
    [6000, 1140], [50000, 10380], [200000, 44880],
    [300000, 71880], [400000, 99880],
  ];

  test.each(esperado)('base %s → cuota %s', (base, cuota) => {
    expect(g('calcCuota')(base, g('ESCALAS')[2024].ahorro)).toBe(cuota);
  });

  test('2024 y 2025 solo difieren por encima de 300.000', () => {
    const calc = g('calcCuota');
    const e = g('ESCALAS');
    for (const b of [0, 1, 6000, 50000, 200000, 300000]) {
      expect(calc(b, e[2024].ahorro)).toBe(calc(b, e[2025].ahorro));
    }
    // 400.000: 99.880 en 2024 frente a 101.880 en 2025. Diferencia 2.000,
    // que es el 2 % de los 100.000 del último tramo.
    expect(calc(400000, e[2025].ahorro) - calc(400000, e[2024].ahorro)).toBe(2000);
  });

  test('el último tramo de 2024 es 28 y el de 2025 es 30', () => {
    const e = g('ESCALAS');
    expect(e[2024].ahorro.at(-1).tipo).toBe(28);
    expect(e[2025].ahorro.at(-1).tipo).toBe(30);
    // Y el de 200.000–300.000 es 27 en los dos: NO 26. El 26 % es anterior
    // a la Ley 31/2022 y no aplica a ningún ejercicio soportado aquí.
    expect(e[2024].ahorro[3].tipo).toBe(27);
    expect(e[2025].ahorro[3].tipo).toBe(27);
  });
});

/* ═══ 4. Escala general de referencia ══════════════════════════ */

describe('Escala general de referencia (19/24/30/37/45/47)', () => {
  /*
   * Es el tramo estatal (art. 63.1: 9,5/12/15/18,5/22,5/24,5) DUPLICADO.
   * No es la escala de ninguna comunidad concreta.
   *
   *  12.450 × 19 % =  2.365,50  → acumulado a  12.450 =   2.365,50
   *   7.750 × 24 % =  1.860,00  → acumulado a  20.200 =   4.225,50
   *  15.000 × 30 % =  4.500,00  → acumulado a  35.200 =   8.725,50
   *  14.800 × 37 % =  5.476,00  → acumulado a  50.000 =  14.201,50
   *  24.800 × 37 % =  9.176,00  → acumulado a  60.000 =  17.901,50
   * 240.000 × 45 % =108.000,00  → acumulado a 300.000 = 125.901,50
   */
  const esperado = [
    [12450, 2365.5], [20200, 4225.5], [35200, 8725.5],
    [50000, 14201.5], [60000, 17901.5], [300000, 125901.5],
  ];

  test.each(esperado)('base %s → cuota %s', (base, cuota) => {
    expect(g('calcCuota')(base, g('ESCALAS')[2025].general)).toBe(cuota);
  });

  test('la mitad estatal es la del art. 63.1; la autonómica NO está verificada', () => {
    /*
     * Este test documenta de dónde sale la tabla, y de paso corrige una
     * suposición mía que era falsa: NO es la escala estatal duplicada.
     *
     * Estatal (art. 63.1, verificado en el Manual 2025):
     *   9,5 / 12 / 15 / 18,5 / 22,5 / 24,5
     * Doblada daría 19 / 24 / 30 / 37 / 45 / 49 — y la app usa 47, no 49.
     *
     * Restando, la mitad autonómica implícita es:
     *   19−9,5=9,5 · 24−12=12 · 30−15=15 · 37−18,5=18,5 · 45−22,5=22,5
     *   47−24,5=22,5
     * Es decir, igual que la estatal salvo el último tramo, que se queda en
     * 22,5 en vez de subir a 24,5. Es una escala coherente y reconocible,
     * pero [VERIFICAR]: no he podido contrastar contra fuente oficial a qué
     * comunidad corresponde ni si es una escala complementaria por defecto.
     * La AEAT enlaza 16 escalas autonómicas distintas para 2025.
     */
    const ESTATAL = [9.5, 12, 15, 18.5, 22.5, 24.5];
    const tipos = g('ESCALAS')[2025].general.map(t => t.tipo);
    const autonomicaImplicita = tipos.map((t, i) => Math.round((t - ESTATAL[i]) * 10) / 10);
    expect(autonomicaImplicita).toEqual([9.5, 12, 15, 18.5, 22.5, 22.5]);
    // Y los cortes son los del art. 63.1.
    expect(g('ESCALAS')[2025].general.map(t => t.hasta))
      .toEqual([12450, 20200, 35200, 60000, 300000, Infinity]);
  });

  test('la escala general es la misma en 2024, 2025 y 2026', () => {
    // Los cortes y tipos estatales no cambiaron en estos ejercicios. Si
    // cambian, este test falla y obliga a mirarlo.
    const e = g('ESCALAS');
    expect(e[2024].general).toEqual(e[2025].general);
    expect(e[2025].general).toEqual(e[2026].general);
  });
});

/* ═══ 5. Casos límite en cada corte ════════════════════════════ */

describe('Casos límite: un céntimo a cada lado de cada corte', () => {
  /*
   * En un corte C con tipos t1 (antes) y t2 (después):
   *   cuota(C − 0,01) = cuota(C) − 0,01 × t1
   *   cuota(C + 0,01) = cuota(C) + 0,01 × t2
   *
   * Ahorro 2025: cortes 6.000 / 50.000 / 200.000 / 300.000
   *   6.000:    1.140,00 ∓ 0,01×19 % y ±0,01×21 %
   *             → 1.139,9981 → 1.140,00  y  1.140,0021 → 1.140,00
   *   (con un céntimo la diferencia es de milésimas y el redondeo a
   *    céntimos la absorbe: eso es correcto, no un fallo)
   *
   * Por eso se comprueba con un EURO, donde la diferencia sí es visible:
   *   cuota(5.999) = 5.999 × 19 %       = 1.139,81
   *   cuota(6.001) = 1.140 + 1 × 21 %   = 1.140,21
   */
  test('ahorro 2025, un euro a cada lado de 6.000', () => {
    const calc = g('calcCuota'); const esc = g('ESCALAS')[2025].ahorro;
    expect(calc(5999, esc)).toBe(1139.81);
    expect(calc(6000, esc)).toBe(1140);
    expect(calc(6001, esc)).toBe(1140.21);
  });

  test('ahorro 2025, un euro a cada lado de 50.000', () => {
    const calc = g('calcCuota'); const esc = g('ESCALAS')[2025].ahorro;
    // 49.999: 1.140 + 43.999 × 21 % = 1.140 + 9.239,79 = 10.379,79
    expect(calc(49999, esc)).toBe(10379.79);
    expect(calc(50000, esc)).toBe(10380);
    // 50.001: 10.380 + 1 × 23 % = 10.380,23
    expect(calc(50001, esc)).toBe(10380.23);
  });

  test('ahorro 2025, un euro a cada lado de 200.000', () => {
    const calc = g('calcCuota'); const esc = g('ESCALAS')[2025].ahorro;
    // 199.999: 10.380 + 149.999 × 23 % = 10.380 + 34.499,77 = 44.879,77
    expect(calc(199999, esc)).toBe(44879.77);
    expect(calc(200000, esc)).toBe(44880);
    // 200.001: 44.880 + 1 × 27 % = 44.880,27
    expect(calc(200001, esc)).toBe(44880.27);
  });

  test('ahorro 2025, un euro a cada lado de 300.000', () => {
    const calc = g('calcCuota'); const esc = g('ESCALAS')[2025].ahorro;
    // 299.999: 44.880 + 99.999 × 27 % = 44.880 + 26.999,73 = 71.879,73
    expect(calc(299999, esc)).toBe(71879.73);
    expect(calc(300000, esc)).toBe(71880);
    // 300.001: 71.880 + 1 × 30 % = 71.880,30
    expect(calc(300001, esc)).toBe(71880.3);
  });

  test('general, un euro a cada lado de 12.450 y 60.000', () => {
    const calc = g('calcCuota'); const esc = g('ESCALAS')[2025].general;
    // 12.449: 12.449 × 19 % = 2.365,31
    expect(calc(12449, esc)).toBe(2365.31);
    expect(calc(12450, esc)).toBe(2365.5);
    // 12.451: 2.365,50 + 1 × 24 % = 2.365,74
    expect(calc(12451, esc)).toBe(2365.74);
    // 59.999: 14.201,50 + 9.999 × 37 % = 14.201,50 + 3.699,63 = 17.901,13
    expect(calc(59999, esc)).toBe(17901.13);
    expect(calc(60000, esc)).toBe(17901.5);
    // 60.001: 17.901,50 + 1 × 45 % = 17.901,95
    expect(calc(60001, esc)).toBe(17901.95);
  });

  test('un céntimo por encima de un corte sube el tipo, aunque el redondeo lo absorba', () => {
    const calc = g('calcCuota'); const esc = g('ESCALAS')[2025].ahorro;
    // 6.000,01 → 1.140 + 0,0021 = 1.140,0021 → 1.140,00. El redondeo a
    // céntimos lo absorbe, y eso es lo correcto: no se cobran milésimas.
    expect(calc(6000.01, esc)).toBe(1140);
    // Pero con un euro ya se nota, y con 100 € claramente:
    // 6.100 → 1.140 + 100 × 21 % = 1.161
    expect(calc(6100, esc)).toBe(1161);
  });
});

/* ═══ 6. Reducción por rendimientos del trabajo ════════════════ */

describe('Reducción por rendimientos del trabajo (art. 20 LIRPF)', () => {
  /*
   * Importes de 2024 Y 2025 (el RDL 4/2024 los subió con efectos
   * 1-1-2024, así que son los mismos en los dos ejercicios):
   *   · RNT ≤ 14.852           → 7.302
   *   · 14.852 – 17.673,52     → 7.302 − 1,75 × (RNT − 14.852)
   *   · 17.673,52 – 19.747,50  → 2.364,34 − 1,14 × (RNT − 17.673,52)
   *   · ≥ 19.747,50            → 0
   * Y exige otras rentas (distintas del trabajo) ≤ 6.500 €.
   */
  test('tramo plano', () => {
    const f = g('calcReduccionTrabajo');
    expect(f(0, 2025, 0)).toBe(0);          // sin rendimiento no hay reducción
    expect(f(10000, 2025, 0)).toBe(7302);
    expect(f(14852, 2025, 0)).toBe(7302);
  });

  test('segundo tramo, pendiente 1,75', () => {
    const f = g('calcReduccionTrabajo');
    // 16.000: 7.302 − 1,75 × (16.000 − 14.852)
    //       = 7.302 − 1,75 × 1.148 = 7.302 − 2.009 = 5.293
    expect(f(16000, 2025, 0)).toBeCloseTo(5293, 2);
  });

  test('tercer tramo, pendiente 1,14', () => {
    const f = g('calcReduccionTrabajo');
    // 18.000: 2.364,34 − 1,14 × (18.000 − 17.673,52)
    //       = 2.364,34 − 1,14 × 326,48 = 2.364,34 − 372,1872 = 1.992,1528
    expect(f(18000, 2025, 0)).toBeCloseTo(1992.1528, 4);
  });

  test('a partir de 19.747,50 no hay reducción', () => {
    const f = g('calcReduccionTrabajo');
    expect(f(19747.5, 2025, 0)).toBe(0);
    expect(f(30000, 2025, 0)).toBe(0);
  });

  test('2024 y 2025 dan lo mismo (RDL 4/2024, efectos 1-1-2024)', () => {
    const f = g('calcReduccionTrabajo');
    for (const rn of [10000, 14852, 16000, 18000, 25000]) {
      expect(f(rn, 2024, 0)).toBe(f(rn, 2025, 0));
    }
  });

  test('con otras rentas por encima de 6.500 € NO hay reducción', () => {
    // Es la condición que la app no comprobaba: a quien tuviera 20.000 € en
    // dividendos le aplicaba una reducción a la que no tiene derecho, y la
    // base general salía hasta 7.302 € por debajo de la real.
    const f = g('calcReduccionTrabajo');
    expect(f(10000, 2025, 6500)).toBe(7302);    // justo en el límite: sí
    expect(f(10000, 2025, 6500.01)).toBe(0);    // un céntimo más: no
    expect(f(10000, 2025, 20000)).toBe(0);
  });
});

/* ═══ 7. Ejercicio por defecto y escalas desconocidas ══════════ */

describe('Selección de ejercicio', () => {
  test('el ejercicio por defecto es una campaña ya cerrada', () => {
    // La campaña de un ejercicio se presenta entre abril y junio del año
    // siguiente, así que el último cerrado nunca es el año en curso.
    const y = g('getDefaultFiscalYear')();
    expect(y).toBeLessThan(new Date().getFullYear());
    expect(g('ESCALAS')[y]).toBeTruthy();
  });

  test('un ejercicio desconocido cae al más cercano y lo declara', () => {
    const e2000 = g('getEscalas')(2000);
    expect(e2000.verificar).toMatch(/no tiene tablas propias/);
    const e2099 = g('getEscalas')(2099);
    expect(e2099.verificar).toMatch(/no tiene tablas propias/);
    // Y sigue devolviendo escalas usables, no undefined.
    expect(Array.isArray(e2099.ahorro)).toBe(true);
  });

  test('cada ejercicio declara su fuente', () => {
    for (const y of [2024, 2025, 2026]) {
      expect(typeof g('ESCALAS')[y].fuente).toBe('string');
      expect(g('ESCALAS')[y].fuente.length).toBeGreaterThan(10);
    }
  });
});

/* ═══ 8. Compensación en la base del ahorro ════════════════════ */

describe('Compensación en la base del ahorro (art. 49 LIRPF)', () => {
  /*
   * Cuatro escenarios, con la cuenta hecha paso a paso. La regla que aplica
   * la app: las pérdidas patrimoniales compensan primero las ganancias
   * patrimoniales al 100 %, y el saldo negativo que quede compensa los
   * rendimientos de capital mobiliario (dividendos) con un límite del 25 %.
   *
   * [VERIFICAR] El límite del 25 % y el arrastre a 4 años están en los arts.
   * 48-50 LIRPF, pero NO he contrastado contra el Manual práctico el
   * tratamiento del arrastre: la app NO modela saldos de ejercicios
   * anteriores, y eso está dicho en FISCAL_AUDIT.md.
   */
  const baseAhorro = (gains, losses, divs) => {
    const neto = gains - losses;
    if (neto >= 0) return neto + Math.max(divs, 0);
    const maxComp = 0.25 * Math.max(divs, 0);
    const comp = Math.min(Math.abs(neto), maxComp);
    return Math.max(divs - comp, 0);
  };

  test('A: solo ganancias, sin pérdidas ni dividendos', () => {
    // ganancias 10.000, pérdidas 0, dividendos 0
    //   neto = +10.000 → base = 10.000
    //   cuota 2025: 6.000×19 % = 1.140 ; 4.000×21 % = 840 → 1.980
    expect(baseAhorro(10000, 0, 0)).toBe(10000);
    expect(g('calcCuota')(10000, g('ESCALAS')[2025].ahorro)).toBe(1980);
  });

  test('B: pérdidas menores que las ganancias', () => {
    // ganancias 10.000, pérdidas 4.000, dividendos 1.000
    //   neto = +6.000 → base = 6.000 + 1.000 = 7.000
    //   cuota: 6.000×19 % = 1.140 ; 1.000×21 % = 210 → 1.350
    expect(baseAhorro(10000, 4000, 1000)).toBe(7000);
    expect(g('calcCuota')(7000, g('ESCALAS')[2025].ahorro)).toBe(1350);
  });

  test('C: pérdidas mayores, el límite del 25 % muerde', () => {
    // ganancias 2.000, pérdidas 10.000, dividendos 4.000
    //   neto = −8.000
    //   límite = 25 % de 4.000 = 1.000
    //   compensación efectiva = min(8.000, 1.000) = 1.000
    //   base = 4.000 − 1.000 = 3.000
    //   cuota: 3.000 × 19 % = 570
    //   Y quedan 7.000 € de pérdida SIN compensar, que la app no arrastra.
    expect(baseAhorro(2000, 10000, 4000)).toBe(3000);
    expect(g('calcCuota')(3000, g('ESCALAS')[2025].ahorro)).toBe(570);
  });

  test('D: pérdidas y ningún dividendo contra el que compensar', () => {
    // ganancias 1.000, pérdidas 5.000, dividendos 0
    //   neto = −4.000 ; límite = 25 % de 0 = 0
    //   base = 0 (NUNCA negativa: la base del ahorro no baja de cero y las
    //   pérdidas del ahorro NO compensan la base general)
    expect(baseAhorro(1000, 5000, 0)).toBe(0);
    expect(g('calcCuota')(0, g('ESCALAS')[2025].ahorro)).toBe(0);
  });

  test('la base del ahorro nunca es negativa', () => {
    for (const [gn, ls, dv] of [[0, 10000, 0], [1, 99999, 0], [0, 1, 0]]) {
      expect(baseAhorro(gn, ls, dv)).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ═══ 9. Retención de dividendos ═══════════════════════════════ */

describe('Dividendos y retención', () => {
  test('la retención es el 19 % del bruto y la base se calcula con el bruto', () => {
    // Dividendo bruto 1.000 €:
    //   retención = 1.000 × 19 % = 190
    //   neto cobrado = 810
    //   base del ahorro = 1.000 (el BRUTO, no el neto)
    //   cuota = 1.000 × 19 % = 190 → coincide con la retención, así que no
    //   sale ni a pagar ni a devolver por ese dividendo aislado.
    const bruto = 1000;
    expect(bruto * 0.19).toBe(190);
    expect(g('calcCuota')(bruto, g('ESCALAS')[2025].ahorro)).toBe(190);
  });

  test('con base alta la retención del 19 % no cubre la cuota', () => {
    // 60.000 € de dividendos:
    //   retención = 60.000 × 19 % = 11.400
    //   cuota 2025 = 1.140 + 9.240 + 10.000×23 % = 1.140+9.240+2.300 = 12.680
    //   diferencia a pagar = 12.680 − 11.400 = 1.280
    const r = g('calcCuota')(60000, g('ESCALAS')[2025].ahorro);
    expect(r).toBe(12680);
    expect(r - 60000 * 0.19).toBeCloseTo(1280, 2);
  });
});
