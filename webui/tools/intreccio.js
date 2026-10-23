/* Tre anelli esagonali intrecciati, disposti a trifoglio, con il sopra-sotto
 * vero: dove un anello passa sotto un altro, il suo contorno viene TOLTO - non
 * coperto. Un plotter non ha un bianco con cui cancellare, quindi quello che
 * non si deve vedere non deve proprio essere disegnato.
 *
 * L'intreccio e' borromeo: A sopra B, B sopra C, C sopra A. Nessuno dei tre e'
 * sopra o sotto a tutti, che e' quello che rende la figura un intreccio invece
 * di una pila.
 *
 * Dentro il foro di ogni anello: tre cerchi concentrici e tre esagoni piccoli.
 * Fuori: per ogni anello l'arco del suo cerchio circoscritto che resta
 * all'esterno degli altri due, cioe' il contorno a trifoglio di tutto.
 *
 * Uso:  node intreccio.js --gcode i.gcode --svg i.svg
 *       ... --Ro 52 --larghezza 16 --distanza 58
 */
var path = require('path');

/* ----------------------------- primitive -------------------------------- */

function esagono(c, R, rot) {
  var p = [];
  for (var i = 0; i < 6; i++) {
    var a = (rot || 0) + i * Math.PI / 3;
    p.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
  }
  p.push(p[0]);
  return p;
}

function cerchio(c, R, n) {
  var p = [];
  for (var i = 0; i <= n; i++) {
    var a = i / n * 2 * Math.PI;
    p.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
  }
  return p;
}

/* Dentro un poligono CONVESSO: tutti i prodotti vettoriali con lo stesso
   segno. Vale per gli esagoni regolari, che e' tutto quello che serve qui. */
function dentroConvesso(p, poly) {
  var segno = 0;
  for (var i = 0; i < poly.length - 1; i++) {
    var a = poly[i], b = poly[i + 1];
    var c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-12) continue;
    var s = c > 0 ? 1 : -1;
    if (segno === 0) segno = s;
    else if (s !== segno) return false;
  }
  return true;
}

/* La fascia di un anello: dentro l'esagono esterno e fuori da quello interno. */
function dentroFascia(p, anello) {
  return dentroConvesso(p, anello.fuori) && !dentroConvesso(p, anello.dentro);
}

/* Dove il segmento a-b incrocia il segmento c-d: restituisce il parametro t
   lungo a-b, oppure null. */
function incrocio(a, b, c, d) {
  var rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  var den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  var t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  var u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 1e-9 || t > 1 - 1e-9 || u < 0 || u > 1) return null;
  return t;
}

/* Toglie da una polilinea le parti che cadono dentro la fascia di `sopra`.
   Si spezza ogni segmento nei punti in cui attraversa i bordi della fascia -
   intersezioni ESATTE, non campionamento - e si tiene quello il cui punto di
   mezzo sta fuori. */
function toglie(linea, sopra) {
  var fuori = [], cur = [];
  for (var i = 0; i < linea.length - 1; i++) {
    var a = linea[i], b = linea[i + 1];
    var ts = [0, 1];
    [sopra.fuori, sopra.dentro].forEach(function (poly) {
      for (var j = 0; j < poly.length - 1; j++) {
        var t = incrocio(a, b, poly[j], poly[j + 1]);
        if (t !== null) ts.push(t);
      }
    });
    ts.sort(function (x, y) { return x - y; });
    for (var k = 0; k < ts.length - 1; k++) {
      var t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-9) continue;
      var tm = (t0 + t1) / 2;
      var m = { x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm };
      var P0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      var P1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      if (dentroFascia(m, sopra)) {           // sta sotto: si interrompe
        if (cur.length > 1) fuori.push(cur);
        cur = [];
      } else {
        if (!cur.length) cur.push(P0);
        cur.push(P1);
      }
    }
  }
  if (cur.length > 1) fuori.push(cur);
  /* Un frammento di due millimetri non e' disegno, e' una scheggia: il taglio
     puo' lasciarne dove una linea rasenta il bordo della fascia, e su carta
     diventano trattini senza senso. Si buttano. */
  var minimo = sopra.minimo || 0;
  return fuori.filter(function (p) {
    var L = 0;
    for (var i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i-1].x, p[i].y - p[i-1].y);
    return L >= minimo;
  });
}

