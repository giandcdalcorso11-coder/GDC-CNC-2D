/* Il collaudo di DUE PROGETTI SALVATI CHE FINISCONO SULLO STESSO FOGLIO.
 *
 * IL PROBLEMA, detto dall'operatore il 2026-11-06: «carico un file che ho
 * salvato perche' mi servono alcune parti da quello, poi ne carico un altro
 * perche' altre parti mi servono da quello, e il secondo sovrascrive il
 * primo». Era vero e di proposito: `daProgetto()` azzerava l'elenco dei
 * livelli, perche' un progetto «non si importa, si riprende». Giusto per
 * riprendere la giornata di ieri, sbagliato per pescare dei pezzi, e la
 * finestrella che chiedeva il permesso era un `window.confirm`, che ha due
 * pulsanti e quindi non poteva offrire la terza strada.
 *
 * LE COSE CHE SI CONTROLLANO DAVVERO non sono «il pulsante c'e'»:
 *   1. che sul foglio vuoto non si chieda niente (una domanda con una
 *      risposta sola e' solo un clic in piu');
 *   2. che mentre la finestrella e' aperta NON sia ancora cambiato niente —
 *      il difetto peggiore sarebbe aggiungere e poi chiedere;
 *   3. che aggiungendo arrivino le FORME e non i tracciati: le curve sono
 *      esattamente quello che si perderebbe riaprendo lo stesso file come un
 *      SVG qualunque, ed e' il motivo per cui questa strada esiste;
 *   4. che aggiungendo il foglio in uso NON si muova (e' la decisione del 6
 *      novembre: chi c'era prima e' il padrone di casa);
 *   5. che «Sostituisci tutto» faccia ancora quello che ha sempre fatto,
 *      foglio compreso — la strada vecchia non si rompe per farne una nuova;
 *   6. che due progetti arrivati insieme diano DUE domande. Trascinandone
 *      due, aprire la seconda finestrella sopra la prima perderebbe una
 *      scelta senza dirlo, e il secondo file sparirebbe in silenzio.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * un controllo che non si accende quando il codice e' rotto non e' un
 * controllo, e' una decorazione. Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-progetto.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Due disegni fatti a mano, e fatti a mano per una ragione: il primo ha una
   CURVA vera -- due nodi con le maniglie -- e il disegno di esempio non ne ha
   nemmeno una. Senza una curva, il controllo che conta piu' di tutti (le
   forme arrivano intere) non avrebbe niente da guardare. */
const CURVO = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
<path fill="none" stroke="#1f4fa8" d="M10 10 C 30 60, 70 60, 90 10"/>
<path fill="none" stroke="#c8102e" d="M10 90 L 90 90"/></svg>`;

const DRITTO = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
<path fill="none" stroke="#1d1d1b" d="M20 20 L 80 20 L 80 80"/></svg>`;

