/* IL LOGO DELLA MACCHINA, costruito sull'alfabeto del logo GDC Stuff.
 *
 * Non è disegnato a mano: è COSTRUITO, e ogni numero viene da una misura
 * fatta sul logo esistente (`gdc master.svg`) o dal font che quel logo
 * dichiara, Jost. I contorni delle lettere sono quelli veri del font, letti
 * dal TTF, non un'approssimazione ridisegnata.
 *
 * CHE COSA SI E' MISURATO SUL LOGO GDC, e che cosa se ne ricava.
 * Le tre lettere non hanno la stessa asta: la G sta a 0,257 dell'altezza
 * maiuscola, la C a 0,181. Non sono un alfabeto coerente, sono tre segni
 * disegnati uno per uno. Quello che li tiene insieme non è il peso: sono tre
 * MODI DI INTERROMPERE la forma, e quelli si possono portare altrove.
 *
 *   1. LA C E' SPEZZATA. Fra l'arco di sopra e quello di sotto c'è un vuoto
 *      di 64,8 unità su 196,6 di altezza — un terzo della lettera — e si
 *      legge «C» lo stesso. È chiusura: l'occhio completa un contorno che
 *      non c'è.
 *   2. LA D E' PIENA. Nessun occhiello: un mezzo disco. E' figura-sfondo
 *      portata all'estremo, la lettera ridotta alla sua ombra.
 *   3. LA D E' PIU' BASSA, 0,751 dell'altezza maiuscola, centrata in
 *      verticale. Rompe la linea delle maiuscole apposta.
 *
 * Il mark nuovo usa gli stessi tre modi sulle lettere di CNC 2D.
 */
var fs = require('fs');
var path = require('path');

var GLIFI = JSON.parse(fs.readFileSync(path.join(__dirname, 'jost-glifi.json'), 'utf8'));

/* --------------------------- le misure del logo GDC --------------------------- */

/* Tutte in frazione dell'altezza maiuscola, misurate su `gdc master.svg`
   leggendo i tracciati, non a occhio (vedi il commento in testa). */
var GDC = {
  vuotoC: 64.8 / 196.6,      // il salto fra i due archi della C
  bassaD: 147.6 / 196.6,     // quanto è alta la D rispetto alle maiuscole
  filetto: 7.14 / 196.6,     // lo spessore dei due filetti ai lati di STUFF
  astaG: 50.6 / 196.6,
  astaC: 35.4 / 196.6
};

var UPEM = 1000, CAP = 700;  // dal TTF di Jost: unità per em e altezza maiuscola

/* ------------------------------- i glifi ------------------------------- */

/* Dal sistema del font (y in su, origine sulla linea di base) a quello del
   disegno (y in giù, origine in alto a sinistra del riquadro maiuscolo),
   con l'altezza maiuscola portata a `h`. */
function posa(ch, x, h) {
  var k = h / CAP;
  return 'translate(' + x + ',' + (h) + ') scale(' + k + ',' + (-k) + ')';
}

function larghezza(ch, h) { return GLIFI[ch].adv * h / CAP; }

/* LA D PIENA, come quella del logo GDC: un mezzo ellisse, lato piatto a
   sinistra. Non si ricava dalla D del font togliendole l'occhiello — in Jost
   la D è disegnata come asta PIU' pancia, due contorni che insieme fanno la
   lettera, e non c'è nessun buco da buttare. Si costruisce, e le proporzioni
   sono quelle misurate sul logo: 97 di larghezza su 147,6 di altezza.
   `h` è l'altezza della D, non quella delle maiuscole. */
var D_RAPPORTO = 97 / 147.6;

function dPienaPath(h) {
  var w = h * D_RAPPORTO;
  return 'M0,0 A' + w.toFixed(3) + ',' + (h / 2).toFixed(3) +
         ' 0 1 1 0,' + h.toFixed(3) + ' Z';
}

/* LA C SPEZZATA, come quella del logo: la stessa lettera disegnata due
   volte, una tagliata alla banda di sopra e una a quella di sotto, con in
   mezzo un vuoto grande quanto quello misurato sul GDC. */
function cSpezzata(id, x, h) {
  var vuoto = h * GDC.vuotoC;
  var mezzo = h / 2;
  var w = larghezza('C', h);
  return '<clipPath id="su' + id + '"><rect x="' + (x - 2) + '" y="-2" width="' +
         (w + 4) + '" height="' + (mezzo - vuoto / 2 + 2) + '"/></clipPath>' +
         '<clipPath id="giu' + id + '"><rect x="' + (x - 2) + '" y="' +
         (mezzo + vuoto / 2) + '" width="' + (w + 4) + '" height="' + (mezzo + 2) + '"/></clipPath>' +
         '<g clip-path="url(#su' + id + ')"><path transform="' + posa('C', x, h) +
         '" d="' + GLIFI.C.d + '"/></g>' +
         '<g clip-path="url(#giu' + id + ')"><path transform="' + posa('C', x, h) +
         '" d="' + GLIFI.C.d + '"/></g>';
}

function glifo(ch, x, h) {
  return '<path transform="' + posa(ch, x, h) + '" d="' + GLIFI[ch].d + '"/>';
}

