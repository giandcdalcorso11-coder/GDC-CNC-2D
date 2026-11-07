/* Il collaudo di PIU' FOGLI SUL PIANO (Step 11, fase 2).
 *
 * La fase 1 ha messo i fogli nel modello e non si vedeva. Questa si vede: il
 * piano li disegna tutti, si aggiungono e si tolgono dalla colonna, si
 * trascinano, e trascinandoli si AGGANCIANO l'uno all'altro. E i livelli
 * smettono di stare «sul foglio» per stare su UN foglio.
 *
 * LE DUE COSE CHE CONTANO DAVVERO, e nessuna delle due si vede guardando lo
 * schermo:
 *
 *   1. CHE I DISEGNI DI DUE FOGLI NON SI MESCOLINO. Il rettangolo, i tratti
 *      e il ritaglio di un livello sono millimetri DEL SUO foglio. Sommare
 *      l'angolo sbagliato non fa sbagliare di poco: fa disegnare il magnete
 *      3 sopra il magnete 1. Si controlla sul G-code, che e' l'unico posto
 *      dove la cosa diventa vera.
 *
 *   2. CHE I MAGNETI AGGANCINO ESATTO. Un foglio appoggiato a occhio e
 *      sbagliato di mezzo millimetro NON e' accostato: chiedera' la sua
 *      misura, e chi l'ha posato non capira' perche'. I magneti sono quello
 *      che rende il gesto affidabile, quindi o portano il bordo sulla riga o
 *      non servono a niente.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO.
 * Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-piano.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

const DISEGNO = (tinta) => `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
<path fill="none" stroke="${tinta}" d="M5 5 L35 5 L35 35 L5 35 Z"/></svg>`;

/* Da millimetri del piano a pixel sullo schermo. Passa per la matrice del
   gruppo che disegna i fogli, quindi si porta dietro lo zoom, lo scorrimento
   E il ribaltamento della y — sul piano la y cresce verso l'alto, sullo
   schermo verso il basso, e sbagliare quello vuol dire trascinare il foglio
   dalla parte opposta senza capire perche'. */
const SCHERMO = (page, x, y) => page.evaluate(([x, y]) => {
  const m = document.getElementById('layer-sheet').getScreenCTM();
  const p = new DOMPoint(x, y).matrixTransform(m);
  return { x: p.x, y: p.y };
}, [x, y]);

/* Si riparte sempre da un foglio solo e dal piano vuoto. */
const AZZERA = (page) => page.evaluate(() => {
  document.getElementById('btn-clear-file').click();
  const l = State.data.fogli;
  while (l.length > 1) Fogli.togli(l[l.length - 1].id);
  Fogli.scegli(l[0].id);
  l[0].misurato = false;
  Paper.setSize(75, 75);
  Paper.setSheetOrigin(10, 10);
  /* Anche lo sguardo: un banco che eredita lo zoom del controllo precedente
     misura due cose insieme. */
  Paper.adatta();
});

/* Le posizioni della punta nel G-code, in coordinate macchina. Il generatore
   e' MODALE -- scrive la G, le coordinate e la F solo quando cambiano --
   quindi chi legge deve esserlo altrettanto: pretendere la X su ogni riga
   vorrebbe dire buttarne via la maggior parte e non accorgersene. */
function puntiDelProgramma(testo) {
  const out = [];
  let x = null, y = null;
  testo.split('\n').forEach((riga) => {
    const r = riga.split(';')[0].trim();
    if (!r) return;
    const mx = r.match(/X(-?\d+(?:\.\d+)?)/);
    const my = r.match(/Y(-?\d+(?:\.\d+)?)/);
    if (mx) x = +mx[1];
    if (my) y = +my[1];
    if ((mx || my) && x !== null && y !== null) out.push({ x, y });
  });
  return out;
}

