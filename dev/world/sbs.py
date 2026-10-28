# side by side v2 (left) / v3 (right) grids: python3 dev/world/sbs.py out.png prefix view1 view2 ...
import sys
from PIL import Image, ImageDraw
out, pre, views = sys.argv[1], sys.argv[2], sys.argv[3:]
tw, th = 640, 360
c = Image.new('RGB', (tw * 2, th * len(views)), (0, 0, 0))
d = ImageDraw.Draw(c)
for i, v in enumerate(views):
    for j, p in enumerate(['v2-', pre]):
        try:
            im = Image.open('dev/world/shots/%s%s.png' % (p, v)).convert('RGB').resize((tw, th))
            c.paste(im, (j * tw, i * th))
        except FileNotFoundError:
            pass
        d.text((j * tw + 8, i * th + 6), ('v2 ' if j == 0 else 'v3 ') + v, fill=(255, 255, 0))
c.save(out)
