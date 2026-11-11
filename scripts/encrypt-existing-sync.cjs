#!/usr/bin/env node
'use strict';

/**
 * Finova — encrypt-existing-sync.cjs
 *
 * Cifra los BACKUPS DE SINCRONIZACIÓN (data/sync/<code>.json) que estén en
 * claro.
 *
 * Hace falta porque `handleSyncUpload` escribía el backup EN CLARO con
 * `_writeFileAtomic(destinoSync, data)`, a diferencia de /api/user-data, que sí
 * pasa por `_encryptUserData`. Corregido en server.cjs: los backups nuevos se
 * cifran (`enc1:`) y la descarga los descifra. Pero los backups subidos ANTES
 * de la corrección siguen en claro en el disco para siempre salvo que se
 * migren con este script. `handleSyncDownload` los sigue leyendo (la rama de
 * compatibilidad de `_decryptUserData` devuelve el contenido sin `enc1:` tal
 * cual), pero nadie los cifra solo.
 *
 * Por defecto SOLO INFORMA. Con --apply cifra. NO se ejecuta contra datos
 * reales sin que alguien lo pida explícitamente con --apply --backup.
 *
 *   node scripts/encrypt-existing-sync.cjs
 *   node scripts/encrypt-existing-sync.cjs --apply --backup ../copia-sync
 *
 * Hazlo con el servidor PARADO: si un usuario sube un backup a mitad, su
 * fichero puede quedar escrito en claro después de haber sido cifrado.
 *
 * ── Lo que hay que entender antes de usarlo ──
 *
 * **Si pierdes FINOVA_ENC_KEY, los datos cifrados son irrecuperables.** Es la
 * misma clave que cifra los datos de usuario. Guárdala FUERA del servidor
 * (ver ROTATE_SECRETS.md). Cambiarla deja ilegibles los ficheros ya cifrados:
 * el sobre `enc1:` no identifica con qué clave se cifró cada uno.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ─── Argumentos ───────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APLICAR = args.includes('--apply');
const idxBackup = args.indexOf('--backup');
const DIR_BACKUP = idxBackup >= 0 ? args[idxBackup + 1] : null;
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const SYNC_DIR = path.join(DATA_DIR, 'sync');

/* ─── Clave ────────────────────────────────────────────────────── */

