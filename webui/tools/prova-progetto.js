/* Il collaudo di DUE PROGETTI SALVATI CHE FINISCONO SULLO STESSO FOGLIO.
 *
 * IL PROBLEMA, detto dall'operatore il 2026-11-06: «carico un file che ho
 * salvato perche' mi servono alcune parti da quello, poi ne carico un altro
 * perche' altre parti mi servono da quello, e il secondo sovrascrive il
 * primo». Era vero e di proposito: `daProgetto()` azzerava l'elenco dei
 * livelli, perche' un progetto «non si importa, si riprende». Giusto per
 * riprendere la giornata di ieri, sbagliato per pescare dei pezzi, e la
 * finestrella che chiedeva il permesso era un `window.confirm`, che ha due
 * pulsanti e quindi non poteva offrire la terza strada.
 *
 * LE COSE CHE SI CONTROLLANO DAVVERO non sono «il pulsante c'e'»:
 *   1. che sul foglio vuoto non si chieda niente (una domanda con una
 *      risposta sola e' solo un clic in piu');
 *   2. che mentre la finestrella e' aperta NON sia ancora cambiato niente —
 *      il difetto peggiore sarebbe aggiungere e poi chiedere;
 *   3. che aggiungendo arrivino le FORME e non i tracciati: le curve sono
 *      esattamente quello che si perderebbe riaprendo lo stesso file come un
 *      SVG qualunque, ed e' il motivo per cui questa strada esiste;
 *   4. che aggiungendo, chi c'era prima NON si muova di un millimetro —
 *      e che il progetto arrivato si porti dietro IL SUO foglio invece di
 *      appoggiare i suoi livelli su quello di un altro (dal 2026-11-07:
 *      supera la decisione del 6 novembre, vedi js/progetto.js);
 *   5. che «Sostituisci tutto» faccia ancora quello che ha sempre fatto,
 *      fogli compresi — la strada vecchia non si rompe per farne una nuova;
 *   6. che due progetti arrivati insieme diano DUE domande. Trascinandone
 *      due, aprire la seconda finestrella sopra la prima perderebbe una
 *      scelta senza dirlo, e il secondo file sparirebbe in silenzio.
 *
 * E DAL 2026-11-07 (fase 5 dello Step 12), le cose che un file con PIU'
 * FOGLI deve saper dire:
 *   7. che il file li scriva tutti, e che ogni livello dica su quale sta;
 *   8. che il disegno nel file sia in coordinate MACCHINA — nove magneti
 *      devono uscire come nove disegni in nove posti, non nove volte
 *      sovrapposti nell'angolo — e che con un foglio solo non cambi niente
 *      rispetto a prima;
 *   9. che riaprendolo l'ACCOSTAMENTO torni, ricalcolato da dove stanno i
 *      fogli e non riletto dal file: e' quello che fa la differenza fra una
 *      misura sulla macchina e due;
 *  10. che aggiungendo, il gruppo che arriva si posi TUTTO INSIEME, cioe'
 *      che due fogli accostati nel file lo siano ancora sul piano;
 *  11. che un angolo MISURATO oggi non venga sovrascritto da quello salvato
 *      nel file, che e' un'ipotesi;
 *  12. che quando nella corsa non c'e' piu' posto lo si dica PRIMA di
 *      scegliere, e non dopo;
 *  13. che un progetto salvato col formato 1 (un foglio solo) si apra
 *      ancora;
 *  14. che sullo STESSO piano i livelli si appoggino ai fogli che ci sono
 *      invece di portare altra carta — e' il caso vero del 6 novembre: due
 *      file salvati sullo stesso formato, e le parti da mettere sulla
 *      stessa carta;
 *  15. che un piano con piu' fogli faccia chiedere anche quando di livelli
 *      non ce n'e' nessuno: nove magneti posati sono lavoro da perdere.
 *
 * E DAL 2026-11-08, LA SCELTA DEI LIVELLI (l'ultima meta' dello Step 11):
 *  16. che si possa prenderne due su diciotto, e che arrivino solo quelli;
 *  17. che arrivino solo i FOGLI che servono a quei due, non tutti e nove;
 *  18. che senza nessun livello preso i pulsanti si spengano — e che Invio
 *      non faccia quello che un pulsante spento non fa;
 *  19. che la spunta sia di QUEL progetto: due file in coda, due scelte.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * un controllo che non si accende quando il codice e' rotto non e' un
 * controllo, e' una decorazione. Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-progetto.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* I FOGLI PER INDICE, SENZA MORIRE. Qui sotto si guarda il foglio 2 o il 3, e
   un difetto puo' farne sparire uno: un banco che muore con un TypeError non
   dice quale controllo non torna -- sembra rotto il banco, non il codice. E'
   succeduto il 2026-11-07 con la mutazione «lo stesso piano non guarda le
   misure», che ha lasciato un foglio solo dove il controllo ne pretendeva due.
   Questo torna una riga di null invece di esplodere: il controllo FALLISCE, e
   si legge. */
const FOG = (st, i) => st.fogli[i] || [null, null, null, null, null, null];

/* Due disegni fatti a mano, e fatti a mano per una ragione: il primo ha una
   CURVA vera -- due nodi con le maniglie -- e il disegno di esempio non ne ha
   nemmeno una. Senza una curva, il controllo che conta piu' di tutti (le
   forme arrivano intere) non avrebbe niente da guardare. */
const CURVO = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
<path fill="none" stroke="#1f4fa8" d="M10 10 C 30 60, 70 60, 90 10"/>
<path fill="none" stroke="#c8102e" d="M10 90 L 90 90"/></svg>`;

const DRITTO = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
<path fill="none" stroke="#1d1d1b" d="M20 20 L 80 20 L 80 80"/></svg>`;

