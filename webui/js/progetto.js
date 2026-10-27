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

  /* Rimettere a posto. L'ORDINE CONTA: prima il foglio, poi i livelli.
     Cambiare foglio azzera i rettangoli di tutti i livelli — è quello che
     deve succedere quando si cambia formato — quindi farlo dopo vorrebbe dire
     buttare via le collocazioni appena ripristinate. */
  function applica(dati, nome) {
    if (dati.foglio) Paper.setSize(dati.foglio.w, dati.foglio.h);
    /* L'ANGOLO DEL FOGLIO SI RIMETTE SOLO SE NON E' STATO MISURATO OGGI.
       Quello salvato è una posizione indicativa, presa quando il progetto è
       stato messo via; quello di adesso, se il lucchetto è chiuso, è una
       misura fatta sulla macchina col terzo popup. Una misura non si
       sovrascrive con un'ipotesi, nemmeno con un'ipotesi scritta in un file. */
    var misurato = State.data.foglioMisurato;
    if (dati.angolo && !misurato) Paper.setSheetOrigin(dati.angolo.x, dati.angolo.y);
    if (dati.scala) document.getElementById('art-scale').value = dati.scala;

    Artwork.daProgetto(dati.livelli);

    var quando = '';
    if (dati.salvato) {
      var d = new Date(dati.salvato);
      if (!isNaN(d)) {
        quando = ', salvato il ' + d.toLocaleDateString('it-IT') + ' alle ' +
                 d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      }
    }
    Log.add('msg', 'Ripreso il progetto ' + nome + ': ' + dati.livelli.length +
            (dati.livelli.length === 1 ? ' livello' : ' livelli') +
            ' con le forme come le avevi lasciate, foglio ' + dati.foglio.w +
            ' × ' + dati.foglio.h + ' mm' + quando + '. I cambi penna messi a ' +
            'mano no: sono posizioni nel percorso, e il percorso si rifà.' +
            (misurato
              ? ' L\'angolo del foglio è rimasto quello misurato oggi sulla ' +
                'macchina, non quello salvato nel file.' : ''));
  }

  function init() {
    var b = document.getElementById('btn-save-prog');
    if (b) b.addEventListener('click', salva);
  }

  return { init: init, salva: salva, leggi: leggi, applica: applica,
           testo: testo, MARCA: MARCA };
})();
