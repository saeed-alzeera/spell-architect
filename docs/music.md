# Music

All music is synthesized at runtime (no audio files). `src/core/music.ts` holds the scores, `src/core/audio.ts` the piano voice and scheduler.

## Moods

`UI.syncMusic()` (every 250 ms) picks a mood from what is on screen and calls `audio.setMood()`. The music switches at the next beat of the current piece, crossfading over ~0.9 s.

| Mood | When | Piece it is based on | Feel |
| --- | --- | --- | --- |
| `main` | menus, prep room, between rounds, game over | Beethoven, *Moonlight* Sonata, 1st mvt | slow triplet ostinato, melody on top, soft pad |
| `editor` | spell editor (and its embedded shop) | Satie, Gymnopédie No. 1 | slowest and quietest, heavy pedal, no drums |
| `combat` | a round with no elite or boss alive | *Moonlight*, 3rd mvt | rising arpeggios, chord stabs, light drums |
| `elite` | an elite is alive | same, harder, plus the opening of Bach's Toccata (D minor) moved into C# minor | octave bass on every beat, heavier drums |
| `boss` | a boss is alive | Grieg, *In the Hall of the Mountain King*, moved from B minor to C# minor | low staccato theme, octave doubling, accelerates (0.135 s to 0.092 s per step) |

Pause and pick-a-reward layers during a fight leave the music alone. `audio.intensity` (enemy count) still raises the drum kit above each fight mood's floor.

## Why these choices

- Four of the five moods are in C# minor so crossfades between them stay consonant; only the editor (D major) is a different key, and it is only entered from the calm prep room.
- All source pieces are public domain. The scores are simplified from-memory arrangements, not transcriptions; fix any note in `music.ts` freely.
- A piece is an 8-bar form of `Note`s per bar (step, MIDI pitch, length, loudness). Add a mood by adding a `Piece` and a `Mood` name, then teach `syncMusic` when to use it.
- The piano is one `PeriodicWave` oscillator per key through a lowpass whose cutoff decays, with a hammer-then-ring envelope, so even a busy fight is only a handful of oscillators.
