# Il telecomando tondo

Aperto il **2026-10-28**. Un disco che dice cosa sta facendo la macchina —
anello di avanzamento, simboli del cambio penna, due parole quando serve — e
che con i suoi cinque tasti **chiude la procedura della penna alla macchina**,
senza tornare al portatile.

`mock.html` è il banco di prova della grafica: si apre in un browser, mostra
il disco intero e il vetro **a grandezza vera**, e non richiede niente di
montato. Si disegna lì e si porta sul vetro quando è giusta.

---

## L'oggetto

**MKR IoT Carrier Rev2** (ABX00073) con dentro un **MKR WiFi 1010**. Era già
in casa, quindi non c'è niente da comprare e niente da saldare.

Numeri dal **datasheet ABX00073**, letto il 2026-10-28:

| Cosa | Perché conta qui |
|---|---|
| Display TFT tondo, **1,3" · 240 × 240** (modulo 36 × 40 mm) | 33 mm di vetro: **0,1376 mm per pixel** |
| **5 tasti capacitivi** qTouch intorno | è quello che lo fa diventare un telecomando invece di una vetrina |
| **5 LED RGB** APA102 accanto ai tasti | dicono quale tasto è vivo, e si vedono da fuori stanza |
| **Cicalino** (M1) | vedi sotto: è la cosa che il datasheet ha aggiunto al progetto |
| **Batteria 18650** dietro, ricarica via USB del MKR | nessun filo: non sta sul coperchio del box, sta dove vuoi tu |
| SD, 2 relè KEMET 2 A, Grove, BME688, LSM6DSOX, APDS-9960 | non servono a questo lavoro |

Libreria obbligata: **`Arduino_MKRIoTCarrier` 2.0.0 o successiva** — il
datasheet la dichiara come requisito, non come consiglio. Il controller del
vetro non è nominato e non serve saperlo: ci parla la libreria.

### Il cicalino cambia la cosa più importante

Il telecomando esiste per un motivo: **sapere che è il momento del cambio
penna**. Uno schermo lo dice a chi lo sta guardando; un **beep lo dice a chi
non lo sta guardando**, che è il caso vero — una stampa dura venti minuti e
nessuno la fissa.

| Momento | Suono | Si ripete? |
|---|---|---|
| **cambio penna** | due note alte, corte | **sì, ogni 20 s finché non premi** |
| **fine stampa** | tre note che scendono | no |
| **errore** | tre note basse | no |

Tre disegni diversi, perché il punto è **capire cosa è successo senza
guardare**. E uno solo si ripete: il cambio penna è l'unico in cui la macchina
sta **aspettando te**, e un suono che squilla una volta sola la lascia ferma
un'ora se in quel momento eri in un'altra stanza. Gli altri due raccontano una
cosa già successa: ripeterli sarebbe insistere su niente.

### La batteria

Il datasheet dichiara **fino a 48 h con una 2500 mAh**, ma è il consumo di un
sensore che si sveglia ogni tanto: col vetro acceso e il WiFi attivo sarà
molto meno.

**Come si legge la carica.** Il pinout dice che il 18650 va **diritto al VBAT
del MKR** (cavetto fra i due connettori) e che sul carrier non passa da nessun
partitore verso un piedino analogico. Quindi, in ordine di costo:

1. **`analogRead(ADC_BATTERY)`** — se la variante del MKR WiFi 1010 definisce
   quel nome, c'è già un partitore sulla scheda e il lavoro è finito. **Una
   riga di sketch risponde**, ed è la prima cosa da provare.
2. **Il PMIC** (BQ24195L, via `Arduino_PMIC`): dà di sicuro lo **stato** — in
   carica, carica, in scarica, guasto — ma non ha un misuratore di carica a
   bordo, quindi una percentuale probabilmente no. Lo stato è comunque utile e
   si prende gratis.
3. **Un partitore su A0**, se i primi due non bastano: due resistenze uguali
   (100 k va bene) dal più della batteria, e il centro sul **Grove A0**, che è
   libero. Niente da saldare sul carrier — basta un cavetto Grove.

Dalla tensione la percentuale è un'approssimazione, perché la curva di una
Li-ion è piatta in mezzo: **non si scrivono i decimali** e si guarda il
colore, che è l'informazione vera.

**Dove si vede.** Sul telecomando **sempre sulla schermata Pronta**, che è
quella che hai davanti quando lo prendi in mano; **sotto al 20% dappertutto**,
in rosso, perché lì non è un dato ma un avviso. Non sulle due schermate dello
stop: in mezzo a una domanda a cui devi rispondere adesso, una pila rossa è
rumore. Nel SLICER la percentuale arriva con la risposta del telecomando e
compare accanto allo stato della macchina, **solo quando il telecomando c'è**.

