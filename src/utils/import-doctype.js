'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — RECONOCIMIENTO DEL TIPO DE DOCUMENTO

   Decide qué ES un archivo, a partir de los campos que la capa semántica ha
   reconocido y de lo que contienen sus filas. Sin esto el usuario tiene que
   elegir el botón correcto, y elegir mal mete los datos en el sitio
   equivocado.

   ── La distinción que más importa ──
   «Un archivo de posiciones actuales no debe interpretarse como si todas las
   posiciones fueran compras nuevas.»

   Es el error más caro de todo el encargo. Un informe de cartera con 30
   posiciones, leído como histórico de operaciones, mete 30 compras
   inventadas y duplica la cartera entera. La señal que los separa no es el
   nombre del archivo: es que un snapshot describe un ESTADO (valor de
   mercado, precio actual, una fila por activo) y un histórico describe
   SUCESOS (una fecha y un tipo de operación por fila, con el mismo activo
   repetido).

   ── Los tipos ──
   'extracto-banco'    movimientos de una cuenta o tarjeta
   'posiciones'        fotografía de una cartera en un momento dado
   'operaciones'       histórico de compras y ventas
   'dividendos'        informe de dividendos cobrados
   'cripto-movimientos' operaciones de un exchange o wallet
   'saldos'            saldos de cuentas o resumen de patrimonio
   'pasivos'           préstamos, hipotecas, deudas
   'desconocido'       no hay evidencia suficiente

   Cada veredicto sale con confianza y con los motivos en texto. El tipo
   'desconocido' es un resultado legítimo, no un fallo: el encargo pedía que
   lo que no se pueda identificar se le presente al usuario en vez de
   colocarlo a ciegas.
═══════════════════════════════════════════════════════════════ */

/* ─── 1. Vocabulario de los valores de las celdas ─────────────── */

/*
 * Palabras que aparecen EN LOS DATOS, no en las cabeceras. La columna «Tipo»
 * de un extracto contiene «TRANSFERENCIA»; la de un bróker, «COMPRA». Son
 * dos señales distintas y aquí se separan.
 */
const IDT_VOCAB = {
  compraVenta: /\b(compra|venta|buy|sell|sold|bought|purchase|sale|adquisicion|suscripcion|reembolso|cpa|vta)\b/i,
  dividendo:   /\b(dividendo|dividend|div|cupon|coupon|reparto|distribucion|distribution)\b/i,
  staking:     /\b(staking|stake|unstake|reward|recompensa|earn|interes generado|yield farming)\b/i,
  swap:        /\b(swap|conversion|convert|exchange|intercambio|trade)\b/i,
  deposRetir:  /\b(deposito|deposit|retirada|withdrawal|withdraw|ingreso efectivo|cash in|cash out)\b/i,
  transferencia: /\b(transferencia|transfer|traspaso|envio|recibido|sepa|bizum)\b/i,
  tarjeta:     /\b(tarjeta|card|card_payment|pos|compra tarj|pago con tarjeta)\b/i,
  comisionBanco: /\b(comision|comisiones|fee|mantenimiento|cuota|gastos administracion)\b/i,
  nomina:      /\b(nomina|nómina|payroll|salario|salary|retribucion)\b/i,
  recibo:      /\b(recibo|domiciliacion|adeudo|direct debit|cuota prestamo)\b/i,
  prestamo:    /\b(prestamo|hipoteca|mortgage|loan|credito|amortizacion|capital pendiente)\b/i,
};

/** Nombres de ficheros y títulos que delatan el documento. */
const IDT_TITULOS = {
  posiciones: /\b(posicion|posiciones|cartera|portfolio|holdings|positions|tenencias|inventario)\b/i,
  operaciones: /\b(operacion|operaciones|movimientos de valores|trades|transactions|historial|activity|ejecuciones)\b/i,
  dividendos: /\b(dividendo|dividendos|dividends|income|rentas)\b/i,
  extracto: /\b(extracto|movimientos|statement|account|cuenta|transacciones)\b/i,
  cripto: /\b(crypto|cripto|wallet|exchange|binance|coinbase|kraken|bitstamp|bit2me|ledger|metamask)\b/i,
};

/* ─── 2. Utilidades ───────────────────────────────────────────── */

/** ¿Qué fracción de las filas tiene algo en esta columna? */
function _idtRelleno(filas, col) {
  if (col == null || !filas.length) return 0;
  const n = filas.filter(f => String(f[col] == null ? '' : f[col]).trim() !== '').length;
  return n / filas.length;
}

