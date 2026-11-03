#!/usr/bin/env python3
"""Rompe il codice di proposito, una riga per volta, e pretende che il
collaudo se ne accorga.

A COSA SERVE. Un controllo che non si accende quando il codice è rotto non è
un controllo, è una decorazione — e si scopre solo il giorno in cui serviva.
Il 2 novembre 2026 un'asserzione scritta insieme al codice ha preteso il
valore sbagliato e ha CONFERMATO il difetto invece di trovarlo: da quel
giorno ogni controllo nuovo si prova così.

COME FUNZIONA. Per ogni mutazione: si cambia una stringa in un sorgente, si
ricompone la pagina, si lancia `prova-foglio.js` e si guarda la riga del
controllo che DOVREBBE andare KO. Se va KO, la mutazione è stata vista e il
controllo vale. Se resta «ok», il controllo non guarda quello che dice di
guardare, e questo script lo segnala come difetto SUO — non del codice.

Il sorgente viene sempre rimesso come era, anche se qualcosa va storto.

  python3 webui/tools/rompi-foglio.py
  python3 webui/tools/rompi-foglio.py 3        # solo la mutazione numero 3
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Ogni voce: che cosa si rompe, in quale file, la stringa da sostituire, con
# che cosa, e il pezzo di nome del controllo che deve andare KO.
MUTAZIONI = [
    dict(
        nome="il colore come attributo invece che come stile",
        file="js/paper.js",
        da="""'" style="fill:' + esc(carta) + '" x="' + o.x""",
        a="""'" fill="' + esc(carta) + '" x="' + o.x""",
        vede="il foglio sul piano diventa di quella carta",
    ),
    dict(
        nome="nessun bordo chiaro sul foglio scuro",
        file="js/paper.js",
        da="(chiarezza(carta) < 0.25 ? ' sheet-scuro' : '')",
        a="''",
        vede="un foglio scuro prende il bordo chiaro",
    ),
    dict(
        nome="la misura del foglio non si ordina (girato = altro foglio)",
        file="js/profile.js",
        da="return a <= b ? [a, b] : [b, a];",
        a="return [a, b];",
        vede="girato per il lungo",
    ),
    dict(
        nome="il colore si scrive nel profilo subito, prima di Salva",
        file="js/paper.js",
        da="""      coloreInCorso = (String(coloreInCorso || '').toLowerCase() === c.toLowerCase())
        ? null : c;""",
        a="""      coloreInCorso = (String(coloreInCorso || '').toLowerCase() === c.toLowerCase())
        ? null : c;
      Profile.setColoreFoglio(+document.getElementById('fog-w').value,
                              +document.getElementById('fog-h').value, coloreInCorso);""",
        vede="Annulla la butta via",
    ),
    dict(
        nome="nome e misure di un A4 restano scrivibili",
        file="js/paper.js",
        da="""    sbloccaCampi(false);
    document.getElementById('fog-nota').textContent =
      'Nome e misure di un formato ISO""",
        a="""    sbloccaCampi(true);
    document.getElementById('fog-nota').textContent =
      'Nome e misure di un formato ISO""",
        vede="col nome e le misure bloccati",
    ),
    dict(
        nome="il colore della carta finisce nel profilo di stampa",
        file="js/profile.js",
        da="  function vociColore() { return get().coloriFoglio || (get().coloriFoglio = []); }",
        a="  function vociColore() { return stampa().coloriFoglio || (stampa().coloriFoglio = []); }",
        vede="accanto ai formati, non nel profilo di stampa",
    ),
    dict(
        nome="il pallino della carta non compare sul formato",
        file="js/paper.js",
        da="""    return '<span class="preset-carta" style="background:' + esc(c) + '"></span>';""",
        a="""    return '';""",
        vede="il formato porta il pallino della carta",
    ),
    dict(
        nome="la didascalia dice l'esadecimale invece del nome",
        file="js/paper.js",
        da="      if (CARTE[i].colore.toLowerCase() === h) return CARTE[i].nome;",
        a="      if (false) return CARTE[i].nome;",
        vede="il nome della carta",
    ),
    dict(
        nome="lo spessore non arriva al tratto",
        file="js/paper.js",
        da="(w ? 'stroke-width:' + w + ';' : '')",
        a="''",
        vede="larghi quei millimetri",
    ),
    dict(
        nome="lo spessore vale anche sugli spostamenti a penna alzata",
        file="js/paper.js",
        da="      var w = s.draw ? (sp[di[s.poly]] || 0) : 0;",
        a="      var w = sp[di[s.poly]] || 0;",
        vede="spostamenti a penna alzata restano sottili",
    ),
    dict(
        nome="gli spessori non si ordinano",
        file="js/artwork.js",
        da="    l.sort(function (a, b) { return a.mm - b.mm; });",
        a="",
        vede="in ordine crescente",
    ),
    dict(
        nome="il trattino non dice che manca una scelta",
        file="js/artwork.js",
        da="""                return '<button type="button" class="spess' + (mm ? '' : ' vuoto') +""",
        a="""                return '<button type="button" class="spess' + (mm ? '' : '') +""",
        vede="vuoto finche",
    ),
    dict(
        nome="lo spessore non entra nel file del progetto",
        file="js/artwork.js",
        da="""             disegno, e riaprendo il lavoro domani deve essere ancora lì. */
          spessore: l.spessore || null,""",
        a="""             disegno, e riaprendo il lavoro domani deve essere ancora lì. */""",
        vede="va nel progetto e torna indietro",
    ),
    dict(
        nome="lo spessore finisce nel G-code",
        file="js/artwork.js",
        da="    document.getElementById('gcode-out').value = prep;",
        a="""    document.getElementById('gcode-out').value = prep +
      (livelli[0] && livelli[0].spessore ? '\\n; punta ' + livelli[0].spessore : '');""",
        vede="il G-code non cambia",
    ),
    dict(
        nome="il tratto gia' percorso torna a perdersi sotto la penna",
        file="css/components.css",
        da=".trace-done { stroke: var(--accent) !important; }",
        a=".trace-done { stroke: var(--accent); }",
        vede="gia` percorso si colora",
    ),
    dict(
        nome="la penna uguale alla carta non viene segnalata",
        file="js/artwork.js",
        da="if (t && Paper.contrasto(t, carta) < 1.6) muti.push(vis[q].nome);",
        a="if (false) muti.push(vis[q].nome);",
        vede="l'elenco lo dice",
    ),
    dict(
        nome="la segnalazione scatta anche quando la penna si vede",
        file="js/artwork.js",
        da="if (t && Paper.contrasto(t, carta) < 1.6) muti.push(vis[q].nome);",
        a="if (t) muti.push(vis[q].nome);",
        vede="non dice niente",
    ),
]


