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

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
