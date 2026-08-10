/* ═══════════════════════════════════════════════════════════════
   FINOVA — portfolio.js
   Secciones 8 y 25: Cartera de inversión + Análisis de cartera
═══════════════════════════════════════════════════════════════ */

var SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : ''; // Producción: Vercel proxy enruta /api/* a Railway sin exponer la URL real

function _portSparkDraw(id, rawData, isHero) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const data = rawData.filter(v => v != null && isFinite(v));
  if (data.length < 2) { canvas.style.display = 'none'; return; }

  const W   = canvas.parentElement.clientWidth || 200;
  const H   = 44;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.style.display = 'block';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pad = 4;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - pad - ((v - min) / range) * (H - pad * 2),
  }));

  const trend = data[data.length - 1] - data[0];
  let r, g, b;
  if (isHero) { r = 255; g = 253; b = 248; }
  else {
    const cs  = getComputedStyle(document.documentElement);
    const hex = (trend >= 0 ? cs.getPropertyValue('--up') : cs.getPropertyValue('--down'))
      .trim().replace('#', '');
    r = parseInt(hex.slice(0, 2), 16) || 120;
    g = parseInt(hex.slice(2, 4), 16) || 180;
    b = parseInt(hex.slice(4, 6), 16) || 120;
  }

  const DURATION = 650;
  const t0 = performance.now();

  (function frame(now) {
    const p    = Math.min((now - t0) / DURATION, 1);
    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    const cnt  = Math.max(2, Math.ceil(ease * (pts.length - 1)) + 1);
    const vis  = pts.slice(0, cnt);

    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

    ctx.beginPath();
    ctx.moveTo(vis[0].x, H);
    ctx.lineTo(vis[0].x, vis[0].y);
    for (let i = 1; i < vis.length; i++) ctx.lineTo(vis[i].x, vis[i].y);
    ctx.lineTo(vis[vis.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(vis[0].x, vis[0].y);
    for (let i = 1; i < vis.length; i++) ctx.lineTo(vis[i].x, vis[i].y);
    ctx.strokeStyle = isHero ? `rgba(${r},${g},${b},0.8)` : `rgb(${r},${g},${b})`;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    ctx.stroke();

    // Dot pulsante en el punto final
    if (p >= 1) {
      const last = pts[pts.length - 1];
      const pulseT = (now / 900) % 1;
      const pulseR = 2.5 + pulseT * 4;
      const pulseA = (1 - pulseT) * 0.5;
      ctx.beginPath();
      ctx.arc(last.x, last.y, pulseR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${pulseA})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isHero ? `rgba(${r},${g},${b},0.9)` : `rgb(${r},${g},${b})`;
      ctx.fill();
      requestAnimationFrame(frame);
    } else {
      requestAnimationFrame(frame);
    }
  })(t0);
}

let _tickerDbPromise = null;
function _loadTickerDb() {
  if (typeof TICKER_DB !== 'undefined') return Promise.resolve();
  if (_tickerDbPromise) return _tickerDbPromise;
  _tickerDbPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'src/utils/ticker-db.js';
    s.onload  = resolve;
    s.onerror = () => { _tickerDbPromise = null; reject(new Error('ticker-db load failed')); };
    document.head.appendChild(s);
  });
  return _tickerDbPromise;
}

/* ═══════════════════════════════════════════════════════════════
   8. CARTERA DE INVERSIÓN (Portfolio)
═══════════════════════════════════════════════════════════════ */

let _portfolioSort = { col: null, dir: 1 };

const _PRICE_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

function _isPriceStale(asset) {
  if (!asset.priceDate) return true;
  return (Date.now() - asset.priceDate) > _PRICE_STALE_MS;
}

const _PORTFOLIO_SORT_FNS = {
  name:       a => a.name?.toLowerCase() ?? '',
  ticker:     a => a.ticker?.toLowerCase() ?? '',
  country:    a => a.country?.toLowerCase() ?? '',
  buyPrice:   a => a.buyPrice,
  quantity:   a => a.quantity,
  cost:       a => a.buyPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1),
  value:      a => a.currentPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1),
  gain:       a => (a.currentPrice - a.buyPrice) * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1),
  gainPct:    a => a.buyPrice > 0 ? (a.currentPrice - a.buyPrice) / a.buyPrice : 0,
  concPct:    a => { const tv = calcPortfolioValue(); return tv > 0 ? (a.currentPrice * a.quantity) / tv : 0; },
  days:       a => a.buyDate ? new Date(a.buyDate).getTime() : 0,
};

function setPortfolioSort(col) {
  if (_portfolioSort.col === col) {
    _portfolioSort.dir *= -1;
  } else {
    _portfolioSort.col = col;
    _portfolioSort.dir = 1;
  }
  renderPortfolioTable();
}

function renderPortfolio() {
  // ─── Eventos ────────────────────────────────────────────────
  // ─── Eventos ────────────────────────────────────────────────
  _delegate('section-portfolio', {
    'price-chart': id => openAssetPriceChart(id),
    'edit-asset':  (id, btn) => {
      btn.disabled = true; btn.textContent = '⟳';
      btn.style.animation = 'spin .7s linear infinite';
      // One rAF so the browser paints the spinner before the modal blocks the thread
      requestAnimationFrame(() => {
        editAsset(id);
        btn.style.animation = '';
        btn.disabled = false; btn.textContent = '✎';
      });
    },
    'delete-asset': (id, btn) => {
      if (btn.dataset.deleting) return;         // guard against double-click
      btn.dataset.deleting = '1';
      btn.disabled = true; btn.textContent = '⟳';
      btn.style.animation = 'spin .7s linear infinite';
      const row = btn.closest('tr[data-id]');
      if (row) { row.style.transition = 'opacity .08s'; row.style.opacity = '0.35'; }
      setTimeout(() => deleteAsset(id), 80);   // 80ms so feedback is visible
    },
  });
  // ─── KPIs ────────────────────────────────────────────────────
  const totalValue = calcPortfolioValue();
  const totalCost  = APP.portfolio.reduce((s, a) => s + a.buyPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1), 0);
  const totalGain  = totalValue - totalCost;
  const totalPct   = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  _animNum(document.getElementById('port-total-value'), totalValue, formatCurrency, 600);
  _animNum(document.getElementById('port-total-cost'),  totalCost,  formatCurrency, 500);
  const gainEl = document.getElementById('port-total-gain');
  if (gainEl) {
    gainEl.className = 'kpi-value ' + colorClass(totalGain);
    _animNum(gainEl, totalGain, v => formatCurrency(v, true), 600);
  }
  const pctEl = document.getElementById('port-total-pct');
  if (pctEl) {
    pctEl.className = 'kpi-value ' + colorClass(totalPct);
    _animNum(pctEl, totalPct, formatPct, 600);
  }
  const cagrEl  = document.getElementById('port-total-cagr');
  const cagrVal = calcPortfolioCAGR();
  if (cagrEl) {
    cagrEl.className = 'kpi-value ' + (cagrVal !== null ? colorClass(cagrVal) : '');
    if (cagrVal !== null) _animNum(cagrEl, cagrVal, formatPct, 600);
    else cagrEl.textContent = '—';
  }
  const cagrSubEl = document.getElementById('port-cagr-sub');
  if (cagrSubEl) {
    const allCost     = APP.portfolio.reduce((s, a) => s + assetCost(a), 0);
    const missingCost = APP.portfolio.filter(a => !a.buyDate).reduce((s, a) => s + assetCost(a), 0);
    const partial = allCost > 0 && missingCost / allCost > 0.20;
    cagrSubEl.textContent = partial ? 'Rentabilidad anual compuesta (datos parciales)' : 'Rentabilidad anual compuesta';
    cagrSubEl.title = partial ? `${((missingCost / allCost) * 100).toFixed(0)}% del coste de cartera no tiene fecha de compra — el CAGR excluye esos activos` : '';
  }

  requestAnimationFrame(() => {
    const hist   = APP.networthHistory || [];
    const slice  = hist.slice(-7);
    const pvData = slice.map(h => h.portfolioValue ?? h.value ?? null).filter(v => v != null && isFinite(v));
    _portSparkDraw('spark-port-value', pvData, false);
    if (totalCost > 0 && pvData.length >= 2) {
      _portSparkDraw('spark-port-gain', pvData.map(v => v - totalCost), false);
      _portSparkDraw('spark-port-pct',  pvData.map(v => (v - totalCost) / totalCost * 100), false);
    }
  });

  // Mejor y peor por ganancia absoluta en EUR — el % puede engañar (€200 +300% < €80.000 +12%)
  if (APP.portfolio.length > 0) {
    const withGain = APP.portfolio.map(a => {
      const fx   = a.exchangeRate > 0 ? a.exchangeRate : 1;
      const gain = (a.currentPrice - a.buyPrice) * a.quantity * fx;
      const pct  = a.buyPrice > 0 ? ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100 : 0;
      return { ...a, gain, pct };
    });
    const best  = withGain.reduce((b, a) => a.gain > b.gain ? a : b);
    const worst = withGain.reduce((b, a) => a.gain < b.gain ? a : b);

    setText('best-investment-name',  best.name);
    setText('best-investment-val',   `${formatCurrency(best.gain, true)} (${formatPct(best.pct)})`);
    setText('worst-investment-name', worst.name);
    setText('worst-investment-val',  `${formatCurrency(worst.gain, true)} (${formatPct(worst.pct)})`);

    document.getElementById('best-investment-val').className  = 'highlight-value positive';
    document.getElementById('worst-investment-val').className = 'highlight-value negative';
  } else {
    setText('best-investment-name',  '—');
    setText('best-investment-val',   '—');
    setText('worst-investment-name', '—');
    setText('worst-investment-val',  '—');
  }

  // Refresh button: show last-update time and warn when stale
  const refreshBtn = document.querySelector('.btn-refresh-prices');
  if (refreshBtn && !refreshBtn.disabled) {
    if (APP.lastPriceRefresh) {
      const ageH = (Date.now() - APP.lastPriceRefresh) / 3600000;
      const t    = new Date(APP.lastPriceRefresh);
      const hhmm = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
      if (ageH > 2) {
        refreshBtn.textContent = `⟳ Precios desact. (${hhmm})`;
        refreshBtn.style.color = 'var(--down)';
      } else {
        refreshBtn.textContent = `⟳ Precios (${hhmm})`;
        refreshBtn.style.color = '';
      }
      refreshBtn.title = `Última actualización: ${hhmm}`;
    } else {
      refreshBtn.textContent = '⟳ Actualizar precios';
      refreshBtn.style.color = 'var(--down)';
      refreshBtn.title = 'Los precios nunca han sido actualizados';
    }
  }

  // Banner de tipos de cambio desactualizados
  const fxWarningEl = document.getElementById('port-fx-warning');
  if (fxWarningEl) {
    const hasNonEur = APP.portfolio.some(a => a.currency && a.currency !== 'EUR');
    if (hasNonEur) {
      const lastFx  = APP.exchangeRatesUpdated;
      const fxAge   = lastFx ? Math.floor((Date.now() - new Date(lastFx).getTime()) / 86400000) : null;
      const isStale = !lastFx || fxAge > 7;
      fxWarningEl.style.display = isStale ? 'block' : 'none';
      if (isStale) {
        fxWarningEl.innerHTML = `⚠ Tipos de cambio ${lastFx ? `desactualizados (hace ${fxAge} días)` : 'nunca actualizados'} — los valores en € pueden ser incorrectos.
          <button class="btn-link" onclick="refreshExchangeRates()" style="margin-left:8px;font-size:inherit">Actualizar ahora</button>`;
      }
    } else {
      fxWarningEl.style.display = 'none';
    }
  }

  // ─── Tabla ───────────────────────────────────────────────────
  renderPortfolioTable();
  renderConcentrationBars();
  // ─── Gráficas ────────────────────────────────────────────────
  document.querySelectorAll('#section-portfolio .chart-wrapper, #section-portfolio .chart-donut-wrapper').forEach(el => el.classList.add('loading'));
  ric(() => {
    renderCorrelationAnalysis();
    renderPortfolioCharts();
    renderCountryChart();
    renderSectorChart();
    document.querySelectorAll('#section-portfolio .chart-wrapper.loading, #section-portfolio .chart-donut-wrapper.loading').forEach(el => el.classList.remove('loading'));
  });
}

