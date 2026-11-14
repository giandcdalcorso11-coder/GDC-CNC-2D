/* Avvio: collega i moduli, gestisce le tab e tiene aggiornata la barra in alto. */
(function () {

  /* Quali comandi hanno senso solo con la macchina collegata. Tenerli in un
     elenco unico evita che un pulsante resti attivo per dimenticanza e mandi
     un comando nel vuoto. */
  var NEEDS_LINK = [
    'btn-send', 'log-input', 'btn-log-send'
  ];

  /* Pausa e Interrompi non dipendono dal collegamento ma dalla STAMPA: con la
     macchina collegata e niente in corso non c'è niente da mettere in pausa, e
     un pulsante attivo che non fa niente insegna a non fidarsi dei pulsanti.
     Li governa refreshStampa(). */

  var STATE_LABEL = {
    Off: 'Disconnesso', Idle: 'Pronta', Run: 'In movimento',
    Jog: 'Movimento manuale', Hold: 'In pausa', Alarm: 'Allarme',
    Door: 'Sportello', Home: 'Azzeramento', Check: 'Verifica'
  };

  var STATE_CLASS = {
    Off: 'state-off', Idle: 'state-idle', Run: 'state-run', Jog: 'state-run',
    Hold: 'state-hold', Alarm: 'state-alarm', Door: 'state-alarm'
  };

  /* UN ASCOLTATORE SULLA BARRA, non uno per pulsante: dal 2026-11-03 le tab
     delle stampe nascono e muoiono mentre la pagina è aperta, e agganciarsi
     ai nodi che ci sono all'avvio vuol dire che quelle nuove non rispondono
     al clic — una tab che non si apre, senza niente che lo spieghi. */
  function tabs() {
    var nav = document.querySelector('nav.tabs');
    if (!nav) return;
    nav.addEventListener('click', function (e) {
      /* La × di una stampa non cambia tab: la chiude, e ci pensa Stampe. */
      if (e.target.closest('[data-chiudi]')) return;
      var b = e.target.closest('.tab');
      if (!b) return;
      var panel = document.getElementById('tab-' + b.dataset.tab);
      if (!panel) return;

      var btns = nav.querySelectorAll('.tab');
      for (var j = 0; j < btns.length; j++) btns[j].classList.remove('is-active');
      b.classList.add('is-active');
      var panels = document.querySelectorAll('.panel');
      for (var k = 0; k < panels.length; k++) panels[k].classList.remove('is-active');
      panel.classList.add('is-active');

      /* L'editor si prepara entrando, non all'avvio: la tela va adattata
         al disegno che c'è adesso, e all'avvio non c'è niente. */
      if (b.dataset.tab === 'editor' && window.Editor) Editor.apri();
    });
  }

  function refreshState() {
    var s = State.data.machine;
    var badge = document.getElementById('machine-state');
    badge.textContent = STATE_LABEL[s] || s;
    badge.className = 'state-badge ' + (STATE_CLASS[s] || 'state-off');

    /* Le spie riassumono lo stato: verde quando si può lavorare, giallo
       quando qualcosa richiede attenzione ma non è un guasto, rosso quando
       la macchina è ferma e va sbloccata a mano. */
    setLed('led-green',  s === 'Idle' || s === 'Run' || s === 'Jog');
    setLed('led-yellow', s === 'Hold' || (State.data.connected && !State.data.azzerata));
    setLed('led-red',    s === 'Alarm' || s === 'Door');
  }

  function setLed(id, on) {
    document.getElementById(id).classList.toggle('is-on', !!on);
  }

  function refreshLink() {
    var on = State.data.connected;
    for (var i = 0; i < NEEDS_LINK.length; i++) {
      var el = document.getElementById(NEEDS_LINK[i]);
      if (el) el.disabled = !on;
    }
    /* Il pannello manuale si disabilita da solo: conosce anche lo stato dei
       motori liberi, che da qui non si vede. */
    Panel.aggiorna();

    document.getElementById('btn-connect').textContent = on ? 'Disconnetti' : 'Connetti';

    /* Dopo aver riacceso i pulsanti del collegamento si rilegge lo stato della
       stampa, che su «Invia» ha l'ultima parola. */
    refreshStampa();
  }

  /* Il DRO in alto dice anche quando NON sa: una posizione con due decimali,
     dopo che i carrelli sono stati spostati a mano, è un numero che sembra una
     misura e non lo è più. */
  function refreshPos() {
    var p = State.data.pos, nota = State.data.azzerata;
    ['x', 'y', 'z'].forEach(function (a) {
      var el = document.getElementById('dro-' + a);
      el.textContent = nota ? p[a].toFixed(2) : '—';
      el.classList.toggle('dro-ko', !nota);
    });
  }

  /* L'avanzamento, in una riga sola. Non è una barra perché il numero che
     serve davvero mentre si guarda la macchina è «quanto manca», e quello si
     legge meglio scritto che disegnato. */
  /* LA PILA DEL TELECOMANDO, in alto accanto allo stato della macchina.
     C'è solo quando il telecomando ha risposto: un indicatore sempre acceso
     per un oggetto che spesso non è collegato sarebbe un posto vuoto da
     guardare tutti i giorni. Il colore è l'informazione prima del numero —
     sotto il 20% è un avviso, non un dato. */
  function refreshTele() {
    var el = document.getElementById('tele-pila');
    if (!el) return;
    var t = State.data.telecomando;
    var pc = t && t.visto ? t.batteria : null;
    el.hidden = !(t && t.visto);
    if (el.hidden) return;
    /* ALLA SPINA IL COLORE SMETTE DI PARLARE DELLA CARICA: il 12% di una
       cella che sta caricando non è un avviso. È la stessa regola del vetro
       del telecomando, e due pile che per la stessa batteria dicono cose
       diverse si guardano due volte. */
    var sp = t ? t.carica : null;
    var inSpina = sp === 'carica' || sp === 'piena';
    el.classList.toggle('is-carica', inSpina);
    el.classList.toggle('is-ko', !inSpina && pc !== null && pc < 20);
    el.classList.toggle('is-warn', (sp === 'ferma') ||
                                   (!inSpina && pc !== null && pc >= 20 && pc < 40));
    el.innerHTML = pila(pc, inSpina) + (pc === null ? '' : '<b>' + pc + '%</b>');
    el.title = 'Telecomando collegato' +
               (pc === null ? ': la carica non la sa dire.'
                            : ', batteria al ' + pc + '%.') +
               (sp === 'carica' ? ' In carica: il numero sotto carica è gonfio.'
                : sp === 'piena' ? ' Attaccato alla corrente, carica finita.'
                : sp === 'ferma' ? ' Attaccato alla corrente ma NON sta caricando.'
                : '');
  }

  /* Il segno della pila: lo stesso disegno del vetro del telecomando, perché
     due pile diverse per la stessa batteria si guardano due volte. */
  function pila(pc, spina) {
    var w = pc === null ? 0 : Math.max(0, Math.min(1, pc / 100)) * 9;
    return '<svg viewBox="0 0 17 10" aria-hidden="true">' +
           '<rect x="1" y="1" width="13" height="8" rx="1.6"></rect>' +
           '<rect class="tappo" x="15" y="3.4" width="1.6" height="3.2" rx=".6"></rect>' +
           (w > 0 ? '<rect class="carica" x="2.5" y="2.5" width="' + w.toFixed(1) +
                    '" height="5" rx=".6"></rect>' : '') +
           /* Il fulmine, come sul vetro: dentro alla pila e del colore dello
              sfondo, così si vede sia sopra al pieno sia sopra al vuoto. */
           (spina ? '<path class="fulmine" d="M8.6 1.6 L5.4 5.4 L7.4 5.4 ' +
                    'L6.4 8.4 L9.6 4.6 L7.6 4.6 Z"></path>' : '') +
           '</svg>';
  }

  function refreshStampa() {
    var s = State.data.stampa;
    var inCorso = s.stato === 'invio' || s.stato === 'pausa' || s.stato === 'cambio';
    var box = document.getElementById('prog');

    document.getElementById('btn-pause').disabled = !inCorso;
    document.getElementById('btn-abort').disabled = !inCorso;
    document.getElementById('btn-pause').textContent =
      (s.stato === 'pausa' || s.stato === 'cambio') ? 'Riprendi' : 'Pausa';

    /* Mentre una stampa è in corso «Invia» non deve essere premibile: una
       seconda stampa sulla stessa macchina non ha nessun significato buono. */
    var send = document.getElementById('btn-send');
    if (send) send.disabled = !State.data.connected || inCorso;

    if (s.stato === 'fermo') { box.hidden = true; return; }

    box.hidden = false;
    var t = s.fatte + ' di ' + s.totale + ' righe — ' + s.percento + '%';
    if (s.stato === 'pausa')  t = 'In pausa a ' + s.percento + '% (' + s.fatte +
                                  ' di ' + s.totale + ' righe)';
    if (s.stato === 'cambio') t = 'Cambio penna a ' + s.percento + '%: la testina ' +
                                  'va al punto home. Cambia la penna, poi Riprendi.';
    if (s.stato === 'fine')   t = 'Finita: ' + s.totale + ' righe.';
    if (s.stato === 'fermata') t = 'Fermata a ' + s.percento + '% (' + s.fatte +
                                  ' di ' + s.totale + ' righe). L\'origine resta valida.';
    if (s.stato === 'errore') t = 'Interrotta da un errore alla riga ' + (s.fatte + 1) +
                                  ' di ' + s.totale + '.';
    if (s.stato === 'invio' && s.rimanente !== null) {
      t += ' — ' + Sender.durata(s.rimanente) + ' circa alla fine';
    }
    box.textContent = t;
  }

  function refreshCalib() {
    var el = document.getElementById('calib-state');
    if (State.data.motoriLiberi) {
      el.textContent = 'Motori liberi — appoggia i carrelli';
      el.classList.remove('is-ok');
    } else if (State.data.azzerata) {
      el.textContent = 'Azzerata sull\'angolo in basso a sinistra';
      el.classList.add('is-ok');
    } else {
      el.textContent = 'NON AZZERATA';
      el.classList.remove('is-ok');
    }
    refreshState();
  }

  function dropzone() {
    var dz = document.getElementById('dropzone');
    var input = document.getElementById('file-input');

    dz.addEventListener('click', function () { input.click(); });

    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.remove('is-over');
      });
    });

    /* Piu' file in una volta sola diventano piu' livelli, nell'ordine in cui
       arrivano: adesso che i livelli esistono, prenderne uno e buttare gli
       altri sarebbe una perdita gratuita. */
    dz.addEventListener('drop', function (e) {
      tutti(e.dataTransfer.files);
    });
    input.addEventListener('change', function () {
      tutti(this.files);
      this.value = '';     // così lo stesso file si può ricaricare
    });

    function tutti(files) {
      for (var i = 0; i < files.length; i++) accept(files[i]);
    }

    function accept(file) {
      if (!/\.svg$/i.test(file.name)) {
        Log.add('err', 'Per ora si accettano solo file SVG.');
        return;
      }
      var r = new FileReader();
      r.onload = function () {
        try {
          Artwork.load(r.result, file.name);
        } catch (e) {
          Log.add('err', 'Non sono riuscito a leggere il file: ' + e.message);
        }
      };
      r.readAsText(file);
    }
  }

  function connectBtn() {
    document.getElementById('btn-connect').addEventListener('click', function () {
      if (State.data.connected) { Api.disconnect(); return; }
      State.data.host = document.getElementById('host').value.trim();
      document.getElementById('set-host').value = State.data.host;
      Api.connect().catch(function (e) {
        Log.add('err', 'Connessione fallita: ' + e.message);
      });
    });
  }

  /* L'AVVISO DEI NUMERI DI FABBRICA, alla prima occhiata alla pagina.
   *
   * Nasce da una domanda dell'utente: aprendo lo SLICER dall'iPad col
   * telecomando spento, che cosa manca? Le tre misure pericolose no — le
   * chiedono i popup di inizio stampa, ogni volta, su ogni dispositivo. Manca
   * il PROFILO, e manca in silenzio: `Profile.load()` fonde `localStorage`
   * sui valori compilati nella pagina, quindi dove non c'e' niente salvato i
   * campi restano pieni dei numeri del build. L'alzata della penna e' quello
   * che fa danno: piu' piccola del vero, la punta striscia sul foglio.
   *
   * La × non si ricorda, ed e' voluto: l'avviso torna alla prossima apertura
   * finche' il dispositivo non ha un profilo suo. Un avviso di sicurezza che
   * si spegne per sempre al primo clic e' un avviso che si spegne il primo
   * giorno. */
  function fasciaProfilo() {
    var f = document.getElementById('fascia-profilo');
    if (!f || !window.Profile) return;
    if (!Profile.diFabbrica()) { f.hidden = true; return; }

    document.getElementById('fascia-profilo-testo').textContent =
      'Questo dispositivo usa i ' + Profile.provenienza() + '. Se la macchina ' +
      'e\' stata tarata dopo, qui non si vede: la misura che fa danno e\' ' +
      'l\'alzata della penna, perche\' una penna che si alza poco striscia sul ' +
      'foglio durante gli spostamenti.';
    f.hidden = false;

    /* Cambiare tab passa dal clic sul pulsante della tab, non da una seconda
       copia della logica: la barra sa già farlo, e due strade per la stessa
       cosa vogliono dire una che prima o poi resta indietro. */
    document.getElementById('fascia-profilo-vai').addEventListener('click', function () {
      var t = document.querySelector('.tab[data-tab="impostazioni"]');
      if (t) t.click();
    });
    document.getElementById('fascia-profilo-chiudi').addEventListener('click', function () {
      f.hidden = true;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    /* Prima di tutto il resto: le larghezze salvate vanno applicate mentre la
       pagina si sta ancora componendo, se no si vede il piano saltare dalla
       misura di fabbrica a quella scelta. */
    Layout.init();

    Log.init();
    Paper.init();
    Preview.init();

    /* Un componente solo, montato in due posti. Nella barra laterale senza la
       scheda della penna, che lì non ci sta e si usa poco; nella tab dedicata
       per intero. I tre popup di inizio stampa monteranno lo stesso. */
    Panel.init();
    Panel.mount(document.getElementById('panel-lato'), { penna: false });
    Panel.mount(document.getElementById('panel-tab'), {});

    Jog.init();
    Popup.init();
    Settings.init();
    Artwork.init();
    Righelli.init();
    Selezione.init();
    Sorgenti.init();
    Editor.init();
    Progetto.init();
    Nome.init();
    Telecomando.init();

    /* «Stampa» non manda niente: apre la procedura dei tre popup, che prende le
       misure del momento e solo alla fine rigenera e consegna il programma. */
    document.getElementById('btn-send').addEventListener('click', Popup.avviaStampa);

    tabs();
    /* Le tab delle stampe si agganciano DOPO `tabs()`: la prima cosa che
       fanno è chiedere alla barra di ascoltare, e la barra deve già
       saper cambiare pagina. */
    if (window.Stampe) Stampe.init();
    dropzone();
    connectBtn();
    /* Dopo `tabs()`, perche' il pulsante della fascia cambia tab premendo la
       tab vera. */
    fasciaProfilo();

    State.on('machine', refreshState);
    State.on('connected', function () { refreshLink(); refreshState(); });
    State.on('pos', refreshPos);
    /* `azzerata` cambia il SIGNIFICATO della posizione, non il suo valore,
       quindi il DRO va riscritto anche quando le coordinate non si muovono. */
    State.on('azzerata', function () { refreshCalib(); refreshPos(); });
    State.on('motoriLiberi', refreshCalib);
    State.on('stampa', refreshStampa);
    State.on('telecomando', refreshTele);

    refreshState();
    refreshLink();
    refreshPos();
    refreshCalib();
    refreshStampa();
    refreshTele();

    /* Il numero di versione in alto. Lo scrive tools/versione.py contando i
       commit che hanno toccato webui/: è «quante volte questa pagina è
       cambiata», e serve a sapere quale copia si ha davanti quando qualcosa
       non si comporta come l'ultima volta. */
    var ver = document.getElementById('brand-ver');
    if (ver && typeof Versione !== 'undefined') {
      ver.textContent = 'v' + Versione.numero;
      ver.title = 'Versione ' + Versione.numero + ' della pagina, del ' +
                  Versione.data + '. È il numero di volte che è cambiata.';
    }

    Log.add('msg', 'Interfaccia avviata in modalità finta. Premi Connetti per ' +
                   'iniziare.' +
                   (typeof Versione !== 'undefined'
                      ? ' Pagina v' + Versione.numero + ' del ' + Versione.data + '.' : ''));
  });
})();
