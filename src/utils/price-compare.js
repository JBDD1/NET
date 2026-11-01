'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — COMPARADOR UNIVERSAL DE PRECIOS

   Responde a una pregunta: «de todo lo que he comprado o contratado,
   ¿dónde he pagado menos por lo mismo?». Sin un comparador por sector:
   un único motor que mira QUÉ datos tiene cada línea y decide con qué
   unidad se puede comparar.

   ── Lo que de verdad hay en los datos ──
   Por cada línea de un ticket escaneado:
     { name, brand?, size?, sizeUnit?, qty, unitPrice, total }
   brand/size/sizeUnit son NUEVOS (se añadieron al escáner con este
   comparador): los tickets escaneados antes no los llevan, y el motor
   funciona igual sin ellos, solo con menos precisión.

   Lo que NO hay y el encargo mencionaba: código de barras, referencia,
   modelo, especificaciones, duración, condiciones de un servicio, noches de
   hotel, coberturas de un seguro. No se piden al escáner porque un ticket
   normal no los lleva, y no se inventan. Donde falta el dato, el motor NO
   compara: dice que no puede.

   ── La regla que gobierna el fichero ──
   Antes de comparar dos precios hay que poder afirmar que son comparables.
   Se clasifican en IDÉNTICO / EQUIVALENTE / SIMILAR y solo los dos primeros
   se comparan en precio. Los similares se muestran, pero sin número de
   ahorro, porque un ahorro falso es peor que ninguno.
═══════════════════════════════════════════════════════════════ */

/* ─── 1. Procedencia del precio ───────────────────────────────── */

/*
 * Todo precio lleva de dónde sale. El encargo pedía no presentar nunca un
 * precio histórico como si fuera actual, y la única forma de garantizarlo es
 * que la procedencia viaje con el dato en vez de deducirse al pintar.
 *
 * 'linea-ticket'  — línea de un ticket escaneado: hay unitPrice o total/qty
 * 'importe-total' — no hay desglose: solo el importe de la operación
 * 'externa'       — reservado: precio verificado en una fuente externa
 * 'estimada'      — reservado: precio estimado, nunca verificado
 *
 * Las dos últimas no las produce nada todavía. Están declaradas para que
 * cuando se integre una fuente externa no haya que tocar la interfaz: ya
 * distingue y etiqueta. Ver PRICE_COMPARE.md.
 */
const PC_FUENTES = {
  'linea-ticket':  { label: 'ticket escaneado', verificado: false, actual: false },
  'importe-total': { label: 'importe de la operación', verificado: false, actual: false },
  'externa':       { label: 'fuente externa', verificado: true,  actual: true  },
  'estimada':      { label: 'estimación', verificado: false, actual: false },
};

/* ─── 2. Unidades ─────────────────────────────────────────────── */

// Factores a la unidad canónica de cada magnitud. Comparar €/kg con €/g sin
// convertir daría una diferencia de 1000x y un "ahorro" absurdo.
const PC_UNIDADES = {
  kg: { magnitud: 'peso',     canonica: 'kg', factor: 1 },
  g:  { magnitud: 'peso',     canonica: 'kg', factor: 0.001 },
  gr: { magnitud: 'peso',     canonica: 'kg', factor: 0.001 },
  mg: { magnitud: 'peso',     canonica: 'kg', factor: 0.000001 },
  l:  { magnitud: 'volumen',  canonica: 'l',  factor: 1 },
  ml: { magnitud: 'volumen',  canonica: 'l',  factor: 0.001 },
  cl: { magnitud: 'volumen',  canonica: 'l',  factor: 0.01 },
  m:  { magnitud: 'longitud', canonica: 'm',  factor: 1 },
  cm: { magnitud: 'longitud', canonica: 'm',  factor: 0.01 },
  ud: { magnitud: 'unidad',   canonica: 'ud', factor: 1 },
};

// Cómo se nombra el precio por unidad de cada magnitud.
const PC_METRICA = {
  peso:     '€/kg',
  volumen:  '€/l',
  longitud: '€/m',
  unidad:   '€/ud',
};

/*
 * Palabras del NOMBRE que delatan la magnitud cuando no hay size/sizeUnit.
 * Es la única señal fiable para los tickets antiguos: en combustible, el
 * campo qty del ticket son litros, pero nada en los datos lo dice.
 *
 * Deliberadamente NO se deduce del nombre de la categoría. «Transporte»
 * incluye gasolina (litros) y abonos de metro (viajes): tratar toda la
 * categoría como litros produciría un €/l inventado.
 */
