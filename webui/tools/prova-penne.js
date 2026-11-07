/* Il collaudo di QUANDO DUE LIVELLI VOGLIONO PENNE DIVERSE.
 *
 * Fino al 2026-11-03 la risposta era il colore, e con lo spessore nato il
 * giorno prima e' diventata sbagliata nel verso peggiore: due livelli neri a
 * 0,3 e a 0,8 sono DUE PENNE, e l'elenco diceva «questa fermata e' inutile,
 * toglila» di una fermata che serve davvero. Un consiglio che rompe la
 * stampa e' peggio di nessun consiglio.
 *
 * I quattro casi che contano, e sono quattro perche' sbagliano in quattro
 * modi diversi:
 *   1. stessa penna, fermata in mezzo      -> e' una fermata sprecata
 *   2. penne diverse, fermata in mezzo     -> va bene cosi', e non si dice niente
 *   3. penne diverse, NESSUNA fermata      -> il foglio esce sbagliato
 *   4. stesso colore, spessori diversi     -> e' il caso 3 travestito
 *
 * Uso:  node webui/tools/prova-penne.js
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGINA = 'file://' + path.resolve(__dirname, '..', 'dist', 'cnc2d-ui.html');

let guai = 0;
function ok(nome, vero, extra) {
  console.log((vero ? 'ok  ' : 'KO  ') + nome + (extra ? '   ' + extra : ''));
  if (!vero) guai++;
}

/* Due livelli con le penne che si vogliono, e la fermata o no. Si parte
   sempre da zero: due disegni importati e poi riverniciati. */
const SCENA = async (page, a, b, fermata) => page.evaluate(([a, b, fermata]) => {
  /* Si svuota per davvero: `nuovo()` aggiunge un livello, non toglie gli
     altri, e una scena costruita sopra la precedente misura la somma delle
     due. Se ne era accorto questo banco al primo giro, con «7 cambi penna
     evitabili» su due livelli. */
  document.getElementById('btn-clear-file').click();
  document.getElementById('btn-sample').click();
  document.getElementById('btn-logo-cnc2d').click();
  const l = Artwork.livelli();
  Artwork.scegliPenna(l[0].id, a.colore);
  Artwork.scegliSpessore(l[0].id, a.mm || null);
  Artwork.scegliPenna(l[1].id, b.colore);
  Artwork.scegliSpessore(l[1].id, b.mm || null);
  if (Artwork.livelli()[1].cambioPenna !== fermata) {
    document.querySelector('[data-penna="' + l[1].id + '"]').click();
  }
  const el = document.getElementById('liv-penne');
  const bot = document.querySelector('[data-penna="' + l[1].id + '"]');
  const st = getComputedStyle(bot);
  /* IL COLORE E L'ANELLO, letti come li vede l'occhio e non come sono
     scritti nel foglio di stile: «acceso» e «ne manca una» devono
     distinguersi, e dal 2026-11-08 si distinguono per il COLORE della
     matita — non per un contorno da un pixel. Serve anche la matita di un
     livello senza niente, per avere il grigio normale con cui confrontare:
     senza quello, «il colore e` giusto» non vuol dire niente. */
  const normale = getComputedStyle(
    document.querySelector('[data-penna="' + l[0].id + '"]')).color;
  return { nascosto: el.hidden, testo: el.textContent,
           fermata: Artwork.livelli()[1].cambioPenna,
           segnato: bot.className.indexOf('manca') >= 0,
           colore: st.color, anello: st.boxShadow, normale: normale,
           titolo: bot.title };
}, [a, b, fermata]);