/* Lo stato della pagina, ridotto a quello che serve a queste domande. */
const STATO = (page) => page.evaluate(() => {
  const p = Artwork.progetto();
  return {
    quanti: p.livelli.length,
    nomi: p.livelli.map((l) => l.nome),
    curve: p.livelli.map((l) => Tracciato.conta(l.forme).curve),
    penne: p.livelli.map((l) => l.penna || null),
    spessori: p.livelli.map((l) => l.spessore || null),
    cambi: p.livelli.map((l) => !!l.cambioPenna),
    foglio: [State.data.paper.w, State.data.paper.h],
    /* Il piano intero, e non solo il foglio in uso: dalla fase 5 un progetto
       si porta dietro i suoi fogli, e le domande sono su quelli. */
    fogli: State.data.fogli.map((f) => [f.w, f.h, f.origine.x, f.origine.y,
                                        f.aggancio ? Fogli.indice(f.aggancio) : null,
                                        f.misurato]),
    attivo: Fogli.indice(State.data.foglioAttivo),
    suFoglio: p.livelli.map((l) => l.foglio),
    aperta: !document.getElementById('prog-modal').hidden,
    titolo: document.getElementById('prog-titolo').textContent,
    desc: document.getElementById('prog-desc').textContent,
    nota: document.getElementById('prog-nota').hidden
      ? null : document.getElementById('prog-nota').textContent,
    coda: document.getElementById('prog-coda').hidden
      ? null : document.getElementById('prog-coda').textContent,
    bottoni: ['prog-annulla', 'prog-sostituisci', 'prog-aggiungi']
      .map((id) => document.getElementById(id).textContent)
  };
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

  /* Il file da tenere da parte: due livelli, su un A4, con una penna e uno
     spessore scelti a mano -- cioe' le cose che un SVG normale non sa dire. */
  const salvato = await page.evaluate(([CURVO]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(210, 297);
    Paper.setSheetOrigin(0, 0);
    Artwork.load(CURVO, 'curvo.cnc2d.svg');
    const l = Artwork.livelli();
    Artwork.scegliPenna(l[0].id, '#1f4fa8');
    Artwork.scegliSpessore(l[0].id, 0.8);
    Artwork.scegliPenna(l[1].id, '#c8102e');
    return Progetto.testo();
  }, [CURVO]);

  /* Un secondo progetto, diverso e su un altro foglio: serve alla coda. */
  const altro = await page.evaluate(([DRITTO]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(148, 210);
    Paper.setSheetOrigin(10, 10);
    Artwork.load(DRITTO, 'dritto.cnc2d.svg');
    return Progetto.testo();
  }, [DRITTO]);

  /* La scena di partenza: il lavoro che c'e' gia' sul foglio, su un A5.
     I FOGLI SI RIMETTONO A UNO. Non e' pulizia di cortesia: dalla fase 5 un
     progetto aggiunto lascia sul piano i suoi fogli, e una scena che se li
     portasse dietro farebbe passare o fallire un controllo per quello che e'
     successo nel controllo precedente. L'angolo si mette a mano per la stessa
     ragione: i numeri che si pretendono qui sotto partono da li'. */
  const SCENA = async () => page.evaluate(([DRITTO]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(148, 210);
    Paper.setSheetOrigin(10, 10);
    Artwork.load(DRITTO, 'in corso.svg');
  }, [DRITTO]);

  /* ============ 1. SUL FOGLIO VUOTO NON SI CHIEDE NIENTE ============
     Non c'e' nessuna differenza fra sostituire e aggiungere quando non c'e'
     niente da sostituire. */
  await page.evaluate(() => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
  });
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('sul foglio vuoto il progetto si apre senza chiedere niente',
     !r.aperta && r.quanti === 2 && r.foglio[0] === 210 && r.foglio[1] === 297,
     'finestrella ' + (r.aperta ? 'aperta' : 'chiusa') + ', ' + r.quanti +
     ' livelli, foglio ' + r.foglio.join('×'));

  /* ============ 2. CON DEL LAVORO SI CHIEDE, E SOLO SI CHIEDE ============
     Che la finestrella si apra conta meno di questo: che mentre e' aperta non
     sia ancora cambiato niente. Aggiungere e poi chiedere sarebbe il difetto
     peggiore di tutti, perche' il «no» non servirebbe a nulla. */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('con del lavoro sul foglio la finestrella si apre', r.aperta &&
     /curvo\.cnc2d\.svg/.test(r.titolo), r.titolo);
  ok('e sono tre strade, non due', r.bottoni.length === 3 &&
     /Annulla/.test(r.bottoni[0]) && /Sostituisci/.test(r.bottoni[1]) &&
     /Aggiungi/.test(r.bottoni[2]), r.bottoni.join(' | '));
  ok('mentre la finestrella e` aperta non e` cambiato niente',
     r.quanti === 1 && r.nomi[0] === 'in corso.svg' &&
     r.foglio[0] === 148 && r.foglio[1] === 210,
     r.quanti + ' livelli (' + r.nomi.join(', ') + '), foglio ' + r.foglio.join('×'));
  /* La finestrella dice quanti fogli porta: dal 2026-11-07 e' la cosa che
     cambia fra «aggiungi» e «sostituisci», e si legge prima di scegliere. */
  ok('e la finestrella dice che porta il suo foglio',
     /un foglio 210 × 297 mm/.test(r.desc) && /porta il suo foglio/.test(r.desc),
     r.desc.slice(0, 120));
  /* E DICE CHE UN A4 NON CI STA NELLA CORSA, perche' non ci sta: 297 > 236.
     Non e' «il posto e' finito», e' «quel foglio e' piu' grande della corsa»
     — due cose diverse, e la seconda non e' un errore (con un A4 si stampa un
     pezzo per volta). Dirle con la stessa frase vorrebbe dire far cercare
     all'operatore un posto libero che non esiste. */
  ok('e dice che un A4 non ci sta nella corsa percorribile',
     r.nota !== null && /non ci sta dentro la corsa percorribile/.test(r.nota) &&
     /un foglio 210 × 297 mm/.test(r.nota) && /un pezzo per volta/.test(r.nota),
     String(r.nota).slice(0, 150));

  /* ============ 3. ANNULLA NON TOCCA NIENTE ============ */
  await page.click('#prog-annulla');
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('«Annulla» lascia il foglio com\'era', !r.aperta && r.quanti === 1 &&
     r.nomi[0] === 'in corso.svg' && r.foglio[0] === 148,
     r.quanti + ' livelli, foglio ' + r.foglio.join('×'));

  /* ============ 4. AGGIUNGI: I LIVELLI SI ACCOSTANO ============ */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(100);
  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('«Aggiungi i livelli» li mette accanto a quelli che ci sono',
     r.quanti === 3 && r.nomi[0] === 'in corso.svg' &&
     /curvo\.cnc2d\.svg/.test(r.nomi[1]) && /curvo\.cnc2d\.svg/.test(r.nomi[2]),
     r.quanti + ': ' + r.nomi.join(', '));

  /* QUESTO e' il controllo per cui la strada esiste. Riaprendo lo stesso file
     come un SVG qualunque i tracciati salvati sono polilinee gia' appiattite:
     la curva diventerebbe una spezzata e l'editor non la ricurverebbe piu'. */
  ok('e le forme arrivano intere: la curva e` ancora una curva',
     r.curve[1] === 2, 'nodi con una curva per livello: ' + r.curve.join(', '));
  ok('con penna e spessore scelti a mano',
     r.penne[1] === '#1f4fa8' && r.spessori[1] === 0.8 && r.penne[2] === '#c8102e',
     'penne ' + JSON.stringify(r.penne) + ', spessori ' + JSON.stringify(r.spessori));

  /* DAL 2026-11-07 CHI ARRIVA PORTA IL SUO FOGLIO, e supera la decisione del
     6 novembre («del file si prendono solo i livelli»). Le due meta' del
     controllo sono separate di proposito: quello che c'era non si muove di un
     millimetro, E il foglio del file si aggiunge invece di essere buttato.
     Prendere solo i livelli era il meglio possibile quando il foglio era uno;
     adesso il livello arrivato sta sulla carta su cui stava. */
  ok('quello che c\'era sul piano non si muove',
     r.fogli.length === 2 && FOG(r, 0)[0] === 148 && FOG(r, 0)[1] === 210 &&
     FOG(r, 0)[2] === 10 && FOG(r, 0)[3] === 10,
     JSON.stringify(r.fogli));
  /* E L'A4 CHE NON CI STA FINISCE DI FIANCO, NON SOPRA. Il foglio che c'era
     arriva a X 158: il nuovo comincia da li'. Sovrapporli sarebbe il guaio
     che non si vede — due disegni sulla stessa carta — mentre un foglio che
     sporge dalla corsa si vede sul piano e lo dice l'elenco dei fogli. */
  ok('e il foglio che non ci sta va di fianco, non sopra',
     FOG(r, 1)[2] === 158 && await page.evaluate(() => Fogli.sovrapposti().length) === 0,
     'angolo del nuovo X ' + FOG(r, 1)[2] + ' Y ' + FOG(r, 1)[3] +
     ', coppie sovrapposte ' + await page.evaluate(() => Fogli.sovrapposti().length));
  ok('e il progetto si porta dietro il suo foglio',
     r.fogli.length === 2 && FOG(r, 1)[0] === 210 && FOG(r, 1)[1] === 297 &&
     r.suFoglio[0] === 0 && r.suFoglio[1] === 1 && r.suFoglio[2] === 1 &&
     r.attivo === 1,
     'fogli ' + JSON.stringify(r.fogli) + ', livelli su ' +
     JSON.stringify(r.suFoglio) + ', in uso il ' + (r.attivo + 1));

  /* Il primo livello arrivato chiede un cambio penna anche se nel suo file non
     lo chiedeva: la' era il primo di tutti, qui viene dopo il lavoro di
     qualcun altro, e due file sono due disegni. */
  ok('il primo livello arrivato chiede un cambio penna',
     r.cambi[0] === false && r.cambi[1] === true,
     'cambi penna: ' + JSON.stringify(r.cambi));

  /* ============ 5. SOSTITUISCI TUTTO FA ANCORA QUELLO CHE FACEVA ============
     La strada nuova non si fa rompendo quella vecchia: «sostituisci» resta la
     ripresa di un progetto, foglio compreso. */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'curvo.cnc2d.svg'), [salvato]);
  await page.waitForTimeout(100);
  await page.click('#prog-sostituisci');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('«Sostituisci tutto» torna a quel progetto, foglio compreso',
     r.quanti === 2 && r.nomi.every((n) => /curvo\.cnc2d\.svg/.test(n)) &&
     r.foglio[0] === 210 && r.foglio[1] === 297,
     r.quanti + ' livelli (' + r.nomi.join(', ') + '), foglio ' + r.foglio.join('×'));
  /* E il piano torna a UN foglio: sostituire e' tornare a quel momento, e in
     quel momento di fogli ce n'era uno. Un foglio di troppo rimasto sul piano
     sarebbe una misura di troppo a inizio stampa. */
  ok('e sul piano resta solo il suo', r.fogli.length === 1 &&
     FOG(r, 0)[2] === 0 && FOG(r, 0)[3] === 0, JSON.stringify(r.fogli));

  /* ============ 6. DUE PROGETTI INSIEME, DUE DOMANDE ============
     Trascinandone due, i due FileReader finiscono quando finiscono. Aprire la
     seconda finestrella sopra la prima vorrebbe dire perdere una scelta senza
     dirlo: il secondo file sparirebbe e nessuno saprebbe perche'. */
  await SCENA();
  await page.evaluate(([a, b]) => {
    Artwork.load(a, 'curvo.cnc2d.svg');
    Artwork.load(b, 'dritto.cnc2d.svg');
  }, [salvato, altro]);
  await page.waitForTimeout(120);
  r = await STATO(page);
  ok('due progetti insieme: si chiede del primo e si dice che c\'e` un altro',
     r.aperta && /curvo/.test(r.titolo) && r.coda !== null &&
     /un altro progetto/.test(r.coda), r.titolo + ' — coda: ' + r.coda);

  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('e dopo la prima scelta si chiede del secondo, senza perderlo',
     r.aperta && /dritto/.test(r.titolo) && r.coda === null && r.quanti === 3,
     r.titolo + ', ' + r.quanti + ' livelli');

  /* La nota si ricalcola per OGNI progetto in coda, e si vede dalla misura
     che nomina: qui parla dell'A5 che sta arrivando, non dell'A4 di prima.
     Una nota scritta una volta per tutte direbbe la misura sbagliata — e
     direbbe «piu' grande della corsa» di un foglio che invece ci starebbe,
     se solo l'A4 appena aggiunto non si fosse mangiato il piano. */
  ok('e per il secondo in coda la nota si rifa` da zero',
     r.nota !== null && /un foglio 148 × 210 mm/.test(r.nota) &&
     /non c'è più posto libero/.test(r.nota), String(r.nota).slice(0, 130));

  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('alla fine ci sono tutti e due i progetti, piu` il lavoro di prima',
     !r.aperta && r.quanti === 4 && r.nomi[0] === 'in corso.svg' &&
     /dritto/.test(r.nomi[3]) && r.foglio[0] === 148,
     r.quanti + ': ' + r.nomi.join(', ') + ', foglio ' + r.foglio.join('×'));

  /* TRE FOGLI SUL PIANO, uno per progetto, e i quattro livelli ciascuno sul
     suo. E' l'intera ragione per cui la fase 5 esiste: prima i quattro
     livelli finivano tutti sull'A5 di chi c'era, quelli dell'A4 alle
     coordinate dell'A4, cioe' mezzi fuori dal foglio. */
  ok('e sul piano ci sono i tre fogli, un livello per il suo',
     r.fogli.length === 3 && FOG(r, 0)[0] === 148 && FOG(r, 1)[0] === 210 &&
     FOG(r, 2)[0] === 148 && JSON.stringify(r.suFoglio) === '[0,1,1,2]',
     JSON.stringify(r.fogli) + ' livelli su ' + JSON.stringify(r.suFoglio));

  /* Il registro e' la seconda metà dell'avviso: la finestrella si chiude, e
     quello che e' stato deciso deve restare scritto da qualche parte. */
  r = await page.evaluate(() => [...document.querySelectorAll('#log-view .log-line')]
    .slice(-16).map((d) => {
      const s = d.querySelector('span:last-child');
      return s.className.replace('log-', '') + ' ' + s.textContent;
    }));
  ok('il registro racconta l\'aggiunta e il foglio che si e` portata dietro',
     r.some((t) => /^msg Aggiunti 2 livelli dal progetto curvo/.test(t) &&
                   /con un foglio 210 × 297 mm/.test(t)),
     r.filter((t) => /Aggiunti/.test(t)).join(' | ').slice(0, 200));

  /* ================================================================== */
  /* ============ PIU' FOGLI IN UN FILE (fase 5, 2026-11-07) ============ */
  /* ================================================================== */

  /* Il blocco <metadata> del file, decodificato. E' l'unica cosa che conta
     riaprendo: i tracciati disegnati sono un PRODOTTO, li rifa'
     l'appiattimento delle forme. Per questo qui sotto si manomette il
     metadata e non il disegno — e per questo le manomissioni si vedono. */
  const META = (txt) => JSON.parse(
    txt.match(/<metadata id="gdc-cnc2d-progetto">([^<]*)</)[1]
       .replace(/&quot;/g, '"').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

  const CON_META = (txt, st) => {
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');
    return txt.replace(/(<metadata id="gdc-cnc2d-progetto">)[^<]*</,
                       '$1' + esc(JSON.stringify(st)) + '<');
  };

  /* Il riquadro del file e l'ingombro di ogni disegno dentro di lui. */
  const RIQUADRO = (txt) =>
    txt.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);

  const DISEGNI = (txt) => txt.split('\n')
    .filter((l) => l.startsWith('  <g'))
    .map((l) => {
      const xs = [], ys = [];
      l.match(/ d="([^"]*)"/)[1].replace(/[ML]/g, ' ').trim().split(/\s+/)
        .forEach((v, i) => (i % 2 ? ys : xs).push(+v));
      return {
        nome: (l.match(/<title>([^<]*)</) || [])[1],
        x0: Math.min(...xs), x1: Math.max(...xs),
        y0: Math.min(...ys), y1: Math.max(...ys)
      };
    });

  /* LA COMPOSIZIONE DI PROVA, e le sue misure sono scelte una per una.
   *   - foglio 1: 75 × 75 all'angolo (20, 30), col disegno curvo;
   *   - foglio 2: 40 × 40 all'angolo (95, 60), col disegno dritto.
   * Il secondo tocca il primo sul fianco (95 = 20 + 75) e gli si affaccia per
   * quaranta millimetri, quindi e' ACCOSTATO: un angolo da misurare e non
   * due. Ed e' spostato in alto di TRENTA millimetri di proposito: un gruppo
   * posato un foglio per volta, invece di tutto insieme, metterebbe il
   * secondo con la base allineata al primo — accostato lo stesso, ma a trenta
   * millimetri da dove l'operatore l'aveva messo. Senza quel dislivello il
   * controllo 10 passerebbe anche col codice rotto.
   */
  const comp = await page.evaluate(([CURVO, DRITTO]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Paper.setSheetOrigin(20, 30);
    Artwork.load(CURVO, 'curvo.svg');
    const f2 = Fogli.aggiungi(40, 40, 'piccolo');
    Fogli.muovi(f2.id, 95, 60);
    Fogli.scegli(f2.id);
    Artwork.load(DRITTO, 'dritto.svg');
    return Progetto.testo();
  }, [CURVO, DRITTO]);

  /* ============ 7. IL FILE SCRIVE I FOGLI, E CHI STA SU CHI ============ */
  let m = META(comp);
  ok('il file salva tutti i fogli, con le misure e gli angoli',
     m.versione === 2 && m.fogli.length === 2 &&
     m.fogli[0].w === 75 && m.fogli[0].angolo.x === 20 && m.fogli[0].angolo.y === 30 &&
     m.fogli[1].w === 40 && m.fogli[1].angolo.x === 95 && m.fogli[1].angolo.y === 60,
     JSON.stringify(m.fogli));
  ok('e ogni livello dice su quale sta, per numero',
     m.livelli.map((l) => l.foglio).join() === '0,0,1',
     m.livelli.map((l) => l.nome + '→' + l.foglio).join(', '));
  /* Le due chiavi del formato 1 restano, e dicono del PRIMO foglio: un file
     salvato oggi si deve aprire anche su una pagina non aggiornata, che di
     `fogli` non sa niente. */
  ok('e le chiavi del formato 1 restano, sul primo foglio',
     m.foglio && m.foglio.w === 75 && m.angolo && m.angolo.x === 20,
     JSON.stringify(m.foglio) + ' ' + JSON.stringify(m.angolo));

  /* ============ 8. IL DISEGNO E' IN COORDINATE MACCHINA ============
     Il riquadro va da (20,30) a (135,105): 115 × 75. E i due disegni non si
     devono sovrapporre nel file — il secondo sta oltre il confine fra i due
     fogli (x 75 nel riquadro) e sopra di trenta. Scritti in coordinate del
     proprio foglio finirebbero uno sopra l'altro nell'angolo, che e'
     esattamente come si vedrebbe aprendo il file altrove. */
  let riq = RIQUADRO(comp), dis = DISEGNI(comp);
  ok('il riquadro del file contiene tutti i fogli',
     riq[0] === 115 && riq[1] === 75, riq.join(' × '));
  const SUL = (ds, pezzo) => ds.filter((d) => d.nome.indexOf(pezzo) === 0);
  ok('e ogni disegno sta nel pezzo di riquadro del suo foglio',
     dis.length === 3 &&
     SUL(dis, 'curvo').length === 2 &&
     SUL(dis, 'curvo').every((d) => d.x1 <= 75) &&
     SUL(dis, 'dritto').length === 1 &&
     SUL(dis, 'dritto').every((d) => d.x0 >= 75 && d.y0 >= 30),
     dis.map((d) => d.nome + ' x ' + d.x0.toFixed(1) + '–' + d.x1.toFixed(1) +
                    ' y ' + d.y0.toFixed(1) + '–' + d.y1.toFixed(1)).join(' | '));

  /* CON UN FOGLIO SOLO NON CAMBIA NIENTE, e questo e' il controllo che
     protegge i file salvati prima di oggi: il riquadro torna il foglio e i
     tracciati restano in coordinate del foglio — l'angolo (20,30) non entra
     nei numeri. Se entrasse, ogni file vecchio si riaprirebbe spostato. */
  const solo = await page.evaluate(([CURVO]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Paper.setSheetOrigin(20, 30);
    Artwork.load(CURVO, 'curvo.svg');
    return Progetto.testo();
  }, [CURVO]);
  riq = RIQUADRO(solo); dis = DISEGNI(solo);
  ok('con un foglio solo il file e` quello di sempre: niente angolo nei numeri',
     riq[0] === 75 && riq[1] === 75 && dis.length === 2 &&
     dis.every((d) => d.x0 >= 0 && d.x1 <= 75 && d.y0 >= 0 && d.y1 <= 75),
     'riquadro ' + riq.join(' × ') + ', disegni ' +
     dis.map((d) => 'x ' + d.x0.toFixed(1) + '–' + d.x1.toFixed(1) + ' y ' +
                    d.y0.toFixed(1) + '–' + d.y1.toFixed(1)).join(' | '));

  /* ============ 9. RIAPRENDO, L'ACCOSTAMENTO SI RICALCOLA ============ */
  const VUOTO = async (t, nome) => {
    await page.evaluate(([t, nome]) => {
      document.getElementById('btn-clear-file').click();
      while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
      Paper.setSize(148, 210);
      Artwork.load(t, nome);
    }, [t, nome]);
    await page.waitForTimeout(150);
    return STATO(page);
  };

  r = await VUOTO(comp, 'comp.cnc2d.svg');
  ok('riaprendo tornano i due fogli, dove stavano',
     r.fogli.length === 2 &&
     FOG(r, 0).slice(0, 4).join() === '75,75,20,30' &&
     FOG(r, 1).slice(0, 4).join() === '40,40,95,60' &&
     r.suFoglio.join() === '0,0,1',
     JSON.stringify(r.fogli) + ' livelli su ' + JSON.stringify(r.suFoglio));
  ok('e il secondo e` di nuovo accostato al primo: un angolo da misurare',
     FOG(r, 0)[4] === null && FOG(r, 1)[4] === 0 &&
     await page.evaluate(() => Fogli.daMisurare().length) === 1,
     'agganci ' + JSON.stringify([FOG(r, 0)[4], FOG(r, 1)[4]]));

  /* L'ACCOSTAMENTO NON SI LEGGE DAL FILE: si ricalcola da dove stanno i
     fogli. Lo stesso file con il secondo foglio spostato lontano deve dare
     DUE angoli da misurare — se l'aggancio arrivasse dal file (o se si
     fidasse di un campo salvato) il programma direbbe «uno» e la macchina
     andrebbe a disegnare il secondo magnete dove non c'e'. */
  const lontano = CON_META(comp, (() => {
    const st = META(comp);
    st.fogli[1].angolo = { x: 180, y: 160 };
    return st;
  })());
  r = await VUOTO(lontano, 'lontano.cnc2d.svg');
  ok('e staccando i fogli nel file gli angoli da misurare diventano due',
     FOG(r, 1).slice(0, 4).join() === '40,40,180,160' &&
     FOG(r, 1)[4] === null &&
     await page.evaluate(() => Fogli.daMisurare().length) === 2,
     JSON.stringify(r.fogli));

  /* ============ 10. IL GRUPPO SI POSA TUTTO INSIEME ============
     Due fogli accostati nel file devono essere accostati anche sul piano, e
     non per caso: il dislivello di trenta millimetri fra i due deve essere
     ancora trenta. Posati uno per volta si ritroverebbero di fianco con la
     base allineata — accostati, ma non piu' dove l'operatore li aveva messi,
     e quindi con i disegni spostati rispetto alla carta vera. */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'comp.cnc2d.svg'), [comp]);
  await page.waitForTimeout(120);
  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('aggiungendo, il gruppo di fogli si posa tutto insieme',
     r.fogli.length === 3 &&
     FOG(r, 2)[2] - FOG(r, 1)[2] === 75 && FOG(r, 2)[3] - FOG(r, 1)[3] === 30,
     JSON.stringify(r.fogli));
  ok('quindi i due arrivati restano accostati: una misura e non due',
     FOG(r, 2)[4] === 1, 'agganci ' + JSON.stringify(r.fogli.map((f) => f[4])));

  /* ============ 11. LA MISURA NON SI SOVRASCRIVE CON UN'IPOTESI ============
     Se il piano di oggi e' LO STESSO piano del file — tanti fogli quanti,
     delle stesse misure, nello stesso ordine — e un angolo e' stato misurato
     sulla macchina, «Sostituisci tutto» tiene i fogli dove sono. Gli angoli
     nel file sono dove stavano ieri: un'ipotesi. */
  r = await page.evaluate(([t]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Fogli.aggiungi(40, 40, 'piccolo');
    Fogli.poniMisurato(State.data.fogli[0].id, 7, 9);
    Progetto.applica(Progetto.leggi(t), 'comp.cnc2d.svg', false);
    return State.data.fogli.map((f) => [f.w, f.h, f.origine.x, f.origine.y, f.misurato]);
  }, [comp]);
  ok('sostituendo, i fogli misurati oggi restano dove li ha messi la macchina',
     r.length === 2 && r[0][2] === 7 && r[0][3] === 9 && r[0][4] === true &&
     r[1][4] === true, JSON.stringify(r));

  /* E IL CONTRARIO: se il piano di oggi e' un altro piano, non c'e' nessuna
     misura da proteggere e vincono gli angoli del file. */
  r = await page.evaluate(([t]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Fogli.poniMisurato(State.data.fogli[0].id, 7, 9);
    Progetto.applica(Progetto.leggi(t), 'comp.cnc2d.svg', false);
    return State.data.fogli.map((f) => [f.w, f.h, f.origine.x, f.origine.y, f.misurato]);
  }, [comp]);
  ok('ma su un piano diverso vincono gli angoli del file, e nessuno e` misurato',
     r.length === 2 && r[0][2] === 20 && r[0][3] === 30 &&
     r[0][4] === false && r[1][4] === false, JSON.stringify(r));

  /* ============ 12. QUANDO NELLA CORSA NON C'E' PIU' POSTO ============
     Lo si deve dire PRIMA di scegliere. La corsa percorribile e' 241 × 236:
     un foglio da 240 × 230 la riempie, e per il gruppo da 115 × 75 che arriva
     non resta niente. */
  r = await page.evaluate(([DRITTO, t]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(240, 230);
    Paper.setSheetOrigin(0, 0);
    Artwork.load(DRITTO, 'in corso.svg');
    Artwork.load(t, 'comp.cnc2d.svg');
    return { area: [State.data.area.w, State.data.area.h],
             nota: document.getElementById('prog-nota').hidden
               ? null : document.getElementById('prog-nota').textContent };
  }, [DRITTO, comp]);
  ok('se nella corsa non c\'e` posto, la finestrella lo dice prima di scegliere',
     r.nota !== null && /non c'è più posto libero/.test(r.nota) &&
     /2 fogli/.test(r.nota) && /vanno spostati/.test(r.nota),
     'corsa ' + r.area.join(' × ') + ' — ' + String(r.nota).slice(0, 110));

  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await page.evaluate(() => [...document.querySelectorAll('#log-view .log-line')]
    .slice(-8).map((d) => {
      const s = d.querySelector('span:last-child');
      return s.className.replace('log-', '') + ' ' + s.textContent;
    }));
  /* La stessa frase della finestrella, fra gli AVVISI e non fra i messaggi:
     la finestrella si chiude, e quello che non torna deve restare scritto
     dove si guarda quando il foglio esce sbagliato. */
  ok('e dopo lo ridice fra gli avvisi, non fra i messaggi',
     r.some((t) => /^err Attenzione: sul piano non c'è più posto libero/.test(t) &&
                   /2 fogli \(75 × 75 mm, 40 × 40 mm\)/.test(t)),
     r.filter((t) => /posto/.test(t)).join(' | ').slice(0, 120) || r.slice(-2).join(' | '));

  /* E QUANDO IL POSTO C'E' NON SI DICE NIENTE. Un avviso che compare sempre
     e' un avviso che non si legge piu', e questo e' il caso vero dei magneti:
     un quadrato sul piano, il gruppo da 115 × 75 che arriva, e nella corsa da
     241 × 236 ci stanno tutti. */
  r = await page.evaluate(([DRITTO, t]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Paper.setSheetOrigin(0, 0);
    Artwork.load(DRITTO, 'in corso.svg');
    Artwork.load(t, 'comp.cnc2d.svg');
    return document.getElementById('prog-nota').hidden
      ? null : document.getElementById('prog-nota').textContent;
  }, [DRITTO, comp]);
  ok('e quando nella corsa c\'e` posto non si dice niente', r === null, String(r));
  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('e i tre fogli ci stanno tutti dentro la corsa',
     r.fogli.length === 3 &&
     await page.evaluate(() => Fogli.fuoriCorsa().length) === 0 &&
     await page.evaluate(() => Fogli.sovrapposti().length) === 0,
     JSON.stringify(r.fogli));

  /* ============ 13. UN PROGETTO DEL FORMATO 1 SI APRE ANCORA ============
     Un file salvato prima del 7 novembre non ha l'elenco `fogli`: ha un
     foglio solo, scritto nelle due chiavi di allora. Deve aprirsi come
     sempre, con il suo foglio e i livelli sopra. */
  const vecchio = CON_META(salvato, (() => {
    const st = META(salvato);
    delete st.fogli;
    st.versione = 1;
    st.livelli.forEach((l) => { delete l.foglio; });
    return st;
  })());
  r = await VUOTO(vecchio, 'vecchio.cnc2d.svg');
  ok('un progetto del formato 1 si apre ancora, col suo foglio solo',
     r.fogli.length === 1 && FOG(r, 0).slice(0, 2).join() === '210,297' &&
     r.quanti === 2 && r.suFoglio.join() === '0,0' && r.attivo === 0,
     JSON.stringify(r.fogli) + ', ' + r.quanti + ' livelli su ' +
     JSON.stringify(r.suFoglio));

  /* ============ 14. SULLO STESSO PIANO I LIVELLI SI APPOGGIANO ============
   *
   * IL CASO VERO, quello del 6 novembre: «carico un file perche' mi servono
   * alcune parti da quello, poi un altro perche' altre parti mi servono da
   * quest'altro». Sono due progetti salvati sullo STESSO formato, e le parti
   * devono finire sulla STESSA carta. Portargli un secondo A4 accanto al
   * primo risolverebbe il problema sbagliato: due fogli da stampare dove ne
   * vuole uno.
   */
  r = await page.evaluate(([CURVO, t]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(210, 297);
    Paper.setSheetOrigin(0, 0);
    Artwork.load(CURVO, 'in corso.svg');
    Artwork.load(t, 'curvo.cnc2d.svg');
    return { desc: document.getElementById('prog-desc').textContent,
             nota: document.getElementById('prog-nota').hidden
               ? null : document.getElementById('prog-nota').textContent };
  }, [CURVO, salvato]);
  ok('sullo stesso piano la finestrella dice che i livelli si appoggiano',
     /il piano è già quello di questo progetto/.test(r.desc) &&
     /non arriva altra carta/.test(r.desc) && r.nota === null,
     r.desc.slice(0, 200));

  await page.click('#prog-aggiungi');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('e si appoggiano davvero: un foglio solo, e tutti i livelli sopra',
     r.fogli.length === 1 && FOG(r, 0).slice(0, 4).join() === '210,297,0,0' &&
     r.quanti === 4 && r.suFoglio.join() === '0,0,0,0',
     JSON.stringify(r.fogli) + ', ' + r.quanti + ' livelli su ' +
     JSON.stringify(r.suFoglio));

  /* E il registro lo dice: i fogli non sono arrivati perche' c'erano gia'. */
  r = await page.evaluate(() => [...document.querySelectorAll('#log-view .log-line')]
    .slice(-4).map((d) => {
      const s = d.querySelector('span:last-child');
      return s.className.replace('log-', '') + ' ' + s.textContent;
    }));
  ok('e il registro dice che non e` arrivata altra carta',
     r.some((t) => /^msg Aggiunti 2 livelli/.test(t) &&
                   /sui fogli che c'erano/.test(t) &&
                   /senza portare altra carta/.test(t)),
     r.filter((t) => /Aggiunti/.test(t)).join(' | ').slice(0, 170));

  /* ============ 15. UN PIANO CON PIU' FOGLI E' LAVORO DA PERDERE ============
     Senza livelli sopra non si chiede niente: una domanda con una risposta
     sola e' un clic in piu'. Ma nove magneti posati uno contro l'altro — e
     magari con l'angolo misurato — sono mezz'ora di lavoro, e «sostituisci
     tutto» li butterebbe in silenzio. */
  r = await page.evaluate(([t]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(75, 75);
    Paper.setSheetOrigin(0, 0);
    Fogli.aggiungi(75, 75, 'secondo');
    Artwork.load(t, 'curvo.cnc2d.svg');
    return { aperta: !document.getElementById('prog-modal').hidden,
             fogli: State.data.fogli.length,
             livelli: Artwork.livelli().length };
  }, [salvato]);
  ok('col piano a piu` fogli si chiede anche senza un livello sopra',
     r.aperta && r.fogli === 2 && r.livelli === 0,
     'finestrella ' + (r.aperta ? 'aperta' : 'chiusa') + ', ' + r.fogli +
     ' fogli, ' + r.livelli + ' livelli');
  await page.click('#prog-annulla');
  await page.waitForTimeout(120);
  r = await page.evaluate(() => State.data.fogli.length);
  ok('e «Annulla» lascia i due fogli dove sono', r === 2, r + ' fogli');

  /* ================================================================== */
  /* ============ LA SCELTA DEI LIVELLI (2026-11-08) ============ */
  /* ================================================================== */

  /* Lo stato della finestrella per quello che riguarda la scelta. */
  const SCELTA = (pg) => pg.evaluate(() => ({
    aperta: !document.getElementById('prog-scelta').hidden,
    righe: [...document.querySelectorAll('#prog-elenco .prog-liv')].map((r) => ({
      nome: r.querySelector('.prog-liv-nome').textContent,
      preso: r.querySelector('input').checked,
      fog: r.querySelector('.prog-liv-fog')
             ? r.querySelector('.prog-liv-fog').textContent : null
    })),
    conto: document.getElementById('prog-scelta-n').textContent,
    agg: document.getElementById('prog-aggiungi').textContent,
    sos: document.getElementById('prog-sostituisci').textContent,
    spenti: document.getElementById('prog-aggiungi').disabled &&
            document.getElementById('prog-sostituisci').disabled
  }));

  const SPUNTA = (pg, quali) => pg.evaluate(([quali]) => {
    document.getElementById('prog-nessuno').click();
    quali.forEach((i) => {
      const c = document.querySelector('input[data-liv="' + i + '"]');
      c.checked = true;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, [quali]);

  /* ============ 16. DUE SU SEI, E ARRIVANO SOLO QUELLI ============
     Il caso dell'operatore del 6 novembre: «mi servono ALCUNE parti da
     quello». Il progetto qui ha sei livelli su tre fogli — due per foglio —
     e se ne prendono due, di due fogli diversi. */
  const tre = await page.evaluate(([CURVO]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(60, 60);
    Paper.setSheetOrigin(0, 0);
    Artwork.load(CURVO, 'uno.svg');
    for (let i = 2; i <= 3; i++) {
      const f = Fogli.aggiungi(60, 60, 'f' + i);
      Fogli.scegli(f.id);
      Artwork.load(CURVO, 'f' + i + '.svg');
    }
    return Progetto.testo();
  }, [CURVO]);

  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'tre.cnc2d.svg'), [tre]);
  await page.waitForTimeout(150);
  let sc = await SCELTA(page);
  ok('la scelta compare, con tutti i livelli presi di partenza',
     sc.aperta && sc.righe.length === 6 && sc.righe.every((x) => x.preso) &&
     /tutti presi/.test(sc.conto) && /Aggiungi i livelli/.test(sc.agg),
     sc.righe.length + ' righe, «' + sc.conto + '», «' + sc.agg + '»');
  ok('e ogni riga dice su che foglio di quel progetto sta',
     sc.righe[0].fog === 'foglio 1' && sc.righe[2].fog === 'foglio 2' &&
     sc.righe[4].fog === 'foglio 3',
     sc.righe.map((x) => x.fog).join(', '));

  await SPUNTA(page, [0, 4]);
  await page.waitForTimeout(100);
  sc = await SCELTA(page);
  ok('togliendone, il conto e i pulsanti dicono quanti ne restano',
     /2 su 6 presi/.test(sc.conto) && /Aggiungi i 2 scelti/.test(sc.agg) &&
     /Sostituisci con i 2/.test(sc.sos),
     '«' + sc.conto + '» — «' + sc.agg + '» — «' + sc.sos + '»');

  await page.click('#prog-aggiungi');
  await page.waitForTimeout(200);
  r = await STATO(page);
  ok('e arrivano SOLO i due scelti',
     r.quanti === 3 && r.nomi[0] === 'in corso.svg' &&
     /uno\.svg/.test(r.nomi[1]) && /f3\.svg/.test(r.nomi[2]),
     r.quanti + ': ' + r.nomi.join(', '));

  /* ============ 17. E SOLO I FOGLI CHE SERVONO ============
     Portarne nove per due livelli vorrebbe dire sette rettangoli vuoti da
     togliere a mano, e un «;FOGLIO n/N» che conta carta che non si stampa.
     I due arrivati stanno sul foglio 1 e sul foglio 3 del file, quindi di
     fogli ne arrivano DUE — e con la geometria che avevano. Nel file i tre
     fogli stanno a (0,0), (60,0) e (0,60): prendendo il primo e il terzo,
     quello che arriva dopo deve stare 60 mm PIU' IN ALTO e nella stessa
     colonna, come stava li`. Il foglio 2 non viene, ma il posto che aveva
     non si richiude: la geometria che resta e` quella del file. */
  ok('e con loro arrivano due fogli soli, non tre',
     r.fogli.length === 3 && FOG(r, 1)[0] === 60 && FOG(r, 2)[0] === 60 &&
     r.suFoglio.join() === '0,1,2',
     JSON.stringify(r.fogli) + ' livelli su ' + JSON.stringify(r.suFoglio));
  ok('e conservano la distanza che avevano nel file',
     FOG(r, 2)[2] === FOG(r, 1)[2] && FOG(r, 2)[3] - FOG(r, 1)[3] === 60,
     'angoli ' + JSON.stringify([FOG(r, 1).slice(2, 4), FOG(r, 2).slice(2, 4)]));

  /* Il registro lo dice: quelli lasciati non sono spariti, sono nel file. */
  r = await page.evaluate(() => [...document.querySelectorAll('#log-view .log-line')]
    .slice(-4).map((d) => d.querySelector('span:last-child').textContent));
  ok('e il registro dice quanti ne hai lasciati, e dove sono',
     r.some((t) => /hai preso 2 livelli su 6/.test(t) &&
                   /rimasti nel file/.test(t)),
     r.filter((t) => /hai preso/.test(t)).join(' | ').slice(0, 140));

  /* ============ 18. SENZA NESSUNO PRESO NON SI FA NIENTE ============ */
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'tre.cnc2d.svg'), [tre]);
  await page.waitForTimeout(150);
  await page.click('#prog-nessuno');
  await page.waitForTimeout(100);
  sc = await SCELTA(page);
  ok('con nessun livello preso i due pulsanti si spengono',
     sc.spenti && sc.righe.every((x) => !x.preso), '«' + sc.conto + '»');

  /* E Invio nemmeno: un pulsante spento e un tasto che fa la stessa cosa
     devono dire la stessa cosa, se no il tasto e` una scorciatoia per
     saltare un controllo. */
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  r = await STATO(page);
  ok('e Invio non fa quello che il pulsante spento non fa',
     r.aperta && r.quanti === 1, 'finestrella ' +
     (r.aperta ? 'aperta' : 'chiusa') + ', ' + r.quanti + ' livelli');

  await page.click('#prog-tutti');
  await page.waitForTimeout(100);
  sc = await SCELTA(page);
  ok('«Tutti» li riprende tutti, e i pulsanti si riaccendono',
     !sc.spenti && sc.righe.every((x) => x.preso) && /tutti presi/.test(sc.conto),
     '«' + sc.conto + '»');
  await page.click('#prog-annulla');
  await page.waitForTimeout(100);

  /* ============ 19. LA SPUNTA E' DI QUEL PROGETTO ============
     Due file trascinati insieme: la scelta fatta sul primo non deve
     ritrovarsi sul secondo, e il secondo deve partire da capo con tutti
     presi. La spunta sta sulla voce della coda apposta. */
  await SCENA();
  await page.evaluate(([a, b]) => {
    Artwork.load(a, 'tre.cnc2d.svg');
    Artwork.load(b, 'curvo.cnc2d.svg');
  }, [tre, salvato]);
  await page.waitForTimeout(150);
  await SPUNTA(page, [1]);
  await page.waitForTimeout(100);
  await page.click('#prog-aggiungi');
  await page.waitForTimeout(200);
  sc = await SCELTA(page);
  r = await STATO(page);
  ok('il secondo progetto in coda parte con tutti i suoi presi',
     r.aperta && /curvo/.test(r.titolo) && sc.righe.length === 2 &&
     sc.righe.every((x) => x.preso),
     r.titolo + ', ' + sc.righe.length + ' righe, «' + sc.conto + '»');
  await page.click('#prog-annulla');
  await page.waitForTimeout(100);
  r = await STATO(page);
  ok('e del primo era arrivato solo il livello scelto',
     r.quanti === 2 && r.nomi[1] === 'uno.svg · tratto #c8102e',
     r.quanti + ': ' + r.nomi.join(', '));

  /* Con UN livello solo la casella avrebbe una risposta sola: non compare. */
  const uno = await page.evaluate(([DRITTO]) => {
    document.getElementById('btn-clear-file').click();
    while (State.data.fogli.length > 1) Fogli.togli(State.data.fogli[1].id);
    Paper.setSize(100, 100);
    Artwork.load(DRITTO, 'solo.svg');
    return Progetto.testo();
  }, [DRITTO]);
  await SCENA();
  await page.evaluate(([t]) => Artwork.load(t, 'solo.cnc2d.svg'), [uno]);
  await page.waitForTimeout(150);
  sc = await SCELTA(page);
  ok('con un livello solo la scelta non compare',
     !sc.aperta && sc.righe.length === 0, 'elenco ' +
     (sc.aperta ? 'visibile' : 'nascosto'));
  await page.click('#prog-annulla');
  await page.waitForTimeout(100);

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
