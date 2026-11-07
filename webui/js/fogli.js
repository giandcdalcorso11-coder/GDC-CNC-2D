/* Più fogli sullo stesso piano.
 *
 * IL PROBLEMA, detto dall'operatore il 2026-11-06: «vorrei andare nella
 * direzione di creare la possibilità di usare più fogli nello stesso momento,
 * quindi la possibilità di aggiungere dei fogli con varie dimensioni e la
 * possibilità di stampare più cose nello stesso momento». Il caso vero sono i
 * magneti della lavagna: nove quadrati da 75 × 75 stanno nella corsa
 * (241,23 × 236,06) con cinque millimetri di gioco — in altezza per un
 * millimetro — e stamparli uno per volta vuol dire nove avvii, nove misure e
 * diciotto cambi penna.
 *
 * QUESTO FILE NON DISEGNA NIENTE e non chiede niente a nessuno: tiene
 * l'elenco, la geometria e le domande che si possono fare a un elenco di
 * rettangoli. L'interfaccia viene dopo (Step 11, fase 2) e il G-code dopo
 * ancora (fase 3). È diviso così perché la geometria si può provare senza
 * aprire una finestra, e perché il giorno in cui il piano si ridisegna in un
 * altro modo queste risposte restano le stesse.
 *
 * L'ACCOSTAMENTO, che è la parte che costa pensarci.
 *
 * Ogni foglio indipendente ha il suo angolo da misurare sulla macchina col
 * terzo popup: nove fogli, nove misure. Ma due fogli SPINTI UNO CONTRO
 * L'ALTRO non sono due misure, sono una misura e una somma — e l'operatore
 * ha chiesto che sia il programma a capirlo da come i fogli sono messi nella
 * tab Disegno, invece di dichiararlo con un interruttore. Quindi
 * l'accostamento si LEGGE DALLA GEOMETRIA: due fogli i cui bordi si toccano
 * (entro `GIOCO`) e che si affacciano l'uno sull'altro per un pezzo vero sono
 * accostati, e il secondo prende l'angolo dal primo.
 *
 * SI GUARDA SOLO INDIETRO NELL'ELENCO, e non è un'ottimizzazione: è quello
 * che impedisce i giri chiusi. Se A potesse agganciarsi a B mentre B si
 * aggancia ad A, nessuno dei due avrebbe un angolo misurato e la catena non
 * finirebbe mai. Guardando solo i fogli che vengono prima, le catene sono per
 * costruzione degli alberi e la radice è sempre il foglio più vecchio del
 * gruppo. Detto all'operatore: **il primo foglio di un gruppo accostato è
 * quello che si misura**.
 */
