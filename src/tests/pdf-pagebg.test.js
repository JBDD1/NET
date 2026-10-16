/**
 * Finova — pdf-pagebg.test.js
 * El tema oscuro del PDF depende de que TODAS las páginas lleven fondo
 * pintado: jsPDF las crea en blanco. Hay tres formas de que nazca una página
 * y las tres tienen que quedar cubiertas:
 *   1. La primera, al crear el documento (_pdfGetDoc).
 *   2. Las 14 llamadas manuales a doc.addPage() repartidas por los informes.
 *   3. Las que crea AutoTable sola cuando una tabla no cabe (willDrawPage).
 *
 * Si alguna se escapa, el PDF sale con franjas blancas — y es el tipo de
 * fallo que solo se ve abriendo el archivo. Aquí se comprueba con un doble
 * de jsPDF que registra las operaciones, sin necesitar la librería real.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/utils/pdf.js'), 'utf8');

/** Doble de jsPDF: solo registra lo que se le pide dibujar. */
function makeDocSpy() {
  const ops = [];
  let page = 1;
  const doc = {
    _ops: ops,
    internal: {
      pageSize: { getWidth: () => 210, getHeight: () => 297 },
      getNumberOfPages: () => page,
    },
    setFillColor: (...c) => ops.push({ op: 'fill', page, color: c }),
    setTextColor: () => {},
    setDrawColor: () => {},
    setLineWidth: () => {},
    setFont: () => {}, setFontSize: () => {},
    rect:  (x, y, w, h) => ops.push({ op: 'rect', page, x, y, w, h }),
    roundedRect: () => {}, circle: () => {}, line: () => {},
    text: () => {}, splitTextToSize: t => [t],
    setPage: p => { page = p; },
    addPage: () => { page++; ops.push({ op: 'addPage', page }); },
  };
  return doc;
}

let ctx, fns;
beforeEach(() => {
  ctx = vm.createContext({
    window: { jspdf: { jsPDF: function () { return makeDocSpy(); } } },
    document: { createElement: () => ({}), head: { appendChild() {} } },
    showToast: () => {}, console, APP: {},
  });
  vm.runInContext(SRC, ctx, { filename: 'pdf.js' });
  fns = vm.runInContext('({ _pdfGetDoc, _pdfPageBg, TABLE_OPT, _PDF })', ctx);
});

/** ¿Se pintó un rectángulo que cubre la página entera en esta página? */
function hasFullPageBg(doc, pageNum) {
  const ops = doc._ops;
  return ops.some((o, i) =>
    o.op === 'rect' && o.page === pageNum && o.x === 0 && o.y === 0 && o.w === 210 && o.h === 297 &&
    // el setFillColor inmediatamente anterior debe ser el color de fondo
    [...ops.slice(0, i)].reverse().find(p => p.op === 'fill')?.color.join() === fns._PDF.pageBg.join()
  );
}

describe('Fondo de página del PDF oscuro', () => {
  test('la página 1 nace con el fondo pintado', () => {
    const doc = fns._pdfGetDoc();
    expect(hasFullPageBg(doc, 1)).toBe(true);
  });

  test('cada doc.addPage() manual pinta también su fondo', () => {
    const doc = fns._pdfGetDoc();
    doc.addPage();
    expect(hasFullPageBg(doc, 2)).toBe(true);
    doc.addPage();
    expect(hasFullPageBg(doc, 3)).toBe(true);
  });

  test('addPage sigue devolviendo lo que devolvía (no rompe a quien use el valor)', () => {
    const doc = fns._pdfGetDoc();
    expect(() => doc.addPage()).not.toThrow();
    expect(doc.internal.getNumberOfPages()).toBe(2);
  });

  test('AutoTable pinta el fondo en las páginas que crea sola (willDrawPage)', () => {
    // AutoTable no llama a doc.addPage() del documento envuelto, crea la
    // página por dentro: por eso hace falta el hook, no basta el wrapper.
    expect(typeof fns.TABLE_OPT.willDrawPage).toBe('function');
    const doc = makeDocSpy();
    doc.addPage(); // simula la página que crea AutoTable
    fns.TABLE_OPT.willDrawPage({ doc });
    expect(hasFullPageBg(doc, 2)).toBe(true);
  });

  test('willDrawPage, no didDrawPage: pintar después taparía la tabla', () => {
    expect(fns.TABLE_OPT.didDrawPage).toBeUndefined();
  });
});
