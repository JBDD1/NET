/**
 * Finova — account-delete.test.js
 * Borrado de cuenta en servidor (RGPD art. 17).
 *
 * Se prueba _deleteAccountData contra un directorio temporal con datos
 * falsos, extrayendo la funcion REAL de server.cjs (no una copia). Lo que
 * importa aqui no es que borre: es que no se deje nada, que no toque datos
 * de otro usuario, y que reintentarla no explote.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import vm from 'vm';

const SERVER = fs.readFileSync(path.join(process.cwd(), 'server.cjs'), 'utf8');

/** Saca una declaracion de funcion completa contando llaves. */
function extractFn(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m  = src.match(re);
  if (!m) throw new Error('no se encontro la funcion ' + name + ' en server.cjs');
  const start = m.index;
  // Hay que saltar la lista de parametros contando parentesis: con una firma
  // como (uid, opts = {}) el primer '{' del fichero pertenece al valor por
  // defecto, no al cuerpo, y contar llaves desde ahi cierra de inmediato.
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

let TMP, ctx, fns;

function seed(uid, { otherUid = 'otro-usuario-999' } = {}) {
  const users = path.join(TMP, 'users');
  const sync  = path.join(TMP, 'sync');
  fs.mkdirSync(users, { recursive: true });
  fs.mkdirSync(sync,  { recursive: true });

  const w = (f, o) => fs.writeFileSync(path.join(TMP, f), JSON.stringify(o), 'utf8');

  // Datos del usuario que se va a borrar
  fs.writeFileSync(path.join(users, uid + '.json'), 'enc1:blobcifrado', 'utf8');
  fs.writeFileSync(path.join(users, uid + '.meta.json'), JSON.stringify({
    email: 'Victima@Test.com', displayName: 'Carlos', lastAccess: '2026-10-30T10:00:00Z',
  }), 'utf8');
  fs.writeFileSync(path.join(users, uid + '.blocked'), '', 'utf8');

  // Y los del vecino, que NO se deben tocar
  fs.writeFileSync(path.join(users, otherUid + '.json'), 'enc1:ajeno', 'utf8');
  fs.writeFileSync(path.join(users, otherUid + '.meta.json'),
    JSON.stringify({ email: 'vecino@test.com' }), 'utf8');

  fs.writeFileSync(path.join(sync, 'aaaaaaaaaaaa.json'), '{"transactions":[]}', 'utf8');
  fs.writeFileSync(path.join(sync, 'bbbbbbbbbbbb.json'), '{"transactions":[]}', 'utf8');
  fs.writeFileSync(path.join(sync, 'cccccccccccc.json'), '{"ajeno":true}', 'utf8');

  w('sync_owners.json', {
    aaaaaaaaaaaa: { uid, createdAt: 1 },
    bbbbbbbbbbbb: { uid, createdAt: 2 },
    cccccccccccc: { uid: otherUid, createdAt: 3 },
  });
  w('roles.json',       { [uid]: 'premium', [otherUid]: 'free' });
  w('ratelimit.json',   { aiUidBuckets: { ['ai-uid:' + uid]: { tokens: 2 }, ['ai-uid:' + otherUid]: { tokens: 5 } }, savedAt: 1 });
  w('bank_requisitions.json', {
    'req-1': { uid, createdAt: 1 },
    'req-2': { uid, createdAt: 2 },
    'req-3': { uid: otherUid, createdAt: 3 },
  });
  w('extra_admins.json', ['victima@test.com', 'jefe@test.com']);
  w('waitlist.json', [
    { email: 'victima@test.com', date: '2026-01-01', ip: '1.2.3.4' },
    { email: 'otro@test.com',    date: '2026-01-02', ip: '5.6.7.8' },
  ]);
  w('analytics.json', {
    '11111111-1111-1111-1111-111111111111': { firstSeen: '2026-01-01', txCount: 40 },
    '22222222-2222-2222-2222-222222222222': { firstSeen: '2026-01-02', txCount: 7 },
  });

  return { users, sync };
}

function dirs() {
  return { users: path.join(TMP, 'users'), sync: path.join(TMP, 'sync'), data: TMP };
}
const readJson = f => JSON.parse(fs.readFileSync(path.join(TMP, f), 'utf8'));

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'finova-del-'));
  const gcCalls = [];
  ctx = vm.createContext({
    fs, path, crypto, console: { error() {}, warn() {}, log() {} },
    // Con dirs pasado, estos nunca se evaluan; estan por si acaso.
    USERS_DIR: path.join(TMP, 'users'), SYNC_DIR: path.join(TMP, 'sync'), ROOT: TMP,
    _buckets: new Map(),
    GC_SECRET_ID: '', GC_SECRET_KEY: '',
    _gcGetToken: async () => 'tok',
    _gcRaw: async (m, p) => { gcCalls.push(m + ' ' + p); return { status: 200, body: '{}' }; },
    __gcCalls: gcCalls,
  });
  vm.runInContext(
    extractFn(SERVER, '_getSyncOwnersFrom') + '\n' + extractFn(SERVER, '_deleteAccountData'),
    ctx, { filename: 'server.cjs' }
  );
  fns = vm.runInContext('({ _deleteAccountData })', ctx);
});

