#!/usr/bin/env python3
"""Scrive js/versione.js col numero di versione della pagina.

IL NUMERO E' QUANTE VOLTE LA PAGINA E' CAMBIATA, cioe' quanti commit hanno
toccato `webui/`. Non si inventa e non si incrementa a mano: si conta, e la
cosa contata e' la storia del repository. Un numero scritto a mano prima o poi
non viene aggiornato, e allora e' peggio di non averlo — dice una cosa falsa
invece di non dire niente.

Si conta il passato PIU' UNO, perche' lo si chiama prima di fare il commit e
quel commit e' proprio quello che si sta per consegnare. Chiamarlo due volte
prima dello stesso commit da' lo stesso numero: il conto cambia solo quando il
commit esiste davvero.

Lo chiama build.py, che gira sempre prima di consegnare la pagina. Senza git —
una copia scaricata, uno zip — il file che c'e' resta com'e': meglio un numero
vecchio che nessun numero.

  python3 tools/versione.py        -> aggiorna js/versione.js e lo stampa
"""
import datetime
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / 'js' / 'versione.js'


def conta():
    """Quanti commit hanno toccato webui/, piu' quello che si sta preparando."""
    try:
        out = subprocess.run(
            ['git', 'log', '--oneline', '--', 'webui/'],
            cwd=ROOT.parent, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    righe = [r for r in out.stdout.splitlines() if r.strip()]
    return len(righe) + 1


def vecchio():
    if not FILE.exists():
        return None
    m = re.search(r'numero:\s*(\d+)', FILE.read_text(encoding='utf-8'))
    return int(m.group(1)) if m else None


def scrivi(n, data):
    FILE.write_text(
        "/* GENERATO DA tools/versione.py: non si scrive a mano.\n"
        "   Il numero e' quante volte la pagina e' cambiata, cioe' quanti commit\n"
        "   hanno toccato webui/. Si conta, non si incrementa: un numero scritto a\n"
        "   mano prima o poi non viene aggiornato, e allora dice una cosa falsa\n"
        "   invece di non dire niente. */\n"
        "var Versione = { numero: %d, data: '%s' };\n\n"
        "if (typeof module !== 'undefined') module.exports = Versione;\n" % (n, data),
        encoding='utf-8')


if __name__ == '__main__':
    n = conta()
    if n is None:
        n = vecchio()
        if n is None:
            raise SystemExit('niente git e niente versione.js: non so che numero mettere')
        print('versione.js  v%d (git non raggiungibile: lasciato com\'era)' % n)
    else:
        scrivi(n, datetime.date.today().isoformat())
        print('versione.js  v%d' % n)
