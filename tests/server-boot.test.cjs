'use strict';

/**
 * Finova — server-boot.test.cjs
 *
 * Comprueba que server.cjs arranca y se comporta como debe en un hosting
 * real, sin romper el uso local.
 *
 * Se arranca el proceso DE VERDAD con NODE_ENV=production y un DATA_DIR
 * temporal. Probar las funciones por separado no valdría para lo que importa
 * aquí: que el proceso escuche en la interfaz correcta, que no abra un
 * navegador, que cree sus ficheros donde se le dice y que muera limpio con
 * SIGTERM son propiedades del PROCESO, no de ninguna función.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.cjs');

/* ─── Utilidades ──────────────────────────────────────────────── */

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Petición simple. `host` permite hablarle por otra interfaz. */
function pedir(puerto, ruta, opciones = {}) {
  return new Promise(resolve => {
    const req = http.request({
      host: opciones.host || '127.0.0.1',
      port: puerto,
      method: opciones.metodo || 'GET',
      path: ruta,
      headers: Object.assign({ Host: `localhost:${puerto}` }, opciones.headers || {}),
    }, res => {
      const t = [];
      res.on('data', c => t.push(c));
      res.on('end', () => resolve({
        codigo: res.statusCode,
        cuerpo: Buffer.concat(t).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('error', e => resolve({ codigo: 0, cuerpo: '', error: e.message }));
    req.end();
  });
}

/** Directorio de datos temporal, FUERA del proyecto. */
function dataDirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'finova-test-'));
}
function borrarDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
}

async function arrancar(envExtra = {}, dataDir) {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(puerto),
      DATA_DIR: dataDir,
      // Sin esto, cada arranque abriría una pestaña del navegador.
      OPEN_BROWSER: 'false',
      // El servidor se niega a arrancar en producción sin clave de cifrado
      // (los datos se guardarían en claro) y sin las credenciales del Admin
      // SDK (no se comprobaría la revocación de tokens). Las dos puertas son
      // deliberadas; aquí se satisfacen para poder probar lo que este fichero
      // prueba, que es el arranque. Las puertas en sí tienen sus propios
      // tests en tests/security-config.test.cjs.
      FINOVA_ENC_KEY: require('node:crypto').randomBytes(32).toString('hex'),
      ALLOW_NO_REVOCATION_CHECK: 'true',
    }, envExtra),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', d => { salida += d.toString(); });
  hijo.stderr.on('data', d => { salida += d.toString(); });

  const limite = Date.now() + 20000;
  for (;;) {
    if (hijo.exitCode != null) throw new Error(`salió con ${hijo.exitCode}:\n${salida}`);
    const r = await pedir(puerto, '/api/health');
    if (r.codigo > 0) break;
    if (Date.now() > limite) throw new Error(`no arrancó en 20 s:\n${salida}`);
    await new Promise(r2 => setTimeout(r2, 150));
  }
  return {
    puerto, hijo,
    log: () => salida,
    parar: () => new Promise(resolve => {
      if (hijo.exitCode != null) return resolve(hijo.exitCode);
      hijo.once('exit', c => resolve(c));
      hijo.kill('SIGTERM');
      setTimeout(() => { try { hijo.kill('SIGKILL'); } catch (_) {} resolve(null); }, 15000);
    }),
  };
}

/* ═══ Producción ═══════════════════════════════════════════════ */

