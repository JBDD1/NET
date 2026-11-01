'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — HISTORIAL Y ESTADÍSTICAS DE UNA TRANSACCIÓN

   Ficha que, al abrir una transacción, cruza esa compra con TODAS las
   anteriores: establecimiento, categoría, productos y tickets.

   Se carga en diferido (_LAZY_SCRIPTS.txHistory): la mayoría de sesiones no
   abren la ficha, y aquí hay gráficos.

   ── Lo que hay de verdad en los datos ──
   Una transacción es:
     { id, type, date, description, category, amount, note, favorite,
       photoId?, tripId?, receipt?, recurringId?, bankImported? }

   Y `receipt` (solo si vino del escáner de tickets):
     { merchant, total, date, time, currency, receiptNumber, taxId,
       paymentMethod, items[{name,qty,unitPrice,total}],
       taxBase, taxAmount, taxRate, discount, confidence, imgHash }

   NO existen subcategorías en Finova: ni en el modelo de datos, ni en la
   interfaz, ni en el escáner (su propio prompt dice «no uses subcategorías»).
   Así que la ficha no las muestra en vez de inventarlas.

   REGLA: todo sale de las transacciones reales del usuario. Si un dato no
   está, se dice que no está — nunca se rellena con un valor plausible.
═══════════════════════════════════════════════════════════════ */

/* ─── 1. Identidad del establecimiento ────────────────────────── */

/*
 * Esto NO usa txPatternKey, que ya existe en script.js, y conviene explicar
 * por qué: txPatternKey está hecha para CATEGORIZAR, y ahí sobre-agrupar es
 * inofensivo (dos farmacias distintas son las dos «Salud»). Para IDENTIDAD de
 * establecimiento sobre-agrupar es una mentira: fundiría las estadísticas de
 * dos negocios diferentes.
 *
 * Comprobado contra txPatternKey: agrupaba como el mismo sitio
 * «FARMACIA LOPEZ» con «FARMACIA RUIZ», «RESTAURANTE EL FARO» con
 * «RESTAURANTE LA MINA», «PANADERIA SOL» con «PANADERIA LUNA»,
 * «GASOLINERA REPSOL» con «GASOLINERA CEPSA» y «CLINICA DENTAL NORTE» con
 * «CLINICA DENTAL SUR». 5 de 9 casos mal.
 */

// Tipos de negocio genéricos: NO identifican a nadie por sí solos. Si la
// primera palabra es una de estas, hace falta la siguiente para distinguir.
const _MH_GENERIC = new Set([
  'farmacia', 'parafarmacia', 'bar', 'cafeteria', 'cafe', 'restaurante',
  'resto', 'pizzeria', 'hamburgueseria', 'cerveceria', 'taberna', 'meson',
  'marisqueria', 'asador', 'panaderia', 'pasteleria', 'bolleria', 'churreria',
  'heladeria', 'fruteria', 'carniceria', 'pescaderia', 'charcuteria',
  'supermercado', 'super', 'hipermercado', 'autoservicio', 'mercado',
  'tienda', 'kiosco', 'quiosco', 'estanco', 'libreria', 'papeleria',
  'ferreteria', 'drogueria', 'perfumeria', 'floristeria', 'joyeria',
  'zapateria', 'optica', 'peluqueria', 'barberia', 'esteticista',
  'gasolinera', 'estacion', 'taller', 'autoescuela', 'gimnasio',
  'clinica', 'hospital', 'centro', 'consulta', 'laboratorio', 'dentista',
  'hotel', 'hostal', 'pension', 'apartamentos', 'camping', 'albergue',
  'parking', 'aparcamiento', 'garaje', 'lavanderia', 'tintoreria',
  'academia', 'colegio', 'escuela', 'guarderia', 'residencia',
  'agencia', 'inmobiliaria', 'asesoria', 'gestoria', 'notaria',
  'veterinario', 'veterinaria', 'copisteria', 'imprenta',
]);

// Marcas reales cortas (menos de 5 letras) que SÍ identifican por sí solas.
// Es una lista de datos a propósito: una regla de longitud partiría
// «ZARA GRAN VIA» de «ZARA CALLAO», que son la misma marca.
const _MH_BRANDS = new Set([
  'dia', 'lidl', 'aldi', 'eroski', 'spar', 'coviran', 'bm',
  'zara', 'hm', 'mango', 'bershka', 'kiabi', 'ikea', 'leroy',
  'bp', 'cepsa', 'repsol', 'shell', 'galp', 'moeve', 'ballenoil',
  'fnac', 'mediamarkt', 'worten', 'pccomponentes',
  'renfe', 'alsa', 'avlo', 'ouigo', 'iryo', 'cabify', 'uber', 'bolt',
  'glovo', 'just', 'ubereats', 'amazon', 'aliexpress', 'shein', 'temu',
  'apple', 'google', 'netflix', 'spotify', 'hbo', 'disney', 'movistar',
  'vodafone', 'orange', 'yoigo', 'digi', 'pepephone', 'jazztel',
  'ing', 'bbva', 'caixa', 'sabadell', 'bankinter', 'openbank', 'revolut',
  'n26', 'wise', 'paypal',
  'kfc', 'burger', 'telepizza', 'domino', 'subway', 'vips', 'goiko',
  'ale', 'primor', 'druni', 'tiger', 'flying', 'normal', 'action',
]);

// Sufijos societarios y ruido que nunca forma parte del nombre.
const _MH_SUFIJOS = new Set([
  'sa', 'sl', 'slu', 'sau', 'sc', 'scp', 'cb', 'sll', 'sociedad',
  'anonima', 'limitada', 'unipersonal', 'espana', 'iberia', 'europe',
  'group', 'grupo', 'holding', 'international', 'intl', 'corp', 'inc',
  'ltd', 'gmbh', 'bv', 'nv', 'srl', 'spa',
]);

// Ruido de extracto bancario y de localización. No se reutiliza
// _TX_STOPWORDS de script.js porque allí hay palabras que aquí SÍ importan
// (p.ej. 'tarjeta' no debe borrarse de «Tarjeta Transporte»).
const _MH_RUIDO = new Set([
  'compra', 'pago', 'cargo', 'tpv', 'pos', 'recibo', 'factura', 'fac',
  // 'tarj' y 'tarjeta' son prefijo de extracto bancario: sin ellos,
  // «COMPRA TARJ. 1234 MERCADONA» no agrupaba con «MERCADONA», y es una de
  // las formas más habituales en los extractos españoles. El coste es que
  // «Tarjeta Transporte» queda como «transporte», que sigue siendo una
  // identidad razonable para un abono de transporte.
  'tarj', 'tarjeta',
  'domiciliacion', 'domicil', 'liquidacion', 'operacion', 'oper',
  'redsys', 'tpveuro', 'tpvplus', 'contactless', 'online',
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'a', 'al', 'por',
  'calle', 'cl', 'avda', 'avd', 'av', 'paseo', 'pso', 'plaza', 'plz',
  'ctra', 'carretera', 'pol', 'poligono', 'local', 'nave', 'km',
]);

