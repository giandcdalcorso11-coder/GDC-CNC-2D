/* Il piano della macchina e il foglio che ci sta sopra.
 *
 * L'area di lavoro è fissa: è la corsa degli assi, e non cambia quando si
 * cambia formato di carta. È il riquadro che si vede al centro, e riempie
 * sempre tutto lo spazio disponibile. Il foglio è un rettangolo disegnato
 * dentro quell'area, nella posizione in cui sta davvero sulla macchina.
 *
 * Questa distinzione non è estetica: mostra quanta corsa avanza attorno al
 * foglio, che è ciò che dice se un disegno ci sta o manda il carrello in
 * battuta.
 *
 * Tutte le coordinate dentro l'SVG sono in millimetri, grazie alla viewBox,
 * e un gruppo ribalta l'asse Y: in SVG cresce verso il basso, sulla macchina
 * verso l'alto. Senza quel ribaltamento ogni disegno uscirebbe specchiato.
 */
var Paper = (function () {
  var svg, flip, caption, layerBed, layerSheet, layerTrace, layerStop, layerSegni;

  /* LA FINESTRA SUL PIANO, quando l'operatore l'ha mossa lui.
     `null` vuol dire «adattata», cioè ricalcolata da vista() a ogni cambio di
     foglio o di area. Appena si usa la rotella o si trascina il fondo diventa
     un rettangolo suo, e da lì in poi comanda quello: un ingrandimento che si
     annulla da solo perché nel frattempo è cambiato un margine sarebbe peggio
     di non averlo. */
  var finestra = null;

  var FORMATI = { A4: [210, 297], A5: [148, 210], A6: [105, 148] };

  /* LE CARTE CHE SI COMPRANO, per nome.
     Non è una tavolozza: sono i fogli che stanno in casa, e i valori sono
     NOMINALI come quelli delle penne — servono a riconoscere la risma a colpo
     d'occhio sull'anteprima, non a riprodurre la carta. Tutte le altre tinte
     si prendono dal selettore del sistema, nella stessa finestrella. */
  var CARTE = [
    { nome: 'bianca',  colore: '#f7f5f0' },
    { nome: 'avorio',  colore: '#efe6d2' },
    { nome: 'kraft',   colore: '#c49a6c' },
    { nome: 'grigia',  colore: '#b8b5ae' },
    { nome: 'celeste', colore: '#cfe0ef' },
    { nome: 'nera',    colore: '#1d1d1b' }
  ];

  /* Quanto è chiara una tinta, da 0 a 1, con i pesi della percezione: il
     verde conta sei volte il blu. Serve due volte, e per due motivi diversi:
     a dare il bordo giusto a un foglio scuro — su un piano scuro un foglio
     nero senza bordo chiaro non è un foglio, è un buco — e a dire se una
     penna si distinguerà dalla carta. */
  function chiarezza(hex) {
    var c = String(hex || '').replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    if (c.length !== 6) return 1;
    var v = [0, 2, 4].map(function (i) {
      var x = parseInt(c.substr(i, 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }

  /* Il nome della carta, quando è una di quelle in elenco. Un esadecimale in
     didascalia non dice niente a chi guarda il piano: «carta kraft» sì. */
  function nomeCarta(hex) {
    var h = String(hex || '').toLowerCase();
    for (var i = 0; i < CARTE.length; i++) {
      if (CARTE[i].colore.toLowerCase() === h) return CARTE[i].nome;
    }
    return h;
  }

  /* Il colore della carta che si ha sotto adesso. Non è tenuto in una
     variabile di questo file: la risma vive nel profilo, e una seconda copia
     qui sarebbe la solita coppia di valori che prima o poi non coincidono. */
  function colore() { return coloreDi(State.data.paper); }

  /* La carta di un foglio qualunque. Il padrone del dato resta il profilo,
     che la tiene per MISURA di foglio: due A6 sul piano sono due fogli ma
     una risma sola, e dichiararne uno avorio e l'altro no vorrebbe dire
     sostenere che la stessa carta è di due colori. */
  function coloreDi(f) {
    return Profile.coloreFoglioEffettivo(f.w, f.h);
  }

  /* IL CONTRASTO FRA DUE TINTE secondo il WCAG. Una penna e una carta che
     stanno sotto 1.6 sul foglio vero danno un disegno che non si legge:
     non è un problema dell'anteprima, è un problema della stampa, e per
     questo l'avviso lo dà l'elenco dei livelli e non questo file. */
  function contrasto(a, b) {
    var x = chiarezza(a), y = chiarezza(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function nomeFormato(w, h) {
    for (var k in FORMATI) {
      if (FORMATI[k][0] === w && FORMATI[k][1] === h) return k;
      if (FORMATI[k][1] === w && FORMATI[k][0] === h) return k + ' orizzontale';
    }
    /* Anche i fogli dell'operatore hanno un nome, e va usato: la didascalia
       sotto il piano dice «foglio Personalizzato» solo quando davvero non ha
       un nome, non ogni volta che non è un formato ISO. */
    var l = Profile.formati();
    for (var i = 0; i < l.length; i++) {
      if (l[i].larghezza === w && l[i].altezza === h) return l[i].nome;
      if (l[i].altezza === w && l[i].larghezza === h) return l[i].nome + ' orizzontale';
    }
    return 'Personalizzato';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  /* --------------------------- il piano --------------------------- */

  /* LA FINESTRA SUL PIANO, che non coincide con l'area di lavoro.
     Un foglio più grande della corsa sporge per forza, e quello che sporge
     deve vedersi: se la vista fosse l'area e basta, la parte fuori sarebbe
     tagliata — invisibile e, siccome l'SVG non disegna quello che sta fuori
     dalla viewBox, nemmeno afferrabile col mouse.

     Il margine dipende da QUANTO il foglio è più grande, non da dove si trova:
     deve restare fermo mentre lo si trascina. Una vista che si allarga a ogni
     movimento del mouse cambia la scala sotto il cursore, e il foglio sembra
     scappare dalla mano. */
  function vista() {
    var a = State.data.area, p = State.data.paper;
    var mx = Math.max(6, p.w - a.w + 6);
    var my = Math.max(6, p.h - a.h + 6);
    var v = { x0: -mx, y0: -my, w: a.w + 2 * mx, h: a.h + 2 * my };

    /* La tavola, quando si sa dov'è, entra nella vista adattata: è il pezzo
       più grande di tutti e mostrarne metà non servirebbe a niente. Costa
       spazio all'area di lavoro, che diventa più piccola sullo schermo — per
       quello c'è la rotella. */
    var t = Profile.tavolaRect();
    if (t) {
      var s = svgRect(t);
      var x0 = Math.min(v.x0, s.x0 - 6), y0 = Math.min(v.y0, s.y0 - 6);
      var x1 = Math.max(v.x0 + v.w, s.x0 + s.w + 6);
      var y1 = Math.max(v.y0 + v.h, s.y0 + s.h + 6);
      v = { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0 };
    }
    return v;
  }

  /* Dal rettangolo in coordinate MACCHINA a quello in coordinate dell'SVG.
     Non serve per disegnare — il gruppo ribaltato ci pensa da sé — ma serve
     per la vista, che vive in coordinate SVG e non passa da quel gruppo. */
  function svgRect(r) {
    var a = State.data.area;
    return { x0: r.x0, y0: a.h - (r.y0 + r.h), w: r.w, h: r.h };
  }

  /* Il rettangolo che si sta guardando: quello scelto a mano, o l'adattato. */
  function finestraCorrente() { return finestra || vista(); }

  function applicaVista() {
    var v = finestraCorrente();
    svg.setAttribute('viewBox', v.x0 + ' ' + v.y0 + ' ' + v.w + ' ' + v.h);
    var b = document.getElementById('btn-fit');
    if (b) b.hidden = !finestra;

    /* I segni dello zero e del punto home sono disegnati in millimetri ma
       devono valere sempre gli stessi pixel: cambiata la vista, vanno
       rifatti. */
    renderSegni();

    /* Chi disegna in pixel sopra al piano — i righelli, le maniglie della
       selezione — deve rifare i conti adesso: la stessa distanza sullo
       schermo adesso vale un altro numero di millimetri. Lo si annuncia
       invece di chiamarli uno per uno, così aggiungerne un terzo non vuol
       dire tornare qui. */
    State.emit('vista');
  }

  function adatta() {
    finestra = null;
    applicaVista();
  }

  function renderBed() {
    var a = State.data.area;
    applicaVista();
    /* IL RIBALTAMENTO NON DIPENDE DALLA FINESTRA e non deve dipenderne: dice
       dove cade la y zero della macchina dentro il sistema di coordinate
       dell'SVG, e quel legame non cambia perché si ingrandisce o si sposta lo
       sguardo. Ricalcolarlo dalla finestra farebbe scorrere il disegno sotto
       la finestra mentre la finestra scorre sul disegno: il doppio del
       movimento, nel verso sbagliato. */
    flip.setAttribute('transform', 'translate(0,' + a.h + ') scale(1,-1)');

    /* TRE RETTANGOLI, dal più grande al più piccolo, e sono tre domande
       diverse: dove c'è legno, dove si può posare il foglio, dove la punta
       arriva. Si disegnano in quest'ordine perché il più piccolo deve restare
       sopra, e perché è l'ordine in cui si guardano. */
    var out = '';

    var tav = Profile.tavolaRect();
    if (tav) {
      out += '<rect class="tavola" x="' + tav.x0 + '" y="' + tav.y0 +
             '" width="' + tav.w + '" height="' + tav.h + '" rx="2"></rect>';
    }

    var app = Profile.appoggioRect();
    if (app) {
      out += '<rect class="appoggio" x="' + app.x0 + '" y="' + app.y0 +
             '" width="' + app.w + '" height="' + app.h + '"></rect>';
    }

    out += '<rect class="bed" x="0" y="0" width="' + a.w + '" height="' + a.h + '"></rect>';

    /* Reticolo ogni 10 mm, più marcato ogni 50: dà la scala a colpo d'occhio
       e rende evidente se un disegno è fuori misura. */
    var x, y;
    for (x = 0; x <= a.w; x += 10) {
      out += '<line class="grid' + (x % 50 === 0 ? ' grid-major' : '') +
             '" x1="' + x + '" y1="0" x2="' + x + '" y2="' + a.h + '"></line>';
    }
    for (y = 0; y <= a.h; y += 10) {
      out += '<line class="grid' + (y % 50 === 0 ? ' grid-major' : '') +
             '" x1="0" y1="' + y + '" x2="' + a.w + '" y2="' + y + '"></line>';
    }

    /* Lo zero macchina: è l'angolo da cui si misura tutto. */
    out += '<line class="axis axis-x" x1="0" y1="0" x2="' + Math.min(30, a.w) + '" y2="0"></line>';
    out += '<line class="axis axis-y" x1="0" y1="0" x2="0" y2="' + Math.min(30, a.h) + '"></line>';

    layerBed.innerHTML = out;
    renderSegni();
  }

  /* Quanti millimetri vale un pixel adesso: serve ai segni, che sono
     indicazioni e non disegno, e devono restare della stessa taglia sullo
     schermo a qualsiasi ingrandimento. */
  function mmPerPixel() {
    var m = flip.getScreenCTM();
    return m && m.a ? 1 / Math.abs(m.a) : 0.1;
  }

  /* I DUE PUNTI CHE NON VANNO CONFUSI.
   *
   * Lo ZERO è l'angolo ai blocchi: è da lì che si misura tutto, ed è dove si
   * azzera a mano con il `G92`. Il PUNTO HOME sta cinque millimetri dentro,
   * ed è dove la macchina va a riposo — a fine programma, dopo
   * un'interruzione, dopo un cambio penna. Non finirci sopra con lo zero è
   * voluto: un carrello lasciato appoggiato al riferimento prima o poi lo
   * sposta.
   *
   * Averli tutti e due sul piano serve a capire di quanto il foglio è
   * spostato rispetto all'uno e all'altro, che a occhio sono cinque
   * millimetri e si confondono.
   *
   * La casetta è disegnata con la y che cresce verso l'alto, come tutto
   * dentro al gruppo ribaltato: lì «in su» è già +y, e non serve
   * contro-ribaltare niente. */
  function renderSegni() {
    if (!layerSegni) return;
    var u = mmPerPixel();
    var h = Profile.puntoHome();
    var out = '';

    /* Lo zero: un cerchietto sull'incrocio dei due assi, che già ci sono. */
    out += '<circle class="segno-zero" cx="0" cy="0" r="' + (4 * u) + '"></circle>';

    if (h) {
      var k = 15 * u / 12;     // la casetta è alta 12 unità e deve valere 15 px
      out += '<g class="segno-home" transform="translate(' + h.x + ',' + h.y +
             ') scale(' + k + ')">' +
             '<polyline points="-7,5 0,12 7,5"></polyline>' +
             '<rect x="-5" y="0" width="10" height="6"></rect>' +
             '<rect x="-1.6" y="0" width="3.2" height="3.4"></rect>' +
             '</g>';
    }
    layerSegni.innerHTML = out;
  }

  /* --------------------------- il foglio -------------------------- */

  /* QUANTO DEL FOGLIO LA PENNA RAGGIUNGE: l'intersezione fra il foglio e la
     corsa. Con un foglio più grande dell'area è il numero che conta davvero —
     non «il foglio esce», che con un foglio così è sempre vero e non dice
     niente, ma «su questo foglio puoi disegnare in questo rettangolo, a tanti
     millimetri dal bordo sinistro e tanti dal basso». */
  function raggiungibile() {
    var a = State.data.area, p = State.data.paper, o = State.data.sheetOrigin;
    var x0 = Math.max(0, o.x), x1 = Math.min(a.w, o.x + p.w);
    var y0 = Math.max(0, o.y), y1 = Math.min(a.h, o.y + p.h);
    return {
      w: Math.max(0, x1 - x0),
      h: Math.max(0, y1 - y0),
      /* Da dove comincia, misurato sul FOGLIO: è il numero che si usa col
         righello sulla carta vera. */
      dax: x0 - o.x,
      day: y0 - o.y,
      sporge: o.x < 0 || o.y < 0 || o.x + p.w > a.w || o.y + p.h > a.h,
      piuGrande: p.w > a.w || p.h > a.h
    };
  }

  /* IL FOGLIO STA SULLA TAVOLA? È una domanda diversa da «la penna ci
     arriva»: qui non si parla di corsa ma di legno. Un foglio che esce
     dall'area di appoggio non è irraggiungibile, è appoggiato nel vuoto o
     contro la struttura — si piega, si solleva, e la punta ci scrive storto.
     Non è un errore della stessa famiglia e non si segnala con lo stesso
     colore.

     ATTENZIONE A NON LEGGERLO AL CONTRARIO: arrivare a filo del bordo
     inferiore non è un rischio da evitare, è il gesto giusto. Quel bordo è una
     BATTUTA fisica, e l'operatore ci spinge contro il foglio per posarlo
     dritto. L'avviso scatta solo quando il foglio va OLTRE, cioè quando sotto
     non ha più niente. */
  function fuoriAppoggio() {
    var ap = Profile.appoggioRect();
    if (!ap) return null;
    var p = State.data.paper, o = State.data.sheetOrigin, f = [];
    if (o.x < ap.x0)                 f.push('a sinistra di ' + (ap.x0 - o.x).toFixed(0));
    if (o.y < ap.y0)                 f.push('sotto di ' + (ap.y0 - o.y).toFixed(0));
    if (o.x + p.w > ap.x0 + ap.w)    f.push('a destra di ' + (o.x + p.w - ap.x0 - ap.w).toFixed(0));
    if (o.y + p.h > ap.y0 + ap.h)    f.push('sopra di ' + (o.y + p.h - ap.y0 - ap.h).toFixed(0));
    return f.length ? f : null;
  }

  /* --------------------- il piano con i fogli sopra ---------------------- */

  /* QUANTO DEL FOGLIO LA PENNA RAGGIUNGE, per un foglio qualunque: lo sa
     Fogli, che e' dove sta la geometria. Qui resta la versione senza
     argomenti, per il foglio in uso, perche' la chiamano i popup e la
     didascalia. */
  function raggiungibileDi(f) { return Fogli.raggiungibile(f.id); }

  function fuoriAppoggioDi(f) {
    var ap = Profile.appoggioRect();
    if (!ap) return null;
    var o = f.origine, l = [];
    if (o.x < ap.x0)                 l.push('a sinistra di ' + (ap.x0 - o.x).toFixed(0));
    if (o.y < ap.y0)                 l.push('sotto di ' + (ap.y0 - o.y).toFixed(0));
    if (o.x + f.w > ap.x0 + ap.w)    l.push('a destra di ' + (o.x + f.w - ap.x0 - ap.w).toFixed(0));
    if (o.y + f.h > ap.y0 + ap.h)    l.push('sopra di ' + (o.y + f.h - ap.y0 - ap.h).toFixed(0));
    return l.length ? l : null;
  }

  /* Le righe che spiegano un magnete, da disegnare finche' il dito e' giu'.
     Vuote quando non si sta trascinando niente. */
  var guide = [];

  function renderSheet() {
    var a = State.data.area;
    var attivo = State.data.paper;
    var html = '';

    State.data.fogli.forEach(function (f) {
      var o = f.origine;
      var r = raggiungibileDi(f);
      var vuoto = r.w <= 0 || r.h <= 0;
      var fa = fuoriAppoggioDi(f);
      /* IL COLORE È UNO STILE E NON UN ATTRIBUTO, come per i tratti: la
         regola `.sheet` nel foglio di stile vince su un attributo di
         presentazione, e il foglio sarebbe rimasto bianco qualunque carta
         si scegliesse. */
      var carta = coloreDi(f);
      var cl = 'sheet';
      if (chiarezza(carta) < 0.25) cl += ' sheet-scuro';
      /* Rosso solo quando c'è qualcosa da correggere. Un foglio più grande
         della corsa sporge per costruzione: segnarlo in rosso ogni volta
         vorrebbe dire un allarme sempre acceso, cioè un allarme che non si
         guarda più. */
      if (vuoto || (r.sporge && !r.piuGrande)) cl += ' sheet-out';
      if (fa) cl += ' sheet-giu';
      if (f.misurato) cl += ' sheet-fisso';
      if (f.id === attivo.id) cl += ' sheet-attivo';
      html += '<rect class="' + cl + '" data-foglio="' + esc(f.id) +
              '" style="fill:' + esc(carta) + '" x="' + o.x + '" y="' + o.y +
              '" width="' + f.w + '" height="' + f.h + '" rx="0.6"></rect>';

      /* IL RETTANGOLO RAGGIUNGIBILE, disegnato SOPRA la carta. Serve perché
         un foglio più grande della corsa copre il piano: il riquadro
         dell'area e il reticolo finiscono sotto il foglio, e senza questo
         segno non si vedrebbe più dove la penna arriva. */
      if (!vuoto && r.sporge) {
        html += '<rect class="reach" x="' + Math.max(0, o.x) + '" y="' +
                Math.max(0, o.y) + '" width="' + r.w + '" height="' + r.h +
                '"></rect>';
      }
    });

    /* Le righe dei magneti vanno sopra tutto: sono quelle che dicono PERCHÉ
       il foglio si è fermato lì, e sotto la carta non si vedrebbero. */
    guide.forEach(function (g) {
      html += '<line class="sheet-guida" x1="' + g.x1 + '" y1="' + g.y1 +
              '" x2="' + g.x2 + '" y2="' + g.y2 + '"></line>';
    });

    layerSheet.innerHTML = html;

    /* Un decimale: l'area è un numero CALCOLATO (corsa percorribile, cioè
       passi diviso rapporto), quindi ha tutti i decimali del mondo. Stamparli
       tutti non aggiunge informazione — la macchina non li sa fare: un passo
       vale tre centesimi. */
    var ra = raggiungibileDi(attivo), fa = fuoriAppoggioDi(attivo);
    var coda = '';
    if (ra.w <= 0 || ra.h <= 0) {
      coda = ' · il foglio è tutto fuori dalla corsa';
    } else if (ra.sporge) {
      coda = ' · la penna ne raggiunge ' + ra.w.toFixed(1) + ' × ' + ra.h.toFixed(1) +
             ' mm, da ' + ra.dax.toFixed(0) + ' mm dal bordo sinistro e ' +
             ra.day.toFixed(0) + ' dal basso';
    }
    if (fa) coda += ' · ESCE DALLA TAVOLA ' + fa.join(' e ') + ' mm';

    /* Quanti fogli ci sono si dice solo quando sono più d'uno: «1 foglio» è
       una parola in più da leggere ogni volta per non sapere niente. */
    var n = State.data.fogli.length;
    var quanti = n > 1 ? ' (' + n + ' fogli sul piano)' : '';

    /* Il nome della carta nella didascalia solo se è stato scelto: «carta
       bianca» su ogni foglio sarebbe una parola in più per non sapere
       niente di nuovo. */
    var dichiarato = Profile.coloreFoglio(attivo.w, attivo.h);
    caption.textContent =
      'Area ' + a.w.toFixed(1) + ' × ' + a.h.toFixed(1) + ' mm · foglio ' +
      attivo.name + ' ' + attivo.w + ' × ' + attivo.h + ' mm' + quanti +
      (dichiarato ? ', carta ' + nomeCarta(dichiarato) : '') + coda;
  }

  /* ------------------- l'elenco dei fogli, nella colonna ----------------- */

  function renderFogli() {
    var row = document.getElementById('fogli-row');
    if (!row) return;
    var l = State.data.fogli, attivo = State.data.paper.id;
    var html = '';
    l.forEach(function (f, i) {
      /* Un foglio tagliato a mano si chiama con le sue misure, non
         «Personalizzato»: nove magneti chiamati tutti Personalizzato sono
         nove etichette che non distinguono niente. */
      var misure = f.w + ' × ' + f.h;
      var vero = f.name && f.name !== 'Personalizzato';
      var nome = vero ? f.name : misure;
      /* Il foglio che ricava l'angolo da un altro lo dice, perché è la
         differenza fra «ti chiederò di misurarlo» e «no». Chi vede il
         numero degli angoli scendere mentre accosta i fogli capisce i
         magneti senza che nessuno glieli spieghi. */
      var sotto = f.aggancio
        ? '<small class="ricavato">↳ dal ' + (indiceDi(f.aggancio) + 1) + '</small>'
        : (vero ? '<small>' + misure + '</small>' : '');
      html += '<span class="foglio-wrap">' +
              '<button class="btn btn-ghost foglio' +
              (f.id === attivo ? ' is-attivo' : '') + '" data-foglio="' + esc(f.id) +
              '" title="' + esc(nome + ' — ' + f.w + ' × ' + f.h + ' mm' +
                 (f.aggancio ? ', angolo ricavato dal foglio ' +
                    (indiceDi(f.aggancio) + 1) : ', angolo da misurare')) + '">' +
              (i + 1) + '. ' + esc(nome) + sotto + '</button>';
      /* Il pulsante per togliere c'è solo quando c'è più di un foglio: su
         un foglio solo sarebbe un pulsante che non si può premere, cioè un
         pulsante che sembra rotto. */
      if (l.length > 1) {
        html += '<button class="btn btn-ghost foglio-via" data-foglio-via="' +
                esc(f.id) + '" title="Togli questo foglio">×</button>';
      }
      html += '</span>';
    });
    html += '<button class="btn btn-ghost preset-add" id="btn-foglio-add" ' +
            'title="Aggiungi un foglio delle misure qui sotto">+</button>';
    row.innerHTML = html;

    var nota = document.getElementById('fogli-nota');
    if (!nota) return;
    /* Prima del rientro anticipato: con un foglio solo «i fogli sono di
       carte diverse» non vuol dire niente, e la spunta va NASCOSTA — che è
       proprio il caso che un `return` messo sopra non farebbe mai. */
    var cd = document.getElementById('carte-diverse');
    if (cd) cd.hidden = l.length < 2;

    if (l.length < 2) { nota.textContent = ''; return; }

    var m = Fogli.daMisurare().length;
    var sovr = Fogli.sovrapposti().length;
    var fuori = Fogli.fuoriCorsa().length;
    nota.textContent =
      l.length + ' fogli, ' + (m === 1 ? 'UN angolo da misurare a inizio stampa'
                                       : m + ' angoli da misurare a inizio stampa') +
      (m < l.length ? ': gli altri sono accostati e il loro angolo si ricava.' : '.') +
      (sovr ? ' ATTENZIONE: ' + sovr + (sovr === 1 ? ' coppia si sovrappone.'
                                                   : ' coppie si sovrappongono.') : '') +
      (fuori ? ' ' + fuori + (fuori === 1 ? ' foglio esce' : ' fogli escono') +
               ' dalla corsa.' : '');
  }

  function indiceDi(id) { return Fogli.indice(id); }

  function apply() {
    /* Il nome del foglio lo fa il formato, SALVO che l'abbia scritto
       l'operatore: un foglio che si chiama «magnete Gioco» non deve tornare
       «75 × 75» perché la pagina si è ridisegnata. Vedi `nomeMio` in
       state.js e la rinomina qui sotto. */
    if (!State.data.paper.nomeMio) {
      State.data.paper.name = nomeFormato(State.data.paper.w, State.data.paper.h);
    }
    /* Il colore nello stato è una COPIA PER COMODITÀ di chi guarda — l'elenco
       dei livelli, che deve dire se la penna si vedrà su questa carta — e si
       riscrive qui a ogni giro, da Profile, perché una copia che si aggiorna
       da sola non può divergere. Il padrone del dato resta il profilo. */
    State.data.paper.colore = colore();
    markPreset();
    etichettaCentra();
    renderFogli();
    renderBed();
    renderSheet();
    rebuildPath();
    State.emit('paper');
  }

  /* L'area di lavoro non si digita: è la corsa percorribile dei due assi, e
     vive nel profilo macchina. Qui si rilegge e si ridisegna — la chiama la tab
     Impostazioni dopo aver cambiato una corsa, un margine o il rapporto.
     Tenerne una seconda copia dentro Paper sarebbe il modo sicuro per vederle
     divergere. */
  function refreshArea() {
    State.data.area = Profile.areaUtile();
    apply();
  }

  function setSize(w, h) {
    State.data.paper.w = w;
    State.data.paper.h = h;
    document.getElementById('paper-w').value = w;
    document.getElementById('paper-h').value = h;
    apply();
  }

  /* QUALE FORMATO È IN USO si decide dai dati, non dal markup. Prima la classe
     `is-active` era scritta a mano su A5 nell'HTML: giusta all'avvio e sbagliata
     subito dopo, perché nessuno la toglieva se il foglio arrivava da un profilo
     salvato.

     E riconosce il foglio RUOTATO: un A5 girato per il lungo è sempre un A5, e
     spegnere il pulsante appena si preme «Ruota foglio» vorrebbe dire dire che
     non si sa più che foglio si ha in mano. */
  function markPreset() {
    var w = State.data.paper.w, h = State.data.paper.h;
    var btns = document.querySelectorAll('.preset');
    for (var i = 0; i < btns.length; i++) {
      var bw = +btns[i].dataset.w, bh = +btns[i].dataset.h;
      btns[i].classList.toggle('is-active',
        (bw === w && bh === h) || (bw === h && bh === w));
    }
    aggiornaPiu();
  }

  /* Il «+» è acceso SOLO quando le misure non sono già un formato. Un pulsante
     che salva un doppione di A5 non serve a niente, e lasciarlo premibile
     significa riempire la riga di fogli identici con nomi diversi. */
  function aggiornaPiu() {
    var b = document.getElementById('btn-paper-add');
    if (!b) return;
    var nuovo = !document.querySelector('.preset.is-active');
    b.disabled = !nuovo;
    b.title = nuovo
      ? 'Salva ' + State.data.paper.w + ' × ' + State.data.paper.h +
        ' mm come foglio tuo'
      : 'Queste misure sono già un formato: cambiale per salvarne uno nuovo';
  }

  /* --------------------- i fogli dell'operatore --------------------- */

  var MATITA = '<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">' +
    '<path d="M1 11l.6-2.4L8 2.2l1.8 1.8-6.4 6.4z" fill="currentColor"/>' +
    '<path d="M8.6 1.6l1.8 1.8 1-1a.8.8 0 0 0 0-1.1l-.7-.7a.8.8 0 0 0-1.1 0z" fill="currentColor"/></svg>';

  var CESTINO = '<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">' +
    '<path d="M2.5 3.5h7l-.6 7a1 1 0 0 1-1 .9H4.1a1 1 0 0 1-1-.9z" fill="currentColor"/>' +
    '<path d="M1.5 2.8h9M4.6 2.8V1.6a.7.7 0 0 1 .7-.7h1.4a.7.7 0 0 1 .7.7v1.2" ' +
    'fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';

  /* Il pallino di carta dentro al pulsante del formato, e solo se quel foglio
     ha un colore dichiarato: sei pallini bianchi in fila sarebbero sei volte
     la stessa notizia, cioè nessuna notizia. */
  function segnoCarta(w, h) {
    var c = Profile.coloreFoglio(w, h);
    if (!c) return '';
    return '<span class="preset-carta" style="background:' + esc(c) + '"></span>';
  }

  function renderFormati() {
    var row = document.getElementById('preset-row');
    var piu = document.getElementById('btn-paper-add');
    /* I tre ISO sono nel markup e non si rifanno, ma il loro pallino di carta
       sì: è l'unico pezzo di quelle tre righe che dipende dal profilo. */
    var fissi = row.querySelectorAll('[data-fog-colore]');
    for (var k = 0; k < fissi.length; k++) {
      var mis = fissi[k].dataset.fogColore.split('x');
      var cf = Profile.coloreFoglio(+mis[0], +mis[1]);
      fissi[k].style.background = cf || '';
      fissi[k].classList.toggle('vuota', !cf);
      var bot = fissi[k].parentNode.querySelector('.preset');
      if (bot) {
        var vecchio = bot.querySelector('.preset-carta');
        if (vecchio) bot.removeChild(vecchio);
        bot.insertAdjacentHTML('afterbegin', segnoCarta(+mis[0], +mis[1]));
      }
    }

    /* Si tolgono solo i fogli dell'operatore: i tre ISO sono marcati
       `preset-fisso` nel markup e restano dove sono. Un `:has()` qui avrebbe
       funzionato lo stesso, ma una classe scritta in chiaro si legge anche
       da un browser di tre anni fa. */
    var vecchi = row.querySelectorAll('.preset-wrap:not(.preset-fisso)');
    for (var i = 0; i < vecchi.length; i++) row.removeChild(vecchi[i]);

    var l = Profile.formati(), html = '';
    for (var j = 0; j < l.length; j++) {
      var f = l[j];
      var mis = f.larghezza + ' × ' + f.altezza + ' mm';
      html += '<span class="preset-wrap">' +
        '<button class="btn btn-ghost preset" data-w="' + f.larghezza +
        '" data-h="' + f.altezza + '" title="' + esc(f.nome) + ' — ' + mis + '">' +
        segnoCarta(f.larghezza, f.altezza) + esc(f.nome) + '</button>' +
        '<button class="mini mini-edit" data-fog-edit="' + f.id +
        '" title="Modifica nome e misure" aria-label="Modifica">' + MATITA + '</button>' +
        '<button class="mini mini-del" data-fog-del="' + f.id +
        '" title="Elimina questo foglio" aria-label="Elimina">' + CESTINO + '</button>' +
        '</span>';
    }
    /* I fogli dell'operatore stanno DOPO i tre fissi e PRIMA del «+», così il
       più resta in fondo alla fila dove lo si è sempre trovato. */
    piu.insertAdjacentHTML('beforebegin', html);
    markPreset();
  }

  /* ------------------------- il disegno --------------------------- */

  /* Il disegno è tenuto come elenco di polilinee, in coordinate relative
     all'angolo in basso a sinistra del foglio. Così spostare il foglio lo
     porta con sé senza ricalcolare niente, e un SVG importato resta valido
     anche se poi il foglio viene trascinato altrove. La posizione sul piano
     si somma soltanto al momento di disegnare, in rebuildPath.

     QUI NON C'È PIÙ UN DISEGNO DI ESEMPIO. C'era un quadrato con un cerchio
     dentro, messo quando il piano era vuoto e non si capiva a cosa servisse.
     Adesso il piano ha tre rettangoli da guardare e il finto disegno fa solo
     confusione: a colpo d'occhio sembra che ci sia qualcosa da stampare. Senza
     disegno caricato il percorso è vuoto, e si vede che è vuoto. */

  /* Dalle polilinee del foglio ai segmenti in coordinate macchina, con gli
     spostamenti a penna alzata resi espliciti: sono corsa vera e devono
     comparire nell'anteprima come tutto il resto. */
  function rebuildPath() {
    var art = State.data.art;
    if (!art || !art.length) {
      State.data.path = [];
      renderPath();
      State.emit('path');
      return;
    }

    /* OGNI TRATTO HA IL SUO ANGOLO, perché può stare su un foglio diverso
       da quello di prima. `cur` — dov'è rimasta la punta — si tiene in
       coordinate MACCHINA e non del foglio, ed è il cambiamento che fa
       funzionare tutto il resto: lo spostamento a penna alzata che porta
       dal magnete 3 al magnete 4 attraversa due sistemi di riferimento, e
       in coordinate del foglio non si potrebbe nemmeno scrivere. */
    var fo = State.data.artFoglio || [];
    var origini = {};
    State.data.fogli.forEach(function (f) { origini[f.id] = f.origine; });
    var oAttiva = State.data.sheetOrigin;
    function ang(i) { return origini[fo[i]] || oAttiva; }

    var seg = [], cur = { x: 0, y: 0 };          // lo zero macchina

    /* Ogni segmento si porta dietro il TRATTO a cui appartiene. Serve al
       cursore dell'anteprima per sapere a quale confine fra due tratti
       corrisponde la posizione in cui sta, che è l'unico posto in cui una
       pausa si può mettere. */
    for (var i = 0; i < art.length; i++) {
      var poly = art[i];
      if (poly.length < 2) continue;
      var o = ang(i);
      seg.push({ x1: cur.x, y1: cur.y,
                 x2: poly[0].x + o.x, y2: poly[0].y + o.y, draw: false, poly: i });
      for (var j = 1; j < poly.length; j++) {
        seg.push({ x1: poly[j - 1].x + o.x, y1: poly[j - 1].y + o.y,
                   x2: poly[j].x + o.x, y2: poly[j].y + o.y, draw: true, poly: i });
      }
      cur = { x: poly[poly.length - 1].x + o.x, y: poly[poly.length - 1].y + o.y };
    }

    State.data.path = seg;
    renderPath();
    renderPause();
    State.emit('path');
  }

  /* IL COLORE DEI TRATTI SUL FOGLIO è quello della penna di quel livello,
     non una tinta decisa qui: l'anteprima deve somigliare al foglio che
     uscirà dalla macchina, e con due penne un'anteprima tutta di un colore
     non dice quale tratto viene fatto con quale.
     I colori si prendono UNA VOLTA per livello e non per tratto: ricavarli
     dalle forme costa, e un disegno ha migliaia di tratti e tre livelli.
     Gli spostamenti a penna alzata restano come sono: non sono inchiostro. */
  function coloriDeiLivelli() {
    var m = {}, di = State.data.artDi || [];
    if (!window.Artwork || !Artwork.coloreLivello) return m;
    for (var i = 0; i < di.length; i++) {
      if (di[i] && !(di[i] in m)) m[di[i]] = Artwork.coloreLivello(di[i]) || '';
    }
    return m;
  }

  /* LO SPESSORE DEI TRATTI, per livello e in millimetri veri.
     Dentro all'SVG si disegna in millimetri — c'è la viewBox — quindi un
     `stroke-width` di 0,8 è una riga larga 0,8 mm sulla carta, non un numero
     da convertire: è il motivo per cui questa anteprima può somigliare al
     foglio invece di somigliare a uno schermo.
     Si prendono una volta per livello come i colori, e per lo stesso motivo:
     un disegno ha migliaia di tratti e tre livelli. */
  function spessoriDeiLivelli() {
    var m = {}, di = State.data.artDi || [];
    if (!window.Artwork || !Artwork.spessoreLivello) return m;
    for (var i = 0; i < di.length; i++) {
      if (di[i] && !(di[i] in m)) m[di[i]] = Artwork.spessoreLivello(di[i]) || 0;
    }
    return m;
  }

  function renderPath() {
    var seg = State.data.path, out = '';
    var col = coloriDeiLivelli(), sp = spessoriDeiLivelli(), di = State.data.artDi || [];
    for (var i = 0; i < seg.length; i++) {
      var s = seg[i];
      var c = s.draw ? (col[di[s.poly]] || '') : '';
      /* Lo spessore vale solo sui tratti disegnati: uno spostamento a penna
         alzata non è inchiostro, e disegnarlo largo come il tratto direbbe
         che la penna ha scritto anche lì. */
      var w = s.draw ? (sp[di[s.poly]] || 0) : 0;
      /* STILE e non attributo `stroke`: la regola `.trace-draw` nel foglio
         di stile vince su un attributo di presentazione, e i tratti
         sarebbero rimasti grigi — con l'attributo scritto giusto dentro
         all'HTML, che è il modo peggiore di sbagliare. Lo stesso vale per la
         larghezza, che nella stessa regola è .4. */
      var stile = (c ? 'stroke:' + c + ';' : '') + (w ? 'stroke-width:' + w + ';' : '');
      out += '<line class="' + (s.draw ? 'trace-draw' : 'trace-move') +
             '"' + (stile ? ' style="' + stile + '"' : '') +
             ' x1="' + s.x1 + '" y1="' + s.y1 +
             '" x2="' + s.x2 + '" y2="' + s.y2 + '"></line>';
    }
    layerTrace.innerHTML = out;
  }

  /* I cambi penna segnati sul piano, dove la penna si fermerà. Il segno sta
     sul PRIMO punto del tratto che viene dopo, cioè dove il disegno
     riprenderà: è quello che si vuole guardare per decidere se la pausa cade
     dove serve. */
  function renderPause() {
    if (!layerStop) return;
    if (!window.Artwork || !Artwork.pause) { layerStop.innerHTML = ''; return; }
    var p = Artwork.pause(), art = State.data.art, o = State.data.sheetOrigin;
    if (!p.length || !art) { layerStop.innerHTML = ''; return; }

    var out = '';
    for (var i = 0; i < p.length; i++) {
      var q = art[p[i]];
      if (!q || !q.length) continue;
      var x = q[0].x + o.x, y = q[0].y + o.y;
      out += '<circle class="stop-mark" cx="' + x + '" cy="' + y + '" r="2.2"></circle>' +
             '<line class="stop-mark" x1="' + x + '" y1="' + (y - 4) +
             '" x2="' + x + '" y2="' + (y + 4) + '"></line>';
    }
    layerStop.innerHTML = out;
  }

  /* ---------------------- trascinare il foglio --------------------- */

  /* La matrice del gruppo ribaltato porta dai pixel dello schermo ai
     millimetri della macchina in un colpo solo, ribaltamento dell'asse Y
     compreso: non serve rifare i conti a mano, e resta corretta a qualsiasi
     dimensione della finestra. */
  function toMm(evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(flip.getScreenCTM().inverse());
  }

  /* Il punto sotto il puntatore, in coordinate dell'SVG — non della macchina:
     la finestra si ragiona in quelle, ed è l'unico posto del file in cui non
     si passa per il gruppo ribaltato. */
  function toSvg(evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  /* ZOOM CON LA ROTELLA, ancorato al puntatore: quello che sta sotto il mouse
     ci resta. È l'unico ingrandimento che non costringe a rincorrere il punto
     che si stava guardando.
     I due limiti servono a non perdersi: non si scende sotto i 20 mm di
     larghezza — più in là non c'è niente da vedere, un passo di motore sono
     tre centesimi — e non si va oltre il quadruplo dell'adattato. */
  function enableZoom() {
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var v = finestraCorrente();
      var fit = vista();
      var f = e.deltaY > 0 ? 1.15 : 1 / 1.15;

      var nw = v.w * f;
      if (nw < 20) f = 20 / v.w;
      if (nw > fit.w * 4) f = fit.w * 4 / v.w;

      var p = toSvg(e);
      finestra = {
        x0: p.x - (p.x - v.x0) * f,
        y0: p.y - (p.y - v.y0) * f,
        w: v.w * f,
        h: v.h * f
      };
      applicaVista();
    }, { passive: false });

    /* IL DOPPIO CLIC HA TRE SIGNIFICATI, e si scelgono in quest'ordine.
       Sul disegno apre il riquadro di selezione: è il gesto con cui si entra
       in modifica, e deve vincere su tutto perché il disegno sta sopra al
       foglio e dentro al piano, quindi qualsiasi altra regola gliela
       porterebbe via.
       Fuori dal riquadro, mentre la selezione è aperta, la chiude: si esce
       dalla modifica dove si è entrati.
       Altrimenti, e solo sul fondo, si torna a vedere tutto: sul foglio no,
       perché lì il doppio clic sono due clic e il foglio si trascina. */
    svg.addEventListener('dblclick', function (e) {
      var m = toMm(e), o = State.data.sheetOrigin;
      var p = { x: m.x - o.x, y: m.y - o.y };     // in millimetri del FOGLIO

      if (window.Artwork && Artwork.quale) {
        /* CON PIU' LIVELLI GIA' SCELTI il doppio clic non ne sceglie un
           altro: apre il riquadro su tutti. Chi ha spuntato tre righe
           nell'elenco ha già detto su che cosa vuole lavorare, e ripescare
           quello sotto al puntatore disferebbe la selezione proprio nel
           momento in cui la si vuole usare. */
        var dentro = Artwork.riquadro();
        if (Artwork.scelti && Artwork.scelti().length > 1 && dentro &&
            p.x >= dentro.x && p.x <= dentro.x + dentro.w &&
            p.y >= dentro.y && p.y <= dentro.y + dentro.h) {
          Selezione.apri();
          return;
        }

        /* Con un livello solo il punto non basta a dire quale si vuole. Si
           prende quello disegnato più in alto; e se è già lui lo scelto, si
           passa a quello sotto — così clic ripetuti nello stesso posto girano
           fra i sovrapposti invece di ripescare sempre lo stesso. L'elenco a
           sinistra resta la via sicura. */
        var sopra = Artwork.quale(p);
        var giro = (window.Selezione && Selezione.attiva() && sopra === Artwork.sceltoId())
          ? Artwork.quale(p, sopra) : sopra;
        if (giro) {
          Artwork.seleziona(giro);
          Selezione.apri();
          return;
        }
      }

      if (window.Selezione && Selezione.attiva()) { Selezione.chiudi(); return; }
      if (e.target.closest('.sheet')) return;
      adatta();
    });
  }

  /* TRASCINARE IL FONDO SPOSTA LO SGUARDO, non il foglio: ingrandire senza
     potersi spostare vorrebbe dire uscire e rientrare ogni volta.
     Lo spostamento si conta in PIXEL e si converte con la scala presa alla
     partenza. Contarlo in millimetri sarebbe un cane che si morde la coda: la
     conversione dipende dalla finestra, e la finestra è proprio quello che si
     sta cambiando. */
  function enablePan() {
    var pan = null;

    svg.addEventListener('pointerdown', function (e) {
      /* CHI SI PRENDE IL TRASCINAMENTO.
         Sul fondo, lo sguardo. Sul foglio, il foglio — ma solo finché il
         foglio è libero: una volta misurato non si sposta più, e lasciare
         quella zona morta vorrebbe dire che da ingranditi, con la carta che
         copre tutto lo schermo, non resta niente da afferrare per spostarsi.
         Il tasto centrale sposta lo sguardo sempre, dovunque si prema: è la
         via d'uscita quando il foglio riempie la vista. */
      /* Quale foglio: con più fogli sul piano, «il foglio è misurato» è
         una domanda su QUEL foglio, non sulla pagina. Il foglio libero si
         prende il trascinamento, quello misurato lo lascia allo sguardo. */
      var sotto = e.target.closest('.sheet');
      var suo = sotto ? Fogli.trova(sotto.dataset.foglio) : null;
      var centrale = e.button === 1;
      if (!centrale && suo && !suo.misurato) return;
      if (centrale) e.preventDefault();

      var r = svg.getBoundingClientRect();
      var v = finestraCorrente();
      pan = { x: e.clientX, y: e.clientY, x0: v.x0, y0: v.y0,
              sx: v.w / r.width, sy: v.h / r.height, w: v.w, h: v.h };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('is-panning');
    });

    svg.addEventListener('pointermove', function (e) {
      if (!pan) return;
      finestra = {
        x0: pan.x0 - (e.clientX - pan.x) * pan.sx,
        y0: pan.y0 - (e.clientY - pan.y) * pan.sy,
        w: pan.w, h: pan.h
      };
      applicaVista();
    });

    ['pointerup', 'pointercancel'].forEach(function (ev) {
      svg.addEventListener(ev, function (e) {
        if (!pan) return;
        pan = null;
        svg.classList.remove('is-panning');
        svg.releasePointerCapture(e.pointerId);
      });
    });
  }

  /* ------------------------------ I MAGNETI ------------------------------
   *
   * Trascinando un foglio, i suoi bordi si agganciano a quelli degli altri —
   * e agli estremi della corsa e della tavola. Non è una comodità: due fogli
   * ACCOSTATI sono una misura sola invece di due (vedi js/fogli.js), e
   * l'accostamento si legge dalla geometria. Un foglio appoggiato a occhio,
   * sbagliato di mezzo millimetro, non è un foglio accostato: è un foglio
   * che chiederà la sua misura, e chi l'ha posato non capirà perché. I
   * magneti sono quello che rende il gesto affidabile.
   *
   * Si agganciano i BORDI e non i centri, perché quello che conta è che due
   * fogli COMBACINO. I due assi sono indipendenti: in un gesto solo ci si
   * può accostare a destra di uno e allineare in basso a un altro, che è
   * esattamente come si posa una griglia di magneti.
   *
   * Alt li spegne tutti, come nell'editor: una via d'uscita che lascia
   * acceso qualcosa non è una via d'uscita.
   */
  function righeMagnete(mio) {
    var a = State.data.area, ap = Profile.appoggioRect();
    /* La corsa prima di tutto: è il limite che conta davvero, perché un
       foglio fuori di lì la penna non lo tocca. Poi la tavola, che è dove il
       foglio si appoggia — e il suo bordo in basso è una BATTUTA vera, quella
       contro cui l'operatore spinge la carta per posarla dritta. */
    var x = [0, a.w], y = [0, a.h];
    if (ap) { x.push(ap.x0, ap.x0 + ap.w); y.push(ap.y0, ap.y0 + ap.h); }
    State.data.fogli.forEach(function (f) {
      if (f.id === mio) return;
      x.push(f.origine.x, f.origine.x + f.w);
      y.push(f.origine.y, f.origine.y + f.h);
    });
    return { x: x, y: y };
  }

  /* Quanti millimetri vale un pixel adesso. La tolleranza dei magneti si
     misura in pixel e non in millimetri: da ingranditi un millimetro è mezzo
     schermo, e una tolleranza fissa in millimetri aggancerebbe tutto. */
  function mmPerPixel() {
    var r = svg.getBoundingClientRect();
    if (!r.width) return 1;
    return finestraCorrente().w / r.width;
  }

  function aggancia(f, x, y, spenti) {
    guide = [];
    if (spenti) return { x: x, y: y };

    var tol = 8 * mmPerPixel();
    var righe = righeMagnete(f.id);
    var a = State.data.area;

    /* Per ogni asse si prova il bordo basso e quello alto del foglio contro
       tutte le righe, e vince lo scarto più piccolo: due righe che tirano in
       versi opposti non si sommano, ne sceglie una. */
    function miglior(righe, basso, lato) {
      var vinto = null;
      [0, lato].forEach(function (d) {
        righe.forEach(function (r) {
          var scarto = r - (basso + d);
          if (Math.abs(scarto) <= tol && (!vinto || Math.abs(scarto) < Math.abs(vinto.s))) {
            vinto = { s: scarto, r: r };
          }
        });
      });
      return vinto;
    }

    var vx = miglior(righe.x, x, f.w);
    var vy = miglior(righe.y, y, f.h);
    if (vx) x += vx.s;
    if (vy) y += vy.s;

    /* La riga che spiega il magnete: attraversa tutta la corsa, perché
       serve a far vedere CON CHE COSA il foglio si è allineato. */
    if (vx) guide.push({ x1: vx.r, y1: Math.min(0, y) - 20,
                         x2: vx.r, y2: Math.max(a.h, y + f.h) + 20 });
    if (vy) guide.push({ x1: Math.min(0, x) - 20, y1: vy.r,
                         x2: Math.max(a.w, x + f.w) + 20, y2: vy.r });
    return { x: x, y: y };
  }

  function enableDrag() {
    var grab = null;

    layerSheet.addEventListener('pointerdown', function (e) {
      var rect = e.target.closest('.sheet');
      if (!rect) return;
      var f = Fogli.trova(rect.dataset.foglio);
      /* Foglio misurato = foglio fermo. Trascinarlo dopo averlo misurato
         sposterebbe il disegno sulla carta vera senza che niente lo dica. */
      if (!f || f.misurato) return;
      /* Prendere un foglio vuol dire metterci mano: diventa quello in uso,
         se non lo era già. Dover prima sceglierlo in elenco e poi
         trascinarlo sarebbe un gesto in due tempi per una cosa sola. */
      Fogli.scegli(f.id);
      var m = toMm(e);
      grab = { id: f.id, dx: m.x - f.origine.x, dy: m.y - f.origine.y };
      rect.classList.add('is-dragging');
      layerSheet.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    layerSheet.addEventListener('pointermove', function (e) {
      if (!grab) return;
      var f = Fogli.trova(grab.id);
      if (!f) { grab = null; return; }
      var m = toMm(e);
      /* Arrotondato al millimetro PRIMA dei magneti: su una macchina tarata
         a mano una posizione con tre decimali sarebbe una precisione finta,
         ma un aggancio sì che deve essere esatto — e lo è, perché dopo
         l'arrotondamento il magnete porta il bordo sulla riga, non vicino. */
      var q = aggancia(f, Math.round(m.x - grab.dx), Math.round(m.y - grab.dy),
                       e.altKey);
      poniFoglio(f, q.x, q.y);
    });

    ['pointerup', 'pointercancel'].forEach(function (ev) {
      layerSheet.addEventListener(ev, function (e) {
        if (!grab) return;
        grab = null;
        guide = [];
        /* Gli agganci si rileggono alla fine del gesto e non a ogni
           movimento: durante il trascinamento un foglio tocca e lascia
           dieci vicini, e ricalcolare l'albero a ogni pixel direbbe dieci
           volte una cosa che conta solo quando il dito si alza. */
        Fogli.rileggiAgganci();
        State.emit('fogli');
        renderSheet();
        layerSheet.releasePointerCapture(e.pointerId);
      });
    });
  }

  /* Un foglio si sposta: si ridisegna il piano e il percorso, e basta. NON
     si rifà la collocazione dei disegni — i loro rettangoli sono millimetri
     del foglio, e il foglio è lo stesso: è cambiato solo dove casca. */
  function poniFoglio(f, x, y) {
    f.origine = { x: x, y: y };
    if (f.id === State.data.paper.id) {
      document.getElementById('sheet-x').value = x;
      document.getElementById('sheet-y').value = y;
    }
    renderSheet();
    rebuildPath();
    /* Il disegno sta sulla carta: se la carta si sposta, il riquadro che lo
       circonda si sposta con lei. Il rettangolo in Artwork non cambia — è in
       millimetri del foglio — ma dove cade sullo schermo sì. */
    if (window.Selezione) Selezione.ridisegna();
  }

  function setSheetOrigin(x, y) {
    poniFoglio(State.data.paper, x, y);
    /* Scrivendo i due numeri a mano si può accostare un foglio a un altro
       tanto quanto trascinandolo: l'accostamento è una proprietà di dove
       stanno i fogli, non di come ce li hai messi. */
    Fogli.rileggiAgganci();
    State.emit('fogli');
    renderSheet();
  }

  /* ----------------------- il nome di un foglio -------------------------
   *
   * Chiesto dall'operatore il 2026-11-08. Non è una decorazione: il nome del
   * foglio esce dalla pagina e arriva fino alla macchina — sta
   * nell'intestazione dei livelli, nel marcatore `;FOGLIO n/N nome` del
   * programma e sul vetro del telecomando. Con nove magneti sul piano,
   * «FOGLIO 4/9 75x75» non dice niente e «FOGLIO 4/9 Gioco» dice tutto.
   *
   * IL NOME VUOTO RIMETTE QUELLO DEL FORMATO, e per questo serve `nomeMio`:
   * senza, `apply()` riscriverebbe il nome a ogni ridisegno e la rinomina
   * durerebbe fino al primo clic. */
  function rinominaFoglio(id) {
    var f = Fogli.trova(id);
    if (!f || !window.Nome) return;
    var n = Fogli.indice(id) + 1, di = Fogli.elenco().length;
    var auto = nomeFormato(f.w, f.h);
    /* Quello che si LEGGE quando il nome non c'è: per un formato ISO è il
       suo nome, per una misura qualunque sono le misure — «Personalizzato»
       lo scrive il programma dentro di sé, ma sul pulsante sarebbe il nome
       di niente. È la stessa regola dell'elenco dei fogli. */
    var visto = auto !== 'Personalizzato' ? auto : f.w + ' \u00d7 ' + f.h;
    Nome.chiedi({
      titolo: 'Nome del foglio ' + n,
      desc: 'Lo scrivono l\'elenco dei fogli, l\'intestazione dei livelli, il ' +
            'programma (;FOGLIO ' + n + '/' + di + ' …) e il vetro del ' +
            'telecomando: è così che si sa, a stampa iniziata, su quale pezzo ' +
            'di carta sta andando la penna.',
      valore: f.name && f.name !== 'Personalizzato' ? f.name : '',
      vuoto: 'Rimetti «' + visto + '»',
      ok: function (nuovo) {
        f.nomeMio = !!nuovo;
        f.name = nuovo || auto;
        State.emit('fogli');
        renderFogli();
        renderSheet();
        Log.add('msg', nuovo
          ? 'Il foglio ' + n + ' adesso si chiama «' + nuovo + '»: lo dicono ' +
            'l\'elenco, il programma e il telecomando.'
          : 'Il foglio ' + n + ' torna a chiamarsi come il suo formato: «' +
            visto + '».');
      }
    });
  }

  /* Il pulsante dice due cose diverse a seconda di chi contiene chi, e sono
     davvero due operazioni diverse: con un foglio piccolo lo si mette in mezzo
     alla corsa, con un foglio grande si mette la corsa in mezzo al foglio. Il
     conto è lo stesso — cambia solo il segno del risultato. */
  function etichettaCentra() {
    var b = document.getElementById('btn-center-sheet');
    if (!b) return;
    var a = State.data.area, p = State.data.paper;
    b.textContent = (p.w > a.w || p.h > a.h)
      ? 'Centra l\'area nel foglio'
      : 'Centra il foglio nell\'area';
  }

  /* Il foglio passa da «posizione indicativa» a «posizione misurata» e
     viceversa. Lo accende il terzo popup di inizio stampa; lo spegne solo una
     richiesta esplicita, perché spegnerlo vuol dire buttare via una misura. */
  function fissa(misurato) {
    State.data.foglioMisurato = !!misurato;
    State.emit('foglio');
    renderSheet();
    aggiornaLucchetto();
  }

  function aggiornaLucchetto() {
    var b = document.getElementById('btn-lucchetto');
    if (!b) return;
    var m = State.data.foglioMisurato;
    b.classList.toggle('is-fisso', m);
    b.disabled = !m;
    b.title = m
      ? 'Sblocca: la posizione misurata del foglio viene scartata'
      : 'Il foglio si fissa misurandone l\'angolo, al terzo passo della stampa';
    b.innerHTML = (m
      ? '<svg viewBox="0 0 12 14" width="11" height="12" aria-hidden="true">' +
        '<path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
        '<rect x="1.5" y="6" width="9" height="7" rx="1.2" fill="currentColor"/></svg>' +
        ' Foglio fissato dalla misura'
      : '<svg viewBox="0 0 12 14" width="11" height="12" aria-hidden="true">' +
        '<path d="M3 6V4a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
        '<rect x="1.5" y="6" width="9" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' +
        ' Foglio non misurato');

    ['sheet-x', 'sheet-y'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = m;
    });
  }

  /* Rimette il foglio al centro dell'area: serve dopo aver cambiato formato,
     o dopo averlo trascinato fuori. */
  function centerSheet() {
    var a = State.data.area, p = State.data.paper;
    setSheetOrigin(Math.round((a.w - p.w) / 2), Math.round((a.h - p.h) / 2));
  }

  /* La finestrella: `null` vuol dire «stai creando», un id «stai correggendo
     quello». È l'unico stato che serve, e sta qui invece che nel DOM.
     `fisso` è il terzo caso: un A4 non si rinomina e non si ridimensiona — è
     una costante del mondo — ma la carta di cui è fatto si scegli tu, e si
     sceglie da questa stessa finestrella con i due campi bloccati. */
  var inModifica = null, fisso = null;

  /* Il colore mentre la finestrella è aperta. Sta qui e non nel profilo
     perché «Annulla» deve annullare: scrivendolo subito nel profilo, la
     carta sarebbe già cambiata e il pulsante non avrebbe niente da annullare.
     `null` vuol dire «questo foglio non ha un colore dichiarato». */
  var coloreInCorso = null;

  function renderCarte() {
    var box = document.getElementById('fog-carte');
    if (!box) return;
    var ora = String(coloreInCorso || '').toLowerCase();
    var html = '', trovata = false;
    CARTE.forEach(function (c) {
      var sua = c.colore.toLowerCase() === ora;
      if (sua) trovata = true;
      html += '<button type="button" class="carta' + (sua ? ' ora' : '') +
              '" data-carta="' + esc(c.colore) + '" title="Carta ' + esc(c.nome) +
              ' (' + esc(c.colore) + ')"><span class="carta-tinta" style="background:' +
              esc(c.colore) + '"></span><span class="carta-nome">' + esc(c.nome) +
              '</span></button>';
    });
    box.innerHTML = html;
    /* Il quadratino del selettore di sistema si accende solo quando la tinta
       NON è una delle carte in elenco: due pulsanti accesi insieme
       direbbero che la carta è due cose. */
    var alt = document.getElementById('fog-colore');
    if (alt) {
      alt.value = coloreInCorso || Profile.CARTA_BIANCA;
      alt.parentNode.classList.toggle('ora', !!coloreInCorso && !trovata);
    }
  }

  function apriModale(id) {
    var f = id ? Profile.trovaFormato(id) : null;
    if (id && !f) return;
    inModifica = id || null;
    fisso = null;
    var w = f ? f.larghezza : State.data.paper.w;
    var h = f ? f.altezza : State.data.paper.h;
    coloreInCorso = Profile.coloreFoglio(w, h);
    document.getElementById('fog-titolo').textContent =
      f ? 'Modifica «' + f.nome + '»' : 'Nuovo foglio';
    document.getElementById('fog-nome').value =
      f ? f.nome : State.data.paper.w + ' × ' + State.data.paper.h;
    document.getElementById('fog-w').value = w;
    document.getElementById('fog-h').value = h;
    sbloccaCampi(true);
    document.getElementById('fog-nota').textContent = '';
    renderCarte();
    document.getElementById('fog-modal').hidden = false;
    document.getElementById('fog-nome').focus();
    document.getElementById('fog-nome').select();
  }

  /* La stessa finestrella per un formato ISO: solo la carta. */
  function apriModaleFisso(w, h) {
    inModifica = null;
    fisso = { w: w, h: h };
    coloreInCorso = Profile.coloreFoglio(w, h);
    document.getElementById('fog-titolo').textContent =
      'Carta del foglio ' + nomeFormato(w, h);
    document.getElementById('fog-nome').value = nomeFormato(w, h);
    document.getElementById('fog-w').value = w;
    document.getElementById('fog-h').value = h;
    sbloccaCampi(false);
    document.getElementById('fog-nota').textContent =
      'Nome e misure di un formato ISO non si cambiano: quello che è tuo è la ' +
      'carta.';
    renderCarte();
    document.getElementById('fog-modal').hidden = false;
  }

  function sbloccaCampi(si) {
    ['fog-nome', 'fog-w', 'fog-h'].forEach(function (id) {
      document.getElementById(id).disabled = !si;
    });
  }

  function chiudiModale() {
    document.getElementById('fog-modal').hidden = true;
    inModifica = null;
    fisso = null;
  }

  function salvaModale() {
    /* UN FORMATO ISO SI SALVA SOLO PER LA CARTA, e non cambia il foglio in
       uso: scegliere il colore dell'A4 mentre si stampa su A5 non vuol dire
       «passa all'A4» — vuol dire «il mio A4 è nero». Il foglio in uso si
       ricolora da sé se le misure sono queste, perché apply() rilegge il
       profilo. */
    if (fisso) {
      var fw = fisso.w, fh = fisso.h;
      Profile.setColoreFoglio(fw, fh, coloreInCorso);
      chiudiModale();
      renderFormati();
      apply();
      Log.add('msg', coloreInCorso
        ? 'Il foglio ' + nomeFormato(fw, fh) + ' è di carta ' +
          nomeCarta(coloreInCorso) + '.'
        : 'Il foglio ' + nomeFormato(fw, fh) + ' torna senza carta dichiarata: ' +
          'nell\'anteprima è bianco.');
      return;
    }

    var nome = document.getElementById('fog-nome').value.trim();
    var w = Math.round(+document.getElementById('fog-w').value);
    var h = Math.round(+document.getElementById('fog-h').value);
    var nota = document.getElementById('fog-nota');

    if (!nome) { nota.textContent = 'Serve un nome: senza, il pulsante è vuoto.'; return; }
    if (!(w >= 20 && w <= 400 && h >= 20 && h <= 400)) {
      nota.textContent = 'Le misure stanno fra 20 e 400 mm.';
      return;
    }

    if (inModifica) {
      var vecchio = Profile.trovaFormato(inModifica);
      /* Le misure cambiate si portano dietro la carta: è la stessa risma,
         tagliata un centimetro più corta. */
      if (vecchio) Profile.spostaColoreFoglio(vecchio.larghezza, vecchio.altezza, w, h);
      Profile.modificaFormato(inModifica, nome, w, h);
    } else {
      Profile.aggiungiFormato(nome, w, h);
    }
    Profile.setColoreFoglio(w, h, coloreInCorso);

    chiudiModale();
    renderFormati();
    setSize(w, h);
    Log.add('msg', 'Foglio «' + nome + '» ' + w + ' × ' + h + ' mm' +
                   (coloreInCorso ? ', carta ' + nomeCarta(coloreInCorso) : '') +
                   ' salvato.');
  }

  function eliminaFormato(id) {
    var f = Profile.trovaFormato(id);
    if (!f) return;
    if (!window.confirm('Elimino il foglio «' + f.nome + '» (' + f.larghezza +
                        ' × ' + f.altezza + ' mm)?')) return;
    Profile.eliminaFormato(id);
    renderFormati();
    apply();          // il nome torna «Personalizzato»: quel formato non c'è più
    Log.add('msg', 'Foglio «' + f.nome + '» eliminato. Le misure del foglio in ' +
                   'uso non cambiano: è sparito il pulsante, non la carta.');
  }

  function init() {
    svg = document.getElementById('bed-svg');
    flip = document.getElementById('flip');
    caption = document.getElementById('stage-caption');
    layerBed = document.getElementById('layer-bed');
    layerSheet = document.getElementById('layer-sheet');
    layerTrace = document.getElementById('layer-trace');
    layerStop = document.getElementById('layer-stop');
    layerSegni = document.getElementById('layer-segni');

    /* Un ascoltatore sulla riga invece di uno per pulsante: i fogli
       dell'operatore nascono e muoiono mentre la pagina è aperta, e agganciare
       i listener ai nodi vuol dire ricordarsi di riagganciarli ogni volta —
       cioè dimenticarsene una volta. */
    document.getElementById('fogli-row').addEventListener('click', function (e) {
      var via = e.target.closest('[data-foglio-via]');
      if (via) {
        var f = Fogli.trova(via.dataset.foglioVia);
        var suoi = window.Artwork
          ? Artwork.livelli().filter(function (l) {
              return Artwork.foglioDi(l.id).id === via.dataset.foglioVia;
            }).length : 0;
        /* Togliere un foglio che ha dei disegni sopra li porta via con sé:
           i loro numeri sono millimetri di QUEL foglio, e non ci sarebbe
           dove rimetterli. Si chiede, e si dice quanti. */
        if (suoi && !window.confirm('Sul foglio ' + (Fogli.indice(f.id) + 1) +
            ' ci ' + (suoi === 1 ? 'è 1 livello' : 'sono ' + suoi + ' livelli') +
            ': togliendo il foglio se ne ' + (suoi === 1 ? 'va' : 'vanno') +
            ' anche ' + (suoi === 1 ? 'lui' : 'loro') + '. Procedo?')) return;
        if (window.Artwork) Artwork.svuotaFoglio(via.dataset.foglioVia);
        Fogli.togli(via.dataset.foglioVia);
        return;
      }
      var sc = e.target.closest('[data-foglio]');
      if (sc) {
        /* DOPPIO CLIC SULLA PASTICCA: il nome. Un clic solo sceglie il
           foglio, che è quello che uno vuole comunque prima di
           rinominarlo. I due clic si contano a mano: vedi `Nome.doppio`. */
        if (window.Nome && Nome.doppio('fog:' + sc.dataset.foglio)) {
          rinominaFoglio(sc.dataset.foglio);
        } else {
          Fogli.scegli(sc.dataset.foglio);
        }
        return;
      }
      if (e.target.closest('#btn-foglio-add')) {
        var w = Math.round(+document.getElementById('paper-w').value) || 100;
        var h = Math.round(+document.getElementById('paper-h').value) || 100;
        var n = Fogli.aggiungi(w, h, nomeFormato(w, h));
        Fogli.scegli(n.id);
        Log.add('msg', 'Foglio ' + Fogli.elenco().length + ' aggiunto: ' + w +
                ' × ' + h + ' mm, posato a X ' + n.origine.x + ' Y ' +
                n.origine.y + (n.aggancio ? ', accostato al foglio ' +
                (Fogli.indice(n.aggancio) + 1) + ': il suo angolo si ricava, ' +
                'non si misura.' : ', da misurare a parte.'));
      }
    });

    /* DOPPIO CLIC SULLA PASTICCA: il nome. Il clic singolo sceglie già il
       foglio, e sovrapporre un secondo gesto allo stesso bersaglio non
       toglie niente — scegliere quel foglio prima di rinominarlo è quello
       che uno vuole comunque. */
    /* Il piano e l'elenco seguono i fogli dovunque li si cambi: dai
       pulsanti qui, dal trascinamento, o da un domani in cui li cambierà
       qualcun altro. Un segnale solo, un posto solo che ridisegna. */
    State.on('fogli', function () { renderFogli(); renderSheet(); });

    document.getElementById('preset-row').addEventListener('click', function (e) {
      var ed = e.target.closest('[data-fog-edit]');
      if (ed) { apriModale(ed.dataset.fogEdit); return; }

      var del = e.target.closest('[data-fog-del]');
      if (del) { eliminaFormato(del.dataset.fogDel); return; }

      /* Il pulsantino dei tre ISO: apre la stessa finestrella per la sola
         carta. Le misure stanno nell'attributo e non in una variabile qui,
         così la riga del markup si legge da sola. */
      var col = e.target.closest('[data-fog-colore]');
      if (col) {
        var m = col.dataset.fogColore.split('x');
        apriModaleFisso(+m[0], +m[1]);
        return;
      }

      /* Scegliere un formato lo mette anche AL CENTRO dell'area di lavoro:
         è quello che si vuole nove volte su dieci, e le altre si trascina.
         Non lo fa invece scrivendo a mano larghezza e altezza — lì il foglio
         scapperebbe sotto le dita a ogni cifra battuta.
         Un foglio già misurato non si tocca: la sua posizione è una misura. */
      var p = e.target.closest('.preset');
      if (p) {
        setSize(+p.dataset.w, +p.dataset.h);
        if (!State.data.foglioMisurato) centerSheet();
      }
    });

    /* Il «+» salva subito, col nome delle misure: rinominarlo è un click sulla
       matita, e chiedere un nome prima di aver visto il pulsante sarebbe un
       passaggio in più per la cosa che si fa più spesso. */
    document.getElementById('btn-paper-add').addEventListener('click', function () {
      if (this.disabled) return;
      var w = State.data.paper.w, h = State.data.paper.h;
      var f = Profile.aggiungiFormato(w + ' × ' + h, w, h);
      renderFormati();
      /* Il nome del foglio si ricalcola in apply(): senza questa chiamata la
         didascalia sotto il piano continuerebbe a dire «Personalizzato» per un
         foglio che un nome adesso ce l'ha. */
      apply();
      Log.add('msg', 'Foglio «' + f.nome + '» aggiunto. Con la matita gli dai ' +
                     'un nome, col cestino lo togli.');
    });

    /* Le carte: un ascoltatore sul contenitore, perché i pulsanti si rifanno
       a ogni apertura. Ripremere la carta già scelta la TOGLIE — è il modo di
       dire «non so di che colore è», e senza non ci sarebbe nessun modo di
       tornare indietro una volta scelta. */
    document.getElementById('fog-carte').addEventListener('click', function (e) {
      var b = e.target.closest('[data-carta]');
      if (!b) return;
      var c = b.dataset.carta;
      coloreInCorso = (String(coloreInCorso || '').toLowerCase() === c.toLowerCase())
        ? null : c;
      renderCarte();
    });
    document.getElementById('fog-colore').addEventListener('input', function () {
      coloreInCorso = this.value;
      renderCarte();
    });

    document.getElementById('fog-ok').addEventListener('click', salvaModale);
    document.getElementById('fog-annulla').addEventListener('click', chiudiModale);
    document.getElementById('fog-modal').addEventListener('click', function (e) {
      if (e.target === this) chiudiModale();      // click sul fondo scuro
    });
    document.addEventListener('keydown', function (e) {
      if (document.getElementById('fog-modal').hidden) return;
      if (e.key === 'Escape') chiudiModale();
      if (e.key === 'Enter') salvaModale();
    });

    renderFormati();

    ['paper-w', 'paper-h'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        setSize(+document.getElementById('paper-w').value || 10,
                +document.getElementById('paper-h').value || 10);
      });
    });

    /* `|| 0` sarebbe sbagliato qui: un campo appena svuotato darebbe 0, e lo
       zero è una posizione vera — l'angolo dei blocchi. Si tiene il valore
       buono finché non se ne scrive uno nuovo. */
    ['sheet-x', 'sheet-y'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        var x = parseFloat(document.getElementById('sheet-x').value);
        var y = parseFloat(document.getElementById('sheet-y').value);
        setSheetOrigin(isNaN(x) ? State.data.sheetOrigin.x : x,
                       isNaN(y) ? State.data.sheetOrigin.y : y);
      });
    });

    document.getElementById('btn-rotate-paper').addEventListener('click', function () {
      setSize(State.data.paper.h, State.data.paper.w);
    });

    document.getElementById('btn-center-sheet').addEventListener('click', centerSheet);

    document.getElementById('btn-lucchetto').addEventListener('click', function () {
      if (!State.data.foglioMisurato) return;
      fissa(false);
      Log.add('msg', 'Posizione del foglio scartata: quella sullo schermo torna ' +
                     'indicativa. Al prossimo avvio di stampa il terzo passo la ' +
                     'rimisura.');
    });

    aggiornaLucchetto();

    document.getElementById('btn-fit').addEventListener('click', adatta);

    enableZoom();
    enablePan();
    enableDrag();
    apply();
  }

  return {
    init: init, setSize: setSize, refreshArea: refreshArea,
    renderFormati: renderFormati, raggiungibile: raggiungibile,
    adatta: adatta,
    setSheetOrigin: setSheetOrigin, centerSheet: centerSheet,
    rebuildPath: rebuildPath, renderPause: renderPause,
    renderSegni: renderSegni, fissa: fissa,
    /* Il colore della carta e il contrasto escono da qui perché il foglio è
       di questo file. Li usa l'elenco dei livelli, per dire quando una penna
       sulla carta di oggi non lascerebbe niente. */
    colore: colore, coloreDi: coloreDi, carte: function () { return CARTE.slice(); },
    nomeCarta: nomeCarta, chiarezza: chiarezza, contrasto: contrasto,
    apriColoreFoglio: apriModaleFisso, rinominaFoglio: rinominaFoglio
  };
})();
