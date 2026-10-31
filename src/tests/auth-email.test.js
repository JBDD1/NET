/**
 * Finova — auth-email.test.js
 * Verificación de correo y recuperación de contraseña.
 *
 * Se carga el auth-shared.js REAL (el que cargan index.html y landing.html) y
 * se comprueba lo que de verdad importa aquí, que es seguridad, no cosmética:
 *   · que ningún mensaje revele si una cuenta existe,
 *   · que la política de contraseñas sea UNA sola,
 *   · que el servidor exija email_verified donde debe.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SHARED = fs.readFileSync(path.join(process.cwd(), 'src/auth/auth-shared.js'), 'utf8');
const AUTH   = fs.readFileSync(path.join(process.cwd(), 'src/auth/auth.js'), 'utf8');
const LAND   = fs.readFileSync(path.join(process.cwd(), 'landing.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(process.cwd(), 'server.cjs'), 'utf8');

/** Igual que hace vite.config.js con los scripts clásicos. */
const strip = (c, appUrl = '') => c
  .replace(/import\.meta\.env\??\.VITE_APP_URL/g, JSON.stringify(appUrl))
  .replace(/import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g, '""')
  .replace(/import\.meta\b/g, 'undefined');

function loadShared({ appUrl = '', origin = 'https://app.finova.es', hostname = 'app.finova.es' } = {}) {
  const ctx = vm.createContext({
    location: { origin, hostname, search: '', pathname: '/index.html' },
    document: { getElementById: () => null },
    setInterval: () => 0, clearInterval: () => {},
  });
  vm.runInContext(strip(SHARED, appUrl), ctx, { filename: 'auth-shared.js' });
  return ctx;
}

const call = (ctx, expr) => vm.runInContext(expr, ctx);

/* ═══════════════════════════════════════════════════════════════ */

