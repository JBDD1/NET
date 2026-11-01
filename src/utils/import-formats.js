'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — CAPA DE FORMATOS DE IMPORTACIÓN

   Convierte cualquier archivo financiero en una representación única
   (el «IR») para que las capas de arriba no sepan nada de formatos.

   ── El IR ──
   {
     format:   'csv' | 'tsv' | 'json' | 'xml' | 'html' | 'ofx' | 'qif'
             | 'mt940' | 'camt053' | 'desconocido',
     kind:     'tablas' | 'registros',
     tablas:   [{ nombre, filas: [[celda, ...]], meta }],   // kind 'tablas'
     registros:[{ ... }],                                   // kind 'registros'
     cuentas:  [{ id, iban, divisa, saldoInicial, saldoFinal, fechaSaldo }],
     avisos:   [string],
   }

   ── Por qué dos clases de IR ──
   Un CSV no dice qué significan sus columnas: hay que deducirlo, y de eso
   se encarga la capa semántica. OFX, QIF, MT940 y CAMT.053 SÍ lo dicen: son
   formatos estandarizados donde `CdtDbtInd` es el signo y punto. Pasarlos
   por un detector de columnas sería tirar información cierta y sustituirla
   por una deducción. Esos producen `registros` ya semánticos.

   ── El formato se decide por CONTENIDO, no por extensión ──
   Los bancos y los brókers mienten con la extensión constantemente: lo más
   habitual es un archivo llamado .xls que en realidad es una tabla HTML
   (Degiro, ING y varios bancos lo hacen), o un .csv separado por
   tabuladores. La extensión solo se usa para desempatar.
═══════════════════════════════════════════════════════════════ */

/* ─── 1. Detección de formato ─────────────────────────────────── */

/**
 * Qué es este texto. Se mira el contenido en este orden, de la firma más
 * inequívoca a la más ambigua, porque algunas se contienen entre sí: un
 * CAMT.053 es XML válido, y un OFX v2 también.
 */
