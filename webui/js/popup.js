/* I tre popup di inizio stampa.
 *
 * Sono tre perché misurano tre cose diverse, e nessuna delle tre si può
 * salvare nel profilo: dipendono da dove hai appoggiato il foglio oggi.
 *
 *   1. l'ORIGINE: dove sta lo zero della macchina. Si prende appoggiando i
 *      carrelli ai blocchi, a mano.
 *   2. l'ALTEZZA DI CONTATTO: a che quota la punta tocca QUESTO foglio. Un
 *      decimo di spessore di carta la sposta, e lo spessore non lo conosci.
 *   3. L'ANGOLO DEL FOGLIO: dove sta il foglio sul piano. È arbitrario: il
 *      foglio lo appoggi dove capita.
 *
 * Le prime due sono misure della macchina, la terza del lavoro — ma tutte e
 * tre valgono per questa stampa e basta, e dopo un riavvio non valgono più.
 * Per questo stanno in State e non nel profilo.
 *
 * Il programma si rigenera DOPO il terzo passo e non prima: l'origine del
 * foglio sposta tutte le coordinate, e l'altezza di contatto sposta la Z.
 * Mandare il G-code preparato con i valori di prima vorrebbe dire disegnare
 * da un'altra parte, o in aria.
 */
var Popup = (function () {

  var box, titolo, passoEtichetta, descrizione, nota, contenitore, okBtn, annullaBtn;
  var corrente = -1, passi = [];

  /* Quale procedura si sta facendo. Le due usano la stessa finestra e lo
     stesso motore, ma finiscono in modo diverso: quella di inizio stampa
     rigenera il programma e lo manda, quella del cambio penna riprende un
     programma che sta già aspettando. */
  var modo = 'stampa';

  /* «PIU' TARDI» DEVE RESTARE PIU' TARDI. La procedura del cambio penna si
     apre da sé quando la stampa arriva al segno; se la si chiude, non deve
     riaprirsi al respiro successivo dello stato — sarebbe un popup che non si
     riesce a chiudere. Si riapre dal pulsante Riprendi, che è il gesto con
     cui si dice «adesso sì». */
  var rimandato = false;

  /* Dove sta il servo durante il montaggio della penna nuova. Serve al tasto
     PROVA del telecomando, che è uno solo e alterna: sul vetro del
     telecomando il disegno della penna mostra già dove si trova, quindi due
     tasti che fanno il contrario l'uno dell'altro sarebbero un tasto di
     troppo. Sul popup restano due pulsanti, perché lì lo spazio c'è. */
  var pennaGiu = true;

  /* ------------------------------- i tre passi ---------------------------- */

  function definisci() {
    return [
      {
        nome: 'Origine della macchina',
        sezioni: { posizione: true, homing: true, assi: true, penna: false },
        /* Il promemoria del tappo sta qui, nel primo passo, perché qui c'è
           l'operatore davanti alla macchina e perché da qui in avanti ogni
           passo muove il servo. A fine stampa la penna resta in posizione
           tappo, quindi all'inizio della stampa dopo il tappo c'è. */
        testo: '<b style="color:var(--warn)">Se la penna ha il tappo, toglilo adesso.</b> ' +
               'La stampa precedente l\'ha lasciata in alto apposta per permetterti ' +
               'di metterlo, e da qui in avanti ogni passo muove la penna.<br><br>' +
               'Appoggia i due carrelli ai blocchi di riferimento, <b>a mano e ' +
               'senza forzarli</b>, poi premi «Homing completato». Quel punto — il ' +
               '<b>punto ai blocchi</b> — diventa lo zero; subito dopo la macchina ' +
               'si sposta da sola al <b>punto home</b>, qualche millimetro più in ' +
               'là, per non lasciare i carrelli appoggiati al riferimento.',
        /* La penna si alza PRIMA di qualsiasi movimento: altrimenti la punta
           striscia sul foglio per tutto il posizionamento. */
        entra: function () { alzaPenna(); },
        pronto: function () { return State.data.azzerata; },
        attesa: 'Finché non hai azzerato, la macchina non sa dove si trova.',
        etichetta: 'Origine completata',
        esci: function () { return true; }
      },
      {
        nome: 'Altezza di contatto col foglio',
        sezioni: { posizione: true, homing: false, assi: false, penna: true },
        testo: 'Abbassa la penna a piccoli passi finché la punta <b>tocca il ' +
               'foglio e lascia il segno</b>. Non serve premere: appena segna, ' +
               'sei alla quota giusta.<br><br>' +
               '<b>Il tappo.</b> Se è ancora infilato, al foglio ci arriva lui e ' +
               'la quota che leggi non è quella della punta.<br><br>' +
               'Le quote della penna sono <b>negative</b>: Z0 è in alto, dove ci ' +
               'sta il tappo, e il foglio sta intorno a Z-21,3.',
        entra: function () {},
        /* Confermare a penna alzata è l'errore che manda in stampa un disegno
           fatto in aria, e non se ne accorge nessuno finché il foglio non esce
           bianco. Si pretende che la penna sia almeno scesa sotto metà alzata.
           La soglia si conta dal contatto NOMINALE e non da zero: zero è il
           tappo, in cima, e «z < metà alzata» lì sarebbe vero sempre. */
        pronto: function () {
          var alzata = Profile.alzataMm(), contatto = Profile.zContatto();
          if (alzata === null || contatto === null) return false;
          return State.data.pos.z < contatto + alzata / 2;
        },
        attesa: 'La penna è ancora troppo in alto: così disegneresti in aria.',
        etichetta: 'Altezza penna completata',
        esci: function () {
          State.data.altezzaContatto = State.data.pos.z;
          Log.add('msg', 'Altezza di contatto per questa stampa: Z ' +
                         State.data.altezzaContatto.toFixed(2) + ' mm.');
          alzaPenna();     // il passo finisce per definizione con la punta che tocca
          return true;
        }
      },
      {
        nome: 'Angolo del foglio',
        sezioni: { posizione: true, homing: false, assi: true, penna: true },

        /* IL TESTO CAMBIA PERCHÉ CAMBIA IL GESTO. Con un foglio più piccolo
           della corsa si tocca il suo angolo e basta. Con un foglio più grande
           quell'angolo sta FUORI dalla corsa — la macchina non ci arriva — e
           chiedere di toccarlo sarebbe chiedere l'impossibile: è la
           configurazione che l'operatore usa davvero, coi fogli tagliati a
           mano più larghi della campata. Allora si tocca un punto qualsiasi
           del foglio che la macchina raggiunge, e si dichiara quanto quel
           punto dista dai due bordi. */
        testo: function () {
          var r = Paper.raggiungibile();
          if (!r.piuGrande) {
            return 'Porta la punta sull\'<b>angolo in basso a sinistra del ' +
                   'foglio</b>. Se vuoi la conferma, abbassa un attimo la penna: ' +
                   'adesso la quota di contatto la conosce, quindi un puntino te ' +
                   'lo dice.';
          }
          return '<b>Questo foglio è più grande della corsa</b>, quindi il suo ' +
                 'angolo in basso a sinistra sta fuori: la macchina non ci ' +
                 'arriva. Porta la punta su un punto del foglio che la macchina ' +
                 'raggiunge — il più comodo è l\'angolo in basso a sinistra del ' +
                 '<b>tratteggio azzurro</b> — e scrivi qui sotto quanto quel ' +
                 'punto dista dal <b>bordo sinistro</b> e dal <b>bordo ' +
                 'inferiore</b> del foglio, col righello sulla carta.';
        },

        /* I due scostamenti arrivano precompilati con quelli che si vedono
           già sullo schermo: nel caso normale l'operatore conferma invece di
           ricopiare, e se il foglio è nella posizione che voleva sono già
           quelli giusti. */
        extra: function () {
          var r = Paper.raggiungibile();
          return '<div class="pop-off"><p class="muted small">Distanza del punto ' +
                 'toccato dai bordi del foglio</p><div class="field-row">' +
                 '<label>Dal bordo sinistro (mm) <input type="number" id="pop-off-x" ' +
                 'step="0.5" value="' + (r.piuGrande ? r.dax.toFixed(0) : '0') + '"></label>' +
                 '<label>Dal bordo inferiore (mm) <input type="number" id="pop-off-y" ' +
                 'step="0.5" value="' + (r.piuGrande ? r.day.toFixed(0) : '0') + '"></label>' +
                 '</div></div>';
        },

        entra: function () {},
        pronto: function () { return State.data.azzerata; },
        attesa: 'Serve una posizione nota.',
        etichetta: 'Inizio foglio completato',
        esci: function () {
          alzaPenna();
          /* L'angolo del foglio è il punto toccato MENO la distanza dai bordi:
             con scostamento zero si ricade esattamente nel caso di prima. */
          var dx = parseFloat((document.getElementById('pop-off-x') || {}).value);
          var dy = parseFloat((document.getElementById('pop-off-y') || {}).value);
          Paper.setSheetOrigin(State.data.pos.x - (isNaN(dx) ? 0 : dx),
                               State.data.pos.y - (isNaN(dy) ? 0 : dy));
          if (!controllaIngombro()) return false;
          /* Da qui il foglio sullo schermo non è più un'ipotesi: è dove sta
             davvero, e si blocca. */
          Paper.fissa(true);
          return true;
        }
      }
    ];
  }

  /* Il nome di un livello arriva dal nome di un file: può contenere di
     tutto, e qui diventa HTML. */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------- il cambio penna -------------------------- */

  /* DUE PASSI, e in mezzo ai due il servo si muove.
   *
   * 1. togli la penna vecchia — il servo è in alto, al tappo, dove c'è più
   *    spazio per sfilarla;
   * 2. il servo scende alla QUOTA DI CONTATTO DEL PROGRAMMA e ci resta;
   *    infili la penna nuova finché tocca il piano e stringi lì.
   *
   * È lo stesso gesto con cui la penna si monta la prima volta, ed è il
   * motivo per cui non c'è niente da misurare e niente da correggere nel
   * G-code: la penna si adatta al programma. Il contrario — misurare dove
   * tocca la penna nuova e spostare tutte le quote che restano — funziona
   * anche, ma è aritmetica messa a rimediare un gesto che si può fare bene.
   *
   * La differenza fra toccare il PIANO qui e il FOGLIO durante i tre popup è
   * lo spessore della carta, un decimo scarso. La banda morta del servo vale
   * 0,9 gradi, cioè 0,29 mm: quel decimo la macchina non sa nemmeno farlo.
   */

  /* La quota a cui il programma in corso appoggia la penna. Senza (un file
     caricato a mano, mai passato dai popup) si usa quella nominale del
     profilo, che è la stessa con cui la penna è stata montata la prima volta. */
  function quotaContatto() {
    var v = Sender.altezzaUsata();
    return v === null ? Profile.zContatto() : v;
  }

  function passiCambioPenna() {
    return [
      {
        nome: 'Togli la penna',
        sezioni: { posizione: true, homing: false, assi: false, penna: false },
        testo: function () {
          return 'La testina è al <b>punto home</b> e la penna è in posizione ' +
                 '<b>tappo</b>, cioè tutta in alto: è lì che c\'è più spazio per ' +
                 'sfilarla.<br><br>' +
                 'Allenta i morsetti e togli la penna. Quando l\'hai tolta premi ' +
                 'il pulsante: il servo <b>scende alla quota di contatto</b> e ci ' +
                 'resta, ed è lì che monterai quella nuova.';
        },
        entra: function () {},
        /* LA PENNA NON SI TOCCA MENTRE LA TESTINA CAMMINA. La finestra si
           apre appena la stampa arriva al segno, ma in quel momento la
           macchina ha ancora in coda le ultime righe più l'alzata al tappo e
           il ritorno al punto home: sono secondi, e sono i secondi in cui
           uno allunga la mano. Il pulsante aspetta che si sia fermata.
           Scollegata il controllo non vuol dire niente — non c'è niente che
           si muova — e allora non blocca. */
        pronto: function () {
          var m = State.data.machine;
          return !State.data.connected || (m !== 'Run' && m !== 'Jog');
        },
        attesa: 'La testina sta ancora finendo: aspetta che si fermi al punto ' +
                'home prima di mettere le mani sulla penna.',
        etichetta: 'Ho tolto la penna',
        esci: function () {
          /* Il servo scende a vuoto: non c'è niente nei morsetti, niente da
             toccare. Da qui in poi quella quota non si muove più. */
          Api.penna(quotaContatto());
          return true;
        }
      },
      {
        nome: 'Monta la penna nuova',
        sezioni: { posizione: true, homing: false, assi: false, penna: false },
        testo: function () {
          var z = quotaContatto();
          /* QUALE PENNA, prima di tutto il resto. È la sola domanda che uno
             si fa aprendo questa finestra, e fino a oggi la risposta era
             nella sua testa: si guardava l'elenco dei livelli e si contava.
             Adesso la porta il programma — vedi SEGNO_PENNA in gcode.js —
             quindi vale anche per un file salvato e riaperto fra una
             settimana, quando quell'elenco non c'è più. */
          var p = Sender.penna();
          /* Se quel colore è una delle penne in cassetto, la finestra la
             chiama col nome che le ha dato l'utente: «monta la rossa» si
             capisce senza guardare, «#c8102e» no. */
          var inCassetto = null;
          if (p && p.colore && window.Artwork && Artwork.tavolozza) {
            Artwork.tavolozza().forEach(function (q) {
              if (q.colore === p.colore) inCassetto = q.nome;
            });
          }
          /* Il nome viene dal nome del file, quindi da fuori: passa da esc()
             prima di diventare HTML. Il colore no — quello il Sender lo
             accetta solo se è un «#rgb», vedi RE_PENNA. */
          return (p
            ? '<p class="quale-penna">Adesso va montata: ' +
              (p.colore
                 ? '<span class="tinta" style="background:' + p.colore + '"></span> '
                 : '') +
              '<b>' + esc(inCassetto || p.nome || p.colore || 'la prossima penna') +
              '</b>' +
              (inCassetto && p.nome ? ' <span class="muted">per ' + esc(p.nome) + '</span>' : '') +
              '</p>'
            : '') +
            'Il servo è fermo alla <b>quota di contatto</b> del programma, ' +
                 'Z' + (z === null ? '—' : z.toFixed(2)) + ': <b>non si muove più ' +
                 'da sola</b>.<br><br>' +
                 'Infila la penna nuova nei morsetti finché la <b>punta tocca il ' +
                 'piano</b> e stringi lì. È lo stesso gesto del primo montaggio, ' +
                 'e serve a questo: così il G-code che resta vale com\'è scritto, ' +
                 'senza che nessuno lo ritocchi.<br><br>' +
                 'I due pulsanti qui sotto sono per <b>provare</b>: a contatto la ' +
                 'punta deve sfiorare il piano, alzata deve staccarsene di ' +
                 'qualche millimetro. Se non torna, allenta e rifai.';
        },
        /* I due pulsanti di prova sono QUI e non nel pannello: quelli del
           pannello usano le quote NOMINALI del profilo, e la quota che conta
           adesso è quella del programma in corso, che può essere diversa di
           qualche decimo. Due pulsanti uguali che vanno in due posti diversi
           sono il modo migliore di montare una penna storta. */
        extra: function () {
          return '<div class="pop-pen"><p class="muted small">Prova la penna ' +
                 'appena montata</p><div class="btn-row">' +
                 '<button type="button" class="btn btn-small" id="pop-pen-su">' +
                 'Penna alzata</button>' +
                 '<button type="button" class="btn btn-small" id="pop-pen-giu">' +
                 'Penna a contatto</button></div></div>';
        },
        entra: function () {
          /* Entrando, il servo è sceso al contatto: lo ha fatto l'`esci` del
             passo prima, ed è il gesto con cui la penna si monta. */
          pennaGiu = true;
          var giu = document.getElementById('pop-pen-giu');
          var su = document.getElementById('pop-pen-su');
          if (giu) giu.addEventListener('click', function () { provaPenna(true); });
          if (su) su.addEventListener('click', function () { provaPenna(false); });
        },
        pronto: function () { return !!State.data.connected; },
        attesa: 'La macchina non è collegata.',
        etichetta: 'Riprendi la stampa col colore nuovo',
        esci: function () {
          /* Si riparte a penna alzata. Il generatore dopo il segno ridichiara
             tutto, Z compresa, quindi non sarebbe indispensabile — ma se fra
             qui e la ripresa succede qualcosa, la punta è su e non sul
             foglio. */
          var alzata = Profile.alzataMm(), z = quotaContatto();
          if (alzata !== null && z !== null) Api.penna(z + alzata);
          Sender.riprendiCambio();
          return true;
        }
      }
    ];
  }

  /* L'ingresso del cambio penna: dal pulsante Riprendi, e da sé appena la
     stampa arriva al segno. */
  function cambioPenna() {
    if (Sender.stato() !== 'cambio') return;
    rimandato = false;
    modo = 'penna';
    passi = passiCambioPenna();
    apri(0);
  }

  /* IL POPUP SI APRE DA SE'.
   *
   * Prima la stampa si fermava al cambio penna, lo scriveva nel registro, e
   * stava lì: per far comparire la procedura bisognava premere Riprendi — cioè
   * premere un pulsante che DICE di riprendere sperando che invece si fermi e
   * chieda. Il 2026-10-27, alla prima stampa a due colori vera, è stato
   * premuto con la paura che la stampa ripartisse saltando il cambio.
   *
   * Un pulsante che per essere premuto ha bisogno di sapere che non fa quello
   * che c'è scritto è un pulsante scritto male. Adesso la finestra compare da
   * sola quando il livello è finito, e Riprendi resta quello che sembra: il
   * modo di riaprirla se si è scelto «Più tardi». */
  function autoCambio() {
    if (State.data.stampa.stato !== 'cambio') { rimandato = false; return; }
    if (rimandato || !box.hidden) return;
    cambioPenna();
  }

  /* La prova della penna appena montata. `giu` dice dove portarla; senza
     argomento alterna, che è quello che fa il tasto unico del telecomando.
     Le quote sono quelle del PROGRAMMA IN CORSO e non quelle nominali del
     profilo: possono essere diverse di qualche decimo, e due comandi uguali
     che vanno in due posti diversi sono il modo migliore di montare una
     penna storta. */
  function provaPenna(giu) {
    var alzata = Profile.alzataMm(), z = quotaContatto();
    if (z === null) return;
    pennaGiu = (giu === undefined) ? !pennaGiu : !!giu;
    if (pennaGiu) Api.penna(z);
    else if (alzata !== null) Api.penna(z + alzata);
  }

  /* A che punto è la procedura della penna, per chi la deve disegnare
     altrove: 0 = togli la vecchia, 1 = monta la nuova, null = non siamo lì.
     Si risponde anche a finestra chiusa — «Più tardi» non annulla il cambio
     penna, lo rimanda, e il telecomando deve continuare a dire dove siamo. */
  function passoPenna() {
    if (Sender.stato() !== 'cambio') return null;
    if (box.hidden || modo !== 'penna') return 0;
    return corrente;
  }

  /* L'ingresso dal telecomando. Non reimplementa niente: apre la finestra se
     era stata rimandata, e poi preme gli stessi pulsanti. */
  function daTelecomando(tasto) {
    if (Sender.stato() !== 'cambio') return false;
    if (box.hidden || modo !== 'penna') cambioPenna();
    if (tasto === 'apri') return true;
    if (tasto === 'prova') { provaPenna(); return true; }
    if (tasto === 'avanti') {
      var p = passi[corrente];
      if (!p || !p.pronto()) {
        Log.add('err', 'Dal telecomando: non ancora. ' + (p ? p.attesa : ''));
        return false;
      }
      avanti();
      return true;
    }
    return false;
  }

  function alzaPenna() {
    var alzata = Profile.alzataMm(), nominale = Profile.zContatto();
    if (alzata === null || nominale === null) return;
    /* Finché il contatto di oggi non è misurato si alza da quello nominale:
       in coordinate macchina il contatto è negativo, e partire da zero
       porterebbe la penna sopra il fine corsa invece che 3 mm dal foglio. */
    var base = State.data.altezzaContatto === null ? nominale
             : State.data.altezzaContatto;
    Api.penna(base + alzata);
  }

  /* L'unica protezione rimasta finché non ci sono i finecorsa, e si applica
     QUI: col foglio nella posizione vera, non in quella immaginata prima. */
  function controllaIngombro() {
    var art = State.data.art;
    if (!art || !art.length) return true;
    var b = SvgImport.bbox(art);
    var r = Profile.stanoDentro(b, State.data.sheetOrigin);
    if (r.ok) return true;
    fermati('Con il foglio lì, il disegno esce dall\'area di lavoro ' +
            r.fuori.join(' e ') + '. Sposta il foglio, o riduci la scala del ' +
            'disegno, e ricomincia.');
    return false;
  }

  /* ------------------------------ la finestra ----------------------------- */

  function apri(i) {
    corrente = i;
    var p = passi[i];
    box.hidden = false;
    /* Con un passo solo «Passo 1 di 1» non dice niente: dice quello che si
       sta facendo, invece. */
    passoEtichetta.textContent = (modo === 'penna' ? 'Cambio penna — passo ' : 'Passo ') +
                                 (i + 1) + ' di ' + passi.length;
    titolo.textContent = p.nome;
    descrizione.innerHTML = typeof p.testo === 'function' ? p.testo() : p.testo;
    okBtn.textContent = p.etichetta;
    /* «Annulla la stampa» durante un cambio penna sarebbe una bugia: lì
       quel pulsante chiude la finestra e lascia la stampa ferma dov'è, col
       disegno a metà sul foglio. */
    annullaBtn.textContent = modo === 'penna' ? 'Più tardi' : 'Annulla la stampa';
    Panel.mount(contenitore, p.sezioni);
    /* Campi che appartengono al passo e non al pannello: il pannello è un
       componente condiviso, e infilarci dentro i campi di un passo lo
       legherebbe a una procedura che non è affar suo. */
    if (p.extra) contenitore.insertAdjacentHTML('beforeend', p.extra());
    p.entra();
    aggiorna();
  }

  function aggiorna() {
    if (box.hidden || corrente < 0) return;
    var p = passi[corrente];
    var ok = p.pronto();
    okBtn.disabled = !ok;
    nota.textContent = ok ? '' : p.attesa;
    nota.hidden = ok;
  }

  function avanti() {
    var p = passi[corrente];
    if (!p.pronto()) return;
    if (p.esci() === false) return;
    if (corrente + 1 < passi.length) { apri(corrente + 1); return; }
    chiudi();
    /* La consegna è la fine dei tre passi di INIZIO STAMPA. Il cambio penna
       ha già fatto quello che doveva nel suo ultimo `esci`: lì non c'è
       nessun programma da rigenerare e da mandare — ce n'è uno a metà che
       sta aspettando. */
    if (modo === 'stampa') consegna();
  }

  function chiudi() {
    box.hidden = true;
    corrente = -1;
    contenitore.innerHTML = '';
  }

  function fermati(motivo) {
    chiudi();
    Log.add('err', motivo);
    window.alert(motivo);
  }

  /* Ultimo passo: il programma si rigenera con l'origine del foglio e l'altezza
     di contatto appena misurate, e solo allora si manda. */
  function consegna() {
    Artwork.prepare();
    Log.add('msg', 'Le tre misure sono dentro: programma rigenerato con il ' +
                   'foglio a X ' + State.data.sheetOrigin.x.toFixed(1) +
                   ' Y ' + State.data.sheetOrigin.y.toFixed(1) + '.');
    Artwork.invia();
  }

  /* ------------------------------- l'ingresso ----------------------------- */

  /* Prima dei popup, i controlli che non hanno senso rimandare: un profilo
     incompleto non si scopre a metà procedura, col foglio già in macchina. */
  function avviaStampa() {
    var blocchi = Profile.verifica().filter(function (v) { return v.gravita === 'blocco'; });
    if (blocchi.length) {
      fermati('Non si può stampare: ' + blocchi.map(function (v) { return v.testo; }).join(' '));
      return;
    }
    if (!State.data.art || !State.data.art.length) {
      fermati('Non c\'è nessun disegno preparato.');
      return;
    }
    modo = 'stampa';
    passi = definisci();
    apri(0);
  }

  function init() {
    box = document.getElementById('modal');
    titolo = document.getElementById('modal-titolo');
    passoEtichetta = document.getElementById('modal-passo');
    descrizione = document.getElementById('modal-desc');
    nota = document.getElementById('modal-nota');
    contenitore = document.getElementById('modal-panel');
    okBtn = document.getElementById('modal-ok');
    annullaBtn = document.getElementById('modal-annulla');

    okBtn.addEventListener('click', avanti);
    annullaBtn.addEventListener('click', function () {
      var cambio = Sender.stato() === 'cambio';
      chiudi();
      /* Annullare durante un cambio penna non annulla la stampa: la lascia
         ferma dov'è. Il disegno è a metà sul foglio, e buttarlo via perché si
         è premuto «Annulla» sarebbe la cosa più costosa che questo pulsante
         possa fare. */
      if (cambio) rimandato = true;
      Log.add('msg', cambio
        ? 'Cambio penna rimandato: la stampa resta ferma dov\'è. ' +
          'Premi Riprendi quando sei pronto e la procedura si riapre.'
        : 'Stampa annullata.');
    });

    /* Le condizioni dei tre passi dipendono dallo stato della macchina, quindi
       il pulsante di conferma si riaccende da sé quando la condizione è vera:
       nessuno deve chiudere e riaprire il popup per sbloccarlo. */
    State.on('pos', aggiorna);
    State.on('azzerata', aggiorna);
    State.on('motoriLiberi', aggiorna);
    /* Anche `machine`: il primo passo del cambio penna aspetta che la
       testina si fermi, e «ferma» è una cosa che si legge da lì. */
    State.on('machine', aggiorna);
    State.on('stampa', autoCambio);
  }

  return { init: init, avviaStampa: avviaStampa, chiudi: chiudi,
           cambioPenna: cambioPenna,
           passoPenna: passoPenna, telecomando: daTelecomando };
})();
