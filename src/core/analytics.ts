// Run analytics: every run is kept on this device (localStorage, no cap) for the Run History screen, and queued for upload to
// the signaling worker's /runs store (worker/runs.js) so all runs from all players can be analysed per game version.
import { GAME_BUILD, GAME_VERSION } from './version';
import { mpBase } from '../net/signaling';
import type { RoundTel, AcqRec } from '../game/telemetry';

export interface SpellRec {
  name: string; element: string; damage: number; cost: number; cap: number; forms: string[]; evolved: boolean;
  /** v3+: `uid` is the spell slot's stable id (it survives Core / Form swaps, so a re-socketed slot is still the same spell), `slot` its
   *  position, `sig` the full structure (see describeForm), `mut` its mutations. casts / crits / kills are cumulative in `RunRecord.spells`
   *  and for the round in `RoundRec.spells`; hits, dot, react, tail, over, rel and trig exist only in the round log. */
  uid?: number; slot?: number; sig?: string; mut?: string[]; casts?: number; crits?: number; kills?: number;
  hits?: number; dot?: number; react?: number; tail?: number; over?: number; rel?: number; trig?: Record<string, [number, number]>;
}
export interface RoundRec {
  round: number; boss: boolean; secs: number; kills: number; damage: number; taken: number;
  hpEnd: number; maxHp: number; coins: number; level: number; spells: SpellRec[]; relics: string[];
  /** v3+: the round did not end normally (run lost, final boss won, or abandoned mid-round). */
  partial?: boolean;
  /** v3+: enemy side, damage breakdown, relic attribution and 5 s timelines for the round (see telemetry.ts). */
  tel?: RoundTel;
}
export interface RunRecord {
  id: string; v: 1 | 2 | 3; startedAt: number; endedAt: number;
  result: 'won' | 'lost' | 'abandoned'; quick: boolean; sandbox: boolean; seed: number; startForm: string;
  reachedRound: number; time: number; level: number; kills: number; damage: number; taken: number;
  hurtBy: Record<string, number>; deathCause: string; shards: number; bosses: number; reactions: number;
  spells: SpellRec[]; relics: string[]; roundLog: RoundRec[]; discoveries: string[];
  /** v2+: game version / build the run was played on, players in the game (1 = solo), co-op role and anonymous install id. */
  gameVersion?: string; build?: string; players?: number; role?: 'solo' | 'host' | 'guest'; installId?: string;
  /** v3+: when relics, runes, forges, mutations and level boosts were gained, in game seconds and rounds. */
  acq?: AcqRec[];
}

const KEY = 'spell-architect-runs-v1';
const OUTBOX = 'spell-architect-outbox-v1';
const INSTALL = 'spell-architect-install-v1';

/** Random id for this browser, so runs of one player can be grouped. It identifies nobody. */
export function installId(): string {
  try {
    let id = localStorage.getItem(INSTALL);
    if (!id) { id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(INSTALL, id); }
    return id;
  } catch { return 'unknown'; }
}
export const versionStamp = () => ({ gameVersion: GAME_VERSION, build: GAME_BUILD, installId: installId() });

export function loadRuns(): RunRecord[] {
  try { return (JSON.parse(localStorage.getItem(KEY) || '[]') as RunRecord[]).sort((a, b) => b.endedAt - a.endedAt); } catch { return []; }
}
function writeRuns(list: RunRecord[]) {
  const l = [...list].sort((a, b) => b.endedAt - a.endedAt);
  // All runs are kept. If the browser's storage is full, drop the bulky per-round logs of the oldest runs first (the summary stays).
  for (let slim = 0; slim <= l.length; slim += 25) {
    try { localStorage.setItem(KEY, JSON.stringify(l.map((r, i) => (i >= l.length - slim ? { ...r, roundLog: [] } : r)))); return; } catch { /* quota */ }
  }
}

export function saveRunRecord(rec: RunRecord) {
  const list = loadRuns().filter((r) => r.id !== rec.id);
  list.push(rec);
  writeRuns(list);
  if (rec.sandbox) return; // sandbox runs are not real runs: no analytics
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX) || '[]') as RunRecord[];
    if (!q.some((r) => r.id === rec.id)) q.push(rec);
    localStorage.setItem(OUTBOX, JSON.stringify(q));
  } catch { /* storage unavailable: the run stays local only */ }
  void flushOutbox();
}

/** The run store refuses records over UPLOAD_LIMIT bytes (worker/runs.js MAX_BYTES). Long runs with lots of telemetry shed the bulkiest
 *  parts first: the 5 s timelines, then the per-spell trigger counts, then the per-round telemetry. The local copy is never trimmed. */
export const UPLOAD_LIMIT = 120 * 1024;
export function fitForUpload(rec: RunRecord): RunRecord {
  const size = (r: RunRecord) => JSON.stringify(r).length;
  if (size(rec) <= UPLOAD_LIMIT) return rec;
  const steps: ((q: RoundRec) => RoundRec)[] = [
    (q) => (q.tel ? { ...q, tel: { ...q.tel, tl: { dmg: [], kills: [], alive: [] } } } : q),
    (q) => ({ ...q, spells: q.spells.map((s) => ({ ...s, trig: undefined })) }),
    (q) => ({ ...q, tel: undefined }),
  ];
  let out = rec;
  for (const step of steps) {
    out = { ...out, roundLog: out.roundLog.map(step) };
    if (size(out) <= UPLOAD_LIMIT) break;
  }
  return out;
}

let flushing = false;
/** Upload queued runs to the run store. A run leaves the queue when the server has it (2xx), already had it, or refuses it for good (4xx except 429). */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let q = JSON.parse(localStorage.getItem(OUTBOX) || '[]') as RunRecord[];
    for (const rec of [...q]) {
      let res: Response;
      try { res = await fetch(mpBase() + '/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fitForUpload(rec)) }); } catch { break; }
      if (res.status === 429 || res.status >= 500) break;
      q = q.filter((r) => r.id !== rec.id);
      localStorage.setItem(OUTBOX, JSON.stringify(q));
    }
  } catch { /* offline or storage unavailable: try again next time */ } finally { flushing = false; }
}

/** All runs on this device as a downloadable JSON file. */
export function exportRuns(): void {
  const blob = new Blob([JSON.stringify(loadRuns(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spell-architect-runs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
