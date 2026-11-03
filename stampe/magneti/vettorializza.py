#!/usr/bin/env python3
"""Una grafica piena (icona + scritta) diventa tratti per una penna sola.

Una penna ha una larghezza: sotto ~1,6 mm un tratto disegnato come CONTORNO
verrebbe due righe che si toccano. Quindi la grafica si divide per spessore:
  - parti spesse (lettere, anelli, il mattoncino)  -> il loro CONTORNO
  - parti sottili (le linee dei giocatori, la rete) -> la LINEA DI MEZZO
    (scheletro), cioe' un solo passaggio di penna.

Il colore dell'inchiostro si riconosce da solo: e' quello che si stacca dalla carta.
"""
import importlib.util
import os

import numpy as np
from PIL import Image, ImageFilter

QUI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'viste', os.path.join(QUI, '..', 'portaoggetti-feffi', 'viste.py'))
viste = importlib.util.module_from_spec(spec)
spec.loader.exec_module(viste)
S = viste.S

PX_MM = 16            # risoluzione di lavoro: pixel per mm sul magnete
SPESSORE_SRC = 13.0   # px del file di partenza: sotto, linea di mezzo; sopra, contorno
                      # (le lettere e gli anelli sono 16-20 px, le linee dei giocatori 10-12)


def maschera(percorso):
    a = np.asarray(Image.open(percorso).convert('RGB')).astype(float)
    fondo = np.array([255.0, 255.0, 255.0])
    d = np.linalg.norm(a - fondo, axis=2)
    ink = a[d > 140].mean(axis=0)
    di = np.linalg.norm(a - ink, axis=2)
    m = np.clip(d / (d + di + 1e-9), 0, 1)
    return Image.fromarray((m * 255).astype(np.uint8))


def morfo(img, size, op):
    f = ImageFilter.MinFilter if op == 'min' else ImageFilter.MaxFilter
    return img.filter(f(size))


def _erodi(b, croce, fuori=False):
    P = np.pad(b, 1, constant_values=fuori)
    sh = [P[:-2, 1:-1], P[2:, 1:-1], P[1:-1, :-2], P[1:-1, 2:]]
    if not croce:
        sh += [P[:-2, :-2], P[:-2, 2:], P[2:, :-2], P[2:, 2:]]
    out = b.copy()
    for v in sh:
        out &= v
    return out


def _dilata(b, croce):
    return ~_erodi(~b, croce, True)


def apri(b, r):
    """Apertura con un ottagono di raggio r px (bool in, bool out): toglie cio' che
    e' piu' sottile di 2r in ogni direzione. Un quadrato toglierebbe le diagonali
    prima delle orizzontali, e le lettere inclinate si spezzerebbero."""
    for i in range(r):
        b = _erodi(b, i % 2 == 1)
    for i in range(r):
        b = _dilata(b, i % 2 == 0)
    return b


def _pulisci(b):
    """Toglie dallo scheletro i pixel d'angolo dei gradini (un pixel con due soli vicini,
    adiacenti fra loro): senza, ogni diagonale spessa si riempie di falsi incroci e si
    spezza in centinaia di pezzettini."""
    ys, xs = np.nonzero(b)
    pix = set(zip(xs.tolist(), ys.tolist()))
    N8 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
    cambiato = True
    while cambiato:
        cambiato = False
        for p in list(pix):
            if p not in pix:
                continue
            v = [(p[0] + dx, p[1] + dy) for dx, dy in N8 if (p[0] + dx, p[1] + dy) in pix]
            if len(v) == 2 and max(abs(v[0][0] - v[1][0]), abs(v[0][1] - v[1][1])) == 1:
                pix.discard(p)
                cambiato = True
    out = np.zeros_like(b)
    for x, y in pix:
        out[y, x] = True
    return out


def scheletro(b):
    """Zhang-Suen. b: bool 2D."""
    b = b.copy()
    H, W = b.shape
    while True:
        cambiato = False
        for passo in (0, 1):
            P = np.pad(b, 1)
            p2, p3, p4, p5 = P[:-2, 1:-1], P[:-2, 2:], P[1:-1, 2:], P[2:, 2:]
            p6, p7, p8, p9 = P[2:, 1:-1], P[2:, :-2], P[1:-1, :-2], P[:-2, :-2]
            vic = [p2, p3, p4, p5, p6, p7, p8, p9]
            B = sum(v.astype(int) for v in vic)
            seq = vic + [p2]
            A = sum(((~seq[i]) & seq[i + 1]).astype(int) for i in range(8))
            if passo == 0:
                c = (~(p2 & p4 & p6)) & (~(p4 & p6 & p8))
            else:
                c = (~(p2 & p4 & p8)) & (~(p2 & p6 & p8))
            rim = b & (B >= 2) & (B <= 6) & (A == 1) & c
            if rim.any():
                b &= ~rim
                cambiato = True
        if not cambiato:
            return _pulisci(b)


