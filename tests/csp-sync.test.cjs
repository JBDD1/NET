'use strict';

/* ═══════════════════════════════════════════════════════════════
   Finova — la CSP de server.cjs y la de vercel.json no pueden divergir.

   Fuente única: csp.config.cjs → buildCSP(). Este test falla si:
     1. vercel.json deja de coincidir con buildCSP() (alguien editó uno sin
        regenerar el otro → `node scripts/generate-vercel-csp.cjs`).
     2. La cabecera Content-Security-Policy que SIRVE server.cjs de verdad deja
        de coincidir con buildCSP().
   Como los dos se comparan contra la misma fuente, tampoco pueden divergir
   entre sí.
═══════════════════════════════════════════════════════════════ */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.cjs');
const { buildCSP } = require(path.join(ROOT, 'csp.config.cjs'));

function cspDeVercel() {
  const v = require(path.join(ROOT, 'vercel.json'));
  for (const regla of v.headers || []) {
    for (const h of regla.headers || []) {
      if (h.key === 'Content-Security-Policy') return h.value;
    }
  }
  return null;
}

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function pedir(puerto, ruta) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: puerto, method: 'GET', path: ruta,
      // Host: localhost evita el 301 a localhost que el server hace en dev.
      headers: { Host: `localhost:${puerto}` },
    }, res => {
      res.resume();
      resolve({ codigo: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
    req.end();
  });
}

let srv;

before(async () => {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(puerto),
      NODE_ENV: 'test',          // no-producción → se sirven los estáticos (con CSP)
      FINOVA_NO_OPEN: '1',
      FINOVA_ENC_KEY: require('node:crypto').randomBytes(32).toString('hex'),
      ALLOW_NO_REVOCATION_CHECK: 'true',
      // Sin SENTRY_INGEST_ORIGIN ni ANALYTICS_ORIGIN: la CSP servida debe ser
      // la canónica (buildCSP() sin opciones), idéntica a la de vercel.json.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', d => salida += d);
  hijo.stderr.on('data', d => salida += d);

  const limite = Date.now() + 20000;
  for (;;) {
    if (hijo.exitCode != null) throw new Error(`El servidor salió con código ${hijo.exitCode}:\n${salida}`);
    try { const r = await pedir(puerto, '/api/health'); if (r.codigo > 0) break; } catch (_) {}
    if (Date.now() > limite) throw new Error(`El servidor no arrancó en 20 s:\n${salida}`);
    await new Promise(r => setTimeout(r, 150));
  }
  srv = {
    puerto,
    parar: () => new Promise(resolve => {
      if (hijo.exitCode != null) return resolve();
      hijo.once('exit', () => resolve());
      hijo.kill();
      setTimeout(() => { try { hijo.kill('SIGKILL'); } catch (_) {} resolve(); }, 3000);
    }),
  };
});

after(async () => { if (srv) await srv.parar(); });

test('vercel.json coincide EXACTAMENTE con csp.config.cjs (buildCSP)', () => {
  const vercel = cspDeVercel();
  assert.ok(vercel, 'vercel.json debe tener una cabecera Content-Security-Policy');
  assert.equal(vercel, buildCSP(),
    'vercel.json ha divergido de csp.config.cjs. Regenera: node scripts/generate-vercel-csp.cjs');
});

test('la cabecera CSP que SIRVE server.cjs coincide con buildCSP()', async () => {
  const r = await pedir(srv.puerto, '/index.html');
  const servida = r.headers['content-security-policy'];
  assert.ok(servida, 'server.cjs debe servir una cabecera Content-Security-Policy en las respuestas HTML');
  assert.equal(servida, buildCSP(),
    'la CSP servida por server.cjs ha divergido de csp.config.cjs');
});

test('server.cjs y vercel.json sirven la MISMA CSP (no pueden divergir)', () => {
  // Transitividad explícita: si los dos tests anteriores pasan, estos dos
  // valores son iguales. Se comprueba directamente para que el fallo sea claro.
  assert.equal(cspDeVercel(), buildCSP());
});
