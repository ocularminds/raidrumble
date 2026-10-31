# Adding a round

The engine owns the timeline; a round owns only its state and rules. Modules never read a clock, call an API, mutate caller state, or use ambient randomness.

1. Create a short file in `packages/engine/src/rounds`, exporting a named class implementing `RoundModule<State>`.
2. Write tests first: deterministic inputs/results, a fixed-tick `view` snapshot, boundary cases, and the round’s scoring invariant.
3. Add its import and `defineRound(new YourRound())` registration in `registry.ts`.
4. Run `pnpm test` and `pnpm sim -- --headless`.

`start` returns fresh state. `onInput` returns **the same object** when a command is ignored; this tells the timeline not to consume the player’s rate-limit window or lock their team. Counted input returns new state. `tick` clamps elapsed time to the module duration. `result` and `view` are deterministic projections.

`ctx.nowMs` passed to `tick` is the **end** of the interval. `ctx.rng(index)` returns the same number for the same seed and index. `ctx.teams` contains eligible member counts frozen for fairness windows; `ctx.activeTeams` is the observed participant count used to scale the boss. Authorize special effects before putting them in the context.

Keep state private to the module’s type. `defineRound` closes over that state and exposes a uniform adapter to `MatchTimeline`, avoiding an unsafe union of every possible round state. Broken modules degrade to a recovery round while the timeline and overlay continue.

The shared `RoundView` exposes title, keyword, timer, normalized scores, and optional scene data. A new module using an existing scene needs no renderer change. A fundamentally new visual scene needs its own renderer; the common text/timer view remains available as a fallback.

| Module       | Lifecycle                                               | Scoring                                                                                 |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SiegeRound` | 60 seconds, new keyword every 10 seconds                | Participation rates in 2-second windows, floor 5                                        |
| `QuizRound`  | Four 10-second questions, each with a 2.5-second reveal | First answer per question; newcomers answer about the host, home answers about visitors |
| `BossRound`  | 60 seconds, a 3-second weak point every 10 seconds      | Both communities attack HP scaled from active participants                              |

Implementation files stay below 500 lines. Prefer a typed object for state and a class for its single responsibility; small arithmetic helpers can remain pure functions. Use `services/raid.ts`, never `raid-service.ts`.
