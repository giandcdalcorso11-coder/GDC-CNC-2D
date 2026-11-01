#!/usr/bin/env python3
"""Foto -> disegno a tratti (incisione), a due penne. NON e' lo stile Rilievo.

Il tono diventa tratteggio: dove la foto e' scura, linee fitte e incrociate;
dove e' media, linee rade; dove e' chiara, niente. Penna nera per i toni scuri
e per i contorni delle masse scure, grigia per i mezzi toni.

  python3 -B foto_tratti.py <foto> <uscita.svg> [altezza_mm] [ritaglio=su,giu,sx,dx in px]
"""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

QUI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'viste', os.path.join(QUI, 'portaoggetti-feffi', 'viste.py'))
viste = importlib.util.module_from_spec(spec)
spec.loader.exec_module(viste)
S = viste.S

NERO, GRIGIO = '#111', '#8a8a8a'

# soglie sul tono 0 (nero) .. 1 (bianco), dopo la curva che apre le ombre
SOGLIA_GRIGIO = 0.70
SOGLIA_NERO_1 = 0.42
SOGLIA_NERO_2 = 0.26
SOGLIA_CONTORNO = 0.30
PASSO_NERO_MM = 0.85
PASSO_GRIGIO_MM = 1.15


def tono(img, gamma=0.8, levigatura=2.2):
    L = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(levigatura))).astype(float) / 255
    # autolivello: la foto e' controluce, la gamma apre un po' le ombre
    lo, hi = np.percentile(L, 1), np.percentile(L, 99)
    L = np.clip((L - lo) / (hi - lo), 0, 1)
    return L ** gamma


def tratti(L, passo_px, soglia, angolo):
    ok = np.ones(L.shape, dtype=bool)
    return viste.tratteggio(L, ok, passo_px, soglia, angolo)


def poly(linee, k):
    return '\n'.join('<polyline points="%s"/>' % ' '.join(
        '%.2f,%.2f' % (x * k, y * k) for x, y in p) for p in linee)


def blur(A, r):
    """Gaussiana separabile su un array di float (PIL non la fa sui float)."""
    n = int(3 * r) + 1
    x = np.arange(-n, n + 1)
    ker = np.exp(-x * x / (2.0 * r * r))
    ker /= ker.sum()
    A = np.asarray(A, dtype=np.float64)
    for ax in (0, 1):
        P = np.pad(A, [(n, n) if i == ax else (0, 0) for i in range(2)], mode='edge')
        out = np.zeros_like(A)
        for i, w in enumerate(ker):
            out += w * (P[i:i + A.shape[0], :] if ax == 0 else P[:, i:i + A.shape[1]])
        A = out
    return A


def locale(L, mask, r=22, forza=3.2):
    """Contrasto locale dentro la maschera: una figura quasi tutta scura ha
    comunque luci e ombre proprie, e sono quelle che il tratteggio racconta."""
    m = mask.astype(float)
    media = blur(L * m, r) / np.maximum(blur(m, r), 1e-3)
    dev = np.sqrt(np.maximum(blur(((L - media) ** 2) * m, r) / np.maximum(blur(m, r), 1e-3), 1e-6))
    return np.clip(0.5 + forza * (L - media) / (dev * 4 + 0.02), 0, 1)


def persone(rgb):
    L = np.asarray(Image.fromarray(rgb).convert('L').filter(ImageFilter.GaussianBlur(1.6))).astype(float)
    m = L < SOGLIA_PERSONE
    # via i pezzi piccoli, chiudi i buchi
    tenute = np.zeros_like(m)
    resto = m.copy()
    while resto.any():
        ys, xs = np.nonzero(resto)
        c = componente(resto, (int(xs[0]), int(ys[0])))
        if c.sum() >= 2500:
            tenute |= c
        resto &= ~c
    return S.riempi_buchi(tenute)


