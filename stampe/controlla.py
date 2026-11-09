#!/usr/bin/env python3
"""Controllo di un SVG prima di consegnarlo: ci sta sul foglio? quanti sollevamenti di penna?
i tratti si sovrappongono troppo?

Legge sia i nostri SVG (polyline) sia quelli salvati dallo SLICER (path con M/L, gruppo con
translate + scale(1 -1)). Un gruppo per colore = un livello = una penna.

  python3 -B controlla.py <file.svg> [W H margine]     (W H dal viewBox se omessi)
"""
import math
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

PX = 8                      # px per mm nel conto della sovrapposizione
SOGLIA_SOVRAPP = 1.8        # ink-lunghezza/area: oltre, i tratti si impastano
SEGMENTO_MIN = 0.15         # mm: sotto, e' rumore


def _num(s):
    return [float(x) for x in re.findall(r'-?\d+\.?\d*(?:e-?\d+)?', s)]


def _mat(t):
    """Trasformazione SVG semplice -> matrice (a,b,c,d,e,f); translate/scale/rotate."""
    M = (1, 0, 0, 1, 0, 0)
    for nome, args in re.findall(r'(\w+)\s*\(([^)]*)\)', t or ''):
        v = _num(args)
        if nome == 'translate':
            N = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif nome == 'scale':
            N = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif nome == 'rotate':
            a = math.radians(v[0]); c, s = math.cos(a), math.sin(a)
            N = (c, s, -s, c, 0, 0)
            if len(v) == 3:
                N = _comp((1, 0, 0, 1, v[1], v[2]), _comp(N, (1, 0, 0, 1, -v[1], -v[2])))
        else:
            continue
        M = _comp(M, N)
    return M


def _comp(A, B):
    return (A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
            A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
            A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5])


def _ap(M, x, y):
    return (M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5])


def _path(d):
    """Polilinee da un d="..." con M, L, H, V, Z assoluti. Restituisce (linee, comandi_ignorati)."""
    linee, cur, ign = [], [], 0
    x = y = 0.0
    for cmd, args in re.findall(r'([A-Za-z])([^A-Za-z]*)', d):
        v = _num(args)
        if cmd in 'ML':
            if cmd == 'M' and cur:
                linee.append(cur); cur = []
            for i in range(0, len(v) - 1, 2):
                x, y = v[i], v[i + 1]; cur.append((x, y))
        elif cmd == 'H':
            x = v[-1]; cur.append((x, y))
        elif cmd == 'V':
            y = v[-1]; cur.append((x, y))
        elif cmd in 'Zz':
            if cur:
                cur.append(cur[0])
        else:
            ign += 1
    if cur:
        linee.append(cur)
    return [l for l in linee if len(l) > 1], ign


def leggi(testo):
    """-> (W_mm, H_mm, k_utente_mm, {colore: {'sw': .., 'linee': [[(x,y) mm]]}}, avvisi)"""
    testo = re.sub(r'<\?xml[^>]*\?>', '', testo)
    radice = ET.fromstring(testo)
    ns = '{http://www.w3.org/2000/svg}'
    vb = _num(radice.get('viewBox', '0 0 100 100'))
    def mm(a, d):
        m = re.match(r'\s*([\d.]+)\s*(mm|cm|px)?', a or '')
        if not m: return d
        return float(m.group(1)) * {'mm': 1, 'cm': 10, 'px': 25.4 / 96, None: 1}[m.group(2)]
    W, H = mm(radice.get('width'), vb[2]), mm(radice.get('height'), vb[3])
    k = W / vb[2]
    livelli, avvisi = {}, []
    ignorati = [0]
    vero = {}            # nome livello -> spessore impostato nello SLICER (mm)
    mt = re.search(r'<metadata id="gdc-cnc2d-progetto">(.*?)</metadata>', testo, re.S)
    if mt:
        try:
            import html
            import json
            for lv in json.loads(html.unescape(mt.group(1))).get('livelli', []):
                if lv.get('spessore'):
                    vero[lv.get('nome')] = float(lv['spessore'])
        except Exception:
            avvisi.append('metadati dello SLICER non leggibili: uso lo spessore disegnato')

    def vai(el, M, col, sw, ov=None):
        tag = el.tag.replace(ns, '')
        if tag in ('metadata', 'title', 'defs'):
            return
        if tag == 'g':
            for f in el:
                if f.tag.replace(ns, '') == 'title' and (f.text or '') in vero:
                    ov = vero[f.text]
        M = _comp(M, _mat(el.get('transform')))
        st = el.get('stroke')
        if st and st != 'none': col = st
        if el.get('stroke-width'): sw = float(_num(el.get('stroke-width'))[0])
        linee = []
        if tag == 'polyline':
            v = _num(el.get('points', ''))
            linee = [[(v[i], v[i + 1]) for i in range(0, len(v) - 1, 2)]]
        elif tag == 'path':
            linee, ig = _path(el.get('d', '')); ignorati[0] += ig
        elif tag in ('rect', 'circle', 'ellipse', 'polygon', 'line', 'text'):
            ignorati[0] += 1
        if linee:
            L = livelli.setdefault((col or '#000000') + ('' if ov is None else '|%g' % ov),
                                   {'sw': ov if ov is not None else sw * k * math.sqrt(abs(M[0] * M[3] - M[1] * M[2])), 'linee': []})
            for p in linee:
                L['linee'].append([tuple(c * k for c in _ap(M, x, y)) for x, y in p])
        for f in el:
            vai(f, M, col, sw, ov)
    vai(radice, (1, 0, 0, 1, 0, 0), None, 1.0)
    if ignorati[0]:
        avvisi.append('%d elementi non-tratto (rect/curve/testo...) non analizzati' % ignorati[0])
    return W, H, k, livelli, avvisi


