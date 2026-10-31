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

Numeri dal **datasheet ABX00073**, letto il 2026-10-28. Piedini, posizioni
e componenti dagli **schemi Altium del carrier** (`MKR`, `DISPLAY`,
`CAPACITIVE_SENSOR`, `BUZZER` e il `.PcbDoc`), letti il **2026-10-29** con
`leggi-schemi.py`, che sta qui accanto perché una tabella copiata a mano, fra
un mese, non si distingue da una tabella indovinata: da lì viene tutto quello
che qui sotto è detto con un numero di componente (M1, Q1, R33, DL4…), e da lì vengono le tre cose che hanno cambiato il progetto —
**i numeri dei pad**, **come suona il cicalino** e **che cos'è la
retroilluminazione**.

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
| **partenza** | tre note corte che salgono | no |
| **cambio penna** | due colpi sulla nota più forte | **sì, ogni 20 s finché non premi** |
| **fine stampa** | un motivetto: scende, risale, e l'ultima resta | no |
| **errore** | uno lungo, sulla stessa nota del cambio penna | no |

**Due allarmi e due motivetti, e la differenza non è estetica.** Cambio penna
e problema devono arrivare **dall'altra stanza**: stanno su **una nota sola**,
quella dove il cicalino è più forte, e si distinguono per il **ritmo** — due
colpi contro uno lungo. E' una differenza che regge anche quando il suono
arriva attutito da una porta, mentre due altezze diverse, attutite, diventano
la stessa cosa. Partenza e fine le senti da vicino (la partenza l'hai appena
fatta partire tu), quindi possono permettersi delle note, che costano un po'
di volume. La fine però **attacca sulla nota della risonanza**, così la prima
cosa che senti arriva lontano anche se il resto è più piano.

**Perché il volume non si può scegliere e l'altezza sì.** M1 è un
**ABT-461-RC**, un trasduttore magnetico **a comando esterno**: dentro non ha
un oscillatore, quindi non suona perché gli dai tensione — suona finché gli
fai commutare il piedino (D7, che accende Q1, un 2N7002K, sul lato basso; il
trasduttore sta sul 3V3 e R8 fra i due è uno zero ohm). E non ha volume: o
commuta o non commuta. L'unica cosa che cambia quanto si sente è la
**frequenza**, perché ha una **risonanza**: intorno ai 4 kHz grida, un'ottava
sotto è un soffio. Per questo tutte le note stanno nella stessa ottava —
**A7-D8, cioè 3,5-4,7 kHz**, l'ultima ottava di un pianoforte — e per questo
gli allarmi non si muovono di lì.

*Supera i tre suoni scritti il 2026-10-28* («due note alte», «tre note che
scendono», «tre note basse»): erano pensati per un cicalino con l'oscillatore
dentro, dove l'altezza è gratis.

**Nessuno dei quattro ha bisogno di un campo nuovo nel messaggio.** Sono
quattro **cambi di `stato`**, e lo stato il POST lo porta già: fermo→invio
suona la partenza, invio→cambio il cambio penna, →fine il motivetto,
→errore quello lungo. Sono esattamente i cambi che `impronta()` considera
urgenti e che quindi non aspettano il giro dopo — il suono arriva quando
cambia la faccia del telecomando, che è la stessa cosa.

**I 4 kHz sono da confermare a orecchio.** Che sia a comando esterno lo dice
lo schema; la frequenza esatta della risonanza no, e una spazzata da 1 a 6 kHz
col firmware la trova in dieci secondi. Se cade altrove, si sposta lì tutta
l'ottava: è un numero solo, `RISONANZA`.

**Si sentono in `mock.html`**, col pulsante accanto a ognuno. La prova li fa
passare per un filtro centrato sulla risonanza invece di suonarli tutti allo
stesso volume: una prova che li pareggia direbbe una bugia comoda, e la bugia
si scoprirebbe in officina con un motivetto inudibile dall'altra stanza. C'è
un interruttore per togliere il filtro e sentire la differenza. La pagina
sputa anche la tabella `{hertz, millesimi}` già pronta per lo sketch, così
non si ricopia a mano un suono scelto bene.

Quattro disegni diversi, perché il punto è **capire cosa è successo senza
guardare**. E uno solo si ripete: il cambio penna è l'unico in cui la macchina
sta **aspettando te**, e un suono che squilla una volta sola la lascia ferma
un'ora se in quel momento eri in un'altra stanza. Gli altri raccontano una
cosa già successa: ripeterli sarebbe insistere su niente.

### La batteria

Il datasheet dichiara **fino a 48 h con una 2500 mAh**, ma è il consumo di un
sensore che si sveglia ogni tanto: col vetro acceso e il WiFi attivo sarà
molto meno.

**Come si legge la carica.** Il pinout dice che il 18650 va **diritto al VBAT
del MKR** (cavetto fra i due connettori) e che sul carrier non passa da nessun
partitore verso un piedino analogico. **Il rame lo conferma**: nella netlist
del PcbDoc la rete `VBAT` tocca soltanto il contatto del portabatteria (J8) e
il connettore del cavetto (J11) — **nello zoccolo del MKR non entra**. Non è
una svista da aggirare con un piedino nascosto: la tensione della batteria non
arriva da nessuna parte dove un ADC la possa vedere. Quindi, in ordine di costo:

1. **`analogRead(ADC_BATTERY)`** — se la variante del MKR WiFi 1010 definisce
   quel nome, c'è già un partitore sulla scheda e il lavoro è finito. **Una
   riga di sketch risponde**, ed è la prima cosa da provare.
2. **Il PMIC** (BQ24195L): dà di sicuro lo **stato** — in carica, carica, in
   scarica, guasto — ma non ha un misuratore di carica a bordo, quindi una
   percentuale probabilmente no. Lo stato è comunque utile e si prende gratis.
   **Fatto il 2026-10-31**, leggendogli il registro direttamente invece di
   passare da `Arduino_PMIC`: vedi «Sì, attaccandolo all'USB si ricarica».
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

