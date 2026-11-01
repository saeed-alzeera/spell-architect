// Between-round shop, embedded in the spell editor's right-hand pane: one shelf of cards (runes, a relic, permanent upgrades) and selling.
// The pane owns only the two pending-choice states (capacity target, relic swap); the editor owns the tab and re-renders after `click`.
import { RUNE_BY_ID, RUNES, RARITY, KIND_LABEL, ELEMENTS, runeColor } from '../data/runes';
import { costOf } from '../core/spell';
import { RELIC_BY_ID, relicColor, relicSellPrice } from '../game/relics';
import { buyOffer, upgradeOf, reroll, rerollCost, sellPrice, owned } from '../game/shop';
import { audio } from '../core/audio';
import type { Run } from '../game/run';
import { icon } from './icons';

const coin = (n: number | string) => `<span class="pr">${icon('coins', 10)}${n}</span>`;

export class ShopPane {
  /** a relic offer waiting for the player to pick which worn relic to sell */
  swapFor: string | null = null;
  /** the capacity upgrade waiting for the player to pick which spell gets it */
  picking: string | null = null;

  constructor(private run: Run, private say: (msg: string, bad?: boolean) => void) {}

  reset() { this.swapFor = null; this.picking = null; }

  buyHtml(): string {
    const run = this.run;
    const cards = run.shop.stock.map((o) => {
      const afford = run.coins >= o.price;
      if (o.upgrade) {
        const up = upgradeOf(run, o.upgrade);
        if (!up) return '';
        const ok = up.avail && afford;
        return `<div class="scard upoffer ${!up.avail ? 'sold' : ok ? 'aff' : 'poor'} ${this.picking === o.id ? 'pick' : ''}" data-offer="${o.id}" style="--rc:${RARITY[up.rarity].color};--c:${RARITY[up.rarity].color}" title="${up.title}: ${up.desc}">
          <div class="sch"><span class="sci">${up.icon}</span><div class="scn">${up.title}<small>Upgrade</small></div><div class="sprice">${!up.avail ? 'MAX' : coin(up.price)}</div></div>
          <p>${up.desc}</p></div>`;
      }
      if (o.relic) {
        const r = RELIC_BY_ID[o.rune];
        return `<div class="scard relicoffer ${o.sold ? 'sold' : afford ? 'aff' : 'poor'}" data-offer="${o.id}" style="--rc:${relicColor(r)};--c:${relicColor(r)}" title="${r.name}: ${r.desc}">
          <div class="sch"><span class="sci">${r.icon}</span><div class="scn">${r.name}<small>${r.cursed ? 'Cursed' : RARITY[r.rarity].name} relic</small></div><div class="sprice">${o.sold ? 'SOLD' : coin(o.price)}</div></div>
          <p>${r.desc}</p></div>`;
      }
      const r = RUNE_BY_ID[o.rune];
      const own = owned(run, r.id);
      const prog = r.kind === 'core' && r.element ? `<div class="stag" title="Cores owned toward a forge">${ELEMENTS[r.element].icon} ${run.coreCopies(r.element)}/${run.forgeCost()}</div>` : own ? `<div class="stag">×${own}</div>` : '';
      return `<div class="scard ${o.sold ? 'sold' : afford ? 'aff' : 'poor'}" data-offer="${o.id}" style="--rc:${r.kind === 'core' ? '#9a9ab8' : RARITY[r.rarity].color};--c:${runeColor(r)}" title="${r.name}: ${r.desc}">
        <div class="sch"><span class="sci">${r.icon}</span><div class="scn">${r.name}<small>${r.kind === 'core' ? '' : RARITY[r.rarity].name + ' '}${KIND_LABEL[r.kind]} · cap ${costOf(r.id)}</small></div><div class="sprice">${o.sold ? 'SOLD' : coin(o.price)}</div></div>
        <p>${r.desc}</p>${prog}</div>`;
    }).join('');
    const spells = this.picking ? `<div class="picker"><b>+2 capacity for?</b>${run.spells.map((s, i) => `<button data-spell="${i}">${i + 1}. ${s.def.root ? s.c.name : 'Empty'} <small>${s.c.cost}/${s.def.capacity}</small></button>`).join('')}<button data-spell="x" title="Cancel">${icon('x', 10)}</button></div>` : '';
    const swapOffer = this.swapFor ? run.shop.stock.find((x) => x.id === this.swapFor) : null;
    const swap = swapOffer ? `<div class="picker"><b>Relics full. Sell one for ${RELIC_BY_ID[swapOffer.rune].name} (${coin(swapOffer.price)})?</b>${run.equipped.map((id) => `<button data-swapout="${id}">${RELIC_BY_ID[id].icon} ${RELIC_BY_ID[id].name} <small>+${relicSellPrice(RELIC_BY_ID[id])}</small></button>`).join('')}<button data-swapout="x" title="Cancel">${icon('x', 10)}</button></div>` : '';
    const m = run.mods, notes = [
      m.priceMul !== 1 ? `Prices ${Math.round((m.priceMul - 1) * 100)}%` : '', m.rerollMinus ? `Rerolls −${m.rerollMinus}` : '', m.rerollMul !== 1 ? `Rerolls ×${m.rerollMul}` : '',
      m.coinMul !== 1 ? `Coins ×${m.coinMul.toFixed(2)}` : '' ].filter(Boolean);
    const mods = notes.length ? `<div class="shopmods" title="Active bonuses from your relics (see the Stats tab)">${notes.join(' · ')}</div>` : '';
    return `${swap}${spells}${mods}<div class="scards">${cards}</div>`;
  }

