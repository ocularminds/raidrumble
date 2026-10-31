"""Original title cards derived from the build's recorded source and test evidence."""

import json
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


class Panels:
    background = "#0c141b"
    lime = "#d7f58e"
    white = "#f4f5ed"
    muted = "#aeb8c3"
    blue = "#8bbaff"
    orange = "#ffae7a"
    purple = "#bea6f7"

    def __init__(self, root: Path):
        self.root = root
        self.evidence = json.loads((root / "docs/parallel.json").read_text())
        self.tests = json.loads((root / "artifacts/tests.json").read_text())

    @staticmethod
    def font(size: int, bold: bool = False, mono: bool = False):
        if mono:
            path = "/System/Library/Fonts/Menlo.ttc"
        else:
            name = "Arial Bold.ttf" if bold else "Arial.ttf"
            path = f"/System/Library/Fonts/Supplemental/{name}"
        return ImageFont.truetype(path, size)

    def base(self, title: str, subtitle: str):
        image = Image.new("RGB", (1920, 1080), self.background)
        draw = ImageDraw.Draw(image)
        draw.text((88, 64), "RAIDRUMBLE  /  BUILD EVIDENCE", font=self.font(27, True), fill=self.lime)
        draw.text((88, 127), title, font=self.font(66, True), fill=self.white)
        draw.text((88, 220), subtitle, font=self.font(31), fill=self.muted)
        draw.line((88, 290, 1832, 290), fill="#314048", width=2)
        return image, draw

    @staticmethod
    def seconds(timestamp: str):
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()

    def parallel(self):
        image, draw = self.base(
            "THREE ROUNDS. BUILT IN PARALLEL.",
            "One build chat. Three Codex sub-agents. Tests written before implementation.",
        )
        start = min(self.seconds(row["startedAt"]) for row in self.evidence["rounds"])
        end = max(self.seconds(row["firstGreenAt"]) for row in self.evidence["rounds"])
        x0, x1 = 640, 1800
        position = lambda value: x0 + (self.seconds(value) - start) / (end - start) * (x1 - x0)
        overlap = self.evidence["sharedGenerationOverlap"]
        left, right = position(overlap["from"]), position(overlap["until"])
        draw.rounded_rectangle((left, 323, right, 776), radius=18, fill="#1c342d")
        for index, row in enumerate(self.evidence["rounds"]):
            y = 376 + index * 145
            color = [self.blue, self.orange, self.purple][index]
            draw.text((88, y - 18), row["name"], font=self.font(36, True), fill=color)
            draw.text((88, y + 35), row["agent"], font=self.font(25, mono=True), fill=self.muted)
            a, b = position(row["startedAt"]), position(row["firstGreenAt"])
            draw.rounded_rectangle((a, y, b, y + 27), radius=13, fill=color)
            red = position(row["firstRedAt"])
            draw.ellipse((red - 10, y + 3, red + 10, y + 23), fill="#17202a", outline="#ff7c80", width=4)
            draw.ellipse((b - 11, y + 2, b + 11, y + 24), fill=self.lime)
            label = f'{row["startedAt"][11:19]} → {row["firstGreenAt"][11:19]} UTC'
            draw.text((a, y + 47), label, font=self.font(23, mono=True), fill=self.white)
        draw.text((88, 818), "ALL THREE OVERLAPPED", font=self.font(26, True), fill=self.lime)
        draw.text((88, 862), "17:50:26–17:51:52 UTC · 31 OCT 2026", font=self.font(37, True), fill=self.white)
        draw.text((88, 935), "Source: recorded agent clock readings and Vitest checkpoints in docs/parallel.json", font=self.font(25), fill=self.muted)
        draw.text((88, 978), "Source/log presentation · automated Codex-window capture was unavailable", font=self.font(25), fill=self.muted)
        return image

    def contract(self):
        image, draw = self.base(
            "ONE INTERFACE. THREE PLUG-INS.",
            "Pure state transitions, seeded randomness, and a serialisable overlay view.",
        )
        source = (self.root / "packages/engine/src/model.ts").read_text()
        interface = source.split("export interface RoundModule<S> {", 1)[1].split("\n}", 1)[0]
        lines = ["export interface RoundModule<S> {"] + interface.strip("\n").splitlines() + ["}"]
        draw.rounded_rectangle((75, 322, 1365, 780), radius=22, fill="#15202b", outline="#314048", width=2)
        draw.text((105, 345), "packages/engine/src/model.ts", font=self.font(24, mono=True), fill=self.muted)
        for index, line in enumerate(lines):
            draw.text((105, 405 + index * 41), line, font=self.font(25, mono=True), fill=self.white)
        total = self.tests["numPassedTests"]
        draw.text((1450, 365), str(total), font=self.font(120, True), fill=self.lime)
        draw.text((1450, 510), "tests passed", font=self.font(34, True), fill=self.white)
        draw.text((1450, 570), "60 round tests", font=self.font(27), fill=self.muted)
        draw.text((1450, 617), "3 deterministic rounds", font=self.font(26), fill=self.muted)
        draw.text((1450, 664), "4 simulator scenarios", font=self.font(26), fill=self.muted)
        registry = (self.root / "packages/engine/src/registry.ts").read_text()
        registrations = [line.strip() for line in registry.splitlines() if "defineRound(new" in line]
        for index, line in enumerate(registrations):
            draw.text((105, 823 + index * 44), line, font=self.font(28, mono=True), fill=[self.blue, self.orange, self.purple][index])
        draw.text((88, 1010), "Actual source excerpts · captured test report: artifacts/tests.json", font=self.font(25), fill=self.muted)
        return image

    def closing(self):
        image, draw = self.base(
            "TURN THE RAID INTO A REASON TO STAY.",
            "Compete. Meet the other community. Win together.",
        )
        draw.text((88, 390), "RUN IT LOCALLY", font=self.font(29, True), fill=self.lime)
        draw.text((88, 461), "pnpm i", font=self.font(53, mono=True), fill=self.white)
        draw.text((88, 546), "pnpm dev", font=self.font(53, mono=True), fill=self.white)
        draw.text((88, 631), "pnpm sim", font=self.font(53, mono=True), fill=self.white)
        draw.text((1015, 390), "VERIFIED IN THIS VIDEO", font=self.font(29, True), fill=self.lime)
        for i, line in enumerate(["Actual local app + simulator", "Local unsigned policy decisions", "Real source + parallel task evidence"]):
            draw.text((1015, 461 + i * 65), line, font=self.font(32), fill=self.white)
        draw.text((88, 811), "Live Twitch verification and the hosted Decionis mapping remain pending.", font=self.font(32), fill=self.muted)
        draw.text((88, 906), f'Build chat: {self.evidence["buildChatId"]}', font=self.font(26, mono=True), fill=self.muted)
        return image
