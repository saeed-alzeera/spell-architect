# Run analytics and versioning

Every finished run (won, lost or abandoned; not the Sandbox) is saved and uploaded, stamped with the game version it was played on, so the effect of a balance change can be measured.

## What is recorded

`RunRecord` (`src/core/analytics.ts`, `v: 3`, see Telemetry below): result, round reached, time, level, kills, damage, damage taken, what killed you, spells and relics at the end, a per-round log, plus:

| Field | Meaning |
| --- | --- |
| `gameVersion` | `version` in `package.json` at build time |
| `build` | short git commit of the build (`GITHUB_SHA` in CI) |
| `players`, `role` | players in the game (1 = solo) and `solo` / `host` / `guest` |
| `quick` | accelerated test mode |
| `installId` | random id made by the browser, to group one player's runs. It identifies nobody |

Older runs (no `gameVersion`) are shown as "unversioned".

## Versioning rule

Bump `version` in `package.json` (and `package-lock.json`) in the same PR as any change that affects gameplay or balance: numbers, enemy behaviour, rewards, shop, rune effects. Pure UI or tooling changes do not need a bump. The version shows in the main-menu footer and in each Run History row; `build` tells apart two builds of the same version.

## Where runs go

1. **This device**: all runs are kept in `localStorage` (no cap; if the browser's storage fills up the per-round logs of the oldest runs are dropped first). Run History has an **Export JSON** button.
2. **The run store**: a finished run is queued and POSTed to `/runs` on the signaling worker (`worker/runs.js`, a Durable Object, deduplicated by run id). Runs that cannot be sent (offline, rate-limited) stay queued and are retried on the next run and the next launch. Uploads are public; reads need the admin key.

One-time setup after deploying the worker: `cd worker && npx wrangler secret put ADMIN_KEY` (any long random string).

## Comparing versions

```bash
ADMIN_KEY=... node tools/analyze.mjs               # all versions, side by side
ADMIN_KEY=... node tools/analyze.mjs --solo --normal
node tools/analyze.mjs --file runs.json            # an exported file
```

For each version: runs, win rate with a 95% interval, mean round reached, survival time, damage per second, kills per minute, damage taken, and what killed players; each version is compared to the previous one with a z-score on round reached ("likely a real change" vs "within noise"). Filter with `--solo`, `--coop`, `--quick`, `--normal`, `--version X`. Compare like with like: solo vs co-op and accelerated vs normal runs behave very differently, and small samples (under about 30 runs per version) say little.

## Telemetry (`v: 3` records)

Added after the first analysis of a won run showed what raw totals hide. Three problems, and what answers each:

| Problem | What was missing | What the record has now |
| --- | --- | --- |
| **Damage totals only mirror the spawn.** `dealDamage` counts `min(hit, target HP)`, so a build that kills everything as it spawns shows damage ≈ total enemy HP, whatever its power. Damage per kill divided by enemy HP scaling was flat (~20) from round 7 to 19 in that run, despite 6 relics and an evolution. | Nothing about the enemy side. | Per round `tel.spawned`, `hpPool` (max HP of everything spawned), `hpLeft` and `alive` (what was still alive at the end), `life` (mean seconds an enemy lived), `byType`, `raw` / `over` (damage attempted vs overkill) and 5 s timelines of damage, kills and enemies alive. |
| **A spell slot looked like a different spell after a Core swap**, so a slot's history was lost (a Fireball slot became "Venom Dart" and the run summary credited the whole slot to the new name). | Slot identity, structure. | Every spell has `uid` (stable per slot, survives Core/Form swaps), `slot`, `sig` (full structure, see below), `mut`, and per-round `casts`, `crits`, `kills`. |
| **No way to say which relic or modifier did what.** | Any attribution. | Damage by source (`direct`, `dot`, `react`, `tail`, `none`), by element, crit count and crit damage; per spell `hits`, `dot`, `react`, `tail`, `over`, `rel`, trigger `trig` = `[rolls, fires]`; per relic damage (see below). `acq` lists when each relic, rune, forge, mutation and level boost was gained, in game seconds. |

Also fixed: the round log only had rounds that ended by timer or boss kill, so **the round a run was lost in and the final boss round of a win were missing**. They are now logged with `partial: true`. Per-round spell damage used to be diffed by array index and broke when slots changed; it is keyed by `uid` now.

### Reading the numbers

- `sat` = round damage / `hpPool`. Near 1 (as in the won run) means the build clears what spawns; damage, kills and DPS then say little about power. Look at `alive`, `hpLeft` and `life` instead, and at how fast the timeline `alive` falls. Below ~0.8 means enemies were left standing and damage does reflect power.
- `sig` format: `element[*]:form[behaviours|modifiers]{trigger@chance>child;...}`, `*` = evolved core, modifiers as `dup1`, `grow2`, e.g. `poison*:projectile[split|dup1]{kill@0.28>lightning:aura}`. Trigger chances include Echo Chamber and Gambler's Dice.
- Relic attribution (`tel.relic`), two kinds of key:
  - `x:<id>`: damage a **damage-multiplier** relic added (Prism, Idol, Baton, Ember, Whetstone, Purist, Hammer). Per hit, relics added `dealt * (1 - 1/M)` with `M` the product of their multipliers, split between them by `log(multiplier)`. These sum to the relics' total contribution.
  - `<id>` (Mirror Shard, Sock, Compass): `dmg` from casts the relic caused (including everything those casts spawn), `procs` count. Metronome and Duelist's Glove: `procs` and `cd`, the seconds of cooldown actually refunded (divide by the slot's cooldown for the casts gained). These overlap with the spells' own damage and with the `x:` rows; do not add them up.
  - Level scaling, `Increase`/`Grow` runes and the evolved-core +40% are not relic effects and are not split out: the player's `dmgMul`, crit and cooldown multipliers are in `tel.p` each round.
- Acquisitions: `acq[].r` is the round being played, or the **next** round for shop purchases between rounds; `tel.t0` is the game time each round started, so exact placement is `t0 <= acq.t`.

### Size

A 20-round record is roughly 40-60 KB (about 1.4 KB per round with two spells in a quick test; more with five long spell signatures). The worker accepts up to 125 KB (a Durable Object value is limited to 128 KiB). The game trims anything over 120 KB before uploading (`fitForUpload` in `src/core/analytics.ts`): timelines first, then trigger counts, then per-round telemetry. The copy on the device is never trimmed.

### Tools

```bash
ADMIN_KEY=... node tools/run-report.mjs                 # the latest win, in depth
ADMIN_KEY=... node tools/run-report.mjs --id <id> --round 12
node tools/run-report.mjs --file runs.json --latest
```

`tools/analyze.mjs` prints a `telemetry` line per version (mean `sat`, enemies left alive, mean enemy life).

Telemetry is counting only: no gameplay or balance change, so the game version is not bumped for it. Records with telemetry have `v: 3`.
