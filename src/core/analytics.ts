// Run analytics: every run is saved locally (localStorage) for the Run History screen.

export interface SpellRec { name: string; element: string; damage: number; cost: number; cap: number; forms: string[]; evolved: boolean }
export interface RoundRec {
  round: number; boss: boolean; secs: number; kills: number; damage: number; taken: number;
  hpEnd: number; maxHp: number; coins: number; level: number; spells: SpellRec[]; relics: string[];
}
export interface RunRecord {
  id: string; v: 1; startedAt: number; endedAt: number;
  result: 'won' | 'lost' | 'abandoned'; quick: boolean; sandbox: boolean; seed: number; startForm: string;
  reachedRound: number; time: number; level: number; kills: number; damage: number; taken: number;
  hurtBy: Record<string, number>; deathCause: string; shards: number; bosses: number; reactions: number;
  spells: SpellRec[]; relics: string[]; roundLog: RoundRec[]; discoveries: string[];
}

const KEY = 'spell-architect-runs-v1';
const MAX = 80;

export function loadRuns(): RunRecord[] {
  try { return (JSON.parse(localStorage.getItem(KEY) || '[]') as RunRecord[]).sort((a, b) => b.endedAt - a.endedAt); } catch { return []; }
}
function writeRuns(list: RunRecord[]) {
  const l = [...list].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* quota */ }
}

export function saveRunRecord(rec: RunRecord) {
  const list = loadRuns().filter((r) => r.id !== rec.id);
  list.push(rec);
  writeRuns(list);
}
