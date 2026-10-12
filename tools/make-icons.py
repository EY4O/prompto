"""Draws the Prompto icons (concept A, "Admit one"): a die-cut holographic
ticket with the wordmark's red orb above the tear line and a barcode stub
below, on a white rounded tile with a hairline edge.

    python tools/make-icons.py                 # Prompto: icons/ and docs/images/icon.png
    python tools/make-icons.py --comfy DIR     # ComfyUI-Prompto: DIR/docs/images/icon.png

Needs Pillow and NumPy. Everything is drawn on a 512 grid at 4x and scaled
down with LANCZOS. Small sizes are simplified rather than just shrunk: 48px
loses the barcode, 32 and 16px lose the tear line too and enlarge the ticket.
"""

import argparse
import os

import numpy as np
from PIL import Image, ImageDraw

SS = 4                      # supersampling factor
G = 512 * SS                # drawing grid
INK = (16, 17, 23)
HOLO = [(0.0, "#f7dccf"), (0.3, "#f4a7c0"), (0.62, "#b9a3e3"), (1.0, "#8fcfe3")]
ORB = [(0.0, "#fff1f1"), (0.22, "#ffb3b3"), (0.6, "#f26d6d"), (1.0, "#c23b4a")]
WIRE = "#ffa931"            # ComfyUI's conditioning wire


