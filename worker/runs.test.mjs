// node --test worker/mp.test.mjs worker/runs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { RunStoreCore, handleRuns, validateRun } from './runs.js';

// Minimal Durable Object storage: ordered keys with get/put/list({prefix,start,startAfter,limit}).
function memStorage() {
  const m = new Map();
  const sorted = () => [...m.keys()].sort();
  return {
    get: async (k) => m.get(k),
    delete: async (k) => { m.delete(k); },
    put: async (k, v) => { m.set(k, structuredClone(v)); },
    list: async ({ prefix = '', start, startAfter, limit = 1e9 } = {}) => {
      const out = new Map();
      for (const k of sorted()) {
        if (!k.startsWith(prefix)) continue;
        if (start && k < start) continue;
        if (startAfter && k <= startAfter) continue;
        out.set(k, m.get(k));
        if (out.size >= limit) break;
      }
      return out;
    },
  };
}
const run = (over = {}) => ({
  id: 'a-1', v: 2, gameVersion: '1.1.0', build: 'abc1234', installId: 'x', players: 1, role: 'solo', sandbox: false, quick: false,
  result: 'lost', startedAt: 1000, endedAt: 2000, reachedRound: 3, time: 120, level: 5, kills: 40, damage: 900, taken: 80,
  bosses: 0, reactions: 2, shards: 12, spells: [], relics: [], roundLog: [], discoveries: [], ...over,
});
function fakeEnv(adminKey) {
  const core = new RunStoreCore(memStorage());
  return { ADMIN_KEY: adminKey, RUNS: { idFromName: () => 'main', get: () => core } };
}
const call = async (env, method, path, body, key) => {
  const url = 'https://x.test' + path;
  const req = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'CF-Connecting-IP': '9.9.9.' + Math.floor(Math.random() * 250), ...(key ? { Authorization: 'Bearer ' + key } : {}) } });
  const res = await handleRuns(req, env, new URL(url).pathname.split('/').filter(Boolean));
  return { status: res.status, body: await res.json() };
};

test('validateRun accepts a normal run and rejects bad ones', () => {
  assert.equal(validateRun(run()), null);
  assert.match(validateRun(run({ sandbox: true })), /Sandbox/);
  assert.match(validateRun(run({ gameVersion: undefined })), /gameVersion/);
  assert.match(validateRun(run({ result: 'cheated' })), /result/);
  assert.match(validateRun(run({ kills: -1 })), /kills/);
  assert.match(validateRun(run({ endedAt: 5, startedAt: 10 })), /timestamps/);
  assert.match(validateRun(run({ players: 9 })), /players/);
  assert.match(validateRun('x'), /object/);
});

test('validateRun accepts v3 telemetry and rejects malformed telemetry', () => {
  const q = { round: 1, boss: false, secs: 45, kills: 3, damage: 10, taken: 0, hpEnd: 90, maxHp: 100, coins: 1, level: 2, spells: [], relics: [], tel: { t0: 0, spawned: 3, hpPool: 40 } };
  assert.equal(validateRun(run({ v: 3, roundLog: [q], acq: [{ t: 1, r: 1, k: 'relic', id: 'mirror' }] })), null);
  assert.match(validateRun(run({ roundLog: [{ ...q, tel: 'x' }] })), /roundLog entry/);
  assert.match(validateRun(run({ roundLog: [null] })), /roundLog entry/);
  assert.match(validateRun(run({ acq: 'x' })), /acq/);
  assert.match(validateRun(run({ acq: new Array(501).fill({}) })), /acq/);
  assert.match(validateRun(run({ roundLog: new Array(101).fill(q) })), /roundLog/);
});

