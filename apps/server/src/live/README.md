# Live Twitch adapter

## Connect a channel locally

1. Register a Twitch application and choose an exact registered redirect URI. The
   ordinary API callback is `http://localhost:3000/auth/callback`. An application
   already registered for `http://localhost:5174/auth/twitch/callback` can use the
   dashboard callback described below; do not change app settings just to match a
   guessed port.
2. Copy `.env.example` to ignored `.env`. Set `TWITCH_CLIENT_ID`,
   `TWITCH_CLIENT_SECRET`, and `TWITCH_AUTH_URL` when using a registered callback
   other than the default. Existing `TWITCH_AUTH_CLIENT` and `TWITCH_AUTH_SECRET`
   aliases are supported. Keep the secret on the server.
3. Run `pnpm dev`, open the dashboard on `http://localhost:5174`, and connect the
   host. Host login works before a bot ID has been configured.
4. Configure `TWITCH_BOT_USER_ID` for the account deliberately chosen to post in
   chat, restart if configuration changed, then connect that bot account. The
   same account can be host and bot during a test, using separate role tokens.
5. Confirm **Raid events ready** and **Chat ready**, then copy the host's overlay
   URL into OBS as a 1920×1080 Browser Source. The default Lower Third preserves
   most of the stream. Side Rail/Full Arena, reduced motion and opt-in sound are
   saved in the dashboard; sound starts off.

`Test Raid · Real Chat` creates a labeled, local practice on this host's overlay.
Participants choose `!join raiders` or `!join home` before their first counted
move and follow the overlay. No automatic players, Twitch announcements or real
ledger entries are produced. **Exit Test Raid** restores the primary room. A
genuine incoming raid is handled by the host's normal authority.

The ordinary **Launch Test Raid** opens the local judge arena with simulated
players. Its Warlord practice controller is `/warlord/demo`. Actual Warlord links
are bound to the real raiding streamer and current match. Affiliate/Partner
hosts may explicitly approve a 100-point Reinforcements reward; only completed
redemptions of the configured reward count.

For a planned collaboration, begin a Twitch Shared Chat session and select
**Start Collab Rumble**. All current participant identities and the selected peer
must pass policy. An optional raider can connect `/auth/raider` ahead of a raid
for temporary roster capture; this is not implicit in host or bot login.

Tokens are held in memory. Reconnect after a server restart. A deployment needs
HTTPS and explicit matching API, dashboard and overlay origins; these local
instructions do not deploy a hosted site. See [privacy](../../../../docs/privacy.md)
and [the verification record](../../../../docs/verify.md) for data boundaries and
the checks actually performed.

## Adapter contract

`LiveService` composes OAuth, server-side browser sessions, EventSub, read-only
raid enrichment, and ephemeral roster capture. It does not create a match or
publish raw chat/display text to overlays.

The constructor needs Twitch client ID/secret, `baseUrl`, `dashboardUrl`, and
callbacks documented in `model.ts`. A configured bot user ID is required only
for bot login. Missing application credentials leave judge mode usable and return
HTTP 503 for Twitch login.

`resolveTwitchConfig(env, baseUrl, dashboardUrl?)` reads `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`
first, with `TWITCH_AUTH_CLIENT` / `TWITCH_AUTH_SECRET` as fallbacks. It reads
`TWITCH_BOT_USER_ID` without inferring an account. `TWITCH_AUTH_URL`, when set, is
the exact registered callback URI, never a Twitch token or authorization endpoint.

Call `await live.startCallbackRelay()` after the API listens. For a callback on a
different local port, this starts one listener bound to loopback. Only GET on the
configured callback path redirects to the fixed API `/auth/callback` route; other
paths, methods, hostile Host headers, and duplicate OAuth fields are rejected.
Unknown query fields are discarded. The callback listener serves no API routes,
sets no-store/no-referrer, and closes with Fastify. Callback URLs on a different
external origin are rejected. Same-origin callback paths are registered directly.

When the exact callback origin is the configured loopback `DASHBOARD_URL`, Vite's
small exact-path middleware forwards only `/auth/callback` or
`/auth/twitch/callback` to the fixed API callback. It copies only `code`, `state`
or `error`, suppresses caching/referrers and does not log a proxy error containing
the query. No competing callback listener binds the dashboard port. The token
exchange still uses the original registered dashboard URI. Other loopback ports
can use the separate callback listener; arbitrary external callback origins are
not inferred or relayed.

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
`status(hostId)` reports application configuration and authenticated connections;
`configured` does not require a bot ID. `hostEventsConnected` and
`chatEventsConnected` require successful, matching, enabled subscription
responses on the current sockets. `subscriptions` lists confirmed types, and
event count/type/time distinguish setup from delivered notifications. These
diagnostics never expose tokens, socket session IDs, viewer IDs or chat text.
Deliberately choosing the same account for host and bot is supported, with
separate role-scoped tokens and connections.

`sharedChannels(hostId)` returns copies of current Shared Chat channel labels.
Get Users reads use the host token, and every external name passes the content
gate. Failed/blocked reads keep authored fallback labels. Session end,
re-authorization and revocation discard stale asynchronous results.

Automated validation uses Fastify injection, mocked Twitch HTTP/socket clients,
and the real local policy gate/executor. The verification record separately
documents successful account-backed host/bot login and incoming chat delivery.
Real raids, cross-channel behavior and Affiliate/Partner rewards need their own
live evidence; mocked tests do not establish that evidence.
