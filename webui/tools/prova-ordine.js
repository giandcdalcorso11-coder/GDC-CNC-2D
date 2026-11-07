/* Il collaudo di COME SI STAMPANO PIU' FOGLI (Step 11, fase 3).
 *
 * LA COSA CHE QUESTO PEZZO ESISTE PER FARE, in un numero: nove magneti con
 * due penne, stampati foglio per foglio, vogliono DICIOTTO cambi penna.
 * Stampati per penna ne vogliono DUE. La differenza non sono secondi di
 * macchina -- lo spostamento in piu' e' penna alzata a 3000 mm/min, non
 * costa niente -- sono sedici volte che una persona deve stare li' ad
 * aspettare di smontare e rimontare una penna.
 *
 * Quindi qui si guardano tre cose:
 *   1. che «per penna» raggruppi davvero, e che il conto delle fermate
 *      scenda;
 *   2. che «per foglio» continui a fare quello che ha sempre fatto -- la
 *      strada nuova non si fa rompendo quella vecchia;
 *   3. che il G-code DICA su che foglio sta andando. Con l'ordine per penna
 *      la punta salta da un foglio all'altro di continuo: guardando le
 *      coordinate non si capirebbe, e il telecomando deve poter dire
 *      «foglio 3 di 9».
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO.
 * Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-ordine.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

const DIS = (tinta) => `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
<path fill="none" stroke="${tinta}" d="M5 5 L35 5 L35 35 L5 35 Z"/></svg>`;

const NERO = '#1d1d1b', ROSSO = '#c8102e';

/* Due fogli, due penne per foglio: il caso piu' piccolo in cui le due
   strade danno risultati diversi. */
const SCENA = (page, quanti) => page.evaluate(([svgN, svgR, quanti]) => {
  document.getElementById('btn-clear-file').click();
  const l = State.data.fogli;
  while (l.length > 1) Fogli.togli(l[l.length - 1].id);
  Fogli.scegli(l[0].id);
  Paper.setSize(75, 75);
  Paper.setSheetOrigin(0, 0);
  for (let i = 0; i < quanti; i++) {
    if (i > 0) Fogli.scegli(Fogli.aggiungi(75, 75, null).id);
    Artwork.load(svgN, 'nero ' + (i + 1));
    Artwork.load(svgR, 'rosso ' + (i + 1));
  }
  return State.data.fogli.length;
}, [DIS(NERO), DIS(ROSSO), quanti]);

/* Dal programma: quante fermate, in che ordine vanno le penne, e che cosa
   dicono i marcatori del foglio. */
