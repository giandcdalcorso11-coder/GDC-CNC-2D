/* Comunicazione con FluidNC.
 *
 * Tutto il traffico verso la macchina passa da qui, e il trasporto è un
 * WEBSOCKET. Non è un dettaglio implementativo: è la correzione di un guasto.
 *
 * LA STRADA VECCHIA E PERCHÉ È STATA ABBANDONATA.
 * La prima versione mandava ogni comando su `/command?commandText=`, cioè una
 * richiesta HTTP per riga. Su quella rotta FluidNC crea un CANALE NUOVO per
 * ogni richiesta (`new WebClient()`), e un comando che non finisce subito se
 * lo tiene. `$LocalFS/Run` dura quanto il disegno, quindi la connessione del
 * browser resta appesa per tutta la stampa; quando cade, FluidNC prova a
 * distruggere un canale che il job sta ancora usando. Il 2026-10-23 due
 * stampe lunghe sono morte così, e il 2026-10-24 la causa è stata confermata
 * sulla macchina: lo stesso identico file lanciato dalla seriale arriva in
 * fondo.
 *
 * LA STRADA NUOVA.
 * Il WebSocket è l'opposto: UNO SOLO, aperto una volta, registrato in
 * `allChannels` esattamente come la UART. Verificato nel sorgente di FluidNC
 * (`WebUI/WSChannel.cpp`): i frame in arrivo finiscono in `push()`, cioè nel
 * buffer dei comandi, e i caratteri real-time hanno un instradamento loro.
 * È la seriale, via rete — ed è la seriale che ha dimostrato di reggere.
 *
 * DOVE VIVE. `ws://<host>/`, porta 80, sulla RADICE: in `WebUIServer.cpp` il
 * socket nasce come `new AsyncWebSocket("/")`. Non dà fastidio alla pagina,
 * perché l'upgrade si riconosce dagli header e non dal percorso.
 *
 * E I WEBSOCKET NON PASSANO PER IL CORS. Il controllo di origine non fa parte
 * del protocollo, e FluidNC non guarda l'header `Origin` (nel filtro degli
 * header di WebUIServer.cpp ci sono `Sec-WebSocket-Key` e
 * `Sec-WebSocket-Protocol`, `Origin` no). Quindi questa pagina parla con la
 * macchina anche quando è servita da altrove, ed è ciò che permette di
 * svilupparla prima di averla caricata sull'ESP32. Le rotte HTTP — l'upload
 * dei file, la lettura della configurazione — restano invece vincolate
 * all'origine, e quelle sì chiedono che la pagina stia sulla macchina.
 */
