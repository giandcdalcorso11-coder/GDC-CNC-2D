/* Il profilo macchina.
 *
 * È l'unico posto in cui vivono i numeri della macchina, ed è il documento
 * sorgente: `config.yaml` di FluidNC si GENERA da qui (vedi toYaml), non si
 * scrive a mano. Così resta un solo posto in cui un numero si digita, e il file
 * sulla macchina è un prodotto, non una seconda copia che prima o poi diverge.
 *
 * Perché generare il file invece di cambiare le impostazioni a runtime: sulla
 * 4.1.0 il comando `$/axes/...=` non restituisce nulla e non ha effetto (nostro
 * collaudo del 2026-09-21), e la documentazione FluidNC dice comunque che le
 * modifiche `$` vivono in memoria volatile e che i pin richiedono un riavvio.
 * Quindi: genera, carica, `$Bye`.
 *
 * COSA NON STA QUI, e non è una dimenticanza:
 *
 *   - l'origine di lavoro (G92) e la quota di appoggio della penna. Sono misure
 *     del momento, dipendono da dove hai appoggiato il foglio e da quanto è
 *     spesso. Salvarle come default significa, dopo un riavvio, fidarsi di
 *     un'origine che non vale più. Stanno in State, e il popup di inizio stampa
 *     le mostra come "ultimo valore usato" senza applicarle.
 *   - la mappa dei pin. È cablaggio, non taratura: sta nel generatore qui sotto
 *     come costante. Un campo modificabile per i pin è solo un modo per
 *     rompersi la macchina da un menu.
 *   - host, modalità finta, preferenze dell'interfaccia. Sono del browser.
 */
