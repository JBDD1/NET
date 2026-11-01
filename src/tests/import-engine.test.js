/**
 * Finova — import-engine.test.js
 * Motor universal de importación: capa de formatos y capa semántica.
 *
 * La mitad de estos tests comprueban que el motor se NIEGA a interpretar.
 * El encargo lo pedía así: «si un archivo contiene columnas desconocidas,
 * intenta identificar su significado, pero nunca asignes una interpretación
 * sin suficiente evidencia».
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

let ctx;
beforeAll(() => {
  ctx = vm.createContext({
    console, JSON, Math, Number, String, Array, Map, Set, Object,
    parseFloat, parseInt, isNaN, isFinite, RegExp, Date,
  });
  for (const f of ['src/utils/import-formats.js', 'src/utils/import-semantic.js']) {
    vm.runInContext(fs.readFileSync(path.join(process.cwd(), f), 'utf8'), ctx);
  }
});
const g = name => vm.runInContext(name, ctx);
const parse = (t, f) => g('ieParseText')(t, f);
const detect = (filas, op) => g('ieDetectFields')(filas, op);
/** Cabecera asignada a un campo, o null. */
const campo = (r, n) => (r.campos[n] ? r.campos[n].cabecera : null);

/* ═══ 1. Detección de formato ══════════════════════════════════ */

describe('Detección de formato — por contenido, nunca por extensión', () => {
  test('un «.xls» que es una tabla HTML se reconoce como HTML', () => {
    // Degiro, ING y varios bancos lo hacen. Es el caso que más veces rompe
    // una importación en la práctica.
    const html = '<html><body><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>';
    expect(g('ieSniffFormat')(html, 'Posiciones.xls')).toBe('html');
  });

  test('un «.csv» separado por tabuladores se reconoce como TSV', () => {
    const tsv = 'Date\tDescription\tAmount\n2026-09-05\tSpotify\t-10.99\n2026-09-06\tSalary\t2100.00';
    expect(g('ieSniffFormat')(tsv, 'mov.csv')).toBe('tsv');
  });

  test('CAMT.053 se reconoce antes que XML genérico', () => {
    const camt = '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>1</Id></Stmt></BkToCstmrStmt></Document>';
    expect(g('ieSniffFormat')(camt, 'extracto.xml')).toBe('camt053');
  });

  test('OFX v1 (SGML) y v2 (XML) son los dos «ofx»', () => {
    expect(g('ieSniffFormat')('OFXHEADER:100\n<OFX>', 'a.ofx')).toBe('ofx');
    expect(g('ieSniffFormat')('<?xml version="1.0"?><OFX><SIGNONMSGSRSV1/></OFX>', 'a.qfx')).toBe('ofx');
  });

  test('un archivo vacío o de una sola línea NO se da por CSV por la extensión', () => {
    // Si se diera, el error saldría más tarde y mucho peor: «no se
    // encontraron transacciones» en vez de «no se reconoce el formato».
    expect(g('ieSniffFormat')('', 'x.csv')).toBe('desconocido');
    expect(g('ieSniffFormat')('una línea de texto libre', 'x.txt')).toBe('desconocido');
  });

  test('el separador se decide por consistencia entre líneas', () => {
    expect(g('ieDetectSeparator')('a;b;c\n1;2;3\n4;5;6')).toBe(';');
    expect(g('ieDetectSeparator')('a,b,c\n1,2,3')).toBe(',');
    // Comas dentro de comillas no cuentan.
    expect(g('ieDetectSeparator')('a;b\n"uno, dos";3\n"tres, cuatro";5')).toBe(';');
  });
});

/* ═══ 2. CSV ═══════════════════════════════════════════════════ */

describe('CSV', () => {
  test('respeta las comillas escapadas y los saltos de línea dentro de un campo', () => {
    // Partir por \n sin más rompe cualquier extracto con una descripción
    // multilínea, y el fallo es silencioso: salen filas descuadradas.
    const csv = 'Fecha;Concepto;Importe\n'
      + '05/09/2026;"TRANSFERENCIA ""NOMINA""\nSEPTIEMBRE";1.850,00\n'
      + '06/09/2026;OTRA;-12,00';
    const r = parse(csv, 'x.csv');
    expect(r.tablas[0].filas).toHaveLength(3);
    expect(r.tablas[0].filas[1][1]).toBe('TRANSFERENCIA "NOMINA"\nSEPTIEMBRE');
  });

  test('rellena las filas cortas para que la tabla sea rectangular', () => {
    const r = parse('a;b;c\n1;2\n3;4;5', 'x.csv');
    expect(r.tablas[0].filas.every(f => f.length === 3)).toBe(true);
  });
});

/* ═══ 3. JSON ══════════════════════════════════════════════════ */

