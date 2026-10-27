"""Entities textures (rings, robots, springs, monitors, boss, capsule) — ENTITIES role (SPEC3 §5).

python3 tools/tex/entities_tex.py   -> assets/tex/entities/*.webp + manifest entries

  detail     (512², linear data, group 'act1'): micro-detail heights sampled triplanar in each model's own space (the
             procedural models have no UVs), bump-mapped by the shared entity material, one channel per surface kind:
             R = paint: fine orange peel + a few soft dents (clearcoated painted metal of the robots, boss, capsule)
             G = machined / brushed metal: long anisotropic streaks + fine scratches (steel parts, chrome trims)
             B = rubber / soft plastic: pebbled grain (tyres, bumpers, the springs' pads)
             A = wear: low-frequency smudges + thin scratches (roughness variation and a little grime on every kind)
All tiling, generated from scratch (no downloaded art).
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import Manifest, rng, grid, value_noise, gradient_noise, fbm, worley, blur, smoothstep

m = Manifest('entities')
N = 512


def norm01(a):
    a = a - a.min()
    return a / max(1e-6, a.max())


def scratches(n, count, seed, length=(0.04, 0.18), width=0.6):
    """Thin straight scratches (tiling: drawn with wrap-around), 0..1 intensity."""
    r = rng(seed)
    img = np.zeros((n, n), np.float32)
    for _ in range(count):
        x0, y0 = r.random() * n, r.random() * n
        ang = r.random() * np.pi
        ln = (length[0] + r.random() * (length[1] - length[0])) * n
        k = int(ln * 2)
        t = np.linspace(0, 1, k)
        xs = (x0 + np.cos(ang) * ln * t).astype(np.int64) % n
        ys = (y0 + np.sin(ang) * ln * t).astype(np.int64) % n
        a = 0.35 + r.random() * 0.65
        img[ys, xs] = np.maximum(img[ys, xs], a * np.sin(t * np.pi) ** 0.5)
    return np.clip(blur(img, width), 0, 1) if width > 0 else img


def detail():
    # R: orange peel (two fine gradient-noise octaves) + rare soft dents
    peel = gradient_noise(N, 48, 11) * 0.6 + gradient_noise(N, 96, 12) * 0.4
    dents = smoothstep(0.78, 0.95, value_noise(N, 6, 13)) * 0.35
    r = norm01(peel - dents)
    # G: brushed streaks: noise stretched along x (few lattice cells across x, many down y) + scratches
    st = value_noise(N, 2, 21, None)
    u, v = grid(N)
    lat = rng(22).random((256, 3), dtype=np.float32)
    from texlib import sample_smooth
    streak = sample_smooth(lat, u * 3, v * 256)
    streak2 = sample_smooth(rng(23).random((128, 2), dtype=np.float32), u * 2 + 0.3, v * 128)
    g = norm01(streak * 0.6 + streak2 * 0.4 + st * 0.15 - scratches(N, 60, 24, (0.05, 0.3), 0.4) * 0.5)
    # B: pebbled rubber grain (inverted worley bumps) with fine noise
    f1, f2, _ = worley(N, 40, 31)
    peb = np.clip(1 - f1 / 0.55, 0, 1) ** 1.5
    b = norm01(peb * 0.8 + gradient_noise(N, 128, 32) * 0.2)
    # A: wear (low frequency smudges, 0.5 = neutral) + scratches
    sm = fbm(N, 4, 5, 41)
    a = np.clip(0.5 + (sm - 0.5) * 0.9 + scratches(N, 90, 42, (0.03, 0.12), 0.5) * 0.45, 0, 1)
    return np.stack([r, g, b, a], axis=-1)


m.add('detail', detail(), colorspace='linear', group='act1', lossless=True)
m.save()
