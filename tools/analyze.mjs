#!/usr/bin/env node
// Compare Spell Architect runs across game versions.
//
//   ADMIN_KEY=... node tools/analyze.mjs                  # pull from the worker and compare all versions
//   node tools/analyze.mjs --file runs.json               # analyse an exported file (Run History > Export JSON) instead
//   Options: --solo | --coop   --quick | --normal   --version 1.1.0   --base https://...workers.dev
//
// Per version: runs, win rate, round reached, survival time, damage/kill rates and top death causes, with a rough 95% interval
// on the win rate and on mean round, so small samples are not over-read. Abandoned runs and sandbox runs are left out.
// For one run in depth (slots, relics, timelines) use tools/run-report.mjs.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (opt('base') || 'https://spell-architect-mp.saeed-a-alzeera.workers.dev').replace(/\/$/, '');

async function load() {
  const file = opt('file');
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const key = process.env.ADMIN_KEY;
  if (!key) { console.error('Set ADMIN_KEY (or pass --file runs.json).'); process.exit(1); }
  const runs = [];
  let after = '';
  for (;;) {
    const res = await fetch(`${BASE}/runs?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}${opt('version') ? `&version=${opt('version')}` : ''}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) { console.error(`GET /runs failed: ${res.status} ${await res.text()}`); process.exit(1); }
    const page = await res.json();
    runs.push(...page.runs);
    if (!page.next) break;
    after = page.next;
  }
  return runs;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
/** Wilson 95% interval for a proportion. */
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}

let runs = (await load()).filter((r) => !r.sandbox && r.result !== 'abandoned');
if (flag('solo')) runs = runs.filter((r) => (r.players ?? 1) === 1);
if (flag('coop')) runs = runs.filter((r) => (r.players ?? 1) > 1);
if (flag('quick')) runs = runs.filter((r) => r.quick);
if (flag('normal')) runs = runs.filter((r) => !r.quick);
if (opt('version')) runs = runs.filter((r) => r.gameVersion === opt('version'));

const groups = new Map();
for (const r of runs) {
  const k = r.gameVersion || 'unversioned';
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const cmpVer = (a, b) => a.split('.').map(Number).reduce((d, x, i) => d || (x - (b.split('.').map(Number)[i] || 0)), 0);
const versions = [...groups.keys()].sort(cmpVer);
if (!versions.length) { console.log('No runs match.'); process.exit(0); }

console.log(`\n${runs.length} runs, ${new Set(runs.map((r) => r.installId).filter(Boolean)).size} players\n`);
let prev;
for (const v of versions) {
  const g = groups.get(v);
  const wins = g.filter((r) => r.result === 'won').length;
  const [lo, hi] = wilson(wins, g.length);
  const rounds = g.map((r) => r.reachedRound);
  const secs = g.map((r) => r.time);
  const dps = g.map((r) => r.damage / Math.max(1, r.time));
  const kpm = g.map((r) => r.kills / Math.max(1, r.time / 60));
  const half = 1.96 * sd(rounds) / Math.sqrt(g.length);
  const builds = [...new Set(g.map((r) => r.build).filter(Boolean))];
  console.log(`v${v}  (${g.length} runs${builds.length ? `, builds ${builds.join(', ')}` : ''})`);
  console.log(`  win rate       ${pct(wins / g.length)}   95% CI ${pct(lo)}-${pct(hi)}`);
  console.log(`  round reached  ${mean(rounds).toFixed(2)} ± ${half.toFixed(2)}   survival ${fmtT(mean(secs))}`);
  console.log(`  damage/s ${mean(dps).toFixed(0)}   kills/min ${mean(kpm).toFixed(0)}   damage taken/run ${mean(g.map((r) => r.taken)).toFixed(0)}`);
  // Telemetry (records from game 1.3.1 on, `v: 3`): is damage capped by the spawn? Compare builds by sat and by what is left alive, not by raw damage.
  const tel = g.flatMap((r) => (r.roundLog || []).filter((q) => q.tel && !q.boss && !q.partial && q.tel.hpPool > 0));
  if (tel.length) {
    const sat = tel.map((q) => q.damage / q.tel.hpPool);
    console.log(`  telemetry      ${tel.length} rounds: damage / enemy HP spawned ${mean(sat).toFixed(2)} (near 1 = build clears the spawn, damage totals then only mirror enemy HP)   enemies left alive at round end ${mean(tel.map((q) => q.tel.alive)).toFixed(1)}   mean enemy life ${mean(tel.map((q) => q.tel.life)).toFixed(1)}s`);
  }
  const deaths = {};
  for (const r of g) if (r.result === 'lost' && r.deathCause) deaths[r.deathCause] = (deaths[r.deathCause] || 0) + 1;
  const top = Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ');
  if (top) console.log(`  killed by      ${top}`);
  if (prev) {
    const d = mean(rounds) - mean(groups.get(prev).map((r) => r.reachedRound));
    const se = Math.sqrt(sd(rounds) ** 2 / g.length + sd(groups.get(prev).map((r) => r.reachedRound)) ** 2 / groups.get(prev).length);
    const z = se ? d / se : 0;
    console.log(`  vs v${prev}: round reached ${d >= 0 ? '+' : ''}${d.toFixed(2)} (${Math.abs(z) >= 1.96 ? 'likely a real change' : 'within noise'}, z=${z.toFixed(1)})`);
  }
  console.log('');
  prev = v;
}
if (runs.some((r) => !r.gameVersion)) console.log('Note: runs without a version were played before version stamping (grouped as "unversioned").');