describe('JSON', () => {
  const json = JSON.stringify({
    result: {
      trades: [
        { id: 'T1', time: '2026-09-05T10:00:00Z', side: 'buy', amount: 0.015, fee: { currency: 'EUR', cost: 1.2 }, tags: ['spot', 'maker'] },
        { id: 'T2', time: '2026-09-07T11:30:00Z', side: 'sell', amount: 1.4, fee: { currency: 'EUR', cost: 0.9 }, tags: ['spot'] },
      ],
      balances: [{ asset: 'BTC', free: 0.22 }, { asset: 'ETH', free: 3.11 }],
    },
  });

  test('encuentra los arrays a cualquier profundidad, y todos', () => {
    // Casi ninguna exportación real pone el array en la raíz, y muchas traen
    // varios hermanos: posiciones y operaciones en el mismo archivo.
    const r = parse(json, 'kraken.json');
    expect(r.tablas).toHaveLength(2);
    expect(r.tablas.map(t => t.nombre).sort()).toEqual(['result.balances', 'result.trades']);
  });

  test('aplana los objetos anidados a «padre.hijo»', () => {
    const t = parse(json, 'x.json').tablas.find(x => x.nombre.endsWith('trades'));
    const i = t.filas[0].indexOf('fee.cost');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(t.filas[1][i]).toBe('1.2');
    expect(t.filas[2][i]).toBe('0.9');
  });

  test('todas las filas se aplanan igual, no solo la primera', () => {
    // `map(ieFlattenObject)` pasaba el índice y el array a los parámetros
    // `prefijo` y `prof`: la fila 0 salía bien (el índice 0 es falsy) y las
    // demás con las claves prefijadas y sin aplanar.
    const t = parse(json, 'x.json').tablas.find(x => x.nombre.endsWith('trades'));
    expect(t.filas[0].some(h => /^\d+\./.test(h))).toBe(false);
    expect(t.filas[0]).not.toContain('1.id');
  });

  test('un array de escalares se une; uno de objetos se resume', () => {
    const t = parse(json, 'x.json').tablas.find(x => x.nombre.endsWith('trades'));
    expect(t.filas[1][t.filas[0].indexOf('tags')]).toBe('spot maker');
  });

  test('un JSON sin listas no produce tablas, y lo dice', () => {
    const r = parse('{"a":1,"b":2}', 'x.json');
    expect(r.tablas).toHaveLength(0);
    expect(r.avisos).toHaveLength(1);
  });

  test('un JSON inválido no revienta', () => {
    expect(parse('{roto', 'x.json').avisos[0]).toMatch(/no es JSON/i);
  });
});

/* ═══ 4. XML y HTML ════════════════════════════════════════════ */

describe('XML', () => {
  const xml = `<?xml version="1.0"?>
<ns1:Report xmlns:ns1="urn:x"><ns1:Positions>
<ns1:Position symbol="AAPL"><ns1:ISIN>US0378331005</ns1:ISIN><ns1:Qty>25</ns1:Qty></ns1:Position>
<ns1:Position symbol="MSFT"><ns1:ISIN>US5949181045</ns1:ISIN><ns1:Qty>12</ns1:Qty></ns1:Position>
</ns1:Positions></ns1:Report>`;

  test('ignora los prefijos de espacio de nombres', () => {
    const r = parse(xml, 'r.xml');
    expect(r.tablas[0].nombre).toBe('Position');
    expect(r.tablas[0].filas).toHaveLength(3);
  });

  test('los atributos se tratan como columnas', () => {
    const t = parse(xml, 'r.xml').tablas[0];
    expect(t.filas[0]).toContain('@symbol');
    expect(t.filas[1][t.filas[0].indexOf('@symbol')]).toBe('AAPL');
  });

  test('un nodo con atributos conserva su propio texto (contenido mixto)', () => {
    // Los atributos se inyectan como hijos, así que sin esto todo elemento
    // con atributos pierde su valor: <Amt Ccy="EUR">48.20</Amt> se quedaba
    // sin el 48,20 y el apunte entero se descartaba por no tener importe.
    const o = g('ieXmlBlockToObject')('<Amt Ccy="EUR">48.20</Amt>');
    expect(o['Amt']).toBe('48.20');
    expect(o['Amt.@Ccy']).toBe('EUR');
  });

  test('varias hojas con el mismo nombre se concatenan', () => {
    const o = g('ieXmlBlockToObject')('<RmtInf><Ustrd>UNO</Ustrd><Ustrd>DOS</Ustrd></RmtInf>');
    expect(o['RmtInf.Ustrd']).toBe('UNO DOS');
  });
});

