/* La tab Impostazioni: i due profili, e il generatore di config.yaml.
 *
 * I campi non sono collegati uno per uno. Ogni input porta scritto nel
 * `data-bind` il percorso del campo nel profilo (`macchina.corse.x.corsaPassi`),
 * e questo modulo legge e scrive per percorso. È un centinaio di righe in meno,
 * ma soprattutto è un posto in meno in cui sbagliare: aggiungere un numero al
 * profilo vuol dire aggiungere un input all'HTML, e basta.
 *
 * I nomi visibili stanno in misure/impostazioni-glossario.md. Se un nome
 * cambia, cambia prima lì.
 */
var Settings = (function () {

  /* ------------------------ lettura e scrittura per percorso -------------- */

  function nodo(percorso) {
    var parti = percorso.split('.'), obj = Profile.get();
    for (var i = 0; i < parti.length - 1; i++) obj = obj[parti[i]];
    return { obj: obj, chiave: parti[parti.length - 1] };
  }

  function leggi(percorso) {
    var n = nodo(percorso);
    return n.obj ? n.obj[n.chiave] : undefined;
  }

  function scrivi(percorso, valore) {
    var n = nodo(percorso);
    if (n.obj) n.obj[n.chiave] = valore;
  }

  /* ------------------------------ i conti mostrati ----------------------- */

  var f2 = function (v) { return Number(v).toFixed(2); };
  var f3 = function (v) { return Number(v).toFixed(3); };

  var CALC = {
    aggiornato: function () {
      var a = Profile.macchina().aggiornato;
      if (!a) return 'mai salvato';
      var d = new Date(a);
      return isNaN(d.getTime()) ? a : d.toLocaleString('it-IT');
    },
    appoggio: function () {
      var r = Profile.appoggioRect();
      if (!r) return 'serve lo zero sulla tavola';
      return r.w.toFixed(0) + ' × ' + r.h.toFixed(0) + ' mm';
    },

    /* Il controllo che vale la pena fare: l'area che la penna raggiunge deve
       stare dentro quella in cui il foglio si appoggia. Se esce, uno dei
       numeri è sbagliato — e con quattro distanze prese col metro, sbagliare
       di un bordo è la cosa più facile del mondo. Si dice di quanto e da che
       parte, se no «non torna» non aiuta a trovare l'errore. */
    coerenza: function () {
      var r = Profile.appoggioRect();
      if (!r) return '—';
      var ax = Profile.corsaPercorribile('x'), ay = Profile.corsaPercorribile('y');
      var fuori = [];
      if (r.x0 > 0)           fuori.push('a sinistra di ' + r.x0.toFixed(0));
      if (r.y0 > 0)           fuori.push('sotto di ' + r.y0.toFixed(0));
      if (r.x0 + r.w < ax)    fuori.push('a destra di ' + (ax - r.x0 - r.w).toFixed(0));
      if (r.y0 + r.h < ay)    fuori.push('sopra di ' + (ay - r.y0 - r.h).toFixed(0));
      return fuori.length
        ? 'l\'area di lavoro esce dall\'appoggio ' + fuori.join(' e ') + ' mm'
        : 'l\'area di lavoro cade dentro l\'appoggio';
    },

    passiMm: function () {
      return 'X ' + f3(Profile.passiPerMm('x')) + '  ·  Y ' + f3(Profile.passiPerMm('y'));
    },
    passoMin: function () {
      return 'X ' + (1 / Profile.passiPerMm('x')).toFixed(4) + ' mm  ·  Y ' +
             (1 / Profile.passiPerMm('y')).toFixed(4) + ' mm';
    },
    gioco: function () {
      var g = Profile.macchina().gioco;
      return g.x === g.y ? f2(g.x) + ' mm'
                         : f2(g.x) + ' mm su X  ·  ' + f2(g.y) + ' mm su Y';
    },
    'home.x': function () { return f3(Profile.corsaDaHome('x')) + ' mm'; },
    'home.y': function () { return f3(Profile.corsaDaHome('y')) + ' mm'; },
    'perc.x': function () { return percorribile('x'); },
    'perc.y': function () { return percorribile('y'); },
    area: function () {
      var a = Profile.areaUtile();
      return f3(a.w) + ' × ' + f3(a.h) + ' mm';
    },
    mmGrado: function () { return Profile.mmPerGrado().toFixed(5) + ' mm/°'; },
    alzata: function () {
      var mm = Profile.alzataMm(), p = Profile.macchina().penna;
      if (mm === null) return 'da rilevare (passo A2)';
      return f2(mm) + ' mm  ·  ' + f2(p.gradiPennaAlzata - p.gradiPennaAbbassata) + '° di servo';
    },
    impulsi: function () {
      var p = Profile.macchina().penna;
      if (p.gradiPennaAbbassata === null || p.gradiPennaAlzata === null) return 'da rilevare';
      return 'abbassata ' + Math.round(Profile.gradiToUs(p.gradiPennaAbbassata)) +
             ' µs  ·  alzata ' + Math.round(Profile.gradiToUs(p.gradiPennaAlzata)) + ' µs';
    },
    /* Le tre quote in coordinate MACCHINA: sono quelle che finiscono nel
       G-code, e sono negative perché lo zero sta in cima. Vederle qui serve a
       riconoscere al volo un file generato con la convenzione sbagliata. */
    quoteZ: function () {
      var su = Profile.zAlzata(), giu = Profile.zContatto(), t = Profile.zTappo();
      if (su === null || giu === null || t === null) return 'da rilevare (passo A2)';
      return 'tappo Z' + f3(t) + '  ·  alzata Z' + f3(su) +
             '  ·  foglio Z' + f3(giu);
    },
    formato: function () { return State.data.paper.name; }
  };

  function percorribile(asse) {
    return f3(Profile.corsaPercorribile(asse)) + ' mm  ·  ' +
           Profile.passiPercorribili(asse) + ' passi';
  }

  /* Le etichette di provenienza che cambiano da sole: un campo è «misurato»
     quando c'è un numero dentro, «da misurare» finché è nullo o nominale. Le
     altre sono scritte nell'HTML, perché non cambiano mai. */
  var PROV = {
    'trasm.x': function () { return tarato('x'); },
    'trasm.y': function () { return tarato('y'); },
    'pen.battuta':   function () { return rilevato('gradiBattuta'); },
    'pen.abbassata': function () { return rilevato('gradiPennaAbbassata'); },
    'pen.alzata':    function () { return rilevato('gradiPennaAlzata'); }
  };

  function tarato(asse) {
    return Profile.macchina().trasmissione[asse].tarato
      ? ['misurato', 'prov-mis'] : ['nominale', 'prov-damis'];
  }

  /* I tre angoli della penna non hanno la stessa natura, e il distinguo è una
     decisione del progetto, non un dettaglio: solo la battuta viene dal
     montaggio, l'abbassata la si IMPONE stringendo la penna a quell'angolo
     contro il piano di riferimento, l'alzata è un conto (abbassata + 9°). Un
     badge che dicesse «misurato» a tutti e tre racconterebbe una cosa falsa a
     chi rilegge il profilo fra un mese. */
  var NATURA = {
    gradiBattuta:        ['al montaggio', 'prov-mis'],
    gradiPennaAbbassata: ['imposto',      'prov-scelto'],
    gradiPennaAlzata:    ['calcolato',    'prov-calc']
  };

  function rilevato(campo) {
    return Profile.macchina().penna[campo] === null
      ? ['da misurare', 'prov-damis'] : NATURA[campo];
  }

  /* --------------------------- riempire e aggiornare --------------------- */

  /* Dal profilo agli input. Serve all'avvio e ogni volta che il profilo cambia
     in blocco — importazione, ripristino, caricamento di un profilo di stampa —
     perché in quei casi non è un campo a essere cambiato ma tutti. */
  function riempi() {
    ogni('[data-bind]', function (el) {
      var v = leggi(el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (v === null || v === undefined) el.value = '';
      else if (el.type === 'number' && typeof v === 'number') el.value = arrotonda(v, el.step);
      else el.value = v;
    });
    ogni('[data-mm]', function (el) {
      el.value = f3(Profile.corsaTotale(el.dataset.mm));
    });
    ogni('[data-foglio]', function (el) {
      el.value = Profile.stampa().foglio[el.dataset.foglio];
    });
    libreria();
    aggiorna();
  }

  /* Solo le parti calcolate. Si chiama a ogni modifica: i numeri derivati non
     si salvano da nessuna parte, quindi l'unico modo di tenerli veri è
     ricalcolarli. */
  function aggiorna() {
    ogni('[data-calc]', function (el) {
      var fn = CALC[el.dataset.calc];
      if (fn) el.textContent = fn();
    });
    ogni('[data-prov]', function (el) {
      var fn = PROV[el.dataset.prov];
      if (!fn) return;
      var r = fn();
      el.textContent = r[0];
      el.className = 'prov ' + r[1];
    });
    verifica();
  }

  function verifica() {
    var ul = document.getElementById('verifica-list');
    var problemi = Profile.verifica();
    if (!problemi.length) {
      ul.innerHTML = '<li class="v-ok">Tutto quello che si può controllare da qui torna.</li>';
      return;
    }
    var out = '';
    for (var i = 0; i < problemi.length; i++) {
      var p = problemi[i];
      out += '<li class="v-' + p.gravita + '">' + testo(p.testo) +
             (p.passo ? ' <span class="v-passo">passo ' + p.passo + '</span>' : '') + '</li>';
    }
    ul.innerHTML = out;
  }

  /* I testi della verifica li scriviamo noi, ma passano comunque da qui: un
     giorno uno di quei messaggi conterrà il nome di un profilo digitato
     dall'utente, e allora sarebbe troppo tardi per ricordarselo. */
  function testo(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Un campo mostra tanti decimali quanti ne ammette il suo passo, e non uno
     di più: il rapporto esce dalla divisione con quattordici cifre, ma la
     quattordicesima non la sa fare nessuna macchina e in un campo da compilare
     è solo rumore. */
  function arrotonda(v, passo) {
    var dec = (String(passo || '1').split('.')[1] || '').length;
    return String(Number(v.toFixed(dec)));
  }

  function ogni(sel, fn) {
    var els = document.querySelectorAll('#tab-impostazioni ' + sel);
    for (var i = 0; i < els.length; i++) fn(els[i]);
  }

  /* Dopo ogni modifica: salva, e rimanda a valle quello che dipende dai numeri
     cambiati. L'area di lavoro vive nel profilo, quindi il piano al centro si
     ridisegna da sé invece di restare indietro. */
  function applica() {
    Profile.save();
    Paper.refreshArea();
    aggiorna();
  }

  /* ------------------------------ i profili di stampa -------------------- */

  function libreria() {
    var sel = document.getElementById('stampa-lib');
    var nomi = Profile.elencoStampe();
    if (!nomi.length) {
      sel.innerHTML = '<option value="">(nessuno salvato)</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    var attivo = Profile.stampa().nome, out = '';
    for (var i = 0; i < nomi.length; i++) {
      out += '<option value="' + testo(nomi[i]) + '"' +
             (nomi[i] === attivo ? ' selected' : '') + '>' + testo(nomi[i]) + '</option>';
    }
    sel.innerHTML = out;
  }

  /* ------------------------------- scaricare file ------------------------ */

  function scarica(nomeFile, contenuto, tipo) {
    var blob = new Blob([contenuto], { type: tipo || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nomeFile;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Rilasciato dopo il click: revocarlo subito può annullare il download su
       alcuni browser. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------------------------- avvio ------------------------------ */

  function init() {
    /* Un campo per percorso: legge il tipo dall'input e scrive nel profilo.
       `data-null` vuol dire che il campo può essere vuoto, e vuoto è `null` —
       «non ancora misurato», che non è zero. */
    ogni('[data-bind]', function (el) {
      el.addEventListener('change', function () {
        var v;
        if (el.type === 'checkbox') {
          v = el.checked;
        } else if (el.type === 'number') {
          if (el.value.trim() === '') {
            v = el.dataset.null ? null : 0;
          } else {
            v = parseFloat(el.value);
            if (isNaN(v)) { riempi(); return; }
            if (Number(el.step) === 1) v = Math.round(v);
          }
        } else {
          v = el.value.trim();
        }
        scrivi(el.dataset.bind, v);
        /* Il nome del profilo di stampa compare anche nella tendina. */
        if (el.dataset.bind === 'stampa.nome') libreria();
        applica();
        if (el.dataset.mm !== undefined) return;
        /* Cambiando i passi, i millimetri a fianco devono seguire. */
        ogni('[data-mm]', function (m) { m.value = f3(Profile.corsaTotale(m.dataset.mm)); });
      });
    });

    /* La corsa si può digitare in millimetri, ma quello che resta scritto sono
       i passi: la conversione usa il rapporto del momento, ed è l'unico punto
       in cui un millimetro diventa una misura. */
    ogni('[data-mm]', function (el) {
      el.addEventListener('change', function () {
        var mm = parseFloat(el.value);
        var asse = el.dataset.mm;
        if (isNaN(mm) || mm <= 0) { riempi(); return; }
        Profile.macchina().corse[asse].corsaPassi = Profile.mmAPassi(asse, mm);
        applica();
        riempi();
      });
    });

    /* Il foglio sta nel profilo di stampa, ma lo disegna Paper: si passa da
       lui, che aggiorna anche il nome del formato e i campi della barra
       laterale, e poi si rilegge il nome. */
    ogni('[data-foglio]', function (el) {
      el.addEventListener('change', function () {
        var w = parseFloat(document.querySelector('#tab-impostazioni [data-foglio="larghezza"]').value);
        var h = parseFloat(document.querySelector('#tab-impostazioni [data-foglio="altezza"]').value);
        if (!(w > 0) || !(h > 0)) { riempi(); return; }
        Paper.setSize(w, h);
        var fo = Profile.stampa().foglio;
        fo.larghezza = w;
        fo.altezza = h;
        fo.formato = State.data.paper.name;
        applica();
      });
    });

    document.getElementById('btn-tara').addEventListener('click', function () {
      var asse = document.getElementById('tar-asse').value;
      var cmd = parseFloat(document.getElementById('tar-cmd').value);
      var mis = parseFloat(document.getElementById('tar-mis').value);
      var esito = document.getElementById('tar-esito');
      var r = Profile.taraAsse(asse, cmd, mis);
      if (!r.ok) {
        esito.textContent = r.motivo;
        esito.className = 'small v-blocco-testo';
        return;
      }
      esito.textContent = 'Asse ' + asse.toUpperCase() + ': ' + f3(r.prima) + ' → ' +
        f3(r.dopo) + ' mm per giro ingranaggio (' + r.scarto.toFixed(3) + '%). ' +
        'La corsa in passi non è stata toccata; quella in millimetri è cambiata.';
      esito.className = 'small v-ok-testo';
      Log.add('msg', 'Taratura asse ' + asse.toUpperCase() + ': ' + f3(r.dopo) +
                     ' mm per giro ingranaggio.');
      riempi();
      Paper.refreshArea();
    });

    document.getElementById('btn-gen-yaml').addEventListener('click', function () {
      scarica('cnc2d-config.yaml', Profile.toYaml(), 'text/yaml;charset=utf-8');
      var problemi = Profile.verifica().filter(function (p) { return p.gravita === 'blocco'; });
      Log.add(problemi.length ? 'err' : 'msg',
        problemi.length
          ? 'config.yaml generato, ma con ' + problemi.length + ' numeri non ancora ' +
            'tarati: i valori segnati DA TARARE nel file non sono buoni per lavorare.'
          : 'config.yaml generato. Caricalo dalla pagina web della macchina e riavvia con $Bye.');
    });

    document.getElementById('btn-prof-export').addEventListener('click', function () {
      scarica('profilo-cnc2d.json', Profile.toJson(), 'application/json;charset=utf-8');
      Log.add('msg', 'Profili esportati.');
    });

    var file = document.getElementById('prof-file');
    document.getElementById('btn-prof-import').addEventListener('click', function () {
      file.click();
    });
    file.addEventListener('change', function () {
      if (!this.files.length) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          Profile.fromJson(r.result);
          riempi();
          Paper.refreshArea();
          Log.add('msg', 'Profili importati.');
        } catch (e) {
          Log.add('err', 'Il file non è un profilo valido: ' + e.message);
        }
      };
      r.readAsText(this.files[0]);
      this.value = '';
    });

    document.getElementById('btn-prof-reset').addEventListener('click', function () {
      if (!window.confirm('Ripristinare i valori di partenza? Le tarature ' +
                          'fatte sulla macchina vanno perse.')) return;
      Profile.reset();
      riempi();
      Paper.refreshArea();
      Log.add('msg', 'Profili riportati ai valori di partenza.');
    });

    document.getElementById('btn-stampa-save').addEventListener('click', function () {
      var nome = Profile.salvaStampa(Profile.stampa().nome);
      libreria();
      Log.add('msg', 'Profilo di stampa salvato: ' + nome);
    });

    document.getElementById('btn-stampa-load').addEventListener('click', function () {
      var nome = document.getElementById('stampa-lib').value;
      if (!nome || !Profile.caricaStampa(nome)) return;
      var fo = Profile.stampa().foglio;
      Paper.setSize(fo.larghezza, fo.altezza);
      riempi();
      Log.add('msg', 'Profilo di stampa caricato: ' + nome);
    });

    document.getElementById('btn-stampa-del').addEventListener('click', function () {
      var nome = document.getElementById('stampa-lib').value;
      if (!nome) return;
      if (!window.confirm('Eliminare il profilo di stampa «' + nome + '»?')) return;
      Profile.eliminaStampa(nome);
      libreria();
      Log.add('msg', 'Profilo di stampa eliminato: ' + nome);
    });

    /* Connessione: vive nel browser, non nel profilo. */
    var host = document.getElementById('set-host');
    var mock = document.getElementById('set-mock');
    host.value = State.data.host;
    mock.checked = State.data.mock;

    host.addEventListener('change', function () {
      State.set('host', this.value.trim());
      document.getElementById('host').value = State.data.host;
    });

    mock.addEventListener('change', function () {
      State.set('mock', this.checked);
      Api.disconnect();
      Log.add('msg', this.checked
        ? 'Modalità finta attivata.'
        : 'Modalità finta disattivata: serve una macchina raggiungibile.');
    });

    riempi();
    State.on('paper', aggiorna);
  }

  return { init: init, riempi: riempi, aggiorna: aggiorna };
})();
