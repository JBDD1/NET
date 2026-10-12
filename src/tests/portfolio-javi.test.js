/**
 * Finova — portfolio-javi.test.js
 * Cartera real de "Javi" (VWRL / ITX / NVDA / KO) ejecutando el código REAL
 * de calcs.js y portfolio.js con vm. Verifica cada cifra del escenario:
 * valor 20.810 €, coste 12.290 €, ganancia +8.520 €, +69,3 %, CAGR y
 * dividendos anuales 132 €.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const CALCS = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');

// portfolio.js usa import.meta.env.VITE_SERVER_URL, que es SyntaxError en un
// <script> clásico: vite.config.js lo sustituye tanto al servir en dev como al
// copiar a dist (ver stripImportMeta). Aquí se replica esa MISMA sustitución
// para cargar el fichero igual que llega al navegador.
function stripImportMeta(code) {
  return code
    .replace(/import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g, '""')
    .replace(/import\.meta\b/g, 'undefined');
}
const PORT = stripImportMeta(fs.readFileSync(path.join(process.cwd(), 'src/sections/portfolio.js'), 'utf8'));

const DAYS3Y = 365.25 * 3;
const buyDate3y = () => new Date(Date.now() - DAYS3Y * 86400000).toISOString().slice(0, 10);

function javiPortfolio() {
  const d = buyDate3y();
  return [
    { id: 'vwrl', name: 'Vanguard FTSE All-World ETF', ticker: 'VWRL', quantity: 45,  buyPrice: 82,  currentPrice: 98,  exchangeRate: 1, buyDate: d, country: 'Global',  sector: 'ETF' },
    { id: 'itx',  name: 'Inditex',                     ticker: 'ITX',  quantity: 100, buyPrice: 38,  currentPrice: 46,  exchangeRate: 1, buyDate: d, country: 'España',  sector: 'Consumo discrecional' },
    { id: 'nvda', name: 'NVIDIA',                      ticker: 'NVDA', quantity: 10,  buyPrice: 210, currentPrice: 890, exchangeRate: 1, buyDate: d, country: 'EEUU',    sector: 'Tecnología' },
    { id: 'ko',   name: 'Coca-Cola',                   ticker: 'KO',   quantity: 50,  buyPrice: 54,  currentPrice: 58,  exchangeRate: 1, buyDate: d, country: 'EEUU',    sector: 'Consumo básico' },
  ];
}

// Dividendos con la semántica REAL de Finova: dividendPerShare es POR PAGO,
// y el anual sale de multiplicar por la frecuencia. Para que KO (trimestral)
// rente 72 €/año con 50 acciones, el pago por acción es 0,36 (= 1,44 anual / 4).
function javiDividends() {
  return [
    { id: 'd-ko',  assetName: 'Coca-Cola', ticker: 'KO',  dividendPerShare: 0.36, shares: 50,  frequency: 'quarterly',  retentionRate: 15, nextPayDate: '2026-10-01' },
    { id: 'd-itx', assetName: 'Inditex',   ticker: 'ITX', dividendPerShare: 0.30, shares: 100, frequency: 'semiannual', retentionRate: 19, nextPayDate: '2026-12-01' },
  ];
}

let APP, fns;

function load() {
  APP = {
    portfolio: javiPortfolio(),
    dividends: javiDividends(),
    watchlist: [
      { id: 'w1', name: 'Microsoft', ticker: 'MSFT', currentPrice: 460, targetPrice: 450, alertType: 'above' },
      { id: 'w2', name: 'Amazon',    ticker: 'AMZN', currentPrice: 195, targetPrice: 180, alertType: 'below' },
    ],
    cashAccounts: [], liabilities: [], alternatives: [], properties: [],
    transactions: [], goals: [], bizums: [], recurring: [], trips: [], sales: [],
    networthHistory: [], portfolioSnapshots: [], exchangeRates: {},
    categories: { income: [], expense: [] },
  };
  const stubs = {
    APP,
    getCurrentMonth: () => '2026-10',
    getTodayStr: () => '2026-10-28',
    _divFxRate: () => 1,
    formatCurrency: v => `${v}`, formatPct: v => `${v}%`, formatDate: d => d,
    formatDaysHeld: () => '3 años', colorClass: v => (v > 0 ? 'positive' : v < 0 ? 'negative' : ''),
    escapeHtml: s => String(s ?? ''), generateId: () => 'id' + Math.random(),
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }) },
    showToast: () => {}, saveData: () => {}, closeModal: () => {}, openModal: () => {},
    setText: () => {}, _animNum: () => {}, _delegate: () => {}, ric: fn => fn(),
    emptyRow: () => '', emptyState: () => '', updateNetworthHistory: () => {},
    Charts: { get: () => null, set: () => {}, destroy: () => {} },
    getChartDefaults: () => ({ gridColor: '#000', textColor: '#000', fontFamily: 'x', accent: '#000', accentFill: 'rgba(0,0,0,0.09)' }),
    CHART_COLORS: ['#1', '#2', '#3', '#4', '#5', '#6'],
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    softDelete: () => {}, _isPriceStale: () => false, _relativeTime: () => 'ahora',
    _tableKeydown: () => {}, loadPhoto: () => Promise.resolve(null),
  };
  const ctx = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  vm.runInContext(PORT, ctx, { filename: 'portfolio.js' });
  fns = vm.runInContext(`({
    calcPortfolioValue, calcNetWorth, calcAssetCAGR, calcPortfolioCAGR,
    assetValue, assetCost, _invalidateCalcCache,
    recordAssetPriceHistory, _PORTFOLIO_SORT_FNS, setPortfolioSort,
  })`, ctx);
  APP = vm.runInContext('APP', ctx);
  return ctx;
}

beforeEach(() => { load(); });

const byId = id => APP.portfolio.find(a => a.id === id);
const pct  = a => (a.buyPrice > 0 ? ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100 : 0);
const gain = a => fns.assetValue(a) - fns.assetCost(a);
const weight = a => (fns.assetValue(a) / fns.calcPortfolioValue()) * 100;

/* ── Flujos 1 y 2: KPIs por activo ────────────────────────────── */
describe('Flujos 1-2 — cada activo, uno por uno', () => {
  const casos = [
    ['vwrl', 4410, 3690,  720,  19.5, 21.2],
    ['itx',  4600, 3800,  800,  21.1, 22.1],
    ['nvda', 8900, 2100, 6800, 323.8, 42.8],
    ['ko',   2900, 2700,  200,   7.4, 13.9],
  ];
  test.each(casos)('%s → valor/coste/ganancia/rentabilidad/peso', (id, v, c, g, p, w) => {
    const a = byId(id);
    expect(fns.assetValue(a)).toBeCloseTo(v, 2);
    expect(fns.assetCost(a)).toBeCloseTo(c, 2);
    expect(gain(a)).toBeCloseTo(g, 2);
    expect(pct(a)).toBeCloseTo(p, 1);
    expect(weight(a)).toBeCloseTo(w, 1);
  });

  test('los pesos de los 4 activos suman 100 %', () => {
    const total = APP.portfolio.reduce((s, a) => s + weight(a), 0);
    expect(total).toBeCloseTo(100, 6);
  });
});