def traccia(sk):
    """Dai pixel dello scheletro a polilinee, camminando da nodo a nodo."""
    ys, xs = np.nonzero(sk)
    pix = set(zip(xs.tolist(), ys.tolist()))
    N8 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]

    def vic(p):
        return [(p[0] + dx, p[1] + dy) for dx, dy in N8 if (p[0] + dx, p[1] + dy) in pix]
    grado = {p: len(vic(p)) for p in pix}
    nodi = {p for p, g in grado.items() if g != 2}
    visitati = set()
    out = []

    estremi = {p for p, g in grado.items() if g == 1}

    def cammina(p0, p1):
        linea = [p0, p1]
        visitati.add((p0, p1))
        visitati.add((p1, p0))
        prec, cur = p0, p1
        while cur not in nodi:
            nxt = [q for q in vic(cur) if q != prec and (cur, q) not in visitati]
            if not nxt:
                break
            q = nxt[0]
            visitati.add((cur, q))
            visitati.add((q, cur))
            linea.append(q)
            prec, cur = cur, q
        return linea
    for p in nodi:
        for q in vic(p):
            if (p, q) not in visitati:
                l = cammina(p, q)
                out.append((l, l[0] in estremi or l[-1] in estremi))
    # anelli senza nodi
    for p in pix:
        for q in vic(p):
            if (p, q) not in visitati and grado[p] == 2:
                out.append((cammina(p, q), False))
    return out


def costruisci(percorso, contenuto_mm, spessore_src=None, linea_sopra=None):
    """Restituisce (polilinee in mm con origine in alto a sinistra, larghezza, altezza)
    della grafica scalata per stare in un quadrato di contenuto_mm di lato."""
    m = maschera(percorso)
    ys, xs = np.nonzero(np.asarray(m) > 128)
    m = m.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    k = contenuto_mm / max(m.size)
    m = m.resize((max(1, round(m.width * k * PX_MM)), max(1, round(m.height * k * PX_MM))), Image.LANCZOS)
    mm_px = 1.0 / PX_MM
    r = max(2, int(round((spessore_src or SPESSORE_SRC) / 2 * k * PX_MM)))
    bb = np.asarray(m.point(lambda v: 255 if v > 128 else 0)) > 0
    marg = 2 * r + 6                        # margine vuoto: il ritaglio tocca i bordi della grafica
    bb = np.pad(bb, marg)
    spesso_a = apri(bb, r)
    larga = spesso_a.copy()
    for i in range(3):
        larga = _dilata(larga, i % 2 == 0)
    sottile = bb & ~larga
    if linea_sopra is not None:
        # sopra questa quota (frazione dell'altezza) tutto e' linea di mezzo: la scena a
        # tratto di un'icona ha spessori che oscillano attorno alla soglia, e per
        # pixel verrebbe mezza contorno e mezza scheletro
        cut = marg + int(round(linea_sopra * (bb.shape[0] - 2 * marg)))
        spesso_a[:cut] = False
        sottile[:cut] = bb[:cut]
    sottile = apri(sottile, 1)                 # via i frammenti minuscoli lungo i bordi
    spesso_a = spesso_a[marg:-marg, marg:-marg]
    sottile = sottile[marg:-marg, marg:-marg]

    linee = []
    sm = np.asarray(Image.fromarray((spesso_a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.4))).astype(float) / 255
    for p in S.contorni(sm, 0.5, salta_nan=False):
        if S.lunghezza(p) > 20:
            linee.append(S.dirada(p, 0.6))
    sk = scheletro(sottile)
    pezzi = []
    for p, libero in traccia(sk):
        # un peduncolo e' un tratto corto che finisce nel vuoto: quello si butta.
        # Un tratto corto fra due incroci invece e' disegno, e se sparisse la linea si spezzerebbe
        # (ma sotto 3 px sono grumi dello scheletro negli incroci, non disegno).
        if len(p) >= 12 or (not libero and len(p) >= 3):
            pezzi += [[p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]] for i in range(len(p) - 1)]
    # i pezzi si ricuciono in catene lunghe attraverso gli incroci: meno sollevamenti di penna
    if pezzi:
        for p in S.cuci(np.array(pezzi, dtype=float), 0.5):
            linee.append(S.dirada([(float(x), float(y)) for x, y in p], 0.9))
    out = [[(x * mm_px, y * mm_px) for x, y in p] for p in linee if len(p) > 1]
    return out, m.width * mm_px, m.height * mm_px


# ======================================================================
# Versione a UNA LINEA per tratto, con due penne (dal 2026-11-03)
#
# Lo SLICER sceglie lo spessore per livello, cioe' per colore: qui non si
# disegna piu' il contorno delle parti spesse, si traccia una linea sola e lo
# spessore lo fa il pennarello.
#   fine    -> Tratto Pen (0,5 mm): contorni e dettagli sottili
#   marker  -> indelebile (2 mm): scritte e tratti spessi
# ======================================================================