var Profile = (function () {

  var KEY = 'gdc.cnc2d.profilo';
  var SCHEMA = 1;

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
  function defaults() {
    return {
      schema: SCHEMA,
      nome: 'GDC CNC 2D',
      aggiornato: null,

      trasmissione: {
        microstep: 16,
        passiGiroMotore: 200,
        /* mmPerGiro è la circonferenza primitiva REALE del pignone di
           quell'asse. Le due cremagliere sono stampate separatamente e si sono
           ritirate di quantità diverse: con un valore solo i quadrati escono
           rettangoli. `tarato` dice se il numero viene da una misura o è ancora
           il nominale. */
        x: { mmPerGiro: MM_PER_GIRO_NOMINALE, tarato: false, invertito: true },
        y: { mmPerGiro: MM_PER_GIRO_NOMINALE, tarato: false, invertito: false }
      },

      /* Misurate il 2026-10-19 col DRO della dashboard. Sono misure di estremo,
         prese per sapere dove NON andare: il margine è quello che tiene conto
         dell'errore di parcheggio dell'origine manuale, che a occhio vale
         qualche millimetro. Finché non c'è un riferimento fisico, generoso. */
      corse: {
        x: { corsa: 257.532, margine: 8.0 },
        y: { corsa: 243.041, margine: 8.0 }
      },

      dinamica: {
        /* velocitaMax è un TETTO, non una velocità di lavoro: quella la decide
           la F del G-code. L'accelerazione invece agisce su ogni movimento ed è
           quella che scuote il portale — resta bassa finché il modulo penna non
           è montato, perché è il suo sbalzo a decidere quanta imbardata genera
           uno strappo. */
        x: { velocitaMax: 8000, accelerazione: 200 },
        y: { velocitaMax: 8000, accelerazione: 200 },
        velocitaDisegno: 1200,
        velocitaSpostamento: 3000
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
           poter comandare una quota che lo raggiunga. */
        gradiBattuta: null,
        gradiAppoggio: null,
        gradiAlzata: null,

        /* Corrispondenza gradi→microsecondi della dashboard: 0÷180° su
           500÷2500 µs. Serve a tradurre i tre angoli negli estremi dell'impulso
           che FluidNC vuole. */
        impulsoMinUs: 500,
        impulsoMaxUs: 2500,

        /* Pausa in G-code dopo ogni su/giù: senza, a 50 mm/s si sbavano 4 mm
           di tratto mentre il servo sta ancora andando. */
        pausaMs: 200
      },

      /* Resta a zero, e non è una dimenticanza: l'origine la si imposta
         portando LA PUNTA della penna sul punto, quindi l'offset fra
         riferimento del carrello e punta è già assorbito. Servirebbe solo se i
         limiti fossero riferiti al carrello, e i limiti sono disattivati. */
      utensile: { offsetX: 0, offsetY: 0 },

      /* Con 257,5 × 243,0 di corsa l'A4 non entra in nessun orientamento
         (mancano 54 mm su Y in verticale, 39,5 su X in orizzontale). La
         macchina è una A5. */
      foglio: { formato: 'A5', larghezza: 148, altezza: 210 }
    };
  }

  var corrente = null;

  /* Fonde il salvato sui valori di partenza invece di usarlo così com'è: un
     profilo salvato con una versione vecchia non ha i campi aggiunti dopo, e
     senza questa fusione l'interfaccia leggerebbe `undefined` da un campo che
     crede di avere. Vale anche al contrario: un campo tolto dal modello
     semplicemente non viene ripreso. */
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

  function load() {
    var p = defaults();
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) p = fondi(p, JSON.parse(raw));
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

  function get() {
    return corrente || load();
  }

  function save() {
    var p = get();
    p.aggiornato = new Date().toISOString();
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

  /* ----------------------------- conti derivati ----------------------------
     Nessuno di questi valori viene salvato: si ricalcolano sempre dai dati
     grezzi. Un numero calcolato e salvato è un numero che un giorno non
     corrisponderà più a quello da cui era stato calcolato. */

  function passiPerMm(asse) {
    var t = get().trasmissione;
    return t.passiGiroMotore * t.microstep / t[asse].mmPerGiro;
  }

  /* Il limite di lavoro: la corsa meno il margine. Senza finecorsa non c'è
     nessuno che lo faccia rispettare a valle, quindi è l'interfaccia a dover
     verificare l'ingombro prima di far partire un programma. */
  function limite(asse) {
    var c = get().corse[asse];
    return Math.max(0, c.corsa - c.margine);
  }

  function areaUtile() {
    return { w: limite('x'), h: limite('y') };
  }

  function mmPerGrado() {
    return get().penna.raggioPignone * Math.PI / 180;
  }

  function gradiPerMm(mm) {
    return mm / mmPerGrado();
  }

  function gradiToUs(gradi) {
    var p = get().penna;
    return p.impulsoMinUs + gradi * (p.impulsoMaxUs - p.impulsoMinUs) / 180;
  }

  /* Alzata utile in millimetri fra appoggio e penna alzata. È anche il
     max_travel_mm dell'asse Z nel file di FluidNC: così Z è in millimetri veri
     di penna invece che in unità arbitrarie. */
  function alzataMm() {
    var p = get().penna;
    if (p.gradiAppoggio === null || p.gradiAlzata === null) return null;
    return (p.gradiAlzata - p.gradiAppoggio) * mmPerGrado();
  }

  /* ------------------------------- verifica --------------------------------
     Restituisce l'elenco di quello che manca o non torna. Serve in due posti:
     nella tab Impostazioni per dire cosa resta da misurare, e prima di far
     partire una stampa. Mai un booleano solo: se qualcosa blocca, chi lo legge
     deve poter dire ALL'UTENTE che cosa. */
  function verifica() {
    var p = get(), problemi = [];

    if (!p.trasmissione.x.tarato || !p.trasmissione.y.tarato) {
      problemi.push({
        gravita: 'avviso',
        campo: 'trasmissione',
        testo: 'Il rapporto di trasmissione è ancora quello nominale su almeno ' +
               'un asse. Il disegno uscirà in scala sbagliata della stessa ' +
               'percentuale di cui le cremagliere si sono ritirate.'
      });
    }

    ['x', 'y'].forEach(function (a) {
      if (!(p.corse[a].corsa > 0)) {
        problemi.push({
          gravita: 'blocco', campo: 'corse.' + a,
          testo: 'Corsa dell\'asse ' + a.toUpperCase() + ' non misurata.'
        });
      }
      if (p.corse[a].margine < 0) {
        problemi.push({
          gravita: 'blocco', campo: 'corse.' + a,
          testo: 'Margine di sicurezza negativo sull\'asse ' + a.toUpperCase() + '.'
        });
      }
    });

    var pen = p.penna;
    if (pen.gradiBattuta === null || pen.gradiAppoggio === null || pen.gradiAlzata === null) {
      problemi.push({
        gravita: 'blocco', campo: 'penna',
        testo: 'I tre angoli del servo non sono stati rilevati: si prendono ' +
               'con la dashboard, a modulo penna montato.'
      });
    } else if (!(pen.gradiBattuta < pen.gradiAppoggio && pen.gradiAppoggio < pen.gradiAlzata)) {
      problemi.push({
        gravita: 'blocco', campo: 'penna',
        testo: 'I tre angoli del servo devono crescere: battuta < appoggio < ' +
               'alzata. Così come sono, il software potrebbe comandare la ' +
               'battuta meccanica.'
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
    var fuori = [];
    if (o.x + ingombro.x0 < 0) fuori.push('a sinistra di ' + (-(o.x + ingombro.x0)).toFixed(1) + ' mm');
    if (o.y + ingombro.y0 < 0) fuori.push('sotto di ' + (-(o.y + ingombro.y0)).toFixed(1) + ' mm');
    if (o.x + ingombro.x1 > limite('x')) fuori.push('a destra di ' + (o.x + ingombro.x1 - limite('x')).toFixed(1) + ' mm');
    if (o.y + ingombro.y1 > limite('y')) fuori.push('sopra di ' + (o.y + ingombro.y1 - limite('y')).toFixed(1) + ' mm');
    return { ok: fuori.length === 0, fuori: fuori };
  }

  /* ------------------------- esportazione e importazione -------------------
     Il profilo vive in localStorage, che è per-browser e sparisce se si
     cancellano i dati del sito. L'esportazione in JSON è la copia che
     sopravvive, e che si può committare nel repo accanto al resto. */

  function toJson() {
    return JSON.stringify(get(), null, 2);
  }

  function fromJson(testo) {
    var letto = JSON.parse(testo);
    corrente = fondi(defaults(), letto);
    corrente.schema = SCHEMA;
    save();
    return corrente;
  }

  /* ------------------------------ il config.yaml ---------------------------
     Generato, non scritto a mano. Si carica sulla macchina e si riavvia con
     `$Bye`.

     Due cose restano false finché non ci sono i finecorsa, e non per scelta:
     `soft_limits` vuole una macchina azzerata e l'azzeramento vuole i
     finecorsa. Finché è così, l'unica protezione contro un movimento fuori
     area è stanoDentro() qui sopra. */
  function toYaml() {
    var p = get();
    var n = function (v, d) { return Number(v).toFixed(d === undefined ? 3 : d); };

    /* FluidNC inverte il livello di un pin con il modificatore `:low`. Da
       confermare al primo avvio guardando il verso: se un asse va al
       contrario, è questo. */
    var dirPin = function (a) {
      return PIN[a].dir + (p.trasmissione[a].invertito ? ':low' : '');
    };

    var asse = function (a, nome, descrizione) {
      return [
        '  # ' + nome + ' — ' + descrizione,
        '  ' + a + ':',
        '    steps_per_mm: ' + n(passiPerMm(a)) +
          '   # ' + n(p.trasmissione[a].mmPerGiro, 4) + ' mm/giro' +
          (p.trasmissione[a].tarato ? ' (tarato)' : ' (NOMINALE, da tarare)'),
        '    max_rate_mm_per_min: ' + n(p.dinamica[a].velocitaMax),
        '    acceleration_mm_per_sec2: ' + n(p.dinamica[a].accelerazione),
        '    max_travel_mm: ' + n(p.corse[a].corsa) +
          '   # limite di lavoro ' + n(limite(a)) + ' (margine ' + n(p.corse[a].margine, 1) + ')',
        '    soft_limits: false',
        '',
        '    motor0:',
        '      hard_limits: false   # finecorsa non montati',
        '      stepstick:',
        '        step_pin: ' + PIN[a].step,
        '        direction_pin: ' + dirPin(a),
        ''
      ].join('\n');
    };

    var alzata = alzataMm();
    var zBlocco = [
      '  # Z non è un asse vero: è il servo del pen-lift.',
      '  z:',
      '    steps_per_mm: 100.000',
      '    max_rate_mm_per_min: 1000.000',
      '    acceleration_mm_per_sec2: 100.000',
      '    max_travel_mm: ' + (alzata === null ? '10.000   # DA TARARE' : n(alzata) + '   # alzata vera, ' +
        n(p.penna.gradiAlzata - p.penna.gradiAppoggio, 2) + ' gradi di servo'),
      '    soft_limits: false',
      '',
      '    motor0:',
      '      rc_servo:',
      '        output_pin: ' + PIN.servo,
      '        pwm_hz: 50',
      (p.penna.gradiAppoggio === null
        ? '        min_pulse_us: 1000   # DA TARARE: i tre angoli non sono stati rilevati'
        : '        min_pulse_us: ' + Math.round(gradiToUs(p.penna.gradiAppoggio)) +
          '   # appoggio, ' + p.penna.gradiAppoggio + ' gradi'),
      (p.penna.gradiAlzata === null
        ? '        max_pulse_us: 2000   # DA TARARE'
        : '        max_pulse_us: ' + Math.round(gradiToUs(p.penna.gradiAlzata)) +
          '   # alzata, ' + p.penna.gradiAlzata + ' gradi'),
      ''
    ].join('\n');

    return [
      '# ' + p.nome + ' — configurazione FluidNC',
      '#',
      '# GENERATO dal profilo macchina del GDC CNC 2D SLICER' +
        (p.aggiornato ? ' il ' + p.aggiornato : '') + '.',
      '# Non modificarlo a mano: la prossima generazione sovrascrive le modifiche.',
      '# I numeri si cambiano nella tab Impostazioni, che rigenera questo file.',
      '#',
      '# Verifica al primo avvio: un movimento su X deve muovere il carrello',
      '# lungo la trave, non tutto il portale.',
      '',
      'name: ' + p.nome,
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
    load: load, get: get, save: save, reset: reset,
    defaults: defaults,
    passiPerMm: passiPerMm, limite: limite, areaUtile: areaUtile,
    mmPerGrado: mmPerGrado, gradiPerMm: gradiPerMm, gradiToUs: gradiToUs,
    alzataMm: alzataMm,
    verifica: verifica, stanoDentro: stanoDentro,
    toJson: toJson, fromJson: fromJson, toYaml: toYaml,
    MM_PER_GIRO_NOMINALE: MM_PER_GIRO_NOMINALE
  };
})();
