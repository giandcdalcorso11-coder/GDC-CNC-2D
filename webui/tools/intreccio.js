/* Tre esagoni intrecciati: la trama dello schizzo, costruita invece che
 * ricalcata.
 *
 * Quello che si vede nell'immagine è una spirale esagonale a TRE PARTENZE,
 * disegnata come banda invece che come linea. Tre spirali identiche sfasate
 * di 120 gradi si incastrano senza toccarsi se il passo radiale è scelto
 * bene: in un giro la spirale scende di 6*delta, e in quello spazio devono
 * entrare tre bande con i loro vuoti, quindi
 *
 *     6*delta = 3*(larghezza + vuoto)      ->   delta = (larghezza + vuoto)/2
 *
 * Non è una scelta estetica: con un delta diverso le bande o si sovrappongono
 * o lasciano un vuoto irregolare, e la trama smette di leggersi.
 *
 * Le CURVE arrivano da lì e non da fuori: ogni svolta della banda, invece di
 * essere uno spigolo a 120 gradi, diventa un arco TANGENTE ai due tratti. Il
 * raggio non è libero — è fissato dalla geometria della svolta — quindi le
 * curve sono coerenti col disegno per costruzione, non per occhio.
 *
 * Uso:  node intreccio.js --gcode i.gcode --svg i.svg
 *       ... --raggiounita 50 --banda 4 --vuoto 2 --giri 2 --raccordo 3
 */
var path = require('path');
var FontTratto = require(path.join(__dirname, 'font-tratto.js'));

