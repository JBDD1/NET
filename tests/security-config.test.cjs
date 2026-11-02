'use strict';

/**
 * Finova — security-config.test.cjs
 *
 * Comprueba que ninguna configuración degrada la seguridad en silencio.
 *
 * La idea que gobierna el fichero: un servidor mal configurado tiene que
 * NEGARSE a arrancar, no arrancar peor. Los fallos silenciosos son los que
 * sobreviven años, porque nada los delata.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.cjs');
const MIGRAR = path.join(ROOT, 'scripts', 'encrypt-existing-data.cjs');

const claveValida = () => crypto.randomBytes(32).toString('hex');

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
function dirTemporal(pref) { return fs.mkdtempSync(path.join(os.tmpdir(), pref || 'finova-sec-')); }
function borrar(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

function pedir(puerto, ruta, op = {}) {
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1', port: puerto, method: op.metodo || 'GET', path: ruta,
      headers: Object.assign({ Host: `localhost:${puerto}` }, op.headers || {}),
    }, res => {
      const t = [];
      res.on('data', c => t.push(c));
      res.on('end', () => resolve({ codigo: res.statusCode, cuerpo: Buffer.concat(t).toString('utf8'), headers: res.headers }));
    });
    req.on('error', e => resolve({ codigo: 0, cuerpo: '', error: e.message }));
    if (op.cuerpo) req.write(op.cuerpo);
    req.end();
  });
}

/** Arranca y devuelve { codigo, salida }. No espera a que esté listo. */
async function arrancarYEsperarSalida(env, dataDir, ms = 15000) {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(puerto), DATA_DIR: dataDir, OPEN_BROWSER: 'false',
      NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://finova.test',
    }, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', d => { salida += d.toString(); });
  hijo.stderr.on('data', d => { salida += d.toString(); });
  const codigo = await new Promise(r => {
    let hecho = false;
    hijo.once('exit', c => { hecho = true; r(c); });
    setTimeout(() => {
      if (hecho) return;
      try { hijo.kill('SIGKILL'); } catch (_) {}
      r('VIVO');
    }, ms);
  });
  return { codigo, salida, puerto };
}

/** Arranca y espera a que responda. Para los casos que SÍ deben arrancar. */
async function arrancarListo(env, dataDir) {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(puerto), DATA_DIR: dataDir, OPEN_BROWSER: 'false',
    }, env),
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
    if (Date.now() > limite) throw new Error(`no arrancó:\n${salida}`);
    await new Promise(r2 => setTimeout(r2, 150));
  }
  return {
    puerto, log: () => salida,
    parar: () => new Promise(r => {
      if (hijo.exitCode != null) return r();
      hijo.once('exit', () => r());
      hijo.kill();
      setTimeout(() => { try { hijo.kill('SIGKILL'); } catch (_) {} r(); }, 5000);
    }),
  };
}

/* ═══ 1. Arranque: fallar ruidosamente ════════════════════════ */

