/* ═══════════════════════════════════════════════════════════════
   FINOVA — tests.js
   Comprobaciones internas de los cálculos principales.
   Ejecutar desde Ajustes o desde consola: runTests()
═══════════════════════════════════════════════════════════════ */
'use strict';

function runTests() {
  const _savedApp = JSON.stringify(APP);
  const results = [];

  function test(name, fn) {
    if (typeof _invalidateCalcCache === 'function') _invalidateCalcCache();
    try { fn(); results.push({ name, passed: true }); }
    catch (e) { results.push({ name, passed: false, error: e.message }); }
  }

  function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `Resultado incorrecto: se esperaba ${b} pero se obtuvo ${a}`);
  }

  function assertClose(a, b, eps = 0.01, msg) {
    if (Math.abs(a - b) > eps) throw new Error(msg || `Resultado incorrecto: se esperaba ~${b} pero se obtuvo ${a}`);
  }

  /* ── Limpiar estado para tests ──────────────────────────── */
  APP.cashAccounts  = [];
  APP.portfolio     = [];
  APP.alternatives  = [];
  APP.properties    = [];
  APP.liabilities   = [];
  APP.transactions  = [];
  APP.dividends     = [];
  if (typeof _invalidateCalcCache === 'function') _invalidateCalcCache();

  /* ── Efectivo ───────────────────────────────────────────── */
  test('Sin cuentas → el efectivo total debe ser 0 €', () => {
    assertEqual(calcCashTotal(), 0);
  });

  test('Con 2 cuentas → efectivo total = 1.500,50 €', () => {
    APP.cashAccounts = [
      { id: '1', name: 'Cuenta A', amount: 1000 },
      { id: '2', name: 'Cuenta B', amount: 500.50 },
    ];
    assertClose(calcCashTotal(), 1500.50);
    APP.cashAccounts = [];
  });

  /* ── Inmuebles ──────────────────────────────────────────── */
  test('Sin inmuebles → valor total de propiedades = 0 €', () => {
    assertEqual(calcPropertiesTotal(), 0);
  });

  test('Con 2 inmuebles → valor total = 345.000 €', () => {
    APP.properties = [
      { id: '1', name: 'Piso', type: 'vivienda_habitual', purchasePrice: 200000, currentValue: 250000 },
      { id: '2', name: 'Local', type: 'alquiler', purchasePrice: 80000, currentValue: 95000 },
    ];
    assertEqual(calcPropertiesTotal(), 345000);
    APP.properties = [];
  });

  /* ── Patrimonio neto ────────────────────────────────────── */
  test('Solo efectivo (5.000 €) → patrimonio neto = 5.000 €', () => {
    APP.cashAccounts = [{ id: '1', name: 'Test', amount: 5000 }];
    assertEqual(calcNetWorth(), 5000);
    APP.cashAccounts = [];
  });

  test('Activos 10.000 € - deuda 3.000 € → patrimonio = 7.000 €', () => {
    APP.cashAccounts = [{ id: '1', name: 'Test', amount: 10000 }];
    APP.liabilities  = [{ id: '1', name: 'Préstamo', remainingAmount: 3000 }];
    assertEqual(calcNetWorth(), 7000);
    APP.cashAccounts = [];
    APP.liabilities  = [];
  });

  test('Cuenta 10k + piso 250k - hipoteca 180k → patrimonio = 80.000 €', () => {
    APP.cashAccounts = [{ id: '1', name: 'Cuenta', amount: 10000 }];
    APP.properties   = [{ id: '1', name: 'Piso', type: 'vivienda_habitual', purchasePrice: 200000, currentValue: 250000 }];
    APP.liabilities  = [{ id: '1', name: 'Hipoteca', remainingAmount: 180000 }];
    assertEqual(calcNetWorth(), 80000, '10000 + 250000 - 180000 = 80000');
    APP.cashAccounts = [];
    APP.properties   = [];
    APP.liabilities  = [];
  });

  /* ── Activos alternativos ───────────────────────────────── */
  test('Reloj valorado en 7.500 € → total alternativos = 7.500 €', () => {
    APP.alternatives = [
      { id: '1', name: 'Reloj', category: 'Relojería', buyPrice: 5000, currentPrice: 7500 },
    ];
    assertEqual(calcAlternativesTotal(), 7500);
    APP.alternatives = [];
  });

  /* ── Transacciones ──────────────────────────────────────── */
  test('Nómina 3.000 € + gastos 1.050 € → ingresos y gastos del mes correctos', () => {
    const month = getCurrentMonth();
    APP.transactions = [
      { id: '1', date: month + '-01', type: 'income',  amount: 3000, category: 'Salario' },
      { id: '2', date: month + '-05', type: 'expense', amount: 850,  category: 'Vivienda' },
      { id: '3', date: month + '-10', type: 'expense', amount: 200,  category: 'Alimentación' },
    ];
    assertEqual(calcMonthlyIncome(),  3000);
    assertEqual(calcMonthlyExpense(), 1050);
    APP.transactions = [];
  });

  /* ── Deudas ─────────────────────────────────────────────── */
  test('Hipoteca 150k + préstamo coche 12k → total deudas = 162.000 €', () => {
    APP.liabilities = [
      { id: '1', name: 'Hipoteca', remainingAmount: 150000, monthlyPayment: 650, interestRate: 2.5 },
      { id: '2', name: 'Coche',    remainingAmount:  12000, monthlyPayment: 280, interestRate: 4.9 },
    ];
    assertEqual(calcLiabilitiesTotal(), 162000);
    APP.liabilities = [];
  });

  /* ── Restaurar estado original ──────────────────────────── */
  try { Object.assign(APP, JSON.parse(_savedApp)); } catch(e) {}
  if (typeof _invalidateCalcCache === 'function') _invalidateCalcCache();

  /* ── Mostrar resultados ─────────────────────────────────── */
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const allOk  = failed === 0;

  const html = `
    <p style="font-size:13px;color:var(--text-secondary);margin:0 0 14px">
      Estas pruebas verifican que los cálculos de Finova funcionan correctamente.
      ${allOk ? 'Todo está en orden.' : 'Algunos cálculos han dado resultados inesperados.'}
    </p>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;padding:12px 16px;border-radius:var(--r-sm);background:${allOk ? 'rgba(61,220,132,.08)' : 'rgba(255,107,107,.08)'};border:1px solid ${allOk ? 'rgba(61,220,132,.2)' : 'rgba(255,107,107,.2)'}">
      <span style="font-size:22px">${allOk ? '✅' : '⚠️'}</span>
      <div>
        <div style="font-weight:700;font-size:14px">${allOk ? 'Todos los cálculos son correctos' : `${failed} cálculo${failed !== 1 ? 's' : ''} con error`}</div>
        <div style="font-size:12px;color:var(--text-muted)">${passed} correctos · ${failed} con error · ${results.length} total</div>
      </div>
    </div>
    ${results.map(r => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;margin-bottom:5px;background:var(--bg-elevated);border-radius:var(--r-xs);font-size:13px;border-left:3px solid ${r.passed ? '#3ddc84' : '#ff6b6b'}">
        <span style="flex-shrink:0;margin-top:1px;color:${r.passed ? '#3ddc84' : '#ff6b6b'}">${r.passed ? '✓' : '✗'}</span>
        <div>
          <div style="color:var(--text-primary);font-weight:${r.passed ? '400' : '600'}">${r.name}</div>
          ${r.error ? `<div style="color:var(--danger);font-size:12px;margin-top:3px">${r.error}</div>` : ''}
        </div>
      </div>
    `).join('')}
  `;

  openModal('🧪 Verificación de cálculos', html, null, null);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
}
