/* Il collaudo del passo nuovo del cambio penna: RITROVARE LA PUNTA.
 *
 * IL PROBLEMA che questo passo risolve si e' visto sulla carta il
 * 2026-11-03, stampando a due colori: due penne diverse non hanno la punta
 * nello stesso posto -- il morsetto tiene il CORPO della penna -- e il
 * secondo colore esce spostato di tutto rispetto al primo.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «si apre una finestra»: e' che
 * esca il `G92` giusto, e soprattutto che NON esca quando sarebbe un
 * disastro. Premere quel pulsante senza aver mosso la testina sposterebbe di
 * venti millimetri tutto quello che resta da disegnare, su un foglio gia'
 * mezzo stampato: e' il danno peggiore che questa procedura possa fare, ed e'
 * il piu' facile da fare per sbaglio.
 *
 * Gira in modalita' finta, che per questa prova non e' una scorciatoia: il
 * finto risponde `ok` a tutto e dice `Idle`, quindi la stampa passa per la
 * stessa strada di quella vera, solo piu' in fretta.
 *
 * Uso:  node webui/tools/prova-cambio-penna.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Una stampa minima con un cambio penna in mezzo: due movimenti e il segno.
   Non serve un disegno vero -- qui si prova la procedura, non il disegno. */
const AVVIA = async (page) => page.evaluate(() => {
  /* La spia sul G92 si mette UNA VOLTA SOLA: rimetterla a ogni stampa
     vorrebbe dire impacchettare la spia dentro la spia, e ogni correzione
     finirebbe nell'elenco due volte. Ci e' cascata questa prova stessa. */
  if (!window.__g92) {
    window.__g92 = [];
    const vero = Api.dichiaraPosizione;
    Api.dichiaraPosizione = function (x, y) {
      window.__g92.push([x, y]);
      return vero(x, y);
    };
  }
  State.data.azzerata = true;
  State.data.altezzaContatto = -21.3;
  Paper.setSheetOrigin(20, 20);
  const testo = ['G21', 'G90', 'G0 X10 Y10', Gcode.SEGNO_PAUSA,
                 'G0 X20 Y20', 'M2'].join('\n');
  Sender.avvia(testo, 'prova del cambio penna');
  return Sender.stato();
});

