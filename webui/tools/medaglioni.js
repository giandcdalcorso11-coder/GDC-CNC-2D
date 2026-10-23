/* Due medaglioni dentro la cornice massima: curve a sinistra, geometria a
 * destra. Serve a guardare un bel foglio e, nello stesso foglio, a misurare
 * due cose che si misurano male separatamente.
 *
 *   SPIROGRAFO (ipotrocoide)  curve che non si fermano mai: nessuna inversione
 *       brusca, raggio di curvatura che cambia di continuo. È la figura che il
 *       gioco NON disturba, quindi quello che si vede lì è la costanza del
 *       tratto e l'interpolazione fra i due assi, senza altro in mezzo.
 *
 *   ROSA MISTICA (grafo completo)  nove vertici su un cerchio, TUTTI collegati
 *       fra loro: 36 corde. Su ogni vertice ne convergono otto, arrivando da
 *       otto direzioni diverse. Se il punto d'arrivo dipende dalla direzione
 *       d'arrivo - cioè se c'è gioco - i vertici non si chiudono in un punto
 *       ma in una rosellina, e la sua dimensione È il gioco. È la misura che
 *       il collaudo fa con la prova 9, qui ottenuta gratis e nove volte.
 *
 * Nove vertici e non otto o dieci: in un grafo completo ogni vertice ha grado
 * n−1, e un circuito euleriano esiste solo se tutti i gradi sono PARI, cioè
 * se n è dispari. Con nove, le 36 corde si percorrono tutte di fila senza mai
 * staccare la penna e tornando al punto di partenza.
 *
 * Uso:  node medaglioni.js --gcode m.gcode --svg m.svg
 */
var path = require('path');
var FontTratto = require(path.join(__dirname, 'font-tratto.js'));
var Riemp = require(path.join(__dirname, 'riempimenti.js'));

/* Hierholzer: si cammina finché si trova un arco non usato, e quando ci si
   blocca si torna indietro innestando il pezzo percorso. Il risultato usa
   ogni arco esattamente una volta e chiude dove è partito. */
function circuitoEuleriano(n) {
  var usato = [];
  for (var i = 0; i < n; i++) { usato.push(new Array(n).fill(false)); }
  var pila = [0], percorso = [];
  while (pila.length) {
    var v = pila[pila.length - 1], prossimo = -1;
    for (var w = 0; w < n; w++) { if (w !== v && !usato[v][w]) { prossimo = w; break; } }
    if (prossimo < 0) { percorso.push(pila.pop()); }
    else { usato[v][prossimo] = usato[prossimo][v] = true; pila.push(prossimo); }
  }
  return percorso.reverse();
}

function rosaMistica(P) {
  if (P.n % 2 === 0) throw new Error('servono vertici in numero DISPARI, se no il tratto si spezza');
  var vert = [];
  for (var i = 0; i < P.n; i++) {
    /* Primo vertice in alto: la figura si legge dritta. */
    var a = Math.PI / 2 + i * 2 * Math.PI / P.n;
    vert.push({ x: P.cx + P.R * Math.cos(a), y: P.cy + P.R * Math.sin(a) });
  }
  var ordine = circuitoEuleriano(P.n);
  return { punti: ordine.map(function (k) { return vert[k]; }),
           vertici: vert, corde: P.n * (P.n - 1) / 2 };
}

