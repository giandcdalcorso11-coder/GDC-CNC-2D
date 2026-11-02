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

MAGNETI = [
    # spessore (px del file di partenza) sotto cui una linea si disegna per il mezzo
    # invece che per il contorno; e, se c'e', la quota sopra cui TUTTO e' linea di mezzo
    ('ripetizione-a-obiettivo', '18.jpg', '#3fb0c4', 13, None),
    ('costruzione', '19.jpg', '#f58a14', 13, None),
    ('gioco', '20.jpg', '#6bb52f', 13, 0.77),
]


def poly(linee, dx, dy):
    return '\n'.join('<polyline points="%s"/>' % ' '.join(
        '%.2f,%.2f' % (x + dx, y + dy) for x, y in p) for p in linee)


def tratti(linee, cx, cy, w, h):
    return ('<g fill="none" stroke="#111" stroke-width="%g" stroke-linecap="round" '
            'stroke-linejoin="round">\n%s\n</g>' % (TRATTO, poly(linee, cx - w / 2, cy - h / 2)))


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
    for nome, f, colore, sp, lin in MAGNETI:
        q, wq, hq = V.costruisci(os.path.join(imgs, f), LATO - 2 * MARGINE_Q, sp, lin)
        r, wr, hr = V.costruisci(os.path.join(imgs, f), INSCRITTO - 2 * MARGINE_R, sp, lin)
        open(os.path.join(out, nome + '-quadrato.svg'), 'w').write(
            svg(LATO, LATO, tratti(q, LATO / 2, LATO / 2, wq, hq)))
        open(os.path.join(out, nome + '-rombo.svg'), 'w').write(
            svg(RD, RD, tratti(r, RD / 2, RD / 2, wr, hr)))
        celle.append((nome, colore, q, wq, hq, r, wr, hr))
        print(nome, '- quadrato %d tratti, rombo %d tratti' % (len(q), len(r)))

    # mockup: due righe (quadrato, rombo), tre colonne
    gap = 14.0
    colw = RD + gap
    W = 3 * colw + gap
    H = 2 * RD + 3 * gap
    corpo = ['<rect width="%g" height="%g" fill="#f4f2ee"/>' % (W, H)]
    for i, (nome, colore, q, wq, hq, r, wr, hr) in enumerate(celle):
        cx = gap + colw * i + RD / 2
        cy1 = gap + RD / 2
        cy2 = 2 * gap + RD + RD / 2
        corpo.append(magnete(cx, cy1, colore, 0))
        corpo.append(tratti(q, cx, cy1, wq, hq))
        corpo.append(magnete(cx, cy2, colore, 45))
        corpo.append(tratti(r, cx, cy2, wr, hr))
    open(os.path.join(out, 'mockup-grandi.svg'), 'w').write(svg(W, H, '\n'.join(corpo)))
