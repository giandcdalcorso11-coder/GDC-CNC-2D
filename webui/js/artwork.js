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

  function load(text, name) {
    raw = SvgImport.parse(text);
    State.data.artName = name;
    document.getElementById('file-name').textContent = name;
    document.getElementById('file-info').hidden = false;
    Log.add('msg', 'Importato ' + name + ': ' + raw.length + ' tracciati.');
    refit();
  }

  function clear() {
    raw = null;
    prep = null;
    State.data.art = null;
    State.data.artName = null;
    document.getElementById('file-info').hidden = true;
    document.getElementById('prep').hidden = true;
    Paper.rebuildPath();
    Log.add('msg', 'Disegno rimosso: torna il tracciato di esempio.');
  }

  /* Ricalcola posizione e dimensione sul foglio. Va richiamata quando cambia
     il formato del foglio, la scala o la rotazione. */
  function refit() {
    if (!raw) return;

    var rot = +document.getElementById('art-rot').value || 0;
    var scale = +document.getElementById('art-scale').value || 100;
    var polys = rot ? rotateAll(raw, rot) : raw;

    var sheet = State.data.paper;
    var mm = SvgImport.toSheet(polys, sheet, scale);

    /* Il diradamento va fatto DOPO la scalatura: una tolleranza di un decimo
       di millimetro ha senso sul foglio, non nelle unità arbitrarie del file,
       che possono valere un millimetro come un metro. */
    State.data.art = SvgImport.simplify(mm, 0.06);
    prep = null;
    document.getElementById('prep').hidden = true;
    Paper.rebuildPath();
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

    /* Z è in millimetri veri di penna, e lo zero NON è un numero fisso: è la
       quota a cui la punta tocca il foglio di oggi, misurata col secondo popup
       di inizio stampa. Finché quella misura non c'è si usa zero, che è il
       contatto nominale del profilo — buono per guardare il programma, non per
       stamparlo. */
    var contatto = State.data.altezzaContatto === null ? 0 : State.data.altezzaContatto;

    /* Finché i tre angoli del servo non sono stati rilevati non c'è un'alzata
       vera: si mettono 5 mm per poter guardare il programma, e il file lo
       dichiara DA TARARE. */
    var alzata = Profile.alzataMm();
    var tarata = alzata !== null;
    if (alzata === null) alzata = 5;
    if (st.alzataLavoro !== null && st.alzataLavoro > 0) {
      alzata = Math.min(alzata, st.alzataLavoro);
    }

    prep = Gcode.build(machine, {
      penUp: contatto + alzata,
      penDown: contatto,
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

  /* L'invio alla macchina non è ancora costruito, e preferisco dirlo invece di
     far finta: FluidNC vuole il file caricato sul suo filesystem e poi avviato,
     non tremila righe sparate una per una sulla rotta dei comandi. Il programma
     però è pronto e scaricabile, quindi la procedura non si butta via. */
  function invia() {
    if (!prep) { Log.add('err', 'Nessun programma preparato.'); return; }
    if (State.data.mock) {
      Log.add('msg', 'Modalità finta: il programma non viene inviato a nessuno. ' +
                     'Sarebbe partito adesso, ' + prep.split('\n').length + ' righe.');
      return;
    }
    Log.add('err', 'L\'invio del programma alla macchina non è ancora costruito. ' +
                   'Le tre misure sono state prese e il G-code è rigenerato con ' +
                   'quelle: scaricalo e caricalo a mano dalla pagina di FluidNC.');
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
    ['art-scale', 'art-rot'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', refit);
    });
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

    State.on('paper', function () { if (raw) refit(); });
  }

  return { init: init, load: load, clear: clear, refit: refit,
           prepare: prepare, invia: invia };
})();
