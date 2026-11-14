/* Il riquadro di selezione attorno al disegno.
 *
 * Si apre con un doppio clic SUL DISEGNO, e da quel momento il trascinamento
 * dentro al riquadro muove il disegno, non il foglio e non la vista. È la
 * stessa area dello schermo, e chi la prende cambia a seconda di cosa si sta
 * facendo: senza una modalità esplicita, un trascinamento sul foglio sarebbe
 * sempre ambiguo fra «sposta la carta» e «sposta il disegno».
 *
 * Le maniglie agli angoli deformano. Tenendo le proporzioni è invece un
 * ingrandimento vero: è il caso normale, ma non è il predefinito, perché
 * schiacciare un disegno per farlo entrare in un foglio è una cosa che si
 * vuole fare apposta e si deve poter fare senza cercare un'opzione.
 *
 * CHI LO DICE: la spunta «tieni le proporzioni» accanto ai campi del livello,
 * e Shift, che fa il CONTRARIO di quello che dice la spunta. Fino al
 * 2026-11-14 lo diceva solo Shift, e su un tablet il tasto Shift non c'è:
 * dall'iPad il disegno si poteva solo deformare. Un comando che vive solo in
 * un tasto è un comando che su metà dei dispositivi non esiste — e anche su
 * un PC è una cosa che si sa o non si sa. La spunta lo rende visibile;
 * Shift resta la scorciatoia di chi ha le mani sulla tastiera, e capovolgere
 * invece di imporre è come lo fanno i programmi di disegno: la scelta
 * abituale si imposta una volta, l'eccezione si fa col tasto.
 *
 * Il riquadro vive in millimetri MACCHINA, come tutto il resto del piano;
 * il rettangolo che sta in Artwork è invece in millimetri del FOGLIO, perché
 * il disegno sta sulla carta e ci resta anche se la carta si sposta. La
 * differenza fra i due è l'origine del foglio, e si attraversa qui.
 */