function renderPortfolioTable() {
  const tbody = document.getElementById('portfolio-tbody');
  if (!tbody) return;

  if (APP.portfolio.length === 0) {
    tbody.innerHTML = emptyRow(13, '◈', 'Cartera vacía',
      'Añade tus primeras inversiones para seguir su rendimiento y valor total.',
      '+ Añadir activo', 'openAddAsset()');
    return;
  }

  // Sort
  let assets = [...APP.portfolio];
  if (_portfolioSort.col && _PORTFOLIO_SORT_FNS[_portfolioSort.col]) {
    const fn = _PORTFOLIO_SORT_FNS[_portfolioSort.col];
    assets.sort((a, b) => {
      const av = fn(a), bv = fn(b);
      if (av < bv) return -_portfolioSort.dir;
      if (av > bv) return  _portfolioSort.dir;
      return 0;
    });
  }

  // Update sort arrow indicators in thead
  document.querySelectorAll('#portfolio-thead-row th[data-col]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.col === _portfolioSort.col) {
      arrow.textContent = _portfolioSort.dir === 1 ? '↑' : '↓';
      th.classList.add('sort-active');
    } else {
      arrow.textContent = '⇅';
      th.classList.remove('sort-active');
    }
  });

  const totalCostAll  = assets.reduce((s, a) => s + a.buyPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1), 0);
  const totalValueAll = assets.reduce((s, a) => s + a.currentPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1), 0);
  const totalGainAll  = totalValueAll - totalCostAll;
  const totalGainPct  = totalCostAll > 0 ? (totalGainAll / totalCostAll) * 100 : 0;

  const dividendsByTicker = new Map(APP.dividends.map(d => [d.ticker, d]));
  const totalValue        = calcPortfolioValue();
  const concLimit         = parseFloat(document.getElementById('concentration-limit')?.value || 20);

  tbody.innerHTML = assets.map(a => {
    const fx         = a.exchangeRate > 0 ? a.exchangeRate : 1;
    const value      = a.currentPrice * a.quantity * fx;
    const cost       = a.buyPrice    * a.quantity * fx;
    const gain       = value - cost;
    const gainPct    = cost > 0 ? (gain / cost) * 100 : 0;
    const cls        = colorClass(gain);
    const concPct    = totalValue > 0 ? (value / totalValue) * 100 : 0;
    const limit      = concLimit;
    const concCls    = concPct > limit ? 'negative' : concPct > limit * 0.8 ? '' : 'positive';

    // Days held
    const daysHeld   = a.buyDate ? Math.floor((Date.now() - new Date(a.buyDate)) / 86400000) : null;
    const daysLabel  = daysHeld !== null ? formatDaysHeld(daysHeld) : '—';

    const divEntry   = dividendsByTicker.get(a.ticker);
    const divYield   = divEntry && a.currentPrice > 0
      ? ((divEntry.dividendPerShare * { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 }[divEntry.frequency] || 1) / a.currentPrice * 100).toFixed(2)
      : null;
    return `
      <tr data-id="${a.id}"${_isPriceStale(a) ? ' class="portfolio-row-stale"' : ''} tabindex="0">
        <td><strong>${escapeHtml(a.name)}</strong>${divYield ? ` <span class="div-yield-badge" title="Dividend yield anual">${divYield}%</span>` : ''}</td>
        <td><span class="ticker-chip">${escapeHtml(a.ticker)}</span></td>
        <td style="font-size:12px;color:var(--text-muted);line-height:1.4">
          ${escapeHtml(a.country || '—')}
          ${a.sector ? `<br><span style="font-size:10px;opacity:.65">${escapeHtml(a.sector)}</span>` : ''}
        </td>
        <td class="text-right">${formatCurrency(a.buyPrice)}</td>
        <td class="text-right">
          <div class="editable-price">
            <input type="number" value="${a.currentPrice}" step="0.01" min="0"
              aria-label="Precio actual de ${escapeHtml(a.name)}"
              onchange="updateAssetPrice('${a.id}', this.value)"
              style="width:90px;text-align:right" />
            ${a.currency && a.currency !== 'EUR' ? `<span class="currency-badge">${escapeHtml(a.currency)}</span>` : ''}
          </div>
          ${a.dailyChangePct != null && a.dailyChangePct !== 0 ? `<div class="price-daily-change ${a.dailyChangePct >= 0 ? 'positive' : 'negative'}">${a.dailyChangePct >= 0 ? '+' : ''}${a.dailyChangePct.toFixed(2)}% hoy</div>` : ''}
          ${_isPriceStale(a) ? `<div class="price-stale" title="Precio desactualizado — pulsa ⟳ para refrescar">${a.priceDate ? _relativeTime(a.priceDate) : 'sin fecha'}</div>` : ''}
        </td>
        <td class="text-right">${a.quantity}</td>
        <td class="text-right">${formatCurrency(cost)}</td>
        <td class="text-right"><strong>${formatCurrency(value)}</strong></td>
        <td class="text-right ${cls}"><span aria-hidden="true">${gain >= 0 ? '▲' : '▼'}</span> ${formatCurrency(gain, true)}</td>
        <td class="text-right ${cls}"><span aria-hidden="true">${gainPct >= 0 ? '▲' : '▼'}</span> ${formatPct(gainPct)}</td>
        <td class="text-right ${concCls}">
          ${concPct.toFixed(1)}%
          ${concPct > limit ? '<span title="Supera el límite de concentración">⚠</span>' : ''}
        </td>
        <td class="text-right" style="font-size:12px;color:var(--text-muted)">${daysLabel}</td>
        <td class="text-right" style="font-size:12px">${(() => { const c = calcAssetCAGR(a); return c !== null ? `<span class="${colorClass(c)}"><span aria-hidden="true">${c >= 0 ? '▲' : '▼'}</span> ${formatPct(c)}</span>` : '<span style="color:var(--text-muted)">—</span>'; })()}</td>
        <td>
          <div class="action-buttons">
            <button class="btn-icon" data-action="price-chart" title="Ver histórico de precios" aria-label="Ver histórico de precios de ${escapeHtml(a.name)}" style="opacity:${(a.priceHistory||[]).length>1?'1':'.35'}">📈</button>
            <button class="btn-edit btn-icon" data-action="edit-asset" aria-label="Editar ${escapeHtml(a.name)}">✎</button>
            <button class="btn-danger btn-icon" data-action="delete-asset" aria-label="Eliminar ${escapeHtml(a.name)} de cartera">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (!tbody._kbNav) {
    tbody._kbNav = true;
    tbody.addEventListener('keydown', _tableKeydown);
  }

  // Totals row
  const tfoot = document.getElementById('portfolio-tfoot');
  if (tfoot && assets.length > 1) {
    const gcls = colorClass(totalGainAll);
    tfoot.innerHTML = `<tr class="portfolio-totals-row">
      <td colspan="6"><strong>TOTAL</strong></td>
      <td class="text-right"><strong>${formatCurrency(totalCostAll)}</strong></td>
      <td class="text-right"><strong>${formatCurrency(totalValueAll)}</strong></td>
      <td class="text-right ${gcls}"><strong>${formatCurrency(totalGainAll, true)}</strong></td>
      <td class="text-right ${gcls}"><strong>${formatPct(totalGainPct)}</strong></td>
      <td colspan="4"></td>
    </tr>`;
    tfoot.style.display = '';
  } else if (tfoot) {
    tfoot.style.display = 'none';
  }
}

function renderPortfolioCharts() {
  const ctx1 = document.getElementById('chart-portfolio-dist');
  const ctx2 = document.getElementById('chart-portfolio-perf');
  if (!ctx1 || !ctx2 || APP.portfolio.length === 0) return;

  const { gridColor, textColor, fontFamily } = getChartDefaults();

  // Distribución por activo (donut)
  const distLabels = APP.portfolio.map(a => a.ticker);
  const distValues = APP.portfolio.map(a => a.currentPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1));

  const pdChart = Charts.get('portfolio-dist');
  if (pdChart) {
    pdChart.data.labels = distLabels;
    pdChart.data.datasets[0].data = distValues;
    pdChart.data.datasets[0].backgroundColor = CHART_COLORS.slice(0, distValues.length);
    pdChart.options.plugins.legend.labels.color = textColor;
    pdChart.update('none');
  } else {
    Charts.destroy('portfolio-dist', 'chart-portfolio-dist');
    Charts.set('portfolio-dist', new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: distLabels,
        datasets: [{
          data: distValues,
          backgroundColor: CHART_COLORS.slice(0, distValues.length),
          borderColor: 'transparent',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: textColor, font: { family: fontFamily, size: 11 }, boxWidth: 10 }
          },
          tooltip: {
            callbacks: { label: ctx => `${escapeHtml(ctx.label)}: ${formatCurrency(ctx.raw)}` }
          }
        }
      }
    }));
  }

  // Rentabilidad por activo (barras horizontales)
  const sortedByPerf = [...APP.portfolio].sort((a, b) => {
    const pa = ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100;
    const pb = ((b.currentPrice - b.buyPrice) / b.buyPrice) * 100;
    return pa - pb;
  });

  const perfLabels = sortedByPerf.map(a => a.ticker);
  const perfValues = sortedByPerf.map(a => parseFloat((((a.currentPrice - a.buyPrice) / a.buyPrice) * 100).toFixed(2)));
  const perfColors = perfValues.map(v => v >= 0 ? 'rgba(61,220,132,0.7)' : 'rgba(255,92,92,0.7)');

  const ppChart = Charts.get('portfolio-perf');
  if (ppChart) {
    ppChart.data.labels = perfLabels;
    ppChart.data.datasets[0].data = perfValues;
    ppChart.data.datasets[0].backgroundColor = perfColors;
    ppChart.options.scales.x.grid.color = gridColor;
    ppChart.options.scales.x.ticks.color = textColor;
    ppChart.options.scales.y.ticks.color = textColor;
    ppChart.update('none');
  } else {
    Charts.destroy('portfolio-perf', 'chart-portfolio-perf');
    Charts.set('portfolio-perf', new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: perfLabels,
        datasets: [{
          label: 'Rentabilidad (%)',
          data: perfValues,
          backgroundColor: perfColors,
          borderRadius: 5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => formatPct(ctx.raw) } }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: fontFamily, size: 11 }, callback: v => v + '%' }
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: fontFamily, size: 12 } }
          }
        }
      }
    }));
  }

  // Resize charts when container dimensions change (zoom / rotation)
  const chartsContainer = ctx1.closest('.charts-grid') || ctx1.parentElement;
  if (chartsContainer && !chartsContainer._roAttached) {
    chartsContainer._roAttached = true;
    new ResizeObserver(() => {
      Object.values(Charts._r).forEach(chart => { if (chart) chart.resize(); });
    }).observe(chartsContainer);
  }
}

function renderCountryChart() {
  const wrap = document.getElementById('chart-country-wrap');
  if (!wrap) return;

  const hasCountryData = APP.portfolio.some(a => a.country && a.country.trim());

  if (APP.portfolio.length === 0 || !hasCountryData) {
    Charts.destroy('portfolio-country');
    const msg = APP.portfolio.length === 0
      ? 'Añade activos a tu cartera para ver la distribución por país'
      : 'Edita tus activos y añade el país de origen para ver este gráfico';
    wrap.innerHTML = `<div class="chart-empty-hint"><span class="chart-empty-icon">🌍</span><span>${msg}</span>${APP.portfolio.length > 0 ? `<button class="btn-ghost-sm" onclick="openAddAsset(APP.portfolio[0])">Editar activo</button>` : ''}</div>`;
    return;
  }

  // Ensure canvas is present (may have been replaced by empty state)
  if (!wrap.querySelector('canvas')) {
    wrap.innerHTML = `<canvas id="chart-portfolio-country" role="img" aria-label="Gráfico de distribución de cartera por país"></canvas>`;
    Charts.destroy('portfolio-country');
  }
  const ctx = document.getElementById('chart-portfolio-country');
  if (!ctx) return;

  const { textColor, fontFamily } = getChartDefaults();

  const byCountry = {};
  APP.portfolio.forEach(a => {
    if (!a.country) return;
    const val = a.currentPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1);
    byCountry[a.country] = (byCountry[a.country] || 0) + val;
  });
  const labels = Object.keys(byCountry);
  const values = Object.values(byCountry);

  const pcChart = Charts.get('portfolio-country');
  if (pcChart) {
    pcChart.data.labels = labels;
    pcChart.data.datasets[0].data = values;
    pcChart.data.datasets[0].backgroundColor = CHART_COLORS.slice(0, labels.length);
    pcChart.options.plugins.legend.labels.color = textColor;
    pcChart.update('none');
  } else {
    Charts.destroy('portfolio-country', 'chart-portfolio-country');
    Charts.set('portfolio-country', new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: CHART_COLORS.slice(0, labels.length),
          borderColor: 'transparent',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: textColor, font: { family: fontFamily, size: 11 }, boxWidth: 10 }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = values.reduce((s, v) => s + v, 0);
                const pct   = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : '0';
                return `${escapeHtml(ctx.label)}: ${formatCurrency(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    }));
  }
}

