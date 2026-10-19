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
| Dashboard (pannello di controllo manuale) | funzionante, e dal 2026-10-19 **misura anche posizione e rapporto per asse** |
| Modulo penna | in attesa dei cuscinetti |
| FluidNC sul firmware | **mai acceso sulla macchina montata** |
| `cnc2d-config.yaml` | pin e rapporto corretti; corse e servo da tarare |
| SLICER caricato sulla macchina | **no**, gira solo in modalità finta nel browser |
| Pannello manuale dentro il SLICER | impalcatura presente, tutta disabilitata |
| Profilo macchina e profilo di stampa | **fatti** (2026-10-19): tab Impostazioni, salvataggio nel browser, esportazione JSON |
| Generazione di `config.yaml` dal profilo | **fatta**: un pulsante nella tab Impostazioni |
| Blocchi di homing stampati | **da stampare**: si agganciano alle staffe TT e LL |
| Popup di inizio stampa | **da costruire** |
| Invio del programma alla macchina | **da costruire** |

**Il passo A1 si può fare oggi**, senza modulo penna: i pignoni sulle due
cremagliere sono definitivi, quindi corsa e rapporto non cambiano più. Il resto
di Fase A aspetta i cuscinetti. Fase B diventa vera quando i tre "da costruire"
sono fatti.

---

# Fase A — La messa in strada

## A1. Le corse dei due assi — con la DASHBOARD, e si può fare oggi

I pignoni sulle cremagliere sono quelli definitivi, quindi questi due numeri per
asse non cambieranno più: si possono prendere senza aspettare il modulo penna.
E conviene prenderli adesso, perché così FluidNC parte già con i numeri giusti
invece di partire con dei valori inventati e correggerli dopo.

### La corsa utile, un asse per volta

1. Porta l'asse a un estremo. **Sul finale passa al passo singolo**, che a 1/16
   vale 0,029 mm: non si vede muovere niente, ed è esattamente il punto —
   arrivare in fondo senza prendere una botta.
2. Nel riquadro *Posizione* della tab Controllo: **Azzera X** (o Y).
3. Porta l'asse all'altro estremo, di nuovo a passo piccolo sul finale.
4. Leggi il numero. **Quella è la corsa utile di quell'asse.**

Annotala. Nel profilo ci andrà **meno un margine di sicurezza**, perché senza
finecorsa il limite non lo fa rispettare nessuno a valle dell'interfaccia.

### Il rapporto reale NON si misura qui — si misura disegnando

Vale la pena capire perché, perché è controintuitivo: **il DRO non può, per
costruzione, rivelare l'errore di scala.**

```
corsa letta = passi / 33,953        e        passi = denti percorsi × 20
corsa vera  = denti percorsi × passo vero
→ corsa letta = denti percorsi × 4,71239, sempre
```

Il ritiro di stampa si cancella: la macchina conta denti, e li converte col
passo nominale. Qualunque cosa misuri *dentro* la macchina ti restituisce il
nominale. **Serve per forza un confronto con un metro esterno.**

E il modo buono di fare quel confronto è **misurare una linea disegnata**, non
un carrello che si sposta: una linea sta ferma, è piana, sta su un tavolo, e il
calibro ci appoggia le ganasce come vuole lui. Inseguire un carrello col calibro
contro un riferimento improvvisato dà due o tre decimi di incertezza, che è
proprio l'ordine di grandezza che si vuole misurare.

Quindi **il rapporto si tara al passo A6**, con il modulo penna montato. I
risultati di qui sono solo le corse.

### I due numeri da portare via da questo passo

| | X — carrello sulla trave | Y — portale sulle rotaie |
|---|---|---|
| corsa totale, in passi | **8744** | **8252** |
| corsa totale, in mm col rapporto nominale | 257,532 | 243,041 |

*Misurate il 2026-10-19. I **passi** sono la misura; i millimetri sono
un'interpretazione fatta col rapporto nominale, e cambieranno quando il
rapporto sarà tarato pur non avendo toccato la macchina. Per questo nel profilo
sta la corsa in passi: vedi `misure/impostazioni-glossario.md`. Sono comunque
misure di estremo, prese per sapere dove NON andare — l'uso previsto sta ben
dentro, con margini abbondanti.*

### Un terzo numero, quando ci saranno i blocchi di homing

I blocchi stampati che si agganciano alle staffe TT e LL danno un riferimento
fisico: ci si appoggia il carrello e si azzera. Quando ci sono, con la stessa
dashboard si prende la **ripetibilità**: appoggia e azzera cinque o sei volte,
e guarda di quanto ballano i passi. Quella dispersione è il margine di
sicurezza minimo — oggi il margine sta a 8 mm per pura prudenza, e questo è
l'unico modo di sostituirlo con un numero vero.

