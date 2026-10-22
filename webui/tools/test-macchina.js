/* Il disegno di collaudo della macchina.
 *
 * Una stampa sola che riempie quasi tutta l'area e da cui si tirano fuori
 * undici cose diverse. Non è un disegno decorativo: ogni riquadro esiste
 * perché misura qualcosa, e perché quel qualcosa si legge con calibro, riga
 * d'acciaio e occhio. Come si leggono sta in misure/disegno-di-collaudo.md,
 * e i numeri nei riquadri rimandano lì.
 *
 * Ogni tratto porta tre cose oltre ai punti:
 *   z              scostamento di quota, in mm SOPRA il contatto. Quasi tutto
 *                  sta a zero; la prova del livello disegna a quote crescenti,
 *                  ed è così che un pezzo di piano più basso si manifesta — i
 *                  trattini alti non segnano. Non è la quota macchina: quella
 *                  esce da contatto + z, e il contatto è negativo.
 *   feed           velocità di quel tratto, per la prova 10. Assente = quella
 *                  di lavoro.
 *   avvicinamento  un punto da cui arrivare a penna alzata, per la prova 9:
 *                  la ripetibilità dipende da COME ci si arriva, quindi la
 *                  direzione di arrivo non può essere lasciata al caso.
 *
 * Uso:  node test-macchina.js --svg prova.svg
 *       node test-macchina.js --gcode prova.gcode --contatto -21.271 --alzata 2.945
 *
 * L'alzata di serie è 2,945 mm: i 9 gradi fra penna abbassata (25°) e penna
 * alzata (34°) del modulo montato il 2026-10-21, per 0,32725 mm/grado.
 *
 * IL CONTATTO È NEGATIVO, −21,271, e qui sta tutta la differenza con la
 * versione precedente di questo file. Senza finecorsa e senza homing FluidNC
 * mette lo zero macchina in CIMA alla corsa del servo e dichiara il resto in
 * negativo — verificato con $CD sulla macchina il 2026-10-22: «Axis Z
 * (-21.281, 0.010)». RcServo mappa la posizione MACCHINA con mapConstrain(),
 * che non rifiuta le quote fuori corsa: le TRONCA. Un file generato con il
 * contatto a 0 non disegna, perché ogni quota positiva finisce sullo stesso
 * impulso, quello del tappo, e la penna resta in alto per tutto il percorso.
 *
 * Quindi: Z0 = posizione tappo, Z−18,326 = penna alzata, Z−21,271 = sul
 * foglio. La variazione del singolo foglio la assorbe il popup dell'altezza
 * di contatto nell'interfaccia; qui si usa il nominale.
 */
var FontTratto = require('./font-tratto.js');

/* Il campo sta dentro la corsa percorribile rimisurata il 2026-10-22
   (251,23 × 236,06), con 5,2 mm di margine su X e 3,1 su Y. Se una prossima
   misura delle corse scende sotto questi due numeri, il campo va stretto:
   la prova 1 è proprio la cornice del campo utile, e se non ci sta non parte. */
var P = {
  larghezza: 246,
  altezza: 233,
  gradino: 0.30,        // salto di quota del livello: una banda morta di servo
  passoRighello: 10,
  lunghRighello: 200,
  lato: 128,            // lato del quadrato dello squadro
  velocita: [600, 1200, 2400, 4800]
};

var tratti = [];

/* ------------------------------ primitive -------------------------------- */

function tratto(punti, opt) {
  opt = opt || {};
  tratti.push({ z: opt.z || 0, feed: opt.feed || null,
                avvicinamento: opt.avvicinamento || null, punti: punti });
}

function linea(x1, y1, x2, y2, opt) {
  tratto([{ x: x1, y: y1 }, { x: x2, y: y2 }], opt);
}

function rett(x, y, w, h, opt) {
  tratto([{x:x,y:y},{x:x+w,y:y},{x:x+w,y:y+h},{x:x,y:y+h},{x:x,y:y}], opt);
}

