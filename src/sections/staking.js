/* ═══════════════════════════════════════════════════════════════
   FINOVA — staking.js
   Crypto Staking — ingresos pasivos en criptomonedas
═══════════════════════════════════════════════════════════════ */

const STAKING_CATALOG = [
  { id:'ETH',   name:'Ethereum',  ticker:'ETH',   apy:4.20, risk:'bajo',       lockDays:0,  color:'#627eea', symbol:'Ξ',  desc:'Staking líquido sin bloqueo. El protocolo más seguro y con mayor liquidez del ecosistema.' },
  { id:'SOL',   name:'Solana',    ticker:'SOL',   apy:6.80, risk:'medio',      lockDays:2,  color:'#9945FF', symbol:'◎',  desc:'Alta velocidad y bajo coste. Recompensas cada época. Desbloqueo en 2 días hábiles.' },
  { id:'ADA',   name:'Cardano',   ticker:'ADA',   apy:4.50, risk:'bajo',       lockDays:0,  color:'#0d4fd6', symbol:'₳',  desc:'Delegación sin custodia. Las recompensas se liquidan cada época (~5 días). Sin bloqueo.' },
  { id:'MATIC', name:'Polygon',   ticker:'MATIC', apy:5.10, risk:'medio',      lockDays:0,  color:'#8247e5', symbol:'⬡',  desc:'Capa 2 de Ethereum. Staking líquido, sin bloqueo y con recompensas competitivas.' },
  { id:'AVAX',  name:'Avalanche', ticker:'AVAX',  apy:8.50, risk:'medio-alto', lockDays:14, color:'#e84142', symbol:'▲',  desc:'Alto rendimiento con período de bloqueo mínimo de 14 días. Red de alta velocidad.' },
  { id:'LINK',  name:'Chainlink', ticker:'LINK',  apy:5.60, risk:'medio',      lockDays:7,  color:'#2a5ada', symbol:'⬡',  desc:'Staking de oráculos descentralizados. Período mínimo de 7 días. Penalización por salida anticipada.' },
  { id:'DOT',   name:'Polkadot',  ticker:'DOT',   apy:12.0, risk:'alto',       lockDays:28, color:'#e6007a', symbol:'●',  desc:'Mayor APY de la lista. Período de unbonding de 28 días. Solo para inversores con horizonte largo.' },
  { id:'BTC',   name:'Bitcoin',   ticker:'BTC',   apy:2.80, risk:'bajo',       lockDays:0,  color:'#f7931a', symbol:'₿',  desc:'WBTC o plataformas CeFi. Menor APY pero máxima seguridad y liquidez. Sin bloqueo.' },
];

const _STK_RISK = {
  'bajo':       { label:'Bajo',       cls:'stk-risk-low'   },
  'medio':      { label:'Medio',      cls:'stk-risk-med'   },
  'medio-alto': { label:'Medio-Alto', cls:'stk-risk-medhi' },
  'alto':       { label:'Alto',       cls:'stk-risk-hi'    },
};

/* ─── Tab switching ──────────────────────────────────────────── */
function switchDivTab(tab) {
  const panelDiv = document.getElementById('div-panel-dividends');
  const panelStk = document.getElementById('div-panel-staking');
  const tabDiv   = document.getElementById('stk-tab-dividends');
  const tabStk   = document.getElementById('stk-tab-staking');
  const btnAdd   = document.getElementById('btnAddDividend');
  if (!panelDiv || !panelStk) return;

  panelDiv.classList.toggle('hidden', tab !== 'dividends');
  panelStk.classList.toggle('hidden', tab !== 'staking');
  tabDiv.classList.toggle('section-tab-active', tab === 'dividends');
  tabStk.classList.toggle('section-tab-active', tab === 'staking');
  if (btnAdd) btnAdd.style.display = tab === 'dividends' ? '' : 'none';
  if (tab === 'staking') renderStaking();
}

/* ─── Main render ────────────────────────────────────────────── */
function renderStaking() {
  _stkRenderKPIs();
  _stkRenderAssets();
  _stkRenderPositions();
  _stkRenderHistory();
  ric(() => _stkRenderChart());
}

