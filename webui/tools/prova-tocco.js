/* Il collaudo dei GESTI CON LE DITA: la pinzata e i bersagli.
 *
 * Gira con il tocco EMULATO davvero (niente eventi finti costruiti a mano):
 * la pagina riceve gli stessi eventi che riceverebbe da un iPad, capture del
 * puntatore compresa, perche' e' proprio li' che le cose si rompono -- un
 * gesto che il browser consegna a chi se l'e' preso per primo.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «si ingrandisce»: e' che la
 * pinzata ANCORI quello che sta fra le dita (se no il disegno scappa mentre
 * lo si guarda) e che NON faccia due cose insieme -- il primo dito aveva gia'
 * fatto partire lo spostamento dello sguardo o il trascinamento di un foglio,
 * e quei gesti devono farsi da parte.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-tocco.js
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

/* La pinzata, in passi: due dita che partono distanti `da` e finiscono
   distanti `a`, orizzontali attorno allo stesso centro. A piccoli passi,
   perche' e' incrementale -- ogni passo si misura su quello prima, ed e' la
   parte che puo' sbagliare. */
async function gesto(cdp, tappe, passi) {
  passi = passi || 8;
  const punti = (c, d) => [
    { x: c.x - d / 2, y: c.y, id: 1 },
    { x: c.x + d / 2, y: c.y, id: 2 }
  ];
  await cdp.send('Input.dispatchTouchEvent',
    { type: 'touchStart', touchPoints: punti(tappe[0].c, tappe[0].d) });
  for (let t = 1; t < tappe.length; t++) {
    const A = tappe[t - 1], B = tappe[t];
    for (let i = 1; i <= passi; i++) {
      const k = i / passi;
      const c = { x: A.c.x + (B.c.x - A.c.x) * k, y: A.c.y + (B.c.y - A.c.y) * k };
      await cdp.send('Input.dispatchTouchEvent',
        { type: 'touchMove', touchPoints: punti(c, A.d + (B.d - A.d) * k) });
    }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const pinza = (cdp, centro, da, a) =>
  gesto(cdp, [{ c: centro, d: da }, { c: centro, d: a }]);

const LARGHEZZA = (page, id) => page.evaluate((id) => {
  const v = document.getElementById(id).getAttribute('viewBox').split(/\s+/).map(Number);
  return { x0: v[0], y0: v[1], w: v[2], h: v[3] };
}, id);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  /* Un iPad: schermo largo e puntatore grosso. I due non vanno insieme per
     forza, ed e' il motivo per cui i bersagli si decidono sul PUNTATORE e non
     sulla larghezza della finestra. */
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true,
    deviceScaleFactor: 2
  });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(page);

  let r;

  /* ============ A. IL DITO E` IL PUNTATORE ============ */
  r = await page.evaluate(() => ({
    grosso: window.matchMedia('(pointer: coarse)').matches,
    tocco: !!window.Tocco
  }));
  ok('il browser del banco si comporta da tablet', r.grosso && r.tocco,
     'pointer coarse ' + r.grosso);

  /* ============ B. LA PINZATA INGRANDISCE ============ */
  await page.evaluate(() => { Paper.adatta(); });
  await page.waitForTimeout(100);

  const scatola = await page.evaluate(() => {
    const b = document.getElementById('bed-svg').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });

  const prima = await LARGHEZZA(page, 'bed-svg');
  await pinza(cdp, scatola, 120, 240);
  await page.waitForTimeout(100);
  const dopo = await LARGHEZZA(page, 'bed-svg');

  /* Dita che si allargano al doppio = finestra a meta'. Non e' un numero
     arbitrario: e' il rapporto fra le due distanze, ed e' l'unico che fa
     stare il disegno sotto le dita mentre si aprono. */
  ok('due dita che si allargano avvicinano il disegno',
     dopo.w < prima.w * 0.75,
     'da ' + prima.w.toFixed(1) + ' a ' + dopo.w.toFixed(1));
  /* Stretto apposta: il rapporto e' ESATTO, perche' la pinzata si fonda
     quando il secondo dito si appoggia e non al primo movimento. Con la
     tolleranza larga di prima, il mezzo passo di ritardo che faceva scappare
     il disegno di dieci pixel passava inosservato. */
  ok('e lo fanno del rapporto fra le due distanze, non di un passo fisso',
     Math.abs(dopo.w / prima.w - 0.5) < 0.02,
     'rapporto ' + (dopo.w / prima.w).toFixed(3) + ' contro 0,500');

  /* ANDATA E RITORNO. Due dita che tornano dove erano riportano il disegno
     esattamente dov'era: e' la prova che ogni passo si misura sull'INIZIO
     della pinzata e non su quello prima. Un conto incrementale qui lascia un
     residuo, e il residuo e' quello che si vede come «il disegno scappa». */
  await page.evaluate(() => { Paper.adatta(); });
  await page.waitForTimeout(100);
  const partenza = await LARGHEZZA(page, 'bed-svg');
  await gesto(cdp, [{ c: scatola, d: 120 }, { c: scatola, d: 300 },
                    { c: scatola, d: 120 }]);
  await page.waitForTimeout(100);
  const ritorno = await LARGHEZZA(page, 'bed-svg');
  ok('e le dita che tornano dov\'erano riportano il disegno dov\'era',
     Math.abs(ritorno.w - partenza.w) < 0.5 &&
     Math.abs(ritorno.x0 - partenza.x0) < 0.5,
     'largo ' + ritorno.w.toFixed(2) + ' contro ' + partenza.w.toFixed(2));

  /* ============ C. QUELLO CHE STA FRA LE DITA CI RESTA ============
     E' il controllo che conta: un ingrandimento che non ancora sposta il
     disegno mentre lo si guarda, e costringe a rincorrerlo. */
  await page.evaluate(() => { Paper.adatta(); });
  await page.waitForTimeout(100);
  const mmPrima = await page.evaluate((c) => {
    const m = document.getElementById('layer-sheet').getScreenCTM().inverse();
    const p = new DOMPoint(c.x, c.y).matrixTransform(m);
    return { x: p.x, y: p.y };
  }, scatola);
  await pinza(cdp, scatola, 120, 300);
  await page.waitForTimeout(100);
  const schermoDopo = await page.evaluate((mm) => {
    const m = document.getElementById('layer-sheet').getScreenCTM();
    const p = new DOMPoint(mm.x, mm.y).matrixTransform(m);
    return { x: p.x, y: p.y };
  }, mmPrima);
  const scarto = Math.hypot(schermoDopo.x - scatola.x, schermoDopo.y - scatola.y);
  ok('il punto fra le due dita resta dov\'era', scarto < 4,
     'scappato di ' + scarto.toFixed(1) + ' px');

  /* ============ C2. LA PINZATA SPOSTA ANCHE ============
     La mano che pinza non sta ferma: allarga le dita E le porta altrove, in
     un gesto solo. Se l'ancoraggio seguisse solo l'ingrandimento, il disegno
     resterebbe indietro di quanto si e' spostata la mano. Qui le dita si
     allargano e intanto il centro va in diagonale: il punto che era in mezzo
     deve trovarsi sotto al nuovo centro. La diagonale non e' un vezzo -- sul
     piano la y cresce verso l'alto e sullo schermo verso il basso, quindi un
     verso sbagliato si vede solo muovendosi anche in verticale. */
  await page.evaluate(() => { Paper.adatta(); });
  await page.waitForTimeout(100);
  const altrove = { x: scatola.x + 90, y: scatola.y - 60 };
  const mmCentro = await page.evaluate((c) => {
    const m = document.getElementById('layer-sheet').getScreenCTM().inverse();
    const p = new DOMPoint(c.x, c.y).matrixTransform(m);
    return { x: p.x, y: p.y };
  }, scatola);
  await gesto(cdp, [{ c: scatola, d: 120 }, { c: altrove, d: 220 }]);
  await page.waitForTimeout(100);
  const finito = await page.evaluate((mm) => {
    const m = document.getElementById('layer-sheet').getScreenCTM();
    const p = new DOMPoint(mm.x, mm.y).matrixTransform(m);
    return { x: p.x, y: p.y };
  }, mmCentro);
  const scartoDue = Math.hypot(finito.x - altrove.x, finito.y - altrove.y);
  ok('e segue le dita anche quando si spostano mentre si allargano',
     scartoDue < 4, 'scappato di ' + scartoDue.toFixed(1) + ' px');

  /* ============ D. I LIMITI SONO QUELLI DELLA ROTELLA ============
     Due dita distratte, senza limiti, portano a guardare un micron o una
     provincia -- e tornare indietro e' un lavoro. */
  await page.evaluate(() => { Paper.adatta(); });
  const adattato = await LARGHEZZA(page, 'bed-svg');
  for (let i = 0; i < 6; i++) await pinza(cdp, scatola, 300, 60);   // allontana
  const lontano = await LARGHEZZA(page, 'bed-svg');
  ok('non ci si allontana oltre il quadruplo dell\'adattato',
     lontano.w <= adattato.w * 4 + 0.5,
     lontano.w.toFixed(0) + ' contro ' + (adattato.w * 4).toFixed(0));
  for (let i = 0; i < 8; i++) await pinza(cdp, scatola, 60, 300);   // avvicina
  const vicino = await LARGHEZZA(page, 'bed-svg');
  ok('e non si scende sotto i 20 mm di larghezza', vicino.w >= 19.9,
     vicino.w.toFixed(2) + ' mm');

  /* ============ E. LA PINZATA NON TRASCINA ANCHE IL FOGLIO ============
     Il primo dito si appoggia su un foglio libero e fa partire il
     trascinamento; il secondo arriva dopo. Se il trascinamento non si fa da
     parte, il foglio scivola via mentre si ingrandisce -- e un foglio spostato
     e' una composizione cambiata senza volerlo. */
  await page.evaluate(() => { Paper.adatta(); });
  await page.waitForTimeout(100);
  const sulFoglio = await page.evaluate(() => {
    const b = document.querySelector('#layer-sheet .sheet').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const posaPrima = await page.evaluate(() =>
    State.data.fogli.map((f) => f.origine.x + ',' + f.origine.y).join(' '));
  await pinza(cdp, sulFoglio, 100, 260);
  await page.waitForTimeout(100);
  const posaDopo = await page.evaluate(() =>
    State.data.fogli.map((f) => f.origine.x + ',' + f.origine.y).join(' '));
  const ingrandito = (await LARGHEZZA(page, 'bed-svg')).w;
  ok('pinzando sopra un foglio libero il foglio non si sposta',
     posaPrima === posaDopo, posaPrima + ' -> ' + posaDopo);
  ok('ma la pinzata funziona lo stesso', ingrandito < adattato.w * 0.75,
     ingrandito.toFixed(1) + ' contro ' + adattato.w.toFixed(1));

  /* ============ F. I BERSAGLI DEI LIVELLI ============ */
  r = await page.evaluate((svg) => {
    Artwork.load(svg, 'prova.svg');
    const c = document.querySelector('.liv-chk').getBoundingClientRect();
    return { w: c.width, h: c.height };
  }, DISEGNO);
  /* Quaranta e non quarantaquattro: sulla riga ce ne stanno quattro accanto
     al nome. E' un compromesso dichiarato, non una svista. */
  ok('col dito il quadratino di un livello e` grande almeno 40 px',
     r.w >= 40 && r.h >= 40, r.w + ' × ' + r.h);

  /* ============ G. ANCHE LA TELA DELL'EDITOR SI PINZA ============ */
  r = await page.evaluate(() => {
    document.querySelector('.tab[data-tab="editor"]').click();
    return true;
  });
  await page.waitForTimeout(400);
  const telaBox = await page.evaluate(() => {
    const b = document.getElementById('ed-svg').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const telaPrima = await LARGHEZZA(page, 'ed-svg');
  await pinza(cdp, telaBox, 120, 240);
  await page.waitForTimeout(100);
  const telaDopo = await LARGHEZZA(page, 'ed-svg');
  ok('la tela dell\'editor si pinza come il piano',
     telaDopo.w < telaPrima.w * 0.75,
     'da ' + telaPrima.w.toFixed(1) + ' a ' + telaDopo.w.toFixed(1));

  if (errori.length) {
    console.log('\nerrori di pagina:');
    errori.forEach((e) => console.log('  ' + e));
    guai += errori.length;
  }
  console.log('\n' + (guai ? guai + ' guai' : 'tutto a posto'));
  await browser.close();
  process.exit(guai ? 1 : 0);
})();
