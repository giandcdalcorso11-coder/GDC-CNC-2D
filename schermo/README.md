# Lo schermo tondo della macchina

Aperto il **2026-10-28**. Un pannello tondo sul box dell'elettronica che dice
cosa sta facendo la macchina: un anello di avanzamento al bordo, i simboli del
cambio penna, due parole quando serve fare qualcosa.

`mock.html` è il banco di prova della grafica: si apre in un browser, mostra
tutte le schermate **ingrandite e a grandezza vera**, e non richiede niente di
comprato. Si disegna lì e si porta sul pannello quando è giusta.

---

## Il pannello

| | |
|---|---|
| Controller | **GC9A01** |
| Risoluzione | 240 × 240 |
| Vetro | tondo, **32,4 mm** (1,28") |
| Interfaccia | SPI a 4 fili + RST (7 piedini: RST CS DC SDA SCL GND VCC) |
| Logica | 3,3 V — l'ESP32 ci si attacca diretto, nessun traslatore |

**0,135 mm per pixel.** È il numero che decide la grafica: una riga di testo a
24 px è alta 3,2 mm, e nel tondo ci stanno una decina di caratteri per riga. Ci
sta un simbolo, un numero e due parole. Non ci sta un registro, non ci sta il
nome di un file, non ci stanno due righe di spiegazione.

**Non ha il piedino della retroilluminazione** (i 7 piedini sono quelli sopra):
resta accesa finché c'è corrente, non si spegne e non si attenua da software.
Col coperchio trasparente vuol dire che di notte la macchina ha una lucina
accesa. **E non ha il tocco**: se un giorno si vorranno dei pulsanti alla
macchina, saranno pulsanti veri.

---

## Dove stanno i dati, che è la domanda che decide tutto

**Non sono nella macchina.** La stampa non è un file che l'ESP32 esegue: è il
browser che manda **una riga alla volta** sul WebSocket e conta gli `ok` (il
perché sta in `webui/js/sender.js`, in testa). FluidNC vede passare dei
`G1 X… Y…` e basta: non sa quante righe sono, non sa a che punto è, non sa che
esiste un cambio penna.

Avanzamento, tempo stimato, cambi penna, errori: esistono **solo nel SLICER**,
in `State.data.stampa`.

Da lì discendono tre strade, e due si scartano:

| Strada | Perché no / sì |
|---|---|
| Lo schermo legge da **FluidNC** come secondo client | Ne ricava posizione e `Run/Idle/Hold`, cioè la metà facile. Non la percentuale, non il cambio penna, non i messaggi: sbaglia proprio il bersaglio |
| Lo schermo lo pilota **l'ESP32 che c'è già** | Vuol dire forkare FluidNC e perdere la corrispondenza con la 4.1.1 verificata il 2026-10-22, dove il `config.yaml` è GENERATO e il firmware è quello ufficiale. E i dati lì dentro non ci sono comunque |
| Lo schermo è un **secondo client del SLICER** | ✅ Il SLICER sa già tutto e gli basta spedirlo. FluidNC non si tocca |

### Il motivo per cui vale la pena, ed è uno

Non è la barra: è **il cambio penna**. Tutta la procedura succede alla macchina
— togli la penna, il servo scende, infili quella nuova, provi alzata e contatto
— e l'unica cosa che oggi non succede alla macchina è *sapere che è il momento*.

### La regola

**Lo schermo ascolta, non comanda.** Se muore, la stampa continua. Se un domani
avrà dei pulsanti, quei comandi vanno **al SLICER**, mai a FluidNC: due padroni
sulla stessa macchina è il modo di ritrovarsi con la penna che scende mentre il
carrello cammina.

---

## Chi lo pilota

**Il secondo ESP32**, quello del 2026-09-21 che sta in un cassetto. Il
documento di taratura aveva già deciso di non scambiarlo con quello montato
(vedi `misure/accensione-e-taratura.md`, «C'è un secondo ESP32 con FluidNC già
installato»): qui invece è esattamente il pezzo che serve, e non costa niente.

Non smette di essere la scorta: la scorta è la **scheda**, non il firmware, e
riflashare FluidNC sono tre minuti.

> **Una cosa da fare per prima:** il vecchio ha hostname `cnc2d`, lo stesso
> della macchina. Due `cnc2d.local` sulla stessa rete è un guaio che si
> manifesta a caso. Va cambiato prima di accenderlo accanto all'altro —
> `cnc2d-schermo`.

**Sull'ESP32 montato i pin ci sarebbero** (usati: 2, 4, 18, 19, 25, 26, 27, 32,
33; liberi: 5, 12, 13, 14, 15, 16, 17, 21, 22, 23), quindi il motivo per non
usarlo non è quello. Sono il firmware, i dati che lì non ci sono, e cinque fili
SPI che dovrebbero attraversare il box fino al coperchio passando accanto ai
cavi dei motori.

### Cablaggio previsto (ESP32 di scorta, VSPI)

| Pannello | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SCL (SCK) | GPIO 18 |
| SDA (MOSI) | GPIO 23 |
| CS | GPIO 5 |
| DC | GPIO 2 |
| RST | GPIO 4 |

Libreria: `TFT_eSPI` o `Arduino_GFX`, che il GC9A01 lo conoscono tutt'e due.

---

## Quello che manca

1. **Il protocollo.** Il SLICER ha già tutto in `State.data.stampa`; va deciso
   come esce — la strada diritta è un WebSocket verso lo schermo, che fa da
   server sulla rete come fa la macchina, e un JSON a ogni cambio di stato.
2. **Il colore della penna corrente.** Lo schermo lo mostra come pallino, e il
   SLICER lo sa (è la tinta del livello): va messo nel messaggio.
3. **La grafica va confermata** guardandola sul vetro vero, non in `mock.html`.
   Finché non c'è il pannello, il banco di prova è il meglio che si può fare,
   ma non è la stessa cosa.
4. **Prima della millefori**, perché sulla basetta ci va anche questo ESP32 e
   l'ingombro del box dipende da quanto ci sta sopra.
