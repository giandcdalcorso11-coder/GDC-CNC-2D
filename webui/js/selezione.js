/* Il riquadro di selezione attorno al disegno.
 *
 * Si apre con un doppio clic SUL DISEGNO, e da quel momento il trascinamento
 * dentro al riquadro muove il disegno, non il foglio e non la vista. È la
 * stessa area dello schermo, e chi la prende cambia a seconda di cosa si sta
 * facendo: senza una modalità esplicita, un trascinamento sul foglio sarebbe
 * sempre ambiguo fra «sposta la carta» e «sposta il disegno».
 *
 * Le maniglie agli angoli deformano. Con Shift tengono le proporzioni, e
 * allora è un ingrandimento vero: è il caso normale, ma non è il
 * predefinito, perché schiacciare un disegno per farlo entrare in un foglio
 * è una cosa che si vuole fare apposta e si deve poter fare senza cercare
 * un'opzione.
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

  /* fx, fy: 0 = lato basso/sinistro, 1 = lato alto/destro, in coordinate
     macchina (Y verso l'alto). Il cursore invece è quello dello SCHERMO,
     dove fy 0 sta in basso: per questo «bl» e «tr» condividono la freccia. */
  var ANGOLI = [
    { id: 'bl', fx: 0, fy: 0, cur: 'nesw-resize' },
    { id: 'br', fx: 1, fy: 0, cur: 'nwse-resize' },
    { id: 'tl', fx: 0, fy: 1, cur: 'nwse-resize' },
    { id: 'tr', fx: 1, fy: 1, cur: 'nesw-resize' }
  ];

  function angolo(id) {
    for (var i = 0; i < ANGOLI.length; i++) if (ANGOLI[i].id === id) return ANGOLI[i];
    return null;
  }

  /* Il rettangolo del disegno in millimetri macchina, o null se non c'è
     disegno da selezionare. */
  function rett() {
    var b = Artwork.riquadro();
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
    var out = '<rect class="sel-box" x="' + r.x + '" y="' + r.y +
              '" width="' + r.w + '" height="' + r.h + '"></rect>';

    for (var i = 0; i < ANGOLI.length; i++) {
      var a = ANGOLI[i];
      var cx = r.x + a.fx * r.w, cy = r.y + a.fy * r.h;
      out += '<rect class="sel-grip" data-grip="' + a.id +
             '" style="cursor:' + a.cur + '"' +
             ' x="' + (cx - lato / 2) + '" y="' + (cy - lato / 2) +
             '" width="' + lato + '" height="' + lato + '"></rect>';
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

      var g = e.target.closest('[data-grip]');
      if (g) {
        var a = angolo(g.dataset.grip);
        presa = { tipo: 'angolo', a: a, r0: r,
                  /* l'angolo opposto non si muove: è il perno di tutto il
                     ridimensionamento, e tenerlo fermo è ciò che fa sembrare
                     la maniglia attaccata al disegno */
                  perno: { x: r.x + (1 - a.fx) * r.w, y: r.y + (1 - a.fy) * r.h } };
      } else {
        presa = { tipo: 'sposta', dx: m.x - r.x, dy: m.y - r.y, r0: r };
      }

      layer.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    layer.addEventListener('pointermove', function (e) {
      if (!presa) return;
      var m = toMm(e), o = State.data.sheetOrigin;

      if (presa.tipo === 'sposta') {
        Artwork.collocaA({ x: dec(m.x - presa.dx - o.x), y: dec(m.y - presa.dy - o.y),
                           w: presa.r0.w, h: presa.r0.h });
        return;
      }

      var a = presa.a, p = presa.perno, r0 = presa.r0;
      var w = Math.abs(m.x - p.x), h = Math.abs(m.y - p.y);

      if (e.shiftKey && r0.w > 0 && r0.h > 0) {
        /* PROPORZIONI BLOCCATE: il puntatore si proietta sulla diagonale del
           rettangolo di partenza, e la proiezione è il fattore di scala.
           Il primo tentativo prendeva il maggiore fra i due rapporti, e non
           funzionava: muovendo solo in orizzontale il lato verticale restava
           pari a uno, il massimo valeva uno, e il disegno non si muoveva —
           con Shift si poteva ingrandire e mai rimpicciolire. Con la
           proiezione, invece, un movimento lungo la diagonale scala esatto,
           uno perpendicolare non fa niente, e uno obliquo fa la sua parte.

           Il rapporto è quello di PARTENZA del trascinamento, non quello
           naturale del disegno: Shift ingrandisce quello che c'è, non rimette
           in squadra di nascosto un disegno schiacciato apposta. */
        var k = (w * r0.w + h * r0.h) / (r0.w * r0.w + r0.h * r0.h);
        w = r0.w * k;
        h = r0.h * k;
      }

      w = Math.max(2, w);
      h = Math.max(2, h);

      /* Il lato si estende SEMPRE dalla parte in cui stava: tirando oltre il
         perno il disegno non si specchia, si ferma. Uno specchio chiesto per
         sbaglio è un disegno da rifare, e per averlo apposta c'è la
         rotazione. */
      var x = a.fx === 1 ? p.x : p.x - w;
      var y = a.fy === 1 ? p.y : p.y - h;

      Artwork.collocaA({ x: dec(x - o.x), y: dec(y - o.y), w: dec(w), h: dec(h) });
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
