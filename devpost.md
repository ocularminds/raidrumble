# RaidRumble: Devpost submission (Codex x TwitchCon Hackathon)

> Working copy of every field on the Devpost form. Items in `[[double brackets]]` are placeholders to fill from the real build. **Before submitting, delete any feature line that did not ship.** The rules require the project to "function as depicted in the video and/or expressed in the text description."
>
> **Deadline:** Mon 2 Nov 2026, 14:00 PST (23:00 Stockholm).

---

## Form fields

**Project name:** RaidRumble

**Elevator pitch (≤200 chars):**
> Every Twitch raid becomes a 3-minute co-op showdown that gives raiders a reason to stay, with a policy gate so only welcome raids light up the arena.

**Built with:** typescript · node.js · fastify · twitch-eventsub · twitch-helix-api · twitch-cli · obs-browser-source · vite · canvas · sqlite · openai-api · decionis-agentsafe · openai-codex · vitest · pnpm

**Try it out:**
- Repo: `[[https://github.com/<you>/RaidRumble]]` (if private, share with testing@devpost.com)
- Judge mode, no Twitch account needed: `pnpm i && pnpm sim`

**Video (YouTube, public, <3:00):** `[[https://youtu.be/...]]`

**Codex session ID:** `[[paste the ID of the single Codex thread the project was built in]]`

---

## About the project

### Inspiration
Raids are Twitch's kindest feature, and they mostly fail at their purpose. A streamer hands their whole community to a friend, and within minutes most of those viewers are gone. The research is consistent: the first 30–60 seconds decide whether raiders stay, and the standard advice is a shout-out and a "please follow." We wanted to give raiders something to *do* in that window, and give both communities a reason to meet each other instead of passing through.

We also wanted to fix what makes raids scary. A hate raid can make an auto-triggered overlay part of the attack. So RaidRumble never acts on a streamer's channel until a policy has said yes.

### What it does
When a raid lands, RaidRumble turns the host's stream into a **3-minute, three-round arena** between the incoming **Raiders** (led by the raiding streamer, the *Warlord*) and the host's **Home Guard**.

**Round 1: Siege (60s, versus)**
- A tug-of-war gate. Chat types the keyword on screen, which rotates every 10 seconds.
- Each viewer counts once per 2 seconds, so spam and bots gain nothing.
- Force is measured by **participation rate, not headcount.** A 15-person engaged community can hold off a 300-person raid that mostly lurks.
- The Warlord fires a *Battering Ram* from their phone; the host answers with *Boiling Oil*.
- Channel Points *Reinforcements* let viewers commit harder.

**Round 2: Know Your Host (50s, bridging)**
- Four rapid A/B/C questions.
- Raiders score by answering questions about the host's stream; Home Guard scores by answering questions about the raider's stream.
- Questions are generated from both channels' live info and a few facts each streamer entered. Every generated line passes a content policy before it reaches the screen, with templates as a fallback.
- Two communities that met 90 seconds ago now know something about each other.

**Round 3: Fusion Boss (60s, co-op)**
- The teams merge against one boss, procedurally themed from both channels' categories (Speedrunning × Gardening gives *"The Speedrun Gardener"*).
- Boss HP scales with the combined active crowd, so any raid size is beatable.
- Both communities win, or lose, together. The end card crowns MVPs from both sides.

**After the match**
- **Afterglow widget:** for 5 minutes, a corner widget counts *raiders still here*. That number is RaidRumble's success metric.
- **Rivalry ledger:** every channel pair gets a persistent record. The next time they meet, the intro reads *"REMATCH · Raiders lead 2–1"*. A rivalry map shows the web of communities that have rumbled.

