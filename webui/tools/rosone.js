/* Un rosone: una curva a lobi le cui PUNTE sono tutte collegate fra loro.
 *
 * Non sono due disegni accostati né due metà tagliate: è un oggetto solo, e
 * lo è per costruzione. In un ipotrocoide il raggio del punto vale
 *
 *     ρ² = (R−r)² + d² + 2d(R−r)·cos((k+1)t)      con k = (R−r)/r
 *
 * quindi ha esattamente k+1 massimi, e nei massimi il punto cade sul cerchio
 * circoscritto ad angoli equispaziati. Scegliendo R = n·r si ottiene k+1 = n:
 * la curva ha n lobi e le loro PUNTE formano un poligono regolare di n
 * vertici, esatto, non approssimato. Collegando tutte le punte fra loro — il
 * grafo completo, la "rosa mistica" — le corde nascono sulla curva invece di
 * esserle appoggiate sopra.
 *
 * E si disegna tutto di fila. Ogni punta ha grado n−1 per le corde più 2 per
 * la curva che ci passa dentro: con n DISPARI, n−1 è pari e il grado totale è
 * pari su ogni vertice. Un grafo connesso con tutti i gradi pari ha un
 * circuito euleriano, quindi esiste un percorso che fa ogni corda e ogni arco
 * esattamente una volta e torna al punto di partenza. LA PENNA NON SI STACCA
 * MAI, dal primo punto all'ultimo.
 *
 * Il che rende la chiusura una misura: l'errore accumulato su tutto il
 * percorso si legge in un punto solo, dove la fine deve ritrovare l'inizio.
 *
 * Uso:  node rosone.js --gcode r.gcode --svg r.svg
 *       ... --lobi 9 --raggio 90 --profondita 60 --cornice no
 */
var path = require('path');
var FontTratto = require(path.join(__dirname, 'font-tratto.js'));
var Riemp = require(path.join(__dirname, 'riempimenti.js'));

/* Circuito euleriano su un MULTIGRAFO: gli archi sono oggetti con i loro
   punti, non semplici coppie, perché fra due punte corrono sia una corda
   dritta sia (per le punte adiacenti) un arco di curva. */
function euleriano(nNodi, archi) {
  var adj = [], i;
  for (i = 0; i < nNodi; i++) adj.push([]);
  archi.forEach(function (e, k) { adj[e.a].push(k); adj[e.b].push(k); });
  var usato = new Array(archi.length).fill(false);
  var ptr = new Array(nNodi).fill(0);
  var pila = [{ nodo: 0, arco: -1, da: -1 }], uscita = [];
  while (pila.length) {
    var v = pila[pila.length - 1].nodo, trovato = -1;
    while (ptr[v] < adj[v].length) {
      var k = adj[v][ptr[v]];
      if (!usato[k]) { trovato = k; break; }
      ptr[v]++;
    }
    if (trovato < 0) { uscita.push(pila.pop()); }
    else {
      usato[trovato] = true;
      var e = archi[trovato];
      pila.push({ nodo: e.a === v ? e.b : e.a, arco: trovato, da: v });
    }
  }
  return uscita.reverse();
}

function costruisci(P) {
  var n = P.lobi;
  if (n % 2 === 0) throw new Error('i lobi devono essere DISPARI: con un numero pari il ' +
                                   'grado dei vertici è dispari e il tratto si spezza');
  /* R = n·r dà k+1 = n, cioè n lobi in un giro solo. r è libero: sparisce
     nella scala finale, quindi vale solo come unità del disegno. */
  var r = 20, R = n * r, d = P.profondita, k = (R - r) / r;
  var raggioMax = (R - r) + d;
  var scala = P.raggio / raggioMax;

  var punto = function (t) {
    return { x: P.cx + scala * ((R - r) * Math.cos(t) + d * Math.cos(k * t)),
             y: P.cy + scala * ((R - r) * Math.sin(t) - d * Math.sin(k * t)) };
  };

  /* Le n punte, ai massimi del raggio. */
  var punte = [];
  for (var m = 0; m < n; m++) punte.push(punto(2 * Math.PI * m / n));

  /* Gli n archi di curva fra una punta e la successiva, campionati fitti e poi
     semplificati a freccia. Gli estremi restano quelli esatti: sono i nodi del
     grafo, e se si spostassero le corde non partirebbero più dalla curva. */
  var archi = [];
  for (m = 0; m < n; m++) {
    var t0 = 2 * Math.PI * m / n, t1 = 2 * Math.PI * (m + 1) / n, fitto = [];
    var passi = 2000;
    for (var i = 0; i <= passi; i++) fitto.push(punto(t0 + (t1 - t0) * i / passi));
    var p = Riemp.semplifica(fitto, P.tolleranza);
    p[0] = punte[m];
    p[p.length - 1] = punte[(m + 1) % n];
    archi.push({ a: m, b: (m + 1) % n, punti: p, curva: true });
  }

  /* Le corde: tutte le coppie di punte. Quelle fra punte adiacenti esistono
     già come archi di curva, ma la corda è un'altra cosa — è la corda — e il
     multigrafo le tiene distinte. */
  for (var a = 0; a < n; a++) {
    for (var b = a + 1; b < n; b++) {
      archi.push({ a: a, b: b, punti: [punte[a], punte[b]], curva: false });
    }
  }

  /* Il percorso: un tratto solo che li usa tutti. */
  var giro = euleriano(n, archi);
  var linea = [punte[giro[0].nodo]];
  for (i = 1; i < giro.length; i++) {
    var e = archi[giro[i].arco];
    var pts = e.a === giro[i].da ? e.punti : e.punti.slice().reverse();
    for (var j = 1; j < pts.length; j++) linea.push(pts[j]);
  }

  return { linea: linea, punte: punte, archi: archi, lobi: n,
           corde: n * (n - 1) / 2, raggio: P.raggio,
           gradoVertice: (n - 1) + 2 };
}

