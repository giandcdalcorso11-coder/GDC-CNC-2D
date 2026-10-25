/* Le forme di un disegno, prima che diventino polilinee.
 *
 * Una FORMA è quello che si modifica: un tracciato con i suoi nodi e le sue
 * maniglie, o un testo con la sua stringa e la sua altezza. Le polilinee
 * sono quello che si DISEGNA, e si ricavano dalla forma ogni volta che
 * servono — all'anteprima, al G-code — senza mai tornare indietro.
 *
 * La direzione è una sola e non è reversibile: da una polilinea non si
 * risale alla curva che l'ha prodotta, né alla parola che ha prodotto le
 * lettere. Per questo la forma va tenuta, e l'appiattimento rifatto: il
 * contrario — appiattire una volta e poi lavorare su quello — è esattamente
 * il motivo per cui oggi un disegno importato non si può curvare.
 *
 * La tolleranza dell'appiattimento è in millimetri del foglio, e sotto il
 * decimo non ha senso spingersi: un passo di motore vale tre centesimi, e la
 * punta di una penna quattro decimi.
 */
var Tracciato = (function () {

  var TOLLERANZA = 0.05;

  /* --------------------------- costruzioni --------------------------- */

  function nodo(x, y, hi, ho) {
    return { x: x, y: y, hi: hi || null, ho: ho || null };
  }

  function tracciato(sub) { return { tipo: 'tracciato', sub: sub }; }

  function daPunti(punti, chiuso) {
    return tracciato([{
      nodi: punti.map(function (p) { return nodo(p.x, p.y); }),
      chiuso: !!chiuso
    }]);
  }

  function linea(x1, y1, x2, y2) {
    return daPunti([{ x: x1, y: y1 }, { x: x2, y: y2 }], false);
  }

  function rettangolo(x, y, w, h) {
    return daPunti([{ x: x, y: y }, { x: x + w, y: y },
                    { x: x + w, y: y + h }, { x: x, y: y + h }], true);
  }

  /* IL CERCHIO CON QUATTRO CUBICHE. Il numero magico 0,5523 è il rapporto fra
     maniglia e raggio che fa passare la cubica per il punto di mezzo del
     quarto di cerchio: l'errore massimo è due decimi di millesimo del raggio,
     cioè due centesimi di millimetro su un cerchio di un metro. */
  var K = 0.5522847498307936;

  function ellisse(cx, cy, rx, ry) {
    var kx = rx * K, ky = ry * K;
    var n = [
      nodo(cx + rx, cy, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
      nodo(cx, cy + ry, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
      nodo(cx - rx, cy, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
      nodo(cx, cy - ry, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry })
    ];
    return tracciato([{ nodi: n, chiuso: true }]);
  }

  function cerchio(cx, cy, r) { return ellisse(cx, cy, r, r); }

  /* Un testo resta un TESTO finché può: cambiare una parola deve restare
     possibile, e da un mucchio di segmenti la parola non si ricava più. */
  function testo(s, x, y, alt) {
    return { tipo: 'testo', testo: String(s), x: x, y: y, alt: alt };
  }

  /* --------------------------- appiattimento --------------------------- */

  /* Una cubica si taglia a metà finché è abbastanza dritta. Il criterio è la
     distanza delle due maniglie dalla corda: finché stanno dentro alla
     tolleranza, la corda è una buona approssimazione della curva, e non
     serve sapere altro. Suddividere un numero fisso di volte sarebbe o
     grossolano sulle curve strette o sprecato su quelle larghe. */
  function cubica(out, p0, c1, c2, p1, tol, giri) {
    if (giri > 16 || dritta(p0, c1, c2, p1, tol)) { out.push({ x: p1.x, y: p1.y }); return; }

    var a = mezzo(p0, c1), b = mezzo(c1, c2), c = mezzo(c2, p1);
    var d = mezzo(a, b), e = mezzo(b, c), f = mezzo(d, e);

    cubica(out, p0, a, d, f, tol, giri + 1);
    cubica(out, f, e, c, p1, tol, giri + 1);
  }

  function mezzo(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function dritta(p0, c1, c2, p1, tol) {
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1e-9) {
      /* Corda nulla: la curva torna dov'è partita, e la distanza dalla corda
         non vuol dire niente. Si guarda quanto si allontanano le maniglie. */
      return dist(p0, c1) <= tol && dist(p0, c2) <= tol;
    }
    var d1 = Math.abs(dy * c1.x - dx * c1.y + p1.x * p0.y - p1.y * p0.x) / L;
    var d2 = Math.abs(dy * c2.x - dx * c2.y + p1.x * p0.y - p1.y * p0.x) / L;
    return d1 <= tol && d2 <= tol;
  }

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  /* Da un sotto-tracciato alla sua polilinea. Un tratto fra due nodi è una
     retta quando nessuna delle due maniglie che lo guardano c'è: basta che ce
     ne sia una perché sia una curva. */
  function appiattisciSub(sub, tol) {
    var n = sub.nodi;
    if (!n.length) return [];
    var out = [{ x: n[0].x, y: n[0].y }];

    var quanti = sub.chiuso ? n.length : n.length - 1;
    for (var i = 0; i < quanti; i++) {
      var a = n[i], b = n[(i + 1) % n.length];
      if (!a.ho && !b.hi) out.push({ x: b.x, y: b.y });
      else {
        cubica(out, a, a.ho || { x: a.x, y: a.y }, b.hi || { x: b.x, y: b.y }, b, tol, 0);
      }
    }
    return out;
  }

  function appiattisci(forma, tol) {
    tol = tol || TOLLERANZA;
    if (!forma) return [];

    if (forma.tipo === 'testo') {
      if (typeof FontTratto === 'undefined') return [];
      /* FontTratto ragiona con l'origine in basso a sinistra e la lettera che
         cresce verso l'alto; qui si resta in quelle coordinate, e chi usa il
         risultato lo ribalta come ribalta tutto il resto. */
      return FontTratto.testo(forma.testo, forma.x, forma.y, forma.alt)
        .map(function (p) { return p.map(function (q) { return { x: q.x, y: q.y }; }); });
    }

    var out = [];
    (forma.sub || []).forEach(function (s) {
      var p = appiattisciSub(s, tol);
      if (p.length > 1) out.push(p);
    });
    return out;
  }

  function appiattisciTutte(forme, tol) {
    var out = [];
    (forme || []).forEach(function (f) {
      appiattisci(f, tol).forEach(function (p) { out.push(p); });
    });
    return out;
  }

  /* ---------------------------- trasformazioni ---------------------------- */

  /* La matrice è quella dell'SVG: {a,b,c,d,e,f}. Si applica ai nodi E alle
     maniglie, che sono punti come gli altri: dimenticarsene vorrebbe dire
     curve che si storcono appena il disegno entra in un gruppo trasformato. */
  function trasforma(forma, m) {
    function p(q) {
      return q ? { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f } : null;
    }
    if (forma.tipo === 'testo') {
      var o = p({ x: forma.x, y: forma.y });
      var scala = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      return testo(forma.testo, o.x, o.y, forma.alt * scala);
    }
    return tracciato(forma.sub.map(function (s) {
      return {
        chiuso: s.chiuso,
        nodi: s.nodi.map(function (n) {
          var q = p(n);
          return nodo(q.x, q.y, p(n.hi), p(n.ho));
        })
      };
    }));
  }

  function bbox(forme, tol) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    appiattisciTutte(forme, tol).forEach(function (poly) {
      poly.forEach(function (q) {
        if (q.x < b.x0) b.x0 = q.x;
        if (q.y < b.y0) b.y0 = q.y;
        if (q.x > b.x1) b.x1 = q.x;
        if (q.y > b.y1) b.y1 = q.y;
      });
    });
    b.w = b.x1 - b.x0;
    b.h = b.y1 - b.y0;
    return b;
  }

  function conta(forme) {
    var n = { forme: 0, nodi: 0, curve: 0, testi: 0 };
    (forme || []).forEach(function (f) {
      n.forme++;
      if (f.tipo === 'testo') { n.testi++; return; }
      (f.sub || []).forEach(function (s) {
        n.nodi += s.nodi.length;
        s.nodi.forEach(function (q) { if (q.hi || q.ho) n.curve++; });
      });
    });
    return n;
  }

  return {
    nodo: nodo, tracciato: tracciato, daPunti: daPunti, linea: linea,
    rettangolo: rettangolo, cerchio: cerchio, ellisse: ellisse, testo: testo,
    appiattisci: appiattisci, appiattisciTutte: appiattisciTutte,
    appiattisciSub: appiattisciSub,
    trasforma: trasforma, bbox: bbox, conta: conta, TOLLERANZA: TOLLERANZA
  };
})();

if (typeof module !== 'undefined') module.exports = Tracciato;
