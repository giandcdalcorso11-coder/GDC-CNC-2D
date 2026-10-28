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

| Cosa | Perché conta qui |
|---|---|
| Display tondo al centro, 240 × 240 | è lo schermo |
| **5 tasti capacitivi** intorno | è quello che lo fa diventare un telecomando invece di una vetrina |
| **5 LED RGB** accanto ai tasti | dicono quale tasto è vivo, e si vedono da fuori stanza |
| **Batteria 18650** dietro | nessun filo: non sta sul coperchio del box, sta dove vuoi tu |
| SD, 2 relè, Grove, BME688, LSM6DSOX | non servono a questo lavoro |

> **Due numeri da confermare sulla scheda vera**, perché `docs.arduino.cc` non
> è raggiungibile dalla sessione in cui questo è stato scritto: la **misura
> del vetro** (1,3" o 1,54", cioè 33 o 39 mm) e la risoluzione. Il mock usa
> 240 × 240 su 33 mm, che è l'ipotesi **prudente**: se il pannello è il più
> grande dei due, si legge meglio, non peggio.

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
  → 200        { tasto: "riprendi" }        // o niente
```

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
3. **Lo STOP si tiene premuto.** Un pad capacitivo sfiorato da una manica non
   deve buttare via venti minuti di disegno. Un secondo, con l'anello che si
   riempie mentre lo tieni.
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
| Cambio penna, togli | FATTO |
| Cambio penna, monta | RIPRENDI · PROVA |
| Finita, errore, in attesa | nessuno |

Un tasto che in una schermata non fa niente **non ha etichetta e ha il LED
spento**: non per risparmiare, ma perché premerlo non farebbe niente, e un
tasto che a volte non fa niente senza dirlo insegna a non fidarsi dei tasti.

---

## Quello che manca

1. **Confermare misura e risoluzione del vetro** sulla scheda vera, e la
   corrispondenza numero ↔ posizione dei pad.
2. **Il colore della penna corrente** nel messaggio: il SLICER lo sa (è la
   tinta del livello), va solo spedito.
3. **Il lato SLICER**: il `POST` con il suo ritmo, e l'indirizzo del
   telecomando fra le impostazioni, accanto a quello della macchina.
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
