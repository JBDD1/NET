/**
 * Finova — receipt-scan.test.js
 * Escáner de tickets. Lo que más importa probar NO es el OCR (eso lo hace el
 * modelo y no se puede fijar en un test), sino la frontera: que NADA de lo
 * que devuelva la IA llegue a guardarse sin validar.
 *
 * Un LLM puede devolver un número como texto, una fecha imposible, una
 * categoría inventada o directamente describir una foto que no es un ticket.
 * Todo eso tiene que morir en _rsValidate().
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SCRIPT = fs.readFileSync(path.join(process.cwd(), 'src/core/script.js'), 'utf8');
const RS     = fs.readFileSync(path.join(process.cwd(), 'src/utils/receipt-scan.js'), 'utf8');
const CALCS  = fs.readFileSync(path.join(process.cwd(), 'src/core/calcs.js'), 'utf8');

function extract(...names) {
  return names.map(n => {
    const re = new RegExp('(?:^|\\n)(?:async function|function|const)\\s+' + n + '\\b');
    const m = re.exec(SCRIPT);
    if (!m) throw new Error('no encontrada: ' + n);
    const s = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const rest = SCRIPT.slice(s + 1);
    const nx = /\n(?:async function|function|const|let|\/\* ═)/.exec(rest);
    return SCRIPT.slice(s, nx ? s + 1 + nx.index : SCRIPT.length);
  }).join('\n');
}

const HOY = '2026-10-30';
let APP, fns;

beforeEach(() => {
  APP = {
    transactions: [],
    categories: {
      expense: ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Ocio',
                'Ropa', 'Suscripciones', 'Restaurantes', 'Otros gastos', 'Sin clasificar'],
      income: ['Salario'],
    },
    claudeApiKey: '', openaiApiKey: '', geminiApiKey: '', groqApiKey: '', aiProvider: 'claude',
  };
  const ctx = vm.createContext({
    APP, console, Math, Date, Number, JSON, String, parseFloat, Array, Object,
    document: { getElementById: () => null, createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
    getTodayStr: () => HOY,
    UNCLASSIFIED_CATEGORY: 'Sin clasificar',
    showToast: () => {}, openModal: () => {}, closeModal: () => {},
    escapeHtml: s => String(s ?? ''), formatCurrency: v => `${v}`, formatDate: d => d,
    generateId: () => 'id1', saveData: () => {}, renderTransactions: () => {},
  });
  vm.runInContext(CALCS, ctx, { filename: 'calcs.js' });
  vm.runInContext(extract('_stripAccents'), ctx, { filename: 'p.js' });
  vm.runInContext(RS, ctx, { filename: 'receipt-scan.js' });
  fns = vm.runInContext('({ _rsValidate, _rsFindDuplicate, _rsHash, _rsBuildPrompt, _rsPickVisionProviderSync, _RS_VISION_PROVIDERS })', ctx);
  APP = vm.runInContext('APP', ctx);
});

const ticketOK = {
  merchant: 'Mercadona', date: '2026-10-28', total: 45.67, currency: 'EUR',
  category: 'Alimentación', isReceipt: true,
  confidence: { merchant: 0.95, date: 0.9, total: 0.98, category: 0.9 },
  items: [{ name: 'Leche', qty: 2, unitPrice: 1.2, total: 2.4 }],
};

describe('_rsValidate — nada se guarda sin comprobarlo', () => {
  test('un ticket correcto pasa y se normaliza', () => {
    const r = fns._rsValidate(ticketOK);
    expect(r.ok).toBe(true);
    expect(r.data.merchant).toBe('Mercadona');
    expect(r.data.total).toBe(45.67);
    expect(r.data.category).toBe('Alimentación');
    expect(r.data.items).toHaveLength(1);
  });

  test('JSON envuelto en ```json se extrae igual (los modelos lo hacen)', () => {
    const r = fns._rsValidate('```json\n' + JSON.stringify(ticketOK) + '\n```');
    expect(r.ok).toBe(true);
    expect(r.data.total).toBe(45.67);
  });

  test('una categoría INVENTADA se descarta, no se crea', () => {
    // "Hogar" y "Viajes" no existen en Finova — el modelo podría proponerlas.
    const r = fns._rsValidate({ ...ticketOK, category: 'Hogar' });
    expect(r.ok).toBe(true);
    expect(r.data.category).toBeNull();   // queda pendiente, no se inventa
    expect(APP.categories.expense).not.toContain('Hogar');
  });

  test('un importe como texto con coma se convierte; uno imposible se anula', () => {
    expect(fns._rsValidate({ ...ticketOK, total: '45,67' }).data.total).toBe(45.67);
    expect(fns._rsValidate({ ...ticketOK, total: 0 }).data.total).toBeNull();
    expect(fns._rsValidate({ ...ticketOK, total: -10 }).data.total).toBeNull();
    expect(fns._rsValidate({ ...ticketOK, total: 'muchos euros' }).data.total).toBeNull();
  });

  test('una fecha futura o con formato raro se anula (no se adivina)', () => {
    expect(fns._rsValidate({ ...ticketOK, date: '2027-01-01' }).data.date).toBeNull();
    expect(fns._rsValidate({ ...ticketOK, date: '28/10/2026' }).data.date).toBeNull();
    expect(fns._rsValidate({ ...ticketOK, date: 'ayer' }).data.date).toBeNull();
    expect(fns._rsValidate({ ...ticketOK, date: '2026-13-45' }).data.date).toBeNull();
    expect(fns._rsValidate({ ...ticketOK, date: HOY }).data.date).toBe(HOY); // hoy sí vale
  });

  test('si la imagen NO es un ticket, se rechaza con motivo', () => {
    const r = fns._rsValidate({ ...ticketOK, isReceipt: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no parece un ticket/i);
  });

  test('respuesta no-JSON o vacía se rechaza sin lanzar', () => {
    expect(fns._rsValidate('lo siento, no puedo ayudarte').ok).toBe(false);
    expect(fns._rsValidate('').ok).toBe(false);
    expect(fns._rsValidate(null).ok).toBe(false);
    expect(fns._rsValidate('{roto').ok).toBe(false);
  });

  test('un método de pago inventado se descarta', () => {
    expect(fns._rsValidate({ ...ticketOK, paymentMethod: 'criptomoneda' }).data.paymentMethod).toBeNull();
    expect(fns._rsValidate({ ...ticketOK, paymentMethod: 'Tarjeta' }).data.paymentMethod).toBe('tarjeta');
  });

  test('ticket borroso: todo a null y la confianza baja se conserva', () => {
    const r = fns._rsValidate({
      merchant: null, date: null, total: null, category: null, isReceipt: true,
      confidence: { merchant: 0.2, date: 0.1, total: 0.15, category: 0.1 }, items: [],
    });
    expect(r.ok).toBe(true);                 // no se rechaza: se pide al usuario
    expect(r.data.total).toBeNull();
    expect(r.data.confidence.total).toBeCloseTo(0.15, 2);
  });

  test('se acota el número de productos (una respuesta enorme no desborda)', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ name: 'P' + i, total: 1 }));
    expect(fns._rsValidate({ ...ticketOK, items: many }).data.items.length).toBeLessThanOrEqual(50);
  });
});

describe('_rsBuildPrompt — solo ofrece categorías reales', () => {
  test('incluye las categorías de la app y excluye "Sin clasificar"', () => {
    const p = fns._rsBuildPrompt();
    expect(p).toContain('Alimentación');
    expect(p).toContain('Restaurantes');
    expect(p).not.toMatch(/\[.*Sin clasificar.*\]/);
    expect(p).not.toContain('Hogar');   // no existe en Finova
  });

  test('prohíbe explícitamente inventar datos', () => {
    expect(fns._rsBuildPrompt()).toMatch(/NO INVENTES/i);
  });
});

describe('Detección de duplicados — avisa, no bloquea', () => {
  const tx = { id: 't1', type: 'expense', date: '2026-10-28', description: 'Mercadona', amount: 45.67 };

  test('mismo día, mismo importe y mismo comercio → posible duplicado', () => {
    APP.transactions.push(tx);
    expect(fns._rsFindDuplicate({ date: '2026-10-28', total: 45.67, merchant: 'Mercadona' })).toBeTruthy();
  });

  test('mismo día e importe pero OTRO comercio → no es duplicado', () => {
    APP.transactions.push(tx);
    expect(fns._rsFindDuplicate({ date: '2026-10-28', total: 45.67, merchant: 'Carrefour' })).toBeNull();
  });

  test('importe distinto → no es duplicado', () => {
    APP.transactions.push(tx);
    expect(fns._rsFindDuplicate({ date: '2026-10-28', total: 12.00, merchant: 'Mercadona' })).toBeNull();
  });

  test('la MISMA foto se detecta aunque cambien los datos leídos', () => {
    APP.transactions.push({ ...tx, receipt: { imgHash: 'abc:123' } });
    expect(fns._rsFindDuplicate({ date: '2026-01-01', total: 999, merchant: 'Otro' }, 'abc:123')).toBeTruthy();
  });

  test('mismo número de ticket → duplicado aunque difiera lo demás', () => {
    APP.transactions.push({ ...tx, receipt: { receiptNumber: 'F-2026-00042' } });
    expect(fns._rsFindDuplicate({ date: '2026-02-02', total: 7, receiptNumber: 'F-2026-00042' })).toBeTruthy();
  });

  test('un ingreso nunca se considera duplicado de un ticket de gasto', () => {
    APP.transactions.push({ ...tx, type: 'income' });
    expect(fns._rsFindDuplicate({ date: '2026-10-28', total: 45.67, merchant: 'Mercadona' })).toBeNull();
  });

  test('sin fecha o sin importe no se arriesga a marcar duplicado', () => {
    APP.transactions.push(tx);
    expect(fns._rsFindDuplicate({ date: null, total: 45.67 })).toBeNull();
    expect(fns._rsFindDuplicate({ date: '2026-10-28', total: null })).toBeNull();
  });
});

describe('_rsHash — identifica la misma imagen', () => {
  test('la misma imagen da el mismo hash y otra distinta uno distinto', () => {
    const a = 'data:image/jpeg;base64,' + 'A'.repeat(500);
    const b = 'data:image/jpeg;base64,' + 'B'.repeat(500);
    expect(fns._rsHash(a)).toBe(fns._rsHash(a));
    expect(fns._rsHash(a)).not.toBe(fns._rsHash(b));
  });
});

describe('Elección de proveedor con visión', () => {
  test('Groq NO está entre los proveedores con visión (su modelo es solo texto)', () => {
    expect(fns._RS_VISION_PROVIDERS).not.toContain('groq');
    expect(fns._RS_VISION_PROVIDERS).toEqual(expect.arrayContaining(['claude', 'openai', 'gemini']));
  });

  test('sin ninguna clave válida, explica qué hacer en vez de fallar raro', () => {
    const r = fns._rsPickVisionProviderSync();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Claude|ChatGPT|Gemini/);
    expect(r.reason).toMatch(/Groq/);   // avisa de por qué Groq no sirve
  });

  test('con clave de Gemini, la usa aunque el proveedor preferido sea Groq', () => {
    APP.aiProvider = 'groq';
    APP.geminiApiKey = 'AIza-test';
    const r = fns._rsPickVisionProviderSync();
    expect(r.ok).toBe(true);
    expect(r.provider).toBe('gemini');
  });

  test('respeta el proveedor preferido si tiene visión y clave', () => {
    APP.aiProvider = 'openai';
    APP.openaiApiKey = 'sk-test';
    APP.claudeApiKey = 'sk-ant-test';
    expect(fns._rsPickVisionProviderSync().provider).toBe('openai');
  });
});