/** Valores de una columna, como texto, sin vacíos. */
function _idtValores(filas, col, limite) {
  if (col == null) return [];
  const out = [];
  for (const f of filas) {
    const v = String(f[col] == null ? '' : f[col]).trim();
    if (v) out.push(v);
    if (limite && out.length >= limite) break;
  }
  return out;
}

/** ¿Qué fracción de los valores de una columna casa con un patrón? */
function _idtRatio(valores, re) {
  if (!valores.length) return 0;
  return valores.filter(v => re.test(v)).length / valores.length;
}

/**
 * ¿Se repite el mismo activo en varias filas?
 *
 * Es la señal que separa un snapshot de un histórico mejor que ninguna otra:
 * una cartera tiene UNA fila por activo, y un histórico de operaciones tiene
 * varias del mismo. Devuelve la razón filas/activos distintos.
 */
function _idtRepeticionActivo(filas, campos) {
  const col = (campos.isin && campos.isin.col) ?? (campos.ticker && campos.ticker.col)
    ?? (campos.nombreActivo && campos.nombreActivo.col);
  if (col == null) return null;
  const vals = _idtValores(filas, col);
  if (vals.length < 3) return null;       // con dos filas no se concluye nada
  const distintos = new Set(vals.map(v => v.toUpperCase())).size;
  return { filas: vals.length, distintos, razon: vals.length / distintos };
}

/* ─── 3. El clasificador ──────────────────────────────────────── */

/**
 * Clasifica una tabla ya analizada por la capa semántica.
 *
 * @param {object} deteccion  salida de ieDetectFields
 * @param {object} ctx        { nombreArchivo?, nombreTabla?, formato? }
 */
