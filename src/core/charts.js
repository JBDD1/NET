'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — CHARTS
   Centralized Chart.js instance registry, color palette, and
   shared chart configuration helpers.
═══════════════════════════════════════════════════════════════ */

/** Registro centralizado de instancias Chart.js.
 *  Evita variables globales dispersas y garantiza destroy limpio en cada re-render. */
const Charts = {
  _r: {},
  get(k)       { return this._r[k] ?? null; },
  set(k, inst) { return (this._r[k] = inst); },
  destroy(k, canvasId) {
    const c = this._r[k];
    if (c) { try { c.destroy(); } catch {} }
    if (canvasId) {
      try {
        const el = document.getElementById(canvasId);
        const oc = el && typeof Chart !== 'undefined' && Chart.getChart(el);
        if (oc && oc !== c) oc.destroy();
      } catch {}
    }
    this._r[k] = null;
  },
};

function safeDestroyChart(ref, canvasId) {
  try { if (ref) ref.destroy(); } catch {}
  try {
    const el = canvasId ? document.getElementById(canvasId) : null;
    if (el) { const c = Chart.getChart(el); if (c) c.destroy(); }
  } catch {}
  return null;
}

function colorClass(value) {
  const num = parseFloat(value) || 0;
  if (num > 0) return 'positive';
  if (num < 0) return 'negative';
  return '';
}

const CHART_COLORS = [
  '#c9a84c', '#5b6aff', '#3ddc84', '#ff5c5c',
  '#ff9f43', '#54a0ff', '#a29bfe', '#fd79a8',
  '#00cec9', '#e17055', '#74b9ff', '#81ecec'
];

function yahooSectorToSpanish(sector) {
  const map = {
    'Technology': 'Tecnología',
    'Financial Services': 'Financiero',
    'Healthcare': 'Salud',
    'Consumer Cyclical': 'Consumo Discrecional',
    'Consumer Defensive': 'Consumo Básico',
    'Energy': 'Energía',
    'Industrials': 'Industrial',
    'Communication Services': 'Comunicación',
    'Utilities': 'Utilities',
    'Real Estate': 'Inmobiliario',
    'Basic Materials': 'Materiales',
  };
  return map[sector] || 'Otro';
}

function yahooCountryToApp(country) {
  const map = {
    'United States': '🇺🇸 EEUU',
    'Spain': '🇪🇸 España',
    'Germany': '🇩🇪 Alemania',
    'France': '🇫🇷 Francia',
    'United Kingdom': '🇬🇧 Reino Unido',
    'Netherlands': '🇳🇱 Países Bajos',
    'Switzerland': '🇨🇭 Suiza',
    'Italy': '🇮🇹 Italia',
    'Sweden': '🇸🇪 Suecia',
    'Denmark': '🇩🇰 Dinamarca',
    'China': '🇨🇳 China',
    'Japan': '🇯🇵 Japón',
    'India': '🇮🇳 India',
    'Brazil': '🇧🇷 Brasil',
    'Canada': '🇨🇦 Canadá',
  };
  return map[country] || '🏗 Otro';
}

/** Configuración global de Chart.js para tema oscuro/claro */
function getChartDefaults() {
  const isDark = APP.theme === 'dark';
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue('--accent').trim() || '#c9a84c';
  const hex = accent.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) || 201;
  const g = parseInt(hex.slice(2, 4), 16) || 168;
  const b = parseInt(hex.slice(4, 6), 16) || 76;

  if (typeof Chart !== 'undefined') {
    Chart.defaults.plugins.tooltip.backgroundColor = isDark ? 'rgba(22,26,35,0.96)' : 'rgba(255,255,255,0.97)';
    Chart.defaults.plugins.tooltip.titleColor      = isDark ? '#e8eaf0' : '#1a1d24';
    Chart.defaults.plugins.tooltip.bodyColor       = isDark ? '#9ca3af' : '#4a5568';
    Chart.defaults.plugins.tooltip.borderColor     = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)';
    Chart.defaults.plugins.tooltip.borderWidth     = 1;
    Chart.defaults.plugins.tooltip.padding         = 10;
    Chart.defaults.plugins.tooltip.cornerRadius    = 8;
  }

  return {
    gridColor:  isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    textColor:  isDark ? '#6b7585' : '#8a90a0',
    fontFamily: cs.getPropertyValue('--font-sans').trim() || 'Inter, system-ui, sans-serif',
    accent,
    accentFill: `rgba(${r},${g},${b},0.09)`,
  };
}
