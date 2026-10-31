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

The latency budget is 120ms. Start failures ESCALATE, content failures request templates, chat/shoutout failures skip, special/reward/subscription failures BLOCK, and ledger authorization failures allow an explicitly unsigned local settlement.

The AST boundary test catches direct Helix writes, write-helper imports, aliases, destructuring and raw write requests to the Helix URL outside `src/executor.ts`. This is an architecture check, not an arbitrary-code sandbox.

For a failed Twitch raid-fact lookup, preserve unavailable `raiderAccountAgeDays` or `hostFollowsRaider` as explicit `null` and set `factsUnavailable: true`. Known violations still BLOCK; otherwise `RAID_FACTS_UNAVAILABLE` escalates before trust-based ALLOW rules. Without the explicit flag, null, missing, and invalid values retain the normal error fallback.

Operational failure rules apply in shadow mode as well: a private issuance record identifies a timeout/error fallback, so the executor holds failed starts, skips failed chat/content effects, and only permits the declared unsigned local-ledger fallback. Ordinary would-block shadow decisions continue to execute. In the local gate, host approval can release a held failed start with its single-use grant. The hosted gate still requires remote authority after the local approval.

Shared Chat participant lists may include the host, who is implicitly trusted for their own action. Every other session participant must be represented and allow-listed for automatic approval; otherwise the action is held. A session containing only the host, an omitted visitor, or a selected raider outside the session is invalid.

For Reinforcements, `special.fire` also accepts `special: 'reinforcements'` with `rewardId`, `expectedRewardId`, `redemptionStatus: 'fulfilled'`, `redemptionId`, `redeemerId`, and `budgetRemaining`. The viewer actor must match the redeemer. These fields come from the authenticated EventSub handler and the channel's configured reward, never an HTTP redemption claim from a browser. A match-scoped `SpecialService` enforces the per-user and per-role hard caps even in shadow mode and supplies its own budget facts.

## Hosted Decionis

The adapter follows the public [OpenAPI 0.6.0 contract](https://docs.decionis.com/.well-known/openapi.json) and [decision evaluation reference](https://docs.decionis.com/decision-evaluation). Both gate implementations satisfy `ConfigurablePolicyGate`, including the existing configuration, decision lookup and activity methods.

```ts
const gate = new DecionisGate(config, {
  apiBase: 'https://api.decionis.com',
  apiKey: runtimeShadowKey,
  enforceApiKey: runtimeEnforcementKey,
  orgId: organizationId,
  shadowRoute: 'authority', // default; 'protocol' requires a compatible API key
});
```

`DecionisOptions` also accepts injected `fetch`, `now`, `id` (UUID generator) and `logger`. Effective mode comes from the local action configuration. An enforcement key does not change shadow mode. Missing `enforceApiKey` reuses the explicitly supplied runtime `apiKey`; no policy administration key is read. No environment variables are read by this package.

`DECIONIS_GATEWAY_URL` and `AGENTSAFE_TENANT_KEY` belong to a separately onboarded reverse proxy. They are not authority options. API keys use Bearer authentication; requests to AgentSafe proxy domains, credential-bearing URLs and insecure non-loopback origins are refused. Redirects are disabled.

Enforcement uses `POST /v1/authority/grants`. The adapter binds `agent-safe.intent/1`, the organization UUID, a new intent UUID, captured/expiry times, the actor, action, host resource, and full `{ channel, payload, matchId? }` parameters. `context.idempotency_key` and the `Idempotency-Key` header equal the intent UUID. The hash is SHA-256 over the contract's recursively key-sorted JSON binding. The mode and managed escalation request are outside that hash. Credentials never enter the binding.

The default shadow route uses the same binding but issues no grant. With `shadowRoute: 'protocol'`, shadow evaluations use `/v1/protocol/evaluate-decision`, `decision_type = request.action`, and `context = request`. `APPROVE`, `REJECT`, `ESCALATE` and `REVIEW` map to ALLOW, BLOCK and the two held outcomes. `evaluation_id` becomes the decision ID. The enforce route always uses authority grants, even when the shadow route is protocol.

Host-local BLOCK and ESCALATE results retain their local identity and normal mode behavior. An enforced local hold requires the authenticated host first. `approve(localDecisionId, hostId)` then asks hosted authority and may return a new decision ID. Hosted ESCALATE results stay held; `approve(remoteDecisionId, hostId)` performs one authenticated managed status lookup and returns the original held decision while pending. Only a matching `GRANT_READY` response supplies authority. Keep the original ten-second host deadline when the returned ID changes. A local host click is never submitted as Presence evidence. The documented managed API does not supply a human approval URL, so `Decision.approval` is absent; dossier links are never presented as approval links.

Every hosted enforcement ALLOW carries a private, exact-intent execution token, with only jti and expiry exposed in `Decision.grant`. The executor atomically claims it at `/v1/authority/grants/{jti}/claims` immediately before execution. It validates decision, dossier, tenant, actor, action, hash, expiry and lease binding. Helix requests are copied before any await and their dispatch timeout is bounded by the grant and claim lease.

The optional gate method `finalizeGrant(id, 'COMMITTED' | 'FAILED' | 'INDETERMINATE')` records an outcome at `/v1/authority/grants/{jti}/receipts`. Successful effects finalize COMMITTED. Thrown or aborted effects finalize INDETERMINATE and their decision remains consumed. A grant expiring between claim and dispatch finalizes FAILED. Failure to record a completed effect's receipt returns `{ executed: true, value, reason: 'RECEIPT_PENDING' }`; it never repeats the effect or reports it unexecuted. Bearer and claim tokens remain in private storage and are removed after finalization.

All authority calls are bounded by the configured budget, capped at 120ms, with no automatic request retries. Operational fallbacks stay local and unsigned, without invented dossier IDs. Hosted records preserve the service's IDs; cryptographic dossier verification is a separate operation. No policy is uploaded or deployed by the adapter: the organization must already have a policy that governs these action names and facts.

If a claim fails because of a network error, timeout or HTTP 5xx before the effect is dispatched, execution returns `GRANT_UNAVAILABLE`. A caller whose action explicitly declares `onFailure: LOCAL` may authorize a separate unsigned local ledger settlement, preserving the failed authority references and its match-ID deduplication. The executor does not perform that fallback automatically. Refused, malformed, expired or replayed grants return `GRANT_INVALID_OR_USED` and never authorize a fallback. The unavailable classification comes from private transport state, not caller-controlled decision fields.
