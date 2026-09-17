const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

/* ─── Firebase Admin SDK (opcional) ─────────────────────────── */
// Cuando las 3 vars de entorno están configuradas, añade verificación de
// revocación de tokens (checkRevoked=true). Sin ellas, el servidor sigue
// funcionando con su propia verificación RS256 (igual de segura, sin revocación).
let _adminSDK   = null;
let _adminReady = false;
try {
  if (process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY) {
    const _fbAdmin = require('firebase-admin');
    if (!_fbAdmin.apps.length) {
      _fbAdmin.initializeApp({
        credential: _fbAdmin.credential.cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }
    _adminSDK   = _fbAdmin;
    _adminReady = true;
    console.log('[FINOVA] Firebase Admin SDK inicializado — revocación de tokens activa');
  } else {
    console.log('[FINOVA] Firebase Admin no configurado — verificación JWT propia sin revocación (válido en dev)');
  }
} catch (e) {
  console.warn('[FINOVA] Firebase Admin SDK no disponible:', e.message);
}

const PORT = 3000;
const ROOT = __dirname;
const SYNC_DIR       = path.join(ROOT, 'data', 'sync');
const USERS_DIR      = path.join(ROOT, 'data', 'users');
const ANALYTICS_FILE = path.join(ROOT, 'data', 'analytics.json');
const WAITLIST_FILE  = path.join(ROOT, 'data', 'waitlist.json');
if (!fs.existsSync(SYNC_DIR))  fs.mkdirSync(SYNC_DIR,  { recursive: true });
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });

// ─── Admin ────────────────────────────────────────────────────
// Configura con variable de entorno: FINOVA_ADMIN_EMAILS=correo1@x.com,correo2@x.com
// No hay valor por defecto — el email de admin no debe estar en el código fuente.
const ADMIN_EMAILS = (process.env.FINOVA_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// ─── Proxy secret ─────────────────────────────────────────────
// When FINOVA_PROXY_SECRET is set, all /api/* requests must carry the
// x-finova-proxy header with the matching value. This ensures traffic
// arrives through the Vercel proxy and not directly from the internet.
const _PROXY_SECRET = process.env.FINOVA_PROXY_SECRET || '';
const _EXTRA_ADMINS_FILE = path.join(ROOT, 'data', 'extra_admins.json');
let _extraAdminsCache    = { emails: [], mtime: 0 };
function _extraAdmins() {
  try {
    const mtime = fs.statSync(_EXTRA_ADMINS_FILE).mtimeMs;
    if (mtime !== _extraAdminsCache.mtime) {
      const parsed = JSON.parse(fs.readFileSync(_EXTRA_ADMINS_FILE, 'utf8'));
      _extraAdminsCache = { emails: Array.isArray(parsed) ? parsed : [], mtime };
    }
  } catch { _extraAdminsCache = { emails: [], mtime: 0 }; }
  return _extraAdminsCache.emails;
}

function _isAdminUid(uid) {
  if (!uid || !_UID_RE.test(uid)) return false;
  const meta = _readMeta(uid);
  if (!meta) return false;
  const email = (meta.email || '').toLowerCase();
  return ADMIN_EMAILS.includes(email) || _extraAdmins().includes(email);
}
function _metaPath(uid) { return path.join(USERS_DIR, `${uid}.meta.json`); }
function _readMeta(uid) {
  try { return JSON.parse(fs.readFileSync(_metaPath(uid), 'utf8')); } catch { return null; }
}
function _blockedPath(uid) { return path.join(USERS_DIR, `${uid}.blocked`); }
function _isBlocked(uid)   { return fs.existsSync(_blockedPath(uid)); }

// ─── Roles RBAC ──────────────────────────────────────────────
// Roles: 'free' (default), 'premium', 'admin'
// Stored in data/roles.json as { uid: role }
// Admin role is also derived from _isAdminUid() (email-based)
const _ROLES_FILE = path.join(ROOT, 'data', 'roles.json');

function _getRoles() {
  try { return JSON.parse(fs.readFileSync(_ROLES_FILE, 'utf8')); }
  catch { return {}; }
}

function _getUserRole(uid) {
  if (!uid) return 'free';
  if (_isAdminUid(uid)) return 'admin';
  return _getRoles()[uid] || 'free';
}

function _setUserRole(uid, role) {
  if (!_UID_RE.test(uid)) throw new Error('UID inválido');
  if (!['free', 'premium'].includes(role)) throw new Error('Rol inválido (free|premium)');
  const roles = _getRoles();
  if (role === 'free') delete roles[uid];
  else roles[uid] = role;
  fs.writeFileSync(_ROLES_FILE, JSON.stringify(roles, null, 2), 'utf8');
}

// Returns false and sends 403 if the verified uid doesn't have the required role.
// LEVELS: free=0, premium=1, admin=2
const _ROLE_LEVELS = { free: 0, premium: 1, admin: 2 };
function _requireRole(uid, role, req, res) {
  const userRole  = _getUserRole(uid);
  const userLevel = _ROLE_LEVELS[userRole] || 0;
  const needLevel = _ROLE_LEVELS[role]     || 0;
  if (userLevel < needLevel) {
    res.writeHead(403, _apiHeaders(req));
    res.end(JSON.stringify({
      error: `Acceso denegado. Se requiere plan ${role}.`,
      requiredRole: role, currentRole: userRole,
    }));
    return false;
  }
  return true;
}

// ─── Clave IA del servidor ────────────────────────────────────
// Pega aquí tu API Key de Claude para que el Asesor IA funcione
// sin que los usuarios necesiten configurar nada.
// También puedes usar la variable de entorno: FINOVA_CLAUDE_KEY
const FINOVA_AI_KEY   = process.env.FINOVA_CLAUDE_KEY || '';
const FINOVA_GROQ_KEY = process.env.FINOVA_GROQ_KEY   || '';
// Comma-separated list of allowed origins; localhost:PORT and Vite dev (5173) added by default.
const _ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  'http://localhost:5173',
  ...( process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean),
]);

function _corsOrigin(req) {
  const o = req?.headers?.origin || '';
  return _ALLOWED_ORIGINS.has(o) ? o : null;
}

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css',
  '.js':    'text/javascript',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff2': 'font/woff2',
};

// Archivos públicos servibles desde la raíz del proyecto (whitelist estricta).
// Cualquier otra ruta (server.cjs, .env*, data/, .git/, node_modules/, scripts/,
// package.json, vercel.json, *.md, etc.) responde 404 aunque exista en disco.
const _PUBLIC_ROOT_FILES = new Set([
  'index.html', 'landing.html', 'privacy.html', 'privacidad.html',
  'terms.html', 'terminos.html', 'style.css', 'landing.js',
  'manifest.json', 'robots.txt', 'sitemap.xml', 'sw.js', 'icon.svg',
  'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-64.png',
  'icon-120.png', 'icon-128.png', 'icon-152.png', 'icon-167.png',
  'icon-180.png', 'icon-192.png', 'icon-256.png', 'icon-512.png',
  'icon-1024.png',
]);

// ─── import.meta.env en desarrollo local sin Vite ──────────────
// server.cjs sirve src/**/*.js en crudo (sin pasar por Vite, igual que en
// producción los sirve vite.config.js ya transformados). Unos pocos archivos
// (auth.js, ai.js, api.js, portfolio.js) usan import.meta.env.VITE_* — un
// token que es un SyntaxError fuera de un módulo ES, se llegue a ejecutar o
// no. Se sustituye aquí por el valor literal de .env.development, igual que
// hace el plugin de Vite para el build de producción.
function _parseEnvFile(filePath) {
  const env = {};
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {}
  return env;
}
const _VITE_DEV_ENV = _parseEnvFile(path.join(ROOT, '.env.development'));
const _IMPORT_META_ENV_RE  = /import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g;
const _IMPORT_META_BARE_RE = /import\.meta\b/g;
function _stripImportMeta(code) {
  if (!code.includes('import.meta')) return code;
  return code
    .replace(_IMPORT_META_ENV_RE, (_, key) => JSON.stringify(_VITE_DEV_ENV[key] ?? ''))
    .replace(_IMPORT_META_BARE_RE, 'undefined');
}

/* ═══════════════════════════════════════════════════════════════
   SEGURIDAD — Headers HTTP y CSP
═══════════════════════════════════════════════════════════════ */
const _SEC = {
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
  // X-XSS-Protection omitted: deprecated, can introduce vulnerabilities in some browsers.
  // Strict-Transport-Security omitted: this server runs plain HTTP on localhost (TLS is
  // terminated by Railway/Vercel). Browsers ignore HSTS over HTTP, and including it here
  // would be misleading. HSTS is configured in vercel.json for the Vercel-hosted frontend.
  'Referrer-Policy':              'strict-origin-when-cross-origin',
  'Permissions-Policy':           'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), fullscreen=(self), picture-in-picture=(), interest-cohort=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy':   'same-origin',
};

// Content Security Policy — aplicado a respuestas HTML
const _CSP = [
  "default-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.gstatic.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://jbdd1.github.io",
  "connect-src 'self' " +
    "https://query1.finance.yahoo.com https://query2.finance.yahoo.com " +
    "https://open.er-api.com https://api.anthropic.com https://api.openai.com " +
    "https://generativelanguage.googleapis.com https://api.groq.com " +
    "https://identitytoolkit.googleapis.com https://securetoken.googleapis.com " +
    "https://www.googleapis.com https://*.firebaseapp.com https://*.firebase.com https://*.firebaseio.com",
  "frame-src https://*.firebaseapp.com https://accounts.google.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ');

// Headers base para todas las respuestas JSON de la API
// reqOrExtra: pass req (IncomingMessage) for dynamic origin reflection,
// or an extra-headers object for backward compat (no-arg calls default to localhost:PORT).
function _apiHeaders(reqOrExtra, extra) {
  const isReq = reqOrExtra != null && typeof reqOrExtra.socket !== 'undefined';
  const req   = isReq ? reqOrExtra : null;
  const e     = isReq ? (extra || null) : (reqOrExtra || null);
  const origin = _corsOrigin(req);
  return {
    'Content-Type':                'application/json',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Vary':                        'Origin',
    'Cache-Control':               'no-store, no-cache, must-revalidate, private',
    'Pragma':                      'no-cache',
    'Expires':                     '0',
    ...(e || {}),
    ..._SEC,
  };
}

/* ═══════════════════════════════════════════════════════════════
   RATE LIMITER — Token Bucket multi-dimensional
   Unifica: IP burst, UID daily quota, Groq global, anti-bruteforce
═══════════════════════════════════════════════════════════════ */

// ─── Core: Token Bucket ─────────────────────────────────────────
const _buckets = new Map(); // key → { tokens, lastRefill }

// Returns { ok, remaining, resetIn }. Consumes `cost` tokens if ok.
function _tokenBucket(key, capacity, refillRate, cost = 1) {
  const nowSec = Date.now() / 1000;
  let b = _buckets.get(key);
  if (!b) { b = { tokens: capacity, lastRefill: nowSec }; _buckets.set(key, b); }
  const elapsed = nowSec - b.lastRefill;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillRate);
  b.lastRefill = nowSec;
  if (b.tokens < cost) {
    return { ok: false, remaining: 0, resetIn: Math.ceil((cost - b.tokens) / refillRate) };
  }
  b.tokens -= cost;
  return { ok: true, remaining: Math.floor(b.tokens), resetIn: 0 };
}

