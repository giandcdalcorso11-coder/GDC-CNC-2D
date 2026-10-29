/* Generazione del G-code.
 *
 * Le coordinate emesse sono quelle della macchina: origine dove l'hai
 * impostata a mano con G92, asse Y verso l'alto. Il file NON contiene un G92:
 * l'origine la decide l'operatore prima di stampare, e un G92 nel programma
 * la sovrascriverebbe azzerando dove capita.
 *
 * Z È NEGATIVA, e non per gusto: senza homing FluidNC mette lo zero macchina
 * in cima alla corsa del servo e dichiara il resto in negativo. Z0 è la
 * posizione tappo, Z-18,33 l'alzata di lavoro, Z-21,27 la punta sul foglio.
 * Le quote arrivano già così da chi chiama build(); il perché sta in
 * profile.js, sopra zDaGradi().
 */
var Gcode = (function () {

  /* La riga che segna un cambio penna. È un commento, quindi la macchina non
     la vedrebbe nemmeno: a riconoscerla è il Sender, che a quel punto smette
     di alimentare e porta la testina dove si può cambiare la penna. Tenerla
     come commento vuol dire che il file resta eseguibile anche da chi di
     queste pause non sa niente — lo esegue tutto di fila, senza fermarsi.
     Chi la riconosce è sender.js, con RE_PAUSA: là si accetta anche «; PAUSA»
     scritto a mano, qui si emette sempre nella forma stretta. */
  var SEGNO_PAUSA = ';PAUSA';

  /* LA RIGA CHE DICE QUALE PENNA. Come quella della pausa è un commento, e
     per lo stesso motivo: il file resta eseguibile da chiunque, che la
     ignora. La legge il Sender, che da lì sa qual è la penna montata in
     ogni momento — un dato che altrimenti esiste solo nella pagina e non
     sopravvive a un file salvato e riaperto un altro giorno.
     Viene PRIMA della pausa, non dopo: al cambio penna il Sender si ferma
     sul segno di pausa e non legge più niente, quindi un colore scritto
     dopo arriverebbe solo alla ripresa, cioè quando non serve più. Scritto
     prima, al momento della domanda «quale monto?» la risposta è già lì.
     Forma: «;PENNA <colore> <nome del livello>», e il colore è un trattino
     quando il livello non ne ha uno — disegnato a mano, non importato. */
  var SEGNO_PENNA = ';PENNA';

  /* Zeri in coda tolti: "93.000" diventa "93". Non si perde niente — un passo
     del motore vale 0,0295 mm, quindi il millesimo è già tre volte più fine di
     quanto la macchina sappia fare. */
  function n(v) {
    return (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  }

  /* Il punto home con il valore di riserva, in un posto solo: lo usano
     l'intestazione e il movimento finale, e devono dire la stessa cosa. */
  function casa0(opt) { return opt.ritorno || { x: 0, y: 0 }; }

  function build(polys, opt) {
    var L = [];
    var zUp = opt.penUp, zDown = opt.penDown;

    /* Prima di quali tratti fermarsi a cambiare penna. Si ferma SEMPRE al
       confine fra due tratti, mai a metà di uno: lì il programma ha già
       fatto alza → sposta → abbassa, quindi alla ripresa non c'è nessuno
       stato da ricostruire, e cambiare penna con la punta appoggiata
       lascerebbe comunque una macchia. */
    var pausaA = {};
    (opt.pause || []).forEach(function (k) { pausaA[k] = true; });
    var penneA = {};
    (opt.penne || []).forEach(function (p) {
      /* Niente «;» e niente a capo nel nome: finirebbero per troncare la
         riga o per farne due, e il nome lo scrive chi carica il file. */
      penneA[p.i] = (p.colore || '-') + ' ' +
                    String(p.nome || '').replace(/[;\r\n]+/g, ' ').trim();
    });

    /* Il programma deve stare nella flash dell'ESP32, e dopo FluidNC e la
       WebUI restano ~64 kB. Si recupera sfruttando la modalità del G-code,
       che non è un trucco ma il modo in cui il linguaggio è fatto: si emette
       solo quello che CAMBIA.
         - la parola di movimento (G0/G1) resta valida fino a quando non cambia;
         - una coordinata non ripetuta vuol dire "quell'asse resta dov'è";
         - lo stesso vale per F.
       Una riga che non cambierebbe niente non si emette affatto: un G1 su un
       punto identico al precedente è, oltre che inutile, il caso che FluidNC
       ha dovuto correggere nella 4.1.1. */
    var modo = null, ux = null, uy = null, uz = null, uf = null;
    function muovi(g, x, y, z, f) {
      /* Prima la parte di MOVIMENTO: la parola G e i soli assi che cambiano. */
      var mov = '';
      if (g !== modo) mov += g;
      if (x !== null && n(x) !== ux) mov += (mov ? ' ' : '') + 'X' + n(x);
      if (y !== null && n(y) !== uy) mov += (mov ? ' ' : '') + 'Y' + n(y);
      if (z !== null && n(z) !== uz) mov += (mov ? ' ' : '') + 'Z' + n(z);
      /* Se non si muove niente non si emette NIENTE, nemmeno la F. Succede
         quando un tratto comincia dove finisce il precedente: lo spostamento
         a penna alzata è un no-op e resterebbe la sola velocità, una riga che
         non muove la macchina e la cui F viene ridichiarata dal movimento
         vero subito dopo. Lo stato modale della F NON si aggiorna: se no la
         prossima F verrebbe omessa credendola già attiva. */
      if (!mov) return;
      modo = g;
      if (x !== null) ux = n(x);
      if (y !== null) uy = n(y);
      if (z !== null) uz = n(z);
      if (f !== null && String(f) !== uf) { mov += ' F' + f; uf = String(f); }
      L.push(mov);
    }
    /* Quota a cui la penna sale a programma finito: lascia spazio per
       infilare il tappo senza togliere la penna dai morsetti. È il fine corsa
       alto, Z0, quindi sta sopra l'alzata di lavoro che è negativa. Se il
       profilo non ce l'ha si resta all'alzata, che è il comportamento di
       prima. */
    var zTappo = (typeof opt.penTappo === 'number' && opt.penTappo > zUp)
      ? opt.penTappo : zUp;

    /* La pausa dopo ogni su/giù non è un lusso: il servo ci mette un pezzo ad
       arrivare, e senza attesa la macchina riparte mentre la penna sta ancora
       scendendo — a 50 mm/s si sbavano quattro millimetri di tratto. Il numero
       sta nel profilo di stampa. */
    var attesa = opt.pausaMs > 0 ? 'G4 P' + (opt.pausaMs / 1000).toFixed(3) : null;

    L.push('; GDC CNC 2D SLICER');
    L.push('; ' + polys.length + ' tratti, generato dall\'interfaccia');
    if (opt.pause && opt.pause.length) {
      L.push('; ' + opt.pause.length + ' cambi penna, segnati con «' +
             SEGNO_PAUSA + '»: li riconosce il Sender, la macchina no');
    }
    L.push('; penna alzata Z' + n(zUp) + ', abbassata Z' + n(zDown) +
           (opt.pennaTarata ? '' : ' - DA TARARE'));
    if (zTappo > zUp) L.push('; a fine programma la penna sale a Z' + n(zTappo) + ' (tappo)');
    L.push('; a fine programma la testina torna al punto home X' + n(casa0(opt).x) +
           ' Y' + n(casa0(opt).y) + ', non sullo zero ai blocchi');
    L.push('G21');            // millimetri
    L.push('G90');            // coordinate assolute
    muovi('G0', null, null, zUp, null);   // si parte a penna alzata, sempre

    for (var i = 0; i < polys.length; i++) {
      var p = polys[i];

      if (penneA[i]) L.push(SEGNO_PENNA + ' ' + penneA[i]);

      if (pausaA[i]) {
        L.push(SEGNO_PAUSA);
        /* DOPO UNA PAUSA LA TESTINA NON È PIÙ DOVE IL PROGRAMMA CREDE: il
           Sender la porta al punto home perché la penna si possa cambiare.
           Quindi lo stato modale va azzerato, e il movimento che segue
           ridichiara tutto — G, X, Y, Z e F.
           Senza questo una riga come «X120», che in G-code significa «Y
           resta dov'è», riprenderebbe da una Y che nel frattempo è cambiata,
           e il disegno proseguirebbe a qualche centimetro di distanza. */
        modo = null; ux = null; uy = null; uz = null; uf = null;
      }

      muovi('G0', p[0].x, p[0].y, null, opt.feedTravel);
      muovi('G1', null, null, zDown, opt.feedPen);
      if (attesa) L.push(attesa);
      for (var j = 1; j < p.length; j++) {
        muovi('G1', p[j].x, p[j].y, null, j === 1 ? opt.feedDraw : null);
      }
      muovi('G0', null, null, zUp, null);
      if (attesa) L.push(attesa);
    }

    /* Si torna al PUNTO HOME, non sullo zero. Lo zero è il punto ai blocchi:
       finirci sopra vuol dire lasciare i carrelli appoggiati al riferimento,
       e un carrello fermo contro il riferimento prima o poi lo sposta. Il
       punto home sta cinque millimetri dentro, ed è anche la condizione da
       cui il gioco della cremagliera è preso sempre dalla stessa parte. */
    var casa = casa0(opt);
    muovi('G0', casa.x, casa.y, null, opt.feedTravel);
    /* Ultimo movimento: la penna in alto, dove ci sta il tappo. Va DOPO il
       ritorno al punto home, non prima: così la testina è già ferma in un
       angolo quando ci arrivi con il tappo in mano. */
    if (zTappo > zUp) muovi('G0', null, null, zTappo, null);
    L.push('M2');             // fine programma
    return L.join('\n') + '\n';
  }

  function durata(sec) {
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (m < 60) return m + ' min ' + ('0' + s).slice(-2) + ' s';
    return Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) + ' min';
  }

  return { build: build, durata: durata, SEGNO_PAUSA: SEGNO_PAUSA };
})();
