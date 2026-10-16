/**
 * Finova — csv-encoding.test.js
 * _detectCsvEncoding() (src/core/script.js) — el importador de extractos leía
 * SIEMPRE como UTF-8. Los bancos españoles tradicionales (Santander,
 * CaixaBank, Sabadell, Unicaja, Bankinter) exportan en Windows-1252, así que
 * "NÓMINA" llegaba como "N<?>MINA": además de verse mal, el carácter de
 * reemplazo impide que la categorización encuentre 'nomina' (el byte original
 * ya se ha perdido, quitar tildes no lo recupera).
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
// jsdom no expone TextDecoder/TextEncoder como globals; en el navegador real sí
// existen. Se traen de node:util solo para el entorno de test.
import { TextDecoder, TextEncoder } from 'node:util';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');

// Extrae solo la función, sin ejecutar los 4.000+ lines del archivo entero.
function extract(name) {
  const re = new RegExp('(?:^|\\n)function\\s+' + name + '\\b');
  const m = re.exec(SRC);
  if (!m) throw new Error('no encontrada: ' + name);
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
  const rest  = SRC.slice(start + 1);
  const next  = /\n(?:function|const|let|\/\* ═)/.exec(rest);
  return SRC.slice(start, next ? start + 1 + next.index : SRC.length);
}

const ctx = vm.createContext({ TextDecoder, Uint8Array, console });
vm.runInContext(extract('_detectCsvEncoding'), ctx, { filename: 'detect.js' });
const detect = vm.runInContext('_detectCsvEncoding', ctx);

/** "NÓMINA" en Windows-1252: la Ó es un único byte 0xD3, inválido en UTF-8. */
const W1252_NOMINA = new Uint8Array([0x4E, 0xD3, 0x4D, 0x49, 0x4E, 0x41]);
const UTF8_NOMINA  = new TextEncoder().encode('NÓMINA');

describe('_detectCsvEncoding — extractos de bancos españoles', () => {
  test('bytes Windows-1252 (Santander/CaixaBank) → windows-1252', () => {
    expect(detect(W1252_NOMINA.buffer)).toBe('windows-1252');
  });

  test('bytes UTF-8 válidos (Revolut/N26) → utf-8', () => {
    expect(detect(UTF8_NOMINA.buffer)).toBe('utf-8');
  });

  test('BOM UTF-8 (Excel exporta así) → utf-8', () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF, ...UTF8_NOMINA]);
    expect(detect(bom.buffer)).toBe('utf-8');
  });

  test('BOM UTF-16 LE → utf-16le', () => {
    expect(detect(new Uint8Array([0xFF, 0xFE, 0x4E, 0x00]).buffer)).toBe('utf-16le');
  });

  test('ASCII puro → utf-8 (es UTF-8 válido, no hace falta adivinar)', () => {
    expect(detect(new TextEncoder().encode('Fecha;Concepto;Importe').buffer)).toBe('utf-8');
  });

  test('el resultado hace que la descripción se lea bien (regresión completa)', () => {
    const roto = new TextDecoder('utf-8').decode(W1252_NOMINA);
    const bien = new TextDecoder(detect(W1252_NOMINA.buffer)).decode(W1252_NOMINA);
    expect(roto).not.toBe('NÓMINA');          // lo que pasaba antes
    expect(bien).toBe('NÓMINA');              // lo que pasa ahora
    // Y, lo importante: ahora la categorización puede encontrar 'nomina'
    const norm = s => s.toLowerCase().normalize('NFD')
      .split('').filter(c => { const n = c.charCodeAt(0); return n < 768 || n > 879; }).join('');
    expect(norm(roto)).not.toContain('nomina');
    expect(norm(bien)).toContain('nomina');
  });
});
