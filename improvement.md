# RaidRumble: review and improvement plan

**Reviewed:** Sat 31 Oct 2026, 22:00 CET. Branch `codex/authority` @ `b24ff3d`.
**Deadline:** Mon 2 Nov, 14:00 PST (23:00 CET), about 49 hours from this review.

## 1. Verdict

The build is **feature-complete against AGENTS.md (T1–T16 all done)** and of high engineering quality. The risk is no longer the code. It is three things:

- The **submission evidence**: video, Twitch footage, Codex footage.
- A **stale Devpost write-up**.
- A few **design choices that real streamers will notice**, above all an overlay that covers 94% of the stream.

Fix those and this is a strong top-5 contender.

### Independent verification (clean clone, Linux, Node 22.23)

| Check                                                | Result                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                     | ✅                                                                      |
| `pnpm test`                                          | ✅ 501 tests / 52 files                                                 |
| `pnpm lint` / `typecheck` / `format:check` / `build` | ✅ all pass                                                             |
| `pnpm sim -- --headless` × 4 scenarios               | ✅ normal ALLOW · stranger ESCALATE → grant · hate BLOCK · collab ALLOW |

This also shows the project runs on Node 22 and Linux, not only the pinned Node 20.20 on macOS.

---

## 2. P0: submission blockers (do these first)

| #    | Issue                                                                                                                                                                              | Why it matters                                                                                                                                                                     | Fix                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0‑1 | **The demo video is local simulation only.** `docs/demo.md` says so explicitly.                                                                                                    | The rules say the video _"should include footage that shows the Project functioning on Twitch."_ Stage 1 is pass/fail on fit, and Design/Impact are judged largely from the video. | Record a real session (see §2.1).                                                                                                                                                                                      |
| P0‑2 | **The Codex segment is a source/log presentation.** The Codex window couldn't be captured automatically.                                                                           | The rules also ask for _"footage that shows how the project was built with Codex,"_ and Codex use is 25% of the score.                                                             | Screen-record the Codex app yourself with QuickTime or OBS for 30–40s: scroll the build chat, show the parallel round sub-tasks, the AGENTS.md contract, and tests going green. Automation is blocked, but you aren't. |
| P0‑3 | **The default branch is stale.** `master` has only the first commit plus the PR #1 merge. PR #2 (`codex/authority`: hosted authority, live Twitch fixes, 501 tests) is not merged. | Judges open the default branch. They will miss the Decionis integration and the live fixes.                                                                                        | Merge PR #2 into `master`, and confirm the repo is public or shared with testing@devpost.com.                                                                                                                          |
| P0‑4 | **`devpost.md` is still the pre-build draft.** It's unchanged since commit `68d5ec1`.                                                                                              | Several claims don't match the build (§6). Rules: the project must _"function as depicted"_ in the description.                                                                    | Apply §6, fill the placeholders (501 tests, session ID `01a1930a-c3f4-7b53-b90a-a523ae252545`, repo and video URLs).                                                                                                   |
| P0‑5 | **The README links to ignored files.** `artifacts/demo.mp4`, `demo.srt`, `manifest.json` and `contact.jpg` are all in `.gitignore`.                                                | Broken links are the first thing a judge clicks.                                                                                                                                   | Commit 3–4 compressed screenshots to `docs/media/`, link the YouTube video, and drop the `artifacts/` links (§5).                                                                                                      |

### 2.1 Minimum viable "on Twitch" footage (about 1 hour)

1. Stream from your test channel with OBS, with the overlay added as a Browser Source.
2. Get 3–5 friends into chat.
3. **Best:** a second account that is live raids you. This shows the real `channel.raid`, the ESCALATE prompt, the Accept, and all three rounds driven by real chat.
4. **Fallback:** press **Launch test raid** while friends type real keywords. Label it "test raid, real chat."
5. Capture these four moments for the video:
   - chat typing → bar moving;
   - the ESCALATE prompt → Accept;
   - Fusion Boss defeated;
   - the Afterglow counter.

