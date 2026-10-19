/* Avvio: collega i moduli, gestisce le tab e tiene aggiornata la barra in alto. */
(function () {

  /* Quali comandi hanno senso solo con la macchina collegata. Tenerli in un
     elenco unico evita che un pulsante resti attivo per dimenticanza e mandi
     un comando nel vuoto. */
  var NEEDS_LINK = [
    'btn-send', 'btn-pause', 'btn-abort',
    'log-input', 'btn-log-send'
  ];

  var STATE_LABEL = {
    Off: 'Disconnesso', Idle: 'Pronta', Run: 'In movimento',
    Jog: 'Movimento manuale', Hold: 'In pausa', Alarm: 'Allarme',
    Door: 'Sportello', Home: 'Azzeramento', Check: 'Verifica'
  };

  var STATE_CLASS = {
    Off: 'state-off', Idle: 'state-idle', Run: 'state-run', Jog: 'state-run',
    Hold: 'state-hold', Alarm: 'state-alarm', Door: 'state-alarm'
  };

  function tabs() {
    var btns = document.querySelectorAll('.tab');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove('is-active');
        this.classList.add('is-active');
        var panels = document.querySelectorAll('.panel');
        for (var k = 0; k < panels.length; k++) panels[k].classList.remove('is-active');
        document.getElementById('tab-' + this.dataset.tab).classList.add('is-active');
      });
    }
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

    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files.length) accept(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', function () {
      if (this.files.length) accept(this.files[0]);
    });

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

  document.addEventListener('DOMContentLoaded', function () {
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
    Settings.init();
    Artwork.init();

    tabs();
    dropzone();
    connectBtn();

    State.on('machine', refreshState);
    State.on('connected', function () { refreshLink(); refreshState(); });
    State.on('pos', refreshPos);
    /* `azzerata` cambia il SIGNIFICATO della posizione, non il suo valore,
       quindi il DRO va riscritto anche quando le coordinate non si muovono. */
    State.on('azzerata', function () { refreshCalib(); refreshPos(); });
    State.on('motoriLiberi', refreshCalib);

    refreshState();
    refreshLink();
    refreshPos();
    refreshCalib();

    Log.add('msg', 'Interfaccia avviata in modalità finta. Premi Connetti per iniziare.');
  });
})();
