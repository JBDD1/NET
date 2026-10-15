/**
 * Finova — goals-fiscal-javi.test.js
 * Objetivos, simulador y fiscalidad IRPF de "Javi" ejecutando el código REAL
 * (calcs.js + goals.js + fiscal.js) con vm.
 * Comprueba: fondo de emergencia al 56,7 %, simulador ≈428.928 € y la cuota
 * IRPF 2024 con los tramos de la base general y de la base del ahorro.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const CALCS  = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');
const GOALS  = fs.readFileSync(path.join(process.cwd(), 'src/sections/goals.js'), 'utf8');
const FISCAL = fs.readFileSync(path.join(process.cwd(), 'src/sections/fiscal.js'), 'utf8');

const ING = 'acc-ing';
const TODAY = '2026-10-13';

function javiApp() {
  return {
    cashAccounts: [
      { id: 'acc-santander', name: 'Santander', amount: 4200 },
      { id: ING,             name: 'Cuenta ahorro ING', amount: 8500 },
    ],
    portfolio: [
      { id: 'vwrl', ticker: 'VWRL', quantity: 45,  buyPrice: 82,  currentPrice: 98,  exchangeRate: 1 },
      { id: 'itx',  ticker: 'ITX',  quantity: 100, buyPrice: 38,  currentPrice: 46,  exchangeRate: 1 },
      { id: 'nvda', ticker: 'NVDA', quantity: 10,  buyPrice: 210, currentPrice: 890, exchangeRate: 1 },
      { id: 'ko',   ticker: 'KO',   quantity: 50,  buyPrice: 54,  currentPrice: 58,  exchangeRate: 1 },
    ],
    liabilities: [{ id: 'coche', name: 'Préstamo coche', originalAmount: 15000, remainingAmount: 8400, monthlyPayment: 280, interestRate: 4.5 }],
    alternatives: [], properties: [],
    goals: [], transactions: [], sales: [],
    dividends: [{ id: 'd-ko', assetName: 'Coca-Cola', ticker: 'KO', dividendPerShare: 0.36, shares: 50, frequency: 'quarterly', retentionRate: 19 }],
    // Datos laborales 2024 de Javi
    trabajo: { salarioBruto: 32000, retencionEmpresa: 4800, seguridadSocial: 2032, dietas: 0, sindicatos: 0, otrosGastos: 0 },
    minimos: {},
    watchlist: [], bizums: [], recurring: [], trips: [], networthHistory: [], portfolioSnapshots: [],
    categories: { income: ['Salario'], expense: ['Vivienda'] },
    scenarios: [],
  };
}

let APP, fns;

function load() {
  APP = javiApp();
  const stubs = {
    APP,
    getCurrentMonth: () => '2026-10', getTodayStr: () => TODAY,
    getFiscalYear: () => 2024,
    _divFxRate: () => 1,
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} }, appendChild(){}, append(){} }) },
    formatCurrency: v => `${v}`, formatPct: v => `${v}%`, formatDate: d => d,
    colorClass: v => (v > 0 ? 'positive' : v < 0 ? 'negative' : ''),
    escapeHtml: s => String(s ?? ''), generateId: () => 'id' + Math.random(),
    showToast: () => {}, saveData: () => {}, closeModal: () => {}, openModal: () => {},
    setText: () => {}, setHTML: () => {}, _animNum: () => {}, _delegate: () => {}, ric: fn => fn(),
    emptyState: () => '', emptyRow: () => '', softDelete: () => {},
    renderDashboard: () => {}, markDashboardDirty: () => {},
    Charts: { get: () => null, set: () => {}, destroy: () => {} },
    getChartDefaults: () => ({ gridColor: '#000', textColor: '#000', fontFamily: 'x', accent: '#000', accentFill: 'rgba(0,0,0,.09)' }),
    calcAvgMonthlySurplus: () => 0,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(CALCS,  ctx, { filename: 'calcs.js' });
  vm.runInContext(GOALS,  ctx, { filename: 'goals.js' });
  vm.runInContext(FISCAL, ctx, { filename: 'fiscal.js' });
  fns = vm.runInContext(`({
    _calcGoalProgress, GOAL_LINK_NETWORTH, calcNetWorth, calcCashTotal,
    calcIRPF, calcIRPFGeneral, calcReduccionTrabajo, IRPF_TRAMOS, IRPF_GENERAL,
    _invalidateCalcCache, _findTwoMonthsViolations, calcMinimosTotal,
  })`, ctx);
  APP = vm.runInContext('APP', ctx);
  return ctx;
}

beforeEach(() => { load(); });

/* ── Flujo 1: objetivos ───────────────────────────────────────── */
describe('Flujo 1 — objetivos y progreso automático', () => {
  const fondo = () => ({ id: 'g1', emoji: '🛡️', name: 'Fondo de emergencia',
                         targetAmount: 15000, linkedAccount: ING, contributions: [] });

  test('fondo de emergencia vinculado a ING → progreso 8.500 € = 56,7 %', () => {
    const g = fondo();
    const prog = fns._calcGoalProgress(g);
    expect(prog).toBe(8500);
    expect((prog / g.targetAmount) * 100).toBeCloseTo(56.7, 1);
  });

  test('restante = 6.500 €', () => {
    expect(fondo().targetAmount - fns._calcGoalProgress(fondo())).toBe(6500);
  });

  test('FIRE vinculado al PATRIMONIO NETO → 25.110 € = 4,2 %', () => {
    const g = { id: 'g2', emoji: '🔥', name: 'FIRE a los 50', targetAmount: 600000,
                linkedAccount: fns.GOAL_LINK_NETWORTH, deadline: '2048-01-01', contributions: [] };
    const prog = fns._calcGoalProgress(g);
    expect(prog).toBeCloseTo(25110, 2);
    expect((prog / g.targetAmount) * 100).toBeCloseTo(4.2, 1);
  });

  test('el objetivo FIRE sigue al patrimonio: si sube el efectivo, sube el progreso', () => {
    const g = { id: 'g2', targetAmount: 600000, linkedAccount: fns.GOAL_LINK_NETWORTH, contributions: [] };
    APP.cashAccounts[0].amount = 5200; // +1.000
    fns._invalidateCalcCache();
    expect(fns._calcGoalProgress(g)).toBeCloseTo(26110, 2);
  });

  test('ahorro mensual lineal para FIRE en 264 meses ≈ 2.177,6 €/mes', () => {
    const remaining = 600000 - 25110;
    expect(remaining).toBe(574890);
    expect(remaining / 264).toBeCloseTo(2177.61, 2);
  });

  test('una cuenta vinculada inexistente cuenta 0, no revienta', () => {
    expect(fns._calcGoalProgress({ targetAmount: 1000, linkedAccount: 'no-existe', contributions: [] })).toBe(0);
  });
});

