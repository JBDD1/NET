/**
 * Finova — portfolio-import.test.js
 * Importador de carteras de bróker (src/utils/portfolio-import.js).
 *
 * Lo crítico aquí es el "upsert" por ticker: hasta ahora añadir dos veces el
 * mismo valor dejaba DOS filas en la cartera, y el usuario tenía que calcular
 * el precio medio a mano. Se comprueba contra el caso real que lo destapó:
 * VWRL comprado en dos tandas (20 @ 78 € y 10 @ 91 €) debe quedar en una sola
 * posición de 30 participaciones a 82,33 €.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { TextDecoder, TextEncoder } from 'node:util';

const SCRIPT = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');
const PF     = fs.readFileSync(path.join(process.cwd(), 'src/utils/portfolio-import.js'), 'utf8');
const CALCS  = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');

/** Extrae funciones (o constantes) sueltas de script.js sin ejecutar el archivo entero. */
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

let APP, fns;

beforeEach(() => {
  // _pfCommit llama al updateNetworthHistory REAL (calcs.js lo define y pisa
  // cualquier stub), que recorre todo el patrimonio: el fixture necesita la
  // forma completa de APP, no solo portfolio.
  APP = {
    portfolio: [], cashAccounts: [], alternatives: [], properties: [],
    liabilities: [], transactions: [], networthHistory: [], portfolioSnapshots: [],
  };
  const ctx = vm.createContext({
    APP, console, TextDecoder, TextEncoder, DOMParser,
    document: { getElementById: () => null },
    showToast: () => {}, saveData: () => {}, closeModal: () => {}, openModal: () => {},
    escapeHtml: s => String(s ?? ''), formatCurrency: v => `${v}`,
    generateId: (() => { let i = 0; return () => 'gen' + (++i); })(),
    updateNetworthHistory: () => {}, renderPortfolio: () => {}, renderDashboard: () => {},
    getCurrentMonth: () => '2026-10',
  });
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  // _HEADER_KEYWORDS_RE es la constante de la que depende _findHeaderRowIdx:
  // sin extraerla también, la función lanza ReferenceError al usarla.
  vm.runInContext(
    extract('_HEADER_KEYWORDS_RE', '_parseCSVAmt', '_csvSplit', '_findHeaderRowIdx', '_parseCSVDate'),
    ctx, { filename: 'parsers.js' }
  );
  vm.runInContext(PF, ctx, { filename: 'portfolio-import.js' });
  fns = vm.runInContext(`({ _pfDetectCols, _pfRowsToAssets, _pfParseJSON, _pfParseCSV,
                            _pfPlanMerge, _pfCurrency, _pfAssetClass, _pfCommit, _pfNorm, _pfShowPreview, _pfSniffFormat, _pfParseAny, _pfParseHTML, _pfParseXML })`, ctx);
  APP = vm.runInContext('APP', ctx);
});

