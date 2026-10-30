// Rituals: an optional three-round contract. Accepting one costs half of your current health; keep up its challenge every round
// and you gain a permanent upgrade for the rest of the run, miss a round and it lapses (the health is already spent).
// A ritual's challenge is always something the player can bring about. Today there are two: the Rite of the Fall asks you to be
// caught by the crumbling floor (fall into the void) in each of its rounds, the Golden Idol asks you to spend half of each round
// inside the golden zone (half of the arena, which moves).
// Co-op: every player has their own ritual (events reach the shell of the player they belong to) and the host evaluates it.
import type Phaser from 'phaser';
import { ARENA } from './arena';
import type { Run } from './run';

export const RITUAL_ROUNDS = 3;
export const POWER_REWARD = 0.2;
/** Golden Idol: the share of a round to spend in the zone, how often the zone moves (seconds), and the chance a coin is doubled. */
export const ZONE_NEED = 0.5;
export const ZONE_PERIOD = 10;
export const GOLD_DOUBLE = 0.5;

export interface RitualDef { id: string; name: string; icon: string; rounds: number; challenge: string; reward: string }
/** `prog[0]` counts the rounds in which the challenge was met. */
export interface ActiveRitual { def: RitualDef; startRound: number; roundsDone: number; prog: number[]; state: 'active' | 'fulfilled' | 'lapsed'; why: string }

export const RITUALS: RitualDef[] = [
  { id: 'fall', name: 'Rite of the Fall', icon: '🕳️', rounds: RITUAL_ROUNDS, challenge: 'Fall through the crumbling floor at least once in each round', reward: `+${Math.round(POWER_REWARD * 100)}% damage for the rest of the run` },
  { id: 'gold', name: 'Golden Idol', icon: '🗿', rounds: RITUAL_ROUNDS, challenge: `Spend at least ${Math.round(ZONE_NEED * 100)}% of each round inside the golden zone (half of the arena, it moves every ${ZONE_PERIOD}s)`, reward: `each coin an enemy drops has a ${Math.round(GOLD_DOUBLE * 100)}% chance to be doubled, for the rest of the run` },
];

/** Half of your current health: what a ritual costs. */
export const ritualCost = (run: Run) => Math.floor(run.player.hp / 2);

/** The rituals that can be accepted now: one at a time, and each only once per run. */
export function availableRituals(run: Run): RitualDef[] {
  if (run.rituals.some((r) => r.state === 'active')) return [];
  return RITUALS.filter((d) => !run.rituals.some((r) => r.def.id === d.id));
}

export function acceptRitual(run: Run, def: RitualDef): string | null {
  if (run.rituals.some((r) => r.state === 'active')) return 'A ritual is already running.';
  if (!availableRituals(run).some((d) => d.id === def.id)) return 'You have already performed that ritual.';
  const cost = ritualCost(run);
  if (cost < 1) return 'You are too weak to pay the cost.';
  run.player.hp -= cost;
  run.rituals.push({ def, startRound: run.round, roundsDone: 0, prog: [0], state: 'active', why: '' });
  return null;
}

/* ------------------------------------------------------------------ events */

/** Called when the floor drops the player into the void. */
export function ritualEvent(run: Run, ev: { t: 'void' }) {
  if (ev.t === 'void') run.ritualRound.fell = true;
}

export function ritualRoundStart(run: Run) {
  run.ritualRound = { fell: false, zoneT: 0 };
}

/* ------------------------------------------------------------------ the golden zone */

/** Which half of the arena is golden during period `k` of a round: 0 left, 1 right, 2 top, 3 bottom. Never the same half twice in a row. */
function zoneHalf(round: number, seed: number, k: number): number {
  let h = Math.imul(round, 73856093) ^ Math.imul(seed, 19349663);
  let idx = (h >>> 0) % 4;
  for (let i = 1; i <= k; i++) { h = Math.imul(h ^ (h >>> 15), 2246822519) ^ i; idx = (idx + 1 + ((h >>> 0) % 3)) % 4; }
  return idx;
}
const halfRect = (i: number) => [[0, 0, ARENA / 2, ARENA], [ARENA / 2, 0, ARENA / 2, ARENA], [0, 0, ARENA, ARENA / 2], [0, ARENA / 2, ARENA, ARENA / 2]][i];

/** The golden zone `t` seconds into the round: `[x, y, w, h]`. Seconds until it moves, and the next one, come with it. */
export function goldZone(round: number, seed: number, t: number) {
  const k = Math.floor(t / ZONE_PERIOD);
  return { rect: halfRect(zoneHalf(round, seed, k)), next: halfRect(zoneHalf(round, seed, k + 1)), left: ZONE_PERIOD - (t - k * ZONE_PERIOD) };
}