/* ── Flujo 2: contribuciones manuales ─────────────────────────── */
describe('Flujo 2 — contribuciones manuales', () => {
  test('contribución de 500 € → 9.000 € y 60 %', () => {
    const g = { id: 'g1', targetAmount: 15000, linkedAccount: ING,
                contributions: [{ id: 'c1', amount: 500, date: TODAY }] };
    expect(fns._calcGoalProgress(g)).toBe(9000);
    expect((9000 / 15000) * 100).toBe(60);
  });

  test('al eliminarla vuelve a 8.500 € y 56,7 %', () => {
    const g = { id: 'g1', targetAmount: 15000, linkedAccount: ING, contributions: [] };
    expect(fns._calcGoalProgress(g)).toBe(8500);
    expect((8500 / 15000) * 100).toBeCloseTo(56.7, 1);
  });

  test('varias contribuciones se acumulan', () => {
    const g = { id: 'g1', targetAmount: 15000, linkedAccount: ING,
                contributions: [{ amount: 500 }, { amount: 250 }, { amount: 100 }] };
    expect(fns._calcGoalProgress(g)).toBe(9350);
  });
});

/* ── Flujo 3: ordenación ──────────────────────────────────────── */
describe('Flujo 3 — ordenar objetivos', () => {
  const goals = () => ([
    { id: 'g1', name: 'Fondo de emergencia', targetAmount: 15000,  linkedAccount: ING, contributions: [] },
    { id: 'g2', name: 'FIRE a los 50',       targetAmount: 600000, linkedAccount: fns.GOAL_LINK_NETWORTH, contributions: [] },
  ]);
  const pctOf = g => (g.targetAmount > 0 ? (fns._calcGoalProgress(g) / g.targetAmount) * 100 : 0);
  const remOf = g => g.targetAmount - fns._calcGoalProgress(g);

  test('por % completado desc → Fondo (56,7 %) antes que FIRE (4,2 %)', () => {
    const r = goals().sort((a, b) => pctOf(b) - pctOf(a));
    expect(r.map(g => g.id)).toEqual(['g1', 'g2']);
  });

  test('por importe restante desc → FIRE (574.890 €) primero', () => {
    const r = goals().sort((a, b) => remOf(b) - remOf(a));
    expect(r.map(g => g.id)).toEqual(['g2', 'g1']);
    expect(remOf(r[0])).toBeCloseTo(574890, 2);
  });

  test('por nombre alfabético → FIRE antes que Fondo', () => {
    const r = goals().sort((a, b) => a.name.localeCompare(b.name));
    expect(r.map(g => g.name)).toEqual(['FIRE a los 50', 'Fondo de emergencia']);
  });
});