describe('Mapeo de cabeceras por alias', () => {
  test('cabeceras en español de un bróker típico', () => {
    const cols = fns._pfDetectCols(['Producto', 'Ticker', 'Cantidad', 'Precio medio', 'Divisa']);
    expect(cols.name).toBe(0);
    expect(cols.ticker).toBe(1);
    expect(cols.quantity).toBe(2);
    expect(cols.buyPrice).toBe(3);
    expect(cols.currency).toBe(4);
  });

  test('cabeceras en inglés (Trade Republic, IBKR…)', () => {
    const cols = fns._pfDetectCols(['Symbol', 'Name', 'Shares', 'Avg Cost', 'Currency']);
    expect(cols.ticker).toBe(0);
    expect(cols.name).toBe(1);
    expect(cols.quantity).toBe(2);
    expect(cols.buyPrice).toBe(3);
  });

  test('"Precio medio" gana a "Precio" (pasada exacta antes que la de inclusión)', () => {
    const cols = fns._pfDetectCols(['Ticker', 'Cantidad', 'Precio', 'Precio medio']);
    expect(cols.buyPrice).toBe(3);      // "Precio medio", no "Precio"
    expect(cols.currentPrice).toBe(2);  // "Precio" queda para el actual
  });

  test('tildes y mayúsculas no importan', () => {
    const cols = fns._pfDetectCols(['DESCRIPCIÓN', 'SÍMBOLO', 'UNIDADES', 'PRECIO DE COMPRA']);
    expect(cols.name).toBe(0);
    expect(cols.quantity).toBe(2);
    expect(cols.buyPrice).toBe(3);
  });

  test('una columna no se asigna a dos campos distintos', () => {
    const cols = fns._pfDetectCols(['Ticker', 'Cantidad', 'Precio medio']);
    const used = Object.values(cols).filter(v => v != null);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('Parseo CSV con formatos numéricos y delimitadores distintos', () => {
  test('punto y coma + coma decimal (exports españoles)', () => {
    const csv = 'Ticker;Nombre;Cantidad;Precio medio;Divisa\nVWRL;Vanguard All-World;30;82,33;EUR';
    const { assets } = fns._pfParseCSV(csv);
    expect(assets).toHaveLength(1);
    expect(assets[0].quantity).toBe(30);
    expect(assets[0].buyPrice).toBeCloseTo(82.33, 2);
  });

  test('coma + punto decimal (exports en inglés)', () => {
    const csv = 'Symbol,Name,Shares,Avg Cost,Currency\nAAPL,Apple Inc.,8,165.00,USD';
    const { assets } = fns._pfParseCSV(csv);
    expect(assets[0].quantity).toBe(8);
    expect(assets[0].buyPrice).toBeCloseTo(165, 2);
    expect(assets[0].currency).toBe('USD');
  });

  test('tabulador como delimitador (TSV)', () => {
    const tsv = 'Ticker\tCantidad\tPrecio medio\nSAN\t500\t3,20';
    const { assets } = fns._pfParseCSV(tsv);
    expect(assets).toHaveLength(1);
    expect(assets[0].buyPrice).toBeCloseTo(3.2, 2);
  });

  test('miles con punto y decimal con coma: 1.234,56', () => {
    const csv = 'Ticker;Cantidad;Precio medio\nTEST;1;1.234,56';
    const { assets } = fns._pfParseCSV(csv);
    expect(assets[0].buyPrice).toBeCloseTo(1234.56, 2);
  });

  test('filas inválidas se reportan, no se descartan en silencio', () => {
    const csv = 'Ticker;Cantidad;Precio medio\nOK;10;5,00\nMALA;0;5,00\nSINPRECIO;3;';
    const { assets, errors } = fns._pfParseCSV(csv);
    expect(assets).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0].reason).toMatch(/Cantidad/);
    expect(errors[1].reason).toMatch(/precio/i);
  });

  test('sin columnas reconocibles devuelve diagnóstico con las cabeceras vistas', () => {
    const { assets, diag } = fns._pfParseCSV('Alfa;Beta;Gamma\n1;2;3');
    expect(assets).toHaveLength(0);
    expect(diag).toMatch(/Alfa/);
  });
});

describe('Importación JSON', () => {
  test('acepta tanto el esquema interno como el del brief (buy_price, asset_name)', () => {
    const { assets } = fns._pfParseJSON(JSON.stringify([
      { ticker: 'BTC', asset_name: 'Bitcoin', quantity: 0.5, buy_price: 30000, currency: 'EUR' },
      { symbol: 'VWCE', name: 'Vanguard FTSE', quantity: 12, buyPrice: 98.5 },
    ]));
    expect(assets).toHaveLength(2);
    expect(assets[0].name).toBe('Bitcoin');
    expect(assets[0].assetClass).toBe('Cripto');   // reconocido por el ticker
    expect(assets[1].ticker).toBe('VWCE');
  });

  test('acepta {assets:[...]} además del array suelto', () => {
    const { assets } = fns._pfParseJSON(JSON.stringify({ assets: [{ ticker: 'X', quantity: 1, buyPrice: 2 }] }));
    expect(assets).toHaveLength(1);
  });

  test('JSON inválido da un mensaje claro, no una excepción', () => {
    const r = fns._pfParseJSON('{esto no es json');
    expect(r.assets).toHaveLength(0);
    expect(r.diag).toMatch(/JSON/);
  });
});

describe('Detección de formato por contenido (la extensión miente)', () => {
  test('reconoce HTML, XML, JSON y delimitado sin mirar el nombre del archivo', () => {
    expect(fns._pfSniffFormat('<html><body><table><tr><td>1</td></tr></table>')).toBe('html');
    expect(fns._pfSniffFormat('<table><tr><td>1</td></tr></table>')).toBe('html');
    expect(fns._pfSniffFormat('<?xml version="1.0"?><p><x>1</x></p>')).toBe('xml');
    expect(fns._pfSniffFormat('[{"ticker":"X"}]')).toBe('json');
    expect(fns._pfSniffFormat('Ticker;Cantidad\nX;1')).toBe('delimited');
  });

  test('tabla HTML con nombre .xls — el caso real de varios brokers', () => {
    const html = `<html><body>
      <table><tr><td>Informe de cartera</td></tr></table>
      <table>
        <tr><th>Producto</th><th>Ticker</th><th>Cantidad</th><th>Precio medio</th></tr>
        <tr><td>Vanguard FTSE All-World</td><td>VWRL</td><td>30</td><td>82,33</td></tr>
        <tr><td>Banco Santander</td><td>SAN</td><td>500</td><td>3,20</td></tr>
      </table></body></html>`;
    const { res, label } = fns._pfParseAny(html);
    expect(label).toBe('HTML');
    expect(res.assets).toHaveLength(2);           // salta la tabla de portada
    expect(res.assets[0].ticker).toBe('VWRL');
    expect(res.assets[1].buyPrice).toBeCloseTo(3.2, 2);
  });

  test('XML con elementos repetidos, sin conocer el esquema del bróker', () => {
    const xml = `<?xml version="1.0"?><cartera>
      <position><ticker>VWRL</ticker><cantidad>30</cantidad><preciomedio>82.33</preciomedio></position>
      <position><ticker>SAN</ticker><cantidad>500</cantidad><preciomedio>3.20</preciomedio></position>
    </cartera>`;
    const { res, label } = fns._pfParseAny(xml);
    expect(label).toBe('XML');
    expect(res.assets).toHaveLength(2);
    expect(res.assets[0].ticker).toBe('VWRL');
  });

  test('texto pegado con tabuladores (copiar/pegar desde la web del bróker)', () => {
    const pasted = 'Ticker\tCantidad\tPrecio medio\nVWRL\t30\t82,33\nSAN\t500\t3,20';
    const { res, label } = fns._pfParseAny(pasted);
    expect(label).toBe('CSV');
    expect(res.assets).toHaveLength(2);
  });

  test('HTML sin ninguna tabla da un diagnóstico claro', () => {
    const { res } = fns._pfParseAny('<html><body><p>Sin tablas</p></body></html>');
    expect(res.assets).toHaveLength(0);
    expect(res.diag).toMatch(/tabla/i);
  });
});

describe('Upsert por ticker con precio medio ponderado', () => {
  test('VWRL en dos tandas (20@78 + 10@91) → 30 unidades a 82,33 €', () => {
    APP.portfolio.push({ id: 'a1', ticker: 'VWRL', name: 'Vanguard', quantity: 20, buyPrice: 78, currentPrice: 102, currency: 'EUR', exchangeRate: 1 });
    const plan = fns._pfPlanMerge([
      { ticker: 'VWRL', name: 'Vanguard', quantity: 10, buyPrice: 91, currentPrice: 102, currency: 'EUR', exchangeRate: 1 },
    ]);
    expect(plan[0].action).toBe('merge');
    expect(plan[0].mergedQuantity).toBe(30);
    expect(plan[0].mergedBuyPrice).toBeCloseTo(82.333333, 4);  // (20×78 + 10×91) / 30
  });

  test('aplicar el plan deja UNA sola posición, no dos filas (ruta real: preview → commit)', () => {
    APP.portfolio.push({ id: 'a1', ticker: 'VWRL', name: 'Vanguard', quantity: 20, buyPrice: 78, currentPrice: 102, currency: 'EUR', exchangeRate: 1 });
    // _pfShowPreview deja el plan pendiente; _pfCommit lo aplica. Se recorre
    // esa ruta en vez de replicar la fusión en el test.
    fns._pfShowPreview({ assets: [
      // hasCurrentPrice: el archivo trae cotización propia, así que manda
      { ticker: 'VWRL', name: 'Vanguard', quantity: 10, buyPrice: 91, currentPrice: 105, hasCurrentPrice: true, currency: 'EUR', exchangeRate: 1 },
    ], errors: [] }, 'CSV');
    fns._pfCommit();
    expect(APP.portfolio).toHaveLength(1);
    expect(APP.portfolio[0].quantity).toBe(30);
    expect(APP.portfolio[0].buyPrice).toBeCloseTo(82.333333, 4);
    expect(APP.portfolio[0].currentPrice).toBe(105); // el precio del archivo es más reciente
  });

  test('commit de un ticker nuevo lo añade con el esquema real de la app', () => {
    fns._pfShowPreview({ assets: [
      { ticker: 'SAN', name: 'Santander', quantity: 500, buyPrice: 3.2, currentPrice: 4.45, currency: 'EUR', exchangeRate: 1, buyDate: '2023-03-01', sector: '', country: '' },
    ], errors: [] }, 'CSV');
    fns._pfCommit();
    expect(APP.portfolio).toHaveLength(1);
    const a = APP.portfolio[0];
    // Las claves que espera el resto de la app (assetValue/assetCost usan estas)
    expect(a).toHaveProperty('id');
    expect(a.ticker).toBe('SAN');
    expect(a.buyPrice).toBe(3.2);
    expect(a.exchangeRate).toBe(1);
  });

  test('fusionar con un archivo SIN precio actual no machaca el precio vivo', () => {
    // Caso real: la cartera tiene VWRL a 102 € (precio refrescado). El export
    // del bróker solo trae coste medio, sin cotización. Antes, el parser
    // rellenaba currentPrice con buyPrice y la fusión lo daba por bueno: el
    // precio actual pasaba a 82,33 € y la ganancia mostrada se evaporaba.
    APP.portfolio.push({ id: 'a1', ticker: 'VWRL', name: 'Vanguard', quantity: 20, buyPrice: 78, currentPrice: 102, currency: 'EUR', exchangeRate: 1 });
    const { assets } = fns._pfParseCSV('Ticker;Cantidad;Precio medio\nVWRL;10;91,00');
    expect(assets[0].hasCurrentPrice).toBe(false);
    fns._pfShowPreview({ assets, errors: [] }, 'CSV');
    fns._pfCommit();
    expect(APP.portfolio).toHaveLength(1);
    expect(APP.portfolio[0].currentPrice).toBe(102);          // intacto
    expect(APP.portfolio[0].buyPrice).toBeCloseTo(82.3333, 3); // el medio sí se recalcula
  });

  test('si el archivo SÍ trae precio actual, ese manda (es más reciente)', () => {
    APP.portfolio.push({ id: 'a1', ticker: 'VWRL', quantity: 20, buyPrice: 78, currentPrice: 102, currency: 'EUR', exchangeRate: 1 });
    const { assets } = fns._pfParseCSV('Ticker;Cantidad;Precio medio;Precio actual\nVWRL;10;91,00;105,00');
    expect(assets[0].hasCurrentPrice).toBe(true);
    fns._pfShowPreview({ assets, errors: [] }, 'CSV');
    fns._pfCommit();
    expect(APP.portfolio[0].currentPrice).toBe(105);
  });

  test('una posición en conflicto de divisa NO se importa', () => {
    APP.portfolio.push({ id: 'a1', ticker: 'AAPL', quantity: 8, buyPrice: 165, currency: 'USD', exchangeRate: 1 });
    fns._pfShowPreview({ assets: [
      { ticker: 'AAPL', name: 'Apple', quantity: 2, buyPrice: 150, currentPrice: 227, currency: 'EUR', exchangeRate: 1 },
    ], errors: [] }, 'CSV');
    fns._pfCommit();
    expect(APP.portfolio).toHaveLength(1);
    expect(APP.portfolio[0].quantity).toBe(8); // intacta
  });

  test('ticker nuevo → se añade, no se fusiona', () => {
    APP.portfolio.push({ id: 'a1', ticker: 'VWRL', quantity: 20, buyPrice: 78, currency: 'EUR' });
    const plan = fns._pfPlanMerge([{ ticker: 'SAN', name: 'Santander', quantity: 500, buyPrice: 3.2, currentPrice: 4.45, currency: 'EUR', exchangeRate: 1 }]);
    expect(plan[0].action).toBe('add');
  });

  test('divisas distintas NO se promedian: se marca conflicto', () => {
    APP.portfolio.push({ id: 'a1', ticker: 'AAPL', quantity: 8, buyPrice: 165, currency: 'USD' });
    const plan = fns._pfPlanMerge([{ ticker: 'AAPL', name: 'Apple', quantity: 2, buyPrice: 150, currentPrice: 227, currency: 'EUR', exchangeRate: 1 }]);
    expect(plan[0].action).toBe('conflict');
    expect(plan[0].reason).toMatch(/USD|EUR/);
  });

  test('la comparación de ticker no distingue mayúsculas', () => {
    APP.portfolio.push({ id: 'a1', ticker: 'vwrl', quantity: 20, buyPrice: 78, currency: 'EUR' });
    const plan = fns._pfPlanMerge([{ ticker: 'VWRL', quantity: 10, buyPrice: 91, currency: 'EUR' }]);
    expect(plan[0].action).toBe('merge');
  });
});

describe('Normalización de divisa y clase de activo', () => {
  test('símbolos y códigos', () => {
    expect(fns._pfCurrency('€')).toBe('EUR');
    expect(fns._pfCurrency('$')).toBe('USD');
    expect(fns._pfCurrency('usd')).toBe('USD');
    expect(fns._pfCurrency('')).toBe('EUR');     // por defecto
  });

  test('clase de activo desde texto libre', () => {
    expect(fns._pfAssetClass('ETF indexado')).toBe('ETF');
    expect(fns._pfAssetClass('Criptomoneda')).toBe('Cripto');
    expect(fns._pfAssetClass('Renta fija')).toBe('Renta fija');
    expect(fns._pfAssetClass('', 'ETH')).toBe('Cripto');  // deducido del ticker
    expect(fns._pfAssetClass('', 'AAPL')).toBe('');       // no se inventa
  });

  test('una divisa no-EUR entra con exchangeRate 1, sin inventarse el cambio', () => {
    const { assets } = fns._pfParseCSV('Symbol,Shares,Avg Cost,Currency\nAAPL,8,165.00,USD');
    expect(assets[0].currency).toBe('USD');
    expect(assets[0].exchangeRate).toBe(1);
  });
});