var Fogli = (function () {

  /* Quanto possono distare due bordi per dirsi «che si toccano». Un
     millimetro: accostare due fogli è un gesto deliberato — li spingi finché
     non sbattono — e una tolleranza larga trasformerebbe «li ho messi vicini»
     in «ho dichiarato che li ho spinti insieme», che è una misura inventata. */
  var GIOCO = 1;

  /* E quanto si devono affacciare per dirsi accostati e non solo sfiorati.
     Due fogli che si toccano per un angolo non sono una coppia: sono due
     fogli che per caso hanno un vertice in comune, e ricavare l'angolo di uno
     dall'altro su quel contatto vorrebbe dire fidarsi di niente. */
  var AFFACCIO = 10;

  function elenco() { return State.data.fogli; }
  function attivo() { return State.foglio(); }

  function trova(id) {
    var l = elenco();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function indice(id) {
    var l = elenco();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return i;
    return -1;
  }

  /* Il rettangolo del foglio in coordinate MACCHINA. Tutta la geometria qui
     dentro lavora lì: un foglio non ha un «dentro di sé» che si possa
     confrontare con quello di un altro. */
  function rett(f) {
    return { x0: f.origine.x, y0: f.origine.y,
             x1: f.origine.x + f.w, y1: f.origine.y + f.h };
  }

  /* ------------------------------ scegliere ------------------------------ */

  function scegli(id) {
    if (!trova(id) || State.data.foglioAttivo === id) return false;
    State.data.foglioAttivo = id;
    /* Due segnali e non uno: `fogli` dice che l'elenco o la scelta sono
       cambiati, `paper` dice che il foglio in uso non è più quello — e
       mezza pagina ascolta già `paper` da prima che i fogli fossero più
       d'uno. Mandarne uno solo vorrebbe dire aggiornare l'elenco e lasciare
       il piano a disegnare il foglio di prima. */
    State.emit('fogli');
    State.emit('paper');
    return true;
  }

  /* ----------------------- aggiungere e togliere ------------------------- */

  /* Un foglio nuovo si posa DOVE C'È POSTO, e la prima scelta è accanto a
     quello più a destra: è il gesto dei magneti — se ne mette un altro di
     fianco — e posandolo lì nasce già accostato, quindi senza una misura in
     più. Se di fianco non ci sta si prova sopra, poi si cerca su una griglia,
     e se proprio non c'è posto lo si mette lo stesso in basso a sinistra: un
     foglio che non si crea è più difficile da capire di un foglio che si vede
     e che la pagina segnala come fuori posto. */
  function posaLibera(w, h) {
    var a = State.data.area;
    var l = elenco();
    var candidati = [];

    l.forEach(function (f) {
      var r = rett(f);
      candidati.push({ x: r.x1, y: r.y0 });       // a destra, stessa base
      candidati.push({ x: r.x0, y: r.y1 });       // sopra, stesso sinistro
    });
    candidati.push({ x: 0, y: 0 });

    for (var p = 0; p < candidati.length; p++) {
      if (sta(candidati[p].x, candidati[p].y, w, h)) return candidati[p];
    }

    /* La griglia è l'ultima spiaggia, e il passo è cinque millimetri perché
       sotto si cercherebbe a lungo per trovare una posa che differisce da
       un'altra per meno di quanto un foglio si posa a mano. */
    for (var y = 0; y + h <= a.h; y += 5) {
      for (var x = 0; x + w <= a.w; x += 5) {
        if (sta(x, y, w, h)) return { x: x, y: y };
      }
    }
    return { x: 0, y: 0 };
  }

  function sta(x, y, w, h) {
    var a = State.data.area;
    if (x < 0 || y < 0 || x + w > a.w || y + h > a.h) return false;
    var l = elenco();
    for (var i = 0; i < l.length; i++) {
      var r = rett(l[i]);
      /* Toccarsi non è sovrapporsi: due fogli accostati condividono un bordo
         e vanno benissimo. Il confronto è stretto, con il gioco tolto. */
      if (x + w > r.x0 + GIOCO && x < r.x1 - GIOCO &&
          y + h > r.y0 + GIOCO && y < r.y1 - GIOCO) return false;
    }
    return true;
  }

  function aggiungi(w, h, nome) {
    var p = posaLibera(w, h);
    var f = State.nuovoFoglio({ w: w, h: h, name: nome || null, x: p.x, y: p.y });
    elenco().push(f);
    rileggiAgganci();
    State.emit('fogli');
    return f;
  }

  /* L'ULTIMO FOGLIO NON SI TOGLIE. Non è una cortesia: senza nessun foglio
     non c'è nessun sistema di riferimento, i livelli non avrebbero dove
     stare e il piano disegnerebbe un rettangolo largo NaN. */
  function togli(id) {
    var l = elenco();
    if (l.length < 2) return false;
    var i = indice(id);
    if (i < 0) return false;
    l.splice(i, 1);
    if (State.data.foglioAttivo === id) {
      State.data.foglioAttivo = l[Math.min(i, l.length - 1)].id;
    }
    /* Gli agganci si rileggono DOPO aver tolto: chi era accostato a questo
       foglio adesso o è accostato a un altro o sta per conto suo, e in
       nessuno dei due casi può continuare a ricavare il suo angolo da un
       foglio che non c'è più. */
    rileggiAgganci();
    State.emit('fogli');
    State.emit('paper');
    return true;
  }

  function muovi(id, x, y) {
    var f = trova(id);
    if (!f) return false;
    f.origine = { x: +x, y: +y };
    /* Spostare un foglio cambia chi tocca chi: un foglio staccato dal suo
       vicino torna a doversi misurare da solo, e nessuno glielo direbbe. */
    rileggiAgganci();
    State.emit('fogli');
    State.emit('paper');
    return true;
  }

  /* ----------------------------- l'accostamento -------------------------- */

  /* A quale foglio PRECEDENTE questo è accostato, o null se sta per conto
     suo. Si guarda solo indietro: vedi la nota in cima al file. */
  function aggancioDi(id) {
    var i = indice(id);
    if (i <= 0) return null;
    var l = elenco(), f = l[i];
    for (var j = 0; j < i; j++) {
      if (accostati(f, l[j])) return l[j].id;
    }
    return null;
  }

  /* Due fogli si toccano su un bordo e si affacciano per un pezzo vero. */
  function accostati(a, b) {
    var ra = rett(a), rb = rett(b);

    var sovrX = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0);
    var sovrY = Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0);

    /* Fianco a fianco: i bordi verticali si toccano e le due altezze si
       affacciano. Oppure sopra e sotto, che è la stessa cosa girata. */
    if (sovrY >= AFFACCIO &&
        (Math.abs(ra.x0 - rb.x1) <= GIOCO || Math.abs(ra.x1 - rb.x0) <= GIOCO)) {
      return true;
    }
    if (sovrX >= AFFACCIO &&
        (Math.abs(ra.y0 - rb.y1) <= GIOCO || Math.abs(ra.y1 - rb.y0) <= GIOCO)) {
      return true;
    }
    return false;
  }

  function rileggiAgganci() {
    elenco().forEach(function (f) { f.aggancio = aggancioDi(f.id); });
  }

  /* I fogli il cui angolo va MISURATO sulla macchina: quelli che non sono
     accostati a nessuno. Sono questi che fanno un popup per uno; gli altri
     il loro angolo ce l'hanno già, come somma. */
  function daMisurare() {
    return elenco().filter(function (f) { return !f.aggancio; });
  }

  /* Da quale foglio misurato discende, risalendo la catena. Serve a dire a
     chi guarda PERCHÉ un foglio non chiede la sua misura. Il giro si conta e
     si ferma: gli agganci sono un albero per costruzione, ma una struttura
     caricata da un file potrebbe non esserlo, e un ciclo qui bloccherebbe la
     pagina invece di dare una risposta sbagliata. */
  function radiceDi(id) {
    var f = trova(id), giri = 0;
    while (f && f.aggancio && giri++ < 100) f = trova(f.aggancio);
    return f ? f.id : null;
  }

  /* --------------------------- quello che non va ------------------------- */

  /* Le coppie che si sovrappongono. Toccarsi no: quello è accostarsi. */
  function sovrapposti() {
    var l = elenco(), out = [];
    for (var i = 0; i < l.length; i++) {
      for (var j = i + 1; j < l.length; j++) {
        var a = rett(l[i]), b = rett(l[j]);
        if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > GIOCO &&
            Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > GIOCO) {
          out.push([l[i].id, l[j].id]);
        }
      }
    }
    return out;
  }

  /* Quanto di questo foglio la penna raggiunge: è `Paper.raggiungibile()`,
     ma per un foglio qualunque invece che per quello in uso. Il giorno in
     cui i fogli sono nove, «il foglio esce dalla corsa» va detto di quale. */
  function raggiungibile(id) {
    var f = trova(id);
    if (!f) return null;
    var a = State.data.area, r = rett(f);
    var x0 = Math.max(0, r.x0), x1 = Math.min(a.w, r.x1);
    var y0 = Math.max(0, r.y0), y1 = Math.min(a.h, r.y1);
    return {
      w: Math.max(0, x1 - x0),
      h: Math.max(0, y1 - y0),
      dax: x0 - r.x0,
      day: y0 - r.y0,
      sporge: r.x0 < 0 || r.y0 < 0 || r.x1 > a.w || r.y1 > a.h,
      piuGrande: f.w > a.w || f.h > a.h
    };
  }

  function fuoriCorsa() {
    return elenco().filter(function (f) {
      var r = raggiungibile(f.id);
      return r && r.sporge;
    }).map(function (f) { return f.id; });
  }

  return {
    GIOCO: GIOCO, AFFACCIO: AFFACCIO,
    elenco: elenco, attivo: attivo, trova: trova, indice: indice,
    rett: rett, scegli: scegli,
    aggiungi: aggiungi, togli: togli, muovi: muovi, posaLibera: posaLibera,
    accostati: accostati, aggancioDi: aggancioDi, rileggiAgganci: rileggiAgganci,
    daMisurare: daMisurare, radiceDi: radiceDi,
    sovrapposti: sovrapposti, raggiungibile: raggiungibile, fuoriCorsa: fuoriCorsa
  };
})();
