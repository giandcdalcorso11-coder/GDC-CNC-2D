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

  function renderSheet() {
    var p = State.data.paper, o = State.data.sheetOrigin;
    var a = State.data.area, r = raggiungibile();
    var vuoto = r.w <= 0 || r.h <= 0;
    var fa = fuoriAppoggio();

    var html = '<rect class="sheet" x="' + o.x + '" y="' + o.y +
               '" width="' + p.w + '" height="' + p.h + '" rx="0.6"></rect>';

    /* IL RETTANGOLO RAGGIUNGIBILE, disegnato SOPRA la carta.
       Serve perché un foglio più grande della corsa copre il piano: il
       riquadro dell'area e il reticolo finiscono sotto il foglio, e senza
       questo segno non si vedrebbe più dove la penna arriva — che è l'unica
       cosa che si ha bisogno di sapere guardando questo disegno. */
    if (!vuoto && r.sporge) {
      html += '<rect class="reach" x="' + Math.max(0, o.x) + '" y="' + Math.max(0, o.y) +
              '" width="' + r.w + '" height="' + r.h + '"></rect>';
    }
    layerSheet.innerHTML = html;

    /* Rosso solo quando c'è qualcosa da correggere. Un foglio più grande della
       corsa sporge per costruzione: segnarlo in rosso ogni volta vorrebbe dire
       un allarme che è sempre acceso, cioè un allarme che non si guarda più.
       Resta rosso se il foglio è fuori del tutto, o se sporge pur essendo più
       piccolo dell'area — lì sporgere è una svista, non una necessità. */
    layerSheet.firstChild.classList.toggle('sheet-out',
      vuoto || (r.sporge && !r.piuGrande));
    layerSheet.firstChild.classList.toggle('sheet-giu', !!fa);
    layerSheet.firstChild.classList.toggle('sheet-fisso', State.data.foglioMisurato);

    /* Un decimale: l'area è un numero CALCOLATO (corsa percorribile, cioè
       passi diviso rapporto), quindi ha tutti i decimali del mondo. Stamparli
       tutti non aggiunge informazione — la macchina non li sa fare: un passo
       vale tre centesimi. */
    var coda = '';
    if (vuoto) {
      coda = ' · il foglio è tutto fuori dalla corsa';
    } else if (r.sporge) {
      coda = ' · la penna ne raggiunge ' + r.w.toFixed(1) + ' × ' + r.h.toFixed(1) +
             ' mm, da ' + r.dax.toFixed(0) + ' mm dal bordo sinistro e ' +
             r.day.toFixed(0) + ' dal basso';
    }

    if (fa) coda += ' · ESCE DALLA TAVOLA ' + fa.join(' e ') + ' mm';

    caption.textContent =
      'Area ' + a.w.toFixed(1) + ' × ' + a.h.toFixed(1) + ' mm · foglio ' + p.name +
      ' ' + p.w + ' × ' + p.h + ' mm' + coda;
  }

  function apply() {
    State.data.paper.name = nomeFormato(State.data.paper.w, State.data.paper.h);
    markPreset();
    etichettaCentra();
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

  function renderFormati() {
    var row = document.getElementById('preset-row');
    var piu = document.getElementById('btn-paper-add');
    var vecchi = row.querySelectorAll('.preset-wrap');
    for (var i = 0; i < vecchi.length; i++) row.removeChild(vecchi[i]);

    var l = Profile.formati(), html = '';
    for (var j = 0; j < l.length; j++) {
      var f = l[j];
      var mis = f.larghezza + ' × ' + f.altezza + ' mm';
      html += '<span class="preset-wrap">' +
        '<button class="btn btn-ghost preset" data-w="' + f.larghezza +
        '" data-h="' + f.altezza + '" title="' + esc(f.nome) + ' — ' + mis + '">' +
        esc(f.nome) + '</button>' +
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
    var o = State.data.sheetOrigin;
    var art = State.data.art;
    if (!art || !art.length) {
      State.data.path = [];
      renderPath();
      State.emit('path');
      return;
    }
    var seg = [], cur = { x: -o.x, y: -o.y };   // lo zero macchina, visto dal foglio

    /* Ogni segmento si porta dietro il TRATTO a cui appartiene. Serve al
       cursore dell'anteprima per sapere a quale confine fra due tratti
       corrisponde la posizione in cui sta, che è l'unico posto in cui una
       pausa si può mettere. */
    for (var i = 0; i < art.length; i++) {
      var poly = art[i];
      if (poly.length < 2) continue;
      seg.push({ x1: cur.x + o.x, y1: cur.y + o.y,
                 x2: poly[0].x + o.x, y2: poly[0].y + o.y, draw: false, poly: i });
      for (var j = 1; j < poly.length; j++) {
        seg.push({ x1: poly[j - 1].x + o.x, y1: poly[j - 1].y + o.y,
                   x2: poly[j].x + o.x, y2: poly[j].y + o.y, draw: true, poly: i });
      }
      cur = poly[poly.length - 1];
    }

    State.data.path = seg;
    renderPath();
    renderPause();
    State.emit('path');
  }

  function renderPath() {
    var seg = State.data.path, out = '';
    for (var i = 0; i < seg.length; i++) {
      var s = seg[i];
      out += '<line class="' + (s.draw ? 'trace-draw' : 'trace-move') +
             '" x1="' + s.x1 + '" y1="' + s.y1 +
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
        /* Con più livelli sovrapposti il punto non basta a dire quale si
           vuole. Si prende quello disegnato più in alto; e se è già lui il
           scelto, si passa a quello sotto — così clic ripetuti nello stesso
           posto girano fra i sovrapposti invece di ripescare sempre lo
           stesso. L'elenco a sinistra resta la via sicura. */
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
      var sulFoglio = !!e.target.closest('.sheet');
      var centrale = e.button === 1;
      if (!centrale && sulFoglio && !State.data.foglioMisurato) return;
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

  function enableDrag() {
    var grab = null;

    layerSheet.addEventListener('pointerdown', function (e) {
      /* Foglio misurato = foglio fermo. Trascinarlo dopo averlo misurato
         sposterebbe il disegno sulla carta vera senza che niente lo dica. */
      if (State.data.foglioMisurato) return;
      var rect = e.target.closest('.sheet');
      if (!rect) return;
      var m = toMm(e);
      grab = { dx: m.x - State.data.sheetOrigin.x, dy: m.y - State.data.sheetOrigin.y };
      rect.classList.add('is-dragging');
      layerSheet.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    layerSheet.addEventListener('pointermove', function (e) {
      if (!grab) return;
      var m = toMm(e);
      /* Arrotondato al millimetro: su una macchina tarata a mano, una
         posizione con tre decimali sarebbe una precisione finta. */
      setSheetOrigin(Math.round(m.x - grab.dx), Math.round(m.y - grab.dy));
    });

    ['pointerup', 'pointercancel'].forEach(function (ev) {
      layerSheet.addEventListener(ev, function (e) {
        if (!grab) return;
        grab = null;
        var r = layerSheet.querySelector('.sheet');
        if (r) r.classList.remove('is-dragging');
        layerSheet.releasePointerCapture(e.pointerId);
      });
    });
  }

  function setSheetOrigin(x, y) {
    State.data.sheetOrigin = { x: x, y: y };
    document.getElementById('sheet-x').value = x;
    document.getElementById('sheet-y').value = y;
    renderSheet();
    rebuildPath();
    /* Il disegno sta sulla carta: se la carta si sposta, il riquadro che lo
       circonda si sposta con lei. Il rettangolo in Artwork non cambia — è in
       millimetri del foglio — ma dove cade sullo schermo sì. */
    if (window.Selezione) Selezione.ridisegna();
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
     quello». È l'unico stato che serve, e sta qui invece che nel DOM. */
  var inModifica = null;

  function apriModale(id) {
    var f = id ? Profile.trovaFormato(id) : null;
    if (id && !f) return;
    inModifica = id || null;
    document.getElementById('fog-titolo').textContent =
      f ? 'Modifica «' + f.nome + '»' : 'Nuovo foglio';
    document.getElementById('fog-nome').value =
      f ? f.nome : State.data.paper.w + ' × ' + State.data.paper.h;
    document.getElementById('fog-w').value = f ? f.larghezza : State.data.paper.w;
    document.getElementById('fog-h').value = f ? f.altezza : State.data.paper.h;
    document.getElementById('fog-nota').textContent = '';
    document.getElementById('fog-modal').hidden = false;
    document.getElementById('fog-nome').focus();
    document.getElementById('fog-nome').select();
  }

  function chiudiModale() {
    document.getElementById('fog-modal').hidden = true;
    inModifica = null;
  }

  function salvaModale() {
    var nome = document.getElementById('fog-nome').value.trim();
    var w = Math.round(+document.getElementById('fog-w').value);
    var h = Math.round(+document.getElementById('fog-h').value);
    var nota = document.getElementById('fog-nota');

    if (!nome) { nota.textContent = 'Serve un nome: senza, il pulsante è vuoto.'; return; }
    if (!(w >= 20 && w <= 400 && h >= 20 && h <= 400)) {
      nota.textContent = 'Le misure stanno fra 20 e 400 mm.';
      return;
    }

    if (inModifica) Profile.modificaFormato(inModifica, nome, w, h);
    else Profile.aggiungiFormato(nome, w, h);

    chiudiModale();
    renderFormati();
    setSize(w, h);
    Log.add('msg', 'Foglio «' + nome + '» ' + w + ' × ' + h + ' mm salvato.');
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
    document.getElementById('preset-row').addEventListener('click', function (e) {
      var ed = e.target.closest('[data-fog-edit]');
      if (ed) { apriModale(ed.dataset.fogEdit); return; }

      var del = e.target.closest('[data-fog-del]');
      if (del) { eliminaFormato(del.dataset.fogDel); return; }

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
    renderSegni: renderSegni, fissa: fissa
  };
})();
