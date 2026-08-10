'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — CALCS
   All financial calculation functions. Pure aggregations over
   APP state — no side-effects, no DOM access.
   Depends on: state.js (APP), utils.js (getCurrentMonth).
═══════════════════════════════════════════════════════════════ */

/** Per-asset value and cost helpers — single source of truth for the formula */
function assetValue(a) { return a.currentPrice * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1); }
function assetCost(a)  { return a.buyPrice     * a.quantity * (a.exchangeRate > 0 ? a.exchangeRate : 1); }

/* Per-render cache for the two most expensive aggregations.
   Invalidated by saveData() so it never serves stale values across data mutations. */
let _cachePortfolio = null;
let _cacheNetWorth  = null;
function _invalidateCalcCache() { _cachePortfolio = null; _cacheNetWorth = null; }

function calcPortfolioValue() {
  if (_cachePortfolio !== null) return _cachePortfolio;
  _cachePortfolio = APP.portfolio.reduce((sum, a) => sum + assetValue(a), 0);
  return _cachePortfolio;
}

function calcCashTotal() {
  return APP.cashAccounts.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
}

function calcAltCurrentValue(a) {
  const dep = parseFloat(a.depreciationPct);
  if (dep > 0 && a.purchaseDate) {
    const years = (Date.now() - new Date(a.purchaseDate)) / (365.25 * 86400000);
    if (years >= 0) return (parseFloat(a.buyPrice) || 0) * Math.pow(1 - dep / 100, years);
  }
  return parseFloat(a.currentPrice) || 0;
}

function calcAlternativesTotal() {
  return APP.alternatives.reduce((sum, a) => sum + calcAltCurrentValue(a), 0);
}

function calcPropertiesTotal() {
  return (APP.properties || []).reduce((sum, p) => sum + (parseFloat(p.currentValue) || 0), 0);
}

function calcLiabilitiesTotal() {
  return (APP.liabilities || []).reduce((sum, l) => sum + (parseFloat(l.remainingAmount) || 0), 0);
}

function calcNetWorth() {
  if (_cacheNetWorth !== null) return _cacheNetWorth;
  _cacheNetWorth = calcCashTotal() + calcPortfolioValue() + calcAlternativesTotal() + calcPropertiesTotal() - calcLiabilitiesTotal();
  return _cacheNetWorth;
}

function calcAssetCAGR(a) {
  if (!a.buyDate || !a.buyPrice || a.buyPrice <= 0) return null;
  const days = Math.floor((Date.now() - new Date(a.buyDate)) / 86400000);
  if (days < 30) return null;
  const years = days / 365.25;
  const fx = a.exchangeRate > 0 ? a.exchangeRate : 1;
  return (Math.pow((a.currentPrice * fx) / (a.buyPrice * fx), 1 / years) - 1) * 100;
}

function calcPortfolioCAGR() {
  const assets = APP.portfolio.filter(a => a.buyDate && a.buyPrice > 0 && a.currentPrice > 0);
  if (!assets.length) return null;
  const totalCost = assets.reduce((s, a) => s + assetCost(a), 0);
  if (totalCost <= 0) return null;
  const weightedDays = assets.reduce((s, a) => {
    const days = Math.floor((Date.now() - new Date(a.buyDate)) / 86400000);
    return s + days * (assetCost(a) / totalCost);
  }, 0);
  if (weightedDays < 30) return null;
  const years = weightedDays / 365.25;
  const totalValue = assets.reduce((s, a) => s + assetValue(a), 0);
  return (Math.pow(totalValue / totalCost, 1 / years) - 1) * 100;
}

function calcMonthlyIncome(month = getCurrentMonth()) {
  return APP.transactions
    .filter(t => t.type === 'income' && (t.date || getCurrentMonth()).startsWith(month))
    .reduce((sum, t) => sum + t.amount, 0);
}

