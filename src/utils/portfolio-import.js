/* ═══════════════════════════════════════════════════════════════
   FINOVA — portfolio-import.js
   Importador de carteras de bróker: CSV / TSV / Excel / JSON.

   Reutiliza los parsers que ya existen para extractos bancarios
   (_csvSplit, _parseCSVAmt, _parseCSVDate, _detectCsvEncoding,
   _findHeaderRowIdx en script.js) en vez de duplicarlos: la detección
   de delimitador, de codificación y de formato numérico europeo vs
   americano ya estaba resuelta ahí y probada.

   Lo que sí es propio de una cartera, y no existía:
    · Diccionario de alias por bróker para mapear cabeceras
      ("Precio medio", "Average Price", "Cost basis"… → buyPrice).
    · Fusión por ticker con precio medio ponderado: hasta ahora añadir
      dos veces el mismo valor creaba DOS filas en la cartera en vez de
      una posición con su coste medio.
   ═══════════════════════════════════════════════════════════════ */

/* ── Alias de cabecera por campo ──────────────────────────────────
   Se comparan normalizados (minúsculas, sin tildes). El orden importa:
   gana la primera columna cuya cabecera contenga alguno de los alias,
   así que los más específicos van primero. */
const _PF_ALIASES = {
  ticker: ['ticker', 'simbolo', 'symbol', 'isin', 'codigo', 'code', 'instrumento'],
  name: ['nombre del activo', 'asset name', 'nombre', 'producto', 'product', 'name',
    'descripcion', 'description', 'valor', 'security', 'instrument'],
  quantity: ['cantidad', 'quantity', 'participaciones', 'acciones', 'shares', 'units',
    'unidades', 'qty', 'volumen', 'nominal', 'posicion', 'amount of shares'],
  buyPrice: ['precio medio', 'precio de compra', 'precio compra', 'coste medio',
    'average price', 'avg price', 'avg cost', 'cost basis', 'buy price',
    'purchase price', 'precio de coste', 'pmc'],
  currentPrice: ['precio actual', 'ultimo precio', 'cotizacion', 'current price',
    'last price', 'market price', 'price', 'precio'],
  currency: ['divisa', 'moneda', 'currency', 'ccy'],
  assetClass: ['tipo', 'tipo de activo', 'asset class', 'categoria', 'category', 'clase'],
  buyDate: ['fecha de compra', 'fecha compra', 'buy date', 'purchase date', 'fecha', 'date'],
};

/** minúsculas + sin tildes, para comparar cabeceras sin depender del acento. */
function _pfNorm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .split('').filter(c => { const n = c.charCodeAt(0); return n < 768 || n > 879; })
    .join('').replace(/["']/g, '').trim();
}

/**
 * Mapea cabeceras → índices de columna.
 * Dos pasadas: primero coincidencia EXACTA con un alias (evita que
 * "Precio" se lleve la columna antes que "Precio medio"), y solo después
 * coincidencia por inclusión.
 */
function _pfDetectCols(headers) {
  const hdrs = headers.map(_pfNorm);
  const used = new Set();
  const out = {};

  const claim = (field, matcher) => {
    if (out[field] != null) return;
    for (let i = 0; i < hdrs.length; i++) {
      if (used.has(i) || !hdrs[i]) continue;
      if (matcher(hdrs[i])) { out[field] = i; used.add(i); return; }
    }
  };

  for (const [field, aliases] of Object.entries(_PF_ALIASES)) {
    claim(field, h => aliases.includes(h));
  }
  for (const [field, aliases] of Object.entries(_PF_ALIASES)) {
    claim(field, h => aliases.some(a => h.includes(a)));
  }
  return out;
}

/** Normaliza la clase de activo a las que entiende la app. */
function _pfAssetClass(raw, ticker) {
  const s = _pfNorm(raw);
  if (/cripto|crypto|coin|token/.test(s)) return 'Cripto';
  if (/etf|indexado|index/.test(s)) return 'ETF';
  if (/fondo|fund|sicav/.test(s)) return 'Fondos';
  if (/bono|renta fija|bond|fixed/.test(s)) return 'Renta fija';
  if (/accion|stock|equity|share/.test(s)) return 'Acciones';
  // Sin columna de tipo: los tickers de cripto habituales se reconocen solos.
  if (/^(btc|eth|sol|ada|xrp|dot|doge|matic|bnb|ltc|link|avax)$/i.test(String(ticker || '').trim())) return 'Cripto';
  return '';
}

/** Divisa en código ISO de 3 letras; EUR si no se reconoce. */
function _pfCurrency(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z€$£]/g, '');
  if (!s) return 'EUR';
  if (s.includes('€') || s.includes('EUR')) return 'EUR';
  if (s.includes('$') || s.includes('USD')) return 'USD';
  if (s.includes('£') || s.includes('GBP')) return 'GBP';
  const m = s.match(/[A-Z]{3}/);
  return m ? m[0] : 'EUR';
}

