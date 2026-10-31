# Rivalry ledger

`Ledger(path = ':memory:')` stores aggregate match outcomes in SQLite. Its schema contains channels, canonical channel pairs and match receipts. It does not accept viewer rosters, chat messages or MVP lists. `settle` explicitly selects known fields, so extra JavaScript properties are never persisted.

Use `LedgerService(gate, ledger).settle(record)` for a match outcome. The service first authorises `ledger.settle`, then invokes storage inside `PolicyExecutor`. The input contains `matchId`, `hostId`, `raiderId`, `winner`, `bossKilled`, `endedAtMs`, `startDecisionId`, and optionally `startDossierId`, `hostName` and `raiderName`. Channel names must already have passed `content.render`. The actual settlement decision supplies `settleDecisionId` and `settleDossierId`; caller-supplied settlement proofs are ignored.

The service returns `{ executed, value?, reason?, decision }`. A successful `value` contains `{ inserted, match, pair }`. The raw `Ledger.settle` method additionally accepts the settlement proof fields and is intended for an existing caller-owned executor boundary. `Ledger.retention(matchId, count)` also belongs inside that boundary; only the final aggregate count is written. Gate failure uses the policy's local settlement fallback, marked unsigned. Dossier IDs are audit references, not a claim that the ledger has cryptographically verified a dossier.

Repeated identical match IDs do not change totals or overwrite the first receipt. A retry may have a new settlement decision, while the original stored decision remains the audit reference. Changed channels, result, time or start receipt under the same match ID are rejected. Aggregates and streaks are updated transactionally and ordered by match end time, including late arrivals. A competitive draw breaks a channel's win streak. Co-op boss kills are tracked separately.

Read APIs:

- `match(matchId)` returns the immutable match fields, unsigned flag and retention count.
- `pair(hostId, raiderId)` returns wins oriented for the requested host, match and boss-kill counts, streak and latest-match retention.
- `graph()` returns `{ nodes, edges }`, with canonical source/target IDs and aggregate edge weights.
- `close()` releases the database and is safe to repeat.

`AfterglowTracker(endedAtMs, now = Date.now)` holds viewer timestamps only in memory. Feed `observe(userId, team, atMs)` and call `view()` for a count of unique raiders who chatted in the last 120 seconds. Seed recent match chat timestamps when the end card finishes. At 300 seconds, it returns `finalCount` using the exact deadline cutoff and clears its viewer map. Later polls preserve that final number. Only pass this number to the ledger.

`RegularStore(path = ':memory:')` is a separate store for the attribution heuristic. It persists a different salt per host and HMAC-SHA256 viewer hashes; raw viewer IDs never enter a SQL statement. Call `beginStream(hostId, streamId)` with the actual Twitch stream ID when available, then `has(hostId, userId)` and `observe(hostId, userId)`. A viewer becomes a regular only in a later stream. Without `beginStream`, a server process session acts as the stream boundary. These hashes are separate from rivalry aggregates and never appear in the graph.