/* ─── KPI calculations ───────────────────────────────────────── */
function _stkTotals() {
  const positions = APP.stakingPositions || [];
  let totalStaked = 0, totalRewards = 0, apyWeighted = 0;
  positions.forEach(p => {
    totalStaked  += p.amountEur  || 0;
    totalRewards += p.rewardsEur || 0;
    apyWeighted  += (p.apy || 0) * (p.amountEur || 0);
  });
  const avgApy    = totalStaked > 0 ? apyWeighted / totalStaked : 0;
  const monthlyEst = totalStaked * (avgApy / 100) / 12;
  const annualEst  = totalStaked * (avgApy / 100);
  return { totalStaked, totalRewards, avgApy, monthlyEst, annualEst, count: positions.length };
}

/* ─── KPI cards ──────────────────────────────────────────────── */
function _stkRenderKPIs() {
  const grid = document.getElementById('stk-kpi-grid');
  if (!grid) return;
  const { totalStaked, totalRewards, avgApy, monthlyEst, annualEst, count } = _stkTotals();
  const posLabel = `${count} posición${count !== 1 ? 'es' : ''} activa${count !== 1 ? 's' : ''}`;

  grid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Total en staking</div>
      <div class="kpi-value positive">${formatCurrency(totalStaked)}</div>
      <div class="kpi-change">${posLabel}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Recompensas acumuladas</div>
      <div class="kpi-value positive">${formatCurrency(totalRewards)}</div>
      <div class="kpi-change">Historial total cobrado</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">APY medio ponderado</div>
      <div class="kpi-value">${avgApy.toFixed(2)}%</div>
      <div class="kpi-change">Rendimiento anual</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Estimación mensual</div>
      <div class="kpi-value positive">${formatCurrency(monthlyEst)}</div>
      <div class="kpi-change">Ingresos pasivos / mes</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Estimación anual</div>
      <div class="kpi-value positive">${formatCurrency(annualEst)}</div>
      <div class="kpi-change">Proyección 12 meses</div>
    </div>
  `;
}

/* ─── Assets grid ────────────────────────────────────────────── */
function _stkRenderAssets() {
  const grid = document.getElementById('stk-assets-grid');
  if (!grid) return;
  const sorted = [...STAKING_CATALOG].sort((a, b) => b.apy - a.apy);

  grid.innerHTML = sorted.map(asset => {
    const risk     = _STK_RISK[asset.risk] || { label: asset.risk, cls: 'stk-risk-med' };
    const myTotal  = (APP.stakingPositions || [])
      .filter(p => p.coin === asset.id)
      .reduce((s, p) => s + (p.amountEur || 0), 0);
    const lockLabel = asset.lockDays === 0 ? 'Sin bloqueo' : `${asset.lockDays} día${asset.lockDays !== 1 ? 's' : ''}`;
    const lockCls   = asset.lockDays === 0 ? 'stk-lock-free' : 'stk-lock-locked';

    return `
      <div class="stk-asset-card">
        <div class="stk-asset-head">
          <div class="stk-coin-logo" style="background:${asset.color}1a;color:${asset.color};border:1.5px solid ${asset.color}44">
            ${asset.symbol}
          </div>
          <div class="stk-asset-info">
            <div class="stk-asset-name">${escapeHtml(asset.name)}</div>
            <div class="stk-asset-ticker">${escapeHtml(asset.ticker)}</div>
          </div>
          <div class="stk-apy-badge">
            <div class="stk-apy-val">${asset.apy.toFixed(1)}%</div>
            <div class="stk-apy-lbl">APY</div>
          </div>
        </div>
        <div class="stk-asset-meta">
          <div class="stk-meta-row">
            <span class="stk-meta-lbl">Riesgo</span>
            <span class="stk-risk-badge ${risk.cls}">${risk.label}</span>
          </div>
          <div class="stk-meta-row">
            <span class="stk-meta-lbl">Bloqueo</span>
            <span class="stk-lock-badge ${lockCls}">${lockLabel}</span>
          </div>
          ${myTotal > 0 ? `
          <div class="stk-meta-row">
            <span class="stk-meta-lbl">Mi staking</span>
            <span class="positive" style="font-size:12px;font-weight:600">${formatCurrency(myTotal)}</span>
          </div>` : ''}
        </div>
        <p class="stk-asset-desc">${escapeHtml(asset.desc)}</p>
        <button class="btn-primary stk-btn-stake" data-action="stake" data-id="${asset.id}">
          + Hacer staking
        </button>
      </div>
    `;
  }).join('');
}

/* ─── Positions table ────────────────────────────────────────── */
function _stkRenderPositions() {
  const card = document.getElementById('stk-positions-card');
  if (!card) return;
  const positions = APP.stakingPositions || [];

  if (positions.length === 0) {
    card.innerHTML = `
      <h3 class="card-title">📋 Mis posiciones activas</h3>
      <div class="stk-empty">
        <div class="stk-empty-icon">⬡</div>
        <div class="stk-empty-title">Sin posiciones activas</div>
        <div class="stk-empty-sub">Selecciona un activo y haz staking para empezar a generar recompensas pasivas.</div>
      </div>
    `;
    return;
  }

  card.innerHTML = `
    <h3 class="card-title">📋 Mis posiciones activas</h3>
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Activo</th>
            <th class="text-right">Importe</th>
            <th class="text-right">APY</th>
            <th class="text-right">Recompensas</th>
            <th>Inicio</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${positions.map(p => {
            const cat        = STAKING_CATALOG.find(c => c.id === p.coin) || {};
            const unlockDate = p.lockDays > 0 ? _stkUnlockDate(p.startDate, p.lockDays) : null;
            const isLocked   = unlockDate && new Date(unlockDate) > new Date();
            return `
              <tr>
                <td>
                  <div class="stk-pos-cell">
                    <span class="stk-coin-dot" style="background:${cat.color || 'var(--accent)'}"></span>
                    <div>
                      <div style="font-weight:600">${escapeHtml(p.name)}</div>
                      <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.coin)}</div>
                    </div>
                  </div>
                </td>
                <td class="text-right"><strong>${formatCurrency(p.amountEur)}</strong></td>
                <td class="text-right positive">${p.apy.toFixed(2)}%</td>
                <td class="text-right positive">${formatCurrency(p.rewardsEur || 0)}</td>
                <td style="font-size:12px">${escapeHtml(p.startDate)}</td>
                <td>
                  ${isLocked
                    ? `<span class="stk-lock-badge stk-lock-locked" title="Disponible el ${unlockDate}">🔒 ${unlockDate}</span>`
                    : `<span class="stk-lock-badge stk-lock-free">Disponible</span>`}
                </td>
                <td>
                  <div class="action-buttons">
                    <button class="btn-ghost btn-icon" data-action="add-stk-rewards" data-id="${p.id}" title="Registrar recompensas">+R</button>
                    <button class="btn-danger btn-icon" data-action="unstake" data-id="${p.id}" title="Retirar staking"${isLocked ? ' disabled' : ''}>↩</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ─── Chart ──────────────────────────────────────────────────── */
function _stkRenderChart() {
  const ctx = document.getElementById('stk-chart');
  if (!ctx) return;
  const { totalStaked, avgApy } = _stkTotals();
  const wrapper = ctx.closest('.chart-wrapper');

  if (totalStaked <= 0) { if (wrapper) wrapper.style.display = 'none'; return; }
  if (wrapper) wrapper.style.display = '';

  Charts.destroy('stk-rewards');
  const months = 13;
  const labels = [], compound = [], simple = [];
  const now    = new Date();
  const r      = avgApy / 100;

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    labels.push(d.toLocaleString('es-ES', { month: 'short', year: '2-digit' }));
    compound.push(+(totalStaked * (Math.pow(1 + r / 12, i) - 1)).toFixed(2));
    simple.push(+(totalStaked * r * i / 12).toFixed(2));
  }

  const { gridColor, textColor, fontFamily, accent } = getChartDefaults();
  Charts.set('stk-rewards', new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Interés compuesto',
          data: compound,
          borderColor: accent,
          backgroundColor: accent + '22',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Interés simple',
          data: simple,
          borderColor: textColor + '55',
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          tension: 0.4,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { labels: { color: textColor, font: { family: fontFamily, size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: textColor, font: { family: fontFamily, size: 11 } }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: { family: fontFamily, size: 11 }, callback: v => formatCurrency(v) }, grid: { color: gridColor } },
      },
    },
  }));
}

/* ─── History table ──────────────────────────────────────────── */
function _stkRenderHistory() {
  const card = document.getElementById('stk-history-card');
  if (!card) return;
  const history = [...(APP.stakingHistory || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);

  const TYPE_LABEL  = { stake: 'Entrada', unstake: 'Retirada', reward: 'Recompensa' };
  const TYPE_CLS    = { stake: 'positive', unstake: '', reward: 'positive' };
  const STATUS_LABEL = { completed: 'Completado', pending: 'Pendiente' };
  const STATUS_CLS   = { completed: 'stk-status-ok', pending: 'stk-status-pend' };

  card.innerHTML = `
    <div class="stk-history-hdr">
      <h3 class="card-title" style="margin:0">📜 Historial de staking</h3>
      <button class="btn-ghost" style="font-size:12px;padding:5px 12px" data-action="open-stk-calc">🧮 Calculadora</button>
    </div>
    ${history.length === 0
      ? `<div class="stk-empty">
           <div class="stk-empty-icon">📜</div>
           <div class="stk-empty-title">Sin historial</div>
           <div class="stk-empty-sub">Las operaciones de staking aparecerán aquí.</div>
         </div>`
      : `<div class="table-wrapper">
           <table class="data-table">
             <thead>
               <tr>
                 <th>Fecha</th>
                 <th>Activo</th>
                 <th>Tipo</th>
                 <th class="text-right">Importe</th>
                 <th class="text-right">Recompensas</th>
                 <th>Estado</th>
               </tr>
             </thead>
             <tbody>
               ${history.map(h => `
                 <tr>
                   <td style="font-size:12px">${escapeHtml(h.date)}</td>
                   <td><span class="ticker-chip">${escapeHtml(h.coin)}</span></td>
                   <td><span class="${TYPE_CLS[h.type] || ''}">${TYPE_LABEL[h.type] || h.type}</span></td>
                   <td class="text-right ${TYPE_CLS[h.type] || ''}">${formatCurrency(h.amountEur)}</td>
                   <td class="text-right positive">${h.rewards > 0 ? formatCurrency(h.rewards) : '—'}</td>
                   <td><span class="stk-status-badge ${STATUS_CLS[h.status] || ''}">${STATUS_LABEL[h.status] || h.status}</span></td>
                 </tr>
               `).join('')}
             </tbody>
           </table>
         </div>`
    }
  `;
}

/* ─── Stake modal ────────────────────────────────────────────── */
function openStakeModal(coinId) {
  const cat = STAKING_CATALOG.find(c => c.id === coinId);
  if (!cat) return;

  const today = new Date().toISOString().slice(0, 10);
  const body  = `
    <div class="stk-modal-coin">
      <div class="stk-coin-logo stk-coin-logo-lg" style="background:${cat.color}1a;color:${cat.color};border:2px solid ${cat.color}44">
        ${cat.symbol}
      </div>
      <div>
        <div style="font-weight:700;font-size:16px">${escapeHtml(cat.name)}</div>
        <div style="font-size:13px;color:var(--text-muted)">${cat.ticker} · APY referencial ${cat.apy}%</div>
      </div>
    </div>
    <div class="form-row" style="margin-top:1.2rem">
      <div class="form-group">
        <label class="form-label">Importe (€)</label>
        <input type="number" id="stk-f-amount" class="text-input" placeholder="1000" min="1" step="0.01"
               oninput="_stkPreviewUpdate('${cat.id}')" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de inicio</label>
        <input type="date" id="stk-f-date" class="text-input" value="${today}"
               oninput="_stkPreviewUpdate('${cat.id}')" />
      </div>
    </div>
    <div id="stk-preview" class="stk-preview-box" style="display:none">
      <div class="stk-preview-row"><span>APY</span><strong id="stk-pr-apy">—</strong></div>
      <div class="stk-preview-row"><span>Recompensa mensual est.</span><strong class="positive" id="stk-pr-mo">—</strong></div>
      <div class="stk-preview-row"><span>Recompensa anual est.</span><strong class="positive" id="stk-pr-yr">—</strong></div>
      ${cat.lockDays > 0
        ? `<div class="stk-preview-row"><span>Disponible a partir de</span><strong style="color:var(--text-muted)" id="stk-pr-lock">—</strong></div>`
        : ''}
    </div>
    ${cat.lockDays > 0
      ? `<div class="stk-disclaimer">⚠ Período de bloqueo de <strong>${cat.lockDays} días</strong>. No podrás retirar antes del vencimiento.</div>`
      : ''}
  `;

  openModal(`Hacer staking — ${cat.name}`, body, () => _stkConfirmStake(cat.id));
  setTimeout(() => _stkPreviewUpdate(cat.id), 60);
}

function _stkPreviewUpdate(coinId) {
  const cat    = STAKING_CATALOG.find(c => c.id === coinId);
  const amount = parseFloat(document.getElementById('stk-f-amount')?.value || '0');
  const box    = document.getElementById('stk-preview');
  if (!box || !cat) return;
  if (amount <= 0) { box.style.display = 'none'; return; }

  box.style.display = '';
  document.getElementById('stk-pr-apy').textContent = cat.apy.toFixed(2) + '%';
  document.getElementById('stk-pr-mo').textContent  = formatCurrency(amount * (cat.apy / 100) / 12);
  document.getElementById('stk-pr-yr').textContent  = formatCurrency(amount * (cat.apy / 100));
  const lockEl = document.getElementById('stk-pr-lock');
  if (lockEl && cat.lockDays > 0) {
    const start = document.getElementById('stk-f-date')?.value || new Date().toISOString().slice(0, 10);
    lockEl.textContent = _stkUnlockDate(start, cat.lockDays);
  }
}

function _stkConfirmStake(coinId) {
  const cat    = STAKING_CATALOG.find(c => c.id === coinId);
  const amount = parseFloat(document.getElementById('stk-f-amount')?.value || '0');
  const date   = document.getElementById('stk-f-date')?.value;
  if (!cat || amount <= 0 || !date) { showToast('Introduce un importe y fecha válidos.', 'error'); return false; }

  if (!APP.stakingPositions) APP.stakingPositions = [];
  if (!APP.stakingHistory)   APP.stakingHistory   = [];

  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `stk-${Date.now()}`;
  APP.stakingPositions.push({ id, coin: cat.id, name: cat.name, amountEur: amount, apy: cat.apy, lockDays: cat.lockDays, startDate: date, rewardsEur: 0 });
  APP.stakingHistory.push({ id: id + '-e', date, coin: cat.id, type: 'stake', amountEur: amount, rewards: 0, status: 'completed' });

  saveData();
  closeModal();
  renderStaking();
  showToast(`Staking de ${formatCurrency(amount)} en ${cat.name} registrado ✓`);
}

/* ─── Unstake modal ──────────────────────────────────────────── */
function openUnstakeModal(posId) {
  const pos = (APP.stakingPositions || []).find(p => p.id === posId);
  if (!pos) return;
  const cat        = STAKING_CATALOG.find(c => c.id === pos.coin) || { color: '#888', symbol: pos.coin[0] };
  const unlockDate = pos.lockDays > 0 ? _stkUnlockDate(pos.startDate, pos.lockDays) : null;
  const isLocked   = unlockDate && new Date(unlockDate) > new Date();

  const body = `
    <div class="stk-modal-coin">
      <div class="stk-coin-logo stk-coin-logo-lg" style="background:${cat.color}1a;color:${cat.color};border:2px solid ${cat.color}44">
        ${cat.symbol}
      </div>
      <div>
        <div style="font-weight:700;font-size:16px">${escapeHtml(pos.name)}</div>
        <div style="font-size:13px;color:var(--text-muted)">${pos.coin} · ${pos.apy}% APY</div>
      </div>
    </div>
    <div class="stk-preview-box" style="margin-top:1rem">
      <div class="stk-preview-row"><span>En staking</span><strong>${formatCurrency(pos.amountEur)}</strong></div>
      <div class="stk-preview-row"><span>Recompensas acumuladas</span><strong class="positive">${formatCurrency(pos.rewardsEur || 0)}</strong></div>
      <div class="stk-preview-row"><span>Fecha inicio</span><strong>${escapeHtml(pos.startDate)}</strong></div>
      ${unlockDate ? `<div class="stk-preview-row"><span>Desbloqueo</span><strong style="${isLocked ? 'color:var(--danger)' : 'color:var(--positive)'}">${unlockDate}</strong></div>` : ''}
    </div>
    ${isLocked ? `<div class="stk-disclaimer stk-disclaimer-warn">⚠ Esta posición está bloqueada hasta <strong>${unlockDate}</strong>. Si retiras ahora podrían aplicarse penalizaciones externas.</div>` : ''}
    <div class="form-group" style="margin-top:1rem">
      <label class="form-label">Importe a retirar (€)</label>
      <input type="number" id="stk-f-unstake" class="text-input" value="${pos.amountEur}" max="${pos.amountEur}" step="0.01" min="0.01" />
    </div>
  `;

  openModal(`Retirar staking — ${pos.name}`, body, () => _stkConfirmUnstake(posId));
}

function _stkConfirmUnstake(posId) {
  const pos    = (APP.stakingPositions || []).find(p => p.id === posId);
  const amount = parseFloat(document.getElementById('stk-f-unstake')?.value || '0');
  if (!pos || amount <= 0) { showToast('Introduce un importe válido.', 'error'); return false; }

  if (!APP.stakingHistory) APP.stakingHistory = [];
  const today = new Date().toISOString().slice(0, 10);
  APP.stakingHistory.push({ id: `stk-u-${Date.now()}`, date: today, coin: pos.coin, type: 'unstake', amountEur: amount, rewards: pos.rewardsEur || 0, status: 'completed' });

  if (amount >= pos.amountEur) {
    APP.stakingPositions = (APP.stakingPositions || []).filter(p => p.id !== posId);
  } else {
    pos.amountEur -= amount;
  }

  saveData();
  closeModal();
  renderStaking();
  showToast(`Retirada de ${formatCurrency(amount)} completada ✓`);
}

/* ─── Rewards modal ──────────────────────────────────────────── */
function openAddRewardsModal(posId) {
  const pos = (APP.stakingPositions || []).find(p => p.id === posId);
  if (!pos) return;

  const body = `
    <p style="color:var(--text-muted);margin-bottom:1rem;font-size:13px">Registra recompensas recibidas en <strong>${escapeHtml(pos.name)}</strong>.</p>
    <div class="form-group">
      <label class="form-label">Importe de recompensas (€)</label>
      <input type="number" id="stk-f-rwrd" class="text-input" placeholder="12.50" min="0.01" step="0.01" />
    </div>
    <div class="form-group">
      <label class="form-label">Fecha</label>
      <input type="date" id="stk-f-rwrd-date" class="text-input" value="${new Date().toISOString().slice(0, 10)}" />
    </div>
  `;

  openModal(`Recompensas — ${pos.name}`, body, () => _stkConfirmRewards(posId));
}

function _stkConfirmRewards(posId) {
  const pos     = (APP.stakingPositions || []).find(p => p.id === posId);
  const rewards = parseFloat(document.getElementById('stk-f-rwrd')?.value || '0');
  const date    = document.getElementById('stk-f-rwrd-date')?.value;
  if (!pos || rewards <= 0) { showToast('Introduce un importe de recompensas válido.', 'error'); return false; }

  pos.rewardsEur = (pos.rewardsEur || 0) + rewards;
  if (!APP.stakingHistory) APP.stakingHistory = [];
  APP.stakingHistory.push({ id: `stk-r-${Date.now()}`, date: date || new Date().toISOString().slice(0, 10), coin: pos.coin, type: 'reward', amountEur: rewards, rewards, status: 'completed' });

  saveData();
  closeModal();
  renderStaking();
  showToast(`+${formatCurrency(rewards)} de recompensas registradas ✓`);
}

/* ─── Calculator modal ───────────────────────────────────────── */
function openStakingCalculator() {
  const body = `
    <p style="color:var(--text-muted);margin-bottom:1.2rem;font-size:13px">Simula el crecimiento de tu staking con interés compuesto mensual.</p>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Capital inicial (€)</label>
        <input type="number" id="stk-c-cap" class="text-input" placeholder="10 000" min="1" oninput="_stkCalcUpdate()" />
      </div>
      <div class="form-group">
        <label class="form-label">APY (%)</label>
        <input type="number" id="stk-c-apy" class="text-input" placeholder="5.0" step="0.1" min="0.1" max="100" oninput="_stkCalcUpdate()" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" style="display:flex;justify-content:space-between">
        Período
        <span id="stk-c-months-lbl" style="color:var(--accent);font-weight:600">12 meses</span>
      </label>
      <input type="range" id="stk-c-months" min="1" max="60" value="12" class="stk-slider"
             oninput="document.getElementById('stk-c-months-lbl').textContent=this.value+' meses';_stkCalcUpdate()" />
    </div>
    <div id="stk-c-result" class="stk-calc-result" style="display:none">
      <div class="stk-calc-row"><span>Capital inicial</span><strong id="stk-c-r-cap">—</strong></div>
      <div class="stk-calc-row"><span>Beneficio total</span><strong class="positive" id="stk-c-r-profit">—</strong></div>
      <div class="stk-calc-row stk-calc-total"><span>Valor final</span><strong id="stk-c-r-final">—</strong></div>
      <div class="stk-calc-row"><span>Beneficio mensual</span><strong class="positive" id="stk-c-r-monthly">—</strong></div>
    </div>
    <div class="chart-wrapper" style="margin-top:1rem;height:180px"><canvas id="stk-c-chart"></canvas></div>
  `;

  openModal('🧮 Calculadora de Staking', body, null, () => _stkCalcUpdate());
}

function _stkCalcUpdate() {
  const capital = parseFloat(document.getElementById('stk-c-cap')?.value     || '0');
  const apy     = parseFloat(document.getElementById('stk-c-apy')?.value     || '0');
  const months  = parseInt(document.getElementById('stk-c-months')?.value    || '12', 10);
  const result  = document.getElementById('stk-c-result');
  if (!result) return;
  if (capital <= 0 || apy <= 0) { result.style.display = 'none'; return; }

  const r       = apy / 100;
  const final_v = capital * Math.pow(1 + r / 12, months);
  const profit  = final_v - capital;
  const monthly = capital * r / 12;

  result.style.display = '';
  document.getElementById('stk-c-r-cap').textContent    = formatCurrency(capital);
  document.getElementById('stk-c-r-profit').textContent = formatCurrency(profit);
  document.getElementById('stk-c-r-final').textContent  = formatCurrency(final_v);
  document.getElementById('stk-c-r-monthly').textContent = formatCurrency(monthly);

  const ctx = document.getElementById('stk-c-chart');
  if (!ctx) return;
  Charts.destroy('stk-calc');

  const labels = [], values = [];
  for (let i = 0; i <= months; i++) {
    labels.push(i === 0 ? 'Hoy' : `+${i}m`);
    values.push(+(capital * Math.pow(1 + r / 12, i)).toFixed(2));
  }

  const { gridColor, textColor, fontFamily, accent } = getChartDefaults();
  Charts.set('stk-calc', new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Valor acumulado', data: values, borderColor: accent, backgroundColor: accent + '22', fill: true, tension: 0.4, pointRadius: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor, font: { family: fontFamily, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: { family: fontFamily, size: 10 }, callback: v => '€' + Math.round(v).toLocaleString('es-ES') }, grid: { color: gridColor } },
      },
    },
  }));
}

/* ─── Event delegation ───────────────────────────────────────── */
function _initStakingDelegates() {
  _delegate('div-panel-staking', {
    'stake':           id => openStakeModal(id),
    'unstake':         id => openUnstakeModal(id),
    'add-stk-rewards': id => openAddRewardsModal(id),
    'open-stk-calc':   ()  => openStakingCalculator(),
  });
}

/* ─── Helpers ────────────────────────────────────────────────── */
function _stkUnlockDate(startDate, lockDays) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + lockDays);
  return d.toISOString().slice(0, 10);
}

/* ─── Bootstrap ──────────────────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initStakingDelegates);
} else {
  _initStakingDelegates();
}
