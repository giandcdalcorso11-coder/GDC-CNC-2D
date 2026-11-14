/* I GESTI CON DUE DITA: la pinzata per ingrandire, e il conto delle dita.
 *
 * PERCHE' ESISTE QUESTO FILE. Il piano e l'editor si ingrandiscono con la
 * ROTELLA, e la rotella su un tablet non c'e'. Fino a qui dall'iPad si poteva
 * spostare lo sguardo ma non avvicinarlo: un disegno di due millimetri si
 * guardava da lontano e basta. La pinzata e' l'unico gesto che su quegli
 * schermi significa «avvicina», e non ha alternative da tastiera.
 *
 * PERCHE' STA IN UN POSTO SOLO. I due disegni da pinzare sono due -- il piano
 * (`paper.js`) e la tela dell'editor (`editor.js`) -- e la pinzata e' fatta
 * di aritmetica che sbagliata non si vede subito: si vede che il disegno
 * «scappa» mentre si allargano le dita. Due copie di quell'aritmetica
 * divergono alla prima correzione. Qui dentro non c'e' niente che sappia che
 * cosa sta guardando: il chiamante dice come si legge la finestra, come si
 * scrive, e dove cade un punto dello schermo nel suo disegno. Il verso della
 * y -- che sul piano cresce verso l'alto e nell'editor verso il basso -- non
 * compare mai, perche' viaggia dentro `dove()`.
 *
 * COME SI ANCORA, e perche' il conto e' ASSOLUTO.
 * Quello che sta FRA le due dita ci resta, mentre le dita si allargano e
 * mentre si spostano: la pinzata ingrandisce e sposta insieme, perche' e'
 * cosi' che la fa la mano.
 * Il primo tentativo misurava ogni passo su quello prima, e il disegno
 * scappava di una decina di pixel per pinzata. Il motivo non e' un errore di
 * formula: gli eventi del tocco arrivano UN DITO ALLA VOLTA, quindi a meta'
 * di ogni passo il punto medio e' fatto di un dito nuovo e di uno vecchio.
 * I due mezzi spostamenti si annullerebbero, se non capitassero a due
 * ingrandimenti diversi -- e cosi' lasciano un residuo che si somma passo
 * dopo passo. Adesso ogni passo si misura sull'INIZIO della pinzata: due
 * dita che tornano dove erano riportano il disegno esattamente dov'era, e
 * non c'e' niente che si accumuli.
 */
var Tocco = (function () {

  /* Le dita appoggiate su ciascun elemento. Un registro per elemento e non
     uno solo: il piano e l'editor sono due superfici diverse, e un dito
     sull'una non deve contare per l'altra. */
  var registri = [];

  function registro(el) {
    for (var i = 0; i < registri.length; i++) {
      if (registri[i].el === el) return registri[i];
    }
    var r = { el: el, giu: {} };
    registri.push(r);
    return r;
  }

  function quante(giu) { return Object.keys(giu).length; }

  /* QUANTE DITA CI SONO SOPRA. Serve a chi si era gia' preso il gesto: il
     primo dito fa partire uno spostamento dello sguardo o il trascinamento di
     un foglio, e quando ne arriva un secondo quel gesto non e' piu' quello
     che l'utente sta facendo. Senza questa domanda, pinzando si ingrandisce E
     si trascina il foglio allo stesso tempo. */
  function dita(el) {
    for (var i = 0; i < registri.length; i++) {
      if (registri[i].el === el) return quante(registri[i].giu);
    }
    return 0;
  }

  /* `c` dice al modulo come lavorare sul disegno di chi chiama:
       leggi()            -> la finestra di adesso, {x0, y0, w, h}
       scrivi(f)          -> posa la finestra nuova e ridisegna
       dove(cx, cy)       -> dove cade un punto dello SCHERMO nel disegno
       minimo() massimo() -> quanto puo' diventare stretta e larga la finestra
                             (gli stessi limiti della rotella: senza, due dita
                              distratte portano a guardare un micron o una
                              provincia, e tornare indietro e' un lavoro) */
  function pizzica(el, c) {
    var r = registro(el);
    var base = null;   // com'era il mondo quando le due dita si sono posate

    /* Fotografa l'inizio della pinzata: le due dita, la finestra di adesso,
       il punto del disegno che sta in mezzo, e quanto vale un pixel -- con
       il suo segno. Il verso della y (sul piano cresce verso l'alto, nella
       tela dell'editor verso il basso) non si scrive qui: si MISURA,
       chiedendo due punti alla mappa di chi chiama. Cosi' questo modulo non
       sa che cosa sta guardando, ed e' il motivo per cui ce n'e' uno solo. */
    function fonda() {
      var ids = Object.keys(r.giu);
      if (ids.length !== 2) return;
      var a = r.giu[ids[0]], b = r.giu[ids[1]];
      var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
      if (!d) return;
      var v0 = c.leggi();
      if (!v0 || !v0.w) return;
      var m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      var q0 = c.dove(m.x, m.y);
      var q1 = c.dove(m.x + 100, m.y + 100);
      base = { d: d, m: m, v: v0, ancora: q0,
               kx: (q1.x - q0.x) / 100, ky: (q1.y - q0.y) / 100 };
    }

    /* IN CATTURA, cioe' prima dei gestori di chi sta sotto: il dito va
       contato PRIMA che lo spostamento dello sguardo decida se prenderselo,
       se no il conto arriva sempre un gesto in ritardo. */
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      r.giu[e.pointerId] = { x: e.clientX, y: e.clientY };
      base = null;
      /* LA PINZATA SI FONDA QUANDO IL SECONDO DITO SI APPOGGIA, non al primo
         movimento, e la differenza si vede. Le dita arrivano una alla volta
         anche quando si posano insieme: aspettando il primo movimento, il
         punto medio da cui si misura tutto e' quello di un dito gia' partito
         e di uno ancora fermo -- mezzo passo fuori posto. Poi si ingrandisce
         di tre o quattro volte, e quel mezzo passo diventa i dieci pixel di
         cui il disegno «scappa» mentre lo si guarda. Qui le due posizioni
         sono esatte. */
      if (quante(r.giu) === 2) fonda();
    }, true);

    el.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in r.giu)) return;
      r.giu[e.pointerId] = { x: e.clientX, y: e.clientY };

      var ids = Object.keys(r.giu);
      if (ids.length !== 2) return;

      var a = r.giu[ids[0]], b = r.giu[ids[1]];
      var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
      var m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!d) return;

      if (!base) { fonda(); return; }

      /* Dita che si allargano = finestra che si stringe: il fattore e' il
         rapporto fra la distanza di PARTENZA e quella di adesso. */
      var f = base.d / d;
      var min = c.minimo ? c.minimo() : 0;
      var max = c.massimo ? c.massimo() : Infinity;
      if (base.v.w * f < min) f = min / base.v.w;
      if (base.v.w * f > max) f = max / base.v.w;

      c.scrivi({
        x0: base.ancora.x - (base.ancora.x - base.v.x0) * f -
            (m.x - base.m.x) * base.kx * f,
        y0: base.ancora.y - (base.ancora.y - base.v.y0) * f -
            (m.y - base.m.y) * base.ky * f,
        w: base.v.w * f,
        h: base.v.h * f
      });
    }, true);

    ['pointerup', 'pointercancel'].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        delete r.giu[e.pointerId];
        if (quante(r.giu) < 2) base = null;
      }, true);
    });
  }

  return { pizzica: pizzica, dita: dita };
})();