describe('Mapa de errores — uno solo para las dos páginas', () => {
  let ctx;
  beforeEach(() => { ctx = loadShared(); });

  // Los códigos que el encargo pedía cubrir, textualmente.
  const EXIGIDOS = [
    'auth/invalid-email', 'auth/invalid-credential', 'auth/wrong-password',
    'auth/user-disabled', 'auth/email-already-in-use', 'auth/weak-password',
    'auth/too-many-requests', 'auth/network-request-failed',
    'auth/requires-recent-login', 'auth/popup-closed-by-user',
    'auth/expired-action-code', 'auth/invalid-action-code',
  ];

  test('los 12 códigos exigidos tienen mensaje propio en español', () => {
    for (const code of EXIGIDOS) {
      const msg = call(ctx, `fvAuthErrMsg(${JSON.stringify(code)})`);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(10);
      // Nada de códigos crudos en los mensajes de los casos conocidos.
      expect(msg).not.toContain('auth/');
    }
  });

  test('ningún mensaje conocido filtra el código al usuario', () => {
    const map = call(ctx, 'JSON.stringify(_FV_AUTH_ERRORS)');
    expect(JSON.parse(map)).toBeTruthy();
    for (const msg of Object.values(JSON.parse(map))) {
      expect(msg).not.toMatch(/auth\//);
    }
  });

  test('un código desconocido no deja al usuario sin salida', () => {
    const msg = call(ctx, "fvAuthErrMsg('auth/vete-a-saber')");
    expect(msg).toMatch(/MyFinova1@gmail\.com/);
    expect(msg).toMatch(/auth\/vete-a-saber/);   // copiable para soporte
  });

  test('sin código tampoco revienta', () => {
    expect(call(ctx, 'fvAuthErrMsg(undefined)')).toMatch(/Inténtalo de nuevo/);
    expect(call(ctx, "fvAuthErrMsg('')")).toMatch(/Inténtalo de nuevo/);
  });

  test('unauthorized-domain menciona el hostname real', () => {
    const c = loadShared({ hostname: '127.0.0.1' });
    const msg = call(c, "fvAuthErrMsg('auth/unauthorized-domain')");
    expect(msg).toContain('127.0.0.1');
    expect(msg).toMatch(/localhost:3000/);   // la pista que resuelve el problema
  });

  test('auth.js y landing.js delegan: ya no hay dos mapas', () => {
    // Lo que se quiere evitar es que vuelvan a divergir, así que se comprueba
    // que ninguno de los dos declare su propia tabla de códigos.
    const authBody = AUTH.slice(AUTH.indexOf('function _authErrMsg'));
    const landBody = LAND.slice(LAND.indexOf('function _lpErrMsg'));
    expect(authBody).toMatch(/return fvAuthErrMsg\(code\)/);
    expect(landBody).toMatch(/return fvAuthErrMsg\(code\)/);
    // 'auth/user-not-found' solo debe aparecer en el fichero compartido.
    expect(AUTH).not.toContain("'auth/user-not-found'");
    expect(LAND).not.toContain("'auth/user-not-found'");
  });
});

describe('No se revela si una cuenta existe', () => {
  let ctx;
  beforeEach(() => { ctx = loadShared(); });

  test('user-not-found y wrong-password dicen EXACTAMENTE lo mismo', () => {
    // Si difieren, probar correos en el login dice quién está registrado.
    const a = call(ctx, "fvAuthErrMsg('auth/user-not-found')");
    const b = call(ctx, "fvAuthErrMsg('auth/wrong-password')");
    const c = call(ctx, "fvAuthErrMsg('auth/invalid-credential')");
    const d = call(ctx, "fvAuthErrMsg('auth/invalid-login-credentials')");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe(d);
  });

  test('y ese mensaje no insinúa que la cuenta no exista', () => {
    const msg = call(ctx, "fvAuthErrMsg('auth/user-not-found')");
    expect(msg).not.toMatch(/no existe|no hay ninguna cuenta|not found/i);
  });

  test('el restablecimiento usa un mensaje condicional, no afirmativo', () => {
    // "Si existe una cuenta…" vale; "Te hemos enviado el correo" no, porque
    // confirmaría que la cuenta está registrada.
    const m1 = AUTH.match(/_RESET_GENERIC_MSG\s*=\s*\n?\s*'([^']+)'/);
    const m2 = LAND.match(/_LP_RESET_MSG\s*=\s*\n?\s*'([^']+)'/);
    expect(m1).toBeTruthy();
    expect(m2).toBeTruthy();
    for (const m of [m1[1], m2[1]]) {
      expect(m).toMatch(/^Si existe una cuenta/);
      expect(m).toMatch(/spam/i);
    }
  });

  test('user-not-found NO se trata aparte en el reset de ninguna de las dos', () => {
    // Solo too-many-requests y network-request-failed pueden distinguirse:
    // no filtran nada y el usuario los necesita para actuar.
    for (const [name, src] of [['auth.js', AUTH], ['landing.js', LAND]]) {
      const raw = name === 'auth.js'
        ? src.slice(src.indexOf('async function _submitPasswordReset'), src.indexOf('async function sendPasswordReset'))
        : src.slice(src.indexOf('async function lpSendReset'), src.indexOf('function _lpErrMsg'));
      // Sin los comentarios: los dos EXPLICAN que user-not-found no se
      // distingue, y la mención en la explicación no es una rama de código.
      const fn = raw.split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n');
      expect(fn.includes('user-not-found')).toBe(false);
      expect(fn).toContain('too-many-requests');
      expect(fn).toContain('network-request-failed');
    }
  });
});

describe('Política de contraseñas — una sola, de 8', () => {
  let ctx;
  beforeEach(() => { ctx = loadShared(); });

  test('el mínimo es 8', () => {
    expect(call(ctx, 'FV_PASSWORD_MIN')).toBe(8);
  });

  test('7 caracteres se rechazan, 8 se aceptan', () => {
    expect(call(ctx, "fvPasswordProblem('1234567')")).toMatch(/8 caracteres/);
    expect(call(ctx, "fvPasswordProblem('12345678')")).toBe(null);
  });

  test('vacía, solo espacios y excesivamente larga se rechazan', () => {
    expect(call(ctx, "fvPasswordProblem('')")).toMatch(/Introduce/);
    expect(call(ctx, "fvPasswordProblem('        ')")).toMatch(/espacios/);
    expect(call(ctx, `fvPasswordProblem('a'.repeat(5000))`)).toMatch(/larga/);
  });

  test('las dos páginas usan la misma función, no su propio número', () => {
    expect(AUTH).toContain('fvPasswordProblem(password)');
    expect(LAND).toContain('fvPasswordProblem(pass)');
    // Y ya no queda el límite viejo de 6 en ninguna.
    expect(AUTH).not.toMatch(/length\s*<\s*6/);
    expect(LAND).not.toMatch(/length\s*<\s*6/);
  });

  test('el medidor penaliza lo que un atacante prueba primero', () => {
    // Una contraseña larga pero obvia no debe salir como "buena".
    const obvia = call(ctx, "fvPasswordStrength('password123').score");
    const buena = call(ctx, "fvPasswordStrength('Tr3n-Azul#Lento').score");
    expect(obvia).toBeLessThanOrEqual(1);
    expect(buena).toBeGreaterThanOrEqual(3);
  });

  test('el medidor nunca se sale de 0-4 ni deja etiqueta vacía', () => {
    for (const p of ['a', 'aaaaaaaa', 'Ab1!' .repeat(20), 'qwerty', '']) {
      const r = JSON.parse(call(ctx, `JSON.stringify(fvPasswordStrength(${JSON.stringify(p)}))`));
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(4);
      if (p) expect(r.label).toBeTruthy();
    }
  });
});