function renderSectorChart() {
  const wrap = document.getElementById('chart-sector-wrap');
  if (!wrap) return;

  const hasSectorData = APP.portfolio.some(a => a.sector && a.sector.trim());

  if (APP.portfolio.length === 0 || !hasSectorData) {
    Charts.destroy('portfolio-sector');
    const msg = APP.portfolio.length === 0
      ? 'Añade activos a tu cartera para ver la distribución por sector'
      : 'Edita tus activos y añade el sector para ver este gráfico';
    wrap.innerHTML = `<div class="chart-empty-hint"><span class="chart-empty-icon">🏭</span><span>${msg}</span>${APP.portfolio.length > 0 ? `<button class="btn-ghost-sm" onclick="openAddAsset(APP.portfolio[0])">Editar activo</button>` : ''}</div>`;
    return;
  }

  // Ensure canvas is present (may have been replaced by empty state)
  if (!wrap.querySelector('canvas')) {
    wrap.innerHTML = `<canvas id="chart-portfolio-sector" role="img" aria-label="Gráfico de distribución de cartera por sector"></canvas>`;
    Charts.destroy('portfolio-sector');
  }
  const ctx = document.getElementById('chart-portfolio-sector');
  if (!ctx) return;

  const { textColor, fontFamily } = getChartDefaults();

  const bySector = {};
  APP.portfolio.forEach(a => {
    if (!a.sector) return;
    const val = a.currentPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1);
    bySector[a.sector] = (bySector[a.sector] || 0) + val;
  });

  const sorted = Object.entries(bySector).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => v);
  const total  = values.reduce((s, v) => s + v, 0);

  const psChart = Charts.get('portfolio-sector');
  if (psChart) {
    psChart.data.labels = labels;
    psChart.data.datasets[0].data = values;
    psChart.data.datasets[0].backgroundColor = CHART_COLORS.slice(0, labels.length);
    psChart.options.plugins.legend.labels.color = textColor;
    psChart.update('none');
  } else {
    Charts.destroy('portfolio-sector', 'chart-portfolio-sector');
    Charts.set('portfolio-sector', new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: CHART_COLORS.slice(0, labels.length),
          borderColor: 'transparent',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: textColor, font: { family: fontFamily, size: 11 }, boxWidth: 10 }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : '0';
                return `${escapeHtml(ctx.label)}: ${formatCurrency(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    }));
  }
}

/* ─── CRUD Cartera ────────────────────────────────────────── */
function _assetModalFill(a) {
  const frag = document.getElementById('tpl-add-asset').content.cloneNode(true);
  frag.querySelector('#f-a-ticker').value  = a.ticker   || '';
  frag.querySelector('#f-a-name').value    = a.name     || '';
  frag.querySelector('#f-a-buy').value     = a.buyPrice    || '';
  frag.querySelector('#f-a-current').value = a.currentPrice || '';
  frag.querySelector('#f-a-qty').value     = a.quantity  || '';
  frag.querySelector('#f-a-buydate').value = a.buyDate   || '';
  frag.querySelector('#f-a-exrate').value  = a.exchangeRate || '';
  frag.querySelector('#f-a-country').value = a.country   || '';
  frag.querySelector('#f-a-sector').value  = a.sector    || '';
  frag.querySelector('#f-a-currency').value = a.currency || 'EUR';

  const exrateGroup = frag.querySelector('#f-a-exrate-group');
  const exrateLabel = frag.querySelector('#f-a-exrate-label');
  const showExrate  = a.currency && a.currency !== 'EUR';
  if (exrateGroup) exrateGroup.style.display = showExrate ? '' : 'none';
  if (exrateLabel && a.currency) exrateLabel.textContent = `Tipo de cambio (1 ${a.currency} = ? €)`;

  frag.querySelector('#f-a-ticker').addEventListener('blur', () =>
    autoFillTicker('f-a-ticker', 'f-a-name', 'f-a-current', 'f-a-ticker-badge', 'f-a-buy'));
  frag.querySelector('#f-a-currency').addEventListener('change', function() {
    const grp = document.getElementById('f-a-exrate-group');
    const lbl = document.getElementById('f-a-exrate-label');
    if (grp) grp.style.display = this.value === 'EUR' ? 'none' : '';
    if (lbl) lbl.textContent = `Tipo de cambio (1 ${this.value} = ? €)`;
  });
  return frag;
}

function _assetSave(prefill, isEdit) {
  const name         = document.getElementById('f-a-name').value.trim();
  const ticker       = document.getElementById('f-a-ticker').value.trim().toUpperCase();
  const buyPrice     = parseFloat(document.getElementById('f-a-buy').value);
  const currentPrice = parseFloat(document.getElementById('f-a-current').value);
  const quantity     = parseFloat(document.getElementById('f-a-qty').value);
  const buyDate      = document.getElementById('f-a-buydate').value;
  const country      = document.getElementById('f-a-country').value;
  const sector       = document.getElementById('f-a-sector').value;
  const currency     = document.getElementById('f-a-currency').value || 'EUR';
  const rawRate      = currency === 'EUR' ? 1 : parseFloat(document.getElementById('f-a-exrate').value);
  const exchangeRate = currency === 'EUR' ? 1 : rawRate;

  if (!name)                                    return showToast('El nombre es obligatorio', 'error');
  if (!ticker)                                  return showToast('El ticker es obligatorio', 'error');
  if (isNaN(buyPrice)     || buyPrice < 0)      return showToast('Precio de compra inválido', 'error');
  if (isNaN(currentPrice) || currentPrice < 0)  return showToast('Precio actual inválido', 'error');
  if (isNaN(quantity)     || quantity <= 0)      return showToast('Cantidad inválida', 'error');
  if (currency !== 'EUR' && (isNaN(rawRate) || rawRate <= 0)) return showToast('El tipo de cambio debe ser mayor que 0', 'error');

  if (isEdit) {
    const idx = APP.portfolio.findIndex(x => x.id === prefill.id);
    if (idx >= 0) APP.portfolio[idx] = { ...prefill, name, ticker, buyPrice, currentPrice, quantity, buyDate, country, sector, currency, exchangeRate };
    showToast('Activo actualizado ✓', 'success');
  } else {
    APP.portfolio.push({ id: generateId(), name, ticker, buyPrice, currentPrice, quantity, buyDate, country, sector, currency, exchangeRate });
    showToast('Activo añadido ✓', 'success');
  }
  updateNetworthHistory(); saveData(); closeModal(); renderPortfolio();
  if (APP.activeSection === SECTIONS.DASHBOARD) renderDashboard();
}

function openAddAsset(prefill = null) {
  const isEdit = !!prefill;
  const a = prefill || {};
  openModal(
    isEdit ? 'Editar activo' : 'Nuevo activo',
    _assetModalFill(a),
    () => _assetSave(prefill, isEdit),
    () => {
      const tickerInput = document.getElementById('f-a-ticker');
      if (!tickerInput) return;

      function checkTwoMonthsBuy(rawTicker) {
        const ticker = (rawTicker || '').trim().toUpperCase();
        const warn   = document.getElementById('two-months-buy-warn');
        if (!warn) return;
        if (!ticker) { warn.style.display = 'none'; return; }
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 2);
        const lossSales = (APP.sales || []).filter(s => {
          if ((s.ticker || '').toUpperCase() !== ticker) return false;
          return (s.sellPrice - s.buyPrice) * s.quantity < 0 && new Date(s.sellDate) >= cutoff;
        });
        if (lossSales.length === 0) { warn.style.display = 'none'; return; }
        const latest = lossSales.sort((a, b) => b.sellDate.localeCompare(a.sellDate))[0];
        const loss   = Math.abs((latest.sellPrice - latest.buyPrice) * latest.quantity);
        const winEnd = new Date(latest.sellDate); winEnd.setMonth(winEnd.getMonth() + 2);
        const fmtD   = d => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        warn.style.display = '';
        warn.innerHTML = `<div class="fisc-alert fisc-alert-warning" style="margin-top:8px">
          <strong>⏱ Regla de los 2 meses</strong><br>
          Vendiste <strong>${escapeHtml(ticker)}</strong> con pérdida de <strong>${formatCurrency(loss)}</strong>
          el ${formatDate(latest.sellDate)}.
          Comprar ahora <strong>anulará esa deducción fiscal</strong>.
          Puedes recomprar con seguridad a partir del <strong>${fmtD(winEnd)}</strong>.
        </div>`;
      }

      let debounce = null;
      tickerInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          applyTickerLookup(tickerInput.value);
          checkTwoMonthsBuy(tickerInput.value);
          autoFillTicker('f-a-ticker', 'f-a-name', 'f-a-current', 'f-a-ticker-badge', 'f-a-buy');
        }, 350);
      });
      tickerInput.addEventListener('blur', () => { applyTickerLookup(tickerInput.value); checkTwoMonthsBuy(tickerInput.value); });
      if (a.ticker) { applyTickerLookup(a.ticker, true); checkTwoMonthsBuy(a.ticker); }

      _setupFormValidation([
        { id: 'f-a-name',    test: () => !!document.getElementById('f-a-name')?.value.trim(),           msg: 'El nombre es obligatorio' },
        { id: 'f-a-buy',     test: () => parseFloat(document.getElementById('f-a-buy')?.value) > 0,     msg: 'Precio de compra requerido' },
        { id: 'f-a-current', test: () => parseFloat(document.getElementById('f-a-current')?.value) > 0, msg: 'Precio actual requerido' },
        { id: 'f-a-qty',     test: () => parseFloat(document.getElementById('f-a-qty')?.value) > 0,     msg: 'Cantidad requerida' },
      ]);
    },
  );
}

async function applyTickerLookup(rawTicker, silent = false) {
  const ticker = (rawTicker || '').trim().toUpperCase();
  if (!ticker) return;
  await _loadTickerDb().catch(() => {});

  const nameEl    = document.getElementById('f-a-name');
  const countryEl = document.getElementById('f-a-country');
  const sectorEl  = document.getElementById('f-a-sector');
  const badge     = document.getElementById('f-a-ticker-badge');

  const info = TICKER_DB[ticker];
  if (info) {
    if (nameEl    && !nameEl.value.trim())    nameEl.value    = info.name;
    if (countryEl && !countryEl.value)        countryEl.value = info.country;
    if (sectorEl  && !sectorEl.value)         sectorEl.value  = info.sector;
    if (silent) {
      if (countryEl) countryEl.value = info.country;
      if (sectorEl)  sectorEl.value  = info.sector;
    }
    if (badge) badge.style.display = '';
    return;
  }

  // Unknown ticker: try Yahoo Finance quoteSummary
  const needsCountry = !countryEl?.value;
  const needsSector  = !sectorEl?.value;
  if (!needsCountry && !needsSector) return;

  try {
    const r = await fetch(`${SERVER_URL}/api/yahoo-info?ticker=${encodeURIComponent(ticker)}`);
    if (!r.ok) return;
    const data = await r.json();
    if (data.error) return;

    if (countryEl && needsCountry && data.country) {
      countryEl.value = yahooCountryToApp(data.country);
    }
    if (sectorEl && needsSector && data.sector) {
      sectorEl.value = yahooSectorToSpanish(data.sector);
    }
    if (badge && (data.country || data.sector)) badge.style.display = '';
  } catch (_) {}
}

function recordAssetPriceHistory(asset) {
  if (!asset.priceHistory) asset.priceHistory = [];
  const today = new Date().toISOString().split('T')[0];
  const last  = asset.priceHistory[asset.priceHistory.length - 1];
  if (last && last.date === today) {
    last.price = asset.currentPrice;
  } else {
    asset.priceHistory.push({ date: today, price: asset.currentPrice });
  }
  if (asset.priceHistory.length > 365) asset.priceHistory = asset.priceHistory.slice(-365);
}

function updateAssetPrice(id, newPrice) {
  const asset = APP.portfolio.find(a => a.id === id);
  if (!asset) return;
  asset.currentPrice = parseFloat(newPrice) || 0;
  recordAssetPriceHistory(asset);
  updateNetworthHistory();
  saveData();
  showToast('Precio guardado ✓', 'success');

  // Actualizar sin destruir los inputs: solo actualizamos las celdas
  // que dependen del precio (valor, G/P, % cartera) y los KPIs superiores.
  const totalValue = calcPortfolioValue();
  const totalCost  = APP.portfolio.reduce((s, a) => s + a.buyPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1), 0);
  const totalGain  = totalValue - totalCost;
  const totalPct   = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  // KPIs superiores
  setText('port-total-value', formatCurrency(totalValue));
  setText('port-total-cost',  formatCurrency(totalCost));
  const gainEl = document.getElementById('port-total-gain');
  if (gainEl) { gainEl.textContent = `${totalGain >= 0 ? '▲ ' : '▼ '}${formatCurrency(totalGain, true)}`; gainEl.className = 'kpi-value ' + colorClass(totalGain); }
  const pctEl = document.getElementById('port-total-pct');
  if (pctEl)  { pctEl.textContent  = `${totalPct >= 0 ? '▲ ' : '▼ '}${formatPct(totalPct)}`;              pctEl.className  = 'kpi-value ' + colorClass(totalPct); }

  // Mejor / peor inversión por ganancia absoluta en EUR
  if (APP.portfolio.length > 0) {
    const withGain = APP.portfolio.map(a => {
      const fx   = a.exchangeRate > 0 ? a.exchangeRate : 1;
      const gain = (a.currentPrice - a.buyPrice) * a.quantity * fx;
      const pct  = a.buyPrice > 0 ? ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100 : 0;
      return { ...a, gain, pct };
    });
    const best  = withGain.reduce((b, a) => a.gain > b.gain ? a : b);
    const worst = withGain.reduce((b, a) => a.gain < b.gain ? a : b);
    setText('best-investment-name',  best.name);
    setText('best-investment-val',   `${formatCurrency(best.gain, true)} (${formatPct(best.pct)})`);
    setText('worst-investment-name', worst.name);
    setText('worst-investment-val',  `${formatCurrency(worst.gain, true)} (${formatPct(worst.pct)})`);
    const bv = document.getElementById('best-investment-val');
    const wv = document.getElementById('worst-investment-val');
    if (bv) bv.className = 'highlight-value positive';
    if (wv) wv.className = 'highlight-value negative';
  }

  // Celdas de cada fila: td[7]=Valor actual, td[8]=G/P€, td[9]=G/P%, td[10]=% Cartera
  const limit = parseFloat(document.getElementById('concentration-limit')?.value || 20);
  APP.portfolio.forEach(a => {
    const row = document.querySelector(`#portfolio-tbody tr[data-id="${a.id}"]`);
    if (!row) return;
    const tds     = row.querySelectorAll('td');
    const fx      = a.exchangeRate > 0 ? a.exchangeRate : 1;
    const value   = a.currentPrice * a.quantity * fx;
    const cost    = a.buyPrice * a.quantity * fx;
    const gain    = value - cost;
    const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
    const concPct = totalValue > 0 ? (value / totalValue) * 100 : 0;
    const cls     = colorClass(gain);
    const concCls = concPct > limit ? 'negative' : concPct > limit * 0.8 ? '' : 'positive';

    if (tds[7])  { tds[7].innerHTML   = `<strong>${formatCurrency(value)}</strong>`; }
    if (tds[8])  { tds[8].textContent = formatCurrency(gain, true);  tds[8].className  = `text-right ${cls}`; }
    if (tds[9])  { tds[9].textContent = formatPct(gainPct);          tds[9].className  = `text-right ${cls}`; }
    if (tds[10]) {
      tds[10].className = `text-right ${concCls}`;
      tds[10].innerHTML = `${concPct.toFixed(1)}%${concPct > limit ? ' <span title="Supera el límite de concentración">⚠</span>' : ''}`;
    }
  });

  // Barras de concentración y gráficos (están fuera de la tabla)
  renderConcentrationBars();
  renderPortfolioCharts();
  renderCountryChart();
  renderSectorChart();
}

