/* L'editor: la tela su cui si modificano e si creano i tracciati.
 *
 * Lavora sulle FORME del livello scelto — nodi e maniglie, non polilinee —
 * nelle coordinate del file. Le polilinee si rifanno a ogni modifica
 * (Artwork.rigenera), e il disegno sul foglio resta dov'è: spostare un nodo
 * sposta quel nodo, non ridimensiona tutto il resto.
 *
 * LA Y VA IN GIÙ, come in un file SVG e come la mostra un browser. Sul piano
 * della macchina va in su, perché lì è la macchina a comandare, e il
 * ribaltamento lo fa toRect una volta sola. Mostrarla in su anche qui
 * vorrebbe dire far vedere il disegno capovolto rispetto al file che si sta
 * modificando.
 *
 * Non c'è un formato e non ci sono dimensioni: la tela è lo spazio del
 * disegno, e quanto diventa grande lo si decide dopo, con le maniglie sul
 * foglio.
 */
var Editor = (function () {

  var svg, tela, aiuto, piede, titolo;
  var strumento = 'scegli';

  /* Che cosa è selezionato. `forme` è l'elenco degli indici scelti, `forma`
     è il PRINCIPALE fra quelli — quello di cui si vedono nodi e maniglie —;
     `sub` e `nodo` scendono dentro, e valgono -1 quando la selezione si
     ferma più in alto.
     Due campi invece di uno perché le due domande sono diverse: «su che cosa
     agisce Canc» vale per tutto il gruppo, «di chi si disegnano i nodi» vale
     per uno solo. Con un gruppo i nodi non si mostrano affatto: venti
     tracciati di quadratini sono un tappeto in cui il disegno sparisce. */
  /* `segmenti` sono i TRATTI scelti: {forma, sub, k}, cioè il pezzo fra il
     nodo k e il successivo. Ci si arriva in due modi, e sono due gesti
     diversi apposta:

       clic su una forma GIA' SCELTA   →  quel tratto, e solo quello
       CTRL+clic su un tratto          →  lo aggiunge o lo toglie dal mucchio

     Il secondo è quello che serve per ripulire un disegno: si prendono dieci
     linee nascoste e si preme Canc una volta sola. Prima il clic prendeva la
     polilinea intera, e per levare uno spigolo bisognava infilargli dei nodi
     col doppio clic e cancellarli uno a uno.

     SHIFT resta sulle FORME e CTRL sui TRATTI: due tasti, due gradini, e
     nessuno dei due che indovina quale volevi. */
  var sel = { forma: -1, forme: [], sub: -1, nodo: -1, maniglia: null, segmenti: [] };

  var presa = null;        // trascinamento in corso
  var banda = null;        // il rettangolo di selezione, mentre lo si tira

  /* IL DOPPIO CLIC CE LO CONTIAMO NOI, invece di aspettare l'evento del
     browser. Il browser emette `dblclick` solo se i due clic hanno lo stesso
     bersaglio, e qui la tela si ridisegna a ogni selezione: fra il primo clic
     e il secondo il quadratino sotto al dito è già un altro elemento, e
     l'evento non arrivava mai. Trovato dal collaudo, che misurava il
     risultato invece di guardare il codice. */
  var ultimoGiu = { t: 0, x: 0, y: 0 };
  var forseDoppio = false;
  var DOPPIO_MS = 350, DOPPIO_PX = 6;
  var costruendo = null;   // forma che si sta disegnando
  var vista = null;        // {x0, y0, w, h} nelle coordinate del disegno

  var TOL = 0.05;

  /* I MAGNETI. Accesi, perché a mano libera una linea «quasi orizzontale»
     resta quasi orizzontale per sempre, e a stampa finita si vede.
     Alt li spegne finché resta premuto, Shift forza l'angolo anche quando
     sarebbe lontano: tenere la scorciatoia opposta a portata di dito è
     quello che li rende usabili invece che invadenti. */
  var magneti = true;
  var guide = [];

  var SOGLIA_ANG = 6 * Math.PI / 180;   // quanto «quasi» vale come «esatto»
  var PASSO_ANG = Math.PI / 4;          // orizzontale, verticale, le due diagonali

  /* LA GRIGLIA, in millimetri del foglio e non in unità del file: «da cinque»
     vuol dire qualcosa, «da 0,37 unità» no. Zero vuol dire spenta.
     A differenza degli altri magneti non ha una tolleranza: accesa, il punto
     va SEMPRE sull'incrocio più vicino. Una griglia che aggancia solo quando
     le passi vicino lascia i punti in mezzo, cioè non è una griglia — è un
     terzo tipo di aiuto che nessuno ha chiesto. */
  var griglia = 0;

  /* L'ANNULLA. Una pila di istantanee del livello, non un elenco di comandi
     da rifare al contrario: le operazioni qui sono poche e i disegni piccoli,
     e una fotografia non può sbagliare a tornare indietro mentre un comando
     inverso sì. */
  var storia = [], rifare = [];
  var MAX_STORIA = 50;

  /* Una pila per livello, non una sola: passando da un livello all'altro un
     passo indietro deve riportare indietro QUEL disegno, non quello di
     prima. `attivo` è l'id di quello che si sta modificando. */
  var storie = {}, rifari = {}, attivo = null;

  /* --------------------------- il livello --------------------------- */

  function forme() {
    return (window.Artwork && Artwork.forme) ? Artwork.forme() : null;
  }

  function cambiato() {
    Artwork.rigenera();
    disegna();
    scriviPiede();
  }

  /* Si fotografa PRIMA di toccare, e una volta sola per gesto: un
     trascinamento è un passo solo, non cinquanta. */
  function segna() {
    /* La prima modifica di una sessione mette da parte com'era il livello
       prima: è quella fotografia che l'etichetta «edit» sulla riga rimette
       in mostra. Artwork la prende una volta sola, quindi chiamarla a ogni
       gesto non costa e non sposta il «prima». */
    if (Artwork.segnaOrigine) Artwork.segnaOrigine();
    var s = Artwork.istantanea();
    if (!s) return;
    storia.push(s);
    if (storia.length > MAX_STORIA) storia.shift();
    rifare = [];
    aggiornaStorici();
  }

  function annulla() {
    if (!storia.length) return;
    var ora = Artwork.istantanea();
    Artwork.ripristina(storia.pop());
    if (ora) rifare.push(ora);
    nessunaForma();
    aggiornaStorici();
    disegna();
    scriviPiede();
  }

  function rifai() {
    if (!rifare.length) return;
    var ora = Artwork.istantanea();
    Artwork.ripristina(rifare.pop());
    if (ora) storia.push(ora);
    nessunaForma();
    aggiornaStorici();
    disegna();
    scriviPiede();
  }

  function nessunaForma() {
    sel = { forma: -1, forme: [], sub: -1, nodo: -1, maniglia: null, segmenti: [] };
    banda = null;
  }

  function aggiornaStorici() {
    var a = document.getElementById('ed-annulla');
    var r = document.getElementById('ed-rifai');
    if (a) a.disabled = !storia.length;
    if (r) r.disabled = !rifare.length;
  }

  /* ----------------------------- la vista ----------------------------- */

  function ingombro() {
    var f = forme();
    var b = f && f.length ? Tracciato.bbox(f, TOL) : null;
    if (!b || !isFinite(b.w) || b.w <= 0 || b.h <= 0) {
      /* Tela vuota: uno spazio di comodo, grande quanto un foglio piccolo.
         Non è un formato — serve solo a dare alla rotella qualcosa da
         ingrandire finché il primo tratto non esiste. */
      return { x0: 0, y0: 0, x1: 200, y1: 200, w: 200, h: 200 };
    }
    return b;
  }

  function adatta() {
    var b = ingombro();
    var m = Math.max(b.w, b.h) * 0.08 + 1;
    vista = { x0: b.x0 - m, y0: b.y0 - m, w: b.w + 2 * m, h: b.h + 2 * m };
    applica();
  }

  function applica() {
    if (!vista) adatta();
    svg.setAttribute('viewBox', vista.x0 + ' ' + vista.y0 + ' ' + vista.w + ' ' + vista.h);
    disegna();
  }

  /* Quanto vale un pixel in unità del disegno: maniglie e nodi si disegnano
     in unità, ma devono restare della stessa taglia sullo schermo. */
  function perPixel() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !vista) return 0.1;
    return Math.max(vista.w / r.width, vista.h / r.height);
  }

  /* IL PASSO DELLA GRIGLIA IN UNITA' DEL FILE. Il numero che si scrive nella
     barra è in millimetri del foglio; qui si divide per quanti millimetri
     vale un'unità, che è il rapporto con cui il livello è stato adattato al
     suo rettangolo. Su una tela ancora vuota quel rapporto non esiste e
     un'unità vale un millimetro: è l'ipotesi meno sorprendente, e appena
     c'è un tratto il foglio dice la sua. */
  function passoGriglia() {
    if (!(griglia > 0)) return null;
    var k = (window.Artwork && Artwork.scalaMm) ? Artwork.scalaMm() : null;
    var kx = (k && k.x > 0) ? k.x : 1, ky = (k && k.y > 0) ? k.y : 1;
    return { x: griglia / kx, y: griglia / ky };
  }

  function punto(e) {
    var p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  /* ----------------------------- disegno ----------------------------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function via(poly) {
    return poly.map(function (q) { return q.x.toFixed(3) + ',' + q.y.toFixed(3); }).join(' ');
  }

  function disegna() {
    if (!svg) return;
    var f = forme() || [];
    var u = perPixel();
    var out = reticolo(u);

    /* GLI ALTRI LIVELLI SCELTI, dietro e smorzati. Non si possono toccare:
       l'editor modifica un livello per volta, e un tratto che si vede ma non
       si prende è meno fastidioso di uno che si prende per sbaglio e
       finisce in un livello che non era quello. Servono a vedere il disegno
       INTERO mentre se ne corregge un pezzo — che è esattamente quello che
       serve togliendo le linee nascoste di un isometrico. */
    if (window.Artwork && Artwork.sfondoPer && Artwork.sceltoId) {
      Artwork.sfondoPer(Artwork.sceltoId()).forEach(function (q) {
        out += '<polyline class="ed-altro" points="' + via(q) + '"></polyline>';
      });
    }

    /* I tratti, tutti dello stesso colore: qui non si guarda il risultato, si
       guarda la struttura, e colori diversi direbbero cose che non ci sono. */
    for (var i = 0; i < f.length; i++) {
      var polys = Tracciato.appiattisci(f[i], TOL * u * 10);
      var cls = sel.forme.indexOf(i) >= 0 ? 'ed-tratto ed-scelto' : 'ed-tratto';
      for (var j = 0; j < polys.length; j++) {
        out += '<polyline class="' + cls + '" points="' + via(polys[j]) + '"></polyline>';
      }
    }

    if (costruendo) {
      Tracciato.appiattisci(costruendo, TOL * u * 10).forEach(function (p) {
        out += '<polyline class="ed-tratto ed-nuovo" points="' + via(p) + '"></polyline>';
      });
    }

    /* I nodi e le maniglie della forma scelta. Si mostrano solo di quella:
       tutti insieme sarebbero un tappeto di quadratini in cui non si trova
       più il disegno. */
    /* I nodi si mostrano di una forma sola, e non mentre si stanno
       scegliendo dei tratti: lì i quadratini coprirebbero proprio i pezzi
       che si sta cercando di vedere. */
    var s = (sel.forme.length === 1 && !sel.segmenti.length) ? f[sel.forma] : null;
    if (s && s.tipo === 'tracciato') {
      var lato = 7 * u, raggio = 4 * u;
      s.sub.forEach(function (sub, si) {
        sub.nodi.forEach(function (n, ni) {
          var scelto = si === sel.sub && ni === sel.nodo;
          ['hi', 'ho'].forEach(function (quale) {
            if (!n[quale]) return;
            out += '<line class="ed-asta" x1="' + n.x + '" y1="' + n.y +
                   '" x2="' + n[quale].x + '" y2="' + n[quale].y + '"></line>' +
                   '<circle class="ed-maniglia" data-f="' + sel.forma + '" data-s="' + si +
                   '" data-n="' + ni + '" data-m="' + quale + '" cx="' + n[quale].x +
                   '" cy="' + n[quale].y + '" r="' + raggio + '"></circle>';
          });
          out += '<rect class="ed-nodo' + (scelto ? ' ed-nodo-scelto' : '') +
                 '" data-f="' + sel.forma + '" data-s="' + si + '" data-n="' + ni +
                 '" x="' + (n.x - lato / 2) + '" y="' + (n.y - lato / 2) +
                 '" width="' + lato + '" height="' + lato + '"></rect>';
        });
      });
    }

    /* I tratti scelti, sopra ai loro tracciati: si vede che cosa toglierebbe
       Canc, che è l'unica domanda che conta quando si ripulisce un disegno. */
    sel.segmenti.forEach(function (t) {
      var fm = f[t.forma];
      if (!fm || fm.tipo !== 'tracciato') return;
      var sg = fm.sub[t.sub];
      if (!sg) return;
      var nn = sg.nodi, a0 = nn[t.k], b0 = nn[(t.k + 1) % nn.length];
      if (!a0 || !b0) return;
      var cc = cubicaDi(a0, b0), pz = [];
      for (var zz = 0; zz <= 24; zz++) pz.push(valuta(cc, zz / 24));
      out += '<polyline class="ed-seg" points="' + via(pz) + '"></polyline>';
    });

    /* Le guide per ultime, sopra a tutto: servono mentre si guarda il
       puntatore, e sotto al disegno non si vedrebbero. */
    guide.forEach(function (g) {
      if (g.tipo === 'nodo') {
        out += '<circle class="ed-guida-nodo" cx="' + g.x + '" cy="' + g.y +
               '" r="' + (6 * u) + '"></circle>';
      } else if (g.tipo === 'raggio') {
        var L = (vista ? Math.max(vista.w, vista.h) : 100) * 2;
        out += '<line class="ed-guida" x1="' + (g.x - Math.cos(g.a) * L) +
               '" y1="' + (g.y - Math.sin(g.a) * L) +
               '" x2="' + (g.x + Math.cos(g.a) * L) +
               '" y2="' + (g.y + Math.sin(g.a) * L) + '"></line>';
      } else if (g.tipo === 'vert') {
        out += '<line class="ed-guida" x1="' + g.x + '" y1="' + vista.y0 +
               '" x2="' + g.x + '" y2="' + (vista.y0 + vista.h) + '"></line>' +
               '<circle class="ed-guida-nodo" cx="' + g.x + '" cy="' + g.y +
               '" r="' + (4 * u) + '"></circle>';
      } else if (g.tipo === 'oriz') {
        out += '<line class="ed-guida" x1="' + vista.x0 + '" y1="' + g.y +
               '" x2="' + (vista.x0 + vista.w) + '" y2="' + g.y + '"></line>' +
               '<circle class="ed-guida-nodo" cx="' + g.x + '" cy="' + g.y +
               '" r="' + (4 * u) + '"></circle>';
      } else if (g.tipo === 'incrocio') {
        var c = 5 * u;
        out += '<line class="ed-guida" x1="' + (g.x - c) + '" y1="' + g.y +
               '" x2="' + (g.x + c) + '" y2="' + g.y + '"></line>' +
               '<line class="ed-guida" x1="' + g.x + '" y1="' + (g.y - c) +
               '" x2="' + g.x + '" y2="' + (g.y + c) + '"></line>';
      }
    });

    if (banda) {
      out += '<rect class="ed-banda" x="' + banda.x0 + '" y="' + banda.y0 +
             '" width="' + (banda.x1 - banda.x0) +
             '" height="' + (banda.y1 - banda.y0) + '"></rect>';
    }

    svg.innerHTML = out;
  }

  /* IL RETICOLO. Si disegna solo se le maglie si distinguono: sotto i sette
     pixel di passo non si vede una griglia, si vede un fondo grigio, e per
     ottenerlo si pagherebbero migliaia di righe di SVG a ogni movimento del
     mouse. L'AGGANCIO RESTA ACCESO lo stesso: le due cose sono separate, e
     una griglia fitta serve proprio quando non la si vuole guardare.
     Il tetto sul numero di righe è la stessa difesa dall'altra parte, per lo
     schermo grande dove sette pixel di passo sono ancora tante righe. */
  function reticolo(u) {
    var g = passoGriglia();
    if (!g || !vista) return '';
    if (g.x / u < 7 || g.y / u < 7) return '';
    var nx = Math.ceil(vista.w / g.x), ny = Math.ceil(vista.h / g.y);
    if (nx + ny > 1200) return '';

    var out = '<g class="ed-reticolo">', i, v;
    for (i = 0, v = Math.floor(vista.x0 / g.x) * g.x; i <= nx + 1; i++, v += g.x) {
      out += '<line x1="' + v + '" y1="' + vista.y0 + '" x2="' + v +
             '" y2="' + (vista.y0 + vista.h) + '"></line>';
    }
    for (i = 0, v = Math.floor(vista.y0 / g.y) * g.y; i <= ny + 1; i++, v += g.y) {
      out += '<line x1="' + vista.x0 + '" y1="' + v + '" x2="' +
             (vista.x0 + vista.w) + '" y2="' + v + '"></line>';
    }
    return out + '</g>';
  }

  /* ------------------------- che cosa c'è sotto ------------------------- */

  /* Il tratto più vicino al punto, se sta entro qualche pixel. Si cerca sulle
     polilinee e non sulle curve: la distanza da una cubica non ha una
     formula chiusa, e la polilinea è già l'approssimazione che guardiamo. */
  function sotto(p, u) {
    var f = forme() || [];
    var limite = 6 * u, meglio = null;

    for (var i = 0; i < f.length; i++) {
      if (f[i].tipo === 'testo') {
        var b = Tracciato.bbox([f[i]], TOL);
        if (p.x >= b.x0 - limite && p.x <= b.x1 + limite &&
            p.y >= b.y0 - limite && p.y <= b.y1 + limite) {
          return { forma: i, d: 0, sub: -1, t: 0 };
        }
        continue;
      }
      for (var si = 0; si < f[i].sub.length; si++) {
        var poly = Tracciato.appiattisciSub(f[i].sub[si], TOL);
        for (var k = 1; k < poly.length; k++) {
          var d = segmento(p, poly[k - 1], poly[k]);
          if (d.d < limite && (!meglio || d.d < meglio.d)) {
            meglio = { forma: i, sub: si, d: d.d, punto: d.punto, k: k, t: d.t };
          }
        }
      }
    }
    return meglio;
  }

  /* Il nodo o la maniglia sotto al puntatore, cercati per POSIZIONE e non
     chiedendo al bersaglio del clic chi è. Il bersaglio sarebbe più comodo,
     ma la tela si ridisegna a ogni selezione: fra il primo e il secondo clic
     di un doppio clic il quadratino sotto il dito è già un altro elemento, e
     il doppio clic cadeva nel vuoto. Trovato dal collaudo. */
  function nodoSotto(p, u) {
    var f = forme();
    var s = f && f[sel.forma];
    if (!s || s.tipo !== 'tracciato') return null;

    var lim = 6 * u, meglio = null;
    s.sub.forEach(function (sub, si) {
      sub.nodi.forEach(function (n, ni) {
        ['hi', 'ho'].forEach(function (q) {
          if (!n[q]) return;
          var dm = Math.hypot(p.x - n[q].x, p.y - n[q].y);
          if (dm < lim && (!meglio || dm < meglio.d)) {
            meglio = { sub: si, nodo: ni, maniglia: q, d: dm };
          }
        });
        /* A parità, vince il NODO sulla maniglia: è quello che si vuole
           prendere quasi sempre, e la maniglia si raggiunge spostandosi. */
        var d = Math.hypot(p.x - n.x, p.y - n.y);
        if (d < lim && (!meglio || d <= meglio.d)) {
          meglio = { sub: si, nodo: ni, maniglia: null, d: d };
        }
      });
    });
    return meglio;
  }

  /* ------------------------------ i magneti ------------------------------ */

  /* Tutti i nodi del disegno, meno quello che si sta spostando: agganciarsi a
     se stessi vorrebbe dire non muoversi mai. */
  function nodiTutti(escludi) {
    var f = forme() || [], out = [];
    f.forEach(function (forma, fi) {
      if (forma.tipo !== 'tracciato') return;
      forma.sub.forEach(function (sub, si) {
        sub.nodi.forEach(function (n, ni) {
          if (escludi && escludi.forma === fi && escludi.sub === si && escludi.nodo === ni) return;
          out.push(n);
        });
      });
    });
    return out;
  }

  /* IL PUNTO CORRETTO, e le guide che spiegano perché.
   *
   * Tre aiuti, in quest'ordine di forza:
   *   1. un NODO vicino: ci si va sopra esatto, perché due punti che devono
   *      coincidere o coincidono o no, e «quasi» non serve a niente;
   *   2. l'ANGOLO rispetto al punto da cui si sta tirando: entro sei gradi da
   *      un multiplo di 45 si raddrizza. È il caso che chiedeva l'operatore —
   *      una linea quasi orizzontale resta storta per sempre, e sul foglio si
   *      vede;
   *   3. l'ALLINEAMENTO a un altro nodo, in x o in y, che è il modo per
   *      mettere due cose sulla stessa retta senza misurare.
   *
   * L'angolo e l'allineamento non si sommano: l'angolo fissa già il punto
   * lungo una retta, e stringerlo anche sull'altro asse lo porterebbe dove
   * nessuno dei due aiuti lo voleva. Chi vince lo dice la guida che compare.
   */
  function aggancia(p, ancora, e, escludi) {
    guide = [];
    /* Alt spegne TUTTO, griglia compresa: una via d'uscita che lascia acceso
       qualcosa non è una via d'uscita. */
    if (e && e.altKey) return p;

    var u = perPixel();
    var tolN = 9 * u, tolA = 7 * u;
    var ns = magneti ? nodiTutti(escludi) : [];
    var i, d;

    var vicino = null;
    for (i = 0; i < ns.length; i++) {
      d = Math.hypot(p.x - ns[i].x, p.y - ns[i].y);
      if (d < tolN && (!vicino || d < vicino.d)) vicino = { n: ns[i], d: d };
    }
    if (vicino) {
      guide.push({ tipo: 'nodo', x: vicino.n.x, y: vicino.n.y });
      return { x: vicino.n.x, y: vicino.n.y };
    }

    /* LA GRIGLIA viene subito dopo i nodi e prima di tutto il resto, e quando
       c'è decide da sola. Non si somma all'angolo né all'allineamento: su una
       griglia l'orizzontale, la verticale e i quarantacinque gradi vengono da
       sé, perché li fanno due incroci, e stringere anche l'angolo porterebbe
       il punto fuori dalla griglia — cioè toglierebbe l'unica cosa che una
       griglia promette. Resta l'eccezione di Shift, che l'angolo lo forza: chi
       lo tiene premuto sta chiedendo quello, e lo ottiene fuori griglia.

       E' un interruttore SUO, non uno dei magneti: si accende e si spegne
       separatamente, e con i magneti spenti continua a valere. Sono due aiuti
       di natura diversa — i magneti guardano il disegno che c'è, la griglia
       non guarda niente — e volerli insieme o nessuno dei due è una
       limitazione senza una ragione. */
    var mag = passoGriglia();
    if (mag && !(e && e.shiftKey)) {
      var inc = { x: Math.round(p.x / mag.x) * mag.x,
                  y: Math.round(p.y / mag.y) * mag.y };
      guide.push({ tipo: 'incrocio', x: inc.x, y: inc.y });
      return inc;
    }

    if (!magneti) return p;

    var q = { x: p.x, y: p.y };

    if (ancora) {
      var dx = q.x - ancora.x, dy = q.y - ancora.y;
      var L = Math.hypot(dx, dy);
      if (L > tolA) {
        var a = Math.atan2(dy, dx);
        var dritto = Math.round(a / PASSO_ANG) * PASSO_ANG;
        var scarto = Math.abs(Math.atan2(Math.sin(a - dritto), Math.cos(a - dritto)));
        if ((e && e.shiftKey) || scarto < SOGLIA_ANG) {
          /* Proiezione sulla retta, non rotazione: il punto scivola sul
             raggio invece di saltarci sopra, e il gesto resta quello che si
             stava facendo. */
          var proj = dx * Math.cos(dritto) + dy * Math.sin(dritto);
          q = { x: ancora.x + proj * Math.cos(dritto), y: ancora.y + proj * Math.sin(dritto) };
          guide.push({ tipo: 'raggio', x: ancora.x, y: ancora.y, a: dritto });
          return q;
        }
      }
    }

    var ax = null, ay = null;
    for (i = 0; i < ns.length; i++) {
      d = Math.abs(ns[i].x - q.x);
      if (d < tolA && (!ax || d < ax.d)) ax = { n: ns[i], d: d };
      d = Math.abs(ns[i].y - q.y);
      if (d < tolA && (!ay || d < ay.d)) ay = { n: ns[i], d: d };
    }
    if (ax) { q.x = ax.n.x; guide.push({ tipo: 'vert', x: ax.n.x, y: ax.n.y }); }
    if (ay) { q.y = ay.n.y; guide.push({ tipo: 'oriz', x: ay.n.x, y: ay.n.y }); }
    return q;
  }

  function segmento(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    var q = { x: a.x + t * dx, y: a.y + t * dy };
    return { d: Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)),
             punto: q, t: t };
  }

  /* --------------------------- gli strumenti --------------------------- */

  function scegliStrumento(s) {
    strumento = s;
    chiudiCostruzione(true);
    Array.prototype.forEach.call(document.querySelectorAll('[data-str]'), function (b) {
      b.classList.toggle('attivo', b.dataset.str === s);
    });
    document.getElementById('ed-testo-campi').hidden = s !== 'testo';
    scriviAiuto();
  }

  var AIUTO = {
    scegli: 'Clicca una forma per sceglierla; cliccala UNA SECONDA VOLTA e ' +
            'scendi al singolo tratto. <b>Ctrl+clic prende i tratti</b> e li ' +
            'somma — dieci linee e un Canc solo —, <b>Shift+clic</b> fa lo ' +
            'stesso con le forme intere; trascinando nel vuoto si prende ' +
            'quello che il rettangolo tocca. Trascina i nodi e le maniglie. ' +
            'Doppio clic su un nodo: da spigolo a curva e viceversa; su un ' +
            'tratto: aggiunge un nodo lì. Canc toglie quello che è scelto.',
    togli:  'Clicca un tratto: sparisce quello e basta. Un tracciato chiuso ' +
            'si apre li, uno aperto si spezza in due.',
    curva:  'Trascina un tratto per incurvarlo. Se era dritto diventa una curva ' +
            'senza spostarsi di un capello, e segue il dito da lì in poi.',
    spezzata: 'Clicca per mettere i punti. Doppio clic o Invio per finire, ' +
              'Esc per annullare.',
    rettangolo: 'Trascina da un angolo all\'altro.',
    cerchio: 'Trascina dal centro verso il bordo.',
    testo: 'Scrivi qui sopra, poi clicca sulla tela dove vuoi la riga.',
    taglia: 'Clicca su un tratto: si spezza in due lì, e i due pezzi restano ' +
            'separati come se la penna si fosse alzata.'
  };

  function scriviAiuto() {
    if (!aiuto) return;
    var coda = magneti
      ? '  ·  Magneti accesi: Alt per spegnerli un momento, Shift per forzare ' +
        'l\'angolo.'
      : '  ·  Magneti spenti.';
    if (griglia > 0) {
      coda += '  ·  Griglia da ' + String(griglia).replace('.', ',') +
              ' mm: i punti ci vanno sopra, Shift o Alt la scavalcano.';
    }
    aiuto.innerHTML = (AIUTO[strumento] || '') + esc(coda);
  }

  function scriviPiede() {
    if (!piede) return;
    var f = forme();
    if (!f) { piede.textContent = ''; return; }
    var c = Tracciato.conta(f);
    piede.textContent = c.forme + ' forme · ' + c.nodi + ' nodi · ' +
                        c.curve + ' con una curva' +
                        (c.testi ? ' · ' + c.testi + ' testi' : '') +
                        (sel.forme.length > 1 ? '  —  ' + sel.forme.length + ' scelte' : '');
  }

  function chiudiCostruzione(annulla) {
    if (!costruendo) return;
    if (!annulla && costruendo.sub && costruendo.sub[0].nodi.length > 1) {
      segna();
      forme().push(costruendo);
      costruendo = null;
      cambiato();
      return;
    }
    costruendo = null;
    disegna();
  }

  /* ------------------------------ eventi ------------------------------ */

  function giu(e) {
    var f = forme();
    if (!f) return;
    var p = punto(e), u = perPixel();

    if (e.button === 0) {
      var ora = Date.now();
      /* Il doppio clic si DECIDE AL RILASCIO, non alla pressione. Deciderlo
         subito farebbe sparire il trascinamento: premere su un nodo appena
         scelto e tirarlo è un gesto normale, e assomiglia come due gocce
         d'acqua all'inizio di un doppio clic. Chi si muove sta trascinando. */
      /* Con SHIFT o CTRL premuto non si conta: due clic di fila sullo stesso
         tratto sono «aggiungi» e «togli», non un doppio clic, e passavano
         invece per un doppio clic che infilava un nodo e azzerava la
         scelta. Trovato dal collaudo, prima su Shift e poi di nuovo, tale e
         quale, su Ctrl: la stessa trappola due volte. */
      forseDoppio = !e.shiftKey && !e.ctrlKey && !e.metaKey &&
                    ora - ultimoGiu.t < DOPPIO_MS &&
                    Math.abs(e.clientX - ultimoGiu.x) < DOPPIO_PX &&
                    Math.abs(e.clientY - ultimoGiu.y) < DOPPIO_PX;
      ultimoGiu = { t: ora, x: e.clientX, y: e.clientY };
    }

    /* Il tasto centrale sposta sempre lo sguardo, qualunque strumento sia
       attivo: è la via d'uscita quando il disegno riempie la tela. */
    if (e.button === 1) {
      presa = { tipo: 'sguardo', x: e.clientX, y: e.clientY, v: vista };
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (strumento === 'scegli') return giuScegli(e, p, u);
    if (strumento === 'curva') return giuCurva(e, p, u);
    if (strumento === 'togli') return togliTratto(p, u);
    if (strumento === 'taglia') return taglia(p, u);
    if (strumento === 'spezzata') return giuSpezzata(p, e);
    if (strumento === 'testo') return metteTesto(p);
    if (strumento === 'rettangolo' || strumento === 'cerchio') {
      presa = { tipo: strumento, inizio: p };
      svg.setPointerCapture(e.pointerId);
    }
  }

  function giuScegli(e, p, u) {
    var h = nodoSotto(p, u);
    if (h) {
      sel.sub = h.sub; sel.nodo = h.nodo; sel.maniglia = h.maniglia;
      var n = forme()[sel.forma].sub[sel.sub].nodi[sel.nodo];
      var rif = h.maniglia ? n[h.maniglia] : n;
      /* Lo scostamento fra il punto afferrato e il puntatore si tiene da
         parte: così il nodo segue il dito senza saltarci sotto, e i magneti
         ragionano su dove finirebbe il NODO, non su dov'è il mouse. */
      presa = { tipo: h.maniglia ? 'maniglia' : 'nodo', da: p,
                dx: rif.x - p.x, dy: rif.y - p.y };
      segna();
      svg.setPointerCapture(e.pointerId);
      disegna();
      return;
    }

    /* CTRL (o Cmd) PRENDE I TRATTI, e li accumula. È il gradino fine, e
       serve prima di tutto a ripulire: dieci linee nascoste, un Canc. */
    if (e.ctrlKey || e.metaKey) {
      var tr = trattoSotto(p, u);
      if (!tr) { nessunaForma(); disegna(); return; }
      commutaSegmento(tr.forma, tr.sub, tr.k);
      disegna();
      return;
    }

    var t = sotto(p, u);
    if (!t) {
      /* Il vuoto comincia un rettangolo di selezione. Non si deseleziona
         subito: un clic nel vuoto che azzera e un trascinamento che sceglie
         cominciano con lo stesso gesto, e quale dei due fosse lo si sa solo
         al rilascio. */
      presa = { tipo: 'banda', inizio: p };
      banda = null;
      svg.setPointerCapture(e.pointerId);
      return;
    }

    /* Shift aggiunge e toglie. Togliendo quella che era la principale il
       comando passa alla prima rimasta: «principale» vuol dire soltanto
       «quella di cui si vedono i nodi», e finché c'è una selezione deve
       esserci. */
    if (e.shiftKey) {
      var k = sel.forme.indexOf(t.forma);
      if (k >= 0) {
        sel.forme.splice(k, 1);
        sel.forma = sel.forme.length ? sel.forme[0] : -1;
      } else {
        sel.forme.push(t.forma);
        sel.forma = t.forma;
      }
      sel.sub = -1; sel.nodo = -1; sel.maniglia = null; sel.segmenti = [];
      disegna();
      return;
    }

    /* Prendendo una forma CHE E' GIA' NEL GRUPPO si trascina tutto il gruppo.
       È il gesto con cui si sposta quello che si è appena scelto, e
       ricominciare da capo a ogni pressione renderebbe la selezione multipla
       una cosa che si può fare ma non serve a niente. */
    /* Era già scelta e sola? Allora il clic scende di un gradino, al TRATTO.
       Si decide al rilascio, in su(): qui si registra soltanto da dove si
       parte, perché premere su una forma scelta e tirarla è un gesto
       normale e assomiglia all'inizio di questo. */
    var giaSola = sel.forme.length === 1 && sel.forme[0] === t.forma;
    if (sel.forme.indexOf(t.forma) < 0) { sel.forme = [t.forma]; sel.segmenti = []; }
    sel.forma = t.forma; sel.sub = -1; sel.nodo = -1; sel.maniglia = null;
    presa = { tipo: 'forma', da: p, giaSola: giaSola, p0: p };
    segna();
    svg.setPointerCapture(e.pointerId);
    disegna();
  }

  /* Un tratto dentro o fuori dal mucchio, e le forme che lo contengono
     restano segnate: servono a far vedere di che cosa fa parte quello che si
     è preso. */
  function commutaSegmento(fi, si, k) {
    var dove = -1;
    for (var i = 0; i < sel.segmenti.length; i++) {
      var t = sel.segmenti[i];
      if (t.forma === fi && t.sub === si && t.k === k) { dove = i; break; }
    }
    if (dove >= 0) sel.segmenti.splice(dove, 1);
    else sel.segmenti.push({ forma: fi, sub: si, k: k });

    sel.forme = [];
    sel.segmenti.forEach(function (t) {
      if (sel.forme.indexOf(t.forma) < 0) sel.forme.push(t.forma);
    });
    sel.forma = sel.forme.length ? sel.forme[sel.forme.length - 1] : -1;
    sel.sub = -1; sel.nodo = -1; sel.maniglia = null;
  }

  /* Chi finisce dentro al rettangolo. Basta che gli ingombri si tocchino:
     pretendere che la forma ci stia tutta vorrebbe dire inseguire col
     rettangolo i tratti che escono dallo schermo, ed è il contrario di quello
     che si aspetta chi arriva da un programma di disegno. */
  function scegliDentro(b) {
    var f = forme() || [], out = [];
    for (var i = 0; i < f.length; i++) {
      var g = Tracciato.bbox([f[i]], TOL);
      if (!isFinite(g.w) || !isFinite(g.h)) continue;
      if (g.x1 >= b.x0 && g.x0 <= b.x1 && g.y1 >= b.y0 && g.y0 <= b.y1) out.push(i);
    }
    sel.forme = out;
    sel.forma = out.length ? out[0] : -1;
    sel.sub = -1; sel.nodo = -1; sel.maniglia = null;
  }

  function muovi(e) {
    if (!presa) return;
    if (Math.abs(e.clientX - ultimoGiu.x) > 2 || Math.abs(e.clientY - ultimoGiu.y) > 2) {
      presa.mosso = true;
    }
    var p = punto(e);

    if (presa.tipo === 'sguardo') {
      var r = svg.getBoundingClientRect();
      vista = { x0: presa.v.x0 - (e.clientX - presa.x) * presa.v.w / r.width,
                y0: presa.v.y0 - (e.clientY - presa.y) * presa.v.h / r.height,
                w: presa.v.w, h: presa.v.h };
      applica();
      return;
    }

    /* Rettangolo e cerchio si ridisegnano dal punto di PARTENZA, non per
       differenze: la forma dipende da dove si è cominciato, non da quanto ci
       si è mossi dall'ultimo evento. */
    if (presa.tipo === 'rettangolo') {
      var w = Math.abs(p.x - presa.inizio.x), h = Math.abs(p.y - presa.inizio.y);
      /* Shift fa il quadrato, come dappertutto. */
      if (e.shiftKey) { w = h = Math.max(w, h); }
      costruendo = Tracciato.rettangolo(
        p.x < presa.inizio.x ? presa.inizio.x - w : presa.inizio.x,
        p.y < presa.inizio.y ? presa.inizio.y - h : presa.inizio.y, w, h);
      disegna();
      return;
    }
    if (presa.tipo === 'cerchio') {
      costruendo = Tracciato.cerchio(presa.inizio.x, presa.inizio.y,
        Math.hypot(p.x - presa.inizio.x, p.y - presa.inizio.y));
      disegna();
      return;
    }

    if (presa.tipo === 'banda') {
      banda = { x0: Math.min(presa.inizio.x, p.x), y0: Math.min(presa.inizio.y, p.y),
                x1: Math.max(presa.inizio.x, p.x), y1: Math.max(presa.inizio.y, p.y) };
      disegna();
      return;
    }

    if (presa.tipo === 'curva') { piega(p); return; }

    var f = forme();
    var dx = p.x - presa.da.x, dy = p.y - presa.da.y;
    presa.da = p;

    if (presa.tipo === 'nodo') {
      var sub = f[sel.forma].sub[sel.sub];
      var n = sub.nodi[sel.nodo];
      /* L'ancora dell'angolo è il nodo accanto: è con quello che si forma il
         tratto che si vuole dritto o a quarantacinque gradi. */
      var m = sub.nodi.length;
      var anc = m > 1 ? (sel.nodo > 0 ? sub.nodi[sel.nodo - 1] : sub.nodi[1]) : null;
      var t = aggancia({ x: p.x + presa.dx, y: p.y + presa.dy }, anc, e,
                       { forma: sel.forma, sub: sel.sub, nodo: sel.nodo });
      var ddx = t.x - n.x, ddy = t.y - n.y;
      /* Spostando il nodo si portano dietro le sue maniglie: sono attaccate
         a lui, e lasciarle ferme spezzerebbe la curva in due punti invece
         che muoverla. */
      n.x = t.x; n.y = t.y;
      if (n.hi) { n.hi.x += ddx; n.hi.y += ddy; }
      if (n.ho) { n.ho.x += ddx; n.ho.y += ddy; }
      cambiato();
      return;
    }

    if (presa.tipo === 'maniglia') {
      var q = f[sel.forma].sub[sel.sub].nodi[sel.nodo];
      /* Per una maniglia l'ancora è il suo nodo: l'aiuto che serve è tenerla
         dritta o a quarantacinque rispetto a lui. */
      var g = aggancia({ x: p.x + presa.dx, y: p.y + presa.dy }, q, e,
                       { forma: sel.forma, sub: sel.sub, nodo: sel.nodo });
      q[sel.maniglia].x = g.x;
      q[sel.maniglia].y = g.y;
      cambiato();
      return;
    }

    if (presa.tipo === 'forma') {
      var gruppo = sel.forme.length ? sel.forme : [sel.forma];
      for (var gi = 0; gi < gruppo.length; gi++) {
        if (f[gruppo[gi]]) sposta(f[gruppo[gi]], dx, dy);
      }
      cambiato();
      return;
    }

  }

  function sposta(forma, dx, dy) {
    if (forma.tipo === 'testo') { forma.x += dx; forma.y += dy; return; }
    forma.sub.forEach(function (s) {
      s.nodi.forEach(function (n) {
        n.x += dx; n.y += dy;
        if (n.hi) { n.hi.x += dx; n.hi.y += dy; }
        if (n.ho) { n.ho.x += dx; n.ho.y += dy; }
      });
    });
  }

  var presaGiaSola = false;

  function su(e) {
    var mosso = presa && presa.mosso;
    var tipo = presa ? presa.tipo : null;
    presaGiaSola = !!(presa && presa.giaSola);
    if (presa) {
      presa = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* già rilasciato */ }
    }

    if (forseDoppio && !mosso && e.button === 0) {
      forseDoppio = false;
      ultimoGiu.t = 0;          // tre clic non sono un doppio clic e mezzo
      doppio(e);
      return;
    }
    /* Clic secco su una forma già scelta: si entra nel suo tratto. Il doppio
       clic resta quello che era — aggiunge un nodo — perché è un gesto
       diverso e lo decide il ramo qui sopra, che viene prima. */
    if (tipo === 'forma' && !mosso && e.button === 0 && presaGiaSola) {
      var pp = punto(e), uu = perPixel();
      var tt = trattoSotto(pp, uu);
      sel.segmenti = (tt && tt.forma === sel.forma)
        ? [{ forma: tt.forma, sub: tt.sub, k: tt.k }] : [];
      presaGiaSola = false;
      guide = [];
      disegna();
      return;
    }
    presaGiaSola = false;

    forseDoppio = false;
    guide = [];

    if (tipo === 'banda') {
      /* Tirato: si sceglie quello che c'è dentro. Solo premuto e rilasciato:
         era un clic nel vuoto, e un clic nel vuoto azzera. */
      if (mosso && banda) scegliDentro(banda);
      else nessunaForma();
      banda = null;
      disegna();
      scriviPiede();
      return;
    }

    if (!tipo) { disegna(); return; }

    if ((tipo === 'rettangolo' || tipo === 'cerchio') && costruendo) {
      var b = Tracciato.bbox([costruendo], TOL);
      /* Un clic senza trascinamento non è una forma: sarebbe un rettangolo
         di lato zero, invisibile e impossibile da riprendere. */
      if (b.w > perPixel() * 3 || b.h > perPixel() * 3) {
        segna();
        forme().push(costruendo);
        costruendo = null;
        cambiato();
        return;
      }
      costruendo = null;
      disegna();
    }
  }

  /* ---------------------------- la spezzata ---------------------------- */

  function ancoraSpezzata() {
    if (!costruendo) return null;
    var n = costruendo.sub[0].nodi;
    return n.length >= 2 ? n[n.length - 2] : null;
  }

  function giuSpezzata(p, e) {
    var q = aggancia(p, ancoraSpezzata(), e);
    if (!costruendo) {
      costruendo = Tracciato.daPunti([q, q], false);
      return;
    }
    var n = costruendo.sub[0].nodi;
    n[n.length - 1] = Tracciato.nodo(q.x, q.y);
    n.push(Tracciato.nodo(q.x, q.y));
    disegna();
  }

  function seguiSpezzata(e) {
    if (strumento !== 'spezzata' || !costruendo) return;
    var q = aggancia(punto(e), ancoraSpezzata(), e);
    var n = costruendo.sub[0].nodi;
    n[n.length - 1] = Tracciato.nodo(q.x, q.y);
    disegna();
  }

  function finisciSpezzata() {
    if (!costruendo) return;
    var n = costruendo.sub[0].nodi;
    /* L'ultimo nodo segue il puntatore: non è un punto messo, è l'anteprima
       di dove finirebbe. Chiudendo va buttato. */
    n.pop();
    /* E il doppio clic che chiude ha messo un punto sopra al precedente:
       due nodi nello stesso posto sono un tratto di lunghezza zero, che il
       G-code emetterebbe e la macchina non eseguirebbe. */
    while (n.length > 1 &&
           Math.abs(n[n.length - 1].x - n[n.length - 2].x) < 1e-6 &&
           Math.abs(n[n.length - 1].y - n[n.length - 2].y) < 1e-6) {
      n.pop();
    }
    if (n.length > 1) { segna(); forme().push(costruendo); costruendo = null; cambiato(); }
    else { costruendo = null; disegna(); }
  }

  /* ------------------------------ la curva ------------------------------ */

  /* PIEGARE UN TRATTO SENZA PASSARE DAL NODO.
   *
   * Finora, per far curvare una linea, bisognava prendere il nodo a un capo,
   * trasformarlo in nodo curvo e poi tirarne la maniglia: tre gesti e due
   * oggetti di mezzo, per una cosa che si pensa come «prendo la linea e la
   * incurvo». Qui si prende la linea e la si incurva.
   *
   * UN SEGMENTO DRITTO E' GIA' UNA CUBICA: con le maniglie a un terzo e a due
   * terzi della corda la curva coincide con la retta, punto per punto — non è
   * un'approssimazione, è un'identità. Scriverle non cambia il disegno di un
   * capello, e da lì in poi il tratto si piega.
   */

  function cubicaDi(a, b) {
    return { p0: { x: a.x, y: a.y },
             p1: a.ho || { x: a.x, y: a.y },
             p2: b.hi || { x: b.x, y: b.y },
             p3: { x: b.x, y: b.y } };
  }

  function copiaCubica(c) {
    return { p0: { x: c.p0.x, y: c.p0.y }, p1: { x: c.p1.x, y: c.p1.y },
             p2: { x: c.p2.x, y: c.p2.y }, p3: { x: c.p3.x, y: c.p3.y } };
  }

  function valuta(c, t) {
    var v = 1 - t;
    var A = v * v * v, B = 3 * v * v * t, C = 3 * v * t * t, D = t * t * t;
    return { x: A * c.p0.x + B * c.p1.x + C * c.p2.x + D * c.p3.x,
             y: A * c.p0.y + B * c.p1.y + C * c.p2.y + D * c.p3.y };
  }

  /* IL TRATTO SOTTO AL PUNTATORE, cercato fra due nodi alla volta. Non si
     riusa `sotto()`: quella lavora sulla polilinea di un sotto-tracciato
     intero e restituisce l'indice di un segmento APPIATTITO, che su una curva
     non dice niente — una cubica sola può valerne trenta. Qui ogni tratto si
     campiona NEL PARAMETRO, così il `t` che esce è quello della cubica, cioè
     quello che serve per piegarla. */
  function trattoSotto(p, u) {
    var f = forme() || [], limite = 8 * u, meglio = null;
    for (var i = 0; i < f.length; i++) {
      if (f[i].tipo !== 'tracciato') continue;
      for (var si = 0; si < f[i].sub.length; si++) {
        var sub = f[i].sub[si], n = sub.nodi;
        var quanti = sub.chiuso ? n.length : n.length - 1;
        for (var k = 0; k < quanti; k++) {
          var c = cubicaDi(n[k], n[(k + 1) % n.length]);
          for (var j = 0; j <= 32; j++) {
            var t = j / 32, q = valuta(c, t);
            var d = Math.hypot(p.x - q.x, p.y - q.y);
            if (d < limite && (!meglio || d < meglio.d)) {
              meglio = { forma: i, sub: si, k: k, t: t, d: d };
            }
          }
        }
      }
    }
    return meglio;
  }

  function giuCurva(e, p, u) {
    var t = trattoSotto(p, u);
    if (!t) { Log.add('err', 'Lì sotto non c\'è nessun tratto da piegare.'); return; }

    var f = forme(), sub = f[t.forma].sub[t.sub], n = sub.nodi;
    var a = n[t.k], b = n[(t.k + 1) % n.length];
    segna();

    if (!a.ho) a.ho = { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    if (!b.hi) b.hi = { x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3 };

    /* Il punto di presa si tiene lontano dagli estremi: lì i due pesi vanno a
       zero insieme, e la maniglia da spostare per muovere il punto di un
       millimetro diventerebbe lunga quanto il foglio. */
    presa = {
      tipo: 'curva', forma: t.forma, sub: t.sub, k: t.k,
      t: Math.max(0.12, Math.min(0.88, t.t)),
      /* Si parte SEMPRE dalla cubica di prima del gesto, non da quella
         dell'evento precedente: piegare a partire da quello che si è appena
         piegato accumula, e dopo venti eventi il tratto è da un'altra parte.
         È la stessa regola del rettangolo sul foglio. */
      c0: copiaCubica(cubicaDi(a, b))
    };
    sel.forma = t.forma; sel.forme = [t.forma]; sel.sub = -1; sel.nodo = -1;
    svg.setPointerCapture(e.pointerId);
    disegna();
  }

  /* Le due maniglie che portano il punto dove lo si sta tirando. Due
     condizioni e quattro incognite lasciano infinite soluzioni: fra tutte si
     prende quella che sposta le maniglie IL MENO POSSIBILE. Senza un criterio
     schizzerebbero via ogni volta in modo diverso, e il tratto non seguirebbe
     il dito. */
  function piega(p) {
    var f = forme();
    var sub = f[presa.forma] && f[presa.forma].sub[presa.sub];
    if (!sub) return;
    var n = sub.nodi;
    var a = n[presa.k], b = n[(presa.k + 1) % n.length];
    if (!a || !b) return;

    var t = presa.t, v = 1 - t;
    var w1 = 3 * v * v * t, w2 = 3 * v * t * t;
    var den = w1 * w1 + w2 * w2;
    if (den < 1e-9) return;

    var q = valuta(presa.c0, t);
    var dx = p.x - q.x, dy = p.y - q.y;
    a.ho = { x: presa.c0.p1.x + dx * w1 / den, y: presa.c0.p1.y + dy * w1 / den };
    b.hi = { x: presa.c0.p2.x + dx * w2 / den, y: presa.c0.p2.y + dy * w2 / den };
    cambiato();
  }

  /* TOGLIERE UN TRATTO SOLO, quello sotto al puntatore.
   *
   * Canc toglie una forma intera, e una forma intera e' spesso un quadrilatero
   * o una faccia: per levare UNO spigolo bisognava sceglierne un nodo e
   * sperare che la forma avesse la struttura giusta. Un disegno isometrico si
   * ripulisce dalle linee nascoste un tratto alla volta, e quel gesto deve
   * essere un clic.
   *
   * Un tracciato chiuso a cui si toglie un lato non si spezza in due: si apre,
   * e comincia dove finiva il lato tolto. Uno aperto si spezza, e i due pezzi
   * restano separati come se la penna si fosse alzata — che e' esattamente
   * quello che succedera'.
   */
  function togliTratto(p, u) {
    var t = trattoSotto(p, u);
    if (!t) { Log.add('err', 'Li sotto non c\'e nessun tratto.'); return; }
    segna();
    levaTratto(t.forma, t.sub, t.k);
  }

  /* Il taglio vero e proprio, senza scegliere il bersaglio: lo chiamano lo
     strumento «Togli tratto», che il bersaglio lo prende col puntatore, e
     Canc, che lo prende dalla selezione. La fotografia per l'annulla la
     prende chi chiama, perché solo lui sa se è un gesto o parte di uno. */
  function levaTratto(fi, si, k) {
    var f = forme(), forma = f[fi];
    if (!forma || forma.tipo !== 'tracciato') return;
    var sub = forma.sub[si];
    if (!sub) return;
    var n = sub.nodi;

    if (sub.chiuso) {
      sub.nodi = n.slice(k + 1).concat(n.slice(0, k + 1));
      sub.chiuso = false;
      sel.segmenti = [];
      cambiato();
      Log.add('msg', 'Tolto un lato: il tracciato chiuso si e aperto li.');
      return;
    }

    var pezzi = [n.slice(0, k + 1), n.slice(k + 1)].filter(function (z) {
      return z.length > 1;
    }).map(function (z) { return { nodi: z, chiuso: false }; });

    forma.sub.splice.apply(forma.sub, [si, 1].concat(pezzi));
    sel.segmenti = [];
    if (!forma.sub.length) {
      f.splice(fi, 1);
      nessunaForma();
    }
    cambiato();
    Log.add('msg', pezzi.length === 2
      ? 'Tolto un tratto: restano due pezzi separati.'
      : 'Tolto un tratto.');
  }

  /* ------------------------------ il testo ------------------------------ */

  function metteTesto(p) {
    var s = document.getElementById('ed-testo').value;
    var alt = +document.getElementById('ed-testo-alt').value || 10;
    if (!s.trim()) { Log.add('err', 'Scrivi prima il testo, poi clicca dove va.'); return; }
    /* FontTratto cresce verso l'alto e qui la y va in giù: il punto cliccato
       è la riga su cui le lettere poggiano, e il testo sta sopra. */
    segna();
    forme().push(Tracciato.testo(s, p.x, p.y, alt));
    cambiato();
  }

  /* ------------------------------ il taglio ------------------------------ */

  /* Spezzare un tracciato in due. Si taglia sul NODO più vicino al punto, non
     in mezzo a un segmento: un taglio a metà curva vorrebbe dire dividere una
     cubica in due cubiche, e per quello che serve — separare due pezzi di
     disegno — il nodo basta e non introduce errore. */
  function taglia(p, u) {
    var t = sotto(p, u);
    if (!t || t.sub < 0) { Log.add('err', 'Niente da tagliare lì.'); return; }

    var f = forme(), forma = f[t.forma], sub = forma.sub[t.sub];
    var n = sub.nodi;
    segna();
    var k = Math.max(1, Math.min(n.length - 1, Math.round(t.k - 1 + t.t)));

    if (sub.chiuso) {
      /* Un tracciato chiuso tagliato una volta non diventa due pezzi:
         diventa uno aperto, che comincia e finisce dove si è tagliato. */
      sub.nodi = n.slice(k).concat(n.slice(0, k + 1).map(function (z) {
        return Tracciato.nodo(z.x, z.y, z.hi, z.ho);
      }));
      sub.chiuso = false;
      cambiato();
      Log.add('msg', 'Tracciato chiuso aperto nel punto scelto.');
      return;
    }

    if (k <= 0 || k >= n.length - 1) { Log.add('err', 'Lì il taglio non dividerebbe niente.'); return; }

    var primo = { nodi: n.slice(0, k + 1), chiuso: false };
    var secondo = { nodi: n.slice(k), chiuso: false };
    forma.sub.splice(t.sub, 1, primo, secondo);
    cambiato();
    Log.add('msg', 'Tagliato in due: ' + primo.nodi.length + ' e ' +
                   secondo.nodi.length + ' nodi.');
  }

  /* PIU' TRATTI IN UNA VOLTA.
   *
   * Non è togliere n volte un tratto: togliendo il primo, i sotto-tracciati
   * si spezzano e si rinumerano, e il secondo indice non punterebbe più dove
   * puntava. Si lavora invece per sotto-tracciato, ricostruendolo da capo
   * con i soli pezzi continui che avanzano — e su un tracciato chiuso il
   * giro riparte dal primo tratto tolto, così i pezzi vengono interi invece
   * che spezzati in corrispondenza del nodo zero, che è un posto che non
   * vuol dire niente.
   */
  function levaTratti(lista) {
    var f = forme();
    if (!f || !lista.length) return;

    var mappa = {}, quali = {};
    lista.forEach(function (t) {
      (mappa[t.forma + '/' + t.sub] || (mappa[t.forma + '/' + t.sub] = [])).push(t.k);
      quali[t.forma] = true;
    });

    /* Dalla forma di indice più alto alla più bassa: una forma che sparisce
       rinumera tutte quelle dopo di lei. */
    Object.keys(quali).map(Number).sort(function (a, b) { return b - a; })
      .forEach(function (fi) {
        var forma = f[fi];
        if (!forma || forma.tipo !== 'tracciato') return;
        var nuovi = [];
        forma.sub.forEach(function (sub, si) {
          var togli = mappa[fi + '/' + si];
          if (!togli || !togli.length) { nuovi.push(sub); return; }
          spezzaSub(sub, togli).forEach(function (z) { nuovi.push(z); });
        });
        if (nuovi.length) forma.sub = nuovi;
        else f.splice(fi, 1);
      });

    var quanti = lista.length;
    nessunaForma();
    cambiato();
    Log.add('msg', 'Tolti ' + quanti + ' tratti.');
  }

  function spezzaSub(sub, togli) {
    var n = sub.nodi, m = n.length;
    var quanti = sub.chiuso ? m : m - 1;
    var via = {};
    togli.forEach(function (k) { via[k] = true; });

    var partenza = 0;
    if (sub.chiuso) {
      for (var z = 0; z < quanti; z++) if (via[z]) { partenza = z + 1; break; }
    }

    var out = [], cur = null;
    for (var i = 0; i < quanti; i++) {
      var k = (partenza + i) % quanti;
      if (via[k]) {
        if (cur && cur.length > 1) out.push({ nodi: cur, chiuso: false });
        cur = null;
        continue;
      }
      var a = n[k], b = n[(k + 1) % m];
      if (!cur) cur = [a, b];
      else cur.push(b);
    }
    if (cur && cur.length > 1) out.push({ nodi: cur, chiuso: false });
    return out;
  }

  /* --------------------------- nodi e forme --------------------------- */

  function commutaNodo() {
    var f = forme();
    if (!f || sel.forma < 0 || sel.nodo < 0) return;
    var sub = f[sel.forma].sub[sel.sub], n = sub.nodi[sel.nodo];
    segna();

    if (n.hi || n.ho) { n.hi = null; n.ho = null; }
    else {
      /* Da spigolo a curva: le maniglie nascono lungo la congiungente dei due
         vicini, a un terzo di distanza. È la posizione che rende la curva
         liscia senza spostare il nodo, cioè quella che uno si aspetta. */
      var i = sel.nodo, m = sub.nodi.length;
      var prima = sub.nodi[(i - 1 + m) % m], dopo = sub.nodi[(i + 1) % m];
      var dx = dopo.x - prima.x, dy = dopo.y - prima.y;
      var L = Math.hypot(dx, dy) || 1;
      var d = Math.min(Math.hypot(n.x - prima.x, n.y - prima.y),
                       Math.hypot(dopo.x - n.x, dopo.y - n.y)) / 3;
      n.hi = { x: n.x - dx / L * d, y: n.y - dy / L * d };
      n.ho = { x: n.x + dx / L * d, y: n.y + dy / L * d };
    }
    cambiato();
  }

  function elimina() {
    var f = forme();
    if (!f || sel.forma < 0) return;
    segna();

    /* UN TRATTO SCELTO SI TOGLIE DA SOLO. È il gradino più fine della
       selezione, e Canc agisce sempre su quello che si vede scelto: se c'è
       un tratto evidenziato, è lui. */
    if (sel.segmenti.length) {
      if (sel.segmenti.length === 1) {
        levaTratto(sel.segmenti[0].forma, sel.segmenti[0].sub, sel.segmenti[0].k);
      } else {
        levaTratti(sel.segmenti);
      }
      return;
    }

    if (sel.nodo >= 0) {
      var sub = f[sel.forma].sub[sel.sub];
      if (sub.nodi.length <= 2) {
        /* Un tracciato con meno di due nodi non è niente: togliendo il
           penultimo si toglie il tracciato. */
        f[sel.forma].sub.splice(sel.sub, 1);
        if (!f[sel.forma].sub.length) f.splice(sel.forma, 1);
        sel.forma = -1;
      } else {
        sub.nodi.splice(sel.nodo, 1);
      }
      sel.sub = -1; sel.nodo = -1;
      cambiato();
      return;
    }

    /* Si cancella dall'indice più alto al più basso: togliendo prima il
       primo, tutti quelli dopo scalano di uno e si finirebbe per cancellare i
       vicini invece dei scelti. */
    var gruppo = (sel.forme.length ? sel.forme : [sel.forma]).slice()
      .sort(function (a, b) { return b - a; });
    for (var gi = 0; gi < gruppo.length; gi++) {
      if (gruppo[gi] >= 0) f.splice(gruppo[gi], 1);
    }
    nessunaForma();
    cambiato();
  }

  function doppio(e) {
    if (strumento === 'spezzata') { finisciSpezzata(); return; }
    if (strumento !== 'scegli') return;

    var p = punto(e), u = perPixel();

    var h = nodoSotto(p, u);
    if (h && !h.maniglia) {
      sel.sub = h.sub; sel.nodo = h.nodo;
      commutaNodo();
      return;
    }

    /* Doppio clic su un tratto: un nodo nuovo dove si è cliccato. Il punto è
       preso sulla polilinea, quindi sta sulla curva; la curva fra i due nodi
       vicini cambia un po' di forma, ed è il prezzo di avere un nodo in più
       senza dividere la cubica. */
    var t = sotto(p, u);
    if (!t || t.sub < 0) return;
    var f = forme(), sub = f[t.forma].sub[t.sub];
    segna();
    var dove = Math.max(1, Math.min(sub.nodi.length - 1, Math.round(t.k - 1 + t.t) + 1));
    sub.nodi.splice(dove, 0, Tracciato.nodo(t.punto.x, t.punto.y));
    sel.forma = t.forma; sel.forme = [t.forma]; sel.sub = t.sub; sel.nodo = dove;
    cambiato();
  }

  function passoScritto() {
    var c = document.getElementById('ed-griglia-mm');
    var v = c ? parseFloat(c.value) : NaN;
    return v > 0 ? v : 5;
  }

  /* --------------------------- i livelli qui --------------------------- */

  /* L'ELENCO DEI LIVELLI ANCHE NELL'EDITOR, perché è qui che si decide su
     quale si sta lavorando e quali si vogliono vedere. Porta tre cose e
     basta: il nome, il segno di quale si modifica, l'occhio. Riordinare,
     cancellare e chiedere il cambio penna restano gesti della tab Disegno —
     averli in due posti vorrebbe dire tenerli d'accordo.

     L'OCCHIO E' LO STESSO della tab Disegno, non un secondo interruttore
     «solo per l'editor»: un livello spento non si disegna e non si stampa,
     ed è una cosa sola. L'unica eccezione è quello che si sta modificando,
     che si vede comunque — nasconderlo mentre ci si lavora sopra non vuol
     dire niente. */
  function renderLivelli() {
    var box = document.getElementById('ed-livelli');
    if (!box || !window.Artwork) return;
    var ls = Artwork.livelli();
    if (ls.length < 2) { box.innerHTML = ''; return; }

    var out = '';
    for (var i = 0; i < ls.length; i++) {
      var l = ls[i];
      out += '<div class="ed-liv' + (l.principale ? ' attivo' : '') +
             (l.visibile ? '' : ' spento') + '">' +
             '<button type="button" class="ed-liv-nome" data-ed-liv="' + l.id +
             '" title="' + esc(l.nome) + ' — ' +
             (l.principale ? 'è questo che stai modificando'
                           : 'clicca per modificare questo') + '">' +
             esc(l.nome) + '</button>' +
             '<button type="button" class="liv-ic" data-ed-occhio="' + l.id +
             '" title="' + (l.visibile ? 'Nascondi' : 'Mostra') + '">' +
             (l.visibile ? SEGNI_OCCHIO : SEGNI_CHIUSO) + '</button>' +
             '</div>';
    }
    box.innerHTML = out;
  }

  /* Gli stessi due segni della tab Disegno. Ripetuti e non importati: sono
     due stringhe, e un modulo che per disegnare un occhio deve chiamarne un
     altro è un legame che costa più di quello che risparmia. */
  var SEGNI_OCCHIO =
    '<svg viewBox="0 0 18 14"><path d="M1 7c2.6-4 5.3-6 8-6s5.4 2 8 6c-2.6 4-5.3 6-8 6S3.6 11 1 7z"/>' +
    '<circle cx="9" cy="7" r="2.4"/></svg>';
  var SEGNI_CHIUSO =
    '<svg viewBox="0 0 18 14"><path d="M1 7c2.6-4 5.3-6 8-6s5.4 2 8 6c-2.6 4-5.3 6-8 6S3.6 11 1 7z"/>' +
    '<circle cx="9" cy="7" r="2.4"/><path class="sbarra" d="M2 13L16 1"/></svg>';

  /* Passare a un altro livello: diventa il principale, e se non era fra gli
     scelti ci entra. La storia dell'annulla è PER LIVELLO, perché un passo
     indietro deve riportare indietro il disegno su cui si stava lavorando e
     non un altro. */
  function cambiaLivello(id) {
    if (!window.Artwork || id === Artwork.sceltoId()) return;
    var scelti = Artwork.livelli().filter(function (x) { return x.scelto; });
    var dentro = scelti.some(function (x) { return x.id === id; });
    if (!dentro) Artwork.seleziona(id, 'aggiungi');
    Artwork.principale(id);
    attivo = id;
    storia = storie[id] || (storie[id] = []);
    rifare = rifari[id] || (rifari[id] = []);
    nessunaForma();
    costruendo = null;
    aggiornaStorici();
    var l = Artwork.livelli().filter(function (x) { return x.principale; })[0];
    if (titolo) titolo.textContent = l ? l.nome : '';
    renderLivelli();
    disegna();
    scriviPiede();
  }

  /* ------------------------------- avvio ------------------------------- */

  /* Si entra dal pulsante «Crea / Edit»: con un livello scelto si modifica
     quello, senza si comincia da una tela vuota. */
  function apri() {
    if (!Artwork.forme()) Artwork.nuovo('nuovo disegno');
    nessunaForma();
    costruendo = null;
    guide = [];
    /* La storia è di QUESTO disegno: entrando su un altro livello, un annulla
       rimetterebbe le forme di un disegno dentro a un altro. */
    attivo = Artwork.sceltoId();
    storia = storie[attivo] || (storie[attivo] = []);
    rifare = rifari[attivo] || (rifari[attivo] = []);
    aggiornaStorici();
    renderLivelli();
    var l = (Artwork.livelli() || []).filter(function (x) { return x.principale; })[0];
    if (titolo) titolo.textContent = l ? l.nome : '';
    adatta();
    scriviPiede();
    scriviAiuto();
  }

  function init() {
    svg = document.getElementById('ed-svg');
    tela = document.getElementById('ed-tela');
    aiuto = document.getElementById('ed-aiuto');
    piede = document.getElementById('ed-piede');
    titolo = document.getElementById('ed-titolo');
    if (!svg) return;

    document.getElementById('ed-barra').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.str) scegliStrumento(b.dataset.str);
      else if (b.id === 'ed-adatta') adatta();
      else if (b.id === 'ed-curvo') commutaNodo();
      else if (b.id === 'ed-elimina') elimina();
      else if (b.id === 'ed-annulla') annulla();
      else if (b.id === 'ed-rifai') rifai();
      else if (b.id === 'ed-griglia') {
        griglia = griglia > 0 ? 0 : passoScritto();
        b.classList.toggle('attivo', griglia > 0);
        document.getElementById('ed-griglia-campi').hidden = !(griglia > 0);
        guide = [];
        disegna();
        scriviAiuto();
      }
      else if (b.id === 'ed-magneti') {
        magneti = !magneti;
        b.classList.toggle('attivo', magneti);
        guide = [];
        disegna();
        scriviAiuto();
      }
    });

    /* Il passo si può cambiare a griglia accesa, e il reticolo segue mentre
       si scrive: è il modo per trovare quello giusto: cinque millimetri su un
       logo sono un'altra cosa che su una cornice. */
    var campo = document.getElementById('ed-griglia-mm');
    if (campo) campo.addEventListener('input', function () {
      if (griglia > 0) { griglia = passoScritto(); disegna(); scriviAiuto(); }
    });

    svg.addEventListener('pointerdown', giu);
    svg.addEventListener('pointermove', function (e) { muovi(e); seguiSpezzata(e); });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      svg.addEventListener(ev, su);
    });
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!vista) adatta();
      var f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      var p = punto(e);
      vista = { x0: p.x - (p.x - vista.x0) * f, y0: p.y - (p.y - vista.y0) * f,
                w: vista.w * f, h: vista.h * f };
      applica();
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      if (!document.getElementById('tab-editor').classList.contains('is-active')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      /* Ctrl+Z e Ctrl+Shift+Z, con Cmd al posto di Ctrl sul Mac. */
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) rifai(); else annulla();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        rifai();
        return;
      }
      if (e.key === 'Escape') { chiudiCostruzione(true); scegliStrumento('scegli'); }
      else if (e.key === 'Enter') finisciSpezzata();
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); elimina(); }
    });

    var elenco = document.getElementById('ed-livelli');
    if (elenco) {
      elenco.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.edLiv) cambiaLivello(b.dataset.edLiv);
        else if (b.dataset.edOcchio) {
          Artwork.commutaVisibile(b.dataset.edOcchio);
          renderLivelli();
          disegna();
        }
      });
    }

    if (window.ResizeObserver && tela) new ResizeObserver(function () { disegna(); }).observe(tela);

    scegliStrumento('scegli');
  }

  return { init: init, apri: apri, adatta: adatta, disegna: disegna,
           strumento: function () { return strumento; },
           scegliStrumento: scegliStrumento,
           selezione: function () { return { forma: sel.forma, sub: sel.sub, nodo: sel.nodo }; },
           scelte: function () { return sel.forme.slice(); },
           tratto: function () {
             return sel.segmenti.length ? { sub: sel.segmenti[0].sub, k: sel.segmenti[0].k } : null;
           },
           tratti: function () { return sel.segmenti.slice(); },
           griglia: function (v) { if (v !== undefined) griglia = +v || 0; return griglia; },
           annulla: annulla, rifai: rifai,
           magneti: function (v) {
             if (v !== undefined) {
               magneti = !!v;
               var b = document.getElementById('ed-magneti');
               if (b) b.classList.toggle('attivo', magneti);
             }
             return magneti;
           } };
})();