### Sì, attaccandolo all'USB si ricarica — ma i registri vanno scritti

Il caricabatterie **non sta sul carrier: sta sul MKR**. È il BQ24195L, lo
stesso che dal 3,7 V della cella tira su il 3V3 di tutto e il 5 V dei LED.
Quindi il cavetto a due pin fra il carrier e il connettore batteria del MKR
non è un accessorio: è l'unica strada che la cella ha per arrivargli, nei due
versi. Senza cavetto il telecomando a batteria non si accende **e** la cella
non si carica.

Attaccare l'USB del MKR quindi ricarica la 18650. Ma all'accensione tre cose
possono mettersi di mezzo, e tutte e tre sono vere su questa scheda:

1. **Il core di Arduino accende la carica solo se all'avvio vede la
   batteria.** In `variants/mkrwifi1010/variant.cpp`, `initVariant()` legge
   `analogRead(ADC_BATTERY)`: sopra 600 scrive «carica sì», sotto **stacca la
   cella** dal resto. Accendere col cavetto scollegato e attaccarlo dopo vuol
   dire USB che alimenta e cella che non carica, **fino al riavvio**.
2. **Il limite di corrente in ingresso vale 100 mA.** Sul MKR i fili D+/D−
   non arrivano al caricabatterie, quindi la trattativa con il caricatore non
   si fa e resta il minimo di fabbrica. Il telecomando col vetro acceso ne
   mangia più di 100: a quel limite la cella **non carica**, al massimo dà una
   mano all'USB a tenere su la scheda.
3. **`carrier.begin()` accende la boost mode** — è lei che fa il 5 V dei LED
   quando si va a batteria — e tocca lo stesso registro della carica.

Quindi il firmware non spera: **scrive**. Cinque registri, una volta sola in
`setup()`, e li rilegge sul monitor seriale (`impostaCaricatore()`, sezione
«LA SPINA»):

| registro | valore | perché |
|---|---|---|
| `0x00` ingresso | `0x32` | 500 mA, quello che una porta USB dà per contratto; sotto i 4,36 V il caricabatterie si tira indietro da sé invece di far cadere la scheda |
| `0x01` modo | `0x3B` | **carica e boost accese insieme**: il BQ24195L carica quando l'ingresso c'è e fa il 5 V quando non c'è, perché la boost parte solo a ingresso assente |
| `0x02` corrente | `0x00` | 512 mA, il minimo che il registro sappia dire (di suo sarebbero 2048; in serie alla cella **dovrebbe** esserci un fusibile da mezzo ampere, detto dagli sviluppatori del core e non verificato sul rame). Quelli veri sono ~350: dai 500 dell'ingresso va tolto quello che la scheda mangia mentre carica |
| `0x05` timer | `0x8C` | guardiano **spento** (acceso, dopo 40 s senza scritture rimette tutto di fabbrica: boost giù, LED morti) e timer di sicurezza a 12 ore, perché a 350 mA una cella da 3000 mAh in otto ore non ce la fa |
| `0x07` cella | `0x0B` | cella attaccata comunque, e **niente trattativa D+/D−**, che riscriverebbe il limite appena messo |

Una 18650 da 3000 mAh a ~350 mA è **un decimo di C**: dieci ore da vuota,
lenta e mite — che su una cella senza circuito di protezione proprio è la
scelta giusta, non un ripiego.

**E sul vetro si vede.** Ogni due secondi il firmware legge il registro
`0x08` del caricabatterie — quello che dice com'è andata davvero, non come
dovrebbe andare — e ne ricava quattro stati: a batteria, in carica, carica
finita, **attaccato ma non carica**. L'ultimo non è un doppione del primo: è
il guasto, e va fatto vedere invece che nascosto. Sul vetro:

- un **fulmine bianco dentro alla pila** quando la corrente c'è. Bianco e non
  verde perché sta per metà sopra al pieno e per metà sopra al nero di quello
  che manca: il bianco è l'unico colore che si vede su tutti e due;
- la pila **verde** mentre carica o a carica finita, **ambra** se la spina c'è
  e non entra niente;
- **sotto al 20% alla spina l'allarme rosso non compare**: il 12% di una cella
  che sta caricando non è un allarme, e lasciarlo rosso insegnerebbe a non
  fidarsi del rosso;
- la pila compare **anche sulla schermata in attesa, ma solo alla spina** —
  quella è la schermata che resta su mentre lo carichi col portatile chiuso, e
  lì «sta caricando?» è l'unica domanda che ha una risposta utile.

Una cosa da sapere sul numero: **mentre carica è gonfio**. La percentuale
viene dalla tensione, e sotto carica la tensione è più alta di quella che la
cella avrà dopo. Un 100% col fulmine acceso può essere un 95% vero. Il
fulmine conta più del numero.

### L'interruttore non c'è, e metterlo costa la ricarica

Sul MKR IoT Carrier Rev2 **non c'è nessun interruttore**: cella dentro al
portabatteria e cavetto attaccato vuol dire telecomando acceso, finché non si
scarica. Niente pulsante di spegnimento, né sul carrier né sul MKR.

Metterlo si può, ma bisogna sapere che cosa si paga. L'unica strada della
cella è quella coppia di fili, e la corrente ci passa **nei due versi**: in
uscita per accendere, in entrata per caricare. Un interruttore lì dentro —
sul filo positivo del cavetto a due pin, senza toccare nulla sul carrier —
spegne davvero, ma **a interruttore aperto non si carica nemmeno**.

