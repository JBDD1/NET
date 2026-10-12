/**
 * Finova — dashboard-javi.test.js
 * Escenario de usuario real ("Javi, 28, inversor en ETFs") sobre el código
 * REAL de calcs.js + dashboard.js cargado con vm. Verifica que los KPIs del
 * dashboard cuadran con los importes que el usuario ve en sus secciones:
 * patrimonio 25.110 €, balance +1.149 €, ahorro 49,1 %, dividendos 132 €.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const CALCS = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');
const DASH  = fs.readFileSync(path.join(process.cwd(), 'src/sections/dashboard.js'), 'utf8');

// Mes de los datos de prueba: octubre del año en curso.
const YEAR  = new Date().getFullYear();
const MONTH = `${YEAR}-10`;

function javiApp() {
  return {
    // Efectivo 12.700 € = Santander 4.200 + ING 8.500
    cashAccounts: [
      { id: 'c1', name: 'Santander', amount: 4200 },
      { id: 'c2', name: 'ING',       amount: 8500 },
    ],
    // Cartera: valor 20.810 €, coste 12.290 €, ganancia +8.520 €
    portfolio: [
      // coste 9.850 → valor 16.570 (+6.720)
      { id: 'p1', name: 'Vanguard FTSE All-World', ticker: 'VWCE',
        quantity: 100, buyPrice: 98.50, currentPrice: 165.70, exchangeRate: 1,
        buyDate: `${YEAR - 3}-05-10`, sector: 'ETF', country: 'Global' },
      // coste 2.440 → valor 4.240 (+1.800)
      { id: 'p2', name: 'iShares Core S&P 500', ticker: 'CSPX',
        quantity: 50, buyPrice: 48.80, currentPrice: 84.80, exchangeRate: 1,
        buyDate: `${YEAR - 2}-02-01`, sector: 'ETF', country: 'EEUU' },
    ],
    // Pasivo: préstamo coche 8.400 €
    liabilities: [
      { id: 'l1', name: 'Préstamo coche', type: 'loan',
        originalAmount: 14000, remainingAmount: 8400,
        monthlyPayment: 280, interestRate: 6.5 },
    ],
    alternatives: [],
    properties:   [],
    // Octubre: ingresos 2.339 €, gastos 1.190 €
    transactions: [
      { id: 't1', type: 'income',  date: `${MONTH}-25`, description: 'Nómina',      category: 'Salario',    amount: 2200 },
      { id: 't2', type: 'income',  date: `${MONTH}-14`, description: 'Freelance',   category: 'Freelance',  amount: 139 },
      { id: 't3', type: 'expense', date: `${MONTH}-01`, description: 'Alquiler',    category: 'Vivienda',   amount: 750 },
      { id: 't4', type: 'expense', date: `${MONTH}-06`, description: 'Compra',      category: 'Supermercado', amount: 198 },
      { id: 't5', type: 'expense', date: `${MONTH}-12`, description: 'Cena fuera',  category: 'Restaurantes', amount: 120 },
      { id: 't6', type: 'expense', date: `${MONTH}-18`, description: 'Gasolina',    category: 'Transporte', amount: 100 },
      { id: 't7', type: 'expense', date: `${MONTH}-21`, description: 'Farmacia',    category: 'Salud',      amount: 22 },
    ],
    // Dividendos: Coca-Cola 72 € + Inditex 60 € = 132 € anuales
    dividends: [
      { id: 'd1', assetName: 'Coca-Cola', ticker: 'KO',  dividendPerShare: 0.48, shares: 37.5, frequency: 'quarterly' },
      { id: 'd2', assetName: 'Inditex',   ticker: 'ITX', dividendPerShare: 1.50, shares: 40,   frequency: 'annual' },
    ],
    watchlist: [], bizums: [], goals: [], recurring: [], trips: [], sales: [],
    networthHistory: [], portfolioSnapshots: [], categories: { income: [], expense: [] },
    dashboardLayout: null, dashboardKpis: {},
  };
}

let APP, fns;

function load() {
  APP = javiApp();
  const stubs = {
    APP,
    getCurrentMonth: () => MONTH,
    getTodayStr:     () => `${MONTH}-28`,
    _divFxRate:      () => 1,
    formatCurrency:  v => `${v}`,
    formatPct:       v => `${v}%`,
    colorClass:      () => '',
    escapeHtml:      s => String(s ?? ''),
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    showToast: () => {}, saveData: () => {}, navigateTo: () => {},
    _animNum: () => {}, _drawSparkline: () => {}, _skelList: () => {}, ric: fn => fn(),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const context = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(CALCS, context, { filename: 'calcs.js' });
  vm.runInContext(DASH,  context, { filename: 'dashboard.js' });
  fns = vm.runInContext(`({
    calcNetWorth, calcCashTotal, calcPortfolioValue, calcLiabilitiesTotal,
    calcMonthlyIncome, calcMonthlyExpense, assetValue, assetCost,
    _dashCalcValues, getEffectiveDashLayout, _dashComputeReorder,
    _invalidateCalcCache, DASH_BLOCK_DEFS, _dashHasNoData,
    _sparkNetworthData, _sparkMonthlyData,
  })`, context);
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { load(); });

describe('Javi — importes de partida que el usuario ve en sus secciones', () => {
  test('efectivo = 12.700 € (Santander 4.200 + ING 8.500)', () => {
    expect(fns.calcCashTotal()).toBe(12700);
  });

  test('cartera: valor 20.810 €, coste 12.290 €, ganancia +8.520 €', () => {
    const value = fns.calcPortfolioValue();
    const cost  = APP.portfolio.reduce((s, a) => s + fns.assetCost(a), 0);
    expect(value).toBeCloseTo(20810, 2);
    expect(cost).toBeCloseTo(12290, 2);
    expect(value - cost).toBeCloseTo(8520, 2);
  });

  test('pasivos = 8.400 €', () => {
    expect(fns.calcLiabilitiesTotal()).toBe(8400);
  });

  test('octubre: ingresos 2.339 €, gastos 1.190 €', () => {
    expect(fns.calcMonthlyIncome(MONTH)).toBe(2339);
    expect(fns.calcMonthlyExpense(MONTH)).toBe(1190);
  });
});

describe('Javi — KPIs que calcula el dashboard', () => {
  test('PATRIMONIO NETO = 25.110 € (12.700 + 20.810 − 8.400)', () => {
    expect(fns.calcNetWorth()).toBeCloseTo(25110, 2);
  });

  test('_dashCalcValues() devuelve los mismos importes que las secciones', () => {
    const v = fns._dashCalcValues();
    expect(v.networth).toBeCloseTo(25110, 2);
    expect(v.cash).toBe(12700);
    expect(v.portfolio).toBeCloseTo(20810, 2);
    expect(v.income).toBe(2339);
    expect(v.expense).toBe(1190);
  });

  test('balance del mes = +1.149 € (2.339 − 1.190)', () => {
    expect(fns._dashCalcValues().balance).toBe(1149);
  });

  test('tasa de ahorro = 49,1 % (1.149 / 2.339 × 100)', () => {
    const rate = fns._dashCalcValues().savingsRate;
    expect(rate).toBeCloseTo(49.1, 1);
    expect(rate.toFixed(1)).toBe('49.1');
  });

  test('dividendos anuales = 132 € (Coca-Cola 72 + Inditex 60)', () => {
    expect(fns._dashCalcValues().annualDiv).toBeCloseTo(132, 2);
  });

  test('ganancia de cartera del KPI = +8.520 € y +69,3 %', () => {
    const v = fns._dashCalcValues();
    const gain = v.portfolio - v.portfolioCost;
    expect(gain).toBeCloseTo(8520, 2);
    expect((gain / v.portfolioCost) * 100).toBeCloseTo(69.3, 1);
  });

  test('el patrimonio se compone exactamente de sus partes (sin dobles conteos)', () => {
    const v = fns._dashCalcValues();
    expect(v.cash + v.portfolio - fns.calcLiabilitiesTotal()).toBeCloseTo(v.networth, 2);
  });
});

describe('Javi — donut de distribución: proporciones sobre el patrimonio neto', () => {
  test('efectivo 50,6 % / cartera 82,9 % / pasivos −33,5 % del patrimonio neto', () => {
    const nw = fns.calcNetWorth();
    expect((12700 / nw) * 100).toBeCloseTo(50.6, 1);
    expect((20810 / nw) * 100).toBeCloseTo(82.9, 1);
    expect((-8400 / nw) * 100).toBeCloseTo(-33.5, 1);
  });

  test('los pesos positivos sobre activos brutos suman 100 %', () => {
    const gross = 12700 + 20810;
    expect((12700 / gross) * 100 + (20810 / gross) * 100).toBeCloseTo(100, 6);
  });
});

describe('Javi — estado vacío: una cuenta con solo efectivo y deuda NO está vacía', () => {
  test('con cuentas de efectivo y pasivos pero sin transacciones ni cartera, el patrimonio no es 0', () => {
    APP.transactions = [];
    APP.portfolio    = [];
    fns._invalidateCalcCache();
    // 12.700 de efectivo − 8.400 de deuda = 4.300 € que el usuario YA registró
    expect(fns.calcNetWorth()).toBeCloseTo(4300, 2);
  });
});

describe('Pruebas destructivas — datos corruptos no deben envenenar los KPIs', () => {
  test('un precio corrupto NO convierte el patrimonio en NaN', () => {
    APP.portfolio[0].currentPrice = 'mil';   // string no numérico
    fns._invalidateCalcCache();
    const nw = fns.calcNetWorth();
    expect(Number.isFinite(nw)).toBe(true);
    // ese activo cuenta 0, el resto se sigue sumando bien
    expect(nw).toBeCloseTo(12700 + 4240 - 8400, 2);
  });

  test('una cantidad corrupta NO convierte la cartera en NaN', () => {
    APP.portfolio[0].quantity = undefined;
    fns._invalidateCalcCache();
    expect(Number.isFinite(fns.calcPortfolioValue())).toBe(true);
  });

  test('un importe guardado como string SUMA, no concatena', () => {
    APP.transactions.push({ id: 'tx-str', type: 'expense', date: `${MONTH}-27`, description: 'Corrupto', category: 'Otros', amount: '50' });
    const exp = fns.calcMonthlyExpense(MONTH);
    expect(typeof exp).toBe('number');
    expect(exp).toBe(1240); // 1.190 + 50, no "119050"
  });

  test('un importe no numérico se ignora en vez de romper el balance', () => {
    APP.transactions.push({ id: 'tx-bad', type: 'expense', date: `${MONTH}-27`, description: 'Basura', category: 'Otros', amount: 'abc' });
    const v = fns._dashCalcValues();
    expect(v.expense).toBe(1190);
    expect(v.balance).toBe(1149);
  });
});

describe('Estado vacío — solo cuando de verdad no hay nada', () => {
  test('cuenta recién creada sin ningún dato → pantalla de bienvenida', () => {
    ['transactions', 'portfolio', 'cashAccounts', 'liabilities', 'alternatives',
     'properties', 'goals', 'bizums', 'dividends', 'watchlist'].forEach(k => { APP[k] = []; });
    expect(fns._dashHasNoData()).toBe(true);
  });

  test('solo cuentas de efectivo y una deuda → NO es estado vacío (regresión)', () => {
    APP.transactions = [];
    APP.portfolio    = [];
    APP.dividends    = [];
    expect(fns._dashHasNoData()).toBe(false);
  });

  test('solo un objetivo creado → NO es estado vacío', () => {
    ['transactions', 'portfolio', 'cashAccounts', 'liabilities', 'alternatives',
     'properties', 'bizums', 'dividends', 'watchlist'].forEach(k => { APP[k] = []; });
    APP.goals = [{ id: 'g1', name: 'Fondo de emergencia', targetAmount: 6000 }];
    expect(fns._dashHasNoData()).toBe(false);
  });
});

describe('Sparklines — datos reales o nada, nunca inventados', () => {
  test('usuario nuevo con 1 solo mes de historial → sin sparkline (no se fabrica)', () => {
    APP.networthHistory = [{ date: MONTH, value: 25110 }];
    expect(fns._sparkNetworthData(7).length).toBeLessThan(2);
  });

  test('con 6 meses de historial real → 6 puntos y en orden', () => {
    APP.networthHistory = [
      { date: `${YEAR}-05`, value: 19000 }, { date: `${YEAR}-06`, value: 20100 },
      { date: `${YEAR}-07`, value: 21500 }, { date: `${YEAR}-08`, value: 22800 },
      { date: `${YEAR}-09`, value: 24000 }, { date: `${YEAR}-10`, value: 25110 },
    ];
    const pts = fns._sparkNetworthData(7);
    expect(pts).toEqual([19000, 20100, 21500, 22800, 24000, 25110]);
    expect(pts[pts.length - 1]).toBe(25110); // termina en el patrimonio actual
  });
});

describe('Javi — layout del dashboard', () => {
  test('sin configuración guardada, todos los widgets del catálogo son visibles', () => {
    const layout = fns.getEffectiveDashLayout();
    expect(layout).toHaveLength(fns.DASH_BLOCK_DEFS.length);
    expect(layout.every(b => b.visible)).toBe(true);
  });

  test('una configuración corrupta en localStorage no rompe el layout', () => {
    APP.dashboardLayout = [
      null,
      { id: 'widget-que-no-existe', visible: true, size: 'medium' },
      { id: 'dash-block-kpis', visible: true, size: 'tamaño-inválido' },
      { id: 'dash-block-kpis', visible: false, size: 'full' }, // duplicado
      'basura',
    ];
    const layout = fns.getEffectiveDashLayout();
    expect(layout.find(b => b.id === 'dash-block-kpis').size).toBe('full'); // cae al default
    expect(layout.find(b => b.id === 'widget-que-no-existe')).toBeUndefined();
    expect(layout).toHaveLength(fns.DASH_BLOCK_DEFS.length);
  });

  test('reordenar un widget respeta la posición pedida', () => {
    const ids = fns.DASH_BLOCK_DEFS.map(d => d.id);
    const moved = fns._dashComputeReorder(ids, ids[0], ids[3], false);
    expect(moved.indexOf(ids[0])).toBe(3);
    expect(moved).toHaveLength(ids.length);
  });
});
