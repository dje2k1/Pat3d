# usage: python3 grid.py out.png cols w img1 img2 ... (labels = file stems)
import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
h = int(w * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
g = Image.new('RGB', (cols * w, rows * h))
d = ImageDraw.Draw(g)
for i, (im, p) in enumerate(zip(ims, sys.argv[4:])):
    x, y = (i % cols) * w, (i // cols) * h
    g.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    d.rectangle([x, y, x + 260, y + 18], fill=(0, 0, 0))
    d.text((x + 4, y + 3), p.split('/')[-1][:-4], fill=(255, 255, 0))
g.save(out)
