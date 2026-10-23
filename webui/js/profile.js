/* I profili: la macchina e la stampa.
 *
 * Sono due, e non per ordine: hanno vite diverse. Il PROFILO MACCHINA cambia
 * solo se smonti o rifai un pezzo, ed è uno. Il PROFILO DI STAMPA cambia
 * quando cambi carta o penna, e ce ne sono quanti ne vuoi, ognuno col suo
 * nome. Tenerli insieme vorrebbe dire rifare le misure della macchina ogni
 * volta che passi a un altro foglio.
 *
 * I nomi dei campi non sono liberi: stanno in misure/impostazioni-glossario.md
 * e si cambiano lì prima che qui.
 *
 * Questo è anche il documento sorgente della macchina: `config.yaml` di
 * FluidNC si GENERA da qui (vedi toYaml), non si scrive a mano. Così un numero
 * si digita in un posto solo e il file sulla macchina è un prodotto, non una
 * seconda copia che prima o poi diverge.
 *
 * Perché generare il file invece di cambiare le impostazioni a runtime: sulla
 * 4.1.0 il comando `$/axes/...=` non restituisce nulla e non ha effetto (nostro
 * collaudo del 2026-09-21), e la documentazione FluidNC dice comunque che le
 * modifiche `$` vivono in memoria volatile e che i pin richiedono un riavvio.
 * Quindi: genera, carica, `$Bye`.
 *
 * COSA NON STA QUI, e non è una dimenticanza:
 *
 *   - l'origine di homing e l'altezza di contatto col foglio. Sono misure del
 *     momento: dipendono da dove hai appoggiato il foglio e da quanto è spesso.
 *     Salvarle come default significa, dopo un riavvio, fidarsi di un'origine
 *     che non vale più. Stanno in State, e il popup di inizio stampa le mostra
 *     come "ultimo valore usato" senza applicarle.
 *   - la mappa dei pin. È cablaggio, non taratura: sta nel generatore qui sotto
 *     come costante. Un campo modificabile per i pin è solo un modo per
 *     rompersi la macchina da un menu.
 *   - host, modalità finta, preferenze dell'interfaccia. Sono del browser.
 */
