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

  /* ---------------------------- il messaggio ---------------------------- */

  /* Quello che il telecomando deve sapere per disegnarsi, e nient'altro.
     La data la mandiamo noi: il telecomando non ha un orologio che
     sopravviva a una batteria scarica, e il browser ce l'ha. Gli serve per
     il registro delle stampe sulla sua SD. */
  function messaggio() {
    var s = State.data.stampa;
    return {
      v: 1,
      stato: s.stato,
      nome: s.nome || '',
      percento: s.percento,
      /* Il tempo rimanente è null finché il Sender non ne ha misurato
         abbastanza, e null deve restare: una stima su dieci righe è un numero
         inventato, e sul vetro del telecomando al suo posto non c'è niente. */
      rimanente: s.rimanente,
      passo: (window.Popup && Popup.passoPenna) ? Popup.passoPenna() : null,
      macchina: State.data.machine,
      azzerata: !!State.data.azzerata,
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
     possono aspettare. */
  function impronta(m) {
    return [m.stato, m.passo, m.macchina, m.azzerata].join('|');
  }

  /* ------------------------------ il dialogo ------------------------------ */

  function manda() {
    if (!indirizzo || inVolo) return;
    var m = messaggio();
    firma = impronta(m);
    inVolo = true;

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
      batteria = (typeof risposta.batteria === 'number') ? risposta.batteria : null;
      segnala();
      if (risposta.tasto) premuto(String(risposta.tasto));
    }).catch(function (e) {
      inVolo = false;
      falliti++;
      /* Si dice una volta sola, quando si smette di crederci: un messaggio di
         rete fallita ogni due secondi riempirebbe il registro di righe che
         raccontano tutte la stessa cosa. */
      if (falliti === PAZIENZA) {
        if (visto) Log.add('err', 'Telecomando non raggiungibile: ' + e.message);
        visto = false;
        batteria = null;
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

    if (tasto === 'pausa') { Sender.pausa(); return; }

    if (tasto === 'riprendi') {
      /* Riprendere da un CAMBIO PENNA non è riprendere da una pausa: in mezzo
         c'è una penna diversa. Si passa dalla procedura, come fa il pulsante
         della pagina. */
      if (Sender.stato() === 'cambio') Popup.telecomando('apri');
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

  /* --------------------------- lo stato per la UI --------------------------- */

  function segnala() {
    State.set('telecomando', {
      attivo: !!indirizzo,
      visto: visto,
      batteria: batteria
    });
  }

  /* ------------------------------- il ritmo ------------------------------- */

  /* Vivo = c'è qualcosa in corso. Lì il ritmo è quello del tasto, non quello
     del dato: lo stato cambia a ogni riga confermata — decine al secondo — e
     mandarne uno per riga vorrebbe dire inondare una scheda che ha 32 kB di
     memoria. */
  function invita() {
    var s = State.data.stampa.stato;
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
    return { indirizzo: indirizzo, visto: visto, batteria: batteria };
  }

  function init() {
    try { indirizzo = localStorage.getItem(CHIAVE) || ''; } catch (e) { indirizzo = ''; }
    segnala();
    if (indirizzo) { manda(); battito(); }

    State.on('stampa', subito);
    State.on('machine', subito);
    State.on('azzerata', subito);
  }

  return { init: init, dove: dove, stato: stato, manda: manda, premuto: premuto };
})();
