// THE one place that decides the odds of things: critical hits and Trigger runes.
//
// Every bonus or penalty to those odds is listed here, whatever it comes from (shop purchases, level-ups, relics, rituals, mutations, evolved
// Cores). Combat, the spell compiler and the UI all read through this module, so changing a number here changes the game AND what the Stats
// tab / trigger tooltips say. To add a new source of odds, add one line to `critChance` or `triggerRules` below; nothing else needs to know.
//
//   crit chance   = player crit (base + shop + level-ups) + Lightning bonus + the spell's mutations, capped at 100%
//   trigger chance = (rune base + flat bonuses) x multipliers, capped at MAX_TRIGGER_CHANCE; then re-rolled `triggerRolls` times (Vow of Silence)
import { ruleMods, triggerChanceOf, MAX_TRIGGER_CHANCE } from '../core/spell';
import { triggerRolls } from './rituals';
import { has } from './relics';
import type { Run } from './run';
import type { ActiveSpell } from './types';

/** One line of an explanation: where a bonus comes from and what it does. */
export interface Part { label: string; text: string }

export const LIGHTNING_CRIT = 0.12;
export const ECHO_TRIGGER_ADD = 0.08;
export const DICE_TRIGGER_MUL = 1.5;
export const DICE_TRIGGER_COST = 1;

const pp = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;

/** Chance (0..1) that one hit by `sp` with `element` is a critical hit. Pass `why` to also get the list of what makes it up (for the UI). */
export function critChance(run: Run, element: string, sp: ActiveSpell | null, why?: Part[]): number {
  let c = run.player.crit;
  why?.push({ label: 'Your crit chance (base, shop upgrades, level-ups)', text: `${Math.round(c * 100)}%` });
  if (element === 'lightning') { c += LIGHTNING_CRIT; why?.push({ label: 'Lightning element', text: pp(LIGHTNING_CRIT) }); }
  if (sp && sp.mut.crit) { c += sp.mut.crit; why?.push({ label: "This spell's mutations / evolved Core", text: pp(sp.mut.crit) }); }
  return Math.min(1, c);
}

/** Push the global Trigger rules (flat chance, multiplier, capacity cost) into the spell compiler. Called whenever relics change. */
export function applyTriggerRules(run: Run) {
  ruleMods.triggerChanceAdd = has(run, 'echo') ? ECHO_TRIGGER_ADD : 0;
  ruleMods.triggerChanceMul = has(run, 'dice') ? DICE_TRIGGER_MUL : 1;
  ruleMods.triggerCost = has(run, 'dice') ? DICE_TRIGGER_COST : 0;
}

/** What currently changes Trigger odds, as readable lines (used by the Stats tab and tooltips). */
export function triggerRuleParts(run: Run): Part[] {
  const out: Part[] = [];
  if (has(run, 'echo')) out.push({ label: 'Echo Chamber', text: `${pp(ECHO_TRIGGER_ADD)} to every chance` });
  if (has(run, 'dice')) out.push({ label: "Gambler's Dice", text: `chances ×${DICE_TRIGGER_MUL}, each Trigger rune costs +${DICE_TRIGGER_COST} capacity` });
  const rolls = triggerRolls(run);
  if (rolls > 1) out.push({ label: 'Vow of Silence reward', text: `${rolls} rolls per event` });
  out.push({ label: 'Global cap', text: `${Math.round(MAX_TRIGGER_CHANCE * 100)}% per roll` });
  return out;
}

/** The real odds that a Trigger rune with this base chance fires when its event happens: after relics, the cap and extra rolls. */
export function triggerOdds(run: Run, base: number): { perRoll: number; final: number; rolls: number } {
  const perRoll = triggerChanceOf(base), rolls = base >= 1 ? 1 : triggerRolls(run);
  return { perRoll, rolls, final: 1 - Math.pow(1 - perRoll, rolls) };
}