afterEach(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

describe('Borrado de cuenta — no queda nada del usuario', () => {
  const UID = 'uid-victima-123';

  test('borra los tres ficheros directos del uid', async () => {
    const { users } = seed(UID);
    await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(fs.existsSync(path.join(users, UID + '.json'))).toBe(false);
    expect(fs.existsSync(path.join(users, UID + '.meta.json'))).toBe(false);
    expect(fs.existsSync(path.join(users, UID + '.blocked'))).toBe(false);
  });

  test('borra sus backups de sync y el registro de propiedad', async () => {
    const { sync } = seed(UID);
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(r.syncCodes).toBe(2);
    expect(fs.existsSync(path.join(sync, 'aaaaaaaaaaaa.json'))).toBe(false);
    expect(fs.existsSync(path.join(sync, 'bbbbbbbbbbbb.json'))).toBe(false);
    expect(Object.keys(readJson('sync_owners.json'))).toEqual(['cccccccccccc']);
  });

  test('quita el rol y el cubo de rate limit', async () => {
    seed(UID);
    await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(UID in readJson('roles.json')).toBe(false);
    expect('ai-uid:' + UID in readJson('ratelimit.json').aiUidBuckets).toBe(false);
  });

  test('quita sus requisitions bancarias', async () => {
    seed(UID);
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(r.bankRequisitions).toBe(2);
    expect(Object.keys(readJson('bank_requisitions.json'))).toEqual(['req-3']);
  });

  test('resuelve el email desde el meta para limpiar lo indexado por correo', async () => {
    // extra_admins y waitlist no van por uid: si no se lee el meta ANTES de
    // borrarlo, el email ya no hay de donde sacarlo y quedan ahi para siempre.
    seed(UID);
    await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(readJson('extra_admins.json')).toEqual(['jefe@test.com']);
    expect(readJson('waitlist.json').map(e => e.email)).toEqual(['otro@test.com']);
  });

  test('el email se compara sin distinguir mayusculas', async () => {
    // El meta guarda "Victima@Test.com" y las listas "victima@test.com".
    seed(UID);
    await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(readJson('waitlist.json')).toHaveLength(1);
  });

  test('borra la fila de analitica del clientId que manda el cliente', async () => {
    seed(UID);
    await fns._deleteAccountData(UID, {
      dirs: dirs(), clientId: '11111111-1111-1111-1111-111111111111',
    });
    expect(Object.keys(readJson('analytics.json')))
      .toEqual(['22222222-2222-2222-2222-222222222222']);
  });

  test('un clientId con formato invalido se ignora en vez de borrar nada', async () => {
    seed(UID);
    await fns._deleteAccountData(UID, { dirs: dirs(), clientId: '../../etc/passwd' });
    expect(Object.keys(readJson('analytics.json'))).toHaveLength(2);
  });
});

describe('Borrado de cuenta — no toca datos ajenos', () => {
  const UID = 'uid-victima-123';
  const OTHER = 'otro-usuario-999';

  test('el vecino conserva blob, meta, rol, cubo, sync y requisition', async () => {
    const { users, sync } = seed(UID, { otherUid: OTHER });
    await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(fs.existsSync(path.join(users, OTHER + '.json'))).toBe(true);
    expect(fs.existsSync(path.join(users, OTHER + '.meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(sync, 'cccccccccccc.json'))).toBe(true);
    expect(readJson('roles.json')[OTHER]).toBe('free');
    expect(readJson('ratelimit.json').aiUidBuckets['ai-uid:' + OTHER]).toBeTruthy();
    expect(readJson('bank_requisitions.json')['req-3'].uid).toBe(OTHER);
  });
});

describe('Borrado de cuenta — idempotente', () => {
  const UID = 'uid-victima-123';

  test('borrar dos veces seguidas no da error', async () => {
    seed(UID);
    const r1 = await fns._deleteAccountData(UID, { dirs: dirs() });
    const r2 = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(r1.errors).toEqual([]);
    expect(r2.errors).toEqual([]);     // nada que borrar != error
    expect(r2.removedFiles).toEqual([]);
    expect(r2.syncCodes).toBe(0);
  });

  test('borrar un uid que nunca existio no da error', async () => {
    seed(UID);
    const r = await fns._deleteAccountData('uid-que-no-existe', { dirs: dirs() });
    expect(r.errors).toEqual([]);
    expect(r.removedFiles).toEqual([]);
  });

  test('con el directorio de datos vacio tampoco falla', async () => {
    fs.mkdirSync(path.join(TMP, 'users'), { recursive: true });
    fs.mkdirSync(path.join(TMP, 'sync'),  { recursive: true });
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(r.errors).toEqual([]);
  });

  test('un JSON corrupto se reporta pero no detiene el resto del borrado', async () => {
    const { users } = seed(UID);
    fs.writeFileSync(path.join(TMP, 'roles.json'), '{esto no es json', 'utf8');
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(r.errors.some(e => e.includes('roles'))).toBe(true);
    // Lo importante: los ficheros del usuario SI se borraron.
    expect(fs.existsSync(path.join(users, UID + '.json'))).toBe(false);
    expect(readJson('bank_requisitions.json')['req-1']).toBeUndefined();
  });
});

describe('Borrado de cuenta — GoCardless', () => {
  const UID = 'uid-victima-123';

  test('sin credenciales configuradas no se llama al proveedor', async () => {
    seed(UID);
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(vm.runInContext('__gcCalls', ctx)).toEqual([]);
    expect(r.bankRevokedAtProvider).toBe(0);
    // Pero la referencia local se borra igual.
    expect(readJson('bank_requisitions.json')['req-1']).toBeUndefined();
  });

  test('con credenciales se pide borrar cada requisition al proveedor', async () => {
    seed(UID);
    vm.runInContext("GC_SECRET_ID = 'id'; GC_SECRET_KEY = 'key';", ctx);
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    const calls = vm.runInContext('__gcCalls', ctx);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^DELETE \/api\/v2\/requisitions\/req-/);
    expect(r.bankRevokedAtProvider).toBe(2);
  });

  test('un 404 del proveedor cuenta como borrado, no como fallo', async () => {
    seed(UID);
    vm.runInContext(`
      GC_SECRET_ID = 'id'; GC_SECRET_KEY = 'key';
      _gcRaw = async () => ({ status: 404, body: '' });
    `, ctx);
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(r.bankRevokedAtProvider).toBe(2);
    expect(r.errors).toEqual([]);
  });

  test('si el proveedor falla se reporta, y la referencia local ya esta borrada', async () => {
    seed(UID);
    vm.runInContext(`
      GC_SECRET_ID = 'id'; GC_SECRET_KEY = 'key';
      _gcRaw = async () => ({ status: 500, body: '' });
    `, ctx);
    const r = await fns._deleteAccountData(UID, { dirs: dirs() });
    expect(r.errors).toHaveLength(2);
    expect(readJson('bank_requisitions.json')['req-1']).toBeUndefined();
  });
});

/**
 * Exigencia de login reciente. El camino completo del endpoint necesita un
 * token firmado por Firebase, que no se puede falsificar en un test, asi que
 * la comprobacion vive en una funcion pura y se prueba aqui directamente.
 */
describe('Login reciente — _isReauthFresh', () => {
  let fresh, MAX;
  beforeEach(() => {
    const c = vm.createContext({});
    const m = SERVER.match(/const _REAUTH_MAX_AGE_SEC = (\d+)/);
    MAX = Number(m[1]);
    vm.runInContext(
      'const _REAUTH_MAX_AGE_SEC = ' + MAX + ';\n' + extractFn(SERVER, '_isReauthFresh'),
      c
    );
    fresh = vm.runInContext('_isReauthFresh', c);
  });

  const NOW = 1_800_000_000;

  test('el umbral son 5 minutos', () => {
    expect(MAX).toBe(300);
  });

  test('un login de hace un instante vale', () => {
    expect(fresh(NOW, NOW)).toBe(true);
  });

  test('justo en el limite vale; un segundo mas, no', () => {
    expect(fresh(NOW - MAX,     NOW)).toBe(true);
    expect(fresh(NOW - MAX - 1, NOW)).toBe(false);
  });

  test('un login de hace una hora se rechaza', () => {
    expect(fresh(NOW - 3600, NOW)).toBe(false);
  });

  test('sin auth_time se rechaza, no se da por bueno', () => {
    // Si faltara y se tratara como 0, la resta daria una edad enorme y
    // saldria false igual; pero undefined/null/'' tienen que fallar de forma
    // explicita, no por accidente aritmetico.
    for (const v of [undefined, null, '', 0, NaN, 'ayer', {}, []]) {
      expect(fresh(v, NOW)).toBe(false);
    }
  });

  test('un auth_time en el futuro se rechaza', () => {
    // Reloj desajustado o token manipulado: ante la duda, reautenticar.
    expect(fresh(NOW + 60, NOW)).toBe(false);
  });

  test('acepta auth_time como cadena numerica', () => {
    expect(fresh(String(NOW - 10), NOW)).toBe(true);
  });
});
