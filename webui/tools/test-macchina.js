/* Il disegno di collaudo della macchina.
 *
 * Una stampa sola che riempie quasi tutta l'area e da cui si tirano fuori otto
 * numeri diversi. Non è un disegno decorativo: ogni elemento esiste perché
 * misura qualcosa, e perché quel qualcosa si legge con calibro, riga e occhio.
 *
 * Ogni tratto porta la sua QUOTA DI PENNA (`z`, in millimetri sopra il
 * contatto): quasi tutto sta a zero, ma la prova di livellamento disegna a
 * quote crescenti, ed è così che un pezzo di piano più basso si manifesta —
 * i trattini alti non segnano.
 *
 * Uso:  node test-macchina.js --svg prova.svg
 *       node test-macchina.js --gcode prova.gcode --contatto 0 --alzata 2.95
 *
 * Il G-code vero si genera DOPO aver montato il modulo penna, quando la quota
 * di contatto e l'alzata sono numeri misurati e non ipotesi.
 */
var FontTratto = require('./font-tratto.js');

/* ------------------------------ parametri ------------------------------- */

var P = {
  larghezza: 246,      // campo disegnabile, mm (area utile meno un margine)
  altezza: 233,
  gradino: 0.30,       // salto di quota fra un trattino e il successivo: una
                       // banda morta del servo, il più fine che sappia fare
  passoRighello: 10,
  lunghRighello: 200
};

var tratti = [];       // { z: mm sopra il contatto, punti: [{x,y}, ...] }

