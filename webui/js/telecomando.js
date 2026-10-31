/* Il telecomando: il lato SLICER del dialogo.
 *
 * L'oggetto è un MKR IoT Carrier Rev2 — un disco con il display in mezzo,
 * cinque tasti capacitivi intorno e la batteria dietro — e il progetto sta in
 * `schermo/README.md`. Qui c'è solo la metà che gira nel browser.
 *
 * PERCHE' E' IL BROWSER A PARLARE PER PRIMO.
 * I dati che il telecomando mostra non esistono nella macchina: la stampa non
 * è un file che l'ESP32 esegue, è il browser che manda una riga alla volta e
 * conta gli `ok` (vedi js/sender.js, in testa). Percentuale, tempo rimanente,
 * cambi penna ed errori vivono qui dentro, in `State.data.stampa`, e da
 * nessun'altra parte. Quindi il telecomando non li può andare a prendere: si
 * fanno arrivare.
 *
 * UN CANALE SOLO, IN DUE VERSI.
 * Un browser non apre socket TCP, quindi il telecomando fa da server HTTP e
 * questo modulo gli manda lo stato con un POST. LA RISPOSTA A QUEL POST
 * RIPORTA INDIETRO IL TASTO PREMUTO e la carica della batteria. Nessuna
 * seconda connessione, e soprattutto: il telecomando non comincia mai lui una
 * conversazione, non conosce l'indirizzo della macchina e non ci parla. La
 * regola «il telecomando non comanda FluidNC» non è disciplina, è struttura.
 *
 * I TASTI PASSANO DA DOVE PASSEREBBE UN DITO.
 * Un tasto del telecomando non fa quello che farebbe il pulsante della
 * pagina: chiama lo STESSO codice. Pausa e riprendi vanno al Sender, i due
 * passi del cambio penna vanno al Popup che già li governa. Due procedure di
 * cambio penna — una per lo schermo e una per il telecomando — divergerebbero
 * alla prima modifica, e te ne accorgeresti col foglio rovinato.
 *
 * LO STOP ARRIVA GIA' CONFERMATO. Sul telecomando si fa in due tempi: un
 * tocco che chiede, e un secondo tenuto un secondo. Quella è roba sua — è la
 * sua interfaccia — e qui arriva un `stop` solo, che vuol dire «confermato».
 */