function ieSniffFormat(text, filename) {
  const s = String(text || '');
  const cabeza = s.slice(0, 4000);
  const ext = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const e = ext ? ext[1] : '';

  // CAMT.053 antes que XML: es XML, pero con semántica propia.
  if (/<(?:\w+:)?Document[\s>]/i.test(cabeza) && /<(?:\w+:)?BkToCstmrStmt[\s>]/i.test(s)) return 'camt053';
  // OFX: v1 es SGML con cabecera OFXHEADER, v2 es XML con <OFX>.
  if (/OFXHEADER\s*[:=]/i.test(cabeza) || /<OFX>/i.test(cabeza)) return 'ofx';
  // QIF: la primera línea útil es un !Type:
  if (/^\s*!\s*(?:Type|Account|Option|Clear)\s*:/im.test(cabeza)) return 'qif';
  // MT940: bloques :NN: al principio de línea. Se exige más de uno y que
  // esté el de movimiento (:61:) o el de saldo inicial (:60F:), porque un
  // CSV con «:20:» suelto en una celda no es un MT940.
  if (/^:\d{2}[A-Z]?:/m.test(cabeza) && /^:6[012][FM]?:/m.test(s)) return 'mt940';

  // Un texto que empieza por { o [ es JSON por intención, aunque esté roto.
  // Devolverlo como JSON y dejar que el parser falle da un mensaje útil («el
  // archivo no es JSON válido») en vez del genérico «no se reconoce el
  // formato», que no le dice al usuario qué arreglar.
  if (/^\s*[[{]/.test(cabeza)) return 'json';
  if (/<table[\s>]/i.test(cabeza) || /<!doctype\s+html/i.test(cabeza) || /<html[\s>]/i.test(cabeza)) return 'html';
  if (/^\s*<\?xml/.test(cabeza) || /^\s*<[a-z_]/i.test(cabeza)) return 'xml';

  // Separado por algo. El tabulador se mira aparte porque un .csv con
  // tabuladores es de lo más común.
  const sep = ieDetectSeparator(s);
  if (sep) return sep === '\t' ? 'tsv' : 'csv';

  // La extensión, solo como último recurso, y solo si el contenido es
  // mínimamente tabular. Fiarse de un «.csv» vacío o de una sola línea de
  // texto libre haría que el error saliera después, al parsear, con un
  // mensaje mucho peor: «no se encontraron transacciones» en vez de «no se
  // ha reconocido el formato».
  const utiles = s.split(/\r?\n/).filter(l => l.trim()).length;
  if (utiles >= 2) {
    if (['csv', 'txt'].includes(e)) return 'csv';
    if (e === 'tsv') return 'tsv';
  }
  return 'desconocido';
}

/**
 * Separador de un archivo delimitado. Se cuenta cada candidato FUERA de las
 * comillas y se exige que el recuento sea estable entre líneas: un texto
 * libre con comas sueltas da un recuento errático, una tabla no.
 */
function ieDetectSeparator(text) {
  const lineas = String(text || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
  if (lineas.length < 2) return null;

  let mejor = null, mejorPuntos = 0;
  for (const sep of ['\t', ';', ',', '|']) {
    const cuentas = lineas.map(l => ieCountOutsideQuotes(l, sep));
    const conAlgo = cuentas.filter(n => n > 0);
    if (conAlgo.length < 2) continue;
    // La moda del recuento, y cuántas líneas la respetan.
    const frec = new Map();
    for (const n of conAlgo) frec.set(n, (frec.get(n) || 0) + 1);
    const [moda, veces] = [...frec.entries()].sort((a, b) => b[1] - a[1])[0];
    // Puntos = columnas × consistencia. Un separador que parte en 8 columnas
    // de forma estable gana a uno que parte en 2.
    const puntos = moda * (veces / conAlgo.length) * (veces >= 2 ? 1 : 0);
    if (puntos > mejorPuntos) { mejorPuntos = puntos; mejor = sep; }
  }
  return mejorPuntos >= 1 ? mejor : null;
}

/** Cuenta apariciones de `sep` fuera de comillas dobles. */
function ieCountOutsideQuotes(linea, sep) {
  let n = 0, enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') enComillas = !enComillas;
    else if (c === sep && !enComillas) n++;
  }
  return n;
}

/* ─── 2. Utilidades de parseo ─────────────────────────────────── */

/**
 * Parte una línea delimitada respetando comillas y comillas escapadas ("").
 * El proyecto ya tenía `_csvSplit`, pero no entiende `""` dentro de un campo
 * ni los saltos de línea dentro de comillas, y los dos aparecen en extractos
 * reales (una descripción con comillas, una dirección en dos líneas).
 */
function ieSplitLine(linea, sep) {
  const out = [];
  let cur = '', enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') { cur += '"'; i++; }
      else enComillas = !enComillas;
    } else if (c === sep && !enComillas) {
      out.push(cur.trim()); cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Trocea un texto delimitado en filas, respetando los saltos de línea que
 * estén DENTRO de comillas. Partir por \n sin más rompe cualquier extracto
 * con una descripción multilínea, y el fallo es silencioso: salen filas
 * descuadradas que luego se descartan por «no válidas».
 */
function ieSplitRows(text, sep) {
  const filas = [];
  let cur = '', enComillas = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { enComillas = !enComillas; cur += c; }
    else if (c === '\n' && !enComillas) { filas.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur) filas.push(cur);
  return filas.filter(l => l.trim() !== '').map(l => ieSplitLine(l, sep));
}

/** Rellena las filas cortas para que la tabla sea rectangular. */
function ieRectangular(filas) {
  const ancho = filas.reduce((m, f) => Math.max(m, f.length), 0);
  return filas.map(f => (f.length === ancho ? f : f.concat(Array(ancho - f.length).fill(''))));
}

/* ─── 3. Formatos tabulares ───────────────────────────────────── */

function ieParseDelimited(text, sep) {
  const filas = ieRectangular(ieSplitRows(text, sep));
  return {
    kind: 'tablas',
    tablas: filas.length ? [{ nombre: 'Hoja 1', filas, meta: { separador: sep } }] : [],
    avisos: filas.length ? [] : ['El archivo no tiene filas aprovechables.'],
  };
}

/**
 * JSON. Se buscan TODOS los arrays de objetos del árbol, a cualquier
 * profundidad, y cada uno se convierte en una tabla.
 *
 * Buscar en todo el árbol y no solo en la raíz es lo que hace que funcione
 * con las exportaciones reales: casi ninguna pone el array arriba. Vienen
 * como { data: { transactions: [...] } }, { result: { items: [...] } } o con
 * varios arrays hermanos (posiciones y operaciones en el mismo archivo), y
 * quedarse solo con el primero perdería la mitad del archivo.
 */
function ieParseJSON(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { kind: 'tablas', tablas: [], avisos: ['El archivo no es JSON válido.'] }; }

  const encontrados = [];
  const visto = new Set();

  const recorre = (nodo, ruta, prof) => {
    if (!nodo || typeof nodo !== 'object' || prof > 8) return;
    if (visto.has(nodo)) return;          // ciclos
    visto.add(nodo);

    if (Array.isArray(nodo)) {
      const objetos = nodo.filter(x => x && typeof x === 'object' && !Array.isArray(x));
      // Se exige mayoría de objetos: un array de números no es una tabla.
      if (objetos.length >= 1 && objetos.length >= nodo.length / 2) {
        encontrados.push({ ruta, items: objetos });
      }
      nodo.forEach((x, i) => recorre(x, ruta ? `${ruta}[${i}]` : `[${i}]`, prof + 1));
      return;
    }
    for (const [k, v] of Object.entries(nodo)) recorre(v, ruta ? `${ruta}.${k}` : k, prof + 1);
  };
  recorre(data, '', 0);

  // Un array hijo de otro ya contado no se cuenta dos veces: se queda el de
  // más arriba, que es el que tiene las filas completas.
  const raices = encontrados.filter(a =>
    !encontrados.some(b => b !== a && a.ruta.startsWith(b.ruta) && b.ruta !== ''));

  const tablas = (raices.length ? raices : encontrados).map((a, i) => {
    // Con lambda, no `map(ieFlattenObject)`: map pasa (elemento, índice,
    // array), que caerían en los parámetros `prefijo` y `prof`. El efecto era
    // sutil y pasaba el ojo: la fila 0 salía bien (índice 0 es falsy) y las
    // demás con las claves prefijadas, y como `prof` recibía el array entero,
    // `prof < 4` era false y no se aplanaba nada.
    const planos = a.items.map(o => ieFlattenObject(o));
    const claves = [...new Set(planos.flatMap(Object.keys))];
    return {
      nombre: a.ruta || `Datos ${i + 1}`,
      filas: [claves, ...planos.map(o => claves.map(k => (o[k] == null ? '' : String(o[k]))))],
      meta: { ruta: a.ruta, origen: 'json' },
    };
  });

  return {
    kind: 'tablas', tablas,
    avisos: tablas.length ? [] : ['El JSON no contiene ninguna lista de registros.'],
  };
}

/**
 * Aplana un objeto anidado a `padre.hijo`. Las exportaciones de exchanges
 * anidan casi todo (`{fee: {currency, cost}}`), y sin aplanar la columna del
 * importe de la comisión no existe para el detector de campos.
 */
function ieFlattenObject(obj, prefijo, prof) {
  const out = {};
  const p = prefijo || '';
  const d = prof || 0;
  for (const [k, v] of Object.entries(obj || {})) {
    const clave = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && d < 4) {
      Object.assign(out, ieFlattenObject(v, clave, d + 1));
    } else if (Array.isArray(v)) {
      // Un array dentro de una fila no es una columna: se deja su longitud y
      // el primer valor escalar, que a veces es lo único que importa.
      const escalares = v.filter(x => x == null || typeof x !== 'object');
      out[clave] = escalares.length === v.length ? escalares.join(' ') : `[${v.length}]`;
    } else {
      out[clave] = v;
    }
  }
  return out;
}

/**
 * XML, con un escáner de etiquetas propio en vez de DOMParser.
 *
 * Dos razones: DOMParser no existe fuera del navegador, así que con él esto
 * no se podría probar; y los XML de los brókers traen prefijos de espacio de
 * nombres distintos en cada exportación, que aquí se ignoran a propósito.
 */
function ieParseXML(text) {
  const s = String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => ieEscapeXmlText(c));

  // Cuenta elementos por nombre local, quedándose con los que se repiten y
  // tienen hijos: son las «filas» del documento.
  const repes = new Map();
  const re = /<((?:[\w.-]+:)?[\w.-]+)((?:\s[^>]*?)?)(\/?)>/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[3] === '/') continue;                       // <tag/> vacío
    const local = m[1].replace(/^[\w.-]+:/, '');
    repes.set(local, (repes.get(local) || 0) + 1);
  }

  const candidatos = [...repes.entries()]
    .filter(([nombre, n]) => n >= 2 && ieHasChildElements(s, nombre))
    .sort((a, b) => b[1] - a[1]);

  if (!candidatos.length) {
    return { kind: 'tablas', tablas: [], avisos: ['El XML no tiene elementos repetidos que parezcan registros.'] };
  }

  // Solo el más repetido con hijos, y los que tengan al menos la mitad de sus
  // apariciones: así un archivo con posiciones Y operaciones da dos tablas,
  // pero los contenedores sueltos no generan ruido.
  const umbral = candidatos[0][1] / 2;
  const elegidos = candidatos.filter(([, n]) => n >= umbral).slice(0, 4);

  const tablas = [];
  for (const [nombre] of elegidos) {
    const bloques = ieExtractBlocks(s, nombre);
    const planos = bloques.map(b => ieXmlBlockToObject(b));
    if (!planos.length) continue;
    const claves = [...new Set(planos.flatMap(Object.keys))];
    if (claves.length < 2) continue;                  // un elemento de un solo campo no es una fila
    tablas.push({
      nombre,
      filas: [claves, ...planos.map(o => claves.map(k => (o[k] == null ? '' : String(o[k]))))],
      meta: { elemento: nombre, origen: 'xml' },
    });
  }

  return {
    kind: 'tablas', tablas,
    avisos: tablas.length ? [] : ['No se pudo convertir el XML en filas.'],
  };
}

