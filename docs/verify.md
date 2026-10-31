# Verification record

Checks performed on 31 October 2026 with Node 20.20.0:

| Check                                                 | Result                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Unit and integration tests                            | 501 passed across 52 files                                                                                  |
| Strict TypeScript, ESLint, Prettier                   | Passed                                                                                                      |
| Overlay and dashboard production builds               | Passed                                                                                                      |
| Normal, stranger, blocked and Shared Chat simulations | Passed; completed matches stayed deterministic and undegraded                                               |
| Twitch application credentials                        | Validated with Twitch                                                                                       |
| Configured test account                               | Public identity verified; standard account, not Affiliate/Partner                                           |
| Host OAuth                                            | Approved in the existing Chrome session; exact registered callback and role scopes verified                 |
| Host EventSub                                         | Four enabled subscriptions confirmed: raid and Shared Chat begin/update/end                                 |
| Bot OAuth                                             | Separately approved for the same test account; host and bot role sessions both connected                    |
| Incoming chat delivery                                | One approved message received through `channel.chat.message`; all five eligible subscriptions ready         |
| Hosted Decionis                                       | Signed shadow/enforcement dossiers and bound grant/claim/receipt lifecycle verified; repeated claim refused |

The actual Twitch application had registered `http://localhost:5174/auth/twitch/callback`; the initial `.env` callback used another port and was rejected by Twitch. The application now supports the existing dashboard callback through exact-path local redirect middleware. No Twitch developer-console settings were changed. Credentials and runtime tokens are not committed; role tokens remain in server memory.

At 20:21:39 UTC, the single approved `RaidRumble connection test` message posted from the Twitch page appeared in chat and reached the server. The authenticated status reported `eventCount: 1`, `lastEvent.type: chat`, both role sessions connected, and both host/chat transports ready. This verifies incoming EventSub delivery; the message was entered through Twitch's chat UI.

Live setup also exposed unnecessary reconnects at the old keepalive deadline, which allowed only one millisecond of delivery jitter. Welcomed sessions now allow a bounded two-second grace period. Four additional tests cover late healthy keepalives, recovery from genuine silence, the unchanged pre-welcome deadline, and a failed migration retaining the healthy original session. A follow-up log check found no further subscription attempts for 243 seconds and no connection warnings.

The active local server uses `POLICY_GATE=local` for account-backed Twitch checks. The hosted adapter is selected explicitly with `POLICY_GATE=decionis`. Its hard 120 ms budget remains intact: observed hosted operations took 153–834 ms, and the actual adapter exercised its declared unsigned local-ledger timeout fallback. The longer diagnostic timeout used for protocol verification does not change live behavior. See [hosted authority details](authority.md).

A real incoming raid from a second account, Shared Chat across channels, bot announcements/shoutouts, and Channel Points redemptions have not been exercised on a live stream. The current test account cannot exercise Affiliate/Partner-only rewards. These paths have automated coverage but remain separate from the confirmed live checks above.

Local evidence is ignored by Git: `artifacts/integration.txt`, `lint.txt`, `build.txt`, `format.txt`, the four `sim*.txt` reports, `twitchbefore.json`, `twitchafter.json`, `twitchchat.png`, `twitchready.png`, and `artifacts/decionis/`. The earlier demo video retains its original recorded test checkpoint and parallel round-build evidence.