function idtClassifyTable(deteccion, ctx) {
  const c = ctx || {};
  const campos = (deteccion && deteccion.campos) || {};
  const filas = (deteccion && deteccion.filasDatos) || [];
  const tiene = n => Object.prototype.hasOwnProperty.call(campos, n);
  const col = n => (tiene(n) ? campos[n].col : null);

  // Los nombres de archivo usan guion bajo constantemente
  // («Dividendos_2026.csv», «kraken_trades.csv»), y `_` es carácter de
  // palabra: un `\b` detrás de «Dividendos» NO casa ahí. Se normaliza a
  // espacios antes de buscar, o la mitad de las pistas del nombre se
  // perderían en silencio.
  const titulo = `${c.nombreArchivo || ''} ${c.nombreTabla || ''}`
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const puntos = [];
  const anota = (tipo, p, motivo) => puntos.push({ tipo, p, motivo });

  if (!filas.length) {
    return { tipo: 'desconocido', confianza: 'baja', motivos: ['La tabla no tiene filas de datos.'], candidatos: [] };
  }

  /* ── Señales de inversión frente a señales de banco ── */
  const hayActivo = tiene('isin') || tiene('ticker') || tiene('nombreActivo');
  const hayValoracion = tiene('valorMercado') || tiene('precioActual')
    || tiene('costeAdquisicion') || tiene('precioMedio') || tiene('rentabilidadPct')
    || tiene('gananciaPerdida');
  const hayOperacion = tiene('tipoOperacion') || tiene('precioUnitario');
  const haySaldo = tiene('saldo');
  const rep = _idtRepeticionActivo(filas, campos);

  const valoresTipo = tiene('tipoOperacion') ? _idtValores(filas, col('tipoOperacion'), 300) : [];
  const valoresDesc = tiene('descripcion') ? _idtValores(filas, col('descripcion'), 300) : [];
  // El tipo de operación manda sobre la descripción: es un campo cerrado y la
  // descripción es texto libre donde «compra» puede aparecer por casualidad
  // («COMPRA MERCADONA» en un extracto no es la compra de un valor).
  const vocabEn = re => Math.max(_idtRatio(valoresTipo, re), _idtRatio(valoresDesc, re) * 0.6);

  /*
   * ¿Los activos son criptomonedas? Se calcula una sola vez y antes de todo,
   * porque decide entre dos tipos que compiten de verdad: una compra de
   * bitcoin es una operación igual que una de acciones, pero su destino en
   * Finova es otro. Sin esta señal gana «operaciones» (fecha + tipo + precio
   * puntúan alto) y los datos acaban en el sitio equivocado.
   */
  const colActivo = col('ticker') != null ? col('ticker') : col('nombreActivo');
  const ratioCripto = colActivo == null ? 0 : _idtRatio(
    _idtValores(filas, colActivo, 200),
    /^(BTC|ETH|USDT|USDC|BNB|XRP|ADA|SOL|DOGE|DOT|MATIC|LTC|TRX|AVAX|LINK|ATOM|XLM|ALGO|DAI|BUSD|SHIB|UNI|ETC|FIL|NEAR|ICP|APT|ARB|OP)([\/\-_ ]?(EUR|USD|USDT|BUSD|BTC|ETH))?$/i,
  );
  // Un ISIN válido descarta cripto: las criptomonedas no tienen ISIN.
  const isinFiable = tiene('isin') && campos.isin.confianza === 'alta';

  /* ── POSICIONES: un estado, no sucesos ── */
  if (hayActivo && tiene('cantidad')) {
    let p = 0;
    const motivos = [];
    if (hayValoracion) {
      p += 0.45;
      const cuales = ['valorMercado', 'precioActual', 'costeAdquisicion', 'precioMedio', 'rentabilidadPct', 'gananciaPerdida']
        .filter(tiene).map(n => campos[n].cabecera);
      motivos.push(`hay columnas de valoración (${cuales.join(', ')}), que describen un estado y no una operación`);
    }
    // Ni fecha de operación ni tipo: nadie ha registrado un suceso.
    if (!tiene('fechaOperacion') && !tiene('tipoOperacion')) {
      p += 0.35;
      motivos.push('no hay fecha ni tipo de operación: las filas no describen sucesos');
    }
    // Una fila por activo.
    if (rep && rep.razon <= 1.15) {
      p += 0.3;
      motivos.push(`hay ${rep.distintos} activos distintos en ${rep.filas} filas: una fila por activo`);
    } else if (rep && rep.razon >= 1.5) {
      p -= 0.45;
      motivos.push(`el mismo activo se repite (${rep.filas} filas para ${rep.distintos} activos), lo que apunta a un histórico`);
    }
    if (IDT_TITULOS.posiciones.test(titulo)) { p += 0.15; motivos.push('el nombre del archivo o de la hoja habla de posiciones o cartera'); }
    if (p > 0) anota('posiciones', p, motivos);
  }

  /* ── OPERACIONES: sucesos con fecha y tipo ── */
  if (hayActivo && (hayOperacion || tiene('fechaOperacion'))) {
    let p = 0;
    const motivos = [];
    if (tiene('fechaOperacion')) { p += 0.3; motivos.push(`hay una fecha de operación («${campos.fechaOperacion.cabecera}»)`); }
    const rCV = vocabEn(IDT_VOCAB.compraVenta);
    if (rCV >= 0.5) { p += 0.4; motivos.push(`el ${Math.round(rCV * 100)} % de las filas dice compra o venta`); }
    else if (rCV >= 0.2) { p += 0.2; motivos.push(`algunas filas (${Math.round(rCV * 100)} %) dicen compra o venta`); }
    if (tiene('precioUnitario')) { p += 0.15; motivos.push(`hay un precio de ejecución («${campos.precioUnitario.cabecera}»)`); }
    if (tiene('fechaLiquidacion')) { p += 0.15; motivos.push('hay fecha de liquidación, que solo tiene sentido en una operación'); }
    if (rep && rep.razon >= 1.5) { p += 0.25; motivos.push(`el mismo activo aparece en varias filas (${rep.filas} filas, ${rep.distintos} activos)`); }
    if (hayValoracion && !tiene('precioUnitario')) { p -= 0.2; motivos.push('pero hay columnas de valoración y ninguna de precio de ejecución'); }
    if (IDT_TITULOS.operaciones.test(titulo)) { p += 0.12; motivos.push('el nombre del archivo o de la hoja habla de operaciones'); }
    // Operación de cripto: es una operación, pero no de valores, y su
    // destino en Finova es otro. Gana el tipo de cripto.
    if (ratioCripto >= 0.6 && !isinFiable) {
      p -= 0.5;
      motivos.push(`pero el ${Math.round(ratioCripto * 100)} % de los activos son criptomonedas, no valores`);
    }
    if (p > 0) anota('operaciones', p, motivos);
  }

  /* ── DIVIDENDOS ── */
  {
    let p = 0;
    const motivos = [];
    if (tiene('dividendoPorAccion')) { p += 0.55; motivos.push(`hay una columna de dividendo por acción («${campos.dividendoPorAccion.cabecera}»)`); }
    const rDiv = vocabEn(IDT_VOCAB.dividendo);
    if (rDiv >= 0.5) { p += 0.4; motivos.push(`el ${Math.round(rDiv * 100)} % de las filas habla de dividendos`); }
    else if (rDiv >= 0.2) { p += 0.15; motivos.push(`algunas filas (${Math.round(rDiv * 100)} %) hablan de dividendos`); }
    if (IDT_TITULOS.dividendos.test(titulo)) { p += 0.2; motivos.push('el nombre del archivo o de la hoja habla de dividendos'); }
    if (p > 0 && hayActivo) { p += 0.1; motivos.push('y las filas identifican un activo'); }
    if (tiene('impuestos') && p > 0) { p += 0.1; motivos.push('hay retención, habitual en un reparto de dividendos'); }
    if (p > 0) anota('dividendos', p, motivos);
  }

  /* ── CRIPTO ── */
  {
    let p = 0;
    const motivos = [];
    if (ratioCripto >= 0.6) { p += 0.5; motivos.push(`el ${Math.round(ratioCripto * 100)} % de los activos son criptomonedas conocidas`); }
    else if (ratioCripto >= 0.3) { p += 0.25; motivos.push(`parte de los activos (${Math.round(ratioCripto * 100)} %) son criptomonedas`); }

    const rStake = vocabEn(IDT_VOCAB.staking);
    const rSwap = vocabEn(IDT_VOCAB.swap);
    const rCV = vocabEn(IDT_VOCAB.compraVenta);
    if (rStake >= 0.2) { p += 0.25; motivos.push('hay filas de staking o recompensas'); }
    if (rSwap >= 0.3) { p += 0.15; motivos.push('hay filas de swap o conversión entre monedas'); }
    // Comprar y vender es el movimiento de cripto más habitual: con los
    // activos ya identificados como cripto, esto refuerza en vez de competir.
    if (ratioCripto >= 0.6 && rCV >= 0.5) { p += 0.3; motivos.push(`y el ${Math.round(rCV * 100)} % son compras o ventas de esas monedas`); }
    if (IDT_TITULOS.cripto.test(titulo)) { p += 0.2; motivos.push('el nombre del archivo apunta a un exchange o wallet'); }
    if (isinFiable) { p -= 0.5; motivos.push('pero hay ISIN válidos, y las criptomonedas no tienen ISIN'); }
    if (p > 0) anota('cripto-movimientos', p, motivos);
  }

  /* ── EXTRACTO BANCARIO ── */
  {
    let p = 0;
    const motivos = [];
    const hayImporte = tiene('importe') || (tiene('cargo') && tiene('abono')) || tiene('cargo') || tiene('abono');
    if (tiene('fechaOperacion') && hayImporte && tiene('descripcion')) {
      p += 0.4;
      motivos.push('hay fecha, importe y descripción, la forma mínima de un movimiento de cuenta');
    }
    if (haySaldo) {
      p += 0.3;
      motivos.push(`hay una columna de saldo («${campos.saldo.cabecera}»), que solo existe en un extracto de cuenta`);
    }
    if (tiene('cargo') && tiene('abono')) { p += 0.25; motivos.push('el importe viene partido en cargo y abono, propio de un extracto'); }
    if (tiene('fechaValor')) { p += 0.15; motivos.push('hay fecha valor, que es un concepto bancario'); }
    for (const [clave, re] of Object.entries({
      tarjeta: IDT_VOCAB.tarjeta, transferencia: IDT_VOCAB.transferencia,
      nomina: IDT_VOCAB.nomina, recibo: IDT_VOCAB.recibo,
    })) {
      const r = vocabEn(re);
      if (r >= 0.15) { p += 0.12; motivos.push(`aparecen movimientos de tipo ${clave}`); }
    }
    // Un activo identificado tira hacia inversión, no hacia banco.
    if (hayActivo && hayValoracion) { p -= 0.35; motivos.push('pero hay activos identificados y columnas de valoración'); }
    if (p > 0) anota('extracto-banco', p, motivos);
  }

  /* ── SALDOS / PATRIMONIO ── */
  if (!tiene('fechaOperacion') && !tiene('descripcion')) {
    let p = 0;
    const motivos = [];
    if (tiene('cuenta') && haySaldo) {
      p += 0.6;
      motivos.push('hay cuentas y saldos, sin movimientos: es una foto de los saldos');
    } else if (haySaldo && filas.length <= 40) {
      p += 0.3;
      motivos.push(`hay saldos y solo ${filas.length} filas, sin fecha ni descripción de movimiento`);
    }
    if (p > 0) anota('saldos', p, motivos);
  }

  /* ── PASIVOS ── */
  {
    const rPrestamo = Math.max(vocabEn(IDT_VOCAB.prestamo), _idtRatio([titulo], IDT_VOCAB.prestamo));
    if (rPrestamo >= 0.3) {
      anota('pasivos', 0.4 + rPrestamo * 0.3, [`el ${Math.round(rPrestamo * 100)} % de las filas o el título hablan de préstamos, hipotecas o deudas`]);
    }
  }

  /* ── Veredicto ── */
  puntos.sort((a, b) => b.p - a.p);
  const candidatos = puntos.map(x => ({
    tipo: x.tipo,
    puntos: Math.round(Math.min(x.p, 1) * 100) / 100,
    motivos: x.motivo,
  }));

  if (!candidatos.length || candidatos[0].puntos < 0.45) {
    return {
      tipo: 'desconocido', confianza: 'baja', candidatos,
      motivos: candidatos.length
        ? [`La evidencia más fuerte apunta a «${candidatos[0].tipo}», pero no es suficiente para afirmarlo.`]
        : ['No se ha encontrado ninguna señal reconocible de qué contiene este archivo.'],
    };
  }

  const mejor = candidatos[0];
  const segundo = candidatos[1];
  // Si el segundo pisa al primero, no hay certeza: el usuario decide. Es el
  // caso de un informe que mezcla posiciones y operaciones en una tabla.
  const margen = segundo ? mejor.puntos - segundo.puntos : 1;
  const confianza = (mejor.puntos >= 0.75 && margen >= 0.25) ? 'alta'
    : (margen >= 0.15 ? 'media' : 'baja');

  return {
    tipo: mejor.tipo,
    confianza,
    motivos: mejor.motivos,
    candidatos,
    // Lo que la interfaz necesita para preguntar sin ser molesta: solo se
    // pregunta cuando de verdad hay duda.
    requiereConfirmacion: confianza !== 'alta',
    alternativa: segundo && margen < 0.15 ? segundo.tipo : null,
  };
}

