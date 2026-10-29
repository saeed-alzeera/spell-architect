/*
 * Run store for Spell Architect analytics.
 *
 *   POST /runs                          PUBLIC: one finished run (JSON, the game's RunRecord). Idempotent by id.
 *   GET  /runs?version=&build=&since=&limit=&after=   ADMIN (Authorization: Bearer <ADMIN_KEY>)
 *                                       -> { runs, next }  oldest first, `next` is the cursor for `after` (null at the end)
 *
 * The game queues every finished (non-sandbox) run and uploads it from the player's browser. Records carry the game
 * version and build they were played on, so results can be compared across versions (tools/analyze.mjs).
 * Nothing identifies a player: `installId` is a random id made by the browser.
 */

const MAX_BYTES = 64 * 1024;
const MAX_LIMIT = 1000;
const RESULTS = new Set(['won', 'lost', 'abandoned']);
const ROLES = new Set(['solo', 'host', 'guest']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
}
const fail = (status, message) => json({ error: message }, status);

const num = (v, max = 1e9) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Returns an error message, or null when the record is acceptable. */
export function validateRun(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'Not an object';
  if (!str(r.id, 80)) return 'Bad id';
  if (r.sandbox) return 'Sandbox runs are not recorded';
  if (!RESULTS.has(r.result)) return 'Bad result';
  if (!str(r.gameVersion, 24)) return 'Missing gameVersion';
  if (r.build !== undefined && !str(r.build, 24)) return 'Bad build';
  if (r.installId !== undefined && !str(r.installId, 64)) return 'Bad installId';
  if (r.role !== undefined && !ROLES.has(r.role)) return 'Bad role';
  if (!(num(r.startedAt, 4e12) && num(r.endedAt, 4e12) && r.endedAt >= r.startedAt)) return 'Bad timestamps';
  for (const k of ['reachedRound', 'time', 'level', 'kills', 'damage', 'taken', 'bosses', 'reactions', 'shards']) if (!num(r[k])) return `Bad ${k}`;
  if (r.players !== undefined && !(Number.isInteger(r.players) && r.players >= 1 && r.players <= 4)) return 'Bad players';
  if (!Array.isArray(r.spells) || !Array.isArray(r.relics) || !Array.isArray(r.roundLog)) return 'Bad lists';
  return null;
}

const pad = (n) => String(Math.floor(n)).padStart(13, '0');

/** Storage logic, independent of the Durable Object so it can be unit-tested. `storage` needs get/put/list. */
export class RunStoreCore {
  constructor(storage) { this.storage = storage; }

  /** Stores a run. Returns { ok, duplicate }. */
  async put(rec) {
    const seen = await this.storage.get(`i:${rec.id}`);
    if (seen) return { ok: true, duplicate: true };
    const key = `r:${pad(rec.endedAt)}:${rec.id}`;
    await this.storage.put(key, rec);
    await this.storage.put(`i:${rec.id}`, key);
    return { ok: true, duplicate: false };
  }

  /** Oldest first, optionally filtered by version/build, starting after the cursor `after` (a storage key). */
  async list({ version, build, since = 0, limit = 200, after } = {}) {
    const out = [];
    let cursor = after;
    let next = null;
    limit = Math.min(MAX_LIMIT, Math.max(1, limit));
    // Scan in storage order; filters are applied here, the page is `limit` matching runs.
    for (;;) {
      const opts = { prefix: 'r:', limit: 200 };
      if (cursor) opts.startAfter = cursor;
      else if (since) opts.start = `r:${pad(since)}`;
      const batch = await this.storage.list(opts);
      if (!batch.size) break;
      for (const [key, rec] of batch) {
        cursor = key;
        if (version && rec.gameVersion !== version) continue;
        if (build && rec.build !== build) continue;
        out.push(rec);
        if (out.length >= limit) return { runs: out, next: key };
      }
      if (batch.size < 200) break;
    }
    return { runs: out, next };
  }
}

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Crude per-isolate throttle on uploads.
const posts = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (posts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (list.length >= 60) { posts.set(ip, list); return true; }
  list.push(now); posts.set(ip, list);
  if (posts.size > 5000) posts.clear();
  return false;
}

/** Routes /runs. `env.RUNS` is the RunStore Durable Object namespace, `env.ADMIN_KEY` the read key. */
export async function handleRuns(request, env, parts) {
  const stub = env.RUNS.get(env.RUNS.idFromName('main'));
  if (parts.length !== 1) return fail(404, 'Not found');

  if (request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (throttled(ip)) return fail(429, 'Too many uploads, try again later');
    const text = await request.text();
    if (text.length > MAX_BYTES) return fail(413, 'Run too large');
    let rec;
    try { rec = JSON.parse(text); } catch { return fail(400, 'Invalid JSON'); }
    const bad = validateRun(rec);
    if (bad) return fail(400, bad);
    const res = await stub.put(rec);
    return json(res, res.duplicate ? 200 : 201);
  }

  if (request.method === 'GET') {
    if (!env.ADMIN_KEY) return fail(503, 'ADMIN_KEY is not set on the worker');
    const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!same(given, env.ADMIN_KEY)) return fail(401, 'Unauthorized');
    const u = new URL(request.url);
    return json(await stub.list({
      version: u.searchParams.get('version') || undefined,
      build: u.searchParams.get('build') || undefined,
      since: Math.max(0, Number(u.searchParams.get('since')) || 0),
      limit: Number(u.searchParams.get('limit')) || 200,
      after: u.searchParams.get('after') || undefined,
    }));
  }
  return fail(405, 'Method not allowed');
}
