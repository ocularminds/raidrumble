"""Original, clearly labeled backdrop for an OBS test stream; no third-party art."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
output = root / "artifacts" / "stage.png"
image = Image.new("RGB", (1920, 1080), "#10221f")
draw = ImageDraw.Draw(image)
font_path = "/System/Library/Fonts/Avenir Next.ttc"

def font(size):
    return ImageFont.truetype(font_path, size)

for y in range(1080):
    shade = int(14 + y / 1080 * 13)
    draw.line((0, y, 1920, y), fill=(shade, shade + 14, shade + 11))
for x in range(40, 1920, 80):
    for y in range(40, 1080, 80):
        draw.ellipse((x, y, x + 2, y + 2), fill="#395048")
draw.ellipse((1250, 120, 1720, 590), outline="#d6f99a", width=4)
draw.ellipse((1340, 210, 1630, 500), fill="#253f33", outline="#718c5a", width=2)
draw.polygon([(1310, 493), (1485, 285), (1660, 493)], fill="#ffa066")
draw.ellipse((1170, 425, 1300, 555), fill="#79b7ff")
draw.rounded_rectangle((115, 70, 514, 123), 26, fill="#d6f99a")
draw.text((141, 79), "RAIDRUMBLE · DEMO", font=font(24), fill="#10221f")
draw.text((115, 199), "Your stream.", font=font(92), fill="#f4f5f0")
draw.text((115, 314), "Still the main event.", font=font(82), fill="#f4f5f0")
draw.text((120, 473), "One raid. Three rounds. A reason to stay.", font=font(35), fill="#d6f99a")
draw.text((120, 535), "The compact arena leaves room for the streamer.", font=font(30), fill="#b6c6bd")
draw.line((120, 641, 1800, 641), fill="#526959", width=2)
draw.text((120, 672), "ORIGINAL TEST BACKDROP · NO GAMEPLAY SHOWN", font=font(23), fill="#91a899")
output.parent.mkdir(parents=True, exist_ok=True)
image.save(output, optimize=True)
print(output)