function editAsset(id) {
  const asset = APP.portfolio.find(a => a.id === id);
  if (asset) openAddAsset(asset);
}

function deleteAsset(id) {
  const asset = APP.portfolio.find(a => a.id === id);
  if (!asset) return;
  APP.portfolio = APP.portfolio.filter(a => a.id !== id);
  updateNetworthHistory();
  renderPortfolio();
  softDelete(`"${asset.name}" eliminado de cartera`, () => {
    APP.portfolio.push(asset);
    updateNetworthHistory();
    saveData();
    renderPortfolio();
  });
}

let _chartPriceHistory = null;

function openAssetPriceChart(id) {
  const asset = APP.portfolio.find(a => a.id === id);
  if (!asset) return;

  openModal(`Evolución — ${escapeHtml(asset.name)}`, `
    <div style="position:relative;height:290px">
      <div id="ph-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px;gap:8px">
        <span style="animation:spin 1s linear infinite;display:inline-block">⟳</span> Cargando historial…
      </div>
      <canvas id="chart-price-hist-modal" role="img" aria-label="Gráfico de historial de precios del activo" style="display:none"></canvas>
    </div>
    <div id="ph-summary" style="display:flex;gap:20px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--text-muted)"></div>
  `, null, async () => {
    const footer = document.getElementById('modal')?.querySelector('.modal-footer');
    if (footer) footer.style.display = 'none';

    // Build history: start with local data, then try to backfill from Yahoo
    let history = [...(asset.priceHistory || [])];

    if (asset.ticker) {
      try {
        const r    = await fetch(`${SERVER_URL}/api/yahoo?ticker=${encodeURIComponent(asset.ticker)}&range=1y`);
        const data = await r.json().catch(() => null);
        if (data?.error) {
          showToast('Precio no disponible: ' + data.error, 'error');
        } else if (data) {
          const result = data?.chart?.result?.[0];
          const ts     = result?.timestamp || [];
          const closes = result?.indicators?.quote?.[0]?.close || [];
          const yahoo  = ts
            .map((t, i) => ({ date: new Date(t * 1000).toISOString().split('T')[0], price: closes[i] }))
            .filter(h => h.price != null && h.price > 0);

          if (yahoo.length > 0) {
            // Merge: Yahoo as base, local points override where they overlap
            const localMap = Object.fromEntries(history.map(h => [h.date, h.price]));
            const merged   = new Map(yahoo.map(h => [h.date, h.price]));
            Object.entries(localMap).forEach(([d, p]) => merged.set(d, p));
            history = [...merged.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, price]) => ({ date, price }));
          }
        }
      } catch (_) {}
    }

    const loadEl = document.getElementById('ph-loading');
    const ctx    = document.getElementById('chart-price-hist-modal');

    if (history.length < 2) {
      if (loadEl) loadEl.innerHTML = 'Sin datos de historial disponibles — actualiza el precio con ⟳ para empezar a acumular.';
      return;
    }

    if (loadEl) loadEl.style.display = 'none';
    if (ctx)    ctx.style.display = '';

    const prices  = history.map(h => h.price);
    const buyP    = asset.buyPrice || 0;
    const last    = prices[prices.length - 1];
    const minP    = Math.min(...prices);
    const maxP    = Math.max(...prices);
    const lineClr = last >= buyP ? '#4aaa7a' : '#d06060';
    const fillClr = last >= buyP ? 'rgba(74,170,122,0.08)' : 'rgba(208,96,96,0.08)';

    // Summary bar
    const sumEl = document.getElementById('ph-summary');
    if (sumEl && buyP > 0) {
      const vsBuy = ((last - buyP) / buyP * 100).toFixed(1);
      const clr   = last >= buyP ? 'var(--up)' : 'var(--down)';
      sumEl.innerHTML = `
        <span>Compra: <strong>${formatCurrency(buyP)}</strong></span>
        <span>Actual: <strong>${formatCurrency(last)}</strong></span>
        <span>Mín 1a: <strong>${formatCurrency(minP)}</strong></span>
        <span>Máx 1a: <strong>${formatCurrency(maxP)}</strong></span>
        <span>vs compra: <strong style="color:${clr}">${vsBuy >= 0 ? '+' : ''}${vsBuy}%</strong></span>
      `;
    }

    if (_chartPriceHistory) { _chartPriceHistory.destroy(); _chartPriceHistory = null; }
    const { gridColor, textColor, fontFamily } = getChartDefaults();

    const datasets = [{
      label: asset.ticker || asset.name,
      data:  prices,
      borderColor: lineClr,
      backgroundColor: fillClr,
      borderWidth: 2,
      fill: true,
      tension: 0.35,
      pointRadius: history.length > 60 ? 0 : 3,
      pointHoverRadius: 5,
    }];

    if (buyP > 0) {
      datasets.push({
        label: 'Precio compra',
        data:  Array(history.length).fill(buyP),
        borderColor: 'rgba(150,170,190,0.55)',
        borderWidth: 1.5,
        borderDash: [6, 4],
        fill: false,
        pointRadius: 0,
        tension: 0,
      });
    }

    _chartPriceHistory = new Chart(ctx, {
      type: 'line',
      data: { labels: history.map(h => h.date), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
          legend: {
            display: buyP > 0,
            labels: { color: textColor, font: { family: fontFamily, size: 10 }, boxWidth: 24, padding: 10 },
          },
          tooltip: {
            callbacks: {
              label: c => `${c.dataset.label}: ${formatCurrency(c.raw)}`,
              title: items => {
                const d = history[items[0].dataIndex]?.date || '';
                return d ? formatDate(d) : d;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: fontFamily, size: 10 },
              maxTicksLimit: 8,
              callback: (_, i) => { const d = history[i]?.date || ''; return d.slice(5).replace('-', '/'); },
            },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: fontFamily, size: 10 },
              callback: v => formatCurrency(v),
            },
          },
        },
      },
    });
  });
}


