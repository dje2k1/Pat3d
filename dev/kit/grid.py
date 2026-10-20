import sys
from PIL import Image
# usage: grid.py out.png cols w img1 img2 ...
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(f).convert('RGB') for f in sys.argv[4:]]
h = int(w * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
G = Image.new('RGB', (cols * w + (cols - 1) * 6, rows * h + (rows - 1) * 6), (20, 20, 30))
for i, im in enumerate(ims):
    G.paste(im.resize((w, int(w * im.height / im.width)), Image.LANCZOS), ((i % cols) * (w + 6), (i // cols) * (h + 6)))
G.save(out)
