'use strict';

const CACHE_NAME = 'finova-v2';
const API_CACHE  = 'finova-api-v1';
const API_TTL    = 3_600_000; // 1 hour in ms
const API_PATHS  = ['/api/yahoo', '/api/fx'];

function _isApiRequest(url) {
  return API_PATHS.some(p => url.includes(p));
}

async function _networkThenCacheApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      cache.put(request.url + '__ts', new Response(String(Date.now())));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (!cached) {
      return new Response(JSON.stringify({ error: 'offline' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }
    const tsRes = await cache.match(request.url + '__ts');
    if (tsRes) {
      const age = Date.now() - parseInt(await tsRes.text());
      if (age > API_TTL) {
        // Stale but serve anyway — better than nothing when offline
        const stale = cached.clone();
        return new Response(stale.body, {
          status: stale.status,
          headers: { ...Object.fromEntries(stale.headers), 'X-Finova-Stale': '1' },
        });
      }
    }
    return cached;
  }
}

const CRITICAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './src/core/script.js',
  './src/core/ai.js',
  './src/sections/dashboard.js',
  './src/sections/transactions.js',
  './src/sections/recurring.js',
  './src/sections/networth.js',
  './src/sections/portfolio.js',
  './src/sections/goals.js',
  './src/sections/bizums.js',
  './src/sections/fiscal.js',
  './src/sections/simulator.js',
  './src/utils/pdf.js',
  './manifest.json',
  './icon.svg',
];

// Optional assets — load after install; failures are logged but never block the SW.
const DEFERRED_ASSETS = [
  './src/utils/ticker-db.js',
  './src/utils/bank-connect.js',
  './src/utils/onboarding.js',
  './src/utils/tests.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        CRITICAL_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Critical asset failed to cache:', url, err.message))
        )
      ))
      .then(() => {
        self.skipWaiting();
        // Cache optional assets in the background — failures are non-fatal
        caches.open(CACHE_NAME).then(cache =>
          Promise.allSettled(
            DEFERRED_ASSETS.map(url =>
              cache.add(url).catch(err => console.warn('[SW] Deferred asset not cached:', url, err.message))
            )
          )
        );
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k !== API_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Finova — Sin conexión</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;
         font-family:'Inter',system-ui,sans-serif;padding:24px;text-align:center;
         background:var(--bg);color:var(--fg);transition:none}
    :root{--bg:#15110c;--fg:#ece2cb;--accent:#a8803e;--btn-fg:#15110c}
    .logo{font-size:32px;font-weight:700;letter-spacing:-0.04em;color:var(--accent);margin-bottom:8px}
    .logo span{color:var(--fg)}
    h1{font-size:20px;font-weight:600;margin-bottom:8px;color:var(--fg)}
    p{font-size:14px;opacity:.55;max-width:340px;line-height:1.6;margin-bottom:28px}
    button{background:var(--accent);color:var(--btn-fg);border:none;padding:10px 24px;border-radius:8px;
           font-size:14px;font-weight:600;cursor:pointer;opacity:1}
    button:hover{opacity:.85}
  </style>
</head>
<body>
  <div class="logo">F<span>inova</span></div>
  <h1>Sin conexión</h1>
  <p>No hay conexión a internet. Tus datos locales siguen disponibles — vuelve a cargar cuando recuperes la conexión.</p>
  <button onclick="location.reload()">Reintentar</button>
  <script>
    // Theme palette map — mirrors CSS variable values per variant/theme combination
    var P = {
      'obsidian-brass':    { dark:  ['#0d0c0a','#ece2cb','#d4a960','#0d0c0a'],
                             light: ['#f5ede4','#15110c','#a8803e','#fff'] },
      'linen-editorial':   { dark:  ['#14110d','#ebe5d6','#c75555','#14110d'],
                             light: ['#ebe5d6','#1c1814','#7a2b2b','#f6f1e3'] },
      'midnight-emerald':  { dark:  ['#08130f','#e6dcc5','#d4b878','#08130f'],
                             light: ['#ede8db','#0d2620','#b8924a','#fff'] },
      'soft-mono':         { dark:  ['#070707','#f3f3f0','#ff6a45','#070707'],
                             light: ['#f3f3f0','#0a0a0a','#ff5530','#fff'] },
      'terracotta-warmth': { dark:  ['#1a1310','#efe7d8','#e07a52','#1a1310'],
                             light: ['#efe7d8','#241a13','#b8593a','#f9f3e6'] },
    };
    try {
      var d = JSON.parse(localStorage.getItem('finova_data_v1') || '{}');
      var v = d.variant || 'obsidian-brass';
      var t = d.theme   || 'dark';
      var c = (P[v] || P['obsidian-brass'])[t] || P['obsidian-brass'].dark;
      var r = document.documentElement.style;
      r.setProperty('--bg',      c[0]);
      r.setProperty('--fg',      c[1]);
      r.setProperty('--accent',  c[2]);
      r.setProperty('--btn-fg',  c[3]);
    } catch(e) {}
  <\/script>
</body>
</html>`;

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (_isApiRequest(event.request.url)) {
    event.respondWith(_networkThenCacheApi(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => null);
      return cached || network || new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    })
  );
});
