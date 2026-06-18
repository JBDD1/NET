/* ═══════════════════════════════════════════════════════════════
   FINOVA — fiscal.js
   Sección 26: Fiscalidad IRPF — base del ahorro, trabajo, mínimos
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   26. FISCALIDAD
═══════════════════════════════════════════════════════════════ */

// Tramos IRPF base del ahorro 2024 (España) — art. 66 LIRPF
const IRPF_TRAMOS = [
  { hasta:   6000, tipo: 19 },
  { hasta:  50000, tipo: 21 },
  { hasta: 200000, tipo: 23 },
  { hasta: 300000, tipo: 26 },
  { hasta: Infinity, tipo: 28 },
];

/** Calcula el impuesto según tramos */
function calcIRPF(base) {
  if (base <= 0) return 0;
  let tax  = 0;
  let prev = 0;
  for (const tramo of IRPF_TRAMOS) {
    const chunk = Math.min(base, tramo.hasta) - prev;
    if (chunk <= 0) break;
    tax  += chunk * (tramo.tipo / 100);
    prev  = tramo.hasta;
    if (base <= tramo.hasta) break;
  }
  return tax;
}

/** Devuelve el año fiscal seleccionado */
function getFiscalYear() {
  const active = document.querySelector('#fiscal-year-tabs .nav-tab-btn.active');
  return parseInt(active?.dataset.year || new Date().getFullYear());
}

/** Filtra ventas por año */
function getSalesByYear(year) {
  return (APP.sales || []).filter(s => s.sellDate?.startsWith(String(year)));
}

/** Renderiza todo el módulo de fiscalidad */
function renderFiscalidad() {
  // ─── Inicialización ──────────────────────────────────────────
  initFiscalYearSelect();
  const year  = getFiscalYear();
  const sales = getSalesByYear(year);

  // ─── Cálculo base imponible ───────────────────────────────────
  const gains  = sales.reduce((s, v) => {
    const res = (v.sellPrice - v.buyPrice) * v.quantity;
    return res > 0 ? s + res : s;
  }, 0);
  const losses = sales.reduce((s, v) => {
    const res = (v.sellPrice - v.buyPrice) * v.quantity;
    return res < 0 ? s + Math.abs(res) : s;
  }, 0);

  // Dividendos del año (retención variable por activo)
  const FREQ_MULT = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const annualDivs = APP.dividends.reduce((s, d) => {
    const mult = FREQ_MULT[d.frequency] || 1;
    return s + d.dividendPerShare * d.shares * mult * _divFxRate(d);
  }, 0);
  const retention = APP.dividends.reduce((s, d) => {
    const mult = FREQ_MULT[d.frequency] || 1;
    const gross = d.dividendPerShare * d.shares * mult * _divFxRate(d);
    return s + gross * ((d.retentionRate ?? 19) / 100);
  }, 0);

  const netCapGains = gains - losses;
  // Base del ahorro completa — art. 49 LIRPF: pérdidas patrimoniales solo compensan
  // rendimientos del capital mobiliario (dividendos) hasta el 25% de estos.
  let baseAhorro;
  if (netCapGains >= 0) {
    baseAhorro = netCapGains + Math.max(annualDivs, 0);
  } else {
    const capLoss = Math.abs(netCapGains);
    const maxComp = 0.25 * Math.max(annualDivs, 0);
    const effComp = Math.min(capLoss, maxComp);
    baseAhorro = Math.max(annualDivs - effComp, 0);
  }
  baseAhorro = Math.max(baseAhorro, 0);
  const tax    = calcIRPF(baseAhorro);
  const result = tax - retention;

  // ─── KPIs ────────────────────────────────────────────────────
  setText('fisc-base', formatCurrency(baseAhorro));
  const baseSubEl = document.getElementById('fisc-base-sub');
  if (baseSubEl) baseSubEl.textContent = `Ganancias ${formatCurrency(netCapGains)} · Dividendos ${formatCurrency(annualDivs)}`;

  const taxEl = document.getElementById('fisc-tax');
  if (taxEl) { taxEl.textContent = formatCurrency(tax); taxEl.className = 'kpi-value ' + (tax > 0 ? 'negative' : ''); }

  setText('fisc-retention', formatCurrency(retention));

  const resEl  = document.getElementById('fisc-result');
  const resSub = document.getElementById('fisc-result-sub');
  if (resEl) {
    resEl.textContent = formatCurrency(Math.abs(result), true);
    resEl.className   = 'kpi-value ' + (result > 0 ? 'negative' : 'positive');
  }
  if (resSub) resSub.textContent = result > 0 ? 'A pagar a Hacienda' : result < 0 ? '¡Te devuelven!' : 'Resultado neutro';

  // ─── Subsecciones ────────────────────────────────────────────
  renderFiscalTramos(baseAhorro);
  renderSalesTable(sales);
  renderCompensation(gains, losses, annualDivs);
  renderFiscalDividends(annualDivs, retention);
  renderTwoMonthsRule(sales);
  renderFiscalOptimization(gains, losses, netCapGains, annualDivs);
  renderCryptoSummary(year);
  populateFiscalSimAssets();
  renderTrabajo();
  renderMinimos();
  renderResumenIRPF(gains, losses, annualDivs, retention);

  // ─── Eventos ────────────────────────────────────────────────
  document.getElementById('fiscal-year')?.addEventListener('change', renderFiscalidad);
}

function initFiscalYearSelect() {
  const container = document.getElementById('fiscal-year-tabs');
  if (!container) return;
  const currentYear = new Date().getFullYear();

  const _hasDataForYear = y => {
    const ys = String(y);
    return (APP.sales || []).some(s => s.sellDate?.startsWith(ys)) ||
           (APP.transactions || []).some(t => (t.date || '').startsWith(ys));
  };

  const years = [];
  for (let y = currentYear; y >= currentYear - 5; y--) {
    if (y === currentYear || _hasDataForYear(y)) years.push(y);
  }

  const existing = [...container.querySelectorAll('.nav-tab-btn')].map(b => Number(b.dataset.year));
  if (existing.join(',') === years.join(',')) return;

  const prevActive = getFiscalYear();
  container.innerHTML = '';
  years.forEach(y => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = years.includes(prevActive) ? y === prevActive : y === years[0];
    btn.className = 'nav-tab-btn' + (isActive ? ' active' : '');
    btn.dataset.year = String(y);
    btn.textContent = String(y);
    btn.addEventListener('click', () => {
      container.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFiscalidad();
    });
    container.appendChild(btn);
  });
}

