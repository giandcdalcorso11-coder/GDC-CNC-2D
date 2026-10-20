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
        testo: 'Appoggia i due carrelli ai blocchi di riferimento, <b>a mano e ' +
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
               'sei alla quota giusta.',
        entra: function () {},
        /* Confermare a penna alzata è l'errore che manda in stampa un disegno
           fatto in aria, e non se ne accorge nessuno finché il foglio non esce
           bianco. Si pretende che la penna sia almeno scesa sotto metà corsa. */
        pronto: function () {
          var alzata = Profile.alzataMm();
          return alzata === null ? false : State.data.pos.z < alzata / 2;
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
        testo: 'Porta la punta sull\'<b>angolo in basso a sinistra del foglio</b>. ' +
               'Se vuoi la conferma, abbassa un attimo la penna: adesso la quota ' +
               'di contatto la conosce, quindi un puntino te lo dice.',
        entra: function () {},
        pronto: function () { return State.data.azzerata; },
        attesa: 'Serve una posizione nota.',
        etichetta: 'Inizio foglio completato',
        esci: function () {
          alzaPenna();
          Paper.setSheetOrigin(State.data.pos.x, State.data.pos.y);
          if (!controllaIngombro()) return false;
          /* Da qui il foglio sullo schermo non è più un'ipotesi: è dove sta
             davvero, e si blocca. */
          Paper.fissa(true);
          return true;
        }
      }
    ];
  }

  function alzaPenna() {
    var alzata = Profile.alzataMm();
    if (alzata === null) return;
    var base = State.data.altezzaContatto === null ? 0 : State.data.altezzaContatto;
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
    passoEtichetta.textContent = 'Passo ' + (i + 1) + ' di ' + passi.length;
    titolo.textContent = p.nome;
    descrizione.innerHTML = p.testo;
    okBtn.textContent = p.etichetta;
    Panel.mount(contenitore, p.sezioni);
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
    consegna();
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
      chiudi();
      Log.add('msg', 'Stampa annullata.');
    });

    /* Le condizioni dei tre passi dipendono dallo stato della macchina, quindi
       il pulsante di conferma si riaccende da sé quando la condizione è vera:
       nessuno deve chiudere e riaprire il popup per sbloccarlo. */
    State.on('pos', aggiorna);
    State.on('azzerata', aggiorna);
    State.on('motoriLiberi', aggiorna);
  }

  return { init: init, avviaStampa: avviaStampa, chiudi: chiudi };
})();
