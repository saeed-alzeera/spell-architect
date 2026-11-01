// Spell editor. Each slot is a nested stack of cards: a FORM with a CORE socket (its element),
// AUGMENT chips (behaviors / modifiers) and TRIGGER blocks that each launch further Forms.
// All slots sit side by side as lanes; the right-hand pane holds the shop (buy / sell) and the forge, so building and buying happen in one place.
// Pauses the game while open.
import {
  RUNES, RUNE_BY_ID, ELEMENTS, FORMS, KIND_COLOR, KIND_LABEL, runeColor, EVOLVED_OF, MAX_MERGE_CHANCE, BASE_CORE_OF, ULTIMATES, MERGEABLE, mergeResult, tierUpResult, triggerLevel, type RuneKind, type Element,
} from '../data/runes';
import { ULT_COOLDOWN } from '../game/ultimates';
import { owned, sellRune } from '../game/shop';
import { MUT_OPTION_BY_ID } from '../data/mutations';
import {
  checkAttach, checkSwapForm, checkTransfer, costOf, findNode, newNode, spellCost, subtreeRunes, walk, type Check, type SpellDef, type SpellNode,
} from '../core/spell';
import { triggerOdds, triggerRuleParts } from '../game/chances';
import { relicSellPrice, RELIC_BY_ID } from '../game/relics';
import { statsHtml } from './stats';
import { audio } from '../core/audio';
import type { Run } from '../game/run';
import type { ActiveSpell } from '../game/types';
import { el, type UI } from './ui';
import { relicBar } from './relics';
import { showSpellOverview } from './overview';
import { icon, type IconName } from './icons';
import { ShopPane } from './shop';

export function openEditor(ui: UI, run: Run, tab?: Editor['tab']) { new Editor(ui, run, tab).open(); }

const TRIG_ICON: Record<string, string> = { hit: '💥', kill: '💀', expiry: '⏳', crit: '✴️' };
/** One icon per rune kind, used wherever a text label would cost space (tooltips carry the words). */
const KIND_ICON: Record<RuneKind | 'all', IconName> = { all: 'grid', form: 'form', core: 'core', behavior: 'behavior', trigger: 'trigger', modifier: 'modifier' };
const kg = (k: RuneKind | 'all', size = 14) => icon(KIND_ICON[k], size);

class Editor {
  root!: HTMLElement;
  slot = 0;
  sel: string | null = null;
  filter: RuneKind | 'all' = 'all';
  drag: { rune?: string; node?: number; slot?: number; relic?: string } | null = null;
  menu: HTMLElement | null = null;
  hint = '';
  hintBad = false;
  /** right-hand pane: the shop's buy / sell shelves, or the forge */
  tab: 'buy' | 'sell' | 'forge' | 'stats' = 'buy';
  shop: ShopPane;
  /** 'all' lays every slot out side by side; 'one' shows only the active slot. */
  view: 'all' | 'one' = 'all';
  mergeSel: string[] = [];

  constructor(private ui: UI, private run: Run, tab?: Editor['tab']) {
    const first = run.spells.findIndex((s) => s.def.root);
    this.slot = first >= 0 ? first : 0;
    this.shop = new ShopPane(run, (m, b) => this.say(m, b));
    if (run.sandbox) this.tab = 'forge'; // no economy in the sandbox
    if (tab) this.tab = tab;
  }

  get sp(): ActiveSpell { return this.run.spells[this.slot]; }

  open() {
    this.root = el('<div class="overlay editor-ov"><div class="editor"></div></div>');
    this.ui.push('editor', this.root, (e) => {
      if (e.key === 'Escape' || e.key === 'e' || e.key === 'E' || e.key === 'Tab') { this.close(); return true; }
      return false;
    });
    this.bind();
    this.render();
    audio.play('ui');
  }
  close() { this.closeMenu(); this.ui.pop('editor'); audio.play('ui'); }

  say(msg: string, bad = false) {
    this.hint = msg; this.hintBad = bad;
    const h = this.root.querySelector('.hintbar');
    if (h) { const t = h.querySelector('.ht'); if (t) t.textContent = msg; h.classList.toggle('bad', bad); }
  }

  recompile() { this.run.recompile(this.sp); }

  /** Slot index of the lane containing `t`, or null when `t` is outside every lane. */
  laneOf(t: HTMLElement): number | null {
    const ln = t.closest('[data-lane]') as HTMLElement | null;
    return ln ? +ln.dataset.lane! : null;
  }

  /* ------------------------------ operations ------------------------------ */

  attach(parentId: number | null, runeId: string): boolean {
    const sp = this.sp;
    if ((this.run.inv[runeId] ?? 0) <= 0) { this.say('You have none of that rune left.', true); return false; }
    const parent = parentId === null ? null : findNode(sp.def, parentId)?.node ?? null;
    if (parentId !== null && !parent) return false;
    if (parent && RUNE_BY_ID[parent.rune].kind === 'form' && RUNE_BY_ID[runeId].kind === 'form') return this.swapForm(parent, runeId);
    const c = checkAttach(sp.def, parent, runeId);
    if (!c.ok) { this.say(c.reason, true); audio.play('warn'); return false; }
    const n = newNode(runeId);
    if (!parent) sp.def.root = n; else parent.children.push(n);
    this.run.inv[runeId]--;
    this.recompile();
    audio.play('pick');
    this.say(`${RUNE_BY_ID[runeId].name} placed.`);
    if ((this.run.inv[runeId] ?? 0) <= 0 && this.sel === runeId) this.sel = null;
    return true;
  }

