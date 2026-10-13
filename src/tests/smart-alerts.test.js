/**
 * Finova — smart-alerts.test.js
 * calcAlerts() (src/sections/dashboard.js) cargado con vm sobre el código
 * REAL. Cubre específicamente lo que se tocó en esta sesión:
 *   - el falso positivo de la regla de los 2 meses (avisaba de CUALQUIER
 *     compra reciente, sin comprobar si había una venta con pérdidas real)
 *   - las dos alertas nuevas: Bizum pendiente y presupuesto "casi agotado"
 *   - que las alertas ya existentes (budget-over, saldo negativo) no se
 *     rompen con las nuevas comprobaciones añadidas en el mismo bloque
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const CALCS = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');
const DASH  = fs.readFileSync(path.join(process.cwd(), 'src/sections/dashboard.js'), 'utf8');

const YEAR  = new Date().getFullYear();
const MONTH = `${YEAR}-10`;
const TODAY = `${MONTH}-28`;

function baseApp() {
  return {
    portfolio: [], sales: [], bizums: [], budgets: [], goals: [], watchlist: [],
    recurring: [], transactions: [], customAlerts: [], dismissedAlerts: {},
    cashAccounts: [], liabilities: [], alternatives: [], properties: [],
    smartAlertsConfig: {}, categories: { income: [], expense: [] },
  };
}

let APP, fns, _lastContext;

function load() {
  APP = baseApp();
  const stubs = {
    APP,
    getCurrentMonth: () => MONTH,
    getTodayStr:     () => TODAY,
    _divFxRate:      () => 1,
    formatCurrency:  v => `€${v}`,
    formatPct:       v => `${v}%`,
    formatDate:      d => d,
    colorClass:      () => '',
    escapeHtml:      s => String(s ?? ''),
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    showToast: () => {}, saveData: () => {}, navigateTo: () => {},
    _animNum: () => {}, _drawSparkline: () => {}, _skelList: () => {}, ric: fn => fn(),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  // calcAlerts() usa `new Date()` para "hoy" — se fija el reloj al día de
  // prueba para que daysPending/daysSince sean deterministas.
  const context = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(`Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : ['${TODAY}T12:00:00'])); }
    static now() { return new (Date)('${TODAY}T12:00:00').getTime(); }
  };`, context);
  vm.runInContext(CALCS, context, { filename: 'calcs.js' });
  vm.runInContext(DASH,  context, { filename: 'dashboard.js' });
  fns = vm.runInContext('({ calcAlerts })', context);
  APP = vm.runInContext('APP', context);
  _lastContext = context;
  return context;
}

beforeEach(() => { load(); });

const keys = alerts => alerts.map(a => a.key);

describe('Regla de los 2 meses — falso positivo corregido', () => {
  test('compra reciente SIN venta con pérdidas previa → NO alerta (regresión)', () => {
    APP.portfolio = [{ id: 'p1', name: 'NVIDIA', ticker: 'NVDA', quantity: 10,
                       buyPrice: 890, currentPrice: 900, buyDate: `${MONTH}-20` }]; // comprado hace 8 días
    APP.sales = []; // nunca se ha vendido nada de este ticker
    const alerts = fns.calcAlerts();
    expect(keys(alerts)).not.toContain('tax-hold-p1');
  });

  test('compra reciente CON venta con pérdidas del mismo ticker ±60 días → SÍ alerta', () => {
    APP.portfolio = [{ id: 'p1', name: 'NVIDIA', ticker: 'NVDA', quantity: 10,
                       buyPrice: 890, currentPrice: 900, buyDate: `${MONTH}-20` }];
    APP.sales = [{ id: 's1', ticker: 'NVDA', buyPrice: 900, sellPrice: 800, quantity: 5,
                   sellDate: `${MONTH}-10` }]; // vendida con pérdida 10 días antes de la recompra
    const alerts = fns.calcAlerts();
    const a = alerts.find(x => x.key === 'tax-hold-p1');
    expect(a).toBeDefined();
    expect(a.type).toBe('warning');
    expect(a.text).toContain('NVIDIA');
    expect(a.action).toEqual({ label: 'Ver fiscalidad', section: 'fiscalidad' });
  });

  test('venta con GANANCIA del mismo ticker → no cuenta como "lossSale", no alerta', () => {
    APP.portfolio = [{ id: 'p1', name: 'NVIDIA', ticker: 'NVDA', quantity: 10,
                       buyPrice: 890, currentPrice: 900, buyDate: `${MONTH}-20` }];
    APP.sales = [{ id: 's1', ticker: 'NVDA', buyPrice: 500, sellPrice: 800, quantity: 5,
                   sellDate: `${MONTH}-10` }]; // vendida con GANANCIA
    expect(keys(fns.calcAlerts())).not.toContain('tax-hold-p1');
  });

  test('venta con pérdidas de un ticker DISTINTO → no alerta', () => {
    APP.portfolio = [{ id: 'p1', name: 'NVIDIA', ticker: 'NVDA', quantity: 10,
                       buyPrice: 890, currentPrice: 900, buyDate: `${MONTH}-20` }];
    APP.sales = [{ id: 's1', ticker: 'ITX', buyPrice: 50, sellPrice: 40, quantity: 10,
                   sellDate: `${MONTH}-10` }];
    expect(keys(fns.calcAlerts())).not.toContain('tax-hold-p1');
  });

  test('venta con pérdidas FUERA de la ventana de 60 días → no alerta', () => {
    APP.portfolio = [{ id: 'p1', name: 'NVIDIA', ticker: 'NVDA', quantity: 10,
                       buyPrice: 890, currentPrice: 900, buyDate: `${MONTH}-20` }];
    APP.sales = [{ id: 's1', ticker: 'NVDA', buyPrice: 900, sellPrice: 800, quantity: 5,
                   sellDate: `${YEAR}-01-01` }]; // muchos meses antes
    expect(keys(fns.calcAlerts())).not.toContain('tax-hold-p1');
  });
});

describe('Bizum pendiente (alerta nueva)', () => {
  test('pendiente más de 7 días → alerta, con el texto según direction', () => {
    APP.bizums = [{ id: 'b1', person: 'María', concept: 'Cena', amount: 45,
                    direction: 'in', status: 'pending', date: `${MONTH}-10` }]; // 18 días
    const alerts = fns.calcAlerts();
    const a = alerts.find(x => x.key === 'bizum-pending-b1');
    expect(a).toBeDefined();
    expect(a.text).toContain('María');
    expect(a.text).toContain('te debe');
    expect(a.action).toEqual({ label: 'Ver bizums', section: 'bizums' });
  });

  test('direction "out" → texto "le debes", no "te debe"', () => {
    APP.bizums = [{ id: 'b1', person: 'Luis', concept: 'Concierto', amount: 20,
                    direction: 'out', status: 'pending', date: `${MONTH}-10` }];
    const a = fns.calcAlerts().find(x => x.key === 'bizum-pending-b1');
    expect(a.text).toContain('Le debes');
  });

  test('pendiente 7 días o menos → NO alerta todavía', () => {
    APP.bizums = [{ id: 'b1', person: 'Pedro', concept: 'Gasolina', amount: 30,
                    direction: 'in', status: 'pending', date: `${MONTH}-22` }]; // 6 días
    expect(keys(fns.calcAlerts())).not.toContain('bizum-pending-b1');
  });

  test('bizum ya cobrado (status done) → nunca alerta aunque sea antiguo', () => {
    APP.bizums = [{ id: 'b1', person: 'María', concept: 'Cena', amount: 45,
                    direction: 'in', status: 'done', date: `${MONTH}-01` }];
    expect(keys(fns.calcAlerts())).not.toContain('bizum-pending-b1');
  });
});

describe('Presupuesto casi agotado 80-99% (alerta nueva, junto a la de 100%+)', () => {
  test('85% → budget-near, no budget-over', () => {
    APP.budgets = [{ id: 'bg1', category: 'Ocio', monthlyAmount: 200 }];
    APP.transactions = [{ type: 'expense', category: 'Ocio', amount: 170, date: `${MONTH}-10` }];
    const alerts = fns.calcAlerts();
    expect(keys(alerts)).toContain(`budget-near-Ocio-${MONTH}`);
    expect(keys(alerts)).not.toContain(`budget-over-Ocio-${MONTH}`);
  });

  test('110% → budget-over, no budget-near (no se duplican)', () => {
    APP.budgets = [{ id: 'bg1', category: 'Ocio', monthlyAmount: 200 }];
    APP.transactions = [{ type: 'expense', category: 'Ocio', amount: 220, date: `${MONTH}-10` }];
    const alerts = fns.calcAlerts();
    expect(keys(alerts)).toContain(`budget-over-Ocio-${MONTH}`);
    expect(keys(alerts)).not.toContain(`budget-near-Ocio-${MONTH}`);
    const over = alerts.find(a => a.key === `budget-over-Ocio-${MONTH}`);
    expect(over.action).toEqual({ label: 'Ver transacciones', section: 'transactions' });
  });

  test('70% → ninguna de las dos', () => {
    APP.budgets = [{ id: 'bg1', category: 'Ocio', monthlyAmount: 200 }];
    APP.transactions = [{ type: 'expense', category: 'Ocio', amount: 140, date: `${MONTH}-10` }];
    const alerts = fns.calcAlerts();
    expect(keys(alerts)).not.toContain(`budget-near-Ocio-${MONTH}`);
    expect(keys(alerts)).not.toContain(`budget-over-Ocio-${MONTH}`);
  });

  test('importe guardado como string no rompe el cálculo (regresión _num)', () => {
    APP.budgets = [{ id: 'bg1', category: 'Ocio', monthlyAmount: 200 }];
    APP.transactions = [{ type: 'expense', category: 'Ocio', amount: '170', date: `${MONTH}-10` }];
    expect(() => fns.calcAlerts()).not.toThrow();
    expect(keys(fns.calcAlerts())).toContain(`budget-near-Ocio-${MONTH}`);
  });
});

describe('No hay regresión en las alertas ya existentes', () => {
  test('saldo negativo sigue disparando, ahora con action', () => {
    APP.transactions = [
      { type: 'income',  amount: 1000, date: `${MONTH}-01` },
      { type: 'expense', amount: 1500, date: `${MONTH}-02` },
    ];
    const a = fns.calcAlerts().find(x => x.key === `neg-balance-${MONTH}`);
    expect(a).toBeDefined();
    expect(a.action).toEqual({ label: 'Ver transacciones', section: 'transactions' });
  });

  test('recurrente vencida sigue disparando, ahora con action', () => {
    APP.recurring = [{ id: 'r1', description: 'Netflix', amount: 13, active: true, nextDate: `${MONTH}-20` }];
    const alerts = fns.calcAlerts();
    const a = alerts.find(x => x.key.startsWith('rec-due-'));
    expect(a).toBeDefined();
    expect(a.action).toEqual({ label: 'Ver recurrentes', section: 'recurring' });
  });

  test('un dismiss reciente oculta la alerta (ventana de 7 días)', () => {
    APP.bizums = [{ id: 'b1', person: 'María', concept: 'Cena', amount: 45,
                    direction: 'in', status: 'pending', date: `${MONTH}-10` }];
    expect(keys(fns.calcAlerts())).toContain('bizum-pending-b1');
    // Date.now() se captura DENTRO del contexto vm (el mismo reloj mockeado
    // que usa _isAlertDismissed), no con el Date.now() real del proceso
    // Jest — si no, "ahora mismo" y la fecha simulada de la prueba podrían
    // diferir en mucho más de 7 días según cuándo se ejecute el test.
    APP.dismissedAlerts['bizum-pending-b1'] = vm.runInContext('Date.now()', _lastContext);
    expect(keys(fns.calcAlerts())).not.toContain('bizum-pending-b1');
  });

  test('calcAlerts no revienta con APP vacía (cuenta nueva)', () => {
    // El mes simulado de la prueba es el día 28 sin ingresos registrados:
    // "no-income" es una alerta YA EXISTENTE y correcta (día ≥ 15 sin
    // ingresos), no algo que esta sesión haya tocado — se excluye aquí para
    // comprobar específicamente que ninguna de las alertas NUEVAS revienta
    // ni aparece con una cuenta recién creada.
    expect(() => fns.calcAlerts()).not.toThrow();
    expect(keys(fns.calcAlerts())).toEqual([`no-income-${MONTH}`]);
  });
});