describe('Validación de correo', () => {
  let ctx;
  beforeEach(() => { ctx = loadShared(); });

  test('acepta direcciones normales', () => {
    for (const e of ['a@b.es', 'carlos.martinez@gmail.com', 'x+etiqueta@dominio.co.uk']) {
      expect(call(ctx, `fvIsValidEmail(${JSON.stringify(e)})`)).toBe(true);
    }
  });

  test('rechaza lo que no es una dirección', () => {
    for (const e of ['', 'sinarroba', 'a@', '@b.es', 'a@b', 'a b@c.es', 'a@b.c']) {
      expect(call(ctx, `fvIsValidEmail(${JSON.stringify(e)})`)).toBe(false);
    }
  });

  test('rechaza direcciones absurdamente largas', () => {
    expect(call(ctx, `fvIsValidEmail('a'.repeat(250) + '@b.es')`)).toBe(false);
  });
});

describe('actionCodeSettings — a dónde vuelven los enlaces', () => {
  test('sin VITE_APP_URL usa el origen actual', () => {
    const ctx = loadShared({ appUrl: '', origin: 'https://finova.vercel.app' });
    const s = JSON.parse(call(ctx, "JSON.stringify(fvActionCodeSettings('index.html'))"));
    expect(s.url).toBe('https://finova.vercel.app/index.html');
  });

  test('con VITE_APP_URL manda la variable, no el origen', () => {
    const ctx = loadShared({ appUrl: 'https://finova.es', origin: 'https://otra.app' });
    const s = JSON.parse(call(ctx, "JSON.stringify(fvActionCodeSettings('index.html'))"));
    expect(s.url).toBe('https://finova.es/index.html');
  });

  test('una barra final de más no produce una doble barra', () => {
    const ctx = loadShared({ appUrl: 'https://finova.es///' });
    const s = JSON.parse(call(ctx, "JSON.stringify(fvActionCodeSettings('/index.html'))"));
    expect(s.url).toBe('https://finova.es/index.html');
  });

  test('handleCodeInApp es false: Finova es una PWA, no una app nativa', () => {
    const ctx = loadShared();
    const s = JSON.parse(call(ctx, "JSON.stringify(fvActionCodeSettings('index.html'))"));
    expect(s.handleCodeInApp).toBe(false);
  });

  test('los dos envíos de correo lo pasan', () => {
    // Sin actionCodeSettings, Firebase manda al dominio por defecto del
    // proyecto y el usuario acaba en una página que no es la app.
    expect(AUTH).toContain("sendEmailVerification(fvActionCodeSettings('index.html'))");
    expect(AUTH).toContain("sendPasswordResetEmail(email, fvActionCodeSettings('index.html'))");
    expect(LAND).toContain("sendEmailVerification(fvActionCodeSettings('index.html'))");
    expect(LAND).toContain("sendPasswordResetEmail(email, fvActionCodeSettings('index.html'))");
  });
});