  /** Can `runeId` be put on `parent`? Dropping a Form on an existing Form swaps it (see swapForm), anything else is a normal attach. */
  placeCheck(def: SpellDef, parent: SpellNode | null, runeId: string): Check {
    if (parent && RUNE_BY_ID[parent.rune].kind === 'form' && RUNE_BY_ID[runeId].kind === 'form') return checkSwapForm(def, parent, runeId);
    return checkAttach(def, parent, runeId);
  }

  /** Replace a Form with another from the pool, keeping its Core, triggers and every rune that still works on the new Form. Runes that don't fit go back to the pool. */
  swapForm(node: SpellNode, runeId: string): boolean {
    const sp = this.sp;
    if ((this.run.inv[runeId] ?? 0) <= 0) { this.say('You have none of that rune left.', true); return false; }
    const c = checkSwapForm(sp.def, node, runeId);
    if (!c.ok) { this.say(c.reason, true); audio.play('warn'); return false; }
    const old = node.rune, inv = this.run.inv;
    for (const d of c.dropped) for (const r of subtreeRunes(d)) inv[r] = (inv[r] ?? 0) + 1;
    node.children = node.children.filter((x) => !c.dropped.includes(x));
    node.rune = runeId;
    inv[runeId]--; inv[old] = (inv[old] ?? 0) + 1;
    this.recompile();
    audio.play('pick');
    this.say(c.reason);
    if ((inv[runeId] ?? 0) <= 0 && this.sel === runeId) this.sel = null;
    return true;
  }

  move(nodeId: number, newParentId: number): boolean {
    const sp = this.sp;
    const f = findNode(sp.def, nodeId), t = findNode(sp.def, newParentId);
    if (!f || !t || !f.parent) return false;
    const c = checkAttach(sp.def, t.node, f.node.rune, f.node);
    if (!c.ok) { this.say(c.reason, true); audio.play('warn'); return false; }
    f.parent.children = f.parent.children.filter((x) => x !== f.node);
    t.node.children.push(f.node);
    this.recompile();
    audio.play('pick');
    this.say(`Moved ${RUNE_BY_ID[f.node.rune].name}.`);
    return true;
  }

  remove(nodeId: number) {
    const sp = this.sp;
    const f = findNode(sp.def, nodeId);
    if (!f) return;
    for (const r of subtreeRunes(f.node)) this.run.inv[r] = (this.run.inv[r] ?? 0) + 1;
    if (!f.parent) sp.def.root = null;
    else f.parent.children = f.parent.children.filter((x) => x !== f.node);
    this.recompile();
    audio.play('ui');
    this.say('Removed. The runes went back to your pool.');
  }

  /** Move a placed branch from one spell to another (`parentId` null = the empty main slot). */
  transfer(nodeId: number, from: number, to: number, parentId: number | null): boolean {
    const A = this.run.spells[from], B = this.run.spells[to];
    const f = findNode(A.def, nodeId);
    const t = parentId === null ? null : findNode(B.def, parentId);
    if (!f || !f.parent || (parentId !== null && !t)) return false;
    const c = checkTransfer(B.def, t?.node ?? null, f.node);
    if (!c.ok) { this.say(c.reason, true); audio.play('warn'); return false; }
    f.parent.children = f.parent.children.filter((x) => x !== f.node);
    if (t) t.node.children.push(f.node); else B.def.root = f.node;
    this.run.recompile(A); this.run.recompile(B);
    this.slot = to;
    audio.play('pick');
    this.say(`Moved ${RUNE_BY_ID[f.node.rune].name} to spell ${to + 1}.`);
    return true;
  }

  /** Toggle a trigger in the merge selection (max two, same type). */
  pickMerge(id: string) {
    const type = RUNE_BY_ID[id].trigger;
    const cur = this.mergeSel.filter((x) => RUNE_BY_ID[x].trigger === type);
    if (cur.length !== this.mergeSel.length) this.mergeSel = [];
    const have = this.run.inv[id] ?? 0;
    const used = this.mergeSel.filter((x) => x === id).length;
    if (used > 0 && used >= have) { this.mergeSel.splice(this.mergeSel.lastIndexOf(id), 1); return; }
    if (this.mergeSel.length >= 2) this.mergeSel.shift();
    if (used < have) this.mergeSel.push(id);
  }

  /* ------------------------------ events ------------------------------ */

