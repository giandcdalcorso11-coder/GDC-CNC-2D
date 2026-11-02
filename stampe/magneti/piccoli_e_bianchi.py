#!/usr/bin/env python3
"""I magneti piccoli (75 x 25 mm: INTENZIONE, FASE, RALLY, SCORE) e i tre bianchi
grandi (fase: BLOCCATA, REGOLARE, ALTERNATA).

Le scritte hanno lo stesso carattere delle grafiche dei magneti colorati
(Montserrat ExtraBold Italic, OFL), passato dalla stessa vettorializzazione:
contorno delle lettere spesse. Le icone dei bianchi sono ridisegnate qui a mano
(geometria) sul modello dell'immagine ricevuta, e il loro tratto e' singolo.

  python3 -B piccoli_e_bianchi.py <font-montserrat.ttf> <cartella-uscita>
"""
import math
import os
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

import magneti as M
import vettorializza as V

LATO, RAGGIO = M.LATO, M.RAGGIO
H_PIC = 25.0
TRATTO = M.TRATTO


# ---------------------------------------------------------------- testo

def testo(font, stringa, alt_maiuscole_mm, tutto_linea=False, spessore=None):
    """Polilinee (mm, origine in alto a sinistra) e dimensioni di una scritta."""
    f = ImageFont.truetype(font, 300)
    box = f.getbbox(stringa)
    img = Image.new('RGB', (box[2] + 80, box[3] + 80), 'white')
    ImageDraw.Draw(img).text((40, 40), stringa, font=f, fill='black')
    px_h = f.getbbox('H')[3] - f.getbbox('H')[1]          # altezza delle maiuscole
    k = alt_maiuscole_mm / px_h
    ys, xs = [], []
    a = img.convert('L').point(lambda v: 255 if v < 128 else 0)
    bb = a.getbbox()
    contenuto = max(bb[2] - bb[0], bb[3] - bb[1]) * k
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as t:
        img.save(t.name)
    try:
        return V.costruisci(t.name, contenuto, spessore, 1.0 if tutto_linea else None)
    finally:
        os.unlink(t.name)


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


def metti(linee_dim, cx, y_alto):
    """Centra una scritta (linee, w, h) in cx, con il bordo alto a y_alto."""
    l, w, h = linee_dim
    return sposta(l, cx - w / 2, y_alto)


# ------------------------------------------------------- i tre bianchi

def bloccata(font):
    c = LATO / 2
    L = [arco(c, c, 31.0, 0, 360, 120)]
    # lucchetto
    L.append(rect_arr(c - 11, c - 6, 22, 17, 3))
    L.append(arco(c, c - 6, 7.5, 180, 360, 24) + [(c + 7.5, c - 6)])      # arco: da sx a dx
    L[-1] = [(c - 7.5, c - 6)] + arco(c, c - 6, 7.5, 180, 360, 24)
    L.append(arco(c, c + 0.5, 1.7, 0, 360, 20))                           # buco
    L.append([(c - 0.8, c + 2), (c - 1.4, c + 6), (c + 1.4, c + 6), (c + 0.8, c + 2)])
    L += scintille(c + 12, c - 15, 3, 7, [-20, -55, 10])
    t = testo(font, 'BLOCCATA', 5.2)
    L += metti(t, c, c + 14)
    return L


def regolare(font):
    c = LATO / 2
    L = [arco(c, c, 31.0, 0, 360, 120)]
    # due cartellini a calendario
    for x0 in (c - 14.5, c + 0.5):
        L.append(rect_arr(x0, c - 8, 13.5, 14, 1.8))
        L.append([(x0 + 3.2, c - 10), (x0 + 3.2, c - 7)])                  # anelli
        L.append([(x0 + 10.3, c - 10), (x0 + 10.3, c - 7)])
    L.append([(c - 16, c + 8), (c + 16, c + 8)])                          # base
    for cifra, x0 in (('1', c - 14.5), ('0', c + 0.5)):
        t = testo(font, cifra, 6.0)
        L += sposta(t[0], x0 + 6.75 - t[1] / 2, c - 5)
    t = testo(font, 'RPS', 3.4)
    L += sposta(t[0], c - 11, c - 17.5)
    L += scintille(c + 9, c - 15, 2.5, 6, [-25, -60, 5])
    L += metti(testo(font, 'REGOLARE', 4.6), c, c + 11.2)
    return L