function esagono(cx, cy, R, faseGradi) {
  var f = (faseGradi || 0) * Math.PI / 180, p = [];
  for (var i = 0; i <= 6; i++) {
    var a = f + i * Math.PI / 3;
    p.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return p;
}

/* Spirale esagonale ARCHIMEDEA: il raggio cala di delta a ogni lato, non di
   un fattore. Qui serve il passo costante, se no le bande non resterebbero
   larghe uguali e la trama si sfalderebbe verso il centro. */
function spiraleArchimedea(cx, cy, r0, delta, passi, faseGradi) {
  var f = (faseGradi || 0) * Math.PI / 180, p = [];
  for (var k = 0; k <= passi; k++) {
    var r = r0 - k * delta;
    if (r <= 0) break;
    var a = f + k * Math.PI / 3;
    p.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return p;
}

/* Offset di una spezzata a distanza d, con giunzione a spigolo vivo: i due
   lati offsettati si prolungano fino a incontrarsi. Sui capi si offsetta
   perpendicolarmente al segmento che c'è. */
function offset(p, d) {
  var out = [], n = p.length;
  var normale = function (a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    return { x: -dy / L, y: dx / L };
  };
  for (var i = 0; i < n; i++) {
    if (i === 0) {
      var nn = normale(p[0], p[1]);
      out.push({ x: p[0].x + nn.x * d, y: p[0].y + nn.y * d });
    } else if (i === n - 1) {
      var nf = normale(p[n-2], p[n-1]);
      out.push({ x: p[n-1].x + nf.x * d, y: p[n-1].y + nf.y * d });
    } else {
      var n1 = normale(p[i-1], p[i]), n2 = normale(p[i], p[i+1]);
      /* Punto di incontro delle due rette offsettate. La bisettrice dà lo
         stesso risultato con meno casi limite: lo spostamento vale
         d / sin(theta/2) lungo la bisettrice delle due normali. */
      var bx = n1.x + n2.x, by = n1.y + n2.y, L = Math.hypot(bx, by);
      if (L < 1e-12) { out.push({ x: p[i].x + n1.x * d, y: p[i].y + n1.y * d }); continue; }
      bx /= L; by /= L;
      var cos = n1.x * bx + n1.y * by;        // = cos(metà angolo fra le normali)
      out.push({ x: p[i].x + bx * d / cos, y: p[i].y + by * d / cos });
    }
  }
  return out;
}

/* Arrotonda gli spigoli di una spezzata con archi TANGENTI: su ogni vertice
   si arretra di t su tutti e due i lati e si raccorda con un arco di cerchio
   che tocca i due segmenti. Il raggio esce dalla geometria, non si sceglie:
   r = t * tan(theta/2), con theta l'angolo interno. */
function arrotonda(p, t, segmenti) {
  if (p.length < 3) return p.slice();
  var out = [p[0]];
  for (var i = 1; i < p.length - 1; i++) {
    var A = p[i-1], B = p[i], C = p[i+1];
    var v1 = { x: A.x - B.x, y: A.y - B.y }, v2 = { x: C.x - B.x, y: C.y - B.y };
    var L1 = Math.hypot(v1.x, v1.y), L2 = Math.hypot(v2.x, v2.y);
    var tt = Math.min(t, L1 / 2, L2 / 2);
    if (tt < 1e-9) { out.push(B); continue; }
    v1.x /= L1; v1.y /= L1; v2.x /= L2; v2.y /= L2;
    var P1 = { x: B.x + v1.x * tt, y: B.y + v1.y * tt };
    var P2 = { x: B.x + v2.x * tt, y: B.y + v2.y * tt };
    /* Arco quadratico di Bezier B->P1,P2: passa tangente a tutti e due i
       segmenti e per un angolo di 120 gradi è indistinguibile da un arco di
       cerchio alla risoluzione di una penna. */
    for (var s = 0; s <= segmenti; s++) {
      var u = s / segmenti, w = 1 - u;
      out.push({ x: w*w*P1.x + 2*w*u*B.x + u*u*P2.x,
                 y: w*w*P1.y + 2*w*u*B.y + u*u*P2.y });
    }
  }
  out.push(p[p.length-1]);
  return out;
}

/* Una banda: le due sponde di una spezzata, più i due tappi che le chiudono.
   Si emette come UN tratto solo, andata su una sponda e ritorno sull'altra,
   così la penna non si stacca e i tappi vengono gratis. */
function banda(p, w, raccordo, segmenti) {
  var q = raccordo > 0 ? arrotonda(p, raccordo, segmenti) : p;
  var a = offset(q, w / 2), b = offset(q, -w / 2);
  return a.concat(b.slice().reverse()).concat([a[0]]);
}

function costruisci(P) {
  var tratti = [], R = P.raggioUnita;
  /* Tre esagoni che condividono un lato: i centri formano un triangolo
     equilatero di lato R*sqrt(3), quindi stanno a distanza R dal centro
     della composizione. */
  var centri = [];
  for (var i = 0; i < 3; i++) {
    var a = Math.PI / 2 + i * 2 * Math.PI / 3;
    centri.push({ x: P.cx + R * Math.cos(a), y: P.cy + R * Math.sin(a) });
  }

  var delta = (P.banda + P.vuoto) / 2;
  var passi = Math.round(P.giri * 6);

  centri.forEach(function (c) {
    tratti.push(esagono(c.x, c.y, R, 90));
    for (var j = 0; j < 3; j++) {
      var sp = spiraleArchimedea(c.x, c.y, P.r0, delta, passi, 90 + j * 120);
      if (sp.length > 2) tratti.push(banda(sp, P.banda, P.raccordo, P.segmenti));
    }
  });

  return { tratti: tratti, centri: centri, delta: delta, passi: passi,
           raggioComposizione: 2 * R };
}

module.exports = { costruisci: costruisci, esagono: esagono, offset: offset,
                   arrotonda: arrotonda, banda: banda,
                   spiraleArchimedea: spiraleArchimedea };

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
  var R = parseFloat(arg('raggiounita', 50));
  var cx = (F.x0 + F.x1) / 2, cy = parseFloat(arg('cy', 128));

  var C = costruisci({ cx: cx, cy: cy, raggioUnita: R,
                       r0: parseFloat(arg('r0', R - 4)),
                       banda: parseFloat(arg('banda', 4)),
                       vuoto: parseFloat(arg('vuoto', 2)),
                       giri: parseFloat(arg('giri', 2)),
                       raccordo: parseFloat(arg('raccordo', 3)),
                       segmenti: parseInt(arg('segmenti', 6), 10) });

  var tratti = [];
  if (arg('cornice') !== 'no') {
    tratti.push([{x:F.x0,y:F.y0},{x:F.x1,y:F.y0},{x:F.x1,y:F.y1},{x:F.x0,y:F.y1},{x:F.x0,y:F.y0}]);
  }
  /* Il cerchio che contiene tutto, come nello schizzo: passa per i vertici
     esterni dei tre esagoni, che stanno a 2R dal centro. */
  if (arg('cerchio') !== 'no') {
    var Rc = C.raggioComposizione + parseFloat(arg('stacco', 8));
    var nc = Math.ceil(Math.PI / Math.acos(1 - tol / Rc)), p = [];
    for (var i = 0; i <= nc; i++) {
      var t = Math.PI / 2 + i / nc * 2 * Math.PI;
      p.push({ x: cx + Rc * Math.cos(t), y: cy + Rc * Math.sin(t) });
    }
    tratti.push(p);
  }
  C.tratti.forEach(function (t) { tratti.push(t); });

  var testo = arg('testo', 'GDC CNC 2D');
  if (testo !== 'no') {
    var alt = parseFloat(arg('altezzaTesto', 8));
    var w = FontTratto.larghezza(testo, alt);
    FontTratto.testo(testo, cx - w / 2, parseFloat(arg('yTesto', 12)), alt)
      .forEach(function (q) { tratti.push(q.map(function (z) { return { x: z.x, y: z.y }; })); });
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
    '; GDC CNC 2D - tre esagoni intrecciati',
    ';',
    '; Tre esagoni di raggio ' + R + ' che condividono un lato: i centri formano un',
    '; triangolo equilatero di lato R*sqrt(3), quindi stanno a distanza R dal',
    '; centro della composizione.',
    ';',
    '; Dentro ognuno, una spirale esagonale a TRE PARTENZE disegnata come BANDA.',
    '; Il passo radiale non e scelto a occhio: in un giro la spirale scende di',
    '; 6*delta e in quello spazio devono entrare tre bande coi loro vuoti,',
    '; quindi delta = (banda + vuoto)/2 = ' + C.delta + '. Con un delta diverso le bande',
    '; si sovrappongono o lasciano vuoti irregolari, e la trama non si legge.',
    ';',
    '; LE CURVE arrivano da li e non da fuori: ogni svolta della banda, invece',
    '; di essere uno spigolo a 120 gradi, e un arco TANGENTE ai due tratti. Il',
    '; raggio e fissato dalla geometria della svolta, non scelto.',
    ';',
    '; Ogni banda e UN tratto solo: andata su una sponda e ritorno sull altra,',
    '; cosi i due tappi vengono gratis e la penna non si stacca.',
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