### Perché il vetro deve dormire

**D3 è `DISP_BL`**, la retroilluminazione, ed è un piedino comandabile: il
vetro si spegne davvero, non si limita a diventare nero. Quindi **si spegne da
solo quando non c'è niente in corso** e si riaccende quando succede qualcosa —
o quando lo prendi in mano, perché la IMU LSM6DSOX ha la funzione di risveglio
e qui ha un motivo per esistere invece di essere un ninnolo. Durante una
stampa resta acceso: è il suo mestiere.

### Tutti i piedini del MKR sono occupati

Dal pinout, e vale la pena saperlo prima di progettare qualunque altra cosa
attorno a questa scheda:

| | |
|---|---|
| A1, A2, A3, A4, A5 | i cinque tasti (TOUCH2, 3, 4, 5, 1 — **in quest'ordine**) |
| D0 | SD_CS · D1, D2 i due relè |
| **D3** | **DISP_BL**, la retroilluminazione |
| D4, D5 | LED_CKI, LED_SDI — i cinque RGB sono APA102, clock e dati |
| D6 | interrupt di APDS e IMU · **D7 il cicalino** |
| D8, D9, D10 | SPI, condivisa fra display e SD |
| D11, D12 | I²C dei sensori |
| D13, D14, RESET | DISP_CS, DISP_DC, DISP_RST |

**Liberi restano solo A0 e A6**, sui due connettori Grove analogici. Sono
quelli che servirebbero al partitore della batteria.

### I due vincoli che comandano la grafica

1. **Circa un decimo di millimetro per pixel.** Una riga a 24 px è alta tre
   millimetri. Nel tondo ci stanno un simbolo, un numero e due parole: non ci
   sta un registro, non ci sta il nome di un file, non ci sta il *perché* di
   un errore. Per questo `mock.html` mostra tutto due volte — una grafica che
   funziona solo nel riquadro grande non funziona.
2. **32 kB di RAM sul MKR WiFi 1010.** Una pagina video 240 × 240 a 16 bit ne
   vuole 115: **non esiste un buffer**. Si disegna direttamente sul vetro, per
   forme, una regione alla volta. Tutto quello che c'è nel mock è fatto di
   archi, rettangoli, cerchi e testo — cioè di quello che Adafruit_GFX sa
   fare — apposta. L'anello sul vetro vero sarà **seghettato**: senza
   antialiasing un arco spesso undici pixel è una scaletta, e a undici pixel
   di spessore si vede poco, ma si vede.

---

## Dove stanno i dati, che è la domanda che decide tutto

**Non sono nella macchina.** La stampa non è un file che l'ESP32 esegue: è il
browser che manda **una riga alla volta** sul WebSocket e conta gli `ok` (il
perché sta in `webui/js/sender.js`, in testa). FluidNC vede passare dei
`G1 X… Y…` e basta: non sa quante righe sono, non sa a che punto è, non sa che
esiste un cambio penna.

Avanzamento, tempo stimato, cambi penna, errori, **colore della penna**:
esistono solo nel SLICER, in `State.data.stampa` e nei livelli.

Quindi il telecomando è **un secondo client del SLICER**, non della macchina.
Le altre due strade si scartano: leggere da FluidNC dà posizione e
`Run/Idle/Hold`, cioè la metà facile e non quella che serve; mettere il
display sull'ESP32 montato vuol dire forkare FluidNC e perdere la
corrispondenza con la 4.1.1 verificata il 2026-10-22, dove il `config.yaml` è
**generato** e il firmware è quello ufficiale.

### Il canale, e perché è uno solo

Un browser non apre socket TCP: parla HTTP o WebSocket. Il carrier fa da
**server HTTP**, il SLICER gli manda lo stato con un `POST`, e **la risposta a
quel POST riporta indietro il tasto premuto**. Un canale, due versi, nessuna
seconda connessione, e il telecomando non comincia mai lui una conversazione.

```
POST /stato    { stato, percento, rimanente, colore, passo }
  → 200        { tasto: "riprendi", batteria: 78 }
```

La carica viaggia nella **risposta** e non in una chiamata sua: è un dato del
telecomando, e il telecomando parla solo quando gli si chiede qualcosa.

Due cose da non sbagliare:

- **Il ritmo.** `State.set('stampa')` scatta a ogni riga confermata, che sono
  decine al secondo: si manda **al massimo due o tre volte al secondo**, più
  subito a ogni cambio di stato (cambio penna, errore, fine). La latenza di un
  tasto è l'intervallo fra due POST — qualche decimo di secondo, che per «ho
  tolto la penna» va benissimo.
- **CORS.** La pagina è servita dall'ESP32 o da `file://`, quindi il carrier
  deve rispondere `Access-Control-Allow-Origin: *`. Una riga.

### Le regole

1. **Il telecomando non parla con FluidNC.** Dice al SLICER che è stato
   premuto un tasto; che cosa voglia dire quel tasto lo decide il SLICER. Con
   questo canale non è disciplina, è struttura: il carrier non sa nemmeno
   l'indirizzo della macchina.
2. **Il telecomando non muove la macchina.** Ferma, riprende, e guida il
   cambio penna. Mandare un carrello da qualche parte vuol dire guardare delle
   coordinate, e su tre centimetri di vetro le coordinate non ci stanno.
   L'unica eccezione è il tasto **PROVA** del secondo passo, che alza e
   abbassa il servo: lo stai guardando da venti centimetri con la penna in
   mano, ed è esattamente il gesto per cui il telecomando esiste.
3. **Lo STOP si conferma due volte.** È l'unica cosa qui dentro che non si
   può disfare, e un pad capacitivo sfiorato da una manica non deve buttare
   via venti minuti di disegno.

   | | |
   |---|---|
   | **primo tocco** | non ferma niente: chiede. L'anello diventa un **conto alla rovescia rosso che si svuota** — se non rispondi, la domanda se ne va da sola. Rosso, e al contrario di come andava un attimo prima, quindi non lo si scambia per l'avanzamento. Gli altri tasti si spengono, tranne un **ANNULLA** esplicito |
   | **secondo tocco, tenuto** | uno **spicchio si riempie in un secondo** al centro del vetro, e solo da pieno la stampa si ferma. Mollando prima non succede niente, e il dito ha visto quanto mancava per tutto il tempo |

   Lo spicchio è un oggetto diverso dall'anello apposta: l'anello sta sul
   bordo e dice a che punto è la stampa, lo spicchio sta in mezzo e dice a che
   punto è il tuo dito. Girano nello stesso verso, perché due cose che
   misurano il tempo sullo stesso vetro non possono girare in versi diversi.
4. **I due relè non si toccano.** Togliere corrente a metà stampa non è una
   funzione.

---

## I cinque tasti

Le **posizioni** sono fisse (a 72° uno dall'altro); i **numeri** no — quale
pad sia lo 00 e quale il 04 si vede premendoli sulla scheda. Il firmware mappa
numero → posizione una volta sola.

| Schermata | Tasti vivi |
|---|---|
| Pronta | nessuno — far partire una stampa senza guardare il foglio non è una comodità |
| In stampa | PAUSA · STOP |
| In pausa | RIPRENDI · STOP |
| Stop, primo tocco | ANNULLA · TIENI |
| Stop, tocco lungo | TIENI |
| Cambio penna, togli | FATTO |
| Cambio penna, monta | RIPRENDI · PROVA |
| Finita, errore, in attesa | nessuno |

Un tasto che in una schermata non fa niente **non ha etichetta e ha il LED
spento**: non per risparmiare, ma perché premerlo non farebbe niente, e un
tasto che a volte non fa niente senza dirlo insegna a non fidarsi dei tasti.

---

## Quello che manca

1. **La corrispondenza numero ↔ posizione dei pad**, che si vede premendoli
   sulla scheda: le posizioni nel mock sono giuste, i numeri li mappa il
   firmware una volta sola.
2. **Il colore della penna corrente** nel messaggio: il SLICER lo sa (è la
   tinta del livello), va solo spedito.
3. **Il lato SLICER**: il `POST` con il suo ritmo, l'indirizzo del
   telecomando fra le impostazioni accanto a quello della macchina, e la
   pila accanto allo stato della macchina — solo quando il telecomando c'è.
4. **Il firmware**: `Arduino_MKRIoTCarrier` per vetro, tasti e LED;
   `WiFiNINA` per la rete.
5. **La grafica va confermata sul vetro vero.** Finché non c'è, `mock.html` è
   il meglio che si possa fare, ma non è la stessa cosa.

### Una strada scartata, per memoria

Il 2026-10-28, prima che saltasse fuori il carrier, l'ipotesi era un pannello
**GC9A01** da 1,28" pilotato dal **secondo ESP32** (quello del 2026-09-21, in
cassetto). Funzionava e costava zero, ma: niente tasti, niente batteria,
cinque fili SPI dal box al coperchio accanto ai cavi dei motori, e un firmware
da scrivere da capo. Il carrier le risolve tutte e quattro. Il pannello
GC9A01 resta comprato e buono per altro.
