/* La prima prova vera: quadrato, cerchio inscritto, pentagono inscritto nel
 * cerchio, diagonali del quadrato, apotemi del pentagono.
 *
 * Non è un disegno decorativo: ogni figura verifica qualcosa che le altre non
 * possono verificare.
 *   quadrato    scala dei due assi, e la chiusura dice il gioco
 *   diagonali   SQUADRA: su un quadrato vero sono uguali, e la differenza
 *               misura di quanto gli assi non sono perpendicolari
 *   cerchio     interpolazione fra i due assi e costanza del tratto in ogni
 *               direzione. Un cerchio che esce ovale è scala diversa fra X e
 *               Y; uno che esce a pera è accelerazione o gioco
 *   pentagono   cinque segmenti obliqui con angoli diversi da 45°: è il caso
 *               che il quadrato e le diagonali non coprono
 *   apotemi     cinque rette che convergono in UN punto. Se non convergono,
 *               il punto di arrivo dipende dalla direzione di arrivo, che è
 *               la definizione operativa del gioco
 *
 * Uso:  node prova-geometrica.js --gcode prova.gcode
 *       ... --lato 100 --offset 20 --home 5,5
 */

/* Il cerchio si approssima con una spezzata, e il numero di lati esce da una
   TOLLERANZA, non da un numero inventato: la freccia (lo scarto fra corda e
   arco) deve stare sotto un passo di motore, 0,0295 mm. Si arrotonda poi a un
   multiplo di 5 in modo che la spezzata passi ESATTAMENTE per i vertici del
   pentagono: così la tangenza fra le due figure si vede sul foglio invece di
   essere una questione di fede. */
function latiCerchio(r, tolleranza) {
  var n = Math.ceil(Math.PI / Math.acos(1 - tolleranza / r));
  return Math.ceil(n / 5) * 5;
}

function costruisci(P) {
  var a = P.home.x + P.offset, b = P.home.y + P.offset, L = P.lato;
  var c = a + L, d = b + L;                      // angolo opposto
  var cx = a + L / 2, cy = b + L / 2, R = L / 2; // centro e raggio
  var n = latiCerchio(R, P.tolleranza);
  var tratti = [];

  /* 1. Il perimetro. Finisce dove è partito, e quel punto è anche l'inizio
        della prima diagonale: un tratto in meno da raggiungere. */
  tratti.push([{x:a,y:b},{x:c,y:b},{x:c,y:d},{x:a,y:d},{x:a,y:b}]);

  /* 2. Le due diagonali. La prima parte dall'angolo dove il perimetro si è
        chiuso, quindi senza spostamento. */
  tratti.push([{x:a,y:b},{x:c,y:d}]);
  tratti.push([{x:c,y:b},{x:a,y:d}]);

  /* 3. Il cerchio, che comincia dal vertice in alto del pentagono: così il
        tratto successivo riparte da dove questo finisce. */
  var p0 = Math.PI / 2, cerchio = [], i;
  for (i = 0; i <= n; i++) {
    var t = p0 + i / n * 2 * Math.PI;
    cerchio.push({ x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) });
  }
  tratti.push(cerchio);

  /* 4. Il pentagono, vertici sul cerchio, il primo in alto. Parte dallo stesso
        punto dove il cerchio ha finito. */
  var vert = [];
  for (i = 0; i < 5; i++) {
    var v = p0 + i * 2 * Math.PI / 5;
    vert.push({ x: cx + R * Math.cos(v), y: cy + R * Math.sin(v) });
  }
  tratti.push(vert.concat([vert[0]]));

  /* 5. Gli apotemi: dal punto medio di ogni lato al centro. A coppie, perché
        un tratto medio→centro→medio disegna DUE apotemi senza ripassare su
        niente — il centro è un attraversamento, non cinque fermate sovrapposte
        che lascerebbero un blob di inchiostro. Cinque è dispari, quindi
        l'ultimo resta da solo. */
  var medi = [];
  for (i = 0; i < 5; i++) {
    var m = p0 + Math.PI / 5 + i * 2 * Math.PI / 5;      // bisettrice del lato
    var ap = R * Math.cos(Math.PI / 5);                   // apotema
    medi.push({ x: cx + ap * Math.cos(m), y: cy + ap * Math.sin(m) });
  }
  var C = { x: cx, y: cy };
  tratti.push([medi[0], C, medi[1]]);
  tratti.push([medi[2], C, medi[3]]);
  tratti.push([medi[4], C]);

  return { tratti: tratti, n: n, cx: cx, cy: cy, R: R,
           a: a, b: b, c: c, d: d, medi: medi, vert: vert,
           diagonale: Math.SQRT2 * L, apotema: R * Math.cos(Math.PI / 5),
           latoPentagono: 2 * R * Math.sin(Math.PI / 5) };
}

