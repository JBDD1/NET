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
const ADMIN_EMAILS = (process.env.FINOVA_ADMIN_EMAILS || 'MyFinova1@gmail.com')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
function _isAdminUid(uid) {
  if (!uid || !_UID_RE.test(uid)) return false;
  const meta = _readMeta(uid);
  if (!meta) return false;
  const email = (meta.email || '').toLowerCase();
  if (ADMIN_EMAILS.includes(email)) return true;
  try {
    const extra = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'extra_admins.json'), 'utf8'));
    return Array.isArray(extra) && extra.includes(email);
  } catch { return false; }
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
  return _ALLOWED_ORIGINS.has(o) ? o : `http://localhost:${PORT}`;
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

/* ═══════════════════════════════════════════════════════════════
   SEGURIDAD — Headers HTTP y CSP
═══════════════════════════════════════════════════════════════ */
const _SEC = {
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
  'X-XSS-Protection':             '1; mode=block',
  'Referrer-Policy':              'strict-origin-when-cross-origin',
  'Permissions-Policy':           'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), fullscreen=(self), picture-in-picture=(), interest-cohort=()',
  'Strict-Transport-Security':    'max-age=31536000; includeSubDomains; preload',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy':   'same-origin',
};

// Content Security Policy — aplicado a respuestas HTML
const _CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.gstatic.com https://apis.google.com",
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
  return {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': _corsOrigin(req),
    'Vary':                        'Origin',
    'Cache-Control':               'no-store, no-cache, must-revalidate, private',
    'Pragma':                      'no-cache',
    'Expires':                     '0',
    ...(e || {}),
    ..._SEC,
  };
}

/* ═══════════════════════════════════════════════════════════════
   RATE LIMITER — in-memory, por ruta+IP
═══════════════════════════════════════════════════════════════ */
const _rlMap = new Map(); // `${ruta}:${ip}` → { count, resetAt }

function _rateOk(route, ip, maxPerMin) {
  const key = route + ':' + ip;
  const now  = Date.now();
  let e = _rlMap.get(key);
  if (!e || e.resetAt <= now) {
    e = { count: 0, resetAt: now + 60_000 };
    _rlMap.set(key, e);
  }
  e.count++;
  return e.count <= maxPerMin;
}

// Token bucket — permite bursts cortos pero penaliza el abuso sostenido.
// maxTokens: capacidad máxima del bucket | refillPerSec: tokens que se regeneran por segundo
const _tbMap = new Map(); // key → { tokens, lastRefill }

