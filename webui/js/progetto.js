/* Salvare il lavoro a metà, e ritrovarlo.
 *
 * IL PROBLEMA, detto dall'operatore il 2026-10-27: «se edito un file ma non
 * ho fatto in tempo a finire, non ho la possibilità di salvare i progressi».
 * Era vero: i livelli, le forme modificate, il rettangolo, la rotazione, i
 * ritagli e i cambi penna vivevano nella pagina e morivano con lei. Un'ora di
 * lavoro sull'editor si poteva solo finire o buttare.
 *
 * PERCHE' UN SVG E NON UN FORMATO NOSTRO. Perché un SVG è già quello che
 * questo programma sa leggere, e perché un file che si apre anche altrove non
 * è un ostaggio: se un giorno questa pagina non ci fosse più, il disegno
 * resta un disegno. Dentro al file ci sono due cose, e sono due cose diverse:
 *
 *   - IL DISEGNO, come tracciati veri, nelle coordinate del foglio e in
 *     millimetri. Lo vede qualunque programma, e lo rilegge anche il nostro
 *     importatore normale se il resto si perdesse.
 *   - LO STATO, dentro a <metadata>: le FORME con le loro curve, i nomi dei
 *     livelli, l'occhio, i cambi penna, la rotazione, il ritaglio, il foglio
 *     e la sua posizione. È quello che un SVG normale NON sa dire, ed è
 *     esattamente quello che serve per riprendere invece di ricominciare.
 *
 * Riaprendolo qui vince <metadata>: i tracciati disegnati sono un prodotto —
 * li rifà l'appiattimento delle forme — e rileggerli vorrebbe dire tornare a
 * un disegno di segmenti dritti, cioè perdere le curve e l'editor.
 *
 * E SI RIAPRE IN DUE MODI, perché un progetto salvato non serve solo a
 * riprendere la giornata di ieri: serve anche a tenere da parte dei pezzi. Si
 * SOSTITUISCE quello che c'è — si torna a quel momento, foglio compreso — o si
 * AGGIUNGONO i suoi livelli a quelli che ci sono, per pescare da due file. La
 * scelta la fa la finestrella a tre pulsanti qui sotto, e si apre solo quando
 * c'è del lavoro da perdere.
 *
 * COSA NON CI VA, e non è una dimenticanza. I cambi penna messi a mano sono
 * indici dentro al percorso ottimizzato, e quel percorso si ricalcola a ogni
 * modifica: un indice salvato oggi domani indica un altro tratto. I cambi
 * penna PER LIVELLO invece ci sono, perché quelli stanno sul livello e non
 * sul percorso. Non ci vanno nemmeno l'altezza di contatto e l'angolo
 * misurato del foglio: sono misure di una stampa, non del lavoro.
 */
