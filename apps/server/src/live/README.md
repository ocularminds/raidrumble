# Live Twitch adapter

`LiveService` composes OAuth, server-side browser sessions, EventSub, read-only
raid enrichment, and ephemeral roster capture. It does not create a match or
publish raw chat/display text to overlays.

The constructor needs Twitch client ID/secret, configured bot user ID,
`baseUrl`, `dashboardUrl`, and callbacks documented in `model.ts`. Missing
credentials leave judge mode usable and return HTTP 503 for Twitch login.

`register(app)` adds these routes and stops connections when Fastify closes:

| Route                   | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `/auth/host`            | Connect the current Twitch user as a host.                                 |
| `/auth/bot`             | Requires a connected host browser and authenticates the configured bot ID. |
| `/auth/raider`          | Optional channel authorization for roster capture.                         |
| `/auth/warlord?token=…` | Authenticates exactly the raider bound to a server-issued match link.      |
| `/auth/callback`        | Exchanges a single-use, browser-bound OAuth state and validates identity.  |

Login cookies are opaque, HttpOnly, SameSite=Lax, and Secure on HTTPS. They expire
after 12 hours. Tokens stay in memory and never enter cookies, replies, receipts,
or request logs. Callback routes suppress request URL logging and set no-store
and no-referrer. Token validation occurs at login and hourly; token refreshes are
coalesced by the Twitch package.

Host controls must call `authorizeHost(request, hostId)`. Warlord controls must
call `authorizeWarlord(request, token)`, read `warlord(token)`, and verify its
`matchId` is still the active match before applying a special. Neither control
flow takes an actor ID from the request body. Unsafe cross-origin requests are
rejected by these authorization helpers.

`warlordLink(hostId, raiderId, matchId)` returns `{ token, url, loginUrl }`.
Call `clearMatch(matchId)` when controls should expire. The link alone grants no
control; a verified Twitch login matching its raider ID is required.

Each host has its own EventSub connection for raids, Shared Chat lifecycle, and
affiliate/partner reward redemptions. A separate bot connection subscribes to
chat in connected host and authorized raider channels. Every registration calls
`gate.authorize({ action: 'events.subscribe', ... })`, then
`PolicyExecutor.executeHelix` with the exact approved descriptor. Migrations keep
existing subscriptions; cold reconnections recreate them.

`onRaid(hostId, raid)` returns both channel profiles and policy facts. Failed
account-age or follow reads are represented by `null`, never fabricated trusted
values. The application must gate match start and all externally sourced display
text. The adapter only gathers server-side context.

`onRoster(channelId, event)` reports native chatters from an authorized raider
channel, excluding visitors relayed through Shared Chat. `roster(channelId)`
returns IDs seen in the last 30 minutes. Call `clearRoster(channelId)` after the
match. No roster or token persistence is implemented.

`credentials(hostId, 'host' | 'bot')` is for trusted server services that need to
call the policy executor. Never serialize its result to an API or WebSocket.
`status(hostId)` reports configuration and authenticated connections; it is not
a claim that a real Twitch subscription or raid has been verified.

Validation uses Fastify injection, mocked Twitch HTTP/socket clients, and the
real local policy gate/executor. Real account scopes, EventSub delivery, bot
permission grants, and live OBS behavior still require a channel smoke test.
