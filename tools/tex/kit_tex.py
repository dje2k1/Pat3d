"""Kit (fox hero) + skateboard textures — KIT role (SPEC3 §5).

python3 tools/tex/kit_tex.py   -> assets/tex/kit/*.webp + manifest entries

  fur        (512², linear data, group 'common'): R = strand height for the shell fur (clumped tapered strands: a shell
             at height h shows the strand where R > h), G = low-frequency clump tone, B = per-strand tone.
             Sampled triplanar on Kit's rest-pose positions (no UVs needed), also bump-mapped on the base body.
  knit       (256², linear data, 'common'): knitted V-stitch fabric for the scarf / gloves: R = height (bump-mapped),
             G = yarn fuzz, B = cavity AO.
  board_deck / board_deck_n / board_deck_orm (256 x 1024, 'act2'): skateboard deck. Image top half = grip tape (top
             face), bottom half = the printed graphic (bottom face); the left 6 % (u < 0.06) is the maple ply edge
             (side walls map across it). Original artwork only.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import (Manifest, rng, grid, value_noise, fbm, worley, blur, smoothstep, colorize, height_to_normal,
                    cavity_ao, orm, resize, hex_rgb)

m = Manifest('kit')


# ----------------------------------------------------------------------------------------------------------- fur
def strands(n, cells, seed, rmin=0.5, rmax=0.75, lmin=0.55, power=0.75):
    """Max over jittered strands of len * (1 - d / r)^power (tapered cones), tiling. Also returns per-strand tone."""
    r = rng(seed)
    pts = r.random((cells, cells, 2)).astype(np.float32)
    ln = (lmin + (1 - lmin) * r.random((cells, cells))).astype(np.float32)
    rad = (rmin + (rmax - rmin) * r.random((cells, cells))).astype(np.float32)
    tone = r.random((cells, cells)).astype(np.float32)
    u, v = grid(n)
    x, y = u * cells, v * cells
    cx, cy = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    best = np.zeros(x.shape, np.float32)
    btone = np.zeros(x.shape, np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ix, iy = (cx + dx) % cells, (cy + dy) % cells
            p = pts[iy, ix]
            px = cx + dx + p[..., 0] - x
            py = cy + dy + p[..., 1] - y
            d = np.sqrt(px * px + py * py)
            s = ln[iy, ix] * np.clip(1 - d / rad[iy, ix], 0, 1) ** power
            win = s > best
            btone = np.where(win, tone[iy, ix], btone)
            best = np.maximum(best, s)
    return best, btone


N = 512
fine, ftone = strands(N, 80, 7, 0.55, 0.8, 0.5)
mid, _ = strands(N, 34, 8, 0.6, 0.85, 0.6, 0.9)
f1, f2, cid = worley(N, 9, seed=9)
clump = 1 - smoothstep(0.0, 0.75, f1)               # strands lean longer toward clump centres
parting = smoothstep(0.0, 0.16, f2 - f1)            # thin partings between clumps
height = np.maximum(fine * (0.62 + 0.38 * clump), mid * 0.85 * (0.55 + 0.45 * clump)) * (0.55 + 0.45 * parting)
height = np.clip(height / np.percentile(height, 99.5), 0, 1)
tone_lo = fbm(N, 4, octaves=3, seed=31) * 0.6 + cid * 0.4
fur = np.stack([height, tone_lo, ftone], axis=-1)
m.add('fur', fur, colorspace='linear', group='act1', quality=96)


# ----------------------------------------------------------------------------------------------------------- knit
def knit(n=256, cols=8, rows=11):
    u, v = grid(n)
    x, y = u * cols, v * rows
    fx, fy = x - np.floor(x), y - np.floor(y)
    h = np.zeros_like(fx)
    for side in (-1, 1):
        # one leg of the V: a slanted ellipse, centred a quarter stitch left / right
        px, py = fx - 0.5 - side * 0.23, fy - 0.5
        a = side * 0.62
        ca, sa = math.cos(a), math.sin(a)
        qx, qy = px * ca - py * sa, px * sa + py * ca
        d = (qx / 0.2) ** 2 + (qy / 0.62) ** 2
        h = np.maximum(h, np.sqrt(np.clip(1 - d, 0, 1)))
    yarn = fbm(n, 32, octaves=3, seed=44)
    return np.clip(h * (0.85 + 0.3 * yarn), 0, 1)


kh = blur(knit(), 1)
fuzz = fbm(256, 64, octaves=2, seed=45)
m.add('knit', np.stack([kh, fuzz, cavity_ao(kh, 3, 1.2)], axis=-1), colorspace='linear', group='act1')


# ----------------------------------------------------------------------------------------------------------- board
W, H = 256, 1024
SS = 4  # supersampling for the drawn artwork


def draw_layer(w, h, fn):
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    fn(ImageDraw.Draw(im), SS)
    im = im.resize((w, h), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0


def over(dst, layer, col=None):
    a = layer[..., 3:4]
    c = layer[..., :3] if col is None else np.asarray(hex_rgb(col))[None, None, :]
    return dst * (1 - a) + c * a


EDGE = int(round(0.06 * W))  # ply strip
hh = H // 2
u, v = grid(W, H)
# --- grip tape (top half of the image: rows 0..hh)
grit = value_noise(W, 128, seed=3, m=H) * 0.6 + value_noise(W, 64, seed=4, m=H) * 0.4
spark = (value_noise(W, 200, seed=5, m=H) > 0.82).astype(np.float32)
grip_h = np.clip(grit * 0.8 + spark * 0.3, 0, 1)
grip = colorize(grit * 0.5 + 0.25, [(0, '#1b1c20'), (1, '#3a3d44')]) + spark[..., None] * 0.05


def grip_art(d, s):
    w, h = W * s, hh * s
    x0 = int(EDGE * s + 10 * s)
    x1 = w - 10 * s
    # cut-out bands near both ends (orange + teal) and a fox head in the middle, original design
    for y in (34, hh - 40):
        d.rectangle([x0, (y) * s, x1, (y + 5) * s], fill=(244, 122, 31, 255))
        d.rectangle([x0, (y + 9) * s, x1, (y + 11) * s], fill=(23, 182, 195, 255))
    cx, cy, r = (EDGE + (W - EDGE) / 2) * s, hh / 2 * s, 40 * s
    head = [(cx - r * 0.95, cy - r * 0.95), (cx - r * 0.5, cy - r * 0.25), (cx, cy - r * 0.45), (cx + r * 0.5, cy - r * 0.25),
            (cx + r * 0.95, cy - r * 0.95), (cx + r * 0.85, cy + r * 0.05), (cx + r * 0.55, cy + r * 0.45), (cx, cy + r * 0.95),
            (cx - r * 0.55, cy + r * 0.45), (cx - r * 0.85, cy + r * 0.05)]
    d.polygon(head, fill=(200, 205, 214, 140))


ga = draw_layer(W, hh, grip_art)
grip_top = grip[:hh] * (1 - ga[..., 3:4]) + ga[..., :3] * ga[..., 3:4] * (0.75 + 0.25 * grit[:hh, :, None])
grip_top_h = grip_h[:hh] * (1 - ga[..., 3]) + 0.35 * ga[..., 3]

# --- printed graphic (bottom half of the image: rows hh..H; v = 0 at the bottom row)
gy = np.linspace(0, 1, hh, dtype=np.float32)[:, None] * np.ones((1, W), np.float32)
base = colorize(gy, [(0, '#ff9e3d'), (0.5, '#f47a1f'), (1, '#de5a10')])


def graphic(d, s):
    w, h = W * s, hh * s
    xl = EDGE * s
    cx = (xl + w) / 2
    # chevrons toward both ends
    for k in range(4):
        for top in (True, False):
            y = (52 + k * 22) * s if top else h - (52 + k * 22) * s
            dy = -26 * s if top else 26 * s
            t = 9 * s
            poly = [(xl + 6 * s, y), (cx, y + dy), (w - 6 * s, y), (w - 6 * s, y + (t if top else -t)), (cx, y + dy + (t if top else -t)), (xl + 6 * s, y + (t if top else -t))]
            d.polygon(poly, fill=(23, 182, 195, 255) if k % 2 == 0 else (18, 24, 69, 255))
    # centre emblem: navy disc, gold ring, white fox head with a teal scarf band (Kit, original)
    cy, R = h / 2, 62 * s
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(18, 24, 69, 255))
    d.ellipse([cx - R * 0.9, cy - R * 0.9, cx + R * 0.9, cy + R * 0.9], outline=(255, 210, 63, 255), width=int(5 * s))
    r = R * 0.62
    head = [(cx - r * 0.95, cy - r * 0.95), (cx - r * 0.5, cy - r * 0.25), (cx, cy - r * 0.45), (cx + r * 0.5, cy - r * 0.25),
            (cx + r * 0.95, cy - r * 0.95), (cx + r * 0.85, cy + r * 0.05), (cx + r * 0.55, cy + r * 0.45), (cx, cy + r * 0.95),
            (cx - r * 0.55, cy + r * 0.45), (cx - r * 0.85, cy + r * 0.05)]
    d.polygon(head, fill=(255, 244, 230, 255))
    d.ellipse([cx - r * 0.42, cy - r * 0.05, cx - r * 0.12, cy + r * 0.3], fill=(34, 195, 106, 255))
    d.ellipse([cx + r * 0.12, cy - r * 0.05, cx + r * 0.42, cy + r * 0.3], fill=(34, 195, 106, 255))
    d.ellipse([cx - r * 0.12, cy + r * 0.55, cx + r * 0.12, cy + r * 0.75], fill=(26, 11, 5, 255))
    # speed stars
    for (sx, sy, sr) in ((0.3, 0.27, 9), (0.74, 0.31, 7), (0.32, 0.73, 7), (0.7, 0.7, 9)):
        px, py, rr = xl + (w - xl) * sx, h * sy, sr * s
        pts = []
        for i in range(10):
            a = -math.pi / 2 + i * math.pi / 5
            q = rr if i % 2 == 0 else rr * 0.45
            pts.append((px + math.cos(a) * q, py + math.sin(a) * q))
        d.polygon(pts, fill=(255, 255, 255, 255))


gl = draw_layer(W, hh, graphic)
art = base * (1 - gl[..., 3:4]) + gl[..., :3] * gl[..., 3:4]
# wear: scratches through the print near the tail / nose show the light maple
sc = np.zeros((hh, W), np.float32)
r = rng(77)
for i in range(70):
    y0 = r.random() * hh
    near = min(y0, hh - y0) / hh
    if r.random() > 1.2 - near * 3.0 and near > 0.2:
        continue
    x0, ln, ang = r.random() * W, 8 + r.random() * 40, (r.random() - 0.5) * 0.9
    for t in np.linspace(0, 1, 60):
        xx, yy = int(x0 + math.sin(ang) * ln * t) % W, int(y0 + math.cos(ang) * ln * t) % hh
        sc[yy, xx] = max(sc[yy, xx], 0.9 * (1 - abs(t - 0.5)))
sc = np.clip(blur(sc, 1) * 3, 0, 1)
maple = colorize(fbm(W, 16, octaves=3, seed=12, m=hh), [(0, '#d9b98a'), (1, '#f0dcb4')])
art = art * (1 - sc[..., None]) + maple * sc[..., None]
art_h = 0.5 - sc * 0.25

alb = np.concatenate([grip_top, art], axis=0)
hgt = np.concatenate([grip_top_h, art_h], axis=0)
rough = np.concatenate([np.full((hh, W), 0.93, np.float32) - ga[..., 3] * 0.15, 0.32 + sc * 0.4 + fbm(W, 8, octaves=3, seed=13, m=hh) * 0.08], axis=0)

# --- maple ply edge strip (u < 0.06): 7 plies across the thickness (u), one dyed teal, grain along v
pu = (np.arange(EDGE, dtype=np.float32) + 0.5) / EDGE
ply = np.floor(pu * 7).astype(int)
plyc = np.array([hex_rgb(c) for c in ('#e8c98f', '#d4ad70', '#e8c98f', '#17b6c3', '#e8c98f', '#d4ad70', '#e8c98f')])
grain = fbm(EDGE * 4, 6, octaves=4, seed=14, m=H)[:, ::4][:, :EDGE]
edge = plyc[ply][None, :, :] * (0.85 + 0.3 * grain[..., None])
glue = (np.abs((pu * 7) - np.round(pu * 7)) < 0.09).astype(np.float32)
edge = edge * (1 - 0.35 * glue[None, :, None])
alb[:, :EDGE] = edge
hgt[:, :EDGE] = 0.5 + grain * 0.1 - glue[None, :] * 0.1
rough[:, :EDGE] = 0.6

m.add('board_deck', np.clip(alb, 0, 1), colorspace='srgb', group='act2', wrap='clamp')
m.add('board_deck_n', height_to_normal(blur(hgt, 1) if False else hgt, strength=3.0), colorspace='linear', group='act2', wrap='clamp')
m.add('board_deck_orm', orm(ao=cavity_ao(hgt, 3, 1.0), rough=np.clip(rough, 0, 1), metal=0.0), colorspace='linear', group='act2', wrap='clamp')
m.save()
