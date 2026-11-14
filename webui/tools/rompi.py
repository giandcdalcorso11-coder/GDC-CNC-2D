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

# Quanto si aspetta un collaudo prima di dirlo piantato. Il piu' lento
# (prova-piano.js) sta sotto il minuto: cinque sono larghi per una
# macchina carica e stretti abbastanza da non perdere un'ora su un giro
# che non finisce.
TEMPO_MASSIMO = 300

# Il blocco dei due campi e del «+», per la mutazione che lo rimette sotto ai
# fogli del piano: scambiare due pezzi di markup in una sostituzione sola
# vuol dire averne uno scritto qui per intero.
MISURE = (
    '        <div class="field-row preset-nuovo">\n'
    '          <label>Larghezza (mm) <input type="number" id="paper-w" value="148"'
    ' min="20" max="400" step="1"></label>\n'
    '          <label>Altezza (mm) <input type="number" id="paper-h" value="210"'
    ' min="20" max="400" step="1"></label>\n'
    '          <button class="btn btn-ghost preset-add" id="btn-paper-add">+</button>\n'
    '        </div>\n'
)

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
        da="      if (chiarezza(carta) < 0.25) cl += ' sheet-scuro';",
        a="",
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
        nome="la tab legge i fogli vivi invece della sua copia",
        file="js/stampe.js",
        da='      fogli: State.data.fogli.map(function (f) {\n        return { x: f.origine.x, y: f.origine.y, w: f.w, h: f.h,',
        a='      fogli: State.data.fogli.map(function (f) {\n        return { get x() { return f.origine.x; },\n                 get y() { return f.origine.y; },\n                 get w() { return f.w; }, get h() { return f.h; },',
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
        da="    notaPenne();\n\n    /* L'ELENCO \u00c8 FATTO DI FOGLI",
        a="\n    /* L'ELENCO \u00c8 FATTO DI FOGLI",
        piu=[("js/artwork.js", '    box.innerHTML = out;\n  }', '    notaPenne();\n    box.innerHTML = out;\n  }')],
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
        da="""      if (!livelli.length && State.data.fogli.length < 2) {
        Progetto.applica(pg, nome);
        return;
      }""",
        a="""      if (false) {
        Progetto.applica(pg, nome);
        return;
      }""",
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
        da="""  function daProgetto(ls, aggiungi, fogli) {
    if (!aggiungi) {""",
        a="""  function daProgetto(ls, aggiungi, fogli) {
    if (true) {""",
        vede="li mette accanto a quelli che ci sono",
        prova="prova-progetto.js",
    ),
    dict(
        nome="sostituendo, quello che c'era resta",
        file="js/artwork.js",
        da="""  function daProgetto(ls, aggiungi, fogli) {
    if (!aggiungi) {""",
        a="""  function daProgetto(ls, aggiungi, fogli) {
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
        nome="aggiungendo, il piano di chi c'era si butta lo stesso",
        file="js/progetto.js",
        da="    var esito = aggiungi ? accosta(fg, dati.livelli) : rimetti(fg, dati.livelli);",
        a="    var esito = rimetti(fg, dati.livelli);",
        vede="quello che c'era sul piano non si muove",
        prova="prova-progetto.js",
    ),
    dict(
        nome="«Annulla» aggiunge lo stesso",
        file="js/progetto.js",
        da="      if (scelta) {",
        a="      if (true) {",
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
        nome="la finestrella non dice che il progetto porta il suo foglio",
        file="js/progetto.js",
        da="      ' su ' + quantiFogli(fg) + '. Sul piano adesso ' +",
        a="      '. Sul piano adesso ' +",
        vede="dice che porta il suo foglio",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il registro non dice che foglio si e' portato dietro",
        file="js/progetto.js",
        da="              : ', con ' + quantiFogli(portati) + ': ogni livello sul foglio su cui ' +",
        a="              : ': ogni livello sul foglio su cui ' +",
        vede="il registro racconta l'aggiunta",
        prova="prova-progetto.js",
    ),

    # ---- PIU' FOGLI SUL PIANO, fase 1: il modello (2026-11-07) ----
    dict(
        nome="il foglio di partenza non viene dal profilo di stampa",
        file="js/state.js",
        da="    w: Profile.stampa().foglio.larghezza,",
        a="    w: 210,",
        vede="quello del profilo di stampa",
        prova="prova-fogli.js",
    ),
    dict(
        nome="`paper` torna a essere una copia del foglio",
        file="js/state.js",
        da="""  Object.defineProperty(data, 'paper', {
    enumerable: true,
    get: foglio
  });""",
        a="""  Object.defineProperty(data, 'paper', {
    enumerable: true,
    get: function () {
      var f = foglio();
      return { id: f.id, w: f.w, h: f.h, name: f.name, colore: f.colore,
               origine: f.origine };
    }
  });""",
        vede="non una sua copia",
        prova="prova-fogli.js",
    ),
    dict(
        nome="`sheetOrigin` si legge ma non si scrive",
        file="js/state.js",
        da="    get: function () { return foglio().origine; },\n    set: function (v) { foglio().origine = { x: +v.x, y: +v.y }; }",
        a="    get: function () { return foglio().origine; }",
        vede="scrivere `sheetOrigin` intero",
        prova="prova-fogli.js",
    ),
    dict(
        nome="l'angolo misurato e' della pagina, non del foglio",
        file="js/state.js",
        da="    get: function () { return foglio().misurato; },\n    set: function (v) { foglio().misurato = !!v; }",
        a="    get: function () { return data.fogli[0].misurato; },\n    set: function (v) { data.fogli[0].misurato = !!v; }",
        vede="NON vale per quello accanto",
        prova="prova-fogli.js",
    ),
    dict(
        nome="l'origine e' sempre quella del primo foglio",
        file="js/state.js",
        da="    get: function () { return foglio().origine; },",
        a="    get: function () { return data.fogli[0].origine; },",
        vede="NON vale per quello accanto",
        prova="prova-fogli.js",
    ),
    dict(
        nome="cambiare foglio ricentra i disegni come un cambio di misura",
        file="js/artwork.js",
        da="      if (prima.id !== p.id) { refit(); return; }",
        a="",
        # Difeso in due posti: questa guardia ferma il ricentramento quando a
        # cambiare e' il foglio invece della sua misura, e il filtro qui
        # sotto fa in modo che il ricentramento tocchi solo i livelli del
        # foglio cambiato. Romperne uno solo lascia i disegni fermi, cioe'
        # simula un difetto che non e' un difetto.
        piu=[("js/artwork.js",
              "        if (l.foglio && l.foglio !== p.id) return;", "")],
        vede="non muove i disegni",
        prova="prova-fogli.js",
    ),
    dict(
        nome="il foglio nuovo si posa staccato invece che accanto",
        file="js/fogli.js",
        da="      candidati.push({ x: r.x1, y: r.y0 });       // a destra, stessa base",
        a="      candidati.push({ x: r.x1 + 5, y: r.y0 });   // a destra, staccato",
        vede="nasce accostato",
        prova="prova-fogli.js",
    ),
    dict(
        nome="gli agganci non si rileggono quando un foglio si sposta",
        file="js/fogli.js",
        da='       vicino torna a doversi misurare da solo, e nessuno glielo direbbe. */\n    rileggiAgganci();',
        a='       vicino torna a doversi misurare da solo, e nessuno glielo direbbe. */',
        vede="torna a doversi misurare da solo",
        prova="prova-fogli.js",
    ),
    dict(
        nome="un vertice in comune basta per dirsi accostati",
        file="js/fogli.js",
        da="  var AFFACCIO = 10;",
        a="  var AFFACCIO = 0;",
        vede="si sfiorano in un angolo",
        prova="prova-fogli.js",
    ),
    dict(
        nome="l'accostamento guarda anche avanti (e fa giri chiusi)",
        file="js/fogli.js",
        da='    if (i <= 0) return null;\n    var l = elenco(), f = l[i];\n    for (var j = 0; j < i; j++) {\n      if (accostati(f, l[j])) return l[j].id;\n    }',
        a='    var l = elenco(), f = l[i];\n    for (var j = 0; j < l.length; j++) {\n      if (j !== i && accostati(f, l[j])) return l[j].id;\n    }',
        vede="non gira in tondo",
        prova="prova-fogli.js",
    ),
    dict(
        nome="un foglio nuovo puo' nascere sopra un altro",
        file="js/fogli.js",
        da="""      if (x + w > r.x0 + GIOCO && x < r.x1 - GIOCO &&
          y + h > r.y0 + GIOCO && y < r.y1 - GIOCO) return false;""",
        a="",
        vede="senza sovrapporsi",
        prova="prova-fogli.js",
    ),
    dict(
        nome="toccarsi conta come sovrapporsi",
        file="js/fogli.js",
        da="""        if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > GIOCO &&
            Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > GIOCO) {""",
        a="""        if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= 0 &&
            Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= 0) {""",
        vede="non sono «sovrapposti»",
        prova="prova-fogli.js",
    ),
    dict(
        nome="un foglio fuori dalla corsa non viene nominato",
        file="js/fogli.js",
        da="""  function fuoriCorsa() {
    return elenco().filter(function (f) {""",
        a="""  function fuoriCorsa() {
    if (true) return [];
    return elenco().filter(function (f) {""",
        vede="esce dalla corsa viene nominato",
        prova="prova-fogli.js",
    ),
    dict(
        nome="si puo' togliere anche l'ultimo foglio",
        file="js/fogli.js",
        da="    if (l.length < 2) return false;",
        a="",
        vede="l'ultimo foglio non si toglie",
        prova="prova-fogli.js",
    ),
    dict(
        nome="togliendo un foglio gli agganci non si rileggono",
        file="js/fogli.js",
        da="       foglio che non c'è più. */\n    rileggiAgganci();",
        a="       foglio che non c'è più. */",
        vede="non resta orfano",
        prova="prova-fogli.js",
    ),

    # ---- PIU' FOGLI SUL PIANO, fase 2: il piano e i magneti (2026-11-07) ----
    dict(
        nome='il piano disegna solo il foglio in uso',
        file='js/paper.js',
        da='    State.data.fogli.forEach(function (f) {\n      var o = f.origine;',
        a='    [State.data.paper].forEach(function (f) {\n      var o = f.origine;',
        vede='disegna tutti i fogli',
        prova="prova-piano.js",
    ),
    dict(
        nome="nessun foglio e' segnato come quello in uso",
        file='js/paper.js',
        da="      if (f.id === attivo.id) cl += ' sheet-attivo';",
        a='',
        vede='uno solo e` quello in uso',
        prova="prova-piano.js",
    ),
    dict(
        nome='il foglio nuovo non si posa accanto',
        file='js/fogli.js',
        da='      candidati.push({ x: r.x1, y: r.y0 });       // a destra, stessa base',
        a='      candidati.push({ x: r.x1 + 30, y: r.y0 });',
        vede='posa il foglio nuovo accanto',
        prova="prova-piano.js",
    ),
    dict(
        nome='i magneti sono spenti',
        file='js/paper.js',
        da='    var tol = 8 * mmPerPixel();',
        a='    var tol = 0;',
        vede='porta il bordo ESATTO',
        prova="prova-piano.js",
    ),
    dict(
        nome="la tolleranza dei magneti e' in millimetri invece che in pixel",
        file='js/paper.js',
        da='    var tol = 8 * mmPerPixel();',
        a='    var tol = 8;',
        vede='da ingranditi i magneti',
        prova="prova-piano.js",
    ),
    dict(
        nome='le righe che spiegano il magnete non si disegnano',
        file='js/paper.js',
        da='    if (vx) guide.push({ x1: vx.r, y1: Math.min(0, y) - 20,\n                         x2: vx.r, y2: Math.max(a.h, y + f.h) + 20 });',
        a='',
        vede='si vede perche`',
        prova="prova-piano.js",
    ),
    dict(
        nome='le righe di guida restano dopo il gesto',
        file='js/paper.js',
        da='    guide = [];\n        /* Gli agganci si rileggono alla fine del gesto',
        a='    \n        /* Gli agganci si rileggono alla fine del gesto',
        vede='spariscono quando si lascia',
        prova="prova-piano.js",
    ),
    dict(
        nome='Alt non spegne i magneti',
        file='js/paper.js',
        da='    if (spenti) return { x: x, y: y };',
        a='',
        vede='Alt spegne i magneti',
        prova="prova-piano.js",
    ),
    dict(
        nome='anche un foglio misurato si trascina',
        file='js/paper.js',
        da='      if (!f || f.misurato) return;',
        a='      if (!f) return;',
        # «Il foglio misurato non si muove» e' scritto in due posti che devono
        # dire la stessa cosa: qui e nello sguardo, che altrimenti si prende
        # il trascinamento al posto suo. Vanno rotti insieme.
        piu=[('js/paper.js',
              '      if (!centrale && suo && !suo.misurato) return;',
              '      if (!centrale && suo) return;')],
        vede='misurato non si trascina',
        prova="prova-piano.js",
    ),
    dict(
        nome="la didascalia torna a rubare altezza al piano",
        file="css/components.css",
        da="  position: absolute;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  min-height: 30px;",
        a="  min-height: 30px;",
        vede="non cambia misura mentre si trascina",
        prova="prova-piano.js",
    ),
    dict(
        nome='un disegno caricato va sempre sul primo foglio',
        file='js/artwork.js',
        da='        foglio: State.data.foglioAttivo,\n        nome: (gruppi.length > 1',
        a='        foglio: State.data.fogli[0].id,\n        nome: (gruppi.length > 1',
        vede='va sul foglio in uso',
        prova="prova-piano.js",
    ),
    dict(
        nome='scegliere un livello non porta sul suo foglio',
        file='js/artwork.js',
        da='    var l = trova(scelto);\n    if (l && l.foglio && l.foglio !== State.data.foglioAttivo) Fogli.scegli(l.foglio);',
        a='    var l = trova(scelto);',
        vede='riporta sul suo foglio',
        prova="prova-piano.js",
    ),
    # TOLTA la mutazione «ogni livello si adatta al foglio in uso invece che
    # al suo»: il difetto che simulava non e' raggiungibile, perche' un
    # livello senza rettangolo e' un livello appena nato e nasce sul foglio
    # in uso. Una mutazione che non puo' cambiare il comportamento non
    # misura un controllo cieco: misura se' stessa. Il motivo per cui la
    # riga resta scritta com'e' sta nel commento in artwork.js, dove serve.
    dict(
        nome='scegliere un foglio lascia scelto un livello di un altro',
        file='js/artwork.js',
        da="      if (l && (l.foglio || fid) === fid) return;",
        a="      if (l) return;",
        vede='la scelta segue il foglio',
        prova="prova-piano.js",
    ),
    dict(
        nome="il G-code somma sempre l'angolo del foglio in uso",
        file='js/artwork.js',
        da='      var o = origini[fo[i]] || oAttiva;',
        a='      var o = oAttiva;',
        vede='il G-code disegna su tutti e due i fogli',
        prova="prova-piano.js",
    ),
    dict(
        nome="l'anteprima somma sempre l'angolo del foglio in uso",
        file='js/paper.js',
        da='    function ang(i) { return origini[fo[i]] || oAttiva; }',
        a='    function ang(i) { return oAttiva; }',
        vede='mette ogni disegno sul suo foglio',
        prova="prova-piano.js",
    ),
    dict(
        nome="l'ottimizzazione «tutto» rimescola i fogli",
        file='js/artwork.js',
        da='        var k = l.foglio || State.data.foglioAttivo;\n        if (!(k in perFoglio)) { perFoglio[k] = []; ordine.push(k); }',
        a="        var k = 'tutti';\n        if (!(k in perFoglio)) { perFoglio[k] = []; ordine.push(k); }",
        vede='«tutto»: e i gruppi',
        prova="prova-piano.js",
    ),
    dict(
        nome='togliendo un foglio se ne vanno anche i livelli degli altri',
        file='js/artwork.js',
        da='    livelli = livelli.filter(function (l) { return (l.foglio || null) !== fid; });',
        a='    livelli = [];',
        vede='e solo quelli',
        prova="prova-piano.js",
    ),

    # ---- PIU' FOGLI, fase 3: l'ordine, i marcatori, l'elenco (2026-11-07) ----
    dict(
        nome="l'ordine per penna non raggruppa niente",
        file='js/artwork.js',
        da='      gruppi = gruppi\n        .map(function (g, i) { return { g: g, i: i }; })\n        .sort(function (a, b) {\n          var d = chiavi.indexOf(a.g.penna) - chiavi.indexOf(b.g.penna);\n          return d || a.i - b.i;\n        })\n        .map(function (x) { return x.g; });',
        a='',
        vede='prima tutto il nero',
        prova='prova-ordine.js',
    ),
    dict(
        nome='per penna le fermate restano quelle delle spunte',
        file='js/artwork.js',
        da='      if (perPenna) {\n        if (i > 0 && g.penna !== gruppi[i - 1].penna) auto.push(art.length);\n      } else if (i > 0 && l && l.cambioPenna) auto.push(art.length);',
        a='      if (i > 0 && l && l.cambioPenna) auto.push(art.length);',
        vede='UNA fermata invece di tre',
        prova='prova-ordine.js',
    ),
    dict(
        nome='il marcatore del foglio non si scrive',
        file='js/gcode.js',
        da="      if (fogliA[i]) L.push(SEGNO_FOGLIO + ' ' + fogliA[i]);\n      if (penneA[i]) L.push(SEGNO_PENNA + ' ' + penneA[i]);",
        a="      if (penneA[i]) L.push(SEGNO_PENNA + ' ' + penneA[i]);",
        vede='dice su quale foglio sta andando',
        prova='prova-ordine.js',
    ),
    dict(
        nome='il marcatore del foglio viene dopo la penna',
        file='js/gcode.js',
        da="      if (fogliA[i]) L.push(SEGNO_FOGLIO + ' ' + fogliA[i]);\n      if (penneA[i]) L.push(SEGNO_PENNA + ' ' + penneA[i]);",
        a="      if (penneA[i]) L.push(SEGNO_PENNA + ' ' + penneA[i]);\n      if (fogliA[i]) L.push(SEGNO_FOGLIO + ' ' + fogliA[i]);",
        vede='PRIMA della penna',
        prova='prova-ordine.js',
    ),
    dict(
        nome='il marcatore del foglio si scrive a ogni gruppo',
        file='js/artwork.js',
        da='      if (g.polys.length && g.foglio !== ultimoFoglio) {',
        a='      if (g.polys.length) {',
        vede='quando il foglio CAMBIA',
        prova='prova-ordine.js',
    ),
    dict(
        nome="il selettore dell'ordine compare anche con un foglio solo",
        file='js/artwork.js',
        da='      if (w) w.hidden = State.data.fogli.length < 2;',
        a='      if (w) w.hidden = false;',
        vede='non compare',
        prova='prova-ordine.js',
    ),
    dict(
        nome="con «tutto» l'ordine per penna si ignora in silenzio",
        file='js/artwork.js',
        da='    if (vuole && !perPenna) {',
        a='    if (false) {',
        vede='invece di fare finta',
        prova='prova-ordine.js',
    ),
    dict(
        nome="l'elenco dei livelli non si divide per foglio",
        file='js/artwork.js',
        da=('    if (!piuFogli) {\n'
            '      livelli.forEach(function (x, i) { ordine.push({ liv: i }); });'),
        a=('    if (true) {\n'
           '      livelli.forEach(function (x, i) { ordine.push({ liv: i }); });'),
        vede='diviso per foglio',
        prova='prova-piano.js',
    ),
    dict(
        nome='i livelli di uno stesso foglio non si tengono insieme',
        file='js/artwork.js',
        da='    livelli = livelli\n      .map(function (l, i) { return { l: l, i: i }; })',
        a='    if (true) return;\n    livelli = livelli\n      .map(function (l, i) { return { l: l, i: i }; })',
        vede='stanno insieme anche se arrivano dopo',
        prova='prova-piano.js',
    ),
    dict(
        nome='trascinando su un altro foglio il livello non ci va',
        file='js/artwork.js',
        da='      if (cambia) l.foglio = fid;',
        a='',
        vede='trascinando un livello su un altro foglio',
        prova='prova-piano.js',
    ),
    dict(
        nome="lo sfondo dell'editor attraversa i fogli",
        file='js/artwork.js',
        da='      if (foglioDi(l).id !== mio) return;',
        a='',
        vede='non mostra i disegni degli altri fogli',
        prova='prova-piano.js',
    ),

    # ---- PIU' FOGLI, fase 3b: i popup di inizio stampa (2026-11-07) ----
    dict(
        nome="si chiede l'angolo di TUTTI i fogli, accostati compresi",
        file='js/popup.js',
        da='    daMisurare.forEach(function (f) {\n      passi.push(passoAngolo(f, daMisurare.length));\n    });',
        a='    State.data.fogli.forEach(function (f) {\n      passi.push(passoAngolo(f, State.data.fogli.length));\n    });',
        vede='quattro schermate, non di cinque',
        prova='prova-ordine.js',
    ),
    dict(
        nome="si chiede l'angolo di un foglio solo, come prima",
        file='js/popup.js',
        da='    daMisurare.forEach(function (f) {\n      passi.push(passoAngolo(f, daMisurare.length));\n    });',
        a='    passi.push(passoAngolo(daMisurare[0], 1));',
        vede='quattro schermate, non di cinque',
        prova='prova-ordine.js',
    ),
    dict(
        nome='la misura muove solo il foglio misurato, non la sua famiglia',
        file='js/fogli.js',
        da='    famiglia(id).forEach(function (g) {\n      g.origine = { x: g.origine.x + dx, y: g.origine.y + dy };\n      g.misurato = true;\n    });',
        a='    var f0 = trova(id);\n    f0.origine = { x: f0.origine.x + dx, y: f0.origine.y + dy };\n    f0.misurato = true;',
        vede='si muove tutta la famiglia',
        prova='prova-ordine.js',
    ),
    dict(
        nome="l'altezza si misura sempre una volta sola",
        file='js/popup.js',
        da='    if (carteDiverse()) {\n      State.data.fogli.forEach(function (f) { passi.push(passoAltezza(f)); });\n    } else {\n      passi.push(passoAltezza(null));\n    }',
        a='    passi.push(passoAltezza(null));',
        vede="un'altezza per foglio",
        prova='prova-ordine.js',
    ),
    dict(
        nome="l'altezza si misura sempre per foglio",
        file='js/popup.js',
        da='    if (carteDiverse()) {\n      State.data.fogli.forEach(function (f) { passi.push(passoAltezza(f)); });\n    } else {\n      passi.push(passoAltezza(null));\n    }',
        a='    State.data.fogli.forEach(function (f) { passi.push(passoAltezza(f)); });',
        vede='quattro schermate, non di cinque',
        prova='prova-ordine.js',
    ),
    dict(
        nome='la spunta delle carte diverse vale anche con un foglio solo',
        file='js/popup.js',
        da='    return !!(c && c.checked) && State.data.fogli.length > 1;',
        a='    return !!(c && c.checked);',
        vede='la spunta rimasta accesa non conta',
        prova='prova-ordine.js',
    ),
    dict(
        nome='le quote per foglio si scrivono anche quando le carte sono uguali',
        file='js/artwork.js',
        da='        if (!quote.some(function (q) { return q.suaSua; })) return [];',
        a='        if (false) return [];',
        vede='nessuna riga di quota',
        prova='prova-ordine.js',
    ),
    dict(
        nome='ogni foglio prende la quota generale invece della sua',
        file='js/artwork.js',
        da='                     suaSua: !!(ff && ff.cartaSua && ff.z !== null) });',
        a='                     suaSua: false });',
        vede='LA SUA quota',
        prova='prova-ordine.js',
    ),
    dict(
        nome='la quota si legge ma non si applica',
        file='js/gcode.js',
        da='      if (quoteA[i]) {\n        zDown = quoteA[i].down;\n        zUp = quoteA[i].up;',
        a='      if (quoteA[i]) {\n        zUp = quoteA[i].up;',
        vede='LA SUA quota',
        prova='prova-ordine.js',
    ),
    dict(
        nome="l'ingombro si controlla su tutti i fogli a ogni passo",
        file='js/popup.js',
        da='      if (soloQuesto && fid !== soloQuesto.id) continue;',
        a='',
        vede='non ferma la misura degli altri',
        prova='prova-ordine.js',
    ),
    dict(
        nome="l'ingombro non si ricontrolla prima di consegnare",
        file='js/popup.js',
        da='    if (!controllaIngombro()) return;\n    Artwork.prepare();',
        a='    Artwork.prepare();',
        vede='alla fine lo dice',
        prova='prova-ordine.js',
    ),

    # ---- PIU' FOGLI, fase 3c: la tab «In stampa» (2026-11-07) ----
    dict(
        nome='la tab disegna solo il primo foglio',
        file='js/stampe.js',
        da='    t.dati.fogli.forEach(function (p, k) {',
        a='    t.dati.fogli.slice(0, 1).forEach(function (p, k) {',
        vede='TUTTI i fogli del piano',
        prova='prova-stampe.js',
    ),
    dict(
        nome='la tab si porta via solo il foglio in uso',
        file='js/stampe.js',
        da='      fogli: State.data.fogli.map(function (f) {',
        a='      fogli: [State.data.paper].map(function (f) {',
        vede='TUTTI i fogli del piano',
        prova='prova-stampe.js',
    ),
    dict(
        nome='il marcatore del foglio non arriva al Sender',
        file='js/sender.js',
        da="      var mf = RE_FOGLIO.exec(l);\n      if (mf) {\n        out.push(FOGLIO + mf[1] + '\\u0000' + mf[2] + '\\u0000' + mf[3]);\n        continue;\n      }",
        a='',
        vede='su che foglio si va',
        prova='prova-stampe.js',
    ),
    dict(
        nome='la tab non legge i marcatori del foglio',
        file='js/stampe.js',
        da="        if (r.indexOf('\\u0000foglio:') === 0) {",
        a='        if (false) {',
        vede='su che foglio si va',
        prova='prova-stampe.js',
    ),
    dict(
        nome='si accende sempre il primo foglio',
        file='js/stampe.js',
        da="      r[i].classList.toggle('st-foglio-ora',\n        !!ora && viva(t) && +r[i].dataset.f === ora.n);",
        a="      r[i].classList.toggle('st-foglio-ora',\n        !!ora && viva(t) && +r[i].dataset.f === 1);",
        vede='non e` semplicemente il primo',
        prova='prova-stampe.js',
    ),
    dict(
        nome='non si accende nessun foglio',
        file='js/stampe.js',
        da="      r[i].classList.toggle('st-foglio-ora',\n        !!ora && viva(t) && +r[i].dataset.f === ora.n);",
        a='',
        vede='un foglio solo e` acceso',
        prova='prova-stampe.js',
    ),
    dict(
        nome='il riquadro dei dati dice sempre il primo foglio',
        file='js/stampe.js',
        da="    var ora = null;\n    for (var i = 0; i < t.perc.fogli.length; i++) {\n      if (t.perc.fogli[i].riga < t.fatte) ora = t.perc.fogli[i];\n    }\n    if (!ora) return fg.length + ' fogli sul piano';",
        a="    var ora = t.perc.fogli[0] || null;\n    if (!ora) return fg.length + ' fogli sul piano';",
        vede='quello che il riquadro dei dati dice',
        prova='prova-stampe.js',
    ),

    # ---- PIU' FOGLI, fase 3d: il telecomando (2026-11-07) ----
    dict(
        nome='il messaggio non porta il foglio',
        file='js/telecomando.js',
        da='      foglio: s.foglio && s.foglio.di > 1\n        ? { n: s.foglio.n, di: s.foglio.di } : null,',
        a='',
        vede='dice su quale si sta andando',
        prova='prova-telecomando.js',
    ),
    dict(
        nome="il foglio viaggia anche quando e' uno solo",
        file='js/telecomando.js',
        da='      foglio: s.foglio && s.foglio.di > 1\n        ? { n: s.foglio.n, di: s.foglio.di } : null,',
        a='      foglio: s.foglio ? { n: s.foglio.n, di: s.foglio.di } : null,',
        vede='con un foglio solo non lo dice',
        prova='prova-telecomando.js',
    ),
    dict(
        nome='il foglio che cambia aspetta il giro dopo',
        file='js/telecomando.js',
        da="    return [m.stato, m.passo, m.macchina, m.azzerata, m.giu, m.volume,\n            m.foglio ? m.foglio.n : ''].join('|');",
        a="    return [m.stato, m.passo, m.macchina, m.azzerata, m.giu, m.volume].join('|');",
        vede='il messaggio parte subito',
        prova='prova-telecomando.js',
    ),
    dict(
        nome='il Sender non ricorda su che foglio sta',
        file='js/sender.js',
        da="        foglio = { n: parseInt(f[0], 10), di: parseInt(f[1], 10), nome: f[2] || '' };",
        a="        foglio = { n: 0, di: 0, nome: '' };",
        vede='il Sender sa su che foglio sta',
        prova='prova-stampe.js',
    ),
    dict(
        nome='il firmware non legge il foglio dal messaggio',
        file='../schermo/telecomando/telecomando.ino',
        da='  S.foglioN = 0;\n  S.foglioDi = 0;\n  const char* pf = trova(corpo, "foglio");',
        a='  S.foglioN = 0;\n  S.foglioDi = 0;\n  const char* pf = nullptr;',
        vede='non si legge dal messaggio',
        prova='vetro.sh',
    ),
    dict(
        nome='un messaggio senza foglio lascia quello di prima',
        file='../schermo/telecomando/telecomando.ino',
        da='  S.foglioN = 0;\n  S.foglioDi = 0;\n  const char* pf = trova(corpo, "foglio");',
        a='  const char* pf = trova(corpo, "foglio");',
        vede='non azzera quello di prima',
        prova='vetro.sh',
    ),
    dict(
        nome="il vetro scrive il foglio anche quando e' uno solo",
        file='../schermo/telecomando/telecomando.ino',
        da='bool diceIlFoglio() { return S.foglioDi >= 2 && S.foglioN >= 1; }',
        a='bool diceIlFoglio() { return S.foglioDi >= 1 && S.foglioN >= 1; }',
        vede='non scrive su che foglio sta',
        prova='vetro.sh',
    ),
    # TOLTA IL 2026-11-09: «la schermata non si alza per far posto al
    # foglio». Descriveva come difetto quello che adesso e' il
    # comportamento giusto — la schermata non si alza piu', perche' la
    # targhetta del foglio e' andata nell'angolo in alto a destra e non
    # spinge piu' niente. Il suo `a` era parola per parola il codice di
    # oggi. Chi la cerca: `git show` di questo commit.
    dict(
        nome='il vetro non scrive su che foglio sta',
        file='../schermo/telecomando/telecomando.ino',
        da='      scriviFoglio(74);',
        a='',
        vede='non scrive su che foglio sta',
        prova='vetro.sh',
    ),
    dict(
        nome="il vetro non si rifa' quando il foglio cambia",
        file='../schermo/telecomando/telecomando.ino',
        da='         S.foglioN != foglioDisegnato;',
        a='         false;',
        vede='il vetro non si rifa',
        prova='vetro.sh',
    ),
    # ---- PIU' FOGLI SUL PIANO, fase 5: il progetto salvato (2026-11-07) ----
    dict(
        nome="il livello non dice su che foglio sta",
        file="js/artwork.js",
        da="          foglio: i === undefined ? 0 : i,",
        a="          foglio: 0,",
        vede="ogni livello dice su quale sta",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il disegno nel file resta in coordinate del suo foglio",
        file="js/progetto.js",
        da="      var dx = o.x - q.x, dy = o.y - q.y;",
        a="      var dx = 0, dy = 0;",
        vede="ogni disegno sta nel pezzo di riquadro",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il disegno nel file si porta dentro l'angolo del foglio",
        file="js/progetto.js",
        da="      var dx = o.x - q.x, dy = o.y - q.y;",
        a="      var dx = o.x, dy = o.y;",
        vede="niente angolo nei numeri",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il riquadro del file e' il primo foglio invece di tutti",
        file="js/progetto.js",
        da="    var q = riquadro(fg);",
        a="    var q = riquadro([fg[0]]);",
        vede="il riquadro del file contiene tutti i fogli",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il file non salva l'elenco dei fogli",
        file="js/progetto.js",
        da="""      fogli: fg.map(function (f) {
        /* `nomeMio` viaggia col nome, e senza di lui il nome non durerebbe:
           riaprendo, il primo ridisegno rimetterebbe quello del formato
           (vedi `apply()` in paper.js). Una chiave in più non cambia il
           formato del file: una pagina che non la conosce la ignora, e un
           file che non ce l'ha vale come «no». */
        return { w: f.w, h: f.h, nome: f.name || null, nomeMio: !!f.nomeMio,
                 angolo: { x: f.origine.x, y: f.origine.y } };
      }),""",
        a="      fogli: [],",
        vede="il file salva tutti i fogli",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il file smette di dire del primo foglio al formato 1",
        file="js/progetto.js",
        da="      foglio: { w: fg[0].w, h: fg[0].h, nome: fg[0].name || null },",
        a="",
        vede="le chiavi del formato 1 restano",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il livello arrivato va sul foglio in uso invece che sul suo",
        file="js/artwork.js",
        da="        foglio: (fogli && fogli[+d.foglio || 0]) || State.data.foglioAttivo,",
        a="        foglio: State.data.foglioAttivo,",
        vede="il progetto si porta dietro il suo foglio",
        prova="prova-progetto.js",
    ),
    dict(
        nome="dopo aver aggiunto si resta a guardare il foglio di prima",
        file="js/progetto.js",
        da="    if (primo) Fogli.scegli(primo);",
        a="",
        vede="il progetto si porta dietro il suo foglio",
        prova="prova-progetto.js",
    ),
    dict(
        # DUE TAGLI DAL 2026-11-08, e il secondo e' la ragione per cui questa
        # mutazione era tornata invisibile: `applica` chiama `Paper.setSize`
        # subito dopo per far ridisegnare tutto, e da quel giorno setSize
        # rilegge gli agganci da se' — gli servono, perche' cambiare le
        # misure di un foglio cambia chi tocca chi. Togliendo solo la riga
        # di progetto.js il programma restava corretto: la mutazione non
        # misurava piu' il controllo, misurava se stessa.
        nome="sostituendo, gli agganci non si rileggono",
        file="js/progetto.js",
        da="""    State.data.foglioAttivo = nuovi[0].id;
    Fogli.rileggiAgganci();""",
        a="    State.data.foglioAttivo = nuovi[0].id;",
        piu=[("js/paper.js",
              "    f.h = h;\n    Fogli.rileggiAgganci();",
              "    f.h = h;")],
        vede="di nuovo accostato al primo",
        prova="prova-progetto.js",
    ),
    dict(
        nome="l'aggancio non guarda se i due fogli si toccano davvero",
        file="js/fogli.js",
        da="      if (accostati(f, l[j])) return l[j].id;",
        a="      return l[j].id;",
        vede="gli angoli da misurare diventano due",
        prova="prova-progetto.js",
    ),
    dict(
        nome="i fogli che arrivano si posano uno per volta",
        file="js/progetto.js",
        da="""      var n = State.nuovoFoglio({ w: f.w, h: f.h, name: f.nome,
                                  nomeMio: f.nomeMio,
                                  x: f.angolo.x + d.dx, y: f.angolo.y + d.dy });""",
        a="""      var sola = Fogli.posaLibera(f.w, f.h);
      var n = State.nuovoFoglio({ w: f.w, h: f.h, name: f.nome,
                                  nomeMio: f.nomeMio,
                                  x: sola.x, y: sola.y });""",
        vede="il gruppo di fogli si posa tutto insieme",
        prova="prova-progetto.js",
    ),
    dict(
        nome="aggiungendo, gli agganci non si rileggono",
        file="js/progetto.js",
        da="""    Fogli.rileggiAgganci();
    return { mappa: mappa, posa: d };""",
        a="    return { mappa: mappa, posa: d };",
        vede="restano accostati: una misura e non due",
        prova="prova-progetto.js",
    ),
    dict(
        nome="la misura di oggi si sovrascrive con l'angolo del file",
        file="js/progetto.js",
        da="    if (stessoPiano(fg) && misurato) {",
        a="    if (false) {",
        vede="restano dove li ha messi la macchina",
        prova="prova-progetto.js",
    ),
    dict(
        nome="la misura si tiene anche su un piano che non e' quello",
        file="js/progetto.js",
        da="    if (stessoPiano(fg) && misurato) {",
        a="    if (misurato) {",
        vede="vincono gli angoli del file",
        prova="prova-progetto.js",
    ),
    dict(
        nome="sostituendo, i fogli del file si aggiungono a quelli che c'erano",
        file="js/progetto.js",
        da="    State.data.fogli = nuovi;",
        a="    State.data.fogli = ora.concat(nuovi);",
        vede="sul piano resta solo il suo",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il gruppo che non ci sta si posa SOPRA invece che di fianco",
        file="js/fogli.js",
        da="    return { dx: destra - x0, dy: -y0, dentro: false, piuGrande: piuGrande };",
        a="    return { dx: -x0, dy: -y0, dentro: false, piuGrande: piuGrande };",
        vede="va di fianco, non sopra",
        prova="prova-progetto.js",
    ),
    dict(
        nome="la posa dice sempre che il gruppo ci sta",
        file="js/fogli.js",
        da="    return { dx: destra - x0, dy: -y0, dentro: false, piuGrande: piuGrande };",
        a="    return { dx: destra - x0, dy: -y0, dentro: true, piuGrande: piuGrande };",
        vede="lo dice prima di scegliere",
        prova="prova-progetto.js",
    ),
    dict(
        nome="«piu' grande della corsa» si confonde con «non c'e' piu' posto»",
        file="js/fogli.js",
        da="    var piuGrande = w > a.w || h > a.h;",
        a="    var piuGrande = false;",
        vede="un A4 non ci sta nella corsa percorribile",
        prova="prova-progetto.js",
    ),
    dict(
        nome="la nota del posto non compare nella finestrella",
        file="js/progetto.js",
        da="    nota.hidden = !guaio;",
        a="    nota.hidden = true;",
        vede="lo dice prima di scegliere",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il posto che manca si dice fra i messaggi invece che fra gli avvisi",
        file="js/progetto.js",
        da="    if (guaio) Log.add('err', 'Attenzione: ' + guaio);",
        a="    if (guaio) Log.add('msg', 'Attenzione: ' + guaio);",
        vede="lo ridice fra gli avvisi",
        prova="prova-progetto.js",
    ),
    dict(
        nome="la nota compare anche quando nella corsa c'e' posto",
        file="js/progetto.js",
        da="    if (d.dentro) return null;",
        a="    if (false) return null;",
        vede="quando nella corsa c'e` posto non si dice niente",
        prova="prova-progetto.js",
    ),
    dict(
        nome="un progetto del formato 1 perde il suo foglio",
        file="js/progetto.js",
        da="    var u = dati.foglio || { w: State.data.paper.w, h: State.data.paper.h };",
        a="    var u = { w: State.data.paper.w, h: State.data.paper.h };",
        vede="formato 1 si apre ancora",
        prova="prova-progetto.js",
    ),
    dict(
        nome="sullo stesso piano arriva altra carta lo stesso",
        file="js/progetto.js",
        da="    if (d.sopra) {",
        a="    if (false) {",
        vede="si appoggiano davvero: un foglio solo",
        prova="prova-progetto.js",
    ),
    dict(
        nome="«lo stesso piano» non guarda le misure, solo quanti sono",
        file="js/progetto.js",
        da="""    return ora.length === fg.length && ora.every(function (f, i) {
      return stessaMisura(f, fg[i]);
    });""",
        a="    return ora.length === fg.length;",
        vede="il progetto si porta dietro il suo foglio",
        prova="prova-progetto.js",
    ),
    dict(
        nome="la finestrella non dice che i livelli si appoggiano",
        file="js/progetto.js",
        da="        : (posa.sopra",
        a="        : (false",
        vede="la finestrella dice che i livelli si appoggiano",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il registro non dice che non e' arrivata altra carta",
        file="js/progetto.js",
        da="            (esito.posa.sopra",
        a="            (false",
        vede="il registro dice che non e` arrivata altra carta",
        prova="prova-progetto.js",
    ),

    # ---- LA SCELTA DEI LIVELLI (Step 11, 2026-11-08) ----
    dict(
        nome="la scelta compare anche con un livello solo",
        file="js/progetto.js",
        da="    sc.hidden = v.dati.livelli.length < 2;",
        a="    sc.hidden = false;",
        vede="con un livello solo la scelta non compare",
        prova="prova-progetto.js",
    ),
    dict(
        nome="si prendono tutti lo stesso, spunte o no",
        file="js/progetto.js",
        da="        applica(conSoloScelti(v), v.nome, scelta === 'aggiungi');",
        a="        applica(v.dati, v.nome, scelta === 'aggiungi');",
        vede="arrivano SOLO i due scelti",
        prova="prova-progetto.js",
    ),
    dict(
        nome="arrivano tutti i fogli, anche quelli senza livelli scelti",
        file="js/progetto.js",
        da="    fg.forEach(function (f, i) { if (usa[i]) out.push(i); });",
        a="    fg.forEach(function (f, i) { out.push(i); });",
        vede="arrivano due fogli soli, non tre",
        prova="prova-progetto.js",
    ),
    dict(
        nome="i pulsanti restano accesi senza nessun livello preso",
        file="js/progetto.js",
        da="    agg.disabled = !quanti;",
        a="    agg.disabled = false;",
        vede="i due pulsanti si spengono",
        prova="prova-progetto.js",
    ),
    dict(
        nome="Invio fa quello che il pulsante spento non fa",
        file="js/progetto.js",
        da="    if (scelta && !presi(coda[0]).length) return;",
        a="",
        vede="Invio non fa quello che il pulsante spento non fa",
        prova="prova-progetto.js",
    ),
    dict(
        nome="«Nessuno» li prende tutti",
        file="js/progetto.js",
        da="      .addEventListener('click', function () { tutte(false); });",
        a="      .addEventListener('click', function () { tutte(true); });",
        vede="i due pulsanti si spengono",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il conto e i pulsanti non si rifanno a ogni spunta",
        file="js/progetto.js",
        da="""        if (riga) riga.classList.toggle('spenta', !c.checked);
        aggiorna();""",
        a="        if (riga) riga.classList.toggle('spenta', !c.checked);",
        vede="il conto e i pulsanti dicono quanti ne restano",
        prova="prova-progetto.js",
    ),
    dict(
        nome="un progetto in coda eredita la spunta di quello prima",
        file="js/progetto.js",
        da="      v.scelti = v.dati.livelli.map(function () { return true; });",
        a="      v.scelti = v.dati.livelli.map(function (l, i) { return i === 0; });",
        vede="parte con tutti i suoi presi",
        prova="prova-progetto.js",
    ),
    dict(
        nome="il registro non dice quanti livelli hai lasciato nel file",
        file="js/progetto.js",
        da="        if (pre < tot) {",
        a="        if (false) {",
        vede="quanti ne hai lasciati",
        prova="prova-progetto.js",
    ),

    # ---- RUOTA E SCALA NELL'EDITOR (2026-11-08) ----
    dict(
        nome="ruota attorno all'origine invece che al centro",
        file="js/editor.js",
        da="""    var m = { a: co, b: si, c: -si, d: co,
              e: g.cx - co * g.cx + si * g.cy,
              f: g.cy - si * g.cx - co * g.cy };""",
        a="    var m = { a: co, b: si, c: -si, d: co, e: 0, f: 0 };",
        vede="la scatola gira sul posto",
        prova="prova-editor.js",
    ),
    dict(
        nome="ruota dalla parte sbagliata",
        file="js/editor.js",
        da="    var a = gradi * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);",
        a="    var a = -gradi * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);",
        vede="gira in senso orario",
        prova="prova-editor.js",
    ),
    dict(
        nome="scala attorno all'origine invece che al centro",
        file="js/editor.js",
        da="""    var m = { a: k, b: 0, c: 0, d: k,
              e: g.cx - k * g.cx, f: g.cy - k * g.cy };""",
        a="    var m = { a: k, b: 0, c: 0, d: k, e: 0, f: 0 };",
        vede="attorno al centro",
        prova="prova-editor.js",
    ),
    dict(
        nome="un giro intero fa comunque qualcosa",
        file="js/editor.js",
        da="    if (!(gradi % 360)) {",
        a="    if (false) {",
        vede="non toccano niente",
        prova="prova-editor.js",
    ),
    dict(
        nome="lo zero per cento passa, e il disegno sparisce in un punto",
        file="js/editor.js",
        da="    if (pc <= 0) {",
        a="    if (pc < 0) {",
        vede="non toccano niente",
        prova="prova-editor.js",
    ),
    dict(
        nome="un testo ruotato resta testo, e si raddrizza da se'",
        file="js/editor.js",
        da="    var testi = applicaMatrice(g, m, true);",
        a="    var testi = applicaMatrice(g, m, false);",
        vede="ruotato diventa tracciati",
        prova="prova-editor.js",
    ),
    dict(
        nome="un testo ingrandito diventa tracciati per niente",
        file="js/editor.js",
        da="    applicaMatrice(g, m, false);",
        a="    applicaMatrice(g, m, true);",
        vede="un testo ingrandito resta un testo",
        prova="prova-editor.js",
    ),
    dict(
        nome="ruota e scala non si possono annullare",
        file="js/editor.js",
        da="""  function applicaMatrice(g, m, testiInTracciati) {
    segna();""",
        a="""  function applicaMatrice(g, m, testiInTracciati) {""",
        vede="l'annulla disfa una rotazione",
        prova="prova-editor.js",
    ),

    # ---- RINOMINARE LIVELLI E FOGLI (2026-11-08) ----
    dict(
        nome="un clic solo sul nome rinomina",
        file="js/artwork.js",
        da="""          if (window.Nome && Nome.doppio('liv:' + d.nome)) rinominaLivello(d.nome);
          else seleziona(d.nome);""",
        a="          rinominaLivello(d.nome);",
        vede="un clic solo sul nome non apre niente",
        prova="prova-nomi.js",
    ),
    dict(
        nome="i due clic non si contano a mano (torna il dblclick del browser)",
        file="js/nome.js",
        da="    var si = ultimo.chi === chi && (t - ultimo.t) < 450;",
        a="    var si = false;",
        vede="due clic sul nome aprono la finestrella",
        prova="prova-nomi.js",
    ),
    dict(
        nome="il nome non si ripulisce dagli spazi",
        file="js/nome.js",
        da="    return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().slice(0, MAX);",
        a="    return String(s == null ? '' : s).slice(0, MAX);",
        vede="il nome si ripulisce dagli spazi",
        prova="prova-nomi.js",
    ),
    dict(
        nome="un nome vuoto cancella il nome del livello",
        file="js/artwork.js",
        da="        if (!nuovo || nuovo === l.nome) {",
        a="        if (false) {",
        vede="un nome vuoto lascia il livello com'era",
        prova="prova-nomi.js",
    ),
    dict(
        nome="il foglio rinominato non si segna di esserlo",
        file="js/paper.js",
        da="        f.nomeMio = !!nuovo;",
        a="        f.nomeMio = false;",
        vede="si segna che il nome l'hai messo tu",
        prova="prova-nomi.js",
    ),
    dict(
        nome="il ridisegno riscrive il nome del foglio dal formato",
        file="js/paper.js",
        da="    if (!State.data.paper.nomeMio) {",
        a="    if (true) {",
        vede="non glielo ributta via",
        prova="prova-nomi.js",
    ),
    dict(
        nome="il file non salva che il nome del foglio l'hai messo tu",
        file="js/progetto.js",
        da="        return { w: f.w, h: f.h, nome: f.name || null, nomeMio: !!f.nomeMio,",
        a="        return { w: f.w, h: f.h, nome: f.name || null, nomeMio: false,",
        vede="il foglio pure, anche dopo un ridisegno",
        prova="prova-nomi.js",
    ),
    dict(
        nome="Esc conferma invece di lasciar stare",
        file="js/nome.js",
        da="      if (e.key === 'Escape') { e.preventDefault(); chiudi(); }",
        a="      if (e.key === 'Escape') { e.preventDefault(); conferma(this.value); }",
        vede="Esc chiude senza rinominare",
        prova="prova-nomi.js",
    ),
    dict(
        nome="«Rimetti» conferma quello che c'e' scritto nel campo",
        file="js/nome.js",
        da="    el('nome-vuoto').addEventListener('click', function () { conferma(''); });",
        a="    el('nome-vuoto').addEventListener('click', function () { conferma(el('nome-campo').value); });",
        vede="torna al nome del formato",
        prova="prova-nomi.js",
    ),
    dict(
        nome="il nome del foglio non entra nel marcatore del programma",
        file="js/artwork.js",
        da="""          nome: ff ? (ff.name && ff.name !== 'Personalizzato'
                       ? ff.name : ff.w + 'x' + ff.h) : ''""",
        a="          nome: ''",
        vede="finisce nel programma",
        prova="prova-nomi.js",
    ),
    dict(
        nome="la colonna dell'editor non si rifa' dopo la rinomina",
        file="js/artwork.js",
        da="        if (window.Editor && Editor.rinfresca) Editor.rinfresca();",
        a="",
        vede="la colonna dell'editor lo riscrive subito",
        prova="prova-nomi.js",
    ),
    dict(
        nome="la fermata che manca colora anche la matita",
        file="css/components.css",
        da=""".liv-penna.manca {
  box-shadow: inset 0 0 0 1px var(--warn);""",
        a=""".liv-penna.manca {
  color: var(--warn);
  box-shadow: inset 0 0 0 1px var(--warn);""",
        vede="lasciando la matita del suo colore",
        prova="prova-penne.js",
    ),
    dict(
        nome="l'anteprima non sa su che foglio sta ogni tratto",
        file="js/artwork.js",
        da="    State.data.artDi = di;\n    State.data.artFoglio = fo;",
        a="    State.data.artDi = di;",
        vede="casca sul secondo foglio",
        prova="prova-piano.js",
    ),
    dict(
        nome="l'anteprima mette tutti i tratti sul foglio in uso",
        file="js/paper.js",
        da="    function ang(i) { return origini[fo[i]] || oAttiva; }",
        a="    function ang(i) { return oAttiva; }",
        vede="non sposta il disegno che sta su un altro",
        prova="prova-piano.js",
    ),
    dict(
        nome="l'anteprima mette tutti i tratti sul foglio del primo",
        file="js/paper.js",
        da="    function ang(i) { return origini[fo[i]] || oAttiva; }",
        a="    function ang(i) { return origini[fo[0]] || oAttiva; }",
        vede="cadono su due fogli diversi",
        prova="prova-piano.js",
    ),

    # ---- L'ELENCO DELL'EDITOR: tutti i fogli, tutti i livelli (2026-11-08) ----
    dict(
        nome="l'editor torna a mostrare solo il foglio in uso",
        file="js/editor.js",
        da="    var ls = Artwork.livelli();\n    if (!ls.length) { box.innerHTML = ''; return; }",
        a="""    var ls = Artwork.livelli().filter(function (x) {
      return (x.foglio || State.data.foglioAttivo) === State.data.foglioAttivo;
    });
    if (!ls.length) { box.innerHTML = ''; return; }""",
        vede="mostra tutti i livelli, divisi per foglio",
        prova="prova-piano.js",
    ),
    dict(
        nome="nell'editor sono accese le intestazioni di tutti i fogli",
        file="js/editor.js",
        da="        out += '<div class=\"ed-foglio' + (tf === inUso ? ' in-uso' : '') +",
        a="        out += '<div class=\"ed-foglio' + ' in-uso' +",
        vede="accende quella del foglio in uso",
        prova="prova-piano.js",
    ),
    dict(
        nome="le righe dell'editor non si trascinano",
        file="js/editor.js",
        da="      if (window.Artwork && Artwork.riordinabile) Artwork.riordinabile(elenco);",
        a="",
        vede="trascinando dall'elenco dell'editor",
        prova="prova-piano.js",
    ),
    dict(
        nome="il riordino non ridisegna la colonna dell'editor",
        file="js/artwork.js",
        da="""  function ridisegnaElenchi() {
    renderElenco();
    if (window.Editor && Editor.rinfresca) Editor.rinfresca();
  }""",
        a="""  function ridisegnaElenchi() {
    renderElenco();
  }""",
        vede="trascinando dall'elenco dell'editor",
        prova="prova-piano.js",
    ),
    # ---- IL CURSORE DEL VOLUME CHE MENTIVA (2026-11-09) ----
    dict(
        nome='il cursore del volume si legge una volta sola, alla partenza',
        file='js/settings.js',
        da="""      allinea();
      State.on('telecomando', allinea);""",
        a="""      vol.value = String(Telecomando.volume());
      notaVolume(Telecomando.volume());""",
        vede='il cursore del volume mostra quello salvato',
        prova='prova-telecomando.js',
    ),
    dict(
        nome='il volume non viaggia nel segnale',
        file='js/telecomando.js',
        da='      volume: volume,\n      volumeVero: volumeVero,',
        a='',
        vede='il cursore del volume mostra quello salvato',
        prova='prova-telecomando.js',
    ),
    dict(
        nome="nessuno legge il volume che il telecomando rimanda",
        file='js/settings.js',
        da='      if (typeof vero === \'number\' && vero !== v) {',
        a='      if (false) {',
        vede='dice quando il telecomando ne ha un altro',
        prova='prova-telecomando.js',
    ),

    # ---- LA SCHERMATA DELLA STAMPA CON PIU' FOGLI (2026-11-09) ----
    dict(
        nome="l'aggiornamento del numero scrive a una quota sua",
        file='../schermo/telecomando/telecomando.ino',
        da='      int y = quotaPercento();',
        a='      int y = 82;',
        vede='non torna come lo disegnerebbe un giro intero',
        prova='vetro.sh',
    ),
    dict(
        # Il numero grande spostato in GIU' invece che in su: i corridoi
        # sono due, e uno solo provato non dice niente dell'altro.
        nome="la percentuale scende sull'etichetta dello STOP",
        file='../schermo/telecomando/telecomando.ino',
        da='int quotaPercento() { return 96; }',
        a='int quotaPercento() { return 110; }',
        vede="fra la percentuale e l'etichetta dello STOP non c'e' corridoio",
        prova='vetro.sh',
    ),
    dict(
        nome='la percentuale torna a stare addosso a PAUSA',
        file='../schermo/telecomando/telecomando.ino',
        da='int quotaPercento() { return 96; }',
        a='int quotaPercento() { return 82; }',
        vede='si toccano',
        prova='controlla.sh',
    ),
    dict(
        nome='la targhetta del foglio torna in mezzo al vetro',
        file='../schermo/telecomando/telecomando.ino',
        da='      scriviFoglio(74);',
        a='      scriviFoglio(132);',
        vede="non e' nell'angolo in alto a destra",
        prova='vetro.sh',
    ),
    dict(
        # La targhetta alla quota giusta ma CENTRATA invece che nell'angolo:
        # i corridoi restano liberi — sta fra loro — e quello che si accorge
        # e' solo il controllo che la cerca dove deve stare.
        nome="la targhetta del foglio centrata invece che nell'angolo",
        file='../schermo/telecomando/telecomando.ino',
        da='  carrier.display.setCursor((CX + dx) - w, y);',
        a='  carrier.display.setCursor(CX - w / 2, y);',
        vede="non e' nell'angolo in alto a destra",
        prova='vetro.sh',
    ),

    # ---- IL CICALINO CHE PIANTAVA IL TELECOMANDO (2026-11-09) ----
    dict(
        # Questa mutazione NON fa fallire il collaudo: lo fa PIANTARE,
        # perche' rimette il giro senza uscita ed e' li' che il controllo
        # entra. Vale lo stesso: dal 2026-11-09 un collaudo che non
        # finisce entro il tempo massimo conta come visto.
        nome="l'attesa del timer torna senza uscita",
        file='../schermo/telecomando/telecomando.ino',
        da="""static bool sincroTCC0() {
  for (int i = 0; i < 20000; i++) {
    if (!TCC0->SYNCBUSY.reg) return true;
  }
  return false;
}""",
        a="""static bool sincroTCC0() {
  while (TCC0->SYNCBUSY.reg) { }
  return true;
}""",
        vede='il timer non rispondeva',
        prova='vetro.sh',
    ),
    dict(
        nome='caduto il PWM, il cicalino resta muto',
        file='../schermo/telecomando/telecomando.ino',
        da='  if (!sincroTCC0()) { tornaATone("periodo"); carrier.Buzzer.sound(hz); return; }',
        a='  if (!sincroTCC0()) { tornaATone("periodo"); return; }',
        vede="e' rimasto muto invece di suonare pieno",
        prova='vetro.sh',
    ),
    dict(
        nome='dopo la caduta il PWM si riprova a ogni nota',
        file='../schermo/telecomando/telecomando.ino',
        da='  if (volumeCicalino >= 10 || pwmRotto) {',
        a='  if (volumeCicalino >= 10) {',
        vede='dopo la caduta riprova il PWM',
        prova='vetro.sh',
    ),

    # ---- IL TASTO CHE CHIUDE IL RACCONTO DI FINE STAMPA (2026-11-09) ----
    dict(
        nome="il racconto si chiude solo col tempo, non col tasto",
        file='../schermo/telecomando/telecomando.ino',
        da='bool raccontoFinito() { return raccontoChiuso || raccontoScaduto(); }',
        a='bool raccontoFinito() { return raccontoScaduto(); }',
        vede='il tasto non chiude il racconto della fine',
        prova='vetro.sh',
    ),
    dict(
        nome='le schermate di fine stampa tornano senza tasti',
        file='../schermo/telecomando/telecomando.ino',
        da="""    case FINE:
    case FERMATA:
      out[0] = { ALTO_SX, "OK", BLU, "", "", true };
      return 1;""",
        a='',
        vede='il tasto non chiude il racconto della fine',
        prova='vetro.sh',
    ),
    dict(
        nome='il tasto c\'e` sulla fine ma non sulla fermata',
        file='../schermo/telecomando/telecomando.ino',
        da="""    case FINE:
    case FERMATA:
      out[0] = { ALTO_SX, "OK", BLU, "", "", true };""",
        a="""    case FINE:
      out[0] = { ALTO_SX, "OK", BLU, "", "", true };""",
        vede='il tasto non chiude il racconto della fermata',
        prova='vetro.sh',
    ),
    dict(
        nome="il tasto che chiude torna a essere un tasto qualunque",
        file='../schermo/telecomando/telecomando.ino',
        da="""    if (t[i].chiude) {""",
        a="""    if (false) {""",
        vede='il tasto non chiude il racconto della fine',
        prova='vetro.sh',
    ),
    dict(
        nome='il racconto chiuso una volta resta chiuso per sempre',
        file='../schermo/telecomando/telecomando.ino',
        da='                 ? millis() : 0;\n    raccontoChiuso = false;',
        a='                 ? millis() : 0;',
        vede="chiuso una volta, la fine non si vede mai piu'",
        prova='vetro.sh',
    ),
    dict(
        nome='qualunque pad preme qualunque tasto',
        file='../schermo/telecomando/telecomando.ino',
        da='    if (!carrier.Buttons.onTouchDown(padDi(t[i].dove))) continue;',
        a='    if (!carrier.Buttons.onTouchDown(padDi(BASSO_DX))) continue;',
        vede='un pad qualunque chiude il racconto',
        prova='vetro.sh',
    ),
    # La geometria del vetro la guarda controlla.sh, non vetro.sh: sono due
    # banchi diversi sullo stesso firmware, e questa mutazione serve a
    # provare che il controllo della geometria conosce la pila e i simboli
    # — cioe' le due cose su cui questo tasto stava per finire sopra.
    dict(
        nome='il tasto di fine stampa messo in basso, sopra alla pila',
        file='../schermo/telecomando/telecomando.ino',
        da='      out[0] = { ALTO_SX, "OK", BLU, "", "", true };',
        a='      out[0] = { BASSO, "OK", BLU, "", "", true };',
        vede='si toccano',
        prova='controlla.sh',
    ),
    dict(
        nome='la parola lunga del tasto, addosso al simbolo',
        file='../schermo/telecomando/telecomando.ino',
        da='      out[0] = { ALTO_SX, "OK", BLU, "", "", true };',
        a='      out[0] = { ALTO_SX, "CHIUDI", BLU, "", "", true };',
        vede='si toccano',
        prova='controlla.sh',
    ),

    # ---- LA SCHEDA DEI FOGLI: preset, misure, matita, cestino (2026-11-08) ----
    dict(
        nome="la scheda torna a chiamarsi «Foglio»",
        file='index.html',
        da='<h2>Preset fogli</h2>',
        a='<h2>Foglio</h2>',
        vede='si chiama «Preset fogli»',
        prova='prova-piano.js',
    ),
    dict(
        nome='i fogli del piano senza il loro sottotitolo',
        file='index.html',
        da='        <h3>Fogli</h3>\n',
        a='',
        vede='si chiama «Preset fogli»',
        prova='prova-piano.js',
    ),
    dict(
        nome='il «+» fuori dalla riga delle misure',
        file='index.html',
        da=('          <button class="btn btn-ghost preset-add" id="btn-paper-add">+</button>\n'
            '        </div>\n'),
        a=('        </div>\n'
           '        <button class="btn btn-ghost preset-add" id="btn-paper-add">+</button>\n'),
        vede='le misure stanno fra i preset e i fogli',
        prova='prova-piano.js',
    ),
    dict(
        # Nascondere i due campi non e' la regressione da temere: e' che
        # tornino DOVE STAVANO, sotto ai fogli del piano, dove nessuno
        # capisce che il «+» accanto a loro aggiunge un foglio. Si toglie il
        # blocco da dov'e' e lo si rimette la' sotto: due tagli in una
        # mutazione sola, ed e' a questo che serve `piu`.
        nome='le misure tornano sotto ai fogli del piano',
        file='index.html',
        da=MISURE,
        a='',
        piu=[('index.html',
              '        <p class="fogli-nota" id="fogli-nota"></p>\n',
              '        <p class="fogli-nota" id="fogli-nota"></p>\n' + MISURE)],
        vede='le misure stanno fra i preset e i fogli',
        prova='prova-piano.js',
    ),
    dict(
        nome='torna la crocetta sul fianco della pastiglia',
        file='js/paper.js',
        da="""        html += '<button class="mini mini-del" data-foglio-via="' + esc(f.id) +""",
        a="""        html += '<button class="btn btn-ghost foglio-via" data-foglio-via="' + esc(f.id) +""",
        vede='la sua matita e il suo cestino',
        prova='prova-piano.js',
    ),
    dict(
        nome='la pastiglia del foglio senza la matita',
        file='js/paper.js',
        da="""              '<button class="mini mini-edit" data-fog-ed="' + esc(f.id) +
              '" title="Nome, misure e carta di questo foglio" ' +
              'aria-label="Modifica questo foglio">' + MATITA + '</button>';""",
        a="""              '';""",
        vede='la sua matita e il suo cestino',
        prova='prova-piano.js',
    ),
    dict(
        nome='la matita e il cestino sempre in vista, anche senza passarci sopra',
        file='css/components.css',
        da=""".foglio-wrap:hover .mini,
.foglio-wrap:focus-within .mini { display: flex; }""",
        a=""".foglio-wrap .mini { display: flex; }""",
        vede='la sua matita e il suo cestino',
        prova='prova-piano.js',
    ),
    dict(
        nome='il cestino anche sull\'ultimo foglio rimasto',
        file='js/paper.js',
        da="""      if (l.length > 1) {
        html += '<button class="mini mini-del" data-foglio-via="'""",
        a="""      if (true) {
        html += '<button class="mini mini-del" data-foglio-via="'""",
        vede="sull'ultimo non c'e'",
        prova='prova-piano.js',
    ),
    dict(
        nome='un preset torna a cambiare le misure del foglio in uso',
        file='js/paper.js',
        da='      if (p) aggiungiFoglio(+p.dataset.w, +p.dataset.h);',
        a='      if (p) setSize(+p.dataset.w, +p.dataset.h);',
        vede='un preset AGGIUNGE un foglio',
        prova='prova-piano.js',
    ),
    dict(
        nome='il formato acceso resta quello del foglio di prima',
        file='js/paper.js',
        da="    State.on('fogli', function () { renderFogli(); renderSheet(); markPreset(); });",
        a="    State.on('fogli', function () { renderFogli(); renderSheet(); });",
        vede='il formato acceso e` quello del foglio appena aggiunto',
        prova='prova-piano.js',
    ),
    dict(
        nome='scrivere le misure torna a ridimensionare il foglio in uso',
        file='js/paper.js',
        da="      document.getElementById(id).addEventListener('input', aggiornaPiu);",
        a="""      document.getElementById(id).addEventListener('input', function () {
        setSize(+document.getElementById('paper-w').value || 10,
                +document.getElementById('paper-h').value || 10);
      });""",
        vede='scrivere le misure non cambia il foglio in uso',
        prova='prova-piano.js',
    ),
    dict(
        nome='il «+» salva il preset e non aggiunge il foglio',
        file='js/paper.js',
        da='      aggiungiFoglio(m.w, m.h);\n      if (nato) {',
        a='      if (nato) {',
        vede='il «+» salva il preset nuovo e aggiunge il foglio',
        prova='prova-piano.js',
    ),
    dict(
        nome='il «+» rifa` il preset anche quando c\'e` gia`',
        file='js/paper.js',
        da="      if (nomeFormato(m.w, m.h) === 'Personalizzato') {",
        a='      if (true) {',
        vede='senza rifare il preset',
        prova='prova-piano.js',
    ),
    dict(
        nome='la matita del foglio scrive nel campo il nome automatico',
        file='js/paper.js',
        da="    cn.value = f.nomeMio && f.name ? f.name : '';",
        a="    cn.value = f.name || '';",
        vede='apre col nome vuoto e la sua misura',
        prova='prova-piano.js',
    ),
    dict(
        nome='la matita del foglio non cambia le misure',
        file='js/paper.js',
        da='      misuraFoglio(fg, w, h);\n      renderFormati();',
        a='      renderFormati();',
        vede='cambia nome, misure e carta di quel foglio',
        prova='prova-piano.js',
    ),
    dict(
        nome='modificare un foglio crea anche un preset',
        file='js/paper.js',
        da='    if (inFoglio) {\n      var fg = Fogli.trova(inFoglio);',
        a='    if (false) {\n      var fg = Fogli.trova(inFoglio);',
        vede='senza creare preset',
        prova='prova-piano.js',
    ),
    dict(
        nome='il nome vuoto di un foglio resta un nome scelto a mano',
        file='js/paper.js',
        da='      fg.nomeMio = !!nome;',
        a='      fg.nomeMio = true;',
        vede='il nome vuoto rimette quello del formato',
        prova='prova-piano.js',
    ),

    # ---- I FOGLI VUOTI NELL'ELENCO DEI LIVELLI (2026-11-08) ----
    dict(
        nome="il foglio vuoto sparisce dall'elenco della tab Disegno",
        file='js/artwork.js',
        da="""        ordine.push({ testa: f.id, pos: suoi.length ? suoi[0] : prima,
                      vuoto: !suoi.length });""",
        a="""        if (suoi.length) ordine.push({ testa: f.id, pos: suoi[0], vuoto: false });""",
        vede="un foglio senza niente sopra sta nell'elenco",
        prova='prova-piano.js',
    ),
    dict(
        nome="il foglio vuoto sparisce dalla colonna dell'editor",
        file='js/editor.js',
        da="""        ordine.push({ testa: f.id, pos: suoi.length ? suoi[0] : prima,
                      vuoto: !suoi.length });""",
        a="""        if (suoi.length) ordine.push({ testa: f.id, pos: suoi[0], vuoto: false });""",
        vede="un foglio senza niente sopra sta nell'elenco",
        prova='prova-piano.js',
    ),
    dict(
        nome="l'intestazione di un foglio vuoto dice di cadere in cima a tutto",
        file='js/artwork.js',
        da="""        ordine.push({ testa: f.id, pos: suoi.length ? suoi[0] : prima,
                      vuoto: !suoi.length });""",
        a="""        ordine.push({ testa: f.id, pos: suoi.length ? suoi[0] : 0,
                      vuoto: !suoi.length });""",
        vede="un foglio senza niente sopra sta nell'elenco",
        prova='prova-piano.js',
    ),
    dict(
        nome="l'elenco non si rifa` quando si aggiunge un foglio",
        file='js/artwork.js',
        da='      ridisegnaElenchi();\n      var fid = State.data.foglioAttivo;',
        a='      var fid = State.data.foglioAttivo;',
        vede="un foglio senza niente sopra sta nell'elenco",
        prova='prova-piano.js',
    ),
    dict(
        nome='lasciando sotto a tutto si torna al foglio dell\'ultimo livello',
        file='js/artwork.js',
        da='      var dove = +slot.dataset.pos;\n      var fid = slot.dataset.fog;',
        a="""      var dove = livelli.length - 1;
      var fid = livelli[livelli.length - 1].foglio || State.data.foglioAttivo;""",
        vede="ci si puo' trascinare un livello",
        prova='prova-piano.js',
    ),
    dict(
        nome="cliccare un livello nell'editor accumula le spunte",
        file="js/editor.js",
        da="    Artwork.seleziona(id);\n    attivo = id;",
        a="    Artwork.seleziona(id, 'aggiungi');\n    attivo = id;",
        vede="due livelli dello STESSO foglio",
        prova="prova-piano.js",
    ),
    dict(
        nome="la mira guarda il punto nel sistema del foglio in uso",
        file="js/artwork.js",
        da="      var o = origineDi(l.id);\n      var x = p.x - o.x, y = p.y - o.y;",
        a="      var o = State.data.sheetOrigin;\n      var x = p.x - o.x, y = p.y - o.y;",
        vede="il doppio clic prende il disegno dell'altro foglio",
        prova="prova-piano.js",
    ),
    dict(
        nome="i due clic sul foglio non si contano a mano",
        file="js/paper.js",
        da="      if (window.Nome && Nome.doppio('piano:' + rect.dataset.foglio) &&\n          entraInModifica(toMm(e))) return;\n",
        a="",
        # Il testimone e' la scena del foglio LIBERO: la' il primo clic
        # ridisegna i fogli e il `dblclick` vero non arriva. Su un foglio
        # misurato arriverebbe comunque, quindi quella scena non vedrebbe
        # niente -- ed e' la prima cosa che questa mutazione ha trovato.
        vede="sul foglio libero, cliccando nel bianco dentro al disegno",
        prova="prova-piano.js",
    ),
    dict(
        nome="il doppio clic viene servito due volte (niente guardiano)",
        file="js/paper.js",
        da="      if (Date.now() - ultimaModifica < 600) return;\n",
        a="",
        # Servito due volte, il gesto gira al livello DI SOTTO: si vede solo
        # dove sotto c'e' davvero qualcosa, cioe' con due disegni
        # sovrapposti. Con un disegno solo il giro torna su quello di prima e
        # la mutazione misurerebbe se stessa.
        vede="due disegni sovrapposti prende quello sopra",
        prova="prova-piano.js",
    ),
    dict(
        nome="la spunta di un altro foglio non si veste diversa",
        file="js/artwork.js",
        da="                  (ricomincia ? ' altro-foglio' : '') + '\" data-sel=\"' + l.id +",
        a="                  '' + '\" data-sel=\"' + l.id +",
        vede="si veste diversa, e solo quella",
        prova="prova-piano.js",
    ),
    dict(
        nome="il vestito tratteggiato sta su TUTTE le spunte",
        file="js/artwork.js",
        da="             })(!preso && selezionati.length > 0 && !stessoFoglio(selezionati[0], l.id)) +",
        a="             })(!preso) +",
        vede="si veste diversa, e solo quella",
        prova="prova-piano.js",
    ),
    dict(
        nome="la scelta ricomincia in silenzio",
        file="js/artwork.js",
        da="        if (window.Log && nuovo) {",
        a="        if (false) {",
        vede="il registro dice su che foglio",
        prova="prova-piano.js",
    ),

    # ---- L'AVVISO DEI NUMERI DI FABBRICA (2026-11-14) ----
    # Il difetto che queste mutazioni simulano non e' «manca un avviso»: e'
    # un dispositivo che usa i numeri di un altro giorno SENZA dirlo, che e'
    # il caso in cui non si vede niente di strano. Per questo le mutazioni
    # che contano sono quelle che tolgono la DISTINZIONE fra i due casi, non
    # quelle che spengono la fascia.
    dict(
        nome="il profilo di fabbrica passa per profilo del dispositivo",
        file="js/profile.js",
        da="      if (raw) { p = fondi(p, migra(JSON.parse(raw))); proprio = true; }",
        a="      if (raw) p = fondi(p, migra(JSON.parse(raw)));\n      proprio = true;",
        vede="senza profilo suo si riconosce",
        prova="prova-profilo.js",
    ),
    dict(
        nome="la frase non dice di quando sono i numeri di fabbrica",
        file="js/profile.js",
        da="      return 'numeri di fabbrica della pagina, misurati il ' +\n             dataLeggibile(MISURE_DI_FABBRICA);",
        a="      return 'numeri di fabbrica della pagina';",
        vede="di che numeri sono e di quando",
        prova="prova-profilo.js",
    ),
    dict(
        nome="la fascia non si accende",
        file="js/app.js",
        da="    f.hidden = false;",
        a="",
        vede="la fascia si accende e si vede",
        prova="prova-profilo.js",
    ),
    dict(
        nome="la fascia avvisa ma non dice perche' importa",
        file="js/app.js",
        da="      'l\\'alzata della penna, perché una penna che si alza poco striscia sul ' +\n      'foglio durante gli spostamenti.';",
        a="      'un numero vecchio.';",
        vede="qual e` la misura che fa danno",
        prova="prova-profilo.js",
    ),
    dict(
        nome="l'avviso del profilo diventa un blocco, e dall'iPad non si stampa",
        file="js/profile.js",
        da="        gravita: 'avviso', campo: 'profilo',",
        a="        gravita: 'blocco', campo: 'profilo',",
        vede="non blocca niente",
        prova="prova-profilo.js",
    ),
    dict(
        nome="il popup non dice quale profilo sta stampando",
        file="js/popup.js",
        da="    if (modo !== 'stampa') return '';",
        a="    return '';",
        vede="quale profilo sta stampando",
        prova="prova-profilo.js",
    ),
    dict(
        nome="la riga del popup non distingue i due casi",
        file="js/popup.js",
        da="(Profile.diFabbrica() ? ' di-fabbrica' : '')",
        a="''",
        vede="non sono di questa macchina",
        prova="prova-profilo.js",
    ),
    dict(
        nome="salvare il profilo non cambia la provenienza",
        file="js/profile.js",
        da="      proprio = true;\n      return true;",
        a="      return true;",
        vede="ha un profilo suo",
        prova="prova-profilo.js",
    ),

    # ---- I GESTI CON LE DITA (2026-11-14) ----
    # Qui il difetto tipico non e' «non funziona»: e' «funziona male di
    # poco», cioe' il disegno che scappa di qualche pixel mentre lo si
    # guarda. Per questo meta' di queste mutazioni spostano un conto invece
    # di toglierlo.
    dict(
        nome="il piano non si pinza",
        file="js/paper.js",
        da="    if (window.Tocco) {\n      Tocco.pizzica(svg, {",
        a="    if (false) {\n      Tocco.pizzica(svg, {",
        vede="due dita che si allargano",
        prova="prova-tocco.js",
    ),
    dict(
        nome="la pinzata si fonda al primo movimento, non al secondo dito",
        file="js/tocco.js",
        da="      if (quante(r.giu) === 2) fonda();",
        a="",
        vede="riportano il disegno dov",
        prova="prova-tocco.js",
    ),
    dict(
        nome="si ingrandisce dall'angolo invece che fra le dita",
        file="js/tocco.js",
        da="        x0: base.ancora.x - (base.ancora.x - base.v.x0) * f -\n            (m.x - base.m.x) * base.kx * f,",
        a="        x0: base.v.x0,",
        vede="fra le due dita resta",
        prova="prova-tocco.js",
    ),
    dict(
        nome="la pinzata ingrandisce ma non segue le dita che si spostano",
        file="js/tocco.js",
        da="            (m.x - base.m.x) * base.kx * f,",
        a="            0,",
        vede="segue le dita anche quando",
        prova="prova-tocco.js",
    ),
    dict(
        nome="il verso della y dato per scontato invece che misurato",
        file="js/tocco.js",
        da="      var q1 = c.dove(m.x + 100, m.y + 100);",
        a="      var q1 = c.dove(m.x + 100, m.y - 100);",
        vede="segue le dita anche quando",
        prova="prova-tocco.js",
    ),
    dict(
        nome="lo sguardo non si fa da parte quando arriva il secondo dito",
        file="js/paper.js",
        da="      if (window.Tocco && Tocco.dita(svg) > 1) {\n        pan = null;",
        a="      if (false) {\n        pan = null;",
        vede="fra le due dita resta",
        prova="prova-tocco.js",
    ),
    dict(
        nome="il foglio si trascina mentre si pinza",
        file="js/paper.js",
        da="      if (window.Tocco && Tocco.dita(svg) > 1) return;\n      var f = Fogli.trova(grab.id);",
        a="      var f = Fogli.trova(grab.id);",
        vede="il foglio non si sposta",
        prova="prova-tocco.js",
    ),
    dict(
        nome="la pinzata non ha i limiti della rotella",
        file="js/paper.js",
        da="        minimo: function () { return 20; },",
        a="        minimo: function () { return 0; },",
        vede="sotto i 20 mm",
        prova="prova-tocco.js",
    ),
    dict(
        nome="col dito i bersagli dei livelli restano da mouse",
        file="css/components.css",
        da="    min-width: 40px;\n    min-height: 40px;\n    padding: 0;",
        a="    min-width: 18px;\n    min-height: 18px;\n    padding: 0;",
        vede="grande almeno 40 px",
        prova="prova-tocco.js",
    ),
    dict(
        nome="la tela dell'editor non si pinza",
        file="js/editor.js",
        da="    if (window.Tocco) {\n      Tocco.pizzica(svg, {",
        a="    if (false) {\n      Tocco.pizzica(svg, {",
        vede="la tela dell'editor si pinza",
        prova="prova-tocco.js",
    ),
    dict(
        nome="le proporzioni le decide solo Shift, come prima",
        file="js/selezione.js",
        da="    return !!(c && c.checked) !== !!e.shiftKey;",
        a="    return !!e.shiftKey;",
        vede="il dito ingrandisce senza deformare",
        prova="prova-tocco.js",
    ),
    dict(
        nome="la spunta c'e' ma Shift non la capovolge piu'",
        file="js/selezione.js",
        da="    return !!(c && c.checked) !== !!e.shiftKey;",
        a="    return !!(c && c.checked);",
        vede="Shift capovolge la spunta",
        prova="prova-tocco.js",
    ),
    dict(
        nome="col dito la maniglia non ha una presa piu' larga",
        file="js/selezione.js",
        da="      if (dito) {",
        a="      if (false) {",
        vede="l'angolo deforma come sempre",
        prova="prova-tocco.js",
    ),
    dict(
        nome="la presa e' larga come il quadratino che si vede",
        file="js/selezione.js",
        da="    var presa = 30 * mmPerPixel();",
        a="    var presa = 9 * mmPerPixel();",
        vede="l'angolo deforma come sempre",
        prova="prova-tocco.js",
    ),
    dict(
        nome="i magneti dei fogli si sospendono solo con Alt, come prima",
        file="js/paper.js",
        da="    return accesi ? !!e.altKey : !e.altKey;",
        a="    return !!e.altKey;",
        vede="si posa dove lo si lascia",
        prova="prova-tocco.js",
    ),
    dict(
        nome="la spunta dei magneti c'e' ma Alt non la capovolge piu'",
        file="js/paper.js",
        da="    return accesi ? !!e.altKey : !e.altKey;",
        a="    return !accesi;",
        vede="Alt capovolge la spunta",
        prova="prova-tocco.js",
    ),
    dict(
        nome="sommare alla scelta torna a volere Ctrl",
        file="js/editor.js",
        da="  function sommaOra(e) { return somma !== !!(e.ctrlKey || e.metaKey); }",
        a="  function sommaOra(e) { return !!(e.ctrlKey || e.metaKey); }",
        vede="due tocchi prendono due tratti",
        prova="prova-tocco.js",
    ),
    dict(
        nome="l'interruttore Somma c'e' ma Ctrl non lo capovolge",
        file="js/editor.js",
        da="  function sommaOra(e) { return somma !== !!(e.ctrlKey || e.metaKey); }",
        a="  function sommaOra(e) { return somma; }",
        vede="Ctrl capovolge",
        prova="prova-tocco.js",
    ),

    # ---- I RIEMPIMENTI: il motore (2026-11-14) ----
    # Il difetto che fa paura qui non e' «non riempie»: e' «riempie di
    # troppo» -- la penna che attraversa il buco di una ciambella, o il
    # foglio allagato da un contorno con una fessura. Sono difetti che
    # sembrano un tratteggio finche' non si guarda da vicino.
    dict(
        nome="lo stampino non ingrassa i tratti con la tolleranza",
        file="js/riempi.js",
        da="      g.lineWidth = ((+t.larghezza || TRATTO) + 2 * tol) / mmPerPx;",
        a="      g.lineWidth = (+t.larghezza || TRATTO) / mmPerPx;",
        vede="la stessa fessura si tappa",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="il guardiano non guarda il bordo del foglio",
        file="js/riempi.js",
        da="        if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) tocca[nreg] = true;",
        a="",
        vede="NON allaga il foglio",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="la serpentina unisce i capi alla cieca",
        file="js/riempi.js",
        da="        if (serpentina && corrente &&\n            dirittoDentro(st, reg, corrente[corrente.length - 1], a)) {",
        a="        if (serpentina && corrente) {",
        vede="non unisce due capi attraverso il buco",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="i capi del tratteggio non si infilano sotto il contorno",
        file="js/riempi.js",
        da="    for (var o = 0; o < out.length; o++) allunga(out[o], sotto);",
        a="",
        vede="finiscono SOTTO il contorno",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="il tratteggio si ferma all'inchiostro e non alla regione",
        file="js/riempi.js",
        da="        var qui = regioneIn(st, p) === reg;",
        a="        var qui = regioneIn(st, p) !== 0;",
        vede="non entra mai nel buco",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="il passo del tratteggio e' sempre un millimetro",
        file="js/riempi.js",
        da="    for (var tt = tmin; tt <= tmax; tt += passo) {",
        a="    for (var tt = tmin; tt <= tmax; tt += 1) {",
        vede="dimezzando il passo la penna raddoppia",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="lo stampino non ribalta la y",
        file="js/riempi.js",
        da="    return { x: p.x / mmPerPx, y: H - p.y / mmPerPx };",
        a="    return { x: p.x / mmPerPx, y: p.y / mmPerPx };",
        vede="il punto cliccato sceglie la sua",
        prova="prova-riempimenti.js",
    ),

    # ---- I RIEMPIMENTI: la porta dell'utente (2026-11-14) ----
    dict(
        nome="il riempimento non e' figlio del disegno che riempie",
        file="js/artwork.js",
        da="    l.padre = padreId;",
        a="    l.padre = null;",
        vede="nasce come SOTTOLIVELLO",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="il riempimento si stampa DOPO il suo contorno",
        file="js/artwork.js",
        da="    var mio = indice(id), suo = indice(padreId);",
        a="    var mio = -1, suo = -1;",
        vede="sta PRIMA del padre",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="dopo il riempimento si finisce a modificare il riempimento",
        file="js/artwork.js",
        da="    scelto = prima;",
        a="    scelto = id;",
        vede="la scelta resta sul disegno",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="buttando il disegno il riempimento resta orfano sul foglio",
        file="js/artwork.js",
        da="    var orfani = livelli.filter(function (l) { return l.padre === id; });",
        a="    var orfani = [];",
        vede="se ne va anche il suo riempimento",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="il riempimento nasce con una mappa sua invece che quella del padre",
        file="js/artwork.js",
        da="    var id = nuovo('Riempimento di ' + p.nome, padreId);",
        a="    var id = nuovo('Riempimento di ' + p.nome);",
        vede="cade SOPRA al disegno",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="il puntatore non anticipa niente",
        file="js/editor.js",
        da="    if (riempiAcceso && anteprima && anteprima.polilinee) {",
        a="    if (false) {",
        vede="ANTICIPA il riempimento",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="col riempimento acceso il clic fa quello di prima",
        file="js/editor.js",
        da="    if (riempiAcceso) { clicRiempimento(e); return; }",
        a="",
        vede="il clic disegna il riempimento",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="si riempie anche quando il colore scapperebbe fuori",
        file="js/editor.js",
        da="    if (anteprima.scappata) {\n      /* Due situazioni",
        a="    if (false) {\n      /* Due situazioni",
        vede="il programma dice perche",
        prova="prova-riempimenti.js",
    ),
    dict(
        nome="i metri e i minuti non si sanno prima del clic",
        file="js/editor.js",
        da="    conto.textContent = anteprima.metri.toFixed(1) + ' m di penna, ' +",
        a="    conto.textContent = '' +",
        vede="metri, alzate e minuti prima del clic",
        prova="prova-riempimenti.js",
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
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=TEMPO_MASSIMO)
    except subprocess.TimeoutExpired:
        """UN BANCO CHE NON FINISCE È UN BANCO CHE FALLISCE, e dal 2026-11-09
        questo conta: una mutazione può togliere l'uscita da un giro — è
        successo davvero, `while (TCC0->SYNCBUSY.reg) {}` nel firmware — e
        il controllo che la prende non può fare altro che piantarsi insieme
        al codice. Senza questa scadenza si pianterebbe il banco delle
        mutazioni, cioè si perderebbe il giro intero invece di guadagnare
        una riga."""
        return ("KO il collaudo non è finito entro %d s: si è piantato"
                % TEMPO_MASSIMO), False
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
        # UNA MUTAZIONE PUO' TOCCARE PIU' PUNTI, e serve quando la cosa da
        # rompere e' difesa in due posti che devono dire la stessa cosa --
        # per esempio «il foglio misurato non si muove», che e' scritto sia
        # nel trascinamento sia nello sguardo. Romperne uno solo lascia il
        # programma corretto, quindi simulerebbe un difetto che non e' un
        # difetto: la mutazione va fatta su tutt'e due.
        tagli = [(m["file"], m["da"], m["a"])] + list(m.get("piu", []))
        testi, manca = {}, None
        for (rel, da, _) in tagli:
            if rel not in testi:
                testi[rel] = (ROOT / rel).read_text(encoding="utf-8")
            if testi[rel].count(da) != 1:
                manca = rel
        if manca:
            print("%2d. %-52s ANCORA: la riga da rompere non c'e' (o ce n'e' "
                  "piu' d'una) in %s" % (i, m["nome"], manca))
            sordi.append(m["nome"] + " (riga non trovata)")
            continue
        try:
            rotti = dict(testi)
            for (rel, da, aa) in tagli:
                rotti[rel] = rotti[rel].replace(da, aa)
            for rel in rotti:
                (ROOT / rel).write_text(rotti[rel], encoding="utf-8")
            if not costruisci():
                esito, dettaglio = False, "la pagina non si compone"
            else:
                uscita = collauda(m.get("prova", PROVA_PREDEFINITA))[0]
                riga = riga_del(uscita, m["vede"])
                if uscita.startswith("KO il collaudo non è finito"):
                    # Il collaudo si e' piantato: la mutazione e' stata vista,
                    # ed e' l'unico modo di vedere un giro senza uscita.
                    esito, dettaglio = True, uscita
                elif riga is None:
                    esito, dettaglio = False, "il controllo «%s» non c'e'" % m["vede"]
                else:
                    esito = riga.startswith("KO")
                    dettaglio = riga.strip()[:70]
        finally:
            for rel in testi:
                (ROOT / rel).write_text(testi[rel], encoding="utf-8")

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
