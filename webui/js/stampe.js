/* LE TAB DELLE STAMPE: una seconda visione di quello che sta succedendo.
 *
 * Una tab nasce da sola quando parte una stampa, e resta anche dopo che è
 * finita. A differenza delle altre si può chiudere, perché non è una parte
 * del programma: è il racconto di UNA stampa, e di stampe se ne fanno tante.
 *
 * A COSA SERVE DAVVERO. Il telecomando dice tre cose su un vetro da tre
 * centimetri: a che punto è, che penna monta, se è finita. Qui c'è lo stesso
 * racconto con lo spazio per guardarlo — il percorso che avanza sul foglio,
 * la riga di G-code che la macchina sta eseguendo adesso, i cambi penna
 * segnati dove cadono, e tutto quello che è stato detto da quando è partita.
 * Non sostituisce il telecomando: è la stessa cosa vista da vicino, e serve
 * anche a capire se il telecomando sta dicendo il vero.
 *
 * OGNI TAB SI PORTA VIA UNA COPIA DELLA SUA STAMPA, ed è la decisione che fa
 * funzionare tutto il resto. Il programma, il foglio, i colori, le righe: al
 * momento in cui la stampa parte diventano roba sua. Se leggesse lo stato
 * vivo — `State.data.path`, il foglio di adesso, i livelli di adesso —
 * basterebbe caricare un altro disegno per riscrivere la storia di una
 * stampa già fatta, e una tab che resta aperta dopo diventerebbe un racconto
 * falso. Che è esattamente il contrario del motivo per cui esiste.
 *
 * IL PERCORSO SI RICAVA DAL G-CODE e non dal disegno sul foglio. Costa un
 * parser di venti righe, e dà due cose che il disegno non può dare: è
 * davvero quello che la macchina ha ricevuto — ottimizzatore compreso — e
 * ogni tratto sa da quale RIGA viene, quindi «a che punto siamo» non è una
 * proporzione ma una corrispondenza esatta.
 */
