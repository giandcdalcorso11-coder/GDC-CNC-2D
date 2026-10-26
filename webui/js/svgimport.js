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

  /* LE FORME DEL FILE, con le curve ancora curve.
   *
   * Questa è la lettura vera: l'attributo `d` si legge comando per comando
   * (vedi svgpath.js), e le altre forme — rettangoli, cerchi, polilinee —
   * diventano nodi con le loro maniglie. Quello che ne esce si può
   * modificare: un nodo si sposta, una maniglia si tira.
   *
   * Prima si campionava tutto con getPointAtLength e si ottenevano polilinee.
   * Esatte e comode, ma definitive: da una polilinea non si risale alla
   * curva, e un editor non avrebbe avuto niente da afferrare. Adesso le
   * polilinee si ricavano da qui, non viceversa.
   */
  function parseForme(text) {
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

      /* La tela: serve a riconoscere lo sfondo, vedi saltare() qui sotto, e a
         scegliere una tolleranza di appiattimento proporzionata al disegno —
         le unità di un SVG possono valere un millimetro come un metro. */
      var vb = svg.viewBox ? svg.viewBox.baseVal : null;
      var diag = vb && vb.width ? Math.sqrt(vb.width * vb.width + vb.height * vb.height) : 300;

      var els = svg.querySelectorAll(SELECTOR);
      var forme = [];
      var tinte = [], indice = {};
      scarti = { sfondi: 0, piene: 0 };

      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var ctm = el.getScreenCTM && el.getScreenCTM();
        if (!ctm) continue;
        var m = rootInv.multiply(ctm);
        if (saltare(el, m, vb)) continue;

        var f = daElemento(el);
        if (!f) continue;
        f = Tracciato.trasforma(f, m);

        /* LA TINTA viaggia con la forma, perché è il solo modo di ricostruire
           dopo che cosa, nel file, era una cosa sola. `trasforma` restituisce
           un oggetto nuovo, quindi si segna qui e non prima. */
        var t = tinta(el);
        f.tinta = t.chiave;
        f.piena = t.piena;
        if (!indice[t.chiave]) {
          indice[t.chiave] = { chiave: t.chiave, nome: t.nome, piena: t.piena, quante: 0 };
          tinte.push(indice[t.chiave]);
        }
        indice[t.chiave].quante++;
        forme.push(f);
      }

      if (!forme.length) throw new Error('Nessun tracciato trovato nel file.');
      forme.tolleranza = diag / 20000;
      forme.tinte = tinte;
      return forme;

    } finally {
      holder.remove();
    }
  }

  function num(el, nome, dif) {
    var v = parseFloat(el.getAttribute(nome));
    return isNaN(v) ? (dif || 0) : v;
  }

  function punti(el) {
    var s = (el.getAttribute('points') || '').trim();
    if (!s) return [];
    var n = s.split(/[\s,]+/).map(parseFloat);
    var out = [];
    for (var i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
    return out;
  }

  function daElemento(el) {
    var t = el.tagName.toLowerCase();

    if (t === 'path') {
      var sub = SvgPath.parse(el.getAttribute('d') || '');
      return sub.length ? Tracciato.tracciato(sub) : null;
    }
    if (t === 'line') {
      return Tracciato.linea(num(el, 'x1'), num(el, 'y1'), num(el, 'x2'), num(el, 'y2'));
    }
    if (t === 'polyline' || t === 'polygon') {
      var p = punti(el);
      return p.length > 1 ? Tracciato.daPunti(p, t === 'polygon') : null;
    }
    if (t === 'rect') {
      var w = num(el, 'width'), h = num(el, 'height');
      if (!(w > 0) || !(h > 0)) return null;
      /* Gli angoli arrotondati non sono ancora gestiti: si prende il
         rettangolo vivo. È una differenza che si vede, quindi è meglio
         saperlo scritto qui che scoprirlo sul foglio. */
      return Tracciato.rettangolo(num(el, 'x'), num(el, 'y'), w, h);
    }
    if (t === 'circle') {
      var r = num(el, 'r');
      return r > 0 ? Tracciato.cerchio(num(el, 'cx'), num(el, 'cy'), r) : null;
    }
    if (t === 'ellipse') {
      var rx = num(el, 'rx'), ry = num(el, 'ry');
      return (rx > 0 && ry > 0)
        ? Tracciato.ellisse(num(el, 'cx'), num(el, 'cy'), rx, ry) : null;
    }
    return null;
  }

  /* Le polilinee, che è quello che si disegna. Si ricavano dalle forme, e non
     il contrario: un solo posto in cui il file viene letto, e l'appiattimento
     che resta l'ultimo passo invece del primo. */
  function parse(text) {
    var forme = parseForme(text);
    var polys = Tracciato.appiattisciTutte(forme, forme.tolleranza);
    if (!polys.length) throw new Error('Nessun tracciato trovato nel file.');
    return polys;
  }

  /* LA TINTA DI UNA FORMA: come è dipinta nel file, e se è dipinta col bordo
     o col riempimento. È la cosa che distingue i pezzi di un disegno quando
     il file non ha livelli — e un SVG, quasi sempre, non li ha.
     Il nome serve all'elenco dei livelli e deve dire due cose in poche
     lettere: con che cosa è disegnata e di che colore. */
  function tinta(el) {
    var cs = window.getComputedStyle(el);
    if (haBordo(el)) {
      return { chiave: 't:' + cs.stroke, nome: 'tratto ' + colore(cs.stroke),
               piena: false };
    }
    return { chiave: 'p:' + cs.fill, nome: 'pieno ' + colore(cs.fill), piena: true };
  }

  /* `rgb(204, 204, 204)` non si legge, `#ccc` sì. */
  function colore(c) {
    var m = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/.exec(String(c || ''));
    if (!m) return String(c || '—');
    var h = '#';
    for (var i = 1; i <= 3; i++) {
      h += ('0' + Number(m[i]).toString(16)).slice(-2);
    }
    /* I tre esadecimali doppi si accorciano, come fa chi li scrive a mano. */
    if (h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) h = '#' + h[1] + h[3] + h[5];
    return h;
  }

  function haBordo(el) {
    var cs = window.getComputedStyle(el);
    return !!(cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0);
  }

  /* Non tutto quello che c'e' in un file va tracciato.
   *
   * Resta UNA cosa sola che si butta via davvero: la forma senza bordo che
   * copre tutta la tela. Quello e' lo sfondo — il rettangolo bianco che un
   * programma mette per non far vedere il trasparente — e disegnarlo vuol
   * dire una cornice di troppo sul foglio e, peggio, un ingombro piu' largo
   * del disegno vero, che e' il numero con cui si decide la scala.
   *
   * TUTTO IL RESTO SI TIENE. Fino al 26 ottobre la regola era un'altra: se
   * nel file c'era almeno una forma col bordo, allora il disegno era fatto di
   * linee e ogni forma senza bordo era decorazione, e si saltava. Quella
   * regola risolveva il caso vero dei riferimenti colorati — il pallino rosso
   * del punto home nei nostri SVG — ma buttava via anche la geometria vera.
   *
   * Il caso che l'ha smontata e' un disegno isometrico di cubi: le facce in
   * alto e di lato avevano il loro contorno disegnato, quella di sinistra no,
   * era solo un poligono pieno. Risultato: diciannove facce senza spigoli, e
   * dei cubi a cui mancavano due lati per uno.
   *
   * Adesso le forme piene entrano, ma nella loro TINTA, che diventa un
   * livello suo — spento, cosi' il risultato di partenza e' identico a prima.
   * Quello che prima spariva in silenzio adesso sta nell'elenco con il suo
   * occhio accanto: una cosa che si butta via si deve poter vedere prima.
   *
   * Senza viewBox non si sa quanto e' grande la tela, e li' non si salta
   * niente: meglio un rettangolo di troppo che un disegno perso. */
  function saltare(el, m, vb) {
    if (haBordo(el)) return false;
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

  return { parse: parse, parseForme: parseForme, toSheet: toSheet, toRect: toRect, fitRect: fitRect,
           ritaglia: ritaglia,
           percentuali: percentuali, simplify: simplify, bbox: bbox,
           dist: dist, scartate: function () { return scarti; } };
})();