// ─── Limit configuration ────────────────────────────────────────
const _LIMITS = {
  ai:           { byIP: { capacity: 15, refillRate: 0.25  }, byUID: { free: 5, premium: 50 }, global: { groqMinute: 25, groqDay: 12_000 } },
  quotes:       { byIP: { capacity: 60, refillRate: 1     } },
  userData:     { byIP: { capacity: 30, refillRate: 0.5   } },
  userDataPost: { byIP: { capacity: 30, refillRate: 0.5   } },
  syncDownload: { byIP: { capacity: 10, refillRate: 0.167 } },
  syncUpload:   { byIP: { capacity: 10, refillRate: 0.167 } },
  waitlist:     { byIP: { capacity: 5,  refillRate: 0.083 } },
  session:      { byIP: { capacity: 5,  refillRate: 0.083 } },
  admin:        { byIP: { capacity: 30, refillRate: 0.5   } },
  bank:         { byIP: { capacity: 10, refillRate: 0.167 } },
};

// ─── Anti-bruteforce ────────────────────────────────────────────
const _failedAttempts = new Map(); // ip → { count, lastAt, blockedUntil }
const _BRUTE_THRESHOLD  = 10;
const _BRUTE_WINDOW_MS  = 60_000;
const _BRUTE_BLOCK_BASE = 3_600_000; // 1h base, doubles per threshold overflow

function _recordFailedAttempt(ip) {
  const now = Date.now();
  let e = _failedAttempts.get(ip);
  if (!e || now - e.lastAt > _BRUTE_WINDOW_MS) {
    e = { count: 0, lastAt: now, blockedUntil: 0 };
    _failedAttempts.set(ip, e);
  }
  e.count++;
  e.lastAt = now;
  if (e.count >= _BRUTE_THRESHOLD) {
    const overflows = Math.floor(e.count / _BRUTE_THRESHOLD);
    const blockMs   = Math.min(_BRUTE_BLOCK_BASE * Math.pow(2, overflows - 1), 86_400_000);
    e.blockedUntil  = now + blockMs;
    console.warn(`[FINOVA/RateLimit] IP bloqueada: ${ip} (${e.count} intentos, ${Math.round(blockMs / 3600000)}h)`);
  }
}

function _isIPBlocked(ip) {
  const e = _failedAttempts.get(ip);
  if (!e || !e.blockedUntil) return false;
  if (Date.now() >= e.blockedUntil) { _failedAttempts.delete(ip); return false; }
  return true;
}

function _clearFailedAttempts(ip) { _failedAttempts.delete(ip); }

// ─── General rate limit check — RFC 6585 headers ────────────────
// Returns true if the request should proceed; false if 429 was sent.
function _checkRateLimit(req, res, endpoint) {
  const ip = _clientIp(req);
  if (_isIPBlocked(ip)) {
    res.writeHead(429, _apiHeaders(req, { 'Retry-After': '3600' }));
    res.end(JSON.stringify({ error: 'IP temporalmente bloqueada por exceso de errores. Inténtalo en 1 hora.' }));
    return false;
  }
  const cfg = _LIMITS[endpoint];
  if (!cfg?.byIP) return true;
  const { capacity, refillRate } = cfg.byIP;
  const result = _tokenBucket(`rl:${endpoint}:${ip}`, capacity, refillRate);
  if (!result.ok) {
    const retryAfter = Math.max(result.resetIn, 1);
    res.writeHead(429, _apiHeaders(req, {
      'X-RateLimit-Limit':     String(capacity),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset':     String(Math.floor(Date.now() / 1000) + result.resetIn),
      'Retry-After':           String(retryAfter),
    }));
    res.end(JSON.stringify({ error: 'Demasiadas peticiones. Espera unos segundos.' }));
    return false;
  }
  return true;
}

// ─── Groq global check (server key, atomic min+day) ─────────────
function _groqGlobalOk() {
  const lim  = _LIMITS.ai.global;
  const minR = _tokenBucket('groq:global:min', lim.groqMinute, lim.groqMinute / 60);
  if (!minR.ok) return false;
  const dayR = _tokenBucket('groq:global:day', lim.groqDay, lim.groqDay / 86400);
  if (!dayR.ok) {
    // Refund the minute token already consumed
    const b = _buckets.get('groq:global:min');
    if (b) b.tokens = Math.min(lim.groqMinute, b.tokens + 1);
    return false;
  }
  return true;
}

// ─── Persistence: AI daily quotas survive server restarts ────────
const RATELIMIT_FILE = path.join(ROOT, 'data', 'ratelimit.json');

function _saveRateLimits() {
  try {
    const aiUidBuckets = {};
    for (const [k, v] of _buckets) {
      if (k.startsWith('ai-uid:')) aiUidBuckets[k] = { tokens: v.tokens, lastRefill: v.lastRefill };
    }
    fs.writeFileSync(RATELIMIT_FILE, JSON.stringify({ aiUidBuckets, savedAt: Date.now() }), 'utf8');
  } catch {}
}

function _loadRateLimits() {
  try {
    const data = JSON.parse(fs.readFileSync(RATELIMIT_FILE, 'utf8'));
    if (Date.now() - (data.savedAt || 0) < 86_400_000) {
      for (const [k, v] of Object.entries(data.aiUidBuckets || {})) {
        _buckets.set(k, { tokens: Number(v.tokens) || 0, lastRefill: Number(v.lastRefill) || (Date.now() / 1000) });
      }
    }
  } catch {}
}
_loadRateLimits();

// ─── Cleanup: stale buckets + brute-force entries every 5 min ───
setInterval(() => {
  const now    = Date.now();
  const nowSec = now / 1000;
  for (const [k, v] of _buckets) {
    if (k.startsWith('ai-uid:')) { if (nowSec - v.lastRefill > 86400 * 7) _buckets.delete(k); }
    else                         { if (nowSec - v.lastRefill > 3600)       _buckets.delete(k); }
  }
  for (const [ip, e] of _failedAttempts) {
    if (now > Math.max(e.blockedUntil || 0, e.lastAt + _BRUTE_WINDOW_MS * 10)) _failedAttempts.delete(ip);
  }
}, 300_000).unref();

// ─── Persist AI daily quotas every 5 minutes ───────────────────
setInterval(_saveRateLimits, 300_000).unref();

function _clientIp(req) {
  return ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1')
    .split(',')[0].trim());
}