const isGold = (r: ActiveRitual) => r.state === 'active' && r.def.id === 'gold';

/** Host: counts the time this player spends in the golden zone. */
export function ritualTick(run: Run, dt: number) {
  if (!run.rituals.some(isGold)) return;
  const [x, y, w, h] = goldZone(run.round, run.seed, run.roundElapsed).rect;
  const p = run.player;
  if (p.x >= x && p.x < x + w && p.y >= y && p.y < y + h) run.ritualRound.zoneT += dt;
}

/** Share of the round spent in the zone so far. */
const zoneShare = (run: Run) => (run.roundElapsed > 0 ? Math.min(1, run.ritualRound.zoneT / run.roundElapsed) : 0);

/** Paint the golden zone (and, shortly before it moves, where it goes next) for the local player's running Golden Idol. */
export function drawGoldZone(g: Phaser.GameObjects.Graphics, run: Run, time: number) {
  if (run.phase !== 'fight' || !run.rituals.some(isGold)) return;
  const { rect: [x, y, w, h], next, left } = goldZone(run.round, run.seed, run.roundElapsed);
  g.fillStyle(0xffd25a, 0.1 + 0.05 * Math.sin(time * 3));
  g.fillRect(x, y, w, h);
  g.lineStyle(4, 0xffd25a, 0.8);
  g.strokeRect(x + 2, y + 2, w - 4, h - 4);
  if (left < 2) { g.lineStyle(3, 0xfff1b0, 0.35 + 0.35 * Math.sin(time * 14)); g.strokeRect(next[0] + 6, next[1] + 6, next[2] - 12, next[3] - 12); }
}

/** The Golden Idol's reward: how many coins a drop is worth (rolled per drop). */
export function goldMul(run: Run): number {
  return run.rituals.some((r) => r.state === 'fulfilled' && r.def.id === 'gold') && Math.random() < GOLD_DOUBLE ? 2 : 1;
}

/** Has this round's challenge been met (so far)? */
export function ritualMet(r: ActiveRitual, run: Run): boolean {
  return r.def.id === 'gold' ? zoneShare(run) >= ZONE_NEED : run.ritualRound.fell;
}

/** One line telling the player what to do right now. */
export function ritualHint(r: ActiveRitual, run: Run): string {
  if (r.def.id === 'gold') return ritualMet(r, run) ? '✔ On track. Stay in the gold to keep it.' : '▸ Behind! Get into the golden zone.';
  return ritualMet(r, run) ? '✔ Done this round. You are safe.' : '▸ Not done yet! Stand on a cracked tile.';
}

/** Called when a round ends: count it if the challenge was met, and resolve the ritual after its last round. */
export function ritualRoundEnd(run: Run) {
  for (const r of run.rituals) {
    if (r.state !== 'active') continue;
    r.roundsDone++;
    if (ritualMet(r, run)) r.prog[0]++;
    else { r.state = 'lapsed'; r.why = r.def.id === 'gold' ? 'You did not spend enough of the round in the golden zone.' : 'You were not caught by the falling floor.'; continue; }
    if (r.roundsDone >= r.def.rounds) {
      r.state = 'fulfilled';
      if (r.def.id === 'fall') { run.player.dmgMul += POWER_REWARD; run.recomputeRelics(); }
    }
  }
}

/** Progress shown for the challenge, as `have / need`. */
export function ritualProgress(r: ActiveRitual, run: Run): string {
  if (r.def.id === 'gold') return `${r.prog[0]}/${r.def.rounds} rounds · ${Math.round(zoneShare(run) * 100)}% of this round in the zone (need ${Math.round(ZONE_NEED * 100)}%)`;
  return `${r.prog[0]}/${r.def.rounds} rounds${run.ritualRound.fell ? ' · fell this round' : ''}`;
}

/* ------------------------------------------------------------------ co-op: trusting a build from another machine */

/** Is this ritual list, sent by a joiner, well formed? Returns the problem or null. */
export function validateRituals(list: unknown): string | null {
  if (!Array.isArray(list) || list.length > RITUALS.length) return 'bad rituals';
  const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  for (const r of list as ActiveRitual[]) {
    const known = RITUALS.find((d) => d.id === r?.def?.id);
    if (!known || r.def.rounds !== RITUAL_ROUNDS) return 'bad ritual';
    if (!['active', 'fulfilled', 'lapsed'].includes(r.state) || !num(r.roundsDone, 0, RITUAL_ROUNDS) || !num(r.startRound, 0, 100)) return 'bad ritual';
    if (!Array.isArray(r.prog) || r.prog.length !== 1 || !num(r.prog[0], 0, RITUAL_ROUNDS)) return 'bad ritual';
  }
  return null;
}