const NERO = '#1d1d1b', ROSSO = '#c8102e';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await page.goto(PAGINA);
  await page.waitForTimeout(400);

  let r;

  /* 1. STESSA PENNA CON UNA FERMATA IN MEZZO: si smonta e si rimonta la
        penna che c'e' gia'. */
  r = await SCENA(page, { colore: NERO, mm: 0.5 }, { colore: NERO, mm: 0.5 }, true);
  ok('stessa penna con la fermata: dice che e` sprecata',
     /fra livelli della stessa penna/.test(r.testo) && r.fermata === true,
     r.testo.slice(0, 90));

  /* 2. PENNE DIVERSE CON LA FERMATA: e' giusto cosi', e non si dice niente.
        Un avviso che compare quando va tutto bene insegna a non leggere gli
        avvisi. */
  r = await SCENA(page, { colore: NERO, mm: 0.5 }, { colore: ROSSO, mm: 0.5 }, true);
  ok('penne diverse con la fermata: non dice niente',
     r.nascosto === true && r.segnato === false,
     r.nascosto ? 'nota spenta' : r.testo.slice(0, 90));

  /* 3. PENNE DIVERSE SENZA FERMATA: il secondo livello uscirebbe disegnato
        con la penna del primo, e si scopre a stampa finita. */
  r = await SCENA(page, { colore: NERO, mm: 0.5 }, { colore: ROSSO, mm: 0.5 }, false);
  ok('colori diversi senza fermata: lo dice',
     /Manca un cambio penna/.test(r.testo) && /colore/.test(r.testo),
     r.testo.slice(0, 120));
  ok('e segna la riga dove va messa',
     r.segnato === true && /non si ferma/.test(r.titolo),
     r.titolo);

  /* LA FERMATA CHE MANCA SI SEGNA COL QUADRATINO, NON COLORANDO LA MATITA.
     Detto dall'operatore il 2026-11-08: «colorando la matita mi confonde e
     non capisco se e` gia` attiva o meno». Prima il giallo era su tutt'e
     due gli stati e l'unica differenza era un anello da un pixel; adesso il
     giallo sulla matita vuol dire una cosa sola — la fermata c'e`. */
  const mancante = { colore: r.colore, anello: r.anello, normale: r.normale };
  ok('e la segna col quadratino, lasciando la matita del suo colore',
     mancante.colore === mancante.normale && mancante.anello !== 'none',
     'matita ' + mancante.colore + ' (normale ' + mancante.normale +
     '), anello ' + mancante.anello);

  /* 4. IL CASO NUOVO, ed e' quello per cui tutto questo esiste: stesso
        colore, spessore diverso. Col vecchio conto per colore qui non
        succedeva niente. */
  r = await SCENA(page, { colore: NERO, mm: 0.3 }, { colore: NERO, mm: 0.8 }, false);
  ok('stesso colore ma spessori diversi: e` comunque un cambio penna',
     /Manca un cambio penna/.test(r.testo) && /spessore/.test(r.testo) &&
     r.segnato === true,
     r.testo.slice(0, 130));

  /* E con la fermata messa, quella fermata NON e' sprecata: era proprio
     questo che l'elenco diceva al contrario. */
  r = await SCENA(page, { colore: NERO, mm: 0.3 }, { colore: NERO, mm: 0.8 }, true);
  ok('e con la fermata messa non la chiama sprecata',
     /fra livelli della stessa penna/.test(r.testo) === false,
     r.nascosto ? 'nota spenta' : r.testo.slice(0, 110));

  /* L'ALTRA META' DEL CONFRONTO, e senza di lei la prima non prova niente:
     con la fermata ATTIVA la matita e` gialla e l'anello non c'e`. I due
     stati devono differire per il colore, non per un contorno — quindi si
     pretende anche che i due colori siano DIVERSI fra loro. */
  ok('con la fermata attiva, invece, la matita e` gialla e senza quadratino',
     r.colore !== r.normale && r.anello === 'none' &&
     r.colore !== mancante.colore,
     'attiva ' + r.colore + ', mancante ' + mancante.colore +
     ', normale ' + r.normale + ', anello ' + r.anello);

  /* Uno spessore scelto su uno solo dei due e' comunque una differenza: la
     penna da 0,8 e quella «non detta» non sono la stessa penna. */
  r = await SCENA(page, { colore: NERO, mm: null }, { colore: NERO, mm: 0.8 }, false);
  ok('spessore su uno solo dei due: e` lo stesso una penna diversa',
     /Manca un cambio penna/.test(r.testo), r.testo.slice(0, 100));

  /* ============ E LO SPESSORE ARRIVA FINO AL CAMBIO PENNA ============
     «Monta la nera» non e' una risposta se in cassetto ci sono due nere. Il
     numero deve viaggiare nel programma, perche' al cambio penna la pagina
     puo' essere stata ricaricata e il livello non esserci piu'. */
  r = await page.evaluate(() => {
    const l = Artwork.livelli();
    Artwork.scegliPenna(l[1].id, '#c8102e');
    Artwork.scegliSpessore(l[1].id, 0.8);
    Artwork.prepare();
    const prog = document.getElementById('gcode-out').value;
    const riga = prog.split('\n').filter((x) => /^;PENNA/.test(x));
    const letto = Sender.prepara(prog).filter((x) => x.indexOf('\u0000penna:') === 0);
    return { righe: riga, letto: letto.map((x) => x.slice(7).split('\u0000')) };
  });
  ok('il programma scrive lo spessore accanto al colore',
     r.righe.some((x) => /0\.8mm/.test(x)), r.righe.join('  |  '));
  ok('e il Sender lo rilegge come numero, col nome ancora intero',
     r.letto.some((d) => d[1] === '0.8' && d[2].length > 0),
     JSON.stringify(r.letto));

  /* Un programma vecchio, senza il numero, deve leggersi lo stesso. */
  r = await page.evaluate(() => {
    const v = Sender.prepara(';PENNA #1d1d1b un livello vecchio\nG21');
    return v[0].slice(7).split('\u0000');
  });
  ok('un programma salvato prima si legge ancora',
     r[0] === '#1d1d1b' && r[1] === '' && r[2] === 'un livello vecchio',
     JSON.stringify(r));

  ok('nessun errore in pagina', errori.length === 0, errori.join(' | '));
  await browser.close();
  console.log(guai ? '\n' + guai + ' controlli KO' : '\ntutto a posto');
  process.exit(guai ? 1 : 0);
})();
