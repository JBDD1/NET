'use strict';

/* ═══════════════════════════════════════════════════════════════
   Finova — los backups de SYNC se cifran en reposo IGUAL que los
   datos de usuario normales.

   Regresión: `handleSyncUpload` escribía `data` en claro con
   `_writeFileAtomic(destinoSync, data)` en vez de pasarlo por
   `_encryptUserData`, a diferencia de /api/user-data. Este test arranca
   el servidor de verdad, sube un backup con un marcador reconocible, y
   comprueba que en el DISCO no aparece en claro (y que la descarga lo
   devuelve intacto). Si alguien vuelve a escribirlo sin cifrar, falla.
═══════════════════════════════════════════════════════════════ */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.cjs');

const CODE = 'abcdef123456';                 // 12 hex, cumple _SYNC_CODE_RE
const MARCA = 'TEST-CIFRADO-SYNC-98765';     // texto reconocible dentro del backup
const PAYLOAD = JSON.stringify({ transactions: [{ desc: MARCA, amount: 4242.42 }] });

let srv;      // { puerto, parar(), dataDir }
let tmpDir;

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function pedir(puerto, metodo, ruta, cuerpo) {
  return new Promise((resolve, reject) => {
    const data = cuerpo != null ? Buffer.from(cuerpo) : null;
    const req = http.request({
      host: '127.0.0.1', port: puerto, method: metodo, path: ruta,
      // Host: localhost para no recibir el 301 de 127.0.0.1 → localhost que el
      // servidor hace en desarrollo (necesario para Firebase Auth).
      headers: Object.assign({ Host: `localhost:${puerto}` },
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
    }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ codigo: res.statusCode, cuerpo: b }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finova-sync-enc-'));
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(puerto),
      NODE_ENV: 'test',
      FINOVA_NO_OPEN: '1',
      DATA_DIR: tmpDir,
      FINOVA_ENC_KEY: crypto.randomBytes(32).toString('hex'),
      // Sin auth: así se puede subir sin un token real de Firebase.
      FINOVA_DISABLE_AUTH: 'true',
      ALLOW_NO_REVOCATION_CHECK: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', d => salida += d);
  hijo.stderr.on('data', d => salida += d);

  const limite = Date.now() + 20000;
  for (;;) {
    if (hijo.exitCode != null) throw new Error(`El servidor salió con código ${hijo.exitCode}:\n${salida}`);
    try { const r = await pedir(puerto, 'GET', '/api/health'); if (r.codigo > 0) break; } catch (_) {}
    if (Date.now() > limite) throw new Error(`El servidor no arrancó en 20 s:\n${salida}`);
    await new Promise(r => setTimeout(r, 150));
  }
  srv = {
    puerto, dataDir: tmpDir,
    parar: () => new Promise(resolve => {
      if (hijo.exitCode != null) return resolve();
      hijo.once('exit', () => resolve());
      hijo.kill();
      setTimeout(() => { try { hijo.kill('SIGKILL'); } catch (_) {} resolve(); }, 3000);
    }),
  };
});

after(async () => {
  if (srv) await srv.parar();
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }
});

test('el backup de sync NO se escribe en claro en disco', async () => {
  const r = await pedir(srv.puerto, 'POST', '/api/sync-upload', JSON.stringify({ code: CODE, data: PAYLOAD }));
  assert.equal(r.codigo, 200, 'la subida debe responder 200: ' + r.cuerpo);

  const fichero = path.join(srv.dataDir, 'sync', `${CODE}.json`);
  assert.ok(fs.existsSync(fichero), 'el backup debe existir en disco');
  const enDisco = fs.readFileSync(fichero, 'utf8');

  // Lo que importa: el contenido financiero NO puede leerse en claro.
  assert.ok(!enDisco.includes(MARCA),
    'FUGA: el marcador aparece EN CLARO en el backup de sync del disco');
  // Y debe estar cifrado con el mismo envoltorio que los datos de usuario.
  assert.ok(enDisco.startsWith('enc1:'),
    'el backup de sync debe estar cifrado (envoltorio enc1:), igual que user-data');
  // No debe ser JSON plano parseable (señal de texto en claro).
  assert.throws(() => JSON.parse(enDisco),
    'el backup en disco no debe ser JSON plano legible');
});

test('la descarga descifra y devuelve el backup intacto (round-trip)', async () => {
  const d = await pedir(srv.puerto, 'GET', `/api/sync-download?code=${CODE}`);
  assert.equal(d.codigo, 200, 'la descarga debe responder 200: ' + d.cuerpo);
  const devuelto = JSON.parse(d.cuerpo).data;
  assert.equal(devuelto, PAYLOAD, 'la descarga debe devolver el payload original descifrado');
});