**Knowing who's on which team.** Twitch doesn't label raiders in chat, so RaidRumble resolves teams in four layers:
1. **Bonus mode, Collab Rumble:** in a Twitch Shared Chat session, every message carries its source channel, so attribution is exact. Planned collabs can start a rumble without a raid.
2. **Roster capture:** if the raiding streamer also uses RaidRumble, people who were chatting in their channel are recognised as Raiders the moment they arrive. The roster is held in memory only and discarded after the match.
3. **Self-select:** `!join raiders` / `!join home`, locked after your first counted move.
4. **Fallback heuristic:** first message after the raid timestamp, not a known regular (salted hashes), and appearing in the post-raid chatter delta.

Every assignment carries a confidence score, and viewers can correct their own.

**Policy before action (Decionis / AgentSafe).** Every action RaidRumble takes on a channel goes through one gate first: starting a match, posting in chat, showing generated text, firing a special, changing Channel Points rewards, sending a shout-out. The gate returns one of three verdicts:
- **ALLOW:** e.g. a raider the host follows or has rumbled before.
- **BLOCK:** e.g. a raider account days old, a blocklisted channel, or a raid flood.
- **ESCALATE:** the host gets a 10-second **"Accept the challenge?"** prompt. Their one click becomes a *single-use* grant, so it can't be replayed.

New installs run in **Shadow Mode**: the gate shows what it *would* have blocked before the host switches anything to enforce. When connected to the hosted Decionis authority, each decision produces an Ed25519-signed dossier that can be verified offline (`npx -y @decionis/verify`). The rivalry ledger references those dossier IDs, so every recorded match traces back to the decision that allowed it. Judges and anyone else can run the same policy file locally with no account.

### How we built it, with Codex at the centre
Codex built RaidRumble in a single thread (session ID above), driven by a repo-level **`AGENTS.md`**. That file is the contract Codex read before every task. It contains:
- the product spec;
- the pure `RoundModule` interface every round implements;
- the `PolicyGate` interface and a table of governed actions;
- a test definition of done;
- a numbered build order.

**What Codex did:**
- **Architecture to code.**
  - Codex scaffolded the pnpm monorepo: server, overlay, dashboard, and the engine, policy, twitch, content and ledger packages.
  - It then implemented each module against the interfaces in `AGENTS.md`.
  - Because rounds are pure, deterministic modules, adding a round was one file plus one registry line. Codex wrote Siege, Know Your Host and Fusion Boss as separate tasks, each with its own tests.
- **Test-first on the hard parts.** Codex wrote the tests before the code for:
  - attribution priority conflicts;
  - participation-rate fairness (300 lurkers vs 15 active);
  - per-user rate limiting;
  - every policy verdict path in both shadow and enforce modes;
  - single-use grants (a second claim is refused).

  `[[N]]` tests, all green.
- **A guardrail Codex can't forget.** Codex added a lint test that fails the build if any Twitch write call is made outside the policy executor. "Policy before action" is enforced by the test suite, not just by convention.
- **The judge-mode simulator.** Codex built `tools/sim`. It drives the real server through mock EventSub raids (Twitch CLI) and generates synthetic chat load across four scenarios: a friendly raid, a stranger raid (ESCALATE), a hate raid (BLOCK), and a Shared Chat collab. The same simulator powers the dashboard's *Test raid* button.
- **Build log.** After each task, Codex appended an entry to `docs/codex-log.md` (prompt, files touched, tests added). The video's build segment is drawn from that log.

`[[Optional: X of Y commits / ~Z% of lines authored in the Codex thread]]`

**Stack and integrations:**
- **Server:** Node + Fastify running an EventSub WebSocket client. It subscribes to `channel.raid`, `channel.chat.message`, `channel.shared_chat.*` and Channel Points redemptions.
- **Twitch Helix:** account age, channel info, follows, chatters, chat messages, shout-outs, and custom rewards.
- **Overlay:** a Vite/Canvas OBS browser source fed by 10 Hz view snapshots.
- **Ledger:** SQLite.
- **Content:** OpenAI API for questions and boss theming, with deterministic templates as fallback.
- **Policy:** Decionis AgentSafe for the gate (`POLICY_GATE=decionis`), with a local evaluator of the same policy file as the default.

