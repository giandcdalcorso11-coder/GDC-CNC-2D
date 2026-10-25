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

  function load(text, name) {
    raw = SvgImport.parse(text);
    box = null;                 // disegno nuovo, collocazione da rifare
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
    State.data.artBox = box;

    /* Il diradamento va fatto DOPO la scalatura: una tolleranza di un decimo
       di millimetro ha senso sul foglio, non nelle unità arbitrarie del file,
       che possono valere un millimetro come un metro. */
    State.data.art = SvgImport.simplify(SvgImport.toRect(polys, box), 0.06);
    prep = null;
    document.getElementById('prep').hidden = true;
    Paper.rebuildPath();
    mostraPercentuali();
    if (window.Selezione) Selezione.ridisegna();
  }

  /* --------------- la collocazione, letta e scritta ---------------- */

  function riquadro() { return raw ? box : null; }

  function collocaA(r) {
    if (!raw) return;
    box = { x: r.x, y: r.y, w: Math.max(2, r.w), h: Math.max(2, r.h) };
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
    }
    box = nuovo;
    refit();
  }

  /* Ruotando cambia la forma dell'ingombro, e un rettangolo pensato per
     l'altro verso schiaccerebbe il disegno senza che nessuno l'abbia chiesto:
     la collocazione riparte da capo, centrata. */
  function ruotaDalCampo() {
    box = null;
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

    prep = Gcode.build(machine, {
      penUp: contatto + alzata,
      penDown: contatto,
      penTappo: tappo,
      ritorno: Profile.puntoHome(),
      pennaTarata: tarata,
      pausaMs: st.pausaPennaMs,
      feedDraw: feedDraw,
      feedTravel: feedTravel,
      feedPen: 600
    });

    showStats(r, ms);
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
           riquadro: riquadro, collocaA: collocaA, percentuali: percentuali };
})();