## A2. I tre angoli del servo — si fa con la DASHBOARD, non con il SLICER

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

## A3. Tradurre i tre angoli in microsecondi per FluidNC

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

## A4. Flashare FluidNC — e qui si perde la dashboard

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

## A5. Caricare il SLICER sulla macchina

Il SLICER deve essere **servito dall'ESP32**: FluidNC espone il suo HTTP senza
intestazioni CORS, quindi una pagina aperta da file locale non può interrogarlo.
Finché non è caricato, il SLICER funziona solo in modalità finta.

## A6. Tarare il rapporto, disegnando

Adesso c'è la penna, quindi si può fare la misura buona: **si disegna una figura
di dimensione nota e si misura il tratto sul foglio.**

### La figura

Due coppie di linee parallele, una coppia per asse, con **interasse comandato
100 mm** — che sta comodo in un calibro da 150. Più un quadrato per la
squadratura.

### La misura, che cancella la larghezza del tratto

Il pennarello lascia una riga larga mezzo millimetro, quindi "dove finisce la
linea" è ambiguo. Si toglie di mezzo l'ambiguità misurando due volte:

1. **Esterno-esterno** delle due linee parallele → `E`
2. **Interno-interno** delle stesse due linee → `I`
3. **Interasse vero = (E + I) / 2.** La larghezza del tratto si elide
   esattamente, perché una lettura la somma e l'altra la sottrae.

Con lettura a ±0,05 mm su 100 mm comandati, l'incertezza è lo **0,05%**: su una
corsa da 250 mm vale 0,12 mm. Più che sufficiente.

### Il conto

```
mm/giro nuovo = mm/giro vecchio × misurato / comandato
```

Si inserisce nel profilo (o, finché si usa la dashboard, nel riquadro *Rapporto
tarato* della tab Motore, che fa il conto da solo). **Un numero per asse:** le
due cremagliere sono stampate separatamente e si sono ritirate di quantità
diverse, e con un valore solo i quadrati escono rettangoli.

### Un'alternativa statica, se serve un numero prima della penna

`mm per giro = 20 × passo della cremagliera`, **esattamente**: ogni ingranamento
avanza di un passo di cremagliera, e il ritiro del pignone non c'entra. Quindi
si può misurare il passo direttamente sulla stecca, da fermo, col metodo delle
due spine descritto in `misure/primo-asse.md` — due spine identiche in due vani
distanti 20 o 30 passi, misura sugli esterni, il diametro della spina si elide
nella sottrazione. Su 30 passi (141 mm) l'incertezza sul passo è lo 0,035%.

Limite da conoscere: la cremagliera Y è in **due pezzi giuntati**, quindi una
misura dentro un pezzo dà il passo locale. Per i passi/mm è il numero giusto —
la giunzione aggiunge uno scalino di posizione, non un errore di scala — ma non
descrive la corsa intera.

## A7. Riportare le misure nel profilo del SLICER

Le corse di A1 e i rapporti di A6 si trascrivono nel profilo. Più il **margine
di sicurezza**, che è un campo a sé: il limite di lavoro è `corsa − margine`,
calcolato e mostrato, mai inserito a mano.

**Formato di lavoro: A5.** Con 257,5 × 243,0 di corsa l'A4 non entra in nessun
orientamento (mancano 54 mm su Y in verticale, 39,5 su X in orizzontale),
mentre l'A5 ci sta comodo in entrambi anche con 5 mm di margine per lato (area
utile 247,5 × 233,0). È la conferma della decisione già presa il 2026-09-26, e
l'utente ha stabilito il 2026-10-19 che l'A4 non è un requisito.

**L'offset utensile resta a zero, e non è una dimenticanza:** l'origine la
imposti portando **la punta della penna** sul punto, quindi l'offset fra
riferimento del carrello e punta è già assorbito. Servirebbe solo se i limiti
fossero riferiti al carrello, e i limiti sono disattivati.

