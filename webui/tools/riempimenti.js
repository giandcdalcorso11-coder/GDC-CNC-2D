/* Due modi di riempire una cornice, scelti perché sono opposti: se uno dei due
 * esce male e l'altro bene, la differenza dice qualcosa.
 *
 *   SPIROGRAFO   curve continue, raggio e curvatura che cambiano senza mai
 *                fermarsi. Mette alla prova l'interpolazione fra i due assi e
 *                la costanza del tratto in ogni direzione. Gli errori si
 *                manifestano come deformazione della simmetria.
 *   HILBERT      tutti segmenti dritti ad angolo retto, migliaia di inversioni
 *                di direzione. È il caso peggiore per il GIOCO: ogni inversione
 *                lo paga, e si accumula. Gli errori si manifestano come maglie
 *                di larghezza diversa fra andata e ritorno.
 *
 * Tutte e due sono UNA LINEA SOLA: la penna non si stacca mai, quindi la
 * chiusura misura l'errore accumulato su tutto il percorso.
 */

/* ------------------------------- spirografo ------------------------------
   Ipotrocoide: un cerchio di raggio r rotola DENTRO uno di raggio R, e la
   penna sta a distanza d dal centro di quello che rotola.
       x = (R-r)·cos t + d·cos((R-r)/r · t)
       y = (R-r)·sin t − d·sin((R-r)/r · t)
   La figura si chiude dopo r/gcd(R,r) giri: con R e r interi il conto è esatto
   e non si va a tentativi. */
function mcd(a, b) { return b ? mcd(b, a % b) : a; }

/* Semplificazione a FRECCIA: si tiene un punto solo quando toglierlo
   sposterebbe la curva di più della tolleranza. È il criterio giusto per una
   spezzata che approssima una curva — limitare la CORDA invece della freccia
   produce centinaia di migliaia di punti per niente, perché la freccia va col
   QUADRATO della corda: dimezzare l'errore costa solo il 40% di punti in più,
   e viceversa una corda dieci volte più corta riduce l'errore di cento. */
function semplifica(p, tol) {
  if (p.length < 3) return p.slice();
  var out = [p[0]], a = 0;
  while (a < p.length - 1) {
    var b = a + 1;
    while (b + 1 < p.length && scartoMax(p, a, b + 1) <= tol) b++;
    out.push(p[b]);
    a = b;
  }
  return out;
}

/* Lo scarto massimo dei punti fra a e b dal segmento a-b. */
function scartoMax(p, a, b) {
  var A = p[a], B = p[b];
  var dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
  if (L === 0) return Infinity;
  var m = 0;
  for (var i = a + 1; i < b; i++) {
    var e = Math.abs((p[i].x - A.x) * dy - (p[i].y - A.y) * dx) / L;
    if (e > m) m = e;
  }
  return m;
}

function spirografo(P) {
  var R = P.R, r = P.r, d = P.d;
  var giri = r / mcd(R, r);
  var k = (R - r) / r, grezzi = [];
  /* Si genera fitto - mille punti per giro del cerchietto, cioè molto più di
     quanto serva - e poi si toglie quello che non cambia niente. Generare
     "giusto" richiederebbe la curvatura locale dell'ipotrocoide, che si può
     fare ma è un conto fragile; misurare lo scarto a posteriori no. */
  var n = Math.ceil(giri * 1000 * R / r);
  for (var i = 0; i <= n; i++) {
    var t = i / n * giri * 2 * Math.PI;
    grezzi.push({ x: (R - r) * Math.cos(t) + d * Math.cos(k * t),
                  y: (R - r) * Math.sin(t) - d * Math.sin(k * t) });
  }
  var raggioMax = (R - r) + d;
  /* La tolleranza va applicata DOPO la scala, se no stringendo la figura si
     stringe anche l'errore e si tengono punti inutili. */
  var scala = P.raggio ? P.raggio / raggioMax : 1;
  if (scala !== 1) {
    grezzi = grezzi.map(function (q) { return { x: q.x * scala, y: q.y * scala }; });
    raggioMax = P.raggio;
  }
  var p = semplifica(grezzi, P.tolleranza);
  return { punti: p, giri: giri, lobi: R / mcd(R, r), raggioMax: raggioMax,
           grezzi: grezzi.length };
}

/* --------------------------------- Hilbert -------------------------------
   Costruzione ricorsiva classica: il quadrato si divide in quattro e la curva
   visita i quattro quadranti in un ordine che li collega senza salti. L'ordine
   n dà 4^n celle e 4^n − 1 segmenti, tutti lunghi uguali. */
function hilbert(ordine) {
  var p = [];
  (function passo(x, y, xi, xj, yi, yj, n) {
    if (n <= 0) {
      p.push({ x: x + (xi + yi) / 2, y: y + (xj + yj) / 2 });
      return;
    }
    passo(x,               y,               yi/2,  yj/2,  xi/2,  xj/2,  n-1);
    passo(x+xi/2,          y+xj/2,          xi/2,  xj/2,  yi/2,  yj/2,  n-1);
    passo(x+xi/2+yi/2,     y+xj/2+yj/2,     xi/2,  xj/2,  yi/2,  yj/2,  n-1);
    passo(x+xi/2+yi,       y+xj/2+yj,      -yi/2, -yj/2, -xi/2, -xj/2,  n-1);
  })(0, 0, 1, 0, 0, 1, ordine);
  return p;   // coordinate normalizzate in 0..1
}

module.exports = { spirografo: spirografo, hilbert: hilbert, mcd: mcd,
                   semplifica: semplifica, scartoMax: scartoMax };

