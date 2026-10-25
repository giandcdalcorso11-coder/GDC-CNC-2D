#!/usr/bin/env python3
"""Dai due modelli 3D dei pupazzetti alle linee da disegnare.

Non e' una silhouette e basta: una sagoma piena, per una penna, e' un
contorno vuoto che non dice niente di come e' fatto il soggetto. Qui si
proietta il modello di fronte tenendo per ogni cella la profondita' minima —
cioe' la superficie rivolta a chi guarda — e poi si tracciano le ISOIPSE di
quella mappa, le linee di uguale profondita', come le curve di livello di una
carta topografica. Il rilievo viene raccontato con le linee invece che con
l'ombra, che e' l'unica cosa che un plotter sa fare.

Perche' la sagoma esce piena senza buchi: il modello e' una superficie
chiusa, quindi ogni raggio che entra deve uscire, e ogni punto interno alla
sagoma e' coperto da almeno un triangolo.

Ingresso: la cartella 3D/Objects di un .3mf gia' scompattato (il file e'
troppo grosso per stare nel repo).
Uscita: un JSON con, per ogni figura, le polilinee in unita' normalizzate
(x e y fra 0 e 1 sul lato lungo) piu' il rapporto fra i lati.

  python3 webui/tools/figli-sagome.py <cartella-objects> <uscita.json>
"""
import json
import re
import sys

import numpy as np

NUM = re.compile(r'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?')
TRI = re.compile(r'v1="(\d+)" v2="(\d+)" v3="(\d+)"')

ALTEZZA_PX = 700      # risoluzione della mappa: 0,2 mm per cella a 140 mm
LIVELLI = 14          # quante isoipse
TOLLERANZA = 0.0006   # diradamento, in unita' normalizzate (~0,08 mm su 130)
MINIMO = 0.015        # polilinee piu' corte di cosi' sono rumore, si buttano


# --------------------------------------------------------------- lettura

def mesh(percorso, oid):
    testo = open(percorso, encoding='utf-8').read()
    m = re.search(r'<object id="%s"[^>]*>(.*?)</object>' % oid, testo, re.S)
    corpo = m.group(1)
    vb = corpo[corpo.index('<vertices>'):corpo.index('</vertices>')]
    tb = corpo[corpo.index('<triangles>'):corpo.index('</triangles>')]
    V = np.array(NUM.findall(vb), dtype=np.float64).reshape(-1, 3)
    T = np.array(TRI.findall(tb), dtype=np.int64)
    return V, T


def profondita(V, T, altezza_px=ALTEZZA_PX, margine=2):
    """Vista di fronte: u = x, v = z, profondita' = y, minima per cella."""
    u, v, d = V[:, 0], V[:, 2], V[:, 1]
    u0, u1, v0, v1 = u.min(), u.max(), v.min(), v.max()
    scala = (altezza_px - 2 * margine) / (v1 - v0)
    W = int(round((u1 - u0) * scala)) + 2 * margine
    H = altezza_px

    """Sette punti per triangolo — vertici, meta' dei lati, baricentro —
       invece dei soli vertici: a questa risoluzione un triangolo e' largo
       due o tre celle, e con i soli vertici la sagoma verrebbe bucata."""
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    def sette(q):
        return np.concatenate([q[a], q[b], q[c],
                               (q[a] + q[b]) / 2, (q[b] + q[c]) / 2, (q[c] + q[a]) / 2,
                               (q[a] + q[b] + q[c]) / 3])
    U, Vv, D = sette(u), sette(v), sette(d)

    ix = np.clip(((U - u0) * scala + margine).astype(np.int64), 0, W - 1)
    # la riga cresce verso il basso, Z verso l'alto: qui si ribalta
    iy = np.clip((H - 1 - ((Vv - v0) * scala + margine)).astype(np.int64), 0, H - 1)

    prof = np.full(H * W, np.inf)
    np.minimum.at(prof, iy * W + ix, D)
    return prof.reshape(H, W)


# --------------------------------------------------------------- pulizia