// ─── AI prompt helpers ────────────────────────────────────────
// Strip newlines and control chars from user-supplied strings before embedding
// them in the system prompt. Prevents indirect prompt injection (AI-03).
function _sanitizePromptStr(s, maxLen) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').trim().slice(0, maxLen || 80);
}
function _sanitizeNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function _fmtEuro(n) {
  return '€' + _sanitizeNum(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Builds the complete system prompt server-side from a validated structured snapshot.
// The instruction text is always server-controlled — clients can never inject instructions.
function _buildServerSystemPrompt(anonMode, snapshot) {
  let contextBlock;
  if (anonMode || !snapshot || typeof snapshot !== 'object') {
    contextBlock = `El usuario ha activado el modo anónimo: no tienes acceso a sus datos financieros. Responde preguntas generales de finanzas personales sin hacer referencia a cifras concretas del usuario.\n`;
  } else {
    const date      = _sanitizePromptStr(snapshot.date,  20) || new Date().toLocaleDateString('es-ES');
    const month     = _sanitizePromptStr(snapshot.month, 10);
    const patrimony = _sanitizeNum(snapshot.patrimony);
    const cash      = _sanitizeNum(snapshot.cashTotal);
    const inv       = _sanitizeNum(snapshot.investTotal);
    const alt       = _sanitizeNum(snapshot.altTotal);
    const prop      = _sanitizeNum(snapshot.propTotal);
    const propCount = Math.max(0, Math.floor(_sanitizeNum(snapshot.propCount)));
    const inc       = _sanitizeNum(snapshot.monthlyIncome);
    const exp       = _sanitizeNum(snapshot.monthlyExpenses);
    const divAnual  = _sanitizeNum(snapshot.divAnual);
    const txCount   = Math.max(0, Math.floor(_sanitizeNum(snapshot.txCount)));
    const wlCount   = Math.max(0, Math.floor(_sanitizeNum(snapshot.watchlistCount)));
    const bizums    = Math.max(0, Math.floor(_sanitizeNum(snapshot.pendingBizums)));

    const cats = Array.isArray(snapshot.topCats) ? snapshot.topCats.slice(0, 5) : [];
    const topCatsStr = cats.length
      ? cats.map(c => `${_sanitizePromptStr(c?.name, 40)}:${_fmtEuro(c?.amount)}`).join(', ')
      : 'ninguno';

    const portf = Array.isArray(snapshot.portfolio) ? snapshot.portfolio.slice(0, 5) : [];
    const portfLen = Math.max(0, Math.floor(_sanitizeNum(snapshot.portfolioCount ?? portf.length)));
    const portfStr = portf.length
      ? portf.map(a => {
          const t = _sanitizePromptStr(a?.ticker, 20);
          const sc = a?.sector ? '[' + _sanitizePromptStr(a.sector, 20) + ']' : '';
          const v = _sanitizeNum(a?.value);
          const g = _sanitizeNum(a?.gain);
          return `${t}${sc}:${_fmtEuro(v)}(${g >= 0 ? '+' : ''}${_fmtEuro(g)})`;
        }).join(', ')
      : 'Sin activos';

    const goals = Array.isArray(snapshot.goals) ? snapshot.goals.slice(0, 4) : [];
    const goalsStr = goals.length
      ? goals.map(g => `${_sanitizePromptStr(g?.name, 40)}:${_fmtEuro(g?.current)}/${_fmtEuro(g?.target)}`).join(', ')
      : 'Sin objetivos';

    const propsCtx = propCount > 0 ? `, inmuebles:${_fmtEuro(prop)}(${propCount})` : '';
    contextBlock = `Tienes acceso en tiempo real a los datos financieros del usuario.\n\n[FINOVA ${date}]\nPatrimonio: ${_fmtEuro(patrimony)} (efectivo:${_fmtEuro(cash)}, inversión:${_fmtEuro(inv)}, alt:${_fmtEuro(alt)}${propsCtx})\nMes ${month}: ingresos ${_fmtEuro(inc)}, gastos ${_fmtEuro(exp)}, balance ${_fmtEuro(inc - exp)}\nTop gastos: ${topCatsStr}\nCartera (${portfLen}): ${portfStr}\nDividendos anuales: ${_fmtEuro(divAnual)}\nObjetivos: ${goalsStr}\nTransacciones: ${txCount} | Watchlist: ${wlCount} | Bizums pendientes: ${bizums}\n`;
  }

  return `Eres Finova AI, el asesor financiero personal integrado en la app Finova.\n${contextBlock}\nInstrucciones:\n- Responde siempre en español\n- Usa los datos reales del usuario para dar consejos personalizados con números concretos\n- Usa formato markdown básico (negritas con **, listas con -, saltos de línea) para estructurar respuestas\n- Usa el formato europeo de moneda (€1.234,56)\n- Si el usuario no tiene datos en alguna categoría, díselo\n- No garantices rentabilidades ni des consejos de inversión ilegales`;
}

// Respuesta genérica para errores internos — log completo en servidor, mensaje opaco al cliente.
function _serverError(req, res, e, status = 500) {
  console.error('[FINOVA/Error]', {
    route:  req.url,
    method: req.method,
    msg:    e?.message?.slice(0, 300),
    stack:  e?.stack?.split('\n').slice(0, 3).join(' | '),
  });
  res.writeHead(status, _apiHeaders(req));
  res.end(JSON.stringify({ error: 'Error interno del servidor. Inténtalo de nuevo.' }));
}

// Returns true if the x-finova-proxy header matches FINOVA_PROXY_SECRET (when configured).
// If the secret is not set, every request is allowed (backward-compatible dev mode).
function _checkProxySecret(req, res) {
  if (!_PROXY_SECRET) return true;
  if (req.headers['x-finova-proxy'] === _PROXY_SECRET) return true;
  console.warn('[FINOVA/Proxy] Request missing proxy secret — IP:', _clientIp(req), 'URL:', req.url);
  res.writeHead(403, _apiHeaders(req));
  res.end(JSON.stringify({ error: 'Acceso no autorizado.' }));
  return false;
}

// Returns true if the request Content-Type is application/json; otherwise sends
// 415 and returns false. Call this before buffering the body on POST endpoints.
function _requireJson(req, res) {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim();
  if (ct !== 'application/json') {
    res.writeHead(415, _apiHeaders(req));
    res.end(JSON.stringify({ error: 'Content-Type debe ser application/json.' }));
    return false;
  }
  return true;
}

/* ─── Proxy helpers ──────────────────────────────────────────── */
function httpsGet(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, resHeaders: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

/* ─── Yahoo Finance session (crumb + cookie) ─────────────────── */
let _yfSession = null; // { crumb, cookie, ts }
const _YF_SESSION_TTL = 50 * 60 * 1000; // 50 min

function _yfExtractCookies(setCookieArr) {
  if (!setCookieArr) return '';
  const arr = Array.isArray(setCookieArr) ? setCookieArr : [setCookieArr];
  return arr.map(c => c.split(';')[0]).filter(Boolean).join('; ');
}

async function _ensureYfSession() {
  if (_yfSession && (Date.now() - _yfSession.ts) < _YF_SESSION_TTL) return _yfSession;
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  let cookie = '';
  try {
    const r1 = await httpsGet('fc.yahoo.com', '/', { 'User-Agent': ua, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' });
    if (r1.resHeaders?.['set-cookie']) cookie = _yfExtractCookies(r1.resHeaders['set-cookie']);
  } catch {}
  try {
    const r2 = await httpsGet('query1.finance.yahoo.com', '/v1/test/getcrumb', {
      'User-Agent': ua, 'Accept': 'text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9',
      ...(cookie ? { 'Cookie': cookie } : {}),
    });
    if (r2.resHeaders?.['set-cookie']) {
      const extra = _yfExtractCookies(r2.resHeaders['set-cookie']);
      cookie = cookie ? cookie + '; ' + extra : extra;
    }
    if (r2.status === 200 && r2.body && r2.body.trim().length > 1 && r2.body.trim() !== 'null') {
      _yfSession = { crumb: r2.body.trim(), cookie, ts: Date.now() };
      return _yfSession;
    }
  } catch {}
  return null;
}

function httpsPost(hostname, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/* ─── Provider proxies ───────────────────────────────────────── */
async function proxyClaude(apiKey, messages, systemPrompt) {
  const body = JSON.stringify({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });
  const r = await httpsPost('api.anthropic.com', '/v1/messages', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body);
  if (r.status !== 200) {
    let msg = `Error ${r.status}`;
    try {
      const j = JSON.parse(r.body);
      const raw = (j.error?.message || '').toLowerCase();
      if (raw.includes('credit') || raw.includes('balance') || raw.includes('billing'))
        msg = 'Sin créditos en Claude. Ve a console.anthropic.com → Plans & Billing.';
      else if (r.status === 401 || (raw.includes('invalid') && raw.includes('key')))
        msg = 'API Key de Claude inválida. Actualízala en Ajustes.';
      else if (r.status === 429)
        msg = 'Límite de peticiones de Claude alcanzado. Espera unos segundos.';
      else
        msg = j.error?.message || msg;
    } catch {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  const data = JSON.parse(r.body);
  return data.content[0]?.text || '';
}

async function proxyOpenAI(apiKey, messages, systemPrompt) {
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  });
  const r = await httpsPost('api.openai.com', '/v1/chat/completions', {
    'Authorization': `Bearer ${apiKey}`,
  }, body);
  if (r.status !== 200) {
    let msg = `Error ${r.status}`;
    try {
      const j = JSON.parse(r.body);
      const raw = (j.error?.message || '').toLowerCase();
      if (raw.includes('quota') || raw.includes('insufficient') || raw.includes('billing') || raw.includes('exceeded'))
        msg = 'Cuota de ChatGPT agotada o sin créditos. Añade saldo en platform.openai.com → Billing.';
      else if (r.status === 401)
        msg = 'API Key de ChatGPT inválida. Actualízala en Ajustes.';
      else if (r.status === 429)
        msg = 'Demasiadas peticiones a ChatGPT. Espera unos segundos e inténtalo de nuevo.';
      else
        msg = j.error?.message || msg;
    } catch {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  const data = JSON.parse(r.body);
  return data.choices[0]?.message?.content || '';
}

async function proxyGemini(apiKey, messages, systemPrompt) {
  const rawHistory = messages.filter((_, i) => i > 0 || messages[0]?.role === 'user');
  const contents = rawHistory.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
  });
  const apiPath = `/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
  const r = await httpsPost('generativelanguage.googleapis.com', apiPath, {}, body);
  if (r.status !== 200) {
    let msg = `Error ${r.status}`;
    try {
      const j = JSON.parse(r.body);
      const raw = (j?.error?.message || '').toLowerCase();
      if (raw.includes('quota') || raw.includes('exhausted') || raw.includes('daily'))
        msg = 'Cuota diaria de Gemini agotada. Se renueva mañana, o activa facturación en console.cloud.google.com.';
      else if (raw.includes('api key') || raw.includes('invalid') || r.status === 400)
        msg = 'API Key de Gemini inválida. Verifica que sea correcta en Ajustes.';
      else if (r.status === 403)
        msg = 'API Key de Gemini sin permisos. Activa la "Generative Language API" en Google Cloud Console.';
      else if (r.status === 429)
        msg = 'Demasiadas peticiones a Gemini (límite: 30/min en plan gratuito). Espera 60 segundos.';
      else
        msg = j?.error?.message || msg;
    } catch {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  const data = JSON.parse(r.body);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    if (reason === 'SAFETY') throw new Error('Gemini bloqueó la respuesta por filtros de seguridad. Reformula tu pregunta.');
    throw new Error('Gemini no devolvió respuesta. Inténtalo de nuevo.');
  }
  return text;
}

async function proxyGroq(apiKey, messages, systemPrompt) {
  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  });
  const r = await httpsPost('api.groq.com', '/openai/v1/chat/completions', {
    'Authorization': `Bearer ${apiKey}`,
  }, body);
  if (r.status !== 200) {
    let msg = `Error ${r.status}`;
    try {
      const j = JSON.parse(r.body);
      const raw = (j.error?.message || '').toLowerCase();
      if (raw.includes('rate') || raw.includes('limit') || r.status === 429)
        msg = 'Límite de Groq alcanzado. Espera unos segundos (14.400 req/día en plan gratuito).';
      else if (r.status === 401)
        msg = 'API Key de Groq inválida. Actualízala en Ajustes.';
      else
        msg = j.error?.message || msg;
    } catch {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  const data = JSON.parse(r.body);
  return data.choices[0]?.message?.content || '';
}

/* ─── Batch quotes cache (5 min TTL) ────────────────────────── */
const _qCache = new Map(); // ticker → { price, previousClose, change, changePct, name, currency, ts }
const _Q_TTL  = 5 * 60 * 1000;

// Valid ticker: 1–15 chars, uppercase letters/digits plus . - ^ = (covers indices like ^GSPC, BRK.B)
const _TICKER_RE = /^[A-Z0-9.\-^=]{1,15}$/i;

async function _batchFetchYf(tickers) {
  const session = await _ensureYfSession().catch(() => null);
  const crumb   = session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const hdrs    = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control':   'no-cache',
    ...(session?.cookie ? { 'Cookie': session.cookie } : {}),
  };
  const symbols = encodeURIComponent(tickers.join(','));
  const fields  = 'regularMarketPrice,regularMarketPreviousClose,regularMarketChange,regularMarketChangePercent,shortName,longName,currency';
  const r       = await httpsGet('query1.finance.yahoo.com', `/v7/finance/quote?symbols=${symbols}&fields=${fields}${crumb}`, hdrs);
  if (r.status !== 200) throw new Error('Yahoo Finance devolvió ' + r.status);
  const json    = JSON.parse(r.body);
  const results = json?.quoteResponse?.result || [];
  const now     = Date.now();
  const out     = {};
  for (const q of results) {
    if (!q.symbol) continue;
    const prev  = q.regularMarketPreviousClose || 0;
    const price = q.regularMarketPrice         || prev;
    const entry = {
      price,
      previousClose: prev,
      change:        q.regularMarketChange              || (prev > 0 ? price - prev : 0),
      changePct:     q.regularMarketChangePercent       || (prev > 0 ? ((price - prev) / prev) * 100 : 0),
      name:          q.longName || q.shortName || q.symbol,
      currency:      q.currency || 'USD',
      ts:            now,
    };
    out[q.symbol] = entry;
    _qCache.set(q.symbol, entry);
  }
  return out;
}

async function handleBatchQuotes(req, res) {
  if (!_checkRateLimit(req, res, 'quotes')) return;
  try {
    const urlObj  = new URL(req.url, 'http://localhost');
    const symbols = (urlObj.searchParams.get('symbols') || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(s => s && _TICKER_RE.test(s)).slice(0, 50);
    if (!symbols.length) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Parámetro symbols requerido o todos los símbolos son inválidos.' }));
    }
    const result  = {};
    const toFetch = [];
    for (const t of symbols) {
      const c = _qCache.get(t);
      if (c && Date.now() - c.ts < _Q_TTL) result[t] = c;
      else toFetch.push(t);
    }
    if (toFetch.length > 0) {
      try {
        const fresh = await _batchFetchYf(toFetch);
        Object.assign(result, fresh);
      } catch (_) {}
      for (const t of toFetch) {
        if (!result[t]) {
          const stale = _qCache.get(t);
          if (stale) result[t] = { ...stale, stale: true };
        }
      }
    }
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500, _apiHeaders(req));
    res.end(JSON.stringify({ error: e.message }));
  }
}

/* ─── Yahoo Finance proxy (multi-endpoint fallback) ─────────── */
async function handleYahooProxy(req, res) {
  if (!_checkRateLimit(req, res, 'quotes')) return;
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const ticker = urlObj.searchParams.get('ticker');
    if (!ticker) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Missing ticker' }));
    }
    const t = ticker.trim().toUpperCase();
    if (!_TICKER_RE.test(t)) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Ticker inválido.' }));
    }
    const range = urlObj.searchParams.get('range') || '1d';

    // Obtain a valid Yahoo Finance session (crumb + cookie) — required since early 2024
    const session = await _ensureYfSession().catch(() => null);
    const crumb   = session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
    const hdrs    = {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control':   'no-cache',
      ...(session?.cookie ? { 'Cookie': session.cookie } : {}),
    };

    // 1) v8 chart on query2 (with crumb)
    try {
      const r = await httpsGet('query2.finance.yahoo.com',
        `/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=${range}${crumb}`, hdrs);
      if (r.status === 200) { res.writeHead(200, _apiHeaders(req)); return res.end(r.body); }
      if (r.status === 401) _yfSession = null; // invalidate stale session
    } catch (_) {}

    // 2) v8 chart on query1 (different CDN node, with crumb)
    try {
      const r = await httpsGet('query1.finance.yahoo.com',
        `/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=${range}${crumb}`, hdrs);
      if (r.status === 200) { res.writeHead(200, _apiHeaders(req)); return res.end(r.body); }
      if (r.status === 401) _yfSession = null;
    } catch (_) {}

    // 3) v7 quote endpoint — returns regularMarketPrice directly (with crumb)
    try {
      const r = await httpsGet('query1.finance.yahoo.com',
        `/v7/finance/quote?symbols=${encodeURIComponent(t)}&fields=regularMarketPrice,regularMarketPreviousClose,shortName,longName,currency${crumb}`,
        hdrs);
      if (r.status === 200) {
        const json = JSON.parse(r.body);
        const q    = json?.quoteResponse?.result?.[0];
        if (q) {
          const v8 = { chart: { result: [{ meta: {
            regularMarketPrice:         q.regularMarketPrice         || 0,
            regularMarketPreviousClose: q.regularMarketPreviousClose || 0,
            longName:  q.longName  || q.shortName || t,
            shortName: q.shortName || t,
            currency:  q.currency  || 'USD',
          }}]}};
          res.writeHead(200, _apiHeaders(req));
          return res.end(JSON.stringify(v8));
        }
      }
    } catch (_) {}

    res.writeHead(503, _apiHeaders(req));
    res.end(JSON.stringify({ error: 'Yahoo Finance no disponible en este momento' }));
  } catch (err) {
    res.writeHead(500, _apiHeaders(req));
    res.end(JSON.stringify({ error: err.message }));
  }
}

/* ─── Yahoo Finance quoteSummary proxy ──────────────────────── */
async function handleYahooInfo(req, res) {
  if (!_checkRateLimit(req, res, 'quotes')) return;
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const ticker = urlObj.searchParams.get('ticker');
    if (!ticker) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Missing ticker' }));
    }
    const t = ticker.trim().toUpperCase();
    if (!_TICKER_RE.test(t)) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Ticker inválido.' }));
    }
    const apiPath = `/v10/finance/quoteSummary/${encodeURIComponent(t)}?modules=assetProfile`;
    const r = await httpsGet('query1.finance.yahoo.com', apiPath, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    });
    if (r.status !== 200) {
      res.writeHead(r.status, _apiHeaders(req));
      return res.end(JSON.stringify({ error: `Yahoo returned ${r.status}` }));
    }
    const data = JSON.parse(r.body);
    const profile = data?.quoteSummary?.result?.[0]?.assetProfile || {};
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({
      sector:   profile.sector   || '',
      industry: profile.industry || '',
      country:  profile.country  || '',
    }));
  } catch (err) {
    _serverError(req, res, err);
  }
}

/* ─── Exchange rates proxy (open.er-api.com) ─────────────────── */
async function handleExchangeRates(req, res) {
  if (!_checkRateLimit(req, res, 'quotes')) return;
  try {
    const r = await httpsGet('open.er-api.com', '/v6/latest/EUR', {
      'Accept':     'application/json',
      'User-Agent': 'Finova/1.0',
    });
    if (r.status !== 200) {
      res.writeHead(r.status, _apiHeaders(req));
      return res.end(JSON.stringify({ error: `Proveedor de cambio devolvió ${r.status}` }));
    }
    const data = JSON.parse(r.body);
    if (!data.rates) {
      res.writeHead(502, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Respuesta inválida del proveedor de tipos de cambio' }));
    }
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({ rates: data.rates, time_last_update_utc: data.time_last_update_utc }));
  } catch (err) {
    _serverError(req, res, err);
  }
}

/* ─── AI status ──────────────────────────────────────────────── */
function handleAIStatus(req, res) {
  const hasKey = !!(FINOVA_GROQ_KEY || FINOVA_AI_KEY);
  const serverProvider = FINOVA_GROQ_KEY ? 'groq' : (FINOVA_AI_KEY ? 'claude' : '');
  res.writeHead(200, _apiHeaders(req));
  res.end(JSON.stringify({ serverAI: hasKey, serverProvider }));
}

/* ─── AI proxy dispatcher ────────────────────────────────────── */
async function handleAIProxy(req, res) {
  // 1. Require Firebase auth
  let uid = null;
  if (_AUTH_ENABLED) {
    uid = await _requireAuth(req, res);
    if (uid === null) return; // 401 already sent
    if (_isBlocked(uid)) {
      res.writeHead(403, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Cuenta suspendida. Contacta con soporte.' }));
    }
  }

  // 2. IP-based token bucket (burst protection)
  if (!_checkRateLimit(req, res, 'ai')) return;

  // 3. Per-UID daily quota (free: 5/day, premium: 50/day, admin: unlimited)
  const role = _getUserRole(uid);
  if (_AUTH_ENABLED && uid && role !== 'admin') {
    const dailyLimit = _LIMITS.ai.byUID[role] || _LIMITS.ai.byUID.free;
    const uidResult  = _tokenBucket(`ai-uid:${uid}`, dailyLimit, dailyLimit / 86400);
    if (!uidResult.ok) {
      res.writeHead(429, _apiHeaders(req, { 'Retry-After': '86400' }));
      return res.end(JSON.stringify({
        error: `Has alcanzado el límite diario de ${dailyLimit} consultas (plan ${role === 'premium' ? 'Premium' : 'Gratuito'}).${role !== 'premium' ? ' Mejora a Premium para 50 consultas/día.' : ' Vuelve mañana.'}`,
        limitReached: true, role, limit: dailyLimit,
      }));
    }
  }

  if (!_requireJson(req, res)) return;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { provider, apiKey, messages, anonMode, snapshot } = JSON.parse(body);
      const systemPrompt = _buildServerSystemPrompt(!!anonMode, snapshot);
      const userKey      = (apiKey || '').trim();
      const serverKey    = FINOVA_GROQ_KEY || FINOVA_AI_KEY;
      const effectiveKey = userKey || serverKey;
      if (!effectiveKey) {
        res.writeHead(401, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'No hay API Key configurada. Añádela en Ajustes o configura FINOVA_GROQ_KEY / FINOVA_AI_KEY en server.js.' }));
      }
      const serverProvider    = FINOVA_GROQ_KEY ? 'groq' : 'claude';
      const effectiveProvider = userKey ? (provider || 'claude') : serverProvider;
      const usingServerGroq   = !userKey && effectiveProvider === 'groq';
      if (usingServerGroq && !_groqGlobalOk()) {
        res.writeHead(429, _apiHeaders(req, { 'Retry-After': '60' }));
        return res.end(JSON.stringify({ error: 'Límite global de Groq alcanzado. El servidor ha consumido el cupo compartido por minuto — espera 60 segundos.' }));
      }
      let text = '';
      if      (effectiveProvider === 'openai') text = await proxyOpenAI(effectiveKey, messages, systemPrompt);
      else if (effectiveProvider === 'gemini') text = await proxyGemini(effectiveKey, messages, systemPrompt);
      else if (effectiveProvider === 'groq')   text = await proxyGroq(effectiveKey, messages, systemPrompt);
      else                                     text = await proxyClaude(effectiveKey, messages, systemPrompt);

      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ text }));
    } catch (err) {
      _serverError(req, res, err, err.status || 500);
    }
  });
}

// Verifies Firebase token and returns uid, or writes 401 and returns null.
// Uses Admin SDK (with revocation check) when available; custom RS256 otherwise.
async function _requireAuth(req, res) {
  if (!_AUTH_ENABLED) return 'dev-uid';
  const authHeader = req.headers['authorization'] || '';
  try {
    if (_adminReady) {
      if (!authHeader.startsWith('Bearer ')) throw Object.assign(new Error('Token ausente'), { code: 'auth/no-token' });
      const decoded = await _adminSDK.auth().verifyIdToken(authHeader.slice(7).trim(), true);
      return decoded.uid;
    }
    return await _verifyFirebaseToken(authHeader);
  } catch (e) {
    const code      = e.code || '';
    const isExpired = code === 'auth/id-token-expired' || e.message === 'Token expirado';
    const isRevoked = code === 'auth/id-token-revoked';
    res.writeHead(401, _apiHeaders(req));
    res.end(JSON.stringify({
      error: isExpired ? 'Sesión expirada. Vuelve a iniciar sesión.' :
             isRevoked ? 'Sesión revocada. Vuelve a iniciar sesión.'  :
                         'Token inválido.',
    }));
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   GoCardless — Open Banking PSD2 (reemplaza Afterbanks)
   El usuario autoriza en su banco via OAuth. Finova nunca ve
   sus credenciales bancarias.
   Requiere: FINOVA_GC_SECRET_ID y FINOVA_GC_SECRET_KEY
   Registro gratuito en bankaccountdata.gocardless.com
═══════════════════════════════════════════════════════════════ */
const GC_SECRET_ID  = process.env.FINOVA_GC_SECRET_ID  || '';
const GC_SECRET_KEY = process.env.FINOVA_GC_SECRET_KEY || '';
const _GC_HOST      = 'bankaccountdata.gocardless.com';
let _gcTokenCache   = null;
let _gcTokenExpMs   = 0;
let _gcInstCache    = null;
let _gcInstCacheTs  = 0;
const _GC_INST_TTL  = 24 * 60 * 60 * 1000;

// ─── Propiedad de requisitions (IDOR fix) ──────────────────────
// GoCardless no conoce el concepto de "usuario Finova": el requisitionId que
// devuelve es opaco y, si no se ata a un uid, cualquier usuario autenticado
// podría leer la conexión bancaria (IBAN, saldo, movimientos) de otro con solo
// adivinar/obtener su requisitionId. Se persiste el propietario al crearla y
// se exige que coincida con el uid verificado en cualquier lectura/importación.
const _BANK_REQ_FILE = path.join(ROOT, 'data', 'bank_requisitions.json');

function _getBankReqOwners() {
  try { return JSON.parse(fs.readFileSync(_BANK_REQ_FILE, 'utf8')); }
  catch { return {}; }
}

function _recordBankReqOwner(requisitionId, uid) {
  const owners = _getBankReqOwners();
  owners[requisitionId] = { uid, createdAt: Date.now() };
  try { fs.writeFileSync(_BANK_REQ_FILE, JSON.stringify(owners, null, 2), 'utf8'); }
  catch (e) { console.error('[FINOVA/GoCardless] No se pudo persistir la propiedad de la requisition:', e.message); }
}

function _bankReqBelongsTo(requisitionId, uid) {
  const owners = _getBankReqOwners();
  const entry  = owners[requisitionId];
  return !!entry && entry.uid === uid;
}

function _gcRaw(method, apiPath, bodyObj, token) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  const headers = {
    'Accept': 'application/json',
    ...(token   ? { 'Authorization': 'Bearer ' + token } : {}),
    ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
  };
  const request = new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: _GC_HOST, path: apiPath, method, headers },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('GoCardless timeout (30s)')), 30_000)
  );
  return Promise.race([request, timeout]);
}

async function _gcGetToken() {
  if (_gcTokenCache && Date.now() < _gcTokenExpMs - 30_000) return _gcTokenCache;
  const r = await _gcRaw('POST', '/api/v2/token/new/', { secret_id: GC_SECRET_ID, secret_key: GC_SECRET_KEY }, null);
  if (r.status !== 200 && r.status !== 201) throw new Error('GoCardless auth error ' + r.status + ': ' + r.body.slice(0, 120));
  const data = JSON.parse(r.body);
  _gcTokenCache = data.access;
  _gcTokenExpMs = Date.now() + (data.access_expires || 86400) * 1000;
  return _gcTokenCache;
}

async function _gcCall(method, apiPath, body) {
  const token = await _gcGetToken();
  const r = await _gcRaw(method, apiPath, body, token);
  let data;
  try { data = JSON.parse(r.body); } catch { throw new Error('GoCardless respuesta inválida'); }
  if (r.status >= 400) throw new Error(data.detail || data.summary || 'Error GoCardless ' + r.status);
  return data;
}

async function handleBankInstitutions(req, res) {
  if ((await _requireAuth(req, res)) === null) return;
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    res.writeHead(503, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'GoCardless no configurado. Arranca el servidor con:\nFINOVA_GC_SECRET_ID=xxx FINOVA_GC_SECRET_KEY=xxx node server.js' }));
  }
  try {
    if (_gcInstCache && Date.now() - _gcInstCacheTs < _GC_INST_TTL) {
      res.writeHead(200, _apiHeaders(req));
      return res.end(JSON.stringify(_gcInstCache));
    }
    const data = await _gcCall('GET', '/api/v2/institutions/?country=ES', null);
    const list = (Array.isArray(data) ? data : []).map(b => ({
      id: b.id, name: b.name, logo: b.logo || null,
    })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    _gcInstCache = list; _gcInstCacheTs = Date.now();
    res.writeHead(200, _apiHeaders(req)); res.end(JSON.stringify(list));
  } catch (e) {
    const _gcS = e.message.includes('timeout') ? 504 : 500;
    console.error('[FINOVA/GoCardless] institutions:', e.message?.slice(0, 100));
    res.writeHead(_gcS, _apiHeaders(req));
    res.end(JSON.stringify({ error: _gcS === 504 ? 'Tiempo de espera agotado.' : 'Error al obtener entidades bancarias.' }));
  }
}

async function handleBankCreateRequisition(req, res) {
  const uid = await _requireAuth(req, res);
  if (uid === null) return;
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    res.writeHead(503, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'GoCardless no configurado.' }));
  }
  if (!_requireJson(req, res)) return;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { institutionId } = JSON.parse(body);
      if (!institutionId) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'institutionId requerido' }));
      }
      const agr = await _gcCall('POST', '/api/v2/agreements/enduser/', {
        institution_id:       institutionId,
        max_historical_days:  90,
        access_valid_for_days: 30,
        access_scope: ['balances', 'details', 'transactions'],
      });
      const ref  = 'FNV_' + Date.now().toString(36);
      const req2 = await _gcCall('POST', '/api/v2/requisitions/', {
        redirect:       'http://localhost:3000',
        institution_id: institutionId,
        agreement:      agr.id,
        reference:      ref,
        user_language:  'ES',
      });
      _recordBankReqOwner(req2.id, uid);
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ requisitionId: req2.id, link: req2.link }));
    } catch (e) {
      const _gcS = e.message.includes('timeout') ? 504 : 500;
      console.error('[FINOVA/GoCardless] createRequisition:', e.message?.slice(0, 100));
      res.writeHead(_gcS, _apiHeaders(req));
      res.end(JSON.stringify({ error: _gcS === 504 ? 'Tiempo de espera agotado.' : 'Error al iniciar la conexión bancaria.' }));
    }
  });
}

async function handleBankGetRequisition(req, res) {
  const uid = await _requireAuth(req, res);
  if (uid === null) return;
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    res.writeHead(503, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'GoCardless no configurado.' }));
  }
  try {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
    if (!id) { res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'id requerido' })); }
    if (!_bankReqBelongsTo(id, uid)) {
      res.writeHead(403, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Conexión no encontrada o no autorizada' }));
    }
    const data = await _gcCall('GET', `/api/v2/requisitions/${id}/`, null);
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({ status: data.status, accounts: data.accounts || [] }));
  } catch (e) {
    const _gcS = e.message.includes('timeout') ? 504 : 500;
    console.error('[FINOVA/GoCardless] getRequisition:', e.message?.slice(0, 100));
    res.writeHead(_gcS, _apiHeaders(req));
    res.end(JSON.stringify({ error: _gcS === 504 ? 'Tiempo de espera agotado.' : 'Error al obtener el estado de la conexión.' }));
  }
}

async function handleBankImport(req, res) {
  const uid = await _requireAuth(req, res);
  if (uid === null) return;
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    res.writeHead(503, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'GoCardless no configurado.' }));
  }
  if (!_requireJson(req, res)) return;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { requisitionId } = JSON.parse(body);
      if (!requisitionId) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'requisitionId requerido' }));
      }
      if (!_bankReqBelongsTo(requisitionId, uid)) {
        res.writeHead(403, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Conexión no encontrada o no autorizada' }));
      }
      const reqData = await _gcCall('GET', `/api/v2/requisitions/${requisitionId}/`, null);
      if (reqData.status !== 'LN') {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Conexión no autorizada (estado: ' + reqData.status + ')' }));
      }
      const accountIds = reqData.accounts || [];
      const accounts   = [];
      for (const accId of accountIds) {
        try {
          const [details, balances, transactions] = await Promise.all([
            _gcCall('GET', `/api/v2/accounts/${accId}/details/`, null),
            _gcCall('GET', `/api/v2/accounts/${accId}/balances/`, null),
            _gcCall('GET', `/api/v2/accounts/${accId}/transactions/`, null),
          ]);
          const acc = details.account || {};
          const bal = (balances.balances || []).find(b =>
            b.balanceType === 'closingBooked' || b.balanceType === 'interimAvailable'
          ) || (balances.balances || [])[0];
          const balance = bal ? parseFloat(bal.balanceAmount?.amount || 0) : null;
          const txList  = [
            ...(transactions.transactions?.booked  || []),
            ...(transactions.transactions?.pending || []),
          ];
          accounts.push({
            id:           accId,
            iban:         acc.iban || null,
            name:         acc.name || acc.ownerName || 'Cuenta bancaria',
            balance,
            transactions: txList.map(t => ({
              transactionId: t.transactionId || t.internalTransactionId || null,
              date:          t.bookingDate   || t.valueDate || new Date().toISOString().slice(0, 10),
              amount:        parseFloat(t.transactionAmount?.amount || 0),
              description:   (t.remittanceInformationUnstructured || t.remittanceInformationStructured || t.additionalInformation || 'Transacción').trim(),
            })),
          });
        } catch {}
      }
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ accounts }));
    } catch (e) {
      const _gcS = e.message.includes('timeout') ? 504 : 500;
      console.error('[FINOVA/GoCardless] import:', e.message?.slice(0, 100));
      res.writeHead(_gcS, _apiHeaders(req));
      res.end(JSON.stringify({ error: _gcS === 504 ? 'Tiempo de espera agotado al importar transacciones.' : 'Error al importar los movimientos bancarios.' }));
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   SEGURIDAD — Firebase JWT verification + AES-256-GCM encryption
═══════════════════════════════════════════════════════════════ */

// Firebase project — used to verify JWT iss / aud claims.
const _FIREBASE_PROJECT = process.env.FINOVA_FIREBASE_PROJECT || 'finova-92100';

// Auth is ENABLED by default. The only supported way to disable it is an explicit
// FINOVA_DISABLE_AUTH=true env var — never set this in production.
// Previous mechanism (FINOVA_FIREBASE_PROJECT=DISABLED) is no longer honoured; it was
// a silent footgun where auth could be disabled by setting a project-ID variable to a
// magic string rather than requiring a deliberate, named opt-out.
const _AUTH_ENABLED = process.env.FINOVA_DISABLE_AUTH !== 'true';

// Google JWKS cache (RSA public keys for RS256 Firebase tokens)
let _jwksCache = { keys: null, expAt: 0 };

async function _getFirebasePublicKeys() {
  if (_jwksCache.keys && Date.now() < _jwksCache.expAt) return _jwksCache.keys;
  const r = await httpsGet('www.googleapis.com',
    '/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', {});
  if (r.status !== 200) throw new Error('No se pudieron obtener las claves públicas de Firebase');
  const { keys } = JSON.parse(r.body);
  const cc     = r.resHeaders?.['cache-control'] || '';
  const maxAge = parseInt((cc.match(/max-age=(\d+)/) || [])[1] || '3600', 10);
  _jwksCache = { keys, expAt: Date.now() + maxAge * 1000 };
  return keys;
}

function _b64urlDecode(s) {
  s += '='.repeat((4 - s.length % 4) % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Verifies a Firebase ID Token (RS256 JWT) and returns the verified UID.
// Throws on any validation failure — never returns an unverified UID.
async function _verifyFirebaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Token ausente');
  const parts = authHeader.slice(7).trim().split('.');
  if (parts.length !== 3) throw new Error('Token malformado');
  let header, payload;
  try {
    header  = JSON.parse(_b64urlDecode(parts[0]));
    payload = JSON.parse(_b64urlDecode(parts[1]));
  } catch { throw new Error('Token malformado'); }
  if (header.alg !== 'RS256') throw new Error('Algoritmo no soportado');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp  <= now)     throw new Error('Token expirado');
  if (payload.iat   > now + 300) throw new Error('Token emitido en el futuro');
  if (payload.aud !== _FIREBASE_PROJECT)
    throw new Error('Token para proyecto incorrecto');
  if (payload.iss !== `https://securetoken.google.com/${_FIREBASE_PROJECT}`)
    throw new Error('Emisor inválido');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('UID ausente en token');
  const keys = await _getFirebasePublicKeys();
  const jwk  = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Clave pública no encontrada para este token');
  const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const input  = Buffer.from(parts[0] + '.' + parts[1]);
  const sig    = _b64urlDecode(parts[2]);
  const valid  = crypto.verify('sha256', input,
    { key: pubKey, padding: crypto.constants.RSA_PKCS1_PADDING }, sig);
  if (!valid) throw new Error('Firma inválida');
  return payload.sub; // verified Firebase UID
}

// AES-256-GCM encryption for user JSON files at rest.
// Set FINOVA_ENC_KEY to a 64-char hex string (32 random bytes).
// Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const _ENC_KEY = (() => {
  const hex = process.env.FINOVA_ENC_KEY || '';
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length === 32 ? buf : null;
})();

function _encryptUserData(plaintext) {
  if (!_ENC_KEY) return plaintext;
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv('aes-256-gcm', _ENC_KEY, iv);
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return 'enc1:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function _decryptUserData(data) {
  if (!_ENC_KEY || !data.startsWith('enc1:')) return data;
  const buf = Buffer.from(data.slice(5), 'base64');
  const iv  = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);
  const d   = crypto.createDecipheriv('aes-256-gcm', _ENC_KEY, iv);
  d.setAuthTag(tag);
  return d.update(enc) + d.final('utf8');
}

// CSRF: only allow requests from known origins (for state-mutating endpoints)
function _originOk(req) {
  const o = req.headers.origin  || '';
  const r = (req.headers.referer || '').split('/').slice(0, 3).join('/');
  const check = o || r;
  return !check || _ALLOWED_ORIGINS.has(check);
}

/* ─── Datos de usuario autenticado (Firebase UID) ───────────── */
const _UID_RE = /^[a-zA-Z0-9]{20,128}$/;

/* Verifies the file about to be served belongs to the expected UID.
   Blocks and logs if a path mismatch is detected (cross-user leak guard). */
function _auditResponse(uid, filePath, req) {
  const expected = path.resolve(path.join(USERS_DIR, `${uid}.json`));
  const actual   = path.resolve(filePath);
  if (actual !== expected) {
    console.error('[FINOVA/Audit] ⚠️  PATH MISMATCH — cross-user data risk', {
      uid, expected, actual, ip: _clientIp(req),
    });
    return false;
  }
  return true;
}

async function handleUserDataGet(req, res) {
  if (!_checkRateLimit(req, res, 'userData')) return;

  // Verify Firebase ID token — the UID is extracted from the verified token,
  // never trusted from the query string.
  let uid;
  if (_AUTH_ENABLED) {
    try {
      uid = await _verifyFirebaseToken(req.headers['authorization']);
    } catch (e) {
      res.writeHead(401, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Token inválido.' }));
    }
  } else {
    uid = new URL(req.url, 'http://localhost').searchParams.get('uid') || '';
  }

  if (!_UID_RE.test(uid)) {
    res.writeHead(400, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'UID inválido' }));
  }
  if (_isBlocked(uid)) {
    res.writeHead(403, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Cuenta suspendida' }));
  }
  const file = path.join(USERS_DIR, `${uid}.json`);
  if (!_auditResponse(uid, file, req)) {
    res.writeHead(500, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Error de integridad de datos' }));
  }
  if (!fs.existsSync(file)) {
    res.writeHead(200, _apiHeaders(req));
    return res.end(JSON.stringify({ ok: true, data: null }));
  }
  try {
    const raw  = fs.readFileSync(file, 'utf8');
    const data = _decryptUserData(raw);
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({ ok: true, data }));
  } catch (e) {
    _serverError(req, res, e);
  }
}

async function handleUserDataPost(req, res) {
  if (!_originOk(req)) {
    res.writeHead(403, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Origen no permitido' }));
  }
  if (!_checkRateLimit(req, res, 'userDataPost')) return;

  // Verify token before streaming body — Node.js buffers request data during the await.
  let verifiedUid = null;
  if (_AUTH_ENABLED) {
    try {
      verifiedUid = await _verifyFirebaseToken(req.headers['authorization']);
    } catch (e) {
      res.writeHead(401, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Token inválido.' }));
    }
  }

  if (!_requireJson(req, res)) return;
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > _SYNC_MAX_BYTES) body = '\x00OVERSIZE';
  });
  req.on('end', () => {
    try {
      if (body === '\x00OVERSIZE') {
        res.writeHead(413, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Datos demasiado grandes (máx 8 MB)' }));
      }
      const { data } = JSON.parse(body);
      // UID comes exclusively from the verified Firebase token; body uid is not trusted.
      const uid = verifiedUid;
      if (!uid || !_UID_RE.test(uid)) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'UID inválido' }));
      }
      if (typeof data !== 'string' || data.length > _SYNC_MAX_BYTES) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Payload inválido' }));
      }
      const targetFile = path.join(USERS_DIR, `${uid}.json`);
      if (!_auditResponse(uid, targetFile, req)) {
        res.writeHead(500, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Error de integridad de datos' }));
      }
      const toWrite = _encryptUserData(data);
      fs.writeFileSync(targetFile, toWrite, 'utf8');
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true, saved: new Date().toISOString() }));
    } catch (e) {
      _serverError(req, res, e);
    }
  });
}

