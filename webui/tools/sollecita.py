#!/usr/bin/env python3
"""Genera il disegno di SOLLECITAZIONE ELETTRICA: serve a far cadere la
macchina in fretta e in un punto noto, col tester gia' attaccato.

PERCHE' ESISTE. Fra il 2026-11-25 e il 2026-11-27 quattro stampe si sono
interrotte alle righe 2170, 5679, 6880 e 7511, sempre nella parte fitta del
disegno, con l'ESP32 che si riavvia (codice di chiusura 1006 e posizione
azzerata). Aspettare che succeda su un disegno vero costa mezz'ora e un
foglio per tentativo. Questo disegno concentra in una decina di minuti la
sollecitazione che li' era diluita, e la divide in DUE BANDE che accusano
due sospetti diversi:

  BANDA A -- denti fitti. Segmenti cosi' corti che i motori accelerano e
  frenano di continuo senza mai andare a regime: e' il punto di massima
  corrente CONTINUA sui 12 V. Poche alzate di penna.

  BANDA B -- trattini staccati. Un tratto breve per volta, separato dagli
  altri, quindi un'alzata di penna ognuno: e' il punto di massimo lavoro
  del SERVO. Pochi spostamenti lunghi.

DOVE CADE DICE CHE COSA E'. Se si riavvia nella banda A il sospetto sono i
motori e la caduta sui 12 V; se cade nella banda B e' il ramo del servo.
Se regge tutto, l'ipotesi elettrica si indebolisce e si guarda altrove.

I trattini della banda B sono distanti fra loro piu' di JOIN_TOL (0.15 mm,
vedi js/optimize.js): se si toccassero, la saldatura dei tratti contigui li
unirebbe in uno solo e le alzate sparirebbero -- cioe' la banda B non
proverebbe piu' niente.

  python3 webui/tools/sollecita.py        -> scrive sollecitazione.svg
"""
from pathlib import Path

LARG, ALT = 100.0, 112.0          # mm: la tela, da mettere a questa misura
MARG = 5.0

# --- banda A: denti fitti -------------------------------------------------
A_RIGHE, A_PASSO_Y = 4, 8.0       # righe e distanza fra righe
A_LARG = LARG - 2 * MARG
A_AVANZO = 0.5                    # quanto avanza ogni mezza oscillazione
A_AMPIEZZA = 2.0                  # oscillazione picco-picco

# --- banda B: trattini staccati -------------------------------------------
B_TRATTO = 2.0                    # lunghezza di un trattino
B_PASSO_X, B_PASSO_Y = 5.0, 4.0   # griglia: il vuoto fra due trattini e' 3 mm


def denti():
    out = []
    y0 = MARG + A_AMPIEZZA
    for r in range(A_RIGHE):
        base = y0 + r * A_PASSO_Y
        pts, x, alto = [], MARG, True
        while x <= MARG + A_LARG:
            pts.append((x, base + (A_AMPIEZZA / 2 if alto else -A_AMPIEZZA / 2)))
            alto = not alto
            x += A_AVANZO
        out.append(pts)
    return out


def trattini(y_da):
    out, y = [], y_da
    while y <= ALT - MARG:
        x = MARG
        while x + B_TRATTO <= LARG - MARG:
            out.append([(x, y), (x + B_TRATTO, y)])
            x += B_PASSO_X
        y += B_PASSO_Y
    return out


def d(pts):
    return 'M' + ' L'.join('%.3f,%.3f' % p for p in pts)


if __name__ == '__main__':
    a = denti()
    b = trattini(MARG + A_RIGHE * A_PASSO_Y + 6.0)
    seg_a = sum(len(p) - 1 for p in a)
    righe = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" '
             'width="%gmm" height="%gmm">' % (LARG, ALT, LARG, ALT),
             '<g fill="none" stroke="#000" stroke-width="0.4">']
    for p in a:
        righe.append('<path d="%s"/>' % d(p))
    for p in b:
        righe.append('<path d="%s"/>' % d(p))
    righe.append('</g>')
    righe.append('</svg>')
    f = Path('sollecitazione.svg')
    f.write_text('\n'.join(righe) + '\n', encoding='utf-8')
    print('%s  %.0f x %.0f mm' % (f, LARG, ALT))
    print('  banda A: %d righe, %d segmenti, %d alzate' % (len(a), seg_a, len(a)))
    print('  banda B: %d trattini, %d alzate' % (len(b), len(b)))
