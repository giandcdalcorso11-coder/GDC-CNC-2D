/* Lettura dell'attributo `d` di un <path>, con le curve tenute come curve.
 *
 * PERCHÉ NON BASTA IL BROWSER. Per disegnare, l'importatore campiona i
 * tracciati con getPointAtLength e ottiene polilinee: esatte, comode e
 * definitive. Definitive è il problema: una polilinea non ha più maniglie da
 * afferrare, e un editor che voglia far curvare un tratto non ha niente su
 * cui lavorare. Qui il `d` si legge per davvero, e ne esce la stessa curva
 * che c'era nel file.
 *
 * COME SONO FATTI I NODI. Ogni nodo porta il suo punto e le due maniglie —
 * `hi` quella che guarda indietro, `ho` quella che guarda avanti — in
 * coordinate assolute, `null` quando il tratto da quella parte è dritto. È la
 * forma con cui ragiona chi edita, non quella con cui è scritto il file: in
 * un `d` le maniglie appartengono al comando, qui appartengono al nodo, ed è
 * la stessa differenza che c'è fra leggere e modificare.
 *
 * Tutto diventa cubica. Le quadratiche hanno una conversione esatta, gli
 * archi una in pezzi da novanta gradi con errore trascurabile: tenere tre
 * tipi di curva vorrebbe dire scrivere tre volte ogni cosa che le tocca.
 */
