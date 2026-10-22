/* Vortice di quadrati: la costruzione classica in cui ogni quadrato ha i
 * vertici su una frazione fissa dei lati del precedente. Il risultato gira su
 * se stesso e si stringe verso il centro.
 *
 * L'ho scelto per tre motivi, e nessuno dei tre è decorativo.
 *
 * 1. È UNA LINEA SOLA. Il passaggio da un quadrato al successivo cade su un
 *    lato già disegnato, quindi si fa a penna giù ripassandoci sopra: in tutta
 *    la figura la penna non si stacca mai. Che vuol dire nessun blob di
 *    attacco, nessuna pausa di servo, e soprattutto: la chiusura finale misura
 *    l'errore ACCUMULATO su tutto il percorso, senza che un'alzata lo nasconda.
 *
 * 2. OGNI SEGMENTO HA UN ANGOLO DIVERSO. Ogni quadrato è ruotato di
 *    atan(f/(1-f)) rispetto al precedente, quindi su quaranta quadrati si
 *    passano tutte le direzioni. Un errore che dipende dalla direzione - gioco,
 *    fuori squadra, scala diversa fra i due assi - non si nasconde in nessun
 *    punto della figura: fa andare il vortice storto, e si vede a occhio
 *    perché la simmetria è il riferimento.
 *
 * 3. I QUADRATI DIVENTANO PICCOLI. Verso il centro il lato scende sotto il
 *    millimetro, cioè sotto tre volte la larghezza del tratto: è lì che si
 *    legge la risoluzione vera della macchina, e si vede dove smette di
 *    distinguere.
 *
 * Uso:  node vortice.js --gcode v.gcode --svg v.svg
 *       ... --lato 150 --f 0.10 --minimo 3 --testo "GDC CNC 2D"
 */
var path = require('path');
var FontTratto = require(path.join(__dirname, 'font-tratto.js'));

/* Un passo del vortice: dai quattro vertici del quadrato ai quattro del
   successivo, ognuno a frazione f del lato. Il lato si accorcia di
   sqrt(f² + (1-f)²) e la figura ruota di atan2(f, 1-f). */
function prossimo(V, f) {
  var W = [];
  for (var i = 0; i < 4; i++) {
    var a = V[i], b = V[(i + 1) % 4];
    W.push({ x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y) });
  }
  return W;
}

function lato(V) { return Math.hypot(V[1].x - V[0].x, V[1].y - V[0].y); }

function costruisci(P) {
  var cx = P.cx, cy = P.cy, L = P.lato, h = L / 2;
  var V = [{ x: cx - h, y: cy - h }, { x: cx + h, y: cy - h },
           { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h }];

  /* Un tratto solo: si parte dal primo vertice e non si stacca più. */
  var linea = [V[0]], quadrati = 0;
  while (lato(V) >= P.minimo) {
    linea.push(V[1], V[2], V[3], V[0]);     // il quadrato, che chiude
    quadrati++;
    var W = prossimo(V, P.f);
    /* W[0] sta sul lato V0-V1, appena disegnato: ci si arriva ripassandoci
       sopra, a penna giù. È il trucco che rende continua tutta la figura. */
    linea.push(W[0]);
    V = W;
  }

  var tratti = [linea];

  /* La scritta, se richiesta: sotto la figura, a tratto singolo. Non è una
     firma, è la prova del dettaglio piccolo - caratteri da 5 mm con tratti da
     un millimetro e mezzo, che è dove un plotter mostra se sa scrivere. */
  if (P.testo) {
    var alt = P.altezzaTesto;
    var w = FontTratto.larghezza(P.testo, alt);
    var tx = cx - w / 2, ty = cy - h - P.stacco - alt;
    FontTratto.testo(P.testo, tx, ty, alt).forEach(function (p) {
      tratti.push(p.map(function (q) { return { x: q.x, y: q.y }; }));
    });
    P._testo = { x: tx, y: ty, w: w, h: alt };
  }

  /* Quanto si disegna, che qui è tutto a penna giù tranne la scritta. */
  var lung = 0;
  tratti.forEach(function (t) {
    for (var i = 1; i < t.length; i++) lung += Math.hypot(t[i].x - t[i-1].x, t[i].y - t[i-1].y);
  });

  var rapporto = Math.sqrt(P.f * P.f + (1 - P.f) * (1 - P.f));
  return { tratti: tratti, quadrati: quadrati, lunghezza: lung,
           rapporto: rapporto,
           rotazione: Math.atan2(P.f, 1 - P.f) * 180 / Math.PI,
           latoFinale: lato(V),
           riquadro: { x0: cx - h, y0: P.testo ? P._testo.y : cy - h,
                       x1: cx + h, y1: cy + h } };
}

module.exports = { costruisci: costruisci, prossimo: prossimo };