const LETTURA = (page, ordine) => page.evaluate((ordine) => {
  Profile.stampa().ordineFogli = ordine;
  Artwork.prepare();
  const t = document.getElementById('gcode-out').value;
  const righe = t.split('\n').map((x) => x.trim());
  return {
    pause: righe.filter((x) => x === ';PAUSA').length,
    penne: righe.filter((x) => /^;PENNA /.test(x)).map((x) => x.split(' ')[1]),
    nomi: righe.filter((x) => /^;PENNA /.test(x))
               .map((x) => x.split(' ').slice(2).join(' ')),
    fogli: righe.filter((x) => /^;FOGLIO /.test(x)).map((x) => x.split(' ')[1]),
    /* L'ordine in cui i marcatori compaiono nel file, mescolati: serve a
       vedere che il foglio e' scritto PRIMA della penna, e la penna prima
       della pausa. */
    marcatori: righe.filter((x) => /^;(FOGLIO|PENNA|PAUSA)/.test(x))
                    .map((x) => x.split(' ')[0])
  };
}, ordine);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  /* `fermati()` avvisa con un alert: senza qualcuno che lo chiuda, la
     pagina resta ferma e il banco scade invece di dire che cosa ha visto. */
  const avvisi = [];
  page.on('dialog', (d) => { avvisi.push(d.message()); d.dismiss().catch(() => {}); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* ============ UN FOGLIO SOLO: NIENTE CAMBIA ============
     Con un foglio solo le due strade sono la stessa strada, e il selettore
     non deve nemmeno comparire: una domanda la cui risposta non cambia
     niente e' una domanda da non fare. */
  await SCENA(page, 1);
  const unoPenna = await LETTURA(page, 'penna');
  const unoFoglio = await LETTURA(page, 'foglio');
  r = await page.evaluate(() => ({
    nascosto: document.getElementById('ordine-fogli').hidden
  }));
  ok('con un foglio solo il selettore dell\'ordine non compare', r.nascosto === true);
  ok('e le due strade danno lo stesso programma',
     unoPenna.pause === unoFoglio.pause &&
     JSON.stringify(unoPenna.nomi) === JSON.stringify(unoFoglio.nomi) &&
     unoPenna.pause === 1,
     unoPenna.pause + ' fermata, penne ' + JSON.stringify(unoPenna.nomi));

  /* ============ DUE FOGLI: LE DUE STRADE SI SEPARANO ============ */
  await SCENA(page, 2);
  r = await page.evaluate(() => ({
    visibile: !document.getElementById('ordine-fogli').hidden
  }));
  ok('con piu` fogli il selettore compare', r.visibile === true);

  const duePenna = await LETTURA(page, 'penna');
  const dueFoglio = await LETTURA(page, 'foglio');

  ok('«per penna»: prima tutto il nero su tutti i fogli, poi tutto il rosso',
     JSON.stringify(duePenna.nomi) ===
       JSON.stringify(['nero 1', 'nero 2', 'rosso 1', 'rosso 2']),
     JSON.stringify(duePenna.nomi));
  ok('«per foglio»: un foglio alla volta, finito e via',
     JSON.stringify(dueFoglio.nomi) ===
       JSON.stringify(['nero 1', 'rosso 1', 'nero 2', 'rosso 2']),
     JSON.stringify(dueFoglio.nomi));

  /* IL NUMERO CHE CONTA. */
  ok('e «per penna» costa UNA fermata invece di tre',
     duePenna.pause === 1 && dueFoglio.pause === 3,
     'per penna ' + duePenna.pause + ', per foglio ' + dueFoglio.pause);

  /* ============ IL G-CODE DICE SU CHE FOGLIO VA ============ */
  ok('il programma dice su quale foglio sta andando, e quanti sono',
     JSON.stringify(duePenna.fogli) === JSON.stringify(['1/2', '2/2', '1/2', '2/2']),
     JSON.stringify(duePenna.fogli));

  /* E SI SCRIVE QUANDO IL FOGLIO CAMBIA, non a ogni gruppo. Per penna il
     foglio cambia ogni volta e i due comportamenti darebbero lo stesso
     file: e' «per foglio» che li separa, perche' li' due gruppi di fila
     stanno sullo stesso foglio. Lo ha trovato il banco delle mutazioni. */
  ok('e si scrive quando il foglio CAMBIA, non a ogni gruppo',
     JSON.stringify(dueFoglio.fogli) === JSON.stringify(['1/2', '2/2']),
     'per foglio: ' + JSON.stringify(dueFoglio.fogli) + ' con ' +
     dueFoglio.nomi.length + ' gruppi');

  /* L'ORDINE DEI MARCATORI NON E' UN DETTAGLIO: al cambio penna il Sender si
     ferma sul segno di pausa e non legge piu' niente, quindi quello che gli
     serve per rispondere a «quale penna monto, e su che foglio» deve essere
     gia' passato. Foglio, poi penna, poi pausa. */
  const iPausa = duePenna.marcatori.indexOf(';PAUSA');
  ok('e lo dice PRIMA della penna, che viene prima della pausa',
     iPausa > 1 && duePenna.marcatori[iPausa - 1] === ';PENNA' &&
     duePenna.marcatori[iPausa - 2] === ';FOGLIO',
     duePenna.marcatori.join(' '));

  /* ============ NOVE MAGNETI: IL CASO VERO ============ */
  await SCENA(page, 9);
  const noveP = await LETTURA(page, 'penna');
  const noveF = await LETTURA(page, 'foglio');
  ok('nove magneti a due penne: UNA fermata per penna, diciassette per foglio',
     noveP.pause === 1 && noveF.pause === 17,
     'per penna ' + noveP.pause + ', per foglio ' + noveF.pause);
  ok('e i diciotto disegni ci sono tutti, in tutt\'e due le strade',
     noveP.nomi.length === 18 && noveF.nomi.length === 18 &&
     noveP.fogli.length === 18,
     noveP.nomi.length + ' penne, ' + noveP.fogli.length + ' marcatori di foglio');

  /* ============ «TUTTO» NON PUO' RAGGRUPPARE PER PENNA ============
     Li' un gruppo e' un foglio intero con dentro le sue penne mescolate:
     non esiste «la penna di questo gruppo» da cui ordinare. Si dice invece
     di farlo male in silenzio. */
  await SCENA(page, 2);
  r = await page.evaluate(() => {
    Profile.stampa().ottimizza = 'tutto';
    Profile.stampa().ordineFogli = 'penna';
    Artwork.prepare();
    const t = document.getElementById('gcode-out').value;
    const avvisi = [...document.querySelectorAll('#log-view .log-err')]
      .map((x) => x.textContent);
    Profile.stampa().ottimizza = 'livello';
    return { detto: avvisi.some((x) => /per penna.*ottimizzazione/i.test(x)),
             fogli: t.split('\n').filter((x) => /^;FOGLIO/.test(x.trim())).length };
  });
  ok('con l\'ottimizzazione «tutto» lo dice invece di fare finta',
     r.detto === true && r.fogli === 2,
     (r.detto ? 'avvisato' : 'NON avvisato') + ', ' + r.fogli + ' marcatori');

  /* ============ I POPUP DI INIZIO STAMPA ============
     Un angolo per ogni foglio che sta per conto suo. Quelli accostati no:
     il loro angolo si ricava dal vicino, ed e' tutto il motivo per cui
     l'accostamento esiste. Nove magneti spinti uno contro l'altro devono
     restare tre schermate, come quando il foglio era uno solo. */

  /* La procedura, percorsa fino in fondo soddisfacendo ogni passo. Torna
     l'elenco delle schermate viste. */
  const PERCORRI = async (page) => {
    await page.evaluate(() => {
      State.data.azzerata = true;
      Popup.avviaStampa();
    });
    const viste = [];
    for (let k = 0; k < 24; k++) {
      const st = await page.evaluate(() => ({
        aperto: !document.getElementById('modal').hidden,
        passo: document.getElementById('modal-passo').textContent,
        titolo: document.getElementById('modal-titolo').textContent
      }));
      if (!st.aperto) break;
      viste.push(st.titolo);
      /* Si fa finta di aver fatto quello che il passo chiede: azzerata, e
         la punta scesa alla quota di contatto. */
      await page.evaluate((k) => {
        State.data.azzerata = true;
        /* Una quota DIVERSA a ogni passo: con tre fogli che finiscono alla
           stessa z, «la quota giusta per ogni foglio» e «una quota qualunque»
           darebbero lo stesso file. */
        const c = Profile.zContatto();
        if (c !== null) State.data.pos.z = c - k * 0.13;
        State.emit('pos');
      }, k);
      await page.waitForTimeout(40);
      if (await page.evaluate(() => document.getElementById('modal-ok').disabled)) {
        viste.push('!! OK spento su «' + st.titolo + '»');
        break;
      }
      await page.click('#modal-ok');
      await page.waitForTimeout(60);
    }
    return viste;
  };

  /* Tre fogli, due accostati e uno per conto suo. */
  await page.evaluate((svg) => {
    document.getElementById('btn-clear-file').click();
    const l = State.data.fogli;
    while (l.length > 1) Fogli.togli(l[l.length - 1].id);
    Fogli.scegli(l[0].id);
    Paper.setSize(75, 75); Paper.setSheetOrigin(0, 0);
    l[0].misurato = false;
    Artwork.load(svg, 'a');
    const f2 = Fogli.aggiungi(75, 75, null); Fogli.scegli(f2.id); Artwork.load(svg, 'b');
    const f3 = Fogli.aggiungi(75, 75, null); Fogli.muovi(f3.id, 150, 140);
    Fogli.scegli(f3.id); Artwork.load(svg, 'c');
    document.getElementById('chk-carte-diverse').checked = false;
    Artwork.prepare();
  }, DIS(NERO));
  r = await page.evaluate(() => ({ daMisurare: Fogli.daMisurare().length,
                                   fogli: State.data.fogli.length }));
  ok('tre fogli, due accostati: due angoli da misurare',
     r.fogli === 3 && r.daMisurare === 2, JSON.stringify(r));

  let viste = await PERCORRI(page);
  ok('e la procedura e` di quattro schermate, non di cinque',
     viste.length === 4 && /Origine/.test(viste[0]) &&
     /Altezza/.test(viste[1]) && /Angolo del foglio 1/.test(viste[2]) &&
     /Angolo del foglio 3/.test(viste[3]),
     viste.join(' | '));

  /* LA MISURA MUOVE TUTTA LA FAMIGLIA. I fogli accostati sono spinti uno
     contro l'altro: la misura dice dove sta il GRUPPO, non dove sta un
     quadrato. Spostare solo quello misurato sfascerebbe il gruppo proprio
     nel momento in cui lo si ancora alla realta'. */
  r = await page.evaluate(() => {
    const l = State.data.fogli;
    return { pose: l.map((f) => f.origine.x + ',' + f.origine.y),
             bloccati: l.filter((f) => f.misurato).length };
  });
  ok('misurando un angolo si muove tutta la famiglia, e si blocca',
     r.pose[1] === String(+r.pose[0].split(',')[0] + 75) + ',' +
                   r.pose[0].split(',')[1] &&
     r.bloccati === 3,
     'pose ' + JSON.stringify(r.pose) + ', ' + r.bloccati + ' bloccati');

  /* NOVE MAGNETI ACCOSTATI: tre schermate, come quando il foglio era uno. */
  await SCENA(page, 9);
  r = await page.evaluate(() => Fogli.daMisurare().length);
  viste = await PERCORRI(page);
  ok('nove magneti accostati: tre schermate, come con un foglio solo',
     r === 1 && viste.length === 3, r + ' angoli, schermate: ' + viste.join(' | '));

  /* ============ LA SPUNTA DELLE CARTE DIVERSE ============ */
  await SCENA(page, 3);
  r = await page.evaluate(() => {
    const c = document.getElementById('chk-carte-diverse');
    return { visibile: !document.getElementById('carte-diverse').hidden,
             spuntata: c.checked };
  });
  ok('la spunta delle carte diverse c\'e` e parte spenta',
     r.visibile === true && r.spuntata === false, JSON.stringify(r));

  const senza = await page.evaluate(() => {
    Artwork.prepare();
    return document.getElementById('gcode-out').value
      .split('\n').filter((x) => /quote di questo foglio/.test(x)).length;
  });
  ok('senza la spunta il programma non ha nessuna riga di quota',
     senza === 0, senza + ' righe');

  await page.evaluate(() => {
    document.getElementById('chk-carte-diverse').checked = true;
  });
  viste = await PERCORRI(page);
  ok('con la spunta si misura un\'altezza per foglio',
     viste.filter((x) => /Altezza/.test(x)).length === 3 && viste.length === 5,
     viste.join(' | '));

  /* E LA QUOTA GIUSTA VA SUL FOGLIO GIUSTO. Contare le righe non basta:
     tre righe con la stessa quota sarebbero tre righe e zero informazione.
     Si legge il programma in modo MODALE — la quota vale finché non ne
     arriva un'altra, come tutto il resto del G-code — e a ogni marcatore di
     foglio si pretende la quota di QUEL foglio. */
  r = await page.evaluate(() => {
    const t = document.getElementById('gcode-out').value;
    const z = State.data.fogli.map((f) => (f.cartaSua && f.z !== null)
                                            ? +f.z.toFixed(3) : null);
    let quota = null;
    const coppie = [];
    t.split('\n').forEach((riga) => {
      const q = riga.match(/quote di questo foglio: appoggio Z(-?\d+(?:\.\d+)?)/);
      if (q) { quota = +q[1]; return; }
      const f = riga.match(/^;FOGLIO (\d+)\//);
      if (f) coppie.push({ n: +f[1], quota: quota });
    });
    return { z: z, coppie: coppie,
             sbagliate: coppie.filter((c) => c.quota === null ||
               Math.abs(c.quota - z[c.n - 1]) > 0.0005).length,
             diverse: new Set(z).size };
  });
  ok('e ogni foglio riceve LA SUA quota, non una qualunque',
     r.diverse === 3 && r.coppie.length > 0 && r.sbagliate === 0,
     r.coppie.length + ' marcatori, ' + r.sbagliate + ' con la quota sbagliata, ' +
     'quote dei fogli ' + JSON.stringify(r.z));

  /* ============ UN FOGLIO FUORI DALLA CORSA ============
     Il controllo dell'ingombro guarda SOLO il foglio appena misurato, e il
     motivo e' che gli altri non sono ancora stati toccati: dire «il disegno
     del foglio 3 esce dall'area» mentre si misura il foglio 1 sarebbe un
     allarme su una posizione che e' ancora un'ipotesi — e fermerebbe la
     procedura a meta' per una cosa che la misura dopo potrebbe sistemare.
     Ma alla fine, quando tutte le posizioni sono vere, si guardano tutti. */
  avvisi.length = 0;
  await page.evaluate((svg) => {
    document.getElementById('btn-clear-file').click();
    const l = State.data.fogli;
    while (l.length > 1) Fogli.togli(l[l.length - 1].id);
    Fogli.scegli(l[0].id);
    l[0].misurato = false;
    document.getElementById('chk-carte-diverse').checked = false;
    Paper.setSize(150, 75); Paper.setSheetOrigin(0, 0);
    Artwork.load(svg, 'buono');

    /* IL FOGLIO 2 E' ACCOSTATO AL PRIMO E IL SUO DISEGNO ESCE DALLA CORSA.
       Si guarda il DISEGNO e non il foglio, ed e' una differenza che costa
       accorgersene: un disegno quadrato su un foglio largo si centra, non
       si allarga, quindi un foglio che sporge di cinquanta millimetri puo'
       benissimo avere il disegno tutto dentro. Qui il foglio comincia a
       150 e il disegno gli cade in mezzo, cioe' oltre il limite della
       corsa.
       Essendo accostato non ha un passo suo -- il suo angolo si ricava --
       quindi nessuno lo guarda finche' non si consegna: e' il caso che solo
       il controllo finale puo' prendere. */
    const f2 = Fogli.aggiungi(150, 75, null);
    Fogli.muovi(f2.id, 150, 0);
    Fogli.scegli(f2.id);
    Artwork.load(svg, 'accostato fuori');

    /* IL FOGLIO 3 sta per conto suo e adesso e' fuori dalla corsa, ma la
       sua misura lo rimettera' dentro: mentre si misura il primo, lamentarsi
       di lui sarebbe un allarme su una posizione che e' ancora un'ipotesi. */
    const f3 = Fogli.aggiungi(75, 75, null);
    Fogli.muovi(f3.id, 200, 140);
    Fogli.scegli(f3.id);
    Artwork.load(svg, 'poi dentro');
    Artwork.prepare();
  }, DIS(NERO));

  viste = await PERCORRI(page);
  r = await page.evaluate(() => ({
    misurati: State.data.fogli.filter((f) => f.misurato).length,
    inviato: State.data.stampa.stato
  }));
  ok('un foglio fuori corsa non ferma la misura degli altri',
     viste.length === 4 && /Angolo del foglio 1/.test(viste[2]) &&
     /Angolo del foglio 3/.test(viste[3]),
     viste.join(' | '));
  ok('ma alla fine lo dice, e non manda niente in stampa',
     avvisi.length === 1 && /esce dall'area/.test(avvisi[0]) &&
     /foglio 2/.test(avvisi[0]) && r.inviato === 'fermo',
     avvisi.length + ' avvisi: ' + (avvisi[0] || '—').slice(0, 110));

  /* LA SPUNTA DELLE CARTE DIVERSE RESTA SPUNTATA quando i fogli tornano a
     essere uno: e' nascosta, non spenta. Con un foglio solo «i fogli sono
     di carte diverse» non vuol dire niente, e misurare quel foglio come se
     avesse una carta sua gli attaccherebbe addosso una quota che il
     programma poi scrive senza che serva. */
  await page.evaluate((svg) => {
    document.getElementById('btn-clear-file').click();
    const l = State.data.fogli;
    Paper.setSize(75, 75); Paper.setSheetOrigin(0, 0);
    while (l.length > 1) Fogli.togli(l[l.length - 1].id);
    Fogli.scegli(l[0].id);
    l[0].misurato = false;
    l[0].cartaSua = false;
    l[0].z = null;
    Fogli.scegli(Fogli.aggiungi(75, 75, null).id);
    document.getElementById('chk-carte-diverse').checked = true;
    /* ...e adesso il secondo se ne va: la spunta resta com'era. */
    Fogli.togli(State.data.fogli[1].id);
    Artwork.load(svg, 'solo');
    Artwork.prepare();
  }, DIS(NERO));
  viste = await PERCORRI(page);
  r = await page.evaluate(() => ({
    quote: document.getElementById('gcode-out').value
      .split('\n').filter((x) => /quote di questo foglio/.test(x)).length,
    spuntata: document.getElementById('chk-carte-diverse').checked,
    sua: State.data.fogli[0].cartaSua
  }));
  ok('con un foglio solo la spunta rimasta accesa non conta',
     r.spuntata === true && r.sua === false && r.quote === 0 &&
     viste.length === 3,
     'spuntata ' + r.spuntata + ', carta sua ' + r.sua + ', ' + r.quote +
     ' righe di quota, ' + viste.length + ' schermate');

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
