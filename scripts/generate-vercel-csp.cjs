#!/usr/bin/env node
'use strict';

/**
 * Finova — generate-vercel-csp.cjs
 *
 * Escribe la cabecera Content-Security-Policy de vercel.json a partir de la
 * FUENTE ÚNICA csp.config.cjs. vercel.json no puede ejecutar JS, así que el
 * valor se genera aquí y se commitea; Vercel lee el fichero ya commiteado al
 * desplegar.
 *
 * IMPORTANTE: no edites a mano el "value" de la cabecera Content-Security-Policy
 * en vercel.json. Cámbialo en csp.config.cjs y vuelve a ejecutar este script:
 *
 *   node scripts/generate-vercel-csp.cjs           # actualiza vercel.json
 *   node scripts/generate-vercel-csp.cjs --check    # NO escribe; sale 1 si difiere
 *
 * tests/csp-sync.test.cjs falla si vercel.json deja de coincidir con la config,
 * así que una divergencia se detecta en CI antes de desplegar.
 */

const fs = require('fs');
const path = require('path');
const { buildCSP } = require('../csp.config.cjs');

const VERCEL = path.resolve(__dirname, '..', 'vercel.json');
const SOLO_CHECK = process.argv.includes('--check');

const esperado = buildCSP();

const texto = fs.readFileSync(VERCEL, 'utf8');

// Leer el valor actual SIN reformatear el resto del fichero: se reemplaza solo
// la cadena del "value" de la cabecera CSP con un reemplazo de texto dirigido.
// El valor de la CSP no contiene comillas dobles ni barras invertidas, así que
// [^"]* captura la cadena entera sin ambigüedad.
const RE = /("key"\s*:\s*"Content-Security-Policy"\s*,\s*"value"\s*:\s*)"([^"]*)"/;
const m = texto.match(RE);
if (!m) {
  console.error('No se encontró la cabecera Content-Security-Policy en vercel.json.');
  process.exit(1);
}
const actual = m[2];

if (actual === esperado) {
  console.log('vercel.json ya está sincronizado con csp.config.cjs. Nada que hacer.');
  process.exit(0);
}

if (SOLO_CHECK) {
  console.error('DESINCRONIZADO: la CSP de vercel.json no coincide con csp.config.cjs.');
  console.error('Ejecuta:  node scripts/generate-vercel-csp.cjs');
  process.exit(1);
}

// Solo se sustituye la cadena del value (JSON.stringify garantiza el escapado
// correcto); el resto del fichero —formato, otras cabeceras— no se toca.
const nuevo = texto.replace(RE, (_full, prefijo) => prefijo + JSON.stringify(esperado));
// Comprobación de cordura: debe seguir siendo JSON válido.
JSON.parse(nuevo);
fs.writeFileSync(VERCEL, nuevo, 'utf8');
console.log('vercel.json actualizado: cabecera Content-Security-Policy regenerada desde csp.config.cjs.');
