"""Draws the Android launcher icons, splash images and the 512 px store icon for the app.

The design is the game's favicon (index.html): a painted wooden figurine in a blue shirt on a yellow tile.
usage (from the repository root):  python _dev/tools/app_icons.py
"""
import os, glob
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RES = os.path.join(ROOT, 'app', 'android', 'app', 'src', 'main', 'res')
YELLOW, BLUE, SKIN, INK = (255, 201, 60), (47, 111, 224), (244, 212, 182), (31, 26, 23)
SS = 4  # supersampling


def figurine(d, s, ox, oy):
    """Figurine in the favicon's 64-unit design space, scaled by s and offset by (ox, oy) pixels."""
    def box(x0, y0, x1, y1):
        return [ox + x0 * s, oy + y0 * s, ox + x1 * s, oy + y1 * s]
    w = 3 * s
    # body: a round-shouldered block (the favicon's path M20 54V36a12 12 0 0 1 24 0v18z)
    d.rounded_rectangle(box(18.5, 22.5, 45.5, 55.5), radius=13.5 * s, fill=INK, corners=(True, True, False, False))
    d.rounded_rectangle(box(21.5, 25.5, 42.5, 52.5), radius=10.5 * s, fill=BLUE, corners=(True, True, False, False))
    # head
    d.ellipse(box(21.5, 8.5, 42.5, 29.5), fill=INK)
    d.ellipse(box(21.5 + w / s, 8.5 + w / s, 42.5 - w / s, 29.5 - w / s), fill=SKIN)


def tile(px, shape):
    """Yellow tile with the figurine. shape: 'square' (rounded), 'round' or 'full' (store icon, no rounding)."""
    n = px * SS
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shape == 'round':
        d.ellipse([0, 0, n - 1, n - 1], fill=YELLOW)
        s = n / 64 * 0.8
    else:
        if shape == 'square':
            d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * 14 / 64, fill=YELLOW)
        else:
            d.rectangle([0, 0, n, n], fill=YELLOW)
        s = n / 64 * 0.95
    # the figurine spans y 8.5..55.5 of its design space: centre that
    ox, oy = (n - 64 * s) / 2, n / 2 - 32 * s
    figurine(d, s, ox, oy)
    return im.resize((px, px), Image.LANCZOS)


def foreground(px):
    """Adaptive-icon foreground: 108 units, the figurine inside the 66-unit safe zone, transparent around it."""
    n = px * SS
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = n / 108
    s = 58 / 47 * u                      # the figurine is 47 units tall in its design space
    figurine(d, s, n / 2 - 32 * s, n / 2 - 32 * s)
    return im.resize((px, px), Image.LANCZOS)


DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in DENS.items():
    folder = os.path.join(RES, f'mipmap-{name}')
    os.makedirs(folder, exist_ok=True)
    tile(round(48 * k), 'square').save(os.path.join(folder, 'ic_launcher.png'))
    tile(round(48 * k), 'round').save(os.path.join(folder, 'ic_launcher_round.png'))
    foreground(round(108 * k)).save(os.path.join(folder, 'ic_launcher_foreground.png'))

# splash images (Android 11 and older): dark background, icon in the middle, at each existing size
for path in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    w, h = Image.open(path).size
    im = Image.new('RGB', (w, h), INK)
    ic = tile(max(48, round(min(w, h) * 0.28)), 'square')
    im.paste(ic, ((w - ic.width) // 2, (h - ic.height) // 2), ic)
    im.save(path)

store = os.path.join(ROOT, 'app', 'store')
os.makedirs(store, exist_ok=True)
tile(512, 'full').convert('RGB').save(os.path.join(store, 'icon-512.png'))
print('icons, splash images and app/store/icon-512.png written')