describe('HTML', () => {
  test('extrae las tablas con datos y descarta las de maquetación', () => {
    const html = '<html><body>'
      + '<table><tr><th>Producto</th><th>Precio de&nbsp;cierre</th></tr>'
      + '<tr><td><b>VANGUARD</b></td><td>112,34</td></tr></table>'
      + '<table><tr><td>pie</td></tr></table></body></html>';
    const r = parse(html, 'x.xls');
    expect(r.tablas).toHaveLength(1);
    expect(r.tablas[0].filas[0][1]).toBe('Precio de cierre');
    expect(r.tablas[0].filas[1][0]).toBe('VANGUARD');
  });
});

/* ═══ 5. OFX ═══════════════════════════════════════════════════ */

describe('OFX / QFX', () => {
  const ofxBanco = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>EUR
<BANKACCTFROM><ACCTID>ES5900491500051234567892<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260905120000<TRNAMT>-48.20<FITID>F1<NAME>MERCADONA GRAN VIA<MEMO>COMPRA TARJETA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901<TRNAMT>1850.00<FITID>F2<NAME>NOMINA EMPRESA SL</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>3081.56<DTASOF>20260907</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  test('produce registros ya semánticos, no tablas', () => {
    // En OFX el significado de cada campo está en la especificación.
    // Pasarlo por un detector de columnas sería tirar un dato cierto.
    const r = parse(ofxBanco, 'x.ofx');
    expect(r.kind).toBe('registros');
    expect(r.registros).toHaveLength(2);
  });

  test('lee fecha, importe con signo y FITID', () => {
    const [a] = parse(ofxBanco, 'x.ofx').registros;
    expect(a.fecha).toBe('2026-09-05');
    expect(a.importe).toBe(-48.2);
    expect(a.idOriginal).toBe('F1');
  });

  test('NAME y MEMO son campos distintos y se conservan separados', () => {
    const [a] = parse(ofxBanco, 'x.ofx').registros;
    expect(a.contrapartida).toBe('MERCADONA GRAN VIA');
    expect(a.nota).toBe('COMPRA TARJETA');
  });

  test('lee la cuenta y el saldo de cierre', () => {
    const { cuentas } = parse(ofxBanco, 'x.ofx');
    expect(cuentas[0].iban).toBe('ES5900491500051234567892');
    expect(cuentas[0].saldoFinal).toBe(3081.56);
  });

  const ofxInv = `OFXHEADER:100
<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD
<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>B1<DTTRADE>20260610<DTSETTLE>20260612<MEMO>Compra</INVTRAN>
<SECID><UNIQUEID>US0378331005<UNIQUEIDTYPE>ISIN</SECID>
<UNITS>25<UNITPRICE>142.10<COMMISSION>1.00<TOTAL>-3553.50</INVBUY></BUYSTOCK>
<INCOME><INVTRAN><FITID>D1<DTTRADE>20260815<MEMO>Dividendo</INVTRAN>
<SECID><UNIQUEID>US0378331005<UNIQUEIDTYPE>ISIN</SECID><TOTAL>6.00<TAXES>0.90</INCOME>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO>
<SECID><UNIQUEID>US0378331005<UNIQUEIDTYPE>ISIN</SECID><SECNAME>Apple Inc<TICKER>AAPL</SECINFO></STOCKINFO>
</SECLIST></SECLISTMSGSRSV1></OFX>`;

  test('distingue compra, dividendo y sus fechas', () => {
    const r = parse(ofxInv, 'ib.ofx');
    const compra = r.registros.find(x => x.accion === 'compra');
    const div = r.registros.find(x => x.accion === 'dividendo');
    expect(compra.cantidad).toBe(25);
    expect(compra.precio).toBe(142.1);
    // La fecha de operación y la de liquidación son distintas y se guardan
    // las dos: el encargo lo pedía explícitamente.
    expect(compra.fecha).toBe('2026-06-10');
    expect(compra.fechaLiquidacion).toBe('2026-06-12');
    expect(div.impuestos).toBe(0.9);
  });

  test('el ticker y el nombre se toman del catálogo de valores', () => {
    const compra = parse(ofxInv, 'ib.ofx').registros.find(x => x.accion === 'compra');
    expect(compra.ticker).toBe('AAPL');
    expect(compra.nombre).toBe('Apple Inc');
  });

  test('un CUSIP NO se guarda en el campo ISIN', () => {
    // UNIQUEIDTYPE dice cuál de los dos es. Meter un CUSIP en el campo ISIN
    // sería un dato falso que después nadie podría distinguir.
    const r = parse(ofxInv.replace(/UNIQUEIDTYPE>ISIN/g, 'UNIQUEIDTYPE>CUSIP'), 'x.ofx');
    const compra = r.registros.find(x => x.accion === 'compra');
    expect(compra.isin).toBe('');
    expect(compra.otroId).toBe('CUSIP:US0378331005');
  });
});

/* ═══ 6. QIF ═══════════════════════════════════════════════════ */