/* ─── Analytics — retención D1/D7/D30 ───────────────────────── */
function _loadAnalytics() {
  try { if (fs.existsSync(ANALYTICS_FILE)) return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8')); }
  catch {}
  return {};
}
const _ANALYTICS_MAX_CLIENTS       = 10_000;
const _ANALYTICS_SESSION_DAYS      = 90;

function _saveAnalytics(data) {
  // Trim sessions older than 90 days to keep per-client entries small
  const cutoff = _addDays(_todayUTC(), -_ANALYTICS_SESSION_DAYS);
  for (const c of Object.values(data)) {
    if (Array.isArray(c.sessions)) c.sessions = c.sessions.filter(d => d >= cutoff);
  }
  // Evict oldest clients when cap is exceeded
  const keys = Object.keys(data);
  if (keys.length > _ANALYTICS_MAX_CLIENTS) {
    keys
      .sort((a, b) => (data[a].firstSeen || '').localeCompare(data[b].firstSeen || ''))
      .slice(0, keys.length - _ANALYTICS_MAX_CLIENTS)
      .forEach(k => delete data[k]);
  }
  fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data), 'utf8');
}
function _addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function _todayUTC() { return new Date().toISOString().slice(0, 10); }

async function handleSession(req, res) {
  if (!_checkRateLimit(req, res, 'session')) return;
  if (!_requireJson(req, res)) return;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { clientId, txCount, section } = JSON.parse(body);
      if (!/^[0-9a-f-]{32,36}$/.test(clientId)) {
        res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'Invalid clientId' }));
      }
      // Treat all client-supplied values as untrusted — clamp numbers, allowlist strings
      const safeTxCount = Math.max(0, Math.min(1_000_000, Math.floor(Number(txCount) || 0)));
      const safeSection = (typeof section === 'string' && /^[a-z0-9_-]{1,32}$/.test(section))
        ? section : null;
      const today = _todayUTC();
      const data  = _loadAnalytics();
      if (!data[clientId]) data[clientId] = { firstSeen: today, sessions: [], txCount: 0, sections: {} };
      const c = data[clientId];
      if (!c.sessions.includes(today)) c.sessions.push(today);
      c.txCount = Math.max(c.txCount || 0, safeTxCount);
      if (safeSection) {
        if (!c.sections) c.sections = {};
        c.sections[safeSection] = (c.sections[safeSection] || 0) + 1;
      }
      _saveAnalytics(data);
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, _apiHeaders(req)); res.end(JSON.stringify({ error: 'Bad request' }));
    }
  });
}