/** Minúsculas sin acentos ni puntuación. */
function _mhNorm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .split('').filter(c => { const n = c.charCodeAt(0); return n < 768 || n > 879; }).join('')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Palabras con significado: ni ruido, ni sufijo societario.
 *
 * Los números puros se descartan por defecto porque en un extracto suelen ser
 * el número de terminal o de operación («COMPRA TARJ. 1234 MERCADONA»). Pero
 * con conNumeros:true sí se conservan, y hace falta: en un nombre genérico el
 * número puede ser lo ÚNICO que distingue. Sin esto, «HOTEL 4» y «HOTEL 55»
 * daban la misma clave, y «BAR 100» y «BAR 200» también — dos negocios
 * distintos fundidos, que es justo lo que no puede pasar.
 */
function _mhTokens(s, conNumeros) {
  return _mhNorm(s).split(' ').filter(w =>
    w.length >= 1 && !_MH_RUIDO.has(w) && !_MH_SUFIJOS.has(w) &&
    (conNumeros ? true : !/^\d+$/.test(w)) &&
    (w.length >= 2 || /^\d$/.test(w))
  );
}

/**
 * Clave de identidad del establecimiento.
 *
 * Devuelve { key, label, source }:
 *   key    — para agrupar (exacta, nunca difusa)
 *   label  — nombre bonito para mostrar
 *   source — 'receipt' si vino del escáner (más fiable) o 'description'
 *
 * No hay coincidencia difusa a propósito. El encargo pedía no agrupar sin
 * confianza suficiente, y la igualdad exacta de la clave normalizada es la
 * única regla que no inventa relaciones. El coste es quedarse corto a veces
 * (dos grafías muy distintas del mismo sitio no se juntan), que es el error
 * barato: el usuario ve dos fichas en vez de una mentira.
 */
function mhMerchantKey(tx) {
  if (!tx) return null;
  // El escáner ya extrajo un nombre limpio: es mejor punto de partida que una
  // descripción de extracto bancario.
  const crudo  = (tx.receipt && tx.receipt.merchant) || tx.description || '';
  const source = (tx.receipt && tx.receipt.merchant) ? 'receipt' : 'description';
  const tokens = _mhTokens(crudo);

  if (!tokens.length) {
    const fallback = _mhNorm(crudo);
    return fallback
      ? { key: fallback, label: String(crudo).trim(), source }
      : null;
  }

  const head = tokens[0];
  let key;

  if (_MH_GENERIC.has(head)) {
    // «farmacia» no identifica a nadie: hace falta lo que va detrás. Y si lo
    // único que va detrás es un número («HOTEL 55»), ese número vale: es el
    // discriminador real. Solo si no hay absolutamente nada se queda el
    // genérico solo, porque entonces el sitio se llama así de verdad.
    const conNums = _mhTokens(crudo, true);
    const iHead = conNums.indexOf(head);
    const siguiente = tokens[1] || (iHead >= 0 ? conNums[iHead + 1] : null);
    key = siguiente ? head + ' ' + siguiente : head;
  } else if (_MH_BRANDS.has(head) || head.length >= 5) {
    // Marca conocida o palabra distintiva: agrupa todas sus sucursales.
    key = head;
  } else {
    // Palabra corta y desconocida: no se arriesga, se exige la segunda.
    key = tokens[1] ? head + ' ' + tokens[1] : head;
  }

  return { key, label: String(crudo).trim(), source };
}

/* ─── 2. Índice ───────────────────────────────────────────────── */

let _mhCache = null;

/** Firma barata para saber si el índice sigue valiendo. */
function _mhSignature() {
  const t = APP.transactions || [];
  const last = t.length ? t[t.length - 1] : null;
  // Longitud + id del último + suma de importes: cambia con cualquier alta,
  // baja o edición de importe, que es lo que invalida las estadísticas.
  let suma = 0;
  for (let i = 0; i < t.length; i++) suma += t[i].amount || 0;
  return t.length + '|' + (last ? last.id : '') + '|' + suma.toFixed(2);
}

/**
 * Recorre las transacciones UNA vez y monta los tres índices.
 * Se memoiza: abrir la ficha de diez transacciones distintas no recalcula
 * nada mientras los datos no cambien.
 */
function _mhIndex() {
  const sig = _mhSignature();
  if (_mhCache && _mhCache.sig === sig) return _mhCache;

  const byMerchant = new Map();   // key → { label, txs[], source }
  const byCategory = new Map();   // categoría → txs[]
  const products   = new Map();   // clave de producto → { label, entradas[] }

  for (const t of (APP.transactions || [])) {
    if (!t || !t.date) continue;

    const mk = mhMerchantKey(t);
    if (mk) {
      let e = byMerchant.get(mk.key);
      if (!e) { e = { label: mk.label, source: mk.source, txs: [], labels: new Set() }; byMerchant.set(mk.key, e); }
      // Se queda la etiqueta que venga de un ticket escaneado: es más limpia
      // que la descripción de un extracto bancario.
      if (mk.source === 'receipt' && e.source !== 'receipt') { e.label = mk.label; e.source = 'receipt'; }
      e.labels.add(mk.label);
      e.txs.push(t);
    }

    const cat = t.category || UNCLASSIFIED_CATEGORY;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(t);

    // Productos: solo de tickets escaneados con líneas de detalle.
    const items = t.receipt && Array.isArray(t.receipt.items) ? t.receipt.items : null;
    if (items && mk) {
      for (const it of items) {
        const pk = mhProductKey(it.name);
        if (!pk) continue;
        let p = products.get(pk.key);
        if (!p) { p = { label: pk.label, entradas: [] }; products.set(pk.key, p); }
        p.entradas.push({
          date: t.date, txId: t.id, merchantKey: mk.key,
          name: it.name, qty: it.qty, unitPrice: it.unitPrice, total: it.total,
        });
      }
    }
  }

  // Cada lista ordenada por fecha ascendente, una sola vez.
  const porFecha = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const e of byMerchant.values()) e.txs.sort(porFecha);
  for (const l of byCategory.values()) l.sort(porFecha);
  for (const p of products.values()) p.entradas.sort(porFecha);

  _mhCache = { sig, byMerchant, byCategory, products };
  return _mhCache;
}