const PC_PISTAS_NOMBRE = [
  { re: /\b(gasolina|gasoil|gasoleo|diesel|sin plomo|sp9[58]|a-?diesel|carburante|combustible)\b/i, magnitud: 'volumen', unidad: 'l' },
  { re: /\b(adblue|anticongelante|aceite motor)\b/i, magnitud: 'volumen', unidad: 'l' },
  { re: /\b(gas natural|propano|butano)\b/i, magnitud: 'unidad', unidad: 'ud' },
  { re: /\b(kwh|kilovatio)\b/i, magnitud: 'unidad', unidad: 'ud' },
];

/*
 * Métricas de SERVICIO, cuando no hay líneas de producto y lo único que hay
 * es el importe de la operación. Se eligen por la cadencia observada en el
 * historial, no por la categoría: una suscripción se reconoce porque se
 * repite cada ~30 días, y eso se mide.
 */
const PC_SERVICIO = {
  mensual:     { label: '€/mes',       dias: [25, 35] },
  anual:       { label: '€/año',       dias: [330, 400] },
  trimestral:  { label: '€/trimestre', dias: [80, 100] },
  semanal:     { label: '€/semana',    dias: [6, 8] },
};

/* ─── 3. Normalización y troceado del nombre ──────────────────── */

function _pcNorm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .split('').filter(c => { const n = c.charCodeAt(0); return n < 768 || n > 879; }).join('')
    .replace(/[^a-z0-9ñ.,% ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras que no distinguen un producto de otro.
const PC_RELLENO = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'sin', 'en', 'al', 'a',
  'pack', 'lote', 'formato', 'envase', 'bote', 'botella', 'lata', 'brick',
  'bolsa', 'caja', 'paquete', 'unidad', 'unidades', 'uds', 'ud', 'und',
  'oferta', 'promocion', 'promo', 'dto', 'descuento', 'rebaja',
]);

/**
 * Extrae el tamaño que venga escrito DENTRO del nombre.
 * Para los tickets antiguos, que no tienen size/sizeUnit, es la única vía.
 * Devuelve { value, unit } o null.
 */
function pcParseSizeFromName(nombre) {
  const s = _pcNorm(nombre).replace(',', '.');
  // «1 l», «500g», «33 cl», «1.5l», «250 gr»
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*(kg|kilos?|kilo|gr|g|mg|l|litros?|litro|ml|cl|cm|m|uds?|und|unidades?)\b/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const MAPA = {
    kilo: 'kg', kilos: 'kg', kg: 'kg', gr: 'g', g: 'g', mg: 'mg',
    litro: 'l', litros: 'l', l: 'l', ml: 'ml', cl: 'cl',
    cm: 'cm', m: 'm', ud: 'ud', uds: 'ud', und: 'ud', unidad: 'ud', unidades: 'ud',
  };
  const unit = MAPA[m[2]];
  return unit ? { value: val, unit } : null;
}

/**
 * Descriptor normalizado de una línea.
 *
 * El objetivo es tener, para cada línea, la mejor respuesta posible a:
 * «¿qué es?» (core + brand) y «¿cuánto cuesta la unidad comparable?»
 * (unitPrice + magnitud). Cuando no se puede responder a la segunda, se
 * dice: `comparable: false`.
 */
