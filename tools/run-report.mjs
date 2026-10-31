#!/usr/bin/env node
// Deep-dive on ONE run: how damage grew, whether it was capped by the spawn, which spell slots and relics did the work.
//
//   ADMIN_KEY=... node tools/run-report.mjs                 # the latest win (or the latest run if there is no win)
//   ADMIN_KEY=... node tools/run-report.mjs --id <run id>
//   node tools/run-report.mjs --file runs.json [--latest | --won | --id X]
//   Options: --base https://...workers.dev   --json (print the picked run record instead of the report)
//
// Needs v3 records (game 1.3.1+): older runs have no telemetry and only get the basic table.
// Read docs/analytics.md ("Telemetry") for what each number means and how to avoid reading damage totals wrongly.
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
    const res = await fetch(`${BASE}/runs?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) { console.error(`GET /runs failed: ${res.status} ${await res.text()}`); process.exit(1); }
    const page = await res.json();
    runs.push(...page.runs);
    if (!page.next) break;
    after = page.next;
  }
  return runs;
}

const real = (await load()).filter((r) => !r.sandbox).sort((a, b) => b.endedAt - a.endedAt);
let run = opt('id') ? real.find((r) => r.id === opt('id')) : flag('latest') ? real[0] : real.find((r) => r.result === 'won') || real[0];
if (!run) { console.error('No matching run.'); process.exit(1); }
if (flag('json')) { console.log(JSON.stringify(run, null, 1)); process.exit(0); }

const pad = (v, n) => String(v).padStart(n);
const k = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const pct = (x) => `${Math.round(100 * x)}%`;
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

console.log(`\nRun ${run.id}\n  v${run.gameVersion} (${run.build ?? '?'})  ${run.result}  round ${run.reachedRound}  ${run.quick ? 'quick' : 'normal'}  ${run.players ?? 1}p ${run.role ?? ''}  start ${run.startForm}`);
console.log(`  ${Math.floor(run.time / 60)}:${String(Math.round(run.time % 60)).padStart(2, '0')} of game time, level ${run.level}, ${run.kills} kills, ${k(run.damage)} damage, ${run.taken} taken${run.deathCause ? `, killed by ${run.deathCause}` : ''}`);
const log = run.roundLog || [];
const hasTel = log.some((q) => q.tel);
if (!hasTel) console.log('\n  (no telemetry in this record: it was played before v3. Showing the basics only.)');

/* ---------- 1. growth, and whether damage was capped by the spawn ---------- */
console.log('\nDamage over the run   (sat = damage / hpPool: near 1 means the build kills what spawns, so damage only mirrors enemy HP)');
console.log('rnd      secs     dps    kills   dmg/kill  ' + (hasTel ? ' spawned   hpPool    sat  hpLeft alive  life  over%' : ''));
for (const q of log) {
  const t = q.tel;
  let line = `r${String(q.round).padEnd(3)}${q.boss ? 'B' : ' '}${q.partial ? '*' : ' '} ${pad(q.secs, 5)} ${pad(k(q.damage / Math.max(1, q.secs)), 7)} ${pad(q.kills, 8)} ${pad(k(q.damage / Math.max(1, q.kills)), 9)}`;
  if (t) line += `  ${pad(t.spawned, 7)} ${pad(k(t.hpPool), 8)} ${pad((q.damage / Math.max(1, t.hpPool)).toFixed(2), 6)} ${pad(k(t.hpLeft), 7)} ${pad(t.alive, 5)} ${pad(t.life.toFixed(1), 5)} ${pad(pct(t.raw ? t.over / t.raw : 0), 5)}`;
  console.log(line);
}
if (log.some((q) => q.partial)) console.log('  * = round cut short (run lost, final boss, or abandoned)');
if (hasTel) {
  const sat = log.filter((q) => q.tel && !q.boss && q.tel.hpPool).map((q) => q.damage / q.tel.hpPool);
  if (sat.length) console.log(`  mean sat on normal rounds ${mean(sat).toFixed(2)}.  ${mean(sat) > 0.9 ? 'The build clears the spawn: raw damage numbers say little about build power here. Compare hpLeft / alive / life instead.' : 'Enemies were left alive: damage numbers do reflect build power.'}`);

  /* ---------- 2. where the damage came from ---------- */
  console.log('\nDamage by source (all rounds)');
  const sum = (f) => log.reduce((n, q) => n + (q.tel ? f(q.tel) : 0), 0);
  const tot = sum((t) => t.direct + t.dot + t.react + t.none) || 1;
  console.log(`  direct ${pct(sum((t) => t.direct) / tot)}   poison/burn ticks ${pct(sum((t) => t.dot) / tot)}   reactions ${pct(sum((t) => t.react) / tot)}   no spell (ultimates, hazards) ${pct(sum((t) => t.none) / tot)}`);
  console.log(`  from trigger-launched forms (tails) ${pct(sum((t) => t.tail) / tot)}   overkill wasted ${pct(sum((t) => t.over) / Math.max(1, sum((t) => t.raw)))}   crits ${sum((t) => t.crits)} (${pct(sum((t) => t.critDmg) / tot)} of damage)   ultimates used ${sum((t) => t.ults)}`);
  const el = {};
  for (const q of log) for (const [e, v] of Object.entries(q.tel?.byEl || {})) el[e] = (el[e] || 0) + v;
  console.log('  by element: ' + Object.entries(el).sort((a, b) => b[1] - a[1]).map(([e, v]) => `${e} ${pct(v / tot)}`).join('  '));

  /* ---------- 3. spell slots, followed through Core/Form swaps ---------- */
  console.log('\nSpell slots (a slot keeps its uid when its runes change, so a swap shows up as a new signature, not a new spell)');
  const slots = new Map();
  for (const q of log) {
    const total = q.spells.reduce((n, s) => n + s.damage, 0) || 1;
    for (const s of q.spells) {
      if (s.uid === undefined) continue;
      if (!slots.has(s.uid)) slots.set(s.uid, []);
      slots.get(s.uid).push({ round: q.round, share: s.damage / total, dmg: s.damage, ...s });
    }
  }
  for (const [uid, rows] of slots) {
    const dmg = rows.reduce((n, r) => n + r.dmg, 0);
    console.log(`  slot uid ${uid}: ${k(dmg)} total, rounds ${rows[0].round}-${rows[rows.length - 1].round}`);
    let last = '';
    for (const r of rows) {
      if (r.sig === last) continue;
      last = r.sig;
      const trig = Object.entries(r.trig || {}).map(([t, [a, b]]) => `${t} ${b}/${a}`).join(' ');
      console.log(`    from r${pad(r.round, 2)}  ${pct(r.share).padStart(4)} share  ${r.sig}${r.mut?.length ? `  mut ${r.mut.join(',')}` : ''}${trig ? `  triggers ${trig}` : ''}`);
    }
    const hits = rows.reduce((n, r) => n + (r.hits || 0), 0), casts = rows.reduce((n, r) => n + (r.casts || 0), 0);
    const part = (key) => pct(rows.reduce((n, r) => n + (r[key] || 0), 0) / Math.max(1, dmg));
    console.log(`    ${casts} casts, ${hits} direct hits (${(hits / Math.max(1, casts)).toFixed(1)}/cast); damage: ticks ${part('dot')}, reactions ${part('react')}, tails ${part('tail')}, relic-caused casts ${part('rel')}`);
  }

  /* ---------- 4. relics ---------- */
  console.log('\nRelics   (x: = damage the multiplier added, split by log of each multiplier; the other rows are damage / procs / cooldown seconds from relic-caused casts. They overlap with the spells\' own numbers.)');
  const rel = {};
  for (const q of log) for (const [id, v] of Object.entries(q.tel?.relic || {})) { const r = (rel[id] ||= { dmg: 0, procs: 0, cd: 0 }); r.dmg += v.dmg; r.procs += v.procs; r.cd += v.cd; }
  const rows = Object.entries(rel).sort((a, b) => b[1].dmg - a[1].dmg);
  for (const [id, v] of rows) console.log(`  ${id.padEnd(14)} ${pad(k(v.dmg), 7)} dmg (${pct(v.dmg / Math.max(1, run.damage))} of run)  ${v.procs ? `${v.procs} procs  ` : ''}${v.cd ? `${v.cd.toFixed(0)}s cooldown refunded` : ''}`);
  if (!rows.length) console.log('  (no relic with a counted effect was worn)');
  console.log('  worn at the end: ' + (run.relics || []).join(', '));

  /* ---------- 5. when things were gained ---------- */
  if (run.acq?.length) {
    console.log('\nGained / changed (game seconds; r = the round being played, or the next one when bought in the shop)');
    for (const a of run.acq) {
      console.log(`  ${pad(a.t.toFixed(0), 5)}s  r${a.r}  ${a.k.padEnd(6)} ${a.id}`);
    }
  }

  /* ---------- 6. one round in detail: the 5 s timeline ---------- */
  const pickRound = Number(opt('round')) || log.filter((q) => !q.boss).slice(-1)[0]?.round;
  const q = log.find((x) => x.round === pickRound);
  if (q?.tel?.tl?.dmg?.length) {
    console.log(`\nRound ${q.round} by 5 s   (damage, kills, enemies alive at the start of the bucket)`);
    const n = Math.max(q.tel.tl.dmg.length, q.tel.tl.kills.length, q.tel.tl.alive.length);
    for (let i = 0; i < n; i++) console.log(`  ${pad(i * 5, 3)}s  ${pad(k(q.tel.tl.dmg[i] || 0), 7)}  ${pad(q.tel.tl.kills[i] || 0, 4)}  ${pad(q.tel.tl.alive[i] || 0, 4)}`);
    console.log('  Use --round N for another round.');
  }
  console.log(`\nPlayer stats in the last round: ${JSON.stringify(log[log.length - 1]?.tel?.p)}`);
}
console.log('');
