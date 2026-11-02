#!/usr/bin/env node
'use strict';

/**
 * Finova — encrypt-existing-data.cjs
 *
 * Cifra los ficheros de usuario que estén en claro.
 *
 * Hace falta porque antes `_encryptUserData` devolvía el texto tal cual
 * cuando `FINOVA_ENC_KEY` no estaba configurada, **sin avisar**. Cualquier
 * despliegue que arrancara sin la clave guardó los datos financieros en
 * claro, y ahora que el servidor exige la clave esos ficheros se siguen
 * leyendo (la rama de compatibilidad está a propósito) pero nadie los cifra.
 *
 * Por defecto SOLO INFORMA. Con --apply cifra.
 *
 *   node scripts/encrypt-existing-data.cjs
 *   node scripts/encrypt-existing-data.cjs --apply --backup ../copia-finova
 *
 * ── Lo que hay que entender antes de usarlo ──
 *
 * **Si pierdes FINOVA_ENC_KEY, los datos cifrados son irrecuperables.** No
 * hay puerta de atrás: AES-256-GCM con una clave de 32 bytes no se fuerza.
 * Guárdala en un gestor de contraseñas FUERA del servidor, no solo en las
 * variables de entorno del hosting: si pierdes el acceso al panel, pierdes
 * la clave y con ella los datos de todos los usuarios.
 *
 * **Y cambiarla tiene el mismo efecto.** El sobre es `enc1:` + iv + tag +
 * datos, y `enc1` es la versión del FORMATO, no un identificador de clave:
 * no hay forma de saber con qué clave se cifró cada fichero. Ver
 * ROTATE_SECRETS.md.
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
const USERS_DIR = path.join(DATA_DIR, 'users');

/* ─── Clave ────────────────────────────────────────────────────── */

const hex = (process.env.FINOVA_ENC_KEY || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  console.error('FINOVA_ENC_KEY no está configurada o no son 64 caracteres hexadecimales.');
  console.error('Genérala con:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('Y guárdala en un gestor de contraseñas FUERA del servidor: sin ella, los datos');
  console.error('que cifres con este script son irrecuperables.');
  process.exit(1);
}
const CLAVE = Buffer.from(hex, 'hex');

/* ─── Cifrado: EXACTAMENTE el mismo formato que server.cjs ─────── */

/*
 * Se reimplementa en vez de importar server.cjs porque requerirlo arrancaría
 * el servidor entero (abre el puerto, valida el entorno, lanza los
 * temporizadores). El formato tiene que coincidir byte a byte, y de eso se
 * encarga la verificación de ida y vuelta de más abajo: si el formato se
 * separara, la comprobación falla y el script se para.
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

/* ─── Recuento ─────────────────────────────────────────────────── */

if (!fs.existsSync(USERS_DIR)) {
  console.log(`No existe ${USERS_DIR}. Nada que hacer.`);
  process.exit(0);
}

const ficheros = fs.readdirSync(USERS_DIR)
  .filter(n => n.endsWith('.json') && !n.endsWith('.meta.json') && !/\.tmp-/.test(n));

const enClaro = [];
const yaCifrados = [];
const ilegibles = [];

for (const n of ficheros) {
  const p = path.join(USERS_DIR, n);
  let contenido;
  try { contenido = fs.readFileSync(p, 'utf8'); } catch (e) { ilegibles.push([n, e.code || 'error']); continue; }
  if (contenido.startsWith('enc1:')) {
    // Ya cifrado: se comprueba que la clave actual lo abre. Si no, avisar es
    // lo único sensato — volver a cifrarlo encima destruiría el original.
    try { descifrar(contenido); yaCifrados.push(n); }
    catch (_) { ilegibles.push([n, 'cifrado con OTRA clave']); }
  } else {
    enClaro.push(n);
  }
}

console.log(`Directorio: ${USERS_DIR}`);
console.log(`  ficheros de usuario:      ${ficheros.length}`);
console.log(`  ya cifrados (clave OK):   ${yaCifrados.length}`);
console.log(`  EN CLARO:                 ${enClaro.length}`);
if (ilegibles.length) {
  console.log(`  con problemas:            ${ilegibles.length}`);
  for (const [n, motivo] of ilegibles) console.log(`      ${n} — ${motivo}`);
}

if (ilegibles.some(([, m]) => m === 'cifrado con OTRA clave')) {
  console.error('');
  console.error('PARADO: hay ficheros cifrados con una clave distinta de FINOVA_ENC_KEY.');
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
  console.log('  node scripts/encrypt-existing-data.cjs --apply --backup <directorio-de-copia>');
  console.log('');
  console.log('Hazlo con el servidor PARADO: si un usuario guarda a mitad, su fichero puede');
  console.log('quedar escrito en claro después de haber sido cifrado.');
  process.exit(0);
}

/* ─── Aplicar ──────────────────────────────────────────────────── */

if (!DIR_BACKUP) {
  console.error('');
  console.error('--apply exige --backup <directorio>. No voy a tocar datos de usuario sin copia.');
  process.exit(1);
}

const backup = path.resolve(DIR_BACKUP);
if (backup === USERS_DIR || backup.startsWith(USERS_DIR + path.sep)) {
  console.error('El directorio de copia no puede estar dentro del de usuarios.');
  process.exit(1);
}
fs.mkdirSync(backup, { recursive: true });
if (fs.readdirSync(backup).length) {
  console.error(`El directorio de copia no está vacío: ${backup}`);
  console.error('Usa uno vacío, para que no se mezcle con una copia anterior.');
  process.exit(1);
}

console.log('');
console.log(`Copiando ${enClaro.length} fichero(s) a ${backup} …`);
for (const n of enClaro) fs.copyFileSync(path.join(USERS_DIR, n), path.join(backup, n));
console.log('Copia hecha.');

let hechos = 0;
const fallos = [];
for (const n of enClaro) {
  const p = path.join(USERS_DIR, n);
  try {
    const original = fs.readFileSync(p, 'utf8');
    const cifrado = cifrar(original);

    // Verificación ANTES de escribir: si el resultado no se descifra al
    // original exacto, no se toca el fichero.
    if (descifrar(cifrado) !== original) throw new Error('la verificación de ida y vuelta no coincide');

    escribirAtomico(p, cifrado);

    // Y otra vez DESPUÉS, leyendo del disco: cubre un fallo de escritura
    // parcial o de codificación que la comprobación en memoria no vería.
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
console.log('Compruébalo arrancando el servidor y abriendo la app con una cuenta real.');
console.log('Cuando lo hayas confirmado, BORRA esa copia: son datos financieros sin cifrar.');
