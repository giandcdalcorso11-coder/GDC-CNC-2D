/* Trame che riempiono il campo, invece di una figura al centro.
 *
 *   ONDE      una famiglia di linee parallele deformate da un campo liscio.
 *             Ogni linea è un tratto solo da un bordo all'altro, e si
 *             percorrono a BUSTROFEDICO — una a destra, la successiva a
 *             sinistra — senza ritorni a vuoto. Il gioco qui non si vede, e
 *             non per fortuna: è un'inversione lungo X mentre le linee
 *             CORRONO lungo X, quindi sposta solo dove la linea comincia e
 *             finisce, non la sua forma. Costa mezzo millimetro di frangia
 *             ai bordi e fa risparmiare metà del tempo.
 *
 *             È anche una buona prova: cinquanta linee vicine sono l'una il
 *             riferimento dell'altra, e un tremolio della macchina si vede
 *             come un'increspatura che attraversa il fascio. Da sola una
 *             linea storta non si nota; in mezzo alle sue vicine sì.
 *
 *   RETICOLO  tre famiglie di rette a 0, 60 e 120 gradi: la maglia triangolare.
 *             Qui invece gli incroci sono la misura — tre rette che si devono
 *             incontrare in un punto, e ogni incrocio sbagliato si vede.
 *
 * Uso:  node trame.js --trama onde --gcode t.gcode --svg t.svg
 *       ... --linee 48 --ampiezza 14
 *       node trame.js --trama reticolo --passo 9
 */
var path = require('path');
var Riemp = require(path.join(__dirname, 'riempimenti.js'));

/* Il campo che deforma le linee: somma di gobbe gaussiane. Due di segno
   opposto danno la piega a S delle trame "a tessuto", perché dove una spinge
   in su e l'altra in giù le linee si stringono. */
function deformazione(x, y, gobbe) {
  var s = 0;
  gobbe.forEach(function (g) {
    var dx = x - g.x, dy = y - g.y;
    s += g.a * Math.exp(-(dx * dx + dy * dy) / (2 * g.s * g.s));
  });
  return s;
}

function onde(P) {
  var tratti = [], passo = P.h / (P.linee - 1);
  for (var i = 0; i < P.linee; i++) {
    var base = P.y0 + i * passo, p = [];
    /* Campionamento fitto e poi semplificazione a freccia: la deformazione
       non ha una curvatura che si sappia scrivere, quindi si misura. */
    var n = Math.max(200, Math.ceil(P.w / 0.5));
    for (var j = 0; j <= n; j++) {
      var x = P.x0 + P.w * j / n;
      p.push({ x: x, y: base + deformazione(x, base, P.gobbe) });
    }
    p = Riemp.semplifica(p, P.tolleranza);
    /* Bustrofedico: la riga dispari si percorre al contrario, così la penna
       riparte da dove è arrivata. */
    tratti.push(i % 2 ? p.slice().reverse() : p);
  }
  return tratti;
}

/* Una retta di direzione (dx,dy) passante per (px,py), tagliata sul
   rettangolo. Algoritmo di Liang-Barsky ridotto al caso che serve. */
