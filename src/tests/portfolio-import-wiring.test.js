/**
 * Finova — portfolio-import-wiring.test.js
 * El cableado del importador (botón → carga diferida → input → preview →
 * commit) era la parte SIN probar: los tests de portfolio-import.test.js
 * cubren el parseo y la fusión, pero no que al pulsar el botón pase nada.
 *
 * Y es justo la clase de fallo que ya mordió en este proyecto: referenciar
 * una función de un módulo diferido fuera de un closure lanza ReferenceError
 * en cuanto se carga la página (ver el caso de adminRefreshUsers en
 * events.js). Aquí se recorre la ruta entera con DOM real de jsdom.
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { TextDecoder } from 'node:util';

const SCRIPT = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');
const PF     = fs.readFileSync(path.join(process.cwd(), 'src/utils/portfolio-import.js'), 'utf8');
const CALCS  = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');

function extract(...names) {
  return names.map(n => {
    const re = new RegExp('(?:^|\\n)(?:async function|function|const)\\s+' + n + '\\b');
    const m = re.exec(SCRIPT);
    if (!m) throw new Error('no encontrada: ' + n);
    const s = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const rest = SCRIPT.slice(s + 1);
    const nx = /\n(?:async function|function|const|let|\/\* ═)/.exec(rest);
    return SCRIPT.slice(s, nx ? s + 1 + nx.index : SCRIPT.length);
  }).join('\n');
}

let APP, ctx, loaded, toasts, modal;

beforeEach(() => {
  // DOM real: el input de archivo y el botón, igual que en index.html
  document.body.innerHTML = `
    <button data-action="import-portfolio">Importar</button>
    <input type="file" id="portfolio-import-input" />
    <div id="modalBody"></div><button id="modalConfirm"></button>`;

  APP = {
    portfolio: [], cashAccounts: [], alternatives: [], properties: [],
    liabilities: [], transactions: [], networthHistory: [], portfolioSnapshots: [],
  };
  loaded = [];
  toasts = [];
  modal  = null;

  ctx = vm.createContext({
    APP, console, TextDecoder, document, window, FileReader, Uint8Array,
    showToast: (m, t) => toasts.push({ m, t }),
    openModal: (title, body, onConfirm) => { modal = { title, body, onConfirm }; },
    closeModal: () => { modal = null; },
    escapeHtml: s => String(s ?? ''), formatCurrency: v => String(v),
    generateId: (() => { let i = 0; return () => 'gen' + (++i); })(),
    saveData: () => {}, renderPortfolio: () => {}, renderDashboard: () => {},
    getCurrentMonth: () => '2026-10',
    requireAccountFor: () => true,
    _ensureScript: () => Promise.resolve(),
    // _lazyLoad real inyecta un <script>; en jsdom no se ejecutaría, así que
    // se simula cargando el módulo igual que haría el navegador.
    _lazyLoad: src => { loaded.push(src); vm.runInContext(PF, ctx, { filename: 'pf.js' }); return Promise.resolve(); },
    _LAZY_SCRIPTS: { pfImport: 'src/utils/portfolio-import.js' },
  });
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  vm.runInContext(
    extract('_HEADER_KEYWORDS_RE', '_parseCSVAmt', '_csvSplit', '_findHeaderRowIdx',
            '_parseCSVDate', '_detectCsvEncoding', '_withPortfolioImport'),
    ctx, { filename: 'parsers.js' }
  );
});

const call = expr => vm.runInContext(expr, ctx);

describe('Cableado: botón → carga diferida → input', () => {
  test('al pulsar, el módulo NO está cargado todavía y se pide', async () => {
    expect(call('typeof importPortfolioFile')).toBe('undefined');
    const btn = document.querySelector('[data-action="import-portfolio"]');
    await call('_withPortfolioImport')(btn);
    expect(loaded).toEqual(['src/utils/portfolio-import.js']);
    expect(call('typeof importPortfolioFile')).toBe('function');
  });

  test('el botón se deshabilita mientras carga y se restaura después', async () => {
    const btn = document.querySelector('[data-action="import-portfolio"]');
    const original = btn.innerHTML;
    const p = call('_withPortfolioImport')(btn);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Preparando…');
    await p;
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toBe(original);
  });

  test('el <input type=file> queda cableado al evento change', async () => {
    const inp = document.getElementById('portfolio-import-input');
    expect(inp._pfWired).toBeFalsy();
    await call('_withPortfolioImport')(document.querySelector('button'));
    expect(inp._pfWired).toBe(true);
  });

  test('una segunda pulsación no recarga el módulo ni duplica el listener', async () => {
    const btn = document.querySelector('button');
    await call('_withPortfolioImport')(btn);
    await call('_withPortfolioImport')(btn);
    expect(loaded).toHaveLength(1); // solo la primera vez
  });

  test('si la carga falla, avisa y restaura el botón (no se queda colgado)', async () => {
    vm.runInContext('_lazyLoad = () => Promise.reject(new Error("red"))', ctx);
    const btn = document.querySelector('button');
    await call('_withPortfolioImport')(btn);
    expect(btn.disabled).toBe(false);
    expect(toasts.some(t => t.t === 'error')).toBe(true);
  });
});

describe('Ruta completa: archivo → preview → commit', () => {
  test('un CSV seleccionado abre la previsualización con el plan', async () => {
    await call('_withPortfolioImport')(document.querySelector('button'));
    const csv = 'Ticker;Cantidad;Precio medio;Precio actual\nVWRL;30;82,33;102,00';
    call('_pfHandleResult')(call('_pfParseCSV')(csv), 'CSV');
    expect(modal).not.toBeNull();
    expect(modal.title).toMatch(/Importar cartera/);
    expect(modal.body).toMatch(/VWRL/);
    // Confirmar aplica de verdad
    modal.onConfirm();
    expect(APP.portfolio).toHaveLength(1);
    expect(APP.portfolio[0].ticker).toBe('VWRL');
  });

  test('un archivo irreconocible avisa y NO abre la previsualización', async () => {
    await call('_withPortfolioImport')(document.querySelector('button'));
    call('_pfHandleResult')(call('_pfParseCSV')('Alfa;Beta\n1;2'), 'CSV');
    expect(modal).toBeNull();
    expect(toasts.some(t => t.t === 'error')).toBe(true);
  });
});

describe('Ruta Excel (lógica propia, SheetJS simulado)', () => {
  beforeEach(async () => {
    await call('_withPortfolioImport')(document.querySelector('button'));
  });

  test('salta la hoja de portada y usa la primera con posiciones', () => {
    // Patrón real: muchos brokers ponen una portada antes de la cartera.
    vm.runInContext(`XLSX = {
      read: () => ({ SheetNames: ['Portada', 'Posiciones'], Sheets: { Portada: 'p', Posiciones: 'd' } }),
      utils: { sheet_to_json: sheet => sheet === 'p'
        ? [['Informe de cartera'], ['Generado el 30/10/2026']]
        : [['Ticker','Cantidad','Precio medio'], ['SAN','500','3,20']] },
    }`, ctx);
    const wb = call('XLSX').read();
    let res = null;
    for (const name of wb.SheetNames) {
      const rows = call('XLSX').utils.sheet_to_json(wb.Sheets[name]);
      const attempt = call('_pfRowsToAssets')(rows);
      if (attempt.assets.length) { res = attempt; break; }
      if (!res) res = attempt;
    }
    expect(res.assets).toHaveLength(1);
    expect(res.assets[0].ticker).toBe('SAN');
  });

  test('SheetJS devuelve números como texto con coma decimal y se parsean bien', () => {
    // raw:false hace que sheet_to_json devuelva strings tal cual se ven.
    const rows = [['Ticker', 'Cantidad', 'Precio medio'], ['VWRL', '30', '82,33']];
    const { assets } = call('_pfRowsToAssets')(rows);
    expect(assets[0].buyPrice).toBeCloseTo(82.33, 2);
  });
});
