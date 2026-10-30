// Spell editor. Each slot is a nested stack of cards: a FORM with a CORE socket (its element),
// AUGMENT chips (behaviors / modifiers) and TRIGGER blocks that each launch further Forms.
// A plain-language story of the whole spell is written beside it. Pauses the game while open.
import {
  RUNES, RUNE_BY_ID, ELEMENTS, FORMS, RARITY, KIND_COLOR, KIND_LABEL, runeColor, EVOLVE_COST, EVOLVED_OF, BASE_CORE_OF, ULTIMATES, MERGEABLE, mergeResult, tierUpResult, triggerLevel, type RuneKind, type Element,
} from '../data/runes';
import { REACTIONS } from '../data/reactions';
import { store } from '../core/save';
import { reactionCardHtml } from './reactions';
import { MUT_TRACKS, MUT_OPTION_BY_ID } from '../data/mutations';
import {
  checkAttach, checkTransfer, findNode, newNode, spellCost, subtreeRunes, estimate, walk, type SpellNode,
} from '../core/spell';
import { audio } from '../core/audio';
import { earlyPower, type Run } from '../game/run';
import type { ActiveSpell } from '../game/types';
import { el, type UI } from './ui';
import { relicBar } from './relics';
import { showSpellOverview } from './overview';

export function openEditor(ui: UI, run: Run) { new Editor(ui, run).open(); }

const TRIG_ICON: Record<string, string> = { hit: '💥', kill: '💀', expiry: '⏳', crit: '✴️' };
/** One glyph per rune kind, used wherever a text label would cost space (tooltips carry the words). */
const KIND_GLYPH: Record<RuneKind | 'all', string> = { all: '▦', form: '☄️', core: '💠', behavior: '🌀', trigger: '⚡', modifier: '🔧' };

class Editor {
  root!: HTMLElement;
  slot = 0;
  sel: string | null = null;
  filter: RuneKind | 'all' = 'all';
  drag: { rune?: string; node?: number; slot?: number } | null = null;
  menu: HTMLElement | null = null;
  hint = '';
  hintBad = false;
  tab: 'spell' | 'react' | 'forge' | 'stats' = 'spell';
  /** 'all' lays every slot out side by side; 'one' shows only the active slot. */
  view: 'all' | 'one' = 'all';
  mergeSel: string[] = [];

