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
  var svg, flip, caption, layerBed, layerSheet, layerTrace;

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
     si somma soltanto al momento di disegnare, in rebuildPath. */
  function demoArt() {
    var p = State.data.paper;
    var m = Math.min(p.w, p.h) * 0.18;
    var x0 = m, y0 = m, x1 = p.w - m, y1 = p.h - m;

    var quad = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 },
                { x: x0, y: y1 }, { x: x0, y: y0 }];

    var cx = p.w / 2, cy = p.h / 2, r = Math.min(p.w, p.h) * 0.22, cer = [];
    for (var i = 0; i <= 72; i++) {
      var a = i / 72 * Math.PI * 2;
      cer.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return [quad, cer];
  }

  /* Dalle polilinee del foglio ai segmenti in coordinate macchina, con gli
     spostamenti a penna alzata resi espliciti: sono corsa vera e devono
     comparire nell'anteprima come tutto il resto. */
  function rebuildPath() {
    var o = State.data.sheetOrigin;
    var art = State.data.art || demoArt();
    var seg = [], cur = { x: -o.x, y: -o.y };   // lo zero macchina, visto dal foglio

    for (var i = 0; i < art.length; i++) {
      var poly = art[i];
      if (poly.length < 2) continue;
      seg.push({ x1: cur.x + o.x, y1: cur.y + o.y,
                 x2: poly[0].x + o.x, y2: poly[0].y + o.y, draw: false });
      for (var j = 1; j < poly.length; j++) {
        seg.push({ x1: poly[j - 1].x + o.x, y1: poly[j - 1].y + o.y,
                   x2: poly[j].x + o.x, y2: poly[j].y + o.y, draw: true });
      }
      cur = poly[poly.length - 1];
    }

    State.data.path = seg;
    renderPath();
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

    /* Doppio clic sul fondo: si torna a vedere tutto. Sul foglio no — lì il
       doppio clic è due clic, e il foglio si trascina. */
    svg.addEventListener('dblclick', function (e) {
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

    /* Un ascoltatore sulla riga invece di uno per pulsante: i fogli
       dell'operatore nascono e muoiono mentre la pagina è aperta, e agganciare
       i listener ai nodi vuol dire ricordarsi di riagganciarli ogni volta —
       cioè dimenticarsene una volta. */
    document.getElementById('preset-row').addEventListener('click', function (e) {
      var ed = e.target.closest('[data-fog-edit]');
      if (ed) { apriModale(ed.dataset.fogEdit); return; }

      var del = e.target.closest('[data-fog-del]');
      if (del) { eliminaFormato(del.dataset.fogDel); return; }

      var p = e.target.closest('.preset');
      if (p) setSize(+p.dataset.w, +p.dataset.h);
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
    rebuildPath: rebuildPath, fissa: fissa
  };
})();