describe('QIF', () => {
  test('lee los apuntes y deja la categoría de origen como pista', () => {
    const qif = '!Type:Bank\nD15/09/2026\nT-48,20\nPMERCADONA\nMCompra\nLAlimentacion\n^';
    const [a] = parse(qif, 'x.qif').registros;
    expect(a.fecha).toBe('2026-09-15');
    expect(a.importe).toBe(-48.2);
    // La categoría es del programa de origen, no de Finova: viaja como
    // pista, y es la capa de clasificación la que decide si la usa.
    expect(a.categoriaOrigen).toBe('Alimentacion');
  });

  test('el orden de la fecha se decide con TODO el archivo, no línea a línea', () => {
    // QIF no declara el formato de fecha, y la misma cadena vale para
    // MM/DD/YY y DD/MM/YY. Si alguna fecha tiene el primer número > 12, el
    // formato queda demostrado para todo el archivo.
    const qif = '!Type:Bank\nD05/09/2026\nT-1,00\nPA\n^\nD15/09/2026\nT-2,00\nPB\n^';
    const r = parse(qif, 'x.qif');
    expect(r.registros[0].fecha).toBe('2026-09-05');
    expect(r.registros[1].fecha).toBe('2026-09-15');
    expect(r.avisos).toHaveLength(0);
  });

  test('si las fechas son ambiguas se avisa, no se decide en silencio', () => {
    const r = parse('!Type:Bank\nD05/09/2026\nT-1,00\nPA\n^\nD06/09/2026\nT-2,00\nPB\n^', 'x.qif');
    expect(r.registros[0].fecha).toBe('2026-09-05');
    expect(r.avisos.some(a => /ambigua/i.test(a))).toBe(true);
  });

  test('los apuntes de inversión se reconocen como tales', () => {
    const r = parse('!Type:Invst\nD10/06/2026\nNBuy\nYApple Inc\nI142,10\nQ25\nT3553,50\nO1,00\n^', 'x.qif');
    expect(r.registros[0].tipoRegistro).toBe('op-inversion');
    expect(r.registros[0].accion).toBe('compra');
    expect(r.registros[0].cantidad).toBe(25);
  });
});

/* ═══ 7. MT940 ═════════════════════════════════════════════════ */

describe('MT940', () => {
  const mt = `:20:STARTUMS
:25:ES5900491500051234567892
:60F:C260901EUR1234,56
:61:2609050905D48,20NMSCNONREF//REF123456
:86:COMPRA TARJETA MERCADONA
:61:2609010901C1850,00NTRFNOMINA//REF999
:86:?20TRANSFERENCIA ?21NOMINA SEPTIEMBRE ?32EMPRESA SL
:61:2609070907RD3,00NCHGNONREF
:86:REVERSION COMISION
:62F:C260907EUR3081,56
-`;

  test('la letra D/C da el signo, y RD/RC lo invierte', () => {
    const { registros } = parse(mt, 'x.sta');
    expect(registros.map(r => r.importe)).toEqual([-48.2, 1850, 3]);
    expect(registros[2].esReversion).toBe(true);
  });

  test('coma decimal, con el punto como millares', () => {
    expect(g('ieMt940Amount')('1.234,56')).toBe(1234.56);
  });

  test('une los subcampos ?20/?21 y saca la contrapartida de ?32', () => {
    const { registros } = parse(mt, 'x.sta');
    expect(registros[1].descripcion).toBe('TRANSFERENCIA NOMINA SEPTIEMBRE');
    expect(registros[1].contrapartida).toBe('EMPRESA SL');
  });

  test('lee los saldos inicial y final con su divisa', () => {
    const { cuentas } = parse(mt, 'x.sta');
    expect(cuentas[0].saldoInicial).toBe(1234.56);
    expect(cuentas[0].saldoFinal).toBe(3081.56);
    expect(cuentas[0].divisa).toBe('EUR');
  });

  test('la fecha de apunte sin año no salta doce meses al cambiar de año', () => {
    // :61: trae la fecha de apunte como MMDD, sin año. Heredar el de la
    // fecha valor sin más coloca un apunte del 31/12 en el año siguiente.
    const r = parse(':20:X\n:25:ES00\n:60F:C260102EUR100,00\n:61:2601021231D10,00NMSCNONREF\n:86:GASTO\n:62F:C260102EUR90,00\n-', 'x.sta');
    expect(r.registros[0].fechaValor).toBe('2026-01-02');
    expect(r.registros[0].fecha).toBe('2025-12-31');
  });
});

/* ═══ 8. CAMT.053 ══════════════════════════════════════════════ */

