/**
 * Finova — auth-signup.test.js
 * Registro con correo desde DENTRO de la app (src/auth/auth.js).
 *
 * El bug: createUserWithEmailAndPassword dispara onAuthStateChanged de
 * inmediato, y en ese instante user.displayName todavía es null porque
 * updateProfile no ha corrido. Como el listener hace
 * `APP.userName = APP.userName || user.displayName || ''`, el nombre recién
 * escrito se perdía y la app mostraba el trozo del correo.
 *
 * El registro desde la landing (landing.js) NO tenía el fallo porque encadena
 * updateProfile ANTES de navegar a index.html — divergencia entre las dos
 * implementaciones de auth que conviven en el proyecto.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const AUTH   = fs.readFileSync(path.join(process.cwd(), 'src/auth/auth.js'), 'utf8');
// auth.js depende de auth-shared.js (mapa de errores, politica de contrasenas,
// actionCodeSettings). index.html lo carga antes; aqui se replica ese orden.
const SHARED = fs.readFileSync(path.join(process.cwd(), 'src/auth/auth-shared.js'), 'utf8');

/** auth.js usa import.meta.env; se sustituye igual que hace vite.config.js. */
const stripImportMeta = c => c
  .replace(/import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g, '""')
  .replace(/import\.meta\b/g, 'undefined');

let APP, ctx, calls, authStateCb;

/** Doble de firebase.auth() que reproduce el ORDEN real de los eventos. */
function makeAuth({ failWith = null } = {}) {
  return {
    createUserWithEmailAndPassword: async () => {
      if (failWith) throw Object.assign(new Error('fallo'), { code: failWith });
      const user = {
        uid: 'u1', email: 'nuevo@test.com',
        displayName: null,          // clave: aún no hay nombre
        photoURL: null,
        emailVerified: false,
        updateProfile: async p => { user.displayName = p.displayName; calls.updateProfile++; },
        sendEmailVerification: async opts => { calls.verifySent.push(opts); },
        reload: async () => {},
        getIdToken: async () => 'tok',
      };
      // Firebase avisa del cambio de sesión ANTES de que updateProfile corra.
      if (authStateCb) await authStateCb(user);
      return { user };
    },
    signInWithEmailAndPassword: async () => {
      const user = { uid: 'u2', email: 'otro@test.com', displayName: null, photoURL: null,
                     emailVerified: true, reload: async () => {}, getIdToken: async () => 'tok' };
      if (authStateCb) await authStateCb(user);
      return { user };
    },
    onAuthStateChanged: cb => { authStateCb = cb; },
    settings: {},
  };
}

function load({ failWith = null } = {}) {
  APP = { userName: '', userEmail: '', cashAccounts: [], transactions: [] };
  calls = { updateProfile: 0, injectAuthUI: 0, msgs: [], verifySent: [] };
  authStateCb = null;

  ctx = vm.createContext({
    APP, console,
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, visibilityState: 'visible',
    },
    location: { hostname: 'localhost', search: '', port: '3000', pathname: '/', replace() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams, fetch: async () => ({ ok: false, json: async () => ({}) }),
    firebase: { initializeApp() {}, auth: () => makeAuth({ failWith }) },
    showToast() {}, init: async () => {}, saveData() {},
    _lazyLoad: () => Promise.resolve(), _LAZY_SCRIPTS: {},
    AbortSignal: { timeout: () => null },
    navigator: { onLine: true },
    window: { addEventListener() {} },
    escapeHtml: v => String(v),
  });
  // Mismo orden que index.html: primero el compartido, luego auth.js.
  vm.runInContext(stripImportMeta(SHARED), ctx, { filename: 'auth-shared.js' });
  vm.runInContext(stripImportMeta(AUTH), ctx, { filename: 'auth.js' });

  // Sustitutos observables de lo que auth.js llamaría al pintar la UI
  vm.runInContext(`
    _fbAuth = firebase.auth();
    _fbAuth.onAuthStateChanged(async user => {
      APP.uid = user.uid;
      APP.userEmail = user.email || '';
      APP.userName  = APP.userName || user.displayName || '';
    });
    _appInitialized = true;
    _injectAuthUI = () => { __calls.injectAuthUI++; };
    _showLoginMsg = (m) => { __calls.msgs.push(m); };
    _setLoginLoading = () => {};
  `, ctx);
  vm.runInContext('globalThis.__calls = __c', Object.assign(ctx, { __c: calls }));
  APP = vm.runInContext('APP', ctx);
  return vm.runInContext('({ signUpEmail, signInEmail })', ctx);
}

