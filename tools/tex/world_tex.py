"""Act 1 island (Collines Émeraude) PBR textures — WORLD role (SPEC3 §4/§5).

python3 tools/tex/world_tex.py [name ...]   -> assets/tex/world/*.webp + manifest entries (group 'act1')
  (no argument = every set; names: grass soil rock sand bark frond leaves wood water sky)

Every set tiles. Albedo sRGB, normal (tangent space, OpenGL +Y) and ORM (R = AO, G = roughness, B = metal) linear.
  grass   1024  lawn seen from above: layered tapered blades (dark base -> light tips), clover, specks
  soil    1024  warm dirt for the path / lip / soil checker squares: fbm + embedded pebbles + fine grain
  rock    1024  layered sandstone for the checker cliffs (near neutral warm albedo, tinted orange / brown by the
                shader): strata, cracks, pits
  sand     512  beach sand: grains + wind ripples + a few shell bits
  bark     512  palm trunk (u around, v along): 8 overlapping leaf-base rings per tile with fibres
  frond   1024x512 RGBA  one palm frond (u = base -> tip, v across, midrib at v = 0.5): leaflets on alpha
  leaves   512  dense leaf clusters for bushes (triplanar on the blobs)
  wood     512  bridge / totem wood grain
  water    512  water_n: tiling wave normals; water_fx: R = foam bubbles, G = caustics web, B = noise
  sky      512  sky_noise: R = cloud masses, G = cauliflower cells, B = wisps (sky dome cloud layer)
Original procedural art only (numpy + Pillow).
"""
import math
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import (Manifest, rng, grid, value_noise, gradient_noise, fbm, ridged, worley, blur, smoothstep, remap,
                    colorize, height_to_normal, cavity_ao, orm, resize, hex_rgb, domain_warp, sample_wrap)

OUT = Manifest('world')
PREVIEW = []


def add(name, img, cs, **kw):
    OUT.add(name, img.astype(np.float32), colorspace=cs, group='act1', **kw)
    PREVIEW.append((name, img))


def lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def jitter_col(base, r, amt):
    c = np.asarray(base, np.float32) * (1 + (r.random(3) - 0.5) * amt)
    return np.clip(c, 0, 1)


def to255(c):
    return tuple(int(max(0, min(1, v)) * 255 + 0.5) for v in c)


