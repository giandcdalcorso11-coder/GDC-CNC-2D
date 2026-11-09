#!/usr/bin/env python3
"""Stile «Rilievo»: un modello 3D diventa un SVG a due penne.

Sagoma in nero, linee di livello a quota costante in grigio (vedi README.md).
Niente testi e niente logo: si aggiungono dopo, nello SLICER.

  python3 -B rilievo.py <object.model> <id> <rz> <rx> <passo> <uscita.svg> [W H] [risoluzione] [quota|profondita] [levigatura]

  rz, rx    da dove si guarda, in gradi (rz = giro attorno alla verticale,
            rx = inclinazione dall'alto); 0 0 e' di fronte
  passo     distanza fra due linee di livello, nelle unita' del modello; oppure L<n>
            (es. L19) = n livelli, indipendente dall'unita' del file
            (con ~28 linee sull'altezza si legge bene)
  modo      quota (default): fette orizzontali, per oggetti visti dall'alto;
            profondita: distanza dall'osservatore, per figure viste di fronte
  W H       il foglio in mm, 210 148 se omesso (A5 orizzontale)
"""
import importlib.util
import os
import sys

import numpy as np

QUI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'viste', os.path.join(QUI, 'portaoggetti-feffi', 'viste.py'))
viste = importlib.util.module_from_spec(spec)
spec.loader.exec_module(viste)

NERO, GRIGIO = '#111', '#8a8a8a'


def svg(d, W, H, margine=None):
    if margine is None:
        margine = float(os.environ.get('RILIEVO_MARGINE', 8))
    alt = H - 2 * margine
    larg = alt * d['rapporto']
    if larg > W - 2 * margine:          # piu' largo che alto: si adatta alla larghezza
        larg = W - 2 * margine
        alt = larg / d['rapporto']
    x0, y0 = (W - larg) / 2, (H - alt) / 2

    def gruppo(colore, sw, linee):
        righe = ['<polyline points="%s"/>' % ' '.join(
            '%.2f,%.2f' % (x0 + x * alt, y0 + y * alt) for x, y in p) for p in linee]
        return ('<g fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
                'stroke-linejoin="round">\n%s\n</g>' % (colore, sw, '\n'.join(righe)))

    return '\n'.join([
        '<svg xmlns="http://www.w3.org/2000/svg" width="%gmm" height="%gmm" viewBox="0 0 %g %g">'
        % (W, H, W, H),
        gruppo(GRIGIO, 0.3, d['isoipse']),
        gruppo(NERO, 0.35, d['sagoma'] + d.get('dettagli', [])),
        '</svg>', ''])


if __name__ == '__main__':
    S = viste.S
    modello, oid = sys.argv[1], sys.argv[2]
    rz, rx, passo_arg = float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
    uscita = sys.argv[6]
    W = float(sys.argv[7]) if len(sys.argv) > 8 else 210.0
    H = float(sys.argv[8]) if len(sys.argv) > 8 else 148.0
    px = int(sys.argv[9]) if len(sys.argv) > 9 else 1000
    V, T = S.mesh(modello, oid)
    V = V - V.mean(axis=0)
    modo = sys.argv[10] if len(sys.argv) > 10 else 'quota'
    if passo_arg.upper().startswith('L'):
        # L<n>: n livelli sull'intervallo che guida le curve (quota: altezza Z del modello;
        # profondita: distanza dall'osservatore), cosi' il passo non dipende dall'unita' del file
        Vr = viste.ruota(V, rz, rx)
        passo = float(np.ptp(Vr[:, 1] if modo == 'profondita' else V[:, 2])) / float(passo_arg[1:])
        print('passo %.3f (%s livelli)' % (passo, passo_arg[1:]))
    else:
        passo = float(passo_arg)
    sigma = int(sys.argv[11]) if len(sys.argv) > 11 else 4
    d = viste.vista_quota(V, T, rz, rx, alt_px=px, passo_mm=passo, sigma=sigma, modo=modo)
    n = sum(len(p) for p in d['isoipse'])
    print('rapporto %.3f, %d linee di livello, %d punti' % (d['rapporto'], len(d['isoipse']), n))
    open(uscita, 'w').write(svg(d, W, H))
