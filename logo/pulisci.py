# -*- coding: utf-8 -*-
"""Dal file di Illustrator a un logo che funziona su qualunque fondo.

L'esportazione di Illustrator disegna i CONTROFORMI — il 2 e la D — con
paths BIANCHI sopra a quelli neri. Su carta bianca si legge giusto, ma il
bianco e' inchiostro come un altro: su un fondo grigio compaiono due macchie
bianche, e su fondo nero del logo resta solo «2 D».

Qui quei due paths diventano una MASCHERA, cioe' buchi veri. Il disegno non
cambia di un pixel su bianco; su tutto il resto comincia a funzionare. Il
colore diventa `currentColor`, cosi' la pagina lo decide da fuori.
"""
import io, re, sys

src = io.open(sys.argv[1], encoding='utf-8').read()
dst = sys.argv[2]

# I sette pezzi, nell'ordine in cui stanno nel file: chi e' bianco e chi no.
pezzi = []
for m in re.finditer(r'<(rect|path)\s([^>]*?)/>', src, re.S):
    attr = m.group(2)
    bianco = 'class="st0"' in attr
    d = re.sub(r'\s*class="st0"\s*', ' ', attr).strip()
    pezzi.append((bianco, m.group(1), re.sub(r'\s+', ' ', d)))

neri = [p for p in pezzi if not p[0]]
bianchi = [p for p in pezzi if p[0]]
assert len(bianchi) == 2, 'controformi attesi 2, trovati %d' % len(bianchi)

# L'ULTIMO NERO STA SOPRA AL BIANCO: e' il pieno della D, che nel file
# originale e' disegnato DOPO la D bianca. Se lo si buca con la stessa
# maschera sparisce, perche' sta proprio li' dentro.
sopra = neri[-1]
sotto = neri[:-1]

VB = (67.61, 195.77, 472.19, 158.44)   # misurato col browser: getBBox()
box = 'x="%g" y="%g" width="%g" height="%g"' % VB

def tag(p, extra=''):
    return '<%s %s%s/>' % (p[1], p[2], extra)

out = []
out.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%g %g %g %g"'
           ' fill="currentColor" role="img" aria-label="CNC 2D">' % VB)
out.append('<title>CNC 2D</title>')
out.append('<defs><mask id="cnc2d-controformi" maskUnits="userSpaceOnUse" %s>' % box)
out.append('<rect %s fill="#fff"/>' % box)
for p in bianchi:
    out.append(tag(p, ' fill="#000"'))
out.append('</mask></defs>')
out.append('<g mask="url(#cnc2d-controformi)">')
for p in sotto:
    out.append(tag(p))
out.append('</g>')
out.append(tag(sopra))
out.append('</svg>')

io.open(dst, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('%s  %d neri, %d controformi, %d byte'
      % (dst, len(neri), len(bianchi), len('\n'.join(out))))