/* Dal passo 1 al passo 3, premendo il pulsante grande come farebbe lui. */
async function finoAlTerzoPasso(page) {
  await page.click('#modal-ok');          // ho tolto la penna
  await page.waitForTimeout(120);
  await page.click('#modal-ok');          // l'ho montata
  await page.waitForTimeout(120);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await page.goto(PAGINA);
  await page.waitForTimeout(300);
  await page.evaluate(() => Api.connect());
  await page.waitForTimeout(200);

  let r = await AVVIA(page);
  await page.waitForTimeout(400);
  r = await page.evaluate(() => ({ stato: Sender.stato(),
                                   aperta: !document.getElementById('modal').hidden,
                                   titolo: document.getElementById('modal-titolo').textContent }));
  ok('la stampa si ferma al segno e la procedura si apre',
     r.stato === 'cambio' && r.aperta === true, r.stato + ', «' + r.titolo + '»');

  await finoAlTerzoPasso(page);
  r = await page.evaluate(() => ({
    titolo: document.getElementById('modal-titolo').textContent,
    passo: document.getElementById('modal-passo').textContent,
    salta: !document.getElementById('modal-salta').hidden,
    campi: !!document.getElementById('pop-off-x'),
    stato: Sender.stato(),
    passoTele: Popup.passoPenna()
  }));
  ok('dopo il montaggio c\'e` un terzo passo per la punta',
     /punta/i.test(r.titolo) && /3 di 3/.test(r.passo),
     r.passo + ' — «' + r.titolo + '»');
  ok('con i due campi e il pulsante per saltarlo',
     r.campi === true && r.salta === true,
     'campi ' + r.campi + ', salta ' + r.salta);
  /* La stampa NON e' ancora ripartita: prima si ritrova la punta. Se
     ripartisse qui, il passo nuovo sarebbe una finestra senza effetto. */
  ok('e la stampa aspetta ancora', r.stato === 'cambio', r.stato);
  /* E il telecomando lo sa: col passo 2 il vetro direbbe ancora «MONTA»,
     cioe' una cosa che non e' piu' vera. */
  ok('e il telecomando riceve il passo 3, non il 2', r.passoTele === 2,
     'passo ' + r.passoTele);

  /* ============== IL CONTROLLO CHE IMPEDISCE IL DANNO ============== */

  /* La testina e' dove l'ha lasciata il parcheggio, cioe' al punto home:
     premere di li' vorrebbe dire dichiarare che il punto home e' l'angolo
     del foglio, e spostare di venti millimetri tutto quello che resta. */
  r = await page.evaluate(() => {
    State.data.pos.x = 5; State.data.pos.y = 5;       // punto home
    document.getElementById('modal-ok').click();
    return { g92: window.__g92.length,
             ancoraLi: !document.getElementById('modal').hidden,
             titolo: document.getElementById('modal-titolo').textContent,
             nota: document.getElementById('modal-nota').textContent,
             stato: Sender.stato() };
  });
  ok('premuto senza aver mosso la testina, NON corregge',
     r.g92 === 0 && r.stato === 'cambio', r.g92 + ' G92 mandati');
  ok('resta sul passo e dice perche`',
     r.ancoraLi === true && /punta/i.test(r.titolo) && /troppi/i.test(r.nota),
     r.nota.slice(0, 90));

  /* ================== LA CORREZIONE, QUELLA VERA ================== */

  /* La punta nuova e' quattro decimi a destra e due sotto rispetto a dove
     stava la vecchia: la si porta sull'angolo e la macchina si trova a
     20,4 / 19,8 mentre quel punto si chiama 20 / 20. */
  r = await page.evaluate(() => {
    State.data.pos.x = 20.4; State.data.pos.y = 19.8;
    document.getElementById('modal-ok').click();
    return { g92: window.__g92.slice(),
             chiusa: document.getElementById('modal').hidden,
             stato: Sender.stato() };
  });
  ok('sul punto giusto, dichiara l\'angolo com\'e` chiamato nel programma',
     r.g92.length === 1 && r.g92[0][0] === 20 && r.g92[0][1] === 20,
     JSON.stringify(r.g92));
  ok('e da li` la stampa riparte da sola',
     r.chiusa === true && (r.stato === 'invio' || r.stato === 'fine'),
     'finestra chiusa ' + r.chiusa + ', stato ' + r.stato);

  /* Lo scarto finisce nel registro in millimetri: e' l'unico posto in cui
     resta scritto di quanto le due penne erano diverse, ed e' il numero che
     serve per sapere se il morsetto va sistemato. */
  r = await page.evaluate(() => [...document.querySelectorAll('#log-view .log-line')]
        .map((x) => x.textContent).filter((t) => /punta ritrovata/i.test(t)));
  ok('e lo scarto resta scritto nel registro',
     r.length === 1 && /0[,.]4/.test(r[0]) && /0[,.]2/.test(r[0]),
     (r[0] || '').slice(10, 120));

  /* ============ IL PUNTO CHE NON E` L'ANGOLO DEL FOGLIO ============
   *
   * Con un foglio piu' grande della corsa l'angolo sta fuori e la macchina
   * non ci arriva: si tocca un punto qualsiasi del foglio e si dichiara
   * quanto dista dai due bordi, come nel terzo passo di inizio stampa.
   *
   * QUESTO PEZZO E` NATO DA UNA MUTAZIONE CHE NON SI ACCENDEVA: togliendo i
   * due scostamenti dal conto, tutti i controlli passavano lo stesso --
   * perche' tutti usavano un foglio piccolo, dove quei due numeri valgono
   * zero. Il caso in cui servono non era provato da nessuno.
   */
  await page.evaluate(() => { window.__g92.length = 0; });
  await AVVIA(page);
  await page.waitForTimeout(400);
  await finoAlTerzoPasso(page);
  r = await page.evaluate(() => {
    document.getElementById('pop-off-x').value = '30';
    document.getElementById('pop-off-y').value = '12';
    /* La punta nuova e' sul punto dichiarato, e sta mezzo millimetro in la':
       la macchina si trova a 50,4 / 31,8 e quel punto si chiama 50 / 32. */
    State.data.pos.x = 50.4; State.data.pos.y = 31.8;
    document.getElementById('modal-ok').click();
    return { g92: window.__g92.slice(), stato: Sender.stato() };
  });
  ok('col punto lontano dall\'angolo, i due scostamenti entrano nel conto',
     r.g92.length === 1 && r.g92[0][0] === 50 && r.g92[0][1] === 32,
     JSON.stringify(r.g92) + ' (l\'angolo e` 20,20 piu` 30 e 12)');

  /* ===================== SALTARE DEVE FUNZIONARE ===================== */

  /* Chi rimonta la stessa penna non ha niente da correggere, ma la stampa
     deve ripartire lo stesso: un pulsante che non fa niente lascerebbe la
     macchina ferma per sempre con la finestra chiusa. */
  await page.evaluate(() => { window.__g92.length = 0; });
  await AVVIA(page);
  await page.waitForTimeout(400);
  await finoAlTerzoPasso(page);
  r = await page.evaluate(() => {
    document.getElementById('modal-salta').click();
    return { g92: window.__g92.length,
             chiusa: document.getElementById('modal').hidden,
             stato: Sender.stato() };
  });
  ok('«riprendi senza correggere» riprende davvero, e non corregge',
     r.g92 === 0 && r.chiusa === true &&
     (r.stato === 'invio' || r.stato === 'fine'),
     r.g92 + ' G92, stato ' + r.stato);

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