/**
 * Filas (array de arrays) → activos normalizados al esquema real de la app.
 * Devuelve { assets, errors } — las filas que no se pueden aprovechar NO se
 * descartan en silencio: se devuelven con el motivo para enseñarlo.
 */
function _pfRowsToAssets(rows) {
  const errors = [];
  const assets = [];
  if (!rows || rows.length < 2) {
    return { assets, errors, diag: 'El archivo no tiene suficientes filas.' };
  }

  const headerIdx = typeof _findHeaderRowIdx === 'function' ? _findHeaderRowIdx(rows) : 0;
  const headers = (rows[headerIdx] || []).map(h => String(h ?? '').trim());
  const cols = _pfDetectCols(headers);

  if (cols.ticker == null && cols.name == null) {
    return {
      assets, errors,
      diag: `No se encontró ninguna columna de ticker ni de nombre. Cabeceras detectadas: ${headers.filter(Boolean).join(', ') || '(ninguna)'}`,
    };
  }
  if (cols.quantity == null) {
    return {
      assets, errors,
      diag: `No se encontró la columna de cantidad. Cabeceras detectadas: ${headers.filter(Boolean).join(', ') || '(ninguna)'}`,
    };
  }

  const cell = (row, idx) => (idx == null ? '' : String(row[idx] ?? '').trim());

  rows.slice(headerIdx + 1).forEach((row, i) => {
    const lineNo = headerIdx + i + 2; // 1-based, contando la cabecera
    if (!row || row.every(c => !String(c ?? '').trim())) return; // fila vacía: se ignora sin ruido

    const ticker = cell(row, cols.ticker).toUpperCase();
    const name = cell(row, cols.name) || ticker;
    if (!ticker && !name) { errors.push({ line: lineNo, reason: 'Sin ticker ni nombre' }); return; }

    const quantity = _parseCSVAmt(cell(row, cols.quantity));
    if (!(quantity > 0)) {
      errors.push({ line: lineNo, reason: `Cantidad no válida ("${cell(row, cols.quantity)}")`, name: name || ticker });
      return;
    }

    const buyPrice = _parseCSVAmt(cell(row, cols.buyPrice));
    if (!(buyPrice > 0)) {
      errors.push({ line: lineNo, reason: 'Falta el precio de compra', name: name || ticker });
      return;
    }

    // Sin precio actual en el archivo se usa el de compra: la posición entra
    // con 0 % de rentabilidad en vez de inventarse una cotización.
    // hasCurrentPrice distingue "el archivo traía cotización" de "se rellenó
    // con el precio de compra". Sin esa marca, al FUSIONAR no había forma de
    // saberlo (currentPrice nunca es 0) y se machacaba el precio vivo ya
    // guardado con el de compra, evaporando la ganancia mostrada.
    const currentRaw = _parseCSVAmt(cell(row, cols.currentPrice));
    const hasCurrentPrice = currentRaw > 0;
    const currentPrice = hasCurrentPrice ? currentRaw : buyPrice;

    const currency = _pfCurrency(cell(row, cols.currency));
    const buyDate = cols.buyDate != null && typeof _parseCSVDate === 'function'
      ? _parseCSVDate(cell(row, cols.buyDate)) : '';

    assets.push({
      ticker: ticker || name.slice(0, 12).toUpperCase(),
      name,
      quantity,
      buyPrice,
      currentPrice,
      hasCurrentPrice,
      currency,
      // exchangeRate = euros por 1 unidad de la divisa. No se inventa: si no
      // es EUR se deja a 1 y se avisa, porque un tipo de cambio inventado
      // falsearía el patrimonio entero.
      exchangeRate: 1,
      buyDate: buyDate || '',
      sector: '',
      country: '',
      assetClass: _pfAssetClass(cell(row, cols.assetClass), ticker),
    });
  });

  return { assets, errors, cols, headers };
}