/* ------------------------------ riga di comando --------------------------
   Cornice alle misure massime più un riempimento. Il G-code lo emette
   Gcode.build dell'interfaccia: quote Z, punto home e generazione modale
   restano in un posto solo.

   Uso:  node riempimenti.js --figura spirografo --gcode f.gcode --svg f.svg
         ... --R 120 --r 35 --d 70 --raggio 105
         node riempimenti.js --figura hilbert --ordine 5 --lato 210
*/
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

  var arg = function (n, pre) { var i = a.indexOf('--' + n); return i > 0 ? a[i + 1] : pre; };
  var area = Profile.areaUtile(), home = Profile.puntoHome();
  var m = 0.5;
  var F = { x0: m, y0: m, x1: m + Math.floor(area.w - 2 * m), y1: m + Math.floor(area.h - 2 * m) };
  var cx = (F.x0 + F.x1) / 2, cy = (F.y0 + F.y1) / 2;
  var tol = parseFloat(arg('tolleranza', 1 / Profile.passiPerMm('x')));

  var tratti = [[{x:F.x0,y:F.y0},{x:F.x1,y:F.y0},{x:F.x1,y:F.y1},{x:F.x0,y:F.y1},{x:F.x0,y:F.y0}]];
  var figura = arg('figura', 'spirografo'), info = '', dentro;

  if (figura === 'hilbert') {
    var ord = parseInt(arg('ordine', 5), 10);
    var lato = parseFloat(arg('lato', 210));
    var p = hilbert(ord);
    dentro = p.map(function (q) {
      return { x: cx - lato / 2 + q.x * lato, y: cy - lato / 2 + q.y * lato };
    });
    info = 'curva di Hilbert di ordine ' + ord + ': ' + dentro.length + ' punti, ' +
           'maglia ' + (lato / (Math.pow(2, ord) - 1)).toFixed(2) + ' mm, lato ' + lato;
  } else {
    var S = spirografo({ R: parseFloat(arg('R', 120)), r: parseFloat(arg('r', 35)),
                         d: parseFloat(arg('d', 70)),
                         raggio: parseFloat(arg('raggio', 105)), tolleranza: tol });
    dentro = S.punti.map(function (q) { return { x: cx + q.x, y: cy + q.y }; });
    info = 'ipotrocoide ' + S.lobi + ' lobi in ' + S.giri + ' giri: ' + S.punti.length +
           ' punti (da ' + S.grezzi + ', semplificati a freccia ' + tol.toFixed(4) +
           '), raggio ' + S.raggioMax.toFixed(1);
  }
  tratti.push(dentro);

  /* Niente esce dalla cornice: si controlla, non si spera. */
  dentro.forEach(function (q) {
    if (q.x < F.x0 || q.x > F.x1 || q.y < F.y0 || q.y > F.y1) {
      throw new Error('il riempimento esce dalla cornice: ' + q.x.toFixed(2) + ',' + q.y.toFixed(2));
    }
  });

  var giu = Profile.zContatto(), st = Profile.stampa();
  var g = Gcode.build(tratti, {
    penUp: Profile.zAlzata(), penDown: giu, penTappo: Profile.zTappo(), ritorno: home,
    pennaTarata: true, pausaMs: st.pausaPennaMs, feedDraw: st.velocitaDisegno,
    feedTravel: st.velocitaSpostamento, feedPen: 600
  });

  var lung = 0;
  tratti.forEach(function (t) {
    for (var i = 1; i < t.length; i++) lung += Math.hypot(t[i].x - t[i-1].x, t[i].y - t[i-1].y);
  });
  var testa = [
    '; GDC CNC 2D - cornice ' + (F.x1 - F.x0) + ' x ' + (F.y1 - F.y0) + ' con ' + figura,
    ';', '; ' + info, ';',
    '; Cornice da X' + F.x0 + ' Y' + F.y0 + ' a X' + F.x1 + ' Y' + F.y1 + ', centro ' + cx + ',' + cy + '.',
    '; Foglio minimo ' + (F.x1 - F.x0) + ' x ' + (F.y1 - F.y0) + ' mm.',
    '; Due tratti soli: la cornice e il riempimento. Dentro ognuno la penna',
    '; non si stacca mai, quindi la chiusura misura l errore accumulato.',
    ';',
    '; LE QUOTE Z SONO NEGATIVE. Z0 e il tappo; Z' + giu.toFixed(3) + ' la punta sul foglio.',
    ''].join('\n');

  var out = arg('gcode');
  if (out) { fs.writeFileSync(out, testa + g); console.log('scritto ' + out); }
  var svgOut = arg('svg');
  if (svgOut) {
    var W = Math.ceil(area.w), H = Math.ceil(area.h), s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H +
           'mm" viewBox="0 0 ' + W + ' ' + H + '">');
    s.push('<rect width="' + W + '" height="' + H + '" fill="#fff"/>');
    s.push('<g fill="none" stroke="#111" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round">');
    tratti.forEach(function (t) {
      s.push('<polyline points="' + t.map(function (q) {
        return q.x.toFixed(3) + ',' + (H - q.y).toFixed(3); }).join(' ') + '"/>');
    });
    s.push('</g><circle cx="' + home.x + '" cy="' + (H - home.y) + '" r="1.2" fill="#c00"/></svg>');
    fs.writeFileSync(svgOut, s.join('\n') + '\n');
    console.log('scritto ' + svgOut);
  }
  var sec = lung / st.velocitaDisegno * 60 + tratti.length * 2 * (0.34 + st.pausaPennaMs / 1000);
  console.log(info + '\n  ' + Math.round(lung) + ' mm, ' + (testa + g).length + ' byte, ' +
              Math.floor(sec / 60) + ' min ' + ('0' + Math.round(sec % 60)).slice(-2) + ' s');
}