function _tokenBucketOk(key, maxTokens, refillPerSec) {
  const nowSec = Date.now() / 1000;
  let b = _tbMap.get(key);
  if (!b) { b = { tokens: maxTokens, lastRefill: nowSec }; _tbMap.set(key, b); }
  const elapsed = nowSec - b.lastRefill;
  b.tokens = Math.min(maxTokens, b.tokens + elapsed * refillPerSec);
  b.lastRefill = nowSec;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// Global Groq counter — tracks total server-key usage across all IPs.
// Free plan: 30 req/min, 14 400 req/day for llama-3.3-70b-versatile.
// We cap at 25/min and 12 000/day to leave headroom for bursts.
const _groqGlobal = { min: 0, minReset: 0, day: 0, dayReset: 0 };
function _groqGlobalOk() {
  const now = Date.now();
  if (now >= _groqGlobal.minReset) { _groqGlobal.min = 0; _groqGlobal.minReset = now + 60_000; }
  if (now >= _groqGlobal.dayReset) { _groqGlobal.day = 0; _groqGlobal.dayReset = now + 86_400_000; }
  if (_groqGlobal.min >= 25 || _groqGlobal.day >= 12_000) return false;
  _groqGlobal.min++;
  _groqGlobal.day++;
  return true;
}

// Per-UID daily AI quota: free=5/day, premium=50/day, admin=unlimited
const _aiUidMap = new Map(); // uid → { count, resetAt }
const _AI_DAILY_LIMITS = { free: 5, premium: 50 };

function _aiUidRateOk(uid, role) {
  if (role === 'admin') return true;
  const limit = _AI_DAILY_LIMITS[role] || _AI_DAILY_LIMITS.free;
  const now   = Date.now();
  let e = _aiUidMap.get(uid);
  if (!e || e.resetAt <= now) {
    e = { count: 0, resetAt: now + 86_400_000 };
    _aiUidMap.set(uid, e);
  }
  if (e.count >= limit) return false;
  e.count++;
  return true;
}

// Limpieza de entradas expiradas cada 5 minutos
setInterval(() => {
  const now    = Date.now();
  const nowSec = now / 1000;
  for (const [k, v] of _rlMap)    if (v.resetAt <= now)                _rlMap.delete(k);
  for (const [k, v] of _aiUidMap) if (v.resetAt <= now)                _aiUidMap.delete(k);
  for (const [k, v] of _tbMap)    if (v.lastRefill < nowSec - 3600)    _tbMap.delete(k);
}, 300_000).unref();

function _clientIp(req) {
  return ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1')
    .split(',')[0].trim());
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
  try {
    const urlObj  = new URL(req.url, 'http://localhost');
    const symbols = (urlObj.searchParams.get('symbols') || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
    if (!symbols.length) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Parámetro symbols requerido' }));
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
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const ticker = urlObj.searchParams.get('ticker');
    if (!ticker) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Missing ticker' }));
    }
    const t     = ticker.trim().toUpperCase();
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
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const ticker = urlObj.searchParams.get('ticker');
    if (!ticker) {
      res.writeHead(400, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'Missing ticker' }));
    }
    const apiPath = `/v10/finance/quoteSummary/${encodeURIComponent(ticker.trim().toUpperCase())}?modules=assetProfile`;
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
    res.writeHead(500, _apiHeaders(req));
    res.end(JSON.stringify({ error: err.message }));
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

  // 2. Per-UID daily quota (free: 5/day, premium: 50/day, admin: unlimited)
  const role = _getUserRole(uid);
  if (uid && !_aiUidRateOk(uid, role)) {
    const limit = _AI_DAILY_LIMITS[role] || _AI_DAILY_LIMITS.free;
    res.writeHead(429, _apiHeaders(req, { 'Retry-After': '86400' }));
    return res.end(JSON.stringify({
      error: `Has alcanzado el límite diario de ${limit} consultas (plan ${role === 'premium' ? 'Premium' : 'Gratuito'}).${role !== 'premium' ? ' Mejora a Premium para 50 consultas/día.' : ' Vuelve mañana.'}`,
      limitReached: true, role, limit,
    }));
  }

  // 3. Per-IP token bucket (15 tokens, refill 0.25/s = ~15/min sostenido, burst de 15)
  const ip = _clientIp(req);
  if (!_tokenBucketOk(`ai:${ip}`, 15, 0.25)) {
    res.writeHead(429, _apiHeaders(req, { 'Retry-After': '60' }));
    return res.end(JSON.stringify({ error: 'Demasiadas peticiones al Asesor IA. Espera un minuto e inténtalo de nuevo.' }));
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { provider, apiKey, messages, systemPrompt } = JSON.parse(body);
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
      res.writeHead(err.status || 500, _apiHeaders(req));
      res.end(JSON.stringify({ error: err.message || 'Error desconocido' }));
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
                         'No autorizado: ' + e.message,
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
    res.writeHead(e.message.includes('timeout') ? 504 : 500, _apiHeaders(req));
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleBankCreateRequisition(req, res) {
  if ((await _requireAuth(req, res)) === null) return;
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    res.writeHead(503, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'GoCardless no configurado.' }));
  }
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
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ requisitionId: req2.id, link: req2.link }));
    } catch (e) {
      res.writeHead(e.message.includes('timeout') ? 504 : 500, _apiHeaders(req));
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

async function handleBankGetRequisition(req, res) {
  if ((await _requireAuth(req, res)) === null) return;
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    res.writeHead(503, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'GoCardless no configurado.' }));
  }
  try {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
    if (!id) { res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'id requerido' })); }
    const data = await _gcCall('GET', `/api/v2/requisitions/${id}/`, null);
    res.writeHead(200, _apiHeaders(req));
    res.end(JSON.stringify({ status: data.status, accounts: data.accounts || [] }));
  } catch (e) {
    res.writeHead(e.message.includes('timeout') ? 504 : 500, _apiHeaders(req));
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleBankImport(req, res) {
  if ((await _requireAuth(req, res)) === null) return;
  if (!GC_SECRET_ID || !GC_SECRET_KEY) {
    res.writeHead(503, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'GoCardless no configurado.' }));
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { requisitionId } = JSON.parse(body);
      if (!requisitionId) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'requisitionId requerido' }));
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
      res.writeHead(e.message.includes('timeout') ? 504 : 500, _apiHeaders(req));
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   SEGURIDAD — Firebase JWT verification + AES-256-GCM encryption
═══════════════════════════════════════════════════════════════ */

// Firebase project — used to verify JWT iss / aud claims.
// Override with FINOVA_FIREBASE_PROJECT=DISABLED to skip token verification (local dev only).
const _FIREBASE_PROJECT = process.env.FINOVA_FIREBASE_PROJECT || 'finova-92100';
const _AUTH_ENABLED     = _FIREBASE_PROJECT !== 'DISABLED';

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

