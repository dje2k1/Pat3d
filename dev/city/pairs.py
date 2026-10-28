# v2 vs v3 side by side for the Act 2 viewpoints: python3 dev/city/pairs.py <v3 shots dir> out.png [w]
import sys, os
from PIL import Image, ImageDraw
V2 = '/tmp/claude-0/-home-user/608f9dd0-d109-57d1-b4c1-e900c9677b3d/scratchpad/kit3d/shots'
names = ['23-a2-hilltop', '24-a2-traffic', '25-a2-intersection-air', '26-a2-trick', '27-a2-pier-bumper', '28-a2-orbit-2', '29-a2-flight', '30-a2-goal']
d3, out = sys.argv[1], sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 900
rows = []
for n in names:
    a, b = os.path.join(V2, n + '.png'), os.path.join(d3, n + '.png')
    if not (os.path.exists(a) and os.path.exists(b)):
        continue
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    h = int(w * ia.height / ia.width)
    r = Image.new('RGB', (w * 2, h))
    r.paste(ia.resize((w, h), Image.LANCZOS), (0, 0)); r.paste(ib.resize((w, h), Image.LANCZOS), (w, 0))
    d = ImageDraw.Draw(r)
    for x, t in ((0, 'v2 ' + n), (w, 'v3 ' + n)):
        d.rectangle([x, 0, x + 260, 16], fill=(0, 0, 0)); d.text((x + 4, 2), t, fill=(255, 255, 0))
    rows.append(r)
g = Image.new('RGB', (w * 2, sum(r.height for r in rows)))
y = 0
for r in rows:
    g.paste(r, (0, y)); y += r.height
g.save(out)
print(out, len(rows))
