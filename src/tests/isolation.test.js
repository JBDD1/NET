/**
 * @jest-environment node
 *
 * Finova — isolation.test.js
 * Security isolation tests: verify that auth boundaries and cross-user
 * protections are enforced by the server.
 *
 * Run against a local server:
 *   npm run start &  (or: node server.cjs &)
 *   npm run test:isolation
 *
 * Environment:
 *   TEST_SERVER_URL=http://localhost:3000  (default)
 *
 * Note: _AUTH_ENABLED=false in dev (no Firebase token required), so most
 * tests send a UID via header/body without a real Firebase token. Tests
 * that assert 401 are skipped when _AUTH_ENABLED is false.
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import http from 'http';

const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3000';

/* ── Minimal HTTP helper ─────────────────────────────────────── */
function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url  = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port:     parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  { 'Content-Type': 'application/json', ...(headers || {}) },
    };
    const reqObj = http.request(opts, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data), headers: r.headers }); }
        catch { resolve({ status: r.statusCode, body: data, headers: r.headers }); }
      });
    });
    reqObj.on('error', reject);
    if (body) reqObj.write(JSON.stringify(body));
    reqObj.end();
  });
}

/* ── UID validation (inline — mirrors server _UID_RE) ────────── */
const _UID_RE = /^[a-zA-Z0-9]{20,128}$/;

describe('UID validation (unit)', () => {
  test('rejects empty string', () => expect(_UID_RE.test('')).toBe(false));
  test('rejects too-short uid', () => expect(_UID_RE.test('abc123')).toBe(false));
  test('rejects uid with special chars', () => expect(_UID_RE.test('abc!@#$%^&*()')).toBe(false));
  test('rejects uid with path traversal', () => expect(_UID_RE.test('../etc/passwd')).toBe(false));
  test('accepts valid Firebase-style uid', () => expect(_UID_RE.test('abc123DEF456789xyz012345')).toBe(true));
  test('rejects uid over 128 chars', () => expect(_UID_RE.test('a'.repeat(129))).toBe(false));
});

/* ── Path traversal guard (unit — mirrors _auditResponse logic) ── */
import path from 'path';
describe('_auditResponse path guard (unit)', () => {
  const USERS_DIR = '/app/data/users';
  function auditPath(uid, filePath) {
    const expected = path.resolve(path.join(USERS_DIR, `${uid}.json`));
    const actual   = path.resolve(filePath);
    return actual === expected;
  }

  test('accepts matching path', () => {
    expect(auditPath('abc123DEF456789xyz0123', '/app/data/users/abc123DEF456789xyz0123.json')).toBe(true);
  });
  test('rejects path traversal attempt', () => {
    expect(auditPath('abc123DEF456789xyz0123', '/app/data/users/../../../etc/passwd')).toBe(false);
  });
  test('rejects wrong user file', () => {
    expect(auditPath('uid_user_A_00000000000', '/app/data/users/uid_user_B_00000000000.json')).toBe(false);
  });
});

/* ── Integration tests (require running server) ──────────────────
   NOTE: this reachability check must complete BEFORE the describe()
   blocks below run, because Jest decides test vs test.skip synchronously
   while collecting the file — an async beforeAll() would resolve too late
   for that decision (skipIfOffline() would always see the initial `false`).
   Top-level await is safe here: the project is ESM and Jest is invoked
   with --experimental-vm-modules. */
let serverReachable = false;
try {
  const r = await req('GET', '/api/ai-status');
  serverReachable = r.status < 500;
} catch {
  serverReachable = false;
  console.warn(`[isolation] Server not reachable at ${BASE} — skipping integration tests`);
}

function skipIfOffline() {
  if (!serverReachable) return test.skip;
  return test;
}

describe('User data endpoint isolation (integration)', () => {
  skipIfOffline()('GET /api/user-data without auth returns 401 or 200 with null in dev', async () => {
    const r = await req('GET', '/api/user-data');
    // Dev (auth disabled): may return 400 (missing uid) or 200 (null data)
    // Prod (auth enabled): must return 401
    expect([200, 400, 401]).toContain(r.status);
  });

  skipIfOffline()('GET /api/user-data with invalid UID is rejected, never leaks another path', async () => {
    const r = await req('GET', '/api/user-data?uid=../etc/passwd');
    // When auth is enabled (the default), the uid query param is ignored entirely —
    // uid comes only from the verified token, so a missing/invalid token is rejected
    // with 401 before the malformed query uid is ever inspected. If auth were disabled
    // (dev-only opt-out), the malformed uid itself would be rejected with 400.
    expect([400, 401]).toContain(r.status);
    if (r.status === 400) expect(r.body.error).toMatch(/UID/i);
  });

  skipIfOffline()('POST /api/user-data with mismatched uid in body vs token is rejected (dev: skipped)', async () => {
    // In dev _AUTH_ENABLED=false, verifiedUid=null, so mismatch check is skipped.
    // In prod this would return 403. We test that invalid UID format is rejected (400).
    const r = await req('POST', '/api/user-data', { uid: 'INVALID!', data: '{}' });
    expect([400, 401, 403]).toContain(r.status);
  });

  skipIfOffline()('POST /api/user-data oversized body is never accepted', async () => {
    const r = await req('POST', '/api/user-data', {
      uid:  'abc123DEF456789xyz012345',
      data: 'x'.repeat(9_000_000),
    });
    // 413 if the size cap is what rejects it; 401 if auth (enabled by default) rejects
    // it first — either way an oversized unauthenticated payload must never be accepted.
    expect([401, 413]).toContain(r.status);
    expect(r.status).not.toBe(200);
  });
});

