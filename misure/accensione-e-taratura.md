# Accensione e taratura — GDC CNC 2D

Due procedure distinte, e conviene non confonderle:

- **Fase A — la messa in strada.** Si fa **una volta**, e produce il *profilo
  macchina*: i numeri che non cambiano più (passi/mm per asse, corse, estremi
  del servo). Finché non è fatta, la macchina non ha un profilo e il SLICER non
  sa niente di lei.
- **Fase B — ogni stampa.** La routine di tutti i giorni, che dà per fatto il
  profilo e aggiunge le due sole misure *del momento*: dove è appoggiato il
  foglio e quanto è spesso.

---

## Stato: cosa di questo documento esiste già

Importante, perché questa è una procedura **di arrivo**, non di oggi:

| Pezzo | Stato |
|---|---|
| Dashboard (pannello di controllo manuale) | funzionante, usata per tutte le prove di movimento |
| Modulo penna | in attesa dei cuscinetti |
| FluidNC sul firmware | **mai acceso sulla macchina montata** |
| `cnc2d-config.yaml` | pin e rapporto corretti; corse e servo da tarare |
| SLICER caricato sulla macchina | **no**, gira solo in modalità finta nel browser |
| Pannello manuale dentro il SLICER | impalcatura presente, tutta disabilitata |
| Profilo macchina salvabile | **da costruire** |
| Popup di inizio stampa | **da costruire** |
| Invio del programma alla macchina | **da costruire** |

Fase A si può cominciare appena arrivano i cuscinetti. Fase B diventa vera
quando i tre "da costruire" sono fatti.

---

# Fase A — La messa in strada

## A1. I tre angoli del servo — si fa con la DASHBOARD, non con il SLICER

Questo passo viene **prima** di flashare FluidNC, per un motivo pratico: la
dashboard ha già lo slider manuale del servo, parte in stato `free` (nessun
impulso, squadretta morbida) e ha la rampa che avvicina l'angolo di pochi gradi
per volta. FluidNC non ha niente di tutto questo. È lo strumento giusto, e usa
lo stesso pin — `gpio.32` — che FluidNC dichiarerà come `rc_servo`, quindi i
numeri che trovi qui valgono tali e quali.

**Cosa fai:**

1. Monta il modulo penna **senza la penna nei morsetti**.
2. Accendi. La dashboard parte con il servo in `free`: la squadretta è morbida e
   non tiene nessuna posizione. È voluto — un servo che appena riceve corrente
   va in battuta contro un vincolo meccanico assorbe moltissimo.
3. Con lo slider, porta il servo a un angolo intermedio e **guarda dove si
   trova `pz2`**. Da qui in giù si lavora a passi di 1÷2 gradi.
4. **Angolo di BATTUTA.** Scendi di 1÷2 gradi per volta finché i cuscinetti
   inferiori arrivano in fondo ai blocchi. Te ne accorgi perché `pz2` smette di
   scendere e il servo comincia a ronzare. **Fermati al primo grado in cui non
   scende più, e torna subito su di uno.** Non lasciarlo in battuta: è lì che si
   spianano gli ingranaggi dell'SG90. Segna il numero.
5. **Angolo di APPOGGIO.** Dalla battuta, sali di qualche grado. Questa è la
   posizione in cui **infili la penna nei morsetti e la stringi**, con la punta
   che sfiora il piano. Segna il numero.
6. **Angolo di PENNA ALZATA.** Dall'appoggio, sali di 2÷3 mm di penna. In gradi:

   | Alzata | Gradi di servo |
   |---|---|
   | 2 mm | 6,11° |
   | 3 mm | 9,17° |

   (0,32725 mm di penna per grado, dal pignone z25 raggio primitivo 18,750.)
   Segna il numero.

**Quello che devi ottenere:** tre numeri in gradi, nell'ordine
battuta < appoggio < alzata. La corsa meccanica totale della guida è 26,350 mm
= 80,5° sui ~180 del servo, quindi ci sta larghissima: se i tre numeri non
stanno dentro 180°, c'è qualcosa che non torna nel montaggio.

## A2. Tradurre i tre angoli in microsecondi per FluidNC

La dashboard mappa 0÷180° su 500÷2500 µs, quindi:

```
µs = 500 + gradi × 11,1111
```

Nel YAML va:

```yaml
    max_travel_mm: <alzata reale in mm, es. 3.000>
      rc_servo:
        min_pulse_us: <µs dell'angolo di APPOGGIO>
        max_pulse_us: <µs dell'angolo di ALZATA>
```

