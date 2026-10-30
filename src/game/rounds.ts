// Round structure: timed survival rounds and a boss every 5th round. Only bosses have resistances and weaknesses.
import { ELEMENTS, type Element } from '../data/runes';

export const FINAL_ROUND = 20;
export const BOSS_EVERY = 5;
export const ROUND_DIFF = 50; // "difficulty seconds" each round adds to the director clock

export type Aff = Element | 'neutral';

export const isBossRound = (r: number) => r % BOSS_EVERY === 0;
export const bossKind = (r: number) => Math.min(3, r / BOSS_EVERY - 1);
export const roundLen = (quick: boolean) => (quick ? 12 : 45);

export interface Plan {
  round: number;
  boss: number | null;
  bossRes: Record<string, number> | null;
}

export const BOSS_RES: Record<number, Record<string, number>> = {
  0: { fire: 0.4, water: 1.3 },
  1: { poison: 0, water: 0.5, fire: 1.3 },
  2: { lightning: 0, ice: 0.5, gravity: 1.3 },
  3: { gravity: 0, ice: 0.3, poison: 0.5, fire: 1.25 },
};

export function planFor(round: number): Plan {
  const boss = isBossRound(round) ? bossKind(round) : null;
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
