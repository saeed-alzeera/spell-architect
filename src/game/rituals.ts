// Rituals: an optional three-round contract. Accepting one costs half of your current health; keep up its challenge every round
// and you gain a permanent upgrade for the rest of the run, miss a round and it lapses (the health is already spent).
// A ritual's challenge is always something the player can bring about. Today there are three: the Vow of Silence asks you to
// get through its rounds with every Trigger rune dead, the Rite of the Fall asks you to be
// caught by the crumbling floor (fall into the void) in each of its rounds, the Golden Idol asks you to spend half of each round
// inside the golden zone (about a fifth of the arena, made of whole floor tiles that keep changing).
// Co-op: every player has their own ritual (events reach the shell of the player they belong to) and the host evaluates it.
import type Phaser from 'phaser';
import { ARENA, TILE, TN, tileCx, tileCy, tileOf } from './arena';
import type { CForm } from '../core/spell';
import type { Run } from './run';
import type { ActiveSpell } from './types';
import { roundLen } from './rounds';

export const RITUAL_ROUNDS = 3;
export const POWER_REWARD = 0.2;
/** Golden Idol: the share of a round to spend in the zone, and the bonus on every coin earned once it is fulfilled. */
export const ZONE_NEED = 0.5;
export const GOLD_BONUS = 0.5;
/** Vow of Silence: it is only offered once this many of your spells carry a Trigger. */
export const SILENCE_SPELLS = 2;

/** Oath of Purity: offered with this many spells that are at least `PURITY_FILL` full; the reward is `PURITY_CAP` more capacity on one spell. */
export const PURITY_SPELLS = 3;
export const PURITY_FILL = 0.75;
export const PURITY_CAP = 0.5;
/** Sanguine Pact: offered from this round on, at full health; the reward is +regen (HP/s) and +max health. */
export const SANGUINE_ROUND = 11;
export const SANGUINE_REGEN = 0.3;
export const SANGUINE_HP = 10;

export interface RitualDef { id: string; name: string; icon: string; rounds: number; challenge: string; reward: string }
/** `prog[0]` counts the rounds in which the challenge was met. `uid` (Oath of Purity) is the one spell allowed to cast, chosen when the oath is
 *  sworn; `picked` is set once the Oath's capacity reward has been given to a spell. */
export interface ActiveRitual { def: RitualDef; startRound: number; roundsDone: number; prog: number[]; state: 'active' | 'fulfilled' | 'lapsed'; why: string; uid?: number; picked?: boolean }

export const RITUALS: RitualDef[] = [
  { id: 'fall', name: 'Rite of the Fall', icon: '🕳️', rounds: RITUAL_ROUNDS, challenge: 'Fall through the crumbling floor at least once in each round', reward: `+${Math.round(POWER_REWARD * 100)}% damage for the rest of the run` },
  { id: 'gold', name: 'Golden Idol', icon: '🗿', rounds: RITUAL_ROUNDS, challenge: `Spend at least ${Math.round(ZONE_NEED * 100)}% of each round inside the golden zone (about a fifth of the arena, whole floor tiles that light up and go dark as it drifts)`, reward: `every coin you earn (kill drops, round and boss bonuses) is worth ${Math.round(GOLD_BONUS * 100)}% more, for the rest of the run` },
  { id: 'silence', name: 'Vow of Silence', icon: '🤐', rounds: RITUAL_ROUNDS, challenge: `Triggers do not work at all for ${RITUAL_ROUNDS} rounds (only offered while ${SILENCE_SPELLS} or more of your spells have a Trigger)`, reward: 'every Trigger gets 2 rolls instead of 1, for the rest of the run' },
  { id: 'purity', name: 'Oath of Purity', icon: '🕯️', rounds: RITUAL_ROUNDS, challenge: `Only your weakest spell may cast for ${RITUAL_ROUNDS} rounds, the others (and their ultimates) fall silent (only offered while ${PURITY_SPELLS} or more spells are at least ${Math.round(PURITY_FILL * 100)}% full)`, reward: `one spell of your choice gets ${Math.round(PURITY_CAP * 100)}% more capacity` },
  { id: 'sanguine', name: 'Sanguine Pact', icon: '🩸', rounds: RITUAL_ROUNDS, challenge: `Heal nothing for ${RITUAL_ROUNDS} rounds: no regeneration, round-start healing, hearts, draughts or relic heals (only offered from round ${SANGUINE_ROUND} on, at full health)`, reward: `+${SANGUINE_REGEN} health regenerated per second and +${SANGUINE_HP} maximum health, for the rest of the run` },
];

/** Half of your current health: what a ritual costs. */
export const ritualCost = (run: Run) => Math.floor(run.player.hp / 2);

/** The rituals that can be accepted now: each only once per run, any number can run at the same time. */
export function availableRituals(run: Run): RitualDef[] {
  return RITUALS.filter((d) => !run.rituals.some((r) => r.def.id === d.id) && (d.id !== 'silence' || triggeredSpells(run) >= SILENCE_SPELLS)
    && (d.id !== 'purity' || fullSpells(run) >= PURITY_SPELLS)
    && (d.id !== 'sanguine' || (run.round >= SANGUINE_ROUND && run.player.hp >= run.player.maxHp)));
}