/** JSON: array de activos (o {assets:[...]} / {portfolio:[...]}). */
function _pfParseJSON(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { assets: [], errors: [], diag: 'El archivo no es JSON válido.' }; }

  const arr = Array.isArray(data) ? data
    : Array.isArray(data.assets) ? data.assets
      : Array.isArray(data.portfolio) ? data.portfolio : null;
  if (!arr) return { assets: [], errors: [], diag: 'El JSON debe ser un array de activos (o {"assets": [...]}).' };

  const errors = [];
  const assets = [];
  arr.forEach((o, i) => {
    if (!o || typeof o !== 'object') { errors.push({ line: i + 1, reason: 'Elemento no es un objeto' }); return; }
    // Se aceptan tanto las claves del esquema interno como las del brief.
    const ticker = String(o.ticker ?? o.symbol ?? '').toUpperCase().trim();
    const name = String(o.name ?? o.asset_name ?? o.assetName ?? ticker).trim();
    const quantity = _num(o.quantity ?? o.qty ?? o.units);
    const buyPrice = _num(o.buyPrice ?? o.buy_price ?? o.avgPrice ?? o.averagePrice);
    if (!ticker && !name) { errors.push({ line: i + 1, reason: 'Sin ticker ni nombre' }); return; }
    if (!(quantity > 0)) { errors.push({ line: i + 1, reason: 'Cantidad no válida', name: name || ticker }); return; }
    if (!(buyPrice > 0)) { errors.push({ line: i + 1, reason: 'Falta el precio de compra', name: name || ticker }); return; }
    const currentRaw = _num(o.currentPrice ?? o.current_price ?? o.price);
    const hasCurrentPrice = currentRaw > 0;
    assets.push({
      ticker: ticker || name.slice(0, 12).toUpperCase(),
      name,
      quantity,
      buyPrice,
      currentPrice: hasCurrentPrice ? currentRaw : buyPrice,
      hasCurrentPrice,
      currency: _pfCurrency(o.currency),
      exchangeRate: _num(o.exchangeRate) > 0 ? _num(o.exchangeRate) : 1,
      buyDate: String(o.buyDate ?? o.buy_date ?? '').slice(0, 10),
      sector: String(o.sector ?? ''),
      country: String(o.country ?? ''),
      assetClass: _pfAssetClass(o.assetClass ?? o.asset_class, ticker),
    });
  });
  return { assets, errors };
}

/**
 * Fusiona por ticker contra la cartera actual, calculando el precio medio
 * ponderado — el "upsert" de esta app, que no tiene base de datos por activo:
 * la cartera ES APP.portfolio.
 *
 *   nuevoPrecioMedio = (qty_actual × precio_actual + qty_nueva × precio_nueva)
 *                      / (qty_actual + qty_nueva)
 *
 * Hasta ahora no existía: añadir dos compras del mismo valor dejaba DOS filas
 * separadas en la cartera, y el usuario tenía que calcular el medio a mano.
 */
function _pfPlanMerge(incoming) {
  const plan = [];
  incoming.forEach(inc => {
    const existing = (APP.portfolio || []).find(
      a => String(a.ticker || '').toUpperCase() === inc.ticker.toUpperCase()
    );
    if (!existing) { plan.push({ action: 'add', incoming: inc }); return; }

    // Promediar precios de divisas distintas no significa nada: se deja la
    // decisión al usuario en vez de mezclar euros con dólares.
    if (_pfCurrency(existing.currency) !== inc.currency) {
      plan.push({ action: 'conflict', incoming: inc, existing,
        reason: `Ya tienes ${inc.ticker} en ${_pfCurrency(existing.currency)} y el archivo lo trae en ${inc.currency}` });
      return;
    }

    const qE = _num(existing.quantity), qI = inc.quantity;
    const pE = _num(existing.buyPrice), pI = inc.buyPrice;
    const qT = qE + qI;
    plan.push({
      action: 'merge', incoming: inc, existing,
      mergedQuantity: qT,
      mergedBuyPrice: qT > 0 ? (qE * pE + qI * pI) / qT : pI,
    });
  });
  return plan;
}

/* ── Entrada ──────────────────────────────────────────────────── */

function importPortfolioFile() {
  if (typeof requireAccountFor === 'function' && !requireAccountFor('importar una cartera')) return;
  document.getElementById('portfolio-import-input')?.click();
}

function handlePortfolioImportFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (['xls', 'xlsx', 'xlsm', 'ods'].includes(ext)) return _pfReadExcel(file);
  if (ext === 'json') return _pfReadText(file, 'json');
  return _pfReadText(file, 'csv');
}

