import sys
from PIL import Image, ImageChops

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
bg = im.getpixel((10, 10))  # cream background

# alpha: anything that differs clearly from the background is artwork
diff = ImageChops.difference(im, Image.new('RGB', im.size, bg)).convert('L')
alpha = diff.point(lambda v: 255 if v > 40 else (0 if v < 15 else int((v - 15) * 255 / 25)))
art = im.copy(); art.putalpha(alpha)
box = alpha.getbbox()
art = art.crop(box)
print('background', bg, 'artwork box', box)

CREAM = (244, 248, 241)

def place(canvas_size, fraction, background):
    c = Image.new('RGBA', (canvas_size, canvas_size), background)
    w, h = art.size
    scale = canvas_size * fraction / max(w, h)
    a = art.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    c.alpha_composite(a, ((canvas_size - a.width) // 2, (canvas_size - a.height) // 2))
    return c

# full icon (phone adds its own rounded mask), no transparency
place(1024, 0.80, CREAM + (255,)).convert('RGB').save(f'{out}/icon.png', optimize=True)
# Android adaptive foreground: content inside the central safe zone (~66%), transparent
place(1024, 0.60, (0, 0, 0, 0)).save(f'{out}/adaptive-icon.png', optimize=True)
# Android themed (monochrome) icon: one colour, rupee and gaps stay as holes
fg = place(1024, 0.60, (0, 0, 0, 0))
mono = Image.new('RGBA', fg.size, (0, 0, 0, 0)); mono.putalpha(fg.getchannel('A'))
mono.save(f'{out}/monochrome-icon.png', optimize=True)
# splash: artwork alone, transparent (splash background colour is set in app config)
place(1024, 1.0, (0, 0, 0, 0)).save(f'{out}/splash-icon.png', optimize=True)
# web favicon
place(48, 0.86, CREAM + (255,)).convert('RGB').save(f'{out}/favicon.png', optimize=True)

# preview sheet: sizes in circle and squircle masks
from PIL import ImageDraw
sheet = Image.new('RGB', (1000, 300), (255, 255, 255))
x = 20
for size in (192, 96, 48):
    for shape in ('circle', 'squircle'):
        tile = Image.new('RGBA', (size, size), CREAM + (255,))
        tile.alpha_composite(place(size, 0.60 / 0.66 * 0.66 * 1.25, (0, 0, 0, 0)))
        mask = Image.new('L', (size, size), 0); d = ImageDraw.Draw(mask)
        if shape == 'circle': d.ellipse((0, 0, size - 1, size - 1), fill=255)
        else: d.rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 4, fill=255)
        sheet.paste(tile.convert('RGB'), (x, 40), mask)
        x += size + 20
sheet.save(f'{out}/icon-preview.png')
