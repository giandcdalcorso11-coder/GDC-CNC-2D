#!/usr/bin/env python3
"""Stile «Rilievo» partendo da uno SCREENSHOT del modello invece che dal modello.

Serve quando il file 3D e' troppo pesante. Senza una mappa di profondita' le
linee di livello si ricavano dalla LUMINOSITA' dell'ombreggiatura: linee di
uguale grigio, che sul modello liscio ricalcano il rilievo, come curve di
livello disegnate a occhio. La sagoma e' il contorno della figura staccata dallo
sfondo (e dal pavimento del programma di slicing, che si riconosce perche' scuro).

  python3 -B da_immagine.py <screenshot.png> <uscita.svg> [W H] [livelli] [levigatura_px] [essenziale] [senza-pavimento] [escludi=x0,y0,x1,y1 ...] [taglia=x0,y0,x1,y1 ...] [soglia=n]

  soglia=n: quanto piu' scuro del contorno deve essere un tratto di dettaglio (default 9; piu' basso = piu' tratti)

  essenziale: niente tratti di dettaglio, linee piu' levigate e meno numerose (la
  resa delle figure di `rilievo.py` in modo profondita')
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

import rilievo
S = rilievo.viste.S

FONDO_TOL = 2          # scarto dal grigio dello sfondo, sotto cui e' sfondo
DETTAGLIO = 9         # quanto deve essere piu' scuro del contorno per essere un tratto
MIN_COMPONENTE = 600   # px: sotto, e' un pezzo di griglia, non una parte della figura
PAVIMENTO = 110        # sotto questa luminosita' e' il piano di stampa, non la figura


def componente(m, seme):
    """La parte di `m` collegata a `seme` (dilatazione ripetuta dentro la maschera)."""
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


def maschera(L):
    # lo sfondo e' solo il grigio piatto CONNESSO al bordo: dentro la figura
    # l'ombreggiatura passa anche per quel grigio, e non e' sfondo. Il riempimento
    # dei buchi di riempi_buchi() fa proprio questo: tiene cio' che non e' piatto
    # piu' il piatto che il bordo non raggiunge.
    piatto = np.abs(L - L[2, 2]) <= 1
    fig = S.riempi_buchi(~piatto) & (L >= PAVIMENTO)
    im = Image.fromarray((fig * 255).astype(np.uint8))
    im = im.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))   # via le righe della griglia
    ok = np.asarray(im) > 0
    tenute = np.zeros_like(ok)
    resto = ok.copy()
    while resto.any():
        ys, xs = np.nonzero(resto)
        c = componente(resto, (int(xs[0]), int(ys[0])))
        if c.sum() >= MIN_COMPONENTE:
            tenute |= c
        resto &= ~c
    return S.riempi_buchi(tenute)


def tracciati(percorso, livelli=7, levigatura=2.2, dettagli=True, minimo=0.06, escludi=(), taglia=(), soglia=None):
    L = np.asarray(Image.open(percorso).convert('L')).astype(float)
    mask = maschera(L)
    # taglia=x0,y0,x1,y1: toglie dalla figura un pezzo che non ci deve stare
    # (coordinate 0..1 sul rettangolo che racchiude la figura)
    if taglia:
        ys0, xs0 = np.nonzero(mask)
        ya, yb, xa, xb = ys0.min(), ys0.max(), xs0.min(), xs0.max()
        for x0, y0, x1, y1 in taglia:
            mask[int(ya + y0 * (yb - ya)):int(ya + y1 * (yb - ya)) + 1,
                 int(xa + x0 * (xb - xa)):int(xa + x1 * (xb - xa)) + 1] = False
    righe, colonne = np.nonzero(mask)
    r0, r1, c0, c1 = righe.min(), righe.max(), colonne.min(), colonne.max()
    k = 1.0 / (r1 - r0)

    def norm(p, tol=0.0010):
        return S.dirada([((x - c0) * k, (y - r0) * k) for x, y in p], tol)

    sagoma = [q for q in (norm(p) for p in S.contorni(mask.astype(float), 0.5, salta_nan=False))
              if len(q) > 1 and S.lunghezza(q) > 0.05]

    G = Image.fromarray(np.where(mask, L, L[mask].mean()).astype(np.uint8))
    G = np.asarray(G.filter(ImageFilter.GaussianBlur(levigatura))).astype(float)
    G = np.where(mask, G, np.nan)
    lo, hi = np.nanpercentile(G, 4), np.nanpercentile(G, 97)
    iso = []
    for liv in np.linspace(lo, hi, livelli + 2)[1:-1]:
        for p in S.contorni(G, liv):
            q = norm(p)
            if len(q) > 2 and S.lunghezza(q) > minimo:
                iso.append(q)

    # i dettagli: avvallamenti scuri e sottili (occhi, bocca, pieghe, bottoni)
    # = differenza fra la luminosita' poco e molto levigata
    Lm = np.where(mask, L, L[mask].mean())
    Gf = np.asarray(Image.fromarray(Lm.astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float)
    Gg = np.asarray(Image.fromarray(Lm.astype(np.uint8)).filter(ImageFilter.GaussianBlur(4.5))).astype(float)
    Dk = np.where(mask, Gf - Gg, np.nan)
    det = []
    for p in (S.contorni(Dk, -(soglia or DETTAGLIO)) if dettagli else []):
        q = norm(p, 0.0007)
        if len(q) > 2 and S.lunghezza(q) > 0.045:
            det.append(q)

    def fuori(p):
        xs, ys = [q[0] for q in p], [q[1] for q in p]
        r = (c1 - c0) * k
        return any(min(xs) >= a * r and max(xs) <= c * r and min(ys) >= b and max(ys) <= d
                   for a, b, c, d in escludi)
    if escludi:
        sagoma = [p for p in sagoma if not fuori(p)]
        iso = [p for p in iso if not fuori(p)]
        det = [p for p in det if not fuori(p)]
    return {'rapporto': (c1 - c0) * k, 'sagoma': sagoma, 'isoipse': iso, 'dettagli': det}


if __name__ == '__main__':
    W = float(sys.argv[3]) if len(sys.argv) > 4 else 210.0
    H = float(sys.argv[4]) if len(sys.argv) > 4 else 148.0
    liv = int(sys.argv[5]) if len(sys.argv) > 5 else 7
    lev = float(sys.argv[6]) if len(sys.argv) > 6 else 2.2
    extra = sys.argv[7:]
    essenziale = 'essenziale' in extra
    if 'senza-pavimento' in extra:
        PAVIMENTO = 0          # un render nostro non ha il piano di stampa: i bordi scuri sono figura
    # escludi=x0,y0,x1,y1 (0..1: x sulla larghezza della figura, y sull'altezza): toglie
    # i tracciati interamente dentro quel rettangolo
    escludi = [tuple(float(t) for t in e.split('=')[1].split(',')) for e in extra if e.startswith('escludi=')]
    taglia = [tuple(float(t) for t in e.split('=')[1].split(',')) for e in extra if e.startswith('taglia=')]
    soglia = next((float(e.split('=')[1]) for e in extra if e.startswith('soglia=')), None)
    d = tracciati(sys.argv[1], liv, lev, dettagli=not essenziale, soglia=soglia,
                  minimo=0.12 if essenziale else 0.06, escludi=escludi, taglia=taglia)
    print('rapporto %.3f, %d linee di livello' % (d['rapporto'], len(d['isoipse'])))
    open(sys.argv[2], 'w').write(rilievo.svg(d, W, H))
