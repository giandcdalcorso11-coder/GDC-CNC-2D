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
 *   1-bis. CHE L'ANTEPRIMA DICA LA VERITA'. Il G-code e' l'unico posto dove
 *      la cosa diventa vera, ma il piano e' l'unico posto dove si guarda
 *      PRIMA di stampare: un'anteprima che disegna tutto sul foglio in uso
 *      e' una bugia credibile, e si scopre sulla carta.
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
  let tornaDove = null;

  /* ============ A. IL PIANO LI DISEGNA TUTTI ============ */

  await AZZERA(page);
  r = await page.evaluate(() => {
    /* Il gesto vero: le misure nei due campi in cima alla scheda e il
       «+» accanto a loro. Dal 2026-11-08 il «+» della riga dei fogli non
       c'e' piu' — ne e' rimasto uno solo, che salva il preset se serve e
       aggiunge comunque il foglio. */
    document.getElementById('paper-w').value = 75;
    document.getElementById('paper-h').value = 75;
    document.getElementById('btn-paper-add').click();
    document.getElementById('btn-paper-add').click();
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

  /* ============ D-bis. L'ELENCO DEI LIVELLI E L'EDITOR ============ */

  /* L'elenco dei livelli e' diviso per foglio, e l'intestazione si scrive
     solo quando i fogli sono piu' d'uno. */
  r = await page.evaluate(() => {
    const teste = [...document.querySelectorAll('#livelli [data-testa]')];
    const righe = [...document.querySelectorAll('#livelli [data-liv]')];
    return { teste: teste.length, righe: righe.length,
             fogliDelleRighe: righe.map((x) => x.dataset.fog),
             inUso: document.querySelectorAll('#livelli .liv-foglio.in-uso').length };
  });
  ok('l\'elenco dei livelli e` diviso per foglio',
     r.teste === 2 && r.righe === 2 && r.inUso === 1 &&
     r.fogliDelleRighe[0] !== r.fogliDelleRighe[1],
     r.teste + ' intestazioni, ' + r.righe + ' righe su ' +
     JSON.stringify(r.fogliDelleRighe));

  /* E I LIVELLI DI UNO STESSO FOGLIO STANNO INSIEME anche se sono arrivati
     in tre momenti diversi. Tornando sul foglio 1 e caricandoci un altro
     disegno, l'elenco non deve diventare «foglio 1, foglio 2, foglio 1»:
     l'ordine dell'elenco e' l'ordine di stampa, e una stampa che salta da
     un foglio all'altro e torna indietro attraversa il piano due volte per
     ogni disegno. */
  r = await page.evaluate((svg) => {
    Fogli.scegli(State.data.fogli[0].id);
    Artwork.load(svg, 'tris.svg');
    return { teste: document.querySelectorAll('#livelli [data-testa]').length,
             ordine: Artwork.livelli().map((x) => x.foglio),
             nomi: Artwork.livelli().map((x) => x.nome) };
  }, DISEGNO('#1f4fa8'));
  ok('i livelli di uno stesso foglio stanno insieme anche se arrivano dopo',
     r.teste === 2 && r.ordine[0] === r.ordine[1] && r.ordine[1] !== r.ordine[2],
     r.teste + ' intestazioni, ordine ' + JSON.stringify(r.nomi));

  /* Rimesso com'era per i controlli dopo. */
  await page.evaluate(() => {
    const l = Artwork.livelli();
    Artwork.rimuovi(l.filter((x) => x.nome === 'tris.svg')[0].id);
  });

  /* LO SFONDO DELL'EDITOR NON ATTRAVERSA I FOGLI. `daFoglio` porta i tratti
     nelle coordinate del livello che si modifica: un disegno di un ALTRO
     foglio, portato li', finirebbe disegnato sopra a questo alla distanza
     sbagliata, come se fosse sulla stessa carta. Uno sfondo che dice una
     cosa falsa proprio mentre lo si usa per mirare. */
  r = await page.evaluate(() => {
    const l = Artwork.livelli();
    return { sfondo1: Artwork.sfondoPer(l[0].id).length,
             sfondo2: Artwork.sfondoPer(l[1].id).length,
             tratti: l.map((x) => x.tratti) };
  });
  ok('lo sfondo dell\'editor non mostra i disegni degli altri fogli',
     r.sfondo1 === 0 && r.sfondo2 === 0 && r.tratti[0] > 0 && r.tratti[1] > 0,
     'sfondi ' + r.sfondo1 + ' e ' + r.sfondo2 + ', con ' +
     JSON.stringify(r.tratti) + ' tratti da mostrare');

  /* L'ELENCO DELL'EDITOR LI MOSTRA TUTTI, dal 2026-11-08, divisi per foglio
     come quello della tab Disegno. Prima mostrava solo il foglio in uso, e
     detto dall'operatore: «nella tab edit non vedo la lista dei fogli... ci
     sono sempre tutti i fogli e tutti i livelli». Lo sfondo invece resta al
     suo foglio — vedi il controllo qui sopra: sono due cose diverse,
     l'elenco dice che cosa c'e', lo sfondo dove mirare. */
  r = await page.evaluate(() => {
    const l = Artwork.livelli();
    Artwork.seleziona(l[1].id);
    document.querySelector('[data-tab="editor"]').click();
    Editor.apri();
    const teste = [...document.querySelectorAll('#ed-livelli [data-ed-testa]')];
    return { righe: document.querySelectorAll('#ed-livelli [data-ed-liv]').length,
             teste: teste.map((t) => t.textContent.trim()),
             accesa: (teste.filter((t) => t.classList.contains('in-uso'))[0] || {}).textContent,
             prese: document.querySelectorAll('#ed-livelli [data-presa]').length,
             tutti: Artwork.livelli().length };
  });
  ok('l\'editor mostra tutti i livelli, divisi per foglio',
     r.righe === r.tutti && r.teste.length === 2 &&
     /foglio 1/.test(r.teste[0]) && /foglio 2/.test(r.teste[1]),
     r.righe + ' righe su ' + r.tutti + ' livelli, intestazioni ' +
     JSON.stringify(r.teste));
  ok('e accende quella del foglio in uso, non le altre',
     /foglio 2/.test(String(r.accesa)), String(r.accesa).trim());
  ok('e ogni riga ha la sua presa, per trascinarla da qui',
     r.prese === r.tutti, r.prese + ' prese su ' + r.tutti + ' righe');

  /* Cliccando un livello di un ALTRO foglio, il foglio in uso lo segue:
     l'editor lavora nelle coordinate di UN foglio, e il riquadro, il
     ritaglio e la tela devono essere quelle dello stesso. */
  r = await page.evaluate(() => {
    /* Le righe si ripescano DOPO ogni clic: il clic ridisegna l'elenco, e
       il nodo di prima e` gia` staccato dal documento — premerlo non fa
       niente. E` lo stesso inciampo del doppio clic della rinomina. */
    const riga = (i) =>
      [...document.querySelectorAll('#ed-livelli [data-ed-liv]')][i];
    riga(0).click();
    const primo = Fogli.indice(State.data.foglioAttivo);
    riga(1).click();
    return { primo: primo, poi: Fogli.indice(State.data.foglioAttivo),
             modifica: (Artwork.livelli().find((l) => l.principale) || {}).nome };
  });
  ok('e il foglio in uso segue il livello che si modifica',
     r.primo === 0 && r.poi === 1, 'foglio ' + (r.primo + 1) + ' poi ' +
     (r.poi + 1) + ', si modifica ' + r.modifica);

  /* TRASCINARE DA QUI, che e' la cosa chiesta: «anche qui spostabili di
     ordine e tra fogli». Si prende la presa del secondo livello e la si
     porta sull'intestazione del primo foglio. */
  {
    await page.locator('#ed-livelli [data-presa]').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const g = await page.evaluate(() => {
      const l = Artwork.livelli();
      const p = document.querySelector('#ed-livelli [data-presa="' + l[1].id + '"]');
      const b = p.getBoundingClientRect();
      const t = document.querySelector('#ed-livelli [data-ed-testa="' +
                 State.data.fogli[0].id + '"]').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2,
               tx: t.x + t.width / 2, ty: t.y + 2, id: l[1].id };
    });
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.tx, g.ty, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    /* DUE INTESTAZIONI E NON UNA, dal 2026-11-08: il foglio rimasto senza
       niente sopra resta nell'elenco, vuoto. Fino a quel giorno spariva, e
       questo controllo si aspettava `teste === 1` — cioe' descriveva come
       giusto quello che l'operatore ha chiesto di cambiare: «quando un
       foglio non ha nessun disegno sopra non c'e' nella lista... vorrei che
       ci fosse ma vuoto». Il foglio vuoto e' proprio quello su cui si vuole
       poter trascinare qualcosa. */
    r = await page.evaluate((id) => ({
      suo: Artwork.foglioDi(id).id,
      f1: State.data.fogli[0].id,
      teste: document.querySelectorAll('#ed-livelli [data-ed-testa]').length,
      vuote: document.querySelectorAll('#ed-livelli .ed-foglio.vuoto').length,
      inDisegno: document.querySelectorAll('#livelli [data-testa]').length,
      vuoteDisegno: document.querySelectorAll('#livelli .liv-foglio.vuoto').length
    }), g.id);
    ok('trascinando dall\'elenco dell\'editor, il livello cambia foglio',
       r.suo === r.f1 && r.teste === 2 && r.vuote === 1,
       'finito sul foglio ' + r.suo + ', ' + r.teste + ' intestazioni, ' +
       r.vuote + ' vuota');
    /* E l'elenco dell'altra tab lo sa: sono lo stesso elenco visto da due
       posti, e ridisegnarne uno solo lascerebbe l'altro a raccontare
       l'ordine di prima. */
    ok('e anche l\'elenco della tab Disegno se n\'e` accorto',
       r.inDisegno === 2 && r.vuoteDisegno === 1,
       r.inDisegno + ' intestazioni nella tab Disegno, ' + r.vuoteDisegno +
       ' vuota');
    await page.evaluate((id) => {
      Artwork.spostaAFoglio(id, State.data.fogli[1].id);
    }, g.id);
    await page.evaluate(() => document.querySelector('[data-tab="disegno"]').click());
    await page.waitForTimeout(120);
  }

  /* TRASCINANDO UN LIVELLO SOTTO L'INTESTAZIONE DI UN ALTRO FOGLIO, cambia
     foglio: e' la strada per rimediare a «l'ho caricato sul foglio
     sbagliato» senza ricaricare niente. */
  await page.evaluate(() => { document.querySelector('[data-tab="disegno"]').click(); });
  await page.waitForTimeout(120);
  {
    /* La colonna scorre: la maniglia puo' stare sotto il bordo della
       finestra, e un puntatore mandato li' non preme su niente. */
    const quale = await page.evaluate(() => Artwork.livelli()[1].id);
    await page.locator('#livelli [data-presa="' + quale + '"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const presa = await page.evaluate(() => {
      const l = Artwork.livelli();
      const p = document.querySelector('#livelli [data-presa="' + l[1].id + '"]');
      const b = p.getBoundingClientRect();
      const t = document.querySelector('#livelli [data-testa="' +
                 State.data.fogli[0].id + '"]').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2,
               tx: t.x + t.width / 2, ty: t.y + 2, id: l[1].id };
    });
    await page.mouse.move(presa.x, presa.y);
    await page.mouse.down();
    await page.mouse.move(presa.tx, presa.ty, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    r = await page.evaluate((id) => ({
      suo: Artwork.foglioDi(id).id,
      f1: State.data.fogli[0].id,
      teste: document.querySelectorAll('#livelli [data-testa]').length,
      ordine: Artwork.livelli().map((x) => x.foglio)
    }), presa.id);
    tornaDove = presa.id;
    ok('trascinando un livello su un altro foglio, ci va',
       r.suo === r.f1 && r.teste === 2 && r.ordine[0] === r.f1 &&
       r.ordine[1] === r.f1,
       'finito sul foglio ' + r.suo + ', ' + r.teste + ' intestazioni, ordine ' +
       JSON.stringify(r.ordine));
  }

  /* E si rimette dov'era PER ID, non per posizione: dopo il trascinamento
     l'ordine e' cambiato, e rimettere «il secondo» rimetterebbe un altro. */
  await page.evaluate((id) => {
    Artwork.spostaAFoglio(id, State.data.fogli[1].id);
  }, tornaDove);

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

  /* ====== IL DISEGNO RESTA SUL SUO FOGLIO ANCHE SUL PIANO (2026-11-08) ======
   *
   * IL DIFETTO, visto dall'operatore: «quando aggiungo un nuovo foglio e ci
   * clicco sopra, tutto il disegno che ho sul primo foglio si sposta sul
   * foglio che clicco». Era vero, ed era solo dell'anteprima: nel modello il
   * livello non si muoveva di un millimetro, e il G-code era giusto.
   *
   * LA CAUSA: `rebuildPath()` in paper.js somma a ogni tratto l'angolo del
   * SUO foglio, e lo legge da `State.data.artFoglio`. Quell'elenco lo
   * riempiva solo `prepare()` -- il pulsante «Prepara» -- quindi durante il
   * lavoro normale era vuoto e ogni tratto ripiegava sull'angolo del foglio
   * ATTIVO. Cambiare foglio spostava tutto.
   *
   * SI MISURA DOVE CADONO LE RIGHE DISEGNATE, non dove dice il modello: il
   * modello era gia' giusto mentre il difetto c'era, quindi un controllo sul
   * modello non l'avrebbe mai visto. */
  const INCHIOSTRO = () => page.evaluate(() => {
    const l = [...document.querySelectorAll('line.trace-draw')];
    if (!l.length) return null;
    const xs = [], ys = [];
    l.forEach((e) => {
      xs.push(+e.getAttribute('x1'), +e.getAttribute('x2'));
      ys.push(+e.getAttribute('y1'), +e.getAttribute('y2'));
    });
    return [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)),
            Math.round(Math.max(...xs)), Math.round(Math.max(...ys))];
  });

  /* IL DISEGNO SI METTE SUL SECONDO FOGLIO, e non sul primo, di proposito.
     Col disegno sul primo il controllo passava anche col codice rotto: a
     elenco vuoto `rebuildPath` ripiega sull'angolo del foglio ATTIVO, e un
     avanzo di `artFoglio` lasciato da una sezione precedente puntava proprio
     al primo foglio — cioe' dava per caso la risposta giusta. Sul secondo
     non c'e' caso che tenga: o l'elenco dice il foglio vero, o
     l'inchiostro casca settantacinque millimetri piu' in la'. */
  await page.evaluate(([D]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Paper.setSheetOrigin(10, 10);
    var due = Fogli.aggiungi(75, 75, 'secondo');
    Fogli.scegli(due.id);
    Artwork.load(D, 'sul secondo.svg');
  }, [DISEGNO('#c8102e')]);
  await page.waitForTimeout(200);
  const suDue = await INCHIOSTRO();
  ok('il disegno del secondo foglio casca sul secondo foglio',
     suDue && suDue[0] === 88, JSON.stringify(suDue));

  await page.evaluate(() => Fogli.scegli(State.data.fogli[0].id));
  await page.waitForTimeout(200);
  r = await INCHIOSTRO();
  ok('cambiare foglio non sposta il disegno che sta su un altro',
     JSON.stringify(r) === JSON.stringify(suDue),
     'prima ' + JSON.stringify(suDue) + ', dopo ' + JSON.stringify(r));

  /* E un disegno messo sul PRIMO foglio deve cadere settantacinque
     millimetri piu' a sinistra: se cadessero nello stesso posto, il
     controllo di sopra passerebbe anche disegnando tutto nell'angolo. */
  await page.evaluate(([D]) => Artwork.load(D, 'sul primo.svg'), [DISEGNO('#1f4fa8')]);
  await page.waitForTimeout(200);
  r = await page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('line.trace-draw')].forEach((e) => {
      const c = e.style.stroke || '';
      const x = Math.min(+e.getAttribute('x1'), +e.getAttribute('x2'));
      if (!(c in out) || x < out[c]) out[c] = x;
    });
    return out;
  });
  const tinte = Object.keys(r);
  ok('e i due disegni cadono su due fogli diversi, a 75 mm l\'uno dall\'altro',
     tinte.length === 2 &&
     Math.round(Math.abs(r[tinte[0]] - r[tinte[1]])) === 75,
     JSON.stringify(r));

  /* ====== LE SPUNTE NON SI ACCUMULANO CLICCANDO NELL'EDITOR ======
   *
   * Prima il clic sul nome, nella colonna dell'editor, AGGIUNGEVA alla
   * selezione della tab Disegno: passando da un livello all'altro per
   * modificarli se ne costruiva una multipla senza chiederla, e le spunte
   * di la' dicevano una cosa che nessuno aveva scelto. Detto
   * dall'operatore: le spunte servono al riquadro di selezione.
   *
   * SERVONO DUE LIVELLI DELLO STESSO FOGLIO, ed e' il punto del controllo:
   * su due fogli diversi la selezione si sostituisce comunque — non
   * esiste un riquadro che circondi due fogli — quindi li' anche il codice
   * rotto darebbe la risposta giusta. */
  r = await page.evaluate(([D]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Artwork.load(D, 'primo.svg');
    Artwork.load(D, 'secondo.svg');
    document.querySelector('[data-tab="editor"]').click();
    Editor.apri();
    const riga = (i) =>
      [...document.querySelectorAll('#ed-livelli [data-ed-liv]')][i];
    riga(0).click();
    const uno = Artwork.livelli().filter((l) => l.scelto).map((l) => l.nome);
    riga(1).click();
    const due = Artwork.livelli().filter((l) => l.scelto).map((l) => l.nome);
    document.querySelector('[data-tab="disegno"]').click();
    return { uno: uno, due: due,
             modifica: (Artwork.livelli().find((l) => l.principale) || {}).nome };
  }, [DISEGNO('#1d1d1b')]);
  ok('cliccando due livelli dello STESSO foglio la selezione resta UNA',
     r.uno.length === 1 && r.due.length === 1 && r.due[0] === r.modifica,
     'prima ' + JSON.stringify(r.uno) + ', poi ' + JSON.stringify(r.due) +
     ', si modifica ' + r.modifica);

  /* ============ F. LA SCHEDA DEI FOGLI ============
   *
   * Chiesto dall'operatore il 2026-11-08: «al posto di fogli scrivi "preset
   * fogli" e quando ne clicco uno vorrei che ne venga creato uno nuovo e non
   * modificato quello in cui sono... sposta i due box per scrivere le
   * dimensioni di un foglio sopra nella sezione preset fogli e il pulsantino
   * + mettilo di fianco a questi box... sotto ai preset inserisci la parola
   * "fogli"... rendile modificabili con la stessa modalita' dei fogli del
   * preset, quindi con la matitina... e il cestino».
   *
   * E' una scheda, quindi meta' di questi controlli guardano del testo e
   * delle posizioni nel documento. Non e' pignoleria: la differenza fra
   * «preset» e «fogli» e' la ragione per cui premere un preset adesso
   * aggiunge invece di cambiare, e una scheda che le chiama con lo stesso
   * nome rende quel gesto incomprensibile.
   */

  await AZZERA(page);
  r = await page.evaluate(() => {
    const card = document.getElementById('preset-row').closest('.card');
    const dopo = (a, b) => !!(a.compareDocumentPosition(b) &
                              Node.DOCUMENT_POSITION_FOLLOWING);
    const w = document.getElementById('paper-w');
    return {
      titolo: card.querySelector('h2').textContent.trim(),
      sotto: [...card.querySelectorAll('h3')].map((h) => h.textContent.trim()),
      /* I due campi stanno DOPO i preset e PRIMA dei fogli del piano, e il
         «+» sta nella loro stessa riga: e' quello che li lega. */
      dopoIPreset: dopo(document.getElementById('preset-row'), w),
      primaDeiFogli: dopo(w, document.getElementById('fogli-row')),
      colPiu: document.getElementById('btn-paper-add').parentNode ===
              w.closest('.field-row'),
      /* E nella riga dei fogli non c'e' piu' un secondo «+». */
      piuNellaRiga: document.querySelectorAll('#fogli-row .preset-add').length
    };
  });
  ok('la scheda si chiama «Preset fogli», e i fogli del piano hanno il loro titolo',
     r.titolo === 'Preset fogli' && r.sotto.indexOf('Fogli') >= 0,
     '«' + r.titolo + '», sottotitoli ' + JSON.stringify(r.sotto));
  ok('le misure stanno fra i preset e i fogli, col «+» nella loro riga',
     r.dopoIPreset && r.primaDeiFogli && r.colPiu && r.piuNellaRiga === 0,
     'dopo i preset ' + r.dopoIPreset + ', prima dei fogli ' + r.primaDeiFogli +
     ', «+» accanto ' + r.colPiu + ', «+» nella riga dei fogli ' + r.piuNellaRiga);
  /* UN PRESET AGGIUNGE, e non cambia quello in uso. Il controllo guarda
     tutt'e due le cose, perche' sono due difetti diversi: aggiungerne uno e
     cambiare anche il vecchio sarebbe peggio di non aggiungerlo. */
  r = await page.evaluate(() => {
    const prima = State.data.fogli.map((f) => f.w + 'x' + f.h);
    document.querySelector('.preset[data-w="105"]').click();
    const acceso = document.querySelector('.preset.is-active');
    return { prima: prima,
             dopo: State.data.fogli.map((f) => f.w + 'x' + f.h),
             attivo: Fogli.indice(State.data.foglioAttivo),
             acceso: acceso ? acceso.textContent.trim() : null };
  });
  ok('un preset AGGIUNGE un foglio e non tocca quello in uso',
     r.prima.join(' ') === '75x75' && r.dopo.join(' ') === '75x75 105x148' &&
     r.attivo === 1,
     JSON.stringify(r.prima) + ' → ' + JSON.stringify(r.dopo) +
     ', in uso il ' + (r.attivo + 1));
  /* E il formato acceso segue il foglio in uso: dice di che formato e'
     quello su cui si sta lavorando, e dopo un foglio nuovo quello e' un
     altro. Restava acceso il precedente. */
  ok('e il formato acceso e` quello del foglio appena aggiunto',
     r.acceso === 'A6', 'acceso «' + r.acceso + '»');

  /* SCRIVERE LE MISURE NON RIDIMENSIONA NIENTE. Fino al 2026-11-08 ogni
     cifra battuta cambiava il foglio in uso, col disegno sopra. */
  r = await page.evaluate(() => {
    const w = document.getElementById('paper-w'), h = document.getElementById('paper-h');
    w.value = 60; w.dispatchEvent(new Event('input', { bubbles: true }));
    h.value = 90; h.dispatchEvent(new Event('input', { bubbles: true }));
    return { fogli: State.data.fogli.map((f) => f.w + 'x' + f.h),
             titoloPiu: document.getElementById('btn-paper-add').title };
  });
  ok('scrivere le misure non cambia il foglio in uso',
     r.fogli.join(' ') === '75x75 105x148',
     JSON.stringify(r.fogli));

  /* IL «+»: il preset se quelle misure non ce l'hanno gia', e comunque il
     foglio. Due volte di fila, perche' la seconda non deve fare il
     doppione del preset ma deve fare lo stesso il foglio. */
  r = await page.evaluate(() => {
    const quanti = () => Profile.formati().length;
    const p0 = quanti(), f0 = State.data.fogli.length;
    document.getElementById('btn-paper-add').click();
    const p1 = quanti(), f1 = State.data.fogli.length;
    document.getElementById('btn-paper-add').click();
    return { p0: p0, p1: p1, p2: quanti(), f0: f0, f1: f1,
             f2: State.data.fogli.length,
             nomi: Profile.formati().map((f) => f.nome),
             ultimo: State.data.fogli[State.data.fogli.length - 1].name,
             attivo: Fogli.indice(State.data.foglioAttivo) };
  });
  ok('il «+» salva il preset nuovo e aggiunge il foglio',
     r.p1 === r.p0 + 1 && r.f1 === r.f0 + 1 && r.nomi.indexOf('60 × 90') >= 0,
     r.p0 + '→' + r.p1 + ' preset, ' + r.f0 + '→' + r.f1 + ' fogli, ' +
     JSON.stringify(r.nomi));
  ok('e la seconda volta aggiunge il foglio senza rifare il preset',
     r.p2 === r.p1 && r.f2 === r.f1 + 1 && r.ultimo === '60 × 90' &&
     r.attivo === r.f2 - 1,
     r.p2 + ' preset, ' + r.f2 + ' fogli, l\'ultimo «' + r.ultimo + '» e in uso');

  /* LA MATITA E IL CESTINO SULLA PASTIGLIA: ci sono, si vedono passandoci
     sopra, e non sono gli stessi dei preset (quelli stanno nell'altra
     riga). */
  r = await page.evaluate(() => ({
    /* Il `|| document.body` tiene in piedi il controllo quando la matita
       non c'e' per niente: senza, `getComputedStyle(null)` lo fa MORIRE
       invece di farlo fallire, e una matita sparita e' proprio quello che
       deve trovare. Il corpo della pagina non e' mai «none». */
    nascosti: getComputedStyle(
      document.querySelector('#fogli-row [data-fog-ed]') || document.body).display,
    quante: document.querySelectorAll('#fogli-row [data-fog-ed]').length,
    cestini: document.querySelectorAll('#fogli-row [data-foglio-via]').length,
    /* LA CROCETTA SI CONTA QUI e non prima, con quattro fogli sul piano:
       con un foglio solo non c'e' comunque — il cestino sull'ultimo non si
       disegna — e un controllo che guarda dove il difetto non puo'
       manifestarsi passa per caso. */
    crocette: document.querySelectorAll('#fogli-row .foglio-via').length,
    fogli: State.data.fogli.length
  }));
  await page.hover('#fogli-row .foglio-wrap');
  await page.waitForTimeout(120);
  const vista = await page.evaluate(() => getComputedStyle(
    document.querySelector('#fogli-row [data-fog-ed]') || document.body).display);
  ok('ogni pastiglia ha la sua matita e il suo cestino, che si vedono passandoci sopra',
     r.quante === r.fogli && r.cestini === r.fogli && r.crocette === 0 &&
     r.nascosti === 'none' && vista === 'flex',
     r.quante + ' matite, ' + r.cestini + ' cestini e ' + r.crocette +
     ' crocette su ' + r.fogli + ' fogli; fermi «' + r.nascosti +
     '», sopra «' + vista + '»');

  /* LA MATITA: nome, misure e carta di QUEL foglio. Il nome parte vuoto con
     la scritta-fantasma — vuoto vuol dire «quello del formato» — e i preset
     non c'entrano niente: cambiare un foglio non ne crea uno. */
  r = await page.evaluate(() => {
    const presetPrima = Profile.formati().length;
    document.querySelector('#fogli-row [data-fog-ed]').click();
    const aperta = {
      titolo: document.getElementById('fog-titolo').textContent,
      nome: document.getElementById('fog-nome').value,
      fantasma: document.getElementById('fog-nome').placeholder,
      w: document.getElementById('fog-w').value,
      h: document.getElementById('fog-h').value
    };
    document.getElementById('fog-nome').value = 'Gioco';
    document.getElementById('fog-w').value = 80;
    document.getElementById('fog-h').value = 70;
    document.querySelector('[data-carta="#c49a6c"]').click();
    document.getElementById('fog-ok').click();
    const f = State.data.fogli[0];
    return { aperta: aperta, nome: f.name, mio: !!f.nomeMio,
             w: f.w, h: f.h, carta: Profile.coloreFoglio(80, 70),
             preset: Profile.formati().length - presetPrima,
             chiusa: document.getElementById('fog-modal').hidden };
  });
  ok('la matita del foglio apre col nome vuoto e la sua misura',
     r.aperta.titolo === 'Foglio 1' && r.aperta.nome === '' &&
     r.aperta.fantasma === '75 × 75' && r.aperta.w === '75' && r.aperta.h === '75',
     JSON.stringify(r.aperta));
  ok('e cambia nome, misure e carta di quel foglio senza creare preset',
     r.nome === 'Gioco' && r.mio === true && r.w === 80 && r.h === 70 &&
     r.carta === '#c49a6c' && r.preset === 0 && r.chiusa,
     '«' + r.nome + '» ' + r.w + '×' + r.h + ', carta ' + r.carta +
     ', ' + r.preset + ' preset in piu\'');

  /* E il nome vuoto rimette quello del formato: e' il modo di tornare
     indietro senza doversi ricordare come si chiamava. */
  r = await page.evaluate(() => {
    document.querySelector('#fogli-row [data-fog-ed]').click();
    document.getElementById('fog-nome').value = '   ';
    document.getElementById('fog-ok').click();
    const f = State.data.fogli[0];
    return { nome: f.name, mio: !!f.nomeMio,
             scritto: document.querySelector('#fogli-row .foglio').textContent };
  });
  ok('il nome vuoto rimette quello del formato',
     r.nome === 'Personalizzato' && r.mio === false && /80 × 70/.test(r.scritto),
     '«' + r.nome + '», sulla pastiglia «' + r.scritto.trim() + '»');

  /* IL CESTINO toglie il foglio. Sull'ultimo non c'e': un pulsante che non
     si puo' premere sembra rotto. */
  r = await page.evaluate(() => {
    const prima = State.data.fogli.length;
    document.querySelectorAll('#fogli-row [data-foglio-via]')[1].click();
    const dopo = State.data.fogli.length;
    while (State.data.fogli.length > 1) {
      document.querySelector('#fogli-row [data-foglio-via]').click();
    }
    return { prima: prima, dopo: dopo, resta: State.data.fogli.length,
             cestini: document.querySelectorAll('#fogli-row [data-foglio-via]').length,
             matite: document.querySelectorAll('#fogli-row [data-fog-ed]').length };
  });
  ok('il cestino toglie il foglio, e sull\'ultimo non c\'e\'',
     r.dopo === r.prima - 1 && r.resta === 1 && r.cestini === 0 && r.matite === 1,
     r.prima + '→' + r.dopo + ' fogli, resta ' + r.resta + ' con ' +
     r.cestini + ' cestini e ' + r.matite + ' matita');

  /* ============ G. UN FOGLIO VUOTO STA NELL'ELENCO ============
   *
   * Chiesto dall'operatore lo stesso giorno: «quando un foglio non ha
   * nessun disegno sopra non c'e' nella lista di fogli e livelli, vorrei
   * che ci fosse ma vuoto, in modo che se voglio spostare un livello di
   * un'altro foglio in un foglio vuoto ho la possibilita' di farlo».
   *
   * Qui il foglio vuoto non ha MAI avuto niente sopra — e' il caso che
   * prima non si vedeva per niente, mentre quello svuotato trascinando si
   * vede nella sezione D. */
  await AZZERA(page);
  /* Il foglio nuovo si aggiunge e BASTA: niente clic, niente scelta. Cosi'
     l'unico segnale che l'elenco riceve e' `fogli`, e il controllo guarda
     anche che l'elenco si rifaccia su quello — un foglio aggiunto che
     compare solo al gesto successivo e' un foglio che non c'e'. */
  await page.evaluate(([D]) => {
    Artwork.load(D, 'solo uno.svg');
    Fogli.aggiungi(105, 148, 'vuoto');
  }, [DISEGNO('#1f4fa8')]);
  await page.waitForTimeout(250);
  r = await page.evaluate(() => {
    document.querySelector('[data-tab="editor"]').click();
    Editor.apri();
    const conta = (sel) => document.querySelectorAll(sel).length;
    return {
      teste: conta('#livelli [data-testa]'), vuote: conta('#livelli .liv-foglio.vuoto'),
      edTeste: conta('#ed-livelli [data-ed-testa]'),
      edVuote: conta('#ed-livelli .ed-foglio.vuoto'),
      /* Senza il `|| {}` il controllo MORIREBBE invece di fallire quando
         l'intestazione vuota non c'e' — ed e' proprio il caso che deve
         trovare. Un banco che si interrompe dice molto meno di un banco
         che dice che cosa non va. */
      posVuota: (document.querySelector('#livelli .liv-foglio.vuoto') ||
                 { dataset: {} }).dataset.pos,
      livelli: Artwork.livelli().length
    };
  });
  ok('un foglio senza niente sopra sta nell\'elenco lo stesso, in tutt\'e due le tab',
     r.teste === 2 && r.vuote === 1 && r.edTeste === 2 && r.edVuote === 1 &&
     +r.posVuota === r.livelli && r.posVuota !== undefined,
     r.teste + '/' + r.edTeste + ' intestazioni, ' + r.vuote + '/' + r.edVuote +
     ' vuote, la vuota a pos ' + r.posVuota + ' con ' + r.livelli + ' livelli');

  /* E ci si trascina sopra: e' tutta la ragione per cui deve esserci. */
  {
    const g = await page.evaluate(() => {
      const p = document.querySelector('#ed-livelli [data-presa]').getBoundingClientRect();
      const t = document.querySelector('#ed-livelli .ed-foglio.vuoto').getBoundingClientRect();
      return { x: p.x + p.width / 2, y: p.y + p.height / 2,
               tx: t.x + t.width / 2, ty: t.y + t.height - 2 };
    });
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.tx, g.ty, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    r = await page.evaluate(() => ({
      dove: Fogli.indice(Artwork.livelli()[0].foglio),
      vuote: document.querySelectorAll('#ed-livelli .ed-foglio.vuoto').length,
      quale: [...document.querySelectorAll('#ed-livelli .ed-foglio')]
               .map((d) => d.classList.contains('vuoto') ? 'vuoto' : 'pieno')
    }));
    await page.evaluate(() => document.querySelector('[data-tab="disegno"]').click());
    ok('e ci si puo\' trascinare un livello, che e\' la ragione per cui c\'e\'',
       r.dove === 1 && r.vuote === 1 && r.quale.join(' ') === 'vuoto pieno',
       'finito sul foglio ' + (r.dove + 1) + ', intestazioni ' +
       JSON.stringify(r.quale));
  }

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
