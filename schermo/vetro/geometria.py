# -*- coding: utf-8 -*-
"""Controlla la geometria del vetro LEGGENDO IL SORGENTE del firmware.

E' la stessa prova che il banco di prova fa sul mock, ma qui le parole non
si possono guardare: si ricavano dal .ino le chiamate a scrivi() e le
etichette dei tasti, si rifa' il conto con le misure del font di
Adafruit_GFX (6x8 per unita' di corpo) e si chiede che ogni parola stia
dentro al cerchio libero (raggio 93: l'anello comincia a 95,5) e non ne
tocchi un'altra.

Le parole che si alternano sulla stessa riga - "al punto home" oppure "da
azzerare" - sono due casi diversi, non due parole insieme: si provano uno
per volta."""
import re, math, sys, itertools

import os
QUI = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(QUI, '..', 'telecomando', 'telecomando.ino'),
           encoding='utf-8').read()
R, C = 93.0, 120

largo = lambda s, k: len(s) * 6 * k - k
alto = lambda k: 8 * k
# Ogni casella porta anche un GRUPPO: due righe della stessa etichetta si
# toccano per forza - sono una sotto l'altra - e non e' un guaio.
centrata = lambda s, y, k: (s, C - largo(s, k) // 2, y, C - largo(s, k) // 2 + largo(s, k),
                            y + alto(k), None)

def blocco(funzione):
    i = SRC.index(funzione)
    return SRC[i:SRC.index('\n}', i)]

DISEGNA = blocco('void disegnaTutto(')
TASTIDI = blocco('int tastiDi(')

def casi(testo):
    """I `case` di uno switch, col corpo di ciascuno.

    DUE `case` DI FILA CONDIVIDONO IL CORPO — `case FINE: case FERMATA:`
    sono la stessa schermata vista da due stati — e il primo dei due qui
    risulterebbe vuoto: cioe' una schermata senza tasti, cioe' un
    controllo che non guarda niente. Il corpo si prende dal primo `case`
    successivo che ne ha uno."""
    out, pezzi = {}, re.split(r'\n\s*case (\w+):', testo)
    nomi = list(pezzi[1::2])
    corpi = list(pezzi[2::2])
    for i, nome in enumerate(nomi):
        corpo = corpi[i]
        j = i
        while corpo.strip() == '' and j + 1 < len(corpi):
            j += 1
            corpo = corpi[j]
        out[nome] = corpo
    return out

