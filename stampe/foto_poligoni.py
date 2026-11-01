#!/usr/bin/env python3
"""Foto -> mosaico di triangoli (stile «poligoni»), a due penne.

Una triangolazione di Delaunay sopra la foto: i punti si infittiscono dove ci
sono i dettagli (bordi, volti, mani) e si diradano dove la foto e' piatta, quindi
i triangoli piccoli raccontano il soggetto e quelli grandi lo sfondo. I triangoli
piu' scuri hanno dentro uno o due triangoli piu' piccoli, che danno il tono con
sole linee. Nero per le persone, grigio per tutto il resto.

Ogni lato e' tracciato una volta sola: lo SLICER salda i segmenti che si toccano
e li ordina, quindi i tratti diventano catene lunghe.

  python3 -B foto_poligoni.py <foto> <uscita.svg> [altezza_mm] [ritaglio=su,giu,sx,dx] [lato=mm] [senza-toni]
"""
import sys

import numpy as np
from PIL import Image

import foto_tratti as F

S = F.S


def delaunay(P):
    """Bowyer-Watson. P: (n,2). Restituisce triangoli come terne di indici."""
    n = len(P)
    lo, hi = P.min(axis=0), P.max(axis=0)
    c, d = (lo + hi) / 2, max(hi - lo) * 20
    PP = np.vstack([P, c + [-d, -d], c + [d, -d], c + [0, d]])
    tri = [(n, n + 1, n + 2)]
    for i in range(n):
        p = PP[i]
        T = np.array(tri)
        A, B, C = PP[T[:, 0]], PP[T[:, 1]], PP[T[:, 2]]
        # centro e raggio quadro della circonferenza circoscritta
        ax, ay, bx, by, cx, cy = A[:, 0], A[:, 1], B[:, 0], B[:, 1], C[:, 0], C[:, 1]
        D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        D = np.where(np.abs(D) < 1e-12, 1e-12, D)
        ux = ((ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)) / D
        uy = ((ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)) / D
        cattivi = (p[0] - ux) ** 2 + (p[1] - uy) ** 2 < (ax - ux) ** 2 + (ay - uy) ** 2
        bordo = {}
        for t in T[cattivi]:
            for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                k = (min(e), max(e))
                bordo[k] = bordo.get(k, 0) + 1
        tri = [tuple(t) for t in T[~cattivi]]
        for (a, b), cnt in bordo.items():
            if cnt == 1:
                tri.append((a, b, i))
    return [t for t in tri if max(t) < n]


def campiona(M, importanza, r_pers, r_fondo, rng):
    """Dart throwing con raggio che dipende dall'importanza (in px)."""
    H, W = M.shape
    N = 60000
    cand = np.column_stack([rng.uniform(0, W - 1, N), rng.uniform(0, H - 1, N)])
    acc = []
    arr = np.empty((0, 2))
    for x, y in cand:
        ix, iy = int(x), int(y)
        if M[iy, ix]:
            r = r_pers[0] + (r_pers[1] - r_pers[0]) * (1 - importanza[iy, ix])
        else:
            r = r_fondo
        if len(acc) and np.min(np.hypot(arr[:, 0] - x, arr[:, 1] - y)) < r:
            continue
        acc.append((x, y))
        arr = np.array(acc)
    return arr


def resampled(p, passo):
    p = np.array(p)
    seg = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] < passo:
        return p[:1]
    t = np.arange(0, s[-1], passo)
    return np.column_stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])])