var Stampe = (function () {

  /* Quante tab si tengono. Oltre, la più vecchia fra quelle finite se ne va:
     una stampa che non si guarda più da sei stampe fa non vale la riga che
     occupa, e una fila di tab che non ci sta è peggio di una tab in meno. */
  var MAX = 6;

  var elenco = [];        // { id, nome, dati, nodi, stato, ... }
  var seq = 0;
  var corrente = null;    // la tab della stampa in corso, se ce n'è una
  var statoPrima = 'fermo';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function n(v) { return Math.round(v * 1000) / 1000; }

  /* ===================== DAL G-CODE AL PERCORSO =====================
   *
   * Le righe arrivano già ripulite dal Sender: niente commenti, e i due
   * segni — cambio penna e penna da montare — sono stringhe che cominciano
   * con un carattere nullo, quindi non si confondono con un comando.
   *
   * LO STATO È MODALE, e dimenticarlo è il modo classico di sbagliare: una
   * riga «X120» vuol dire «Y resta dov'è», e leggerla come «Y zero»
   * porterebbe il tratto dall'altra parte del foglio. Si tengono X, Y e Z
   * fra una riga e l'altra, come fa la macchina.
   *
   * PENNA GIÙ O SU si decide dalla quota più bassa che compare nel
   * programma: è quella di contatto, perché più in giù non si va. Tutto
   * quello che sta più su è spostamento. Non si prende dal profilo apposta:
   * un programma salvato ieri porta la SUA quota, e il profilo nel frattempo
   * può essere cambiato.
   */
  function percorso(righe) {
    var i, m, zMin = null;

    /* Primo giro: la quota di contatto di QUESTO programma. */
    for (i = 0; i < righe.length; i++) {
      m = /(?:^|\s)Z(-?\d+(?:\.\d+)?)/.exec(righe[i]);
      if (m) {
        var z = parseFloat(m[1]);
        if (zMin === null || z < zMin) zMin = z;
      }
    }
    var soglia = (zMin === null) ? -1e9 : zMin + 0.05;

    var x = null, y = null, zc = null, penna = null, modo = null;
    var segmenti = [], pause = [], penne = [];

    for (i = 0; i < righe.length; i++) {
      var r = righe[i];

      if (r.charCodeAt(0) === 0) {
        if (r.indexOf('\u0000cambio-penna') === 0) { pause.push(i); continue; }
        if (r.indexOf('\u0000penna:') === 0) {
          var d = r.slice(7).split('\u0000');
          penna = { colore: d[0] === '-' ? null : d[0],
                    mm: d[1] ? parseFloat(d[1]) : null,
                    nome: d[2] || '' };
          penne.push({ riga: i, penna: penna });
          continue;
        }
        continue;
      }

      /* ANCHE LA PAROLA «G» È MODALE, e dimenticarlo qui è stato il difetto
         peggiore di questo file: il generatore la scrive SOLO quando cambia
         — vedi muovi() in gcode.js — quindi quasi tutte le righe di una
         stampa vera sono due numeri e basta, «X70.123 Y45.2». Pretendendo
         una G in testa si scartava il 98% del programma: il percorso veniva
         VUOTO, senza nessun errore da nessuna parte. Scritto a mano il
         programma di prova la G c'era sempre, e la prova passava.
         Le altre G — G21, G90, G4 — non sono movimenti e non cambiano il
         modo: si leggono tutte e si tiene l'ultima che vale 0 o 1. */
      var mg = /(?:^|\s)G(\d+)/g, gg;
      while ((gg = mg.exec(r))) {
        var v = parseInt(gg[1], 10);
        if (v === 0 || v === 1) modo = v;
      }

      var mx = /(?:^|\s)X(-?\d+(?:\.\d+)?)/.exec(r);
      var my = /(?:^|\s)Y(-?\d+(?:\.\d+)?)/.exec(r);
      var mz = /(?:^|\s)Z(-?\d+(?:\.\d+)?)/.exec(r);
      if (mz) zc = parseFloat(mz[1]);
      if (!mx && !my) continue;                 // una Z sola non è un tratto
      if (modo === null) continue;              // coordinate prima di ogni G

      var nx = mx ? parseFloat(mx[1]) : x;
      var ny = my ? parseFloat(my[1]) : y;
      if (x !== null && y !== null && (nx !== x || ny !== y)) {
        segmenti.push({ riga: i, x1: x, y1: y, x2: nx, y2: ny,
                        giu: zc !== null && zc <= soglia,
                        colore: penna && penna.colore ? penna.colore : null });
      }
      x = nx; y = ny;
    }

    return { segmenti: segmenti, pause: pause, penne: penne, zContatto: zMin };
  }

  /* ========================= IL DISEGNO =========================
   *
   * Un SVG suo, in millimetri, col solito gruppo che ribalta la Y: in SVG
   * cresce verso il basso, sulla macchina verso l'alto.
   *
   * I tratti sono DUE path e non mille righe. Il percorso fatto si ridisegna
   * due volte al secondo mentre la stampa va, e accendere o spegnere una
   * classe su tremila elementi a ogni respiro fa arrancare la pagina proprio
   * mentre serve guardarla. Due stringhe `d` ricostruite da pezzi già
   * pronti costano un decimo.
   */
  function vista(t) {
    var p = t.dati.foglio, perc = t.perc;
    var bx0 = Math.min(0, p.x), by0 = Math.min(0, p.y);
    var bx1 = Math.max(p.x + p.w, 1), by1 = Math.max(p.y + p.h, 1);
    for (var i = 0; i < perc.segmenti.length; i++) {
      var s = perc.segmenti[i];
      bx0 = Math.min(bx0, s.x1, s.x2); by0 = Math.min(by0, s.y1, s.y2);
      bx1 = Math.max(bx1, s.x1, s.x2); by1 = Math.max(by1, s.y1, s.y2);
    }
    var mg = 8;
    return { x0: bx0 - mg, y0: by0 - mg,
             w: (bx1 - bx0) + 2 * mg, h: (by1 - by0) + 2 * mg };
  }

  function pezzi(perc) {
    /* Un frammento `d` per segmento, calcolato una volta sola: da qui in poi
       aggiornare il disegno è tagliare un elenco e unirlo. */
    var out = [];
    for (var i = 0; i < perc.segmenti.length; i++) {
      var s = perc.segmenti[i];
      out.push('M' + n(s.x1) + ' ' + n(s.y1) + 'L' + n(s.x2) + ' ' + n(s.y2));
    }
    return out;
  }

  function disegna(t) {
    var p = t.dati.foglio, v = vista(t), perc = t.perc;
    var out = '<svg class="st-svg" viewBox="' + n(v.x0) + ' ' + n(v.y0) + ' ' +
              n(v.w) + ' ' + n(v.h) + '" preserveAspectRatio="xMidYMid meet">' +
              '<g transform="translate(0,' + n(2 * v.y0 + v.h) + ') scale(1,-1)">';

    out += '<rect class="st-foglio" x="' + n(p.x) + '" y="' + n(p.y) +
           '" width="' + n(p.w) + '" height="' + n(p.h) + '" rx="0.6"' +
           (p.colore ? ' style="fill:' + esc(p.colore) + '"' : '') + '></rect>';

    /* Gli spostamenti a penna alzata stanno SOTTO a tutto il resto: sono il
       contorno della faccenda, non il disegno. */
    var su = [], giu = [];
    for (var i = 0; i < perc.segmenti.length; i++) {
      (perc.segmenti[i].giu ? giu : su).push(t.pezzi[i]);
    }
    out += '<path class="st-su" d="' + su.join('') + '"></path>';
    out += '<path class="st-giu" d="' + giu.join('') + '"></path>';
    out += '<path class="st-fatto" d=""></path>';

    /* I cambi penna dove cadono: il punto in cui la macchina si fermerà. */
    for (i = 0; i < perc.pause.length; i++) {
      var q = primoPunto(perc, perc.pause[i]);
      if (!q) continue;
      out += '<circle class="st-pausa" cx="' + n(q.x) + '" cy="' + n(q.y) +
             '" r="2"></circle>';
    }

    out += '<circle class="st-punta" cx="0" cy="0" r="1.6" visibility="hidden"></circle>';
    out += '</g></svg>';
    return out;
  }

  /* Dove riprende il disegno dopo una pausa: il primo tratto che viene dopo
     quella riga. È lì che si va a cambiare la penna, ed è il punto che si
     vuole vedere segnato. */
  function primoPunto(perc, riga) {
    for (var i = 0; i < perc.segmenti.length; i++) {
      if (perc.segmenti[i].riga > riga) {
        return { x: perc.segmenti[i].x2, y: perc.segmenti[i].y2 };
      }
    }
    return null;
  }

  /* ===================== LA TAB: NASCITA E MORTE ===================== */

  function nuova() {
    var prog = Sender.programma();
    if (!prog.righe.length) return null;

    var pap = State.data.paper, org = State.data.sheetOrigin;
    var dati = {
      nome: prog.nome,
      inizio: Date.now(),
      righe: prog.righe,
      foglio: { x: org.x, y: org.y, w: pap.w, h: pap.h,
                nome: pap.name,
                colore: (window.Paper && Paper.colore) ? Paper.colore() : null }
    };

    var t = {
      id: 'stampa-' + (++seq),
      numero: seq,
      dati: dati,
      perc: percorso(prog.righe),
      stato: 'invio',
      fatte: 0,
      fine: null,
      registro: []
    };
    t.pezzi = pezzi(t.perc);

    costruisci(t);
    elenco.push(t);
    potatura();
    return t;
  }

  function costruisci(t) {
    var nav = document.querySelector('nav.tabs');
    var wrap = document.createElement('span');
    wrap.className = 'tab-wrap';
    wrap.id = 'tabw-' + t.id;
    /* Il pulsante di chiusura sta FUORI dal pulsante della tab e non dentro:
       un bottone dentro un bottone non è HTML valido, e il browser lo
       riscrive come gli pare. Stessa ragione dei fogli nella barra laterale. */
    wrap.innerHTML =
      '<button class="tab" data-tab="' + t.id + '" role="tab">' +
      'Stampa ' + t.numero + '<span class="tab-spia" id="spia-' + t.id + '"></span>' +
      '</button>' +
      '<button class="tab-chiudi" data-chiudi="' + t.id + '" disabled ' +
      'title="Si chiude quando la stampa è finita" aria-label="Chiudi">×</button>';
    nav.appendChild(wrap);

    var panel = document.createElement('main');
    panel.className = 'panel';
    panel.id = 'tab-' + t.id;
    panel.innerHTML =
      '<div class="st-wrap">' +
        '<div class="st-vista" id="vista-' + t.id + '">' + disegna(t) + '</div>' +
        '<aside class="st-lato">' +
          '<div class="st-testa">' +
            '<h2 id="tit-' + t.id + '">' + esc(t.dati.nome) + '</h2>' +
            '<span class="st-badge" id="badge-' + t.id + '">in corso</span>' +
          '</div>' +
          '<div class="st-barra"><div class="st-barra-dentro" id="barra-' + t.id + '"></div></div>' +
          '<div class="readout st-dati" id="dati-' + t.id + '"></div>' +
          '<div class="st-sez">G-code</div>' +
          '<pre class="st-code" id="code-' + t.id + '"></pre>' +
          '<div class="st-sez">Quello che è successo</div>' +
          '<div class="st-log" id="reg-' + t.id + '"></div>' +
        '</aside>' +
      '</div>';
    document.body.appendChild(panel);
  }

  function chiudi(id) {
    var t = trova(id);
    if (!t || t === corrente) return;
    var w = document.getElementById('tabw-' + id);
    var p = document.getElementById('tab-' + id);
    var attiva = p && p.classList.contains('is-active');
    if (w) w.parentNode.removeChild(w);
    if (p) p.parentNode.removeChild(p);
    elenco.splice(elenco.indexOf(t), 1);
    /* Chiudendo quella che si stava guardando non si resta senza niente
       davanti: si torna al disegno, che è il posto da cui si parte. */
    if (attiva) vaiA('disegno');
  }

  function potatura() {
    while (elenco.length > MAX) {
      var vittima = null;
      for (var i = 0; i < elenco.length; i++) {
        if (elenco[i] !== corrente) { vittima = elenco[i]; break; }
      }
      if (!vittima) return;
      Log.add('msg', 'La tab della stampa ' + vittima.numero + ' si è chiusa ' +
                     'da sé: se ne tengono ' + MAX + '.');
      chiudi(vittima.id);
    }
  }

  function trova(id) {
    for (var i = 0; i < elenco.length; i++) if (elenco[i].id === id) return elenco[i];
    return null;
  }

  function vaiA(nome) {
    var b = document.querySelector('.tab[data-tab="' + nome + '"]');
    if (b) b.click();
  }

  /* ========================= L'AGGIORNAMENTO ========================= */

  var ETICHETTA = {
    invio: 'in corso', pausa: 'in pausa', cambio: 'cambio penna',
    fine: 'finita', fermata: 'fermata', errore: 'errore'
  };

  /* CHI E` ANCORA LA STAMPA DEL SENDER. Non «chi sta stampando»: finche'
     non ne parte un'altra, lo stato del Sender racconta ancora questa, anche
     dopo che e' finita. Tenerli separati conta: le righe confermate
     continuano ad arrivare per un momento DOPO che la stampa e' stata
     dichiarata finita — il Sender dichiara la fine quando la macchina si
     ferma, e le ultime conferme possono seguire — e una tab che smettesse
     di ascoltare in quell'istante resterebbe ferma a meta' percorso con la
     stampa finita. L'ha trovato il banco, dove le conferme arrivano tutte
     insieme e il buco diventa grande come la stampa intera. */
  function sua(t) { return t === corrente; }

  /* Se c'e' ancora qualcosa che si muove. Decide tre cose e nient'altro: se
     raccogliere le righe del registro, se la × si puo' premere, e se ha
     senso mostrare la punta e lo stato della macchina. */
  function viva(t) {
    return t.stato === 'invio' || t.stato === 'pausa' || t.stato === 'cambio';
  }

  function aggiorna(t) {
    var s = State.data.stampa;
    if (sua(t)) {
      t.stato = s.stato;
      t.fatte = s.fatte;
    }

    var badge = document.getElementById('badge-' + t.id);
    if (badge) {
      badge.textContent = ETICHETTA[t.stato] || t.stato;
      badge.className = 'st-badge st-' + t.stato;
    }

    var quante = t.dati.righe.length;
    var pc = quante ? Math.round(t.fatte * 100 / quante) : 0;
    var barra = document.getElementById('barra-' + t.id);
    if (barra) barra.style.width = pc + '%';

    /* I TRATTI FATTI. `fatte` conta le righe confermate dalla macchina, e
       ogni segmento sa da quale riga viene: il confine fra fatto e da fare è
       una disuguaglianza, non una proporzione. */
    var fatto = [];
    for (var i = 0; i < t.perc.segmenti.length; i++) {
      if (t.perc.segmenti[i].riga >= t.fatte) break;
      if (t.perc.segmenti[i].giu) fatto.push(t.pezzi[i]);
    }
    var box = document.getElementById('vista-' + t.id);
    var path = box && box.querySelector('.st-fatto');
    if (path) path.setAttribute('d', fatto.join(''));

    /* La punta dove sta adesso: l'ultimo punto raggiunto. Sparisce quando la
       stampa non è più in corso — una punta ferma in mezzo al foglio
       direbbe che la macchina è ancora lì, e non ci è più. */
    var punta = box && box.querySelector('.st-punta');
    if (punta) {
      var q = null;
      for (i = 0; i < t.perc.segmenti.length; i++) {
        if (t.perc.segmenti[i].riga >= t.fatte) break;
        q = t.perc.segmenti[i];
      }
      var mostra = q && viva(t);
      punta.setAttribute('visibility', mostra ? 'visible' : 'hidden');
      if (q) {
        punta.setAttribute('cx', n(q.x2));
        punta.setAttribute('cy', n(q.y2));
      }
    }

    riquadroDati(t, pc);
    riquadroCodice(t);
  }

  function durata(ms) {
    var sec = Math.round(ms / 1000);
    var m = Math.floor(sec / 60), ss = sec % 60;
    if (m < 60) return m + ' min ' + ('0' + ss).slice(-2) + ' s';
    return Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) + ' min';
  }

  /* IL NOME DELLA PENNA, non quello del file. Nel programma il segno della
     penna porta il colore e il nome del LIVELLO — «gdc master.svg» — che
     dice da dove viene il disegno e non che cosa montare. Se quel colore è
     una delle penne in cassetto si chiama col nome che le hai dato tu:
     «blu» si capisce senza guardare, «#1f4fa8» no, e «gdc master.svg»
     nemmeno. È lo stesso ragionamento della finestra del cambio penna. */
  function nomePenna(pen) {
    if (!pen) return '—';
    var fuori = null;
    if (pen.colore && window.Artwork && Artwork.tavolozza) {
      Artwork.tavolozza().forEach(function (q) {
        if (q.colore === pen.colore) fuori = q.nome;
      });
    }
    var come = fuori || pen.nome || pen.colore || '—';
    return come + (pen.mm ? ' ' + String(pen.mm).replace('.', ',') + ' mm' : '');
  }

  function riquadroDati(t, pc) {
    var el = document.getElementById('dati-' + t.id);
    if (!el) return;
    var s = State.data.stampa, vivo = viva(t);
    var fin = t.fine || Date.now();

    var pen = null;
    for (var i = 0; i < t.perc.penne.length; i++) {
      if (t.perc.penne[i].riga < t.fatte) pen = t.perc.penne[i].penna;
    }

    var righe = [
      ['Avanzamento', pc + '%  ·  ' + t.fatte + ' righe su ' + t.dati.righe.length],
      ['Penna', pen ? (pen.colore
          ? '<span class="tinta" style="background:' + esc(pen.colore) + '"></span> '
          : '') + esc(nomePenna(pen)) : '—'],
      ['Cambi penna', t.perc.pause.length ? t.perc.pause.length : 'nessuno'],
      ['Foglio', esc(t.dati.foglio.nome || '') + ' ' + n(t.dati.foglio.w) +
                 ' × ' + n(t.dati.foglio.h) + ' mm'],
      ['Durata', durata(fin - t.dati.inizio) + (t.fine ? '' : ' finora')],
      ['Macchina', vivo ? esc(State.data.machine) : '—'],
      ['Mancante', vivo && s.rimanente ? Sender.durata(s.rimanente / 1000) : '—']
    ];
    var out = '';
    for (i = 0; i < righe.length; i++) {
      out += '<div class="ro"><span>' + righe[i][0] + '</span><b>' +
             righe[i][1] + '</b></div>';
    }
    el.innerHTML = out;
  }

  /* LA FINESTRA SUL G-CODE: la riga in corso, con un po' di prima e un po'
     di dopo. Non il programma intero — sono migliaia di righe, e trovarci
     dentro quella che conta sarebbe un lavoro — e non la riga sola, che
     senza le vicine non dice dove si è. */
  var INTORNO = 9;

  function riquadroCodice(t) {
    var el = document.getElementById('code-' + t.id);
    if (!el) return;
    var k = Math.min(t.fatte, t.dati.righe.length - 1);
    var da = Math.max(0, k - INTORNO), a = Math.min(t.dati.righe.length, k + INTORNO + 1);
    var out = '';
    for (var i = da; i < a; i++) {
      var r = t.dati.righe[i], cl = 'st-r';
      if (r.indexOf('\u0000cambio-penna') === 0) { r = '— cambio penna —'; cl += ' st-r-pausa'; }
      else if (r.indexOf('\u0000penna:') === 0) {
        var d = r.slice(7).split('\u0000');
        r = '— penna: ' + (d[2] || d[0]) + (d[1] ? ' ' + d[1] + ' mm' : '') + ' —';
        cl += ' st-r-pausa';
      }
      if (i === k) cl += ' st-r-ora';
      else if (i < k) cl += ' st-r-fatta';
      out += '<div class="' + cl + '"><span class="st-n">' + (i + 1) + '</span>' +
             esc(r) + '</div>';
    }
    el.innerHTML = out;
  }

  function registra(t, riga) {
    t.registro.push(riga);
    if (t.registro.length > 400) t.registro.shift();
    var el = document.getElementById('reg-' + t.id);
    if (!el) return;
    var attaccato = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    el.insertAdjacentHTML('beforeend',
      '<div class="log-line"><span class="log-time">' + riga.time + '</span>' +
      '<span class="log-' + riga.kind + '">' + esc(riga.text) + '</span></div>');
    /* Si scorre da sé solo se si stava guardando il fondo: chi è andato a
       rileggere una riga di mezz'ora fa non vuole essere riportato in fondo
       ogni due secondi. */
    if (attaccato) el.scrollTop = el.scrollHeight;
  }

  /* ========================= GLI AGGANCI ========================= */

  /* QUANDO NASCE UNA TAB. Non a ogni «invio»: riprendere da una pausa o da
     un cambio penna passa per lo stesso stato, e sarebbe una tab nuova per
     la stessa stampa. Nasce quando si passa da «non sta stampando» a
     «sta stampando». */
  function partita(prima, ora) {
    return ora === 'invio' &&
           (prima === 'fermo' || prima === 'fine' || prima === 'fermata' ||
            prima === 'errore');
  }

  function finita(s) {
    return s === 'fine' || s === 'fermata' || s === 'errore';
  }

  function suStampa() {
    var ora = State.data.stampa.stato;

    if (partita(statoPrima, ora)) {
      var t = nuova();
      if (t) {
        /* Da qui in avanti il Sender racconta questa: la precedente si
           congela con i numeri che ha. */
        corrente = t;
        vaiA(t.id);
        Log.add('msg', 'Tab «Stampa ' + t.numero + '» aperta: lì c\'è il ' +
                       'percorso che avanza, il G-code riga per riga e tutto ' +
                       'quello che succede da adesso in poi.');
      }
    }

    if (corrente) {
      aggiorna(corrente);
      if (finita(ora) && !corrente.fine) {
        corrente.fine = Date.now();
        var b = document.querySelector('[data-chiudi="' + corrente.id + '"]');
        if (b) {
          b.disabled = false;
          b.title = 'Chiudi il racconto di questa stampa';
        }
        var spia = document.getElementById('spia-' + corrente.id);
        if (spia) spia.className = 'tab-spia tab-spia-' + ora;
        aggiorna(corrente);
      }
      /* `corrente` NON si azzera qui: resta la stampa del Sender finche' non
         ne parte un'altra, e fino ad allora le righe che continuano ad
         arrivare sono ancora sue. Chi deve sapere se c'e' qualcosa che si
         muove guarda `viva()`, che e' una domanda diversa. */
    }
    statoPrima = ora;
  }

  function init() {
    State.on('stampa', suStampa);
    /* La macchina cambia stato anche quando la stampa non cambia: il
       riquadro dei dati lo dice, e deve dirlo subito. */
    State.on('machine', function () { if (corrente) aggiorna(corrente); });
    /* Il registro di una stampa raccoglie finche' quella stampa succede. La
       riga «Stampa finita» ci entra: il Sender la scrive PRIMA di cambiare
       stato, quindi quando arriva qui la stampa e' ancora viva, ed e' giusto
       che l'ultima riga del racconto sia come e' andata a finire. */
    Log.ascolta(function (riga) {
      if (corrente && viva(corrente)) registra(corrente, riga);
    });

    /* La chiusura: un ascoltatore sulla barra, perché le tab nascono e
       muoiono mentre la pagina è aperta. */
    var nav = document.querySelector('nav.tabs');
    if (nav) {
      nav.addEventListener('click', function (e) {
        var b = e.target.closest('[data-chiudi]');
        if (!b || b.disabled) return;
        e.stopPropagation();
        chiudi(b.dataset.chiudi);
      });
    }
  }

  return {
    init: init,
    /* Per il banco: quante ce ne sono, e che cosa raccontano. */
    aperte: function () {
      return elenco.map(function (t) {
        return { id: t.id, numero: t.numero, nome: t.dati.nome,
                 stato: t.stato, fatte: t.fatte,
                 righe: t.dati.righe.length,
                 tratti: t.perc.segmenti.length,
                 pause: t.perc.pause.length,
                 foglio: t.dati.foglio };
      });
    },
    chiudi: chiudi
  };
})();
