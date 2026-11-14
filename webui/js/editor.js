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
  var lazo = null;         // i punti del selettore specifico, mentre lo si tira

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

  /* L'OCCHIO VALE ANCHE PER IL LIVELLO CHE SI STA MODIFICANDO.
     Prima no: lo si disegnava comunque, col ragionamento che nasconderlo
     mentre ci si lavora sopra non vuol dire niente. Ma spegnendoli tutti e
     passando da uno all'altro se ne vedeva sempre uno acceso, e un
     interruttore che a volte non spegne è peggio di uno che manca. Adesso
     spegne: il livello sparisce e non si può nemmeno prendere, perché
     cancellare per sbaglio qualcosa che non si vede è il guaio peggiore che
     un editor possa fare. */
  function attivoVisibile() {
    if (!window.Artwork || !Artwork.livelli) return true;
    var l = Artwork.livelli().filter(function (x) { return x.principale; })[0];
    return !l || l.visibile;
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
    lazo = null;
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
    var f = attivoVisibile() ? (forme() || []) : [];
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
    /* TUTTI I TRATTI SCELTI IN UN SEGNO SOLO, e le curve come curve.
       Prima erano una `polyline` per tratto, con venticinque campioni
       ciascuna: andava bene per i dieci tratti che si prendono col Ctrl, ma
       il selettore specifico ne prende migliaia in una volta, e lì
       diventavano migliaia di elementi e centinaia di migliaia di punti —
       un quarto di secondo A OGNI RIDISEGNO, quindi anche spostando lo
       sguardo. Un `path` solo, con `C` dove c'è una curva, è esatto invece
       che campionato e costa un elemento. */
    if (sel.segmenti.length) {
      var d = '';
      sel.segmenti.forEach(function (t) {
        var fm = f[t.forma];
        if (!fm || fm.tipo !== 'tracciato') return;
        var sg = fm.sub[t.sub];
        if (!sg) return;
        var nn = sg.nodi, a0 = nn[t.k], b0 = nn[(t.k + 1) % nn.length];
        if (!a0 || !b0) return;
        d += 'M' + a0.x + ' ' + a0.y;
        if (!a0.ho && !b0.hi) d += 'L' + b0.x + ' ' + b0.y;
        else {
          var h1 = a0.ho || a0, h2 = b0.hi || b0;
          d += 'C' + h1.x + ' ' + h1.y + ' ' + h2.x + ' ' + h2.y +
               ' ' + b0.x + ' ' + b0.y;
        }
      });
      if (d) out += '<path class="ed-seg" d="' + d + '"></path>';
    }

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

    /* Il filo del lazo si chiude da sé con un tratteggio: il cerchio che
       conta è quello CHIUSO, e vederlo aperto mentre si decide dove finire
       fa sbagliare il giro. */
    if (lazo && lazo.length > 1) {
      out += '<polyline class="ed-lazo" points="' + via(lazo) + '"></polyline>' +
             '<line class="ed-lazo-chiudi" x1="' + lazo[lazo.length - 1].x +
             '" y1="' + lazo[lazo.length - 1].y + '" x2="' + lazo[0].x +
             '" y2="' + lazo[0].y + '"></line>';
    }

    if (banda) {
      out += '<rect class="ed-banda" x="' + banda.x0 + '" y="' + banda.y0 +
             '" width="' + (banda.x1 - banda.x0) +
             '" height="' + (banda.y1 - banda.y0) + '"></rect>';
    }

    svg.innerHTML = out;
    /* Taglia, copia e incolla dipendono da che cosa è scelto, e qui passa
       ogni cambio di selezione: non c'è un secondo posto da ricordarsi. */
    aggiornaBarra();
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
    scegli: '<b>Clicca un tratto</b> e prendi quello, non la linea intera. ' +
            '<b>Ctrl+clic</b> ne somma altri — dieci linee e un Canc solo —, ' +
            '<b>Shift+clic</b> prende le forme intere, e trascinando nel vuoto ' +
            'si prende quello che il rettangolo tocca. Trascina per spostare, ' +
            'o prendi nodi e maniglie. <b>Doppio clic</b> su un tratto scelto: ' +
            'ci infila un nodo, dove hai cliccato e su quello e non su un ' +
            'altro; su un nodo: da spigolo a curva e viceversa. Canc toglie ' +
            'quello che è scelto. <b>Ctrl+X</b> o <b>Ctrl+C</b>, poi un altro ' +
            'livello e <b>Ctrl+V</b>: ci finisce nello stesso posto del foglio, ' +
            'cambia solo la penna che lo disegna.',
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
            'separati come se la penna si fosse alzata.',
    lazo:   '<b>Cerchia a mano libera</b> quello che vuoi: prende solo quello ' +
            'che resta DENTRO, e dove una spezzata esce <b>la taglia sul ' +
            'bordo</b>. Poi <b>Ctrl+X</b>, scegli il livello e <b>Ctrl+V</b>: ' +
            'sul foglio non si muove niente, cambia solo la penna. Lavora sul ' +
            'livello acceso, e i testi non li taglia.'
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
    if (!attivoVisibile()) {
      piede.textContent = 'Livello nascosto: accendi il suo occhio nell\'elenco ' +
                          'qui a sinistra per vederlo e modificarlo.';
      return;
    }
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
    /* Il tasto centrale sposta lo sguardo anche su un livello spento: quello
       non tocca niente. Tutto il resto no. */
    if (!attivoVisibile() && e.button !== 1) {
      Log.add('err', 'Questo livello è nascosto: accendi il suo occhio per ' +
                     'poterlo modificare.');
      return;
    }
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
    if (strumento === 'lazo') {
      presa = { tipo: 'lazo', inizio: p };
      lazo = [p];
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* non capita */ }
      return;
    }
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
      sel.sub = -1; sel.nodo = -1; sel.maniglia = null;
      sel.segmenti = [];
      disegna();
      return;
    }

    /* Prendendo una forma CHE E' GIA' NEL GRUPPO si trascina tutto il gruppo.
       È il gesto con cui si sposta quello che si è appena scelto, e
       ricominciare da capo a ogni pressione renderebbe la selezione multipla
       una cosa che si può fare ma non serve a niente. */
    /* IL CLIC PRENDE IL TRATTO, non la polilinea.
       Prima prendeva la forma intera e per scendere al tratto ci voleva un
       secondo clic. Su un disegno importato una forma è spesso il contorno
       di una faccia — quattro spigoli in un elemento solo — quindi il primo
       clic accendeva quattro linee quando se ne voleva una, e il gradino in
       più era un gesto da fare centinaia di volte. Adesso il gradino fine è
       il PREDEFINITO: Shift prende le forme intere, il rettangolo pure.
       Il trascinamento continua a spostare la forma: è un altro gesto, e si
       distingue da sé. */
    /* UN GRUPPO NON SI SFALDA PREMENDOCI SOPRA. Se la forma sotto al dito fa
       già parte di una scelta di più forme — col rettangolo o con Shift — la
       pressione serve a trascinare tutto il gruppo, non a ricominciare da
       capo da un tratto. Scendere al tratto vale quando di scelto c'è una
       forma sola, che è il caso di tutti i giorni. */
    if (sel.forme.length > 1 && sel.forme.indexOf(t.forma) >= 0) {
      presa = { tipo: 'forma', da: p };
      segna();
      svg.setPointerCapture(e.pointerId);
      return;
    }

    var tr = trattoSotto(p, u);

    /* LA SCELTA E' APPICCICOSA. Se il clic cade ancora sul tratto già
       scelto, resta quello — anche se un altro gli passa accanto a un pelo
       di distanza. Dove due linee si incrociano il «più vicino» cambia a
       ogni pixel, e il doppio clic per infilare un nodo finiva sulla linea
       SOTTO invece che su quella su cui si stava lavorando: il nodo nasceva
       nel posto giusto ma nel tracciato sbagliato. Segnalato usandolo. */
    if (sel.segmenti.length === 1) {
      var vecchio = sel.segmenti[0];
      var dv = distTratto(p, vecchio);
      if (dv !== null && dv < 8 * u) tr = { forma: vecchio.forma, sub: vecchio.sub, k: vecchio.k };
    }

    if (tr) {
      sel.forme = [tr.forma];
      sel.forma = tr.forma;
      sel.segmenti = [{ forma: tr.forma, sub: tr.sub, k: tr.k }];
    } else {
      /* Un testo non ha tratti: lì si prende la forma, che è tutto quello
         che c'è da prendere. */
      if (sel.forme.indexOf(t.forma) < 0) sel.forme = [t.forma];
      sel.forma = t.forma;
      sel.segmenti = [];
    }
    sel.sub = -1; sel.nodo = -1; sel.maniglia = null;
    presa = { tipo: 'forma', da: p };
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
    sel.segmenti = [];
  }

  function muovi(e) {
    if (!presa) return;
    /* DUE DITA SULLA TELA SONO UNA PINZATA, non un trascinamento: quello che
       si stava muovendo resta fermo dov'era finche' le dita non tornano una.
       Il gesto in corso non si chiude da se' -- chiuderlo qui vorrebbe dire
       posare un nodo nel punto in cui il secondo dito si e' appoggiato, cioe'
       modificare il disegno per sbaglio. */
    if (window.Tocco && Tocco.dita(svg) > 1) return;
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

    if (presa.tipo === 'lazo') {
      /* Si tiene solo quello che aggiunge forma: un punto ogni pixel. Il filo
         deve seguire il dito, ma diecimila punti per un cerchio rendono poi
         ogni confronto diecimila volte più caro. */
      var ul = lazo[lazo.length - 1];
      var px = perPixel();
      if ((p.x - ul.x) * (p.x - ul.x) + (p.y - ul.y) * (p.y - ul.y) >= px * px) {
        lazo.push(p);
        disegna();
      }
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

  function su(e) {
    var mosso = presa && presa.mosso;
    var tipo = presa ? presa.tipo : null;
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
    forseDoppio = false;
    guide = [];

    if (tipo === 'lazo') {
      var punti = lazo || [];
      lazo = null;
      if (mosso && punti.length >= 3) prendiDentro(punti);
      else { nessunaForma(); disegna(); }
      scriviPiede();
      return;
    }

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

  /* Quanto dista il puntatore da un tratto preciso. Serve alla scelta
     appiccicosa: vedi giuScegli(). */
  function distTratto(p, t) {
    var f = forme();
    var fm = f && f[t.forma];
    if (!fm || fm.tipo !== 'tracciato') return null;
    var sub = fm.sub[t.sub];
    if (!sub) return null;
    var n = sub.nodi, a = n[t.k], b = n[(t.k + 1) % n.length];
    if (!a || !b) return null;
    var c = cubicaDi(a, b), d = Infinity;
    for (var j = 0; j <= 32; j++) {
      var q = valuta(c, j / 32);
      var z = Math.hypot(p.x - q.x, p.y - q.y);
      if (z < d) d = z;
    }
    return d;
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
    if (!f || sel.forma < 0 || sel.nodo < 0 || !attivoVisibile()) return;
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
    /* Su un livello spento non si cancella niente: quello che non si vede
       non si può nemmeno sbagliare a togliere. */
    if (!attivoVisibile()) {
      Log.add('err', 'Questo livello è nascosto: accendi il suo occhio prima ' +
                     'di toglierne qualcosa.');
      return;
    }
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

  /* ================= IL SELETTORE SPECIFICO, E LO SPECCHIO =================
   *
   * IL SELETTORE SPECIFICO (il lazo). Si cerchia a mano libera e si prende
   * SOLO QUELLO CHE STA DENTRO — non le forme che il cerchio tocca, ma i
   * pezzi di linea contenuti. Dove una spezzata esce dal cerchio, LA SI
   * TAGLIA SUL BORDO.
   *
   * È il taglio che lo rende diverso da tutto il resto, e senza quello non
   * servirebbe a niente. Su un disegno importato una «linea» non esiste: una
   * campitura a onde è UN tracciato con decine di migliaia di nodi, e
   * portarne via un pezzo con Scegli e Ctrl+X vuol dire cliccare tratto per
   * tratto per mezz'ora. Il rettangolo di selezione non aiuta: prende le
   * FORME che tocca, cioè tutta la campitura.
   *
   * E il taglio è sul bordo VERO, non al nodo più vicino: su un tratto dritto
   * è l'intersezione esatta, su una curva è una bisezione sul parametro.
   * Tagliare al nodo lascerebbe barbe fuori dal cerchio e buchi dentro, e su
   * una campitura fitta quelle barbe sono proprio quello che si vede sulla
   * carta.
   *
   * Lavora sul livello acceso, come tutto l'editor: il lazo non è un modo di
   * scavalcare i livelli, è un modo di scegliere dentro a uno.
   */

  /* Punto dentro a un poligono: raggio verso destra, si contano gli incroci,
     dispari vuol dire dentro. Vale anche per un poligono rientrante, ed è il
     motivo per cui si usa questo e non il verso dell'area: un lazo tirato a
     mano è quasi sempre rientrante da qualche parte. */
  function dentroPoli(q, poli) {
    var dentro = false, n = poli.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var a = poli[i], b = poli[j];
      if ((a.y > q.y) !== (b.y > q.y) &&
          q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) dentro = !dentro;
    }
    return dentro;
  }

  /* Dove due segmenti si incrociano, come frazione del primo. -1 se non si
     incrociano. Gli estremi esatti non contano: un taglio a t = 0
     produrrebbe un tratto di lunghezza zero. */
  function incrocioRetta(p0, p1, a, b) {
    var rx = p1.x - p0.x, ry = p1.y - p0.y;
    var sx = b.x - a.x, sy = b.y - a.y;
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return -1;
    var t = ((a.x - p0.x) * sy - (a.y - p0.y) * sx) / den;
    var u = ((a.x - p0.x) * ry - (a.y - p0.y) * rx) / den;
    if (t <= 1e-9 || t >= 1 - 1e-9 || u < 0 || u > 1) return -1;
    return t;
  }

  /* Tutti i punti in cui un tratto attraversa il bordo del lazo. */
  function incroci(a, b, poli, dritto) {
    var ts = [], i, j, t;
    if (dritto) {
      for (i = 0, j = poli.length - 1; i < poli.length; j = i++) {
        t = incrocioRetta(a, b, poli[j], poli[i]);
        if (t > 0) ts.push(t);
      }
    } else {
      /* Una curva si campiona e poi si stringe: dove il dentro/fuori cambia
         fra due campioni c'è un bordo in mezzo, e dodici bisezioni lo
         inchiodano a un trentamillesimo del tratto — molto sotto la punta
         della penna, che è quattro decimi di millimetro. */
      var c = cubicaDi(a, b), N = 32, prima = dentroPoli(valuta(c, 0), poli);
      for (var k = 1; k <= N; k++) {
        var tk = k / N, ora = dentroPoli(valuta(c, tk), poli);
        if (ora !== prima) {
          var lo = (k - 1) / N, hi = tk;
          for (var z = 0; z < 12; z++) {
            var mm = (lo + hi) / 2;
            if (dentroPoli(valuta(c, mm), poli) === prima) lo = mm; else hi = mm;
          }
          ts.push((lo + hi) / 2);
          prima = ora;
        }
      }
    }
    ts.sort(function (x, y) { return x - y; });
    return ts;
  }

  /* Una cubica tagliata in due nel punto t, con de Casteljau: le due metà
     hanno maniglie nuove e passano esattamente dove passava l'originale.
     Mettere un nodo nel punto giusto senza rifare le maniglie storcerebbe la
     curva proprio dove la si sta tagliando. */
  function spezzaCubica(c, t) {
    function L(p, q) { return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
    var a = L(c.p0, c.p1), b = L(c.p1, c.p2), d = L(c.p2, c.p3);
    var e = L(a, b), f = L(b, d), g = L(e, f);
    return [{ p0: c.p0, p1: a, p2: e, p3: g },
            { p0: g, p1: f, p2: d, p3: c.p3 }];
  }

  function bboxSub(sub) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    function q(z) {
      if (!z) return;
      if (z.x < b.x0) b.x0 = z.x;
      if (z.y < b.y0) b.y0 = z.y;
      if (z.x > b.x1) b.x1 = z.x;
      if (z.y > b.y1) b.y1 = z.y;
    }
    sub.nodi.forEach(function (n) { q(n); q(n.hi); q(n.ho); });
    return b;
  }

  function fuoriDa(b, c) {
    return b.x1 < c.x0 || b.x0 > c.x1 || b.y1 < c.y0 || b.y0 > c.y1;
  }

  /* Taglia un sotto-tracciato sul bordo del lazo e dice quali dei tratti
     risultanti stanno dentro. Torna null se quel sotto-tracciato non
     c'entra niente. */
  function tagliaSub(sub, poli, cornice) {
    var n = sub.nodi, m = n.length;
    var quanti = sub.chiuso ? m : m - 1;
    if (quanti < 1) return null;

    var nuovi = [], flag = [], tocca = false;
    for (var i = 0; i < quanti; i++) {
      var a = n[i], b = n[(i + 1) % m];
      nuovi.push(a);

      /* Un tratto la cui scatola non sfiora nemmeno quella del lazo è fuori,
         e non c'è niente da calcolare. Vale il 12% del tempo su sessantamila
         tratti — misurato togliendolo, non supposto. Scriverci «è quello che
         rende la cosa possibile» sarebbe stato falso, e avrebbe mandato chi
         un giorno vorrà velocizzare questo codice a guardare nel posto
         sbagliato: quello giusto è dove si rigenera, non qui. */
      var sb = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
                 x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      if (a.ho) { sb.x0 = Math.min(sb.x0, a.ho.x); sb.y0 = Math.min(sb.y0, a.ho.y);
                  sb.x1 = Math.max(sb.x1, a.ho.x); sb.y1 = Math.max(sb.y1, a.ho.y); }
      if (b.hi) { sb.x0 = Math.min(sb.x0, b.hi.x); sb.y0 = Math.min(sb.y0, b.hi.y);
                  sb.x1 = Math.max(sb.x1, b.hi.x); sb.y1 = Math.max(sb.y1, b.hi.y); }
      if (fuoriDa(sb, cornice)) { flag.push(false); continue; }

      var dritto = !a.ho && !b.hi;
      var ts = incroci(a, b, poli, dritto);
      if (ts.length) tocca = true;

      if (!ts.length) {
        var mezzo = dritto ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
                           : valuta(cubicaDi(a, b), 0.5);
        flag.push(dentroPoli(mezzo, poli));
        continue;
      }

      if (dritto) {
        var prec = 0;
        for (var w0 = 0; w0 < ts.length; w0++) {
          var t0 = ts[w0];
          var mz = { x: a.x + (b.x - a.x) * (prec + t0) / 2,
                     y: a.y + (b.y - a.y) * (prec + t0) / 2 };
          flag.push(dentroPoli(mz, poli));
          nuovi.push(Tracciato.nodo(a.x + (b.x - a.x) * t0,
                                    a.y + (b.y - a.y) * t0));
          prec = t0;
        }
        var mzf = { x: a.x + (b.x - a.x) * (prec + 1) / 2,
                    y: a.y + (b.y - a.y) * (prec + 1) / 2 };
        flag.push(dentroPoli(mzf, poli));
        continue;
      }

      /* Curva: si taglia un pezzo per volta, e il parametro di quelli dopo
         va riscalato sul pezzo che resta. */
      var resto = cubicaDi(a, b), base = 0;
      for (var w = 0; w < ts.length; w++) {
        var tl = (ts[w] - base) / (1 - base);
        var due = spezzaCubica(resto, tl);
        flag.push(dentroPoli(valuta(due[0], 0.5), poli));
        a.ho = { x: due[0].p1.x, y: due[0].p1.y };
        var nn = Tracciato.nodo(due[0].p3.x, due[0].p3.y,
                                { x: due[0].p2.x, y: due[0].p2.y },
                                { x: due[1].p1.x, y: due[1].p1.y });
        nuovi.push(nn);
        a = nn;
        resto = due[1];
        base = ts[w];
      }
      flag.push(dentroPoli(valuta(resto, 0.5), poli));
      b.hi = { x: resto.p2.x, y: resto.p2.y };
    }
    if (!sub.chiuso) nuovi.push(n[m - 1]);

    var dentroQualcosa = flag.some(function (x) { return x; });
    if (!dentroQualcosa && !tocca) return null;
    sub.nodi = nuovi;
    return flag;
  }

  /* La riduzione del lazo: punti più vicini di un pixel e mezzo non
     aggiungono niente alla forma e moltiplicano il lavoro, perché ogni
     tratto del disegno si confronta con OGNI lato del lazo. */
  function riduciLazo(punti, passo) {
    var out = [punti[0]];
    for (var i = 1; i < punti.length; i++) {
      var u = out[out.length - 1];
      var dx = punti[i].x - u.x, dy = punti[i].y - u.y;
      if (dx * dx + dy * dy >= passo * passo) out.push(punti[i]);
    }
    return out;
  }

  /* IL LAZO NON CAMBIA IL DISEGNO, cambia solo dove stanno i nodi: quelli
     nuovi cadono esattamente sulla linea che c'era già. Quindi le polilinee
     che Artwork tiene in cassa restano valide, e si può saltare
     `Artwork.rigenera()`.
     NON È UN DETTAGLIO. Misurato il 2026-11-02 su sessantamila tratti: il
     gesto intero costava 1714 ms, e di quelli la RIGENERAZIONE era 1556. La
     geometria del lazo — gli incroci, i tagli, de Casteljau — è 126, e
     l'istantanea dell'annulla 33. Si pagava dieci volte tutto il resto messo
     insieme per rifare un calcolo il cui risultato è identico.
     La rigenerazione torna al primo gesto che il disegno lo cambia davvero,
     cioè dal Ctrl+X in poi, e quello passa da `cambiato()` come sempre. */
  function soloSpostati() {
    disegna();
    scriviPiede();
  }

  function prendiDentro(punti) {
    var f = forme();
    if (!f) return;
    if (!attivoVisibile()) {
      Log.add('err', 'Questo livello è nascosto: accendi il suo occhio prima ' +
                     'di cerchiarci dentro.');
      return;
    }
    var poli = riduciLazo(punti, perPixel() * 1.5);
    if (poli.length < 3) { nessunaForma(); disegna(); return; }

    var cornice = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    poli.forEach(function (q) {
      if (q.x < cornice.x0) cornice.x0 = q.x;
      if (q.y < cornice.y0) cornice.y0 = q.y;
      if (q.x > cornice.x1) cornice.x1 = q.x;
      if (q.y > cornice.y1) cornice.y1 = q.y;
    });
    if (cornice.x1 - cornice.x0 < perPixel() * 3 &&
        cornice.y1 - cornice.y0 < perPixel() * 3) {
      nessunaForma(); disegna(); return;
    }

    segna();
    var presi = [], testi = 0, toccate = {};
    for (var fi = 0; fi < f.length; fi++) {
      var forma = f[fi];
      if (!forma) continue;
      if (forma.tipo === 'testo') { testi++; continue; }
      if (!forma.sub) continue;
      for (var si = 0; si < forma.sub.length; si++) {
        var sg = forma.sub[si];
        if (!sg.nodi || sg.nodi.length < 2) continue;
        if (fuoriDa(bboxSub(sg), cornice)) continue;
        var flag = tagliaSub(sg, poli, cornice);
        if (!flag) continue;
        for (var k = 0; k < flag.length; k++) {
          if (flag[k]) { presi.push({ forma: fi, sub: si, k: k }); toccate[fi] = true; }
        }
      }
    }

    if (!presi.length) {
      /* Niente dentro: l\'istantanea presa un attimo fa sarebbe un passo
         indietro che non riporta indietro niente. */
      storia.pop();
      aggiornaStorici();
      nessunaForma();
      soloSpostati();
      Log.add('err', 'Dentro al cerchio non c\'era niente di questo livello.' +
              (testi ? ' Ci sono ' + testi + ' testi, che il lazo non taglia: ' +
                       'una parola tagliata a metà non è più una parola.' : ''));
      return;
    }

    sel.segmenti = presi;
    var quali = Object.keys(toccate).map(Number);
    sel.forme = [];
    sel.forma = quali.length ? quali[0] : -1;
    sel.sub = -1; sel.nodo = -1; sel.maniglia = null;
    soloSpostati();
    Log.add('msg', 'Presi ' + presi.length + ' tratti dentro al cerchio, ' +
            'tagliati sul bordo. Ctrl+X, poi scegli il livello e Ctrl+V: sul ' +
            'foglio non si muove niente.' +
            (testi ? ' I ' + testi + ' testi del livello sono rimasti fuori: ' +
                     'il lazo non li taglia.' : ''));
  }

  /* ------------------------------ lo specchio ------------------------------
   *
   * Ribalta quello che è scelto attorno alla RIGA DI MEZZO di quello che è
   * scelto: così il disegno resta dov'è e si gira soltanto. Un asse messo
   * altrove lo farebbe anche volare via, e si dovrebbe rincorrere.
   *
   * Non è una rotazione di mezzo giro, ed è il motivo per cui serve: una
   * lettera ruotata resta leggibile al contrario, una lettera RIBALTATA è
   * l'immagine allo specchio. Le due cose coincidono solo per le figure
   * simmetriche, cioè quasi mai.
   *
   * UN TESTO RIBALTATO SMETTE DI ESSERE UN TESTO. La forma `testo` tiene la
   * parola e l'altezza, e da quelle le lettere si ricostruiscono dritte ogni
   * volta: non c'è posto dove scrivere «ma rovesciata». Quindi lo si
   * trasforma in tracciati, una volta sola e dicendolo: da lì in poi la
   * parola non si riscrive più, ma lo specchio tiene.
   */
  var specchioAsse = 'v';      // 'v' = asse verticale, ribalta destra-sinistra

  function testoInTracciato(forma) {
    var subs = [];
    Tracciato.appiattisci(forma, TOL).forEach(function (poly) {
      if (poly.length < 2) return;
      subs.push({ chiuso: false, nodi: poly.map(function (q) {
        return Tracciato.nodo(q.x, q.y);
      }) });
    });
    return Tracciato.tracciato(subs);
  }

  function specchia() {
    var f = forme();
    if (!f) return;
    if (!attivoVisibile()) {
      Log.add('err', 'Questo livello è nascosto: accendi il suo occhio prima ' +
                     'di ribaltarci qualcosa.');
      return;
    }
    var gruppo = sel.forme.length ? sel.forme.slice()
               : (sel.forma >= 0 ? [sel.forma] : []);
    if (!gruppo.length) {
      Log.add('err', 'Non c\'è nessuna forma scelta da ribaltare: clicca una ' +
                     'linea, o tienine premuto Shift per prenderne altre. ' +
                     'Lo specchio lavora su forme intere, non su singoli tratti.');
      return;
    }
    var scelte = gruppo.map(function (i) { return f[i]; })
                       .filter(function (x) { return !!x; });
    var b = Tracciato.bbox(scelte, TOL);
    if (!isFinite(b.w) || !isFinite(b.h)) {
      Log.add('err', 'Quello che è scelto non ha una misura: non so attorno a ' +
                     'che cosa ribaltarlo.');
      return;
    }
    var cx = b.x0 + b.w / 2, cy = b.y0 + b.h / 2;
    var m = specchioAsse === 'v'
      ? { a: -1, b: 0, c: 0, d: 1, e: 2 * cx, f: 0 }
      : { a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * cy };

    segna();
    var testi = 0;
    gruppo.forEach(function (i) {
      var forma = f[i];
      if (!forma) return;
      if (forma.tipo === 'testo') { forma = testoInTracciato(forma); testi++; }
      f[i] = Tracciato.trasforma(forma, m);
    });
    sel.sub = -1; sel.nodo = -1; sel.maniglia = null; sel.segmenti = [];
    cambiato();
    Log.add('msg', 'Ribaltato attorno all\'asse ' +
            (specchioAsse === 'v' ? 'verticale (destra-sinistra)'
                                  : 'orizzontale (sopra-sotto)') +
            ', in mezzo a quello che era scelto: sul foglio non si è spostato.' +
            (testi ? ' ' + (testi === 1 ? 'Un testo è diventato' : testi +
                     ' testi sono diventati') + ' tracciati: una parola ' +
                     'allo specchio non si riscrive più.' : ''));
  }

  /* --------------------------- ruota e scala ---------------------------
   *
   * Chiesti dall'operatore il 2026-11-08: «la possibilità di ingrandire e
   * ruotare le forme anche nella tab edit». Nella tab Disegno si fa già, col
   * riquadro sul foglio, ma quello lavora su LIVELLI INTERI: qui serve
   * girare una freccia e basta, lasciando fermo il resto del disegno.
   *
   * Sono lo stesso gesto dello specchio con un'altra matrice, e come lui
   * lavorano ATTORNO AL CENTRO di quello che è scelto: così la cosa resta
   * dov'è e cambia soltanto. Un centro altrove — l'origine del livello, per
   * dire — la farebbe anche volare via, e si dovrebbe rincorrerla.
   *
   * UN TESTO RUOTATO SMETTE DI ESSERE UN TESTO, come allo specchio: la forma
   * `testo` tiene la parola e l'altezza e le lettere si ricostruiscono
   * dritte ogni volta, quindi non c'è posto dove scrivere «ma storta».
   * INGRANDITO INVECE RESTA UN TESTO, e non è un'incoerenza: ingrandire un
   * testo vuol dire scriverlo più grande, e l'altezza è proprio il numero
   * che la forma tiene. `Tracciato.trasforma` la scala già da sé, con la
   * radice del determinante.
   */

  /* Quello che è scelto, pronto da trasformare, o null col motivo già detto
     nel registro. Un posto solo, perché ruota, scala e specchio devono
     rifiutare per le stesse ragioni e dirlo con le stesse parole. */
  function gruppoDaTrasformare(verbo) {
    var f = forme();
    if (!f) return null;
    if (!attivoVisibile()) {
      Log.add('err', 'Questo livello è nascosto: accendi il suo occhio prima ' +
                     'di ' + verbo + 'ci qualcosa.');
      return null;
    }
    var gruppo = sel.forme.length ? sel.forme.slice()
               : (sel.forma >= 0 ? [sel.forma] : []);
    if (!gruppo.length) {
      Log.add('err', 'Non c\'è nessuna forma scelta: clicca una linea, o ' +
                     'tienine premuto Shift per prenderne altre. Si lavora su ' +
                     'forme intere, non su singoli tratti.');
      return null;
    }
    var scelte = gruppo.map(function (i) { return f[i]; })
                       .filter(function (x) { return !!x; });
    var b = Tracciato.bbox(scelte, TOL);
    if (!isFinite(b.w) || !isFinite(b.h)) {
      Log.add('err', 'Quello che è scelto non ha una misura: non so attorno a ' +
                     'che cosa girarlo.');
      return null;
    }
    return { f: f, gruppo: gruppo, b: b,
             cx: b.x0 + b.w / 2, cy: b.y0 + b.h / 2 };
  }

  /* Applica la matrice alle forme scelte. `testiInTracciati` dice se la
     trasformazione è di quelle che un testo non sa portarsi dietro. */
  function applicaMatrice(g, m, testiInTracciati) {
    segna();
    var testi = 0;
    g.gruppo.forEach(function (i) {
      var forma = g.f[i];
      if (!forma) return;
      if (testiInTracciati && forma.tipo === 'testo') {
        forma = testoInTracciato(forma);
        testi++;
      }
      g.f[i] = Tracciato.trasforma(forma, m);
    });
    sel.sub = -1; sel.nodo = -1; sel.maniglia = null; sel.segmenti = [];
    cambiato();
    return testi;
  }

  /* Un numero da leggere, non da stampare: due decimali e via gli zeri in
     coda. Le unità sono quelle del livello, che non sono millimetri del
     foglio — un file può avere una scala qualunque — e per questo il
     messaggio lo dice. */
  function misura(v) {
    return String(Math.round(v * 100) / 100);
  }

  /* IL VERSO. Le coordinate di un livello sono quelle del file da cui viene,
     cioè quelle di un SVG: la y cresce verso il BASSO, e l'editor le disegna
     così com'è — per questo nell'editor il disegno si vede dritto come nel
     file. Quindi un angolo positivo, che sulla carta di un matematico sarebbe
     antiorario, qui si vede girare in senso ORARIO. È quello che dice il
     suggerimento del campo, ed è così anche sul foglio: il piano ribalta la
     y per disegnare, quindi mostra la stessa figura dell'editor. */
  function ruota() {
    var gradi = +document.getElementById('ed-ruota-gradi').value || 0;
    /* Un giro intero è il modo più sicuro di credere che il pulsante sia
       rotto: non si tocca niente e non si sporca la pila dell'annulla. */
    if (!(gradi % 360)) {
      Log.add('err', 'Gradi ' + gradi + ': sarebbe un giro intero, e non ' +
                     'cambierebbe niente. Scrivi quanto vuoi girarlo — 90, ' +
                     '45, o un numero negativo per girare dall\'altra parte.');
      return;
    }
    var g = gruppoDaTrasformare('gira');
    if (!g) return;
    var a = gradi * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    var m = { a: co, b: si, c: -si, d: co,
              e: g.cx - co * g.cx + si * g.cy,
              f: g.cy - si * g.cx - co * g.cy };
    var testi = applicaMatrice(g, m, true);
    Log.add('msg', 'Girato di ' + gradi + '° in senso ' +
            (gradi > 0 ? 'orario' : 'antiorario') + ' attorno al centro di ' +
            'quello che era scelto: sul foglio non si è spostato.' +
            (testi ? ' ' + (testi === 1 ? 'Un testo è diventato' : testi +
                     ' testi sono diventati') + ' tracciati: una parola ' +
                     'storta non si riscrive più.' : ''));
  }

  function scala() {
    var pc = +document.getElementById('ed-scala-pc').value || 0;
    if (pc <= 0) {
      Log.add('err', 'Per cento ' + pc + ': non si può. Sotto zero il disegno ' +
                     'si rovescia, a zero sparisce in un punto — e da un punto ' +
                     'non torna indietro.');
      return;
    }
    if (pc === 100) {
      Log.add('err', 'Il 100% è la misura di adesso: non cambierebbe niente. ' +
                     'Scrivi 200 per raddoppiare, 50 per dimezzare.');
      return;
    }
    var g = gruppoDaTrasformare('ingrandi');
    if (!g) return;
    var k = pc / 100;
    var m = { a: k, b: 0, c: 0, d: k,
              e: g.cx - k * g.cx, f: g.cy - k * g.cy };
    applicaMatrice(g, m, false);
    Log.add('msg', (pc > 100 ? 'Ingrandito' : 'Rimpicciolito') + ' al ' + pc +
            '% attorno al centro di quello che era scelto: da ' +
            misura(g.b.w) + ' × ' + misura(g.b.h) + ' a ' +
            misura(g.b.w * k) + ' × ' + misura(g.b.h * k) +
            ' nelle unità del livello. I testi restano testi: ingrandire un ' +
            'testo vuol dire scriverlo più grande.');
  }

  /* ---------------------- taglia, copia, incolla ----------------------
   *
   * A CHE COSA SERVE, perché non è il copia-incolla di un documento: a
   * rimettere una linea nel livello giusto. L'importazione divide per tinta,
   * e la tinta è il modo in cui chi ha fatto il file ha detto cosa va
   * insieme — ma non sempre è il modo in cui lo si vuole disegnare: le facce
   * di sinistra di un cubo possono finire insieme ai contorni, e lì sono una
   * penna sola quando ne volevi due. Si sceglie, si taglia, si cambia
   * livello, si incolla, e sul foglio non si è mosso niente: è cambiata solo
   * la penna che le disegnerà.
   *
   * SUL FOGLIO NON SI MUOVE NIENTE, ed è l'unico requisito che conta. Due
   * livelli hanno coordinate diverse — sono quelle dei file da cui vengono —
   * quindi lo stesso punto ha numeri diversi nei due. La conversione la fa
   * Artwork.incolla passando per il foglio; qui si decide solo CHE COSA
   * viaggia.
   *
   * L'ANNULLA RESTA DUE PASSI, uno per livello, e non è una mancanza: il
   * taglio e l'incolla sono due gesti su due disegni diversi, e la pila
   * dell'annulla è per livello apposta. Ctrl+Z sul livello di arrivo toglie
   * quello che è appena arrivato; Ctrl+Z su quello di partenza lo rimette
   * dov'era.
   */

  /* Gli appunti si portano dietro LA MAPPA del livello da cui vengono, non
     il suo nome: le forme sono scritte in quelle coordinate, e il livello che
     gliele ha date può cambiarle un attimo dopo — il taglio stesso le cambia,
     se quello che resta è una riga verticale. Vedi Artwork.mappa(). */
  var appunti = null;      // { forme: [...], da: mappa, che: 'sette tratti' }

  function cpNodo(n) {
    return { x: n.x, y: n.y,
             hi: n.hi ? { x: n.hi.x, y: n.hi.y } : null,
             ho: n.ho ? { x: n.ho.x, y: n.ho.y } : null };
  }

  /* I capi di un pezzo staccato perdono la maniglia che guardava FUORI:
     quella apparteneva al tratto rimasto di là, e tenerla piegherebbe il
     pezzo verso un nodo che non c'è più. */
  function capi(s) {
    s.nodi[0].hi = null;
    s.nodi[s.nodi.length - 1].ho = null;
    return s;
  }

  /* I TRATTI SCELTI, staccati e messi in una forma sola.
     Quelli che si toccano restano attaccati: dieci tratti di fila sono una
     polilinea, non dieci alzate di penna — e un'alzata di penna in più si
     vede sulla carta. Se di un tracciato chiuso sono scelti TUTTI i tratti,
     quello che ne esce è ancora chiuso. */
  function daiSegmenti(f, lista) {
    var gruppi = {}, ordine = [];
    lista.forEach(function (s) {
      var kk = s.forma + '|' + s.sub;
      if (!gruppi[kk]) { gruppi[kk] = { forma: s.forma, sub: s.sub, ks: [] }; ordine.push(kk); }
      gruppi[kk].ks.push(s.k);
    });

    var subs = [];
    ordine.forEach(function (kk) {
      var g = gruppi[kk], fm = f[g.forma];
      if (!fm || fm.tipo !== 'tracciato' || !fm.sub[g.sub]) return;
      var sb = fm.sub[g.sub], n = sb.nodi, m = n.length;
      var ks = g.ks.slice().sort(function (a, b) { return a - b; });

      if (sb.chiuso && ks.length >= m) {
        subs.push({ nodi: n.map(cpNodo), chiuso: true });
        return;
      }
      var cur = null, prima = null;
      ks.forEach(function (k) {
        if (cur && prima === k - 1) cur.nodi.push(cpNodo(n[(k + 1) % m]));
        else {
          if (cur) subs.push(capi(cur));
          cur = { nodi: [cpNodo(n[k]), cpNodo(n[(k + 1) % m])], chiuso: false };
        }
        prima = k;
      });
      if (cur) subs.push(capi(cur));
    });
    return subs.length ? [Tracciato.tracciato(subs)] : [];
  }

  function raccogli() {
    var f = forme();
    if (!f) return null;
    if (sel.segmenti.length) {
      var t = daiSegmenti(f, sel.segmenti);
      return t.length ? t : null;
    }
    var gruppo = sel.forme.length ? sel.forme : (sel.forma >= 0 ? [sel.forma] : []);
    var out = [];
    gruppo.forEach(function (i) {
      if (f[i]) out.push(JSON.parse(JSON.stringify(f[i])));
    });
    return out.length ? out : null;
  }

  function quanti(n, uno, tanti) {
    return n === 1 ? uno : n + ' ' + tanti;
  }

  function copia(tagliando) {
    if (!forme()) return;
    if (!attivoVisibile()) {
      Log.add('err', 'Questo livello è nascosto: accendi il suo occhio prima ' +
                     'di prenderci qualcosa.');
      return;
    }
    var r = raccogli();
    if (!r) {
      Log.add('err', 'Non c\'è niente di scelto: clicca un tratto, o tienine ' +
                     'premuto Ctrl per sommarne altri.');
      return;
    }
    var da = Artwork.mappa();
    if (!da) {
      Log.add('err', 'Questo livello non ha ancora una posizione sul foglio: ' +
                     'non saprei dove rimettere quello che prendo.');
      return;
    }
    appunti = {
      forme: r,
      da: da,
      daLiv: Artwork.sceltoId(),
      che: sel.segmenti.length
        ? quanti(sel.segmenti.length, 'un tratto', 'tratti')
        : quanti(sel.forme.length || 1, 'una forma', 'forme')
    };
    if (tagliando) elimina();
    Log.add('msg', (tagliando ? 'Via dal livello e negli appunti: '
                              : 'Negli appunti: ') + appunti.che +
                   '. Scegli il livello e premi Ctrl+V: il posto sul foglio ' +
                   'non cambia.');
    aggiornaBarra();
  }

  function incolla() {
    if (!appunti) {
      Log.add('err', 'Gli appunti sono vuoti: scegli qualcosa e premi Ctrl+C ' +
                     '(o Ctrl+X per portarlo via di qui).');
      return;
    }
    if (!forme()) return;
    if (!attivoVisibile()) {
      Log.add('err', 'Questo livello è nascosto: accendi il suo occhio prima ' +
                     'di metterci qualcosa.');
      return;
    }
    var f = forme(), prima = f.length;
    segna();
    var n = Artwork.incolla(appunti.forme, appunti.da);
    if (!n) {
      /* Niente è cambiato: l'istantanea appena presa sarebbe un passo
         indietro che non riporta indietro niente. */
      storia.pop();
      aggiornaStorici();
      Log.add('err', 'Non sono riuscito a collocare quello che c\'era negli ' +
                     'appunti: questo livello ha già dentro qualcosa ma non ha ' +
                     'una posizione sul foglio.');
      return;
    }

    /* Quello che è appena arrivato resta SCELTO: è l'unico modo di
       accorgersi subito se è finito dove si voleva, e di spostarlo se no. */
    sel.forme = [];
    for (var i = prima; i < prima + n; i++) sel.forme.push(i);
    sel.forma = prima;
    sel.sub = -1; sel.nodo = -1; sel.maniglia = null; sel.segmenti = [];

    var l = (Artwork.livelli() || []).filter(function (x) { return x.principale; })[0];
    var stesso = appunti.daLiv === Artwork.sceltoId();
    cambiato();
    Log.add('msg', 'Incollato nel livello «' + (l ? l.nome : '—') + '»: ' +
            appunti.che + ', nello stesso posto sul foglio.' +
            (stesso ? ' È lo stesso livello da cui venivano, quindi la copia ' +
                      'sta esattamente sopra l\'originale: spostala, o dal ' +
                      'foglio sparirà come tratto doppio.' : ''));
  }

  /* Taglia e copia valgono se c'è qualcosa di scelto, incolla se gli appunti
     non sono vuoti. Un pulsante che si può premere e non fa niente è un
     pulsante che insegna a non fidarsi dei pulsanti. */
  function aggiornaBarra() {
    var vivo = !!forme() && attivoVisibile();
    var ha = vivo && !!(sel.segmenti.length || sel.forme.length || sel.forma >= 0);
    var b = document.getElementById('ed-taglia');
    if (b) b.disabled = !ha;
    b = document.getElementById('ed-copia');
    if (b) b.disabled = !ha;
    b = document.getElementById('ed-incolla');
    if (b) {
      b.disabled = !appunti || !vivo;
      b.title = appunti
        ? 'Ctrl+V — ' + appunti.che + ' dagli appunti, in questo livello e ' +
          'nello stesso posto sul foglio'
        : 'Ctrl+V — gli appunti sono vuoti';
    }
  }

  function doppio(e) {
    if (strumento === 'spezzata') { finisciSpezzata(); return; }
    if (strumento !== 'scegli') return;

    /* UN NODO NUOVO, E SUL TRATTO GIUSTO.
     *
     * Se c'è un tratto scelto, il nodo va LI' DENTRO, nel punto del tratto
     * più vicino al puntatore. Prima si cercava ogni volta il tratto più
     * vicino al clic su tutto il disegno, e ne venivano due guai, tutti e
     * due segnalati usandolo:
     *
     *   — vicino a uno spigolo vinceva a volte il lato accanto, e il nodo
     *     cascava a un pelo dal vertice: un segmento lungo zero virgola
     *     niente, che non si vede e non si prende più;
     *   — dove due linee si incrociano vinceva quella sotto, e il nodo
     *     finiva su un tratto che non era quello su cui si stava lavorando.
     *
     * Un tratto scelto è una risposta che l'operatore ha già dato: usarla è
     * più giusto che indovinare di nuovo.
     */
    var p = punto(e), u = perPixel();

    var h = nodoSotto(p, u);
    if (h && !h.maniglia) {
      sel.sub = h.sub; sel.nodo = h.nodo;
      commutaNodo();
      return;
    }

    var f = forme(), dove, sub, t;

    if (sel.segmenti.length === 1) {
      var sg = sel.segmenti[0];
      var fm = f[sg.forma];
      sub = fm && fm.tipo === 'tracciato' ? fm.sub[sg.sub] : null;
      if (!sub) return;
      var n = sub.nodi;
      var a = n[sg.k], b = n[(sg.k + 1) % n.length];
      if (!a || !b) return;

      /* Il punto del tratto più vicino al puntatore, cercato nel parametro
         della cubica: su una curva la proiezione sulla corda sarebbe
         altrove. */
      var c = cubicaDi(a, b), meglio = null;
      for (var j = 1; j < 48; j++) {
        var tt = j / 48, q = valuta(c, tt);
        var d = Math.hypot(p.x - q.x, p.y - q.y);
        if (!meglio || d < meglio.d) meglio = { d: d, t: tt, q: q };
      }

      /* Troppo vicino a un capo non si aggiunge niente: ne verrebbe un
         segmento lungo quasi zero, che è esattamente il guaio da cui si sta
         scappando. */
      if (Math.hypot(meglio.q.x - a.x, meglio.q.y - a.y) < 4 * u ||
          Math.hypot(meglio.q.x - b.x, meglio.q.y - b.y) < 4 * u) {
        Log.add('err', 'Troppo vicino a un capo del tratto: ne verrebbe un ' +
                       'segmento lungo quasi zero. Clicca più verso il mezzo.');
        return;
      }

      segna();
      dove = sg.k + 1;
      sub.nodi.splice(dove, 0, Tracciato.nodo(meglio.q.x, meglio.q.y));
      sel.forma = sg.forma; sel.forme = [sg.forma];
      sel.sub = sg.sub; sel.nodo = dove;
      sel.segmenti = [];
      cambiato();
      return;
    }

    /* Niente di scelto: si cerca come si è sempre fatto, sul disegno. */
    t = sotto(p, u);
    if (!t || t.sub < 0) return;
    sub = f[t.forma].sub[t.sub];
    segna();
    dove = Math.max(1, Math.min(sub.nodi.length - 1, Math.round(t.k - 1 + t.t) + 1));
    sub.nodi.splice(dove, 0, Tracciato.nodo(t.punto.x, t.punto.y));
    sel.forma = t.forma; sel.forme = [t.forma]; sel.sub = t.sub; sel.nodo = dove;
    sel.segmenti = [];
    cambiato();
  }

  /* Il passo scritto nella barra, in millimetri del foglio. Cinque quando
     il campo non dice niente di sensato: una griglia da zero non è una
     griglia. */
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
     ed è una cosa sola — e dal 27 ottobre spegne anche quello su cui si sta
     lavorando, perché un interruttore che a volte non spegne è peggio di
     uno che manca. */
  function renderLivelli() {
    var box = document.getElementById('ed-livelli');
    if (!box || !window.Artwork) return;

    /* TUTTI I FOGLI E TUTTI I LIVELLI, dal 2026-11-08.
     *
     * Fino a quel giorno qui si vedevano solo i livelli del foglio in uso,
     * e il ragionamento era: «passare a un livello di un altro foglio e'
     * cambiare foglio, e lo si fa dal piano». Detto dall'operatore: «nella
     * tab edit non vedo la lista dei fogli... ci sono sempre tutti i fogli e
     * tutti i livelli». Ha ragione, e il motivo e' che in questa tab ci si
     * sta dentro: uscire per cambiare foglio e poi rientrare e' una strada
     * lunga per una cosa che l'elenco puo' dire da se'. Il foglio si vede
     * comunque, perche' ogni gruppo ha la sua intestazione — che e' quello
     * che mancava, non il filtro.
     *
     * Cliccando un livello di un altro foglio, il foglio in uso lo segue:
     * lo fa `Artwork.seleziona`, che tiene d'accordo il livello scelto e il
     * foglio, perche' l'editor lavora nelle coordinate di UN foglio.
     */
    var ls = Artwork.livelli();
    if (!ls.length) { box.innerHTML = ''; return; }

    var piuFogli = State.data.fogli.length > 1;
    var inUso = State.data.foglioAttivo;
    var out = '';

    /* ANCHE I FOGLI VUOTI, dal 2026-11-08, e per la stessa ragione di la':
       un foglio senza niente sopra e' quello su cui si vuole trascinare un
       livello, e se non ha una riga non c'e' niente su cui lasciarlo. Il
       conto delle posizioni e il perche' stanno in `renderElenco` di
       js/artwork.js, che fa lo stesso elenco per la tab Disegno. */
    var ordine = [];
    if (!piuFogli) {
      ls.forEach(function (x, i) { ordine.push({ liv: i }); });
    } else {
      var num = {};
      State.data.fogli.forEach(function (f, k) { num[f.id] = k; });
      var suo = ls.map(function (x) {
        var k = num[x.foglio || inUso];
        return k === undefined ? Infinity : k;
      });
      State.data.fogli.forEach(function (f, k) {
        var suoi = [], prima = 0;
        suo.forEach(function (q, i) {
          if (q === k) suoi.push(i);
          if (q < k) prima++;
        });
        ordine.push({ testa: f.id, pos: suoi.length ? suoi[0] : prima,
                      vuoto: !suoi.length });
        suoi.forEach(function (i) { ordine.push({ liv: i }); });
      });
      suo.forEach(function (q, i) { if (q === Infinity) ordine.push({ liv: i }); });
    }

    /* `data-pos` e `data-fog` sono per il trascinamento, e sono gli stessi
       dell'elenco della tab Disegno: `Artwork.riordinabile` lavora su quelli
       e non sa ne' vuole sapere in quale dei due elenchi sta guardando.
       `data-pos` e' la posizione nell'elenco INTERO, che e' anche l'ordine
       di stampa: per questo qui si ciclano tutti i livelli. */
    ordine.forEach(function (voce) {
      if (voce.testa) {
        var tf = voce.testa;
        var f = Fogli.trova(tf);
        var n = Fogli.indice(tf) + 1;
        var eti = f ? (f.name && f.name !== 'Personalizzato'
                        ? f.name : f.w + ' × ' + f.h) : '?';
        out += '<div class="ed-foglio' + (tf === inUso ? ' in-uso' : '') +
               (voce.vuoto ? ' vuoto' : '') +
               '" data-ed-testa="' + esc(tf) + '" data-pos="' + voce.pos +
               '" data-fog="' + esc(tf) + '" title="Foglio ' + n + ' — ' +
               esc(eti) + (voce.vuoto ? ', senza niente sopra' : '') +
               '. Clicca per lavorare su questo foglio; trascina ' +
               'qui un livello per spostarcelo; due clic per rinominarlo.">' +
               'foglio ' + n + ' · ' + esc(eti) +
               (voce.vuoto ? '<span class="ed-foglio-vuoto">vuoto</span>' : '') +
               '</div>';
        return;
      }
      var i = voce.liv;
      var l = ls[i];
      var fid = l.foglio || inUso;
      out += '<div class="ed-liv' + (l.principale ? ' attivo' : '') +
             (l.visibile ? '' : ' spento') + '" data-pos="' + i +
             '" data-fog="' + esc(fid) + '">' +
             '<span class="ed-presa" data-presa="' + l.id +
             '" title="Trascina per cambiare l\'ordine di stampa, o per ' +
             'portarlo su un altro foglio">' + SEGNI_PRESA + '</span>' +
             '<button type="button" class="ed-liv-nome" data-ed-liv="' + l.id +
             '" title="' + esc(l.nome) + ' — ' +
             (l.principale ? 'e` questo che stai modificando'
                           : 'clicca per modificare questo') +
             '. Due clic: rinomina.">' +
             esc(l.nome) + '</button>' +
             '<button type="button" class="liv-ic" data-ed-occhio="' + l.id +
             '" title="' + (l.visibile ? 'Nascondi' : 'Mostra') + '">' +
             (l.visibile ? SEGNI_OCCHIO : SEGNI_CHIUSO) + '</button>' +
             '</div>';
    });
    box.innerHTML = out;
  }

  /* Gli stessi segni della tab Disegno. Ripetuti e non importati: sono
     tre stringhe, e un modulo che per disegnare un occhio deve chiamarne un
     altro è un legame che costa più di quello che risparmia. */
  var SEGNI_PRESA =
    '<svg viewBox="0 0 10 14"><circle cx="3" cy="3" r="1.1"/><circle cx="7" cy="3" r="1.1"/>' +
    '<circle cx="3" cy="7" r="1.1"/><circle cx="7" cy="7" r="1.1"/>' +
    '<circle cx="3" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>';
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
  /* SI SCEGLIE QUESTO E BASTA, dal 2026-11-08. Prima il clic qui dentro
     AGGIUNGEVA alla selezione della tab Disegno (`seleziona(id,
     'aggiungi')`): passando da un livello all'altro per modificarli si
     costruiva una selezione multipla senza chiederla, e le spunte di la'
     finivano per dire una cosa che nessuno aveva scelto. Detto
     dall'operatore: le spunte servono al riquadro di selezione, non a dire
     che cosa si modifica. `seleziona(id)` senza modo sostituisce la
     selezione, e porta con se' il foglio in uso. */
  function cambiaLivello(id) {
    if (!window.Artwork || id === Artwork.sceltoId()) return;
    Artwork.seleziona(id);
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

  /* UN LIVELLO NUOVO, DA QUI.
   *
   * A CHE COSA SERVE: un file importato è diviso per tinte, e la tinta è il
   * modo in cui chi l'ha fatto ha detto cosa va insieme. Modificandolo si
   * scopre di volere un'altra divisione — i testi di un biglietto da
   * sistemare senza toccare la cornice — e per averla serve un livello dove
   * mettere quello che si stacca. Prima l'unico modo di farne uno era
   * svuotare la selezione nella tab Disegno e premere «Crea», che apre una
   * tela vuota: si usciva dal disegno per poterlo dividere.
   *
   * NASCE VUOTO E ACCANTO A QUELLO CHE SI STA MODIFICANDO, da cui copia la
   * mappa (vedi Artwork.nuovo): così la tela continua a mostrare il disegno
   * intero dietro, e quello che ci si incolla dentro resta dov'era sul
   * foglio. Diventa subito quello che si modifica, perché il gesto dopo è
   * sempre un Ctrl+V.
   *
   * IL NOME è «livello N» e non il nome del file: un livello fatto a mano non
   * viene da nessun file, e chiamarlo come il file direbbe una cosa falsa a
   * chi lo rilegge domani. Si rinomina dalla tab Disegno.
   */
  function nuovoLivello() {
    if (!window.Artwork) return;
    var ls = Artwork.livelli() || [];
    var n = ls.length + 1;
    /* Un nome già usato non è un errore ma è una confusione: due righe
       identiche nell'elenco e nessun modo di sapere quale è quale. */
    while (ls.some(function (x) { return x.nome === 'livello ' + n; })) n++;

    var id = Artwork.nuovo('livello ' + n, Artwork.sceltoId());
    attivo = id;
    storia = storie[id] || (storie[id] = []);
    rifare = rifari[id] || (rifari[id] = []);
    nessunaForma();
    costruendo = null;
    aggiornaStorici();
    renderLivelli();
    if (titolo) titolo.textContent = 'livello ' + n;
    disegna();
    scriviPiede();
    aggiornaBarra();
    Log.add('msg', 'Livello «livello ' + n + '» creato, vuoto, e adesso si ' +
            'modifica lui. Per portarci dentro un pezzo dell\'altro: torna ' +
            'sull\'altro, scegli i tratti, Ctrl+X, torna qui, Ctrl+V — sul ' +
            'foglio non si muove niente, cambia solo la penna che li disegna.');
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
    aggiornaBarra();
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
      else if (b.id === 'ed-taglia') copia(true);
      else if (b.id === 'ed-copia') copia(false);
      else if (b.id === 'ed-incolla') incolla();
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
      else if (b.id === 'ed-specchia') specchia();
      else if (b.id === 'ed-ruota') ruota();
      else if (b.id === 'ed-scala') scala();
      else if (b.id === 'ed-specchio-asse') {
        specchioAsse = specchioAsse === 'v' ? 'o' : 'v';
        b.textContent = specchioAsse === 'v' ? '\u2194' : '\u2195';
        b.title = specchioAsse === 'v'
          ? 'Asse verticale: ribalta destra-sinistra. Clicca per cambiarlo.'
          : 'Asse orizzontale: ribalta sopra-sotto. Clicca per cambiarlo.';
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

    /* LA PINZATA. La tela si ingrandisce con la rotella, e su un tablet la
       rotella non c'e': senza questo gesto, da un iPad l'editor si guarda da
       dove capita. Stesso modulo del piano, cosi' l'aritmetica
       dell'ancoraggio sta in un posto solo.
       I limiti qui sono piu' larghi che sul piano, perche' la tela non e' un
       foglio: ci si lavora anche su un nodo solo. */
    if (window.Tocco) {
      Tocco.pizzica(svg, {
        leggi: function () { if (!vista) adatta(); return vista; },
        scrivi: function (f) { vista = f; applica(); },
        dove: function (cx, cy) { return punto({ clientX: cx, clientY: cy }); },
        minimo: function () { return 0.5; },
        massimo: function () { return 10000; }
      });
    }

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
      /* Ctrl+X, Ctrl+C, Ctrl+V. Sono i nostri appunti e non quelli del
         sistema: quello che viaggia qui sono forme con le loro maniglie e il
         livello da cui vengono, cioè roba che negli appunti del sistema non
         saprebbe come stare. */
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && 'xcv'.indexOf(e.key.toLowerCase()) >= 0) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'v') incolla();
        else copia(e.key.toLowerCase() === 'x');
        return;
      }
      if (e.key === 'Escape') { chiudiCostruzione(true); scegliStrumento('scegli'); }
      else if (e.key === 'Enter') finisciSpezzata();
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); elimina(); }
    });

    var elenco = document.getElementById('ed-livelli');
    if (elenco) {
      /* Trascinare anche da qui: lo stesso meccanismo dell'elenco della tab
         Disegno, sulle stesse `data-pos`/`data-fog`. Chiesto
         dall'operatore — «anche qui spostabili di ordine e tra fogli». */
      if (window.Artwork && Artwork.riordinabile) Artwork.riordinabile(elenco);

      elenco.addEventListener('click', function (e) {
        /* L'INTESTAZIONE DEL FOGLIO VA GUARDATA PRIMA del pulsante: non e'
           un pulsante, e' un `div`, quindi `closest('button')` qui sotto
           tornerebbe null e il clic finirebbe nel nulla. Un clic porta a
           lavorare su quel foglio, due lo rinominano — come nella tab
           Disegno. */
        var te = e.target.closest('[data-ed-testa]');
        if (te) {
          if (window.Nome && Nome.doppio('fog:' + te.dataset.edTesta) && window.Paper) {
            Paper.rinominaFoglio(te.dataset.edTesta);
          } else {
            Fogli.scegli(te.dataset.edTesta);
          }
          return;
        }
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.edLiv) {
          /* Due clic sul nome: si rinomina. Qui dentro si passa il tempo a
             modificare, ed è qui che ci si accorge che «antei.svg · tratto
             #1f4fa8» non si capisce più: la rinomina deve stare dove nasce
             il bisogno. Vedi `Nome.doppio` per il perché si contano a mano. */
          if (window.Nome && Nome.doppio('liv:' + b.dataset.edLiv)) {
            Artwork.rinominaLivello(b.dataset.edLiv);
          } else {
            cambiaLivello(b.dataset.edLiv);
          }
        }
        else if (b.dataset.edOcchio) {
          Artwork.commutaVisibile(b.dataset.edOcchio);
          renderLivelli();
          disegna();
          scriviPiede();
        }
      });
    }

    var piu = document.getElementById('ed-liv-nuovo');
    if (piu) piu.addEventListener('click', nuovoLivello);

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
           /* Per il collaudo: il lazo e lo specchio senza passare dal mouse. */
           lazo: prendiDentro,
           scegliForma: function (i) {
             sel.forma = i; sel.forme = [i];
             sel.sub = -1; sel.nodo = -1; sel.maniglia = null; sel.segmenti = [];
             disegna();
           },
           specchia: specchia, ruota: ruota, scala: scala,
           /* Chi rinomina un livello da fuori (la tab Disegno) deve poter
              far ridisegnare questa colonna: il nome sta anche qui. */
           rinfresca: function () {
             renderLivelli();
             var l = Artwork.livelli().filter(function (x) { return x.principale; })[0];
             if (titolo) titolo.textContent = l ? l.nome : '';
           },
           asseSpecchio: function (v) {
             if (v !== undefined) specchioAsse = (v === 'o') ? 'o' : 'v';
             return specchioAsse;
           },
           annulla: annulla, rifai: rifai,
           copia: copia, incolla: incolla,
           appunti: function () { return appunti ? appunti.che : null; },
           magneti: function (v) {
             if (v !== undefined) {
               magneti = !!v;
               var b = document.getElementById('ed-magneti');
               if (b) b.classList.toggle('attivo', magneti);
             }
             return magneti;
           } };
})();
