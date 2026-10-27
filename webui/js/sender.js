/* Invio di un programma alla macchina, riga per riga.
 *
 * PERCHÉ RIGA PER RIGA E NON UN FILE DA FAR ESEGUIRE.
 * La strada «carica il file in memoria e poi `$LocalFS/Run`» esiste e
 * funziona, ma ha un difetto dimostrato: il job si tiene il canale da cui è
 * partito per tutta la durata del disegno, e se quel canale è una connessione
 * HTTP del browser, prima o poi cade e si porta dietro la macchina. Il
 * 2026-10-23 ha ucciso due stampe; il 2026-10-24 la causa è stata confermata.
 *
 * Mandando le righe una per una non esiste nessun canale destinato a restare
 * appeso venti minuti: c'è un WebSocket aperto su cui passa traffico in
 * continuazione, e ogni riga ha la sua risposta. Lo stato della stampa lo
 * ricostruiamo noi contando gli `ok`, invece di chiederlo a un comando che
 * intanto blocca.
 *
 * L'ALTRA FACCIA: la stampa ora dipende dalla rete per tutta la sua durata.
 * Chiudere la pagina interrompe il disegno — con il file in memoria non
 * succedeva. È il prezzo, ed è giusto saperlo: in cambio si vede
 * l'avanzamento, si può mettere in pausa, e la macchina non muore.
 */
