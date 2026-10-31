// Run telemetry: counters that explain *why* a run went the way it did, not just how it ended. Read by Run.pushRoundRecord (the round log)
// and by tools/analyze.mjs. Nothing here affects gameplay: it only counts, and none of it is replicated over the network.
//
// What the counters are for (see docs/analytics.md, "Telemetry"):
//   - the enemy side (spawned, hpPool, hpLeft, lifetimes, timelines) tells you whether damage is capped by what the director spawns
//     (damage dealt is min(hit, remaining HP), so a build that out-damages the spawn rate just reads as "damage ~ hpPool");
//   - the damage side (raw, overkill, direct / dot / react / tail, by element) says where the damage came from;
//   - per spell (keyed by the slot's stable uid, so a Core swap does not look like a new spell) hits, dot, tail, relic-proc damage,
//     trigger roll/fire counts and a full structure signature;
//   - per relic: the share of damage its multiplier added, damage from the casts it caused, cooldown it refunded.
import type { Run } from './run';
import type { Src } from './types';
import type { CForm } from '../core/spell';

export const BUCKET_SECS = 5;
export const MAX_BUCKETS = 24;

export interface RelicTel { dmg: number; procs: number; cd: number }
export interface SpellTel {
  hits: number;                       // direct hits (not DoT ticks, not reaction damage)
  dot: number; react: number;         // damage from poison/burn ticks and from elemental reactions
  tail: number;                       // damage from forms launched by triggers (depth > 0)
  over: number;                       // damage beyond the target's remaining HP (wasted)
  rel: number;                        // damage from casts a relic caused (Mirror Shard, Sock, Compass arcs)
  trig: Record<string, [number, number]>; // trigger type -> [rolls, fires]
}
export const newSpellTel = (): SpellTel => ({ hits: 0, dot: 0, react: 0, tail: 0, over: 0, rel: 0, trig: {} });

/** Per-round accumulators on a Run; reset when a round starts. */
export class Tally {
  // enemy side (written on the world run)
  spawned = 0; hpPool = 0; byType: Record<string, number> = {}; lifeSum = 0; lifeN = 0; lastB = -1;
  // damage side (written on the run that owns the casting spell)
  raw = 0; over = 0; direct = 0; dot = 0; react = 0; tail = 0; none = 0; crits = 0; critDmg = 0;
  byEl: Record<string, number> = {};
  relic: Record<string, RelicTel> = {};
  dmgT: number[] = new Array(MAX_BUCKETS).fill(0);
  killT: number[] = new Array(MAX_BUCKETS).fill(0);
  aliveT: number[] = new Array(MAX_BUCKETS).fill(0);
  ults = 0;
}

/** Acquisition log entry: when something that changes the build was gained or lost. `t` is run.time in seconds. */
export interface AcqRec { t: number; r: number; k: 'relic' | 'sell' | 'rune' | 'forge' | 'mut' | 'boost'; id: string }

/** Multipliers applied by the last relicDamageMul call (cleared each call), so dealDamage can split the bonus per relic. */
export const relicFactors: [string, number][] = [];

const bucketOf = (run: Run) => Math.min(MAX_BUCKETS - 1, Math.max(0, Math.floor(run.world.roundElapsed / BUCKET_SECS)));
const relicOf = (t: Tally, id: string): RelicTel => t.relic[id] ?? (t.relic[id] = { dmg: 0, procs: 0, cd: 0 });

/** Called from dealDamage once the hit is resolved. `a` is the damage after multipliers, `dealt` what it took off the target. */
export function tallyDamage(run: Run, src: Src | null, el: string, a: number, dealt: number, o: { dot?: boolean; react?: boolean }, crit: boolean) {
  const t = run.tal;
  t.raw += a; t.over += a - dealt;
  t.byEl[el] = (t.byEl[el] ?? 0) + dealt;
  if (o.dot) t.dot += dealt; else if (o.react) t.react += dealt; else t.direct += dealt;
  if (crit) { t.crits++; t.critDmg += dealt; }
  t.dmgT[bucketOf(run)] += dealt;
  if (!src) t.none += dealt; // ultimates, hazards and other damage no spell is credited with
  else {
    const s = src.sp.tel;
    s.over += a - dealt;
    if (o.dot) s.dot += dealt; else if (o.react) s.react += dealt; else s.hits++;
    if (src.depth > 0) { t.tail += dealt; s.tail += dealt; }
    if (src.rel) { relicOf(t, src.rel).dmg += dealt; s.rel += dealt; }
  }
  // Relic damage multipliers: the share of this hit that the relics added is dealt * (1 - 1/M); split between them by log(multiplier).
  if (relicFactors.length && dealt > 0) {
    let M = 1;
    for (const f of relicFactors) M *= f[1];
    if (M > 1.0001) {
      const bonus = dealt * (1 - 1 / M), lm = Math.log(M);
      for (const [id, mul] of relicFactors) relicOf(t, 'x:' + id).dmg += bonus * (Math.log(mul) / lm);
    }
  }
}

export function tallySpawn(world: Run, type: string, hp: number) {
  const t = world.tal;
  t.spawned++; t.hpPool += hp; t.byType[type] = (t.byType[type] ?? 0) + 1;
}