/**
 * Clave de producto. Quita cantidades y envases para que «Leche
 * semidesnatada 1L» y «LECHE SEMIDESNATADA 1 L» sean el mismo producto, pero
 * SIN juntar «leche entera» con «leche semidesnatada».
 */
function mhProductKey(nombre) {
  let s = _mhNorm(nombre);
  if (!s) return null;
  // Formatos y cantidades: 1l, 500g, 2x, x6, 25cl, 1kg, 6ud…
  s = s.replace(/\b\d+[.,]?\d*\s?(l|ml|cl|g|kg|gr|ud|uds|u|pack|x)\b/g, ' ')
       .replace(/\bx\s?\d+\b/g, ' ')
       .replace(/\b\d+[.,]?\d*\b/g, ' ')
       .replace(/\s+/g, ' ').trim();
  const tokens = s.split(' ').filter(w => w.length >= 3);
  if (!tokens.length) return null;
  // Tres palabras: suficiente para distinguir variantes, corto para tolerar
  // que el ticket añada la marca al final.
  return { key: tokens.slice(0, 3).join(' '), label: String(nombre).trim() };
}

/* ─── 3. Estadísticas ─────────────────────────────────────────── */

const _MH_DIA = 86400000;

function _mhDiasDesde(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / _MH_DIA);
}

