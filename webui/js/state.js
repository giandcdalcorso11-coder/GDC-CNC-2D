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
    paper: { w: Profile.stampa().foglio.larghezza,
             h: Profile.stampa().foglio.altezza,
             name: Profile.stampa().foglio.formato },
    sheetOrigin: { x: 20, y: 20 },   // angolo in basso a sinistra del foglio

    /* A che quota la punta tocca QUESTO foglio, in coordinate macchina: un
       numero intorno a −21,27, non intorno a zero. Non sta nel profilo e non è
       una dimenticanza: un decimo di spessore di carta la sposta, e lo spessore
       non lo conosci quando prendi un foglio. Si misura a ogni stampa, col
       secondo popup. `null` = non ancora misurata, e allora si usa il contatto
       nominale del profilo. */
    altezzaContatto: null,

    /* Vero quando l'angolo del foglio è stato MISURATO sulla macchina, col
       terzo popup. Da quel momento il foglio sullo schermo non è più una
       posizione indicativa che si trascina dove si vuole: è dove sta davvero,
       e trascinarlo vorrebbe dire buttare via la misura senza accorgersene.
       Per questo si blocca, e per sbloccarlo bisogna dire esplicitamente che
       la misura non vale più. */
    foglioMisurato: false,

    art: null,               // il disegno caricato, quando ci sarà
    path: [],                // segmenti del percorso: {x1,y1,x2,y2,draw}
    origin: null,            // origine impostata a mano
    bounds: null,            // area calibrata: {x0,y0,x1,y1}

    scrub: 0                 // 0..1, avanzamento dell'anteprima
  };

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

  return { data: data, on: on, set: set, emit: emit };
})();
