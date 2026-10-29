# Run analytics and versioning

Every finished run (won, lost or abandoned; not the Sandbox) is saved and uploaded, stamped with the game version it was played on, so the effect of a balance change can be measured.

## What is recorded

`RunRecord` (`src/core/analytics.ts`, `v: 2`): result, round reached, time, level, kills, damage, damage taken, what killed you, spells and relics at the end, a per-round log, plus:

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