function calcMonthlyExpense(month = getCurrentMonth()) {
  return APP.transactions
    .filter(t => t.type === 'expense' && (t.date || getCurrentMonth()).startsWith(month))
    .reduce((sum, t) => sum + t.amount, 0);
}

/** Media mensual de (ingresos − gastos) de los últimos N meses completos */
function calcAvgMonthlySurplus(months = 12) {
  const now = new Date();
  const surpluses = [];
  for (let i = 1; i <= months; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const txs = APP.transactions.filter(t => (t.date || getCurrentMonth()).startsWith(key));
    if (!txs.length) continue;
    const inc = txs.filter(t => t.type === 'income').reduce((s, t)  => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    surpluses.push(inc - exp);
  }
  if (!surpluses.length) return 0;
  surpluses.sort((a, b) => a - b);
  const mid = Math.floor(surpluses.length / 2);
  return surpluses.length % 2 === 0
    ? (surpluses[mid - 1] + surpluses[mid]) / 2
    : surpluses[mid];
}

function _maybeSnapshotPortfolio() {
  const year = String(new Date().getFullYear());
  if (!APP.portfolioSnapshots) APP.portfolioSnapshots = [];
  if (APP.portfolioSnapshots.find(s => s.year === year)) return;
  APP.portfolioSnapshots.push({
    year,
    month: getCurrentMonth(),
    positions: APP.portfolio.map(a => ({
      id: a.id, name: a.name, ticker: a.ticker || '',
      quantity: a.quantity, buyPrice: a.buyPrice,
      currentPrice: a.currentPrice,
      currency: a.currency || 'EUR',
      exchangeRate: a.exchangeRate,
    })),
  });
  if (APP.portfolioSnapshots.length > 10) APP.portfolioSnapshots.splice(0, APP.portfolioSnapshots.length - 10);
}

function _nextMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function _advanceRecurringDate(dateStr, frequency, renewalDay = null) {
  const d = new Date(dateStr + 'T00:00:00');
  const freq = { weekly: [7, 'day'], biweekly: [14, 'day'], monthly: [1, 'month'], quarterly: [3, 'month'], annual: [1, 'year'] }[frequency];
  if (!freq) return dateStr;
  if (freq[1] === 'day') d.setDate(d.getDate() + freq[0]);
  if (freq[1] === 'month') {
    if (renewalDay && frequency === 'monthly') {
      d.setDate(1);
      d.setMonth(d.getMonth() + freq[0]);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(renewalDay, maxDay));
    } else {
      d.setMonth(d.getMonth() + freq[0]);
    }
  }
  if (freq[1] === 'year') d.setFullYear(d.getFullYear() + freq[0]);
  return d.toISOString().slice(0, 10);
}

function updateNetworthHistory(preNW) {
  _maybeSnapshotPortfolio();
  const month = getCurrentMonth();
  const value = preNW !== undefined ? preNW : calcNetWorth();
  const portfolioValue = calcPortfolioValue();
  const cashValue = calcCashTotal();
  const idx = APP.networthHistory.findIndex(h => h.date === month);
  if (idx >= 0) {
    APP.networthHistory[idx].value = value;
    APP.networthHistory[idx].portfolioValue = portfolioValue;
    APP.networthHistory[idx].cashValue = cashValue;
  } else {
    APP.networthHistory.push({ date: month, value, portfolioValue, cashValue });
  }
  APP.networthHistory.sort((a, b) => a.date.localeCompare(b.date));

  // Backfill any gap months between recorded entries using the previous value as estimate.
  const input  = APP.networthHistory;
  const output = [];
  for (let i = 0; i < input.length; i++) {
    output.push(input[i]);
    if (i < input.length - 1) {
      let cursor = _nextMonth(input[i].date);
      while (cursor < input[i + 1].date) {
        output.push({
          date:           cursor,
          value:          input[i].value,
          portfolioValue: input[i].portfolioValue,
          cashValue:      input[i].cashValue,
          estimated:      true,
        });
        cursor = _nextMonth(cursor);
      }
    }
  }
  APP.networthHistory = output;
}
