/* Il collaudo delle due cose nuove del foglio: il COLORE della carta e lo
 * SPESSORE del tratto, livello per livello.
 *
 * Gira sulla pagina costruita, nel browser vero, perche' queste due vivono
 * fra il profilo, l'SVG e l'elenco dei livelli: provarle a pezzi vorrebbe
 * dire provare tre cose che nessuno usa separate.
 *
 * LA COSA CHE SI CONTROLLA DAVVERO non e' «il foglio e' diventato nero»: e'
 * che il colore e lo spessore arrivino fin dove servono -- il rettangolo sul
 * piano, la larghezza dei tratti in millimetri veri, il file del progetto --
 * e che NON arrivino dove non devono, cioe' nel G-code. Un numero che
 * cambiasse la macchina senza dirlo sarebbe il difetto peggiore di tutti,
 * perche' si vedrebbe solo sulla carta.
 *
 * Ogni controllo qui dentro e' stato provato ROMPENDO IL CODICE DI PROPOSITO:
 * un controllo che non si accende quando il codice e' rotto non e' un
 * controllo, e' una decorazione. Vedi tools/rompi.py.
 *
 * Uso:  node webui/tools/prova-foglio.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* ==================== IL COLORE DELLA CARTA ==================== */

  /* Di partenza non c'e' nessun colore dichiarato, e il foglio e' bianco.
     I due stati sono diversi e devono restarlo: «bianco» e «non l'ho detto»
     si disegnano uguale ma il secondo non mette il pallino sul formato. */
  r = await page.evaluate(() => ({
    dichiarato: Profile.coloreFoglio(210, 297),
    effettivo: Profile.coloreFoglioEffettivo(210, 297),
    fill: document.querySelector('.sheet').style.fill,
    pallini: document.querySelectorAll('.preset-carta').length
  }));
  ok('senza colore dichiarato il foglio e` bianco', r.dichiarato === null &&
     r.effettivo === '#f7f5f0' && /247/.test(r.fill),
     'dichiarato ' + r.dichiarato + ', disegnato ' + r.fill);
  ok('e nessun formato porta il pallino della carta', r.pallini === 0,
     r.pallini + ' pallini');

  /* La finestrella di un formato ISO: solo la carta. Nome e misure di un A4
     non sono tue da cambiare, e lasciarli scrivibili vorrebbe dire lasciar
     salvare un «A4 150 × 150». */
  await page.hover('.preset-wrap:has([data-fog-colore="210x297"])');
  await page.waitForTimeout(80);
  await page.click('[data-fog-colore="210x297"]');
  await page.waitForTimeout(120);
  r = await page.evaluate(() => ({
    aperta: !document.getElementById('fog-modal').hidden,
    titolo: document.getElementById('fog-titolo').textContent,
    nome: document.getElementById('fog-nome').disabled,
    w: document.getElementById('fog-w').disabled,
    carte: document.querySelectorAll('#fog-carte .carta').length
  }));
  ok('la finestrella di un formato ISO apre sulla carta', r.aperta &&
     /A4/.test(r.titolo) && r.carte >= 4, r.titolo + ', ' + r.carte + ' carte');
  ok('col nome e le misure bloccati', r.nome === true && r.w === true,
     'nome ' + r.nome + ', larghezza ' + r.w);

  /* ANNULLA DEVE ANNULLARE. Il colore scelto nella finestrella sta in una
     variabile e non nel profilo: scrivendolo subito, la carta sarebbe gia'
     cambiata e il pulsante Annulla non avrebbe niente da annullare. */
  await page.click('#fog-carte [data-carta="#1d1d1b"]');
  await page.waitForTimeout(60);
  r = await page.evaluate(() => ({
    acceso: !!document.querySelector('#fog-carte .carta.ora'),
    profilo: Profile.coloreFoglio(210, 297)
  }));
  ok('la carta scelta si accende senza toccare il profilo',
     r.acceso === true && r.profilo === null, 'nel profilo: ' + r.profilo);
  await page.click('#fog-annulla');
  await page.waitForTimeout(80);
  r = await page.evaluate(() => Profile.coloreFoglio(210, 297));
  ok('e Annulla la butta via', r === null, 'nel profilo: ' + r);

  /* Salvata, la carta arriva al rettangolo sul piano -- che e' quello che
     l'utente ha chiesto -- e ci arriva come STILE: la regola `.sheet` del
     foglio di stile vince su un attributo di presentazione, e con
     l'attributo il foglio sarebbe rimasto bianco. */
  await page.hover('.preset-wrap:has([data-fog-colore="210x297"])');
  await page.waitForTimeout(80);
  await page.click('[data-fog-colore="210x297"]');
  await page.click('#fog-carte [data-carta="#1d1d1b"]');
  await page.click('#fog-ok');
  await page.waitForTimeout(120);
  r = await page.evaluate(() => {
    Paper.setSize(210, 297);
    const s = document.querySelector('.sheet');
    return { fill: s.style.fill, classe: s.getAttribute('class'),
             pallini: document.querySelectorAll('.preset-carta').length,
             didascalia: document.getElementById('stage-caption').textContent,
             girato: (Paper.setSize(297, 210), Profile.coloreFoglio(297, 210)) };
  });
  ok('salvata, il foglio sul piano diventa di quella carta',
     /29, 29, 27/.test(r.fill), r.fill);
  ok('e un foglio scuro prende il bordo chiaro',
     /sheet-scuro/.test(r.classe), r.classe);
  ok('il formato porta il pallino della carta', r.pallini === 1,
     r.pallini + ' pallini');
  ok('la didascalia dice il nome della carta', /carta nera/.test(r.didascalia),
     r.didascalia.slice(0, 90));
  /* UN FOGLIO GIRATO E` LO STESSO FOGLIO. La chiave e' la misura ordinata
     apposta: un A4 per il lungo e' la stessa risma, e dover scegliere la
     carta due volte sarebbe un modo di avere meta' dei fogli bianchi. */
  ok('girato per il lungo e` la stessa carta', r.girato === '#1d1d1b', r.girato);

  /* Il colore NON sta nel profilo di stampa: cambiare profilo non fa
     diventare bianco il cartoncino nero. Sta accanto ai formati, al primo
     livello, e per lo stesso motivo. */
  r = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('gdc.cnc2d.profilo'));
    return { fuori: Array.isArray(p.coloriFoglio) ? p.coloriFoglio.length : -1,
             dentro: p.stampa && 'coloriFoglio' in p.stampa };
  });
  ok('la carta sta accanto ai formati, non nel profilo di stampa',
     r.fuori === 1 && r.dentro === false,
     r.fuori + ' voci fuori, dentro: ' + r.dentro);

  /* E RIAPRENDO LA PAGINA c'e' ancora. `fondi()` ricopia solo le chiavi che
     conosce, quindi una MAPPA libera tornerebbe vuota al primo
     caricamento -- e' l'inciampo per cui qui c'e' un elenco. */
  await page.reload();
  await page.waitForTimeout(400);
  r = await page.evaluate(() => ({
    salvato: Profile.coloreFoglio(210, 297),
    carte: Paper.carte().length
  }));
  ok('e riaprendo la pagina la carta c\'e` ancora', r.salvato === '#1d1d1b',
     'riletto: ' + r.salvato);

  /* ==================== LO SPESSORE DEL TRATTO ==================== */

  await page.click('#btn-sample');
  await page.waitForTimeout(600);

  r = await page.evaluate(() => ({
    righe: document.querySelectorAll('.liv-riga').length,
    trattini: document.querySelectorAll('.spess').length,
    vuoti: document.querySelectorAll('.spess.vuoto').length,
    spessore: Artwork.livelli()[0].spessore
  }));
  ok('ogni livello ha il suo trattino, vuoto finche` non si scegli',
     r.trattini === r.righe && r.vuoti === r.righe && r.spessore === null,
     r.trattini + ' trattini su ' + r.righe + ' righe, ' + r.vuoti + ' vuoti');

  /* Due spessori aggiunti agli estremi, uno sottile e uno grosso: coi soli
     quattro di serie, che nascono in ordine, un elenco che non ordina niente
     passerebbe lo stesso. */
  await page.evaluate(() => {
    Artwork.aggiungiSpessore(2.5, 'pennello');
    Artwork.aggiungiSpessore(0.15, 'ago');
  });
  const id = await page.evaluate(() => Artwork.livelli()[0].id);
  await page.hover(`.spess[data-spess="${id}"]`);
  await page.waitForTimeout(220);
  r = await page.evaluate(() => ({
    aperto: !!document.querySelector('.tavolozza'),
    titolo: (document.querySelector('.tavolozza .tav-titolo') || {}).textContent,
    mm: [...document.querySelectorAll('.tavolozza [data-sp]')].map((b) => +b.dataset.sp),
    nomi: [...document.querySelectorAll('.tavolozza .sp-riga .tav-nome')]
            .map((x) => x.textContent),
    scritti: [...document.querySelectorAll('.tavolozza .sp-mm')].map((x) => x.textContent),
    piede: (document.querySelector('.tav-piede') || {}).textContent
  }));
  ok('il trattino apre gli spessori al passaggio', r.aperto === true &&
     /Spessore/.test(r.titolo || ''), r.titolo);
  ok('con i nomi e i millimetri scritti', r.nomi.length >= 4 &&
     r.nomi.indexOf('tratto pen') >= 0 && r.nomi.indexOf('indelebile') >= 0 &&
     r.scritti.indexOf('0,5 mm') >= 0,
     r.nomi.join(', ') + ' — ' + r.scritti.join(' '));
  ok('e in ordine crescente, compresi i due aggiunti adesso',
     r.mm.length === 6 && r.mm[0] === 0.15 && r.mm[5] === 2.5 &&
     r.mm.join() === r.mm.slice().sort((a, b) => a - b).join(),
     r.mm.join(' '));
  ok('e scritto che non cambia il G-code', /G-code/.test(r.piede || ''), r.piede);

  /* LA COSA CHE CONTA: i millimetri arrivano al tratto. Dentro all'SVG si
     disegna in millimetri -- c'e' la viewBox -- quindi `stroke-width: 0.8`
     e' una riga larga 0,8 mm sulla carta. */
  await page.click('.tavolozza [data-sp="0.8"]');
  await page.waitForTimeout(350);
  r = await page.evaluate(() => {
    const d = [...document.querySelectorAll('#layer-trace .trace-draw')];
    const m = [...document.querySelectorAll('#layer-trace .trace-move')];
    return { scelto: Artwork.livelli()[0].spessore,
             larghezze: [...new Set(d.map((x) => x.style.strokeWidth))],
             quanti: d.length,
             spostamenti: [...new Set(m.map((x) => x.style.strokeWidth))],
             barra: (document.querySelector('.spess .sp-barra') || {}).style,
             vuoti: document.querySelectorAll('.spess.vuoto').length };
  });
  ok('scelto, i tratti sul foglio sono larghi quei millimetri',
     r.scelto === 0.8 && r.larghezze.length === 1 && r.larghezze[0] === '0.8' &&
     r.quanti > 50, r.quanti + ' tratti a ' + r.larghezze.join('/'));
  /* Uno spostamento a penna alzata non e' inchiostro: largo come il tratto
     direbbe che la penna ha scritto anche li'. */
  ok('e gli spostamenti a penna alzata restano sottili',
     r.spostamenti.every((x) => !x), 'larghezze: ' + JSON.stringify(r.spostamenti));
  ok('il trattino nella riga non e` piu` vuoto', r.vuoti === 0 && !!r.barra,
     r.vuoti + ' vuoti');

  /* DUE LIVELLI, DUE SPESSORI: e' il caso per cui serve. Un solo numero per
     tutto il disegno si sarebbe potuto mettere nelle impostazioni, e non
     sarebbe servito a niente -- il motivo per cui questa cosa esiste e'
     avere le lettere col pennarello e il tratteggio con la punta fine. */
  await page.click('#btn-logo-cnc2d');
  await page.waitForTimeout(400);
  const ids = await page.evaluate(() => Artwork.livelli().map((l) => l.id));
  r = await page.evaluate((ids) => {
    Artwork.scegliSpessore(ids[0], 0.3);
    Artwork.scegliSpessore(ids[1], 1.5);
    const di = State.data.artDi || [];
    const per = {};
    [...document.querySelectorAll('#layer-trace .trace-draw')].forEach(function (x) {
      per[x.style.strokeWidth] = (per[x.style.strokeWidth] || 0) + 1;
    });
    return { larghezze: Object.keys(per).sort(), conta: per,
             primo: Artwork.spessoreLivello(ids[0]),
             secondo: Artwork.spessoreLivello(ids[1]) };
  }, ids);
  ok('due livelli, due larghezze sul foglio insieme',
     ids.length === 2 && r.primo === 0.3 && r.secondo === 1.5 &&
     r.larghezze.length === 2 && r.larghezze.indexOf('0.3') >= 0 &&
     r.larghezze.indexOf('1.5') >= 0,
     r.larghezze.join(' e ') + ' — ' + JSON.stringify(r.conta));

  /* LO SPESSORE E` UNA SCELTA DI CHI STAMPA, come la penna, quindi va nel
     file del progetto e torna indietro riaprendolo. */
  r = await page.evaluate(() => {
    const id = Artwork.livelli()[0].id;
    Artwork.scegliSpessore(id, 0.8);
    const salvato = Artwork.progetto().livelli[0].spessore;
    const copia = JSON.parse(JSON.stringify(Artwork.progetto().livelli));
    Artwork.daProgetto(copia);
    return { salvato: salvato, ripreso: Artwork.livelli()[0].spessore };
  });
  ok('lo spessore va nel progetto e torna indietro',
     r.salvato === 0.8 && r.ripreso === 0.8,
     'salvato ' + r.salvato + ', ripreso ' + r.ripreso);

  /* E NON ENTRA NEL G-CODE. La macchina non sa quanto e' larga la punta che
     le hai montato: un numero che non comanda niente, in un file che comanda
     tutto, sarebbe solo un modo di sbagliarsi. */
  r = await page.evaluate(() => {
    const id = Artwork.livelli()[0].id;
    const fuori = document.getElementById('gcode-out');
    Artwork.scegliSpessore(id, null);
    Artwork.prepare();
    const sottile = fuori.value;
    Artwork.scegliSpessore(id, 1.5);
    Artwork.prepare();
    const grosso = fuori.value;
    return { uguali: sottile === grosso,
             righe: grosso ? grosso.split('\n').length : 0 };
  });
  /* Il confronto vale solo su un programma che esiste: due stringhe vuote
     sono identiche e non dimostrano niente. */
  ok('il G-code non cambia di una virgola',
     r.righe > 100 && r.uguali === true,
     r.righe + ' righe, ' + (r.uguali ? 'identiche' : 'DIVERSE'));

  /* ============ LA PENNA CHE NON SI VEDE SULLA CARTA ============ */

  /* Non e' un difetto dell'anteprima: e' una stampa che esce vuota. Succede
     davvero -- nero su cartoncino nero -- e si scopre dopo venti minuti di
     macchina se nessuno lo dice prima. */
  r = await page.evaluate(() => {
    const el = document.getElementById('liv-penne');
    const tutti = Artwork.livelli().map((l) => l.id);
    /* TUTTI i livelli, non il primo: la nota parla del disegno, e lasciarne
       uno nero direbbe che resta accesa per colpa della penna bianca. */
    tutti.forEach((id) => Artwork.scegliPenna(id, '#1d1d1b'));
    Paper.setSize(210, 297);                 // l'A4 che abbiamo fatto nero
    const acceso = { nascosto: el.hidden, testo: el.textContent };
    tutti.forEach((id) => Artwork.scegliPenna(id, '#f7f5f0'));  // bianca: si vede
    const spento = { nascosto: el.hidden, testo: el.textContent };
    return { acceso: acceso, spento: spento, quanti: tutti.length,
             contrasto: +Paper.contrasto('#1d1d1b', '#1d1d1b').toFixed(2) };
  });
  ok('nero su carta nera: l\'elenco lo dice',
     r.acceso.nascosto === false && /colore della carta/.test(r.acceso.testo),
     r.acceso.testo.slice(0, 110));
  ok('bianco sulla stessa carta: non dice niente',
     /colore della carta/.test(r.spento.testo) === false,
     r.spento.nascosto ? 'nota spenta' : r.spento.testo.slice(0, 80));

  /* ============ IL SEGNO DI QUANTO E` GIA` STATO FATTO ============
     Non e' roba nuova di oggi: e' un difetto che c'era gia' e che si e'
     visto lavorando qui. Il colore della penna si scrive come stile sulla
     riga, e uno stile sulla riga batte qualsiasi regola del foglio di stile:
     da quando i livelli hanno una penna, `.trace-done` non coloriva piu'
     niente su nessun disegno colorato. Si vedeva solo sui livelli senza
     tinta -- quelli disegnati a mano -- cioe' quasi mai. */
  r = await page.evaluate(() => {
    const sl = document.getElementById('scrub');
    sl.value = 500;
    sl.dispatchEvent(new Event('input', { bubbles: true }));
    const fatti = [...document.querySelectorAll('#layer-trace .trace-done')];
    const accento = getComputedStyle(document.documentElement)
                      .getPropertyValue('--accent').trim();
    return { quanti: fatti.length,
             inline: fatti.length ? fatti[0].getAttribute('style') : null,
             tinta: fatti.length ? getComputedStyle(fatti[0]).stroke : null,
             accento: accento };
  });
  ok('il tratto gia` percorso si colora anche con la penna scelta',
     r.quanti > 10 && /stroke:/.test(r.inline || '') &&
     r.tinta === 'rgb(76, 154, 255)',
     r.quanti + ' tratti fatti, stile riga «' + r.inline + '», disegnato ' + r.tinta);

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