/* La D del logo: piena, e più bassa delle maiuscole, centrata in verticale.
   Rompere la linea delle maiuscole è una scelta del logo GDC, non un
   difetto: è quello che fa leggere la D come un segno e non come una
   lettera qualsiasi. */
function dBassa(x, h) {
  var hb = h * GDC.bassaD;
  var dy = (h - hb) / 2;
  return '<path transform="translate(' + x + ',' + dy + ')" d="' + dPienaPath(hb) + '"/>';
}

function dLarga(h) { return h * GDC.bassaD * D_RAPPORTO; }

/* ------------------------------ le varianti ------------------------------ */

var H = 200;                      // altezza maiuscola di lavoro
var SP = H * 0.045;               // avvicinamento fra lettere: il GDC le tiene strette

function involucro(corpo, w, h, nome) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
         w.toFixed(2) + ' ' + h.toFixed(2) + '" width="' + w.toFixed(0) +
         '" height="' + h.toFixed(0) + '">\n<title>' + nome + '</title>\n' +
         '<g fill="currentColor" color="#497B58">\n' + corpo + '\n</g>\n</svg>\n';
}

/* A — LA RIGA. CNC 2D per esteso, una riga sola, le lettere del font con i
   tre modi del logo GDC addosso: le due C spezzate, la D piena e più bassa.
   E' la versione da usare quando il logo deve essere LETTO: sulla macchina,
   in fondo a un foglio, in una riga di testo. */
function variante_A() {
  var x = 0, g = '';
  g += cSpezzata('a1', x, H);  x += larghezza('C', H) - SP;
  g += glifo('N', x, H);       x += larghezza('N', H) - SP;
  g += cSpezzata('a2', x, H);  x += larghezza('C', H);
  /* Lo stacco fra la parola e il numero è il doppio dell'avvicinamento fra
     le lettere: è quello che fa leggere «CNC» e «2D» come due cose, invece
     che cinque segni in fila. Prossimità. */
  x += H * 0.26;
  g += glifo('2', x, H);       x += larghezza('2', H) + SP * 0.6;
  g += dBassa(x, H);           x += dLarga(H);
  return involucro(g, x, H, 'CNC 2D — la riga');
}

/* B — IL MONOGRAMMA, lo schizzo messo in squadra. Quattro posti per cinque
   segni: il 2 e la N si FONDONO, perché la barra di base del 2 finisce dove
   comincia l'asta sinistra della N e le due si sovrappongono per tutto lo
   spessore dell'asta. Non si legge da sinistra a destra: si riconosce, come
   un monogramma.
   E' la lettura che do io dello schizzo. Se quello che avevi in mente era
   un'altra, si cambia una riga. */
function variante_B() {
  var x = 0, g = '';
  g += cSpezzata('b1', x, H);  x += larghezza('C', H) - SP * 2;

  /* Il 2 a tutta altezza, e la N addosso: si sovrappongono di un'asta. */
  var asta = H * 0.165;                 // l'asta della N in Jost Bold, misurata
  g += glifo('2', x, H);
  x += larghezza('2', H) - asta;
  g += glifo('N', x, H);
  x += larghezza('N', H) - SP * 2;

  g += dBassa(x, H);           x += dLarga(H) - SP * 2;
  g += cSpezzata('b2', x, H);  x += larghezza('C', H);
  return involucro(g, x, H, 'CNC 2D — il monogramma');
}

/* C — LA CHIUSURA. CNC grande, e 2D dentro all'apertura della C finale.
   E' il modo del logo GDC portato fino in fondo: lì il vuoto in mezzo alla C
   è un errore che l'occhio corregge, qui lo stesso vuoto diventa il posto
   dove sta il resto del nome. La lettera si legge lo stesso — chiusura —, e
   il mark ha un dentro e un fuori. */
function variante_C() {
  var x = 0, g = '';
  g += cSpezzata('c1', x, H);  x += larghezza('C', H) - SP;
  g += glifo('N', x, H);       x += larghezza('N', H) - SP;

  var xc = x;
  g += cSpezzata('c2', xc, H);
  /* «2D» dentro al vuoto della C, alto quanto il vuoto meno un filetto per
     parte: il vuoto è l'unità di misura, non un numero scelto. */
  var vuoto = H * GDC.vuotoC;
  var hp = vuoto * 0.98;
  var yp = (H - hp) / 2;
  var xp = xc + larghezza('C', H) * 0.265;
  g += '<g transform="translate(' + xp + ',' + yp + ')">' +
       '<path transform="' + posa('2', 0, hp) + '" d="' + GLIFI['2'].d + '"/>' +
       '<path transform="translate(' + (larghezza('2', hp) + hp * 0.06) + ',0)" d="' +
       dPienaPath(hp) + '"/>' +
       '</g>';
  x += larghezza('C', H);
  return involucro(g, x, H, 'CNC 2D — la chiusura');
}

if (require.main === module) {
  var dove = process.argv[2] || __dirname;
  [['a-riga', variante_A()], ['b-monogramma', variante_B()], ['c-chiusura', variante_C()]]
    .forEach(function (v) {
      var f = path.join(dove, 'cnc2d-' + v[0] + '.svg');
      fs.writeFileSync(f, v[1]);
      console.log(path.basename(f), v[1].length + ' byte');
    });
}