describe('Arranque — una mala configuración NO arranca', () => {
  test('producción sin FINOVA_ENC_KEY: exit 1 y dice cómo generarla', async () => {
    // El fallo que esto cierra: _encryptUserData devolvía el texto en claro
    // y los datos financieros de todos los usuarios se guardaban sin cifrar,
    // sin una sola línea en los logs.
    const D = dirTemporal();
    const r = await arrancarYEsperarSalida({ FINOVA_ENC_KEY: '' }, D);
    borrar(D);
    assert.equal(r.codigo, 1, `arrancó (${r.codigo})`);
    assert.match(r.salida, /FINOVA_ENC_KEY/);
    assert.match(r.salida, /randomBytes\(32\)/);
    assert.match(r.salida, /EN CLARO/);
  });

  test('producción con FINOVA_ENC_KEY malformada: exit 1', async () => {
    const D = dirTemporal();
    for (const mala of ['abc123', 'z'.repeat(64), crypto.randomBytes(16).toString('hex')]) {
      const r = await arrancarYEsperarSalida({ FINOVA_ENC_KEY: mala }, D);
      assert.equal(r.codigo, 1, `«${mala.slice(0, 8)}…» arrancó`);
      assert.match(r.salida, /64 caracteres hexadecimales/);
    }
    borrar(D);
  });

  test('ALLOW_PLAINTEXT_DATA=true es una válvula explícita y avisa', async () => {
    const D = dirTemporal();
    const r = await arrancarYEsperarSalida({
      FINOVA_ENC_KEY: '', ALLOW_PLAINTEXT_DATA: 'true', ALLOW_NO_REVOCATION_CHECK: 'true',
    }, D);
    borrar(D);
    assert.equal(r.codigo, 'VIVO', `no arrancó (${r.codigo})`);
    assert.match(r.salida, /DATOS DE USUARIO SIN CIFRAR/);
  });

  test('producción sin Admin SDK: exit 1 (no hay comprobación de revocación)', async () => {
    // Es la degradación más sutil: _requireAuth cae a la ruta JWKS, que
    // valida la firma pero NO comprueba revocación. Un usuario expulsado
    // sigue entrando hasta que su token caduque, hasta una hora.
    const D = dirTemporal();
    const r = await arrancarYEsperarSalida({ FINOVA_ENC_KEY: claveValida() }, D);
    borrar(D);
    assert.equal(r.codigo, 1, `arrancó (${r.codigo})`);
    assert.match(r.salida, /revocaci/i);
    assert.match(r.salida, /FIREBASE_PROJECT_ID/);
  });

  test('ALLOW_NO_REVOCATION_CHECK=true arranca, pero avisando', async () => {
    const D = dirTemporal();
    const r = await arrancarYEsperarSalida({
      FINOVA_ENC_KEY: claveValida(), ALLOW_NO_REVOCATION_CHECK: 'true',
    }, D);
    borrar(D);
    assert.equal(r.codigo, 'VIVO');
    assert.match(r.salida, /NO se comprueba la revocación/);
  });

  test('producción con FINOVA_DISABLE_AUTH=true: exit 1', async () => {
    // Con la autenticación apagada, _requireAuth devuelve 'dev-uid' y
    // handleUserDataGet acepta el uid por la URL: cualquiera lee los datos
    // de cualquiera cambiando un parámetro.
    const D = dirTemporal();
    const r = await arrancarYEsperarSalida({
      FINOVA_ENC_KEY: claveValida(), ALLOW_NO_REVOCATION_CHECK: 'true',
      FINOVA_DISABLE_AUTH: 'true',
    }, D);
    borrar(D);
    assert.equal(r.codigo, 1, `arrancó (${r.codigo})`);
    // El mensaje puede venir de _validateEnv (que ya lo trata como fatal) o
    // de la puerta nueva: cualquiera sirve. Lo que importa es que NO arranque.
    assert.match(r.salida, /FINOVA_DISABLE_AUTH=true/);
  });

  test('con todo bien configurado, arranca', async () => {
    const D = dirTemporal();
    const r = await arrancarYEsperarSalida({
      FINOVA_ENC_KEY: claveValida(), ALLOW_NO_REVOCATION_CHECK: 'true',
    }, D);
    borrar(D);
    assert.equal(r.codigo, 'VIVO');
    assert.ok(!/SIN CIFRAR/.test(r.salida), 'avisa de texto en claro teniendo clave');
  });

  test('en desarrollo sin clave arranca, pero con el aviso', async () => {
    // No se puede exigir la clave en local: rompería el flujo de desarrollo.
    // Pero el aviso tiene que salir en cada arranque.
    const D = dirTemporal();
    const s = await arrancarListo({ FINOVA_ENC_KEY: '' }, D);
    try {
      assert.match(s.log(), /DATOS DE USUARIO SIN CIFRAR/);
    } finally { await s.parar(); borrar(D); }
  });
});

/* ═══ 2. Cifrado de ida y vuelta ══════════════════════════════ */

