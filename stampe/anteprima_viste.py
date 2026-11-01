#!/usr/bin/env python3
"""Foglio di anteprime ombreggiate di un modello da piu' viste, per scegliere
da dove guardarlo prima di tirare le linee di livello.

  python3 -B anteprima_viste.py <object.model> <id> <uscita.png> rz:rx rz:rx ...
"""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image

QUI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'viste', os.path.join(QUI, 'portaoggetti-feffi', 'viste.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
S = v.S

V, T = S.mesh(sys.argv[1], sys.argv[2])
V = V - V.mean(axis=0)
print('vertici', len(V), 'triangoli', len(T), 'ingombro',
      np.round(V.max(axis=0) - V.min(axis=0), 1))
viste = [tuple(float(x) for x in a.split(':')) for a in sys.argv[4:]]
LATO = 420
tiles = []
for rz, rx in viste:
    Vr = v.ruota(V, rz, rx)
    P, m = v.mappa(Vr, T, LATO)
    sh = np.nan_to_num(v.ombra(P, m, 0.3), nan=1)
    img = np.where(m, sh * 255, 255).astype(np.uint8)
    rr, cc = np.nonzero(m)
    img = img[rr.min():rr.max() + 1, cc.min():cc.max() + 1]
    h = min(LATO, int(img.shape[0] * LATO / max(img.shape)))
    w = min(LATO, int(img.shape[1] * LATO / max(img.shape)))
    can = Image.new('L', (LATO, LATO), 255)
    can.paste(Image.fromarray(img).resize((w, h)), ((LATO - w) // 2, (LATO - h) // 2))
    tiles.append(can)
n = len(tiles)
cols = min(n, 3)
rows = (n + cols - 1) // cols
sheet = Image.new('L', (cols * LATO, rows * LATO), 255)
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * LATO, (i // cols) * LATO))
sheet.save(sys.argv[3])
print(viste)