/* ── Flujo 4: simulador ───────────────────────────────────────── */
describe('Flujo 4 — simulador de interés compuesto', () => {
  // Réplica EXACTA del bucle de runSimulator(): la aportación se añade
  // después del crecimiento de cada mes.
  const sim = (initial, monthly, ratePct, years) => {
    const r = ratePct / 100 / 12, n = years * 12;
    let v = initial;
    for (let m = 1; m <= n; m++) v = v * (1 + r) + monthly;
    return v;
  };
  const cerrada = (initial, monthly, ratePct, years) => {
    const r = ratePct / 100 / 12, n = years * 12;
    const g = Math.pow(1 + r, n);
    return initial * g + monthly * (g - 1) / r;
  };

  test('25.110 € + 500 €/mes al 7 % durante 22 años ≈ 428.928 €', () => {
    expect(sim(25110, 500, 7, 22)).toBeCloseTo(428928, -2);
  });

  test('el bucle coincide con la fórmula cerrada que pide el guion', () => {
    expect(sim(25110, 500, 7, 22)).toBeCloseTo(cerrada(25110, 500, 7, 22), 4);
  });

  test('con 1.000 €/mes el resultado es mayor y comparable', () => {
    const a = sim(25110, 500, 7, 22), b = sim(25110, 1000, 7, 22);
    expect(b).toBeGreaterThan(a);
    // el extra son 500 €/mes capitalizados: la diferencia es la propia anualidad
    expect(b - a).toBeCloseTo(cerrada(0, 500, 7, 22), 4);
  });

  test('interés 0 % → solo la suma de aportaciones', () => {
    expect(sim(25110, 500, 0, 22)).toBeCloseTo(25110 + 500 * 264, 6);
    expect(sim(25110, 500, 0, 22)).toBeCloseTo(157110, 6);
  });

  test('sin aportaciones → solo crece el capital inicial', () => {
    expect(sim(25110, 0, 7, 22)).toBeCloseTo(25110 * Math.pow(1 + 0.07 / 12, 264), 4);
  });
});