async function handleStats(req, res) {
  if ((await _adminGuard(req, res)) === null) return;
  try {
    const data    = _loadAnalytics();
    const today   = _todayUTC();
    const clients = Object.values(data);
    const total   = clients.length;

    const active7  = clients.filter(c => c.sessions.some(d => d >= _addDays(today, -7))).length;
    const active30 = clients.filter(c => c.sessions.some(d => d >= _addDays(today, -30))).length;

    function retention(minAgeDays) {
      const cohort = clients.filter(c => c.firstSeen <= _addDays(today, -minAgeDays));
      if (!cohort.length) return { pct: null, n: 0 };
      const returned = cohort.filter(c =>
        c.sessions.some(d => d > c.firstSeen && d <= _addDays(c.firstSeen, minAgeDays))
      ).length;
      return { pct: Math.round(returned / cohort.length * 100), n: cohort.length };
    }

    const d1  = retention(1);
    const d7  = retention(7);
    const d30 = retention(30);

    const medianTx = clients.length
      ? clients.map(c => c.txCount).sort((a, b) => a - b)[Math.floor(clients.length / 2)]
      : 0;

    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({
      total, active7, active30, medianTx,
      D1:  d1.pct,  D1_cohort:  d1.n,
      D7:  d7.pct,  D7_cohort:  d7.n,
      D30: d30.pct, D30_cohort: d30.n,
    }));
  } catch (e) {
    res.writeHead(e.message.includes('timeout') ? 504 : 500, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
  }
}