/* ── Flujo 3: KPIs globales ───────────────────────────────────── */
describe('Flujo 3 — KPIs globales de cartera', () => {
  test('VALOR TOTAL = 20.810 €', () => {
    expect(fns.calcPortfolioValue()).toBeCloseTo(20810, 2);
  });

  test('COSTE TOTAL = 12.290 €', () => {
    expect(APP.portfolio.reduce((s, a) => s + fns.assetCost(a), 0)).toBeCloseTo(12290, 2);
  });

  test('GANANCIA TOTAL = +8.520 €', () => {
    const cost = APP.portfolio.reduce((s, a) => s + fns.assetCost(a), 0);
    expect(fns.calcPortfolioValue() - cost).toBeCloseTo(8520, 2);
  });

  test('RENTABILIDAD TOTAL = +69,3 %', () => {
    const cost = APP.portfolio.reduce((s, a) => s + fns.assetCost(a), 0);
    expect(((fns.calcPortfolioValue() - cost) / cost) * 100).toBeCloseTo(69.3, 1);
  });

  test('mejor inversión por ganancia = NVIDIA (+6.800 €, +323,8 %)', () => {
    const best = APP.portfolio.map(a => ({ a, g: gain(a) })).reduce((b, x) => x.g > b.g ? x : b);
    expect(best.a.name).toBe('NVIDIA');
    expect(pct(best.a)).toBeCloseTo(323.8, 1);
  });

  test('peor inversión = Coca-Cola (+200 €, +7,4 %) y ESTÁ EN GANANCIA', () => {
    const worst = APP.portfolio.map(a => ({ a, g: gain(a) })).reduce((b, x) => x.g < b.g ? x : b);
    expect(worst.a.name).toBe('Coca-Cola');
    expect(pct(worst.a)).toBeCloseTo(7.4, 1);
    expect(worst.g).toBeGreaterThan(0); // no debe pintarse como pérdida
  });
});

