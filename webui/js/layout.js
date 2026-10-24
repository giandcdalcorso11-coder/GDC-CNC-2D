/* Le due colonne laterali si allargano e si stringono trascinando.
 *
 * La larghezza non vive in JavaScript: vive in due variabili CSS,
 * `--sidebar-w` e `--scrub-w`, che la griglia della pagina usa già come
 * larghezze di colonna. Questo modulo non fa altro che cambiarle. Conseguenza
 * utile: non c'è nessuna dimensione calcolata a mano, nessun `style.width`
 * scritto su un elemento, e tutto quello che dentro quelle colonne si adatta
 * alla larghezza continua a farlo da solo.
 *
 * PERCHÉ NON STA NEL PROFILO. Il profilo descrive la MACCHINA — corse, angoli
 * del servo, rapporto — ed è la cosa che si esporta, si committa e si rimette
 * su un altro computer. Quanto è larga una colonna sullo schermo di chi
 * guarda non è un dato della macchina: viaggiarsi dietro la larghezza di una
 * barra laterale dentro un profilo di taratura sarebbe sbagliato il giorno in
 * cui quel profilo lo apre qualcun altro. Sta in una chiave sua.
 */
var Layout = (function () {

  var KEY = 'gdc.cnc2d.layout';

  /* I due estremi non sono gusto personale: sotto il minimo i campi a due
     colonne non ci stanno più nemmeno impilati, sopra il massimo la colonna si
     mangia il piano, che è la cosa per cui la pagina esiste. */
  var LIMITI = {
    '--sidebar-w': { min: 180, max: 520, start: 268 },
    '--scrub-w':   { min: 90,  max: 360, start: 150 }
  };

  var radice = document.documentElement;

  function leggi(nome) {
    var v = parseFloat(getComputedStyle(radice).getPropertyValue(nome));
    return isNaN(v) ? LIMITI[nome].start : v;
  }

  function scrivi(nome, px) {
    var l = LIMITI[nome];
    px = Math.max(l.min, Math.min(l.max, Math.round(px)));
    radice.style.setProperty(nome, px + 'px');
    return px;
  }

  function salva() {
    try {
      var o = {};
      for (var k in LIMITI) o[k] = leggi(k);
      window.localStorage.setItem(KEY, JSON.stringify(o));
    } catch (e) {
      /* Finestra anonima, dati di sito bloccati: la pagina funziona lo stesso,
         solo che la prossima volta riparte dalle larghezze di fabbrica. Non
         vale un messaggio d'errore. */
    }
  }

  function carica() {
    try {
      var o = JSON.parse(window.localStorage.getItem(KEY) || '{}');
      for (var k in LIMITI) {
        if (typeof o[k] === 'number') scrivi(k, o[k]);
      }
    } catch (e) { /* come sopra */ }
  }

  /* Il verso: il manico di sinistra allarga la colonna spostandosi a destra,
     quello di destra fa il contrario. È l'unico pezzo di geometria qui dentro,
     ed è un segno. */
  function manico(el) {
    var nome = el.dataset.var;
    var verso = +el.dataset.verso;
    var partenza = null;

    el.addEventListener('pointerdown', function (e) {
      partenza = { x: e.clientX, w: leggi(nome) };
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-trascinato');
      document.body.classList.add('sta-ridimensionando');
      e.preventDefault();
    });

    el.addEventListener('pointermove', function (e) {
      if (!partenza) return;
      scrivi(nome, partenza.w + (e.clientX - partenza.x) * verso);
    });

    ['pointerup', 'pointercancel'].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        if (!partenza) return;
        partenza = null;
        el.classList.remove('is-trascinato');
        document.body.classList.remove('sta-ridimensionando');
        el.releasePointerCapture(e.pointerId);
        salva();
      });
    });

    /* Doppio clic: si torna alla larghezza di partenza. Una via di ritorno
       serve, perché stringendo troppo si arriva a non vedere più il manico
       che si sta cercando. */
    el.addEventListener('dblclick', function () {
      scrivi(nome, LIMITI[nome].start);
      salva();
    });
  }

  function init() {
    carica();
    var mani = document.querySelectorAll('.hmanico');
    for (var i = 0; i < mani.length; i++) manico(mani[i]);
  }

  return { init: init, leggi: leggi, scrivi: scrivi };
})();