def costruisci():
    return subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build.py"), "--niente-versione"],
        capture_output=True, text=True).returncode == 0


def collauda():
    p = subprocess.run(["node", str(ROOT / "tools" / "prova-foglio.js")],
                       capture_output=True, text=True)
    return p.stdout


def riga_del(uscita, pezzo):
    for riga in uscita.splitlines():
        if pezzo in riga:
            return riga
    return None


def main():
    soli = {int(a) for a in sys.argv[1:] if a.isdigit()}

    print("--- il collaudo sul codice intero, prima di rompere niente ---")
    if not costruisci():
        print("la pagina non si compone: mi fermo")
        return 1
    base = collauda()
    if "tutto a posto" not in base:
        print(base)
        print("il collaudo non passa sul codice intero: niente da mutare")
        return 1
    print("passa.\n")

    sordi, visti = [], 0
    for i, m in enumerate(MUTAZIONI, 1):
        if soli and i not in soli:
            continue
        f = ROOT / m["file"]
        era = f.read_text(encoding="utf-8")
        if era.count(m["da"]) != 1:
            print("%2d. %-52s ANCORA: la riga da rompere non c'e' (o ce n'e' "
                  "piu' d'una) in %s" % (i, m["nome"], m["file"]))
            sordi.append(m["nome"] + " (riga non trovata)")
            continue
        try:
            f.write_text(era.replace(m["da"], m["a"]), encoding="utf-8")
            if not costruisci():
                esito, dettaglio = False, "la pagina non si compone"
            else:
                uscita = collauda()
                riga = riga_del(uscita, m["vede"])
                if riga is None:
                    esito, dettaglio = False, "il controllo «%s» non c'e'" % m["vede"]
                else:
                    esito = riga.startswith("KO")
                    dettaglio = riga.strip()[:70]
        finally:
            f.write_text(era, encoding="utf-8")

        print("%2d. %-52s %s" % (i, m["nome"], "VISTA" if esito else "NON VISTA"))
        if esito:
            visti += 1
        else:
            print("      %s" % dettaglio)
            sordi.append(m["nome"])

    print("\n--- rimesso tutto a posto, ricompongo la pagina intera ---")
    costruisci()

    print("\n%d mutazioni su %d sono state viste." %
          (visti, visti + len(sordi)))
    if sordi:
        print("Controlli che non guardano quello che dicono di guardare:")
        for s in sordi:
            print("  - " + s)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