describe('Cuenta atrás de reenvío', () => {
  test('son 60 segundos', () => {
    const ctx = loadShared();
    expect(call(ctx, 'FV_RESEND_COOLDOWN_SEC')).toBe(60);
  });

  test('deshabilita el botón y cuenta hacia atrás', () => {
    const ctx = loadShared();
    const ticks = [];
    vm.runInContext(`
      var _btn = { id: 'b1', disabled: false, textContent: '' };
      document.getElementById = id => (id === 'b1' ? _btn : null);
      var _fns = [];
      setInterval  = fn => { _fns.push(fn); return _fns.length; };
      clearInterval = () => {};
      fvStartCooldown(_btn, 'Reenviar', 3);
      __out = [];
      __out.push(_btn.disabled + '|' + _btn.textContent);
      _fns[0](); __out.push(_btn.disabled + '|' + _btn.textContent);
      _fns[0](); __out.push(_btn.disabled + '|' + _btn.textContent);
      _fns[0](); __out.push(_btn.disabled + '|' + _btn.textContent);
    `, ctx);
    const out = call(ctx, 'JSON.stringify(__out)');
    expect(JSON.parse(out)).toEqual([
      'true|Reenviar (3)',
      'true|Reenviar (2)',
      'true|Reenviar (1)',
      'false|Reenviar',       // al llegar a 0 se vuelve a habilitar
    ]);
  });

  test('si el botón desaparece, el intervalo se limpia', () => {
    // Al cambiar de pantalla el botón se destruye. Sin esta limpieza el
    // intervalo sigue corriendo para siempre.
    const ctx = loadShared();
    vm.runInContext(`
      var _btn = { id: 'b2', disabled: false, textContent: '' };
      var _found = _btn;
      document.getElementById = () => _found;
      var _fns = []; var _cleared = 0;
      setInterval  = fn => { _fns.push(fn); return 99; };
      clearInterval = () => { _cleared++; };
      fvStartCooldown(_btn, 'Reenviar', 10);
      _found = null;          // el botón ya no está en el DOM
      _fns[0]();
      __cleared = _cleared;
    `, ctx);
    expect(call(ctx, '__cleared')).toBeGreaterThan(0);
  });
});

/* ═══ Servidor ═════════════════════════════════════════════════ */

describe('Servidor — exigencia de email_verified', () => {
  test('REQUIRE_EMAIL_VERIFIED es true por defecto', () => {
    // Solo la cadena exacta 'false' lo desactiva: una variable mal escrita o
    // vacía NO debe abrir la puerta.
    expect(SERVER).toContain("const REQUIRE_EMAIL_VERIFIED = process.env.REQUIRE_EMAIL_VERIFIED !== 'false';");
  });

  test('la guarda falla cerrada: sin dato, se corta', () => {
    const ctx = vm.createContext({});
    const m = SERVER.match(/function _requireVerifiedEmail[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    vm.runInContext(
      'const REQUIRE_EMAIL_VERIFIED = true, _AUTH_ENABLED = true;\n' +
      'function _apiHeaders() { return {}; }\n' + m[0], ctx
    );
    const probe = (req) => {
      const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } };
      const ok = vm.runInContext('_requireVerifiedEmail', ctx)(req, res, 'la IA');
      return { ok, code: res.code, body: res.body };
    };
    // Verificado → pasa
    expect(probe({ emailVerified: true }).ok).toBe(true);
    // No verificado → 403
    const no = probe({ emailVerified: false });
    expect(no.ok).toBe(false);
    expect(no.code).toBe(403);
    expect(JSON.parse(no.body).code).toBe('EMAIL_NOT_VERIFIED');
    // SIN el dato → también 403. Ante la duda se corta.
    expect(probe({}).ok).toBe(false);
    expect(probe({ emailVerified: 'true' }).ok).toBe(false);   // string, no boolean
  });

  test('está aplicada en los tres endpoints que lo necesitan', () => {
    // IA (cuesta dinero) y las dos subidas de datos del usuario.
    const ai     = SERVER.slice(SERVER.indexOf('async function handleAIProxy'), SERVER.indexOf('async function handleAIProxy') + 2000);
    const post   = SERVER.slice(SERVER.indexOf('async function handleUserDataPost'), SERVER.indexOf('async function handleUserDataPost') + 1800);
    const upload = SERVER.slice(SERVER.indexOf('async function handleSyncUpload'), SERVER.indexOf('async function handleSyncUpload') + 1800);
    for (const [name, chunk] of [['ai', ai], ['user-data POST', post], ['sync-upload', upload]]) {
      expect(chunk.includes('_requireVerifiedEmail')).toBe(true);
    }
  });

  test('la descarga de datos NO está bloqueada', () => {
    // Si se bloqueara, quien verifique en otro dispositivo no podría
    // recuperar lo suyo.
    const get = SERVER.slice(SERVER.indexOf('async function handleUserDataGet'), SERVER.indexOf('async function handleUserDataPost'));
    expect(get.includes('_requireVerifiedEmail')).toBe(false);
  });

  test('_requireAuth deja req.emailVerified en los dos caminos de verificación', () => {
    const fn = SERVER.slice(SERVER.indexOf('async function _requireAuth'), SERVER.indexOf('async function _requireAuth') + 2500);
    // Admin SDK
    expect(fn).toContain('decoded.email_verified === true');
    // Verificación RS256 propia
    expect(fn).toContain('payload.email_verified === true');
  });
});

