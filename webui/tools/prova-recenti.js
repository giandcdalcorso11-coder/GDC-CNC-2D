/* Il collaudo dei DISEGNI RECENTI: il salvataggio automatico, il menu, il
 * nome che si chiede al salvataggio.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «scrive qualcosa nel browser»: e'
 * che quello che si ritrova sia il lavoro, e che l'elenco resti LEGGIBILE.
 * Sono due promesse diverse e si rompono in modi diversi:
 *
 *   - un recupero per SESSIONE DI LAVORO, non uno ogni quattro secondi:
 *     senza questa regola venti slot diventano venti copie dello stesso
 *     disegno e nessuna delle versioni che servirebbero;
 *   - i PROGETTI salvati a mano non scadono e non si contano nei venti: chi
 *     ha dato un nome a una cosa ha detto «questa tienila», e un recupero
 *     automatico non deve poterla spingere fuori;
 *   - il piano VUOTO non si salva: se no ogni apertura della pagina consuma
 *     uno slot per salvare il nulla;
 *   - quello che si riapre e' il DISEGNO, non un file che gli somiglia.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-recenti.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
<path fill="none" stroke="#1d1d1b" d="M5 5 L35 5 L35 35 L5 35 Z"/></svg>`;
const SVG2 = `<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="30mm" viewBox="0 0 30 30">
<path fill="none" stroke="#c8102e" d="M2 2 L28 2 L15 28 Z"/></svg>`;

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 },
                                         acceptDownloads: true });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  /* Il salvataggio a mano scarica un file per davvero: qui si accetta e si
     butta, ma il nome del file e' una delle cose da guardare. */
  const scaricati = [];
  page.on('download', (d) => scaricati.push(d.suggestedFilename()));
  await page.goto(PAGINA);
  await page.waitForTimeout(500);

  let r;

  /* La memoria si svuota prima di cominciare: un collaudo che parte da quello
     che ha lasciato il giro precedente conta cose che non ha scritto lui. */
  const svuota = () => page.evaluate(async () => {
    const tutti = await Recenti.elenco();
    for (const v of tutti) await Recenti.togli(v.id);
    Recenti.nuovaSessione();
  });
  const quanti = () => page.evaluate(async () => {
    const t = await Recenti.elenco();
    return { tutti: t.length,
             rec: t.filter((v) => v.tipo === 'recupero').length,
             prog: t.filter((v) => v.tipo === 'progetto').length,
             nomi: t.map((v) => v.nome) };
  });

  /* ============ A. IL PIANO VUOTO NON SI SALVA ============
     E' il primo controllo perche' e' lo stato della pagina appena aperta: se
     questo non vale, ogni apertura consuma uno slot per salvare il nulla e i
     venti recuperi diventano venti pagine aperte. */
  await svuota();
  r = await page.evaluate(() => Recenti.recuperaOra());
  ok('il piano vuoto non consuma uno slot', r === false);
  r = await quanti();
  ok('e infatti nella memoria non c’è niente', r.tutti === 0, r.tutti + ' righe');

  /* ============ B. IL RECUPERO SCRITTO DA SOLO ============ */
  await page.evaluate((svg) => Artwork.load(svg, 'quadrato.svg'), SVG);
  await page.waitForTimeout(300);
  r = await page.evaluate(() => Recenti.recuperaOra());
  ok('con un disegno sul piano, il recupero si scrive', r === true);
  r = await quanti();
  ok('e nella memoria c’è un recupero, col nome del disegno',
     r.rec === 1 && /quadrato/.test(r.nomi[0]), r.nomi.join(' | '));

  /* UNO SLOT PER SESSIONE DI LAVORO. Tre modifiche e tre salvataggi: deve
     restare UN recupero, non tre. E' la regola che tiene leggibile il menu, e
     la si rompe senza accorgersene -- un id nuovo a ogni scrittura funziona
     benissimo, e riempie l'elenco in un pomeriggio. */
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      Artwork.forme().push(Tracciato.linea(1 + Math.random(), 1, 9, 9));
      Artwork.rigenera();
      State.emit('path');
    });
    await page.evaluate(() => Recenti.recuperaOra());
  }
  r = await quanti();
  ok('tre modifiche salvate restano UN recupero: uno per sessione di lavoro',
     r.rec === 1, r.rec + ' recuperi');

  /* E quello che c'e' dentro e' l'ULTIMA versione, non la prima: uno slot
     riusato che non si aggiorna e' peggio di nessuno slot, perche' promette
     un recupero e ne restituisce uno vecchio. */
  r = await page.evaluate(async () => {
    const t = await Recenti.elenco();
    const v = await Recenti.leggi(t[0].id);
    const ora = Progetto.testo();
    return { uguale: Recenti.impronta(v.testo) === Recenti.impronta(ora),
             byte: v.byte, oraByte: ora.length };
  });
  ok('e dentro c’è l’ultima versione del disegno, non la prima',
     r.uguale, r.byte + ' byte contro ' + r.oraByte);

  /* L'IMPRONTA, e perche' esiste un controllo per lei. `Progetto.testo()`
     scrive dentro al file l'ora in cui l'ha scritto, quindi due chiamate a un
     secondo di distanza danno due testi DIVERSI su un disegno immobile: senza
     togliere quel campo, «e' cambiato qualcosa?» rispondeva sempre si' e il
     recupero si riscriveva a ogni clic -- `path` lo emette anche a ogni
     cambio di selezione. L'impronta e' un accordo con la forma che
     `progetto.js` da' a quel pezzo di JSON, fragile per costruzione, e questo
     controllo e' quello che se ne accorge se un giorno quel campo cambia
     nome. */
  r = await page.evaluate(async () => {
    const a = Progetto.testo();
    await new Promise((f) => setTimeout(f, 1100));
    const b = Progetto.testo();
    return { testiDiversi: a !== b,
             improntaUguale: Recenti.impronta(a) === Recenti.impronta(b) };
  });
  ok('due testi dello stesso disegno differiscono per l\u2019ora, e l\u2019impronta no',
     r.testiDiversi && r.improntaUguale,
     'testi diversi: ' + r.testiDiversi + ', impronta uguale: ' + r.improntaUguale);

  /* NIENTE DI NUOVO, NIENTE SCRITTURA. `path` lo emette Artwork anche a ogni
     cambio di SELEZIONE, che non e' una modifica: senza il confronto col
     testo scritto l'ultima volta, cliccare in giro riscriverebbe il recupero
     a ogni clic. */
  r = await page.evaluate(() => Recenti.recuperaOra());
  ok('un disegno che non è cambiato non si riscrive', r === false);

  /* UN FILE NUOVO E` UN'ALTRA SESSIONE: il recupero di prima resta, e se ne
     apre un altro. Senza questo, caricare un file alle cinque cancella il
     punto in cui si era arrivati alle tre. */
  await page.evaluate((svg) => Artwork.load(svg, 'triangolo.svg'), SVG2);
  await page.waitForTimeout(300);
  await page.evaluate(() => Recenti.recuperaOra());
  r = await quanti();
  /* DUE recuperi, e quello di prima porta ancora il suo nome. Del nome del
     NUOVO non si chiede niente: con due file sul piano il progetto si chiama
     «composizione», e giustamente -- non e' piu' il triangolo ne' il
     quadrato. Quello che conta qui e' che il quadrato non sia stato
     sovrascritto. */
  ok('un file nuovo apre un altro slot, e quello di prima resta',
     r.rec === 2 && r.nomi.some((n) => /quadrato/.test(n)),
     r.nomi.join(' | '));

  /* ============ C. LA POTATURA ============ */
  await svuota();
  r = await page.evaluate(async () => {
    const ora = Date.now();
    /* Venticinque recuperi, tre progetti, e fra i recuperi uno vecchio di
       due mesi e un progetto vecchio di due mesi. */
    for (let i = 0; i < 25; i++) {
      await Recenti.metti({ id: 'r' + i, tipo: 'recupero', nome: 'rec ' + i,
                            quando: ora - i * 60000, livelli: 1, fogli: 1,
                            byte: 10, testo: 'x' });
    }
    await Recenti.metti({ id: 'rvecchio', tipo: 'recupero', nome: 'vecchio',
                          quando: ora - 60 * 24 * 3600 * 1000, livelli: 1,
                          fogli: 1, byte: 10, testo: 'x' });
    for (let i = 0; i < 3; i++) {
      await Recenti.metti({ id: 'p' + i, tipo: 'progetto', nome: 'prog ' + i,
                            quando: ora - i * 60000, livelli: 1, fogli: 1,
                            byte: 10, testo: 'x' });
    }
    await Recenti.metti({ id: 'pvecchio', tipo: 'progetto', nome: 'prog vecchio',
                          quando: ora - 60 * 24 * 3600 * 1000, livelli: 1,
                          fogli: 1, byte: 10, testo: 'x' });
    const via = await Recenti.pulisci();
    const t = await Recenti.elenco();
    return {
      via: via,
      rec: t.filter((v) => v.tipo === 'recupero').length,
      prog: t.filter((v) => v.tipo === 'progetto').length,
      vecchio: t.some((v) => v.id === 'rvecchio'),
      progVecchio: t.some((v) => v.id === 'pvecchio'),
      primo: t.filter((v) => v.tipo === 'recupero')[0].id
    };
  });
  ok('i recuperi oltre i venti si potano', r.rec === 20, r.rec + ' recuperi');
  ok('e si tengono i più recenti, non i primi arrivati', r.primo === 'r0', r.primo);
  ok('un recupero di due mesi se ne va', r.vecchio === false);
  /* Le due meta' della stessa promessa: un progetto NON si conta nei venti e
     NON scade. Rompere la potatura in modo che tocchi anche i progetti e'
     facile -- basta dimenticare il filtro -- e il danno e' il peggiore che
     questo modulo possa fare: butta via il lavoro che l'utente ha chiesto di
     tenere. */
  ok('i progetti salvati non si contano nei venti', r.prog === 4, r.prog + ' progetti');
  ok('e un progetto di due mesi RESTA: scadono solo i recuperi',
     r.progVecchio === true);

  /* LA DATA CONTA ANCHE QUANDO GLI SLOT SONO POCHI, e serve una scena a
     parte: nella scena dei venticinque, il recupero di due mesi e' anche il
     ventiseiesimo per data, quindi il taglio dei venti lo porta via comunque
     -- cioe' il controllo di sopra rispondeva giusto per caso, e una potatura
     che non guarda affatto la data lo superava. Con tre recuperi in croce i
     venti non c'entrano, e resta solo la data. */
  await svuota();
  r = await page.evaluate(async () => {
    const ora = Date.now();
    await Recenti.metti({ id: 'a', tipo: 'recupero', nome: 'di oggi',
                          quando: ora, livelli: 1, fogli: 1, byte: 9, testo: 'x' });
    await Recenti.metti({ id: 'b', tipo: 'recupero', nome: 'di due mesi fa',
                          quando: ora - 60 * 24 * 3600 * 1000, livelli: 1,
                          fogli: 1, byte: 9, testo: 'x' });
    await Recenti.pulisci();
    const t = await Recenti.elenco();
    return { quanti: t.length, oggi: t.some((v) => v.id === 'a'),
             vecchio: t.some((v) => v.id === 'b') };
  });
  ok('un recupero scade per la data anche quando gli slot sono pochi',
     r.quanti === 1 && r.oggi && !r.vecchio,
     r.quanti + ' righe, quello di oggi ' + (r.oggi ? 'c\'è' : 'no'));

  /* ============ D. DURANTE UNA STAMPA NON SI SCRIVE ============
     Il disegno non cambia mentre la macchina lo esegue, quindi non c'e'
     niente di nuovo da salvare, e il processore sta mandando il programma. */
  await svuota();
  await page.evaluate((svg) => Artwork.load(svg, 'in-stampa.svg'), SVG);
  await page.waitForTimeout(300);
  r = await page.evaluate(async () => {
    State.data.stampa.stato = 'corso';
    const a = await Recenti.recuperaOra();
    State.data.stampa.stato = 'fermo';
    const b = await Recenti.recuperaOra();
    return { durante: a, dopo: b };
  });
  ok('durante una stampa non si scrive, e dopo sì',
     r.durante === false && r.dopo === true);

  /* ============ E. IL RITARDO, cioe' il cablaggio vero ============
     Fin qui si e' chiamato `recuperaOra` a mano. Qui si guarda che una
     modifica del disegno faccia partire il salvataggio DA SOLA: e' l'unica
     cosa che l'utente non fa, e quindi l'unica che nessuno si accorgerebbe se
     mancasse. Si aspetta un filo piu' dell'attesa dichiarata dal modulo. */
  await svuota();
  await page.evaluate(() => {
    Artwork.forme().push(Tracciato.linea(2, 2, 20, 20));
    Artwork.rigenera();
    State.emit('path');
  });
  const subito = await quanti();
  const attesa = await page.evaluate(() => Recenti.ATTESA_MS);
  await page.waitForTimeout(attesa + 1200);
  const poi = await quanti();
  ok('una modifica non salva SUBITO: durante un trascinamento non si scrive',
     subito.rec === 0, subito.rec + ' recuperi appena modificato');
  ok('e si salva da sola poco dopo che la mano si è fermata',
     poi.rec === 1, poi.rec + ' recuperi dopo ' + attesa + ' ms');

  /* ============ F. IL MENU ============ */
  r = await page.evaluate(() => {
    const b = document.getElementById('btn-recenti');
    if (b) b.click();
    return {
      c: !!b,
      spento: b ? b.disabled : true,
      aperto: !document.getElementById('rec-modal').hidden
    };
  });
  ok('il pulsante «Recenti» c’è e apre il menu', r.c && r.aperto);
  /* NON si spegne col piano vuoto, al contrario di «Salva»: l'elenco serve
     proprio quando non c'e' niente sul piano, cioe' appena aperta la pagina.
     E' il difetto piu' facile da fare qui -- copiare il `disabled` del
     pulsante accanto -- e rende il menu inutile proprio quando serve. */
  ok('e non è spento quando il piano è vuoto: serve proprio allora',
     r.spento === false);

  await page.waitForTimeout(250);
  r = await page.evaluate(async () => {
    await Recenti.metti({ id: 'pmenu', tipo: 'progetto', nome: 'lavagna',
                          quando: Date.now() - 3600 * 1000, livelli: 2,
                          fogli: 1, byte: 10, testo: 'x' });
    await Recenti.disegna();
    const box = document.getElementById('rec-elenco');
    const tit = Array.prototype.map.call(box.querySelectorAll('.rec-tit'),
                                         (t) => t.textContent);
    return {
      tit: tit,
      righe: box.querySelectorAll('.rec-riga').length,
      testo: box.textContent,
      cestini: box.querySelectorAll('[data-via]').length
    };
  });
  ok('il menu ha DUE gruppi, e i progetti stanno prima dei recuperi',
     r.tit.length === 2 && /Progetti/i.test(r.tit[0]) && /da soli/i.test(r.tit[1]),
     r.tit.join(' | '));
  ok('e ogni riga dice quando, a parole', /un’ora fa|ora fa|minuti fa|adesso/.test(r.testo),
     r.testo.replace(/\s+/g, ' ').slice(0, 90));
  ok('e ogni riga ha il suo cestino', r.cestini === r.righe,
     r.cestini + ' cestini per ' + r.righe + ' righe');

  /* IL CESTINO TOGLIE QUELLA RIGA E NON ALTRE. */
  r = await page.evaluate(async () => {
    const prima = (await Recenti.elenco()).length;
    document.querySelector('[data-via="pmenu"]').click();
    await new Promise((f) => setTimeout(f, 400));
    const t = await Recenti.elenco();
    return { prima: prima, dopo: t.length, c: t.some((v) => v.id === 'pmenu') };
  });
  ok('il cestino toglie quella riga, e una sola',
     r.dopo === r.prima - 1 && !r.c, r.prima + ' -> ' + r.dopo);

  /* ============ G. RIAPRIRE E` RIPRENDERE ============
     Non «si carica un file che somiglia a quello»: quello che torna e' il
     disegno con i suoi livelli. Si svuota il piano e si riapre il recupero
     scritto all'inizio. */
  r = await page.evaluate(async () => {
    const t = await Recenti.elenco();
    const scelto = t.filter((v) => v.tipo === 'recupero')[0];
    Artwork.clear();
    const vuoti = Artwork.livelli().length;
    await Recenti.apriRecente(scelto.id);
    await new Promise((f) => setTimeout(f, 400));
    return { vuoti: vuoti, livelli: Artwork.livelli().length,
             chiuso: document.getElementById('rec-modal').hidden,
             forme: (Artwork.forme() || []).length };
  });
  ok('riaprire un recente rimette il disegno sul piano',
     r.vuoti === 0 && r.livelli > 0 && r.forme > 0,
     r.livelli + ' livelli, ' + r.forme + ' forme');
  ok('e il menu si chiude da sé', r.chiuso === true);

  /* ============ H. IL NOME, CHIESTO AL SALVATAGGIO ============
     Prima il nome usciva da `State.data.artName`, cioe' dal nome del primo
     file importato: nove magneti composti da «magnete 1.svg» si salvavano
     «magnete 1.cnc2d.svg». */
  await svuota();
  r = await page.evaluate(() => {
    document.getElementById('btn-save-prog').click();
    return {
      aperto: !document.getElementById('nome-modal').hidden,
      azione: document.getElementById('nome-ok').textContent,
      valore: document.getElementById('nome-campo').value
    };
  });
  ok('«Salva» chiede il nome invece di deciderlo da sé', r.aperto === true);
  /* La finestrella e' quella dei nomi di livelli e fogli, e il suo pulsante
     diceva «Rinomina»: mentre si salva e' una bugia piccola e fastidiosa. */
  ok('e il pulsante dice «Salva», non «Rinomina»', /Salva/.test(r.azione), r.azione);

  await page.evaluate(() => {
    document.getElementById('nome-campo').value = 'lavagna allenamento';
    document.getElementById('nome-ok').click();
  });
  await page.waitForTimeout(700);
  r = await quanti();
  ok('il nome scritto diventa il nome del file',
     scaricati.some((n) => /lavagna allenamento\.cnc2d\.svg/.test(n)),
     scaricati.join(' | ') || 'niente scaricato');
  ok('e il progetto salvato resta anche qui, col nome dato',
     r.prog === 1 && r.nomi.indexOf('lavagna allenamento') >= 0,
     r.nomi.join(' | '));
  /* E' la riga che conta sull'iPad, dove lo scaricamento non funziona: la
     copia locale e' l'unica che resta, e deve esserci sempre. */
  r = await page.evaluate(async () => {
    const t = await Recenti.elenco();
    const p = t.filter((v) => v.tipo === 'progetto')[0];
    const v = await Recenti.leggi(p.id);
    return { marca: v.testo.indexOf(Progetto.MARCA) >= 0, byte: v.testo.length };
  });
  ok('e quella copia è il progetto intero, non un segnaposto',
     r.marca && r.byte > 500, r.byte + ' byte');

  ok('nessun errore in console', errori.length === 0, errori.join(' | '));

  await browser.close();
  console.log(guai ? '\n' + guai + ' guai' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
