// Relic UI: reward pick overlay and the sell manager (also embedded in the editor and the shop).
import { RELIC_BY_ID, RELIC_SLOTS, relicColor, relicSellPrice } from '../game/relics';
import { RARITY } from '../data/runes';
import { audio } from '../core/audio';
import type { Run } from '../game/run';
import { el, type UI } from './ui';

export const relicCard = (id: string, run: Run | null, extra = '') => {
  const r = RELIC_BY_ID[id];
  const badge = run && r.badge && run.equipped.includes(id) ? `<em class="rbadge">${r.badge(run)}</em>` : '';
  return `<div class="relic ${r.cursed ? 'cursed' : ''}" data-relic="${id}" style="--rc:${relicColor(r)}" title="${r.name}: ${r.desc}">
    <span class="rlic">${r.icon}</span><div class="rlt"><b>${r.name}</b><small>${r.cursed ? 'Cursed' : RARITY[r.rarity].name}</small></div>${badge}${extra}</div>`;
};

/** Worn relics, with a Sell button on each. There is no stash: a full set must be sold down for a new relic. */
export function relicManager(run: Run, rerender: () => void): { html: string; bind: (root: HTMLElement) => void } {
  const slots = Array.from({ length: RELIC_SLOTS }, (_, i) => run.equipped[i]);
  const html = `<div class="relmgr">
    <h4>RELICS <small>${run.equipped.length}/${RELIC_SLOTS}</small></h4>
    <div class="relslots">${slots.map((id) => id ? `<div class="rslot full" data-sell="${id}">${relicCard(id, run)}<button class="mini">Sell ◈ ${relicSellPrice(RELIC_BY_ID[id])}</button></div>` : '<div class="rslot"><span>empty</span></div>').join('')}</div>
  </div>`;
  const bind = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>('[data-sell]').forEach((b) => b.addEventListener('click', () => { run.sellRelic(b.dataset.sell!); audio.play('gem'); rerender(); }));
  };
  return { html, bind };
}

export function showRelicPick(ui: UI, run: Run, options: string[]) {
  const n = el(`<div class="overlay lv relicpick"><div class="panel rewardp">
    <div class="rtitle"><small>RELIC</small><h2>Choose a Relic</h2></div>
    <div class="cards">${options.map((id, i) => { const r = RELIC_BY_ID[id]; return `<div class="card ${r.cursed ? 'cursedc' : ''}" data-i="${i}" style="--rc:${relicColor(r)};--c:${relicColor(r)}">
      <div class="ck">${i + 1}</div><div class="cicon">${r.icon}</div><div class="cname">${r.name}</div><div class="crar">${r.cursed ? 'Cursed' : RARITY[r.rarity].name}</div>
      <p>${r.desc}</p></div>`; }).join('')}</div>
    <div class="swapbox hidden"></div>
    <div class="rbtns"><button class="big" data-skip>Skip</button></div></div></div>`);
  const box = n.querySelector('.swapbox') as HTMLElement;
  const take = (id: string) => { run.addRelic(id); audio.play('level'); ui.pop('relic'); };
  /** Slots full: the player picks which worn relic to sell for the new one. */
  const choose = (i: number) => {
    const id = options[i];
    if (!run.relicsFull) { take(id); return; }
    box.classList.remove('hidden');
    box.innerHTML = `<h4>Sell one to take ${RELIC_BY_ID[id].name}</h4><div class="relslots">${run.equipped.map((w) => `<div class="rslot full" data-out="${w}">${relicCard(w, run)}<button class="mini">Sell ◈ ${relicSellPrice(RELIC_BY_ID[w])}</button></div>`).join('')}</div><button class="big" data-back>Back</button>`;
    box.onclick = (e) => {
      const t = e.target as HTMLElement;
      const o = t.closest('[data-out]') as HTMLElement | null;
      if (o) { run.sellRelic(o.dataset.out!); take(id); }
      else if (t.closest('[data-back]')) box.classList.add('hidden');
    };
  };
  n.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const c = t.closest('.card') as HTMLElement | null;
    if (c) choose(+c.dataset.i!);
    else if (t.closest('[data-skip]')) { audio.play('ui'); ui.pop('relic'); }
  });
  ui.push('relic', n, (e) => {
    if (['1', '2', '3'].includes(e.key) && options[+e.key - 1]) { choose(+e.key - 1); return true; }
    return false;
  });
}
