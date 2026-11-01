# RaidRumble: Devpost submission copy

This copy distinguishes implemented features from recorded evidence. The enhancement checkout passes 609 tests across 71 files. The final video is public with English captions, and the [Devpost project](https://devpost.com/software/raidrumble) is submitted to the Codex x TwitchCon Hackathon. Final source and evidence are tracked in [PR #3](https://github.com/ocularminds/raidrumble/pull/3).

## Form fields

**Project name:** RaidRumble

**Elevator pitch:** One raid. Three rounds. A reason to stay. RaidRumble turns welcomed Twitch raids into a three-minute chat showdown, with fair teams and policy checks before stream actions.

**Built with:** TypeScript · Node.js · Fastify · Twitch EventSub · Twitch Helix API · OBS Browser Source · Vite · Canvas 2D · SQLite · better-sqlite3 · OpenAI API · Decionis / AgentSafe · OpenAI Codex · Vitest · pnpm

**Public repository:** <https://github.com/ocularminds/raidrumble> (default branch: `master`)

**Submitted project:** <https://devpost.com/software/raidrumble>

**Try it:** `pnpm i`, then `pnpm dev`. Open <http://localhost:5174> and click **Launch Test Raid**. No account is required for judge mode.

**Demo video:** [RaidRumble — Test raid, real Twitch chat | Built with Codex](https://youtu.be/quotIlkegbI). Public, published November 1, 2026; 2:29 (149.333333 seconds), with English captions.

**Video materials:** [Captions](docs/media/video.srt) · [Transcript](docs/media/video.md) · [Contact sheet](docs/media/contact.jpg) · [Source provenance and audits](docs/video.json).

**Codex session ID:** `01a1930a-c3f4-7b53-b90a-a523ae252545`

## Inspiration

A Twitch raid brings a whole community into another streamer’s room, but arrival alone does not create a connection. We wanted to give newcomers something easy to do immediately, alongside the people already there.

We also wanted the host to stay in control. A raid is triggered by somebody else. Automatically turning that event into a stream takeover would make an unwelcome raid worse. RaidRumble combines a shared game with explicit rules about when it may act.

## What it does

RaidRumble turns an accepted raid into three minutes of play between **Raiders ▲** and **Home Guard ●**. Color is always paired with shape.

**Siege — 60 seconds.** Chat types the rotating keyword to move a tug-of-war gate. Each viewer counts once per two-second window. Force is normalized by active team size, so a small engaged community can resist a much larger, mostly lurking raid. The raiding streamer’s phone controls one **Battering Ram**; the host has one **Boiling Oil**.

**Know Your Host — 50 seconds.** Four A/B/C questions introduce the two streams. Raiders answer questions about the host; Home Guard answers questions about the visitors. Templates build factual questions from supplied channel information and up to three streamer-entered facts. An optional model selects those facts and writes fictional boss flavor; it cannot invent factual quiz answers. All resulting content passes policy, with authored fallbacks.

**Fusion Boss — 60 seconds.** Both teams attack one boss themed from their channel categories. They win or lose together. A ten-second end card celebrates both teams’ MVPs and invites Raiders to follow the host and Home Guard to discover the visitors.

**Afterglow** then counts tagged raiders who chatted within the last two minutes, for five minutes after play. It is a participation signal, not a concurrent viewer count or a measured retention improvement. The persistent **rivalry ledger** records channel-pair results, rematches, boss wins and decision identifiers, with a dashboard network map.

The OBS overlay defaults to **Lower Third**, keeping the main stream visible. Hosts can select **Side Rail** or **Full Arena**, reduce motion, and opt into original sound cues. Sound is off by default. Gated contributor names acknowledge counted moves during Siege and Fusion Boss.

## Knowing who is on which team

Twitch does not identify every raider in ordinary chat. RaidRumble uses four layers:

1. **Shared Chat:** the source channel provides exact attribution when available. Planned **Collab Rumble** sessions can start without a raid.
2. **Authorized roster:** if the raiding streamer connected beforehand, recent native chatters from that channel can be recognized. The temporary roster is held in memory and cleared after use.
3. **Self-select:** `!join raiders` or `!join home` can correct a roster or heuristic assignment before the first counted move. Shared Chat remains authoritative.
4. **Heuristic:** arrival time, per-host salted regular hashes and an available chatter snapshot supply fallback evidence.

Assignments retain their source and confidence. The approach admits uncertainty instead of presenting a heuristic as a Twitch-provided fact.

## Policy before action

Match starts, content rendering, specials, chat messages, shoutouts, reward setup and **EventSub subscription creation** pass the policy gate before execution.

**ALLOW** admits a trusted raid. **BLOCK** stops known rule violations, including an unfamiliar account younger than seven days. **ESCALATE** asks the host to decide within ten seconds. Approval is bound to that one action and claimed once. An unchecked **Trust next time** choice can add the accepted channel to the host’s list only after a successful start.

New live hosts begin in **Shadow Mode**, showing what would happen before enforcement is enabled. Operational failures still take the action’s safe fallback. The default local evaluator needs no Decionis account. An automated TypeScript source check guards the Twitch write boundary.

The hosted Decionis adapter has been verified against its published API: signed dossiers, bound execution grants, single-use claims, receipts and replay refusal. In-match checks retain a 120 ms budget; setup checks have a bounded 1.5-second allowance. A separate production `Room.raid` probe became active in **1,475 ms** using real hosted authorization and a claim, with no timeout override. Its signed evaluation and execution binding passed verification. The receipt request timed out after the match started, so this probe does not prove receipt finalization. It used fictional channels without Twitch effects or a persistent ledger; the observed 25 ms margin is not a general latency guarantee. Local fallbacks remain explicitly unsigned.

Eligible Affiliate/Partner hosts can explicitly approve a **100-point Reinforcements** reward. The current test account is not eligible, so this feature has mocked integration coverage rather than a live reward demonstration.

## How we built it with Codex

We built RaidRumble in **one Codex chat**, with `AGENTS.md` defining the product, interfaces, policy rules, coding conventions and test requirements.

The clearest parallel-build evidence is the round implementation wave: **Siege, Know Your Host and Fusion Boss were generated by overlapping sub-agent tasks between 17:50:26 and 17:51:52 UTC on October 31, 2026**. Each implemented the same `start / onInput / tick / result` lifecycle and serializable `view`, with state owned by the caller. The registry combines them without round-specific branches in the timeline. The recorded red/green checkpoints are in `docs/parallel.json` and `docs/codex.md`.

Codex scaffolded the monorepo, wrote tests for attribution conflicts, fairness, spam limits and policy replay, then built the server, overlay, dashboard and simulator. The simulator drives the real application directly and can also run headlessly; Twitch CLI is not required. The enhancement checkout now passes **609 tests across 71 files**, strict TypeScript, lint, production builds and four deterministic headless scenarios. The earlier **501 tests across 52 files** remain a historical checkpoint.

User-recorded Codex-app clips show the shared `RoundModule` contract and a panel with **three working subagents** during the enhancement work. These are genuine app captures, separate from the timestamped evidence of the earlier round-generation wave. The clips do not show a readable test-total report; the 609-test claim comes from the recorded verification run.

Live verification also produced a concrete engineering lesson: healthy Twitch keepalives can arrive just after their advertised interval. We added a bounded two-second grace period and regressions for healthy jitter, genuine silence and failed migrations, instead of disabling recovery.

_Disclosure:_ Decionis predates RaidRumble and is a service built by the author. RaidRumble integrates it as an optional policy authority; the local implementation remains fully usable without that service.

## What is verified

Confirmed checks include host OAuth, separate bot OAuth for the deliberately selected same-account test, five enabled EventSub subscriptions and incoming chat delivery. The public **babafesti** broadcast used an original, labeled backdrop and the real Lower Third OBS browser source. One account's messages entered through Twitch's chat UI drove two **Test Raid · Real Chat** sessions. The first ended in a loss; the second visibly defeated the Fusion Boss. The public Twitch player also showed an Afterglow sample of **1**.

Those sessions demonstrate the product running on Twitch with genuine chat transport. They used a fictional opposing team, no synthetic players, no automatic Twitch writes and no real rivalry-ledger records. The broadcast used the local policy gate. The published practice quiz shows an authored fallback, as labeled in its captions. It does not demonstrate a real incoming raid, a second streamer, cross-channel Shared Chat, bot announcements/shoutouts, Channel Points, a full five-minute retention measurement or retention lift.

Automated coverage exercises those integration paths, including Warlord identity, reward configuration, Shared Chat, persistence and Afterglow. Hosted authority was checked separately on isolated fictional matches. The earlier diagnostic lifecycle finalized a receipt and refused replay; the newer production-budget start verified the signed evaluation and binding while its receipt remained unconfirmed after timeout.

## What we learned and what is next

Designing for the smaller community improved both fairness and consent. Keeping rounds pure made parallel development practical. Separating recorded evidence from implementation coverage kept the submission honest.

Next steps are repeated streamer sessions to measure participation, more plug-in rounds, and an opt-in rivalry leaderboard. Raid trains and an Extension are future possibilities, not features in this submission. No hosted deployment is claimed.

## Testing instructions

1. Use Node ≥20.19 and the repository’s pinned pnpm. Clone <https://github.com/ocularminds/raidrumble>, enter the folder and run `pnpm i`.
2. Run `pnpm dev`. Open <http://localhost:5174>, then **Launch Test Raid**. **Open Arena** shows the overlay preview.
3. Try **A new challenger** for ESCALATE and explicit acceptance; **Unwelcome raid** for an unknown new account being blocked; and **Collab Rumble** for simulated exact team attribution.
4. During Siege, open <http://localhost:5174/warlord/demo> and use Battering Ram once. The host dashboard provides Boiling Oil.
5. Run `pnpm sim -- --headless --json` without a server for a fast deterministic match, and `pnpm test` for the current automated suite.
6. For actual Twitch setup, follow `apps/server/src/live/README.md`. For hosted authority setup and signed-artifact verification, follow `docs/authority.md`.

## Publication status

The [Devpost project](https://devpost.com/software/raidrumble) was submitted on November 1, 2026. Devpost confirmed **Project submitted!** and **SUBMITTED TO Codex x TwitchCon Hackathon**, with build session `01a1930a-c3f4-7b53-b90a-a523ae252545` saved. The reviewed 149.333333-second video is [public on YouTube](https://youtu.be/quotIlkegbI), with the supplied English SRT saved as its caption track and the approved Siege thumbnail. Final source and evidence are tracked in [PR #3](https://github.com/ocularminds/raidrumble/pull/3). The older 114-second local cut and its source/log segment remain historical evidence, with their original labels and test counts.