const hex = (process.env.FINOVA_ENC_KEY || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  console.error('FINOVA_ENC_KEY no está configurada o no son 64 caracteres hexadecimales.');
  console.error('Genérala con:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('Tiene que ser la MISMA clave con la que arranca el servidor; si no, los backups');
  console.error('quedarían cifrados con una clave que el servidor no tiene y serían ilegibles.');
  process.exit(1);
}
const CLAVE = Buffer.from(hex, 'hex');

/* ─── Cifrado: EXACTAMENTE el mismo formato que server.cjs ─────── */

/*
 * Se reimplementa en vez de importar server.cjs porque requerirlo arrancaría
 * el servidor entero. El formato tiene que coincidir byte a byte, y de eso se
 * encarga la verificación de ida y vuelta de más abajo: si se separara, falla
 * y el script se para.
 */
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CLAVE, iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return 'enc1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function descifrar(dato) {
  if (!dato.startsWith('enc1:')) return dato;
  const buf = Buffer.from(dato.slice(5), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', CLAVE, buf.slice(0, 12));
  d.setAuthTag(buf.slice(12, 28));
  return d.update(buf.slice(28)) + d.final('utf8');
}

/** Escritura atómica, igual que el servidor: temporal en la MISMA carpeta. */
function escribirAtomico(ruta, contenido) {
  const tmp = path.join(path.dirname(ruta),
    path.basename(ruta) + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  try {
    fs.writeFileSync(tmp, contenido, 'utf8');
    fs.renameSync(tmp, ruta);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

/* ─── Recuento (sin asumir: se mira el contenido de cada uno) ──── */

if (!fs.existsSync(SYNC_DIR)) {
  console.log(`No existe ${SYNC_DIR}. Nada que hacer.`);
  process.exit(0);
}

const ficheros = fs.readdirSync(SYNC_DIR)
  .filter(n => n.endsWith('.json') && !/\.tmp-/.test(n));

const enClaro = [];
const yaCifrados = [];
const ilegibles = [];

for (const n of ficheros) {
  const p = path.join(SYNC_DIR, n);
  let contenido;
  try { contenido = fs.readFileSync(p, 'utf8'); } catch (e) { ilegibles.push([n, e.code || 'error']); continue; }
  if (contenido.startsWith('enc1:')) {
    // Ya cifrado: se comprueba que la clave actual lo abre. Si no, avisar es lo
    // único sensato — volver a cifrarlo encima destruiría el original.
    try { descifrar(contenido); yaCifrados.push(n); }
    catch (_) { ilegibles.push([n, 'cifrado con OTRA clave']); }
  } else {
    enClaro.push(n);
  }
}

console.log(`Directorio: ${SYNC_DIR}`);
console.log(`  backups de sync:          ${ficheros.length}`);
console.log(`  ya cifrados (clave OK):   ${yaCifrados.length}`);
console.log(`  EN CLARO:                 ${enClaro.length}`);
if (ilegibles.length) {
  console.log(`  con problemas:            ${ilegibles.length}`);
  for (const [n, motivo] of ilegibles) console.log(`      ${n} — ${motivo}`);
}

if (ilegibles.some(([, m]) => m === 'cifrado con OTRA clave')) {
  console.error('');
  console.error('PARADO: hay backups cifrados con una clave distinta de FINOVA_ENC_KEY.');
  console.error('Si sigues, esos ficheros quedarían como están y sus datos serían inaccesibles.');
  console.error('Averigua qué clave los cifró antes de continuar (ver ROTATE_SECRETS.md).');
  process.exit(1);
}

if (!enClaro.length) {
  console.log('');
  console.log('Nada que cifrar. (El script es idempotente: ejecutarlo otra vez no cambia nada.)');
  process.exit(0);
}

if (!APLICAR) {
  console.log('');
  console.log('Esto ha sido solo un informe. Para cifrarlos de verdad:');
  console.log('  node scripts/encrypt-existing-sync.cjs --apply --backup <directorio-de-copia>');
  console.log('');
  console.log('Hazlo con el servidor PARADO.');
  process.exit(0);
}

/* ─── Aplicar ──────────────────────────────────────────────────── */

if (!DIR_BACKUP) {
  console.error('');
  console.error('--apply exige --backup <directorio>. No voy a tocar backups sin copia previa.');
  process.exit(1);
}

const backup = path.resolve(DIR_BACKUP);
if (backup === SYNC_DIR || backup.startsWith(SYNC_DIR + path.sep)) {
  console.error('El directorio de copia no puede estar dentro del de sync.');
  process.exit(1);
}
fs.mkdirSync(backup, { recursive: true });
if (fs.readdirSync(backup).length) {
  console.error(`El directorio de copia no está vacío: ${backup}`);
  console.error('Usa uno vacío, para que no se mezcle con una copia anterior.');
  process.exit(1);
}

console.log('');
console.log(`Copiando ${enClaro.length} backup(s) a ${backup} …`);
for (const n of enClaro) fs.copyFileSync(path.join(SYNC_DIR, n), path.join(backup, n));
console.log('Copia hecha.');

let hechos = 0;
const fallos = [];
for (const n of enClaro) {
  const p = path.join(SYNC_DIR, n);
  try {
    const original = fs.readFileSync(p, 'utf8');
    const cifrado = cifrar(original);

    // Verificación ANTES de escribir: si el resultado no se descifra al
    // original exacto, no se toca el fichero.
    if (descifrar(cifrado) !== original) throw new Error('la verificación de ida y vuelta no coincide');

    escribirAtomico(p, cifrado);

    // Y otra vez DESPUÉS, leyendo del disco: cubre una escritura parcial o un
    // problema de codificación que la comprobación en memoria no vería.
    const releido = fs.readFileSync(p, 'utf8');
    if (descifrar(releido) !== original) throw new Error('lo escrito en disco no se descifra al original');

    hechos++;
  } catch (e) {
    fallos.push([n, e.message]);
  }
}

console.log('');
console.log(`Cifrados: ${hechos} de ${enClaro.length}`);
if (fallos.length) {
  console.error('Fallos:');
  for (const [n, m] of fallos) console.error(`  ${n} — ${m}`);
  console.error('');
  console.error(`Los originales de TODOS están en ${backup}.`);
  process.exit(1);
}
console.log('');
console.log(`Los originales en claro siguen en ${backup}.`);
console.log('Compruébalo descargando un backup con la app. Cuando lo confirmes, BORRA esa copia:');
console.log('son datos financieros sin cifrar.');