def alternata(font):
    c = LATO / 2
    L = [arco(c, c, 31.0, 0, 360, 120)]
    def freccia(x0, y0, dx):
        # freccia a blocco lunga 24, alta 10; dx = +1 verso destra, -1 verso sinistra
        L_, T, A = 24.0, 9.0, 4.0
        pts = [(0, -A / 2), (L_ - 9, -A / 2), (L_ - 9, -T / 2), (L_, 0), (L_ - 9, T / 2),
               (L_ - 9, A / 2), (0, A / 2), (0, -A / 2)]
        return [((x0 + px) if dx > 0 else (x0 + L_ - px), y0 + py) for px, py in pts]
    L.append(freccia(c - 12, c - 8, +1))
    L.append(freccia(c - 12, c + 4, -1))
    L += scintille(c - 14, c - 8, 3, 6.5, [200, 235, 165])
    L += scintille(c + 14, c + 3, 3, 6.5, [20, -15, 55])
    L += metti(testo(font, 'ALTERNATA', 4.6), c, c + 14)
    return L


# --------------------------------------------------------------- uscita

def piccolo(font, parola, scala):
    return testo(font, parola, scala)


if __name__ == '__main__':
    font, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)

    # --- i quattro piccoli: stessa altezza di lettera, fissata dalla parola piu' lunga
    parole = ['INTENZIONE', 'FASE', 'RALLY', 'SCORE']
    ref = testo(font, 'INTENZIONE', 8.0)
    alt = 8.0 * (LATO - 2 * M.MARGINE_Q) / ref[1] if ref[1] > LATO - 2 * M.MARGINE_Q else 8.0
    piccoli = {}
    for p in parole:
        l, w, h = testo(font, p, alt)
        piccoli[p] = (l, w, h)
        open(os.path.join(out, 'piccolo-%s.svg' % p.lower()), 'w').write(
            M.svg(LATO, H_PIC, M.tratti(l, LATO / 2, H_PIC / 2, w, h)))
        print('piccolo', p, '%.1f x %.1f mm, %d tratti' % (w, h, len(l)))

    # --- i tre bianchi
    bianchi = {}
    for nome, fn in (('fase-bloccata', bloccata), ('fase-regolare', regolare), ('fase-alternata', alternata)):
        l = fn(font)
        bianchi[nome] = l
        open(os.path.join(out, nome + '-quadrato.svg'), 'w').write(
            M.svg(LATO, LATO, '<g fill="none" stroke="#111" stroke-width="%g" stroke-linecap="round" '
                  'stroke-linejoin="round">\n%s\n</g>' % (TRATTO, M.poly(l, 0, 0))))
        print(nome, len(l), 'tratti')

    # --- il mockup completo
    gap = 12.0
    righe = [
        ('grandi', M.MAGNETI),
    ]
    colw = LATO + gap
    W = 4 * colw + gap
    celle = []
    # riga 1: i tre colorati quadrati; riga 2: i tre bianchi; riga 3: i quattro piccoli
    corpo = []
    y = gap
    for i, (nome, f, colore, sp, lin) in enumerate(M.MAGNETI):
        q, wq, hq = V.costruisci(os.path.join(sys.argv[3], f), LATO - 2 * M.MARGINE_Q, sp, lin)
        cx = gap + colw * i + LATO / 2
        corpo.append(M.magnete(cx, y + LATO / 2, colore, 0))
        corpo.append(M.tratti(q, cx, y + LATO / 2, wq, hq))
    y += LATO + gap
    for i, (nome, l) in enumerate(bianchi.items()):
        cx = gap + colw * i + LATO / 2
        corpo.append(M.magnete(cx, y + LATO / 2, '#fafafa', 0))
        corpo.append('<g fill="none" stroke="#111" stroke-width="%g" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g>'
                     % (TRATTO, M.poly(l, cx - LATO / 2, y)))
    y += LATO + gap
    for i, p in enumerate(parole):
        l, w, h = piccoli[p]
        cx = gap + colw * i + LATO / 2
        corpo.append('<rect x="%.2f" y="%.2f" width="%g" height="%g" rx="%g" fill="#e3e6e9" stroke="#00000033" stroke-width="0.3"/>'
                     % (cx - LATO / 2, y, LATO, H_PIC, 3.0))
        corpo.append(M.tratti(l, cx, y + H_PIC / 2, w, h))
    y += H_PIC + gap
    corpo.insert(0, '<rect width="%g" height="%g" fill="#f4f2ee"/>' % (W, y))
    open(os.path.join(out, 'mockup-completo.svg'), 'w').write(M.svg(W, y, '\n'.join(corpo)))
