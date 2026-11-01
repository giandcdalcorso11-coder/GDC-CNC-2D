#!/usr/bin/env python3
"""Un modello 3D diventa uno screenshot ombreggiato (come quello dello slicer),
da dare in pasto a da_immagine.py: cosi' due oggetti, uno con il modello e uno
con il solo screenshot, passano dalla stessa pipeline e escono nello stesso stile.

  python3 -B render_ombra.py <object.model> <id> <rz> <rx> <uscita.png> [altezza_px]
"""
import sys

import numpy as np
from PIL import Image

import rilievo
v = rilievo.viste
S = v.S

if __name__ == '__main__':
    Vv, T = S.mesh(sys.argv[1], sys.argv[2])
    Vv = Vv - Vv.mean(axis=0)
    alt = int(sys.argv[6]) if len(sys.argv) > 6 else 1000
    Vr = v.ruota(Vv, float(sys.argv[3]), float(sys.argv[4]))
    P, m = v.mappa(Vr, T, alt)
    for _ in range(4):
        P = S.mediana3(P)
    P = np.where(m, v.liscia(np.where(m, P, np.nan), 1), np.nan)
    # ombra calcolata a risoluzione ridotta (il pelo e il rumore di mesh non contano)
    mm_px = (Vr[:, 2].max() - Vr[:, 2].min()) / (alt - 4)
    # base bassa: sui piani di fronte il grigio non deve saturare a bianco, o le
    # linee di livello non hanno dove passare (lo screenshot dello slicer ha
    # una gamma piu' ampia della nostra ombra di prova)
    sh = np.nan_to_num(v.ombra(P, m, mm_px, base=0.22, guadagno=0.62), nan=1.0)
    sh = v.liscia(np.where(m, sh, np.nan), 1)
    sh = np.nan_to_num(sh, nan=1.0)
    grigio = np.clip(75 + 175 * sh, 0, 255)
    img = np.where(m, grigio, 231).astype(np.uint8)
    rr, cc = np.nonzero(m)
    pad = 12
    img = np.pad(img[max(rr.min() - pad, 0):rr.max() + pad, max(cc.min() - pad, 0):cc.max() + pad],
                 0, mode='edge')
    Image.fromarray(img).convert('RGB').save(sys.argv[5])
    print(img.shape)