function _pfReadText(file, kind) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const enc = typeof _detectCsvEncoding === 'function' ? _detectCsvEncoding(e.target.result) : 'utf-8';
      const text = new TextDecoder(enc).decode(e.target.result);
      const res = kind === 'json' ? _pfParseJSON(text) : _pfParseCSV(text);
      _pfHandleResult(res, kind === 'json' ? 'JSON' : 'CSV');
    } catch (err) {
      console.error('[Finova] Import cartera:', err);
      showToast('No se pudo leer el archivo. Comprueba que es un export de cartera válido.', 'error');
    }
  };
  reader.onerror = () => showToast('Error al leer el archivo.', 'error');
  reader.readAsArrayBuffer(file);
}

/** CSV/TSV: el delimitador se decide por el que más aparece en las primeras filas. */
function _pfParseCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { assets: [], errors: [], diag: 'El archivo no tiene suficientes filas.' };
  const probe = lines.slice(0, 15);
  const count = ch => probe.reduce((s, l) => s + (l.split(ch).length - 1), 0);
  const sep = [[';', count(';')], [',', count(',')], ['\t', count('\t')], ['|', count('|')]]
    .sort((a, b) => b[1] - a[1])[0][0];
  return _pfRowsToAssets(lines.map(l => _csvSplit(l, sep)));
}

async function _pfReadExcel(file) {
  if (typeof XLSX === 'undefined') {
    showToast('Preparando el lector de Excel…', 'info');
    try { await _ensureScript(_XLSX_CDN); }
    catch { return showToast('No se pudo cargar el lector de Excel. Comprueba tu conexión.', 'error'); }
    if (typeof XLSX === 'undefined') return showToast('No se pudo cargar el lector de Excel.', 'error');
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      // Primera hoja con datos aprovechables: muchos brokers dejan una hoja
      // de portada antes de la de posiciones.
      let res = null;
      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
          header: 1, raw: false, defval: '', blankrows: false,
        });
        const attempt = _pfRowsToAssets(rows);
        if (attempt.assets.length) { res = attempt; break; }
        if (!res) res = attempt; // guarda el primer diagnóstico por si ninguna sirve
      }
      _pfHandleResult(res || { assets: [], errors: [] }, 'Excel');
    } catch (err) {
      console.error('[Finova] Import cartera Excel:', err);
      showToast('No se pudo leer el archivo Excel.', 'error');
    }
  };
  reader.onerror = () => showToast('Error al leer el archivo.', 'error');
  reader.readAsArrayBuffer(file);
}

function _pfHandleResult(res, sourceLabel) {
  if (!res.assets.length) {
    const msg = res.diag || 'No se encontró ninguna posición en el archivo.';
    console.warn('[Finova] Import cartera sin resultados:', msg);
    return showToast(msg, 'error');
  }
  _pfShowPreview(res, sourceLabel);
}

/* ── Previsualización antes de confirmar ──────────────────────── */

let _pfPendingPlan = null;