Così `Z0` = penna appoggiata e `Z3` = penna alzata, e **Z è in millimetri veri
di alzata** invece che in unità arbitrarie.

L'angolo di **battuta** non va nel YAML: va nel profilo del SLICER come limite,
e serve a una cosa sola — il software non deve mai poter comandare una Z che lo
raggiunga.

## A3. Flashare FluidNC — e qui si perde la dashboard

**Da sapere prima di premere:** FluidNC è un firmware intero. Flasharlo
**cancella** lo sketch della dashboard. Si torna indietro riflashando lo sketch,
ma non convivono. Quindi A1 va chiuso prima.

**Cosa fai:**

1. **Togli la penna dai morsetti.** Al primo avvio FluidNC porta l'asse Z alla
   sua posizione zero, che con la mappatura di A2 è *penna appoggiata*: senza
   penna montata il rischio è nullo, con la penna montata la punta va a
   premere sul piano. Questa è anche la cosa da **osservare** al primo avvio: se
   il servo scatta in modo brusco, si invertono `min_pulse_us` e `max_pulse_us`
   così `Z0` diventa la posizione alzata e l'avvio è sempre nella direzione
   innocua.
2. Flash dal web installer, carica `cnc2d-config.yaml`, attivalo con
   `$Config/Filename=cnc2d-config.yaml` e riavvia con `$Bye`. (Il pulsante
   "seleziona configurazione" del browser dei file non ha avuto effetto la volta
   scorsa: il comando da terminale sì.)
3. Verifica dalla console che non ci siano errori di validazione.
4. **Prova le quattro frecce e il servo** dalla WebUI di FluidNC, prima di
   mettere in mezzo il SLICER. Se qualcosa non va, è nel YAML.

## A4. Caricare il SLICER sulla macchina

Il SLICER deve essere **servito dall'ESP32**: FluidNC espone il suo HTTP senza
intestazioni CORS, quindi una pagina aperta da file locale non può interrogarlo.
Finché non è caricato, il SLICER funziona solo in modalità finta.

## A5. Le misure di taratura — col pannello manuale del SLICER

Da qui in poi il pannello manuale ha il DRO, cioè legge le coordinate: le misure
diventano banali.

**Corsa utile per asse** (`max_travel_mm`), una per X e una per Y:

1. Porta l'asse a un estremo, a passo piccolo, fino a che non va più.
2. **"Imposta origine qui"**.
3. Porta l'asse all'altro estremo, sempre a passo piccolo.
4. Leggi il DRO e **"registra questa misura"** nel campo *corsa X* (o *corsa Y*)
   del profilo.
5. Nel profilo metti un **margine di sicurezza** esplicito: il limite di lavoro
   è `corsa − margine`, calcolato e mostrato, mai inserito a mano.

**Passi/mm reale per asse**, perché le due cremagliere sono stampate separate e
si sono ritirate di quantità diverse:

1. Comanda un movimento lungo e tondo, `G91 G0 X200`.
2. Misura col calibro quanto si è spostato davvero.
3. `passi/mm nuovo = 33,953 × (comandato / misurato)`.
4. Registralo nel campo *passi/mm X*. Ripeti per Y. **I due numeri non saranno
   uguali, ed è corretto che non lo siano.**

**L'offset utensile resta a zero, e non è una dimenticanza:** l'origine la
imposti portando **la punta della penna** sul punto, quindi l'offset fra
riferimento del carrello e punta è già assorbito. Servirebbe solo se i limiti
fossero riferiti al carrello, e i limiti sono disattivati.

## A6. Salvare il profilo

Premi **"salva profilo"**. L'app genera `config.yaml` dai valori del profilo, lo
carica sulla macchina e fa `$Bye`. Da questo momento il profilo è il default e
Fase A non si rifà più — si ritocca solo se cambia qualcosa di meccanico.

---

# Fase B — Ogni stampa

## Cosa succede quando accendi la macchina

1. **Dai corrente.** FluidNC parte, carica il profilo, i driver restano
   abilitati (`idle_ms: 255`) — quindi gli assi sono **duri**, non si spostano a
   mano. È voluto: con l'origine manuale, un asse che si ammorbidisce e viene
   spostato farebbe perdere la posizione senza che nessuno se ne accorga.
2. **Il servo va alla sua posizione zero**, cioè penna appoggiata. Se c'è la
   penna montata, la punta scende sul piano.
