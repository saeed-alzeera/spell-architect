# Rituals

**Status:** implemented (`game/rituals.ts`, `ui/rituals.ts`). An earlier version had a catalogue of coin-priced, 2-4 round contracts with kill/crit/build objectives and tiers; it was hard to finish and several objectives were out of the player's hands, so it was removed.

## Rules

- **Always 3 rounds.**
- **Cost: half of your current health**, paid when you accept (rounded down, never lethal). No coins.
- **The challenge must be something the player can bring about.** Not luck, not a kill count the build may not reach.
- Offered on the between-round prep screen. Rituals can run at the same time (each one costs half of your health at that moment, so stacking them is expensive) and each ritual can be performed once per run.
- Miss the challenge in any round and the ritual **lapses** at the end of that round (the health is already spent). Meet it in all three and the reward is applied at the end of the third round.
- The reward lasts for the rest of the run and is never meta progression.

## Rite of the Fall

Each round part of the arena floor crumbles away (`arena.ts`; warned tiles flash and crack first). The ritual asks you to be caught by it **at least once in each of the 3 rounds**, which means taking the fall damage (12% of max health, minimum 6) on purpose by standing on a warned tile or stepping over the edge once it has gone. Reward: **+20% damage** for the rest of the run.

It trades a lot of health for damage, so it suits a build that can afford the risk and ends with the player in control: stand still on a warned tile and you will fall, dodge and you will not.

## Golden Idol

A golden zone covers about half of the arena. It is a blob around a slowly drifting centre whose radius wobbles with three waves turning at different speeds, so it is always growing on some sides and receding on others (`goldZone` in `rituals.ts`). The blob is snapped to the floor grid: a tile is gold when its centre is inside it, you count as in the zone when you stand on a gold tile, and it is drawn as whole tiles with an outline around the edge. The ritual asks you to spend **at least 50% of each of the 3 rounds** inside it, measured against the time the round actually lasted (so boss rounds work too). Reward: **each coin an enemy drops has a 50% chance to be doubled** (`goldMul`, rolled per drop in `killEnemy`) for the rest of the run.

Per player: each player's Golden Idol has its own progress and the zone is drawn only for the player who accepted it. Known gap: coins are not owned, so a doubled coin goes to whoever picks it up.

Co-op: the zone is a pure function of round, seed and `roundElapsed`, so joiners draw it themselves. The host counts each player's time in the zone (`ritualTick`) and sends it in the `rit` message (`zt`) for the HUD. The wire change bumped `PROTO` to 7.

Why it moves: a fixed zone would be free (just stand there). A shifting one makes you chase it while enemies chase you.

## UI

- The Grimoire lists every ritual (challenge, reward, cost) in a Rituals section, generated from `RITUALS`.
- During a level the HUD card (`updateRituals` in `ui/ui.ts`) pulses while the round's challenge is still open, turns green once it is met, and shows round pips plus a short hint.

## Code

- `RITUALS` lists the rituals (two entries). Adding another means a new def, a challenge flag on `Run.ritualRound`, a check in `ritualRoundEnd` and a reward.
- `Run.fallPlayer` raises `ritualEvent(run, { t: 'void' })`; `Run.startRound` / `endRound` call `ritualRoundStart` / `ritualRoundEnd`.
- Co-op: every player has their own ritual, the host evaluates it per shell, and `validateRituals` rejects doctored lists from joiners. Progress reaches the joiner's HUD in the `rit` control message.
