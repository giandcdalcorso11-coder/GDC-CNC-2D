/* Il collaudo di COME SI STAMPANO PIU' FOGLI (Step 11, fase 3).
 *
 * LA COSA CHE QUESTO PEZZO ESISTE PER FARE, in un numero: nove magneti con
 * due penne, stampati foglio per foglio, vogliono DICIOTTO cambi penna.
 * Stampati per penna ne vogliono DUE. La differenza non sono secondi di
 * macchina -- lo spostamento in piu' e' penna alzata a 3000 mm/min, non
 * costa niente -- sono sedici volte che una persona deve stare li' ad
 * aspettare di smontare e rimontare una penna.
 *
 * Quindi qui si guardano tre cose:
 *   1. che «per penna» raggruppi davvero, e che il conto delle fermate
 *      scenda;
 *   2. che «per foglio» continui a fare quello che ha sempre fatto -- la
 *      strada nuova non si fa rompendo quella vecchia;
 *   3. che il G-code DICA su che foglio sta andando. Con l'ordine per penna
 *      la punta salta da un foglio all'altro di continuo: guardando le
 *      coordinate non si capirebbe, e il telecomando deve poter dire
 *      «foglio 3 di 9».
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO.
 * Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-ordine.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

const DIS = (tinta) => `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
<path fill="none" stroke="${tinta}" d="M5 5 L35 5 L35 35 L5 35 Z"/></svg>`;

const NERO = '#1d1d1b', ROSSO = '#c8102e';

/* Due fogli, due penne per foglio: il caso piu' piccolo in cui le due
   strade danno risultati diversi. */
const SCENA = (page, quanti) => page.evaluate(([svgN, svgR, quanti]) => {
  document.getElementById('btn-clear-file').click();
  const l = State.data.fogli;
  while (l.length > 1) Fogli.togli(l[l.length - 1].id);
  Fogli.scegli(l[0].id);
  Paper.setSize(75, 75);
  Paper.setSheetOrigin(0, 0);
  for (let i = 0; i < quanti; i++) {
    if (i > 0) Fogli.scegli(Fogli.aggiungi(75, 75, null).id);
    Artwork.load(svgN, 'nero ' + (i + 1));
    Artwork.load(svgR, 'rosso ' + (i + 1));
  }
  return State.data.fogli.length;
}, [DIS(NERO), DIS(ROSSO), quanti]);

/* Dal programma: quante fermate, in che ordine vanno le penne, e che cosa
   dicono i marcatori del foglio. */