def lung(p):
    return sum(math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) for i in range(1, len(p)))


def analizza(testo, W=None, H=None, margine=5.0):
    w, h, k, livelli, avvisi = leggi(testo)
    W, H = W or w, H or h
    r = {'foglio': (W, H), 'margine': margine, 'livelli': [], 'avvisi': list(avvisi), 'problemi': []}
    xs, ys = [], []
    for col, L in livelli.items():
        n = len(L['linee'])
        tot = sum(lung(p) for p in L['linee'])
        brevi = sum(1 for p in L['linee'] if lung(p) < SEGMENTO_MIN)
        for p in L['linee']:
            for x, y in p: xs.append(x); ys.append(y)
        # sovrapposizione: area dei tratti sommata / area dell'unione
        img = Image.new('L', (int(W * PX) + 2, int(H * PX) + 2), 0)
        dr = ImageDraw.Draw(img)
        wpx = max(1, int(round(L['sw'] * PX)))
        for p in L['linee']:
            dr.line([(x * PX, y * PX) for x, y in p], fill=255, width=wpx, joint='curve')
        unione = sum(img.histogram()[1:]) / (PX * PX)
        somma = tot * L['sw']
        sov = somma / unione if unione else 0
        r['livelli'].append({'colore': col, 'sw': L['sw'], 'tratti': n, 'lunghezza_m': tot / 1000,
                             'brevi': brevi, 'sovrapposizione': sov})
        if sov > SOGLIA_SOVRAPP:
            r['problemi'].append('livello %s: tratti molto sovrapposti (%.1f×): a %.2f mm di penna le linee si '
                                 'impastano, meglio meno livelli o linee piu\' distanti' % (col, sov, L['sw']))
        if brevi > 0.15 * n and n > 20:
            r['problemi'].append('livello %s: %d tratti su %d sono piu\' corti di %.2f mm (rumore)' % (col, brevi, n, SEGMENTO_MIN))
    if xs:
        r['bbox'] = (min(xs), min(ys), max(xs), max(ys))
        x0, y0, x1, y1 = r['bbox']
        if x0 < -0.01 or y0 < -0.01 or x1 > W + 0.01 or y1 > H + 0.01:
            r['problemi'].append('il disegno esce dal foglio %g×%g mm (ingombro %.1f..%.1f × %.1f..%.1f)' % (W, H, x0, x1, y0, y1))
        elif x0 < margine or y0 < margine or x1 > W - margine or y1 > H - margine:
            r['avvisi'].append('il disegno entra nel margine di %g mm (ingombro %.1f..%.1f × %.1f..%.1f)' % (margine, x0, x1, y0, y1))
    else:
        r['problemi'].append('nessun tratto trovato')
    r['sollevamenti'] = sum(l['tratti'] for l in r['livelli']) - 1
    return r


def testo_report(r):
    out = ['Foglio %g × %g mm, margine %g mm' % (r['foglio'][0], r['foglio'][1], r['margine'])]
    if 'bbox' in r:
        b = r['bbox']
        out.append('Ingombro %.1f × %.1f mm' % (b[2] - b[0], b[3] - b[1]))
    for l in r['livelli']:
        out.append('  livello %s  spessore %.2f mm  %d tratti  %.2f m  sovrapposizione %.2f×' %
                   (l['colore'].split('|')[0], l['sw'], l['tratti'], l['lunghezza_m'], l['sovrapposizione']))
    out.append('Sollevamenti di penna: %d (+ i cambi penna fra livelli)' % max(r['sollevamenti'], 0))
    for a in r['avvisi']: out.append('avviso: ' + a)
    for p in r['problemi']: out.append('PROBLEMA: ' + p)
    out.append('ESITO: ' + ('da guardare' if r['problemi'] else 'ok'))
    return '\n'.join(out)


if __name__ == '__main__':
    t = open(sys.argv[1], encoding='utf-8').read()
    W = float(sys.argv[2]) if len(sys.argv) > 3 else None
    H = float(sys.argv[3]) if len(sys.argv) > 3 else None
    m = float(sys.argv[4]) if len(sys.argv) > 4 else 5.0
    print(testo_report(analizza(t, W, H, m)))
