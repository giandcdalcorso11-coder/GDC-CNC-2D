#!/usr/bin/env python3
"""Esegue una SCHEDA LAVORO: dagli ingressi (modello 3D, foto, screenshot, icona) a un SVG
per la macchina, con i controlli. E' il punto d'ingresso unico: sceglie il motore giusto fra
quelli gia' presenti in stampe/ (rilievo.py, da_immagine.py, foto_onde.py, foto_poligoni.py,
foto_tratti.py, linea.py) e li chiama con i parametri del livello di dettaglio.

  python3 -B lavoro.py scheda.json        esegue la scheda
  python3 -B lavoro.py --esempio          stampa una scheda di esempio
  python3 -B lavoro.py --stili            elenca stili, ingressi e dettagli ammessi

La scheda e' descritta in stampe/README.md. Esce in <uscita>/: <nome>.svg, scheda.json (la
ricetta, per rifare «come quello») e report.txt (il controllo).
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

from PIL import Image

import controlla

QUI = os.path.dirname(os.path.abspath(__file__))
PENNE = {k: v for k, v in json.load(open(os.path.join(QUI, 'penne.json'))).items() if not k.startswith('_')}

# 'illustrazione' e' il nome d'uso; 'icona' resta come sinonimo (schede vecchie)
COMPATIBILE = {
    'rilievo': ('modello3d', 'screenshot'),
    'layer': ('modello3d',),
    'fedele': ('illustrazione',),
    'onde': ('foto', 'screenshot'),
    'poligoni': ('foto', 'screenshot'),
    'tratti': ('foto', 'screenshot'),
    'linea': ('illustrazione',),
}
DETTAGLI = ('essenziale', 'medio', 'dettagliato')

# livelli di dettaglio -> parametri dei motori
RILIEVO_3D = {'essenziale': dict(livelli=12, px=640, sigma=5), 'medio': dict(livelli=20, px=900, sigma=4)}
LAYER = {'essenziale': dict(livelli=12, px=640, sigma=5), 'medio': dict(livelli=20, px=900, sigma=4),
         'dettagliato': dict(livelli=28, px=1000, sigma=3)}
RILIEVO_SHOT = {'essenziale': ('6', '5', ['essenziale']), 'medio': ('4', '2.2', []), 'dettagliato': ('5', '2.2', [])}
ONDE = {'essenziale': (2.8, 4.2), 'medio': (2.2, 3.4), 'dettagliato': (1.7, 2.6)}      # passo, onda (mm)
POLIGONI = {'essenziale': (9, True), 'medio': (7, True), 'dettagliato': (7, False)}    # lato (mm), senza-toni

ESEMPIO = {
    'nome': 'esempio-biglietto',
    'ingresso': {'tipo': 'modello3d', 'file': 'percorso/del/modello.3mf', 'vista': {'rz': 20, 'rx': 10}},
    'stile': 'rilievo',
    'dettaglio': 'dettagliato',
    'foglio': {'w': 210, 'h': 148, 'margine': 8},
    'testi': [{'s': 'NOME', 'base': 124, 'alt': 9, 'penna': 'nero'},
              {'s': 'DEDICA', 'base': 135, 'alt': 4.2, 'penna': 'grigio'}],
    'opzioni': {},
}


class Errore(Exception):
    pass


# ---------------------------------------------------------------- scheda

def normalizza(s):
    errori = []
    s = json.loads(json.dumps(s))
    s.setdefault('nome', 'lavoro')
    s.setdefault('ingresso', {})
    s.setdefault('foglio', {})
    s['foglio'].setdefault('w', 210)
    s['foglio'].setdefault('h', 148)
    s['foglio'].setdefault('margine', 8)
    s.setdefault('dettaglio', 'medio')
    s.setdefault('testi', [])
    s.setdefault('opzioni', {})
    ing = s['ingresso']
    if ing.get('tipo') == 'icona':
        ing['tipo'] = 'illustrazione'
    if s.get('stile') not in COMPATIBILE:
        errori.append("stile '%s' sconosciuto: scegli fra %s" % (s.get('stile'), ', '.join(COMPATIBILE)))
    elif ing.get('tipo') not in COMPATIBILE[s['stile']]:
        errori.append("lo stile '%s' lavora su: %s (non su '%s')" % (s['stile'], ', '.join(COMPATIBILE[s['stile']]), ing.get('tipo')))
    if s['dettaglio'] not in DETTAGLI:
        errori.append("dettaglio '%s' sconosciuto: %s" % (s['dettaglio'], ', '.join(DETTAGLI)))
    if not ing.get('file') or not os.path.exists(os.path.expanduser(ing['file'])):
        errori.append("file di ingresso non trovato: %s" % ing.get('file'))
    for t in s['testi']:
        if t.get('penna', 'nero') not in PENNE:
            errori.append("penna '%s' non in penne.json (%s)" % (t.get('penna'), ', '.join(PENNE)))
        if 'base' not in t or 's' not in t:
            errori.append("ogni testo vuole almeno 's' e 'base' (riga su cui poggia, mm dal bordo alto)")
    return s, errori


# ------------------------------------------------------------ strumenti

def esegui(cmd, env=None):
    e = dict(os.environ)
    e.update(env or {})
    r = subprocess.run([sys.executable, '-B'] + cmd, cwd=QUI, env=e, capture_output=True, text=True)
    righe = [l for l in (r.stdout + r.stderr).splitlines()
             if l.strip() and 'Warning' not in l and not l.startswith('  ') and 'nanmedian' not in l and 'nanmean' not in l]
    if r.returncode:
        raise Errore('%s: %s' % (cmd[0], ' | '.join(righe[-4:]) or 'errore'))
    return '\n'.join(righe)


def aspetto(file, ritaglio):
    im = Image.open(file)
    w, h = im.size
    if ritaglio:
        su, giu, sx, dx = (int(t) for t in ritaglio.split(','))
        w, h = w - sx - dx, h - su - giu
    return w / h


def scegli_oggetto(percorso, tmp, esplicito=None):
    """.3mf o .model -> (file .model, id dell'oggetto con piu' vertici, avvisi)."""
    percorso = os.path.expanduser(percorso)
    if percorso.lower().endswith('.3mf'):
        cart = os.path.join(tmp, '3mf')
        zipfile.ZipFile(percorso).extractall(cart)
        modelli = sorted(glob.glob(os.path.join(cart, '3D', 'Objects', '*.model')))
    else:
        modelli = [percorso]
    if esplicito:
        f, _, oid = esplicito.partition(':')
        return [m for m in modelli if os.path.basename(m) == f][0], oid, []
    cand = []
    for m in modelli:
        t = open(m, encoding='utf-8', errors='ignore').read()
        for blocco in t.split('<object id="')[1:]:
            cand.append((blocco.count('<vertex '), m, blocco[:blocco.index('"')]))
    if not cand:
        raise Errore('nessun oggetto nel modello')
    cand.sort(reverse=True)
    avvisi = []
    if len(cand) > 1 and cand[1][0] > 0.3 * cand[0][0]:
        avvisi.append('il modello ha piu\' oggetti grandi (%d e %d vertici): uso il primo; indica '
                      '"oggetto": "file.model:id" in opzioni per sceglierne un altro' % (cand[0][0], cand[1][0]))
    return cand[0][1], cand[0][2], avvisi


def incornicia(svg, W, H):
    """Centra l'SVG di un motore in un foglio W x H (le foto escono grandi quanto il soggetto)."""
    m = re.search(r'<svg[^>]*width="([\d.]+)mm"[^>]*height="([\d.]+)mm"[^>]*>', svg)
    w, h = float(m.group(1)), float(m.group(2))
    if abs(w - W) < 0.01 and abs(h - H) < 0.01:
        return svg
    interno = svg[m.end():svg.rindex('</svg>')]
    vb = re.search(r'viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"', m.group(0))
    k = w / float(vb.group(1))
    dx, dy = (W - w) / 2, (H - h) / 2
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%gmm" height="%gmm" viewBox="0 0 %g %g">\n'
            '<g transform="translate(%.3f %.3f) scale(%.6f)">%s</g>\n</svg>\n' % (W, H, W, H, dx, dy, k, interno))


