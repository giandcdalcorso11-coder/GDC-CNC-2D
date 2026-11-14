/* Il collaudo del MOTORE dei riempimenti: lo stampino, le regioni, il
 * tratteggio, il guardiano della fessura.
 *
 * Le forme qui dentro sono inventate a mano -- un quadrato, una ciambella,
 * un contorno con una fessura -- e non importate da un file: il motore non
 * sa niente dell'interfaccia, e provarlo con forme note vuol dire sapere
 * esattamente che cosa deve venire fuori. Una ciambella e' la A in
 * grassetto di cui parlava l'utente, ridotta a quello che conta: una regione
 * dentro a un'altra, con un buco che NON si deve riempire.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «escono dei segmenti»: e' che
 *   - due spazi chiusi diversi siano DUE regioni, e il click scelga la sua;
 *   - il tratteggio non attraversi mai il buco;
 *   - i capi si infilino sotto il contorno, se no resta una riga bianca;
 *   - un contorno con una fessura NON allaghi il foglio, e dica dove e'
 *     scappato;
 *   - la tolleranza di chiusura tappi la fessura quando glielo si chiede.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-riempimenti.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Un rettangolo chiuso come polilinea, in millimetri del foglio. `fessura`
   apre il lato basso di quel tanto, in mezzo: e' il difetto vero dei file
   esportati, non un caso di scuola. */
