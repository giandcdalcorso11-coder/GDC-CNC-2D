/* Il pannello di controllo manuale.
 *
 * Scritto una volta e mostrato in più posti: una tab dedicata per le sessioni
 * di misura, la barra laterale della tab Disegno, e — quando ci saranno — i tre
 * popup di inizio stampa. Due copie dello stesso pannello divergono: una
 * impara a fare una cosa e l'altra no, e te ne accorgi col foglio rovinato.
 *
 * Per questo non usa `id` ma classi, e tiene i riferimenti nell'istanza:
 * possono essercene tre vivi nella stessa pagina.
 *
 * Senza finecorsa questo pannello non è una comodità, è l'UNICO modo di dare
 * un'origine alla macchina. Da qui passano anche tutte le misure di taratura.
 */
var Panel = (function () {

  var istanze = [];

  /* Quanto si muove un click sulle frecce. Il passo resta esplicito e visibile,
     mai implicito: su una macchina senza azzeramento automatico, 50 mm dati per
     sbaglio vicino a fine corsa mandano il carrello in battuta. */
  var PASSI = [0.1, 1, 10, 50];

  /* Le otto direzioni del tastierino, in ordine di lettura. I due numeri sono
     i segni di X e Y: la griglia CSS li mette al loro posto, quindi l'ordine
     qui non conta per il risultato ma conta per chi legge il codice. */
  var DIR = [
    ['NO', -1,  1, '&#8598;'], ['N',  0,  1, '&uarr;'],  ['NE',  1,  1, '&#8599;'],
    ['O',  -1,  0, '&larr;'],                            ['E',   1,  0, '&rarr;'],
    ['SO', -1, -1, '&#8601;'], ['S',  0, -1, '&darr;'],  ['SE',  1, -1, '&#8600;']
  ];

  /* Le tre quote della penna, dall'alto in basso come stanno nella realtà.
     Il segno grafico è una tacca su una guida verticale: dice a che altezza
     si va senza doverlo leggere, e si disegna in CSS invece di affidarsi a un
     carattere speciale che poi su un browser non c'è. */
  var QUOTE = [
    ['tappo',    'Tappo',    'h-top', -5],
    ['alzata',   'Alzata',   'h-mid',  0],
    ['contatto', 'Contatto', 'h-low',  5]
  ];

  function markup(sez) {
    var h = '<div class="pm">';

    if (sez.posizione) {
      h += '<div class="pm-dro">' +
           rigaAsse('x', 'X — trave del portale') +
           rigaAsse('y', 'Y — rotaie di base') +
           rigaAsse('z', 'Z — penna') +
           '</div>';
    }

    if (sez.homing) {
      h += '<div class="pm-sez">' +
           '<div class="btn-row">' +
           '<button class="btn btn-small pm-free">Libera i motori</button>' +
           '<button class="btn btn-small btn-primary pm-homed">Homing completato</button>' +
           '</div>' +
           '<p class="muted small pm-nota-home"></p>' +
           '</div>';
    }

    if (sez.assi) {
      h += '<div class="pm-sez">' + tastierino() +

           '<p class="muted small pm-lab">mm di spostamento con un click</p>' +
           '<div class="step-row">';
      /* Ogni pulsante porta nel suggerimento quanto si muove DAVVERO. Un passo
         del motore vale 0,0295 mm, quindi i millimetri tondi quasi mai sono un
         numero intero di passi: 0,1 mm sono 3,4 passi, la macchina ne fa 3, e
         il movimento vero è 0,088 — il 12% in meno di quello che c'è scritto
         sopra. Sugli altri tre lo scarto sta sotto i quindici micron. */
      for (var i = 0; i < PASSI.length; i++) {
        h += '<button class="btn btn-ghost btn-small pm-step' +
             (PASSI[i] === 1 ? ' is-active' : '') + '" data-pm-step="' + PASSI[i] +
             '" title="' + veroPasso(PASSI[i]) + '">' +
             String(PASSI[i]).replace('.', ',') + '</button>';
      }
      /* Il quinto posto non è un pulsante ma un campo: i quattro valori fissi
         coprono i casi di tutti i giorni, questo copre quello che non avevamo
         previsto. Si comporta come gli altri — scrivendoci dentro diventa lui
         il passo attivo, e gli altri si spengono. */
      h += '<input type="number" class="pm-step-free" min="0" step="0.1" ' +
           'placeholder="altro" title="Un passo qualsiasi, in millimetri">';
      h += '</div>' + vaiAlPunto() + '</div>';
    }

    if (sez.penna) {
      h += '<div class="pm-sez pm-pen">' +
           '<div class="btn-row">' +
           '<button class="btn btn-small pm-pen-up">Alza</button>' +
           '<button class="btn btn-small pm-pen-down">Abbassa</button>' +
           '</div>' +
           '<div class="step-row"><button class="btn btn-ghost btn-small pm-pen-step" ' +
           'data-pm-pen="-0.2">&minus;0,2</button>' +
           '<button class="btn btn-ghost btn-small pm-pen-step" data-pm-pen="0.2">+0,2</button>' +
           '<span class="muted small">mm di penna</span></div>' +
           '<p class="muted small pm-nota-pen"></p>' +
           '</div>';
    }

    return h + '</div>';
  }

  /* I CINQUE PUNTI CHE SI RAGGIUNGONO CON UN CLICK.
     Quattro sono i PUNTI LIMITE DELLA CORSA, e non hanno niente a che fare
     col foglio: si premono per vedere DOVE ARRIVA LA MACCHINA, e la macchina
     arriva dove arriva anche quando sul piano non c'è nessun foglio. Stanno
     sul giro esterno, ognuno dalla parte sua: quello in alto a destra sta in
     alto a destra del tastierino. La posizione È l'informazione — come il
     pallino nel rettangolino e come le tacche delle quote — e un pulsante
     messo dove uno lo cercherebbe non ha bisogno di essere letto.
     Il quinto è il punto home, che limite non è: sta dentro, in cima al
     quadrato di mezzo, con la sua casetta e non un rettangolino.

     Dentro ai rettangolini ci sono le coordinate. Un disegno dice DOVE si
     va, un numero dice A QUANTI MILLIMETRI, e prima di mandare un carrello
     da qualche parte servono tutt'e due.

     IL PALLINO NON STA SULLO SPIGOLO ma appena dentro, perché appena dentro
     è dove si va: vedi ORLO qui sotto. */
  var VAI = [
    ['as',   'Punto limite in alto a sinistra',  [ 4.5,  4.5]],
    ['ad',   'Punto limite in alto a destra',    [35.5,  4.5]],
    ['bs',   'Punto limite in basso a sinistra', [ 4.5, 27.5]],
    ['bd',   'Punto limite in basso a destra',   [35.5, 27.5]],
    ['home', 'Punto home',                        null]
  ];

  function nomeVai(k) {
    for (var i = 0; i < VAI.length; i++) if (VAI[i][0] === k) return VAI[i][1];
    return k;
  }

  /* IL BORDO DI RISPETTO DEL MOVIMENTO A MANO.
   *
   * Un millimetro dentro al confine della corsa, su tutti e quattro i lati.
   * Non è prudenza generica: il confine è il punto in cui il pignone arriva
   * in fondo alla cremagliera, e qui non c'è nessun finecorsa che lo fermi —
   * quando si scappa, si scappa a mano e si rimonta a mano. Un millimetro è
   * trentaquattro passi di motore: abbastanza da non arrivarci per
   * arrotondamento, abbastanza poco da non togliere area utile che serva.
   *
   * Vale per il movimento A MANO di questo pannello: i quattro punti limite
   * ci si appoggiano sopra, e le frecce non lo scavalcano. NON vale per la
   * stampa, che ha il suo margine di sicurezza nel profilo macchina e viene
   * controllata da Profile.stanoDentro: sono due cose diverse, e confonderle
   * vorrebbe dire togliere due volte lo stesso millimetro.
   */
  var ORLO = 1;

  function limiti() {
    return {
      x0: ORLO, y0: ORLO,
      x1: Profile.corsaPercorribile('x') - ORLO,
      y1: Profile.corsaPercorribile('y') - ORLO
    };
  }

  /* Di quanto un numero sta fuori da un intervallo. Zero vuol dire dentro. */
  function fuoriDa(v, a, b) { return v < a ? a - v : v > b ? v - b : 0; }

  /* DOVE SI VA, in coordinate macchina. I quattro angoli del rettangolo
     percorribile, rientrati di ORLO. Il foglio non c'entra: questi pulsanti
     dicono dove finisce la MACCHINA.
     Null se la corsa è talmente corta che il bordo di rispetto se la mangia
     tutta — un profilo non ancora misurato — perché lì non c'è nessun punto
     dove andare. */
  function puntoVai(k) {
    if (k === 'home') return Profile.puntoHome();
    var L = limiti();
    if (!(L.x1 >= L.x0) || !(L.y1 >= L.y0)) return null;
    if (k === 'bs') return { x: L.x0, y: L.y0 };
    if (k === 'bd') return { x: L.x1, y: L.y0 };
    if (k === 'ad') return { x: L.x1, y: L.y1 };
    if (k === 'as') return { x: L.x0, y: L.y1 };
    return null;
  }

  function segnoVai(v) {
    if (!v[2]) {
      /* La stessa casetta del piano, con la y ribaltata: lì il gruppo è
         girato e «in su» è +y, qui si è in una pagina e la y va in giù. */
      return '<svg class="ico-casa" viewBox="-9 -2 18 16" aria-hidden="true">' +
             '<polyline points="-7,7 0,0 7,7"></polyline>' +
             '<rect x="-5" y="6" width="10" height="6"></rect>' +
             '<rect x="-1.6" y="8.6" width="3.2" height="3.4"></rect></svg>';
    }
    /* I DUE NUMERI PORTANO IL NOME DELL'ASSE. Erano due cifre incolonnate,
       e due cifre incolonnate non dicono quale delle due è la X: si poteva
       solo indovinarlo dall'ordine. La lettera sta a sinistra, piccola, e il
       numero a destra, dove si legge un numero. */
    return '<svg class="ico-area" viewBox="0 0 40 32" aria-hidden="true">' +
           '<rect x="2.5" y="2.5" width="35" height="27"></rect>' +
           '<text class="vn" x="6" y="15">X</text>' +
           '<text class="vx" x="34.5" y="15">—</text>' +
           '<text class="vn" x="6" y="26">Y</text>' +
           '<text class="vy" x="34.5" y="26">—</text>' +
           '<circle class="pt" cx="' + v[2][0] + '" cy="' + v[2][1] +
           '" r="3.4"></circle></svg>';
  }

  /* IL SEGNO DELLE TRE QUOTE: una penna stilizzata e la riga del piano.
     Prima era una tacca su una guida verticale, che diceva l'altezza ma non
     diceva di CHE COSA: si capiva solo sapendolo già. Una punta che scende
     verso una riga lo dice da sé.
     Il numero è lo scostamento in verticale: a contatto la punta tocca la
     riga, alzata le sta sopra di cinque, al tappo di dieci. Le proporzioni
     non sono quelle vere — tre millimetri di alzata su venti di corsa non si
     vedrebbero — ma l'ORDINE sì, ed è quello che serve. */
  function segnoQuota(dy) {
    return '<svg class="ico-pen" viewBox="0 -4 24 30" aria-hidden="true">' +
           '<g transform="translate(0,' + dy + ')">' +
           '<rect class="corpo" x="8.5" y="1" width="7" height="11"></rect>' +
           '<path class="punta" d="M8.5 12 L12 18 L15.5 12 Z"></path>' +
           '</g>' +
           '<line class="piano" x1="1.5" y1="23" x2="22.5" y2="23"></line></svg>';
  }

  /* IL TASTIERINO: QUADRATI CONCENTRICI.
   *
   * Cinque colonne per cinque righe di caselle quadrate, e dentro, al centro
   * esatto, un quadrato di tre per tre. Il giro di fuori porta il movimento —
   * le otto frecce e i quattro angoli del foglio —, il quadrato di dentro
   * porta la penna, con il punto home e lo STOP sopra di lei.
   *
   * Prima era cinque per sei: il blocco di mezzo aveva quattro righe perché
   * ci stavano dentro anche i quattro angoli, e tutto l'insieme veniva più
   * alto che largo, con le cornici che non erano né concentriche né quadrate.
   * Spostando i quattro angoli sul giro — dove per di più stanno dalla parte
   * giusta, l'angolo in alto a destra in alto a destra — al centro restano
   * tre righe, e la geometria si chiude: un quadrato dentro un quadrato,
   * stesso centro, stesso passo, stesso vuoto.
   *
   * Le quattro caselle libere del giro (sopra e sotto, fuori asse) restano
   * vuote per davvero: sono il respiro della croce, ed è così che si guarda
   * un tastierino senza contare i pulsanti.
   */
  function tastierino() {
    var h = '<div class="jog-pad">';
    for (var i = 0; i < DIR.length; i++) {
      h += '<button class="btn btn-jog" data-pm-jog="' + DIR[i][0] + '" ' +
           'data-pm-dx="' + DIR[i][1] + '" data-pm-dy="' + DIR[i][2] + '">' +
           DIR[i][3] + '</button>';
    }

    /* I quattro angoli del foglio, sul giro. Il punto home no: non è un
       punto limite, e sta dentro. */
    for (var v = 0; v < VAI.length; v++) {
      if (VAI[v][0] === 'home') continue;
      h += '<button class="btn btn-jog pm-vai" data-pm-vai="' + VAI[v][0] +
           '" title="' + VAI[v][1] + '">' + segnoVai(VAI[v]) + '</button>';
    }

    h += '<div class="jog-mid">' +
         '<i class="jog-cornice jog-c-cima"></i>' +
         '<i class="jog-cornice jog-c-pen"></i>' +
         '<button class="btn btn-jog pm-vai" data-pm-vai="home" title="Punto home">' +
         segnoVai(VAI[4]) + '</button>' +
         '<button class="btn btn-ghost btn-stop pm-stop" ' +
         'title="Ferma il movimento in corso">STOP</button>';

    for (var q = 0; q < QUOTE.length; q++) {
      /* Il nome sta in uno span suo perché in una casella stretta va tolto:
         meglio il solo disegno, che si capisce, che «Contatto» tagliato a
         «Cont», che non si capisce. Il titolo resta e lo dice per esteso. */
      h += '<button class="btn btn-ghost pm-h" data-pm-h="' + QUOTE[q][0] +
           '" title="Penna alla quota ' + QUOTE[q][1].toLowerCase() + '">' +
           segnoQuota(QUOTE[q][3]) +
           '<span class="pm-h-nome">' + QUOTE[q][1] + '</span></button>';
    }

    /* Le due frecce da un grado stanno sotto alla quota che somigliano: «su»
       sotto al tappo, che è la quota in alto, «giù» sotto al contatto, che è
       quella in basso. */
    h += '<button class="btn btn-ghost pm-deg" data-pm-deg="1" ' +
         'title="Alza la penna di un grado di servo">&uarr;1&deg;</button>' +
         '<button class="btn btn-ghost pm-deg" data-pm-deg="-1" ' +
         'title="Abbassa la penna di un grado di servo">&darr;1&deg;</button>' +
         '<button class="btn btn-ghost jog-vuoto" data-jog-vuoto="1" disabled ' +
         'tabindex="-1" aria-hidden="true"></button>' +
         '<button class="btn btn-ghost jog-vuoto" data-jog-vuoto="2" disabled ' +
         'tabindex="-1" aria-hidden="true"></button>';

    return h + '</div></div>';
  }

  /* Andare a un punto scrivendolo. Le frecce servono a cercare, questo a
     tornare: un punto misurato una volta si raggiunge di nuovo senza contare
     i click. I campi si svuotano quando la macchina È ARRIVATA, non quando il
     comando è stato accettato — sono due momenti diversi, e il secondo
     arriverebbe mentre i carrelli sono ancora per strada. */
  function vaiAlPunto() {
    return '<div class="pm-goto">' +
           '<label class="pm-goto-f">X<input type="number" class="pm-goto-x" ' +
           'step="0.1" placeholder="mm"></label>' +
           '<label class="pm-goto-f">Y<input type="number" class="pm-goto-y" ' +
           'step="0.1" placeholder="mm"></label>' +
           '<button class="btn btn-small pm-goto-go">Vai al punto</button>' +
           '</div><p class="muted small pm-goto-nota"></p>';
  }

  /* Quanto si muove davvero un passo chiesto, in parole. */
  function veroPasso(mm) {
    var spm = Profile.passiPerMm('x');
    var passi = Math.round(mm * spm);
    var vero = passi / spm;
    var scarto = (vero - mm) * 1000;
    return mm.toString().replace('.', ',') + ' mm chiesti = ' + passi + ' passi = ' +
           vero.toFixed(4).replace('.', ',') + ' mm veri (' +
           (scarto >= 0 ? '+' : '') + scarto.toFixed(0) + ' µm)';
  }

  function rigaAsse(asse, etichetta) {
    /* Il titolo ripete l'etichetta: in una colonna stretta il nome viene
       accorciato coi puntini, e il modo di rileggerlo intero deve esserci. */
    return '<div class="pm-ax" title="' + etichetta + '"><span>' + etichetta +
           '</span><b class="pm-pos" data-pm-ax="' + asse + '">—</b></div>';
  }

  /* --------------------------------- istanza ------------------------------ */

  function mount(el, opzioni) {
    var o = opzioni || {};
    var sez = {
      posizione: o.posizione !== false,
      homing: o.homing !== false,
      assi: o.assi !== false,
      penna: o.penna !== false
    };
    el.innerHTML = markup(sez);

    /* `meta` è il punto verso cui si sta andando, quando si sta andando da
       qualche parte scrivendolo nei campi. Serve a sapere quando svuotarli:
       all'ARRIVO, non alla partenza. */
    var ist = { el: el, sez: sez, passo: 1, meta: null };
    istanze.push(ist);

    /* Una sola riga `$J` anche per le diagonali: due comandi separati
       farebbero una L invece di una diagonale, e si vedrebbe. */
    ognuno(el, '[data-pm-jog]', function (b) {
      b.addEventListener('click', function () {
        Api.jogXY(+this.dataset.pmDx * ist.passo,
                  +this.dataset.pmDy * ist.passo, 1000);
      });
    });

    uno(el, '.pm-stop', function (b) {
      b.addEventListener('click', function () { Api.feedHold(); });
    });

    ognuno(el, '[data-pm-vai]', function (b) {
      b.addEventListener('click', function () { vaiPunto(el, ist, this.dataset.pmVai); });
    });

    ognuno(el, '[data-pm-step]', function (b) {
      b.addEventListener('click', function () {
        ist.passo = +this.dataset.pmStep;
        uno(el, '.pm-step-free', function (i) { i.value = ''; });
        segnaPasso(el, ist);
      });
    });

    /* Scrivere nel campo libero vale come premere un pulsante: cambia il passo
       e spegne gli altri. Un valore non positivo si ignora invece di azzerare
       il passo, perché un tastierino che non muove niente sembra rotto. */
    uno(el, '.pm-step-free', function (inp) {
      inp.addEventListener('input', function () {
        var v = parseFloat(this.value);
        if (!(v > 0)) return;
        ist.passo = v;
        segnaPasso(el, ist);
      });
    });

    /* Le tre quote della penna, dal tastierino. Sono le stesse che usa il
       generatore: non si inventano qui. */
    ognuno(el, '[data-pm-h]', function (b) {
      b.addEventListener('click', function () {
        var q = this.dataset.pmH;
        Api.penna(q === 'tappo' ? Profile.zTappo()
                : q === 'alzata' ? Profile.zAlzata()
                : Profile.zContatto());
      });
    });

    /* UN GRADO ALLA VOLTA, e il numero non è scelto a caso: la banda morta di
       questo servo vale 0,9 gradi, quindi un grado è il PRIMO passo che la
       penna sente davvero. Chiedere meno vuol dire mandare un impulso che il
       servo non distingue da quello di prima. In millimetri un grado fa
       0,327: più grosso dei passi da 0,2 della scheda penna, che infatti
       stanno sotto la banda morta e spesso non muovono niente.
       Si ferma alle due quote dichiarate: oltre, mapConstrain tronca in
       silenzio e il numero sullo schermo salirebbe con la penna ferma. */
    ognuno(el, '[data-pm-deg]', function (b) {
      b.addEventListener('click', function () {
        var z = State.data.pos.z + (+this.dataset.pmDeg) * Profile.mmPerGrado();
        var giu = Profile.zContatto(), su = Profile.zTappo();
        if (giu !== null && z < giu) z = giu;
        if (su !== null && z > su) z = su;
        Api.penna(z);
      });
    });

    /* Vai al punto. */
    ognuno(el, '.pm-goto-x, .pm-goto-y', function (i) {
      i.addEventListener('input', function () { etichettaVai(el); });
    });

    uno(el, '.pm-goto-go', function (b) {
      b.addEventListener('click', function () { vai(el, ist); });
    });

    uno(el, '.pm-free', function (b) {
      b.addEventListener('click', function () {
        if (State.data.azzerata &&
            !window.confirm('Liberando i motori la posizione attuale viene persa. Procedo?')) return;
        Api.motoriLiberi();
      });
    });

    uno(el, '.pm-homed', function (b) {
      b.addEventListener('click', function () { Api.homingFatto(); });
    });

    /* Le due quote sono assolute e negative: Z0 è il tappo in cima, il foglio
       sta in fondo alla corsa. Non sono alzataMm() e 0, che erano le quote di
       quando lo zero stava sul foglio. */
    uno(el, '.pm-pen-up', function (b) {
      b.addEventListener('click', function () { Api.penna(Profile.zAlzata()); });
    });
    uno(el, '.pm-pen-down', function (b) {
      b.addEventListener('click', function () { Api.penna(Profile.zContatto()); });
    });
    /* I passi relativi si fermano ai due estremi della corsa dichiarata. Non
       è una gentilezza: fuori da quell'intervallo mapConstrain tronca in
       silenzio, quindi premere ancora non darebbe nessun segnale — il numero
       sullo schermo salirebbe e la penna starebbe ferma. */
    ognuno(el, '[data-pm-pen]', function (b) {
      b.addEventListener('click', function () {
        var z = State.data.pos.z + (+this.dataset.pmPen);
        var giu = Profile.zContatto(), su = Profile.zTappo();
        if (giu !== null && z < giu) z = giu;
        if (su !== null && z > su) z = su;
        Api.penna(z);
      });
    });

    aggiorna(ist);
    return ist;
  }

  /* Quale dei cinque posti è il passo attivo. Se nessuno dei quattro valori
     fissi corrisponde, l'attivo è il campo libero: così il pannello dice
     SEMPRE di quanto si muoverà, che è l'unica cosa che conta sapere prima di
     premere una freccia su una macchina senza finecorsa. */
  function segnaPasso(el, ist) {
    var fisso = false;
    ognuno(el, '[data-pm-step]', function (x) {
      var on = Math.abs(+x.dataset.pmStep - ist.passo) < 1e-9;
      x.classList.toggle('is-active', on);
      if (on) fisso = true;
    });
    uno(el, '.pm-step-free', function (i) { i.classList.toggle('is-active', !fisso); });
    /* Cambiare passo cambia dove si finisce, quindi cambia quali frecce si
       possono premere: a 5 mm dal confine, 1 mm ci sta e 10 no. */
    aggiorna(ist);
  }

  function etichettaVai(el) {
    var x = valore(el, '.pm-goto-x'), y = valore(el, '.pm-goto-y');
    uno(el, '.pm-goto-go', function (b) {
      b.textContent = (x === null && y === null) ? 'Vai al punto'
        : 'Vai a X ' + (x === null ? '—' : x) + ' Y ' + (y === null ? '—' : y);
    });
  }

  function valore(el, sel) {
    var i = el.querySelector(sel);
    if (!i || !i.value.trim()) return null;
    var v = parseFloat(i.value);
    return isNaN(v) ? null : v;
  }

  function dice(el, testo) {
    uno(el, '.pm-goto-nota', function (p) { p.textContent = testo; });
  }

  /* Tre controlli prima di muovere, e nessuno è di cortesia: senza
     azzeramento quelle coordinate non hanno un riferimento; fuori dall'area
     percorribile il carrello va in battuta, e senza finecorsa non c'è nulla
     che lo fermi. */
  function vai(el, ist) {
    var x = valore(el, '.pm-goto-x'), y = valore(el, '.pm-goto-y');
    if (x === null || y === null) {
      dice(el, 'Servono tutt\'e due le coordinate.');
      return;
    }
    if (!State.data.azzerata) {
      dice(el, 'La macchina non è azzerata: quelle coordinate non avrebbero ' +
               'un riferimento. Fai prima l\'homing.');
      return;
    }
    var d = Profile.stanoDentro({ x0: x, y0: y, x1: x, y1: y });
    if (!d.ok) {
      dice(el, 'Fuori dall\'area percorribile, ' + d.fuori.join(' e ') + '.');
      return;
    }
    ist.meta = { x: x, y: y };
    dice(el, 'In movimento verso X ' + x + ' Y ' + y + '…');
    Api.vaiA(x, y).catch(function (e) {
      ist.meta = null;
      dice(el, 'Non ci è andata: ' + e.message);
    });
  }

  /* Andare a un punto notevole. Gli stessi tre controlli di «Vai al punto» —
     collegata, azzerata, dentro l'area — più una quarta cosa che lì non serve
     e qui sì: LA PENNA SI ALZA PRIMA DI PARTIRE. Questi quattro pulsanti si
     premono per guardare dove sta il foglio, e un traverso di duecento
     millimetri con la punta appoggiata lascia una riga dritta in mezzo al
     disegno. Alzare costa mezzo secondo e non si può disfare al contrario. */
  function vaiPunto(el, ist, k) {
    var q = puntoVai(k), nome = nomeVai(k).toLowerCase();
    if (!q) { dice(el, 'Quel punto non è definito.'); return; }
    if (!State.data.azzerata) {
      dice(el, 'La macchina non è azzerata: quelle coordinate non avrebbero ' +
               'un riferimento. Fai prima l\'homing.');
      return;
    }
    var d = Profile.stanoDentro({ x0: q.x, y0: q.y, x1: q.x, y1: q.y });
    if (!d.ok) {
      dice(el, 'Il ' + nome + ' è fuori dall\'area percorribile, ' +
               d.fuori.join(' e ') + '.');
      return;
    }

    ist.meta = { x: q.x, y: q.y };
    dice(el, 'Penna su, poi al ' + nome + ': X ' + q.x.toFixed(1) +
             ' Y ' + q.y.toFixed(1) + '…');

    var su = Profile.zAlzata();
    /* Si alza solo se è più in basso: una quota già buona rimandata uguale
       sarebbe mezzo secondo di servo per niente. */
    var prima = (su !== null && State.data.pos.z < su - 0.01)
      ? Api.penna(su) : Promise.resolve();

    prima.then(function () { return Api.vaiA(q.x, q.y); })
         .catch(function (e) {
           ist.meta = null;
           dice(el, 'Non ci è andata: ' + e.message);
         });
  }

  /* DI QUANTO UN MOVIMENTO PEGGIORA LE COSE, in parole. Vuoto vuol dire che
     si può fare.
     Non basta chiedere «il punto d'arrivo sta dentro al bordo di rispetto?»:
     se per qualunque motivo il carrello si trova già fuori — una stampa che
     usa tutta l'area, un profilo cambiato dopo — nessuna freccia funzionerebbe
     più, nemmeno quelle che riportano dentro. Si confronta l'arrivo con la
     PARTENZA, e si rifiuta solo quello che allontana ancora. */
  function sbordo(da, a) {
    var L = limiti(), f = [];
    var fx = fuoriDa(a.x, L.x0, L.x1), ox = fuoriDa(da.x, L.x0, L.x1);
    var fy = fuoriDa(a.y, L.y0, L.y1), oy = fuoriDa(da.y, L.y0, L.y1);
    if (fx > ox + 1e-6) {
      f.push((a.x < L.x0 ? 'a sinistra di ' : 'a destra di ') + fx.toFixed(1) + ' mm');
    }
    if (fy > oy + 1e-6) {
      f.push((a.y < L.y0 ? 'sotto di ' : 'sopra di ') + fy.toFixed(1) + ' mm');
    }
    return f;
  }

  function uno(el, sel, fn) { var x = el.querySelector(sel); if (x) fn(x); }
  function ognuno(el, sel, fn) {
    var xs = el.querySelectorAll(sel);
    for (var i = 0; i < xs.length; i++) fn(xs[i]);
  }

  /* ------------------------------- aggiornamento -------------------------- */

  function aggiorna(ist) {
    var el = ist.el;
    var collegata = State.data.connected;
    var liberi = State.data.motoriLiberi;
    var nota = State.data.azzerata;

    /* La posizione: quando non è nota si dice, invece di mostrare tre decimali
       che sembrano una misura. Uno stepper conta gli impulsi mandati, non i
       giri fatti: dopo uno spostamento a mano quel numero non vuol dire più
       niente. */
    ognuno(el, '[data-pm-ax]', function (b) {
      var a = b.dataset.pmAx;
      b.textContent = nota ? State.data.pos[a].toFixed(2) + ' mm' : '— non nota';
      b.classList.toggle('pm-ko', !nota);
    });

    /* A motori liberi le frecce non servono a niente: FluidNC li riattiverebbe
       al primo comando, buttando via l'appoggio appena fatto.

       E NON SI PREME UNA FRECCIA CHE PORTA FUORI DALL'AREA. Questa macchina
       non ha finecorsa: oltre il confine non c'è niente che fermi il
       carrello, il pignone esce dalla cremagliera e si rimonta a mano. Il
       controllo c'era già su «Vai al punto» e sui quattro angoli — cioè sui
       comandi in cui si scrive una coordinata — e mancava proprio dove si
       arriva al confine un click alla volta.
       Il conto si rifà a ogni cambio di passo, non solo di posizione: con lo
       stesso carrello fermo, 1 mm ci sta e 50 no. E vale solo a macchina
       AZZERATA: senza origine quelle coordinate non vogliono dire niente, e
       spegnere le frecce proprio mentre si sta facendo l'azzeramento
       toglierebbe l'unico modo di farlo. */
    ognuno(el, '[data-pm-jog]', function (b) {
      var dx = (+b.dataset.pmDx) * ist.passo, dy = (+b.dataset.pmDy) * ist.passo;
      var fuori = nota
        ? sbordo(State.data.pos,
                 { x: State.data.pos.x + dx, y: State.data.pos.y + dy })
        : [];
      var passo = String(ist.passo).replace('.', ',');
      b.disabled = !collegata || liberi || fuori.length > 0;
      b.classList.toggle('is-ko', fuori.length > 0);
      b.title = fuori.length
        ? 'Con un passo da ' + passo + ' mm si finirebbe ' + fuori.join(' e ') +
          ' oltre il bordo di rispetto, che sta ' + ORLO + ' mm dentro al fine ' +
          'corsa: lì non c\'è nessun finecorsa che fermi il carrello. Scegli un ' +
          'passo più piccolo.'
        : (nota
            ? 'Sposta di ' + passo + ' mm'
            : 'Sposta di ' + passo + ' mm. La macchina non è azzerata: finché ' +
              'non lo è, nessuno può sapere se questo movimento resta ' +
              'dentro l\'area.');
    });
    ognuno(el, '[data-pm-step]', function (b) { b.disabled = !collegata; });
    uno(el, '.pm-step-free', function (b) { b.disabled = !collegata; });

    /* Lo STOP resta premibile anche a motori liberi: è l'unico comando che non
       fa muovere niente, e volerlo spento proprio quando si sta armeggiando
       sulla macchina sarebbe esattamente il contrario di quello che serve. */
    uno(el, '.pm-stop', function (b) { b.disabled = !collegata; });

    /* Scrivere un punto chiede una cosa in più delle frecce: l'azzeramento.
       Una freccia dice «di qui spostati un po'» e vale sempre; una coordinata
       dice «vai in quel posto», e senza origine quel posto non esiste. */
    var puoAndare = collegata && !liberi && State.data.azzerata;
    ognuno(el, '.pm-goto-x, .pm-goto-y, .pm-goto-go', function (b) {
      b.disabled = !puoAndare;
    });

    /* I QUATTRO PUNTI LIMITE non dipendono dal foglio: dipendono dalla CORSA,
       cioè dal profilo macchina. Spostare la carta sul piano non li muove di
       un millimetro, ed è giusto così — sono i punti che si premono per
       vedere dove arriva la macchina, non dove sta il foglio.
       Le coordinate finiscono nel suggerimento perché un pulsante con un
       disegno sopra dice DOVE si va ma non dice a quanti millimetri, e prima
       di mandare un carrello da qualche parte quel numero si vuole leggere. */
    ognuno(el, '[data-pm-vai]', function (b) {
      var k = b.dataset.pmVai, q = puntoVai(k), nome = nomeVai(k);
      if (!q) {
        b.disabled = true;
        b.classList.add('is-ko');
        b.title = k === 'home' ? nome + ': non è definito.'
          : nome + ': la corsa dichiarata è più corta del bordo di rispetto, ' +
            'quindi non c\'è nessun punto dove andare. Guarda le corse nella ' +
            'tab Impostazioni.';
        var vx = b.querySelector('.vx'), vy = b.querySelector('.vy');
        if (vx) vx.textContent = '—';
        if (vy) vy.textContent = '—';
        return;
      }
      var d = Profile.stanoDentro({ x0: q.x, y0: q.y, x1: q.x, y1: q.y });
      var dove = ' — X ' + q.x.toFixed(1) + ' Y ' + q.y.toFixed(1) + ' mm';
      b.disabled = !puoAndare || !d.ok;
      b.classList.toggle('is-ko', !d.ok);
      /* La coda sul bordo di rispetto vale per i quattro limiti e non per il
         punto home, che limite non è: è dove i carrelli si parcheggiano. */
      b.title = !d.ok
        ? nome + dove + ': fuori dall\'area percorribile, ' + d.fuori.join(' e ') + '.'
        : nome + dove + (k === 'home' ? '' : ', cioè ' + ORLO +
                         ' mm dentro al fine corsa') + '. Alza la penna e ci va.';

      /* I due numeri dentro al rettangolino. Interi: un millimetro è già più
         fine di quanto si posi un foglio a mano, e tre cifre in una casella
         da cinquanta pixel sono il massimo che si legge. Il titolo tiene il
         decimale per chi lo vuole. */
      var tx = b.querySelector('.vx'), ty = b.querySelector('.vy');
      if (tx) tx.textContent = Math.round(q.x);
      if (ty) ty.textContent = Math.round(q.y);
    });

    /* Arrivata? I campi si svuotano qui e non alla partenza: `ok` da FluidNC
       vuol dire «riga accettata», non «carrelli fermi a destinazione». La
       tolleranza è mezzo decimo: un passo di motore vale 0,029 mm e il punto
       chiesto quasi mai ci cade sopra esatto. */
    if (ist.meta && nota) {
      var p = State.data.pos, m = State.data.machine;
      if (Math.abs(p.x - ist.meta.x) < 0.05 && Math.abs(p.y - ist.meta.y) < 0.05 &&
          m !== 'Run' && m !== 'Jog') {
        ist.meta = null;
        uno(el, '.pm-goto-x', function (i) { i.value = ''; });
        uno(el, '.pm-goto-y', function (i) { i.value = ''; });
        etichettaVai(el);
        dice(el, 'Arrivata.');
      }
    }
    uno(el, '.pm-free', function (b) {
      b.disabled = !collegata || liberi;
      b.classList.toggle('is-warn', liberi);
    });
    uno(el, '.pm-homed', function (b) { b.disabled = !collegata || !liberi; });

    uno(el, '.pm-nota-home', function (p) {
      p.innerHTML = liberi
        ? '<b class="pm-ko">Motori liberi.</b> Appoggia i carrelli ai blocchi ' +
          '<b>senza forzarli</b>, poi «Homing completato».'
        : 'Appoggia i carrelli ai blocchi <b>senza forzarli</b>, poi «Homing ' +
          'completato»: riattiva i motori, azzera sul <b>punto ai blocchi</b> e si ' +
          'sposta al <b>punto home</b>, in quest\'ordine. Lo zero resta il punto ' +
          'ai blocchi, l\'angolo in basso a sinistra.';
    });

    /* La penna si muove in millimetri veri, non in gradi: la conversione la fa
       il config.yaml generato dal profilo. Ma finché i tre angoli del servo non
       sono stati rilevati non esiste nessuna alzata, quindi i comandi restano
       spenti invece di mandare una quota inventata. */
    var alzata = Profile.alzataMm();
    var zSu = Profile.zAlzata(), zGiu = Profile.zContatto();
    /* Serve anche la posizione tappo, non solo i due angoli di lavoro: è lei a
       fissare lo zero da cui si contano le quote. Senza, le due quote da
       comandare non esistono nemmeno se abbassata e alzata ci sono. */
    var pennaNota = alzata !== null && zSu !== null && zGiu !== null;
    uno(el, '.pm-nota-pen', function (p) {
      p.innerHTML = !pennaNota
        ? '<b class="pm-ko">I tre angoli del servo non sono stati rilevati</b> ' +
          '(passo A2, con la dashboard a modulo penna montato): finché mancano ' +
          'non esiste una quota di penna da comandare.'
        : 'Le quote sono negative: <b>Z0</b> è in alto, dove ci sta il tappo, ' +
          '<b>Z' + zSu.toFixed(2) + '</b> è la penna alzata e <b>Z' +
          zGiu.toFixed(2) + '</b> il foglio, cioè ' + alzata.toFixed(2) +
          ' mm sotto. <b>La banda morta del servo vale 0,9&deg;, cioè 0,29 mm</b>: ' +
          'questi due passi da 0,2 le stanno sotto, quindi a volte non muovono ' +
          'niente. Per spostamenti fini usa le frecce <b>1&deg;</b> del ' +
          'tastierino, che valgono 0,33 mm e sono il primo passo che la penna ' +
          'sente davvero.';
    });
    ognuno(el, '.pm-pen-up, .pm-pen-down, [data-pm-pen], [data-pm-h], [data-pm-deg]',
      function (b) { b.disabled = !collegata || liberi || !pennaNota; });
  }

  function aggiornaTutti() {
    /* I popup montano e smontano il pannello a ogni passo: le istanze rimaste
       appese a un pezzo di pagina che non c'è più si buttano, altrimenti la
       lista cresce a ogni stampa. */
    istanze = istanze.filter(function (i) { return document.body.contains(i.el); });
    for (var i = 0; i < istanze.length; i++) aggiorna(istanze[i]);
    note();
  }

  /* I numeri che spiegano quanto ci si può fidare di quello che si sta facendo.
     Non sono comandi: sono il contesto senza cui un pannello di jog è solo
     quattro frecce. */
  function note() {
    var m = Profile.macchina();
    var valori = {
      area: Profile.corsaPercorribile('x').toFixed(1) + ' × ' +
            Profile.corsaPercorribile('y').toFixed(1) + ' mm',
      ripet: m.homing.x.ripetibilita === null
        ? 'non misurata'
        : 'sotto ' + m.homing.x.ripetibilita.toFixed(2) + ' mm',
      gioco: m.gioco.x.toFixed(2) + ' mm',
      passo: (1 / Profile.passiPerMm('x')).toFixed(4) + ' mm'
    };
    var els = document.querySelectorAll('[data-calc-man]');
    for (var i = 0; i < els.length; i++) {
      var v = valori[els[i].dataset.calcMan];
      if (v !== undefined) els[i].textContent = v;
    }
  }

  function init() {
    State.on('pos', aggiornaTutti);
    State.on('connected', aggiornaTutti);
    State.on('azzerata', aggiornaTutti);
    State.on('motoriLiberi', aggiornaTutti);
    State.on('profilo', aggiornaTutti);
    /* Il foglio: i quattro pulsanti dei punti notevoli puntano ai suoi
       angoli, e un foglio spostato li sposta tutti. */
    State.on('paper', aggiornaTutti);
  }

  return { init: init, mount: mount, aggiorna: aggiornaTutti };
})();