describe('CAMT.053', () => {
  const camt = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
<Stmt><Id>S1</Id>
<Acct><Id><IBAN>ES5900491500051234567892</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1234.56</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-09-01</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">3081.56</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-09-07</Dt></Dt></Bal>
<Ntry><Amt Ccy="EUR">48.20</Amt><CdtDbtInd>DBIT</CdtDbtInd>
  <BookgDt><Dt>2026-09-05</Dt></BookgDt><ValDt><Dt>2026-09-06</Dt></ValDt>
  <AcctSvcrRef>REF-1</AcctSvcrRef>
  <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>CCRD</Cd><SubFmlyCd>POSD</SubFmlyCd></Fmly></Domn></BkTxCd>
  <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>MERCADONA</Nm></Cdtr></RltdPties>
  <RmtInf><Ustrd>COMPRA TARJETA</Ustrd><Ustrd>REF 0012</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">1850.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
  <BookgDt><Dt>2026-09-01</Dt></BookgDt><AcctSvcrRef>REF-2</AcctSvcrRef>
  <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>EMPRESA SL</Nm></Dbtr></RltdPties></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><RvslInd>true</RvslInd>
  <BookgDt><Dt>2026-09-04</Dt></BookgDt><AcctSvcrRef>REF-3</AcctSvcrRef>
  <AddtlNtryInf>DEVOLUCION COMISION</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

  test('el signo lo da CdtDbtInd, no el signo del importe', () => {
    // En CAMT el importe SIEMPRE es positivo. Tomarlo tal cual convierte
    // todos los gastos en ingresos.
    const { registros } = parse(camt, 'x.xml');
    expect(registros.map(r => r.importe)).toEqual([-48.2, 1850, 5]);
  });

  test('separa fecha contable y fecha valor', () => {
    const [a] = parse(camt, 'x.xml').registros;
    expect(a.fecha).toBe('2026-09-05');
    expect(a.fechaValor).toBe('2026-09-06');
  });

  test('concatena los <Ustrd> y saca acreedor o deudor según el signo', () => {
    const { registros } = parse(camt, 'x.xml');
    expect(registros[0].descripcion).toBe('COMPRA TARJETA REF 0012');
    expect(registros[0].contrapartida).toBe('MERCADONA');
    expect(registros[1].contrapartida).toBe('EMPRESA SL');
  });

  test('guarda AcctSvcrRef y el código de transacción bancaria', () => {
    const [a] = parse(camt, 'x.xml').registros;
    expect(a.idOriginal).toBe('REF-1');
    expect(a.tipoBanco).toBe('PMNT/CCRD/POSD');
  });

  test('lee IBAN, divisa y los saldos OPBD/CLBD', () => {
    const { cuentas } = parse(camt, 'x.xml');
    expect(cuentas[0].iban).toBe('ES5900491500051234567892');
    expect(cuentas[0].saldoInicial).toBe(1234.56);
    expect(cuentas[0].saldoFinal).toBe(3081.56);
  });

  test('un apunte sin CdtDbtInd se OMITE y se explica por qué', () => {
    // Su signo no se puede deducir de nada. Importarlo con un signo elegido
    // al azar sería meter un dato falso.
    const roto = camt.replace('<CdtDbtInd>DBIT</CdtDbtInd>\n  <BookgDt><Dt>2026-09-05</Dt>', '<BookgDt><Dt>2026-09-05</Dt>');
    const r = parse(roto, 'x.xml');
    expect(r.registros).toHaveLength(2);
    expect(r.avisos.some(a => /cargo o abono/i.test(a))).toBe(true);
  });
});

/* ═══ 9. Validadores de contenido ══════════════════════════════ */

describe('Validadores — la evidencia del contenido', () => {
  test('el ISIN se valida con su dígito de control', () => {
    // Es la validación más valiosa del motor: un ISIN correcto es evidencia
    // casi definitiva, y permite distinguir la columna de ISIN de cualquier
    // otra referencia alfanumérica sin depender de la cabecera.
    for (const isin of ['US0378331005', 'IE00B3RBWM25', 'ES0113900J37', 'DE000BAY0017']) {
      expect(g('ieEsISIN')(isin)).toBe(true);
    }
    expect(g('ieEsISIN')('US0378331006')).toBe(false);   // control erróneo
    expect(g('ieEsISIN')('XX1234567890')).toBe(false);
    expect(g('ieEsISIN')('AAPL')).toBe(false);
  });

  test('una fecha no cuenta como número', () => {
    // Si contara, media columna de fechas puntuaría como numérica y podría
    // llevarse el campo «importe».
    expect(g('ieEsNumero')('05/09/2026')).toBe(false);
    expect(g('ieEsNumero')('2026-09-05')).toBe(false);
    expect(g('ieEsNumero')('-48,20')).toBe(true);
    expect(g('ieEsNumero')('(45,30)')).toBe(true);
    expect(g('ieEsNumero')('1.234,56 €')).toBe(true);
  });

  test('ocho cifras solo son fecha si el mes y el día son plausibles', () => {
    expect(g('ieEsFecha')('20260905')).toBe(true);
    expect(g('ieEsFecha')('99887766')).toBe(false);      // un identificador
  });

  test('el importe se lee en formato europeo y anglosajón', () => {
    expect(g('ieNum')('1.234,56')).toBe(1234.56);
    expect(g('ieNum')('1,234.56')).toBe(1234.56);
    expect(g('ieNum')('45,30-')).toBe(-45.3);            // signo detrás
    expect(g('ieNum')('(45.30)')).toBe(-45.3);
  });

  test('un ISIN no se confunde con un ticker', () => {
    expect(g('ieEsTicker')('SAN.MC')).toBe(true);
    expect(g('ieEsTicker')('BRK-B')).toBe(true);
    expect(g('ieEsTicker')('US0378331005')).toBe(false);
    expect(g('ieEsTicker')('Vanguard FTSE All-World')).toBe(false);
  });
});

