# Glossario delle impostazioni — GDC CNC 2D

I nomi di ogni numero della macchina, concordati il **2026-10-19**. Serve a
una cosa sola: che lo stesso numero si chiami allo stesso modo sullo schermo,
nel codice, in questo repo e a voce.

Se un nome qui dentro non ti piace più, si cambia **qui prima** e poi nel
codice — non il contrario.

---

## Due profili, non uno

Come in Bambu Studio: la macchina è una cosa, il lavoro che ci fai sopra è
un'altra. Hanno vite diverse, e separarli evita di rifare le misure della
macchina ogni volta che cambi carta.

| | **Profilo macchina** | **Profilo di stampa** |
|---|---|---|
| Contiene | trasmissione, corse, dinamica, estremi del servo, homing | foglio, velocità di lavoro, pausa della penna |
| Cambia quando | smonti o rifai un pezzo della macchina | cambi carta, penna, o vuoi un disegno più lento |
| Quanti | **uno** | **tanti**, ognuno con un nome |
| Chi lo fa | la taratura, una volta | tu, quando ti serve |

Chiave nel codice: `macchina` e `stampa`. I profili di stampa salvati stanno
in `libreria`.

## Le quattro etichette di provenienza

Ogni numero sullo schermo porta scritto da dove viene. Metà dei numeri di
questa macchina non sono misure ma scelte prudenti, e se hanno lo stesso
aspetto, fra un mese «accelerazione 200» sembrerà un dato di fatto.

| Etichetta | Vuol dire |
|---|---|
| **misurato** | viene da una misura sulla macchina, con data |
| **calcolato** | derivato da altri numeri; non si digita, sola lettura |
| **scelto** | una decisione, non una misura |
| **da misurare** | non c'è ancora, e accanto c'è scritto quale passo lo produrrà |

---

## Le corse

Quattro numeri distinti, con una identità che deve sempre valere:

```
corsa percorribile  +  margine di sicurezza  +  scostamento del blocco  =  corsa totale
```

| Nome | Chiave | Cos'è |
|---|---|---|
| **Corsa totale** | `corsaPassi` | da battuta a battuta: tutto quello che l'asse sa fare |
| **Scostamento del blocco** | `homing.scostamento` | quanto il blocco di homing sta dentro rispetto alla battuta: corsa che non si può usare, perché lo zero è il blocco |
| **Corsa dall'home** | *calcolata* | totale meno scostamento: quello che resta partendo da zero |
| **Margine di sicurezza** | `margineSicurezza` | quanto se ne tiene da parte per non andare a sbattere sulla battuta lontana |
| **Corsa percorribile** | *calcolata* | dall'home meno il margine: il confine che il software fa rispettare |
| **Area di lavoro** | *calcolata* | percorribile X × percorribile Y, il riquadro al centro dello schermo |

**Rimisurati il 2026-10-22**, dopo lo spostamento di una cremagliera e il
rifacimento di un blocco:

| | X | Y |
|---|---|---|
| corsa totale | 257,532 (8744 passi) | 243,042 (8252 passi) |
| corsa dall'home | **253,232** (8598 passi) | **238,064** (8083 passi) |
| scostamento | **4,300** (146 passi) | **4,977** (169 passi) |
| ostacolo meccanico | **10,0** | 0 |
| corsa percorribile (margine 2,0) | **241,232** | **236,064** |
| ripetibilità dell'appoggio | sotto la risoluzione del calibro | idem |

**L'ostacolo non è il margine**, e il profilo li tiene in due campi separati.
Il margine copre l'**incertezza** — quanto ripete l'appoggio al blocco, il
gioco della cremagliera — e si riduce diventando più precisi. L'ostacolo è un
impedimento **meccanico certo**: il 2026-10-23 si è visto che sul lato destro
il pignone del carrello tocca la cremagliera dell'asse Y **prima** che il
carrello arrivi in fondo. L'interferenza misurata è 5 mm, se ne tolgono 10 per
stare larghi finché non viene rimisurata. Quei dieci millimetri si recuperano
spostando la cremagliera di Y, non tarando meglio: per questo stanno scritti a
parte, se no fra sei mesi non si saprebbe più se sono recuperabili.

Vale quindi: **percorribile + margine + ostacolo + scostamento = totale**.

La corsa totale è ancora quella del 2026-10-19, presa senza blocchi: non è
stata rimisurata, e per rifarla i blocchi vanno tolti.

Supera i valori del 2026-10-19 (scostamento 1,443 su X e 0 su Y, quando il
blocco Y stava di fatto sulla battuta). Le due letture nuove valgono 8597,986
e 8082,987 passi — a quattro decimi di micron da un intero, che è la stessa
conferma di allora: il DRO non misura millimetri, conta passi.

