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

  /* ----------------------- il passo del cambio penna ---------------------- */

  /* UN PASSO SOLO, e non è uno dei tre di inizio stampa: è lo stesso gesto
     del secondo — abbassa finché segna — ma fatto a metà stampa, su un
     foglio che è già disegnato, con una penna che non è quella di prima.
     Quello che ne esce non è «l'altezza di contatto di oggi» ma «di quanto
     la penna nuova sporge diversamente», e serve al Sender per correggere le
     quote che restano.

     Il foglio è già in macchina e l'origine è presa: non si rimisura niente
     altro. E non si sposta la testina da sola: il foglio ha sopra mezzo
     disegno, e dove c'è un punto libero su cui lasciare il segno lo sa
     l'operatore, non noi. */
  function passoCambioPenna(fatto) {
    return [{
      nome: 'Penna nuova: dove tocca il foglio',
      sezioni: { posizione: true, homing: false, assi: true, penna: true },
      testo: function () {
        var v = Sender.altezzaUsata();
        return 'Infila la penna nuova <b>come l\'altra</b>: la porti alla quota ' +
               'di contatto e la stringi lì, non il contrario.<br><br>' +
               'Poi portala su un <b>punto libero del foglio</b> — con le frecce ' +
               'qui sotto — e abbassala a piccoli passi finché <b>lascia il ' +
               'segno</b>. Non serve premere.<br><br>' +
               'Serve perché il G-code che resta porta le quote della penna di ' +
               'prima' + (v === null ? '' : ', che toccava a <b>Z' + v.toFixed(2) +
               '</b>') + ': una penna che sporge mezzo millimetro in più ' +
               'premerebbe dentro la carta, una che sporge mezzo in meno ' +
               'disegnerebbe per aria. Appena confermi, le ' +
               Sender.restano() + ' righe che mancano vengono spostate della ' +
               'differenza.';
      },
      entra: function () {},
      /* Stessa soglia del secondo passo, e per lo stesso motivo: confermare
         a penna alzata manda in stampa un disegno fatto in aria. */
      pronto: function () {
        var alzata = Profile.alzataMm(), contatto = Profile.zContatto();
        if (alzata === null || contatto === null) return false;
        return State.data.pos.z < contatto + alzata / 2;
      },
      attesa: 'La penna è ancora troppo in alto: così disegneresti in aria.',
      etichetta: 'Penna nuova a posto',
      esci: function () {
        var z = State.data.pos.z;
        State.data.altezzaContatto = z;
        alzaPenna();
        fatto(z);
        return true;
      }
    }];
  }

  /* L'ingresso del cambio penna. Senza una quota di partenza non c'è nessuna
     differenza da calcolare — succede con un file caricato a mano, mai
     passato dai tre popup — e allora si riprende e basta, dicendolo. */
  function cambioPenna() {
    if (Sender.stato() !== 'cambio') return;
    if (Sender.altezzaUsata() === null || !State.data.connected) {
      Log.add('msg', 'Riprendo senza rimisurare: di questo programma non si sa ' +
                     'a che quota toccava la penna di prima.');
      Sender.riprendiCambio(null);
      return;
    }
    passi = passoCambioPenna(function (z) { Sender.riprendiCambio(z); });
    apri(0);
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
    passoEtichetta.textContent = passi.length > 1
      ? 'Passo ' + (i + 1) + ' di ' + passi.length
      : 'Cambio penna';
    titolo.textContent = p.nome;
    descrizione.innerHTML = typeof p.testo === 'function' ? p.testo() : p.testo;
    okBtn.textContent = p.etichetta;
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
    /* La consegna è la fine dei TRE passi di inizio stampa. Il passo del
       cambio penna ha già fatto quello che doveva nel suo `esci`: qui non
       c'è nessun programma da rigenerare e da mandare — ce n'è uno a metà
       che sta aspettando. */
    if (passi.length > 1) consegna();
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
      Log.add('msg', cambio
        ? 'Rimisurazione annullata: la stampa resta ferma al cambio penna. ' +
          'Premi di nuovo Riprendi quando sei pronto.'
        : 'Stampa annullata.');
    });

    /* Le condizioni dei tre passi dipendono dallo stato della macchina, quindi
       il pulsante di conferma si riaccende da sé quando la condizione è vera:
       nessuno deve chiudere e riaprire il popup per sbloccarlo. */
    State.on('pos', aggiorna);
    State.on('azzerata', aggiorna);
    State.on('motoriLiberi', aggiorna);
  }

  return { init: init, avviaStampa: avviaStampa, chiudi: chiudi,
           cambioPenna: cambioPenna };
})();
