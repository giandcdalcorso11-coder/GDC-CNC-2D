# -*- coding: utf-8 -*-
"""Rifa' quello che fa l'IDE di Arduino prima di compilare.

L'IDE non compila il .ino com'e' scritto: cerca tutte le funzioni, ne
genera i PROTOTIPI e li infila PRIMA DELLA PRIMA FUNZIONE del file. E'
comodo - si possono chiamare funzioni definite piu' sotto senza
dichiararle - ma vuol dire che un tipo dichiarato dopo quel punto viene
nominato dai prototipi quando ancora non esiste.

g++ da solo questo non lo fa, quindi il controllo con le intestazioni
finte passava e l'IDE no. Qui si riproduce: si generano i prototipi come
fa lui e si mettono dove li mette lui."""
import re, sys, io

sorgente = sys.argv[1]
uscita = sys.argv[2]
t = io.open(sorgente, encoding='utf-8').read()
righe = t.split('\n')

# Una definizione di funzione: comincia a colonna zero, ha le parentesi e
# apre la graffa sulla stessa riga. setup() e loop() l'IDE li salta.
DEF = re.compile(r'^((?:[A-Za-z_][\w:]*\s+)+\*?)([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*\{')
prototipi, prima = [], None
for i, r in enumerate(righe):
    m = DEF.match(r)
    if not m:
        continue
    if m.group(2) in ('setup', 'loop', 'if', 'for', 'while', 'switch'):
        if prima is None:
            prima = i
        continue
    if prima is None:
        prima = i
    prototipi.append('%s%s(%s);' % (m.group(1), m.group(2), m.group(3)))

assert prima is not None, 'nessuna funzione trovata'
blocco = ['/* --- prototipi come li genera l\'IDE --- */'] + prototipi
righe = righe[:prima] + blocco + righe[prima:]
io.open(uscita, 'w', encoding='utf-8').write('\n'.join(righe))
print('%d prototipi, infilati alla riga %d' % (len(prototipi), prima + 1))
