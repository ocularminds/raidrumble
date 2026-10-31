# Hosted authority

RaidRumble's adapter is mapped from the Decionis [OpenAPI 0.6.0 reference](https://docs.decionis.com/.well-known/openapi.json) and [decision-evaluation guide](https://docs.decionis.com/decision-evaluation). It does not deploy or edit organization policies. The host's local policy remains a prerequisite to hosted authorization.

## Configuration

Keep credentials in ignored `.env`:

```dotenv
POLICY_GATE=decionis
DECIONIS_API_BASE=https://api.decionis.com
DECIONIS_ORG_ID=your-organization-id
DECIONIS_API_KEY=your-runtime-key
DECIONIS_ENFORCE_API_KEY=your-enforcement-key
DECIONIS_MODE=SHADOW
```

`SHADOW` requests observational decisions. `ENFORCEMENT`, `enforce`, and the legacy deployment label `live` select enforcement. `PARALLEL` is rejected because it has no matching RaidRumble execution semantics. Saved per-host raid settings override the initial raid mode. Other actions keep their configured mode.

`DECIONIS_ENFORCE_API_KEY` needs `decision:enforce`; it is used for grants, claims, managed escalation status and receipts. The primary shadow key can use `decision:run` or the narrower `decision:shadow`; the latter is confined to the authority route. Dossier retrieval requires a key with the corresponding read scope, while the downloaded artifact can be verified independently. Policy-management keys never enter the adapter.

`DECIONIS_GATEWAY_URL` and an AgentSafe tenant key belong to a separately onboarded reverse proxy. They are not credentials or endpoints for this adapter. In particular, do not replace `DECIONIS_API_BASE` with a `decionisedge.com` proxy URL.

## Execution

| Step                                     | Verified API                                |
| ---------------------------------------- | ------------------------------------------- |
| Optional protocol shadow evaluation      | `POST /v1/protocol/evaluate-decision`       |
| Capture and bind authority               | `POST /v1/authority/grants`                 |
| Poll a managed hold                      | `GET /v1/authority/escalations/{id}`        |
| Claim once immediately before the effect | `POST /v1/authority/grants/{id}/claims`     |
| Finalize the outcome                     | `POST /v1/authority/grants/{id}/receipts`   |
| Retrieve a signed dossier                | `GET /v1/protocol/dossiers/{id}?org_id=...` |

Protocol outcomes `APPROVE`, `REJECT`, `ESCALATE`, and `REVIEW` map to `ALLOW`, `BLOCK`, `ESCALATE`, and `ESCALATE`. Observational decisions carry no execution grant. Enforcement requires an authoritative, eligible grant bound to the captured intent, followed by a validated claim.

The request preserves the original actor, channel, payload and idempotency key in a canonical, SHA-256-hashed Agent-Safe intent. Tokens remain private server state. Public overlays receive only the verdict, reason codes and audit identifiers. Host-only controls may receive an authority-provided approval link; no link or approval evidence is invented.

A local host approval does not count as hosted Presence evidence. A managed hold remains closed until the authority returns executable permission, and the original ten-second host deadline still applies. Polling never extends it. A successful effect followed by a failed receipt is reported as executed with a pending receipt; it must not be retried.

## Failure behavior

In-match actions keep a 120 ms allowance. The setup actions `rumble.start`, `rumble.start.collab`, `rewards.configure`, and `events.subscribe` can use up to 1,500 ms. The immediate grant claim must fit the remaining allowance captured at authorization; individual requests do not restart that clock. A valid human approval receives a fresh bounded claim window without extending the original host approval deadline. The overlay shows an authored **RAID INCOMING** notice while a start is checked.

Receipt finalization has a separate 120 ms bound. A pending receipt never hides an already started match or retries an executed effect. Timeouts and failures use the action's configured rule: hold a match start, fall back to authored content, skip chat/shoutouts, block specials/setup, or write a local unsigned ledger record. Replay refusals, invalid bindings and explicit authority blocks never become local permission.

An unavailable grant claim can fall back only for `ledger.settle`, before any effect was dispatched, and only when its configured failure rule is `LOCAL`. The separate local decision records the failed remote decision and dossier identifiers in its request. The settlement or retention write is flagged unsigned; an error after the effect never triggers this fallback.

## Verification

The pre-enhancement account-backed checks on 31 October 2026 confirmed:

- Primary runtime and enforcement credentials matched the configured organization. The primary key's `decision:run` scope also passed the default authority SHADOW route, with no execution grant.
- A protocol shadow evaluation returned an observational ALLOW dossier. Its two Ed25519 artifacts passed the official `@decionis/verify` 0.5.0 verifier with `DECIONIS_OFFICIAL` trust.
- An enforcement probe bound and claimed a grant for a unique, isolated in-memory ledger write. Exactly one write occurred, its receipt finalized, and a repeated claim was refused by the authority with HTTP 409.
- The enforcement dossier's three Ed25519 artifacts, including the execution binding, passed the official verifier with confirmed Decionis issuer authenticity.
- The actual production adapter retained its 120 ms cap and returned `POLICY_TIMEOUT` with `UNSIGNED_LEDGER_FALLBACK` instead of claiming a signed result.

That protocol probe used a separate five-second diagnostic timeout; production code at that checkpoint was unchanged. Observed authority requests took 153–834 ms, which motivated the current setup allowance. The signed evaluation identified the organization's existing `decionis-starter-v2+sitework-1` policy; RaidRumble-specific prerequisites are evaluated locally. Those checks prove the protocol and grant lifecycle, not that a separate RaidRumble policy has been deployed to the authority or that a real Twitch raid has been exercised.

### Start using the production allowance

At **21:59:57 UTC on 31 October**, the production `Room.raid` path started an isolated match with the real hosted authority and the configured **1,500 ms** allowance. There was no diagnostic timeout override. The overlay state changed from `incoming` to `active` at **1,475 ms**; authorization took 734 ms and the immediate claim took 717 ms. Optional content checks kept their 120 ms limits and used authored fallbacks.

The start returned decision `f09ea72f-aa7a-445d-8ba4-088c9231d99b` and dossier `ae940576-ae47-419a-a7a6-424a5bdb793f`. The official verifier checked all three Ed25519 artifacts, including the execution binding, and confirmed Decionis issuer authenticity. The separate receipt request timed out at 120 ms; the already started match remained active. A signed dossier proves the evaluation and binding, not observation of the effect or successful receipt finalization.

This run used fictional channel identities, no Twitch service and no persistent ledger. It verifies the real start path with hosted authority, not a real incoming Twitch raid. The narrow 25 ms margin also does not establish a latency guarantee for other environments. Slower starts still take the declared fallback. [Sanitized timing and signature evidence](hosted.json) is committed with the source.

Local evidence is in ignored `artifacts/decionis/`: the earlier credential/protocol reports, `start.json`, `startdossier.json`, and `startsignatures.txt`. Raw runtime credentials and grants are not committed. To verify a downloaded dossier:

```sh
npx -y @decionis/verify@0.5.0 --file path/to/dossier.json
```

Read both cryptographic validity and issuer authenticity in the verifier output. The application stores start/settlement dossier IDs in the rivalry ledger; local records are explicitly unsigned.
