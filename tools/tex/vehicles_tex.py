"""vehicles_tex — the vehicle atlas of Kit Rush 3D (SPEC3 §4/§5, role: vehicles).

One 512 x 512 sRGB atlas, assets/tex/vehicles/veh_atlas.webp (+ _half), group 'act2', clamp:
RGB = albedo, A = emission mask (1 = the pixel glows when the surface emits: signs, LED dots).
Everything is drawn here (DejaVu Sans glyphs, generic text, no real plate numbers, brands or places).
The UV layout (pixels, origin top-left of the image; the runtime flips: v = 1 - y / 512) is mirrored in
src/26-vehicles.js (ATL):
  plates      8 x (128 x 64)   x 0..256,   y 0..256  (2 columns x 4 rows)
  taxi sign   256 x 64         x 256..512, y 0..64
  bus sign    256 x 64         x 256..512, y 64..128
  tram sign   256 x 64         x 256..512, y 128..192
  cable sign  256 x 64         x 256..512, y 192..256
  van logo    256 x 128        x 0..256,   y 256..384
  works sign  128 x 128        x 256..384, y 256..384
  grille      128 x 128        x 384..512, y 256..384  (mesh pattern, tiles)
  tyre wall   512 x 32         x 0..512,   y 384..416  (sidewall ring lettering, wraps in u)
  bus band    512 x 64         x 0..512,   y 416..480  (side livery band: stripes + route name)
  dashboard   512 x 32         x 0..512,   y 480..512  (dark interior strip: seats / headrests silhouettes)
Run: python3 tools/tex/vehicles_tex.py [--preview]   (--preview also writes dev/vehicles/texprev.png)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from texlib import Manifest, ROOT  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont, ImageFilter  # noqa: E402

N = 512
EMIT = np.zeros((N, N), np.float32)  # emission mask (A channel)
FONT_DIR = '/usr/share/fonts/truetype/dejavu/'


def font(size, bold=True, mono=False, cond=False):
    name = ('DejaVuSansMono' if mono else 'DejaVuSans') + ('-Bold' if bold else '') + '.ttf'
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    except OSError:
        return ImageFont.load_default()


def text_c(d, box, txt, f, fill, stretch=1.0, img=None):
    """Draws txt centred in box (x0, y0, x1, y1); stretch < 1 squeezes it horizontally (condensed look)."""
    x0, y0, x1, y1 = box
    l, t, r, b = d.textbbox((0, 0), txt, font=f)
    w, h = r - l, b - t
    if stretch == 1.0 or img is None:
        d.text(((x0 + x1 - w) / 2 - l, (y0 + y1 - h) / 2 - t), txt, font=f, fill=fill)
        return
    tmp = Image.new('RGBA', (w + 4, h + 4), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((2 - l, 2 - t), txt, font=f, fill=fill)
    nw = max(1, int((w + 4) * stretch))
    tmp = tmp.resize((nw, h + 4), Image.LANCZOS)
    img.alpha_composite(tmp, (int((x0 + x1 - nw) / 2), int((y0 + y1 - h - 4) / 2)))


def plates(img, d):
    # generic plates: pale background, a coloured top band with a word, 7 random characters, small corner bolts
    rnd = np.random.default_rng(7)
    styles = [('#f2efe6', '#1f3f8a', '#1a1a1a'), ('#fbf6d8', '#a8322a', '#20202a'), ('#eef3f6', '#2b6e3f', '#1a1a1a'),
              ('#f6efe2', '#c27a12', '#2a1e14'), ('#f2f2f0', '#3c3c64', '#1a1a2a'), ('#fff7c8', '#1d5f8a', '#141414'),
              ('#eaf0ea', '#7a2a6a', '#1a1a1a'), ('#f5f1ea', '#2a2a2a', '#8a1a1a')]
    chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
    for k in range(8):
        x0, y0 = (k % 2) * 128, (k // 2) * 64
        bg, band, ink = styles[k]
        d.rounded_rectangle([x0 + 2, y0 + 3, x0 + 125, y0 + 60], radius=6, fill=bg, outline='#5a5a5a', width=2)
        d.rectangle([x0 + 6, y0 + 7, x0 + 121, y0 + 17], fill=band)
        text_c(d, (x0 + 6, y0 + 6, x0 + 121, y0 + 18), ['COLLINE', 'BAIE', 'CITE', 'PORT', 'VALLEE', 'PHARE', 'QUAIS', 'PONT'][k], font(9), '#ffffff')
        s = ''.join(chars[int(i)] for i in rnd.integers(0, len(chars), 7))
        s = s[:3] + ' ' + s[3:]
        text_c(d, (x0 + 6, y0 + 19, x0 + 121, y0 + 57), s, font(30, mono=True), ink, stretch=0.62, img=img)
        for bx in (x0 + 12, x0 + 115):
            d.ellipse([bx - 2, y0 + 8, bx + 2, y0 + 12], fill='#9a9a9a')


def led_sign(img, box, txt, color, bg='#0b0b0c', size=40):
    """Dot-matrix LED destination sign: glyphs rasterised on a dot grid; A = 1 on lit dots."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    m = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(m)
    f = font(size)
    l, t, r, b = md.textbbox((0, 0), txt, font=f)
    tw, th = r - l, b - t
    sc = min(1.0, (w - 12) / max(tw, 1))
    tmp = Image.new('L', (tw + 4, th + 4), 0)
    ImageDraw.Draw(tmp).text((2 - l, 2 - t), txt, font=f, fill=255)
    tmp = tmp.resize((max(1, int((tw + 4) * sc)), th + 4), Image.LANCZOS)
    m.paste(tmp, ((w - tmp.width) // 2, (h - tmp.height) // 2))
    a = np.asarray(m, np.float32) / 255
    # dot grid: 3 px pitch, round dots
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = (xx // 3) * 3 + 1, (yy // 3) * 3 + 1
    dots = (np.hypot(xx - cx, yy - cy) < 1.25).astype(np.float32)
    on = (a[cy.clip(0, h - 1), cx.clip(0, w - 1)] > 0.45).astype(np.float32) * dots
    base = np.array(Image.new('RGB', (w, h), bg), np.float32) / 255
    col = np.array(Image.new('RGB', (1, 1), color), np.float32)[0, 0] / 255
    off = dots[..., None] * 0.08
    rgb = base * (1 - dots[..., None]) + (base + off) * dots[..., None]
    rgb = rgb * (1 - on[..., None]) + col * on[..., None]
    rgba = np.concatenate([rgb, np.ones_like(on[..., None])], axis=-1)
    img.paste(Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA'), (x0, y0))
    EMIT[y0:y1, x0:x1] = on


def taxi_sign(img, d):
    x0, y0 = 256, 0
    d.rectangle([x0, y0, x0 + 255, y0 + 63], fill='#f6d33a')
    for i in range(16):  # checker band at the bottom
        for j in range(2):
            if (i + j) % 2 == 0:
                d.rectangle([x0 + i * 16, y0 + 48 + j * 8, x0 + i * 16 + 15, y0 + 55 + j * 8], fill='#151515')
    text_c(d, (x0, y0 + 2, x0 + 256, y0 + 48), 'TAXI', font(40), '#151515')
    # the lit panel glows (A = 1) except the black glyphs / checks
    a = np.asarray(img)[y0:y0 + 64, x0:x0 + 256, :3].astype(np.float32).mean(-1) / 255
    EMIT[y0:y0 + 64, x0:x0 + 256] = (a > 0.4).astype(np.float32)


def van_logo(img, d):
    # an original parcel courier livery: white panel, a fox-orange swoosh, a parcel icon and "COLIS EXPRESS"
    x0, y0 = 0, 256
    d.rectangle([x0, y0, x0 + 255, y0 + 127], fill='#f4f2ee')
    pts = [(x0, y0 + 96), (x0 + 90, y0 + 78), (x0 + 255, y0 + 92), (x0 + 255, y0 + 112), (x0 + 100, y0 + 98), (x0, y0 + 118)]
    d.polygon(pts, fill='#e8692a')
    pts2 = [(x0, y0 + 118), (x0 + 100, y0 + 98), (x0 + 255, y0 + 112), (x0 + 255, y0 + 127), (x0, y0 + 127)]
    d.polygon(pts2, fill='#23365e')
    # parcel icon
    d.rectangle([x0 + 18, y0 + 22, x0 + 62, y0 + 62], fill='#c8935a', outline='#6a4a2a', width=2)
    d.line([x0 + 40, y0 + 22, x0 + 40, y0 + 62], fill='#e9d6a8', width=5)
    d.line([x0 + 18, y0 + 42, x0 + 62, y0 + 42], fill='#e9d6a8', width=3)
    for k in range(3):
        d.line([x0 + 4 + k * 3, y0 + 30 + k * 10, x0 + 14, y0 + 30 + k * 10], fill='#e8692a', width=3)
    text_c(d, (x0 + 66, y0 + 18, x0 + 252, y0 + 46), 'COLIS', font(26), '#23365e')
    text_c(d, (x0 + 66, y0 + 44, x0 + 252, y0 + 70), 'EXPRESS', font(22), '#e8692a')


def works_sign(img, d):
    # round blue "keep left" sign: white disc rim, white arrow pointing down-left
    x0, y0 = 256, 256
    d.rectangle([x0, y0, x0 + 127, y0 + 127], fill='#d9d9d6')
    d.ellipse([x0 + 4, y0 + 4, x0 + 123, y0 + 123], fill='#f2f2f2')
    d.ellipse([x0 + 10, y0 + 10, x0 + 117, y0 + 117], fill='#1d5fb8')
    c = np.array([x0 + 64.0, y0 + 64.0])
    # arrow along +x (shaft + head), then rotated by 135 deg (down-left on the image)
    shape = [(-34, -7), (8, -7), (8, -20), (34, 0), (8, 20), (8, 7), (-34, 7)]
    a = np.radians(135)
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    pts = [tuple(c + R @ np.array(p, float)) for p in shape]
    d.polygon(pts, fill='#ffffff')


def grille(img, d):
    # dark honeycomb mesh (drawn in its own 128 x 128 tile, then pasted: nothing spills over the neighbours)
    x0, y0 = 384, 256
    t = Image.new('RGBA', (128, 128), '#2a2b2e')
    td = ImageDraw.Draw(t)
    for j in range(-1, 10):
        for i in range(-1, 9):
            cx = i * 16 + (8 if j % 2 else 0)
            cy = j * 14 + 7
            td.regular_polygon((cx, cy, 6.5), 6, rotation=30, fill='#060607')
    img.paste(t, (x0, y0))


def tyre_wall(img, d):
    # sidewall: black rubber with two thin rings and repeated generic size text (bumped later in the shader as albedo)
    x0, y0 = 0, 384
    d.rectangle([x0, y0, x0 + 511, y0 + 31], fill='#161617')
    d.line([x0, y0 + 4, x0 + 511, y0 + 4], fill='#2a2a2c', width=1)
    d.line([x0, y0 + 27, x0 + 511, y0 + 27], fill='#2a2a2c', width=1)
    for k in range(2):
        text_c(d, (x0 + k * 256, y0 + 6, x0 + k * 256 + 140, y0 + 26), 'ALL SEASON', font(13), '#3a3a3d')
        text_c(d, (x0 + k * 256 + 140, y0 + 6, x0 + k * 256 + 256, y0 + 26), '205/55', font(13), '#3a3a3d')


def bus_band(img, d):
    x0, y0 = 0, 416
    d.rectangle([x0, y0, x0 + 511, y0 + 63], fill='#f1ece2')
    d.rectangle([x0, y0 + 36, x0 + 511, y0 + 63], fill='#c8352c')
    d.rectangle([x0, y0 + 30, x0 + 511, y0 + 34], fill='#f0b81e')
    text_c(d, (x0 + 10, y0 + 2, x0 + 250, y0 + 30), 'RESEAU DE LA BAIE', font(17), '#23365e')
    d.ellipse([x0 + 270, y0 + 4, x0 + 296, y0 + 28], fill='#c8352c')
    text_c(d, (x0 + 270, y0 + 4, x0 + 296, y0 + 28), '12', font(13), '#ffffff')


def interior(img, d):
    # cabin strip seen through tinted glass: seat backs and headrests on a dark trim (u along the cabin)
    x0, y0 = 0, 480
    d.rectangle([x0, y0, x0 + 511, y0 + 31], fill='#141518')
    for k in range(8):
        cx = x0 + 32 + k * 64
        d.rounded_rectangle([cx - 22, y0 + 12, cx + 22, y0 + 31], radius=6, fill='#3a3530')
        d.rounded_rectangle([cx - 10, y0 + 3, cx + 10, y0 + 12], radius=4, fill='#45403a')


def main():
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    plates(img, d)
    taxi_sign(img, d)
    d = ImageDraw.Draw(img)
    led_sign(img, (256, 64, 512, 128), '12 CENTRE', '#ffb02a')
    led_sign(img, (256, 128, 512, 192), 'J  QUAIS', '#ffb02a')
    # cable car end board: painted, not lit
    d.rectangle([256, 192, 511, 255], fill='#efe1bf')
    d.rectangle([260, 196, 507, 251], outline='#7a1f22', width=3)
    text_c(d, (262, 198, 506, 250), 'COLLINE - PORT', font(26), '#7a1f22')
    van_logo(img, d)
    works_sign(img, d)
    grille(img, d)
    tyre_wall(img, d)
    bus_band(img, d)
    interior(img, d)
    a = np.asarray(img, np.float32) / 255
    a[..., 3] = EMIT
    # unlit pixels keep A = 0 (the shader multiplies the emission by A); the opaque colour lives in RGB
    m = Manifest('vehicles')
    m.add('veh_atlas', a, colorspace='srgb', group='act2', wrap='clamp', lossless=False, quality=92)
    m.save()
    if '--preview' in sys.argv:
        prev = Image.fromarray((a[..., :3] * 255).astype(np.uint8), 'RGB')
        al = Image.fromarray((a[..., 3] * 255).astype(np.uint8), 'L').convert('RGB')
        g = Image.new('RGB', (N * 2, N))
        g.paste(prev, (0, 0)); g.paste(al, (N, 0))
        g.save(os.path.join(ROOT, 'dev', 'vehicles', 'texprev.png'))


if __name__ == '__main__':
    main()
