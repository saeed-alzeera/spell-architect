// Rituals: an optional three-round contract. Accepting one costs half of your current health; keep up its challenge every round
// and you gain a permanent upgrade for the rest of the run, miss a round and it lapses (the health is already spent).
// A ritual's challenge is always something the player can bring about. Today there are two: the Rite of the Fall asks you to be
// caught by the crumbling floor (fall into the void) in each of its rounds, the Golden Idol asks you to spend half of each round
// inside the golden zone (about half of the arena, made of whole floor tiles that keep changing).
// Co-op: every player has their own ritual (events reach the shell of the player they belong to) and the host evaluates it.
import type Phaser from 'phaser';
import { ARENA, TILE, TN, tileCx, tileCy, tileOf } from './arena';
import type { Run } from './run';
import { roundLen } from './rounds';

export const RITUAL_ROUNDS = 3;
export const POWER_REWARD = 0.2;
/** Golden Idol: the share of a round to spend in the zone, and the chance a coin is doubled. */
export const ZONE_NEED = 0.5;
export const GOLD_DOUBLE = 0.5;

export interface RitualDef { id: string; name: string; icon: string; rounds: number; challenge: string; reward: string }
/** `prog[0]` counts the rounds in which the challenge was met. */
export interface ActiveRitual { def: RitualDef; startRound: number; roundsDone: number; prog: number[]; state: 'active' | 'fulfilled' | 'lapsed'; why: string }

export const RITUALS: RitualDef[] = [
  { id: 'fall', name: 'Rite of the Fall', icon: '🕳️', rounds: RITUAL_ROUNDS, challenge: 'Fall through the crumbling floor at least once in each round', reward: `+${Math.round(POWER_REWARD * 100)}% damage for the rest of the run` },
  { id: 'gold', name: 'Golden Idol', icon: '🗿', rounds: RITUAL_ROUNDS, challenge: `Spend at least ${Math.round(ZONE_NEED * 100)}% of each round inside the golden zone (about half of the arena, whole floor tiles that light up and go dark as it drifts)`, reward: `each coin an enemy drops has a ${Math.round(GOLD_DOUBLE * 100)}% chance to be doubled, for the rest of the run` },
];

/** Half of your current health: what a ritual costs. */
export const ritualCost = (run: Run) => Math.floor(run.player.hp / 2);

/** The rituals that can be accepted now: each only once per run, any number can run at the same time. */
export function availableRituals(run: Run): RitualDef[] {
  return RITUALS.filter((d) => !run.rituals.some((r) => r.def.id === d.id));
}

export function acceptRitual(run: Run, def: RitualDef): string | null {
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

/** The golden zone is a blob around a drifting centre, snapped to the floor grid: a tile is gold when its centre is inside the blob. Its radius wobbles with a few slow waves that turn at different speeds, so
 *  it constantly grows on some sides and recedes on others. It is a pure function of (round, seed, t), so joiners draw the same one. */
const ZONE_R = 315; // about half of the arena once the wobble is averaged in
const WAVES: [number, number, number][] = [[1, 0.3, 0.55], [2, 0.22, -0.8], [3, 0.12, 1.1]]; // lobes, amplitude, turn speed (rad/s)

export function goldZone(round: number, seed: number, t: number) {
  const h = Math.imul(round, 73856093) ^ Math.imul(seed, 19349663);
  const ph = (i: number) => ((Math.imul(h ^ (i * 2246822519), 2654435761) >>> 0) / 4294967296) * 6.2832;
  const cx = ARENA / 2 + 110 * Math.sin(t * 0.31 + ph(1)), cy = ARENA / 2 + 110 * Math.sin(t * 0.23 + ph(2));
  const radius = (a: number) => ZONE_R * (1 + WAVES.reduce((s, [n, amp, w], i) => s + amp * Math.sin(n * a + w * t + ph(3 + i)), 0));
  return { cx, cy, radius };
}

/** Is the floor tile with this index part of the zone? */
const tileInZone = (z: ReturnType<typeof goldZone>, i: number) => {
  const dx = tileCx(i) - z.cx, dy = tileCy(i) - z.cy;
  return Math.hypot(dx, dy) <= z.radius(Math.atan2(dy, dx));
};

const isGold = (r: ActiveRitual) => r.state === 'active' && r.def.id === 'gold';

/** Host: counts the time this player spends in the golden zone. */
export function ritualTick(run: Run, dt: number) {
  if (!run.rituals.some(isGold)) return;
  if (tileInZone(goldZone(run.round, run.seed, run.roundElapsed), tileOf(run.player.x, run.player.y))) run.ritualRound.zoneT += dt;
}

/** Share of the round spent in the zone so far. */
const zoneShare = (run: Run) => (run.roundElapsed > 0 ? Math.min(1, run.ritualRound.zoneT / run.roundElapsed) : 0);

/** Paint the golden zone for the local player's running Golden Idol. */
export function drawGoldZone(g: Phaser.GameObjects.Graphics, run: Run, time: number) {
  if (run.phase !== 'fight' || !run.rituals.some(isGold)) return;
  const z = goldZone(run.round, run.seed, run.roundElapsed);
  const inZ = Array.from({ length: TN * TN }, (_, i) => tileInZone(z, i));
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < TN && y < TN && inZ[y * TN + x];
  g.fillStyle(0xffd25a, 0.2 + 0.06 * Math.sin(time * 3));
  for (let i = 0; i < inZ.length; i++) if (inZ[i]) g.fillRect((i % TN) * TILE + 1, Math.floor(i / TN) * TILE + 1, TILE - 2, TILE - 2);
  g.lineStyle(3, 0xffd25a, 0.9); // outline only where the zone meets a tile that is not in it
  for (let y = 0; y < TN; y++) for (let x = 0; x < TN; x++) {
    if (!at(x, y)) continue;
    const X = x * TILE, Y = y * TILE;
    if (!at(x - 1, y)) g.lineBetween(X, Y, X, Y + TILE);
    if (!at(x + 1, y)) g.lineBetween(X + TILE, Y, X + TILE, Y + TILE);
    if (!at(x, y - 1)) g.lineBetween(X, Y, X + TILE, Y);
    if (!at(x, y + 1)) g.lineBetween(X, Y + TILE, X + TILE, Y + TILE);
  }
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
      if (!run.remote) run.announce(`${r.def.name.toUpperCase()} COMPLETE`, '#7cf08a', r.def.reward);
      if (r.def.id === 'fall') { run.player.dmgMul += POWER_REWARD; run.recomputeRelics(); }
    }
  }
}

/** Progress shown for the challenge, as `have / need`. */
export function ritualProgress(r: ActiveRitual, run: Run): string {
  if (r.def.id === 'gold') return `${r.prog[0]}/${r.def.rounds} rounds · ${Math.round(Math.min(1, run.ritualRound.zoneT / roundLen(run.quick)) * 100)}% of the round spent in the zone (need ${Math.round(ZONE_NEED * 100)}%)`;
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
