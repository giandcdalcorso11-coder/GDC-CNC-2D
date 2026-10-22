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
      h += '<div class="pm-sez">' +
           '<div class="jog-pad">' +
           '<button class="btn btn-jog" data-pm-jog="Y+">&uarr;</button>' +
           '<button class="btn btn-jog" data-pm-jog="X-">&larr;</button>' +
           '<button class="btn btn-jog btn-stop" data-pm-jog="stop">STOP</button>' +
           '<button class="btn btn-jog" data-pm-jog="X+">&rarr;</button>' +
           '<button class="btn btn-jog" data-pm-jog="Y-">&darr;</button>' +
           '</div><div class="step-row">';
      for (var i = 0; i < PASSI.length; i++) {
        h += '<button class="btn btn-ghost btn-small pm-step' +
             (PASSI[i] === 1 ? ' is-active' : '') + '" data-pm-step="' + PASSI[i] + '">' +
             String(PASSI[i]).replace('.', ',') + '</button>';
      }
      h += '<span class="muted small">mm</span></div></div>';
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

  function rigaAsse(asse, etichetta) {
    return '<div class="pm-ax"><span>' + etichetta + '</span>' +
           '<b class="pm-pos" data-pm-ax="' + asse + '">—</b></div>';
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

    var ist = { el: el, sez: sez, passo: 1 };
    istanze.push(ist);

    ognuno(el, '[data-pm-jog]', function (b) {
      b.addEventListener('click', function () {
        var d = this.dataset.pmJog;
        if (d === 'stop') { Api.feedHold(); return; }
        Api.jog(d[0], (d[1] === '-' ? -ist.passo : ist.passo).toFixed(3), 1000);
      });
    });

    ognuno(el, '[data-pm-step]', function (b) {
      b.addEventListener('click', function () {
        ist.passo = +this.dataset.pmStep;
        ognuno(el, '[data-pm-step]', function (x) {
          x.classList.toggle('is-active', +x.dataset.pmStep === ist.passo);
        });
      });
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
       al primo comando, buttando via l'appoggio appena fatto. */
    ognuno(el, '[data-pm-jog]', function (b) { b.disabled = !collegata || liberi; });
    ognuno(el, '[data-pm-step]', function (b) { b.disabled = !collegata; });
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
          ' mm sotto. Un decimo di millimetro è sotto la banda morta del ' +
          'servo: muoversi a passi di 0,2 è già il limite utile.';
    });
    ognuno(el, '.pm-pen-up, .pm-pen-down, [data-pm-pen]', function (b) {
      b.disabled = !collegata || liberi || !pennaNota;
    });
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
  }

  return { init: init, mount: mount, aggiorna: aggiornaTutti };
})();
