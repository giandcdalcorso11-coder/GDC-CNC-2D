/* Il collaudo della RINOMINA di livelli e fogli.
 *
 * IL PROBLEMA, detto dall'operatore il 2026-11-08: «la possibilità di
 * rinominare fogli e livelli». I nomi li metteva il programma — «antei.svg ·
 * tratto #1f4fa8», «Personalizzato» — e con diciotto livelli su nove magneti
 * non dicono piu' niente.
 *
 * LE COSE CHE SI CONTROLLANO DAVVERO non sono «la finestrella si apre»:
 *   1. che UN clic solo NON rinomini. Il clic sul nome di un livello lo
 *      sceglie, ed e' il gesto che si fa cento volte al giorno: se aprisse
 *      la finestrella, lavorare diventerebbe chiuderla;
 *   2. che DUE clic la aprano davvero — e qui c'e' il difetto vero trovato
 *      scrivendo questo collaudo: il primo clic RIDISEGNA l'elenco, quindi
 *      il bottone premuto non esiste piu' e il browser l'evento `dblclick`
 *      non lo manda affatto. I due clic si contano a mano (`Nome.doppio`);
 *   3. che il nome del foglio RESISTA a un ridisegno: `apply()` lo riscrive
 *      dal formato a ogni giro, ed e' giusto che lo faccia finche' nessuno
 *      ha detto il contrario — per quello c'e' `nomeMio`;
 *   4. che il nome esca dalla pagina: nel marcatore `;FOGLIO n/N nome` del
 *      programma, che e' quello che arriva al telecomando;
 *   5. che un nome vuoto NON cancelli il nome di un livello (una riga senza
 *      nome non si trova piu') ma RIMETTA quello del formato su un foglio;
 *   6. che salvando e riaprendo i nomi tornino, `nomeMio` compreso.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-nomi.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

const DIS = '<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="60mm" ' +
  'viewBox="0 0 60 60"><path fill="none" stroke="#1f4fa8" d="M10 10 L50 10 L50 50"/></svg>';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  /* La scena: due fogli da 75 × 75 (due magneti), un disegno per ciascuno. */
  const SCENA = async () => {
    await page.evaluate(([D]) => {
      document.getElementById('btn-clear-file').click();
      while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
      Paper.setSize(75, 75);
      Paper.setSheetOrigin(0, 0);
      Artwork.load(D, 'magnete 1.svg');
      const f = Fogli.aggiungi(75, 75, null);
      Fogli.scegli(f.id);
      Artwork.load(D, 'magnete 2.svg');
    }, [DIS]);
    await page.waitForTimeout(200);
  };

  const APERTA = () => page.evaluate(() => ({
    aperta: !document.getElementById('nome-modal').hidden,
    titolo: document.getElementById('nome-titolo').textContent,
    campo: document.getElementById('nome-campo').value,
    rimetti: document.getElementById('nome-vuoto').hidden
      ? null : document.getElementById('nome-vuoto').textContent
  }));

  const NOMI = () => page.evaluate(() => ({
    livelli: Artwork.livelli().map((l) => l.nome),
    fogli: State.data.fogli.map((f) => [f.name, !!f.nomeMio]),
    inElenco: [...document.querySelectorAll('#livelli .liv-nome')]
      .map((b) => b.textContent)
  }));

  /* Due clic veri sullo stesso bersaglio, con in mezzo il tempo che ci mette
     un dito — e il bersaglio si ripesca fra i due, perche' il primo clic
     ridisegna l'elenco e il nodo di prima e' gia' sparito. */
  const dueClic = async (sel, i) => {
    let b = await page.$$(sel);
    await b[i].click();
    await page.waitForTimeout(70);
    b = await page.$$(sel);
    await b[i].click();
    await page.waitForTimeout(150);
  };

  let r;

  /* ============ 1. UN CLIC NON RINOMINA ============
     E' il controllo piu' importante di tutti: il clic sul nome sceglie il
     livello, e lo si fa cento volte al giorno. */
  await SCENA();
  let b = await page.$$('#livelli [data-nome]');
  await b[0].click();
  await page.waitForTimeout(200);
  r = await APERTA();
  ok('un clic solo sul nome non apre niente: sceglie e basta',
     !r.aperta, r.aperta ? 'finestrella aperta' : 'chiusa');
  r = await page.evaluate(() => Artwork.livelli().filter((l) => l.scelto).length);
  ok('e il livello lo sceglie davvero', r === 1, r + ' livelli scelti');

  /* ============ 2. DUE CLIC RINOMINANO ============ */
  await SCENA();
  await dueClic('#livelli [data-nome]', 0);
  r = await APERTA();
  ok('due clic sul nome aprono la finestrella, col nome dentro',
     r.aperta && r.titolo === 'Nome del livello' &&
     r.campo === 'magnete 1.svg', r.titolo + ' — «' + r.campo + '»');
  await page.fill('#nome-campo', '  Gioco   rosso  ');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  r = await NOMI();
  /* Gli spazi ai bordi e quelli doppi spariscono: due nomi che differiscono
     per uno spazio sono il modo piu' sicuro di credere l'elenco rotto. */
  ok('il livello si rinomina, e il nome si ripulisce dagli spazi',
     r.livelli[0] === 'Gioco rosso' && r.inElenco[0] === 'Gioco rosso',
     JSON.stringify(r.livelli));

  /* ============ 3. IL NOME VUOTO NON CANCELLA UN LIVELLO ============ */
  await dueClic('#livelli [data-nome]', 0);
  await page.fill('#nome-campo', '   ');
  await page.click('#nome-ok');
  await page.waitForTimeout(150);
  r = await NOMI();
  ok('un nome vuoto lascia il livello com\'era: una riga senza nome non si trova',
     r.livelli[0] === 'Gioco rosso', JSON.stringify(r.livelli));

  /* ============ 4. ESC LASCIA STARE ============ */
  await dueClic('#livelli [data-nome]', 0);
  await page.fill('#nome-campo', 'buttato via');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  r = await APERTA();
  const n = await NOMI();
  ok('Esc chiude senza rinominare',
     !r.aperta && n.livelli[0] === 'Gioco rosso',
     (r.aperta ? 'aperta' : 'chiusa') + ', ' + n.livelli[0]);

  /* ============ 5. IL FOGLIO, DALLA SUA PASTICCA ============ */
  await SCENA();
  await dueClic('#fogli-row [data-foglio]', 1);
  r = await APERTA();
  ok('due clic sulla pasticca aprono il nome del foglio',
     r.aperta && r.titolo === 'Nome del foglio 2' &&
     /Rimetti «75 × 75»/.test(String(r.rimetti)),
     r.titolo + ' — pulsante «' + r.rimetti + '»');
  await page.fill('#nome-campo', 'Gioco');
  await page.click('#nome-ok');
  await page.waitForTimeout(200);
  r = await NOMI();
  ok('il foglio si rinomina, e si segna che il nome l\'hai messo tu',
     r.fogli[1][0] === 'Gioco' && r.fogli[1][1] === true,
     JSON.stringify(r.fogli));

  /* IL CONTROLLO CHE SERVE DAVVERO: un ridisegno non deve ributtarlo via.
     `apply()` riscrive il nome del foglio in uso dal formato a ogni giro. */
  await page.evaluate(() => Paper.setSize(75, 75));
  await page.waitForTimeout(150);
  r = await NOMI();
  ok('e un ridisegno del foglio non glielo ributta via',
     r.fogli[1][0] === 'Gioco', JSON.stringify(r.fogli));

  /* ============ 6. IL NOME ESCE DALLA PAGINA ============
     Nel marcatore `;FOGLIO n/N nome`, che e' quello che il Sender manda al
     telecomando: a stampa iniziata e' l'unico modo di sapere su quale pezzo
     di carta sta andando la penna. */
  r = await page.evaluate(() => {
    Artwork.prepare();
    return (document.getElementById('gcode-out').value.match(/^;FOGLIO.*$/gm) || []);
  });
  ok('e finisce nel programma, dove lo legge il telecomando',
     r.length === 2 && /;FOGLIO 2\/2 Gioco/.test(r[1]), r.join(' | '));

  /* ============ 7. «RIMETTI» TORNA ALLA MISURA ============ */
  await dueClic('#fogli-row [data-foglio]', 1);
  await page.click('#nome-vuoto');
  await page.waitForTimeout(150);
  r = await NOMI();
  ok('«Rimetti» torna al nome del formato, e lo smarca',
     r.fogli[1][0] === 'Personalizzato' && r.fogli[1][1] === false,
     JSON.stringify(r.fogli));

  /* ============ 8. SALVATO E RIAPERTO, I NOMI TORNANO ============
     Il nome di un livello sta gia' nel file da sempre; quello del foglio no,
     e senza `nomeMio` nel file durerebbe fino al primo ridisegno dopo la
     riapertura. */
  await SCENA();
  await dueClic('#livelli [data-nome]', 0);
  await page.fill('#nome-campo', 'contorno');
  await page.click('#nome-ok');
  await page.waitForTimeout(150);
  await dueClic('#fogli-row [data-foglio]', 1);
  await page.fill('#nome-campo', 'Gioco');
  await page.click('#nome-ok');
  await page.waitForTimeout(150);

  r = await page.evaluate(() => {
    const t = Progetto.testo();
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(148, 210);
    Artwork.load(t, 'riaperto.cnc2d.svg');
    /* Un ridisegno subito dopo: e' li' che un nome senza `nomeMio` si
       perderebbe, non al momento della lettura. */
    Paper.setSize(State.data.paper.w, State.data.paper.h);
    return { livelli: Artwork.livelli().map((l) => l.nome),
             fogli: State.data.fogli.map((f) => [f.name, !!f.nomeMio]) };
  });
  ok('salvato e riaperto, il livello si chiama ancora come l\'hai chiamato',
     r.livelli[0] === 'contorno', JSON.stringify(r.livelli));
  ok('e il foglio pure, anche dopo un ridisegno',
     r.fogli[1][0] === 'Gioco' && r.fogli[1][1] === true,
     JSON.stringify(r.fogli));

  /* ============ 9. ANCHE DALL'INTESTAZIONE E DALL'EDITOR ============
     Il foglio ha un nome scritto in due posti della tab Disegno — la
     pasticca e l'intestazione dei livelli — e il livello in due tab. */
  await SCENA();
  await dueClic('#livelli [data-testa]', 1);
  r = await APERTA();
  ok('due clic sull\'intestazione del foglio, nell\'elenco, lo rinominano',
     r.aperta && /Nome del foglio/.test(r.titolo), r.titolo);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  /* La colonna dell'editor si clicca solo se la tab e' quella aperta: i
     clic veri li fa un dito, e un dito non preme quello che non vede. */
  await page.click('.tab[data-tab="editor"]');
  await page.waitForTimeout(200);
  r = await page.evaluate(() => {
    Editor.apri();
    return [...document.querySelectorAll('#ed-livelli [data-ed-liv]')].length;
  });
  await page.waitForTimeout(200);
  if (r > 0) {
    await dueClic('#ed-livelli [data-ed-liv]', 0);
    r = await APERTA();
    ok('e due clic nella colonna dell\'editor rinominano il livello',
       r.aperta && r.titolo === 'Nome del livello', r.titolo);
    await page.fill('#nome-campo', 'dall\'editor');
    await page.click('#nome-ok');
    await page.waitForTimeout(200);
    r = await page.evaluate(() => ({
      liv: Artwork.livelli().map((l) => l.nome),
      col: [...document.querySelectorAll('#ed-livelli .ed-liv-nome')].map((b) => b.textContent.trim())
    }));
    ok('e la colonna dell\'editor lo riscrive subito',
       r.liv.indexOf('dall\'editor') >= 0 &&
       r.col.some((t) => t.indexOf('dall\'editor') >= 0),
       JSON.stringify(r.col));
  } else {
    ok('e due clic nella colonna dell\'editor rinominano il livello', false,
       'nessuna riga nella colonna dell\'editor');
  }

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
