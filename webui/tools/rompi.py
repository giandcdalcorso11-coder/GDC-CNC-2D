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

  python3 webui/tools/rompi.py
  python3 webui/tools/rompi.py 3          # solo la mutazione numero 3
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Ogni voce: che cosa si rompe, in quale file, la stringa da sostituire, con
# che cosa, il pezzo di nome del controllo che deve andare KO, e -- quando non
# e' quello del foglio -- quale collaudo lo trova.
PROVA_PREDEFINITA = 'prova-foglio.js'
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

    # ------ il dialogo col telecomando: la cosa che si rompeva in silenzio
    dict(
        nome="la fetch al telecomando torna senza scadenza",
        file="js/telecomando.js",
        da="      signal: ctl ? ctl.signal : undefined\n",
        a="",
        vede="interrotto a tempo",
        prova="prova-telecomando.js",
    ),
    dict(
        nome="il messaggio in volo non viene mai sbloccato",
        file="js/telecomando.js",
        da="    function finita() { clearTimeout(scadenza); inVolo = false; }",
        a="    function finita() { clearTimeout(scadenza); }",
        vede="continuano a partire anche se nessuno risponde",
        prova="prova-telecomando.js",
    ),

    # --------------- ritrovare la punta al cambio penna
    dict(
        nome="la correzione non viene mandata alla macchina",
        file="js/popup.js",
        da="          Api.dichiaraPosizione(atteso.x, atteso.y);",
        a="",
        vede="dichiara l'angolo",
        prova="prova-cambio-penna.js",
    ),
    dict(
        nome="il G92 dichiara dove si trova invece di dove dovrebbe",
        file="js/popup.js",
        da="          Api.dichiaraPosizione(atteso.x, atteso.y);",
        a="          Api.dichiaraPosizione(State.data.pos.x, State.data.pos.y);",
        vede="dichiara l'angolo",
        prova="prova-cambio-penna.js",
    ),
    dict(
        nome="gli scostamenti dai bordi non entrano nel conto",
        file="js/popup.js",
        da="          var atteso = { x: o.x + dx, y: o.y + dy };",
        a="          var atteso = { x: o.x, y: o.y };",
        vede="i due scostamenti entrano nel conto",
        prova="prova-cambio-penna.js",
    ),
    dict(
        nome="nessun limite allo scarto: venti millimetri passano",
        file="js/popup.js",
        da="          if (scarto > SCARTO_MASSIMO) {",
        a="          if (false) {",
        vede="NON corregge",
        prova="prova-cambio-penna.js",
    ),
    dict(
        nome="il passo nuovo non fa ripartire la stampa",
        file="js/popup.js",
        da="""          alzaPenna();
          Sender.riprendiCambio();
          return true;
        }
      }
    ];""",
        a="""          alzaPenna();
          return true;
        }
      }
    ];""",
        vede="la stampa riparte da sola",
        prova="prova-cambio-penna.js",
    ),
    dict(
        nome="saltare non fa ripartire la stampa",
        file="js/popup.js",
        da="""                         'nuovo esce spostato di quello scarto.');
          Sender.riprendiCambio();""",
        a="""                         'nuovo esce spostato di quello scarto.');""",
        vede="riprende davvero",
        prova="prova-cambio-penna.js",
    ),
    dict(
        nome="il secondo passo fa ripartire la stampa come prima",
        file="js/popup.js",
        da="""          var alzata = Profile.alzataMm(), z = quotaContatto();
          if (alzata !== null && z !== null) Api.penna(z + alzata);
          return true;
        }
      },""",
        a="""          var alzata = Profile.alzataMm(), z = quotaContatto();
          if (alzata !== null && z !== null) Api.penna(z + alzata);
          Sender.riprendiCambio();
          return true;
        }
      },""",
        vede="la stampa aspetta ancora",
        prova="prova-cambio-penna.js",
    ),
    dict(
        nome="il telecomando riceve ancora il passo 2 sul terzo passo",
        file="../schermo/telecomando/telecomando.ino",
        da="    if (S.passo >= 2) return PENNA3;",
        a="",
        vede="il vetro dice ancora",
        prova="vetro.sh",
    ),
]


def costruisci():
    return subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build.py"), "--niente-versione"],
        capture_output=True, text=True).returncode == 0


def collauda(prova=PROVA_PREDEFINITA):
    """Lancia un collaudo e torna (uscita, passa).

    Due tipi di banco, e la differenza e' solo come si lanciano: i `.js`
    girano nel browser con node, `vetro.sh` compila il firmware vero contro
    un display finto e lo fa girare. Tutti e due scrivono le righe che non
    tornano cominciando per KO e tornano diverso da zero: tanto basta.
    """
    if prova.endswith(".sh"):
        cmd = ["bash", str(ROOT.parent / "schermo" / "vetro" / prova)]
    else:
        cmd = ["node", str(ROOT / "tools" / prova)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return (r.stdout + r.stderr), r.returncode == 0


def riga_del(uscita, pezzo):
    for riga in uscita.splitlines():
        if pezzo in riga:
            return riga
    return None


def main():
    soli = {int(a) for a in sys.argv[1:] if a.isdigit()}

    prove = sorted({m.get("prova", PROVA_PREDEFINITA) for m in MUTAZIONI})
    print("--- i collaudi sul codice intero, prima di rompere niente ---")
    if not costruisci():
        print("la pagina non si compone: mi fermo")
        return 1
    for pr in prove:
        if not collauda(pr)[1]:
            print("%s non passa sul codice intero: niente da mutare" % pr)
            return 1
        print("%-22s passa." % pr)
    print("")

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
                uscita = collauda(m.get("prova", PROVA_PREDEFINITA))[0]
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