function pcDescribeItem(item, ctx) {
  if (!item) return null;
  const nombreCrudo = String(item.name || '').trim();
  if (!nombreCrudo) return null;

  // 1. Tamaño: el del escáner manda; si no, el que venga en el nombre.
  let size = (item.size != null && item.size > 0 && item.sizeUnit) ? { value: item.size, unit: item.sizeUnit } : null;
  const sizeDelNombre = pcParseSizeFromName(nombreCrudo);
  if (!size) size = sizeDelNombre;
  const sizeFuente = (item.size != null && item.sizeUnit) ? 'escaner' : (sizeDelNombre ? 'nombre' : null);

  // 2. Núcleo del nombre: sin marca, sin tamaño, sin relleno.
  let texto = _pcNorm(nombreCrudo);
  if (item.brand) texto = texto.replace(_pcNorm(item.brand), ' ');
  // Quitar la expresión de tamaño del texto, para que «leche 1l» y «leche»
  // compartan núcleo.
  texto = texto
    .replace(/\b\d+(?:[.,]\d+)?\s*(kg|kilos?|kilo|gr|g|mg|l|litros?|litro|ml|cl|cm|m|uds?|und|unidades?)\b/g, ' ')
    .replace(/\bx\s*\d+\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, ' ')
    // Cantidad de un lote: «pack 12», «12 pack». El número de unidades ya va
    // en qty, y dejarlo en el núcleo separaría «pack 12 cervezas» de
    // «pack 6 cervezas», que es el mismo producto en otro formato.
    .replace(/\bpack\s*\d+\b|\b\d+\s*pack\b/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // Los NÚMEROS se conservan aunque tengan una o dos cifras, al revés que las
  // palabras cortas. Son discriminadores de modelo, versión o año, y
  // descartarlos fundía productos distintos: con un filtro de 3 caracteres,
  // «iPhone 15 128GB» y «iPhone 16 128GB» daban el mismo núcleo
  // («iphone 128gb») y se comparaban como IDÉNTICOS, igual que
  // «Nike Air 90» y «Nike Air 95».
  const tokens = texto.split(' ')
    .filter(w => (w.length >= 3 || /^\d+$/.test(w)) && !PC_RELLENO.has(w));

  // El núcleo usa TODAS las palabras, sin recortar. Recortarlo a las primeras
  // sobre-agrupaba: dos portátiles del mismo modelo con distinta memoria
  // («IdeaPad 15 16GB» y «IdeaPad 15 8GB») perdían justo lo que los distingue.
  // Quedarse corto produce una comparación de menos (molesto); pasarse produce
  // una comparación FALSA (inaceptable), y el encargo pedía precisión por
  // encima de cobertura.
  const core = tokens.join(' ');
  if (!core) return null;

  // 3. Precio por unidad vendida.
  const precioUnidad = (() => {
    if (item.unitPrice != null && item.unitPrice > 0) return item.unitPrice;
    if (item.total != null && item.total > 0 && item.qty && item.qty > 0) return item.total / item.qty;
    // qty DESCONOCIDA (null o ausente): el total es el precio de una unidad.
    // Una qty de 0 o negativa NO es desconocida: contradice un total
    // positivo, y de un dato contradictorio no se saca un precio.
    if (item.total != null && item.total > 0 && item.qty == null) return item.total;
    return null;
  })();

  // 4. Magnitud y precio por unidad CANÓNICA.
  let magnitud = null, metrica = null, precioCanonico = null, baseCanonica = null;

  if (size && PC_UNIDADES[size.unit]) {
    const u = PC_UNIDADES[size.unit];
    magnitud = u.magnitud;
    metrica = PC_METRICA[u.magnitud];
    baseCanonica = size.value * u.factor;          // p.ej. 500 g → 0,5 kg
    if (precioUnidad != null && baseCanonica > 0) precioCanonico = precioUnidad / baseCanonica;
  } else {
    // Sin tamaño: ¿lo delata el nombre? (combustible y similares)
    const pista = PC_PISTAS_NOMBRE.find(p => p.re.test(nombreCrudo));
    if (pista) {
      magnitud = pista.magnitud;
      metrica = PC_METRICA[pista.magnitud];
      // Aquí qty SON las unidades de la magnitud (litros en combustible) y
      // unitPrice ya es el precio por litro: no hay que convertir nada.
      precioCanonico = precioUnidad;
      baseCanonica = 1;
    } else {
      magnitud = 'unidad';
      metrica = PC_METRICA.unidad;
      precioCanonico = precioUnidad;
      baseCanonica = 1;
    }
  }

  return {
    nombre: nombreCrudo,
    core,
    brand: item.brand ? String(item.brand).trim() : null,
    brandNorm: item.brand ? _pcNorm(item.brand) : null,
    size, sizeFuente,
    magnitud, metrica,
    qty: item.qty != null ? item.qty : null,
    precioUnidad,
    precioCanonico,
    baseCanonica,
    // Comparable solo si hay un precio con el que comparar.
    comparable: precioCanonico != null && precioCanonico > 0,
    fuente: 'linea-ticket',
    // Contexto para poder volver a la transacción de origen.
    txId: ctx && ctx.txId, date: ctx && ctx.date,
    merchantKey: ctx && ctx.merchantKey, merchantLabel: ctx && ctx.merchantLabel,
    category: ctx && ctx.category,
  };
}

/* ─── 4. Equivalencia ─────────────────────────────────────────── */

/**
 * ¿Son comparables dos líneas, y con cuánta certeza?
 *
 *   'identico'     — mismo núcleo, misma marca y mismo tamaño
 *   'equivalente'  — mismo núcleo y misma magnitud, distinto tamaño o marca:
 *                    comparable por unidad canónica (€/kg, €/l)
 *   'similar'      — comparten el núcleo principal pero difieren en algo que
 *                    puede cambiar el precio: se muestra, NO se compara
 *   'no-comparable'— ni eso
 *
 * Lo que mantiene esto honesto es la cuarta salida. El encargo insistía en no
 * mezclar los tres niveles y en no comparar sin evidencia: cuando falta el
 * tamaño en uno de los dos y las magnitudes no son de unidad, no se afirma
 * equivalencia.
 */
function pcEquivalence(a, b) {
  if (!a || !b || !a.core || !b.core) return 'no-comparable';

  const mismoNucleo = a.core === b.core;
  const mismaMarca  = (a.brandNorm || null) === (b.brandNorm || null);
  const mismaMagnitud = a.magnitud === b.magnitud;
  const mismoTamano = (() => {
    if (!a.size && !b.size) return true;          // ninguno tiene: por unidad
    if (!a.size || !b.size) return false;         // uno sí y otro no
    return Math.abs((a.baseCanonica || 0) - (b.baseCanonica || 0)) < 1e-9;
  })();

  if (mismoNucleo && mismaMarca && mismoTamano && mismaMagnitud) return 'identico';

  if (mismoNucleo && mismaMagnitud) {
    // Distinto tamaño o distinta marca: comparable por unidad canónica, pero
    // SOLO si los dos tienen tamaño conocido (o ninguno lo necesita).
    const sePuedeNormalizar = a.magnitud === 'unidad' || (a.size && b.size);
    return sePuedeNormalizar ? 'equivalente' : 'similar';
  }

  // Núcleos parecidos: comparten la primera palabra (el sustantivo) pero
  // difieren en los calificativos. «leche entera» y «leche semidesnatada»
  // caen aquí: son el mismo tipo de producto a efectos de navegación, pero no
  // el mismo producto a efectos de precio.
  const n1 = a.core.split(' ')[0];
  const n2 = b.core.split(' ')[0];
  if (n1 && n1 === n2) return 'similar';

  return 'no-comparable';
}

/** Clave de agrupación por producto: núcleo + magnitud. */
function pcItemKey(desc) {
  if (!desc || !desc.core) return null;
  return desc.core + '|' + (desc.magnitud || 'unidad');
}

/**
 * Clave de FAMILIA: magnitud + primera palabra del núcleo. Agrupa productos
 * que se PARECEN sin ser el mismo: «portatil lenovo ideapad 15 16gb» y
 * «portatil lenovo ideapad 15 8gb» caen en la misma familia y en grupos de
 * producto distintos.
 *
 * Hace falta un segundo índice porque sin él el nivel «similar» era
 * inalcanzable entre productos distintos: la comparación solo miraba dentro
 * del grupo del propio núcleo, donde por definición todo tiene el mismo
 * núcleo. El resultado era una lista de parecidos siempre vacía, es decir un
 * campo que mentía por omisión.
 */
function pcFamilyKey(desc) {
  if (!desc || !desc.core) return null;
  const n = desc.core.split(' ')[0];
  if (!n) return null;
  return (desc.magnitud || 'unidad') + '|' + n;
}

/* ─── 5. Índice de precios ────────────────────────────────────── */

let _pcCache = null;

function _pcSignature() {
  const t = (typeof APP !== 'undefined' && APP.transactions) || [];
  let n = 0, suma = 0;
  for (const x of t) { if (x && x.receipt && Array.isArray(x.receipt.items)) n += x.receipt.items.length; suma += (x && x.amount) || 0; }
  return t.length + '|' + n + '|' + suma.toFixed(2);
}

/**
 * Recorre TODAS las líneas de ticket del historial y las agrupa por producto.
 * Una sola pasada, memoizada: abrir el comparador de varios productos no
 * recalcula nada.
 */
function pcIndex() {
  const sig = _pcSignature();
  if (_pcCache && _pcCache.sig === sig) return _pcCache;

  const porProducto = new Map();   // itemKey   → { core, magnitud, metrica, descs[] }
  const porFamilia  = new Map();   // familyKey → Set<itemKey>
  let lineas = 0, conPrecio = 0;

  for (const t of ((typeof APP !== 'undefined' && APP.transactions) || [])) {
    if (!t || t.type !== 'expense' || !t.receipt || !Array.isArray(t.receipt.items)) continue;
    const mk = typeof mhMerchantKey === 'function' ? mhMerchantKey(t) : null;
    if (!mk) continue;

    for (const it of t.receipt.items) {
      const d = pcDescribeItem(it, {
        txId: t.id, date: t.date, merchantKey: mk.key,
        merchantLabel: mk.label, category: t.category,
      });
      if (!d) continue;
      lineas++;
      if (d.comparable) conPrecio++;
      const k = pcItemKey(d);
      if (!k) continue;
      let e = porProducto.get(k);
      if (!e) {
        e = { key: k, core: d.core, magnitud: d.magnitud, metrica: d.metrica, descs: [] };
        porProducto.set(k, e);
      }
      e.descs.push(d);

      const fk = pcFamilyKey(d);
      if (fk) {
        let fam = porFamilia.get(fk);
        if (!fam) { fam = new Set(); porFamilia.set(fk, fam); }
        fam.add(k);
      }
    }
  }

  for (const e of porProducto.values()) {
    e.descs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  _pcCache = { sig, porProducto, porFamilia, lineas, conPrecio };
  return _pcCache;
}

/* ─── 6. Comparación de un producto entre comercios ───────────── */

/**
 * Compara un producto entre los comercios donde el usuario lo ha comprado.
 *
 * `referencia` es el descriptor de la línea desde la que se abre la
 * comparación: se usa para decidir el nivel de equivalencia de cada
 * candidato y para no comparar lo que no toca.
 *
 * Devuelve siempre `registros` (cuántas líneas sustentan cada precio) porque
 * el encargo pedía que el usuario pudiera valorar la fiabilidad.
 */
function pcCompareProduct(referencia) {
  if (!referencia) return null;
  const idx = pcIndex();
  const grupo = idx.porProducto.get(pcItemKey(referencia));
  if (!grupo) return null;

  // Clasificar cada línea respecto a la referencia. Solo idénticas y
  // equivalentes entran en la comparación de precios.
  const comparables = [];
  const similares = [];
  for (const d of grupo.descs) {
    const nivel = pcEquivalence(referencia, d);
    if (!d.comparable) continue;
    if (nivel === 'identico' || nivel === 'equivalente') comparables.push({ d, nivel });
    else if (nivel === 'similar') similares.push({ d, nivel });
  }

  // Parecidos de otros grupos: mismo tipo de producto, núcleo distinto. NO
  // entran en la comparación de precios, porque es justo aquello en lo que
  // difieren (la memoria, el modelo, la variedad) lo que haría falsa la
  // cifra. Se enseñan para que el usuario sepa que están ahí y los revise si
  // quiere: ocultarlos del todo escondería que la app los ha visto y ha
  // decidido no compararlos.
  const refKey = pcItemKey(referencia);
  const famKey = pcFamilyKey(referencia);
  if (famKey && idx.porFamilia) {
    for (const otraKey of (idx.porFamilia.get(famKey) || [])) {
      if (otraKey === refKey) continue;
      const otro = idx.porProducto.get(otraKey);
      if (!otro) continue;
      for (const d of otro.descs) {
        if (!d.comparable) continue;
        if (pcEquivalence(referencia, d) === 'similar') similares.push({ d, nivel: 'similar' });
      }
    }
  }

  // Un parecido por PRODUCTO, no uno por línea de ticket: si el usuario ha
  // comprado el modelo de 8 GB cuatro veces, es un parecido, no cuatro.
  const similaresPorProducto = (() => {
    const m = new Map();
    for (const { d } of similares) {
      let e = m.get(d.core);
      if (!e) {
        e = { core: d.core, nombre: d.nombre, metrica: d.metrica,
              registros: 0, comercios: new Set(), ultimo: null, ultimaFecha: '' };
        m.set(d.core, e);
      }
      e.registros++;
      if (d.merchantLabel) e.comercios.add(d.merchantLabel);
      if (d.date > e.ultimaFecha) {
        e.ultimaFecha = d.date;
        e.ultimo = d.precioCanonico;
        e.nombre = d.nombre;
      }
    }
    return [...m.values()]
      .map(e => ({
        core: e.core, nombre: e.nombre, metrica: e.metrica,
        registros: e.registros, comercios: [...e.comercios],
        ultimo: e.ultimo, ultimaFecha: e.ultimaFecha,
      }))
      .sort((a, b) => b.registros - a.registros);
  })();

  // Agrupar por comercio.
  const porComercio = new Map();
  for (const { d, nivel } of comparables) {
    let e = porComercio.get(d.merchantKey);
    if (!e) {
      e = {
        merchantKey: d.merchantKey, merchantLabel: d.merchantLabel,
        precios: [], fechas: [], txIds: [], niveles: new Set(),
      };
      porComercio.set(d.merchantKey, e);
    }
    e.precios.push(d.precioCanonico);
    e.fechas.push(d.date);
    e.txIds.push(d.txId);
    e.niveles.add(nivel);
  }

  const alternativas = [...porComercio.values()].map(e => {
    const n = e.precios.length;
    const ultimoIdx = e.fechas.reduce((best, f, i) => (f > e.fechas[best] ? i : best), 0);
    return {
      merchantKey: e.merchantKey,
      merchantLabel: e.merchantLabel,
      registros: n,
      ultimo: e.precios[ultimoIdx],
      ultimaFecha: e.fechas[ultimoIdx],
      ultimoTxId: e.txIds[ultimoIdx],
      medio: e.precios.reduce((a, b) => a + b, 0) / n,
      min: Math.min(...e.precios),
      max: Math.max(...e.precios),
      txIds: e.txIds,
      // Si alguna línea de este comercio era equivalente (no idéntica), la
      // comparación es por unidad canónica y conviene decirlo.
      soloIdenticos: e.niveles.size === 1 && e.niveles.has('identico'),
    };
  });

  // Se compara por el ÚLTIMO precio de cada comercio: es la pregunta real
  // («¿dónde me costaría hoy menos, según lo que he pagado?»). La media
  // histórica se muestra aparte.
  alternativas.sort((a, b) => a.ultimo - b.ultimo);

  const nComercios = alternativas.length;
  const barato = nComercios ? alternativas[0] : null;
  const caro   = nComercios ? alternativas[nComercios - 1] : null;
  const medioEntreComercios = nComercios
    ? alternativas.reduce((s, a) => s + a.ultimo, 0) / nComercios : null;

  return {
    core: grupo.core,
    magnitud: grupo.magnitud,
    metrica: grupo.metrica,
    referencia,
    alternativas,
    similares: similares.map(s => s.d),
    similaresPorProducto,
    nComercios,
    barato, caro,
    medioEntreComercios,
    // Comparar un producto consigo mismo en un solo comercio no es comparar.
    comparacionValida: nComercios >= 2,
    // Diferencia entre el más barato y el más caro, por unidad canónica.
    difUnidad: nComercios >= 2 ? caro.ultimo - barato.ultimo : null,
    pctDif: nComercios >= 2 && barato.ultimo > 0
      ? ((caro.ultimo - barato.ultimo) / barato.ultimo) * 100 : null,
    fuente: 'linea-ticket',
  };
}

/**
 * Ahorro histórico que habría supuesto comprar en el más barato.
 *
 * SIEMPRE histórico: se calcula con precios que el usuario ya pagó, no con
 * una oferta disponible hoy. La interfaz lo etiqueta así, y el encargo
 * insistía en no confundir las dos cosas.
 */
function pcAhorroHistorico(cmp, referencia) {
  if (!cmp || !cmp.comparacionValida || !referencia || !referencia.comparable) return null;
  const masBarato = cmp.barato.ultimo;
  if (!(referencia.precioCanonico > masBarato)) return null;

  const difUnidad = referencia.precioCanonico - masBarato;
  // Lo que se compró de verdad en esta línea, en unidades canónicas.
  const cantidad = (referencia.baseCanonica || 1) * (referencia.qty || 1);
  return {
    porUnidad: difUnidad,
    enEstaCompra: difUnidad * cantidad,
    donde: cmp.barato.merchantLabel,
    dondeKey: cmp.barato.merchantKey,
    registros: cmp.barato.registros,
    metrica: cmp.metrica,
  };
}

/* ─── 7. Servicios sin líneas de detalle ──────────────────────── */

/**
 * Cadencia de un historial de operaciones: mensual, anual, etc.
 * Se MIDE, no se deduce de la categoría: una suscripción se reconoce porque
 * se repite cada ~30 días. Devuelve null si no hay un patrón claro.
 */
function pcDetectaCadencia(txs) {
  const fechas = txs.map(t => t.date).filter(Boolean).sort();
  if (fechas.length < 3) return null;
  const difs = [];
  for (let i = 1; i < fechas.length; i++) {
    const d = (new Date(fechas[i] + 'T00:00:00') - new Date(fechas[i - 1] + 'T00:00:00')) / 86400000;
    if (d > 0) difs.push(d);
  }
  if (difs.length < 2) return null;
  const media = difs.reduce((a, b) => a + b, 0) / difs.length;
  // Regularidad: la desviación no puede ser más del 25 % de la media, o no
  // es una cadencia, son compras sueltas.
  const desv = Math.sqrt(difs.reduce((s, d) => s + (d - media) ** 2, 0) / difs.length);
  if (media > 0 && desv / media > 0.25) return null;

  for (const [id, r] of Object.entries(PC_SERVICIO)) {
    if (media >= r.dias[0] && media <= r.dias[1]) {
      return { id, label: r.label, mediaDias: media, regularidad: 1 - (desv / media) };
    }
  }
  return null;
}

/**
 * Compara el coste de un servicio entre proveedores de la MISMA categoría,
 * cuando no hay líneas de producto con las que comparar.
 *
 * Esta es la parte más delicada del encargo: pedía comparar hoteles, seguros
 * y gimnasios. Con los datos que hay (importe, fecha, categoría, comercio) se
 * puede comparar el coste POR OPERACIÓN o POR PERIODO, y nada más. No hay
 * noches, ni coberturas, ni condiciones.
 *
 * Por eso devuelve `advertencia`: el número es real, pero la equivalencia de
 * lo contratado NO está verificada, y el usuario tiene que saberlo.
 */
function pcCompareService(category, referenciaTx, merchantKeyActual) {
  if (!category || !referenciaTx) return null;
  const todas = ((typeof APP !== 'undefined' && APP.transactions) || [])
    .filter(t => t && t.type === 'expense' && t.category === category && t.date);

  const porComercio = new Map();
  for (const t of todas) {
    const mk = typeof mhMerchantKey === 'function' ? mhMerchantKey(t) : null;
    if (!mk) continue;
    let e = porComercio.get(mk.key);
    if (!e) { e = { merchantKey: mk.key, merchantLabel: mk.label, txs: [] }; porComercio.set(mk.key, e); }
    e.txs.push(t);
  }

  const alternativas = [...porComercio.values()].map(e => {
    const importes = e.txs.map(t => t.amount);
    const orden = e.txs.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const ultima = orden[orden.length - 1];
    const cadencia = pcDetectaCadencia(e.txs);
    return {
      merchantKey: e.merchantKey,
      merchantLabel: e.merchantLabel,
      registros: e.txs.length,
      ultimo: ultima.amount,
      ultimaFecha: ultima.date,
      ultimoTxId: ultima.id,
      medio: importes.reduce((a, b) => a + b, 0) / importes.length,
      min: Math.min(...importes),
      max: Math.max(...importes),
      cadencia,
      txIds: e.txs.map(t => t.id),
      esActual: e.merchantKey === merchantKeyActual,
    };
  }).sort((a, b) => a.medio - b.medio);

  if (alternativas.length < 2) return null;

  // Solo se puede hablar de «coste mensual» si TODOS tienen la misma
  // cadencia. Si uno es mensual y otro anual, compararlos sin más sería
  // comparar 12 € con 120 € como si fuera lo mismo.
  const cadencias = new Set(alternativas.map(a => a.cadencia && a.cadencia.id).filter(Boolean));
  const metrica = (cadencias.size === 1 && alternativas.every(a => a.cadencia))
    ? PC_SERVICIO[[...cadencias][0]].label
    : '€/operación';

  return {
    category,
    alternativas,
    metrica,
    barato: alternativas[0],
    caro: alternativas[alternativas.length - 1],
    medioEntreComercios: alternativas.reduce((s, a) => s + a.medio, 0) / alternativas.length,
    comparacionValida: true,
    fuente: 'importe-total',
    // Lo que el usuario necesita saber para no sacar conclusiones falsas.
    advertencia: 'Compara el importe de cada operación dentro de la misma categoría. '
      + 'Finova no guarda las condiciones de cada servicio (duración, coberturas, '
      + 'incluidos), así que puede que no sean equivalentes.',
  };
}

/* ─── 8. Evolución del precio de un producto ──────────────────── */

/**
 * Serie temporal del precio por unidad canónica de un producto, con el
 * comercio de cada punto. Es lo que permite responder a «¿me está subiendo
 * el precio de esto?».
 */
function pcPriceHistory(referencia) {
  if (!referencia) return null;
  const idx = pcIndex();
  const grupo = idx.porProducto.get(pcItemKey(referencia));
  if (!grupo) return null;

  const puntos = grupo.descs
    .filter(d => d.comparable && ['identico', 'equivalente'].includes(pcEquivalence(referencia, d)))
    .map(d => ({
      date: d.date, precio: d.precioCanonico,
      merchantKey: d.merchantKey, merchantLabel: d.merchantLabel,
      txId: d.txId, nombre: d.nombre,
      size: d.size, fuente: d.fuente,
    }));

  if (puntos.length < 2) return { puntos, suficiente: false, metrica: grupo.metrica };

  const precios = puntos.map(p => p.precio);
  const primero = precios[0], ultimo = precios[precios.length - 1];
  return {
    puntos,
    suficiente: true,
    metrica: grupo.metrica,
    primero, ultimo,
    medio: precios.reduce((a, b) => a + b, 0) / precios.length,
    min: Math.min(...precios),
    max: Math.max(...precios),
    variacionPct: primero > 0 ? ((ultimo - primero) / primero) * 100 : null,
    comercios: [...new Set(puntos.map(p => p.merchantLabel))],
  };
}

/* ─── 9. Resumen para la ficha ────────────────────────────────── */

/**
 * Lo que la ficha de una transacción necesita: para cada línea del ticket,
 * si hay comparación y cuánto se podría haber ahorrado.
 *
 * Si la transacción no tiene líneas, cae a la comparación de servicio.
 */
function pcSummaryForTx(tx) {
  if (!tx) return null;
  const mk = typeof mhMerchantKey === 'function' ? mhMerchantKey(tx) : null;
  const items = (tx.receipt && Array.isArray(tx.receipt.items)) ? tx.receipt.items : [];

  if (!items.length) {
    return {
      tipo: 'servicio',
      servicio: pcCompareService(tx.category, tx, mk && mk.key),
      sinLineas: true,
    };
  }

  const lineas = [];
  let ahorroTotal = 0;
  for (const it of items) {
    const d = pcDescribeItem(it, {
      txId: tx.id, date: tx.date, merchantKey: mk && mk.key,
      merchantLabel: mk && mk.label, category: tx.category,
    });
    if (!d) continue;
    const cmp = pcCompareProduct(d);
    const ahorro = cmp ? pcAhorroHistorico(cmp, d) : null;
    if (ahorro) ahorroTotal += ahorro.enEstaCompra;
    lineas.push({ desc: d, cmp, ahorro, historial: pcPriceHistory(d) });
  }

  return {
    tipo: 'productos',
    lineas,
    ahorroTotal: ahorroTotal > 0 ? ahorroTotal : null,
    // Cuántas líneas tienen de verdad una comparación entre varios comercios.
    conComparacion: lineas.filter(l => l.cmp && l.cmp.comparacionValida).length,
    sinLineas: false,
  };
}

/* ─── 10. Los mejores ahorros de todo el historial ────────────── */

/**
 * Recorre el índice y devuelve los productos donde la diferencia entre
 * comercios es mayor. Es la vista de «dónde estoy perdiendo dinero».
 */
function pcTopAhorros(limite) {
  const idx = pcIndex();
  const out = [];
  for (const grupo of idx.porProducto.values()) {
    // Se toma la línea más reciente como referencia del producto.
    const ref = grupo.descs[grupo.descs.length - 1];
    if (!ref || !ref.comparable) continue;
    const cmp = pcCompareProduct(ref);
    if (!cmp || !cmp.comparacionValida) continue;
    out.push({
      core: grupo.core,
      metrica: grupo.metrica,
      barato: cmp.barato,
      caro: cmp.caro,
      difUnidad: cmp.difUnidad,
      pctDif: cmp.pctDif,
      nComercios: cmp.nComercios,
      registros: cmp.alternativas.reduce((s, a) => s + a.registros, 0),
      ref,
    });
  }
  return out.sort((a, b) => (b.pctDif || 0) - (a.pctDif || 0)).slice(0, limite || 10);
}