describe('Cifrado en reposo', () => {
  /* Se reimplementa el formato para probarlo sin arrancar el servidor. Si el
     formato de server.cjs cambiara, la prueba de ida y vuelta del propio
     servidor (en _validarCifrado) lo detectaría al arrancar. */
  const cifrar = (txt, k) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', k, iv);
    const e = Buffer.concat([c.update(txt, 'utf8'), c.final()]);
    return 'enc1:' + Buffer.concat([iv, c.getAuthTag(), e]).toString('base64');
  };
  const descifrar = (d, k) => {
    const b = Buffer.from(d.slice(5), 'base64');
    const x = crypto.createDecipheriv('aes-256-gcm', k, b.slice(0, 12));
    x.setAuthTag(b.slice(12, 28));
    return x.update(b.slice(28)) + x.final('utf8');
  };

  test('ida y vuelta con la misma clave', () => {
    const k = crypto.randomBytes(32);
    const original = JSON.stringify({ transactions: [{ amount: 1234.56, desc: 'FALSO' }] });
    assert.equal(descifrar(cifrar(original, k), k), original);
  });

  test('el formato «enc1:» no cambia', () => {
    // Es un contrato: los ficheros ya guardados empiezan por ese prefijo.
    assert.ok(cifrar('x', crypto.randomBytes(32)).startsWith('enc1:'));
  });

  test('con la clave equivocada falla, no devuelve basura', () => {
    // AES-GCM verifica la etiqueta de autenticación: no hay descifrado
    // parcial ni silencioso.
    const cifrado = cifrar('secreto', crypto.randomBytes(32));
    assert.throws(() => descifrar(cifrado, crypto.randomBytes(32)));
  });

  test('un fichero antiguo SIN cifrar se sigue leyendo', () => {
    // La rama de compatibilidad es deliberada: quitarla dejaría ilegibles
    // los datos de quien se registró antes del cifrado.
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /if \(typeof data !== 'string' \|\| !data\.startsWith\('enc1:'\)\) return data;/);
  });

  test('_encryptUserData NUNCA devuelve el texto en claro sin válvula', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    const i = src.indexOf('function _encryptUserData');
    const trozo = src.slice(i, i + 600);
    // Antes era: if (!_ENC_KEY) return plaintext;
    assert.ok(!/if \(!_ENC_KEY\) return plaintext;/.test(trozo), 'sigue devolviendo el texto en claro');
    assert.match(trozo, /ALLOW_PLAINTEXT_DATA/);
    assert.match(trozo, /throw/);
  });

  test('_decryptUserData distingue los tres casos', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    const i = src.indexOf('function _decryptUserData');
    const trozo = src.slice(i, i + 1600);
    assert.match(trozo, /enc\/missing-key/);   // cifrado y sin clave
    assert.match(trozo, /enc\/wrong-key/);     // cifrado y clave mala
    assert.match(trozo, /return data;/);       // no cifrado
  });
});

/* ═══ 3. Script de migración ══════════════════════════════════ */

