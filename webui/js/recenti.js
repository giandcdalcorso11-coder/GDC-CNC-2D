/* I DISEGNI RECENTI: il salvataggio che non si dimentica, e il menu per
 * ritrovare quello che c'era.
 *
 * IL PROBLEMA, detto dall'utente il 2026-11-12: «un menù "disegni recenti" e
 * un salvataggio automatico che non si perde». Oggi un disegno non salvato
 * muore con la pagina, e il salvataggio esplicito non permette nemmeno di
 * cambiare il nome del file mentre si salva -- il nome esce da
 * `State.data.artName`, cioe' dal nome del primo file importato.
 *
 * DUE COSE DIVERSE, e nel menu stanno in due gruppi:
 *
 *   I RECUPERI li scrive il programma da solo, scadono e si sovrascrivono.
 *   Servono a una domanda sola: «la pagina si e' chiusa, dov'era il mio
 *   lavoro?». Non sono una cronologia e non sono una storia dei passi --
 *   quella e' Ctrl+Z, e vive nell'editor.
 *
 *   I PROGETTI li salva l'utente con un nome, non scadono e non si
 *   sovrascrivono. Sono quello che si vuole ritrovare fra un mese.
 *
 * Tenerli insieme vorrebbe dire che un recupero di dieci minuti fa, scritto
 * da solo, puo' spingere fuori dall'elenco un progetto a cui si teneva.
 *
 * NON «ALLA CHIUSURA DELLA PAGINA», MA CONTINUO. Alla chiusura il browser non
 * garantisce niente: `beforeunload` non puo' fare una richiesta di rete
 * affidabile, `sendBeacon` e' un colpo solo senza risposta, e una scheda che
 * il sistema uccide -- su un iPad capita, quando la memoria serve altrove --
 * non manda alcun evento. L'unico salvataggio che c'e' quando serve e' quello
 * che e' gia' stato fatto prima.
 *
 * INDEXEDDB E NON `localStorage`: cinque megabyte e sole stringhe, con tutte
 * le schede della stessa origine che se li dividono. Un progetto da nove
 * magneti e' qualche centinaio di kilobyte, e venti recuperi li
 * riempirebbero.
 *
 * UNO SLOT PER SESSIONE DI LAVORO, non uno ogni quattro secondi. Il recupero
 * si riusa finche' si sta lavorando alla stessa cosa, e se ne apre uno nuovo
 * quando la pagina si ricarica, quando arriva un file nuovo, o dopo una pausa
 * lunga. Senza questa regola venti slot diventano venti copie dello stesso
 * disegno a quattro secondi di distanza, cioe' un elenco illeggibile e
 * nessuna delle versioni che servirebbero.
 *
 * QUESTA META' NON HA BISOGNO DELLA SCHEDA SD. Il secondo livello -- la copia
 * sulla SD del telecomando, per ritrovare il lavoro da un altro dispositivo
 * -- e' il passo 3 del lavoro 1 dello Step 13 e arriva col telecomando. Qui
 * c'e' solo la copia locale, che e' quella che si puo' provare al banco e
 * dall'iPad prima che la macchina torni.
 *
 * E UNA CONSEGUENZA CHE VALE LA PENA SAPERE: sull'iPad lo SCARICAMENTO di un
 * file non funziona -- il visore delle pagine non concede alle pagine il
 * permesso di consegnare file -- quindi fino a ieri, da la', «Salva» non
 * salvava niente. Da adesso il progetto salvato resta comunque QUI, nei
 * disegni recenti, e si riapre. Il file scaricato e la copia locale sono due
 * cose e ne basta una.
 */
