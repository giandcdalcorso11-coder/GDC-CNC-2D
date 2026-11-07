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
 *     livelli, l'occhio, i cambi penna, la rotazione, il ritaglio, I FOGLI
 *     con la loro posizione, e su quale di essi sta ogni livello. È quello
 *     che un SVG normale NON sa dire, ed è esattamente quello che serve per
 *     riprendere invece di ricominciare.
 *
 * Riaprendolo qui vince <metadata>: i tracciati disegnati sono un prodotto —
 * li rifà l'appiattimento delle forme — e rileggerli vorrebbe dire tornare a
 * un disegno di segmenti dritti, cioè perdere le curve e l'editor.
 *
 * E SI RIAPRE IN DUE MODI, perché un progetto salvato non serve solo a
 * riprendere la giornata di ieri: serve anche a tenere da parte dei pezzi. Si
 * SOSTITUISCE quello che c'è — si torna a quel momento, fogli compresi — o si
 * AGGIUNGONO i suoi livelli a quelli che ci sono, per pescare da due file. La
 * scelta la fa la finestrella a tre pulsanti qui sotto, e si apre solo quando
 * c'è del lavoro da perdere.
 *
 * CHI ARRIVA PORTA IL SUO FOGLIO (formato 2, 2026-11-07), e questo SUPERA la
 * decisione del 6 novembre («chi c'era prima è il padrone di casa: del file
 * si prendono solo i livelli»). Quella decisione era il meglio che si potesse
 * fare quando il foglio era UNO: adottare il foglio del file avrebbe
 * ricentrato i disegni di chi c'era già, quindi si tenevano i livelli e si
 * avvisava che potevano cascare fuori. Con più fogli sul piano il
 * compromesso non serve più — i due progetti non litigano per l'unico foglio,
 * perché ognuno si porta dietro il suo, e i livelli arrivano esattamente
 * dov'erano sulla carta su cui erano. È la metà «foglio» dello Step 11, che
 * si chiude qui per sparizione del problema e non per un rattoppo.
 *
 * I fogli che arrivano si posano TUTTI INSIEME, di un solo scostamento, dove
 * c'è posto sul piano: vedi `Fogli.posaGruppo`. Posandoli uno per uno la loro
 * geometria relativa si perderebbe, e con lei l'accostamento — cioè delle
 * misure da rifare a mano sulla macchina.
 *
 * COSA NON CI VA, e non è una dimenticanza. I cambi penna messi a mano sono
 * indici dentro al percorso ottimizzato, e quel percorso si ricalcola a ogni
 * modifica: un indice salvato oggi domani indica un altro tratto. I cambi
 * penna PER LIVELLO invece ci sono, perché quelli stanno sul livello e non
 * sul percorso. Non ci vanno nemmeno l'altezza di contatto — né quella
 * generale né le `z` dei singoli fogli, con la loro spunta `cartaSua` — e il
 * fatto che un angolo sia stato misurato: sono misure di una stampa, non del
 * lavoro. E non ci vanno GLI AGGANCI, che sono l'unica cosa che si potrebbe
 * salvare e che invece si ricalcola di proposito: chi è accostato a chi
 * DISCENDE da dove stanno i fogli, e un aggancio scritto in un file potrebbe
 * descrivere un giro chiuso che nessuna geometria regge. Il file dice dove
 * sono i fogli; l'accostamento si rilegge da lì.
 */
