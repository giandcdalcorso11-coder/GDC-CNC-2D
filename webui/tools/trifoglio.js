/* Tre esagoni a spirale dentro un cerchio.
 *
 * L'idea che tiene insieme le due cose dello schizzo - gli esagoni e i vortici
 * tondi - è che la spirale sia ESAGONALE. Stessa simmetria dell'esagono,
 * stessi angoli, quindi i tratti si concatenano invece di sovrapporsi: ogni
 * esagono NON è un esagono più una spirale dentro, è un esagono che continua
 * a girare stringendosi. Un tratto solo dal bordo al centro, e le spire
 * interne sono le "parti interne" della figura.
 *
 * E si incastra anche col cerchio: la spirale parte da un VERTICE, che per
 * un esagono regolare sta sul cerchio circoscritto. Quindi il punto di
 * partenza di ogni vortice è sul suo cerchio, non vicino.
 *
 * I tre cerchi sono tangenti fra loro e al cerchio grande. Non è un'estetica
 * scelta a occhio: con i centri a 120 gradi e distanza D dal centro, la
 * distanza fra due centri vale D*sqrt(3), quindi sono tangenti quando
 * D = 2*Rs/sqrt(3), e il cerchio grande li contiene esatti con Rc = D + Rs.
 * Da cui Rs = Rc / (1 + 2/sqrt(3)).
 *
 * Uso:  node trifoglio.js --gcode t.gcode --svg t.svg
 *       ... --raggio 95 --giri 3 --stretta 0.55
 */
var path = require('path');
var FontTratto = require(path.join(__dirname, 'font-tratto.js'));

/* Spirale esagonale logaritmica: l'angolo avanza di 60 gradi per lato e il
   raggio si stringe di un fattore costante a ogni giro. Costante e non
   lineare perché così le spire si infittiscono verso il centro come nello
   schizzo, invece di restare equidistanti. */
function spiraleEsagonale(cx, cy, R, giri, stretta, faseGradi) {
  var lati = Math.round(giri * 6), p = [];
  var q = Math.pow(stretta, 1 / 6);            // per lato
  var fase = (faseGradi || 0) * Math.PI / 180;
  for (var k = 0; k <= lati; k++) {
    var r = R * Math.pow(q, k), a = fase + k * Math.PI / 3;
    p.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return p;
}

function cerchio(cx, cy, R, tol, faseGradi) {
  var n = Math.ceil(Math.PI / Math.acos(1 - tol / R));
  n = Math.ceil(n / 6) * 6;                    // multiplo di 6: passa per i vertici
  var fase = (faseGradi || 0) * Math.PI / 180, p = [];
  for (var i = 0; i <= n; i++) {
    var a = fase + i / n * 2 * Math.PI;
    p.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return p;
}

function costruisci(P) {
  var Rc = P.raggio;
  /* I tre cerchi tangenti fra loro e al grande. */
  var Rs = Rc / (1 + 2 / Math.sqrt(3));
  var D = 2 * Rs / Math.sqrt(3);
  var tratti = [], centri = [];

  tratti.push(cerchio(P.cx, P.cy, Rc, P.tolleranza, 90));

  for (var i = 0; i < 3; i++) {
    var a = Math.PI / 2 + i * 2 * Math.PI / 3;
    var c = { x: P.cx + D * Math.cos(a), y: P.cy + D * Math.sin(a) };
    centri.push(c);
    tratti.push(cerchio(c.x, c.y, Rs, P.tolleranza, 90));
    /* La spirale parte dal vertice in alto, che sta sul cerchio appena
       disegnato: il vortice nasce sul cerchio, non dentro. */
    tratti.push(spiraleEsagonale(c.x, c.y, Rs, P.giri, P.stretta, 90));
  }

  return { tratti: tratti, Rc: Rc, Rs: Rs, D: D, centri: centri,
           lati: Math.round(P.giri * 6) };
}

module.exports = { costruisci: costruisci, spiraleEsagonale: spiraleEsagonale,
                   cerchio: cerchio };

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
  var tol = parseFloat(arg('tolleranza', 1 / Profile.passiPerMm('x')));
  var Rc = parseFloat(arg('raggio', 95));
  var cx = (F.x0 + F.x1) / 2, cy = parseFloat(arg('cy', 133));

  var C = costruisci({ cx: cx, cy: cy, raggio: Rc, giri: parseFloat(arg('giri', 3)),
                       stretta: parseFloat(arg('stretta', 0.55)), tolleranza: tol });

  var tratti = [];
  if (arg('cornice') !== 'no') {
    tratti.push([{x:F.x0,y:F.y0},{x:F.x1,y:F.y0},{x:F.x1,y:F.y1},{x:F.x0,y:F.y1},{x:F.x0,y:F.y0}]);
  }
  C.tratti.forEach(function (t) { tratti.push(t); });

  var testo = arg('testo', 'GDC CNC 2D');
  if (testo !== 'no') {
    var alt = parseFloat(arg('altezzaTesto', 8));
    var w = FontTratto.larghezza(testo, alt);
    FontTratto.testo(testo, cx - w / 2, parseFloat(arg('yTesto', 15)), alt)
      .forEach(function (p) { tratti.push(p.map(function (q) { return { x: q.x, y: q.y }; })); });
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
    '; GDC CNC 2D - trifoglio: tre esagoni a spirale dentro un cerchio',
    ';',
    '; Cerchio grande raggio ' + Rc.toFixed(2) + ' in X' + cx + ' Y' + cy + '.',
    '; Tre cerchi di raggio ' + C.Rs.toFixed(2) + ' a distanza ' + C.D.toFixed(2) + ' dal centro,',
    '; a 120 gradi. Sono TANGENTI fra loro e al cerchio grande, e non a occhio:',
    '; con i centri a 120 gradi la distanza fra due di loro vale D*sqrt(3),',
    '; quindi si toccano quando D = 2*Rs/sqrt(3), e il grande li contiene',
    '; esatti con Rc = D + Rs.',
    ';',
    '; Dentro ogni cerchio una SPIRALE ESAGONALE di ' + C.lati + ' lati: stessa',
    '; simmetria dell esagono, quindi l esagono non e una figura piu una',
    '; spirale dentro - e un esagono che continua a girare stringendosi, in un',
    '; tratto solo dal bordo al centro. Le spire interne SONO le parti interne.',
    ';',
    '; E parte da un VERTICE, che per un esagono regolare sta sul cerchio',
    '; circoscritto: il vortice nasce sul suo cerchio, non vicino.',
    ';',
    '; Il raggio si stringe di un fattore costante a ogni giro, non lineare:',
    '; cosi le spire si infittiscono verso il centro.',
    ';',
    '; Foglio minimo ' + (F.x1-F.x0) + ' x ' + (F.y1-F.y0) + ' mm.',
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
  console.log(tratti.length + ' tratti, ' + Math.round(lung) + ' mm + ' + Math.round(vuoto) +
              ' a vuoto, ' + (testa + g).length + ' byte, ' +
              Math.floor(sec/60) + ' min ' + ('0' + Math.round(sec%60)).slice(-2) + ' s');
}
