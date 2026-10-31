"""Compose captured localhost app frames and honest build evidence into a demo."""

import hashlib
import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw

from panels import Panels


@dataclass
class Shot:
    path: Path
    duration: float
    caption: str
    label: str
    source: str


class Demo:
    def __init__(self, root: Path):
        self.root = root
        self.output = root / "artifacts"
        self.rendered = self.output / "rendered"
        self.rendered.mkdir(exist_ok=True)
        self.panels = Panels(root)
        self.shots: list[Shot] = []
        self.clips: list[dict] = []

    @staticmethod
    def timestamp(value: str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()

    @staticmethod
    def gameplay_caption(seconds: float):
        if seconds < 12:
            return "A raid becomes a three-round showdown. Viewers play directly in chat."
        if seconds < 32:
            return "SIEGE · A rotating keyword moves the gate. One input per viewer every 2 seconds."
        if seconds < 59:
            return "Participation rate decides the force, so an engaged small team can hold the line."
        if seconds < 82:
            return "KNOW YOUR HOST · Raiders answer about the host; Home Guard learns about the visitors."
        if seconds < 109:
            return "Four quick A/B/C questions use channel facts. The first answer counts."
        if seconds < 122:
            return "FUSION BOSS · Both teams attack one boss. Type !hit or the timed weak-point keyword."
        if seconds < 133:
            return "The boss scales to active participants. Both communities share the victory."
        if seconds < 169:
            return "Boss defeated. The match completes its three-minute timeline before the shared end card."
        if seconds < 179:
            return "BETTER TOGETHER · The end card celebrates three MVPs from each community."
        return "AFTERGLOW · Recent raider chatters stay visible for five minutes. This count is simulated."

    def capture(self, name: str, speed: float = 1, max_gap: float = 0.5,
                simulation_speed: float = 1, logical_offset: float = 0,
                end_at: float | None = None):
        folder = self.output / "capture" / name
        metadata = json.loads((folder / "frames.json").read_text())
        frames = metadata["frames"]
        first = frames[0]["timestamp"]
        before = len(self.shots)
        for index, frame in enumerate(frames):
            elapsed = (frame["timestamp"] - first) * simulation_speed + logical_offset
            if end_at is not None and elapsed >= end_at:
                break
            next_time = frames[index + 1]["timestamp"] if index + 1 < len(frames) else self.timestamp(metadata["finishedAt"])
            duration = max(0.001, min(max_gap, next_time - frame["timestamp"])) / speed
            if name in ("gameplay", "polish"):
                caption = self.gameplay_caption(elapsed)
                label = "LOCAL SIMULATION · 2× SPEED · EDITED"
                if name == "polish" and elapsed < 34:
                    caption = "REMATCH · The ledger remembers previous matches between these communities."
                if elapsed >= 179:
                    if simulation_speed == 1:
                        duration *= 2
                    label = "LOCAL SIMULATION · AFTERGLOW"
            elif name == "intro":
                caption = "RaidRumble gives incoming viewers something to do in their first minute."
                label = "LOCAL DEMO · HOST DASHBOARD"
                if elapsed > 3.5:
                    caption = "An unwelcome raid is blocked before an arena can start."
            elif name == "policy":
                caption = "Policy before action: BLOCK, ALLOW or a host approval bound to one action."
                label = "LOCAL POLICY · UNSIGNED DECISIONS"
            else:
                caption = "A new challenger waits for the host. Accepting claims a single-use execution grant."
                label = "LOCAL POLICY · ESCALATE → HOST APPROVAL"
            self.shots.append(Shot(folder / frame["file"], duration, caption, label, name))
        if name in ("policy", "approval"):
            self.shots[-1].duration += 2
        self.clips.append({
            "name": name,
            "startedAt": metadata["startedAt"],
            "finishedAt": metadata["finishedAt"],
            "inputFrames": len(frames),
            "playbackSpeed": speed,
            "simulationSpeed": simulation_speed,
            "firstFrameLogicalSeconds": logical_offset,
            "logicalEndSeconds": end_at,
            "captureGapCapSeconds": max_gap,
            "outputSeconds": sum(shot.duration for shot in self.shots[before:]),
            "notes": "Policy and approval final frames are held two seconds. The refreshed gameplay capture is a rematch run at 2× logical time.",
        })

    def card(self, name: str, image: Image.Image, duration: float, caption: str):
        path = self.output / f"{name}.png"
        image.save(path)
        self.shots.append(Shot(path, duration, caption, "RECORDED BUILD EVIDENCE · SOURCE / LOG PRESENTATION", name))

    def paint(self, shot: Shot, index: int):
        canvas = Image.new("RGB", (1920, 1080), "#080e14")
        with Image.open(shot.path) as source:
            source = source.convert("RGB")
            source.thumbnail((1728, 972), Image.Resampling.LANCZOS)
            canvas.paste(source, ((1920 - source.width) // 2, 0))
        draw = ImageDraw.Draw(canvas)
        draw.line((96, 977, 1824, 977), fill="#30413c", width=2)
        draw.text((96, 989), shot.label, font=self.panels.font(19, True), fill=self.panels.lime)
        size = 31
        while draw.textlength(shot.caption, font=self.panels.font(size)) > 1728:
            size -= 1
        draw.text((96, 1022), shot.caption, font=self.panels.font(size), fill=self.panels.white)
        path = self.rendered / f"{index:06d}.jpg"
        canvas.save(path, quality=92, subsampling=0)
        return path

    @staticmethod
    def srt_time(seconds: float):
        milliseconds = round(seconds * 1000)
        hours, milliseconds = divmod(milliseconds, 3600000)
        minutes, milliseconds = divmod(milliseconds, 60000)
        whole, milliseconds = divmod(milliseconds, 1000)
        return f"{hours:02d}:{minutes:02d}:{whole:02d},{milliseconds:03d}"

    def render(self):
        lines = ["ffconcat version 1.0"]
        captions = []
        elapsed = 0.0
        for index, shot in enumerate(self.shots):
            path = self.paint(shot, index)
            lines.extend([f"file '{path}'", f"duration {shot.duration:.6f}"])
            if captions and captions[-1]["text"] == shot.caption:
                captions[-1]["end"] = elapsed + shot.duration
            else:
                captions.append({"start": elapsed, "end": elapsed + shot.duration, "text": shot.caption})
            elapsed += shot.duration
            if index % 400 == 0:
                print(f"Composited {index + 1}/{len(self.shots)} captured frames", flush=True)
        lines.append(f"file '{path}'")
        concat = self.output / "demo.ffconcat"
        concat.write_text("\n".join(lines) + "\n")
        srt = []
        for index, caption in enumerate(captions):
            srt.append(f'{index + 1}\n{self.srt_time(caption["start"])} --> {self.srt_time(caption["end"])}\n{caption["text"]}\n')
        (self.output / "demo.srt").write_text("\n".join(srt))
        (self.output / "transcript.md").write_text("# RaidRumble local demonstration\n\nCaption-led, with a silent AAC audio track.\n\n" + "\n\n".join(row["text"] for row in captions) + "\n")
        video = self.output / "demo.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-safe", "0", "-f", "concat", "-i", str(concat),
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-t", f"{elapsed:.6f}", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "fast",
            "-crf", "21", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(video),
        ], check=True)
        sources = ["docs/parallel.json", "artifacts/tests.json", "packages/engine/src/model.ts", "packages/engine/src/registry.ts"]
        sources += [row["file"] for row in self.panels.evidence["rounds"]]
        sources += [f"apps/overlay/src/{name}.ts" for name in ("arena", "draw", "scenes", "main")]
        hashes = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in sources}
        captures = {str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (self.output / "capture").glob("*/frames.json")}
        manifest = {
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "buildChatId": self.panels.evidence["buildChatId"],
            "video": str(video.relative_to(self.root)),
            "durationSeconds": elapsed,
            "videoSha256": hashlib.sha256(video.read_bytes()).hexdigest(),
            "sourceSha256": hashes,
            "captureMetadataSha256": captures,
            "clips": self.clips,
            "captions": captions,
            "provenance": "Real local dashboard and overlay captured using browser CDP screencast. Capture gaps are cut and gameplay is retimed as labelled. Build cards show actual files and recorded agent task times, not Codex UI footage.",
            "audio": "Silent stereo AAC; no narration, music, or third-party assets.",
            "limits": ["All participants, raids and retention are simulated.", "Policy decisions are local and unsigned.", "Live Twitch account validation and the hosted Decionis wire mapping are pending."],
        }
        (self.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps({"video": str(video), "durationSeconds": elapsed, "inputFrames": len(self.shots)}, indent=2), flush=True)


def main():
    root = Path(__file__).resolve().parents[2]
    demo = Demo(root)
    demo.capture("intro")
    demo.capture("policy", max_gap=2)
    demo.capture("approval")
    demo.capture("polish", simulation_speed=2, logical_offset=22, end_at=192)
    demo.card("parallel", demo.panels.parallel(), 9, "Three agents generated the round modules concurrently inside this single build chat.")
    demo.card("contract", demo.panels.contract(), 8, "Each class implements start, onInput, tick, view and result. The registry connects the modules.")
    demo.card("closing", demo.panels.closing(), 5, "Run the judge mode locally with pnpm dev and pnpm sim. No Twitch account is needed.")
    demo.render()


if __name__ == "__main__":
    main()