def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def ramp(t, stops):
    """Colour at t (array, 0..1) along gradient stops."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), dtype=np.float32)
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        m = (t >= a) & (t <= b)
        k = ((t - a) / (b - a))[..., None]
        out[m] = (rgb(ca) * (1 - k) + rgb(cb) * k)[m]
    return out


def layer(color_fn, mask):
    """An RGBA layer: colours from color_fn(xx, yy), alpha from an L mask."""
    yy, xx = np.mgrid[0:G, 0:G].astype(np.float32)
    rgb_ = color_fn(xx, yy)
    a = np.asarray(mask, dtype=np.float32)[..., None]
    return Image.fromarray(np.concatenate([rgb_, a], axis=2).astype(np.uint8), "RGBA")


def S(v):
    return v * SS


class Painter:
    """Draws on the 512 grid, optionally through a transform (for the ComfyUI layout)."""

    def __init__(self, img, tx=lambda x, y: (x, y), scale=1.0):
        self.img, self.tx, self.k = img, tx, scale

    def pt(self, x, y):
        X, Y = self.tx(x, y)
        return S(X), S(Y)

    def r(self, v):
        return S(v * self.k)

    def ticket(self, box, radius, notch_y, notch_r, notch_x):
        x0, y0, x1, y1 = box
        mask = Image.new("L", (G, G), 0)
        d = ImageDraw.Draw(mask)
        p0, p1 = self.pt(x0, y0), self.pt(x1, y1)
        d.rounded_rectangle([p0, p1], radius=self.r(radius), fill=255)
        for nx in notch_x:
            cx, cy = self.pt(nx, notch_y)
            d.ellipse([cx - self.r(notch_r), cy - self.r(notch_r), cx + self.r(notch_r), cy + self.r(notch_r)], fill=0)
        # SVG's objectBoundingBox diagonal: t = (u + v) / 2 across the ticket's box
        bx0, by0, bx1, by1 = p0[0], p0[1], p1[0], p1[1]
        holo = layer(lambda xx, yy: ramp(((xx - bx0) / (bx1 - bx0) + (yy - by0) / (by1 - by0)) / 2, HOLO), mask)
        self.img.alpha_composite(holo)

    def orb(self, cx, cy, radius):
        X, Y = self.pt(cx, cy)
        R = self.r(radius)
        mask = Image.new("L", (G, G), 0)
        ImageDraw.Draw(mask).ellipse([X - R, Y - R, X + R, Y + R], fill=255)
        # radial gradient: focus at (34%, 30%) of the orb's box, radius 75% of its width
        fx, fy, fr = X - R + 0.34 * 2 * R, Y - R + 0.30 * 2 * R, 0.75 * 2 * R
        self.img.alpha_composite(layer(lambda xx, yy: ramp(np.hypot(xx - fx, yy - fy) / fr, ORB), mask))

    def dashes(self, x0, x1, y, width, dash, gap, alpha):
        over = Image.new("RGBA", (G, G), (0, 0, 0, 0))
        d = ImageDraw.Draw(over)
        x = x0
        while x < x1:
            a, b = self.pt(x, y), self.pt(min(x + dash, x1), y)
            w = self.r(width)
            d.line([a, b], fill=INK + (alpha,), width=int(w))
            for p in (a, b):
                d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=INK + (alpha,))
            x += dash + gap
        self.img.alpha_composite(over)

    def bars(self, bars):
        d = ImageDraw.Draw(self.img)
        for x, y, w, h in bars:
            d.rounded_rectangle([self.pt(x, y), self.pt(x + w, y + h)], radius=self.r(2.5), fill=INK + (255,))


def tile(img, dark=False):
    d = ImageDraw.Draw(img)
    fill, edge = ((28, 28, 34), (58, 58, 68)) if dark else ((255, 255, 255), (220, 219, 227))
    d.rounded_rectangle([S(16), S(16), S(496), S(496)], radius=S(108), fill=fill + (255,), outline=edge + (255,), width=S(10))


BARS = [(186, 358, 12, 44), (208, 358, 6, 44), (224, 358, 16, 44), (250, 358, 6, 44), (266, 358, 12, 44), (288, 358, 6, 44), (304, 358, 18, 44)]


def draw_ticket(p, detail):
    """detail: 'full' (tear + barcode), 'tear' (no barcode) or 'small' (ticket and orb only)."""
    if detail == "small":
        p.ticket((120, 70, 392, 442), 44, 322, 30, (128, 384))
        p.orb(256, 210, 86)
        return
    p.ticket((128, 76, 384, 436), 36, 322, 30, (128, 384))
    p.dashes(170, 342, 322, 10, 18, 14, 115)
    p.orb(256, 196, 66)
    if detail == "full":
        p.bars(BARS)


def prompto(detail):
    img = Image.new("RGBA", (G, G), (0, 0, 0, 0))
    tile(img)
    draw_ticket(Painter(img), detail)
    return img


def comfy(detail):
    img = Image.new("RGBA", (G, G), (0, 0, 0, 0))
    tile(img, dark=True)
    # the ticket shrinks and shifts right to leave room for the wire
    k = 0.86
    p = Painter(img, tx=lambda x, y: (40 + k * (x + 41), k * (y + 40)), scale=k)
    draw_ticket(p, "tear" if detail == "full" else detail)
    # conditioning wire into the left notch, ending in a socket
    d = ImageDraw.Draw(img)
    # A thick polyline leaves ridges at every joint, so the wire is stamped as discs along the curve.
    (x0, y0), (c1x, c1y), (c2x, c2y), (x1, y1) = (52, 436), (140, 436), (110, 311), (185, 311)
    w = S(22)
    for i in range(1201):
        t = i / 1200
        x = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * c1x + 3 * (1 - t) * t ** 2 * c2x + t ** 3 * x1
        y = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c1y + 3 * (1 - t) * t ** 2 * c2y + t ** 3 * y1
        px, py = S(x), S(y)
        d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=WIRE)
    cx, cy, r = S(185), S(311), S(17)
    d.ellipse([cx - r - S(7), cy - r - S(7), cx + r + S(7), cy + r + S(7)], fill=(28, 28, 34, 255))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WIRE)
    return img


def save(img, size, path, pad=0):
    """Scale the 512 artwork to size; pad shrinks it into a centred safe area (Chrome's 128px icon)."""
    inner = size - 2 * pad
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(img.resize((inner, inner), Image.LANCZOS), (pad, pad))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, optimize=True)
    print("wrote", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comfy", metavar="DIR", help="write the ComfyUI-Prompto icon into DIR/docs/images/icon.png")
    args = ap.parse_args()
    if args.comfy:
        save(comfy("full"), 512, os.path.join(args.comfy, "docs", "images", "icon.png"))
        return
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    full, tear, small = prompto("full"), prompto("tear"), prompto("small")
    save(full, 512, os.path.join(root, "docs", "images", "icon.png"))
    save(full, 128, os.path.join(root, "icons", "icon128.png"), pad=16)  # Web Store safe area: 96 of 128
    save(tear, 48, os.path.join(root, "icons", "icon48.png"))
    save(small, 32, os.path.join(root, "icons", "icon32.png"))
    save(small, 16, os.path.join(root, "icons", "icon16.png"))


if __name__ == "__main__":
    main()