  bind() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (this.menu && !t.closest('.addmenu')) this.closeMenu();
      // Clicking inside a lane makes it the active slot; every branch below then edits that spell.
      const ls = this.laneOf(t);
      const refocus = ls !== null && ls !== this.slot;
      if (refocus) this.slot = ls!;
      const mi =t.closest('[data-pick]') as HTMLElement | null;
      if (mi) {
        if (!mi.classList.contains('dis')) { const pid = +mi.dataset.parent!; const rid = mi.dataset.pick!; this.closeMenu(); this.attach(pid < 0 ? null : pid, rid); this.render(); }
        return;
      }
      const rm = t.closest('[data-rm]') as HTMLElement | null;
      if (rm) { this.remove(+rm.dataset.rm!); this.render(); return; }
      const add = t.closest('[data-add]') as HTMLElement | null;
      if (add) {
        const pid = +add.dataset.add!;
        if (this.sel && add.dataset.kinds === undefined) { this.attach(pid, this.sel); this.render(); }
        else this.openMenu(pid, add, add.dataset.kinds?.split(','));
        return;
      }
      const tb = t.closest('[data-tab]') as HTMLElement | null;
      if (tb) { this.tab = tb.dataset.tab as typeof this.tab; this.shop.reset(); audio.play('ui'); this.render(); return; }
      if (!t.closest('.relbar') && this.shop.click(t)) { this.render(); return; }
      if (t.closest('[data-view]')) { this.view = this.view === 'all' ? 'one' : 'all'; audio.play('ui'); this.render(); this.scrollToLane(); return; }
      if (t.closest('[data-overview]')) { showSpellOverview(this.ui, this.run); return; }
      const mp = t.closest('[data-mpick]') as HTMLElement | null;
      if (mp) { this.pickMerge(mp.dataset.mpick!); this.render(); return; }
      if (t.closest('[data-tierup]')) {
        const [a, b] = this.mergeSel;
        const err = a && b ? this.run.forgeTriggerUp(a, b) : 'Pick two identical triggers.';
        if (err) this.say(err, true);
        else { audio.play('level'); this.say('Forged into a higher-level trigger.'); this.mergeSel = []; }
        this.render(); return;
      }
      if (t.closest('[data-merge]')) {
        const [a, b] = this.mergeSel;
        const err = a && b ? this.run.mergeTriggers(a, b) : 'Pick two triggers of the same type.';
        if (err) this.say(err, true);
        else { audio.play('level'); this.say('Triggers merged into one stronger trigger.'); this.mergeSel = []; }
        this.render(); return;
      }
      const fg = t.closest('[data-forge]') as HTMLElement | null;
      if (fg) {
        const el0 = fg.dataset.forge!;
        if (this.run.forge(el0)) { audio.play('level'); this.say(`Forged ${RUNE_BY_ID[EVOLVED_OF[el0]].name}! Socket it into a Form to use it.`); }
        else this.say(`You need ${this.run.forgeCost()} ${ELEMENTS[el0 as Element].name} cores to forge.`, true);
        this.render(); return;
      }
      const slot = t.closest('[data-slot]') as HTMLElement | null;
      if (slot) { this.slot = +slot.dataset.slot!; this.sel = null; this.hint = ''; this.render(); this.scrollToLane(); return; }
      const f = t.closest('[data-filter]') as HTMLElement | null;
      if (f) { this.filter = f.dataset.filter as RuneKind | 'all'; this.render(); return; }
      const chip = t.closest('.rchip[data-rune]') as HTMLElement | null;
      if (chip) { const id = chip.dataset.rune!; this.sel = this.sel === id ? null : id; audio.play('ui'); this.hint = ''; this.render(); return; }
      if (t.closest('[data-a=close]')) { this.close(); return; }
      if (t.closest('[data-clear]')) { this.sel = null; this.hint = ''; this.render(); return; }
      const empty = t.closest('.emptyroot');
      if (empty) { if (this.sel) { this.attach(null, this.sel); this.render(); } else this.openMenu(-1, empty as HTMLElement, ['form']); return; }
      const tg = t.closest('[data-target]') as HTMLElement | null;
      if (tg && this.sel) { this.attach(+tg.dataset.target!, this.sel); this.render(); return; }
      if (refocus) this.render();
    });
    r.addEventListener('contextmenu', (e) => {
      const t = e.target as HTMLElement;
      const nd = t.closest('[data-node]') as HTMLElement | null;
      if (nd) {
        e.preventDefault();
        const ls = this.laneOf(t);
        if (ls !== null) this.slot = ls;
        this.remove(+nd.dataset.node!); this.render();
      }
    });
    r.addEventListener('mouseover', (e) => {
      const t = e.target as HTMLElement;
      // Hover feedback is about the lane under the cursor, without changing the active slot.
      const keep = this.slot, ls = this.laneOf(t);
      if (ls !== null) this.slot = ls;
      const rd = t.closest('[data-rune],[data-node]') as HTMLElement | null;
      if (rd) {
        let id = rd.dataset.rune;
        if (!id && rd.dataset.node) id = findNode(this.sp.def, +rd.dataset.node)?.node.rune;
        if (id) this.showDetail(id);
      }
      const tg = t.closest('[data-target]') as HTMLElement | null;
      if (tg && this.sel) {
        const n = findNode(this.sp.def, +tg.dataset.target!);
        if (n) { const c = this.placeCheck(this.sp.def, n.node, this.sel); this.say(c.ok ? (RUNE_BY_ID[this.sel].kind === 'form' && RUNE_BY_ID[n.node.rune].kind === 'form' ? `Click to swap: ${c.reason}` : `Click to place ${RUNE_BY_ID[this.sel].name} on ${RUNE_BY_ID[n.node.rune].name}.`) : c.reason, !c.ok); }
      }
      this.slot = keep;
    });
    // drag & drop
    r.addEventListener('dragstart', (e) => {
      const t = (e.target as HTMLElement).closest('[data-rune],[data-node],[data-drag-relic]') as HTMLElement | null;
      if (!t) return;
      const ls = this.laneOf(t);
      if (ls !== null) this.slot = ls;
      this.drag = t.dataset.dragRelic ? { relic: t.dataset.dragRelic } : t.dataset.rune ? { rune: t.dataset.rune } : { node: +t.dataset.node!, slot: this.slot };
      e.dataTransfer?.setData('text/plain', 'sa');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      this.closeMenu();
      setTimeout(() => this.markTargets(), 0);
    });
    r.addEventListener('dragend', () => { this.drag = null; this.clearMarks(); });
    r.addEventListener('dragover', (e) => {
      if (!this.drag) return;
      const t = e.target as HTMLElement;
      const tg = t.closest('[data-target]') as HTMLElement | null;
      const inv = t.closest('.inventory');
      const emp = t.closest('.emptyroot');
      const ls = this.laneOf(t);
      if (ls !== null) this.slot = ls;
      if (t.closest('.shoppane') && this.canSell()) {
        e.preventDefault();
        this.say(this.drag.relic ? `Drop to sell ${RELIC_BY_ID[this.drag.relic].name} for ${relicSellPrice(RELIC_BY_ID[this.drag.relic])} coins.` : 'Drop to sell this rune.');
      } else if (tg) {
        const c = this.checkDrop(+tg.dataset.target!);
        this.say(c.reason, !c.ok);
        if (c.ok) e.preventDefault();
      } else if (emp && (this.drag.rune || this.drag.node !== undefined)) {
        const src = this.drag.node !== undefined ? findNode(this.run.spells[this.drag.slot ?? this.slot].def, this.drag.node) : null;
        const c = this.drag.rune ? checkAttach(this.sp.def, null, this.drag.rune)
          : src && src.parent && this.drag.slot !== this.slot ? checkTransfer(this.sp.def, null, src.node) : { ok: false, reason: '' };
        this.say(c.ok ? 'Drop to equip this Form in the slot.' : c.reason, !c.ok);
        if (c.ok) e.preventDefault();
      } else if (inv && this.drag.node !== undefined) { e.preventDefault(); this.say('Drop to return this rune to your pool.'); }
    });
    r.addEventListener('drop', (e) => {
      const d = this.drag;
      if (!d) return;
      e.preventDefault();
      const t = e.target as HTMLElement;
      if (t.closest('.shoppane') && this.canSell()) {
        this.drag = null;
        if (d.relic) { const v = this.run.sellRelic(d.relic); if (v) { audio.play('gem'); this.say(`Sold ${RELIC_BY_ID[d.relic].name} for ${v} coins.`); } }
        else if (d.rune) { const v = sellRune(this.run, d.rune); if (v) { audio.play('gem'); this.say(`Sold ${RUNE_BY_ID[d.rune].name} for ${v} coins.`); } }
        this.render(); return;
      }
      const tg = t.closest('[data-target]') as HTMLElement | null;
      const inv = t.closest('.inventory');
      const emp = t.closest('.emptyroot');
      const ls = this.laneOf(t);
      if (ls !== null) this.slot = ls;
      this.drag = null;
      if (tg) {
        const id = +tg.dataset.target!;
        if (d.rune) this.attach(id, d.rune);
        else if (d.node !== undefined) { if (d.slot === this.slot) this.move(d.node, id); else this.transfer(d.node, d.slot!, this.slot, id); }
      } else if (emp && d.rune) this.attach(null, d.rune);
      else if (emp && d.node !== undefined && d.slot !== this.slot) this.transfer(d.node, d.slot!, this.slot, null);
      else if (inv && d.node !== undefined) { this.slot = d.slot ?? this.slot; this.remove(d.node); }
      this.render();
    });
  }

  /** Is something that can be sold (a pool rune or a worn relic) being dragged, and is there an economy? */
  canSell() { return !this.run.sandbox && !!this.drag && (!!this.drag.rune || !!this.drag.relic); }

  checkDrop(targetId: number) {
    const sp = this.sp;
    const t = findNode(sp.def, targetId);
    if (!t || !this.drag) return { ok: false, reason: '' };
    if (this.drag.relic) return { ok: false, reason: '' };
    if (this.drag.rune) return this.placeCheck(sp.def, t.node, this.drag.rune);
    const src = this.run.spells[this.drag.slot ?? this.slot];
    const f = findNode(src.def, this.drag.node!);
    if (!f) return { ok: false, reason: '' };
    if (!f.parent) return { ok: false, reason: 'The slot\'s main Form can\'t be moved. Drag it to the rune pool to unequip the whole spell.' };
    if (src !== sp) return checkTransfer(sp.def, t.node, f.node);
    return checkAttach(sp.def, t.node, f.node.rune, f.node);
  }

  markTargets() {
    if (this.canSell()) this.root.querySelector('.shoppane')?.classList.add('selling');
    const keep = this.slot;
    this.root.querySelectorAll<HTMLElement>('[data-lane]').forEach((ln) => {
      const s = +ln.dataset.lane!;
      this.slot = s;
      ln.querySelectorAll<HTMLElement>('[data-target]').forEach((n) => {
        const ok = this.checkDrop(+n.dataset.target!).ok;
        n.classList.toggle('ok', ok); n.classList.toggle('bad', !ok);
      });
      const em = ln.querySelector('.emptyroot');
      if (em && this.drag) {
        const src = this.drag.node !== undefined ? findNode(this.run.spells[this.drag.slot ?? keep].def, this.drag.node) : null;
        const c = this.drag.rune ? checkAttach(this.sp.def, null, this.drag.rune)
          : src && src.parent && this.drag.slot !== s ? checkTransfer(this.sp.def, null, src.node) : { ok: false };
        em.classList.toggle('ok', c.ok); em.classList.toggle('bad', !c.ok);
      }
    });
    this.slot = keep;
  }
  scrollToLane() {
    this.root.querySelector(`[data-lane="${this.slot}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  clearMarks() { this.root.querySelectorAll('.ok,.bad,.selling').forEach((n) => { n.classList.remove('ok'); n.classList.remove('bad'); n.classList.remove('selling'); }); }

  /** Describe a hovered rune in the hint bar (not stored, so it never overrides a real message on the next render). */
  showDetail(id: string) {
    const r = RUNE_BY_ID[id];
    const bar = this.root.querySelector('.hintbar'), t = bar?.querySelector('.ht');
    if (!bar || !t) return;
    const works = r.forms ? ` Works on: ${r.forms.map((f) => FORMS[f].name).join(', ')}.` : '';
    t.textContent = `${r.icon} ${r.name} · ${KIND_LABEL[r.kind]} · cap ${r.cost}: ${r.desc}${works}`;
    bar.classList.remove('bad');
  }

  /* ------------------------------ add menu ------------------------------ */

  openMenu(parentId: number, anchor: HTMLElement, kinds?: string[]) {
    this.closeMenu();
    const sp = this.sp;
    const parent = parentId < 0 ? null : findNode(sp.def, parentId)?.node ?? null;
    const items = RUNES.filter((r) => (this.run.inv[r.id] ?? 0) > 0 && (!kinds || kinds.includes(r.kind))).map((r) => ({ r, c: checkAttach(sp.def, parent, r.id) }));
    items.sort((a, b) => Number(b.c.ok) - Number(a.c.ok));
    const label = !parent ? 'Equip a Form' : RUNE_BY_ID[parent.rune].kind === 'trigger' ? 'Launch which Form?' : kinds?.includes('core') && kinds.length === 1 ? 'Socket a Core (element)' : `Add to ${RUNE_BY_ID[parent.rune].name}`;
    const m = el(`<div class="addmenu"><div class="amh">${label}</div>${items.length ? items.map(({ r, c }) => `
      <div class="ami ${c.ok ? '' : 'dis'}" data-pick="${r.id}" data-parent="${parentId}" style="--c:${runeColor(r)}" title="${c.reason.replace(/"/g, '&quot;')}">
        <span>${r.icon}</span><b>${r.name}</b><em>${KIND_LABEL[r.kind]} · ${r.cost}</em>${c.ok ? '' : `<small>${c.reason}</small>`}</div>`).join('') : '<p class="muted">Nothing suitable in your rune pool. Level up to find more.</p>'}</div>`);
    const rect = anchor.getBoundingClientRect();
    m.style.left = `${Math.min(window.innerWidth - 320, Math.max(8, rect.left))}px`;
    m.style.top = `${Math.min(window.innerHeight - 340, Math.max(8, rect.bottom + 6))}px`;
    this.root.appendChild(m);
    this.menu = m;
  }
  closeMenu() { this.menu?.remove(); this.menu = null; }

  /* ------------------------------ rendering ------------------------------ */

  /** Render one form card and, recursively, the forms launched by its triggers. */
  formCard(sp: ActiveSpell, node: SpellNode, inherit: Element, isRoot: boolean): string {
    const rd = RUNE_BY_ID[node.rune];
    const coreNode = node.children.find((c) => RUNE_BY_ID[c.rune].kind === 'core');
    void inherit;
    const element: Element = coreNode ? RUNE_BY_ID[coreNode.rune].element! : 'arcane';
    const E = ELEMENTS[element];
    const sel = this.sel ? RUNE_BY_ID[this.sel] : null;
    const cls = sel ? (this.placeCheck(sp.def, node, sel.id).ok ? 'ok' : '') : '';
    const augs = node.children.filter((c) => ['behavior', 'modifier'].includes(RUNE_BY_ID[c.rune].kind));
    const trigs = node.children.filter((c) => RUNE_BY_ID[c.rune].kind === 'trigger');
    const core = coreNode
      ? `<div class="sock core filled" data-node="${coreNode.id}" draggable="true" style="--c:${runeColor(RUNE_BY_ID[coreNode.rune])}" title="${RUNE_BY_ID[coreNode.rune].name} (Core)"><span>${RUNE_BY_ID[coreNode.rune].icon}</span><b>${RUNE_BY_ID[coreNode.rune].name}</b><button class="nrm" data-rm="${coreNode.id}" title="Remove Core">${icon('x', 11)}</button></div>`
      : `<button class="sock core empty" data-add="${node.id}" data-kinds="core" title="Socket a Core rune to give this Form an element (none = Arcane${isRoot ? '' : ', not inherited'})"><span>${icon('plus', 12)}</span><b>${kg('core')}</b></button>`;
    const chips = augs.map((c) => {
      const r = RUNE_BY_ID[c.rune];
      return `<span class="chip k-${r.kind}" data-node="${c.id}" draggable="true" style="--c:${runeColor(r)}" title="${r.name}">${r.icon} ${r.name}<button class="nrm" data-rm="${c.id}" title="Remove">${icon('x', 11)}</button></span>`;
    }).join('');
    const trigHtml = trigs.map((t) => {
      const tr = RUNE_BY_ID[t.rune];
      const kids = t.children.map((k) => this.formCard(sp, k, 'arcane', false)).join('');
      const selOk = sel && checkAttach(sp.def, t, sel.id).ok ? 'ok' : '';
      const base = tr.chance ?? 1, odds = triggerOdds(this.run, base);
      const tip = `Fires ${Math.round(odds.final * 100)}% of the time each time it happens (the rune says ${Math.round(base * 100)}%). ${triggerRuleParts(this.run).map((x) => `${x.label}: ${x.text}.`).join(' ')}`;
      return `<div class="trig ${selOk}" data-node="${t.id}" data-target="${t.id}" draggable="true">
        <div class="thead"><span class="ti">${TRIG_ICON[tr.trigger!]}</span><b>${tr.name.toUpperCase()}</b><em class="${Math.abs(odds.final - base) > 0.004 ? 'boosted' : ''}" title="${tip}">${base < 1 ? `${Math.round(odds.final * 100)}% ` : ''}${icon('launch', 12)}</em><button class="nrm" data-rm="${t.id}" title="Remove trigger and its effects">${icon('x', 11)}</button></div>
        <div class="tkids">${kids}<button class="addchip" data-add="${t.id}" data-kinds="form" title="Launch a Form">${icon('plus', 12)}${kg('form')}</button></div></div>`;
    }).join('');
    return `<div class="fcard ${cls} ${isRoot ? 'root' : ''}" data-target="${node.id}" ${isRoot ? '' : `data-node="${node.id}" draggable="true"`} style="--c:${E.css}">
      <div class="fhead" title="${isRoot ? 'Main Form' : 'Effect Form'}"><span class="fi">${rd.icon}</span><div class="ft"><b>${E.name.toUpperCase()} ${rd.name.toUpperCase()}</b></div><span class="fcost" title="Capacity cost">${icon('cost', 10)}${costOf(rd.id)}</span>
        <button class="nrm" data-rm="${node.id}" title="${isRoot ? 'Unequip this whole spell' : 'Remove'}">${icon('x', 11)}</button></div>
      <div class="frow">${core}<div class="augs">${chips}<button class="addchip" data-add="${node.id}" data-kinds="behavior,modifier,trigger" title="Add an augment or trigger">${icon('plus', 12)}${kg('behavior')}${kg('trigger')}</button></div></div>
      ${trigHtml ? `<div class="trigs">${trigHtml}</div>` : ''}
    </div>`;
  }

  render() {
    const run = this.run, sp = this.sp;
    const ed = this.root.querySelector('.editor') as HTMLElement;
    const gw = ed.querySelector('.graph') as HTMLElement | null;
    const sl = gw ? gw.scrollLeft : 0, st = gw ? gw.scrollTop : 0;
    const meta = (s: ActiveSpell) => {
      const root = s.c.valid ? s.c.root : null;
      return { ico: root ? `${ELEMENTS[root.element].icon}${FORMS[root.form].icon}` : '+', css: root ? ELEMENTS[root.element].css : '#6a5ab0' };
    };
    const tabs = run.spells.map((s, i) => {
      const cost = spellCost(s.def);
      const { ico, css } = meta(s);
      return `<button class="stab ${i === this.slot ? 'on' : ''}" data-slot="${i}" style="--c:${css}" title="${i + 1}. ${s.def.root ? s.c.name : 'Empty'} (${cost}/${s.def.capacity})">
        <span class="sti">${ico}</span><b>${i + 1}</b><i class="mcap ${cost >= s.def.capacity ? 'full' : ''}"><u style="width:${Math.min(100, s.def.capacity ? cost / s.def.capacity * 100 : 0)}%"></u></i></button>`;
    }).join('') + (run.slots < 5 ? `<button class="stab locked" disabled title="Buy slot ${run.slots + 1} in the shop"><span class="sti">${icon('lock', 14)}</span></button>` : '');

    const pm = run.player;
    const lane = (s: ActiveSpell, i: number) => {
      const { ico, css } = meta(s);
      if (!s.def.root) {
        // an empty slot is a small drop tile, not a full-size panel
        return `<div class="lane empty ${i === this.slot ? 'on' : ''}" data-lane="${i}" style="--c:${css}"><div class="emptyroot ${this.sel && RUNE_BY_ID[this.sel].kind === 'form' ? 'ok' : ''}" title="Empty slot ${i + 1}: pick a Form, then click here"><span class="eri">${icon('spell', 16)}</span><b>${i + 1}</b><span class="ep">${icon('plus', 12)}${kg('form')}</span></div></div>`;
      }
      const cost = spellCost(s.def);
      const muts = s.mutations.map((m) => MUT_OPTION_BY_ID[m]).filter(Boolean).map((m) => `<span class="mutchip" title="${m.name}: ${m.desc.replace(/"/g, '&quot;')}">${m.icon} ${m.name}</span>`).join('');
      const warn = s.c.warnings.length ? `<span class="lw" title="${s.c.warnings.join(' ').replace(/"/g, '&quot;')}">${icon('alert', 12)}</span>` : '';
      return `<div class="lane ${i === this.slot ? 'on' : ''}" data-lane="${i}" style="--c:${css}">
        <div class="lanehd"><span>${ico}</span><b>${i + 1}. ${s.c.name}</b>${muts}${warn}<i class="mcap ${cost >= s.def.capacity ? 'full' : ''}"><u style="width:${Math.min(100, s.def.capacity ? cost / s.def.capacity * 100 : 0)}%"></u></i><small>${cost}/${s.def.capacity}</small></div>${this.formCard(s, s.def.root, 'arcane', true)}</div>`;
    };
    const graph = `<div class="lanes ${this.view}">${run.spells.map((s, i) => [s, i] as const).filter(([, i]) => this.view === 'all' || i === this.slot).map(([s, i]) => lane(s, i)).join('')}</div>`;

    // Forge: 4 cores -> evolved core, and forging / merging triggers. Descriptions live in tooltips.
    const owned = (id: string) => { let n = run.inv[id] ?? 0; for (const s2 of run.spells) if (s2.def.root) walk(s2.def.root, (nd) => { if (nd.rune === id) n++; }); return n; };
    const mergeable = RUNES.filter((r) => r.kind === 'trigger' && r.trigger && MERGEABLE.includes(r.trigger) && (run.inv[r.id] ?? 0) > 0);
    const [selA, selB] = this.mergeSel;
    const mres = selA && selB ? mergeResult(selA, selB) : null;
    const tres = selA && selB ? tierUpResult(selA, selB) : null;
    const pc = (r: { chance?: number }) => `${Math.round((r.chance ?? 1) * 100)}%`;
    const slotHtml = (id?: string) => id ? `<div class="tfslot on">${RUNE_BY_ID[id].icon} ${RUNE_BY_ID[id].name} ${pc(RUNE_BY_ID[id])}</div>` : '<div class="tfslot">empty</div>';
    const step = !selA ? '<b>Step 1:</b> click a trigger below.' : !selB ? `<b>Step 2:</b> click a second one. The same trigger twice can be <b>levelled up</b>; any two of the same type (${RUNE_BY_ID[selA].name.replace(/ (II|III|IV)$/, '')}) can be <b>merged</b>.` : '';
    const act = selA && selB ? [
      typeof tres === 'string' || !tres ? `<span class="bad">Level up: ${tres ?? 'not possible'}</span>` : `Level up: two ${RUNE_BY_ID[selA].name} become <b>${tres.icon} ${tres.name} (${pc(tres)})</b> <button class="addchip" data-tierup="1">Level up</button>`,
      typeof mres === 'string' ? `<span class="bad">Merge: ${mres}</span>` : mres ? `Merge: adds the chances into <b>${mres.icon} ${mres.name}</b> (capacity ${costOf(mres.id)}) <button class="addchip" data-merge="1">Merge</button>` : '',
    ].filter(Boolean).map((x) => `<div>${x}</div>`).join('') : '';
    const mergeHtml = `<div class="tforge"><div class="fsec">${icon('forge', 13)}${kg('trigger')} Trigger Forge</div>
      <p class="tfhelp">Combine two Triggers from your <b>rune pool</b> (take them out of a spell first). <b>Level up</b>: two identical triggers become the next level (I → IV). <b>Merge</b>: two of one type add their chances together (up to ${Math.round(MAX_MERGE_CHANCE * 100)}%).</p>
      ${mergeable.length ? `<div class="mchips">${mergeable.map((r) => { const n = this.mergeSel.filter((x) => x === r.id).length; return `<button class="mchip ${n ? 'sel' : ''}" data-mpick="${r.id}" title="${r.desc.replace(/"/g, '&quot;')}">${r.icon} ${r.name} ${pc(r)} ×${run.inv[r.id]}</button>`; }).join('')}</div>
      <div class="tfslots">${slotHtml(selA)}<span>+</span>${slotHtml(selB)}</div>
      <div class="tfact">${step}${act}</div>`
        : '<p class="muted">You have no On Hit / On Kill / On Crit / On Expiry triggers in your rune pool. Buy some, or drag one out of a spell.</p>'}</div>`;
    const keys = ['Space', 'Q', 'R', 'F', 'C', 'V'];
    const ultList = run.ultimates();
    const forgeInfo = `<p class="tfhelp">${icon('forge', 12)} <b>Core Forge</b>: ${run.forgeCost()} Cores of one element (in your pool or placed in spells) make an evolved Core: +40% damage, a passive and an <b>Ultimate</b> (${ULT_COOLDOWN}s recharge, faster with kills). Evolved Cores on Forms launched by Triggers count too. Each spell has ONE Ultimate charge; with several evolved Cores in it you choose which to unleash.
      ${ultList.length ? `<br><b>Your Ultimates:</b> ${ultList.map((u, i) => `${ULTIMATES[u.el].icon} ${ULTIMATES[u.el].name} (spell ${u.i + 1}) = <kbd>${keys[i]}</kbd>`).join(', ')}. Space fires the first one that is ready; the other keys fire that one.` : ''}</p>
      ${(Object.keys(BASE_CORE_OF) as Element[]).map((e2) => {
        const n = run.coreCopies(e2), have = owned(EVOLVED_OF[e2]), need = run.forgeCost();
        const evo = RUNE_BY_ID[EVOLVED_OF[e2]], U = ULTIMATES[e2];
        return `<div class="forge ${n >= need ? 'ready' : ''}" style="--c:${ELEMENTS[e2].css}">
          <span class="fgi">${ELEMENTS[e2].icon}</span><div class="fgbar"><i style="width:${Math.min(100, (n / need) * 100)}%"></i></div><em>${Math.min(n, need)}/${need}</em>
          <button class="addchip" data-forge="${e2}" title="Forge ${evo.name}" ${n >= need ? '' : 'disabled'}>${icon('forge', 12)} ${evo.icon}${have ? ` ×${have}` : ''}</button>
          <p class="fgdesc"><b>${evo.name}</b>: ${evo.desc.replace(/^EVOLVED \w+\. /, '').replace(/ Unlocks the ULTIMATE:.*$/, '')} <b>Ultimate, ${U.name}:</b> ${U.desc}</p></div>`;
      }).join('')}
      ${mergeHtml}`;
    const panes = (run.sandbox ? ['forge', 'stats'] : ['buy', 'sell', 'forge', 'stats']) as Editor['tab'][];
    const paneTitle: Record<string, string> = { buy: 'Shop', sell: 'Sell (drag runes and relics here)', forge: 'Forge', stats: 'Your stats and where every bonus comes from' };
    const paneHead = `<div class="shophd"><span class="hpnum" title="Health">❤️ ${Math.ceil(run.player.hp)}/${Math.round(run.player.maxHp)}</span>${run.sandbox ? '' : `<span class="coins" title="Coins">${icon('coins', 14)} ${Math.floor(run.coins)}</span>`}
      <div class="itabs">${panes.map((t) => `<button data-tab="${t}" title="${paneTitle[t]}" class="${this.tab === t ? 'on' : ''} ${t === 'forge' && run.forgeReady().length ? 'ready' : ''}">${icon(t, 15)}</button>`).join('')}</div>
      ${this.tab === 'buy' && !run.sandbox ? this.shop.rerollHtml() : ''}</div>`;
    const paneBody = this.tab === 'buy' ? this.shop.buyHtml() : this.tab === 'sell' ? this.shop.sellHtml() : this.tab === 'stats' ? statsHtml(run) : forgeInfo;
    const rm = relicBar(run, () => this.render(), true, true);

    const kinds: (RuneKind | 'all')[] = ['all', 'form', 'core', 'behavior', 'trigger', 'modifier'];
    const invRunes = RUNES.filter((r) => (run.inv[r.id] ?? 0) > 0 && (this.filter === 'all' || r.kind === this.filter));
    const total = Object.values(run.inv).reduce((a, b) => a + b, 0);
    const chips = invRunes.map((r) => `<div class="rchip inv ${this.sel === r.id ? 'sel' : ''}" draggable="true" data-rune="${r.id}" style="--c:${runeColor(r)}" title="${r.name}: ${r.desc}">
      <span class="ri">${r.icon}</span><span class="rn">${r.name}</span><span class="rc">${costOf(r.id)}</span><span class="rx">×${run.inv[r.id]}</span></div>`).join('');

    ed.innerHTML = `
      <header><h2 title="Spell Editor">${icon('book', 20)}</h2><div class="stabs">${tabs}</div><button class="mini ovbtn" data-view="1" title="${this.view === 'all' ? 'Showing every slot. Click to focus one.' : 'Showing one slot. Click to show all.'}">${icon(this.view === 'all' ? 'grid' : 'square', 14)}</button><button class="mini ovbtn" data-overview="1" title="Spell overview: every spell at a glance">${icon('layers', 14)}</button><button class="x" data-a="close" title="Close (Esc / E)">${icon('x', 11)}</button></header>
      ${rm.html}
      <main>
        <section class="graphwrap">
          <div class="graph">${graph}</div>
          <div class="hintbar ${this.hintBad ? 'bad' : ''}"><span class="ht">${this.hint || (this.sel ? `${RUNE_BY_ID[this.sel].icon} ${RUNE_BY_ID[this.sel].name}: click a glowing card${RUNE_BY_ID[this.sel].kind === 'form' ? ' (on an existing Form it swaps, keeping what still fits)' : ''}.` : 'Pick a rune, click a glowing card. Pick a Form and click a Form to swap it (compatible runes stay). Right-click removes.')}</span>
            <span class="legend">${(['form', 'core', 'behavior', 'trigger'] as const).map((k) => `<span style="--c:${KIND_COLOR[k]}" title="${KIND_LABEL[k]}${k === 'form' ? ': the spell itself' : k === 'core' ? ': sets its element' : k === 'behavior' ? ': tweaks how it flies (and modifiers)' : ': launches more Forms'}">${kg(k, 16)}</span>`).join('')}</span></div></section>
        <aside class="shoppane">${paneHead}<div class="panebody">${paneBody}</div></aside>
      </main>
      <footer class="inventory">
        <div class="invh"><b title="Rune pool">${icon('backpack', 16)}</b> <small>${total}</small>
          <div class="filters">${kinds.map((k) => `<button data-filter="${k}" class="${this.filter === k ? 'on' : ''}" title="${k === 'all' ? 'All runes' : KIND_LABEL[k]}" style="${k !== 'all' ? `--c:${KIND_COLOR[k]}` : ''}">${kg(k)}</button>`).join('')}
          ${this.sel ? `<button data-clear class="clr" title="Deselect">${icon('x', 11)}</button>` : ''}</div></div>
        <div class="chips">${chips || '<p class="muted">No runes.</p>'}</div>
      </footer>`;
    const g2 = ed.querySelector('.graph') as HTMLElement;
    g2.scrollLeft = sl; g2.scrollTop = st;
    rm.bind(ed.querySelector('.relbar') as HTMLElement);
  }
}
