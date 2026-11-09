/* Scritte col font a tratto singolo della macchina, per lavoro.py.
 * Legge da stdin un JSON [{s, cx, base, alt}] e scrive le polilinee in mm sul foglio
 * (origine in alto a sinistra, y verso il basso).
 *   cx    centro orizzontale della scritta
 *   base  riga su cui poggiano le maiuscole (distanza dal bordo alto)
 *   alt   altezza delle maiuscole
 */
var FontTratto = require('../webui/js/font-tratto.js');
var chunks = [];
process.stdin.on('data', function (c) { chunks.push(c); });
process.stdin.on('end', function () {
  var testi = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  var out = testi.map(function (t) {
    var larg = FontTratto.larghezza(t.s, t.alt);
    var pl = FontTratto.testo(t.s, t.cx - larg / 2, 0, t.alt).map(function (p) {
      return p.map(function (q) { return [q.x, t.base - q.y]; });
    });
    return { polilinee: pl, larghezza: larg };
  });
  process.stdout.write(JSON.stringify(out));
});
