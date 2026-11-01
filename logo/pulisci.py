# -*- coding: utf-8 -*-
"""Dal file di Illustrator a un logo che funziona su qualunque fondo.

   python3 pulisci.py dentro.svg fuori.svg  x y larghezza altezza

L'esportazione di Illustrator disegna i CONTROFORMI con paths BIANCHI sopra a
quelli neri. Su carta bianca si legge giusto, ma il bianco e' inchiostro come
un altro: su un fondo grigio compaiono macchie bianche dove dovrebbero
esserci buchi, e su fondo nero del logo resta solo quello che e' bianco.

Qui i paths bianchi diventano MASCHERE, cioe' buchi veri. Non basta una
maschera sola: conta l'ORDINE. Un nero disegnato DOPO un bianco ci passa
sopra, e bucarlo con quel bianco lo cancellerebbe. Quindi i pezzi si
dividono in gruppi fra un bianco e l'altro, e ogni gruppo viene bucato
soltanto dai bianchi che gli stanno SOPRA (cioe' dopo, nel file).

Si butta anche quello che non si vede (`fill:none`): sullo schermo non
cambia niente, ma un plotter disegnerebbe anche quello.

Il riquadro (x y larghezza altezza) si misura col browser — `getBBox()` —
perche' l'esportazione di Illustrator e' grande quanto il foglio di lavoro.
"""
import io, re, sys

src = io.open(sys.argv[1], encoding='utf-8').read()
dst = sys.argv[2]
VB = tuple(float(v) for v in sys.argv[3:7])

# Quali classi sono bianche e quali invisibili, lette dallo <style>.
bianche, vuote = set(), set()
for m in re.finditer(r'\.(\w+)\s*\{([^}]*)\}', src):
    corpo = m.group(2).replace(' ', '').lower()
    if 'fill:#fff' in corpo:  bianche.add(m.group(1))
    if 'fill:none' in corpo:  vuote.add(m.group(1))

pezzi = []
for m in re.finditer(r'<(rect|path|polygon)\s([^>]*?)/>', src, re.S):
    attr = m.group(2)
    cl = re.search(r'class="([^"]*)"', attr)
    cl = cl.group(1) if cl else ''
    if cl in vuote:
        continue
    d = re.sub(r'\s*class="[^"]*"\s*', ' ', attr).strip()
    pezzi.append(('bianco' if cl in bianche else 'nero', m.group(1),
                  re.sub(r'\s+', ' ', d)))

# I gruppi: pezzi neri di fila, e i bianchi che li bucano sono quelli dopo.
gruppi, ora = [], []
for i, p in enumerate(pezzi):
    if p[0] == 'nero':
        ora.append((i, p))
    elif ora:
        gruppi.append(ora); ora = []
if ora:
    gruppi.append(ora)

bianchi = [(i, p) for i, p in enumerate(pezzi) if p[0] == 'bianco']
box = 'x="%g" y="%g" width="%g" height="%g"' % VB
out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="%g %g %g %g"'
       ' fill="currentColor" role="img" aria-label="CNC 2D">' % VB,
       '<title>CNC 2D</title>']

maschere = []
for n, g in enumerate(gruppi):
    dopo = [p for i, p in bianchi if i > g[-1][0]]
    maschere.append(dopo)

if any(maschere):
    out.append('<defs>')
    for n, dopo in enumerate(maschere):
        if not dopo: continue
        out.append('<mask id="cnc2d-%d" maskUnits="userSpaceOnUse" %s>' % (n, box))
        out.append('<rect %s fill="#fff"/>' % box)
        for p in dopo:
            out.append('<%s %s fill="#000"/>' % (p[1], p[2]))
        out.append('</mask>')
    out.append('</defs>')

for n, g in enumerate(gruppi):
    apri = '<g mask="url(#cnc2d-%d)">' % n if maschere[n] else '<g>'
    out.append(apri)
    for i, p in g:
        out.append('<%s %s/>' % (p[1], p[2]))
    out.append('</g>')
out.append('</svg>')

io.open(dst, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('%s  %d pezzi, %d gruppi, %d controformi, %d invisibili buttati'
      % (dst, len(pezzi), len(gruppi), len(bianchi),
         len(re.findall(r'<(?:rect|path|polygon)\s', src)) - len(pezzi)))