describe('Registro desde la app — el nombre no se pierde', () => {
  test('el nombre escrito sobrevive al onAuthStateChanged inmediato', async () => {
    const fns = load();
    await fns.signUpEmail('nuevo@test.com', 'secreto123', 'Carlos Martínez');
    expect(APP.userName).toBe('Carlos Martínez');
    expect(calls.updateProfile).toBe(1);
  });

  test('tras updateProfile se refresca la UI ya pintada', async () => {
    const fns = load();
    await fns.signUpEmail('nuevo@test.com', 'secreto123', 'Carlos');
    expect(calls.injectAuthUI).toBe(1);
  });

  test('sin nombre, no se inventa ninguno', async () => {
    const fns = load();
    await fns.signUpEmail('nuevo@test.com', 'secreto123', '');
    expect(APP.userName).toBe('');
    expect(calls.updateProfile).toBe(0);
  });

  test('una contraseña corta se rechaza ANTES de crear la cuenta', async () => {
    const fns = load();
    await fns.signUpEmail('nuevo@test.com', '123', 'Carlos');
    expect(calls.msgs[0]).toMatch(/8 caracteres/);
    expect(APP.uid).toBeUndefined();     // no se llegó a crear nada
    expect(APP.userName).toBe('');       // ni se tocó el nombre
  });

  test('7 caracteres tampoco valen: la politica es 8', async () => {
    // El limite estaba en 6 dentro de signUpEmail y en 8 en _submitLogin:
    // llamar a signUpEmail directamente se saltaba la politica nueva.
    const fns = load();
    await fns.signUpEmail('nuevo@test.com', '1234567', 'Carlos');
    expect(calls.msgs[0]).toMatch(/8 caracteres/);
    expect(APP.uid).toBeUndefined();
  });

  test('si el registro FALLA, el nombre no se queda pegado en APP', async () => {
    // Si no, al iniciar sesión luego con otra cuenta se mostraría ese nombre
    // ajeno, porque el listener hace `APP.userName || …`.
    const fns = load({ failWith: 'auth/email-already-in-use' });
    await fns.signUpEmail('existe@test.com', 'secreto123', 'Carlos');
    expect(APP.userName).toBe('');
    expect(calls.msgs.length).toBeGreaterThan(0);
  });

  test('tras un registro fallido, iniciar sesión con otra cuenta no hereda el nombre', async () => {
    const fns = load({ failWith: 'auth/email-already-in-use' });
    await fns.signUpEmail('existe@test.com', 'secreto123', 'Carlos');
    await fns.signInEmail('otro@test.com', 'secreto123');
    expect(APP.userEmail).toBe('otro@test.com');
    expect(APP.userName).toBe('');       // no arrastra "Carlos"
  });
});

/**
 * Arranque tras autenticarse. _hideLoginScreen() vuelve a MOSTRAR el spinner
 * (#app-loading) y es init(), en su última línea, quien lo oculta. Si init()
 * revienta antes, el spinner se queda a z-index 9999 tapando la app entera:
 * el usuario inicia sesión y se queda en un "cargando" eterno. El listener
 * es async y nada recogía su rechazo, así que el fallo era invisible.
 */
describe('Arranque tras login — el spinner nunca se queda colgado', () => {
  /**
   * Saca de auth.js el bloque try/catch que envuelve a init() contando
   * llaves. Así el test sigue valiendo si cambia el cuerpo del catch, y
   * falla de verdad si alguien quita el guard.
   */
  function extractBootBlock() {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/auth/auth.js'), 'utf8');
    const anchor = src.indexOf('_hideLoginScreen();');
    if (anchor < 0) throw new Error('no se encontró _hideLoginScreen() en auth.js');
    const start = src.indexOf('try {', anchor);
    if (start < 0) throw new Error('init() de arranque sin try: el guard no está');
    const closeFrom = i => {
      let depth = 0;
      for (let k = i; k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}') { depth--; if (depth === 0) return k; }
      }
      throw new Error('llaves desbalanceadas en auth.js');
    };
    const tryEnd = closeFrom(start);
    const rest   = src.slice(tryEnd + 1);
    const cIdx   = rest.indexOf('catch');
    // El catch tiene que venir pegado al try, no 200 líneas más abajo.
    if (cIdx < 0 || rest.slice(0, cIdx).trim() !== '') {
      throw new Error('el init() de arranque NO está protegido con catch');
    }
    const catchBrace = rest.indexOf('{', cIdx);
    const catchEnd   = closeFrom(tryEnd + 1 + catchBrace);
    const block = src.slice(start, catchEnd + 1);
    // Comprobacion clave: si el try encontrado no es el que envuelve a
    // init(), indexOf ha enganchado otro try cualquiera del archivo y la
    // extraccion no vale. Sin esto el test pasaba aun sin el guard.
    if (!block.includes('await init()')) {
      throw new Error('el init() de arranque NO esta envuelto en try/catch');
    }
    return block;
  }

  function bootWith(initImpl) {
    const spinner = { cls: new Set() };
    spinner.classList = {
      add:    c => spinner.cls.add(c),
      remove: c => spinner.cls.delete(c),
    };
    const toasts = [];
    const c = vm.createContext({
      console: { error() {}, log() {} },
      document: { getElementById: id => (id === 'app-loading' ? spinner : null) },
      init: initImpl,
      _injectAuthUI: () => {},
      showToast: (m, t) => toasts.push({ m, t }),
    });
    const block = extractBootBlock();
    return { spinner, toasts, run: () => vm.runInContext('(async () => { ' + block + ' })()', c) };
  }

  test('con init() correcto no se avisa de nada', async () => {
    const b = bootWith(async () => {});
    await b.run();
    expect(b.toasts).toHaveLength(0);
  });

  test('si init() falla, el spinner se oculta y se avisa al usuario', async () => {
    const b = bootWith(async () => { throw new Error('datos corruptos'); });
    await b.run();
    expect(b.spinner.cls.has('hidden')).toBe(true);
    expect(b.toasts[0].t).toBe('error');
  });

  test('un init() que falla no deja una promesa sin capturar', async () => {
    const b = bootWith(async () => { throw new Error('boom'); });
    await expect(b.run()).resolves.toBeUndefined();
  });
});
