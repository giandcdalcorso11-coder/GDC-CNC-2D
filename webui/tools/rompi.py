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

    # ------------------------- le tab delle stampe
    dict(
        nome="la tab legge il foglio vivo invece della sua copia",
        file="js/stampe.js",
        da="""      foglio: { x: org.x, y: org.y, w: pap.w, h: pap.h,""",
        a="""      foglio: { get x() { return State.data.sheetOrigin.x; },
                get y() { return State.data.sheetOrigin.y; },
                get w() { return State.data.paper.w; },
                get h() { return State.data.paper.h; },""",
        vede="il foglio di allora",
        prova="prova-stampe.js",
    ),
    dict(
        nome="ogni «invio» apre una tab, ripresa compresa",
        file="js/stampe.js",
        da="""    return ora === 'invio' &&
           (prima === 'fermo' || prima === 'fine' || prima === 'fermata' ||
            prima === 'errore');""",
        a="""    return ora === 'invio' &&
           (prima === 'fermo' || prima === 'fine' || prima === 'fermata' ||
            prima === 'cambio' || prima === 'errore');""",
        vede="NON nasce una seconda tab",
        prova="prova-stampe.js",
    ),
    dict(
        nome="la tab smette di ascoltare appena la stampa e' dichiarata finita",
        file="js/stampe.js",
        da="""        aggiorna(corrente);
      }
      /* `corrente` NON si azzera qui""",
        a="""        aggiorna(corrente);
        corrente = null;
      }
      /* `corrente` NON si azzera qui""",
        vede="percorso fatto e` disegnato tutto",
        prova="prova-stampe.js",
    ),
    dict(
        nome="la × si puo' premere anche mentre la stampa va",
        file="js/stampe.js",
        da="""      '<button class="tab-chiudi" data-chiudi="' + t.id + '" disabled ' +""",
        a="""      '<button class="tab-chiudi" data-chiudi="' + t.id + '" ' +""",
        vede="non si puo` chiudere",
        prova="prova-stampe.js",
    ),
    dict(
        nome="chiudendo resta il pannello attaccato al documento",
        file="js/stampe.js",
        da="    if (p) p.parentNode.removeChild(p);",
        a="",
        vede="toglie la tab e il suo pannello",
        prova="prova-stampe.js",
    ),
    dict(
        nome="le tab si accumulano senza tetto",
        file="js/stampe.js",
        da="    while (elenco.length > MAX) {",
        a="    while (false) {",
        vede="le piu` vecchie se ne vanno",
        prova="prova-stampe.js",
    ),
    dict(
        nome="il G-code letto senza memoria delle coordinate di prima",
        file="js/stampe.js",
        da="""      var nx = mx ? parseFloat(mx[1]) : x;
      var ny = my ? parseFloat(my[1]) : y;""",
        a="""      var nx = mx ? parseFloat(mx[1]) : 0;
      var ny = my ? parseFloat(my[1]) : 0;""",
        vede="sta dove lo dice il G-code",
        prova="prova-stampe.js",
    ),
    dict(
        nome="la parola G pretesa in testa a ogni riga",
        file="js/stampe.js",
        da="""      var mg = /(?:^|\\s)G(\\d+)/g, gg;""",
        a="""      if (!/^G[01](\\s|$)/.test(r)) continue;
      var mg = /(?:^|\\s)G(\\d+)/g, gg;""",
        vede="il percorso non e` vuoto",
        prova="prova-stampe.js",
    ),
    dict(
        nome="penna giu' e penna su si confondono",
        file="js/stampe.js",
        da="                        giu: zc !== null && zc <= soglia,",
        a="                        giu: true,",
        vede="sta dove lo dice il G-code",
        prova="prova-stampe.js",
    ),

    # ------------------- quando due livelli vogliono penne diverse
    dict(
        nome="la penna torna a essere il solo colore",
        file="js/artwork.js",
        da="    return p ? p.colore + '|' + (p.mm || '-') : null;",
        a="    return p ? p.colore : null;",
        vede="spessori diversi: e` comunque un cambio penna",
        prova="prova-penne.js",
    ),
    dict(
        nome="una fermata fra spessori diversi torna «sprecata»",
        file="js/artwork.js",
        da="      if (vis[j].cambioPenna && seq[j] && seq[j] === seq[j - 1]) inutili++;",
        a="      if (vis[j].cambioPenna && seq[j] &&\n          seq[j].split('|')[0] === seq[j - 1].split('|')[0]) inutili++;",
        vede="non la chiama sprecata",
        prova="prova-penne.js",
    ),
    dict(
        nome="la fermata mancante non viene piu' segnalata",
        file="js/artwork.js",
        da="    if (mancanti.length) {",
        a="    if (false) {",
        vede="senza fermata: lo dice",
        prova="prova-penne.js",
    ),
    dict(
        nome="la riga dove manca la fermata non viene segnata",
        file="js/artwork.js",
        da="      vis[j].mancaPenna = true;\n      mancanti.push(vis[j].nome);",
        a="      mancanti.push(vis[j].nome);",
        vede="segna la riga dove va messa",
        prova="prova-penne.js",
    ),
    dict(
        nome="la nota si scrive dopo le righe, come prima",
        file="js/artwork.js",
        da="""       modifica di ritardo, che è il modo più sicuro di non farsi credere. */
    notaPenne();

    var out = '';""",
        a="""       modifica di ritardo, che è il modo più sicuro di non farsi credere. */

    var out = '';""",
        vede="segna la riga dove va messa",
        prova="prova-penne.js",
    ),
    dict(
        nome="l'avviso penna/carta torna a leggere la chiave",
        file="js/artwork.js",
        da="        var t = tintaDi(vis[q]);",
        a="        var t = seq[q];",
        vede="penne diverse con la fermata: non dice niente",
        prova="prova-penne.js",
    ),
    dict(
        nome="lo spessore non viene scritto nel programma",
        file="js/gcode.js",
        da="                    (p.mm ? p.mm + 'mm ' : '') +",
        a="",
        vede="scrive lo spessore accanto al colore",
        prova="prova-penne.js",
    ),
    dict(
        nome="il lettore del programma non si aspetta lo spessore",
        file="js/sender.js",
        da="(?:\\s+(\\d+(?:\\.\\d+)?)mm)?",
        a="",
        vede="lo rilegge come numero",
        prova="prova-penne.js",
    ),
    dict(
        nome="lo spessore diventa obbligatorio nel programma",
        file="js/sender.js",
        da="(?:\\s+(\\d+(?:\\.\\d+)?)mm)?",
        a="\\s+(\\d+(?:\\.\\d+)?)mm",
        vede="programma salvato prima si legge ancora",
        prova="prova-penne.js",
    ),
    dict(
        nome="uno spessore cambia anche i comandi, non solo il promemoria",
        file="js/gcode.js",
        da="      if (f !== null && String(f) !== uf) { mov += ' F' + f; uf = String(f); }",
        a="      if (f !== null && String(f) !== uf) { mov += ' F' + f; uf = String(f); }\n      if (opt.penne && opt.penne[0] && opt.penne[0].mm) mov += ' ';",
        vede="nessun comando del G-code cambia",
        prova="prova-foglio.js",
    ),

    # ---- DUE PROGETTI SALVATI SULLO STESSO FOGLIO (2026-11-06) ----
    dict(
        nome="si chiede anche quando non c'e' niente da perdere",
        file="js/artwork.js",
        da="      if (!livelli.length) { Progetto.applica(pg, nome); return; }",
        a="      if (false) { Progetto.applica(pg, nome); return; }",
        vede="senza chiedere niente",
        prova="prova-progetto.js",
    ),
    dict(
        nome="si aggiunge PRIMA di chiedere",
        file="js/artwork.js",
        da="      Progetto.chiedi(pg, nome);",
        a="      Progetto.applica(pg, nome, true);\n      Progetto.chiedi(pg, nome);",
        vede="non e` cambiato niente",
        prova="prova-progetto.js",
    ),
    dict(
        nome="aggiungendo, quello che c'era si butta via lo stesso",
        file="js/artwork.js",
        da="""  function daProgetto(ls, aggiungi) {
    if (!aggiungi) {""",
        a="""  function daProgetto(ls, aggiungi) {
    if (true) {""",
        vede="li mette accanto a quelli che ci sono",
        prova="prova-progetto.js",
    ),
    dict(
        nome="sostituendo, quello che c'era resta",
        file="js/artwork.js",
        da="""  function daProgetto(ls, aggiungi) {
    if (!aggiungi) {""",
        a="""  function daProgetto(ls, aggiungi) {
    if (false) {""",
        vede="torna a quel progetto, foglio compreso",
        prova="prova-progetto.js",
    ),
    dict(
        nome="le forme arrivano appiattite (le curve si perdono)",
        file="js/artwork.js",
        da="        forme: d.forme || [],",
        a="""        forme: (d.forme || []).map(function (f) {
          (f.sub || []).forEach(function (s) {
            s.nodi.forEach(function (q) { delete q.hi; delete q.ho; });
          });
          return f;
        }),""",
        vede="la curva e` ancora una curva",
        prova="prova-progetto.js",
    ),
    dict(
        nome="penna e spessore non si portano dietro",
        file="js/artwork.js",
        da="        penna: d.penna || undefined,",
        a="        penna: undefined,",
        vede="con penna e spessore scelti a mano",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il primo livello arrivato non chiede un cambio penna",
        file="js/artwork.js",
        da="      if (!primo) nati[0].cambioPenna = true;",
        a="",
        vede="chiede un cambio penna",
        prova="prova-progetto.js",
    ),
    dict(
        nome="aggiungendo si prende anche il foglio del file",
        file="js/progetto.js",
        da="""    if (!aggiungi) {
      if (dati.foglio) Paper.setSize(dati.foglio.w, dati.foglio.h);""",
        a="""    if (true) {
      if (dati.foglio) Paper.setSize(dati.foglio.w, dati.foglio.h);""",
        vede="il foglio in uso non si muove",
        prova="prova-progetto.js",
    ),
    dict(
        nome="«Annulla» aggiunge lo stesso",
        file="js/progetto.js",
        da="      if (scelta) applica(v.dati, v.nome, scelta === 'aggiungi');\n      else Log.add('msg', 'Progetto «' + v.nome + '» non aperto: quello che ' +\n                          'c\\'era resta com\\'è.');",
        a="      applica(v.dati, v.nome, scelta !== 'sostituisci');",
        vede="lascia il foglio com'era",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il secondo progetto in coda non si annuncia",
        file="js/progetto.js",
        da="""       file solo. Chi sta scegliendo deve sapere che la scelta non e' l'ultima. */
    mostra();""",
        a="""       file solo. Chi sta scegliendo deve sapere che la scelta non e' l'ultima. */
    if (coda.length === 1) mostra();""",
        vede="si dice che c'e` un altro",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il secondo progetto in coda si perde",
        file="js/progetto.js",
        da="    if (coda.length) mostra();",
        a="",
        vede="si chiede del secondo, senza perderlo",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il foglio diverso non si dice nella finestrella",
        file="js/progetto.js",
        da="    nota.hidden = !diverso;",
        a="    nota.hidden = true;",
        vede="e` scritto nella finestrella",
        prova="prova-progetto.js",
    ),
    dict(
        nome="l'avviso del foglio compare anche quando e' lo stesso",
        file="js/progetto.js",
        da="""    return Math.round(f.w) === Math.round(State.data.paper.w) &&
           Math.round(f.h) === Math.round(State.data.paper.h);""",
        a="    return false;",
        vede="quando e` lo stesso",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il foglio ignorato finisce fra i messaggi invece che fra gli avvisi",
        file="js/progetto.js",
        da="      Log.add('err', 'Attenzione: quel progetto era su un foglio ' +",
        a="      Log.add('msg', 'Attenzione: quel progetto era su un foglio ' +",
        vede="il registro racconta l'aggiunta",
        prova="prova-progetto.js",
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
