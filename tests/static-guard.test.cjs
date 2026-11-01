'use strict';

/**
 * Finova — static-guard.test.cjs
 *
 * Comprueba que el servidor no sirve nada del proyecto que no sea contenido
 * público, y que no se puede salir del directorio.
 *
 * Tres cosas hacen que estas pruebas valgan algo:
 *
 *  1. Se arranca el servidor DE VERDAD, como proceso aparte, y se le habla
 *     por HTTP. Probar `_resolveStatic` llamándola directamente no vale: el
 *     fallo que se quiere evitar vive en el camino completo, y una capa
 *     intermedia puede deshacer la protección.
 *  2. La ruta se envía TAL CUAL, sin normalizar. Usar `new URL()` o un
 *     cliente que limpie la ruta probaría otra cosa: justamente la versión
 *     ya saneada de lo que se quiere rechazar.
 *  3. No basta con el código de estado. Se mira el CUERPO: un 200 con el
 *     contenido de server.cjs y un 404 son distinguibles, pero un 404 que
 *     por cualquier razón incluyera el fichero no lo sería. Así que se busca
 *     el contenido concreto que no debe salir.
 *
 * Se usa node:test, sin dependencias nuevas. Los datos falsos se crean en
 * data/users/ y se borran al terminar, pase lo que pase.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.cjs');

/* ─── Datos falsos ────────────────────────────────────────────── */

const SECRETO = 'SECRETO-DE-PRUEBA';
// Nombre con prefijo zz- para que no pueda chocar con un uid real (los de
// Firebase son alfanuméricos de 20+ caracteres, nunca empiezan por «zz-»).
const CEBO_USUARIO = path.join(ROOT, 'data', 'users', 'zz-test-uid.json');
const CEBO_SYNC    = path.join(ROOT, 'data', 'sync', 'zzzztest.json');
const CEBOS = [CEBO_USUARIO, CEBO_SYNC];

function crearCebos() {
  for (const f of CEBOS) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `{"nota":"${SECRETO}"}\n`, 'utf8');
  }
}
function borrarCebos() {
  for (const f of CEBOS) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  }
}
// Red de seguridad: si un test revienta o alguien corta la ejecución, los
// datos falsos no se quedan en el proyecto.
process.on('exit', borrarCebos);
process.on('SIGINT', () => { borrarCebos(); process.exit(130); });

/* ─── Arranque del servidor ───────────────────────────────────── */

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

/** Petición con la ruta EXACTA, sin pasar por ningún normalizador. */
function pedir(puerto, ruta, metodo = 'GET') {
  return new Promise(resolve => {
    let req;
    try {
      req = http.request({
        host: '127.0.0.1',
        port: puerto,
        method: metodo,
        // `path` se escribe tal cual en la línea de petición.
        path: ruta,
        // Sin esto el servidor responde 301 a localhost (la redirección que
        // Firebase Auth necesita en desarrollo) y no se probaría nada.
        headers: { Host: `localhost:${puerto}` },
      }, res => {
        const trozos = [];
        res.on('data', c => trozos.push(c));
        res.on('end', () => resolve({
          codigo: res.statusCode,
          cuerpo: Buffer.concat(trozos).toString('utf8'),
          headers: res.headers,
        }));
      });
    } catch (e) {
      // Una ruta que el propio cliente HTTP rechaza por inválida cuenta como
      // denegada: no llega a salir de la máquina.
      return resolve({ codigo: 400, cuerpo: '', rechazadaPorCliente: e.message });
    }
    req.on('error', e => resolve({ codigo: 0, cuerpo: '', error: e.message }));
    req.end();
  });
}

async function arrancar(envExtra) {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(puerto),
      NODE_ENV: 'test',
      // Sin esto cada arranque abre una pestaña del navegador en la máquina
      // de quien ejecuta los tests.
      FINOVA_NO_OPEN: '1',
      ...envExtra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', d => { salida += d.toString(); });
  hijo.stderr.on('data', d => { salida += d.toString(); });

  // Esperar a que responda, en vez de dormir un rato fijo: un sleep corto
  // hace la suite inestable y uno largo la hace lenta.
  const limite = Date.now() + 20000;
  for (;;) {
    if (hijo.exitCode != null) {
      throw new Error(`El servidor salió con código ${hijo.exitCode}:\n${salida}`);
    }
    const r = await pedir(puerto, '/api/ai-status');
    if (r.codigo > 0) break;
    if (Date.now() > limite) throw new Error(`El servidor no arrancó en 20 s:\n${salida}`);
    await new Promise(r2 => setTimeout(r2, 150));
  }
  return {
    puerto,
    parar: () => new Promise(resolve => {
      if (hijo.exitCode != null) return resolve();
      hijo.once('exit', () => resolve());
      hijo.kill();
      setTimeout(() => { try { hijo.kill('SIGKILL'); } catch (_) {} resolve(); }, 3000);
    }),
    log: () => salida,
  };
}

