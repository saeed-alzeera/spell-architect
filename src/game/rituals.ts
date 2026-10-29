// Rituals: an optional three-round contract. Accepting one costs half of your current health; keep up its challenge every round
// and you gain a permanent upgrade for the rest of the run, miss a round and it lapses (the health is already spent).
// A ritual's challenge is always something the player can bring about: today there is one, the Rite of the Fall, which asks you
// to be caught by the crumbling floor (fall into the void) in each of its rounds.
// Co-op: every player has their own ritual (events reach the shell of the player they belong to) and the host evaluates it.
import type { Run } from './run';

export const RITUAL_ROUNDS = 3;
export const POWER_REWARD = 0.2;

export interface RitualDef { id: string; name: string; icon: string; rounds: number; challenge: string; reward: string }
/** `prog[0]` counts the rounds in which the challenge was met. */
export interface ActiveRitual { def: RitualDef; startRound: number; roundsDone: number; prog: number[]; state: 'active' | 'fulfilled' | 'lapsed'; why: string }

export const RITUALS: RitualDef[] = [
  { id: 'fall', name: 'Rite of the Fall', icon: '🕳️', rounds: RITUAL_ROUNDS, challenge: 'Fall through the crumbling floor at least once in each round', reward: `+${Math.round(POWER_REWARD * 100)}% damage for the rest of the run` },
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
  run.ritualRound = { fell: false };
}

/** Called when a round ends: count it if the challenge was met, and resolve the ritual after its last round. */
export function ritualRoundEnd(run: Run) {
  for (const r of run.rituals) {
    if (r.state !== 'active') continue;
    r.roundsDone++;
    if (run.ritualRound.fell) r.prog[0]++;
    else { r.state = 'lapsed'; r.why = 'You were not caught by the falling floor.'; continue; }
    if (r.roundsDone >= r.def.rounds) {
      r.state = 'fulfilled';
      run.player.dmgMul += POWER_REWARD;
      run.recomputeRelics();
    }
  }
}

/** Progress shown for the challenge, as `have / need`. */
export function ritualProgress(r: ActiveRitual, run: Run): string {
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