module.exports = { costruisci: costruisci, latiCerchio: latiCerchio };

/* ------------------------------ riga di comando --------------------------
   Il G-code lo emette Gcode.build dell'interfaccia, non un emettitore
   fotocopiato qui: le quote Z, il punto home e la regola della generazione
   modale devono stare in un posto solo. Si caricano i due file del browser
   fingendo il localStorage, che è l'unica cosa del browser che usano. */
if (require.main === module) {
  var fs = require('fs'), path = require('path'), a = process.argv;
  var js = path.join(__dirname, '..', 'js'), mem = {};
  global.window = { localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; } } };
  eval(fs.readFileSync(path.join(js, 'profile.js'), 'utf8'));
  eval(fs.readFileSync(path.join(js, 'gcode.js'), 'utf8'));
  Profile.load();

  var arg = function (nome, pre) {
    var i = a.indexOf('--' + nome);
    return i > 0 ? a[i + 1] : pre;
  };
  var home = Profile.puntoHome();
  if (arg('home')) {
    var xy = arg('home').split(',');
    home = { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
  }
  var P = { home: home,
            offset: parseFloat(arg('offset', 20)),
            lato: parseFloat(arg('lato', 100)),
            /* La freccia del cerchio sotto un passo di motore: più fine di
               così la macchina non sa posizionarsi, quindi sarebbe byte
               buttati nella flash. */
            tolleranza: parseFloat(arg('tolleranza', 1 / Profile.passiPerMm('x'))) };

  var r = costruisci(P);
  var area = Profile.areaUtile();
  if (r.c > area.w || r.d > area.h) {
    throw new Error('la figura esce dall\'area utile: arriva a ' + r.c + ',' + r.d +
                    ' e l\'area è ' + area.w.toFixed(1) + '×' + area.h.toFixed(1));
  }

  var giu = Profile.zContatto();
  var g = Gcode.build(r.tratti, {
    penUp: giu + Profile.alzataMm(), penDown: giu, penTappo: Profile.zTappo(),
    ritorno: home, pennaTarata: true, pausaMs: Profile.stampa().pausaPennaMs,
    feedDraw: Profile.stampa().velocitaDisegno,
    feedTravel: Profile.stampa().velocitaSpostamento, feedPen: 600
  });

  var f3 = function (v) { return v.toFixed(3); };
  var testa = [
    '; GDC CNC 2D - prova geometrica',
    '; Quadrato ' + P.lato + ' mm, cerchio inscritto, pentagono inscritto nel',
    '; cerchio, diagonali del quadrato, apotemi del pentagono.',
    ';',
    '; Angolo in basso a sinistra X' + r.a + ' Y' + r.b + ', opposto X' + r.c + ' Y' + r.d + '.',
    '; Punto home X' + home.x + ' Y' + home.y + ': la figura sta ' + P.offset + ' mm a destra e in alto.',
    '; Centro X' + r.cx + ' Y' + r.cy + ', raggio ' + r.R + '.',
    ';',
    '; MISURE ATTESE, col calibro:',
    ';   lato del quadrato      ' + f3(P.lato),
    ';   diagonali (due)        ' + f3(r.diagonale) + '   DEVONO essere uguali',
    ';   diametro del cerchio   ' + f3(2 * r.R) + '   in ogni direzione',
    ';   lato del pentagono     ' + f3(r.latoPentagono),
    ';   apotema (cinque)       ' + f3(r.apotema),
    ';',
    '; COSA DICE OGNI FIGURA:',
    ';   diagonali diverse  -> assi non perpendicolari (fuori squadra)',
    ';   cerchio ovale      -> scala diversa fra X e Y',
    ';   apotemi che non convergono in un punto -> gioco: il punto di arrivo',
    ';                         dipende dalla direzione di arrivo',
    ';',
    '; Il cerchio è una spezzata di ' + r.n + ' lati: freccia ' +
      (r.R * (1 - Math.cos(Math.PI / r.n))).toFixed(4) + ' mm, sotto un passo',
    '; di motore (' + (1 / Profile.passiPerMm('x')).toFixed(4) + ' mm). ' + r.n +
      ' è multiplo di 5, quindi la spezzata',
    '; passa esattamente per i vertici del pentagono.',
    ';',
    '; LE QUOTE Z SONO NEGATIVE. Z0 è la posizione tappo, in cima alla corsa;',
    '; Z' + f3(giu) + ' è la punta sul foglio.',
    ''].join('\n');

  var out = arg('gcode');
  if (out) { fs.writeFileSync(out, testa + g); console.log('scritto ' + out); }

  /* Anteprima: la Y si specchia perche in SVG cresce in basso e sulla
     macchina in alto. Serve a vedere la figura prima di consumare un foglio,
     non a misurarla. */
  var svgOut = arg('svg');
  if (svgOut) {
    var W = Math.ceil(area.w), H = Math.ceil(area.h), s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H +
           'mm" viewBox="0 0 ' + W + ' ' + H + '">');
    s.push('<rect width="' + W + '" height="' + H + '" fill="#fff"/>');
    s.push('<g fill="none" stroke="#111" stroke-width="0.35" ' +
           'stroke-linecap="round" stroke-linejoin="round">');
    r.tratti.forEach(function (tr) {
      s.push('<polyline points="' + tr.map(function (q) {
        return q.x.toFixed(3) + ',' + (H - q.y).toFixed(3);
      }).join(' ') + '"/>');
    });
    s.push('</g>');
    /* Il punto home, per capire dove sta la figura rispetto alla macchina. */
    s.push('<circle cx="' + home.x + '" cy="' + (H - home.y) + '" r="1.2" fill="#c00"/>');
    s.push('</svg>');
    fs.writeFileSync(svgOut, s.join('\n') + '\n');
    console.log('scritto ' + svgOut);
  }

  /* Durata stimata, per sapere se stare a guardare o andare a prendere un
     caffe: percorso diviso velocita, piu i movimenti di penna. */
  var dis = 0, spo = 0, pos = { x: home.x, y: home.y };
  r.tratti.forEach(function (tr) {
    spo += Math.hypot(tr[0].x - pos.x, tr[0].y - pos.y);
    for (var i = 1; i < tr.length; i++) dis += Math.hypot(tr[i].x - tr[i-1].x, tr[i].y - tr[i-1].y);
    pos = tr[tr.length - 1];
  });
  var st = Profile.stampa();
  var sec = dis / st.velocitaDisegno * 60 + spo / st.velocitaSpostamento * 60 +
            r.tratti.length * 2 * (0.34 + st.pausaPennaMs / 1000);
  console.log('disegno ' + dis.toFixed(0) + ' mm, spostamenti ' + spo.toFixed(0) +
              ' mm, durata stimata ' + Math.floor(sec / 60) + ' min ' +
              ('0' + Math.round(sec % 60)).slice(-2) + ' s');
  console.log(r.tratti.length + ' tratti, ' +
              r.tratti.reduce(function (s, t) { return s + t.length; }, 0) + ' punti, ' +
              (testa + g).length + ' byte');
}