/* ─── Lo que nunca debe salir en un cuerpo de respuesta ────────── */

const MARCAS_PROHIBIDAS = [
  [SECRETO, 'datos de usuario'],
  ['createServer', 'código de server.cjs'],
  ['repositoryformatversion', 'configuración de git'],
  ['root:x:', '/etc/passwd'],
  ['devDependencies', 'package.json'],
  ['[fonts]', 'win.ini'],
];

function assertSinFugas(ruta, r) {
  for (const [marca, que] of MARCAS_PROHIBIDAS) {
    assert.ok(
      !r.cuerpo.includes(marca),
      `${ruta} devolvió ${r.codigo} y el cuerpo contiene ${que} («${marca}»). Cuerpo: ${r.cuerpo.slice(0, 200)}`,
    );
  }
}

/* ─── Rutas que deben quedar denegadas ────────────────────────── */

const DENEGADAS = [
  // Datos de usuario y de sync: lo más grave que hay en el proyecto.
  '/data/users/zz-test-uid.json',
  '/data/',
  '/data/sync/zzzztest.json',
  // Mayúsculas: Windows no distingue, así que una denylist que sí distinga
  // se esquiva cambiando la caja.
  '/DATA/users/zz-test-uid.json',
  // Barra codificada: si se decodifica después de comprobar, pasa.
  '/data%2Fusers%2Fzz-test-uid.json',
  // Código y configuración del servidor.
  '/server.cjs',
  '/SERVER.CJS',
  '/package.json',
  '/package-lock.json',
  '/vite.config.js',
  '/vercel.json',
  '/Iniciar%20Finova.bat',
  // Ficheros ocultos.
  '/.git/config',
  '/.git/HEAD',
  '/.env',
  '/.env.production',
  '/.env.development',
  '/.env.local',
  // Dependencias y tests.
  '/node_modules/firebase-admin/package.json',
  '/src/tests/calc.test.js',
  // Salidas de directorio, en todas las formas que se usan de verdad.
  '/src/../server.cjs',
  '//server.cjs',
  '/../../../../etc/passwd',
  '/%2e%2e/%2e%2e/etc/passwd',
  '/..%2f..%2fetc/passwd',
  // Doble codificación: debe quedar denegada, no decodificarse dos veces.
  '/%252e%252e/%252e%252e/etc/passwd',
  // Rutas de Windows: barra invertida, letra de unidad y flujo NTFS.
  '/..%5c..%5cwindows/win.ini',
  '/C:/Windows/win.ini',
  '/index.html::$DATA',
  // Byte nulo: truncaba la ruta en implementaciones antiguas.
  '/index.html%00.js',
  // Documentación interna.
  '/AUDIT_PROGRESS.md',
  '/SECURITY.md',
  '/README.md',
];

const PERMITIDAS = [
  '/',
  '/index.html',
  '/style.css',
  '/src/core/state.js',
  '/manifest.json',
  '/sw.js',
  '/icon-192.png',
];

/* ═══ Desarrollo ═══════════════════════════════════════════════ */