*Disclosure:* Decionis is a pre-existing service built by the author. RaidRumble uses it as a third-party policy authority. All RaidRumble code was written during the submission period, and the default local policy gate needs no Decionis account.

### Challenges we ran into
- **Raiders aren't labelled.** Building trustworthy team attribution from partial signals (and making it fail gracefully) was the core engineering problem. Layering by confidence and letting viewers self-correct made it workable.
- **Raid sizes are wildly unequal.** Raw message counting turns every big raid into a stomp. Switching to participation-rate scoring with per-user rate limits made matches feel fair in both directions.
- **Raids can be weapons.** Automating a stream reaction to an event *other people* trigger needed a real consent model. The answer was the ALLOW / BLOCK / ESCALATE gate, single-use approvals, and Shadow Mode.
- **There is usually no second stream.** Raiders often end their stream when they raid. Rather than a split-screen that rarely exists, we made the arena live on the host's stream and gave the raiding streamer a phone controller.
- `[[add one real build challenge here]]`

### Accomplishments that we're proud of
- A raid becomes a shared moment that ends with **both communities winning together**, not a drive-by.
- **Fairness you can test:** small, engaged communities can win against huge raids.
- **Safety by construction:** the side-effect lint test means no code path can act on a channel without a verdict.
- **Judges can run all of it in one command,** with no Twitch account and no Decionis account.
- `[[First real raid result: e.g. "In our first live test raid, N of M raiders were still chatting at +5 min"]]`

### What we learned
- Raids already have the hard part (an audience arriving at once). What they lacked was a structure for the first minute.
- Designing for the *smaller* community first (fairness, consent) made the game better for everyone.
- `AGENTS.md`, together with pure interfaces and test-first tasks, let Codex add whole features in one pass without breaking existing ones.
- `[[one more real lesson]]`

### What's next for RaidRumble
- More round modules: the interface is already one file per round.
- Raid trains: rumbles chained across three or more channels, with the ledger tracking the whole chain.
- An opt-in rivalry leaderboard for streamer teams and communities.
- A Twitch Extension panel for viewers who prefer clicking to typing.
- A shared policy pack so hosts can import a trusted-raider list from their streamer team.

---

## Judging criteria map (use when tightening the write-up and video)

| Criterion (equal weight) | Our strongest evidence | Where judges see it |
|---|---|---|
| **Innovation / Idea** (also the tie-breaker) | Raids as a *game trigger* + a versus→bridging→co-op arc; four-layer raider attribution incl. Shared Chat; participation-rate fairness; policy-gated automation of events strangers trigger | Video 0:15–1:40; "What it does" |
| **Potential Impact** | Targets Twitch's known raid drop-off; the Afterglow *raiders still here* metric; rivalry ledger gives repeat use; consent gate protects small streamers | Inspiration; end card + Afterglow in video; retention number |
| **Technological implementation** (incl. Codex) | Pure deterministic engine, typed policy gate with single-use grants, side-effect lint test, simulator with 4 scenarios, `[[N]]` tests; built in one Codex thread from `AGENTS.md` | "How we built it"; video 1:40–2:30; repo; Codex session ID |
| **Design** (easy to use, fun to watch) | 2-minute setup (connect + one OBS URL); *what to type / who's winning / time left* readable in 1s; colour + shape teams; MVP pops; Test raid button | Video gameplay; screenshots |

---

## Testing instructions (paste into the "testing instructions" field)

