"""Foundation sample: one small tiling stone texture set that proves the K.tex pipeline end to end
(generated here -> WebP full + half -> manifest -> K.tex.load with the right colour space). Not used by the game's
scenery; test/e2e.js loads it ('foundation/sample_albedo', 'foundation/sample_normal').

python3 tools/tex/foundation_sample.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import (Manifest, worley, fbm, value_noise, domain_warp, height_to_normal, cavity_ao, colorize, orm,
                    smoothstep)

N = 256
m = Manifest('foundation')
# cobbles: cellular stones, warped edges, fbm surface detail
f1, f2, cid = worley(N, 6, seed=11)
edge = smoothstep(0.02, 0.16, f2 - f1)
detail = fbm(N, 8, octaves=4, seed=5)
wx, wy = value_noise(N, 4, seed=21), value_noise(N, 4, seed=22)
h = domain_warp(edge * (0.75 + 0.25 * cid) + detail * 0.18, wx, wy, 3.0)
tone = 0.35 + 0.4 * cid + 0.25 * detail
albedo = colorize(tone, [(0.0, '#5d5a55'), (0.5, '#8a847a'), (1.0, '#b9b0a0')]) * (0.55 + 0.45 * edge[..., None])
m.add('sample_albedo', albedo, colorspace='srgb', group='none')
m.add('sample_normal', height_to_normal(h, strength=5.0), colorspace='linear', group='none')
m.add('sample_orm', orm(ao=cavity_ao(h, 4), rough=0.7 + 0.25 * (1 - edge), metal=0.0), colorspace='linear', group='none')
m.save()
