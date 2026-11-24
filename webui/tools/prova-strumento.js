/* Il collaudo del COLLEGAMENTO ALLO STRUMENTO STAMPE: la voce nell'elenco
 * con la sua spia, e l'avviatore che si scarica.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO, e che non si puo' dedurre leggendo il
 * codice: se la SPIA funziona. La pagina gira da `file://`, lo strumento
 * risponde su `127.0.0.1`, e in mezzo c'e' la politica delle origini del
 * browser -- che `strumento.py` oggi non placa con nessuna intestazione CORS.
 * La scommessa e' che per una spia non serva LEGGERE la risposta, ma solo
 * sapere se qualcuno ha risposto, e che `mode: 'no-cors'` basti a distinguere
 * i due casi. Questo banco accende un server vero sulla porta dello strumento
 * e guarda se la spia si accende: e' la differenza fra una cosa provata e una
 * cosa sperata.
 *
 * E LA SECONDA: che l'avviatore non venga consegnato quando non puo'
 * funzionare. Il percorso del progetto si ricava da dove sta la pagina, e da
 * un indirizzo web -- l'iPad -- non si puo' sapere: un `.bat` con un percorso
 * inventato apre una finestra nera che sparisce, e nessuno saprebbe perche'.
 * Qui la pagina si apre in due modi, da `file://` e da `http://`, e si guarda
 * che nel secondo caso rifiuti e lo dica.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-strumento.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');
const PAGINA = 'file://' + DIST;

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Lo strumento finto: la stessa porta e la stessa rotta di `strumento.py`
   (8765, /api/ping), e NESSUNA intestazione CORS -- come il vero. Mettercela
   qui renderebbe il controllo una decorazione: proverebbe un server che non
   esiste. */
function strumentoFinto(porta) {
  let chieste = 0;
  const srv = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/api/ping') {
      chieste++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((f) => srv.listen(porta, '127.0.0.1',
    () => f({ srv: srv, quante: () => chieste })));
}

/* La pagina servita via HTTP, per la scena dell'iPad: la' `location.href` non
   e' un percorso del computer, e l'avviatore non si puo' generare. */
function paginaServita(porta) {
  const corpo = fs.readFileSync(DIST);
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(corpo);
  });
  return new Promise((f) => srv.listen(porta, '127.0.0.1', () => f(srv)));
}

/* LEGGERE IL DOM SENZA MORIRE. Con la voce dello strumento assente --
   che e' quello che succede rompendo di proposito la riga che la aggiunge --
   `document.querySelector('[data-sorg-spia]').classList` lancia, il banco
   muore a meta' e i controlli che venivano dopo non esistono: la mutazione
   risulta «non vista» accusando un controllo che non ha potuto nemmeno
   girare. E' la trappola registrata il 2026-11-08 («due letture del DOM che
   facevano MORIRE il banco invece di farlo fallire»), e qui si evita leggendo
   tutto con una guardia: quando l'elemento non c'e', il controllo FALLISCE. */
