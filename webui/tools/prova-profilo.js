/* Il collaudo dell'avviso dei NUMERI DI FABBRICA.
 *
 * Nasce da una domanda dell'utente: aprendo lo SLICER dall'iPad col
 * telecomando spento, che cosa manca? Le tre misure pericolose no -- origine,
 * altezza di contatto e angolo del foglio le chiedono i popup di inizio
 * stampa, ogni volta, su ogni dispositivo. Manca il PROFILO, e manca in
 * silenzio: `Profile.load()` fonde `localStorage` sui valori compilati nella
 * pagina, quindi su un dispositivo che non ha mai salvato niente i campi sono
 * pieni di numeri plausibili -- le misure vere del giorno in cui la pagina e'
 * stata costruita.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «compare una fascia gialla»: e'
 * che la pagina sappia DISTINGUERE i due casi (un profilo suo, i numeri di
 * fabbrica) e lo dica negli stessi tre posti in cui un profilo sbagliato fa
 * danno -- all'apertura, nelle impostazioni, e nel popup appena prima che la
 * penna scenda. E che l'avviso NON blocchi: da un dispositivo di fabbrica si
 * stampa, perche' le tre misure del giorno vengono chieste comunque.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * un controllo che non si accende quando il codice e' rotto non e' un
 * controllo, e' una decorazione. Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-profilo.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

const DISEGNO = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
<path fill="none" stroke="#1d1d1b" d="M5 5 L35 5 L35 35 L5 35 Z"/></svg>`;

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
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* ============ A. UN DISPOSITIVO NUOVO SI RICONOSCE ============
     Il browser del banco e' appena nato: non ha mai salvato un profilo. E'
     esattamente l'iPad della domanda. */

  r = await page.evaluate(() => ({
    fabbrica: Profile.diFabbrica(),
    frase: Profile.provenienza(),
    /* I campi NON sono vuoti, ed e' il punto di tutto l'avviso: se lo
       fossero, chiunque se ne accorgerebbe da se'. */
    corsa: Profile.corsaTotale('x'),
    alzata: Profile.alzataMm()
  }));
  ok('un dispositivo senza profilo suo si riconosce', r.fabbrica === true,
     'diFabbrica ' + r.fabbrica);
  ok('e la frase dice di che numeri sono e di quando',
     /numeri di fabbrica/.test(r.frase) && /24\/10\/2026/.test(r.frase),
     r.frase);
  ok('ma i campi sono pieni di numeri plausibili, e per questo serve dirlo',
     r.corsa > 200 && r.alzata > 1, 'corsa ' + r.corsa.toFixed(1) +
     ' mm, alzata ' + r.alzata.toFixed(2) + ' mm');

  /* ============ B. LA FASCIA ALL'APERTURA ============ */

  r = await page.evaluate(() => {
    const f = document.getElementById('fascia-profilo');
    return {
      visibile: !f.hidden,
      testo: document.getElementById('fascia-profilo-testo').textContent,
      dentroLaPagina: !!f.closest('body') && f.getBoundingClientRect().height > 0
    };
  });
  ok('la fascia si accende e si vede', r.visibile && r.dentroLaPagina,
     'hidden ' + !r.visibile);
  /* Il testo deve nominare l'ALZATA DELLA PENNA. Non e' pignoleria: fra i
     numeri del profilo e' quello che fa danno in silenzio, perche' una penna
     che si alza poco striscia sul foglio durante gli spostamenti e lo si
     scopre sulla carta. Una fascia che dicesse solo «profilo di fabbrica»
     non direbbe a nessuno perche' dovrebbe importargli. */
  ok('e dice qual e` la misura che fa danno',
     /alzata della penna/.test(r.testo) && /striscia/.test(r.testo),
     r.testo.slice(0, 60) + '...');

  r = await page.evaluate(() => {
    document.getElementById('fascia-profilo-vai').click();
    const tab = document.getElementById('tab-impostazioni').classList.contains('is-active');
    document.getElementById('fascia-profilo-chiudi').click();
    return { tab, chiusa: document.getElementById('fascia-profilo').hidden };
  });
  ok('il pulsante porta nelle impostazioni, dove il profilo si importa', r.tab);
  ok('e la × chiude l\'avviso', r.chiusa);

  /* ============ C. LA VERIFICA DELLE IMPOSTAZIONI ============
     Un avviso, non un blocco: da un dispositivo di fabbrica si stampa,
     perche' i tre popup chiedono comunque le misure del giorno. Se diventasse
     un blocco, stampare dall'iPad sarebbe impossibile -- e la macchina quei
     popup li ha proprio per questo. */
  r = await page.evaluate(() => {
    const v = Profile.verifica();
    return {
      voce: v.filter((x) => x.campo === 'profilo'),
      blocchi: v.filter((x) => x.gravita === 'blocco').map((x) => x.campo)
    };
  });
  ok('la verifica porta la voce del profilo, come avviso',
     r.voce.length === 1 && r.voce[0].gravita === 'avviso' &&
     /numeri di fabbrica/.test(r.voce[0].testo),
     JSON.stringify(r.voce.map((x) => x.gravita)));
  ok('e non blocca niente: da qui si stampa', r.blocchi.length === 0,
     'blocchi su ' + r.blocchi.join(', '));

  /* ============ D. LA RIGA NEL POPUP DI INIZIO STAMPA ============
     E' l'ultimo momento utile: dopo, la penna scende. */
  r = await page.evaluate((svg) => {
    Artwork.load(svg, 'prova.svg');
    Artwork.prepare();
    Popup.avviaStampa();
    const riga = document.querySelector('#modal-desc .pop-profilo');
    return {
      aperto: !document.getElementById('modal').hidden,
      c: !!riga,
      testo: riga ? riga.textContent : '',
      gialla: riga ? riga.classList.contains('di-fabbrica') : false
    };
  }, DISEGNO);
  ok('i popup di inizio stampa si aprono anche da un dispositivo di fabbrica',
     r.aperto);
  ok('e portano la riga di quale profilo sta stampando',
     r.c && /numeri di fabbrica/.test(r.testo), r.testo);
  ok('segnata, perche` quei numeri non sono di questa macchina', r.gialla);

  await page.evaluate(() => Popup.chiudi());

  /* ============ E. DOPO AVER SALVATO, L'AVVISO SPARISCE ============
     Un avviso che resta anche quando la cosa e' sistemata si impara a
     ignorare, e il giorno che serviva nessuno lo legge. */
  const salvato = await page.evaluate(() => Profile.save());
  if (!salvato) {
    ok('il profilo si salva nel browser del banco', false,
       'localStorage non disponibile: il resto del controllo non si puo` fare');
  } else {
    r = await page.evaluate(() => ({
      fabbrica: Profile.diFabbrica(),
      frase: Profile.provenienza(),
      voce: Profile.verifica().filter((x) => x.campo === 'profilo').length
    }));
    ok('appena salvato, il dispositivo ha un profilo suo', r.fabbrica === false);
    ok('e la frase dice quando l\'ha salvato',
       /profilo di questo dispositivo, salvato il/.test(r.frase), r.frase);
    ok('la verifica non ha piu` la voce del profilo', r.voce === 0);

    /* E DOPO UN RICARICO, che e' il caso vero: il profilo arriva da
       localStorage, non dalla memoria di questa pagina. */
    await page.reload();
    await page.waitForTimeout(400);
    r = await page.evaluate(() => ({
      fabbrica: Profile.diFabbrica(),
      fascia: document.getElementById('fascia-profilo').hidden
    }));
    ok('riaprendo la pagina il profilo salvato si ritrova', r.fabbrica === false);
    ok('e la fascia non si accende', r.fascia === true);

    r = await page.evaluate((svg) => {
      Artwork.load(svg, 'prova.svg');
      Artwork.prepare();
      Popup.avviaStampa();
      const riga = document.querySelector('#modal-desc .pop-profilo');
      return { c: !!riga, testo: riga ? riga.textContent : '',
               gialla: riga ? riga.classList.contains('di-fabbrica') : false };
    }, DISEGNO);
    ok('il popup dice comunque quale profilo sta stampando, e di quando',
       r.c && /salvato il/.test(r.testo), r.testo);
    ok('ma senza il giallo dell\'avviso', r.gialla === false);
  }

  if (errori.length) {
    console.log('\nerrori di pagina:');
    errori.forEach((e) => console.log('  ' + e));
    guai += errori.length;
  }
  console.log('\n' + (guai ? guai + ' guai' : 'tutto a posto'));
  await browser.close();
  process.exit(guai ? 1 : 0);
})();
