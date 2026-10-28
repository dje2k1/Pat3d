# side-by-side sheet: left = before (prefix A), right = after (prefix B), one row per view
# usage: python3 sbs.py out.png A B view1 view2 ...  (images in dev/entities/shots/<prefix><view>.png)
import sys, os
from PIL import Image, ImageDraw
out, A, B = sys.argv[1], sys.argv[2], sys.argv[3]
views = sys.argv[4:]
w = 640; h = 360
g = Image.new('RGB', (2 * w, h * len(views)))
d = ImageDraw.Draw(g)
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
for i, v in enumerate(views):
    for j, p in enumerate((A, B)):
        f = os.path.join(D, p + v + '.png')
        if not os.path.exists(f): continue
        im = Image.open(f).convert('RGB').resize((w, h), Image.LANCZOS)
        g.paste(im, (j * w, i * h))
        d.rectangle([j * w, i * h, j * w + 300, i * h + 18], fill=(0, 0, 0))
        d.text((j * w + 4, i * h + 3), ('before ' if j == 0 else 'after ') + v, fill=(255, 255, 0))
g.save(out)
