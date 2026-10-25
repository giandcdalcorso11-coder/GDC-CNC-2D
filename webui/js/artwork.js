/* I disegni caricati sul foglio: dai file SVG alle polilinee, e da lì al
 * G-code.
 *
 * NON C'È UN DISEGNO, C'È UN ELENCO DI LIVELLI. Un livello è un file caricato,
 * con la sua collocazione sul foglio, la sua rotazione e il suo ritaglio; e
 * soprattutto è l'unità con cui si ragiona di penne: un livello si disegna
 * tutto di fila, e fra un livello e l'altro ci si può fermare a cambiare
 * penna. Mescolarli sarebbe comodo per il tempo e disastroso per i colori.
 *
 * Le polilinee grezze di ogni livello restano in memoria nelle coordinate del
 * file: scala, rotazione, ritaglio e formato del foglio si riapplicano ogni
 * volta a partire da quelle, invece di trasformare il risultato precedente.
 * Trasformare più volte lo stesso dato accumula errori e perde precisione a
 * ogni giro.
 */
var Artwork = (function () {

  /* L'elenco, in ordine di disegno: il primo si stampa per primo, e l'ultimo
     resta sopra agli altri sul piano. */
  var livelli = [];
  var scelto = null;     // id del livello selezionato, o null
  var seq = 0;

  var prep = null;       // ultimo G-code composto

  /* I CAMBI PENNA MESSI A MANO: indici dei tratti PRIMA dei quali fermarsi.
     Quelli automatici fra un livello e l'altro non stanno qui — si ricavano
     dai livelli a ogni composizione, vedi prepare().

     Si tengono come indici e non come coordinate perché il punto di una pausa
     è un confine fra due tratti, non un posto sul foglio. E si azzerano
     quando il disegno cambia, perché dopo un riadattamento l'ottimizzatore
     riordina i tratti e l'indice 37 non è più lo stesso tratto. */
  var pause = [];

  /* Quello che serve per ricomporre il file senza rifare l'ottimizzazione:
     aggiungere o togliere una pausa cambia il programma, non il percorso. */
  var ultima = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  /* ------------------------- l'elenco ------------------------- */

  function trova(id) {
    for (var i = 0; i < livelli.length; i++) if (livelli[i].id === id) return livelli[i];
    return null;
  }

  function indice(id) {
    for (var i = 0; i < livelli.length; i++) if (livelli[i].id === id) return i;
    return -1;
  }

  function corrente() { return trova(scelto); }

  function visibili() {
    return livelli.filter(function (l) { return l.visibile && l.raw.length; });
  }

  function load(text, nome) {
    /* Si leggono le FORME, con le curve ancora curve, e da quelle si
       ricavano le polilinee. L'ordine conta: appiattire per primo e tenere
       solo il risultato è quello che rendeva impossibile modificare una
       curva importata. */
    var forme = SvgImport.parseForme(text);
    var raw = Tracciato.appiattisciTutte(forme, forme.tolleranza);
    var l = {
      id: 'liv' + (++seq),
      nome: nome,
      forme: forme,
      tol: forme.tolleranza,
      raw: raw,
      box: null,           // null = «non ancora collocato»: nasce centrato
      ritaglio: null,      // null = «tutto»
      rot: 0,
      visibile: true,
      /* Il primo livello non ha un «prima» in cui fermarsi; gli altri sì, e
         di solito è proprio quello che si vuole caricando un secondo file. */
      cambioPenna: livelli.length > 0,
      art: []
    };
    livelli.push(l);
    scelto = l.id;

    /* Lo sfondo scartato va detto, non taciuto: chi guarda l'anteprima deve
       capire perché una forma che nel file c'era non viene disegnata. */
    var sc = SvgImport.scartate(), n = sc.sfondi + sc.piene;
    var c = Tracciato.conta(forme);
    Log.add('msg', 'Importato ' + nome + ': ' + raw.length + ' tracciati' +
            (c.curve ? ', ' + c.curve + ' nodi con una curva' : ', tutti dritti') + '.' +
            (n ? ' Saltate ' + n + ' forme senza bordo: in un file di linee ' +
                 'sono lo sfondo e i riferimenti, e una penna non riempie.' : '') +
            (livelli.length > 1 ? ' È il livello ' + livelli.length +
                                  ': si disegna dopo gli altri.' : ''));
    refit();
  }

  function rimuovi(id) {
    var i = indice(id);
    if (i < 0) return;
    var nome = livelli[i].nome;
    livelli.splice(i, 1);
    if (scelto === id) scelto = livelli.length ? livelli[Math.min(i, livelli.length - 1)].id : null;
    if (!livelli.length && window.Selezione) Selezione.chiudi();
    Log.add('msg', 'Tolto il livello «' + nome + '».');
    refit();
  }

  function clear() {
    if (!livelli.length) return;
    livelli = [];
    scelto = null;
    if (window.Selezione) Selezione.chiudi();
    Log.add('msg', 'Tolti tutti i livelli: il piano resta con le sole aree.');
    refit();
  }

  /* Spostare un livello nell'elenco vuol dire cambiare QUANDO si disegna, non
     dove: l'ordine è la sequenza della stampa, ed è per questo che conta. */
  function muovi(id, verso) {
    var i = indice(id);
    var j = i + verso;
    if (i < 0 || j < 0 || j >= livelli.length) return;
    var t = livelli[i];
    livelli[i] = livelli[j];
    livelli[j] = t;
    /* La spunta del cambio penna NON si tocca riordinando. È una proprietà
       del livello — «questo lo disegno con un'altra penna» — e sul primo non
       si applica perché non c'è un prima in cui fermarsi, ma resta scritta:
       rimettendolo più in giù torna a valere. Azzerarla vorrebbe dire
       perdere un'informazione a ogni spostamento, e riordinare due volte non
       riporterebbe allo stato di partenza. */
    refit();
  }

  function seleziona(id) {
    if (!trova(id)) return;
    scelto = id;
    renderElenco();
    mostraCampi();
    if (window.Selezione) Selezione.ridisegna();
  }

  function commutaVisibile(id) {
    var l = trova(id);
    if (!l) return;
    l.visibile = !l.visibile;
    refit();
  }

  function commutaCambioPenna(id) {
    var l = trova(id);
    if (!l) return;
    l.cambioPenna = !l.cambioPenna;
    refit();
  }

  /* Quale livello sta sotto a un punto del foglio: l'ULTIMO che lo contiene,
     cioè quello disegnato sopra agli altri. `dopo` fa ripartire la ricerca
     dal livello seguente, così un doppio clic ripetuto nello stesso posto
     gira fra quelli sovrapposti invece di ripescare sempre lo stesso. */
  function quale(p, dopo) {
    var vis = visibili();
    if (!vis.length) return null;
    var da = vis.length - 1;
    if (dopo) {
      var k = -1;
      for (var i = 0; i < vis.length; i++) if (vis[i].id === dopo) k = i;
      if (k >= 0) da = k - 1 + vis.length;
    }
    for (var n = 0; n < vis.length; n++) {
      var l = vis[(da - n + vis.length * 2) % vis.length];
      var r = vista(l);
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return l.id;
    }
    return null;
  }

  /* LE FORME DEL LIVELLO SCELTO, per chi le modifica. Chi le cambia poi
     chiama rigenera(): le polilinee sono un prodotto, e vanno rifatte. */
  function formeScelte() {
    var l = corrente();
    return l ? l.forme : null;
  }

  /* MODIFICARE UNA FORMA NON DEVE SPOSTARE IL DISEGNO.
     Il rettangolo del livello mappa l'ingombro delle forme sul foglio: se
     cambiando un nodo l'ingombro cresce, riusare lo stesso rettangolo
     rimpicciolirebbe TUTTO il resto per farci stare la parte nuova. Qui si
     tiene fermo il legame fra le due coordinate — la stessa scala, la stessa
     origine — e il rettangolo si adegua. Così spostando un nodo si muove
     quel nodo, e basta. */
  function rigenera(id) {
    var l = id ? trova(id) : corrente();
    if (!l || !l.forme) return;

    var vecchio = l.bb;
    l.raw = Tracciato.appiattisciTutte(l.forme, l.tol);

    if (vecchio && l.box && vecchio.w > 0 && vecchio.h > 0 && l.raw.length) {
      var nuovo = SvgImport.bbox(ruotate(l));
      var kx = l.box.w / vecchio.w, ky = l.box.h / vecchio.h;
      /* La y è ribaltata da toRect, che misura da b.y1 verso il basso: per
         questo l'ancora in y è l'estremo ALTO dell'ingombro, non quello
         basso. */
      l.box = {
        x: l.box.x + (nuovo.x0 - vecchio.x0) * kx,
        y: l.box.y + (vecchio.y1 - nuovo.y1) * ky,
        w: nuovo.w * kx,
        h: nuovo.h * ky
      };
    }
    refit();
  }

  /* ISTANTANEA E RIPRISTINO, per l'annulla dell'editor.
     Si fotografano le forme E il rettangolo: rigenera() sposta il rettangolo
     per tenere fermo il disegno sul foglio, quindi rimettere solo le forme
     riporterebbe il disegno giusto nel posto sbagliato.
     La copia è profonda, con un giro da JSON: i nodi sono oggetti semplici e
     una copia di superficie lascerebbe l'istantanea attaccata a quello che
     si sta per cambiare, cioè non sarebbe un'istantanea. */
  function istantanea() {
    var l = corrente();
    if (!l || !l.forme) return null;
    return {
      id: l.id,
      forme: JSON.parse(JSON.stringify(l.forme)),
      box: l.box ? { x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h } : null
    };
  }

  function ripristina(s) {
    if (!s) return;
    var l = trova(s.id);
    if (!l) return;
    l.forme = JSON.parse(JSON.stringify(s.forme));
    l.box = s.box ? { x: s.box.x, y: s.box.y, w: s.box.w, h: s.box.h } : null;
    l.raw = Tracciato.appiattisciTutte(l.forme, l.tol);
    refit();
  }

  /* Un livello che nasce vuoto: è il «Crea» dell'editor. Senza forme non ha
     un ingombro, quindi non ha nemmeno un rettangolo; li prende tutti e due
     appena dentro ci finisce il primo tratto. */
  function nuovo(nome) {
    var l = {
      id: 'liv' + (++seq),
      nome: nome || 'nuovo disegno',
      forme: [],
      tol: 0.05,
      raw: [],
      box: null,
      ritaglio: null,
      rot: 0,
      visibile: true,
      cambioPenna: livelli.length > 0,
      art: []
    };
    livelli.push(l);
    scelto = l.id;
    refit();
    return l.id;
  }

  function elenco() {
    return livelli.map(function (l, i) {
      return { id: l.id, nome: l.nome, visibile: l.visibile,
               cambioPenna: l.cambioPenna, attivo: l.cambioPenna && i > 0,
               primo: i === 0,
               tratti: l.art.length, scelto: l.id === scelto };
    });
  }

  function sceltoId() { return scelto; }

  /* ------------------- collocazione di un livello ------------------- */

  function ruotate(l) {
    return l.rot ? rotateAll(l.raw, l.rot) : l.raw;
  }

  /* Il rettangolo che si VEDE di un livello: senza ritaglio è il disegno
     intero, con ritaglio è la parte rimasta. */
  function vista(l) { return l ? (l.ritaglio || l.box) : null; }

  function riquadro() { return vista(corrente()); }

  /* Il disegno intero di un livello, anche la parte nascosta: serve al
     riquadro di selezione per mostrare in chiaro quanto si tiene fuori. */
  function riquadroPieno() { var l = corrente(); return l ? l.box : null; }

  function ritagliato() { var l = corrente(); return !!(l && l.ritaglio); }

  function dentroA(r, c) {
    var x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y);
    var x1 = Math.min(r.x + r.w, c.x + c.w), y1 = Math.min(r.y + r.h, c.y + c.h);
    return { x: x0, y: y0, w: Math.max(0.5, x1 - x0), h: Math.max(0.5, y1 - y0) };
  }

  /* Sposta o ridimensiona QUELLO CHE SI VEDE del livello scelto. Il disegno
     intero subisce la stessa trasformazione, se no il ritaglio scivolerebbe
     sopra un disegno fermo e si vedrebbe un'altra parte invece della stessa
     più grande. */
  function collocaA(r) {
    var l = corrente();
    if (!l || !l.box) return;
    var nuovo = { x: r.x, y: r.y, w: Math.max(2, r.w), h: Math.max(2, r.h) };

    if (!l.ritaglio) { l.box = nuovo; refit(); return; }

    var kx = nuovo.w / l.ritaglio.w, ky = nuovo.h / l.ritaglio.h;
    l.box = {
      x: nuovo.x + (l.box.x - l.ritaglio.x) * kx,
      y: nuovo.y + (l.box.y - l.ritaglio.y) * ky,
      w: l.box.w * kx,
      h: l.box.h * ky
    };
    l.ritaglio = nuovo;
    refit();
  }

  /* IL TAGLIO: cambia solo la finestra, non la taglia del disegno. Per questo
     si può allargare fino a riavere tutto, e non oltre. */
  function ritagliaA(r) {
    var l = corrente();
    if (!l || !l.box) return;
    var nuovo = dentroA({ x: r.x, y: r.y, w: Math.max(2, r.w), h: Math.max(2, r.h) }, l.box);
    var tutto = Math.abs(nuovo.x - l.box.x) < 0.05 && Math.abs(nuovo.y - l.box.y) < 0.05 &&
                Math.abs(nuovo.w - l.box.w) < 0.05 && Math.abs(nuovo.h - l.box.h) < 0.05;
    l.ritaglio = tutto ? null : nuovo;
    refit();
  }

  /* Le due percentuali sono il rettangolo detto in un altro modo, non un dato
     a parte: si ricavano ogni volta, così non possono sfasarsi da lui. */
  function percentuali() {
    var l = corrente();
    if (!l || !l.box) return null;
    return SvgImport.percentuali(ruotate(l), State.data.paper, l.box);
  }

  /* Scrivere nel campo vuol dire «questa percentuale, in proporzione»: il
     disegno torna regolare ma NON torna al centro. Ricentrarlo butterebbe via
     un trascinamento fatto apposta, e per rimetterlo in mezzo c'è il foglio. */
  function scalaDalCampo() {
    var l = corrente();
    if (!l) return;
    var pc = +document.getElementById('art-scale').value || 100;
    var nuovo = SvgImport.fitRect(ruotate(l), State.data.paper, pc);
    if (l.box) {
      nuovo.x = l.box.x + l.box.w / 2 - nuovo.w / 2;
      nuovo.y = l.box.y + l.box.h / 2 - nuovo.h / 2;
      /* Il ritaglio è una finestra sul disegno, quindi va col disegno: si
         riscala con lui attorno allo stesso centro. Lasciandolo fermo
         scoprirebbe un'altra parte invece della stessa, più grande. */
      if (l.ritaglio) {
        var kx = nuovo.w / l.box.w, ky = nuovo.h / l.box.h;
        l.ritaglio = {
          x: nuovo.x + (l.ritaglio.x - l.box.x) * kx,
          y: nuovo.y + (l.ritaglio.y - l.box.y) * ky,
          w: l.ritaglio.w * kx,
          h: l.ritaglio.h * ky
        };
      }
    }
    l.box = nuovo;
    refit();
  }

  /* Ruotando cambia la forma dell'ingombro, e un rettangolo pensato per
     l'altro verso schiaccerebbe il disegno senza che nessuno l'abbia chiesto:
     la collocazione di quel livello riparte da capo, centrata. */
  function ruotaDalCampo() {
    var l = corrente();
    if (!l) return;
    l.rot = +document.getElementById('art-rot').value || 0;
    l.box = null;
    l.ritaglio = null;
    refit();
  }

  function rotateAll(polys, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return polys.map(function (p) {
      return p.map(function (q) {
        return { x: q.x * c - q.y * s, y: q.x * s + q.y * c };
      });
    });
  }

  /* --------------------------- il ricalcolo --------------------------- */

  /* Rimappa tutti i livelli dentro ai loro rettangoli e ricompone il
     percorso. Va richiamata quando cambia un rettangolo, una rotazione, un
     ritaglio, l'ordine, la visibilità o il formato del foglio. */
  function refit() {
    var art = [], di = [];

    for (var i = 0; i < livelli.length; i++) {
      var l = livelli[i];
      if (!l.raw.length) { l.art = []; continue; }

      var polys = ruotate(l);
      if (!l.box) {
        var pc = (l.id === scelto)
          ? (+document.getElementById('art-scale').value || 100) : 100;
        l.box = SvgImport.fitRect(polys, State.data.paper, pc);
      }
      if (l.ritaglio) l.ritaglio = dentroA(l.ritaglio, l.box);

      /* Il diradamento va fatto DOPO la scalatura: una tolleranza di un
         decimo di millimetro ha senso sul foglio, non nelle unità arbitrarie
         del file, che possono valere un millimetro come un metro. E prima del
         ritaglio: su meno punti costa meno, e il taglio resta comunque esatto
         sul bordo perché lavora sui segmenti. */
      /* L'ingombro con cui si sta adattando, tenuto da parte: serve a
         rigenera(), che dopo una modifica deve poter rifare lo STESSO
         adattamento invece di uno nuovo. */
      l.bb = SvgImport.bbox(polys);

      var mm = SvgImport.simplify(SvgImport.toRect(polys, l.box), 0.06);
      l.art = l.ritaglio ? SvgImport.ritaglia(mm, l.ritaglio) : mm;

      if (!l.visibile) continue;
      for (var j = 0; j < l.art.length; j++) { art.push(l.art[j]); di.push(l.id); }
    }

    State.data.art = art.length ? art : null;
    State.data.artDi = di;
    State.data.artName = nomeComplessivo();

    /* Ogni cambio invalida il programma: le coordinate non sono più quelle,
       e gli indici delle pause nemmeno. */
    prep = null;
    ultima = null;
    svuotaPause();
    document.getElementById('prep').hidden = true;

    Paper.rebuildPath();
    renderElenco();
    mostraCampi();
    if (window.Selezione) Selezione.ridisegna();
  }

  function nomeComplessivo() {
    var v = livelli.filter(function (l) { return l.visibile; });
    if (!v.length) return null;
    return v.length === 1 ? v[0].nome : 'composizione';
  }

  /* ------------------------- i campi e l'elenco ------------------------- */

  var ICONA_OCCHIO = '&#9679;', ICONA_CHIUSO = '&#9675;';

  function renderElenco() {
    var box = document.getElementById('livelli');
    var testa = document.getElementById('liv-testa');
    if (!box) return;
    box.hidden = !livelli.length;
    if (testa) testa.hidden = !livelli.length;
    if (!livelli.length) { box.innerHTML = ''; return; }

    var out = '';
    for (var i = 0; i < livelli.length; i++) {
      var l = livelli[i];
      out += '<div class="liv-riga' + (l.id === scelto ? ' scelto' : '') +
             (l.visibile ? '' : ' spento') + '" data-liv="' + l.id + '">' +
             '<span class="liv-n">' + (i + 1) + '</span>' +
             '<button type="button" class="liv-nome" data-sel="' + l.id +
             '" title="' + esc(l.nome) + ' — ' + l.art.length + ' tratti">' +
             esc(l.nome) + '</button>' +
             (l.cambioPenna && i > 0
                ? '<span class="liv-penna" title="cambio penna prima di questo ' +
                  'livello">&#9998;</span>' : '') +
             '<button type="button" class="liv-ic" data-su="' + l.id +
             '" title="prima"' + (i === 0 ? ' disabled' : '') + '>&#9650;</button>' +
             '<button type="button" class="liv-ic" data-giu="' + l.id +
             '" title="dopo"' + (i === livelli.length - 1 ? ' disabled' : '') +
             '>&#9660;</button>' +
             '<button type="button" class="liv-ic" data-occhio="' + l.id +
             '" title="mostra o nascondi">' +
             (l.visibile ? ICONA_OCCHIO : ICONA_CHIUSO) + '</button>' +
             '<button type="button" class="liv-ic liv-del" data-del="' + l.id +
             '" title="togli">&times;</button>' +
             '</div>';
    }
    box.innerHTML = out;
  }

  /* I campi in fondo alla colonna parlano del livello SCELTO, non di tutti:
     scala, rotazione e cambio penna sono proprietà sue. Senza un livello
     scelto non hanno niente da dire e si spengono. */
  function mostraCampi() {
    var l = corrente();
    var scala = document.getElementById('art-scale');
    var rot = document.getElementById('art-rot');
    var cam = document.getElementById('art-cambio');
    var nota = document.getElementById('art-deform');
    var riga = document.getElementById('art-campi');

    if (riga) riga.hidden = !l;
    if (!l) { if (nota) nota.hidden = true; return; }

    rot.value = l.rot;
    if (cam) {
      cam.checked = l.cambioPenna;
      cam.disabled = indice(l.id) === 0;
      var et = document.getElementById('art-cambio-et');
      if (et) {
        et.hidden = false;
        et.title = cam.disabled
          ? 'Il primo livello non ha un prima in cui fermarsi'
          : 'La stampa si ferma prima di questo livello per far cambiare la penna';
      }
    }

    var pc = percentuali();
    if (!pc) { if (nota) nota.hidden = true; return; }

    /* Il campo dice la percentuale in larghezza. Quando l'altezza non
       coincide il disegno è schiacciato, e il campo da solo mentirebbe: la
       differenza va scritta, non nascosta dietro a un numero solo. */
    scala.value = Math.round(pc.x * 10) / 10;
    if (!nota) return;
    var storto = Math.abs(pc.x - pc.y) > 0.2;
    nota.hidden = !storto;
    if (storto) {
      nota.textContent = 'Deformato: larghezza ' + (Math.round(pc.x * 10) / 10) +
                         ' %, altezza ' + (Math.round(pc.y * 10) / 10) +
                         ' %. Scrivi una percentuale qui sopra per tornare in proporzione.';
    }
  }

  /* ----------------------- preparazione stampa ---------------------- */

  function sommaStat(a, b) {
    return {
      tratti: a.tratti + b.tratti,
      punti: a.punti + b.punti,
      disegno: a.disegno + b.disegno,
      spostamento: a.spostamento + b.spostamento,
      alzate: a.alzate + b.alzate,
      secondi: a.secondi + b.secondi
    };
  }

  function prepare() {
    var vis = visibili();
    if (!vis.length) { Log.add('err', 'Nessun disegno da preparare.'); return; }

    /* Le velocità e la pausa della penna vengono dal profilo di stampa: sono
       del lavoro, non della macchina, e si cambiano nella tab Impostazioni. */
    var st = Profile.stampa();
    var feedDraw = st.velocitaDisegno, feedTravel = st.velocitaSpostamento;
    var ambito = st.ottimizza || 'livello';

    var t0 = performance.now();
    var gruppi = [];

    if (ambito === 'tutto') {
      /* Un gruppo solo: l'ottimizzatore può spostare un tratto del primo
         livello in mezzo al terzo. È il più veloce e l'unico che rompe i
         cambi penna, per questo qui sotto vengono tolti. */
      var insieme = [];
      vis.forEach(function (l) { insieme = insieme.concat(l.art); });
      var r = Optimize.run(insieme, feedDraw, feedTravel);
      gruppi.push({ id: null, polys: r.polys, prima: r.prima, dopo: r.dopo });
    } else {
      vis.forEach(function (l) {
        if (ambito === 'niente') {
          var s = Optimize.stats(l.art, feedDraw, feedTravel);
          gruppi.push({ id: l.id, polys: l.art, prima: s, dopo: s });
        } else {
          var o = Optimize.run(l.art, feedDraw, feedTravel);
          gruppi.push({ id: l.id, polys: o.polys, prima: o.prima, dopo: o.dopo });
        }
      });
    }
    var ms = Math.round(performance.now() - t0);

    /* Il percorso riordinato diventa quello mostrato: l'anteprima deve far
       vedere quello che la macchina farà davvero, non quello che avrebbe
       fatto prima del riordino. */
    var art = [], di = [], auto = [];
    gruppi.forEach(function (g, i) {
      var l = g.id ? trova(g.id) : null;
      if (i > 0 && l && l.cambioPenna) auto.push(art.length);
      g.polys.forEach(function (p) { art.push(p); di.push(g.id); });
    });

    if (ambito === 'tutto' && vis.some(function (l) { return l.cambioPenna; })) {
      Log.add('err', 'Ottimizzazione su TUTTO: i cambi penna fra livelli sono ' +
                     'stati ignorati, perché i tratti dei livelli finiscono ' +
                     'mescolati. Per tenerli, metti l\'ottimizzazione «per livello».');
    }

    State.data.art = art;
    State.data.artDi = di;
    Paper.rebuildPath();

    var prima = gruppi.reduce(function (a, g) { return a ? sommaStat(a, g.prima) : g.prima; }, null);
    var dopo = gruppi.reduce(function (a, g) { return a ? sommaStat(a, g.dopo) : g.dopo; }, null);

    var o = State.data.sheetOrigin;
    var machine = art.map(function (p) {
      return p.map(function (q) { return { x: q.x + o.x, y: q.y + o.y }; });
    });

    /* Z è in millimetri veri di penna, in coordinate MACCHINA: Z0 è la
       posizione tappo, in cima, e la quota di contatto è NEGATIVA, circa
       -21,27. Il perché sta in profile.js, sopra zDaGradi(): senza homing
       FluidNC mette lo zero in cima e tronca tutto quello che sta sopra.

       Il contatto non è un numero fisso: è la quota a cui la punta tocca il
       foglio di oggi, misurata col secondo popup di inizio stampa. Finché
       quella misura non c'è si usa il contatto nominale del profilo.

       Il ramo a zero resta solo per il caso «profilo non tarato», in cui le
       quote sono dei segnaposto e FluidNC le troncherebbe: il file esce
       marcato DA TARARE e verifica() blocca la stampa, quindi serve a
       guardare il programma e a nient'altro. */
    var nominale = Profile.zContatto();
    var contatto = State.data.altezzaContatto !== null ? State.data.altezzaContatto
                 : (nominale === null ? 0 : nominale);

    /* Finché i tre angoli del servo non sono stati rilevati non c'è un'alzata
       vera: si mettono 5 mm per poter guardare il programma, e il file lo
       dichiara DA TARARE. */
    var alzata = Profile.alzataMm();
    var tarata = alzata !== null;
    if (alzata === null) alzata = 5;
    if (st.alzataLavoro !== null && st.alzataLavoro > 0) {
      alzata = Math.min(alzata, st.alzataLavoro);
    }

    /* La posizione tappo è una quota del profilo macchina, non di stampa: è
       dove il meccanismo lascia spazio al tappo, e non dipende dal foglio.
       Per questo è ASSOLUTA e non contatto + qualcosa: è il fine corsa alto,
       Z0. Sommarla al contatto misurato darebbe una quota sopra lo zero, che
       mapConstrain tronca comunque — e con un foglio spesso finirebbe fuori
       corsa di quel tanto. */
    var tappo = Profile.zTappo();

    ultima = {
      machine: machine,
      auto: auto,
      opt: {
        penUp: contatto + alzata,
        penDown: contatto,
        penTappo: tappo,
        ritorno: Profile.puntoHome(),
        pennaTarata: tarata,
        pausaMs: st.pausaPennaMs,
        feedDraw: feedDraw,
        feedTravel: feedTravel,
        feedPen: 600
      },
      r: { prima: prima, dopo: dopo },
      ms: ms
    };
    componi();
  }

  /* Ricompone il file dal percorso già riordinato. La chiamano prepare() e
     ogni modifica all'elenco delle pause. */
  function componi() {
    if (!ultima) return;
    var opt = {};
    for (var k in ultima.opt) opt[k] = ultima.opt[k];

    /* I cambi penna automatici fra livelli e quelli messi a mano finiscono
       nello stesso elenco: per il generatore sono la stessa cosa, e averne
       due a lui non servirebbe a niente. */
    var tutte = ultima.auto.concat(pause).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    }).sort(function (a, b) { return a - b; });

    opt.pause = tutte;
    prep = Gcode.build(ultima.machine, opt);
    showStats(ultima.r, ultima.ms, tutte.length);
    /* Il pulsante del cambio penna si accende solo quando un programma c'è:
       senza questa chiamata nascerebbe spento e ci resterebbe, perché
       l'evento del percorso parte prima che il file esista. */
    if (window.Preview && Preview.aggiornaPause) Preview.aggiornaPause();
    if (window.Paper && Paper.renderPause) Paper.renderPause();
  }

  /* ------------------------ i cambi penna ------------------------- */

  /* L'elenco completo, automatici compresi: lo usano il piano per disegnare i
     segni e l'anteprima per sapere se un tratto è già un punto di fermata. */
  function elencoPause() {
    if (!ultima) return pause.slice();
    return ultima.auto.concat(pause).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    }).sort(function (a, b) { return a - b; });
  }

  function pauseAutomatiche() { return ultima ? ultima.auto.slice() : []; }

  function programmaPronto() { return !!prep; }

  function svuotaPause() {
    if (!pause.length) return;
    pause = [];
    if (window.Paper && Paper.renderPause) Paper.renderPause();
  }

  /* Una pausa prima del primo tratto non vuol dire niente: la penna giusta la
     si mette nel morsetto prima di partire. E su un confine che è già una
     fermata automatica non c'è niente da aggiungere. */
  function pausaPossibile(k) {
    var art = State.data.art;
    if (!prep || !art || k < 1 || k >= art.length) return false;
    return pauseAutomatiche().indexOf(k) < 0;
  }

  function commutaPausa(k) {
    if (!pausaPossibile(k)) return false;
    var i = pause.indexOf(k);
    if (i >= 0) pause.splice(i, 1);
    else { pause.push(k); pause.sort(function (a, b) { return a - b; }); }
    componi();
    Log.add('msg', i >= 0
      ? 'Tolto il cambio penna prima del tratto ' + k + '.'
      : 'Cambio penna prima del tratto ' + k + '.');
    return true;
  }

  function showStats(r, ms, nPause) {
    var d = r.dopo, p = r.prima;
    document.getElementById('prep').hidden = false;
    document.getElementById('st-time').textContent = Gcode.durata(d.secondi);
    document.getElementById('st-paths').textContent = d.tratti + ' (' + d.punti + ' punti)';
    document.getElementById('st-draw').textContent = Math.round(d.disegno) + ' mm';
    document.getElementById('st-travel').textContent = Math.round(d.spostamento) + ' mm';
    document.getElementById('st-lifts').textContent = d.alzate +
      (nPause ? ' · ' + nPause + ' cambi penna' : '');

    var risp = p.secondi - d.secondi;
    document.getElementById('st-gain').textContent = risp > 1
      ? 'Ottimizzazione: ' + Gcode.durata(risp) + ' risparmiati, spostamenti da ' +
        Math.round(p.spostamento) + ' a ' + Math.round(d.spostamento) + ' mm, ' +
        'tratti da ' + p.tratti + ' a ' + d.tratti + '. Calcolato in ' + ms + ' ms.'
      : '';

    document.getElementById('gcode-out').value = prep;
    Log.add('msg', 'G-code pronto: ' + prep.split('\n').length + ' righe, ' +
                   Gcode.durata(d.secondi) + ' stimati' +
                   (nPause ? ', ' + nPause + ' cambi penna' : '') + '.');
  }

  /* L'invio passa dal Sender, che manda le righe una per una sul WebSocket.
     Qui si decide solo SE si può partire; come si parte è affar suo. */
  function invia() {
    if (!prep) { Log.add('err', 'Nessun programma preparato.'); return; }

    if (State.data.mock) {
      Log.add('msg', 'Modalità finta: il programma non viene inviato a nessuno. ' +
                     'Sarebbero partite ' +
                     Sender.prepara(prep).length + ' righe di comando.');
      return;
    }

    /* Senza origine non si stampa. Le coordinate del programma sono assolute e
       riferite all'azzeramento sui blocchi: mandarle a una macchina che non sa
       dove sia significa disegnare da qualche parte, forse fuori dalla tavola. */
    if (!State.data.azzerata) {
      Log.add('err', 'La macchina non è azzerata: le coordinate del programma ' +
                     'non avrebbero un riferimento. Fai prima l\'azzeramento.');
      return;
    }

    var name = (State.data.artName || 'disegno').replace(/\.svg$/i, '');
    Sender.avvia(prep, name);
  }

  function download() {
    if (!prep) return;
    var name = (State.data.artName || 'disegno').replace(/\.svg$/i, '') + '.gcode';
    var blob = new Blob([prep], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    Log.add('msg', 'Scaricato ' + name + '.');
  }

  function init() {
    document.getElementById('art-scale').addEventListener('change', scalaDalCampo);
    document.getElementById('art-rot').addEventListener('change', ruotaDalCampo);
    document.getElementById('btn-generate').addEventListener('click', prepare);
    document.getElementById('btn-download').addEventListener('click', download);
    document.getElementById('btn-clear-file').addEventListener('click', clear);

    var cam = document.getElementById('art-cambio');
    if (cam) {
      cam.addEventListener('change', function () {
        if (scelto) commutaCambioPenna(scelto);
      });
    }

    /* Un ascoltatore sulla lista invece di uno per pulsante: i livelli
       nascono e muoiono mentre la pagina è aperta, e agganciare i listener ai
       nodi vuol dire ricordarsi di riagganciarli ogni volta — cioè
       dimenticarsene una volta. */
    var box = document.getElementById('livelli');
    if (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        var d = b.dataset;
        if (d.sel) seleziona(d.sel);
        else if (d.su) muovi(d.su, -1);
        else if (d.giu) muovi(d.giu, 1);
        else if (d.occhio) commutaVisibile(d.occhio);
        else if (d.del) rimuovi(d.del);
      });
    }

    var sample = document.getElementById('btn-sample');
    if (window.SAMPLE_SVG) {
      sample.addEventListener('click', function () {
        load(window.SAMPLE_SVG, window.SAMPLE_NAME || 'esempio.svg');
      });
    } else {
      sample.hidden = true;
    }

    /* Foglio nuovo, collocazioni nuove: i rettangoli di prima erano misurati
       su un foglio che non c'è più. */
    State.on('paper', function () {
      if (!livelli.length) return;
      livelli.forEach(function (l) { l.box = null; l.ritaglio = null; });
      refit();
    });

    renderElenco();
    mostraCampi();
  }

  return {
    init: init, load: load, clear: clear, refit: refit,
    prepare: prepare, invia: invia,

    riquadro: riquadro, riquadroPieno: riquadroPieno,
    collocaA: collocaA, ritagliaA: ritagliaA, ritagliato: ritagliato,
    percentuali: percentuali,

    livelli: elenco, seleziona: seleziona, sceltoId: sceltoId, quale: quale,
    rimuovi: rimuovi, muovi: muovi, commutaVisibile: commutaVisibile,
    forme: formeScelte, rigenera: rigenera, nuovo: nuovo,
    istantanea: istantanea, ripristina: ripristina,
    commutaCambioPenna: commutaCambioPenna,

    pause: elencoPause, pauseAutomatiche: pauseAutomatiche,
    commutaPausa: commutaPausa, programmaPronto: programmaPronto,
    svuotaPause: svuotaPause, pausaPossibile: pausaPossibile
  };
})();
