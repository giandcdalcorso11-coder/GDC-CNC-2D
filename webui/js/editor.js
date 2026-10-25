/* L'editor: la tela su cui si modificano e si creano i tracciati.
 *
 * Lavora sulle FORME del livello scelto — nodi e maniglie, non polilinee —
 * nelle coordinate del file. Le polilinee si rifanno a ogni modifica
 * (Artwork.rigenera), e il disegno sul foglio resta dov'è: spostare un nodo
 * sposta quel nodo, non ridimensiona tutto il resto.
 *
 * LA Y VA IN GIÙ, come in un file SVG e come la mostra un browser. Sul piano
 * della macchina va in su, perché lì è la macchina a comandare, e il
 * ribaltamento lo fa toRect una volta sola. Mostrarla in su anche qui
 * vorrebbe dire far vedere il disegno capovolto rispetto al file che si sta
 * modificando.
 *
 * Non c'è un formato e non ci sono dimensioni: la tela è lo spazio del
 * disegno, e quanto diventa grande lo si decide dopo, con le maniglie sul
 * foglio.
 */
var Editor = (function () {

  var svg, tela, aiuto, piede, titolo;
  var strumento = 'scegli';

  /* Che cosa è selezionato. `forma` è l'indice nelle forme del livello;
     `sub` e `nodo` scendono dentro, e valgono -1 quando la selezione si
     ferma più in alto. */
  var sel = { forma: -1, sub: -1, nodo: -1, maniglia: null };

  var presa = null;        // trascinamento in corso

  /* IL DOPPIO CLIC CE LO CONTIAMO NOI, invece di aspettare l'evento del
     browser. Il browser emette `dblclick` solo se i due clic hanno lo stesso
     bersaglio, e qui la tela si ridisegna a ogni selezione: fra il primo clic
     e il secondo il quadratino sotto al dito è già un altro elemento, e
     l'evento non arrivava mai. Trovato dal collaudo, che misurava il
     risultato invece di guardare il codice. */
  var ultimoGiu = { t: 0, x: 0, y: 0 };
  var forseDoppio = false;
  var DOPPIO_MS = 350, DOPPIO_PX = 6;
  var costruendo = null;   // forma che si sta disegnando
  var vista = null;        // {x0, y0, w, h} nelle coordinate del disegno

  var TOL = 0.05;

  /* --------------------------- il livello --------------------------- */

  function forme() {
    return (window.Artwork && Artwork.forme) ? Artwork.forme() : null;
  }

  function cambiato() {
    Artwork.rigenera();
    disegna();
    scriviPiede();
  }

  /* ----------------------------- la vista ----------------------------- */

  function ingombro() {
    var f = forme();
    var b = f && f.length ? Tracciato.bbox(f, TOL) : null;
    if (!b || !isFinite(b.w) || b.w <= 0 || b.h <= 0) {
      /* Tela vuota: uno spazio di comodo, grande quanto un foglio piccolo.
         Non è un formato — serve solo a dare alla rotella qualcosa da
         ingrandire finché il primo tratto non esiste. */
      return { x0: 0, y0: 0, x1: 200, y1: 200, w: 200, h: 200 };
    }
    return b;
  }

  function adatta() {
    var b = ingombro();
    var m = Math.max(b.w, b.h) * 0.08 + 1;
    vista = { x0: b.x0 - m, y0: b.y0 - m, w: b.w + 2 * m, h: b.h + 2 * m };
    applica();
  }

  function applica() {
    if (!vista) adatta();
    svg.setAttribute('viewBox', vista.x0 + ' ' + vista.y0 + ' ' + vista.w + ' ' + vista.h);
    disegna();
  }

  /* Quanto vale un pixel in unità del disegno: maniglie e nodi si disegnano
     in unità, ma devono restare della stessa taglia sullo schermo. */
  function perPixel() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !vista) return 0.1;
    return Math.max(vista.w / r.width, vista.h / r.height);
  }

  function punto(e) {
    var p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  /* ----------------------------- disegno ----------------------------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function via(poly) {
    return poly.map(function (q) { return q.x.toFixed(3) + ',' + q.y.toFixed(3); }).join(' ');
  }

  function disegna() {
    if (!svg) return;
    var f = forme() || [];
    var u = perPixel();
    var out = '';

    /* I tratti, tutti dello stesso colore: qui non si guarda il risultato, si
       guarda la struttura, e colori diversi direbbero cose che non ci sono. */
    for (var i = 0; i < f.length; i++) {
      var polys = Tracciato.appiattisci(f[i], TOL * u * 10);
      var cls = i === sel.forma ? 'ed-tratto ed-scelto' : 'ed-tratto';
      for (var j = 0; j < polys.length; j++) {
        out += '<polyline class="' + cls + '" points="' + via(polys[j]) + '"></polyline>';
      }
    }

    if (costruendo) {
      Tracciato.appiattisci(costruendo, TOL * u * 10).forEach(function (p) {
        out += '<polyline class="ed-tratto ed-nuovo" points="' + via(p) + '"></polyline>';
      });
    }

    /* I nodi e le maniglie della forma scelta. Si mostrano solo di quella:
       tutti insieme sarebbero un tappeto di quadratini in cui non si trova
       più il disegno. */
    var s = f[sel.forma];
    if (s && s.tipo === 'tracciato') {
      var lato = 7 * u, raggio = 4 * u;
      s.sub.forEach(function (sub, si) {
        sub.nodi.forEach(function (n, ni) {
          var scelto = si === sel.sub && ni === sel.nodo;
          ['hi', 'ho'].forEach(function (quale) {
            if (!n[quale]) return;
            out += '<line class="ed-asta" x1="' + n.x + '" y1="' + n.y +
                   '" x2="' + n[quale].x + '" y2="' + n[quale].y + '"></line>' +
                   '<circle class="ed-maniglia" data-f="' + sel.forma + '" data-s="' + si +
                   '" data-n="' + ni + '" data-m="' + quale + '" cx="' + n[quale].x +
                   '" cy="' + n[quale].y + '" r="' + raggio + '"></circle>';
          });
          out += '<rect class="ed-nodo' + (scelto ? ' ed-nodo-scelto' : '') +
                 '" data-f="' + sel.forma + '" data-s="' + si + '" data-n="' + ni +
                 '" x="' + (n.x - lato / 2) + '" y="' + (n.y - lato / 2) +
                 '" width="' + lato + '" height="' + lato + '"></rect>';
        });
      });
    }

    svg.innerHTML = out;
  }

  /* ------------------------- che cosa c'è sotto ------------------------- */

  /* Il tratto più vicino al punto, se sta entro qualche pixel. Si cerca sulle
     polilinee e non sulle curve: la distanza da una cubica non ha una
     formula chiusa, e la polilinea è già l'approssimazione che guardiamo. */
  function sotto(p, u) {
    var f = forme() || [];
    var limite = 6 * u, meglio = null;

    for (var i = 0; i < f.length; i++) {
      if (f[i].tipo === 'testo') {
        var b = Tracciato.bbox([f[i]], TOL);
        if (p.x >= b.x0 - limite && p.x <= b.x1 + limite &&
            p.y >= b.y0 - limite && p.y <= b.y1 + limite) {
          return { forma: i, d: 0, sub: -1, t: 0 };
        }
        continue;
      }
      for (var si = 0; si < f[i].sub.length; si++) {
        var poly = Tracciato.appiattisciSub(f[i].sub[si], TOL);
        for (var k = 1; k < poly.length; k++) {
          var d = segmento(p, poly[k - 1], poly[k]);
          if (d.d < limite && (!meglio || d.d < meglio.d)) {
            meglio = { forma: i, sub: si, d: d.d, punto: d.punto, k: k, t: d.t };
          }
        }
      }
    }
    return meglio;
  }

  /* Il nodo o la maniglia sotto al puntatore, cercati per POSIZIONE e non
     chiedendo al bersaglio del clic chi è. Il bersaglio sarebbe più comodo,
     ma la tela si ridisegna a ogni selezione: fra il primo e il secondo clic
     di un doppio clic il quadratino sotto il dito è già un altro elemento, e
     il doppio clic cadeva nel vuoto. Trovato dal collaudo. */
  function nodoSotto(p, u) {
    var f = forme();
    var s = f && f[sel.forma];
    if (!s || s.tipo !== 'tracciato') return null;

    var lim = 6 * u, meglio = null;
    s.sub.forEach(function (sub, si) {
      sub.nodi.forEach(function (n, ni) {
        ['hi', 'ho'].forEach(function (q) {
          if (!n[q]) return;
          var dm = Math.hypot(p.x - n[q].x, p.y - n[q].y);
          if (dm < lim && (!meglio || dm < meglio.d)) {
            meglio = { sub: si, nodo: ni, maniglia: q, d: dm };
          }
        });
        /* A parità, vince il NODO sulla maniglia: è quello che si vuole
           prendere quasi sempre, e la maniglia si raggiunge spostandosi. */
        var d = Math.hypot(p.x - n.x, p.y - n.y);
        if (d < lim && (!meglio || d <= meglio.d)) {
          meglio = { sub: si, nodo: ni, maniglia: null, d: d };
        }
      });
    });
    return meglio;
  }

  function segmento(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    var q = { x: a.x + t * dx, y: a.y + t * dy };
    return { d: Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)),
             punto: q, t: t };
  }

  /* --------------------------- gli strumenti --------------------------- */

  function scegliStrumento(s) {
    strumento = s;
    chiudiCostruzione(true);
    Array.prototype.forEach.call(document.querySelectorAll('[data-str]'), function (b) {
      b.classList.toggle('attivo', b.dataset.str === s);
    });
    document.getElementById('ed-testo-campi').hidden = s !== 'testo';
    scriviAiuto();
  }

  var AIUTO = {
    scegli: 'Clicca un tratto per sceglierlo. Trascina i nodi e le maniglie. ' +
            'Doppio clic su un nodo: da spigolo a curva e viceversa. ' +
            'Doppio clic su un tratto: aggiunge un nodo lì. Canc: toglie il nodo, ' +
            'o il tratto intero se non c\'è un nodo scelto.',
    spezzata: 'Clicca per mettere i punti. Doppio clic o Invio per finire, ' +
              'Esc per annullare.',
    rettangolo: 'Trascina da un angolo all\'altro.',
    cerchio: 'Trascina dal centro verso il bordo.',
    testo: 'Scrivi qui sopra, poi clicca sulla tela dove vuoi la riga.',
    taglia: 'Clicca su un tratto: si spezza in due lì, e i due pezzi restano ' +
            'separati come se la penna si fosse alzata.'
  };

  function scriviAiuto() {
    if (aiuto) aiuto.textContent = AIUTO[strumento] || '';
  }

  function scriviPiede() {
    if (!piede) return;
    var f = forme();
    if (!f) { piede.textContent = ''; return; }
    var c = Tracciato.conta(f);
    piede.textContent = c.forme + ' forme · ' + c.nodi + ' nodi · ' +
                        c.curve + ' con una curva' + (c.testi ? ' · ' + c.testi + ' testi' : '');
  }

  function chiudiCostruzione(annulla) {
    if (!costruendo) return;
    if (!annulla && costruendo.sub && costruendo.sub[0].nodi.length > 1) {
      forme().push(costruendo);
      costruendo = null;
      cambiato();
      return;
    }
    costruendo = null;
    disegna();
  }

  /* ------------------------------ eventi ------------------------------ */

  function giu(e) {
    var f = forme();
    if (!f) return;
    var p = punto(e), u = perPixel();

    if (e.button === 0) {
      var ora = Date.now();
      /* Il doppio clic si DECIDE AL RILASCIO, non alla pressione. Deciderlo
         subito farebbe sparire il trascinamento: premere su un nodo appena
         scelto e tirarlo è un gesto normale, e assomiglia come due gocce
         d'acqua all'inizio di un doppio clic. Chi si muove sta trascinando. */
      forseDoppio = ora - ultimoGiu.t < DOPPIO_MS &&
                    Math.abs(e.clientX - ultimoGiu.x) < DOPPIO_PX &&
                    Math.abs(e.clientY - ultimoGiu.y) < DOPPIO_PX;
      ultimoGiu = { t: ora, x: e.clientX, y: e.clientY };
    }

    /* Il tasto centrale sposta sempre lo sguardo, qualunque strumento sia
       attivo: è la via d'uscita quando il disegno riempie la tela. */
    if (e.button === 1) {
      presa = { tipo: 'sguardo', x: e.clientX, y: e.clientY, v: vista };
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (strumento === 'scegli') return giuScegli(e, p, u);
    if (strumento === 'taglia') return taglia(p, u);
    if (strumento === 'spezzata') return giuSpezzata(p);
    if (strumento === 'testo') return metteTesto(p);
    if (strumento === 'rettangolo' || strumento === 'cerchio') {
      presa = { tipo: strumento, inizio: p };
      svg.setPointerCapture(e.pointerId);
    }
  }

  function giuScegli(e, p, u) {
    var h = nodoSotto(p, u);
    if (h) {
      sel.sub = h.sub; sel.nodo = h.nodo; sel.maniglia = h.maniglia;
      presa = { tipo: h.maniglia ? 'maniglia' : 'nodo', da: p };
      svg.setPointerCapture(e.pointerId);
      disegna();
      return;
    }

    var t = sotto(p, u);
    if (!t) { sel.forma = -1; sel.sub = -1; sel.nodo = -1; disegna(); return; }

    sel.forma = t.forma; sel.sub = -1; sel.nodo = -1; sel.maniglia = null;
    presa = { tipo: 'forma', da: p };
    svg.setPointerCapture(e.pointerId);
    disegna();
  }

  function muovi(e) {
    if (!presa) return;
    if (Math.abs(e.clientX - ultimoGiu.x) > 2 || Math.abs(e.clientY - ultimoGiu.y) > 2) {
      presa.mosso = true;
    }
    var p = punto(e);

    if (presa.tipo === 'sguardo') {
      var r = svg.getBoundingClientRect();
      vista = { x0: presa.v.x0 - (e.clientX - presa.x) * presa.v.w / r.width,
                y0: presa.v.y0 - (e.clientY - presa.y) * presa.v.h / r.height,
                w: presa.v.w, h: presa.v.h };
      applica();
      return;
    }

    /* Rettangolo e cerchio si ridisegnano dal punto di PARTENZA, non per
       differenze: la forma dipende da dove si è cominciato, non da quanto ci
       si è mossi dall'ultimo evento. */
    if (presa.tipo === 'rettangolo') {
      costruendo = Tracciato.rettangolo(
        Math.min(presa.inizio.x, p.x), Math.min(presa.inizio.y, p.y),
        Math.abs(p.x - presa.inizio.x), Math.abs(p.y - presa.inizio.y));
      disegna();
      return;
    }
    if (presa.tipo === 'cerchio') {
      costruendo = Tracciato.cerchio(presa.inizio.x, presa.inizio.y,
        Math.hypot(p.x - presa.inizio.x, p.y - presa.inizio.y));
      disegna();
      return;
    }

    var f = forme();
    var dx = p.x - presa.da.x, dy = p.y - presa.da.y;
    presa.da = p;

    if (presa.tipo === 'nodo') {
      var n = f[sel.forma].sub[sel.sub].nodi[sel.nodo];
      /* Spostando il nodo si portano dietro le sue maniglie: sono attaccate
         a lui, e lasciarle ferme spezzerebbe la curva in due punti invece
         che muoverla. */
      n.x += dx; n.y += dy;
      if (n.hi) { n.hi.x += dx; n.hi.y += dy; }
      if (n.ho) { n.ho.x += dx; n.ho.y += dy; }
      cambiato();
      return;
    }

    if (presa.tipo === 'maniglia') {
      var q = f[sel.forma].sub[sel.sub].nodi[sel.nodo];
      q[sel.maniglia].x += dx;
      q[sel.maniglia].y += dy;
      cambiato();
      return;
    }

    if (presa.tipo === 'forma') {
      sposta(f[sel.forma], dx, dy);
      cambiato();
      return;
    }

  }

  function sposta(forma, dx, dy) {
    if (forma.tipo === 'testo') { forma.x += dx; forma.y += dy; return; }
    forma.sub.forEach(function (s) {
      s.nodi.forEach(function (n) {
        n.x += dx; n.y += dy;
        if (n.hi) { n.hi.x += dx; n.hi.y += dy; }
        if (n.ho) { n.ho.x += dx; n.ho.y += dy; }
      });
    });
  }

  function su(e) {
    var mosso = presa && presa.mosso;
    var tipo = presa ? presa.tipo : null;
    if (presa) {
      presa = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* già rilasciato */ }
    }

    if (forseDoppio && !mosso && e.button === 0) {
      forseDoppio = false;
      ultimoGiu.t = 0;          // tre clic non sono un doppio clic e mezzo
      doppio(e);
      return;
    }
    forseDoppio = false;
    if (!tipo) return;

    if ((tipo === 'rettangolo' || tipo === 'cerchio') && costruendo) {
      var b = Tracciato.bbox([costruendo], TOL);
      /* Un clic senza trascinamento non è una forma: sarebbe un rettangolo
         di lato zero, invisibile e impossibile da riprendere. */
      if (b.w > perPixel() * 3 || b.h > perPixel() * 3) {
        forme().push(costruendo);
        costruendo = null;
        cambiato();
        return;
      }
      costruendo = null;
      disegna();
    }
  }

  /* ---------------------------- la spezzata ---------------------------- */

  function giuSpezzata(p) {
    if (!costruendo) {
      costruendo = Tracciato.daPunti([p, p], false);
      return;
    }
    var n = costruendo.sub[0].nodi;
    n[n.length - 1] = Tracciato.nodo(p.x, p.y);
    n.push(Tracciato.nodo(p.x, p.y));
    disegna();
  }

  function seguiSpezzata(e) {
    if (strumento !== 'spezzata' || !costruendo) return;
    var p = punto(e);
    var n = costruendo.sub[0].nodi;
    n[n.length - 1] = Tracciato.nodo(p.x, p.y);
    disegna();
  }

  function finisciSpezzata() {
    if (!costruendo) return;
    var n = costruendo.sub[0].nodi;
    /* L'ultimo nodo segue il puntatore: non è un punto messo, è l'anteprima
       di dove finirebbe. Chiudendo va buttato. */
    n.pop();
    /* E il doppio clic che chiude ha messo un punto sopra al precedente:
       due nodi nello stesso posto sono un tratto di lunghezza zero, che il
       G-code emetterebbe e la macchina non eseguirebbe. */
    while (n.length > 1 &&
           Math.abs(n[n.length - 1].x - n[n.length - 2].x) < 1e-6 &&
           Math.abs(n[n.length - 1].y - n[n.length - 2].y) < 1e-6) {
      n.pop();
    }
    if (n.length > 1) { forme().push(costruendo); costruendo = null; cambiato(); }
    else { costruendo = null; disegna(); }
  }

  /* ------------------------------ il testo ------------------------------ */

  function metteTesto(p) {
    var s = document.getElementById('ed-testo').value;
    var alt = +document.getElementById('ed-testo-alt').value || 10;
    if (!s.trim()) { Log.add('err', 'Scrivi prima il testo, poi clicca dove va.'); return; }
    /* FontTratto cresce verso l'alto e qui la y va in giù: il punto cliccato
       è la riga su cui le lettere poggiano, e il testo sta sopra. */
    forme().push(Tracciato.testo(s, p.x, p.y, alt));
    cambiato();
  }

  /* ------------------------------ il taglio ------------------------------ */

  /* Spezzare un tracciato in due. Si taglia sul NODO più vicino al punto, non
     in mezzo a un segmento: un taglio a metà curva vorrebbe dire dividere una
     cubica in due cubiche, e per quello che serve — separare due pezzi di
     disegno — il nodo basta e non introduce errore. */
  function taglia(p, u) {
    var t = sotto(p, u);
    if (!t || t.sub < 0) { Log.add('err', 'Niente da tagliare lì.'); return; }

    var f = forme(), forma = f[t.forma], sub = forma.sub[t.sub];
    var n = sub.nodi;
    var k = Math.max(1, Math.min(n.length - 1, Math.round(t.k - 1 + t.t)));

    if (sub.chiuso) {
      /* Un tracciato chiuso tagliato una volta non diventa due pezzi:
         diventa uno aperto, che comincia e finisce dove si è tagliato. */
      sub.nodi = n.slice(k).concat(n.slice(0, k + 1).map(function (z) {
        return Tracciato.nodo(z.x, z.y, z.hi, z.ho);
      }));
      sub.chiuso = false;
      cambiato();
      Log.add('msg', 'Tracciato chiuso aperto nel punto scelto.');
      return;
    }

    if (k <= 0 || k >= n.length - 1) { Log.add('err', 'Lì il taglio non dividerebbe niente.'); return; }

    var primo = { nodi: n.slice(0, k + 1), chiuso: false };
    var secondo = { nodi: n.slice(k), chiuso: false };
    forma.sub.splice(t.sub, 1, primo, secondo);
    cambiato();
    Log.add('msg', 'Tagliato in due: ' + primo.nodi.length + ' e ' +
                   secondo.nodi.length + ' nodi.');
  }

  /* --------------------------- nodi e forme --------------------------- */

  function commutaNodo() {
    var f = forme();
    if (!f || sel.forma < 0 || sel.nodo < 0) return;
    var sub = f[sel.forma].sub[sel.sub], n = sub.nodi[sel.nodo];

    if (n.hi || n.ho) { n.hi = null; n.ho = null; }
    else {
      /* Da spigolo a curva: le maniglie nascono lungo la congiungente dei due
         vicini, a un terzo di distanza. È la posizione che rende la curva
         liscia senza spostare il nodo, cioè quella che uno si aspetta. */
      var i = sel.nodo, m = sub.nodi.length;
      var prima = sub.nodi[(i - 1 + m) % m], dopo = sub.nodi[(i + 1) % m];
      var dx = dopo.x - prima.x, dy = dopo.y - prima.y;
      var L = Math.hypot(dx, dy) || 1;
      var d = Math.min(Math.hypot(n.x - prima.x, n.y - prima.y),
                       Math.hypot(dopo.x - n.x, dopo.y - n.y)) / 3;
      n.hi = { x: n.x - dx / L * d, y: n.y - dy / L * d };
      n.ho = { x: n.x + dx / L * d, y: n.y + dy / L * d };
    }
    cambiato();
  }

  function elimina() {
    var f = forme();
    if (!f || sel.forma < 0) return;

    if (sel.nodo >= 0) {
      var sub = f[sel.forma].sub[sel.sub];
      if (sub.nodi.length <= 2) {
        /* Un tracciato con meno di due nodi non è niente: togliendo il
           penultimo si toglie il tracciato. */
        f[sel.forma].sub.splice(sel.sub, 1);
        if (!f[sel.forma].sub.length) f.splice(sel.forma, 1);
        sel.forma = -1;
      } else {
        sub.nodi.splice(sel.nodo, 1);
      }
      sel.sub = -1; sel.nodo = -1;
      cambiato();
      return;
    }

    f.splice(sel.forma, 1);
    sel.forma = -1; sel.sub = -1; sel.nodo = -1;
    cambiato();
  }

  function doppio(e) {
    if (strumento === 'spezzata') { finisciSpezzata(); return; }
    if (strumento !== 'scegli') return;

    var p = punto(e), u = perPixel();

    var h = nodoSotto(p, u);
    if (h && !h.maniglia) {
      sel.sub = h.sub; sel.nodo = h.nodo;
      commutaNodo();
      return;
    }

    /* Doppio clic su un tratto: un nodo nuovo dove si è cliccato. Il punto è
       preso sulla polilinea, quindi sta sulla curva; la curva fra i due nodi
       vicini cambia un po' di forma, ed è il prezzo di avere un nodo in più
       senza dividere la cubica. */
    var t = sotto(p, u);
    if (!t || t.sub < 0) return;
    var f = forme(), sub = f[t.forma].sub[t.sub];
    var dove = Math.max(1, Math.min(sub.nodi.length - 1, Math.round(t.k - 1 + t.t) + 1));
    sub.nodi.splice(dove, 0, Tracciato.nodo(t.punto.x, t.punto.y));
    sel.forma = t.forma; sel.sub = t.sub; sel.nodo = dove;
    cambiato();
  }

  /* ------------------------------- avvio ------------------------------- */

  /* Si entra dal pulsante «Crea / Edit»: con un livello scelto si modifica
     quello, senza si comincia da una tela vuota. */
  function apri() {
    if (!Artwork.forme()) Artwork.nuovo('nuovo disegno');
    sel = { forma: -1, sub: -1, nodo: -1, maniglia: null };
    costruendo = null;
    var l = (Artwork.livelli() || []).filter(function (x) { return x.scelto; })[0];
    if (titolo) titolo.textContent = l ? l.nome : '';
    adatta();
    scriviPiede();
    scriviAiuto();
  }

  function init() {
    svg = document.getElementById('ed-svg');
    tela = document.getElementById('ed-tela');
    aiuto = document.getElementById('ed-aiuto');
    piede = document.getElementById('ed-piede');
    titolo = document.getElementById('ed-titolo');
    if (!svg) return;

    document.getElementById('ed-barra').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.str) scegliStrumento(b.dataset.str);
      else if (b.id === 'ed-adatta') adatta();
      else if (b.id === 'ed-curvo') commutaNodo();
      else if (b.id === 'ed-elimina') elimina();
    });

    svg.addEventListener('pointerdown', giu);
    svg.addEventListener('pointermove', function (e) { muovi(e); seguiSpezzata(e); });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      svg.addEventListener(ev, su);
    });
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!vista) adatta();
      var f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      var p = punto(e);
      vista = { x0: p.x - (p.x - vista.x0) * f, y0: p.y - (p.y - vista.y0) * f,
                w: vista.w * f, h: vista.h * f };
      applica();
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      if (!document.getElementById('tab-editor').classList.contains('is-active')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape') { chiudiCostruzione(true); scegliStrumento('scegli'); }
      else if (e.key === 'Enter') finisciSpezzata();
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); elimina(); }
    });

    if (window.ResizeObserver && tela) new ResizeObserver(function () { disegna(); }).observe(tela);

    scegliStrumento('scegli');
  }

  return { init: init, apri: apri, adatta: adatta, disegna: disegna,
           strumento: function () { return strumento; },
           scegliStrumento: scegliStrumento,
           selezione: function () { return { forma: sel.forma, sub: sel.sub, nodo: sel.nodo }; } };
})();
