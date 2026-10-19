# Pannello di controllo manuale GDC CNC 2D — ESP32 (strumento di collaudo)

> **Questo non è il firmware definitivo della macchina.** Il firmware finale è FluidNC,
> vedi `firmware/fluidnc/`. Questo sketch resta come **banco di collaudo dell'hardware**:
> serve a verificare il cablaggio, provare un driver nuovo, misurare i pin col multimetro
> e far girare i motori senza G-code. È lo strumento che ha permesso di individuare un
> driver con l'ingresso STEP in corto, e va tenuto per ogni volta che si tocca il cablaggio.

Dashboard web servita direttamente dall'ESP32, con controllo dei LED, configurazione Wi-Fi
da browser, log remoto, movimento manuale dei due assi e diagnostica dei pin.

## Hardware richiesto

- ESP32 alimentato via USB o batteria+interruttore (come da bring-up già completato)
- LED rosso + resistenza 220 ohm su D2 (GPIO2)
- LED verde + resistenza 220 ohm su D18 (GPIO18)
- LED giallo + resistenza 220 ohm su D19 (GPIO19)
- Driver A4988 motore X (carrello sulla trave, sinistra/destra sul foglio): STEP su D4, DIR su D26
- Driver A4988 motore Y (portale sulle rotaie, basso/alto sul foglio): STEP su D25, DIR su D33
- ENABLE su D27, condiviso tra i due driver (come sulle schede CNC commerciali: non ha
  senso tenere un asse energizzato e l'altro no)
- **Condensatore elettrolitico da 100 µF / 35 V (minimo 47 µF) tra VMOT e GND del driver**,
  il più vicino possibile al modulo. Non è opzionale: senza di esso i picchi induttivi
  generati dalle bobine a ogni commutazione possono distruggere l'A4988.
- Servo per il pen-lift: segnale su D32, alimentazione 5 V **separata** dalla logica
  (un servo assorbe a strappi e può far cadere la tensione all'ESP32), massa in comune,
  più un condensatore elettrolitico sulla sua alimentazione: 100 µF basta per un SG90,
  un servo metal-gear da 15 kg ne vuole 470÷1000 µF e un alimentatore dedicato da 2 A.

## Librerie

Nessuna installazione extra: `WiFi.h`, `WebServer.h`, `Preferences.h`, `ArduinoOTA.h` sono
incluse nel core ESP32 per Arduino (Boards Manager → "esp32" di Espressif).

## Primo upload

Il primo caricamento del firmware richiede sempre il cavo USB (come previsto dalla vision
del progetto). Seleziona la board ESP32 corretta (es. "ESP32 Dev Module"), la porta seriale,
e carica lo sketch.

## Primo avvio (nessuna rete Wi-Fi salvata)

Alla primissima accensione l'ESP32 non ha ancora credenziali Wi-Fi salvate, quindi apre
un proprio Access Point di emergenza:

- SSID: `CNC-2D-Setup`
- Password: `cnc2d2026`

Collegati a questa rete da telefono o PC e apri `http://192.168.4.1` (indirizzo mostrato
anche sul Serial Monitor a 115200 baud). Vai nella tab **Wi-Fi**, inserisci nome e password
della rete di casa e premi "Salva e riavvia": l'ESP32 salva le credenziali in memoria non
volatile e si riavvia connettendosi alla rete di casa.

## Uso normale (connesso alla rete di casa)

Una volta collegato alla rete di casa, la dashboard è raggiungibile da qualsiasi dispositivo
sulla stessa rete su:

- `http://cnc2d.local` (via mDNS, consigliato — resta valido anche se cambia l'IP)
- oppure l'IP mostrato sul Serial Monitor / nella pagina del router

### Tab Controllo

Frecce sinistra/destra: pilotano il motore X. Frecce su/giù: pilotano il motore Y.
Un click singolo fa avanzare il motore di un singolo microstep; tenendo premuto (dopo ~300ms)
il motore continua a girare finché non si rilascia il pulsante.

**Attenzione al click singolo**: con i microstep a 1/16 un passo vale **0,029 mm**, quindi
non si vede muovere niente. Non è un guasto, è la risoluzione della macchina — ed è il
comando giusto per misurare il gioco d'ingranamento. Per vedere il movimento si usa la
pressione prolungata, il pulsante "1 giro", o la distanza in millimetri nella tab Motore.
La riga sotto il joystick riporta sempre quanto vale un click e quanto vale un giro,
calcolati sui microstep impostati.

Pulsante centrale del joystick: alza e abbassa la penna. L'etichetta mostra lo stato
corrente (`PENNA` = alzata o rilasciata, `GIÙ` = appoggiata).

Pulsanti `1 giro`: disposti attorno alle frecce, ciascuno fa compiere **un giro di pignone**
all'asse e nel verso della freccia che affianca. Il numero di impulsi lo calcola il firmware
dai microstep impostati (200 a passo intero, 3200 a 1/16), e con pignone m1,5 z20 un giro
vale **94,2478 mm di corsa**: non è un movimento piccolo, tienilo presente su una macchina
senza fine corsa. Il pulsante STOP ferma entrambi gli assi e interrompe la prova d'insieme.

**Penna (servo)**: slider dell'angolo dal vivo — il servo segue il dito mentre trascini,
senza salvare niente. Serve a vedere dove finisce la penna e a trovare gli estremi utili
prima di fissarli. Gli angoli di lavoro (alzata/abbassata) si tarano e si salvano nella
tab Motore; questo slider non li tocca.

**Prove d'insieme**: due pulsanti, `Quadrato 40 mm` e `Cerchio R20`, che eseguono le stesse
due figure dei file in `gcode/test/` — penna compresa, stesse pause — senza interprete G-code.
Partono dal punto in cui si trova la macchina e ci tornano alla fine. Servono solo a vedere
i due assi e il servo muoversi insieme prima di montare: non si usano a macchina smontata
se i motori sono vincolati a qualcosa. `INTERROMPI PROVA` le ferma.

Pulsanti Rosso/Giallo/Verde: accendono/spengono rispettivamente i LED su D2, D19, D18,
per verificare che la dashboard comunichi correttamente con l'ESP32 e per avere indicatori
di stato distinti quando inizieremo a pilotare i motori.

Nota sulla direzione: se un asse risulta invertito rispetto a quanto ti aspetti, non serve
toccare i cavi né il codice — usa la spunta "Inverti direzione" nella tab Motore.

### Tab Motore (diagnostica)

Divisa in due colonne, una per asse, ciascuna con i propri parametri — X e Y avranno masse
diverse una volta montata la meccanica, quindi vogliono regolazioni indipendenti.

- **Microstep del driver** (in cima alla tab, comune ai due assi): 1, 1/2, 1/4, 1/8, 1/16,
  1/32. È l'unica cosa del cablaggio che il firmware non può leggere da solo, perché dipende
  dai ponticelli MS1/MS2/MS3 sul driver. Da qui discendono passi/mm, il giro completo e la
  conversione delle velocità, quindi è il primo valore da sistemare. Verifica rapida: premi
  "1 giro" e guarda l'albero — se fa un giro intero il valore è giusto, se ne fa un
  sedicesimo i ponticelli sono a 1/16 e qui c'è ancora 1. Salvato in memoria non volatile.
- **Velocità** (1–100 mm/s): millimetri al secondo di **corsa del carrello**, non passi al
  secondo. La conversione la fa il firmware: con pignone m1,5 z20 un giro vale 94,2478 mm,
  quindi a 1/16 servono 33,953 passi/mm. C'è comunque un tetto di 6000 impulsi/s a valle di
  qualunque conto, che a 1/32 limita la velocità massima effettiva a ~88 mm/s.
- **Accelerazione** (0–20 mm): su quanti millimetri si distribuisce la partenza. Il primo
  passo parte 4 volte più lento della velocità impostata e si accelera linearmente fino
  ad essa. A 0 la partenza è secca — utile per verificare fino a dove il motore aggancia
  da fermo, ma un motore fermo che non aggancia la frequenza di partenza si limita a vibrare.
- **Distanza (mm)**: quanti millimetri percorrere col pulsante di quella colonna.
- **Inverti direzione**: ribalta il verso di quell'asse. Serve quando, montata la meccanica,
  un asse si muove al contrario rispetto alla freccia premuta: si risolve con una spunta
  invece di riaprire il cablaggio. L'impostazione è salvata in memoria non volatile e
  sopravvive ai riavvii.
- **Esegui i due assi insieme**: fa partire entrambi contemporaneamente, ciascuno con i
  propri parametri. Serve anche a verificare che l'alimentatore regga il consumo dei due
  motori in movimento.
- **Driver abilitati**: agisce direttamente sul pin ENABLE condiviso. Serve anche come verifica:
  togliendo la spunta i motori devono sbloccarsi (si girano a mano liberamente). Se restano
  bloccati, il segnale ENABLE non sta arrivando ai driver.
- **Test pin** (sezione richiudibile): forza STEP/DIR/EN a un livello fisso per misurarli
  col multimetro sul pin del driver.

La sezione **Penna (servo) — taratura** ha due slider per tarare l'angolo di penna alzata e
penna abbassata: rilasciando uno slider il servo si porta subito su quell'angolo, così si
regola guardando la penna invece che a tentativi. I due valori sono salvati in memoria non
volatile e sono quelli che usano il pulsante PENNA e le prove d'insieme. Lo slider libero
della tab Controllo serve invece a esplorare, e non salva niente.

Il terzo slider, **Movimento morbido**, limita la velocità con cui il servo insegue
l'angolo richiesto: da 1 a 20 gradi ogni 10 ms, con 0 che disattiva la rampa e torna al
salto secco. Serve contro il brownout: un servo a cui si chiede un angolo lontano vede un
errore grande e parte alla corrente di stallo (700 mA per un SG90, fino a 1,4 A per un
MG90S), e su un'alimentazione condivisa quel gradino fa cadere il 5 V e resetta l'ESP32 —
che smettendo di generare il PWM lascia il servo fermo a metà. Avvicinandosi di due gradi
per volta l'errore resta piccolo e la corrente di picco con lui.

**Non sostituisce un'alimentazione adeguata**, e va detto chiaramente: la rampa abbassa il
picco, non il consumo totale, che anzi dura più a lungo. Se la sorgente non regge nemmeno
la corrente di mantenimento non c'è impostazione che tenga. È però una diagnosi netta: se a
1 grado per passo non si resetta e a 0 sì, il colpevole è la corrente ed è certificato.

Limite noto della rampa: ripartendo da "Rilascia" la posizione reale della squadretta non la
sa nessuno, perché un servo RC non ha retroazione leggibile. La rampa riparte dall'ultimo
angolo comandato, che è la stima migliore disponibile; se nel frattempo la squadretta è
stata mossa a mano, quel primo movimento resta secco.

Le prove d'insieme tengono conto della rampa: aspettano che la penna sia **arrivata** prima
di far ripartire i carrelli, e solo dopo scatta la pausa di assestamento da 300 ms.
"Rilascia" toglie il segnale PWM e il servo si ammorbidisce, smettendo di consumare e
scaldare. **All'accensione il servo parte rilasciato** e non si muove finché non glielo si
chiede: un servo che va in battuta contro un vincolo meccanico appena riceve corrente
assorbe moltissimo.

Ogni comando viene registrato nella tab Log, con il conteggio dei passi effettivamente
emessi a fine movimento: se il log dice "200 passi emessi" ma l'albero non ha fatto un giro,
il problema è meccanico/elettrico a valle del driver, non nel firmware.

### Come vengono generati i passi

Dalla versione con i microstep attivi gli impulsi **non** escono più da `loop()`. A 1/16 la
frequenza sale a qualche migliaio di impulsi al secondo, e `server.handleClient()` può
bloccare il loop per centinaia di millisecondi: ogni blocco diventava un buco nel treno di
impulsi, cioè passi persi — e un quadrato che non si chiude. Ora gli impulsi li emette un
**timer hardware a 20 kHz** che il traffico web non può interrompere; `loop()` si occupa
solo di web, OTA e dell'avanzamento della prova d'insieme da un tratto al successivo.

Ogni asse usa un accumulatore a virgola fissa: a ogni scatto del timer somma il proprio
incremento e, quando supera l'unità, esce un impulso. Così la frequenza media è esatta anche
quando non è un sottomultiplo del tick, invece di essere arrotondata al tick più vicino.

Se i tre ponticelli MS1/MS2/MS3 non sono fissi a 5 V ma portati in parallelo a un GPIO
dell'ESP32, basta mettere quel GPIO in `MS_PIN` in cima allo sketch: il firmware lo porta
alto per 1/16 e basso per il passo intero. Lasciato a `-1` non viene pilotato nessun pin e
il valore scelto dalla pagina serve solo ai conti.

### Calcolo del Vref (importante)

La corrente per fase impostata dal trimmer dipende dalle resistenze di shunt montate sul
modulo, che variano tra produttori:

    Vref = corrente_per_fase × 8 × R_shunt

I valori sono stampati sui due piccoli componenti SMD vicini al bordo del modulo:
`R050` = 0,05 Ω, `R068` = 0,068 Ω (Pololu), `R100` = 0,1 Ω, `R200` = 0,2 Ω.

Per un motore da 0,7 A/fase: 0,38 V con R068, 0,56 V con R100, **1,12 V con R200**.
Usare il valore sbagliato significa alimentare il motore a metà (o al doppio) della
corrente prevista — nel primo caso il motore fa singoli passi ma stalla appena si prova
a farlo girare in modo continuo.

### Il fischio a motore fermo

Appena arrivano i 12 V i motori emettono un fischio sottile e costante, anche
se nessuno ha dato un comando. È il comportamento previsto, non un guasto.

L'A4988 non alimenta il motore a tensione costante: regola la **corrente** di
fase spegnendo e riaccendendo l'avvolgimento qualche decina di migliaia di
volte al secondo (controllo a off-time fisso). Ogni ciclo fa oscillare la
corrente intorno al valore impostato dal trimmer, e quell'oscillazione mette in
vibrazione le lamiere dello statore: il motore funziona da altoparlante
pilotato alla frequenza di chopping, che cade a cavallo del limite superiore
dell'udibile — da qui il timbro da fischio e non da ronzio.

La coppia di tenuta richiede corrente anche a motore fermo, quindi il chopping
non si interrompe mai mentre ENABLE è attivo. E `driverEnabled` parte a `true`,
con ENABLE (attivo basso) portato a 0 V in `setup()`: per questo il fischio
comincia all'accensione e non al primo movimento.

**La prova che è questo e non altro:** togliere la spunta a "Driver abilitati"
nella tab Motore. ENABLE va alto, i ponti si aprono, il chopping cessa e il
fischio deve spegnersi di colpo. Se sparisce, è il chopper. Se resta, viene da
altro — tipicamente l'alimentatore a 12 V, che è uno switching e ha un suo
trasformatore che può cantare a basso carico.

Quando invece **non** è normale:

| Suono | Causa probabile |
|---|---|
| fischio sottile e costante, a motore fermo | chopping: normale |
| timbro che cambia durante il movimento | normale: la frequenza di chopping varia con la corrente richiesta dal microstep |
| ronzio ruvido che cambia spingendo il carrello a mano | il driver sta perdendo la regolazione |
| ticchettio lento e ripetitivo | protezione in hiccup: un ramo di alimentazione va in crisi |
| raspata sincronizzata col movimento | passi persi o risonanza meccanica |

Due modi per attenuarlo, se dà fastidio:

- **Abbassare la corrente** col trimmer, fino al minimo che muove il carico in
  modo affidabile (vedi il calcolo del Vref sopra). Meno corrente vuol dire
  meno ampiezza di oscillazione, quindi meno fischio e meno calore.
- **Disabilitare i driver a riposo.** Oggi va fatto a mano con la spunta. Un
  timeout automatico sarebbe l'equivalente di `idle_time` in FluidNC, ma va
  deciso con cura: a driver disabilitati l'asse non è più tenuto in posizione e
  si sposta a mano, quindi ha senso solo a macchina parcheggiata, mai fra due
  tratti dello stesso disegno.

Il motore tiepido a riposo è normale, per lo stesso motivo: la corrente di
tenuta scorre sempre. Troppo caldo per tenerci un dito sopra vuol dire trimmer
troppo alto.

## Misurare gli assi: posizione e taratura del rapporto

Aggiunto il 2026-10-19. Serve a produrre due numeri per asse che poi finiscono
nel profilo del GDC CNC 2D SLICER: la **corsa utile** e i **passi/mm reali**.

### La posizione

Nella tab **Controllo** c'è il riquadro *Posizione*, che mostra per X e Y quanto
l'asse si è spostato dall'ultimo azzeramento, con il segno delle frecce (freccia
destra = X che sale, anche con "inverti direzione" attivo).

Non è un riferimento macchina: conta i passi comandati, non sa dove si trova
davvero il carrello, e si perde allo spegnimento. Serve a **misurare**.

Quando quel conteggio non vuol dire niente, il riquadro **lo dice**: invece del
numero compare *«— non nota»* in arancione. Succede all'accensione — appena
acceso nessuno sa dove sono i carrelli — e ogni volta che i motori vengono
liberati. Un numero sbagliato è peggio di nessun numero: il contatore conta gli
impulsi *mandati*, quindi dopo uno spostamento a mano mostrerebbe con tre
decimali una posizione che non esiste più.

**Per la corsa utile di un asse:**

1. Portalo a un estremo. Vicino a fine corsa passa al passo singolo, che a 1/16
   vale 0,029 mm: non si vede muovere niente, ed è il punto.
2. **Azzera X** (o Y).
3. Portalo all'altro estremo, di nuovo a passo piccolo sul finale.
4. Leggi il numero. Quello è `max_travel_mm` di quell'asse, e nel profilo del
   SLICER va inserito **meno un margine di sicurezza**.

### L'homing a mano

Non ci sono finecorsa. Il riferimento sono i **blocchi stampati agganciati alle
staffe TT e LL**, contro cui i carrelli si appoggiano — **a mano**, non col
motore. Il motivo non è la comodità: la coppia di uno stepper basta a spostare
il blocco, cioè a spostare proprio la cosa che definisce la misura. A mano si
appoggia e basta, senza forzare niente e senza far strisciare i cuscinetti.

Nel riquadro *Posizione* ci sono due pulsanti, e **l'ordine conta**:

1. **Libera i motori.** I driver si spengono, gli assi diventano morbidi, la
   posizione viene dichiarata non nota. Se c'era un'origine valida, chiede
   conferma prima di buttarla.
2. Appoggi i due carrelli ai blocchi, senza forzarli.
3. **Homing completato.** Riattiva i motori **e poi** azzera, in quest'ordine.
   Al contrario — azzerare con i motori ancora liberi — l'origine resterebbe
   alla mercé del primo urto senza che nessuno lo dica.

Finché i motori sono liberi, i comandi di movimento rispondono *«motori
liberi»* invece di fingere di muoversi, e anche l'azzeramento normale viene
rifiutato rimandando a *Homing completato*.

**I due numeri da prendere quando i blocchi sono montati:**

- **La corsa disponibile dall'home.** Appoggia al blocco, *Homing completato*,
  porta l'asse all'altra battuta a passo piccolo sul finale, leggi. Lo
  scostamento del blocco dalla battuta è la corsa totale meno questa.
- **La ripetibilità dell'appoggio — col calibro, non col DRO.** Per ripetere
  l'appoggio bisogna liberare i motori, e liberare i motori cancella quello che
  il contatore sa: non c'è ordine delle operazioni che lo aggiri. Si fissa un
  riferimento, si appoggia il carrello e si misura col calibro la distanza fra
  riferimento e faccia del carrello; cinque o sei appoggi, allontanando ogni
  volta. Quella dispersione è il margine di sicurezza minimo.

Due avvertenze sullo spostamento a mano:

- **Non forzare mai un asse con i driver attivi.** Uno stepper alimentato tiene
  la posizione con coppia, e spingerlo contro quella coppia stressa il driver.
- **Piano, non a strappi.** Un motore mosso a mano si comporta da generatore e
  rimanda tensione nel driver. A velocità di braccio è trascurabile, ma non c'è
  motivo di lanciarlo.

### La taratura del rapporto

Nella tab **Motore**, dentro ciascuna scheda d'asse, c'è *Rapporto tarato*.

Il nominale è `π · modulo · denti = π · 1,5 · 20 = 94,2478` mm per giro di
pignone, da cui 33,953 passi/mm a 1/16. Ma le due cremagliere sono state
stampate separatamente e si sono ritirate di quantità diverse, quindi **i due
assi hanno due numeri diversi** — ed è il motivo per cui ogni asse ha il suo
campo invece di un valore globale. Con un numero solo i quadrati escono
rettangoli.

**Come si misura:**

1. Scrivi nel primo campo quanti millimetri comandare. Il valore di partenza è
   200: **tienilo lungo**. Su 200 mm un decimo di errore di lettura del calibro
   vale lo 0,05%, su 20 mm vale lo 0,5%.
2. Premi la freccia dell'asse per far fare quel movimento, **in un senso solo**.
   Senza tornare indietro: il ritorno ci metterebbe dentro anche il gioco, che è
   un'altra cosa e si misura a parte.
3. Misura col calibro quanto si è spostato davvero e scrivilo nel secondo campo.
4. **Calcola e salva.** Il conto è `mm/giro nuovo = mm/giro vecchio × misurato /
   comandato`, il risultato va in NVS e resta anche dopo lo spegnimento.

Il log scrive i due numeri, il risultato e di quanto si scosta dal nominale.
Un valore fuori dalla forchetta 60÷130 mm/giro viene **rifiutato**: a quel punto
non è un ritiro di stampa, è un errore di battitura in uno dei due campi.

"Nominale" riporta l'asse a 94,2478 e perde la taratura, con conferma.

Salvando, la posizione di quell'asse si azzera: contava in passi col rapporto
vecchio, quindi in millimetri vorrebbe dire un'altra cosa.

### Cosa è cambiato nel firmware

- `stepsPerMm()` **non esiste più come valore globale**: ora è `stepsPerMm(m)`,
  una per asse. Toccava sei punti del codice, fra cui la conversione dei
  movimenti e la prova d'insieme, che ora converte i due assi separatamente.
- Nuovi campi NVS: `mmRevX` e `mmRevY`.
- Nuove rotte: `/api/motor/zero`, `/api/motor/calib`, `/api/motor/mmrev`.
- Il JSON di stato porta `pos`, `posSteps`, `mmPerRev` e `spmm` dentro ciascun
  asse, e `mmPerRevNom` in cima.

## Aggiornamenti firmware via Wi-Fi (OTA)

Dopo il primo caricamento via USB, i successivi aggiornamenti del firmware possono essere
fatti via Wi-Fi, senza cavo: una volta che l'ESP32 è connesso alla rete di casa, in Arduino
IDE vai su Strumenti → Porta e seleziona la voce di rete (tipo "cnc2d at 192.168.x.x").
Premi Upload come al solito: ti verrà chiesta la password OTA, che è la stessa
dell'Access Point di emergenza (`cnc2d2026`).

Nota: l'OTA funziona solo quando l'ESP32 è già connesso alla rete di casa (modalità STA).
Se è in modalità `CNC-2D-Setup` (nessuna rete configurata o credenziali errate), serve
ancora il cavo USB per il primo caricamento.

### Tab Log

Mostra in tempo reale (aggiornamento ogni 2 secondi) gli stessi messaggi che finora
si vedevano solo sul Serial Monitor via USB — utile soprattutto dopo il primo aggiornamento
OTA, quando il Serial Monitor di Arduino IDE non è più disponibile perché la connessione
è via Wi-Fi e non via cavo. Il log tiene in memoria solo le ultime righe (circa 4000
caratteri): non è un log persistente, si azzera a ogni riavvio dell'ESP32.

### Tab Wi-Fi

Permette di cambiare SSID/password in qualsiasi momento, senza dover ricollegare l'ESP32
al PC. Se le nuove credenziali (o una password di casa cambiata) impediscono la connessione,
l'ESP32 torna automaticamente in modalità `CNC-2D-Setup` al riavvio successivo, così la
pagina resta sempre raggiungibile per correggerle.

### Tab Codice

Placeholder per ora. Il piano è di usarla in futuro per caricare direttamente un file G-code
dal browser, una volta validati motori (Step 2) e servo/pen-lift (Step 3) — non richiederà
un compilatore a bordo, solo l'upload del file che verrà poi eseguito dal firmware.