const LETTURA = (page, ordine) => page.evaluate((ordine) => {
  Profile.stampa().ordineFogli = ordine;
  Artwork.prepare();
  const t = document.getElementById('gcode-out').value;
  const righe = t.split('\n').map((x) => x.trim());
  return {
    pause: righe.filter((x) => x === ';PAUSA').length,
    penne: righe.filter((x) => /^;PENNA /.test(x)).map((x) => x.split(' ')[1]),
    nomi: righe.filter((x) => /^;PENNA /.test(x))
               .map((x) => x.split(' ').slice(2).join(' ')),
    fogli: righe.filter((x) => /^;FOGLIO /.test(x)).map((x) => x.split(' ')[1]),
    /* L'ordine in cui i marcatori compaiono nel file, mescolati: serve a
       vedere che il foglio e' scritto PRIMA della penna, e la penna prima
       della pausa. */
    marcatori: righe.filter((x) => /^;(FOGLIO|PENNA|PAUSA)/.test(x))
                    .map((x) => x.split(' ')[0])
  };
}, ordine);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* ============ UN FOGLIO SOLO: NIENTE CAMBIA ============
     Con un foglio solo le due strade sono la stessa strada, e il selettore
     non deve nemmeno comparire: una domanda la cui risposta non cambia
     niente e' una domanda da non fare. */
  await SCENA(page, 1);
  const unoPenna = await LETTURA(page, 'penna');
  const unoFoglio = await LETTURA(page, 'foglio');
  r = await page.evaluate(() => ({
    nascosto: document.getElementById('ordine-fogli').hidden
  }));
  ok('con un foglio solo il selettore dell\'ordine non compare', r.nascosto === true);
  ok('e le due strade danno lo stesso programma',
     unoPenna.pause === unoFoglio.pause &&
     JSON.stringify(unoPenna.nomi) === JSON.stringify(unoFoglio.nomi) &&
     unoPenna.pause === 1,
     unoPenna.pause + ' fermata, penne ' + JSON.stringify(unoPenna.nomi));

  /* ============ DUE FOGLI: LE DUE STRADE SI SEPARANO ============ */
  await SCENA(page, 2);
  r = await page.evaluate(() => ({
    visibile: !document.getElementById('ordine-fogli').hidden
  }));
  ok('con piu` fogli il selettore compare', r.visibile === true);

  const duePenna = await LETTURA(page, 'penna');
  const dueFoglio = await LETTURA(page, 'foglio');

  ok('«per penna»: prima tutto il nero su tutti i fogli, poi tutto il rosso',
     JSON.stringify(duePenna.nomi) ===
       JSON.stringify(['nero 1', 'nero 2', 'rosso 1', 'rosso 2']),
     JSON.stringify(duePenna.nomi));
  ok('«per foglio»: un foglio alla volta, finito e via',
     JSON.stringify(dueFoglio.nomi) ===
       JSON.stringify(['nero 1', 'rosso 1', 'nero 2', 'rosso 2']),
     JSON.stringify(dueFoglio.nomi));

  /* IL NUMERO CHE CONTA. */
  ok('e «per penna» costa UNA fermata invece di tre',
     duePenna.pause === 1 && dueFoglio.pause === 3,
     'per penna ' + duePenna.pause + ', per foglio ' + dueFoglio.pause);

  /* ============ IL G-CODE DICE SU CHE FOGLIO VA ============ */
  ok('il programma dice su quale foglio sta andando, e quanti sono',
     JSON.stringify(duePenna.fogli) === JSON.stringify(['1/2', '2/2', '1/2', '2/2']),
     JSON.stringify(duePenna.fogli));

  /* E SI SCRIVE QUANDO IL FOGLIO CAMBIA, non a ogni gruppo. Per penna il
     foglio cambia ogni volta e i due comportamenti darebbero lo stesso
     file: e' «per foglio» che li separa, perche' li' due gruppi di fila
     stanno sullo stesso foglio. Lo ha trovato il banco delle mutazioni. */
  ok('e si scrive quando il foglio CAMBIA, non a ogni gruppo',
     JSON.stringify(dueFoglio.fogli) === JSON.stringify(['1/2', '2/2']),
     'per foglio: ' + JSON.stringify(dueFoglio.fogli) + ' con ' +
     dueFoglio.nomi.length + ' gruppi');

  /* L'ORDINE DEI MARCATORI NON E' UN DETTAGLIO: al cambio penna il Sender si
     ferma sul segno di pausa e non legge piu' niente, quindi quello che gli
     serve per rispondere a «quale penna monto, e su che foglio» deve essere
     gia' passato. Foglio, poi penna, poi pausa. */
  const iPausa = duePenna.marcatori.indexOf(';PAUSA');
  ok('e lo dice PRIMA della penna, che viene prima della pausa',
     iPausa > 1 && duePenna.marcatori[iPausa - 1] === ';PENNA' &&
     duePenna.marcatori[iPausa - 2] === ';FOGLIO',
     duePenna.marcatori.join(' '));

  /* ============ NOVE MAGNETI: IL CASO VERO ============ */
  await SCENA(page, 9);
  const noveP = await LETTURA(page, 'penna');
  const noveF = await LETTURA(page, 'foglio');
  ok('nove magneti a due penne: UNA fermata per penna, diciassette per foglio',
     noveP.pause === 1 && noveF.pause === 17,
     'per penna ' + noveP.pause + ', per foglio ' + noveF.pause);
  ok('e i diciotto disegni ci sono tutti, in tutt\'e due le strade',
     noveP.nomi.length === 18 && noveF.nomi.length === 18 &&
     noveP.fogli.length === 18,
     noveP.nomi.length + ' penne, ' + noveP.fogli.length + ' marcatori di foglio');

  /* ============ «TUTTO» NON PUO' RAGGRUPPARE PER PENNA ============
     Li' un gruppo e' un foglio intero con dentro le sue penne mescolate:
     non esiste «la penna di questo gruppo» da cui ordinare. Si dice invece
     di farlo male in silenzio. */
  await SCENA(page, 2);
  r = await page.evaluate(() => {
    Profile.stampa().ottimizza = 'tutto';
    Profile.stampa().ordineFogli = 'penna';
    Artwork.prepare();
    const t = document.getElementById('gcode-out').value;
    const avvisi = [...document.querySelectorAll('#log-view .log-err')]
      .map((x) => x.textContent);
    Profile.stampa().ottimizza = 'livello';
    return { detto: avvisi.some((x) => /per penna.*ottimizzazione/i.test(x)),
             fogli: t.split('\n').filter((x) => /^;FOGLIO/.test(x.trim())).length };
  });
  ok('con l\'ottimizzazione «tutto» lo dice invece di fare finta',
     r.detto === true && r.fogli === 2,
     (r.detto ? 'avvisato' : 'NON avvisato') + ', ' + r.fogli + ' marcatori');

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