function tagliaSulRettangolo(px, py, dx, dy, R) {
  var t0 = -Infinity, t1 = Infinity;
  var prove = [[-dx, px - R.x0], [dx, R.x1 - px], [-dy, py - R.y0], [dy, R.y1 - py]];
  for (var i = 0; i < 4; i++) {
    var p = prove[i][0], q = prove[i][1];
    if (p === 0) { if (q < 0) return null; }
    else {
      var t = q / p;
      if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  if (!(t1 > t0)) return null;
  return [{ x: px + dx * t0, y: py + dy * t0 },
          { x: px + dx * t1, y: py + dy * t1 }];
}

function reticolo(P) {
  var R = { x0: P.x0, y0: P.y0, x1: P.x0 + P.w, y1: P.y0 + P.h };
  var cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
  var diag = Math.hypot(P.w, P.h), tratti = [];
  /* Tre direzioni a 60 gradi. Per ognuna si spazzano rette perpendicolari
     alla direzione, da -diag/2 a +diag/2: così la maglia copre il rettangolo
     comunque sia orientato. */
  [0, 60, 120].forEach(function (gradi, k) {
    var a = gradi * Math.PI / 180;
    var dx = Math.cos(a), dy = Math.sin(a);
    var nx = -dy, ny = dx;                     // normale alla direzione
    var m = Math.ceil(diag / 2 / P.passo), fam = [];
    for (var i = -m; i <= m; i++) {
      var off = i * P.passo;
      var seg = tagliaSulRettangolo(cx + nx * off, cy + ny * off, dx, dy, R);
      if (seg) fam.push(seg);
    }
    /* Anche qui bustrofedico: le rette di una stessa famiglia si percorrono
       alternate, così il salto fra una e la successiva è il passo e non la
       lunghezza della retta. */
    fam.forEach(function (s, i) { tratti.push(i % 2 ? [s[1], s[0]] : s); });
  });
  return tratti;
}

module.exports = { onde: onde, reticolo: reticolo, deformazione: deformazione,
                   tagliaSulRettangolo: tagliaSulRettangolo };

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
  /* La trama sta dentro la cornice con un margine, se no i due tratti si
     toccano e la cornice non si legge piu come cornice. */
  var mg = parseFloat(arg('margine', 12));
  var C = { x0: F.x0 + mg, y0: F.y0 + mg, w: (F.x1 - F.x0) - 2 * mg, h: (F.y1 - F.y0) - 2 * mg };

  var quale = arg('trama', 'onde'), tratti = [], info;
  if (arg('cornice') !== 'no') {
    tratti.push([{x:F.x0,y:F.y0},{x:F.x1,y:F.y0},{x:F.x1,y:F.y1},{x:F.x0,y:F.y1},{x:F.x0,y:F.y0}]);
  }

  if (quale === 'reticolo') {
    var passo = parseFloat(arg('passo', 12));
    var t = reticolo({ x0: C.x0, y0: C.y0, w: C.w, h: C.h, passo: passo });
    t.forEach(function (s) { tratti.push(s); });
    info = 'reticolo triangolare, passo ' + passo + ' mm, ' + t.length + ' rette in tre famiglie a 0, 60 e 120 gradi';
  } else {
    var linee = parseInt(arg('linee', 40), 10);
    var A = parseFloat(arg('ampiezza', 16));
    var gobbe = [{ x: C.x0 + C.w * 0.35, y: C.y0 + C.h * 0.62, a: A, s: C.w * 0.22 },
                 { x: C.x0 + C.w * 0.70, y: C.y0 + C.h * 0.32, a: -A, s: C.w * 0.20 }];
    var t = onde({ x0: C.x0, y0: C.y0, w: C.w, h: C.h, linee: linee,
                   gobbe: gobbe, tolleranza: tol });
    t.forEach(function (p) { tratti.push(p); });
    info = linee + ' linee, passo ' + (C.h / (linee - 1)).toFixed(2) +
           ' mm, deformate da due gobbe di ampiezza ' + A + ' mm di segno opposto';
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
    '; GDC CNC 2D - trama ' + quale + ' nella cornice ' + (F.x1-F.x0) + ' x ' + (F.y1-F.y0),
    ';', '; ' + info, ';'].concat(quale === 'onde' ? [
    '; I tratti si percorrono a BUSTROFEDICO: una linea verso destra, la',
    '; successiva verso sinistra, senza ritorni a vuoto. Il gioco qui non si',
    '; vede, e non per fortuna: e un inversione lungo X mentre le linee',
    '; CORRONO lungo X, quindi sposta solo dove la linea comincia e finisce,',
    '; non la sua forma. Costa mezzo millimetro di frangia ai bordi e fa',
    '; risparmiare meta del tempo.',
    ';',
    '; COSA GUARDARE: le linee vicine sono l una il riferimento dell altra.',
    '; Un tremolio della macchina si vede come un increspatura che attraversa',
    '; il fascio - da sola una linea storta non si noterebbe.'] : [
    '; Gli INCROCI sono la misura: tre rette si devono incontrare in un punto.',
    '; Ogni incrocio sbagliato si vede, e ce ne sono centinaia.']).concat([
    ';',
    '; Foglio minimo ' + (F.x1-F.x0) + ' x ' + (F.y1-F.y0) + ' mm.',
    '; LE QUOTE Z SONO NEGATIVE. Z0 e il tappo; Z' + giu.toFixed(3) + ' la punta sul foglio.',
    '']).join('\n');

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
  console.log(tratti.length + ' tratti, ' + Math.round(lung) + ' mm + ' + Math.round(vuoto) +
              ' a vuoto, ' + (testa + g).length + ' byte, ' +
              Math.floor(sec/60) + ' min ' + ('0' + Math.round(sec%60)).slice(-2) + ' s');
}