# ------------------------------------------------------------------------------------------------------------ grass
def make_grass():
    S = 2048  # supersampled canvas, box-filtered to 1024
    r = rng(11)
    # ground between the blades: dark loam + thatch
    base_t = fbm(S, 16, 5, seed=3)
    under = colorize(base_t, [(0, '#1b2a10'), (0.5, '#2c3a17'), (1, '#41461f')])
    alb = Image.fromarray((under * 255).astype(np.uint8), 'RGB')
    hgt = Image.new('L', (S, S), 0)
    da, dh = ImageDraw.Draw(alb), ImageDraw.Draw(hgt)
    # (layer, count, len range, width, base colour, tip colour, height base)
    layers = [
        (0, 26000, (16, 40), (3, 5), '#244f18', '#4f7d2a', 30),
        (1, 26000, (18, 48), (3, 6), '#2c6a1e', '#6aa63a', 80),
        (2, 22000, (20, 54), (3, 6), '#347c22', '#86c24a', 130),
        (3, 16000, (22, 60), (3, 6), '#3f8f28', '#a6d65c', 180),
    ]
    clover = []
    for li, n, (l0, l1), (w0, w1), cb, ct, hb in layers:
        cb, ct = hex_rgb(cb), hex_rgb(ct)
        for _ in range(n):
            x, y = r.random() * S, r.random() * S
            L = l0 + (l1 - l0) * r.random() ** 1.3
            a = r.random() * 2 * math.pi
            bend = (r.random() - 0.5) * 0.9
            w = w0 + (w1 - w0) * r.random()
            kind = r.random()
            b = jitter_col(cb, r, 0.35)
            t = jitter_col(ct, r, 0.3)
            if kind < 0.12:  # sun-dried blade
                t = np.clip(t * np.array([1.25, 1.05, 0.6]), 0, 1)
            elif kind < 0.22:  # bluish lush blade
                t = np.clip(t * np.array([0.8, 1.0, 1.05]), 0, 1)
            pts = [(x, y)]
            ang = a
            for k in range(3):
                ang += bend / 3
                px, py = pts[-1]
                pts.append((px + math.cos(ang) * L / 3, py + math.sin(ang) * L / 3))
            for k in range(3):
                f = (k + 0.5) / 3
                col = to255(b * (1 - f) + t * f)
                wk = max(1, int(round(w * (1 - 0.3 * k))))
                hv = int(hb + 60 * f)
                (x0, y0), (x1, y1) = pts[k], pts[k + 1]
                offs = [(0, 0)]
                if min(x0, x1) < 70 or max(x0, x1) > S - 70 or min(y0, y1) < 70 or max(y0, y1) > S - 70:
                    offs = [(ox, oy) for ox in (-S, 0, S) for oy in (-S, 0, S)]
                for ox, oy in offs:
                    seg = [(x0 + ox, y0 + oy), (x1 + ox, y1 + oy)]
                    da.line(seg, fill=col, width=wk)
                    dh.line(seg, fill=hv, width=wk)
        if li == 1:
            # clover clumps between the lower layers
            for _ in range(140):
                cx, cy = r.random() * S, r.random() * S
                for _ in range(int(4 + r.random() * 10)):
                    lx, ly = cx + (r.random() - 0.5) * 60, cy + (r.random() - 0.5) * 60
                    for k in range(3):
                        aa = k * 2.094 + r.random() * 0.4
                        rr = 6 + r.random() * 3
                        ex, ey = lx + math.cos(aa) * rr, ly + math.sin(aa) * rr
                        col = to255(jitter_col(hex_rgb('#3d8a2a'), r, 0.25))
                        for ox in (-S, 0, S):
                            for oy in (-S, 0, S):
                                if abs(ex + ox - S / 2) > S / 2 + 20 or abs(ey + oy - S / 2) > S / 2 + 20:
                                    continue
                                bb = [ex + ox - rr, ey + oy - rr, ex + ox + rr, ey + oy + rr]
                                da.ellipse(bb, fill=col)
                                dh.ellipse(bb, fill=110)
    # specks: tiny white / yellow flowers and dead bits
    for _ in range(260):
        x, y = r.random() * S, r.random() * S
        c = ['#f4f1d8', '#f2d64a', '#c99a52'][int(r.random() * 3)]
        rr = 2 + r.random() * 2.5
        da.ellipse([x - rr, y - rr, x + rr, y + rr], fill=to255(hex_rgb(c)))
        dh.ellipse([x - rr, y - rr, x + rr, y + rr], fill=250)
    a = np.asarray(alb, np.float32) / 255
    h = np.asarray(hgt, np.float32) / 255
    a = resize(a, (1024, 1024))
    h = resize(h, (1024, 1024))
    # gentle tonal breakup inside the tile (the shader adds world-space macro variation)
    tone = fbm(1024, 4, 3, seed=19)
    a = a * (0.92 + 0.16 * tone[..., None])
    hb = blur(h, 1)
    add('grass_albedo', a, 'srgb')
    add('grass_normal', height_to_normal(hb, strength=7), 'linear')
    ao = np.clip(0.35 + 0.65 * smoothstep(0.0, 0.75, hb), 0, 1) * cavity_ao(hb, 4, 1.2)
    rough = 0.9 - 0.12 * smoothstep(0.5, 0.95, hb)
    add('grass_orm', orm(ao, rough, 0), 'linear')


