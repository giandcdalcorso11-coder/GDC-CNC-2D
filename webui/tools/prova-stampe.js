/* Il collaudo delle tab delle stampe.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «si apre una tab»: e' che quella
 * tab continui a dire la verita' DOPO. Una stampa finita resta li' a
 * raccontarsi, e nel frattempo sul foglio arriva un altro disegno, il
 * formato cambia, la carta cambia. Se la tab leggesse lo stato vivo invece
 * della copia che si e' presa, diventerebbe il racconto di una stampa che
 * non e' mai stata fatta -- e sarebbe credibile, che e' il guaio peggiore.
 *
 * Gira in modalita' finta: li' la macchina risponde `ok` a tutto e dice
 * `Idle`, quindi una stampa parte e finisce per la stessa strada di quella
 * vera, solo in un istante.
 *
 * Uso:  node webui/tools/prova-stampe.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Un programma con due quadrati e un cambio penna in mezzo: il minimo che
   abbia tutto quello che la tab deve saper raccontare. */
const PROGRAMMA = (conPausa) => {
  const L = ['G21', 'G90', 'G0 Z-18.3'];
  /* I LATI SI SCRIVONO UN ASSE PER VOLTA, come fa il generatore vero: «G1
     X70» vuol dire «Y resta dov'era». Scrivendo sempre tutte e due le
     coordinate -- come faceva questa prova all'inizio -- la memoria modale
     del lettore non sarebbe provata da nessuno, e leggerla male porterebbe i
     tratti dall'altra parte del foglio con un disegno che sembra comunque un
     disegno. L'ha fatto notare una mutazione che non si accendeva. */
  const q = (x0, y0, s) => L.push(
    'G0 X' + x0 + ' Y' + y0 + ' F3000', 'G1 Z-21.3 F600',
    'G1 X' + (x0 + s) + ' F1200', 'G1 Y' + (y0 + s),
    'G1 X' + x0, 'G1 Y' + y0, 'G0 Z-18.3');
  L.push(';PENNA #1f4fa8 blu');
  q(40, 60, 30);
  if (conPausa) L.push(';PAUSA', ';PENNA #c8102e rosso');
  q(60, 120, 24);
  L.push('G0 X5 Y5 F3000', 'M2');
  return L.join('\n');
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await page.goto(PAGINA);
  await page.waitForTimeout(300);
  await page.evaluate(() => Api.connect());
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    State.data.azzerata = true;
    State.data.altezzaContatto = -21.3;
    Paper.setSheetOrigin(20, 20);
  });

  let r;

  /* ================= UNA STAMPA SENZA FERMATE ================= */

  r = await page.evaluate((p) => {
    Sender.avvia(p, 'primo.svg');
    return { aperte: Stampe.aperte(),
             attiva: (document.querySelector('.panel.is-active') || {}).id,
             stato: Sender.stato() };
  }, PROGRAMMA(false));
  ok('partendo una stampa nasce la sua tab, e si apre',
     r.aperte.length === 1 && r.attiva === 'tab-stampa-1',
     r.aperte.length + ' tab, davanti ' + r.attiva);
  ok('e si e` portata via il programma, non il disegno sul foglio',
     r.aperte[0].righe > 10 && r.aperte[0].tratti >= 8,
     r.aperte[0].righe + ' righe, ' + r.aperte[0].tratti + ' tratti ricavati dal G-code');

  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({
    stato: Stampe.aperte()[0].stato,
    badge: document.getElementById('badge-stampa-1').textContent,
    chiudibile: !document.querySelector('[data-chiudi="stampa-1"]').disabled,
    spia: document.getElementById('spia-stampa-1').className,
    fatto: document.querySelector('#vista-stampa-1 .st-fatto').getAttribute('d').length,
    punta: document.querySelector('#vista-stampa-1 .st-punta').getAttribute('visibility')
  }));
  ok('finita, la tab resta e lo dice', r.stato === 'fine' && /finita/.test(r.badge),
     r.badge);
  ok('e adesso si puo` chiudere, con la spia verde',
     r.chiudibile === true && /tab-spia-fine/.test(r.spia), r.spia);
  ok('il percorso fatto e` disegnato tutto', r.fatto > 50,
     r.fatto + ' caratteri di percorso');
  /* Una punta ferma in mezzo al foglio direbbe che la macchina e' ancora
     li', e non ci e' piu'. */
  ok('e la punta sparisce quando non c\'e` piu` niente che si muove',
     r.punta === 'hidden', r.punta);

  /* IL PERCORSO E` QUELLO GIUSTO, non un percorso qualsiasi. Il G-code e'
     modale: «X70» vuol dire «Y resta dov'era», e leggerlo come «Y zero»
     porterebbe il tratto dall'altra parte del foglio -- con un disegno che
     sembra comunque un disegno, che e' il modo peggiore di sbagliare. I due
     quadrati stanno fra 40 e 84 in X e fra 60 e 144 in Y: si controllano
     quelli. */
  r = await page.evaluate(() => {
    const d = document.querySelector('#vista-stampa-1 .st-giu').getAttribute('d');
    const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    return { x0: Math.min(...xs), x1: Math.max(...xs),
             y0: Math.min(...ys), y1: Math.max(...ys), quanti: n.length / 2 };
  });
  ok('e il percorso disegnato sta dove lo dice il G-code',
     r.x0 === 40 && r.x1 === 84 && r.y0 === 60 && r.y1 === 144,
     'da ' + r.x0 + ',' + r.y0 + ' a ' + r.x1 + ',' + r.y1 +
     ' su ' + r.quanti + ' punti');

  /* ============ LA COPIA CONGELATA, CHE E` IL PUNTO ============ */

  r = await page.evaluate(() => {
    const prima = Stampe.aperte()[0];
    /* Dopo la stampa si cambia tutto quello che la tab avrebbe potuto
       leggere dal vivo: foglio, posizione, carta. */
    Paper.setSize(105, 148);
    Paper.setSheetOrigin(3, 7);
    Profile.setColoreFoglio(105, 148, '#1d1d1b');
    Paper.renderFormati();
    const dopo = Stampe.aperte()[0];
    return { prima: prima.foglio, dopo: dopo.foglio,
             vivo: { w: State.data.paper.w, x: State.data.sheetOrigin.x } };
  });
  ok('cambiando foglio dopo, la tab racconta ancora il foglio di allora',
     r.dopo.w === 148 && r.dopo.h === 210 && r.dopo.x === 20 &&
     r.vivo.w === 105 && r.vivo.x === 3,
     'nella tab ' + r.dopo.w + '×' + r.dopo.h + ' a ' + r.dopo.x +
     ', sul piano ' + r.vivo.w + ' a ' + r.vivo.x);

  /* =============== UNA SECONDA STAMPA, UNA SECONDA TAB =============== */

  r = await page.evaluate((p) => {
    Sender.avvia(p, 'secondo.svg');
    return { aperte: Stampe.aperte().map((t) => t.numero + ':' + t.nome),
             tab: [...document.querySelectorAll('nav.tabs .tab')].length };
  }, PROGRAMMA(false));
  ok('la stampa dopo apre un\'altra tab, e la prima resta',
     r.aperte.length === 2 && /primo/.test(r.aperte[0]) && /secondo/.test(r.aperte[1]),
     r.aperte.join('  '));

  /* ============ RIPRENDERE NON E` UNA STAMPA NUOVA ============ */

  /* Pausa e cambio penna passano per lo stesso stato «invio» della
     partenza: senza distinguerli, ogni cambio penna aprirebbe una tab in
     piu' per la stessa stampa. */
  await page.waitForTimeout(200);
  r = await page.evaluate((p) => {
    const quante = Stampe.aperte().length;
    Sender.avvia(p, 'con cambio penna.svg');
    return { dopoAvvio: Stampe.aperte().length - quante, stato: Sender.stato() };
  }, PROGRAMMA(true));
  ok('una stampa col cambio penna si ferma al segno',
     r.stato === 'cambio' && r.dopoAvvio === 1, 'stato ' + r.stato);

  /* MENTRE LA STAMPA VA, LA SUA TAB NON SI CHIUDE. Chiuderla per sbaglio
     vorrebbe dire perdere la vista viva proprio mentre serve, e il cambio
     penna e' l'unico momento in cui una stampa finta sta ferma abbastanza
     da poterlo guardare. */
  r = await page.evaluate(() => {
    const id = Stampe.aperte()[Stampe.aperte().length - 1].id;
    const b = document.querySelector('[data-chiudi="' + id + '"]');
    b.click();                                   // e non deve succedere niente
    return { bloccata: b.disabled, ancora: !!document.getElementById('tab-' + id),
             titolo: b.title };
  });
  ok('mentre la stampa va, la sua tab non si puo` chiudere',
     r.bloccata === true && r.ancora === true, r.titolo);

  r = await page.evaluate(() => {
    const quante = Stampe.aperte().length;
    /* La finestra del cambio penna e' aperta: si salta la correzione, che
       e' la strada piu' corta, e la stampa riprende. */
    document.getElementById('modal-ok').click();      // ho tolto la penna
    document.getElementById('modal-ok').click();      // l'ho montata
    document.getElementById('modal-salta').click();   // riprendi senza correggere
    return { nuove: Stampe.aperte().length - quante, stato: Sender.stato(),
             ultima: Stampe.aperte()[Stampe.aperte().length - 1] };
  });
  ok('riprendendo dal cambio penna NON nasce una seconda tab',
     r.nuove === 0 && r.stato === 'fine',
     r.nuove + ' tab nuove, stato ' + r.stato);
  ok('e quella stampa sa di aver avuto un cambio penna',
     r.ultima.pause === 1, r.ultima.pause + ' pause nel programma');

  /* ====================== CHIUDERE ====================== */

  r = await page.evaluate(() => {
    document.querySelector('.tab[data-tab="stampa-1"]').click();
    const eraAttiva = document.getElementById('tab-stampa-1').classList.contains('is-active');
    document.querySelector('[data-chiudi="stampa-1"]').click();
    return { eraAttiva: eraAttiva,
             tab: !!document.querySelector('[data-tab="stampa-1"]'),
             panel: !!document.getElementById('tab-stampa-1'),
             attiva: (document.querySelector('.panel.is-active') || {}).id,
             restano: Stampe.aperte().length };
  });
  ok('la × toglie la tab e il suo pannello',
     r.eraAttiva === true && r.tab === false && r.panel === false && r.restano === 2,
     r.restano + ' tab restano');
  ok('e chiudendo quella che si guardava si torna al disegno',
     r.attiva === 'tab-disegno', 'davanti ' + r.attiva);

  /* ============ NON SE NE ACCUMULANO ALL'INFINITO ============ */

  r = await page.evaluate((p) => {
    for (let i = 0; i < 8; i++) Sender.avvia(p, 'tante ' + i + '.svg');
    return { aperte: Stampe.aperte().length,
             tab: document.querySelectorAll('nav.tabs .tab-wrap').length,
             panelli: document.querySelectorAll('.panel[id^="tab-stampa-"]').length };
  }, PROGRAMMA(false));
  ok('oltre il tetto le piu` vecchie se ne vanno, pannelli compresi',
     r.aperte <= 6 && r.tab === r.aperte && r.panelli === r.aperte,
     r.aperte + ' tab, ' + r.panelli + ' pannelli');

  /* ============ E ADESSO IL PROGRAMMA VERO ============
   *
   * Tutto quello che sta sopra usa un programma scritto a mano, ed e' giusto
   * cosi': serve sapere dove cadono i tratti, e per saperlo bisogna averli
   * messi li'. Ma un programma scritto a mano e' scritto dalla stessa testa
   * che ha scritto il lettore, e le due teste si mettono d'accordo sugli
   * stessi sbagli.
   *
   * QUESTO CONTROLLO E' NATO DA UNO SBAGLIO COSI'. Il generatore vero scrive
   * la parola «G» SOLO quando cambia -- quasi tutte le righe di una stampa
   * sono due numeri e basta, «X70.123 Y45.2» -- e il lettore ne pretendeva
   * una in testa a ogni riga. Su una stampa vera scartava il 98% del
   * programma e il percorso veniva VUOTO, senza un errore da nessuna parte.
   * Le prove qui sopra passavano tutte, perche' a mano la G si scrive
   * sempre.
   */
  r = await page.evaluate(() => {
    document.getElementById('btn-sample').click();
    return (Artwork.livelli() || []).length;
  });
  await page.waitForTimeout(600);
  r = await page.evaluate(() => {
    Paper.setSize(148, 210);
    Paper.setSheetOrigin(20, 20);
    Artwork.prepare();
    const prog = document.getElementById('gcode-out').value;
    Sender.avvia(prog, 'disegno vero.svg');
    const t = Stampe.aperte()[Stampe.aperte().length - 1];
    const id = t.id;
    const d = document.querySelector('#vista-' + id + ' .st-giu').getAttribute('d');
    const nn = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const xs = nn.filter((_, i) => i % 2 === 0), ys = nn.filter((_, i) => i % 2 === 1);
    return { tratti: t.tratti, righe: t.righe,
             x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
             y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
  });
  ok('col programma del generatore vero il percorso non e` vuoto',
     r.tratti > 200 && r.righe > 200,
     r.tratti + ' tratti da ' + r.righe + ' righe');
  /* E cade sul foglio, che va da 20,20 a 168,230: un lettore che perdesse la
     memoria delle coordinate manderebbe meta' dei tratti verso lo zero. */
  ok('e cade dentro al foglio, non sparso verso lo zero',
     r.x0 >= 20 && r.x1 <= 168 && r.y0 >= 20 && r.y1 <= 230,
     'da ' + r.x0.toFixed(1) + ',' + r.y0.toFixed(1) +
     ' a ' + r.x1.toFixed(1) + ',' + r.y1.toFixed(1));

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
