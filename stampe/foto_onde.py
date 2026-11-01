#!/usr/bin/env python3
"""Foto -> linee ONDULATE continue, pensate per un plotter vero.

Una riga orizzontale per ogni passo, tracciata d'un fiato da un lato all'altro:
dove la foto e' scura l'onda si alza (ampiezza grande, la riga si fa nera e
piena), dove e' chiara la riga resta quasi dritta. Poche centinaia di tratti
lunghi al posto di migliaia di trattini corti: pochi sollevamenti di penna,
nessun incrocio, nessuna riga piu' fitta del tratto.

  python3 -B foto_onde.py <foto> <uscita.svg> [altezza_mm] [ritaglio=su,giu,sx,dx] [passo=mm] [onda=mm]
"""
import sys

import numpy as np
from PIL import Image

import foto_tratti as F

S = F.S
NERO, GRIGIO = F.NERO, F.GRIGIO


def run(vero):
    """Intervalli [a, b) di True in un array booleano."""
    d = np.diff(np.concatenate([[0], vero.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]))


if __name__ == '__main__':
    foto, uscita = sys.argv[1], sys.argv[2]
    alt_mm = float(sys.argv[3]) if len(sys.argv) > 3 and '=' not in sys.argv[3] else 230.0
    img = Image.open(foto).convert('RGB')
    passo_mm, onda_mm = 1.7, 2.6
    for a in sys.argv[3:]:
        if a.startswith('ritaglio='):
            su, giu, sx, dx = (int(t) for t in a.split('=')[1].split(','))
            img = img.crop((sx, su, img.width - dx, img.height - giu))
        elif a.startswith('passo='):
            passo_mm = float(a.split('=')[1])
        elif a.startswith('onda='):
            onda_mm = float(a.split('=')[1])
    rgb = np.asarray(img)
    R, G, B = (rgb[..., i].astype(float) for i in range(3))
    L = np.asarray(img.convert('L')).astype(float)
    H, W = L.shape
    k = alt_mm / H
    passo = passo_mm / k
    lam = onda_mm / k
    yy, xx = np.mgrid[0:H, 0:W]

    M = F.persone(rgb)
    Ml = F.locale(F.blur(L, 1.2) / 255, M, r=26, forza=3.0)
    Lb = F.blur(L, 3) / 255
    # ampiezza, smussata lungo x perche' la riga non scatti da un picco all'altro
    A_p = F.blur(np.clip((0.78 - Ml) / 0.78, 0, 1) ** 1.5, lam * 0.35) * (passo * 0.8)
    riva = 0.66 * H - (xx / W) * 0.12 * H
    colline = S.riempi_buchi((G - B > -14) & (yy < 0.43 * H) & ~M)
    mare = (yy > 0.36 * H) & (yy < riva) & ~colline & ~M
    fondo = (colline | mare)
    A_g = F.blur(np.clip(0.8 - Lb, 0, 1), lam * 0.5) * (passo * 0.5)

    neri, grigi = [], []
    x = np.arange(W, dtype=float)
    for i, yc in enumerate(np.arange(passo / 2, H, passo)):
        iy = int(yc)
        fase = i * 0.9
        onda = np.sin(2 * np.pi * x / lam + fase)
        for (a, b) in run(M[iy]):
            if (b - a) * k < 3:
                continue
            xs = x[a:b]
            ys = yc + A_p[iy, a:b] * onda[a:b]
            neri.append(list(zip(xs, ys)))
        for (a, b) in run(fondo[iy]):
            if (b - a) * k < 6:
                continue
            xs = x[a:b]
            ys = yc + A_g[iy, a:b] * onda[a:b]
            grigi.append(list(zip(xs, ys)))

    contorni = [S.dirada(p, 0.7) for p in S.contorni(M.astype(float), 0.5, salta_nan=False)
                if S.lunghezza(p) > 30]
    # i contorni interni (braccia, bocca, costume): poche linee lunghe in nero
    Dk = np.where(M, F.blur(Ml, 1.2) - F.blur(Ml, 6.0), np.nan)
    contorni += [S.dirada(p, 0.8) for p in S.contorni(Dk, -0.16) if S.lunghezza(p) > 70]
    cielo_nuvole = np.minimum(np.minimum(R, G), B)
    nuvole = [S.dirada(p, 1.0) for p in S.contorni(F.blur(cielo_nuvole, 2.5), 170.0, salta_nan=False)
              if S.lunghezza(p) > 80]
    neri = [S.dirada(p, 0.25) for p in neri]
    grigi = [S.dirada(p, 0.25) for p in grigi]

    def lung(pl):
        return sum(S.lunghezza(p) for p in pl) * k / 1000.0
    g = lambda col, sw, linee: ('<g fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
                                'stroke-linejoin="round">\n%s\n</g>' % (col, sw, F.poly(linee, k)))
    open(uscita, 'w').write('\n'.join([
        '<svg xmlns="http://www.w3.org/2000/svg" width="%.2fmm" height="%.2fmm" viewBox="0 0 %.2f %.2f">'
        % (W * k, H * k, W * k, H * k),
        g(GRIGIO, 0.3, grigi + nuvole), g(NERO, 0.35, neri + contorni), '</svg>', '']))
    print('%.0f x %.0f mm; nero %d tratti (%.1f m), grigio %d tratti (%.1f m)' % (
        W * k, H * k, len(neri) + len(contorni), lung(neri + contorni),
        len(grigi) + len(nuvole), lung(grigi + nuvole)))
