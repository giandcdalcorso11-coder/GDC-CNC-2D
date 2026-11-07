/* Stato centrale dell'applicazione.
 *
 * Un solo oggetto con i dati veri e un minimo sistema di notifiche: i moduli
 * non si chiamano fra loro, scrivono nello stato e ascoltano i cambiamenti.
 * Serve a evitare che, crescendo, ogni pezzo debba conoscere tutti gli altri.
 */
var State = (function () {
  var data = {
    connected: false,
    mock: true,
    host: 'cnc2d.local',

    machine: 'Off',          // Off | Idle | Run | Hold | Alarm
    /* Z0 non è «penna a riposo in basso»: è la POSIZIONE TAPPO, in cima alla
       corsa, perché senza homing FluidNC mette lo zero macchina all'estremo
       alto. È anche lo stato in cui FluidNC si crede appena accesa, quindi
       partire da 0 è giusto per tutt'e tre gli assi. */
    pos: { x: 0, y: 0, z: 0 },

    /* `azzerata` dice se `pos` vuol dire qualcosa. Parte falsa — appena
       collegata nessuno sa dove sono i carrelli — e torna falsa ogni volta che
       i motori vengono liberati, perché da lì in poi l'asse si sposta a mano e
       nessun impulso lo racconta. Torna vera solo con l'homing.
       `motoriLiberi` è lo stato in cui si appoggiano i carrelli ai blocchi: in
       quel momento le frecce non devono funzionare, perché il primo comando di
       movimento riattiverebbe i motori buttando via l'appoggio appena fatto. */
    azzerata: false,
    motoriLiberi: false,

    /* L'area di lavoro è la CORSA PERCORRIBILE dei due assi — totale meno
       margine di sicurezza — non il foglio: resta fissa mentre il foglio
       cambia. Viene dal profilo macchina, che è l'unico posto in cui quei
       numeri si digitano. Il foglio invece è del profilo di stampa. */
    area: Profile.areaUtile(),

    /* I FOGLI SUL PIANO. Dal 2026-11-07 sono un ELENCO e non più uno solo.
     *
     * UN FOGLIO È UN SISTEMA DI RIFERIMENTO, non un rettangolo da disegnare:
     * i livelli hanno il loro posto in coordinate DEL FOGLIO, e `prepare()`
     * passa alle coordinate macchina sommando l'origine del foglio. Finché il
     * foglio era uno, «il sistema di riferimento» e «il foglio» erano la
     * stessa parola e nessuno doveva distinguerli. Con nove magneti sul piano
     * non lo sono più: ogni foglio ha il suo angolo, e un angolo misurato su
     * un foglio NON vale per quello accanto.
     *
     * Dentro a un foglio:
     *   w, h, name, colore   le misure e la carta, come prima
     *   origine              l'angolo in basso a sinistra, in coordinate macchina
     *   misurato             l'angolo è stato misurato sulla macchina (terzo popup)
     *   aggancio             null = sta per conto suo e il suo angolo si misura;
     *                        altrimenti l'id del foglio a cui è ACCOSTATO, e
     *                        allora l'angolo si ricava invece di misurarlo
     *   nomeMio              il nome l'ha scritto l'operatore, non il formato
   *   cartaSua             «questo foglio è di un'altra carta»: la spunta che
     *                        fa misurare l'altezza di contatto a parte
     *   z                    quell'altezza, quando cartaSua è vero
     *
     * `paper`, `sheetOrigin` e `foglioMisurato` qui sotto NON sono più campi:
     * sono VISTE sul foglio attivo. Serve a non dover riscrivere gli otto
     * file che li leggono — una ventina di punti — per una cosa che, con un
     * foglio solo, si comporta esattamente come prima. */
    fogli: [],
    foglioAttivo: null,

    /* A che quota la punta tocca il foglio, in coordinate macchina: un
       numero intorno a −21,27, non intorno a zero. Non sta nel profilo e non è
       una dimenticanza: un decimo di spessore di carta la sposta, e lo spessore
       non lo conosci quando prendi un foglio. Si misura a ogni stampa, col
       secondo popup. `null` = non ancora misurata, e allora si usa il contatto
       nominale del profilo.

       È UNA SOLA PER TUTTI I FOGLI, e di proposito: con nove magneti ritagliati
       dallo stesso cartoncino, misurarla nove volte sarebbe otto gesti per
       sapere otto volte lo stesso numero. Il foglio che fa eccezione lo dice
       con la sua spunta `cartaSua`, e allora ha la sua `z`. */
    altezzaContatto: null,

    art: null,               // il disegno caricato, quando ci sarà
    path: [],                // segmenti del percorso: {x1,y1,x2,y2,draw}
    origin: null,            // origine impostata a mano
    bounds: null,            // area calibrata: {x0,y0,x1,y1}

    scrub: 0,                // 0..1, avanzamento dell'anteprima

    /* Avanzamento della stampa in corso, scritto dal Sender. Sta nello stato
       e non dentro il Sender perché chi lo mostra non deve conoscerlo: la
       barra in alto, i pulsanti e il registro ascoltano `stampa` e basta.
       `stato` vale fermo | invio | pausa | fine | errore. */
    stampa: { stato: 'fermo', nome: '', fatte: 0, totale: 0,
              percento: 0, rimanente: null },

    /* Il telecomando: c'è un indirizzo, ha risposto, e quanta batteria gli
       resta. `visto` falso con `attivo` vero vuol dire «configurato ma non
       raggiungibile», che è uno stato diverso da «non ce l'ho». */
    telecomando: { attivo: false, visto: false, batteria: null }
  };

  /* ---------------------- il foglio attivo, e le viste -------------------
   *
   * CE N'È SEMPRE UNO. Un elenco vuoto non è uno stato in cui questa pagina
   * sappia stare: `paper.w` finirebbe indefinito e il piano disegnerebbe un
   * rettangolo largo NaN. Chi toglie fogli non può togliere l'ultimo, e questa
   * funzione lo dà per buono invece di controllarlo a ogni lettura — viene
   * chiamata centinaia di volte per ridisegno. */
  var seqFoglio = 0;

  function nuovoFoglio(d) {
    d = d || {};
    return {
      id: 'fog' + (++seqFoglio),
      w: +d.w || 148,
      h: +d.h || 210,
      name: d.name || null,
      /* «QUESTO NOME L'HO MESSO IO». Senza, il nome del foglio in uso
         tornerebbe quello del formato al primo ridisegno: `apply()` in
         paper.js lo riscrive da `nomeFormato()` a ogni giro, ed è giusto
         che lo faccia — finché nessuno ha detto il contrario. */
      nomeMio: !!d.nomeMio,
      colore: null,
      origine: { x: d.x === undefined ? 20 : +d.x,
                 y: d.y === undefined ? 20 : +d.y },
      misurato: false,
      aggancio: null,
      cartaSua: false,
      z: null
    };
  }

  function foglio() {
    var l = data.fogli;
    for (var i = 0; i < l.length; i++) {
      if (l[i].id === data.foglioAttivo) return l[i];
    }
    /* L'id attivo che non esiste più è un errore di chi ha tolto un foglio
       senza sceglierne un altro: si rimedia invece di rompersi, perché il
       prezzo di rompersi qui è la pagina bianca. */
    data.foglioAttivo = l[0].id;
    return l[0];
  }

  data.fogli.push(nuovoFoglio({
    w: Profile.stampa().foglio.larghezza,
    h: Profile.stampa().foglio.altezza,
    name: Profile.stampa().foglio.formato
  }));
  data.foglioAttivo = data.fogli[0].id;

  /* `paper` NON è una copia del foglio attivo: è il foglio attivo. Una copia
     andrebbe tenuta d'accordo con l'originale a ogni cambio, e due copie che
     si devono tenere d'accordo sono il modo sicuro per vederle divergere —
     è la stessa regola per cui l'area di lavoro si rilegge dal profilo invece
     di tenerne una seconda copia dentro Paper. */
  Object.defineProperty(data, 'paper', {
    enumerable: true,
    get: foglio
  });

  Object.defineProperty(data, 'sheetOrigin', {
    enumerable: true,
    get: function () { return foglio().origine; },
    set: function (v) { foglio().origine = { x: +v.x, y: +v.y }; }
  });

  /* Vero quando l'angolo di QUESTO foglio è stato misurato sulla macchina,
     col terzo popup. Da quel momento il foglio sullo schermo non è più una
     posizione indicativa che si trascina dove si vuole: è dove sta davvero,
     e trascinarlo vorrebbe dire buttare via la misura senza accorgersene.
     Sta sul foglio e non sulla pagina perché una misura fatta su un foglio
     non dice niente di quello accanto. */
  Object.defineProperty(data, 'foglioMisurato', {
    enumerable: true,
    get: function () { return foglio().misurato; },
    set: function (v) { foglio().misurato = !!v; }
  });

  var listeners = {};

  function on(key, fn) {
    (listeners[key] || (listeners[key] = [])).push(fn);
  }

  function emit(key) {
    var fns = listeners[key] || [];
    for (var i = 0; i < fns.length; i++) fns[i](data);
  }

  function set(key, value) {
    data[key] = value;
    emit(key);
  }

  return { data: data, on: on, set: set, emit: emit,
           foglio: foglio, nuovoFoglio: nuovoFoglio };
})();
