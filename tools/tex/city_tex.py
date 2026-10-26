"""Act 2 city (San Francisco) PBR material layers — CITY role (SPEC3 §4/§5).

python3 tools/tex/city_tex.py [--preview]   -> assets/tex/city/city_alb.webp, city_nrm.webp (+ _half) and manifest
                                             entries (group 'act2'); --preview also writes dev/city/texprev.png

The city is drawn by ONE uber-material (src/25-city.js cityMaterial: per-vertex surface "kind"), so its materials are
packed as layers of two texture ARRAYS. Each file is a vertical strip of square tiles (512 px full / 256 px half),
written bottom-up (the first layer is the bottom tile): after K.tex's flipY decode the strip's rows are exactly the
memory layout of a THREE.DataArrayTexture (layer 0 first, rows bottom-up), so 25-city.js converts it with one
getImageData.
  city_alb  RGB = albedo (sRGB). Tinted areas are authored grey with a linear mean of ~0.5: the shader multiplies them
            by 2 x the vertex colour (the v2 palette stays the art direction); untinted areas keep their own colour.
            A = 0.5 + 0.5 * tint (tint 1 = painted / takes the vertex colour, 0 = bare: mortar, chipped metal, glass).
  city_nrm  RG = tangent-space normal xy (OpenGL +Y), B = roughness, A = 0.5 + 0.5 * ambient occlusion (linear).
Every layer tiles except WINDOW and MANHOLE (one per 0..1 uv). The layer order is the LAYERS list below (the shader's
L_* constants in 25-city.js must match).
Original procedural art only (numpy + Pillow).
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import (Manifest, rng, grid, value_noise, fbm, ridged, worley, blur, smoothstep, sample_smooth,
                    height_to_normal, cavity_ao, resize, hex_rgb, srgb_to_linear, linear_to_srgb, domain_warp)

N = 512


# ------------------------------------------------------------------------------------------------ helpers
def vn2(px, py, seed, n=N):
    """periodic value noise with px cells across and py cells down"""
    r = rng(seed)
    lat = r.random((py, px)).astype(np.float32)
    u, v = grid(n)
    return sample_smooth(lat, u * px, v * py)


def fbm2(px, py, octaves, seed, gain=0.5, n=N):
    out = np.zeros((n, n), np.float32)
    a, t = 1.0, 0.0
    for o in range(octaves):
        out += vn2(px << o, py << o, seed + 31 * o, n) * a
        t += a
        a *= gain
    return out / t


def coords():
    """u (0..1 left->right), w (0..1 bottom->top: the texture's v after the flipY upload)"""
    u, v = grid(N)
    return u, 1.0 - v


def hash_cells(ix, iy, seed):
    """deterministic 0..1 per integer cell"""
    a = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (seed * 83492791)
    a = (a ^ (a >> 13)) * 1274126177
    a = a ^ (a >> 16)
    return ((a & 0xFFFFFF).astype(np.float32)) / float(0xFFFFFF)


def grey(lin_mean, field):
    """tinted albedo: a linear grey field around lin_mean -> sRGB rgb"""
    g = np.clip(lin_mean * field, 0, 1)
    return np.repeat(linear_to_srgb(g)[..., None], 3, axis=-1)


def rgb_lin(hexcol, field=None):
    c = srgb_to_linear(hex_rgb(hexcol))
    if field is None:
        return c
    return c[None, None, :] * field[..., None]


def to_srgb(lin):
    return linear_to_srgb(np.clip(lin, 0, 1))


def bevel(d, w):
    """0 at an edge -> 1 at distance w (rounded profile)"""
    t = np.clip(d / w, 0, 1)
    return np.sin(t * math.pi / 2)


def layer(alb, tint, h, rough, ao=None, nstr=4.0, ao_r=4, ao_s=1.6):
    if ao is None:
        ao = cavity_ao(h, ao_r, ao_s)
    return dict(alb=np.clip(alb, 0, 1).astype(np.float32), tint=np.clip(tint, 0, 1).astype(np.float32),
                h=h.astype(np.float32), rough=np.clip(rough, 0.02, 1).astype(np.float32),
                ao=np.clip(ao, 0, 1).astype(np.float32), nstr=nstr)


# ------------------------------------------------------------------------------------------------ layers
def L_paintwood():
    u, w = coords()
    grain = fbm2(3, 96, 3, 11)                    # wood grain under the paint (along u)
    brush = fbm2(2, 40, 2, 12)                    # brush strokes
    peel = vn2(256, 256, 13) * 0.6 + vn2(64, 64, 14) * 0.4
    h = 0.5 + 0.05 * (grain - 0.5) + 0.03 * (brush - 0.5) + 0.02 * (peel - 0.5)
    chips = smoothstep(0.80, 0.84, fbm2(10, 10, 3, 15) * 0.7 + vn2(80, 80, 16) * 0.3)
    h = h - chips * 0.08
    lumf = 1 + 0.06 * (brush - 0.5) + 0.04 * (grain - 0.5)
    alb = grey(0.5, lumf)
    bare = to_srgb(rgb_lin('#8f8273', 0.9 + 0.2 * grain))
    tint = 1 - chips
    alb = alb * tint[..., None] + bare * (1 - tint[..., None])
    rough = 0.5 + 0.12 * brush + chips * 0.3
    return layer(alb, tint, h, rough, nstr=3.0)


def L_siding():
    u, w = coords()
    rows = 5
    f = (w * rows) % 1.0
    row = np.floor(w * rows).astype(np.int64)
    # butt joints: one or two per board within the tile, staggered
    j1 = hash_cells(row, row * 0 + 1, 21)
    j2 = hash_cells(row, row * 0 + 2, 22)
    dj = np.minimum(np.abs(((u - j1 + 0.5) % 1.0) - 0.5), np.where(j2 > 0.5, np.abs(((u - j2 * 0.7 + 0.5) % 1.0) - 0.5), 1))
    joint = 1 - smoothstep(0.0015, 0.004, dj)
    board_id = row * 7 + (u > j1).astype(np.int64)
    bshade = hash_cells(board_id, row, 23)
    grain = fbm2(2, 140, 3, 24)
    # lap profile: thick lip at the bottom of each board, tapering up under the board above
    prof = 1.0 - 0.62 * f
    lip = smoothstep(0.0, 0.05, f)                # rounded bottom edge of the lip
    h = prof * (0.75 + 0.25 * lip) + 0.025 * (grain - 0.5) - joint * 0.12
    shadow = smoothstep(0.80, 1.0, f)             # under the next board's lip
    ao = 1 - 0.55 * shadow ** 1.5 - joint * 0.25
    peelm = smoothstep(0.83, 0.88, fbm2(8, 8, 3, 25) * 0.6 + vn2(48, 48, 26) * 0.4) * smoothstep(0.5, 0.0, f)
    h = h - peelm * 0.04
    lumf = (1 + 0.05 * (bshade - 0.5) + 0.04 * (grain - 0.5) - 0.08 * shadow) * (1 - 0.15 * (1 - lip))
    alb = grey(0.5, lumf)
    bare = to_srgb(rgb_lin('#8b847a', 0.85 + 0.3 * grain))
    tint = 1 - peelm
    alb = alb * tint[..., None] + bare * (1 - tint[..., None])
    rough = 0.55 + 0.1 * (grain - 0.5) + 0.25 * peelm
    return layer(alb, tint, h, rough, ao=ao, nstr=5.0)


def L_shingle():
    u, w = coords()
    rows = 6
    fr = (w * rows) % 1.0
    row = np.floor(w * rows).astype(np.int64)
    # shingles of random width per row: 8 slots with jittered edges and a per-row offset
    slots = 8
    off = hash_cells(row, row * 0, 31)
    x = (u + off) * slots
    k = np.floor(x).astype(np.int64)
    edge_j = (hash_cells(k, row, 32) - 0.5) * 0.5
    xl = x - k
    # split some slots in two narrower shingles
    split = hash_cells(k, row, 33) > 0.6
    xl2 = np.where(split, (xl * 2) % 1.0, xl)
    sid = np.where(split, k * 2 + (xl > 0.5), k * 2)
    gap = np.minimum(xl2, 1 - xl2) * (np.where(split, 0.5, 1.0) / slots) * N  # px to the gap
    gapm = 1 - smoothstep(0.6, 2.2, gap)
    sh = hash_cells(sid, row, 34)
    tilt = hash_cells(sid, row, 35)
    gran = vn2(256, 256, 36) * 0.6 + vn2(128, 128, 37) * 0.4
    h = 1.0 - 0.45 * fr + 0.04 * (tilt - 0.5) * (xl2 - 0.5) + 0.03 * (gran - 0.5)
    h = h - gapm * 0.25 * (1 - fr * 0.3)
    bottom = smoothstep(0.0, 0.06, fr)
    h = h * (0.85 + 0.15 * bottom)
    shadow = smoothstep(0.78, 1.0, fr)
    ao = 1 - 0.5 * shadow ** 1.5 - 0.5 * gapm
    lumf = (1 + 0.22 * (sh - 0.5) + 0.12 * (gran - 0.5)) * (1 - 0.15 * shadow) * (1 - 0.5 * gapm)
    alb = grey(0.5, lumf)
    rough = 0.82 + 0.1 * (gran - 0.5)
    _ = edge_j
    return layer(alb, np.ones_like(u), h, rough, ao=ao, nstr=5.0)


def L_asphalt():
    u, w = coords()
    f1, f2, cid = worley(N, 110, seed=41)           # aggregate stones ~2 cm
    stone = smoothstep(0.45, 0.15, f1)
    sbright = hash_cells(np.floor(cid * 1e6).astype(np.int64), cid.astype(np.int64) * 0, 42)
    fine = vn2(256, 256, 43) * 0.5 + vn2(512, 512, 44) * 0.5
    blot = fbm2(6, 6, 4, 45)
    # block cracking: cell borders of a coarse worley, warped, only some of them
    c1, c2, cc = worley(N, 4, seed=46)
    border = c2 - c1
    wx, wy = fbm2(8, 8, 3, 47), fbm2(8, 8, 3, 48)
    border = domain_warp(border, wx, wy, 10)
    crack_on = smoothstep(0.45, 0.6, fbm2(5, 5, 3, 49))
    crack = (1 - smoothstep(0.004, 0.012, border)) * crack_on
    hair = (1 - smoothstep(0.0, 0.035, np.abs(ridged(N, 6, 3, seed=50) - 0.93))) * smoothstep(0.6, 0.7, fbm2(4, 4, 2, 51))
    crack = np.maximum(crack, hair * 0.7)
    # tar-sealed crack bands along part of the network
    seal = (1 - smoothstep(0.012, 0.03, border)) * smoothstep(0.5, 0.6, fbm2(3, 3, 2, 52)) * (1 - crack_on * 0.5)
    h = 0.5 + 0.22 * stone * (0.6 + 0.4 * sbright) + 0.08 * (fine - 0.5) - 0.45 * crack
    h = h * (1 - seal * 0.6) + seal * 0.52
    lumf = 1 + 0.3 * stone * (sbright - 0.45) + 0.12 * (fine - 0.5) + 0.12 * (blot - 0.5)
    lumf = lumf * (1 - 0.45 * crack) * (1 - 0.32 * seal)
    alb_l = 0.5 * lumf
    warm = 1 + 0.06 * stone * (sbright - 0.5)
    alb = to_srgb(np.stack([alb_l * warm, alb_l, alb_l * (2 - warm)], axis=-1))
    rough = 0.86 - 0.12 * stone * sbright + 0.05 * (fine - 0.5) - 0.38 * seal
    ao = cavity_ao(h, 3, 2.0) * (1 - 0.5 * crack)
    return layer(alb, np.ones_like(u), h, rough, ao=ao, nstr=1.6)


def L_slab():
    u, w = coords()
    # 2 x 2 panels of 1.5 m (tile 3 m), tooled joints
    pu, pw = (u * 2) % 1.0, (w * 2) % 1.0
    du = np.minimum(pu, 1 - pu) * N / 2
    dw = np.minimum(pw, 1 - pw) * N / 2
    d = np.minimum(du, dw)
    groove = 1 - smoothstep(0.8, 2.0, d)
    edge = bevel(d, 7.0)
    pid = (np.floor(u * 2) + 2 * np.floor(w * 2)).astype(np.int64)
    ptone = hash_cells(pid, pid * 0, 61)
    broom = fbm2(4, 220, 2, 62)                     # broom finish across the walk
    speck = vn2(256, 256, 63)
    stain = smoothstep(0.6, 0.85, fbm2(5, 5, 4, 64)) * 0.7
    gum = smoothstep(0.30, 0.2, worley(N, 18, seed=65)[0]) * (hash_cells(np.floor(u * 18).astype(np.int64), np.floor(w * 18).astype(np.int64), 66) > 0.93)
    crack_p = (pid == 1)
    cr = (1 - smoothstep(0.0, 0.02, np.abs(ridged(N, 3, 3, seed=67) - 0.9))) * crack_p
    h = 0.6 * edge + 0.4 - 0.5 * groove + 0.03 * (broom - 0.5) + 0.02 * (speck - 0.5) - 0.2 * cr
    lumf = (1 + 0.08 * (ptone - 0.5) + 0.05 * (broom - 0.5) + 0.06 * (speck - 0.5)) * (1 - 0.18 * stain) * (1 - 0.45 * gum) * (1 - 0.35 * groove) * (1 - 0.3 * cr)
    alb = grey(0.5, lumf)
    rough = 0.88 + 0.06 * (broom - 0.5) - 0.2 * gum
    ao = cavity_ao(h, 3, 2.0) * (1 - 0.35 * groove)
    return layer(alb, np.ones_like(u), h, rough, ao=ao, nstr=4.0)


def L_brick():
    u, w = coords()
    rows, cols = 12, 4
    row = np.floor(w * rows).astype(np.int64)
    fr = (w * rows) % 1.0
    x = u * cols + 0.5 * (row % 2)
    col = np.floor(x).astype(np.int64)
    fx = x % 1.0
    dx = np.minimum(fx, 1 - fx) * N / cols
    dy = np.minimum(fr, 1 - fr) * N / rows
    d = np.minimum(dx, dy)
    mortar = 1 - smoothstep(1.6, 2.8, d)
    bid = col * 131 + row
    bt = hash_cells(bid, row, 71)
    bh = hash_cells(bid, row, 72)
    pits = vn2(200, 200, 73) * 0.5 + vn2(100, 100, 74) * 0.5
    h = (0.7 + 0.3 * bevel(d, 4.0) + 0.06 * (pits - 0.5)) * (1 - mortar) + mortar * (0.25 + 0.05 * pits)
    dark = (bt > 0.88)
    lumf = (0.82 + 0.36 * bt) * (1 + 0.12 * (pits - 0.5))
    lumf = np.where(dark, lumf * 0.6, lumf)
    hue = np.stack([1 + 0.08 * (bh - 0.5), 1 - 0.03 * (bh - 0.5), 1 - 0.1 * (bh - 0.5)], axis=-1)
    alb_b = to_srgb(0.5 * lumf[..., None] * hue)
    alb_m = to_srgb(rgb_lin('#aaa59b', 0.9 + 0.2 * pits))
    m = mortar[..., None]
    alb = alb_b * (1 - m) + alb_m * m
    rough = 0.82 + 0.08 * (pits - 0.5) + 0.08 * mortar
    ao = cavity_ao(h, 4, 1.4)
    return layer(alb, 1 - mortar, h, rough, ao=ao, nstr=4.5)


def L_planks():
    u, w = coords()
    boards = 12
    row = np.floor(w * boards).astype(np.int64)
    fr = (w * boards) % 1.0
    off = hash_cells(row, row * 0, 81)
    x = (u + off) * 1.0
    xj = x % 1.0
    jpos = 0.5
    dj = np.abs(xj - jpos) * N
    dy = np.minimum(fr, 1 - fr) * N / boards
    gap = 1 - smoothstep(0.8, 2.0, dy)
    joint = 1 - smoothstep(0.6, 1.6, dj)
    bid = row * 2 + (xj > jpos)
    bt = hash_cells(bid, row, 82)
    grain = fbm2(3, 160, 3, 83)
    knot = smoothstep(0.25, 0.0, worley(N, 7, seed=84)[0]) * (hash_cells(np.floor(u * 7).astype(np.int64), np.floor(w * 7).astype(np.int64), 85) > 0.7)
    # nails near the joints
    nx = np.abs(xj - jpos) * N
    nail = (np.abs(nx - 9) < 2.2) & (np.abs(fr - 0.5) * N / boards > 3) & (np.abs(fr - 0.5) * N / boards < 6.5)
    h = (0.75 + 0.25 * bevel(np.minimum(dy, dj + 30), 3.0) + 0.06 * (grain - 0.5) - 0.1 * knot) * (1 - gap) * (1 - joint * 0.6)
    lumf = (0.8 + 0.4 * bt) * (1 + 0.18 * (grain - 0.5)) * (1 - 0.35 * knot)
    alb_w = grey(0.5, lumf)
    weath = smoothstep(0.55, 0.8, bt)[..., None]
    alb_w = alb_w * (1 - weath * 0.25) + weath * 0.25 * to_srgb(rgb_lin('#9a948a', 0.9 + 0.2 * grain))[...]
    alb_g = to_srgb(rgb_lin('#14110d'))
    gm = np.maximum(gap, joint)[..., None]
    alb = alb_w * (1 - gm) + alb_g * gm
    nm = nail[..., None].astype(np.float32)
    alb = alb * (1 - nm) + nm * to_srgb(rgb_lin('#3a3632'))
    tint = (1 - np.maximum(gap, joint)) * (1 - nail)
    rough = 0.72 + 0.1 * (grain - 0.5) + 0.1 * gap
    ao = cavity_ao(h, 3, 1.8)
    return layer(alb, tint, h, rough, ao=ao, nstr=4.0)


def L_metal():
    u, w = coords()
    peel = vn2(160, 160, 91) * 0.5 + vn2(80, 80, 92) * 0.5
    chips_f = fbm2(6, 6, 4, 93) * 0.6 + vn2(60, 60, 94) * 0.4
    chips = smoothstep(0.76, 0.79, chips_f)
    scratch = (1 - smoothstep(0.0, 0.01, np.abs(ridged(N, 3, 2, seed=95) - 0.97))) * smoothstep(0.6, 0.75, fbm2(3, 3, 2, 96))
    bare = np.maximum(chips, scratch * 0.8)
    grime = fbm2(4, 4, 3, 97)
    h = 0.6 + 0.03 * (peel - 0.5) - 0.12 * bare
    lumf = (1 + 0.05 * (peel - 0.5)) * (1 - 0.15 * smoothstep(0.5, 0.8, grime))
    alb_p = grey(0.5, lumf)
    alb_s = to_srgb(rgb_lin('#9da3aa', 0.85 + 0.3 * vn2(128, 128, 98)))
    b = bare[..., None]
    alb = alb_p * (1 - b) + alb_s * b
    rough = 0.42 + 0.1 * (peel - 0.5) + 0.12 * grime - 0.1 * bare
    return layer(alb, 1 - bare, h, rough, nstr=2.5)


def L_leaves():
    S = N * 2
    r = rng(101)
    hi = Image.new('L', (S, S), 0)
    ci = Image.new('L', (S, S), 0)
    dh, dc = ImageDraw.Draw(hi), ImageDraw.Draw(ci)
    for i in range(1400):
        x, y = r.random() * S, r.random() * S
        L = 26 + r.random() * 30
        W = L * (0.38 + r.random() * 0.15)
        a = r.random() * 2 * math.pi
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        for k in range(14):
            t = k / 13.0
            px = (t - 0.5) * L
            py = math.sin(t * math.pi) ** 0.8 * W * 0.5
            pts.append((px, py))
        pts = pts + [(px, -py) for px, py in reversed(pts[1:-1])]
        hv = int(90 + i / 1400 * 150)
        cv = int(60 + r.random() * 190)
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                if not (-60 < x + ox < S + 60 and -60 < y + oy < S + 60):
                    continue
                poly = [(x + ox + px * ca - py * sa, y + oy + px * sa + py * ca) for px, py in pts]
                dh.polygon(poly, fill=hv)
                dc.polygon(poly, fill=cv)
    h = np.asarray(hi, np.float32) / 255.0
    c = np.asarray(ci, np.float32) / 255.0
    h = resize(h, (N, N))
    c = resize(c, (N, N))
    covered = smoothstep(0.05, 0.3, h)
    hb = blur(h, 1)
    hh = hb * 0.7 + covered * 0.3
    ao = 0.35 + 0.65 * smoothstep(0.1, 0.9, blur(h, 3))
    lumf = (0.75 + 0.5 * c) * (0.55 + 0.45 * covered)
    yel = smoothstep(0.75, 1.0, c)[..., None]
    alb = grey(0.5, lumf)
    alb = alb * np.concatenate([1 + 0.12 * yel, 1 + 0.06 * yel, 1 - 0.2 * yel], axis=-1)
    rough = 0.62 + 0.15 * (1 - covered)
    return layer(alb, np.ones_like(h), hh, rough, ao=ao, nstr=6.0)


def L_dentil():
    u, w = coords()
    per = 4
    x = (u * per) % 1.0
    # zones (w up): fascia 0-0.22, bead 0.26-0.36, dentil blocks 0.42-0.84, crown fillet 0.88-1
    bead = np.clip(1 - ((w - 0.31) / 0.05) ** 2, 0, 1) ** 0.5
    blocks_z = smoothstep(0.40, 0.43, w) * (1 - smoothstep(0.83, 0.86, w))
    bx = np.minimum(x, 1 - x)
    block = smoothstep(0.17, 0.2, bx)
    blk = blocks_z * (0.55 + 0.45 * block * bevel(np.minimum(bx - 0.18, np.minimum(w - 0.43, 0.84 - w)) * N, 3.0).clip(0, 1))
    fillet = smoothstep(0.87, 0.9, w)
    cove = smoothstep(0.0, 0.22, w) * 0.3 * (1 - smoothstep(0.22, 0.25, w))
    h = 0.35 + cove + bead * 0.35 + blk * 0.55 + fillet * 0.5
    gaps = blocks_z * (1 - block)
    ao = 1 - 0.5 * gaps - 0.3 * smoothstep(0.84, 0.88, w) * (1 - fillet)
    grain = fbm2(3, 60, 2, 111)
    alb = grey(0.5, (1 + 0.04 * (grain - 0.5)) * (1 - 0.15 * gaps))
    rough = 0.55 + 0.05 * grain
    return layer(alb, np.ones_like(u), h, rough, ao=ao, nstr=5.0)


def L_scales():
    u, w = coords()
    cols, rows = 5, 6
    asp = (1.0 / cols) / (1.0 / rows)  # scale width / row height
    out_h = np.zeros_like(u)
    out_id = np.zeros_like(u)
    out_f = np.zeros_like(u)
    base_row = np.floor(w * rows).astype(np.int64)
    fr0 = (w * rows) % 1.0
    picked = np.zeros(u.shape, bool)
    for dr in (0, -1):
        row = base_row + dr
        fr = fr0 - dr  # relative to that row's bottom (row below: 1..2)
        x = u * cols + 0.5 * (row % 2)
        k = np.floor(x)
        lx = (x - k) - 0.5
        edge = (0.5 - np.sqrt(np.clip(0.25 - lx * lx, 0, None))) * asp
        inside = (fr >= edge) & ~picked
        hh = 1.0 - 0.35 * (fr - edge) + 0.15 * np.sqrt(np.clip(0.25 - lx * lx, 0, None))
        rim = smoothstep(0.0, 0.08, fr - edge)
        hh = hh * (0.8 + 0.2 * rim)
        sid = hash_cells(k.astype(np.int64), row, 121)
        out_h = np.where(inside, hh, out_h)
        out_id = np.where(inside, sid, out_id)
        out_f = np.where(inside, fr - edge, out_f)
        picked |= inside
    gran = vn2(160, 160, 122)
    h = out_h + 0.03 * (gran - 0.5)
    shadow = smoothstep(0.75, 1.15, out_f)
    ao = 1 - 0.45 * shadow
    lumf = (1 + 0.2 * (out_id - 0.5) + 0.08 * (gran - 0.5)) * (1 - 0.2 * shadow)
    alb = grey(0.5, lumf)
    rough = 0.65 + 0.1 * (gran - 0.5)
    return layer(alb, np.ones_like(u), blur(h, 1), rough, ao=ao, nstr=4.0)


def L_ground():
    u, w = coords()
    blades = vn2(256, 256, 131) * 0.5 + vn2(512, 128, 132) * 0.25 + vn2(128, 512, 133) * 0.25
    clump = fbm2(16, 16, 3, 134)
    dirt = smoothstep(0.55, 0.7, fbm2(4, 4, 4, 135))
    h = 0.5 + 0.25 * (blades - 0.5) + 0.2 * (clump - 0.5) - 0.15 * dirt
    lumf = (1 + 0.35 * (blades - 0.5) + 0.25 * (clump - 0.5)) * (1 - 0.15 * dirt)
    alb = grey(0.5, lumf)
    d = dirt[..., None]
    alb = alb * (1 - d * 0.6) + d * 0.6 * alb * np.array([1.18, 0.98, 0.72], np.float32)
    rough = 0.92 - 0.04 * blades
    return layer(alb, np.ones_like(u), h, rough, nstr=4.0)


def L_stone():
    u, w = coords()
    rows = 5
    row = np.floor(w * rows).astype(np.int64)
    fr = (w * rows) % 1.0
    # blocks of random length per row (3 or 4 per row)
    nb = 3 + (hash_cells(row, row * 0, 141) > 0.5)
    off = hash_cells(row, row * 0, 142)
    x = (u + off) * nb
    k = np.floor(x).astype(np.int64)
    fx = x % 1.0
    dx = np.minimum(fx, 1 - fx) * N / nb
    dy = np.minimum(fr, 1 - fr) * N / rows
    d = np.minimum(dx, dy)
    joint = 1 - smoothstep(1.5, 3.5, d)
    bid = k * 17 + row * 5
    bt = hash_cells(bid, row, 143)
    rock = fbm(N, 12, 5, seed=144)
    pits = smoothstep(0.35, 0.15, worley(N, 40, seed=145)[0]) * 0.5
    dome = bevel(d, 14.0)
    h = (0.45 + 0.35 * dome + 0.25 * (rock - 0.5) - 0.1 * pits) * (1 - joint) + joint * 0.1
    lumf = (0.85 + 0.3 * bt) * (1 + 0.25 * (rock - 0.5)) * (1 - 0.2 * pits)
    lumf = lumf * (1 - 0.5 * joint)
    alb = grey(0.5, lumf)
    rough = 0.85 + 0.06 * (rock - 0.5)
    ao = cavity_ao(h, 5, 1.5)
    return layer(alb, np.ones_like(u), h, rough, ao=ao, nstr=5.0)


def L_canvas():
    u, w = coords()
    t = 128
    a = np.sin(u * t * 2 * math.pi) * 0.5 + 0.5
    b = np.sin(w * t * 2 * math.pi) * 0.5 + 0.5
    weave = np.where(((np.floor(u * t * 2) + np.floor(w * t * 2)) % 2) == 0, a, b)
    seam = 1 - smoothstep(0.0, 0.006, np.abs(((u * 2) % 1.0) - 0.5) - 0.0)
    fold = fbm2(2, 3, 3, 151)
    h = 0.5 + 0.2 * (weave - 0.5) + 0.2 * (fold - 0.5) - 0.2 * seam
    alb = grey(0.5, (1 + 0.1 * (weave - 0.5)) * (1 + 0.08 * (fold - 0.5)) * (1 - 0.15 * seam))
    rough = 0.8 + 0.05 * weave
    return layer(alb, np.ones_like(u), h, rough, nstr=2.5)


def L_tar():
    u, w = coords()
    f1, f2, cid = worley(N, 90, seed=161)
    stone = smoothstep(0.5, 0.2, f1)
    sv = (cid * 997) % 1.0
    seam = 1 - smoothstep(0.0, 0.005, np.abs(((w * 2) % 1.0) - 0.5))
    blot = fbm2(5, 5, 3, 162)
    h = 0.4 + 0.4 * stone * (0.7 + 0.3 * sv) + 0.15 * seam
    lumf = (0.7 + 0.6 * stone * sv) * (1 + 0.2 * (blot - 0.5)) * (1 + 0.2 * seam)
    alb = grey(0.5, lumf)
    alb = alb * (1 + 0.08 * (sv[..., None] - 0.5) * np.array([1, 0.3, -0.6], np.float32))
    rough = 0.9 - 0.1 * seam
    return layer(alb, np.ones_like(u), h, rough, ao=cavity_ao(h, 3, 1.8), nstr=3.5)


def L_concrete():
    u, w = coords()
    blot = fbm2(4, 4, 5, 171)
    pores = smoothstep(0.12, 0.04, worley(N, 70, seed=172)[0]) * (vn2(70, 70, 173) > 0.55)
    form = 1 - smoothstep(0.0, 0.004, np.abs(((w * 4) % 1.0) - 0.5))
    speck = vn2(256, 256, 174)
    streak = fbm2(30, 2, 3, 175)
    h = 0.5 + 0.06 * (blot - 0.5) - 0.25 * pores + 0.04 * form + 0.03 * (speck - 0.5)
    lumf = (1 + 0.14 * (blot - 0.5) + 0.06 * (speck - 0.5)) * (1 - 0.35 * pores) * (1 - 0.12 * smoothstep(0.55, 0.8, streak))
    alb = grey(0.5, lumf)
    rough = 0.8 + 0.08 * (blot - 0.5)
    return layer(alb, np.ones_like(u), h, rough, ao=cavity_ao(h, 3, 1.4), nstr=3.0)


def L_window():
    u, w = coords()
    # double-hung sash in a 1.05 x 1.9 m opening: stiles, rails, the meeting rail, a muntin in the upper sash
    px_u, px_w = 1.05 / N, 1.9 / N   # metres per pixel
    du = np.minimum(u, 1 - u) * 1.05      # metres to the side
    dwb = w * 1.9
    dwt = (1 - w) * 1.9
    meet = np.abs(w - 0.52) * 1.9
    mun = np.abs(u - 0.5) * 1.05
    fr_side = 0.075
    d = np.minimum.reduce([du - fr_side, dwb - 0.1, dwt - 0.07, meet - 0.035, np.where(w > 0.52, mun - 0.016, 9)])
    frame = d < 0
    # rounded profile of the members (distance inside the member)
    din = np.maximum(-d, 0)
    prof = np.sin(np.clip(din / 0.02, 0, 1) * math.pi / 2)
    putty = (d >= 0) & (d < 0.006)
    h = np.where(frame, 0.55 + 0.45 * prof, 0.15)
    h = np.where(putty, 0.3, h)
    grain = fbm2(2, 30, 2, 181)
    alb = grey(0.5, 1 + 0.04 * (grain - 0.5))
    tint = frame.astype(np.float32)
    alb = np.where(frame[..., None], alb, np.array([0.05, 0.06, 0.07], np.float32))
    rough = np.where(frame, 0.5, 0.04)
    ao = np.where(frame, 1.0, 1 - 0.4 * (1 - smoothstep(0.0, 0.03, d)))
    return layer(alb, tint, blur(h, 1), rough, ao=ao, nstr=6.0)


def L_manhole():
    u, w = coords()
    x, y = u - 0.5, w - 0.5
    r = np.sqrt(x * x + y * y) * 2  # 0 centre .. 1 rim
    a = np.arctan2(y, x)
    rim = (r > 0.88) & (r < 0.99)
    disc = r < 1.0
    # raised pattern: concentric rings + a grid of bosses, a central medallion, two pick holes
    rings = (np.sin(r * 2 * math.pi * 6) > 0.6) & (r < 0.82) & (r > 0.25)
    gx, gy = (u * 22) % 1.0, (w * 22) % 1.0
    boss = (np.abs(gx - 0.5) < 0.22) & (np.abs(gy - 0.5) < 0.22) & (r < 0.82) & (r > 0.28) & ~rings
    med = r < 0.22
    medring = (np.abs(r - 0.18) < 0.025)
    star = med & (np.cos(a * 5) * 0.06 + 0.1 > r)
    holes = (np.sqrt((x - 0.33) ** 2 + y ** 2) < 0.025) | (np.sqrt((x + 0.33) ** 2 + y ** 2) < 0.025)
    raised = rim | rings | boss | medring | star
    h = np.where(raised, 0.8, 0.45)
    h = np.where(holes, 0.05, h)
    h = np.where(disc, h, 0.4)
    hb = blur(h.astype(np.float32), 1)
    wear = vn2(64, 64, 191)
    alb_l = np.where(raised, 0.62 + 0.2 * wear, 0.42)
    rust = (~raised) & disc & (vn2(40, 40, 192) > 0.45)
    alb = grey(0.5, alb_l / 0.5)
    rust_c = to_srgb(rgb_lin('#5b3a26', 0.8 + 0.4 * wear))
    alb = np.where(rust[..., None], alb * 0.4 + rust_c * 0.6, alb)
    alb = np.where(holes[..., None], 0.02, alb)
    tint = np.where(rust, 0.3, 1.0)
    rough = np.where(raised, 0.3 + 0.1 * wear, 0.75)
    rough = np.where(rust, 0.9, rough)
    return layer(alb, tint, hb, rough, ao=cavity_ao(hb, 3, 2.0), nstr=6.0)


# ------------------------------------------------------------------------------------------------ foliage atlas
# city_foliage: RGBA 1024 x 1024 (half 512), 2 x 2 tiles of 512 (u right, v up after the flipY upload):
#   tile 0 (u 0-0.5, v 0-0.5)  broadleaf cluster card (street trees, parks): alpha-tested leaves, grey-green (tinted
#                              by the vertex colour like the array layers), darker toward the twig
#   tile 1 (u 0.5-1, v 0-0.5)  palm frond: base at u = 0, tip at u = 1, midrib at v = 0.5
#   tile 2 (u 0-0.5, v 0.5-1)  bark (opaque, tiles vertically): fissured, tinted
#   tile 3 (u 0.5-1, v 0.5-1)  needle / small-leaf cluster (the Presidio's cypresses and pines)
def _leaf_poly(L, W, n=12):
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append(((t - 0.0) * L, math.sin(t * math.pi) ** 0.75 * W * 0.5))
    return pts + [(x, -y) for x, y in reversed(pts[1:-1])]


def foliage_atlas():
    T = 512
    S = T * 2  # supersampled tile
    r = rng(901)

    def card(kind):
        col = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(col)
        cx, cy = S / 2, S / 2
        if kind == 'leaf':
            # twigs radiating from the centre, leaves along them (back ones darker), filling a disc
            leaves = []
            for tw in range(11):
                a0 = tw / 11 * 2 * math.pi + (r.random() - 0.5) * 0.4
                L = S * (0.3 + r.random() * 0.12)
                for k in range(11):
                    t = (k + 1) / 11
                    bx = cx + math.cos(a0) * L * t
                    by = cy + math.sin(a0) * L * t
                    side = 1 if k % 2 else -1
                    a = a0 + side * (0.5 + r.random() * 0.6)
                    leaves.append((bx, by, a, S * (0.07 + r.random() * 0.05), t, r.random()))
            leaves.sort(key=lambda q: q[5])
            for bx, by, a, ll, t, depth in leaves:
                g = int(95 + 120 * depth * (0.6 + 0.4 * t))
                hue = r.random()
                c = (int(g * (0.9 + 0.14 * hue)), g, int(g * (0.76 + 0.12 * hue)), 255)
                ca, sa = math.cos(a), math.sin(a)
                poly = [(bx + x * ca - y * sa, by + x * sa + y * ca) for x, y in _leaf_poly(ll, ll * 0.5)]
                d.polygon(poly, fill=c)
                d.line([(bx, by), (bx + ca * ll * 0.9, by + sa * ll * 0.9)], fill=(int(g * 0.78), int(g * 0.84), int(g * 0.68), 255), width=2)
        elif kind == 'needle':
            for k in range(3600):
                a = r.random() * 2 * math.pi
                rr = (r.random() ** 0.5) * S * 0.46
                x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.9
                ll = S * (0.02 + r.random() * 0.03)
                b = a + (r.random() - 0.5) * 1.2
                g = int(90 + 100 * (1 - rr / (S * 0.45)) * r.random() + 40)
                d.line([(x, y), (x + math.cos(b) * ll, y + math.sin(b) * ll)], fill=(int(g * 0.85), g, int(g * 0.8), 255), width=4)
        elif kind == 'frond':
            # midrib along x (base left -> tip right), leaflets angled toward the tip
            y0 = S / 2
            d.line([(0, y0), (S, y0)], fill=(150, 140, 100, 255), width=7)
            n = 46
            for k in range(n):
                t = (k + 0.5) / n
                x = t * S
                for side in (-1, 1):
                    ll = S * 0.46 * (math.sin(min(1.0, t * 1.15) * math.pi) ** 0.6) * (0.85 + 0.15 * r.random())
                    a = side * (math.pi / 2 - 0.55 - 0.25 * t)
                    ex, ey = x + math.cos(a) * ll * 0.55, y0 + math.sin(a) * ll
                    w = S * 0.012 * (1.2 - t)
                    g = int(140 + 70 * r.random())
                    poly = [(x - w, y0), (x + w, y0), (ex + w * 0.2, ey), (ex - w * 0.2, ey)]
                    d.polygon(poly, fill=(int(g * 0.9), g, int(g * 0.72), 255))
        return col

    def to_arr(img):
        a = np.asarray(img, np.float32) / 255.0
        a = resize(a, (T, T))
        rgb = a[..., :3] / np.maximum(a[..., 3:4], 1e-3)  # un-premultiply the box filter
        return np.concatenate([np.clip(rgb, 0, 1), a[..., 3:4]], axis=-1)

    leaf = to_arr(card('leaf'))
    frond = to_arr(card('frond'))
    needle = to_arr(card('needle'))
    # bark: vertical fissures, plates
    u, v = grid(T)
    fis = 1 - np.abs(vn2(10, 3, 911, T) * 2 - 1)
    plates = fbm2(6, 14, 3, 912, n=T)
    hb = 0.55 * plates + 0.45 * smoothstep(0.55, 0.95, fis)
    bl = (0.75 + 0.5 * hb) * (1 + 0.1 * (vn2(64, 64, 913, T) - 0.5))
    bark = np.concatenate([grey(0.5, bl)[:T, :T], np.ones((T, T, 1), np.float32)], axis=-1)
    # alpha-tested cards: bleed the colour of the leaves into the transparent texels (no dark fringes in the mips)
    for a in (leaf, frond, needle):
        m = a[..., 3] > 0.05
        fill = a[..., :3][m].mean(axis=0)
        a[..., :3][~m] = fill
    top = np.concatenate([bark, needle], axis=1)   # v 0.5..1 (image top)
    bot = np.concatenate([leaf, frond], axis=1)    # v 0..0.5
    return np.concatenate([top, bot], axis=0)


# order = array layer index (must match the L_* constants in src/25-city.js)
LAYERS = [
    ('paintwood', L_paintwood),   # 0
    ('siding', L_siding),         # 1
    ('shingle', L_shingle),       # 2
    ('asphalt', L_asphalt),       # 3
    ('slab', L_slab),             # 4
    ('brick', L_brick),           # 5
    ('planks', L_planks),         # 6
    ('metal', L_metal),           # 7
    ('leaves', L_leaves),         # 8
    ('dentil', L_dentil),         # 9
    ('scales', L_scales),         # 10
    ('ground', L_ground),         # 11
    ('stone', L_stone),           # 12
    ('canvas', L_canvas),         # 13
    ('tar', L_tar),               # 14
    ('concrete', L_concrete),     # 15
    ('window', L_window),         # 16
    ('manhole', L_manhole),       # 17
]


def build():
    albs, nrms, prev = [], [], []
    for name, fn in LAYERS:
        L = fn()
        n = height_to_normal(L['h'], strength=L['nstr'] * N / 512 * 6.0)
        alb = np.concatenate([L['alb'], (0.5 + 0.5 * L['tint'])[..., None]], axis=-1)
        nrm = np.concatenate([n[..., :2], L['rough'][..., None], (0.5 + 0.5 * L['ao'])[..., None]], axis=-1)
        albs.append(alb)
        nrms.append(nrm)
        prev.append((name, L, n))
        print('layer %-10s alb lin mean %.3f  tint %.2f  rough %.2f  ao %.2f' % (
            name, float(srgb_to_linear(L['alb']).mean()), float(L['tint'].mean()), float(L['rough'].mean()), float(L['ao'].mean())))
    # strip: layer 0 at the BOTTOM (rows are flipped at decode time)
    alb_strip = np.concatenate(albs[::-1], axis=0)
    nrm_strip = np.concatenate(nrms[::-1], axis=0)
    return alb_strip, nrm_strip, prev


def preview(prev, path):
    tiles = []
    for name, L, n in prev:
        a = L['alb']
        sample = np.array([0.75, 0.55, 0.45], np.float32)  # a paint colour to show the tint
        lin = srgb_to_linear(a)
        t = L['tint'][..., None]
        shown = linear_to_srgb(np.clip(lin * (1 - t) + lin * 2 * srgb_to_linear(sample) * t, 0, 1))
        shade = np.clip(0.35 + 0.65 * ((n[..., :3] * 2 - 1) @ np.array([-0.5, 0.5, 0.7071], np.float32)), 0, 1)
        lit = np.clip(shown * shade[..., None] * L['ao'][..., None] * 1.3, 0, 1)
        r3 = np.repeat(L['rough'][..., None], 3, -1)
        tiles.append(np.concatenate([lit, n, r3], axis=1))
    rows = []
    for i in range(0, len(tiles), 3):
        row = tiles[i:i + 3]
        while len(row) < 3:
            row.append(np.zeros_like(tiles[0]))
        rows.append(np.concatenate(row, axis=1))
    img = np.concatenate(rows, axis=0)
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGB')
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for i, (name, _, _) in enumerate(prev):
        x, y = (i % 3) * (N * 3 // 2), (i // 3) * (N // 2)
        d.rectangle([x, y, x + 120, y + 14], fill=(0, 0, 0))
        d.text((x + 3, y + 2), '%d %s' % (i, name), fill=(255, 255, 0))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print('preview', path)


if __name__ == '__main__':
    alb, nrm, prev = build()
    m = Manifest('city')
    m.add('city_alb', alb, colorspace='srgb', group='act2', quality=88)
    m.add('city_nrm', nrm, colorspace='linear', group='act2', quality=92)
    # per-layer means (bytes, layer 0 first): the runtime fills its 1x1 placeholder layers with them, so the city is
    # shaded the same (minus the detail) before the strips arrive
    L = len(LAYERS)
    ma, mn = [], []
    for k in range(L):
        ta = alb[(L - 1 - k) * N:(L - k) * N]
        tn = nrm[(L - 1 - k) * N:(L - k) * N]
        rgb = linear_to_srgb(srgb_to_linear(ta[..., :3]).reshape(-1, 3).mean(axis=0))
        ma.append([int(round(float(v) * 255)) for v in rgb] + [int(round(float(ta[..., 3].mean()) * 255))])
        mn.append([128, 128] + [int(round(float(tn[..., c].mean()) * 255)) for c in (2, 3)])
    m.data['textures']['city_alb']['means'] = ma
    m.data['textures']['city_nrm']['means'] = mn
    fol = foliage_atlas()
    m.add('city_foliage', fol, colorspace='srgb', group='act2', quality=90)
    if '--preview' in sys.argv:
        Image.fromarray((np.clip(fol, 0, 1) * 255).astype(np.uint8), 'RGBA').save(os.path.join(os.path.dirname(__file__), '..', '..', 'dev', 'city', 'foliage.png'))
    m.data['layers'] = [n for n, _ in LAYERS]
    m.data['tile'] = N
    m.save()
    if '--preview' in sys.argv:
        preview(prev, os.path.join(os.path.dirname(__file__), '..', '..', 'dev', 'city', 'texprev.png'))
