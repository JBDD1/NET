'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — CAPA SEMÁNTICA DE IMPORTACIÓN

   Decide QUÉ SIGNIFICA cada columna de una tabla, sin depender de que se
   llame de una forma concreta.

   ── Las dos evidencias ──
   Cada candidatura se puntúa con dos cosas independientes:

     1. La CABECERA. «Fecha operación», «Trade Date» y «Data operació»
        apuntan al mismo campo.
     2. El CONTENIDO. Una columna de fechas contiene fechas; una de ISIN
        contiene códigos que pasan su dígito de control; una de divisas
        contiene códigos ISO de tres letras.

   Ninguna de las dos basta sola. Una cabecera llamada «Importe» en una
   columna de texto no es un importe, y una columna de números sin cabecera
   reconocible podría ser cualquier cosa. Se exige que las dos apunten en la
   misma dirección, y donde no lo hacen se baja la confianza o no se asigna.

   ── La regla que lo gobierna ──
   «Si un archivo contiene columnas desconocidas, intenta identificar su
   significado, pero NUNCA asignes una interpretación sin suficiente
   evidencia.» Por eso todo campo sale con `confianza` y con los motivos que
   la sostienen, y por eso existe el resultado «no asignado»: es información,
   no un fallo.
═══════════════════════════════════════════════════════════════ */

/* ─── 1. Validadores de contenido ─────────────────────────────── */

const IE_RE_ISO_DATE  = /^\d{4}-\d{1,2}-\d{1,2}([T ]|$)/;
const IE_RE_DMY       = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/;
const IE_RE_YMD_COMP  = /^\d{8}$/;
const IE_RE_MES_TXT   = /^\d{1,2}[\/\- ](?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|jan|apr|aug|dec)/i;

/** ¿Esta celda parece una fecha? */
function ieEsFecha(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  if (IE_RE_ISO_DATE.test(s)) return true;
  if (IE_RE_DMY.test(s)) return true;
  if (IE_RE_MES_TXT.test(s)) return true;
  // AAAAMMDD: se exige que el mes y el día sean plausibles, o un número de
  // ocho cifras cualquiera (un identificador de operación, por ejemplo)
  // contaría como fecha.
  if (IE_RE_YMD_COMP.test(s)) {
    const mes = Number(s.slice(4, 6)), dia = Number(s.slice(6, 8));
    return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
  }
  return false;
}

/**
 * ¿Parece un número? Se admiten los formatos europeo y anglosajón, el signo
 * delante o detrás, los paréntesis contables y los símbolos de divisa.
 */
function ieEsNumero(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  // Una fecha es una secuencia de números con separadores: se excluye antes,
  // o media columna de fechas puntuaría como numérica.
  if (ieEsFecha(s)) return false;
  return /^[\s(+-]*[€$£¥]?\s*\d[\d.,\s']*\s*[€$£¥%]?\s*[)\-+]?$/.test(s);
}

/** Valor numérico de una celda, con los dos formatos decimales. */
function ieNum(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[€$£¥%\s']/g, '');
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }   // signo detrás: «45,30-»
  if (/^-/.test(s)) { neg = true; s = s.slice(1); }
  else if (/^\+/.test(s)) s = s.slice(1);
  const ultComa = s.lastIndexOf(','), ultPunto = s.lastIndexOf('.');
  if (ultComa > ultPunto) s = s.replace(/\./g, '').replace(',', '.');
  else if (ultPunto > ultComa) s = s.replace(/,/g, '');
  else if (ultComa === -1 && ultPunto === -1) { /* entero */ }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/**
 * ISIN con su dígito de control. Es la validación más valiosa de todo el
 * fichero: un ISIN correcto es una evidencia casi definitiva, y permite
 * distinguir la columna de ISIN de la de cualquier otra referencia
 * alfanumérica sin depender de cómo se llame.
 *
 * Algoritmo: letras → su posición (A=10 … Z=35), concatenar, y Luhn.
 */
function ieEsISIN(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s)) return false;
  let digitos = '';
  for (const c of s) {
    digitos += (c >= '0' && c <= '9') ? c : String(c.charCodeAt(0) - 55);
  }
  let suma = 0, doblar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = Number(digitos[i]);
    if (doblar) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
    doblar = !doblar;
  }
  return suma % 10 === 0;
}

// Códigos ISO 4217 de las divisas que un usuario español se va a encontrar,
// más las cripto más habituales. No es la lista completa de ISO: una lista
// corta y cierta vale más que una larga con entradas inventadas, y lo que no
// esté se detecta por la forma (tres letras mayúsculas) con menos confianza.
const IE_DIVISAS = new Set([
  'EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK',
  'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'TRY', 'MXN', 'BRL', 'ARS', 'CLP', 'COP',
  'PEN', 'CNY', 'HKD', 'SGD', 'KRW', 'INR', 'ZAR', 'ILS', 'AED', 'SAR',
]);
const IE_CRIPTO = new Set([
  'BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'DOT',
  'MATIC', 'LTC', 'TRX', 'AVAX', 'LINK', 'ATOM', 'XLM', 'ALGO', 'DAI', 'BUSD',
  'SHIB', 'UNI', 'ETC', 'FIL', 'NEAR', 'ICP', 'APT', 'ARB', 'OP', 'EUROC',
]);

