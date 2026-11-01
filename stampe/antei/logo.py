#!/usr/bin/env python3
"""Il logo Antei, da immagine a tracciati per la penna.

Una penna non riempie: dell'inchiostro rosso si tiene il CONTORNO (marching
squares sulla maschera levigata), e dei campi pieni grandi, volendo, un
tratteggio. Il consumo dell'inchiostro del logo originale (la grana, i graffi)
non si porta: macchie e fori piccoli si buttano.

  python3 -B logo.py <immagine> <uscita.svg> [larghezza_mm] [tratteggio_mm]
"""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

QUI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'viste', os.path.join(QUI, '..', 'portaoggetti-feffi', 'viste.py'))
viste = importlib.util.module_from_spec(spec)
spec.loader.exec_module(viste)
S = viste.S

SCALA = 3              # si ingrandisce prima di tracciare: i filetti sottili della cornice
                       # e le grazie delle lettere stanno in 2-3 px dell'originale
SOGLIA = 0.50          # sulla maschera levigata 0..1
RAGGIO = 1.7           # levigatura (px ingranditi): toglie la grana, tiene i filetti
SCRATCH_L = 140        # un contorno corto e sottile e' un graffio, non un disegno
SCRATCH_R = 2.6
MINIMO_PX = 30         # contorni piu' corti di cosi' (px ingranditi) sono grana


def carica(percorso):
    im = Image.open(percorso).convert('RGB')
    a = np.asarray(im).astype(float)
    fondo = np.median(a.reshape(-1, 3)[:2000], axis=0)       # il colore della carta
    inchiostro = np.array([135.0, 38.0, 40.0])
    d_f = np.linalg.norm(a - fondo, axis=2)
    d_i = np.linalg.norm(a - inchiostro, axis=2)
    m = np.clip(d_f / (d_f + d_i + 1e-9), 0, 1)               # 1 = inchiostro
    g = Image.fromarray((m * 255).astype(np.uint8))
    return g.resize((g.width * SCALA, g.height * SCALA), Image.LANCZOS)


def tracciati(maschera_img):
    m = np.asarray(maschera_img.filter(ImageFilter.GaussianBlur(RAGGIO))).astype(float) / 255
    out = []
    for p in S.contorni(m, SOGLIA, salta_nan=False):
        L = S.lunghezza(p)
        if L < MINIMO_PX:
            continue
        # i graffi dell'originale sono sottili: area racchiusa piccola rispetto
        # al perimetro. Una voluta o una lettera hanno un rapporto ben piu' alto.
        area = abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1]
                       for i in range(len(p)))) / 2
        if L < SCRATCH_L and area / L < SCRATCH_R:
            continue
        q = S.dirada(p, 0.6)
        if len(q) > 2:
            out.append(q)
    return m, out


def tratteggio(m, passo_px, angolo=45, minimo=8):
    """Segmenti paralleli dentro i campi pieni (m levigata > 0.5)."""
    H, W = m.shape
    ok = m > 0.5
    t = np.radians(angolo)
    d = np.array([np.cos(t), -np.sin(t)])
    n = np.array([np.sin(t), np.cos(t)])
    diag = int(np.hypot(H, W))
    c = np.array([W / 2, H / 2])
    segs = []
    for k in range(-diag // 2, diag // 2, int(passo_px)):
        s = np.arange(-diag // 2, diag // 2, 0.7)
        x, y = c[0] + n[0] * k + d[0] * s, c[1] + n[1] * k + d[1] * s
        dentro = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
        x, y = x[dentro], y[dentro]
        if len(x) < 2:
            continue
        v = ok[y.astype(int), x.astype(int)]
        i = 0
        while i < len(v):
            if v[i]:
                j = i
                while j + 1 < len(v) and v[j + 1]:
                    j += 1
                if j - i >= minimo / 0.7:
                    segs.append([(x[i], y[i]), (x[j], y[j])])
                i = j + 1
            else:
                i += 1
    return segs


if __name__ == '__main__':
    img = carica(sys.argv[1])
    larg_mm = float(sys.argv[3]) if len(sys.argv) > 3 else 100.0
    passo_mm = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    m, contorni = tracciati(img)
    H, W = m.shape
    k = larg_mm / W
    alt_mm = H * k

    def pl(linee):
        return '\n'.join('<polyline points="%s"/>' % ' '.join(
            '%.2f,%.2f' % (x * k, y * k) for x, y in p) for p in linee)

    corpo = ['<g fill="none" stroke="#111" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round">',
             pl(contorni)]
    nt = 0
    if passo_mm > 0:
        segs = tratteggio(m, passo_mm / k)
        nt = len(segs)
        corpo.append(pl(segs))
    corpo.append('</g>')
    open(sys.argv[2], 'w').write(
        '<svg xmlns="http://www.w3.org/2000/svg" width="%gmm" height="%.2fmm" viewBox="0 0 %g %.2f">\n%s\n</svg>\n'
        % (larg_mm, alt_mm, larg_mm, alt_mm, '\n'.join(corpo)))
    print('%d contorni, %d tratti, %.0f x %.1f mm' % (len(contorni), nt, larg_mm, alt_mm))