Il margine è sceso da **8,0 a 2,0 mm**: gli 8 coprivano l'errore di parcheggio
di un'origine piazzata a occhio, che coi blocchi non esiste più. Restano il
gioco della cremagliera (0,30) e l'incertezza su dove sia davvero la battuta
lontana, che il conteggio gonfia perché spingendoci contro il motore slitta e
il contatore no.

### Perché la corsa si conserva in PASSI e non in millimetri

Questo è il punto meno ovvio di tutto il glossario, e viene da una verifica:
le due corse misurate col DRO il 2026-10-19 — 257,532 e 243,041 mm — valgono
**esattamente 8744 e 8252 passi**, interi a meno di due centesimi di passo.
Non è un caso: il DRO non misura millimetri, conta passi e li divide per il
rapporto *nominale*.

Quindi:

- **i passi sono la misura vera**, quella che la macchina ha davvero fatto;
- **i millimetri sono un'interpretazione** di quella misura, buona quanto il
  rapporto con cui è stata fatta la divisione.

Il giorno in cui taro il rapporto disegnando, la corsa in millimetri **cambia**
anche se la macchina non è stata toccata, perché cambia il divisore. Se avessi
salvato i millimetri, avrei congelato l'interpretazione sbagliata e buttato via
la misura.

Perciò nel profilo sta `corsaPassi`, e i millimetri sono un campo calcolato. Si
possono digitare in millimetri — l'interfaccia converte col rapporto del
momento — ma quello che resta scritto sono i passi.

Un passo a 1/16 vale **0,0295 mm**: scriverne uno in più o in meno non
cambia niente di misurabile.

---

## La trasmissione

| Nome sullo schermo | Chiave | Note |
|---|---|---|
| Passi per giro del motore | `passiGiroMotore` | 200, targa del NEMA17 |
| Microstep del driver | `microstep` | 16, dai DIP sui driver |
| **mm per giro ingranaggio** | `mmPerGiro` | **uno per asse**: le due cremagliere si sono ritirate di quantità diverse |
| Direzione invertita | `invertito` | per asse |
| Passi per mm | *calcolata* | `passiGiroMotore × microstep ÷ mmPerGiro` |

«mm per giro ingranaggio» è la circonferenza primitiva **reale** del pignone di
quell'asse: quanto avanza l'asse in un giro completo. Nominale 94,2478 mm
(modulo 1,5, 20 denti). Il flag `tarato` dice se il numero viene da una misura
o è ancora il nominale.

**Il rapporto non si può misurare col DRO**, e il motivo è lo stesso del
paragrafo sopra: il DRO legge `passi ÷ 33,953` e i passi sono
`denti percorsi × 160`, quindi legge sempre `denti × 4,71239` qualunque sia il
passo vero della cremagliera. Serve un riferimento esterno al conteggio: il
calibro su due linee disegnate.

**Avvertenza sui microstep.** La taratura misura il *prodotto* dei tre fattori.
Se i driver fossero in realtà a 1/8, la taratura darebbe `mmPerGiro ≈ 47`:
fisicamente assurdo, numericamente giusto, e la macchina disegnerebbe corretto
con un numero che mente. Se esce un valore lontano da 94, guardare i DIP prima
della cremagliera.

---

## L'homing

Senza finecorsa elettrici, ma **con un riferimento fisico**: dei pezzi stampati
che si agganciano alle staffe — sia TT (base) sia LL (trave) — contro cui si
appoggiano i carrelli. Quello è il punto di homing.

Due punti distinti, e non è pignoleria:

| Nome | Dov'è | Cos'è |
|---|---|---|
| **Punto ai blocchi** | (0, 0) | dove i carrelli toccano i blocchi. **È lo zero**: tutte le coordinate partono da qui |
| **Punto home** | (5, 5) | dove la macchina si mette appena finito l'azzeramento |

Perché non coincidono: un carrello lasciato appoggiato al blocco prima o poi
lo sposta, e il blocco è proprio la cosa che non si deve muovere. In più,
allontanandosi sempre nello stesso verso, il gioco della cremagliera viene
preso da una parte sola e il primo movimento vero parte da una condizione nota.

| Nome sullo schermo | Chiave | Stato |
|---|---|---|
| Scostamento dalla battuta | `scostamento` | **da misurare**: quanto il blocco di homing sta dentro rispetto alla battuta meccanica |
| Ripetibilità | `ripetibilita` | **da misurare**: di quanto balla la posizione ripetendo l'appoggio |
| Punto home | `puntoHome` | **scelto**: 5 mm da entrambi i blocchi |

Lo **scostamento** si ricava con la dashboard: azzera sul blocco, porta l'asse
all'altra battuta, leggi. Quella è la **corsa disponibile dall'home**, e lo
scostamento è la corsa totale meno quella.

