"""
Finova Ultra HD Icon Generator — Python / Pillow + NumPy
Renderiza el logo desde geometria vectorial con gradiente metalico real.
Uso: python branding/scripts/generate-icons.py   (desde files/)
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw

# ── Espacio de diseno: 1024 x 1024 ───────────────────────────────────────────
SVG = 1024

# ── Fondo ────────────────────────────────────────────────────────────────────
BG_CENTER = (30, 26, 22)   # #1e1a16 — centro calido
BG_EDGE   = (12, 11, 10)   # #0c0b0a — borde casi negro
CELL_DARK = (13, 12, 11)   # #0d0c0b — celdas del chip

# ── Paleta de oro (4 paradas para gradiente metalico) ────────────────────────
GOLD_STOPS = [
    (0.00, (244, 204,  82)),   # #F4CC52 — oro brillante
    (0.28, (217, 168,  48)),   # #D9A830 — oro medio
    (0.62, (196, 144,  32)),   # #C49020 — oro calido
    (1.00, (155, 112,  16)),   # #9B7010 — ambar oscuro
]

# ── Geometria F ──────────────────────────────────────────────────────────────
F_POINTS = [
    (162, 143), (640, 143),
    (640, 240), (277, 240),
    (277, 460), (534, 460),
    (534, 551), (277, 551),
    (277, 871), (162, 871),
]

# ── Geometria chip ───────────────────────────────────────────────────────────
CHIP = dict(x=655, y=695, w=205, h=176, rx=24)
CELL_W, CELL_H, CELL_RX = 80, 44, 7
CELLS = [
    (673, 709), (762, 709),
    (673, 761), (762, 761),
    (673, 813), (762, 813),
]

# ── Generador de gradiente con NumPy ─────────────────────────────────────────
def _gold_gradient_array(size: int) -> np.ndarray:
    """
    Devuelve array (size, size, 3) uint8 con gradiente diagonal metalico.
    Eje predominante: vertical (70%) + horizontal (30%).
    """
    xs = np.linspace(0.0, 1.0, size, dtype=np.float32)
    ys = np.linspace(0.0, 1.0, size, dtype=np.float32)
    xg, yg = np.meshgrid(xs, ys)          # (size, size)
    t = np.clip(0.30 * xg + 0.70 * yg, 0.0, 1.0)   # (size, size)

    rgb = np.zeros((size, size, 3), dtype=np.float32)
    stops = GOLD_STOPS
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        mask = (t >= t0) & (t < t1)
        u = np.where(mask, (t - t0) / (t1 - t0), 0.0)
        for ch in range(3):
            rgb[:, :, ch] += mask * (c0[ch] + u * (c1[ch] - c0[ch]))
    # Ultima parada
    last_t, last_c = stops[-1]
    mask_last = t >= last_t
    for ch in range(3):
        rgb[:, :, ch] += mask_last * last_c[ch]

    return np.clip(rgb, 0, 255).astype(np.uint8)


def _radial_bg_array(size: int) -> np.ndarray:
    """
    Devuelve array (size, size, 3) uint8 con fondo radial oscuro premium.
    """
    xs = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    ys = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    xg, yg = np.meshgrid(xs, ys)
    d = np.clip(np.sqrt(xg**2 + yg**2) / 1.02, 0.0, 1.0)   # 0 = centro, 1 = borde

    rgb = np.zeros((size, size, 3), dtype=np.float32)
    for ch in range(3):
        rgb[:, :, ch] = BG_CENTER[ch] * (1 - d) + BG_EDGE[ch] * d

    return np.clip(rgb, 0, 255).astype(np.uint8)


def _metal_sheen_array(size: int) -> np.ndarray:
    """
    Devuelve array (size, size, 1) uint8: mascara del destello vertical
    (blanco transparente en la parte superior que desaparece hacia abajo).
    """
    t = np.linspace(0.0, 1.0, size, dtype=np.float32)
    # Fade from top (opaque) to ~55% height (transparent)
    alpha = np.clip(1.0 - t / 0.55, 0.0, 1.0) * 0.14 * 255
    alpha = np.broadcast_to(alpha[:, np.newaxis], (size, size))
    return alpha.astype(np.uint8)


# ── Renderizador principal ────────────────────────────────────────────────────
def draw_logo(size: int) -> Image.Image:
    s = size / SVG

    def p(v):  return round(v * s)
    def r(v):  return max(1, round(v * s))

    # ── 1. Fondo radial ──────────────────────────────────────────────────────
    bg_arr = _radial_bg_array(size)
    img = Image.fromarray(bg_arr, 'RGB').convert('RGBA')

    # Aplicar mascara de esquinas redondeadas al fondo
    bg_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(bg_mask).rounded_rectangle([0, 0, size-1, size-1], radius=r(220), fill=255)
    img.putalpha(bg_mask)

    # ── 2. Gradiente metalico (compartido por F y chip) ──────────────────────
    gold_arr = _gold_gradient_array(size)
    sheen_arr = _metal_sheen_array(size)

    def apply_gradient_to_mask(mask_img: Image.Image) -> Image.Image:
        """Toma una imagen-mascara L y devuelve RGBA dorado."""
        rgba = Image.fromarray(gold_arr, 'RGB').convert('RGBA')
        rgba.putalpha(mask_img)
        return rgba

    def apply_sheen_to_mask(mask_img: Image.Image) -> Image.Image:
        """Aplica destello blanco semi-transparente."""
        white = Image.new('RGB', (size, size), (255, 255, 255))
        sheen_rgba = white.convert('RGBA')
        # alpha = min(sheen_arr, mask)
        mask_np = np.array(mask_img)
        sheen_alpha = np.minimum(sheen_arr, mask_np).astype(np.uint8)
        sheen_rgba.putalpha(Image.fromarray(sheen_alpha, 'L'))
        return sheen_rgba

    # ── 3. Letra F ───────────────────────────────────────────────────────────
    f_pts = [(p(x), p(y)) for x, y in F_POINTS]
    f_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(f_mask).polygon(f_pts, fill=255)

    img = Image.alpha_composite(img, apply_gradient_to_mask(f_mask))
    img = Image.alpha_composite(img, apply_sheen_to_mask(f_mask))

    # ── 4. Chip — cuerpo ─────────────────────────────────────────────────────
    cx, cy = p(CHIP['x']), p(CHIP['y'])
    cw, ch = p(CHIP['w']), p(CHIP['h'])
    chip_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(chip_mask).rounded_rectangle(
        [cx, cy, cx + cw, cy + ch],
        radius=r(CHIP['rx']), fill=255
    )
    img = Image.alpha_composite(img, apply_gradient_to_mask(chip_mask))
    img = Image.alpha_composite(img, apply_sheen_to_mask(chip_mask))

    # ── 5. Celdas del chip (solo >= 48 px para que sean visibles) ────────────
    if size >= 48:
        d = ImageDraw.Draw(img)
        for ox, oy in CELLS:
            lx, ly = p(ox), p(oy)
            lw, lh = p(CELL_W), p(CELL_H)
            d.rounded_rectangle(
                [lx, ly, lx + lw, ly + lh],
                radius=r(CELL_RX),
                fill=CELL_DARK + (255,)
            )

    # ── 6. Borde dorado sutil (solo >= 128 px) ───────────────────────────────
    if size >= 128:
        border_w = max(1, round(2.5 * s))
        ImageDraw.Draw(img).rounded_rectangle(
            [border_w, border_w, size - border_w - 1, size - border_w - 1],
            radius=r(220) - border_w,
            outline=(212, 169, 96, 55),
            width=border_w
        )

    return img


# ── Salida ────────────────────────────────────────────────────────────────────
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def out(subdir, filename):
    path = os.path.join(ROOT, subdir, filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def generate():
    print("Generando Finova Icons — Ultra HD")
    print("=" * 40)

    # PNGs de alta resolucion
    for size in [4096, 2048, 1024]:
        path = out('png', f'logo-{size}.png')
        draw_logo(size).save(path, 'PNG', optimize=True)
        print(f"OK  png/logo-{size}.png")

    # Iconos de aplicacion
    icon_sizes = [16, 32, 48, 64, 120, 128, 152, 167, 180, 192, 256, 512, 1024]
    for size in icon_sizes:
        path = out('icons', f'icon-{size}.png')
        draw_logo(size).save(path, 'PNG', optimize=True)
        print(f"OK  icons/icon-{size}.png")

    # Copiar al directorio raiz del proyecto (para manifest + HTML)
    project_root = os.path.join(ROOT, '..')
    for size in [16, 32, 48, 64, 120, 128, 152, 167, 180, 192, 256, 512, 1024]:
        src = os.path.join(ROOT, 'icons', f'icon-{size}.png')
        dst = os.path.join(project_root, f'icon-{size}.png')
        img = Image.open(src)
        img.save(dst, 'PNG', optimize=True)
    print("OK  Iconos copiados a raiz del proyecto")

    print("")
    print("Todos los iconos generados correctamente.")


if __name__ == '__main__':
    generate()
