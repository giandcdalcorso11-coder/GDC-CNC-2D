/* Il collaudo del MODELLO a piu' fogli (Step 11, fase 1).
 *
 * Questa fase non si vede: nell'interfaccia non c'e' ancora niente per
 * aggiungere un foglio. Quello che cambia e' sotto -- `State.data.paper` e
 * `sheetOrigin` non sono piu' campi ma VISTE sul foglio attivo -- ed e'
 * esattamente il genere di cambiamento che o e' invisibile o e' un disastro.
 * Quindi qui si guardano due famiglie di cose:
 *
 *   A. CHE CON UN FOGLIO SOLO SIA TUTTO COME PRIMA. Il criterio vero di
 *      questa fase non sta in questo file: sta nel fatto che gli altri otto
 *      banchi passano ancora senza che nessuno li abbia toccati.
 *
 *   B. CHE LE MISURE NON TRABOCCHINO DA UN FOGLIO ALL'ALTRO. E' la ragione
 *      per cui il modello cambia: un angolo misurato sul foglio 1 NON dice
 *      niente del foglio 2, e il giorno in cui lo dicesse la penna
 *      disegnerebbe accanto al foglio con la pagina convinta di avere
 *      ragione. E' il difetto peggiore che questa fase possa avere, perche'
 *      non si vede sullo schermo: si vede sulla carta.
 *
 * Piu' l'accostamento, che e' la parte con della geometria dentro: due fogli
 * spinti uno contro l'altro sono UNA misura, non due, e il programma lo deve
 * capire da come sono messi invece che farselo dichiarare.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO.
 * Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-fogli.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Si riparte sempre da un foglio solo: un banco costruito sopra la scena
   precedente misura la somma delle due. */
