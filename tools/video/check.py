"""Check the exported demo and build a contact sheet from its actual video frames."""

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

from panels import Panels


class VideoCheck:
    def __init__(self, root: Path):
        self.root = root
        self.output = root / "artifacts"
        self.video = self.output / "demo.mp4"

    def verify(self):
        result = subprocess.run([
            "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(self.video),
        ], check=True, capture_output=True, text=True)
        metadata = json.loads(result.stdout)
        video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
        audio = next((s for s in metadata["streams"] if s["codec_type"] == "audio"), {})
        numerator, denominator = video["r_frame_rate"].split("/")
        fps = int(numerator) / int(denominator)
        duration = float(metadata["format"]["duration"])
        size = int(metadata["format"]["size"])
        checks = {
            "duration_within_limit": duration <= 120,
            "size_within_limit": size <= 100_000_000,
            "resolution_matches": (video["width"], video["height"]) == (1920, 1080),
            "frame_rate_matches": fps == 30,
            "video_codec_h264": video["codec_name"] == "h264",
            "audio_codec_aac": audio.get("codec_name") == "aac",
        }
        report = {
            "ok": all(checks.values()), "file": str(self.video), "duration_seconds": duration,
            "size_bytes": size, "width": video["width"], "height": video["height"], "fps": fps,
            "video_codec": video["codec_name"], "audio_codec": audio.get("codec_name"), "checks": checks,
        }
        (self.output / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
        if not report["ok"]:
            raise RuntimeError(json.dumps(report, indent=2))
        return report

    def contact(self):
        manifest = json.loads((self.output / "manifest.json").read_text())
        captions = manifest["captions"]
        selected = [row for i, row in enumerate(captions) if i != 1]
        canvas = Image.new("RGB", (1280, ((len(selected) + 1) // 2) * 396), "#080e14")
        draw = ImageDraw.Draw(canvas)
        for index, row in enumerate(selected):
            time = (row["start"] + row["end"]) / 2
            path = self.output / f"frame{index}.jpg"
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(time),
                "-i", str(self.video), "-frames:v", "1", str(path),
            ], check=True)
            with Image.open(path) as image:
                image.thumbnail((640, 360))
                x, y = index % 2 * 640, index // 2 * 396
                canvas.paste(image, (x, y))
                draw.text((x + 20, y + 364), f"{time:.1f} seconds", font=Panels.font(22), fill="white")
        canvas.save(self.output / "contact.jpg", quality=90)


def main():
    check = VideoCheck(Path(__file__).resolve().parents[2])
    report = check.verify()
    check.contact()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
