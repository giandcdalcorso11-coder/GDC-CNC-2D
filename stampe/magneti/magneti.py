#!/usr/bin/env python3
"""I magneti grandi (75 x 75 mm) con la loro grafica, in due versioni:
  quadrato -> il magnete appoggiato dritto, grafica dentro il quadrato
  rombo    -> il magnete ruotato di 45 gradi, grafica DRITTA (si legge in orizzontale),
              dentro il quadrato piu' grande che sta nel rombo

Per ogni magnete: lo SVG da tracciare (solo i tratti, nero) e un mockup con il
colore del magnete.

  python3 -B magneti.py <cartella-immagini> <cartella-uscita>
"""
import math
import os
import sys

import vettorializza as V

LATO = 75.0
RAGGIO = 4.0                       # angoli arrotondati dei magneti
TRATTO = 0.4
MARGINE_Q = 6.0                    # dal bordo, nel quadrato
MARGINE_R = 4.0                    # dal bordo del quadrato inscritto, nel rombo
RD = LATO * math.sqrt(2)           # lato della tavola che contiene il rombo (106,07)
INSCRITTO = LATO / math.sqrt(2)    # quadrato dritto piu' grande dentro il rombo (53,03)

# Una linea sola per tratto; lo spessore lo decide la penna scelta nello SLICER, per livello
# (cioe' per colore). Due penne:
#   FINE   = Tratto Pen, ~0,5 mm   -> colore nero    #111111
#   MARKER = indelebile, ~2 mm     -> colore grigio  #6b6b6b
COL_FINE, COL_MARKER = '#111111', '#6b6b6b'
W_FINE, W_MARKER = 0.5, 2.0

MAGNETI = [
    # nome, file, colore del magnete, cfg della vettorializzazione
    ('ripetizione-a-obiettivo', '18.jpg', '#3fb0c4', dict(testo=0.73, blob_src=30, marker_src=14.5)),
    ('costruzione', '19.jpg', '#f58a14', dict(testo=0.85, blob_src=30, esterno=True, sottile='marker')),
    ('gioco', '20.jpg', '#6bb52f', dict(testo=0.79, blob_src=30, marker_src=15, sottile='fine')),
]


def poly(linee, dx, dy):
    return '\n'.join('<polyline points="%s"/>' % ' '.join(
        '%.2f,%.2f' % (x + dx, y + dy) for x, y in p) for p in linee)


def gruppi(fine, marker, dx, dy, reale=False):
    """I due livelli. reale=True: tutto nero con gli spessori veri (per il mockup)."""
    cf, cm = (COL_FINE, COL_FINE) if reale else (COL_FINE, COL_MARKER)
    out = []
    if marker:
        out.append('<g fill="none" stroke="%s" stroke-width="%g" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g>'
                   % (cm, W_MARKER, poly(marker, dx, dy)))
    if fine:
        out.append('<g fill="none" stroke="%s" stroke-width="%g" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g>'
                   % (cf, W_FINE, poly(fine, dx, dy)))
    return '\n'.join(out)


def tratti(dati, cx, cy, reale=False):
    fine, marker, w, h = dati
    return gruppi(fine, marker, cx - w / 2, cy - h / 2, reale)


def svg(w, h, corpo):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%.2fmm" height="%.2fmm" viewBox="0 0 %.2f %.2f">\n%s\n</svg>\n'
            % (w, h, w, h, corpo))


def magnete(cx, cy, colore, ruota):
    return ('<rect x="%.2f" y="%.2f" width="%g" height="%g" rx="%g" fill="%s" stroke="#00000033" '
            'stroke-width="0.3" transform="rotate(%g %.2f %.2f)"/>'
            % (cx - LATO / 2, cy - LATO / 2, LATO, LATO, RAGGIO, colore, ruota, cx, cy))


if __name__ == '__main__':
    imgs, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    celle = []
    for nome, f, colore, cfg in MAGNETI:
        q = V.costruisci_doppio(os.path.join(imgs, f), LATO - 2 * MARGINE_Q, cfg)
        # nel rombo la grafica e' piu' piccola: la scritta a marker (2 mm) si impasterebbe
        r = V.costruisci_doppio(os.path.join(imgs, f), INSCRITTO - 2 * MARGINE_R, dict(cfg, testo_fine=True))
        open(os.path.join(out, nome + '-quadrato.svg'), 'w').write(svg(LATO, LATO, tratti(q, LATO / 2, LATO / 2)))
        open(os.path.join(out, nome + '-rombo.svg'), 'w').write(svg(RD, RD, tratti(r, RD / 2, RD / 2)))
        celle.append((nome, colore, q, r))
        print(nome, '- quadrato: %d fine + %d marker; rombo: %d + %d' % (len(q[0]), len(q[1]), len(r[0]), len(r[1])))

    gap = 14.0
    colw = RD + gap
    W = 3 * colw + gap
    H = 2 * RD + 3 * gap
    corpo = ['<rect width="%g" height="%g" fill="#f4f2ee"/>' % (W, H)]
    for i, (nome, colore, q, r) in enumerate(celle):
        cx = gap + colw * i + RD / 2
        cy1 = gap + RD / 2
        cy2 = 2 * gap + RD + RD / 2
        corpo.append(magnete(cx, cy1, colore, 0))
        corpo.append(tratti(q, cx, cy1, True))
        corpo.append(magnete(cx, cy2, colore, 45))
        corpo.append(tratti(r, cx, cy2, True))
    open(os.path.join(out, 'mockup-grandi.svg'), 'w').write(svg(W, H, '\n'.join(corpo)))
