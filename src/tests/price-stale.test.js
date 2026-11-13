/**
 * Finova — price-stale.test.js
 * Regresión de F08 (S7-F1): cuando el servidor devuelve una cotización marcada
 * como `stale` (no pudo refrescarla y sirve su última copia), el cliente NO debe
 * mostrarla como "actualizada". Ejecuta el código REAL de portfolio.js con vm.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// portfolio.js usa import.meta.env.*, que es SyntaxError en un <script> clásico;
// vite.config.js lo sustituye al servir/compilar. Se replica esa sustitución.
function stripImportMeta(code) {
  return code
    .replace(/import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g, '""')
    .replace(/import\.meta\b/g, 'undefined');
}
const CALCS = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');
const PORT  = stripImportMeta(fs.readFileSync(path.join(process.cwd(), 'src/sections/portfolio.js'), 'utf8'));

let fns;

beforeEach(() => {
  const APP = {
    portfolio: [], watchlist: [], dividends: [], cashAccounts: [], liabilities: [],
    alternatives: [], properties: [], transactions: [], goals: [], bizums: [],
    recurring: [], trips: [], sales: [], networthHistory: [], portfolioSnapshots: [],
    exchangeRates: {}, categories: { income: [], expense: [] },
  };
  const stubs = {
    APP,
    getCurrentMonth: () => '2026-11', getTodayStr: () => '2026-11-13',
    _divFxRate: () => 1, formatCurrency: v => `${v}`, formatPct: v => `${v}%`,
    formatDate: d => d, formatDaysHeld: () => '', colorClass: () => '',
    escapeHtml: s => String(s ?? ''), generateId: () => 'id' + Math.random(),
    _relativeTime: () => 'hace 3 h',
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }) },
    showToast: () => {}, saveData: () => {}, closeModal: () => {}, openModal: () => {},
    setText: () => {}, _animNum: () => {}, _delegate: () => {}, ric: fn => fn(),
    emptyRow: () => '', emptyState: () => '', updateNetworthHistory: () => {},
    Charts: { get: () => null, set: () => {}, destroy: () => {} },
    getChartDefaults: () => ({ gridColor: '#000', textColor: '#000', fontFamily: 'x', accent: '#000', accentFill: 'rgba(0,0,0,0.09)' }),
    CHART_COLORS: ['#1', '#2', '#3', '#4', '#5', '#6'],
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    softDelete: () => {}, _tableKeydown: () => {}, loadPhoto: () => Promise.resolve(null),
  };
  const ctx = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  vm.runInContext(PORT, ctx, { filename: 'portfolio.js' });
  fns = vm.runInContext('({ _isPriceStale, _applyQuoteToAsset })', ctx);
});

describe('F08 — precios stale del servidor no se muestran como actualizados', () => {
  test('una cotización marcada stale actualiza el valor pero queda como NO actualizada', () => {
    const asset = { id: 'a', currentPrice: 100, priceDate: 0 };
    const outcome = fns._applyQuoteToAsset(asset, { price: 110, stale: true });

    expect(outcome).toBe('stale');
    expect(asset.currentPrice).toBe(110);      // se usa el mejor dato disponible
    expect(asset.priceStale).toBe(true);        // pero marcado como no actual
    // NO se sella priceDate con "ahora": no se finge que es un dato fresco.
    expect(asset.priceDate).toBe(0);
    // La UI (que usa _isPriceStale) lo muestra como desactualizado, NO actualizado.
    expect(fns._isPriceStale(asset)).toBe(true);
  });

  test('una cotización fresca SÍ se marca como actualizada', () => {
    const asset = { id: 'b', currentPrice: 100, priceDate: 0 };
    const before = Date.now();
    const outcome = fns._applyQuoteToAsset(asset, { price: 110 });

    expect(outcome).toBe('updated');
    expect(asset.currentPrice).toBe(110);
    expect(asset.priceStale).toBe(false);
    expect(asset.priceDate).toBeGreaterThanOrEqual(before); // sellado con ahora
    expect(fns._isPriceStale(asset)).toBe(false);
  });

  test('_isPriceStale: el flag priceStale gana aunque priceDate sea de justo ahora', () => {
    expect(fns._isPriceStale({ priceDate: Date.now(), priceStale: true })).toBe(true);
  });

  test('_isPriceStale: sin flag y con priceDate reciente, es fresco (sin regresión)', () => {
    expect(fns._isPriceStale({ priceDate: Date.now() })).toBe(false);
  });

  test('_isPriceStale: sin priceDate sigue siendo stale', () => {
    expect(fns._isPriceStale({})).toBe(true);
  });

  test('una cotización sin precio utilizable no toca el activo (failed)', () => {
    const asset = { id: 'c', currentPrice: 100, priceDate: 12345, priceStale: false };
    expect(fns._applyQuoteToAsset(asset, { price: 0, stale: true })).toBe('failed');
    expect(fns._applyQuoteToAsset(asset, undefined)).toBe('failed');
    expect(asset.currentPrice).toBe(100); // intacto
    expect(asset.priceDate).toBe(12345);
  });
});