function dentro(p, r, gioco) {
  gioco = gioco || 0.01;
  return p.x >= r.x0 - gioco && p.x <= r.x1 + gioco &&
         p.y >= r.y0 - gioco && p.y <= r.y1 + gioco;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* ============ A. IL PIANO LI DISEGNA TUTTI ============ */

  await AZZERA(page);
  r = await page.evaluate(() => {
    document.getElementById('btn-foglio-add').click();
    document.getElementById('btn-foglio-add').click();
    return {
      rettangoli: document.querySelectorAll('#layer-sheet .sheet').length,
      attivi: document.querySelectorAll('#layer-sheet .sheet-attivo').length,
      /* Senza `?.` il controllo MORIREBBE invece di fallire quando nessun
         foglio è segnato come quello in uso, e un banco che si interrompe
         dice molto meno di un banco che dice che cosa non va. */
      attivoGiusto: (document.querySelector('#layer-sheet .sheet-attivo') || {})
        .dataset !== undefined &&
        document.querySelector('#layer-sheet .sheet-attivo')
          .dataset.foglio === State.data.foglioAttivo,
      chip: document.querySelectorAll('#fogli-row .foglio').length,
      nota: document.getElementById('fogli-nota').textContent,
      pose: State.data.fogli.map((f) => f.origine.x + ',' + f.origine.y).join(' ')
    };
  });
  ok('il piano disegna tutti i fogli, e uno solo e` quello in uso',
     r.rettangoli === 3 && r.attivi === 1 && r.attivoGiusto && r.chip === 3,
     r.rettangoli + ' rettangoli, ' + r.attivi + ' attivo, ' + r.chip + ' in colonna');
  ok('il «+» posa il foglio nuovo accanto, e l\'elenco dice un angolo solo',
     r.pose === '10,10 85,10 10,85' && /UN angolo da misurare/.test(r.nota),
     r.pose + ' — ' + r.nota);

  /* ============ B. I MAGNETI ============
     Si trascina il secondo foglio in un punto SBAGLIATO di due millimetri:
     senza magnete resterebbe li', e due millimetri di scarto vogliono dire
     un foglio che si misura da solo invece di ricavare l'angolo. */
  await AZZERA(page);
  await page.evaluate(() => {
    const f = Fogli.aggiungi(75, 75, null);
    Fogli.muovi(f.id, 170, 150);
    Fogli.scegli(f.id);
  });
  await page.waitForTimeout(120);

  /* Il foglio 1 sta a (10,10)-(85,85). Si punta il foglio 2 a (87, 12): il
     suo bordo sinistro a due millimetri dal destro del foglio 1, e la base
     a due dalla sua. */
  let da = await SCHERMO(page, 170 + 37.5, 150 + 37.5);
  let a = await SCHERMO(page, 87 + 37.5, 12 + 37.5);
  await page.mouse.move(da.x, da.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y, { steps: 8 });
  r = await page.evaluate(() => ({
    org: [State.data.fogli[1].origine.x, State.data.fogli[1].origine.y],
    guide: document.querySelectorAll('.sheet-guida').length
  }));
  const durante = r;
  await page.mouse.up();
  await page.waitForTimeout(120);
  r = await page.evaluate(() => ({
    org: [State.data.fogli[1].origine.x, State.data.fogli[1].origine.y],
    agg: State.data.fogli[1].aggancio === State.data.fogli[0].id,
    daMisurare: Fogli.daMisurare().length,
    guide: document.querySelectorAll('.sheet-guida').length,
    nota: document.getElementById('fogli-nota').textContent
  }));
  ok('il magnete porta il bordo ESATTO sul bordo dell\'altro foglio',
     durante.org[0] === 85 && durante.org[1] === 10,
     'puntato a 87,12 — finito a ' + durante.org);
  ok('e mentre si trascina si vede perche`', durante.guide === 2,
     durante.guide + ' righe di guida');
  ok('lasciandolo, i due fogli sono accostati: un angolo invece di due',
     r.agg && r.daMisurare === 1 && /UN angolo da misurare/.test(r.nota),
     'aggancio ' + r.agg + ', da misurare ' + r.daMisurare);
  ok('e le righe di guida spariscono quando si lascia', r.guide === 0,
     r.guide + ' righe rimaste');

  /* Alt li spegne tutti: una via d'uscita che lascia acceso qualcosa non e'
     una via d'uscita. Senza, non ci sarebbe modo di posare un foglio a due
     millimetri da un altro di proposito. */
  await page.keyboard.down('Alt');
  da = await SCHERMO(page, 85 + 37.5, 10 + 37.5);
  a = await SCHERMO(page, 87 + 37.5, 12 + 37.5);
  await page.mouse.move(da.x, da.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y, { steps: 8 });
  r = await page.evaluate(() => ({
    org: [State.data.fogli[1].origine.x, State.data.fogli[1].origine.y],
    guide: document.querySelectorAll('.sheet-guida').length
  }));
  await page.mouse.up();
  await page.keyboard.up('Alt');
  ok('Alt spegne i magneti: il foglio resta dove lo metti',
     r.org[0] === 87 && r.org[1] === 12 && r.guide === 0,
     'finito a ' + r.org + ', ' + r.guide + ' guide');

  /* Un foglio misurato sulla macchina non si trascina: spostarlo dopo
     sposterebbe il disegno sulla carta vera senza che niente lo dica. */
  await page.evaluate(() => { State.data.fogli[1].misurato = true; Paper.refreshArea(); });
  da = await SCHERMO(page, 87 + 37.5, 12 + 37.5);
  a = await SCHERMO(page, 150 + 37.5, 100 + 37.5);
  await page.mouse.move(da.x, da.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y, { steps: 6 });
  await page.mouse.up();
  r = await page.evaluate(() => [State.data.fogli[1].origine.x, State.data.fogli[1].origine.y]);
  ok('un foglio misurato non si trascina', r[0] === 87 && r[1] === 12,
     'finito a ' + r);

  /* LA TOLLERANZA DEI MAGNETI SI MISURA IN PIXEL, non in millimetri.
     Da ingranditi un millimetro è mezzo schermo: una tolleranza fissa in
     millimetri aggancerebbe tutto quello che si sposta, cioè toglierebbe
     proprio la precisione per cui ci si era ingranditi. Stesso gesto di
     prima — due millimetri di scarto — ma con il piano ingrandito dieci
     volte: lì due millimetri sono lontani, e il foglio deve restare dove lo
     si mette. */
  await AZZERA(page);
  await page.evaluate(() => {
    const f = Fogli.aggiungi(75, 75, null);
    Fogli.muovi(f.id, 170, 150);
    Fogli.scegli(f.id);
    Paper.zoomA && Paper.zoomA(10);
  });
  await page.waitForTimeout(120);
  /* Ingrandire si fa con la rotella sul piano, che è l'unica strada che
     esiste: non c'è un pulsante dello zoom. */
  da = await SCHERMO(page, 170 + 37.5, 150 + 37.5);
  await page.mouse.move(da.x, da.y);
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(120);
  r = await page.evaluate(() => {
    const m = document.getElementById('layer-sheet').getScreenCTM();
    return { mmPerPixel: 1 / m.a };
  });
  const ingrandito = r.mmPerPixel;
  da = await SCHERMO(page, 170 + 37.5, 150 + 37.5);
  a = await SCHERMO(page, 87 + 37.5, 12 + 37.5);
  await page.mouse.move(da.x, da.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y, { steps: 10 });
  await page.mouse.up();
  r = await page.evaluate(() => [State.data.fogli[1].origine.x,
                                 State.data.fogli[1].origine.y]);
  ok('da ingranditi i magneti non agganciano piu` da lontano',
     ingrandito < 0.2 && r[0] === 87 && r[1] === 12,
     'un pixel vale ' + ingrandito.toFixed(3) + ' mm, foglio finito a ' + r);

  /* IL PIANO NON SI RIMPICCIOLISCE SOTTO IL DITO.
     La didascalia sotto al piano si allunga e si accorcia mentre si
     trascina — «la penna ne raggiunge...», «ESCE DALLA TAVOLA...» — e
     finche' stava nel flusso quell'altezza la toglieva al disegno: il piano
     si ridimensionava a meta' gesto e il foglio scappava da sotto il
     puntatore. Si misura l'altezza dell'SVG mentre il dito e' giu': deve
     restare quella. */
  await AZZERA(page);
  await page.evaluate(() => {
    const f = Fogli.aggiungi(75, 75, null);
    Fogli.scegli(f.id);
    window.__h = [];
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    document.getElementById('layer-sheet').addEventListener('pointermove', () => {
      window.__h.push(Math.round(document.getElementById('bed-svg')
        .getBoundingClientRect().height));
    });
  });
  da = await SCHERMO(page, 85 + 37.5, 10 + 37.5);
  /* Fino a mezzo metro oltre il bordo della tavola: e' il punto in cui la
     didascalia e' piu' lunga che puo'. */
  a = await SCHERMO(page, 330 + 37.5, 330 + 37.5);
  await page.mouse.move(da.x, da.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y, { steps: 12 });
  await page.mouse.up();
  r = await page.evaluate(() => ({
    h: window.__h, didascalia: document.getElementById('stage-caption').textContent
  }));
  ok('il piano non cambia misura mentre si trascina un foglio',
     r.h.length > 6 && new Set(r.h).size === 1,
     'altezze viste: ' + JSON.stringify([...new Set(r.h)]) + ' in ' + r.h.length +
     ' movimenti, con la didascalia a ' + r.didascalia.length + ' caratteri');

  /* ============ C. I LIVELLI STANNO SU UN FOGLIO ============ */

  await AZZERA(page);
  r = await page.evaluate(([svgA, svgB]) => {
    /* Foglio 1 a (10,10), foglio 2 accanto a (85,10). Un disegno per uno. */
    Artwork.load(svgA, 'uno.svg');
    /* DI MISURE DIVERSE, e non per fare scena: `fitRect` guarda solo
       larghezza e altezza, quindi con due fogli uguali adattare un disegno
       al foglio sbagliato darebbe lo stesso rettangolo e il controllo non
       vedrebbe niente. Lo ha trovato il banco delle mutazioni. */
    const f2 = Fogli.aggiungi(105, 148, 'A6');
    Fogli.scegli(f2.id);
    Artwork.load(svgB, 'due.svg');
    const l = Artwork.livelli();
    return {
      quanti: l.length,
      fogli: l.map((x) => Artwork.foglioDi(x.id).id),
      f1: State.data.fogli[0].id, f2: f2.id,
      posaF2: [f2.origine.x, f2.origine.y]
    };
  }, [DISEGNO('#1d1d1b'), DISEGNO('#c8102e')]);
  ok('un disegno caricato va sul foglio in uso',
     r.quanti === 2 && r.fogli[0] === r.f1 && r.fogli[1] === r.f2 &&
     r.posaF2[0] === 85 && r.posaF2[1] === 10,
     'livelli sui fogli ' + JSON.stringify(r.fogli));

  /* Scegliere un livello riporta sul suo foglio. Senza, si modificherebbe un
     disegno del foglio 2 mentre il riquadro e l'editor lavorano nelle
     coordinate del foglio 1: tutto si muoverebbe del disavanzo fra i due
     angoli e nessuno saprebbe perche'. */
  r = await page.evaluate(() => {
    const l = Artwork.livelli();
    Artwork.seleziona(l[0].id);
    const primo = State.data.foglioAttivo;
    Artwork.seleziona(l[1].id);
    const secondo = State.data.foglioAttivo;
    return { primo, secondo, f1: State.data.fogli[0].id, f2: State.data.fogli[1].id };
  });
  ok('scegliere un livello riporta sul suo foglio',
     r.primo === r.f1 && r.secondo === r.f2,
     r.primo + ' poi ' + r.secondo);

  /* E NEI DUE VERSI. Scegliendo un FOGLIO — dall'elenco nella colonna o
     prendendone uno sul piano — la scelta di prima puo' essere su un altro
     foglio: il riquadro e l'editor lavorerebbero nelle coordinate sbagliate
     e tutto si muoverebbe del disavanzo fra i due angoli. Trovato cercando
     perche' una mutazione non si vedeva. */
  r = await page.evaluate(() => {
    const l = Artwork.livelli();
    Artwork.seleziona(l[1].id);                 // il disegno sul foglio 2
    const prima = Artwork.sceltoId();
    document.querySelector('#fogli-row [data-foglio="' +
      State.data.fogli[0].id + '"]').click();   // si sceglie il foglio 1
    const dopo = Artwork.sceltoId();
    return { prima, dopo, uno: l[0].id, due: l[1].id,
             attivo: State.data.foglioAttivo === State.data.fogli[0].id,
             suoFoglio: dopo ? Artwork.foglioDi(dopo).id : null,
             f1: State.data.fogli[0].id };
  });
  ok('scegliendo un foglio la scelta segue il foglio',
     r.prima === r.due && r.attivo && r.dopo === r.uno &&
     r.suoFoglio === r.f1,
     'era scelto ' + r.prima + ', adesso ' + r.dopo);

  /* ============ D. I DUE DISEGNI NON SI MESCOLANO ============
     E' il controllo che conta: si guarda il G-code, dove la cosa diventa
     vera. Ogni punto deve cadere dentro al PROPRIO foglio. */
  for (const ambito of ['livello', 'tutto']) {
    r = await page.evaluate((ambito) => {
      const p = Profile.stampa();
      Profile.salvaStampa ? null : null;
      p.ottimizza = ambito;
      Artwork.prepare();
      return {
        testo: document.getElementById('gcode-out').value,
        fogli: State.data.fogli.map((f) => ({
          id: f.id,
          x0: f.origine.x, y0: f.origine.y,
          x1: f.origine.x + f.w, y1: f.origine.y + f.h
        })),
        perTratto: State.data.artFoglio
      };
    }, ambito);

    const punti = puntiDelProgramma(r.testo);
    const dentroUno = punti.filter((p) => dentro(p, r.fogli[0])).length;
    const dentroDue = punti.filter((p) => dentro(p, r.fogli[1])).length;
    /* Gli spostamenti a penna alzata passano in mezzo ai due fogli: si
       contano solo i punti che cadono in uno dei due, e si pretende che
       ce ne siano di tutti e due. */
    ok('ottimizzazione «' + ambito + '»: il G-code disegna su tutti e due i fogli',
       punti.length > 8 && dentroUno >= 4 && dentroDue >= 4,
       punti.length + ' punti: ' + dentroUno + ' nel foglio 1, ' + dentroDue +
       ' nel foglio 2');
    ok('«' + ambito + '»: e i gruppi non attraversano i fogli',
       new Set(r.perTratto).size === 2,
       JSON.stringify(r.perTratto));
  }

  /* E lo stesso sul piano: i tratti del secondo livello stanno dentro al
     secondo foglio, non addosso al primo. */
  r = await page.evaluate(() => {
    const f = State.data.fogli;
    const seg = State.data.path.filter((s) => s.draw);
    const cade = (s, i) => s.x1 >= f[i].origine.x && s.x1 <= f[i].origine.x + f[i].w &&
                           s.y1 >= f[i].origine.y && s.y1 <= f[i].origine.y + f[i].h;
    return { tutti: seg.length,
             su1: seg.filter((s) => cade(s, 0)).length,
             su2: seg.filter((s) => cade(s, 1)).length };
  });
  ok('e l\'anteprima sul piano mette ogni disegno sul suo foglio',
     r.tutti > 4 && r.su1 > 0 && r.su2 > 0 && r.su1 + r.su2 === r.tutti,
     r.tutti + ' tratti: ' + r.su1 + ' sul foglio 1, ' + r.su2 + ' sul foglio 2');

  /* ============ E. TOGLIERE UN FOGLIO ============
     I livelli che stanno su un foglio se ne vanno con lui: i loro numeri
     sono millimetri di QUEL foglio e non ci sarebbe dove rimetterli. Ma solo
     i suoi. */
  r = await page.evaluate(() => {
    const prima = Artwork.livelli().length;
    const f2 = State.data.fogli[1].id;
    const via = Artwork.svuotaFoglio(f2);
    Fogli.togli(f2);
    const resta = Artwork.livelli();
    return { prima, via, dopo: resta.length,
             nome: resta.length ? resta[0].nome : null,
             fogli: State.data.fogli.length };
  });
  ok('togliendo un foglio se ne vanno i SUOI livelli, e solo quelli',
     r.prima === 2 && r.via === 1 && r.dopo === 1 && r.nome === 'uno.svg' &&
     r.fogli === 1,
     'da ' + r.prima + ' a ' + r.dopo + ' livelli (' + r.nome + '), ' +
     r.fogli + ' foglio');

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
