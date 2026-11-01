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

Si butta anche quello che NON SI VEDE: i pezzi con `fill:none` e quelli di
area zero (una polilinea i cui punti stanno tutti sulla stessa retta). Sullo
schermo non cambiano niente, ma un plotter li disegnerebbe tutti e due.

E si CUCIONO LE FESSURE. Due pezzi che si toccano esattamente, invece di
sovrapporsi, lasciano una riga chiara dove il disegno dovrebbe essere pieno:
il renderer calcola la copertura del bordo di uno e del bordo dell'altro e
nessuno dei due arriva a coprire tutto il pixel. In Illustrator non si vede
(lavora in vettoriale), ma si vede su qualunque schermo. La cura senza
operazioni booleane e' un CONTORNO sottilissimo dello stesso colore su ogni
pezzo: ogni forma cresce di mezza larghezza di contorno e i due bordi si
sormontano. La sagoma esterna ingrassa di CUCITURA/2, cioe' lo 0,1%
dell'altezza del logo: invisibile.

Il riquadro (x y larghezza altezza) si misura col browser — `getBBox()` —
perche' l'esportazione di Illustrator e' grande quanto il foglio di lavoro.
"""
import io, re, sys

CUCITURA = 0.3    # unita' del file: vedi sopra

src = io.open(sys.argv[1], encoding='utf-8').read()
dst = sys.argv[2]
VB = tuple(float(v) for v in sys.argv[3:7])

# Quali classi sono bianche e quali invisibili, lette dallo <style>.
bianche, vuote = set(), set()
for m in re.finditer(r'\.(\w+)\s*\{([^}]*)\}', src):
    corpo = m.group(2).replace(' ', '').lower()
    if 'fill:#fff' in corpo:  bianche.add(m.group(1))
    if 'fill:none' in corpo:  vuote.add(m.group(1))

def areaZero(tag, attr):
    """Una polilinea o un poligono con tutti i punti in fila non ha area:
       sullo schermo non si vede e il plotter ci passa sopra."""
    if tag not in ('polyline', 'polygon'):
        return False
    p = re.search(r'points="([^"]*)"', attr)
    if not p:
        return False
    n = [float(v) for v in re.split(r'[\s,]+', p.group(1).strip()) if v]
    xy = list(zip(n[0::2], n[1::2]))
    a = 0.0
    for i in range(len(xy)):
        q = xy[(i + 1) % len(xy)]
        a += xy[i][0] * q[1] - q[0] * xy[i][1]
    return abs(a) / 2.0 < 0.01

pezzi, buttati = [], 0
for m in re.finditer(r'<(rect|path|polygon|polyline)\s([^>]*?)/>', src, re.S):
    attr = m.group(2)
    cl = re.search(r'class="([^"]*)"', attr)
    cl = cl.group(1) if cl else ''
    if cl in vuote or areaZero(m.group(1), attr):
        buttati += 1
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
            out.append('<%s %s fill="#000" stroke="#000" stroke-width="%g"'
                       ' stroke-linejoin="round"/>' % (p[1], p[2], CUCITURA))
        out.append('</mask>')
    out.append('</defs>')

for n, g in enumerate(gruppi):
    cuci = ('stroke="currentColor" stroke-width="%g" stroke-linejoin="round"'
            % CUCITURA)
    out.append('<g %s%s>' % ('mask="url(#cnc2d-%d)" ' % n if maschere[n] else '',
                             cuci))
    for i, p in g:
        out.append('<%s %s/>' % (p[1], p[2]))
    out.append('</g>')
out.append('</svg>')

io.open(dst, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('%s  %d pezzi, %d gruppi, %d controformi, %d invisibili buttati, '
      'cucitura %g' % (dst, len(pezzi), len(gruppi), len(bianchi), buttati,
                       CUCITURA))