```
Fastest path: no Twitch or Decionis account needed
1. Node 20+, pnpm 9+.  git clone <repo> && cd RaidRumble && pnpm i
2. pnpm dev        → open http://localhost:5173/overlay/demo (the overlay) and http://localhost:5174 (dashboard)
3. pnpm sim        → simulated 120-viewer raid, 300 synthetic raiders vs 20 home chatters; watch all three rounds
4. pnpm sim -- --scenario stranger-raid   → dashboard shows "Accept the challenge?" (ESCALATE). Click to start.
5. pnpm sim -- --scenario hate-raid       → BLOCK; nothing appears on the overlay; see reason codes in dashboard
6. pnpm sim -- --scenario collab          → Shared Chat attribution (exact team tags)
7. pnpm test       → full test suite

Live on Twitch
1. Create a Twitch app (dev.twitch.tv/console), set redirect URL to <PUBLIC_BASE_URL>/auth/callback
2. Copy .env.example → .env, fill TWITCH_* (and optionally OPENAI_*; templates are used without it)
3. pnpm dev, open the dashboard, Connect Twitch (host), Connect bot account
4. Add the overlay URL as an OBS Browser Source (1920x1080)
5. Have a friend raid you, or press "Test raid" in the dashboard

Optional: Decionis hosted policy
Set POLICY_GATE=decionis and DECIONIS_* vars; verify a dossier with: npx -y @decionis/verify <dossier.json>
```

---

## Demo video script (≤ 2:55, public on YouTube; CC0 audio only, no third-party logos)

| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:12 | Viewer count graph dropping after a raid | "Raids hand a whole community to another streamer, and most of them leave within minutes. The first minute decides it." |
| 0:12–0:22 | Raid lands; dashboard flashes *ESCALATE · Accept the challenge?*; host clicks | "RaidRumble turns that minute into a game. But only for raids the host wants: every action passes a policy gate first." |
| 0:22–0:55 | **Siege** on a real stream; friends in both chats; keyword rotates; Battering Ram from phone | "Round one, Siege. Type the keyword. Scored by participation rate, so a small, loud community can hold off a giant raid." |
| 0:55–1:15 | **Know Your Host** questions; reveal | "Round two: raiders answer questions about the host, the host's chat about the raider. Two communities, introduced." |
| 1:15–1:38 | **Fusion Boss** "The Speedrun Gardener"; both meters merge; MVPs; end card "REMATCH 2–1" | "Round three, both chats versus one boss built from both streams. Everyone wins together, and the rivalry is saved." |
| 1:38–1:48 | Afterglow widget "Raiders still here: `[[N]]`" | "And this number is the point: raiders still here five minutes later." |
| 1:48–2:30 | **Codex**: `AGENTS.md` scroll → Codex thread adding a round module → tests going green → side-effect lint test → `pnpm sim -- --scenario hate-raid` showing BLOCK | "Built entirely in one Codex thread. AGENTS.md is the contract: pure round modules, a typed policy gate, tests first. Codex even wrote the test that stops any Twitch write outside the policy executor." |
| 2:30–2:48 | Rivalry map; Collab Rumble via Shared Chat; Shadow Mode report | "Collab mode for Shared Chat, a rivalry map, and Shadow Mode so hosts see what would be blocked before enforcing anything." |
| 2:48–2:55 | Title card + repo | "RaidRumble. Make every raid count." |

**Filming notes**
- Use real accounts with friends chatting for the on-Twitch footage.
- Use the simulator only for clearly labelled local shots.
- Record the Codex segment from the actual build thread.

---

## Pre-submit checklist
- [ ] Every feature in "What it does" works in the build (delete lines that didn't ship)
- [ ] Video < 3:00, public on YouTube, shows it on Twitch **and** shows the Codex build
- [ ] Codex session ID pasted (the single build thread)
- [ ] Repo has README, `.env.example`, `AGENTS.md`, `docs/codex-log.md`, `policy/raidrumble.policy.yaml`; private repo shared with testing@devpost.com
- [ ] `pnpm i && pnpm sim` works on a clean clone
- [ ] All `[[placeholders]]` replaced or removed
- [ ] No secrets in repo; CC0/original assets only; no third-party trademarks in video beyond Twitch itself
- [ ] Note in description: *Decionis is a pre-existing service by the author used as a third-party policy authority; all RaidRumble code was written during the submission period; the local policy gate needs no Decionis account.*