# ------------------------------------------------------------------------------------------------------------- soil
def make_soil():
    N = 1024
    r = rng(21)
    b1 = fbm(N, 6, 6, seed=4, kind='gradient')
    b2 = fbm(N, 24, 4, seed=5)
    warp = fbm(N, 5, 3, seed=6)
    col = colorize(b1 * 0.7 + b2 * 0.3, [(0, '#5b3b22'), (0.45, '#7d5534'), (0.7, '#94693f'), (1, '#a98055')])
    h = b1 * 0.25 + b2 * 0.15
    # pebbles at two scales (raised, rounded, own colour per stone)
    for cells, rad, amp, seed in ((22, 0.36, 0.55, 7), (60, 0.33, 0.35, 8)):
        f1, f2, cid = worley(N, cells, seed=seed)
        f1w = domain_warp(f1, warp, fbm(N, 5, 3, seed=seed + 50), 6)
        keep = (cid > (0.72 if cells < 30 else 0.8)).astype(np.float32)
        bump = np.clip(1 - f1w / rad, 0, 1)
        dome = np.sqrt(bump) * keep
        stone = colorize(cid, [(0, '#7d7468'), (0.5, '#a89a86'), (0.8, '#8a6f55'), (1, '#c2b29a')])
        shade = 0.82 + 0.3 * dome
        m = smoothstep(0.0, 0.18, dome)[..., None]
        col = col * (1 - m) + stone * shade[..., None] * m
        h = h + dome * amp
    # fine grain + small cracks
    g = value_noise(N, 256, seed=9)
    col = col * (0.9 + 0.2 * g[..., None])
    c1, c2, _ = worley(N, 10, seed=12)
    crack = 1 - smoothstep(0.0, 0.035, c2 - c1)
    crack *= smoothstep(0.45, 0.7, fbm(N, 8, 3, seed=13))
    col = col * (1 - 0.45 * crack[..., None])
    h = h - crack * 0.12 + g * 0.04
    h = (h - h.min()) / (h.max() - h.min())
    add('soil_albedo', col, 'srgb')
    add('soil_normal', height_to_normal(h, strength=5), 'linear')
    rough = 0.94 - 0.2 * smoothstep(0.55, 0.9, h)
    add('soil_orm', orm(cavity_ao(h, 5, 1.8), rough, 0), 'linear')