function ieEsDivisa(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (IE_DIVISAS.has(s) || IE_CRIPTO.has(s)) return true;
  // Símbolos sueltos.
  if (/^[€$£¥]$/.test(s)) return true;
  return false;
}

/** Tres letras mayúsculas: podría ser una divisa, con menos certeza. */
function ieFormaDivisa(v) {
  return /^[A-Z]{3}$/.test(String(v == null ? '' : v).trim().toUpperCase());
}

/**
 * ¿Parece un ticker? Letras mayúsculas, a veces con punto y sufijo de
 * mercado (SAN.MC, VOD.L) o con guion (BRK-B). Se excluyen las palabras
 * largas, que son nombres, y las que llevan espacios.
 */
function ieEsTicker(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || /\s/.test(s)) return false;
  if (s.length > 12) return false;
  if (ieEsISIN(s)) return false;        // un ISIN no es un ticker
  return /^[A-Z0-9]{1,8}(?:[.\-/][A-Z0-9]{1,4})?$/.test(s.toUpperCase()) && /[A-Z]/i.test(s);
}

/** IBAN: 2 letras + 2 dígitos + hasta 30 alfanuméricos. */
function ieEsIBAN(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s/g, '');
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s);
}

/** Texto libre: lo que no es número, ni fecha, ni código. */
function ieEsTexto(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  if (ieEsNumero(s) || ieEsFecha(s)) return false;
  return s.length >= 2;
}

/* ─── 2. Normalización de cabeceras ───────────────────────────── */

/**
 * Normaliza una cabecera para comparar: minúsculas, sin tildes, sin signos
 * de puntuación y con los espacios colapsados.
 *
 * Se quitan también las unidades entre paréntesis y los sufijos de divisa
 * que los brókers añaden («Importe (EUR)», «Market Value USD»): la divisa es
 * un dato que se captura aparte y, dejada en la cabecera, impide que
 * «Importe (EUR)» case con el alias «importe».
 */
