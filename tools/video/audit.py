"""Local media inspection and delivery checks; no claim of semantic authenticity."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import struct
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


def command(args: list[str], timeout: int = 900) -> bytes:
    result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace")[-2500:]
        raise ValueError(f"{Path(args[0]).name} failed ({result.returncode}): {detail}")
    return result.stdout


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def metadata(path: Path) -> dict:
    return json.loads(command([
        "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-show_streams", "-show_format", "-of", "json", str(path),
    ], timeout=60))


def font(size: int, path: Path | None = None) -> ImageFont.FreeTypeFont:
    choices = [path] if path else [
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for choice in choices:
        if choice and choice.is_file():
            return ImageFont.truetype(str(choice), size)
    raise ValueError("A readable TrueType font is required; pass --font /path/to/font.ttf")


@dataclass(frozen=True)
class Media:
    path: Path
    kind: str
    duration: float
    start: float
    width: int
    height: int
    video_index: int
    audio: tuple[dict, ...]
    digest: str

    @classmethod
    def read(cls, path: Path) -> Media:
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Missing or empty source: {path}")
        suffix = path.suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            with Image.open(path) as image:
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated images must be supplied as video")
                image.load()
                width, height = ImageOps.exif_transpose(image).size
            return cls(path, "still", 0, 0, width, height, 0, (), sha256(path))
        if suffix not in {".mp4", ".mov", ".m4v"}:
            raise ValueError("Sources must be local MP4/MOV or PNG/JPEG/WebP files")
        data = metadata(path)
        videos = [item for item in data.get("streams", []) if item.get("codec_type") == "video"
                  and not item.get("disposition", {}).get("attached_pic")]
        if not videos:
            raise ValueError(f"No video stream: {path}")
        video = videos[0]
        container = data["format"]
        duration = float(video.get("duration", container.get("duration", 0)))
        start = float(container.get("start_time", 0))
        if not math.isfinite(duration) or duration <= 0 or not math.isfinite(start):
            raise ValueError(f"Invalid source duration: {path}")
        audio = tuple(item for item in data["streams"] if item.get("codec_type") == "audio")
        return cls(path, "video", duration, start, int(video["width"]), int(video["height"]),
                   int(video["index"]), audio, sha256(path))


def faststart(path: Path) -> bool:
    """Check actual top-level MP4 boxes instead of trusting a command-line flag."""
    found = {}
    length = path.stat().st_size
    with path.open("rb") as source:
        while source.tell() + 8 <= length:
            offset = source.tell()
            size, kind = struct.unpack(">I4s", source.read(8))
            header = 8
            if size == 1:
                raw = source.read(8)
                if len(raw) != 8:
                    return False
                size = struct.unpack(">Q", raw)[0]
                header = 16
            elif size == 0:
                size = length - offset
            if size < header or offset + size > length:
                return False
            found[kind] = offset
            source.seek(offset + size)
    return b"moov" in found and b"mdat" in found and found[b"moov"] < found[b"mdat"]


class VideoAudit:
    def verify(self, path: Path, frames: int | None = None) -> dict:
        data = metadata(path)
        video = next(item for item in data["streams"] if item["codec_type"] == "video")
        audio = next((item for item in data["streams"] if item["codec_type"] == "audio"), {})
        duration = float(data["format"]["duration"])
        size = path.stat().st_size
        fps = float(Fraction(video.get("avg_frame_rate", "0/1")))
        checks = {
            "duration_under_180s": 0 < duration < 180,
            "size_under_100mb": size < 100_000_000,
            "resolution_1080p": (video.get("width"), video.get("height")) == (1920, 1080),
            "frame_rate_30": abs(fps - 30) < 0.001,
            "h264": video.get("codec_name") == "h264",
            "aac_stereo_48khz": audio.get("codec_name") == "aac" and audio.get("channels") == 2
                and audio.get("sample_rate") == "48000",
            "faststart": faststart(path),
        }
        if frames is not None:
            checks["frame_count"] = int(video.get("nb_frames", -1)) == frames
            checks["timeline_duration"] = abs(duration - frames / 30) <= 1 / 30
        if not all(checks.values()):
            raise ValueError(f"Export checks failed: {checks}")
        command(["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
                 "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], timeout=300)
        return {"ok": True, "durationSeconds": duration, "sizeBytes": size,
                "fps": fps, "checks": checks, "fullDecode": True, "sha256": sha256(path)}

    def contact(self, video: Path, timeline: list[dict], output: Path, font_path: Path | None) -> None:
        sheet = Image.new("RGB", (1280, math.ceil(len(timeline) / 2) * 396), "#080e14")
        draw = ImageDraw.Draw(sheet)
        for index, shot in enumerate(timeline):
            at = (shot["startSeconds"] + shot["endSeconds"]) / 2
            frame = command(["ffmpeg", "-v", "error", "-ss", str(at), "-i", str(video),
                             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], timeout=60)
            with Image.open(io.BytesIO(frame)) as image:
                tile = ImageOps.contain(image.convert("RGB"), (640, 360))
                x, y = index % 2 * 640, index // 2 * 396
                sheet.paste(tile, (x, y))
                draw.text((x + 12, y + 364), f"{index + 1:02d} · {at:.2f}s · {shot['scope']}",
                          fill="white", font=font(18, font_path))
        sheet.save(output, quality=88)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(VideoAudit().verify(args.video.resolve(strict=True)), indent=2))
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired, StopIteration) as error:
        print(json.dumps({"ok": False, "error": str(error)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
