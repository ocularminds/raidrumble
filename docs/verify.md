# Verification record

Checks performed on 31 October 2026 with Node 20.20.0. The final automated report was recorded at 22:33:57 UTC; the public Twitch practice captures below were reviewed afterward.

| Check                                                 | Result                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Unit and integration tests                            | 609 passed across 71 files                                                                                      |
| Strict TypeScript, ESLint, Prettier                   | Passed                                                                                                          |
| Overlay and dashboard production builds               | Passed                                                                                                          |
| Normal, stranger, blocked and Shared Chat simulations | Passed; completed matches stayed deterministic and undegraded                                                   |
| Twitch application credentials                        | Validated with Twitch                                                                                           |
| Configured test account                               | Public identity verified; standard account, not Affiliate/Partner                                               |
| Host OAuth                                            | Approved in the existing Chrome session; exact registered callback and role scopes verified                     |
| Host EventSub                                         | Four enabled subscriptions confirmed: raid and Shared Chat begin/update/end                                     |
| Bot OAuth                                             | Separately approved for the same test account; host and bot role sessions both connected                        |
| Incoming chat delivery                                | One approved message received through `channel.chat.message`; all five eligible subscriptions ready             |
| Hosted Decionis                                       | Signed shadow/enforcement dossiers and bound grant/claim/receipt lifecycle verified; repeated claim refused     |
| Hosted match start with the production allowance      | An isolated match became active at 1,475 ms using the configured 1,500 ms setup budget; signed binding verified |
| Practice isolation                                    | Real chat reaches the selected practice; real redemptions and channel effects remain on the primary room        |
| Public Twitch broadcast                               | Two Test Raid · Real Chat sessions on babafesti; original labeled backdrop and real Lower Third OBS source      |
| Real chat driving the game                            | One account's Twitch UI messages drove both sessions; public-player captures show a loss, then a boss defeat    |
| Afterglow on Twitch                                   | A displayed sample of 1 was captured; no full five-minute retention result or lift measured                     |
| Genuine Codex-app footage                             | User recordings show the RoundModule contract and three working subagents during later enhancement work         |

The 609-test run, lint, TypeScript, builds and all four simulations passed in `artifacts/finalchecks/20261031T223154617/summary.json`. Its original format check found only documentation pending (`docs/hosted.json`, this file and `improvement.md`). The documentation pass formatted those files, then the repository-wide `pnpm format:check` passed; the original report remains unchanged.

## Public Twitch practice

The consented public test on **babafesti** broadcast the actual 1920×1080 Lower Third browser source over an original backdrop labeled as a test, with no third-party gameplay. One account entered commands through Twitch's chat UI. The public Twitch player showed two explicitly labeled **Test Raid · Real Chat** sessions: the first reached a loss-style end card; the second showed **GG / BOSS DEFEATED** at 22:48:22 UTC and **BETTER TOGETHER** at 22:48:29 UTC. An Afterglow sample of **1** was also captured.

The opposing community was fictional. No automatic players were generated, and practice sent no Twitch API announcements or shoutouts and wrote no real rivalry results. The single tagged chat account explains the Afterglow sample; it is neither Twitch's concurrent viewer count nor a full five-minute retention measurement. The broadcast used `POLICY_GATE=local`, and it is separate from the hosted authority probe.

Reviewed public-player frames are retained locally under `artifacts/capture/twitchflow/`: `000310.png` shows the first loss, `001260.png` the second boss defeat, `001320.png` its victory end card, and `001378.png` Afterglow 1. Privacy-safe review derivatives are under `artifacts/twitchreview/`. These source captures are ignored by Git; final video publication remains pending.

## Earlier connection checks

The actual Twitch application had registered `http://localhost:5174/auth/twitch/callback`; the initial `.env` callback used another port and was rejected by Twitch. The application now supports the existing dashboard callback through exact-path local redirect middleware. No Twitch developer-console settings were changed. Credentials and runtime tokens are not committed; role tokens remain in server memory.

At 20:21:39 UTC, the single approved `RaidRumble connection test` message posted from the Twitch page appeared in chat and reached the server. The authenticated status reported `eventCount: 1`, `lastEvent.type: chat`, both role sessions connected, and both host/chat transports ready. This verifies incoming EventSub delivery; the message was entered through Twitch's chat UI.

Live setup also exposed unnecessary reconnects at the old keepalive deadline, which allowed only one millisecond of delivery jitter. Welcomed sessions now allow a bounded two-second grace period. Four additional tests cover late healthy keepalives, recovery from genuine silence, the unchanged pre-welcome deadline, and a failed migration retaining the healthy original session. A follow-up log check found no further subscription attempts for 243 seconds and no connection warnings.

## Hosted authority and execution safety

The hosted adapter is selected explicitly with `POLICY_GATE=decionis`. In-match actions retain 120 ms; start, collab start, reward configuration and EventSub setup have a bounded 1,500 ms allowance. An account-backed probe through the production `Room.raid` path became active at 1,475 ms, with a hosted grant, claim and verified signed dossier. Its separately bounded receipt timed out without hiding or retrying the match. Signature verification proves the evaluation and execution binding, not receipt finalization or independent observation of the effect. The 25 ms margin in this run is not a latency guarantee. This was an isolated local match using fictional channels, with no Twitch effect or ledger write. See [hosted authority details](authority.md) and [sanitized evidence](hosted.json).

The enhancement suite covers compact overlay geometry and text sizes, counted contributor feedback, sound-cue deduplication, factual distractors, category-based boss names, setup/claim deadlines, explicit trust, settings migration, and real-chat practice isolation. A review found that asynchronous content preparation could outlive a short execution lease. Content is now staged before claiming; Game creation is synchronous, and a slow optional generator cannot consume the immediate claim window. Four regressions failed before that fix and pass afterward.

## Codex footage and remaining evidence limits

User-recorded Codex clips show `AGENTS.md` and the `RoundModule` interface, then **three working subagents** during the enhancement pass. Cropped and redacted derivatives plus source hashes are in `artifacts/codexreview/`. These clips show actual Codex use, but not the original round-generation moment and not a readable 609-test summary. The original overlapping round construction remains documented at **17:50:26–17:51:52 UTC** in [parallel.json](parallel.json); the earlier 361- and 501-test totals remain historical checkpoints.

A real incoming raid from a second streamer, Shared Chat across channels, bot announcements/shoutouts, and Channel Points redemptions have not been exercised on a live stream. The current test account cannot exercise Affiliate/Partner-only rewards. No hosted full live-raid flow or measured retention lift is claimed. These paths have automated coverage but remain separate from the confirmed checks above.

Local evidence is ignored by Git: the final-check report directory, earlier `artifacts/integration.txt`, `lint.txt`, `build.txt`, `format.txt`, four `sim*.txt` reports, `twitchbefore.json`, `twitchafter.json`, `twitchchat.png`, `twitchready.png`, and `artifacts/decionis/`. The earlier demo video retains its original recorded test checkpoint and parallel round-build evidence. T29/T30 remain open until the enhanced media, public default-branch update, final video and Devpost submission are complete.
