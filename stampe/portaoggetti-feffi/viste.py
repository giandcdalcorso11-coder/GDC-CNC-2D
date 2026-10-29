#!/usr/bin/env python3
"""Dal modello 3D del portaoggetti (Kira) alle linee da tracciare con due penne.

Riusa la proiezione a mappa di profondita' di webui/tools/figli-sagome.py e ne
ricava, per tre viste, tre famiglie di linee:
  sagoma   -> contorno (penna nera)
  isoipse  -> linee di uguale profondita' (penna grigia)
  tratti   -> tratteggio a 45 gradi dove la superficie e' in ombra (grigia),
              incrociato dove e' molto in ombra (nera)

  python3 viste.py <cartella-objects> <uscita.json>
"""
import importlib.util
import json
import os
import sys

import numpy as np

QUI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'sagome', os.path.join(QUI, '..', '..', 'webui', 'tools', 'figli-sagome.py'))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)


def ruota(V, rz, rx):
    """Gira attorno a Z poi attorno a X (gradi): sceglie da dove si guarda."""
    a, b = np.radians(rz), np.radians(rx)
    Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    return V @ Rz.T @ Rx.T


def mappa(V, T, alt_px):
    """Vista lungo -Y del sistema ruotato: u = x, v = z, profondita' = y."""
    P = S.profondita(V, T, alt_px)
    P[~np.isfinite(P)] = np.nan
    P = S.mediana3(S.mediana3(P))
    mask = S.riempi_buchi(np.isfinite(P))
    P[~mask] = np.nan
    return P, mask


def liscia(A, n=2):
    """Media mobile ignorando i NaN: l'ombra dalla profondita' grezza e' rumore."""
    for _ in range(n):
        H, W = A.shape
        Pd = np.pad(A, 1, mode='edge')
        pila = np.stack([Pd[i:i + H, j:j + W] for i in range(3) for j in range(3)])
        with np.errstate(all='ignore'):
            A = np.nanmean(pila, axis=0)
    return A