describe('Script de migración', () => {
  function prepararDatos() {
    const D = dirTemporal('finova-mig-');
    fs.mkdirSync(path.join(D, 'users'), { recursive: true });
    // Datos FALSOS.
    fs.writeFileSync(path.join(D, 'users', 'a'.repeat(20) + '.json'), JSON.stringify({ t: [{ a: 1, d: 'FALSO-1' }] }), 'utf8');
    fs.writeFileSync(path.join(D, 'users', 'b'.repeat(20) + '.json'), JSON.stringify({ t: [{ a: 2, d: 'FALSO-2' }] }), 'utf8');
    return D;
  }
  const correr = (args, env) => {
    try {
      return { ok: true, salida: execFileSync(process.execPath, [MIGRAR, ...args], {
        cwd: ROOT, encoding: 'utf8',
        env: Object.assign({}, process.env, env),
      }) };
    } catch (e) {
      return { ok: false, salida: (e.stdout || '') + (e.stderr || '') };
    }
  };

  test('en seco solo informa y no toca nada', () => {
    const D = prepararDatos();
    const k = claveValida();
    const antes = fs.readFileSync(path.join(D, 'users', 'a'.repeat(20) + '.json'), 'utf8');
    const r = correr([], { DATA_DIR: D, FINOVA_ENC_KEY: k });
    const despues = fs.readFileSync(path.join(D, 'users', 'a'.repeat(20) + '.json'), 'utf8');
    borrar(D);
    assert.ok(r.ok, r.salida);
    assert.match(r.salida, /EN CLARO:\s+2/);
    assert.equal(despues, antes, 'ha modificado un fichero en modo informe');
  });

  test('--apply sin --backup se niega', () => {
    const D = prepararDatos();
    const r = correr(['--apply'], { DATA_DIR: D, FINOVA_ENC_KEY: claveValida() });
    borrar(D);
    assert.ok(!r.ok);
    assert.match(r.salida, /exige --backup/);
  });

  test('--apply cifra, verifica y deja copia', () => {
    const D = prepararDatos();
    const B = D + '-copia';
    const k = claveValida();
    const originales = fs.readdirSync(path.join(D, 'users'))
      .map(n => [n, fs.readFileSync(path.join(D, 'users', n), 'utf8')]);
    const r = correr(['--apply', '--backup', B], { DATA_DIR: D, FINOVA_ENC_KEY: k });
    assert.ok(r.ok, r.salida);
    assert.match(r.salida, /Cifrados: 2 de 2/);
    // Cifrados en el sitio...
    for (const [n] of originales) {
      const ahora = fs.readFileSync(path.join(D, 'users', n), 'utf8');
      assert.ok(ahora.startsWith('enc1:'), `${n} no quedó cifrado`);
    }
    // ...y la copia tiene los originales intactos.
    for (const [n, contenido] of originales) {
      assert.equal(fs.readFileSync(path.join(B, n), 'utf8'), contenido);
    }
    borrar(D); borrar(B);
  });

  test('es idempotente', () => {
    const D = prepararDatos();
    const B = D + '-copia';
    const k = claveValida();
    correr(['--apply', '--backup', B], { DATA_DIR: D, FINOVA_ENC_KEY: k });
    const r = correr([], { DATA_DIR: D, FINOVA_ENC_KEY: k });
    borrar(D); borrar(B);
    assert.match(r.salida, /EN CLARO:\s+0/);
    assert.match(r.salida, /idempotente/);
  });

  test('con una clave distinta de la que cifró, se para', () => {
    // Seguir cifrando encima destruiría el original.
    const D = prepararDatos();
    const B = D + '-copia';
    correr(['--apply', '--backup', B], { DATA_DIR: D, FINOVA_ENC_KEY: claveValida() });
    const r = correr([], { DATA_DIR: D, FINOVA_ENC_KEY: claveValida() });
    borrar(D); borrar(B);
    assert.match(r.salida, /PARADO/);
    assert.match(r.salida, /OTRA clave/);
  });

  test('sin clave válida no hace nada', () => {
    const D = prepararDatos();
    const r = correr([], { DATA_DIR: D, FINOVA_ENC_KEY: 'corta' });
    borrar(D);
    assert.ok(!r.ok);
    assert.match(r.salida, /64 caracteres hexadecimales/);
  });
});

/* ═══ 4. Errores sin fugas ════════════════════════════════════ */