var Profile = (function () {

  var KEY = 'gdc.cnc2d.profilo';
  var SCHEMA = 2;

  /* Cablaggio, fisso. L'abbinamento nome↔pin è stato sbagliato una volta
     (2026-10-15 ÷ 2026-10-19) e la verifica è questa: un movimento su X muove
     il CARRELLO LUNGO LA TRAVE, non tutto il portale. */
  var PIN = {
    x: { step: 'gpio.4',  dir: 'gpio.26' },
    y: { step: 'gpio.25', dir: 'gpio.33' },
    enable: 'gpio.27',
    servo: 'gpio.32',
    led: ['gpio.18', 'gpio.19', 'gpio.2']
  };

  var MM_PER_GIRO_NOMINALE = Math.PI * 1.5 * 20;   // 94,2478: modulo 1,5, z20

  /* `null` non è zero: vuol dire "non ancora misurato". L'interfaccia lo deve
     mostrare come tale invece di far finta che valga zero, e verifica() si
     rifiuta di dare il via libera finché ce n'è uno in giro. */
  function macchinaDefault() {
    return {
      nome: 'GDC CNC 2D',
      aggiornato: null,

      trasmissione: {
        passiGiroMotore: 200,
        microstep: 16,
        /* mmPerGiro è la circonferenza primitiva REALE del pignone di
           quell'asse — quanto avanza l'asse in un giro completo. Le due
           cremagliere sono stampate separatamente e si sono ritirate di
           quantità diverse: con un valore solo i quadrati escono rettangoli.
           `tarato` dice se il numero viene da una misura o è ancora il
           nominale. */
        /* VERIFICATI sulla macchina il 2026-10-22, al primo avvio di FluidNC:
           erano sbagliati tutti e due. Con `invertito: true` su X e false su Y
           un `$J=G91 X25` portava il carrello VERSO il suo blocco invece che
           via, e lo stesso faceva Y al contrario. Non è strano che fossero
           sbagliati entrambi: nessuno dei due era mai stato provato, e il
           `:low` su X era una deduzione — il file stesso diceva «da confermare
           al primo avvio guardando il verso». */
        x: { mmPerGiro: MM_PER_GIRO_NOMINALE, tarato: false, invertito: false },
        y: { mmPerGiro: MM_PER_GIRO_NOMINALE, tarato: false, invertito: true }
      },

      /* LA CORSA SI CONSERVA IN PASSI, e non è un vezzo.
         Le due misure del 2026-10-19 — 257,532 e 243,041 mm lette sul DRO —
         valgono esattamente 8744 e 8252 passi, interi a meno di due centesimi
         di passo. Non è un caso: il DRO non misura millimetri, conta passi e li
         divide per il rapporto NOMINALE. I passi sono la misura; i millimetri
         sono un'interpretazione, buona quanto quel rapporto.
         Il giorno in cui il rapporto si tara disegnando, la corsa in
         millimetri cambia pur non avendo toccato la macchina. Salvando i
         millimetri avrei congelato l'interpretazione sbagliata. */
      corse: {
        /* Il margine era 8 mm, scelti a occhio per coprire l'errore con cui si
           parcheggiava l'origine a mano. Con i blocchi di homing quel termine è
           sparito — l'appoggio ripete sotto la risoluzione del calibro — e
           restano solo il gioco della cremagliera (0,30) e l'incertezza su dove
           sia davvero la battuta lontana, che il conteggio gonfia perché
           spingendoci contro il motore slitta e il contatore no. Due
           millimetri li coprono con abbondanza. L'errore di scala NON entra:
           limite e comando sono entrambi in unità del DRO, quindi si
           semplifica. */
        /* `ostacolo` è un'altra cosa dal margine, e tenerli separati non è
           pedanteria: il margine copre l'INCERTEZZA (quanto ripete l'appoggio,
           il gioco), l'ostacolo è un impedimento MECCANICO certo, che si toglie
           smontando qualcosa e non diventando più precisi. Sommarli in un unico
           numero vorrebbe dire, fra sei mesi, non sapere più se quei millimetri
           si possono recuperare o no.

           X vale 10 il 2026-10-23: il pignone del carrello tocca la cremagliera
           dell'asse Y sul lato destro PRIMA che il carrello arrivi in fondo.
           L'interferenza misurata è 5 mm, se ne tolgono 10 per stare larghi
           finché non è rimisurata con calma. È un limite della geometria del
           montaggio: sparirà se la cremagliera di Y verrà spostata, non
           migliorando la taratura. */
        x: { corsaPassi: 8744, margineSicurezza: 2.0, ostacolo: 10.0,
             misurato: '2026-10-19' },
        y: { corsaPassi: 8252, margineSicurezza: 2.0, ostacolo: 0,
             misurato: '2026-10-19' }
      },

      /* Niente finecorsa elettrici, ma un riferimento fisico: blocchi stampati
         agganciati alle staffe TT e LL contro cui si appoggiano i carrelli.

         `scostamento` è quanto il blocco sta dentro rispetto alla battuta
         meccanica: si ricava azzerando sul blocco e portando l'asse all'altra
         battuta — la corsa che si legge è quella disponibile dall'home, e lo
         scostamento è la corsa totale meno quella.

         `ripetibilita` è il numero che giustifica il margine di sicurezza, e
         NON si misura col DRO: liberare i motori per riappoggiare il carrello
         è esattamente il gesto che azzera quello che il contatore sa. Si
         misura col calibro, da un riferimento fisso alla faccia del carrello,
         ripetendo l'appoggio cinque o sei volte. */
      homing: {
        /* RIMISURATI il 2026-10-22, dopo che l'utente ha spostato una
           cremagliera e rifatto un blocco: azzerato sul blocco e portato
           l'asse all'altra battuta si legge 253,232 su X e 238,064 su Y,
           contro 257,532 e 243,042 da battuta a battuta (8744 e 8252 passi,
           misurati il 2026-10-19 senza blocchi e non rimisurati da allora).
           Quindi i blocchi mangiano 146 passi su X e 169 su Y.

           Le due letture valgono 8597,986 e 8082,987 passi: a quattro decimi
           di micron da un intero. È la stessa conferma del 2026-10-19 — il DRO
           non misura millimetri, conta passi e li divide per il rapporto.

           Supera i valori precedenti (1,443 su X e 0 su Y): su Y il blocco non
           sta più sulla battuta, ne sta 5 mm dentro.

           La ripetibilità non è zero: è sotto la risoluzione del calibro, che
           è un'altra cosa. Si registra 0,05 — "più piccola di quanto so
           misurare" — perché uno zero vero direbbe al software che un margine
           di zero basterebbe. */
        x: { scostamento: 4.300, ripetibilita: 0.05 },
        y: { scostamento: 4.977, ripetibilita: 0.05 },

        /* Il PUNTO HOME non è lo zero: lo zero è il PUNTO AI BLOCCHI, dove i
           carrelli toccano. Finito l'azzeramento la macchina si sposta qui, a
           cinque millimetri da entrambi i blocchi, e ci resta.
           Serve a due cose. La prima è non lasciare i carrelli appoggiati ai
           blocchi: un carrello fermo contro il riferimento prima o poi lo
           sposta, e il riferimento è la cosa che non deve muoversi. La seconda
           è che allontanandosi in + il gioco della cremagliera viene preso da
           una parte sola e sempre la stessa, quindi il primo movimento vero
           parte da una condizione nota. */
        puntoHome: { x: 5.0, y: 5.0 }
      },

      /* velocitaMax è un TETTO, non una velocità di lavoro: quella la decide la
         F del G-code, e sta nel profilo di stampa. L'accelerazione invece
         agisce su ogni movimento ed è quella che scuote il portale — resta
         bassa finché il modulo penna non è montato, perché è il suo sbalzo a
         decidere quanta imbardata genera uno strappo. */
      dinamica: {
        x: { velocitaMax: 8000, accelerazione: 200 },
        y: { velocitaMax: 8000, accelerazione: 200 }
      },

      penna: {
        /* Raggio primitivo del pignone del pen-lift (z25, modulo 1,5): è il
           solo parametro di conversione fra gradi di servo e millimetri di
           penna, 0,32725 mm/grado. Con esso l'interfaccia può far inserire
           alzata e appoggio in millimetri invece che in gradi. */
        raggioPignone: 18.75,

        /* I tre angoli, rilevati sul modulo montato il 2026-10-21.

           gradiBattuta è un LIMITE: i cuscinetti in fondo ai blocchi
           inferiori. Il software non deve mai poter comandare una quota che lo
           raggiunga. Fissato per costruzione a 19 il 2026-10-21 calzando il
           pignone con la dashboard a quell'angolo, e MISURATO 17 il
           2026-10-22 con la prova della striscia di carta: i due gradi di
           differenza sono quello che il modulo aveva ancora da scendere
           quando il pignone è stato calzato. Vale la misura (2311 µs).
           Diciassette e non uno, com'era al primo tentativo, perché a 1 grado
           logico l'impulso è 2489 µs, fuori dai 500÷2400 di specifica
           dell'SG90: il pignone era stato calzato col servo già contro il
           proprio fermo interno, e il fermo del meccanismo non si distingueva
           da quello del servo.

           gradiPennaAbbassata è il contatto NOMINALE, quello a cui la penna si
           stringe nel modulo: non si misura, si impone stringendo la penna a
           quell'angolo contro il piano di riferimento. Il contatto di oggi su
           questo foglio è un'altra cosa e sta in State: vedi il glossario.

           gradiPennaAlzata è un conto: abbassata + 9°, cioè 2,945 mm.

           Nota sui 25: erano nati come battuta + 6, ma la battuta vera è 17,
           quindi sono battuta + 8. Non si correggono — 25 è l'angolo a cui la
           penna È STATA STRETTA e a cui tocca il foglio, verificato
           disegnando il 2026-10-22. C'è solo più riserva verso il basso di
           quanta ne era stata prevista. */
        gradiBattuta: 17,
        gradiPennaAbbassata: 25,
        gradiPennaAlzata: 34,

        /* POSIZIONE TAPPO: l'angolo a cui la penna sale a fine stampa e
           all'accensione, per lasciare spazio a infilare il tappo senza
           togliere la penna dai morsetti. È anche il TETTO del meccanismo —
           90° è il massimo prima che lo stadio flottante esca dalle guide,
           verificato sulla macchina il 2026-10-22 (il CAD dà 26,350 mm di
           corsa, cioè 80,5°, che dalla battuta sarebbero 97,5: vale la
           macchina). */
        gradiTappo: 90,

        /* Corrispondenza gradi→microsecondi della dashboard: 0÷180° su
           500÷2500 µs. Serve a tradurre i tre angoli negli estremi dell'impulso
           che FluidNC vuole. */
        impulsoMinUs: 500,
        impulsoMaxUs: 2500,

        /* Verso del servo. Sul modulo montato il 2026-10-21 l'accoppiamento
           esce invertito: facendo crescere l'angolo FISICO la penna scende.
           I tre angoli qui sopra sono quindi gradi LOGICI — più gradi = penna
           più in alto — come li mostra la dashboard, e la conversione in
           microsecondi veri la fa gradiToUs() in un punto solo.
           Deve valere lo stesso flag in tutte e due: se il firmware e il
           profilo non concordano, la dashboard alza e FluidNC abbassa. */
        invertito: true
      },

      /* Sola lettura, e non serve a compensare niente: non c'è un secondo
         riferimento con cui sapere da che parte del gioco si sta. È il limite
         di ripetibilità della macchina — una linea ripassata nel verso opposto
         può cadere fino a 0,3 mm di lato — e sta qui perché è il numero che
         spiega gli artefatti sul foglio. */
      gioco: { x: 0.30, y: 0.30 },

      /* Resta a zero, e non è una dimenticanza: l'origine la si imposta
         portando LA PUNTA della penna sul punto, quindi l'offset fra
         riferimento del carrello e punta è già assorbito. */
      utensile: { offsetX: 0, offsetY: 0 }
    };
  }

  /* Con 251,23 × 236,06 di corsa percorribile l'A4 non entra in nessun
     orientamento: chiede 297 in un verso e il più lungo è 251. La macchina è
     una A5 — un B5 ci sta per un millimetro, l'A4 no. */
  function stampaDefault() {
    return {
      nome: 'A5 — valori di partenza',
      foglio: { formato: 'A5', larghezza: 148, altezza: 210 },
      velocitaDisegno: 1200,
      velocitaSpostamento: 3000,
      /* Senza pausa, a 50 mm/s si sbavano 4 mm di tratto mentre il servo sta
         ancora andando. */
      pausaPennaMs: 200,
      /* `null` vuol dire "usa tutta l'alzata disponibile". Un valore minore
         serve solo se l'alzata piena fa perdere tempo su disegni con molti
         stacchi. */
      alzataLavoro: null
    };
  }

  function defaults() {
    return {
      schema: SCHEMA,
      macchina: macchinaDefault(),
      stampa: stampaDefault(),
      libreria: []        // profili di stampa salvati, ognuno col suo nome
    };
  }

  var corrente = null;

  /* Fonde il salvato sui valori di partenza invece di usarlo così com'è: un
     profilo salvato con una versione vecchia non ha i campi aggiunti dopo, e
     senza questa fusione l'interfaccia leggerebbe `undefined` da un campo che
     crede di avere. Vale anche al contrario: un campo tolto dal modello
     semplicemente non viene ripreso. Gli array si sostituiscono interi. */
  function fondi(base, salvato) {
    if (!salvato || typeof salvato !== 'object') return base;
    for (var k in base) {
      if (!Object.prototype.hasOwnProperty.call(salvato, k)) continue;
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        fondi(base[k], salvato[k]);
      } else if (salvato[k] !== undefined) {
        base[k] = salvato[k];
      }
    }
    return base;
  }

  /* Dallo schema 1 — un profilo piatto, con la corsa in millimetri e nomi
     diversi — a questo. Senza, un profilo salvato ieri tornerebbe ai valori di
     partenza in silenzio, e le due corse misurate sulla macchina sarebbero da
     riprendere. */
  function migra(letto) {
    if (!letto || letto.schema >= 2) return letto;
    var m = macchinaDefault(), s = stampaDefault();

    if (letto.nome) m.nome = letto.nome;
    if (letto.trasmissione) fondi(m.trasmissione, letto.trasmissione);

    ['x', 'y'].forEach(function (a) {
      var vecchio = letto.corse && letto.corse[a];
      if (!vecchio) return;
      if (typeof vecchio.margine === 'number') m.corse[a].margineSicurezza = vecchio.margine;
      /* Un profilo salvato prima del 2026-10-23 non ha il campo: senza questo
         resterebbe undefined e la sottrazione darebbe NaN, cioè un'area di
         lavoro che non è un numero. Zero è il valore giusto per chi non ha
         mai rilevato un ostacolo. */
      if (typeof m.corse[a].ostacolo !== 'number') m.corse[a].ostacolo = 0;
      if (typeof vecchio.corsa === 'number') {
        /* La corsa era in millimetri: si riporta in passi col rapporto con cui
           era stata letta, che è quello salvato nello stesso profilo. */
        var mmGiro = (letto.trasmissione && letto.trasmissione[a] &&
                      letto.trasmissione[a].mmPerGiro) || MM_PER_GIRO_NOMINALE;
        var spmm = (m.trasmissione.passiGiroMotore * m.trasmissione.microstep) / mmGiro;
        m.corse[a].corsaPassi = Math.round(vecchio.corsa * spmm);
      }
      if (letto.dinamica && letto.dinamica[a]) fondi(m.dinamica[a], letto.dinamica[a]);
    });

    if (letto.penna) {
      fondi(m.penna, letto.penna);
      if (typeof letto.penna.gradiAppoggio !== 'undefined') {
        m.penna.gradiPennaAbbassata = letto.penna.gradiAppoggio;
      }
      if (typeof letto.penna.gradiAlzata !== 'undefined') {
        m.penna.gradiPennaAlzata = letto.penna.gradiAlzata;
      }
      if (typeof letto.penna.pausaMs === 'number') s.pausaPennaMs = letto.penna.pausaMs;
    }
    if (letto.utensile) fondi(m.utensile, letto.utensile);
    if (letto.foglio) fondi(s.foglio, letto.foglio);
    if (letto.dinamica) {
      if (typeof letto.dinamica.velocitaDisegno === 'number') s.velocitaDisegno = letto.dinamica.velocitaDisegno;
      if (typeof letto.dinamica.velocitaSpostamento === 'number') s.velocitaSpostamento = letto.dinamica.velocitaSpostamento;
    }

    return { schema: SCHEMA, macchina: m, stampa: s, libreria: [] };
  }

  function load() {
    var p = defaults();
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) p = fondi(p, migra(JSON.parse(raw)));
    } catch (e) {
      /* localStorage può mancare o essere bloccato (finestra anonima, dati di
         sito cancellati). Si riparte dai valori di partenza invece di fermarsi:
         un profilo di default è sempre meglio di una pagina che non apre. */
      p = defaults();
    }
    p.schema = SCHEMA;
    corrente = p;
    return corrente;
  }

  function get()      { return corrente || load(); }
  function macchina() { return get().macchina; }
  function stampa()   { return get().stampa; }

  function save() {
    var p = get();
    p.macchina.aggiornato = new Date().toISOString();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(p));
      return true;
    } catch (e) {
      return false;
    }
  }

  function reset() {
    corrente = defaults();
    save();
    return corrente;
  }

  /* ----------------------- la libreria dei profili di stampa ---------------
     Il profilo di stampa attivo è uno; la libreria sono le copie con un nome,
     come i profili di Bambu. Salvare non attiva e caricare non salva: sono due
     gesti distinti, e confonderli vuol dire perdere le modifiche in corso
     senza accorgersene. */

  function elencoStampe() {
    return get().libreria.map(function (s) { return s.nome; });
  }

  function salvaStampa(nome) {
    var p = get();
    var copia = JSON.parse(JSON.stringify(p.stampa));
    copia.nome = nome || copia.nome;
    var i = p.libreria.findIndex(function (s) { return s.nome === copia.nome; });
    if (i >= 0) p.libreria[i] = copia; else p.libreria.push(copia);
    p.stampa.nome = copia.nome;
    save();
    return copia.nome;
  }

  function caricaStampa(nome) {
    var p = get();
    var trovato = p.libreria.filter(function (s) { return s.nome === nome; })[0];
    if (!trovato) return false;
    p.stampa = fondi(stampaDefault(), JSON.parse(JSON.stringify(trovato)));
    save();
    return true;
  }

  function eliminaStampa(nome) {
    var p = get();
    var prima = p.libreria.length;
    p.libreria = p.libreria.filter(function (s) { return s.nome !== nome; });
    if (p.libreria.length === prima) return false;
    save();
    return true;
  }

  /* ----------------------------- conti derivati ----------------------------
     Nessuno di questi valori viene salvato: si ricalcolano sempre dai dati
     grezzi. Un numero calcolato e salvato è un numero che un giorno non
     corrisponderà più a quello da cui era stato calcolato. */

  function passiPerMm(asse) {
    var t = macchina().trasmissione;
    return t.passiGiroMotore * t.microstep / t[asse].mmPerGiro;
  }

  function passiAMm(asse, passi) { return passi / passiPerMm(asse); }
  function mmAPassi(asse, mm)    { return Math.round(mm * passiPerMm(asse)); }

  /* Corsa totale: da battuta a battuta, tutto quello che l'asse sa fare. */
  function corsaTotale(asse) {
    return passiAMm(asse, macchina().corse[asse].corsaPassi);
  }

  /* Quanta corsa resta partendo dal blocco di homing: la totale meno quello che
     il blocco si mangia. È da qui che si contano tutte le coordinate, perché lo
     zero è il blocco. */
  function corsaDaHome(asse) {
    var sc = macchina().homing[asse].scostamento;
    return corsaTotale(asse) - (sc === null ? 0 : Math.max(0, sc));
  }

  /* Corsa percorribile: quella dall'home, meno il margine di sicurezza e meno
     l'eventuale ostacolo meccanico. È il confine che il software fa rispettare,
     e vale l'identità del glossario
     (percorribile + margine + ostacolo + scostamento = totale).
     Senza finecorsa non c'è nessuno che lo faccia rispettare a valle, quindi è
     l'interfaccia a dover verificare l'ingombro prima di far partire un
     programma. */
  function corsaPercorribile(asse) {
    var c = macchina().corse[asse];
    return Math.max(0, corsaDaHome(asse) - c.margineSicurezza - (c.ostacolo || 0));
  }

  function passiPercorribili(asse) {
    return Math.round(corsaPercorribile(asse) * passiPerMm(asse));
  }

  function areaUtile() {
    return { w: corsaPercorribile('x'), h: corsaPercorribile('y') };
  }

  /* Il nuovo rapporto da una figura disegnata e misurata col calibro: il
     comandato lo sa il G-code, il misurato lo dà il calibro sulle due linee
     (esterno-esterno + interno-interno diviso due, che cancella la larghezza
     del tratto). La corsa in passi NON si tocca: è una misura, e resta valida. */
  var MM_PER_GIRO_MIN = 60, MM_PER_GIRO_MAX = 130;

  function taraAsse(asse, mmComandati, mmMisurati) {
    if (!(mmComandati > 0) || !(mmMisurati > 0)) {
      return { ok: false, motivo: 'Le due misure devono essere positive.' };
    }
    var t = macchina().trasmissione[asse];
    var nuovo = t.mmPerGiro * mmMisurati / mmComandati;
    if (nuovo < MM_PER_GIRO_MIN || nuovo > MM_PER_GIRO_MAX) {
      return {
        ok: false,
        motivo: 'Ne uscirebbe ' + nuovo.toFixed(3) + ' mm/giro, fuori da ' +
                MM_PER_GIRO_MIN + '÷' + MM_PER_GIRO_MAX + '. Controlla le due ' +
                'misure, e se il numero è vicino alla metà o al doppio guarda i ' +
                'DIP dei microstep prima della cremagliera.'
      };
    }
    var prima = t.mmPerGiro;
    t.mmPerGiro = nuovo;
    t.tarato = true;
    save();
    return { ok: true, prima: prima, dopo: nuovo, scarto: (nuovo / prima - 1) * 100 };
  }

  function mmPerGrado() {
    return macchina().penna.raggioPignone * Math.PI / 180;
  }

  function gradiPerMm(mm) { return mm / mmPerGrado(); }

  /* Da gradi LOGICI a microsecondi veri. È l'unico punto in cui il verso del
     servo entra nei conti del profilo. */
  function gradiToUs(gradi) {
    var p = macchina().penna;
    var g = p.invertito ? (180 - gradi) : gradi;
    return p.impulsoMinUs + g * (p.impulsoMaxUs - p.impulsoMinUs) / 180;
  }

  /* Alzata utile in millimetri fra penna abbassata e penna alzata. È anche il
     max_travel_mm dell'asse Z nel file di FluidNC: così Z è in millimetri veri
     di penna invece che in unità arbitrarie. */
  function alzataMm() {
    var p = macchina().penna;
    if (p.gradiPennaAbbassata === null || p.gradiPennaAlzata === null) return null;
    return (p.gradiPennaAlzata - p.gradiPennaAbbassata) * mmPerGrado();
  }

  /* Quota Z della posizione tappo, in millimetri di penna sopra il contatto.
     È anche il max_travel_mm dell'asse Z: l'arco che FluidNC deve poter
     comandare va dal contatto al tappo, non dal contatto all'alzata, se no la
     posizione tappo cade fuori e mapConstrain la tronca. */
  function tappoMm() {
    var p = macchina().penna;
    if (p.gradiPennaAbbassata === null || p.gradiTappo === null) return null;
    return (p.gradiTappo - p.gradiPennaAbbassata) * mmPerGrado();
  }

  /* --------------------- le quote Z in coordinate MACCHINA -----------------

     QUESTE sono le quote da mandare alla macchina, e sono NEGATIVE. Il motivo
     non è una scelta nostra: è come FluidNC colloca lo zero.

     Senza finecorsa e senza homing, FluidNC mette lo zero macchina all'ESTREMO
     ALTO della corsa e dichiara il resto in negativo. Verificato con $CD sulla
     macchina il 2026-10-22: «Axis Z (-21.281, 0.010)».

     Il servo non è un asse vero, e RcServo mappa la posizione MACCHINA, non
     quella di lavoro, con mapConstrain(): tutto quello che cade fuori da
     quell'intervallo non viene rifiutato con un errore, viene TRONCATO
     all'estremo. Quindi Z+2,945 non è «2,945 sopra il contatto»: è fuori
     corsa, e diventa 0 — la posizione tappo. È il bug per cui il 2026-10-22 la
     penna non si muoveva pur avendo gli impulsi giusti: ogni quota positiva
     finiva sullo stesso impulso.

     Da cui la convenzione, e non ce n'è un'altra possibile:
         Z 0           posizione tappo, in cima (gradiTappo)
         Z −18,326     penna alzata di lavoro (gradiPennaAlzata)
         Z −21,271     penna sul foglio (gradiPennaAbbassata)
     Z scende in negativo verso il foglio, e il fondo corsa è il contatto.

     Un effetto collaterale buono: all'accensione FluidNC assume Z0, e con
     questa convenzione Z0 è DAVVERO dove va il servo (1500 µs, 90°). Prima
     assumeva il contatto e il servo andava al tappo: la macchina partiva
     credendo una cosa e facendone un'altra. */
  function zDaGradi(gradi) {
    var p = macchina().penna;
    if (gradi === null || p.gradiTappo === null) return null;
    /* La sottrazione in questo verso e non col meno davanti: così il tappo
       esce 0 e non -0, che è un numero diverso per Object.is e per chi legge. */
    return (gradi - p.gradiTappo) * mmPerGrado();
  }

  /* Il punto home: non è lo zero, è dove i carrelli si parcheggiano. Un
     accessore invece di frugare in macchina().homing, perché adesso lo legge
     anche il generatore di G-code: ogni programma deve FINIRE qui, non sullo
     zero, se no lascia i carrelli appoggiati ai blocchi — e il blocco è il
     riferimento, cioè la cosa che non deve muoversi. */
  function puntoHome() {
    var h = macchina().homing.puntoHome;
    return { x: h.x, y: h.y };
  }

  function zTappo() { return zDaGradi(macchina().penna.gradiTappo); }
  function zAlzata() { return zDaGradi(macchina().penna.gradiPennaAlzata); }
  function zContatto() { return zDaGradi(macchina().penna.gradiPennaAbbassata); }

  /* ------------------------------- verifica --------------------------------
     Restituisce l'elenco di quello che manca o non torna. Serve in due posti:
     nella tab Impostazioni per dire cosa resta da misurare, e prima di far
     partire una stampa. Mai un booleano solo: se qualcosa blocca, chi lo legge
     deve poter dire ALL'UTENTE che cosa. */
  function verifica() {
    var m = macchina(), problemi = [];

    if (!m.trasmissione.x.tarato || !m.trasmissione.y.tarato) {
      problemi.push({
        gravita: 'avviso', campo: 'trasmissione', passo: 'A6',
        testo: 'I mm per giro ingranaggio sono ancora quelli nominali su almeno ' +
               'un asse. Il disegno uscirà in scala sbagliata della stessa ' +
               'percentuale di cui le cremagliere si sono ritirate.'
      });
    }

    ['x', 'y'].forEach(function (a) {
      var A = a.toUpperCase(), c = m.corse[a];
      if (!(c.corsaPassi > 0)) {
        problemi.push({
          gravita: 'blocco', campo: 'corse.' + a, passo: 'A1',
          testo: 'Corsa totale dell\'asse ' + A + ' non misurata.'
        });
      }
      if (c.margineSicurezza < 0) {
        problemi.push({
          gravita: 'blocco', campo: 'corse.' + a,
          testo: 'Margine di sicurezza negativo sull\'asse ' + A + '.'
        });
      }
      if (m.homing[a].scostamento === null) {
        problemi.push({
          gravita: 'avviso', campo: 'homing.' + a,
          testo: 'Lo scostamento del blocco di homing sull\'asse ' + A + ' non è ' +
                 'stato misurato: le coordinate partono dalla battuta meccanica, ' +
                 'ma lo zero vero è il blocco. Finché manca, l\'area di lavoro è ' +
                 'sovrastimata di quanto il blocco sta dentro.'
        });
      }
      if (c.corsaPassi > 0 && corsaPercorribile(a) <= 0) {
        problemi.push({
          gravita: 'blocco', campo: 'corse.' + a,
          testo: 'Sull\'asse ' + A + ' il margine di sicurezza e l\'ostacolo si ' +
                 'mangiano tutta la corsa: non resta niente da percorrere.'
        });
      }
      if (c.ostacolo < 0) {
        problemi.push({
          gravita: 'blocco', campo: 'corse.' + a,
          testo: 'L\'ostacolo meccanico sull\'asse ' + A + ' è negativo: un ' +
                 'impedimento non può allungare la corsa.'
        });
      }
      /* La ripetibilità dell'appoggio al blocco di homing è il motivo per cui
         il margine esiste. Se è stata misurata e il margine è più piccolo, il
         margine non protegge da niente. */
      var r = m.homing[a].ripetibilita;
      if (r !== null && c.margineSicurezza < r) {
        problemi.push({
          gravita: 'avviso', campo: 'homing.' + a,
          testo: 'Sull\'asse ' + A + ' il margine di sicurezza (' +
                 c.margineSicurezza.toFixed(1) + ' mm) è minore della ' +
                 'ripetibilità dell\'homing (' + r.toFixed(1) + ' mm): la ' +
                 'battuta si può prendere anche restando nell\'area.'
        });
      }
    });

    var pen = m.penna;
    if (pen.gradiBattuta === null || pen.gradiPennaAbbassata === null ||
        pen.gradiPennaAlzata === null) {
      problemi.push({
        gravita: 'blocco', campo: 'penna', passo: 'A2',
        testo: 'I tre angoli del servo non sono stati rilevati: si prendono ' +
               'con la dashboard, a modulo penna montato.'
      });
    } else if (pen.gradiTappo === null) {
      /* Senza il tappo non c'è lo zero: tutte le quote Z si contano da lì, e
         senza di esso zDaGradi() non sa dire nemmeno dove sta il contatto. */
      problemi.push({
        gravita: 'blocco', campo: 'penna', passo: 'A2',
        testo: 'Manca la posizione tappo, che è lo zero da cui si contano ' +
               'tutte le quote della penna: senza di essa il programma non ' +
               'ha una quota di contatto da comandare.'
      });
    } else if (!(pen.gradiBattuta < pen.gradiPennaAbbassata &&
                 pen.gradiPennaAbbassata < pen.gradiPennaAlzata &&
                 pen.gradiPennaAlzata <= pen.gradiTappo)) {
      problemi.push({
        gravita: 'blocco', campo: 'penna',
        testo: 'I quattro angoli del servo devono crescere: battuta < penna ' +
               'abbassata < penna alzata ≤ posizione tappo. Così come sono, il ' +
               'software potrebbe comandare la battuta meccanica, o chiedere ' +
               'una quota sopra il fine corsa alto.'
      });
    }

    var f = stampa().foglio;
    var area = areaUtile();
    if (f.larghezza > area.w || f.altezza > area.h) {
      problemi.push({
        gravita: 'avviso', campo: 'foglio',
        testo: 'Il foglio ' + f.formato + ' (' + f.larghezza + ' × ' + f.altezza +
               ') non ci sta nell\'area di lavoro (' + area.w.toFixed(1) + ' × ' +
               area.h.toFixed(1) + '): si può disegnare solo su una parte.'
      });
    }

    return problemi;
  }

  /* Ci sta un disegno di questo ingombro, col foglio appoggiato lì? È l'unica
     protezione rimasta finché non ci sono i finecorsa, quindi vive qui e non
     dentro un pulsante. `origineFoglio` sono le coordinate macchina dell'angolo
     in basso a sinistra del foglio, cioè quello che dà il popup 3. */
  function stanoDentro(ingombro, origineFoglio) {
    var o = origineFoglio || { x: 0, y: 0 };
    var lx = corsaPercorribile('x'), ly = corsaPercorribile('y');
    var fuori = [];
    if (o.x + ingombro.x0 < 0) fuori.push('a sinistra di ' + (-(o.x + ingombro.x0)).toFixed(1) + ' mm');
    if (o.y + ingombro.y0 < 0) fuori.push('sotto di ' + (-(o.y + ingombro.y0)).toFixed(1) + ' mm');
    if (o.x + ingombro.x1 > lx) fuori.push('a destra di ' + (o.x + ingombro.x1 - lx).toFixed(1) + ' mm');
    if (o.y + ingombro.y1 > ly) fuori.push('sopra di ' + (o.y + ingombro.y1 - ly).toFixed(1) + ' mm');
    return { ok: fuori.length === 0, fuori: fuori };
  }

  /* ------------------------- esportazione e importazione -------------------
     I profili vivono in localStorage, che è per-browser e sparisce se si
     cancellano i dati del sito. L'esportazione in JSON è la copia che
     sopravvive, e che si può committare nel repo accanto al resto. */

  function toJson() { return JSON.stringify(get(), null, 2); }

  function fromJson(testo) {
    corrente = fondi(defaults(), migra(JSON.parse(testo)));
    corrente.schema = SCHEMA;
    save();
    return corrente;
  }

  /* ------------------------------ il config.yaml ---------------------------
     Generato, non scritto a mano. Si carica sulla macchina e si riavvia con
     `$Bye`. Ci finisce SOLO il profilo macchina: le velocità di lavoro e la
     pausa della penna sono del profilo di stampa e vanno nel G-code.

     Due cose restano false finché non ci sono i finecorsa, e non per scelta:
     `soft_limits` vuole una macchina azzerata e l'azzeramento vuole i
     finecorsa. Finché è così, l'unica protezione contro un movimento fuori
     area è stanoDentro() qui sopra. */
  /* Il parser di FluidNC NON accetta commenti in coda a una coppia
     chiave: valore — solo righe che cominciano con `#`. Una riga come
     `steps_per_mm: 33.953   # ...` gli fa ignorare la chiave, e con
     max_travel_mm o con gli impulsi del servo vorrebbe dire scoprirlo sulla
     macchina. Quindi qui ogni commento sta su una riga sua, e la regola vale
     anche per chi modifica il file a mano. */
  function toYaml() {
    var m = macchina();
    var n = function (v, d) { return Number(v).toFixed(d === undefined ? 3 : d); };
    var L = [];
    var c = function (ind, testo) { L.push(ind + '# ' + testo); };
    var k = function (riga) { L.push(riga); };

    /* FluidNC inverte il livello di un pin con il modificatore `:low`. Da
       confermare al primo avvio guardando il verso: se un asse va al
       contrario, è questo. */
    var dirPin = function (a) {
      return PIN[a].dir + (m.trasmissione[a].invertito ? ':low' : '');
    };

    var asse = function (a, nome, descrizione) {
      var t = m.trasmissione[a];
      var sc = m.homing[a].scostamento === null ? 0 : m.homing[a].scostamento;
      c('  ', nome + ' — ' + descrizione);
      k('  ' + a + ':');
      c('    ', n(t.mmPerGiro, 4) + ' mm per giro ingranaggio' +
                (t.tarato ? ' (tarato)' : ' (NOMINALE, da tarare)'));
      k('    steps_per_mm: ' + n(passiPerMm(a)));
      k('    max_rate_mm_per_min: ' + n(m.dinamica[a].velocitaMax));
      k('    acceleration_mm_per_sec2: ' + n(m.dinamica[a].accelerazione));
      /* Lo zero di FluidNC è il blocco di homing, non la battuta: il limite
         di corsa che gli interessa è quello che resta da lì in avanti. */
      c('    ', 'Corsa dal blocco di homing. Totale ' + n(corsaTotale(a)) +
                ' (' + m.corse[a].corsaPassi + ' passi), blocco a ' + n(sc, 3) +
                ' dalla battuta.');
      c('    ', 'Percorribile ' + n(corsaPercorribile(a)) +
                ' (margine ' + n(m.corse[a].margineSicurezza, 1) +
                (m.corse[a].ostacolo ? ', ostacolo ' + n(m.corse[a].ostacolo, 1) : '') + ').');
      if (m.corse[a].ostacolo) {
        c('    ', "L'ostacolo è un impedimento meccanico: qualcosa si tocca prima");
        c('    ', 'della fine corsa. max_travel_mm resta la corsa FISICA, perché');
        c('    ', 'descrive la macchina; a non uscire dal percorribile ci pensa');
        c('    ', "l'interfaccia prima di generare un programma.");
      }
      k('    max_travel_mm: ' + n(corsaDaHome(a)));
      k('    soft_limits: false');
      k('');
      k('    motor0:');
      c('      ', 'Finecorsa non montati: homing a mano sui blocchi stampati.');
      k('      hard_limits: false');
      k('      stepstick:');
      k('        step_pin: ' + PIN[a].step);
      k('        direction_pin: ' + dirPin(a));
      k('');
    };

    var pen = m.penna;
    var tappo = tappoMm(), alzata = alzataMm();
    var tarata = tappo !== null && alzata !== null && pen.gradiBattuta !== null;

    k('# ' + m.nome + ' — configurazione FluidNC');
    k('#');
    k('# GENERATO dal profilo macchina del GDC CNC 2D SLICER' +
      (m.aggiornato ? ' il ' + m.aggiornato : '') + '.');
    k('# Non modificarlo a mano: la prossima generazione sovrascrive le modifiche.');
    k('# I numeri si cambiano nella tab Impostazioni, che rigenera questo file.');
    k('#');
    k('# Regola del parser: nessun commento in coda a una chiave: valore.');
    k('#');
    k('# Verifica al primo avvio: un movimento su X deve muovere il carrello');
    k('# lungo la trave, non tutto il portale.');
    k('');
    k('name: ' + m.nome);
    k('board: ESP32 Dev Module');
    k('');
    k('stepping:');
    k('  engine: RMT');
    c('  ', 'Driver sempre abilitati: con origine manuale, un asse che si');
    c('  ', 'ammorbidisce fa perdere la posizione in silenzio.');
    k('  idle_ms: 255');
    k('  pulse_us: 4');
    k('  dir_delay_us: 1');
    k('  disable_delay_us: 0');
    k('');
    k('axes:');
    k('  shared_stepper_disable_pin: ' + PIN.enable);
    k('');
    asse('x', 'X', 'trave del portale: il carrello che porta la penna, sinistra→destra sul foglio');
    asse('y', 'Y', 'rotaie di base: ci scorre sopra tutto il portale, basso→alto sul foglio');

    /* L'arco comandabile va dal CONTATTO alla POSIZIONE TAPPO, non
       dall'alzata: mapConstrain tronca tutto quello che cade fuori dai due
       impulsi, quindi se il massimo fosse l'alzata il tappo sarebbe
       irraggiungibile. L'alzata di lavoro diventa una quota intermedia. */
    c('  ', 'Z non è un asse vero: è il servo del pen-lift.');
    c('  ', 'Senza homing lo zero macchina sta in CIMA e la corsa è negativa:');
    c('  ', 'Z0 = posizione tappo, Z scende in negativo fino al foglio.');
    c('  ', 'Le quote sono millimetri veri di punta di penna.');
    k('  z:');
    k('    steps_per_mm: 100.000');
    k('    max_rate_mm_per_min: 1000.000');
    k('    acceleration_mm_per_sec2: 100.000');
    if (tarata) {
      c('    ', 'Dal contatto alla posizione tappo: ' +
                n(pen.gradiTappo - pen.gradiPennaAbbassata, 0) + ' gradi di servo.');
      c('    ', 'Corsa dichiarata, quindi le quote vanno da Z' + n(-tappo) +
                ' a Z0.');
      c('    ', "L'alzata di lavoro è la quota intermedia Z" +
                n(zAlzata()) + '.');
      k('    max_travel_mm: ' + n(tappo));
    } else {
      c('    ', 'DA TARARE: i tre angoli del servo non sono stati rilevati.');
      k('    max_travel_mm: 10.000');
    }
    k('    soft_limits: false');
    k('');
    k('    motor0:');
    k('      rc_servo:');
    k('        output_pin: ' + PIN.servo);
    k('        pwm_hz: 50');
    /* Con il servo invertito min_pulse_us esce MAGGIORE di max_pulse_us, e non
       è un errore: è il modo in cui FluidNC inverte un servo. Dal sorgente di
       RcServo.cpp — «The rotation can be inverted by swapping the values» — e
       la mappatura è una interpolazione lineare senza controlli sull'ordine. */
    if (tarata) {
      c('        ', 'min_pulse_us va al FONDO della corsa, cioè Z' + n(-tappo) + ':');
      c('        ', 'penna sul foglio, ' + pen.gradiPennaAbbassata + ' gradi.' +
                    (pen.invertito ? ' Servo invertito: min > max, voluto.' : ''));
      k('        min_pulse_us: ' + Math.round(gradiToUs(pen.gradiPennaAbbassata)));
      c('        ', 'max_pulse_us va in CIMA, cioè Z0: posizione tappo, ' +
                    pen.gradiTappo + ' gradi.');
      k('        max_pulse_us: ' + Math.round(gradiToUs(pen.gradiTappo)));
      c('        ', 'Battuta dei cuscinetti a ' + pen.gradiBattuta + ' gradi (' +
                    Math.round(gradiToUs(pen.gradiBattuta)) + ' µs): sta fuori');
      c('        ', "dall'arco qui sopra, quindi FluidNC non può comandarla. È voluto.");
    } else {
      c('        ', 'DA TARARE: i tre angoli del servo non sono stati rilevati.');
      k('        min_pulse_us: 1000');
      k('        max_pulse_us: 2000');
    }
    k('');
    k('user_outputs:');
    c('  ', 'Verde, giallo, rosso: comandati con M62/M63 P0..P2.');
    k('  digital0_pin: ' + PIN.led[0]);
    k('  digital1_pin: ' + PIN.led[1]);
    k('  digital2_pin: ' + PIN.led[2]);
    k('');
    k('start:');
    c('  ', "Niente finecorsa: l'origine la dà G92 e non sopravvive a un riavvio.");
    k('  must_home: false');
    k('');
    k('macros:');
    if (tarata) {
      c('  ', "All'accensione la penna si porta in posizione tappo.");
      c('  ', 'FluidNC parte assumendo Z0, e Z0 È la posizione tappo: quello che la');
      c('  ', "macchina crede e quello che il servo fa coincidono, e l'istante fra");
      c('  ', 'accensione ed esecuzione di questa riga non muove niente.');
      c('  ', 'La riga resta perché rende la quota esplicita, non per correggere.');
      c('  ', 'Regola comunque valida: il tappo si toglie PRIMA di dare corrente.');
      k('  startup_line0: G90 G0 Z' + n(zTappo(), 0));
    } else {
      c('  ', 'DA COMPILARE quando i tre angoli ci sono: G90 G0 Z0, il tappo.');
      k('  startup_line0:');
    }
    k('  startup_line1:');
    k('');
    return L.join('\n');
  }

  return {
    load: load, get: get, macchina: macchina, stampa: stampa,
    save: save, reset: reset, defaults: defaults,

    elencoStampe: elencoStampe, salvaStampa: salvaStampa,
    caricaStampa: caricaStampa, eliminaStampa: eliminaStampa,

    passiPerMm: passiPerMm, passiAMm: passiAMm, mmAPassi: mmAPassi,
    corsaTotale: corsaTotale, corsaDaHome: corsaDaHome,
    corsaPercorribile: corsaPercorribile,
    passiPercorribili: passiPercorribili, areaUtile: areaUtile,
    taraAsse: taraAsse,

    mmPerGrado: mmPerGrado, gradiPerMm: gradiPerMm, gradiToUs: gradiToUs,
    alzataMm: alzataMm, tappoMm: tappoMm,
    zDaGradi: zDaGradi, zTappo: zTappo, zAlzata: zAlzata, zContatto: zContatto,
    puntoHome: puntoHome,

    verifica: verifica, stanoDentro: stanoDentro,
    toJson: toJson, fromJson: fromJson, toYaml: toYaml,
    MM_PER_GIRO_NOMINALE: MM_PER_GIRO_NOMINALE
  };
})();