function cerchio(cx, cy, r) {
  var n = Math.max(48, Math.round(r * 6)), p = [];
  for (var i = 0; i <= n; i++) {
    var a = i / n * Math.PI * 2;
    p.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  tratto(p, {});
}

function croce(x, y, b) {
  linea(x - b, y, x + b, y, {});
  linea(x, y - b, x, y + b, {});
}

function scritta(s, x, y, alt) {
  FontTratto.testo(s, x, y, alt).forEach(function (p) { tratto(p, {}); });
}

/* Un riquadro numerato. Il numero sta in una casella all'angolo, e rimanda al
   paragrafo del documento di lettura: sul foglio non c'è spazio per spiegare,
   e una legenda lunga disegnata a penna costa minuti di macchina. */
function riquadro(n, x, y, w, h, titolo) {
  rett(x, y, w, h, {});
  rett(x + 1.5, y + h - 7.5, 6, 6, {});
  var s = String(n);
  scritta(s, x + (s.length > 1 ? 2.2 : 3.4), y + h - 6, 3.6);
  if (titolo) scritta(titolo, x + 9.5, y + h - 5.8, 3);
}

/* ------------------------------- le prove -------------------------------- */

/* 1 — CORNICE. Il giro del campo utile: dice se tutta l'area è raggiungibile,
   e lo spessore del tratto sui quattro lati è la prima occhiata al livello. */
function cornice() {
  rett(0.5, 0.5, P.larghezza - 1, P.altezza - 1, {});
}

/* 2 e 3 — SCALA X e SCALA Y, più la rettilineità.
   Tacche ogni 10 mm su 200, più alte ogni 50: è la misura che tara i mm per
   giro ingranaggio. La riga di base del righello è lunga 200 mm ed è anche la
   prova di rettilineità di quell'asse — due prove nello stesso tratto, perché
   una riga d'acciaio appoggiata lì sopra le legge tutte e due insieme. */
function scalaX(x, y, w, h) {
  riquadro(2, x, y, w, h);
  var x0 = x + 20, y0 = y + 4, d;
  linea(x0, y0, x0 + P.lunghRighello, y0, {});
  for (d = 0; d <= P.lunghRighello; d += P.passoRighello) {
    linea(x0 + d, y0, x0 + d, y0 + (d % 50 === 0 ? 4.5 : 2.2), {});
    if (d % 50 === 0) scritta(String(d), x0 + d + 1.2, y0 + 5.2, 3);
  }
}

function scalaY(x, y, w, h) {
  riquadro(3, x, y, w, h);
  var x0 = x + 4, y0 = y + 12, d;
  linea(x0, y0, x0, y0 + 190, {});
  for (d = 0; d <= 190; d += P.passoRighello) {
    linea(x0, y0 + d, x0 + (d % 50 === 0 ? 4.5 : 2.2), y0 + d, {});
    if (d % 50 === 0) scritta(String(d), x0 + 5.6, y0 + d - 1.5, 3);
  }
}

/* 4 — SQUADRO. L'ortogonalità fra i due assi: si misurano le due diagonali fra
   le crocette d'angolo, e la differenza diviso 1,414 × lato è l'errore in
   radianti. Mezzo grado fa 1,3 mm sull'angolo di un A5, più di tutti gli altri
   errori messi insieme. Le crocette ci sono perché fra due spigoli sfumati non
   si misura niente. */
function squadro(x, y, w, h) {
  riquadro(4, x, y, w, h, 'SQUADRO');
  var L = P.lato, x0 = x + (w - L) / 2, y0 = y + (h - L) / 2 - 2;
  rett(x0, y0, L, L, {});
  linea(x0, y0, x0 + L, y0 + L, {});
  linea(x0 + L, y0, x0, y0 + L, {});
  [[x0,y0],[x0+L,y0],[x0+L,y0+L],[x0,y0+L]].forEach(function (c) { croce(c[0], c[1], 4); });
  scritta('LATO ' + L, x0 + L / 2 - 12, y0 - 6, 3);
}

/* 5 — CERCHI. Il controllo che si legge senza strumenti: se i mm per giro dei
   due assi non coincidono esce un'ellisse, e il verso dice quale asse è lungo.
   Se c'è gioco, nei quattro punti in cui un asse inverte compare uno scalino.
   Tre raggi perché un errore di scala cresce col raggio e un gioco no. */
function cerchi(x, y, w, h) {
  riquadro(5, x, y, w, h, 'CERCHI');
  var cx = x + w / 2, cy = y + h / 2 - 4;
  [8, 17, 26].forEach(function (r) { cerchio(cx, cy, r); });
  croce(cx, cy, 4);
}

/* 6 — GIOCO. La stessa serie di tacche disegnata due volte: sopra percorrendo
   l'asse in avanti, sotto tornando indietro. Lo scarto orizzontale fra una
   tacca e la sua gemella È il gioco, e si misura col calibro perché le tacche
   sono lunghe e nette. Previsione dal CAD: 0,30 mm. */
function gioco(x, y, w, h) {
  riquadro(6, x, y, w, h, 'GIOCO');
  var x0 = x + 10, y0 = y + 3, n = 9, passo = 12, i;
  for (i = 0; i < n; i++) linea(x0 + i * passo, y0 + 9, x0 + i * passo, y0 + 14, {});
  for (i = n - 1; i >= 0; i--) linea(x0 + i * passo, y0, x0 + i * passo, y0 + 5, {});
}

/* 7 — STACCHI. La pausa del servo e l'alzata: trattini separati da spazi. Se
   negli spazi resta un segno la penna non fa in tempo ad alzarsi, o l'alzata
   non basta a scavalcare il fuori-piano. Se ogni trattino comincia con un
   pallino, la penna si appoggia e aspetta ferma. */
function stacchi(x, y, w, h) {
  riquadro(7, x, y, w, h, 'STACCHI');
  var x0 = x + 6, y0 = y + 6;
  for (var i = 0; i < 6; i++) linea(x0 + i * 14, y0, x0 + i * 14 + 7, y0, {});
  for (var j = 0; j < 6; j++) linea(x0 + j * 14, y0 + 7, x0 + j * 14 + 3, y0 + 7, {});
}

/* 8 — CARATTERI. Quanto piccolo si può scrivere: il più piccolo che resta
   leggibile è la risoluzione utile della macchina CON QUELLA PENNA. A 2 mm,
   con una punta da 0,4, sono cinque larghezze di tratto: lì sotto non è la
   macchina a non farcela, è il pennarello. */
function caratteri(x, y, w, h) {
  riquadro(8, x, y, w, h, 'CARATTERI');
  var yy = y + h - 16;
  [5, 4, 3, 2.5, 2].forEach(function (a) {
    scritta(String(a).replace('.', ','), x + 4, yy, 2.5);
    scritta('GDC 0123', x + 13, yy, a);
    yy -= a + 4.5;
  });
}

/* 9 — RIPETIBILITÀ. Otto volte la stessa tacca, nello stesso punto, arrivando
   ogni volta da lontano. Se la macchina ripete, le otto si sovrappongono in
   una riga sola; se no, si allargano, e la larghezza della banda È la
   ripetibilità.
   Due bersagli, e la differenza fra i due è il punto: a sinistra si arriva
   SEMPRE DA SINISTRA, quindi il gioco è sempre preso dalla stessa parte e
   resta fuori dalla misura. A destra si arriva alternando i due versi, quindi
   il gioco entra: lo scarto fra le due bande è il gioco, ed è una seconda
   lettura indipendente da quella della prova 6. */
function ripetibilita(x, y, w, h) {
  riquadro(9, x, y, w, h, 'RIPETIBILITA');
  var y0 = y + 7, i, xa = x + 30, xb = x + 68;
  /* Gli otto trattini sono IMPILATI, non sovrapposti: se stessero uno sopra
     l'altro non si saprebbe nemmeno quanti sono stati disegnati. Impilati, un
     bordo verticale e netto vuol dire che la macchina ripete; un bordo seghettato
     è la dispersione, e si legge a occhio prima ancora che col calibro. */
  for (i = 0; i < 8; i++) {
    linea(xa, y0 + i * 1.15, xa, y0 + i * 1.15 + 0.9,
          { avvicinamento: { x: xa - 35, y: y0 + 5 } });
  }
  for (i = 0; i < 8; i++) {
    linea(xb, y0 + i * 1.15, xb, y0 + i * 1.15 + 0.9,
          { avvicinamento: { x: xb + (i % 2 ? 24 : -24), y: y0 + 5 } });
  }
  scritta('SEMPRE DA SX', x + 6, y + 3, 2.5);
  scritta('ALTERNATO', x + 56, y + 3, 2.5);
}

/* 10 — VELOCITÀ. Quattro righe lunghe uguali, disegnate a velocità diverse, e
   una riga verticale che le taglia tutte all'arrivo. Se a una certa velocità
   il motore perde passi, quella riga non arriva alla verticale — o la supera.
   Le righe sono lunghe 100 mm di proposito: con 200 mm/s² di accelerazione
   servono 16 mm solo per arrivare a 80 mm/s, quindi su un tratto corto la
   macchina non raggiunge mai la velocità che le hai chiesto e la prova non
   misura niente. */
function velocita(x, y, w, h) {
  riquadro(10, x, y, w, h, 'VELOCITA');
  var x0 = x + 14, L = 100, y0 = y + 4;
  P.velocita.forEach(function (f, i) {
    var yy = y0 + i * 6;
    linea(x0, yy, x0 + L, yy, { feed: f });
    scritta(String(f), x0 - 12.5, yy - 1.2, 2.5);
  });
  /* La verticale d'arrivo taglia tutte e quattro: una riga che non la tocca, o
     che la supera, ha perso passi a quella velocità. */
  linea(x0 + L, y0 - 2.5, x0 + L, y0 + 3 * 6 + 2.5, {});
  linea(x0, y0 - 2.5, x0, y0 + 3 * 6 + 2.5, {});
}

/* 11 — LIVELLO. L'unica prova che non sta in un riquadro, e non può starci:
   deve campionare TUTTA l'area, quindi i nove nodi sono sparsi dentro gli
   altri riquadri, nei punti vuoti.
   In ogni nodo quattro trattini affiancati, ognuno un gradino più in alto del
   precedente. Si contano quelli che hanno segnato: quattro vuol dire piano
   alto di un millimetro abbondante, uno vuol dire piano alla quota giusta,
   zero vuol dire piano più basso del contatto.
   Il gradino è 0,30 mm perché è la banda morta del servo: più fine di così il
   servo non sa muoversi, e si misurerebbe il rumore.
   Nove punti e non tre perché tre definiscono un piano, ma servono di più per
   vedere una svergolatura, che è un difetto diverso da un'inclinazione. */
function livello(nodi) {
  nodi.forEach(function (n) {
    for (var k = 0; k < 4; k++) {
      linea(n[0] + k * 1.7, n[1], n[0] + k * 1.7, n[1] + 5, { z: k * P.gradino });
    }
    scritta('11', n[0] - 0.5, n[1] + 5.6, 2.2);
  });
}

/* ------------------------------ assemblaggio ----------------------------- */

function costruisci() {
  tratti = [];
  cornice();
  scalaX(1, 1, 244, 17);
  scalaY(1, 20, 20, 212);
  squadro(23, 20, 148, 148);
  cerchi(173, 20, 72, 72);
  caratteri(173, 95, 72, 73);
  gioco(23, 171, 123, 23);
  ripetibilita(149, 171, 96, 23);
  velocita(23, 196, 123, 36);
  stacchi(149, 196, 96, 36);
  /* I nove punti del livello: scelti dove non c'è niente da incrociare, e
     sparsi su tutto il campo perché è l'area che devono campionare. */
  livello([[28, 25], [95, 25], [180, 25],
           [28, 120], [95, 120], [228, 100],
           [25, 174], [139, 200], [236, 200]]);
  tratti = riordina(tratti);
  return tratti;
}

/* Riordino col vicino più prossimo, con la libertà di percorrere un tratto da
   entrambi i capi. Non è estetica: così com'escono dal disegno gli spostamenti
   a vuoto superano il tratto disegnato, e sono minuti di macchina spesi a non
   disegnare. I tratti con un avvicinamento imposto non si rovesciano: il loro
   verso di arrivo È la misura. */
function riordina(lista) {
  var pool = lista.slice(), out = [], cur = { x: 0, y: 0 };
  while (pool.length) {
    var best = 0, bestD = Infinity, rovescia = false;
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i], p = t.punti;
      var rif = t.avvicinamento || p[0];
      var da = Math.hypot(rif.x - cur.x, rif.y - cur.y);
      if (da < bestD) { bestD = da; best = i; rovescia = false; }
      if (!t.avvicinamento) {
        var dz = Math.hypot(p[p.length-1].x - cur.x, p[p.length-1].y - cur.y);
        if (dz < bestD) { bestD = dz; best = i; rovescia = true; }
      }
    }
    var t2 = pool.splice(best, 1)[0];
    if (rovescia) t2 = { z: t2.z, feed: t2.feed, avvicinamento: null,
                         punti: t2.punti.slice().reverse() };
    out.push(t2);
    cur = t2.punti[t2.punti.length - 1];
  }
  return out;
}

