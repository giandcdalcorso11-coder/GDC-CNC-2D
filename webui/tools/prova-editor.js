/* Il collaudo dei due strumenti nuovi dell'editor: il selettore specifico
 * (il lazo) e lo specchio.
 *
 * Gira sulla pagina COSTRUITA, nel browser vero, perche' questi due
 * strumenti vivono fra il mouse, l'SVG e il modello: provarli a pezzi
 * vorrebbe dire provare tre cose che nessuno usa separate.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «ha selezionato qualcosa»: e' che
 * TAGLIANDO IL DISEGNO NON CAMBI. Un lazo che prende il pezzo giusto ma
 * sposta di un decimo i nodi che tocca e' peggio di uno che non prende
 * niente, perche' il danno si vede solo sulla carta.
 *
 * Uso:  node webui/tools/prova-editor.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Un livello con dentro le forme che gli si danno, e l'editor che lo guarda. */
const PREPARA = (forme) => {
  Artwork.nuovo();
  const f = Artwork.forme();
  f.length = 0;
  forme.forEach((x) => f.push(x));
  Artwork.rigenera();
  Editor.apri();
  Editor.adatta();
  return f.length;
};

/* La polilinea di tutto il livello, appiattita: e' il disegno come finira'
   sulla carta, ed e' quello che il taglio non deve cambiare. */
const IMPRONTA = () =>
  Tracciato.appiattisciTutte(Artwork.forme(), 0.02)
    .map((p) => p.map((q) => [Math.round(q.x * 1000), Math.round(q.y * 1000)]));

