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
        x: { mmPerGiro: MM_PER_GIRO_NOMINALE, tarato: false, invertito: true },
        y: { mmPerGiro: MM_PER_GIRO_NOMINALE, tarato: false, invertito: false }
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
        x: { corsaPassi: 8744, margineSicurezza: 8.0, misurato: '2026-10-19' },
        y: { corsaPassi: 8252, margineSicurezza: 8.0, misurato: '2026-10-19' }
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
        x: { scostamento: null, ripetibilita: null },
        y: { scostamento: null, ripetibilita: null }
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

        /* I tre angoli da rilevare a penna montata, con la dashboard (ha lo
           slider e parte in stato `free`). gradiBattuta è un LIMITE: i
           cuscinetti in fondo ai blocchi inferiori. Il software non deve mai
           poter comandare una quota che lo raggiunga.
           gradiPennaAbbassata è il contatto NOMINALE, quello a cui la penna si
           stringe nel modulo. Il contatto di oggi su questo foglio è un'altra
           cosa e sta in State: vedi il glossario. */
        gradiBattuta: null,
        gradiPennaAbbassata: null,
        gradiPennaAlzata: null,

        /* Corrispondenza gradi→microsecondi della dashboard: 0÷180° su
           500÷2500 µs. Serve a tradurre i tre angoli negli estremi dell'impulso
           che FluidNC vuole. */
        impulsoMinUs: 500,
        impulsoMaxUs: 2500
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

  /* Con 249,5 × 235,0 di corsa percorribile l'A4 non entra in nessun
     orientamento (mancano 54 mm su Y in verticale, 39,5 su X in orizzontale).
     La macchina è una A5. */
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

  /* Corsa percorribile: totale meno il margine di sicurezza. È il confine che
     il software fa rispettare, e vale l'identità del glossario
     (percorribile + margine = totale). Senza finecorsa non c'è nessuno che lo
     faccia rispettare a valle, quindi è l'interfaccia a dover verificare
     l'ingombro prima di far partire un programma. */
  function corsaPercorribile(asse) {
    return Math.max(0, corsaTotale(asse) - macchina().corse[asse].margineSicurezza);
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

  function gradiToUs(gradi) {
    var p = macchina().penna;
    return p.impulsoMinUs + gradi * (p.impulsoMaxUs - p.impulsoMinUs) / 180;
  }

  /* Alzata utile in millimetri fra penna abbassata e penna alzata. È anche il
     max_travel_mm dell'asse Z nel file di FluidNC: così Z è in millimetri veri
     di penna invece che in unità arbitrarie. */
  function alzataMm() {
    var p = macchina().penna;
    if (p.gradiPennaAbbassata === null || p.gradiPennaAlzata === null) return null;
    return (p.gradiPennaAlzata - p.gradiPennaAbbassata) * mmPerGrado();
  }

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
      if (c.corsaPassi > 0 && corsaPercorribile(a) <= 0) {
        problemi.push({
          gravita: 'blocco', campo: 'corse.' + a,
          testo: 'Sull\'asse ' + A + ' il margine di sicurezza si mangia tutta ' +
                 'la corsa: non resta niente da percorrere.'
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
    } else if (!(pen.gradiBattuta < pen.gradiPennaAbbassata &&
                 pen.gradiPennaAbbassata < pen.gradiPennaAlzata)) {
      problemi.push({
        gravita: 'blocco', campo: 'penna',
        testo: 'I tre angoli del servo devono crescere: battuta < penna ' +
               'abbassata < penna alzata. Così come sono, il software potrebbe ' +
               'comandare la battuta meccanica.'
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
  function toYaml() {
    var m = macchina();
    var n = function (v, d) { return Number(v).toFixed(d === undefined ? 3 : d); };

    /* FluidNC inverte il livello di un pin con il modificatore `:low`. Da
       confermare al primo avvio guardando il verso: se un asse va al
       contrario, è questo. */
    var dirPin = function (a) {
      return PIN[a].dir + (m.trasmissione[a].invertito ? ':low' : '');
    };

    var asse = function (a, nome, descrizione) {
      var t = m.trasmissione[a];
      return [
        '  # ' + nome + ' — ' + descrizione,
        '  ' + a + ':',
        '    steps_per_mm: ' + n(passiPerMm(a)) +
          '   # ' + n(t.mmPerGiro, 4) + ' mm per giro ingranaggio' +
          (t.tarato ? ' (tarato)' : ' (NOMINALE, da tarare)'),
        '    max_rate_mm_per_min: ' + n(m.dinamica[a].velocitaMax),
        '    acceleration_mm_per_sec2: ' + n(m.dinamica[a].accelerazione),
        '    max_travel_mm: ' + n(corsaTotale(a)) +
          '   # corsa totale, ' + m.corse[a].corsaPassi + ' passi misurati' +
          ' — percorribile ' + n(corsaPercorribile(a)) +
          ' (margine ' + n(m.corse[a].margineSicurezza, 1) + ')',
        '    soft_limits: false',
        '',
        '    motor0:',
        '      hard_limits: false   # finecorsa non montati: homing a mano sui',
        '                           # blocchi stampati agganciati alle staffe',
        '      stepstick:',
        '        step_pin: ' + PIN[a].step,
        '        direction_pin: ' + dirPin(a),
        ''
      ].join('\n');
    };

    var alzata = alzataMm();
    var pen = m.penna;
    var zBlocco = [
      '  # Z non è un asse vero: è il servo del pen-lift.',
      '  z:',
      '    steps_per_mm: 100.000',
      '    max_rate_mm_per_min: 1000.000',
      '    acceleration_mm_per_sec2: 100.000',
      '    max_travel_mm: ' + (alzata === null ? '10.000   # DA TARARE' : n(alzata) + '   # alzata utile, ' +
        n(pen.gradiPennaAlzata - pen.gradiPennaAbbassata, 2) + ' gradi di servo'),
      '    soft_limits: false',
      '',
      '    motor0:',
      '      rc_servo:',
      '        output_pin: ' + PIN.servo,
      '        pwm_hz: 50',
      (pen.gradiPennaAbbassata === null
        ? '        min_pulse_us: 1000   # DA TARARE: i tre angoli non sono stati rilevati'
        : '        min_pulse_us: ' + Math.round(gradiToUs(pen.gradiPennaAbbassata)) +
          '   # penna abbassata, ' + pen.gradiPennaAbbassata + ' gradi'),
      (pen.gradiPennaAlzata === null
        ? '        max_pulse_us: 2000   # DA TARARE'
        : '        max_pulse_us: ' + Math.round(gradiToUs(pen.gradiPennaAlzata)) +
          '   # penna alzata, ' + pen.gradiPennaAlzata + ' gradi'),
      (pen.gradiBattuta === null ? '' :
        '        # battuta dei cuscinetti a ' + pen.gradiBattuta + ' gradi (' +
        Math.round(gradiToUs(pen.gradiBattuta)) + ' µs): MAI comandarla'),
      ''
    ].filter(function (r) { return r !== ''; }).join('\n') + '\n';

    return [
      '# ' + m.nome + ' — configurazione FluidNC',
      '#',
      '# GENERATO dal profilo macchina del GDC CNC 2D SLICER' +
        (m.aggiornato ? ' il ' + m.aggiornato : '') + '.',
      '# Non modificarlo a mano: la prossima generazione sovrascrive le modifiche.',
      '# I numeri si cambiano nella tab Impostazioni, che rigenera questo file.',
      '#',
      '# Verifica al primo avvio: un movimento su X deve muovere il carrello',
      '# lungo la trave, non tutto il portale.',
      '',
      'name: ' + m.nome,
      'board: ESP32 Dev Module',
      '',
      'stepping:',
      '  engine: RMT',
      '  idle_ms: 255   # driver sempre abilitati: con origine manuale, un asse',
      '                 # che si ammorbidisce fa perdere la posizione in silenzio',
      '  pulse_us: 4',
      '  dir_delay_us: 1',
      '  disable_delay_us: 0',
      '',
      'axes:',
      '  shared_stepper_disable_pin: ' + PIN.enable,
      '',
      asse('x', 'X', 'trave del portale: il carrello che porta la penna, sinistra→destra sul foglio'),
      asse('y', 'Y', 'rotaie di base: ci scorre sopra tutto il portale, basso→alto sul foglio'),
      zBlocco,
      'user_outputs:',
      '  digital0_pin: ' + PIN.led[0] + '   # verde',
      '  digital1_pin: ' + PIN.led[1] + '   # giallo',
      '  digital2_pin: ' + PIN.led[2] + '   # rosso',
      '',
      'start:',
      '  must_home: false   # niente finecorsa: l\'origine la dà G92 e non',
      '                     # sopravvive a un riavvio',
      ''
    ].join('\n');
  }

  return {
    load: load, get: get, macchina: macchina, stampa: stampa,
    save: save, reset: reset, defaults: defaults,

    elencoStampe: elencoStampe, salvaStampa: salvaStampa,
    caricaStampa: caricaStampa, eliminaStampa: eliminaStampa,

    passiPerMm: passiPerMm, passiAMm: passiAMm, mmAPassi: mmAPassi,
    corsaTotale: corsaTotale, corsaPercorribile: corsaPercorribile,
    passiPercorribili: passiPercorribili, areaUtile: areaUtile,
    taraAsse: taraAsse,

    mmPerGrado: mmPerGrado, gradiPerMm: gradiPerMm, gradiToUs: gradiToUs,
    alzataMm: alzataMm,

    verifica: verifica, stanoDentro: stanoDentro,
    toJson: toJson, fromJson: fromJson, toYaml: toYaml,
    MM_PER_GIRO_NOMINALE: MM_PER_GIRO_NOMINALE
  };
})();
