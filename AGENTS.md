# AGENTS.md: RaidRumble

> This file is the contract between the humans and Codex on this repo. Codex: read it fully before every task, follow it over any generic habit, and update the **Build log** section at the end of each task.

## 1. What we are building

**RaidRumble** turns a Twitch raid into a 3-minute, three-round live showdown between the incoming raiders and the host's community. It ends with both communities winning together.

- **Problem it solves:** most raided viewers leave within minutes because they have nothing to do. RaidRumble gives them something to do in the first 30–60 seconds, which is the window that decides whether they stay.
- **Safety principle:** every action RaidRumble takes on a streamer's channel passes a **policy-before-action gate** (Decionis / AgentSafe) _before_ it runs. A raid from a stranger never automatically takes over someone's stream.

**Hackathon:** Codex x TwitchCon (Devpost). Deadline **Mon 2 Nov 2026, 14:00 PST**. Judged equally on Innovation, Impact, Technical implementation (including use of Codex), and Design (easy to use, fun to watch).

**Hard rule:** this project is built _in one Codex thread_. Its session ID goes on the submission form, so keep the work in that thread and log every task in §12. The user explicitly authorises parallel sub-agents within this build thread; do not create separate user-owned chats. Record parallel round generation as demo evidence.

## 2. Product in one screen

```
Raid lands (EventSub channel.raid)
        │
        ▼
 ┌──────────────────────┐   BLOCK ──► plain raid, nothing happens on stream
 │ POLICY GATE           │   ESCALATE ► host gets 10s "Accept the challenge?" prompt
 │ action: rumble.start  │   ALLOW ───► arena starts
 └──────────────────────┘
        │
        ▼
 Team attribution: Shared Chat ▸ Roster capture ▸ Self-select ▸ Fallback heuristic
        │
        ▼
 Round 1 SIEGE (60s)  ─► Round 2 KNOW YOUR HOST (50s) ─► Round 3 FUSION BOSS (60s)
   raiders vs home          learn about each other        both chats vs one boss
        │
        ▼
 End card (10s) ─► Rivalry ledger updated ─► "Afterglow" widget (raiders still here at +5 min)
```

**Teams**

- **Raiders:** the incoming community, team colour orange, shape ▲. The raiding streamer is the **Warlord**.
- **Home Guard:** the host's community, team colour blue, shape ●.

Always pair colour with shape for colour-blind readability.

## 3. Features (all are in scope; see §11 for cut order)

### 3.1 Siege (Round 1, versus, 60s)

- A tug-of-war gate. Raiders push the gate; Home Guard holds it.
- **Input:**
  - The overlay shows a **rotating keyword** that changes every 10s (e.g. `PUSH`, `HOLD`, or a channel emote code).
  - Typing the current keyword counts as one input.
  - Each user is counted **at most once per 2s window**, so spam and copy-paste bots gain nothing.
- **Fairness: score by participation rate, not headcount.**
  - `teamForce = countedInputsInWindow / max(activeTeamMembers, FLOOR)`, with `FLOOR = 5`.
  - A 15-person engaged Home Guard can hold off a 300-person raid that mostly lurks.
- **Specials:**
  - **Warlord:** one _Battering Ram_ (2× force for 5s), fired from the Warlord phone page.
  - **Host:** one _Boiling Oil_ (−50% raider force for 5s), fired from the dashboard.
  - Both are capped and gated by policy (`special.fire`).
- **Channel Points (Affiliate/Partner channels only):** a _Reinforcements_ redemption gives the redeemer +1 weight for 10s. Cap: 1 per user per match.

### 3.2 Know Your Host (Round 2, bridging, 50s)

- Four rapid A/B/C questions, 10s each, with a reveal after each.
- **Question sides:**
  - Questions **about the host** are scored for Raiders, so the newcomers learn who they've landed with.
  - Questions **about the raider's stream** are scored for Home Guard, so the host's community learns about the visitors.
- **Question sources:**
  - Helix channel info for both channels (title, `game_name`, tags).
  - Up to 3 "facts about my stream" each streamer enters in the dashboard.
  - An LLM generates questions from those inputs only. No web lookups, no inventing facts about real people.
- **Gating and fallback:**
  - Every generated question passes the policy gate (`content.render`) before it reaches the screen.
  - If generation fails or is blocked, use deterministic templates, e.g. "What is {host} playing right now?"
- **Input:** type `A`, `B` or `C`. First answer per user counts. Points are normalised per team, as in Siege.

### 3.3 Fusion Boss (Round 3, co-op, 60s)

- Both teams fight **one shared boss**, themed procedurally from the two channels' categories. Example: _"The Speedrun Gardener"_ for Speedrunning × Gardening.
- **Boss name and flavour text:** LLM-generated, gated by `content.render`, with template fallback.
- **Boss HP** scales with combined active participants, so small and large raids are equally beatable.
- **Input:**
  - `!hit` damages the boss.
  - Every 10s a **weak point** keyword appears; it does 3× damage for 3s.
  - Per-user rate limit applies, as in Siege.