/* ═══════════════════════════════════════════════════════════════
   25. ANÁLISIS DE CARTERA
   - Concentración por posición
   - Correlación entre activos
   - Tiempo en cada inversión
═══════════════════════════════════════════════════════════════ */

/** Formatea días en formato legible */
function formatDaysHeld(days) {
  if (days < 1)   return 'Hoy';
  if (days < 30)  return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}m ${days % 30}d`;
  const years  = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  return months > 0 ? `${years}a ${months}m` : `${years}a`;
}

/** Barras de concentración por posición */
function renderConcentrationBars() {
  const el = document.getElementById('concentration-bars');
  if (!el) return;

  const totalValue = calcPortfolioValue();
  if (totalValue === 0 || APP.portfolio.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Sin activos en cartera</div>';
    return;
  }

  const limit = parseFloat(document.getElementById('concentration-limit')?.value || 20);

  const sorted = [...APP.portfolio]
    .map(a => ({
      ...a,
      value: assetValue(a),
      pct:   (assetValue(a) / totalValue) * 100
    }))
    .sort((a, b) => b.pct - a.pct);

  el.innerHTML = sorted.map(a => {
    const isOver  = a.pct > limit;
    const isClose = a.pct > limit * 0.8 && !isOver;
    const color   = isOver ? 'var(--down)' : isClose ? 'var(--accent)' : 'var(--up)';
    const warning = isOver  ? `<span class="conc-badge conc-over">⚠ Supera ${limit}%</span>` :
                    isClose ? `<span class="conc-badge conc-close">Cerca del límite</span>` : '';

    return `
      <div class="conc-item">
        <div class="conc-header">
          <div class="conc-name">
            <span class="ticker-chip">${escapeHtml(a.ticker)}</span>
            <span style="margin-left:8px">${escapeHtml(a.name)}</span>
            ${warning}
          </div>
          <div class="conc-values">
            <span style="font-weight:600;color:${color}">${a.pct.toFixed(1)}%</span>
            <span style="color:var(--text-muted);margin-left:8px">${formatCurrency(a.value)}</span>
          </div>
        </div>
        <div class="conc-track">
          <div class="conc-fill" style="width:0%;background:${color}" data-pct="${Math.min(a.pct, 100).toFixed(2)}"></div>
          <div class="conc-limit-line" style="left:${Math.min(limit, 100)}%"></div>
        </div>
      </div>
    `;
  }).join('');

  // Trigger bar entrance animation (bars rendered at 0%, set real width now)
  requestAnimationFrame(() => {
    el.querySelectorAll('.conc-fill[data-pct]').forEach(bar => {
      bar.style.width = bar.dataset.pct + '%';
    });
  });

  // Wire up the limit input to re-render
  const limitInput = document.getElementById('concentration-limit');
  if (limitInput && !limitInput._wired) {
    limitInput._wired = true;
    limitInput.addEventListener('input', () => {
      renderConcentrationBars();
      renderPortfolioTable();
    });
  }
}

/** Análisis de correlación simplificado basado en tipo de activo */
function renderCorrelationAnalysis() {
  const el = document.getElementById('correlation-analysis');
  if (!el) return;

  if (APP.portfolio.length < 2) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Necesitas al menos 2 activos para analizar correlaciones</div>';
    return;
  }

  // Grupos por tipo usando palabras clave del nombre/ticker
  const ETF_KEYWORDS  = ['ETF', 'INDEX', 'SP500', 'MSCI', 'WORLD', 'NASDAQ', 'DAX', 'IBEX', 'ACWI', 'VWCE', 'CSPX', 'SXR', 'IWDA'];
  const TECH_KEYWORDS = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'AMD', 'INTC', 'ORCL', 'CRM'];
  const BANK_KEYWORDS = ['SAN', 'BBVA', 'BNP', 'HSBC', 'JPM', 'GS', 'MS', 'BAC', 'C', 'WFC', 'DB', 'UCG'];

  const getGroup = (asset) => {
    const upper = (asset.name + ' ' + asset.ticker).toUpperCase();
    if (ETF_KEYWORDS.some(k => upper.includes(k)))  return 'ETF / Indexado';
    if (TECH_KEYWORDS.some(k => upper === k || upper.includes(k + ' '))) return 'Tecnología';
    if (BANK_KEYWORDS.some(k => upper === k || upper.includes(k + ' '))) return 'Banca';
    return 'Otro';
  };

  // Agrupar activos
  const groups = {};
  APP.portfolio.forEach(a => {
    const g = getGroup(a);
    if (!groups[g]) groups[g] = [];
    groups[g].push(a);
  });

  const warnings = [];

  Object.entries(groups).forEach(([group, assets]) => {
    if (assets.length >= 2 && group !== 'Otro') {
      const totalValue    = calcPortfolioValue();
      const groupValue    = assets.reduce((s, a) => s + assetValue(a), 0);
      const groupPct      = totalValue > 0 ? (groupValue / totalValue) * 100 : 0;
      const names         = assets.map(a => `<span class="ticker-chip">${escapeHtml(a.ticker)}</span>`).join(' ');

      warnings.push({
        level:   groupPct > 50 ? 'high' : groupPct > 30 ? 'medium' : 'low',
        group,
        assets:  names,
        count:   assets.length,
        pct:     groupPct,
      });
    }
  });

  if (warnings.length === 0) {
    el.innerHTML = `
      <div class="corr-ok">
        <span style="font-size:18px">✓</span>
        <div>
          <div style="font-weight:600;font-size:13.5px">Sin correlaciones detectadas</div>
          <div style="font-size:12px;color:var(--text-muted)">Tu cartera parece bien diversificada por tipo de activo</div>
        </div>
      </div>`;
    return;
  }

  const levelLabel = { high: '⚠ Alta concentración', medium: '↗ Concentración moderada', low: '· Leve concentración' };
  const levelColor = { high: 'var(--down)', medium: 'var(--accent)', low: 'var(--text-secondary)' };

  el.innerHTML = warnings.map(w => `
    <div class="corr-item">
      <div class="corr-icon" style="color:${levelColor[w.level]}">
        ${w.level === 'high' ? '⚠' : w.level === 'medium' ? '↗' : '·'}
      </div>
      <div class="corr-info">
        <div class="corr-title" style="color:${levelColor[w.level]}">${levelLabel[w.level]}</div>
        <div class="corr-desc">
          Tienes <strong>${w.count} activos del sector ${w.group}</strong> 
          que representan el <strong>${w.pct.toFixed(1)}%</strong> de tu cartera:
          ${w.assets}
        </div>
        <div class="corr-tip">
          Estos activos tienden a moverse juntos en el mercado. 
          ${w.level === 'high' ? 'Considera diversificar hacia otros sectores.' : 'Vigila la exposición sectorial.'}
        </div>
      </div>
    </div>
  `).join('');
}

/* ═══════════════════════════════════════════════════════════════
   WATCHLIST
═══════════════════════════════════════════════════════════════ */

function renderWatchlist() {
  _delegate('section-watchlist', {
    'edit-watch':   id => editWatchlistItem(id),
    'delete-watch': id => deleteWatchlistItem(id),
  });
  const grid = document.getElementById('watchlist-grid');
  if (!grid) return;

  if (APP.watchlist.length === 0) {
    grid.innerHTML = `
      <div class="empty-cta">
        <div class="empty-cta-svg">
          <svg width="80" height="68" viewBox="0 0 80 68" fill="none" aria-hidden="true">
            <rect x="6"  y="42" width="10" height="20" rx="2" fill="currentColor" opacity="0.12"/>
            <rect x="22" y="30" width="10" height="32" rx="2" fill="currentColor" opacity="0.17"/>
            <rect x="38" y="18" width="10" height="44" rx="2" fill="currentColor" opacity="0.22"/>
            <rect x="54" y="8"  width="10" height="54" rx="2" fill="currentColor" opacity="0.28"/>
            <path d="M11 44 L27 32 L43 20 L59 10"
              stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
            <circle cx="59" cy="10" r="4" fill="currentColor" opacity="0.55"/>
            <circle cx="59" cy="10" r="8" stroke="currentColor" stroke-width="1.2" opacity="0.2"/>
            <line x1="0" y1="64" x2="80" y2="64" stroke="currentColor" stroke-width="1.2" opacity="0.1"/>
          </svg>
        </div>
        <h4 class="empty-cta-title">Watchlist vacía</h4>
        <p class="empty-cta-desc">Sigue activos que te interesan y recibe alertas cuando alcancen tu precio objetivo.</p>
        <button class="btn-primary" style="margin-top:6px" onclick="openAddWatchlistItem()">+ Añadir tu primer ticker</button>
      </div>`;
    return;
  }

  grid.innerHTML = APP.watchlist.map(w => {
    const hasTarget    = w.targetPrice && w.targetPrice > 0;
    const alertType    = w.alertType || 'above';
    const targetReached = hasTarget && (alertType === 'below' ? w.currentPrice <= w.targetPrice : w.currentPrice >= w.targetPrice);
    const pctToTarget  = hasTarget ? ((w.targetPrice - w.currentPrice) / w.currentPrice) * 100 : null;
    const dirLabel     = alertType === 'below' ? '↓ por debajo' : '↑ por encima';

    // Progress bar from 0 (no progress) toward target
    let progressPct = 0;
    let progressBar = '';
    if (hasTarget && !targetReached) {
      if (alertType === 'above') {
        // Show how close current price is to target (capped 0-100%)
        progressPct = Math.max(0, Math.min(100, (w.currentPrice / w.targetPrice) * 100));
      } else {
        // For "below" alerts: show inverse proximity
        progressPct = Math.max(0, Math.min(100, (w.targetPrice / w.currentPrice) * 100));
      }
      progressBar = `<div class="watchlist-progress-track"><div class="watchlist-progress-fill" style="width:${progressPct.toFixed(1)}%"></div></div>`;
    }

    return `
      <div class="watchlist-card${targetReached ? ' watchlist-card--alert' : ''}" data-id="${w.id}">
        <div class="watchlist-actions">
          <button class="btn-edit btn-icon" data-action="edit-watch" aria-label="Editar ${escapeHtml(w.name)}">✎</button>
          <button class="btn-danger btn-icon" data-action="delete-watch" aria-label="Eliminar ${escapeHtml(w.name)} de watchlist">✕</button>
        </div>
        <div class="watchlist-ticker">${escapeHtml(w.ticker)}</div>
        <div class="watchlist-name">${escapeHtml(w.name)}</div>
        <div class="watchlist-price-row">
          <div class="watchlist-price">${formatCurrency(w.currentPrice)}</div>
          <div class="editable-price">
            <input type="number" value="${w.currentPrice}" step="0.01" min="0"
              aria-label="Precio actual de ${escapeHtml(w.name)}"
              onchange="updateWatchlistPrice('${w.id}', this.value)"
              title="Precio actual" style="width:80px" />
          </div>
        </div>
        ${w.dailyChangePct != null && w.dailyChangePct !== 0 ? `<div class="watchlist-daily-change ${w.dailyChangePct >= 0 ? 'positive' : 'negative'}">${w.dailyChangePct >= 0 ? '▲ +' : '▼ '}${Math.abs(w.dailyChangePct).toFixed(2)}% hoy</div>` : ''}
        ${w.priceDate ? `<div class="watchlist-price-age">actualizado ${_relativeTime(w.priceDate)}</div>` : ''}
        ${hasTarget ? `
          <div class="watchlist-target">
            Alerta ${dirLabel}: ${formatCurrency(w.targetPrice)}
            <span class="${colorClass(pctToTarget)}" style="font-weight:700"> (${formatPct(pctToTarget)})</span>
          </div>
          ${progressBar}
          ${targetReached ? `<div class="watchlist-target-badge watchlist-target-badge--reached">🔔 ¡Precio ${alertType === 'below' ? 'por debajo' : 'alcanzado'}!</div>` : ''}
        ` : ''}
        ${w.notes ? `<div class="watchlist-target" style="margin-top:4px;font-style:italic">${escapeHtml(w.notes)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function _watchlistModalFill(w) {
  const frag = document.getElementById('tpl-add-watchlist').content.cloneNode(true);
  frag.querySelector('#f-w-name').value  = w.name  || '';
  frag.querySelector('#f-w-ticker').value = w.ticker || '';
  frag.querySelector('#f-w-price').value  = w.currentPrice || '';
  frag.querySelector('#f-w-target').value = w.targetPrice  || '';
  frag.querySelector('#f-w-notes').value  = w.notes || '';
  const alertType = w.alertType || 'above';
  const radio = frag.querySelector(`input[name="f-w-alert-type"][value="${alertType}"]`);
  if (radio) radio.checked = true;
  frag.querySelector('#f-w-ticker').addEventListener('blur', () =>
    autoFillTicker('f-w-ticker', 'f-w-name', 'f-w-price', 'f-w-ticker-badge'));
  return frag;
}

function _watchlistSave(prefill, isEdit) {
  const name         = document.getElementById('f-w-name').value.trim();
  const ticker       = document.getElementById('f-w-ticker').value.trim().toUpperCase();
  const currentPrice = parseFloat(document.getElementById('f-w-price').value)  || 0;
  const targetPrice  = parseFloat(document.getElementById('f-w-target').value) || 0;
  const alertType    = document.querySelector('input[name="f-w-alert-type"]:checked')?.value || 'above';
  const notes        = document.getElementById('f-w-notes').value.trim();

  if (!name)   return showToast('El nombre es obligatorio', 'error');
  if (!ticker) return showToast('El ticker es obligatorio', 'error');

  if (isEdit) {
    const idx = APP.watchlist.findIndex(x => x.id === prefill.id);
    if (idx >= 0) APP.watchlist[idx] = { ...prefill, name, ticker, currentPrice, targetPrice, alertType, notes };
    showToast('Actualizado ✓', 'success');
  } else {
    APP.watchlist.push({ id: generateId(), name, ticker, currentPrice, targetPrice, alertType, notes });
    showToast('Añadido a watchlist ✓', 'success');
  }
  saveData(); closeModal(); renderWatchlist();
}

function openAddWatchlistItem(prefill = null) {
  const isEdit = !!prefill;
  const w = prefill || {};
  openModal(
    isEdit ? 'Editar watchlist' : 'Añadir a watchlist',
    _watchlistModalFill(w),
    () => _watchlistSave(prefill, isEdit),
  );
}

function editWatchlistItem(id) {
  const item = APP.watchlist.find(w => w.id === id);
  if (item) openAddWatchlistItem(item);
}

function deleteWatchlistItem(id) {
  const item = APP.watchlist.find(w => w.id === id);
  if (!item) return;
  APP.watchlist = APP.watchlist.filter(w => w.id !== id);
  renderWatchlist();
  softDelete(`"${item.name}" eliminado de watchlist`, () => {
    APP.watchlist.push(item);
    saveData();
    renderWatchlist();
  });
}

function updateWatchlistPrice(id, newPrice) {
  const item = APP.watchlist.find(w => w.id === id);
  if (!item) return;
  item.currentPrice = parseFloat(newPrice) || 0;
  saveData();
  showToast('Precio guardado ✓', 'success');
  renderWatchlist();
}

/* ═══════════════════════════════════════════════════════════════
   DIVIDENDOS
═══════════════════════════════════════════════════════════════ */


function renderDividends() {
  _delegate('section-dividends', {
    'edit-div':   id => editDividend(id),
    'delete-div': id => deleteDividend(id),
  });
  const FREQ_MULT  = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const FREQ_LABEL = { annual: 'Anual', semiannual: 'Semestral', quarterly: 'Trimestral', monthly: 'Mensual' };

  const annualTotal = APP.dividends.reduce((sum, d) => {
    const mult = FREQ_MULT[d.frequency] || 1;
    return sum + (d.dividendPerShare * d.shares * mult * _divFxRate(d));
  }, 0);

  const portfolioByTicker = new Map(APP.portfolio.map(a => [a.ticker, a]));
  let yieldTotal = 0, valueTotal = 0;
  APP.dividends.forEach(d => {
    const asset = portfolioByTicker.get(d.ticker);
    if (asset) {
      const av   = asset.currentPrice * asset.quantity * (asset.exchangeRate > 0 ? asset.exchangeRate : 1);
      const mult = FREQ_MULT[d.frequency] || 1;
      yieldTotal += d.dividendPerShare * d.shares * mult * _divFxRate(d);
      valueTotal += av;
    }
  });

  const avgYield = valueTotal > 0 ? (yieldTotal / valueTotal) * 100 : 0;
  _animNum(document.getElementById('div-annual'),  annualTotal,        formatCurrency, 500);
  _animNum(document.getElementById('div-monthly'), annualTotal / 12,   formatCurrency, 500);
  _animNum(document.getElementById('div-yield'),   avgYield,           v => formatPct(v, false), 500);
  _animNum(document.getElementById('div-daily'),   annualTotal / 365,  formatCurrency, 500);

  const tbody = document.getElementById('dividends-tbody');
  if (!tbody) return;

  if (APP.dividends.length === 0) {
    tbody.innerHTML = emptyRow(7, '◈', 'Sin dividendos',
      'Registra los activos que generan dividendos para calcular tus ingresos pasivos.',
      '+ Registrar dividendo', 'openAddDividend()');
    return;
  }

  tbody.innerHTML = APP.dividends.map(d => {
    const mult   = FREQ_MULT[d.frequency] || 1;
    const annual = d.dividendPerShare * d.shares * mult * _divFxRate(d);
    const asset  = portfolioByTicker.get(d.ticker);
    const buyPrice = asset?.buyPrice;
    const yoc    = buyPrice > 0
      ? ((d.dividendPerShare * mult) / buyPrice * 100).toFixed(2) + '%'
      : '—';
    const yocCls = buyPrice > 0 ? 'positive' : '';
    return `
      <tr data-id="${d.id}">
        <td><strong>${escapeHtml(d.assetName)}</strong></td>
        <td><span class="ticker-chip">${escapeHtml(d.ticker)}</span></td>
        <td class="text-right">${formatCurrency(d.dividendPerShare)}</td>
        <td class="text-right">${FREQ_LABEL[d.frequency] || '—'}</td>
        <td class="text-right">${d.shares}</td>
        <td class="text-right positive"><strong>${formatCurrency(annual)}</strong></td>
        <td class="text-right ${yocCls}" title="Yield sobre precio de compra (${buyPrice ? formatCurrency(buyPrice) : '—'})">${yoc}</td>
        <td>
          <div class="action-buttons">
            <button class="btn-edit btn-icon" data-action="edit-div" aria-label="Editar dividendo ${escapeHtml(d.assetName)}">✎</button>
            <button class="btn-danger btn-icon" data-action="delete-div" aria-label="Eliminar dividendo ${escapeHtml(d.assetName)}">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  ric(() => { renderDividendChart(); renderDividendCalendar(); });
}