La **ripetibilità** è il numero che **giustifica il margine di sicurezza**, e
**non si misura col DRO** — corretto il 2026-10-19, la procedura scritta prima
era impossibile. Il motivo: per ripetere l'appoggio bisogna liberare i motori,
e liberare i motori è esattamente il gesto che cancella quello che il contatore
sa. Non c'è ordine delle operazioni che lo aggiri: uno stepper non misura, conta
gli impulsi che gli arrivano.

Si misura quindi **col calibro, senza motori**: si fissa un riferimento (la
testa della staffa, o un blocchetto), si appoggia il carrello al blocco e si
misura la distanza fra riferimento e faccia del carrello. Cinque o sei
appoggi, allontanando ogni volta: la dispersione *è* il margine minimo.

Se il calibro non ci arriva, la variante con la macchina: appoggia, azzera,
comanda **+100,000 mm** e misura col calibro dove arriva rispetto a un
riferimento fisso. La macchina quei 100 mm li rifà identici, quindi tutto lo
scarto all'arrivo viene dalla partenza. Finché il numero non c'è, il margine
sta a 8 mm per prudenza.

Nota di vocabolario: «homing» qui vuol dire *appoggiare il carrello al blocco e
azzerare*, non il ciclo automatico di una macchina con i finecorsa. Non
sopravvive a un riavvio da solo — ma il punto si ritrova sempre, ed è questa la
differenza che fa il blocco stampato.

---

## La penna

Due numeri distinti che prima si chiamavano allo stesso modo:

| Nome | Dove vive | Cos'è |
|---|---|---|
| **Penna abbassata** | profilo macchina, `gradiPennaAbbassata` | l'angolo del servo a cui la penna si stringe nel modulo: il contatto nominale. Si prende **una volta**, a montaggio |
| **Altezza di contatto col foglio** | per stampa, non nel profilo | dove la punta tocca *quel* foglio, quel giorno. Si prende a ogni stampa col popup |

Lo **spessore del foglio non è un campo**: non lo conosci quando prendi un
foglio, e l'altezza di contatto lo assorbe. Un decimo di carta vale 0,3° di
servo, sotto la banda morta del servo stesso.

| Nome sullo schermo | Chiave | Note |
|---|---|---|
| Raggio del pignone del pen-lift | `raggioPignone` | 18,75 mm (z25, modulo 1,5) |
| Angolo di battuta dei cuscinetti | `gradiBattuta` | **17°** — un limite: il software non deve mai comandarlo |
| Angolo penna abbassata | `gradiPennaAbbassata` | **25°**: il contatto nominale |
| Angolo penna alzata | `gradiPennaAlzata` | **34°** = abbassata + 9 |
| Posizione tappo | `gradiTappo` | **90°**: dove la penna sale a fine stampa e all'accensione. È anche il **tetto** del meccanismo |
| Verso del servo invertito | `invertito` | sì: sul modulo montato l'angolo *fisico* crescente abbassa la penna |
| Impulso a 0° / a 180° | `impulsoMinUs` / `impulsoMaxUs` | 500 / 2500 µs, come la dashboard |
| mm di penna per grado | *calcolata* | 0,32725 |
| Alzata utile | *calcolata* | `(alzata − abbassata) × 0,32725` = 2,945 mm |
| Quota Z del tappo | *calcolata* | `(tappo − abbassata) × 0,32725` = 21,271 mm |

Regola che il software fa rispettare: **battuta < abbassata < alzata**. Se non
cresce in quest'ordine, la verifica blocca.

### I 25° non sono battuta + 6, e va bene così

Erano nati come battuta + 6 quando si credeva che la battuta fosse 19. La
battuta misurata è **17**, quindi i 25 sono battuta + 8. Non si correggono: 25
è l'angolo a cui la penna **è stata stretta** e a cui tocca il foglio, e lo
conferma il disegno fatto a mano il 2026-10-22. L'unica conseguenza è che c'è
più riserva verso il basso di quanta ne era stata prevista, cioè 2,6 mm invece
di 2,0.

### La posizione tappo, e perché è anche il tetto

A fine stampa la penna sale a **90°**, cioè 21,27 mm sopra il contatto: lì c'è
spazio per infilare il tappo senza togliere la penna dai morsetti. Novanta è
anche il massimo prima che lo stadio flottante esca dalle guide, quindi lo
stesso numero fa due lavori — posizione di riposo e fondo scala superiore.

Conseguenza sul file di FluidNC che non è ovvia: **l'arco fra `min_pulse_us` e
`max_pulse_us` deve arrivare fino al tappo, non fermarsi all'alzata**, perché
`mapConstrain` tronca tutto quello che cade fuori. Quindi `max_travel_mm`
dell'asse Z è 21,271 e non 2,945, e l'alzata di lavoro diventa la quota
intermedia Z2,945.