function ieNormHeader(h) {
  return String(h == null ? '' : h)
    .replace(/["']/g, '')
    .normalize('NFD')
    .split('').filter(c => { const n = c.charCodeAt(0); return n < 768 || n > 879; }).join('')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita el sufijo de divisa de una cabecera ya normalizada. */
function ieSinDivisa(h) {
  return h.replace(/\b(eur|usd|gbp|chf|jpy|euros?|dolares?|dollars?)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* ─── 3. Catálogo de campos ───────────────────────────────────── */

/*
 * Cada campo declara:
 *   exactos   — cabeceras que lo identifican sin duda
 *   contiene  — fragmentos que lo sugieren
 *   excluye   — fragmentos que lo DESCARTAN aunque case lo anterior
 *   valida    — validador de contenido
 *   grupo     — para resolver conflictos entre campos del mismo tipo
 *
 * `excluye` es lo que evita los errores que el encargo señala uno por uno:
 * sin él «Precio de compra» case con «precio» igual que «Precio actual», y
 * «Valor de mercado» igual que «Coste de adquisición».
 */
const IE_CAMPOS = {
  /* ── Fechas ── */
  fechaOperacion: {
    etiqueta: 'Fecha de operación', grupo: 'fecha', valida: ieEsFecha,
    exactos: ['fecha', 'fecha operacion', 'fecha de operacion', 'fecha de la operacion',
      'f operacion', 'fecha movimiento', 'fecha de movimiento', 'date', 'trade date',
      'transaction date', 'operation date', 'data', 'data operacio', 'datum',
      'fecha ejecucion', 'execution date', 'fecha compra', 'purchase date', 'dealing date',
      // Las exportaciones de exchanges y APIs usan casi siempre una de estas.
      'time', 'timestamp', 'datetime', 'date time', 'fecha hora', 'created at',
      'executed at', 'started date', 'completed date', 'utc time', 'date utc'],
    contiene: ['fecha oper', 'trade date', 'transaction date', 'fecha movim', 'date of transaction'],
    excluye: ['valor', 'value', 'liquidac', 'settle', 'contab', 'booking', 'vencim', 'maturity',
      'alta', 'baja', 'nacim', 'emision', 'pago', 'payment', 'cobro', 'ex div', 'exdiv'],
  },
  fechaValor: {
    etiqueta: 'Fecha valor', grupo: 'fecha', valida: ieEsFecha,
    exactos: ['fecha valor', 'f valor', 'value date', 'val date', 'data valor', 'valuta'],
    contiene: ['fecha valor', 'value date', 'valuta'],
    excluye: [],
  },
  fechaContable: {
    etiqueta: 'Fecha contable', grupo: 'fecha', valida: ieEsFecha,
    exactos: ['fecha contable', 'fecha contabilizacion', 'booking date', 'posted date',
      'post date', 'fecha apunte', 'buchungstag'],
    contiene: ['contab', 'booking', 'posted'],
    excluye: [],
  },
  fechaLiquidacion: {
    etiqueta: 'Fecha de liquidación', grupo: 'fecha', valida: ieEsFecha,
    exactos: ['fecha liquidacion', 'fecha de liquidacion', 'settlement date', 'settle date',
      'f liquidacion', 'data liquidacio'],
    contiene: ['liquidac', 'settle'],
    excluye: [],
  },
  fechaPago: {
    etiqueta: 'Fecha de pago', grupo: 'fecha', valida: ieEsFecha,
    exactos: ['fecha pago', 'fecha de pago', 'payment date', 'pay date', 'fecha abono',
      'fecha cobro', 'fecha reparto'],
    contiene: ['fecha pago', 'payment date', 'fecha abono'],
    excluye: [],
  },

  /* ── Texto ── */
  descripcion: {
    etiqueta: 'Descripción', grupo: 'texto', valida: ieEsTexto,
    exactos: ['descripcion', 'concepto', 'description', 'concept', 'detalle', 'detail',
      'details', 'movimiento', 'movement', 'memo', 'narrative', 'narrativa', 'texto',
      'observaciones', 'descripcio', 'concepte', 'referencia descriptiva', 'operacion'],
    contiene: ['descripc', 'concepto', 'narrative', 'detalle', 'memo'],
    excluye: ['tipo', 'type', 'categoria', 'category', 'estado', 'status'],
  },
  contrapartida: {
    etiqueta: 'Contrapartida', grupo: 'texto', valida: ieEsTexto,
    exactos: ['beneficiario', 'ordenante', 'contrapartida', 'payee', 'merchant', 'comercio',
      'establecimiento', 'counterparty', 'name', 'nombre ordenante', 'destinatario',
      'remitente', 'payer', 'receiver', 'to', 'from'],
    contiene: ['beneficiar', 'ordenante', 'payee', 'merchant', 'counterpart', 'establecim'],
    excluye: ['activo', 'asset', 'valor', 'security', 'fondo', 'cuenta', 'account'],
  },
  nombreActivo: {
    etiqueta: 'Nombre del activo', grupo: 'texto', valida: ieEsTexto,
    exactos: ['nombre', 'activo', 'producto', 'valor', 'denominacion', 'name', 'asset',
      'asset name', 'security', 'security name', 'instrument', 'instrumento', 'product',
      'fondo', 'fund', 'fund name', 'descripcion del valor', 'nombre del activo',
      'nombre valor', 'company', 'empresa'],
    contiene: ['nombre activo', 'asset name', 'security name', 'nombre del valor',
      'denominacion', 'instrument'],
    excluye: ['cuenta', 'account', 'ordenante', 'beneficiar', 'tipo', 'type', 'clase',
      'class', 'divisa', 'currency', 'mercado', 'market', 'exchange'],
  },
  tipoOperacion: {
    etiqueta: 'Tipo de operación', grupo: 'clasif', valida: ieEsTexto,
    exactos: ['tipo', 'tipo operacion', 'tipo de operacion', 'type', 'transaction type',
      'operation', 'operacion tipo', 'side', 'accion', 'action', 'buy sell', 'b s',
      'tipus', 'movimiento tipo', 'concepto tipo', 'direction'],
    contiene: ['tipo de oper', 'transaction type', 'order type', 'trade type'],
    excluye: ['activo', 'asset type', 'clase', 'cuenta'],
  },
  categoriaOrigen: {
    etiqueta: 'Categoría del archivo', grupo: 'clasif', valida: ieEsTexto,
    exactos: ['categoria', 'category', 'categoria gasto', 'rubro', 'clasificacion',
      'subcategoria', 'subcategory'],
    contiene: ['categor'],
    excluye: ['activo', 'asset'],
  },
  tipoActivo: {
    etiqueta: 'Tipo de activo', grupo: 'clasif', valida: ieEsTexto,
    exactos: ['tipo activo', 'tipo de activo', 'asset type', 'asset class', 'clase de activo',
      'instrument type', 'tipo instrumento', 'security type', 'producto tipo'],
    contiene: ['tipo de activo', 'asset type', 'asset class', 'clase de activo', 'security type'],
    excluye: [],
  },

  /* ── Códigos ── */
  isin: {
    etiqueta: 'ISIN', grupo: 'codigo', valida: ieEsISIN,
    exactos: ['isin', 'codigo isin', 'isin code', 'isin cusip', 'identificador'],
    contiene: ['isin'],
    excluye: [],
  },
  ticker: {
    etiqueta: 'Ticker', grupo: 'codigo', valida: ieEsTicker,
    exactos: ['ticker', 'simbolo', 'symbol', 'codigo', 'code', 'epic', 'mnemo',
      'ticker symbol', 'instrumento codigo', 'asset', 'moneda', 'coin', 'currency pair', 'pair', 'par'],
    contiene: ['ticker', 'symbol', 'simbolo'],
    excluye: ['isin', 'cuenta', 'account', 'referencia', 'operacion', 'order'],
  },
  idOperacion: {
    etiqueta: 'Identificador de la operación', grupo: 'codigo', valida: ieEsTexto,
    exactos: ['id', 'id operacion', 'referencia', 'reference', 'ref', 'transaction id',
      'trade id', 'order id', 'operation id', 'num operacion', 'numero de operacion',
      'txid', 'tx id', 'hash', 'fitid', 'identificador operacion', 'num apunte',
      'referencia operacion', 'confirmation'],
    contiene: ['transaction id', 'trade id', 'order id', 'txid', 'referencia oper', 'num operacion'],
    excluye: ['isin', 'ticker', 'symbol', 'cuenta', 'account', 'divisa'],
  },
  cuenta: {
    etiqueta: 'Cuenta', grupo: 'codigo', valida: ieEsTexto,
    exactos: ['cuenta', 'account', 'account number', 'num cuenta', 'numero de cuenta',
      'iban', 'cuenta origen', 'cuenta cargo', 'compte', 'wallet', 'direccion', 'address'],
    contiene: ['cuenta', 'account', 'iban', 'wallet'],
    excluye: ['beneficiar', 'destino', 'destination'],
  },
  cuentaDestino: {
    etiqueta: 'Cuenta de destino', grupo: 'codigo', valida: ieEsTexto,
    exactos: ['cuenta destino', 'cuenta de destino', 'destination account', 'to account',
      'destino', 'destination', 'cuenta abono', 'destination address', 'to address'],
    contiene: ['cuenta destino', 'destination', 'cuenta abono', 'to address'],
    excluye: [],
  },
  divisa: {
    etiqueta: 'Divisa', grupo: 'divisa', valida: ieEsDivisa,
    exactos: ['divisa', 'moneda', 'currency', 'ccy', 'curr', 'divisa operacion', 'moneda origen'],
    contiene: ['divisa', 'moneda', 'currency'],
    excluye: ['importe', 'amount', 'precio', 'price', 'cambio', 'rate'],
  },

  /* ── Importes ── */
  importe: {
    etiqueta: 'Importe', grupo: 'importe', valida: ieEsNumero,
    exactos: ['importe', 'amount', 'import', 'importe operacion', 'importe total', 'total',
      'valor operacion', 'net amount', 'importe neto', 'gross amount', 'importe bruto',
      'money in out', 'value', 'efectivo'],
    contiene: ['importe', 'amount'],
    excluye: ['saldo', 'balance', 'comision', 'fee', 'commission', 'impuesto', 'tax',
      'retenc', 'cantidad', 'quantity', 'units', 'titulos', 'shares', 'precio', 'price',
      'coste', 'cost', 'mercado', 'market', 'divisa', 'currency', 'rentab', 'yield',
      'ganancia', 'gain', 'perdida', 'loss', 'cargo', 'debit', 'abono', 'credit'],
  },
  cargo: {
    etiqueta: 'Cargo (debe)', grupo: 'importe', valida: ieEsNumero,
    exactos: ['cargo', 'cargos', 'debe', 'debito', 'debit', 'paid out', 'money out',
      'withdrawal', 'retirada', 'salida', 'importe cargo'],
    contiene: ['cargo', 'debit', 'paid out', 'money out', 'withdrawal'],
    excluye: ['abono', 'credit', 'saldo'],
  },
  abono: {
    etiqueta: 'Abono (haber)', grupo: 'importe', valida: ieEsNumero,
    exactos: ['abono', 'abonos', 'haber', 'credito', 'credit', 'paid in', 'money in',
      'deposit', 'ingreso', 'entrada', 'importe abono'],
    contiene: ['abono', 'credit', 'paid in', 'money in', 'deposit'],
    excluye: ['cargo', 'debit', 'saldo'],
  },
  saldo: {
    etiqueta: 'Saldo', grupo: 'importe', valida: ieEsNumero,
    exactos: ['saldo', 'balance', 'saldo posterior', 'running balance', 'saldo disponible',
      'saldo contable', 'saldo final', 'closing balance'],
    contiene: ['saldo', 'balance'],
    excluye: ['divisa', 'currency', 'mercado'],
  },
  comision: {
    etiqueta: 'Comisión', grupo: 'coste', valida: ieEsNumero,
    exactos: ['comision', 'comisiones', 'fee', 'fees', 'commission', 'gastos', 'corretaje',
      'brokerage', 'canon', 'coste operacion', 'comissio', 'network fee', 'gas fee', 'trading fee'],
    contiene: ['comision', 'fee', 'commission', 'corretaje', 'canon'],
    excluye: ['impuesto', 'tax', 'retenc', 'divisa'],
  },
  impuestos: {
    etiqueta: 'Impuestos / retención', grupo: 'coste', valida: ieEsNumero,
    exactos: ['impuestos', 'impuesto', 'retencion', 'retenciones', 'tax', 'taxes',
      'withholding', 'withholding tax', 'irpf', 'iva', 'tax withheld', 'retencion fiscal'],
    contiene: ['impuesto', 'retenc', 'tax', 'withholding', 'irpf'],
    excluye: ['comision', 'fee'],
  },

  /* ── Cantidades y precios ── */
  cantidad: {
    etiqueta: 'Cantidad', grupo: 'cantidad', valida: ieEsNumero,
    exactos: ['cantidad', 'quantity', 'qty', 'titulos', 'numero de titulos', 'participaciones',
      'num participaciones', 'shares', 'units', 'unidades', 'nominal', 'volumen', 'volume',
      'size', 'acciones', 'n acciones', 'quantitat', 'amount of coins', 'coins'],
    contiene: ['cantidad', 'titulos', 'participacion', 'shares', 'units', 'quantity'],
    excluye: ['importe', 'amount', 'precio', 'price', 'valor', 'value', 'coste', 'cost', 'divisa'],
  },
  precioUnitario: {
    etiqueta: 'Precio unitario', grupo: 'precio', valida: ieEsNumero,
    exactos: ['precio', 'price', 'precio unitario', 'unit price', 'precio operacion',
      'precio ejecucion', 'execution price', 'cotizacion', 'preu', 'rate', 'trade price'],
    contiene: ['precio unitario', 'unit price', 'precio de ejecucion', 'execution price'],
    excluye: ['medio', 'average', 'avg', 'coste', 'cost', 'actual', 'current', 'cierre',
      'close', 'mercado', 'market', 'compra', 'purchase', 'adquisicion', 'venta', 'sale'],
  },
  precioMedio: {
    etiqueta: 'Precio medio de adquisición', grupo: 'precio', valida: ieEsNumero,
    exactos: ['precio medio', 'precio medio de compra', 'precio medio de adquisicion',
      'average price', 'avg price', 'average cost', 'coste medio', 'precio compra',
      'precio de compra', 'purchase price', 'buy price', 'cost basis per share',
      'precio adquisicion', 'preu mitja'],
    contiene: ['precio medio', 'average price', 'avg price', 'coste medio', 'precio de compra',
      'purchase price', 'buy price', 'precio de adquisicion'],
    excluye: ['actual', 'current', 'mercado', 'market', 'cierre', 'close'],
  },
  precioActual: {
    etiqueta: 'Precio actual', grupo: 'precio', valida: ieEsNumero,
    exactos: ['precio actual', 'current price', 'last price', 'ultimo precio', 'cotizacion actual',
      'precio de cierre', 'closing price', 'close', 'market price', 'precio mercado',
      'valor liquidativo', 'nav', 'ultima cotizacion'],
    contiene: ['precio actual', 'current price', 'last price', 'precio de cierre',
      'closing price', 'market price', 'valor liquidativo'],
    excluye: ['medio', 'average', 'compra', 'purchase', 'coste', 'cost'],
  },

  /* ── Valoración ── */
  valorMercado: {
    etiqueta: 'Valor de mercado', grupo: 'valoracion', valida: ieEsNumero,
    exactos: ['valor de mercado', 'valor mercado', 'market value', 'mkt value', 'valoracion',
      'valor actual', 'current value', 'position value', 'valor posicion', 'total value',
      'valor efectivo', 'valor razonable', 'fair value'],
    contiene: ['valor de mercado', 'market value', 'valor actual', 'current value',
      'valor posicion', 'valoracion'],
    excluye: ['coste', 'cost', 'adquisicion', 'compra', 'purchase', 'book'],
  },
  costeAdquisicion: {
    etiqueta: 'Coste de adquisición', grupo: 'valoracion', valida: ieEsNumero,
    exactos: ['coste de adquisicion', 'coste adquisicion', 'cost basis', 'coste total',
      'total cost', 'book cost', 'valor de compra', 'importe invertido', 'invertido',
      'inversion', 'acquisition cost', 'book value', 'coste compra'],
    contiene: ['coste de adquisicion', 'cost basis', 'book cost', 'importe invertido',
      'total cost', 'coste total'],
    excluye: ['mercado', 'market', 'actual', 'current'],
  },
  gananciaPerdida: {
    etiqueta: 'Ganancia o pérdida', grupo: 'resultado', valida: ieEsNumero,
    exactos: ['ganancia', 'perdida', 'ganancia perdida', 'resultado', 'p l', 'pnl',
      'profit loss', 'gain loss', 'unrealised p l', 'unrealized p l', 'plusvalia',
      'minusvalia', 'beneficio', 'resultado no realizado', 'resultado realizado'],
    contiene: ['ganancia', 'perdida', 'profit', 'gain loss', 'pnl', 'plusvalia', 'p l'],
    excluye: ['porcentaje', 'percent', 'rentab', 'yield'],
  },
  rentabilidadPct: {
    etiqueta: 'Rentabilidad (%)', grupo: 'resultado', valida: ieEsNumero,
    exactos: ['rentabilidad', 'rentabilidad porcentual', 'return', 'return pct', 'yield',
      'variacion', 'variacion porcentual', 'change pct', 'pct change', 'rendimiento',
      'performance', 'tir', 'roi'],
    contiene: ['rentabilidad', 'return', 'yield', 'variacion porcentual', 'performance'],
    excluye: [],
  },
  dividendoPorAccion: {
    etiqueta: 'Dividendo por acción', grupo: 'dividendo', valida: ieEsNumero,
    exactos: ['dividendo por accion', 'dividendo accion', 'dividend per share', 'dps',
      'importe por accion', 'per share', 'dividendo unitario', 'rate per share'],
    contiene: ['dividendo por accion', 'dividend per share', 'per share'],
    excluye: [],
  },
  tipoCambio: {
    etiqueta: 'Tipo de cambio', grupo: 'cambio', valida: ieEsNumero,
    exactos: ['tipo de cambio', 'tipo cambio', 'exchange rate', 'fx rate', 'fx',
      'cambio', 'conversion rate', 'tasa de cambio'],
    contiene: ['tipo de cambio', 'exchange rate', 'fx rate', 'conversion rate'],
    excluye: ['divisa', 'currency', 'moneda'],
  },
};

/* ─── 4. Puntuación de una candidatura ────────────────────────── */

/**
 * Puntúa la cabecera de una columna contra un campo. Devuelve de 0 a 1.
 *
 * Que un `excluye` anule una coincidencia exacta es deliberado: una cabecera
 * «Precio medio de compra» contiene «precio» exacto para `precioUnitario`,
 * y sin la exclusión las dos columnas de precio de una cartera se
 * intercambiarían. El encargo lo pedía explícitamente.
 */
function iePuntuaCabecera(cabecera, def) {
  const h = ieNormHeader(cabecera);
  if (!h) return { puntos: 0, motivo: '' };
  const hs = ieSinDivisa(h);

  for (const ex of def.excluye || []) {
    if (h.includes(ex)) return { puntos: 0, motivo: '', excluida: ex };
  }

  for (const cand of [h, hs]) {
    if ((def.exactos || []).includes(cand)) {
      return { puntos: 1, motivo: `la cabecera «${cabecera}» es exactamente este campo` };
    }
  }
  for (const frag of def.contiene || []) {
    if (h.includes(frag)) {
      return { puntos: 0.75, motivo: `la cabecera «${cabecera}» contiene «${frag}»` };
    }
  }
  // Coincidencia por palabras: todas las palabras de un alias están en la
  // cabecera, en cualquier orden. Recoge «Date of the transaction» o
  // «Operación: fecha».
  const palabras = new Set(h.split(' ').filter(Boolean));
  for (const alias of def.exactos || []) {
    const pa = alias.split(' ').filter(Boolean);
    if (pa.length >= 2 && pa.every(p => palabras.has(p))) {
      return { puntos: 0.6, motivo: `la cabecera «${cabecera}» tiene todas las palabras de «${alias}»` };
    }
  }
  return { puntos: 0, motivo: '' };
}

/**
 * Puntúa el CONTENIDO de una columna contra el validador de un campo.
 * Devuelve la fracción de celdas no vacías que validan, y cuántas se miraron:
 * una columna con dos celdas que validan no es la misma evidencia que una con
 * doscientas, y la capa de arriba necesita saberlo.
 */
function iePuntuaContenido(celdas, def, limite) {
  const vals = celdas.filter(c => String(c == null ? '' : c).trim() !== '').slice(0, limite || 200);
  if (!vals.length) return { ratio: 0, muestras: 0 };
  const okN = vals.filter(def.valida).length;
  return { ratio: okN / vals.length, muestras: vals.length, validas: okN };
}

/* ─── 5. Detección completa de una tabla ──────────────────────── */

/**
 * Encuentra la fila de cabecera real.
 *
 * Muchos extractos ponen varias filas de título y metadatos antes
 * («Consulta de movimientos», «Cuenta: ES59…»). Se elige la fila que más
 * cabeceras reconocibles tiene, y se exige un mínimo: si ninguna fila
 * destaca, se devuelve -1, que significa «esta tabla no tiene cabecera», y
 * no 0, que significaría tratar la primera fila de datos como cabecera y
 * perderla.
 */
function ieFindHeaderRow(filas, maxScan) {
  const tope = Math.min(filas.length, maxScan || 25);
  let mejor = -1, mejorPuntos = 0;
  for (let i = 0; i < tope; i++) {
    const fila = filas[i] || [];
    const noVacias = fila.filter(c => String(c == null ? '' : c).trim() !== '');
    if (noVacias.length < 2) continue;
    // Una cabecera no contiene números ni fechas: si la mayoría de sus celdas
    // lo son, es una fila de datos.
    const datos = noVacias.filter(c => ieEsNumero(c) || ieEsFecha(c)).length;
    if (datos > noVacias.length / 2) continue;

    let puntos = 0;
    for (const celda of noVacias) {
      let mejorCampo = 0;
      for (const def of Object.values(IE_CAMPOS)) {
        const p = iePuntuaCabecera(celda, def).puntos;
        if (p > mejorCampo) mejorCampo = p;
      }
      puntos += mejorCampo;
    }
    if (puntos > mejorPuntos) { mejorPuntos = puntos; mejor = i; }
  }
  return mejorPuntos >= 1.5 ? mejor : -1;
}

/**
 * Asigna campos a columnas.
 *
 * La asignación es GLOBAL y no columna a columna: se puntúan todos los pares
 * (columna, campo) y se adjudican de mayor a menor, con la regla de que una
 * columna recibe un solo campo y un campo una sola columna. Decidir columna
 * a columna produce el error clásico: la primera columna de fecha se queda
 * con `fechaOperacion` aunque se llame «Fecha valor», porque es la primera
 * que se mira.
 *
 * Devuelve:
 *   campos      { nombreCampo: { col, confianza, motivos[] } }
 *   columnas    [{ idx, cabecera, campo, confianza, motivos[], tipos }]
 *   sinAsignar  [{ idx, cabecera, tipos, nota }]
 */
function ieDetectFields(filas, opciones) {
  const op = opciones || {};
  const idxCab = op.headerRow != null ? op.headerRow : ieFindHeaderRow(filas);
  const cabeceras = idxCab >= 0
    ? (filas[idxCab] || []).map(c => String(c == null ? '' : c).trim())
    : (filas[0] || []).map((_, i) => `Columna ${i + 1}`);
  const datos = filas.slice(idxCab >= 0 ? idxCab + 1 : 0)
    .filter(f => f && f.some(c => String(c == null ? '' : c).trim() !== ''));

  const nCols = Math.max(cabeceras.length, ...datos.map(f => f.length), 0);
  const columnaDe = i => datos.map(f => (f[i] == null ? '' : f[i]));

  // Perfil de contenido de cada columna, una sola vez.
  const perfiles = [];
  for (let i = 0; i < nCols; i++) {
    const celdas = columnaDe(i);
    const vals = celdas.filter(c => String(c).trim() !== '');
    perfiles.push({
      idx: i,
      cabecera: cabeceras[i] || '',
      celdas,
      noVacias: vals.length,
      tipos: {
        fecha:  vals.length ? vals.filter(ieEsFecha).length / vals.length : 0,
        numero: vals.length ? vals.filter(ieEsNumero).length / vals.length : 0,
        isin:   vals.length ? vals.filter(ieEsISIN).length / vals.length : 0,
        ticker: vals.length ? vals.filter(ieEsTicker).length / vals.length : 0,
        divisa: vals.length ? vals.filter(ieEsDivisa).length / vals.length : 0,
        iban:   vals.length ? vals.filter(ieEsIBAN).length / vals.length : 0,
        texto:  vals.length ? vals.filter(ieEsTexto).length / vals.length : 0,
      },
    });
  }

  // Todos los pares posibles, con su puntuación combinada.
  const pares = [];
  for (const perfil of perfiles) {
    for (const [nombre, def] of Object.entries(IE_CAMPOS)) {
      const cab = iePuntuaCabecera(perfil.cabecera, def);
      const cont = iePuntuaContenido(perfil.celdas, def);
      const r = ieCombina(cab, cont, nombre, def, perfil);
      if (r) pares.push(r);
    }
  }
  pares.sort((a, b) => b.puntos - a.puntos);

  const campos = {};
  const usadaCol = new Set();
  for (const p of pares) {
    if (campos[p.campo] || usadaCol.has(p.col)) continue;
    campos[p.campo] = { col: p.col, cabecera: p.cabecera, confianza: p.confianza, puntos: p.puntos, motivos: p.motivos };
    usadaCol.add(p.col);
  }

  // Una columna de fechas con cabecera irreconocible.
  //
  // El tipo «fecha» es discriminante (nada más tiene esa forma), pero el
  // PAPEL no lo es: podría ser la de operación, la de valor o la de
  // liquidación. Así que se adjudica solo cuando no hay ambigüedad posible:
  // ninguna otra columna se ha llevado un papel de fecha, y esta es la ÚNICA
  // columna de fechas sin asignar. Con dos candidatas no se elige ninguna,
  // porque elegir sería adivinar cuál es cuál.
  if (!Object.keys(campos).some(k => IE_CAMPOS[k] && IE_CAMPOS[k].grupo === 'fecha')) {
    const candidatas = perfiles.filter(p =>
      !usadaCol.has(p.idx) && p.noVacias >= 2 && p.tipos.fecha >= 0.9);
    if (candidatas.length === 1) {
      const p = candidatas[0];
      campos.fechaOperacion = {
        col: p.idx, cabecera: p.cabecera, confianza: 'media', puntos: 0.5,
        motivos: [
          `la cabecera «${p.cabecera}» no se reconoce, pero el ${Math.round(p.tipos.fecha * 100)} % de sus valores son fechas`,
          'es la única columna de fechas del archivo, así que no hay otra a la que pueda referirse',
        ],
      };
      usadaCol.add(p.idx);
    }
  }

  const columnas = perfiles.map(perfil => {
    const asignado = Object.entries(campos).find(([, v]) => v.col === perfil.idx);
    return {
      idx: perfil.idx, cabecera: perfil.cabecera, tipos: perfil.tipos,
      noVacias: perfil.noVacias,
      campo: asignado ? asignado[0] : null,
      confianza: asignado ? asignado[1].confianza : null,
      motivos: asignado ? asignado[1].motivos : [],
    };
  });

  return {
    headerRow: idxCab,
    cabeceras,
    filasDatos: datos,
    campos,
    columnas,
    sinAsignar: columnas.filter(c => !c.campo && c.noVacias > 0)
      .map(c => ({ idx: c.idx, cabecera: c.cabecera, tipos: c.tipos, nota: ieNotaSinAsignar(c) })),
  };
}

/**
 * Combina las dos evidencias en una puntuación y una confianza.
 *
 * El umbral es lo que impide inventar: sin coincidencia de cabecera se exige
 * que el contenido sea casi unánime Y que el tipo sea discriminante. Un ISIN
 * válido o un IBAN lo son (nada más tiene esa forma); un número no lo es en
 * absoluto, porque la mitad de las columnas de un extracto son números.
 */
function ieCombina(cab, cont, nombre, def, perfil) {
  const motivos = [];
  const pctCont = Math.round(cont.ratio * 100);

  // Tipos cuyo contenido identifica por sí solo.
  const autoSuficiente = nombre === 'isin' || (nombre === 'cuenta' && perfil.tipos.iban >= 0.8);

  if (cab.puntos === 0) {
    if (!autoSuficiente) return null;
    if (cont.ratio < 0.8 || cont.muestras < 2) return null;
    motivos.push(nombre === 'isin'
      ? `el ${pctCont} % de los valores son ISIN válidos (pasan el dígito de control)`
      : `el ${pctCont} % de los valores son IBAN con forma válida`);
    return {
      campo: nombre, col: perfil.idx, cabecera: perfil.cabecera,
      puntos: 0.7 + cont.ratio * 0.3,
      confianza: 'alta', motivos,
    };
  }

  motivos.push(cab.motivo);

  // Con cabecera reconocida, el contenido confirma o desmiente.
  if (cont.muestras === 0) {
    // Columna vacía: la cabecera dice qué es, pero no hay nada que importar.
    return {
      campo: nombre, col: perfil.idx, cabecera: perfil.cabecera,
      puntos: cab.puntos * 0.4, confianza: 'baja',
      motivos: motivos.concat('la columna está vacía: no hay contenido que lo confirme'),
    };
  }

  if (cont.ratio >= 0.8) {
    motivos.push(`el ${pctCont} % de los valores encajan con el tipo esperado`);
    const extra = autoSuficiente ? 0.2 : 0;
    return {
      campo: nombre, col: perfil.idx, cabecera: perfil.cabecera,
      puntos: cab.puntos * 0.6 + cont.ratio * 0.4 + extra,
      confianza: cab.puntos >= 1 ? 'alta' : 'media', motivos,
    };
  }

  if (cont.ratio >= 0.5) {
    motivos.push(`solo el ${pctCont} % de los valores encajan con el tipo esperado`);
    return {
      campo: nombre, col: perfil.idx, cabecera: perfil.cabecera,
      puntos: cab.puntos * 0.5 + cont.ratio * 0.2,
      confianza: 'media', motivos,
    };
  }

  // La cabecera dice una cosa y el contenido otra. No se asigna: es
  // exactamente el caso en el que inventar sale caro.
  return null;
}

function ieNotaSinAsignar(col) {
  const t = col.tipos;
  if (t.isin >= 0.8) return 'Parecen códigos ISIN.';
  if (t.iban >= 0.8) return 'Parecen números de cuenta IBAN.';
  if (t.fecha >= 0.8) return 'Son fechas, pero no se ha podido determinar de qué.';
  if (t.divisa >= 0.8) return 'Parecen códigos de divisa.';
  if (t.numero >= 0.8) return 'Son números, pero no se ha podido determinar qué representan.';
  if (t.ticker >= 0.8) return 'Parecen símbolos de cotización.';
  if (t.texto >= 0.8) return 'Es texto sin un significado reconocible.';
  return 'Contenido mixto, sin un significado reconocible.';
}