Non è la stessa situazione della macchina, dove il 2026-09-19 l'interruttore
è finito sulla linea 5 V e non sulla batteria, proprio per poter caricare a
macchina spenta: lì il modulo aveva una porta per caricare e una per uscire,
due strade diverse. Qui la strada è una sola, e un interruttore su una strada
sola taglia tutto.

Quindi, in ordine di buon senso:

- **niente interruttore**, e per i periodi lunghi si tira fuori la cella dal
  portabatteria: è dietro, si prende con due dita, e una Li-ion lasciata
  attaccata per settimane si scarica sotto la soglia e muore;
- **interruttore sul positivo del cavetto** se spegnerlo deve essere un
  gesto da una mano: si carica solo con l'interruttore chiuso, e va bene,
  perché mentre carica è attaccato all'USB e tanto vale lasciarlo acceso.

### Perché il vetro deve dormire

**D3 è `DISP_BL`**, la retroilluminazione, ed è un piedino comandabile: il
vetro si spegne davvero, non si limita a diventare nero. Lo schema dice
*quanto* davvero: dietro a quel piedino c'è un **alimentatore a innalzamento**
(U3/U6, con l'induttanza L6 da 10 µH, alimentato dal 3V3) che tira la fila di
LED del pannello. Due conseguenze buone: spegnere **ferma il convertitore**,
quindi risparmia corrente vera e non solo luce; e un'onda quadra su D3 lo
**attenua**, quindi «è acceso ma piano» esiste e costa meno di «acceso». Una
terza, da sapere: R19 tiene quel piedino **a terra a riposo**, quindi il vetro
all'accensione è **nero finché non è il firmware ad alzarlo** — uno schermo
spento appena dato corrente non è un guasto. Quindi **si spegne da
solo quando non c'è niente in corso** e si riaccende quando succede qualcosa —
o quando lo prendi in mano, perché la IMU LSM6DSOX ha la funzione di risveglio
e qui ha un motivo per esistere invece di essere un ninnolo. Durante una
stampa resta acceso: è il suo mestiere.

### La micro SD: a che cosa serve e a che cosa no

**Non serve a stampare dalla SD**, ed è la prima idea che viene in mente
quindi vale la pena scriverla come scartata. Tre motivi, in ordine di peso:

1. Romperebbe la regola che tiene in piedi tutto: il telecomando **non parla
   con FluidNC**. Due padroni sulla stessa macchina è come ci si ritrova con
   la penna che scende mentre il carrello cammina.
2. Un SAMD21 che alimenta venti minuti di G-code via WiFi rifarebbe
   esattamente il guasto che questo progetto ha già diagnosticato e risolto —
   il canale lungo che cade e si porta dietro la macchina, due stampe morte il
   2026-10-23 — con un dispositivo più debole di quello che lo faceva prima.
3. E comunque **non è la memoria che lega la stampa al portatile**: è il fatto
   che il programma si **rigenera** dopo i tre popup, con l'origine e l'altezza
   di contatto misurate quel giorno su quel foglio. Il G-code di ieri non vale
   oggi, e metterlo su una SD non lo fa valere.

**Serve a tenerci il SLICER, ed è l'uso che da solo giustifica la scheda.**
Vedi la sezione qui sotto: è la cosa più grossa che la SD rimette in gioco.

**E serve al registro delle stampe.** Oggi il
registro vive nella pagina e muore con lei. Sulla SD diventa il **libro di
bordo della macchina**: una riga per stampa, in CSV perché un CSV si apre con
qualunque cosa e si allunga in fondo senza riscriverlo.

```
data;nome;righe;durata_s;cambi_penna;esito
2026-10-28T21:14;gdc master.svg;1284;1083;1;finita
2026-10-28T22:02;iso-cross.svg;2140;1710;0;fermata
```

La data la manda il SLICER nel `POST`: il telecomando non ha un orologio che
sopravviva a una batteria scarica, e il browser la data ce l'ha. Si scrive
**una riga a fine stampa**, non a ogni messaggio — una scheda SD scritta tre
volte al secondo per venti minuti è una scheda SD rotta.

È un registro **a perdere**: se il telecomando era spento, quella stampa nel
libro non c'è. Va bene così — è una memoria in più, non una contabilità.

Due usi minori, veri ma piccoli:

- **Il logo all'accensione.** Un'immagine 240 × 240 a 16 bit sono 115 kB:
  nella flash del SAMD21 (256 kB in tutto) non ci sta comoda, sulla SD sì. Il
  giorno che il logo della macchina esiste, è lì che va.
- **Una copia del profilo macchina.** Il profilo vive in `localStorage`, che
  sparisce se si cancellano i dati del sito. Una copia scritta sulla SD a ogni
  cambio è una rete sotto a numeri che sono costati giornate di misure.

**Una regola pratica:** la SD **divide la SPI con il display** (D8, D9, D10,
con D0 per la sua selezione). Scrivere mentre si disegna fa singhiozzare
l'animazione, quindi si scrive **ai cambi di stato e mai durante il tocco
lungo dello stop**, che è l'unico momento in cui un fotogramma perso si vede.

### La SD rimette in gioco il SLICER servito dalla macchina

Il 26 ottobre la pagina era stata tolta dall'ESP32 e lasciata sul PC, e il
motivo era uno solo: **non ci stava**. Dopo FluidNC e la sua WebUI restano
**64 kB liberi** sulla scheda, e la pagina compilata ne pesa **583** — 172
compressa (misurati il 2026-10-28; crescono a ogni funzione nuova). Con quella decisione, però, si è persa una cosa che faceva comodo:
**un indirizzo solo, sempre aggiornato, che qualunque dispositivo apre**.

La SD del telecomando la rimette in gioco, e **senza toccare la macchina**:

| | |
|---|---|
| Dove | `cnc2d-telecomando.local/` — il MKR fa già da server HTTP per il suo `POST` |
| Che cosa | `cnc2d-ui.html.gz`, ~170 kB, mandato con `Content-Encoding: gzip` |
| Quanto ci mette | qualche secondo, e una volta sola: la pagina si apre prima di stampare |

**La regola non si rompe, ed è il punto che conta: servire un file non è
comandare una macchina.** Il telecomando consegna dei byte; una volta
caricata, la pagina parla con FluidNC come ha sempre fatto, dal browser.
Niente secondo padrone.

Anzi, ne viene una semplificazione: servita da lì, la pagina è **nella stessa
origine** dell'API del telecomando, e l'header CORS smette di servire.

**I tre passi, in ordine di valore:**

1. **La pagina.** Un indirizzo solo invece di una copia per dispositivo. E
   capire se la copia è vecchia è già risolto: il numero di versione sta
   accanto al titolo, quindi una card indietro si vede a colpo d'occhio.
2. **Una cartella di disegni.** Gli SVG sulla scheda, elencati dalla pagina:
   la sezione «Dove trovare disegni» smette di puntare a internet e punta alla
   macchina. Qui i gigabyte cominciano a voler dire qualcosa.
3. **I progetti salvati** (`.cnc2d.svg`, vedi `webui/js/progetto.js`). Oggi
   salvi sul portatile e continui su quel portatile; con una scrittura sulla
   SD salvi dalla macchina e continui da dove ti pare. Chiede un endpoint di
   caricamento sul telecomando, quindi è il terzo passo e non il primo.

**Due cose da non dimenticare.**

- **La SD non diventa mai l'unica strada.** Il telecomando è a batteria e
  dorme: se fosse l'unico posto dove vive la pagina, con la pila scarica non
  si stamperebbe più. Il file locale resta, e la SD è una strada **in più**.
- **Multi-dispositivo vuol dire ACCESSO, non ancora interfaccia.** La pagina è
  disegnata per uno schermo largo — barra laterale più piano. Da un telefono
  si aprirà, ma usarla davvero è un lavoro suo, separato da questo.

E l'aggiornamento della pagina sulla scheda, finché non c'è il caricamento da
rete, si fa come si fa: si sfila la micro SD e si copia il file.

### Tutti i piedini del MKR sono occupati

Dal pinout, e vale la pena saperlo prima di progettare qualunque altra cosa
attorno a questa scheda:

| | |
|---|---|
| A1, A2, A3, A4, A5 | i cinque tasti, nell'ordine `TOUCH1`, `2`, `3`, `4`, **`0`** — l'ultimo non è un errore di battitura, vedi «I cinque tasti» |
| D0 | SD_CS · D1, D2 i due relè |
| **D3** | **DISP_BL**, la retroilluminazione |
| D4, D5 | LED_CKI, LED_SDI — i cinque RGB sono APA102, clock e dati |
| D6 | interrupt di APDS e IMU · **D7 il cicalino** |
| D8, D9, D10 | SPI, condivisa fra display e SD |
| D11, D12 | I²C dei sensori |
| D13, D14 | DISP_CS, DISP_DC · **RESET**: il reset del pannello è attaccato (R9) alla linea di reset del MKR, quindi non è un piedino a parte — il vetro si azzera solo azzerando la scheda |

**Liberi restano solo A0 e A6**, sui due connettori Grove analogici. Sono
quelli che servirebbero al partitore della batteria.

### I tre vincoli che comandano la grafica

1. **Circa un decimo di millimetro per pixel.** Una riga a 24 px è alta tre
   millimetri. Nel tondo ci stanno un simbolo, un numero e due parole: non ci
   sta un registro, non ci sta il nome di un file, non ci sta il *perché* di
   un errore. Per questo `mock.html` mostra tutto due volte — una grafica che
   funziona solo nel riquadro grande non funziona.
2. **32 kB di RAM sul MKR WiFi 1010.** Una pagina video 240 × 240 a 16 bit ne
   vuole 115: **non esiste un buffer**. Si disegna direttamente sul vetro, per
   forme, una regione alla volta. Tutto quello che c'è nel mock è fatto di
   archi, rettangoli, cerchi e testo — cioè di quello che Adafruit_GFX sa
   fare — apposta. *Era* scritto qui che l'anello sarebbe stato
   **seghettato**, «e a undici pixel di spessore si vede poco, ma si vede»:
   si vedeva eccome, ed è la prima cosa segnalata dalla prova sul vetro vero.
   Niente buffer non vuol dire niente antialiasing: l'anello adesso si
   disegna **per pixel**, e il pixel di bordo si accende a metà se è mezzo
   dentro e mezzo fuori. Si può perché il fondo è **nero sia dentro sia
   fuori**, quindi «mezzo acceso» è semplicemente il colore smorzato a metà —
   non c'è nessun fondo da rileggere, e senza buffer non si potrebbe.
3. **Il vetro è tondo, quindi lo spazio utile è un cerchio, non un
   rettangolo.** Dentro c'è l'anello (raggio 101, spesso 11), quindi per le
   parole restano i **93 pixel** di raggio più interni — circa 25 mm, meno
   dei 33 del vetro. E ogni parola si posa per il suo **spigolo esterno**,
   non per il punto da cui parte a scrivere: quello che va a sbattere
   nell'anello è sempre un angolo, e mettendo sul raggio giusto il punto di
   appoggio l'angolo finisce comunque di fuori. E' la correzione del
   2026-10-29: cinque parole — RIPRENDI in cima, STOP e TIENI in basso a
   destra — toccavano l'anello o la parola in mezzo al vetro.

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
POST /stato    { stato, percento, rimanente, penna, passo }
  → 200        { tasto: "riprendi", batteria: 78, carica: "carica" }
```

La carica viaggia nella **risposta** e non in una chiamata sua: è un dato del
telecomando, e il telecomando parla solo quando gli si chiede qualcosa. Con
lei viaggia `carica` — `batteria`, `carica`, `piena`, `ferma` —, che è la
spina e non la percentuale: sotto carica la tensione è gonfia e il numero
mente di qualche punto, mentre quella parola viene dal registro del
caricabatterie. Un telecomando vecchio non la manda, e il SLICER non la
inventa: senza quel campo non dice niente invece di dire «a batteria».

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

I cinque pad stanno a **60° uno dall'altro**, non a 72: sono cinque posti su
sei, e il sesto — **quello in alto**, dove stanno i sensori — è vuoto.

| pad | dove sta | piedino | resistenza | LED |
|---|---|---|---|---|
| **TOUCH0** | in alto a destra | **A5** (`PA06`) | R33 | DL4 |
| **TOUCH1** | in basso a destra | **A1** (`PB02`) | R34 | DL5 |
| **TOUCH2** | **in basso** | **A2** (`PB03`) | R35 | DL6 |
| **TOUCH3** | in basso a sinistra | **A3** (`PA04`) | R36 | DL7 |
| **TOUCH4** | in alto a sinistra | **A4** (`PA05`) | R37 | DL8 |

I numeri girano **in senso orario partendo da destra**, e sono quelli
serigrafati accanto a ogni pad: `00` in alto a destra, `04` in alto a
sinistra.

Dal pad al piedino c'è solo una resistenza da **zero ohm** (R33…R37 sono
ponticelli) e **nessun condensatore**: niente fra il dito e l'ADC, niente da
tarare. I numeri qui sono quelli della libreria, `TOUCH0`…`TOUCH4`; il
datasheet chiama gli stessi pad `TOUCH1`…`TOUCH5`, cioè uno in più ciascuno,
ed è il tipo di scarto che si paga con un tasto che fa la cosa del vicino.

**I LED seguono i pad, senza conversioni.** Nella catena APA102 il dato entra
in DL4 e passa di LED in LED fino a DL8, e sul rame DL4 sta accanto a TOUCH0,
DL5 accanto a TOUCH1, e così via: **il LED n è il LED del pad n**. Girano sul
**5 V**, che sul carrier è generato a bordo: la luminosità costa più di
quanto sembri, quindi accesi **piano** — non per eleganza.

**Il colore del LED non è quello della scritta.** I colori del vetro sono
scelti per un fondo nero — un rosso chiaro, un ambra tenue — e hanno tutti e
tre i canali accesi: `#E05252` è rosso solo accanto a qualcos'altro. Su un
LED grosso come una capocchia di spillo tre canali accesi fanno **bianco
rosato**, ed è la seconda cosa segnalata dalla prova sul vetro vero: «i LED
non hanno un colore ben definito». Il vetro vuole colori morbidi, il LED li
vuole **puri**, e si tengono bassi con un numero solo (`LUCE_LED`) invece di
dividere il colore: dividere abbassa anche la *differenza* fra i canali, e a
un sedicesimo un rosso e un ambra diventano lo stesso arancione sbiadito.

**Questa tabella era girata di mezzo giro, ed è il difetto più istruttivo
del progetto.** Fino al 2026-10-31 diceva «TOUCH2 è il pad in alto», e lo
diceva con sicurezza perché veniva dagli schemi Altium: letta nel rame, la
posizione di ogni pad era quella. Ma i pad sono rame sulla faccia **di
sotto**, e di sotto alto e basso, destra e sinistra sono il contrario — era
scritto anche qui, come cosa «da confermare con un'occhiata», insieme alla
rassicurazione che l'insieme delle posizioni è simmetrico e quindi al
massimo si scambia destra con sinistra. La simmetria c'era, il mezzo giro
no.

Risultato alla prima prova con la scheda in mano: **le parole da una parte
del vetro e il LED acceso dall'altra**. Nessun allarme, nessun errore: il
telecomando faceva esattamente quello che gli era stato detto.

La lezione non è «gli schemi sbagliano». È che **una cosa a cui si può
rispondere premendo un pad e guardando non va dedotta**: la deduzione era
giusta nel suo mondo e il controllo costava dieci secondi. Adesso la tabella
viene dalla scheda, il mock disegna i numeri serigrafati accanto ai pad per
poterla ricontrollare a occhio, e `mock-test.js` confronta la tabella del
banco con quella del firmware — che non le rende giuste, ma impedisce che
una venga corretta e l'altra no.

| Schermata | Tasti vivi |
|---|---|
| Pronta | nessuno — far partire una stampa senza guardare il foglio non è una comodità |
| In stampa | PAUSA · STOP |
| In pausa | RIPRENDI · STOP |
| Stop, primo tocco | ANNULLA · TIENI |
| Stop, tocco lungo | TIENI |
| Cambio penna, togli | FATTO |
| Cambio penna, monta | RIPRENDI · ABBASSA/E ALZA |
| Finita, errore, in attesa | nessuno |

Un tasto che in una schermata non fa niente **non ha etichetta e ha il LED
spento**: non per risparmiare, ma perché premerlo non farebbe niente, e un
tasto che a volte non fa niente senza dirlo insegna a non fidarsi dei tasti.

---

## Il firmware

Sta in `telecomando/telecomando.ino`, un file solo. È **scritto ma non
provato sulla scheda**: da dentro la sessione non si compila —
`downloads.arduino.cc` è bloccato come lo era `docs.arduino.cc`, quindi niente
`arduino-cli` e niente core SAMD. Quello che si è potuto fare è **togliere di
mezzo gli errori che non c'entrano con la scheda**:

- l'API è quella **vera**, letta dai sorgenti della libreria presi da GitHub
  (`arduino-libraries/Arduino_MKRIoTCarrier` 2.1.0), non ricordata;
- lo sketch **compila pulito** (`-Wall -Wextra`, zero avvisi) contro delle
  intestazioni finte che dichiarano quello che la libreria espone: non prova
  che funzioni, prova che non ci sono refusi, nomi sbagliati o funzioni usate
  prima di esistere;
- la **geometria del vetro è verificata leggendo il sorgente**: uno script
  ricava le parole di ogni schermata e le etichette dei tasti, rifà il conto
  con le misure del font di Adafruit_GFX e chiede che ognuna stia nel cerchio
  libero e non ne tocchi un'altra. Ha già trovato un difetto — in pausa la
  parola grossa arrivava addosso a STOP.

### Come si carica

1. **`arduino_secrets.h`**: la tua rete. Dev'essere la stessa del portatile, e
   a **2,4 GHz** — il MKR WiFi 1010 i 5 GHz non li fa.
2. **Gestore librerie:** *Arduino MKRIoTCarrier* (2.0.0 o successiva), che si
   tira dietro tutto il resto, e *WiFiNINA* se non c'è già.
3. **Scheda:** Arduino MKR WiFi 1010. Carica.
4. All'accensione il vetro scrive il proprio **indirizzo IP**: quello va
   copiato nelle impostazioni del SLICER. Senza, il SLICER non sa a chi
   parlare. Lo stesso indirizzo resta scritto sulla schermata «in attesa»,
   che è quella che vedi quando il portatile non c'è — cioè proprio quando
   lo devi copiare.

### Le tre cose che restano da tarare sulla scheda vera

| Cosa | Come | Dove si cambia |
|---|---|---|
| **La risonanza del cicalino** | una spazzata da 1 a 6 kHz: si sente dove grida | `RISONANZA`, un numero solo — l'ottava dei suoni lo segue |
| **Il partitore della batteria** | misura la 18650 col tester e confronta col grezzo che lo sketch stampa sul monitor seriale all'avvio | `K_PARTITORE` |
| ~~**Destra e sinistra dei pad**~~ | ~~un'occhiata alla scheda~~ | **fatto il 2026-10-31**, e non era una specchiatura: era mezzo giro |

### Tre cose che lo schema ha cambiato nel codice

- **`carrier.begin()` torna `false` se un sensore qualsiasi non risponde** —
  qualità dell'aria, pressione, luce. Al telecomando i sensori non servono:
  un telecomando che non parte per via del sensore di qualità dell'aria
  sarebbe una sciocchezza. Si guarda il valore, si scrive sul seriale e si
  tira dritto.
- **Il «preflight» del CORS non è una riga.** Prima di un POST con corpo JSON
  il browser manda un `OPTIONS` per chiedere il permesso, e se non gli si
  risponde **il POST non parte nemmeno**. Senza, il telecomando sembra morto
  pur essendo acceso e collegato.
- **Lo stop in due tempi collassava in uno.** Il dito che arma la domanda è
  ancora sul pad, quindi il secondo tempo cominciava a contare nello stesso
  istante del primo: «tocca e tieni» invece di «tocca, poi tieni», cioè
  esattamente la sicurezza che si voleva. Adesso aspetta il rilascio.

### Tutto il telecomando in una scheda sua

Dal 2026-10-31, nel SLICER, **Impostazioni → Telecomando**: l'indirizzo, il
collaudo e il dialogo stanno insieme invece che sparsi dentro a «Connessione».
È una scatola a parte — rete sua, collaudo suo, modi suoi di rompersi — e chi
non ce l'ha lascia l'indirizzo vuoto e non legge altro. Dentro ci sono tre
cose:

1. **La prova in bianco** (qui sotto): la recita intera, che va avanti da sola.
2. **Una schermata per volta**: un pulsante per ognuna delle dieci schermate,
   che la manda e **la tiene ferma** finché non ne premi un'altra. Serve a
   guardarla — i colori, le parole, il fulmine della carica, dove cascano le
   etichette — mentre con la recita bisognava aspettare il momento giusto e
   fotografarlo prima che passasse. Sono gli **stessi stati** che manda una
   stampa vera, e il telecomando non sa che è una prova: non c'è nessun campo
   che glielo dica. Un tasto premuto mentre una schermata è ferma **non fa
   niente e finisce nel registro**, che è il modo di vedere se quel pad
   risponde e che cosa manda. «Niente SLICER» non manda una schermata: **smette
   di mandare**, e dopo sei secondi è il telecomando a dirlo da sé.
3. **La spia del dialogo**: una spunta che scrive nel registro **ogni messaggio
   che esce (→) e ogni risposta che torna (←)**, più un «Manda adesso» per non
   aspettare il battito. Parte spenta e va tenuta spenta: a stampa in corso
   sono due messaggi e mezzo al secondo e il registro diventa illeggibile.
   Accesa, dice da che parte sta il guasto — se esce e non torna niente è la
   rete, se torna un tasto che la pagina non conosce è il firmware.

**Una stampa vera spegne qualunque prova.** Il controllo che si fa premendo
non basta: guarda il momento in cui premi, e se la stampa parte dopo il vetro
resterebbe a raccontare una recita mentre la macchina disegna davvero — con
scritto «pronta» e la penna che va.

E la riga di stato, sotto all'indirizzo, dice anche **come sta messo con la
corrente**, perché il telecomando lo manda insieme alla carica: «in carica»,
«carica finita», oppure «ATTACCATO MA NON CARICA», che è la cosa che da soli
non si scoprirebbe mai.

### La prova in bianco

Impostazioni → Telecomando → **Prova in bianco**. Il
SLICER **recita una stampa intera** — pronta ma da azzerare, pronta, in stampa
con la penna nera, cambio penna in due passi con la penna rossa, di nuovo in
stampa, finita, errore — e in fondo **smette di chiamare**, perché «senza
SLICER» è l'unica schermata che non si può provare mandando qualcosa. Un
minuto, e si sono viste tutte e dieci le schermate, sentiti i quattro suoni e
premuti i cinque tasti. Senza, per vederle ci vogliono venti minuti di stampa
e un foglio.

**I tasti non escono dalla prova.** Non è prudenza, è il punto: se «riprendi»
finisse al Sender mentre si recita una stampa che non esiste, la prova in
bianco sarebbe l'unica cosa del progetto capace di far partire una stampa
vera. Li consuma la recita, e premere PAUSA ferma anche il copione — se no
premerlo non si vedrebbe, perché un attimo dopo la stampa finta sarebbe andata
avanti lo stesso. Il tasto PROVA, che sulla macchina muove il servo, qui dice
soltanto che non lo muove.

La prova **si rifiuta di partire** se c'è una stampa in corso, e senza
indirizzo non parte perché non c'è nessuno a cui recitare. `prova-test.js`, 24
asserzioni, di cui una sola conta davvero: che per tutta la recita il Sender
non si sia mosso.

### La penna si sceglie, non si deduce soltanto

Dal 2026-10-31 il colore di un livello si può **scegliere**: nell'elenco dei
livelli il pallino della penna si apre passandoci sopra, e dà le penne che hai
in cassetto — nero, blu, rosso, grigio — più un «+» per aggiungerne. La
scelta **copre** la tinta del file senza cancellarla: «rimetti il colore del
file» la fa riapparire. Serve perché il colore con cui un disegno è stato
fatto e la penna con cui lo stampi sono due cose diverse — un logo nero si
può voler stampare in rosso — e perché un livello disegnato a mano non ha
nessuna tinta da cui dedurre niente.

Le penne stanno nel **browser**, non nel profilo della macchina: sono di chi
stampa, non della macchina. E al cambio penna la finestra le chiama **col nome
che hai dato loro** — «monta la rossa» si capisce senza guardare, «#c8102e»
no. Al telecomando arriva il colore, che sul vetro è un pallino.

### La prima stampa vera, 2026-10-31

Il biglietto, due colori, portato a termine **senza toccare il portatile**:
è il criterio di completamento dello Step 9, ed è passato. Tre cose da
sistemare, e nessuna fermava la stampa.

1. **RIPRENDI dopo il cambio penna non faceva niente.** Non era il tasto né
   il pad: era il SLICER. `premuto('riprendi')` durante un cambio penna
   chiamava `Popup.telecomando('apri')` — che la finestra la *apre* — ma
   quando il telecomando mostra RIPRENDI la finestra è già aperta al secondo
   passo: è proprio da lì che sa di doverlo mostrare. Riapriva una finestra
   aperta. Adesso entra come `'avanti'`, che è la stessa strada del pulsante
   della pagina (e la finestra la apre lo stesso, se era stata rimandata).

   **La prova in bianco non poteva prenderlo**, ed è la cosa da ricordare:
   lì «avanti» e «riprendi» finiscono tutti e due nello stesso posto, perché
   la recita deve solo avanzare. Era giusto per la prova e sbagliato come
   garanzia. Il collaudo nuovo (`riprendi-test.js`, 15 asserzioni) passa
   dalla strada vera, quella di un tasto arrivato dalla rete, e con il
   codice di prima fallisce.

2. **PROVA non si capiva.** Adesso l'etichetta è su due righe —
   **ABBASSA / E ALZA** — che è quello che fa: il servo scende alla quota di
   contatto e risale. Il comando che viaggia resta `prova`, perché è il
   protocollo. Per fare spazio alle due righe, in quella schermata il
   simbolo e la parola MONTA salgono di quattordici pixel: la parte alta del
   vetro lì è vuota, perché il sesto posto — quello in alto — non ha pad.

3. **Sfarfallio premendo STOP**, «come se prima di far uscire la schermata
   dello stop passasse per altre». Passava davvero: il giro del `loop()`
   decideva la schermata **prima** di leggere i tasti, quindi la pressione
   arrivava dopo e nel frattempo si ridisegnava per intero la schermata
   della stampa — anello compreso — e solo al giro dopo quella dello stop.
   Due schermate intere una dietro l'altra. Adesso il dito si legge prima.
   Nello stesso punto: l'anello non si disegna più due volte (prima tutto
   spento, poi la parte accesa sopra), e i pixel pieni si scrivono di fila
   invece che uno per uno — undici byte di indirizzo per due di colore erano
   il grosso del tempo.