/** A spawned enemy was turned into another type with a different HP (the boss is spawned as a placeholder grunt). */
export function tallyReskin(world: Run, to: string, from: string, fromHp: number, toHp: number) {
  const t = world.tal;
  t.hpPool += toHp - fromHp;
  t.byType[from] = (t.byType[from] ?? 1) - 1; if (!t.byType[from]) delete t.byType[from];
  t.byType[to] = (t.byType[to] ?? 0) + 1;
}

export function tallyKill(run: Run, born: number) {
  run.tal.killT[bucketOf(run)]++;
  const w = run.world.tal;
  w.lifeSum += Math.max(0, run.world.time - born); w.lifeN++;
}

/** A relic did something: `procs` extra casts/arcs, `cd` seconds of cooldown refunded. */
export function tallyProc(run: Run, id: string, procs = 1, cd = 0) {
  const r = relicOf(run.tal, id);
  r.procs += procs; r.cd += cd;
}

/** Once per bucket, while fighting: how many enemies are alive (is the arena being cleared as fast as it fills?). */
export function sampleAlive(world: Run) {
  const t = world.tal, b = bucketOf(world);
  if (b === t.lastB) return;
  t.lastB = b;
  let n = 0;
  for (const e of world.enemies) if (!e.dead) n++;
  t.aliveT[b] = n;
}

export function triggerRoll(sp: { tel: SpellTel }, type: string, fired: boolean) {
  const x = sp.tel.trig[type] ?? (sp.tel.trig[type] = [0, 0]);
  x[0]++; if (fired) x[1]++;
}

/* ------------------------------ serialisation ------------------------------ */

const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Drop trailing zeros so short rounds stay small. */
const trim = (a: number[]) => { let n = a.length; while (n > 0 && !a[n - 1]) n--; return a.slice(0, n).map(r0); };
const roundMap = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v).map(([k, v]) => [k, r0(v)]));

export interface RoundTel {
  t0: number;                                   // run.time when the round started (places acquisitions inside rounds)
  spawned: number; hpPool: number;              // enemies spawned this round and their total max HP
  hpLeft: number; alive: number;                // HP and count of enemies still alive when the round ended
  life: number;                                 // mean seconds an enemy lived before it died
  byType: Record<string, number>;               // enemies spawned by type
  raw: number; over: number;                    // damage attempted (after multipliers) and the part that was overkill
  direct: number; dot: number; react: number; tail: number; none: number;
  crits: number; critDmg: number; casts: number; ults: number;
  byEl: Record<string, number>;                 // damage dealt by element
  relic: Record<string, RelicTel>;              // 'x:<id>' = damage a damage-multiplier relic added; '<id>' = damage/procs/cooldown from relic-caused casts
  tl: { dmg: number[]; kills: number[]; alive: number[] }; // per 5 s of the round
  p: { dmgMul: number; crit: number; critMul: number; cdMul: number };
}

export function roundTel(world: Run, owner: Run, t0: number, casts: number): RoundTel {
  const t = owner.tal, w = world.tal;
  let hpLeft = 0, alive = 0;
  for (const e of world.enemies) if (!e.dead) { alive++; hpLeft += Math.max(0, e.hp); }
  const relic: Record<string, RelicTel> = {};
  for (const [k, v] of Object.entries(t.relic)) relic[k] = { dmg: r0(v.dmg), procs: v.procs, cd: r2(v.cd) };
  const p = owner.player;
  return {
    t0: r2(t0), spawned: w.spawned, hpPool: r0(w.hpPool), hpLeft: r0(hpLeft), alive, life: r2(w.lifeN ? w.lifeSum / w.lifeN : 0), byType: { ...w.byType },
    raw: r0(t.raw), over: r0(t.over), direct: r0(t.direct), dot: r0(t.dot), react: r0(t.react), tail: r0(t.tail), none: r0(t.none),
    crits: t.crits, critDmg: r0(t.critDmg), casts, ults: t.ults, byEl: roundMap(t.byEl), relic,
    tl: { dmg: trim(t.dmgT), kills: trim(t.killT), alive: trim(w.aliveT) },
    p: { dmgMul: r2(p.dmgMul), crit: r2(p.crit), critMul: r2(p.critMul), cdMul: r2(p.cdMul) },
  };
}

/** Per-round numbers of a spell (its SpellTel); zero values are left out. */
export function spellTelRec(tel: SpellTel) {
  const out: Record<string, unknown> = {};
  for (const k of ['hits', 'dot', 'react', 'tail', 'over', 'rel'] as const) if (tel[k]) out[k] = r0(tel[k]);
  if (Object.keys(tel.trig).length) out.trig = { ...tel.trig };
  return out;
}

/** Compact structure of a compiled form: `element:form[behaviours|modifiers]{trigger@chance>child;...}`. Evolved cores get a `*`. */
export function describeForm(f: CForm): string {
  const b = Object.keys(f.b).filter((k) => f.b[k]);
  const m = (Object.entries(f.m) as [string, number][]).filter(([, v]) => v).map(([k, v]) => `${k}${v}`);
  let s = `${f.element}${f.evolved ? '*' : ''}:${f.form}`;
  if (b.length || m.length) s += `[${b.join(',')}${m.length ? '|' + m.join(',') : ''}]`;
  const tr = f.triggers.map((t) => `${t.type}@${r2(t.chance)}>${t.children.map(describeForm).join(';')}`);
  if (tr.length) s += `{${tr.join(' ')}}`;
  return s;
}