var SvgPath = (function () {

  /* Numeri e comandi, presi uno alla volta. La virgola e gli spazi sono
     equivalenti e possono mancare del tutto: «M0 0L10 10» è legale. */
  var TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;

  function tokens(d) {
    var out = [], m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(d)) !== null) {
      out.push(m[1] ? m[1] : parseFloat(m[2]));
    }
    return out;
  }

  function nodo(x, y) { return { x: x, y: y, hi: null, ho: null }; }

  var ARGOMENTI = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

  function numeri(t, i, quanti) {
    if (i + quanti > t.length) return false;
    for (var k = 0; k < quanti; k++) {
      if (typeof t[i + k] !== 'number' || !isFinite(t[i + k])) return false;
    }
    return true;
  }

  /* ----------------------------- conversioni ----------------------------- */

  /* Una quadratica è una cubica con le due maniglie a due terzi di strada
     verso il punto di controllo. Non è un'approssimazione: le due curve sono
     la stessa curva. */
  function daQuadratica(p0, q, p1) {
    return {
      c1: { x: p0.x + 2 / 3 * (q.x - p0.x), y: p0.y + 2 / 3 * (q.y - p0.y) },
      c2: { x: p1.x + 2 / 3 * (q.x - p1.x), y: p1.y + 2 / 3 * (q.y - p1.y) }
    };
  }

  /* Un arco ellittico in cubiche. Si passa dalla forma «estremi» del file
     alla forma «centro», che è quella con cui si ragiona, e poi si taglia in
     pezzi da non più di novanta gradi: su un quarto di cerchio la cubica
     sbaglia di circa due decimi di millesimo del raggio, cioè niente. */
  function daArco(p0, rx, ry, rot, grande, verso, p1) {
    if (!rx || !ry) return [{ c1: p0, c2: p1, p: p1 }];     // raggio nullo: è un segmento

    rx = Math.abs(rx); ry = Math.abs(ry);
    var fi = rot * Math.PI / 180, cs = Math.cos(fi), sn = Math.sin(fi);

    var dx2 = (p0.x - p1.x) / 2, dy2 = (p0.y - p1.y) / 2;
    var x1 = cs * dx2 + sn * dy2;
    var y1 = -sn * dx2 + cs * dy2;

    /* Raggi troppo piccoli per unire i due estremi: la specifica dice di
       gonfiarli quanto basta, invece di rifiutare il disegno. */
    var lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { var k = Math.sqrt(lam); rx *= k; ry *= k; }

    var num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    var den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    var co = Math.sqrt(Math.max(0, num / den)) * (grande === verso ? -1 : 1);

    var cx1 = co * rx * y1 / ry;
    var cy1 = -co * ry * x1 / rx;
    var cx = cs * cx1 - sn * cy1 + (p0.x + p1.x) / 2;
    var cy = sn * cx1 + cs * cy1 + (p0.y + p1.y) / 2;

    var t1 = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
    var t2 = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx);
    var dt = t2 - t1;
    if (!verso && dt > 0) dt -= 2 * Math.PI;
    if (verso && dt < 0) dt += 2 * Math.PI;

    var pezzi = Math.ceil(Math.abs(dt) / (Math.PI / 2));
    var passo = dt / pezzi;
    /* Il fattore che fa combaciare una cubica con un arco di ampiezza
       `passo`: viene dall'imporre che tangenti e punto di mezzo coincidano. */
    var a4 = 4 / 3 * Math.tan(passo / 4);

    function punto(t) {
      var x = rx * Math.cos(t), y = ry * Math.sin(t);
      return { x: cs * x - sn * y + cx, y: sn * x + cs * y + cy };
    }
    function derivata(t) {
      var x = -rx * Math.sin(t), y = ry * Math.cos(t);
      return { x: cs * x - sn * y, y: sn * x + cs * y };
    }

    var out = [], t = t1, prec = p0;
    for (var i = 0; i < pezzi; i++) {
      var tn = t + passo;
      var pn = i === pezzi - 1 ? p1 : punto(tn);
      var d1 = derivata(t), d2 = derivata(tn);
      out.push({
        c1: { x: prec.x + a4 * d1.x, y: prec.y + a4 * d1.y },
        c2: { x: pn.x - a4 * d2.x, y: pn.y - a4 * d2.y },
        p: pn
      });
      t = tn;
      prec = pn;
    }
    return out;
  }

  /* ------------------------------- lettura ------------------------------- */

  function parse(d) {
    var t = tokens(String(d || ''));
    var sub = [], cur = null;
    var pos = { x: 0, y: 0 };        // dove siamo
    var inizio = { x: 0, y: 0 };     // dove è cominciato il sotto-tracciato
    var cmd = null, i = 0;
    var ultimaCubica = null, ultimaQuadratica = null;

    function apri(x, y) {
      chiudi(false);
      cur = { nodi: [nodo(x, y)], chiuso: false };
      sub.push(cur);
      inizio = { x: x, y: y };
    }

    function chiudi(flag) {
      if (cur && cur.nodi.length < 2) sub.pop();
      else if (cur && flag) cur.chiuso = true;
      cur = null;
    }

    function ultimo() { return cur.nodi[cur.nodi.length - 1]; }

    function retta(x, y) {
      if (!cur) apri(pos.x, pos.y);
      ultimo().ho = null;
      cur.nodi.push(nodo(x, y));
      pos = { x: x, y: y };
    }

    function cubica(c1, c2, x, y) {
      if (!cur) apri(pos.x, pos.y);
      ultimo().ho = c1;
      var n = nodo(x, y);
      n.hi = c2;
      cur.nodi.push(n);
      pos = { x: x, y: y };
    }

    while (i < t.length) {
      if (typeof t[i] === 'string') { cmd = t[i]; i++; }
      else if (cmd === 'M') cmd = 'L';        // numeri di troppo dopo M = L
      else if (cmd === 'm') cmd = 'l';
      if (cmd === null) break;

      var rel = cmd === cmd.toLowerCase();
      var C = cmd.toUpperCase();
      var bx = rel ? pos.x : 0, by = rel ? pos.y : 0;

      /* QUANTI NUMERI VUOLE OGNI COMANDO, e il rifiuto di inventarli. Senza
         questo controllo un `d` sgangherato — o del testo che per caso
         contiene una lettera di comando, «garbage» ha una «a» dentro —
         produceva nodi con le coordinate a NaN, cioè un tracciato che non si
         vede e non si può correggere. Meglio fermarsi dove si è capito. */
      if (C !== 'Z' && !numeri(t, i, ARGOMENTI[C])) break;

      if (C === 'Z') {
        if (cur) {
          chiudi(true);
          pos = { x: inizio.x, y: inizio.y };
        }
        ultimaCubica = ultimaQuadratica = null;
        continue;
      }

      if (C === 'M') {
        apri(t[i] + bx, t[i + 1] + by);
        pos = { x: t[i] + bx, y: t[i + 1] + by };
        i += 2;
        ultimaCubica = ultimaQuadratica = null;
        continue;
      }

      if (C === 'L') { retta(t[i] + bx, t[i + 1] + by); i += 2; ultimaCubica = ultimaQuadratica = null; continue; }
      if (C === 'H') { retta(t[i] + bx, pos.y); i += 1; ultimaCubica = ultimaQuadratica = null; continue; }
      if (C === 'V') { retta(pos.x, t[i] + by); i += 1; ultimaCubica = ultimaQuadratica = null; continue; }

      if (C === 'C' || C === 'S') {
        var c1, c2, px, py;
        if (C === 'C') {
          c1 = { x: t[i] + bx, y: t[i + 1] + by };
          c2 = { x: t[i + 2] + bx, y: t[i + 3] + by };
          px = t[i + 4] + bx; py = t[i + 5] + by;
          i += 6;
        } else {
          /* La prima maniglia è il riflesso della seconda del comando prima.
             Se prima non c'era una cubica, il riflesso è il punto stesso:
             la curva parte dritta. */
          c1 = ultimaCubica
            ? { x: 2 * pos.x - ultimaCubica.x, y: 2 * pos.y - ultimaCubica.y }
            : { x: pos.x, y: pos.y };
          c2 = { x: t[i] + bx, y: t[i + 1] + by };
          px = t[i + 2] + bx; py = t[i + 3] + by;
          i += 4;
        }
        cubica(c1, c2, px, py);
        ultimaCubica = c2;
        ultimaQuadratica = null;
        continue;
      }

      if (C === 'Q' || C === 'T') {
        var q, qx, qy;
        if (C === 'Q') {
          q = { x: t[i] + bx, y: t[i + 1] + by };
          qx = t[i + 2] + bx; qy = t[i + 3] + by;
          i += 4;
        } else {
          q = ultimaQuadratica
            ? { x: 2 * pos.x - ultimaQuadratica.x, y: 2 * pos.y - ultimaQuadratica.y }
            : { x: pos.x, y: pos.y };
          qx = t[i] + bx; qy = t[i + 1] + by;
          i += 2;
        }
        var p0 = { x: pos.x, y: pos.y }, p1 = { x: qx, y: qy };
        var cc = daQuadratica(p0, q, p1);
        cubica(cc.c1, cc.c2, qx, qy);
        ultimaQuadratica = q;
        ultimaCubica = cc.c2;
        continue;
      }

      if (C === 'A') {
        var rx = t[i], ry = t[i + 1], rot = t[i + 2];
        var grande = !!t[i + 3], verso = !!t[i + 4];
        var ax = t[i + 5] + bx, ay = t[i + 6] + by;
        i += 7;
        var pezzi = daArco({ x: pos.x, y: pos.y }, rx, ry, rot, grande, verso, { x: ax, y: ay });
        pezzi.forEach(function (z) { cubica(z.c1, z.c2, z.p.x, z.p.y); });
        ultimaCubica = ultimaQuadratica = null;
        continue;
      }

      break;      // comando che non conosciamo: meglio fermarsi che inventare
    }

    chiudi(false);
    return sub;
  }

  return { parse: parse, daQuadratica: daQuadratica, daArco: daArco };
})();

if (typeof module !== 'undefined') module.exports = SvgPath;