def larghezza_locale(b):
    """Spessore (in px) del tratto in ogni pixel: erosioni successive."""
    d = np.zeros(b.shape, dtype=np.int32)
    cur = b.copy()
    n = 0
    while cur.any():
        n += 1
        cur = _erodi(cur, n % 2 == 0)
        d += cur
    return d * 2


def _catene(sk, larg, taglio_peduncoli):
    """Scheletro -> catene lunghe, ognuna con la sua larghezza mediana."""
    pezzi = []
    for p, libero in traccia(sk):
        w = float(np.median([larg[y, x] for x, y in p]))
        # un peduncolo e' un tratto corto che finisce nel vuoto; un tratto corto
        # fra due incroci e' disegno (ma sotto 3 px sono grumi)
        if libero and len(p) < max(12, taglio_peduncoli * w):
            continue
        pezzi += [[p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]] for i in range(len(p) - 1)]
    out = []
    if pezzi:
        for c in S.cuci(np.array(pezzi, dtype=float), 0.5):
            if S.lunghezza(c) < 5:             # grumi di un pixel negli incroci
                continue
            w = float(np.median([larg[min(int(round(y)), larg.shape[0] - 1), min(int(round(x)), larg.shape[1] - 1)]
                                 for x, y in c]))
            out.append(([(float(x), float(y)) for x, y in c], w))
    return out


def _contorni(b, soglia=0.5, minimo=20):
    sm = np.asarray(Image.fromarray((b * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.4))).astype(float) / 255
    return [S.dirada(p, 0.6) for p in S.contorni(sm, soglia, salta_nan=False) if S.lunghezza(p) > minimo]


def costruisci_doppio(percorso, contenuto_mm, cfg):
    """(fine, marker, larghezza_mm, altezza_mm): polilinee in mm, origine in alto a sinistra.

    cfg:
      testo      frazione dell'altezza da cui in giu' e' scritta (tutto a linea di mezzo,
                 marker); None se non c'e' scritta separata, 1.0 = e' tutta scritta
      blob_src   spessore (px del file) da cui in su una forma e' piena: ne resta il contorno
      marker_src spessore da cui in su una linea e' un tratto spesso (marker)
      sottile    'fine' o 'marker': dove va una linea sotto marker_src
      esterno    True: il contorno esterno dell'icona va in fine, gli interni in marker
      testo_fine True: anche la scritta in fine (per le versioni piccole, dove il marker la impasta)
      fine_blob  True: i contorni delle forme piene vanno in fine (default), False: in marker
    """
    m = maschera(percorso)
    ys, xs = np.nonzero(np.asarray(m) > 128)
    m = m.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    k = contenuto_mm / max(m.size)
    s = k * PX_MM
    m = m.resize((max(1, round(m.width * s)), max(1, round(m.height * s))), Image.LANCZOS)
    mm_px = 1.0 / PX_MM
    bb = np.asarray(m.point(lambda v: 255 if v > 128 else 0)) > 0
    marg = 24
    bb = np.pad(bb, marg)
    H = bb.shape[0]
    frazione = cfg.get('testo')
    cut = H if frazione is None else marg + int(round(frazione * (H - 2 * marg)))
    icona = bb.copy()
    icona[cut:] = False
    testo = bb.copy()
    testo[:cut] = False

    fine, marker = [], []
    larg_t = larghezza_locale(testo) if testo.any() else None
    if testo.any():
        for c, w in _catene(scheletro(testo), larg_t, 1.2):
            (fine if cfg.get('testo_fine') else marker).append(S.dirada(c, 0.9))

    if icona.any():
        r_blob = max(2, int(round(cfg.get('blob_src', 24) / 2 * s)))
        blob = apri(icona, r_blob)
        larga = blob.copy()
        for i in range(3):
            larga = _dilata(larga, i % 2 == 0)
        resto = icona & ~larga
        resto = apri(resto, 1)
        # le forme piene: solo contorno
        contorni = _contorni(blob)
        if cfg.get('esterno'):
            chiusa = blob.copy()
            for i in range(8):
                chiusa = _dilata(chiusa, i % 2 == 0)
            for i in range(8):
                chiusa = _erodi(chiusa, i % 2 == 0)
            chiusa = S.riempi_buchi(chiusa)
            fine += _contorni(chiusa)
            marker += contorni                      # quelli interni: gli elementi del simbolo
        else:
            (fine if cfg.get('fine_blob', True) else marker).extend(contorni)
        # le linee: a linea di mezzo, in fine o in marker secondo lo spessore
        larg = larghezza_locale(resto) if resto.any() else None
        soglia_marker = cfg.get('marker_src', 14.5) * s
        if resto.any():
            for c, w in _catene(scheletro(resto), larg, 1.2):
                spesso = w >= soglia_marker
                dest = marker if (spesso or cfg.get('sottile') == 'marker') else fine
                dest.append(S.dirada(c, 0.9))
    conv = lambda L: [[(x * mm_px - marg * mm_px, y * mm_px - marg * mm_px) for x, y in p] for p in L if len(p) > 1]
    return conv(fine), conv(marker), (m.width) * mm_px, (m.height) * mm_px