module.exports = { esagono: esagono, cerchio: cerchio, dentroConvesso: dentroConvesso,
                   dentroFascia: dentroFascia, incrocio: incrocio, toglie: toglie };

/* ------------------------------ la figura -------------------------------- */

function costruisci(P) {
  var anelli = [];
  /* `lato` e' la distanza fra due CENTRI, che e' il numero che decide se gli
     anelli si intrecciano o si sfiorano. Il raggio del triangolo che li porta
     e' lato/sqrt(3): confondere i due fa distare i centri il 73% in piu' e
     l'intreccio non avviene proprio - sembra che il taglio non funzioni,
     mentre semplicemente non c'e' niente da tagliare. */
  var raggioTriangolo = P.lato / Math.sqrt(3);
  for (var k = 0; k < 3; k++) {
    var a = Math.PI / 2 + k * 2 * Math.PI / 3;
    var c = { x: P.cx + raggioTriangolo * Math.cos(a),
              y: P.cy + raggioTriangolo * Math.sin(a) };
    anelli.push({ c: c,
                  fuori: esagono(c, P.Ro, P.rotazione),
                  dentro: esagono(c, P.Ro - P.larghezza, P.rotazione) });
  }

  /* Dentro il foro: tre cerchi concentrici e tre esagoni piccoli, alternati.
     Il piu' grande e' inscritto nel foro esagonale, cioe' ha per raggio la sua
     apotema: un cerchio del raggio del foro uscirebbe dai lati. */
  var apotema = (P.Ro - P.larghezza) * Math.cos(Math.PI / 6);
  anelli.forEach(function (A) {
    A.suoi = [A.fuori, A.dentro];
    A.ornamenti = [];
    for (var j = 0; j < 3; j++) {
      var f = (3 - j) / 3;                       // 1, 2/3, 1/3
      var r = apotema * f * P.riempimento;
      A.ornamenti.push(cerchio(A.c, r, P.latiCerchio));
      /* L'esagono piccolo inscritto nel cerchio, ruotato di 30 gradi rispetto
         a quello grande cosi' i vertici cadono dove il cerchio ha piu' spazio
         e le due figure si leggono separate. */
      A.ornamenti.push(esagono(A.c, r, (P.rotazione || 0) + Math.PI / 6));
    }
  });

  var tratti = [];
  anelli.forEach(function (a) { a.minimo = P.minimo; });

  /* L'intreccio borromeo: ogni anello passa SOTTO il successivo e sopra
     l'altro. Nessuno e' sopra o sotto a tutti - e' quello che lo rende un
     intreccio e non una pila. Il suo contorno si taglia quindi con UNO solo
     degli altri due. */
  anelli.forEach(function (A, i) {
    var sopra = anelli[(i + 2) % 3];
    [A.fuori, A.dentro].forEach(function (linea) {
      toglie(linea, sopra).forEach(function (p) { tratti.push(p); });
    });
  });

  /* Gli ornamenti no: stanno sulla CARTA, dentro il foro, e il foro e' un
     buco - si vede quello che ci passa dietro. Quindi li copre qualunque
     fascia passi di li, tutte e due le altre, non solo quella che sta sopra
     al loro anello. Tagliarli come se fossero parte dell'anello li faceva
     comparire sopra una fascia che invece gli passa davanti. */
  anelli.forEach(function (A, i) {
    var altri = [anelli[(i + 1) % 3], anelli[(i + 2) % 3]];
    A.ornamenti.forEach(function (linea) {
      var pezzi = [linea];
      altri.forEach(function (B) {
        var next = [];
        pezzi.forEach(function (p) { toglie(p, B).forEach(function (q) { next.push(q); }); });
        pezzi = next;
      });
      pezzi.forEach(function (p) { tratti.push(p); });
    });
  });

  /* Fuori: per ogni anello l'arco del cerchio circoscritto che resta
     all'esterno degli altri due esagoni. I tre archi insieme fanno il
     contorno a trifoglio che delimita il disegno. */
  if (P.contorno) {
    var Rc = P.Ro * P.contorno;
    anelli.forEach(function (A, i) {
      var altri = [anelli[(i + 1) % 3], anelli[(i + 2) % 3]];
      var cer = cerchio(A.c, Rc, P.latiCerchio * 2);
      var cur = [];
      cer.forEach(function (p) {
        /* Tagliato dagli altri due CERCHI e non dagli esagoni: cosi' i tre
           archi si incontrano in cuspidi e il risultato e' un trifoglio.
           Tagliandolo con gli esagoni restavano tre cerchi sovrapposti. */
        var coperto = altri.some(function (B) { return Math.hypot(p.x-B.c.x, p.y-B.c.y) < Rc; });
        if (coperto) { if (cur.length > 1) tratti.push(cur); cur = []; }
        else cur.push(p);
      });
      if (cur.length > 1) tratti.push(cur);
    });
  }

  return { tratti: tratti, anelli: anelli, apotema: apotema };
}