/* ─── Waitlist early adopters ────────────────────────────────── */
const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function handleWaitlist(req, res) {
  if (!_checkRateLimit(req, res, 'waitlist')) return;
  if (!_requireJson(req, res)) return;
  const ip = _clientIp(req);
  let body = '';
  req.on('data', d => { body += d; if (body.length > 2000) body = '\x00OVERSIZE'; });
  req.on('end', () => {
    if (body.startsWith('\x00')) {
      res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'Petición demasiado grande.' }));
    }
    let email;
    try { ({ email } = JSON.parse(body)); } catch {
      res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'JSON inválido.' }));
    }
    if (!email || typeof email !== 'string') {
      res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'Email requerido.' }));
    }
    email = email.trim().toLowerCase().slice(0, 254);
    if (!_EMAIL_RE.test(email)) {
      res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'Email no válido.' }));
    }
    let list = [];
    try { list = JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8')); } catch {}
    if (!Array.isArray(list)) list = [];
    if (list.some(e => e.email === email)) {
      res.writeHead(200, _apiHeaders(req));
      return res.end(JSON.stringify({ ok: true, already: true, message: 'Ya estás en la lista. ¡Te avisamos!' }));
    }
    list.push({ email, date: new Date().toISOString(), ip });
    try {
      fs.writeFileSync(WAITLIST_FILE, JSON.stringify(list, null, 2));
    } catch (err) {
      res.writeHead(500, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'Error al guardar. Inténtalo de nuevo.' }));
    }
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({ ok: true, message: '¡Apuntado! Te avisamos cuando llegue el plan Premium.' }));
  });
}