/* --------------------------------- uscite -------------------------------- */

function svg() {
  var W = P.larghezza, H = P.altezza;
  var o = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + (W * 3.4) + '" height="' +
           (H * 3.4) + '" viewBox="0 0 ' + W + ' ' + H + '" style="background:#f7f5f0">',
           '<g transform="translate(0,' + H + ') scale(1,-1)">'];
  tratti.forEach(function (t) {
    var d = t.punti.map(function (p, i) {
      return (i ? 'L' : 'M') + p.x.toFixed(3) + ' ' + p.y.toFixed(3);
    }).join(' ');
    var col = t.z === 0 ? '#2b3038'
            : ['#2b3038', '#c2410c', '#0369a1', '#15803d'][Math.round(t.z / P.gradino)] || '#888';
    o.push('<path d="' + d + '" fill="none" stroke="' + col +
           '" stroke-width="0.35" stroke-linecap="round" stroke-linejoin="round"/>');
  });
  o.push('</g></svg>');
  return o.join('\n');
}

function gcode(opt) {
  var contatto = opt.contatto, alzata = opt.alzata;
  /* Quota a cui la penna sale a programma finito: ci sta il tappo senza
     togliere la penna dai morsetti. È il fine corsa ALTO, quindi Z0, e si
     esprime assoluta e non come contatto + qualcosa: sommarla al contatto
     misurato darebbe una quota sopra lo zero, che mapConstrain tronca. */
  var tappo = opt.tappo === undefined ? 0 : opt.tappo;
  var fd = opt.feedDisegno || 1200, fs = opt.feedSpostamento || 3000;
  var pausa = (opt.pausaMs === undefined ? 200 : opt.pausaMs) / 1000;
  /* Zeri in coda tolti: "93.000" diventa "93". Non si perde niente — un passo
     del motore vale 0,0295 mm, quindi il millesimo è già tre volte più fine
     di quanto la macchina sappia fare. */
  var n = function (v) {
    var t = (Math.round(v * 1000) / 1000).toFixed(3);
    return t.replace(/\.?0+$/, '');
  };

  /* Il file deve stare nella flash dell'ESP32, e lo spazio libero è ~64 kB.
     Scritto per esteso il collaudo ne occupa 69, cioè non ci sta. Si recupera
     sfruttando la modalità del G-code, che non è un trucco ma il modo in cui
     il linguaggio è fatto: si emette solo quello che CAMBIA.
       - la parola di movimento (G0/G1) resta valida fino a quando non cambia;
       - una coordinata non ripetuta vuol dire "quell'asse resta dov'è";
       - lo stesso vale per F.
     Una riga che non cambierebbe niente non si emette affatto: un G1 su un
     punto identico al precedente è, oltre che inutile, il caso che FluidNC ha
     dovuto correggere nella 4.1.1. */
  var modo = null, ux = null, uy = null, uz = null, uf = null;
  function muovi(g, x, y, z, f) {
    var p = '';
    if (g !== modo) { p += (p ? ' ' : '') + g; modo = g; }
    if (x !== undefined && n(x) !== ux) { p += (p ? ' ' : '') + 'X' + n(x); ux = n(x); }
    if (y !== undefined && n(y) !== uy) { p += (p ? ' ' : '') + 'Y' + n(y); uy = n(y); }
    if (z !== undefined && n(z) !== uz) { p += (p ? ' ' : '') + 'Z' + n(z); uz = n(z); }
    if (f !== undefined && String(f) !== uf) { p += (p ? ' ' : '') + 'F' + f; uf = String(f); }
    if (p) L.push(p);
  }
  var L = [];
  L.push('; GDC CNC 2D - disegno di collaudo');
  L.push('; campo ' + P.larghezza + ' x ' + P.altezza + ' mm');
  L.push('; gradino della prova 11 (livello): ' + P.gradino + ' mm');
  L.push('; contatto Z' + n(contatto) + ', alzata Z' + n(contatto + alzata));
  if (tappo > contatto + alzata) {
    L.push('; a fine programma la penna sale a Z' + n(tappo) + ' (tappo)');
  }
  L.push('; come si legge: misure/disegno-di-collaudo.md');
  L.push('G21'); L.push('G90');
  var attesa = pausa > 0 ? 'G4 P' + n(pausa) : null;
  muovi('G0', undefined, undefined, contatto + alzata);
  tratti.forEach(function (t) {
    var p = t.punti;
    if (t.avvicinamento) muovi('G0', t.avvicinamento.x, t.avvicinamento.y, undefined, fs);
    muovi('G0', p[0].x, p[0].y, undefined, fs);
    muovi('G1', undefined, undefined, contatto + t.z, 600);
    if (attesa) L.push(attesa);
    for (var i = 1; i < p.length; i++) {
      muovi('G1', p[i].x, p[i].y, undefined, i === 1 ? (t.feed || fd) : undefined);
    }
    muovi('G0', undefined, undefined, contatto + alzata);
    if (attesa) L.push(attesa);
  });
  muovi('G0', 0, 0, undefined, fs);
  /* Dopo il ritorno all'origine, non prima: così la testina è già ferma in un
     angolo quando ci arrivi con il tappo in mano. */
  if (tappo > contatto + alzata) muovi('G0', undefined, undefined, tappo);
  L.push('M2');
  return L.join('\n') + '\n';
}

