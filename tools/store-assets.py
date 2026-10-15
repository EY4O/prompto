"""Draws the Chrome Web Store images from the README screenshots: 1280x800
screenshots (three panel views side by side, and the hero) and the 440x280
small promo tile. Needs Pillow.

    python tools/store-assets.py   ->  docs/store/*.png
"""

import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "docs", "images")
OUT = os.path.join(ROOT, "docs", "store")
INK, PAPER, ROSE = (16, 17, 23), (251, 250, 255), (183, 110, 121)


def backdrop(w, h):
    """Ink with a soft rose glow, like the panel's dark theme."""
    im = Image.new("RGB", (w, h), INK)
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((w * 0.15, -h * 0.4, w * 1.1, h * 0.9), fill=70)
    glow = glow.resize((w // 8, h // 8)).resize((w, h), Image.BICUBIC)
    return Image.composite(Image.new("RGB", (w, h), ROSE), im, glow)


def fit(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def panels(names, out):
    W, H = 1280, 800
    bg = backdrop(W, H)
    shots = [fit(Image.open(os.path.join(IMG, n)).convert("RGB"), H - 80) for n in names]
    gap = 36
    x = (W - sum(s.width for s in shots) - gap * (len(shots) - 1)) // 2
    for s in shots:
        bg.paste(s, (x, 40))
        x += s.width + gap
    bg.save(os.path.join(OUT, out))


def hero(out):
    W, H = 1280, 800
    bg = backdrop(W, H)
    s = fit(Image.open(os.path.join(IMG, "hero.png")).convert("RGB"), H - 60)
    bg.paste(s, ((W - s.width) // 2, 30))
    bg.save(os.path.join(OUT, out))


def tile(out):
    W, H = 440, 280
    bg = backdrop(W, H)
    icon = Image.open(os.path.join(IMG, "icon.png")).convert("RGBA").resize((150, 150), Image.LANCZOS)
    bg.paste(icon, ((W - 150) // 2, (H - 150) // 2), icon)
    bg.save(os.path.join(OUT, out))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    panels(["inbox.png", "cast.png", "versions.png"], "screenshot-1.png")
    panels(["import.png", "cast.png", "inbox.png"], "screenshot-2.png")
    hero("screenshot-3.png")
    tile("promo-small.png")
    print("Wrote", ", ".join(sorted(os.listdir(OUT))))