### I tre angoli hanno tre nature diverse

È una distinzione del progetto, non un dettaglio, ed è il motivo per cui la tab
Impostazioni mette tre etichette diverse accanto ai tre campi:

| Angolo | Natura | Come lo si ottiene |
|---|---|---|
| battuta | **misurato** | striscia di carta fra un cuscinetto inferiore e il suo blocco, scendendo di un grado per volta: l'ultimo grado in cui la carta esce ancora. Il montaggio l'aveva data 19, la misura dice 17 |
| abbassata | **imposto** | non si misura: si stringe la penna nei morsetti tenendo il servo a battuta + 6° contro il piano di riferimento |
| alzata | **calcolato** | abbassata + 9°, e i 9 sono dieci bande morte del servo |

### Perché 17° e non 1°

Col verso invertito l'impulso vero è `µs = 2500 − gradi × 11,1111`, quindi
**l'angolo logico piccolo è l'impulso grande**. A 1° l'impulso sarebbe 2489 µs,
fuori dai **500÷2400 µs** di specifica dell'SG90: il primo montaggio, del
2026-10-21, aveva calzato il pignone col servo già contro il proprio fermo
interno, e in quella condizione il fermo del meccanismo e quello del servo non
si distinguono. Col pignone spostato di uno spline la finestra di lavoro è:

| Angolo | µs |
|---|---|
| battuta 17° | 2311 |
| abbassata 25° | 2222 |
| alzata 34° | 2122 |
| tappo 90° | 1500 |

Tutta dentro specifica, con 89 µs di margine sotto il tetto dell'SG90. La
finestra accettabile è larga — qualunque battuta fra **13° e 30°** va bene —
quindi il numero esatto non era un bersaglio da centrare: il pignone è stato
calzato a 19 e la battuta vera è risultata 17, e vanno bene tutti e due.

### La battuta come fondo scala, in tre punti della catena

Non è un angolo da comandare, e i tre pezzi di software lo impediscono ognuno a
modo suo:

- **FluidNC** non ci arriva per costruzione: la battuta sta fuori dall'arco fra
  `min_pulse_us` e `max_pulse_us`, e `mapConstrain()` tronca.
- **La dashboard** tronca alla battuta slider e comandi Alza/Abbassa, e in alto
  tronca alla posizione tappo. I soli pulsanti ±1° possono scendere di 2° sotto
  la battuta, e servono a una cosa: la verifica con la striscia di carta, che ha
  senso solo se si può chiedere al servo di spingere un filo oltre il fermo.
- **Il profilo del SLICER** la tiene come limite e la verifica controlla
  l'ordine dei tre.

L'unità di misura vera di questo asse è il **terzo di millimetro**: la banda
morta del servo SG90 vale ~0,9°, cioè 0,295 mm di penna — la stessa grandezza
dei 0,30 mm di gioco della cremagliera. Chiedere l'appoggio al centesimo non ha
senso.

---

## La dinamica

| Nome sullo schermo | Chiave | Profilo |
|---|---|---|
| Velocità massima | `velocitaMax` | macchina (è un **tetto**, non una velocità di lavoro) |
| Accelerazione | `accelerazione` | macchina |
| Velocità di disegno | `velocitaDisegno` | **stampa** |
| Velocità di spostamento | `velocitaSpostamento` | **stampa** |
| Pausa della penna | `pausaPennaMs` | **stampa** |

Le prime due finiscono in `config.yaml`, le altre nelle `F` del G-code: è per
questo che stanno in profili diversi.

---

## Il gioco

| Nome | Chiave | Note |
|---|---|---|
| Gioco cremagliera-pignone | `gioco` | 0,30 mm, misurato sul CAD |

Non si usa per compensare niente — non c'è un secondo riferimento con cui
sapere da che parte si sta. È il **limite di ripetibilità** della macchina: una
linea ripassata nel verso opposto può cadere fino a 0,3 mm di lato, e nessuna
taratura lo toglie. Sta nel profilo in sola lettura perché è il numero che
spiega gli artefatti sul foglio.

---

## Cosa NON sta nel profilo, e non è una dimenticanza

| Cosa | Dove sta | Perché |
|---|---|---|
| Origine macchina (homing) | stato del momento | un'origine salvata, dopo un riavvio, è un'origine che non vale più |
| Foglio misurato sì/no | stato del momento | vale per il foglio di oggi: vedi sotto |
| Altezza di contatto col foglio | stato del momento | dipende dal foglio di oggi |
| Angolo in basso a sinistra del foglio | stato del momento | idem |
| Mappa dei pin | costante nel generatore | è cablaggio, non taratura: un campo modificabile per i pin è un modo per rompersi la macchina da un menu |
| Indirizzo della macchina, modalità finta | browser | esportando il profilo non voglio portarmi dietro la rete |