async function handleUserDataGet(req, res) {
  const ip = _clientIp(req);
  if (!_rateOk('user-get', ip, 30)) {
    res.writeHead(429, _apiHeaders(req, { 'Retry-After': '60' }));
    return res.end(JSON.stringify({ error: 'Demasiadas peticiones. Espera un minuto.' }));
  }

  // Verify Firebase ID token — the UID is extracted from the verified token,
  // never trusted from the query string.
  let uid;
  if (_AUTH_ENABLED) {
    try {
      uid = await _verifyFirebaseToken(req.headers['authorization']);
    } catch (e) {
      res.writeHead(401, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'No autorizado: ' + e.message }));
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
    res.writeHead(500, _apiHeaders(req));
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleUserDataPost(req, res) {
  if (!_originOk(req)) {
    res.writeHead(403, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Origen no permitido' }));
  }
  const ip = _clientIp(req);
  if (!_rateOk('user-post', ip, 30)) {
    res.writeHead(429, _apiHeaders(req, { 'Retry-After': '60' }));
    return res.end(JSON.stringify({ error: 'Demasiadas peticiones. Espera un minuto.' }));
  }

  // Verify token before streaming body — Node.js buffers request data during the await.
  let verifiedUid = null;
  if (_AUTH_ENABLED) {
    try {
      verifiedUid = await _verifyFirebaseToken(req.headers['authorization']);
    } catch (e) {
      res.writeHead(401, _apiHeaders(req));
      return res.end(JSON.stringify({ error: 'No autorizado: ' + e.message }));
    }
  }

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
      const { uid, data } = JSON.parse(body);
      if (!uid || !_UID_RE.test(uid)) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'UID inválido' }));
      }
      // Token UID must match the UID in the request body.
      if (verifiedUid !== null && verifiedUid !== uid) {
        res.writeHead(403, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Acceso denegado' }));
      }
      if (typeof data !== 'string' || data.length > _SYNC_MAX_BYTES) {
        res.writeHead(400, _apiHeaders(req));
        return res.end(JSON.stringify({ error: 'Payload inválido' }));
      }
      const toWrite = _encryptUserData(data);
      fs.writeFileSync(path.join(USERS_DIR, `${uid}.json`), toWrite, 'utf8');
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true, saved: new Date().toISOString() }));
    } catch (e) {
      res.writeHead(500, _apiHeaders(req));
      res.end(JSON.stringify({ error: e.message }));
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
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { clientId, txCount, section } = JSON.parse(body);
      if (!/^[0-9a-f-]{32,36}$/.test(clientId)) {
        res.writeHead(400, _apiHeaders(req)); return res.end(JSON.stringify({ error: 'Invalid clientId' }));
      }
      const today = _todayUTC();
      const data  = _loadAnalytics();
      if (!data[clientId]) data[clientId] = { firstSeen: today, sessions: [], txCount: 0, sections: {} };
      const c = data[clientId];
      if (!c.sessions.includes(today)) c.sessions.push(today);
      c.txCount = Math.max(c.txCount || 0, txCount || 0);
      if (section && typeof section === 'string' && section.length < 40) {
        if (!c.sections) c.sections = {};
        c.sections[section] = (c.sections[section] || 0) + 1;
      }
      _saveAnalytics(data);
      res.writeHead(200, _apiHeaders(req));
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, _apiHeaders(req)); res.end(JSON.stringify({ error: e.message }));
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
  const ip = (req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  if (!_rateOk('/api/waitlist', ip, 5)) {
    res.writeHead(429, _apiHeaders(req));
    return res.end(JSON.stringify({ error: 'Demasiadas peticiones. Inténtalo más tarde.' }));
  }
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
  // Verificar token ANTES de leer el body (Node.js no pierde datos durante el await)
  if ((await _requireAuth(req, res)) === null) return;
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
      res.writeHead(500, _apiHeaders(req));
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

async function handleSyncDownload(req, res) {
  // Rate limit: 10 peticiones por minuto por IP — evita enumeración de códigos de sync
  const ip = _clientIp(req);
  if (!_rateOk('sync-dl', ip, 10)) {
    res.writeHead(429, _apiHeaders(req, { 'Retry-After': '60' }));
    return res.end(JSON.stringify({ error: 'Demasiadas peticiones. Espera un minuto.' }));
  }

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
      return res.end(JSON.stringify({ error: 'No autorizado: ' + e.message }));
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
      res.writeHead(500, _apiHeaders(req));
      res.end(JSON.stringify({ error: e.message }));
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
  if (req.method === 'GET'  && req.url.startsWith('/api/admin/get-role')) return handleAdminGetRole(req, res);

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

  // Static files
  const url      = req.url.split('?')[0];
  const filePath = path.join(ROOT, url === '/' ? 'index.html' : url);
  const ext      = path.extname(filePath).toLowerCase();
  const mime     = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'application/json', ..._SEC }); return res.end(JSON.stringify({ error: 'Not found' })); }
    const headers = { 'Content-Type': mime, ..._SEC };
    if (ext === '.html' || url === '/') headers['Content-Security-Policy'] = _CSP;
    res.writeHead(200, headers);
    res.end(data);
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