/** Tramos IRPF visuales */
function renderFiscalTramos(base) {
  const el = document.getElementById('fisc-tramos');
  if (!el) return;

  const labels = ['Hasta €6.000', '€6.001 – €50.000', '€50.001 – €200.000', '€200.001 – €300.000', 'Más de €300.000'];
  let prev = 0;
  let remaining = Math.max(base, 0);

  el.innerHTML = IRPF_TRAMOS.map((tramo, i) => {
    const size    = tramo.hasta === Infinity ? remaining : Math.min(remaining, tramo.hasta - prev);
    const inTramo = size > 0;
    const taxChunk = size * (tramo.tipo / 100);
    prev = tramo.hasta;
    remaining -= size;

    return `
      <div class="tramo-item ${inTramo ? 'tramo-active' : ''}">
        <div class="tramo-header">
          <span class="tramo-label">${labels[i]}</span>
          <span class="tramo-tipo">${tramo.tipo}%</span>
          ${inTramo ? `<span class="tramo-tax">${formatCurrency(taxChunk)} en este tramo</span>` : ''}
        </div>
        <div class="tramo-bar">
          <div class="tramo-fill" style="width:${inTramo ? Math.min((size / Math.max(base, 1)) * 100, 100) : 0}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

/** Tabla de ventas */
function renderSalesTable(sales) {
  const tbody = document.getElementById('sales-tbody');
  if (!tbody) return;

  // KPI pills
  const gains  = sales.reduce((s, v) => { const r = (v.sellPrice - v.buyPrice) * v.quantity; return r > 0 ? s + r : s; }, 0);
  const losses = sales.reduce((s, v) => { const r = (v.sellPrice - v.buyPrice) * v.quantity; return r < 0 ? s + Math.abs(r) : s; }, 0);
  setText('fisc-gains-total',  `Ganancias: ${formatCurrency(gains)}`);
  setText('fisc-losses-total', `Pérdidas: ${formatCurrency(losses)}`);

  if (sales.length === 0) {
    tbody.innerHTML = emptyRow(10, '📊', 'Sin ventas registradas este año',
      'Registra tus operaciones de compraventa para calcular las plusvalías.',
      '+ Registrar venta', 'openAddSale()');
    return;
  }

  tbody.innerHTML = sales.map(v => {
    const result  = (v.sellPrice - v.buyPrice) * v.quantity;
    const cls     = colorClass(result);
    const tipo    = calcIRPF(Math.max(result, 0)) > 0 ? `${IRPF_TRAMOS.find(t => result <= t.hasta)?.tipo || IRPF_TRAMOS.at(-1).tipo}%` : '—';
    return `
      <tr>
        <td><strong>${escapeHtml(v.name)}</strong>${v.isCrypto ? ' <span class="ticker-chip" style="color:var(--accent)">CRYPTO</span>' : ''}</td>
        <td><span class="ticker-chip">${escapeHtml(v.ticker)}</span></td>
        <td class="text-right" style="font-size:12px">${formatDate(v.buyDate)}</td>
        <td class="text-right" style="font-size:12px">${formatDate(v.sellDate)}</td>
        <td class="text-right"><span class="pvt">${formatCurrency(v.buyPrice)}</span></td>
        <td class="text-right"><span class="pvt">${formatCurrency(v.sellPrice)}</span></td>
        <td class="text-right">${v.quantity}</td>
        <td class="text-right ${cls}"><strong><span class="pvt">${formatCurrency(result, true)}</span></strong></td>
        <td class="text-right"><span class="badge ${result > 0 ? 'badge-income' : 'badge-expense'}">${tipo}</span></td>
        <td>
          <div class="action-buttons">
            <button class="btn-edit btn-icon" onclick="editSale('${v.id}')" aria-label="Editar venta de ${escapeHtml(v.name)}">✎</button>
            <button class="btn-danger btn-icon" onclick="deleteSale('${v.id}')" aria-label="Eliminar venta de ${escapeHtml(v.name)}">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/** Compensación de pérdidas */
function renderCompensation(gains, losses, annualDivs) {
  const el = document.getElementById('fisc-compensation');
  if (!el) return;

  if (gains === 0 && losses === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Sin ganancias ni pérdidas registradas este año</div>';
    return;
  }

  const netCapGains = gains - losses;

  // Art. 49.1 LIRPF:
  //  • Dentro del mismo saldo (GPP↔GPP): compensación al 100% (sin límite).
  //  • Cross-saldo (GPP negativo → RCM positivo): límite del 25% del saldo RCM positivo.
  const intraComp   = Math.min(losses, gains);          // compensación interna GPP (100% legal)
  const excessLoss  = netCapGains < 0 ? Math.abs(netCapGains) : 0;
  const maxDivComp  = 0.25 * Math.max(annualDivs, 0);  // límite cross-saldo art. 49.1.b
  const divCompUsed = Math.min(excessLoss, maxDivComp);
  const carriedFwd  = excessLoss - divCompUsed;

  const taxOnGains    = calcIRPF(Math.max(gains, 0));
  const taxAfterCap   = calcIRPF(Math.max(netCapGains, 0));
  const savingCap     = taxOnGains - taxAfterCap;
  const savingDivs    = calcIRPF(Math.max(annualDivs, 0)) - calcIRPF(Math.max(annualDivs - divCompUsed, 0));
  const totalSaving   = savingCap + savingDivs;

  el.innerHTML = `
    <div class="comp-grid">
      <div class="comp-item">
        <div class="comp-label">Ganancias patrimoniales brutas</div>
        <div class="comp-value positive">${formatCurrency(gains)}</div>
      </div>
      ${intraComp > 0 ? `
      <div class="comp-item">
        <div class="comp-label">Pérdidas GPP compensadas (100% — art. 49.1 LIRPF)</div>
        <div class="comp-value negative">−${formatCurrency(intraComp)}</div>
      </div>` : ''}
      ${divCompUsed > 0 ? `
      <div class="comp-item">
        <div class="comp-label">Pérdidas GPP vs dividendos (máx. 25% — art. 49.1.b LIRPF)</div>
        <div class="comp-value negative">−${formatCurrency(divCompUsed)}</div>
      </div>` : ''}
      <div class="comp-item">
        <div class="comp-label">Ganancias patrimoniales netas</div>
        <div class="comp-value">${formatCurrency(Math.max(netCapGains, 0))}</div>
      </div>
      <div class="comp-item comp-highlight">
        <div class="comp-label">Ahorro fiscal conseguido</div>
        <div class="comp-value positive">${formatCurrency(totalSaving)}</div>
      </div>
    </div>
    ${carriedFwd > 0 ? `
      <div class="fisc-alert fisc-alert-info" style="margin-top:14px">
        <strong>Tienes ${formatCurrency(carriedFwd)} de pérdidas sin compensar</strong> —
        puedes trasladarlas a los próximos 4 ejercicios fiscales para reducir futuras ganancias.
        ${annualDivs > 0 && excessLoss > divCompUsed ? `<br><small>El límite del 25% sobre dividendos (${formatCurrency(maxDivComp)}) impidió compensar el resto este año.</small>` : ''}
      </div>
    ` : ''}
    ${losses < gains * 0.5 && gains > 1000 ? `
      <div class="fisc-alert fisc-alert-tip" style="margin-top:14px">
        💡 <strong>Oportunidad de Tax Loss Harvesting:</strong>
        Si tienes posiciones con pérdidas latentes en cartera, considera cristalizarlas antes del 31 de diciembre
        para compensar parte de tus ${formatCurrency(netCapGains)} de ganancias netas.
      </div>
    ` : ''}
    <div style="font-size:11px;color:var(--text-muted);margin-top:12px;line-height:1.5">
      ⚖ <strong>Base legal:</strong> La compensación dentro del mismo saldo (GPP↔GPP) es al 100% sin límite.
      El límite del 25% solo aplica al cruce entre saldos: pérdidas patrimoniales netas vs. rendimientos
      de capital mobiliario positivos (art. 49.1.b LIRPF).
    </div>
  `;
}

/** Dividendos fiscales */
function renderFiscalDividends(annual, retention) {
  const el = document.getElementById('fisc-dividends');
  if (!el) return;

  if (APP.dividends.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Sin dividendos registrados. Añádelos en la sección Dividendos.</div>';
    return;
  }

  const FREQ_MULT = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const rows = APP.dividends.map(d => {
    const mult    = FREQ_MULT[d.frequency] || 1;
    const bruto   = d.dividendPerShare * d.shares * mult * _divFxRate(d);
    const rate    = (d.retentionRate ?? 19) / 100;
    const ret     = bruto * rate;
    const neto    = bruto - ret;
    return `
      <tr>
        <td><strong>${escapeHtml(d.assetName)}</strong></td>
        <td><span class="ticker-chip">${escapeHtml(d.ticker)}</span></td>
        <td class="text-right"><span class="pvt">${formatCurrency(bruto)}</span></td>
        <td class="text-right" style="color:var(--text-muted);font-size:12px">${(d.retentionRate ?? 19)}%</td>
        <td class="text-right negative"><span class="pvt">−${formatCurrency(ret)}</span></td>
        <td class="text-right positive"><span class="pvt">${formatCurrency(neto)}</span></td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Activo</th><th>Ticker</th>
            <th class="text-right">Bruto anual</th>
            <th class="text-right">Tasa ret.</th>
            <th class="text-right">Retención</th>
            <th class="text-right">Neto</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="font-weight:700;border-top:1px solid var(--border-default)">
            <td colspan="3">TOTAL</td>
            <td></td>
            <td class="text-right negative"><span class="pvt">−${formatCurrency(retention)}</span></td>
            <td class="text-right positive"><span class="pvt">${formatCurrency(annual - retention)}</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="fisc-alert fisc-alert-info" style="margin-top:14px">
      Las retenciones (${formatCurrency(retention)}) ya están ingresadas en Hacienda. Se descuentan de tu impuesto final.
    </div>
  `;
}

/** Regla de los 2 meses */
function renderTwoMonthsRule(sales) {
  const el = document.getElementById('fisc-two-months');
  if (!el) return;

  const lossySales = sales.filter(v => (v.sellPrice - v.buyPrice) * v.quantity < 0);

  if (lossySales.length === 0) {
    el.innerHTML = '<div class="corr-ok"><span>✓</span><div><div style="font-weight:600;font-size:13.5px">Sin ventas con pérdidas</div><div style="font-size:12px;color:var(--text-muted)">No aplica la regla de los 2 meses</div></div></div>';
    return;
  }

  // Comprobar si algún activo vendido con pérdida está en cartera actualmente
  const warnings = lossySales.filter(v =>
    APP.portfolio.some(a => a.ticker.toUpperCase() === v.ticker.toUpperCase())
  );

  if (warnings.length === 0) {
    el.innerHTML = `
      <div class="corr-ok"><span>✓</span>
        <div>
          <div style="font-weight:600;font-size:13.5px">Sin infracciones detectadas</div>
          <div style="font-size:12px;color:var(--text-muted)">No tienes el mismo activo vendido con pérdida en cartera actualmente</div>
        </div>
      </div>`;
  } else {
    el.innerHTML = warnings.map(v => `
      <div class="fisc-alert fisc-alert-warning">
        <strong>⚠ Atención con ${escapeHtml(v.ticker)}:</strong> 
        Vendiste con pérdida el ${formatDate(v.sellDate)} y actualmente tienes este activo en cartera. 
        Hacienda puede no permitirte deducir la pérdida de ${formatCurrency(Math.abs((v.sellPrice - v.buyPrice) * v.quantity))}.
      </div>
    `).join('');
  }
}

/** Optimización fiscal automática */
function renderFiscalOptimization(gains, losses, netBase, annualDivs = 0) {
  const el = document.getElementById('fisc-optimization');
  if (!el) return;

  // Base del ahorro real (con regla del 25% art. 49 LIRPF)
  let baseAhorroReal;
  if (netBase >= 0) {
    baseAhorroReal = netBase + Math.max(annualDivs, 0);
  } else {
    const maxComp = 0.25 * Math.max(annualDivs, 0);
    baseAhorroReal = Math.max(annualDivs - Math.min(Math.abs(netBase), maxComp), 0);
  }

  const tips = [];

  // Tip 1: Cristalizar pérdidas latentes — solo útil si hay ganancias patrimoniales NETAS positivas
  const latentLosses = APP.portfolio.filter(a => a.currentPrice < a.buyPrice);
  if (netBase > 500 && latentLosses.length > 0) {
    const totalLatent  = latentLosses.reduce((s, a) => s + (a.buyPrice - a.currentPrice) * a.quantity, 0);
    // Ahorro = diferencia de cuota sobre la base real, reduciendo netBase con las pérdidas latentes
    const newNetBase   = Math.max(netBase - totalLatent, 0);
    let newBaseAhorro;
    if (newNetBase >= 0) {
      newBaseAhorro = newNetBase + Math.max(annualDivs, 0);
    } else {
      const maxComp2 = 0.25 * Math.max(annualDivs, 0);
      newBaseAhorro  = Math.max(annualDivs - Math.min(Math.abs(newNetBase), maxComp2), 0);
    }
    const saving = calcIRPF(Math.max(baseAhorroReal, 0)) - calcIRPF(Math.max(newBaseAhorro, 0));
    if (saving > 0) {
      tips.push({
        icon: '💡', level: 'tip',
        title: 'Cristaliza pérdidas latentes antes del 31 de diciembre',
        desc: `Tienes ${latentLosses.map(a => escapeHtml(a.ticker)).join(', ')} con pérdidas latentes de ${formatCurrency(totalLatent)}.
               Si las vendes este año, podrías ahorrarte hasta ${formatCurrency(saving)} en impuestos (art. 49 LIRPF).`
      });
    }
  }

  // Tip 2: Si la base del ahorro total está cerca de un tramo superior
  const tramoActual = IRPF_TRAMOS.find(t => baseAhorroReal <= t.hasta);
  const limiteTramo = tramoActual?.hasta;
  if (limiteTramo && limiteTramo !== Infinity && (limiteTramo - baseAhorroReal) < 2000 && baseAhorroReal > 0) {
    tips.push({
      icon: '⚠', level: 'warning',
      title: `Cerca del límite de tramo (${formatCurrency(limiteTramo)})`,
      desc: `Te quedan solo ${formatCurrency(limiteTramo - baseAhorroReal)} para saltar al siguiente tramo fiscal.
             Considera diferir alguna venta al año siguiente para no subir de tipo.`
    });
  }

  // Tip 3: Ganancias sin compensar (solo cuando netBase > 0 y no hay pérdidas ya aplicadas)
  if (netBase > 2000 && losses === 0) {
    tips.push({
      icon: '📋', level: 'info',
      title: 'Revisa tu cartera en busca de pérdidas latentes',
      desc: `Tienes ${formatCurrency(netBase)} de ganancias patrimoniales netas sin compensar ninguna pérdida.
             Revisa si tienes activos en negativo que no necesites y podrías vender para reducir la base.`
    });
  }

  // Tip 4: Retenciones altas
  const retention = APP.dividends.reduce((s, d) => {
    const FREQ = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
    return s + d.dividendPerShare * d.shares * (FREQ[d.frequency] || 1) * _divFxRate(d) * ((d.retentionRate ?? 19) / 100);
  }, 0);

  if (retention > 500) {
    tips.push({
      icon: '💰', level: 'info',
      title: 'Retenciones elevadas por dividendos',
      desc: `Has acumulado ${formatCurrency(retention)} en retenciones por dividendos. 
             Si tu base del ahorro es baja, puede que Hacienda te devuelva parte.`
    });
  }

  if (tips.length === 0) {
    tips.push({ icon: '✓', level: 'ok', title: 'Sin sugerencias por ahora', desc: 'Tu situación fiscal parece óptima para este año.' });
  }

  const levelClass = { tip: 'fisc-alert-tip', warning: 'fisc-alert-warning', info: 'fisc-alert-info', ok: 'fisc-alert-ok' };

  el.innerHTML = tips.map(t => `
    <div class="fisc-alert ${levelClass[t.level]}" style="margin-bottom:10px">
      <strong>${t.icon} ${escapeHtml(t.title)}</strong><br/>
      <span style="font-size:12px">${t.desc}</span>
    </div>
  `).join('');
}

/** Resumen crypto */
function renderCryptoSummary(year) {
  const el = document.getElementById('fisc-crypto');
  if (!el) return;

  const cryptoSales = getSalesByYear(year).filter(v => v.isCrypto);

  if (cryptoSales.length === 0) {
    el.innerHTML = emptyState('₿', 'Sin ventas de criptomonedas',
      'No hay operaciones de crypto registradas para este año fiscal.');
    return;
  }

  const total = cryptoSales.reduce((s, v) => s + (v.sellPrice - v.buyPrice) * v.quantity, 0);
  const tax   = calcIRPF(Math.max(total, 0));

  el.innerHTML = `
    <div class="comp-grid" style="margin-bottom:14px">
      <div class="comp-item">
        <div class="comp-label">Ventas registradas</div>
        <div class="comp-value">${cryptoSales.length}</div>
      </div>
      <div class="comp-item">
        <div class="comp-label">Resultado neto</div>
        <div class="comp-value ${colorClass(total)}">${formatCurrency(total, true)}</div>
      </div>
      <div class="comp-item">
        <div class="comp-label">Impuesto estimado</div>
        <div class="comp-value ${total > 0 ? 'negative' : ''}">${formatCurrency(tax)}</div>
      </div>
    </div>
    <div class="fisc-alert fisc-alert-info">
      <strong>Recuerda:</strong> Las criptomonedas deben declararse aunque no las retires a euros. 
      El intercambio entre criptos (BTC → ETH) también tributa como ganancia patrimonial.
    </div>
  `;
}

/** Simulador de impacto fiscal de una venta */
function populateFiscalSimAssets() {
  const sel = document.getElementById('sim-fisc-asset');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecciona un activo</option>' +
    APP.portfolio.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.ticker)})</option>`).join('');
}

function runFiscalSimulator() {
  const assetId  = document.getElementById('sim-fisc-asset')?.value;
  const sellPrice = parseFloat(document.getElementById('sim-fisc-price')?.value) || 0;
  const qty       = parseFloat(document.getElementById('sim-fisc-qty')?.value) || 0;
  const el        = document.getElementById('sim-fisc-result');
  if (!el) return;

  if (!assetId) return showToast('Selecciona un activo', 'error');
  if (sellPrice <= 0) return showToast('Introduce el precio de venta', 'error');
  if (qty <= 0) return showToast('Introduce la cantidad', 'error');

  const asset  = APP.portfolio.find(a => a.id === assetId);
  if (!asset) return;

  const buyTotal  = asset.buyPrice * qty;
  const sellTotal = sellPrice * qty;
  const result    = sellTotal - buyTotal;

  // Cálculo marginal: considera ganancias/pérdidas ya registradas este año (art. 49 LIRPF)
  const year      = getFiscalYear();
  const salesYTD  = getSalesByYear(year);
  const FREQ_MULT = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const gainsYTD  = salesYTD.reduce((s, v) => { const r = (v.sellPrice - v.buyPrice) * v.quantity; return r > 0 ? s + r : s; }, 0);
  const lossesYTD = salesYTD.reduce((s, v) => { const r = (v.sellPrice - v.buyPrice) * v.quantity; return r < 0 ? s + Math.abs(r) : s; }, 0);
  const divsYTD   = APP.dividends.reduce((s, d) => s + d.dividendPerShare * d.shares * (FREQ_MULT[d.frequency] || 1) * _divFxRate(d), 0);

  const _baseAhorro = (g, lo, divs) => {
    const net = g - lo;
    if (net >= 0) return net + Math.max(divs, 0);
    return Math.max(Math.max(divs, 0) - Math.min(Math.abs(net), 0.25 * Math.max(divs, 0)), 0);
  };

  const baseBefore  = _baseAhorro(gainsYTD, lossesYTD, divsYTD);
  const gainsAfter  = gainsYTD  + (result > 0 ? result : 0);
  const lossesAfter = lossesYTD + (result < 0 ? Math.abs(result) : 0);
  const baseAfter   = _baseAhorro(gainsAfter, lossesAfter, divsYTD);

  const taxBefore = calcIRPF(baseBefore);
  const taxAfter  = calcIRPF(baseAfter);
  const tax       = Math.max(taxAfter - taxBefore, 0);  // impuesto marginal de esta operación
  const net       = result - tax;
  const tipo      = result > 0 ? (IRPF_TRAMOS.find(t => baseAfter <= t.hasta)?.tipo || IRPF_TRAMOS.at(-1).tipo) : 0;

  // Días en cartera si tiene fecha
  const daysHeld = asset.buyDate ? Math.floor((Date.now() - new Date(asset.buyDate)) / 86400000) : null;

  el.style.display = 'block';
  el.innerHTML = `
    <div class="sim-fisc-card">
      <div class="sim-fisc-title">Simulación: ${escapeHtml(asset.name)}</div>
      ${daysHeld ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Llevas ${formatDaysHeld(daysHeld)} con esta posición</div>` : ''}
      <div class="sim-results">
        <div class="sim-result-item">
          <span>Coste de compra</span>
          <strong>${formatCurrency(buyTotal)}</strong>
        </div>
        <div class="sim-result-item">
          <span>Ingreso por venta</span>
          <strong>${formatCurrency(sellTotal)}</strong>
        </div>
        <div class="sim-result-item">
          <span>Ganancia / Pérdida</span>
          <strong class="${colorClass(result)}">${formatCurrency(result, true)}</strong>
        </div>
        <div class="sim-result-item">
          <span>Tipo IRPF marginal</span>
          <strong>${result > 0 ? tipo + '%' : '—'}</strong>
        </div>
        <div class="sim-result-item">
          <span>Impuesto marginal (art. 49 LIRPF)</span>
          <strong class="${tax > 0 ? 'negative' : ''}">${formatCurrency(tax)}</strong>
        </div>
        <div class="sim-result-item sim-result-total">
          <span>Resultado neto tras impuestos</span>
          <strong class="${colorClass(net)}">${formatCurrency(net, true)}</strong>
        </div>
      </div>
      ${(gainsYTD > 0 || lossesYTD > 0) ? `
      <div style="font-size:11px;color:var(--text-muted);margin-top:10px;padding-top:10px;border-top:1px solid var(--border-subtle)">
        Cálculo marginal considerando G/P ya registradas este año
        (${formatCurrency(gainsYTD)} ganancias · ${formatCurrency(lossesYTD)} pérdidas).
        Límite 25% compensación cross-base aplicado (art. 49.1 LIRPF).
      </div>` : ''}
    </div>
  `;
}

/* ─── CRUD Ventas ────────────────────────────────────────── */
function openAddSale(prefill = null, isCrypto = false) {
  const isEdit = !!prefill;
  const v = prefill || { isCrypto };

  openModal(isEdit ? 'Editar venta' : (v.isCrypto ? 'Registrar venta de crypto' : 'Registrar venta'), `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nombre del activo</label>
        <input type="text" id="f-v-name" class="text-input" placeholder="${v.isCrypto ? 'Ej: Bitcoin' : 'Ej: Apple Inc.'}" value="${escapeHtml(v.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Ticker</label>
        <input type="text" id="f-v-ticker" class="text-input" placeholder="${v.isCrypto ? 'BTC' : 'AAPL'}" value="${escapeHtml(v.ticker || '')}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha de compra</label>
        <input type="date" id="f-v-buydate" class="text-input" value="${v.buyDate || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de venta</label>
        <input type="date" id="f-v-selldate" class="text-input" value="${v.sellDate || getTodayStr()}" />
      </div>
    </div>
    <div class="form-row-3 form-row">
      <div class="form-group">
        <label class="form-label">Precio compra (€)</label>
        <input type="number" id="f-v-buyprice" class="text-input" placeholder="0.00" value="${v.buyPrice || ''}" step="0.001" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Precio venta (€)</label>
        <input type="number" id="f-v-sellprice" class="text-input" placeholder="0.00" value="${v.sellPrice || ''}" step="0.001" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Cantidad</label>
        <input type="number" id="f-v-qty" class="text-input" placeholder="0" value="${v.quantity || ''}" step="any" min="0" />
      </div>
    </div>
    <div id="two-months-sell-warn" style="display:none"></div>
  `, () => {
    const name      = document.getElementById('f-v-name').value.trim();
    const ticker    = document.getElementById('f-v-ticker').value.trim().toUpperCase();
    const buyDate   = document.getElementById('f-v-buydate').value;
    const sellDate  = document.getElementById('f-v-selldate').value;
    const buyPrice  = parseFloat(document.getElementById('f-v-buyprice').value);
    const sellPrice = parseFloat(document.getElementById('f-v-sellprice').value);
    const quantity  = parseFloat(document.getElementById('f-v-qty').value);

    if (!name)    return showToast('El nombre es obligatorio', 'error');
    if (!ticker)  return showToast('El ticker es obligatorio', 'error');
    if (!sellDate)return showToast('La fecha de venta es obligatoria', 'error');
    if (buyDate && sellDate && sellDate < buyDate) return showToast('La fecha de venta no puede ser anterior a la de compra', 'error');
    if (isNaN(buyPrice) || buyPrice < 0)   return showToast('Precio de compra inválido', 'error');
    if (isNaN(sellPrice) || sellPrice < 0) return showToast('Precio de venta inválido', 'error');
    if (isNaN(quantity) || quantity <= 0)  return showToast('Cantidad inválida', 'error');

    const sale = { name, ticker, buyDate, sellDate, buyPrice, sellPrice, quantity, isCrypto: v.isCrypto || false };

    if (isEdit) {
      const idx = APP.sales.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.sales[idx] = { ...prefill, ...sale };
      showToast('Venta actualizada ✓', 'success');
    } else {
      if (!APP.sales) APP.sales = [];
      APP.sales.push({ id: generateId(), ...sale });
      showToast('Venta registrada ✓', 'success');
    }

    saveData();
    closeModal();
    renderFiscalidad();
  }, () => {
    // afterRender: live check regla 2 meses al vender con pérdida
    function checkTwoMonthsSell() {
      const ticker    = (document.getElementById('f-v-ticker')?.value || '').trim().toUpperCase();
      const buyPrice  = parseFloat(document.getElementById('f-v-buyprice')?.value);
      const sellPrice = parseFloat(document.getElementById('f-v-sellprice')?.value);
      const quantity  = parseFloat(document.getElementById('f-v-qty')?.value);
      const sellDate  = document.getElementById('f-v-selldate')?.value || getTodayStr();
      const warn      = document.getElementById('two-months-sell-warn');
      if (!warn) return;

      if (ticker && !isNaN(buyPrice) && !isNaN(sellPrice) && !isNaN(quantity) && sellPrice < buyPrice && quantity > 0) {
        const loss     = Math.abs((sellPrice - buyPrice) * quantity);
        const sd       = new Date(sellDate);
        const winStart = new Date(sd); winStart.setMonth(winStart.getMonth() - 2);
        const winEnd   = new Date(sd); winEnd.setMonth(winEnd.getMonth() + 2);
        const fmtD     = d => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        warn.style.display = '';
        warn.innerHTML = `
          <div class="fisc-alert fisc-alert-warning" style="margin-top:10px">
            <strong>⏱ Regla de los 2 meses — pérdida de ${formatCurrency(loss)}</strong><br>
            Para que sea fiscalmente deducible, no puedes haber comprado ni recomprar
            <strong>${escapeHtml(ticker)}</strong> entre el <strong>${fmtD(winStart)}</strong>
            y el <strong>${fmtD(winEnd)}</strong>.
          </div>`;
      } else {
        warn.style.display = 'none';
      }
    }

    const _checkDebounced = debounce(checkTwoMonthsSell, 300);
    ['f-v-ticker','f-v-buyprice','f-v-sellprice','f-v-qty','f-v-selldate'].forEach(id => {
      document.getElementById(id)?.addEventListener('input',  _checkDebounced);
      document.getElementById(id)?.addEventListener('change', checkTwoMonthsSell);
    });
    checkTwoMonthsSell(); // run on open (in case editing a loss sale)
  });
}

function editSale(id) {
  const v = (APP.sales || []).find(x => x.id === id);
  if (v) openAddSale(v);
}

function deleteSale(id) {
  const sale = (APP.sales || []).find(x => x.id === id);
  if (!sale) return;
  APP.sales = (APP.sales || []).filter(x => x.id !== id);
  renderFiscalidad();
  softDelete(`Venta "${sale.name || sale.ticker || 'activo'}" eliminada`, () => {
    if (!APP.sales) APP.sales = [];
    APP.sales.push(sale);
    saveData();
    renderFiscalidad();
  });
}

/* ═══════════════════════════════════════════════════════════════
   27. RENDIMIENTOS DEL TRABAJO
═══════════════════════════════════════════════════════════════ */

// Tramos IRPF base GENERAL (trabajo) 2024 — España
const IRPF_GENERAL = [
  { hasta: 12450,  tipo: 19 },
  { hasta: 20200,  tipo: 24 },
  { hasta: 35200,  tipo: 30 },
  { hasta: 60000,  tipo: 37 },
  { hasta: 300000, tipo: 45 },
  { hasta: Infinity, tipo: 47 },
];

function calcIRPFGeneral(base) {
  if (base <= 0) return 0;
  let tax = 0, prev = 0;
  for (const t of IRPF_GENERAL) {
    const chunk = Math.min(base, t.hasta) - prev;
    if (chunk <= 0) break;
    tax  += chunk * (t.tipo / 100);
    prev  = t.hasta;
    if (base <= t.hasta) break;
  }
  return tax;
}

function renderTrabajo() {
  const t = APP.trabajo || {};

  const bruto     = parseFloat(t.salarioBruto) || 0;
  const retencion = parseFloat(t.retencionEmpresa) || 0;
  const ss        = parseFloat(t.seguridadSocial) || 0;
  const dietas    = parseFloat(t.dietas) || 0;
  const sindicatos= parseFloat(t.sindicatos) || 0;
  const otros     = parseFloat(t.otrosGastos) || 0;

  // Reducción por rendimientos del trabajo (art. 20 LIRPF)
  // Reducción general según rendimiento neto
  const rendNeto = bruto - ss - dietas - sindicatos - otros;
  let reduccion = 0;
  if (rendNeto <= 13115)       reduccion = 5565;
  else if (rendNeto <= 16825)  reduccion = 5565 - 1.5 * (rendNeto - 13115);
  else                         reduccion = 0;

  const rendNetoReducido = Math.max(rendNeto - reduccion, 0);

  // KPIs
  setText('trab-bruto',    formatCurrency(bruto));
  setText('trab-retencion', formatCurrency(retencion));
  setText('trab-ss',       formatCurrency(ss));
  setText('trab-neto',     formatCurrency(rendNetoReducido));

  const el = document.getElementById('fisc-trabajo-detail');
  if (!el) return;

  if (bruto === 0) {
    el.innerHTML = `
      <div class="fisc-alert fisc-alert-info">
        Introduce tus datos laborales pulsando <strong>"✎ Editar datos"</strong> arriba. 
        Los encontrarás en tu nómina o en el borrador de la renta.
      </div>`;
    return;
  }

  const rows = [
    { label: 'Salario bruto',                    value: bruto,              cls: '' },
    { label: '− Cotizaciones Seg. Social',        value: -ss,               cls: 'negative' },
    { label: '− Dietas y gastos de locomoción',   value: -dietas,           cls: 'negative' },
    { label: '− Cuotas sindicales / colegiales',  value: -sindicatos,       cls: 'negative' },
    { label: '− Otros gastos deducibles',         value: -otros,            cls: 'negative' },
    { label: 'Rendimiento neto previo',           value: rendNeto,           cls: '', separator: true },
    { label: '− Reducción por rendim. del trabajo', value: -reduccion,      cls: 'negative' },
    { label: 'Rendimiento neto del trabajo',      value: rendNetoReducido,   cls: 'positive', total: true },
  ];

  el.innerHTML = `
    <div class="renta-table">
      ${rows.map(r => `
        <div class="renta-row ${r.separator ? 'renta-separator' : ''} ${r.total ? 'renta-total' : ''}">
          <div class="renta-label">${r.label}</div>
          <div class="renta-value ${r.cls}">${formatCurrency(Math.abs(r.value))}${r.value < 0 ? '' : ''}</div>
        </div>
      `).join('')}
    </div>
    <div class="fisc-alert fisc-alert-tip" style="margin-top:14px">
      <strong>Retención IRPF empresa:</strong> ${formatCurrency(retencion)} ya retenidos por tu empresa.
      Se descuentan de tu cuota final.
    </div>
    <div class="fisc-alert fisc-alert-info" style="margin-top:10px;font-size:12px">
      <strong>Estimación simplificada (art. 20 LIRPF).</strong> Solo aplica la reducción general para trabajadores por cuenta ajena.
      No incluye: autónomos, trabajadores con discapacidad, movilidad geográfica ni circunstancias personales específicas.
      Consulta a un asesor fiscal para cálculos precisos.
    </div>
  `;
}

function openEditTrabajo() {
  const t = APP.trabajo || {};
  openModal('Datos laborales', `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:18px">
      Encuéntralos en tu nómina anual o en los datos fiscales de la Agencia Tributaria
    </p>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Salario bruto anual (€)</label>
        <input type="number" id="f-t-bruto" class="text-input" placeholder="0" value="${t.salarioBruto || ''}" step="0.01" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Retención IRPF empresa (€)</label>
        <input type="number" id="f-t-retencion" class="text-input" placeholder="0" value="${t.retencionEmpresa || ''}" step="0.01" min="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Cotiz. Seg. Social trabajador (€)</label>
        <input type="number" id="f-t-ss" class="text-input" placeholder="0" value="${t.seguridadSocial || ''}" step="0.01" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Dietas y gastos de locomoción (€)</label>
        <input type="number" id="f-t-dietas" class="text-input" placeholder="0" value="${t.dietas || ''}" step="0.01" min="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Cuotas sindicales / colegiales (€)</label>
        <input type="number" id="f-t-sind" class="text-input" placeholder="0" value="${t.sindicatos || ''}" step="0.01" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Otros gastos deducibles (€)</label>
        <input type="number" id="f-t-otros" class="text-input" placeholder="0" value="${t.otrosGastos || ''}" step="0.01" min="0" />
      </div>
    </div>
  `, () => {
    APP.trabajo = {
      salarioBruto:    parseFloat(document.getElementById('f-t-bruto').value)    || 0,
      retencionEmpresa:parseFloat(document.getElementById('f-t-retencion').value)|| 0,
      seguridadSocial: parseFloat(document.getElementById('f-t-ss').value)       || 0,
      dietas:          parseFloat(document.getElementById('f-t-dietas').value)   || 0,
      sindicatos:      parseFloat(document.getElementById('f-t-sind').value)     || 0,
      otrosGastos:     parseFloat(document.getElementById('f-t-otros').value)    || 0,
    };
    saveData();
    closeModal();
    renderFiscalidad();
    showToast('Datos laborales guardados ✓', 'success');
  });
}

/* ═══════════════════════════════════════════════════════════════
   28. MÍNIMOS PERSONALES Y FAMILIARES
═══════════════════════════════════════════════════════════════ */

function calcMinimosTotal(m) {
  // Mínimo del contribuyente (art. 57 LIRPF)
  let total = 5550;
  const edad = parseInt(m.edad) || 0;
  if (edad >= 65)  total += 1150;
  if (edad >= 75)  total += 1400;

  // Discapacidad del contribuyente
  const disc = parseInt(m.discapacidad) || 0;
  if (disc >= 65)      total += 9000;
  else if (disc >= 33) total += 3000;

  // Hijos (art. 58 LIRPF)
  const hijos = m.hijos || [];
  const hijosSorted = [...hijos].sort((a, b) => a.edad - b.edad);
  hijosSorted.forEach((h, i) => {
    const e = parseInt(h.edad) || 0;
    if (e >= 25) return; // mayores de 25 sin discapacidad no computan
    const base = i === 0 ? 2400 : i === 1 ? 2700 : i === 2 ? 4000 : 4500;
    total += base;
    if (e < 3) total += 2800; // menores de 3 años
    // Discapacidad hijo
    const dh = parseInt(h.discapacidad) || 0;
    if (dh >= 65)      total += 9000;
    else if (dh >= 33) total += 3000;
  });

  // Ascendientes (art. 59 LIRPF)
  const ascend = m.ascendientes || [];
  ascend.forEach(a => {
    const e = parseInt(a.edad) || 0;
    if (e >= 65) total += 1150;
    if (e >= 75) total += 1400;
    const da = parseInt(a.discapacidad) || 0;
    if (da >= 65)      total += 9000;
    else if (da >= 33) total += 3000;
  });

  return total;
}

function renderMinimos() {
  const m  = APP.minimos || {};
  const el = document.getElementById('fisc-minimos-detail');
  if (!el) return;

  const total = calcMinimosTotal(m);
  const hijos = m.hijos || [];
  const ascend = m.ascendientes || [];

  const discLabel = { 0: 'Sin discapacidad', 33: '≥33% (discapacidad)', 65: '≥65% (discapacidad severa)' };
  const discStr   = discLabel[m.discapacidad] || 'Sin discapacidad';

  el.innerHTML = `
    <div class="minimos-grid">
      <div class="minimo-item">
        <div class="minimo-label">Mínimo contribuyente</div>
        <div class="minimo-value">€5.550${parseInt(m.edad) >= 65 ? ' + €1.150 (≥65a)' : ''}${parseInt(m.edad) >= 75 ? ' + €1.400 (≥75a)' : ''}</div>
      </div>
      ${parseInt(m.discapacidad) >= 33 ? `
      <div class="minimo-item">
        <div class="minimo-label">Discapacidad contribuyente</div>
        <div class="minimo-value positive">${discStr}: +€${parseInt(m.discapacidad) >= 65 ? '9.000' : '3.000'}</div>
      </div>` : ''}
      ${hijos.length > 0 ? `
      <div class="minimo-item">
        <div class="minimo-label">Mínimo por descendientes</div>
        <div class="minimo-value">${hijos.length} hijo${hijos.length > 1 ? 's' : ''} declarados</div>
      </div>` : ''}
      ${ascend.length > 0 ? `
      <div class="minimo-item">
        <div class="minimo-label">Mínimo por ascendientes</div>
        <div class="minimo-value">${ascend.length} ascendiente${ascend.length > 1 ? 's' : ''} declarados</div>
      </div>` : ''}
      <div class="minimo-item minimo-total">
        <div class="minimo-label">Total mínimo personal y familiar</div>
        <div class="minimo-value positive"><strong>${formatCurrency(total)}</strong></div>
      </div>
    </div>
    <div class="fisc-alert fisc-alert-tip" style="margin-top:14px">
      Este importe reduce directamente tu cuota íntegra aplicando los tipos del IRPF general. 
      A mayor mínimo familiar, menos impuestos pagas.
    </div>
  `;
}

function openEditMinimos() {
  const m = APP.minimos || {};
  const hijos = m.hijos || [];

  openModal('Mínimos personales y familiares', `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:18px">
      Estos datos reducen directamente tu factura fiscal
    </p>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Tu edad</label>
        <input type="number" id="f-m-edad" class="text-input" placeholder="Ej: 35" value="${m.edad || ''}" min="0" max="120" />
      </div>
      <div class="form-group">
        <label class="form-label">Discapacidad reconocida</label>
        <select id="f-m-disc" class="select-input">
          <option value="0"  ${!m.discapacidad || m.discapacidad == 0  ? 'selected' : ''}>Sin discapacidad</option>
          <option value="33" ${m.discapacidad == 33 ? 'selected' : ''}>≥ 33% — Discapacidad</option>
          <option value="65" ${m.discapacidad == 65 ? 'selected' : ''}>≥ 65% — Discapacidad severa</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Número de hijos a cargo (menores 25 años o discapacitados)</label>
      <select id="f-m-nhijos" class="select-input" onchange="updateHijosFields()">
        ${[0,1,2,3,4,5].map(n => `<option value="${n}" ${hijos.length === n ? 'selected' : ''}>${n} hijo${n !== 1 ? 's' : ''}</option>`).join('')}
      </select>
    </div>

    <div id="hijos-fields">
      ${hijos.map((h, i) => `
        <div class="form-row" style="margin-bottom:8px">
          <div class="form-group">
            <label class="form-label">Edad hijo ${i+1}</label>
            <input type="number" class="text-input f-hijo-edad" placeholder="Edad" value="${h.edad || ''}" min="0" max="25" />
          </div>
          <div class="form-group">
            <label class="form-label">Discapacidad hijo ${i+1}</label>
            <select class="select-input f-hijo-disc">
              <option value="0"  ${!h.discapacidad || h.discapacidad == 0  ? 'selected' : ''}>Sin discapacidad</option>
              <option value="33" ${h.discapacidad == 33 ? 'selected' : ''}>≥ 33%</option>
              <option value="65" ${h.discapacidad == 65 ? 'selected' : ''}>≥ 65%</option>
            </select>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="form-group" style="margin-top:8px">
      <label class="form-label">Ascendientes mayores a cargo (padres, abuelos ≥65a)</label>
      <select id="f-m-nascend" class="select-input">
        ${[0,1,2,3].map(n => `<option value="${n}" ${(m.ascendientes||[]).length === n ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>
  `, () => {
    const edad        = parseInt(document.getElementById('f-m-edad').value) || 0;
    const discapacidad= parseInt(document.getElementById('f-m-disc').value) || 0;
    const nHijos      = parseInt(document.getElementById('f-m-nhijos').value) || 0;
    const nAscend     = parseInt(document.getElementById('f-m-nascend').value) || 0;

    const edades = [...document.querySelectorAll('.f-hijo-edad')].map(i => parseInt(i.value) || 0);
    const discs  = [...document.querySelectorAll('.f-hijo-disc')].map(s => parseInt(s.value) || 0);

    APP.minimos = {
      edad, discapacidad,
      hijos: Array.from({ length: nHijos }, (_, i) => ({ edad: edades[i] || 0, discapacidad: discs[i] || 0 })),
      ascendientes: Array.from({ length: nAscend }, () => ({ edad: 70, discapacidad: 0 })),
    };

    saveData();
    closeModal();
    renderFiscalidad();
    showToast('Mínimos familiares guardados ✓', 'success');
  });
}

function updateHijosFields() {
  const n = parseInt(document.getElementById('f-m-nhijos')?.value) || 0;
  const el = document.getElementById('hijos-fields');
  if (!el) return;
  el.innerHTML = Array.from({ length: n }, (_, i) => `
    <div class="form-row" style="margin-bottom:8px">
      <div class="form-group">
        <label class="form-label">Edad hijo ${i+1}</label>
        <input type="number" class="text-input f-hijo-edad" placeholder="Edad" min="0" max="25" />
      </div>
      <div class="form-group">
        <label class="form-label">Discapacidad hijo ${i+1}</label>
        <select class="select-input f-hijo-disc">
          <option value="0">Sin discapacidad</option>
          <option value="33">≥ 33%</option>
          <option value="65">≥ 65%</option>
        </select>
      </div>
    </div>
  `).join('');
}

/* ═══════════════════════════════════════════════════════════════
   29. RESUMEN IRPF COMPLETO
═══════════════════════════════════════════════════════════════ */
function renderResumenIRPF(gainsAhorro, lossesAhorro, annualDivs, retencionesDivs) {
  const t = APP.trabajo || {};
  const m = APP.minimos || {};

  // Base general (trabajo)
  const bruto      = parseFloat(t.salarioBruto) || 0;
  const ss         = parseFloat(t.seguridadSocial) || 0;
  const dietas     = parseFloat(t.dietas) || 0;
  const sindicatos = parseFloat(t.sindicatos) || 0;
  const otros      = parseFloat(t.otrosGastos) || 0;
  const retenTrab  = parseFloat(t.retencionEmpresa) || 0;

  const rendNeto = bruto - ss - dietas - sindicatos - otros;
  let reduccion = 0;
  if (rendNeto <= 13115)      reduccion = 5565;
  else if (rendNeto <= 16825) reduccion = 5565 - 1.5 * (rendNeto - 13115);
  const baseGeneral = Math.max(rendNeto - reduccion, 0);

  // Base del ahorro — art. 49 LIRPF: pérdidas solo compensan hasta el 25% de rentas positivas
  const netCapGains = gainsAhorro - lossesAhorro;
  let baseAhorro;
  if (netCapGains >= 0) {
    baseAhorro = netCapGains + Math.max(annualDivs, 0);
  } else {
    const capitalLoss   = Math.abs(netCapGains);
    const maxComp       = 0.25 * Math.max(annualDivs, 0);
    const effectiveComp = Math.min(capitalLoss, maxComp);
    baseAhorro = Math.max(annualDivs - effectiveComp, 0);
  }
  baseAhorro = Math.max(baseAhorro, 0);

  // Mínimo personal y familiar
  const minimoTotal = calcMinimosTotal(m);

  // Cuota íntegra general
  const cuotaGeneralBruta = calcIRPFGeneral(baseGeneral);
  const cuotaMinimoGeneral = calcIRPFGeneral(minimoTotal);
  const cuotaGeneralNeta   = Math.max(cuotaGeneralBruta - cuotaMinimoGeneral, 0);

  // Cuota íntegra ahorro
  const cuotaAhorro = calcIRPF(baseAhorro);

  // Total retenciones
  const totalRetenciones = retenTrab + retencionesDivs;

  // Resultado final
  const cuotaTotal = cuotaGeneralNeta + cuotaAhorro;
  const resultado  = cuotaTotal - totalRetenciones;

  // KPIs resumen
  setText('res-base-general',  formatCurrency(baseGeneral));
  setText('res-base-ahorro',   formatCurrency(baseAhorro));
  setText('res-retenciones',   formatCurrency(totalRetenciones));

  const resEl  = document.getElementById('res-resultado');
  const resSub = document.getElementById('res-resultado-sub');
  if (resEl) {
    resEl.textContent = formatCurrency(Math.abs(resultado));
    resEl.className   = 'kpi-value ' + (resultado > 0 ? 'negative' : 'positive');
  }
  if (resSub) resSub.textContent = resultado > 0 ? '⬆ A pagar a Hacienda' : '⬇ Te devuelven';

  // Desglose completo
  const el = document.getElementById('fisc-resumen-completo');
  if (!el) return;

  const rows = [
    { label: '📋 BASE GENERAL (Trabajo)',        value: baseGeneral,        cls: '', section: true },
    { label: '   Rendimiento neto del trabajo',   value: baseGeneral,        cls: '' },
    { label: '📊 BASE DEL AHORRO (Inversiones)',  value: baseAhorro,         cls: '', section: true },
    { label: '   Ganancias patrimoniales netas',  value: gainsAhorro - lossesAhorro, cls: colorClass(gainsAhorro - lossesAhorro) },
    { label: '   Dividendos recibidos',           value: annualDivs,         cls: '' },
    { label: '👤 MÍNIMO PERSONAL Y FAMILIAR',     value: minimoTotal,        cls: '', section: true },
    { label: '   Reduce la cuota general en',     value: cuotaMinimoGeneral, cls: 'positive' },
    { label: '💶 CUOTAS ÍNTEGRAS',                value: null,               cls: '', section: true },
    { label: '   Cuota general (tras mínimos)',   value: cuotaGeneralNeta,   cls: 'negative' },
    { label: '   Cuota del ahorro',               value: cuotaAhorro,        cls: 'negative' },
    { label: '   Total cuota íntegra',            value: cuotaTotal,         cls: 'negative', bold: true },
    { label: '✂️ RETENCIONES',                    value: null,               cls: '', section: true },
    { label: '   Retención empresa (IRPF)',        value: retenTrab,          cls: 'positive' },
    { label: '   Retenciones dividendos',           value: retencionesDivs,    cls: 'positive' },
    { label: '   Total retenciones',              value: totalRetenciones,   cls: 'positive', bold: true },
  ];

  const resultLabel = resultado > 0 ? '⬆ RESULTADO: A INGRESAR' : '⬇ RESULTADO: A DEVOLVER';
  const resultCls   = resultado > 0 ? 'negative' : 'positive';

  el.innerHTML = `
    <div class="renta-table">
      ${rows.map(r => `
        <div class="renta-row ${r.section ? 'renta-section' : ''} ${r.bold ? 'renta-bold' : ''}">
          <div class="renta-label">${r.label}</div>
          <div class="renta-value ${r.cls}">
            ${r.value !== null ? formatCurrency(Math.abs(r.value)) : ''}
          </div>
        </div>
      `).join('')}
      <div class="renta-row renta-total renta-final">
        <div class="renta-label">${resultLabel}</div>
        <div class="renta-value ${resultCls}"><strong>${formatCurrency(Math.abs(resultado))}</strong></div>
      </div>
    </div>
    ${bruto === 0 ? `
    <div class="fisc-alert fisc-alert-info" style="margin-top:14px">
      Para ver el resumen completo, introduce tus <strong>datos laborales</strong> en la sección de Rendimientos del Trabajo.
    </div>` : ''}
  `;
}