var Progetto = (function () {

  var MARCA = 'gdc-cnc2d-progetto';
  var VERSIONE = 1;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function n3(v) {
    var s = Number(v).toFixed(3);
    /* Gli zeri in coda sono un terzo del file e non dicono niente. */
    return s.replace(/\.?0+$/, '');
  }

  /* Un colore per livello, così il file resta leggibile anche da solo: se un
     domani il <metadata> andasse perso, l'importatore normale rifarebbe un
     livello per tinta, cioè gli stessi livelli, senza i nomi. La ruota parte
     dal rosso-arancio del progetto e gira di un angolo che non si richiude
     presto: con dodici livelli non ci sono due tinte vicine. */
  function tinta(i) {
    var h = (18 + i * 137.5) % 360;
    return 'hsl(' + h.toFixed(0) + ' 62% 48%)';
  }

  /* ------------------------------ scrittura ------------------------------ */

  function testo() {
    var p = State.data.paper;
    var dati = Artwork.progetto();
    var corpo = '';

    dati.livelli.forEach(function (l, i) {
      var tratti = dati.tratti[i] || [];
      if (!tratti.length) return;
      var d = tratti.map(function (poly) {
        return 'M' + poly.map(function (q) {
          return n3(q.x) + ' ' + n3(q.y);
        }).join(' L');
      }).join(' ');
      corpo += '  <g stroke="' + tinta(i) + '"' +
               (l.visibile ? '' : ' opacity=".25"') +
               '><title>' + esc(l.nome) + '</title>' +
               '<path d="' + d + '"/></g>\n';
    });

    var stato = {
      formato: MARCA,
      versione: VERSIONE,
      pagina: (typeof Versione !== 'undefined') ? Versione.numero : null,
      salvato: new Date().toISOString(),
      foglio: { w: p.w, h: p.h, nome: p.name || null },
      angolo: { x: State.data.sheetOrigin.x, y: State.data.sheetOrigin.y },
      scala: +document.getElementById('art-scale').value || 100,
      livelli: dati.livelli
    };

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
      'width="' + n3(p.w) + 'mm" height="' + n3(p.h) + 'mm" ' +
      'viewBox="0 0 ' + n3(p.w) + ' ' + n3(p.h) + '">\n' +
      '<title>' + esc(nomeFile(false)) + '</title>\n' +
      /* Il commento prima del blocco serve a chi apre il file con un editor di
         testo e si chiede che cos\'è questa roba. */
      '<!-- Progetto di GDC CNC 2D SLICER. Il disegno qui sotto e\' un SVG ' +
      'normale; il blocco <metadata> tiene le forme modificabili, i livelli e ' +
      'le impostazioni, e serve a riaprire il lavoro dov\'era. -->\n' +
      '<metadata id="' + MARCA + '">' + esc(JSON.stringify(stato)) + '</metadata>\n' +
      /* In SVG la y cresce verso il basso, sul foglio verso l'alto: il
         ribaltamento si fa una volta sul gruppo invece che punto per punto. */
      '<g transform="translate(0 ' + n3(p.h) + ') scale(1 -1)" fill="none" ' +
      'stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round">\n' +
      corpo +
      '</g>\n</svg>\n';
  }

  function nomeFile(conEstensione) {
    var n = (State.data.artName || 'progetto').replace(/\.svg$/i, '')
            .replace(/[\\/:*?"<>|]/g, '-');
    return conEstensione ? n + '.cnc2d.svg' : n;
  }

  function salva() {
    if (!Artwork.progetto().livelli.length) {
      Log.add('err', 'Non c\'è niente da salvare: nessun livello.');
      return;
    }
    var nome = nomeFile(true);
    var blob = new Blob([testo()], { type: 'image/svg+xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    Log.add('msg', 'Salvato ' + nome + ': ' + Artwork.progetto().livelli.length +
                   ' livelli con le loro forme, il foglio e i cambi penna. ' +
                   'Ricaricandolo qui si riprende da dove eri; aperto altrove ' +
                   'è un SVG come un altro.');
  }

  /* ------------------------------- lettura ------------------------------- */

  /* Lo stato dentro al file, o null se questo file non ne ha. Non lancia:
     un SVG qualunque passa di qui e deve proseguire per la strada normale. */
  function leggi(text) {
    if (String(text).indexOf(MARCA) < 0) return null;   // niente da cercare
    var doc;
    try {
      doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    } catch (e) { return null; }
    if (!doc || doc.querySelector('parsererror')) return null;
    var el = doc.getElementById(MARCA) ||
             doc.querySelector('metadata[id="' + MARCA + '"]');
    if (!el) return null;
    var dati;
    try { dati = JSON.parse(el.textContent); } catch (e) {
      Log.add('err', 'Questo file dice di essere un progetto, ma il blocco ' +
                     'delle impostazioni non si legge: lo apro come SVG normale.');
      return null;
    }
    if (!dati || dati.formato !== MARCA || !dati.livelli) return null;
    if (dati.versione > VERSIONE) {
      Log.add('err', 'Il progetto è stato salvato da una versione più nuova ' +
                     'della pagina (formato ' + dati.versione + ', qui si ' +
                     'arriva al ' + VERSIONE + '): quello che non capisco lo salto.');
    }
    return dati;
  }

  /* Quando le due misure sono la stessa cosa. Si arrotonda al millimetro e
     non si ordina: un foglio girato NON è lo stesso foglio per chi ci
     appoggia sopra dei livelli, perché i rettangoli sono coordinate su
     QUELLE misure, non sul nome del formato. È il contrario della regola di
     `chiaveFoglio` in profile.js, e lo è per il motivo opposto: là si parlava
     della risma, qui si parla di dove casca un disegno. */
  function stessoFoglio(f) {
    if (!f) return true;
    return Math.round(f.w) === Math.round(State.data.paper.w) &&
           Math.round(f.h) === Math.round(State.data.paper.h);
  }

  function quando(dati) {
    if (!dati.salvato) return '';
    var d = new Date(dati.salvato);
    if (isNaN(d)) return '';
    return ', salvato il ' + d.toLocaleDateString('it-IT') + ' alle ' +
           d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  /* Rimettere a posto, in uno dei due modi. L'ORDINE CONTA: prima il foglio,
     poi i livelli. Cambiare la misura del foglio sposta i rettangoli di tutti
     i livelli — li ricentra, vedi l'ascoltatore `paper` in artwork.js —
     quindi farlo dopo vorrebbe dire muovere le collocazioni appena
     ripristinate.

     AGGIUNGENDO, del file si prendono SOLO i livelli. Foglio, angolo e scala
     restano quelli in uso: chi c'era prima è il padrone di casa, e chi arriva
     dopo è ospite. Costa qualcosa — se il progetto arrivato era su un foglio
     di un'altra misura, i suoi livelli restano alle coordinate in cui erano e
     possono cascare fuori — e per adesso si paga, dicendolo. Vedi lo Step 11
     della pipeline. */
  function applica(dati, nome, aggiungi) {
    var misurato = State.data.foglioMisurato;

    if (!aggiungi) {
      if (dati.foglio) Paper.setSize(dati.foglio.w, dati.foglio.h);
      /* L'ANGOLO DEL FOGLIO SI RIMETTE SOLO SE NON E' STATO MISURATO OGGI.
         Quello salvato è una posizione indicativa, presa quando il progetto è
         stato messo via; quello di adesso, se il lucchetto è chiuso, è una
         misura fatta sulla macchina col terzo popup. Una misura non si
         sovrascrive con un'ipotesi, nemmeno con un'ipotesi scritta in un
         file. */
      if (dati.angolo && !misurato) Paper.setSheetOrigin(dati.angolo.x, dati.angolo.y);
      if (dati.scala) document.getElementById('art-scale').value = dati.scala;
    }

    var n = dati.livelli.length;
    var quanti = n + (n === 1 ? ' livello' : ' livelli');

    Artwork.daProgetto(dati.livelli, !!aggiungi);

    if (!aggiungi) {
      Log.add('msg', 'Ripreso il progetto ' + nome + ': ' + quanti +
              ' con le forme come le avevi lasciate, foglio ' + dati.foglio.w +
              ' × ' + dati.foglio.h + ' mm' + quando(dati) + '. I cambi penna ' +
              'messi a mano no: sono posizioni nel percorso, e il percorso si rifà.' +
              (misurato
                ? ' L\'angolo del foglio è rimasto quello misurato oggi sulla ' +
                  'macchina, non quello salvato nel file.' : ''));
      return;
    }

    Log.add('msg', 'Aggiunti ' + quanti + ' dal progetto ' + nome + quando(dati) +
            ': forme, nomi, penne e spessori come li avevi lasciati. Al primo ' +
            'livello arrivato è stato messo un cambio penna, come per un file ' +
            'qualunque accostato ad altri: se la penna è la stessa, l\'elenco ' +
            'te lo dice e lo togli con un clic.');

    /* Il foglio diverso non è un errore, è la cosa che fa trovare un livello
       mezzo fuori dal foglio senza capire perché: va detta nel canale che si
       guarda, non nascosta in fondo a una riga lunga. */
    if (!stessoFoglio(dati.foglio)) {
      Log.add('err', 'Attenzione: quel progetto era su un foglio ' +
              dati.foglio.w + ' × ' + dati.foglio.h + ' mm, qui ce n\'è uno ' +
              State.data.paper.w + ' × ' + State.data.paper.h + ' mm. I livelli ' +
              'arrivati sono alle coordinate in cui stavano: controlla dove sono ' +
              'finiti, qualcuno può essere fuori dal foglio.');
    }
  }

  /* ------------------- CHE FARE DI UN PROGETTO CHE ARRIVA ----------------- */

  /* TRE STRADE E NON DUE.
   *
   * Fino al 2026-11-06 riaprire un progetto con del lavoro già sul foglio
   * chiedeva «li sostituisco?» con un `window.confirm`, che ha due pulsanti e
   * quindi poteva offrire solo «sostituisci» o «lascia stare». Mancava
   * esattamente quello che serviva all'operatore il 6 novembre: aprire due
   * progetti salvati e pescare dei pezzi da entrambi. Il caso «aggiungi»
   * esisteva già, e per un file qualunque: più SVG trascinati insieme
   * diventano più livelli. Un progetto era l'unico file che non si potesse
   * accostare a quello che c'è, e non c'era una ragione — c'era solo una
   * finestrella con due pulsanti.
   *
   * SI FA LA CODA perché i file arrivano a mazzo. Trascinandone due, i due
   * FileReader finiscono quando finiscono, e aprire la seconda finestrella
   * sopra la prima vorrebbe dire perdere una scelta senza dirlo: il secondo
   * progetto sparirebbe e nessuno saprebbe perché.
   */
  var coda = [];

  function chiedi(dati, nome) {
    coda.push({ dati: dati, nome: nome });
    /* Si ridisegna anche quando la finestrella e` GIA' aperta, e non e' un
       lusso: il secondo file arriva mentre la prima domanda e` sullo schermo,
       e senza questa riga «c'e' un altro progetto in attesa» non comparirebbe
       mai -- la riga si scrive una volta sola, quando ancora in coda c'era un
       file solo. Chi sta scegliendo deve sapere che la scelta non e' l'ultima. */
    mostra();
  }

  function mostra() {
    var v = coda[0];
    if (!v) return;

    /* Quanti livelli ci sono si conta ADESSO e non quando il file è stato
       letto: mentre questo aspettava in coda, una scelta può averne aggiunti
       o buttati, e un numero vecchio in una domanda è una bugia. */
    var ci = Artwork.livelli().length;
    var suoi = v.dati.livelli.length;

    document.getElementById('prog-titolo').textContent = 'Progetto «' + v.nome + '»';
    document.getElementById('prog-desc').textContent =
      'Dentro ci sono ' + suoi + (suoi === 1 ? ' livello' : ' livelli') +
      ', e sul foglio ce ' + (ci === 1 ? 'n\'è 1' : 'ne sono ' + ci) + '. ' +
      'Aggiungendoli si mettono accanto a quelli che ci sono, con le loro ' +
      'forme, i nomi, le penne e gli spessori: foglio e scala restano quelli ' +
      'in uso. Sostituendo tutto si torna a quel progetto com\'era, foglio ' +
      'compreso, e quello che c\'è adesso si perde.';

    var altri = coda.length - 1;
    var cod = document.getElementById('prog-coda');
    cod.hidden = altri < 1;
    cod.textContent = altri < 1 ? '' :
      altri === 1 ? 'C\'è un altro progetto in attesa: te lo chiedo dopo questo.'
                  : 'Ci sono altri ' + altri + ' progetti in attesa: te li chiedo ' +
                    'uno per uno dopo questo.';

    var nota = document.getElementById('prog-nota');
    var diverso = !stessoFoglio(v.dati.foglio);
    nota.hidden = !diverso;
    nota.textContent = !diverso ? '' :
      'Quel progetto era su un foglio ' + v.dati.foglio.w + ' × ' +
      v.dati.foglio.h + ' mm, qui ce n\'è uno ' + State.data.paper.w + ' × ' +
      State.data.paper.h + ' mm. Aggiungendo i livelli, quelli arrivati ' +
      'restano alle coordinate in cui erano e qualcuno può cascare fuori dal ' +
      'foglio.';

    document.getElementById('prog-modal').hidden = false;
    document.getElementById('prog-aggiungi').focus();
  }

  /* `scelta`: 'aggiungi', 'sostituisci', o niente per lasciare stare.
     La coda va avanti anche se la scelta si rompe per strada: una finestrella
     che non si riapre più è peggio dell'errore che l'ha fatta chiudere. */
  function rispondi(scelta) {
    if (!coda.length) return;
    var v = coda.shift();
    document.getElementById('prog-modal').hidden = true;
    try {
      if (scelta) applica(v.dati, v.nome, scelta === 'aggiungi');
      else Log.add('msg', 'Progetto «' + v.nome + '» non aperto: quello che ' +
                          'c\'era resta com\'è.');
    } catch (e) {
      Log.add('err', 'Non sono riuscito ad aprire «' + v.nome + '»: ' + e.message);
    }
    if (coda.length) mostra();
  }

  function init() {
    var b = document.getElementById('btn-save-prog');
    if (b) b.addEventListener('click', salva);

    document.getElementById('prog-aggiungi')
      .addEventListener('click', function () { rispondi('aggiungi'); });
    document.getElementById('prog-sostituisci')
      .addEventListener('click', function () { rispondi('sostituisci'); });
    document.getElementById('prog-annulla')
      .addEventListener('click', function () { rispondi(null); });
    document.getElementById('prog-modal').addEventListener('click', function (e) {
      if (e.target === this) rispondi(null);        // clic sul fondo scuro
    });
    document.addEventListener('keydown', function (e) {
      if (document.getElementById('prog-modal').hidden) return;
      /* Invio fa la cosa che non butta via niente. Il pulsante che perde del
         lavoro si preme col dito, guardandolo. */
      if (e.key === 'Enter') rispondi('aggiungi');
      if (e.key === 'Escape') rispondi(null);
    });
  }

  return { init: init, salva: salva, leggi: leggi, applica: applica,
           chiedi: chiedi, testo: testo, MARCA: MARCA };
})();