describe('Ficheros estáticos — modo desarrollo', () => {
  let srv;
  before(async () => {
    crearCebos();
    srv = await arrancar({});
  });
  after(async () => {
    if (srv) await srv.parar();
    borrarCebos();
  });

  for (const ruta of DENEGADAS) {
    test(`deniega ${ruta}`, async () => {
      const r = await pedir(srv.puerto, ruta);
      assert.ok(
        r.codigo === 404 || r.codigo === 400,
        `${ruta} devolvió ${r.codigo}, se esperaba 404 o 400`,
      );
      assertSinFugas(ruta, r);
    });
  }

  for (const ruta of PERMITIDAS) {
    test(`sirve ${ruta}`, async () => {
      const r = await pedir(srv.puerto, ruta);
      assert.equal(r.codigo, 200, `${ruta} devolvió ${r.codigo}`);
      assert.ok(r.cuerpo.length > 0, `${ruta} devolvió un cuerpo vacío`);
    });
  }

  test('un fichero denegado y uno inexistente son indistinguibles', () => {
    // Un 403 o un mensaje distinto le confirmarían a quien escanea que el
    // fichero existe, que es la mitad de la información que busca.
    return Promise.all([
      pedir(srv.puerto, '/server.cjs'),
      pedir(srv.puerto, '/no-existe-en-absoluto-12345.html'),
    ]).then(([denegado, inexistente]) => {
      assert.equal(denegado.codigo, inexistente.codigo);
      assert.equal(denegado.cuerpo, inexistente.cuerpo);
    });
  });

  test('solo GET y HEAD sirven contenido', async () => {
    // Antes cualquier método devolvía el fichero completo con 200.
    for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await pedir(srv.puerto, '/index.html', metodo);
      assert.equal(r.codigo, 404, `${metodo} /index.html devolvió ${r.codigo}`);
    }
  });

  test('HEAD responde sin cuerpo', async () => {
    const r = await pedir(srv.puerto, '/index.html', 'HEAD');
    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.length, 0, 'HEAD devolvió un cuerpo');
    assert.ok(r.headers['content-length'], 'HEAD no declaró Content-Length');
  });

  test('no se listan directorios', async () => {
    for (const ruta of ['/src/', '/src', '/data', '/icons/']) {
      const r = await pedir(srv.puerto, ruta);
      assert.ok(r.codigo === 404 || r.codigo === 400, `${ruta} devolvió ${r.codigo}`);
    }
  });

  test('se mantiene la redirección 127.0.0.1 → localhost', async () => {
    // Firebase Auth solo acepta «localhost» en desarrollo, así que esta
    // redirección es funcionalidad, no un detalle.
    const r = await new Promise(resolve => {
      const req = http.request({
        host: '127.0.0.1', port: srv.puerto, path: '/', method: 'GET',
        headers: { Host: `127.0.0.1:${srv.puerto}` },
      }, res => {
        res.resume();
        res.on('end', () => resolve({ codigo: res.statusCode, location: res.headers.location }));
      });
      req.on('error', () => resolve({ codigo: 0 }));
      req.end();
    });
    assert.equal(r.codigo, 301);
    assert.equal(r.location, `http://localhost:${srv.puerto}/`);
  });

  test('la API sigue respondiendo igual', async () => {
    const r = await pedir(srv.puerto, '/api/ai-status');
    assert.equal(r.codigo, 200);
    assert.doesNotThrow(() => JSON.parse(r.cuerpo), 'la respuesta no era JSON');
  });

  test('una ruta /api/* desconocida sigue dando el 404 de la API', async () => {
    const r = await pedir(srv.puerto, '/api/no-existe');
    assert.equal(r.codigo, 404);
    assert.deepEqual(JSON.parse(r.cuerpo), { error: 'Not found' });
  });

  test('sync-download exige autenticación y no acepta una ruta como código', async () => {
    // El código entra en una ruta de fichero: si no se validara, «../../»
    // dentro del parámetro saldría del directorio.
    for (const codigo of ['../../server', '..%2f..%2fserver', 'zzzztest']) {
      const r = await pedir(srv.puerto, `/api/sync-download?code=${codigo}`);
      assert.ok(
        r.codigo === 400 || r.codigo === 401 || r.codigo === 403 || r.codigo === 404,
        `code=${codigo} devolvió ${r.codigo}`,
      );
      assertSinFugas(`/api/sync-download?code=${codigo}`, r);
    }
  });
});

/* ═══ Producción ═══════════════════════════════════════════════ */

describe('Ficheros estáticos — modo producción', () => {
  let srv;
  before(async () => {
    crearCebos();
    // En producción el frontend lo sirve Vercel: este proceso solo expone
    // /api/*. ALLOWED_ORIGIN es obligatoria ahí y sin ella el servidor se
    // niega a arrancar, que es el comportamiento correcto.
    srv = await arrancar({ NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://finova.test' });
  });
  after(async () => {
    if (srv) await srv.parar();
    borrarCebos();
  });

  test('no se sirve ningún estático', async () => {
    for (const ruta of ['/', '/index.html', '/style.css', '/src/core/state.js', '/manifest.json']) {
      const r = await pedir(srv.puerto, ruta);
      assert.equal(r.codigo, 404, `${ruta} devolvió ${r.codigo} en producción`);
      assert.deepEqual(JSON.parse(r.cuerpo), { error: 'Not found' });
    }
  });

  test('pero la API pública sigue funcionando', async () => {
    const r = await pedir(srv.puerto, '/api/ai-status');
    assert.equal(r.codigo, 200);
    assert.doesNotThrow(() => JSON.parse(r.cuerpo));
  });

  test('y las rutas sensibles siguen denegadas', async () => {
    for (const ruta of ['/data/users/zz-test-uid.json', '/server.cjs', '/.env.production']) {
      const r = await pedir(srv.puerto, ruta);
      assert.equal(r.codigo, 404);
      assertSinFugas(ruta, r);
    }
  });
});

/* ═══ SERVE_STATIC explícito ═══════════════════════════════════ */

describe('SERVE_STATIC se puede forzar', () => {
  let srv;
  before(async () => { srv = await arrancar({ SERVE_STATIC: 'false' }); });
  after(async () => { if (srv) await srv.parar(); });

  test('SERVE_STATIC=false apaga los estáticos aunque no sea producción', async () => {
    const r = await pedir(srv.puerto, '/index.html');
    assert.equal(r.codigo, 404);
    const api = await pedir(srv.puerto, '/api/ai-status');
    assert.equal(api.codigo, 200);
  });
});
