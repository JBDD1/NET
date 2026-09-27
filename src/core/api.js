'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — Centralized API Client
   Single entry point for all server requests:
   · Auto-attaches Firebase Bearer token (via _getAuthHeader from auth.js)
   · Centralized 429 handling with user-visible toast
   · Typed methods per endpoint so callers never construct URLs manually
   Exposes: api (global object), _apiRequest (helper for special cases)
═══════════════════════════════════════════════════════════════ */

var _SERVER_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL != null)
  ? (import.meta.env.VITE_SERVER_URL || '')
  : (window.location.hostname === 'localhost' ? 'http://localhost:3000' : '');

async function _apiRequest(path, opts, withAuth) {
  opts     = opts     || {};
  withAuth = withAuth || false;

  const headers = Object.assign({}, opts.headers || {});
  if (withAuth && typeof _getAuthHeader === 'function') {
    Object.assign(headers, await _getAuthHeader());
  }

  const res = await fetch(_SERVER_URL + path, Object.assign({}, opts, { headers }));

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
    var msg = 'Demasiadas peticiones. Espera ' +
      (retryAfter < 120 ? retryAfter + 's' : Math.ceil(retryAfter / 60) + ' min') + '.';
    try { var d = await res.clone().json(); if (d.error) msg = d.error; } catch (_) {}
    if (typeof showToast === 'function') showToast(msg, 'error');
  } else if (res.status >= 500) {
    // El servidor nunca manda detalles técnicos en un 5xx (ver _serverError
    // en server.cjs) — el campo "error" del cuerpo ya es un mensaje seguro
    // y accionable, se muestra tal cual en vez de quedarse solo en consola.
    var errMsg = 'Ha ocurrido un error inesperado. Inténtalo de nuevo.';
    try { var d5 = await res.clone().json(); if (d5.error) errMsg = d5.error; } catch (_) {}
    if (typeof showToast === 'function') showToast(errMsg, 'error');
  }

  return res;
}

function _jsonBody(body) {
  return { 'Content-Type': 'application/json', body: JSON.stringify(body) };
}

var api = {
  /* ── Market data (no auth — public endpoints) ── */
  yahoo:     function(ticker, range) {
    return _apiRequest('/api/yahoo?ticker=' + encodeURIComponent(ticker) + '&range=' + (range || '1d'));
  },
  yahooInfo: function(ticker) {
    return _apiRequest('/api/yahoo-info?ticker=' + encodeURIComponent(ticker));
  },
  quotes:    function(symbols) {
    return _apiRequest('/api/quotes?symbols=' + symbols.map(encodeURIComponent).join(','));
  },
  exchange:  function() {
    return _apiRequest('/api/exchange');
  },

  /* ── AI ── */
  aiStatus: function() {
    return _apiRequest('/api/ai-status', {}, true);
  },
  ai: function(body) {
    return _apiRequest('/api/ai', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }, true);
  },

  /* ── User data ── */
  userData: {
    get: function(uid) {
      var path = '/api/user-data' + (uid ? '?uid=' + encodeURIComponent(uid) : '');
      return _apiRequest(path, {}, true);
    },
    save: function(body) {
      return _apiRequest('/api/user-data', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }, true);
    },
  },

  userMeta: function(body) {
    return _apiRequest('/api/user-meta', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }, true);
  },

  /* ── Sync ── */
  sync: {
    upload: function(body) {
      return _apiRequest('/api/sync-upload', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }, true);
    },
    download: function(code) {
      return _apiRequest('/api/sync-download?code=' + encodeURIComponent(code), {}, true);
    },
  },

  /* ── Open Banking (GoCardless) ── */
  bank: {
    institutions: function(country) {
      return _apiRequest('/api/bank/institutions?country=' + encodeURIComponent(country), {}, true);
    },
    connect: function(body) {
      return _apiRequest('/api/bank/connect', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }, true);
    },
    requisition: function(id) {
      return _apiRequest('/api/bank/requisition?id=' + encodeURIComponent(id), {}, true);
    },
    import: function(body) {
      return _apiRequest('/api/bank/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }, true);
    },
  },
};