### Il vetro disegnato qui dentro: `vetro/`

`mock.html` è il banco di **disegno**: SVG, quindi curve lisce e font veri.
Il vetro è un'altra cosa — pixel interi, un font 6 × 8 e nessun antialiasing
— e fra le due cose ci stanno esattamente i difetti che si sono visti alla
prima accensione. Per vederli *prima*, `vetro/` compila **il firmware vero**
con un finto display che scrive in memoria e salva una immagine per
schermata:

```
cd schermo/vetro && ./vetro.sh        # un PPM per schermata + confronto.png
```

Non emula tutto: le lettere sono **blocchi** larghi quanto la lettera vera,
perché il font di Adafruit_GFX qui non c'è. Per la geometria è abbastanza — è
la stessa misura che fa `fw-geometria.py` sul sorgente, ma guardabile — e per
l'anello, lo spicchio e i rettangoli che cancellano è **esatto**: quei pixel
li calcola il firmware, non il banco.

È così che si sono visti, senza riaccendere la scheda: i buchi dentro
all'anello disegnato a raggi, la banda nera che lo tagliava in basso, e
l'etichetta TIENI che finiva **sopra** allo spicchio rosso — rossa su rosso,
cioè invisibile, un difetto che nessuno aveva ancora notato perché per
vederlo bisogna tenere premuto lo stop.

