#!/usr/bin/env python3
"""Stile «Fedele»: da un'immagine a un disegno che la riporta il piu' fedelmente possibile.

Pensato per ILLUSTRAZIONI (loghi, icone, disegni a campiture piatte), non per le foto: di ogni
campitura di colore si traccia il CONTORNO, senza reinterpretare niente. Il passo e' la
vettorializzazione dei contorni (marching squares su una maschera levigata e ingrandita 3x);
cio' che cambia col dettaglio e' quanto si ripulisce la grana e quanto si semplificano le curve.

  python3 -B fedele.py <immagine> <uscita.svg> <W> <H> <margine> [essenziale|medio|dettagliato|-2..4]
                       [colori=N] [riempimento=mm]

  colori=N         numero di colori d'inchiostro (default 1: l'inchiostro e' un colore solo su fondo
                   chiaro); con N>1 ogni colore e' un livello a parte, col suo colore
  riempimento=mm   tratteggio a 45 gradi dentro le campiture piene, a quel passo (default: nessuno)
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

import logo_vettoriale as LV

S = LV.S
SCALA = 3
# raggio di levigatura (px ingranditi), contorno minimo, graffio (lunghezza, rapporto), tolleranza
# per livello n (0 essenziale, 1 medio, 2 dettagliato; -1 e -2 piu' essenziali, 3 e 4 piu' dettagliati):
# raggio di levigatura (px ingranditi), contorno minimo, graffio (lunghezza, rapporto), tolleranza
DETTAGLIO_N = {
    -2: (3.4, 120, 320, 4.0, 2.0), -1: (2.9, 85, 270, 3.6, 1.6),
    0: (2.4, 60, 220, 3.2, 1.2), 1: (1.7, 30, 140, 2.6, 0.6), 2: (1.1, 14, 80, 2.0, 0.35),
    3: (0.8, 8, 50, 1.6, 0.25), 4: (0.6, 5, 30, 1.2, 0.18),
}
NOMI = {'essenziale': 0, 'medio': 1, 'dettagliato': 2}


def livello(v):
    return NOMI[v] if v in NOMI else int(v)


def maschere(percorso, colori):
    """[(colore rgb, immagine L 0..255 ingrandita)] una per colore d'inchiostro."""
    a = np.asarray(Image.open(percorso).convert('RGB')).astype(float)
    bordo = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    fondo = np.median(bordo, axis=0)                              # il colore della carta
    d_f = np.linalg.norm(a - fondo, axis=2)
    ink = d_f > 0.18 * d_f.max()
    px = a[ink]
    if len(px) == 0:
        raise SystemExit('nessun inchiostro trovato: il fondo deve essere chiaro e uniforme')
    rng = np.random.default_rng(1)
    cen = px[rng.choice(len(px), colori, replace=False)] if colori > 1 else px.mean(axis=0, keepdims=True)
    if colori == 1:
        cen = np.array([px[d_f[ink] > 0.6 * d_f.max()].mean(axis=0)])
    camp = px[rng.choice(len(px), min(len(px), 20000), replace=False)]
    for _ in range(10):
        lab = np.argmin(((camp[:, None, :] - cen[None]) ** 2).sum(-1), axis=1)
        for k in range(len(cen)):
            if (lab == k).any():
                cen[k] = camp[lab == k].mean(axis=0)
    out = []
    if colori == 1:
        d_i = np.linalg.norm(a - cen[0], axis=2)
        m = np.clip(d_f / (d_f + d_i + 1e-9), 0, 1)               # morbida: il bordo cade a meta' strada
        out.append((cen[0], m))
    else:
        etichetta = np.argmin(((a[:, :, None, :] - cen[None, None]) ** 2).sum(-1), axis=2)
        for k in range(len(cen)):
            out.append((cen[k], ((etichetta == k) & ink).astype(float)))
    res = []
    for c, m in out:
        g = Image.fromarray((m * 255).astype(np.uint8))
        res.append((c, g.resize((g.width * SCALA, g.height * SCALA), Image.LANCZOS)))
    return res


def contorni(img, dett):
    raggio, minimo, graffio_l, graffio_r, tol = DETTAGLIO_N[livello(dett)]
    m = np.asarray(img.filter(ImageFilter.GaussianBlur(raggio))).astype(float) / 255
    out = []
    for p in S.contorni(m, 0.5, salta_nan=False):
        L = S.lunghezza(p)
        if L < minimo:
            continue
        area = abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p)))) / 2
        if L < graffio_l and area / L < graffio_r:                # graffio: lungo e sottile
            continue
        q = S.dirada(p, tol)
        if len(q) > 2:
            out.append(q)
    return m, out


def main():
    imm, uscita = sys.argv[1], sys.argv[2]
    W, H, mar = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
    dett = sys.argv[6] if len(sys.argv) > 6 and '=' not in sys.argv[6] else 'medio'
    colori, riemp = 1, 0.0
    for a in sys.argv[6:]:
        if a.startswith('colori='):
            colori = int(a.split('=')[1])
        elif a.startswith('riempimento='):
            riemp = float(a.split('=')[1])
    livelli = []
    for c, g in maschere(imm, colori):
        m, cont = contorni(g, dett)
        livelli.append((c, m, cont))
    xs = [x for _, _, cs in livelli for p in cs for x, _ in p]
    ys = [y for _, _, cs in livelli for p in cs for _, y in p]
    if not xs:
        raise SystemExit('nessun contorno trovato')
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    k = min((W - 2 * mar) / (x1 - x0), (H - 2 * mar) / (y1 - y0))
    dx, dy = (W - (x1 - x0) * k) / 2 - x0 * k, (H - (y1 - y0) * k) / 2 - y0 * k
    gruppi, n = '', 0
    for c, m, cont in livelli:
        linee = list(cont)
        if riemp > 0:
            linee += [[(a, b) for a, b in s] for s in LV.tratteggio(m, riemp / k)]
        col = '#111111' if colori == 1 else '#%02x%02x%02x' % tuple(int(v * 0.75) for v in c)
        righe = '\n'.join('<polyline points="%s"/>' % ' '.join('%.2f,%.2f' % (x * k + dx, y * k + dy) for x, y in p)
                          for p in linee)
        gruppi += ('<g fill="none" stroke="%s" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g>\n'
                   % (col, righe))
        n += len(linee)
    open(uscita, 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%gmm" height="%gmm" viewBox="0 0 %g %g">\n%s</svg>\n'
                            % (W, H, W, H, gruppi))
    print('fedele (%s): %d contorni su %d colori, ingombro %.0f x %.0f mm' % (dett, n, colori, (x1 - x0) * k, (y1 - y0) * k))


if __name__ == '__main__':
    main()