/* ═══ 10. Fila de cabecera ═════════════════════════════════════ */

describe('Fila de cabecera', () => {
  test('la encuentra aunque haya varias filas de preámbulo', () => {
    const filas = [
      ['Consulta de movimientos', '', '', ''],
      ['Cuenta: ES59 0049 1500 0512 3456 7892', '', '', ''],
      ['', '', '', ''],
      ['Fecha', 'Fecha valor', 'Concepto', 'Importe'],
      ['05/09/2026', '06/09/2026', 'COMPRA', '-48,20'],
    ];
    expect(g('ieFindHeaderRow')(filas)).toBe(3);
    expect(detect(filas).filasDatos).toHaveLength(1);
  });

  test('sin cabecera reconocible devuelve -1, no 0', () => {
    // Devolver 0 significaría tratar la primera fila de datos como cabecera
    // y perderla.
    const filas = [['05/09/2026', 'algo', '-48,20'], ['06/09/2026', 'otra', '12,00']];
    expect(g('ieFindHeaderRow')(filas)).toBe(-1);
    expect(detect(filas).filasDatos).toHaveLength(2);
  });

  test('una fila de datos no se toma por cabecera', () => {
    const filas = [['2026-09-05', '48,20', '1234,56'], ['2026-09-06', '12,00', '1222,56']];
    expect(g('ieFindHeaderRow')(filas)).toBe(-1);
  });
});

/* ═══ 11. Los tres tipos de fecha ══════════════════════════════ */

describe('Fechas — operación, valor, liquidación y contabilización', () => {
  test('con las tres presentes, cada una va a su campo', () => {
    // Y en orden engañoso a propósito: la de operación es la TERCERA
    // columna. Asignar columna a columna se habría quedado con la primera.
    const filas = [
      ['Settlement Date', 'Booking Date', 'Trade Date', 'Description', 'Amount'],
      ['2026-06-12', '2026-06-11', '2026-06-10', 'Compra AAPL', '-3553.50'],
      ['2026-06-15', '2026-06-14', '2026-06-13', 'Compra MSFT', '-1200.00'],
    ];
    const r = detect(filas);
    expect(campo(r, 'fechaOperacion')).toBe('Trade Date');
    expect(campo(r, 'fechaLiquidacion')).toBe('Settlement Date');
    expect(campo(r, 'fechaContable')).toBe('Booking Date');
  });

  test.each([
    ['Transaction Date', 'fechaOperacion'],
    ['Fecha operación', 'fechaOperacion'],
    ['Trade Date', 'fechaOperacion'],
    ['Operation Date', 'fechaOperacion'],
    ['Fecha valor', 'fechaValor'],
    ['Booking Date', 'fechaContable'],
  ])('«%s» → %s', (cabecera, esperado) => {
    const filas = [[cabecera, 'Concepto', 'Importe'], ['2026-05-01', 'X', '-10,00'], ['2026-05-02', 'Y', '-11,00']];
    const r = detect(filas);
    const hallado = Object.entries(r.campos).find(([, v]) => v.cabecera === cabecera);
    expect(hallado && hallado[0]).toBe(esperado);
  });

  test('una columna de fechas con cabecera irreconocible se acepta SI es la única', () => {
    const filas = [['zzz', 'Concepto', 'Importe'], ['2026-09-05', 'X', '-1,00'], ['2026-09-06', 'Y', '-2,00']];
    const r = detect(filas);
    expect(campo(r, 'fechaOperacion')).toBe('zzz');
    expect(r.campos.fechaOperacion.confianza).toBe('media');
    expect(r.campos.fechaOperacion.motivos.join(' ')).toMatch(/única columna de fechas/);
  });

  test('con DOS columnas de fecha irreconocibles no se elige ninguna', () => {
    // El tipo «fecha» es discriminante, pero el PAPEL no lo es: elegir cuál
    // es la de operación sería adivinar.
    const filas = [['zzz', 'qqq', 'Concepto'], ['2026-09-05', '2026-09-06', 'X'], ['2026-09-07', '2026-09-08', 'Y']];
    expect(detect(filas).campos.fechaOperacion).toBeUndefined();
  });
});

