# Local demo and build evidence

The video is an evidence-led local demonstration. All game footage comes from the running dashboard/OBS app, driven by the real simulator and plug-in engine. It is labelled **LOCAL SIMULATION**. No real Twitch raid, measured live retention, or signed Decionis dossier is depicted.

The build segment uses actual source files, test output and `parallel.json`. The three round tasks overlap from **17:50:26 to 17:51:52 UTC on 31 October 2026**. These are clock/Vitest checkpoints from the same build chat, not reconstructed guesses. Automated capture of the Codex window is blocked by the app; a source/log presentation is used instead and labelled accordingly.

## Shot order

1. Dashboard: the three-round concept and the local control room.
2. Policy: an unwelcome raid is BLOCKed; a stranger receives an ESCALATE prompt.
3. Siege: a rotating keyword, normalized team force, and the countdown.
4. Know Your Host: side-specific A/B/C questions and the reveal.
5. Fusion Boss: both teams fight one category-themed boss, then share an end card.
6. Build evidence: the common class interface, three overlapping tasks, and passing tests.

The final video has burned-in captions, an SRT sidecar, a transcript, a contact sheet and a manifest with source hashes. It contains no synthetic narrator or copyrighted music. Any sped-up match footage is explicitly marked. Keep the demonstration below three minutes for the submission.

The verified local export is **114.23 seconds**, **1920×1080**, **30 fps**, H.264 with a silent AAC track, **3.23 MB**. It combines an actual blocked raid and host approval with a later recorded rematch. Refreshed gameplay runs at 2× logical time; capture gaps are cut and labelled. The opening gameplay frame is already 22 seconds into Siege. The rematch banner comes from the real local SQLite ledger. This is edited evidence from multiple local runs, not a claim of one uninterrupted Twitch raid.

The quiz capture includes the final multiline choices, and the boss switches to a green GG celebration on defeat. The source/test card preserves the 359-test checkpoint captured in `artifacts/tests.json`; the final 361-test run is stored separately in `artifacts/finaltests.json`. The contact sheet includes the actual final video frames.

```sh
python3 tools/video/main.py
python3 tools/video/check.py
```

Recomposition requires the existing browser captures in `artifacts/capture/`, macOS system fonts, Python with Pillow and FFmpeg. The video, its SRT/transcript, capture timing, hashes and verification report are all local artifacts. They have not been uploaded or submitted.

## Reproduce the product shots

```sh
pnpm dev
pnpm sim -- --scenario hate-raid
pnpm sim -- --scenario stranger-raid --speed 2
```

Accept the challenge in the dashboard within 10 seconds. Open the OBS preview for full-size round shots. Stop a practice match from the dashboard before running a fresh scenario. Use the Warlord practice page for a clearly labelled local special demonstration.

Before submitting a final hackathon video, add real Twitch footage with consenting test participants if live operation is claimed, and update `devpost.md` to match the verified build. T12’s hosted decision-evaluation mapping remains unconfirmed.