def mediana3(A):
    """Toglie i puntini isolati: celle in cui davanti non e' caduto nessun
       campione e che hanno preso la profondita' della superficie di dietro."""
    H, W = A.shape
    P = np.pad(A, 1, mode='edge')
    pila = np.stack([P[i:i + H, j:j + W] for i in range(3) for j in range(3)])
    with np.errstate(all='ignore'):
        return np.nanmedian(pila, axis=0)


def riempi_buchi(mask):
    """Un buco dentro la sagoma e' un difetto di campionamento, non un foro:
       si allaga da fuori e si prende il complemento."""
    fuori = np.zeros(mask.shape, dtype=bool)
    fuori[0, :] = ~mask[0, :]
    fuori[-1, :] = ~mask[-1, :]
    fuori[:, 0] = ~mask[:, 0]
    fuori[:, -1] = ~mask[:, -1]
    libero = ~mask
    while True:
        n = fuori.copy()
        n[1:, :] |= fuori[:-1, :]
        n[:-1, :] |= fuori[1:, :]
        n[:, 1:] |= fuori[:, :-1]
        n[:, :-1] |= fuori[:, 1:]
        n &= libero
        if n.sum() == fuori.sum():
            return ~fuori
        fuori = n


# ------------------------------------------------------- marching squares

"""Sedici casi: quali dei quattro angoli stanno sopra il livello dice fra
   quali lati passa la linea. Il punto sul lato si interpola, altrimenti il
   contorno verrebbe a scalini grandi come una cella."""
CASI = {
    1: [(3, 0)], 2: [(0, 1)], 3: [(3, 1)], 4: [(1, 2)],
    5: [(3, 0), (1, 2)], 6: [(0, 2)], 7: [(3, 2)], 8: [(2, 3)],
    9: [(2, 0)], 10: [(0, 1), (2, 3)], 11: [(2, 1)], 12: [(1, 3)],
    13: [(1, 0)], 14: [(0, 3)],
}


def _interp(x, y, v1, v2, liv, dx, dy):
    den = np.where(v2 != v1, v2 - v1, 1.0)
    t = np.clip(np.where(v2 != v1, (liv - v1) / den, 0.5), 0, 1)
    return x + t * dx, y + t * dy


def contorni(F, livello, salta_nan=True):
    a, b = F[:-1, :-1], F[:-1, 1:]
    c, d = F[1:, 1:], F[1:, :-1]
    buono = np.ones(a.shape, dtype=bool)
    if salta_nan:
        buono = ~(np.isnan(a) | np.isnan(b) | np.isnan(c) | np.isnan(d))

    idx = ((a >= livello).astype(np.uint8)
           | ((b >= livello).astype(np.uint8) << 1)
           | ((c >= livello).astype(np.uint8) << 2)
           | ((d >= livello).astype(np.uint8) << 3))

    pezzi = []
    for caso, lati in CASI.items():
        sel = buono & (idx == caso)
        if not sel.any():
            continue
        ii, jj = np.nonzero(sel)
        va, vb, vc, vd = a[ii, jj], b[ii, jj], c[ii, jj], d[ii, jj]

        def punto(l):
            if l == 0:
                return _interp(jj, ii, va, vb, livello, 1, 0)
            if l == 1:
                return _interp(jj + 1, ii, vb, vc, livello, 0, 1)
            if l == 2:
                return _interp(jj, ii + 1, vd, vc, livello, 1, 0)
            return _interp(jj, ii, va, vd, livello, 0, 1)

        for l1, l2 in lati:
            x1, y1 = punto(l1)
            x2, y2 = punto(l2)
            pezzi.append(np.stack([x1, y1, x2, y2], axis=1))

    if not pezzi:
        return []
    return cuci(np.concatenate(pezzi))