var Progetto = (function () {

  var MARCA = 'gdc-cnc2d-progetto';
  /* 1 = un foglio solo (`foglio` + `angolo`). 2 = l'elenco `fogli`, e ogni
     livello col numero del suo. Un file del formato 2 si apre anche su una
     pagina che conosce solo il formato 1, perché `foglio` e `angolo` ci sono
     ancora e dicono del PRIMO foglio: quella pagina si prende i livelli e li
     mette tutti lì. Costa due chiavi in più nel file e salva un file aperto
     su un computer non aggiornato. */
  var VERSIONE = 2;

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

  /* IL RIQUADRO DEL FILE: il rettangolo che contiene tutti i fogli, in
     coordinate MACCHINA. Con un foglio solo torna il foglio e niente altro —
     quindi il file che esce da qui è identico, byte per byte, a quello che
     usciva quando i fogli non potevano essere più d'uno. Non è una curiosità:
     è il motivo per cui questa modifica non invalida i file già salvati e si
     può provare come tale.

     Si guardano i FOGLI e non i disegni. Un disegno che sborda dal suo foglio
     resta tagliato fuori dal riquadro, come prima: la carta è quello che si
     stampa, e un riquadro che si allarga per contenere uno sbordo direbbe che
     quel pezzo si stampa — mentre non si stampa. */
  function riquadro(fg) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    fg.forEach(function (f) {
      x0 = Math.min(x0, f.origine.x);
      y0 = Math.min(y0, f.origine.y);
      x1 = Math.max(x1, f.origine.x + f.w);
      y1 = Math.max(y1, f.origine.y + f.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function testo() {
    var fg = State.data.fogli;
    var q = riquadro(fg);
    var dati = Artwork.progetto();
    var corpo = '';

    dati.livelli.forEach(function (l, i) {
      var tratti = dati.tratti[i] || [];
      if (!tratti.length) return;
      /* I tratti sono millimetri DEL LORO FOGLIO: nel file vanno in
         coordinate del riquadro, cioè macchina meno l'angolo del riquadro.
         È la stessa conversione che fa `prepare()` per il G-code, e qui si
         fa per la stessa ragione — un disegno di nove magneti deve uscire
         come nove disegni in nove posti, non nove volte sovrapposti
         nell'angolo. */
      var o = (fg[l.foglio] || fg[0]).origine;
      var dx = o.x - q.x, dy = o.y - q.y;
      var d = tratti.map(function (poly) {
        return 'M' + poly.map(function (c) {
          return n3(c.x + dx) + ' ' + n3(c.y + dy);
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
      /* I FOGLI IN ORDINE. L'indice qui dentro è quello che ogni livello
         scrive nel suo campo `foglio` — vedi `progetto()` in artwork.js, che
         spiega perché un indice e non un id. Di ogni foglio si salva quello
         che è una scelta di chi disegna (misure, nome, dove sta sul piano) e
         non quello che è una misura di una stampa: niente `z`, niente
         `cartaSua`, niente `misurato`, niente `aggancio`. */
      fogli: fg.map(function (f) {
        /* `nomeMio` viaggia col nome, e senza di lui il nome non durerebbe:
           riaprendo, il primo ridisegno rimetterebbe quello del formato
           (vedi `apply()` in paper.js). Una chiave in più non cambia il
           formato del file: una pagina che non la conosce la ignora, e un
           file che non ce l'ha vale come «no». */
        return { w: f.w, h: f.h, nome: f.name || null, nomeMio: !!f.nomeMio,
                 angolo: { x: f.origine.x, y: f.origine.y } };
      }),
      /* Queste due dicono del PRIMO foglio e sono qui per le pagine che
         conoscono solo il formato 1: là `fogli` non si legge, e senza di
         loro un file nuovo si aprirebbe senza foglio. Vedi VERSIONE. */
      foglio: { w: fg[0].w, h: fg[0].h, nome: fg[0].name || null },
      angolo: { x: fg[0].origine.x, y: fg[0].origine.y },
      scala: +document.getElementById('art-scale').value || 100,
      livelli: dati.livelli
    };

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
      'width="' + n3(q.w) + 'mm" height="' + n3(q.h) + 'mm" ' +
      'viewBox="0 0 ' + n3(q.w) + ' ' + n3(q.h) + '">\n' +
      '<title>' + esc(nomeFile(false)) + '</title>\n' +
      /* Il commento prima del blocco serve a chi apre il file con un editor di
         testo e si chiede che cos\'è questa roba. */
      '<!-- Progetto di GDC CNC 2D SLICER. Il disegno qui sotto e\' un SVG ' +
      'normale; il blocco <metadata> tiene le forme modificabili, i livelli, ' +
      'i fogli e le impostazioni, e serve a riaprire il lavoro dov\'era. -->\n' +
      '<metadata id="' + MARCA + '">' + esc(JSON.stringify(stato)) + '</metadata>\n' +
      /* In SVG la y cresce verso il basso, sul foglio verso l'alto: il
         ribaltamento si fa una volta sul gruppo invece che punto per punto. */
      '<g transform="translate(0 ' + n3(q.h) + ') scale(1 -1)" fill="none" ' +
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
                   ' livelli con le loro forme, i ' + State.data.fogli.length +
                   ' fogli dove stanno e i cambi penna. ' +
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

  /* I FOGLI DI UN FILE, sempre almeno uno e sempre nella stessa forma, che
     il file sia del formato 2 o del formato 1. Il resto del codice qui sotto
     non sa quale dei due stava leggendo, e non deve saperlo: un progetto di
     ieri è un progetto con un foglio solo, non un caso a parte. */
  function fogliDi(dati) {
    if (dati.fogli && dati.fogli.length) {
      return dati.fogli.map(function (f) {
        var a = f.angolo || {};
        return { w: +f.w || 1, h: +f.h || 1, nome: f.nome || null,
                 nomeMio: !!f.nomeMio,
                 angolo: { x: +a.x || 0, y: +a.y || 0 } };
      });
    }
    var u = dati.foglio || { w: State.data.paper.w, h: State.data.paper.h };
    var g = dati.angolo || State.data.sheetOrigin;
    return [{ w: +u.w || 1, h: +u.h || 1, nome: u.nome || null,
              angolo: { x: +g.x || 0, y: +g.y || 0 } }];
  }

  /* Quando le due misure sono la stessa cosa. Si arrotonda al millimetro e
     non si ordina: un foglio girato NON è lo stesso foglio per chi ci
     appoggia sopra dei livelli, perché i rettangoli sono coordinate su
     QUELLE misure, non sul nome del formato. È il contrario della regola di
     `chiaveFoglio` in profile.js, e lo è per il motivo opposto: là si parlava
     della risma, qui si parla di dove casca un disegno. */
  function stessaMisura(a, b) {
    return Math.round(a.w) === Math.round(b.w) &&
           Math.round(a.h) === Math.round(b.h);
  }

  /* «un foglio 210 × 297 mm», «9 fogli da 75 × 75 mm», «2 fogli (210 × 297
     mm, 148 × 210 mm)». La misura si scrive sempre, perché è quella che dice
     se un disegno ci casca dentro — il nome del formato no. */
  function quantiFogli(fg) {
    var uniche = [];
    fg.forEach(function (f) {
      var t = n3(f.w) + ' × ' + n3(f.h) + ' mm';
      if (uniche.indexOf(t) < 0) uniche.push(t);
    });
    if (fg.length === 1) return 'un foglio ' + uniche[0];
    return fg.length + ' fogli ' + (uniche.length === 1
      ? 'da ' + uniche[0] : '(' + uniche.join(', ') + ')');
  }

  /* --------------------- i fogli, rimessi o aggiunti --------------------- */

  /* SOSTITUENDO: il piano torna quello del file. Si creano dei fogli nuovi e
   * si butta l'elenco di prima, perché «sostituisci tutto» vuol dire tornare
   * a quel momento.
   *
   * CON UNA ECCEZIONE, ed è la stessa regola che c'era con un foglio solo:
   * UNA MISURA NON SI SOVRASCRIVE CON UN'IPOTESI. Gli angoli salvati nel file
   * sono posizioni indicative, prese quando il progetto è stato messo via;
   * quelli di adesso, se il lucchetto è chiuso, sono misure fatte sulla
   * macchina col terzo popup. Se il piano di oggi è LO STESSO PIANO — tanti
   * fogli quanti, delle stesse misure, nello stesso ordine — e almeno uno è
   * misurato, si tengono i fogli di oggi dov'erano.
   *
   * E O TUTTI O NESSUNO, mai un misto: tenere l'angolo misurato del foglio 3
   * e prendere dal file quello del 4 vorrebbe dire separare due fogli che
   * erano accostati — cioè trasformare una misura in due, di nascosto, nel
   * momento esatto in cui si crede di averne salvata una.
   */
  function rimetti(fg, livelli) {
    var ora = State.data.fogli;
    var misurato = ora.some(function (f) { return f.misurato; });

    if (stessoPiano(fg) && misurato) {
      return { mappa: ora.map(function (f) { return f.id; }), tenuto: true };
    }

    /* Anche sostituendo si rimettono solo i fogli che servono: prendendo due
       livelli su diciotto, «torna a quel progetto» vuol dire tornare ai suoi
       DUE magneti, non a nove di cui sette vuoti. */
    var usati = indiciUsati(fg, livelli);
    var mappa = [];
    var nuovi = usati.map(function (i) {
      var f = fg[i];
      var n = State.nuovoFoglio({ w: f.w, h: f.h, name: f.nome,
                                  nomeMio: f.nomeMio,
                                  x: f.angolo.x, y: f.angolo.y });
      mappa[i] = n.id;
      return n;
    });
    State.data.fogli = nuovi;
    State.data.foglioAttivo = nuovi[0].id;
    Fogli.rileggiAgganci();
    /* `setSize` sui numeri che il foglio in uso ha già: non cambia una
       virgola dello stato, e serve a far ridisegnare tutto (le caselle delle
       misure, il piano, l'elenco dei fogli, il percorso) da un posto solo. */
    Paper.setSize(nuovi[0].w, nuovi[0].h);
    return { mappa: mappa, tenuto: false };
  }

  /* IL PIANO DI OGGI E' LO STESSO PIANO DEL FILE: tanti fogli quanti, delle
     stesse misure, nello stesso ordine. Lo chiedono in due — chi rimette e
     chi aggiunge — e la risposta dev'essere la stessa per tutti e due:
     «questo è lo stesso piano» non può voler dire due cose diverse a venti
     righe di distanza. */
  function stessoPiano(fg) {
    var ora = State.data.fogli;
    return ora.length === fg.length && ora.every(function (f, i) {
      return stessaMisura(f, fg[i]);
    });
  }

  /* DOVE FINIREBBERO I FOGLI DI QUESTO FILE. La chiedono in due: la
     finestrella, per dirlo PRIMA di scegliere, e l'aggiunta, per farlo. Il
     conto sta in un posto solo perché le due risposte devono combaciare: una
     finestrella che dice «ci stanno» e un'aggiunta che li mette fuori dalla
     corsa è peggio di nessuna delle due. */
  function dovePosarli(fg, usati) {
    /* Sul piano che è già quello del file non si posa niente: i livelli
       vanno sui fogli che ci sono. Vedi `accosta`.
       Il confronto guarda TUTTI i fogli del file, anche quelli di cui non si
       prende nessun livello: «lo stesso piano» è l'identità di un piano, non
       di una scelta. Prendendo due livelli su diciotto da un progetto di
       nove magneti, quel progetto resta un progetto di nove magneti, e i due
       livelli vanno sui magneti su cui stavano. */
    if (stessoPiano(fg)) {
      return { dx: 0, dy: 0, dentro: true, piuGrande: false, sopra: true };
    }
    return Fogli.posaGruppo(quali(fg, usati).map(function (f) {
      return { x0: f.angolo.x, y0: f.angolo.y,
               x1: f.angolo.x + f.w, y1: f.angolo.y + f.h };
    }));
  }

  /* I NUMERI DEI FOGLI SU CUI STA ALMENO UNO DEI LIVELLI CHE ARRIVANO.
     Prendendo due livelli su diciotto, i fogli che servono sono uno o due, e
     portarne nove vorrebbe dire sette fogli vuoti sul piano — cioè sette
     rettangoli da togliere a mano, e un `;FOGLIO n/N` che conta una carta
     che non si stampa. Tornano in ordine, che è l'ordine del file: la
     geometria relativa di quelli che restano non cambia. */
  function indiciUsati(fg, livelli) {
    var usa = {}, out = [];
    (livelli || []).forEach(function (l) { usa[+l.foglio || 0] = true; });
    fg.forEach(function (f, i) { if (usa[i]) out.push(i); });
    /* Nessun livello (o nessuno con un foglio valido): si tiene il primo,
       perché un progetto senza fogli non si può applicare. */
    return out.length ? out : [0];
  }

  function quali(fg, usati) {
    if (!usati) return fg;
    return usati.map(function (i) { return fg[i]; })
                .filter(function (f) { return !!f; });
  }

  /* QUELLO CHE NON TORNA, detto in una riga, o null se tutto torna. Lo dicono
     sia la finestrella sia il registro, e deve essere la stessa frase: due
     frasi diverse per lo stesso fatto si leggono come due fatti. */
  function strettoia(fg, d) {
    if (d.dentro) return null;
    var a = State.data.area;
    return (d.piuGrande
      ? quantiFogli(fg) + ' non ci sta dentro la corsa percorribile (' +
        a.w.toFixed(1) + ' × ' + a.h.toFixed(1) + ' mm)'
      : 'sul piano non c\'è più posto libero dentro la corsa per ' +
        quantiFogli(fg)) +
      '. ' + (fg.length === 1 ? 'Lo metto' : 'Li metto') + ' di fianco a quello ' +
      'che c\'è, fuori dalla corsa, invece che sopra: due disegni sulla stessa ' +
      'carta non si vedono, un foglio che sporge sì. Quello che esce dalla corsa ' +
      'non si stampa, quindi ' + (fg.length === 1 ? 'va spostato' : 'vanno spostati') +
      ' sul piano prima di stampare' + (d.piuGrande
        ? ', o si stampa un pezzo per volta col pulsante «Centra l\'area nel ' +
          'foglio» nella tab Disegno.' : ', o va tolto un foglio per far posto.');
  }

  /* AGGIUNGENDO: i fogli del file si posano sul piano, tutti insieme e di un
     solo scostamento, dove c'è posto. Vedi `Fogli.posaGruppo`. */
  function accosta(fg, livelli) {
    var usati = indiciUsati(fg, livelli);
    var d = dovePosarli(fg, usati);

    /* QUANDO IL PIANO E' GIA' QUELLO DEL FILE, i livelli si appoggiano sui
       fogli che ci sono e non nasce niente. È il caso che l'operatore ha
       raccontato il 6 novembre — «mi servono alcune parti da quello, e altre
       parti da quest'altro» — e sono due file salvati sullo STESSO formato,
       con due mucchi di livelli che devono finire sulla STESSA carta.
       Portargli un secondo A4 accanto al primo risolverebbe il problema
       sbagliato: si ritroverebbe due fogli da stampare dove ne vuole uno.
       E i rettangoli di collocazione arrivano giusti senza toccarli, perché
       sono millimetri su misure che sono le stesse. */
    if (d.sopra) {
      return { mappa: State.data.fogli.map(function (f) { return f.id; }),
               posa: d };
    }

    /* La mappa è SPARSA: ha un id solo ai posti dei fogli che arrivano. Un
       livello che indicasse un foglio non portato cadrebbe sul foglio in uso
       (vedi `daProgetto`), ma non può succedere — i fogli portati sono
       esattamente quelli dei livelli scelti. */
    var mappa = [];
    usati.forEach(function (i) {
      var f = fg[i];
      var n = State.nuovoFoglio({ w: f.w, h: f.h, name: f.nome,
                                  nomeMio: f.nomeMio,
                                  x: f.angolo.x + d.dx, y: f.angolo.y + d.dy });
      State.data.fogli.push(n);
      mappa[i] = n.id;
    });
    /* Gli agganci si rileggono con tutti i fogli nuovi già nell'elenco: un
       gruppo che si posa accanto a quello che c'era nasce accostato a lui, e
       dentro al gruppo chi era accostato lo è ancora, perché lo scostamento
       è lo stesso per tutti. */
    Fogli.rileggiAgganci();
    return { mappa: mappa, posa: d };
  }

  function quando(dati) {
    if (!dati.salvato) return '';
    var d = new Date(dati.salvato);
    if (isNaN(d)) return '';
    return ', salvato il ' + d.toLocaleDateString('it-IT') + ' alle ' +
           d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  /* Rimettere a posto, in uno dei due modi. L'ORDINE CONTA: prima i fogli,
     poi i livelli. I rettangoli di collocazione sono millimetri DI UN FOGLIO,
     e un livello ha senso solo quando il foglio su cui sta esiste già —
     rimettere i fogli dopo vorrebbe dire muovere delle collocazioni appena
     ripristinate, o appoggiarle su un foglio che non c'è. */
  function applica(dati, nome, aggiungi) {
    var fg = fogliDi(dati);
    var esito = aggiungi ? accosta(fg, dati.livelli) : rimetti(fg, dati.livelli);
    /* I fogli di cui si parla nei messaggi sono quelli che ARRIVANO, non
       quelli scritti nel file: con due livelli scelti su diciotto, «con 9
       fogli da 75 × 75» sarebbe una bugia leggibile. */
    var portati = quali(fg, indiciUsati(fg, dati.livelli));

    if (!aggiungi && dati.scala) {
      document.getElementById('art-scale').value = dati.scala;
    }

    var n = dati.livelli.length;
    var quanti = n + (n === 1 ? ' livello' : ' livelli');

    Artwork.daProgetto(dati.livelli, !!aggiungi, esito.mappa);

    /* SI RESTA A GUARDARE IL FOGLIO DEL PRIMO LIVELLO ARRIVATO. Non è una
       cortesia: `daProgetto` ha appena scelto quel livello, e il foglio in
       uso e il livello scelto devono dire la stessa cosa — se no
       l'ascoltatore `fogli` in artwork.js sposta la scelta su un livello del
       foglio in uso, cioè su un disegno che non si è appena portato dentro. */
    var primo = esito.mappa[(dati.livelli[0] && +dati.livelli[0].foglio) || 0];
    if (primo) Fogli.scegli(primo);
    State.emit('fogli');

    if (!aggiungi) {
      Log.add('msg', 'Ripreso il progetto ' + nome + ': ' + quanti +
              ' con le forme come le avevi lasciate, su ' + quantiFogli(portati) +
              quando(dati) + '. I cambi penna messi a mano no: sono posizioni ' +
              'nel percorso, e il percorso si rifà.' +
              (esito.tenuto
                ? ' I fogli sono rimasti dove li hai misurati sulla macchina, ' +
                  'non dove stavano nel file: il piano è lo stesso piano, e una ' +
                  'misura non si sovrascrive con un\'ipotesi.' : ''));
      return;
    }

    Log.add('msg', 'Aggiunti ' + quanti + ' dal progetto ' + nome + quando(dati) +
            (esito.posa.sopra
              ? ', sui fogli che c\'erano: il piano è già quello di quel progetto (' +
                quantiFogli(portati) + '), quindi i livelli si sono appoggiati sopra ' +
                'senza portare altra carta.'
              : ', con ' + quantiFogli(portati) + ': ogni livello sul foglio su cui ' +
                'stava.') +
            ' Forme, nomi, penne e spessori come li avevi lasciati. Al primo ' +
            'livello arrivato è stato messo un cambio penna, come per un file ' +
            'qualunque accostato ad altri: se la penna è la stessa, l\'elenco ' +
            'te lo dice e lo togli con un clic.');

    /* QUESTO sì è un avviso, e sostituisce quello del «foglio diverso» che
       c'era fino al 6 novembre: il foglio diverso non è più un problema —
       arriva col suo — ma la corsa percorribile non è elastica. Nove magneti
       più nove magneti non ci stanno. */
    var guaio = strettoia(portati, esito.posa);
    if (guaio) Log.add('err', 'Attenzione: ' + guaio);
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

  /* I LIVELLI SCELTI di quello in cima alla coda. La spunta sta sulla voce
     della coda e non nel DOM: la finestrella si ridisegna mentre i file
     arrivano, e una scelta fatta a metà non deve perdersi perché è arrivato
     un secondo file. */
  function presi(v) {
    return v.dati.livelli.filter(function (l, i) { return v.scelti[i]; });
  }

  /* Una copia della lettura con DENTRO SOLO I LIVELLI SCELTI. Si copia
     invece di modificare: lo stesso file può tornare in coda, e un elenco
     potato sul posto sarebbe potato per sempre. */
  function conSoloScelti(v) {
    var fuori = {};
    Object.keys(v.dati).forEach(function (k) { fuori[k] = v.dati[k]; });
    fuori.livelli = presi(v);
    return fuori;
  }

  function disegnaElenco(v) {
    var box = document.getElementById('prog-elenco');
    var sc = document.getElementById('prog-scelta');
    var fg = fogliDi(v.dati);
    /* Con UN livello solo la casella avrebbe una risposta sola: togliere
       l'unico livello e poi premere «Aggiungi» non è una scelta, è
       «Annulla» detto in due mosse. */
    sc.hidden = v.dati.livelli.length < 2;
    if (sc.hidden) { box.innerHTML = ''; return; }

    var out = '';
    v.dati.livelli.forEach(function (l, i) {
      var nf = +l.foglio || 0;
      out += '<label class="prog-liv' + (v.scelti[i] ? '' : ' spenta') + '">' +
             '<input type="checkbox" data-liv="' + i + '"' +
             (v.scelti[i] ? ' checked' : '') + '>' +
             '<span class="prog-liv-nome">' + esc(l.nome || 'livello') + '</span>' +
             (fg.length > 1
                ? '<span class="prog-liv-fog" title="Sta sul foglio ' + (nf + 1) +
                  ' di questo progetto">foglio ' + (nf + 1) + '</span>' : '') +
             '</label>';
    });
    box.innerHTML = out;
  }

  /* Tutto quello che dipende dalle spunte, rifatto da zero a ogni clic:
     quanti ne hai presi, che fogli arriverebbero, se ci stanno, e che cosa
     dicono i due pulsanti. Rifare anche l'ELENCO a ogni spunta toglierebbe
     il fuoco alla casella appena premuta, quindi l'elenco no. */
  function aggiorna() {
    var v = coda[0];
    if (!v) return;
    var ci = Artwork.livelli().length;
    var suoi = v.dati.livelli.length;
    var quanti = presi(v).length;

    var fg = fogliDi(v.dati);
    var nf = State.data.fogli.length;
    var usati = indiciUsati(fg, presi(v));
    var portati = quali(fg, usati);
    var posa = dovePosarli(fg, usati);

    var n = document.getElementById('prog-scelta-n');
    if (n) {
      n.textContent = quanti === suoi
        ? (suoi + ' livelli, tutti presi')
        : quanti + ' su ' + suoi + (quanti === 1 ? ' preso' : ' presi');
    }

    document.getElementById('prog-desc').textContent =
      (suoi === 1 ? 'Dentro c\'è 1 livello' : 'Dentro ci sono ' + suoi + ' livelli') +
      ' su ' + quantiFogli(fg) + '. Sul piano adesso ' +
      (ci === 1 ? 'c\'è 1 livello' : 'ci sono ' + ci + ' livelli') + ' su ' +
      (nf === 1 ? 'un foglio' : nf + ' fogli') + '. ' +
      (!quanti
        ? 'Non hai preso nessun livello: spunta quelli che ti servono.'
        : (posa.sopra
            ? 'Aggiungendo, il piano è già quello di questo progetto: i livelli ' +
              'scelti si appoggiano sui fogli che ci sono, con le loro forme, i ' +
              'nomi, le penne e gli spessori, e non arriva altra carta.'
            : 'Aggiungendo, il progetto porta ' +
              (quanti === suoi
                 ? (portati.length === 1 ? 'il suo foglio (' : 'i suoi fogli (')
                 : (portati.length === 1 ? 'il foglio dei livelli scelti ('
                                         : 'i ' + portati.length +
                                           ' fogli dei livelli scelti (')) +
              quantiFogli(portati) + ') sul piano, dove c\'è posto, e i livelli ' +
              'ci restano sopra dov\'erano, con le loro forme, i nomi, le penne ' +
              'e gli spessori: quello che c\'è adesso non si muove.') +
          ' Sostituendo tutto si torna a quel progetto coi soli livelli scelti, ' +
          'e quello che c\'è adesso si perde.');

    /* L'UNICA COSA CHE VA DETTA PRIMA DI SCEGLIERE è che il posto è finito.
       Fino al 6 novembre qui c'era l'avviso del «foglio diverso», e non c'è
       più perché non c'è più il problema: chi arriva porta il suo foglio.
       Quello che resta è che la corsa percorribile non è elastica, e un
       gruppo di fogli che non ci sta finisce di fianco, fuori dalla corsa.
       Si rifà a ogni spunta: togliendo i livelli di un foglio, quel foglio
       non arriva più, e il posto può bastare. */
    var nota = document.getElementById('prog-nota');
    var guaio = quanti ? strettoia(portati, posa) : null;
    nota.hidden = !guaio;
    nota.textContent = !guaio ? '' : 'Aggiungendo: ' + guaio +
      ' Sostituendo tutto, invece, il piano diventa quello del file.';

    /* I due pulsanti dicono su quanti livelli lavorano, e si spengono se non
       ce n'è nessuno: un pulsante che non fa niente è peggio di un pulsante
       spento, perché chi lo preme crede di aver fatto qualcosa. */
    var agg = document.getElementById('prog-aggiungi');
    var sos = document.getElementById('prog-sostituisci');
    var tutti = quanti === suoi;
    agg.disabled = !quanti;
    sos.disabled = !quanti;
    agg.textContent = tutti ? 'Aggiungi i livelli'
                            : 'Aggiungi ' + (quanti === 1 ? 'il livello scelto'
                                                          : 'i ' + quanti + ' scelti');
    sos.textContent = tutti ? 'Sostituisci tutto'
                            : 'Sostituisci con ' + (quanti === 1 ? 'quello scelto'
                                                                 : 'i ' + quanti);
  }

  function mostra() {
    var v = coda[0];
    if (!v) return;
    if (!v.scelti) {
      v.scelti = v.dati.livelli.map(function () { return true; });
    }

    document.getElementById('prog-titolo').textContent = 'Progetto «' + v.nome + '»';
    disegnaElenco(v);
    aggiorna();

    var altri = coda.length - 1;
    var cod = document.getElementById('prog-coda');
    cod.hidden = altri < 1;
    cod.textContent = altri < 1 ? '' :
      altri === 1 ? 'C\'è un altro progetto in attesa: te lo chiedo dopo questo.'
                  : 'Ci sono altri ' + altri + ' progetti in attesa: te li chiedo ' +
                    'uno per uno dopo questo.';

    document.getElementById('prog-modal').hidden = false;
    document.getElementById('prog-aggiungi').focus();
  }

  /* `scelta`: 'aggiungi', 'sostituisci', o niente per lasciare stare.
     La coda va avanti anche se la scelta si rompe per strada: una finestrella
     che non si riapre più è peggio dell'errore che l'ha fatta chiudere. */
  function rispondi(scelta) {
    if (!coda.length) return;
    /* Senza nessun livello preso non c'è niente da applicare, e i due
       pulsanti sono spenti: ci si arriva solo con Invio, e Invio non deve
       fare quello che un pulsante spento non fa. */
    if (scelta && !presi(coda[0]).length) return;
    var v = coda.shift();
    document.getElementById('prog-modal').hidden = true;
    try {
      if (scelta) {
        var tot = v.dati.livelli.length, pre = presi(v).length;
        applica(conSoloScelti(v), v.nome, scelta === 'aggiungi');
        /* Quanti NON ne hai presi si dice dopo, nel registro: la finestrella
           è sparita, e fra un mese «perché qui ce n'erano otto?» è una
           domanda senza risposta. Il file non è stato toccato: quelli
           lasciati stanno ancora lì, e si riaprono quando servono. */
        if (pre < tot) {
          Log.add('msg', 'Di «' + v.nome + '» hai preso ' + pre + ' livelli su ' +
                  tot + ': gli altri ' + (tot - pre) + ' sono rimasti nel file, ' +
                  'che non è stato toccato — si riaprono quando servono.');
        }
      } else Log.add('msg', 'Progetto «' + v.nome + '» non aperto: quello che ' +
                            'c\'era resta com\'è.');
    } catch (e) {
      Log.add('err', 'Non sono riuscito ad aprire «' + v.nome + '»: ' + e.message);
    }
    if (coda.length) mostra();
  }

  function init() {
    var b = document.getElementById('btn-save-prog');
    if (b) b.addEventListener('click', salva);

    /* LE SPUNTE. Un ascoltatore solo sul contenitore, perché l'elenco si
       ridisegna a ogni progetto che arriva e dei gestori attaccati riga per
       riga ne resterebbero in giro. */
    document.getElementById('prog-elenco')
      .addEventListener('change', function (e) {
        var c = e.target.closest('input[data-liv]');
        if (!c || !coda.length) return;
        coda[0].scelti[+c.dataset.liv] = c.checked;
        var riga = c.closest('.prog-liv');
        if (riga) riga.classList.toggle('spenta', !c.checked);
        aggiorna();
      });

    function tutte(v) {
      if (!coda.length) return;
      coda[0].scelti = coda[0].dati.livelli.map(function () { return v; });
      disegnaElenco(coda[0]);
      aggiorna();
    }
    document.getElementById('prog-tutti')
      .addEventListener('click', function () { tutte(true); });
    document.getElementById('prog-nessuno')
      .addEventListener('click', function () { tutte(false); });

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
