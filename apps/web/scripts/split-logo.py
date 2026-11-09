"""Split the logo raster into layers (arcs, cube halves, shadow, word) for the assemble animation in public/brand-logo.css.

Run from apps/web:  python scripts/split-logo.py public   (needs Pillow and numpy)
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PUB = sys.argv[1]
SIZE = 512

def load(name, white_bg):
    im = Image.open(f"{PUB}/{name}").convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    a = np.array(im).astype(np.float64)
    rgb, al = a[..., :3], a[..., 3] / 255.0
    if white_bg:
        # colour-to-alpha against white, so edges stay soft on any background
        alpha = np.clip((255 - rgb).max(axis=2) / 255.0, 0, 1)
        safe = np.where(alpha > 0, alpha, 1)[..., None]
        rgb = np.clip((rgb - 255 * (1 - alpha[..., None])) / safe, 0, 255)
        al = alpha
    return rgb, al

def split(name, white_bg, prefix):
    rgb, al = load(name, white_bg)
    h, w = al.shape
    ys, xs = np.mgrid[0:h, 0:w]
    nx, ny = xs / w, ys / h
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    ink = (sat > 0.25) & (mx > 70) & (al > 0.08)
    # The cube is the one solid blob holding the centre; letters inside it are holes to fill.
    m = Image.fromarray((ink * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)).copy()
    ImageDraw.floodfill(m, (int(w * 0.4), int(h * 0.5)), 128)
    comp = np.array(m) == 128
    outside = Image.fromarray(np.where(comp, 255, 0).astype(np.uint8), "L").copy()
    ImageDraw.floodfill(outside, (0, 0), 128)
    cube = np.array(outside) != 128
    cube = np.array(Image.fromarray((cube * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(5))) > 0
    colored = ink & ~cube
    masks = {
        "cube-left": cube & (nx < 0.532),
        "cube-right": cube & (nx >= 0.532),
        "arc-blue": colored & (b > r),
        "arc-orange": colored & (r >= b),
        "shadow": ~cube & ~colored & (ny > 0.70) & (ny < 0.76),
        "word": ~cube & ~colored & (ny >= 0.76) & (ny < 0.90) & (nx > 0.3) & (nx < 0.72),
    }
    for key, m in masks.items():
        out = np.zeros((h, w, 4))
        alpha = al * m * 255
        alpha[alpha < 6] = 0
        out[..., :3] = rgb * (alpha > 0)[..., None]
        out[..., 3] = alpha
        Image.fromarray(out.astype(np.uint8), "RGBA").save(f"{PUB}/logo-parts/{prefix}-{key}.webp", quality=86, method=6)

split("logo.png", True, "light")
split("logo-dark.webp", False, "dark")
