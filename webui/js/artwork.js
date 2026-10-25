/* Il disegno importato: dal file SVG alle polilinee sul foglio, e da lì al
 * G-code ottimizzato.
 *
 * Le polilinee grezze restano in memoria nelle coordinate del file: scala,
 * rotazione e formato del foglio si riapplicano ogni volta a partire da
 * quelle, invece di trasformare il risultato precedente. Trasformare più
 * volte lo stesso dato accumula errori e perde precisione a ogni giro.
 */
var Artwork = (function () {
  var raw = null;      // polilinee nelle coordinate del file
  var prep = null;     // ultimo G-code preparato

  /* DOVE STA IL DISEGNO SUL FOGLIO: {x, y, w, h} in millimetri del foglio,
     angolo in basso a sinistra. E' l'unico posto in cui la collocazione e'
     scritta, e tutto il resto la legge: la scala, il trascinamento e le
     maniglie cambiano questo rettangolo e basta.
     `null` vuol dire «non ancora collocato»: al primo refit nasce centrato
     alla percentuale scritta nel campo. */
  var box = null;

  /* IL RITAGLIO: la finestra su quello che si vede, dentro a `box`.
     È un rettangolo a parte e non una modifica di `box` perché le due cose
     sono diverse: `box` dice quanto è GRANDE il disegno, il ritaglio dice
     quanto se ne VEDE. Tenendoli separati, allargare di nuovo il ritaglio fa
     ricomparire quello che era stato tolto — il disegno non è mai stato
     cancellato, solo nascosto.
     `null` vuol dire «tutto», cioè coincide con box. */
  var ritaglio = null;

  /* I CAMBI PENNA: indici dei tratti PRIMA dei quali fermarsi, in ordine.
     Si tengono come indici e non come coordinate perché il punto di una
     pausa è un confine fra due tratti, non un posto sul foglio: spostando o
     riscalando il disegno la pausa resta fra gli stessi due tratti.

     Vivono qui e non nel G-code perché il G-code si rigenera; e si azzerano
     quando il disegno cambia, perché dopo un riadattamento l'ottimizzatore
     riordina i tratti e l'indice 37 non è più lo stesso tratto. */
  var pause = [];

  /* Quello che serve per ricomporre il programma senza rifare
     l'ottimizzazione: aggiungere o togliere una pausa cambia il file, non il
     percorso, e rifare l'ottimizzazione darebbe lo stesso risultato
     spendendoci sopra del tempo. */
  var ultima = null;

  function load(text, name) {
    raw = SvgImport.parse(text);
    box = null;                 // disegno nuovo, collocazione da rifare
    ritaglio = null;
    State.data.artName = name;
    document.getElementById('file-name').textContent = name;
    document.getElementById('file-info').hidden = false;
    /* Lo sfondo scartato va detto, non taciuto: chi guarda l'anteprima deve
       capire perche' una forma che nel file c'era non viene disegnata. */
    var sc = SvgImport.scartate(), n = sc.sfondi + sc.piene;
    Log.add('msg', 'Importato ' + name + ': ' + raw.length + ' tracciati.' +
            (n ? ' Saltate ' + n + ' forme senza bordo: in un file di linee ' +
                 'sono lo sfondo e i riferimenti, e una penna non riempie.' : ''));
    refit();
  }

  function clear() {
    raw = null;
    prep = null;
    box = null;
    ritaglio = null;
    ultima = null;
    svuotaPause();
    if (window.Selezione) Selezione.chiudi();
    State.data.art = null;
    State.data.artName = null;
    document.getElementById('file-info').hidden = true;
    document.getElementById('prep').hidden = true;
    Paper.rebuildPath();
    Log.add('msg', 'Disegno rimosso: il piano resta con le sole aree.');
  }

  function ruotate() {
    var rot = +document.getElementById('art-rot').value || 0;
    return rot ? rotateAll(raw, rot) : raw;
  }

  /* Rimappa le polilinee grezze dentro al rettangolo corrente. Va richiamata
     quando cambia il rettangolo, la rotazione o il formato del foglio. */
  function refit() {
    if (!raw) return;

    var polys = ruotate();
    var sheet = State.data.paper;
    if (!box) {
      box = SvgImport.fitRect(polys, sheet, +document.getElementById('art-scale').value || 100);
    }
    if (ritaglio) ritaglio = dentroA(ritaglio, box);
    State.data.artBox = box;
    State.data.artRitaglio = ritaglio;

    /* Il diradamento va fatto DOPO la scalatura: una tolleranza di un decimo
       di millimetro ha senso sul foglio, non nelle unità arbitrarie del file,
       che possono valere un millimetro come un metro. */
    /* Il diradamento prima del ritaglio: su meno punti costa meno, e il
       taglio resta comunque esatto sul bordo perché lavora sui segmenti. */
    var mm = SvgImport.simplify(SvgImport.toRect(polys, box), 0.06);
    State.data.art = ritaglio ? SvgImport.ritaglia(mm, ritaglio) : mm;
    prep = null;
    ultima = null;
    svuotaPause();
    document.getElementById('prep').hidden = true;
    Paper.rebuildPath();
    mostraPercentuali();
    if (window.Selezione) Selezione.ridisegna();
  }

  /* --------------- la collocazione, letta e scritta ---------------- */

  /* Il rettangolo che si manipola è quello che si VEDE: senza ritaglio è il
     disegno intero, con ritaglio è la parte rimasta. */
  function riquadro() { return raw ? (ritaglio || box) : null; }

  /* Il disegno intero, anche la parte nascosta: serve al riquadro di
     selezione per mostrare, in chiaro, quanto si sta tenendo fuori. */
  function riquadroPieno() { return raw ? box : null; }

  function ritagliato() { return !!ritaglio; }

  function dentroA(r, c) {
    var x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y);
    var x1 = Math.min(r.x + r.w, c.x + c.w), y1 = Math.min(r.y + r.h, c.y + c.h);
    return { x: x0, y: y0, w: Math.max(0.5, x1 - x0), h: Math.max(0.5, y1 - y0) };
  }

  /* Sposta o ridimensiona QUELLO CHE SI VEDE. Il disegno intero subisce la
     stessa trasformazione, se no il ritaglio scivolerebbe sopra un disegno
     fermo e si vedrebbe un'altra parte invece della stessa più grande. */
  function collocaA(r) {
    if (!raw) return;
    var nuovo = { x: r.x, y: r.y, w: Math.max(2, r.w), h: Math.max(2, r.h) };
    if (!ritaglio) { box = nuovo; refit(); return; }

    var kx = nuovo.w / ritaglio.w, ky = nuovo.h / ritaglio.h;
    box = {
      x: nuovo.x + (box.x - ritaglio.x) * kx,
      y: nuovo.y + (box.y - ritaglio.y) * ky,
      w: box.w * kx,
      h: box.h * ky
    };
    ritaglio = nuovo;
    refit();
  }

  /* IL TAGLIO: cambia solo la finestra, non la taglia del disegno. Per
     questo si può allargare fino a riavere tutto, e non oltre. */
  function ritagliaA(r) {
    if (!raw || !box) return;
    var nuovo = dentroA({ x: r.x, y: r.y, w: Math.max(2, r.w), h: Math.max(2, r.h) }, box);
    var tutto = Math.abs(nuovo.x - box.x) < 0.05 && Math.abs(nuovo.y - box.y) < 0.05 &&
                Math.abs(nuovo.w - box.w) < 0.05 && Math.abs(nuovo.h - box.h) < 0.05;
    ritaglio = tutto ? null : nuovo;
    refit();
  }

  /* Le due percentuali sono il rettangolo detto in un altro modo, non un
     dato a parte: si ricavano ogni volta, così non possono sfasarsi da lui. */
  function percentuali() {
    if (!raw || !box) return null;
    return SvgImport.percentuali(ruotate(), State.data.paper, box);
  }

  function mostraPercentuali() {
    var pc = percentuali();
    var campo = document.getElementById('art-scale');
    var nota = document.getElementById('art-deform');
    if (!pc) { if (nota) nota.hidden = true; return; }

    /* Il campo dice la percentuale in larghezza. Quando l'altezza non
       coincide il disegno è schiacciato, e il campo da solo mentirebbe:
       la differenza va scritta, non nascosta dietro a un numero solo. */
    campo.value = Math.round(pc.x * 10) / 10;
    if (!nota) return;
    var storto = Math.abs(pc.x - pc.y) > 0.2;
    nota.hidden = !storto;
    if (storto) {
      nota.textContent = 'Deformato: larghezza ' + (Math.round(pc.x * 10) / 10) +
                         ' %, altezza ' + (Math.round(pc.y * 10) / 10) +
                         ' %. Scrivi una percentuale qui sopra per tornare in proporzione.';
    }
  }

  /* Scrivere nel campo vuol dire «questa percentuale, in proporzione»: il
     disegno torna regolare ma NON torna al centro. Ricentrarlo butterebbe via
     un trascinamento fatto apposta, e per rimetterlo in mezzo c'è il foglio. */
  function scalaDalCampo() {
    if (!raw) return;
    var pc = +document.getElementById('art-scale').value || 100;
    var nuovo = SvgImport.fitRect(ruotate(), State.data.paper, pc);
    if (box) {
      nuovo.x = box.x + box.w / 2 - nuovo.w / 2;
      nuovo.y = box.y + box.h / 2 - nuovo.h / 2;
      /* Il ritaglio è una finestra sul disegno, quindi va col disegno: si
         riscala con lui attorno allo stesso centro. Lasciandolo fermo
         scoprirebbe un'altra parte invece della stessa, più grande. */
      if (ritaglio) {
        var kx = nuovo.w / box.w, ky = nuovo.h / box.h;
        ritaglio = {
          x: nuovo.x + (ritaglio.x - box.x) * kx,
          y: nuovo.y + (ritaglio.y - box.y) * ky,
          w: ritaglio.w * kx,
          h: ritaglio.h * ky
        };
      }
    }
    box = nuovo;
    refit();
  }

  /* Ruotando cambia la forma dell'ingombro, e un rettangolo pensato per
     l'altro verso schiaccerebbe il disegno senza che nessuno l'abbia chiesto:
     la collocazione riparte da capo, centrata. */
  function ruotaDalCampo() {
    box = null;
    ritaglio = null;
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

  /* ----------------------- preparazione stampa ---------------------- */

  function prepare() {
    var art = State.data.art;
    if (!art || !art.length) { Log.add('err', 'Nessun disegno da preparare.'); return; }

    /* Le velocità e la pausa della penna vengono dal profilo di stampa: sono
       del lavoro, non della macchina, e si cambiano nella tab Impostazioni. */
    var st = Profile.stampa();
    var feedDraw = st.velocitaDisegno, feedTravel = st.velocitaSpostamento;

    var t0 = performance.now();
    var r = Optimize.run(art, feedDraw, feedTravel);
    var ms = Math.round(performance.now() - t0);

    /* Il percorso ottimizzato diventa quello mostrato: l'anteprima deve far
       vedere quello che la macchina farà davvero, non quello che avrebbe
       fatto prima del riordino. */
    State.data.art = r.polys;
    Paper.rebuildPath();

    var o = State.data.sheetOrigin;
    var machine = r.polys.map(function (p) {
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
      r: r,
      ms: ms
    };
    componi();
  }

  /* Ricompone il file dal percorso già ottimizzato. La chiamano prepare() e
     ogni modifica all'elenco delle pause. */
  function componi() {
    if (!ultima) return;
    var opt = {};
    for (var k in ultima.opt) opt[k] = ultima.opt[k];
    opt.pause = pause;
    prep = Gcode.build(ultima.machine, opt);
    showStats(ultima.r, ultima.ms);
    /* Il pulsante del cambio penna si accende solo quando un programma c'è:
       prima di questa riga nasceva spento e ci restava, perche' l'evento del
       percorso parte prima che il file esista. */
    if (window.Preview && Preview.aggiornaPause) Preview.aggiornaPause();
  }

  /* ------------------------ i cambi penna ------------------------- */

  function elencoPause() { return pause.slice(); }

  function programmaPronto() { return !!prep; }

  function svuotaPause() {
    if (!pause.length) return;
    pause = [];
    if (window.Paper && Paper.renderPause) Paper.renderPause();
  }

  /* Una pausa prima del primo tratto non vuol dire niente: la penna giusta la
     si mette nel morsetto prima di partire. */
  function pausaPossibile(k) {
    var art = State.data.art;
    return !!prep && !!art && k >= 1 && k < art.length;
  }

  function commutaPausa(k) {
    if (!pausaPossibile(k)) return false;
    var i = pause.indexOf(k);
    if (i >= 0) pause.splice(i, 1);
    else { pause.push(k); pause.sort(function (a, b) { return a - b; }); }
    componi();
    if (window.Paper && Paper.renderPause) Paper.renderPause();
    Log.add('msg', i >= 0
      ? 'Tolto il cambio penna prima del tratto ' + k + '.'
      : 'Cambio penna prima del tratto ' + k + ': in tutto ' + pause.length + '.');
    return true;
  }

  function showStats(r, ms) {
    var d = r.dopo, p = r.prima;
    document.getElementById('prep').hidden = false;
    document.getElementById('st-time').textContent = Gcode.durata(d.secondi);
    document.getElementById('st-paths').textContent = d.tratti + ' (' + d.punti + ' punti)';
    document.getElementById('st-draw').textContent = Math.round(d.disegno) + ' mm';
    document.getElementById('st-travel').textContent = Math.round(d.spostamento) + ' mm';
    document.getElementById('st-lifts').textContent = d.alzate;

    var risp = p.secondi - d.secondi;
    document.getElementById('st-gain').textContent = risp > 1
      ? 'Ottimizzazione: ' + Gcode.durata(risp) + ' risparmiati, spostamenti da ' +
        Math.round(p.spostamento) + ' a ' + Math.round(d.spostamento) + ' mm, ' +
        'tratti da ' + p.tratti + ' a ' + d.tratti + '. Calcolato in ' + ms + ' ms.'
      : '';

    document.getElementById('gcode-out').value = prep;
    Log.add('msg', 'G-code pronto: ' + prep.split('\n').length + ' righe, ' +
                   Gcode.durata(d.secondi) + ' stimati.');
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

    var sample = document.getElementById('btn-sample');
    if (window.SAMPLE_SVG) {
      sample.addEventListener('click', function () {
        load(window.SAMPLE_SVG, window.SAMPLE_NAME || 'esempio.svg');
      });
    } else {
      sample.hidden = true;
    }

    /* Foglio nuovo, collocazione nuova: il rettangolo di prima era misurato
       su un foglio che non c'è più. */
    State.on('paper', function () { if (raw) { box = null; refit(); } });
  }

  return { init: init, load: load, clear: clear, refit: refit,
           prepare: prepare, invia: invia,
           riquadro: riquadro, riquadroPieno: riquadroPieno,
           collocaA: collocaA, ritagliaA: ritagliaA, ritagliato: ritagliato,
           percentuali: percentuali,
           pause: elencoPause, commutaPausa: commutaPausa,
           programmaPronto: programmaPronto,
           svuotaPause: svuotaPause, pausaPossibile: pausaPossibile };
})();
