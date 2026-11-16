/* Dove trovare disegni: un elenco di collegamenti che cresce.
 *
 * E il pulsante «Crea / Edit», che sta qui perché è la stessa domanda — da
 * dove arriva il disegno — vista da due parti: o lo si prende fuori, o lo si
 * fa dentro.
 *
 * PERCHÉ NON NEL PROFILO. Il profilo descrive la macchina: corse, angoli del
 * servo, rapporto. È la cosa che si esporta e si rimette su un altro
 * computer, e un segnalibro non c'entra niente con una taratura. Sta in una
 * chiave sua, come le larghezze delle colonne.
 */
var Sorgenti = (function () {

  var KEY = 'gdc.cnc2d.sorgenti';

  /* Il primo ce lo mettiamo noi: l'operatore l'ha trovato e vale per tutti.
     Gli altri li aggiunge lui. */
  var DI_SERIE = [
    { url: 'https://bookofshapes.com/?sort=popular', nome: 'Book of Shapes' }
  ];

  /* LO STRUMENTO STAMPE sta in questo elenco e non altrove, ed e' una scelta
   * dell'utente del 2026-11-13: «va in dove trovare disegni, quell'elenco e'
   * nato per crescere». E' il posto giusto perche' la domanda e' la stessa --
   * da dove arriva il disegno --, ma non e' un segnalibro come gli altri e si
   * vede da tre cose:
   *
   *   HA UN NOME SUO. Aggiunto a mano, l'elenco lo chiamerebbe «127.0.0.1»,
   *   perche' il nome lo fa l'indirizzo. «127.0.0.1» non e' un nome.
   *
   *   HA UNA SPIA. Gli altri collegamenti sono siti: ci sono sempre. Questo e'
   *   un programma che gira sul computer dell'utente e la meta' del tempo non
   *   e' avviato, quindi un collegamento che non dice se risponde manda a
   *   sbattere contro una pagina che non si apre.
   *
   *   NON SI TOGLIE. Gli altri sono segnalibri e si buttano; questo e' un
   *   pezzo del programma. Quello che si cambia e' l'INDIRIZZO -- chi avvia lo
   *   strumento su un'altra porta (`--porta 9000`) deve poterlo dire.
   */
  var STRUMENTO = {
    url: 'http://127.0.0.1:8765/',
    nome: 'Strumento stampe',
    locale: true
  };

  var elenco = [];
  var risponde = null;      // null = non ancora chiesto, true/false = risposta
  var battito = null;       // il timer della spia
  /* VERO DA QUANDO L'UTENTE HA FATTO CAPIRE CHE LO STRUMENTO LO VUOLE: ha
     cliccato la spia, o si e' scaricato l'avviatore. Prima di quel momento la
     pagina non interroga nessuna porta -- vedi `pinga()`. */
  var cercato = false;

  function carica() {
    try {
      var raw = window.localStorage.getItem(KEY);
      elenco = raw ? JSON.parse(raw) : DI_SERIE.slice();
    } catch (e) {
      elenco = DI_SERIE.slice();
    }
    if (!Array.isArray(elenco)) elenco = DI_SERIE.slice();
    /* LO STRUMENTO SI AGGIUNGE ANCHE A CHI USAVA GIA' LA PAGINA. L'elenco sta
       in `localStorage` dal primo giorno, quindi `DI_SERIE` lo vede solo chi
       apre la pagina per la prima volta: senza questa riga, l'unica persona
       che non troverebbe mai la voce nuova e' l'utente. Si aggiunge dopo Book
       of Shapes, non in cima: il sito e' quello che si apre ogni giorno. */
    var c = 0;
    for (var i = 0; i < elenco.length; i++) if (elenco[i].locale) c++;
    if (!c) {
      elenco.splice(Math.min(1, elenco.length), 0,
                    { url: STRUMENTO.url, nome: STRUMENTO.nome, locale: true });
      salva();
    }
  }

  function vocelocale() {
    for (var i = 0; i < elenco.length; i++) if (elenco[i].locale) return elenco[i];
    return null;
  }

  function salva() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(elenco));
    } catch (e) { /* finestra anonima: l'elenco vive finché vive la pagina */ }
  }

  /* Il nome lo fa l'indirizzo: «bookofshapes.com» si legge, l'URL intero no.
     Via il `www.`, che non distingue niente da niente. */
  function nomeDa(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return url;
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function render() {
    var ul = document.getElementById('sorgenti-lista');
    if (!ul) return;
    if (!elenco.length) {
      ul.innerHTML = '<li class="sorgenti-vuoto">Nessun collegamento. ' +
                     'Incollane uno qui sotto.</li>';
      return;
    }
    var h = '';
    for (var i = 0; i < elenco.length; i++) {
      var s = elenco[i];
      /* `rel="noreferrer"` non è formalità: apre una pagina esterna da
         un'interfaccia che comanda una macchina, e quella pagina non ha
         nessun motivo di sapere da dove arriva né di poter toccare questa. */
      if (s.locale) {
        /* La spia prima del nome: si guarda quella, non la scritta. Il titolo
           dice che cosa vuol dire e che si puo' riprovare, perche' una spia
           spenta senza spiegazioni e' indistinguibile da una spia rotta. */
        h += '<li class="sorgente sorgente-locale">' +
             '<button type="button" class="led led-green' +
             (risponde ? ' is-on' : '') + '" data-sorg-spia' +
             ' title="' + (risponde === null ? 'Sto chiedendo allo strumento se c\'è'
                           : risponde ? 'Lo strumento risponde su ' + esc(s.url)
                           : 'Lo strumento non risponde: avvialo col file .bat qui sotto. Clicca per riprovare') +
             '" aria-label="Lo strumento risponde?"></button>' +
             '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" ' +
             'title="' + esc(s.url) + '">' + esc(s.nome) + '</a>' +
             '<button class="mini mini-edit" data-sorg-mod="' + i +
             '" title="Cambia l\'indirizzo: serve se avvii lo strumento su un\'altra porta"' +
             ' aria-label="Cambia indirizzo">&#9998;</button>' +
             '</li>';
        continue;
      }
      h += '<li class="sorgente">' +
           '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" ' +
           'title="' + esc(s.url) + '">' + esc(s.nome) + '</a>' +
           '<button class="mini mini-del" data-sorg-del="' + i +
           '" title="Togli questo collegamento" aria-label="Togli">&times;</button>' +
           '</li>';
    }
    ul.innerHTML = h;
  }

  function aggiungi(url) {
    url = String(url).trim();
    if (!url) return false;
    /* Senza schema il browser lo leggerebbe come percorso relativo e
       aprirebbe una pagina del programma invece del sito. */
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      new URL(url);
    } catch (e) {
      Log.add('err', 'Non sembra un indirizzo: ' + url);
      return false;
    }
    for (var i = 0; i < elenco.length; i++) {
      if (elenco[i].url === url) {
        Log.add('msg', 'Quel collegamento c\'è già.');
        return false;
      }
    }
    elenco.push({ url: url, nome: nomeDa(url) });
    salva();
    render();
    return true;
  }

  function togli(i) {
    if (i < 0 || i >= elenco.length) return;
    var s = elenco[i];
    if (!window.confirm('Tolgo il collegamento a ' + s.nome + '?')) return;
    elenco.splice(i, 1);
    salva();
    render();
  }

  /* --------------------------- LA SPIA --------------------------- */

  /* CHIEDERE ALLO STRUMENTO SE C'E', SENZA POTER LEGGERE LA RISPOSTA.
   *
   * La pagina gira da `file://` e lo strumento risponde su `127.0.0.1`: due
   * origini diverse, quindi il browser non lascia LEGGERE la risposta senza
   * un'intestazione CORS, che `strumento.py` oggi non manda.
   *
   * MA PER UNA SPIA NON SERVE LEGGERE NIENTE: serve sapere se qualcuno ha
   * risposto. Con `mode: 'no-cors'` il browser manda la richiesta e consegna
   * una risposta «opaca» -- un involucro vuoto che non si puo' aprire -- e la
   * promessa si risolve. Se sulla porta non c'e' nessuno, la promessa viene
   * rifiutata. Quella differenza e' esattamente la spia.
   *
   * CORREGGE IL PIANO DEL 2026-11-13, che dava la riga di CORS come
   * necessaria «sia alla spia sia al prelievo del risultato». Al prelievo si':
   * quello il contenuto lo deve leggere. Alla spia no, e quindi la spia
   * funziona da oggi, senza aspettare l'altro branch.
   *
   * L'ATTESA E' CORTA, un secondo e mezzo: una porta chiusa su `localhost`
   * rifiuta subito, ma dietro a un firewall la stessa richiesta puo' restare
   * appesa, e una spia che ci mette dieci secondi a dire «spento» e' una spia
   * che si guarda una volta sola.
   *
   * E NON SI CHIEDE NIENTE FINCHE' NON LO CHIEDE L'UTENTE. Il primo disegno
   * della spia la faceva partire all'apertura della pagina e ogni quindici
   * secondi: funzionava, e sporcava la CONSOLE del browser di
   * `ERR_CONNECTION_REFUSED` a ogni giro, perche' una richiesta a una porta
   * chiusa il browser la scrive li' e non c'e' modo di zittirla. Non e' un
   * fastidio estetico: dieci banchi di collaudo pretendono una console pulita,
   * e quel controllo ha trovato difetti veri -- indebolirlo in dieci file per
   * far posto a una spia sarebbe un cattivo scambio. Quindi la spia si
   * accende quando l'utente dice che lo strumento gli interessa: clicca la
   * spia, o si scarica l'avviatore. Da quel momento la pagina guarda anche da
   * sola, perche' e' il momento in cui lo strumento sta per partire.
   */
  function pinga() {
    var s = vocelocale();
    if (!s || typeof fetch !== 'function') return Promise.resolve(false);
    var base = String(s.url).replace(/\/+$/, '') + '/api/ping';
    var ac = (typeof AbortController === 'function') ? new AbortController() : null;
    var t = ac ? setTimeout(function () { try { ac.abort(); } catch (e) { /* già finita */ } }, 1500) : null;
    var opt = { mode: 'no-cors', cache: 'no-store' };
    if (ac) opt.signal = ac.signal;
    return fetch(base, opt).then(function () { return true; },
                                 function () { return false; })
      .then(function (ok) {
        if (t) clearTimeout(t);
        if (ok !== risponde) { risponde = ok; render(); }
        else risponde = ok;
        return ok;
      });
  }

  /* IL BATTITO SI FERMA QUANDO NESSUNO GUARDA: a scheda nascosta, in un'altra
     tab del programma, o durante una stampa -- la', il processore sta mandando
     il G-code alla macchina e una richiesta ogni quindici secondi non ha
     niente da dire a nessuno. */
  function serve() {
    if (document.hidden) return false;
    var t = document.getElementById('tab-disegno');
    if (t && !t.classList.contains('is-active')) return false;
    if (State.data.stampa && State.data.stampa.stato !== 'fermo') return false;
    return true;
  }

  function battiti() {
    if (battito) return;
    battito = setInterval(function () { if (cercato && serve()) pinga(); }, 15000);
  }

  /* Da qui in poi lo strumento interessa: la spia si guarda da sola. */
  function cerca() {
    cercato = true;
    battiti();
    return pinga();
  }

  /* ----------------------- L'AVVIATORE DELLO STRUMENTO ----------------------- */

  /* PERCHE' UN FILE DA SCARICARE E NON UN PULSANTE CHE AVVIA.
   * Una pagina web non lancia programmi sul computer, e non e' una mancanza
   * da aggirare: e' il confine che impedisce a QUALUNQUE pagina di farlo.
   * Quello che si puo' fare -- deciso con l'utente il 2026-11-13 -- e'
   * generare un file e dargliélo: a eseguirlo e' il comando «apri» del
   * browser, cioe' un click suo. Il confine resta dov'era.
   *
   * IL PERCORSO SI RICAVA DA DOVE STA LA PAGINA, e si scrive dentro al file
   * una volta sola: se la cartella del progetto si sposta, l'avviatore va
   * riscaricato. E' il motivo per cui il pulsante resta in pagina invece di
   * consegnare il file una volta e dimenticarsene.
   */
  function cartellaProgetto() {
    var h = String(location.href);
    if (h.indexOf('file:///') !== 0) return null;
    var p;
    try { p = decodeURIComponent(h.split('#')[0].split('?')[0]); } catch (e) { return null; }
    p = p.slice('file:///'.length);
    var pezzi = p.split('/');
    pezzi.pop();                                  // via il nome del file
    /* La pagina composta sta in `webui/dist/`, i sorgenti in `webui/`. Da uno
       dei due si risale alla radice del progetto; da altrove no, e dirlo e'
       meglio che indovinare: un avviatore con un percorso sbagliato apre una
       finestra nera che sparisce, e nessuno saprebbe perche'. */
    if (pezzi[pezzi.length - 1] === 'dist') pezzi.pop();
    if (pezzi[pezzi.length - 1] !== 'webui') return null;
    pezzi.pop();
    if (!pezzi.length) return null;
    /* WINDOWS O NO. Su Windows `file:///C:/...` da' un primo pezzo «C:», e il
       percorso vuole le barre rovesce; altrove la barra iniziale e' parte del
       percorso e togliendola si otterrebbe un percorso relativo che non
       esiste. L'avviatore in se' e' un `.bat`, quindi serve su Windows -- che
       e' il computer dell'utente -- ma una funzione che sbaglia il percorso
       dappertutto tranne che in un caso e' una funzione che non si puo'
       provare. */
    if (/^[A-Za-z]:$/.test(pezzi[0])) return pezzi.join('\\');
    return '/' + pezzi.join('/');
  }

  /* Il separatore che quel percorso usa: lo dice il percorso stesso. */
  function barra(radice) { return radice.indexOf('\\') >= 0 ? '\\' : '/'; }

  function testoAvviatore(radice) {
    var oggi = new Date().toISOString().slice(0, 10);
    return [
      '@echo off',
      'rem Avvia lo Strumento stampe del GDC CNC 2D SLICER.',
      'rem Generato dalla pagina il ' + oggi + '.',
      'rem Il percorso qui sotto e\' scritto una volta sola: se sposti la',
      'rem cartella del progetto, riscarica questo file dalla pagina.',
      'cd /d "' + radice + barra(radice) + 'stampe' + barra(radice) + 'strumento"',
      'if not exist strumento.py goto manca',
      'rem La finestra DEVE restare aperta: chiuderla spegne lo strumento.',
      'rem Parte ridotta a icona per non stare in mezzo.',
      'start /min "Strumento stampe" cmd /k python -B strumento.py',
      'exit /b',
      ':manca',
      'echo Non trovo strumento.py in questa cartella:',
      'echo    %CD%',
      'echo Scarica di nuovo l\'avviatore dalla pagina del SLICER.',
      'pause'
    ].join('\r\n') + '\r\n';
  }

  function scaricaAvviatore() {
    var radice = cartellaProgetto();
    if (!radice) {
      /* NON SI CONSEGNA UN FILE CHE NON PUO' FUNZIONARE. Da un indirizzo web
         -- l'iPad, o la pagina servita da altrove -- il percorso del progetto
         sul computer non si puo' sapere, e un `.bat` con un percorso
         inventato apre una finestra nera che sparisce. */
      Log.add('err', 'L\'avviatore si può generare solo aprendo questa pagina ' +
                     'dalla cartella del progetto sul computer ' +
                     '(webui/dist/cnc2d-ui.html). Da un indirizzo web il ' +
                     'percorso della cartella non si può sapere, e un file con ' +
                     'un percorso sbagliato aprirebbe una finestra nera che ' +
                     'sparisce.');
      return false;
    }
    var nome = 'avvia-strumento-stampe.bat';
    var blob = new Blob([testoAvviatore(radice)],
                        { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    /* Chi si scarica l'avviatore sta per avviare lo strumento: da adesso la
       spia lo cerca, e si accendera' da se' quando risponde. */
    cerca();
    Log.add('msg', 'Scaricato ' + nome + ', con dentro ' + radice + '. ' +
                   'Aprilo per avviare lo strumento — da qui in poi basta ' +
                   'Ctrl+J e un click sul file, ogni volta. La finestrella nera ' +
                   'che compare deve restare aperta: chiuderla spegne lo ' +
                   'strumento. Se sposti la cartella del progetto, riscarica ' +
                   'questo file.');
    return true;
  }

  /* --------------------- l'indirizzo dello strumento --------------------- */

  function cambiaIndirizzo(i) {
    var s = elenco[i];
    if (!s || !s.locale) return;
    if (!window.Nome || !document.getElementById('nome-modal')) return;
    Nome.chiedi({
      titolo: 'Indirizzo dello strumento',
      desc: 'Di serie è ' + STRUMENTO.url + '. Si cambia se avvii lo strumento ' +
            'su un\'altra porta (python strumento.py --porta 9000) o su un ' +
            'altro computer della rete.',
      valore: s.url,
      vuoto: 'Rimetti quello di serie',
      azione: 'Usa questo',
      ok: function (v) {
        var u = Nome.pulito(v);
        if (!u) u = STRUMENTO.url;
        if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
        /* `new URL` NON BASTA, e il banco l'ha dimostrato: `http://ht!tp://:::`
           lo accetta, con «ht!tp» come nome di macchina. Un indirizzo cosi'
           sostituirebbe quello buono, la spia si spegnerebbe e non ci sarebbe
           niente che spieghi perche' -- il difetto peggiore che questa
           finestrella possa fare, perche' butta via l'unica cosa che l'utente
           puo' cambiare qui. Si guarda anche il nome della macchina: lettere,
           cifre, punti e trattini, e nient'altro. */
        var uu;
        try { uu = new URL(u); } catch (e) { uu = null; }
        if (!uu || !/^https?:$/.test(uu.protocol) ||
            !/^[a-z0-9.-]+$/i.test(uu.hostname)) {
          Log.add('err', 'Non sembra un indirizzo: ' + u + '. Serve qualcosa ' +
                         'come http://127.0.0.1:8765 — macchina e porta.');
          return;
        }
        s.url = u;
        salva();
        risponde = null;
        render();
        pinga();
      }
    });
  }

  /* ------------------------ il pulsante Crea / Edit ----------------------- */

  function aggiornaPulsante() {
    var b = document.getElementById('btn-editor');
    if (!b) return;
    /* «Edit» quando c'è un LIVELLO scelto, non quando c'è un disegno
       qualsiasi: l'editor lavora su uno per volta, ed è quello che si apre. */
    var l = (window.Artwork && Artwork.livelli)
      ? Artwork.livelli().filter(function (x) { return x.scelto; })[0] : null;
    b.textContent = l ? 'Edit' : 'Crea';
    b.title = l
      ? 'Apri «' + l.nome + '» nell\'editor'
      : 'Comincia un disegno nuovo';
  }

  function init() {
    carica();
    render();

    var ul = document.getElementById('sorgenti-lista');
    if (ul) {
      ul.addEventListener('click', function (e) {
        var d = e.target.closest('[data-sorg-del]');
        if (d) { e.preventDefault(); togli(+d.dataset.sorgDel); return; }
        var m = e.target.closest('[data-sorg-mod]');
        if (m) { e.preventDefault(); cambiaIndirizzo(+m.dataset.sorgMod); return; }
        /* La spia si clicca per riprovare: e' la cosa che si fa appena si e'
           avviato lo strumento, invece di aspettare il battito. */
        if (e.target.closest('[data-sorg-spia]')) { e.preventDefault(); cerca(); }
      });
    }

    var form = document.getElementById('sorgenti-add');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var inp = document.getElementById('sorgenti-url');
        if (aggiungi(inp.value)) inp.value = '';
      });
    }

    var b = document.getElementById('btn-editor');
    if (b) {
      b.addEventListener('click', function () {
        var t = document.querySelector('.tab[data-tab="editor"]');
        if (t) t.click();
      });
    }

    var av = document.getElementById('btn-avviatore');
    if (av) av.addEventListener('click', scaricaAvviatore);

    State.on('path', aggiornaPulsante);
    aggiornaPulsante();

    /* NIENTE RICHIESTE ALL'APERTURA: vedi `pinga()`. Tornando a guardare la
       pagina si richiede soltanto se lo strumento e' stato cercato -- ed e'
       proprio quel momento che conta, perche' chi torna qui ha appena fatto
       partire il .bat e viene a vedere se la spia si e' accesa. */
    document.addEventListener('visibilitychange', function () {
      if (cercato && serve()) pinga();
    });
    var tb = document.querySelector('.tab[data-tab="disegno"]');
    if (tb) tb.addEventListener('click', function () {
      if (cercato) setTimeout(pinga, 50);
    });
  }

  return { init: init, aggiungi: aggiungi,
           elenco: function () { return elenco; },
           pinga: pinga, cerca: cerca, serve: serve,
           risponde: function () { return risponde; },
           cercato: function () { return cercato; },
           cartellaProgetto: cartellaProgetto, testoAvviatore: testoAvviatore,
           scaricaAvviatore: scaricaAvviatore, STRUMENTO: STRUMENTO };
})();