/* ------------------------------ riga di comando --------------------------
   Il G-code lo emette Gcode.build dell'interfaccia: quote Z, punto home e
   generazione modale restano in un posto solo. */
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
  var home = Profile.puntoHome();
  var L = parseFloat(arg('lato', 150));
  var off = parseFloat(arg('offset', 20));
  var alt = parseFloat(arg('altezzaTesto', 5));
  var stacco = parseFloat(arg('stacco', 12));
  var testo = arg('testo', 'GDC CNC 2D');
  if (testo === 'no') testo = null;

  /* L'angolo in basso a sinistra di TUTTA la composizione - scritta compresa -
     cade a home + offset: è la quota che l'operatore conosce, perché è da lì
     che deve coprire il foglio. Il centro del vortice si ricava da quella. */
  var x0 = home.x + off, y0 = home.y + off;
  var cx = x0 + L / 2;
  var cy = y0 + L / 2 + (testo ? stacco + alt : 0);

  var P = { cx: cx, cy: cy, lato: L, f: parseFloat(arg('f', 0.10)),
            /* Sotto il millimetro il quadrato è più stretto di tre tratti di
               penna e diventa una macchia: è il punto in cui fermarsi. */
            minimo: parseFloat(arg('minimo', 1)),
            testo: testo, altezzaTesto: alt, stacco: stacco };
  var r = costruisci(P);

  var area = Profile.areaUtile();
  var rq = r.riquadro;
  if (rq.x1 > area.w || rq.y1 > area.h || rq.x0 < 0 || rq.y0 < 0) {
    throw new Error('la composizione esce dall\'area utile: X ' + rq.x0 + '..' + rq.x1 +
                    '  Y ' + rq.y0 + '..' + rq.y1 + '  area ' +
                    area.w.toFixed(1) + '×' + area.h.toFixed(1));
  }

  var giu = Profile.zContatto(), st = Profile.stampa();
  var g = Gcode.build(r.tratti, {
    penUp: giu + Profile.alzataMm(), penDown: giu, penTappo: Profile.zTappo(),
    ritorno: home, pennaTarata: true, pausaMs: st.pausaPennaMs,
    feedDraw: st.velocitaDisegno, feedTravel: st.velocitaSpostamento, feedPen: 600
  });

  var f2 = function (v) { return v.toFixed(2); };
  var testa = [
    '; GDC CNC 2D - vortice di quadrati',
    ';',
    '; ' + r.quadrati + ' quadrati, ognuno con i vertici al ' + (P.f * 100).toFixed(0) +
      '% dei lati del precedente.',
    '; Il lato si accorcia di ' + r.rapporto.toFixed(4) + ' e la figura ruota di ' +
      f2(r.rotazione) + ' gradi a ogni passo,',
    '; da ' + f2(P.lato) + ' mm fino a ' + f2(r.latoFinale) + ' mm.',
    ';',
    '; IL VORTICE E UNA LINEA SOLA: la penna non si stacca mai. Il passaggio da',
    '; un quadrato al successivo cade su un lato appena disegnato, quindi si fa',
    '; ripassandoci sopra. Per questo la CHIUSURA misura l errore accumulato su',
    '; tutto il percorso: nessuna alzata lo nasconde.',
    ';',
    '; COSA GUARDARE:',
    '; - la SIMMETRIA. Il vortice e il suo stesso riferimento: un errore che',
    ';   dipende dalla direzione lo fa andare storto, e si vede a occhio senza',
    ';   misurare niente.',
    '; - il CENTRO. Gli ultimi quadrati scendono sotto il millimetro: li si',
    ';   legge dove la macchina smette di distinguere.',
    '; - il lato esterno, col calibro: ' + f2(P.lato) + ' mm, e le due diagonali',
    ';   del quadrato esterno uguali fra loro (' + f2(Math.SQRT2 * P.lato) + ' mm).',
    ';',
    '; Composizione da X' + f2(rq.x0) + ' Y' + f2(rq.y0) + ' a X' + f2(rq.x1) +
      ' Y' + f2(rq.y1) + ', punto home X' + home.x + ' Y' + home.y + '.',
    '; Disegno ' + r.lunghezza.toFixed(0) + ' mm a ' + st.velocitaDisegno + ' mm/min.',
    ';',
    '; LE QUOTE Z SONO NEGATIVE. Z0 e la posizione tappo, in cima alla corsa;',
    '; Z' + giu.toFixed(3) + ' e la punta sul foglio.',
    ''].join('\n');

  var out = arg('gcode');
  if (out) { fs.writeFileSync(out, testa + g); console.log('scritto ' + out); }

  var svgOut = arg('svg');
  if (svgOut) {
    var W = Math.ceil(area.w), H = Math.ceil(area.h), s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H +
           'mm" viewBox="0 0 ' + W + ' ' + H + '">');
    s.push('<rect width="' + W + '" height="' + H + '" fill="#fff"/>');
    s.push('<g fill="none" stroke="#111" stroke-width="0.3" ' +
           'stroke-linecap="round" stroke-linejoin="round">');
    r.tratti.forEach(function (t) {
      s.push('<polyline points="' + t.map(function (q) {
        return q.x.toFixed(3) + ',' + (H - q.y).toFixed(3);
      }).join(' ') + '"/>');
    });
    s.push('</g>');
    s.push('<circle cx="' + home.x + '" cy="' + (H - home.y) + '" r="1.2" fill="#c00"/>');
    s.push('</svg>');
    fs.writeFileSync(svgOut, s.join('\n') + '\n');
    console.log('scritto ' + svgOut);
  }

  var sec = r.lunghezza / st.velocitaDisegno * 60 +
            r.tratti.length * 2 * (0.34 + st.pausaPennaMs / 1000);
  console.log(r.quadrati + ' quadrati, ' + r.tratti.length + ' tratti, ' +
              r.tratti.reduce(function (s, t) { return s + t.length; }, 0) + ' punti, ' +
              (testa + g).length + ' byte, durata ' + Math.floor(sec / 60) + ' min ' +
              ('0' + Math.round(sec % 60)).slice(-2) + ' s');
}
