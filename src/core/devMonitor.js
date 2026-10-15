/* ═══════════════════════════════════════════════════════════════
   FINOVA — devMonitor.js
   Panel de monitorización SOLO para desarrollo local, y solo para los
   correos en DEV_MONITOR_EMAILS (ver auth.js → _maybeStartDevMonitor).
   Se carga de forma perezosa — nadie más descarga este archivo nunca.

   Arquitectura (pensada para crecer sin reescribirse):
     capturador → _report(event) → [sinks]
   Cada capturador (errores, red, vitals…) es independiente y solo sabe
   llamar a _report(). Añadir una fuente nueva = una función más que
   llama a _report(), sin tocar nada existente. Los "sinks" (consola,
   panel visual, y cualquiera que se registre con DevMonitor.addSink)
   deciden qué hacer con cada evento — añadir un destino nuevo (p.ej.
   mandarlo al servidor en vez de solo mostrarlo) tampoco toca los
   capturadores. Todo en memoria, con buffer acotado: nunca escribe en
   localStorage ni llama a ningún endpoint por su cuenta.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  if (window.__finovaDevMonitorStarted) return; // idempotente
  window.__finovaDevMonitorStarted = true;

  const MAX_EVENTS = 300;
  const events = [];
  const sinks = [];
  const metrics = { ttfb: null, fcp: null, lcp: null, cls: 0, inp: null, fps: null, memMB: null };

  let panelEl = null, badgeEl = null, logEl = null, metricsEl = null;
  let unseenCount = 0;

  /* ── Núcleo: reportar un evento a todos los sinks ────────────── */
  function _report(evt) {
    evt.ts = evt.ts || Date.now();
    events.push(evt);
    if (events.length > MAX_EVENTS) events.shift();
    sinks.forEach(fn => { try { fn(evt); } catch (_) {} });
  }

  function _consoleSink(evt) {
    const tag = `[DevMonitor:${evt.kind}]`;
    if (evt.level === 'error') console.error(tag, evt.message, evt.detail || '');
    else if (evt.level === 'warn') console.warn(tag, evt.message, evt.detail || '');
  }

  /* ── Capturador: errores de runtime y recursos ───────────────── */
  function _captureErrors() {
    window.addEventListener('error', e => {
      // Error de JS (tiene e.error) vs fallo de carga de recurso (img/script/link)
      if (e.error || e.message) {
        _report({
          kind: 'js-error', level: 'error',
          message: e.message || 'Error desconocido',
          detail: { file: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack },
        });
      } else if (e.target && e.target !== window) {
        const el = e.target;
        _report({
          kind: 'resource-error', level: 'error',
          message: `No se pudo cargar ${el.tagName?.toLowerCase() || '?'}`,
          detail: { src: el.src || el.href || '' },
        });
      }
    }, true); // capture:true — los fallos de recursos no burbujean

    window.addEventListener('unhandledrejection', e => {
      _report({
        kind: 'promise-rejection', level: 'error',
        message: e.reason?.message || String(e.reason),
        detail: { stack: e.reason?.stack },
      });
    });
  }

  /* ── Capturador: console.error / console.warn ya existentes ─── */
  function _captureConsole() {
    ['error', 'warn'].forEach(level => {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        _report({
          kind: 'console', level,
          message: args.map(a => (a instanceof Error ? a.message : String(a))).join(' '),
        });
        original(...args);
      };
    });
  }

  /* ── Capturador: peticiones fetch fallidas o con status de error ── */
  function _captureFetch() {
    if (typeof window.fetch !== 'function') return;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const t0 = performance.now();
      try {
        const res = await original(...args);
        if (!res.ok) {
          _report({
            kind: 'fetch-error', level: 'warn',
            message: `${res.status} ${res.statusText} — ${url}`,
            detail: { ms: Math.round(performance.now() - t0) },
          });
        }
        return res;
      } catch (err) {
        _report({ kind: 'fetch-error', level: 'error', message: `Fetch fallido — ${url}`, detail: { error: err.message } });
        throw err;
      }
    };
  }

  /* ── Capturador: Web Vitals reales (sin librería externa) ────── */
  function _captureWebVitals() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) { metrics.ttfb = Math.round(nav.responseStart); _renderMetrics(); }
    } catch (_) {}

    _observe('paint', list => {
      const fcp = list.getEntries().find(e => e.name === 'first-contentful-paint');
      if (fcp) { metrics.fcp = Math.round(fcp.startTime); _renderMetrics(); }
    });

    _observe('largest-contentful-paint', list => {
      const last = list.getEntries().at(-1);
      if (last) { metrics.lcp = Math.round(last.startTime); _renderMetrics(); }
    });

    let clsValue = 0;
    _observe('layout-shift', list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
      metrics.cls = Math.round(clsValue * 1000) / 1000;
      _renderMetrics();
    });

    _observe('event', list => {
      for (const entry of list.getEntries()) {
        const dur = Math.round(entry.duration);
        if (metrics.inp === null || dur > metrics.inp) { metrics.inp = dur; _renderMetrics(); }
      }
    }, { durationThreshold: 40 });
  }

  function _observe(type, cb, extraOpts) {
    try {
      const po = new PerformanceObserver(cb);
      po.observe({ type, buffered: true, ...(extraOpts || {}) });
    } catch (_) {} // tipo no soportado por este navegador — se omite esa métrica
  }

  /* ── Capturador: FPS y memoria JS en vivo (muestreo cada 1s) ──── */
  function _captureLiveStats() {
    let frames = 0;
    let lastSample = performance.now();
    function tick(now) {
      frames++;
      if (now - lastSample >= 1000) {
        metrics.fps = frames;
        if (performance.memory) metrics.memMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
        frames = 0;
        lastSample = now;
        _renderMetrics();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ── Umbrales oficiales Core Web Vitals → color semántico ─────── */
  const THRESHOLDS = {
    ttfb: [800, 1800], fcp: [1800, 3000], lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500],
  };
  function _rating(key, value) {
    if (value === null || value === undefined) return 'pending';
    const [good, poor] = THRESHOLDS[key] || [];
    if (good === undefined) return 'neutral';
    return value <= good ? 'good' : (value <= poor ? 'mid' : 'bad');
  }

  /* ── Panel visual ─────────────────────────────────────────────── */
  function _injectStyles() {
    const css = `
      #fdm-toggle { position:fixed; right:18px; bottom:18px; z-index:99999; width:44px; height:44px;
        border-radius:50%; border:1px solid var(--border-default,#8883); background:var(--bg-elevated,#1f1b15);
        color:var(--text-primary,#ece2cb); font:600 13px var(--font-sans,sans-serif); cursor:pointer;
        box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.3)); display:flex; align-items:center; justify-content:center; }
      #fdm-toggle .fdm-badge { position:absolute; top:-4px; right:-4px; min-width:16px; height:16px; padding:0 4px;
        border-radius:99px; background:var(--down,#c83434); color:#fff; font-size:10px; line-height:16px; text-align:center; display:none; }
      #fdm-panel { position:fixed; right:18px; bottom:70px; z-index:99999; width:340px; max-height:70vh;
        display:none; flex-direction:column; background:var(--bg-elevated,#1f1b15); color:var(--text-primary,#ece2cb);
        border:1px solid var(--border-default,#8883); border-radius:var(--r-lg,16px); box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.3));
        font:12px/1.4 var(--font-sans,sans-serif); overflow:hidden; }
      #fdm-panel.open { display:flex; }
      #fdm-head { display:flex; align-items:center; justify-content:space-between; padding:10px 12px;
        border-bottom:1px solid var(--border-default,#8883); font-weight:600; }
      #fdm-head button { background:none; border:0; color:var(--text-secondary,#968a72); cursor:pointer; font:inherit; }
      #fdm-metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; padding:10px 12px; border-bottom:1px solid var(--border-default,#8883); }
      .fdm-m { text-align:center; }
      .fdm-m-v { font-weight:700; font-variant-numeric:tabular-nums; }
      .fdm-m-l { color:var(--text-secondary,#968a72); font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
      .fdm-m-v.good { color:var(--up,#4ec988); } .fdm-m-v.mid { color:var(--accent,#d4a960); } .fdm-m-v.bad { color:var(--down,#c83434); }
      #fdm-log { overflow-y:auto; flex:1; }
      .fdm-e { padding:7px 12px; border-bottom:1px solid var(--border-default,#8883); word-break:break-word; }
      .fdm-e-k { color:var(--text-secondary,#968a72); font-size:10px; text-transform:uppercase; }
      .fdm-e.error .fdm-e-k { color:var(--down,#c83434); }
      .fdm-e.warn .fdm-e-k { color:var(--accent,#d4a960); }
      #fdm-empty { padding:16px 12px; color:var(--text-secondary,#968a72); text-align:center; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function _buildPanel() {
    const toggle = document.createElement('button');
    toggle.id = 'fdm-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Monitor de desarrollo Finova');
    toggle.innerHTML = '🛠<span class="fdm-badge" id="fdm-badge"></span>';

    panelEl = document.createElement('div');
    panelEl.id = 'fdm-panel';
    panelEl.innerHTML = `
      <div id="fdm-head">
        <span>Dev Monitor</span>
        <div>
          <button type="button" id="fdm-clear">Limpiar</button>
          <button type="button" id="fdm-close">✕</button>
        </div>
      </div>
      <div id="fdm-metrics"></div>
      <div id="fdm-log"><div id="fdm-empty">Sin eventos todavía.</div></div>
    `;

    document.body.appendChild(toggle);
    document.body.appendChild(panelEl);

    badgeEl   = toggle.querySelector('#fdm-badge');
    metricsEl = panelEl.querySelector('#fdm-metrics');
    logEl     = panelEl.querySelector('#fdm-log');

    toggle.addEventListener('click', () => {
      panelEl.classList.toggle('open');
      if (panelEl.classList.contains('open')) { unseenCount = 0; _renderBadge(); }
    });
    panelEl.querySelector('#fdm-close').addEventListener('click', () => panelEl.classList.remove('open'));
    panelEl.querySelector('#fdm-clear').addEventListener('click', () => {
      events.length = 0;
      logEl.innerHTML = '<div id="fdm-empty">Sin eventos todavía.</div>';
    });
  }

  function _renderBadge() {
    if (!badgeEl) return;
    badgeEl.style.display = unseenCount > 0 ? 'block' : 'none';
    badgeEl.textContent = unseenCount > 99 ? '99+' : String(unseenCount);
  }

  function _renderMetrics() {
    if (!metricsEl) return;
    const rows = [
      ['TTFB', metrics.ttfb, 'ms', 'ttfb'],
      ['FCP',  metrics.fcp,  'ms', 'fcp'],
      ['LCP',  metrics.lcp,  'ms', 'lcp'],
      ['CLS',  metrics.cls,  '',   'cls'],
      ['INP',  metrics.inp,  'ms', 'inp'],
      ['FPS',  metrics.fps,  '',   null],
    ];
    metricsEl.innerHTML = rows.map(([label, value, unit, key]) => {
      const rating = key ? _rating(key, value) : 'neutral';
      const shown = value === null || value === undefined ? '—' : `${value}${unit}`;
      return `<div class="fdm-m"><div class="fdm-m-v ${rating}">${shown}</div><div class="fdm-m-l">${label}</div></div>`;
    }).join('');
  }

  function _panelSink(evt) {
    if (!logEl) return;
    const empty = logEl.querySelector('#fdm-empty');
    if (empty) empty.remove();
    const row = document.createElement('div');
    row.className = `fdm-e ${evt.level}`;
    const time = new Date(evt.ts).toLocaleTimeString('es-ES');
    row.innerHTML = `<span class="fdm-e-k">${evt.kind} · ${time}</span><br>${_escape(evt.message)}`;
    logEl.prepend(row);
    while (logEl.children.length > MAX_EVENTS) logEl.lastChild.remove();

    if (!panelEl.classList.contains('open')) { unseenCount++; _renderBadge(); }
  }

  function _escape(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /* ── API pública para extender el monitor sin tocar este archivo ── */
  window.DevMonitor = {
    addSink: fn => { if (typeof fn === 'function') sinks.push(fn); },
    report:  (kind, message, detail) => _report({ kind, level: 'info', message, detail }),
    getEvents: () => events.slice(),
    getMetrics: () => ({ ...metrics }),
  };

  /* ── Arranque ─────────────────────────────────────────────────── */
  window.initDevMonitor = function initDevMonitor() {
    sinks.push(_consoleSink, _panelSink);
    _injectStyles();
    _buildPanel();
    _renderMetrics();
    _captureErrors();
    _captureConsole();
    _captureFetch();
    _captureWebVitals();
    _captureLiveStats();
    console.info('[Finova DevMonitor] Activo — solo visible para ti, solo en local.');
  };
})();