var Recenti = (function () {

  var DB_NOME = 'gdc-cnc2d';
  var NEGOZIO = 'disegni';
  var DB_VER = 1;

  /* Venti recuperi, e un taglio a trenta giorni. La cosa da proteggere non e'
     lo spazio -- venti recuperi da trecento kilobyte sono sei megabyte, e la
     memoria del browser ne concede molti di piu' -- ma la LEGGIBILITA' del
     menu: un elenco di sessanta righe non si guarda, si scorre, ed e' un
     altro modo di non ritrovare le cose. */
  var SLOT = 20;
  var GIORNI = 30;

  /* Oltre questa pausa senza scrivere niente, si sta lavorando a un'altra
     cosa: il recupero apre uno slot nuovo invece di sovrascrivere quello di
     stamattina. */
  var PAUSA_MS = 30 * 60 * 1000;

  /* Quanto si aspetta dopo l'ULTIMA modifica. Non e' un ritmo fisso: ogni
     modifica rimanda la scrittura, cosi' durante un trascinamento non si
     scrive niente e un attimo dopo che la mano si ferma si scrive una volta
     sola. */
  var ATTESA_MS = 4000;

  /* Un disegno piu' grosso di cosi' non si tiene come recupero: non per lo
     spazio, ma perche' scriverlo ogni volta che la mano si ferma costerebbe
     piu' del disegno stesso. Il salvataggio a mano non ha questo limite --
     quello lo chiede l'utente, e aspetta. */
  var MAX_RECUPERO = 3 * 1024 * 1024;

  /* L'ORA DEL SALVATAGGIO NON CONTA COME UNA MODIFICA.
     `Progetto.testo()` scrive dentro al file il momento in cui l'ha scritto
     (`salvato`), quindi due chiamate a un secondo di distanza danno due testi
     DIVERSI anche su un disegno che non e' stato toccato. Confrontando i
     testi interi, «e' cambiato qualcosa?» rispondeva sempre si': il recupero
     si riscriveva a ogni notifica, e `path` lo emette anche a ogni cambio di
     SELEZIONE -- cioe' a ogni clic in giro. Trovato dal banco il 2026-11-15.

     SI AGGANCIA IL NOME DEL CAMPO E LA FORMA DELLA DATA, non le virgolette, e
     la ragione e' il secondo difetto trovato dieci minuti dopo il primo:
     dentro al file quel JSON e' scritto con le virgolette ESCAPATE come
     entita' HTML (`&quot;salvato&quot;:&quot;2026-...&quot;`), perche' sta
     dentro a un documento SVG. Una regola scritta coi virgolettati normali
     non agganciava niente e sembrava funzionare -- non dava errore, non
     cambiava niente. Cosi' invece vale in entrambe le scritture, e non puo'
     mangiarsi per sbaglio un pezzo del disegno: la data deve stare attaccata
     alla parola «salvato».

     Resta un accordo con la forma che `progetto.js` da' a quel campo, quindi
     e' fragile per costruzione: c'e' un controllo che lo prova, e se un
     giorno quel campo cambia nome il banco lo dice invece di lasciare il
     recupero a riscriversi in silenzio. */
  var ORA_SALVATO = /salvato[^0-9]{0,16}\d{4}-\d{2}-\d{2}T[\d:.]+Z/;

  function impronta(t) {
    return String(t).replace(ORA_SALVATO, 'salvato');
  }

  var db = null;            // la connessione, una volta aperta
  var apertura = null;      // la promessa dell'apertura in corso
  var spento = false;       // vero quando IndexedDB non c'e' o ha detto no

  var sessione = null;      // l'id dello slot di recupero di adesso
  var scritto = null;       // l'impronta del testo scritto l'ultima volta
  var quando = 0;           // quando si e' scritto l'ultima volta
  var attesa = null;        // il timer del rinvio

  /* ------------------------- la memoria del browser ------------------------- */

  /* L'APERTURA PUO' FALLIRE IN SILENZIO, e succede per davvero: in una
     finestra privata, con i dati del sito bloccati, o dentro a un visore che
     non concede la memoria. Allora `spento` resta vero per sempre e tutto il
     resto del modulo non fa niente -- la pagina funziona come prima, e il
     menu lo dice invece di restare vuoto senza spiegazioni. */
  function apri() {
    if (db) return Promise.resolve(db);
    if (spento) return Promise.resolve(null);
    if (apertura) return apertura;
    apertura = new Promise(function (ok) {
      var r;
      try {
        if (!window.indexedDB) { spento = true; return ok(null); }
        r = indexedDB.open(DB_NOME, DB_VER);
      } catch (e) { spento = true; return ok(null); }
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains(NEGOZIO)) {
          var s = d.createObjectStore(NEGOZIO, { keyPath: 'id' });
          s.createIndex('quando', 'quando');
        }
      };
      r.onsuccess = function () { db = r.result; ok(db); };
      r.onerror = function () { spento = true; ok(null); };
      r.onblocked = function () { spento = true; ok(null); };
    });
    return apertura;
  }

  function conNegozio(modo, fn) {
    return apri().then(function (d) {
      if (!d) return null;
      return new Promise(function (ok) {
        var t;
        try { t = d.transaction(NEGOZIO, modo); } catch (e) { return ok(null); }
        var risposta = null;
        t.oncomplete = function () { ok(risposta); };
        t.onerror = function () { ok(null); };
        t.onabort = function () { ok(null); };
        try {
          fn(t.objectStore(NEGOZIO), function (v) { risposta = v; });
        } catch (e) { ok(null); }
      });
    });
  }

  /* L'ELENCO, dal piu' recente al piu' vecchio, SENZA IL TESTO dei disegni.
     Il menu mostra nomi e date: tirarsi dietro anche sei megabyte di SVG per
     scrivere venti righe vorrebbe dire aprire il menu con un'attesa. */
  function elenco() {
    return conNegozio('readonly', function (s, rispondi) {
      var r = s.getAll();
      r.onsuccess = function () {
        var out = (r.result || []).map(function (v) {
          return { id: v.id, tipo: v.tipo, nome: v.nome, quando: v.quando,
                   livelli: v.livelli, fogli: v.fogli, byte: v.byte };
        });
        out.sort(function (a, b) { return b.quando - a.quando; });
        rispondi(out);
      };
    }).then(function (v) { return v || []; });
  }

  function leggi(id) {
    return conNegozio('readonly', function (s, rispondi) {
      var r = s.get(id);
      r.onsuccess = function () { rispondi(r.result || null); };
    });
  }

  function metti(rec) {
    return conNegozio('readwrite', function (s, rispondi) {
      s.put(rec);
      rispondi(true);
    }).then(function (v) { return !!v; });
  }

  function togli(id) {
    return conNegozio('readwrite', function (s, rispondi) {
      s.delete(id);
      rispondi(true);
    });
  }

  /* LA POTATURA, e tocca SOLO i recuperi. Un progetto salvato a mano non
     scade e non si conta nei venti: l'utente gli ha dato un nome, che e' il
     modo in cui ha detto «questo tienilo». */
  function pulisci() {
    return conNegozio('readwrite', function (s, rispondi) {
      var r = s.getAll();
      r.onsuccess = function () {
        var tutti = (r.result || []).filter(function (v) {
          return v.tipo === 'recupero';
        });
        tutti.sort(function (a, b) { return b.quando - a.quando; });
        var limite = Date.now() - GIORNI * 24 * 3600 * 1000;
        var via = 0;
        tutti.forEach(function (v, i) {
          if (i >= SLOT || v.quando < limite) { s.delete(v.id); via++; }
        });
        rispondi(via);
      };
    });
  }

  /* ----------------------------- che cosa salvare ----------------------------- */

  function info() {
    var p = (window.Artwork && Artwork.progetto) ? Artwork.progetto() : null;
    return {
      livelli: p && p.livelli ? p.livelli.length : 0,
      fogli: (State.data.fogli || []).length
    };
  }

  function nomeOra() {
    var n = (State.data.artName || '').replace(/\.svg$/i, '').trim();
    return n || 'senza nome';
  }

  /* ------------------------------- il recupero ------------------------------- */

  /* UNO SLOT NUOVO. La chiama chi sa che da qui in poi si lavora a un'altra
     cosa: il caricamento di un file, l'apertura di un progetto. Non si
     cancella niente -- il recupero di prima resta nell'elenco -- si smette
     soltanto di sovrascriverlo. */
  function nuovaSessione() {
    sessione = null;
    scritto = null;
  }

  function slot() {
    /* Dopo una pausa lunga lo slot di prima e' di un'altra sessione di
       lavoro, e sovrascriverlo vorrebbe dire perdere il punto in cui si era
       arrivati stamattina. */
    if (sessione && quando && Date.now() - quando > PAUSA_MS) nuovaSessione();
    if (!sessione) sessione = 'r' + Date.now().toString(36) +
                              Math.random().toString(36).slice(2, 6);
    return sessione;
  }

  /* IL RECUPERO, SUBITO. Torna una promessa che dice se ha scritto. */
  function recuperaOra() {
    if (!window.Progetto || !window.Artwork) return Promise.resolve(false);
    var i = info();
    /* NIENTE LIVELLI, NIENTE RECUPERO. Un piano vuoto non e' lavoro da
       perdere, ed e' anche lo stato della pagina appena aperta: scriverlo
       vorrebbe dire che ogni apertura della pagina consuma uno slot per
       salvare il nulla. */
    if (!i.livelli) return Promise.resolve(false);
    /* Durante una stampa il disegno non cambia -- quindi non c'e' niente di
       nuovo da salvare -- e il processore sta mandando il programma alla
       macchina. Si aspetta. */
    if (State.data.stampa && State.data.stampa.stato !== 'fermo') {
      return Promise.resolve(false);
    }
    var testo;
    try { testo = Progetto.testo(); } catch (e) { return Promise.resolve(false); }
    if (!testo) return Promise.resolve(false);
    var segno = impronta(testo);
    if (segno === scritto) return Promise.resolve(false);
    if (testo.length > MAX_RECUPERO) return Promise.resolve(false);

    var rec = { id: slot(), tipo: 'recupero', nome: nomeOra(),
                quando: Date.now(), livelli: i.livelli, fogli: i.fogli,
                byte: testo.length, testo: testo };
    return metti(rec).then(function (fatto) {
      if (!fatto) return false;
      scritto = segno;
      quando = rec.quando;
      return pulisci().then(function () { return true; });
    });
  }

  /* OGNI MODIFICA RIMANDA LA SCRITTURA. Durante un trascinamento arrivano
     decine di notifiche e non si scrive niente; un attimo dopo che la mano si
     ferma si scrive una volta sola. */
  function segnala() {
    if (attesa) clearTimeout(attesa);
    attesa = setTimeout(function () {
      attesa = null;
      recuperaOra();
    }, ATTESA_MS);
  }

  /* ------------------------------ i progetti ------------------------------ */

  /* UN PROGETTO SALVATO A MANO, tenuto anche qui. Il file scaricato resta la
     cosa che si porta via; questa e' la copia che si ritrova senza cercarla
     fra i Download -- e sull'iPad, dove lo scaricamento non funziona, e'
     l'unica che resta. */
  function salvaProgetto(nome, testo) {
    var i = info();
    return metti({ id: 'p' + Date.now().toString(36) +
                       Math.random().toString(36).slice(2, 6),
                   tipo: 'progetto', nome: nome, quando: Date.now(),
                   livelli: i.livelli, fogli: i.fogli,
                   byte: testo.length, testo: testo });
  }

  /* ------------------------------- il menu ------------------------------- */

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  /* QUANDO, detto come lo direbbe una persona. «2026-11-15 20:44» e' esatto e
     non si legge: davanti a un elenco di recuperi la domanda e' «qual e' il
     mio», e la risposta e' «quello di dieci minuti fa». La data intera resta
     nel suggerimento, per quando la domanda e' un'altra. */
  function fa(t) {
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 90) return 'adesso';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' minuti fa';
    var o = Math.round(m / 60);
    if (o < 24) return o === 1 ? 'un\'ora fa' : o + ' ore fa';
    var g = Math.round(o / 24);
    if (g === 1) return 'ieri';
    if (g < 30) return g + ' giorni fa';
    return 'piu\' di un mese fa';
  }

  function quandoIntero(t) {
    var d = new Date(t), due = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + due(d.getMonth() + 1) + '-' + due(d.getDate()) +
           ' ' + due(d.getHours()) + ':' + due(d.getMinutes());
  }

  function riga(v) {
    var q = v.livelli + (v.livelli === 1 ? ' livello' : ' livelli') +
            (v.fogli > 1 ? ' · ' + v.fogli + ' fogli' : '');
    return '<div class="rec-riga" data-id="' + esc(v.id) + '">' +
           '<button type="button" class="rec-apri" data-apri="' + esc(v.id) + '"' +
           ' title="Riapri questo disegno (' + esc(quandoIntero(v.quando)) + ')">' +
           '<span class="rec-nome">' + esc(v.nome) + '</span>' +
           '<span class="rec-quando">' + esc(fa(v.quando)) + ' · ' + esc(q) + '</span>' +
           '</button>' +
           '<button type="button" class="rec-via" data-via="' + esc(v.id) + '"' +
           ' aria-label="Togli dall\'elenco" title="Togli dall\'elenco">' +
           '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>' +
           '</button></div>';
  }

  function gruppo(titolo, nota, righe) {
    if (!righe.length) return '';
    return '<div class="rec-gruppo"><div class="rec-tit">' + esc(titolo) +
           '</div><p class="hint">' + esc(nota) + '</p>' + righe.join('') + '</div>';
  }

  function disegna() {
    var box = el('rec-elenco');
    if (!box) return Promise.resolve();
    return elenco().then(function (tutti) {
      if (spento && !tutti.length) {
        box.innerHTML = '<p class="hint guaio">Questo browser non concede alla ' +
          'pagina la sua memoria — succede in una finestra privata, o con i ' +
          'dati del sito bloccati. Il salvataggio automatico quindi non c’è: ' +
          'il pulsante <b>Salva</b> funziona come sempre.</p>';
        return;
      }
      if (!tutti.length) {
        box.innerHTML = '<p class="hint">Ancora niente. I disegni a cui lavori ' +
          'compaiono qui da soli, e quelli che salvi col nome restano fino a ' +
          'quando li togli.</p>';
        return;
      }
      var prog = tutti.filter(function (v) { return v.tipo === 'progetto'; }).map(riga);
      var rec = tutti.filter(function (v) { return v.tipo === 'recupero'; }).map(riga);
      box.innerHTML =
        gruppo('Progetti salvati', 'Li hai salvati tu con un nome: non scadono.', prog) +
        gruppo('Ripresi da soli', 'Scritti dal programma mentre lavoravi: ne resta ' +
               'uno per sessione, gli ultimi ' + SLOT + ' e non oltre ' +
               GIORNI + ' giorni.', rec);
    });
  }

  function mostra() {
    var m = el('rec-modal');
    if (!m) return;
    m.hidden = false;
    disegna();
  }

  function chiudi() {
    var m = el('rec-modal');
    if (m) m.hidden = true;
  }

  /* RIAPRIRE UN DISEGNO E' LA STESSA COSA CHE APRIRE IL SUO FILE, e passa
     per la stessa strada: `Artwork.load` riconosce il progetto, e se sul
     piano c'e' del lavoro chiede se sostituire o aggiungere, con la
     finestrella che l'utente conosce gia'. Qui non si decide niente di
     quello -- sarebbe una seconda risposta alla stessa domanda, scritta in
     un altro posto e destinata a divergere. */
  function apriRecente(id) {
    return leggi(id).then(function (v) {
      if (!v || !v.testo) {
        Log.add('err', 'Quel disegno non c’è più nella memoria del browser.');
        return disegna();
      }
      chiudi();
      /* Da qui in poi si lavora a un'altra cosa: il recupero apre uno slot
         nuovo invece di sovrascrivere quello del disegno di prima. */
      nuovaSessione();
      Artwork.load(v.testo, v.nome + '.svg');
      Log.add('msg', 'Ripreso «' + v.nome + '», ' + fa(v.quando) + '.');
    });
  }

  function init() {
    var b = el('btn-recenti');
    if (b) b.addEventListener('click', mostra);
    var m = el('rec-modal');
    if (m) {
      m.addEventListener('click', function (e) {
        if (e.target === this) chiudi();
      });
      var box = el('rec-elenco');
      /* UN ASCOLTATORE SOLO sul contenitore: l'elenco si ridisegna intero a
         ogni riga tolta, e dei gestori attaccati riga per riga ne
         resterebbero in giro. */
      box.addEventListener('click', function (e) {
        var a = e.target.closest('[data-apri]');
        if (a) return void apriRecente(a.dataset.apri);
        var v = e.target.closest('[data-via]');
        if (v) {
          togli(v.dataset.via).then(disegna);
          if (v.dataset.via === sessione) nuovaSessione();
        }
      });
      el('rec-chiudi').addEventListener('click', chiudi);
    }
    document.addEventListener('keydown', function (e) {
      if (!el('rec-modal') || el('rec-modal').hidden) return;
      if (e.key === 'Escape') chiudi();
    });

    /* IL DISEGNO E` CAMBIATO. `path` lo emette Artwork a ogni modifica -- e
       anche a ogni cambio di selezione, che non e' una modifica: il confronto
       col testo scritto l'ultima volta se ne accorge e non riscrive niente. */
    State.on('path', segnala);
    State.on('fogli', segnala);

    /* La potatura al primo avvio, non alla prima scrittura: un elenco che
       porta roba scaduta dal mese scorso la mostra fino al primo salvataggio
       -- cioe' proprio nel momento in cui lo si apre per cercare qualcosa. */
    pulisci();
  }

  return { init: init, mostra: mostra, chiudi: chiudi, disegna: disegna,
           impronta: impronta,
           elenco: elenco, leggi: leggi, metti: metti, togli: togli,
           pulisci: pulisci, salvaProgetto: salvaProgetto,
           recuperaOra: recuperaOra, nuovaSessione: nuovaSessione,
           apriRecente: apriRecente,
           SLOT: SLOT, GIORNI: GIORNI, ATTESA_MS: ATTESA_MS,
           PAUSA_MS: PAUSA_MS };
})();