def aggiungi_testi(svg, testi, W):
    if not testi:
        return svg
    req = [{'s': t['s'], 'cx': t.get('cx', W / 2), 'base': t['base'], 'alt': t.get('alt', 8)} for t in testi]
    r = subprocess.run(['node', 'testo.js'], cwd=QUI, input=json.dumps(req), capture_output=True, text=True)
    if r.returncode:
        raise Errore('testo.js: ' + r.stderr.strip()[-200:])
    gruppi = ''
    for t, o in zip(testi, json.loads(r.stdout)):
        pen = PENNE[t.get('penna', 'nero')]
        righe = '\n'.join('<polyline points="%s"/>' % ' '.join('%.2f,%.2f' % tuple(q) for q in p) for p in o['polilinee'])
        gruppi += ('<g fill="none" stroke="%s" stroke-width="%g" stroke-linecap="round" stroke-linejoin="round">'
                   '<title>%s</title>\n%s\n</g>\n' % (pen['colore'], pen['spessore'], t['s'], righe))
    return svg[:svg.rindex('</svg>')] + gruppi + '</svg>\n'


# ---------------------------------------------------------------- motori

def genera(s, tmp):
    ing, fg, dett, op = s['ingresso'], s['foglio'], s['dettaglio'], s['opzioni']
    W, H, mar = float(fg['w']), float(fg['h']), float(fg['margine'])
    # testi sotto il disegno: il disegno si ferma sopra la scritta piu' alta, con 4 mm d'aria
    Hf = H
    if s['testi']:
        alto = min(t['base'] - t.get('alt', 8) for t in s['testi'])
        if alto > H / 2:
            Hf = alto - 4
    f = os.path.expanduser(ing['file'])
    out = os.path.join(tmp, 'out.svg')
    env = {'RILIEVO_MARGINE': str(mar)}
    stile, tipo = s['stile'], ing['tipo']
    avvisi, log = [], ''
    ritaglio = ing.get('ritaglio')
    rit = ['ritaglio=' + ritaglio] if ritaglio else []

    if stile in ('rilievo', 'layer') and tipo == 'modello3d':
        v = ing.get('vista', {})
        rz, rx = float(v.get('rz', 20)), float(v.get('rx', 10 if stile == 'rilievo' else 40))
        if 'vista' not in ing:
            avvisi.append('vista non indicata: uso rz=%g rx=%g' % (rz, rx))
        modello, oid, av = scegli_oggetto(f, tmp, op.get('oggetto'))
        avvisi += av
        if stile == 'rilievo' and dett == 'dettagliato':
            png = os.path.join(tmp, 'ombra.png')
            log += esegui(['render_ombra.py', modello, oid, str(rz), str(rx), png, '700'])
            im = Image.open(png)
            k = 900 / im.height
            im.resize((round(im.width * k), 900), Image.LANCZOS).save(png)
            log += esegui(['da_immagine.py', png, out, str(W), str(Hf), str(op.get('livelli', 6)), '2.2', 'senza-pavimento']
                          + ['%s=%s' % (k_, v_) for k_ in ('escludi', 'taglia') for v_ in op.get(k_, [])], env)
        else:
            # Rilievo = curve organiche (distanza dall'osservatore); Layer = fette parallele (quota Z)
            p = (RILIEVO_3D if stile == 'rilievo' else LAYER)[dett]
            modo = 'profondita' if stile == 'rilievo' else 'quota'
            log += esegui(['rilievo.py', modello, oid, str(rz), str(rx), 'L%d' % op.get('livelli', p['livelli']), out,
                           str(W), str(Hf), str(op.get('px', p['px'])), modo, str(op.get('sigma', p['sigma']))], env)
            log += ' [modo %s]' % modo
    elif stile == 'rilievo':                                  # da screenshot
        liv, lev, extra = RILIEVO_SHOT[dett]
        log += esegui(['da_immagine.py', f, out, str(W), str(Hf), str(op.get('livelli', liv)), lev] + extra
                      + ['%s=%s' % (k_, v_) for k_ in ('escludi', 'taglia') for v_ in op.get(k_, [])]
                      + (['senza-pavimento'] if op.get('senza_pavimento') else []), env)
    elif stile in ('onde', 'poligoni', 'tratti'):
        alt = min(Hf - 2 * mar, (W - 2 * mar) / aspetto(f, ritaglio))
        if stile == 'onde':
            passo, onda = ONDE[dett]
            log += esegui(['foto_onde.py', f, out, '%.1f' % alt] + rit
                          + ['passo=%g' % op.get('passo', passo), 'onda=%g' % op.get('onda', onda)])
        elif stile == 'poligoni':
            lato, st = POLIGONI[dett]
            log += esegui(['foto_poligoni.py', f, out, '%.1f' % alt] + rit + ['lato=%g' % op.get('lato', lato)]
                          + (['senza-toni'] if op.get('senza_toni', st) else []))
        else:
            avvisi.append('«tratti» fa migliaia di trattini corti: poco adatto alla macchina (tanti sollevamenti)')
            log += esegui(['foto_tratti.py', f, out, '%.1f' % alt] + rit)
    elif stile == 'fedele':
        extra = ['%s=%s' % (k_, v_) if v_ is not True else k_ for k_, v_ in op.items()]
        log += esegui(['fedele.py', f, out, str(W), str(Hf), str(mar), dett] + extra)
    elif stile == 'linea':
        cfg = ['%s=%s' % (k_, v_) if v_ is not True else k_ for k_, v_ in op.items()]
        log += esegui(['linea.py', f, out, str(W), str(Hf), str(mar)] + cfg)
    svg = incornicia(open(out, encoding='utf-8').read(), W, Hf)
    if Hf != H:                      # il foglio resta H: il disegno sta in alto, i testi sotto
        svg = re.sub(r'height="[\d.]+mm"', 'height="%gmm"' % H, svg, count=1)
        svg = re.sub(r'viewBox="0 0 ([\d.]+) [\d.]+"', lambda m: 'viewBox="0 0 %s %g"' % (m.group(1), H), svg, count=1)
    return aggiungi_testi(svg, s['testi'], W), avvisi, log