/**
 * Texto directo de un bloque: el que queda FUERA de cualquier hijo. Se
 * recorre contando profundidad en vez de usar una expresión regular con
 * retrorreferencia, que no distingue hijos anidados del mismo nombre.
 */
function ieDirectText(bloque) {
  const s = String(bloque || '');
  let out = '', prof = 0, i = 0;
  while (i < s.length) {
    if (s[i] === '<') {
      const fin = s.indexOf('>', i);
      if (fin < 0) break;
      const etiqueta = s.slice(i + 1, fin);
      if (etiqueta.startsWith('/')) prof = Math.max(0, prof - 1);
      else if (!etiqueta.endsWith('/')) prof++;
      i = fin + 1;
      continue;
    }
    if (prof === 0) out += s[i];
    i++;
  }
  return ieUnescapeXml(out).replace(/s+/g, ' ').trim();
}

function ieEscapeXmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ieUnescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** ¿Tiene `nombre` algún elemento hijo? (si no, es una hoja, no una fila) */
function ieHasChildElements(s, nombre) {
  const bloques = ieExtractBlocks(s, nombre, 1);
  return bloques.length > 0 && /<(?:[\w.-]+:)?[\w.-]+[\s/>]/.test(bloques[0]);
}

/**
 * Extrae el contenido de cada `<nombre>…</nombre>`, contando la anidación
 * para no cortar en el cierre de un homónimo interior.
 */
function ieExtractBlocks(s, nombre, limite) {
  const out = [];
  const abre  = new RegExp(`<(?:[\\w.-]+:)?${nombre}((?:\\s[^>]*?)?)(/?)>`, 'g');
  const cierra = new RegExp(`</(?:[\\w.-]+:)?${nombre}\\s*>`, 'g');
  let m;
  while ((m = abre.exec(s))) {
    if (m[2] === '/') continue;
    const desde = m.index + m[0].length;
    // Buscar el cierre que corresponde, contando aperturas intermedias.
    let nivel = 1, pos = desde;
    while (nivel > 0) {
      abre.lastIndex = pos; cierra.lastIndex = pos;
      const a = abre.exec(s), c = cierra.exec(s);
      // Una apertura autocerrada no abre nivel.
      const aPos = a && a[2] !== '/' ? a.index : (a ? -2 : -1);
      if (!c) { nivel = 0; pos = s.length; break; }
      if (aPos >= 0 && aPos < c.index) { nivel++; pos = aPos + a[0].length; }
      else { nivel--; pos = c.index + c[0].length; if (nivel === 0) { out.push(s.slice(desde, c.index) + ieAttrsAsTags(m[1])); } }
    }
    abre.lastIndex = pos;
    if (limite && out.length >= limite) break;
  }
  return out;
}

/** Los atributos se tratan como hijos: `<Amt Ccy="EUR">` aporta la divisa. */
function ieAttrsAsTags(attrs) {
  let out = '';
  const re = /([\w.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrs || ''))) {
    const local = m[1].replace(/^[\w.-]+:/, '');
    out += `<@${local}>${m[2]}</@${local}>`;
  }
  return out;
}

/**
 * Convierte un bloque XML en un objeto plano `ruta.hoja → texto`.
 * Solo las hojas: un nodo con hijos no tiene valor propio.
 */