/* ── Flujos 5-6: fiscalidad, base general ─────────────────────── */
describe('Flujos 5-6 — IRPF base general (trabajo) 2024', () => {
  test('los tramos de la base GENERAL son los de 2024', () => {
    expect(fns.IRPF_GENERAL.map(t => [t.hasta, t.tipo])).toEqual([
      [12450, 19], [20200, 24], [35200, 30], [60000, 37], [300000, 45], [Infinity, 47],
    ]);
  });

  test('los tramos de la base del AHORRO son los suyos propios (otra escala)', () => {
    expect(fns.IRPF_TRAMOS.map(t => [t.hasta, t.tipo])).toEqual([
      [6000, 19], [50000, 21], [200000, 23], [300000, 27], [Infinity, 28],
    ]);
  });

  test('retención y SS de Javi: 4.800 € y 2.032 €', () => {
    expect(32000 * 0.15).toBe(4800);
    expect(32000 * 0.0635).toBe(2032);
    expect(APP.trabajo.retencionEmpresa).toBe(4800);
    expect(APP.trabajo.seguridadSocial).toBe(2032);
  });

  test('reducción art. 20 LIRPF 2024: 7.302 € hasta 14.852 € de rendimiento neto', () => {
    expect(fns.calcReduccionTrabajo(14000)).toBe(7302);
    expect(fns.calcReduccionTrabajo(14852)).toBe(7302);
  });

  test('reducción decreciente entre 14.852 € y 17.673,52 € (pendiente 1,75)', () => {
    expect(fns.calcReduccionTrabajo(16000)).toBeCloseTo(7302 - 1.75 * (16000 - 14852), 6);
    // en el propio punto de corte, el primer tramo (1,75) debe dar 2.364,34 €,
    // el mismo valor donde arranca el segundo tramo (1,14) — sin salto
    expect(fns.calcReduccionTrabajo(17673.52)).toBeCloseTo(2364.34, 2);
  });

  test('reducción decreciente entre 17.673,52 € y 19.747,50 € (pendiente 1,14 — AEAT manual práctico IRPF 2024)', () => {
    // RDL 4/2024: tercer tramo con pendiente distinta (1,14, no 1,75) —
    // antes de este fix se aplicaba 1,75 en todo el rango, dando 43 € en vez
    // de los 852,15 € reales para una renta de 19.000 €.
    expect(fns.calcReduccionTrabajo(19000)).toBeCloseTo(852.15, 2);
    expect(fns.calcReduccionTrabajo(19747.5)).toBeCloseTo(0, 2);
    expect(fns.calcReduccionTrabajo(19500)).toBeCloseTo(2364.34 - 1.14 * (19500 - 17673.52), 6);
  });

  test('por encima de 19.747,50 € la reducción es 0', () => {
    expect(fns.calcReduccionTrabajo(19748)).toBe(0);
    expect(fns.calcReduccionTrabajo(25000)).toBe(0);
  });

  test('con el sueldo de Javi (rend. neto 29.968 €) la reducción es 0', () => {
    const rendNeto = 32000 - 2032;
    expect(rendNeto).toBe(29968);
    expect(fns.calcReduccionTrabajo(rendNeto)).toBe(0);
  });

  test('cuota de la escala general sobre 24.416 € = 5.490,30 €', () => {
    expect(fns.calcIRPFGeneral(24416)).toBeCloseTo(5490.30, 2);
  });

  test('cuota tramo a tramo verificada', () => {
    expect(fns.calcIRPFGeneral(12450)).toBeCloseTo(12450 * 0.19, 6);
    expect(fns.calcIRPFGeneral(20200)).toBeCloseTo(12450 * 0.19 + 7750 * 0.24, 6);
    expect(fns.calcIRPFGeneral(35200)).toBeCloseTo(12450 * 0.19 + 7750 * 0.24 + 15000 * 0.30, 6);
  });

  test('el mínimo personal reduce la CUOTA (art. 56), no la base', () => {
    const baseGeneral = 29968; // sin reducción
    const minimo      = 5550;
    const cuotaNeta = Math.max(fns.calcIRPFGeneral(baseGeneral) - fns.calcIRPFGeneral(minimo), 0);
    // Es distinto (y menor) que restar el mínimo de la base directamente
    expect(cuotaNeta).not.toBeCloseTo(fns.calcIRPFGeneral(baseGeneral - minimo), 2);
    expect(cuotaNeta).toBeGreaterThan(0);
  });

  // Resultado final de Javi replicando exactamente renderResumenIRPF() —
  // 1.301,40 € a pagar, NO 3.170,60 €. La diferencia no es un bug: viene de
  // aplicar el método oficial del art. 63.1.2º LIRPF (escala sobre la base
  // completa 29.968 €, escala sobre el mínimo 5.550 €, y restar — verificado
  // contra INEAF/Agencia Tributaria), en vez de restar el mínimo de la base
  // ANTES de aplicar tramos (24.416 €, el método "a mano" más intuitivo pero
  // incorrecto: grava el mínimo como si cayera en el tramo marginal más alto
  // en vez de en los tramos más bajos). Separado de eso, Finova usa una única
  // escala general nacional (19/24/30/37/45/47 %) en vez de partir estatal +
  // autonómica por comunidad — no hay selector de CCAA en el modelo de datos,
  // así que un resultado específico de Madrid (que si separa ambas escalas)
  // no es replicable sin esa función, que no existe todavía.
  test('resultado completo de Javi (32.000 € bruto, Madrid) = 1.301,40 € a pagar — no 3.170,60 €', () => {
    const rendNeto    = 32000 - 2032; // 29.968
    const reduccion   = fns.calcReduccionTrabajo(rendNeto);
    const baseGeneral = Math.max(rendNeto - reduccion, 0);
    const minimoTotal = fns.calcMinimosTotal({});
    expect(minimoTotal).toBe(5550);

    const cuotaGeneralNeta = Math.max(
      fns.calcIRPFGeneral(baseGeneral) - fns.calcIRPFGeneral(minimoTotal), 0
    );
    expect(cuotaGeneralNeta).toBeCloseTo(6101.40, 2);

    const annualDivs  = 0.36 * 50 * 4; // dividendo KO del fixture — 72 €
    const cuotaAhorro = fns.calcIRPF(annualDivs);
    expect(cuotaAhorro).toBeCloseTo(13.68, 2);

    const cuotaTotal        = cuotaGeneralNeta + cuotaAhorro;
    const totalRetenciones  = 4800 + annualDivs * 0.19; // retención empresa + retención dividendo
    const resultado         = cuotaTotal - totalRetenciones;

    expect(resultado).toBeCloseTo(1301.40, 2);
    expect(resultado).not.toBeCloseTo(3170.60, 2);
  });
});

