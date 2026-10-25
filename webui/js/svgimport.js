/* Lettura di un file SVG e conversione in polilinee in millimetri.
 *
 * L'appiattimento delle curve lo fa il browser, non noi: ogni forma vettoriale
 * espone getTotalLength e getPointAtLength, quindi si campiona per lunghezza
 * d'arco e si ottengono punti equidistanti lungo la curva. Riscrivere a mano
 * la matematica delle Bézier significherebbe rifare, peggio, una cosa che il
 * motore grafico fa già in modo esatto.
 *
 * Il campionamento per lunghezza d'arco regala anche il riconoscimento dei
 * sotto-tracciati: due campioni consecutivi non possono mai distare piu' del
 * passo scelto, quindi un salto piu' lungo e' per forza uno stacco di penna
 * dentro lo stesso elemento (il foro di una "o", per dire). Senza questo
 * controllo comparirebbe una riga che attraversa la lettera.
 */
var SvgImport = (function () {

  var SELECTOR = 'path,line,polyline,polygon,circle,ellipse,rect';
  var scarti = { sfondi: 0, piene: 0 };   // forme saltate all'ultima lettura

  function parse(text) {
    var holder = document.createElement('div');
    /* Fuori schermo ma non display:none: un elemento non disegnato non ha
       matrice di trasformazione, e i conti sulle coordinate fallirebbero. */
    holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;height:900px;overflow:hidden';
    holder.innerHTML = text;
    document.body.appendChild(holder);

    try {
      var svg = holder.querySelector('svg');
      if (!svg) throw new Error('Il file non contiene un elemento <svg>.');

      var rootInv = svg.getScreenCTM();
      if (!rootInv) throw new Error('L’SVG non ha una geometria leggibile.');
      rootInv = rootInv.inverse();

      /* La tela: serve a riconoscere lo sfondo, vedi sfondo() qui sotto. */
      var vb = svg.viewBox ? svg.viewBox.baseVal : null;

      var els = svg.querySelectorAll(SELECTOR);
      var polys = [];
      scarti = { sfondi: 0, piene: 0 };

      /* Un file di linee o un file di forme? La risposta cambia il significato
         di una forma piena, vedi saltare() qui sotto. */
      var aLinee = false;
      for (var k = 0; k < els.length && !aLinee; k++) {
        if (haBordo(els[k])) aLinee = true;
      }

      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (typeof el.getTotalLength !== 'function') continue;

        var len = 0;
        try { len = el.getTotalLength(); } catch (e) { continue; }
        if (!isFinite(len) || len <= 0) continue;

        /* Il passo: fitto abbastanza da non tagliare le curve, non cosi' fitto
           da produrre centomila punti su una forma sola. Il diradamento
           successivo toglie comunque i punti inutili sui tratti dritti. */
        var step = Math.max(len / 3000, 0.35);
        var m = rootInv.multiply(el.getScreenCTM());
        if (saltare(el, m, vb, aLinee)) continue;

        var pt = svg.createSVGPoint();

        var cur = [], prev = null, s;
        for (s = 0; s <= len + 1e-6; s += step) {
          var raw = el.getPointAtLength(Math.min(s, len));
          pt.x = raw.x; pt.y = raw.y;
          var p = pt.matrixTransform(m);

          if (prev && dist(prev, p) > step * 1.8 * scaleOf(m)) {
            if (cur.length > 1) polys.push(cur);
            cur = [];
          }
          cur.push({ x: p.x, y: p.y });
          prev = p;
        }
        if (cur.length > 1) polys.push(cur);
      }

      if (!polys.length) throw new Error('Nessun tracciato trovato nel file.');
      return polys;

    } finally {
      holder.remove();
    }
  }

  function haBordo(el) {
    var cs = window.getComputedStyle(el);
    return !!(cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0);
  }

  /* Non tutto quello che c'e' in un file va tracciato.
   *
   * Un SVG prodotto da un programma — i nostri compresi — porta con se' roba
   * che serve solo a guardarlo a schermo: il rettangolo bianco di fondo, che
   * altrimenti si vedrebbe trasparente, e i riferimenti colorati, come il
   * pallino rosso che segna il punto home. Una penna non ha ne' il bianco ne'
   * il rosso: disegnarli vuol dire una cornice e un cerchietto di troppo sul
   * foglio, e nel caso dello sfondo anche un ingombro piu' largo del disegno
   * vero, che e' il numero con cui si decide la scala.
   *
   * Il discrimine e' il BORDO, non il riempimento:
   *
   * - se nel file c'e' almeno una forma col bordo, allora il disegno e' fatto
   *   di linee e le forme senza bordo sono decorazione: si saltano;
   * - se invece nel file NON c'e' un solo bordo, il disegno e' fatto di forme
   *   piene — una clipart, un logo — e quelle forme sono tutto quello che c'e':
   *   si tracciano come contorni, che e' la regola scritta nell'interfaccia.
   *   Li' si salta solo chi copre l'intera tela, perche' quello e' per forza
   *   lo sfondo.
   *
   * Il caso che questa regola sbaglia e' il file misto, con una forma piena
   * che fa parte per davvero di un disegno di linee: quella si perde. Si
   * preferisce comunque, perche' si vede subito nell'anteprima e il log dice
   * quante forme sono state saltate, mentre lo sfondo disegnato si scopre a
   * stampa finita.
   *
   * Senza viewBox non si sa quanto e' grande la tela: li' il secondo caso non
   * salta niente, e si disegna un rettangolo di troppo invece di rischiare di
   * perdere il disegno. */
  function saltare(el, m, vb, aLinee) {
    if (haBordo(el)) return false;

    if (aLinee) { scarti.piene++; return true; }

    if (!vb || !(vb.width > 0) || !(vb.height > 0)) return false;

    var b;
    try { b = el.getBBox(); } catch (e) { return false; }
    if (!b || !(b.width > 0) || !(b.height > 0)) return false;

    /* L'ingombro va portato nelle coordinate della radice: una forma dentro a
       un <g> trasformato e' grande quanto dice la sua matrice, non quanto dice
       il suo getBBox. */
    var xs = [b.x, b.x + b.width], ys = [b.y, b.y + b.height];
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < 2; i++) {
      for (var j = 0; j < 2; j++) {
        var x = m.a * xs[i] + m.c * ys[j] + m.e;
        var y = m.b * xs[i] + m.d * ys[j] + m.f;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if ((x1 - x0) >= vb.width * 0.98 && (y1 - y0) >= vb.height * 0.98) {
      scarti.sfondi++;
      return true;
    }
    return false;
  }

  function scaleOf(m) {
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  }

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  function bbox(polys) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (var i = 0; i < polys.length; i++) {
      for (var j = 0; j < polys[i].length; j++) {
        var p = polys[i][j];
        if (p.x < b.x0) b.x0 = p.x;
        if (p.y < b.y0) b.y0 = p.y;
        if (p.x > b.x1) b.x1 = p.x;
        if (p.y > b.y1) b.y1 = p.y;
      }
    }
    b.w = b.x1 - b.x0;
    b.h = b.y1 - b.y0;
    return b;
  }

  /* IL DISEGNO STA DENTRO A UN RETTANGOLO, e tutto il resto discende da li'.
     Scala, rotazione, trascinamento e deformazione non si compongono uno
     sull'altro: cambiano il rettangolo, e le polilinee grezze ci vengono
     rimappate dentro da capo. Trasformare ogni volta il risultato precedente
     accumula errore a ogni giro, e dopo dieci trascinamenti il disegno non
     tornerebbe piu' alle misure che dice di avere.

     Qui avviene anche il ribaltamento dell'asse Y: in SVG cresce verso il
     basso, sul foglio verso l'alto. */
  function toRect(polys, rect) {
    var b = bbox(polys);
    var kx = b.w > 0 ? rect.w / b.w : 1;
    var ky = b.h > 0 ? rect.h / b.h : 1;

    var out = [];
    for (var i = 0; i < polys.length; i++) {
      var src = polys[i], dst = [];
      for (var j = 0; j < src.length; j++) {
        dst.push({
          x: rect.x + (src[j].x - b.x0) * kx,
          y: rect.y + (b.y1 - src[j].y) * ky
        });
      }
      out.push(dst);
    }
    return out;
  }

  /* Il rettangolo di partenza: il disegno piu' grande che entra nel foglio
     lasciando un margine, centrato, poi ridotto dalla percentuale.
     Il margine dell'8% non e' estetica: un disegno a filo del foglio finisce
     sotto le dita di chi lo appoggia, e sulla macchina a filo della corsa. */
  var MARGINE = 0.92;

  function baseK(polys, sheet) {
    var b = bbox(polys);
    if (!(b.w > 0) || !(b.h > 0)) return 1;
    return Math.min(sheet.w * MARGINE / b.w, sheet.h * MARGINE / b.h);
  }

  function fitRect(polys, sheet, percent) {
    var b = bbox(polys);
    var k = baseK(polys, sheet) * (percent / 100);
    var w = b.w * k, h = b.h * k;
    return { x: (sheet.w - w) / 2, y: (sheet.h - h) / 2, w: w, h: h };
  }

  /* La strada inversa: da un rettangolo qualsiasi alle due percentuali che lo
     descrivono. Sono due e non una perche' un angolo trascinato senza Shift
     schiaccia il disegno, e dirlo con un numero solo vorrebbe dire nasconderlo. */
  function percentuali(polys, sheet, rect) {
    var b = bbox(polys), k = baseK(polys, sheet);
    return { x: b.w * k > 0 ? rect.w / (b.w * k) * 100 : 100,
             y: b.h * k > 0 ? rect.h / (b.h * k) * 100 : 100 };
  }

  /* RITAGLIO: tiene solo quello che sta dentro al rettangolo.
   *
   * Non e' una maschera da disegnare sopra — una penna non ha un bianco con
   * cui coprire — e non e' una cancellazione: le polilinee grezze restano
   * intatte, e il ritaglio si riapplica ogni volta a partire da quelle. Per
   * questo si puo' allargare di nuovo e il disegno ricompare.
   *
   * Un tratto che entra ed esce piu' volte dal rettangolo si spezza in piu'
   * pezzi, che e' giusto: sono alzate di penna vere, e devono comparire
   * nell'anteprima e nel tempo stimato come tutte le altre.
   */
  function ritaglia(polys, r) {
    var x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
    var out = [];

    for (var i = 0; i < polys.length; i++) {
      var src = polys[i], cur = null;
      for (var j = 1; j < src.length; j++) {
        var c = taglia(src[j - 1], src[j], x0, y0, x1, y1);
        if (!c) {                       // segmento tutto fuori: il tratto si chiude
          if (cur && cur.length > 1) out.push(cur);
          cur = null;
          continue;
        }
        /* Si prosegue il tratto in corso solo se questo segmento comincia
           esattamente dove quello prima era finito: se è entrato più in là,
           in mezzo c'è un pezzo fuori, e unirli disegnerebbe una riga che
           attraversa la parte tagliata. */
        if (cur && c.t0 === 0) cur.push(c.b);
        else {
          if (cur && cur.length > 1) out.push(cur);
          cur = [c.a, c.b];
        }
        if (c.t1 < 1) {                 // esce di qui: il tratto finisce
          if (cur.length > 1) out.push(cur);
          cur = null;
        }
      }
      if (cur && cur.length > 1) out.push(cur);
    }
    return out;
  }

  /* Liang-Barsky: il segmento si guarda come un parametro da 0 a 1 e ogni
     lato del rettangolo stringe l'intervallo. Se l'intervallo si svuota il
     segmento è tutto fuori. Più corto e più robusto del tagliare lato per
     lato, che su un segmento obliquo sbaglia l'ordine dei tagli. */
  function taglia(a, b, x0, y0, x1, y1) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy];
    var q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y];

    for (var k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) return null;      // parallelo e fuori
        continue;
      }
      var t = q[k] / p[k];
      if (p[k] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else          { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return {
      a: { x: a.x + t0 * dx, y: a.y + t0 * dy },
      b: { x: a.x + t1 * dx, y: a.y + t1 * dy },
      t0: t0, t1: t1
    };
  }

  function toSheet(polys, sheet, percent) {
    return toRect(polys, fitRect(polys, sheet, percent));
  }

  /* Diradamento di Douglas-Peucker: toglie i punti che non spostano la linea
     piu' della tolleranza. Un tratto dritto campionato ogni mezzo millimetro
     torna ad essere due punti, e il pianificatore di FluidNC puo' accelerare
     invece di frenare a ogni vertice inutile. */
  function simplify(polys, tol) {
    var out = [];
    for (var i = 0; i < polys.length; i++) {
      var r = dp(polys[i], 0, polys[i].length - 1, tol);
      if (r.length > 1) out.push(r);
    }
    return out;
  }

  function dp(pts, first, last, tol) {
    if (last <= first + 1) return [pts[first], pts[last]];
    var maxD = -1, idx = -1;
    for (var i = first + 1; i < last; i++) {
      var d = segDist(pts[i], pts[first], pts[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= tol) return [pts[first], pts[last]];
    var a = dp(pts, first, idx, tol);
    var b = dp(pts, idx, last, tol);
    return a.slice(0, a.length - 1).concat(b);
  }

  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return dist(p, a);
    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  return { parse: parse, toSheet: toSheet, toRect: toRect, fitRect: fitRect,
           ritaglia: ritaglia,
           percentuali: percentuali, simplify: simplify, bbox: bbox,
           dist: dist, scartate: function () { return scarti; } };
})();