/** How many of your spells use at least `PURITY_FILL` of their capacity. */
function fullSpells(run: Run): number {
  return run.spells.filter((sp) => sp.c.valid && sp.c.cost >= sp.def.capacity * PURITY_FILL).length;
}

/** The weakest working spell: the one that has dealt the least damage so far (the earliest slot wins a tie). */
function weakestSpell(run: Run): ActiveSpell | null {
  let w: ActiveSpell | null = null;
  for (const sp of run.spells) if (sp.c.valid && (!w || sp.damage < w.damage)) w = sp;
  return w;
}

/** How many of your spells have a Trigger anywhere in them (including on Forms launched by other Triggers). */
function triggeredSpells(run: Run): number {
  const walk = (f: CForm): boolean => f.triggers.length > 0 || f.triggers.some((t) => t.children.some(walk));
  return run.spells.filter((sp) => sp.c.valid && sp.c.root && walk(sp.c.root)).length;
}

/** The Vow of Silence is being kept: this player's Triggers do nothing. */
export const triggersSilenced = (run: Run) => run.rituals.some((r) => r.state === 'active' && r.def.id === 'silence');

/** Rolls a Trigger gets to fire: 2 once the Vow of Silence is fulfilled. */
export const triggerRolls = (run: Run) => (run.rituals.some((r) => r.state === 'fulfilled' && r.def.id === 'silence') ? 2 : 1);

/** The Oath of Purity is being kept and this spell is not the one allowed to cast. */
export function spellSilenced(run: Run, sp: ActiveSpell): boolean {
  const r = run.rituals.find((x) => x.state === 'active' && x.def.id === 'purity');
  return !!r && r.uid !== undefined && r.uid !== sp.uid && run.spells.some((x) => x.uid === r.uid);
}

/** The Sanguine Pact is being kept: this player cannot heal. */
export const healingBlocked = (run: Run) => run.rituals.some((r) => r.state === 'active' && r.def.id === 'sanguine');

/** The spell a fulfilled Oath of Purity is still waiting to upgrade (the player picks which). */
export const purityPending = (run: Run) => run.rituals.find((r) => r.state === 'fulfilled' && r.def.id === 'purity' && !r.picked);

/** Spend the Oath of Purity's reward: +50% capacity (at least 1) on the spell at this index. */
export function claimPurity(run: Run, spellIndex: number): string | null {
  const r = purityPending(run), sp = run.spells[spellIndex];
  if (!r || !sp) return 'Nothing to claim.';
  sp.def.capacity += Math.max(1, Math.round(sp.def.capacity * PURITY_CAP));
  r.picked = true;
  run.recompile(sp, true);
  return null;
}

export function acceptRitual(run: Run, def: RitualDef): string | null {
  if (!availableRituals(run).some((d) => d.id === def.id)) return 'That ritual is not available.';
  const cost = ritualCost(run);
  if (cost < 1) return 'You are too weak to pay the cost.';
  run.player.hp -= cost;
  const ritual: ActiveRitual = { def, startRound: run.round, roundsDone: 0, prog: [0], state: 'active', why: '' };
  if (def.id === 'purity') ritual.uid = weakestSpell(run)?.uid;
  run.rituals.push(ritual);
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
const ZONE_R = 264; // about 20% of the floor tiles once the wobble is averaged in (measured: 315 was 28%, which made it too easy to just stay in)
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

/** The Golden Idol's reward: the multiplier on every coin this player earns. */
export function goldMul(run: Run): number {
  return run.rituals.some((r) => r.state === 'fulfilled' && r.def.id === 'gold') ? 1 + GOLD_BONUS : 1;
}

/** Has this round's challenge been met (so far)? */
export function ritualMet(r: ActiveRitual, run: Run): boolean {
  if (r.def.id === 'silence' || r.def.id === 'purity' || r.def.id === 'sanguine') return true; // the challenge is simply to go on under the restriction
  return r.def.id === 'gold' ? zoneShare(run) >= ZONE_NEED : run.ritualRound.fell;
}

/** One line telling the player what to do right now. */
export function ritualHint(r: ActiveRitual, run: Run): string {
  if (r.def.id === 'silence') return '▸ Your Triggers are silent. Carry on without them.';
  if (r.def.id === 'purity') { const sp = run.spells.find((x) => x.uid === r.uid); return `▸ Only ${sp?.c.valid ? sp.c.name : 'your weakest spell'} may cast. The rest are silent.`; }
  if (r.def.id === 'sanguine') return '▸ You cannot heal. Do not get hit.';
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
      if (r.def.id === 'sanguine') { run.player.maxHp += SANGUINE_HP; run.player.regen += SANGUINE_REGEN; } // no heal: the new health is not filled in
    }
  }
}

/** Progress shown for the challenge, as `have / need`. */
export function ritualProgress(r: ActiveRitual, run: Run): string {
  if (r.def.id === 'silence') return `${r.prog[0]}/${r.def.rounds} rounds without Triggers`;
  if (r.def.id === 'purity') return `${r.prog[0]}/${r.def.rounds} rounds with one spell`;
  if (r.def.id === 'sanguine') return `${r.prog[0]}/${r.def.rounds} rounds without healing`;
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
    if ((r.uid !== undefined && !num(r.uid, 0, 1e9)) || (r.picked !== undefined && typeof r.picked !== 'boolean')) return 'bad ritual';
  }
  return null;
}
