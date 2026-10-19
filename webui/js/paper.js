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

  var FORMATI = { A4: [210, 297], A5: [148, 210], A6: [105, 148] };

  function nomeFormato(w, h) {
    for (var k in FORMATI) {
      if (FORMATI[k][0] === w && FORMATI[k][1] === h) return k;
      if (FORMATI[k][1] === w && FORMATI[k][0] === h) return k + ' orizzontale';
    }
    return 'Personalizzato';
  }

  /* --------------------------- il piano --------------------------- */

  function renderBed() {
    var a = State.data.area;
    svg.setAttribute('viewBox', '0 0 ' + a.w + ' ' + a.h);
    flip.setAttribute('transform', 'translate(0,' + a.h + ') scale(1,-1)');

    var out = '<rect class="bed" x="0" y="0" width="' + a.w + '" height="' + a.h + '"></rect>';

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

  function renderSheet() {
    var p = State.data.paper, o = State.data.sheetOrigin;
    layerSheet.innerHTML =
      '<rect class="sheet" x="' + o.x + '" y="' + o.y +
      '" width="' + p.w + '" height="' + p.h + '" rx="0.6"></rect>';

    var a = State.data.area;
    var fuori = o.x < 0 || o.y < 0 || o.x + p.w > a.w || o.y + p.h > a.h;
    layerSheet.firstChild.classList.toggle('sheet-out', fuori);

    caption.textContent =
      'Area ' + a.w + ' × ' + a.h + ' mm · foglio ' + p.name + ' ' + p.w + ' × ' + p.h + ' mm' +
      (fuori ? ' · il foglio esce dall’area' : '');
  }

  function apply() {
    State.data.paper.name = nomeFormato(State.data.paper.w, State.data.paper.h);
    renderBed();
    renderSheet();
    rebuildPath();
    State.emit('paper');
  }

  /* I due campi dell'area nella tab Impostazioni scrivono nel PROFILO, non
     solo nello stato: l'area è il limite di lavoro (corsa meno margine), e
     tenerne una seconda copia qui sarebbe il modo sicuro per vederle divergere.
     Quello che l'utente digita è il limite, quindi la corsa si ricava
     riaggiungendo il margine, che resta com'è.
     Nota: questi due campi spariranno quando la tab Impostazioni sarà
     riprogettata — lì corsa e margine si inseriscono separati, che è la forma
     giusta, perché sono due cose diverse. */
  function setArea(w, h) {
    var p = Profile.get();
    p.corse.x.corsa = w + p.corse.x.margine;
    p.corse.y.corsa = h + p.corse.y.margine;
    Profile.save();
    State.data.area = Profile.areaUtile();
    apply();
  }

  function setSize(w, h) {
    State.data.paper.w = w;
    State.data.paper.h = h;
    document.getElementById('paper-w').value = w;
    document.getElementById('paper-h').value = h;
    markPreset(w, h);
    apply();
  }

  function markPreset(w, h) {
    var btns = document.querySelectorAll('.preset');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('is-active',
        +btns[i].dataset.w === w && +btns[i].dataset.h === h);
    }
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

  function enableDrag() {
    var grab = null;

    layerSheet.addEventListener('pointerdown', function (e) {
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

  /* Rimette il foglio al centro dell'area: serve dopo aver cambiato formato,
     o dopo averlo trascinato fuori. */
  function centerSheet() {
    var a = State.data.area, p = State.data.paper;
    setSheetOrigin(Math.round((a.w - p.w) / 2), Math.round((a.h - p.h) / 2));
  }

  function init() {
    svg = document.getElementById('bed-svg');
    flip = document.getElementById('flip');
    caption = document.getElementById('stage-caption');
    layerBed = document.getElementById('layer-bed');
    layerSheet = document.getElementById('layer-sheet');
    layerTrace = document.getElementById('layer-trace');

    var presets = document.querySelectorAll('.preset');
    for (var i = 0; i < presets.length; i++) {
      presets[i].addEventListener('click', function () {
        setSize(+this.dataset.w, +this.dataset.h);
      });
    }

    ['paper-w', 'paper-h'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        setSize(+document.getElementById('paper-w').value || 10,
                +document.getElementById('paper-h').value || 10);
      });
    });

    ['sheet-x', 'sheet-y'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        setSheetOrigin(+document.getElementById('sheet-x').value || 0,
                       +document.getElementById('sheet-y').value || 0);
      });
    });

    document.getElementById('btn-rotate-paper').addEventListener('click', function () {
      setSize(State.data.paper.h, State.data.paper.w);
    });

    ['set-area-w', 'set-area-h'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        setArea(+document.getElementById('set-area-w').value || 100,
                +document.getElementById('set-area-h').value || 100);
      });
    });

    document.getElementById('btn-center-sheet').addEventListener('click', centerSheet);

    enableDrag();
    apply();
  }

  return {
    init: init, setSize: setSize, setArea: setArea,
    setSheetOrigin: setSheetOrigin, centerSheet: centerSheet,
    rebuildPath: rebuildPath
  };
})();