var Api = (function () {

  /* QUANTE RIGHE SI POSSONO TENERE IN VOLO.
   *
   * Il programma non si spara tutto insieme, e non è prudenza generica: il
   * lato in ingresso del WebSocket di FluidNC non ha né limite né freno —
   * `WS_EVT_DATA` passa il frame a `push()` senza guardare quanto è lungo e
   * senza nessuna contropressione. Riversargli duemilacinquecento righe in un
   * colpo vuol dire riempirgli la memoria, che su un ESP32 è il modo classico
   * di farlo morire. Avremmo scambiato un guasto con un altro.
   *
   * Il freno è l'`ok`. FluidNC risponde `ok` quando una riga è stata letta e
   * messa nel pianificatore: ogni `ok` è la prova che una riga ha liberato il
   * posto. Si tengono in volo al più FINESTRA righe non confermate.
   *
   * Perché una finestra e non il send-and-wait (manda una riga, aspetta,
   * manda la prossima): con una riga per volta il pianificatore resta vuoto, e
   * un pianificatore vuoto è una macchina che si ferma fra un segmento e
   * l'altro — su una curva fatta di segmenti da un decimo si vedrebbe e si
   * sentirebbe. La finestra serve a tenerlo pieno.
   *
   * 16 è prudente di proposito. Su una rete che risponde in 10 ms sono
   * comunque ~1600 righe al secondo, molto più di quanto la macchina riesca a
   * consumarne anche sul disegno più fitto. */
  var FINESTRA = 16;

  /* Ogni quanto si chiede la posizione. `?` è un carattere real-time: non
     entra in coda, non aspetta `ok`, non consuma la finestra. */
  var POLL_MS = 400;

  /* FluidNC manda `PING` da sé e risponde a `PING:` con i propri tempi di
     scadenza. Mandarne uno ogni tanto tiene viva la sessione anche quando il
     disegno è lungo e la pagina sta zitta. */
  var PING_MS = 10000;

  var ws = null;
  var rx = '';              // frammento di riga non ancora terminata
  var coda = [];            // righe in attesa di partire
  var volo = [];            // righe mandate e non ancora confermate
  var pollTimer = null, pingTimer = null;
  var aperto = null;        // {resolve, reject} della connect() in corso

  /* L'ultimo scostamento delle coordinate di lavoro comunicato dalla macchina.
     Serve perché il rapporto di stato di Grbl dà `MPos` (coordinate macchina) e
     manda `WCO` solo ogni tanto, per non ripeterlo in ogni riga: la posizione
     che interessa a noi è quella di LAVORO, cioè MPos − WCO, perché è quella
     azzerata dal `G92` sull'angolo dei blocchi. Senza questa sottrazione il DRO
     mostrerebbe numeri veri ma riferiti a un'origine che non è la nostra. */
  var wco = { x: 0, y: 0, z: 0 };

  function url() { return 'ws://' + State.data.host + '/'; }

  /* ----------------------------- invio ----------------------------- */

  /* Una riga di comando. Torna una promessa che si scioglie sull'`ok` della
     macchina e si rompe sull'`error:`. Chi la chiama può ignorarla (un jog) o
     usarla per contare (il Sender). */
  function send(line) {
    line = String(line).trim();
    if (!line) return Promise.resolve('');

    Log.add('cmd', line);
    if (State.data.mock) return mockReply(line);
    if (!ws || ws.readyState !== 1) {
      return Promise.reject(new Error('non collegata'));
    }

    return new Promise(function (resolve, reject) {
      coda.push({ line: line, resolve: resolve, reject: reject });
      pompa();
    });
  }

  /* Come send(), ma senza registrare la riga nel log: durante una stampa il
     registro diventerebbe migliaia di righe, e ridisegnarlo a ogni riga
     rallenta la pagina proprio mentre la macchina ha bisogno di essere
     alimentata. Chi stampa racconta l'avanzamento, non ogni comando. */
  function sendMuto(line) {
    line = String(line).trim();
    if (!line) return Promise.resolve('');
    if (State.data.mock) return Promise.resolve('ok');
    if (!ws || ws.readyState !== 1) {
      return Promise.reject(new Error('non collegata'));
    }
    return new Promise(function (resolve, reject) {
      coda.push({ line: line, resolve: resolve, reject: reject });
      pompa();
    });
  }

  /* I caratteri real-time scavalcano tutto: non entrano in coda, non aspettano
     `ok`, non consumano la finestra. È la loro ragione d'essere — un feed hold
     che si mettesse in fila dietro quattrocento righe non sarebbe un feed
     hold. FluidNC li intercetta in `handleRealtimeCharacter()` prima ancora di
     metterli nel buffer dei comandi. */
  function realtime(ch) {
    if (State.data.mock) { Log.add('cmd', '[rt] ' + ch); return; }
    if (!ws || ws.readyState !== 1) return;
    ws.send(ch);
  }

  function pompa() {
    while (coda.length && volo.length < FINESTRA) {
      var job = coda.shift();
      volo.push(job);
      ws.send(job.line + '\n');
    }
  }

  /* Quante righe sono nostre e non ancora confermate — in coda qui o in volo
     sulla rete. Il Sender la usa per decidere quando rifornire. */
  function inCoda() { return coda.length + volo.length; }

  /* Butta via quello che non è ancora partito. Le righe GIÀ in volo non si
     possono richiamare: sono dentro la macchina. Al più FINESTRA, cioè
     frazioni di secondo di movimento. */
  function svuota() {
    var persi = coda;
    coda = [];
    for (var i = 0; i < persi.length; i++) {
      persi[i].reject(new Error('annullata'));
    }
  }

  /* --------------------------- ricezione --------------------------- */

  function onFrame(ev) {
    var testo;
    if (typeof ev.data === 'string') {
      testo = ev.data;
    } else {
      /* FluidNC manda l'uscita del canale come frame BINARI (`_server->binary`
         in WSChannel.cpp) e solo i messaggi di servizio come testo. */
      testo = new TextDecoder('utf-8').decode(new Uint8Array(ev.data));
    }

    /* Un frame non è una riga: può contenerne tre, o mezza. Si accumula e si
       taglia sui ritorni a capo, tenendo da parte la coda incompleta. */
    rx += testo;
    var parti = rx.split('\n');
    rx = parti.pop();
    for (var i = 0; i < parti.length; i++) {
      riga(parti[i].replace(/\r$/, ''));
    }
  }

  function riga(l) {
    l = l.trim();
    if (!l) return;

    /* Messaggi di servizio del WebSocket, non risposte a un comando: li manda
       FluidNC da sé all'apertura e ogni tanto. Non vanno contati come `ok` e
       non vanno mostrati. */
    if (/^(PING|CURRENT_ID:|currentID:|activeID:)/.test(l)) return;

    if (l.charAt(0) === '<') { applyStatus(parseStatus(l)); return; }

    if (l === 'ok') { conferma(null); return; }

    if (/^error:/i.test(l)) {
      Log.add('err', l);
      conferma(new Error(l));
      return;
    }

    if (/^ALARM:/i.test(l)) {
      Log.add('err', l);
      State.set('machine', 'Alarm');
      return;
    }

    Log.add('msg', l);
  }

  /* Una risposta conferma la riga PIÙ VECCHIA ancora in volo: FluidNC risponde
     nell'ordine in cui ha ricevuto, quindi la coda è una fila e non un
     insieme. Se arriva un `ok` senza niente in volo è una risposta a un
     real-time o a qualcosa che non abbiamo mandato noi: si ignora, invece di
     sfasare il conto di tutte le righe successive. */
  function conferma(err) {
    if (!volo.length) return;
    var job = volo.shift();
    if (err) job.reject(err); else job.resolve('ok');
    pompa();
  }

  /* Il rapporto di stato di Grbl: <Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:...>
     Si accettano sia MPos sia WPos, perché quale dei due arrivi dipende dalla
     configurazione, e prendere quello sbagliato darebbe un DRO plausibile e
     falso invece di un errore visibile. */
  function parseStatus(txt) {
    var m = /^<([A-Za-z]+)[^>]*?\|(M|W)Pos:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(txt || '');
    if (!m) return null;

    var w = /\|WCO:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(txt);
    if (w) {
      wco = { x: parseFloat(w[1]), y: parseFloat(w[2]), z: parseFloat(w[3]) };
    }

    var p = { x: parseFloat(m[3]), y: parseFloat(m[4]), z: parseFloat(m[5]) };
    if (m[2] === 'M') { p.x -= wco.x; p.y -= wco.y; p.z -= wco.z; }

    return { state: m[1], pos: p };
  }

  function applyStatus(st) {
    if (!st) return;
    State.set('machine', st.state);
    State.data.pos = st.pos;
    State.emit('pos');
  }

  /* -------------------------- connessione -------------------------- */

  function connect() {
    if (State.data.mock) {
      setConnected(true);
      Log.add('msg', 'Modalità finta attiva: nessuna macchina collegata.');
      State.set('machine', 'Idle');
      return Promise.resolve();
    }

    disconnect();

    return new Promise(function (resolve, reject) {
      aperto = { resolve: resolve, reject: reject };
      try {
        ws = new WebSocket(url());
      } catch (e) {
        aperto = null;
        reject(new Error('indirizzo non valido: ' + url()));
        return;
      }
      ws.binaryType = 'arraybuffer';

      ws.onopen = function () {
        setConnected(true);
        Log.add('msg', 'Collegata a ' + url() + ' — un canale solo, persistente.');
        startPolling();
        startPing();
        if (aperto) { aperto.resolve(); aperto = null; }
      };

      ws.onmessage = onFrame;

      ws.onerror = function () {
        if (aperto) { aperto.reject(new Error('non raggiungibile')); aperto = null; }
      };

      /* La chiusura va raccontata forte: se succede mentre una stampa è in
         corso, quella stampa è interrotta e la macchina sta finendo le righe
         che ha già dentro. Chi sta stampando se ne accorge perché le sue
         promesse si rompono tutte insieme. */
      ws.onclose = function () {
        var stavaStampando = volo.length > 0 || coda.length > 0;
        rompiTutto(new Error('collegamento caduto'));
        stopPolling();
        stopPing();
        setConnected(false);
        State.set('machine', 'Off');
        if (stavaStampando) {
          Log.add('err', 'Collegamento caduto mentre c\'erano righe in volo: ' +
                         'la macchina sta eseguendo quelle che ha già ricevuto.');
        } else {
          Log.add('msg', 'Collegamento chiuso.');
        }
      };
    });
  }

  function rompiTutto(err) {
    var tutti = volo.concat(coda);
    volo = []; coda = []; rx = '';
    for (var i = 0; i < tutti.length; i++) tutti[i].reject(err);
  }

  function disconnect() {
    stopPolling();
    stopPing();
    if (ws) {
      ws.onclose = null;          // la chiusura la stiamo decidendo noi
      try { ws.close(); } catch (e) { /* già chiuso */ }
      ws = null;
    }
    rompiTutto(new Error('disconnessa'));
    setConnected(false);
    State.set('machine', 'Off');
  }

  function setConnected(v) {
    if (State.data.connected !== v) State.set('connected', v);
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () { realtime('?'); }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === 1) ws.send('PING:');
    }, PING_MS);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  /* --- comandi di alto livello, così i moduli non scrivono G-code a mano --- */

  function jog(axis, delta, feed) {
    return send('$J=G91 ' + axis + delta + ' F' + (feed || 1000));
  }

  function setOrigin() {
    return send('G92 X0 Y0');
  }

  /* ------------------------- homing a mano -------------------------
     Niente finecorsa: il riferimento sono i blocchi stampati agganciati alle
     staffe, e i carrelli ci si appoggiano a mano. Col motore no — la sua coppia
     basta a spostare il blocco, cioè a spostare la cosa che definisce la misura.

     `$MD` libera i motori. Riattivarli non ha un comando suo: in FluidNC li
     riaccende il primo comando di movimento, e quel comando è lo spostamento
     al punto home — cinque millimetri contati, non un jog di servizio. */
  function motoriLiberi() {
    return send('$MD').then(function (r) {
      State.data.motoriLiberi = true;
      State.set('azzerata', false);
      State.emit('motoriLiberi');
      Log.add('msg', 'Motori liberi: la posizione non è più nota. Appoggia i ' +
                     'carrelli ai blocchi, poi premi «Homing completato».');
      return r;
    });
  }

  /* L'ORDINE È QUELLO, E NON È INDIFFERENTE.
     Si azzera PRIMA e si muove DOPO. Qualunque movimento fatto prima del `G92`
     porta il carrello via dai blocchi, e lo zero finisce dove il carrello è
     arrivato invece che sul riferimento. La versione precedente mandava un
     `$J=G91 X0.01 F100` per «riabilitare i motori», e sbagliava due volte: con
     33,953 passi/mm quei 0,01 mm sono 0,34 passi, cioè zero passi arrotondati,
     quindi non riabilitava niente; e se avesse mosso, avrebbe mosso nel
     momento peggiore.

     Finisce al PUNTO HOME, non sui blocchi: lo zero resta il punto ai blocchi,
     ma i carrelli non ci restano appoggiati. Un carrello fermo contro il
     riferimento prima o poi lo sposta, e il riferimento è proprio la cosa che
     non si deve muovere. */
  function homingFatto() {
    var h = Profile.macchina().homing.puntoHome;
    return setOrigin().then(function () {
      State.data.pos = { x: 0, y: 0, z: State.data.pos.z };
      State.data.motoriLiberi = false;
      State.emit('motoriLiberi');
      State.emit('pos');
      State.set('azzerata', true);
      Log.add('msg', 'Azzerata sul punto ai blocchi. Mi sposto al punto home, ' +
                     'X ' + h.x.toFixed(1) + ' Y ' + h.y.toFixed(1) + '.');
      return vaiA(h.x, h.y);
    });
  }

  /* Spostamento assoluto nel sistema di coordinate dell'ultimo azzeramento. */
  function vaiA(x, y) {
    return send('G90 G0 X' + Number(x).toFixed(3) + ' Y' + Number(y).toFixed(3) +
                ' F' + Profile.stampa().velocitaSpostamento);
  }

  /* La penna in millimetri veri, non in gradi: la conversione gradi→impulso la
     fa il config.yaml generato dal profilo, quindi qui Z è già quota di punta.
     Zero è il contatto col foglio. */
  function penna(mm) {
    if (mm === null || isNaN(mm)) return Promise.resolve();
    return send('G90 G1 Z' + Number(mm).toFixed(3) + ' F600');
  }

  function led(index, on) {
    return send((on ? 'M62 P' : 'M63 P') + index);
  }

  function feedHold()   { realtime('!'); }
  function cycleStart() { realtime('~'); }
  function reset()      { realtime(String.fromCharCode(0x18)); }

  /* ------------------------- modalità finta ------------------------- */

  function mockReply(line) {
    var reply = 'ok';
    if (line === '?') {
      reply = '<' + State.data.machine + '|MPos:' +
        State.data.pos.x.toFixed(3) + ',' +
        State.data.pos.y.toFixed(3) + ',' +
        State.data.pos.z.toFixed(3) + '|FS:0,0>';
    } else if (line.indexOf('$J=') === 0) {
      var m = /([XYZ])(-?[\d.]+)/g, g;
      while ((g = m.exec(line))) {
        var k = g[1].toLowerCase();
        State.data.pos[k] += parseFloat(g[2]);
      }
      State.emit('pos');
    } else if (line.indexOf('G92') === 0) {
      State.data.pos.x = 0;
      State.data.pos.y = 0;
      State.emit('pos');
    } else if (line.indexOf('G90 G1 Z') === 0) {
      State.data.pos.z = parseFloat(line.slice(8));
      State.emit('pos');
    } else if (line.indexOf('G90 G0 ') === 0) {
      var a = /X(-?[\d.]+)\s+Y(-?[\d.]+)/.exec(line);
      if (a) {
        State.data.pos.x = parseFloat(a[1]);
        State.data.pos.y = parseFloat(a[2]);
        State.emit('pos');
      }
    }
    Log.add('msg', reply);
    return Promise.resolve(reply);
  }

  return {
    send: send, sendMuto: sendMuto, realtime: realtime,
    inCoda: inCoda, svuota: svuota,
    connect: connect, disconnect: disconnect,
    jog: jog, setOrigin: setOrigin, led: led,
    motoriLiberi: motoriLiberi, homingFatto: homingFatto,
    penna: penna, vaiA: vaiA,
    feedHold: feedHold, cycleStart: cycleStart, reset: reset,
    parseStatus: parseStatus
  };
})();