function linea(x1, y1, x2, y2, z) {
  tratti.push({ z: z || 0, punti: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
}

function poli(punti, z) {
  tratti.push({ z: z || 0, punti: punti });
}

function rett(x, y, w, h, z) {
  poli([{x:x,y:y},{x:x+w,y:y},{x:x+w,y:y+h},{x:x,y:y+h},{x:x,y:y}], z);
}

function cerchio(cx, cy, r, z, n) {
  n = n || Math.max(48, Math.round(r * 6));
  var p = [];
  for (var i = 0; i <= n; i++) {
    var a = i / n * Math.PI * 2;
    p.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  poli(p, z);
}

function croce(x, y, b, z) {
  linea(x - b, y, x + b, y, z);
  linea(x, y - b, x, y + b, z);
}

function scritta(s, x, y, alt, z) {
  FontTratto.testo(s, x, y, alt).forEach(function (p) { poli(p, z); });
}

/* ------------------------------ le zone ---------------------------------
   Il campo è diviso in fasce che non si toccano, altrimenti due prove si
   disegnano addosso e non se ne legge nessuna delle due:

     x 0..17    righello Y            y 0..13    righello X
     x 19..176  quadrato grande       y 14..20   fascia livello, in basso
     x 176      retta verticale       y 22..176  blocco centrale
     x 180..245 cerchi e caratteri    y 180..222 fascia delle prove di moto
                                      y 224..232 fascia livello, in alto

   I nove punti del livellamento stanno nelle fasce libere e, per la fila di
   mezzo, dentro il quadrato, dove non c'è niente da incrociare. */

/* ---------------------------- 1. la cornice ------------------------------
   Il giro completo del campo utile. Serve a due cose: dice se tutta l'area è
   davvero raggiungibile, e lo spessore del tratto lungo i quattro lati è la
   prima occhiata al livellamento — un lato più marcato è un lato più alto. */
function cornice() {
  rett(1, 1, P.larghezza - 2, P.altezza - 2, 0);
}

/* --------------------------- 2. i due righelli ---------------------------
   La SCALA, un asse per volta: è la misura che serve per tarare i mm per giro
   ingranaggio. Si appoggia una riga d'acciaio sopra e si legge l'errore
   accumulato a 200 mm, che è molto più preciso che misurare 10 mm col calibro.
   Le tacche ogni 10 mm dicono anche se l'errore è uniforme o a scatti: uno
   scatto è gioco o passi persi, una deriva è il rapporto sbagliato. */
function righelli() {
  var x0 = 22, y0 = 4, d;
  linea(x0, y0, x0 + P.lunghRighello, y0, 0);
  for (d = 0; d <= P.lunghRighello; d += P.passoRighello) {
    linea(x0 + d, y0, x0 + d, y0 + (d % 50 === 0 ? 4.5 : 2.2), 0);
    if (d % 50 === 0) scritta(String(d), x0 + d + 1.2, y0 + 5, 3.2, 0);
  }
  scritta('SCALA X', 226, y0, 2.8, 0);

  var x1 = 4, y1 = 22;
  linea(x1, y1, x1, y1 + P.lunghRighello, 0);
  for (d = 0; d <= P.lunghRighello; d += P.passoRighello) {
    linea(x1, y1 + d, x1 + (d % 50 === 0 ? 4.5 : 2.2), y1 + d, 0);
    if (d % 50 === 0) scritta(String(d), x1 + 5.5, y1 + d - 1.6, 3.2, 0);
  }
  scritta('SCALA Y', 2, 226, 2.8, 0);
}

/* ------------------- 3. il quadrato e le sue diagonali -------------------
   L'ORTOGONALITÀ fra i due assi. Mezzo grado di fuori squadra fa 1,3 mm
   sull'angolo di un A5, più di tutti gli altri errori messi insieme, e si
   misura confrontando le due diagonali: la differenza, diviso 1,414 × lato, è
   l'errore in radianti. Le crocette agli angoli danno alla riga due punti
   precisi su cui appoggiarsi: senza, si misura fra due spigoli sfumati. */
function quadrato() {
  var x = 22, y = 24, L = 150;
  rett(x, y, L, L, 0);
  linea(x, y, x + L, y + L, 0);
  linea(x + L, y, x, y + L, 0);
  [[x,y],[x+L,y],[x+L,y+L],[x,y+L]].forEach(function (c) { croce(c[0], c[1], 4, 0); });
  scritta('QUADRATO 150 - MISURA LE DUE DIAGONALI', x, y + L + 2.5, 3.2, 0);
}

/* ---------------------------- 4. i cerchi --------------------------------
   Il controllo che si legge a colpo d'occhio, senza strumenti. Se i mm per
   giro dei due assi non coincidono il cerchio esce ELLITTICO, e il verso
   dell'ellisse dice quale asse è lungo. Se c'è gioco, nei quattro punti in cui
   un asse inverte il moto compare uno scalino. Tre raggi perché un errore di
   scala cresce col raggio e un gioco no: se i tre scalini sono uguali è gioco,
   se crescono è scala. */
function cerchi() {
  var cx = 210, cy = 62;
  [10, 20, 30].forEach(function (r) { cerchio(cx, cy, r, 0); });
  croce(cx, cy, 5, 0);
  scritta('CERCHI 10-20-30', 180, cy + 33, 3.2, 0);
}

/* ---------------- 5. la mappa del livellamento, a gradini ----------------
   L'idea dell'utente, resa quantitativa. In nove punti — quattro angoli,
   quattro lati, centro: il minimo per vedere anche una svergolatura e non solo
   un'inclinazione — si disegnano quattro trattini affiancati, ognuno un
   gradino più in alto del precedente. Si contano quelli che hanno segnato:
   quattro vuol dire piano alto di un millimetro abbondante, uno vuol dire
   piano alla quota giusta, zero vuol dire piano più basso del contatto.
   Il gradino è 0,30 mm perché è la banda morta del servo: più fine di così il
   servo non sa muoversi, e si misurerebbe il rumore. */
function livellamento() {
  [26, 130, 234].forEach(function (x) {
    [14, 120, 224].forEach(function (y) { nodo(x, y); });
  });
  scritta('LIVELLO: CONTA I TRATTINI', 150, 14, 2.8, 0);
}

function nodo(x, y) {
  for (var k = 0; k < 4; k++) {
    linea(x + k * 1.8, y, x + k * 1.8, y + 5, k * P.gradino);
  }
}

/* ---------------------- 6. il doppio pettine del gioco -------------------
   Il GIOCO d'ingranamento, in millimetri. La stessa serie di tacche viene
   disegnata due volte: una percorrendo l'asse in avanti, una tornando
   indietro. Lo scarto orizzontale fra una tacca e la sua gemella È il gioco, e
   si misura col calibro perché le tacche sono lunghe e nette. Se le due file
   si allineano, il gioco sta sotto il decimo. */
function pettine() {
  var x0 = 22, y0 = 198, n = 10, passo = 12, i;
  for (i = 0; i < n; i++) linea(x0 + i * passo, y0, x0 + i * passo, y0 + 6, 0);
  for (i = n - 1; i >= 0; i--) linea(x0 + i * passo, y0 - 10, x0 + i * passo, y0 - 4, 0);
  scritta('GIOCO: ANDATA SOPRA, RITORNO SOTTO', x0, y0 + 7, 3.2, 0);
}

/* ------------------- 7. stacchi di penna e sbavature ---------------------
   La PAUSA del servo e l'alzata. Una fila di trattini separati da spazi: se
   negli spazi resta un segno, la penna non ha fatto in tempo ad alzarsi — o
   l'alzata non basta a scavalcare il fuori-piano. Se ogni trattino comincia
   con un pallino, la penna si appoggia e aspetta: la pausa è troppo lunga. */
function stacchi() {
  var x0 = 22, y0 = 216;
  for (var i = 0; i < 12; i++) linea(x0 + i * 14, y0, x0 + i * 14 + 7, y0, 0);
  scritta('STACCHI: GLI SPAZI DEVONO RESTARE PULITI', x0, y0 + 2.5, 3.2, 0);
}

/* ------------------------- 8. scala dei caratteri ------------------------
   Quanto piccolo si può scrivere. Non è estetica: dice qual è il dettaglio
   minimo che questa macchina, con questa penna, rende ancora leggibile — e
   quindi che risoluzione ha senso chiedere a un disegno. Si scende fino a 2
   mm, che con una punta da 0,4 sono cinque larghezze di tratto: lì sotto non
   è la macchina a non farcela, è il pennarello. */
function caratteri() {
  var x = 188, y = 160;
  [5, 4, 3, 2.5, 2].forEach(function (h) {
    scritta('GDC 0123', x, y, h, 0);
    scritta(String(h).replace('.', ','), 180, y, 2.5, 0);
    y -= h + 4.5;
  });
  scritta('CARATTERI', 180, 168, 3.2, 0);
}

/* --------------------------- 9. rettilineità -----------------------------
   Due righe lunghe, una per asse, lontane dai bordi: si appoggia la riga
   d'acciaio e si guarda controluce. Una linea che s'incurva non è errore di
   scala — è la trave che flette o il portale che imbarda mentre avanza, e i
   due si distinguono perché il primo piega una linea sola e il secondo le
   piega tutte nello stesso verso. */
function rettilineita() {
  linea(22, 182, 242, 182, 0);
  scritta('RETTILINEITA X', 22, 184, 3.2, 0);
  linea(176, 24, 176, 174, 0);
}

/* ------------------------------ assemblaggio ----------------------------- */

/* Riordino col vicino più prossimo, con la libertà di percorrere un tratto da
   entrambi i capi. Non è estetica: così com'escono dal disegno gli spostamenti
   a vuoto superano il tratto disegnato, e sono minuti di macchina spesi a non
   disegnare. Ogni tratto si porta dietro la sua quota, quindi riordinare non
   mescola i livelli. */
function riordina(lista) {
  var pool = lista.slice(), out = [], cur = { x: 0, y: 0 };
  while (pool.length) {
    var best = 0, bestD = Infinity, rovescia = false;
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i].punti;
      var da = Math.hypot(p[0].x - cur.x, p[0].y - cur.y);
      var dz = Math.hypot(p[p.length-1].x - cur.x, p[p.length-1].y - cur.y);
      if (da < bestD) { bestD = da; best = i; rovescia = false; }
      if (dz < bestD) { bestD = dz; best = i; rovescia = true; }
    }
    var t = pool.splice(best, 1)[0];
    if (rovescia) t = { z: t.z, punti: t.punti.slice().reverse() };
    out.push(t);
    cur = t.punti[t.punti.length - 1];
  }
  return out;
}

function costruisci() {
  tratti = [];
  cornice();
  righelli();
  quadrato();
  cerchi();
  pettine();
  stacchi();
  caratteri();
  rettilineita();
  livellamento();
  tratti = riordina(tratti);
  return tratti;
}

/* --------------------------------- uscite -------------------------------- */

function svg() {
  var W = P.larghezza, H = P.altezza;
  var o = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + (W * 3.2) + '" height="' +
           (H * 3.2) + '" viewBox="0 0 ' + W + ' ' + H + '" style="background:#f7f5f0">'];
  o.push('<g transform="translate(0,' + H + ') scale(1,-1)">');
  tratti.forEach(function (t) {
    var d = t.punti.map(function (p, i) {
      return (i ? 'L' : 'M') + p.x.toFixed(3) + ' ' + p.y.toFixed(3);
    }).join(' ');
    /* I trattini del livellamento si colorano per quota: sul foglio vero li
       distingue il fatto che i più alti non segnano. */
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
  var fd = opt.feedDisegno || 1200, fs = opt.feedSpostamento || 3000;
  var pausa = (opt.pausaMs === undefined ? 200 : opt.pausaMs) / 1000;
  var n = function (v) { return (Math.round(v * 1000) / 1000).toFixed(3); };
  var L = [];
  L.push('; GDC CNC 2D - disegno di collaudo');
  L.push('; campo ' + P.larghezza + ' x ' + P.altezza + ' mm, gradino di livello ' + P.gradino + ' mm');
  L.push('; contatto Z' + n(contatto) + ', alzata Z' + n(contatto + alzata));
  L.push('G21'); L.push('G90');
  L.push('G0 Z' + n(contatto + alzata));
  var zPrec = null;
  tratti.forEach(function (t) {
    var p = t.punti;
    L.push('G0 X' + n(p[0].x) + ' Y' + n(p[0].y) + ' F' + fs);
    var z = contatto + t.z;
    L.push('G1 Z' + n(z) + ' F600');
    if (pausa > 0) L.push('G4 P' + pausa.toFixed(3));
    for (var i = 1; i < p.length; i++) {
      L.push('G1 X' + n(p[i].x) + ' Y' + n(p[i].y) + (i === 1 ? ' F' + fd : ''));
    }
    L.push('G0 Z' + n(contatto + alzata));
    if (pausa > 0) L.push('G4 P' + pausa.toFixed(3));
    zPrec = z;
  });
  L.push('G0 X0 Y0 F' + fs);
  L.push('M2');
  return L.join('\n') + '\n';
}

function statistiche() {
  var d = 0, s = 0, cur = { x: 0, y: 0 }, pt = 0;
  tratti.forEach(function (t) {
    var p = t.punti;
    s += Math.hypot(p[0].x - cur.x, p[0].y - cur.y);
    for (var i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i-1].x, p[i].y - p[i-1].y);
    cur = p[p.length - 1];
    pt += p.length;
  });
  return { tratti: tratti.length, punti: pt, disegno: d, spostamento: s };
}

module.exports = { P: P, costruisci: costruisci, svg: svg, gcode: gcode, statistiche: statistiche };

if (require.main === module) {
  var fs = require('fs');
  costruisci();
  var a = process.argv;
  var out = a[a.indexOf('--svg') + 1];
  if (a.indexOf('--svg') > 0) { fs.writeFileSync(out, svg()); console.log('scritto ' + out); }
  if (a.indexOf('--gcode') > 0) {
    var g = a[a.indexOf('--gcode') + 1];
    var c = a.indexOf('--contatto') > 0 ? parseFloat(a[a.indexOf('--contatto') + 1]) : 0;
    var z = a.indexOf('--alzata') > 0 ? parseFloat(a[a.indexOf('--alzata') + 1]) : 3;
    fs.writeFileSync(g, gcode({ contatto: c, alzata: z }));
    console.log('scritto ' + g);
  }
  var st = statistiche();
  console.log('tratti ' + st.tratti + ', punti ' + st.punti +
              ', disegno ' + Math.round(st.disegno) + ' mm, spostamenti ' +
              Math.round(st.spostamento) + ' mm');
}