Real raids, Shared Chat across channels, shout-outs and Channel Points are untested live (`docs/verify.md`). Only claim in the video what you actually filmed.

---

## 3. Implementation completeness

| Feature                             | Status                         | Notes / gaps                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Siege                               | ✅ Done                        | Participation-rate scoring, 2s windows, rotating keyword, specials. **Gap:** home wins Siege in _every_ sim scenario, so the demo never shows a comeback (§7 E4).                                                                              |
| Know Your Host                      | ✅ Done                        | Sided questions, gated content, template fallback. **Gap:** weak distractors such as "Not shared" and "Something else" make answers guessable (§7 E7).                                                                                         |
| Fusion Boss                         | ✅ Done                        | Shared HP scaled to active players, weak points, GG celebration. **Gap:** generic names read "The Just Chatting Fortnite Guardian"; only the demo pair has a hand-written name (§7 E8).                                                        |
| Roster capture                      | ✅ Done                        | `/auth/raider`, in-memory only. Needs the raider to authorise beforehand. Say so in the Devpost text.                                                                                                                                          |
| Fallback heuristic                  | ✅ Done                        | Raid timestamp, salted regulars and the chatter delta.                                                                                                                                                                                         |
| Self-select                         | ✅ Done                        | `!join home` / `!join raiders`, locked after the first counted move.                                                                                                                                                                           |
| Bonus mode (Collab Rumble)          | ✅ Done (automated tests only) | Not exercised live across two channels.                                                                                                                                                                                                        |
| Rivalry ledger                      | ✅ Done                        | SQLite aggregates, rematch banner, dossier IDs, network map.                                                                                                                                                                                   |
| Afterglow                           | ✅ Done                        | Retention count persisted.                                                                                                                                                                                                                     |
| Policy before action                | ✅ Done                        | Local gate, Shadow Mode, single-use grants, Helix-write AST guard, hosted adapter verified with signed dossiers. **Gap:** the hosted path can't meet the 120 ms budget (observed 153–834 ms), so it always falls back on live actions (§7 E5). |
| Warlord page                        | ✅ Done                        | Login-bound, one Battering Ram per match.                                                                                                                                                                                                      |
| Channel Points Reinforcements       | ✅ Done (automated tests only) | Your test account isn't Affiliate, so this is unverifiable live. Keep it out of the video.                                                                                                                                                     |
| Mirror URL                          | ✅ Done                        |                                                                                                                                                                                                                                                |
| Live contributor pops during rounds | ❌ Not built                   | It was in the original design ("top contributors' names pop"). MVPs appear only on the end card (§7 E3).                                                                                                                                       |
| Sound                               | ❌ Not built                   | No audio cues. Optional (§7 E9).                                                                                                                                                                                                               |

---

## 4. User-facing copy review

**Overall:** the voice is strong and consistent ("A raid is just the beginning.", "The raid is over. The connection stays."). The fixes below are about clarity at the moments that matter and about consistency.

### 4.1 Global consistency

- **Spelling.** UK and US forms are mixed: _neighbours, levelled, flavour_ sit next to _center_ ("Command center"). Pick one. US is the safer default for Twitch and US judges: _neighbors, leveled, Command center_.
- **Feature-name casing.** Use title case everywhere: **Siege, Know Your Host, Fusion Boss, Collab Rumble, Boiling Oil, Battering Ram**. The dashboard currently shows "Know your host", "Fusion boss", "Collab rumble" and "Fire boiling oil".
- **The ↗ arrow means "opens elsewhere."** It currently appears on in-page actions: _Launch test raid ↗, Save preferences ↗, Let's rumble ↗, Create this reward ↗, FIRE BATTERING RAM ↗, 1. Connect host ↗_, and on "BUILT WITH CODEX ↗", which isn't even a link. Keep ↗ only on things that open a new tab (Open arena, Open approval, Open Warlord practice). Make "Built with Codex" a real link to the README's Codex section, or drop the arrow.
- **One tagline.** README and overlay say _"One raid. Three rounds. A reason to stay."_ The footer says _"Make every raid count."_ The Devpost pitch says something else again. Use the first as the headline everywhere and the second as the sign-off.