describe('Yahoo Finance proxy isolation (integration)', () => {
  skipIfOffline()('GET /api/yahoo without ticker returns 400', async () => {
    const r = await req('GET', '/api/yahoo');
    expect(r.status).toBe(400);
  });

  skipIfOffline()('GET /api/exchange returns rates object', async () => {
    const r = await req('GET', '/api/exchange');
    // May return 200 with rates or 502 if external API is down
    expect([200, 502, 429, 503]).toContain(r.status);
    if (r.status === 200) {
      expect(r.body).toHaveProperty('rates');
      expect(typeof r.body.rates).toBe('object');
    }
  });
});

describe('Sync endpoint isolation (integration)', () => {
  skipIfOffline()('GET /api/sync-download without code returns error', async () => {
    const r = await req('GET', '/api/sync-download');
    expect([400, 401, 404]).toContain(r.status);
  });

  skipIfOffline()('POST /api/sync-upload without auth returns 401 in prod / 400 in dev', async () => {
    const r = await req('POST', '/api/sync-upload', { code: 'test-code', data: '{}' });
    expect([400, 401]).toContain(r.status);
  });
});

/* ── Static file server: no source/config/data disclosure, no traversal ── */
describe('Static file allowlist (integration)', () => {
  skipIfOffline()('server source code is not servable', async () => {
    const r = await req('GET', '/server.cjs');
    expect(r.status).toBe(404);
  });

  skipIfOffline()('private data files are not servable', async () => {
    for (const p of ['/data/waitlist.json', '/data/analytics.json', '/data/roles.json', '/data/ratelimit.json']) {
      const r = await req('GET', p);
      expect(r.status).toBe(404);
    }
  });

  skipIfOffline()('env / git / package files are not servable', async () => {
    for (const p of ['/.env.local', '/.env.server', '/.git/config', '/package.json', '/vercel.json']) {
      const r = await req('GET', p);
      expect(r.status).toBe(404);
    }
  });

  skipIfOffline()('literal .. traversal outside the project root is rejected', async () => {
    const r = await req('GET', '/../../../../etc/passwd');
    expect(r.status).toBe(404);
  });

  skipIfOffline()('encoded traversal inside an otherwise-allowed src/ prefix is rejected', async () => {
    const r = await req('GET', '/src/%2e%2e/%2e%2e/server.cjs');
    expect(r.status).toBe(404);
  });

  skipIfOffline()('legitimate frontend assets are still served', async () => {
    const r1 = await req('GET', '/');
    expect(r1.status).toBe(200);
    const r2 = await req('GET', '/style.css');
    expect(r2.status).toBe(200);
    const r3 = await req('GET', '/src/core/script.js');
    expect(r3.status).toBe(200);
  });
});

/* ── GoCardless requisition ownership (IDOR/BOLA) ────────────────
   User A must never be able to read or import User B's bank connection
   by supplying a requisitionId they don't own. */
describe('Bank connection (GoCardless) ownership isolation (integration)', () => {
  skipIfOffline()('GET /api/bank/requisition for an unowned/unknown id is rejected, not leaked', async () => {
    const r = await req('GET', '/api/bank/requisition?id=not-owned-by-anyone-00000');
    // 503 if GoCardless isn't configured in this environment, 401 if auth is required
    // and missing, 403 once ownership is checked — never 200 with bank data.
    expect([401, 403, 503]).toContain(r.status);
  });

  skipIfOffline()('POST /api/bank/import for an unowned/unknown requisitionId is rejected, not leaked', async () => {
    const r = await req('POST', '/api/bank/import', { requisitionId: 'not-owned-by-anyone-00000' });
    expect([401, 403, 503]).toContain(r.status);
  });
});

/* ── CSRF: state-mutating endpoints must validate Origin/Referer ── */
describe('CSRF Origin/Referer guard (integration)', () => {
  skipIfOffline()('POST /api/user-data from a forged Origin is rejected', async () => {
    const r = await req('POST', '/api/user-data',
      { data: '{}' },
      { Origin: 'https://evil-attacker-site.example' });
    expect([400, 401, 403]).toContain(r.status);
    expect(r.status).not.toBe(200);
  });

  skipIfOffline()('POST /api/user-meta from a forged Origin is rejected', async () => {
    const r = await req('POST', '/api/user-meta',
      { uid: 'abc123DEF456789xyz012345', email: 'x@example.com' },
      { Origin: 'https://evil-attacker-site.example' });
    expect([400, 401, 403]).toContain(r.status);
    expect(r.status).not.toBe(200);
  });
});

/* ── Security headers present on every response ── */
describe('Security headers (integration)', () => {
  skipIfOffline()('API responses carry core hardening headers', async () => {
    const r = await req('GET', '/api/ai-status');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
  });

  skipIfOffline()('unknown /api/* routes return a generic 404 without leaking structure', async () => {
    const r = await req('GET', '/api/this-route-does-not-exist');
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|ENOENT|at Object|node_modules/i);
  });
});

/* ── Admin endpoints: broken access control ── */
describe('Admin endpoint access control (integration)', () => {
  skipIfOffline()('GET /api/admin/users without a valid admin token is rejected', async () => {
    const r = await req('GET', '/api/admin/users');
    expect([401, 403]).toContain(r.status);
  });

  skipIfOffline()('POST /api/admin/set-admin without a valid admin token is rejected', async () => {
    const r = await req('POST', '/api/admin/set-admin', { targetEmail: 'victim@example.com', isAdmin: true });
    expect([401, 403]).toContain(r.status);
  });

  skipIfOffline()('POST /api/admin/set-role cannot be used to self-promote without a valid admin token', async () => {
    const r = await req('POST', '/api/admin/set-role', { targetUid: 'abc123DEF456789xyz012345', role: 'admin' });
    expect([400, 401, 403]).toContain(r.status);
  });
});
