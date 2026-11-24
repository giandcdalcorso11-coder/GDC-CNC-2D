#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rimette i due logo dentro a index.html, prendendoli da logo/.

DUE FILE PERCHE' SONO DUE COSE. `cnc2d.svg` e' il marchio: aree piene e una
maschera che ritaglia i contrografici, fatto per essere GUARDATO, e segue il
tema col currentColor. `cnc2d-tratti.svg` e' lo stesso logo ridotto a LINEE,
fatto per essere TRACCIATO da una penna, e finisce sul foglio quando si preme
il pulsante del logo. Una maschera un pennino non sa disegnarla, e la
conversione al volo dell'uno nell'altro -- che e' quello che si faceva prima
del 2026-11-24 -- perdeva per strada proprio i buchi.

IL LOGO HA UNA SORGENTE SOLA, e sta in `logo/`. Qui dentro ci finisce una
copia, perche' la pagina e' un file solo e un `<img src>` verso l'esterno
non sopravviverebbe alla costruzione. Ma una copia fatta a mano prima o poi
resta indietro rispetto all'originale: questo script la rifa' in un secondo
e dice se e' cambiata.

  python3 webui/tools/logo.py            -> aggiorna
  python3 webui/tools/logo.py --controlla -> dice solo se e' allineata (exit 1 se no)
"""
import io
import os
import re
import sys

QUI = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(QUI, "..", "..", "logo", "cnc2d.svg")
TRATTI = os.path.join(QUI, "..", "..", "logo", "cnc2d-tratti.svg")
HTML = os.path.join(QUI, "..", "index.html")
APRE = "<!-- LOGO: generato da tools/logo.py, non si modifica a mano -->"
CHIUDE = "<!-- fine LOGO -->"
APRE_T = "<!-- LOGO DA TRACCIARE: generato da tools/logo.py, non si modifica a mano -->"
CHIUDE_T = "<!-- fine LOGO DA TRACCIARE -->"


def marchio():
    s = io.open(SVG, encoding="utf-8").read().strip()
    # Niente dichiarazione XML dentro a una pagina HTML, e il titolo lo
    # porta gia' l'aria-label: un <title> dentro all'SVG inline diventa un
    # tooltip che spunta passandoci sopra, e sul nome di un'applicazione
    # e' rumore.
    s = re.sub(r"<\?xml[^>]*\?>\s*", "", s)
    s = re.sub(r"<title>.*?</title>\s*", "", s, flags=re.S)
    s = s.replace('<svg ', '<svg class="marchio" ', 1)
    return s


def tratti():
    """Il logo da tracciare, nascosto: sta nella pagina solo per essere letto
    dal pulsante, non per essere visto. `hidden` non basta da solo su un
    <svg>, quindi ci va anche il display."""
    s = io.open(TRATTI, encoding="utf-8").read().strip()
    s = re.sub(r"<\?xml[^>]*\?>\s*", "", s)
    s = re.sub(r"<!--.*?-->\s*", "", s, flags=re.S)
    s = re.sub(r"<title>.*?</title>\s*", "", s, flags=re.S)
    return s.replace('<svg ', '<svg class="marchio-tratti" hidden '
                              'style="display:none" ', 1)


def mettici(html, apre, chiude, pezzo, nome):
    i, j = html.find(apre), html.find(chiude)
    if i < 0 or j < 0:
        print("KO in index.html non trovo i due segni di %s" % nome)
        return None
    return html[:i + len(apre)] + "\n  " + pezzo + "\n  " + html[j:]


def main():
    html = io.open(HTML, encoding="utf-8").read()
    nuovo = mettici(html, APRE, CHIUDE, marchio(), "logo")
    if nuovo is None:
        return 1
    nuovo = mettici(nuovo, APRE_T, CHIUDE_T, tratti(), "logo da tracciare")
    if nuovo is None:
        return 1
    if nuovo == html:
        print("i logo in index.html sono gia' quelli di logo/")
        return 0
    if "--controlla" in sys.argv:
        print("KO i logo in index.html NON sono quelli di logo/")
        return 1
    io.open(HTML, "w", encoding="utf-8").write(nuovo)
    print("logo aggiornati in index.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