/* ── CAGR ─────────────────────────────────────────────────────── */
describe('CAGR a 3 años', () => {
  test('NVDA ≈ 61,9 % anual', () => {
    expect(fns.calcAssetCAGR(byId('nvda'))).toBeCloseTo(61.9, 0);
  });

  test('VWRL ≈ 6,1 % anual', () => {
    expect(fns.calcAssetCAGR(byId('vwrl'))).toBeCloseTo(6.1, 0);
  });

  test('sin fecha de compra → null (no se inventa)', () => {
    const a = { ...byId('nvda') }; delete a.buyDate;
    expect(fns.calcAssetCAGR(a)).toBeNull();
  });

  test('CAGR de cartera coherente con el total (+69,3 % en 3 años ≈ 19,2 %/año)', () => {
    expect(fns.calcPortfolioCAGR()).toBeCloseTo(19.2, 0);
  });
});

/* ── Flujo 4: edición manual de precio ────────────────────────── */
describe('Flujo 4 — editar precio a mano', () => {
  test('NVDA 890 → 950 ⇒ su valor 9.500 € y la cartera 21.410 €', () => {
    byId('nvda').currentPrice = 950;
    fns._invalidateCalcCache();
    expect(fns.assetValue(byId('nvda'))).toBeCloseTo(9500, 2);
    expect(fns.calcPortfolioValue()).toBeCloseTo(21410, 2);
  });

  test('volver a 890 ⇒ cartera otra vez 20.810 €', () => {
    byId('nvda').currentPrice = 950;
    fns._invalidateCalcCache();
    byId('nvda').currentPrice = 890;
    fns._invalidateCalcCache();
    expect(fns.calcPortfolioValue()).toBeCloseTo(20810, 2);
  });
});

/* ── Flujo 5: divisa ──────────────────────────────────────────── */
describe('Flujo 5 — tipo de cambio', () => {
  test('exchangeRate 0,92 sobre NVDA en USD convierte a EUR', () => {
    const a = byId('nvda');
    a.currency = 'USD'; a.exchangeRate = 0.92;
    fns._invalidateCalcCache();
    expect(fns.assetValue(a)).toBeCloseTo(8900 * 0.92, 2);
    expect(fns.assetCost(a)).toBeCloseTo(2100 * 0.92, 2);
  });

  test('exchangeRate ausente o 0 se trata como 1 (nunca anula el valor)', () => {
    const a = byId('nvda');
    a.exchangeRate = 0;
    expect(fns.assetValue(a)).toBeCloseTo(8900, 2);
    delete a.exchangeRate;
    expect(fns.assetValue(a)).toBeCloseTo(8900, 2);
  });

  test('el CAGR no depende del tipo de cambio (se cancela)', () => {
    const sinFx = fns.calcAssetCAGR(byId('nvda'));
    byId('nvda').exchangeRate = 0.92;
    expect(fns.calcAssetCAGR(byId('nvda'))).toBeCloseTo(sinFx, 6);
  });
});