function ieXmlBlockToObject(bloque) {
  const out = {};
  const recorre = (s, prefijo, prof) => {
    if (prof > 6) return;
    const re = /<((?:[\w.-]+:)?[@\w.-]+)((?:\s[^>]*?)?)(\/?)>/g;
    let m;
    let pos = 0;
    while ((m = re.exec(s))) {
      if (m.index < pos) continue;
      const local = m[1].replace(/^[\w.-]+:/, '');
      const clave = prefijo ? `${prefijo}.${local}` : local;
      if (m[3] === '/') { out[clave] = ''; pos = m.index + m[0].length; re.lastIndex = pos; continue; }
      const dentro = ieExtractBlocks(s.slice(m.index), local, 1)[0];
      if (dentro == null) { pos = m.index + m[0].length; re.lastIndex = pos; continue; }
      const tieneHijos = /<(?:[\w.-]+:)?[@\w.-]+[\s/>]/.test(dentro);
      if (tieneHijos) {
        recorre(dentro, clave, prof + 1);
        // Y su texto propio, el que queda fuera de los hijos. Sin esto, todo
        // elemento con atributos pierde su valor, porque los atributos se
        // inyectan aquí como hijos: <Amt Ccy="EUR">48.20</Amt> se quedaba sin
        // el 48,20 y el apunte entero se descartaba por no tener importe.
        const propio = ieDirectText(dentro);
        if (propio) out[clave] = out[clave] ? out[clave] + ' ' + propio : propio;
      } else {
        const v = ieUnescapeXml(dentro);
        // Varias hojas con el mismo nombre (p. ej. <Ustrd> repetido) se
        // concatenan en vez de perderse: en CAMT la descripción viene así.
        out[clave] = out[clave] ? `${out[clave]} ${v}` : v;
      }
      const fin = s.slice(m.index).search(new RegExp(`</(?:[\\w.-]+:)?${local}\\s*>`));
      pos = m.index + (fin >= 0 ? fin : m[0].length);
      re.lastIndex = pos;
    }
  };
  recorre(bloque, '', 0);
  return out;
}

/**
 * HTML. Lo que de verdad importa aquí es que muchísimos «.xls» de bancos y
 * brókers son tablas HTML renombradas: sin esto, el archivo que el usuario
 * tiene delante falla con «no es un Excel válido».
 */
