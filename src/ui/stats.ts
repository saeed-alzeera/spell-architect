// Stats panel: your current numbers and where each bonus came from (shop upgrades, rituals, level-ups and relics).
// Opened from the pause menu and the round-prep screen.
import { POWER_REWARD, GOLD_BONUS, SANGUINE_HP } from '../game/rituals';
import { critChance, triggerRuleParts } from '../game/chances';
import { RELIC_BY_ID } from '../game/relics';
import { ULT_COOLDOWN } from '../game/ultimates';
import { ULTIMATES } from '../data/runes';
import type { Run } from '../game/run';
import type { UI } from './ui';

/** Starting values of a fresh character (see Run), so the panel can show what has been added on top. */
const BASE = { maxHp: 100, crit: 0.05, critMul: 1.8 };

interface Row { icon: string; label: string; value: string; from: string[] }

const pct = (x: number, d = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`;

export function statRows(run: Run): Row[] {
  const p = run.player, b = run.buys, n = (id: string) => b[id] ?? 0;
  const fall = run.rituals.some((r) => r.state === 'fulfilled' && r.def.id === 'fall');
  const gold = run.rituals.some((r) => r.state === 'fulfilled' && r.def.id === 'gold');
  const pact = run.rituals.some((r) => r.state === 'fulfilled' && r.def.id === 'sanguine');
  const rows: Row[] = [];

  // Whatever the shop and rituals do not explain was picked up from level-ups or relics.
  const dmgShop = n('power') * 0.04, dmgRit = fall ? POWER_REWARD : 0, dmgLvl = p.dmgMul - 1 - dmgShop - dmgRit;
  rows.push({ icon: '🔺', label: 'Spell damage', value: `×${p.dmgMul.toFixed(2)}`, from: [
    n('power') ? `Spell Power ×${n('power')}: ${pct(dmgShop)}` : '', fall ? `Rite of the Fall: ${pct(dmgRit)}` : '', dmgLvl > 0.004 ? `Level-ups: ${pct(dmgLvl)}` : '' ] });

  const cdShop = Math.pow(0.96, n('haste')), cdLvl = p.cdMul / cdShop;
  rows.push({ icon: '⏩', label: 'Cooldowns', value: p.cdMul === 1 ? 'normal' : `${pct(p.cdMul - 1)}`, from: [
    n('haste') ? `Haste ×${n('haste')}: ${pct(cdShop - 1, 1)}` : '', cdLvl < 0.996 ? `Level-ups: ${pct(cdLvl - 1, 1)}` : '' ] });

  const crShop = n('crit') * 0.03, crLvl = p.crit - BASE.crit - crShop;
  rows.push({ icon: '🎯', label: 'Crit chance', value: `${Math.round(p.crit * 100)}%`, from: [
    `Base: ${Math.round(BASE.crit * 100)}% (Lightning spells +12% on top)`, n('crit') ? `Keen Edge ×${n('crit')}: ${pct(crShop)}` : '', crLvl > 0.004 ? `Level-ups: ${pct(crLvl)}` : '' ] });

  rows.push({ icon: '🗡️', label: 'Crit damage', value: `×${p.critMul.toFixed(2)}`, from: [
    `Base: ×${BASE.critMul.toFixed(1)}`, p.critMul - BASE.critMul > 0.004 ? `Level-ups: +${(p.critMul - BASE.critMul).toFixed(2)}` : '' ] });

  const hpShop = n('maxhp') * 10, hpRit = pact ? SANGUINE_HP : 0, hpLvl = p.maxHp - BASE.maxHp - hpShop - hpRit;
  rows.push({ icon: '❤️', label: 'Max health', value: `${Math.round(p.maxHp)}`, from: [
    `Base: ${BASE.maxHp}`, n('maxhp') ? `Vitality ×${n('maxhp')}: +${hpShop}` : '', pact ? `Sanguine Pact: +${hpRit}` : '', hpLvl > 0.5 ? `Level-ups: +${Math.round(hpLvl)}` : '' ] });

  rows.push({ icon: '📜', label: 'Spell slots', value: `${run.slots}`, from: [n('slot') ? `Bought: ${n('slot')}` : ''] });
  rows.push({ icon: '🔷', label: 'Capacity bought', value: n('cap') ? `+${n('cap') * 2}` : 'none', from: [n('cap') ? `Capacity ×${n('cap')} (+2 each)` : ''] });

  const w = (id: string) => run.equipped.includes(id);
  rows.push({ icon: '🔔', label: 'Trigger chances', value: w('echo') || w('dice') ? 'modified' : 'normal', from: triggerRuleParts(run).map((x) => `${x.label}: ${x.text}`) });
  const cr: { label: string; text: string }[] = [];
  critChance(run, 'lightning', null, cr);
  rows.push({ icon: '⚡', label: 'Crit chance on Lightning', value: `${Math.round(critChance(run, 'lightning', null) * 100)}%`, from: cr.map((x) => `${x.label}: ${x.text}`) });

  const m = run.mods;
  rows.push({ icon: '◈', label: 'Coins', value: `×${(m.coinMul * (gold ? 1 + GOLD_BONUS : 1)).toFixed(2)}`, from: [
    w('lodestone') ? `${RELIC_BY_ID.lodestone.name}: ×1.2` : '', w('purse') ? `${RELIC_BY_ID.purse.name}: ×1.5` : '', gold ? `Golden Idol: ×${1 + GOLD_BONUS}` : '' ] });
  rows.push({ icon: '🛒', label: 'Shop prices', value: m.priceMul === 1 ? 'normal' : pct(m.priceMul - 1), from: [
    w('bell') ? `${RELIC_BY_ID.bell.name}: prices −10%, rerolls cost 1 less` : '', w('purse') ? `${RELIC_BY_ID.purse.name}: rerolls cost double` : '' ] });
  rows.push({ icon: '⚒️', label: 'Forge cost', value: `${run.forgeCost()} Cores`, from: [w('hammer') ? `${RELIC_BY_ID.hammer.name}: 2 fewer Cores` : ''] });
  const uls = run.ultimates();
  if (uls.length) rows.push({ icon: '🌋', label: 'Ultimates', value: `${ULT_COOLDOWN}s recharge`, from: uls.map((u, i) => `${ULTIMATES[u.el].name} (spell ${u.i + 1}): ${['Space', 'Q', 'R', 'F', 'C', 'V'][i]}`) });
  return rows.map((r) => ({ ...r, from: r.from.filter(Boolean) }));
}

export function statsHtml(run: Run): string {
  const rows = statRows(run).map((r) => `<div class="stcard"><div class="sth"><span class="sti">${r.icon}</span><span class="stl">${r.label}</span><b class="stv">${r.value}</b></div>
    ${r.from.length ? `<ul>${r.from.map((f) => `<li>${f}</li>`).join('')}</ul>` : '<p class="muted">No upgrades yet.</p>'}</div>`).join('');
  const rit = run.rituals.map((r) => `<span class="ritdone ${r.state}">${r.def.icon} ${r.def.name}: ${r.state === 'fulfilled' ? `✔ ${r.def.reward}` : r.state === 'lapsed' ? 'lapsed' : `${r.roundsDone}/${r.def.rounds} rounds`}</span>`).join('');
  return `<div class="stats"><div class="stgrid">${rows}</div>${rit ? `<h4>Rituals</h4><div class="ritdones">${rit}</div>` : ''}</div>`;
}

export function showStats(ui: UI, run: Run) {
  ui.openModal(ui.modal('Your Stats', statsHtml(run), 'wide'), 'stats');
}