function renderDividendChart() {
  const ctx = document.getElementById('chart-dividends');
  if (!ctx) return;

  const { gridColor, textColor, fontFamily, accent, accentFill } = getChartDefaults();
  const FREQ_MULT   = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const monthData   = new Array(12).fill(0);

  APP.dividends.forEach(d => {
    const mult    = FREQ_MULT[d.frequency] || 1;
    const fx      = _divFxRate(d);
    const annual  = d.dividendPerShare * d.shares * mult * fx;
    const monthly = annual / 12;
    if (d.frequency === 'monthly') {
      for (let i = 0; i < 12; i++) monthData[i] += monthly;
    } else if (d.frequency === 'quarterly') {
      [2, 5, 8, 11].forEach(m => { monthData[m] += d.dividendPerShare * d.shares * fx; });
    } else if (d.frequency === 'semiannual') {
      [5, 11].forEach(m => { monthData[m] += d.dividendPerShare * d.shares * fx; });
    } else {
      monthData[11] += d.dividendPerShare * d.shares * fx;
    }
  });

  const barColor = accentFill.replace('0.09', '0.65');

  const divChart = Charts.get('dividends');
  if (divChart) {
    divChart.data.datasets[0].data = monthData;
    divChart.data.datasets[0].backgroundColor = barColor;
    divChart.options.scales.x.ticks.color = textColor;
    divChart.options.scales.y.grid.color = gridColor;
    divChart.options.scales.y.ticks.color = textColor;
    divChart.update('none');
    return;
  }

  Charts.destroy('dividends', 'chart-dividends');
  Charts.set('dividends', new Chart(ctx, {
    type: 'bar',
    data: { labels: monthLabels, datasets: [{ label: 'Dividendos (€)', data: monthData, backgroundColor: barColor, borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw) } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { family: fontFamily, size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: fontFamily, size: 11 }, callback: v => '€' + v.toFixed(0) } }
      }
    }
  }));
}

