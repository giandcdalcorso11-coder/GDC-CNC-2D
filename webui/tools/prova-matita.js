/* Il collaudo della MATITA: il tratto fatto a mano con la Apple Pencil.
 *
 * Due meta', e provano due cose diverse.
 *
 * LA PRIMA META' E' ARITMETICA (`js/matita.js`): punti inventati entrano,
 * nodi escono. I punti sono fatti qui a mano -- una riga dritta tremolante,
 * un cerchio fatto a mano, un ricciolo che torna al suo inizio -- perche' la
 * cosa da controllare non e' «esce una forma»: e' che il tremolio si TOLGA
 * senza che il tratto si SPOSTI. Sono due difetti opposti e una media mobile
 * fatta male li fa entrambi: in un verso solo addolcisce e sposta, due volte
 * nello stesso verso addolcisce e sposta il doppio.
 *
 * LA SECONDA META' E' IL GESTO, con eventi di PENNA veri (`pointerType:
 * pen`) e di tocco veri consegnati dal browser, non costruiti a mano. Qui la
 * cosa da controllare e' la MANO APPOGGIATA: il palmo tocca il vetro PRIMA
 * della punta, quindi la scena giusta fa appoggiare prima il palmo e poi la
 * penna -- al contrario non si manifesta il difetto, perche' un palmo che
 * arriva dopo e' facile da ignorare ed e' il caso che non capita mai.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-matita.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
<path fill="none" stroke="#1d1d1b" d="M5 5 L35 5 L35 35 L5 35 Z"/></svg>`;

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  /* Un iPad: schermo largo, puntatore grosso, tocco disponibile. La penna
     non dipende da questo contesto -- gli eventi di penna si consegnano
     comunque -- ma la MANO APPOGGIATA si', e quella e' la meta' che conta. */
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

  /* ================= LA PENNA, come la manda il vetro =================
     `pointerType: 'pen'` e non un evento finto costruito con
     `new PointerEvent`: la differenza e' che qui passa dal browser, con la
     cattura del puntatore e l'ordine vero degli eventi -- cioe' le due cose
     che nella matita possono rompersi. */
  const penna = async (tipo, p) => cdp.send('Input.dispatchMouseEvent', {
    type: tipo, x: p.x, y: p.y, button: 'left',
    buttons: tipo === 'mouseReleased' ? 0 : 1,
    clickCount: 1, pointerType: 'pen', force: 0.5
  });

  /* Un tratto di penna lungo una lista di punti dello schermo. */
  async function scrivi(punti) {
    await penna('mousePressed', punti[0]);
    for (let i = 1; i < punti.length; i++) await penna('mouseMoved', punti[i]);
    await penna('mouseReleased', punti[punti.length - 1]);
  }

  const dito = (tipo, punti) =>
    cdp.send('Input.dispatchTouchEvent', { type: tipo, touchPoints: punti });

  /* =====================================================================
     A. L'ARITMETICA: dai punti della mano ai nodi della forma
     ===================================================================== */

  /* UNA RIGA DRITTA TREMOLANTE. Trecento punti da (0,0) a (300,0) con un
     tremolio di due unita' su e giu': e' quello che fa una mano, ed e'
     quello che va tolto. */
  r = await page.evaluate(() => {
    /* IL TREMOLIO E' ALTA FREQUENZA: su e giu' di due unita' da un punto
       all'altro. Quello che una mano fa e che va tolto. Niente onde lente
       mescolate dentro -- quelle sono il DISEGNO, e si controllano a parte,
       due controlli piu' sotto. */
    const punti = [];
    for (let i = 0; i <= 300; i++) punti.push({ x: i, y: (i % 2 ? 2 : -2) });
    const opt = { unitaPerPx: 1, mmPerUnita: 1, chiudi: false };
    const scarto = (t) => {
      /* Quanto si scosta dalla riga y=0 la forma che ne e' venuta, misurata
         sulla polilinea appiattita: i nodi da soli non bastano, perche' fra
         due nodi c'e' una curva.
         SI GUARDA IN MEZZO, dal decimo al nono decimo. I due capi sono
         rimessi esatti dov'era la mano -- di proposito, perche' sono i due
         punti che la mano ha messo apposta -- quindi la' il tremolio
         dell'ultimo punto c'e' ancora, e misurandolo si misurerebbe quella
         scelta invece dell'addolcimento. */
      let max = 0;
      Tracciato.appiattisci(t.forma, 0.05).forEach((poli) => {
        poli.forEach((q) => {
          if (q.x > 30 && q.x < 270) max = Math.max(max, Math.abs(q.y));
        });
      });
      return max;
    };
    const a = Matita.tratto(punti, Object.assign({ fermezza: 0 }, opt));
    const b = Matita.tratto(punti, Object.assign({ fermezza: 6 }, opt));
    return { crudo: scarto(a), fermo: scarto(b),
             nodiCrudi: a.nodi, nodiFermi: b.nodi };
  });
  ok('la mano ferma TOGLIE il tremolio della riga', r.fermo < r.crudo / 3,
     'da ' + r.crudo.toFixed(2) + ' a ' + r.fermo.toFixed(2) + ' unitaà');
  /* L'altra metà dello stesso interruttore: a zero il tratto resta quello
     della mano. Senza questo controllo, una matita che addolcisce sempre
     passerebbe quello di sopra. */
  ok('e a zero lo LASCIA, perché è il tratto che la mano ha fatto',
     r.crudo > 1.5, 'scarto ' + r.crudo.toFixed(2) + ' unità');
  ok('e i nodi diventano pochi: un tratto si corregge, non si rifaà',
     r.nodiFermi < 40 && r.nodiFermi < r.nodiCrudi / 2,
     r.nodiCrudi + ' nodi a 0, ' + r.nodiFermi + ' a 6');

  /* L'ALTRA META' DELLA MANOPOLA, e la piu' facile da perdere di vista: la
     mano ferma deve togliere il TREMOLIO, non il DISEGNO. Un'onda lenta --
     ampia dieci unita', lunga sessanta punti, cioe' una curva che la mano ha
     fatto di proposito -- deve restare dov'e' anche a mano ferma alta. Senza
     questo controllo, una matita che spiana tutto passerebbe quello di sopra
     a pieni voti: il tremolio sparirebbe insieme a tutto il resto. */
  r = await page.evaluate(() => {
    const punti = [];
    for (let i = 0; i <= 300; i++) {
      punti.push({ x: i, y: 10 * Math.sin(i / 60 * 2 * Math.PI) });
    }
    const ampiezza = (t) => {
      let max = 0;
      Tracciato.appiattisci(t.forma, 0.05).forEach((poli) => {
        poli.forEach((q) => { max = Math.max(max, Math.abs(q.y)); });
      });
      return max;
    };
    return ampiezza(Matita.tratto(punti,
      { unitaPerPx: 1, mmPerUnita: 1, fermezza: 8, chiudi: false }));
  });
  ok('e NON toglie il disegno: un\u2019onda lenta resta dov\u2019\u00e8',
     r > 8.5, 'ampia ' + r.toFixed(2) + ' di 10');

  /* IL CERCHIO FATTO A MANO, che e' il controllo della media AVANTI E
     INDIETRO. Una media mobile in un verso solo RITARDA: il tratto esce
     girato indietro rispetto alla mano, e su un cerchio il ritardo si vede
     come una spirale che non si chiude. Rifatta al contrario il ritardo si
     annulla, perche' il secondo passaggio sposta esattamente dall'altra
     parte.
     SI MISURA LO SFASAMENTO, cioe' di quanti gradi ogni punto e' girato
     rispetto a quello che la mano aveva fatto -- non il raggio. Il raggio
     cala in ogni caso, perche' addolcire una curva la stringe un po': e'
     il prezzo della manopola, non un difetto, e misurarlo non distingue i
     due modi. Il ritardo si'. */
  r = await page.evaluate(() => {
    const punti = [];
    for (let i = 0; i <= 360; i += 2) {
      const a = i * Math.PI / 180;
      const rr = 100 + (i % 4 ? 1.5 : -1.5);
      punti.push({ x: 150 + rr * Math.cos(a), y: 150 + rr * Math.sin(a) });
    }
    const crudi = Matita.pulisci(punti, 0.5);
    const ang = (q) => Math.atan2(q.y - 150, q.x - 150);
    /* Di quanti gradi, in media, il tratto uscito e' girato indietro
       rispetto a quello entrato. I capi si saltano: quelli sono rimessi
       esatti per costruzione. */
    const sfasa = (lista) => {
      let s = 0, n = 0;
      for (let i = 5; i < lista.length - 5; i++) {
        let d = ang(lista[i]) - ang(crudi[i]);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        s += d; n++;
      }
      return s / n * 180 / Math.PI;
    };
    const a = Matita.alfa(8);
    const unVerso = (() => {
      let x = crudi[0].x, y = crudi[0].y, out = [crudi[0]];
      for (let i = 1; i < crudi.length; i++) {
        x = crudi[i].x * a + x * (1 - a); y = crudi[i].y * a + y * (1 - a);
        out.push({ x: x, y: y });
      }
      return out;
    })();
    const raggio = (lista) => {
      let s = 0;
      lista.forEach((q) => { s += Math.hypot(q.x - 150, q.y - 150); });
      return s / lista.length;
    };
    return { doppio: sfasa(Matita.addolcisci(crudi, a)), uno: sfasa(unVerso),
             raggio: raggio(Matita.addolcisci(crudi, a)), crudo: raggio(crudi) };
  });
  ok('il tratto addolcito NON ritarda rispetto alla mano',
     Math.abs(r.doppio) < 0.5, 'sfasato di ' + r.doppio.toFixed(2) + '°');
  /* E la prova che quel controllo non passa per caso: la stessa media fatta
     in un verso solo ritarda per davvero. Se un giorno questa riga diventasse
     falsa, vorrebbe dire che la scena non distingue piu' i due modi -- non
     che il codice e' migliorato. */
  ok('e in un verso solo ritarderebbe, ecco perché è doppia',
     r.uno < -3, 'un verso solo: ' + r.uno.toFixed(2) + '°');
  /* Il prezzo, scritto: una curva stretta addolcita si stringe. A mano ferma
     8 su un cerchio da 100, meno del tre per cento. */
  ok('e addolcire stringe la curva di poco, non di tanto',
     r.raggio > r.crudo * 0.97,
     'raggio ' + r.raggio.toFixed(2) + ' contro ' + r.crudo.toFixed(2));

  /* LA CHIUSURA. Un ricciolo che torna all'inizio e' un anello; uno che
     finisce altrove e' una riga. La domanda si decide sui punti CRUDI --
     «la mano e' tornata?» -- e non su quelli addolciti. */
  r = await page.evaluate(() => {
    const giro = (chiudendo) => {
      const punti = [];
      for (let i = 0; i <= (chiudendo ? 360 : 270); i += 5) {
        const a = i * Math.PI / 180;
        punti.push({ x: 50 + 20 * Math.cos(a), y: 50 + 20 * Math.sin(a) });
      }
      return punti;
    };
    const o = { unitaPerPx: 1, mmPerUnita: 1, fermezza: 4, chiudi: true };
    const c = Matita.tratto(giro(true), o);
    const ap = Matita.tratto(giro(false), o);
    const spento = Matita.tratto(giro(true), Object.assign({}, o, { chiudi: false }));
    return { chiuso: c.chiuso, aperto: ap.chiuso, spento: spento.chiuso,
             lung: c.lunghezza };
  });
  ok('un tratto che torna all’inizio si CHIUDE', r.chiuso === true);
  ok('uno che finisce altrove resta aperto', r.aperto === false);
  ok('e la spunta spenta lo lascia aperto comunque', r.spento === false);
  /* La lunghezza in millimetri e' il numero che la finestrella mostra: se
     sbagliasse di un fattore, nessuno lo noterebbe guardando il disegno. */
  /* Il giro di un cerchio da 20 unita' di raggio, in millimetri. La banda e'
     larga perche' qui non si misura la precisione del cerchio -- addolcire
     stringe un po', e i nodi pochi tagliano le curve -- ma l'UNITA': un
     numero in unita' del file o in pixel dello schermo starebbe fuori di un
     fattore, non del tre per cento. Il fattore si controlla esatto sulla riga
     dritta, piu' sotto. */
  ok('la lunghezza è in millimetri del foglio',
     Math.abs(r.lung - 2 * Math.PI * 20) < 8, r.lung.toFixed(1) + ' mm');

  /* UN TOCCO SOLO NON E' UN TRATTO. Appoggiare la punta e staccarla senza
     muoversi capita mentre si cerca il punto da cui partire, e deve non
     fare niente: due nodi nello stesso posto sarebbero un movimento di
     lunghezza zero che il G-code emette e la macchina non esegue. */
  r = await page.evaluate(() => {
    const o = { unitaPerPx: 1, mmPerUnita: 1, fermezza: 4 };
    return {
      uno: Matita.tratto([{ x: 5, y: 5 }], o),
      fermo: Matita.tratto([{ x: 5, y: 5 }, { x: 5.01, y: 5 }, { x: 5, y: 5.01 }], o),
      vuoto: Matita.tratto([], o)
    };
  });
  ok('un tocco solo non diventa un tratto',
     r.uno === null && r.fermo === null && r.vuoto === null);

  /* IL DRITTO RESTA DRITTO, E DI DUE NODI. Una riga tirata a mano, con tutti
     i suoi punti allineati, non ha nessuna ragione di tenerne piu' di due: e
     due nodi, in un tracciato, non possono descrivere nient'altro che un
     segmento. Senza questo controllo, una matita che tiene un nodo ogni tre
     punti passerebbe tutti i controlli di sopra. */
  r = await page.evaluate(() => {
    const punti = [];
    for (let i = 0; i <= 100; i++) punti.push({ x: i * 3, y: 0 });
    const t = Matita.tratto(punti, { unitaPerPx: 1, mmPerUnita: 1, fermezza: 4 });
    let max = 0;
    Tracciato.appiattisci(t.forma, 0.01).forEach((poli) => {
      poli.forEach((q) => { max = Math.max(max, Math.abs(q.y)); });
    });
    /* LA STESSA RIGA CON UN'ALTRA SCALA. Su una riga dritta la lunghezza si
       sa esattamente -- 300 unita' -- quindi qui il fattore dei millimetri si
       controlla per davvero, e non dentro una banda. */
    const scalato = Matita.tratto(punti,
      { unitaPerPx: 1, mmPerUnita: 2.5, fermezza: 4 });
    return { max: max, nodi: t.nodi, lung: t.lunghezza, scalato: scalato.lunghezza };
  });
  ok('una riga tirata a mano resta una riga, e di due nodi',
     r.nodi === 2 && r.max < 0.01,
     r.nodi + ' nodi, scarto ' + r.max.toFixed(4) + ', lunga ' + r.lung.toFixed(1));
  ok('e la lunghezza segue la scala del livello, non le unità del file',
     Math.abs(r.lung - 300) < 0.01 && Math.abs(r.scalato - 750) < 0.03,
     r.lung.toFixed(2) + ' unità × 2,5 = ' + r.scalato.toFixed(2) + ' mm');

  /* LE MANIGLIE SEGUONO LA CURVA. Un quarto di cerchio tenuto a pochi nodi:
     con le maniglie la curva appiattita ripassa sul cerchio della mano; senza
     (cioe' con i nodi uniti da righe dritte) taglierebbe le corde, e su un
     raggio da 100 con nodi a venti gradi la corda sta un paio di unita'
     dentro. E' la differenza fra un tratto e un poligono. */
  r = await page.evaluate(() => {
    const punti = [];
    for (let i = 0; i <= 90; i += 1) {
      const a = i * Math.PI / 180;
      punti.push({ x: 200 * Math.cos(a), y: 200 * Math.sin(a) });
    }
    const t = Matita.tratto(punti, { unitaPerPx: 1, mmPerUnita: 1, fermezza: 2 });
    const n = t.forma.sub[0].nodi;
    let peggio = 0, corda = 0;
    Tracciato.appiattisci(t.forma, 0.01).forEach((poli) => {
      poli.forEach((q) => {
        peggio = Math.max(peggio, Math.abs(Math.hypot(q.x, q.y) - 200));
      });
    });
    /* Quanto sbaglierebbe lo STESSO tratto senza maniglie: gli stessi nodi,
       uniti da segmenti dritti, misurati nei PUNTI DI MEZZO dei segmenti.
       Non si appiattisce il tracciato senza maniglie, e il motivo e' una
       trappola in cui sono caduto: `appiattisci` di un segmento dritto
       restituisce i due capi e niente in mezzo, quindi misurarlo vorrebbe
       dire misurare dove stanno i NODI -- che stanno sul cerchio per
       costruzione -- invece di dove passa la linea. Il punto di mezzo e'
       dove la corda si scosta di piu'. */
    for (let i = 1; i < n.length; i++) {
      const m = { x: (n[i - 1].x + n[i].x) / 2, y: (n[i - 1].y + n[i].y) / 2 };
      corda = Math.max(corda, Math.abs(Math.hypot(m.x, m.y) - 200));
    }
    return { nodi: n.length, maniglie: n.filter((q) => q.hi || q.ho).length,
             peggio: peggio, corda: corda };
  });
  ok('una curva fatta a mano esce curva: le maniglie ci sono e ripassano sopra',
     r.nodi >= 3 && r.maniglie === r.nodi && r.peggio < r.corda / 2,
     r.nodi + ' nodi, scarto ' + r.peggio.toFixed(2) +
     ' contro ' + r.corda.toFixed(2) + ' senza maniglie');

  /* LE SOGLIE SEGUONO LO SCHERMO, non il foglio. Gli stessi punti, guardati
     da dieci volte piu' vicino (un pixel vale un decimo), tengono piu'
     nodi: il tremolio di un pixel sul vetro vale un decimo sulla carta, e
     la', dentro una lettera, e' il disegno. */
  r = await page.evaluate(() => {
    const punti = [];
    for (let i = 0; i <= 200; i++) punti.push({ x: i, y: (i % 2 ? 1 : -1) });
    const n = (u) => Matita.tratto(punti, { unitaPerPx: u, mmPerUnita: 1, fermezza: 4 }).nodi;
    return { lontano: n(1), vicino: n(0.1) };
  });
  ok('guardando da vicino la matita tiene più nodi: le soglie sono in pixel',
     r.vicino > r.lontano * 2, r.lontano + ' nodi da lontano, ' + r.vicino + ' da vicino');

  /* =====================================================================
     B. IL GESTO: la penna, il palmo, l'altra mano
     ===================================================================== */

  await page.evaluate((svg) => {
    Artwork.load(svg, 'quadrato.svg');
    /* Il disegno in un ANGOLO del foglio, come nel banco dei riempimenti:
       un disegno che riempie il foglio sta nello stesso posto qualunque
       sistema di riferimento si sbagli. */
    Artwork.collocaA({ x: 20, y: 20, w: 50, h: 50 });
    document.querySelector('.tab[data-tab="editor"]').click();
    /* Le parole che il programma dice si guardano: qui si raccolgono. */
    window.__dette = [];
    const vecchio = Log.add;
    Log.add = function (t, m) { window.__dette.push(t + ': ' + m); return vecchio(t, m); };
  }, SVG);
  await page.waitForTimeout(500);

  const suTela = (p) => page.evaluate((p) => {
    const m = document.getElementById('ed-svg').getScreenCTM();
    const q = new DOMPoint(p.x, p.y).matrixTransform(m);
    return { x: q.x, y: q.y };
  }, p);
  const quante = () => page.evaluate(() => Artwork.forme().length);
  const finestra = () => page.evaluate(() => {
    const v = document.getElementById('ed-svg').getAttribute('viewBox').split(/\s+/).map(Number);
    return { x0: v[0], y0: v[1], w: v[2], h: v[3] };
  });

  /* CON LA MATITA SPENTA la penna fa quello che fa un dito: non disegna.
     Prima di accenderla, perche' e' lo stato in cui la pagina si apre. */
  const A = await suTela({ x: 12, y: 12 });
  const B = await suTela({ x: 28, y: 28 });
  const n0 = await quante();
  await scrivi([A, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, B]);
  await page.waitForTimeout(150);
  ok('a matita SPENTA la penna non disegna: fa quello che fa un dito',
     (await quante()) === n0, n0 + ' forme prima e dopo');

  r = await page.evaluate(() => {
    document.getElementById('ed-matita').click();
    return {
      acceso: document.getElementById('ed-matita').classList.contains('attivo'),
      pannello: !document.getElementById('ed-matita-pannello').hidden,
      aiuto: document.getElementById('ed-aiuto').textContent
    };
  });
  ok('il pulsante accende la matita e apre la finestrella',
     r.acceso && r.pannello);
  ok('e l’aiuto dice che le dita continuano a funzionare',
     /dita/i.test(r.aiuto) && /mano appoggiata/i.test(r.aiuto), r.aiuto.slice(0, 90));

  /* I DUE MODI NON STANNO ACCESI INSIEME: si prendono entrambi il gesto
     sulla tela. */
  r = await page.evaluate(() => {
    document.getElementById('ed-riempi').click();
    const a = {
      mat: document.getElementById('ed-matita').classList.contains('attivo'),
      rie: document.getElementById('ed-riempi').classList.contains('attivo')
    };
    document.getElementById('ed-matita').click();
    const b = {
      mat: document.getElementById('ed-matita').classList.contains('attivo'),
      rie: document.getElementById('ed-riempi').classList.contains('attivo')
    };
    return { a: a, b: b };
  });
  ok('accendere il riempimento spegne la matita, e viceversa',
     r.a.rie && !r.a.mat && r.b.mat && !r.b.rie);

  /* IL TRATTO VERO. Una esse fatta con la penna: una forma in piu' nel
     livello, e una sola. */
  const esse = [];
  for (let i = 0; i <= 40; i++) {
    const k = i / 40;
    const q = await Promise.resolve({
      x: A.x + (B.x - A.x) * k,
      y: A.y + (B.y - A.y) * k + Math.sin(k * Math.PI * 2) * 18
    });
    esse.push(q);
  }
  const n1 = await quante();
  await penna('mousePressed', esse[0]);
  for (let i = 1; i < esse.length; i++) await penna('mouseMoved', esse[i]);
  /* Mentre la penna e' giu', il tratto si VEDE: e' quello che fa capire che
     sta disegnando e non trascinando. */
  const vivo = await page.evaluate(() =>
    document.querySelectorAll('.ed-matita-ora').length);
  await penna('mouseReleased', esse[esse.length - 1]);
  await page.waitForTimeout(200);
  r = await page.evaluate(() => {
    const f = Artwork.forme();
    const u = f[f.length - 1];
    return {
      quante: f.length,
      nodi: u && u.sub ? u.sub[0].nodi.length : 0,
      maniglie: u && u.sub ? u.sub[0].nodi.some((q) => q.hi || q.ho) : false,
      conto: document.getElementById('mat-conto').textContent,
      ancora: document.querySelectorAll('.ed-matita-ora').length
    };
  });
  ok('la penna disegna, e il tratto si vede mentre lo fa', vivo === 1 && r.ancora === 0,
     'anteprima ' + vivo + ' durante, ' + r.ancora + ' dopo');
  ok('e al distacco diventa UNA forma del livello, con le maniglie',
     r.quante === n1 + 1 && r.nodi > 2 && r.maniglie,
     r.quante + ' forme, ' + r.nodi + ' nodi');
  ok('e la finestrella dice com’è venuto: nodi e millimetri',
     /nodi/.test(r.conto) && /mm/.test(r.conto), r.conto);

  /* UN TRATTO E` UN PASSO DELLA STORIA, non cinquanta: un annulla lo toglie
     tutto, non l'ultimo punto. */
  await page.evaluate(() => document.getElementById('ed-annulla').click());
  await page.waitForTimeout(150);
  ok('un annulla toglie il tratto intero', (await quante()) === n1);

  /* ============ LA MANO APPOGGIATA ============
     La scena giusta: il PALMO si appoggia PRIMA della punta, perche' e'
     quello che fa una mano -- si abbassa, il palmo tocca, poi la penna. Al
     contrario il difetto non si manifesterebbe: un tocco che arriva mentre
     la penna gia' scrive e' facile da ignorare, ed e' il caso che non
     capita. */
  const palmo = await suTela({ x: 33, y: 33 });
  const vistaPrima = await finestra();
  const n2 = await quante();
  await dito('touchStart', [{ x: palmo.x, y: palmo.y, id: 7 }]);
  await dito('touchStart', [{ x: palmo.x, y: palmo.y, id: 7 },
                            { x: palmo.x + 40, y: palmo.y + 10, id: 8 }]);
  await penna('mousePressed', esse[0]);
  for (let i = 1; i < esse.length; i++) {
    await penna('mouseMoved', esse[i]);
    /* Il palmo si muove: una mano che disegna striscia sul vetro. Due
       contatti che si allargano sono, per chiunque li guardi senza sapere
       altro, una pinzata. */
    const k = i / esse.length;
    await dito('touchMove', [{ x: palmo.x - k * 30, y: palmo.y, id: 7 },
                             { x: palmo.x + 40 + k * 60, y: palmo.y + 10, id: 8 }]);
  }
  await penna('mouseReleased', esse[esse.length - 1]);
  await dito('touchEnd', []);
  await page.waitForTimeout(250);
  const vistaDopo = await finestra();
  ok('la mano appoggiata non sposta né ingrandisce il disegno',
     Math.abs(vistaDopo.w - vistaPrima.w) < 0.01 &&
     Math.abs(vistaDopo.x0 - vistaPrima.x0) < 0.01,
     'largo ' + vistaDopo.w.toFixed(2) + ' contro ' + vistaPrima.w.toFixed(2));
  ok('e il tratto esce comunque, uno solo', (await quante()) === n2 + 1);

  /* UN CONTATTO SOLO, che e' il caso vero. Il palmo di chi tiene la penna
     come la tengono tutti appoggia un pezzo di mano, non due: un contatto,
     che con la punta fa DUE -- cioe' una pinzata. La scena di sopra, con due
     contatti, non lo manifesta, perche' tre dita non pinzano e il guaio
     restava nascosto da quel conto. Questa lo manifesta. */
  const vista1 = await finestra();
  const n1b = await quante();
  await dito('touchStart', [{ x: palmo.x, y: palmo.y, id: 9 }]);
  await penna('mousePressed', esse[0]);
  for (let i = 1; i < esse.length; i++) {
    await penna('mouseMoved', esse[i]);
    const k = i / esse.length;
    await dito('touchMove', [{ x: palmo.x - k * 40, y: palmo.y + k * 20, id: 9 }]);
  }
  await penna('mouseReleased', esse[esse.length - 1]);
  await dito('touchEnd', []);
  await page.waitForTimeout(250);
  const vista2 = await finestra();
  ok('un contatto solo del palmo non fa «due dita» con la punta',
     Math.abs(vista2.w - vista1.w) < 0.01 && (await quante()) === n1b + 1,
     'largo ' + vista2.w.toFixed(2) + ' contro ' + vista1.w.toFixed(2));

  /* ============ LA MANO CHE SFIORA IL DISEGNO ============
     La seconda scena della mano, e la prima non la copre: qui i contatti
     arrivano MENTRE la penna sta gia' scrivendo -- la mano si riaggiusta a
     meta' di un tratto lungo -- e uno dei due cade sopra al disegno. Sono due
     difetti diversi da quelli di prima: l'altro contatto che si registra
     formerebbe una pinzata, e quello sul disegno prenderebbe un nodo e se lo
     porterebbe via quando la mano si sposta, dopo che la penna si e' alzata.
     La scena di prima non li manifesta, perche' la' i contatti c'erano gia'
     quando la penna e' partita. */
  const sopra = await suTela({ x: 35, y: 5 });   // l'angolo del quadrato
  const comEra = await page.evaluate(() => {
    const n = Artwork.forme()[0].sub[0].nodi;
    return n.map((q) => ({ x: q.x, y: q.y }));
  });
  const vistaP = await finestra();
  const nP = await quante();

  await penna('mousePressed', esse[0]);
  for (let i = 1; i < 20; i++) await penna('mouseMoved', esse[i]);
  /* A meta' del tratto la mano si riaggiusta: due contatti nuovi, uno dei
     quali sull'angolo del quadrato. */
  await dito('touchStart', [{ x: sopra.x, y: sopra.y, id: 11 }]);
  await dito('touchStart', [{ x: sopra.x, y: sopra.y, id: 11 },
                            { x: sopra.x + 50, y: sopra.y + 30, id: 12 }]);
  /* QUANTE DITA VEDE `Tocco` MENTRE LA PENNA SCRIVE: zero. Non e' un
     dettaglio interno -- e' il numero che `muovi` e il piano leggono per
     decidere «sono due dita, fermati», quindi un contatto contato qui vale
     un gesto bloccato o una pinzata di la'. Si guarda questo e non il
     viewBox perche' in questa scena il banco NON PUO' guardare il viewBox:
     Chromium non apre un secondo punto di tocco mentre una penna e'
     premuta, quindi una pinzata nata durante un tratto non si forma nemmeno
     volendo (vedi la nota del 2026-11-15 nella Pipeline). Le dita contate,
     invece, le vede. */
  const ditaOra = await page.evaluate(() =>
    window.Tocco ? Tocco.dita(document.getElementById('ed-svg')) : -1);
  for (let i = 20; i < esse.length; i++) await penna('mouseMoved', esse[i]);
  await penna('mouseReleased', esse[esse.length - 1]);
  /* E SI SPOSTANO DOPO CHE LA PENNA SI E' ALZATA: e' il momento in cui un
     trascinamento cominciato per sbaglio porterebbe via il nodo per davvero,
     perche' non c'e' piu' nessun tratto in corso a fare da schermo. */
  for (let i = 1; i <= 6; i++) {
    await dito('touchMove', [{ x: sopra.x - i * 8, y: sopra.y + i * 5, id: 11 },
                             { x: sopra.x + 50 + i * 12, y: sopra.y + 30, id: 12 }]);
  }
  await dito('touchEnd', []);
  await page.waitForTimeout(250);

  r = await page.evaluate((prima) => {
    const n = Artwork.forme()[0].sub[0].nodi;
    let max = 0;
    for (let i = 0; i < prima.length; i++) {
      max = Math.max(max, Math.hypot(n[i].x - prima[i].x, n[i].y - prima[i].y));
    }
    return { spostato: max, quante: Artwork.forme().length };
  }, comEra);
  const vistaQ = await finestra();
  ok('la mano che si riaggiusta a met\u00e0 tratto non conta come dita',
     ditaOra === 0 && Math.abs(vistaQ.w - vistaP.w) < 0.01,
     ditaOra + ' dita durante il tratto, largo ' + vistaQ.w.toFixed(2) +
     ' contro ' + vistaP.w.toFixed(2));
  ok('e quella che sfiora il disegno non se lo porta via',
     r.spostato < 1e-6 && r.quante === nP + 1,
     'nodo spostato di ' + r.spostato.toFixed(4) + ' unit\u00e0');

  /* ============ L'ALTRA MANO ============
     Appena la penna si ferma, due dita tornano a essere due dita: e' la
     meta' della richiesta dell'utente che un rifiuto del palmo fatto a
     manico d'ombrello -- «con la matita accesa le dita non fanno niente» --
     avrebbe buttato via. */
  await page.waitForTimeout(400);
  const vistaB = await finestra();
  const centro = await page.evaluate(() => {
    const b = document.getElementById('ed-svg').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const due = (d) => [{ x: centro.x - d / 2, y: centro.y, id: 1 },
                      { x: centro.x + d / 2, y: centro.y, id: 2 }];
  await dito('touchStart', due(120));
  for (let i = 1; i <= 8; i++) await dito('touchMove', due(120 + i * 15));
  await dito('touchEnd', []);
  await page.waitForTimeout(200);
  const vistaC = await finestra();
  ok('con la penna ferma, due dita dell’altra mano ingrandiscono ancora',
     vistaC.w < vistaB.w * 0.9,
     'da ' + vistaB.w.toFixed(1) + ' a ' + vistaC.w.toFixed(1));

  /* ============ IL GESTO CHE IL PALMO AVEVA FATTO PARTIRE ============
     Con lo strumento RETTANGOLO in mano, il palmo che si appoggia prima della
     punta non fa partire un lazo che non lascia tracce: fa partire un
     rettangolo, e al distacco della mano quel rettangolo diventa una forma
     vera. La scena con lo strumento «scegli» non lo manifesta -- un lazo
     finito a vuoto non crea niente -- ed e' per questo che questa scena
     cambia strumento. */
  await page.evaluate(() => {
    document.querySelector('.ed-str[data-str="rettangolo"]').click();
  });
  await page.waitForTimeout(150);
  const nR = await quante();
  await dito('touchStart', [{ x: palmo.x, y: palmo.y, id: 21 }]);
  await dito('touchMove', [{ x: palmo.x + 15, y: palmo.y + 15, id: 21 }]);
  await penna('mousePressed', esse[0]);
  for (let i = 1; i < esse.length; i++) await penna('mouseMoved', esse[i]);
  await penna('mouseReleased', esse[esse.length - 1]);
  /* La mano si sposta e si alza: e' il distacco che chiuderebbe il
     rettangolo rimasto in piedi. */
  await dito('touchMove', [{ x: palmo.x + 60, y: palmo.y + 50, id: 21 }]);
  await dito('touchEnd', []);
  await page.waitForTimeout(250);
  ok('col rettangolo in mano, il palmo non lascia in piedi una forma a met\u00e0',
     (await quante()) === nR + 1,
     (await quante()) + ' forme contro ' + (nR + 1) + ' attese');
  await page.evaluate(() => {
    document.querySelector('.ed-str[data-str="scegli"]').click();
  });

  /* ============ I MAGNETI ATTACCANO I CAPI ============
     E' il modo in cui un tratto fatto a mano si innesta su un disegno che
     c'e' gia': si parte dall'angolo del quadrato e il primo nodo ci finisce
     sopra esatto, non a un decimo. */
  await page.evaluate(() => {
    Editor.adatta();
    document.getElementById('ed-magneti').classList.add('attivo');
  });
  await page.waitForTimeout(150);
  const angolo = await suTela({ x: 5, y: 5 });
  await scrivi([{ x: angolo.x + 3, y: angolo.y + 3 },
                { x: angolo.x + 30, y: angolo.y + 20 },
                { x: angolo.x + 60, y: angolo.y + 10 }]);
  await page.waitForTimeout(200);
  r = await page.evaluate(() => {
    const f = Artwork.forme();
    const u = f[f.length - 1].sub[0].nodi[0];
    return { x: u.x, y: u.y };
  });
  ok('coi magneti accesi il capo del tratto si attacca al nodo vicino',
     Math.abs(r.x - 5) < 0.01 && Math.abs(r.y - 5) < 0.01,
     'primo nodo (' + r.x.toFixed(3) + ', ' + r.y.toFixed(3) + ')');

  /* ============ UN LIVELLO SPENTO NON SI DISEGNA ============
     Lo stesso guardiano di tutti gli altri strumenti: modificare quello che
     non si vede e' il guaio peggiore che un editor possa fare. */
  r = await page.evaluate(() => {
    window.__dette = [];
    const id = Artwork.sceltoId();
    Artwork.commutaVisibile(id);
    return Artwork.forme().length;
  });
  await scrivi([{ x: centro.x - 40, y: centro.y }, { x: centro.x, y: centro.y + 20 },
                { x: centro.x + 40, y: centro.y }]);
  await page.waitForTimeout(200);
  const dette = await page.evaluate(() => ({
    quante: Artwork.forme().length, dette: window.__dette.join(' | ')
  }));
  ok('su un livello nascosto la matita non disegna, e lo dice',
     dette.quante === r && /nascosto/i.test(dette.dette),
     dette.dette.slice(0, 90));

  /* ============ LA TELA VUOTA ============
     L'editor si puo' aprire senza nessun disegno caricato, e la', con la
     matita accesa, un tratto non ha un posto dove andare. Deve non succedere
     niente -- non un errore in console a meta' di un gesto. Ultimo controllo
     perche' butta via il disegno della scena. */
  await page.evaluate(() => {
    Artwork.livelli().slice().forEach((l) => Artwork.rimuovi(l.id));
    window.__dette = [];
  });
  await page.waitForTimeout(200);
  const erroriPrima = errori.length;
  await scrivi([{ x: centro.x - 30, y: centro.y - 10 },
                { x: centro.x, y: centro.y + 20 },
                { x: centro.x + 30, y: centro.y }]);
  await page.waitForTimeout(250);
  ok('sulla tela vuota la matita non fa niente, e non si rompe niente',
     errori.length === erroriPrima,
     errori.slice(erroriPrima).join(' | ') || 'nessun errore');

  ok('nessun errore in console', errori.length === 0, errori.join(' | '));

  await browser.close();
  console.log(guai ? '\n' + guai + ' guai' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