def main(argv):
    if argv[:1] == ['--esempio']:
        print(json.dumps(ESEMPIO, indent=2, ensure_ascii=False))
        return 0
    if argv[:1] == ['--stili']:
        for k, v in COMPATIBILE.items():
            print('%-9s ingressi: %s' % (k, ', '.join(v)))
        print('dettagli:', ', '.join(DETTAGLI), '| penne:', ', '.join(PENNE))
        return 0
    if not argv:
        print(__doc__)
        return 1
    s, errori = normalizza(json.load(open(argv[0], encoding='utf-8')))
    if errori:
        print('La scheda ha problemi:\n- ' + '\n- '.join(errori))
        return 2
    uscita = os.path.expanduser(s.get('uscita') or os.path.join(QUI, 'lavori', s['nome']))
    os.makedirs(uscita, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='lavoro-')
    try:
        svg, avvisi, log = genera(s, tmp)
    except Errore as e:
        print('ERRORE:', e)
        return 3
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    dest = os.path.join(uscita, s['nome'] + '.svg')
    open(dest, 'w', encoding='utf-8').write(svg)
    json.dump(s, open(os.path.join(uscita, 'scheda.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    fg = s['foglio']
    rep = controlla.analizza(svg, float(fg['w']), float(fg['h']), float(fg['margine']))
    rep['avvisi'] = avvisi + rep['avvisi']
    testo = controlla.testo_report(rep)
    open(os.path.join(uscita, 'report.txt'), 'w', encoding='utf-8').write(testo + '\n')
    print(log)
    print(testo)
    print('-> ' + dest)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
