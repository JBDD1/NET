/**
 * Finova — account-delete-client.test.js
 * Limpieza del navegador tras borrar la cuenta.
 *
 * Es la comprobacion de "no queda ningun dato del usuario en localStorage,
 * IndexedDB ni caches". Se carga el fichero REAL y se le dan dobles de las
 * cuatro APIs implicadas, porque jsdom no trae IndexedDB ni Cache API.
 *
 * Lo que mas importa: que NO borre nada hasta que el servidor dice 200, y que
 * un fallo en una pieza no deje las demas a medias.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/utils/account-delete.js'), 'utf8');

/** Doble de Storage con la API indexada que usa el codigo (length/key(i)). */
function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _keys: () => [...m.keys()],
  };
}

let ctx, local, session, deletedDbs, deletedCaches, cookieJar, fns;

function load({
  lsKeys = {},
  cacheKeys = ['finova-v27', 'finova-api-v1'],
  idbDatabases = null,          // null = indexedDB.databases() no existe
  blockedDbs = [],
} = {}) {
  local   = makeStorage(lsKeys);
  session = makeStorage({ 'finova_tour_step': '3', 'otra_app': 'x' });
  deletedDbs    = [];
  deletedCaches = [];
  cookieJar     = [];

  const indexedDB = {
    deleteDatabase: name => {
      const req = {};
      setTimeout(() => {
        if (blockedDbs.includes(name)) { req.onblocked && req.onblocked(); return; }
        deletedDbs.push(name);
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };
  if (idbDatabases) indexedDB.databases = async () => idbDatabases;

  const documentStub = {
    getElementById: () => null,
    set cookie(v) { cookieJar.push(v); },
    get cookie() { return ''; },
  };

  ctx = vm.createContext({
    console: { error() {}, warn() {}, log() {} },
    window: { localStorage: local, sessionStorage: session },
    localStorage: local, sessionStorage: session,
    indexedDB,
    caches: {
      keys: async () => cacheKeys,
      delete: async k => { deletedCaches.push(k); return true; },
    },
    document: documentStub,
    setTimeout, clearInterval, setInterval,
    APP: {}, showToast() {}, openModal() {}, closeModal() {}, escapeHtml: s => s,
    location: { replace() {}, href: '' },
    firebase: undefined,
  });
  vm.runInContext(SRC, ctx);
  fns = vm.runInContext('({ _adWipeBrowserData, _adProvider, _adErrMsg })', ctx);
  return fns;
}

const REALISTIC = {
  'finova_abc123_data_v1':  '{"transactions":[]}',
  'finova_data_v1':         '{"legacy":true}',
  'finova_last_uid':        'abc123',
  'finova_history_v2':      '[]',
  'finova_history_v1':      '[]',
  'finova_tour_step':       '5',
  'finova_ai_consent_v1':   '1',
  'finova_api_key':         'valor-falso-claude',
  'finova_api_key_enc':     'base64',
  'finova_openai_key':      'valor-falso-openai',
  'finova_openai_key_enc':  'base64',
  'finova_gemini_key':      'valor-falso-gemini',
  'finova_gemini_key_enc':  'base64',
  'finova_groq_key':        'valor-falso-groq',
  'finova_groq_key_enc':    'base64',
  'finova_enc_k':           'clave-vieja',
  // Lo que deja el SDK de Firebase: lleva el correo y el uid dentro.
  'firebase:authUser:CLAVE-FALSA:[DEFAULT]': '{"email":"carlos@test.com","uid":"abc123"}',
  // De otra aplicacion en el mismo origen: NO se debe tocar.
  'tema_otra_app':          'oscuro',
  'consent_cookies':        'si',
};

describe('Limpieza del navegador — localStorage', () => {
  test('borra las 16 claves de Finova y no deja ninguna', async () => {
    const f = load({ lsKeys: REALISTIC });
    await f._adWipeBrowserData();
    const quedan = local._keys().filter(k => k.toLowerCase().startsWith('finova'));
    expect(quedan).toEqual([]);
  });

  test('borra tambien la sesion que guarda el SDK de Firebase', async () => {
    // Contiene correo y uid: dejarla seria dejar un dato personal tras un
    // borrado de cuenta.
    const f = load({ lsKeys: REALISTIC });
    await f._adWipeBrowserData();
    expect(local._keys().some(k => k.startsWith('firebase:'))).toBe(false);
  });

  test('NO toca claves de otras aplicaciones del mismo origen', async () => {
    const f = load({ lsKeys: REALISTIC });
    await f._adWipeBrowserData();
    expect(local._keys().sort()).toEqual(['consent_cookies', 'tema_otra_app']);
  });

  test('vacia tambien sessionStorage, respetando lo ajeno', async () => {
    const f = load({ lsKeys: REALISTIC });
    await f._adWipeBrowserData();
    expect(session._keys()).toEqual(['otra_app']);
  });

  test('con el almacenamiento ya vacio no falla', async () => {
    const f = load({ lsKeys: {} });
    const failed = await f._adWipeBrowserData();
    expect(failed.filter(x => /Storage/i.test(x))).toEqual([]);
  });
});

describe('Limpieza del navegador — IndexedDB', () => {
  test('borra fotos, estado y la base de Firebase sin enumerar', async () => {
    // databases() no existe en Firefox ni en Safari antiguo: la lista conocida
    // tiene que bastar por si sola.
    const f = load();
    await f._adWipeBrowserData();
    expect(deletedDbs.sort()).toEqual(['finova_photos', 'finova_state', 'firebaseLocalStorageDb']);
  });

  test('si databases() existe, anade las que encuentre', async () => {
    const f = load({
      idbDatabases: [
        { name: 'finova_legacy_v0' },
        { name: 'firebaseLocalStorageDb' },
        { name: 'base_de_otra_app' },
      ],
    });
    await f._adWipeBrowserData();
    expect(deletedDbs).toContain('finova_legacy_v0');
    expect(deletedDbs).not.toContain('base_de_otra_app');
  });

  test('una base bloqueada por otra pestana se reporta y no cuelga el resto', async () => {
    const f = load({ blockedDbs: ['finova_photos'] });
    const failed = await f._adWipeBrowserData();
    expect(failed.some(x => x.includes('finova_photos'))).toBe(true);
    expect(deletedDbs).toContain('finova_state');   // las demas siguieron
  });
});

describe('Limpieza del navegador — cachés y cookie', () => {
  test('borra la caché de API pero deja el shell estático', async () => {
    // finova-v27 son css/js/iconos: no hay datos personales. finova-api-v1
    // guarda respuestas de /api/yahoo, y sus URL revelan los tickers.
    const f = load();
    await f._adWipeBrowserData();
    expect(deletedCaches).toEqual(['finova-api-v1']);
  });

  test('caduca la cookie del código de sincronización', async () => {
    const f = load();
    await f._adWipeBrowserData();
    expect(cookieJar.join(' ')).toMatch(/finova_sync=;/);
    expect(cookieJar.join(' ')).toMatch(/1970/);
  });

  test('sin Cache API disponible no revienta', async () => {
    const f = load();
    vm.runInContext('caches = undefined', ctx);
    const failed = await f._adWipeBrowserData();
    expect(Array.isArray(failed)).toBe(true);
  });
});

describe('Detección del proveedor para reautenticar', () => {
  test('correo y contraseña', () => {
    const f = load();
    expect(f._adProvider({ providerData: [{ providerId: 'password' }] })).toBe('password');
  });

  test('Google', () => {
    const f = load();
    expect(f._adProvider({ providerData: [{ providerId: 'google.com' }] })).toBe('google.com');
  });

  test('con ambos vinculados se pide la contraseña, que no abre popup', () => {
    const f = load();
    expect(f._adProvider({
      providerData: [{ providerId: 'google.com' }, { providerId: 'password' }],
    })).toBe('password');
  });

  test('sin usuario o sin proveedores devuelve null', () => {
    const f = load();
    expect(f._adProvider(null)).toBe(null);
    expect(f._adProvider({ providerData: [] })).toBe(null);
  });
});

describe('Mensajes de error', () => {
  test('cada caso que pedía el encargo tiene un mensaje propio', () => {
    const f = load();
    expect(f._adErrMsg('auth/wrong-password')).toMatch(/incorrecta/i);
    expect(f._adErrMsg('auth/network-request-failed')).toMatch(/conexi/i);
    expect(f._adErrMsg('auth/too-many-requests')).toMatch(/intentos/i);
  });

  test('un código desconocido no deja al usuario sin explicación', () => {
    const f = load();
    const m = f._adErrMsg('auth/vete-a-saber');
    expect(m).toMatch(/auth\/vete-a-saber/);
  });

  test('ningún mensaje usa alert()', () => {
    expect(SRC).not.toMatch(/\balert\s*\(/);
  });
});
