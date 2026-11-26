/* Il collaudo del DIALOGO col telecomando, cioe' della cosa che si e' rotta
 * in silenzio: non quello che il telecomando fa, ma il fatto che i messaggi
 * continuino a partire comunque vada.
 *
 * PERCHE' ESISTE. `fetch` non scade da solo. Se il telecomando accetta la
 * connessione e poi non risponde -- ha 32 kB di memoria, un WiFi solo e uno
 * schermo da ridisegnare -- la promessa resta appesa per sempre, `inVolo`
 * resta vero per sempre, e da quel momento al telecomando non arriva piu'
 * niente. Il vetro resta sulla schermata che aveva, che a stampa in corso e'
 * proprio quella della stampa: la fine non gli viene mai detta, il suono non
 * parte, e il registro non dice niente perche' il `catch` non scatta.
 *
 * La prova finge esattamente quello: una fetch che non risponde mai.
 *
 * Uso:  node webui/tools/prova-telecomando.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await page.goto(PAGINA);
  await page.waitForTimeout(300);

  /* SI PARTE DA UN TELECOMANDO CHE RISPONDE, perche' e' il caso vero: la
     scheda c'e', ha risposto tutta la stampa, e si pianta sul piu' bello.
     Un indirizzo che non ha mai funzionato e' un'altra storia, e lo slicer
     giustamente non va a lamentarsi di uno che non ha mai visto. */
  await page.evaluate(() => {
    window.__chiamate = 0;
    window.__interrotte = 0;
    window.__risponde = true;
    window.fetch = function (u, opt) {
      window.__chiamate++;
      if (window.__risponde) {
        return Promise.resolve({ ok: true, json: function () {
          return Promise.resolve({ batteria: 61, carica: 'batteria' });
        } });
      }
      /* La fetch che non risponde mai, e che si lascia interrompere come
         quella vera: e' il caso che conta, perche' una che fallisce subito
         il codice la gestiva gia'. */
      return new Promise(function (_, reject) {
        if (opt && opt.signal) {
          opt.signal.addEventListener('abort', function () {
            window.__interrotte++;
            const e = new Error('interrotta');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    };
    Telecomando.dove('192.0.2.1');     // indirizzo di documentazione: non esiste
  });

  await page.waitForTimeout(600);
  let r = await page.evaluate(() => Telecomando.stato());
  ok('il telecomando che risponde viene visto', r.visto === true,
     'visto ' + r.visto + ', batteria ' + r.batteria);

  /* E ADESSO SI PIANTA: accetta la connessione e non risponde piu'. */
  await page.evaluate(() => {
    window.__risponde = false;
    window.__chiamate = 0;
  });

  /* LA COSA CHE SI CONTROLLA DAVVERO: che i messaggi continuino a partire.
     Prima della correzione il conto restava fermo a uno -- non per un
     minuto, PER SEMPRE -- e con lui si fermava tutto quello che il
     telecomando doveva sapere, la fine della stampa compresa. */
  await page.waitForTimeout(15000);
  r = await page.evaluate(() => ({ chiamate: window.__chiamate,
                                   interrotte: window.__interrotte,
                                   visto: Telecomando.stato().visto }));
  ok('e i messaggi continuano a partire anche se nessuno risponde',
     r.chiamate >= 3, r.chiamate + ' chiamate in quindici secondi');
  ok('ognuno viene interrotto a tempo invece di restare appeso',
     r.interrotte >= 2, r.interrotte + ' interrotte');

  /* E LO DICE. Una cosa rotta che non dice di esserlo e' la peggiore. */
  r = await page.evaluate(() => {
    const righe = [...document.querySelectorAll('#log-view .log-line')]
      .map((x) => x.textContent);
    return { righe: righe.filter((t) => /telecomando/i.test(t)).slice(-4) };
  });
  ok('e il registro lo dice invece di tacere',
     r.righe.some((t) => /non raggiungibile|smesso di rispondere/i.test(t)),
     r.righe.join(' / ').slice(0, 160));

  /* E UNA VOLTA CHE RISPONDE, si riparte: la porta si riapre da sola, senza
     che l'utente debba rimettere l'indirizzo. */
  await page.evaluate(() => { window.__risponde = true; });
  await page.waitForTimeout(6000);
  r = await page.evaluate(() => Telecomando.stato());
  ok('e quando torna a rispondere riparte da solo',
     r.visto === true && r.batteria === 61,
     'visto ' + r.visto + ', batteria ' + r.batteria);

  /* ============ IL FOGLIO NEL MESSAGGIO (2026-11-07) ============
     Dal piano a piu' fogli, il telecomando deve poter dire «foglio 3 di
     9»: con l'ordine per penna la punta salta da un foglio all'altro di
     continuo, e chi guarda una percentuale che sale non sa se il magnete
     che ha davanti e' finito.

     Si guarda il messaggio VERO, quello che parte: si cattura il corpo
     della fetch invece di chiedere alla pagina che cosa pensa di mandare. */
  r = await page.evaluate(async () => {
    const aspetta = (ms) => new Promise((f) => setTimeout(f, ms));
    window.__corpi = [];
    const vera = window.fetch;
    window.fetch = function (u, opt) {
      if (opt && opt.body) window.__corpi.push(String(opt.body));
      return vera.apply(this, arguments);
    };
    window.__risponde = true;

    /* Un foglio solo: niente foglio nel messaggio. «Foglio 1 di 1» non
       distingue niente, e occuperebbe una riga sul vetro per dirlo. */
    State.data.stampa = { stato: 'invio', nome: 'x', fatte: 1, totale: 9,
                          percento: 11, rimanente: null, penna: null,
                          foglio: { n: 1, di: 1 } };
    State.emit('stampa');
    await aspetta(500);
    const uno = window.__corpi.slice(-1)[0] || '';

    window.__corpi.length = 0;
    State.data.stampa = { stato: 'invio', nome: 'x', fatte: 2, totale: 9,
                          percento: 22, rimanente: null, penna: null,
                          foglio: { n: 3, di: 9 } };
    State.emit('stampa');
    await aspetta(500);
    const nove = window.__corpi.slice(-1)[0] || '';
    return { uno: uno, nove: nove };
  });
  ok('con piu` fogli il messaggio dice su quale si sta andando',
     /"foglio":\{"n":3,"di":9\}/.test(r.nove),
     (r.nove.match(/"foglio":(\{[^}]*\}|null)/) || ['—'])[0]);
  ok('e con un foglio solo non lo dice', /"foglio":null/.test(r.uno),
     (r.uno.match(/"foglio":(\{[^}]*\}|null)/) || ['—'])[0]);

  /* E IL FOGLIO CHE CAMBIA FA PARTIRE UN MESSAGGIO SUBITO, come lo stato:
     cambia un numero sul vetro, e aspettare il giro dopo vorrebbe dire
     leggere il foglio sbagliato mentre si guarda la macchina lavorarci
     sopra. La percentuale no -- quella cambia cento volte per stampa. */
  r = await page.evaluate(async () => {
    const aspetta = (ms) => new Promise((f) => setTimeout(f, ms));
    const giro = async (foglio, percento) => {
      window.__corpi.length = 0;
      State.data.stampa = { stato: 'invio', nome: 'x', fatte: 3, totale: 9,
                            percento: percento, rimanente: null, penna: null,
                            foglio: foglio };
      State.emit('stampa');
      await aspetta(120);
      return window.__corpi.length;
    };
    await giro({ n: 3, di: 9 }, 30);
    const soloPercento = await giro({ n: 3, di: 9 }, 31);
    const cambioFoglio = await giro({ n: 4, di: 9 }, 32);
    return { soloPercento, cambioFoglio };
  });
  ok('cambiando foglio il messaggio parte subito, cambiando percentuale no',
     r.soloPercento === 0 && r.cambioFoglio > 0,
     'solo la percentuale: ' + r.soloPercento + ' messaggi, col foglio: ' +
     r.cambioFoglio);

  /* ============ IL CURSORE DEL VOLUME DICE LA VERITA' ============
   *
   * Il 2026-11-09 l'operatore: «il volume nelle impostazioni mi segna 10,
   * l'altro giorno avevo provato ad abbassarlo a 2, ma chiudendo lo slicer
   * e' rimasto quello senza possibilita' di rimodificarlo». Era vero, e il
   * motivo e' l'ordine: `Settings.init()` costruisce il cursore PRIMA che
   * `Telecomando.init()` legga il valore salvato, quindi il cursore
   * mostrava il predefinito. Rimetterlo a 10 non mandava niente, perche' a
   * 10 ci era gia': il comando non si poteva piu' dare, e ogni stampa
   * partiva col volume 2 — la strada del PWM, quella che piantava il
   * telecomando.
   *
   * SERVE UNA PAGINA NUOVA, con il valore gia' nel localStorage prima che
   * la pagina parta: e' l'unico modo di rifare l'ordine vero. */
  {
    const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const err2 = [];
    p2.on('pageerror', (e) => err2.push(String(e)));
    await p2.addInitScript(() => {
      try { localStorage.setItem('cnc2d-telecomando-volume', '2'); } catch (e) { /* privata */ }
    });
    await p2.goto(PAGINA);
    await p2.waitForTimeout(400);
    await p2.click('.tab[data-tab="impostazioni"]');
    await p2.waitForTimeout(200);
    const v = await p2.evaluate(() => ({
      cursore: document.getElementById('set-tele-volume').value,
      scritto: document.getElementById('set-tele-volume-n').textContent,
      inVigore: Telecomando.volume()
    }));
    ok('il cursore del volume mostra quello salvato, non il predefinito',
       v.cursore === '2' && v.scritto === '2' && v.inVigore === 2,
       'cursore ' + v.cursore + ', scritto ' + v.scritto +
       ', in vigore ' + v.inVigore);

    /* E QUANDO I DUE NUMERI NON COINCIDONO LO DICE. Il telecomando rimanda
       il volume in ogni risposta apposta; fino al 2026-11-09 nessuno lo
       leggeva, e una differenza fra quello chiesto e quello in vigore non
       si vedeva da nessuna parte. */
    const nota = await p2.evaluate(() => {
      State.set('telecomando', Object.assign({}, State.data.telecomando,
                                             { volume: 10, volumeVero: 2 }));
      return document.getElementById('set-tele-volume-nota').textContent;
    });
    ok('e dice quando il telecomando ne ha un altro',
       /telecomando dice di avere 2/.test(nota), nota.slice(0, 80));
    ok('nessun errore nella pagina del volume', err2.length === 0, err2.join(' | '));
    await p2.close();
  }

  /* ============ ZITTO DURANTE UNA STAMPA (2026-11-26) ============
   *
   * La sera del 25 l'operatore ha collegato il telecomando MENTRE stampava:
   * `dove()` faceva partire il battito subito e al ritmo veloce, quattro
   * decimi. Tredici secondi dopo e' caduta la WebSocket di FluidNC e la
   * stampa si e' fermata alla riga 2170 di 7058.
   *
   * Due cose separate, e questa prova guarda la prima: non si aggiunge
   * traffico alla rete nel momento in cui la macchina sta disegnando. Che
   * sia stato il traffico a far cadere il collegamento non e' accertato --
   * e' proprio per questo che la seconda riparazione fa scrivere il codice
   * di chiusura. Ma il momento in cui si apre una seconda conversazione lo
   * si puo' scegliere, e questo e' il peggiore possibile. */
  {
    const p3 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const err3 = [];
    p3.on('pageerror', (e) => err3.push(String(e)));
    await p3.goto(PAGINA);
    await p3.waitForTimeout(300);

    const r3 = await p3.evaluate(async () => {
      const aspetta = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__n = 0;
      window.fetch = function () {
        window.__n++;
        return Promise.resolve({ ok: true, json: function () {
          return Promise.resolve({ batteria: 50, carica: 'batteria' });
        } });
      };
      /* La stampa in corso si finge dal Sender, che e' chi `dove()`
         interroga: il resto della macchina qui non serve. */
      Sender.inCorso = function () { return true; };
      Telecomando.dove('192.0.2.7');
      await aspetta(1500);
      const durante = { n: window.__n, zitto: Telecomando.stato().zitto,
                        salvato: Telecomando.stato().indirizzo };

      /* LE DUE STRADE CHE RESTEREBBERO APERTE. `dove()` non chiama `manda()` e
         `battito()` non arma il timer, quindi il silenzio regge da solo -- ma
         il pulsante «Manda adesso» e il cursore del volume chiamano `manda()`
         di loro, e senza la guardia dentro a `manda()` passerebbero. Il
         2026-11-26 la mutazione che toglieva quella guardia non veniva vista
         da nessuno: era vero che il codice era giusto, ed era vero che nessun
         controllo lo diceva. */
      Telecomando.manda();
      Telecomando.volume(4);
      await aspetta(350);
      durante.forzati = window.__n;
      durante.mandaSpento = document.getElementById('btn-tele-manda').disabled;

      /* Finisce la stampa: il Sender lo dice, e lo stato cambia. */
      Sender.inCorso = function () { return false; };
      State.set('stampa', { stato: 'fine', nome: '', fatte: 9, totale: 9,
                            percento: 100, rimanente: 0 });
      await aspetta(900);
      const dopo = { n: window.__n, zitto: Telecomando.stato().zitto };
      const righe = [...document.querySelectorAll('#log-view .log-line')]
        .map((x) => x.textContent);
      return { durante: durante, dopo: dopo, righe: righe };
    });

    ok('con una stampa in corso l\'indirizzo si salva e non parte niente',
       r3.durante.n === 0 && r3.durante.zitto === true &&
       r3.durante.salvato === '192.0.2.7',
       r3.durante.n + ' messaggi, zitto ' + r3.durante.zitto +
       ', salvato "' + r3.durante.salvato + '"');
    ok('nemmeno Manda adesso o il cursore del volume rompono il silenzio',
       r3.durante.forzati === 0, r3.durante.forzati + ' messaggi forzati');
    ok('e il pulsante Manda adesso resta spento',
       r3.durante.mandaSpento === true, 'disabled ' + r3.durante.mandaSpento);
    ok('e il registro dice perche\', invece di sembrare rotto',
       r3.righe.some((t) => /stampa in corso.*resta zitto/i.test(t)),
       (r3.righe.filter((t) => /zitto/i.test(t))[0] || '(niente)').slice(0, 110));
    ok('finita la stampa comincia a parlare da solo',
       r3.dopo.n > 0 && r3.dopo.zitto === false,
       r3.dopo.n + ' messaggi dopo la fine, zitto ' + r3.dopo.zitto);

    /* ---- IL PRIMO TASTO DOPO UN SILENZIO NON E' UN COMANDO ----
     *
     * Il firmware rileva il FRONTE (`onTouchDown`) e tiene il tasto in
     * `daMandare` finche' lo SLICER non passa a prenderlo. L'indirizzo lo si
     * legge dallo schermo del telecomando, quindi mentre lo si configura lo
     * si ha in mano, e i pad sono capacitivi: nel cassetto c'e' quasi sempre
     * qualcosa. Alla prima chiamata quel qualcosa arriverebbe come se fosse
     * appena stato premuto -- e «pausa» o «riprendi» entrano dalla stessa
     * porta da cui entrerebbe un dito sulla pagina. */
    const r4 = await p3.evaluate(async () => {
      const aspetta = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__tasto = 'pausa';
      window.fetch = function () {
        return Promise.resolve({ ok: true, json: function () {
          return Promise.resolve({ batteria: 50, carica: 'batteria',
                                   tasto: window.__tasto });
        } });
      };
      /* Si stacca e si riattacca: e' il silenzio che arma lo scarto. */
      Telecomando.dove('');
      await aspetta(100);
      const prima = document.querySelectorAll('#log-view .log-line').length;
      Telecomando.dove('192.0.2.7');
      /* Due giri buoni: a stampa ferma il ritmo e' RITMO_FERMO, due secondi,
         e il secondo messaggio e' proprio quello che deve portare il tasto
         vero dopo che il primo e' stato buttato. */
      await aspetta(2600);
      const nuove = [...document.querySelectorAll('#log-view .log-line')]
        .map((x) => x.textContent).slice(prima);
      return { nuove: nuove };
    });

    ok('il primo tasto dopo un silenzio viene scartato e scritto',
       r4.nuove.some((t) => /scartato un .pausa./i.test(t)),
       (r4.nuove.filter((t) => /scartato/i.test(t))[0] || '(niente)').slice(0, 110));
    ok('e il secondo invece arriva al Sender',
       r4.nuove.some((t) => /Telecomando: pausa\./.test(t)),
       (r4.nuove.filter((t) => /Telecomando: pausa/.test(t))[0] || '(niente)'));

    /* ---- UNA RISPOSTA IN VOLO NON RIARMA IL BATTITO ----
     *
     * E' l'unica strada per cui la guardia dentro a `battito()` serve davvero,
     * e il 2026-11-26 non la guardava nessuno. Succede cosi': il telecomando
     * sta gia' parlando, parte una stampa, e l'utente ritocca l'indirizzo.
     * `dove()` spegne il timer, ma il messaggio gia' partito quando torna
     * indietro chiama `battito()` in coda alla risposta -- e senza guardia il
     * battito riparte in mezzo alla stampa, che e' esattamente la cosa che si
     * voleva evitare. */
    const r6 = await p3.evaluate(async () => {
      const aspetta = (ms) => new Promise((r) => setTimeout(r, ms));
      let sblocca = null;
      window.__m = 0;
      window.fetch = function () {
        window.__m++;
        return new Promise(function (res) {
          sblocca = function () {
            res({ ok: true, json: function () {
              return Promise.resolve({ batteria: 50, carica: 'batteria' });
            } });
          };
        });
      };
      Sender.inCorso = function () { return false; };
      Telecomando.dove('192.0.2.8');        // parte, e resta in volo
      await aspetta(200);
      const inVolo = window.__m;

      Sender.inCorso = function () { return true; };
      Telecomando.dove('192.0.2.9');        // adesso si stampa: zitto
      if (sblocca) sblocca();               // la risposta vecchia torna
      await aspetta(1500);
      return { inVolo: inVolo, dopo: window.__m,
               zitto: Telecomando.stato().zitto };
    });

    ok('una risposta arrivata dopo non riarma il battito',
       r6.inVolo === 1 && r6.dopo === 1 && r6.zitto === true,
       r6.inVolo + ' in volo, ' + r6.dopo + ' in tutto, zitto ' + r6.zitto);

    ok('nessun errore nella pagina dello zitto', err3.length === 0, err3.join(' | '));
    await p3.close();
  }

  /* ============ PERCHE' E' CADUTO IL COLLEGAMENTO (2026-11-26) ============
   *
   * Sta in questo banco e non in uno suo perche' e' la seconda meta' dello
   * stesso guasto: quando la stampa del 25 e' morta, `ws.onclose` ignorava
   * l'evento e scriveva solo «collegamento caduto». Rete sparita e scheda
   * riavviata sono due cose diverse, con due rimedi diversi -- l'una si
   * ritenta, l'altra ha perso il `G92` e vuole l'origine rifatta -- e la
   * differenza era dentro all'evento che stavamo buttando via.
   *
   * 1006 e' il codice che non arriva da nessuna parte: nessun messaggio di
   * chiusura, cioe' la connessione e' sparita sotto. */
  {
    const p4 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const err4 = [];
    p4.on('pageerror', (e) => err4.push(String(e)));
    await p4.addInitScript(() => {
      /* Una WebSocket finta che si apre e si lascia chiudere a comando. */
      window.WebSocket = function () {
        window.__ws = this;
        this.readyState = 1;
        this.send = function () {};
        this.close = function () {};
        const me = this;
        setTimeout(function () { if (me.onopen) me.onopen(); }, 10);
      };
      window.WebSocket.prototype = {};
    });
    await p4.goto(PAGINA);
    await p4.waitForTimeout(300);

    const r5 = await p4.evaluate(async () => {
      const aspetta = (ms) => new Promise((r) => setTimeout(r, ms));
      State.set('mock', false);
      Api.connect();
      await aspetta(200);
      const prima = document.querySelectorAll('#log-view .log-line').length;
      /* IL GESTORE SI CHIAMA DENTRO A UN try. Non e' prudenza generica: se
         `onclose` perdesse il parametro, dentro esploderebbe un
         ReferenceError, l'eccezione uscirebbe da `evaluate` e porterebbe giu'
         tutto il banco -- e un banco che muore non stampa il KO, quindi la
         mutazione risulterebbe NON VISTA pur avendo rotto davvero qualcosa.
         E' successo il 2026-11-26. Qui l'errore si cattura e il controllo
         sotto fallisce come deve. */
      try { window.__ws.onclose({ code: 1006, wasClean: false }); }
      catch (e) { window.__esploso = String(e); }
      await aspetta(150);
      const a = [...document.querySelectorAll('#log-view .log-line')]
        .map((x) => x.textContent).slice(prima);

      Api.connect();
      await aspetta(200);
      const prima2 = document.querySelectorAll('#log-view .log-line').length;
      try { window.__ws.onclose({ code: 1001, wasClean: true }); }
      catch (e) { window.__esploso = String(e); }
      await aspetta(150);
      const b = [...document.querySelectorAll('#log-view .log-line')]
        .map((x) => x.textContent).slice(prima2);
      return { rete: a, riavvio: b, esploso: window.__esploso || '' };
    });

    ok('una chiusura senza saluto dice 1006 e che e\' la rete',
       r5.rete.some((t) => /1006/.test(t) && /rete o WiFi/i.test(t) &&
                           /non pulita/.test(t)),
       (r5.rete.filter((t) => /Chiusura/.test(t))[0] || '(niente)').slice(0, 120));
    ok('e un riavvio della scheda dice 1001, che e\' un\'altra cosa',
       r5.riavvio.some((t) => /1001/.test(t) && /riavvio della scheda/i.test(t)),
       (r5.riavvio.filter((t) => /Chiusura/.test(t))[0] || '(niente)').slice(0, 120));
    ok('e il gestore della chiusura non esplode', r5.esploso === '', r5.esploso);
    ok('nessun errore nella pagina della chiusura', err4.length === 0, err4.join(' | '));
    await p4.close();
  }

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
