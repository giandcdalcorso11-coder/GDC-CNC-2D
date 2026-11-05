#!/usr/bin/env python3
"""I magneti piccoli (75 x 25 mm: INTENZIONE, FASE, RALLY, SCORE) e i tre bianchi
grandi (fase: BLOCCATA, REGOLARE, ALTERNATA), a una linea per tratto e due penne:
  marker (indelebile, ~2 mm): le scritte e il cerchio
  fine (Tratto Pen, ~0,5 mm): le icone

Le scritte hanno il carattere delle grafiche dei magneti colorati (Montserrat
ExtraBold Italic, OFL), a linea di mezzo. Le icone dei bianchi sono ridisegnate qui
(geometria) sul modello dell'immagine ricevuta.

  python3 -B piccoli_e_bianchi.py <font-montserrat.ttf> <cartella-uscita> <cartella-immagini>
"""
import math
import os
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

import magneti as M
import testo_marker as T
import vettorializza as V

LATO = M.LATO
H_PIC = 25.0


# ---------------------------------------------------------------- testo

def testo(font, stringa, alt_maiuscole_mm, fine=False):
    """(linee, w, h): la scritta, in mm, origine in alto a sinistra. Motore: testo_marker.py
    (il tratto resta dentro la lettera, spaziatura sulla forma)."""
    w = M.W_FINE if fine else M.W_MARKER
    return T.scritta(font, stringa, alt_maiuscole_mm, w_mm=w, vuoto_mm=max(0.9, 0.6 * w) if not fine else 0.5)


# ------------------------------------------------------------ primitive

def arco(cx, cy, r, a0, a1, n=48):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def rect_arr(x, y, w, h, r):
    p = []
    p += arco(x + w - r, y + r, r, -90, 0, 10)
    p += arco(x + w - r, y + h - r, r, 0, 90, 10)
    p += arco(x + r, y + h - r, r, 90, 180, 10)
    p += arco(x + r, y + r, r, 180, 270, 10)
    return p + [p[0]]


def scintille(cx, cy, r0, r1, angoli):
    return [[(cx + r0 * math.cos(math.radians(a)), cy + r0 * math.sin(math.radians(a))),
             (cx + r1 * math.cos(math.radians(a)), cy + r1 * math.sin(math.radians(a)))] for a in angoli]


def sposta(linee, dx, dy):
    return [[(x + dx, y + dy) for x, y in p] for p in linee]


def metti(t, cx, y_alto):
    l, w, h = t
    return sposta(l, cx - w / 2, y_alto)


# ------------------------------------------------------- i tre bianchi
# ognuno restituisce (fine, marker)

def cerchio(c):
    return arco(c, c, 31.5, 0, 360, 120)


def bloccata(font):
    c = LATO / 2
    fine = [rect_arr(c - 10, c - 14, 20, 15, 3),
            [(c - 6.5, c - 14)] + arco(c, c - 14, 6.5, 180, 360, 24),
            arco(c, c - 8.5, 1.6, 0, 360, 20),
            [(c - 0.8, c - 7), (c - 1.3, c - 3), (c + 1.3, c - 3), (c + 0.8, c - 7)]]
    fine += scintille(c + 11, c - 22, 3, 6.5, [-20, -55, 10])
    marker = [cerchio(c)] + metti(testo(font, 'BLOCCATA', 5.4), c, c + 8)
    return fine, marker


def regolare(font):
    c = LATO / 2
    fine = []
    for x0 in (c - 14.5, c + 0.5):
        fine.append(rect_arr(x0, c - 15, 13.5, 14, 1.8))
        fine.append([(x0 + 3.2, c - 17), (x0 + 3.2, c - 14)])
        fine.append([(x0 + 10.3, c - 17), (x0 + 10.3, c - 14)])
    fine.append([(c - 16, c + 1), (c + 16, c + 1)])
    # le cifre sono geometria, non carattere: a quella misura un '1' da font diventa un uncino
    x1, x0 = c - 14.5 + 6.75, c + 0.5 + 6.75
    fine.append([(x1 - 2.2, c - 11), (x1 + 0.5, c - 13), (x1 + 0.5, c - 3.5)])
    fine.append(arco(x0, c - 8, 3.0, 0, 360, 24))
    fine[-1] = [(x0 + (px - x0) * 0.8, py) for px, py in fine[-1]]
    t = testo(font, 'RPS', 3.6, fine=True)
    fine += sposta(t[0], c - 14, c - 24)
    fine += scintille(c + 11, c - 22, 2.5, 6, [-25, -60, 5])
    marker = [cerchio(c)] + metti(testo(font, 'REGOLARE', 4.8), c, c + 9)
    return fine, marker