const LEGGISPIA = `(() => {
  const b = document.querySelector('[data-sorg-spia]');
  return { c: !!b, acceso: b ? b.classList.contains('is-on') : false,
           titolo: b ? b.title : '' };
})()`;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 },
                                         acceptDownloads: true });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  const scaricati = [];
  page.on('download', async (d) => {
    const p = await d.path();
    scaricati.push({ nome: d.suggestedFilename(),
                     testo: p ? fs.readFileSync(p, 'utf-8') : '' });
  });

  await page.goto(PAGINA);
  await page.waitForTimeout(600);

  let r;

  /* ============ A. LA VOCE NELL'ELENCO ============ */
  r = await page.evaluate(() => {
    const e = Sorgenti.elenco();
    const l = e.filter((x) => x.locale);
    return { quante: l.length, nome: l[0] && l[0].nome, url: l[0] && l[0].url,
             posto: e.findIndex((x) => x.locale),
             primo: e[0] && e[0].nome };
  });
  ok('lo strumento è nell\u2019elenco dei collegamenti',
     r.quante === 1 && /^http:\/\/127\.0\.0\.1:8765/.test(r.url), r.url);
  /* IL NOME E` SUO, e non e' un vezzo: aggiunto a mano, l'elenco lo
     chiamerebbe «127.0.0.1», perche' il nome lo fa l'indirizzo. */
  ok('e ha un nome suo, non l\u2019indirizzo', r.nome === 'Strumento stampe', r.nome);
  ok('e sta dopo Book of Shapes, che è quello che si apre ogni giorno',
     r.posto === 1 && /Book/.test(r.primo), r.primo + ' poi ' + r.nome);

  r = await page.evaluate(() => {
    const li = document.querySelector('.sorgente-locale');
    return {
      c: !!li,
      spia: li ? !!li.querySelector('[data-sorg-spia]') : false,
      matita: li ? !!li.querySelector('[data-sorg-mod]') : false,
      cestino: li ? !!li.querySelector('[data-sorg-del]') : true,
      titolo: li && li.querySelector('[data-sorg-spia]')
        ? li.querySelector('[data-sorg-spia]').title : ''
    };
  });
  ok('la sua riga ha una spia e la matita dell\u2019indirizzo',
     r.c && r.spia && r.matita);
  /* NON SI TOGLIE: gli altri sono segnalibri, questo e' un pezzo del
     programma. Un cestino che lo fa sparire e lo fa tornare al ricaricamento
     e' un comando che mente. */
  ok('e non ha il cestino: non è un segnalibro da buttare', r.cestino === false);

  /* ============ B. LA SPIA, CON LO STRUMENTO SPENTO ============
     Prima di accendere il server finto: sulla porta non c'e' nessuno, quindi
     la spia deve dire spento E dire che cosa fare. */
  await page.evaluate(() => Sorgenti.pinga());
  await page.waitForTimeout(2200);
  r = await page.evaluate('({ risponde: Sorgenti.risponde(), spia: ' + LEGGISPIA + ' })');
  r.acceso = r.spia.acceso; r.titolo = r.spia.titolo;
  ok('con lo strumento spento la spia è spenta',
     r.risponde === false && r.spia.c && !r.acceso);
  ok('e dice che cosa fare, invece di stare spenta in silenzio',
     /accendilo|avvialo|\.bat/i.test(r.titolo) && /riprovare/i.test(r.titolo),
     r.titolo.slice(0, 80));

  /* ============ C. LA SPIA, CON LO STRUMENTO ACCESO ============
     E' il controllo che vale tutto il banco: la pagina sta su `file://`, il
     server su `127.0.0.1` e non manda nessuna intestazione CORS. Se la spia si
     accende, la scommessa del `no-cors` regge e la spia funziona oggi, senza
     aspettare l'altro branch. */
  const finto = await strumentoFinto(8765);
  await page.evaluate(() => Sorgenti.pinga());
  await page.waitForTimeout(600);
  r = await page.evaluate('({ risponde: Sorgenti.risponde(), spia: ' + LEGGISPIA + ' })');
  r.acceso = r.spia.acceso; r.titolo = r.spia.titolo;
  ok('con lo strumento acceso la spia si accende, SENZA CORS sul server',
     r.risponde === true && r.acceso,
     'richieste arrivate al server: ' + finto.quante());
  ok('e il titolo dice dove risponde', /127\.0\.0\.1:8765/.test(r.titolo),
     r.titolo.slice(0, 70));
  /* La richiesta e' arrivata davvero al server: senza questo, una spia che si
     accende per un errore di logica passerebbe il controllo di sopra. */
  ok('e la richiesta è arrivata al server, non è un\u2019ipotesi',
     finto.quante() >= 1, finto.quante() + ' ping');

  /* IL PULSANTE «AVVIA LO STRUMENTO» NON CHIAMA NIENTE SE E' GIA' ACCESO.
     Una seconda copia troverebbe la porta occupata, morirebbe subito e
     lascerebbe all'utente una finestra con un errore che non spiega niente.
     Questo e' anche l'unico ramo che il banco puo' percorrere per intero:
     l'altro va a un indirizzo `cnc2d:` e porterebbe via la pagina. */
  r = await page.evaluate(async () => {
    window.__dette = [];
    const v = Log.add;
    Log.add = function (t, m) { window.__dette.push(t + ': ' + m); return v(t, m); };
    const fatto = await Sorgenti.avviaStrumento();
    Log.add = v;
    return { fatto: fatto, dette: window.__dette.join(' | ') };
  });
  ok('a strumento acceso il pulsante di avvio non chiama niente',
     r.fatto === false && /già acceso/.test(r.dette), r.dette.slice(0, 80));

  /* E SI SPEGNE DI NUOVO. Una spia che si accende e non si spegne piu' dice
     «acceso» anche a strumento chiuso, che e' il momento in cui mente. */
  await new Promise((f) => finto.srv.close(f));
  await page.evaluate(() => Sorgenti.pinga());
  await page.waitForTimeout(2200);
  r = await page.evaluate('({ risponde: Sorgenti.risponde(), spia: ' + LEGGISPIA + ' })');
  ok('e si rispegne quando lo strumento si chiude',
     r.risponde === false && !r.spia.acceso);

  /* ============ D. L'INDIRIZZO SI CAMBIA ============
     Chi avvia lo strumento su un'altra porta deve poterlo dire. */
  const altro = await strumentoFinto(9123);
  r = await page.evaluate(async () => {
    { const m = document.querySelector('[data-sorg-mod]'); if (m) m.click(); }
    const aperto = !document.getElementById('nome-modal').hidden;
    const azione = document.getElementById('nome-ok').textContent;
    document.getElementById('nome-campo').value = 'http://127.0.0.1:9123/';
    document.getElementById('nome-ok').click();
    await new Promise((f) => setTimeout(f, 700));
    return { aperto: aperto, azione: azione,
             url: (Sorgenti.elenco().filter((x) => x.locale)[0] || {}).url,
             risponde: Sorgenti.risponde() };
  });
  ok('la matita apre la finestrella dell\u2019indirizzo', r.aperto === true);
  ok('e il suo pulsante dice «Usa questo», non «Rinomina»',
     /Usa questo/.test(r.azione), r.azione);
  ok('l\u2019indirizzo nuovo si usa, e la spia lo segue sulla porta nuova',
     /9123/.test(r.url) && r.risponde === true, r.url);
  await new Promise((f) => altro.srv.close(f));

  /* IL CAMPO VUOTO RIMETTE QUELLO DI SERIE, come in tutte le finestrelle dei
     nomi di questa pagina. */
  r = await page.evaluate(async () => {
    { const m = document.querySelector('[data-sorg-mod]'); if (m) m.click(); }
    document.getElementById('nome-vuoto').click();
    await new Promise((f) => setTimeout(f, 400));
    return (Sorgenti.elenco().filter((x) => x.locale)[0] || {}).url;
  });
  ok('il campo vuoto rimette l\u2019indirizzo di serie',
     r === 'http://127.0.0.1:8765/', r);

  /* UN INDIRIZZO CHE NON E` UN INDIRIZZO non si prende. */
  r = await page.evaluate(async () => {
    const prima = (Sorgenti.elenco().filter((x) => x.locale)[0] || {}).url;
    { const m = document.querySelector('[data-sorg-mod]'); if (m) m.click(); }
    document.getElementById('nome-campo').value = 'ht!tp://:::';
    document.getElementById('nome-ok').click();
    await new Promise((f) => setTimeout(f, 300));
    return { prima: prima,
             dopo: (Sorgenti.elenco().filter((x) => x.locale)[0] || {}).url };
  });
  ok('un indirizzo sbagliato non sostituisce quello buono',
     r.prima === r.dopo, r.dopo);

  /* ============ E. CHI USAVA GIA' LA PAGINA ============
     L'elenco sta in `localStorage` dal primo giorno, quindi `DI_SERIE` lo vede
     solo chi apre la pagina per la prima volta: senza la riga che aggiunge la
     voce a chi ce l'ha gia', l'unica persona che non la troverebbe mai e'
     l'utente. */
  await page.evaluate(() => {
    localStorage.setItem('gdc.cnc2d.sorgenti', JSON.stringify(
      [{ url: 'https://bookofshapes.com/?sort=popular', nome: 'Book of Shapes' }]));
  });
  await page.reload();
  await page.waitForTimeout(600);
  r = await page.evaluate(() => {
    const e = Sorgenti.elenco();
    return { quante: e.length, locale: e.filter((x) => x.locale).length,
             nomi: e.map((x) => x.nome) };
  });
  ok('a chi aveva già l\u2019elenco, la voce dello strumento si aggiunge',
     r.locale === 1 && r.quante === 2, r.nomi.join(' | '));

  /* ============ F. L'AVVIATORE ============ */
  r = await page.evaluate(() => Sorgenti.cartellaProgetto());
  ok('la cartella del progetto si ricava da dove sta la pagina',
     typeof r === 'string' && /CNC-2D$/.test(r), r);

  r = await page.evaluate(() => Sorgenti.testoAvviatore('C:\\Users\\gdc\\CNC-2D'));
  ok('l\u2019avviatore entra nella cartella dello strumento',
     r.indexOf('cd /d "C:\\Users\\gdc\\CNC-2D\\stampe\\strumento"') >= 0,
     (r.split('\r\n')[5] || '').slice(0, 60));
  /* LA FINESTRA DEVE RESTARE APERTA -- chiuderla spegne lo strumento -- e
     deve partire ridotta a icona per non stare in mezzo. Sono i due dettagli
     operativi scritti il 2026-11-13 per non scoprirli sul campo. */
  ok('e lascia aperta la finestra, ridotta a icona',
     /start \/min /.test(r) && /cmd \/k /.test(r));
  /* SE NON TROVA LO STRUMENTO LO DICE, invece di aprire una finestra nera che
     sparisce: e' il modo in cui si scopre che la cartella si e' spostata. */
  ok('e se non trova lo strumento lo scrive e aspetta',
     /if not exist strumento\.py/.test(r) && /pause/.test(r));
  /* RIGHE CON IL RITORNO A CAPO DI WINDOWS: un `.bat` con le righe in stile
     Unix sbaglia le etichette (`:manca`) su piu' di un cmd. */
  ok('e ha i fine riga di Windows', r.indexOf('\r\n') > 0 && !/[^\r]\n/.test(r));

  /* ============ F-ter. LO SCHEMA cnc2d: CHE ACCENDE DALLA PAGINA ============
     Il pulsante della pagina non lancia niente: va a un indirizzo `cnc2d:`, e
     a lanciare e' Windows. Windows pero' quello schema lo conosce solo se
     qualcuno glielo ha registrato, e quel qualcuno e' questo .bat. */
  ok('l’avviatore insegna a Windows che cosa vuol dire cnc2d:',
     /reg add "HKCU\\Software\\Classes\\cnc2d"/.test(r) &&
     /URL Protocol/.test(r) &&
     /shell\\open\\command/.test(r));
  /* LA RIGA CHE CONTA, ed e' una scelta di sicurezza, non di comodita':
     UNO SCHEMA PUO' CHIAMARLO QUALUNQUE PAGINA WEB, e Windows gli passa
     l'indirizzo cliccato come argomento. Se a riceverlo fosse `cmd`, un
     indirizzo costruito apposta potrebbe infilarci dentro altri comandi.
     Puntando a python.exe l'indirizzo arriva come argomento e nessuna shell
     lo rilegge: il peggio che una pagina estranea ottiene e' accendere lo
     strumento. Se un domani qualcuno facesse puntare lo schema al .bat «per
     semplicita'», questo controllo deve fermarlo. */
  ok('e lo fa puntare a python, mai a una shell che rilegge l’indirizzo',
     /\/d "\\"%PY%\\" -B /.test(r) && r.indexOf('%~f0') < 0);
  ok('e l’avviatore non guarda mai l’indirizzo che Windows gli passa',
     r.indexOf('%1') < 0 && r.indexOf('%*') < 0);
  /* SENZA PYTHON NON SI REGISTRA NIENTE ma lo strumento parte lo stesso: il
     pulsante e' un di piu', l'avviatore deve funzionare comunque. */
  ok('e se python non si trova salta la registrazione e avvia lo stesso',
     /if not defined PY goto avvia/.test(r) && /^:avvia$/m.test(r));

  const quantiPrima = scaricati.length;
  await page.click('[data-sorg-avviatore]');
  await page.waitForTimeout(900);
  ok('il pulsante consegna il file, col nome che si riconosce',
     scaricati.length === quantiPrima + 1 &&
     scaricati[scaricati.length - 1].nome === 'avvia-strumento-stampe.bat',
     scaricati.map((d) => d.nome).join(' | '));
  ok('e dentro c\u2019è il percorso di QUESTA copia del progetto',
     /CNC-2D/.test(scaricati[scaricati.length - 1].testo),
     (scaricati[scaricati.length - 1].testo.split('\r\n')[5] || '').slice(0, 70));

  /* ============ F-bis. L'«ANNULLA BLOCCO» DI WINDOWS ============
     Windows marchia i file arrivati da internet e la shell SI RIFIUTA di
     eseguire un `.bat` marchiato: esce «a causa delle impostazioni di
     sicurezza Internet non e' possibile aprire uno o piu' file». Non c'e'
     niente di nostro da correggere -- il file e' giusto -- ma senza una
     parola scritta da qualche parte l'utente vede un programma che non parte
     e nessuna spiegazione, e conclude che e' rotto. Successo davvero il
     2026-11-24, alla prima prova su Windows vero.
     IL MESSAGGIO DEVE ARRIVARE QUANDO SERVE: subito dopo lo scaricamento,
     cioe' prima del click che fallira', non dopo. */
  r = await page.evaluate(() => {
    window.__dette = [];
    const v = Log.add;
    Log.add = function (t, m) { window.__dette.push(t + ': ' + m); return v(t, m); };
    Sorgenti.scaricaAvviatore();
    Log.add = v;
    return window.__dette.join(' | ');
  });
  await page.waitForTimeout(500);
  ok('e avvisa dell’«Annulla blocco», che la prima volta serve sempre',
     /Annulla blocco/.test(r) && /Propriet/.test(r), r.slice(-120));
  /* E STA SCRITTO ANCHE ACCANTO AL PULSANTE, perche' il registro lo si legge
     solo se lo si guarda: chi scarica e clicca subito quel messaggio lo salta. */
  r = await page.evaluate(() =>
    document.querySelector('[data-sorg-avviatore]').title);
  ok('e lo stesso avviso sta scritto sul pulsante che lo scarica',
     /Annulla blocco/.test(r) && /Propriet/.test(r), r.slice(-110));

  /* ============ G. DA UN INDIRIZZO WEB NON SI CONSEGNA ============
     E' la scena dell'iPad, ed e' il motivo per cui questo controllo esiste:
     la' `location.href` non dice niente di dove sta il progetto sul computer,
     e un `.bat` con un percorso inventato apre una finestra nera che
     sparisce. */
  const servita = await paginaServita(9124);
  const p2 = await ctx.newPage();
  const detto = [];
  p2.on('pageerror', (e) => errori.push('http: ' + String(e)));
  /* L'INDIRIZZO IMITA LA FORMA DELLE CARTELLE DEL PROGETTO, e non e' un
     dettaglio: con un indirizzo qualunque (`/cnc2d-ui.html`) il percorso
     tagliato non assomiglia a `webui/dist/` e le guardie sulla FORMA lo
     rifiuterebbero comunque -- cioe' la guardia che conta qui, quella che
     pretende `file://`, non si vedrebbe lavorare. Con `/webui/dist/` la forma
     torna, e l'unica cosa che impedisce di scrivere un percorso senza senso
     come «/7.0.0.1:9124» dentro a un .bat e' lei. */
  await p2.goto('http://127.0.0.1:9124/webui/dist/cnc2d-ui.html');
  await p2.waitForTimeout(600);
  r = await p2.evaluate(async () => {
    window.__dette = [];
    const v = Log.add;
    Log.add = function (t, m) { window.__dette.push(t + ': ' + m); return v(t, m); };
    const cartella = Sorgenti.cartellaProgetto();
    const fatto = Sorgenti.scaricaAvviatore();
    return { cartella: cartella, fatto: fatto, dette: window.__dette.join(' | ') };
  });
  ok('da un indirizzo web la cartella non si ricava, e si dice',
     r.cartella === null && r.fatto === false, String(r.cartella));
  ok('e il messaggio spiega che la pagina va aperta dalla cartella',
     /cartella del progetto/.test(r.dette) && /webui/.test(r.dette),
     r.dette.slice(0, 110));
  await p2.close();
  await new Promise((f) => servita.close(f));

  /* ============ G-bis. LA PAGINA APERTA DA FUORI DEL PROGETTO ============
     Una copia di `cnc2d-ui.html` nei Download: l'indirizzo e' `file://`, e
     quindi la prima guardia la lascia passare -- ma la cartella del progetto
     non e' quella, e indovinarla sarebbe peggio che dirlo. E' la scena che
     prova la SECONDA guardia, quella che pretende di essere in `webui/`:
     senza di lei, rompere quella riga non cambiava niente in nessun
     controllo, perche' dalla cartella vera il risultato veniva uguale. */
  const altrove = path.join(require('os').tmpdir(), 'cnc2d-copia-' + Date.now());
  fs.mkdirSync(altrove, { recursive: true });
  const copia = path.join(altrove, 'cnc2d-ui.html');
  fs.copyFileSync(DIST, copia);
  const p4 = await ctx.newPage();
  p4.on('pageerror', (e) => errori.push('copia: ' + String(e)));
  await p4.goto('file://' + copia);
  await p4.waitForTimeout(600);
  r = await p4.evaluate(() => {
    window.__dette = [];
    const v = Log.add;
    Log.add = function (t, m) { window.__dette.push(t + ': ' + m); return v(t, m); };
    return { cartella: Sorgenti.cartellaProgetto(),
             fatto: Sorgenti.scaricaAvviatore(),
             dette: window.__dette.join(' | ') };
  });
  ok('una copia della pagina fuori dal progetto non genera l\u2019avviatore',
     r.cartella === null && r.fatto === false, String(r.cartella));
  await p4.close();
  fs.rmSync(altrove, { recursive: true, force: true });

  /* ============ H. FINCHE' NON LO CHIEDE L'UTENTE, NON SI CHIEDE NIENTE ============
     Il primo disegno della spia la faceva partire all'apertura della pagina e
     ogni quindici secondi. Funzionava, e sporcava la console del browser di
     `ERR_CONNECTION_REFUSED` a ogni giro -- una richiesta a una porta chiusa
     il browser la scrive li' e non si puo' zittire. Dieci banchi pretendono
     una console pulita, e quel controllo ha trovato difetti veri. Quindi la
     pagina non interroga nessuna porta finche' l'utente non fa capire che lo
     strumento gli interessa.
     LA SCENA ACCENDE IL SERVER PRIMA DI APRIRE LA PAGINA e conta le
     richieste: con il server spento, «nessuna richiesta» sarebbe vero anche
     se la pagina ne facesse dieci. */
  const spia = await strumentoFinto(8765);
  const p3 = await ctx.newPage();
  p3.on('pageerror', (e) => errori.push('quieta: ' + String(e)));
  await p3.goto(PAGINA);
  await p3.waitForTimeout(3000);
  r = await p3.evaluate(() => ({ cercato: Sorgenti.cercato(),
                                 risponde: Sorgenti.risponde() }));
  ok('appena aperta, la pagina non interroga nessuna porta',
     spia.quante() === 0 && r.cercato === false && r.risponde === null,
     spia.quante() + ' richieste in tre secondi');

  r = await p3.evaluate(async () => {
    const b = document.querySelector('[data-sorg-spia]');
    if (b) b.click();
    await new Promise((f) => setTimeout(f, 800));
    /* SI RICHIEDE L'ELEMENTO, non si tiene quello di prima: accendendosi, la
       spia fa ridisegnare la riga, quindi il nodo cliccato e' ormai staccato
       dal documento e porta ancora le classi di prima. Guardare quello
       vorrebbe dire guardare il passato. */
    const d = document.querySelector('[data-sorg-spia]');
    return { cercato: Sorgenti.cercato(), risponde: Sorgenti.risponde(),
             acceso: !!d && d.classList.contains('is-on') };
  });
  ok('e appena si clicca la spia, chiede e si accende',
     spia.quante() >= 1 && r.cercato === true && r.risponde === true && r.acceso,
     spia.quante() + ' richieste dopo il click');

  /* IL BATTITO SI FERMA QUANDO NESSUNO GUARDA. Si guarda la regola e non il
     timer: aspettare quindici secondi per volta vorrebbe dire un banco da un
     minuto per provare tre condizioni. */
  r = await p3.evaluate(() => {
    const normale = Sorgenti.serve();
    State.data.stampa.stato = 'corso';
    const stampando = Sorgenti.serve();
    State.data.stampa.stato = 'fermo';
    document.querySelector('.tab[data-tab="editor"]').click();
    const altraTab = Sorgenti.serve();
    document.querySelector('.tab[data-tab="disegno"]').click();
    return { normale: normale, stampando: stampando, altraTab: altraTab };
  });
  ok('il battito non chiede niente durante una stampa né da un\u2019altra tab',
     r.normale === true && r.stampando === false && r.altraTab === false,
     'normale ' + r.normale + ', in stampa ' + r.stampando + ', altra tab ' + r.altraTab);
  await p3.close();
  await new Promise((f) => spia.srv.close(f));

  /* LE RICHIESTE RIFIUTATE NON SONO ERRORI DELLA PAGINA: la spia chiede a una
     porta dove non c'e' nessuno, e il browser scrive `ERR_CONNECTION_REFUSED`
     in console. E' il funzionamento, non un guasto -- metterlo fra i guai
     vorrebbe dire che il controllo diventa rosso proprio quando la spia fa il
     suo mestiere. Tutto il resto conta. */
  const veri = errori.filter((e) =>
    !/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_FAILED/.test(e));
  ok('nessun errore in console, a parte le porte chiuse che la spia interroga',
     veri.length === 0, veri.join(' | ') ||
     (errori.length + ' richieste rifiutate, nessun errore vero'));

  await browser.close();
  console.log(guai ? '\n' + guai + ' guai' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