if __name__ == '__main__':
    foto, uscita = sys.argv[1], sys.argv[2]
    alt_mm = float(sys.argv[3]) if len(sys.argv) > 3 and '=' not in sys.argv[3] else 230.0
    img = Image.open(foto).convert('RGB')
    lato = 4.5
    toni = True
    for a in sys.argv[3:]:
        if a.startswith('ritaglio='):
            su, giu, sx, dx = (int(t) for t in a.split('=')[1].split(','))
            img = img.crop((sx, su, img.width - dx, img.height - giu))
        elif a == 'senza-toni':
            toni = False
        elif a.startswith('lato='):
            lato = float(a.split('=')[1])
    rgb = np.asarray(img)
    L = np.asarray(img.convert('L')).astype(float)
    H, W = L.shape
    k = alt_mm / H
    px = lambda mm: mm / k
    rng = np.random.default_rng(7)

    M = F.persone(rgb)
    Ml = F.locale(F.blur(L, 1.2) / 255, M, r=26, forza=3.0)
    G = F.blur(Ml, 2.0)
    gy, gx = np.gradient(G)
    imp = np.clip(np.hypot(gx, gy) * 18, 0, 1)
    imp = F.blur(imp, 6.0)
    imp = np.clip(imp / max(imp[M].max(), 1e-6) * 1.8, 0, 1)

    pts = campiona(M, imp, (px(lato * 0.55), px(lato * 1.7)), px(lato * 2.4), rng)
    # i punti sul contorno: i bordi dei triangoli seguono la sagoma
    cont = []
    for p in S.contorni(M.astype(float), 0.5, salta_nan=False):
        if S.lunghezza(p) > 60:
            q = resampled(S.dirada(p, 1.0), px(lato * 0.6))
            cont.append(q)
    # le linee interne (braccia, bocca, costume): i triangoli ci si appoggiano,
    # e le linee stesse si disegnano, cosi' il soggetto resta riconoscibile
    Dk = np.where(M, F.blur(Ml, 1.2) - F.blur(Ml, 6.0), np.nan)
    interne = [S.dirada(p, 1.0) for p in S.contorni(Dk, -0.16) if S.lunghezza(p) > 50]
    for p in interne:
        cont.append(resampled(p, px(lato * 0.7)))
    pts = np.vstack([pts] + cont + [np.array([[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]])])
    tri = delaunay(pts)

    neri, grigi, interni = set(), set(), []
    for a, b, c in tri:
        cen = (pts[a] + pts[b] + pts[c]) / 3
        dentro = M[min(int(cen[1]), H - 1), min(int(cen[0]), W - 1)]
        lati = [(min(a, b), max(a, b)), (min(b, c), max(b, c)), (min(c, a), max(c, a))]
        (neri if dentro else grigi).update(lati)
        if dentro and toni:
            t = Ml[min(int(cen[1]), H - 1), min(int(cen[0]), W - 1)]
            for f, soglia in ((0.5, 0.30),):
                if t < soglia:
                    q = [cen + (pts[i] - cen) * f for i in (a, b, c)]
                    interni.append([q[0], q[1], q[2], q[0]])
    # il grigio non deve ripassare un lato nero
    grigi -= neri

    def seg(es):
        return [[tuple(pts[i]), tuple(pts[j])] for i, j in es]
    contorni = [S.dirada(p, 0.7) for p in S.contorni(M.astype(float), 0.5, salta_nan=False)
                if S.lunghezza(p) > 30]
    nl = seg(neri) + [list(map(tuple, q)) for q in interni] + contorni + interne
    gl = seg(grigi)

    def lung(pl):
        return sum(S.lunghezza(p) for p in pl) * k / 1000.0
    g = lambda col, sw, linee: ('<g fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
                                'stroke-linejoin="round">\n%s\n</g>' % (col, sw, F.poly(linee, k)))
    open(uscita, 'w').write('\n'.join([
        '<svg xmlns="http://www.w3.org/2000/svg" width="%.2fmm" height="%.2fmm" viewBox="0 0 %.2f %.2f">'
        % (W * k, H * k, W * k, H * k),
        g(F.GRIGIO, 0.3, gl), g(F.NERO, 0.35, nl), '</svg>', '']))
    print('%d punti, %d triangoli; nero %d segmenti (%.1f m), grigio %d (%.1f m)' % (
        len(pts), len(tri), len(nl), lung(nl), len(gl), lung(gl)))
