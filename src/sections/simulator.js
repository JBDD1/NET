/* ═══════════════════════════════════════════════════════════════
   FINOVA — simulator.js
   Sección 14: Simulador de inversión con interés compuesto
═══════════════════════════════════════════════════════════════ */

let _lastSimParams = null;

function renderSimulator() {
  const d = APP.simulatorDraft || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== '') el.value = val; };
  setVal('sim-initial', d.initial);
  setVal('sim-monthly', d.monthly);
  setVal('sim-rate',    d.rate);
  setVal('sim-years',   d.years);
  if (d.hasResult) runSimulator(true);
  else renderSimulatorScenarios();
}

function runSimulator(silent = false) {
  const initial = parseFloat(document.getElementById('sim-initial').value) || 0;
  const monthly = parseFloat(document.getElementById('sim-monthly').value) || 0;
  const rate    = parseFloat(document.getElementById('sim-rate').value) || 0;
  const years   = parseInt(document.getElementById('sim-years').value)  || 1;

  if (rate < 0 || rate > 100) return showToast('La tasa debe estar entre 0% y 100%', 'error');
  if (years < 1 || years > 50) return showToast('Los años deben estar entre 1 y 50', 'error');

  const monthlyRate = rate / 100 / 12;
  const totalMonths = years * 12;

  const portfolioData = [];
  const investedData  = [];
  const yearLabels    = [];

  let currentValue  = initial;
  let totalInvested = initial;

  for (let m = 1; m <= totalMonths; m++) {
    currentValue  = currentValue * (1 + monthlyRate) + monthly;
    totalInvested = initial + monthly * m;

    if (m % 12 === 0) {
      portfolioData.push(parseFloat(currentValue.toFixed(2)));
      investedData.push(parseFloat(totalInvested.toFixed(2)));
      yearLabels.push(`Año ${m / 12}`);
    }
  }

  const finalValue    = currentValue;
  const finalInvested = totalInvested;
  const finalInterest = finalValue - finalInvested;

  document.getElementById('sim-results').style.display = 'block';
  setText('sim-res-invested', formatCurrency(finalInvested));
  setText('sim-res-interest', formatCurrency(finalInterest));
  setText('sim-res-total',    formatCurrency(finalValue));

  const ctx = document.getElementById('chart-simulator');
  if (!ctx) return;
  const { gridColor, textColor, fontFamily, accent, accentFill } = getChartDefaults();

  const simChart = Charts.get('simulator');
  if (simChart) {
    simChart.data.labels = yearLabels;
    simChart.data.datasets[0].data = portfolioData;
    simChart.data.datasets[0].borderColor = accent;
    simChart.data.datasets[0].backgroundColor = accentFill;
    simChart.data.datasets[1].data = investedData;
    simChart.options.scales.x.grid.color = gridColor;
    simChart.options.scales.x.ticks.color = textColor;
    simChart.options.scales.y.grid.color = gridColor;
    simChart.options.scales.y.ticks.color = textColor;
    simChart.update('none');
  } else {
    Charts.set('simulator', new Chart(ctx, {
      type: 'line',
      data: {
        labels: yearLabels,
        datasets: [
          {
            label: 'Valor total',
            data: portfolioData,
            borderColor: accent,
            backgroundColor: accentFill,
            borderWidth: 2.5, tension: 0.4, fill: true, pointRadius: 3,
          },
          {
            label: 'Capital aportado',
            data: investedData,
            borderColor: '#5b6aff',
            backgroundColor: 'rgba(91, 106, 255, 0.08)',
            borderWidth: 2, tension: 0.4, fill: true, pointRadius: 3, borderDash: [5, 3],
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: textColor, font: { family: fontFamily, size: 12 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: fontFamily, size: 11 } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: fontFamily, size: 11 }, callback: v => '€' + Intl.NumberFormat('es-ES', { notation: 'compact' }).format(v) } }
        }
      }
    }));
  }

  _lastSimParams = { initial, monthly, rate, years, finalValue };
  APP.simulatorDraft = { initial, monthly, rate, years, hasResult: true };
  saveData();
  const saveBtn = document.getElementById('btn-save-scenario');
  if (saveBtn) saveBtn.style.display = 'block';
  renderSimulatorScenarios();
  if (!silent) showToast('Simulación completada ✓', 'success');
}

function saveSimulatorScenario() {
  if (!_lastSimParams) return;
  const name = prompt('Nombre del escenario:', `Escenario ${(APP.scenarios || []).length + 1}`);
  if (!name) return;
  if (!APP.scenarios) APP.scenarios = [];
  APP.scenarios.push({
    id: generateId(), name,
    initial:    _lastSimParams.initial,
    monthly:    _lastSimParams.monthly,
    rate:       _lastSimParams.rate,
    years:      _lastSimParams.years,
    finalValue: _lastSimParams.finalValue,
    savedAt:    new Date().toISOString(),
  });
  saveData();
  renderSimulatorScenarios();
  showToast('Escenario guardado ✓', 'success');
}

function deleteSimulatorScenario(id) {
  APP.scenarios = (APP.scenarios || []).filter(s => s.id !== id);
  saveData();
  renderSimulatorScenarios();
}

function loadSimulatorScenario(id) {
  const s = (APP.scenarios || []).find(s => s.id === id);
  if (!s) return;
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  setVal('sim-initial', s.initial);
  setVal('sim-monthly', s.monthly);
  setVal('sim-rate',    s.rate);
  setVal('sim-years',   s.years);
  runSimulator();
  document.getElementById('section-simulator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSimulatorScenarios() {
  _delegate('section-simulator', {
    'load-scenario':   id => loadSimulatorScenario(id),
    'delete-scenario': id => deleteSimulatorScenario(id),
  });
  const wrapper   = document.getElementById('sim-scenarios-card');
  if (!wrapper) return;
  const container = document.getElementById('sim-scenarios-list');
  const scenarios = APP.scenarios || [];

  if (scenarios.length === 0) { wrapper.style.display = 'none'; return; }

  wrapper.style.display = '';
  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nombre</th><th>Capital inicial</th><th>Mensual</th>
          <th>Rentabilidad</th><th>Horizonte</th><th>Valor final</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${scenarios.map(s => `
          <tr data-id="${s.id}">
            <td>${escapeHtml(s.name)}</td>
            <td>${formatCurrency(s.initial)}</td>
            <td>${formatCurrency(s.monthly)}/mes</td>
            <td>${s.rate}%</td>
            <td>${s.years} años</td>
            <td class="positive" style="font-weight:600">${formatCurrency(s.finalValue)}</td>
            <td>
              <div class="action-buttons">
                <button class="btn-edit btn-icon" data-action="load-scenario" title="Cargar escenario" aria-label="Cargar escenario ${escapeHtml(s.name||'')}">↺</button>
                <button class="btn-danger btn-icon" data-action="delete-scenario" aria-label="Eliminar escenario ${escapeHtml(s.name||'')}">✕</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