  constructor(private ui: UI, private run: Run) {
    const first = run.spells.findIndex((s) => s.def.root);
    this.slot = first >= 0 ? first : 0;
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
      if (tb) { this.tab = tb.dataset.tab as typeof this.tab; audio.play('ui'); this.render(); return; }
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
        else this.say(`You need ${EVOLVE_COST} ${ELEMENTS[el0 as Element].name} cores to forge.`, true);
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
        if (n) { const c = checkAttach(this.sp.def, n.node, this.sel); this.say(c.ok ? `Click to place ${RUNE_BY_ID[this.sel].name} on ${RUNE_BY_ID[n.node.rune].name}.` : c.reason, !c.ok); }
      }
      this.slot = keep;
    });
    // drag & drop
    r.addEventListener('dragstart', (e) => {
      const t = (e.target as HTMLElement).closest('[data-rune],[data-node]') as HTMLElement | null;
      if (!t) return;
      const ls = this.laneOf(t);
      if (ls !== null) this.slot = ls;
      this.drag = t.dataset.rune ? { rune: t.dataset.rune } : { node: +t.dataset.node!, slot: this.slot };
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
      if (tg) {
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

  checkDrop(targetId: number) {
    const sp = this.sp;
    const t = findNode(sp.def, targetId);
    if (!t || !this.drag) return { ok: false, reason: '' };
    if (this.drag.rune) return checkAttach(sp.def, t.node, this.drag.rune);
    const src = this.run.spells[this.drag.slot ?? this.slot];
    const f = findNode(src.def, this.drag.node!);
    if (!f) return { ok: false, reason: '' };
    if (!f.parent) return { ok: false, reason: 'The slot\'s main Form can\'t be moved. Drag it to the rune pool to unequip the whole spell.' };
    if (src !== sp) return checkTransfer(sp.def, t.node, f.node);
    return checkAttach(sp.def, t.node, f.node.rune, f.node);
  }

  markTargets() {
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
  clearMarks() { this.root.querySelectorAll('.ok,.bad').forEach((n) => { n.classList.remove('ok'); n.classList.remove('bad'); }); }

  showDetail(id: string) {
    const r = RUNE_BY_ID[id];
    const d = this.root.querySelector('.rdetail');
    if (!d) return;
    const works = r.forms ? `<div class="works">Works on: ${r.forms.map((f) => FORMS[f].name).join(', ')}</div>` : '';
    const where = r.kind === 'form' ? 'Goes in a spell slot, or under a Trigger.' : r.kind === 'core' ? 'Socket it into a Form to set its element.' : r.kind === 'trigger' ? 'Add to a Form, then slot a Form under it.' : 'Add to a Form.';
    d.innerHTML = `<div class="rdh" style="--c:${runeColor(r)}"><span>${r.icon}</span><div><b>${r.name}</b><small>${KIND_LABEL[r.kind]} · <i style="color:${RARITY[r.rarity].color}">${RARITY[r.rarity].name}</i> · cost ${r.cost}</small></div></div>
      <p>${r.desc}</p>${works}<div class="works">${where}</div>`;
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
    const cls = sel ? (checkAttach(sp.def, node, sel.id).ok ? 'ok' : '') : '';
    const augs = node.children.filter((c) => ['behavior', 'modifier'].includes(RUNE_BY_ID[c.rune].kind));
    const trigs = node.children.filter((c) => RUNE_BY_ID[c.rune].kind === 'trigger');
    const core = coreNode
      ? `<div class="sock core filled" data-node="${coreNode.id}" draggable="true" style="--c:${runeColor(RUNE_BY_ID[coreNode.rune])}" title="${RUNE_BY_ID[coreNode.rune].name} (Core)"><span>${RUNE_BY_ID[coreNode.rune].icon}</span><b>${RUNE_BY_ID[coreNode.rune].name}</b><button class="nrm" data-rm="${coreNode.id}" title="Remove Core">✕</button></div>`
      : `<button class="sock core empty" data-add="${node.id}" data-kinds="core" title="Socket a Core rune to give this Form an element (none = Arcane${isRoot ? '' : ', not inherited'})"><span>＋</span><b>${KIND_GLYPH.core}</b></button>`;
    const chips = augs.map((c) => {
      const r = RUNE_BY_ID[c.rune];
      return `<span class="chip k-${r.kind}" data-node="${c.id}" draggable="true" style="--c:${runeColor(r)}" title="${r.name}">${r.icon} ${r.name}<button class="nrm" data-rm="${c.id}" title="Remove">✕</button></span>`;
    }).join('');
    const trigHtml = trigs.map((t) => {
      const tr = RUNE_BY_ID[t.rune];
      const kids = t.children.map((k) => this.formCard(sp, k, 'arcane', false)).join('');
      const selOk = sel && checkAttach(sp.def, t, sel.id).ok ? 'ok' : '';
      return `<div class="trig ${selOk}" data-node="${t.id}" data-target="${t.id}" draggable="true">
        <div class="thead"><span class="ti">${TRIG_ICON[tr.trigger!]}</span><b>${tr.name.toUpperCase()}</b><em title="Launches the Forms below when it fires">${tr.chance !== undefined && tr.chance < 1 ? `${Math.round(tr.chance * 100)}% ` : ''}➜</em><button class="nrm" data-rm="${t.id}" title="Remove trigger and its effects">✕</button></div>
        <div class="tkids">${kids}<button class="addchip" data-add="${t.id}" data-kinds="form" title="Launch a Form">＋${KIND_GLYPH.form}</button></div></div>`;
    }).join('');
    return `<div class="fcard ${cls} ${isRoot ? 'root' : ''}" data-target="${node.id}" ${isRoot ? '' : `data-node="${node.id}" draggable="true"`} style="--c:${E.css}">
      <div class="fhead" title="${isRoot ? 'Main Form' : 'Effect Form'}"><span class="fi">${rd.icon}</span><div class="ft"><b>${E.name.toUpperCase()} ${rd.name.toUpperCase()}</b></div><span class="fcost" title="Capacity cost">◆${rd.cost}</span>
        <button class="nrm" data-rm="${node.id}" title="${isRoot ? 'Unequip this whole spell' : 'Remove'}">✕</button></div>
      <div class="frow">${core}<div class="augs">${chips}<button class="addchip" data-add="${node.id}" data-kinds="behavior,modifier,trigger" title="Add an augment or trigger">＋${KIND_GLYPH.behavior}${KIND_GLYPH.trigger}</button></div></div>
      ${trigHtml ? `<div class="trigs">${trigHtml}</div>` : ''}
    </div>`;
  }

  render() {
    const run = this.run, sp = this.sp;
    const ed = this.root.querySelector('.editor') as HTMLElement;
    const gw = ed.querySelector('.graph') as HTMLElement | null;
    const sl = gw ? gw.scrollLeft : 0, st = gw ? gw.scrollTop : 0;
    const c = sp.c;

    const meta = (s: ActiveSpell) => {
      const root = s.c.valid ? s.c.root : null;
      return { ico: root ? `${ELEMENTS[root.element].icon}${FORMS[root.form].icon}` : '+', css: root ? ELEMENTS[root.element].css : '#6a5ab0' };
    };
    const tabs = run.spells.map((s, i) => {
      const cost = spellCost(s.def);
      const { ico, css } = meta(s);
      return `<button class="stab ${i === this.slot ? 'on' : ''}" data-slot="${i}" style="--c:${css}" title="${i + 1}. ${s.def.root ? s.c.name : 'Empty'} (${cost}/${s.def.capacity})">
        <span class="sti">${ico}</span><b>${i + 1}</b><i class="mcap ${cost >= s.def.capacity ? 'full' : ''}"><u style="width:${Math.min(100, s.def.capacity ? cost / s.def.capacity * 100 : 0)}%"></u></i></button>`;
    }).join('') + (run.slots < 5 ? `<button class="stab locked" disabled title="Buy slot ${run.slots + 1} in the shop"><span class="sti">🔒</span></button>` : '');

    const lane = (s: ActiveSpell, i: number) => {
      const { ico, css } = meta(s);
      if (!s.def.root) {
        // an empty slot is a small drop tile, not a full-size panel
        return `<div class="lane empty ${i === this.slot ? 'on' : ''}" data-lane="${i}" style="--c:${css}"><div class="emptyroot ${this.sel && RUNE_BY_ID[this.sel].kind === 'form' ? 'ok' : ''}" title="Empty slot ${i + 1}: pick a Form, then click here"><span class="eri">✦</span><b>${i + 1}</b><span class="ep">＋${KIND_GLYPH.form}</span></div></div>`;
      }
      const cost = spellCost(s.def);
      return `<div class="lane ${i === this.slot ? 'on' : ''}" data-lane="${i}" style="--c:${css}">
        <div class="lanehd"><span>${ico}</span><b>${i + 1}. ${s.c.name}</b><i class="mcap ${cost >= s.def.capacity ? 'full' : ''}"><u style="width:${Math.min(100, s.def.capacity ? cost / s.def.capacity * 100 : 0)}%"></u></i><small>${cost}/${s.def.capacity}</small></div>${this.formCard(s, s.def.root, 'arcane', true)}</div>`;
    };
    const graph = `<div class="lanes ${this.view}">${run.spells.map((s, i) => [s, i] as const).filter(([, i]) => this.view === 'all' || i === this.slot).map(([s, i]) => lane(s, i)).join('')}</div>`;

    const est = c.valid && c.root ? estimate(c.root, sp.mut) : null;
    const pm = run.player;
    const dmg = est ? est.dmgCast * pm.dmgMul : 0, cd = est ? est.cd * pm.cdMul : 0;
    const cost = spellCost(sp.def);
    const pct = Math.min(100, (cost / sp.def.capacity) * 100);
    const elems = c.valid ? c.elements.map((e) => `<span class="elchip" style="--c:${ELEMENTS[e].css}">${ELEMENTS[e].icon} ${ELEMENTS[e].name}</span>`).join('') : '';
    const muts = sp.mutations.map((m) => MUT_OPTION_BY_ID[m]).filter(Boolean).map((m) => `<span class="mutchip">${m.icon} ${m.name}</span>`).join('');
    const prog = MUT_TRACKS.filter((t) => c.valid && (!t.element || c.elements.includes(t.element)) && !sp.tiers[t.id]).slice(0, 3)
      .map((t) => `<div class="prog"><span>${t.title}</span><div><i style="width:${Math.min(100, sp.st[t.stat] / t.threshold * 100)}%"></i></div><em>${Math.floor(sp.st[t.stat])}/${t.threshold}</em></div>`).join('');
    const rootC = c.valid ? c.root : null;
    const loadEls = new Set<Element>();
    for (const s2 of run.spells) if (s2.c.valid) for (const e of s2.c.elements) if (e !== 'arcane') loadEls.add(e);
    const inSpell = new Set<Element>(c.valid ? c.elements.filter((e) => e !== 'arcane') : []);
    const pots = REACTIONS.filter((r) => r.needs.every((e) => loadEls.has(e)) && r.needs.some((e) => inSpell.has(e)));
    const potHtml = pots.length ? `<div class="elrow" title="Reaction potential">⚗️ ${pots.map((r) => {
      const self = r.needs.every((e) => inSpell.has(e));
      return `<span class="elchip" style="--c:${r.color}" title="${r.name} (${self ? 'this spell alone' : 'needs another slot'}): ${r.recipe}. ${r.how}">${r.icon} ${r.name} ${self ? '✓' : '⛓'}</span>`;
    }).join('')}</div>` : (inSpell.size ? '<div class="elrow muted" title="No reactions yet. Pair this element with another one (in this spell or another slot) to unlock some.">⚗️ ∅</div>' : '');
    const ult = rootC?.evolved ? ULTIMATES[rootC.element] : null;
    const spellInfo = `
      <div class="spname">${sp.def.root ? c.name : 'Empty slot'}</div>
      <div class="elrow">${elems}${rootC?.evolved ? '<span class="elchip" style="--c:#ffd25a">EVOLVED</span>' : ''}</div>
      ${c.valid ? `<p class="story">${c.story}</p>` : `<p class="muted">＋${KIND_GLYPH.form}</p>`}
      ${ult ? `<div class="ultbox"><b>${ult.icon} ULTIMATE (SPACE): ${ult.name}</b><p>${ult.desc}</p></div>` : ''}
      <div class="capbar ${pct >= 100 ? 'full' : ''}" title="Capacity"><div style="width:${pct}%"></div><span>◆ ${cost}/${sp.def.capacity}</span></div>
      ${est ? `<div class="tiles">
        <div title="Damage per cast"><b>${dmg.toFixed(0)}</b><span>💥</span></div>
        <div title="Cooldown"><b>${cd.toFixed(2)}s</b><span>⏱</span></div>
        <div title="Estimated DPS"><b>${(est.dps * pm.dmgMul / pm.cdMul).toFixed(0)}</b><span>⚔️</span></div>
        <div title="Runes in this spell"><b>${c.runeCount}</b><span>🧩</span></div></div>` : ''}
      ${potHtml}
      ${c.warnings.length ? `<div class="warns">${c.warnings.map((w) => `<div>⚠ ${w}</div>`).join('')}</div>` : ''}
      ${muts ? `<div class="elrow" title="Mutations">🧬 ${muts}</div>` : ''}
      ${prog ? `<div title="Mutation progress">${prog}</div>` : ''}
      <div class="rdetail"><p class="muted">🔍</p></div>`;

    // loadout-wide elements for the Reactions tab
    const present = new Set<Element>();
    for (const s2 of run.spells) if (s2.c.valid) for (const e of s2.c.elements) if (e !== 'arcane') present.add(e);
    const seenR = store.d.journal.reactions;
    const reactList = [...REACTIONS].sort((a, b) => Number(b.needs.every((e) => present.has(e))) - Number(a.needs.every((e) => present.has(e))));
    const reactInfo = `
      <div class="spname">REACTIONS</div>
      <p class="muted">Elements in <b>different slots</b> react. Yours: ${present.size ? [...present].map((e) => `<span class="elchip" style="--c:${ELEMENTS[e].css}">${ELEMENTS[e].icon} ${ELEMENTS[e].name}</span>`).join(' ') : 'none yet (Arcane has no reactions)'}</p>
      <div class="rlist">${reactList.map((r) => reactionCardHtml(r, present, seenR[r.id] ?? 0)).join('')}</div>`;

    // Forge tab: 4 cores -> evolved core
    const owned = (id: string) => { let n = run.inv[id] ?? 0; for (const s2 of run.spells) if (s2.def.root) walk(s2.def.root, (nd) => { if (nd.rune === id) n++; }); return n; };
    const mergeable = RUNES.filter((r) => r.kind === 'trigger' && r.trigger && MERGEABLE.includes(r.trigger) && (run.inv[r.id] ?? 0) > 0);
    const mres = this.mergeSel.length === 2 ? mergeResult(this.mergeSel[0], this.mergeSel[1]) : null;
    const tres = this.mergeSel.length === 2 ? tierUpResult(this.mergeSel[0], this.mergeSel[1]) : null;
    const mergeHtml = `<div class="spname" style="margin-top:14px">FORGE TRIGGERS</div>
      <div class="mergebox">Two identical triggers make the next level (up to IV).
        ${tres === null ? '' : typeof tres === 'string' ? '' : `<br>Level up result: <b style="color:#ffd25a">${tres.icon} ${tres.name}</b> (${Math.round((tres.chance ?? 1) * 100)}%)`}</div>
      <div class="spname" style="margin-top:10px">MERGE TRIGGERS</div>
      <div class="mergebox">Two triggers of one type become one with the summed chance (max 80%).
        ${mres === null ? '<br><span class="muted">Pick two.</span>' : typeof mres === 'string' ? `<br><span style="color:#ff9a9a">${mres}</span>` : `<br>Result: <b style="color:#ffd25a">${mres.icon} ${mres.name}</b> (cost ${mres.cost})`}</div>
      ${mergeable.length ? `<div class="mchips">${mergeable.map((r) => { const n = this.mergeSel.filter((x) => x === r.id).length; return `<button class="mchip ${n ? 'sel' : ''}" data-mpick="${r.id}">${r.icon} ${r.name}${triggerLevel(r.id) ? ` (L${triggerLevel(r.id)})` : ''} ${Math.round((r.chance ?? 1) * 100)}% ×${run.inv[r.id]}${n ? ` (picked ${n})` : ''}</button>`; }).join('')}</div>
      <button class="addchip" data-tierup="1" ${tres && typeof tres !== 'string' ? '' : 'disabled'}>FORGE UP A LEVEL</button> <button class="addchip" data-merge="1" ${mres && typeof mres !== 'string' ? '' : 'disabled'}>MERGE INTO ONE (add chances)</button>` : '<p class="muted">No triggers in your pool.</p>'}`;
    const forgeInfo = `
      <div class="spname">FORGE</div>
      <p class="muted">${EVOLVE_COST} of the same Core make an evolved Core: +40% damage, a passive and an Ultimate.</p>
      ${(Object.keys(BASE_CORE_OF) as Element[]).map((e2) => {
        const n = run.coreCopies(e2), have = owned(EVOLVED_OF[e2]);
        const evo = RUNE_BY_ID[EVOLVED_OF[e2]], U = ULTIMATES[e2];
        return `<div class="forge ${n >= EVOLVE_COST ? 'ready' : ''}" style="--c:${ELEMENTS[e2].css}">
          <div class="fgh"><span>${ELEMENTS[e2].icon}</span><b>${ELEMENTS[e2].name} cores</b><em>${Math.min(n, EVOLVE_COST)}/${EVOLVE_COST}</em></div>
          <div class="fgbar"><i style="width:${Math.min(100, (n / EVOLVE_COST) * 100)}%"></i></div>
          <p><b>${evo.icon} ${evo.name}</b> ${have ? `(owned: ${have})` : ''}: ${evo.desc.replace(/^EVOLVED \w+\. /, '')}</p>
          <p class="ul"><b>${U.icon} ${U.name}:</b> ${U.desc}</p>
          <button class="addchip" data-forge="${e2}" ${n >= EVOLVE_COST ? '' : 'disabled'}>FORGE ${evo.name.toUpperCase()}</button></div>`;
      }).join('')}
      ${mergeHtml}`;
    const tabsHtml = `<div class="itabs">${(['spell', 'react', 'forge', 'stats'] as const).map((t) => `<button data-tab="${t}" title="${t === 'spell' ? 'Spell' : t === 'react' ? 'Reactions' : t === 'stats' ? 'Stats' : 'Forge'}" class="${this.tab === t ? 'on' : ''} ${t === 'forge' && run.forgeReady().length ? 'ready' : ''}">${t === 'spell' ? '🔮' : t === 'react' ? '⚗️' : t === 'stats' ? '📊' : '🔨'}</button>`).join('')}</div>`;
    const rm = relicBar(run, () => this.render(), true, true);
    const pl = run.player;
    const statsInfo = `<div class="spname">STATS</div><div class="statgrid">
      <span>Spell power</span><b>x${pl.dmgMul.toFixed(2)}${earlyPower(run.round) > 1.001 ? ` (+${Math.round((earlyPower(run.round) - 1) * 100)}% early)` : ''}</b><span>Cooldown</span><b>x${pl.cdMul.toFixed(2)}</b>
      <span>Crit chance</span><b>${Math.round(pl.crit * 100)}%</b><span>Crit damage</span><b>x${pl.critMul.toFixed(2)}</b>
      <span>Max health</span><b>${Math.round(pl.maxHp)}</b><span>Regen</span><b>${pl.regen.toFixed(2)}/s</b>
      <span>Move speed</span><b>${Math.round(pl.speed)}</b><span>Kills</span><b>${run.kills}</b>
      <span>Level</span><b>${pl.level}</b><span>Coins</span><b>${Math.floor(run.coins)}</b></div>`;
    const info = tabsHtml + (this.tab === 'spell' ? spellInfo : this.tab === 'react' ? reactInfo : this.tab === 'stats' ? statsInfo : forgeInfo);

    const kinds: (RuneKind | 'all')[] = ['all', 'form', 'core', 'behavior', 'trigger', 'modifier'];
    const invRunes = RUNES.filter((r) => (run.inv[r.id] ?? 0) > 0 && (this.filter === 'all' || r.kind === this.filter));
    const total = Object.values(run.inv).reduce((a, b) => a + b, 0);
    const chips = invRunes.map((r) => `<div class="rchip inv ${this.sel === r.id ? 'sel' : ''}" draggable="true" data-rune="${r.id}" style="--c:${runeColor(r)}" title="${r.name}: ${r.desc}">
      <span class="ri">${r.icon}</span><span class="rn">${r.name}</span><span class="rc">${r.cost}</span><span class="rx">×${run.inv[r.id]}</span></div>`).join('');

    ed.innerHTML = `
      <header><h2 title="Spell Editor">📖</h2><div class="stabs">${tabs}</div><button class="mini ovbtn" data-view="1" title="${this.view === 'all' ? 'Showing every slot. Click to focus one.' : 'Showing one slot. Click to show all.'}">${this.view === 'all' ? '▣' : '▢'}</button><button class="mini ovbtn" data-overview="1" title="Spell overview: every spell at a glance">🗂</button><button class="x" data-a="close" title="Close (Esc / E)">✕</button></header>
      ${rm.html}
      <main>
        <section class="graphwrap">
          <div class="graph">${graph}</div>
          <div class="hintbar ${this.hintBad ? 'bad' : ''}"><span class="ht">${this.hint || (this.sel ? `${RUNE_BY_ID[this.sel].icon} ${RUNE_BY_ID[this.sel].name}: click a glowing card.` : 'Pick a rune, click a glowing card. Right-click removes.')}</span>
            <span class="legend">${(['form', 'core', 'behavior', 'trigger'] as const).map((k) => `<span style="--c:${KIND_COLOR[k]}" title="${KIND_LABEL[k]}${k === 'form' ? ': the spell itself' : k === 'core' ? ': sets its element' : k === 'behavior' ? ': tweaks how it flies (and modifiers)' : ': launches more Forms'}">${KIND_GLYPH[k]}</span>`).join('')}</span></div></section>
        <aside class="info">${info}</aside>
      </main>
      <footer class="inventory">
        <div class="invh"><b title="Rune pool">🎒</b> <small>${total}</small>
          <div class="filters">${kinds.map((k) => `<button data-filter="${k}" class="${this.filter === k ? 'on' : ''}" title="${k === 'all' ? 'All runes' : KIND_LABEL[k]}" style="${k !== 'all' ? `--c:${KIND_COLOR[k]}` : ''}">${KIND_GLYPH[k]}</button>`).join('')}
          ${this.sel ? '<button data-clear class="clr" title="Deselect">✕</button>' : ''}</div></div>
        <div class="chips">${chips || '<p class="muted">No runes.</p>'}</div>
      </footer>`;
    const g2 = ed.querySelector('.graph') as HTMLElement;
    g2.scrollLeft = sl; g2.scrollTop = st;
    rm.bind(ed.querySelector('.relbar') as HTMLElement);
  }
}