module.exports = { circuitoEuleriano: circuitoEuleriano, rosaMistica: rosaMistica };

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

  var R = parseFloat(arg('raggio', 54));
  var cy = parseFloat(arg('cy', 145));
  /* I due centri a un quarto e tre quarti della cornice: i margini laterali e
     lo spazio fra i due medaglioni vengono uguali da soli. */
  var cxs = (F.x0 + F.x1) / 2;
  var c1 = { x: cxs - (F.x1 - F.x0) / 4, y: cy }, c2 = { x: cxs + (F.x1 - F.x0) / 4, y: cy };
  var tol = parseFloat(arg('tolleranza', 1 / Profile.passiPerMm('x')));

  var tratti = [[{x:F.x0,y:F.y0},{x:F.x1,y:F.y0},{x:F.x1,y:F.y1},{x:F.x0,y:F.y1},{x:F.x0,y:F.y0}]];

  var S = Riemp.spirografo({ R: parseFloat(arg('R', 120)), r: parseFloat(arg('r', 35)),
                             d: parseFloat(arg('d', 70)), raggio: R, tolleranza: tol });
  tratti.push(S.punti.map(function (q) { return { x: c1.x + q.x, y: c1.y + q.y }; }));

  var n = parseInt(arg('vertici', 9), 10);
  var rosa = rosaMistica({ n: n, R: R, cx: c2.x, cy: c2.y });
  tratti.push(rosa.punti);
  /* Il cerchio sui vertici: senza, non si distingue un vertice fuori posto da
     un raggio sbagliato. Con, i nove punti ci devono stare sopra. */
  if (arg('cerchio') !== 'no') {
    var nc = Math.ceil(Math.PI / Math.acos(1 - tol / R) / n) * n, cer = [];
    for (var i = 0; i <= nc; i++) {
      var t = Math.PI / 2 + i / nc * 2 * Math.PI;
      cer.push({ x: c2.x + R * Math.cos(t), y: c2.y + R * Math.sin(t) });
    }
    tratti.push(cer);
  }

  var testo = arg('testo', 'GDC CNC 2D');
  if (testo !== 'no') {
    var alt = parseFloat(arg('altezzaTesto', 8));
    var w = FontTratto.larghezza(testo, alt);
    FontTratto.testo(testo, cxs - w / 2, parseFloat(arg('yTesto', 35)), alt)
      .forEach(function (p) { tratti.push(p.map(function (q) { return { x: q.x, y: q.y }; })); });
  }

  tratti.forEach(function (t, k) {
    t.forEach(function (q) {
      if (q.x < F.x0 || q.x > F.x1 || q.y < F.y0 || q.y > F.y1) {
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

  /* Disegno e spostamenti vanno contati SEPARATAMENTE: viaggiano a velocità
     diverse, e sommarli come se fossero la stessa cosa sottostima la durata. */
  var lung = 0, vuoto = 0, pos = { x: home.x, y: home.y };
  tratti.forEach(function (t) {
    vuoto += Math.hypot(t[0].x - pos.x, t[0].y - pos.y);
    for (var i = 1; i < t.length; i++) lung += Math.hypot(t[i].x - t[i-1].x, t[i].y - t[i-1].y);
    pos = t[t.length - 1];
  });
  vuoto += Math.hypot(home.x - pos.x, home.y - pos.y);
  var testa = [
    '; GDC CNC 2D - due medaglioni nella cornice ' + (F.x1-F.x0) + ' x ' + (F.y1-F.y0),
    ';',
    '; SINISTRA, spirografo: ipotrocoide ' + S.lobi + ' lobi in ' + S.giri + ' giri,',
    '; raggio ' + R + ', ' + S.punti.length + ' punti semplificati a freccia ' + tol.toFixed(4) + '.',
    '; Non inverte quasi mai, quindi il gioco non la disturba: quello che si',
    '; vede li e la costanza del tratto in ogni direzione.',
    ';',
    '; DESTRA, rosa mistica: ' + n + ' vertici su un cerchio di raggio ' + R + ', tutti',
    '; collegati fra loro, ' + rosa.corde + ' corde. Grado ' + (n-1) + ', pari, quindi un',
    '; circuito euleriano le percorre tutte DI FILA senza staccare la penna.',
    ';',
    '; COSA MISURANO I VERTICI. Su ognuno convergono ' + (n-1) + ' corde da ' + (n-1) + ' direzioni',
    '; diverse. Se il punto di arrivo dipende dalla direzione di arrivo - cioe',
    '; se ce gioco - i vertici non chiudono in un punto ma in una rosellina, e',
    '; la sua larghezza E il gioco. Si guarda con la lente. Nel profilo il',
    '; gioco vale 0,30 mm come valore NOMINALE, mai misurato su questa macchina.',
    ';',
    '; Il cerchio passa per i ' + n + ' vertici: senza, un vertice fuori posto non si',
    '; distingue da un raggio sbagliato.',
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
    s.push('<g fill="none" stroke="#111" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round">');
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
              Math.round(vuoto) + ' a vuoto, ' + (testa + g).length +
              ' byte, ' + Math.floor(sec/60) + ' min ' + ('0' + Math.round(sec%60)).slice(-2) + ' s');
}