  /** Selling is by dragging (a click used to sell, and relics were lost by accident): drop a rune from the pool, or a relic from the bar, on this pane. */
  sellHtml(): string {
    const run = this.run;
    const pool = RUNES.filter((r) => (run.inv[r.id] ?? 0) > 0).map((r) => `<div class="rchip inv" draggable="true" data-rune="${r.id}" style="--c:${runeColor(r)}" title="${r.name}: drag it onto this pane to sell for ${sellPrice(run, r)}">
      <span class="ri">${r.icon}</span><span class="rn">${r.name}</span><span class="rc">+${sellPrice(run, r)}</span><span class="rx">×${run.inv[r.id]}</span></div>`).join('');
    return `<div class="selldrop">${icon('sell', 18)}<b>Drag to sell</b><small>Drag a rune from the pool (or a relic from the relic bar) onto this pane. Nothing sells by clicking.</small></div><div class="chips">${pool || `<p class="muted">${icon('none', 12)}</p>`}</div>`;
  }

  rerollHtml(): string {
    const cost = rerollCost(this.run);
    return `<button class="rr" data-reroll title="Reroll the whole shelf" ${this.run.coins >= cost ? '' : 'disabled'}>${icon('reroll', 12)}${coin(cost)}</button>`;
  }

  /** Handle a click inside the pane. Returns true when it was a shop action (the caller re-renders). */
  click(t: HTMLElement): boolean {
    const run = this.run, say = this.say;
    if (t.closest('[data-reroll]')) {
      this.reset();
      if (reroll(run)) { audio.play('pick'); say('Shelf rerolled.'); } else say('Not enough coins to reroll.', true);
      return true;
    }
    const of = t.closest('[data-offer]') as HTMLElement | null;
    if (of) {
      const o = run.shop.stock.find((x) => x.id === of.dataset.offer)!;
      if (o.upgrade === 'cap') {
        if (run.coins < o.price) { say(`Not enough coins (need ${o.price}).`, true); audio.play('warn'); } else this.picking = o.id;
        return true;
      }
      if (o.relic && !o.sold && run.relicsFull && !run.equipped.includes(o.rune)) { this.swapFor = o.id; return true; }
      const err = buyOffer(run, o);
      if (err) { say(err, true); audio.play('warn'); }
      else { say(o.upgrade ? `${upgradeOf(run, o.upgrade)?.title ?? 'Upgrade'} bought.` : o.relic ? `Bought ${RELIC_BY_ID[o.rune].name}.` : `Bought ${RUNE_BY_ID[o.rune].name}. It is in your rune pool below.`); audio.play('pick'); }
      return true;
    }
    const so = t.closest('[data-swapout]') as HTMLElement | null;
    if (so) {
      const o = run.shop.stock.find((x) => x.id === this.swapFor);
      const out = so.dataset.swapout!;
      this.swapFor = null;
      if (o && out !== 'x') {
        if (run.coins + relicSellPrice(RELIC_BY_ID[out]) < o.price) { say(`Not enough coins (need ${o.price}).`, true); audio.play('warn'); }
        else { run.sellRelic(out); const err = buyOffer(run, o); if (err) { say(err, true); audio.play('warn'); } else { say(`Bought ${RELIC_BY_ID[o.rune].name}.`); audio.play('pick'); } }
      }
      return true;
    }
    const sp = t.closest('[data-spell]') as HTMLElement | null;
    if (sp) {
      const o = run.shop.stock.find((x) => x.id === this.picking);
      this.picking = null;
      if (sp.dataset.spell === 'x' || !o) return true;
      const err = buyOffer(run, o, +sp.dataset.spell!);
      if (err) { say(err, true); audio.play('warn'); } else { say('Capacity increased.'); audio.play('pick'); }
      return true;
    }
    return false;
  }
}