/* ── Flujo 6: ordenación ──────────────────────────────────────── */
describe('Flujo 6 — ordenar la tabla', () => {
  const orderBy = (col, asc) => {
    const fn = fns._PORTFOLIO_SORT_FNS[col];
    const dir = asc ? 1 : -1;
    return [...APP.portfolio].sort((a, b) => {
      const av = fn(a), bv = fn(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    }).map(a => a.ticker);
  };

  test('por nombre: A-Z y Z-A', () => {
    expect(orderBy('name', true)).toEqual(['KO', 'ITX', 'NVDA', 'VWRL']);
    expect(orderBy('name', false)).toEqual(['VWRL', 'NVDA', 'ITX', 'KO']);
  });

  test('por G/P descendente: NVDA, ITX, VWRL, KO', () => {
    expect(orderBy('gain', false)).toEqual(['NVDA', 'ITX', 'VWRL', 'KO']);
  });

  test('por rentabilidad descendente: NVDA, ITX, VWRL, KO', () => {
    expect(orderBy('gainPct', false)).toEqual(['NVDA', 'ITX', 'VWRL', 'KO']);
  });

  test('por valor descendente: NVDA, ITX, VWRL, KO', () => {
    expect(orderBy('value', false)).toEqual(['NVDA', 'ITX', 'VWRL', 'KO']);
  });

  test('pulsar dos veces alterna el sentido', () => {
    fns.setPortfolioSort('value');
    fns.setPortfolioSort('value');
    expect(orderBy('value', true)).toEqual(['KO', 'VWRL', 'ITX', 'NVDA']);
  });
});

/* ── Flujo 7: concentración ───────────────────────────────────── */
describe('Flujo 7 — concentración', () => {
  test('NVDA al 42,8 % supera un límite del 40 %', () => {
    expect(weight(byId('nvda'))).toBeGreaterThan(40);
  });

  test('con límite 30 % también avisa, y solo NVDA lo supera', () => {
    const over = APP.portfolio.filter(a => weight(a) > 30);
    expect(over.map(a => a.ticker)).toEqual(['NVDA']);
  });

  test('con límite 20 % (el de serie) avisan NVDA, ITX y VWRL', () => {
    const over = APP.portfolio.filter(a => weight(a) > 20).map(a => a.ticker).sort();
    expect(over).toEqual(['ITX', 'NVDA', 'VWRL']);
  });
});

/* ── Flujo 8: historial de precios ────────────────────────────── */
describe('Flujo 8 — historial de precios', () => {
  test('tres cambios el MISMO día dejan un punto con el último precio', () => {
    const a = byId('vwrl');
    [98, 102, 99].forEach(p => { a.currentPrice = p; fns.recordAssetPriceHistory(a); });
    expect(a.priceHistory).toHaveLength(1);
    expect(a.priceHistory[0].price).toBe(99); // serie diaria: vale el cierre
  });

  test('en días distintos sí acumula puntos', () => {
    const a = byId('vwrl');
    a.priceHistory = [{ date: '2026-10-26', price: 98 }, { date: '2026-10-27', price: 102 }];
    a.currentPrice = 99;
    fns.recordAssetPriceHistory(a);
    expect(a.priceHistory).toHaveLength(3);
    expect(a.priceHistory.map(p => p.price)).toEqual([98, 102, 99]);
  });

  test('el historial se recorta a 365 puntos', () => {
    const a = byId('vwrl');
    a.priceHistory = Array.from({ length: 400 }, (_, i) => ({ date: '2025-01-' + i, price: i }));
    a.currentPrice = 99;
    fns.recordAssetPriceHistory(a);
    expect(a.priceHistory).toHaveLength(365);
  });
});

/* ── Flujo 12: dividendos ─────────────────────────────────────── */
describe('Flujo 12 — dividendos', () => {
  const FREQ = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const annualOf = d => d.dividendPerShare * d.shares * FREQ[d.frequency];

  test('KO = 72 €/año e ITX = 60 €/año', () => {
    expect(annualOf(APP.dividends[0])).toBeCloseTo(72, 2);
    expect(annualOf(APP.dividends[1])).toBeCloseTo(60, 2);
  });

  test('TOTAL ANUAL = 132 € y mensual = 11 €', () => {
    const total = APP.dividends.reduce((s, d) => s + annualOf(d), 0);
    expect(total).toBeCloseTo(132, 2);
    expect(total / 12).toBeCloseTo(11, 2);
  });

  test('yield sobre valor actual: KO 2,48 % · ITX 1,30 %', () => {
    expect((72 / fns.assetValue(byId('ko'))) * 100).toBeCloseTo(2.48, 2);
    expect((60 / fns.assetValue(byId('itx'))) * 100).toBeCloseTo(1.30, 2);
  });

  test('yield on cost: KO 2,67 % · ITX 1,58 %', () => {
    const yoc = (d, a) => ((d.dividendPerShare * FREQ[d.frequency]) / a.buyPrice) * 100;
    expect(yoc(APP.dividends[0], byId('ko'))).toBeCloseTo(2.67, 2);
    expect(yoc(APP.dividends[1], byId('itx'))).toBeCloseTo(1.58, 2);
  });

  test('yield medio PONDERADO por valor = 1,76 % (no la media simple 1,89 %)', () => {
    const value = fns.assetValue(byId('ko')) + fns.assetValue(byId('itx'));
    expect((132 / value) * 100).toBeCloseTo(1.76, 2);
  });

  test('un dividendo de un activo que no está en cartera no rompe el yield', () => {
    APP.dividends.push({ id: 'x', assetName: 'Fuera', ticker: 'ZZZZ', dividendPerShare: 1, shares: 10, frequency: 'annual' });
    const inPortfolio = APP.dividends.filter(d => APP.portfolio.some(a => a.ticker === d.ticker));
    expect(inPortfolio).toHaveLength(2);
  });
});

/* ── Flujo 11: watchlist ──────────────────────────────────────── */
describe('Flujo 11 — alertas de watchlist', () => {
  const reached = w => {
    const t = w.alertType || 'above';
    return !!(w.targetPrice > 0) && (t === 'below' ? w.currentPrice <= w.targetPrice : w.currentPrice >= w.targetPrice);
  };

  test('MSFT a 460 con objetivo 450 "por encima" → alerta activada', () => {
    expect(reached(APP.watchlist[0])).toBe(true);
  });

  test('AMZN a 195 con objetivo 180 "por debajo" → aún NO', () => {
    expect(reached(APP.watchlist[1])).toBe(false);
  });

  test('AMZN cae a 175 → alerta activada', () => {
    APP.watchlist[1].currentPrice = 175;
    expect(reached(APP.watchlist[1])).toBe(true);
  });

  test('sin precio objetivo nunca hay alerta', () => {
    expect(reached({ currentPrice: 100, targetPrice: 0, alertType: 'above' })).toBe(false);
  });
});

/* ── Coherencia app ↔ exportación ─────────────────────────────── */
describe('El Excel debe cuadrar con lo que muestra la app', () => {
  const FREQ = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  // Mismo criterio que _divFxRate: la tasa sale del activo de la cartera.
  const fxOf = d => {
    const a = APP.portfolio.find(x => x.ticker === d.ticker);
    return a && a.exchangeRate > 0 ? a.exchangeRate : 1;
  };
  const anualApp   = d => d.dividendPerShare * d.shares * FREQ[d.frequency] * fxOf(d);
  const anualSinFx = d => d.dividendPerShare * d.shares * FREQ[d.frequency];

  test('en EUR ambos coinciden', () => {
    expect(anualApp(APP.dividends[0])).toBeCloseTo(anualSinFx(APP.dividends[0]), 6);
  });

  test('con KO en USD a 0,92 el total convertido NO es el bruto (regresión)', () => {
    byId('ko').currency = 'USD';
    byId('ko').exchangeRate = 0.92;
    const d = APP.dividends[0];
    expect(anualApp(d)).toBeCloseTo(72 * 0.92, 2);
    expect(anualSinFx(d)).toBeCloseTo(72, 2);
    expect(anualApp(d)).not.toBeCloseTo(anualSinFx(d), 2);
  });
});

/* ── Semántica del campo de dividendo ─────────────────────────── */
describe('Dividendo por acción: es POR PAGO, no anual', () => {
  const FREQ = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const anual = (perPay, shares, freq) => perPay * shares * FREQ[freq];

  test('0,36 trimestral × 50 acciones = 72 €/año (lo correcto para KO)', () => {
    expect(anual(0.36, 50, 'quarterly')).toBeCloseTo(72, 2);
  });

  test('meter el dividendo ANUAL (1,44) con frecuencia trimestral cuadruplica: 288 €', () => {
    expect(anual(1.44, 50, 'quarterly')).toBeCloseTo(288, 2);
    // ...y dispara el yield de 2,48 % a 9,93 %: por eso el formulario muestra
    // ahora el anual calculado en vivo.
    expect((288 / 2900) * 100).toBeCloseTo(9.93, 2);
  });

  test('0,30 semestral × 100 acciones = 60 €/año (lo correcto para ITX)', () => {
    expect(anual(0.30, 100, 'semiannual')).toBeCloseTo(60, 2);
  });
});

/* ── Pruebas destructivas ─────────────────────────────────────── */
describe('Pruebas destructivas', () => {
  test('precio de compra 0 → sin división por cero, rentabilidad 0 y CAGR null', () => {
    const a = { id: 'z', name: 'Regalo', ticker: 'FREE', quantity: 10, buyPrice: 0, currentPrice: 50, exchangeRate: 1, buyDate: buyDate3y() };
    APP.portfolio.push(a);
    fns._invalidateCalcCache();
    expect(pct(a)).toBe(0);
    expect(Number.isFinite(fns.calcPortfolioValue())).toBe(true);
    expect(fns.calcAssetCAGR(a)).toBeNull();
  });

  test('pérdida: precio actual < compra → ganancia negativa, sin errores', () => {
    byId('nvda').currentPrice = 150;
    fns._invalidateCalcCache();
    expect(gain(byId('nvda'))).toBeCloseTo((150 - 210) * 10, 2);
    expect(pct(byId('nvda'))).toBeCloseTo(-28.57, 2);
    expect(fns.calcAssetCAGR(byId('nvda'))).toBeLessThan(0);
  });

  test('20 activos: el total sigue siendo exacto y ordenable', () => {
    for (let i = 0; i < 16; i++) {
      APP.portfolio.push({ id: 'x' + i, name: 'Activo ' + i, ticker: 'T' + i, quantity: 1, buyPrice: 10, currentPrice: 20, exchangeRate: 1, buyDate: buyDate3y() });
    }
    fns._invalidateCalcCache();
    expect(APP.portfolio).toHaveLength(20);
    expect(fns.calcPortfolioValue()).toBeCloseTo(20810 + 16 * 20, 2);
    const sorted = [...APP.portfolio].sort((a, b) => fns._PORTFOLIO_SORT_FNS.value(b) - fns._PORTFOLIO_SORT_FNS.value(a));
    expect(sorted[0].ticker).toBe('NVDA');
  });

  test('cantidad 0 → aporta 0, nunca NaN', () => {
    APP.portfolio.push({ id: 'q', name: 'Cero', ticker: 'ZERO', quantity: 0, buyPrice: 10, currentPrice: 20, exchangeRate: 1 });
    fns._invalidateCalcCache();
    expect(fns.calcPortfolioValue()).toBeCloseTo(20810, 2);
  });
});
