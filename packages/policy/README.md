# Policy

`LocalPolicyGate` evaluates a small, validated YAML policy. New gates default to shadow mode. The recorded verdict is preserved in shadow mode; `PolicyExecutor` permits shadow effects while enforce mode requires ALLOW. Application hard limits and authentication remain the caller's responsibility in both modes.

```ts
const gate = new LocalPolicyGate(await loadPolicy('policy/raidrumble.policy.yaml'));
gate.setMode('rumble.start', 'enforce');
const decision = await gate.authorize(request);
const result = await new PolicyExecutor(gate).execute(decision, effect);
```

Every request includes `action`, `actor`, `channel: { hostId, raiderId? }`, `payload`, and optionally `matchId`. IDs and facts must come from authenticated server state, not browser input. Times are milliseconds from the gate's injected `now` clock.

| Action                | Payload                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rumble.start`        | `raiderLogin: string`, `raiderAccountAgeDays: number`, `raidViewers: number`, `raidsLastHour: number`, `hostFollowsRaider: boolean`, `hasPriorMatch: boolean`        |
| `rumble.start.collab` | `participants: { id: string, login: string }[]`, `sessionParticipantIds: string[]`; actor is the authenticated host                                                  |
| `content.render`      | `text: string`, `moderationFlagged?: boolean`; use only channel metadata, generated content or display names, never raw viewer messages                              |
| `chat.send`           | `text: string`, `templated: boolean`, `lastSentAt?: number`, `contentDecisionId?: string`; generated text must exactly match an ALLOW content decision for this host |
| `special.fire`        | `special: 'ram' \| 'oil'`, `budgetRemaining: number`; a `matchId` and exact authenticated role/identity are required                                                 |
| `rewards.configure`   | `write: HelixWrite` for HTTP execution; each setup request requires the host's approval                                                                              |
| `shoutout.send`       | `lastSentAt?: number` for the target raider; target ID is `channel.raiderId`                                                                                         |
| `ledger.settle`       | `startDecisionId?: string`; caller records both start and settlement decision/dossier IDs in the ledger                                                              |
| `events.subscribe`    | `subscription` is the exact EventSub POST body, `botUserId?: string`; actor identity must match the host or configured bot                                           |

`PolicyExecutor.executeHelix(decision, descriptor, { clientId, accessToken, fetch?, apiBase? })` is the only Helix write path. Descriptors are data: `{ method: 'POST' | 'PATCH' | 'DELETE', path, body?, query? }`. The executor checks the action, channel, and requested content before sending. Host APIs use the official Twitch origin; an optional loopback base supports local Twitch CLI mocks. Tokens are never recorded in receipts.

`approve(decisionId, hostId)` turns one outstanding ESCALATE into one ALLOW decision with a ten-second grant. Expired approvals, wrong hosts, second approvals, altered decisions, grants from another decision and concurrent replay are rejected. All issued decisions execute at most once, including ordinary ALLOW decisions. An effect error consumes the attempt and returns `EFFECT_FAILED`; it cannot retry behind the gate.

`getDecision`, `getRequest`, `listRecords` and `getConfig` return copies. `updateLists` and `setMode` change future decisions. Options `{ now?, id?, logger?, evaluate? }` support deterministic tests. Default logging is one JSON line per decision or approval, with no request payload. Records are unsigned, kept in memory with a 10,000-record cap, and emitted to the logger for durable collection by the server.

The latency budget is 120ms. Start failures ESCALATE, content failures request templates, chat/shoutout failures skip, special/reward/subscription failures BLOCK, and ledger failures allow an explicitly unsigned local settlement. `DecionisGate` currently exercises those defaults; it makes no unverified HTTP calls or signed-dossier claims until the API mapping is confirmed.

The AST boundary test catches direct Helix writes, write-helper imports, aliases, destructuring and raw write requests to the Helix URL outside `src/executor.ts`. This is an architecture check, not an arbitrary-code sandbox.

For a failed Twitch raid-fact lookup, preserve unavailable `raiderAccountAgeDays` or `hostFollowsRaider` as explicit `null` and set `factsUnavailable: true`. Known violations still BLOCK; otherwise `RAID_FACTS_UNAVAILABLE` escalates before trust-based ALLOW rules. Without the explicit flag, null, missing, and invalid values retain the normal error fallback.

Operational failure rules apply in shadow mode as well: a private issuance record identifies a timeout/error fallback, so the executor holds failed starts, skips failed chat/content effects, and only permits the declared unsigned local-ledger fallback. Ordinary would-block shadow decisions continue to execute. Host approval can release a held failed start with its single-use grant.

Shared Chat participant lists may include the host, who is implicitly trusted for their own action. Every other session participant must be represented and allow-listed for automatic approval; otherwise the action is held. A session containing only the host, an omitted visitor, or a selected raider outside the session is invalid.

For Reinforcements, `special.fire` also accepts `special: 'reinforcements'` with `rewardId`, `expectedRewardId`, `redemptionStatus: 'fulfilled'`, `redemptionId`, `redeemerId`, and `budgetRemaining`. The viewer actor must match the redeemer. These fields come from the authenticated EventSub handler and the channel's configured reward, never an HTTP redemption claim from a browser. A match-scoped `SpecialService` enforces the per-user and per-role hard caps even in shadow mode and supplies its own budget facts.