function lunghezza(punti) {
  let L = 0;
  for (let i = 1; i < punti.length; i++) {
    L += Math.hypot(punti[i][0] - punti[i - 1][0], punti[i][1] - punti[i - 1][1]);
  }
  return L / 1000;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await page.goto(PAGINA);
  await page.click('.tab[data-tab="editor"]');
  await page.waitForTimeout(250);

  await page.addInitScript(() => {});
  await page.evaluate(`window.PREPARA = ${PREPARA.toString()}; window.IMPRONTA = ${IMPRONTA.toString()};`);

  /* ---------- 1. una spezzata dritta, tagliata sul bordo ---------- */
  let r = await page.evaluate(() => {
    const nodi = [];
    for (let x = 0; x <= 100; x += 10) nodi.push(Tracciato.nodo(x, 0));
    PREPARA([Tracciato.tracciato([{ nodi: nodi, chiuso: false }])]);
    const primaL = Tracciato.appiattisciTutte(Artwork.forme(), 0.02)
      .reduce((s, p) => s + p.reduce((t, q, i) => i ? t + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y) : 0, 0), 0);

    Editor.lazo([{ x: 25, y: -5 }, { x: 75, y: -5 }, { x: 75, y: 5 }, { x: 25, y: 5 }]);

    const f = Artwork.forme(), sub = f[0].sub[0];
    const tratti = Editor.tratti();
    let x0 = Infinity, x1 = -Infinity;
    tratti.forEach((t) => {
      const a = f[t.forma].sub[t.sub].nodi[t.k];
      const b = f[t.forma].sub[t.sub].nodi[t.k + 1];
      x0 = Math.min(x0, a.x, b.x); x1 = Math.max(x1, a.x, b.x);
    });
    const dopoL = Tracciato.appiattisciTutte(Artwork.forme(), 0.02)
      .reduce((s, p) => s + p.reduce((t, q, i) => i ? t + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y) : 0, 0), 0);
    return { quanti: tratti.length, x0: x0, x1: x1, nodi: sub.nodi.length,
             primaL: primaL, dopoL: dopoL };
  });
  ok('il lazo prende solo quello che sta dentro',
     Math.abs(r.x0 - 25) < 1e-6 && Math.abs(r.x1 - 75) < 1e-6,
     'da x=' + r.x0.toFixed(3) + ' a x=' + r.x1.toFixed(3));
  ok('taglia sul bordo e non al nodo piu` vicino', r.nodi === 13,
     r.nodi + ' nodi (11 piu` i due tagli)');
  ok('il disegno non cambia di lunghezza', Math.abs(r.primaL - r.dopoL) < 1e-6,
     r.primaL.toFixed(4) + ' -> ' + r.dopoL.toFixed(4));

  /* ---------- 2. una curva: il taglio non la storce ----------
     Il confronto NON e` «gli stessi punti»: l'appiattimento e` adattivo, e
     una cubica spezzata in due produce campioni diversi pur passando per
     gli stessi posti. Quello che deve restare uguale e` la CURVA, quindi si
     misura la distanza fra le due polilinee nei due versi. */
  r = await page.evaluate(() => {
    function distanzaDa(q, poly) {
      let d = Infinity;
      for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1], b = poly[i];
        const vx = b.x - a.x, vy = b.y - a.y;
        const L2 = vx * vx + vy * vy;
        let t = L2 ? ((q.x - a.x) * vx + (q.y - a.y) * vy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        d = Math.min(d, Math.hypot(q.x - a.x - vx * t, q.y - a.y - vy * t));
      }
      return d;
    }
    function scarto(A, B) {
      let m = 0;
      A.forEach((pa) => pa.forEach((q) => {
        let d = Infinity;
        B.forEach((pb) => { d = Math.min(d, distanzaDa(q, pb)); });
        m = Math.max(m, d);
      }));
      return m;
    }
    PREPARA([Tracciato.cerchio(50, 50, 30)]);
    const prima = Tracciato.appiattisciTutte(Artwork.forme(), 0.01);
    /* Il bordo a x = 60 e non a x = 50: a 50 passerebbe esattamente per due
       nodi del cerchio, non taglierebbe niente, e la prova direbbe «ok»
       senza aver provato il taglio. */
    Editor.lazo([{ x: 60, y: -20 }, { x: 140, y: -20 }, { x: 140, y: 120 }, { x: 60, y: 120 }]);
    const dopo = Tracciato.appiattisciTutte(Artwork.forme(), 0.01);
    const f = Artwork.forme(), sub = f[0].sub[0];
    const vicini = sub.nodi.map((n) => Math.abs(n.x - 60)).sort((a, b) => a - b);
    return { quanti: Editor.tratti().length, nodi: sub.nodi.length,
             tagli: vicini.filter((d) => d < 2e-3).length, peggiore: vicini[1],
             scarto: Math.max(scarto(prima, dopo), scarto(dopo, prima)) };
  });
  ok('una curva tagliata resta la stessa curva', r.scarto < 0.01,
     'si discosta al massimo di ' + r.scarto.toFixed(5) + ' mm');
  /* Due nodi nuovi, e sul bordo: la bisezione li inchioda a sette decimi di
     micron, cioe` un quarantesimo di un passo di motore. */
  ok('i tagli cadono sul bordo del lazo', r.tagli === 2 && r.nodi === 6,
     r.nodi + ' nodi (4 piu` i due tagli), il piu` lontano a ' +
     (r.peggiore * 1000).toFixed(2) + ' micron da x=60');

  /* ---------- 3. lo specchio ---------- */
  r = await page.evaluate(() => {
    /* Una «L»: non e` simmetrica in nessuno dei due versi, quindi un
       ribaltamento sbagliato si vede. */
    Editor.asseSpecchio('v');
    document.getElementById('ed-specchio-asse').click();   // -> asse orizzontale
    const asseO = Editor.asseSpecchio();
    const segnoO = document.getElementById('ed-specchio-asse').textContent;
    document.getElementById('ed-specchio-asse').click();   // -> torna verticale
    return { asseO: asseO, asseV: Editor.asseSpecchio(), segnoO: segnoO };
  });
  ok('il bottoncino tondo cambia l`asse', r.asseO === 'o' && r.asseV === 'v',
     'orizzontale poi verticale');

  r = await page.evaluate(() => {
    const L = Tracciato.daPunti([{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 20, y: 30 }], false);
    PREPARA([L]);
    const b0 = Tracciato.bbox(Artwork.forme(), 0.02);
    const nodi0 = Artwork.forme()[0].sub[0].nodi.map((n) => [n.x, n.y]);
    /* Si sceglie la forma a mano, come fa un clic su di lei. */
    Editor.scegliForma(0);
    Editor.asseSpecchio('v');
    Editor.specchia();
    const b1 = Tracciato.bbox(Artwork.forme(), 0.02);
    const nodi1 = Artwork.forme()[0].sub[0].nodi.map((n) => [n.x, n.y]);
    Editor.scegliForma(0);
    Editor.specchia();
    const nodi2 = Artwork.forme()[0].sub[0].nodi.map((n) => [n.x, n.y]);
    return { b0: b0, b1: b1, nodi0: nodi0, nodi1: nodi1, nodi2: nodi2 };
  });
  if (r && r.nodi1) {
    const cx = r.b0.x0 + r.b0.w / 2;
    const atteso = r.nodi0.map((n) => [2 * cx - n[0], n[1]]);
    ok('lo specchio ribalta davvero',
       JSON.stringify(r.nodi1.map((n) => n.map((v) => Math.round(v * 1e6)))) ===
       JSON.stringify(atteso.map((n) => n.map((v) => Math.round(v * 1e6)))),
       JSON.stringify(r.nodi1));
    ok('e il disegno non si sposta',
       Math.abs(r.b0.x0 - r.b1.x0) < 1e-9 && Math.abs(r.b0.x1 - r.b1.x1) < 1e-9 &&
       Math.abs(r.b0.y0 - r.b1.y0) < 1e-9,
       'scatola ferma');
    ok('due specchi tornano all`originale',
       JSON.stringify(r.nodi2.map((n) => n.map((v) => Math.round(v * 1e6)))) ===
       JSON.stringify(r.nodi0.map((n) => n.map((v) => Math.round(v * 1e6)))));
  } else {
    ok('lo specchio ribalta davvero', false, 'la prova non e` partita');
  }

  /* ---------- 4. un disegno vero: deve restare usabile ----------
     Una campitura importata e` la ragione per cui questo strumento esiste:
     se su sessantamila tratti ci mette dieci secondi, non serve a niente.
     Il filtro delle scatole e` quello che lo tiene in piedi. */
  r = await page.evaluate(() => {
    const subs = [];
    for (let r0 = 0; r0 < 300; r0++) {
      const nodi = [];
      for (let c = 0; c <= 200; c++) {
        nodi.push(Tracciato.nodo(c * 0.5, r0 * 0.4 + Math.sin(c) * 0.15));
      }
      subs.push({ nodi: nodi, chiuso: false });
    }
    PREPARA([Tracciato.tracciato(subs)]);
    const tratti = 300 * 200;
    const t0 = performance.now();
    Editor.lazo([{ x: 30, y: 40 }, { x: 46, y: 38 }, { x: 50, y: 60 },
                 { x: 34, y: 64 }, { x: 28, y: 52 }]);
    const ms = performance.now() - t0;
    /* E QUESTO CONTA DI PIU': il lazo si paga una volta, il ridisegno si
       paga a ogni spostamento dello sguardo finche' la selezione resta su.
       Migliaia di tratti evidenziati a venticinque campioni l'uno erano un
       quarto di secondo ogni volta che si trascinava la tela. */
    const t1 = performance.now();
    Editor.disegna();
    const msDis = performance.now() - t1;
    return { ms: ms, msDis: msDis, presi: Editor.tratti().length, tratti: tratti };
  });
  /* La soglia e` stretta apposta: senza il salto della rigenerazione questo
     gesto costa 1,8 secondi invece di 0,2, e una soglia larga lascerebbe
     rientrare quel secondo e mezzo senza che nessuno se ne accorga. */
  ok('su ' + r.tratti + ' tratti il lazo resta immediato', r.ms < 600,
     Math.round(r.ms) + ' ms, ' + r.presi + ' tratti presi');
  ok('e il ridisegno dopo resta scattante', r.msDis < 250,
     Math.round(r.msDis) + ' ms con ' + r.presi + ' tratti evidenziati');
  ok('e ne prende una manciata, non tutto', r.presi > 50 && r.presi < r.tratti / 5,
     r.presi + ' su ' + r.tratti);

  /* ---------- 5. il marchio nel disegno ----------
     Non «ha messo qualcosa»: che quello che mette sia IL LOGO. Si misura il
     rapporto fra base e altezza, che e' la firma della forma, e la larghezza
     in millimetri, che e' la promessa del pulsante. */
  r = await page.evaluate(() => {
    PREPARA([Tracciato.daPunti([{ x: 0, y: 0 }, { x: 100, y: 0 }], false)]);
    const prima = Artwork.forme().length;
    Editor.marchio();
    const f = Artwork.forme();
    if (f.length !== prima + 1) return { quante: f.length - prima };
    const logo = f[f.length - 1];
    const b = Tracciato.bbox([logo], 0.02);
    /* Il viewBox del logo e' 487,03 x 158,49: il rapporto deve sopravvivere. */
    const svg = document.querySelector('.brand .marchio').getAttribute('viewBox').split(' ');
    return { quante: 1, sub: logo.sub.length,
             largo: +b.w.toFixed(3), alto: +b.h.toFixed(3),
             rapporto: +(b.w / b.h).toFixed(4),
             atteso: +(parseFloat(svg[2]) / parseFloat(svg[3])).toFixed(4),
             nodi: Tracciato.conta([logo]).nodi,
             curve: Tracciato.conta([logo]).curve };
  });
  ok('il marchio entra nel livello', r.quante === 1 && r.sub > 10,
     r.sub + ' tracciati, ' + r.nodi + ' nodi, ' + r.curve + ' con una curva');
  ok('ed e` davvero il logo, non una scatola',
     Math.abs(r.rapporto - r.atteso) < 0.002,
     'base su altezza ' + r.rapporto + ', il logo dice ' + r.atteso);
  ok('largo i 60 mm promessi dal pulsante', Math.abs(r.largo - 60) < 0.01,
     r.largo + ' x ' + r.alto);

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
