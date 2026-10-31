# AGENTS.md

Context for any AI coding agent working in this repo. Read this first; follow the links for depth.

## What this is

Spell Architect: a top-down Survivors-style roguelite where the player builds spells by wiring runes (Core → Form → Behaviors/Modifiers/Triggers) in a node editor. TypeScript + Vite + Phaser 3. Client-only (all art and audio generated at runtime), deployed to GitHub Pages. Online co-op is peer-to-peer WebRTC with a small Cloudflare Worker for signaling and run analytics. Game design and rules: [`README.md`](README.md).

## Commands

```bash
npm ci                 # install
npm run dev            # dev server, http://localhost:5173
npm run typecheck      # tsc --noEmit  (this is what CI runs on every PR)
npm run build          # typecheck + production build into dist/
node --test worker/mp.test.mjs worker/runs.test.mjs   # worker unit tests (also run before worker deploy)
```

Before opening a PR: `npm run typecheck`, and the worker tests if you touched `worker/`.

There are no unit tests for the game itself. `tests/*.cjs` are Playwright end-to-end scripts for co-op; each file's header comment says how to run it (needs a built game, `wrangler dev --local --port 8799`, and `playwright` installed). Run them if you change `src/net/` or the co-op flow.

## Map

| Path | What lives there |
| --- | --- |
| `src/data/` | Data-driven definitions: `runes.ts` (runes, elements, forms), `mutations.ts`, `reactions.ts` |
| `src/core/` | `spell.ts` (spell graph, `checkAttach()` rules, compile), `save.ts` (localStorage), `analytics.ts`, `version.ts`, `audio.ts` |
| `src/game/` | Simulation, no rendering concerns: `run.ts` (state + tick), `casting.ts`, `combat.ts` (damage, statuses, reactions), `enemies.ts`, `bosses.ts`, `arena.ts`, `rewards.ts`, `shop.ts`, `relics.ts`, `rituals.ts`, `rounds.ts`, `ultimates.ts`, `telemetry.ts` (analytics counters; counts only, never changes gameplay) |
| `src/net/` | Co-op: host-authoritative, joiner predicts its own movement only. Wire format in `proto.ts` / `wire.ts` |
| `src/ui/` | DOM UI (menus, HUD, editor, shop). Styles in `styles.css`. The shop is not a screen of its own: `shop.ts` is a `ShopPane` embedded in the editor |
| `src/scenes/`, `src/gfx/` | Phaser glue and procedural textures |
| `worker/` | Cloudflare Worker: `/mp/*` signaling (`mp.js`), `/runs` analytics store (`runs.js`) |
| `tools/analyze.mjs` | Compares run analytics across game versions |
| `tools/run-report.mjs` | One run in depth: damage growth vs enemy HP spawned, spell slots, relic attribution, timelines |
| `tools/check-graph.mjs` | Checks the graph is in sync with the game (used by the Stop hook) |
| `public/graph/` | Static mind map of everything in the game (concepts drilling down to single runes, enemies, bosses, relics), cross-links and open design issues, served at `/graph/`. Hand-maintained data at the top of `index.html`: update it when you add content. Vite copies `public/` into `dist/` as is |
| `docs/` | Deep dives, see below |

## Rules that are easy to get wrong

- **Bump `version` in `package.json` (and `package-lock.json`) in any PR that changes gameplay or balance** (numbers, enemy behaviour, rewards, shop, rune effects). UI/tooling-only changes do not. Run analytics are grouped by this version. See [`docs/analytics.md`](docs/analytics.md).
- **Keep the graph in sync.** Any change to game content or rules (`src/data/`, `src/game/`, `src/core/spell.ts`) must update the matching nodes in `public/graph/index.html` in the same PR, then set `GRAPH_SYNCED_VERSION` there to the current `package.json` version (shown in the graph header). A Stop hook (`tools/check-graph.mjs`, wired in `.claude/settings.json`) blocks finishing while they differ; run `node tools/check-graph.mjs` to check by hand.
- **Co-op determinism:** the host runs the only simulation. Code in `src/game/` must work for solo, host and "shell" (remote player) runs. Do not use ad-hoc `Math.random`-driven state that joiners are expected to share; cosmetic effects go through effect events, not replicated sprites. Changing the wire format means bumping the protocol version so mismatched builds are refused. Read [`docs/multiplayer.md`](docs/multiplayer.md) before touching `src/net/`.
- **Joiner data is untrusted.** Characters and ritual lists sent by guests are validated on the host (`validateRituals` etc.). Keep it that way.
- **UI direction:** declutter. No pop-ups, no relic stash, sparse effects (see recent history: "UI/UX declutter").
- **Rune/spell rules live in code, not just docs.** Attachment legality is `checkAttach()` in `src/core/spell.ts`; it also generates the editor's explanations. Add runes via `src/data/runes.ts` (steps in README, "Adding a rune").
- **Run saves are versioned and persisted** (`localStorage` key `spell-architect-save-v1`, `RunRecord` v2). Don't break old saves; add fields compatibly.
- **New mechanics should be measurable.** When you add a relic, behaviour or damage source that changes damage or cooldowns, count it in `src/game/telemetry.ts` (a relic multiplier goes through `relicDamageMul`'s `mul()`; a relic that causes casts passes `rel` to `castForm` and calls `tallyProc`), so run analytics can attribute it. See [`docs/analytics.md`](docs/analytics.md), "Telemetry".
- The worker is deployed by CI on push to `main`; don't change its public routes casually.

## Docs

- [`README.md`](README.md): game design, systems, controls, project layout
- [`docs/multiplayer.md`](docs/multiplayer.md): co-op architecture, protocol, measurements
- [`docs/music.md`](docs/music.md): music moods, source pieces, how to add one
- [`docs/analytics.md`](docs/analytics.md): run records, versioning rule, how to compare versions
- [`docs/rituals.md`](docs/rituals.md): ritual rules and code
- [`docs/icons.md`](docs/icons.md): UI icon sets (Lucide, Tabler), how to add one
- [`worker/README.md`](worker/README.md): worker routes and deploy
- `docs/analytics-*.md`: dated analysis reports (reference only)

## Workflow

- Work on a feature branch, never push to `main` directly; open a PR. CI (`.github/workflows/ci.yml`) runs `npm ci` + `npm run typecheck`.
- Match surrounding code style; keep changes focused. If you make a non-obvious design decision, record the why in the relevant `docs/` file.
- If this file is out of date with the code, fix it in the same PR.
