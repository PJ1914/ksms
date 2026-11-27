"""Cuts icon-source.png into layers for the opening animation: awning, shop body (with the rupee
area filled in), and the rupee. All layers share one canvas so they stack exactly.
Usage: python make-intro-layers.py icon-source.png <out-dir>"""
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
bg = im.getpixel((10, 10))
px = im.load()
W, H = im.size

def dist(a, b):
    return sum(abs(x - y) for x, y in zip(a, b))

awning = Image.new('RGBA', im.size, (0, 0, 0, 0))
body = Image.new('RGBA', im.size, (0, 0, 0, 0))
rupee = Image.new('RGBA', im.size, (0, 0, 0, 0))
pa, pb, pr = awning.load(), body.load(), rupee.load()
BODY = (8, 84, 51)

# the rupee sits in this box, fully inside the shop body
RX0, RY0, RX1, RY1 = 445, 640, 815, 1015

alpha = {}
cls = {}  # solid pixels: 'A' awning, 'B' body
for y in range(H):
    for x in range(W):
        c = px[x, y]
        d = dist(c, bg)
        a = 255 if d > 60 else (0 if d < 20 else int((d - 20) * 255 / 40))
        if RX0 <= x <= RX1 and RY0 <= y <= RY1:
            # body colour under the rupee; cream pixels are the rupee itself
            pb[x, y] = BODY + (255,)
            if a < 255:
                pr[x, y] = bg + (255 - a,)
            continue
        if a == 0 or all(ci >= bi for ci, bi in zip(c, bg)):
            continue  # background, or the white halo the source has around shapes
        alpha[(x, y)] = a
        r, g, b = c
        if r > 200 and b < 110:
            cls[(x, y)] = 'A'  # orange stripe
        elif r < 30 and g > 112:
            cls[(x, y)] = 'A'  # lighter awning green
        elif r < 30 and g < 100:
            cls[(x, y)] = 'B'  # shop body green
        # anything else is a soft edge, decided by its nearest solid neighbour below

# soft edge pixels belong to whichever solid shape is nearest
for (x, y), a in alpha.items():
    k = cls.get((x, y))
    if k is None:
        for rad in range(1, 6):
            for dx in range(-rad, rad + 1):
                for dy in (-rad, rad):
                    k = cls.get((x + dx, y + dy)) or cls.get((x + dy, y + dx))
                    if k:
                        break
                if k:
                    break
            if k:
                break
    if k is None:
        continue
    (pa if k == 'A' else pb)[x, y] = px[x, y] + (a,)

box = Image.alpha_composite(awning, body).getbbox()
for name, layer in (('intro-awning', awning), ('intro-body', body), ('intro-rupee', rupee)):
    layer.crop(box).resize((512, round(512 * (box[3] - box[1]) / (box[2] - box[0]))), Image.LANCZOS).save(
        f'{out}/{name}.png', optimize=True)
print('canvas', box)