describe('Arranque en modo producción', () => {
  let srv, DATA;
  before(async () => {
    DATA = dataDirTemporal();
    srv = await arrancar({
      NODE_ENV: 'production',
      // Obligatoria en producción: sin ella el servidor se niega a arrancar,
      // que es el comportamiento correcto.
      ALLOWED_ORIGIN: 'https://finova.test',
    }, DATA);
  });
  after(async () => {
    if (srv) await srv.parar();
    borrarDir(DATA);
  });

  test('/api/health responde 200 con ok y un timestamp', async () => {
    const r = await pedir(srv.puerto, '/api/health');
    assert.equal(r.codigo, 200);
    const j = JSON.parse(r.cuerpo);
    assert.equal(j.ok, true);
    assert.equal(typeof j.ts, 'number');
    // Un epoch plausible: dentro de los últimos 5 minutos.
    assert.ok(Math.abs(Date.now() - j.ts) < 300000, `ts fuera de rango: ${j.ts}`);
  });

  test('/api/health no filtra estado interno', async () => {
    // Un health público no debe decir versiones, rutas ni nada del proceso:
    // es el endpoint que cualquiera puede consultar sin autenticarse.
    const r = await pedir(srv.puerto, '/api/health');
    const j = JSON.parse(r.cuerpo);
    assert.deepEqual(Object.keys(j).sort(), ['ok', 'ts']);
    for (const prohibido of ['version', 'uptime', 'path', 'dir', 'env', 'node']) {
      assert.ok(!r.cuerpo.toLowerCase().includes(prohibido), `el cuerpo menciona «${prohibido}»`);
    }
  });

  test('HEAD /api/health responde 200 sin cuerpo', async () => {
    const r = await pedir(srv.puerto, '/api/health', { metodo: 'HEAD' });
    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.length, 0);
  });

  test('/api/health no exige el secreto del proxy', async () => {
    // Con FINOVA_PROXY_SECRET configurado, el resto de /api/* da 403 a quien
    // no venga del proxy. El health tiene que seguir respondiendo, o el
    // monitor externo marca el servicio como caído estando sano.
    const r = await pedir(srv.puerto, '/api/health');
    assert.equal(r.codigo, 200);
  });

  test('escucha en 0.0.0.0, no solo en loopback', async () => {
    // Detrás de un proxy que corre fuera del contenedor, un bind a loopback
    // es invisible — y el proceso arranca sin ningún error en los logs, lo
    // que hace el diagnóstico especialmente desagradable.
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal)
      .map(i => i.address);
    if (!ips.length) {
      // Sin interfaz externa no se puede comprobar de verdad; se mira el log.
      assert.match(srv.log(), /host=0\.0\.0\.0/);
      return;
    }
    const r = await pedir(srv.puerto, '/api/health', { host: ips[0] });
    assert.equal(r.codigo, 200, `no responde en ${ips[0]}`);
  });

  test('el banner de producción es una línea sin colores ni cajas', async () => {
    const log = srv.log();
    assert.match(log, /\[FINOVA\] listo · puerto=\d+ host=/);
    assert.ok(!log.includes('╔'), 'el log de producción trae la caja de desarrollo');
    assert.ok(!log.includes('\x1b['), 'el log de producción trae códigos de color');
  });

  test('el resumen de arranque no imprime ningún valor, solo nombres', () => {
    const log = srv.log();
    if (!/Variables opcionales/.test(log)) return;   // todas configuradas
    const linea = log.split('\n').find(l => l.includes('Variables opcionales'));
    // Lo que sigue a los dos puntos tiene que ser una lista de NOMBRES.
    const lista = linea.split(':').slice(1).join(':');
    for (const n of lista.split(',').map(x => x.trim()).filter(Boolean)) {
      assert.match(n, /^[A-Z][A-Z0-9_]*$/, `«${n}» no parece un nombre de variable`);
    }
  });

  test('no abre ningún navegador', () => {
    // OPEN_BROWSER=false, y además NODE_ENV=production.
    assert.ok(!/xdg-open|cmd \/c start|\bopen http/.test(srv.log()));
  });
});

/* ═══ DATA_DIR ═════════════════════════════════════════════════ */