describe('Errores sin fugas', () => {
  let srv, D;
  before(async () => {
    D = dirTemporal();
    srv = await arrancarListo({ FINOVA_ENC_KEY: claveValida() }, D);
  });
  after(async () => { if (srv) await srv.parar(); borrar(D); });

  /** Nada de esto debe aparecer en un cuerpo de respuesta. */
  const PROHIBIDO = [
    [/\bat\s+[A-Za-z_$][\w$]*\s*\(/, 'una línea de stack («at función(»)'],
    [/[A-Za-z]:\\\\|\/home\/|\/usr\/|__dirname/, 'una ruta del sistema'],
    [/server\.cjs|node_modules|internal\/modules/, 'un nombre de fichero interno'],
    [/\bError:\s/, 'el prefijo «Error:» de una excepción'],
    [/ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|ERR_[A-Z_]+/, 'un código de error de Node'],
  ];
  const assertSinFugas = (ruta, r) => {
    for (const [re, que] of PROHIBIDO) {
      assert.ok(!re.test(r.cuerpo), `${ruta} (${r.codigo}) filtra ${que}: ${r.cuerpo.slice(0, 160)}`);
    }
  };

  test('JSON mal formado', async () => {
    for (const malo of ['{roto', '', 'null', '[]', '{"a":']) {
      const r = await pedir(srv.puerto, '/api/waitlist', {
        metodo: 'POST', cuerpo: malo, headers: { 'Content-Type': 'application/json' },
      });
      assert.ok(r.codigo >= 400 && r.codigo < 500, `${JSON.stringify(malo)} dio ${r.codigo}`);
      assertSinFugas('/api/waitlist ' + JSON.stringify(malo), r);
    }
  });

  test('token falso', async () => {
    for (const t of ['Bearer basura', 'Bearer a.b.c', 'nada', 'Bearer ' + 'x'.repeat(500)]) {
      const r = await pedir(srv.puerto, '/api/user-data', { headers: { Authorization: t } });
      assertSinFugas('/api/user-data con ' + t.slice(0, 20), r);
    }
  });

  test('uid inválido', async () => {
    for (const u of ['../../etc', 'a', 'x'.repeat(500), '<script>']) {
      const r = await pedir(srv.puerto, '/api/user-data?uid=' + encodeURIComponent(u));
      assertSinFugas('/api/user-data?uid=' + u.slice(0, 12), r);
    }
  });

  test('ruta de API inexistente', async () => {
    const r = await pedir(srv.puerto, '/api/no-existe-12345');
    assert.equal(r.codigo, 404);
    assert.deepEqual(JSON.parse(r.cuerpo), { error: 'Not found' });
  });

  test('cuerpo demasiado grande', async () => {
    const r = await pedir(srv.puerto, '/api/waitlist', {
      metodo: 'POST',
      cuerpo: JSON.stringify({ email: 'a@b.c', relleno: 'x'.repeat(200000) }),
      headers: { 'Content-Type': 'application/json' },
    });
    assert.ok(r.codigo === 413 || r.codigo === 400 || r.codigo === 429, `dio ${r.codigo}`);
    assertSinFugas('cuerpo grande', r);
  });
});

/* ═══ 5. Regresión: que no vuelva la fuga ═════════════════════ */

describe('Regresión — ninguna excepción llega al cliente', () => {
  test('no hay res.end con e.message, err.message ni .stack', () => {
    // Es la prueba que pide el encargo, y la que impide que esto vuelva.
    // El patrón es fácil de reintroducir sin pensarlo, y el efecto es que el
    // mensaje de un fs o de una librería —con rutas del servidor dentro—
    // sale en la respuesta HTTP.
    const src = fs.readFileSync(SERVER, 'utf8');
    const malos = [];
    const lineas = src.split('\n');
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      // Los comentarios no cuentan: documentan lo que ya NO se hace.
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
      if (/res\.end\s*\([^)]*\b(e|err|error|ex)\s*\.\s*(message|stack)/.test(l)) {
        malos.push(`${i + 1}: ${l.trim().slice(0, 100)}`);
      }
      if (/res\.end\s*\([^)]*\.stack\b/.test(l)) {
        malos.push(`${i + 1}: ${l.trim().slice(0, 100)}`);
      }
    }
    assert.deepEqual(malos, [], 'vuelven a filtrarse excepciones al cliente:\n  ' + malos.join('\n  '));
  });

  test('tampoco en un JSON.stringify que se envíe', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    const malos = [];
    const lineas = src.split('\n');
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
      if (/JSON\.stringify\s*\(\s*\{[^}]*\b(e|err|error)\s*\.\s*message/.test(l)) {
        malos.push(`${i + 1}: ${l.trim().slice(0, 100)}`);
      }
    }
    assert.deepEqual(malos, []);
  });

  test('existe _sendError con mensajes públicos fijos', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /function _sendError\(req, res, status, code, err, ctx\)/);
    assert.match(src, /const _ERRORES_PUBLICOS = \{/);
    // El log no debe llevar la query (ahí viaja el uid y el código de sync)
    // ni el uid en claro.
    assert.match(src, /route:\s+String\(req\.url \|\| ''\)\.split\('\?'\)\[0\]/);
    assert.match(src, /uid:\s+_hashUid\(req\.uid\)/);
  });
});

/* ═══ 6. Límites y bloqueo ════════════════════════════════════ */