var Sender = (function () {

  /* Quante righe tenere affidate ad Api. Più della sua finestra, così quando
     un `ok` libera un posto ce n'è già una pronta e il pianificatore non si
     svuota mai; non tante da rendere lenta una pausa, perché quello che è già
     partito non si richiama più. */
  var SCORTA = 32;

  /* La sentinella con cui un cambio penna viaggia dentro `righe`. Non è una
     riga di G-code e non parte mai: la riconosce alimenta(), che a quel
     punto si ferma. Un carattere nullo in testa perché nessun comando vero
     possa mai assomigliarle. */
  var PAUSA = '\u0000cambio-penna';

  /* Come si riconosce un cambio penna: un commento il cui testo è «PAUSA».
     Qui si riconosce la FORMA invece di importare la costante di gcode.js —
     che è chi la scrive, vedi SEGNO_PAUSA là — per due motivi: il Sender
     resta collaudabile da solo, senza tirarsi dietro il generatore, e un
     file scritto a mano con «; PAUSA» funziona lo stesso. */
  var RE_PAUSA = /^\s*;\s*PAUSA\s*$/i;

  var righe = [];      // il programma, ripulito
  var i = 0;           // prossima riga da affidare ad Api
  var fatte = 0;       // righe confermate dalla macchina
  var stato = 'fermo'; // fermo | invio | pausa | cambio | fine | errore
  var t0 = 0;
  var nome = '';

  /* LA QUOTA DI CONTATTO CON CUI IL FILE E' STATO SCRITTO. È il numero a cui
     si porta il servo quando si monta una penna nuova a metà stampa: la
     penna si infila finché tocca e si stringe lì, quindi il G-code che resta
     continua a valere senza che nessuno lo ritocchi.
     Si tiene qui e non si rilegge da `State.data.altezzaContatto` perché
     quella è «la misura di oggi» e può cambiare — basta rilanciare i popup —
     mentre questa è una proprietà del programma in corso. */
  var altezzaUsata = null;

  /* Via i commenti e le righe vuote. Non è cosmesi: ogni riga mandata è un
     giro di andata e ritorno e un `ok` da aspettare, e l'intestazione dei
     nostri file è lunga venti righe di spiegazioni che alla macchina non
     servono. */
  function prepara(testo) {
    var out = [];
    var src = String(testo).split('\n');
    for (var k = 0; k < src.length; k++) {
      var l = src[k];
      /* Il segno del cambio penna si riconosce PRIMA di togliere i commenti,
         perché è un commento: toglierlo e poi cercarlo sarebbe cercarlo dopo
         averlo buttato via. */
      if (RE_PAUSA.test(l)) {
        out.push(PAUSA);
        continue;
      }
      var p = l.indexOf(';');
      if (p >= 0) l = l.slice(0, p);
      l = l.trim();
      if (l) out.push(l);
    }
    return out;
  }

  function avvia(testo, etichetta) {
    if (stato === 'invio' || stato === 'pausa') {
      Log.add('err', 'C\'è già una stampa in corso.');
      return false;
    }
    righe = prepara(testo);
    if (!righe.length) {
      Log.add('err', 'Il programma non contiene nessun comando.');
      return false;
    }
    i = 0; fatte = 0; t0 = Date.now();
    altezzaUsata = State.data.altezzaContatto;
    nome = etichetta || 'programma';
    stato = 'invio';
    Log.add('msg', 'Invio di ' + nome + ': ' + righe.length + ' righe. ' +
                   'Da qui in poi la stampa dipende dal collegamento — ' +
                   'non chiudere la pagina.');
    aggiorna();
    alimenta();
    return true;
  }

  function alimenta() {
    while (stato === 'invio' && i < righe.length && Api.inCoda() < SCORTA) {
      var riga = righe[i++];
      if (riga === PAUSA) {
        /* Il segno conta come riga fatta: se no l'avanzamento non arriverebbe
           mai a cento, e la percentuale mentirebbe di poco ma per sempre. */
        fatte++;
        cambioPenna();
        return;
      }
      Api.sendMuto(riga).then(fatta, fallita);
    }
    /* Niente più da mandare e niente più in volo: la macchina ha accettato
       tutto. Non vuol dire che abbia finito di muoversi — le ultime righe sono
       nel pianificatore — ma il nostro lavoro è concluso. */
    if (stato === 'invio' && i >= righe.length && Api.inCoda() === 0) {
      stato = 'fine';
      Log.add('msg', 'Programma consegnato per intero: ' + righe.length +
                     ' righe in ' + durata(Date.now() - t0) + '. ' +
                     'La macchina sta finendo le ultime che ha nel buffer.');
      aggiorna();
    }
  }

  function fatta() {
    fatte++;
    aggiorna();
    alimenta();
  }

  /* Un `error:` dalla macchina ferma tutto. Insistere sulle righe successive
     dopo un errore di sintassi o di stato vuol dire disegnare qualcosa di
     diverso da quello che si voleva, il che è peggio che fermarsi. */
  function fallita(err) {
    if (stato === 'fermo' || stato === 'errore') return;  // già interrotta
    stato = 'errore';
    Api.svuota();
    Log.add('err', 'Stampa interrotta alla riga ' + (fatte + 1) + ' di ' +
                   righe.length + ': ' + err.message);
    aggiorna();
    finisci();
  }

  /* IL CAMBIO PENNA. Non c'è niente da fermare: il segno sta al confine fra
     due tratti, quindi la penna è già alzata e nessun comando è a metà. Si
     smette di alimentare e si accoda il parcheggio — tappo e punto home —
     che, essendo in coda, si esegue dopo le righe già dentro la macchina.

     Alla ripresa non serve ricostruire niente: il generatore, dopo il segno,
     ridichiara G, X, Y, Z e F, quindi il primo movimento riporta la testina
     dove deve stare senza che il Sender debba ricordarselo. */
  function cambioPenna() {
    stato = 'cambio';
    Log.add('msg', 'Cambio penna: la testina finisce il poco che ha in coda, ' +
                   'poi sale al tappo e va al punto home. La procedura si apre ' +
                   'da sé e ti guida: togli la penna, il servo scende alla ' +
                   'quota di contatto, monti la nuova lì. Se la chiudi con ' +
                   '«Più tardi», Riprendi la riapre.');
    aggiorna();
    parcheggia();
  }

  /* La ripresa dopo un cambio penna.
   *
   * NON C'E' NESSUNA QUOTA DA CORREGGERE, ed è il punto della procedura: la
   * penna nuova si infila col servo già fermo alla quota di contatto del
   * programma, e si stringe lì. È la penna che si adatta al G-code, non il
   * G-code alla penna — lo stesso gesto con cui la penna si monta la prima
   * volta, e l'unico in cui non c'è un numero da misurare e quindi da
   * sbagliare.
   *
   * Il primo tentativo faceva il contrario: rimisurare dove toccava la penna
   * nuova e spostare di quella differenza tutte le quote delle righe che
   * restavano. Funzionava, ed era venticinque righe di aritmetica per
   * rimediare a un gesto che si può semplicemente fare bene.
   */
  function riprendiCambio() {
    if (stato !== 'cambio') return;
    Log.add('msg', 'Penna nuova montata alla quota del programma: le ' +
                   (righe.length - i) + ' righe che restano valgono come ' +
                   'sono scritte.');
    riprendi();
  }

  function pausa() {
    if (stato !== 'invio') return;
    stato = 'pausa';
    Api.feedHold();
    Log.add('msg', 'Pausa. La penna resta dov\'è, abbassata: riprendendo ' +
                   'continua dallo stesso punto.');
    aggiorna();
  }

  function riprendi() {
    if (stato === 'cambio') {
      stato = 'invio';
      Log.add('msg', 'Riprendo dopo il cambio penna.');
      aggiorna();
      alimenta();
      return;
    }
    if (stato !== 'pausa') return;
    stato = 'invio';
    Api.cycleStart();
    Log.add('msg', 'Riprendo.');
    aggiorna();
    alimenta();
  }

  /* INTERRUZIONE PULITA, e la differenza conta.
     Non si manda un reset: il reset azzera FluidNC e con lui il `G92`, cioè
     l'origine presa a mano sui blocchi — per ricominciare bisognerebbe
     rifare tutta la procedura. Qui invece si smette di alimentare, si butta
     via quello che non è ancora partito, e si accodano alzata e ritorno a
     casa. Siccome il pianificatore è una fila, quei due comandi si eseguono
     DOPO le righe già dentro: la macchina finisce il poco che ha, poi alza e
     torna. L'origine resta buona.

     Il prezzo, che è giusto dire: le righe già in volo vengono disegnate lo
     stesso. Al più la finestra di Api, cioè qualche millimetro. */
  function interrompi() {
    if (stato !== 'invio' && stato !== 'pausa' && stato !== 'cambio') {
      Log.add('msg', 'Nessuna stampa in corso.');
      return;
    }
    var eraInPausa = stato === 'pausa';
    stato = 'fermo';
    Api.svuota();
    if (eraInPausa) Api.cycleStart();   // senza questo resterebbe in feed hold
    Log.add('msg', 'Interrotta a ' + percento() + '%. Le righe già partite ' +
                   'vengono disegnate lo stesso — qualche millimetro — poi ' +
                   'la penna si alza e torna al punto home. L\'origine resta ' +
                   'valida: non serve rifare l\'azzeramento.');
    aggiorna();
    finisci();
  }

  /* Fine del lavoro: la stessa manovra del cambio penna, con un messaggio
     diverso se la macchina non c'è più. */
  function finisci() {
    parcheggia('Niente alzata né ritorno a casa: la macchina non è ' +
               'collegata. La penna è rimasta dov\'era.');
  }

  /* Penna in alto e testina al punto home, ACCODATI come righe normali e non
     mandati d'imperio. Il pianificatore della macchina è una fila:
     accodandoli, si eseguono dopo le righe che la macchina ha già dentro, che
     è l'unico modo di alzare la penna quando il disegno è davvero finito
     invece che mentre sta ancora tracciando.

     Il `catch` non è di cortesia. Se si arriva qui perché il collegamento è
     caduto — ed è uno dei modi di arrivarci — queste due righe non possono
     partire, e una promessa rifiutata che nessuno raccoglie diventa un errore
     non gestito che sporca la console proprio mentre si sta cercando di
     capire cosa è successo. */
  function parcheggia(seScollegata) {
    if (!State.data.connected) {
      Log.add('err', seScollegata || 'La macchina non è collegata: la testina ' +
                                     'è rimasta dov\'era.');
      return;
    }
    var tappo = Profile.zTappo();
    var h = Profile.puntoHome();
    function zitto() { /* il motivo è già nel registro */ }
    if (tappo !== null) Api.send('G90 G0 Z' + tappo.toFixed(3)).catch(zitto);
    Api.send('G90 G0 X' + h.x.toFixed(3) + ' Y' + h.y.toFixed(3) +
             ' F' + Profile.stampa().velocitaSpostamento).catch(zitto);
  }

  /* --------------------------- avanzamento --------------------------- */

  function percento() {
    return righe.length ? Math.round(fatte * 100 / righe.length) : 0;
  }

  /* Stima del tempo che manca sul ritmo MISURATO, non su quello previsto dal
     generatore: il generatore stima il moto, qui si misura la macchina vera
     con la sua rete e le sue pause. Si tace finché il campione è troppo
     piccolo, perché una stima fatta su dieci righe è un numero inventato. */
  function rimanente() {
    if (fatte < 20 || stato !== 'invio') return null;
    var trascorso = Date.now() - t0;
    return Math.round(trascorso * (righe.length - fatte) / fatte);
  }

  function durata(ms) {
    var s = Math.round(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m ? m + 'm ' + s + 's' : s + 's';
  }

  function aggiorna() {
    State.set('stampa', {
      stato: stato,
      nome: nome,
      fatte: fatte,
      totale: righe.length,
      percento: percento(),
      rimanente: rimanente()
    });
  }

  function inCorso() {
    return stato === 'invio' || stato === 'pausa' || stato === 'cambio';
  }

  return {
    avvia: avvia, pausa: pausa, riprendi: riprendi, interrompi: interrompi,
    riprendiCambio: riprendiCambio,
    inCorso: inCorso, prepara: prepara, durata: durata,
    stato: function () { return stato; },
    /* Serve a chi deve decidere se chiedere la rimisurazione: senza una
       quota di partenza non c'è nessuna differenza da calcolare. */
    altezzaUsata: function () { return altezzaUsata; },
    restano: function () { return righe.length - i; }
  };
})();