/* ═══ 12. Cartera ══════════════════════════════════════════════ */

describe('Cartera — las confusiones que el encargo prohíbe', () => {
  const cartera = [
    ['Producto', 'ISIN', 'Símbolo', 'Participaciones', 'Precio medio de compra', 'Precio actual',
      'Coste de adquisición', 'Valor de mercado', 'Ganancia/Pérdida', 'Rentabilidad %', 'Divisa'],
    ['Vanguard FTSE All-World', 'IE00B3RBWM25', 'VWCE', '42', '98,20', '112,34', '4.124,40', '4.718,28', '593,88', '14,40', 'EUR'],
    ['Apple Inc', 'US0378331005', 'AAPL', '25', '142,10', '198,50', '3.552,50', '4.962,50', '1.410,00', '39,69', 'USD'],
    ['Santander', 'ES0113900J37', 'SAN', '500', '3,80', '4,21', '1.900,00', '2.105,00', '205,00', '10,79', 'EUR'],
  ];

  test.each([
    ['nombreActivo', 'Producto'],
    ['isin', 'ISIN'],
    ['ticker', 'Símbolo'],
    ['cantidad', 'Participaciones'],
    ['precioMedio', 'Precio medio de compra'],
    ['precioActual', 'Precio actual'],
    ['costeAdquisicion', 'Coste de adquisición'],
    ['valorMercado', 'Valor de mercado'],
    ['gananciaPerdida', 'Ganancia/Pérdida'],
    ['rentabilidadPct', 'Rentabilidad %'],
    ['divisa', 'Divisa'],
  ])('%s ← «%s»', (nombre, cabecera) => {
    expect(campo(detect(cartera), nombre)).toBe(cabecera);
  });

  test('«Precio medio de compra» NO se lleva el campo de precio unitario', () => {
    // Sin las reglas de exclusión, «Precio medio de compra» contiene
    // «precio» exacto y las dos columnas de precio se intercambiarían.
    const r = detect(cartera);
    expect(campo(r, 'precioUnitario')).not.toBe('Precio medio de compra');
    expect(campo(r, 'precioUnitario')).not.toBe('Precio actual');
  });

  test('cantidad e importe no comparten columna', () => {
    const r = detect(cartera);
    const colImporte = r.campos.importe ? r.campos.importe.col : -1;
    expect(r.campos.cantidad.col).not.toBe(colImporte);
  });

  test('una columna de ISIN se reconoce por su contenido aunque se llame «Ref»', () => {
    const filas = [
      ['Producto', 'Ref', 'Cantidad'],
      ['Vanguard FTSE', 'IE00B3RBWM25', '42'],
      ['Apple', 'US0378331005', '25'],
      ['Santander', 'ES0113900J37', '500'],
    ];
    const r = detect(filas);
    expect(campo(r, 'isin')).toBe('Ref');
    expect(r.campos.isin.confianza).toBe('alta');
    expect(r.campos.isin.motivos.join(' ')).toMatch(/dígito de control/);
  });
});

/* ═══ 13. Extractos bancarios ══════════════════════════════════ */

describe('Extractos bancarios', () => {
  test('cargo y abono en columnas separadas, sin inventar un «importe»', () => {
    const filas = [
      ['Fecha', 'Descripción', 'Cargo', 'Abono', 'Saldo'],
      ['05/09/2026', 'COMPRA MERCADONA', '48,20', '', '1.234,56'],
      ['01/09/2026', 'NOMINA', '', '1.850,00', '3.084,56'],
    ];
    const r = detect(filas);
    expect(campo(r, 'cargo')).toBe('Cargo');
    expect(campo(r, 'abono')).toBe('Abono');
    expect(campo(r, 'saldo')).toBe('Saldo');
    expect(r.campos.importe).toBeUndefined();
  });

  test('neobanco en inglés: Amount, Fee y Balance no se confunden', () => {
    const filas = [
      ['Type', 'Started Date', 'Description', 'Amount', 'Fee', 'Currency', 'Balance'],
      ['CARD_PAYMENT', '2026-09-05 12:01:00', 'Mercadona', '-48.20', '0.00', 'EUR', '1234.56'],
      ['TOPUP', '2026-09-01 08:00:00', 'Nomina', '1850.00', '0.00', 'EUR', '3084.56'],
    ];
    const r = detect(filas);
    expect(campo(r, 'importe')).toBe('Amount');
    expect(campo(r, 'comision')).toBe('Fee');
    expect(campo(r, 'saldo')).toBe('Balance');
    expect(campo(r, 'tipoOperacion')).toBe('Type');
  });
});

