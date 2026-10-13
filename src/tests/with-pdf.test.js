/**
 * Finova — with-pdf.test.js
 * _withPdf() (src/core/script.js) — el wrapper que todos los botones de
 * exportar a PDF comparten (dashboard, Ajustes→backup, Fiscalidad, el
 * aviso mensual). Carga la función REAL vía vm, aislada de su alrededor
 * mediante extracción por nombre.
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SCRIPT = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');

function extract(name) {
  const re = new RegExp('(?:^|\\n)(?:async )?function\\s+' + name + '\\b');
  const m = re.exec(SCRIPT);
  if (!m) throw new Error('no encontrado: ' + name);
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
  const rest = SCRIPT.slice(start + 1);
  const next = /\n(?:async function|function|const|let|\/\* ═)/.exec(rest);
  return SCRIPT.slice(start, next ? start + 1 + next.index : SCRIPT.length);
}

let ctx, calls;

function load({ demoMode = false, alreadyLoaded = true, lazyLoadFails = false, fnThrows = false } = {}) {
  calls = { requireAccountFor: [], lazyLoad: [], toasts: [], fn: 0 };
  const stubs = {
    requireAccountFor: (label) => { calls.requireAccountFor.push(label); return !demoMode; },
    _lazyLoad: (src) => {
      calls.lazyLoad.push(src);
      if (lazyLoadFails) return Promise.reject(new Error('network'));
      // Simula lo que hace _lazyLoad de verdad: inyectar el <script> define
      // la función en el global — sin esto, _withPdf encontraría
      // window.exportMonthlyPDF indefinida incluso después de "cargar".
      stubs.window.exportMonthlyPDF = async () => { calls.fn++; if (fnThrows) throw new Error('boom'); };
      return Promise.resolve();
    },
    _LAZY_SCRIPTS: { pdf: 'src/utils/pdf.js' },
    showToast: (msg) => calls.toasts.push(msg),
    window: {
      exportMonthlyPDF: async () => {
        calls.fn++;
        if (fnThrows) throw new Error('boom');
      },
    },
  };
  if (alreadyLoaded) stubs.window.exportMonthlyPDF = stubs.window.exportMonthlyPDF;
  else delete stubs.window.exportMonthlyPDF;

  ctx = vm.createContext(Object.assign({}, global, stubs));
  vm.runInContext(extract('_withPdf'), ctx, { filename: '_withPdf.js' });
  return vm.runInContext('_withPdf', ctx);
}

function fakeBtn(html) {
  return { innerHTML: html, textContent: html, disabled: false,
    set textContent(v) { this._text = v; this.innerHTML = v; },
    get textContent() { return this._text ?? html; } };
}

describe('_withPdf — estado del botón (spinner / doble clic / restauración)', () => {
  test('con la librería ya cargada: deshabilita, pone "Generando…", y restaura el HTML original', async () => {
    const withPdf = load({ alreadyLoaded: true });
    const btn = fakeBtn('<svg></svg> PDF');
    const p = withPdf('exportMonthlyPDF', btn);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Generando…');
    await p;
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toBe('<svg></svg> PDF'); // el icono vuelve, no solo el texto
    expect(calls.fn).toBe(1);
  });

  test('sin la librería cargada: la carga primero (toast + _lazyLoad) y LUEGO ejecuta', async () => {
    const withPdf = load({ alreadyLoaded: false });
    await withPdf('exportMonthlyPDF');
    expect(calls.lazyLoad).toEqual(['src/utils/pdf.js']);
    expect(calls.toasts).toContain('Preparando el PDF…');
    expect(calls.fn).toBe(1);
  });

  test('si _lazyLoad falla, el botón se restaura igualmente y se avisa del error', async () => {
    const withPdf = load({ alreadyLoaded: false, lazyLoadFails: true });
    const btn = fakeBtn('PDF');
    await withPdf('exportMonthlyPDF', btn);
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toBe('PDF');
    expect(calls.fn).toBe(0); // nunca llegó a generarse
    expect(calls.toasts.some(t => t.includes('No se pudo cargar'))).toBe(true);
  });

  test('si la función de generación lanza, el botón se restaura igualmente (finally)', async () => {
    const withPdf = load({ alreadyLoaded: true, fnThrows: true });
    const btn = fakeBtn('PDF');
    await withPdf('exportMonthlyPDF', btn);
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toBe('PDF');
  });

  test('sin botón (p.ej. el enlace de un toast) no revienta: funciona igual sin estado visual', async () => {
    const withPdf = load({ alreadyLoaded: true });
    await expect(withPdf('exportMonthlyPDF')).resolves.toBeUndefined();
    expect(calls.fn).toBe(1);
  });
});

describe('_withPdf — gating de modo demo (requireAccountFor)', () => {
  test('en modo demo, NO genera el PDF ni toca el botón', async () => {
    const withPdf = load({ demoMode: true });
    const btn = fakeBtn('PDF');
    await withPdf('exportMonthlyPDF', btn);
    expect(calls.fn).toBe(0);
    expect(calls.requireAccountFor).toEqual(['exportar a PDF']);
    // requireAccountFor ya muestra su propio modal de registro — _withPdf
    // no debe tocar el botón si corta el flujo antes de empezar.
    expect(btn.disabled).toBe(false);
  });

  test('fuera de modo demo, pasa el gate y genera con normalidad', async () => {
    const withPdf = load({ demoMode: false });
    await withPdf('exportMonthlyPDF');
    expect(calls.fn).toBe(1);
  });
});