/** «hace 5 días», «hoy», «hace 2 meses». */
function mhHace(iso) {
  const d = _mhDiasDesde(iso);
  if (d === null) return '—';
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  const m = Math.round(d / 30.44);
  if (m < 12) return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`;
  const a = (d / 365.25);
  return `hace ${a < 1.5 ? 'un año' : Math.round(a) + ' años'}`;
}

/**
 * Estadísticas de un conjunto de transacciones del MISMO tipo.
 *
 * Se filtra por tipo a propósito: una devolución de Mercadona es un ingreso,
 * y meterla en «total gastado» daría un total menor que el real y una media
 * falseada. Se cuentan aparte.
 */
function mhStats(txs, type) {
  const mismas = txs.filter(t => t.type === type);
  const otras  = txs.filter(t => t.type !== type);

  if (!mismas.length) {
    return { n: 0, otrasN: otras.length, otrasTotal: otras.reduce((s, t) => s + t.amount, 0) };
  }

  const importes = mismas.map(t => t.amount);
  const total = importes.reduce((a, b) => a + b, 0);
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0, 7);
  const anioActual = String(hoy.getFullYear());

  const primera = mismas[0];
  const ultima  = mismas[mismas.length - 1];

  // Frecuencia media: días entre la primera y la última, partido por los
  // intervalos (n-1), no por n. Con una sola compra no hay frecuencia.
  let frecuencia = null;
  if (mismas.length >= 2) {
    const d1 = new Date(primera.date + 'T00:00:00').getTime();
    const d2 = new Date(ultima.date + 'T00:00:00').getTime();
    const dias = Math.round((d2 - d1) / _MH_DIA);
    if (dias > 0) frecuencia = dias / (mismas.length - 1);
  }

  return {
    n: mismas.length,
    total,
    media: total / mismas.length,
    max: Math.max(...importes),
    min: Math.min(...importes),
    maxTx: mismas.find(t => t.amount === Math.max(...importes)),
    minTx: mismas.find(t => t.amount === Math.min(...importes)),
    primera, ultima,
    frecuencia,
    esteMes: mismas.filter(t => t.date.startsWith(mesActual)).reduce((s, t) => s + t.amount, 0),
    esteMesN: mismas.filter(t => t.date.startsWith(mesActual)).length,
    esteAnio: mismas.filter(t => t.date.startsWith(anioActual)).reduce((s, t) => s + t.amount, 0),
    esteAnioN: mismas.filter(t => t.date.startsWith(anioActual)).length,
    conTicket: mismas.filter(t => t.photoId || (t.receipt && t.receipt.items && t.receipt.items.length)).length,
    conFoto: mismas.filter(t => t.photoId).length,
    txs: mismas,
    otrasN: otras.length,
    otrasTotal: otras.reduce((s, t) => s + t.amount, 0),
  };
}

/**
 * Compara la transacción abierta con su historia.
 * Devuelve null cuando no hay con qué comparar, en vez de un 0 % engañoso.
 */
function mhCompare(tx, stats) {
  if (!stats || stats.n < 2) return null;
  const otras = stats.txs.filter(t => t.id !== tx.id);
  if (!otras.length) return null;

  const mediaOtras = otras.reduce((s, t) => s + t.amount, 0) / otras.length;
  // La anterior de verdad: la más reciente ANTES de esta fecha.
  const previas = otras.filter(t => t.date < tx.date || (t.date === tx.date));
  const anterior = previas.length ? previas[previas.length - 1] : null;

  const pct = (a, b) => (b === 0 ? null : ((a - b) / b) * 100);

  return {
    anterior,
    difAnterior:    anterior ? tx.amount - anterior.amount : null,
    pctAnterior:    anterior ? pct(tx.amount, anterior.amount) : null,
    mediaOtras,
    difMedia:       tx.amount - mediaOtras,
    pctMedia:       pct(tx.amount, mediaOtras),
    esMaximo:       tx.amount >= stats.max,
    esMinimo:       tx.amount <= stats.min,
  };
}

/** Gasto por mes, en los últimos N meses. Rellena los meses sin gasto a 0. */
function mhPorMes(txs, type, meses) {
  const out = [];
  const hoy = new Date();
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const delMes = txs.filter(t => t.type === type && t.date.startsWith(ym));
    out.push({
      ym,
      etiqueta: d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }),
      total: delMes.reduce((s, t) => s + t.amount, 0),
      n: delMes.length,
    });
  }
  return out;
}

/** Los establecimientos donde más se ha gastado dentro de una categoría. */
function mhTopMerchants(txsCategoria, type, limite) {
  const porClave = new Map();
  for (const t of txsCategoria) {
    if (t.type !== type) continue;
    const mk = mhMerchantKey(t);
    if (!mk) continue;
    let e = porClave.get(mk.key);
    if (!e) { e = { key: mk.key, label: mk.label, total: 0, n: 0 }; porClave.set(mk.key, e); }
    e.total += t.amount;
    e.n++;
  }
  return [...porClave.values()].sort((a, b) => b.total - a.total).slice(0, limite || 5);
}

/** Historial de un producto a partir de sus apariciones en tickets. */
function mhProductStats(entradas) {
  // Se usa unitPrice cuando está; si no, total/qty; si tampoco, total.
  const precios = entradas.map(e => {
    if (e.unitPrice != null && e.unitPrice > 0) return e.unitPrice;
    if (e.total != null && e.qty && e.qty > 0) return e.total / e.qty;
    return e.total;
  }).filter(p => p != null && p > 0);

  if (!precios.length) {
    return { n: entradas.length, sinPrecio: true, ultima: entradas[entradas.length - 1] };
  }
  return {
    n: entradas.length,
    sinPrecio: false,
    ultimo: precios[precios.length - 1],
    medio: precios.reduce((a, b) => a + b, 0) / precios.length,
    max: Math.max(...precios),
    min: Math.min(...precios),
    ultima: entradas[entradas.length - 1],
    precios,
  };
}

/**
 * Patrones observables, sin adivinar.
 * Cada uno solo se afirma si hay datos suficientes; si no, no aparece.
 */
function mhPatrones(stats, tx) {
  const out = [];
  if (!stats || stats.n < 3) return out;

  // Día de la semana dominante.
  const dias = [0, 0, 0, 0, 0, 0, 0];
  for (const t of stats.txs) {
    const d = new Date(t.date + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) dias[d.getDay()]++;
  }
  const maxDia = Math.max(...dias);
  if (maxDia >= 3 && maxDia / stats.n >= 0.4) {
    const NOMBRES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    out.push({
      icono: '📅',
      texto: `Sueles comprar aquí en ${NOMBRES[dias.indexOf(maxDia)]}: ${maxDia} de ${stats.n} veces.`,
    });
  }

  // Cadencia estable.
  if (stats.frecuencia != null && stats.n >= 4) {
    const f = Math.round(stats.frecuencia);
    if (f >= 1) {
      out.push({
        icono: '🔁',
        texto: `Compras aquí cada ${f} ${f === 1 ? 'día' : 'días'} de media.`,
      });
    }
  }

  // Tendencia: media de los 3 últimos frente a la de los 3 anteriores.
  if (stats.n >= 6) {
    const ult = stats.txs.slice(-3).reduce((s, t) => s + t.amount, 0) / 3;
    const ant = stats.txs.slice(-6, -3).reduce((s, t) => s + t.amount, 0) / 3;
    if (ant > 0) {
      const pct = ((ult - ant) / ant) * 100;
      if (Math.abs(pct) >= 15) {
        out.push({
          icono: pct > 0 ? '📈' : '📉',
          texto: `Tus últimas compras aquí son un ${Math.abs(pct).toFixed(0)} % ${pct > 0 ? 'más caras' : 'más baratas'} que las anteriores.`,
        });
      }
    }
  }

  // Esta compra, en su contexto.
  if (stats.n >= 3) {
    if (tx.amount >= stats.max) out.push({ icono: '⬆', texto: 'Esta es tu compra más alta aquí.' });
    else if (tx.amount <= stats.min) out.push({ icono: '⬇', texto: 'Esta es tu compra más baja aquí.' });
  }

  // Devoluciones.
  if (stats.otrasN > 0) {
    out.push({
      icono: '↩',
      texto: `Hay ${stats.otrasN} ${stats.otrasN === 1 ? 'movimiento' : 'movimientos'} de signo contrario aquí (${formatCurrency(stats.otrasTotal)}), probablemente devoluciones. No se cuentan en el total gastado.`,
    });
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════
   INTERFAZ DE LA FICHA
═══════════════════════════════════════════════════════════════ */

let _mhChartImporte = null;
let _mhChartCat     = null;
let _mhCurrent      = null;   // { tx, mk, stats, catStats }

const _MH_PERIODOS = [
  { id: '30d', label: '30 días', meses: 1 },
  { id: '3m',  label: '3 meses', meses: 3 },
  { id: '6m',  label: '6 meses', meses: 6 },
  { id: '1a',  label: '1 año',   meses: 12 },
  { id: 'all', label: 'Todo',    meses: null },
];
let _mhPeriodo = '6m';

const _mhEsc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? ''));

/** Tarjeta de estadística. */
function _mhKpi(valor, etiqueta, extra) {
  return `<div class="mh-kpi">
    <div class="mh-kpi-val">${valor}</div>
    <div class="mh-kpi-lbl">${_mhEsc(etiqueta)}</div>
    ${extra ? `<div class="mh-kpi-extra">${extra}</div>` : ''}
  </div>`;
}

/** Indicador de variación con signo y color. */
function _mhDelta(pct, invertirColor) {
  if (pct == null || !Number.isFinite(pct)) return '';
  const signo = pct > 0 ? '+' : '';
  // En gastos, subir es malo: el color se invierte respecto a una cotización.
  const malo = invertirColor ? pct > 0 : pct < 0;
  const cls = Math.abs(pct) < 0.5 ? 'mh-neutral' : (malo ? 'mh-peor' : 'mh-mejor');
  // formatPct es el helper que ya usa el resto de la app (dashboard, cartera,
  // patrimonio). Se reutiliza aunque use punto decimal, para no inventar una
  // tercera convención en una pantalla nueva: el proyecto formatea el dinero
  // con coma y los porcentajes con punto, y eso es una incoherencia que
  // conviene resolver de una vez en toda la app, no solo aquí.
  const txt = typeof formatPct === 'function' ? formatPct(pct) : signo + pct.toFixed(1) + '%';
  return `<span class="mh-delta ${cls}">${txt}</span>`;
}

/*
 * Nombre del mes en curso. «Este mes: 0,00 €» desconcierta cuando la
 * transacción abierta es del mes anterior: el dato es correcto, pero parece
 * que la ficha está rota. Nombrar el mes lo deja claro de un vistazo.
 */
function _mhMesActualNombre() {
  const n = new Date().toLocaleDateString('es-ES', { month: 'long' });
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function _mhVacio(texto) {
  return `<div class="mh-vacio">${_mhEsc(texto)}</div>`;
}

/* ─── Sección: historial del establecimiento ──────────────────── */

function _mhSeccionEstablecimiento(st, mk) {
  if (st.n <= 1) {
    return _mhVacio(
      st.n === 1
        ? 'Es la primera vez que registras una compra aquí. Cuando haya más, aparecerán las estadísticas.'
        : 'No hay más movimientos registrados en este establecimiento.'
    );
  }

  const variantes = _mhIndex().byMerchant.get(mk.key);
  const nombres = variantes ? [...variantes.labels] : [];

  return `
    <div class="mh-kpi-grid">
      ${_mhKpi(st.n, st.n === 1 ? 'compra' : 'compras')}
      ${_mhKpi(formatCurrency(st.total), 'gastado en total')}
      ${_mhKpi(formatCurrency(st.media), 'gasto medio')}
      ${_mhKpi(formatCurrency(st.max), 'compra más alta', _mhEsc(formatDate(st.maxTx.date)))}
      ${_mhKpi(formatCurrency(st.min), 'compra más baja', _mhEsc(formatDate(st.minTx.date)))}
      ${_mhKpi(st.frecuencia != null ? `cada ${Math.round(st.frecuencia)} d` : '—', 'frecuencia media')}
    </div>

    <div class="mh-filas">
      <div class="mh-fila"><span>Primera compra</span><span>${_mhEsc(formatDate(st.primera.date))} · ${_mhEsc(mhHace(st.primera.date))}</span></div>
      <div class="mh-fila"><span>Última compra</span><span>${_mhEsc(formatDate(st.ultima.date))} · ${_mhEsc(mhHace(st.ultima.date))}</span></div>
      <div class="mh-fila"><span>${_mhEsc(_mhMesActualNombre())} (este mes)</span><span>${formatCurrency(st.esteMes)}${st.esteMesN ? ` · ${st.esteMesN} ${st.esteMesN === 1 ? 'compra' : 'compras'}` : ''}</span></div>
      <div class="mh-fila"><span>${new Date().getFullYear()} (este año)</span><span>${formatCurrency(st.esteAnio)}${st.esteAnioN ? ` · ${st.esteAnioN} ${st.esteAnioN === 1 ? 'compra' : 'compras'}` : ''}</span></div>
      ${st.conFoto ? `<div class="mh-fila"><span>Con justificante</span><span>${st.conFoto} de ${st.n}</span></div>` : ''}
    </div>

    ${nombres.length > 1 ? `
      <details class="mh-sub">
        <summary>Agrupa ${nombres.length} nombres distintos</summary>
        <div class="mh-nombres">${nombres.map(n => `<code>${_mhEsc(n)}</code>`).join(' ')}</div>
        <p class="mh-nota">Se agrupan porque comparten el nombre identificativo. Si alguno no debería estar aquí, cámbiale la descripción.</p>
      </details>` : ''}
  `;
}

/* ─── Sección: comparación ────────────────────────────────────── */

function _mhSeccionComparacion(tx, st) {
  const c = mhCompare(tx, st);
  if (!c) return _mhVacio('Hace falta al menos otra compra en el mismo establecimiento para poder comparar.');

  const frase = (() => {
    if (c.pctMedia == null) return null;
    const abs = Math.abs(c.pctMedia);
    if (abs < 5) return `Esta compra está en tu gasto habitual aquí (${formatCurrency(c.mediaOtras)} de media).`;
    return `Has gastado un <strong>${abs.toFixed(0)} % ${c.pctMedia > 0 ? 'más' : 'menos'}</strong> que en tu compra habitual (${formatCurrency(c.mediaOtras)}).`;
  })();

  return `
    <div class="mh-comp-actual">
      <div class="mh-comp-lbl">Esta compra</div>
      <div class="mh-comp-val">${formatCurrency(tx.amount)}</div>
    </div>

    ${frase ? `<p class="mh-frase">${frase}</p>` : ''}

    <div class="mh-filas">
      ${c.anterior ? `
        <div class="mh-fila">
          <span>Compra anterior · ${_mhEsc(formatDate(c.anterior.date))}</span>
          <span>${formatCurrency(c.anterior.amount)} ${_mhDelta(c.pctAnterior, true)}</span>
        </div>
        <div class="mh-fila">
          <span>Diferencia</span>
          <span>${c.difAnterior > 0 ? '+' : ''}${formatCurrency(c.difAnterior)}</span>
        </div>` : ''}
      <div class="mh-fila">
        <span>Frente a tu media aquí</span>
        <span>${c.difMedia > 0 ? '+' : ''}${formatCurrency(c.difMedia)} ${_mhDelta(c.pctMedia, true)}</span>
      </div>
      ${c.esMaximo ? '<div class="mh-fila"><span>Posición</span><span>Tu compra más alta aquí</span></div>' : ''}
      ${c.esMinimo && !c.esMaximo ? '<div class="mh-fila"><span>Posición</span><span>Tu compra más baja aquí</span></div>' : ''}
    </div>

    <details class="mh-sub" open>
      <summary>Últimas compras aquí (${Math.min(st.n, 12)} de ${st.n})</summary>
      <div class="mh-lista">
        ${st.txs.slice().reverse().slice(0, 12).map(t => `
          <button type="button" class="mh-item${t.id === tx.id ? ' is-actual' : ''}"
            data-action="mh-goto" data-id="${_mhEsc(t.id)}">
            <span class="mh-item-fecha">${_mhEsc(formatDate(t.date))}</span>
            <span class="mh-item-desc">${_mhEsc(t.description)}${t.photoId ? ' 🧾' : ''}</span>
            <span class="mh-item-imp">${formatCurrency(t.amount)}</span>
          </button>`).join('')}
      </div>
    </details>
  `;
}

/* ─── Sección: categoría ──────────────────────────────────────── */

function _mhSeccionCategoria(tx, catSt) {
  if (!catSt || catSt.n <= 1) {
    return _mhVacio('No hay suficientes movimientos en esta categoría para sacar estadísticas.');
  }

  const meses = mhPorMes(catSt.txs, tx.type, 7);
  const mesActual   = meses[meses.length - 1];
  const mesAnterior = meses[meses.length - 2];
  const media6 = meses.slice(0, 6).reduce((s, m) => s + m.total, 0) / 6;

  const pctMes = mesAnterior && mesAnterior.total > 0
    ? ((mesActual.total - mesAnterior.total) / mesAnterior.total) * 100 : null;
  const pct6 = media6 > 0 ? ((mesActual.total - media6) / media6) * 100 : null;

  const top = mhTopMerchants(catSt.txs, tx.type, 5);

  return `
    <div class="mh-kpi-grid">
      ${_mhKpi(catSt.n, 'movimientos')}
      ${_mhKpi(formatCurrency(catSt.total), 'total')}
      ${_mhKpi(formatCurrency(catSt.media), 'media')}
      ${_mhKpi(formatCurrency(mesActual.total), 'este mes', _mhDelta(pctMes, true) || '—')}
    </div>

    <div class="mh-filas">
      ${mesAnterior ? `<div class="mh-fila"><span>Mes anterior</span><span>${formatCurrency(mesAnterior.total)}</span></div>` : ''}
      <div class="mh-fila"><span>Media de los últimos 6 meses</span><span>${formatCurrency(media6)} ${_mhDelta(pct6, true)}</span></div>
      <div class="mh-fila"><span>Este año</span><span>${formatCurrency(catSt.esteAnio)}</span></div>
    </div>

    ${top.length > 1 ? `
      <details class="mh-sub" open>
        <summary>Dónde más gastas en ${_mhEsc(tx.category)}</summary>
        <div class="mh-barras">
          ${top.map(m => `
            <div class="mh-barra-fila">
              <span class="mh-barra-lbl">${_mhEsc(m.label)}</span>
              <span class="mh-barra-pista"><span class="mh-barra-rell" style="width:${top[0].total ? (m.total / top[0].total) * 100 : 0}%"></span></span>
              <span class="mh-barra-val">${formatCurrency(m.total)} · ${m.n}</span>
            </div>`).join('')}
        </div>
      </details>` : ''}

    <p class="mh-nota">
      Finova no usa subcategorías: las categorías son una lista plana, así que
      no hay un desglose más fino que mostrar aquí.
    </p>
  `;
}

/* ─── Sección: gráficos ───────────────────────────────────────── */

function _mhSeccionGraficos() {
  return `
    <div class="mh-periodos" role="group" aria-label="Periodo de los gráficos">
      ${_MH_PERIODOS.map(p => `
        <button type="button" class="mh-per${p.id === _mhPeriodo ? ' is-on' : ''}"
          data-action="mh-periodo" data-per="${p.id}" aria-pressed="${p.id === _mhPeriodo}">
          ${_mhEsc(p.label)}
        </button>`).join('')}
    </div>

    <div class="mh-chart-wrap">
      <div class="mh-chart-titulo">Importe de cada compra en este establecimiento</div>
      <div class="mh-chart-box"><canvas id="mh-chart-importe"></canvas></div>
      <div id="mh-chart-importe-vacio"></div>
    </div>

    <div class="mh-chart-wrap">
      <div class="mh-chart-titulo">Gasto mensual en la categoría</div>
      <div class="mh-chart-box"><canvas id="mh-chart-cat"></canvas></div>
      <div id="mh-chart-cat-vacio"></div>
    </div>
  `;
}

/** Filtra por el periodo elegido. 'all' no filtra. */
function _mhFiltraPeriodo(txs) {
  const p = _MH_PERIODOS.find(x => x.id === _mhPeriodo);
  if (!p || p.meses == null) return txs;
  const corte = new Date();
  if (p.id === '30d') corte.setDate(corte.getDate() - 30);
  else corte.setMonth(corte.getMonth() - p.meses);
  const iso = corte.toISOString().slice(0, 10);
  return txs.filter(t => t.date >= iso);
}

function _mhPintaGraficos() {
  if (typeof Chart === 'undefined' || !_mhCurrent) return;
  const d = getChartDefiniciones();
  const { tx, stats, catStats } = _mhCurrent;

  /* 1. Importe por compra en el establecimiento */
  _mhChartImporte = safeDestroyChart(_mhChartImporte, 'mh-chart-importe');
  const puntos = _mhFiltraPeriodo(stats.txs || []);
  const vacio1 = document.getElementById('mh-chart-importe-vacio');
  const box1 = document.getElementById('mh-chart-importe')?.parentElement;
  if (puntos.length < 2) {
    if (box1) box1.style.display = 'none';
    if (vacio1) vacio1.innerHTML = _mhVacio('No hay suficientes compras en este periodo para dibujar la evolución.');
  } else {
    if (box1) box1.style.display = '';
    if (vacio1) vacio1.innerHTML = '';
    _mhChartImporte = new Chart(document.getElementById('mh-chart-importe'), {
      type: 'line',
      data: {
        labels: puntos.map(t => formatDate(t.date)),
        datasets: [{
          data: puntos.map(t => t.amount),
          borderColor: d.accent, backgroundColor: d.accentFill,
          borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
          fill: true, tension: 0.25,
        }],
      },
      options: _mhChartOpts(d, { conMedia: stats.media }),
    });
  }

  /* 2. Gasto mensual de la categoría */
  _mhChartCat = safeDestroyChart(_mhChartCat, 'mh-chart-cat');
  const p = _MH_PERIODOS.find(x => x.id === _mhPeriodo);
  const nMeses = p && p.meses != null ? Math.max(p.meses, 2) : 12;
  const meses = mhPorMes((catStats && catStats.txs) || [], tx.type, nMeses);
  const vacio2 = document.getElementById('mh-chart-cat-vacio');
  const box2 = document.getElementById('mh-chart-cat')?.parentElement;
  if (!meses.some(m => m.total > 0)) {
    if (box2) box2.style.display = 'none';
    if (vacio2) vacio2.innerHTML = _mhVacio('Sin gasto en esta categoría durante el periodo elegido.');
  } else {
    if (box2) box2.style.display = '';
    if (vacio2) vacio2.innerHTML = '';
    _mhChartCat = new Chart(document.getElementById('mh-chart-cat'), {
      type: 'bar',
      data: {
        labels: meses.map(m => m.etiqueta),
        datasets: [{ data: meses.map(m => m.total), backgroundColor: d.accent, borderRadius: 4, maxBarThickness: 38 }],
      },
      options: _mhChartOpts(d),
    });
  }
}

/** Opciones comunes, con la media como línea de referencia si se pide. */
function _mhChartOpts(d, extra) {
  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: c => formatCurrency(c.parsed.y),
          afterBody: extra && extra.conMedia
            ? () => 'Media: ' + formatCurrency(extra.conMedia)
            : undefined,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: d.textColor, font: { size: 10, family: d.fontFamily }, maxRotation: 0, autoSkipPadding: 12 } },
      y: {
        beginAtZero: true,
        grid: { color: d.gridColor, drawBorder: false },
        ticks: { color: d.textColor, font: { size: 10, family: d.fontFamily }, callback: v => formatCurrency(v) },
      },
    },
  };
  return opts;
}

/** Puente: getChartDefaults existe en charts.js; este nombre evita colisión. */
function getChartDefiniciones() {
  return typeof getChartDefaults === 'function'
    ? getChartDefaults()
    : { accent: '#c9a84c', accentFill: 'rgba(201,168,76,.09)', gridColor: 'rgba(0,0,0,.06)', textColor: '#8a90a0', fontFamily: 'Inter, sans-serif' };
}

/* ─── Sección: tickets ────────────────────────────────────────── */

function _mhSeccionTickets(tx, st) {
  const r = tx.receipt;
  const conTicket = (st.txs || []).filter(t => t.photoId);

  const detalle = r ? `
    <div class="mh-filas">
      ${r.merchant ? `<div class="mh-fila"><span>Establecimiento</span><span>${_mhEsc(r.merchant)}</span></div>` : ''}
      <div class="mh-fila"><span>Fecha de compra</span><span>${_mhEsc(formatDate(r.date || tx.date))}${r.time ? ' · ' + _mhEsc(r.time) : ''}</span></div>
      <div class="mh-fila"><span>Importe total</span><span>${formatCurrency(r.total != null ? r.total : tx.amount)}</span></div>
      ${r.receiptNumber ? `<div class="mh-fila"><span>Nº de ticket</span><span>${_mhEsc(r.receiptNumber)}</span></div>` : ''}
      ${r.taxId ? `<div class="mh-fila"><span>CIF</span><span>${_mhEsc(r.taxId)}</span></div>` : ''}
      ${r.paymentMethod ? `<div class="mh-fila"><span>Forma de pago</span><span>${_mhEsc(r.paymentMethod)}</span></div>` : ''}
      ${r.taxBase != null ? `<div class="mh-fila"><span>Base imponible</span><span>${formatCurrency(r.taxBase)}</span></div>` : ''}
      ${r.taxAmount != null ? `<div class="mh-fila"><span>IVA${r.taxRate ? ' (' + r.taxRate + ' %)' : ''}</span><span>${formatCurrency(r.taxAmount)}</span></div>` : ''}
      ${r.discount ? `<div class="mh-fila"><span>Descuento</span><span>${formatCurrency(r.discount)}</span></div>` : ''}
    </div>
    ${r.taxAmount == null ? '<p class="mh-nota">El ticket no incluía desglose de IVA, o el escáner no lo pudo leer.</p>' : ''}
    ${Array.isArray(r.items) && r.items.length ? `
      <details class="mh-sub">
        <summary>${r.items.length} ${r.items.length === 1 ? 'producto' : 'productos'} en este ticket</summary>
        <table class="mh-tabla">
          <thead><tr><th>Producto</th><th class="text-right">Uds</th><th class="text-right">Importe</th></tr></thead>
          <tbody>${r.items.map(it => `<tr>
            <td>${_mhEsc(it.name)}</td>
            <td class="text-right">${it.qty != null ? it.qty : '—'}</td>
            <td class="text-right">${it.total != null ? formatCurrency(it.total) : '—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </details>` : '<p class="mh-nota">El escáner no detectó productos individuales en este ticket.</p>'}
  ` : '';

  const imagen = tx.photoId
    ? '<div id="mh-ticket-img" class="mh-ticket-img">Cargando el justificante…</div>'
    : _mhVacio('Esta transacción no tiene ningún justificante adjunto.');

  const otros = conTicket.filter(t => t.id !== tx.id);

  return `
    ${imagen}
    ${detalle || (tx.photoId ? '<p class="mh-nota">Hay una foto adjunta, pero esta transacción no pasó por el escáner, así que no hay datos extraídos del ticket.</p>' : '')}
    ${otros.length ? `
      <details class="mh-sub">
        <summary>${otros.length} ${otros.length === 1 ? 'justificante' : 'justificantes'} más en este establecimiento</summary>
        <div class="mh-lista">
          ${otros.slice().reverse().map(t => `
            <button type="button" class="mh-item" data-action="mh-goto" data-id="${_mhEsc(t.id)}">
              <span class="mh-item-fecha">${_mhEsc(formatDate(t.date))}</span>
              <span class="mh-item-desc">🧾 ${_mhEsc(t.description)}</span>
              <span class="mh-item-imp">${formatCurrency(t.amount)}</span>
            </button>`).join('')}
        </div>
      </details>`
      : (st.n > 1 ? '<p class="mh-nota">No hay justificantes de otras compras en este establecimiento.</p>' : '')}
  `;
}

/* ─── Sección: productos habituales ───────────────────────────── */

function _mhSeccionProductos(mk) {
  const idx = _mhIndex();
  // Solo los productos vistos EN ESTE establecimiento: un precio de leche de
  // Mercadona no dice nada del de otra tienda.
  const filas = [];
  for (const [key, p] of idx.products) {
    const aqui = p.entradas.filter(e => e.merchantKey === mk.key);
    if (!aqui.length) continue;
    filas.push({ key, label: p.label, st: mhProductStats(aqui), aqui });
  }

  if (!filas.length) {
    return _mhVacio(
      'No hay productos registrados en este establecimiento. Los productos salen del escáner de tickets: solo aparecen si escaneaste el ticket y la IA pudo leer las líneas.'
    );
  }

  filas.sort((a, b) => b.st.n - a.st.n || (b.st.ultimo || 0) - (a.st.ultimo || 0));

  return `
    <p class="mh-nota">
      Salen de ${filas.length} ${filas.length === 1 ? 'producto distinto' : 'productos distintos'}
      leídos en los tickets escaneados de este establecimiento.
    </p>
    <div class="mh-prod-lista">
      ${filas.slice(0, 40).map(f => {
        const s = f.st;
        if (s.sinPrecio) {
          return `<div class="mh-prod">
            <div class="mh-prod-nombre">${_mhEsc(f.label)}</div>
            <div class="mh-prod-datos">${s.n} ${s.n === 1 ? 'vez' : 'veces'} · sin precio en el ticket</div>
          </div>`;
        }
        const tendencia = s.n >= 2 && s.medio > 0 ? ((s.ultimo - s.medio) / s.medio) * 100 : null;
        return `<div class="mh-prod">
          <div class="mh-prod-nombre">${_mhEsc(f.label)}</div>
          <div class="mh-prod-datos">
            <span>${s.n} ${s.n === 1 ? 'compra' : 'compras'}</span>
            <span>Último ${formatCurrency(s.ultimo)}</span>
            ${s.n >= 2 ? `<span>Medio ${formatCurrency(s.medio)}</span>` : ''}
            ${s.n >= 2 ? `<span>Min ${formatCurrency(s.min)} · Max ${formatCurrency(s.max)}</span>` : ''}
            <span>${_mhEsc(mhHace(s.ultima.date))}</span>
            ${tendencia != null && Math.abs(tendencia) >= 3 ? _mhDelta(tendencia, true) : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    ${filas.length > 40 ? `<p class="mh-nota">Se muestran los 40 más frecuentes de ${filas.length}.</p>` : ''}
  `;
}

/* ─── Sección: patrones ───────────────────────────────────────── */

function _mhSeccionPatrones(st, tx) {
  const ps = mhPatrones(st, tx);
  if (!ps.length) return _mhVacio('Con los movimientos que hay todavía no se puede afirmar ningún patrón.');
  return `<div class="mh-patrones">
    ${ps.map(p => `<div class="mh-patron"><span class="mh-patron-ico" aria-hidden="true">${p.icono}</span><span>${p.texto}</span></div>`).join('')}
  </div>`;
}

/* ─── La ficha ────────────────────────────────────────────────── */

function _mhBloque(titulo, contenido, abierto) {
  return `<details class="mh-bloque"${abierto ? ' open' : ''}>
    <summary class="mh-bloque-sum">
      <span>${_mhEsc(titulo)}</span>
      <svg class="icon icon-sm mh-chev" aria-hidden="true"><use href="#icon-chevron-right"/></svg>
    </summary>
    <div class="mh-bloque-body">${contenido}</div>
  </details>`;
}

/**
 * Abre la ficha de historial de una transacción.
 * @param {string} txId
 */
function openTxHistory(txId) {
  const tx = (APP.transactions || []).find(t => t.id === txId);
  if (!tx) { if (typeof showToast === 'function') showToast('No se encontró la transacción', 'error'); return; }

  const idx = _mhIndex();
  const mk  = mhMerchantKey(tx);
  const entrada = mk ? idx.byMerchant.get(mk.key) : null;
  const stats = mhStats(entrada ? entrada.txs : [tx], tx.type);
  const catTxs = idx.byCategory.get(tx.category || UNCLASSIFIED_CATEGORY) || [tx];
  const catStats = mhStats(catTxs, tx.type);

  _mhCurrent = { tx, mk, stats, catStats };

  const signo = tx.type === 'income' ? '+' : '−';
  const nombre = (entrada && entrada.label) || tx.description;

  openModal('Historial y estadísticas', `
    <div class="mh-cabecera">
      <div class="mh-cab-nombre">${_mhEsc(nombre)}</div>
      <div class="mh-cab-importe ${tx.type === 'income' ? 'positive' : 'negative'}">${signo}${formatCurrency(tx.amount)}</div>
      <div class="mh-cab-meta">
        ${_mhEsc(formatDate(tx.date))} · ${_mhEsc(tx.category || UNCLASSIFIED_CATEGORY)}
        ${tx.note ? ' · ' + _mhEsc(tx.note) : ''}
        ${mk && mk.source === 'receipt' ? ' · <span class="mh-tag">del escáner</span>' : ''}
        ${tx.bankImported ? ' · <span class="mh-tag">del banco</span>' : ''}
        ${tx.recurringId ? ' · <span class="mh-tag">recurrente</span>' : ''}
      </div>
    </div>

    ${_mhBloque('Historial del establecimiento', _mhSeccionEstablecimiento(stats, mk), true)}
    ${_mhBloque('Comparación con compras anteriores', _mhSeccionComparacion(tx, stats), true)}
    ${_mhBloque('Estadísticas de ' + (tx.category || UNCLASSIFIED_CATEGORY), _mhSeccionCategoria(tx, catStats), false)}
    ${_mhBloque('Gráficos históricos', _mhSeccionGraficos(), false)}
    ${_mhBloque('Ticket y justificantes', _mhSeccionTickets(tx, stats), false)}
    ${_mhBloque('Productos habituales', _mhSeccionProductos(mk || { key: '' }), false)}
    ${_mhBloque('Hábitos y patrones', _mhSeccionPatrones(stats, tx), false)}

    <div class="modal-footer-btns">
      <div class="modal-footer-btns-right" style="margin-left:auto">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cerrar</button>
        <button type="button" class="btn-primary" data-action="mh-editar" data-id="${_mhEsc(tx.id)}">Editar transacción</button>
      </div>
    </div>`, null);

  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
  document.getElementById('modal')?.classList.add('modal-wide');

  _mhWire();

  // La foto del justificante vive en IndexedDB: se carga aparte para no
  // bloquear el render de la ficha.
  if (tx.photoId && typeof loadPhoto === 'function') {
    loadPhoto(tx.photoId).then(dataUrl => {
      const box = document.getElementById('mh-ticket-img');
      if (!box) return;
      if (!dataUrl) { box.textContent = 'La foto de este justificante ya no está disponible.'; return; }
      box.innerHTML = '';
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Justificante de ' + nombre;
      img.loading = 'lazy';
      box.appendChild(img);
    }).catch(() => {
      const box = document.getElementById('mh-ticket-img');
      if (box) box.textContent = 'No se pudo cargar el justificante.';
    });
  }

  // Los gráficos se pintan cuando se abre su bloque: montar dos Chart.js que
  // nadie va a mirar es tiempo regalado, y el canvas de un <details> cerrado
  // tiene altura 0, así que Chart.js lo dibujaría mal.
  const bloqueGraf = [...document.querySelectorAll('.mh-bloque')]
    .find(d => d.querySelector('#mh-chart-importe'));
  if (bloqueGraf) {
    bloqueGraf.addEventListener('toggle', () => {
      if (bloqueGraf.open) _mhPintaGraficos();
    });
  }
}

/** Delegación dentro del modal. */
function _mhWire() {
  const modal = document.getElementById('modalBody');
  if (!modal || modal._mhWired) return;
  modal._mhWired = true;
  modal.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !modal.contains(btn)) return;
    const a = btn.dataset.action;

    if (a === 'mh-goto') {
      // Navegar a otra transacción del historial: se reabre la ficha.
      const id = btn.dataset.id;
      if (id) { closeModal(); setTimeout(() => openTxHistory(id), 170); }
      return;
    }
    if (a === 'mh-periodo') {
      _mhPeriodo = btn.dataset.per || '6m';
      modal.querySelectorAll('[data-action="mh-periodo"]').forEach(b => {
        const on = b.dataset.per === _mhPeriodo;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      _mhPintaGraficos();
      return;
    }
    if (a === 'mh-editar') {
      const id = btn.dataset.id;
      const t = (APP.transactions || []).find(x => x.id === id);
      if (t && typeof openAddTransaction === 'function') { closeModal(); setTimeout(() => openAddTransaction(t), 170); }
      return;
    }
  });
}

/** Limpieza al cerrar: los Chart.js del modal hay que destruirlos. */
function mhCleanup() {
  _mhChartImporte = safeDestroyChart(_mhChartImporte, 'mh-chart-importe');
  _mhChartCat     = safeDestroyChart(_mhChartCat, 'mh-chart-cat');
  _mhCurrent = null;
}
