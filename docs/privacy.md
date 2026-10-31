# Content, identity and privacy

RaidRumble processes chat to run a match; it does not publish chat transcripts. This guide describes the implementation’s data boundaries, including the state that is intentionally retained.

## What reaches the overlay

The overlay receives serializable game views: recognized keywords, answer letters, team totals, timers, results and policy-approved display names. Raw viewer message text stays on the server and is not sent over the overlay WebSocket.

Siege and Fusion Boss may briefly show the names of viewers whose moves counted. End cards show MVP names. Channel names used in Shared Chat controls are read with the host’s authenticated Twitch session and pass `content.render`; a failed read or blocked name uses an authored generic label.

The host dashboard requires the matching host session for live controls. The OBS and mirror views are read-only. A mirror follows one match ID rather than switching to later matches.

## Content generation

No model key is needed. Deterministic templates construct factual questions from the supplied channel title, category and up to three facts entered by each streamer. Stream facts are intended to be shown publicly as quiz answers; keep them public-safe.

When `OPENAI_API_KEY` and `OPENAI_MODEL` are explicitly configured, the content service sends channel context and those facts to the configured model through the Responses API. The model selects supplied factual material and can write fictional boss names/flavor. It does not search the web. Templates construct the factual answer choices, so arbitrary model prose cannot become an invented fact about a streamer.

Every resulting question, boss text and displayed name passes the content policy. Blocked terms, moderation flags, malformed output or unavailable generation produce authored fallback content. An optional provider’s own retention and processing policies apply to the channel context sent to it; do not enter private facts.

## Temporary viewer state

| State                                | Purpose and lifetime                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team assignments and input windows   | In-memory scoring, attribution and spam limits for the current match.                                                                                          |
| Authorized raider roster             | Native chatters seen in the last 30 minutes; only for a raider who authorized access beforehand. Cleared after use. Relayed Shared Chat visitors are excluded. |
| First-seen history                   | Per-host ephemeral hashes and timestamps used for current-stream attribution. Cleared at stream boundaries or shutdown.                                        |
| Afterglow identities                 | Temporary tagged-raider activity for the five-minute widget. Only the final aggregate count enters the rivalry ledger.                                         |
| OAuth role tokens and login sessions | Server memory only. Restarting the server requires reconnecting.                                                                                               |

The recent-participation Afterglow count is not Twitch’s viewer count and cannot establish a retention uplift by itself.

## Persistent data

Normal server startup uses `data/raidrumble.sqlite3` unless `LEDGER_PATH` selects another location. The rivalry tables store channel-pair aggregates, channel display names, match and policy decision identifiers, dossier references, timestamps and aggregate retention counts. They do not store viewer rosters or chat transcripts.

A separate logical regulars store uses HMAC hashes with a different random salt for each host. Its tables share the configured SQLite file by default. It stores a viewer hash and first/last stream identity, not the raw Twitch viewer ID or message text. These records persist across sessions and currently have no automatic age-based deletion. Hashes are pseudonymous state, not a claim of irreversible anonymity.

The application uses a host-login/server-session stream boundary when an actual Twitch stream ID is unavailable. This is an approximation for the regulars signal.

Host preferences, trusted/blocked logins, blocked terms and supplied facts are saved in `data/settings.json`. **Trust next time** is explicit and changes the server-bound raider’s entry only after a successful approval. An expired, refused or replayed approval cannot add trust. Real-chat practice cannot persist trust or match/retention data into the primary host’s ledger.

Runtime data and credentials are ignored by Git. Operators should treat the database and settings as private application data; no account-wide data deletion UI is implemented. Stop the server before managing local database files or backups.

## Login, execution and diagnostics

Browser cookies contain opaque session identifiers, not Twitch tokens. Cookies are HttpOnly, SameSite=Lax, Secure on HTTPS, and expire after 12 hours. OAuth state is browser-bound and single-use. Role tokens are validated at login and hourly, with coordinated refreshes. Callback handlers suppress URL logging and use no-store/no-referrer responses.

Host writes require the authenticated host identity. Warlord controls require a Twitch login matching the raiding streamer and the current match; knowing the link alone is insufficient. No actor identity supplied in an arbitrary request body grants control.

The local policy log records decision identifiers, action, verdict, reason codes and mode. If hosted Decionis is enabled, minimal action context is sent to that authority; execution and claim bearer tokens remain private server state. Raw viewer chat is never a policy payload. Public views receive safe decision summaries, while verified hosted approval links are limited to host controls.

Live readiness exposes connection booleans, confirmed subscription types, event counts/type/time and sanitized setup errors. It does not expose socket session IDs, OAuth codes/tokens, viewer IDs or message text. Local capture files may contain public channel names or visible chat from an authorized recording; review a recording before publishing it.

See [live setup](../apps/server/src/live/README.md), [authority behavior](authority.md), and [verified evidence](verify.md) for operational details.
