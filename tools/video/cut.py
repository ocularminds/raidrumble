"""Cut an explicit local edit plan; --check validates without exporting.

Plan: {"version":1,"title":"RaidRumble","notes":[],"clips":[
  {"source":"capture/live.mov","in":2,"out":12,"speed":1,"scope":"realchat",
   "label":"Siege input","caption":"Friends type the shown keyword."},
  {"source":"proof.png","duration":4,"scope":"evidence",
   "label":"Recorded dossier","caption":"Still evidence, not footage."}]}
Paths resolve relative to the plan. Optional audioStream is a zero-based audio-track
ordinal, required for multiple audio tracks. No narration/music is created.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

if __package__:
    from .audit import Media, VideoAudit, command, font, sha256
else:
    from audit import Media, VideoAudit, command, font, sha256


SCOPES = {
    "twitch": "TWITCH CAPTURE",
    "realchat": "TEST RAID · REAL TWITCH CHAT",
    "simulation": "LOCAL SIMULATION",
    "codex": "CODEX APP CAPTURE",
    "evidence": "RECORDED EVIDENCE",
    "test": "TEST ONLY · SYNTHETIC SOURCE",
}
FPS, SOURCE_HEIGHT = 30, 936


def fields(value: dict, allowed: set[str], name: str) -> None:
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError(f"Invalid or unknown fields in {name}")


def text(value: object, name: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{name} requires 1–{maximum} characters")
    if re.search(r"[\x00-\x08\x0b-\x1f\x7f]", value):
        raise ValueError(f"Control characters are not allowed in {name}")
    return " ".join(value.split())


def number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    try:
        parsed = float(value)
    except OverflowError as error:
        raise ValueError(f"{name} must be a finite number") from error
    if not math.isfinite(parsed):
        raise ValueError(f"{name} must be a finite number")
    return parsed


def unique(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


@dataclass(frozen=True)
class Clip:
    media: Media
    start: float
    end: float
    speed: float
    frames: int
    scope: str
    label: str
    caption: str
    audio_index: int | None

    @property
    def duration(self) -> float:
        return self.frames / FPS

    @property
    def display_label(self) -> str:
        parts = [SCOPES[self.scope]]
        if self.media.kind == "still":
            parts.append("STILL IMAGE")
        if self.speed != 1:
            parts.append(f"PLAYBACK {self.speed:g}×")
        return " · ".join([*parts, self.label])


@dataclass(frozen=True)
class EditPlan:
    path: Path
    title: str
    notes: list[str]
    clips: list[Clip]
    digest: str

    @classmethod
    def load(cls, path: Path) -> EditPlan:
        path = path.resolve(strict=True)
        if path.stat().st_size > 1_000_000:
            raise ValueError("Edit plan is too large")
        raw = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)
        fields(raw, {"version", "title", "notes", "clips"}, "edit plan")
        if type(raw.get("version")) is not int or raw["version"] != 1:
            raise ValueError("Expected edit plan version 1")
        title = text(raw.get("title"), "title", 160)
        notes = raw.get("notes", [])
        if not isinstance(notes, list) or len(notes) > 30:
            raise ValueError("notes must be a list of at most 30 strings")
        notes = [text(note, "note", 1000) for note in notes]
        items = raw.get("clips")
        if not isinstance(items, list) or not 1 <= len(items) <= 60:
            raise ValueError("Expected 1–60 clips")
        cache, clips = {}, []
        for index, item in enumerate(items):
            fields(item, {"source", "in", "out", "duration", "speed", "scope", "label", "caption", "audioStream"}, f"clip {index + 1}")
            source = item.get("source")
            text(source, "source", 4096)
            if "://" in source or re.search(r"[\t\n\r]", source):
                raise ValueError("Only local source files are supported")
            resolved = (path.parent / source).resolve(strict=True)
            if resolved not in cache:
                cache[resolved] = Media.read(resolved)
            media = cache[resolved]
            scope = item.get("scope")
            if not isinstance(scope, str) or scope not in SCOPES:
                raise ValueError(f"clip {index + 1}: scope must be one of {', '.join(SCOPES)}")
            label = text(item.get("label"), "label", 90)
            caption = text(item.get("caption"), "caption", 220)
            speed = number(item.get("speed", 1), "speed")
            if not 0.25 <= speed <= 8:
                raise ValueError("Playback speed must be between 0.25 and 8")
            if media.kind == "still":
                if {"in", "out", "audioStream"} & set(item) or speed != 1:
                    raise ValueError("Stills use duration, not trims, audioStream or speed")
                if scope not in {"evidence", "simulation", "test"} or re.search(
                    r"(?:live|codex)(?: app)? (?:footage|capture)", f"{label} {caption}", re.I
                ):
                    raise ValueError("Stills cannot be labeled as live Twitch or Codex footage")
                start, end = 0.0, number(item.get("duration"), "still duration")
            else:
                if "duration" in item:
                    raise ValueError("Video clips use explicit in/out, not duration")
                start, end = number(item.get("in"), "in"), number(item.get("out"), "out")
                if end > media.duration + 0.001:
                    raise ValueError(f"clip {index + 1}: out exceeds recorded source duration")
            if start < 0 or end <= start:
                raise ValueError(f"clip {index + 1}: expected 0 <= in < out")
            frames = round((end - start) / speed * FPS)
            if frames < 1:
                raise ValueError("A clip must contain at least one output frame")
            if "audioStream" in item:
                ordinal = item["audioStream"]
                if type(ordinal) is not int or not 0 <= ordinal < len(media.audio):
                    raise ValueError("audioStream must select an existing source audio track")
            else:
                if len(media.audio) > 1:
                    raise ValueError("Multiple audio tracks: select an explicit audioStream ordinal")
                ordinal = 0 if media.audio else None
            audio_index = int(media.audio[ordinal]["index"]) if ordinal is not None else None
            clips.append(Clip(media, start, end, speed, frames, scope, label, caption, audio_index))
        if sum(clip.frames for clip in clips) >= 180 * FPS:
            raise ValueError("The final timeline must be strictly shorter than 180 seconds")
        return cls(path, title, notes, clips, sha256(path))


class Footer:
    def __init__(self, font_path: Path | None):
        self.font_path = font_path

    def image(self, clip: Clip) -> Image.Image:
        image = Image.new("RGB", (1920, 144), "#080e14")
        draw = ImageDraw.Draw(image)
        small = font(20, self.font_path)
        if draw.textlength(clip.display_label, font=small) > 1792:
            raise ValueError("Provenance label is too wide; shorten the shot label")
        draw.line((64, 0, 1856, 0), fill="#344e52", width=2)
        draw.text((64, 13), clip.display_label, font=small, fill="#d6f99a")
        face = font(32, self.font_path)
        lines, line = [], ""
        for word in clip.caption.split():
            candidate = f"{line} {word}".strip()
            if draw.textlength(candidate, font=face) <= 1792:
                line = candidate
            else:
                if not line or draw.textlength(word, font=face) > 1792:
                    raise ValueError("Caption has an overlong word; use shorter wording")
                lines.append(line)
                line = word
        lines.append(line)
        if len(lines) > 2:
            raise ValueError("Caption needs more than two readable lines; shorten it")
        for index, line in enumerate(lines):
            draw.text((64, 49 + index * 40), line, font=face, fill="#f4f5ed")
        return image


def tempo(speed: float) -> str:
    values = []
    while speed > 2:
        values.append("atempo=2")
        speed /= 2
    while speed < 0.5:
        values.append("atempo=0.5")
        speed /= 0.5
    return ",".join([*values, f"atempo={speed:.8f}"])


def srt_time(seconds: float) -> str:
    value = round(seconds * 1000)
    hours, value = divmod(value, 3_600_000)
    minutes, value = divmod(value, 60_000)
    seconds, value = divmod(value, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{value:03d}"


class Cutter:
    def __init__(self, plan: EditPlan, output: Path, font_path: Path | None):
        self.plan, self.output = plan, output
        self.footer, self.font_path = Footer(font_path), font_path
        for clip in plan.clips:
            self.footer.image(clip)

    def clip(self, clip: Clip, folder: Path, index: int) -> Path:
        panel = folder / f"panel{index}.png"
        self.footer.image(clip).save(panel)
        path = folder / f"clip{index:03d}.mov"
        source = clip.media.path
        inputs = ["ffmpeg", "-v", "error", "-y", "-copyts", "-threads", "2"]
        if clip.media.kind == "still":
            source = folder / f"still{index}.png"
            with Image.open(clip.media.path) as image:
                ImageOps.exif_transpose(image).convert("RGB").save(source)
            inputs += ["-loop", "1", "-framerate", "30"]
        else:
            inputs += ["-ss", str(clip.start)]
        inputs += ["-protocol_whitelist", "file,pipe", "-i", str(source),
                   "-loop", "1", "-framerate", "30", "-i", str(panel),
                   "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        start, end = clip.start + clip.media.start, clip.end + clip.media.start
        video = f"[0:{clip.media.video_index}]trim=start={start:.9f}:end={end:.9f},setpts=(PTS-{start:.9f}/TB)/{clip.speed:.8f},fps=30,"
        video += "scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=1920:936:force_original_aspect_ratio=decrease:force_divisible_by=2,"
        video += "pad=1920:1080:(ow-iw)/2:(936-ih)/2:color=0x080e14,setsar=1,format=yuv420p[base];[base][1:v]overlay=0:936:shortest=1[v];"
        if clip.audio_index is not None:
            audio = f"[0:{clip.audio_index}]atrim=start={start:.9f}:end={end:.9f},asetpts=(PTS-{start:.9f}/TB)/{clip.speed:.8f},{tempo(clip.speed)},"
            audio += "aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo,apad,"
        else:
            audio = "[2:a]"
        audio += f"atrim=duration={clip.duration:.9f},asetpts=PTS-STARTPTS[a]"
        command(inputs + ["-filter_complex_threads", "1", "-filter_complex", video + audio,
                          "-map", "[v]", "-map", "[a]", "-t", f"{clip.duration:.9f}",
                          "-frames:v", str(clip.frames), "-c:v", "libx264", "-preset", "fast",
                          "-threads", "2", "-crf", "19", "-maxrate", "4M", "-bufsize", "8M",
                          "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le",
                          "-ar", "48000", "-ac", "2", "-map_metadata", "-1", str(path)])
        return path

    def render(self, force: bool) -> dict:
        targets = {suffix: self.output.with_suffix(suffix) for suffix in (".mp4", ".srt", ".md", ".json", ".jpg")}
        protected = {self.plan.path, *[clip.media.path for clip in self.plan.clips],
                     Path(__file__).resolve().parents[2] / "artifacts/demo.mp4"}
        if any(target.resolve() in protected for target in targets.values()):
            raise ValueError("Output would replace a source, plan or historical demo")
        if not force and any(target.exists() for target in targets.values()):
            raise ValueError("Output bundle exists; choose another --output prefix or use --force")
        self.output.parent.mkdir(parents=True, exist_ok=True)
        timeline, frames = [], 0
        with tempfile.TemporaryDirectory(prefix="raidcut", dir=self.output.parent) as temp:
            folder = Path(temp)
            for index, clip in enumerate(self.plan.clips):
                self.clip(clip, folder, index)
                timeline.append({"source": os.path.relpath(clip.media.path, self.plan.path.parent),
                    "sourceSha256": clip.media.digest, "kind": clip.media.kind,
                    "inSeconds": clip.start, "outSeconds": clip.end, "playbackSpeed": clip.speed,
                    "sourceDurationSeconds": clip.media.duration if clip.media.kind == "video" else None,
                    "startSeconds": frames / FPS, "endSeconds": (frames + clip.frames) / FPS,
                    "outputFrames": clip.frames, "scope": clip.scope, "label": clip.display_label,
                    "caption": clip.caption, "sourceAudioStreamIndex": clip.audio_index,
                    "audio": "retained source audio" if clip.audio_index is not None else "silent audio"})
                frames += clip.frames
                print(f"Rendered shot {index + 1}/{len(self.plan.clips)} ({frames / FPS:.2f}s)", flush=True)
            concat = folder / "clips.txt"
            concat.write_text("\n".join(f"file 'clip{i:03d}.mov'" for i in range(len(timeline))) + "\n")
            video = folder / "submission.mp4"
            command(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "1", "-i", str(concat),
                     "-map", "0:v:0", "-map", "0:a:0", "-t", f"{frames / FPS:.9f}",
                     "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
                     "-movflags", "+faststart", "-map_metadata", "-1", str(video)])
            audit = VideoAudit()
            report = audit.verify(video, frames)
            audit.contact(video, timeline, folder / "submission.jpg", self.font_path)
            captions, transcript = [], [f"# {self.plan.title}", "", "Source audio retained where present; otherwise silence. No added narration or music."]
            for index, shot in enumerate(timeline):
                times = f"{srt_time(shot['startSeconds'])} --> {srt_time(shot['endSeconds'])}"
                captions.append(f"{index + 1}\n{times}\n{shot['caption']}\n")
                transcript += ["", f"{times} · {shot['label']}", "", shot["caption"]]
            (folder / "submission.srt").write_text("\n".join(captions), encoding="utf-8")
            (folder / "submission.md").write_text("\n".join(transcript) + "\n", encoding="utf-8")
            for path, digest in {clip.media.path: clip.media.digest for clip in self.plan.clips}.items():
                if sha256(path) != digest:
                    raise ValueError("A source changed while rendering; export was not published")
            if sha256(self.plan.path) != self.plan.digest:
                raise ValueError("The edit plan changed while rendering")
            manifest = {"version": 1, "title": self.plan.title, "createdAt": datetime.now(timezone.utc).isoformat(),
                "planSha256": self.plan.digest, "video": targets[".mp4"].name, "verification": report,
                "layout": {"canvas": [1920, 1080], "sourceBox": [0, 0, 1920, SOURCE_HEIGHT],
                           "fit": "contain; no cropping", "captionBand": [0, SOURCE_HEIGHT, 1920, 144]},
                "timeline": timeline, "notes": self.plan.notes, "manualVisualReviewRequired": True,
                "scopeNotice": "Scopes are editor declarations. Format checks do not prove that footage is live or that a claim is true.",
                "files": {targets[suffix].name: sha256(folder / f"submission{suffix}") for suffix in (".mp4", ".srt", ".md", ".jpg")}}
            (folder / "submission.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            for suffix in (".mp4", ".srt", ".md", ".jpg", ".json"):
                os.replace(folder / f"submission{suffix}", targets[suffix])
        return {"ok": True, "video": str(targets[".mp4"]), "verification": report}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--check", action="store_true", help="Validate only; create no output files")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "artifacts/submission", help="Output prefix without an extension")
    parser.add_argument("--font", type=Path, help="Optional readable TrueType font")
    parser.add_argument("--force", action="store_true", help="Replace only the selected output bundle after successful rendering")
    args = parser.parse_args()
    try:
        if args.output.suffix:
            raise ValueError("--output is a prefix without an extension")
        plan = EditPlan.load(args.plan)
        cutter = Cutter(plan, args.output.resolve(), args.font)
        result = {"ok": True, "shots": len(plan.clips), "durationSeconds": sum(clip.duration for clip in plan.clips),
                  "scopes": sorted({clip.scope for clip in plan.clips}), "exported": False} if args.check else cutter.render(args.force)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired, StopIteration) as error:
        print(json.dumps({"ok": False, "error": str(error)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