module.exports = { costruisci: costruisci, euleriano: euleriano };

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
  var cx = (F.x0 + F.x1) / 2, cy = parseFloat(arg('cy', 128));
  var tol = parseFloat(arg('tolleranza', 1 / Profile.passiPerMm('x')));

  var R = Ro = costruisci({ lobi: parseInt(arg('lobi', 9), 10),
                            raggio: parseFloat(arg('raggio', 88)),
                            profondita: parseFloat(arg('profondita', 60)),
                            cx: cx, cy: cy, tolleranza: tol });

  var tratti = [];
  if (arg('cornice') !== 'no') {
    tratti.push([{x:F.x0,y:F.y0},{x:F.x1,y:F.y0},{x:F.x1,y:F.y1},{x:F.x0,y:F.y1},{x:F.x0,y:F.y0}]);
  }
  tratti.push(Ro.linea);

  var testo = arg('testo', 'GDC CNC 2D');
  if (testo !== 'no') {
    var alt = parseFloat(arg('altezzaTesto', 8));
    var w = FontTratto.larghezza(testo, alt);
    FontTratto.testo(testo, cx - w / 2, parseFloat(arg('yTesto', 18)), alt)
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

  var lung = 0, vuoto = 0, pos = { x: home.x, y: home.y };
  tratti.forEach(function (t) {
    vuoto += Math.hypot(t[0].x - pos.x, t[0].y - pos.y);
    for (var i = 1; i < t.length; i++) lung += Math.hypot(t[i].x - t[i-1].x, t[i].y - t[i-1].y);
    pos = t[t.length - 1];
  });
  vuoto += Math.hypot(home.x - pos.x, home.y - pos.y);

  var testa = [
    '; GDC CNC 2D - rosone: una curva a ' + Ro.lobi + ' lobi con le punte tutte collegate',
    ';',
    '; Non sono due disegni accostati. In un ipotrocoide il raggio del punto ha',
    '; esattamente k+1 massimi, e nei massimi il punto cade sul cerchio',
    '; circoscritto ad angoli EQUISPAZIATI. Scegliendo R = n*r si ottengono n',
    '; lobi le cui punte formano un poligono regolare esatto: le ' + Ro.corde + ' corde',
    '; nascono sulla curva invece di esserle appoggiate sopra.',
    ';',
    '; E SI DISEGNA TUTTO DI FILA. Ogni punta ha grado ' + (Ro.lobi-1) + ' per le corde piu 2',
    '; per la curva che ci passa dentro: ' + Ro.gradoVertice + ', pari. Un grafo connesso con',
    '; tutti i gradi pari ha un circuito euleriano, quindi un percorso solo fa',
    '; ogni corda e ogni arco una volta e torna dove e partito.',
    '; LA PENNA NON SI STACCA MAI: ' + Ro.linea.length + ' punti, ' + (Ro.corde + Ro.lobi) + ' tratti del grafo.',
    ';',
    '; QUINDI LA CHIUSURA E UNA MISURA: l errore accumulato su tutto il',
    '; percorso si legge in un punto solo, dove la fine ritrova l inizio.',
    ';',
    '; E I VERTICI NE SONO UN ALTRA. Su ognuno convergono ' + Ro.gradoVertice + ' tratti da ' + Ro.gradoVertice,
    '; direzioni diverse. Se il punto di arrivo dipende dalla direzione di',
    '; arrivo - cioe se ce gioco - la punta non chiude in un punto ma in una',
    '; rosellina, e la sua larghezza E il gioco. Si guarda con la lente. Nel',
    '; profilo vale 0,30 mm come valore NOMINALE, mai misurato su questa macchina.',
    ';',
    '; Raggio ' + Ro.raggio + ' in X' + cx + ' Y' + cy + '. Foglio minimo ' +
      (F.x1-F.x0) + ' x ' + (F.y1-F.y0) + ' mm.',
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
              Math.round(vuoto) + ' a vuoto, ' + (testa + g).length + ' byte, ' +
              Math.floor(sec/60) + ' min ' + ('0' + Math.round(sec%60)).slice(-2) + ' s');
}
