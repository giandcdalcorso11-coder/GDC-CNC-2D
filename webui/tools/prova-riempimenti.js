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

  /* ============ H2. GLI ALTRI TIPI DI TRATTEGGIO ============
     Sei tipi, e ognuno e' una resa diversa a parita' di forma. Quello che si
     controlla qui e' che ognuno faccia la cosa che SOLO lui fa -- se no sono
     sei nomi per la stessa riga -- e che nessuno entri nel buco. */
  r = await page.evaluate((d) => {
    const st = Riempi.stampino(d);
    const reg = Riempi.regioneIn(st, { x: 15, y: 45 });
    const buco = (t) => {
      let dentro = 0;
      t.polilinee.forEach((poli) => {
        for (let i = 1; i < poli.length; i++) {
          for (let k = 0; k <= 30; k++) {
            const x = poli[i - 1].x + (poli[i].x - poli[i - 1].x) * k / 30;
            const y = poli[i - 1].y + (poli[i].y - poli[i - 1].y) * k / 30;
            if (x > 26 && x < 34 && y > 16 && y < 24) dentro++;
          }
        }
      });
      return dentro;
    };
    const fa = (tipo) => {
      const t = Riempi.tratteggia(st, reg, { tipo, passo: 2, angolo: 0 });
      const p0 = t.polilinee[0] || [];
      const capo = p0.length ? p0[0] : null, coda = p0.length ? p0[p0.length - 1] : null;
      return { metri: t.metri * 1000, alzate: t.alzate, buco: buco(t),
               pezzi: t.polilinee.length,
               nodi: p0.length,
               chiuso: !!capo && Math.hypot(capo.x - coda.x, capo.y - coda.y) < 0.5 };
    };
    /* Quanti capi di punto finiscono FUORI dalla regione: un punto a cavallo
       del bordo e` una sbavatura che sulla carta si vede, e che
       l'anteprima a schermo non fa notare perche` e` grande due decimi. */
    const sbavature = (function () {
      const t = Riempi.tratteggia(st, reg, { tipo: 'punti', passo: 2, angolo: 0 });
      let fuori = 0;
      t.polilinee.forEach((p) => p.forEach((q) => {
        if (Riempi.regioneIn(st, q) !== reg) fuori++;
      }));
      return fuori;
    })();
    return { dritto: fa('tratteggio'), serp: fa('serpentina'),
             croce: fa('incrociato'), conc: fa('concentrico'),
             spir: fa('spirale'), punti: fa('punti'), sbavature: sbavature };
  }, CIAMBELLA);

  /* L'incrociato e' DUE passate: la penna fa circa il doppio di strada. E`
     il modo giusto di scurire -- dimezzare il passo costerebbe uguale ma
     rischierebbe la macchia. */
  ok('l\'incrociato fa due passate, non una piu` fitta',
     r.croce.metri > r.dritto.metri * 1.7 && r.croce.metri < r.dritto.metri * 2.3,
     r.croce.metri.toFixed(0) + ' mm contro ' + r.dritto.metri.toFixed(0));
  /* I concentrici seguono la forma: su un anello sono anelli, cioe' pochi
     pezzi lunghi invece di tante righe corte. */
  /* Un anello e' CHIUSO e ha pochi nodi: su una forma squadrata ne bastano
     otto. Un controllo che ne pretendesse tanti starebbe misurando il
     rumore dello stampino, non la forma -- e si accenderebbe il giorno in
     cui i nodi allineati si tolgono, che e' un miglioramento. */
  ok('i concentrici fanno pochi anelli CHIUSI invece di tante righe',
     r.conc.pezzi > 0 && r.conc.pezzi < r.dritto.pezzi / 2 &&
     r.conc.chiuso && r.conc.nodi >= 4 && r.conc.nodi < 40,
     r.conc.pezzi + ' anelli da ' + r.conc.nodi + ' nodi, contro ' +
     r.dritto.pezzi + ' righe');
  /* La spirale e' quegli stessi anelli uniti: meno alzate, stessa strada. */
  ok('la spirale e` gli stessi anelli, con meno alzate',
     r.spir.alzate < r.conc.alzate &&
     Math.abs(r.spir.metri - r.conc.metri) < r.conc.metri * 0.35,
     r.conc.alzate + ' alzate -> ' + r.spir.alzate);
  /* I punti sono trattini corti: un punto di lunghezza zero il G-code lo
     scrive e la macchina non lo esegue. */
  ok('i punti sono trattini corti, uno per alzata',
     r.punti.alzate > 20 && r.punti.nodi === 2 &&
     r.punti.metri / r.punti.alzate < 1,
     r.punti.alzate + ' punti da ' +
     (r.punti.metri / Math.max(1, r.punti.alzate)).toFixed(2) + ' mm');
  ok('e nessun punto sbava fuori dalla forma', r.sbavature === 0,
     r.sbavature + ' capi di punto fuori');
  ok('e nessuno dei sei entra nel buco della ciambella',
     r.dritto.buco + r.serp.buco + r.croce.buco + r.conc.buco +
     r.spir.buco + r.punti.buco === 0,
     [r.dritto, r.serp, r.croce, r.conc, r.spir, r.punti]
       .map((x) => x.buco).join(' '));

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

  /* ====== IL POPUP NON STA IN MEZZO FINCHE' NON SERVE ======
     SI GUARDA LO SCHERMO, NON L'ATTRIBUTO. Il controllo qui sotto esisteva
     gia' e leggeva `.hidden`: l'attributo era giusto, e intanto l'utente
     vedeva la finestrella aperta appena entrava nella tab. Il motivo stava
     nel CSS -- `.ed-pannello { display: flex }` batte `[hidden]` -- e un
     controllo che legge l'attributo non puo' vederlo, per costruzione.
     Dal 2026-11-24 si misura `display`, che e' quello che l'occhio vede. */
  r = await page.evaluate(() => {
    const p = document.getElementById('ed-riempi-pannello');
    return { attr: p.hidden === true,
             visto: getComputedStyle(p).display !== 'none' };
  });
  ok('entrando nell’editor la finestrella del riempimento non si vede',
     r.attr && !r.visto,
     'hidden ' + r.attr + ', sullo schermo ' + (r.visto ? 'c’è' : 'non c’è'));

  r = await page.evaluate(() => {
    document.getElementById('ed-riempi').click();
    const p = document.getElementById('ed-riempi-pannello');
    return {
      acceso: document.getElementById('ed-riempi').classList.contains('attivo'),
      pannello: !p.hidden,
      visto: getComputedStyle(p).display !== 'none'
    };
  });
  ok('il pulsante accende il riempimento e apre la finestrella',
     r.acceso && r.pannello && r.visto,
     'acceso ' + r.acceso + ', sullo schermo ' + r.visto);
  /* ====== LA VIA D'USCITA RESTA APERTA MENTRE SI RIEMPIE ======
     Col riempimento acceso il clic ha un solo significato, e per garantirlo
     `giu()` se ne andava PRIMA di arrivare al tasto centrale: la tela
     diventava immobile, e per tornare a vedere il resto del disegno bisognava
     spegnere lo strumento. Segnalato dall'utente il 2026-11-24.
     Si guarda il `viewBox` della tela, che e' lo sguardo reso visibile; e si
     controlla anche che quel trascinamento NON abbia riempito niente,
     perche' «la tela si muove» e «il clic non riempie» sono due cose, e una
     correzione che tenesse solo la prima sarebbe peggio del difetto. */
  /* IL PUNTO DEVE STARE DENTRO LA VISTA, non solo dentro al foglio: in
     questa scena la tela mostra fino a ~38 mm, e un trascinamento che
     comincia a 45 non tocca nemmeno l'elemento. Il primo giro di questo
     controllo falliva proprio cosi', e la correzione funzionava gia'. */
  const centro = await suTela({ x: 20, y: 20 });
  r = await page.evaluate(() => ({
    vista: document.getElementById('ed-svg').getAttribute('viewBox'),
    livelli: (Artwork.livelli() || []).length
  }));
  await page.mouse.move(centro.x, centro.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(centro.x + 70, centro.y + 45, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(200);
  const dopo = await page.evaluate(() => ({
    vista: document.getElementById('ed-svg').getAttribute('viewBox'),
    livelli: (Artwork.livelli() || []).length,
    acceso: document.getElementById('ed-riempi').classList.contains('attivo')
  }));
  ok('col riempimento acceso il tasto centrale sposta ancora lo sguardo',
     dopo.vista !== r.vista, r.vista + '  ->  ' + dopo.vista);
  ok('e quel trascinamento non riempie niente',
     dopo.livelli === r.livelli && dopo.acceso,
     r.livelli + ' livelli prima, ' + dopo.livelli + ' dopo');


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
  /* ====== L'ANNULLA DEL RIEMPIMENTO ======
     Segnalato dall'utente il 2026-11-24: «Ctrl+Z non funziona coi
     riempimenti». Non era una dimenticanza da una riga. La storia
     dell'annulla fotografa le FORME DEL LIVELLO ATTIVO, e un riempimento
     quelle non le tocca: fa nascere un livello figlio. Una fotografia del
     padre non sa niente del figlio, quindi chiamare `segna()` avrebbe
     acceso il pulsante senza disfare niente -- peggio del difetto.
     SI CONTANO I LIVELLI, non lo stato del pulsante: un annulla che si
     accende e non toglie niente e' esattamente il modo in cui questo
     difetto si sarebbe ripresentato travestito da correzione. */
  r = await page.evaluate(() => {
    const quanti = () => (Artwork.livelli() || []).length;
    const dopoRiempimento = quanti();
    document.getElementById('ed-annulla').click();
    const dopoAnnulla = quanti();
    document.getElementById('ed-rifai').click();
    const dopoRifai = quanti();
    const l = Artwork.livelli() || [];
    const figlio = l.filter((x) => x.padre)[0];
    return { dopoRiempimento: dopoRiempimento, dopoAnnulla: dopoAnnulla,
             dopoRifai: dopoRifai,
             tratti: figlio ? figlio.tratti : 0,
             padre: figlio ? figlio.padre : null };
  });
  ok('l’annulla toglie il riempimento, non solo il pulsante',
     r.dopoAnnulla === r.dopoRiempimento - 1,
     r.dopoRiempimento + ' livelli, dopo l’annulla ' + r.dopoAnnulla);
  /* E RIFARLO LO RIMETTE DAVVERO, con le sue righe: il livello rinasce con
     un id nuovo, e se il passo non si riscrivesse con quello un secondo
     annulla cercherebbe di togliere un livello che non esiste piu'. */
  ok('e il rifai lo rimette, col suo tratteggio e sotto lo stesso padre',
     r.dopoRifai === r.dopoRiempimento && r.tratti > 0 && r.padre !== null,
     r.dopoRifai + ' livelli, ' + r.tratti + ' tratti');
  /* E UN SECONDO GIRO, che e' il caso in cui l'id vecchio farebbe danno. */
  r = await page.evaluate(() => {
    const quanti = () => (Artwork.livelli() || []).length;
    document.getElementById('ed-annulla').click();
    const giu = quanti();
    document.getElementById('ed-rifai').click();
    return { giu: giu, su: quanti() };
  });
  ok('e il secondo giro di annulla e rifai fa la stessa cosa',
     r.giu === r.su - 1, 'annullato ' + r.giu + ', rifatto ' + r.su);


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

  /* ============ L. IL RIEMPIMENTO SEGUE IL CONTORNO ============
     Spostare un nodo cambia la FORMA: non esiste trasformazione che faccia
     seguire un tratteggio, va rigenerato dalla ricetta. E va rigenerato al
     RILASCIO, non mentre si trascina. */
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate((svg) => {
    Artwork.load(svg, 'quadrato.svg');
    Artwork.collocaA({ x: 20, y: 20, w: 50, h: 50 });
    document.querySelector('.tab[data-tab="editor"]').click();
  }, SVG);
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById('ed-riempi').click(); });
  const mira = await suTela({ x: 20, y: 20 });
  await page.mouse.move(mira.x, mira.y);
  await page.waitForTimeout(250);
  await page.mouse.click(mira.x, mira.y);
  await page.waitForTimeout(300);
  /* Si spegne il riempimento: adesso si MODIFICA il contorno, ed e' il clic
     dell'editor che serve, non quello che riempie. */
  await page.evaluate(() => { document.getElementById('ed-riempi').click(); });

  const quadroPrima = await page.evaluate(() => {
    const f = Artwork.livelli().filter((x) => x.padre)[0];
    Artwork.seleziona(f.id);
    const r = Artwork.riquadro();
    Artwork.seleziona(Artwork.livelli().filter((x) => !x.padre)[0].id);
    return r;
  });

  /* Si prende la forma e si trascina il nodo in alto a destra (35,5) verso
     fuori: il quadrato diventa piu' largo, e il riempimento deve seguirlo. */
  await page.evaluate(() => Editor.scegliForma(0));
  await page.waitForTimeout(200);
  const nodo = await suTela({ x: 35, y: 5 });
  const meta = await suTela({ x: 48, y: 5 });
  await page.mouse.move(nodo.x, nodo.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(nodo.x + (meta.x - nodo.x) * i / 6, nodo.y);
  }
  r = await page.evaluate(() => ({
    /* A META` GESTO: il riempimento e` ancora quello di prima e la riga lo
       dice. Rigenerare a ogni movimento vorrebbe dire un editor che non sta
       dietro alla mano. */
    segnato: Artwork.livelli().filter((x) => x.padre)[0].daRifare,
    badge: document.querySelectorAll('.liv-rifare').length,  // due elenchi, due etichette
    /* NON BASTA CHE L'ETICHETTA CI SIA: deve stare dentro alla sua riga.
       Una riga di livelli e` stretta e piena di segni, e una cosa che
       finisce oltre il bordo e` scritta per nessuno. */
    dentro: (function () {
      /* Le etichette sono due -- l'elenco della tab Disegno e quello
         dell'editor -- e quella che conta e` quella che si VEDE adesso: il
         nodo lo si trascina qui, nell'editor. */
      return [].slice.call(document.querySelectorAll('.liv-rifare')).some(function (b) {
        const e = b.getBoundingClientRect();
        const riga = b.parentElement.getBoundingClientRect();
        return e.width > 10 && e.x >= riga.x - 1 &&
               e.x + e.width <= riga.x + riga.width + 1;
      });
    })()
  }));
  ok('mentre si trascina, il riempimento e` segnato «da rifare»',
     r.segnato === true && r.badge >= 1,
     'segnato ' + r.segnato + ', ' + r.badge + ' etichette');
  ok('e l\'etichetta sta dentro alla sua riga, dove si legge', r.dentro);

  await page.mouse.up();
  await page.waitForTimeout(400);
  r = await page.evaluate(() => {
    const f = Artwork.livelli().filter((x) => x.padre)[0];
    Artwork.seleziona(f.id);
    const q = Artwork.riquadro();
    Artwork.seleziona(Artwork.livelli().filter((x) => !x.padre)[0].id);
    return { segnato: f.daRifare, q: q, badge: document.querySelectorAll('.liv-rifare').length };
  });
  ok('al rilascio si rifa` da solo, e il segno sparisce',
     r.segnato === false && r.badge === 0);
  ok('e il riempimento nuovo e` piu` largo di prima, come il contorno',
     r.q.w > quadroPrima.w + 2,
     'da ' + quadroPrima.w.toFixed(1) + ' a ' + r.q.w.toFixed(1) + ' mm');

  /* ============ M. SE RICALCOLANDO PERDE, NON BUTTA NIENTE ============
     Si toglie un lato: il contorno si apre, il colore scapperebbe fuori. Il
     riempimento di prima resta, segnato, e cosi` segnato la stampa non
     parte. */
  const larghPrima = r.q.w;
  const trattiPrima = await page.evaluate(() =>
    Artwork.livelli().filter((x) => x.padre)[0].tratti);
  await page.evaluate(() => {
    /* Si sceglie un tratto e lo si toglie: e` il gesto «Togli tratto». */
    Editor.scegliForma(0);
  });
  const sulLato = await suTela({ x: 20, y: 5 });
  await page.mouse.click(sulLato.x, sulLato.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  r = await page.evaluate(() => {
    const f = Artwork.livelli().filter((x) => x.padre)[0];
    if (!f) return { c: false };
    Artwork.seleziona(f.id);
    const q = Artwork.riquadro();
    Artwork.seleziona(Artwork.livelli().filter((x) => !x.padre)[0].id);
    return { c: true, segnato: f.daRifare, w: q.w, tratti: f.tratti,
             badge: document.querySelectorAll('.liv-rifare').length };
  });
  /* Si contano i TRATTI e non la larghezza: un riempimento svuotato tiene il
     rettangolo del padre -- cioe' misurato a larghezza sembrerebbe ancora
     li' -- ma di righe non ne ha piu' nessuna. La larghezza sarebbe un
     controllo che guarda la cosa sbagliata. */
  ok('aprendo il contorno il riempimento di prima NON si butta',
     r.c && r.tratti === trattiPrima && r.tratti > 1,
     r.tratti + ' tratti contro ' + trattiPrima);
  /* Le etichette sono due perche' gli elenchi sono due -- quello della tab
     Disegno e quello dell'editor -- e devono dire la stessa cosa. */
  ok('ma resta segnato «da rifare»', r.segnato === true && r.badge >= 1,
     r.badge + ' etichette');

  /* E COSI` SEGNATO LA STAMPA NON PARTE: un foglio stampato da una ricetta
     vecchia e` il genere di bugia che si scopre a penna in mano. */
  r = await page.evaluate(() => {
    window.__detto = '';
    Log.ascolta(function (x) { if (x.kind === 'err') window.__detto = x.text; });
    Popup.avviaStampa();
    return { aperto: !document.getElementById('modal').hidden, detto: window.__detto };
  });
  ok('e con un riempimento da rifare la stampa non parte',
     !r.aperto && /da rifare/.test(r.detto), r.detto.slice(0, 70));

  /* ============ N. LA PORTA ALL'INGROSSO ============
     Un logo importato con quaranta forme piene sarebbero quaranta clic. Qui
     si riempie tutto il livello in un colpo, e a dire che cosa e' dentro e
     che cosa e' un buco non c'e' nessun clic: c'e' la regola pari-dispari. */
  const CIAMBELLA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50">
<path fill="none" stroke="#1d1d1b" d="M5 5 L45 5 L45 45 L5 45 Z"/>
<path fill="none" stroke="#1d1d1b" d="M20 20 L30 20 L30 30 L20 30 Z"/></svg>`;

  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate((svg) => {
    Artwork.load(svg, 'ciambella.svg');
    Artwork.collocaA({ x: 20, y: 20, w: 50, h: 50 });
    document.querySelector('.tab[data-tab="editor"]').click();
  }, CIAMBELLA_SVG);
  await page.waitForTimeout(500);
  r = await page.evaluate(() => {
    document.getElementById('ed-riempi').click();
    document.getElementById('riem-passo').value = '1';
    document.getElementById('riem-tutto').click();
    const l = Artwork.livelli();
    const f = l.filter((x) => x.padre)[0];
    /* I tratti del figlio in millimetri del foglio: e` li` che si guarda se
       il buco e` rimasto vuoto, perche` e` li` che la penna andra`. */
    const miei = [];
    State.data.art.forEach((poli, i) => {
      if (f && State.data.artDi[i] === f.id) miei.push(poli);
    });
    let nelBuco = 0;
    miei.forEach((poli) => {
      for (let i = 1; i < poli.length; i++) {
        for (let k = 0; k <= 20; k++) {
          const x = poli[i - 1].x + (poli[i].x - poli[i - 1].x) * k / 20;
          const y = poli[i - 1].y + (poli[i].y - poli[i - 1].y) * k / 20;
          if (x > 40 && x < 50 && y > 40 && y < 50) nelBuco++;
        }
      }
    });
    return { livelli: l.length, figli: l.filter((x) => x.padre).length,
             tratti: f ? f.tratti : 0, tutto: f ? !!f.ricetta.tutto : false,
             nelBuco: nelBuco, quanti: miei.length };
  });
  ok('«Riempi tutto il livello» riempie in un colpo',
     r.figli === 1 && r.tratti > 10,
     r.tratti + ' tratti in ' + r.figli + ' sottolivello');
  /* IL BUCO RESTA VUOTO. E` tutta la differenza fra la regola pari-dispari e
     «riempi tutto quello che e` chiuso»: senza, una ciambella esce come un
     disco. */
  ok('e il buco della ciambella resta vuoto', r.nelBuco === 0,
     r.nelBuco + ' punti dentro al buco');
  ok('e la ricetta si ricorda che era all\'ingrosso', r.tutto);

  /* E SI RIFA` ALL'INGROSSO: cambiando il contorno, quali spazi siano
     «dentro» va RIDECISO, non ricordato. */
  await page.evaluate(() => Editor.scegliForma(0));
  const nodoC = await suTela({ x: 45, y: 5 });
  const finC = await suTela({ x: 49, y: 5 });
  await page.mouse.move(nodoC.x, nodoC.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(nodoC.x + (finC.x - nodoC.x) * i / 6, nodoC.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  r = await page.evaluate(() => {
    const f = Artwork.livelli().filter((x) => x.padre)[0];
    return { c: !!f, segnato: f ? f.daRifare : true, tratti: f ? f.tratti : 0 };
  });
  ok('il riempimento all\'ingrosso si rifa` come all\'ingrosso',
     r.c && r.segnato === false && r.tratti > 10,
     r.tratti + ' tratti, segnato ' + r.segnato);

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
