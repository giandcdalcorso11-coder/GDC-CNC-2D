#!/usr/bin/env python3
"""Scritte per il pennarello GROSSO (indelebile, ~1,5 mm secondo lo SLICER).

Il problema delle versioni precedenti: il CONTORNO di una lettera, tracciato con un
pennarello da 1,5 mm, sborda di mezzo pennarello da ogni parte; le lettere si ingrandiscono,
si toccano e si impastano. Lo scheletro, d'altra parte, e' rumoroso (spuntoni, gobbe).

La logica giusta (ricavata da come l'utente ha corretto a mano i file):
  - il pennarello deve restare DENTRO la lettera: il tratto va a w/2 dal bordo, cosi' il
    suo orlo esterno coincide con il bordo della lettera e non lo supera;
  - una lettera piu' larga di w si riempie con anelli concentrici distanziati di ~0,9 w,
    che si sovrappongono fra loro (ma solo dentro la stessa lettera);
  - una parte piu' sottile di w si traccia a linea di mezzo;
  - fra lettera e lettera resta un vuoto di almeno ~0,9 mm di inchiostro: la spaziatura
    si calcola sulla forma (riga per riga), non su un numero fisso.
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

import vettorializza as V

S = V.S
PX_MM = V.PX_MM


def _apri(b, r):
    return V.apri(b, r)


def erodi(b, r):
    for i in range(r):
        b = V._erodi(b, i % 2 == 1)
    return b


def dilata(b, r):
    for i in range(r):
        b = V._dilata(b, i % 2 == 0)
    return b


def contorni(b, minimo_px=10):
    sm = np.asarray(Image.fromarray((b * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float) / 255
    return [p for p in S.contorni(sm, 0.5, salta_nan=False) if S.lunghezza(p) > minimo_px]


def maschera_testo(font, stringa, cap_mm, vuoto_mm, spazio_parola=0.55):
    """Maschera bool del testo (PX_MM px/mm), con le lettere spaziate sulla forma."""
    f0 = ImageFont.truetype(font, 400)
    ratio = (f0.getbbox('H')[3] - f0.getbbox('H')[1]) / 400.0
    size = max(8, int(round(cap_mm * PX_MM / ratio)))
    f = ImageFont.truetype(font, size)
    cap_px = cap_mm * PX_MM
    vuoto = vuoto_mm * PX_MM
    pad = 8
    H = int(size * 1.6)
    glifi = []
    for ch in stringa:
        if ch == ' ':
            glifi.append(None)
            continue
        box = f.getbbox(ch)
        im = Image.new('L', (box[2] - box[0] + 2 * pad, H), 0)
        ImageDraw.Draw(im).text((pad - box[0], 0), ch, font=f, fill=255)
        glifi.append(np.asarray(im) > 127)
    # posizione orizzontale: la distanza minima riga-per-riga fra due lettere = vuoto
    xs = []
    cursore = 0
    prec = None
    for g in glifi:
        if g is None:
            cursore += int(spazio_parola * cap_px)
            prec = None
            xs.append(None)
            continue
        if prec is None:
            xs.append(cursore)
        else:
            gp, xp = prec
            rig = np.nonzero(gp.any(axis=1) & g.any(axis=1))[0]
            destra_prec = np.array([np.nonzero(gp[r])[0].max() for r in rig]) + xp
            sinistra = np.array([np.nonzero(g[r])[0].min() for r in rig])
            xs.append(int((destra_prec - sinistra).max() + vuoto))
        prec = (g, xs[-1])
        cursore = xs[-1] + (np.nonzero(g.any(axis=0))[0].max() if g.any() else 0)
    W = max((x + g.shape[1]) for x, g in zip(xs, glifi) if g is not None) + pad
    tela = np.zeros((H, W), dtype=bool)
    for x, g in zip(xs, glifi):
        if g is not None:
            tela[:, x:x + g.shape[1]] |= g
    ys, xx = np.nonzero(tela)
    return tela[ys.min():ys.max() + 1, xx.min():xx.max() + 1]


def tracciati(mask, w_mm, sovrapp=0.9, semplifica_mm=0.14, minimo_mm=0.8, spesso_x=2.6):
    """Linee da tracciare col pennarello di larghezza w_mm. Restituisce (linee in mm, w, h).

    Una parte larga meno di spesso_x * w si traccia a linea di mezzo (un solo passaggio: il
    pennarello la copre da bordo a bordo). Una parte piu' larga si riempie con anelli
    concentrici, il primo a w/2 dal bordo."""
    marg = int(w_mm * PX_MM) + 6
    b = np.pad(mask, marg)
    r0 = max(1, int(round(w_mm / 2 * PX_MM)))
    passo = max(2, int(round(sovrapp * w_mm * PX_MM)))
    rt = max(2, int(round(spesso_x * w_mm / 2 * PX_MM)))
    linee = []

    spesso = _apri(b, rt)
    livello = erodi(spesso, r0)
    while livello.any():
        linee += contorni(livello)
        livello = erodi(livello, passo)
    # tutto il resto, sottile: scheletro, ripulito
    resto = b & ~dilata(spesso, 2)
    resto = _apri(resto, 1)
    if resto.any():
        larg = V.larghezza_locale(resto)
        for c, ww in V._catene(V.scheletro(resto), larg, 1.0):
            linee.append(c)

    tol = semplifica_mm * PX_MM
    out = []
    for p in linee:
        q = S.dirada([(float(x), float(y)) for x, y in p], tol)
        if len(q) >= 2 and S.lunghezza(q) >= minimo_mm * PX_MM:
            out.append(q)
    h, wd = b.shape
    k = 1.0 / PX_MM
    return [[((x - marg) * k, (y - marg) * k) for x, y in p] for p in out], (wd - 2 * marg) * k, (h - 2 * marg) * k


def scritta(font, stringa, cap_mm, w_mm=1.5, vuoto_mm=0.9):
    """(linee, larghezza, altezza) in mm, origine in alto a sinistra del testo."""
    m = maschera_testo(font, stringa, cap_mm, vuoto_mm)
    return tracciati(m, w_mm)