### La prima prova sul vetro vero, 2026-10-31

Cinque cose, e nessuna era un errore di calcolo:

1. **L'anello seghettato.** Era previsto in questo file come inevitabile. Non
   lo era: vedi «I tre vincoli che comandano la grafica».
2. **L'anello spezzato in basso.** Non dall'anello: dal **rettangolo nero**
   che cancella il tempo che resta prima di riscriverlo. Gli angoli di un
   rettangolo stanno più in là dei suoi lati, e quell'angolo cadeva a 106
   pixel dal centro, cioè dentro all'anello, che comincia a 95,5. Adesso
   quanto si cancella a una certa altezza lo decide il cerchio (`pulisci()`),
   non il testo.
3. **I LED senza un colore definito.** Vedi «I cinque tasti».
4. **I tasti dalla parte sbagliata.** Mezzo giro. Vedi «I cinque tasti».
5. **«C'è una scritta PROVA che non capisco».** PROVA è un tasto — abbassa e
   rialza la penna appena montata — ma stava sulla stessa riga del pallino
   del colore, e i due letti di fila diventavano una didascalia: «pallino
   PROVA». Col LED acceso dalla parte opposta del vetro (difetto 4) non
   restava niente che lo facesse sembrare un tasto. Adesso il pallino sta
   **accanto alla parola MONTA**, dove dice quello che deve dire — di che
   colore è la penna da montare — e la riga in basso torna a essere dei
   tasti.