function _pfShowPreview(res, sourceLabel) {
  const plan = _pfPlanMerge(res.assets);
  _pfPendingPlan = plan;

  const adds = plan.filter(p => p.action === 'add').length;
  const merges = plan.filter(p => p.action === 'merge').length;
  const conflicts = plan.filter(p => p.action === 'conflict');
  const nonEur = res.assets.filter(a => a.currency !== 'EUR');

  const rows = plan.map(p => {
    const inc = p.incoming;
    const badge = p.action === 'add'
      ? '<span style="color:var(--up)">Nueva</span>'
      : p.action === 'merge'
        ? '<span style="color:var(--accent)">Fusionar</span>'
        : '<span style="color:var(--down)" title="' + escapeHtml(p.reason) + '">Conflicto</span>';
    const qty = p.action === 'merge'
      ? `${_num(p.existing.quantity)} + ${inc.quantity} = <strong>${p.mergedQuantity}</strong>`
      : String(inc.quantity);
    const price = p.action === 'merge'
      ? `${formatCurrency(_num(p.existing.buyPrice))} → <strong>${formatCurrency(p.mergedBuyPrice)}</strong>`
      : formatCurrency(inc.buyPrice);
    return `<tr>
      <td><strong>${escapeHtml(inc.ticker)}</strong><div style="font-size:11px;color:var(--text-muted)">${escapeHtml(inc.name)}</div></td>
      <td class="text-right">${qty}</td>
      <td class="text-right">${price}</td>
      <td>${inc.currency === 'EUR' ? 'EUR' : `<span style="color:var(--accent)">${escapeHtml(inc.currency)}</span>`}</td>
      <td style="text-align:center">${badge}</td>
    </tr>`;
  }).join('');

  const errHtml = res.errors.length
    ? `<div class="fisc-alert fisc-alert-warning" style="margin-top:12px">
         <strong>${res.errors.length} fila${res.errors.length > 1 ? 's' : ''} sin importar:</strong>
         <ul style="margin:6px 0 0;padding-left:18px;font-size:12px">
           ${res.errors.slice(0, 6).map(e => `<li>Fila ${e.line}${e.name ? ` (${escapeHtml(e.name)})` : ''}: ${escapeHtml(e.reason)}</li>`).join('')}
           ${res.errors.length > 6 ? `<li>…y ${res.errors.length - 6} más</li>` : ''}
         </ul>
       </div>` : '';

  const fxHtml = nonEur.length
    ? `<div class="fisc-alert fisc-alert-info" style="margin-top:12px">
         ${nonEur.length} posición${nonEur.length > 1 ? 'es' : ''} en divisa distinta del euro
         (${[...new Set(nonEur.map(a => a.currency))].join(', ')}). Se importan con tipo de cambio 1:
         <strong>edítalo después en cada activo</strong> — Finova no inventa un tipo de cambio,
         falsearía tu patrimonio.
       </div>` : '';

  const conflictHtml = conflicts.length
    ? `<div class="fisc-alert fisc-alert-warning" style="margin-top:12px">
         ${conflicts.length} posición${conflicts.length > 1 ? 'es' : ''} con conflicto de divisa no se
         importará${conflicts.length > 1 ? 'n' : ''}: ${conflicts.map(c => escapeHtml(c.incoming.ticker)).join(', ')}.
       </div>` : '';

  openModal(`Importar cartera — ${sourceLabel}`, `
    <p style="font-size:13px;color:var(--text-secondary);margin:0 0 10px">
      <strong style="color:var(--up)">${adds} nueva${adds !== 1 ? 's' : ''}</strong>
      ${merges ? ` · <strong style="color:var(--accent)">${merges} a fusionar</strong> (precio medio ponderado)` : ''}
      ${conflicts.length ? ` · <strong style="color:var(--down)">${conflicts.length} con conflicto</strong>` : ''}
    </p>
    <div class="table-wrapper" style="max-height:320px;overflow:auto">
      <table class="data-table">
        <thead><tr>
          <th>Activo</th><th class="text-right">Cantidad</th>
          <th class="text-right">Precio compra</th><th>Divisa</th><th style="text-align:center">Acción</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${conflictHtml}${fxHtml}${errHtml}
  `, () => _pfCommit());

  const btn = document.getElementById('modalConfirm');
  if (btn) btn.textContent = `Importar ${adds + merges} posiciones`;
}

function _pfCommit() {
  const plan = _pfPendingPlan;
  _pfPendingPlan = null;
  if (!plan) return;

  if (!APP.portfolio) APP.portfolio = [];
  let added = 0, merged = 0;

  plan.forEach(p => {
    if (p.action === 'conflict') return;
    const inc = p.incoming;
    if (p.action === 'merge') {
      const idx = APP.portfolio.findIndex(a => a.id === p.existing.id);
      if (idx >= 0) {
        APP.portfolio[idx] = {
          ...APP.portfolio[idx],
          quantity: p.mergedQuantity,
          buyPrice: p.mergedBuyPrice,
          // Solo se pisa el precio actual si el archivo traía cotización DE
          // VERDAD. Si no la traía, el parser lo rellenó con el de compra, y
          // darlo por bueno aquí machacaría el precio vivo ya guardado.
          currentPrice: inc.hasCurrentPrice
            ? inc.currentPrice
            : _num(APP.portfolio[idx].currentPrice) || inc.currentPrice,
        };
        merged++;
      }
      return;
    }
    APP.portfolio.push({
      id: generateId(),
      name: inc.name,
      ticker: inc.ticker,
      buyPrice: inc.buyPrice,
      currentPrice: inc.currentPrice,
      quantity: inc.quantity,
      buyDate: inc.buyDate,
      country: inc.country,
      sector: inc.sector,
      currency: inc.currency,
      exchangeRate: inc.exchangeRate,
    });
    added++;
  });

  updateNetworthHistory();
  saveData();
  closeModal();
  if (typeof renderPortfolio === 'function') renderPortfolio();
  if (typeof renderDashboard === 'function') renderDashboard();
  showToast(`${added} posiciones añadidas${merged ? ` · ${merged} fusionadas con precio medio` : ''} ✓`, 'success');
}
