#!/usr/bin/env python3
"""Generate RepLog PWA icons (a barbell on a dark gradient).

Run:  python gen_icons.py
Requires Pillow.  Writes PNGs into ./icons next to this script.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icons")
os.makedirs(OUT, exist_ok=True)

ACCENT   = (74, 222, 128, 255)   # green
ACCENT_D = (34, 197, 94, 255)    # darker green
BG_TOP   = (28, 32, 41, 255)
BG_BOT   = (12, 14, 18, 255)
SS = 4                            # supersample factor for antialiasing


def gradient(size):
    col = Image.new("RGBA", (1, size))
    d = ImageDraw.Draw(col)
    for y in range(size):
        t = y / (size - 1)
        d.point((0, y), fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(4)))
    return col.resize((size, size))


def make_icon(size, maskable=False):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg = gradient(S)
    if maskable:
        img.paste(bg, (0, 0))
    else:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    cy = S / 2

    def rrect(cx, w, h, fill):
        d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=w * 0.35, fill=fill)

    bar_h = S * 0.075
    d.rounded_rectangle([S * 0.20, cy - bar_h / 2, S * 0.80, cy + bar_h / 2], radius=bar_h / 2, fill=ACCENT)
    rrect(S * 0.265, S * 0.085, S * 0.42, ACCENT)    # outer plates
    rrect(S * 0.735, S * 0.085, S * 0.42, ACCENT)
    rrect(S * 0.350, S * 0.065, S * 0.28, ACCENT_D)  # inner plates
    rrect(S * 0.650, S * 0.065, S * 0.28, ACCENT_D)
    rrect(S * 0.190, S * 0.050, S * 0.16, ACCENT)    # end caps
    rrect(S * 0.810, S * 0.050, S * 0.16, ACCENT)

    return img.resize((size, size), Image.LANCZOS)


for sz in (180, 192, 512):
    make_icon(sz).save(os.path.join(OUT, f"icon-{sz}.png"))
make_icon(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
print("Wrote icons to", OUT)