### 4.2 Dashboard

| Where                           | Current                                                                      | Suggested                                                                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar avatar                  | Hard-coded **"M"**                                                           | First letter of the connected channel; "▲" or the RR mark in practice mode.                                                                                                                                                                                                  |
| Setup status (`main.ts`)        | "Set TWITCH_* in .env to connect real channels."                             | "Live mode isn't set up on this server yet. See the README's _Go live_ section." Developer instructions don't belong in the streamer UI.                                                                                                                                     |
| Page order                      | "Stream setup" is the last section, but "Connect Twitch" sits in the top bar | When not connected, show a 3-step setup strip **under the hero** (Connect host → Connect bot → Copy OBS URL) and collapse it once complete.                                                                                                                                  |
| "2. Connect bot"                | No explanation                                                               | Add the hint "The account that posts in your chat. It can be your own."                                                                                                                                                                                                      |
| Approval prompt                 | "This community is new here. You have **10** seconds to decide."             | "**{RaiderName}** is raiding with **{viewers}** viewers. They aren't on your trusted list yet. Accept within **10**s." Add a checkbox, ☐ _Trust {RaiderName} next time_, that adds them to the allow-list. That closes the policy loop and makes a nice video moment.        |
| Decision rows                   | Raw reason codes lower-cased: "raider blocklisted"                           | Plain-English map: RAIDER_BLOCKLISTED → "On your blocked list"; RAIDER_ACCOUNT_TOO_NEW → "Account is less than 7 days old"; UNKNOWN_RAIDER → "Not on your trusted list: asked you"; RAID_FLOOD → "Too many raids from this channel this hour". Keep the code in the tooltip. |
| Decision rows                   | "Chat connection" (`events.subscribe`) listed among raid decisions           | Hide plumbing actions by default, or group them as "System" so the host sees raid, special and match decisions.                                                                                                                                                              |
| Badge                           | "0 RECENT DECISIONS" / "1 RECENT DECISIONS"                                  | Handle the plural: "1 RECENT DECISION".                                                                                                                                                                                                                                      |
| "Three facts about your stream" | Placeholder: "One short fact per line"                                       | Helper text: "Shown on stream as quiz answers in Know Your Host. Up to 3, keep them public-safe." This is a consent point as well as clarity.                                                                                                                                |
| Collab peer select              | "Channel 123456789"                                                          | Use the display name (it's available from the Shared Chat event and Get Users). The same applies to the rivalry map fallback "Channel {id}".                                                                                                                                 |
| Empty states                    | "Complete a match to make your first connection." on a 300px empty panel     | Fine copy, but shrink the empty panel or show a ghost example graph. Large empty boxes read as unfinished in screenshots.                                                                                                                                                    |

### 4.3 Overlay (the part judges see most)

| Where             | Current                                                                              | Suggested                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Siege footer      | "PARTICIPATION WINS. EVERY VIEWER COUNTS ONCE."                                      | It's not accurate: each viewer counts once _per 2 seconds_. Use **"IT'S NOT HOW MANY OF YOU. IT'S HOW MANY SHOW UP."** or "ONE MOVE EVERY 2 SECONDS. EVERYONE COUNTS." |
| Team-switch strip | "CHANGE TEAMS BEFORE YOUR FIRST MOVE"                                                | "WRONG TEAM? SWITCH BEFORE YOUR FIRST MOVE", followed by the existing `!join` hints.                                                                                   |
| Boss HP label     | "0 / 840 HP" in an older capture, beside "ONE SHARED BOSS"                           | Re-check the current build: when HP is 0 the label must switch to "BOSS DEFEATED". Show HP as a **depleting** full bar.                                                |
| Boss title        | The boss name collides with the boss's horns (`boss.jpg`)                            | Move the name above the art or shrink the horns. Verify in the current build.                                                                                          |
| End card (loss)   | "THE NEXT RAID IS A REMATCH." / "One arena. A new community. See you for round two." | Good. Add a **follow call-to-action** on both outcomes (§7 E2).                                                                                                        |
| Quiz              | "Your first answer counts. Meet the community on the other side."                    | Good.                                                                                                                                                                  |

### 4.4 Bot chat message (`services/stream.ts`)

Current:

> RaidRumble is on! Follow the overlay keyword. Warlord, your Battering Ram is ready: {url}

The incoming raiders have no idea what is happening. This one message is your onboarding. Suggested:

> ⚔️ RaidRumble! {Raider}'s Raiders ▲ vs {Host}'s Home Guard ●. 3 rounds, 3 minutes. Type the word on screen. Wrong team? !join raiders / !join home. @{Raider}, your Warlord controls: {url}

Check it fits the 500-character chat limit after names; it does with room to spare.

### 4.5 Warlord page

- After use, the button still reads "FIRE BATTERING RAM ↗" (dimmed). Change the label to **"RAM USED ✓"**.
- The headline "MAKE YOUR ENTRANCE." duplicates the overlay's idle screen. Use **"LEAD THE CHARGE."**, which is more Warlord-specific.

---

## 5. README review

### What's good

- It's accurate, honest about limits (local versus live, the hosted latency), and runnable in two commands.
- It has a clear "Policy before action" section, and the build-chat ID is present.

### Problems

1. **No visual above the fold.** Judges skim: a hero GIF or screenshot should be the first thing they see.
2. **Too dense for a first read.** The README is about 1,600 words of reference prose. Phrases like grant claims, receipts, "native source-channel chat", "per-channel salted hashes in a separate logical store" and "exact-path local redirect middleware" belong in the docs, not on the front page.
3. **Broken links** to ignored `artifacts/` files (P0‑5).
4. **Internal conventions in a user-facing doc.** "Authored source paths are checked for the 500-line limit and no hyphens" belongs in AGENTS.md or CONTRIBUTING.
5. **The Node requirement is over-specific.** "Use Node 20.20.0" should read "Node ≥ 20.19 (tested on 20.20 and 22)", which I verified.
6. **The Codex story is buried** in one paragraph near the end. It's 25% of the score.

### Proposed structure (copy-ready headings)

```
# RaidRumble
One raid. Three rounds. A reason to stay.
[hero GIF: Siege → Quiz → Boss, 6–8s]   ▶ 3-minute demo (YouTube)

Most raiders leave within minutes. RaidRumble turns the first three minutes
into a game both communities play — and only for raids the host welcomes.

## Try it in 60 seconds (no accounts)
pnpm i && pnpm dev   → open the dashboard, click Launch test raid
pnpm sim -- --scenario stranger-raid | hate-raid | collab

## How a rumble plays
Siege · Know Your Host · Fusion Boss · Afterglow   (one screenshot + 2 lines each)

## Who's on which team
4 layers in one table (Shared Chat → Roster → !join → heuristic)

## Policy before action
3 verdicts, Shadow Mode, single-use approvals, "no Twitch write without a verdict" test.
Local by default; Decionis hosted authority optional → docs/authority.md

## Built with Codex
One build chat (ID), AGENTS.md as the contract, three rounds generated as parallel
sub-tasks against one interface, tests first, 501 tests. → docs/codex.md, docs/parallel.json

## Go live on Twitch
5 numbered steps (current section, trimmed) → apps/server/src/live/README.md

## Docs
rounds.md · authority.md · verify.md · demo.md
```

Move the current "Content and privacy" detail and the long live-setup paragraphs into `docs/`. Keep one sentence each in the README.

---

## 6. `devpost.md`: corrections needed against the actual build

| Section              | Draft says                                         | Build reality → change to                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know Your Host       | "An LLM generates questions from those inputs"     | The model only _selects_ supplied facts and writes boss flavour. **Templates build the factual questions**, so the model can't invent facts about people. This is a stronger safety story.                                                                                                  |
| Policy               | "Each decision produces an Ed25519-signed dossier" | True when connected, and verified by account-backed probes. In live play the 120 ms budget forces an **unsigned local fallback**. Say: "verified signed dossiers and grant→claim→receipt with the hosted authority; live play currently uses the local gate within a 120 ms stream budget." |
| Policy               | Lists `events.subscribe` nowhere                   | Add it: even creating EventSub subscriptions goes through the gate. Judges like that rigour.                                                                                                                                                                                                |
| How we built it      | "`[[N]]` tests", "`[[session ID]]`"                | **501 tests / 52 files**; session `01a1930a-c3f4-7b53-b90a-a523ae252545`; three rounds built as **overlapping sub-agent tasks** (17:50:26–17:51:52 UTC, `docs/parallel.json`). That's the most concrete Codex evidence you have, so lead with it.                                           |
| How we built it      | Twitch CLI mock raids                              | The simulator drives the real server directly; check whether Twitch CLI was used, and remove it if not.                                                                                                                                                                                     |
| Built with           | includes `twitch-cli`                              | Same check. Add `better-sqlite3`, `canvas-2d`, `decionis-verify` if you want.                                                                                                                                                                                                               |
| Testing instructions | Local URLs and scenarios                           | Correct. Add the Warlord practice URL `http://localhost:5174/warlord/demo` and `pnpm sim -- --headless --json`.                                                                                                                                                                             |
| Accomplishments      | "[[First real raid result]]"                       | Only fill this from real footage (§2.1). Otherwise delete it; never use sim numbers.                                                                                                                                                                                                        |
| Video script         | Assumes real-stream footage throughout             | Rework around what you actually film. Keep labelled local shots for the policy BLOCK and collab scenarios.                                                                                                                                                                                  |
| Video length         | 2:55 plan                                          | The current local cut is 1:54. You have about 60s of headroom for real Twitch footage and a hand-recorded Codex segment.                                                                                                                                                                    |

---

## 7. Enhancements, ranked by judging impact ÷ effort

| #       | Enhancement                                                                                                                                                                                    | Criterion             | Effort   | Why                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1**  | **Overlay layout modes: _Full arena_ / _Lower third_ / _Side rail_** (dashboard setting, default Lower third)                                                                                  | Design, Impact        | M (3–4h) | The arena panel is 1800×980 at 94% opacity, so **the streamer's camera and game disappear for 3 minutes**. Streamers' reactions _are_ the content, and any judge who streams will spot this. A lower-third layout (keyword + tug bar + timer in the bottom ~30%, team names at top) keeps the face visible. |
| **E2**  | **Follow call-to-action on the end card and in the bot's closing message**: "▲ Raiders: follow {Host} · ● Home Guard: check out {Raider}"                                                      | Impact                | S (1h)   | It turns "retention" into the action that actually helps both streamers grow. It pairs with the existing shout-out.                                                                                                                                                                                         |
| **E3**  | **Live contributor pops** (gated display names, "+1 @name", top 3 streaks) during Siege and Boss                                                                                               | Design (fun to watch) | S–M (2h) | Viewers type to see their name on stream; it's the strongest participation loop on Twitch. The names already pass `content.render`.                                                                                                                                                                         |
| **E4**  | **Demo drama**: make the `normal` scenario a close Siege that Raiders win in the last 10s; keep the collab scenario home-favoured                                                              | Design, video         | S (1h)   | Every sim currently ends home / home / both. The video shows no tension and makes the visitors look like losers.                                                                                                                                                                                            |
| **E5**  | **Per-action latency budgets**: keep 120 ms for in-match actions; give `rumble.start` and `rewards.configure` ~1,500 ms, hidden behind a 1.5s "RAID INCOMING" intro sting                      | Tech, Innovation      | M (2–3h) | The hosted Decionis path (153–834 ms observed) then completes for real on match start, so **signed dossiers appear in live play**, not just in probes. That is the strongest "my stack" proof, and it's honest. Update AGENTS.md §4.1 first.                                                                |
| **E6**  | **Realistic hate-raid demo**: the `hate-raid` scenario currently blocks via **RAIDER_BLOCKLISTED**. Switch it to **RAIDER_ACCOUNT_TOO_NEW** or **RAID_FLOOD**                                  | Impact, Innovation    | XS (30m) | Hosts never know a hate raider in advance. Blocking an unknown 2-day-old account is the compelling safety moment.                                                                                                                                                                                           |
| **E7**  | **Better quiz distractors**: a small curated list of similar Twitch categories (e.g. Speedrunning ↔ Retro, Platformer), plus the other channel's value; drop "Not shared" and "Something else" | Design                | S (1–2h) | Makes Know Your Host feel like a real game rather than a gimme.                                                                                                                                                                                                                                             |
| **E8**  | **Boss name generator**: a category → adjective/noun table for the top ~40 Twitch categories, with fallback "The {Raider-cat} {Host-noun}". Remove the hard-coded `gardenRun` special case     | Innovation, Design    | S (1–2h) | Real pairs currently produce clunky names; the special case looks like demo-tuning if a judge reads the code.                                                                                                                                                                                               |
| **E9**  | **CC0 sound cues** (keyword change, gate hit, boss weak point, GG) with a dashboard mute toggle, off by default                                                                                | Design                | S (1–2h) | Big perceived-quality jump in the video. Keep it off by default so streamers opt in.                                                                                                                                                                                                                        |
| **E10** | **"Trust next time" on the approval prompt** (§4.2)                                                                                                                                            | Impact                | XS (30m) | Each accepted stranger becomes a friend, so the policy learns from the host. A good 3-second video beat.                                                                                                                                                                                                    |
| E11     | Dashboard first-run order and plain-English reason codes (§4.2)                                                                                                                                | Design                | S (1h)   |                                                                                                                                                                                                                                                                                                             |
| E12     | Copy consistency pass: spelling, casing, ↗ (§4.1)                                                                                                                                              | Design                | XS (30m) | Ideal as a single Codex task.                                                                                                                                                                                                                                                                               |

**Don't start now:** a Twitch Extension, raid trains, or a deployed hosted version. Mention them under "What's next".

---

## 8. Docs housekeeping (as one Codex task)

- `docs/demo.md`: remove _"T12's hosted decision-evaluation mapping remains unconfirmed"_, because `docs/authority.md` confirms it. Update the test counts (359/361 → 501), or label them as historical checkpoints.
- `docs/codex.md`: the T1 entry says "Final suite: 361". Mark it as "at that checkpoint".
- `AGENTS.md` §11/§12 are accurate. Add the E-items you take on as T17+ so the build log stays the single record.
- Add `docs/media/` (screenshots under ~200 KB each) and **un-ignore it**.
- After merging PR #2, delete the `codex/foundation` branch so judges don't land on an old README.

---

## 9. Suggested schedule to the deadline

| When (CET)        | Work                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Sat night**     | Merge PR #2 (P0‑3). Codex tasks: E12 copy pass, E6, E4, E2, the bot message (§4.4).                                 |
| **Sun morning**   | E1 lower-third layout, then E3 contributor pops.                                                                    |
| **Sun afternoon** | E5 per-action budgets (if a hosted signed dossier in live play is a goal), E10, E7/E8.                              |
| **Sun evening**   | **Record the real Twitch session** (§2.1) and the Codex screen recording (P0‑2).                                    |
| **Mon morning**   | Edit the video (<3:00, real footage first). README restructure (§5) with screenshots.                               |
| **Mon afternoon** | Finalise `devpost.md` (§6), paste into Devpost, upload the video, submit **by 20:00 CET** to leave a 3-hour buffer. |