- **Outcome:** both communities win or lose together. The end card names the top 3 MVPs per team.

### 3.4 Team attribution (the hard technical problem)

Twitch does not label raiders in chat. We resolve each chatter's team using these layers, in priority order. Every assignment stores `{team, source, confidence}`.

| Priority | Layer                                       | How                                                                                                                                                                                                                                                                                                                                                          | Confidence |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1        | **Bonus mode: Collab Rumble (Shared Chat)** | During a Twitch Shared Chat session, `channel.chat.message` carries `source_broadcaster_user_id`, so the team is exact. Detect sessions via `channel.shared_chat.begin/update/end`. Can be started manually for planned collabs, without a raid.                                                                                                             | 1.0        |
| 2        | **Roster capture**                          | If the raiding streamer also authorised RaidRumble, the bot reads their chat. Users who chatted there in the last 30 min become `raiders` when the raid lands. The roster is held **in memory only** and discarded after the match.                                                                                                                          | 0.95       |
| 3        | **Self-select**                             | `!join raiders` / `!join home` (aliases `!join red`, `!join blue`). Before the first counted input, an explicit choice may correct roster or heuristic attribution (matching the required §9 conflict test). Shared Chat remains authoritative. **Locked** after the user's first counted input.                                                             | 0.9        |
| 4        | **Fallback heuristic**                      | Signals combined into a score: (a) first message in this host stream arrives after the raid timestamp; (b) user is not in the host's _regulars_ set (salted hashes of user IDs seen in previous host streams); (c) user appears in a `Get Chatters` delta snapshot (pre-raid vs post-raid), if the bot is a moderator. Score ≥ 0.6 → `raiders`, else `home`. | 0.5–0.8    |

**Display:** the overlay shows team membership, and a chatter can fix their own assignment with `!join`.

**Tests are mandatory for this module** (§9).

### 3.5 Rivalry ledger

- **Storage:** a persistent per-channel-pair record in SQLite.
- **Fields:** matches, wins per side, co-op boss kills, current streak, last match time, and the **dossier IDs** of the policy decisions that started and settled each match. This makes the ledger auditable.
- **Rematch banner:** when the same pair rumbles again, the intro shows a banner like "REMATCH · Raiders lead 2–1".
- **Network map:** a dashboard page shows which channels have rumbled with which (a force-directed graph).
- **Privacy:** store aggregates only, never per-viewer lists.

### 3.6 Afterglow widget

After the end card, a small corner widget shows **"Raiders still here: N"**: tagged raiders who chatted in the last 2 min. It runs for 5 minutes. The final number is recorded in the ledger as the match's **retention stat**.

### 3.7 Surfaces

- **Overlay:** an OBS browser source at 1920×1080 with a transparent background. Default **Lower Third** keeps the upper 70% of the stream visible; **Side Rail** and **Full Arena** are host-selectable. Readable from across a room: minimum 48px for keywords, 32px for names. Counted Siege/Boss inputs may show short-lived, gated contributor names. Original CC0 sound cues are opt-in and off by default.
- **Host dashboard:** connect Twitch, allow-list and blocklist, stream facts, the Accept prompt, the Boiling Oil button, Shadow Mode report, and the rivalry map.
- **Warlord phone page:** opened from a link the bot posts in chat. Requires Twitch login matching `from_broadcaster_user_id`. One big button per special.
- **Mirror URL (stretch):** if the raider stays live, their own overlay can show the same match read-only.

## 4. Policy before action (Decionis / AgentSafe)

**Rule for all code:** no Twitch write call, no on-screen generated content, and no match start may happen except through `gate.authorize(action)`. A lint test (§9) fails the build if `helix.post`, `helix.patch` or `helix.delete` is called from anywhere other than `packages/policy/src/executor.ts`.

### 4.1 Model (mirrors Decionis semantics)

- **Verdicts:** `ALLOW` | `BLOCK` | `ESCALATE`.
- **Every decision returns** `{ verdict, reasonCodes[], decisionId, dossierId?, grant? }`.
- **ESCALATE handling:**
  - The action is held for a named person (the host, or a moderator they named).
  - Their approval is bound to that one action. It produces a **single-use execution grant**, claimed immediately before execution. Replays are refused.
- **Shadow Mode (default for new installs):**
  - The gate evaluates and records, but does not block.
  - The dashboard shows a "would have blocked" report.
  - The host switches individual actions to enforce.
- **Latency budgets:** keep **120 ms** for in-match actions. The setup actions `rumble.start`, `rumble.start.collab`, `rewards.configure`, and `events.subscribe` may use a configured **1,500 ms** allowance so hosted authorization can complete. EventSub setup must complete before fresh live raids can arrive. Bind the allowance to the captured action and apply its remaining deadline to an immediate grant claim; a later valid human approval gets a fresh bounded claim allowance without extending the original approval deadline. Receipt finalization is bounded separately and must not delay or retry an executed effect. While authorizing a start, show a compact, authored **RAID INCOMING** state. On timeout or error, apply the action's `onFailure` rule (§4.3).
- **Receipts:** when the hosted Decionis authority is used, each decision yields an Ed25519-signed Decision Dossier, verifiable offline with `npx -y @decionis/verify`. The ledger stores the dossier IDs.