function rett(x, y, w, h, fessura) {
  const p = (X, Y) => ({ x: X, y: Y });
  if (!fessura) {
    return [[p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)]];
  }
  const m = x + w / 2;
  return [[p(m - fessura / 2, y), p(x, y), p(x, y + h), p(x + w, y + h),
           p(x + w, y), p(m + fessura / 2, y)]];
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* ============ A. UNA CIAMBELLA FA DUE REGIONI ============
     Un quadrato 40 × 40 con dentro un quadrato 10 × 10: l'anello e il buco
     sono due spazi chiusi diversi, piu' il fuori. */
  /* Il buco NON sta in mezzo, ed e' apposta: una ciambella simmetrica
     starebbe uguale anche ribaltata, quindi un ribaltamento della y --
     l'errore piu' facile da fare qui dentro, perche' sul foglio la y cresce
     verso l'alto e sulla tela verso il basso -- non si vedrebbe. Spostato
     in basso, il buco e il suo specchio sono due posti diversi. */
  const CIAMBELLA = {
    w: 60, h: 60,
    tratti: [...rett(10, 10, 40, 40), ...rett(25, 15, 10, 10)]
      .map((punti) => ({ punti, larghezza: 0.4 }))
  };

  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    return {
      regioni: st.regioni,
      anello: Riempi.regioneIn(st, { x: 15, y: 45 }),   // fra i due quadrati
      buco: Riempi.regioneIn(st, { x: 30, y: 20 }),     // dentro al piccolo
      fuori: Riempi.regioneIn(st, { x: 2, y: 2 }),      // fuori da tutto
      sulTratto: Riempi.regioneIn(st, { x: 10, y: 30 }) // sull'inchiostro
    };
  }, CIAMBELLA);
  ok('una ciambella fa tre regioni: fuori, anello, buco', r.regioni === 3,
     r.regioni + ' regioni');
  ok('e il punto cliccato sceglie la sua',
     r.anello > 0 && r.buco > 0 && r.anello !== r.buco && r.fuori > 0 &&
     r.fuori !== r.anello,
     'anello ' + r.anello + ', buco ' + r.buco + ', fuori ' + r.fuori);
  ok('sull\'inchiostro non c\'e` nessuna regione', r.sulTratto === 0);

  /* ============ B. IL TRATTEGGIO NON ATTRAVERSA IL BUCO ============
     E` il controllo che conta di tutto lo step: una penna che attraversa il
     buco della ciambella disegna una riga in mezzo al foglio, e nessuna
     anteprima la mostrerebbe come errore -- sembra un tratteggio. */
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 15, y: 45 });
    const t = Riempi.tratteggia(st, reg, { passo: 1, angolo: 0 });
    /* Si guarda OGNI punto di ogni segmento, non solo i capi: un segmento
       che salta il buco ha i capi buoni e il mezzo sbagliato. */
    let dentroAlBuco = 0;
    t.polilinee.forEach((poli) => {
      for (let i = 1; i < poli.length; i++) {
        const n = 40;
        for (let k = 0; k <= n; k++) {
          const x = poli[i - 1].x + (poli[i].x - poli[i - 1].x) * k / n;
          const y = poli[i - 1].y + (poli[i].y - poli[i - 1].y) * k / n;
          if (x > 26 && x < 34 && y > 16 && y < 24) dentroAlBuco++;
        }
      }
    });
    return { quante: t.polilinee.length, dentroAlBuco, metri: t.metri,
             alzate: t.alzate };
  }, CIAMBELLA);
  ok('il tratteggio dell\'anello non entra mai nel buco', r.dentroAlBuco === 0,
     r.dentroAlBuco + ' punti dentro al buco');
  /* Trentanove righe a passo 1 su un anello alto 40: quelle che passano
     all'altezza del buco sono spezzate in due, quindi i pezzi sono di piu'
     delle righe. */
  ok('e si spezza in due dove incontra il buco', r.quante > 39,
     r.quante + ' pezzi');

  /* ============ C. IL PASSO E` QUELLO CHIESTO ============
     Un quadrato 20 × 20 a passo 1 mm: venti righe lunghe venti, cioe' circa
     quattro decimetri di penna. Se il passo fosse la meta' sarebbe il
     doppio, e sulla carta vorrebbe dire un'ora invece di mezza. */
  const QUADRATO = {
    w: 40, h: 40,
    tratti: rett(10, 10, 20, 20).map((punti) => ({ punti, larghezza: 0.4 }))
  };
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 20, y: 20 });
    const uno = Riempi.tratteggia(st, reg, { passo: 1, angolo: 0, sotto: 0 });
    const mezzo = Riempi.tratteggia(st, reg, { passo: 0.5, angolo: 0, sotto: 0 });
    return { uno: uno.metri * 1000, mezzo: mezzo.metri * 1000,
             righe: uno.polilinee.length };
  }, QUADRATO);
  /* Poco MENO di 400, e il perche' va saputo: il contorno si mangia il suo
     spessore da tutt'e due le parti, quindi le righe sono lunghe 19,6 e non
     20, e a passo 1 su venti millimetri ce ne stanno diciannove. 19 × 19,6
     fa 372. Un controllo che pretendesse 400 tondi sarebbe un controllo che
     non ha capito la forma. */
  ok('a passo 1 mm un quadrato di 20 costa poco meno di 400 mm di penna',
     r.uno > 350 && r.uno < 400, r.uno.toFixed(0) + ' mm, ' + r.righe + ' righe');
  ok('e dimezzando il passo la penna raddoppia',
     Math.abs(r.mezzo / r.uno - 2) < 0.1,
     (r.mezzo / r.uno).toFixed(2) + ' volte');

  /* ============ D. I CAPI SI INFILANO SOTTO IL CONTORNO ============
     Senza, fra l'ultimo tratto e il bordo resta una riga bianca: si vede, ed
     e' la prima cosa che si nota in una forma riempita. */
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 20, y: 20 });
    const con = Riempi.tratteggia(st, reg, { passo: 2, angolo: 0 });
    const senza = Riempi.tratteggia(st, reg, { passo: 2, angolo: 0, sotto: 0 });
    const minX = (t) => Math.min.apply(null, t.polilinee.map(
      (p) => Math.min.apply(null, p.map((q) => q.x))));
    return { con: minX(con), senza: minX(senza) };
  }, QUADRATO);
  ok('i capi del tratteggio finiscono SOTTO il contorno',
     r.con < r.senza - 0.15 && r.con < 10.2,
     'capo a ' + r.con.toFixed(2) + ' mm, contorno a 10,00');

  /* ============ E. LA SERPENTINA ============
     Le stesse righe, unite ai capi: un tratto solo invece di venti. Ogni
     alzata di penna costa circa mezzo secondo, e qui il criterio e' il
     tempo. */
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 20, y: 20 });
    const dritto = Riempi.tratteggia(st, reg, { passo: 1, angolo: 0 });
    const serp = Riempi.tratteggia(st, reg, { passo: 1, angolo: 0, tipo: 'serpentina' });
    return { dritte: dritto.alzate, serp: serp.alzate };
  }, QUADRATO);
  ok('la serpentina fa una alzata di penna sola invece di venti',
     r.serp === 1 && r.dritte > 15, r.dritte + ' alzate -> ' + r.serp);

  /* E SULLA CIAMBELLA NON PRENDE SCORCIATOIE: unire due capi attraverso il
     buco sarebbe una riga in mezzo al foglio. */
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 15, y: 45 });
    const t = Riempi.tratteggia(st, reg, { passo: 1, angolo: 0, tipo: 'serpentina' });
    let dentroAlBuco = 0;
    t.polilinee.forEach((poli) => {
      for (let i = 1; i < poli.length; i++) {
        const n = 40;
        for (let k = 0; k <= n; k++) {
          const x = poli[i - 1].x + (poli[i].x - poli[i - 1].x) * k / n;
          const y = poli[i - 1].y + (poli[i].y - poli[i - 1].y) * k / n;
          if (x > 26 && x < 34 && y > 16 && y < 24) dentroAlBuco++;
        }
      }
    });
    return { dentroAlBuco, alzate: t.alzate };
  }, CIAMBELLA);
  ok('e sulla ciambella non unisce due capi attraverso il buco',
     r.dentroAlBuco === 0, r.dentroAlBuco + ' punti dentro al buco');

  /* ============ F. IL GUARDIANO DELLA FESSURA ============
     Un contorno aperto di mezzo millimetro: cliccarci dentro, senza
     guardiano, riempirebbe tutto il foglio. */
  const BUCATO = {
    w: 60, h: 60,
    /* Due millimetri di fessura. Mezzo millimetro NON basta a farlo
       scappare, ed e' una cosa che vale la pena sapere: il tratto e' largo
       0,4 e i suoi capi sono tondi, quindi di quel mezzo millimetro ne
       restano aperti 0,1 -- un pixel dello stampino, che l'antialiasing
       chiude da se'. Il contorno «quasi chiuso» dei file esportati, per
       questa strada, si tappa gratis. */
    tratti: rett(10, 10, 40, 40, 2).map((punti) => ({ punti, larghezza: 0.4 }))
  };
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 30, y: 30 });
    const t = Riempi.tratteggia(st, reg, { passo: 1, angolo: 0 });
    return { scappata: t.scappata, pezzi: t.polilinee.length,
             dove: t.dove, regioni: st.regioni };
  }, BUCATO);
  ok('un contorno con una fessura NON allaga il foglio',
     r.scappata === true && r.pezzi === 0,
     r.pezzi + ' pezzi disegnati');
  ok('e si dice DOVE e` scappato, invece di dire solo che e` scappato',
     !!r.dove && r.dove.x >= 0 && r.dove.y >= 0,
     r.dove ? r.dove.x.toFixed(1) + ', ' + r.dove.y.toFixed(1) : 'niente');

  /* ============ G. LA TOLLERANZA DI CHIUSURA ============
     La stessa fessura, tappata ingrassando i tratti SOLO dentro allo
     stampino: sulla carta la penna disegna il contorno sottile di sempre. */
  r = await page.evaluate((d) => {
    /* Una fessura da due millimetri vuole una tolleranza di uno: ogni capo
       si ingrassa di quel tanto e i due si incontrano in mezzo. Qui 1,2 per
       stare larghi. E` il numero che va nella finestrella, ed e' anche il
       motivo per cui non si mette alto d'ufficio: ingrassando i tratti si
       tappano le fessure, ma si chiudono anche le fessure VOLUTE. */
    const st = Riempi.stampino(d, { tolleranza: 1.2 });
    const reg = Riempi.regioneIn(st, { x: 30, y: 30 });
    const t = Riempi.tratteggia(st, reg, { passo: 2, angolo: 0 });
    return { scappata: t.scappata, pezzi: t.polilinee.length, metri: t.metri };
  }, BUCATO);
  ok('con la tolleranza di chiusura la stessa fessura si tappa',
     r.scappata === false && r.pezzi > 10,
     r.pezzi + ' pezzi, ' + (r.metri * 1000).toFixed(0) + ' mm');

  /* ============ H. L'ANGOLO ============ */
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 20, y: 20 });
    const zero = Riempi.tratteggia(st, reg, { passo: 1, angolo: 0, sotto: 0 });
    const no = Riempi.tratteggia(st, reg, { passo: 1, angolo: 90, sotto: 0 });
    const q = Riempi.tratteggia(st, reg, { passo: 1, angolo: 45, sotto: 0 });
    /* Le righe si percorrono a zig-zag, una in un verso e una nell'altro --
       meno strada a penna alzata -- quindi il verso di una riga puo' essere
       quello opposto: conta la DIREZIONE, cioe' l'angolo modulo 180. */
    const verso = (t) => {
      const p = t.polilinee[Math.floor(t.polilinee.length / 2)];
      const a = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) * 180 / Math.PI;
      return Math.round(((a % 180) + 180) % 180);
    };
    return { zero: verso(zero), no: verso(no), q: verso(q),
             /* A 45 gradi su un quadrato la penna fa meno strada: le righe
                in croce sono piu' corte di quelle dritte. */
             metriZero: zero.metri, metriQ: q.metri };
  }, QUADRATO);
  ok('le righe seguono l\'angolo chiesto',
     r.zero === 0 && r.no === 90 && r.q === 45,
     r.zero + '°, ' + r.no + '°, ' + r.q + '°');

  /* ============ I. LA PORTA DELL'UTENTE: MIRA E CLIC ============
     Il motore qui sopra non sa niente dell'interfaccia. Questa parte prova
     il gesto che l'utente ha disegnato: pulsante, finestrella, il puntatore
     che anticipa, il clic che disegna. */
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
<path fill="none" stroke="#1d1d1b" d="M5 5 L35 5 L35 35 L5 35 Z"/></svg>`;

  /* Da coordinate del FILE a pixel sullo schermo, passando per la matrice
     della tela: si porta dietro lo zoom e lo scorrimento. */
  const suTela = (p) => page.evaluate((p) => {
    const m = document.getElementById('ed-svg').getScreenCTM();
    const q = new DOMPoint(p.x, p.y).matrixTransform(m);
    return { x: q.x, y: q.y };
  }, p);

  await page.evaluate((svg) => {
    Artwork.load(svg, 'quadrato.svg');
    /* IL DISEGNO SI METTE IN UN ANGOLO, e non e' un vezzo della scena: un
       disegno che riempie tutto il foglio sta nello stesso posto sia che il
       riempimento erediti la mappa del padre sia che si adatti al foglio per
       conto suo. Cioe' il difetto piu' facile da fare qui dentro non si
       manifesterebbe. In un angolo, i due posti sono due. */
    Artwork.collocaA({ x: 20, y: 20, w: 50, h: 50 });
    document.querySelector('.tab[data-tab="editor"]').click();
  }, SVG);
  await page.waitForTimeout(500);

  r = await page.evaluate(() => {
    document.getElementById('ed-riempi').click();
    return {
      acceso: document.getElementById('ed-riempi').classList.contains('attivo'),
      pannello: !document.getElementById('ed-riempi-pannello').hidden
    };
  });
  ok('il pulsante accende il riempimento e apre la finestrella',
     r.acceso && r.pannello);

  const dentro = await suTela({ x: 20, y: 20 });
  await page.mouse.move(dentro.x, dentro.y);
  await page.waitForTimeout(250);
  r = await page.evaluate(() => ({
    /* Si contano i PUNTI e non le polilinee: di serie il tipo e' la
       serpentina, che di polilinee ne fa una sola -- contarle direbbe «una
       riga» di un riempimento da diciotto metri. */
    righe: Array.prototype.reduce.call(
      document.querySelectorAll('.ed-riempi-ante'),
      (n, p) => n + p.points.numberOfItems, 0),
    conto: document.getElementById('riem-conto').textContent,
    nota: document.getElementById('riem-nota').textContent
  }));
  ok('il puntatore ANTICIPA il riempimento della regione sotto di se`',
     r.righe > 40, r.righe + ' punti di anteprima');
  /* Metri e minuti PRIMA del clic: e' la cosa che toglie la brutta sorpresa
     del foglio che impiega un'ora. */
  ok('e la finestrella dice metri, alzate e minuti prima del clic',
     /m di penna/.test(r.conto) && /alzat/.test(r.conto) && /minut|meno di un/.test(r.conto),
     r.conto);
  ok('e dice che cosa vuol dire quel passo per la penna montata',
     /tratto della penna/.test(r.nota), r.nota);

  const prima = await page.evaluate(() => Artwork.livelli().length);
  await page.mouse.click(dentro.x, dentro.y);
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    const l = Artwork.livelli();
    const figlio = l.filter((x) => x.padre)[0];
    const padre = l.filter((x) => !x.padre)[0];
    return {
      quanti: l.length,
      figlio: figlio ? figlio.id : null,
      padre: padre ? padre.id : null,
      diChi: figlio ? figlio.padre : null,
      prima: figlio && padre ? l.indexOf(figlio) < l.indexOf(padre) : false,
      scelto: Artwork.sceltoId(),
      tratti: figlio ? figlio.tratti : 0
    };
  });
  ok('il clic disegna il riempimento', r.quanti === prima + 1 && r.tratti > 0,
     r.quanti + ' livelli, ' + r.tratti + ' tratti nel figlio');
  ok('e nasce come SOTTOLIVELLO del disegno che riempie',
     r.diChi === r.padre, 'padre ' + r.diChi);
  /* L'elenco E` l'ordine di stampa, e il contorno deve passare per ultimo:
     i capi del tratteggio gli si infilano sotto. */
  ok('e sta PRIMA del padre, perche` il contorno si stampa per ultimo', r.prima);
  ok('la scelta resta sul disegno, non salta sul riempimento',
     r.scelto === r.padre, 'scelto ' + r.scelto);

  /* IL RIEMPIMENTO STA SOPRA AL SUO DISEGNO, non da un'altra parte: e' il
     difetto piu' facile da fare qui, perche' un livello nuovo di solito si
     adatta al foglio per conto suo. */
  r = await page.evaluate(() => {
    const dentroA = (a, b) => a.x >= b.x - 0.6 && a.y >= b.y - 0.6 &&
      a.x + a.w <= b.x + b.w + 0.6 && a.y + a.h <= b.y + b.h + 0.6;
    const l = Artwork.livelli();
    const f = l.filter((x) => x.padre)[0];
    const p = l.filter((x) => !x.padre)[0];
    const B = (id) => Artwork.riquadroDi ? Artwork.riquadroDi(id) : null;
    Artwork.seleziona(f.id); const rf = Artwork.riquadro();
    Artwork.seleziona(p.id); const rp = Artwork.riquadro();
    Artwork.seleziona(p.id);
    return { ok: dentroA(rf, rp), rf, rp };
  });
  ok('e cade SOPRA al disegno, non da un\'altra parte', r.ok,
     'figlio ' + JSON.stringify(r.rf) + ' dentro a ' + JSON.stringify(r.rp));

  /* FUORI DAL CONTORNO NON SI RIEMPIE: quella regione tocca il bordo, cioe'
     e' il fuori, e riempirla vorrebbe dire allagare il foglio. */
  await page.evaluate(() => {
    window.__ultimoGuaio = '';
    Log.ascolta(function (r) { window.__ultimoGuaio = r.text; });
  });
  /* DENTRO all'argine ma FUORI dal quadrato: e` la regione che tocca il
     bordo, cioe` il fuori del disegno. Cliccare oltre l'argine sarebbe
     un'altra cosa -- li` non c'e` nessuna regione -- e proverebbe un altro
     ramo, non questo. */
  const fuori = await suTela({ x: 3.8, y: 20 });
  await page.mouse.move(fuori.x, fuori.y);
  await page.waitForTimeout(200);
  const quantiPrima = await page.evaluate(() => Artwork.livelli().length);
  await page.mouse.click(fuori.x, fuori.y);
  await page.waitForTimeout(250);
  r = await page.evaluate(() => ({
    quanti: Artwork.livelli().length,
    detto: window.__ultimoGuaio || ''
  }));
  ok('fuori dal contorno il clic non riempie niente',
     r.quanti === quantiPrima, r.quanti + ' livelli');
  /* E LO DICE. Non riempire e tacere e` indistinguibile da un clic che non
     ha funzionato: il programma deve dire perche`, se no la prossima cosa
     che l'utente prova e` cliccare piu` forte. */
  ok('e il programma dice perche`', /spazio chiuso/.test(r.detto), r.detto);

  /* BUTTANDO IL DISEGNO SE NE VA ANCHE IL RIEMPIMENTO: un tratteggio senza
     il suo contorno e' una macchia a mezz'aria sul foglio. */
  r = await page.evaluate(() => {
    const p = Artwork.livelli().filter((x) => !x.padre)[0];
    Artwork.rimuovi(p.id);
    return Artwork.livelli().length;
  });
  ok('buttando il disegno se ne va anche il suo riempimento', r === 0,
     r + ' livelli rimasti');

  if (errori.length) {
    console.log('\nerrori di pagina:');
    errori.forEach((e) => console.log('  ' + e));
    guai += errori.length;
  }
  console.log('\n' + (guai ? guai + ' guai' : 'tutto a posto'));
  await browser.close();
  process.exit(guai ? 1 : 0);
})();
