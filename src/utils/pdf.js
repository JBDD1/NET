/* ═══════════════════════════════════════════════════════════════
   FINOVA — pdf.js  v2
   Exportación PDF premium · reportes financieros de nivel fintech
   jsPDF + AutoTable
═══════════════════════════════════════════════════════════════ */

/* ── Paleta Finova Obsidian Brass ───────────────────────────── */
const _PDF = {
  dark:      [15, 13, 9],
  dark2:     [30, 26, 16],
  dark3:     [22, 19, 12],
  darkCover: [18, 15, 9],
  gold:      [200, 169, 110],
  goldDim:   [140, 116, 72],
  goldLight: [228, 200, 148],
  cream:     [245, 237, 214],
  muted:     [168, 144, 96],
  sectionBg: [246, 241, 226],
  kpiBg:     [252, 249, 243],
  kpiFg:     [130, 112, 74],
  kpiVal:    [28, 24, 14],
  rowEven:   [252, 249, 243],
  rowOdd:    [241, 235, 218],
  gridLine:  [220, 210, 186],
  barTrack:  [220, 210, 186],
  gain:      [44, 118, 78],
  gainSoft:  [195, 230, 210],
  loss:      [136, 50, 50],
  lossSoft:  [240, 208, 208],
  totalBg:   [30, 26, 16],
};

let _jspdfPromise = null;
function _loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve();
  if (_jspdfPromise) return _jspdfPromise;
  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = resolve; s.onerror = () => reject(new Error('Failed to load: ' + src));
      document.head.appendChild(s);
    });
  }
  _jspdfPromise = _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    .then(() => _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
    .catch(err => { _jspdfPromise = null; throw err; });
  return _jspdfPromise;
}

function _pdfGetDoc() {
  if (!window.jspdf?.jsPDF) {
    showToast('La librería PDF no está disponible — comprueba tu conexión', 'error');
    return null;
  }
  return new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
}

/* ── Barra de progreso horizontal ───────────────────────────── */
function _pdfBar(doc, x, y, w, pct, fillColor) {
  const p = Math.min(100, Math.max(0, pct || 0));
  doc.setFillColor(..._PDF.barTrack);
  doc.roundedRect(x, y, w, 3, 1, 1, 'F');
  if (p > 0) {
    doc.setFillColor(...(fillColor || _PDF.gold));
    doc.roundedRect(x, y, Math.max(3, w * p / 100), 3, 1, 1, 'F');
  }
  doc.setFillColor(..._PDF.kpiVal);
}

