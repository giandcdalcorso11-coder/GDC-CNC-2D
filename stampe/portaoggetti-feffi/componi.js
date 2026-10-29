/* Il biglietto per Feffi: A5 orizzontale, due penne.
 * Nero (#111) e grigio (#8a8a8a): lo SLICER fa un livello per colore di tratto.
 *   node componi.js <viste.json> <stile> > biglietto-<stile>.svg
 * stili: isoipse | tratteggio | tecnico
 */
var fs = require('fs');
var path = require('path');
var FT = require('../../webui/js/font-tratto.js');

var W = 210, H = 148;
var NERO = '#111', GRIGIO = '#8a8a8a';

function fig(tr, cx, y, alt) {          // tr: polilinee normalizzate
  return tr;
}
function mappa(pl, x0, y0, alt) {
  return pl.map(function (p) { return p.map(function (q) { return { x: x0 + q[0] * alt, y: y0 + q[1] * alt }; }); });
}
function scritta(s, cx, base, alt) {
  var l = FT.larghezza(s, alt);
  return FT.testo(s, cx - l / 2, 0, alt).map(function (p) {
    return p.map(function (q) { return { x: q.x, y: base - q.y }; });
  });
}
function poli(pl) {
  return pl.map(function (p) {
    return '<polyline points="' + p.map(function (q) { return q.x.toFixed(2) + ',' + q.y.toFixed(2); }).join(' ') + '"/>';
  }).join('\n');
}
function logo(x, y, larg) {
  var src = fs.readFileSync(path.join(__dirname, '..', '..', 'gdc master.svg'), 'utf8');
  var vb = /viewBox="([-\d.\s]+)"/.exec(src)[1].trim().split(/\s+/).map(Number);
  var corpo = /<g fill="currentColor">([\s\S]*?)<\/g>/.exec(src)[1].trim();
  var k = larg / vb[2];
  return '<g transform="translate(' + x + ',' + y + ') scale(' + k.toFixed(6) + ') translate(' + (-vb[0]) + ',' + (-vb[1]) + ')" stroke-width="' + (0.3 / k).toFixed(3) + '">' + corpo + '</g>';
}
function gruppo(col, sw, corpo) {
  return '<g fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">\n' + corpo + '\n</g>';
}

var dati = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var stile = process.argv[3];
var neri = [], grigi = [], extra = '';

if (stile === 'isoipse') {
  var v = dati.tre_quarti, alt = 100, larg = alt * v.rapporto, x0 = 105 - larg / 2, y0 = 8;
  grigi.push(mappa(v.isoipse, x0, y0, alt));
  neri.push(mappa(v.sagoma, x0, y0, alt));
  neri.push(scritta('KIRA', 105, 124, 9));
  grigi.push(scritta('PER FEFFI', 105, 135, 4.2));
} else if (stile === 'tratteggio') {
  var v = dati.tre_quarti, alt = 100, larg = alt * v.rapporto, x0 = 105 - larg / 2, y0 = 8;
  grigi.push(mappa(v.chiaro, x0, y0, alt));
  neri.push(mappa(v.scuro, x0, y0, alt));
  neri.push(mappa(v.sagoma, x0, y0, alt));
  neri.push(scritta('KIRA', 105, 124, 9));
  grigi.push(scritta('PER FEFFI', 105, 135, 4.2));
} else {
  var a = dati.alto, f = dati.fianco;
  var la = 118, aa = la / a.rapporto, xa = 105 - la / 2, ya = 12;
  var lf = 118, af = lf / f.rapporto, xf = 105 - lf / 2, yf = ya + aa + 14;
  neri.push(mappa(a.sagoma, xa, ya, aa)); grigi.push(mappa(a.isoipse, xa, ya, aa));
  neri.push(mappa(f.sagoma, xf, yf, af));
  neri.push(scritta('KIRA', 105, 135, 7));
  grigi.push(scritta('PER FEFFI', 105, 143, 3.5));
}

var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H + 'mm" viewBox="0 0 ' + W + ' ' + H + '">'];
out.push(gruppo(GRIGIO, 0.3, poli([].concat.apply([], grigi))));
out.push(gruppo(NERO, 0.35, poli([].concat.apply([], neri))));
out.push('</svg>');
process.stdout.write(out.join('\n') + '\n');
