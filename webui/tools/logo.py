#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rimette il logo dentro a index.html, prendendolo da logo/cnc2d.svg.

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
HTML = os.path.join(QUI, "..", "index.html")
APRE = "<!-- LOGO: generato da tools/logo.py, non si modifica a mano -->"
CHIUDE = "<!-- fine LOGO -->"


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


def main():
    html = io.open(HTML, encoding="utf-8").read()
    i, j = html.find(APRE), html.find(CHIUDE)
    if i < 0 or j < 0:
        print("KO in index.html non trovo i due segni del logo")
        return 1
    nuovo = html[:i + len(APRE)] + "\n  " + marchio() + "\n  " + html[j:]
    if nuovo == html:
        print("il logo in index.html e' gia' quello di logo/cnc2d.svg")
        return 0
    if "--controlla" in sys.argv:
        print("KO il logo in index.html NON e' quello di logo/cnc2d.svg")
        return 1
    io.open(HTML, "w", encoding="utf-8").write(nuovo)
    print("logo aggiornato in index.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