### 4.2 Gate implementations (`packages/policy`)

```ts
export type Verdict = 'ALLOW' | 'BLOCK' | 'ESCALATE';

export interface ActionRequest {
  action: ActionName; // see 4.3
  actor: { kind: 'system' | 'host' | 'warlord' | 'viewer' | 'llm'; twitchUserId?: string };
  channel: { hostId: string; raiderId?: string };
  payload: Record<string, unknown>; // minimal: no viewer message text, no PII beyond Twitch IDs
  matchId?: string;
}

export interface Decision {
  verdict: Verdict;
  reasonCodes: string[];
  decisionId: string;
  dossierId?: string;
  grant?: { id: string; expiresAt: number }; // local approval, or any hosted enforcement ALLOW
  approval?: { url: string; expiresAt: number }; // hosted managed approval, when available
  mode: 'shadow' | 'enforce';
  source: 'decionis' | 'local';
}

export interface PolicyGate {
  authorize(req: ActionRequest): Promise<Decision>;
  approve(decisionId: string, approverTwitchId: string): Promise<Decision>; // ESCALATE → grant
  claimGrant(grantId: string): Promise<boolean>; // single use
  finalizeGrant?(
    grantId: string,
    outcome: 'COMMITTED' | 'FAILED' | 'INDETERMINATE',
  ): Promise<boolean>;
}
```