describe('Límites por IP y cuentas suspendidas', () => {
  test('todos los endpoints autenticados tienen límite por IP', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    const handlers = [
      'handleAIProxy', 'handleUserDataGet', 'handleUserDataPost', 'handleUserMeta',
      'handleSyncUpload', 'handleSyncDownload', 'handleAccountDelete', 'handleFeedback',
      'handleBankInstitutions', 'handleBankCreateRequisition', 'handleBankGetRequisition',
      'handleBankImport',
    ];
    const sinLimite = [];
    for (const h of handlers) {
      const i = src.indexOf(`async function ${h}(`);
      if (i < 0) continue;
      // Los 40 primeros renglones del handler: el límite va al principio.
      const cuerpo = src.slice(i, i + 2600);
      if (!/_checkRateLimit\(req, res, '/.test(cuerpo)) sinLimite.push(h);
    }
    assert.deepEqual(sinLimite, [], 'sin límite por IP: ' + sinLimite.join(', '));
  });

  test('los 429 llevan Retry-After', async () => {
    const D = dirTemporal();
    const s = await arrancarListo({ FINOVA_ENC_KEY: claveValida() }, D);
    try {
      let r;
      // waitlist: 5 por IP. Al sexto debe haber 429.
      for (let i = 0; i < 9; i++) {
        r = await pedir(s.puerto, '/api/waitlist', {
          metodo: 'POST', cuerpo: JSON.stringify({ email: 'a@b.c' }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (r.codigo === 429) break;
      }
      assert.equal(r.codigo, 429, 'nunca llegó el 429');
      assert.ok(r.headers['retry-after'], 'el 429 no lleva Retry-After');
    } finally { await s.parar(); borrar(D); }
  });

  test('el bloqueo de cuenta está en _requireAuth, no handler a handler', () => {
    // Estaba en 2 de 10 endpoints autenticados: un usuario suspendido podía
    // guardar datos, subir y bajar backups, mandar feedback e importar banca.
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /function _rechazarSiBloqueado\(req, res, uid\)/);
    const i = src.indexOf('async function _requireAuth(');
    const cuerpo = src.slice(i, i + 3000);
    assert.ok(/_rechazarSiBloqueado\(req, res, decoded\.uid\)/.test(cuerpo), 'falta en la ruta del Admin SDK');
    assert.ok(/_rechazarSiBloqueado\(req, res, payload\.sub\)/.test(cuerpo), 'falta en la ruta JWKS');
  });

  test('el borrado de cuenta está exento del bloqueo (RGPD)', () => {
    // El derecho de supresión no se pierde por estar sancionado: negarlo
    // convertiría una suspensión en retención indefinida de datos.
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /_EXENTOS_DE_BLOQUEO = \['\/api\/account\/delete'\]/);
  });

  test('la IA tiene tope global, de contexto y de salida', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /AI_DAILY_LIMIT_GLOBAL/);
    assert.match(src, /AI_MAX_CONTEXT_CHARS/);
    assert.match(src, /AI_MAX_OUTPUT_TOKENS/);
    // Y el tope global se aplica DENTRO del handler, después de la auth.
    const i = src.indexOf('async function handleAIProxy(');
    assert.ok(/_aiGlobalOk\(\)/.test(src.slice(i, i + 3000)), 'el tope global no se aplica');
    // max_tokens ya no es una constante.
    assert.ok(!/max_tokens:\s*1024/.test(src), 'max_tokens sigue fijo a 1024');
  });

  test('un usuario no autenticado nunca llega al proveedor de IA', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    const i = src.indexOf('async function handleAIProxy(');
    const cuerpo = src.slice(i, i + 4000);
    // El orden importa: auth, bloqueo, correo verificado, tope global, cuota.
    const pAuth = cuerpo.indexOf('_requireAuth');
    const pCorreo = cuerpo.indexOf('_requireVerifiedEmail');
    const pGlobal = cuerpo.indexOf('_aiGlobalOk');
    assert.ok(pAuth >= 0 && pCorreo > pAuth, 'la verificación de correo no va después de la auth');
    assert.ok(pGlobal > pCorreo, 'el tope global no va después de las puertas de seguridad');
  });
});