# ------------------------------------------------------------------------------------------------------------- rock
def make_rock():
    N = 1024
    u, v = grid(N)
    w1 = fbm(N, 4, 4, seed=31, kind='gradient')
    w2 = fbm(N, 8, 3, seed=32)
    # sedimentary strata (bands along v, warped, uneven thickness), 6 bands per tile so it tiles
    sv = v * 6 + (w1 - 0.5) * 0.9 + (w2 - 0.5) * 0.2
    sv = sv + 0.18 * np.sin(sv * 2 * math.pi)
    band = np.floor(sv)
    fr = sv - band
    bid = (np.sin((band % 6) * 12.9898 + 1.7) * 43758.5453) % 1.0
    hard = 0.55 + 0.45 * bid                                  # soft layers erode back
    prof = smoothstep(0.0, 0.22, fr) * smoothstep(1.0, 0.7, fr)  # rounded layer edges
    ridge_n = ridged(N, 8, 5, seed=33)
    grain = fbm(N, 96, 3, seed=34)
    h = hard * (0.55 + 0.45 * prof) * (0.75 + 0.25 * ridge_n) + 0.06 * grain
    # a few vertical joints (only where the mask lets them through) and the band partings
    c1, c2, cid = worley(N, 5, seed=35)
    c1w = domain_warp(c2 - c1, w1, w2, 12)
    joint = (1 - smoothstep(0.0, 0.06, c1w)) * smoothstep(0.5, 0.68, fbm(N, 6, 3, seed=41))
    parting = (1 - smoothstep(0.0, 0.04, np.minimum(fr, 1 - fr))) * smoothstep(0.3, 0.55, fbm(N, 6, 3, seed=36))
    cr = np.maximum(joint, parting * 0.7)
    h = h - cr * 0.25
    # pits / erosion holes in the soft layers
    p1, p2, _ = worley(N, 34, seed=37)
    pit = smoothstep(0.3, 0.0, p1) * (fbm(N, 10, 2, seed=38) > 0.6) * (1 - bid)
    h = h - pit * 0.12
    h = (h - h.min()) / (h.max() - h.min())
    tone = 0.5 + 0.6 * (bid - 0.5) + 0.3 * (w2 - 0.5)
    col = colorize(np.clip(tone, 0, 1), [(0, '#a08b74'), (0.4, '#bba78d'), (0.75, '#cbb99e'), (1, '#dacbb0')])
    col = col * (0.78 + 0.32 * h[..., None]) * (0.92 + 0.12 * grain[..., None])
    col = col * (1 - 0.3 * cr[..., None]) * (1 - 0.2 * pit[..., None])
    mott = fbm(N, 12, 4, seed=42)
    col = col * (0.9 + 0.2 * mott[..., None])
    # lichen-ish freckles and darker weathering streaks running down the face
    lich = smoothstep(0.64, 0.8, fbm(N, 16, 4, seed=39)) * smoothstep(0.5, 0.7, w1)
    col = col * (1 - 0.15 * lich[..., None]) + np.array([0.55, 0.6, 0.42]) * 0.15 * lich[..., None]
    streak = resize(value_noise(N, 40, seed=40, m=N // 6), (N, N))
    col = col * (0.95 + 0.07 * streak[..., None])
    # normalise the mean luminance (the shader tints it to the checker colours)
    col = col * (0.72 / lum(col).mean())
    add('rock_albedo', np.clip(col, 0, 1), 'srgb')
    add('rock_normal', height_to_normal(h, strength=7), 'linear')
    rough = 0.8 + 0.14 * (1 - h) - 0.1 * lich
    add('rock_orm', orm(cavity_ao(h, 6, 2.0), np.clip(rough, 0, 1), 0), 'linear')


# ------------------------------------------------------------------------------------------------------------- sand
def make_sand():
    N = 512
    u, v = grid(N)
    w = fbm(N, 3, 3, seed=51, kind='gradient')
    rip = np.sin((v * 9 + (w - 0.5) * 1.6 + 0.12 * np.sin(u * 2 * math.pi * 2)) * 2 * math.pi)
    rip = (rip * 0.5 + 0.5) ** 1.6
    grain = value_noise(N, 256, seed=52)
    g2 = value_noise(N, 128, seed=53)
    h = rip * 0.5 + grain * 0.18 + g2 * 0.12 + fbm(N, 8, 3, seed=54) * 0.2
    t = fbm(N, 6, 4, seed=55)
    col = colorize(t, [(0, '#cdb487'), (0.5, '#e2cc9c'), (1, '#efdcb0')])
    col = col * (0.88 + 0.2 * grain[..., None]) * (0.95 + 0.08 * rip[..., None])
    # dark mineral grains and shell bits
    r = rng(56)
    img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8), 'RGB')
    d = ImageDraw.Draw(img)
    for _ in range(900):
        x, y = r.random() * N, r.random() * N
        c = ['#6e6252', '#8f7e66', '#f6efe2', '#d9a58a'][int(r.random() * 4)]
        rr = 0.5 + r.random() * (1.4 if c in ('#f6efe2', '#d9a58a') else 0.8)
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=to255(hex_rgb(c)))
    col = np.asarray(img, np.float32) / 255
    h = (h - h.min()) / (h.max() - h.min())
    add('sand_albedo', col, 'srgb')
    add('sand_normal', height_to_normal(h, strength=3), 'linear')
    add('sand_orm', orm(cavity_ao(h, 3, 1.0), 0.92 - 0.05 * grain, 0), 'linear')