def etichetta(parola, posto, sotto=''):
    """Una casella per riga: un'etichetta puo' averne due."""
    righe = [parola] + ([sotto] if sotto else [])
    w = max(largo(r, 2) for r in righe)
    h = alto(2) * len(righe)
    destra = posto.endswith('_DX')
    if posto == 'BASSO':
        # lo spigolo che tocca l'anello e' quello di SOTTO
        x, y = C - w // 2, C + int(math.sqrt(R * R - (w / 2.0) ** 2)) - h
    else:
        dx, dy = int(R * math.cos(math.radians(30))), int(R * math.sin(math.radians(30)))
        x = (C + dx) - w if destra else C - dx
        y = (C + dy) - h if posto.startswith('BASSO') else C - dy
    fuori = []
    for i, r in enumerate(righe):
        wr = largo(r, 2)
        xr = (C - wr // 2) if posto == 'BASSO' else ((x + w - wr) if destra else x)
        yr = y + i * alto(2)
        fuori.append((r, xr, yr, xr + wr, yr + alto(2), posto + parola))
    return fuori

# posto, parola, e la seconda riga se c'e'
# posto, parola, e la seconda riga se c'e'. I campi dopo la seconda riga
# (`chiude`, dal 2026-11-09) non riguardano la geometria e si saltano: ma
# vanno PREVISTI, se no la riga non viene riconosciuta affatto e il tasto
# sparisce dal controllo senza che nessuno lo dica.
TASTI = {n: re.findall(r'\{\s*(\w+),\s*"([^"]*)",\s*\w+,\s*"[^"]*"'
                       r'(?:,\s*"([^"]*)")?(?:,\s*\w+)*\s*\}', c)
         for n, c in casi(TASTIDI).items()}
ko = 0

for nome, c in casi(DISEGNA).items():
    if nome == 'NESSUNA':
        continue
    fisse, alternative = [], []
    piatto = c.replace('\n', ' ')

    m = re.search(r'S\.azzerata \? "([^"]*)" : "([^"]*)",\s*(\d+),\s*(\d+)', piatto)
    if m:
        y, k = int(m.group(3)), int(m.group(4))
        alternative.append([centrata(m.group(1), y, k), centrata(m.group(2), y, k)])

    for s, y, k in re.findall(r'scrivi\("([^"]*)",\s*(\d+),\s*(\d+)', piatto):
        fisse.append(centrata(s, int(y), int(k)))

    m = re.search(r'scrivi\(ipTesto,\s*(\d+)', piatto)
    if m:   # il caso peggiore di un indirizzo, col corpo che si adatta
        y = int(m.group(1))
        prove = []
        for ip in ('192.168.100.100', '10.0.0.5'):
            k = 2 if (largo(ip, 2) / 2.0) ** 2 + max(abs(y - C), abs(y + alto(2) - C)) ** 2 <= R * R else 1
            prove.append(centrata(ip, y, k))
        alternative.append(prove)   # due indirizzi diversi, non due insieme

    # «MONTA ●»: parola e pallino sulla stessa riga, centrati insieme
    for t, y, k in re.findall(r'parolaEPallino\("([^"]*)",\s*S\.penna,\s*(\d+),\s*(\d+)', piatto):
        y, k = int(y), int(k)
        w = largo(t, k) + 10 + 14
        fisse.append((t + ' ●', C - w // 2, y, C - w // 2 + w, y + alto(k), None))

    # FERMATA: «al 100%», il caso peggiore della riga che dice a che punto
    # la stampa si e' interrotta. Si scrive con `snprintf(dove, ...)`, non
    # con `n`, quindi la riga qui sotto non la vedeva: il controllo diceva
    # «FERMATA 1 parola» e un'etichetta messa li' sopra sarebbe passata.
    m = re.search(r'snprintf\(dove, sizeof\(dove\), "al %d%%".*?scrivi\(dove,\s*(\d+),\s*(\d+)',
                  piatto)
    if m:
        fisse.append(centrata('al 100%', int(m.group(1)), int(m.group(2))))

    if 'snprintf(n, sizeof(n), "%d%%"' in piatto:   # il peggiore e' "100%"
        k, y = (6, 96) if nome == 'STAMPA' else (2, 174)
        fisse.append(centrata('100%', y, k))

    m = re.search(r'scriviRimanente\((\d+)\)', piatto)
    if m:
        fisse.append(centrata('~999 min', int(m.group(1)), 2))

    # NEMMENO I SIMBOLI SONO PAROLE, e sono grossi: il divieto e' un
    # cerchio di raggio 24 attorno all'asse, la spunta un segno largo 46 e
    # alto 33. Sono il secondo ostacolo che un'etichetta nuova rischia di
    # investire, dopo la pila — ed e' successo davvero: «CHIUDI» in alto a
    # sinistra arrivava a x 110 e il cerchio del divieto comincia a 96.
    # Le misure sono quelle di `simboloDivieto` e `simboloSpunta`.
    for y in re.findall(r'simboloDivieto\((\d+)', piatto):
        y = int(y)
        fisse.append(('il divieto', C - 24, y - 24, C + 24, y + 24, None))
    for y in re.findall(r'simboloSpunta\((\d+)', piatto):
        y = int(y)
        fisse.append(('la spunta', C - 22, y - 14, C + 24, y + 19, None))

    # LA PILA NON E' UNA PAROLA, ma occupa vetro come una — ed e' lei che
    # stava per farsi investire: un'etichetta in basso al centro su FINE o
    # FERMATA sarebbe caduta esattamente sul disegno della batteria scarica
    # (y 196, alta 13). Le misure sono quelle di `pila()` nel firmware:
    # 26 x 13 piu' 4 di becco, centrata, con il numero accanto quando si
    # scrive anche quello.
    for y, num in re.findall(r'pila\(batteria,\s*(\d+),\s*(true|false)\)', piatto):
        y = int(y)
        wn = largo('100%', 2) + 6 if num == 'true' else 0
        w = 26 + 4 + wn
        x = C - w // 2
        fisse.append(('la pila', x, y, x + w, y + 13, None))

    for posto, parola, sotto in TASTI.get(nome, []):
        fisse.extend(etichetta(parola, posto, sotto))

    quante = 0
    for scelta in itertools.product(*alternative) if alternative else [()]:
        caselle = fisse + list(scelta)
        quante = max(quante, len(caselle))
        for (t, x0, y0, x1, y1, _g) in caselle:
            r = max(math.hypot(a - C, b - C) for a in (x0, x1) for b in (y0, y1))
            if r > R + 0.7:
                print('KO  %-12s «%s» esce dal cerchio libero: r=%.1f' % (nome, t, r)); ko += 1
        for A, B in itertools.combinations(caselle, 2):
            if A[5] is not None and A[5] == B[5]:
                continue        # due righe della stessa etichetta
            if A[1] - 2 < B[3] and B[1] - 2 < A[3] and A[2] - 2 < B[4] and B[2] - 2 < A[4]:
                print('KO  %-12s «%s» e «%s» si toccano' % (nome, A[0], B[0])); ko += 1
    # LO SPICCHIO del tocco lungo e' un disco pieno: una parola che ci
    # finisce sopra e' rossa su rosso, cioe' non c'e' piu'. Il caso e'
    # successo davvero, con TIENI in basso a destra.
    if nome == 'STOP_TIENI':
        cx = int(re.search(r'SPIC_CX = (\d+)', SRC).group(1))
        cy = int(re.search(r'SPIC_CY = (\d+)', SRC).group(1))
        rr = int(re.search(r'SPIC_R = (\d+)', SRC).group(1)) + 6
        for (t, x0, y0, x1, y1, _g) in fisse:
            vx = max(x0 - cx, 0, cx - x1)
            vy = max(y0 - cy, 0, cy - y1)
            if math.hypot(vx, vy) < rr:
                print('KO  %-12s «%s» finisce sopra allo spicchio' % (nome, t)); ko += 1
    print('ok  %-12s %d parole' % (nome, quante))

print('---- ' + ('nessun contatto, tutto dentro al cerchio' if not ko else '%d GUAI' % ko))
sys.exit(1 if ko else 0)