---

## Quello che manca

1. ~~La corrispondenza numero ↔ posizione dei pad~~ — **chiusa il 2026-10-29**
   dagli schemi Altium, e **sbagliata**: girata di mezzo giro, perché i pad
   stanno sul rame di sotto. Chiusa davvero il **2026-10-31**, premendo i pad
   e guardando i LED. La storia per intero è in «I cinque tasti»: è il
   difetto da cui questo progetto ha imparato di più.
2. ~~Il colore della penna corrente nel messaggio~~ — **fatto il 2026-10-29**.
   Non è bastato spedirlo: il colore stava solo nella pagina, e un programma
   salvato e riaperto un altro giorno non se lo portava dietro. Adesso viaggia
   **dentro al G-code**, in un commento `;PENNA <colore> <nome del livello>`
   che il generatore scrive all'inizio di ogni livello e che il Sender legge
   come legge già `;PAUSA`. È scritto **prima** della pausa, non dopo: al
   cambio penna il Sender si ferma sul segno e non legge più niente, quindi un
   colore scritto dopo arriverebbe solo alla ripresa — cioè quando non serve
   più. Scritto prima, al momento in cui si chiede «quale monto?» la risposta
   è già arrivata. Si vede in tre posti: il pallino nell'elenco dei livelli,
   la riga in cima al secondo passo del cambio penna, e il campo `penna` nel
   messaggio. Un livello disegnato a mano nell'editor non ha tinta: lì il
   colore è `null` e non si mostra niente, che è meglio di un nero inventato
   — vorrebbe dire «monta la penna nera». `colore-test.js`, 22 asserzioni.