var Telecomando = (function () {

  var CHIAVE = 'cnc2d-telecomando';

  /* Ogni quanto si parla. Durante una stampa il tasto deve rispondere svelto,
     e il ritardo di un tasto È l'intervallo fra due messaggi: tre decimi per
     «ho tolto la penna» vanno bene. A riposo non c'è niente da raccontare, ma
     si continua a chiamare lo stesso — è l'unico modo di accorgersi che
     qualcuno ha premuto, e di sapere se il telecomando è ancora vivo. */
  var RITMO_VIVO = 400, RITMO_FERMO = 2000;

  /* Quante chiamate a vuoto prima di dire che non c'è. Una sola sarebbe un
     indicatore che lampeggia a ogni pacchetto perso. */
  var PAZIENZA = 3;

  var indirizzo = '';
  var timer = null, inVolo = false, falliti = 0;
  var firma = '';            // lo stato dell'ultima volta, per mandare subito se cambia
  var visto = false;         // il telecomando ha risposto almeno una volta
  var batteria = null;
  /* Come sta messo con la corrente, con la parola che manda lui:
     `batteria`, `carica`, `piena`, `ferma` (attaccato ma non carica). */
  var carica = null;
  /* LA SPIA. Normalmente nel registro finiscono solo i fatti — un tasto, un
     collegamento che cade — e non i messaggi, che a stampa in corso sono due
     e mezzo al secondo e seppellirebbero tutto il resto. Quando però si sta
     collaudando il dialogo, vedere QUELLO CHE ESCE e QUELLO CHE TORNA è
     l'unico modo di capire da che parte sta il guasto. Quindi c'è, ma si
     accende a mano e parte spenta. */
  var spiona = false;

  /* ---------------------------- il messaggio ---------------------------- */

  /* Quello che il telecomando deve sapere per disegnarsi, e nient'altro.
     La data la mandiamo noi: il telecomando non ha un orologio che
     sopravviva a una batteria scarica, e il browser ce l'ha. Gli serve per
     il registro delle stampe sulla sua SD. */
  function messaggio() {
    var s = finta || State.data.stampa;
    return {
      v: 1,
      stato: s.stato,
      nome: s.nome || '',
      percento: s.percento,
      /* Il tempo rimanente è null finché il Sender non ne ha misurato
         abbastanza, e null deve restare: una stima su dieci righe è un numero
         inventato, e sul vetro del telecomando al suo posto non c'è niente. */
      rimanente: s.rimanente,
      /* Il colore della penna: il telecomando lo disegna come un pallino,
         perché su tre centimetri di vetro un pallino si vede e la parola
         «nero» no. Può essere null — un livello disegnato a mano non ha
         tinta — e allora sul vetro non c'è nessun pallino: meglio di uno
         nero inventato, che vorrebbe dire «monta la penna nera». */
      penna: s.penna || null,
      passo: finta ? finta.passo
                   : ((window.Popup && Popup.passoPenna) ? Popup.passoPenna() : null),
      macchina: finta ? finta.macchina : State.data.machine,
      azzerata: finta ? !!finta.azzerata : !!State.data.azzerata,
      data: new Date().toISOString()
    };
  }

  /* CHE COSA FA CAMBIARE SCHERMATA al telecomando, e solo quello: serve a
     decidere che cosa non aspetta il prossimo giro.
     Non ci sta dentro la DATA, se no cambierebbe sempre. E non ci sta dentro
     la PERCENTUALE, che è la cosa che cambia cento volte per stampa: un
     messaggio per ogni punto percentuale sarebbe cento messaggi in più per
     dire una cosa che il battito racconta comunque fra due decimi di
     secondo. Qui dentro c'è quello che cambia la FACCIA del telecomando —
     lo stato, il passo del cambio penna, la macchina — e quelli sì che non
     possono aspettare.
     E non ci sta nemmeno la PENNA, che pure cambia la faccia: cambia solo
     all'inizio di un livello, e il livello che chiede una penna diversa
     comincia subito dopo una pausa — cioè insieme a un cambio di `stato`,
     che è già qui dentro e porta con sé anche il colore nuovo. Metterla
     anche qui vorrebbe dire un messaggio in più per dire la stessa cosa un
     decimo di secondo prima. */
  function impronta(m) {
    return [m.stato, m.passo, m.macchina, m.azzerata].join('|');
  }

  /* ------------------------------ il dialogo ------------------------------ */

  function manda() {
    if (!indirizzo || inVolo || muto) return;
    var m = messaggio();
    firma = impronta(m);
    inVolo = true;
    if (spiona) Log.add('cmd', '→ telecomando ' + JSON.stringify(m));

    fetch(url('/stato'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(m)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (risposta) {
      inVolo = false;
      if (falliti >= PAZIENZA) {
        Log.add('msg', 'Telecomando di nuovo raggiungibile.');
      }
      falliti = 0;
      if (!visto) {
        visto = true;
        Log.add('msg', 'Telecomando collegato su ' + indirizzo + '.');
      }
      if (spiona) Log.add('msg', '← telecomando ' + JSON.stringify(risposta));
      batteria = (typeof risposta.batteria === 'number') ? risposta.batteria : null;
      /* Il telecomando vecchio (prima del 2026-10-31) non manda `carica`, e
         deve continuare a funzionare: null vuol dire «non lo dice», che è
         diverso da «è a batteria». */
      carica = typeof risposta.carica === 'string' ? risposta.carica : null;
      segnala();
      if (risposta.tasto) premuto(String(risposta.tasto));
    }).catch(function (e) {
      inVolo = false;
      falliti++;
      /* Si dice una volta sola, quando si smette di crederci: un messaggio di
         rete fallita ogni due secondi riempirebbe il registro di righe che
         raccontano tutte la stessa cosa. */
      if (spiona) Log.add('err', '× telecomando ' + e.message);
      if (falliti === PAZIENZA) {
        if (visto) Log.add('err', 'Telecomando non raggiungibile: ' + e.message);
        visto = false;
        batteria = null;
        carica = null;
        segnala();
      }
    });
  }

  function url(p) {
    var a = indirizzo;
    if (!/^https?:\/\//i.test(a)) a = 'http://' + a;
    return a.replace(/\/+$/, '') + p;
  }

  /* ------------------------------- i tasti ------------------------------- */

  /* Un tasto del telecomando non reimplementa niente: entra dalla stessa
     porta da cui entrerebbe un dito sulla pagina. */
  function premuto(tasto) {
    Log.add('msg', 'Telecomando: ' + tasto + '.');

    /* DURANTE LA PROVA IL TASTO NON ESCE DA QUI. Non è prudenza: è il
       punto della prova. Se «riprendi» finisse al Sender mentre si sta
       recitando una stampa che non esiste, la prova in bianco sarebbe
       l'unica cosa al mondo capace di far partire una stampa vera. */
    /* FERMO SU UNA SCHERMATA: il tasto non deve fare niente, e il fatto che
       si veda nel registro È il collaudo — da qui si capisce se il pad
       risponde e se manda quello che dovrebbe. */
    if (posaOra) {
      Log.add('msg', 'Prova schermate: il tasto è arrivato, e qui non fa ' +
                     'altro — la schermata resta ferma.');
      return;
    }
    if (finta) { provaTasto(tasto); return; }

    if (tasto === 'pausa') { Sender.pausa(); return; }

    if (tasto === 'riprendi') {
      /* RIPRENDERE DA UN CAMBIO PENNA NON È RIPRENDERE DA UNA PAUSA: in
         mezzo c'è una penna diversa, e la procedura va PORTATA A TERMINE,
         non riaperta.
         Qui c'era `'apri'`, che la finestra la apre e basta. Ma quando il
         telecomando mostra RIPRENDI la finestra è già aperta al secondo
         passo — è proprio da lì che sa di doverlo mostrare — quindi quel
         tasto riapriva una finestra aperta, cioè non faceva niente. Alla
         prima stampa vera, il 2026-10-31: «il pulsante riprendi dopo che ho
         cambiato la penna non ha funzionato».
         La prova in bianco non poteva prenderlo: lì «avanti» e «riprendi»
         finiscono tutti e due nello stesso posto, ed era giusto per la
         prova e sbagliato come garanzia. */
      if (Sender.stato() === 'cambio') Popup.telecomando('avanti');
      else Sender.riprendi();
      return;
    }

    if (tasto === 'stop') {
      /* Arriva già confermato: i due tempi li fa il telecomando. */
      Sender.interrompi();
      return;
    }

    if (tasto === 'avanti' || tasto === 'prova') {
      Popup.telecomando(tasto);
      return;
    }

    Log.add('err', 'Il telecomando ha mandato un tasto che non conosco: ' + tasto);
  }

  /* ------------------------- la prova in bianco ------------------------- */

  /* FAR VIVERE AL TELECOMANDO TUTTA LA VITA DI UNA STAMPA senza una
   * macchina e senza un foglio: partenza, avanzamento, cambio penna in due
   * passi, fine, errore, e il silenzio di quando il portatile non c'è.
   * Serve a collaudarlo appena montato — dieci schermate, cinque tasti,
   * quattro suoni e cinque LED si vedono in un minuto invece che in venti
   * minuti di stampa vera, che oltretutto costano un foglio.
   *
   * La recita vive in `finta`, che ha la stessa forma di
   * `State.data.stampa` ma NON è quella: la pagina non se ne accorge, e
   * soprattutto i tasti che tornano indietro li consuma la prova stessa.
   * Senza quello, una prova in bianco sarebbe l'unica cosa al mondo capace
   * di far partire una stampa vera.
   */
  var finta = null, muto = false;
  var passoProva = 0, daQuando = 0, timerProva = null;
  var RITMO_PROVA = 200;

  function vuoto() {
    return { stato: 'fermo', nome: 'prova in bianco', percento: 0, rimanente: null,
             penna: null, passo: null, macchina: 'Idle', azzerata: false };
  }

  /* Il copione. I due passi del cambio penna aspettano che tu prema — e
     il tempo c'è lo stesso, lungo: una prova che si pianta aspettando un
     dito è peggio di una che va avanti da sola. Quel «premi FATTO» nel
     nome non è decorazione: il nome finisce nel registro del SLICER, che
     è dove uno guarda se sul vetro non capisce cosa gli si chiede. */
  var COPIONE = [
    { nome: 'pronta, ma da azzerare', ms: 2500,
      entra: function (f) { f.stato = 'fermo'; f.azzerata = false; } },
    { nome: 'pronta', ms: 2500,
      entra: function (f) { f.azzerata = true; } },
    { nome: 'in stampa, penna nera', ms: 9000,
      entra: function (f) {
        f.stato = 'invio'; f.macchina = 'Run'; f.percento = 0; f.rimanente = null;
        f.penna = { colore: '#000', nome: 'prova · tratto #000' };
      },
      durante: function (f, k) {
        f.percento = Math.round(k * 48);
        /* Il tempo compare solo dopo un po', come fa il Sender vero: sotto
           le venti righe non c'è, e sul vetro al suo posto non c'è niente. */
        if (k > 0.25) f.rimanente = Math.round((1 - k) * 9 * 60000);
      } },
    { nome: 'cambio penna — togli (premi FATTO)', ms: 40000,
      entra: function (f) {
        f.stato = 'cambio'; f.passo = 0; f.macchina = 'Idle';
        f.penna = { colore: '#c0392b', nome: 'prova · tratto #c0392b' };
      } },
    { nome: 'cambio penna — monta (premi RIPRENDI)', ms: 40000,
      entra: function (f) { f.passo = 1; } },
    { nome: 'in stampa, penna rossa', ms: 9000,
      entra: function (f) { f.stato = 'invio'; f.passo = null; f.macchina = 'Run'; },
      durante: function (f, k) {
        f.percento = Math.round(48 + k * 52);
        f.rimanente = Math.round((1 - k) * 4 * 60000);
      } },
    { nome: 'finita', ms: 5000,
      entra: function (f) { f.stato = 'fine'; f.percento = 100; f.rimanente = 0;
                            f.macchina = 'Idle'; } },
    { nome: 'errore', ms: 5000,
      entra: function (f) { f.stato = 'errore'; } },
    /* L'ultimo pezzo è il SILENZIO: si smette di chiamare, e dopo sei
       secondi il telecomando deve dire da sé che il portatile non c'è.
       È l'unica schermata che non si può provare mandando qualcosa. */
    { nome: 'senza SLICER (silenzio)', ms: 9000,
      entra: function () { muto = true; } }
  ];

  function provaAvanti(i) {
    if (!finta) return;
    if (i >= COPIONE.length) { prova(false); return; }
    passoProva = i;
    muto = false;
    daQuando = Date.now();
    if (COPIONE[i].entra) COPIONE[i].entra(finta);
    Log.add('msg', 'Prova: ' + COPIONE[i].nome + '.');
    firma = '';
    manda();
    battito();
    segnala();
  }

  function provaTick() {
    if (!finta) return;
    var p = COPIONE[passoProva];
    /* In pausa il copione sta fermo: se no premere PAUSA non si vedrebbe,
       perché un attimo dopo la recita sarebbe andata avanti lo stesso. */
    if (finta.stato === 'pausa') { daQuando += RITMO_PROVA; return; }
    var k = Math.min(1, (Date.now() - daQuando) / p.ms);
    if (p.durante) p.durante(finta, k);
    if (k >= 1) provaAvanti(passoProva + 1);
  }

  function provaTasto(tasto) {
    var f = finta;
    if (!f) return;
    if (tasto === 'pausa' && f.stato === 'invio') {
      f.stato = 'pausa'; f.macchina = 'Idle';
    } else if (tasto === 'riprendi' && f.stato === 'pausa') {
      f.stato = 'invio'; f.macchina = 'Run';
    } else if (f.stato === 'cambio' && (tasto === 'avanti' || tasto === 'riprendi')) {
      provaAvanti(passoProva + 1);
      return;
    } else if (tasto === 'stop') {
      Log.add('msg', 'Prova: lo stop è arrivato già confermato. Qui finisce la prova.');
      prova(false);
      return;
    } else if (tasto === 'prova') {
      Log.add('msg', 'Prova: il tasto ABBASSA/ALZA, qui, non muove il servo.');
    }
    firma = '';
  }

  function prova(acceso) {
    if (acceso === undefined) acceso = !timerProva;
    if (acceso) {
      if (timerProva) return true;
      if (!indirizzo) {
        Log.add('err', 'Per la prova serve l\'indirizzo del telecomando.');
        return false;
      }
      if (window.Sender && Sender.inCorso && Sender.inCorso()) {
        Log.add('err', 'C\'è una stampa in corso: la prova in bianco si fa a ' +
                       'macchina ferma.');
        return false;
      }
      posaOra = '';
      finta = vuoto();
      timerProva = setInterval(provaTick, RITMO_PROVA);
      Log.add('msg', 'Prova in bianco del telecomando: recita una stampa intera. ' +
                     'La macchina non si muove e i tasti non escono dalla prova.');
      provaAvanti(0);
    } else {
      if (timerProva) clearInterval(timerProva);
      timerProva = null; finta = null; muto = false; firma = ''; posaOra = '';
      Log.add('msg', 'Prova del telecomando finita.');
      manda();
      battito();
      segnala();
    }
    return true;
  }


  /* --------------------- una schermata sola, ferma --------------------- */

  /* LA PROVA IN BIANCO RECITA TUTTA LA STAMPA e va avanti da sola: è quello
   * che serve per collaudare il telecomando appena montato. Per GUARDARE una
   * schermata — i colori, le parole, il fulmine della carica, dove cascano le
   * etichette dei tasti — serve il contrario: una schermata sola, ferma,
   * finché non la cambi tu. Con la recita bisognava aspettare il momento
   * giusto e fotografarlo prima che passasse.
   *
   * Sono gli STESSI stati che manda una stampa vera, non schermate inventate
   * per la prova: provare una cosa che la macchina non produce mai vorrebbe
   * dire collaudare un oggetto che non esiste. E il telecomando non sa che è
   * una prova — non c'è nessun campo che glielo dica — quindi quello che fa
   * qui è esattamente quello che farà in stampa.
   */
  var NERA  = { colore: '#000000', nome: 'prova · tratto nero' };
  var ROSSA = { colore: '#c0392b', nome: 'prova · tratto rosso' };

  var POSE = [
    { k: 'azzerare', nome: 'Da azzerare', fa: function (f) {
        f.stato = 'fermo'; f.azzerata = false; } },
    { k: 'pronta', nome: 'Pronta', fa: function (f) {
        f.stato = 'fermo'; f.azzerata = true; } },
    { k: 'stampa', nome: 'In stampa', fa: function (f) {
        f.stato = 'invio'; f.macchina = 'Run'; f.azzerata = true;
        f.percento = 47; f.rimanente = 8 * 60000; f.penna = NERA; } },
    { k: 'pausa', nome: 'In pausa', fa: function (f) {
        f.stato = 'pausa'; f.macchina = 'Idle'; f.azzerata = true;
        f.percento = 47; f.rimanente = 8 * 60000; f.penna = NERA; } },
    { k: 'penna1', nome: 'Penna: togli', fa: function (f) {
        f.stato = 'cambio'; f.passo = 0; f.macchina = 'Idle'; f.azzerata = true;
        f.percento = 48; f.penna = ROSSA; } },
    { k: 'penna2', nome: 'Penna: monta', fa: function (f) {
        f.stato = 'cambio'; f.passo = 1; f.macchina = 'Idle'; f.azzerata = true;
        f.percento = 48; f.penna = ROSSA; } },
    { k: 'fine', nome: 'Finita', fa: function (f) {
        f.stato = 'fine'; f.percento = 100; f.rimanente = 0;
        f.macchina = 'Idle'; f.azzerata = true; f.penna = ROSSA; } },
    { k: 'errore', nome: 'Errore', fa: function (f) {
        f.stato = 'errore'; f.percento = 62; f.macchina = 'Alarm'; } },
    /* IL SILENZIO NON SI MANDA: si smette di mandare. È l'unica schermata che
       nasce dal non ricevere niente, e dopo sei secondi il telecomando la
       tira fuori da sé. Mentre dura, i tasti non si possono nemmeno leggere:
       la risposta viaggia dentro al messaggio che non stiamo mandando. */
    { k: 'silenzio', nome: 'Niente SLICER', fa: function () { muto = true; } }
  ];

  var posaOra = '';

  function posa(k) {
    k = String(k || '');
    if (k && !indirizzo) {
      Log.add('err', 'Per le prove serve l\'indirizzo del telecomando.');
      return false;
    }
    if (k && window.Sender && Sender.inCorso && Sender.inCorso()) {
      Log.add('err', 'C\'è una stampa in corso: le prove delle schermate si ' +
                     'fanno a macchina ferma.');
      return false;
    }
    /* Una prova per volta: la recita e una schermata ferma si
       contenderebbero lo stesso finto stato. */
    if (timerProva) { clearInterval(timerProva); timerProva = null; }

    if (!k) {
      posaOra = ''; finta = null; muto = false; firma = '';
      Log.add('msg', 'Prove delle schermate finite.');
    } else {
      var p = null;
      for (var i = 0; i < POSE.length; i++) if (POSE[i].k === k) p = POSE[i];
      if (!p) { Log.add('err', 'Schermata che non conosco: ' + k); return false; }
      finta = finta || vuoto();
      muto = false;
      posaOra = k;
      p.fa(finta);
      firma = '';
      Log.add('msg', 'Prova schermate: ' + p.nome +
                     (k === 'silenzio' ? ' — smetto di mandare, fra sei secondi ' +
                                         'lo dice da sé.' : '.'));
    }
    manda();
    battito();
    segnala();
    return true;
  }

  /* ------------------------------- la spia ------------------------------- */

  function spia(v) {
    if (v !== undefined) {
      spiona = !!v;
      Log.add('msg', spiona
        ? 'Spia del telecomando accesa: nel registro ogni messaggio che esce ' +
          '(→) e ogni risposta che torna (←). A stampa in corso sono due e ' +
          'mezzo al secondo.'
        : 'Spia del telecomando spenta.');
      segnala();
    }
    return spiona;
  }

  /* --------------------------- lo stato per la UI --------------------------- */

  function segnala() {
    State.set('telecomando', {
      attivo: !!indirizzo,
      visto: visto,
      batteria: batteria,
      carica: carica,
      prova: !!timerProva,
      posa: posaOra,
      spia: spiona
    });
  }

  /* ------------------------------- il ritmo ------------------------------- */

  /* Vivo = c'è qualcosa in corso. Lì il ritmo è quello del tasto, non quello
     del dato: lo stato cambia a ogni riga confermata — decine al secondo — e
     mandarne uno per riga vorrebbe dire inondare una scheda che ha 32 kB di
     memoria. */
  function invita() {
    var s = (finta || State.data.stampa).stato;
    return s === 'invio' || s === 'pausa' || s === 'cambio';
  }

  function battito() {
    if (timer) clearTimeout(timer);
    if (!indirizzo) return;
    timer = setTimeout(function () {
      manda();
      battito();
    }, invita() ? RITMO_VIVO : RITMO_FERMO);
  }

  /* Un cambio di stato non aspetta il prossimo giro: il cambio penna, un
     errore e la fine della stampa sono i tre momenti in cui mezzo secondo di
     ritardo si nota. */
  function subito() {
    /* UNA STAMPA VERA SPEGNE LA PROVA, qualunque prova. Il controllo che si
       fa accendendola non basta: quello guarda il momento in cui si preme,
       e se la stampa parte dopo il telecomando resterebbe a raccontare una
       recita — o una schermata ferma — mentre la macchina disegna davvero.
       Peggio: sul vetro ci sarebbe scritto «pronta» con la penna che va. */
    if (finta && window.Sender && Sender.inCorso && Sender.inCorso()) {
      Log.add('msg', 'È partita una stampa vera: le prove del telecomando si ' +
                     'fermano qui.');
      if (posaOra) posa(''); else prova(false);
      return;
    }
    if (!indirizzo || inVolo) return;
    if (impronta(messaggio()) === firma) return;
    manda();
    battito();
  }

  /* ----------------------------- l'indirizzo ----------------------------- */

  function dove(v) {
    if (v === undefined) return indirizzo;
    indirizzo = String(v || '').trim();
    try { localStorage.setItem(CHIAVE, indirizzo); } catch (e) { /* privata */ }
    visto = false;
    falliti = 0;
    batteria = null;
    firma = '';
    segnala();
    if (indirizzo) { manda(); battito(); }
    else if (timer) { clearTimeout(timer); timer = null; }
    return indirizzo;
  }

  function stato() {
    return { indirizzo: indirizzo, visto: visto, batteria: batteria,
             carica: carica, prova: !!timerProva, posa: posaOra,
             spia: spiona };
  }

  function init() {
    try { indirizzo = localStorage.getItem(CHIAVE) || ''; } catch (e) { indirizzo = ''; }
    segnala();
    if (indirizzo) { manda(); battito(); }

    State.on('stampa', subito);
    State.on('machine', subito);
    State.on('azzerata', subito);
  }

  return { init: init, dove: dove, stato: stato, manda: manda, premuto: premuto,
           prova: prova, inProva: function () { return !!finta; },
           pose: function () { return POSE.map(function (p) {
                   return { k: p.k, nome: p.nome }; }); },
           posa: posa, spia: spia };
})();
