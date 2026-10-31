// Stats panel: your current numbers and where each bonus came from (shop upgrades, rituals, level-ups and relics).
// Opened from the pause menu and the round-prep screen.
import { POWER_REWARD, GOLD_BONUS } from '../game/rituals';
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
    `Base: ${Math.round(BASE.crit * 100)}%`, n('crit') ? `Keen Edge ×${n('crit')}: ${pct(crShop)}` : '', crLvl > 0.004 ? `Level-ups: ${pct(crLvl)}` : '' ] });

  rows.push({ icon: '🗡️', label: 'Crit damage', value: `×${p.critMul.toFixed(2)}`, from: [
    `Base: ×${BASE.critMul.toFixed(1)}`, p.critMul - BASE.critMul > 0.004 ? `Level-ups: +${(p.critMul - BASE.critMul).toFixed(2)}` : '' ] });

  const hpShop = n('maxhp') * 10, hpLvl = p.maxHp - BASE.maxHp - hpShop;
  rows.push({ icon: '❤️', label: 'Max health', value: `${Math.round(p.maxHp)}`, from: [
    `Base: ${BASE.maxHp}`, n('maxhp') ? `Vitality ×${n('maxhp')}: +${hpShop}` : '', hpLvl > 0.5 ? `Level-ups: +${Math.round(hpLvl)}` : '' ] });

  rows.push({ icon: '📜', label: 'Spell slots', value: `${run.slots}`, from: [n('slot') ? `Bought: ${n('slot')}` : ''] });
  rows.push({ icon: '🔷', label: 'Capacity bought', value: n('cap') ? `+${n('cap') * 2}` : 'none', from: [n('cap') ? `Capacity ×${n('cap')} (+2 each)` : ''] });

  const m = run.mods;
  if (m.coinMul !== 1 || m.priceMul !== 1 || gold) {
    rows.push({ icon: '◈', label: 'Coins & prices', value: `${pct(m.coinMul - 1)} coins`, from: [
      m.priceMul !== 1 ? `Shop prices: ${pct(m.priceMul - 1)}` : '', gold ? `Golden Idol: all coins +${Math.round(GOLD_BONUS * 100)}%` : '', 'From relics' ] });
  }
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