## A8. Salvare il profilo

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
| 6 | **Popup 1 — origine macchina.** Col pannello porti la punta nel **punto prestabilito**, quello che usi sempre | la penna è **già alzata** (l'app la alza prima di abilitare il jog, altrimenti trascini la punta sul foglio per tutto il posizionamento). Il popup mostra *"l'ultima volta era a X… Y…"* come suggerimento, senza applicarlo |
| 7 | **"Homing completato"** | manda `G92 X0 Y0`, lo stato passa a `AZZERATA`, apre il secondo popup |
| 8 | **Popup 2 — altezza penna.** Col pannello abbassi la Z a piccoli passi finché la punta **tocca il foglio e lascia il segno** | registra quella Z come *quota di appoggio per questa stampa* |
| 9 | **"Altezza penna completato"** | **alza subito la penna** (quel popup finisce per definizione con la punta che tocca), apre il terzo popup |
| 10 | **Popup 3 — inizio foglio.** Col pannello porti la punta sull'angolo in basso a sinistra del foglio. Se vuoi essere sicuro, abbassa un attimo la penna: adesso la quota di appoggio la conosce, quindi un puntino te lo conferma | legge le coordinate correnti (che sono già relative all'origine macchina) e le usa come **posizione del foglio nel piano** |
| 11 | **"Inizio foglio completato"** | **verifica che foglio + disegno stiano dentro il limite di lavoro** con il foglio in quella posizione reale, e solo allora invia il programma |
| 12 | Guardi | il programma comincia con **alza → vai al primo punto → abbassa**, altrimenti la prima cosa che disegna è una riga dall'origine all'inizio del disegno. Poi l'anteprima diventa indicatore di avanzamento |

## I tre popup fanno tre cose diverse

Vale la pena tenerli distinti, perché è facile pensare che il primo e il terzo
siano lo stesso gesto fatto due volte. Non lo sono:

| Popup | Che cos'è | Quanto deve essere preciso | Si può togliere? |
|---|---|---|---|
| 1 — origine macchina | il punto da cui si contano le coordinate. Sempre lo stesso, ogni volta | ripetibile, non esatto: è lui che dà senso ai numeri del DRO fra una sessione e l'altra | **sì, coi finecorsa**: diventa un ciclo di azzeramento automatico |
| 2 — altezza penna | la quota a cui la punta tocca **questa** carta | al decimo, e si verifica guardando il segno | **no**: la carta cambia spessore |
| 3 — inizio foglio | dove è appoggiato il foglio **questa volta**, in coordinate macchina | quanto vuoi che sia preciso il margine del disegno sul foglio | **no**: il foglio lo appoggi a mano |

Il terzo è anche quello che rende vera l'unica protezione che ci resta senza
finecorsa: sapendo dove è il foglio *davvero*, l'app può verificare che foglio
più disegno stiano dentro il limite di lavoro prima di far partire qualcosa.
Senza quel numero il controllo dell'ingombro si fa su una posizione presunta.

E sull'ordine: l'altezza penna **prima** dell'inizio foglio, come hai chiesto, ha
un vantaggio concreto — quando cerchi l'angolo del foglio la quota di appoggio la
conosci già, quindi puoi abbassare un attimo e farti confermare da un puntino di
essere dove credi.

Una nota sul popup 2: con il modulo penna in presa rigida l'unica cedevolezza
della catena sono i **0,30 mm di gioco** della coppia cremagliera/pignone.
Dentro quei 0,30 mm la penna appoggia col proprio peso invece che con la quota
imposta, e la taratura di questo popup deve cadere **dentro** quella banda.

## Quanto ci si può fidare dell'origine macchina

Il punto del passo 6 lo porti a mano, quindi la sua ripetibilità è quella del
tuo occhio: qualche millimetro. Per **dove cade il disegno sul foglio** non
conta niente, perché quello lo decide il popup 3. Conta per i limiti.

Le corse si misurano una volta in Fase A, dagli estremi veri, e vivono nel
profilo. Il margine di sicurezza nel profilo deve coprire **l'errore di
parcheggio dell'origine**, non essere un numero di comodo: se parcheggi a occhio
con ±5 mm, un margine di 5 mm non protegge niente. Finché l'origine è manuale,
tienilo generoso.

Il modo per stringerlo non è essere più precisi a occhio: è dare al parcheggio
un **riferimento fisico** — un blocchetto stampato avvitato alla base contro cui
il carrello va in battuta. A quel punto l'errore è quello del blocchetto, cioè
zero per definizione, e il margine può scendere. È l'alternativa economica ai
microswitch, e si può fare in qualunque momento.

## Cosa fare se qualcosa va storto

| Sintomo | Cosa è | Cosa fai |
|---|---|---|
| L'app torna `NON AZZERATA` a metà sessione | FluidNC si è resettato: `G92` è perso | rifai il popup dell'origine, non fidarti delle coordinate |
| Il tratto è più marcato in un punto del foglio | il piano non è piano, e la presa rigida non ha cedevolezza per assorbirlo | misura di quanto è fuori piano: se è più di 0,30 mm serve un giunto a gioco morto vero, non una ritaratura |
| Il tratto manca a tratti | appoggio tarato troppo alto, o dentro il gioco dalla parte sbagliata | rifai il popup 2 scendendo di un passo in più |
| Allarme e stop senza causa | **non** dovrebbe più succedere: i due `limit_neg_pin` sono stati commentati proprio perché un pin di finecorsa dichiarato e non cablato può leggere un disturbo come pulsante premuto | se succede, controlla che nel YAML siano ancora commentati |
