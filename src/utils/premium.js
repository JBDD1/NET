/* ═══════════════════════════════════════════════════════════════
   FINOVA — premium.js
   Microinteracciones y detalles de calidad premium.
   Cargado antes de dashboard.js; no depende de ningún otro módulo.
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── KPI counter animation ────────────────────────────────────────
   Anima el valor numérico de un elemento desde su valor anterior
   hasta el nuevo. Usa easeOutCubic para sensación de peso físico.
   El valor anterior se guarda en data-anim-raw para el siguiente ciclo.
─────────────────────────────────────────────────────────────────── */
function _animNum(el, rawTarget, formatter, duration) {
  if (!el) return;
  const prev = parseFloat(el.dataset.animRaw ?? 0) || 0;
  el.dataset.animRaw = rawTarget;
  if (Math.abs(prev - rawTarget) < 0.005) {
    el.textContent = formatter(rawTarget);
    return;
  }
  const t0 = performance.now();
  (function tick(t) {
    const p    = Math.min((t - t0) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);         // easeOutCubic
    el.textContent = formatter(prev + (rawTarget - prev) * ease);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ── Haptic feedback (solo móvil) ─────────────────────────────── */
function _haptic(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {}
}

/* ── Chart.js tooltip global ─────────────────────────────────── */
function _applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  const style = getComputedStyle(document.documentElement);
  const get   = prop => style.getPropertyValue(prop).trim();
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: get('--bg-elevated')   || '#1f1b15',
    borderColor:     get('--border-default') || 'rgba(212,176,120,0.20)',
    borderWidth:     1,
    titleColor:      get('--text-primary')   || '#ece2cb',
    bodyColor:       get('--text-secondary') || '#968a72',
    padding:         { x: 12, y: 9 },
    cornerRadius:    8,
    titleFont:       { family: 'Inter, system-ui, sans-serif', size: 12, weight: '600' },
    bodyFont:        { family: 'Inter, system-ui, sans-serif', size: 12 },
    boxPadding:      5,
    usePointStyle:   true,
    caretSize:       5,
    displayColors:   true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _applyChartDefaults);
} else {
  _applyChartDefaults();
}
