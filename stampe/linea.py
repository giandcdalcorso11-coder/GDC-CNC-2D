#!/usr/bin/env python3
"""Stile «Linea»: un'icona o un logo pieni diventano UNA linea per tratto, con due penne.

Una penna ha una larghezza: lo spessore lo sceglie l'utente per livello nello SLICER, quindi
qui non si disegna mai il contorno di una parte spessa (salvo le forme piene grandi).
  fine    -> Tratto Pen (~0,5 mm)   colore #111111
  marker  -> indelebile (1,5 mm)    colore #6b6b6b
Il motore e' magneti/vettorializza.py (costruisci_doppio); le scritte per il pennarello grosso
hanno la loro regola in magneti/testo_marker.py (tratto dentro la lettera, spaziatura sulla forma).

  python3 -B linea.py <immagine> <uscita.svg> <W> <H> <margine> [chiave=valore ...]

chiavi (cfg di costruisci_doppio):  testo=<frazione dell'altezza da cui in giu' e' scritta>
  blob=<px>  marker=<px>  sottile=fine|marker  esterno  testo_fine
"""
import os
import sys

import numpy as np

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(QUI, 'magneti'))
import vettorializza as V  # noqa: E402

FINE = ('#111111', 0.5)
MARKER = ('#6b6b6b', 1.5)


def gruppo(linee, col, sw, dx, dy):
    if not linee:
        return ''
    righe = '\n'.join('<polyline points="%s"/>' % ' '.join('%.2f,%.2f' % (x + dx, y + dy) for x, y in p)
                      for p in linee)
    return ('<g fill="none" stroke="%s" stroke-width="%g" stroke-linecap="round" '
            'stroke-linejoin="round">\n%s\n</g>\n' % (col, sw, righe))


def genera(immagine, W, H, margine, cfg):
    m = V.maschera(immagine)
    ys, xs = np.nonzero(np.asarray(m) > 128)
    aspect = (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)
    aw, ah = W - 2 * margine, H - 2 * margine
    w_fit = min(aw, ah * aspect)
    contenuto = max(w_fit, w_fit / aspect)          # costruisci_doppio scala il lato lungo
    fine, marker, w, h = V.costruisci_doppio(immagine, contenuto, cfg)
    dx, dy = (W - w) / 2, (H - h) / 2
    corpo = gruppo(marker, MARKER[0], MARKER[1], dx, dy) + gruppo(fine, FINE[0], FINE[1], dx, dy)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%gmm" height="%gmm" viewBox="0 0 %g %g">\n%s</svg>\n'
           % (W, H, W, H, corpo))
    return svg, len(fine), len(marker)


if __name__ == '__main__':
    imm, uscita = sys.argv[1], sys.argv[2]
    W, H, mar = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
    cfg = {}
    for a in sys.argv[6:]:
        k, _, v = a.partition('=')
        k = {'blob': 'blob_src', 'marker': 'marker_src'}.get(k, k)
        if k in ('testo', 'blob_src', 'marker_src'):
            cfg[k] = float(v)
        elif k == 'sottile':
            cfg[k] = v
        else:
            cfg[k] = True
    svg, nf, nm = genera(imm, W, H, mar, cfg)
    open(uscita, 'w').write(svg)
    print('linea: %d tratti fine, %d tratti marker' % (nf, nm))