- **`DecionisGate`:** uses `DECIONIS_API_BASE` (`https://api.decionis.com`) with the appropriately scoped runtime API key. `DECIONIS_GATEWAY_URL` is a separate onboarded reverse proxy, not an alternative authority API base; never send its tenant key to the authority API or send an authority key to the proxy.
  - The wire contract is confirmed from [Decision Evaluation](https://docs.decionis.com/decision-evaluation) and [OpenAPI 0.6.0](https://docs.decionis.com/.well-known/openapi.json). Keep its mapping in `packages/policy/src/decionis/mapping.ts` and cite the source in adapter documentation.
  - Shadow protocol evaluation uses `/v1/protocol/evaluate-decision` where the key permits it. Bound execution uses `/v1/authority/grants`, atomic `/grants/{id}/claims`, and `/grants/{id}/receipts`. Every hosted enforcement ALLOW requires its own live, matching grant and claim.
  - Host-local policy remains a prerequisite. A Twitch click can satisfy a local escalation; it cannot fabricate hosted approval evidence. Hosted holds stay closed until remotely verified managed approval returns executable authority. Expose an approved HTTPS approval link when available and keep the original host deadline.
  - Keep bearer execution/claim tokens private. Preserve hosted decision/dossier IDs; label operational fallbacks as local/unsigned. A receipt failure after the effect must never cause the effect to be retried or be reported as unexecuted.
  - Select the dedicated hosted policy explicitly with `DECIONIS_POLICY_ID` (named slug or immutable bundle UUID) and optional `DECIONIS_POLICY_VERSION`. Authority intents include `policy_id` and `policy_version` in `action.parameters` before canonical hashing; direct protocol evaluations use the documented top-level selectors. A version without an ID is invalid configuration. Publish named bundles through the API with the separate policy administration credential; publishing RaidRumble must not replace the unnamed workspace default.
  - The dedicated bundle composes with the local per-host rules through an internally constructed, typed and hashed `context.raidrumble` assertion: application, action, local verdict/reason codes and local host approval. Caller payloads cannot set these assertions. Absent/unknown assertion combinations and action mismatches cannot automatically execute; the legacy DSL coerces scalar values and array membership, so it is not a general JSON type validator. Local host approval is recorded only by the existing authenticated local approval path and is never Decionis Presence evidence; it cannot release a managed hosted hold. The hosted policy admits only the nine governed actions with satisfied local prerequisites; it consumes authenticated runtime assertions rather than independently querying Twitch.
- **`LocalPolicyGate`:** evaluates `policy/raidrumble.policy.yaml` in-process with identical semantics: shadow/enforce, ESCALATE and grants, reason codes. It writes unsigned local decision records.
  - This is what judges and CI use: **no Decionis account is required to run RaidRumble.**
- **`executor.ts`:** the only module allowed to perform side effects. Signature: `execute(decision, effect, canExecute?)`. It checks the verdict, claims the grant if present, then runs the effect and finalizes hosted authority. An optional trusted, synchronous `canExecute` predicate is checked after the claim immediately before dispatch; a false or throwing predicate cancels without an effect and finalizes the consumed grant as `FAILED`. This prevents session replacement during a claim from dispatching stale work. It supplements every existing verdict, binding, budget and grant check. Freeze the bound Helix descriptor before asynchronous work; uncertain effect outcomes finalize as `INDETERMINATE`.

### 4.3 Governed actions (initial policy)

| Action                | Triggered by                                                           | Rule (enforce mode)                                                                                                                                                                                                                                                                                           | onFailure                    |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `rumble.start`        | `channel.raid` received                                                | **ALLOW** if raider is on host allow-list, followed by host, or has a prior ledger entry with this host. **BLOCK** if raider is on blocklist, raider account < 7 days old, raid viewers < `minRaidSize`, or > 2 raids from same channel in 60 min. Otherwise **ESCALATE** to host (10s, timeout = no rumble). | ESCALATE                     |
| `rumble.start.collab` | Host starts Collab Rumble in Shared Chat                               | ALLOW for session participants; ESCALATE if a participant isn't on allow-list                                                                                                                                                                                                                                 | ESCALATE                     |
| `content.render`      | LLM output (questions, boss name/flavour) and display names on overlay | BLOCK if it matches the host's blocked terms or the moderation check flags it; ALLOW otherwise                                                                                                                                                                                                                | Use template                 |
| `chat.send`           | Bot posting in host chat                                               | ALLOW for templated messages within 1 msg / 5s. Generated text must have passed `content.render` first.                                                                                                                                                                                                       | Skip message                 |
| `special.fire`        | Warlord/host special or verified Reinforcements redemption             | ALLOW if actor matches role and has budget left (1 per match). Reinforcements additionally require a completed redemption of the configured reward for that channel. BLOCK otherwise.                                                                                                                         | BLOCK                        |
| `rewards.configure`   | Creating/updating Channel Points rewards                               | ESCALATE to host once at setup (it changes their channel config)                                                                                                                                                                                                                                              | BLOCK                        |
| `shoutout.send`       | End of match, host shouts out raider                                   | ALLOW if not sent to this raider in last 60 min (Twitch limit)                                                                                                                                                                                                                                                | Skip                         |
| `ledger.settle`       | Match result written                                                   | ALLOW; attach decisionIds of `rumble.start` + settle                                                                                                                                                                                                                                                          | Write locally, flag unsigned |
| `events.subscribe`    | Connected host/bot setting up EventSub                                 | ALLOW only for authenticated setup of the configured host and supported subscriptions; BLOCK otherwise                                                                                                                                                                                                        | BLOCK                        |

For `rumble.start`, explicitly unavailable required Twitch facts produce `ESCALATE` with `RAID_FACTS_UNAVAILABLE` before trust-based ALLOW rules; independently known blocklist, size, flood, or account-age violations still BLOCK, and unavailable values must not be invented as zero or false.

EventSub subscription creation is a Helix POST and uses the executor. OAuth credential exchange/refresh uses Twitch's identity endpoint, never mutates a channel, and is handled by the Twitch credential service; it must not log tokens.

### 4.4 Policy file sketch (`policy/raidrumble.policy.yaml`)

```yaml
version: 1
defaults: { mode: shadow, latencyBudgetMs: 120 }
lists:
  allow: [] # raider logins the host trusts
  block: [] # raider logins never allowed to trigger a rumble
  blockedTerms: [] # host-specific words never shown on stream
params:
  minRaidSize: 3
  minRaiderAccountAgeDays: 7
  maxRaidsPerChannelPerHour: 2
  escalateTimeoutMs: 10000
actions:
  rumble.start:
    block:
      - { when: 'raider in lists.block', reason: RAIDER_BLOCKLISTED }
      - {
          when: 'raider.accountAgeDays < params.minRaiderAccountAgeDays',
          reason: RAIDER_ACCOUNT_TOO_NEW,
        }
      - { when: 'raid.viewers < params.minRaidSize', reason: RAID_TOO_SMALL }
      - { when: 'raidsFrom(raider, 60m) > params.maxRaidsPerChannelPerHour', reason: RAID_FLOOD }
    allow:
      - { when: 'raider in lists.allow', reason: RAIDER_ALLOWLISTED }
      - { when: 'host.follows(raider)', reason: HOST_FOLLOWS_RAIDER }
      - { when: 'ledger.has(host, raider)', reason: KNOWN_RIVAL }
    otherwise:
      {
        verdict: ESCALATE,
        approver: host,
        timeoutMs: params.escalateTimeoutMs,
        reason: UNKNOWN_RAIDER,
      }
    onFailure: ESCALATE
```

Keep the rule language tiny: a fixed set of predicates implemented in TypeScript, **no `eval`**.

## 5. Architecture and stack

```
apps/
  server/      Node 20+, TypeScript, Fastify, EventSub WebSocket client, match runner, WS fan-out to overlays
  overlay/     Vite + TypeScript + Canvas 2D; OBS browser source; routes /overlay/:hostId and /mirror/:matchId
  dashboard/   Vite + TypeScript; host setup, Accept prompt, Shadow report, rivalry map; /warlord/:token page
packages/
  engine/      PURE game logic: match timeline, round modules, scoring, attribution. No I/O. Seeded RNG.
  policy/      PolicyGate interface, LocalPolicyGate, DecionisGate, executor
  twitch/      Thin Helix + EventSub wrappers (typed), token refresh
  content/     LLM question/boss generation + templates (always returns something renderable)
  ledger/      SQLite (better-sqlite3) rivalry ledger
tools/
  sim/         Raid simulator + fake chat load generator ("judge mode")
policy/
  raidrumble.policy.yaml
docs/
  codex.md         running log of Codex tasks (feeds the demo video)
```

- **Package manager:** pnpm workspaces.
- **Tests:** Vitest.
- **Lint and format:** ESLint + Prettier.
- **Overlay transport:** the server pushes `MatchView` snapshots over WebSocket at 10 Hz, and the overlay interpolates between them. The overlay never talks to Twitch directly.

### 5.1 Round module interface (`packages/engine`)

Every round is a pure, deterministic class implementing this interface, plus its own tests. The user's requested lifecycle uses `start` instead of `init`; `view` remains the serialisable overlay projection. State belongs to the caller, not mutable module instances. `id` is a string so adding a plug-in does not require changing a central identifier union.

```ts
export interface RoundModule<S> {
  readonly id: string;
  durationMs: number;
  start(ctx: MatchContext): S; // ctx includes seeded rng, teams, content pack
  onInput(state: S, input: PlayerInput, ctx: MatchContext): S; // input already attributed + rate-limited
  tick(state: S, dtMs: number, ctx: MatchContext): S;
  view(state: S): RoundView; // serialisable; what the overlay draws
  result(state: S): RoundResult; // { winner: 'raiders'|'home'|'both'|'none', mvps, stats }
}
```

Adding a new round means one new file and one registry line. No other changes.

### 5.2 Twitch integration

- **EventSub over WebSocket.** Subscriptions:
  - `channel.raid`, with condition `to_broadcaster_user_id = host`
  - `channel.chat.message` for the host, plus the raider when roster capture is authorised
  - `channel.shared_chat.begin`, `.update`, `.end`
  - `channel.channel_points_custom_reward_redemption.add`
- **Scopes:**

| Who                           | Scopes                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Bot account                   | `user:read:chat`, `user:write:chat`, `user:bot`                                                                           |
| Host                          | `channel:bot`, `user:read:follows`, `moderator:manage:shoutouts`, `moderator:read:chatters`, `channel:manage:redemptions` |
| Raider (optional, for roster) | `channel:bot`                                                                                                             |
| Warlord login                 | identity only                                                                                                             |

- **Helix endpoints used:**
  - Get Users (account age)
  - Get Channel Information
  - Get Followed Channels
  - Get Chatters
  - Send Chat Message
  - Send a Shoutout
  - Custom Rewards
- **No Extension.** Interactivity runs through chat, Channel Points, and web pages.

### 5.3 Environment (`.env.example`; never commit secrets)

```
TWITCH_CLIENT_ID=  TWITCH_CLIENT_SECRET=  TWITCH_BOT_USER_ID=  PUBLIC_BASE_URL=
TWITCH_AUTH_URL=             # optional exact registered callback URI
OPENAI_API_KEY=    OPENAI_MODEL=
POLICY_GATE=local            # local | decionis
DECIONIS_API_BASE=https://api.decionis.com
DECIONIS_ORG_ID=
DECIONIS_GATEWAY_URL=        # e.g. https://raidrumble.decionisedge.com
DECIONIS_API_KEY=
DECIONIS_ENFORCE_API_KEY=
DECIONIS_MODE=SHADOW         # SHADOW | ENFORCEMENT; legacy live maps to enforcement
DECIONIS_POLICY_ID=          # named policy or immutable published bundle UUID
DECIONIS_POLICY_VERSION=     # optional exact version; requires an ID
```

### 5.4 Hosted deployment

- Production serves the built dashboard, overlay, OAuth callback, API and WebSocket routes from one HTTPS origin. Development keeps the existing three-process commands.
- Azure deployment reuses the Central US `decionis-aks` cluster, `decionisacr` registry, `decionis-nginx` ingress and DNS-01 certificate issuer used by SwarmPay. Terraform owns only RaidRumble resources and its `raids.decionis.com` DNS record.
- Run one replica with a Recreate rollout and a persistent disk for the full data directory. Match state and Twitch/browser sessions remain in memory; a process restart requires reconnecting Twitch.
- The hosted anonymous preview is bounded, uses authored templates and the local gate, and grants temporary control to one browser. It cannot change shared settings or consume paid generation. Authenticated channel controls keep their existing identity checks.
- Runtime secrets are applied separately from Terraform and are never included in images, state, logs or source control. OAuth callback query strings must not enter ingress access logs.
- EventSub setup serializes each channel's authorization, claim, Twitch write and receipt. Host and bot subscriptions share that channel queue because the hosted authority can bind them to the same concurrency scope. Queue before authorization so each action keeps its own bounded setup allowance; never retry an ambiguous effect or weaken a claim check to resolve contention.

## 6. Commands (keep these working at all times)

```
pnpm i
pnpm dev              # server + overlay + dashboard
pnpm test             # all unit tests
pnpm sim              # judge mode: simulated raid + 300 fake raiders vs 20 home chatters, no Twitch account needed
pnpm sim -- --scenario stranger-raid   # shows ESCALATE flow
pnpm sim -- --scenario collab          # Shared Chat attribution
pnpm sim -- --scenario hate-raid       # shows BLOCK flow
twitch event websocket start-server    # Twitch CLI mock EventSub
twitch event trigger channel.raid --transport=websocket --to-user <hostId> --from-user <raiderId>   # check `twitch event trigger --help` for exact flags
```

## 7. Conventions

- TypeScript strict mode. No `any` in `packages/engine` or `packages/policy`.
- `engine` is pure: no `Date.now()`, no `Math.random()`, no I/O. Time and RNG come through `MatchContext`.
- Model domain concepts with typed objects and interfaces; use single-responsibility classes for rounds and services. Prefer pure functions for small calculations.
- Maximum 500 lines per authored source file. Short filenames and directories, with no hyphens: use `services/raid.ts`, never `raid-service.ts`.
- Required pnpm filenames (`pnpm-workspace.yaml`, generated `pnpm-lock.yaml`) are the tooling exceptions. The build log is `docs/codex.md` to honour the naming convention.
- Small files, named exports, no default exports (tool configuration may use its required export format).
- **Chat input sanitising:** viewer message text never reaches the overlay. Only keywords, answer letters, and gated display names do.
- Logging: one structured log line per policy decision, with `decisionId`, `action`, `verdict`, `reasonCodes`, `mode`.
- **Errors never crash a live match.** Degrade the round, keep the overlay alive.
- Assets: original or CC0 only. No copyrighted music or third-party logos, per hackathon rules.

## 8. Design rules (judged on "easy to use and fun to watch")

- **Glanceability:** at any moment the overlay answers three questions in under 1 second: _what do I type, who's winning, how long is left._
- **Visual language:**
  - Big rotating keyword centre-top.
  - Gate/boss centre.
  - Team meters left (Home Guard ●) and right (Raiders ▲).
  - Timer ring.
  - MVP name pops.
- **Motion and sound:** CC0 sound effects. Screen shake capped. Honour a `reducedMotion` flag set from the dashboard.
- **Onboarding:**
  - The host connects Twitch, then copies the overlay URL into OBS. Done in 2 minutes.
  - The dashboard shows a **Test raid** button that runs the simulator against the live overlay.

## 9. Testing (definition of done for every task)

- **Attribution:**
  - Each layer, plus priority conflicts (e.g. roster says raider, user `!join home` before first input → home; after first input → locked).
  - Shared Chat exactness.
- **Fairness:** 300 lurking raiders (5% active) vs 15 active home: home can win Siege. Equal participation rates: within ±5% of a draw.
- **Rate limiting:** a user spamming 50 messages per second counts once per 2s window.
- **Policy:**
  - Every row of §4.3, in both shadow and enforce modes.
  - ESCALATE → approve → grant claimed once; second claim refused.
  - Gate timeout → `onFailure`.
- **Side-effect lint:** test fails if Helix write helpers are imported outside `executor.ts`.
- **Content:** blocked term in generated text → template fallback is rendered.
- **Round modules:** determinism (same seed and inputs → same result), plus a snapshot of `view()` at fixed ticks.
- `pnpm test` must pass before a task is marked done.

## 10. How Codex should work on this repo

1. Read this file. Pick the next unchecked item in §11. Restate the plan in 3–6 bullets before editing.
2. Write or extend tests first for engine, attribution and policy work.
3. Keep changes scoped to the task. If a contract (§4.2 or §5.1) must change, change it here first and say why.
4. Run `pnpm test` (and `pnpm sim` for gameplay changes). Paste the summary in your reply.
5. Append one entry to **docs/codex.md**: the task, the prompt (short), files touched, tests added, anything surprising. This log becomes the "how we built it with Codex" part of the demo video.
6. Never add secrets, never call Twitch write endpoints outside the executor, never invent Decionis wire fields (§4.2).

## 11. Build order (cut from the bottom if time runs short)

- [x] **T1** Scaffold monorepo, tooling, `.env.example`, CI-free `pnpm test`
- [x] **T2** `packages/policy`: interface, LocalPolicyGate, YAML loader, executor, side-effect lint test
- [x] **T3** `packages/engine`: match timeline + attribution (all 4 layers) + rate limiter + tests
- [x] **T4** Siege round module + tests
- [x] **T5** `apps/server`: EventSub WS, raid → `rumble.start` gate → match runner → WS fan-out
- [x] **T6** `apps/overlay`: Siege view, timer, team meters, keyword, end card
- [x] **T7** `tools/sim` judge mode + scenarios (normal, stranger-raid, hate-raid, collab)
- [x] **T8** Dashboard: connect, allow/block lists, Accept prompt (ESCALATE), Shadow report
- [x] **T9** Fusion Boss module + content templates + overlay view
- [x] **T10** Know Your Host module + `packages/content` (LLM + templates + `content.render` gate)
- [x] **T11** Rivalry ledger + rematch banner + Afterglow widget/retention stat
- [x] **T12** DecionisGate adapter (behind `POLICY_GATE=decionis`) + dossier IDs in ledger
- [x] **T13** Warlord phone page + specials; Channel Points Reinforcements
- [x] **T14** Collab Rumble (Shared Chat bonus mode) start from dashboard
- [x] **T15** Rivalry network map; mirror URL
- [x] **T16** README with install, OBS setup, judge mode; polish pass on overlay readability
- [x] **T17 / E1** Lower Third default, Side Rail and Full Arena layouts with saved host preference
- [x] **T18 / E2** Follow calls-to-action on both end-card outcomes and the closing bot message
- [x] **T19 / E3** Gated live contributor feedback and top-three streaks during Siege and Boss
- [x] **T20 / E4** Deterministic last-ten-second Raider comeback in the normal demo
- [x] **T21 / E5** Per-action setup budgets, incoming-raid state and hosted start evidence
- [x] **T22 / E6** Unknown new-account raid blocked in the hate-raid demonstration
- [x] **T23 / E7** Plausible factual quiz distractors
- [x] **T24 / E8** General category-based boss names without a demo-only special case
- [x] **T25 / E9** Original CC0 sound cues, off by default, with dashboard control
- [x] **T26 / E10** Explicit trust-next-time selection tied to a successful host approval
- [x] **T27 / E11** First-run setup, meaningful names, readable policy activity and compact empty states
- [x] **T28 / E12** Consistent US copy, feature names, arrows and Warlord feedback
- [x] **T29** Current Devpost/README, committed media, accurate evidence and public default branch
- [x] **T30** Genuine Twitch/Codex capture, refreshed under-three-minute video and final submission package
- [x] **T31** Terraform deployment to Azure Central US at `raids.decionis.com`, with HTTPS, persistent storage and hosted verification
- [x] **T32** Publish a dedicated RaidRumble policy through the Decionis API and explicitly select its returned name/ID for evaluation

T1–T30 describe verified implementation and the submission release delivered through [PR #3](https://github.com/ocularminds/raidrumble/pull/3), which passed 609 tests across 71 files. T31/T32 add the live Azure deployment and named policy in [PR #4](https://github.com/ocularminds/raidrumble/pull/4); the current release passes 728 tests across 85 files. T12's wire mapping, signed dossiers and isolated grant/claim/receipt lifecycle are confirmed against the hosted authority. The later production-budget start verified a signed evaluation and binding, but its receipt request timed out. In-match actions retain the 120 ms budget; setup actions have the bounded allowance in §4.1. The public one-account Twitch practice, separate hosted probe and remaining live-raid checks are recorded in `docs/verify.md`. The final video and completed Devpost submission are linked in `docs/demo.md`; `docs/submission.json` records the exact build session ID and submission confirmation.

## 12. Build log (Codex appends a one-line summary here; details go in docs/codex.md)

- 2026-10-31 · T1: Scaffolded pnpm workspaces, strict TypeScript, Vitest, ESLint/Prettier, env template and source-convention checks.
- 2026-10-31 · T2: Built the local YAML policy gate, shadow/enforce semantics, single-use grants, timeout rules, executor and Helix boundary checks.
- 2026-10-31 · T3: Built the pure plug-in timeline, all attribution layers, seeded RNG and counted-input rate limiter; reconciled pre-input self-selection.
- 2026-10-31 · T4/T9/T10: Generated Siege, Fusion Boss and Know Your Host concurrently in this chat; 60 round tests, gated content and template fallbacks.
- 2026-10-31 · T5/T6: Connected typed EventSub/OAuth adapters to the match runner and 10 Hz WebSocket Canvas overlay, with fault isolation and authenticated live controls.
- 2026-10-31 · T7/T8: Added four judge scenarios, host dashboard, preferences, 10-second approvals and policy activity; all scenarios verified locally.
- 2026-10-31 · T11/T15: Added SQLite pair aggregates/receipts, rematches, persistent retention, salted regular hashes, rivalry graph and read-only mirror.
- 2026-10-31 · T13/T14: Added Warlord/host specials, verified redemption budgets, explicit reward setup approval and Shared Chat collab controls.
- 2026-10-31 · Historical T12 boundary checkpoint: T12 remained open; dossier fields and adapter boundary existed, and no hosted wire format or signed receipts were invented.
- 2026-10-31 · Historical integration checkpoint: 361 tests across 41 files passed; included unknown-fact failover, stale approvals, identity, replay, shutdown persistence, repeatable stranger demos and source conventions.
- 2026-10-31 · T16: Completed README/round guide, multiline quiz choices, boss celebration, mobile verification and a verified 114-second local demo with real parallel-build evidence; lint, typecheck, build, formatting and all four simulations pass.
- 2026-10-31 · Checkpoint: Prepared the verified local implementation for a commit and PR at the user's request; excluded credentials, runtime data and local captures before starting hosted integration work.
- 2026-10-31 · T12: Confirmed OpenAPI mapping, signed dossiers and one-use hosted grants/claims/receipts; preserved managed holds and unsigned ledger fallback. The real 120 ms adapter correctly times out on observed 153–834 ms round trips.
- 2026-10-31 · Historical hosted/Twitch checkpoint: Parallel policy, OAuth/readiness and persistence work passed 497 tests in 52 files, lint, typecheck, production builds, formatting and all four judge scenarios; first PR merged, follow-up moved to `codex/authority`.
- 2026-10-31 · Historical Twitch connection checkpoint: Host/bot OAuth, five enabled EventSub subscriptions and one real incoming chat event confirmed; four keepalive regressions brought that checkpoint to 501 passing tests in 52 files, documented in PR #2.
- 2026-10-31 · T17/E1: Added saved Lower Third, Side Rail and Full Arena layouts; compact geometry and readability checked in tests and actual UI captures.
- 2026-10-31 · T18/E2: Added mutual follow invitations to both end-card outcomes and bounded closing bot messages.
- 2026-10-31 · T19/E3: Added gated counted-input contributor pops and top-three streaks in Siege/Boss, with expiry and round-boundary tests.
- 2026-10-31 · T20/E4: Made the normal local demo a deterministic last-ten-second Raider comeback while retaining the home-favored collab scenario.
- 2026-10-31 · T21/E5: Added captured setup/claim budgets and incoming state; isolated hosted Room.raid became active at 1,475 ms with verified signed binding, while receipt finalization remained unconfirmed after timeout.
- 2026-10-31 · T22/E6: Changed the local hate-raid demonstration to an unfamiliar two-day-old account blocked by RAIDER_ACCOUNT_TOO_NEW.
- 2026-10-31 · T23/E7: Added plausible curated category distractors while preserving factual, supplied-data question construction and authored fallbacks.
- 2026-10-31 · T24/E8: Replaced the demo-specific boss name with general category-based composition and deterministic fallback tests.
- 2026-10-31 · T25/E9: Added original CC0 sound cues with deduplication, a saved opt-in toggle and sound off by default.
- 2026-10-31 · T26/E10: Added unchecked trust-next-time selection, persisted only after successful host approval, with expiry, replay and concurrent-edit protection.
- 2026-10-31 · T27/E11: Added first-run setup, safely gated Shared Chat names, readable policy activity and compact empty states.
- 2026-10-31 · T28/E12: Standardized US copy, feature names, action arrows and used-state Warlord feedback.
- 2026-10-31 · Final enhancement validation: 609 tests across 71 files, lint, strict TypeScript, production builds and four headless scenarios passed; staging regressions closed the short-claim-lease gap without retrying effects.
- 2026-10-31 · T29/T30 progress: Captured two public babafesti Test Raid Real Chat sessions using one account, with a loss then boss victory and an Afterglow sample of 1; genuine Codex clips show the contract and later parallel enhancement work. Documentation reflects those limits; final video/publication/submission remain open.
- 2026-11-01 · T29/T30 publication checkpoint: Published the reviewed 149.33-second video with English captions and the Siege thumbnail; added public transcript, contact sheet, provenance and verification records. Devpost story, video and four captioned screenshots are saved; final eligibility/submission and the default-branch merge remain open. The final rerun passes 609 tests across 71 files.
- 2026-11-01 · T29/T30: Devpost confirmed “Project submitted!” after the user's eligibility and terms confirmations. The submitted entry uses session `01a1930a-c3f4-7b53-b90a-a523ae252545`; the public video, four screenshots, accurate documentation and final release bundle are recorded through PR #3. All twelve enhancements are complete; 609 tests across 71 files and formatting pass.
- 2026-11-01 · T31 preparation: Added production static hosting, bounded public preview/WebSockets and OAuth sessions, a Linux image and scoped Azure Terraform. 654 tests across 78 files, build/typecheck, lint, formatting and all four simulations pass; deployment verification remains in progress.

- 2026-11-01 · T31/T32 integration checkpoint: Published named policy `raidrumble` / `raidrumble-v1`; 20 synthetic hosted cases and 40 signed artifacts verified. Added bound selectors, serialized EventSub setup and stale-policy/session guards; 728 tests across 85 files and all release checks pass. Final image rollout and Twitch delivery verification remain in progress.

- 2026-11-01 · T31/T32: Deployed source `4041221` to Azure Central US at `raids.decionis.com` with the published policy UUID/version pinned. Five Twitch subscriptions are ready, all five setup claims have committed receipts with 15 verified signed artifacts, and one approved chat message reached Azure. Terraform reports no drift; 728 tests across 85 files and all release checks pass.
