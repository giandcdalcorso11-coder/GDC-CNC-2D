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

/* Un dito solo che trascina: serve alle maniglie del riquadro. */
async function trascina(cdp, da, a, passi) {
  passi = passi || 8;
  const p = (x, y) => [{ x: x, y: y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p(da.x, da.y) });
  for (let i = 1; i <= passi; i++) {
    const k = i / passi;
    await cdp.send('Input.dispatchTouchEvent',
      { type: 'touchMove', touchPoints: p(da.x + (a.x - da.x) * k, da.y + (a.y - da.y) * k) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/* Un tocco secco: appoggia e stacca, senza muoversi. */
async function tocca(cdp, p) {
  await cdp.send('Input.dispatchTouchEvent',
    { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
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

  /* ============ H. LE PROPORZIONI SENZA IL TASTO SHIFT ============
     Le maniglie d'angolo deformano, e tenere le proporzioni era affidato a
     Shift: su un tablet il tasto Shift non c'e', quindi dall'iPad il disegno
     si poteva solo schiacciare. Adesso c'e' una spunta, e Shift la
     CAPOVOLGE. Qui si prova col dito, che e' il caso che prima non aveva
     strada. */
  await page.evaluate(() => document.querySelector('.tab[data-tab="disegno"]').click());
  await page.waitForTimeout(300);

  /* Tirando l'angolo in basso a destra SOLO in orizzontale: senza
     proporzioni cambia la larghezza e basta, con le proporzioni cambiano
     tutt'e due. E` il gesto in cui la differenza si vede, perche' un
     trascinamento obliquo cambierebbe i due lati comunque. */
  async function tiraAngolo(spunta) {
    /* Si riparte dalla pagina appena aperta: due scene di seguito sullo
       stesso disegno lo lascerebbero ingrandito dalla prima, e la seconda
       misurerebbe un'altra cosa. */
    await page.reload();
    await page.waitForTimeout(400);
    await page.evaluate(([svg, spunta]) => {
      Artwork.load(svg, 'prova.svg');
      Paper.adatta();
      Artwork.seleziona(Artwork.livelli()[0].id);
      Selezione.apri();
      document.getElementById('art-proporzioni').checked = spunta;
    }, [DISEGNO, spunta]);
    await page.waitForTimeout(200);
    const prima = await page.evaluate(() => {
      const b = Artwork.riquadro();
      const g = document.querySelector('.sel-grip[data-grip="br"]').getBoundingClientRect();
      return { w: b.w, h: b.h, g: { x: g.x + g.width / 2, y: g.y + g.height / 2 } };
    });
    await trascina(cdp, prima.g, { x: prima.g.x + 120, y: prima.g.y });
    await page.waitForTimeout(150);
    const dopo = await page.evaluate(() => {
      const b = Artwork.riquadro();
      return { w: b.w, h: b.h };
    });
    return { prima: prima, dopo: dopo };
  }

  r = await tiraAngolo(false);
  ok('col dito, senza la spunta, l\'angolo deforma come sempre',
     r.dopo.w > r.prima.w * 1.2 && Math.abs(r.dopo.h - r.prima.h) < 0.5,
     r.prima.w.toFixed(1) + '×' + r.prima.h.toFixed(1) + ' -> ' +
     r.dopo.w.toFixed(1) + '×' + r.dopo.h.toFixed(1));

  r = await tiraAngolo(true);
  const q0 = r.prima.w / r.prima.h, q1 = r.dopo.w / r.dopo.h;
  ok('con la spunta, il dito ingrandisce senza deformare',
     r.dopo.w > r.prima.w * 1.2 && Math.abs(q1 - q0) < 0.02,
     'proporzione ' + q0.toFixed(3) + ' -> ' + q1.toFixed(3));

  /* E SHIFT CAPOVOLGE, cosi' chi ha la tastiera non perde niente: con la
     spunta accesa, Shift torna a deformare. Qui si usa il mouse, perche' un
     dito il tasto non lo tiene premuto. */
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate((svg) => {
    Artwork.load(svg, 'prova.svg');
    Paper.adatta();
    Artwork.seleziona(Artwork.livelli()[0].id);
    Selezione.apri();
    document.getElementById('art-proporzioni').checked = true;
  }, DISEGNO);
  await page.waitForTimeout(200);
  const conShift = await page.evaluate(() => {
    const b = Artwork.riquadro();
    const g = document.querySelector('.sel-grip[data-grip="br"]').getBoundingClientRect();
    return { w: b.w, h: b.h, x: g.x + g.width / 2, y: g.y + g.height / 2 };
  });
  await page.keyboard.down('Shift');
  await page.mouse.move(conShift.x, conShift.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(conShift.x + 15 * i, conShift.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  r = await page.evaluate(() => {
    const b = Artwork.riquadro();
    return { w: b.w, h: b.h };
  });
  ok('e Shift capovolge la spunta: con le proporzioni accese, deforma',
     r.w > conShift.w * 1.2 && Math.abs(r.h - conShift.h) < 0.5,
     conShift.w.toFixed(1) + '×' + conShift.h.toFixed(1) + ' -> ' +
     r.w.toFixed(1) + '×' + r.h.toFixed(1));

  /* ============ I. I MAGNETI SI SPENGONO SENZA ALT ============
     Trascinando un foglio i bordi si agganciano a quelli degli altri.
     Sospenderli era affidato solo ad Alt tenuto premuto: su un tablet due
     fogli NON accostati non si potevano posare. */
  async function posaFoglio(magneti, conAlt) {
    await page.reload();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      /* Il primo foglio si fa piccolo PRIMA di aggiungerne altri: con un
         A5 di partenza i due nuovi non ci stanno accanto e finiscono
         sovrapposti nell'angolo, dove non c'e' nessun bordo da agganciare
         e la scena non misurerebbe niente. */
      Paper.setSize(75, 75);
      Paper.setSheetOrigin(10, 10);
      document.getElementById('paper-w').value = 75;
      document.getElementById('paper-h').value = 75;
      document.getElementById('btn-paper-add').click();
      document.getElementById('btn-paper-add').click();
      Paper.adatta();
    });
    await page.waitForTimeout(200);
    const dati = await page.evaluate((magneti) => {
      document.getElementById('fogli-magneti').checked = magneti;
      const f = State.data.fogli[1];
      const m = document.getElementById('layer-sheet').getScreenCTM();
      const c = new DOMPoint(f.origine.x + f.w / 2, f.origine.y + f.h / 2)
        .matrixTransform(m);
      return { x: c.x, y: c.y, pxPerMm: Math.abs(m.a), x0: f.origine.x };
    }, magneti);
    /* Sei millimetri a destra: dentro la tolleranza del magnete, quindi col
       magnete acceso il bordo torna ESATTO e con quello spento resta dove
       lo si e` lasciato. */
    const meta = { x: dati.x + 6 * dati.pxPerMm, y: dati.y };
    if (conAlt) {
      /* Col mouse e Alt premuto: e` la meta` della regola che riguarda chi
         ha la tastiera, e un dito il tasto non lo tiene premuto. */
      await page.keyboard.down('Alt');
      await page.mouse.move(dati.x, dati.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(dati.x + (meta.x - dati.x) * i / 8, dati.y);
      }
      await page.mouse.up();
      await page.keyboard.up('Alt');
    } else {
      await trascina(cdp, { x: dati.x, y: dati.y }, meta);
    }
    await page.waitForTimeout(150);
    const dopo = await page.evaluate(() => State.data.fogli[1].origine.x);
    return { prima: dati.x0, dopo: dopo };
  }

  r = await posaFoglio(true);
  ok('col dito e i magneti accesi, il foglio torna sul bordo esatto',
     r.dopo === r.prima, 'da ' + r.prima + ' a ' + r.dopo);
  r = await posaFoglio(false);
  ok('e con la spunta spenta si posa dove lo si lascia, senza premere Alt',
     r.dopo === r.prima + 6, 'da ' + r.prima + ' a ' + r.dopo);

  r = await posaFoglio(true, true);
  ok('e Alt capovolge la spunta: coi magneti accesi, li sospende',
     r.dopo === r.prima + 6, 'da ' + r.prima + ' a ' + r.dopo);

  /* ============ J. DUE TRATTI SENZA CTRL ============
     Prendere un tratto sostituisce la scelta; sommarne un altro era
     affidato solo a Ctrl, che su un tablet non esiste: dall'iPad si poteva
     prendere un tratto solo. */
  async function prendiDueTratti(somma) {
    await page.reload();
    await page.waitForTimeout(400);
    await page.evaluate((svg) => {
      Artwork.load(svg, 'prova.svg');
      document.querySelector('.tab[data-tab="editor"]').click();
    }, DISEGNO);
    await page.waitForTimeout(500);
    if (somma) await page.evaluate(() => document.getElementById('ed-somma').click());
    const b = await page.evaluate(() => {
      const r = document.querySelector('#ed-svg .ed-tratto').getBoundingClientRect();
      return { sopra: { x: r.x + r.width / 2, y: r.y },
               sinistra: { x: r.x, y: r.y + r.height / 2 } };
    });
    await tocca(cdp, b.sopra);
    await page.waitForTimeout(120);
    const uno = await page.evaluate(() => Editor.tratti().length);
    await tocca(cdp, b.sinistra);
    await page.waitForTimeout(120);
    const due = await page.evaluate(() => Editor.tratti().length);
    return { uno: uno, due: due,
             attivo: await page.evaluate(() =>
               document.getElementById('ed-somma').classList.contains('attivo')) };
  }

  r = await prendiDueTratti(true);
  ok('con «Somma» acceso, due tocchi prendono due tratti',
     r.attivo && r.uno === 1 && r.due === 2,
     'dopo il primo ' + r.uno + ', dopo il secondo ' + r.due);
  r = await prendiDueTratti(false);
  ok('e spento, il secondo tocco sostituisce il primo come sempre',
     !r.attivo && r.due <= 1, 'dopo il secondo ' + r.due);

  /* E CTRL CAPOVOLGE: con «Somma» acceso, Ctrl torna a sostituire. Era
     l'unica meta` della regola senza controllo -- nessun banco, qui dentro,
     aveva mai premuto Ctrl. */
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate((svg) => {
    Artwork.load(svg, 'prova.svg');
    document.querySelector('.tab[data-tab="editor"]').click();
  }, DISEGNO);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('ed-somma').click());
  const bordi = await page.evaluate(() => {
    const b = document.querySelector('#ed-svg .ed-tratto').getBoundingClientRect();
    return { sopra: { x: b.x + b.width / 2, y: b.y },
             sinistra: { x: b.x, y: b.y + b.height / 2 } };
  });
  await page.mouse.click(bordi.sopra.x, bordi.sopra.y);
  await page.waitForTimeout(120);
  await page.keyboard.down('Control');
  await page.mouse.click(bordi.sinistra.x, bordi.sinistra.y);
  await page.keyboard.up('Control');
  await page.waitForTimeout(120);
  r = await page.evaluate(() => Editor.tratti().length);
  ok('e Ctrl capovolge «Somma»: con l\'interruttore acceso, sostituisce',
     r <= 1, 'tratti scelti ' + r);

  if (errori.length) {
    console.log('\nerrori di pagina:');
    errori.forEach((e) => console.log('  ' + e));
    guai += errori.length;
  }
  console.log('\n' + (guai ? guai + ' guai' : 'tutto a posto'));
  await browser.close();
  process.exit(guai ? 1 : 0);
})();