/* Lo stato della pagina, ridotto a quello che serve a queste domande. */
const STATO = (page) => page.evaluate(() => {
  const p = Artwork.progetto();
  return {
    quanti: p.livelli.length,
    nomi: p.livelli.map((l) => l.nome),
    curve: p.livelli.map((l) => Tracciato.conta(l.forme).curve),
    penne: p.livelli.map((l) => l.penna || null),
    spessori: p.livelli.map((l) => l.spessore || null),
    cambi: p.livelli.map((l) => !!l.cambioPenna),
    foglio: [State.data.paper.w, State.data.paper.h],
    aperta: !document.getElementById('prog-modal').hidden,
    titolo: document.getElementById('prog-titolo').textContent,
    desc: document.getElementById('prog-desc').textContent,
    nota: document.getElementById('prog-nota').hidden
      ? null : document.getElementById('prog-nota').textContent,
    coda: document.getElementById('prog-coda').hidden
      ? null : document.getElementById('prog-coda').textContent,
    bottoni: ['prog-annulla', 'prog-sostituisci', 'prog-aggiungi']
      .map((id) => document.getElementById(id).textContent)
  };
});

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* Il file da tenere da parte: due livelli, su un A4, con una penna e uno
     spessore scelti a mano -- cioe' le cose che un SVG normale non sa dire. */
  const salvato = await page.evaluate(([CURVO]) => {
    document.getElementById('btn-clear-file').click();
    Paper.setSize(210, 297);
    Artwork.load(CURVO, 'curvo.cnc2d.svg');
    const l = Artwork.livelli();
    Artwork.scegliPenna(l[0].id, '#1f4fa8');
    Artwork.scegliSpessore(l[0].id, 0.8);
    Artwork.scegliPenna(l[1].id, '#c8102e');
    return Progetto.testo();
  }, [CURVO]);

  /* Un secondo progetto, diverso e su un altro foglio: serve alla coda. */
  const altro = await page.evaluate(([DRITTO]) => {
    document.getElementById('btn-clear-file').click();
    Paper.setSize(148, 210);
    Artwork.load(DRITTO, 'dritto.cnc2d.svg');
    return Progetto.testo();
  }, [DRITTO]);

  /* La scena di partenza: il lavoro che c'e' gia' sul foglio, su un A5. */
  const SCENA = async () => page.evaluate(([DRITTO]) => {
    document.getElementById('btn-clear-file').click();
    Paper.setSize(148, 210);
    Artwork.load(DRITTO, 'in corso.svg');
  }, [DRITTO]);

  /* ============ 1. SUL FOGLIO VUOTO NON SI CHIEDE NIENTE ============
     Non c'e' nessuna differenza fra sostituire e aggiungere quando non c'e'
     niente da sostituire. */
  await page.evaluate(() => { document.getElementById('btn-clear-file').click(); });
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('sul foglio vuoto il progetto si apre senza chiedere niente',
     !r.aperta && r.quanti === 2 && r.foglio[0] === 210 && r.foglio[1] === 297,
     'finestrella ' + (r.aperta ? 'aperta' : 'chiusa') + ', ' + r.quanti +
     ' livelli, foglio ' + r.foglio.join('×'));

  /* ============ 2. CON DEL LAVORO SI CHIEDE, E SOLO SI CHIEDE ============
     Che la finestrella si apra conta meno di questo: che mentre e' aperta non
     sia ancora cambiato niente. Aggiungere e poi chiedere sarebbe il difetto
     peggiore di tutti, perche' il «no» non servirebbe a nulla. */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('con del lavoro sul foglio la finestrella si apre', r.aperta &&
     /curvo\.cnc2d\.svg/.test(r.titolo), r.titolo);
  ok('e sono tre strade, non due', r.bottoni.length === 3 &&
     /Annulla/.test(r.bottoni[0]) && /Sostituisci/.test(r.bottoni[1]) &&
     /Aggiungi/.test(r.bottoni[2]), r.bottoni.join(' | '));
  ok('mentre la finestrella e` aperta non e` cambiato niente',
     r.quanti === 1 && r.nomi[0] === 'in corso.svg' &&
     r.foglio[0] === 148 && r.foglio[1] === 210,
     r.quanti + ' livelli (' + r.nomi.join(', ') + '), foglio ' + r.foglio.join('×'));
  /* Il foglio diverso si dice PRIMA di scegliere: e' la cosa che fa trovare
     un livello mezzo fuori dal foglio senza capire perche'. */
  ok('e il foglio diverso e` scritto nella finestrella',
     r.nota !== null && /210/.test(r.nota) && /148/.test(r.nota), r.nota);

  /* ============ 3. ANNULLA NON TOCCA NIENTE ============ */
  await page.click('#prog-annulla');
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('«Annulla» lascia il foglio com\'era', !r.aperta && r.quanti === 1 &&
     r.nomi[0] === 'in corso.svg' && r.foglio[0] === 148,
     r.quanti + ' livelli, foglio ' + r.foglio.join('×'));

  /* ============ 4. AGGIUNGI: I LIVELLI SI ACCOSTANO ============ */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(100);
  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('«Aggiungi i livelli» li mette accanto a quelli che ci sono',
     r.quanti === 3 && r.nomi[0] === 'in corso.svg' &&
     /curvo\.cnc2d\.svg/.test(r.nomi[1]) && /curvo\.cnc2d\.svg/.test(r.nomi[2]),
     r.quanti + ': ' + r.nomi.join(', '));

  /* QUESTO e' il controllo per cui la strada esiste. Riaprendo lo stesso file
     come un SVG qualunque i tracciati salvati sono polilinee gia' appiattite:
     la curva diventerebbe una spezzata e l'editor non la ricurverebbe piu'. */
  ok('e le forme arrivano intere: la curva e` ancora una curva',
     r.curve[1] === 2, 'nodi con una curva per livello: ' + r.curve.join(', '));
  ok('con penna e spessore scelti a mano',
     r.penne[1] === '#1f4fa8' && r.spessori[1] === 0.8 && r.penne[2] === '#c8102e',
     'penne ' + JSON.stringify(r.penne) + ', spessori ' + JSON.stringify(r.spessori));

  /* La decisione del 6 novembre: del file si prendono SOLO i livelli. */
  ok('e il foglio in uso non si muove', r.foglio[0] === 148 && r.foglio[1] === 210,
     'foglio ' + r.foglio.join('×'));

  /* Il primo livello arrivato chiede un cambio penna anche se nel suo file non
     lo chiedeva: la' era il primo di tutti, qui viene dopo il lavoro di
     qualcun altro, e due file sono due disegni. */
  ok('il primo livello arrivato chiede un cambio penna',
     r.cambi[0] === false && r.cambi[1] === true,
     'cambi penna: ' + JSON.stringify(r.cambi));

  /* ============ 5. SOSTITUISCI TUTTO FA ANCORA QUELLO CHE FACEVA ============
     La strada nuova non si fa rompendo quella vecchia: «sostituisci» resta la
     ripresa di un progetto, foglio compreso. */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(100);
  await page.click('#prog-sostituisci');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('«Sostituisci tutto» torna a quel progetto, foglio compreso',
     r.quanti === 2 && r.nomi.every((n) => /curvo\.cnc2d\.svg/.test(n)) &&
     r.foglio[0] === 210 && r.foglio[1] === 297,
     r.quanti + ' livelli (' + r.nomi.join(', ') + '), foglio ' + r.foglio.join('×'));

  /* ============ 6. DUE PROGETTI INSIEME, DUE DOMANDE ============
     Trascinandone due, i due FileReader finiscono quando finiscono. Aprire la
     seconda finestrella sopra la prima vorrebbe dire perdere una scelta senza
     dirlo: il secondo file sparirebbe e nessuno saprebbe perche'. */
  await SCENA();
  await page.evaluate(([a, b]) => {
    Artwork.load(a, 'curvo.cnc2d.svg');
    Artwork.load(b, 'dritto.cnc2d.svg');
  }, [salvato, altro]);
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('due progetti insieme: si chiede del primo e si dice che c\'e` un altro',
     r.aperta && /curvo/.test(r.titolo) && r.coda !== null &&
     /un altro progetto/.test(r.coda), r.titolo + ' — coda: ' + r.coda);

  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('e dopo la prima scelta si chiede del secondo, senza perderlo',
     r.aperta && /dritto/.test(r.titolo) && r.coda === null && r.quanti === 3,
     r.titolo + ', ' + r.quanti + ' livelli');

  /* Il secondo progetto e' sullo stesso foglio della scena: il riquadro del
     foglio diverso NON deve comparire. Un avviso che compare sempre e' un
     avviso che non si legge piu'. */
  ok('e del foglio non si dice niente quando e` lo stesso',
     r.nota === null, String(r.nota));

  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('alla fine ci sono tutti e due i progetti, piu` il lavoro di prima',
     !r.aperta && r.quanti === 4 && r.nomi[0] === 'in corso.svg' &&
     /dritto/.test(r.nomi[3]) && r.foglio[0] === 148,
     r.quanti + ': ' + r.nomi.join(', ') + ', foglio ' + r.foglio.join('×'));

  /* Il registro e' la seconda metà dell'avviso: la finestrella si chiude, e
     quello che e' stato deciso deve restare scritto da qualche parte. */
  r = await page.evaluate(() => [...document.querySelectorAll('#log-view .log-line')]
    .slice(-16).map((d) => {
      const s = d.querySelector('span:last-child');
      return s.className.replace('log-', '') + ' ' + s.textContent;
    }));
  ok('il registro racconta l\'aggiunta e il foglio ignorato',
     r.some((t) => /^msg Aggiunti 2 livelli dal progetto curvo/.test(t)) &&
     r.some((t) => /^err Attenzione: quel progetto era su un foglio 210 × 297/.test(t)),
     r.filter((t) => /Aggiunti|Attenzione/.test(t)).join(' | ').slice(0, 150));

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