3. **Apri il SLICER** nel browser, all'indirizzo della macchina.
4. L'app si connette e mostra **`NON AZZERATA`**, e questo è il punto da capire
   bene: FluidNC dirà di essere in `Idle`, come se fosse tutto a posto, ma le
   sue coordinate sono quelle di dove si trovava per caso all'accensione.
   `G92` non sopravvive allo spegnimento, e un passo-passo senza encoder non
   può sapere se qualcuno ha mosso il carrello mentre era spento.
   **In stato `NON AZZERATA` l'app permette solo jog relativi a passo limitato,
   e rifiuta di eseguire un programma.**
5. **L'app alza la penna** come primo comando dopo la connessione.

## La routine

| # | Cosa fai | Cosa fa l'app |
|---|---|---|
| 1 | Metti il foglio sul piano | — |
| 2 | Carichi l'SVG, scegli formato e posizione del foglio | mostra l'anteprima sul piano |
| 3 | **Slice** | genera il percorso e il G-code |
| 4 | **Controlli** | tempo stimato, numero di tratti, spostamenti a vuoto, alzate di penna, e **se l'ingombro sta dentro il limite di lavoro** — che senza finecorsa è l'unica protezione che hai |
| 5 | **Stampa** | si accorge che lo stato è `NON AZZERATA` e apre il primo popup |
| 6 | **Popup 1 — origine.** Col pannello porti la punta della penna sull'angolo del foglio da cui vuoi partire | la penna è **già alzata** (l'app la alza prima di abilitare il jog, altrimenti trascini la punta sul foglio per tutto il posizionamento). Il popup ti mostra *"l'ultima volta era a X… Y…"* come suggerimento, senza applicarlo |
| 7 | **"Homing completato"** | manda `G92 X0 Y0`, lo stato passa a `AZZERATA`, apre il secondo popup |
| 8 | **Popup 2 — altezza penna.** Col pannello abbassi la Z a piccoli passi finché la punta **tocca il foglio e lascia il segno** | registra quella Z come *quota di appoggio per questa stampa* |
| 9 | **"Altezza penna completato"** | **alza subito la penna** (quel popup finisce per definizione con la punta che tocca), poi invia il programma |
| 10 | Guardi | il programma comincia con **alza → vai al primo punto → abbassa**, altrimenti la prima cosa che disegna è una riga dall'origine all'inizio del disegno. Poi l'anteprima diventa indicatore di avanzamento |

## Perché i due popup non si possono togliere

Sono la differenza fra questa macchina e una stampante con i finecorsa:

- **Il popup dell'origine** esiste perché la macchina all'accensione non sa dove
  si trova. Il giorno che monti i microswitch, questo popup diventa un ciclo di
  azzeramento automatico e sparisce — è già tutto previsto nel YAML, va solo
  riattivato.
- **Il popup dell'altezza penna** resta anche con i finecorsa, perché la carta
  cambia spessore e il piano non è perfettamente piano. E con il modulo penna
  in presa rigida l'unica cedevolezza della catena sono i **0,30 mm di gioco**
  della coppia cremagliera/pignone: dentro quei 0,30 mm la penna appoggia col
  proprio peso invece che con la quota imposta, e la taratura di questo popup
  deve cadere **dentro** quella banda.

## L'origine è un'origine di lavoro, non un riferimento macchina

Vale la pena ripeterlo perché è la trappola più costosa del progetto: il punto
che imposti al passo 6 dice **dove cade il disegno sul foglio**, e per quello
qualche millimetro di imprecisione va benissimo, dato che la posizione del
foglio è comunque arbitraria.

Quello che **non** si fa è agganciare i limiti a quel punto. Se li agganci, un
errore di parcheggio di 5 mm diventa un errore di limite di 5 mm: credi di
avere 25 mm di margine e ne hai 12. Le corse si misurano una volta in Fase A e
vivono nel profilo; l'origine di ogni stampa non le tocca.

## Cosa fare se qualcosa va storto

| Sintomo | Cosa è | Cosa fai |
|---|---|---|
| L'app torna `NON AZZERATA` a metà sessione | FluidNC si è resettato: `G92` è perso | rifai il popup dell'origine, non fidarti delle coordinate |
| Il tratto è più marcato in un punto del foglio | il piano non è piano, e la presa rigida non ha cedevolezza per assorbirlo | misura di quanto è fuori piano: se è più di 0,30 mm serve un giunto a gioco morto vero, non una ritaratura |
| Il tratto manca a tratti | appoggio tarato troppo alto, o dentro il gioco dalla parte sbagliata | rifai il popup 2 scendendo di un passo in più |
| Allarme e stop senza causa | **non** dovrebbe più succedere: i due `limit_neg_pin` sono stati commentati proprio perché un pin di finecorsa dichiarato e non cablato può leggere un disturbo come pulsante premuto | se succede, controlla che nel YAML siano ancora commentati |
