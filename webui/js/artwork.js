/* I disegni caricati sul foglio: dai file SVG alle polilinee, e da lì al
 * G-code.
 *
 * NON C'È UN DISEGNO, C'È UN ELENCO DI LIVELLI. Un livello è un file caricato,
 * con la sua collocazione sul foglio, la sua rotazione e il suo ritaglio; e
 * soprattutto è l'unità con cui si ragiona di penne: un livello si disegna
 * tutto di fila, e fra un livello e l'altro ci si può fermare a cambiare
 * penna. Mescolarli sarebbe comodo per il tempo e disastroso per i colori.
 *
 * Le polilinee grezze di ogni livello restano in memoria nelle coordinate del
 * file: scala, rotazione, ritaglio e formato del foglio si riapplicano ogni
 * volta a partire da quelle, invece di trasformare il risultato precedente.
 * Trasformare più volte lo stesso dato accumula errori e perde precisione a
 * ogni giro.
 */
var Artwork = (function () {

  /* L'elenco, in ordine di disegno: il primo si stampa per primo, e l'ultimo
     resta sopra agli altri sul piano. */
  var livelli = [];
  /* CHI E' SCELTO. `selezionati` sono tutti, `scelto` è il PRINCIPALE fra
     loro — quello che aprono l'editor e i campi laterali. Due cose diverse:
     «su che cosa agisce il riquadro sul foglio» vale per il gruppo, «di chi
     parla il campo Scala» vale per uno solo.
     Selezione vuota vuol dire modalità crea: il pulsante dice «Crea» e un
     doppio clic sul foglio sceglie da sé chi sta sotto. Prima non c'era un
     modo di arrivarci — scelto un livello, scelto restava. */
  var scelto = null;
  var selezionati = [];
  var seq = 0;

  var prep = null;       // ultimo G-code composto

  /* I CAMBI PENNA MESSI A MANO: indici dei tratti PRIMA dei quali fermarsi.
     Quelli automatici fra un livello e l'altro non stanno qui — si ricavano
     dai livelli a ogni composizione, vedi prepare().

     Si tengono come indici e non come coordinate perché il punto di una pausa
     è un confine fra due tratti, non un posto sul foglio. E si azzerano
     quando il disegno cambia, perché dopo un riadattamento l'ottimizzatore
     riordina i tratti e l'indice 37 non è più lo stesso tratto. */
  var pause = [];

  /* Quello che serve per ricomporre il file senza rifare l'ottimizzazione:
     aggiungere o togliere una pausa cambia il programma, non il percorso. */
  var ultima = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  /* ------------------------- l'elenco ------------------------- */

  function trova(id) {
    for (var i = 0; i < livelli.length; i++) if (livelli[i].id === id) return livelli[i];
    return null;
  }

  function indice(id) {
    for (var i = 0; i < livelli.length; i++) if (livelli[i].id === id) return i;
    return -1;
  }

  function corrente() { return trova(scelto); }

  function visibili() {
    return livelli.filter(function (l) { return l.visibile && l.raw.length; });
  }

  /* UN FILE, UN LIVELLO PER TINTA.
   *
   * Un SVG quasi mai ha livelli, ma quasi sempre ha colori, e i colori sono
   * il modo in cui chi l'ha fatto ha detto che cosa va insieme con che cosa.
   * Qui quella distinzione diventa la nostra: ogni tinta — bordo di un
   * colore, riempimento di un colore — diventa un livello, con il suo occhio,
   * il suo cestino, il suo posto nell'ordine di stampa e il suo cambio penna.
   *
   * LE TINTE PIENE NASCONO SPENTE. Fino a ieri le forme senza bordo, in un
   * file che ne aveva almeno una col bordo, sparivano senza lasciare traccia:
   * era giusto per i riferimenti colorati dei nostri SVG e sbagliato per la
   * geometria vera, come la faccia di un cubo disegnata come poligono pieno
   * invece che come contorno. Nascendo spente il risultato di partenza resta
   * quello di prima — si stampa quello che si stampava — ma quello che prima
   * spariva adesso sta nell'elenco, e per riaverlo basta un occhio.
   *
   * I LIVELLI DI UN FILE SI ADATTANO INSIEME. Il rettangolo si calcola una
   * volta sola sul disegno INTERO e poi si ritaglia per ciascuno: adattare
   * ogni tinta per conto suo vorrebbe dire scalare le facce di un cubo in
   * modo diverso dai suoi spigoli, cioè smontare il disegno nell'atto di
   * aprirlo. È la stessa mappa di rigenera(), per la stessa ragione.
   */
  function load(text, nome) {
    /* UN PROGETTO SALVATO NON SI IMPORTA: SI RIPRENDE. Dentro c'è lo stato
       com'era — forme con le loro curve, livelli, rettangoli, ritagli,
       foglio — e rileggerne i tracciati disegnati vorrebbe dire tornare a un
       disegno di segmenti dritti, cioè buttare via proprio la parte che si
       era salvata. Vedi js/progetto.js. */
    var pg = (typeof Progetto !== 'undefined') ? Progetto.leggi(text) : null;
    if (pg) {
      if (livelli.length &&
          !window.confirm('«' + nome + '» è un progetto salvato: riaprendolo, ' +
                          'i ' + livelli.length + ' livelli che ci sono adesso ' +
                          'vengono sostituiti. Procedo?')) {
        Log.add('msg', 'Progetto non riaperto: quello che c\'era resta com\'è.');
        return;
      }
      Progetto.applica(pg, nome);
      return;
    }

    /* Si leggono le FORME, con le curve ancora curve, e da quelle si
       ricavano le polilinee. L'ordine conta: appiattire per primo e tenere
       solo il risultato è quello che rendeva impossibile modificare una
       curva importata. */
    var forme = SvgImport.parseForme(text);
    var tol = forme.tolleranza;
    var gruppi = perTinta(forme);

    /* La mappa comune: ingombro e rettangolo di TUTTO il file. */
    var tutte = Tracciato.appiattisciTutte(forme, tol);
    var bbG = SvgImport.bbox(tutte);
    var pc = +document.getElementById('art-scale').value || 100;
    var boxG = SvgImport.fitRect(tutte, State.data.paper, pc);
    var kx = bbG.w > 0 ? boxG.w / bbG.w : 1, ky = bbG.h > 0 ? boxG.h / bbG.h : 1;

    var primo = livelli.length === 0;
    var nati = [];

    /* UNA TINTA PIENA NASCE SPENTA SOLO SE NEL FILE C'E' ANCHE UN BORDO.
       È la vecchia regola, tenuta intera: in un file di linee una forma piena
       è decorazione, in un file che di bordi non ne ha nemmeno uno — una
       clipart, il nostro logo — le forme piene SONO il disegno, e spegnerle
       vorrebbe dire aprire un file e non vedere niente. */
    var aLinee = gruppi.some(function (g) { return !g.piena; });

    /* IL NOME SI ALLUNGA SOLO QUANDO SERVE. Se del file si disegna una tinta
       sola — il caso normale: un disegno di linee più i riferimenti colorati
       — quella tinta è il file, e chiamarla «intreccio.svg · tratto #111»
       sarebbe un dettaglio in più da leggere ogni volta per non sapere
       niente di nuovo. Le altre il loro nome ce l'hanno, perché è la sola
       cosa che dice che cosa accenderesti. */
    var accese = gruppi.filter(function (g) { return !(g.piena && aLinee); }).length;

    for (var g = 0; g < gruppi.length; g++) {
      var gr = gruppi[g];
      var raw = Tracciato.appiattisciTutte(gr.forme, tol);
      if (!raw.length) continue;
      var bb = SvgImport.bbox(raw);

      var l = {
        id: 'liv' + (++seq),
        nome: (gruppi.length > 1 && (accese > 1 || (gr.piena && aLinee)))
          ? nome + ' · ' + gr.nome : nome,
        forme: gr.forme,
        tol: tol,
        raw: raw,
        /* Non null: il rettangolo è il ritaglio di quello comune, ed è
           l'unica cosa che tiene insieme le tinte di uno stesso file. La y è
           ribaltata da toRect, che misura da b.y1 verso il basso. */
        box: { x: boxG.x + (bb.x0 - bbG.x0) * kx,
               y: boxG.y + (bbG.y1 - bb.y1) * ky,
               w: bb.w * kx, h: bb.h * ky },
        ritaglio: null,
        rot: 0,
        visibile: !(gr.piena && aLinee),
        /* Le tinte di uno stesso file non chiedono un cambio penna fra loro:
           sono un disegno solo diviso in pezzi, non due disegni. Lo chiede,
           come sempre, il primo livello di un file che se ne aggiunge ad
           altri già caricati. */
        cambioPenna: !primo && nati.length === 0,
        art: []
      };
      livelli.push(l);
      nati.push(l);
    }

    if (!nati.length) throw new Error('Nessun tracciato trovato nel file.');
    scelto = nati[0].id;
    selezionati = [scelto];

    var sc = SvgImport.scartate();
    var c = Tracciato.conta(nati[0].forme);
    var spente = nati.filter(function (x) { return !x.visibile; });

    Log.add('msg', 'Importato ' + nome + ': ' + nati[0].raw.length + ' tracciati' +
            (c.curve ? ', ' + c.curve + ' nodi con una curva' : ', tutti dritti') + '.' +
            (sc.sfondi ? ' Saltato lo sfondo: copre tutta la tela, e una penna ' +
                         'non riempie.' : '') +
            (gruppi.length > 1
               ? ' Il file ha ' + gruppi.length + ' tinte e ne è venuto un livello ' +
                 'per ciascuna' +
                 (spente.length
                    ? ', ' + spente.length + (spente.length === 1 ? ' spento' : ' spenti') +
                      ' perché sono forme piene: ' +
                      'accendi l\'occhio se ne vuoi il contorno (' +
                      spente.map(function (x) { return x.nome.split(' · ').pop(); }).join(', ') + ').'
                    : '.')
               : '') +
            (primo ? '' : ' Si disegna dopo quello che c\'era.'));
    refit();

    /* I TRATTI DOPPI SI DICONO SUBITO, qui e non nel silenzio di refit().
       Il 2026-10-27 un disegno di cubi è stato stampato con gli spigoli in
       comune ripassati due volte, e il difetto si è visto sulla carta: non
       perché fosse nascosto, ma perché nessuno l'aveva detto. */
    var dp = nati.reduce(function (s, x) { return s + (x.doppi || 0); }, 0);
    if (dp) {
      Log.add('msg', (dp === 1 ? 'Tolto 1 tratto doppio' : 'Tolti ' + dp + ' tratti doppi') +
              ': nel file ' + (dp === 1 ? 'era disegnato' : 'erano disegnati') +
              ' due volte nello stesso posto — succede con gli spigoli in ' +
              'comune fra due facce — e la penna ci sarebbe passata sopra ' +
              'due volte.');
    }
  }

  /* Le forme raggruppate per tinta, i BORDI PRIMA dei pieni. L'ordine è
     quello di stampa: i contorni veri sono il disegno, i pieni sono quello
     che si accende se serve, e un livello spento in cima all'elenco si nota
     meno di uno spento in fondo. */
  function perTinta(forme) {
    var mappa = {}, bordi = [], pieni = [];
    (forme.tinte || []).forEach(function (t) {
      mappa[t.chiave] = { chiave: t.chiave, nome: t.nome, piena: t.piena, forme: [] };
      (t.piena ? pieni : bordi).push(mappa[t.chiave]);
    });
    var fuori = null;
    forme.forEach(function (f) {
      var g = mappa[f.tinta];
      if (!g) {
        /* Una forma senza tinta non dovrebbe esserci, ma se c'è finisce in un
           gruppo suo invece di sparire. */
        if (!fuori) { fuori = { chiave: '?', nome: 'senza tinta', piena: false, forme: [] }; bordi.push(fuori); }
        g = fuori;
      }
      g.forme.push(f);
    });
    return bordi.concat(pieni).filter(function (g) { return g.forme.length; });
  }

  function rimuovi(id) {
    var i = indice(id);
    if (i < 0) return;
    var nome = livelli[i].nome;
    livelli.splice(i, 1);
    var k = selezionati.indexOf(id);
    if (k >= 0) selezionati.splice(k, 1);
    if (scelto === id) {
      scelto = selezionati.length ? selezionati[0]
             : (livelli.length ? livelli[Math.min(i, livelli.length - 1)].id : null);
      if (scelto && selezionati.indexOf(scelto) < 0) selezionati = [scelto];
    }
    if (!livelli.length && window.Selezione) Selezione.chiudi();
    Log.add('msg', 'Tolto il livello «' + nome + '».');
    refit();
  }

  function clear() {
    if (!livelli.length) return;
    livelli = [];
    scelto = null;
    selezionati = [];
    if (window.Selezione) Selezione.chiudi();
    Log.add('msg', 'Tolti tutti i livelli: il piano resta con le sole aree.');
    refit();
  }

  /* Spostare un livello nell'elenco vuol dire cambiare QUANDO si disegna, non
     dove: l'ordine è la sequenza della stampa, ed è per questo che conta. */
  function muovi(id, verso) {
    var i = indice(id);
    var j = i + verso;
    if (i < 0 || j < 0 || j >= livelli.length) return;
    var t = livelli[i];
    livelli[i] = livelli[j];
    livelli[j] = t;
    /* La spunta del cambio penna NON si tocca riordinando. È una proprietà
       del livello — «questo lo disegno con un'altra penna» — e sul primo non
       si applica perché non c'è un prima in cui fermarsi, ma resta scritta:
       rimettendolo più in giù torna a valere. Azzerarla vorrebbe dire
       perdere un'informazione a ogni spostamento, e riordinare due volte non
       riporterebbe allo stato di partenza. */
    refit();
  }

  /* `modo`: 'solo' (il predefinito) sceglie quello e basta; 'aggiungi'
     commuta, cioè aggiunge se non c'era e toglie se c'era. È la spunta della
     riga: cliccandola due volte si torna a non aver scelto niente. */
  function seleziona(id, modo) {
    if (!trova(id)) return;
    if (modo === 'aggiungi') {
      var i = selezionati.indexOf(id);
      if (i >= 0) selezionati.splice(i, 1);
      else selezionati.push(id);
    } else {
      selezionati = [id];
    }
    /* Il principale è l'ultimo toccato, se è ancora dentro; se no il primo
       rimasto. Senza selezione non c'è principale, e i campi si spengono. */
    scelto = selezionati.indexOf(id) >= 0 ? id
           : (selezionati.length ? selezionati[0] : null);
    dopoSelezione();
  }

  /* Cambiare il PRINCIPALE senza toccare il gruppo. Serve all'editor, che
     mostra tutti i livelli scelti ma ne modifica uno per volta: passare da
     uno all'altro non deve voler dire rifare la selezione. */
  function principale(id) {
    if (selezionati.indexOf(id) < 0) return;
    scelto = id;
    dopoSelezione();
  }

  function deseleziona() {
    selezionati = [];
    scelto = null;
    dopoSelezione();
  }

  function dopoSelezione() {
    /* Un riquadro aperto su un livello che non è più scelto non ha più un
       soggetto: si chiude invece di restare appeso a quello di prima. */
    if (!selezionati.length && window.Selezione && Selezione.attiva()) Selezione.chiudi();
    renderElenco();
    mostraCampi();
    if (window.Selezione) Selezione.ridisegna();
    State.emit('path');
  }

  function scelti() {
    return selezionati.map(trova).filter(function (l) { return !!l; });
  }

  /* Il nome parla del livello, non della sua posizione nell'elenco: muovendo
     un livello la selezione lo segue senza che nessuno la rifaccia. */
  function commutaVisibile(id) {
    var l = trova(id);
    if (!l) return;
    l.visibile = !l.visibile;
    refit();
  }

  function commutaCambioPenna(id) {
    var l = trova(id);
    if (!l) return;
    l.cambioPenna = !l.cambioPenna;
    refit();
  }

  /* Quale livello sta sotto a un punto del foglio: l'ULTIMO che lo contiene,
     cioè quello disegnato sopra agli altri. `dopo` fa ripartire la ricerca
     dal livello seguente, così un doppio clic ripetuto nello stesso posto
     gira fra quelli sovrapposti invece di ripescare sempre lo stesso. */
  function quale(p, dopo) {
    var vis = visibili();
    if (!vis.length) return null;
    var da = vis.length - 1;
    if (dopo) {
      var k = -1;
      for (var i = 0; i < vis.length; i++) if (vis[i].id === dopo) k = i;
      if (k >= 0) da = k - 1 + vis.length;
    }
    for (var n = 0; n < vis.length; n++) {
      var l = vis[(da - n + vis.length * 2) % vis.length];
      var r = vista(l);
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return l.id;
    }
    return null;
  }

  /* LE FORME DEL LIVELLO SCELTO, per chi le modifica. Chi le cambia poi
     chiama rigenera(): le polilinee sono un prodotto, e vanno rifatte. */
  function formeScelte() {
    var l = corrente();
    return l ? l.forme : null;
  }

  /* MODIFICARE UNA FORMA NON DEVE SPOSTARE IL DISEGNO.
     Il rettangolo del livello mappa l'ingombro delle forme sul foglio: se
     cambiando un nodo l'ingombro cresce, riusare lo stesso rettangolo
     rimpicciolirebbe TUTTO il resto per farci stare la parte nuova. Qui si
     tiene fermo il legame fra le due coordinate — la stessa scala, la stessa
     origine — e il rettangolo si adegua. Così spostando un nodo si muove
     quel nodo, e basta. */
  function rigenera(id) {
    var l = id ? trova(id) : corrente();
    if (!l || !l.forme) return;

    var vecchio = l.bb;
    l.raw = Tracciato.appiattisciTutte(l.forme, l.tol);

    if (vecchio && l.box && vecchio.w > 0 && vecchio.h > 0 && l.raw.length) {
      var nuovo = SvgImport.bbox(ruotate(l));
      var kx = l.box.w / vecchio.w, ky = l.box.h / vecchio.h;
      /* La y è ribaltata da toRect, che misura da b.y1 verso il basso: per
         questo l'ancora in y è l'estremo ALTO dell'ingombro, non quello
         basso. */
      l.box = {
        x: l.box.x + (nuovo.x0 - vecchio.x0) * kx,
        y: l.box.y + (vecchio.y1 - nuovo.y1) * ky,
        w: nuovo.w * kx,
        h: nuovo.h * ky
      };
    }
    refit();
  }

  /* QUANTO VALE UN'UNITA' DEL FILE, in millimetri sul foglio.
     L'editor lavora nelle coordinate del file, che possono valere un
     millimetro come un metro: una griglia si chiede in millimetri — «da
     cinque» vuol dire qualcosa, «da 0,37 unità» no — e per convertirla serve
     il rapporto con cui refit() ha adattato il disegno al suo rettangolo.
     x e y separati, perché una deformazione li rende diversi.
     Null quando non c'è ancora niente da misurare: su una tela vuota il
     rapporto non esiste, e chi chiama decide cosa farne. */
  function scalaMm(id) {
    var l = id ? trova(id) : corrente();
    if (!l || !l.box || !l.bb) return null;
    var kx = l.box.w / l.bb.w, ky = l.box.h / l.bb.h;
    /* Un disegno fatto di una riga orizzontale sola ha ingombro alto zero, e
       il rapporto in y esce 0 o NaN. Non è un caso da scuola: è il primo
       tratto che si traccia su una tela vuota. Allora non c'è nessuna scala
       da dare, e si dice; chi chiama ripiega su un'unità = un millimetro. */
    if (!(kx > 0) || !(ky > 0) || !isFinite(kx) || !isFinite(ky)) return null;
    return { x: kx, y: ky };
  }

  /* ISTANTANEA E RIPRISTINO, per l'annulla dell'editor.
     Si fotografano le forme E il rettangolo: rigenera() sposta il rettangolo
     per tenere fermo il disegno sul foglio, quindi rimettere solo le forme
     riporterebbe il disegno giusto nel posto sbagliato.
     La copia è profonda, con un giro da JSON: i nodi sono oggetti semplici e
     una copia di superficie lascerebbe l'istantanea attaccata a quello che
     si sta per cambiare, cioè non sarebbe un'istantanea. */
  function istantanea() {
    var l = corrente();
    if (!l || !l.forme) return null;
    return {
      id: l.id,
      forme: JSON.parse(JSON.stringify(l.forme)),
      box: l.box ? { x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h } : null
    };
  }

  function ripristina(s) {
    if (!s) return;
    var l = trova(s.id);
    if (!l) return;
    l.forme = JSON.parse(JSON.stringify(s.forme));
    l.box = s.box ? { x: s.box.x, y: s.box.y, w: s.box.w, h: s.box.h } : null;
    l.raw = Tracciato.appiattisciTutte(l.forme, l.tol);
    refit();
  }

  /* Un livello che nasce vuoto: è il «Crea» dell'editor. Senza forme non ha
     un ingombro, quindi non ha nemmeno un rettangolo; li prende tutti e due
     appena dentro ci finisce il primo tratto. */
  function nuovo(nome) {
    var l = {
      id: 'liv' + (++seq),
      nome: nome || 'nuovo disegno',
      forme: [],
      tol: 0.05,
      raw: [],
      box: null,
      ritaglio: null,
      rot: 0,
      visibile: true,
      cambioPenna: livelli.length > 0,
      art: []
    };
    livelli.push(l);
    scelto = l.id;
    selezionati = [l.id];
    refit();
    return l.id;
  }

  /* ------------------- salvataggio e ripresa del lavoro -------------------
     Due funzioni sole, e tutte e due qui dentro perché qui dentro stanno i
     livelli: il formato del file lo decide js/progetto.js, che di livelli non
     sa niente e non deve saperne.

     Si salvano le FORME e non i tracciati: i tracciati sono un prodotto —
     li rifà l'appiattimento — e sono anche l'unica cosa che un SVG normale
     saprebbe già dire. Si salva anche `origine`, la fotografia di com'era il
     livello prima delle modifiche, perché l'etichetta EDIT serve proprio a
     riguardarla, e riaprendo il lavoro domani è ancora la stessa domanda. */
  function progetto() {
    return {
      livelli: livelli.map(function (l) {
        return {
          nome: l.nome, tol: l.tol, forme: l.forme,
          box: l.box, ritaglio: l.ritaglio, rot: l.rot,
          visibile: l.visibile, cambioPenna: l.cambioPenna, penna: l.penna || null,
          origine: l.origine || null, mostraOrigine: !!l.mostraOrigine
        };
      }),
      /* I tracciati sul foglio, per livello: servono a disegnare il file, non
         a ricostruirlo. Stanno fuori dall'elenco salvato apposta. */
      tratti: livelli.map(function (l) { return l.art; })
    };
  }

  function daProgetto(ls) {
    livelli = [];
    scelto = null;
    selezionati = [];
    pause = [];
    (ls || []).forEach(function (d) {
      var l = {
        id: 'liv' + (++seq),
        nome: d.nome || 'livello',
        forme: d.forme || [],
        tol: d.tol || Tracciato.TOLLERANZA,
        raw: [],
        box: d.box || null,
        ritaglio: d.ritaglio || null,
        rot: d.rot || 0,
        visibile: d.visibile !== false,
        cambioPenna: !!d.cambioPenna,
        penna: d.penna || undefined,
        origine: d.origine || null,
        mostraOrigine: !!d.mostraOrigine,
        art: []
      };
      l.raw = Tracciato.appiattisciTutte(l.forme, l.tol);
      livelli.push(l);
    });
    if (livelli.length) {
      scelto = livelli[0].id;
      selezionati = [scelto];
    }
    if (window.Selezione) Selezione.chiudi();
    refit();
  }

  /* LA TAVOLOZZA: le penne che l'utente ha in cassetto.
   *
   * Sta nel browser e non nel profilo della macchina, come l'indirizzo del
   * telecomando: sono le penne di CHI STAMPA, non una proprietà della
   * macchina, e esportando il profilo non ci si vuole portare dietro il
   * contenuto di un cassetto.
   *
   * I quattro di partenza sono i Tratto Pen che l'utente ha adesso. I
   * valori sono **nominali**: un inchiostro vero non ha un esadecimale, e
   * questi servono a riconoscere la penna a colpo d'occhio sul foglio, non
   * a riprodurla. Si cambiano dal «+» come tutti gli altri. */
  var PENNE_DI_SERIE = [
    { nome: 'nero',  colore: '#1d1d1b' },
    { nome: 'blu',   colore: '#1f4fa8' },
    { nome: 'rosso', colore: '#c8102e' },
    { nome: 'grigio', colore: '#8a8a8a' }
  ];
  var CHIAVE_PENNE = 'cnc2d-penne';
  var penne = null;

  function tavolozza() {
    if (penne) return penne;
    try {
      var s = localStorage.getItem(CHIAVE_PENNE);
      penne = s ? JSON.parse(s) : null;
    } catch (e) { penne = null; }
    if (!penne || !penne.length) penne = PENNE_DI_SERIE.slice();
    return penne;
  }

  function aggiungiPenna(colore, nome) {
    var p = tavolozza();
    for (var i = 0; i < p.length; i++) if (p[i].colore === colore) return p[i];
    var nuova = { nome: nome || colore, colore: colore };
    p.push(nuova);
    try { localStorage.setItem(CHIAVE_PENNE, JSON.stringify(p)); } catch (e) { /* privata */ }
    return nuova;
  }

  function togliPenna(colore) {
    var p = tavolozza();
    for (var i = 0; i < p.length; i++) {
      if (p[i].colore === colore) { p.splice(i, 1); break; }
    }
    try { localStorage.setItem(CHIAVE_PENNE, JSON.stringify(p)); } catch (e) { /* privata */ }
  }

  /* LA PENNA SCELTA VINCE SULLA TINTA DEDOTTA.
   *
   * Fino al 2026-10-29 il colore di un livello era SOLO la tinta delle sue
   * forme, e il commento diceva che tenerne una copia vorrebbe dire averne
   * due che a un certo punto non coincidono più. Resta vero, ed è per
   * questo che la scelta non sostituisce la tinta ma la **copre**: la
   * tinta rimane quella del file, intatta, e `l.penna` dice «per questo
   * livello monto quest'altra». Toglierla fa riapparire la tinta, che è
   * l'unico modo di non perdere il dato di partenza.
   *
   * Serve perché il colore con cui un disegno è stato fatto e la penna con
   * cui lo si stampa sono due cose diverse: un logo nero nel file si può
   * voler stampare in rosso, e un livello disegnato a mano non ha nessuna
   * tinta da cui dedurre niente.
   */
  function scegliPenna(id, colore) {
    var l = trova(id);
    if (!l) return;
    if (colore) l.penna = colore; else delete l.penna;
    refit();
  }

  /* IL COLORE DI UN LIVELLO è la tinta delle sue forme, non un dato a parte.
     Un livello nasce da una tinta — è così che l'importazione divide i
     file — quindi il colore c'è già e tenerne una copia vorrebbe dire
     averne due che a un certo punto non coincidono più.
     Si contano le tinte invece di prendere la prima perché taglia-e-incolla
     fra livelli può averne portata dentro un'altra: in quel caso il colore
     del livello è quello della maggioranza, che è anche la penna con cui
     quel livello si stampa.
     Un livello disegnato a mano nell'editor non ha nessuna tinta, e allora
     non ha colore: null, e chi lo mostra non mostra niente. Meglio di un
     nero inventato, che sul telecomando vorrebbe dire «monta la penna
     nera». */
  /* La tinta come sta nel FILE, senza guardare la penna scelta: serve a
     poter tornare indietro, cioè a dire «rimetti il colore del disegno». */
  function tintaSoloDalFile(l) {
    if (!l || !l.forme || !l.forme.length) return null;
    var conta = {}, best = null;
    for (var i = 0; i < l.forme.length; i++) {
      var t = l.forme[i].tinta;
      if (!t) continue;
      conta[t] = (conta[t] || 0) + 1;
      if (!best || conta[t] > conta[best]) best = t;
    }
    if (!best) return null;
    /* La chiave è «t:» o «p:» più il colore, vedi perTinta(). */
    return SvgImport.esadecimale(best.replace(/^[tp]:/, ''));
  }

  function tintaDi(l) {
    if (!l) return null;
    return l.penna || tintaSoloDalFile(l);
  }

  function coloreLivello(id) { return tintaDi(trova(id)); }

  function elenco() {
    return livelli.map(function (l, i) {
      return { id: l.id, nome: l.nome, visibile: l.visibile, colore: tintaDi(l),
               pennaScelta: l.penna || null, tinta: tintaSoloDalFile(l),
               cambioPenna: l.cambioPenna, attivo: l.cambioPenna && i > 0,
               primo: i === 0,
               tratti: l.art.length,
               scelto: selezionati.indexOf(l.id) >= 0,
               principale: l.id === scelto,
               modificato: !!l.origine, mostraOrigine: !!l.mostraOrigine };
    });
  }

  function sceltoId() { return scelto; }

  /* DAL FOGLIO ALLE COORDINATE DI UN LIVELLO.
   *
   * Ogni livello ha le sue coordinate, che sono quelle del file da cui
   * viene: due livelli dello stesso disegno stanno nello stesso posto sul
   * foglio ma con numeri diversi. L'editor lavora nelle coordinate di UNO —
   * quello che si sta modificando — e per fargli vedere gli altri bisogna
   * portarceli dentro.
   *
   * È l'inversa esatta di toRect, ribaltamento della y compreso. Per i
   * livelli nati dallo stesso file i due adattamenti coincidono, quindi la
   * trasformazione è una pura traslazione e le cose si sovrappongono al
   * millesimo: è il motivo per cui l'adattamento comune, deciso il 26
   * ottobre, non era solo un'eleganza. */
  function daFoglio(polys, id) {
    var l = id ? trova(id) : corrente();
    if (!l || !l.box || !l.bb || !(l.box.w > 0) || !(l.box.h > 0)) return [];
    var kx = l.box.w / l.bb.w, ky = l.box.h / l.bb.h;
    if (!(kx > 0) || !(ky > 0)) return [];
    return polys.map(function (q) {
      return q.map(function (p) {
        return { x: l.bb.x0 + (p.x - l.box.x) / kx,
                 y: l.bb.y1 - (p.y - l.box.y) / ky };
      });
    });
  }

  /* ---------------- portare un disegno da un livello all'altro ----------------
   *
   * LA MAPPA DI UN LIVELLO: dalle sue coordinate a quelle del foglio, in
   * millimetri. È la stessa catena che fa refit() — prima la rotazione, poi
   * toRect — scritta come una matrice sola, perché una matrice si inverte e
   * si compone e una catena di passi no.
   *
   *   toRect:  x_f = box.x + (x_r - bb.x0) · kx
   *            y_f = box.y + (bb.y1 - y_r) · ky        (la y si ribalta QUI)
   *   rot:     x_r = x·cos - y·sin,  y_r = x·sin + y·cos
   *
   * Null quando il livello non ha ancora una collocazione — è nato adesso ed
   * è vuoto —: lì non c'è nessuna mappa, e chi chiama deve saperlo invece di
   * ricevere numeri inventati.
   *
   * L'INGOMBRO LARGO ZERO NON E' UN CASO DI SCUOLA: è un livello fatto di una
   * riga verticale sola, e ci si arriva togliendo un tratto da una L. Lì il
   * rapporto non esiste, e toRect ripiega su «un'unità vale un millimetro»:
   * qui si ripiega sulla stessa cosa, perché una mappa che non dice quello
   * che fa davvero refit è peggio di nessuna mappa.
   */
  function fattore(lato, quanto) { return quanto > 0 ? lato / quanto : 1; }

  function matriceFoglio(l) {
    if (!l || !l.box || !l.bb || !isFinite(l.bb.x0) || !isFinite(l.bb.y1)) return null;
    var kx = fattore(l.box.w, l.bb.w), ky = fattore(l.box.h, l.bb.h);
    if (!(kx > 0) || !(ky > 0) || !isFinite(kx) || !isFinite(ky)) return null;
    var a = (l.rot || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    return { a:  kx * co, c: -kx * si, e: l.box.x - kx * l.bb.x0,
             b: -ky * si, d: -ky * co, f: l.box.y + ky * l.bb.y1 };
  }

  function inversa(m) {
    var det = m.a * m.d - m.b * m.c;
    if (!det || !isFinite(det)) return null;
    return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
             e: (m.c * m.f - m.d * m.e) / det,
             f: (m.b * m.e - m.a * m.f) / det };
  }

  /* Prima `p`, poi `q`. L'ordine è quello della frase, non quello del
     prodotto fra matrici, perché è così che lo si legge quando si usa. */
  function prodotto(p, q) {
    return {
      a: q.a * p.a + q.c * p.b,
      b: q.b * p.a + q.d * p.b,
      c: q.a * p.c + q.c * p.d,
      d: q.b * p.c + q.d * p.d,
      e: q.a * p.e + q.c * p.f + q.e,
      f: q.b * p.e + q.d * p.f + q.f
    };
  }

  /* LA MAPPA DEL LIVELLO CHE SI STA MODIFICANDO, da portarsi dietro insieme
   * alle forme che se ne prendono.
   *
   * Si porta via la MAPPA e non l'id del livello, ed è una differenza che
   * costa un'ora a scoprirla: chi copia prende le forme in QUELLE coordinate,
   * e un attimo dopo il livello può averne altre. Basta il taglio stesso —
   * togli un tratto a una L e resta una riga verticale, che un ingombro largo
   * non ce l'ha più, e la sua mappa non è più quella con cui le forme erano
   * state lette. Tenendo la mappa, quello che è negli appunti resta leggibile
   * anche se il livello da cui viene cambia, si svuota o sparisce.
   */
  function mappa() {
    var l = corrente();
    var m = matriceFoglio(l);
    return m ? { m: m, tol: l.tol } : null;
  }

  /* INCOLLA nel livello che si sta modificando delle forme prese da un
   * altro, LASCIANDOLE DOVE SONO SUL FOGLIO.
   *
   * È la cosa che serve quando l'importazione mette una linea nel livello
   * sbagliato — le facce di sinistra di un cubo finite insieme ai contorni,
   * per dire. Si prende, si cambia livello, si incolla, e sul foglio non si
   * è mosso niente: ha cambiato solo la penna con cui verrà disegnata.
   *
   * Ogni livello ha le SUE coordinate, che sono quelle del file da cui
   * viene: lo stesso punto del foglio ha numeri diversi in due livelli. Si
   * passa per il foglio — la mappa che viene con le forme, poi l'inversa
   * della mappa di chi riceve — e si trasforma la forma intera, maniglie
   * comprese.
   *
   * IL LIVELLO VUOTO è il caso che conta e va trattato a parte: un livello
   * appena creato non ha un rettangolo, quindi non ha una mappa, e non c'è
   * niente da invertire. Allora le forme entrano come sono, e la mappa che è
   * arrivata con loro gliela si dà a lui, scomposta nei termini in cui un
   * livello la tiene: una rotazione e un rettangolo ancorato al proprio
   * ingombro. Le due scale si rileggono dalla matrice — kx è la lunghezza
   * della prima colonna, ky della seconda — perché una rotazione non cambia
   * la lunghezza di un vettore.
   */
  function incolla(entranti, da) {
    var B = corrente();
    if (!B || !entranti || !entranti.length || !da || !da.m) return 0;

    var mb = matriceFoglio(B), copia = null;
    if (mb) {
      var inv = inversa(mb);
      if (inv) {
        var m = prodotto(da.m, inv);
        copia = entranti.map(function (f) { return Tracciato.trasforma(f, m); });
      }
    }

    if (!copia) {
      /* Senza mappa ma con dentro qualcosa: il rettangolo glielo si
         ricalcolerebbe, e quel rettangolo è quello che tiene fermo il disegno
         che c'è già. Meglio non incollare che spostare quello che c'era. */
      if (B.forme.length) return 0;
      var kx = Math.sqrt(da.m.a * da.m.a + da.m.c * da.m.c);
      var ky = Math.sqrt(da.m.b * da.m.b + da.m.d * da.m.d);
      if (!(kx > 0) || !(ky > 0)) return 0;

      copia = JSON.parse(JSON.stringify(entranti));
      if (da.tol) B.tol = da.tol;
      B.rot = Math.atan2(-da.m.c, da.m.a) * 180 / Math.PI;
      if (Math.abs(B.rot) < 1e-9) B.rot = 0;

      var raw = Tracciato.appiattisciTutte(copia, B.tol);
      var bb = SvgImport.bbox(B.rot ? rotateAll(raw, B.rot) : raw);
      if (!isFinite(bb.x0)) return 0;
      B.box = { x: da.m.e + kx * bb.x0, y: da.m.f - ky * bb.y1,
                w: kx * bb.w, h: ky * bb.h };
      B.ritaglio = null;
    }

    for (var i = 0; i < copia.length; i++) B.forme.push(copia[i]);
    return copia.length;
  }

  /* I tratti degli ALTRI livelli VISIBILI, già portati nelle coordinate di
     quello che si sta modificando: è quello che l'editor disegna dietro.
     Tutti i visibili e non solo quelli scelti, perché nell'editor è l'occhio
     a dire che cosa si vuole vedere — ed è lo stesso occhio della tab
     Disegno, non un secondo interruttore da tenere d'accordo col primo. */
  function sfondoPer(id) {
    var out = [];
    livelli.forEach(function (l) {
      if (l.id === id || !l.visibile || !l.art.length) return;
      daFoglio(l.art, id).forEach(function (q) { out.push(q); });
    });
    return out;
  }

  /* ------------------- collocazione di un livello ------------------- */

  function ruotate(l) {
    return l.rot ? rotateAll(l.raw, l.rot) : l.raw;
  }

  /* Il rettangolo che si VEDE di un livello: senza ritaglio è il disegno
     intero, con ritaglio è la parte rimasta. */
  function vista(l) { return l ? (l.ritaglio || l.box) : null; }

  /* IL RIQUADRO E' L'UNIONE DI QUELLI SCELTI.
     Con un livello solo è il suo rettangolo, come sempre. Con più d'uno è il
     rettangolo che li contiene tutti, e le modifiche si distribuiscono in
     proporzione: due disegni grandi uno il doppio dell'altro restano uno il
     doppio dell'altro, perché quello che si scala è il contenitore e ognuno
     ci sta dentro nella stessa frazione di prima. */
  function unione(fn) {
    var ls = scelti(), u = null;
    for (var i = 0; i < ls.length; i++) {
      var b = fn(ls[i]);
      if (!b) continue;
      if (!u) u = { x: b.x, y: b.y, x1: b.x + b.w, y1: b.y + b.h };
      else {
        u.x = Math.min(u.x, b.x); u.y = Math.min(u.y, b.y);
        u.x1 = Math.max(u.x1, b.x + b.w); u.y1 = Math.max(u.y1, b.y + b.h);
      }
    }
    return u ? { x: u.x, y: u.y, w: u.x1 - u.x, h: u.y1 - u.y } : null;
  }

  function riquadro() { return unione(vista); }

  /* Il disegno intero dei livelli scelti, anche la parte nascosta: serve al
     riquadro di selezione per mostrare in chiaro quanto si tiene fuori. */
  function riquadroPieno() { return unione(function (l) { return l.box; }); }

  function ritagliato() {
    return scelti().some(function (l) { return !!l.ritaglio; });
  }

  function dentroA(r, c) {
    var x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y);
    var x1 = Math.min(r.x + r.w, c.x + c.w), y1 = Math.min(r.y + r.h, c.y + c.h);
    return { x: x0, y: y0, w: Math.max(0.5, x1 - x0), h: Math.max(0.5, y1 - y0) };
  }

  /* Sposta o ridimensiona QUELLO CHE SI VEDE dei livelli scelti. Il disegno
     intero subisce la stessa trasformazione, se no il ritaglio scivolerebbe
     sopra un disegno fermo e si vedrebbe un'altra parte invece della stessa
     più grande. */
  function collocaA(r) {
    var ls = scelti().filter(function (l) { return !!l.box; });
    if (!ls.length) return;
    var u0 = unione(vista);
    if (!u0 || !(u0.w > 0) || !(u0.h > 0)) return;

    var fin = { x: r.x, y: r.y, w: Math.max(2, r.w), h: Math.max(2, r.h) };
    var kx = fin.w / u0.w, ky = fin.h / u0.h;

    ls.forEach(function (l) {
      var v = vista(l);
      var nv = { x: fin.x + (v.x - u0.x) * kx, y: fin.y + (v.y - u0.y) * ky,
                 w: v.w * kx, h: v.h * ky };
      if (!l.ritaglio) { l.box = nv; return; }
      l.box = { x: fin.x + (l.box.x - u0.x) * kx,
                y: fin.y + (l.box.y - u0.y) * ky,
                w: l.box.w * kx, h: l.box.h * ky };
      l.ritaglio = nv;
    });
    refit();
  }

  /* IL TAGLIO: cambia solo la finestra, non la taglia del disegno. Per questo
     si può allargare fino a riavere tutto, e non oltre. Con più livelli
     scelti ognuno si taglia sulla propria parte della finestra comune: a chi
     ci sta tutto dentro non succede niente. */
  function ritagliaA(r) {
    var ls = scelti().filter(function (l) { return !!l.box; });
    if (!ls.length) return;
    var fin = { x: r.x, y: r.y, w: Math.max(2, r.w), h: Math.max(2, r.h) };
    ls.forEach(function (l) {
      var nuovo = dentroA(fin, l.box);
      var tutto = Math.abs(nuovo.x - l.box.x) < 0.05 && Math.abs(nuovo.y - l.box.y) < 0.05 &&
                  Math.abs(nuovo.w - l.box.w) < 0.05 && Math.abs(nuovo.h - l.box.h) < 0.05;
      l.ritaglio = tutto ? null : nuovo;
    });
    refit();
  }

  /* Le due percentuali sono il rettangolo detto in un altro modo, non un dato
     a parte: si ricavano ogni volta, così non possono sfasarsi da lui. */
  function percentuali() {
    var l = corrente();
    if (!l || !l.box) return null;
    return SvgImport.percentuali(ruotate(l), State.data.paper, l.box);
  }

  /* Scrivere nel campo vuol dire «questa percentuale, in proporzione»: il
     disegno torna regolare ma NON torna al centro. Ricentrarlo butterebbe via
     un trascinamento fatto apposta, e per rimetterlo in mezzo c'è il foglio. */
  function scalaDalCampo() {
    var l = corrente();
    if (!l) return;
    var pc = +document.getElementById('art-scale').value || 100;
    var nuovo = SvgImport.fitRect(ruotate(l), State.data.paper, pc);
    if (l.box) {
      nuovo.x = l.box.x + l.box.w / 2 - nuovo.w / 2;
      nuovo.y = l.box.y + l.box.h / 2 - nuovo.h / 2;
      /* Il ritaglio è una finestra sul disegno, quindi va col disegno: si
         riscala con lui attorno allo stesso centro. Lasciandolo fermo
         scoprirebbe un'altra parte invece della stessa, più grande. */
      if (l.ritaglio) {
        var kx = nuovo.w / l.box.w, ky = nuovo.h / l.box.h;
        l.ritaglio = {
          x: nuovo.x + (l.ritaglio.x - l.box.x) * kx,
          y: nuovo.y + (l.ritaglio.y - l.box.y) * ky,
          w: l.ritaglio.w * kx,
          h: l.ritaglio.h * ky
        };
      }
    }
    l.box = nuovo;
    refit();
  }

  function ruotaDalCampo() {
    var l = corrente();
    if (!l) return;
    ruotaA(+document.getElementById('art-rot').value || 0);
    refit();
  }

  /* RUOTARE SENZA BUTTARE VIA QUELLO CHE SI E' FATTO.
   *
   * Prima la rotazione azzerava rettangolo e ritaglio, e il disegno ripartiva
   * centrato e grande come all'apertura: bastava girare di novanta gradi per
   * perdere un posizionamento costruito a mano. Era scritto come una scelta —
   * «un rettangolo pensato per l'altro verso schiaccerebbe il disegno» — ma
   * la conseguenza vera era: ruota e ricomincia.
   *
   * Adesso restano fermi il CENTRO e la SCALA, e cambia solo la forma del
   * rettangolo, che deve contenere un ingombro girato. A un quarto di giro i
   * due fattori di scala si scambiano, così un disegno schiacciato in
   * larghezza, girato, resta schiacciato nello stesso verso DEL DISEGNO.
   *
   * `base` è lo stato da cui partire, e serve al trascinamento della maniglia
   * di rotazione: a ogni movimento deve ripartire da com'era PRIMA del gesto,
   * perché ruotare quello che si è appena ruotato accumula e dopo venti
   * eventi il disegno è di un'altra misura. È la stessa regola del rettangolo
   * sul foglio e dell'incurvare un tratto nell'editor.
   */
  function ruotaA(gradi, base, id) {
    var l = id ? trova(id) : corrente();
    if (!l) return;
    base = base || { rot: l.rot, box: l.box, bb: l.bb, ritaglio: l.ritaglio };
    l.rot = gradi;

    if (!base.box || !base.bb || !(base.bb.w > 0) || !(base.bb.h > 0)) {
      l.box = null; l.ritaglio = null;
      return;
    }

    var kx = base.box.w / base.bb.w, ky = base.box.h / base.bb.h;
    var giro = ((gradi - base.rot) % 360 + 360) % 360;

    /* A un quarto o a tre quarti di giro gli assi si scambiano. Agli angoli
       liberi non si scambia niente, perché «largo» e «alto» del disegno non
       stanno più su nessuno dei due assi: lì si usa un fattore solo, la media
       geometrica, che è quella che conserva l'area. */
    var sx, sy;
    if (Math.abs(giro % 90) > 0.001) {
      sx = sy = Math.sqrt(kx * ky);
    } else if (Math.round(giro / 90) % 2 === 1) {
      sx = ky; sy = kx;
    } else {
      sx = kx; sy = ky;
    }

    var cx = base.box.x + base.box.w / 2, cy = base.box.y + base.box.h / 2;
    var bb = SvgImport.bbox(ruotate(l));
    var w = Math.max(2, bb.w * sx), h = Math.max(2, bb.h * sy);

    /* Il ritaglio è una finestra sul disegno e gira con lui: si dice in
       frazioni del rettangolo, si girano quelle, e si torna ai millimetri. */
    var f = base.ritaglio ? {
      x: (base.ritaglio.x - base.box.x) / base.box.w,
      y: (base.ritaglio.y - base.box.y) / base.box.h,
      w: base.ritaglio.w / base.box.w,
      h: base.ritaglio.h / base.box.h
    } : null;

    l.box = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
    if (!f) { l.ritaglio = null; return; }

    var q = ((Math.round(giro / 90) % 4) + 4) % 4;
    for (var i = 0; i < q; i++) f = quartoDiGiro(f);
    l.ritaglio = {
      x: l.box.x + f.x * l.box.w, y: l.box.y + f.y * l.box.h,
      w: f.w * l.box.w, h: f.h * l.box.h
    };
  }

  /* La fotografia dello stato da cui una rotazione deve ripartire. */
  function statoRot() {
    var l = corrente();
    if (!l || !l.box || !l.bb) return null;
    return {
      rot: l.rot,
      box: { x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h },
      bb: { x0: l.bb.x0, y0: l.bb.y0, x1: l.bb.x1, y1: l.bb.y1, w: l.bb.w, h: l.bb.h },
      ritaglio: l.ritaglio ? { x: l.ritaglio.x, y: l.ritaglio.y,
                               w: l.ritaglio.w, h: l.ritaglio.h } : null
    };
  }

  /* Un quarto di giro di un rettangolo dentro al quadrato unitario, nel verso
     in cui gira il disegno: aumentando l'angolo, quello che stava in alto a
     sinistra finisce in alto a destra. In frazioni con la y che cresce verso
     l'alto — come sul foglio — il punto (u,v) va in (v, 1−u). */
  function quartoDiGiro(f) {
    return { x: f.y, y: 1 - (f.x + f.w), w: f.h, h: f.w };
  }

  function rotateAll(polys, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return polys.map(function (p) {
      return p.map(function (q) {
        return { x: q.x * c - q.y * s, y: q.x * s + q.y * c };
      });
    });
  }

  /* --------------------------- il ricalcolo --------------------------- */

  /* Rimappa tutti i livelli dentro ai loro rettangoli e ricompone il
     percorso. Va richiamata quando cambia un rettangolo, una rotazione, un
     ritaglio, l'ordine, la visibilità o il formato del foglio. */
  function refit() {
    var art = [], di = [], doppi = 0;

    for (var i = 0; i < livelli.length; i++) {
      var l = livelli[i];
      if (!l.raw.length) { l.art = []; continue; }

      var polys = ruotate(l);
      if (!l.box) {
        var pc = (l.id === scelto)
          ? (+document.getElementById('art-scale').value || 100) : 100;
        l.box = SvgImport.fitRect(polys, State.data.paper, pc);
      }
      if (l.ritaglio) l.ritaglio = dentroA(l.ritaglio, l.box);

      /* Il diradamento va fatto DOPO la scalatura: una tolleranza di un
         decimo di millimetro ha senso sul foglio, non nelle unità arbitrarie
         del file, che possono valere un millimetro come un metro. E prima del
         ritaglio: su meno punti costa meno, e il taglio resta comunque esatto
         sul bordo perché lavora sui segmenti. */
      /* L'ingombro con cui si sta adattando, tenuto da parte: serve a
         rigenera(), che dopo una modifica deve poter rifare lo STESSO
         adattamento invece di uno nuovo. */
      l.bb = SvgImport.bbox(polys);

      var mm = SvgImport.simplify(SvgImport.toRect(polys, l.box), 0.06);
      /* I TRATTI DOPPI SI TOLGONO QUI, sul foglio e in millimetri, dopo il
         ritaglio: la tolleranza con cui si decide che due tratti sono lo
         stesso tratto è un ventesimo di millimetro, e un ventesimo di
         millimetro vuol dire qualcosa solo sul foglio — nelle unità del file
         può valere un metro. Dopo il ritaglio e non prima perché anche il
         ritaglio può lasciare due pezzi sovrapposti.
         Si rifà a ogni refit invece di una volta all'importazione: così vale
         anche per quello che si disegna nell'editor, e un tratto ripassato a
         mano sopra a un altro non arriva alla penna. */
      var pulito = SvgImport.senzaDoppioni(
        l.ritaglio ? SvgImport.ritaglia(mm, l.ritaglio) : mm);
      l.doppi = pulito.tolti;
      doppi += pulito.tolti;
      l.art = pulito;

      if (!l.visibile) continue;
      for (var j = 0; j < l.art.length; j++) { art.push(l.art[j]); di.push(l.id); }
    }

    State.data.art = art.length ? art : null;
    State.data.artDi = di;
    State.data.artName = nomeComplessivo();
    State.data.artDoppi = doppi;

    /* Ogni cambio invalida il programma: le coordinate non sono più quelle,
       e gli indici delle pause nemmeno. */
    prep = null;
    ultima = null;
    svuotaPause();
    document.getElementById('prep').hidden = true;

    Paper.rebuildPath();
    renderElenco();
    mostraCampi();
    if (window.Selezione) Selezione.ridisegna();
  }

  function nomeComplessivo() {
    var v = livelli.filter(function (l) { return l.visibile; });
    if (!v.length) return null;
    return v.length === 1 ? v[0].nome : 'composizione';
  }

  /* ------------------------- i campi e l'elenco ------------------------- */

  /* I SEGNI DELLA RIGA, disegnati e non scritti.
   *
   * Prima erano caratteri: un pallino pieno e uno vuoto per la visibilità,
   * due triangolini per l'ordine, una matita per il cambio penna. Un pallino
   * non dice «visibile»: lo dice solo a chi lo sa già. Un occhio sì, e un
   * occhio sbarrato dice il contrario senza che nessuno glielo spieghi.
   *
   * Le tre lineette sono la presa: si prendono e si trascina la riga, che è
   * il gesto con cui si riordina un elenco dappertutto. Due frecce facevano
   * la stessa cosa in due click e senza far vedere dove si andava a finire.
   */
  var SEGNI = {
    presa: '<svg viewBox="0 0 16 16"><path d="M3 5h10M3 8h10M3 11h10"/></svg>',
    occhio: '<svg viewBox="0 0 18 14">' +
            '<path d="M1 7c2.6-4 5.3-6 8-6s5.4 2 8 6c-2.6 4-5.3 6-8 6S3.6 11 1 7z"/>' +
            '<circle cx="9" cy="7" r="2.4"/></svg>',
    chiuso: '<svg viewBox="0 0 18 14">' +
            '<path d="M1 7c2.6-4 5.3-6 8-6s5.4 2 8 6c-2.6 4-5.3 6-8 6S3.6 11 1 7z"/>' +
            '<circle cx="9" cy="7" r="2.4"/>' +
            '<path class="sbarra" d="M2 13L16 1"/></svg>',
    penna: '<svg viewBox="0 0 16 16">' +
           '<path d="M11.2 1.8l3 3-8 8-4 1 1-4z"/><path d="M10 3l3 3"/></svg>',
    quadro: '<svg viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="2"/></svg>',
    spunta: '<svg viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="2"/>' +
            '<path class="segno" d="M4 7.3l2 2 4-4.6"/></svg>',
    cestino: '<svg viewBox="0 0 14 14"><path d="M2.5 3.5h9M5.5 3.5V2h3v1.5' +
             'M3.5 3.5l.7 9h5.6l.7-9M6 6v4M8 6v4"/></svg>'
  };

  function renderElenco() {
    var box = document.getElementById('livelli');
    var testa = document.getElementById('liv-testa');
    /* «Salva» ha senso solo se c'è qualcosa da salvare, e quel qualcosa sono
       i livelli: sta qui perché qui si sa quanti ce ne sono. */
    var sv = document.getElementById('btn-save-prog');
    if (sv) {
      sv.disabled = !livelli.length;
      sv.title = livelli.length
        ? 'Salva il lavoro in un SVG che questa pagina sa riaprire dov\'era: ' +
          'livelli, forme modificate, foglio e cambi penna'
        : 'Niente da salvare: non c\'è nessun livello';
    }
    if (!box) return;
    box.hidden = !livelli.length;
    if (testa) testa.hidden = !livelli.length;
    if (!livelli.length) { box.innerHTML = ''; return; }

    var out = '';
    for (var i = 0; i < livelli.length; i++) {
      var l = livelli[i];
      var preso = selezionati.indexOf(l.id) >= 0;
      out += '<div class="liv-riga' + (preso ? ' scelto' : '') +
             (l.id === scelto && selezionati.length > 1 ? ' primario' : '') +
             (l.visibile ? '' : ' spento') + '" data-liv="' + l.id + '">' +

             '<span class="liv-presa" data-presa="' + l.id +
             '" title="Trascina per cambiare l\'ordine di stampa">' +
             SEGNI.presa + '</span>' +

             '<span class="liv-n">' + (i + 1) + '</span>' +

             '<button type="button" class="liv-ic liv-chk" data-sel="' + l.id +
             '" title="' + (preso ? 'Toglilo dalla selezione' : 'Scegli questo livello') +
             '">' + (preso ? SEGNI.spunta : SEGNI.quadro) + '</button>' +

             /* IL PALLINO C'È SEMPRE, anche vuoto: è da lì che si sceglie la
                penna, e un livello senza tinta — disegnato a mano — è
                proprio quello che ne ha più bisogno. Vuoto, è un cerchietto
                tratteggiato: si vede che manca qualcosa. */
             (function (c, scelta) {
                return '<button type="button" class="tinta' + (c ? '' : ' vuota') +
                  (scelta ? ' scelta' : '') + '" data-pen="' + l.id + '"' +
                  (c ? ' style="background:' + esc(c) + '"' : '') +
                  ' title="' + (c
                    ? 'Penna ' + esc(c) + (scelta ? ' — scelta a mano' : ' — dal file')
                    : 'Nessuna penna: passaci sopra per sceglierla') +
                  '"></button>';
             })(tintaDi(l), !!l.penna) +

             '<button type="button" class="liv-nome" data-nome="' + l.id +
             '" title="' + esc(l.nome) + ' — ' + l.art.length +
             ' tratti' + (tintaDi(l) ? ', penna ' + esc(tintaDi(l)) : '') +
             '. Doppio clic: riquadro di selezione sul foglio">' +
             esc(l.nome) + '</button>' +

             (l.origine
                ? '<button type="button" class="liv-edit' +
                  (l.mostraOrigine ? '' : ' attivo') + '" data-edit="' + l.id +
                  '" title="' + (l.mostraOrigine
                     ? 'Modifiche nascoste: clicca per rimetterle'
                     : 'Modificato nell\'editor: clicca per nascondere le modifiche') +
                  '">edit</button>'
                : '') +

             '<button type="button" class="liv-ic liv-penna' +
             (l.cambioPenna && i > 0 ? ' attivo' : '') + '" data-penna="' + l.id +
             '"' + (i === 0 ? ' disabled' : '') +
             ' title="' + (i === 0
                ? 'Il primo livello non ha un prima in cui fermarsi'
                : (l.cambioPenna ? 'La stampa si ferma prima di questo livello: ' +
                                   'clicca per non fermarla'
                                 : 'Clicca per fermare la stampa prima di questo ' +
                                   'livello e cambiare penna')) + '">' +
             SEGNI.penna + '</button>' +

             '<button type="button" class="liv-ic" data-occhio="' + l.id +
             '" title="' + (l.visibile ? 'Nascondi' : 'Mostra') + '">' +
             (l.visibile ? SEGNI.occhio : SEGNI.chiuso) + '</button>' +

             '<button type="button" class="liv-ic liv-del" data-del="' + l.id +
             '" title="togli">' + SEGNI.cestino + '</button>' +
             '</div>';
    }
    box.innerHTML = out;
    notaPenne();
  }

  /* DUE LIVELLI DELLA STESSA PENNA, LONTANI FRA LORO, COSTANO DUE FERMATE.
   *
   * L'ordine dei livelli è l'ordine di stampa, e ogni livello che chiede
   * una penna diversa è una fermata in cui si sta lì a smontare e montare.
   * Nero, rosso, nero vuol dire due cambi penna; nero, nero, rosso ne vuole
   * uno, e disegna esattamente le stesse righe. Il riordino lo fa l'utente
   * trascinando — qui non si tocca niente da soli, perché l'ordine dei
   * livelli decide anche che cosa finisce SOPRA a che cosa, e spostare un
   * livello per risparmiare una fermata può cambiare il disegno.
   *
   * Si contano i BLOCCHI di colore: quanti gruppi di livelli vicini della
   * stessa penna ci sono. Se i blocchi sono più dei colori diversi, vuol
   * dire che un colore è spezzato in due pezzi lontani, e la differenza è
   * esattamente quante fermate si risparmierebbero.
   */
  function notaPenne() {
    var el = document.getElementById('liv-penne');
    if (!el) return;
    var vis = livelli.filter(function (l) { return l.visibile; });
    var seq = vis.map(function (l) { return tintaDi(l); });

    var blocchi = 0, distinti = {}, quanti = 0;
    for (var i = 0; i < seq.length; i++) {
      if (!seq[i]) continue;                       // senza tinta non si raggruppa
      if (!(seq[i] in distinti)) { distinti[seq[i]] = 0; quanti++; }
      distinti[seq[i]]++;
      if (i === 0 || seq[i - 1] !== seq[i]) blocchi++;
    }

    /* L'altra metà: una fermata messa FRA DUE LIVELLI DELLA STESSA PENNA
       è una fermata per montare la penna che c'è già. */
    var inutili = 0;
    for (var j = 1; j < vis.length; j++) {
      if (vis[j].cambioPenna && seq[j] && seq[j] === seq[j - 1]) inutili++;
    }

    var dice = [];
    if (blocchi > quanti) {
      var n = blocchi - quanti;
      dice.push('<b>' + (n > 1 ? n + ' cambi penna evitabili' : 'Un cambio penna evitabile') +
                '</b>: ci sono livelli della stessa penna che non stanno ' +
                'vicini. Trascinandoli uno dopo l\'altro la macchina si ferma ' +
                (n > 1 ? n + ' volte in meno' : 'una volta in meno') +
                ', e il disegno è lo stesso.');
    }
    if (inutili) {
      dice.push('<b>' + (inutili > 1 ? inutili + ' fermate' : 'Una fermata') +
                ' fra livelli della stessa penna</b>: si smonta e si rimonta ' +
                'la penna che è già dentro. Il simbolo della penna su quella ' +
                'riga la toglie.');
    }
    el.hidden = !dice.length;
    el.innerHTML = dice.join(' ');
  }

  /* ===================== LA TAVOLOZZA A COMPARSA =====================
   *
   * Si apre passando sopra al pallino della penna, e da lì si sceglie fra
   * le penne che si hanno in cassetto. Il «+» ne aggiunge una.
   *
   * Compare al PASSAGGIO e non al clic perché scegliere la penna è una
   * cosa che si fa guardando il foglio, non navigando un menu: il
   * movimento che serve è «passa, guarda, premi». Ma si chiude solo
   * quando il mouse ha lasciato SIA il pallino SIA il riquadro — se no
   * sparirebbe nel mezzo centimetro che c'è fra i due, che è il difetto
   * classico dei menu che si aprono al passaggio.
   */
  var tav = null, tavPer = null, tavChiudi = null;

  function tavolozzaChiudi() {
    if (tavChiudi) { clearTimeout(tavChiudi); tavChiudi = null; }
    if (tav) { tav.remove(); tav = null; tavPer = null; }
  }

  function tavolozzaFraPoco() {
    if (tavChiudi) clearTimeout(tavChiudi);
    tavChiudi = setTimeout(tavolozzaChiudi, 260);
  }

  function tavolozzaResta() {
    if (tavChiudi) { clearTimeout(tavChiudi); tavChiudi = null; }
  }

  function tavolozzaApri(bottone, id) {
    if (tavPer === id && tav) { tavolozzaResta(); return; }
    tavolozzaChiudi();
    var l = trova(id);
    if (!l) return;
    tavPer = id;

    var ora = tintaDi(l), dalFile = tintaSoloDalFile(l);
    var html = '<div class="tav-titolo">Penna del livello</div><div class="tav-righe">';
    tavolozza().forEach(function (p) {
      html += '<button type="button" class="tav-pen' + (p.colore === ora ? ' ora' : '') +
              '" data-tav="' + esc(p.colore) + '" title="' + esc(p.nome) + '">' +
              '<span class="tinta" style="background:' + esc(p.colore) + '"></span>' +
              '<span class="tav-nome">' + esc(p.nome) + '</span></button>';
    });
    html += '<button type="button" class="tav-pen tav-piu" data-tav-piu="1" ' +
            'title="Aggiungi una penna"><span class="tinta vuota">+</span>' +
            '<span class="tav-nome">aggiungi</span></button>';
    html += '</div>';
    /* Tornare indietro deve essere possibile: la tinta del file non è stata
       cancellata, è solo coperta. */
    if (l.penna) {
      html += '<button type="button" class="tav-torna" data-tav-torna="1">' +
              (dalFile ? 'Rimetti il colore del file (' + esc(dalFile) + ')'
                       : 'Togli la penna scelta') + '</button>';
    }

    tav = document.createElement('div');
    tav.className = 'tavolozza';
    tav.innerHTML = html;
    document.body.appendChild(tav);

    /* FUORI DALLA COLONNA, all'altezza della sua riga.
       Sotto coprirebbe le righe degli altri livelli, e di fianco al
       pallino coprirebbe i nomi: la prima cosa che si fa dopo aver scelto
       una penna è guardare quella del livello accanto, e per guardarla
       bisogna vederla. A destra della colonna c'è il foglio, che per
       qualche secondo si può coprire. Se a destra non ci sta, va a
       sinistra. */
    var r = bottone.getBoundingClientRect();
    var colonna = (document.getElementById('livelli') || bottone).getBoundingClientRect();
    var w = tav.offsetWidth, h = tav.offsetHeight;
    var x = colonna.right + 12;
    if (x + w > window.innerWidth - 8) x = Math.max(8, colonna.left - w - 12);
    var y = Math.max(8, Math.min(window.innerHeight - h - 8,
                                 r.top + r.height / 2 - h / 2));
    tav.style.left = x + 'px';
    tav.style.top = y + 'px';

    tav.addEventListener('pointerenter', tavolozzaResta);
    tav.addEventListener('pointerleave', tavolozzaFraPoco);
    tav.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tav) { scegliPenna(id, b.dataset.tav); tavolozzaChiudi(); }
      else if (b.dataset.tavTorna) { scegliPenna(id, null); tavolozzaChiudi(); }
      else if (b.dataset.tavPiu) { pennaNuova(id); }
    });
  }

  /* IL SELETTORE: due cursori, tinta e chiarezza.
   *
   * Non è una tavola completa ed è apposta. Serve a dire «ho comprato una
   * penna di questo colore», e per quello bastano l'arcobaleno e quanto è
   * chiaro o scuro. Due cursori invece del solo arcobaleno perché il
   * GRIGIO — che è una delle quattro penne — dall'arcobaleno non esce:
   * è una tinta qualunque con la saturazione a zero, e senza il secondo
   * cursore non ci si arriva.
   */
  function pennaNuova(id) {
    tavolozzaChiudi();
    var box = document.createElement('div');
    box.className = 'tavolozza scelta-colore';
    box.innerHTML =
      '<div class="tav-titolo">Una penna nuova</div>' +
      '<div class="sc-prova" id="sc-prova"></div>' +
      '<label class="sc-riga">Tinta<input type="range" id="sc-h" min="0" max="360" value="210"></label>' +
      '<label class="sc-riga">Chiarezza<input type="range" id="sc-l" min="0" max="100" value="45"></label>' +
      '<label class="sc-riga">Vivezza<input type="range" id="sc-s" min="0" max="100" value="70"></label>' +
      '<label class="sc-riga sc-nome">Nome<input type="text" id="sc-nome" placeholder="verde chiaro" maxlength="18"></label>' +
      '<div class="sc-fondo"><code id="sc-hex">#000000</code>' +
      '<button type="button" class="btn btn-small" id="sc-no">Lascia</button>' +
      '<button type="button" class="btn btn-small btn-primary" id="sc-si">Aggiungi</button></div>';
    document.body.appendChild(box);
    box.style.left = Math.max(8, (window.innerWidth - box.offsetWidth) / 2) + 'px';
    box.style.top = Math.max(8, (window.innerHeight - box.offsetHeight) / 3) + 'px';

    var h = box.querySelector('#sc-h'), s = box.querySelector('#sc-s'),
        lu = box.querySelector('#sc-l'), prova = box.querySelector('#sc-prova'),
        hex = box.querySelector('#sc-hex'), nome = box.querySelector('#sc-nome');

    function aggiorna() {
      var c = hslEsa(+h.value, +s.value / 100, +lu.value / 100);
      prova.style.background = c;
      hex.textContent = c;
      /* L'arcobaleno del cursore della tinta segue la vivezza e la
         chiarezza scelte: un arcobaleno fisso mentirebbe su che cosa si
         sta per ottenere. */
      h.style.background = 'linear-gradient(to right,' +
        [0, 60, 120, 180, 240, 300, 360].map(function (g) {
          return hslEsa(g, +s.value / 100, +lu.value / 100);
        }).join(',') + ')';
      lu.style.background = 'linear-gradient(to right,' +
        [0, 50, 100].map(function (v) {
          return hslEsa(+h.value, +s.value / 100, v / 100);
        }).join(',') + ')';
      s.style.background = 'linear-gradient(to right,' +
        [0, 100].map(function (v) {
          return hslEsa(+h.value, v / 100, +lu.value / 100);
        }).join(',') + ')';
    }
    [h, s, lu].forEach(function (c) { c.addEventListener('input', aggiorna); });
    aggiorna();

    function chiudi() { box.remove(); }
    box.querySelector('#sc-no').addEventListener('click', chiudi);
    box.querySelector('#sc-si').addEventListener('click', function () {
      var c = hex.textContent;
      aggiungiPenna(c, (nome.value || '').trim() || c);
      scegliPenna(id, c);
      chiudi();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') chiudi();
      if (e.key === 'Enter') box.querySelector('#sc-si').click();
    });
    nome.focus();
  }

  /* Da tinta/vivezza/chiarezza a esadecimale. Sta qui e non in una
     libreria perché sono otto righe, e una libreria per otto righe è una
     dipendenza da aggiornare per sempre. */
  function hslEsa(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
    return '#' + r.map(function (v) {
      return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2);
    }).join('');
  }

  /* RIORDINARE TRASCINANDO.
   *
   * Si prende la riga dalle tre lineette e la si porta su o giù. Mentre si
   * trascina l'ordine CAMBIA DAVVERO: le altre righe si spostano sotto il
   * dito, e quando si lascia si lascia dove si vede. Un'anteprima finta —
   * una riga fantasma, una linea fra due righe — direbbe la stessa cosa in
   * modo meno diretto, e poi bisognerebbe tenerla d'accordo con la realtà.
   *
   * Il costo da evitare è il ricalcolo: muovere un livello rimappa tutti i
   * disegni dentro ai loro rettangoli, e farlo a ogni pixel del mouse
   * impasterebbe la pagina. Durante il trascinamento si muove solo l'elenco;
   * i disegni si rifanno una volta, al rilascio. Tanto l'ordine cambia solo
   * QUANDO si stampa, non dove sta il disegno sul foglio.
   */
  function riordinabile(box) {
    var preso = null;

    box.addEventListener('pointerdown', function (e) {
      var man = e.target.closest('[data-presa]');
      if (!man || e.button !== 0) return;
      preso = { id: man.dataset.presa, mosso: false };
      box.setPointerCapture(e.pointerId);
      box.classList.add('riordino');
      e.preventDefault();
    });

    box.addEventListener('pointermove', function (e) {
      if (!preso) return;
      var righe = box.querySelectorAll('[data-liv]');
      if (!righe.length) return;

      /* Dove cadrebbe adesso: la riga il cui centro sta sotto al puntatore.
         Si guarda il centro e non il bordo perché così lo scambio avviene a
         metà strada, cioè quando a occhio il sorpasso è avvenuto. */
      var dove = righe.length - 1;
      for (var i = 0; i < righe.length; i++) {
        var r = righe[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { dove = i; break; }
      }

      var ora = indice(preso.id);
      if (ora < 0 || dove === ora) return;
      var l = livelli.splice(ora, 1)[0];
      livelli.splice(dove, 0, l);
      preso.mosso = true;
      renderElenco();
      box.classList.add('riordino');
    });

    ['pointerup', 'pointercancel'].forEach(function (ev) {
      box.addEventListener(ev, function (e) {
        if (!preso) return;
        var mosso = preso.mosso;
        preso = null;
        box.classList.remove('riordino');
        try { box.releasePointerCapture(e.pointerId); } catch (x) { /* già rilasciato */ }
        /* Il ricalcolo UNA VOLTA, alla fine: durante il trascinamento
           l'elenco è già quello giusto, i disegni no, e nessuno li guardava. */
        if (mosso) refit();
      });
    });
  }

  /* L'ETICHETTA «EDIT»: mostra l'originale al posto delle modifiche, e
     viceversa. Non è un annulla — le modifiche non si perdono, si mettono da
     parte — ed è la domanda che uno si fa guardando un disegno ritoccato:
     «com'era prima?». Due clic e si è visto. */
  function commutaOrigine(id) {
    var l = trova(id);
    if (!l || !l.origine) return;
    var ora = { forme: l.forme, box: l.box, ritaglio: l.ritaglio };
    l.forme = l.origine.forme;
    l.box = l.origine.box;
    l.ritaglio = l.origine.ritaglio;
    l.origine = ora;
    l.mostraOrigine = !l.mostraOrigine;
    l.raw = Tracciato.appiattisciTutte(l.forme, l.tol);
    refit();
    renderElenco();
  }

  /* La fotografia di prima delle modifiche. La prende l'editor appena tocca
     qualcosa, una volta sola: la seconda modifica non deve spostare il
     «prima», se no l'etichetta mostrerebbe il penultimo stato invece di
     quello con cui il file è arrivato. */
  function segnaOrigine(id) {
    var l = id ? trova(id) : corrente();
    if (!l || l.origine) return;
    l.origine = {
      forme: JSON.parse(JSON.stringify(l.forme)),
      box: l.box ? { x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h } : null,
      ritaglio: l.ritaglio ? { x: l.ritaglio.x, y: l.ritaglio.y,
                               w: l.ritaglio.w, h: l.ritaglio.h } : null
    };
    l.mostraOrigine = false;
    renderElenco();
  }

  /* I campi in fondo alla colonna parlano del livello SCELTO, non di tutti:
     scala, rotazione e cambio penna sono proprietà sue. Senza un livello
     scelto non hanno niente da dire e si spengono. */
  function mostraCampi() {
    var l = corrente();
    var scala = document.getElementById('art-scale');
    var rot = document.getElementById('art-rot');
    var nota = document.getElementById('art-deform');
    var riga = document.getElementById('art-campi');
    var gruppo = document.getElementById('art-gruppo');

    if (riga) riga.hidden = !l;
    if (!l) { if (nota) nota.hidden = true; if (gruppo) gruppo.hidden = true; return; }

    rot.value = l.rot;

    /* CON PIU' LIVELLI SCELTI i campi non parlano di tutti: scala e rotazione
       sono proprietà di un livello solo, e applicarle al gruppo vorrebbe dire
       ruotare ogni disegno attorno a un centro che non è il suo. Il riquadro
       sul foglio invece vale per tutti. Detto, non lasciato indovinare. */
    if (gruppo) {
      gruppo.hidden = selezionati.length < 2;
      if (!gruppo.hidden) {
        gruppo.innerHTML = selezionati.length + ' livelli scelti: questi due campi ' +
          'valgono per <b>' + esc(l.nome) + '</b>, il riquadro sul foglio per tutti.';
      }
    }

    var pc = percentuali();
    if (!pc) { if (nota) nota.hidden = true; return; }

    /* Il campo dice la percentuale in larghezza. Quando l'altezza non
       coincide il disegno è schiacciato, e il campo da solo mentirebbe: la
       differenza va scritta, non nascosta dietro a un numero solo. */
    scala.value = Math.round(pc.x * 10) / 10;
    if (!nota) return;
    var storto = Math.abs(pc.x - pc.y) > 0.2;
    nota.hidden = !storto;
    if (storto) {
      nota.textContent = 'Deformato: larghezza ' + (Math.round(pc.x * 10) / 10) +
                         ' %, altezza ' + (Math.round(pc.y * 10) / 10) +
                         ' %. Scrivi una percentuale qui sopra per tornare in proporzione.';
    }
  }

  /* ----------------------- preparazione stampa ---------------------- */

  function sommaStat(a, b) {
    return {
      tratti: a.tratti + b.tratti,
      punti: a.punti + b.punti,
      disegno: a.disegno + b.disegno,
      spostamento: a.spostamento + b.spostamento,
      alzate: a.alzate + b.alzate,
      secondi: a.secondi + b.secondi
    };
  }

  function prepare() {
    var vis = visibili();
    if (!vis.length) { Log.add('err', 'Nessun disegno da preparare.'); return; }

    /* Le velocità e la pausa della penna vengono dal profilo di stampa: sono
       del lavoro, non della macchina, e si cambiano nella tab Impostazioni. */
    var st = Profile.stampa();
    var feedDraw = st.velocitaDisegno, feedTravel = st.velocitaSpostamento;
    var ambito = st.ottimizza || 'livello';

    var t0 = performance.now();
    var gruppi = [];

    if (ambito === 'tutto') {
      /* Un gruppo solo: l'ottimizzatore può spostare un tratto del primo
         livello in mezzo al terzo. È il più veloce e l'unico che rompe i
         cambi penna, per questo qui sotto vengono tolti. */
      var insieme = [];
      vis.forEach(function (l) { insieme = insieme.concat(l.art); });
      var r = Optimize.run(insieme, feedDraw, feedTravel);
      gruppi.push({ id: null, polys: r.polys, prima: r.prima, dopo: r.dopo });
    } else {
      vis.forEach(function (l) {
        if (ambito === 'niente') {
          var s = Optimize.stats(l.art, feedDraw, feedTravel);
          gruppi.push({ id: l.id, polys: l.art, prima: s, dopo: s });
        } else {
          var o = Optimize.run(l.art, feedDraw, feedTravel);
          gruppi.push({ id: l.id, polys: o.polys, prima: o.prima, dopo: o.dopo });
        }
      });
    }
    var ms = Math.round(performance.now() - t0);

    /* Il percorso riordinato diventa quello mostrato: l'anteprima deve far
       vedere quello che la macchina farà davvero, non quello che avrebbe
       fatto prima del riordino. */
    var art = [], di = [], auto = [], penne = [];
    gruppi.forEach(function (g, i) {
      var l = g.id ? trova(g.id) : null;
      if (i > 0 && l && l.cambioPenna) auto.push(art.length);
      /* Dove comincia ogni livello, con che penna. Serve al generatore, che
         lo scrive nel file, e da lì al Sender, che mentre stampa sa sempre
         quale penna è montata — e al cambio penna sa quale mostrare. */
      if (l && g.polys.length) {
        penne.push({ i: art.length, colore: tintaDi(l), nome: l.nome });
      }
      g.polys.forEach(function (p) { art.push(p); di.push(g.id); });
    });

    if (ambito === 'tutto' && vis.some(function (l) { return l.cambioPenna; })) {
      Log.add('err', 'Ottimizzazione su TUTTO: i cambi penna fra livelli sono ' +
                     'stati ignorati, perché i tratti dei livelli finiscono ' +
                     'mescolati. Per tenerli, metti l\'ottimizzazione «per livello».');
    }

    State.data.art = art;
    State.data.artDi = di;
    Paper.rebuildPath();

    var prima = gruppi.reduce(function (a, g) { return a ? sommaStat(a, g.prima) : g.prima; }, null);
    var dopo = gruppi.reduce(function (a, g) { return a ? sommaStat(a, g.dopo) : g.dopo; }, null);

    var o = State.data.sheetOrigin;
    var machine = art.map(function (p) {
      return p.map(function (q) { return { x: q.x + o.x, y: q.y + o.y }; });
    });

    /* Z è in millimetri veri di penna, in coordinate MACCHINA: Z0 è la
       posizione tappo, in cima, e la quota di contatto è NEGATIVA, circa
       -21,27. Il perché sta in profile.js, sopra zDaGradi(): senza homing
       FluidNC mette lo zero in cima e tronca tutto quello che sta sopra.

       Il contatto non è un numero fisso: è la quota a cui la punta tocca il
       foglio di oggi, misurata col secondo popup di inizio stampa. Finché
       quella misura non c'è si usa il contatto nominale del profilo.

       Il ramo a zero resta solo per il caso «profilo non tarato», in cui le
       quote sono dei segnaposto e FluidNC le troncherebbe: il file esce
       marcato DA TARARE e verifica() blocca la stampa, quindi serve a
       guardare il programma e a nient'altro. */
    var nominale = Profile.zContatto();
    var contatto = State.data.altezzaContatto !== null ? State.data.altezzaContatto
                 : (nominale === null ? 0 : nominale);

    /* Finché i tre angoli del servo non sono stati rilevati non c'è un'alzata
       vera: si mettono 5 mm per poter guardare il programma, e il file lo
       dichiara DA TARARE. */
    var alzata = Profile.alzataMm();
    var tarata = alzata !== null;
    if (alzata === null) alzata = 5;
    if (st.alzataLavoro !== null && st.alzataLavoro > 0) {
      alzata = Math.min(alzata, st.alzataLavoro);
    }

    /* La posizione tappo è una quota del profilo macchina, non di stampa: è
       dove il meccanismo lascia spazio al tappo, e non dipende dal foglio.
       Per questo è ASSOLUTA e non contatto + qualcosa: è il fine corsa alto,
       Z0. Sommarla al contatto misurato darebbe una quota sopra lo zero, che
       mapConstrain tronca comunque — e con un foglio spesso finirebbe fuori
       corsa di quel tanto. */
    var tappo = Profile.zTappo();

    ultima = {
      machine: machine,
      auto: auto,
      penne: penne,
      opt: {
        penUp: contatto + alzata,
        penDown: contatto,
        penTappo: tappo,
        ritorno: Profile.puntoHome(),
        pennaTarata: tarata,
        pausaMs: st.pausaPennaMs,
        feedDraw: feedDraw,
        feedTravel: feedTravel,
        feedPen: 600
      },
      r: { prima: prima, dopo: dopo },
      ms: ms
    };
    componi();
  }

  /* Ricompone il file dal percorso già riordinato. La chiamano prepare() e
     ogni modifica all'elenco delle pause. */
  function componi() {
    if (!ultima) return;
    var opt = {};
    for (var k in ultima.opt) opt[k] = ultima.opt[k];

    /* I cambi penna automatici fra livelli e quelli messi a mano finiscono
       nello stesso elenco: per il generatore sono la stessa cosa, e averne
       due a lui non servirebbe a niente. */
    var tutte = ultima.auto.concat(pause).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    }).sort(function (a, b) { return a - b; });

    opt.pause = tutte;
    opt.penne = ultima.penne;
    prep = Gcode.build(ultima.machine, opt);
    showStats(ultima.r, ultima.ms, tutte.length);
    /* Il pulsante del cambio penna si accende solo quando un programma c'è:
       senza questa chiamata nascerebbe spento e ci resterebbe, perché
       l'evento del percorso parte prima che il file esista. */
    if (window.Preview && Preview.aggiornaPause) Preview.aggiornaPause();
    if (window.Paper && Paper.renderPause) Paper.renderPause();
  }

  /* ------------------------ i cambi penna ------------------------- */

  /* L'elenco completo, automatici compresi: lo usano il piano per disegnare i
     segni e l'anteprima per sapere se un tratto è già un punto di fermata. */
  function elencoPause() {
    if (!ultima) return pause.slice();
    return ultima.auto.concat(pause).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    }).sort(function (a, b) { return a - b; });
  }

  function pauseAutomatiche() { return ultima ? ultima.auto.slice() : []; }

  function programmaPronto() { return !!prep; }

  function svuotaPause() {
    if (!pause.length) return;
    pause = [];
    if (window.Paper && Paper.renderPause) Paper.renderPause();
  }

  /* Una pausa prima del primo tratto non vuol dire niente: la penna giusta la
     si mette nel morsetto prima di partire. E su un confine che è già una
     fermata automatica non c'è niente da aggiungere. */
  function pausaPossibile(k) {
    var art = State.data.art;
    if (!prep || !art || k < 1 || k >= art.length) return false;
    return pauseAutomatiche().indexOf(k) < 0;
  }

  function commutaPausa(k) {
    if (!pausaPossibile(k)) return false;
    var i = pause.indexOf(k);
    if (i >= 0) pause.splice(i, 1);
    else { pause.push(k); pause.sort(function (a, b) { return a - b; }); }
    componi();
    Log.add('msg', i >= 0
      ? 'Tolto il cambio penna prima del tratto ' + k + '.'
      : 'Cambio penna prima del tratto ' + k + '.');
    return true;
  }

  function showStats(r, ms, nPause) {
    var d = r.dopo, p = r.prima;
    document.getElementById('prep').hidden = false;
    document.getElementById('st-time').textContent = Gcode.durata(d.secondi);
    document.getElementById('st-paths').textContent = d.tratti + ' (' + d.punti + ' punti)';
    document.getElementById('st-draw').textContent = Math.round(d.disegno) + ' mm';
    document.getElementById('st-travel').textContent = Math.round(d.spostamento) + ' mm';
    document.getElementById('st-lifts').textContent = d.alzate +
      (nPause ? ' · ' + nPause + ' cambi penna' : '');

    var risp = p.secondi - d.secondi;
    document.getElementById('st-gain').textContent = risp > 1
      ? 'Ottimizzazione: ' + Gcode.durata(risp) + ' risparmiati, spostamenti da ' +
        Math.round(p.spostamento) + ' a ' + Math.round(d.spostamento) + ' mm, ' +
        'tratti da ' + p.tratti + ' a ' + d.tratti + '. Calcolato in ' + ms + ' ms.'
      : '';

    document.getElementById('gcode-out').value = prep;
    var dp = State.data.artDoppi || 0;
    Log.add('msg', 'G-code pronto: ' + prep.split('\n').length + ' righe, ' +
                   Gcode.durata(d.secondi) + ' stimati' +
                   (nPause ? ', ' + nPause + ' cambi penna' : '') + '.' +
                   (dp ? ' ' + dp + (dp === 1 ? ' tratto doppio non ci va' :
                                     ' tratti doppi non ci vanno') +
                         ': la penna ci sarebbe passata due volte.' : ''));
  }

  /* L'invio passa dal Sender, che manda le righe una per una sul WebSocket.
     Qui si decide solo SE si può partire; come si parte è affar suo. */
  function invia() {
    if (!prep) { Log.add('err', 'Nessun programma preparato.'); return; }

    if (State.data.mock) {
      Log.add('msg', 'Modalità finta: il programma non viene inviato a nessuno. ' +
                     'Sarebbero partite ' +
                     Sender.prepara(prep).length + ' righe di comando.');
      return;
    }

    /* Senza origine non si stampa. Le coordinate del programma sono assolute e
       riferite all'azzeramento sui blocchi: mandarle a una macchina che non sa
       dove sia significa disegnare da qualche parte, forse fuori dalla tavola. */
    if (!State.data.azzerata) {
      Log.add('err', 'La macchina non è azzerata: le coordinate del programma ' +
                     'non avrebbero un riferimento. Fai prima l\'azzeramento.');
      return;
    }

    var name = (State.data.artName || 'disegno').replace(/\.svg$/i, '');
    Sender.avvia(prep, name);
  }

  function download() {
    if (!prep) return;
    var name = (State.data.artName || 'disegno').replace(/\.svg$/i, '') + '.gcode';
    var blob = new Blob([prep], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    Log.add('msg', 'Scaricato ' + name + '.');
  }

  function init() {
    document.getElementById('art-scale').addEventListener('change', scalaDalCampo);
    document.getElementById('art-rot').addEventListener('change', ruotaDalCampo);
    document.getElementById('btn-generate').addEventListener('click', prepare);
    document.getElementById('btn-download').addEventListener('click', download);
    document.getElementById('btn-clear-file').addEventListener('click', clear);

    /* Un ascoltatore sulla lista invece di uno per pulsante: i livelli
       nascono e muoiono mentre la pagina è aperta, e agganciare i listener ai
       nodi vuol dire ricordarsi di riagganciarli ogni volta — cioè
       dimenticarsene una volta. */
    var box = document.getElementById('livelli');
    if (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        var d = b.dataset;
        /* La spunta COMMUTA, il nome sceglie quello e basta: due gesti per
           due intenzioni diverse, e la spunta è l'unico modo di arrivare a
           non aver scelto niente. */
        if (d.pen) tavolozzaApri(b, d.pen);   // il pallino: anche al clic
        else if (d.sel) seleziona(d.sel, 'aggiungi');
        else if (d.nome) seleziona(d.nome);
        else if (d.penna) commutaCambioPenna(d.penna);
        else if (d.edit) commutaOrigine(d.edit);
        else if (d.occhio) commutaVisibile(d.occhio);
        else if (d.del) rimuovi(d.del);
      });

      /* Doppio clic sulla riga: il riquadro di selezione si apre sul foglio
         per quel livello. È la strada corta per lo stesso gesto che si fa
         col doppio clic sul disegno, e serve quando i disegni sono
         sovrapposti e mirarli col mouse è un terno al lotto. */
      box.addEventListener('dblclick', function (e) {
        var r = e.target.closest('[data-liv]');
        if (!r || e.target.closest('[data-del]') || e.target.closest('[data-occhio]')) return;
        seleziona(r.dataset.liv);
        if (window.Selezione) Selezione.apri();
      });

      /* Il passaggio del mouse sul pallino apre la tavolozza. Delegato,
         perché l'elenco si ridisegna tutto a ogni modifica e dei
         gestori attaccati riga per riga ne resterebbero in giro. */
      box.addEventListener('pointerover', function (e) {
        var b = e.target.closest('button[data-pen]');
        if (b) tavolozzaApri(b, b.dataset.pen);
        else if (!e.target.closest('.tavolozza')) tavolozzaFraPoco();
      });
      box.addEventListener('pointerleave', tavolozzaFraPoco);

      riordinabile(box);
    }

    var sample = document.getElementById('btn-sample');
    if (window.SAMPLE_SVG) {
      sample.addEventListener('click', function () {
        load(window.SAMPLE_SVG, window.SAMPLE_NAME || 'esempio.svg');
      });
    } else {
      sample.hidden = true;
    }

    /* Foglio nuovo, collocazioni nuove: i rettangoli di prima erano misurati
       su un foglio che non c'è più. */
    State.on('paper', function () {
      if (!livelli.length) return;
      livelli.forEach(function (l) { l.box = null; l.ritaglio = null; });
      refit();
    });

    renderElenco();
    mostraCampi();
  }

  return {
    init: init, load: load, clear: clear, refit: refit,
    prepare: prepare, invia: invia,
    progetto: progetto, daProgetto: daProgetto,

    riquadro: riquadro, riquadroPieno: riquadroPieno,
    collocaA: collocaA, ritagliaA: ritagliaA, ritagliato: ritagliato,
    ruotaA: ruotaA, statoRot: statoRot, aggiornaCampi: mostraCampi,
    percentuali: percentuali,

    scalaMm: scalaMm,
    livelli: elenco, coloreLivello: coloreLivello,
    tavolozza: tavolozza, aggiungiPenna: aggiungiPenna, togliPenna: togliPenna,
    scegliPenna: scegliPenna,
    seleziona: seleziona, sceltoId: sceltoId, quale: quale,
    deseleziona: deseleziona, scelti: scelti, segnaOrigine: segnaOrigine,
    principale: principale, daFoglio: daFoglio, sfondoPer: sfondoPer,
    commutaOrigine: commutaOrigine,
    rimuovi: rimuovi, muovi: muovi, commutaVisibile: commutaVisibile,
    forme: formeScelte, rigenera: rigenera, nuovo: nuovo,
    mappa: mappa, incolla: incolla,
    istantanea: istantanea, ripristina: ripristina,
    commutaCambioPenna: commutaCambioPenna,

    pause: elencoPause, pauseAutomatiche: pauseAutomatiche,
    commutaPausa: commutaPausa, programmaPronto: programmaPronto,
    svuotaPause: svuotaPause, pausaPossibile: pausaPossibile
  };
})();