def cuci(seg, tol=1e-6):
    """Da segmenti sparsi a polilinee, attaccandoli per gli estremi: senza
       questo il G-code alzerebbe la penna a ogni cella della griglia."""
    def chiave(x, y):
        return (int(round(float(x) / tol)), int(round(float(y) / tol)))

    usato = [False] * len(seg)
    mappa = {}
    for i, s in enumerate(seg):
        mappa.setdefault(chiave(s[0], s[1]), []).append(i)
        mappa.setdefault(chiave(s[2], s[3]), []).append(i)

    def altro(i, k):
        s = seg[i]
        return (s[2], s[3]) if chiave(s[0], s[1]) == k else (s[0], s[1])

    out = []
    for i0 in range(len(seg)):
        if usato[i0]:
            continue
        usato[i0] = True
        s = seg[i0]
        poly = [(s[0], s[1]), (s[2], s[3])]
        for verso in (0, 1):
            if verso:
                poly.reverse()
            while True:
                k = chiave(poly[-1][0], poly[-1][1])
                nxt = next((j for j in mappa.get(k, []) if not usato[j]), None)
                if nxt is None:
                    break
                usato[nxt] = True
                poly.append(altro(nxt, k))
        out.append(poly)
    return out


# ----------------------------------------------------------- diradamento

def dirada(poly, tol):
    """Douglas-Peucker iterativo: tiene i punti che cambiano la forma e butta
       quelli che stanno gia' sulla retta fra i vicini."""
    n = len(poly)
    if n < 3:
        return poly
    tieni = [False] * n
    tieni[0] = tieni[-1] = True
    pile = [(0, n - 1)]
    while pile:
        i, j = pile.pop()
        if j <= i + 1:
            continue
        x1, y1 = poly[i]
        x2, y2 = poly[j]
        dx, dy = x2 - x1, y2 - y1
        L = (dx * dx + dy * dy) ** 0.5
        peggio, dove = 0.0, -1
        for k in range(i + 1, j):
            x, y = poly[k]
            if L < 1e-12:
                dist = ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
            else:
                dist = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L
            if dist > peggio:
                peggio, dove = dist, k
        if peggio > tol:
            tieni[dove] = True
            pile.append((i, dove))
            pile.append((dove, j))
    return [p for p, t in zip(poly, tieni) if t]


def lunghezza(poly):
    return sum(((poly[i][0] - poly[i - 1][0]) ** 2 +
                (poly[i][1] - poly[i - 1][1]) ** 2) ** 0.5
               for i in range(1, len(poly)))


# ------------------------------------------------------------------ main

def figura(percorso, oid):
    V, T = mesh(percorso, oid)
    P = profondita(V, T)
    P[~np.isfinite(P)] = np.nan
    P = mediana3(mediana3(P))
    mask = riempi_buchi(np.isfinite(P))
    P[~mask] = np.nan

    H, W = P.shape
    righe, colonne = np.nonzero(mask)
    r0, r1 = righe.min(), righe.max()
    c0, c1 = colonne.min(), colonne.max()
    k = 1.0 / (r1 - r0)          # il lato lungo diventa 1

    polilinee = []

    # la sagoma per prima: e' il contorno, e va disegnata comunque
    for p in contorni(mask.astype(float), 0.5, salta_nan=False):
        polilinee.append((p, True))

    lo, hi = np.nanpercentile(P, 2), np.nanpercentile(P, 96)
    for liv in np.linspace(lo, hi, LIVELLI + 2)[1:-1]:
        for p in contorni(P, liv):
            polilinee.append((p, False))

    out = []
    for p, sagoma in polilinee:
        q = [((x - c0) * k, (y - r0) * k) for x, y in p]
        q = dirada(q, TOLLERANZA)
        if len(q) < 2:
            continue
        if not sagoma and lunghezza(q) < MINIMO:
            continue
        if sagoma and lunghezza(q) < MINIMO * 3:
            continue
        out.append([[round(x, 5), round(y, 5)] for x, y in q])

    return {'rapporto': (c1 - c0) * k, 'tracciati': out}


if __name__ == '__main__':
    cartella = sys.argv[1].rstrip('/')
    uscita = sys.argv[2]
    dati = {}
    for chiave, (f, oid) in {'uno': ('object_4.model', 1),
                             'due': ('object_7.model', 4)}.items():
        dati[chiave] = figura(cartella + '/' + f, oid)
        n = dati[chiave]['tracciati']
        print('%s: %d tracciati, %d punti, rapporto %.3f'
              % (chiave, len(n), sum(len(p) for p in n), dati[chiave]['rapporto']))
    json.dump(dati, open(uscita, 'w'))
    print('scritto', uscita)
