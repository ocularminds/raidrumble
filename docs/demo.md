# Demo and build evidence

The submission video is being refreshed with the enhanced overlay, public Twitch practice and genuine user-recorded Codex footage. **Final edit and publication are pending.** No public video URL is recorded yet. The current verification total is **609 tests across 71 files**; [verification](verify.md) records the checks and their limits.

## Confirmed evidence and labels

Account-backed checks confirmed host OAuth, separate bot OAuth, five enabled subscriptions and incoming `channel.chat.message` delivery. A public broadcast on **babafesti** then showed two **Test Raid · Real Chat** sessions driven by one account's messages entered through Twitch's chat UI. The broadcast combined an original labeled backdrop with the actual Lower Third OBS browser source. It showed the first session's loss and the second session's boss defeat and victory end card.

The hosted Decionis API mapping, signed dossiers and an earlier isolated grant → claim → finalized receipt lifecycle are confirmed; the old “wire unconfirmed” note is historical. A separate production-budget `Room.raid` probe became active at **1,475 ms** with signed evaluation and execution binding. Its receipt request timed out, so that probe does not establish finalization. It used fictional channels with no Twitch effect or ledger write. [Authority evidence](authority.md) gives the exact scope and timing.

The Twitch practice used the local gate, an explicitly fictional opposing community, and no automatic players, Twitch API announcements/shoutouts or real rivalry records. Retain **TEST RAID · REAL TWITCH CHAT** labeling throughout those shots. A captured **Afterglow 1** is a sample of the tagged account's recent chat activity, not a full five-minute retention result or evidence of retention lift. There was no actual incoming raid, second streamer, cross-channel Shared Chat or live Channel Points redemption. The test account is not Affiliate/Partner.

Reviewed public-player frames in ignored `artifacts/capture/twitchflow/` establish the outcomes:

| Source       | Observed evidence                                   |
| ------------ | --------------------------------------------------- |
| `000310.png` | First practice loss-style end card: “REMATCH SOON.” |
| `001260.png` | Second practice: “GG / BOSS DEFEATED,” 22:48:22 UTC |
| `001320.png` | Second practice victory end card, 22:48:29 UTC      |
| `001378.png` | Displayed Afterglow sample of 1                     |

The second victory belongs to continuous capture run `1036–1349`; it follows the COMBO input. The OBS source recording `2026-10-31 23-39-51.mov` is 553.533 seconds long. Privacy-safe review images are in `artifacts/twitchreview/`. These raw sources remain local; a final video must identify its selected intervals and any playback-speed changes.

## Genuine Codex build evidence

The three round tasks overlap from **17:50:26 to 17:51:52 UTC on October 31, 2026**. These are observed clock/Vitest checkpoints from the same build chat, recorded in [parallel.json](parallel.json) and [the build log](codex.md).

The later user recordings now provide genuine Codex-app footage. Reviewed derivatives in `artifacts/codexreview/` include:

- `contract.mp4`: 10 seconds showing `AGENTS.md` and the shared `RoundModule` interface.
- `working.mp4`: 10 seconds showing the same build chat's **3 working** subagent panel during the enhancement work.
- `done.mp4`: an optional 2.5-second completion view with pull-request attachments and **3 done**.

These clips have source hashes, selected intervals, privacy masks and reviewed proof frames in `provenance.json`. They show the contract and later parallel enhancement work; they do **not** depict the original 17:50 round-generation moment. No readable test-total report appeared in the reviewed Codex intervals, so use the separate verification report for the 609-test claim. Do not export unrelated portions of the original screen recordings.

The older build segment remains labeled as a source/log presentation. Automated Codex-window capture was unavailable at that historical checkpoint; no Codex UI footage was fabricated to fill the gap.

Build chat: `01a1930a-c3f4-7b53-b90a-a523ae252545`.

## Historical local export

The earlier verified local cut was **114.23 seconds**, **1920×1080**, **30fps**, H.264 with silent AAC, **3.23MB**. It contained running dashboard/OBS footage from the real simulator and plug-in engine, labeled **LOCAL SIMULATION**. It did not depict a real Twitch raid, measured live retention or a signed authority result.

That export combined a blocked local raid and a local host approval with a later recorded rematch. Gameplay ran at 2× logical time; capture gaps were cut and labeled. Its first gameplay frame was already 22 seconds into Siege. The rematch banner came from the local SQLite ledger. It was edited evidence from multiple runs, not an uninterrupted raid.

Its source/test card preserved a **359-test historical checkpoint**. A separate final run at that stage passed **361 tests**. The later live-integration checkpoint passed **501 tests in 52 files**. Those counts remain unchanged as historical evidence; the enhancement checkout now passes **609 tests across 71 files**.

The export included burned-in captions, an SRT sidecar, transcript, contact sheet and a manifest with source hashes. It used no synthetic narrator or copyrighted music. Those files remain local under ignored `artifacts/`; they are not working public download links and have not been uploaded by this task.

To recompose that historical export from its existing captures:

```sh
python3 tools/video/main.py
python3 tools/video/check.py
```

The historical recipe needs the captures in `artifacts/capture/`, macOS system fonts, Python with Pillow and FFmpeg. A fresh clone does not include those ignored captures. Current public-facing screenshots belong in `docs/media/`.

## Finish the enhanced edit

1. Lead with selected public Twitch-player footage that shows real chat driving the labeled practice. Keep the one-account scope clear.
2. Use separately labeled local simulation for the unfamiliar new-account block, timed approval, explicit trust and close Siege comeback. Current `docs/media/` screenshots show local UI over the original backdrop: Siege/quiz use Lower Third, the boss image uses optional Full Arena, and the dashboard shows local setup.
3. Include the genuine Codex contract and working-subagent clips. Identify `docs/parallel.json` as historical round-construction evidence rather than footage of that moment.
4. If using the hosted probe, label its report as recorded evidence from an isolated fictional match. Do not imply that the Twitch broadcast used hosted authority or that the timed-out receipt finalized.
5. Export under three minutes, review final frames/captions/audio, and record the source interval, scope and playback speed for every segment. Replace “publication pending” only after there is a real accessible video URL.

`tools/capture/{stage,serve}.py` prepares and serves the original test backdrop. The new `tools/video/cut.py` consumes an explicit local edit plan, labels footage scope and speed, and writes video, captions, transcript, contact sheet and a hash manifest. `tools/video/audit.py` checks the encoded output. With the selected local sources and a reviewed plan available:

```sh
python3 tools/video/cut.py path/to/edit.json --check
python3 tools/video/cut.py path/to/edit.json --output artifacts/submission
python3 tools/video/audit.py artifacts/submission.mp4
```

The cutter's format checks do not establish a shot's authenticity; the source review and declared scope do. T29/T30 stay open until the public source/media update, final video and Devpost submission are finished.

All rounds, controller labels and test totals shown in a final capture should match that recorded build. [Devpost copy](../devpost.md) must describe the same evidence.