def alternata(font):
    c = LATO / 2

    def freccia(x0, y0, dx):
        L_, T, A = 24.0, 9.0, 4.0
        pts = [(0, -A / 2), (L_ - 9, -A / 2), (L_ - 9, -T / 2), (L_, 0), (L_ - 9, T / 2),
               (L_ - 9, A / 2), (0, A / 2), (0, -A / 2)]
        return [((x0 + px) if dx > 0 else (x0 + L_ - px), y0 + py) for px, py in pts]
    fine = [freccia(c - 12, c - 15, +1), freccia(c - 12, c - 3, -1)]
    fine += scintille(c - 14, c - 15, 3, 6.5, [200, 235, 165])
    fine += scintille(c + 14, c - 4, 3, 6.5, [20, -15, 55])
    marker = [cerchio(c)] + metti(testo(font, 'ALTERNATA', 4.6), c, c + 9)
    return fine, marker


# --------------------------------------------------------------- uscita

def gruppo_svg(fine, marker, dx=0, dy=0, reale=False):
    return M.gruppi(fine, marker, dx, dy, reale)


if __name__ == '__main__':
    font, out, imgs = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)

    # --- i quattro piccoli: scritta a marker, stessa altezza di lettera per tutti
    parole = ['INTENZIONE', 'FASE', 'RALLY', 'SCORE']
    larg_max = LATO - 2 * 5.0                      # 65 mm: margine di 5 dal bordo
    alt = 7.0
    while testo(font, 'INTENZIONE', alt)[1] > larg_max:
        alt -= 0.2
    piccoli = {}
    for p in parole:
        l, w, h = testo(font, p, alt)
        piccoli[p] = (l, w, h)
        open(os.path.join(out, 'piccolo-%s.svg' % p.lower()), 'w').write(
            M.svg(LATO, H_PIC, gruppo_svg([], l, LATO / 2 * 0 + (LATO - w) / 2, (H_PIC - h) / 2)))
        print('piccolo', p, '%.1f x %.1f mm, %d tratti' % (w, h, len(l)))

    bianchi = {}
    for nome, fn in (('fase-bloccata', bloccata), ('fase-regolare', regolare), ('fase-alternata', alternata)):
        fi, ma = fn(font)
        bianchi[nome] = (fi, ma)
        open(os.path.join(out, nome + '-quadrato.svg'), 'w').write(M.svg(LATO, LATO, gruppo_svg(fi, ma)))
        print(nome, len(fi), 'fine +', len(ma), 'marker')

    # --- il mockup completo (tutto nero, spessori veri)
    gap = 12.0
    colw = LATO + gap
    W = 4 * colw + gap
    corpo = []
    y = gap
    # prima riga: i tre colorati, nella versione RITOCCATA DALL'UTENTE (finali-utente/): sono
    # loro i file buoni, e il confronto con quanto generato prima e' nel README
    import glob
    import re
    colori = {'verde': '#6bb52f', 'arancione': '#f58a14', 'blu': '#3fb0c4'}
    for i, nome in enumerate(('blu', 'arancione', 'verde')):
        f = glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'finali-utente', '*%s*.svg' % nome))[0]
        t = open(f, encoding='utf-8').read()
        vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', t).group(1).split()]
        corpo_u = t[t.index('<g transform'):t.rindex('</svg>')]
        corpo_u = re.sub(r'stroke="hsl\([^"]*\)"', 'stroke="#111"', corpo_u).replace('stroke-width="0.3"', 'stroke-width="%g"' % M.W_MARKER)
        cx = gap + colw * i
        corpo.append(M.magnete(cx + LATO / 2, y + LATO / 2, colori[nome], 0))
        corpo.append('<g transform="translate(%.2f %.2f)">%s</g>' % (cx, y, corpo_u))
    y += LATO + gap
    for i, (nome, (fi, ma)) in enumerate(bianchi.items()):
        cx = gap + colw * i + LATO / 2
        corpo.append(M.magnete(cx, y + LATO / 2, '#fafafa', 0))
        corpo.append(gruppo_svg(fi, ma, cx - LATO / 2, y, True))
    y += LATO + gap
    for i, p in enumerate(parole):
        l, w, h = piccoli[p]
        cx = gap + colw * i + LATO / 2
        corpo.append('<rect x="%.2f" y="%.2f" width="%g" height="%g" rx="3" fill="#e3e6e9" stroke="#00000033" stroke-width="0.3"/>'
                     % (cx - LATO / 2, y, LATO, H_PIC))
        corpo.append(gruppo_svg([], l, cx - w / 2, y + (H_PIC - h) / 2, True))
    y += H_PIC + gap
    corpo.insert(0, '<rect width="%g" height="%g" fill="#f4f2ee"/>' % (W, y))
    open(os.path.join(out, 'mockup-completo.svg'), 'w').write(M.svg(W, y, '\n'.join(corpo)))