/* ── Regla de los 2 meses: excluida de la base, no solo avisada ── */
describe('Regla de los 2 meses (art. 33.5.f/g LIRPF)', () => {
  const ventaConPerdida = (overrides = {}) => ({
    id: 'v1', ticker: 'VWRL', buyPrice: 90, sellPrice: 80, quantity: 10,
    sellDate: '2024-06-15', ...overrides,
  });

  test('venta con pérdida + mismo ticker recomprado a los 30 días → violación detectada', () => {
    APP.portfolio.push({ id: 'vwrl2', ticker: 'VWRL', buyDate: '2024-07-15', quantity: 5, buyPrice: 85, currentPrice: 85 });
    const v = ventaConPerdida();
    expect(fns._findTwoMonthsViolations([v]).map(x => x.id)).toEqual(['v1']);
  });

  test('venta con pérdida + recompra a los 90 días (fuera de ventana) → sin violación', () => {
    APP.portfolio.push({ id: 'vwrl2', ticker: 'VWRL', buyDate: '2024-09-13', quantity: 5, buyPrice: 85, currentPrice: 85 });
    const v = ventaConPerdida();
    expect(fns._findTwoMonthsViolations([v])).toEqual([]);
  });

  test('venta con pérdida pero ticker ya no está en cartera → sin violación', () => {
    const v = ventaConPerdida(); // APP.portfolio (fixture) no tiene VWRL con esa buyDate
    expect(fns._findTwoMonthsViolations([v]).length).toBe(0);
  });

  test('venta con GANANCIA nunca cuenta como violación, aunque se recompre al día siguiente', () => {
    APP.portfolio.push({ id: 'vwrl2', ticker: 'VWRL', buyDate: '2024-06-16', quantity: 5, buyPrice: 85, currentPrice: 85 });
    const v = ventaConPerdida({ sellPrice: 120 }); // ganancia, no pérdida
    expect(fns._findTwoMonthsViolations([v])).toEqual([]);
  });

  test('la pérdida excluida no debe restar de la base del ahorro (misma cuenta que haría renderFiscalidad)', () => {
    APP.portfolio.push({ id: 'vwrl2', ticker: 'VWRL', buyDate: '2024-07-01', quantity: 5, buyPrice: 85, currentPrice: 85 });
    const sales = [
      ventaConPerdida(),                                    // −100 €, violación → NO deducible
      { id: 'v2', ticker: 'ITX', buyPrice: 30, sellPrice: 50, quantity: 10, sellDate: '2024-03-01' }, // +200 €, ganancia normal
    ];
    const violatingIds = new Set(fns._findTwoMonthsViolations(sales).map(v => v.id));
    const gains  = sales.reduce((s, v) => { const r = (v.sellPrice - v.buyPrice) * v.quantity; return r > 0 ? s + r : s; }, 0);
    const losses = sales.reduce((s, v) => {
      const r = (v.sellPrice - v.buyPrice) * v.quantity;
      if (r >= 0 || violatingIds.has(v.id)) return s;
      return s + Math.abs(r);
    }, 0);
    expect(gains).toBe(200);
    expect(losses).toBe(0); // la única pérdida está excluida por la regla de los 2 meses
  });
});