var Selezione = (function () {
  var svg, flip, layer, suggerimento;
  var aperta = false;
  var presa = null;

  /* LE OTTO MANIGLIE. fx, fy dicono dove sta la presa sul rettangolo:
     0 = lato basso o sinistro, 1 = lato alto o destro, 0.5 = «quest'asse non
     si tocca». Da qui vengono sia gli angoli sia i punti di mezzo dei lati,
     senza due elenchi e due casi da tenere d'accordo.

     I punti di mezzo servono a deformare lungo un asse solo: prendendo un
     angolo e cercando di muoverlo dritto si sbaglia sempre di un pelo, e il
     disegno si schiaccia un po' anche nell'altro verso senza che si veda.

     Il cursore è quello dello SCHERMO, dove fy 0 sta in basso: per questo
     «bl» e «tr» condividono la freccia. */
  var MANIGLIE = [
    { id: 'bl', fx: 0,   fy: 0,   cur: 'nesw-resize' },
    { id: 'b',  fx: 0.5, fy: 0,   cur: 'ns-resize' },
    { id: 'br', fx: 1,   fy: 0,   cur: 'nwse-resize' },
    { id: 'r',  fx: 1,   fy: 0.5, cur: 'ew-resize' },
    { id: 'tr', fx: 1,   fy: 1,   cur: 'nesw-resize' },
    { id: 't',  fx: 0.5, fy: 1,   cur: 'ns-resize' },
    { id: 'tl', fx: 0,   fy: 1,   cur: 'nwse-resize' },
    { id: 'l',  fx: 0,   fy: 0.5, cur: 'ew-resize' }
  ];

  /* I quattro angoli, per le maniglie di rotazione. */
  var ANGOLI = [
    { id: 'bl', fx: 0, fy: 0 }, { id: 'br', fx: 1, fy: 0 },
    { id: 'tr', fx: 1, fy: 1 }, { id: 'tl', fx: 0, fy: 1 }
  ];

  /* La rotazione vale per un livello solo: vedi ridisegna(). */
  function unSolo() {
    return !!(window.Artwork && Artwork.scelti && Artwork.scelti().length === 1);
  }

  /* Quanto si avvicina a un angolo tondo prima di scattarci sopra. Cinque
     gradi: abbastanza da prendere l'orizzontale senza mirare, poco da poter
     comunque fermarsi a dodici se è dodici che si vuole. */
  var SCATTO = 5, PASSO = 15;

  /* Proporzioni sì o no, adesso: la spunta dice l'abitudine, Shift la
     capovolge. Si legge dal documento e non da una variabile nostra perché
     la spunta è l'unico posto in cui quella scelta vive — una copia qui
     dentro sarebbe una seconda verità da tenere allineata. */
  function proporzioni(e) {
    var c = document.getElementById('art-proporzioni');
    return !!(c && c.checked) !== !!e.shiftKey;
  }

  function maniglia(id) {
    for (var i = 0; i < MANIGLIE.length; i++) {
      if (MANIGLIE[i].id === id) return MANIGLIE[i];
    }
    return null;
  }

  /* Il rettangolo del disegno in millimetri macchina, o null se non c'è
     disegno da selezionare. */
  function rett() { return inMacchina(Artwork.riquadro()); }

  /* Il disegno intero, ritaglio compreso: si mostra in chiaro per far vedere
     quanto si sta tenendo fuori, e per sapere fin dove si può riaprire. */
  function rettPieno() { return inMacchina(Artwork.riquadroPieno()); }

  function inMacchina(b) {
    if (!b) return null;
    var o = State.data.sheetOrigin;
    return { x: b.x + o.x, y: b.y + o.y, w: b.w, h: b.h };
  }

  function toMm(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(flip.getScreenCTM().inverse());
  }

  /* Quanti millimetri è lungo un pixel adesso. Serve a tenere le maniglie
     della stessa misura sullo schermo a qualsiasi ingrandimento: disegnate
     con un lato fisso in millimetri, da vicino coprirebbero il disegno e da
     lontano sparirebbero. */
  function mmPerPixel() {
    var m = flip.getScreenCTM();
    return m && m.a ? 1 / Math.abs(m.a) : 0.1;
  }

  function dentro(p) {
    var r = rett();
    if (!r) return false;
    /* Un margine di tolleranza: il doppio clic si prende anche sul bordo, che
       è proprio dove uno clicca quando mira al disegno. */
    var t = 3 * mmPerPixel();
    return p.x >= r.x - t && p.x <= r.x + r.w + t &&
           p.y >= r.y - t && p.y <= r.y + r.h + t;
  }

  function ridisegna() {
    if (!layer) return;
    var r = aperta ? rett() : null;
    if (!r) { layer.innerHTML = ''; return; }

    /* Il lato della maniglia si calcola in millimetri ma vale nove pixel: lo
       spessore dei fili invece lo tiene il CSS, con non-scaling-stroke. */
    var lato = 9 * mmPerPixel();

    /* COL DITO, LA ZONA CHE RISPONDE E` PIU` LARGA DEL QUADRATINO.
       Nove pixel sono comodi per una punta e sono una mira per un
       polpastrello, che copre una zona di una quarantina e il cui centro chi
       tocca non vede. Ingrandire il quadratino VISIBILE pero' coprirebbe il
       disegno proprio mentre lo si sta ridimensionando, cioe' mentre si
       guarda: quindi il segno resta di nove pixel e sotto le dita si mette
       un rettangolo trasparente piu' grande, con lo stesso nome di maniglia.
       Si disegna DOPO quello visibile perche' deve stare sopra. */
    var dito = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var presa = 30 * mmPerPixel();
    var out = '';

    /* Il disegno intero, quando una parte è tagliata via: tratteggiato e
       smorzato, perché non è una cosa da disegnare — è il promemoria che
       tirando indietro la stessa maniglia torna fuori. */
    var pieno = rettPieno();
    if (Artwork.ritagliato() && pieno) {
      out += '<rect class="sel-pieno" x="' + pieno.x + '" y="' + pieno.y +
             '" width="' + pieno.w + '" height="' + pieno.h + '"></rect>';
    }

    out += '<rect class="sel-box" x="' + r.x + '" y="' + r.y +
           '" width="' + r.w + '" height="' + r.h + '"></rect>';

    for (var i = 0; i < MANIGLIE.length; i++) {
      var a = MANIGLIE[i];
      var cx = r.x + a.fx * r.w, cy = r.y + a.fy * r.h;
      out += '<rect class="sel-grip" data-grip="' + a.id +
             '" style="cursor:' + a.cur + '"' +
             ' x="' + (cx - lato / 2) + '" y="' + (cy - lato / 2) +
             '" width="' + lato + '" height="' + lato + '"></rect>';
      if (dito) {
        out += '<rect class="sel-presa" data-grip="' + a.id +
               '" x="' + (cx - presa / 2) + '" y="' + (cy - presa / 2) +
               '" width="' + presa + '" height="' + presa + '"></rect>';
      }
    }

    /* LE MANIGLIE DI ROTAZIONE, appena fuori dai quattro angoli. Stanno
       FUORI e sono tonde perché la presa e il gesto sono diversi da quelli
       della scala: lì si tira un lato, qui si gira attorno al centro, e due
       cose diverse nello stesso posto con la stessa forma si sbagliano.

       Ci sono solo con UN livello scelto. Con più d'uno non è che sarebbe
       difficile: sarebbe ambiguo, perché ogni livello ha la sua rotazione e
       il suo rettangolo, e girarli tutti attorno a un centro comune vorrebbe
       dire spostarli, non ruotarli — un'altra operazione, che nessuno ha
       chiesto. */
    if (unSolo()) {
      var fuori = 13 * mmPerPixel(), raggio = 5 * mmPerPixel();
      for (var k = 0; k < ANGOLI.length; k++) {
        var g = ANGOLI[k];
        var gx = r.x + g.fx * r.w + (g.fx === 1 ? fuori : -fuori);
        var gy = r.y + g.fy * r.h + (g.fy === 1 ? fuori : -fuori);
        out += '<circle class="sel-ruota" data-ruota="' + g.id +
               '" cx="' + gx + '" cy="' + gy + '" r="' + raggio + '"></circle>';
      }
    }

    layer.innerHTML = out;
  }

  function apri() {
    if (!Artwork.riquadro()) return;
    aperta = true;
    if (suggerimento) suggerimento.hidden = false;
    ridisegna();
  }

  function chiudi() {
    if (!aperta) return;
    aperta = false;
    presa = null;
    if (suggerimento) suggerimento.hidden = true;
    ridisegna();
  }

  function attiva() { return aperta; }

  /* Arrotondato al decimo: dove sta il disegno sul foglio è una scelta a
     occhio, non una misura, ma a forte ingrandimento il millimetro intero si
     sentirebbe come un attrito sotto le dita. */
  function dec(v) { return Math.round(v * 10) / 10; }

  function init() {
    svg = document.getElementById('bed-svg');
    flip = document.getElementById('flip');
    layer = document.getElementById('layer-sel');
    suggerimento = document.getElementById('sel-hint');
    if (!svg || !flip || !layer) return;

    layer.addEventListener('pointerdown', function (e) {
      if (!aperta) return;
      var r = rett();
      if (!r) return;
      var m = toMm(e);

      var ruo = e.target.closest('[data-ruota]');
      if (ruo) {
        /* Lo stato di partenza, fotografato una volta: ogni movimento ruota
           a partire da QUI, non da dove si era arrivati all'evento prima.
           Ruotare il già ruotato accumula. */
        var base = Artwork.statoRot();
        if (!base) return;
        presa = {
          tipo: 'ruota',
          c: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
          base: base,
          rot0: base.rot,
          a0: 0
        };
        presa.a0 = Math.atan2(m.y - presa.c.y, m.x - presa.c.x);
        layer.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      var g = e.target.closest('[data-grip]');
      if (g) {
        var a = maniglia(g.dataset.grip);
        presa = {
          /* IL TASTO DECIDE COSA SI STA FACENDO: sinistro deforma il disegno,
             destro taglia. Sono due cose diverse e vanno distinte sul posto,
             perché la maniglia è la stessa e il gesto pure. */
          tipo: e.button === 2 ? 'taglia' : 'scala',
          a: a, r0: r, pieno0: rettPieno(),
          /* L'angolo opposto non si muove: è il perno del ridimensionamento,
             ed è tenerlo fermo che fa sembrare la maniglia attaccata al
             disegno. Sugli assi che la maniglia non tocca (fx o fy a 0.5) non
             c'è nessun perno, perché non si muove niente. */
          perno: { x: r.x + (1 - a.fx) * r.w, y: r.y + (1 - a.fy) * r.h }
        };
      } else {
        presa = { tipo: 'sposta', dx: m.x - r.x, dy: m.y - r.y, r0: r };
      }

      layer.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    /* Il menu del tasto destro va tolto solo QUI, sul riquadro: altrove il
       tasto destro deve continuare a fare quello che fa sempre. */
    layer.addEventListener('contextmenu', function (e) {
      if (aperta) e.preventDefault();
    });

    layer.addEventListener('pointermove', function (e) {
      if (!presa) return;
      var m = toMm(e), o = State.data.sheetOrigin;

      if (presa.tipo === 'ruota') {
        var ang = Math.atan2(m.y - presa.c.y, m.x - presa.c.x);
        /* Sul piano la y cresce verso l'alto, quindi un angolo matematico che
           cresce è un giro antiorario sullo schermo; la rotazione del disegno
           invece conta in senso orario. Da qui il segno. */
        var d = (presa.a0 - ang) * 180 / Math.PI;
        var gradi = presa.rot0 + d;
        /* Shift libera lo scatto: di solito si vuole cadere su un angolo
           tondo, ogni tanto no. */
        if (!e.shiftKey) {
          var vicino = Math.round(gradi / PASSO) * PASSO;
          if (Math.abs(gradi - vicino) < SCATTO) gradi = vicino;
        }
        gradi = ((Math.round(gradi * 10) / 10) % 360 + 360) % 360;
        Artwork.ruotaA(gradi, presa.base);
        Artwork.refit();
        if (Artwork.aggiornaCampi) Artwork.aggiornaCampi();
        return;
      }

      if (presa.tipo === 'sposta') {
        Artwork.collocaA({ x: dec(m.x - presa.dx - o.x), y: dec(m.y - presa.dy - o.y),
                           w: presa.r0.w, h: presa.r0.h });
        return;
      }

      var a = presa.a, p = presa.perno, r0 = presa.r0;

      /* Un asse con fattore 0.5 non si tocca: la maniglia sta in mezzo a quel
         lato, e muoverla lungo quell'asse non vuol dire niente. */
      var w = a.fx === 0.5 ? r0.w : Math.abs(m.x - p.x);
      var h = a.fy === 0.5 ? r0.h : Math.abs(m.y - p.y);

      if (presa.tipo === 'scala' && proporzioni(e) && r0.w > 0 && r0.h > 0) {
        var k;
        if (a.fx === 0.5)      k = h / r0.h;      // comanda il lato verticale
        else if (a.fy === 0.5) k = w / r0.w;      // comanda quello orizzontale
        else {
          /* PROPORZIONI BLOCCATE SU UN ANGOLO: il puntatore si proietta sulla
             diagonale del rettangolo di partenza, e la proiezione è il
             fattore di scala. Il primo tentativo prendeva il maggiore fra i
             due rapporti, e non funzionava: muovendo solo in orizzontale il
             rapporto verticale restava pari a uno, il massimo valeva uno, e
             il disegno non si muoveva — con Shift si poteva ingrandire e mai
             rimpicciolire. Con la proiezione un movimento lungo la diagonale
             scala esatto, uno perpendicolare non fa niente, uno obliquo fa la
             sua parte. */
          k = (w * r0.w + h * r0.h) / (r0.w * r0.w + r0.h * r0.h);
        }
        w = r0.w * k;
        h = r0.h * k;
      }

      w = Math.max(2, w);
      h = Math.max(2, h);

      /* Il lato si estende SEMPRE dalla parte in cui stava: tirando oltre il
         perno il disegno non si specchia, si ferma. Uno specchio chiesto per
         sbaglio è un disegno da rifare, e per averlo apposta c'è la
         rotazione. */
      var x = a.fx === 0.5 ? r0.x : (a.fx === 1 ? p.x : p.x - w);
      var y = a.fy === 0.5 ? r0.y : (a.fy === 1 ? p.y : p.y - h);

      /* Con Shift su una maniglia di mezzo cresce anche l'altro lato, e lo fa
         attorno al proprio centro: il lato tirato resta ancorato al suo
         opposto, l'altro si apre da tutt'e due le parti. */
      if (presa.tipo === 'scala' && proporzioni(e)) {
        if (a.fx === 0.5) x = r0.x + r0.w / 2 - w / 2;
        if (a.fy === 0.5) y = r0.y + r0.h / 2 - h / 2;
      }

      /* SI ARROTONDA SOLO QUELLO CHE SI È MOSSO. Arrotondare al decimo anche
         l'asse fermo lo spostava fino a mezzo decimo a ogni movimento del
         mouse: tirando il lato destro, il lato opposto scivolava e l'altezza
         cambiava da sola. Invisibile a occhio, ma è deriva, e a forza di
         trascinamenti il disegno non torna più alle misure che dice di avere.
         Trovato dal collaudo, che misura invece di guardare. */
      var muoveX = a.fx !== 0.5 || (presa.tipo === 'scala' && proporzioni(e));
      var muoveY = a.fy !== 0.5 || (presa.tipo === 'scala' && proporzioni(e));

      var nuovo = {
        x: muoveX ? dec(x - o.x) : r0.x - o.x,
        y: muoveY ? dec(y - o.y) : r0.y - o.y,
        w: muoveX ? dec(w) : r0.w,
        h: muoveY ? dec(h) : r0.h
      };
      if (presa.tipo === 'taglia') Artwork.ritagliaA(nuovo);
      else Artwork.collocaA(nuovo);
    });

    ['pointerup', 'pointercancel'].forEach(function (ev) {
      layer.addEventListener(ev, function (e) {
        if (!presa) return;
        presa = null;
        layer.releasePointerCapture(e.pointerId);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && aperta) chiudi();
    });

    /* Ingrandendo cambia quanto vale un pixel, e le maniglie vanno ridisegnate
       con la misura nuova. */
    State.on('vista', ridisegna);
  }

  return { init: init, apri: apri, chiudi: chiudi, attiva: attiva,
           dentro: dentro, ridisegna: ridisegna };
})();