def ombra(P, mask, scala_mm):
    """Lambert dalla mappa di profondita': 1 chiaro, 0 scuro. Luce da alto-sinistra."""
    Q = liscia(np.where(mask, P, np.nan), 3)
    Q = np.where(mask, np.nan_to_num(Q, nan=np.nanmedian(Q)), np.nanmedian(Q))
    gy, gx = np.gradient(Q)
    gx, gy = gx / scala_mm, gy / scala_mm
    n = np.stack([gx, gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=0)
    L = np.array([-0.5, -0.6, -0.62])
    L = L / np.linalg.norm(L)
    # la camera guarda verso +Y (profondita' = y): la normale verso la camera e' -Y
    nn = np.stack([n[0], n[2] * 0 - n[2], n[1]])  # placeholder non usato
    lam = -(n[0] * L[0] + n[1] * L[1] + n[2] * L[2])
    return np.clip(0.5 + 0.9 * lam, 0, 1)


def tratteggio(sh, mask, passo_px, soglia, angolo=45):
    """Segmenti paralleli, tenuti solo dove sh < soglia dentro la sagoma."""
    H, W = sh.shape
    out = []
    t = np.radians(angolo)
    d = np.array([np.cos(t), -np.sin(t)])      # direzione della linea
    nrm = np.array([np.sin(t), np.cos(t)])     # normale
    diag = int(np.hypot(H, W))
    c = np.array([W / 2, H / 2])
    ok = mask & (sh < soglia)
    # via le macchioline: due passate di maggioranza 3x3 sulla maschera di tono
    for _ in range(3):
        ok = liscia(np.where(mask, ok.astype(float), np.nan), 1) > 0.5
        ok = np.nan_to_num(ok, nan=0).astype(bool) & mask
    for k in range(-diag // 2, diag // 2, 1):
        if k % passo_px:
            continue
        s = np.arange(-diag // 2, diag // 2, 0.7)
        x = c[0] + nrm[0] * k + d[0] * s
        y = c[1] + nrm[1] * k + d[1] * s
        dentro = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
        x, y = x[dentro], y[dentro]
        if len(x) < 2:
            continue
        v = ok[y.astype(int), x.astype(int)]
        # runs di True
        i = 0
        n = len(v)
        while i < n:
            if v[i]:
                j = i
                while j + 1 < n and v[j + 1]:
                    j += 1
                if j - i >= 12:
                    out.append([(x[i], y[i]), (x[j], y[j])])
                i = j + 1
            else:
                i += 1
    return out


def vista(V, T, rz, rx, alt_px=900, livelli=14, tratti=True):
    Vr = ruota(V, rz, rx)
    P, mask = mappa(Vr, T, alt_px)
    # il pelo e' rumore per una penna da 0,4 mm: si leviga la profondita'
    # prima di tirarne fuori linee, e si buttano i puntini isolati
    for _ in range(3):
        P = S.mediana3(P)
    P = np.where(mask, liscia(np.where(mask, P, np.nan), 2), np.nan)
    righe, colonne = np.nonzero(mask)
    r0, r1, c0, c1 = righe.min(), righe.max(), colonne.min(), colonne.max()
    k = 1.0 / (r1 - r0)
    mm_per_px = (Vr[:, 2].max() - Vr[:, 2].min()) / (alt_px - 4)

    def norm(p, tol=0.0006):
        q = [((x - c0) * k, (y - r0) * k) for x, y in p]
        return S.dirada(q, tol)

    sagoma = []
    for p in S.contorni(mask.astype(float), 0.5, salta_nan=False):
        q = norm(p)
        if len(q) > 1 and S.lunghezza(q) > 0.05:
            sagoma.append(q)

    iso = []
    lo, hi = np.nanpercentile(P, 2), np.nanpercentile(P, 96)
    for liv in np.linspace(lo, hi, livelli + 2)[1:-1]:
        for p in S.contorni(P, liv):
            q = norm(p)
            if len(q) > 1 and S.lunghezza(q) > 0.07:
                iso.append(q)

    out = {'rapporto': (c1 - c0) * k, 'sagoma': sagoma, 'isoipse': iso}
    if tratti:
        # l'ombra si calcola a bassa risoluzione: a quella piena il pelo
        # (geometria vera, ma sotto il tratto della penna) la riempie di rumore
        from PIL import Image
        Pl, ml = mappa(Vr, T, 380)
        for _ in range(2):
            Pl = S.mediana3(Pl)
        shl = ombra(Pl, ml, (Vr[:, 2].max() - Vr[:, 2].min()) / 376)
        shl = liscia(np.where(ml, shl, np.nan), 3)
        shl = np.nan_to_num(shl, nan=1.0)
        sh = np.asarray(Image.fromarray(shl.astype(np.float32)).resize(
            (P.shape[1], P.shape[0]), Image.BILINEAR))
        lunga = 1.0 / k  # px per lato lungo
        passo = max(2, int(round(lunga / 170)))  # ~170 linee sul lato lungo
        out['chiaro'] = [norm(p, 0.0004) for p in tratteggio(sh, mask, passo, SOGLIA_CHIARO)]
        out['scuro'] = [norm(p, 0.0004) for p in tratteggio(sh, mask, passo, SOGLIA_SCURO, 135)]
    return out


SOGLIA_CHIARO = 0.80
SOGLIA_SCURO = 0.52


def profondita_quota(V, Vr, T, altezza_px, margine=2):
    """Come S.profondita, ma oltre alla profondita' tiene la QUOTA vera (Z del
    modello, non ruotato) del punto piu' vicino: le linee di livello a quota
    costante sono le curve di una carta topografica, e a occhio ordinano il
    rilievo molto meglio delle linee a profondita' costante, che in una vista
    obliqua sono solo onde."""
    u, v, d = Vr[:, 0], Vr[:, 2], Vr[:, 1]
    u0, u1, v0, v1 = u.min(), u.max(), v.min(), v.max()
    scala = (altezza_px - 2 * margine) / (v1 - v0)
    W = int(round((u1 - u0) * scala)) + 2 * margine
    H = altezza_px
    a, b, c = T[:, 0], T[:, 1], T[:, 2]

    def sette(q):
        return np.concatenate([q[a], q[b], q[c], (q[a] + q[b]) / 2,
                               (q[b] + q[c]) / 2, (q[c] + q[a]) / 2,
                               (q[a] + q[b] + q[c]) / 3])
    U, Vv, D, Z = sette(u), sette(v), sette(d), sette(V[:, 2])
    ix = np.clip(((U - u0) * scala + margine).astype(np.int64), 0, W - 1)
    iy = np.clip((H - 1 - ((Vv - v0) * scala + margine)).astype(np.int64), 0, H - 1)
    cella = iy * W + ix
    ordine = np.argsort(-D, kind='stable')          # dal piu' lontano al piu' vicino
    prof = np.full(H * W, np.inf)
    quota = np.full(H * W, np.nan)
    prof[cella[ordine]] = D[ordine]                  # l'ultimo che scrive e' il piu' vicino
    quota[cella[ordine]] = Z[ordine]
    return prof.reshape(H, W), quota.reshape(H, W)


def vista_quota(V, T, rz, rx, alt_px=620, passo_mm=3.0, sigma=4):
    Vr = ruota(V, rz, rx)
    P, Zq = profondita_quota(V, Vr, T, alt_px)
    P[~np.isfinite(P)] = np.nan
    P = S.mediana3(S.mediana3(P))
    mask = S.riempi_buchi(np.isfinite(P))
    Zq = np.where(np.isfinite(P), Zq, np.nan)
    for _ in range(3):
        Zq = S.mediana3(Zq)
    Zq = np.where(mask, Zq, np.nan)
    Zs = liscia(Zq, sigma)
    Zs = np.where(mask, Zs, np.nan)
    righe, colonne = np.nonzero(mask)
    r0, r1, c0, c1 = righe.min(), righe.max(), colonne.min(), colonne.max()
    k = 1.0 / (r1 - r0)

    def norm(p, tol=0.0008):
        return S.dirada([((x - c0) * k, (y - r0) * k) for x, y in p], tol)

    sagoma = [q for q in (norm(p) for p in S.contorni(mask.astype(float), 0.5, salta_nan=False))
              if len(q) > 1 and S.lunghezza(q) > 0.05]
    iso = []
    z0, z1 = np.nanmin(Zs), np.nanmax(Zs)
    for liv in np.arange(np.ceil(z0 / passo_mm) * passo_mm, z1, passo_mm):
        for p in S.contorni(Zs, liv):
            q = norm(p)
            if len(q) > 2 and S.lunghezza(q) > 0.10:
                iso.append(q)
    return {'rapporto': (c1 - c0) * k, 'sagoma': sagoma, 'isoipse': iso}


def arrotonda(d):
    for k, v in d.items():
        if isinstance(v, list):
            d[k] = [[[round(x, 5), round(y, 5)] for x, y in p] for p in v]
    return d


if __name__ == '__main__':
    V, T = S.mesh(sys.argv[1].rstrip('/') + '/object_4.model', 1)
    V = V - V.mean(axis=0)
    # nel modello: X lungo, Y larghezza, Z altezza (ciotola aperta verso +Z)
    solo = os.environ.get('SOLO')
    richieste = {
        'alto': lambda: vista(V, T, 0, 90, tratti=False),
        'tre_quarti': lambda: vista(V, T, -30, 45, alt_px=1400, tratti=True),
        'fianco': lambda: vista(V, T, 0, 0, tratti=False),
        'quota': lambda: vista_quota(V, T, -50, 38, alt_px=640, passo_mm=3.0, sigma=5),
    }
    viste = {n: f() for n, f in richieste.items() if not solo or n in solo.split(',')}
    for n, v in viste.items():
        print(n, 'rapporto %.3f' % v['rapporto'],
              {k: len(x) for k, x in v.items() if isinstance(x, list)})
        arrotonda(v)
    json.dump(viste, open(sys.argv[2], 'w'))