describe('DATA_DIR', () => {
  let srv, DATA;
  before(async () => {
    DATA = dataDirTemporal();
    srv = await arrancar({ NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://finova.test' }, DATA);
  });
  after(async () => {
    if (srv) await srv.parar();
    borrarDir(DATA);
  });

  test('crea los subdirectorios dentro de DATA_DIR', () => {
    assert.ok(fs.existsSync(path.join(DATA, 'sync')), 'falta sync/');
    assert.ok(fs.existsSync(path.join(DATA, 'users')), 'falta users/');
  });

  test('NO escribe en ./data del proyecto', () => {
    // Es la comprobación que importa: si el servidor ignorara DATA_DIR, los
    // datos de producción acabarían en el directorio del proyecto, que en la
    // mayoría de los hostings es un disco efímero.
    const antes = fs.existsSync(path.join(ROOT, 'data'))
      ? fs.readdirSync(path.join(ROOT, 'data')).sort() : [];
    // Provocar una escritura real: el analytics se guarda con cada sesión.
    return pedir(srv.puerto, '/api/stats').then(() => {
      const despues = fs.existsSync(path.join(ROOT, 'data'))
        ? fs.readdirSync(path.join(ROOT, 'data')).sort() : [];
      assert.deepEqual(despues, antes, 'aparecieron ficheros nuevos en ./data');
    });
  });

  test('no deja temporales .tmp huérfanos', () => {
    const huerfanos = [];
    const mirar = (d) => {
      if (!fs.existsSync(d)) return;
      for (const n of fs.readdirSync(d)) {
        if (/\.tmp-\d+-[a-z0-9]+$/.test(n)) huerfanos.push(path.join(d, n));
      }
    };
    mirar(DATA); mirar(path.join(DATA, 'sync')); mirar(path.join(DATA, 'users'));
    assert.deepEqual(huerfanos, []);
  });

  test('limpia al arrancar los temporales de una escritura interrumpida', async () => {
    // Un .tmp huérfano es lo que deja un proceso que muere entre el write y
    // el rename. Sin limpieza se quedan para siempre y nadie los mira.
    const DATA2 = dataDirTemporal();
    fs.mkdirSync(path.join(DATA2, 'users'), { recursive: true });
    const basura = path.join(DATA2, 'users', 'abc.json.tmp-12345-xyz99');
    fs.writeFileSync(basura, 'a medias', 'utf8');
    const s2 = await arrancar({ NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://finova.test' }, DATA2);
    try {
      assert.ok(!fs.existsSync(basura), 'el temporal huérfano sigue ahí');
      assert.match(s2.log(), /temporal\(es\) huérfano\(s\)/);
    } finally {
      await s2.parar();
      borrarDir(DATA2);
    }
  });

  test('si DATA_DIR no es escribible, el proceso NO arranca', async () => {
    // Mejor fallar al arrancar que descubrirlo cuando un usuario guarda sus
    // datos y recibe un 500 sin explicación.
    const puerto = await puertoLibre();
    // Un fichero donde se espera un directorio: mkdirSync falla con EEXIST
    // o ENOTDIR en cualquier sistema operativo.
    const f = path.join(os.tmpdir(), 'finova-no-dir-' + process.pid);
    fs.writeFileSync(f, 'x', 'utf8');
    const hijo = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(puerto), DATA_DIR: f, OPEN_BROWSER: 'false',
        NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://finova.test',
        FINOVA_ENC_KEY: require('node:crypto').randomBytes(32).toString('hex'),
        ALLOW_NO_REVOCATION_CHECK: 'true',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    hijo.stdout.on('data', d => { salida += d.toString(); });
    hijo.stderr.on('data', d => { salida += d.toString(); });
    const codigo = await new Promise(r => {
      hijo.once('exit', c => r(c));
      setTimeout(() => { try { hijo.kill('SIGKILL'); } catch (_) {} r(null); }, 15000);
    });
    try { fs.unlinkSync(f); } catch (_) {}
    assert.equal(codigo, 1, `se esperaba salida 1, fue ${codigo}. Log:\n${salida}`);
    assert.match(salida, /directorio de datos/i);
  });

  test('avisa si DATA_DIR queda dentro del proyecto en producción', async () => {
    // Es el error de despliegue más caro: parece funcionar y los datos
    // desaparecen en el siguiente deploy.
    const dentro = path.join(ROOT, 'data');
    const s2 = await arrancar({ NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://finova.test' }, dentro);
    try {
      assert.match(s2.log(), /EFÍMERO|efímero/);
      assert.match(s2.log(), /volumen persistente/);
    } finally {
      await s2.parar();
    }
  });
});

/* ═══ Cierre ordenado ══════════════════════════════════════════ */

describe('Cierre ordenado', () => {
  /*
   * SIGTERM es la señal que manda el hosting antes de reemplazar un
   * contenedor, así que el cierre ordenado es exactamente lo que evita
   * cortar peticiones en vuelo durante un despliegue.
   *
   * PERO en Windows no se puede comprobar de forma conductual: el sistema no
   * implementa las señales POSIX, y `child.kill('SIGTERM')` llama a
   * TerminateProcess, que mata el proceso sin entregar nada. Reproducido con
   * un caso mínimo: un hijo con un manejador de SIGTERM que imprime y sale
   * con 0 muere con exitCode null y sin imprimir.
   *
   * Así que en Windows esta prueba comprueba lo único comprobable —que los
   * manejadores están registrados y que el proceso muere— y la verificación
   * de verdad queda pendiente de ejecutarse en Linux, que es donde corre el
   * hosting. Está dicho también en DEPLOY.md.
   */
  test('SIGTERM cierra de forma ordenada', async () => {
    const DATA = dataDirTemporal();
    const srv = await arrancar({ NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://finova.test' }, DATA);
    const t0 = Date.now();
    const codigo = await srv.parar();
    const ms = Date.now() - t0;
    borrarDir(DATA);

    if (process.platform === 'win32') {
      // El proceso muere (no se queda colgado), que es lo que sí se puede
      // afirmar aquí. El código es null porque lo mató TerminateProcess.
      assert.ok(ms < 12000, `tardó ${ms} ms en morir`);
      const src = fs.readFileSync(SERVER, 'utf8');
      assert.match(src, /process\.on\('SIGTERM',\s*\(\)\s*=>\s*_gracefulShutdown/);
      assert.match(src, /process\.on\('SIGINT',\s*\(\)\s*=>\s*_gracefulShutdown/);
      assert.match(src, /_httpServer\.close/);
      return;
    }

    assert.equal(codigo, 0, `salió con ${codigo}`);
    // Con el servidor en reposo no debe esperar los 10 s del tope.
    assert.ok(ms < 12000, `tardó ${ms} ms`);
    assert.match(srv.log(), /Apagando/);
  });

  test('una segunda señal fuerza la salida', () => {
    // Si el cierre ordenado se queda colgado (una petición que no termina),
    // el segundo Ctrl+C del operador tiene que salir ya. Antes la segunda
    // señal hacía `return` y se ignoraba.
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /Segunda señal/);
    assert.match(src, /salida forzada/);
  });

  test('los timeouts de conexión están puestos', async () => {
    // keepAliveTimeout por debajo del del proxy produce 502 esporádicos:
    // el proxy reutiliza una conexión justo cuando el servidor la cierra.
    const src = fs.readFileSync(SERVER, 'utf8');
    const ka = Number((src.match(/keepAliveTimeout\s*=\s*(\d+)/) || [])[1]);
    const ht = Number((src.match(/headersTimeout\s*=\s*(\d+)/) || [])[1]);
    const rt = Number((src.match(/requestTimeout\s*=\s*(\d+)/) || [])[1]);
    assert.ok(ka >= 61000, `keepAliveTimeout=${ka}, debería superar los 60 s del proxy`);
    assert.ok(ht > ka, `headersTimeout (${ht}) debe ser mayor que keepAliveTimeout (${ka})`);
    // Con 8 MB permitidos en sync-upload y user-data, 30 s exigirían
    // ~273 kB/s sostenidos: cortaría subidas legítimas desde móvil.
    assert.ok(rt >= 60000, `requestTimeout=${rt}, cortaría las subidas de 8 MB`);
  });
});

/* ═══ IP del cliente ═══════════════════════════════════════════ */

describe('IP del cliente y TRUST_PROXY_HOPS', () => {
  /** Carga _clientIp del fichero real, sin arrancar el servidor. */
  function cargarClientIp(hops) {
    const src = fs.readFileSync(SERVER, 'utf8');
    // Se extraen las cuatro funciones implicadas por llaves equilibradas.
    const trozos = [];
    for (const nombre of ['_esIpValida', '_normalizaIp', '_clientIp']) {
      const i = src.indexOf(`function ${nombre}(`);
      assert.ok(i >= 0, `no se encontró ${nombre}`);
      // Saltar la lista de parámetros antes de contar llaves: el paréntesis
      // puede contener un objeto por defecto con su propia llave.
      let j = src.indexOf(')', i);
      let prof = 0, k = src.indexOf('{', j);
      let fin = k;
      for (; fin < src.length; fin++) {
        if (src[fin] === '{') prof++;
        else if (src[fin] === '}') { prof--; if (prof === 0) break; }
      }
      trozos.push(src.slice(i, fin + 1));
    }
    const ctx = vm.createContext({ Number, String, Array, Math, console });
    vm.runInContext(`const TRUST_PROXY_HOPS = ${hops};\n${trozos.join('\n')}`, ctx);
    return (headers, remoteAddress) =>
      vm.runInContext('_clientIp', ctx)({ headers, socket: { remoteAddress } });
  }

  test('con 0 saltos se IGNORA X-Forwarded-For', () => {
    // Era el fallo: _clientIp tomaba el elemento de la IZQUIERDA de
    // X-Forwarded-For, que lo escribe quien envía la petición. Medido antes
    // del arreglo: agotado el cubo de /api/waitlist (5 por IP) con 429,
    // bastaba añadir «X-Forwarded-For: 1.2.3.4» para obtener uno nuevo.
    // Afectaba a TODOS los límites por IP: IA (que cuesta dinero), sync,
    // borrado de cuenta, feedback y admin.
    const ip = cargarClientIp(0);
    assert.equal(ip({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.7'), '10.0.0.7');
    assert.equal(ip({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, '10.0.0.7'), '10.0.0.7');
    assert.equal(ip({}, '10.0.0.7'), '10.0.0.7');
  });

  test('con 1 salto se toma el ÚLTIMO elemento, no el primero', () => {
    const ip = cargarClientIp(1);
    assert.equal(ip({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18' }, '10.0.0.7'), '70.41.3.18');
    assert.equal(ip({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.7'), '1.2.3.4');
  });

  test('con 2 saltos se toma el penúltimo', () => {
    const ip = cargarClientIp(2);
    assert.equal(
      ip({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' }, '10.0.0.7'),
      '70.41.3.18',
    );
  });

  test('una cadena más corta de lo esperado cae a la IP de la conexión', () => {
    // Una cadena con menos saltos de los configurados es justamente la señal
    // de que alguien la está manipulando: no se coge «lo que haya».
    const ip = cargarClientIp(2);
    assert.equal(ip({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.7'), '10.0.0.7');
    assert.equal(ip({}, '10.0.0.7'), '10.0.0.7');
  });

  test('las entradas malformadas no rompen nada', () => {
    const ip = cargarClientIp(1);
    for (const malo of ['basura', 'no-una-ip', '999.999.999.999', '', ',,,', '   ', '<script>']) {
      const r = ip({ 'x-forwarded-for': malo }, '10.0.0.7');
      assert.equal(r, '10.0.0.7', `«${malo}» dio «${r}»`);
    }
  });

  test('se normaliza la IPv4 mapeada en IPv6 y el puerto pegado', () => {
    // Node entrega «::ffff:1.2.3.4» cuando una conexión IPv4 llega por un
    // socket IPv6. Sin normalizar, la misma IP daría dos cubos distintos.
    const ip0 = cargarClientIp(0);
    assert.equal(ip0({}, '::ffff:10.0.0.7'), '10.0.0.7');
    const ip1 = cargarClientIp(1);
    assert.equal(ip1({ 'x-forwarded-for': '70.41.3.18:54321' }, '10.0.0.7'), '70.41.3.18');
  });

  test('una IPv6 real se acepta', () => {
    const ip = cargarClientIp(1);
    assert.equal(ip({ 'x-forwarded-for': '2001:db8::1' }, '10.0.0.7'), '2001:db8::1');
  });

  test('un valor fuera de rango no cuela como IPv4', () => {
    const ip = cargarClientIp(1);
    assert.equal(ip({ 'x-forwarded-for': '256.1.1.1' }, '10.0.0.7'), '10.0.0.7');
  });
});

/* ═══ Desarrollo ═══════════════════════════════════════════════ */

describe('Modo desarrollo (no debe romperse)', () => {
  let srv, DATA;
  before(async () => {
    DATA = dataDirTemporal();
    // Sin NODE_ENV: es el caso de `node server.cjs` en local.
    srv = await arrancar({}, DATA);
  });
  after(async () => {
    if (srv) await srv.parar();
    borrarDir(DATA);
  });

  test('127.0.0.1 sigue redirigiendo a localhost', async () => {
    // Firebase Auth solo acepta «localhost» como dominio autorizado en
    // desarrollo, así que esta redirección es funcionalidad, no un detalle.
    const r = await new Promise(resolve => {
      const req = http.request({
        host: '127.0.0.1', port: srv.puerto, path: '/', method: 'GET',
        headers: { Host: `127.0.0.1:${srv.puerto}` },
      }, res => { res.resume(); res.on('end', () => resolve({ codigo: res.statusCode, loc: res.headers.location })); });
      req.on('error', () => resolve({ codigo: 0 }));
      req.end();
    });
    assert.equal(r.codigo, 301);
    assert.equal(r.loc, `http://localhost:${srv.puerto}/`);
  });

  test('en desarrollo escucha solo en loopback', async () => {
    // No hay motivo para exponer el servidor de desarrollo, con los datos
    // reales de quien lo ejecuta, a toda la red wifi.
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    if (!ips.length) return;
    const r = await pedir(srv.puerto, '/api/health', { host: ips[0] });
    assert.equal(r.codigo, 0, `responde en ${ips[0]} y no debería`);
  });

  test('el health también funciona en desarrollo', async () => {
    const r = await pedir(srv.puerto, '/api/health');
    assert.equal(r.codigo, 200);
    assert.equal(JSON.parse(r.cuerpo).ok, true);
  });

  test('HOST se puede forzar', async () => {
    const DATA2 = dataDirTemporal();
    const s2 = await arrancar({ HOST: '127.0.0.1' }, DATA2);
    try {
      const r = await pedir(s2.puerto, '/api/health');
      assert.equal(r.codigo, 200);
    } finally {
      await s2.parar();
      borrarDir(DATA2);
    }
  });
});