function renderDividendCalendar() {
  const el = document.getElementById('div-calendar');
  if (!el) return;

  if (APP.dividends.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Sin dividendos registrados.</div>';
    return;
  }

  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const endDate = new Date(today); endDate.setFullYear(endDate.getFullYear() + 1);
  const events  = [];
  const FREQ_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

  APP.dividends.forEach(d => {
    if (!d.nextPayDate) return;
    let date = new Date(d.nextPayDate);
    const months = FREQ_MONTHS[d.frequency] || 12;
    const amount = d.dividendPerShare * d.shares * _divFxRate(d);
    while (date <= endDate) {
      if (date >= today) events.push({ date: new Date(date), assetName: d.assetName, ticker: d.ticker, amount });
      date = new Date(date);
      date.setMonth(date.getMonth() + months);
    }
  });

  if (events.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Añade la "Fecha del próximo pago" en cada dividendo para ver el calendario.</div>';
    return;
  }

  events.sort((a, b) => a.date - b.date);
  const byMonth = {};
  events.forEach(e => {
    const key = e.date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(e);
  });

  el.innerHTML = Object.entries(byMonth).map(([month, evts]) => {
    const monthTotal = evts.reduce((s, e) => s + e.amount, 0);
    return `
    <div style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)">${month}</div>
        <div class="div-cal-month-total positive">${formatCurrency(monthTotal)}</div>
      </div>
      ${evts.map(e => `
        <div class="div-cal-item">
          <div class="div-cal-day">${e.date.getDate()}</div>
          <div class="div-cal-info">
            <strong>${escapeHtml(e.assetName)}</strong>
            <span class="ticker-chip" style="margin-left:6px">${escapeHtml(e.ticker)}</span>
          </div>
          <div class="div-cal-amount positive">${formatCurrency(e.amount)}</div>
        </div>
      `).join('')}
    </div>
  `;
  }).join('');
}

