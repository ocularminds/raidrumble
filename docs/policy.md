# Published RaidRumble policy

The dedicated Decionis policy is **raidrumble**, version **raidrumble-v1**, immutable bundle **60560d53-c1d1-4343-9e46-d2db525395e3**. It was published through `POST /v1/protocol/policies/bundles` on **1 November 2026 at 01:48:09 UTC**. Readback matched all 31 rules, and the two existing unnamed workspace policy payloads remained unchanged.

The Azure configuration pins the bundle and version:

```dotenv
DECIONIS_POLICY_ID=60560d53-c1d1-4343-9e46-d2db525395e3
DECIONIS_POLICY_VERSION=raidrumble-v1
```

The API also accepts the named selector `raidrumble`. Authority intents put `policy_id` and `policy_version` in `action.parameters` before computing the canonical intent hash. Direct protocol evaluations use top-level selectors and require the exact version. The adapter checks the returned policy version and intent binding; direct evaluation and dossier readback identify the resolved bundle UUID.

## What it governs

The 31 rules permit only the nine governed RaidRumble actions after their local host prerequisites pass. Local blocks remain blocks, unresolved local escalations remain held, and unknown application/action/result combinations cannot automatically execute. Reason-specific rules retain the meaning of the per-host checks, including raid trust and account age, content moderation, rate limits, special budgets, reward setup, shoutouts, ledger settlement and authenticated EventSub setup.

The app constructs a typed `context.raidrumble` assertion from its local evaluator and binds it into the hashed intent. Caller payloads cannot supply that assertion. Local host approval is recorded only through the existing authenticated, action-bound approval path. It is not Decionis Presence evidence and cannot release a managed hosted hold.

This is a composition of local per-host policy and hosted execution authority. The hosted policy consumes authenticated runtime assertions; it does not independently query Twitch or copy mutable host lists. The legacy policy DSL coerces scalar values and treats arrays as membership, so it is not a general JSON type validator. The application constructs the typed fields, and automatic execution requires known application, action, verdict and reason combinations.

## Hosted verification

All **20 synthetic cases** passed through `/v1/authority/grants` in **SHADOW** mode using the existing runtime credential. Both the name and UUID resolved to the published bundle for trusted, blocked, held and locally approved actions. Additional cases covered all nine governed actions, missing assertions, action mismatches, unknown reasons and the documented scalar-coercion behavior.

Each signed snapshot selected the exact bundle UUID, version and rules hash. The official `@decionis/verify` 0.5.0 package verified all **40 Ed25519 artifacts** against the production JWKS. These checks issued no execution grants or tokens, claimed no grants and performed no Twitch effects. The [public verification record](policy.json) includes decision and dossier IDs.

The diagnostic timeout was 5 seconds; measured round trips were 501–637 ms from the development Mac. This validates policy selection and decisions, not production latency or independent Twitch facts. Production retains its 120 ms in-match and 1,500 ms setup budgets. The direct protocol selector mapping is covered by contract-based unit tests; this live verification used the authority endpoint.

## Live Azure evaluation

The deployed app at [raids.decionis.com](https://raids.decionis.com) pins the bundle UUID and version above. Five real `events.subscribe` actions returned hosted enforcement ALLOW decisions, each resolving to the published rules hash. All five grants were claimed and their receipts finalized as **COMMITTED**. The official verifier checked **15 signed artifacts**, including each execution binding; [the read-only receipt check](live.json) records the decision/dossier IDs and its limits.

Twitch independently reported all five expected subscriptions ready, and the approved chat test reached the Azure server at **02:17:53 UTC on 1 November 2026**. This confirms incoming chat delivery. It does not claim a live raid from another streamer or independent Twitch confirmation of every executor receipt.

## Reproduce publication

Use the separate local `DECIONIS_POLICY_API_KEY` with policy read/write scopes, plus `DECIONIS_ORG_ID`. Keep that administration key out of the Azure app Secret and Terraform.

```sh
mkdir -p artifacts/deploy
node --env-file=.env --import tsx tools/deploy/policy.ts --publish
```

The [publisher](../tools/deploy/policy.ts) uses the [bundle builder](../tools/deploy/rules.ts). It checks inventory first, reuses an identical named bundle, refuses an unreviewed conflicting revision, verifies the publication receipt and readback, and checks that pre-existing policy payloads remain identical. Publication and the synthetic SHADOW evaluations do not claim grants or write to Twitch.

Contract reference: [Decionis OpenAPI 0.6.0](https://docs.decionis.com/.well-known/openapi.json), particularly protocol policy bundles, decision evaluation and authority grants. See [hosted authority](authority.md) for grant, claim and receipt semantics, and [Azure deployment](deploy.md) for the pinned runtime configuration.