const AZZERA = (page) => page.evaluate(() => {
  document.getElementById('btn-clear-file').click();
  const l = State.data.fogli;
  while (l.length > 1) Fogli.togli(l[l.length - 1].id);
  Fogli.scegli(l[0].id);
  l[0].misurato = false;
  l[0].origine = { x: 20, y: 20 };
  Paper.setSize(148, 210);
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

  /* ============ A. CON UN FOGLIO SOLO E' TUTTO COME PRIMA ============ */

  r = await page.evaluate(() => ({
    quanti: State.data.fogli.length,
    w: State.data.paper.w, h: State.data.paper.h,
    nome: State.data.paper.name,
    org: [State.data.sheetOrigin.x, State.data.sheetOrigin.y],
    misurato: State.data.foglioMisurato,
    attivo: State.data.foglioAttivo === State.data.fogli[0].id
  }));
  ok('si parte da un foglio solo, quello del profilo di stampa',
     r.quanti === 1 && r.w === 148 && r.h === 210 && r.nome === 'A5' &&
     r.org[0] === 20 && r.org[1] === 20 && r.misurato === false && r.attivo,
     JSON.stringify(r));

  /* `paper` NON e' una copia: e' il foglio. Una copia andrebbe tenuta
     d'accordo con l'originale, e due copie da tenere d'accordo divergono. */
  r = await page.evaluate(() => {
    Paper.setSize(100, 120);
    const f = State.data.fogli[0];
    const dallaPagina = [f.w, f.h];
    f.w = 90;                               // e nell'altro verso
    const dalFoglio = [State.data.paper.w, State.data.paper.h];
    Paper.setSize(148, 210);
    return { dallaPagina, dalFoglio, stessoOggetto: State.data.paper === f };
  });
  ok('`paper` e` il foglio attivo, non una sua copia',
     r.dallaPagina[0] === 100 && r.dallaPagina[1] === 120 &&
     r.dalFoglio[0] === 90 && r.stessoOggetto,
     'dalla pagina ' + r.dallaPagina + ', dal foglio ' + r.dalFoglio);

  /* L'unico punto in tutto il programma che riscrive `sheetOrigin` intero
     invece di toccarne i campi: se la vista non avesse un «set», quella riga
     sostituirebbe la vista con un oggetto qualunque e il foglio resterebbe
     dov'era, in silenzio. */
  r = await page.evaluate(() => {
    /* SI SCRIVE LA VISTA, non si passa da Paper. Il controllo diceva
       «scrivere sheetOrigin intero scrive sul foglio» e invece chiamava
       `Paper.setSheetOrigin`, che dal 2026-11-07 scrive sul foglio per conto
       suo: la vista non la toccava nessuno, e togliere il suo «set» non
       faceva piu' fallire niente. Lo ha trovato il banco delle mutazioni. */
    State.data.sheetOrigin = { x: 31, y: 42 };
    return { f: [State.data.fogli[0].origine.x, State.data.fogli[0].origine.y],
             v: [State.data.sheetOrigin.x, State.data.sheetOrigin.y] };
  });
  ok('scrivere `sheetOrigin` intero scrive sul foglio',
     r.f[0] === 31 && r.f[1] === 42 && r.v[0] === 31 && r.v[1] === 42,
     'foglio ' + r.f + ', vista ' + r.v);

  /* ============ B. LE MISURE NON TRABOCCANO ============ */

  await AZZERA(page);
  r = await page.evaluate(() => {
    /* Il foglio 1 e' stato misurato sulla macchina. */
    Paper.setSheetOrigin(12.5, 7.25);
    Paper.fissa(true);
    const a = State.data.fogli[0].id;

    /* Ne arriva un secondo, lontano, e si passa a lui. */
    const b = Fogli.aggiungi(75, 75, 'magnete').id;
    Fogli.muovi(b, 160, 150);
    Fogli.scegli(b);
    const suB = { org: [State.data.sheetOrigin.x, State.data.sheetOrigin.y],
                  misurato: State.data.foglioMisurato,
                  w: State.data.paper.w };

    Fogli.scegli(a);
    const suA = { org: [State.data.sheetOrigin.x, State.data.sheetOrigin.y],
                  misurato: State.data.foglioMisurato,
                  w: State.data.paper.w };
    return { suA, suB };
  });
  ok('l\'angolo misurato su un foglio NON vale per quello accanto',
     r.suB.misurato === false && r.suB.org[0] === 160 && r.suB.org[1] === 150 &&
     r.suB.w === 75,
     'sul foglio nuovo: ' + JSON.stringify(r.suB));
  ok('e tornando sul primo la sua misura e` ancora li`',
     r.suA.misurato === true && r.suA.org[0] === 12.5 && r.suA.org[1] === 7.25 &&
     r.suA.w === 148,
     'sul primo: ' + JSON.stringify(r.suA));

  /* Cambiare foglio non e' cambiare la misura del foglio. L'ascoltatore che
     ricentra i disegni quando il foglio cresce o si stringe non deve
     scattare qui: i due fogli non c'entrano niente l'uno con l'altro, e
     spostare tutto di meta' della differenza fra le loro misure muoverebbe i
     disegni senza che nessuno l'abbia chiesto. */
  await AZZERA(page);
  r = await page.evaluate(() => {
    document.getElementById('btn-sample').click();
    const prima = Artwork.progetto().livelli.map((l) => l.box && [+l.box.x.toFixed(3), +l.box.y.toFixed(3)]);
    const b = Fogli.aggiungi(75, 75, 'magnete').id;
    Fogli.muovi(b, 160, 150);
    Fogli.scegli(b);
    const dopo = Artwork.progetto().livelli.map((l) => l.box && [+l.box.x.toFixed(3), +l.box.y.toFixed(3)]);
    return { prima, dopo };
  });
  ok('passare a un altro foglio non muove i disegni',
     JSON.stringify(r.prima) === JSON.stringify(r.dopo) && r.prima.length > 0,
     'prima ' + JSON.stringify(r.prima) + ', dopo ' + JSON.stringify(r.dopo));

  /* ============ C. L'ACCOSTAMENTO ============ */

  /* Il gesto dei magneti: se ne mette un altro di fianco. Posandolo li'
     nasce gia' accostato, quindi senza una misura in piu'. */
  await AZZERA(page);
  r = await page.evaluate(() => {
    Paper.setSize(75, 75);
    Paper.setSheetOrigin(0, 0);
    const b = Fogli.aggiungi(75, 75, 'due');
    return { posa: [b.origine.x, b.origine.y], aggancio: !!b.aggancio,
             daMisurare: Fogli.daMisurare().length,
             radice: Fogli.radiceDi(b.id) === State.data.fogli[0].id };
  });
  ok('un foglio nuovo si posa accanto a quello che c\'e`, e nasce accostato',
     r.posa[0] === 75 && r.posa[1] === 0 && r.aggancio && r.radice &&
     r.daMisurare === 1,
     'posato a ' + r.posa + ', angoli da misurare: ' + r.daMisurare);

  /* E staccandolo torna a doversi misurare da solo: nessuno glielo direbbe
     se gli agganci non si rileggessero a ogni spostamento. */
  r = await page.evaluate(() => {
    const b = State.data.fogli[1];
    Fogli.muovi(b.id, 150, 150);
    return { aggancio: b.aggancio, daMisurare: Fogli.daMisurare().length };
  });
  ok('staccandolo torna a doversi misurare da solo',
     r.aggancio === null && r.daMisurare === 2,
     'aggancio ' + r.aggancio + ', da misurare ' + r.daMisurare);

  /* Due fogli che si toccano per un VERTICE non sono una coppia: ricavare
     l'angolo di uno dall'altro su quel contatto e' fidarsi di niente. */
  await AZZERA(page);
  r = await page.evaluate(() => {
    Paper.setSize(75, 75); Paper.setSheetOrigin(0, 0);
    const b = Fogli.aggiungi(75, 75, 'due');
    Fogli.muovi(b.id, 75, 75);            // solo il vertice in comune
    return { aggancio: b.aggancio, daMisurare: Fogli.daMisurare().length };
  });
  ok('due fogli che si sfiorano in un angolo non sono accostati',
     r.aggancio === null && r.daMisurare === 2,
     'aggancio ' + r.aggancio);

  /* ============ D. NOVE MAGNETI, UNA MISURA ============
     E' il caso vero: 75 x 75 per nove, dentro una corsa di 241,23 x 236,06.
     Se si posano tutti attaccati, l'angolo da misurare e' uno solo -- che e'
     tutto il motivo per cui questa roba esiste. */
  await AZZERA(page);
  r = await page.evaluate(() => {
    Paper.setSize(75, 75); Paper.setSheetOrigin(0, 0);
    for (let i = 0; i < 8; i++) Fogli.aggiungi(75, 75, 'magnete ' + (i + 2));
    return {
      quanti: State.data.fogli.length,
      sovrapposti: Fogli.sovrapposti().length,
      fuori: Fogli.fuoriCorsa().length,
      daMisurare: Fogli.daMisurare().length,
      area: [+State.data.area.w.toFixed(2), +State.data.area.h.toFixed(2)],
      pose: State.data.fogli.map((f) => f.origine.x + ',' + f.origine.y).join(' ')
    };
  });
  ok('nove magneti da 75 x 75 ci stanno nella corsa, senza sovrapporsi',
     r.quanti === 9 && r.sovrapposti === 0 && r.fuori === 0,
     r.quanti + ' fogli, ' + r.sovrapposti + ' sovrapposti, ' + r.fuori +
     ' fuori corsa, corsa ' + r.area.join(' x '));
  ok('e tutti accostati vogliono UN angolo misurato, non nove',
     r.daMisurare === 1, r.daMisurare + ' angoli da misurare — pose: ' + r.pose);

  /* UN GRUPPO CHE NON TOCCA IL PRIMO FOGLIO. Il banco non aveva questo caso
     e gli serviva: nella griglia dei nove magneti tutti toccano il primo,
     quindi nessuna catena puo' chiudersi in tondo nemmeno se l'accostamento
     guardasse nel verso sbagliato. Qui invece due fogli si toccano SOLO fra
     loro: se si guardasse avanti nell'elenco, il primo direbbe «ricavo il mio
     angolo dal secondo» e il secondo «dal primo», e non lo misurerebbe
     nessuno dei due. Lo ha trovato il banco delle mutazioni. */
  await AZZERA(page);
  r = await page.evaluate(() => {
    Paper.setSize(75, 75); Paper.setSheetOrigin(0, 0);
    const b = Fogli.aggiungi(75, 75, 'b');
    const c = Fogli.aggiungi(75, 75, 'c');
    Fogli.muovi(b.id, 150, 0);          // lontano dal primo
    Fogli.muovi(c.id, 150, 75);         // accostato a b, e solo a b
    const radice = Fogli.trova(Fogli.radiceDi(c.id));
    return { daMisurare: Fogli.daMisurare().map((f) => f.id),
             radiceC: radice ? radice.id : null,
             radiceFerma: !!radice && radice.aggancio === null,
             b: b.id, c: c.id, primo: State.data.fogli[0].id };
  });
  ok('due fogli accostati solo fra loro: la catena finisce, non gira in tondo',
     r.daMisurare.length === 2 && r.daMisurare.indexOf(r.primo) >= 0 &&
     r.daMisurare.indexOf(r.b) >= 0 && r.radiceC === r.b && r.radiceFerma,
     'da misurare ' + JSON.stringify(r.daMisurare) + ', la radice di c e` ' +
     r.radiceC + (r.radiceFerma ? ' e si ferma li`' : ' e NON si ferma'));

  /* ============ E. QUELLO CHE NON VA, E L'ULTIMO FOGLIO ============ */

  await AZZERA(page);
  r = await page.evaluate(() => {
    Paper.setSize(75, 75); Paper.setSheetOrigin(0, 0);
    const b = Fogli.aggiungi(75, 75, 'due');
    const accostati = Fogli.sovrapposti().length;
    Fogli.muovi(b.id, 30, 30);                       // addosso
    const addosso = Fogli.sovrapposti();
    Fogli.muovi(b.id, 200, 200);                     // meta' fuori dalla corsa
    return { accostati, addosso: addosso.length,
             coppia: addosso.length ? addosso[0].length === 2 : false,
             fuori: Fogli.fuoriCorsa() };
  });
  ok('due fogli accostati non sono «sovrapposti»', r.accostati === 0,
     r.accostati + ' coppie');
  ok('due fogli uno sull\'altro si`, e si dice quali',
     r.addosso === 1 && r.coppia, r.addosso + ' coppie');
  ok('e un foglio che esce dalla corsa viene nominato',
     r.fuori.length === 1, JSON.stringify(r.fuori));

  /* IL BANCO DEVE SOPRAVVIVERE A QUELLO CHE TROVA. Se l'ultimo foglio
     sparisse davvero, `State.foglio()` cercherebbe dentro un elenco vuoto e
     la pagina morirebbe qui: i controlli dopo questo non uscirebbero
     nemmeno, e chi legge vedrebbe un banco che si interrompe invece di un
     banco che dice che cosa non va. Quindi si prova in una rete e, se il
     foglio e` sparito, se ne rimette uno e si tira avanti. */
  r = await page.evaluate(() => {
    const l = State.data.fogli;
    while (l.length > 1) Fogli.togli(l[l.length - 1].id);
    let tolto = null, rotto = null;
    try { tolto = Fogli.togli(l[0].id); } catch (e) { rotto = String(e.message); }
    const quanti = l.length;
    if (!l.length) {
      l.push(State.nuovoFoglio({ w: 148, h: 210, name: 'A5' }));
      State.data.foglioAttivo = l[0].id;
    }
    return { tolto: tolto, rotto: rotto, quanti: quanti, w: State.data.paper.w };
  });
  ok('l\'ultimo foglio non si toglie', r.tolto === false && r.quanti === 1 &&
     !r.rotto && r.w > 0,
     'tolto ' + r.tolto + ', restano ' + r.quanti +
     (r.rotto ? ', e si e` rotto: ' + r.rotto : ''));

  /* Togliendo un foglio in mezzo, chi dipendeva da lui non puo' restare
     attaccato a un id che non esiste piu': il suo angolo verrebbe ricavato
     da un foglio che non c'e'. */
  await AZZERA(page);
  r = await page.evaluate(() => {
    Paper.setSize(75, 75); Paper.setSheetOrigin(0, 0);
    const b = Fogli.aggiungi(75, 75, 'b');
    const c = Fogli.aggiungi(75, 75, 'c');
    Fogli.muovi(c.id, 150, 0);                    // in fila: a | b | c
    const prima = { bAgg: b.aggancio, cAgg: c.aggancio,
                    daMisurare: Fogli.daMisurare().length };
    Fogli.togli(b.id);
    return { prima, cAgg: c.aggancio, vivo: !!Fogli.trova(c.aggancio),
             daMisurare: Fogli.daMisurare().length };
  });
  ok('tre fogli in fila: uno misurato e due ricavati',
     r.prima.bAgg !== null && r.prima.cAgg !== null && r.prima.daMisurare === 1,
     JSON.stringify(r.prima));
  ok('togliendo quello in mezzo, chi dipendeva da lui non resta orfano',
     r.cAgg === null && r.daMisurare === 2,
     'aggancio ' + r.cAgg + ', da misurare ' + r.daMisurare);

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