/* ─── Sync backup ────────────────────────────────────────────── */
const _SYNC_CODE_RE   = /^[a-f0-9]{8,16}$/;
const _SYNC_MAX_BYTES = 8_000_000;

async function handleSyncUpload(req, res) {
  if (!_checkRateLimit(req, res, 'syncUpload')) return;
  if ((await _requireAuth(req, res)) === null) return;
  if (!_requireJson(req, res)) return;
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > _SYNC_MAX_BYTES) body = '\x00OVERSIZE';
  });
  req.on('end', () => {
    try {
      if (body === '\x00OVERSIZE') {
        res.writeHead(413, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Datos demasiado grandes (máx 8 MB)' }));
      }
      const { code, data } = JSON.parse(body);
      if (!code || !_SYNC_CODE_RE.test(code)) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Código inválido' }));
      }
      if (typeof data !== 'string' || data.length > _SYNC_MAX_BYTES) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Payload inválido' }));
      }
      fs.writeFileSync(path.join(SYNC_DIR, `${code}.json`), data, 'utf8');
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true, saved: new Date().toISOString() }));
    } catch (e) {
      _serverError(req, res, e);
    }
  });
}

async function handleSyncDownload(req, res) {
  if (!_checkRateLimit(req, res, 'syncDownload')) return;
  if ((await _requireAuth(req, res)) === null) return;

  const urlObj = new URL(req.url, 'http://localhost');
  const code   = urlObj.searchParams.get('code') || '';
  if (!_SYNC_CODE_RE.test(code)) {
    res.writeHead(400, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Código inválido' }));
  }
  const file = path.join(SYNC_DIR, `${code}.json`);
  if (!fs.existsSync(file)) {
    res.writeHead(404, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'No se encontró backup para ese código' }));
  }
  const data = fs.readFileSync(file, 'utf8');
  res.writeHead(200, _apiHeaders(req));
  res.end(JSON.stringify({ ok: true, data }));
}

/* ─── User metadata (email, displayName, lastAccess) ─────────── */
async function handleUserMeta(req, res) {
  if (!_originOk(req)) {
    res.writeHead(403, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Origen no permitido' }));
  }

  let verifiedUid = null;
  if (_AUTH_ENABLED) {
    try {
      verifiedUid = await _verifyFirebaseToken(req.headers['authorization']);
    } catch (e) {
      res.writeHead(401, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Token inválido.' }));
    }
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { uid, email, displayName } = JSON.parse(body);
      if (!uid || !_UID_RE.test(uid)) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'UID inválido' }));
      }
      if (verifiedUid !== null && verifiedUid !== uid) {
        res.writeHead(403, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Acceso denegado' }));
      }
      const existing = _readMeta(uid) || {};
      const meta = {
        ...existing,
        email:       (email       || existing.email       || '').toLowerCase().trim(),
        displayName: displayName  || existing.displayName || '',
        lastAccess:  new Date().toISOString(),
        createdAt:   existing.createdAt || new Date().toISOString(),
      };
      fs.writeFileSync(_metaPath(uid), JSON.stringify(meta), 'utf8');
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      _serverError(req, res, e);
    }
  });
}

/* ─── Admin API ───────────────────────────────────────────────── */
// Verifica token Y rol admin. Devuelve uid verificado o null (401/403 ya enviado).
// adminUid del body/query ya no se usa — el uid viene del token Firebase.
async function _adminGuard(req, res) {
  const uid = await _requireAuth(req, res);
  if (uid === null) return null;
  if (!_isAdminUid(uid)) {
    res.writeHead(403, _apiHeaders(req));
    res.end(JSON.stringify({ error: 'Acceso denegado: se requiere rol admin' }));
    return null;
  }
  return uid;
}

async function handleAdminUsers(req, res) {
  if ((await _adminGuard(req, res)) === null) return;
  try {
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'));
    const users = files.map(f => {
      const uid      = f.replace('.json', '');
      const dataPath = path.join(USERS_DIR, f);
      const stat     = fs.statSync(dataPath);
      const meta     = _readMeta(uid) || {};
      return {
        uid,
        email:       meta.email       || '(sin email)',
        displayName: meta.displayName || '',
        createdAt:   meta.createdAt   || null,
        lastAccess:  meta.lastAccess  || stat.mtime.toISOString(),
        sizeBytes:   stat.size,
        blocked:     _isBlocked(uid),
        isAdmin:     ADMIN_EMAILS.includes((meta.email || '').toLowerCase()),
      };
    });
    users.sort((a, b) => (b.lastAccess || '').localeCompare(a.lastAccess || ''));
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({ ok: true, users }));
  } catch (e) {
    res.writeHead(500, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleAdminBlock(req, res) {
  if ((await _adminGuard(req, res)) === null) return;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { targetUid, blocked } = JSON.parse(body);
      if (!targetUid || !_UID_RE.test(targetUid)) {
        res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'UID inválido' }));
      }
      if (blocked) {
        fs.writeFileSync(_blockedPath(targetUid), '', 'utf8');
      } else {
        if (fs.existsSync(_blockedPath(targetUid))) fs.unlinkSync(_blockedPath(targetUid));
      }
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true, blocked }));
    } catch (e) {
      res.writeHead(500, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
    }
  });
}

async function handleAdminSetAdmin(req, res) {
  if ((await _adminGuard(req, res)) === null) return;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { targetEmail, isAdmin } = JSON.parse(body);
      if (!targetEmail || !targetEmail.includes('@')) {
        res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'Email inválido' }));
      }
      const email = targetEmail.toLowerCase().trim();
      const file  = path.join(ROOT, 'data', 'extra_admins.json');
      let list = [];
      try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      if (isAdmin) {
        if (!list.includes(email)) list.push(email);
      } else {
        list = list.filter(e => e !== email);
      }
      fs.writeFileSync(file, JSON.stringify(list), 'utf8');
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
    }
  });
}

async function handleAdminHealth(req, res) {
  if ((await _adminGuard(req, res)) === null) return;
  try {
    const userFiles   = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'));
    const syncFiles   = fs.readdirSync(SYNC_DIR).filter(f => f.endsWith('.json'));
    const totalBytes  = userFiles.reduce((sum, f) => sum + fs.statSync(path.join(USERS_DIR, f)).size, 0);
    const uptimeSecs  = Math.floor(process.uptime());
    const memMB       = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({
      ok: true,
      status: 'running',
      uptime:    `${Math.floor(uptimeSecs/3600)}h ${Math.floor((uptimeSecs%3600)/60)}m`,
      memoryMB:  memMB,
      users:     userFiles.length,
      syncFiles: syncFiles.length,
      totalDataMB: (totalBytes / 1024 / 1024).toFixed(2),
      nodeVersion: process.version,
      timestamp:   new Date().toISOString(),
    }));
  } catch (e) {
    res.writeHead(500, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleAdminStats(req, res) {
  if ((await _adminGuard(req, res)) === null) return;
  try {
    const analytics = _loadAnalytics();
    const today     = _todayUTC();
    const clients   = Object.values(analytics);
    const total     = clients.length;
    const active7   = clients.filter(c => c.sessions.some(d => d >= _addDays(today, -7))).length;
    const active30  = clients.filter(c => c.sessions.some(d => d >= _addDays(today, -30))).length;
    const totalSessions = clients.reduce((s, c) => s + (c.sessions?.length || 0), 0);
    const sectionCounts = {};
    clients.forEach(c => {
      Object.entries(c.sections || {}).forEach(([k, v]) => {
        sectionCounts[k] = (sectionCounts[k] || 0) + v;
      });
    });
    const topSections = Object.entries(sectionCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([section, count]) => ({ section, count }));
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({ ok: true, total, active7, active30, totalSessions, topSections }));
  } catch (e) {
    res.writeHead(500, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
  }
}

/* ─── Admin: Rate Limit Stats ──────────────────────────────── */
async function handleRateLimitStats(req, res) {
  if ((await _adminGuard(req, res)) === null) return;
  const now    = Date.now();
  const nowSec = now / 1000;

  const blockedIPs = [];
  for (const [ip, e] of _failedAttempts) {
    if (e.blockedUntil && e.blockedUntil > now) {
      blockedIPs.push({
        ip,
        count:         e.count,
        blockedUntil:  new Date(e.blockedUntil).toISOString(),
        remainingMins: Math.ceil((e.blockedUntil - now) / 60000),
      });
    }
  }
  blockedIPs.sort((a, b) => b.count - a.count);

  const topAIConsumers = [];
  for (const [k, v] of _buckets) {
    if (!k.startsWith('ai-uid:')) continue;
    const uid       = k.slice(7);
    const elapsed   = nowSec - v.lastRefill;
    const projected = Math.min(_LIMITS.ai.byUID.free, v.tokens + elapsed * (_LIMITS.ai.byUID.free / 86400));
    topAIConsumers.push({ uid: uid.slice(0, 8) + '…', tokensRemaining: Math.floor(projected) });
  }
  topAIConsumers.sort((a, b) => a.tokensRemaining - b.tokensRemaining);

  const groqMin = _buckets.get('groq:global:min');
  const groqDay = _buckets.get('groq:global:day');

  res.writeHead(200, _apiHeaders(req));
  res.end(JSON.stringify({
    ok:             true,
    blockedIPs:     blockedIPs.slice(0, 50),
    topAIConsumers: topAIConsumers.slice(0, 20),
    groq: {
      minuteLimit:     _LIMITS.ai.global.groqMinute,
      minuteRemaining: groqMin ? Math.floor(groqMin.tokens) : _LIMITS.ai.global.groqMinute,
      dayLimit:        _LIMITS.ai.global.groqDay,
      dayRemaining:    groqDay ? Math.floor(groqDay.tokens)  : _LIMITS.ai.global.groqDay,
    },
    bucketCount:  _buckets.size,
    suspectIPs:   _failedAttempts.size,
  }));
}

/* ─── Admin: gestión de roles ───────────────────────────────── */
async function handleAdminSetRole(req, res) {
  // Requires Firebase token from a verified admin
  const uid = await _requireAuth(req, res);
  if (uid === null) return;
  if (!_isAdminUid(uid)) {
    res.writeHead(403, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Acceso denegado: se requiere rol admin' }));
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { targetUid, role } = JSON.parse(body);
      if (!targetUid || !_UID_RE.test(targetUid)) {
        res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'UID inválido' }));
      }
      _setUserRole(targetUid, role);
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true, targetUid, role }));
    } catch (e) {
      res.writeHead(400, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
    }
  });
}

