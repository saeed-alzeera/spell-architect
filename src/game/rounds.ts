// Round structure: timed survival rounds and a boss every 5th round. Only bosses have resistances and weaknesses.
import { ELEMENTS, type Element } from '../data/runes';

export const FINAL_ROUND = 20;
export const BOSS_EVERY = 5;
export const ROUND_DIFF = 50; // "difficulty seconds" each round adds to the director clock

export type Aff = Element | 'neutral';

export const isBossRound = (r: number) => r % BOSS_EVERY === 0;
export const BOSS_VARIANTS = 3;
/** Which boss tier a boss round belongs to (0..3: rounds 5, 10, 15, 20). */
export const bossTier = (r: number) => Math.min(3, r / BOSS_EVERY - 1);
/** The boss for a boss round: three candidates per tier, picked from the run seed so host and joiners agree. `kind` indexes BOSSES (tier * 3 + variant). */
export function bossKind(r: number, seed: number): number {
  let h = Math.imul(seed ^ Math.imul(r, 0x45d9f3b), 0x2c1b3c6d);
  h ^= h >>> 15; h = Math.imul(h, 0x297a2d39); h ^= h >>> 13;
  return bossTier(r) * BOSS_VARIANTS + ((h >>> 0) % BOSS_VARIANTS);
}
export const roundLen = (quick: boolean) => (quick ? 12 : 45);

export interface Plan {
  round: number;
  boss: number | null;
  bossRes: Record<string, number> | null;
}

/** Resistances (0 = immune, <1 resists, >1 weak) by boss kind. Order matches BOSSES in bosses.ts. */
export const BOSS_RES: Record<number, Record<string, number>> = {
  0: { fire: 0.4, water: 1.3 }, // Stone Warden
  1: { fire: 0, water: 1.3, ice: 1.25 }, // Cinder Golem
  2: { ice: 0.4, lightning: 1.3, gravity: 0.5 }, // Frost Sentinel
  3: { poison: 0, water: 0.5, fire: 1.3 }, // Plague Matron
  4: { water: 0, lightning: 1.3, poison: 1.3, gravity: 0.5 }, // Tide Oracle
  5: { fire: 0, water: 1.3, ice: 1.25, poison: 0.5 }, // Pyre Warlock
  6: { lightning: 0, ice: 0.5, gravity: 1.3 }, // Storm Colossus
  7: { ice: 0, lightning: 0.5, fire: 1.3 }, // Glacier Titan
  8: { gravity: 0, fire: 0.5, lightning: 1.3 }, // Quake Colossus
  9: { gravity: 0, ice: 0.3, poison: 0.5, fire: 1.25 }, // The Void Architect
  10: { poison: 0, fire: 0.5, water: 1.3, lightning: 1.25 }, // The Hollow Regent
  11: { fire: 0, gravity: 0.3, ice: 1.3, poison: 1.25 }, // The Star Eater
};

export function planFor(round: number, seed: number): Plan {
  const boss = isBossRound(round) ? bossKind(round, seed) : null;
  return { round, boss, bossRes: boss !== null ? BOSS_RES[boss] : null };
}

export function describeRes(res: Partial<Record<string, number>>): { immune: Element[]; resist: Element[]; weak: Element[] } {
  const immune: Element[] = [], resist: Element[] = [], weak: Element[] = [];
  for (const [e, m] of Object.entries(res)) {
    if (m === undefined) continue;
    if (m <= 0) immune.push(e as Element); else if (m < 1) resist.push(e as Element); else if (m > 1) weak.push(e as Element);
  }
  return { immune, resist, weak };
}

export const affColor = (a: Aff): number => (a === 'neutral' ? 0xffffff : ELEMENTS[a].color);