function openAddDividend(prefill = null) {
  const isEdit = !!prefill;
  const d = prefill || {};

  openModal(isEdit ? 'Editar dividendo' : 'Registrar dividendo', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nombre del activo</label>
        <input type="text" id="f-d-name" class="text-input" placeholder="Ej: LVMH" value="${escapeHtml(d.assetName || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Ticker <span id="f-d-ticker-badge" style="font-size:11px;color:var(--accent);display:none"></span></label>
        <input type="text" id="f-d-ticker" class="text-input" placeholder="Ej: MC" value="${escapeHtml(d.ticker || '')}"
          onblur="autoFillTicker('f-d-ticker','f-d-name',null,'f-d-ticker-badge'); autoFillDividendShares('f-d-ticker','f-d-shares')" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Dividendo por acción (€)</label>
        <input type="number" id="f-d-div" class="text-input" placeholder="0.00" value="${d.dividendPerShare || ''}" step="0.001" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Frecuencia de pago</label>
        <select id="f-d-freq" class="select-input">
          <option value="annual"     ${d.frequency === 'annual'     ? 'selected' : ''}>Anual</option>
          <option value="semiannual" ${d.frequency === 'semiannual' ? 'selected' : ''}>Semestral</option>
          <option value="quarterly"  ${d.frequency === 'quarterly'  ? 'selected' : ''}>Trimestral</option>
          <option value="monthly"    ${d.frequency === 'monthly'    ? 'selected' : ''}>Mensual</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Número de acciones / participaciones</label>
        <input type="number" id="f-d-shares" class="text-input" placeholder="0" value="${d.shares || ''}" step="any" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Retención en origen (%)</label>
        <input type="number" id="f-d-retention" class="text-input" placeholder="19" value="${d.retentionRate ?? 19}" step="0.1" min="0" max="100" />
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">España: 19% · EEUU: 15% · Sin W-8BEN: 30%</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Divisa del dividendo <span style="color:var(--text-muted);font-weight:400">(vacío = misma que el activo)</span></label>
        <input type="text" id="f-d-currency" class="text-input" placeholder="EUR, USD, GBP…" value="${escapeHtml(d.currency || '')}" style="text-transform:uppercase" maxlength="3" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha del próximo pago <span style="color:var(--text-muted);font-weight:400">(opcional)</span></label>
        <input type="date" id="f-d-nextpay" class="text-input" value="${d.nextPayDate || ''}" />
      </div>
    </div>
  `, () => {
    const assetName        = document.getElementById('f-d-name').value.trim();
    const ticker           = document.getElementById('f-d-ticker').value.trim().toUpperCase();
    const dividendPerShare = parseFloat(document.getElementById('f-d-div').value);
    const frequency        = document.getElementById('f-d-freq').value;
    const shares           = parseFloat(document.getElementById('f-d-shares').value);
    const retentionRate    = parseFloat(document.getElementById('f-d-retention').value) ?? 19;
    const nextPayDate      = document.getElementById('f-d-nextpay').value || '';
    const currency         = (document.getElementById('f-d-currency').value.trim().toUpperCase()) || undefined;

    if (!assetName)                                     return showToast('El nombre es obligatorio', 'error');
    if (isNaN(dividendPerShare) || dividendPerShare < 0) return showToast('Dividendo inválido', 'error');
    if (isNaN(shares) || shares <= 0)                  return showToast('Número de acciones inválido', 'error');

    if (isEdit) {
      const idx = APP.dividends.findIndex(x => x.id === prefill.id);
      if (idx >= 0) APP.dividends[idx] = { ...prefill, assetName, ticker, dividendPerShare, frequency, shares, retentionRate, nextPayDate, ...(currency ? { currency } : {}) };
      showToast('Dividendo actualizado ✓', 'success');
    } else {
      APP.dividends.push({ id: generateId(), assetName, ticker, dividendPerShare, frequency, shares, retentionRate, nextPayDate, ...(currency ? { currency } : {}) });
      showToast('Dividendo registrado ✓', 'success');
    }

    saveData();
    closeModal();
    renderDividends();
  });
}

function autoFillDividendShares(tickerId, sharesId) {
  const ticker   = document.getElementById(tickerId)?.value.trim().toUpperCase();
  const sharesEl = document.getElementById(sharesId);
  if (!ticker || !sharesEl || sharesEl.value) return;
  const asset = APP.portfolio.find(a => a.ticker.toUpperCase() === ticker);
  if (asset) {
    sharesEl.value = asset.quantity;
    sharesEl.dispatchEvent(new Event('input'));
  }
}

function editDividend(id) {
  const d = APP.dividends.find(x => x.id === id);
  if (d) openAddDividend(d);
}

function deleteDividend(id) {
  const div = APP.dividends.find(x => x.id === id);
  if (!div) return;
  APP.dividends = APP.dividends.filter(x => x.id !== id);
  renderDividends();
  softDelete(`Dividendo "${div.assetName || div.ticker || 'activo'}" eliminado`, () => {
    APP.dividends.push(div);
    saveData();
    renderDividends();
  });
}