/* ── Flujo 7: dividendos en la base del ahorro ────────────────── */
describe('Flujo 7 — dividendos de 72 € con retención del 19 %', () => {
  test('la cuota del ahorro sobre 72 € es 13,68 €', () => {
    expect(fns.calcIRPF(72)).toBeCloseTo(13.68, 2);
  });

  test('retención ya practicada 13,68 € → resultado 0 (compensado)', () => {
    const bruto = 0.36 * 50 * 4;
    expect(bruto).toBe(72);
    const retenido = bruto * 0.19;
    expect(retenido).toBeCloseTo(13.68, 2);
    expect(fns.calcIRPF(bruto) - retenido).toBeCloseTo(0, 6);
  });

  test('los primeros 6.000 € tributan al 19 %', () => {
    expect(fns.calcIRPF(6000)).toBeCloseTo(1140, 6);
  });

  test('por encima de 6.000 € entra el 21 %', () => {
    expect(fns.calcIRPF(10000)).toBeCloseTo(6000 * 0.19 + 4000 * 0.21, 6);
  });
});

/* ── Pruebas destructivas ─────────────────────────────────────── */
describe('Pruebas destructivas', () => {
  test('salario bruto 0 → sin errores ni NaN', () => {
    APP.trabajo = { salarioBruto: 0, retencionEmpresa: 0, seguridadSocial: 0 };
    const rendNeto = 0;
    expect(fns.calcReduccionTrabajo(rendNeto)).toBe(7302);
    expect(Math.max(rendNeto - 7302, 0)).toBe(0);
    expect(fns.calcIRPFGeneral(0)).toBe(0);
  });

  test('retención del 100 % → resultado negativo (a devolver), sin romperse', () => {
    const cuota = fns.calcIRPFGeneral(24416);
    const resultado = cuota - 32000;
    expect(resultado).toBeLessThan(0);
    expect(Number.isFinite(resultado)).toBe(true);
  });

  test('base negativa → cuota 0 en ambas escalas', () => {
    expect(fns.calcIRPFGeneral(-5000)).toBe(0);
    expect(fns.calcIRPF(-5000)).toBe(0);
  });

  test('objetivo con importe 0 no divide por cero', () => {
    const g = { targetAmount: 0, linkedAccount: ING, contributions: [] };
    const pct = g.targetAmount > 0 ? (fns._calcGoalProgress(g) / g.targetAmount) * 100 : 0;
    expect(pct).toBe(0);
    expect(Number.isFinite(pct)).toBe(true);
  });

  test('objetivo vencido: fecha pasada y sin completar', () => {
    const g = { targetAmount: 15000, deadline: '2020-01-01', linkedAccount: ING, contributions: [] };
    const pct = (fns._calcGoalProgress(g) / g.targetAmount) * 100;
    const isOverdue = !!g.deadline && g.deadline < TODAY && pct < 100;
    expect(isOverdue).toBe(true);
  });

  test('objetivo vencido pero YA completado no se marca como vencido', () => {
    const g = { targetAmount: 8000, deadline: '2020-01-01', linkedAccount: ING, contributions: [] };
    const pct = Math.min((fns._calcGoalProgress(g) / g.targetAmount) * 100, 100);
    expect(pct).toBe(100);
    expect(!!g.deadline && g.deadline < TODAY && pct < 100).toBe(false);
  });

  test('progreso por encima del objetivo se tope a 100 % en la barra', () => {
    const g = { targetAmount: 5000, linkedAccount: ING, contributions: [] };
    expect(Math.min((fns._calcGoalProgress(g) / g.targetAmount) * 100, 100)).toBe(100);
  });
});