/* ═══ 14. Cripto y dividendos ══════════════════════════════════ */

describe('Cripto y dividendos', () => {
  test('exportación de exchange', () => {
    const filas = [
      ['txid', 'time', 'pair', 'side', 'volume', 'price', 'fee', 'cost'],
      ['TX-1', '2026-09-05T10:00:00Z', 'BTC/EUR', 'buy', '0.015', '58200.50', '1.20', '873.01'],
      ['TX-2', '2026-09-07T11:30:00Z', 'ETH/EUR', 'sell', '1.4', '2410.00', '0.90', '3374.00'],
      ['TX-3', '2026-09-09T14:00:00Z', 'SOL/EUR', 'buy', '12.5', '142.30', '0.50', '1778.75'],
    ];
    const r = detect(filas);
    expect(campo(r, 'idOperacion')).toBe('txid');
    expect(campo(r, 'fechaOperacion')).toBe('time');
    expect(campo(r, 'cantidad')).toBe('volume');
    expect(campo(r, 'precioUnitario')).toBe('price');
    expect(campo(r, 'comision')).toBe('fee');
    expect(campo(r, 'tipoOperacion')).toBe('side');
  });

  test('informe de dividendos', () => {
    const filas = [
      ['Valor', 'ISIN', 'Fecha de pago', 'Dividendo por acción', 'Acciones', 'Importe bruto', 'Retención', 'Moneda'],
      ['Apple Inc', 'US0378331005', '15/08/2026', '0,24', '25', '6,00', '0,90', 'USD'],
      ['Santander', 'ES0113900J37', '02/05/2026', '0,10', '500', '50,00', '9,50', 'EUR'],
    ];
    const r = detect(filas);
    expect(campo(r, 'dividendoPorAccion')).toBe('Dividendo por acción');
    expect(campo(r, 'fechaPago')).toBe('Fecha de pago');
    expect(campo(r, 'impuestos')).toBe('Retención');
    expect(campo(r, 'cantidad')).toBe('Acciones');
  });
});

/* ═══ 15. Negarse a interpretar ════════════════════════════════ */

describe('Lo que NO se interpreta', () => {
  test('una columna «Importe» de puro texto no se asigna como importe', () => {
    // La cabecera dice una cosa y el contenido otra. Es exactamente el caso
    // en el que inventar sale caro.
    const filas = [['Importe', 'Concepto'], ['no es un número', 'X'], ['tampoco', 'Y'], ['nada', 'Z']];
    const r = detect(filas);
    expect(r.campos.importe).toBeUndefined();
    expect(r.sinAsignar.map(c => c.cabecera)).toContain('Importe');
  });

  test('las columnas desconocidas se informan con lo que contienen', () => {
    const filas = [
      ['Fecha', 'Concepto', 'Importe', 'ZXQ-9'],
      ['05/09/2026', 'COMPRA', '-48,20', '77,3'],
      ['06/09/2026', 'OTRA', '-12,00', '81,1'],
    ];
    const r = detect(filas);
    expect(campo(r, 'importe')).toBe('Importe');
    const zxq = r.sinAsignar.find(c => c.cabecera === 'ZXQ-9');
    expect(zxq).toBeTruthy();
    expect(zxq.nota).toMatch(/números/i);
  });

  test('una columna vacía con cabecera clara entra con confianza baja', () => {
    const filas = [['Fecha', 'Concepto', 'Comisión'], ['05/09/2026', 'X', ''], ['06/09/2026', 'Y', '']];
    const r = detect(filas);
    expect(r.campos.comision.confianza).toBe('baja');
    expect(r.campos.comision.motivos.join(' ')).toMatch(/vacía/);
  });

  test('cada campo sale con sus motivos, para poder auditarlo', () => {
    const filas = [['Fecha', 'Concepto', 'Importe'], ['05/09/2026', 'X', '-10,00'], ['06/09/2026', 'Y', '-11,00']];
    const r = detect(filas);
    expect(r.campos.fechaOperacion.confianza).toBe('alta');
    expect(r.campos.fechaOperacion.motivos).toHaveLength(2);
  });

  test('el sufijo de divisa en la cabecera no impide la coincidencia', () => {
    const filas = [
      ['Fecha', 'Concepto', 'Importe (EUR)', 'Market Value USD'],
      ['05/09/2026', 'X', '-48,20', '4962,50'],
      ['06/09/2026', 'Y', '-12,00', '2105,00'],
    ];
    const r = detect(filas);
    expect(campo(r, 'importe')).toBe('Importe (EUR)');
    expect(campo(r, 'valorMercado')).toBe('Market Value USD');
  });
});