/**
 * Clasifica un IR completo, tabla por tabla.
 *
 * Un archivo puede contener varias cosas a la vez: una hoja de posiciones y
 * otra de operaciones, o una hoja por cuenta. Clasificar el archivo entero
 * con un solo veredicto obligaría a tirar la mitad.
 */
function idtClassifyIR(ir, detectarTabla, ctx) {
  const c = ctx || {};
  if (!ir) return { partes: [], avisos: ['No hay nada que clasificar.'] };

  // Los formatos estandarizados ya vienen con el tipo puesto: en ellos no hay
  // nada que deducir, y deducirlo sería tirar un dato cierto.
  if (ir.kind === 'registros') {
    const porTipo = new Map();
    for (const r of ir.registros || []) {
      const t = r.tipoRegistro === 'op-inversion' ? 'operaciones' : 'extracto-banco';
      if (!porTipo.has(t)) porTipo.set(t, []);
      porTipo.get(t).push(r);
    }
    return {
      partes: [...porTipo.entries()].map(([tipo, registros]) => ({
        nombre: ir.format.toUpperCase(),
        tipo, confianza: 'alta',
        motivos: [`el formato ${ir.format.toUpperCase()} declara el significado de cada campo: no hay que deducir nada`],
        registros, candidatos: [{ tipo, puntos: 1, motivos: [] }],
        requiereConfirmacion: false, alternativa: null,
      })),
      cuentas: ir.cuentas || [],
      avisos: ir.avisos || [],
    };
  }

  const partes = [];
  for (const tabla of ir.tablas || []) {
    const det = detectarTabla(tabla.filas);
    const clase = idtClassifyTable(det, {
      nombreArchivo: c.nombreArchivo, nombreTabla: tabla.nombre, formato: ir.format,
    });
    partes.push({
      nombre: tabla.nombre,
      tipo: clase.tipo, confianza: clase.confianza, motivos: clase.motivos,
      candidatos: clase.candidatos,
      requiereConfirmacion: clase.requiereConfirmacion !== false,
      alternativa: clase.alternativa || null,
      deteccion: det,
      filas: det.filasDatos,
    });
  }

  return { partes, cuentas: ir.cuentas || [], avisos: ir.avisos || [] };
}

/** Etiquetas en español, para la interfaz. */
const IDT_ETIQUETAS = {
  'extracto-banco': 'Movimientos de una cuenta',
  'posiciones': 'Fotografía de una cartera',
  'operaciones': 'Histórico de operaciones',
  'dividendos': 'Dividendos cobrados',
  'cripto-movimientos': 'Movimientos de criptomonedas',
  'saldos': 'Saldos de cuentas',
  'pasivos': 'Préstamos y deudas',
  'desconocido': 'Sin identificar',
};
