/**
 * Finova — monitoring.test.js
 *
 * La monitorización manda datos a un tercero. Lo único que de verdad hay que
 * probar aquí es que NO se le manda nada del usuario: ni importes, ni IBAN, ni
 * correos, ni tokens, ni el uid en claro.
 *
 * Los patrones viven en src/core/redact-patterns.json, que es la fuente que
 * usan tanto el frontend (monitoring.js) como el servidor (server.cjs). Si
 * alguien añade un patrón, se prueba una vez y vale para los dos.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const PATTERNS = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'src/core/redact-patterns.json'), 'utf8')
);
const SERVER = fs.readFileSync(path.join(process.cwd(), 'server.cjs'), 'utf8');
const MON    = fs.readFileSync(path.join(process.cwd(), 'src/core/monitoring.js'), 'utf8');
const ANA    = fs.readFileSync(path.join(process.cwd(), 'src/core/analytics.js'), 'utf8');

/** Saca una función contando llaves, saltando la lista de parámetros. */
function extractFn(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error('no se encontró ' + name);
  const start = m.index;
  let pd = 0, i = start + m[0].length - 1;
  for (; i < src.length; i++) {
    if (src[i] === '(') pd++;
    else if (src[i] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('llaves desbalanceadas en ' + name);
}

/* ═══ La redacción, probada contra la implementación del SERVIDOR ═══ */

describe('Redacción — nada del usuario llega a Sentry', () => {
  let redact;
  beforeEach(() => {
    const ctx = vm.createContext({ String, RegExp, _REDACT: PATTERNS });
    vm.runInContext(extractFn(SERVER, '_sentryRedact'), ctx);
    redact = vm.runInContext('_sentryRedact', ctx);
  });

  test('importes con el símbolo del euro', () => {
    expect(redact('saldo 1.234,56 €')).toBe('saldo [importe]');
    expect(redact('cuesta €45,90')).toBe('cuesta [importe]');
    expect(redact('total 300 EUR')).toBe('total [importe]');
  });

  test('importes en formato español y en formato inglés', () => {
    expect(redact('valor 1.234.567,89 en cartera')).toBe('valor [importe] en cartera');
    expect(redact('valor 1,234,567.89 en cartera')).toBe('valor [importe] en cartera');
  });

  test('cualquier número con dos decimales', () => {
    // Agresivo a propósito: en esta app un número con céntimos casi siempre
    // es dinero, y equivocarse por exceso no cuesta nada.
    expect(redact('el precio era 45.90 y subio')).toBe('el precio era [importe] y subio');
    expect(redact('cantidad 12,50 acciones')).toBe('cantidad [importe] acciones');
  });

  test('IBAN español, con y sin espacios', () => {
    expect(redact('cuenta ES9121000418450200051332 bloqueada')).toBe('cuenta [iban] bloqueada');
    expect(redact('ES91 2100 0418 4502 0005 1332')).toBe('[iban]');
  });

  test('correos electrónicos', () => {
    expect(redact('fallo para carlos.martinez@gmail.com al guardar'))
      .toBe('fallo para [correo] al guardar');
  });

  test('tokens JWT de Firebase', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.firmaFalsa123';
    expect(redact('Authorization fallo con ' + jwt)).toBe('Authorization fallo con [token]');
  });

  test('cabeceras Authorization enteras', () => {
    expect(redact('header: Bearer abc123def456ghi789jkl')).toContain('[token]');
    expect(redact('header: Bearer abc123def456ghi789jkl')).not.toContain('abc123def456');
  });

  test('claves de API de los cuatro proveedores', () => {
    // Se arman por concatenacion para que el escaner de secretos del
    // pre-commit no confunda estas claves FALSAS con credenciales reales. El
    // valor que llega a la funcion es exactamente el mismo.
    for (const k of [
      'sk-' + 'ant-' + 'api03-abcdefghijklmnopqrst',
      'sk-' + 'proj-abcdefghijklmnopqrst',
      'gsk' + '_abcdefghijklmnop',
      'AIza' + 'SyAbcdefghijklmnopqrstuvwxyz12',
    ]) {
      const out = redact('clave ' + k + ' invalida');
      expect(out).toContain('[clave-api]');
      expect(out).not.toContain(k);
    }
  });

  test('números de tarjeta', () => {
    expect(redact('tarjeta 4111111111111111 rechazada')).toContain('[tarjeta]');
    expect(redact('tarjeta 4111 1111 1111 1111 rechazada')).toContain('[tarjeta]');
  });

  test('uid de Firebase (28 caracteres)', () => {
    const uid = 'aBcD1234eFgH5678iJkL9012mNoP';
    expect(uid).toHaveLength(28);
    expect(redact('usuario ' + uid + ' sin datos')).toBe('usuario [uid] sin datos');
  });

  test('un mensaje con VARIOS datos a la vez se limpia entero', () => {
    const sucio = 'Error: usuario carlos@test.com con saldo 1.234,56 € en ' +
                  'ES9121000418450200051332 y token eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.xyz123abc';
    const out = redact(sucio);
    expect(out).not.toMatch(/carlos@test\.com|1\.234,56|ES9121000418450200051332|eyJhbGci/);
    expect(out).toContain('[correo]');
    expect(out).toContain('[importe]');
    expect(out).toContain('[iban]');
    expect(out).toContain('[token]');
  });

  test('el MENSAJE del error sigue siendo legible', () => {
    // Si la redacción destruyera el mensaje, Sentry no serviría para nada.
    const out = redact('TypeError: no se puede leer la propiedad amount de undefined');
    expect(out).toBe('TypeError: no se puede leer la propiedad amount de undefined');
  });

  test('un texto sin datos sensibles no se toca', () => {
    for (const s of [
      'ResizeObserver loop completed',
      'Failed to fetch',
      'renderDashboard is not a function',
      'Cannot read properties of null',
    ]) {
      expect(redact(s)).toBe(s);
    }
  });

  test('null, undefined y cadena vacía no revientan', () => {
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
    expect(redact('')).toBe('');
  });

  test('aplicar dos veces da el mismo resultado (idempotente)', () => {
    // Importa porque el evento pasa por beforeSend y las migas por
    // beforeBreadcrumb: un texto puede redactarse dos veces.
    const una = redact('saldo 1.234,56 € de ana@test.com');
    expect(redact(una)).toBe(una);
  });

  test('los patrones con /g no se saltan coincidencias al reusarse', () => {
    // Un RegExp con /g guarda lastIndex. Si se compartiera la instancia entre
    // llamadas, la segunda se saltaría coincidencias de forma intermitente —
    // el peor fallo posible en algo cuyo trabajo es no dejar escapar datos.
    for (let i = 0; i < 5; i++) {
      expect(redact('a@b.es y c@d.es')).toBe('[correo] y [correo]');
    }
  });
});

describe('Redacción de URL', () => {
  let redactUrl;
  beforeEach(() => {
    const ctx = vm.createContext({ String, RegExp, URL, Set, _REDACT: PATTERNS,
      _REDACT_QUERY: new Set(PATTERNS.queryKeysSensibles.map(k => k.toLowerCase())) });
    vm.runInContext(extractFn(SERVER, '_sentryRedact') + '\n' + extractFn(SERVER, '_sentryRedactUrl'), ctx);
    redactUrl = vm.runInContext('_sentryRedactUrl', ctx);
  });

  test('conserva la ruta (dice QUÉ falló) y oculta el query sensible', () => {
    expect(redactUrl('/api/user-data?uid=abc123&x=1')).toBe('/api/user-data?uid=%5Boculto%5D&x=1');
  });

  test('oculta token, código y correo del query', () => {
    for (const k of ['token', 'oobCode', 'email', 'password', 'secret']) {
      const out = redactUrl('/x?' + k + '=secretazo');
      expect(out).not.toContain('secretazo');
    }
  });

  test('una URL sin query se deja igual', () => {
    expect(redactUrl('/api/health')).toBe('/api/health');
  });

  test('no se queda el host, solo la ruta', () => {
    // El host no aporta (ya está en el proyecto de Sentry) y en una URL
    // absoluta podría llevar credenciales.
    expect(redactUrl('https://app.finova.es/api/ai?uid=x')).not.toContain('app.finova.es');
  });
});

/* ═══ Configuración de Sentry ══════════════════════════════════ */

describe('Configuración del SDK — lo que está desactivado', () => {
  test('NUNCA se usa Session Replay', () => {
    // Graba la pantalla del usuario. En esta app la pantalla ES el dato.
    expect(MON).not.toMatch(/replayIntegration\s*\(/);
    expect(MON).not.toMatch(/replaysSessionSampleRate|replaysOnErrorSampleRate/);
    expect(SERVER).not.toMatch(/replayIntegration/);
  });

  test('sendDefaultPii está en false en los dos lados', () => {
    expect(MON).toMatch(/sendDefaultPii:\s*false/);
    expect(SERVER).toMatch(/sendDefaultPii:\s*false/);
  });

  test('las trazas de rendimiento están desactivadas', () => {
    expect(MON).toMatch(/tracesSampleRate:\s*0\b/);
    expect(SERVER).toMatch(/tracesSampleRate:\s*0\b/);
  });

  test('el navegador quita Console y HttpContext', () => {
    const fuera = MON.slice(MON.indexOf('const FUERA = new Set('), MON.indexOf('const out = defaults.filter'));
    expect(fuera).toContain("'Console'");
    expect(fuera).toContain("'HttpContext'");   // mete URL, cabeceras y UA
  });

  test('las migas de consola y de clic están apagadas', () => {
    const cfg = MON.slice(MON.indexOf('Sentry.breadcrumbsIntegration('), MON.indexOf('if (i >= 0)'));
    expect(cfg).toMatch(/console:\s*false/);
    expect(cfg).toMatch(/dom:\s*false/);
  });

  test('el servidor quita RequestData, Console y LocalVariablesAsync', () => {
    const fuera = SERVER.slice(SERVER.indexOf('const FUERA = new Set(['), SERVER.indexOf('return defaults.filter'));
    // RequestData mete cabeceras (Authorization), cookies, query y cuerpo.
    expect(fuera).toContain("'RequestData'");
    expect(fuera).toContain("'Console'");
    // LocalVariablesAsync captura los VALORES de las variables locales del
    // stack: en una app de finanzas, importes, uid y tokens.
    expect(fuera).toContain("'LocalVariablesAsync'");
  });

  test('beforeSend borra los valores de las variables locales', () => {
    expect(MON).toMatch(/delete f\.vars/);
    expect(SERVER).toMatch(/delete f\.vars/);
  });

  test('beforeBreadcrumb tira las migas de consola y de interfaz', () => {
    const fn = extractFn(MON, 'beforeBreadcrumb');
    expect(fn).toMatch(/category === 'console'\) return null/);
    expect(fn).toMatch(/ui\.click/);
  });

  test('el usuario se identifica SOLO con un hash', () => {
    // setUser recibe un hash calculado en el navegador: el uid no sale nunca.
    expect(MON).toMatch(/crypto\.subtle\.digest\('SHA-256'/);
    expect(MON).toMatch(/Sentry\.setUser\(\{ id: hex\.slice\(0, 16\) \}\)/);
    // Y nada de correo ni nombre.
    expect(MON).not.toMatch(/setUser\([^)]*email/);
    expect(MON).not.toMatch(/setUser\([^)]*username/);
  });

  test('no arranca sin DSN, en local, con opt-out ni con Do Not Track', () => {
    const fn = extractFn(MON, 'start');
    expect(fn).toMatch(/if \(!DSN\) return;/);
    expect(fn).toMatch(/if \(IS_LOCAL\) return;/);
    expect(fn).toMatch(/userOptedOut\(\)\) return;/);
    expect(fn).toMatch(/doNotTrack|globalPrivacyControl/);
  });

  test('el DSN no está escrito en el código, viene de una variable', () => {
    expect(MON).toMatch(/import\.meta\.env\.VITE_SENTRY_DSN/);
    expect(SERVER).toMatch(/process\.env\.SENTRY_DSN_SERVER/);
    // Ni un DSN real suelto por ahí.
    expect(MON).not.toMatch(/https:\/\/[0-9a-f]{16,}@/);
    expect(SERVER).not.toMatch(/https:\/\/[0-9a-f]{16,}@o\d+\.ingest/);
  });
});

/* ═══ Analítica ════════════════════════════════════════════════ */

describe('Analítica — lista blanca cerrada', () => {
  let ctx, enviados;

  beforeEach(() => {
    enviados = [];
    ctx = vm.createContext({
      location: { hostname: 'app.finova.es' },
      navigator: { doNotTrack: '0' },
      document: { readyState: 'complete', addEventListener() {}, head: { appendChild() {} },
                  createElement: () => ({ setAttribute() {} }) },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      window: { umami: { track: (e, p) => enviados.push({ e, p }) } },
      String, Set, Object, Array, RegExp,
    });
    // import.meta.env sustituido como hace vite.config.js, con analítica activa.
    const code = ANA
      .replace(/import\.meta\.env\.VITE_ANALYTICS_SRC/g, '"https://cloud.umami.is/script.js"')
      .replace(/import\.meta\.env\.VITE_ANALYTICS_ID/g,  '"id-de-prueba"')
      .replace(/import\.meta\.env\.VITE_APP_ENV/g,       '"production"')
      .replace(/import\.meta\b/g, 'undefined');
    vm.runInContext(code, ctx);
    // umami vive en window dentro del módulo
    vm.runInContext('window.umami = { track: (e,p) => __push(e,p) };', Object.assign(ctx, {
      __push: (e, p) => enviados.push({ e, p }),
    }));
  });

  const track = (e, p) => vm.runInContext('track', ctx)(e, p);

  test('los 8 eventos del encargo están permitidos', () => {
    for (const e of ['registro_completado', 'primer_transaccion', 'primer_activo_cartera',
                     'importacion_csv_ok', 'asesor_ia_usado', 'informe_pdf_descargado',
                     'feedback_enviado', 'cuenta_borrada']) {
      enviados.length = 0;
      expect(track(e)).toBe(true);
      expect(enviados[0].e).toBe(e);
    }
  });

  test('un nombre de evento que no está en la lista se descarta', () => {
    expect(track('evento_inventado')).toBe(false);
    expect(track('saldo_actualizado')).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  test('una propiedad que no está en la lista se descarta', () => {
    track('feedback_enviado', { tipo: 'bug', saldo: 'mucho', email: 'a@b.es' });
    expect(Object.keys(enviados[0].p)).toEqual(['tipo']);
  });

  test('los NÚMEROS nunca se envían', () => {
    // Un número es lo único que puede ser un importe.
    track('importacion_csv_ok', { banco: 'CSV', tipo: 1234.56 });
    expect(enviados[0].p).toEqual({ banco: 'CSV' });
  });

  test('un valor con pinta de cifra se descarta aunque la clave valga', () => {
    enviados.length = 0;
    track('importacion_csv_ok', { banco: '1.234,56 €' });
    expect(enviados[0].p).toBeUndefined();
  });

  test('los valores cerrados fuera de lista pasan a "otro"', () => {
    enviados.length = 0;
    track('registro_completado', { metodo: 'telepatia' });
    expect(enviados[0].p).toEqual({ metodo: 'otro' });
    enviados.length = 0;
    track('registro_completado', { metodo: 'google' });
    expect(enviados[0].p).toEqual({ metodo: 'google' });
  });

  test('los valores se recortan', () => {
    enviados.length = 0;
    track('feedback_enviado', { tipo: 'x'.repeat(500) });
    expect(enviados[0].p.tipo.length).toBeLessThanOrEqual(40);
  });

  test('no se carga nada con Do Not Track', () => {
    const c = vm.createContext({
      location: { hostname: 'app.finova.es' },
      navigator: { doNotTrack: '1' },
      document: { readyState: 'complete', addEventListener() {}, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      window: {}, String, Set, Object, Array, RegExp,
    });
    const code = ANA
      .replace(/import\.meta\.env\.VITE_ANALYTICS_SRC/g, '"https://x/script.js"')
      .replace(/import\.meta\.env\.VITE_ANALYTICS_ID/g,  '"id"')
      .replace(/import\.meta\.env\.VITE_APP_ENV/g,       '"production"')
      .replace(/import\.meta\b/g, 'undefined');
    vm.runInContext(code, c);
    expect(vm.runInContext('track', c)('primer_transaccion')).toBe(false);
  });

  test('no se carga en localhost', () => {
    const c = vm.createContext({
      location: { hostname: 'localhost' },
      navigator: { doNotTrack: '0' },
      document: { readyState: 'complete', addEventListener() {}, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      window: {}, String, Set, Object, Array, RegExp,
    });
    const code = ANA
      .replace(/import\.meta\.env\.VITE_ANALYTICS_SRC/g, '"https://x/script.js"')
      .replace(/import\.meta\.env\.VITE_ANALYTICS_ID/g,  '"id"')
      .replace(/import\.meta\.env\.VITE_APP_ENV/g,       '"production"')
      .replace(/import\.meta\b/g, 'undefined');
    vm.runInContext(code, c);
    expect(vm.runInContext('track', c)('primer_transaccion')).toBe(false);
  });

  test('sin configurar, no se carga ningún script de terceros', () => {
    const creados = [];
    const c = vm.createContext({
      location: { hostname: 'app.finova.es' },
      navigator: { doNotTrack: '0' },
      document: { readyState: 'complete', addEventListener() {},
                  head: { appendChild: el => creados.push(el) },
                  createElement: () => ({ setAttribute() {} }) },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      window: {}, String, Set, Object, Array, RegExp,
    });
    const code = ANA
      .replace(/import\.meta\.env\.VITE_ANALYTICS_SRC/g, '""')
      .replace(/import\.meta\.env\.VITE_ANALYTICS_ID/g,  '""')
      .replace(/import\.meta\.env\.VITE_APP_ENV/g,       '"production"')
      .replace(/import\.meta\b/g, 'undefined');
    vm.runInContext(code, c);
    expect(creados).toHaveLength(0);
  });

  test('el identificador no está escrito en el código', () => {
    expect(ANA).toMatch(/import\.meta\.env\.VITE_ANALYTICS_ID/);
  });
});

/* ═══ Apagado ordenado ═════════════════════════════════════════ */

describe('Apagado ordenado', () => {
  test('guarda el rate limit y vacía Sentry ANTES de salir', () => {
    // El orden importa: si se saliera antes del flush, el error que ha
    // provocado el apagado es justo el que no llegaría a Sentry.
    const fn = extractFn(SERVER, '_gracefulShutdown');
    const iClose = fn.indexOf('_httpServer.close');
    const iSave  = fn.indexOf('_saveRateLimits()');
    const iFlush = fn.indexOf('.flush(');
    const iExit  = fn.indexOf('process.exit');
    expect(iClose).toBeGreaterThan(-1);
    expect(iSave).toBeGreaterThan(iClose);
    expect(iFlush).toBeGreaterThan(iSave);
    expect(iExit).toBeGreaterThan(iFlush);
  });

  test('es idempotente: dos señales no lo ejecutan dos veces', () => {
    const fn = extractFn(SERVER, '_gracefulShutdown');
    expect(fn).toMatch(/if \(_shuttingDown\) return;/);
  });

  test('está enganchado a SIGTERM y SIGINT', () => {
    expect(SERVER).toMatch(/process\.on\('SIGTERM'/);
    expect(SERVER).toMatch(/process\.on\('SIGINT'/);
  });

  test('uncaughtException sale; unhandledRejection NO tumba el servidor', () => {
    // Una promesa rechazada suele venir de una petición concreta (una llamada
    // a Yahoo que falla): tumbar el servidor entero por eso sería peor que el
    // problema.
    const uncaught = SERVER.slice(SERVER.indexOf("process.on('uncaughtException'"),
                                 SERVER.indexOf("process.on('unhandledRejection'"));
    const unhandled = SERVER.slice(SERVER.indexOf("process.on('unhandledRejection'"));
    expect(uncaught).toContain('_gracefulShutdown');
    expect(unhandled).toContain('_sentryCapture');
    expect(unhandled).not.toContain('_gracefulShutdown');
  });
});

/* ═══ Health checks ════════════════════════════════════════════ */

describe('Endpoints de salud', () => {
  test('/api/health no expone versiones, uptime ni estado interno', () => {
    const bloque = SERVER.slice(SERVER.indexOf("req.url === '/api/health'"),
                                SERVER.indexOf("req.url === '/api/health'") + 400);
    expect(bloque).toMatch(/ok: true/);
    expect(bloque).toMatch(/ts:/);
    // Lo que NO puede estar.
    expect(bloque).not.toMatch(/uptime|process\.version|memoryUsage|env\./);
  });

  test('va ANTES del chequeo del proxy secret', () => {
    // Si fuera después, un monitor externo apuntando a Railway recibiría 403
    // con FINOVA_PROXY_SECRET configurado y daría una caída falsa.
    const iHealth = SERVER.indexOf("req.url === '/api/health'");
    const iProxy  = SERVER.indexOf('!_checkProxySecret(req, res)');
    expect(iHealth).toBeGreaterThan(-1);
    expect(iProxy).toBeGreaterThan(iHealth);
  });

  test('/api/health/deep responde 404 sin secreto, no 403', () => {
    // Un 403 confirmaría que el endpoint existe.
    const fn = extractFn(SERVER, 'handleHealthDeep');
    expect(fn).toMatch(/if \(!HEALTH_DEEP_SECRET\)/);
    expect(fn).toMatch(/writeHead\(404/);
    expect(fn).not.toMatch(/writeHead\(403/);
  });

  test('compara el secreto en tiempo constante', () => {
    const fn = extractFn(SERVER, 'handleHealthDeep');
    expect(fn).toMatch(/timingSafeEqual/);
  });

  test('el health profundo NO llama a servicios de pago', () => {
    // Un ping cada 5 minutos a un proveedor que cobra por llamada sale caro.
    const fn = extractFn(SERVER, 'handleHealthDeep');
    expect(fn).not.toMatch(/_gcCall|_gcGetToken|fetch\(|verifyIdToken/);
  });
});