function ieParseHTML(text) {
  const s = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
  const tablas = [];
  const reTabla = /<table[\s>][\s\S]*?<\/table>/gi;
  let m;
  while ((m = reTabla.exec(s))) {
    const filas = [];
    const reFila = /<tr[\s>]([\s\S]*?)<\/tr>/gi;
    let f;
    while ((f = reFila.exec(m[0]))) {
      const celdas = [];
      const reCelda = /<t[hd][\s>]([\s\S]*?)<\/t[hd]>/gi;
      let c;
      while ((c = reCelda.exec('>' + f[1]))) {
        celdas.push(ieUnescapeXml(c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')));
      }
      if (celdas.length) filas.push(celdas);
    }
    // Una tabla de una fila o una columna es maquetación, no datos.
    if (filas.length >= 2 && filas.some(f2 => f2.length >= 2)) {
      tablas.push({ nombre: `Tabla ${tablas.length + 1}`, filas: ieRectangular(filas), meta: { origen: 'html' } });
    }
  }
  return {
    kind: 'tablas', tablas,
    avisos: tablas.length ? [] : ['El HTML no contiene ninguna tabla con datos.'],
  };
}

/* ─── 4. Formatos bancarios estandarizados ────────────────────── */

/*
 * Los cuatro de abajo producen `registros`, no `tablas`. En ellos el
 * significado de cada campo está en la especificación: el signo de un
 * movimiento MT940 es la letra D o C de la línea :61:, y el de un CAMT es
 * <CdtDbtInd>. Deducirlo mirando columnas sería sustituir un dato cierto por
 * una conjetura.
 *
 * Forma de un registro de movimiento:
 *   { tipoRegistro: 'mov-banco', fecha, fechaValor?, importe, divisa,
 *     descripcion, idOriginal?, tipoBanco?, contrapartida?, saldoTras? }
 *
 * Y de uno de inversión:
 *   { tipoRegistro: 'op-inversion', fecha, accion, ticker?, isin?, nombre?,
 *     cantidad?, precio?, importe?, comision?, divisa, idOriginal? }
 */

/** Fecha de OFX: YYYYMMDD con hora y zona opcionales. */
function ieOfxDate(v) {
  const m = String(v || '').trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Importe de OFX: siempre punto decimal y signo delante. */
function ieOfxAmount(v) {
  const n = parseFloat(String(v || '').replace(/[^\d.\-+]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * OFX y QFX, v1 (SGML, etiquetas sin cerrar) y v2 (XML).
 *
 * El truco que lo hace funcionar con los dos: en SGML las etiquetas no se
 * cierran, así que se lee «hasta el siguiente <». Es válido también para el
 * XML, donde el siguiente < es justo el cierre.
 */
function ieParseOFX(text) {
  const s = String(text || '');
  const avisos = [];

  // Campo suelto dentro de un bloque.
  const campo = (bloque, etiqueta) => {
    const m = bloque.match(new RegExp(`<${etiqueta}>\\s*([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  // Todos los bloques <TAG> … (hasta </TAG> o hasta el siguiente <TAG>).
  const bloques = (etiqueta) => {
    const out = [];
    const re = new RegExp(`<${etiqueta}>([\\s\\S]*?)(?:</${etiqueta}>|(?=<${etiqueta}>)|$)`, 'gi');
    let m;
    while ((m = re.exec(s))) out.push(m[1]);
    return out;
  };

  const divisaDefecto = campo(s, 'CURDEF') || 'EUR';

  // Cuentas y saldos.
  const cuentas = [];
  for (const b of [...bloques('BANKACCTFROM'), ...bloques('CCACCTFROM'), ...bloques('INVACCTFROM')]) {
    const id = campo(b, 'ACCTID');
    if (id) cuentas.push({ id, iban: /^[A-Z]{2}\d{2}/.test(id) ? id : '', divisa: divisaDefecto });
  }
  const ledger = bloques('LEDGERBAL')[0];
  if (ledger && cuentas.length) {
    cuentas[0].saldoFinal  = ieOfxAmount(campo(ledger, 'BALAMT'));
    cuentas[0].fechaSaldo  = ieOfxDate(campo(ledger, 'DTASOF'));
  }

  const registros = [];

  // Movimientos de cuenta y tarjeta.
  for (const b of bloques('STMTTRN')) {
    const importe = ieOfxAmount(campo(b, 'TRNAMT'));
    const fecha = ieOfxDate(campo(b, 'DTPOSTED'));
    if (importe == null || !fecha) continue;
    const nombre = campo(b, 'NAME');
    const memo = campo(b, 'MEMO');
    registros.push({
      tipoRegistro: 'mov-banco',
      fecha,
      fechaValor: ieOfxDate(campo(b, 'DTAVAIL')) || '',
      importe,
      divisa: campo(b, 'CURSYM') || divisaDefecto,
      // NAME y MEMO son campos distintos y los bancos los usan de formas
      // distintas: se conservan los dos y se junta solo para mostrar.
      descripcion: [nombre, memo].filter(Boolean).join(' · ') || 'Movimiento',
      contrapartida: nombre || '',
      nota: memo || '',
      idOriginal: campo(b, 'FITID') || '',
      tipoBanco: (campo(b, 'TRNTYPE') || '').toUpperCase(),
      referencia: campo(b, 'CHECKNUM') || campo(b, 'REFNUM') || '',
    });
  }

  // Movimientos de inversión. OFX los parte en un bloque por acción
  // (BUYSTOCK, SELLSTOCK, INCOME…), todos con un INVTRAN dentro.
  const ACCIONES = {
    BUYSTOCK: 'compra', BUYMF: 'compra', BUYOTHER: 'compra', BUYDEBT: 'compra',
    SELLSTOCK: 'venta', SELLMF: 'venta', SELLOTHER: 'venta', SELLDEBT: 'venta',
    INCOME: 'dividendo', REINVEST: 'reinversion', TRANSFER: 'traspaso',
    INVBANKTRAN: 'mov-banco',
  };
  for (const [etiqueta, accion] of Object.entries(ACCIONES)) {
    for (const b of bloques(etiqueta)) {
      const fecha = ieOfxDate(campo(b, 'DTTRADE')) || ieOfxDate(campo(b, 'DTPOSTED')) || ieOfxDate(campo(b, 'DTSETTLE'));
      if (!fecha) continue;
      if (accion === 'mov-banco') {
        const imp = ieOfxAmount(campo(b, 'TRNAMT'));
        if (imp == null) continue;
        registros.push({
          tipoRegistro: 'mov-banco', fecha, importe: imp, divisa: divisaDefecto,
          descripcion: campo(b, 'NAME') || campo(b, 'MEMO') || 'Movimiento de efectivo',
          idOriginal: campo(b, 'FITID') || '',
        });
        continue;
      }
      const unico = campo(b, 'UNIQUEID');
      const tipoId = (campo(b, 'UNIQUEIDTYPE') || '').toUpperCase();
      registros.push({
        tipoRegistro: 'op-inversion',
        fecha,
        fechaLiquidacion: ieOfxDate(campo(b, 'DTSETTLE')) || '',
        accion,
        // UNIQUEIDTYPE dice si el identificador es un ISIN o un CUSIP. Meter
        // un CUSIP en el campo ISIN sería un dato falso.
        isin: tipoId === 'ISIN' ? unico : '',
        otroId: tipoId && tipoId !== 'ISIN' ? `${tipoId}:${unico}` : '',
        ticker: '',
        nombre: campo(b, 'MEMO') || '',
        cantidad: ieOfxAmount(campo(b, 'UNITS')),
        precio: ieOfxAmount(campo(b, 'UNITPRICE')),
        importe: ieOfxAmount(campo(b, 'TOTAL')),
        comision: ieOfxAmount(campo(b, 'COMMISSION')),
        impuestos: ieOfxAmount(campo(b, 'TAXES')),
        divisa: campo(b, 'CURSYM') || divisaDefecto,
        idOriginal: campo(b, 'FITID') || '',
      });
    }
  }

  // El catálogo de valores trae el ticker, que los movimientos no llevan.
  const porIsin = new Map();
  for (const b of [...bloques('STOCKINFO'), ...bloques('MFINFO'), ...bloques('DEBTINFO'), ...bloques('OTHERINFO')]) {
    const id = campo(b, 'UNIQUEID');
    if (!id) continue;
    porIsin.set(id, { ticker: campo(b, 'TICKER') || '', nombre: campo(b, 'SECNAME') || '' });
  }
  for (const r of registros) {
    if (r.tipoRegistro !== 'op-inversion') continue;
    const info = porIsin.get(r.isin) || porIsin.get((r.otroId || '').split(':')[1]);
    if (info) { r.ticker = r.ticker || info.ticker; r.nombre = info.nombre || r.nombre; }
  }

  if (!registros.length) avisos.push('El archivo OFX no contiene movimientos legibles.');
  return { kind: 'registros', registros, cuentas, avisos };
}

/**
 * QIF. Formato viejo de Quicken, todavía exportado por bastantes bancos.
 * Cada apunte termina en una línea con solo `^`, y cada línea empieza por la
 * letra del campo.
 *
 * Su problema conocido: la fecha NO lleva formato declarado. Hay QIF con
 * MM/DD/YY (origen estadounidense) y con DD/MM/YY (europeo), y la misma
 * cadena vale para los dos. Aquí se decide mirando TODAS las fechas del
 * archivo: si alguna tiene el primer número mayor que 12, el formato es
 * día-primero sin duda. Si ninguna lo tiene, es ambiguo y se avisa en vez de
 * elegir en silencio.
 */
function ieParseQIF(text) {
  const lineas = String(text || '').split(/\r?\n/);
  const avisos = [];
  const crudos = [];
  let tipo = 'Bank';
  let actual = {};

  for (const raw of lineas) {
    const l = raw.replace(/\s+$/, '');
    if (!l) continue;
    if (/^!\s*Type\s*:/i.test(l)) { tipo = l.split(':')[1].trim(); continue; }
    if (/^!/.test(l)) continue;                     // !Account, !Option…
    if (l === '^') { if (Object.keys(actual).length) { crudos.push({ ...actual, _tipo: tipo }); } actual = {}; continue; }
    const code = l[0];
    const val = l.slice(1).trim();
    // U y T son los dos el importe; U aparece en QIF de Quicken 2000+ y gana
    // porque trae más decimales.
    if (code === 'U' || code === 'T') actual.importe = actual.importe ?? val;
    else if (code === 'D') actual.fecha = val;
    else if (code === 'P') actual.payee = val;
    else if (code === 'M') actual.memo = val;
    else if (code === 'L') actual.categoria = val;
    else if (code === 'N') actual.num = val;
    else if (code === 'C') actual.estado = val;
    else if (code === 'Y') actual.valor = val;       // nombre del valor (inversión)
    else if (code === 'I') actual.precio = val;
    else if (code === 'Q') actual.cantidad = val;
    else if (code === 'O') actual.comision = val;
    else if (code === 'A') actual.direccion = (actual.direccion ? actual.direccion + ' ' : '') + val;
  }
  if (Object.keys(actual).length) crudos.push({ ...actual, _tipo: tipo });

  // Decidir el orden de la fecha con todo el archivo delante.
  let diaPrimero = null;
  for (const c of crudos) {
    const m = String(c.fecha || '').match(/^\s*(\d{1,2})\s*[\/'\-.]\s*(\d{1,2})/);
    if (!m) continue;
    if (Number(m[1]) > 12) { diaPrimero = true; break; }
    if (Number(m[2]) > 12) { diaPrimero = false; break; }
  }
  if (diaPrimero === null && crudos.length) {
    diaPrimero = true;
    avisos.push('Las fechas del QIF son ambiguas (ningún día pasa de 12): se han leído como día/mes/año. Revisa las fechas antes de confirmar.');
  }

  const esInversion = /invst/i.test(tipo);
  const registros = [];
  for (const c of crudos) {
    const fecha = ieQifDate(c.fecha, diaPrimero);
    if (!fecha) continue;
    const importe = ieQifAmount(c.importe);
    if (esInversion && c.valor) {
      const accion = ieQifAction(c.num);
      registros.push({
        tipoRegistro: 'op-inversion', fecha, accion,
        nombre: c.valor, ticker: '', isin: '',
        cantidad: c.cantidad != null ? Math.abs(ieQifAmount(c.cantidad)) : null,
        precio: c.precio != null ? ieQifAmount(c.precio) : null,
        importe: importe != null ? Math.abs(importe) : null,
        comision: c.comision != null ? ieQifAmount(c.comision) : null,
        divisa: '', idOriginal: c.num || '',
        descripcion: [c.valor, c.memo].filter(Boolean).join(' · '),
      });
      continue;
    }
    if (importe == null) continue;
    registros.push({
      tipoRegistro: 'mov-banco', fecha, importe, divisa: '',
      descripcion: [c.payee, c.memo].filter(Boolean).join(' · ') || 'Movimiento',
      contrapartida: c.payee || '', nota: c.memo || '',
      // La categoría del QIF es del programa de origen, no de Finova: viaja
      // como pista, y la capa de clasificación decide si la usa.
      categoriaOrigen: c.categoria || '',
      referencia: c.num || '', idOriginal: '',
    });
  }

  if (!registros.length) avisos.push('El archivo QIF no contiene apuntes legibles.');
  return { kind: 'registros', registros, cuentas: [], avisos };
}

function ieQifDate(v, diaPrimero) {
  const s = String(v || '').trim();
  // QIF escribe el año de 4 cifras como «'26» o «26»; y usa / ' - o .
  const m = s.match(/^(\d{1,2})\s*[\/'\-.]\s*(\d{1,2})\s*[\/'\-.]\s*(\d{2,4})/);
  if (!m) {
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
  }
  const a = Number(m[1]), b = Number(m[2]);
  let dia = diaPrimero ? a : b;
  let mes = diaPrimero ? b : a;
  // Si el orden elegido da un mes imposible, se invierte: más vale una fecha
  // correcta que respetar una regla global que en esta línea falla.
  if (mes > 12 && dia <= 12) { const t = dia; dia = mes; mes = t; }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
  let anio = Number(m[3]);
  if (anio < 100) anio += anio < 70 ? 2000 : 1900;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function ieQifAmount(v) {
  let s = String(v == null ? '' : v).replace(/[^\d,.\-+()]/g, '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  const ultComa = s.lastIndexOf(','), ultPunto = s.lastIndexOf('.');
  if (ultComa > ultPunto) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function ieQifAction(num) {
  const n = String(num || '').toLowerCase();
  if (/^buy/.test(n)) return 'compra';
  if (/^sell/.test(n)) return 'venta';
  if (/^div/.test(n)) return 'dividendo';
  if (/^reinv/.test(n)) return 'reinversion';
  if (/^(shrsin|xin)/.test(n)) return 'traspaso';
  if (/^(shrsout|xout)/.test(n)) return 'traspaso';
  if (/^intinc/.test(n)) return 'interes';
  return 'desconocida';
}

/**
 * MT940 (SWIFT). Texto por bloques `:NN:`.
 *
 * El campo que lo gobierna todo es :61:
 *   :61:YYMMDD[MMDD](D|C|RD|RC)<importe con coma>N<3 letras><ref>//<ref banco>
 * y el :86: que lo sigue lleva la descripción, a veces troceada en
 * subcampos ?20 ?21 … que algunos bancos alemanes usan.
 */
function ieParseMT940(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const avisos = [];
  const registros = [];
  const cuentas = [];

  // Trocear en campos: una línea que empieza por :NN: abre campo, y lo que
  // sigue sin ese prefijo es continuación del anterior.
  const campos = [];
  for (const linea of s.split('\n')) {
    const m = linea.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) campos.push({ tag: m[1], valor: m[2] });
    else if (campos.length && linea.trim() !== '' && linea.trim() !== '-') {
      campos[campos.length - 1].valor += '\n' + linea;
    }
  }

  let cuentaActual = null, divisaActual = '';
  let pendiente = null;

  const cierra = () => { if (pendiente) { registros.push(pendiente); pendiente = null; } };

  for (const { tag, valor } of campos) {
    if (tag === '25') {
      cierra();
      const id = valor.trim().split(/\s+/)[0] || valor.trim();
      cuentaActual = id;
      if (id) cuentas.push({ id, iban: /^[A-Z]{2}\d{2}/.test(id) ? id : '', divisa: '' });
    } else if (tag === '60F' || tag === '60M' || tag === '62F' || tag === '62M') {
      const m = valor.match(/^([DC])(\d{6})([A-Z]{3})([\d,.]+)/);
      if (m) {
        const signo = m[1] === 'D' ? -1 : 1;
        const imp = signo * (ieMt940Amount(m[4]) || 0);
        divisaActual = m[3];
        const c = cuentas[cuentas.length - 1];
        if (c) {
          c.divisa = m[3];
          if (tag.startsWith('60')) { c.saldoInicial = imp; c.fechaSaldoInicial = ieMt940Date(m[2]); }
          else { c.saldoFinal = imp; c.fechaSaldo = ieMt940Date(m[2]); }
        }
      }
    } else if (tag === '61') {
      cierra();
      const m = valor.match(/^(\d{6})(\d{4})?(R?[DC])([\d,.]+)N?([A-Z0-9]{3})?([^\n/]*)(?:\/\/([^\n]*))?/);
      if (!m) { avisos.push('Una línea :61: no se pudo leer y se ha omitido.'); continue; }
      const fechaValor = ieMt940Date(m[1]);
      // El segundo grupo es MMDD (sin año): se toma el año de la fecha valor,
      // corrigiendo el salto de diciembre a enero.
      const fechaApunte = m[2] ? ieMt940EntryDate(m[1], m[2]) : fechaValor;
      const dc = m[3];
      const signo = dc.endsWith('D') ? -1 : 1;
      // RD/RC son reversiones: el signo se invierte respecto a D/C.
      const esReversion = dc.startsWith('R');
      const bruto = ieMt940Amount(m[4]);
      if (bruto == null) continue;
      pendiente = {
        tipoRegistro: 'mov-banco',
        fecha: fechaApunte || fechaValor,
        fechaValor,
        importe: (esReversion ? -signo : signo) * Math.abs(bruto),
        divisa: divisaActual,
        descripcion: '',
        tipoBanco: m[5] || '',
        referencia: (m[6] || '').trim(),
        idOriginal: (m[7] || '').trim(),
        cuenta: cuentaActual || '',
        esReversion,
      };
    } else if (tag === '86') {
      if (!pendiente) continue;
      pendiente.descripcion = ieMt940Narrative(valor);
      const sub = ieMt940Subfields(valor);
      if (sub.contrapartida) pendiente.contrapartida = sub.contrapartida;
      if (sub.iban) pendiente.ibanContrapartida = sub.iban;
    }
  }
  cierra();

  for (const r of registros) if (!r.descripcion) r.descripcion = r.referencia || 'Movimiento';
  if (!registros.length) avisos.push('El archivo MT940 no contiene movimientos legibles.');
  return { kind: 'registros', registros, cuentas, avisos };
}

function ieMt940Amount(v) {
  // MT940 usa coma decimal siempre; el punto, si aparece, es de millares.
  const s = String(v || '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function ieMt940Date(yymmdd) {
  const m = String(yymmdd || '').match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return '';
  const anio = Number(m[1]) + (Number(m[1]) < 70 ? 2000 : 1900);
  return `${anio}-${m[2]}-${m[3]}`;
}

/**
 * La fecha de apunte de MT940 viene sin año (solo MMDD). Se hereda el de la
 * fecha valor, pero con una corrección: un apunte del 31 de diciembre con
 * fecha valor del 2 de enero pertenece al año ANTERIOR. Sin esto, un extracto
 * de principios de enero coloca varios movimientos doce meses en el futuro.
 */
function ieMt940EntryDate(yymmdd, mmdd) {
  const base = ieMt940Date(yymmdd);
  if (!base) return '';
  const anioValor = Number(base.slice(0, 4));
  const mesValor = Number(base.slice(5, 7));
  const mes = Number(mmdd.slice(0, 2)), dia = Number(mmdd.slice(2, 4));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return base;
  let anio = anioValor;
  if (mes === 12 && mesValor === 1) anio = anioValor - 1;
  else if (mes === 1 && mesValor === 12) anio = anioValor + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Descripción del :86:, limpiando los subcampos ?NN si los trae. */
function ieMt940Narrative(valor) {
  const s = String(valor || '');
  if (!/\?\d{2}/.test(s)) return s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  // Formato alemán: ?00 tipo, ?20-?29 texto libre, ?32-?33 nombre.
  const partes = [];
  const re = /\?(\d{2})([^?]*)/g;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[1]);
    if (n >= 20 && n <= 29) partes.push(m[2].trim());
  }
  return (partes.join(' ') || s.replace(/\?\d{2}/g, ' ')).replace(/\s+/g, ' ').trim();
}

function ieMt940Subfields(valor) {
  const s = String(valor || '');
  const out = {};
  const nombre = [];
  const re = /\?(\d{2})([^?]*)/g;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[1]);
    if (n === 32 || n === 33) nombre.push(m[2].trim());
  }
  if (nombre.length) out.contrapartida = nombre.join(' ').trim();
  const iban = s.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/);
  if (iban) out.iban = iban[1];
  return out;
}

/**
 * CAMT.053 (ISO 20022). Cada `<Ntry>` es un apunte; el signo lo da
 * `<CdtDbtInd>` (DBIT/CRDT) y NO el signo del importe, que siempre es
 * positivo. Confundir eso convierte todos los gastos en ingresos.
 */
function ieParseCAMT(text) {
  const s = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
  const avisos = [];
  const registros = [];
  const cuentas = [];

  for (const stmt of ieExtractBlocks(s, 'Stmt')) {
    const o = ieXmlBlockToObject(stmt);
    const iban = o['Acct.Id.IBAN'] || o['Acct.Id.Othr.Id'] || '';
    const divisaCuenta = o['Acct.Ccy'] || '';
    if (iban || divisaCuenta) {
      const cuenta = { id: iban || 'cuenta', iban, divisa: divisaCuenta };
      // Saldos: OPBD/PRCD es el inicial y CLBD el final.
      for (const bal of ieExtractBlocks(stmt, 'Bal')) {
        const b = ieXmlBlockToObject(bal);
        const codigo = (b['Tp.CdOrPrtry.Cd'] || '').toUpperCase();
        const signo = (b.CdtDbtInd || '').toUpperCase() === 'DBIT' ? -1 : 1;
        const imp = parseFloat(b.Amt);
        if (!Number.isFinite(imp)) continue;
        if (!cuenta.divisa && b['Amt.@Ccy']) cuenta.divisa = b['Amt.@Ccy'];
        if (codigo === 'CLBD') { cuenta.saldoFinal = signo * imp; cuenta.fechaSaldo = (b['Dt.Dt'] || '').slice(0, 10); }
        else if (codigo === 'OPBD' || codigo === 'PRCD') { cuenta.saldoInicial = signo * imp; cuenta.fechaSaldoInicial = (b['Dt.Dt'] || '').slice(0, 10); }
      }
      cuentas.push(cuenta);
    }

    for (const ntry of ieExtractBlocks(stmt, 'Ntry')) {
      const n = ieXmlBlockToObject(ntry);
      const imp = parseFloat(n.Amt);
      if (!Number.isFinite(imp)) continue;
      const ind = (n.CdtDbtInd || '').toUpperCase();
      if (ind !== 'DBIT' && ind !== 'CRDT') {
        avisos.push('Un apunte del CAMT no indica si es cargo o abono y se ha omitido: su signo no se puede deducir.');
        continue;
      }
      // Un apunte revertido (RVSL true) invierte el signo.
      const revertido = String(n.RvslInd || '').toLowerCase() === 'true';
      const signo = (ind === 'DBIT' ? -1 : 1) * (revertido ? -1 : 1);

      const fechaApunte = (n['BookgDt.Dt'] || n['BookgDt.DtTm'] || '').slice(0, 10);
      const fechaValor  = (n['ValDt.Dt']  || n['ValDt.DtTm']  || '').slice(0, 10);

      // La descripción puede estar en el apunte o en su detalle.
      const det = ieExtractBlocks(ntry, 'TxDtls').map(ieXmlBlockToObject);
      const d0 = det[0] || {};
      const textos = [
        n['RmtInf.Ustrd'], d0['RmtInf.Ustrd'],
        d0['RmtInf.Strd.CdtrRefInf.Ref'], n.AddtlNtryInf, d0.AddtlTxInf,
      ].filter(Boolean);

      const contrapartida = d0['RltdPties.Cdtr.Nm'] || d0['RltdPties.Dbtr.Nm']
        || d0['RltdPties.Cdtr.Pty.Nm'] || d0['RltdPties.Dbtr.Pty.Nm'] || '';
      const ibanContra = d0['RltdPties.CdtrAcct.Id.IBAN'] || d0['RltdPties.DbtrAcct.Id.IBAN'] || '';

      registros.push({
        tipoRegistro: 'mov-banco',
        fecha: fechaApunte || fechaValor,
        fechaValor: fechaValor || '',
        fechaContable: fechaApunte || '',
        importe: signo * Math.abs(imp),
        divisa: n['Amt.@Ccy'] || divisaCuenta || '',
        descripcion: textos.join(' ').replace(/\s+/g, ' ').trim() || contrapartida || 'Movimiento',
        contrapartida,
        ibanContrapartida: ibanContra,
        // AcctSvcrRef es el identificador del banco: dedupe seguro.
        idOriginal: n.AcctSvcrRef || d0['Refs.AcctSvcrRef'] || d0['Refs.EndToEndId'] || '',
        tipoBanco: [n['BkTxCd.Domn.Cd'], n['BkTxCd.Domn.Fmly.Cd'], n['BkTxCd.Domn.Fmly.SubFmlyCd']].filter(Boolean).join('/'),
        cuenta: iban,
        esReversion: revertido,
        // Si el apunte trae importe en otra divisa, se guarda el original.
        importeOriginal: d0['AmtDtls.InstdAmt.Amt'] ? parseFloat(d0['AmtDtls.InstdAmt.Amt']) : null,
        divisaOriginal: d0['AmtDtls.InstdAmt.Amt.@Ccy'] || '',
      });
    }
  }

  if (!registros.length) avisos.push('El archivo CAMT.053 no contiene apuntes legibles.');
  return { kind: 'registros', registros, cuentas, avisos };
}

/* ─── 5. Punto de entrada ─────────────────────────────────────── */

/**
 * Convierte un texto en el IR. El único punto de entrada de la capa.
 *
 * `filename` solo se usa para desempatar el formato: si el contenido dice
 * una cosa y la extensión otra, gana el contenido.
 */
function ieParseText(text, filename) {
  const format = ieSniffFormat(text, filename);
  let r;
  switch (format) {
    case 'csv':     r = ieParseDelimited(text, ieDetectSeparator(text) || ','); break;
    case 'tsv':     r = ieParseDelimited(text, '\t'); break;
    case 'json':    r = ieParseJSON(text); break;
    case 'xml':     r = ieParseXML(text); break;
    case 'html':    r = ieParseHTML(text); break;
    case 'ofx':     r = ieParseOFX(text); break;
    case 'qif':     r = ieParseQIF(text); break;
    case 'mt940':   r = ieParseMT940(text); break;
    case 'camt053': r = ieParseCAMT(text); break;
    default:
      return {
        format: 'desconocido', kind: 'tablas', tablas: [], registros: [], cuentas: [],
        avisos: ['No se ha reconocido el formato del archivo.'],
      };
  }
  return {
    format,
    kind: r.kind,
    tablas: r.tablas || [],
    registros: r.registros || [],
    cuentas: r.cuentas || [],
    avisos: r.avisos || [],
  };
}

/**
 * Convierte las hojas de un libro de Excel (ya leído con SheetJS) al IR.
 * SheetJS no se carga aquí: lo hace quien tenga el archivo, con el
 * `_XLSX_CDN` que el proyecto ya usa. Esta capa solo recibe filas.
 *
 * Se devuelven TODAS las hojas con datos, no la primera: un extracto con una
 * hoja por cuenta o un informe con posiciones y operaciones separadas son los
 * dos casos normales, y quedarse con la primera pierde el resto.
 */
function ieFromSheets(hojas) {
  const tablas = (hojas || [])
    .filter(h => h && Array.isArray(h.filas) && h.filas.length >= 2)
    .map(h => ({ nombre: h.nombre || 'Hoja', filas: ieRectangular(h.filas.map(f => f.map(c => (c == null ? '' : String(c))))), meta: { origen: 'excel' } }));
  return {
    format: 'excel', kind: 'tablas', tablas, registros: [], cuentas: [],
    avisos: tablas.length ? [] : ['El libro no tiene ninguna hoja con datos.'],
  };
}
