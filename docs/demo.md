# Demo and build evidence

Watch [RaidRumble — Test raid, real Twitch chat | Built with Codex](https://youtu.be/quotIlkegbI). The final video was published publicly on **November 1, 2026**, with English captions and the approved [Siege thumbnail](media/siege.jpg). It combines the enhanced overlay, public Twitch practice and genuine user-recorded Codex footage. The current verification total is **609 tests across 71 files**; [verification](verify.md) records the checks and their limits.

The uploaded MP4 is **149.333333 seconds**, **1920×1080 at 30 fps**, H.264/AAC, **5,028,385 bytes**. Its SHA-256 is `08e13f8357db47268a24326cbdd1b9d1da62ec0668381e075589c95ff5bc6f67`; this identifies the uploaded file, not YouTube's transcoded copies.

[English SRT](media/video.srt) · [Transcript and evidence scopes](media/video.md) · [Contact sheet](media/contact.jpg) · [Shot provenance and audits](video.json)

## Confirmed evidence and labels

Account-backed checks confirmed host OAuth, separate bot OAuth, five enabled subscriptions and incoming `channel.chat.message` delivery. A public broadcast on **babafesti** then showed two **Test Raid · Real Chat** sessions driven by one account's messages entered through Twitch's chat UI. The broadcast combined an original labeled backdrop with the actual Lower Third OBS browser source. It showed the first session's loss and the second session's boss defeat and victory end card.

The hosted Decionis API mapping, signed dossiers and an earlier isolated grant → claim → finalized receipt lifecycle are confirmed; the old “wire unconfirmed” note is historical. A separate production-budget `Room.raid` probe became active at **1,475 ms** with signed evaluation and execution binding. Its receipt request timed out, so that probe does not establish finalization. It used fictional channels with no Twitch effect or ledger write. [Authority evidence](authority.md) gives the exact scope and timing.

The Twitch practice used the local gate, an explicitly fictional opposing community, and no automatic players, Twitch API announcements/shoutouts or real rivalry records. The final edit retains **TEST RAID · REAL TWITCH CHAT** labeling throughout those shots and identifies the captured quiz as an authored fallback. A captured **Afterglow 1** is a sample of the tagged account's recent chat activity, not a full five-minute retention result or evidence of retention lift. There was no actual incoming raid, second streamer, cross-channel Shared Chat or live Channel Points redemption. The test account is not Affiliate/Partner.

Reviewed public-player frames in ignored `artifacts/capture/twitchflow/` establish the outcomes:

| Source       | Observed evidence                                   |
| ------------ | --------------------------------------------------- |
| `000310.png` | First practice loss-style end card: “REMATCH SOON.” |
| `001260.png` | Second practice: “GG / BOSS DEFEATED,” 22:48:22 UTC |
| `001320.png` | Second practice victory end card, 22:48:29 UTC      |
| `001378.png` | Displayed Afterglow sample of 1                     |

The second victory belongs to continuous capture run `1036–1349`; it follows the COMBO input. The OBS source recording `2026-10-31 23-39-51.mov` is 553.533 seconds long. Privacy-safe review images are in `artifacts/twitchreview/`. These raw sources remain local; the public [provenance record](video.json) identifies each selected source interval, hash and playback speed.

## Genuine Codex build evidence

The three round tasks overlap from **17:50:26 to 17:51:52 UTC on October 31, 2026**. These are observed clock/Vitest checkpoints from the same build chat, recorded in [parallel.json](parallel.json) and [the build log](codex.md).

The later user recordings now provide genuine Codex-app footage. Reviewed derivatives in `artifacts/codexreview/` include:

- `contract.mp4`: 10 seconds showing `AGENTS.md` and the shared `RoundModule` interface.
- `working.mp4`: 10 seconds showing the same build chat's **3 working** subagent panel during the enhancement work.
- `done.mp4`: a reviewed 2.5-second completion view with pull-request attachments and **3 done**, omitted from the published edit.

These clips have source hashes, selected intervals, privacy masks and reviewed proof frames in `provenance.json`. They show the contract and later parallel enhancement work; they do **not** depict the original 17:50 round-generation moment. No readable test-total report appeared in the reviewed Codex intervals. The final edit presents the 609-test result as a separate evidence card, backed by the [verification record](checks.json). Unrelated portions of the original recordings are omitted.

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

## Finished edit and review

The 16-shot edit opens with the public Twitch player and matching OBS source, then intercuts a labeled local comeback with the real-chat quiz, boss defeat and Afterglow. Local policy close-ups show successful acceptance with **Trust next time** already selected, followed by a separate new-account BLOCK. They do not claim to show the checkbox click itself.

The hosted probe appears as a labeled still summary. Genuine Codex contract and working-subagent clips follow, with separate still summaries of the original round-task records and the 609-test checkpoint. Optional Full Arena and local launch footage close the video. The [transcript](media/video.md) records every caption and its evidence scope.

All selected clips play at **1×**. Public-player and dashboard sequences follow their recorded screenshot timestamps, with gaps above one second cut and no interpolation. OBS excerpts retain original cue audio; Codex excerpts and evidence cards are silent. No narration or music was added.

The recorded review decoded **4,480 frames** and visually inspected **48 first/middle/last frames across all 16 shots**. Format, cue timing, source preservation and audio checks passed, with no detected black frames or clipping. [The audit record](video.json) includes the source-report hashes. These technical checks complement the source review; they do not establish a shot's authenticity by themselves.

`tools/capture/{stage,serve}.py` prepares and serves the original test backdrop. `tools/video/cut.py` consumes an explicit local edit plan, labels footage scope and speed, and writes video, captions, transcript, contact sheet and a hash manifest. `tools/video/audit.py` checks the encoded output. To reproduce an edit from retained local sources and its reviewed plan:

```sh
python3 tools/video/cut.py path/to/edit.json --check
python3 tools/video/cut.py path/to/edit.json --output artifacts/submission
python3 tools/video/audit.py artifacts/submission.mp4
```

The public video is finished, and the [Devpost project](https://devpost.com/software/raidrumble) was submitted to the Codex x TwitchCon Hackathon on November 1, 2026. Final source and evidence are tracked in [PR #3](https://github.com/ocularminds/raidrumble/pull/3). [Devpost copy](../devpost.md) describes the same evidence and its limits.