function statistiche() {
  var d = 0, s = 0, cur = { x: 0, y: 0 }, pt = 0;
  tratti.forEach(function (t) {
    var p = t.punti;
    if (t.avvicinamento) {
      s += Math.hypot(t.avvicinamento.x - cur.x, t.avvicinamento.y - cur.y);
      cur = t.avvicinamento;
    }
    s += Math.hypot(p[0].x - cur.x, p[0].y - cur.y);
    for (var i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i-1].x, p[i].y - p[i-1].y);
    cur = p[p.length - 1];
    pt += p.length;
  });
  return { tratti: tratti.length, punti: pt, disegno: d, spostamento: s };
}

module.exports = { P: P, costruisci: costruisci, svg: svg, gcode: gcode,
                   tratti: function () { return tratti; },
                   statistiche: statistiche };

if (require.main === module) {
  var fs = require('fs'), a = process.argv;
  costruisci();
  if (a.indexOf('--svg') > 0) {
    var o = a[a.indexOf('--svg') + 1];
    fs.writeFileSync(o, svg()); console.log('scritto ' + o);
  }
  if (a.indexOf('--gcode') > 0) {
    var g = a[a.indexOf('--gcode') + 1];
    /* −21,271 e non 0: i 65 gradi fra posizione tappo (90) e penna abbassata
       (25), col segno che FluidNC impone. Vedi l'intestazione del file. */
    var c = a.indexOf('--contatto') > 0 ? parseFloat(a[a.indexOf('--contatto') + 1]) : -21.271;
    /* 2,945 e non 3: è l'alzata vera del modulo montato, (34 − 25) × 0,32725. */
    var z = a.indexOf('--alzata') > 0 ? parseFloat(a[a.indexOf('--alzata') + 1]) : 2.945;
    /* Assoluta: il fine corsa alto è lo zero macchina. */
    var tp = a.indexOf('--tappo') > 0 ? parseFloat(a[a.indexOf('--tappo') + 1]) : 0;
    fs.writeFileSync(g, gcode({ contatto: c, alzata: z, tappo: tp })); console.log('scritto ' + g);
  }
  var st = statistiche();
  console.log('tratti ' + st.tratti + ', punti ' + st.punti + ', disegno ' +
              Math.round(st.disegno) + ' mm, spostamenti ' + Math.round(st.spostamento) + ' mm');
}