def componente(m, seme):
    c = np.zeros_like(m)
    c[seme[1], seme[0]] = True
    while True:
        n = c.copy()
        n[1:, :] |= c[:-1, :]
        n[:-1, :] |= c[1:, :]
        n[:, 1:] |= c[:, :-1]
        n[:, :-1] |= c[:, 1:]
        n &= m
        if n.sum() == c.sum():
            return c
        c = n


SOGLIA_PERSONE = 92


if __name__ == '__main__':
    foto, uscita = sys.argv[1], sys.argv[2]
    alt_mm = float(sys.argv[3]) if len(sys.argv) > 3 else 230.0
    img = Image.open(foto).convert('RGB')
    for a in sys.argv[4:]:
        if a.startswith('ritaglio='):
            su, giu, sx, dx = (int(t) for t in a.split('=')[1].split(','))
            img = img.crop((sx, su, img.width - dx, img.height - giu))
    rgb = np.asarray(img)
    R, G, B = (rgb[..., i].astype(float) for i in range(3))
    L = np.asarray(img.convert('L')).astype(float)
    H, W = L.shape
    k = alt_mm / H
    px = lambda mm: max(2, int(round(mm / k)))
    yy, xx = np.mgrid[0:H, 0:W]

    M = persone(rgb)
    Ml = locale(blur(L, 1.2) / 255, M)
    ok = np.ones(L.shape, dtype=bool)
    nero1 = viste.tratteggio(Ml, M, px(0.85), 0.55, 45)
    nero2 = viste.tratteggio(Ml, M, px(0.85), 0.32, 135)
    contorni = [S.dirada(p, 0.7) for p in S.contorni(M.astype(float), 0.5, salta_nan=False)
                if S.lunghezza(p) > 30]
    # dettagli interni: valli scure e sottili dentro le persone (bocca, mani, pieghe)
    Dk = blur(Ml, 1.0) - blur(Ml, 5.0)
    Dk = np.where(M, Dk, np.nan)
    dettagli = [S.dirada(p, 0.7) for p in S.contorni(Dk, -0.14) if S.lunghezza(p) > 40]

    # paesaggio, in grigio
    cielo_nuvole = np.minimum(np.minimum(R, G), B)
    nuvole = [S.dirada(p, 1.0) for p in S.contorni(blur(cielo_nuvole, 2.5), 170.0, salta_nan=False)
              if S.lunghezza(p) > 60]
    colline = (G - B > -14) & (yy < 0.43 * H) & ~M
    colline = S.riempi_buchi(colline)
    cont_col = [S.dirada(p, 0.9) for p in S.contorni(blur(colline.astype(float), 2.0), 0.5, salta_nan=False)
                if S.lunghezza(p) > 80]
    inter = viste.tratteggio(blur(L, 2) / 255, colline, px(1.5), 0.62, 0)
    riva = 0.66 * H - (xx / W) * 0.12 * H           # la battigia, in pendenza
    mare = (yy > 0.36 * H) & (yy < riva) & ~colline & ~M
    onde = viste.tratteggio(blur(L, 3) / 255, mare, px(1.6), 0.70, 0)

    grigi = nuvole + cont_col + inter + onde

    def g(col, sw, linee):
        return ('<g fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
                'stroke-linejoin="round">\n%s\n</g>' % (col, sw, poly(linee, k)))
    open(uscita, 'w').write('\n'.join([
        '<svg xmlns="http://www.w3.org/2000/svg" width="%.2fmm" height="%.2fmm" viewBox="0 0 %.2f %.2f">'
        % (W * k, H * k, W * k, H * k),
        g(GRIGIO, 0.3, grigi), g(NERO, 0.3, nero1 + nero2), g(NERO, 0.4, contorni + dettagli),
        '</svg>', '']))
    print('%d x %d px -> %.0f x %.0f mm; grigio %d, nero %d, contorni+dettagli %d' % (
        W, H, W * k, H * k, len(grigi), len(nero1) + len(nero2), len(contorni) + len(dettagli)))
