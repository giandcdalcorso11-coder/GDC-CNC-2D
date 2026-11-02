#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IL BANCO DEI SUONI DICE LA VERITA' SUL FIRMWARE?

`../suoni.html` serve a scegliere i suoni ascoltandoli, e dentro ha le
note di ogni proposta. Quelle segnate `stato: "scelta"` devono essere
IDENTICHE agli array del firmware: se uno dei due cambia e l'altro no, la
pagina diventa una bugia — e una bugia che suona bene, cioe' la peggiore
specie. Qui si confrontano, nota per nota e millisecondo per
millisecondo.
"""
import io, json, os, re, sys

QUI = os.path.dirname(os.path.abspath(__file__))
PAGINA = os.path.join(QUI, "..", "suoni.html")
SORGENTE = os.path.join(QUI, "..", "telecomando", "telecomando.ino")

# La tavolozza: dieci semitoni intorno ai 2500 Hz misurati. Una nota fuori
# da qui non e' un errore di battitura, e' un suono che non si sentira'.
TAVOLOZZA = [1873, 1984, 2102, 2227, 2360, 2500, 2649, 2806, 2973, 3150, 3338]


def voci_della_pagina(testo):
    """Ogni proposta della pagina: (id del suono, nome, stato, note)."""
    fuori = []
    for blocco in re.finditer(r'\{\s*id:\s*"(SUONO_\w+)"(.*?)\n    \] \}',
                              testo, re.S):
        quale, corpo = blocco.group(1), blocco.group(2)
        for v in re.finditer(r'\{ nome: "((?:[^"\\]|\\.)*)", stato: "(\w+)"'
                             r'.*?note: \[(.*?)\] \}', corpo, re.S):
            note = [[int(a), int(b)] for a, b in
                    re.findall(r'\[(\d+),(\d+)\]', v.group(3))]
            fuori.append((quale, v.group(1).replace('\\', ''), v.group(2), note))
    return fuori


def array_del_firmware(testo, quale):
    m = re.search(r'const Nota ' + quale + r'\[\]\s*=\s*\{([^;]*)\};', testo)
    if not m:
        return None
    return [[int(a), int(b)] for a, b in
            re.findall(r'\{\s*(\d+)\s*,\s*(\d+)\s*\}', m.group(1))]


def main():
    pagina = io.open(PAGINA, encoding="utf-8").read()
    ino = io.open(SORGENTE, encoding="utf-8").read()
    voci = voci_della_pagina(pagina)
    if not voci:
        print("KO non ho letto nessuna proposta da suoni.html")
        return 1

    guai = 0
    scelte = {}
    for quale, nome, stato, note in voci:
        for hz, ms in note:
            if hz and hz not in TAVOLOZZA:
                print("KO %s / %s: %d Hz non e' nella tavolozza" % (quale, nome, hz))
                guai += 1
            if not 30 <= ms <= 800:
                print("KO %s / %s: %d ms e' una durata assurda" % (quale, nome, ms))
                guai += 1
        if stato == "scelta":
            if quale in scelte:
                print("KO %s ha due proposte scelte" % quale)
                guai += 1
            scelte[quale] = (nome, note)

    for quale, (nome, note) in sorted(scelte.items()):
        nel = array_del_firmware(ino, quale)
        if nel is None:
            print("KO %s non esiste nel firmware" % quale)
            guai += 1
        elif nel != note:
            print("KO %s: la pagina e il firmware non dicono la stessa cosa" % quale)
            print("     firmware %s" % json.dumps(nel))
            print("     pagina   %s" % json.dumps(note))
            guai += 1
        else:
            print("ok  %-15s = %s" % (quale, nome))

    for quale in ("SUONO_PARTENZA", "SUONO_PENNA", "SUONO_FINE", "SUONO_ERRORE"):
        if quale not in scelte:
            print("KO nella pagina nessuna proposta e' scelta per %s" % quale)
            guai += 1

    return 1 if guai else 0


if __name__ == "__main__":
    sys.exit(main())
