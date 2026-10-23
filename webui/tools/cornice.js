/* La cornice dell'area utile: il giro completo di quello che la macchina può
 * raggiungere, più le due diagonali.
 *
 * Serve a due cose che nessun disegno piccolo può fare.
 *   1. VEDERE L'AREA. Il rettangolo disegnato È il campo di lavoro: quanto ci
 *      sta davvero, e dove cade rispetto al piano e al foglio.
 *   2. CONTROLLARE IL PIANO AI BORDI. Il fuori-piano si manifesta come tratto
 *      interrotto (vedi misure/disegno-di-collaudo.md, prova 11), e i bordi
 *      sono dove il piano è più libero di muoversi.
 * Le diagonali, uguali fra loro su un rettangolo vero, danno in più la squadra
 * sulla campata MASSIMA, che è la condizione più severa possibile.
 *
 * Il file contiene anche la procedura della penna, fermandosi con M0 dove
 * servono le mani. FluidNC mappa M0 su ProgramFlow::Paused: sincronizza il
 * buffer e manda un feed hold, e si riparte col comando di cycle start, cioè
 * `~`. L'ORIGINE no: `$MD` e `G92` restano da digitare, perché in un file
 * vorrebbero dire che un avvio per sbaglio libera i motori e rizzera dove
 * capita.
 *
 * Senza argomenti disegna la cornice piena dell'area utile. Con --da,
 * --larghezza e --altezza disegna un rettangolo qualsiasi dentro quell'area:
 * la parola `max` chiede il massimo raggiungibile da dove si parte.
 *
 * Uso:  node cornice.js --gcode c.gcode
 *       ... --da 5,5 --larghezza max --altezza 190
 *       ... --margine 0.5 --penna no --giro no --diagonali no
 */
var path = require('path');

function costruisci(P) {
  var x0 = P.x0, y0 = P.y0, x1 = P.x1, y1 = P.y1;
  return {
    cornice: [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1},{x:x0,y:y0}],
    diagonali: [[{x:x0,y:y0},{x:x1,y:y1}], [{x:x1,y:y0},{x:x0,y:y1}]],
    centro: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    larghezza: x1 - x0, altezza: y1 - y0,
    diagonale: Math.hypot(x1 - x0, y1 - y0)
  };
}

