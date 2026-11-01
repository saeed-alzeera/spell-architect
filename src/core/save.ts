// Persistent settings + progression (localStorage, with safe fallbacks).
import { RUNES, RUNE_BY_ID, STARTER_RUNES } from '../data/runes';

export interface Settings {
  master: number; sfx: number; music: number; muted: boolean; shake: boolean; numbers: boolean; quick: boolean;
}
export interface SaveData {
  v: 1;
  /** 2 = constrained starter set (see STARTER_RUNES). 3 = no shard currency: runes unlock by playing (see unlockNext). */
  unlockVer?: number;
  settings: Settings;
  /** Legacy currency, only read once to convert an old save (see load). */
  shards?: number;
  unlocked: string[];
  journal: {
    reactions: Record<string, number>;
    combos: Record<string, { name: string; count: number }>;
    runes: Record<string, number>;
  };
  stats: { runs: number; wins: number; bestTime: number; kills: number };
  starter: { core: string; form: string };
}

const KEY = 'spell-architect-save-v1';
/** Runes that cost shards even before the starter set was trimmed (only these are refunded on migration). */
const LEGACY_PAID = ['b_bounce', 'b_chain', 'b_pull', 'b_expand', 't_expiry', 't_crit', 'm_dup', 'm_acc', 'm_area'];

function fresh(): SaveData {
  return {
    v: 1,
    settings: { master: 0.7, sfx: 0.8, music: 0.5, muted: false, shake: true, numbers: true, quick: false },
    unlockVer: 3,
    unlocked: [...STARTER_RUNES],
    journal: { reactions: {}, combos: {}, runes: {} },
    stats: { runs: 0, wins: 0, bestTime: 0, kills: 0 },
    starter: { core: 'c_fire', form: 'f_projectile' },
  };
}

/** Base runes in the order they unlock: the old shard price decides how soon a rune comes (cheapest first). */
function unlockOrder() {
  return RUNES.filter((r) => !r.evolved && !r.merged && !r.tierOf).map((r, i) => ({ r, i })).sort((a, b) => a.r.unlock - b.r.unlock || a.i - b.i).map((x) => x.r);
}

let data: SaveData = load();

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SaveData>;
      const f = fresh();
      const d: SaveData = {
        ...f, ...p,
        settings: { ...f.settings, ...(p.settings ?? {}) },
        journal: { ...f.journal, ...(p.journal ?? {}) },
        stats: { ...f.stats, ...(p.stats ?? {}) },
        starter: { ...f.starter, ...(p.starter ?? {}) },
      } as SaveData;
      // make sure default unlocks always exist (new runes added in later versions)
      if (p.unlockVer !== 2) {
        // earlier builds started with almost everything unlocked: refund what was bought, then start from the small set
        d.shards = d.shards ?? 0;
        for (const id of d.unlocked) { const r = RUNE_BY_ID[id]; if (r && !STARTER_RUNES.includes(id) && LEGACY_PAID.includes(id)) d.shards += r.unlock; }
        d.unlocked = [...STARTER_RUNES];
        d.unlockVer = 2;
      }
      d.unlocked = d.unlocked.filter((id) => RUNES.some((r) => r.id === id));
      if (d.unlockVer !== 3) {
        // the shard currency is gone: turn any shards left over into runes, cheapest first
        let left = d.shards ?? 0;
        for (const r of unlockOrder()) {
          if (left < r.unlock) break;
          if (!d.unlocked.includes(r.id)) { left -= r.unlock; d.unlocked.push(r.id); }
        }
        d.unlockVer = 3;
      }
      delete d.shards; delete (d.stats as Record<string, unknown>).shardsEarned;
      d.unlocked = d.unlocked.filter((id) => RUNES.some((r) => r.id === id));
      for (const id of STARTER_RUNES) if (!d.unlocked.includes(id)) d.unlocked.push(id);
      const kind = (id: string) => RUNES.find((r) => r.id === id)?.kind;
      if (d.starter.core && kind(d.starter.core) !== 'core') d.starter.core = 'c_fire';
      if (kind(d.starter.form) !== 'form') d.starter.form = 'f_projectile';
      return d;
    }
  } catch { /* ignore */ }
  return fresh();
}

let timer: number | undefined;
export function save() {
  if (timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  }, 300);
}
export function saveNow() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export const store = {
  get d() { return data; },
  get settings() { return data.settings; },
  // TEMP (testing): every rune counts as unlocked; merged triggers stay out as they are never sold or rewarded
  isUnlocked(id: string): boolean { return !RUNE_BY_ID[id]?.merged; },
  /** Unlock the next `n` runes in order (a finished run earns them); returns the ids unlocked. */
  unlockNext(n: number): string[] {
    const out: string[] = [];
    for (const r of unlockOrder()) {
      if (out.length >= n) break;
      if (!data.unlocked.includes(r.id)) { data.unlocked.push(r.id); out.push(r.id); }
    }
    if (out.length) saveNow();
    return out;
  },
  discoverReaction(id: string): boolean {
    const first = !data.journal.reactions[id];
    data.journal.reactions[id] = (data.journal.reactions[id] ?? 0) + 1;
    if (first) saveNow(); else save();
    return first;
  },
  discoverCombo(sig: string, name: string): boolean {
    const j = data.journal.combos;
    const first = !j[sig];
    if (first) j[sig] = { name, count: 0 };
    j[sig].count++;
    if (first) saveNow(); else save();
    return first;
  },
  seeRune(id: string) { data.journal.runes[id] = (data.journal.runes[id] ?? 0) + 1; save(); },
  reset() { data = fresh(); saveNow(); },
};
