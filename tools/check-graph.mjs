#!/usr/bin/env node
// Keeps public/graph/index.html in step with the game.
//   1. The graph declares `GRAPH_SYNCED_VERSION`; it must equal package.json's version.
//   2. If gameplay code (src/data, src/game, src/core/spell.ts) differs from origin/main,
//      the graph file must differ too.
// Used as a Claude Code Stop hook (.claude/settings.json) and runnable by hand:
//   node tools/check-graph.mjs
// Exit 2 + stderr message = the hook tells the agent to go update the graph.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Avoid a Stop-hook loop: if we already blocked once this turn, let it through.
try {
  if (!process.stdin.isTTY) {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    if (input.stop_hook_active) process.exit(0);
  }
} catch { /* not hook input */ }

const GRAPH = 'public/graph/index.html';
const WATCHED = [/^src\/data\//, /^src\/game\//, /^src\/core\/spell\.ts$/];
const sh = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

const problems = [];
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const m = readFileSync(GRAPH, 'utf8').match(/GRAPH_SYNCED_VERSION\s*=\s*'([^']+)'/);
if (!m) problems.push(`${GRAPH} has no GRAPH_SYNCED_VERSION constant.`);
else if (m[1] !== pkgVersion) {
  problems.push(`Graph says it is synced to v${m[1]} but package.json is v${pkgVersion}. Update the graph content, then set GRAPH_SYNCED_VERSION to '${pkgVersion}'.`);
}

try {
  const base = sh('git merge-base HEAD origin/main');
  const changed = new Set([
    ...sh(`git diff --name-only ${base}`).split('\n'),
    ...sh('git ls-files -o --exclude-standard').split('\n'),
  ].filter(Boolean));
  const gameplay = [...changed].filter((f) => WATCHED.some((re) => re.test(f)));
  if (gameplay.length && !changed.has(GRAPH)) {
    problems.push(`Gameplay files changed but ${GRAPH} did not:\n  ${gameplay.join('\n  ')}\nUpdate the affected nodes (and GRAPH_SYNCED_VERSION).`);
  }
} catch { /* no origin/main available (shallow clone etc.): skip the diff check */ }

if (problems.length) {
  console.error('Graph out of sync (see AGENTS.md):\n- ' + problems.join('\n- '));
  process.exit(2);
}