module.exports = { costruisci: costruisci };

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
  var area = Profile.areaUtile(), home = Profile.puntoHome();
  var m = parseFloat(arg('margine', 0.5));

  /* I lati si arrotondano per DIFETTO al millimetro: 250 × 235 si misura con
     una riga d'acciaio senza interpretare i decimali, e quello che si perde
     (sette decimi in X, cinque in Y) sta sopra e oltre i 2 mm di margine di
     sicurezza già tolti dalla corsa percorribile. */
  /* Il bordo utile: oltre non si va. È lo stesso per tutti i rettangoli, da
     qualunque punto partano. */
  var limite = { x: m + Math.floor(area.w - 2 * m), y: m + Math.floor(area.h - 2 * m) };

  var da = (arg('da') || (m + ',' + m)).split(',').map(parseFloat);
  var lato = function (nome, x0, lim) {
    var v = arg(nome);
    if (v === undefined || v === 'max') return lim - x0;
    return parseFloat(v);
  };
  var P = { x0: da[0], y0: da[1] };
  P.x1 = P.x0 + lato('larghezza', P.x0, limite.x);
  P.y1 = P.y0 + lato('altezza', P.y0, limite.y);

  var r = costruisci(P);
  if (P.x0 < 0 || P.y0 < 0 || P.x1 > area.w || P.y1 > area.h) {
    throw new Error('il rettangolo esce dall\'area utile: X ' + P.x0 + '..' + P.x1 +
                    '  Y ' + P.y0 + '..' + P.y1 + '  area ' +
                    area.w.toFixed(3) + ' x ' + area.h.toFixed(3));
  }

  var giu = Profile.zContatto(), su = Profile.zAlzata(), tappo = Profile.zTappo();
  var st = Profile.stampa();
  var n3 = function (v) { return (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, ''); };
  var f2 = function (v) { return v.toFixed(2); };

  /* Che foglio serve: si confronta l'ingombro coi formati, in entrambi i
     versi, invece di darlo per scontato. */
  var formati = [['A4', 210, 297], ['A3', 297, 420], ['A2', 420, 594]];
  var ciSta = function (f) {
    return (r.larghezza <= f[1] && r.altezza <= f[2]) ||
           (r.larghezza <= f[2] && r.altezza <= f[1]);
  };
  var buono = formati.filter(ciSta)[0];
  var orizzontale = buono && r.larghezza > buono[1];

  var pieno = P.x1 >= limite.x && P.y1 >= limite.y && P.x0 <= m && P.y0 <= m;
  var L = [];
  L.push('; GDC CNC 2D - ' + (pieno ? 'cornice dell area utile' : 'rettangolo') +
         ' ' + r.larghezza + ' x ' + r.altezza + ' mm');
  L.push(';');
  L.push('; Da X' + P.x0 + ' Y' + P.y0 + ' a X' + P.x1 + ' Y' + P.y1 +
         ', contati dal punto ai blocchi.');
  L.push('; Oltre il tratto restano ' + (area.w - P.x1).toFixed(2) + ' mm in X e ' +
         (area.h - P.y1).toFixed(2) + ' in Y, piu i ' +
         Profile.macchina().corse.x.margineSicurezza + ' mm di margine di');
  L.push('; sicurezza gia tolti dalla corsa percorribile. Area utile ' +
         area.w.toFixed(3) + ' x ' + area.h.toFixed(3) + '.');
  L.push(';');
  L.push('; IL FOGLIO: servono ' + r.larghezza + ' x ' + r.altezza + ' mm, quindi ' +
         (buono ? 'un ' + buono[0] + (orizzontale ? ' ORIZZONTALE' : ' verticale') + ' basta.'
                : 'nessun formato standard fino all A2 basta.'));
  L.push(';');
  var conDiagonali = arg('diagonali') !== 'no';
  L.push('; MISURE ATTESE:');
  L.push(';   lati          ' + r.larghezza + ' e ' + r.altezza + ' mm');
  if (conDiagonali) {
    L.push(';   diagonali     ' + f2(r.diagonale) + ' mm TUTTE E DUE.');
    L.push(';                 Differenti = assi fuori squadra, e la leva lunga');
    L.push(';                 rende la misura piu severa di qualunque altra.');
  } else {
    L.push(';   la CHIUSURA   l ultimo tratto deve tornare esattamente dove e');
    L.push(';                 partito. Uno scalino visibile all angolo e gioco.');
  }
  L.push(';');
  L.push('; TRATTO INTERROTTO = il piano o il portale si alzano li. La penna non');
  L.push('; ha molla, quindi il fuori-piano non si assorbe. Vedi');
  L.push('; misure/disegno-di-collaudo.md, prova 11.');
  L.push(';');
  L.push('; LE QUOTE Z SONO NEGATIVE. Z0 e la posizione tappo, in cima alla corsa;');
  L.push('; Z' + n3(giu) + ' e la punta sul foglio.');
  L.push(';');
  L.push('; PRIMA DI LANCIARE serve l origine, che NON sta in questo file:');
  L.push(';   $MD  -> appoggia i carrelli ai blocchi -> G92 X0 Y0 -> G90 G0 X5 Y5 F1000');
  L.push(';');
  /* G21/G90 qui servono solo se c'è un preambolo da eseguire prima del
     disegno: Gcode.build li riemette comunque in testa alla sua parte, e
     ripeterli senza niente in mezzo e' solo rumore. */
  if (arg('penna') !== 'no' || arg('giro') !== 'no') {
    L.push('G21');
    L.push('G90');
  }

  if (arg('penna') !== 'no') {
    L.push('');
    L.push('; --- 1. LA PENNA. Si ferma due volte: riparti con ~ (cycle start). ---');
    L.push('G0 Z' + n3(tappo));
    L.push('G0 X' + n3(r.centro.x) + ' Y' + n3(r.centro.y) + ' F1000');
    L.push('G0 Z' + n3(giu));
    L.push('; FERMO: infila la penna finche la punta TOCCA il foglio, senza premere,');
    L.push('; e stringi i morsetti. Poi ~');
    L.push('M0');
    L.push('G0 Z' + n3(su));
    L.push('G0 Z' + n3(giu));
    L.push('G0 Z' + n3(su));
    L.push('; FERMO: al centro del foglio c e un puntino. Deve segnare appena, non');
    L.push('; schiacciare. Se va bene ~, se no Ctrl-X e si ricomincia.');
    L.push('M0');
  }

  if (arg('giro') !== 'no') {
    L.push('');
    L.push('; --- 2. GIRO A VUOTO DEGLI ANGOLI, penna alta e piano. ---');
    L.push('; Si percorre il rettangolo senza inchiostro, a velocita ridotta, per');
    L.push('; vedere dove arriva e che nessun carrello forzi. Se uno tocca il fondo');
    L.push('; o rumoreggia, Ctrl-X prima di consumare il foglio.');
    L.push('G0 Z' + n3(tappo));
    L.push('G0 X' + n3(P.x0) + ' Y' + n3(P.y0) + ' F1000');
    L.push('G0 X' + n3(P.x1));
    L.push('G0 Y' + n3(P.y1));
    L.push('G0 X' + n3(P.x0));
    L.push('G0 Y' + n3(P.y0));
    L.push('; FERMO: nessun carrello ha toccato il fondo? Allora ~');
    L.push('M0');
  }

  L.push('');
  L.push('; --- 3. IL RETTANGOLO' + (conDiagonali ? ' E LE DIAGONALI' : '') + ' ---');
  var disegno = Gcode.build([r.cornice].concat(conDiagonali ? r.diagonali : []), {
    penUp: su, penDown: giu, penTappo: tappo, ritorno: home, pennaTarata: true,
    pausaMs: st.pausaPennaMs, feedDraw: st.velocitaDisegno,
    feedTravel: st.velocitaSpostamento, feedPen: 600
  });
  /* Via l'intestazione di Gcode.build: i commenti li ha gia questo file, e
     ripeterli a meta programma confonde invece di aiutare. */
  L.push(disegno.split('\n').filter(function (riga) { return riga[0] !== ';'; }).join('\n'));

  var out = L.join('\n').replace(/\n+$/, '') + '\n';
  var nome = arg('gcode');
  if (nome) { fs.writeFileSync(nome, out); console.log('scritto ' + nome); }

  var lung = 2 * (r.larghezza + r.altezza) + (conDiagonali ? 2 * r.diagonale : 0);
  console.log('cornice ' + r.larghezza + ' x ' + r.altezza + ', diagonale ' + f2(r.diagonale) +
              ', disegno ' + lung.toFixed(0) + ' mm, ' + out.length + ' byte, ' +
              (L.filter(function (x) { return x === 'M0'; }).length) + ' pause');
}
