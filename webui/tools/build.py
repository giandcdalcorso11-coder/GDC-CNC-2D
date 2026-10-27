#!/usr/bin/env python3
"""Compone l'interfaccia in un unico file HTML.

La memoria dell'ESP32 non ha una cartella comoda in cui tenere dodici file, e
ogni file separato e' una richiesta HTTP in piu' che il microcontrollore deve
servire mentre pilota i motori. Questo script incolla fogli di stile e script
dentro la pagina, nell'ordine in cui compaiono in index.html.

  python3 tools/build.py            -> dist/cnc2d-ui.html (documento completo)
  python3 tools/build.py --bare     -> dist/cnc2d-ui.bare.html (senza involucro)
  python3 tools/build.py --leggero  -> senza il disegno di esempio

La variante "bare" serve dove la pagina viene inserita dentro un involucro
gia' pronto, come nelle anteprime.

IL DISEGNO DI ESEMPIO ADESSO C'E'. Prima lo si toglieva sempre, perche' sulla
memoria dell'ESP32 erano kilobyte spesi per un logo. Il 26 ottobre si e'
deciso che la pagina resta sul PC - installarla sulla scheda non renderebbe
comunque la stampa indipendente dal computer, visto che il trasporto e' lo
stesso WebSocket - e con quella decisione e' caduto il tetto dei kilobyte.
Chi dovesse rimetterla sulla scheda usi --leggero.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
bare = '--bare' in sys.argv
leggero = '--leggero' in sys.argv

# IL NUMERO DI VERSIONE SI RIFA' PRIMA DI OGNI COMPILAZIONE, perche' questo
# script gira sempre prima di consegnare la pagina: cosi' il numero non
# dipende da nessuno che si ricordi di aggiornarlo. Vedi tools/versione.py.
if '--niente-versione' not in sys.argv:
    subprocess.run([sys.executable, str(ROOT / 'tools' / 'versione.py')], check=False)

html = (ROOT / 'index.html').read_text(encoding='utf-8')

title = re.search(r'<title>(.*?)</title>', html, re.S).group(1).strip()
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)

css_files = re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)
js_files = re.findall(r'<script src="([^"]+)"></script>', html)

if leggero:
    js_files = [f for f in js_files if not f.endswith('sample.js')]

def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')

style = '\n'.join('/* ===== %s ===== */\n%s' % (f, read(f)) for f in css_files)
script = '\n'.join('/* ===== %s ===== */\n%s' % (f, read(f)) for f in js_files)

# Gli script erano caricati in fondo al body: li rimettiamo la', cosi' l'ordine
# di esecuzione e il momento in cui trovano il DOM restano quelli di sempre.
body = re.sub(r'<script src="[^"]+"></script>\s*', '', body)

parts = [
    '<title>%s</title>' % title,
    '<style>\n%s\n</style>' % style,
    body.strip(),
    '<script>\n%s\n</script>' % script,
]
out = '\n'.join(parts)

if not bare:
    out = ('<!DOCTYPE html>\n<html lang="it">\n<head>\n'
           '<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           + parts[0] + '\n' + parts[1] + '\n</head>\n<body>\n'
           + parts[2] + '\n' + parts[3] + '\n</body>\n</html>\n')

dist = ROOT / 'dist'
dist.mkdir(exist_ok=True)
name = 'cnc2d-ui.bare.html' if bare else 'cnc2d-ui.html'
(dist / name).write_text(out, encoding='utf-8')
print('%s  %d byte' % (name, len(out.encode('utf-8'))))
