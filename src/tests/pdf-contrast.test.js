/**
 * Finova — pdf-contrast.test.js
 * La paleta del PDF (_PDF en src/utils/pdf.js) pasó de tema claro a oscuro.
 * Al invertirla, 5 sitios que pintaban texto con _PDF.dark2 (casi negro,
 * correcto sobre crema) quedaron escribiendo negro sobre negro: invisible.
 *
 * Este test fija los pares (superficie, texto) que usa el diseño y exige un
 * contraste mínimo legible, para que el próximo cambio de tema no vuelva a
 * dejar texto del color del fondo sin que nadie se entere hasta abrir el PDF.
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/utils/pdf.js'), 'utf8');

// Extrae solo el objeto _PDF, sin ejecutar el resto del módulo (que necesita
// window, showToast, APP…).
const m = /const _PDF = \{[\s\S]*?\n\};/.exec(SRC);
if (!m) throw new Error('No se encontró el objeto _PDF en pdf.js');
const _PDF = vm.runInNewContext(m[0] + '\n_PDF');

/** Luminancia relativa WCAG 2.1 a partir de un [r,g,b] 0-255. */
function luminance([r, g, b]) {
  const ch = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* Pares que el diseño pinta de verdad: [nombre, texto, superficie, mínimo].
   3:1 es el umbral WCAG para texto grande y para elementos gráficos; los
   importes y titulares del PDF son de 9pt o más y en negrita, pero se exige
   4.5:1 al texto corrido (insights, filas de tabla) por ser el que de verdad
   se lee seguido. */
const PAIRS = [
  ['texto sobre tarjeta KPI',        _PDF.kpiVal,    _PDF.kpiBg,     4.5],
  ['etiqueta sobre tarjeta KPI',     _PDF.kpiFg,     _PDF.kpiBg,     3],
  ['texto de insights sobre caja',   _PDF.onSurface, _PDF.kpiBg,     4.5],
  ['título de sección sobre banda',  _PDF.onSurface, _PDF.sectionBg, 4.5],
  ['fila par de tabla',              _PDF.onSurface, _PDF.rowEven,   4.5],
  ['fila impar de tabla',            _PDF.onSurface, _PDF.rowOdd,    4.5],
  ['cabecera de tabla',              _PDF.cream,     _PDF.dark2,     4.5],
  ['texto por defecto sobre página', _PDF.kpiVal,    _PDF.pageBg,    4.5],
  ['dorado sobre página',            _PDF.gold,      _PDF.pageBg,    3],
  ['ganancia sobre página',          _PDF.gain,      _PDF.pageBg,    3],
  ['pérdida sobre página',           _PDF.loss,      _PDF.pageBg,    3],
  ['pérdida sobre su caja suave',    _PDF.loss,      _PDF.lossSoft,  3],
  ['ganancia sobre su caja suave',   _PDF.gain,      _PDF.gainSoft,  3],
  ['pie de página',                  _PDF.muted,     _PDF.dark,      3],
];

describe('Paleta del PDF — contraste legible', () => {
  test.each(PAIRS)('%s', (_name, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  test('ningún color de texto coincide con su superficie (el bug que hubo)', () => {
    const same = PAIRS.filter(([, fg, bg]) => fg.join() === bg.join());
    expect(same).toEqual([]);
  });

  test('_PDF.pageBg existe — sin él jsPDF deja las páginas en blanco', () => {
    expect(Array.isArray(_PDF.pageBg)).toBe(true);
    expect(_PDF.pageBg).toHaveLength(3);
    // Y es oscuro de verdad: el tema depende de ello
    expect(luminance(_PDF.pageBg)).toBeLessThan(0.1);
  });
});