# ------------------------------------------------------------------------------------------------------------- bark
def make_bark():
    N = 512
    u, v = grid(N)
    rings = 8
    # fibres along the trunk: noise stretched along v
    fib = resize(value_noise(N * 4, 512, seed=63, m=N // 2), (N, N))
    fib2 = resize(value_noise(N * 2, 160, seed=64, m=N // 4), (N, N))
    wv = (fbm(N, 4, 3, seed=62) - 0.5) * 0.25
    sv = v * rings + wv + 0.15 * np.sin(u * 2 * math.pi * 3)
    ring = np.floor(sv)
    fr = sv - ring
    # each ring segment: a flared leaf base, thick at its top edge (fr -> 1), tucked under the next one at fr = 0;
    # notched into 5 overlapping scales around the trunk
    su = (u * 5 + 0.37 * ring) % 1.0
    notch = np.abs(su - 0.5) * 2
    top = fr - 0.18 * notch ** 2
    flare = smoothstep(0.0, 0.9, top)
    lip = smoothstep(0.86, 0.97, top) * smoothstep(1.02, 0.97, top)
    h = 0.55 * flare + 0.25 * fib + 0.12 * fib2 + 0.2 * lip
    shadow = 1 - smoothstep(0.0, 0.12, top)                    # the gap under the overhanging scale
    h = h * (1 - 0.6 * shadow)
    h = (h - h.min()) / (h.max() - h.min())
    t = fbm(N, 6, 3, seed=66)
    col = colorize(0.5 * t + 0.5 * fib, [(0, '#4b3c2e'), (0.4, '#6e5a47'), (0.75, '#8b7660'), (1, '#a8957a')])
    col = col * (0.72 + 0.4 * flare[..., None]) * (1 - 0.6 * shadow[..., None])
    col = col + np.array([0.12, 0.1, 0.06]) * lip[..., None]
    add('bark_albedo', np.clip(col, 0, 1), 'srgb')
    add('bark_normal', height_to_normal(h, strength=6), 'linear')
    add('bark_orm', orm(cavity_ao(h, 4, 1.8) * (1 - 0.4 * shadow), 0.9, 0), 'linear')


# ------------------------------------------------------------------------------------------------------------ frond
def make_frond():
    W, H = 2048, 1024  # supersampled: u = base -> tip along x, v across (midrib at H/2)
    r = rng(71)
    alb = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    hgt = Image.new('L', (W, H), 0)
    da, dh = ImageDraw.Draw(alb), ImageDraw.Draw(hgt)
    mid = H / 2
    n = 46
    for side in (-1, 1):
        for i in range(n):
            f = (i + 0.5 + (r.random() - 0.5) * 0.4) / n
            x0 = W * (0.04 + 0.92 * f)
            env = math.sin(math.pi * min(1, f * 1.05 + 0.03)) ** 0.7  # leaflet length envelope
            L = (H * 0.47) * (0.35 + 0.65 * env) * (0.85 + 0.25 * r.random())
            ang = math.radians(38 + 20 * f + (r.random() - 0.5) * 10)  # leaning toward the tip
            ex, ey = x0 + math.cos(ang) * L, mid + side * math.sin(ang) * L
            wid = W / n * (0.42 + 0.2 * r.random()) * (0.8 + 0.4 * env)
            # lanceolate leaflet: polygon along its axis
            ax, ay = (ex - x0) / L, (ey - mid) / L
            px, py = -ay, ax
            steps = 10
            left, right = [], []
            for k in range(steps + 1):
                t = k / steps
                wk = wid * 0.5 * math.sin(math.pi * min(1, t * 1.15 + 0.02)) ** 0.8 * (1 - 0.15 * t)
                cx = x0 + ax * L * t + 0.03 * L * t * t * side * px
                cy = mid + ay * L * t + 0.06 * L * t * t * side * py
                left.append((cx + px * wk, cy + py * wk))
                right.append((cx - px * wk, cy - py * wk))
            poly = left + right[::-1]
            if r.random() < 0.06:
                continue  # a missing leaflet (torn)
            g = jitter_col(hex_rgb('#2f8f2c'), r, 0.25)
            tipc = jitter_col(hex_rgb('#7ab43a'), r, 0.2)
            col = g * 0.75 + tipc * 0.25 * (0.5 + f)
            da.polygon(poly, fill=to255(col) + (255,))
            dh.polygon(poly, fill=120)
            # crease along the leaflet axis (raised) and a lighter vein
            da.line([(x0, mid), (x0 + ax * L * 0.97, mid + ay * L * 0.97)], fill=to255(col * 1.25) + (255,), width=3)
            dh.line([(x0, mid), (x0 + ax * L * 0.97, mid + ay * L * 0.97)], fill=230, width=5)
            # sun-dried tip on some
            if r.random() < 0.0:
                tl = 0.82 + 0.1 * r.random()
                tip = [(x0 + ax * L * tl + px * wid * 0.2, mid + ay * L * tl + py * wid * 0.2), (ex, ey), (x0 + ax * L * tl - px * wid * 0.2, mid + ay * L * tl - py * wid * 0.2)]
                da.polygon(tip, fill=to255(hex_rgb('#b8a24a')) + (255,))
    # midrib (rachis): thick at the base
    for k in range(60):
        t0, t1 = k / 60, (k + 1) / 60
        wk = int(26 * (1 - t0) + 6)
        da.line([(W * t0, mid), (W * t1, mid)], fill=to255(hex_rgb('#a7b04e') * (0.85 + 0.15 * t0)) + (255,), width=wk)
        dh.line([(W * t0, mid), (W * t1, mid)], fill=255, width=wk)
    a = np.asarray(alb, np.float32) / 255
    h = np.asarray(hgt, np.float32) / 255
    # leaf blade shading: soft darkening toward the leaflet edges via the blurred height
    hb = blur(h, 3)
    rgb = a[..., :3] * (0.75 + 0.35 * hb[..., None])
    alpha = a[..., 3]
    # bleed colour into the transparent texels (no dark fringes when mip-mapped / alpha-tested)
    acc = rgb * alpha[..., None]
    wsum = alpha.copy()
    for rad in (2, 6, 16):
        bb = blur(acc, rad)
        bw = blur(wsum, rad)
        fill = bb / np.maximum(bw[..., None], 1e-4)
        rgb = np.where(alpha[..., None] > 0.5, rgb, np.where(wsum[..., None] > 1e-3, rgb, fill))
        wsum = np.maximum(wsum, (bw > 1e-3).astype(np.float32))
    out = np.concatenate([rgb, alpha[..., None]], axis=-1)
    out = resize(out, (1024, 512))
    hs = resize(hb, (1024, 512))
    nrm = height_to_normal(hs, strength=5)
    # data textures, not tiling across u/v
    OUT.add('frond_albedo', out.astype(np.float32), colorspace='srgb', group='act1', wrap='clamp', lossless=False, quality=92)
    OUT.add('frond_normal', nrm.astype(np.float32), colorspace='linear', group='act1', wrap='clamp')
    PREVIEW.append(('frond_albedo', out))


# ----------------------------------------------------------------------------------------------------------- leaves
def make_leaves():
    S = 1024
    r = rng(81)
    base = fbm(S, 8, 4, seed=82)
    under = colorize(base, [(0, '#0e2a12'), (1, '#1d4a1e')])
    alb = Image.fromarray((under * 255).astype(np.uint8), 'RGB')
    hgt = Image.new('L', (S, S), 0)
    da, dh = ImageDraw.Draw(alb), ImageDraw.Draw(hgt)
    for layer in range(4):
        for _ in range(1100):
            x, y = r.random() * S, r.random() * S
            L = 34 + r.random() * 30
            Wd = L * (0.38 + r.random() * 0.12)
            a = r.random() * 2 * math.pi
            ax, ay = math.cos(a), math.sin(a)
            px, py = -ay, ax
            pts = []
            for k in range(13):
                t = k / 12
                wk = Wd * 0.5 * math.sin(math.pi * t) ** 0.75
                pts.append((x + ax * L * t + px * wk, y + ay * L * t + py * wk))
            for k in range(12, -1, -1):
                t = k / 12
                wk = Wd * 0.5 * math.sin(math.pi * t) ** 0.75
                pts.append((x + ax * L * t - px * wk, y + ay * L * t - py * wk))
            g = jitter_col(hex_rgb(['#1f6b26', '#2b7f2c', '#3c9636', '#4fae3e'][layer]), r, 0.3)
            for ox in (-S, 0, S):
                for oy in (-S, 0, S):
                    if abs(x + ox - S / 2) > S / 2 + 70 or abs(y + oy - S / 2) > S / 2 + 70:
                        continue
                    q = [(px_ + ox, py_ + oy) for px_, py_ in pts]
                    da.polygon(q, fill=to255(g))
                    dh.polygon(q, fill=60 + layer * 50)
                    da.line([(x + ox, y + oy), (x + ox + ax * L * 0.9, y + oy + ay * L * 0.9)], fill=to255(g * 1.3), width=2)
                    dh.line([(x + ox, y + oy), (x + ox + ax * L * 0.9, y + oy + ay * L * 0.9)], fill=80 + layer * 50, width=3)
    a = np.asarray(alb, np.float32) / 255
    h = blur(np.asarray(hgt, np.float32) / 255, 1)
    a = resize(a, (512, 512))
    h = resize(h, (512, 512))
    add('leaves_albedo', a * (0.8 + 0.3 * h[..., None]), 'srgb')
    add('leaves_normal', height_to_normal(h, strength=5), 'linear')


# ------------------------------------------------------------------------------------------------------------- wood
def make_wood():
    N = 512
    u, v = grid(N)
    w = fbm(N, 3, 4, seed=91, kind='gradient')
    w2 = fbm(N, 12, 3, seed=92)
    # grain along u: rings across v, warped
    k1, k2, _ = worley(N, 3, seed=93)
    knot = smoothstep(0.16, 0.0, k1) * (fbm(N, 4, 2, seed=94) > 0.6)
    g = (v * 14 + (w - 0.5) * 2.2 + smoothstep(0.3, 0.0, k1) * 0.6) % 1.0
    grain = smoothstep(0.0, 0.25, g) * smoothstep(1.0, 0.55, g)
    fib = resize(value_noise(N * 4, 512, seed=95, m=N // 4), (N, N))
    t = 0.55 * grain + 0.25 * w2 + 0.2 * fib
    col = colorize(t, [(0, '#6b4122'), (0.4, '#8d5a30'), (0.75, '#ad7442'), (1, '#c58c55')])
    col = col * (1 - 0.35 * knot[..., None])
    h = 0.5 * grain + 0.3 * fib + 0.2 * w2 - 0.3 * knot
    h = (h - h.min()) / (h.max() - h.min())
    add('wood_albedo', col, 'srgb')
    add('wood_normal', height_to_normal(h, strength=3), 'linear')
    add('wood_orm', orm(cavity_ao(h, 3, 1.2), 0.62 + 0.25 * (1 - grain), 0), 'linear')


# ------------------------------------------------------------------------------------------------------------ water
def make_water():
    N = 512
    r = rng(101)
    u, v = grid(N)
    h = np.zeros((N, N), np.float32)
    for i in range(40):
        kmag = 2 + int(r.random() ** 1.6 * 22)
        a = r.random() * 2 * math.pi
        kx, ky = int(round(math.cos(a) * kmag)), int(round(math.sin(a) * kmag))
        if kx == 0 and ky == 0:
            continue
        kk = math.hypot(kx, ky)
        ph = r.random() * 2 * math.pi
        amp = 1 / kk ** 1.3
        s = np.sin((u * kx + v * ky) * 2 * math.pi + ph)
        h += amp * (1 - np.abs(s)) ** 1.5  # trochoid-ish sharp crests
    h += fbm(N, 16, 4, seed=102) * 0.15
    h = (h - h.min()) / (h.max() - h.min())
    OUT.add('water_n', height_to_normal(h, strength=5).astype(np.float32), colorspace='linear', group='act1')
    PREVIEW.append(('water_n', height_to_normal(h, strength=5)))
    # foam bubbles (R), caustics web (G), noise (B)
    f1, f2, _ = worley(N, 24, seed=103)
    g1, g2, _ = worley(N, 56, seed=104)
    bub = np.clip(smoothstep(0.05, 0.4, f2 - f1) * 0.6 + smoothstep(0.05, 0.3, g2 - g1) * 0.5, 0, 1)
    foam = bub * smoothstep(0.3, 0.7, fbm(N, 6, 4, seed=105))
    wx, wy = fbm(N, 4, 3, seed=106), fbm(N, 4, 3, seed=107)
    c1, c2, _ = worley(N, 9, seed=108)
    cw = domain_warp(c2 - c1, wx, wy, 14)
    caus = (1 - smoothstep(0.0, 0.16, cw)) ** 2
    d1, d2, _ = worley(N, 13, seed=109)
    cw2 = domain_warp(d2 - d1, wy, wx, 10)
    caus = np.clip(caus * 0.7 + (1 - smoothstep(0.0, 0.14, cw2)) ** 2 * 0.5, 0, 1)
    nz = fbm(N, 8, 4, seed=110)
    fx = np.stack([foam, caus, nz], axis=-1)
    OUT.add('water_fx', fx.astype(np.float32), colorspace='linear', group='act1')
    PREVIEW.append(('water_fx', fx))


# ------------------------------------------------------------------------------------------------------------ sky
def make_sky():
    """sky_noise 512 linear RGB, tiling: R = billowy cloud masses (fbm, 3 periods), G = cauliflower cells
    (inverted worley, 3 octaves), B = fine wisps (fbm, high frequency). Read by the sky dome's cloud layer."""
    N = 512
    base = fbm(N, 3, 5, seed=201, kind='gradient')
    base = np.clip((base - base.mean()) / (base.std() * 3.2) + 0.5, 0, 1)
    cells = np.zeros((N, N), np.float32)
    amp, tot = 1.0, 0.0
    for i, c in enumerate((6, 12, 24)):
        f1, f2, _ = worley(N, c, seed=210 + i)
        cells += (1 - np.clip(f1 / 0.75, 0, 1)) ** 1.5 * amp
        tot += amp
        amp *= 0.5
    cells /= tot
    cells = np.clip((cells - cells.min()) / (cells.max() - cells.min()), 0, 1)
    wisp = fbm(N, 16, 4, seed=220)
    wx, wy = fbm(N, 4, 3, seed=221), fbm(N, 4, 3, seed=222)
    wisp = domain_warp(wisp, wx, wy, 18)
    wisp = np.clip((wisp - wisp.mean()) / (wisp.std() * 3.5) + 0.5, 0, 1)
    img = np.stack([base, cells, wisp], axis=-1)
    add('sky_noise', img, 'linear')


SETS = {'grass': make_grass, 'soil': make_soil, 'rock': make_rock, 'sand': make_sand, 'bark': make_bark,
        'frond': make_frond, 'leaves': make_leaves, 'wood': make_wood, 'water': make_water, 'sky': make_sky}

if __name__ == '__main__':
    names = sys.argv[1:] or list(SETS)
    for n in names:
        t0 = time.time()
        SETS[n]()
        print('%s: %.1f s' % (n, time.time() - t0))
    OUT.save()
    # contact sheet for review (dev/, gitignored)
    prev = os.path.join(os.path.dirname(__file__), '..', '..', 'dev', 'world', 'texprev.png')
    if os.path.isdir(os.path.dirname(prev)) and PREVIEW:
        tiles = []
        for name, img in PREVIEW:
            im = np.clip(img[..., :3] if img.ndim == 3 else np.stack([img] * 3, -1), 0, 1)
            tiles.append(Image.fromarray((resize(im.astype(np.float32), (256, 256 * im.shape[0] // im.shape[1])) * 255).astype(np.uint8)))
        cols = 6
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * 260, rows * 260), (20, 20, 20))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 260, (i // cols) * 260))
        sheet.save(prev)
        print('preview', os.path.abspath(prev))