test('a large v3 record under the size cap is accepted, an oversized one is refused', async () => {
  const env = fakeEnv('k');
  const q = (i) => ({ round: i, boss: false, secs: 45, kills: 3, damage: 10, taken: 0, hpEnd: 90, maxHp: 100, coins: 1, level: 2, spells: [], relics: [], tel: { t0: i, pad: 'x'.repeat(2500) } });
  const big = run({ id: 'big-1', v: 3, roundLog: Array.from({ length: 20 }, (_, i) => q(i + 1)) }); // ~55 KB: over the old 64 KB cap once real telemetry is added
  assert.equal((await call(env, 'POST', '/runs', big)).status, 201);
  const huge = run({ id: 'huge-1', v: 3, roundLog: Array.from({ length: 60 }, (_, i) => ({ ...q(i + 1), tel: { pad: 'x'.repeat(2500) } })) }); // > 125 KB
  assert.equal((await call(env, 'POST', '/runs', huge)).status, 413);
});

test('upload is idempotent', async () => {
  const env = fakeEnv('k');
  assert.equal((await call(env, 'POST', '/runs', run())).status, 201);
  const again = await call(env, 'POST', '/runs', run());
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal((await call(env, 'GET', '/runs', undefined, 'k')).body.runs.length, 1);
});

test('reads need the admin key', async () => {
  const env = fakeEnv('secret');
  await call(env, 'POST', '/runs', run());
  assert.equal((await call(env, 'GET', '/runs')).status, 401);
  assert.equal((await call(env, 'GET', '/runs', undefined, 'wrong')).status, 401);
  assert.equal((await call(env, 'GET', '/runs', undefined, 'secret')).status, 200);
  assert.equal((await call(fakeEnv(undefined), 'GET', '/runs', undefined, 'x')).status, 503);
});

test('invalid and oversized uploads are refused', async () => {
  const env = fakeEnv('k');
  assert.equal((await call(env, 'POST', '/runs', run({ result: 'x' }))).status, 400);
  assert.equal((await call(env, 'POST', '/runs', run({ id: 'big', roundLog: ['x'.repeat(130000)] }))).status, 413);
});

test('list filters by version and pages oldest first', async () => {
  const env = fakeEnv('k');
  for (let i = 0; i < 5; i++) await call(env, 'POST', '/runs', run({ id: 'r' + i, endedAt: 2000 + i, gameVersion: i % 2 ? '1.1.0' : '1.0.0' }));
  const v11 = await call(env, 'GET', '/runs?version=1.1.0', undefined, 'k');
  assert.deepEqual(v11.body.runs.map((r) => r.id), ['r1', 'r3']);
  const p1 = await call(env, 'GET', '/runs?limit=2', undefined, 'k');
  assert.deepEqual(p1.body.runs.map((r) => r.id), ['r0', 'r1']);
  const p2 = await call(env, 'GET', '/runs?limit=2&after=' + encodeURIComponent(p1.body.next), undefined, 'k');
  assert.deepEqual(p2.body.runs.map((r) => r.id), ['r2', 'r3']);
  const since = await call(env, 'GET', '/runs?since=2003', undefined, 'k');
  assert.deepEqual(since.body.runs.map((r) => r.id), ['r3', 'r4']);
});

test('notes: admin-only, save, list, delete', async () => {
  const env = fakeEnv('k');
  assert.equal((await call(env, 'GET', '/runs/notes')).status, 401);
  assert.equal((await call(env, 'POST', '/runs/notes', { id: 'crit', text: 'x' })).status, 401);
  assert.equal((await call(env, 'POST', '/runs/notes', { id: 'crit', text: 'too strong' }, 'k')).status, 200);
  assert.equal((await call(env, 'POST', '/runs/notes', { id: '', text: 'x' }, 'k')).status, 400);
  const l = await call(env, 'GET', '/runs/notes', undefined, 'k');
  assert.equal(l.body.notes.length, 1);
  assert.equal(l.body.notes[0].text, 'too strong');
  await call(env, 'POST', '/runs/notes', { id: 'crit', text: '' }, 'k');
  assert.equal((await call(env, 'GET', '/runs/notes', undefined, 'k')).body.notes.length, 0);
});
