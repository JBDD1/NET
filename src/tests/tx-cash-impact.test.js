/**
 * Finova — tx-cash-impact.test.js
 * _applyTxCashImpact() ajusta la cuenta de efectivo vinculada
 * (APP.transactionCashAccountId) cuando se añade/edita/elimina una
 * transacción: ingreso suma, gasto resta. Sin cuenta vinculada, no hace
 * nada — el patrimonio neto sigue siendo un snapshot manual, como antes
 * de que esta función existiera. Carga el código REAL con vm.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/sections/transactions.js'), 'utf8');

let APP, fns;

function loadScript() {
  APP = {
    transactionCashAccountId: null,
    cashAccounts: [{ id: 'acc1', name: 'Cuenta principal', amount: 1000 }],
  };
  const context = vm.createContext(Object.assign({}, global, {
    APP,
    debounce: fn => fn,
  }));
  vm.runInContext(SRC, context, { filename: 'transactions.js' });
  fns = vm.runInContext('({_applyTxCashImpact})', context);
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { loadScript(); });

describe('_applyTxCashImpact — sin cuenta vinculada, nunca toca nada', () => {
  test('transactionCashAccountId es null → no modifica ninguna cuenta', () => {
    fns._applyTxCashImpact({ type: 'expense', amount: 50 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(1000);
  });

  test('la cuenta vinculada ya no existe (borrada) → no revienta, no modifica nada', () => {
    APP.transactionCashAccountId = 'cuenta-que-no-existe';
    expect(() => fns._applyTxCashImpact({ type: 'expense', amount: 50 }, 1)).not.toThrow();
    expect(APP.cashAccounts[0].amount).toBe(1000);
  });

  test('tx null/undefined → no revienta', () => {
    APP.transactionCashAccountId = 'acc1';
    expect(() => fns._applyTxCashImpact(null, 1)).not.toThrow();
    expect(APP.cashAccounts[0].amount).toBe(1000);
  });
});

describe('_applyTxCashImpact — con cuenta vinculada', () => {
  beforeEach(() => { APP.transactionCashAccountId = 'acc1'; });

  test('un ingreso SUMA al saldo', () => {
    fns._applyTxCashImpact({ type: 'income', amount: 200 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(1200);
  });

  test('un gasto RESTA del saldo', () => {
    fns._applyTxCashImpact({ type: 'expense', amount: 300 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(700);
  });

  test('sign=-1 revierte exactamente el efecto contrario (deshacer un gasto)', () => {
    fns._applyTxCashImpact({ type: 'expense', amount: 300 }, 1);  // aplica
    fns._applyTxCashImpact({ type: 'expense', amount: 300 }, -1); // deshace
    expect(APP.cashAccounts[0].amount).toBe(1000);
  });

  test('sign=-1 revierte exactamente el efecto contrario (deshacer un ingreso)', () => {
    fns._applyTxCashImpact({ type: 'income', amount: 150 }, 1);
    fns._applyTxCashImpact({ type: 'income', amount: 150 }, -1);
    expect(APP.cashAccounts[0].amount).toBe(1000);
  });

  test('editar una transacción = revertir la antigua + aplicar la nueva, nunca se duplica ni se pierde', () => {
    // Gasto original de 100€
    fns._applyTxCashImpact({ type: 'expense', amount: 100 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(900);
    // Se edita a gasto de 250€: revertir los 100€, aplicar los 250€
    fns._applyTxCashImpact({ type: 'expense', amount: 100 }, -1);
    fns._applyTxCashImpact({ type: 'expense', amount: 250 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(750); // 1000 - 250
  });

  test('editar cambiando de gasto a ingreso se refleja correctamente (no solo el importe, también el signo)', () => {
    fns._applyTxCashImpact({ type: 'expense', amount: 80 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(920);
    // Se edita: ya no es un gasto de 80€, ahora es un ingreso de 80€
    fns._applyTxCashImpact({ type: 'expense', amount: 80 }, -1);
    fns._applyTxCashImpact({ type: 'income', amount: 80 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(1080); // 1000 + 80
  });

  test('varias transacciones consecutivas se acumulan correctamente', () => {
    fns._applyTxCashImpact({ type: 'income',  amount: 500 }, 1); // 1500
    fns._applyTxCashImpact({ type: 'expense', amount: 200 }, 1); // 1300
    fns._applyTxCashImpact({ type: 'expense', amount: 50  }, 1); // 1250
    expect(APP.cashAccounts[0].amount).toBe(1250);
  });

  test('solo ajusta la cuenta vinculada, nunca otras cuentas de efectivo', () => {
    APP.cashAccounts.push({ id: 'acc2', name: 'Ahorros', amount: 5000 });
    fns._applyTxCashImpact({ type: 'expense', amount: 100 }, 1);
    expect(APP.cashAccounts[0].amount).toBe(900);
    expect(APP.cashAccounts[1].amount).toBe(5000); // intacta
  });
});
