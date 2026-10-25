/* Il disegno dei due pupazzetti: le figure, i nomi, il logo.
 *
 * Le figure arrivano da `figli-sagome.py`, che proietta i due modelli 3D di
 * fronte e ne tira fuori sagoma e isoipse (vedi la testa di quel file per il
 * perche'). Qui si decide solo dove vanno sul foglio.
 *
 * Tutto esce STROFINATO, cioe' con un bordo e senza riempimenti: una penna
 * non riempie, e l'importatore del SLICER, davanti a un file che contiene
 * almeno un bordo, salta le forme piene come decorazione. Un logo lasciato
 * `fill` sparirebbe dal foglio.
 *
 *   node webui/tools/figli.js <figli.json> > gcode/figli.svg
 */
var fs = require('fs');
var path = require('path');
var FontTratto = require('../js/font-tratto.js');

var W = 240, H = 235;          // il foglio: la stessa misura degli altri file

var FIG_ALT = 146;             // altezza delle figure
var FIG_Y = 9;
var CENTRI = [70, 170];        // dove stanno i due assi verticali

var NOME_ALT = 9;              // altezza delle maiuscole
var NOME_BASE = 171;           // la riga su cui poggiano i nomi

var LOGO_LARG = 72;
var LOGO_Y = 180;

/* La riga sotto al logo si allarga fino a misurare quanto il logo: l'altezza
   delle lettere viene dalla larghezza voluta, non il contrario. Allinearli a
   occhio vorrebbe dire rifare il conto ogni volta che una delle due misure
   cambia. */
var SOTTO = 'GDC CNC 2D';
var SOTTO_BASE = 226.5;

var NOMI = ['RICCARDO', 'FRANCESCO'];

/* ----------------------------------------------------------- le figure */

function figura(dati, cx, y, alt) {
  var larg = alt * dati.rapporto;
  var x0 = cx - larg / 2;
  return dati.tracciati.map(function (p) {
    return p.map(function (q) {
      return { x: x0 + q[0] * alt, y: y + q[1] * alt };
    });
  });
}

/* ------------------------------------------------------------- i nomi */

/* FontTratto ragiona con l'origine in basso a sinistra e la lettera che
   cresce verso l'alto; l'SVG ha la Y che cresce verso il basso. Il
   ribaltamento sta qui e in nessun altro posto. */
function scritta(s, cx, base, alt) {
  var larg = FontTratto.larghezza(s, alt);
  return FontTratto.testo(s, cx - larg / 2, 0, alt).map(function (p) {
    return p.map(function (q) { return { x: q.x, y: base - q.y }; });
  });
}

/* L'altezza delle maiuscole che fa venire una scritta larga esattamente
   `larg`. È l'inversa di FontTratto.larghezza(), scritta qui perché serve a
   una cosa sola: appaiare una riga di testo a un blocco già dimensionato. */
function altezzaPerLarghezza(s, larg) {
  return larg / (s.length * 4.4 - 1.4) * 5;
}

/* ------------------------------------------------------------- il logo */

/* Il logo arriva dal file originale: si prendono i tracciati com'e' e si
   mettono dentro un gruppo che li porta in scala e in posizione. Ricopiarne
   le coordinate a mano vorrebbe dire avere due logo che un giorno non
   saranno piu' lo stesso. */
function logo() {
  var src = fs.readFileSync(path.join(__dirname, '..', '..', 'gdc master.svg'), 'utf8');
  var vb = /viewBox="([-\d.\s]+)"/.exec(src)[1].trim().split(/\s+/).map(Number);
  var corpo = /<g fill="currentColor">([\s\S]*?)<\/g>/.exec(src)[1];
  var k = LOGO_LARG / vb[2];
  var x = (W - LOGO_LARG) / 2;
  return { k: k, x: x, vb: vb, corpo: corpo.trim(),
           alt: vb[3] * k };
}

/* ------------------------------------------------------------- stampa */

function poli(polilinee) {
  return polilinee.map(function (p) {
    return '<polyline points="' + p.map(function (q) {
      return q.x.toFixed(2) + ',' + q.y.toFixed(2);
    }).join(' ') + '"/>';
  }).join('\n');
}

function lunghezza(polilinee) {
  var t = 0;
  polilinee.forEach(function (p) {
    for (var i = 1; i < p.length; i++) {
      t += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    }
  });
  return t;
}

var dati = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var L = logo();

var pezzi = [];
pezzi.push(figura(dati.uno, CENTRI[0], FIG_Y, FIG_ALT));
pezzi.push(figura(dati.due, CENTRI[1], FIG_Y, FIG_ALT));
pezzi.push(scritta(NOMI[0], CENTRI[0], NOME_BASE, NOME_ALT));
pezzi.push(scritta(NOMI[1], CENTRI[1], NOME_BASE, NOME_ALT));
pezzi.push(scritta(SOTTO, W / 2, SOTTO_BASE, altezzaPerLarghezza(SOTTO, LOGO_LARG)));

var tutte = [].concat.apply([], pezzi);
var n = tutte.length, punti = tutte.reduce(function (a, p) { return a + p.length; }, 0);

var fuori = [];
fuori.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H +
           'mm" viewBox="0 0 ' + W + ' ' + H + '">');
fuori.push('<g fill="none" stroke="#111" stroke-width="0.35" ' +
           'stroke-linecap="round" stroke-linejoin="round">');
fuori.push(poli(tutte));
fuori.push('<g transform="translate(' + L.x.toFixed(3) + ',' + LOGO_Y +
           ') scale(' + L.k.toFixed(6) + ') translate(' +
           (-L.vb[0]) + ',' + (-L.vb[1]) + ')" stroke-width="' +
           (0.35 / L.k).toFixed(3) + '">');
fuori.push(L.corpo);
fuori.push('</g>');
fuori.push('</g>');
fuori.push('</svg>');

process.stdout.write(fuori.join('\n') + '\n');

console.error('figure e nomi: ' + n + ' tracciati, ' + punti + ' punti, ' +
              Math.round(lunghezza(tutte)) + ' mm di linea');
console.error('logo: largo ' + LOGO_LARG + ' alto ' + L.alt.toFixed(1) +
              ', da ' + LOGO_Y + ' a ' + (LOGO_Y + L.alt).toFixed(1));
console.error('riga sotto: «' + SOTTO + '» alta ' +
              altezzaPerLarghezza(SOTTO, LOGO_LARG).toFixed(2) +
              ', larga ' + FontTratto.larghezza(SOTTO,
                altezzaPerLarghezza(SOTTO, LOGO_LARG)).toFixed(2));