/* ── Caja de insights automáticos ───────────────────────────── */
function _pdfInsightBox(doc, items, y) {
  if (!items || !items.length) return y;
  const W    = doc.internal.pageSize.getWidth();
  const padX = 19.5;
  const maxW = W - padX - 16;
  const lineH = 5.2;

  // Pre-medir para calcular altura real del cuadro
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const wrapped = items.map(item => doc.splitTextToSize(item, maxW));
  const totalLines = wrapped.reduce((s, ls) => s + ls.length, 0);
  const gapH = (items.length - 1) * 1.5;
  const boxH = 12 + totalLines * lineH + gapH;

  doc.setFillColor(..._PDF.kpiBg);
  doc.roundedRect(12, y, W - 24, boxH, 2, 2, 'F');
  doc.setFillColor(..._PDF.gold);
  doc.roundedRect(12, y, 3.5, boxH, 1, 1, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(..._PDF.goldDim);
  doc.text('ANALISIS AUTOMATICO', padX, y + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(..._PDF.dark2);
  let curY = y + 10.5;
  wrapped.forEach((lines, i) => {
    lines.forEach((line, j) => {
      doc.text((j === 0 ? '- ' : '  ') + line, padX, curY);
      curY += lineH;
    });
    if (i < wrapped.length - 1) curY += 1.5;
  });

  doc.setTextColor(..._PDF.kpiVal);
  return y + boxH + 6;
}

/* ── Cabecera premium ────────────────────────────────────────── */
function _pdfHeader(doc, title, subtitle) {
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(..._PDF.dark);
  doc.rect(0, 0, W, 34, 'F');

  // Bloque oscuro derecho con corte diagonal
  doc.setFillColor(22, 19, 11);
  doc.rect(W - 55, 0, 55, 34, 'F');

  // Franja izquierda dorada
  doc.setFillColor(..._PDF.gold);
  doc.rect(0, 0, 4.5, 34, 'F');
  // Línea inferior dorada
  doc.rect(0, 33.7, W, 0.3, 'F');

  // Marca FINOVA
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(..._PDF.gold);
  doc.text('◈  FINOVA', 11, 10);

  // Título principal
  doc.setFontSize(17);
  doc.setTextColor(..._PDF.cream);
  doc.text(title, 11, 25);

  // Subtítulo + fecha (derecha)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(..._PDF.muted);
  doc.text(subtitle, W - 11, 10, { align: 'right' });

  const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.setFontSize(7.5);
  doc.setTextColor(..._PDF.goldDim);
  doc.text(dateStr, W - 11, 20, { align: 'right' });

  doc.setFontSize(6.5);
  doc.setTextColor(80, 70, 48);
  doc.text('Informe personal  ·  datos orientativos', W - 11, 28, { align: 'right' });

  doc.setTextColor(..._PDF.kpiVal);
}

/* ── Pie de página premium ───────────────────────────────────── */
function _pdfFooter(doc, reportId, startPage) {
  const W     = doc.internal.pageSize.getWidth();
  const H     = doc.internal.pageSize.getHeight();
  const pages = doc.internal.getNumberOfPages();
  const date  = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const sp    = startPage || 1;
  for (let i = sp; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(..._PDF.dark);
    doc.rect(0, H - 11, W, 11, 'F');
    doc.setFillColor(..._PDF.gold);
    doc.rect(0, H - 11, W, 0.35, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(..._PDF.muted);
    doc.text(
      `Generado el ${date} · Finova  ·  Documento meramente orientativo, no constituye asesoramiento financiero`,
      11, H - 5.5
    );
    if (reportId) {
      doc.setFontSize(6);
      doc.setTextColor(70, 60, 40);
      doc.text('Ref: ' + reportId, 11, H - 1.5);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(..._PDF.gold);
    doc.text(sp > 1 ? `${i - sp + 1} / ${pages - sp + 1}` : `${i} / ${pages}`, W - 11, H - 5.5, { align: 'right' });
  }
}

/* ── Cabecera de sección ─────────────────────────────────────── */
function _pdfSection(doc, text, y, rightLabel) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(..._PDF.sectionBg);
  doc.rect(12, y, W - 24, 9, 'F');
  doc.setFillColor(..._PDF.gold);
  doc.rect(12, y, 3.5, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(..._PDF.dark2);
  doc.text(text.toUpperCase(), 19.5, y + 6);
  if (rightLabel) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(..._PDF.kpiFg);
    doc.text(rightLabel, W - 14, y + 6, { align: 'right' });
  }
  return y + 14;
}

/* ── Tarjetas KPI ────────────────────────────────────────────── */
function _pdfKpis(doc, items, y) {
  const W    = doc.internal.pageSize.getWidth();
  const colW = (W - 24) / items.length;
  const cardH = 27;
  items.forEach(({ label, value, color, sub, pct }, i) => {
    const x = 12 + i * colW;
    const cw = colW - 3;
    // Card background
    doc.setFillColor(..._PDF.kpiBg);
    doc.roundedRect(x, y, cw, cardH, 2, 2, 'F');
    // Gold accent bar top
    doc.setFillColor(..._PDF.gold);
    doc.roundedRect(x, y, cw, 2.5, 1, 1, 'F');
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(..._PDF.kpiFg);
    doc.text(label, x + cw / 2, y + 9.5, { align: 'center' });
    // Value
    const hasExtra = sub || typeof pct === 'number';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hasExtra ? 10 : 11);
    doc.setTextColor(...(color || _PDF.kpiVal));
    doc.text(value, x + cw / 2, y + (hasExtra ? 16.5 : 18.5), { align: 'center' });
    // Sub label (trend / comparison)
    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(..._PDF.muted);
      doc.text(sub, x + cw / 2, y + 22, { align: 'center' });
    }
    // Mini progress bar
    if (typeof pct === 'number') {
      const barX = x + 6;
      const barW = cw - 12;
      const barY = y + cardH - 5.5;
      _pdfBar(doc, barX, barY, barW, pct, color || _PDF.gold);
    }
  });
  doc.setTextColor(..._PDF.kpiVal);
  return y + cardH + 5;
}

const HEAD_STYLE = {
  fillColor:   _PDF.dark2,
  textColor:   _PDF.cream,
  fontStyle:   'bold',
  fontSize:    8.5,
  cellPadding: 4,
};
const ROW_ALT   = { fillColor: _PDF.rowOdd };
const TABLE_OPT = {
  styles: {
    fontSize:    8,
    cellPadding: 3.5,
    textColor:   _PDF.dark2,
    fillColor:   _PDF.rowEven,
    lineColor:   _PDF.gridLine,
    lineWidth:   0.15,
  },
  headStyles:         HEAD_STYLE,
  alternateRowStyles: ROW_ALT,
  margin:             { left: 12, right: 12 },
};

/* ── Resumen mensual ─────────────────────────────────────────── */
async function exportMonthlyPDF() {
  try { await _loadJsPDF(); } catch { showToast('No se pudo cargar la librería PDF — comprueba tu conexión', 'error'); return; }
  const doc = _pdfGetDoc();
  if (!doc) return;

  const now      = new Date();
  const monthStr = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const m        = getCurrentMonth();
  const prevM    = typeof getPreviousMonth === 'function' ? getPreviousMonth(m) : null;

  _pdfHeader(doc, 'Resumen Financiero Mensual',
    (monthStr.charAt(0).toUpperCase() + monthStr.slice(1)));

  let y = 42;

  // ── Patrimonio neto ──────────────────────────────────────────
  const cash     = calcCashTotal();
  const inv      = calcPortfolioValue();
  const alt      = calcAlternativesTotal();
  const prop     = calcPropertiesTotal();
  const liab     = calcLiabilitiesTotal();
  const netWorth = cash + inv + alt + prop - liab;
  const prevNW   = prevM ? (APP.networthHistory?.find(h => h.date === prevM)?.value || 0) : 0;
  const nwDelta  = prevNW ? netWorth - prevNW : 0;

  // ── Movimientos del mes ──────────────────────────────────────
  const txMonth = APP.transactions.filter(t => (t.date || m).startsWith(m));
  const inc = txMonth.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp = txMonth.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const bal = inc - exp;
  const saveRate = inc > 0 ? (bal / inc * 100) : 0;

  // ── Desglose categorías ──────────────────────────────────────
  const byCat = {};
  txMonth.filter(t => t.type === 'expense').forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

  // ── Insights automáticos ─────────────────────────────────────
  const insights = [];
  if (txMonth.length > 0) {
    const balSign  = bal >= 0 ? '+' : '';
    const balLabel = bal >= 0 ? 'balance positivo' : 'balance negativo';
    insights.push(`${monthStr.charAt(0).toUpperCase() + monthStr.slice(1)}: ingresos ${formatCurrency(inc)}, gastos ${formatCurrency(exp)}, ${balLabel} de ${balSign}${formatCurrency(bal)}`);
    const rateTag  = saveRate >= 20 ? 'excelente' : saveRate >= 10 ? 'correcta' : 'por debajo del objetivo recomendado (20%)';
    insights.push(`Tasa de ahorro: ${saveRate.toFixed(1)}% — ${rateTag}`);
  }
  if (nwDelta !== 0) {
    const sign = nwDelta >= 0 ? '+' : '';
    insights.push(`Patrimonio ${nwDelta >= 0 ? 'subio' : 'bajo'} ${sign}${formatCurrency(Math.abs(nwDelta))} respecto al mes anterior`);
  }
  if (topCat) {
    insights.push(`Mayor gasto: ${topCat[0]} con ${formatCurrency(topCat[1])} (${exp > 0 ? (topCat[1] / exp * 100).toFixed(0) : 0}% del total de gastos)`);
  }
  if (insights.length) y = _pdfInsightBox(doc, insights, y);

  // ── KPIs Patrimonio ──────────────────────────────────────────
  y = _pdfSection(doc, 'Patrimonio neto', y);
  const kpiItems = [
    {
      label: 'Patrimonio Neto',
      value: formatCurrency(netWorth),
      color: nwDelta > 0 ? _PDF.gain : undefined,
      sub:   nwDelta ? (nwDelta >= 0 ? '+ ' : '- ') + formatCurrency(Math.abs(nwDelta)) + ' vs mes ant.' : null,
    },
    { label: 'Efectivo',    value: formatCurrency(cash), pct: netWorth > 0 ? cash / netWorth * 100 : 0 },
    { label: 'Inversiones', value: formatCurrency(inv),  pct: netWorth > 0 ? inv  / netWorth * 100 : 0 },
  ];
  if (prop > 0) kpiItems.push({ label: 'Inmuebles',   value: formatCurrency(prop), pct: netWorth > 0 ? prop / netWorth * 100 : 0 });
  if (alt  > 0) kpiItems.push({ label: 'Alternativos', value: formatCurrency(alt), pct: netWorth > 0 ? alt  / netWorth * 100 : 0 });
  y = _pdfKpis(doc, kpiItems, y);

  // ── KPIs Movimientos ─────────────────────────────────────────
  y = _pdfSection(doc, `Movimientos — ${monthStr}`, y);
  y = _pdfKpis(doc, [
    { label: 'Ingresos',       value: formatCurrency(inc), color: _PDF.gain },
    { label: 'Gastos',         value: formatCurrency(exp), color: _PDF.loss },
    { label: 'Balance',        value: (bal >= 0 ? '+' : '') + formatCurrency(bal), color: bal >= 0 ? _PDF.gain : _PDF.loss },
    { label: 'Tasa de ahorro', value: saveRate.toFixed(1) + '%',
      color: saveRate >= 20 ? _PDF.gain : saveRate >= 0 ? _PDF.muted : _PDF.loss,
      pct: Math.max(0, Math.min(100, saveRate)) },
  ], y);

  // ── Detalle transacciones con balance acumulado ───────────────
  if (txMonth.length > 0) {
    if (y > 215) { doc.addPage(); y = 20; }
    y = _pdfSection(doc, 'Detalle de transacciones', y, `${txMonth.length} movimientos`);
    let running = 0;
    const txRows = [...txMonth]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(t => {
        running += t.type === 'income' ? t.amount : -t.amount;
        return [
          formatDate(t.date),
          t.description,
          t.category,
          {
            content: (t.type === 'income' ? '+' : '−') + formatCurrency(t.amount),
            styles:  { textColor: t.type === 'income' ? _PDF.gain : _PDF.loss, fontStyle: 'bold', halign: 'right' },
          },
          {
            content: formatCurrency(running),
            styles:  { textColor: running >= 0 ? _PDF.gain : _PDF.loss, halign: 'right', fontSize: 7.5 },
          },
        ];
      });
    doc.autoTable({
      ...TABLE_OPT,
      startY: y,
      head:   [['Fecha', 'Descripción', 'Categoría', 'Importe', 'Saldo acum.']],
      body:   txRows,
      columnStyles: {
        0: { cellWidth: 22 },
        2: { cellWidth: 32 },
        3: { cellWidth: 30, halign: 'right' },
        4: { cellWidth: 28, halign: 'right' },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── Desglose categorías con barras visuales ───────────────────
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (catEntries.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }
    y = _pdfSection(doc, 'Desglose por categoría', y, `${catEntries.length} categorías`);
    const maxAmt  = catEntries[0][1];
    const catBody = catEntries.map(([cat, amt]) => [
      cat,
      { content: formatCurrency(amt), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: exp > 0 ? (amt / exp * 100).toFixed(1) + '%' : '—', styles: { halign: 'right' } },
      { content: '', styles: { cellPadding: { top: 3, bottom: 3, left: 3, right: 3 } } },
    ]);
    doc.autoTable({
      ...TABLE_OPT,
      startY: y,
      head:   [['Categoría', 'Importe', '% Gasto', '']],
      body:   catBody,
      columnStyles: {
        1: { halign: 'right', cellWidth: 36 },
        2: { halign: 'right', cellWidth: 24 },
        3: { cellWidth: 42 },
      },
      foot: [['Total gastos',
        { content: formatCurrency(exp), styles: { halign: 'right', fontStyle: 'bold' } },
        { content: '100%', styles: { halign: 'right' } },
        '',
      ]],
      footStyles: { fillColor: _PDF.dark2, textColor: _PDF.cream, fontStyle: 'bold', fontSize: 8 },
      didDrawCell: (data) => {
        if (data.column.index === 3 && data.section === 'body') {
          const amt = catEntries[data.row.index]?.[1] ?? 0;
          if (!amt || !maxAmt) return;
          const pct = (amt / maxAmt) * 100;
          const bx  = data.cell.x + 3;
          const by  = data.cell.y + data.cell.height / 2 - 1.5;
          const bw  = data.cell.width - 6;
          _pdfBar(doc, bx, by, bw, pct, _PDF.gold);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── Cartera top 8 con barras de concentración ─────────────────
  if (APP.portfolio.length > 0) {
    if (y > 215) { doc.addPage(); y = 20; }
    const tv = calcPortfolioValue();
    const portItems = [...APP.portfolio]
      .sort((a, b) => assetValue(b) - assetValue(a))
      .slice(0, 8);
    y = _pdfSection(doc, `Cartera de inversión — top ${Math.min(8, portItems.length)}`, y,
      `${APP.portfolio.length} activos · ${formatCurrency(tv)}`);
    const portBody = portItems.map(a => {
      const val  = assetValue(a);
      const gain = (a.currentPrice - a.buyPrice) * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1);
      const cPct = tv > 0 ? val / tv * 100 : 0;
      return [
        a.ticker || '—',
        a.name,
        { content: formatCurrency(val), styles: { halign: 'right' } },
        {
          content: (gain >= 0 ? '+' : '') + formatCurrency(gain),
          styles: { textColor: gain >= 0 ? _PDF.gain : _PDF.loss, fontStyle: 'bold', halign: 'right' },
        },
        { content: cPct.toFixed(1) + '%', styles: { halign: 'right', fontStyle: 'bold' } },
        { content: '', styles: { cellPadding: { top: 2, bottom: 2, left: 3, right: 3 } } },
        cPct, // raw value for bar callback
      ];
    });
    doc.autoTable({
      ...TABLE_OPT,
      startY: y,
      head:   [['Ticker', 'Nombre', 'Valor', 'G / P', '% Cartera', '']],
      body:   portBody.map(r => r.slice(0, 6)),
      columnStyles: {
        0: { cellWidth: 18 },
        2: { halign: 'right', cellWidth: 30 },
        3: { halign: 'right', cellWidth: 30 },
        4: { halign: 'right', cellWidth: 22 },
        5: { cellWidth: 34 },
      },
      didDrawCell: (data) => {
        if (data.column.index === 5 && data.section === 'body') {
          const pct = portBody[data.row.index]?.[6] ?? 0;
          if (!pct) return;
          const bx = data.cell.x + 3;
          const by = data.cell.y + data.cell.height / 2 - 1.5;
          const bw = data.cell.width - 6;
          _pdfBar(doc, bx, by, bw, pct, _PDF.goldDim);
        }
      },
    });
  }

  const reportId = 'MR-' + m.replace('-', '') + '-' + Date.now().toString(36).toUpperCase().slice(-5);
  _pdfFooter(doc, reportId);
  const filename = `Finova_Resumen_${m}.pdf`;
  doc.save(filename);
  showToast(`PDF generado: ${filename} ✓`, 'success');
}

/* ── Desglose fiscal ─────────────────────────────────────────── */
async function exportFiscalPDF() {
  try { await _loadJsPDF(); } catch { showToast('No se pudo cargar la librería PDF — comprueba tu conexión', 'error'); return; }
  const doc = _pdfGetDoc();
  if (!doc) return;

  const year  = getFiscalYear();
  const sales = (APP.sales || []).filter(s => s.sellDate?.startsWith(String(year)));

  _pdfHeader(doc, `Desglose Fiscal IRPF — ${year}`, 'Base del ahorro · art. 49 LIRPF');

  let y = 42;
  const W = doc.internal.pageSize.getWidth();

  // Cálculos fiscales
  const gains  = sales.reduce((s, v) => { const r = (v.sellPrice - v.buyPrice) * v.quantity; return r > 0 ? s + r : s; }, 0);
  const losses = sales.reduce((s, v) => { const r = (v.sellPrice - v.buyPrice) * v.quantity; return r < 0 ? s + Math.abs(r) : s; }, 0);
  const FREQ   = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const annualDivs = APP.dividends.reduce((s, d) => s + d.dividendPerShare * d.shares * (FREQ[d.frequency] || 1), 0);
  const retention  = APP.dividends.reduce((s, d) => {
    const gross = d.dividendPerShare * d.shares * (FREQ[d.frequency] || 1);
    return s + gross * ((d.retentionRate ?? 19) / 100);
  }, 0);
  const netCapGains = gains - losses;
  const baseAhorro  = Math.max(netCapGains, 0) + Math.max(annualDivs, 0);
  const cuota       = calcIRPF(baseAhorro);

  // Insights fiscales
  const fInsights = [];
  fInsights.push(`Base imponible del ahorro ${year}: ${formatCurrency(baseAhorro)} · Cuota estimada: ${formatCurrency(cuota)}`);
  if (sales.length > 0) {
    fInsights.push(`${sales.length} operación${sales.length > 1 ? 'es' : ''} · Plusvalías: ${formatCurrency(gains)} · Pérdidas: ${formatCurrency(losses)} · Neto: ${formatCurrency(gains - losses)}`);
  } else {
    fInsights.push('Sin ventas registradas para el ejercicio ' + year);
  }
  if (annualDivs > 0) {
    fInsights.push(`Dividendos estimados: ${formatCurrency(annualDivs)} brutos · ${formatCurrency(retention)} retención (${formatCurrency(annualDivs - retention)} neto)`);
  }
  y = _pdfInsightBox(doc, fInsights, y);

  // KPIs fiscales
  y = _pdfSection(doc, 'Resumen fiscal', y);
  y = _pdfKpis(doc, [
    { label: 'Plusvalías',     value: formatCurrency(gains),      color: _PDF.gain },
    { label: 'Pérdidas',       value: formatCurrency(losses),     color: _PDF.loss },
    { label: 'Base imponible', value: formatCurrency(baseAhorro) },
    { label: 'Cuota estimada', value: formatCurrency(cuota),      color: _PDF.loss },
  ], y);

  // Caja destacada — cuota a ingresar
  if (cuota > 0) {
    doc.setFillColor(..._PDF.lossSoft);
    doc.roundedRect(12, y, W - 24, 16, 2, 2, 'F');
    doc.setFillColor(..._PDF.loss);
    doc.roundedRect(12, y, 3.5, 16, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(..._PDF.loss);
    doc.text('CUOTA ESTIMADA A INGRESAR (IRPF — base del ahorro)', 19.5, y + 6);
    doc.setFontSize(16);
    doc.text(formatCurrency(cuota), W - 14, y + 12, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(..._PDF.kpiFg);
    doc.text('Estimación orientativa · consulte su asesor fiscal antes de presentar la declaración', 19.5, y + 13);
    y += 22;
  }

  // Ventas realizadas
  y = _pdfSection(doc, 'Ventas realizadas', y, `${sales.length} operación${sales.length !== 1 ? 'es' : ''} en ${year}`);
  if (sales.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(..._PDF.muted);
    doc.text('Sin ventas registradas para este año fiscal.', 12, y + 2);
    y += 12;
  } else {
    const saleRows = sales.map(v => {
      const result = (v.sellPrice - v.buyPrice) * v.quantity;
      const days   = v.buyDate ? Math.floor((new Date(v.sellDate) - new Date(v.buyDate)) / 86400000) : null;
      const tipo   = v.isCrypto ? 'Crypto' : (days !== null && days < 365 ? 'Corto' : 'Largo');
      return [
        v.ticker || v.name,
        v.buyDate ? formatDate(v.buyDate) : '—',
        formatDate(v.sellDate),
        days !== null ? days + 'd' : '—',
        tipo,
        {
          content: (result >= 0 ? '+' : '') + formatCurrency(result),
          styles:  { textColor: result >= 0 ? _PDF.gain : _PDF.loss, fontStyle: 'bold', halign: 'right' },
        },
      ];
    });
    doc.autoTable({
      ...TABLE_OPT,
      startY: y,
      head:   [['Activo', 'F. Compra', 'F. Venta', 'Días', 'Tipo', 'Resultado']],
      body:   saleRows,
      columnStyles: {
        1: { cellWidth: 24 }, 2: { cellWidth: 24 },
        3: { cellWidth: 14, halign: 'right' },
        4: { cellWidth: 20 },
        5: { halign: 'right', cellWidth: 32 },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Tramos IRPF con barras visuales
  if (y > 220) { doc.addPage(); y = 20; }
  y = _pdfSection(doc, 'Tramos IRPF — base del ahorro 2024', y);
  const tramoLabels = ['Hasta 6.000€', '6.001€ – 50.000€', '50.001€ – 200.000€', 'Más de 200.000€'];
  let prev = 0;
  const tramoData = IRPF_TRAMOS.map((tramo, i) => {
    const chunk    = Math.min(Math.max(baseAhorro, 0), tramo.hasta) - prev;
    const active   = baseAhorro > prev && chunk > 0;
    const taxChunk = active ? chunk * tramo.tipo / 100 : 0;
    prev = tramo.hasta;
    return { chunk, active, taxChunk, tipo: tramo.tipo,
      row: [tramoLabels[i], tramo.tipo + '%',
        active ? formatCurrency(chunk)    : '—',
        active ? formatCurrency(taxChunk) : '—',
        ''], // bar column
    };
  });
  const maxChunk = Math.max(...tramoData.map(d => d.chunk), 1);
  doc.autoTable({
    ...TABLE_OPT,
    startY: y,
    head:   [['Tramo', 'Tipo', 'Base en tramo', 'Cuota en tramo', '']],
    body:   tramoData.map(d => d.row),
    foot:   [['TOTAL', '', formatCurrency(baseAhorro), formatCurrency(cuota), '']],
    footStyles: { fillColor: _PDF.dark2, textColor: _PDF.cream, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { cellWidth: 38 } },
    didParseCell: (data) => {
      if (data.section === 'body' && tramoData[data.row.index]?.active) {
        data.cell.styles.fillColor = [232, 224, 204];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = _PDF.dark2;
      }
    },
    didDrawCell: (data) => {
      if (data.column.index === 4 && data.section === 'body') {
        const td = tramoData[data.row.index];
        if (!td?.active || td.chunk <= 0) return;
        const pct = (td.chunk / maxChunk) * 100;
        const bx  = data.cell.x + 3;
        const by  = data.cell.y + data.cell.height / 2 - 1.5;
        const bw  = data.cell.width - 6;
        _pdfBar(doc, bx, by, bw, pct, _PDF.goldDim);
      }
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // Dividendos
  if (APP.dividends.length > 0) {
    if (y > 235) { doc.addPage(); y = 20; }
    y = _pdfSection(doc, 'Dividendos estimados del año', y);
    y = _pdfKpis(doc, [
      { label: 'Brutos',    value: formatCurrency(annualDivs) },
      { label: 'Retención', value: formatCurrency(retention),              color: _PDF.loss },
      { label: 'Neto',      value: formatCurrency(annualDivs - retention), color: _PDF.gain },
    ], y);
  }

  // Aviso legal
  if (y > 244) { doc.addPage(); y = 20; }
  doc.setFillColor(..._PDF.sectionBg);
  doc.roundedRect(12, y, W - 24, 22, 2, 2, 'F');
  doc.setFillColor(..._PDF.goldDim);
  doc.rect(12, y, 3.5, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(..._PDF.dark2);
  doc.text('AVISO LEGAL', 19.5, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(..._PDF.kpiFg);
  const txt = 'Este documento es meramente orientativo y no constituye asesoramiento fiscal ni financiero. Los cálculos están basados en los datos introducidos manualmente en Finova y pueden ser incompletos o inexactos. Consulte siempre con un asesor fiscal o gestor tributario antes de presentar su declaración de la renta. Finova no se responsabiliza de decisiones tomadas basándose en este informe.';
  const lines = doc.splitTextToSize(txt, W - 36);
  doc.text(lines, 19.5, y + 12);

  const reportId = 'FI-' + year + '-' + Date.now().toString(36).toUpperCase().slice(-5);
  _pdfFooter(doc, reportId);
  const filename = `Finova_Fiscal_${year}.pdf`;
  doc.save(filename);
  showToast(`PDF generado: ${filename} ✓`, 'success');
}

/* ── Informe ejecutivo mensual (CFO briefing) ────────────────── */
async function exportMonthlyBriefingPDF() {
  try { await _loadJsPDF(); } catch { showToast('No se pudo cargar la librería PDF — comprueba tu conexión', 'error'); return; }
  const doc = _pdfGetDoc();
  if (!doc) return;

  const prevM      = getPreviousMonth(getCurrentMonth());
  const prevDate   = new Date(prevM + '-01');
  const monthLabel = prevDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const monthTitle = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // ══════════════════════════════════════════════════════════════
  // PORTADA — página 1, diseño premium oscuro
  // ══════════════════════════════════════════════════════════════
  // Fondo
  doc.setFillColor(..._PDF.darkCover);
  doc.rect(0, 0, W, H, 'F');

  // Franja lateral izquierda dorada
  doc.setFillColor(..._PDF.gold);
  doc.rect(0, 0, 6, H, 'F');

  // Banda inferior de color
  doc.setFillColor(26, 22, 13);
  doc.rect(6, H * 0.44, W - 6, H * 0.56, 'F');
  doc.setFillColor(..._PDF.gold);
  doc.rect(6, H * 0.44 - 0.5, W - 6, 0.5, 'F');

  // Marca FINOVA
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(..._PDF.gold);
  doc.text('◈  FINOVA', 18, 24);

  // Línea decorativa bajo la marca
  doc.setDrawColor(..._PDF.goldDim);
  doc.setLineWidth(0.3);
  doc.line(18, 27, 75, 27);

  // Tipo de informe
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(..._PDF.muted);
  doc.text('INFORME EJECUTIVO MENSUAL', 18, 36);

  // Mes — tipografía grande
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(..._PDF.cream);
  doc.text(monthTitle.split(' ')[0], 18, 58); // Mes
  doc.setFontSize(20);
  doc.setTextColor(..._PDF.gold);
  doc.text(monthTitle.split(' ').slice(1).join(' '), 18, 73); // Año

  // Fecha de generación
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(..._PDF.muted);
  const genDate = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
  doc.text('Generado el ' + genDate, 18, 85);

  // ── Métricas clave en portada ─────────────────────────────────
  const nw     = calcNetWorth();
  const prevNW = APP.networthHistory?.find(h => h.date === prevM)?.value || 0;
  const nwD    = nw - prevNW;
  const txs    = APP.transactions.filter(t => (t.date || '').startsWith(prevM));
  const inc    = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp    = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const bal    = inc - exp;
  const rate   = inc > 0 ? (bal / inc * 100) : 0;
  const invVal = calcPortfolioValue();

  const coverKPIs = [
    { label: 'PATRIMONIO NETO', value: formatCurrency(nw),       delta: nwD ? (nwD >= 0 ? '+ ' : '- ') + formatCurrency(Math.abs(nwD)) : null, pos: nwD >= 0 },
    { label: 'BALANCE DEL MES', value: formatCurrency(bal),      delta: null, pos: bal >= 0 },
    { label: 'INVERSIONES',      value: formatCurrency(invVal),  delta: null, pos: true },
    { label: 'TASA DE AHORRO',   value: rate.toFixed(1) + '%',   delta: rate >= 20 ? 'Objetivo: 20% (OK)' : 'Objetivo: 20%', pos: rate >= 20 },
  ];

  const startY = H * 0.46;
  const kpiW   = (W - 12) / 2 - 2;
  const kpiH   = 26;
  coverKPIs.forEach(({ label, value, delta, pos }, i) => {
    const cx = 9 + (i % 2) * (kpiW + 4);
    const cy = startY + Math.floor(i / 2) * (kpiH + 5);
    doc.setFillColor(38, 33, 20);
    doc.roundedRect(cx, cy, kpiW, kpiH, 2, 2, 'F');
    doc.setFillColor(...(pos ? _PDF.gain : _PDF.loss));
    doc.roundedRect(cx, cy, 3, kpiH, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(..._PDF.muted);
    doc.text(label, cx + 8, cy + 6.5);
    doc.setFontSize(12);
    doc.setTextColor(..._PDF.cream);
    doc.text(value, cx + 8, cy + 16);
    if (delta) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...(pos ? _PDF.gain : _PDF.muted));
      doc.text(delta, cx + 8, cy + 23);
    }
  });

  // Footer portada
  doc.setFillColor(12, 10, 6);
  doc.rect(6, H - 12, W - 6, 12, 'F');
  doc.setFillColor(..._PDF.gold);
  doc.rect(6, H - 12, W - 6, 0.3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(..._PDF.muted);
  doc.text('Finova · Informe personal · Datos orientativos — no constituye asesoramiento financiero ni fiscal',
    W / 2, H - 5, { align: 'center' });
  doc.setFontSize(6);
  doc.setTextColor(..._PDF.goldDim);
  doc.text('© ' + new Date().getFullYear() + ' Finova', W / 2, H - 1.5, { align: 'center' });

  // ══════════════════════════════════════════════════════════════
  // PÁGINA 2: Análisis de patrimonio y flujo de caja
  // ══════════════════════════════════════════════════════════════
  doc.addPage();
  _pdfHeader(doc, `Informe Ejecutivo — ${monthTitle}`, 'Patrimonio · Flujo de caja · Inversiones');
  let y = 42;

  const prevPrevM  = getPreviousMonth(prevM);
  const prevPrevNW = APP.networthHistory?.find(h => h.date === prevPrevM)?.value || 0;
  const prevTxs    = APP.transactions.filter(t => (t.date || '').startsWith(prevPrevM));
  const prevExp    = prevTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const cashTot    = calcCashTotal();

  y = _pdfSection(doc, 'Patrimonio neto', y);
  y = _pdfKpis(doc, [
    {
      label: 'Patrimonio actual',
      value: formatCurrency(nw),
      color: nwD > 0 ? _PDF.gain : undefined,
      sub:   nwD ? (nwD >= 0 ? '+ ' : '- ') + formatCurrency(Math.abs(nwD)) + ' vs mes ant.' : null,
    },
    { label: 'Efectivo',           value: formatCurrency(cashTot), pct: nw > 0 ? cashTot / nw * 100 : 0 },
    { label: 'Inversiones',        value: formatCurrency(invVal),  pct: nw > 0 ? invVal  / nw * 100 : 0 },
    { label: 'Patrimonio anterior', value: formatCurrency(prevNW), sub: prevPrevNW ? (nw > prevPrevNW ? '+ ' : '- ') + 'vs 2 meses ant.' : null },
  ], y);

  y = _pdfSection(doc, `Flujo de caja — ${monthTitle}`, y);
  y = _pdfKpis(doc, [
    { label: 'Ingresos',       value: formatCurrency(inc), color: _PDF.gain },
    {
      label: 'Gastos',
      value: formatCurrency(exp),
      color: _PDF.loss,
      sub:   prevExp ? (exp <= prevExp ? '- ' : '+ ') + formatCurrency(Math.abs(exp - prevExp)) + ' vs mes ant.' : null,
    },
    { label: 'Balance',        value: (bal >= 0 ? '+' : '') + formatCurrency(bal), color: bal >= 0 ? _PDF.gain : _PDF.loss },
    { label: 'Tasa de ahorro', value: rate.toFixed(1) + '%',
      color: rate >= 20 ? _PDF.gain : rate >= 0 ? _PDF.muted : _PDF.loss,
      pct:   Math.max(0, Math.min(100, rate)) },
  ], y);

  // Mejores/peores posiciones
  const gainers = APP.portfolio.map(a => {
    const g = (a.currentPrice - a.buyPrice) * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1);
    return { ...a, gain: g };
  }).filter(a => a.gain !== 0).sort((a, b) => b.gain - a.gain);

  if (gainers.length > 0) {
    if (y > 208) { doc.addPage(); _pdfHeader(doc, `Informe Ejecutivo — ${monthTitle}`, 'Análisis de inversiones'); y = 42; }
    const top3 = gainers.slice(0, 3);
    const bot3 = gainers.slice(-Math.min(3, gainers.length)).reverse();
    const shown = [...top3, ...bot3];
    y = _pdfSection(doc, 'Mejores y peores posiciones', y, `${shown.length} de ${gainers.length} posiciones con P&L`);
    const rows = shown.map(a => [
      a.ticker || a.name,
      a.name,
      { content: formatCurrency(assetValue(a)), styles: { halign: 'right' } },
      {
        content: (a.gain >= 0 ? '+' : '') + formatCurrency(a.gain),
        styles:  { textColor: a.gain >= 0 ? _PDF.gain : _PDF.loss, fontStyle: 'bold', halign: 'right' },
      },
      {
        content: a.gain >= 0 ? '+' : '-',
        styles:  { textColor: a.gain >= 0 ? _PDF.gain : _PDF.loss, fontStyle: 'bold', halign: 'center' },
      },
    ]);
    doc.autoTable({
      ...TABLE_OPT, startY: y,
      head: [['Ticker', 'Nombre', 'Valor', 'G/P acum.', '']],
      body: rows,
      columnStyles: {
        0: { cellWidth: 20 },
        2: { halign: 'right', cellWidth: 32 },
        3: { halign: 'right', cellWidth: 32 },
        4: { halign: 'center', cellWidth: 14 },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ══════════════════════════════════════════════════════════════
  // PÁGINA 3: Gastos · FIRE · Wealth Score
  // ══════════════════════════════════════════════════════════════
  doc.addPage();
  _pdfHeader(doc, `Informe Ejecutivo — ${monthTitle}`, 'Análisis de gastos · FIRE · Wealth Score');
  y = 42;

  // Gastos por categoría vs mes anterior
  const byCat     = {};
  const byCatPrev = {};
  txs.filter(t => t.type === 'expense').forEach(t => { byCat[t.category]     = (byCat[t.category]     || 0) + t.amount; });
  prevTxs.filter(t => t.type === 'expense').forEach(t => { byCatPrev[t.category] = (byCatPrev[t.category] || 0) + t.amount; });
  const allCats = [...new Set([...Object.keys(byCat), ...Object.keys(byCatPrev)])].sort();

  if (allCats.length > 0) {
    y = _pdfSection(doc, 'Gastos por categoría vs mes anterior', y, `${allCats.length} categorías`);
    const catRows = allCats.map(cat => {
      const cur  = byCat[cat]     || 0;
      const prev = byCatPrev[cat] || 0;
      const diff = cur - prev;
      return [
        cat,
        { content: formatCurrency(cur),  styles: { halign: 'right', fontStyle: 'bold' } },
        { content: formatCurrency(prev), styles: { halign: 'right', textColor: _PDF.muted } },
        {
          content: (diff > 0 ? '+' : '') + formatCurrency(diff),
          styles:  { halign: 'right', textColor: diff <= 0 ? _PDF.gain : _PDF.loss, fontStyle: 'bold' },
        },
        {
          content: diff > 0 ? '+' : diff < 0 ? '-' : '=',
          styles:  { halign: 'center', textColor: diff <= 0 ? _PDF.gain : _PDF.loss, fontStyle: 'bold' },
        },
      ];
    });
    doc.autoTable({
      ...TABLE_OPT, startY: y,
      head: [['Categoría', 'Este mes', 'Mes ant.', 'Δ', '']],
      body: catRows,
      foot: [['Total',
        formatCurrency(exp),
        formatCurrency(prevExp),
        {
          content: (exp - prevExp > 0 ? '+' : '') + formatCurrency(exp - prevExp),
          styles: { textColor: exp <= prevExp ? _PDF.gain : _PDF.loss, fontStyle: 'bold', halign: 'right' },
        },
        '',
      ]],
      footStyles: { fillColor: _PDF.dark2, textColor: _PDF.cream, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        1: { halign: 'right', cellWidth: 28 },
        2: { halign: 'right', cellWidth: 28 },
        3: { halign: 'right', cellWidth: 28 },
        4: { halign: 'center', cellWidth: 12 },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Proyección FIRE con barra grande
  if (y > 218) { doc.addPage(); y = 20; }
  const annualExp  = exp * 12;
  const fireNumber = annualExp * 25;
  const firePct    = fireNumber > 0 ? Math.min(100, nw / fireNumber * 100) : 0;
  const annualDiv  = (APP.dividends || []).reduce((s, d) =>
    s + d.dividendPerShare * d.shares * ({ annual:1, semiannual:2, quarterly:4, monthly:12 }[d.frequency] || 1), 0);
  const divCovPct  = annualExp > 0 ? Math.min(100, annualDiv / annualExp * 100) : 0;

  y = _pdfSection(doc, 'Proyección FIRE (regla del 25×)', y, `SWR 4% · cobertura dividendos ${divCovPct.toFixed(0)}%`);
  y = _pdfKpis(doc, [
    { label: 'Número FIRE (×25)', value: formatCurrency(fireNumber) },
    { label: 'Progreso FIRE',     value: firePct.toFixed(1) + '%',
      color: firePct >= 100 ? _PDF.gain : _PDF.kpiVal, pct: firePct },
    { label: 'Dividendos anuales', value: formatCurrency(annualDiv), color: _PDF.gain },
    { label: 'Cobertura gastos',   value: divCovPct.toFixed(1) + '%',
      color: divCovPct >= 100 ? _PDF.gain : _PDF.kpiVal, pct: divCovPct },
  ], y);

  // Barra de progreso FIRE grande
  if (fireNumber > 0) {
    const fw  = W - 24;
    const barY = y;
    // Fondo caja
    doc.setFillColor(..._PDF.sectionBg);
    doc.roundedRect(12, barY, fw, 14, 2, 2, 'F');
    // Track
    const tx = 16, ty = barY + 7, tw = fw - 8;
    doc.setFillColor(..._PDF.barTrack);
    doc.roundedRect(tx, ty, tw, 5, 2, 2, 'F');
    // Fill
    const fillW = Math.max(6, tw * firePct / 100);
    const fillCol = firePct >= 75 ? _PDF.gain : firePct >= 40 ? _PDF.gold : _PDF.muted;
    doc.setFillColor(...fillCol);
    doc.roundedRect(tx, ty, fillW, 5, 2, 2, 'F');
    // Label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(..._PDF.dark2);
    doc.text(
      `${firePct.toFixed(1)}%  ·  ${formatCurrency(nw)} de ${formatCurrency(fireNumber)}`,
      14, barY + 5.5
    );
    y = barY + 20;
  }

  // Wealth Score con barras por componente
  if (typeof calcWealthScore === 'function') {
    const ws = calcWealthScore();
    if (y > 218) { doc.addPage(); y = 20; }
    y = _pdfSection(doc, `Wealth Score — ${ws.score}/100 · ${ws.grade}`, y);
    const wsRows = ws.comps.map(c => {
      const ratio = c.pts / c.max;
      return [
        c.label,
        c.detail,
        {
          content: `${Math.round(c.pts)}/${c.max}`,
          styles: { halign: 'right', fontStyle: 'bold',
            textColor: ratio >= 0.75 ? _PDF.gain : ratio >= 0.4 ? _PDF.muted : _PDF.loss },
        },
        { content: '', styles: { cellPadding: { top: 2, bottom: 2, left: 3, right: 3 } } },
        ratio * 100,
      ];
    });
    doc.autoTable({
      ...TABLE_OPT, startY: y,
      head: [['Componente', 'Detalle', 'Pts', '']],
      body: wsRows.map(r => r.slice(0, 4)),
      columnStyles: { 1: { cellWidth: 52 }, 2: { halign: 'right', cellWidth: 22 }, 3: { cellWidth: 32 } },
      didDrawCell: (data) => {
        if (data.column.index === 3 && data.section === 'body') {
          const pct = wsRows[data.row.index]?.[4] ?? 0;
          const bx  = data.cell.x + 3;
          const by  = data.cell.y + data.cell.height / 2 - 1.5;
          const bw  = data.cell.width - 6;
          const color = pct >= 75 ? _PDF.gain : pct >= 40 ? _PDF.gold : _PDF.loss;
          _pdfBar(doc, bx, by, bw, pct, color);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;

    if (ws.advice && ws.advice.length) {
      const boxH = 8 + ws.advice.length * 6.5;
      if (y + boxH > H - 20) { doc.addPage(); y = 20; }
      doc.setFillColor(..._PDF.kpiBg);
      doc.roundedRect(12, y, W - 24, boxH, 2, 2, 'F');
      doc.setFillColor(..._PDF.gold);
      doc.roundedRect(12, y, 3.5, boxH, 1, 1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(..._PDF.goldDim);
      doc.text('RECOMENDACIONES PERSONALIZADAS', 19.5, y + 5.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(..._PDF.dark2);
      ws.advice.forEach((a, i) => {
        doc.text('- ' + a, 19.5, y + 11 + i * 6.5);
      });
    }
  }

  const reportId = 'EB-' + prevM.replace('-', '') + '-' + Date.now().toString(36).toUpperCase().slice(-5);
  _pdfFooter(doc, reportId, 2); // Skip cover page from standard footer
  const filename = `Finova_Informe_${prevM}.pdf`;
  doc.save(filename);
  APP.lastMonthlyBriefing = prevM;
  saveData();
  showToast(`Informe generado: ${filename} ✓`, 'success');
}