/* ═══ Higiene de los flujos ════════════════════════════════════ */

describe('Higiene: nada de alert() ni console.log', () => {
  test('ninguno de los tres ficheros usa alert()', () => {
    for (const [name, src] of [['auth-shared', SHARED], ['auth', AUTH], ['landing', LAND]]) {
      expect(src).not.toMatch(/\balert\s*\(/);
    }
  });

  test('sin console.log nuevo en los flujos de auth', () => {
    // console.error y console.warn sí: son fallos que hay que poder depurar.
    const count = s => (s.match(/console\.log\s*\(/g) || []).length;
    expect(count(SHARED)).toBe(0);
    expect(count(LAND)).toBe(0);
    // auth.js tiene UNO histórico (registra origin/hostname para depurar el
    // login de Google) y está documentado en la auditoría. Que no crezca.
    expect(count(AUTH)).toBe(1);
  });

  test('los mensajes de error se anuncian (role=alert + aria-live)', () => {
    const idx = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    const lan = fs.readFileSync(path.join(process.cwd(), 'landing.html'), 'utf8');
    // En la app el contenedor lo pinta auth.js; en la landing está en el HTML.
    expect(AUTH).toMatch(/id="login-error"[^>]*role="alert"[^>]*aria-live="assertive"/);
    expect(lan).toMatch(/id="lpFormError"[^>]*role="alert"[^>]*aria-live="assertive"/);
    // El medidor de fortaleza es informativo: polite, no assertive.
    expect(AUTH).toMatch(/id="login-pw-meter"[^>]*aria-live="polite"/);
    expect(lan).toMatch(/id="lpPwMeter"[^>]*aria-live="polite"/);
  });

  test('todos los campos de los formularios tienen label asociada', () => {
    const lan = fs.readFileSync(path.join(process.cwd(), 'landing.html'), 'utf8');
    for (const id of ['login-email', 'login-password', 'login-name', 'reset-email']) {
      expect(AUTH).toContain(`for="${id}"`);
    }
    for (const id of ['lpNameInput', 'lpEmailInput', 'lpPasswordInput']) {
      expect(lan).toContain(`for="${id}"`);
    }
  });
});

describe('Verificación desde otro dispositivo', () => {
  test('se refresca al volver a la pestaña, sin pedir cerrar sesión', () => {
    expect(AUTH).toContain("addEventListener('visibilitychange'");
    expect(AUTH).toContain('_refreshVerifiedState');
    // Y NO debe haber ningún signOut en ese camino.
    const fn = AUTH.slice(AUTH.indexOf('async function _refreshVerifiedState'),
                          AUTH.indexOf('if (typeof document !=='));
    expect(fn.includes('signOut')).toBe(false);
  });

  test('tras verificar se pide un token NUEVO', () => {
    // El servidor lee email_verified DENTRO del token: con el de la caché
    // seguiría viendo false y la IA y el sync seguirían rechazados.
    const fn = AUTH.slice(AUTH.indexOf('async function _refreshVerifiedState'),
                          AUTH.indexOf('if (typeof document !=='));
    expect(fn).toContain('getIdToken(true)');
    const check = AUTH.slice(AUTH.indexOf('async function _verifyCheckNow'),
                             AUTH.indexOf('function _restoreLoginChrome'));
    expect(check).toContain('getIdToken(true)');
    expect(check).toContain('user.reload()');
  });

  test('los de Google no ven la pantalla de verificación', () => {
    // Llegan con emailVerified true, y la condición exige !user.emailVerified.
    expect(AUTH).toMatch(/_wantsVerify && !user\.emailVerified/);
  });
});