async function handleAdminGetRole(req, res) {
  const uid = await _requireAuth(req, res);
  if (uid === null) return;
  if (!_isAdminUid(uid)) {
    res.writeHead(403, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Acceso denegado' }));
  }
  const targetUid = new URL(req.url, 'http://localhost').searchParams.get('uid') || '';
  if (!_UID_RE.test(targetUid)) {
    res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'UID inválido' }));
  }
  res.writeHead(200, _apiHeaders(req));
  res.end(JSON.stringify({ ok: true, uid: targetUid, role: _getUserRole(targetUid) }));
}

/* ═══════════════════════════════════════════════════════════════
   HARDENING — Protecciones adicionales del servidor
═══════════════════════════════════════════════════════════════ */

// Máximo tamaño de body aceptado en peticiones POST (50 KB)
const MAX_BODY_SIZE = 50 * 1024;

// User-Agents de herramientas de escaneo automático
const _BLOCKED_UA = [/sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i, /gobuster/i, /dirbuster/i];
function _isBlockedUA(req) {
  const ua = req.headers['user-agent'] || '';
  return _BLOCKED_UA.some(p => p.test(ua));
}

// Elimina headers que revelan tecnología (Node.js http no los envía por defecto,
// pero los eliminamos por si algún middleware futuro los añade)
function _sanitizeResHeaders(res) {
  res.removeHeader('x-powered-by');
  res.removeHeader('server');
}

// Log seguro — nunca imprime strings largos en claro (keys, tokens)
function safeLog(label, data) {
  if (typeof data === 'string' && data.length > 20) {
    console.log(`[${label}]`, data.substring(0, 8) + '...[REDACTED]');
  } else {
    console.log(`[${label}]`, typeof data === 'object' ? '[object]' : data);
  }
}

/* ─── Validación de entorno al arrancar ─────────────────────── */
function _validateEnv() {
  const warnings = [];
  const errors   = [];

  // A deployment is considered production if any of these signals are present.
  // This catches Railway deployments that may not set NODE_ENV=production.
  const isProd = process.env.NODE_ENV === 'production'
    || !!process.env.RAILWAY_ENVIRONMENT
    || !!process.env.RAILWAY_PROJECT_ID;

  if (!process.env.ALLOWED_ORIGIN && isProd)
    errors.push('ALLOWED_ORIGIN no configurado — CORS podría aceptar orígenes no deseados en producción');

  if (!process.env.FINOVA_GROQ_KEY && !process.env.FINOVA_CLAUDE_KEY)
    warnings.push('Sin FINOVA_GROQ_KEY ni FINOVA_CLAUDE_KEY — IA del servidor no disponible');

  if (!process.env.FIREBASE_PROJECT_ID)
    warnings.push('Sin FIREBASE_PROJECT_ID — verificación de revocación de tokens desactivada (válido en dev)');

  if (!process.env.FINOVA_FIREBASE_PROJECT)
    warnings.push('Sin FINOVA_FIREBASE_PROJECT — usando proyecto Firebase del código fuente como fallback');

  if (!_AUTH_ENABLED) {
    const msg = 'FINOVA_DISABLE_AUTH=true — autenticación completamente desactivada. Solo para desarrollo local.';
    if (isProd) {
      // Fatal: auth disabled in a production-like environment is a catastrophic misconfiguration
      errors.push(msg + ' NUNCA activar en producción.');
    } else {
      warnings.push(msg);
    }
  }

  if (!process.env.FINOVA_ADMIN_EMAILS)
    warnings.push('Sin FINOVA_ADMIN_EMAILS — no hay administrador configurado por variable de entorno');

  warnings.forEach(w => console.warn(`[FINOVA] ⚠️  ${w}`));

  if (errors.length > 0) {
    errors.forEach(e => console.error(`[FINOVA] ❌ ${e}`));
    if (isProd) {
      console.error('[FINOVA] 🛑 Configuración de producción inválida — el servidor no arrancará.');
      process.exit(1);
    }
  }
}
_validateEnv();

/* ─── HTTP server ────────────────────────────────────────────── */
http.createServer((req, res) => {
  // Redirigir 127.0.0.1 → localhost (Firebase Auth solo acepta 'localhost')
  if (req.headers.host && req.headers.host.startsWith('127.0.0.1')) {
    res.writeHead(301, { 'Location': `http://localhost:${PORT}${req.url}` });
    return res.end();
  }

  // ── Hardening global ──────────────────────────────────────────
  _sanitizeResHeaders(res);

  // Bloquear herramientas de escaneo automático
  if (_isBlockedUA(req)) {
    res.writeHead(403, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Forbidden' }));
  }

  // Verificar que la petición proviene del proxy de Vercel (cuando el secret está configurado)
  if (req.url.startsWith('/api/') && !_checkProxySecret(req, res)) return;

  // Rechazar bodies demasiado grandes (previene ataques de payload)
  // sync-upload y user-data aceptan hasta 8 MB; el resto se limita a 50 KB
  if (req.method === 'POST') {
    const cl = parseInt(req.headers['content-length'] || '0', 10);
    const isLargeRoute = req.url === '/api/sync-upload' || req.url === '/api/user-data';
    if (cl > (isLargeRoute ? _SYNC_MAX_BYTES : MAX_BODY_SIZE)) {
      res.writeHead(413, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Payload demasiado grande' }));
    }
  }

  // Validar Content-Type en peticiones POST a la API
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) {
      res.writeHead(415, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Unsupported Media Type' }));
    }
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  _corsOrigin(req),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
      ..._SEC,
    });
    return res.end();
  }

  // AI status
  if (req.method === 'GET' && req.url === '/api/ai-status') {
    return handleAIStatus(req, res);
  }

  // Batch market quotes (with server-side cache)
  if (req.method === 'GET' && req.url.startsWith('/api/quotes')) {
    return handleBatchQuotes(req, res);
  }

  // Yahoo Finance proxies
  if (req.method === 'GET' && req.url.startsWith('/api/yahoo-info')) {
    return handleYahooInfo(req, res);
  }
  if (req.method === 'GET' && req.url.startsWith('/api/yahoo')) {
    return handleYahooProxy(req, res);
  }

  // Exchange rates proxy
  if (req.method === 'GET' && req.url.startsWith('/api/exchange')) {
    return handleExchangeRates(req, res);
  }

  // AI proxy
  if (req.method === 'POST' && req.url === '/api/ai') {
    return handleAIProxy(req, res);
  }

  // GoCardless — Open Banking PSD2
  if (req.method === 'GET'  && req.url.startsWith('/api/bank/institutions'))  return handleBankInstitutions(req, res);
  if (req.method === 'POST' && req.url === '/api/bank/connect')               return handleBankCreateRequisition(req, res);
  if (req.method === 'GET'  && req.url.startsWith('/api/bank/requisition'))   return handleBankGetRequisition(req, res);
  if (req.method === 'POST' && req.url === '/api/bank/import')                return handleBankImport(req, res);

  // Datos de usuario autenticado
  if (req.method === 'GET'  && req.url.startsWith('/api/user-data')) return handleUserDataGet(req, res);
  if (req.method === 'POST' && req.url === '/api/user-data')         return handleUserDataPost(req, res);
  // Metadatos de usuario (email, nombre, último acceso)
  if (req.method === 'POST' && req.url === '/api/user-meta')         return handleUserMeta(req, res);
  // Admin API
  if (req.method === 'GET'  && req.url.startsWith('/api/admin/users'))    return handleAdminUsers(req, res);
  if (req.method === 'POST' && req.url === '/api/admin/block')            return handleAdminBlock(req, res);
  if (req.method === 'POST' && req.url === '/api/admin/set-admin')        return handleAdminSetAdmin(req, res);
  if (req.method === 'GET'  && req.url.startsWith('/api/admin/health'))   return handleAdminHealth(req, res);
  if (req.method === 'GET'  && req.url.startsWith('/api/admin/stats'))    return handleAdminStats(req, res);
  if (req.method === 'POST' && req.url === '/api/admin/set-role')         return handleAdminSetRole(req, res);
  if (req.method === 'GET'  && req.url.startsWith('/api/admin/get-role'))    return handleAdminGetRole(req, res);
  if (req.method === 'GET'  && req.url.startsWith('/api/admin/ratelimit'))  return handleRateLimitStats(req, res);

  // Analytics
  if (req.method === 'POST' && req.url === '/api/session') {
    return handleSession(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/stats') {
    return handleStats(req, res);
  }

  // Waitlist early adopters
  if (req.method === 'POST' && req.url === '/api/waitlist') return handleWaitlist(req, res);

  // Sync backup
  if (req.method === 'POST' && req.url === '/api/sync-upload') {
    return handleSyncUpload(req, res);
  }
  if (req.method === 'GET' && req.url.startsWith('/api/sync-download')) {
    return handleSyncDownload(req, res);
  }

  // Rutas /api/* no reconocidas — no revelar estructura interna
  if (req.url.startsWith('/api/')) {
    res.writeHead(404, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Not found' }));
  }

  // Static files — allowlist explícito, no se sirve nada fuera de esta lista.
  // ROOT es el directorio del proyecto entero (incluye server.cjs, .env*, data/,
  // .git/, node_modules/...), así que NUNCA se debe resolver un path arbitrario
  // dentro de él: solo los archivos públicos del frontend que el propio HTML referencia.
  const rawUrl = req.url.split('?')[0];
  let decodedUrl;
  try { decodedUrl = decodeURIComponent(rawUrl); } catch { decodedUrl = null; }

  const notFound = () => {
    res.writeHead(404, { 'Content-Type': 'application/json', ..._SEC });
    res.end(JSON.stringify({ error: 'Not found' }));
  };

  if (decodedUrl === null || decodedUrl.includes('\0')) return notFound();

  const relPath = decodedUrl === '/' ? 'landing.html' : decodedUrl.replace(/^\/+/, '');
  const normRel = path.posix.normalize(relPath.replace(/\\/g, '/'));

  const isAllowed =
    _PUBLIC_ROOT_FILES.has(normRel) ||
    (normRel.startsWith('src/') && normRel.endsWith('.js') && !normRel.includes('..'));
  if (!isAllowed) return notFound();

  // Defensa en profundidad: confirma que el path resuelto sigue dentro de ROOT.
  const filePath = path.resolve(ROOT, normRel);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return notFound();

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) return notFound();
    const headers = { 'Content-Type': mime, ..._SEC };
    if (ext === '.html') headers['Content-Security-Policy'] = _CSP;
    res.writeHead(200, headers);
    res.end(ext === '.js' && normRel.startsWith('src/') ? _stripImportMeta(data.toString('utf8')) : data);
  });

}).listen(PORT, '127.0.0.1', () => {
  console.log('\x1b[36m%s\x1b[0m', `
  ╔════════════════════════════════════╗
  ║   FINOVA — Servidor local listo   ║
  ║   http://localhost:${PORT}           ║
  ╚════════════════════════════════════╝
  `);
  const { exec } = require('child_process');
  exec(`start http://localhost:${PORT}`);
});
