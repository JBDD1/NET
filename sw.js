'use strict';

// El build lo sustituye por un nombre derivado del hash del contenido de
// dist/ (ver el plugin finova-build-scripts en vite.config.js). Dejarlo como
// una constante a mano era el fallo que más caro salía: si un despliegue se
// olvidaba de subir el número, sw.js quedaba byte-idéntico, el navegador no
// detectaba ninguna actualización, 'activate' no borraba nada y el usuario
// seguía con la aplicación anterior indefinidamente.
//
// El valor literal de aquí es el que se usa en desarrollo, donde no hay build.
const CACHE_NAME = 'finova-v27'; /* __FINOVA_CACHE_NAME__ */
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
  // style.css NO va aquí: es el único asset de esta lista que pasa por el
  // pipeline normal de Rollup (vite.config.js), que le añade un hash al
  // nombre de fichero en producción (p.ej. /assets/DIuZ1M_q.css) — el path
  // literal './style.css' ya no existe en el build y cache.add() fallaría
  // con un 404 real en cada instalación. El handler de 'fetch' de abajo ya
  // cachea cualquier recurso la primera vez que se pide de verdad, así que
  // el CSS con hash se cachea igualmente en la primera visita online.
  './src/core/script.js',
  './src/core/ai.js',
  './src/sections/dashboard.js',
  './src/sections/transactions.js',
  './src/sections/recurring.js',
  './src/sections/trips.js',
  './src/sections/networth.js',
  './src/sections/portfolio.js',
  './src/sections/goals.js',
  './src/sections/bizums.js',
  './src/sections/fiscal.js',
  './src/sections/simulator.js',
  './src/utils/pdf.js',
  './src/data/faq.js',
  './faq.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './icon-152.png',
  './icon-120.png',
  './icon-32.png',
  './icon-16.png',
];

// Optional assets — load after install; failures are logged but never block the SW.
const DEFERRED_ASSETS = [
  './src/utils/ticker-db.js',
  './src/utils/bank-connect.js',
  './src/utils/onboarding.js',
  './src/utils/tests.js',
  // staking.js ya no se carga en el arranque (se trae al pulsar la pestaña de
  // Staking). Se precachea aquí, fuera de la ruta crítica, para que la
  // pestaña siga funcionando sin conexión aunque no se haya abierto antes.
  './src/sections/staking.js',
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

/**
 * ¿Es una petición de documento HTML?
 *
 * Importa porque el HTML es el único recurso que NO puede servirse de caché
 * primero. index.html es lo que dice qué scripts cargar: si se sirve una
 * copia vieja, el navegador pide los scripts viejos y la aplicación entera
 * se queda en la versión anterior, aunque el servidor ya tenga la nueva.
 * Antes de esto, `cached || network` era caché primero para TODO.
 */
function _isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  const ruta = new URL(request.url).pathname;
  return ruta.endsWith('/') || ruta.endsWith('.html');
}

/**
 * HTML: red primero, caché como respaldo.
 *
 * Al revés que el resto. Si hay red se usa la versión del servidor y se
 * actualiza la copia; si no hay, se sirve la copia y la aplicación sigue
 * funcionando sin conexión, que es para lo que existe este service worker.
 */
async function _htmlNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
    }
    return response;
  } catch (_) {
    // ignoreSearch: la petición puede llevar ?v= o una query de campaña que
    // la copia precacheada no tiene.
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response(OFFLINE_PAGE, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (_isApiRequest(event.request.url)) {
    event.respondWith(_networkThenCacheApi(event.request));
    return;
  }
  if (_isHtmlRequest(event.request)) {
    event.respondWith(_htmlNetworkFirst(event.request));
    return;
  }
  event.respondWith(
    // ignoreSearch: el build añade ?v=<hash> a las etiquetas <script> para
    // romper la caché del navegador, pero la lista de precache de arriba
    // guarda las rutas sin query. Sin esto, cada script precacheado sería un
    // fallo de caché y la primera carga sin conexión quedaría rota.
    //
    // No reintroduce el problema de servir algo viejo: cada build genera un
    // CACHE_NAME distinto (lo inyecta vite.config.js), así que en cada
    // despliegue la caché vieja se borra entera en 'activate'.
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      // 'network' es una Promise, y una Promise siempre es truthy — un
      // "cached || network || fallback" nunca llegaría al fallback (queda
      // como código muerto) y, si el fetch falla, event.respondWith recibe
      // directamente null en vez del OFFLINE_PAGE. Por eso el fallback vive
      // dentro del .catch() de la propia promesa de red, no como tercer
      // operando del ||.
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
      return cached || network;
    })
  );
});
