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

A golden zone covers about a fifth of the arena (about 20% of the floor tiles, measured over rounds 1-12; it started at 28% and was shrunk by 30% in area because it was too easy to just stay in). It is a blob around a slowly drifting centre whose radius wobbles with three waves turning at different speeds, so it is always growing on some sides and receding on others (`goldZone` in `rituals.ts`). The blob is snapped to the floor grid: a tile is gold when its centre is inside it, you count as in the zone when you stand on a gold tile, and it is drawn as whole tiles with an outline around the edge. The ritual asks you to spend **at least 75% of each of the 3 rounds** inside it, measured against the full round length (boss rounds, which have no fixed length, count against the time so far). Reward: **every coin you earn is worth 50% more** (`goldMul`: kill drops via `dropCoin`, plus the round-clear and boss bonuses) for the rest of the run. It used to double a random half of kill drops; since coins go straight to the purse (about one per five kills) that was nearly invisible, so the bonus now applies to all income and is deterministic.

Per player: each player's Golden Idol has its own progress and the zone is drawn only for the player who accepted it.

Co-op: the zone is a pure function of round, seed and `roundElapsed`, so joiners draw it themselves. The host counts each player's time in the zone (`ritualTick`) and sends it in the `rit` message (`zt`) for the HUD. The wire change bumped `PROTO` to 7.

Why it moves: a fixed zone would be free (just stand there). A shifting one makes you chase it while enemies chase you.

## Vow of Silence

**Only offered while at least 2 of your spells have a Trigger** (anywhere in the spell, including on Forms launched by other Triggers). For the 3 rounds of the ritual **no Trigger fires at all** for you (`triggersSilenced`, checked in `processEvents`). There is nothing to fail: the ritual is kept by getting through the rounds, so the price is the health plus a build that cannot lean on its Triggers. Reward: **every Trigger gets 2 rolls instead of 1** for the rest of the run (`triggerRolls`): a Trigger with chance c fires with chance 1-(1-c)². A 100% Trigger is unchanged.

Why it has no failure condition: the handicap is the challenge. Co-op: both effects are per player, resolved with the owner of the spell that raised the event.

## Oath of Purity

**Only offered while at least 3 of your spells use 75% or more of their capacity** (`PURITY_SPELLS`, `PURITY_FILL`). Swearing it picks your **weakest working spell** (the one that has dealt the least damage so far; the earliest slot wins a tie) and stores its uid on the ritual. For the 3 rounds only that spell casts: the others, their ultimates and relic procs that would cast them are silent (`spellSilenced`, checked in `updateCasting`, `Run.ultimates` and the Mirror relic). Nothing can fail, like the Vow of Silence. Reward: when it completes, the prep screen shows a picker (`claimPurity`) and **one spell of your choice gets +50% capacity** (at least +1), recorded with `picked` so it is only claimed once. In co-op the uid and `picked` travel in the build the joiner sends, and `validateRituals` checks both.

## Sanguine Pact

**Only offered from round 11 on, and only at full health** (`SANGUINE_ROUND`). For the 3 rounds **you cannot heal at all** (`healingBlocked`): `Run.heal` (hearts, draughts, level-up boosts, relic heals) does nothing, passive regeneration stops, and the round-start heal is skipped. The shop does not stock Healing Draughts and Mend Wounds / Full Restoration are not offered as rewards while it runs. Reviving a downed co-op player still works. Nothing can fail: the price is the half of your health it costs plus not being able to recover it. Reward: **+0.3 HP/s regeneration and +10 maximum health** for the rest of the run (the new max health is not filled in).

Both new rituals bumped `PROTO` to 11 (the build gained `uid` / `picked`).

## UI

- The Grimoire lists every ritual (challenge, reward, cost) in a Rituals section, generated from `RITUALS`.
- During a level the HUD card (`updateRituals` in `ui/ui.ts`) is red (pulsing) while the round's challenge is still open, turns green once it is met for the round and goes back to red when the next round starts (the Vow of Silence has nothing to meet, so it stays red), and shows round pips plus a short hint; the Golden Idol also gets a progress bar of the time spent in the zone this round, with a line at the 75% mark past which you are safe to leave. Once a ritual is fulfilled it turns green and stays on the HUD as a green seal (`.hud-seals`, tooltip shows the reward), the round ends with a "RITUAL COMPLETE" announcement, and the prep screen lists it as complete with its reward.
- The Stats panel (`ui/stats.ts`, 📊 button on the pause menu and prep screen) lists each ritual's state and reward next to the rest of your upgrades.

## Code

- `RITUALS` lists the rituals (five entries). Adding another means a new def, a challenge flag on `Run.ritualRound`, a check in `ritualRoundEnd` and a reward.
- `Run.fallPlayer` raises `ritualEvent(run, { t: 'void' })`; `Run.startRound` / `endRound` call `ritualRoundStart` / `ritualRoundEnd`.
- Co-op: every player has their own ritual, the host evaluates it per shell, and `validateRituals` rejects doctored lists from joiners. Progress reaches the joiner's HUD in the `rit` control message.