3. ~~Il lato SLICER~~ — **fatto il 2026-10-28**, `webui/js/telecomando.js`.
   Indirizzo nelle impostazioni (vuoto = spento), `POST /stato` col suo
   ritmo, pila in alto solo quando il telecomando ha risposto, e i tasti che
   entrano dalla stessa porta da cui entrerebbe un dito sulla pagina. Il
   collaudo gira contro un telecomando finto: `tele-test.js`, 37 asserzioni.

   **Il messaggio, com'è adesso:**

   ```
   POST /stato
   { v:1, stato, nome, percento, rimanente, penna, passo, macchina,
     azzerata, data }
     → 200  { tasto, batteria, carica }
   ```

   `tasto` vale `pausa`, `riprendi`, `stop`, `avanti`, `prova`, o niente.
   `penna` è `{colore, nome}` oppure null, e al cambio penna è già quella
   **nuova** — è la risposta alla sola domanda che ci si fa in quel momento.
   `passo` è 0 o 1 durante il cambio penna, altrimenti null. `rimanente` è in
   millisecondi e **null finché il Sender non l'ha misurato**.

   Due cose imparate scrivendolo:
   - **Il battito è di due velocità**: 400 ms quando c'è qualcosa in corso,
     2 s a riposo — perché a riposo non c'è niente da raccontare ma bisogna
     comunque accorgersi che qualcuno ha premuto.
   - **Un cambio di stato non aspetta il prossimo giro, ma la percentuale
     non è un cambio di stato.** Metterla fra le cose urgenti voleva dire
     cento messaggi in più per stampa, per dire una cosa che il battito
     racconta comunque due decimi dopo. Trovato dal collaudo, che contava le
     chiamate.
4. ~~Il firmware~~ — **scritto il 2026-10-29**, `telecomando/telecomando.ino`:
   vedi «Il firmware» qui sopra. Resta da **compilarlo e caricarlo**, che è
   l'unica cosa che da dentro la sessione non si può fare.
5. ~~La grafica va confermata sul vetro vero~~ — **confermata il 2026-10-31**,
   e ha detto cinque cose: vedi «La prima prova sul vetro vero». Quattro
   erano difetti veri, la quinta una parola che non si capiva. Da allora
   `vetro/` disegna le schermate **come le disegna il firmware**, quindi la
   prossima volta la scheda serve per quello che solo lei può dire: come si
   legge da un metro, con la luce di casa, con le dita vere.

### Una strada scartata, per memoria

Il 2026-10-28, prima che saltasse fuori il carrier, l'ipotesi era un pannello
**GC9A01** da 1,28" pilotato dal **secondo ESP32** (quello del 2026-09-21, in
cassetto). Funzionava e costava zero, ma: niente tasti, niente batteria,
cinque fili SPI dal box al coperchio accanto ai cavi dei motori, e un firmware
da scrivere da capo. Il carrier le risolve tutte e quattro. Il pannello
GC9A01 resta comprato e buono per altro.