module.exports.costruisci = costruisci;

/* ------------------------------ riga di comando -------------------------- */
if (require.main === module) {
  var fs = require('fs'), a = process.argv;
  var js = path.join(__dirname, '..', 'js'), mem = {};
  global.window = { localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; } } };
  eval(fs.readFileSync(path.join(js, 'profile.js'), 'utf8'));
  eval(fs.readFileSync(path.join(js, 'gcode.js'), 'utf8'));
  Profile.load();

  var arg = function (n, pre) { var i = a.indexOf('--' + n); return i > 0 ? a[i + 1] : pre; };
  var area = Profile.areaUtile(), home = Profile.puntoHome(), m = 0.5;
  var F = { x0: m, y0: m, x1: m + Math.floor(area.w - 2 * m), y1: m + Math.floor(area.h - 2 * m) };

  var P = { cx: 0, cy: 0,
            Ro: parseFloat(arg('Ro', 62)),
            larghezza: parseFloat(arg('larghezza', 18)),
            lato: parseFloat(arg('lato', 78)),
            rotazione: Math.PI / 2,
            latiCerchio: parseInt(arg('latiCerchio', 72), 10),
            riempimento: parseFloat(arg('riempimento', 0.9)),
            minimo: parseFloat(arg('minimo', 3)),
            contorno: arg('contorno') === 'no' ? 0 : parseFloat(arg('contorno', 1.08)) };
  var r = costruisci(P);

  /* Il trifoglio non e' simmetrico in verticale - uno in alto, due in basso -
     quindi centrarlo sul baricentro dei tre centri lo lascia storto. Si misura
     l'ingombro vero e si sposta di conseguenza. */
  var xs = [], ys = [];
  r.tratti.forEach(function (t) { t.forEach(function (p) { xs.push(p.x); ys.push(p.y); }); });
  var dx = (F.x0 + F.x1) / 2 - (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
  var dy = (F.y0 + F.y1) / 2 - (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
  var tratti = r.tratti.map(function (t) {
    return t.map(function (p) { return { x: p.x + dx, y: p.y + dy }; });
  });

  if (arg('cornice') !== 'no') {
    tratti.unshift([{x:F.x0,y:F.y0},{x:F.x1,y:F.y0},{x:F.x1,y:F.y1},{x:F.x0,y:F.y1},{x:F.x0,y:F.y0}]);
  }

  tratti.forEach(function (t, k) {
    t.forEach(function (q) {
      if (q.x < F.x0 - 1e-9 || q.x > F.x1 + 1e-9 || q.y < F.y0 - 1e-9 || q.y > F.y1 + 1e-9) {
        throw new Error('il tratto ' + k + ' esce dalla cornice: ' + q.x.toFixed(2) + ',' + q.y.toFixed(2));
      }
    });
  });

  var giu = Profile.zContatto(), st = Profile.stampa();
  var g = Gcode.build(tratti, {
    penUp: Profile.zAlzata(), penDown: giu, penTappo: Profile.zTappo(), ritorno: home,
    pennaTarata: true, pausaMs: st.pausaPennaMs, feedDraw: st.velocitaDisegno,
    feedTravel: st.velocitaSpostamento, feedPen: 600
  });

  var lung = 0, vuoto = 0, pos = { x: home.x, y: home.y };
  tratti.forEach(function (t) {
    vuoto += Math.hypot(t[0].x - pos.x, t[0].y - pos.y);
    for (var i = 1; i < t.length; i++) lung += Math.hypot(t[i].x - t[i-1].x, t[i].y - t[i-1].y);
    pos = t[t.length - 1];
  });
  vuoto += Math.hypot(home.x - pos.x, home.y - pos.y);

  var testa = [
    '; GDC CNC 2D - tre anelli esagonali intrecciati',
    ';',
    '; Tre anelli esagonali (esterno ' + P.Ro + ', fascia ' + P.larghezza + ') ai vertici di un',
    '; triangolo equilatero di lato ' + P.lato + '.',
    ';',
    '; IL SOPRA-SOTTO E VERO. Dove un anello passa sotto un altro il suo',
    '; contorno non viene coperto: viene TOLTO, calcolando le intersezioni',
    '; esatte coi bordi della fascia che gli passa sopra. Un plotter non ha',
    '; un bianco con cui cancellare, quindi quello che non si deve vedere non',
    '; deve proprio essere disegnato.',
    ';',
    '; L intreccio e BORROMEO: A sopra B, B sopra C, C sopra A. Nessuno dei',
    '; tre e sopra o sotto a tutti, ed e questo che lo rende un intreccio',
    '; invece di una pila.',
    ';',
    '; Dentro ogni foro: tre cerchi concentrici e tre esagoni piccoli,',
    '; alternati. Il piu grande ha per raggio l apotema del foro (' +
      r.apotema.toFixed(2) + '),',
    '; perche un cerchio del raggio del foro uscirebbe dai suoi lati.',
    '; Gli esagoni piccoli sono ruotati di 30 gradi rispetto a quelli grandi.',
    ';',
    '; Fuori: per ogni anello l arco del cerchio circoscritto che resta',
    '; all esterno degli altri due. I tre archi fanno il contorno a trifoglio.',
    ';',
    '; Cornice ' + (F.x1-F.x0) + ' x ' + (F.y1-F.y0) + ', foglio minimo altrettanto.',
    '; LE QUOTE Z SONO NEGATIVE. Z0 e il tappo; Z' + giu.toFixed(3) + ' la punta sul foglio.',
    ''].join('\n');

  var out = arg('gcode');
  if (out) { fs.writeFileSync(out, testa + g); console.log('scritto ' + out); }
  var svgOut = arg('svg');
  if (svgOut) {
    var W = Math.ceil(area.w), H = Math.ceil(area.h), s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H +
           'mm" viewBox="0 0 ' + W + ' ' + H + '"><rect width="' + W + '" height="' + H + '" fill="#fff"/>');
    s.push('<g fill="none" stroke="#111" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round">');
    tratti.forEach(function (t) {
      s.push('<polyline points="' + t.map(function (q) {
        return q.x.toFixed(3) + ',' + (H - q.y).toFixed(3); }).join(' ') + '"/>');
    });
    s.push('</g><circle cx="' + home.x + '" cy="' + (H - home.y) + '" r="1.2" fill="#c00"/></svg>');
    fs.writeFileSync(svgOut, s.join('\n') + '\n');
    console.log('scritto ' + svgOut);
  }
  var sec = lung / st.velocitaDisegno * 60 + vuoto / st.velocitaSpostamento * 60 +
            tratti.length * 2 * (0.34 + st.pausaPennaMs / 1000);
  console.log(tratti.length + ' tratti, ' + Math.round(lung) + ' mm disegnati + ' +
              Math.round(vuoto) + ' a vuoto, ' + (testa + g).length + ' byte, ' +
              Math.floor(sec/60) + ' min ' + ('0' + Math.round(sec%60)).slice(-2) + ' s');
}
