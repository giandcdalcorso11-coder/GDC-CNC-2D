# Documento di Sessione — CNC 2D Plotter

**Versione:** 62
**Ultimo aggiornamento:** 2026-10-29 16:20

## Regole di co-editing

Questo documento è scritto da **tre sessioni Claude Code in parallelo**: una sul fronte **meccanica/firmware**, una sul fronte **contenuti e serie social**, e (dal 2026-10-29) una sul fronte **stampe: i disegni e i file SVG che l'utente manda in stampa** (magneti della lavagna d'allenamento, per ora). Ogni sessione può lavorare sul proprio branch: la regola vale comunque, perché le voci si fondono. Per non perdere voci a vicenda:

1. **`git fetch` e rebase prima di scrivere, push subito dopo.** Non lasciare modifiche locali non pushate: la finestra di collisione è tutta lì.
2. **Marca la voce di storico con il fronte di lavoro**, es. `### [2026-09-26 17:48] (meccanica) …`; il fronte della terza sessione è `(stampe)`. Due sessioni diverse sono due voci diverse: la regola "una voce per sessione" non impone di fonderle.
3. **Le note dei singoli Step si appendono in fondo al proprio Step**, quindi non collidono mai finché le due sessioni lavorano su Step diversi.
4. **Se la Versione va in conflitto**, chi risolve mette `max(A, B) + 1` e tiene **entrambe** le voci, ordinate per data decrescente. Mai scartarne una.
5. Gli unici punti di contesa reali sono **le due righe di testata** e **la prima riga dopo `## Storico sessioni`**. Tutto il resto è partizionato per costruzione.

## Vision

Macchina CNC 2D per disegno/plotter, con:
- Assi X/Y motorizzati (NEMA17 modello 17HS4023 + driver A4988)
- Asse Z tramite servomotore per alzare/abbassare la penna
- Controllo firmware via ESP32 con FluidNC
- Invio G-code via Wi-Fi (WebUI di FluidNC), senza necessità di cavo USB durante il disegno
- In prospettiva, un software "stile slicer" per convertire SVG/immagini in G-code e caricarlo sulla macchina

## Pipeline

### Convenzioni valide per tutta la pipeline

**Nomi degli assi (dal 2026-10-15).** Secondo la convenzione cartesiana del
foglio, decisa dall'utente:

| Asse | Che cosa è | Sul foglio | Staffa | Motore |
|---|---|---|---|---|
| **X** | la trave del portale: ci corre sopra il carrello che porta la penna | sinistra → destra | staffa LL, 550 | **STEP D4 · DIR D26** |
| **Y** | le due rotaie di base: ci scorre sopra tutto il portale | basso → alto | staffe TT, 2 × 400 | **STEP D25 · DIR D33** |

**I pin in questa tabella sono stati corretti il 2026-10-19**, e prima di quella
data erano scambiati: vedi la nota in Step 2. I *nomi* e il loro significato
fisico non sono cambiati — la trave è sempre stata X — era sbagliato solo
l'abbinamento ai pin. Verifica a vista, se un giorno tornasse il dubbio:
**un movimento su X muove il carrello lungo la trave, non tutto il portale.**

**Attenzione leggendo il resto del documento:** tutte le voci dello storico e
tutte le note anteriori al 2026-10-15 usano la nomenclatura precedente, in cui
X e Y erano **scambiati** rispetto a questa tabella. Non sono state riscritte —
le voci passate non si toccano. Quando una nota vecchia dice "corsa X 242,475"
intende la corsa del portale sulle rotaie di base, che oggi si chiama Y.

**Nomi delle staffe (dal 2026-10-12).** **Staffa TT** = le due rotaie da 400.
**Staffa LL** = la trave del portale da 550.

**Nomi delle due applicazioni (dal 2026-10-15).** Il progetto ne ha due, con
ruoli diversi, e non si sostituiscono a vicenda:

- **GDC CNC 2D SLICER** — l'applicazione vera: la webapp dello Step 4 (`webui/`)
  più la configurazione FluidNC che la esegue (`firmware/fluidnc/`). Importa il
  disegno, genera il G-code, comanda la macchina
- **Pannello di controllo manuale GDC CNC 2D** — lo strumento di collaudo dello
  Step 1.1 (`firmware/cnc2d_dashboard/`): frecce, un giro di pignone, slider del
  servo, log, OTA. Serve a montare e diagnosticare, non a disegnare

La cartella e il file dello sketch restano `cnc2d_dashboard`: l'IDE Arduino
esige che cartella e sketch abbiano lo stesso nome e non accetta spazi, quindi
il nome esteso vive nel titolo della pagina e nei README, non nel filesystem.

**Il repository GitHub si chiama `GDC-CNC-2D`** (rinominato dall'utente il
2026-10-15; GitHub non accetta spazi nei nomi e li sostituisce con trattini).
Non ha rotto nessun link: GitHub Pages non è attivo su questo repository,
l'applicazione è servita dall'ESP32 sulla rete locale, e GitHub redirige
automaticamente il vecchio URL. L'unico modo di rompere la redirezione è
creare un giorno un altro repository chiamato `CNC-2D` sullo stesso account.

### Step 1 — Bring-up alimentazione e logica ESP32

**Stato:** completato

**Obiettivo:** ESP32 funzionante e alimentabile sia da USB che da batteria, con GPIO verificati

**Decisioni progettuali:**
- Ramo alimentazione logica (5V, ESP32) separato dal ramo 24V dei motori
- **Una spina sola per tutta la macchina: 12 V / 3 A, due 7805 indipendenti.** Supera sia il ramo a 24 V sia la batteria 18650. Il mattone (DVE DSA-36W-12, 36 W) alimenta direttamente i VMOT dei due driver e, attraverso **due L7805CV separati**, il 5 V della logica e il 5 V del servo. Il punto non è il numero di regolatori: è che **i due 5 V non si possono tirare giù a vicenda**, perché ciascuno ha 7 V di margine e oltre 60 dB di reiezione. Un interruttore unico sui 12 V, a monte di tutto. Bilancio: picco ~2,15 A sui 3 A disponibili. **Alternative scartate:** un solo regolatore condiviso (è la configurazione che ha causato il brownout del servo); uno switching LM2596 (più efficiente e sarà l'upgrade, ma non ce l'aveva e due lineari separati sono elettricamente più puliti di uno switching condiviso); alimentazione separata del servo da una seconda presa, rifiutata dall'utente — una macchina si accende con una spina
- **Il 18650 e il modulo di ricarica escono dal progetto.** Hanno fatto il loro lavoro nel bring-up dei LED. Per motori e servo non reggono: il modulo dà ~1 A dichiarato con protezione che interviene prima, mentre il solo servo chiede 700 mA di spunto (1,4 A per un MG90S) e il boost ne tira 1,6 dalla cella per darne 1 in uscita
- **La breadboard resta il circuito definitivo, ma solo per i segnali.** Decisione dell'utente, con tre eccezioni concordate: i due 7805 coi loro condensatori vanno su millefori saldata (sono la parte più calda e con più corrente, e non cambieranno mai più); il ramo 12 V di potenza va su morsetti a vite (un contatto di breadboard è dato per ~1 A e lì ne passano fino a 2); la breadboard va fissata meccanicamente e i cavi ancorati con fascette. Il motivo delle eccezioni è la vibrazione: il portale accelera a 0,3 g sulla stessa tavola, e un contatto a frizione che diventa intermittente sulla linea STEP dà **passi persi**, cioè un difetto che si va a cercare nella meccanica dove non c'è
- Batteria 18650 + modulo boost/carica 5V Type-C (supporta "discharge while charging", quindi utilizzabile anche mentre è in carica)
- Interruttore SPST inserito solo sulla linea 5V+ verso il pin VIN dell'ESP32 (non sulla batteria), per non interrompere la ricarica quando la macchina è spenta
- GND comune tra guida breadboard, modulo batteria ed ESP32, verificato in continuità

**Criterio di completamento:** LED collegato a D2 lampeggia correttamente sia alimentato da USB sia da batteria+interruttore

**Note (cronologia dello step):**
- [2026-09-19] Verificati componenti hardware (batteria NASTIMA 12V, motori 17HS4023, driver A4988, alimentatore 24V riciclato da striscia LED) tramite confronto con i link Amazon e datasheet
- [2026-09-19] Test ESP32 standalone via USB-C con sketch Blink su D2 (GPIO2) e resistenza 220 ohm — riuscito
- [2026-09-19] Aggiunto modulo batteria 18650 (boost 5V + carica Type-C) e interruttore sulla linea 5V+ verso VIN — testato e funzionante
- [2026-09-26] **L'alimentatore non è più il 24 V recuperato dalla striscia LED**, ma un DVE DSA-36W-12: **12 V, 3 A, 36 W**. Supera il dato del 2026-09-19. Nota importante sulle conseguenze: a corrente impostata uguale, **la tensione di alimentazione non cambia né la coppia né la temperatura dei motori**, perché l'A4988 è un driver a corrente controllata — la tensione decide solo quanto in fretta la corrente sale, quindi conta alle alte velocità. Bilancio a 12 V con tre motori a 0,6 A: 0,28 A ciascuno, 0,85 A in totale, ~14 W su 36 disponibili (28% della corrente). L'unico punto in cui i 12 V stringono è il collegamento di due motori in serie su un solo driver: 6,0 V dei 12 se ne vanno fra caduta resistiva, induttanza e forza controelettromotrice, contro i 3,0 V di un motore per driver

#### Step 1.1 — Dashboard web di controllo e test

**Stato:** completato

**Obiettivo:** dashboard web autonoma ospitata direttamente sull'ESP32, raggiungibile dalla rete Wi-Fi di casa, con un controllo di test sul LED e configurazione Wi-Fi senza dover ricompilare/riflashare

**Decisioni progettuali:**
- Web server nativo (`WebServer.h`, incluso nel core ESP32) invece di `ESPAsyncWebServer`, per non richiedere librerie esterne da installare
- Credenziali Wi-Fi salvate in NVS (`Preferences`) e configurabili da una tab dedicata nella dashboard; fallback automatico ad Access Point di emergenza (`CNC-2D-Setup`) se la connessione alla rete salvata fallisce, così la pagina resta sempre raggiungibile per correggerle
- mDNS (`cnc2d.local`) per raggiungere la dashboard senza dipendere dall'IP assegnato dal router
- Frecce direzionali presenti in UI ma non collegate a nessuna funzione, in previsione del controllo assi X/Y (Step 2)
- Tab "Codice" lasciata come placeholder: in futuro servirà per caricare direttamente un file G-code dal browser (non per compilare sketch — l'ESP32 non può compilare C++ da solo), da attivare dopo aver validato motori (Step 2) e servo/pen-lift (Step 3)

**Criterio di completamento:** dashboard raggiungibile da browser sulla rete di casa, pulsante centrale che accende/spegne il LED su D2 in tempo reale, funzionamento verificato sia con ESP32 alimentato da USB sia da batteria+interruttore

**Note (cronologia dello step):**
- [2026-09-19] Implementato sketch `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` con web server, pagina a 3 tab (Controllo, Wi-Fi, Codice), salvataggio credenziali Wi-Fi su NVS e fallback ad AP di emergenza
- [2026-09-19] Bug: errore di compilazione "unterminated raw string" — causato da copia-incolla manuale del codice in un nuovo sketch anziché apertura diretta del file `.ino`, con probabile perdita dell'ultima riga di chiusura della stringa raw; risolto scaricando il file raw direttamente da GitHub
- [2026-09-19] Test completo riuscito: provisioning Wi-Fi di casa dalla tab dedicata, dashboard raggiungibile su `http://cnc2d.local`, LED su D2 controllato correttamente sia da alimentazione USB sia da batteria 18650+interruttore
- [2026-09-20] Aggiunti alla dashboard: 2 nuovi LED di stato (verde su D18, giallo su D19) con pulsanti dedicati Rosso/Giallo/Verde sotto le frecce (il pulsante centrale del joystick è stato disabilitato, non usa più il LED); supporto ArduinoOTA per aggiornare il firmware via Wi-Fi dopo il primo upload USB; tab "Log" che mostra in tempo reale gli stessi messaggi del Serial Monitor (utile perché il Serial Monitor via USB non è più disponibile quando si aggiorna via OTA)
- [2026-09-20] Frecce sinistra/destra collegate al motore X (STEP/DIR/ENABLE): click singolo = un passo, pressione prolungata = rotazione continua non bloccante; aggiunti pulsanti "Giro completo ←/→" (200 passi) per test rapido — dettagli del cablaggio e del debug nello Step 2
- [2026-09-20] Rifattorizzato il motore della dashboard: il movimento non è più eseguito dentro l'handler HTTP (che bloccava per 3 secondi affamando `server.handleClient()` e l'OTA) ma da una coda di passi servita in `loop()`, prima e dopo `handleClient()`; DIR impostato una sola volta a inizio movimento con tempo di assestamento invece che a ogni impulso; aggiunta rampa di accelerazione opzionale sui primi 40 passi
- [2026-09-20] Aggiunta tab "Motore": intervallo tra i passi regolabile da browser (300 µs – 200 ms), numero di passi, rampa on/off, abilitazione diretta del driver e sezione "Test pin" che forza STEP/DIR/EN a un livello fisso per poterli misurare col multimetro. Ogni movimento registra nel log i passi effettivamente emessi, così si distingue subito un problema firmware da uno elettrico
- [2026-10-12] **Bug: il servo non si muove e la scheda si spegne**
  **Sintomo:** a ogni comando del servo il LED rosso dell'ESP32 e quello del modulo di ricarica si spegnevano per un istante; il servo non si muoveva affatto. I LED comandati dalla dashboard funzionavano, quindi scheda e rete erano sane. Con l'ESP32 spostato su alimentatore da muro il sintomo cambiava: la scheda restava accesa, il servo **vibrava** e i LED del modulo batteria lampeggiavano in continuazione
  **Causa:** il servo e la logica condividevano il 5 V del modulo 18650. Lo spunto del servo (700 mA, 1,4 A per un MG90S) faceva collassare quel ramo; l'ESP32 andava in brownout e, resettandosi, smetteva di generare il PWM — quindi il servo non arrivava mai in posizione. Nella seconda configurazione il collasso restava sul solo ramo servo e si vedeva per quello che era: **protezione che scatta e riparte in ciclo** (*hiccup mode*), con il servo alimentato a singhiozzo
  **Fix applicato:** due L7805CV separati dai 12 V, uno per la logica e uno per il servo. **Confermato dall'utente: tutti i test passano.** Il percorso diagnostico è costato due giorni perché l'alimentazione era stata classificata come causa poco probabile (vedi voce di storico del 2026-10-13)
- [2026-10-13] **Mancano i condensatori ceramici e per ora si va avanti così.** Montati solo gli elettrolitici. Funziona, ma l'elettrolitico alle alte frequenze non c'è: senza un ceramico vicino ai piedini il 7805 può oscillare nei MHz, e il sintomo non è un guasto netto — è riscaldamento inspiegabile, rumore sul 5 V, qualche reset a caso. Da aggiungere: **100 nF su IN e su OUT di ogni regolatore**, più uno in parallelo ai 100 µF sul VMOT di ogni driver

### Step 2 — Bring-up driver A4988 e motori (X/Y)

**Stato:** completato

**Obiettivo:** un motore NEMA17 pilotato correttamente da un driver A4988 tramite ESP32, poi due motori in parallelo

**Decisioni progettuali:**
- Vref target ~0.5-0.56V per 0.7A per fase (corrente nominale reale del 17HS4023, non 1.0A come inizialmente indicato da una fonte esterna consultata)
- Alimentazione di potenza: alimentatore switching DC **12V/3A** (DVE DSA-36W-12). Sostituisce l'alimentatore riciclato dalla striscia LED RGB, che si è rivelato inutilizzabile (vedi bug sotto). 12V sono ampiamente sufficienti per il plotter e fanno scaldare molto meno il driver rispetto a 24V
- **Condensatore elettrolitico 100 µF / 50 V obbligatorio tra VMOT e GND del driver**, il più vicino possibile al modulo: senza, i picchi induttivi generati dalle bobine a ogni commutazione distruggono l'A4988 (è la causa della perdita dei primi due moduli)
- Collaudo di accettazione di ogni nuovo modulo A4988 prima di alimentarlo: continuità tra STEP, DIR, EN e GND deve essere **muta** su tutti e tre. Venti secondi che smascherano subito un ingresso in corto
- Pin driver: STEP su D4, DIR su D26 (era D16), ENABLE su D27 (era D17) — spostati da D16/D17 per un problema di instabilità non ancora confermato con certezza (vedi bug nello storico sessioni)
- Bobine motore identificate via continuità: bobina 1 = fili rosso+blu, bobina 2 = fili nero+verde; mappate sul driver rispettivamente su 1A/1B e 2A/2B (l'assegnazione "1"/"2" rispetto ai colori è invertita rispetto al primo tentativo ma elettricamente corretta, non causa malfunzionamenti — cambia solo il verso di rotazione)
- Alimentatore 24V riciclato da striscia LED RGB: verificato con multimetro che il filo bianco è il vero 24V+ e il filo rosso è il GND (contro-intuitivo rispetto al colore); i fili blu e verde sono ridondanti (stesso nodo del bianco) e isolati, non utilizzati
- Scheda "Nano Terminal Adapter" (pensata per Arduino Nano) riadattata come morsettiera generica per i collegamenti di potenza (24V e fili motore), sfruttando il fatto che è puramente passiva (screw terminal + header pin sullo stesso nodo) — alternativa scartata: morsetti a vite dedicati, non disponibili al momento
- Velocità di step di partenza volutamente prudente (senza rampa di accelerazione) per il primo test, da aumentare più avanti con una rampa vera

**Criterio di completamento:** rotazione controllata e affidabile di entrambi i motori tramite comandi step/dir dall'ESP32

**Note (cronologia dello step):**
- [2026-09-20] Cablaggio completo del driver A4988 (logica + potenza) e del motore X, con verifica pin ENABLE tramite conteggio sull'etichettatura reale del modulo (foto)
- [2026-09-20] Bug: primo driver A4988 non muoveva il motore
  Sintomo: nessuna reazione del motore a "Giro completo" né alle frecce, solo un leggero ronzio; bloccato con forza al tatto (normale per uno stepper abilitato, non diagnostico da solo)
  Causa: sospetto danneggiamento del chip driver (probabile durante le prove di cablaggio in tensione) — tutti i controlli di continuità su STEP/DIR/ENABLE/VDD/RESET-SLEEP/VMOT/GND risultati corretti
  Fix applicato: sostituito con un secondo modulo A4988 di scorta — con il nuovo modulo il motore ha iniziato a muoversi (parzialmente), confermando che il primo era guasto
- [2026-09-20] Bug: Vref bloccato a 0,20V sul secondo modulo, il potenziometro sembrava non avere effetto
  Sintomo: valore instabile e comunque fermo a 0,20V (target 0,50–0,56V) girando il trimmer
  Causa: misura instabile a causa del motore collegato durante la prova (rumore/carico sul riferimento)
  Fix applicato: misurato Vref a motore scollegato — tarato correttamente a 0,55V
- [2026-09-20] Bug: il motore gira solo con passi singoli, non con pressione prolungata né con "Giro completo"
  Sintomo: ogni click singolo produce un piccolo movimento pulito senza perdere passi; in sequenza continua il motore non si muove (con solo un leggero ronzio) oppure avanza a scatti di circa 1/5 di giro senza completare la rotazione
  Causa: individuata con un test del "wiggle" — muovendo il filo che collega ENABLE (D17) durante il funzionamento, il motore si mette a girare; il problema persiste anche sostituendo il filo con uno nuovo o cambiando i fori della breadboard, e la continuità elettrica su quel filo risulta comunque corretta a riposo. Causa non ancora confermata con certezza: si sospetta un comportamento specifico dei pin GPIO16/GPIO17 (usati per DIR/ENABLE), che su alcune varianti di modulo ESP32 con PSRAM (WROVER) sono riservati e non utilizzabili come GPIO liberi — dalla foto del modulo (etichettato solo "ESP-32", nessuna scritta "WROVER" visibile) non è stato possibile confermare con certezza se questo sia il caso
  Fix applicato: non ancora confermato — spostati DIR (D16→D26) ed ENABLE (D17→D27) su pin sicuramente liberi da questo vincolo su qualunque variante ESP32; il test dopo lo spostamento non è ancora stato riportato a fine sessione — **da riprendere nella prossima sessione**
- [2026-09-20] Il bug sopra è stato **risolto**: lo spostamento su D26/D27 non c'entrava nulla e l'ipotesi PSRAM/WROVER era sbagliata. La causa reale era l'alimentatore di potenza (vedi bug successivo). I pin sono stati comunque lasciati su D26/D27, che vanno benissimo
- [2026-09-20] Bug: alimentatore di potenza inutilizzabile — **causa radice di tutta la sessione**
  Sintomo: tensione su VMOT del driver oscillante tra 1 V e 20 V invece che ferma; coppia di tenuta debolissima (l'albero si girava con due dita, mentre a 0,69 A/fase dovrebbe essere immobile); passi singoli occasionalmente corretti, rotazione continua mai
  Causa: l'alimentatore riciclato è un **controller per strisce LED RGB**, non un alimentatore DC. Dei 4 fili, il bianco è il +24V comune e rosso/verde/blu sono le tre uscite di canale, cioè MOSFET pilotati in PWM. Usare il filo rosso come massa significava alimentare il driver attraverso un interruttore che si apriva e chiudeva continuamente. Verificato misurando sotto carico su tutti e tre i canali: instabili tutti
  Fix applicato: sostituito con un alimentatore switching DC 12V/3A, misurato stabile a 12,2 V. **Confermato**
- [2026-09-20] Bug: secondo driver A4988 con ingresso STEP in corto verso massa
  Sintomo: dopo aver risolto l'alimentazione, l'albero era finalmente duro e il test ENABLE rispondeva, ma nessun comando produceva movimento e il motore restava in silenzio assoluto. Misurando il pin STEP sul driver si leggeva sempre 0 V pur avendo continuità verso D4
  Causa: individuata dividendo il nodo STEP in due metà e misurandole separatamente — lato ESP32 muto (GPIO4 sano), lato driver in corto a 0,2 Ω, e sfilando il modulo la breadboard tornava muta. L'ingresso STEP era quindi in corto **dentro il chip**, inchiodato a 0 V. Danno provocato dallo stesso alimentatore RGB
  Fix applicato: sostituito con il terzo modulo A4988, collaudato prima dell'installazione con il test di continuità STEP/DIR/EN verso GND. **Confermato**
- [2026-09-20] Motore X funzionante: Vref tarato a 0,54 V sul nuovo modulo, test ENABLE corretto (albero bloccato con spunta, libero senza) e movimento comandato dalla dashboard riuscito
- [2026-09-21] Sweep di velocità completato su tutta la gamma disponibile fino a 500 passi/s: nessuna banda di risonanza, nessun microstepping necessario per la stabilità
- [2026-09-21] Secondo asse cablato: driver Y con STEP su D25 e DIR su D33, ENABLE condiviso con X su D27. Al primo avvio il motore Y girava da solo senza controllo — causa: D25/D33 non erano ancora configurati come uscite nel firmware e, restando ingressi flottanti, raccoglievano rumore che il driver interpretava come impulsi di STEP. Risolto portando i pin STEP a livello basso come prima istruzione di `setup()`
- [2026-09-21] **Step chiuso:** entrambi gli assi pilotati correttamente, singolarmente e in contemporanea
- [2026-10-12] **Microstep confermati 1/16 da un dato dell'utente**, non più per ipotesi: MS1, MS2 e MS3 sono ponticellati insieme e portati a VCC, e sulla tabella dell'A4988 tutti e tre alti = sedicesimo di passo. Quindi **33,953 passi/mm** è il numero vero, e il default della dashboard era già giusto
- [2026-10-12] **Dashboard riscritta per la trasmissione reale.** Tre cambiamenti strutturali: (a) i passi non escono più da `loop()` ma da un **timer hardware a 20 kHz** con accumulatore a virgola fissa — con i microstep attivi la frequenza sale a qualche migliaio di impulsi al secondo e `server.handleClient()` può bloccare il loop per centinaia di millisecondi, cioè buchi nel treno di impulsi; (b) l'interfaccia parla in **millimetri** (velocità 1÷100 mm/s, distanza in mm) invece che in passi, e il pulsante "360°" diventa "1 giro" = 94,2478 mm calcolati dai microstep impostati; (c) due pulsanti eseguono **quadrato da 40 mm e cerchio R20** come macchina a stati non bloccante, movimenti di penna compresi, replicando i file in `gcode/test/`. Aggiunto anche uno slider dell'angolo servo dal vivo nella tab Controllo
- [2026-10-12] **Bug: lo sketch non compila, "variable or field 'setDir' declared void"**
  **Sintomo:** errori a catena su tutte le funzioni che prendono `Motor&` o `DemoStep&`, indicando righe di definizione scritte correttamente e con la struct dichiarata cinquanta righe più su
  **Causa:** l'IDE Arduino genera da solo i prototipi di tutte le funzioni e li inserisce **subito prima della prima funzione del file**, con una direttiva `#line` che fa riportare l'errore alla riga della definizione originale. Spostando le costanti della trasmissione in cima, la prima funzione era diventata `stepsPerMm()`, che sta sopra `struct Motor`: i prototipi generati nominavano un tipo non ancora dichiarato. Nelle versioni precedenti funzionava **per caso**, perché la prima funzione era `logMsg()`, che sta sotto la struct
  **Fix applicato:** `Motor` e `DemoStep` spostate in una sezione "Tipi" in cima al file, prima di qualunque funzione, col commento che spiega perché non stanno vicino al codice che le usa. **Confermato: compila e gira.** Il controllo di sintassi fatto qui con g++ non poteva vedere l'errore per costruzione, perché g++ non inietta prototipi — il controllo è stato esteso emulando quel passaggio, e validato al contrario facendogli riprodurre l'errore sulla versione vecchia
- [2026-10-12] **Rampa del servo in firmware** (`servoGoTo` + `serviceServo`): invece di saltare all'angolo richiesto il servo ci arriva di N gradi ogni 10 ms, con N impostabile da 0 (salto secco) a 10. Serve contro il brownout — un servo che vede un errore grande parte alla corrente di stallo — ma **non sostituisce l'alimentazione**: abbassa il picco, non il consumo totale. Come diagnosi era decisiva, come cura no, ed è andata così. Le prove d'insieme ora aspettano che la penna sia **arrivata** invece di un ritardo fisso
- [2026-10-19] **BUG MIO: i pin dei due assi erano scambiati dal 2026-10-15, e l'ho scoperto solo perché l'utente ha provato le frecce.**

  **Sintomo:** con la pulsantiera della dashboard, le frecce destra/sinistra muovevano la testina **in alto e in basso** sul foglio, e le frecce su/giù la muovevano **a destra e sinistra**. La mappatura tastiera→asse è giusta (←→ chiamano `x`, ↑↓ chiamano `y`): sbagliato era quale motore fosse `x`.
  **Causa:** il 2026-10-15, applicando il rinominamento degli assi chiesto dall'utente, ho scambiato i quattro `#define` dei pin. Ma andavano sistemati i **nomi**, non l'abbinamento nome↔pin, che era già giusto. All'origine c'è una mia descrizione sbagliata: avevo scritto che "il driver su GPIO 4/26 è quello del portale e quello su 25/33 è quello della trave", quando è il contrario, e poi ho "corretto" i pin per farli combaciare con la descrizione sbagliata. L'utente me l'aveva anche detto, nello stesso messaggio del 2026-10-15: *"non è necessario che cambi nulla nel firmware vecchio, le 4 frecce spostano i carrelli nella direzione corretta"*. Non ne ho tenuto conto.
  **Fix applicato:** `STEP_X_PIN`/`DIR_X_PIN` tornano a D4/D26 e `STEP_Y_PIN`/`DIR_Y_PIN` a D25/D33, nella dashboard, in `cnc2d-config.yaml` e nelle etichette dell'interfaccia. Corretta anche la tabella delle convenzioni in cima a questo documento. **Verificato che compila, non ancora provato sulla macchina**: la conferma è che la freccia destra muova il carrello lungo la trave.
  **Nota sul tempismo:** le chiavi NVS (`invX`, `feedX`, `rampX`, `mmRevX`…) sono legate al **nome** dell'asse, quindi questo scambio le ri-punta sull'altro motore. Capita nel momento più economico possibile — niente è ancora tarato e i due assi hanno gli stessi valori di default — ma dopo il flash vanno ricontrollate le spunte "inverti direzione" e le velocità per asse.

- [2026-10-19] **La dashboard misura: posizione per asse e taratura del rapporto per asse.** Due aggiunte, chieste dall'utente per poter fare le misure degli assi **oggi**, senza aspettare il modulo penna — osservazione sua e giusta: i pignoni sulle cremagliere sono definitivi, quindi corsa e rapporto non cambiano più. (a) **Posizione**: `posSteps` per asse, contato nell'ISR col segno della direzione *logica* (quella delle frecce, non del livello del pin DIR, così la freccia destra fa salire il numero anche con `invert` attivo), tenuto in passi e non in millimetri perché un accumulatore in float perderebbe risoluzione dopo qualche migliaio di passi. Mostrato in mm in un riquadro nella tab Controllo con tre pulsanti di azzeramento. Il segno si imposta **dentro la sezione critica** di `startMoveSteps` e non in `setDir()`: su un asse in rotazione continua, fra `setDir()` e la sezione critica l'ISR conterebbe qualche passo col segno vecchio. (b) **Taratura**: `mmPerRev` diventa un campo per asse, salvato in NVS (`mmRevX`/`mmRevY`), con una rotta che lo ricava da comandato/misurato. Rifiuta risultati fuori da 60÷130 mm/giro, perché a quel punto non è un ritiro di stampa ma un errore di battitura, e azzera la posizione dopo il salvataggio, perché contava in passi col rapporto vecchio
- [2026-10-19] **`stepsPerMm()` non esiste più come valore globale**: è `stepsPerMm(m)`, una per asse. Chiudeva un debito aperto il 2026-10-15 ("due passi/mm, uno per asse, non uno globale"), e toccava sei punti del codice — fra cui `demoGoTo`, che ora converte i due assi separatamente, altrimenti il quadrato di prova uscirebbe rettangolo appena i due rapporti divergono. Verificato con la compilazione sintattica (il compilatore trova tutti i siti di chiamata per costruzione: zero errori = zero siti dimenticati). **Non provato sulla macchina**
- [2026-10-19] **La taratura del rapporto si fa disegnando, non misurando il movimento del carrello.** Obiezione dell'utente, ed è fondata: inseguire un carrello col calibro contro un riferimento improvvisato dà due o tre decimi di incertezza, cioè proprio l'ordine di grandezza da misurare, mentre una linea disegnata sta ferma, è piana e il calibro ci appoggia le ganasce come vuole lui. *Annulla l'ordine "prima il rapporto, poi la corsa" scritto poche ore prima*: le corse si fanno col DRO adesso, il rapporto si fa col modulo penna montato
- [2026-10-19] **Perché serve comunque un metro esterno, e il DRO non basta mai.** `corsa letta = passi / 33,953` e `passi = denti percorsi × 20`, quindi `corsa letta = denti percorsi × 4,71239` **sempre**, qualunque sia il passo vero della cremagliera. Il ritiro di stampa si cancella per costruzione: la macchina conta denti e li converte col passo nominale. Nessuna misura fatta *dentro* la macchina può rivelare l'errore di scala
- [2026-10-19] **Il metodo per cancellare la larghezza del tratto:** si disegnano due linee parallele a interasse comandato 100 mm (che sta in un calibro da 150), si misura **esterno-esterno** `E` e **interno-interno** `I`, e l'interasse vero è `(E + I) / 2` — la larghezza del pennarello si elide esattamente perché una lettura la somma e l'altra la sottrae. A ±0,05 mm di lettura su 100 mm comandati l'incertezza è lo 0,05%
- [2026-10-19] **Alternativa statica, se servisse un numero prima della penna:** `mm per giro = 20 × passo della cremagliera`, **esattamente** — ogni ingranamento avanza di un passo di cremagliera e il ritiro del pignone non c'entra. Si misura il passo da fermo col metodo delle due spine già scritto in `misure/primo-asse.md`: su 30 passi (141 mm) l'incertezza è lo 0,035%. Limite: la cremagliera Y è in due pezzi giuntati, quindi la misura dà il passo *locale* — che per i passi/mm è il numero giusto, perché la giunzione aggiunge uno scalino di posizione e non un errore di scala
- [2026-10-13] **I motori rallentano mentre si muove il servo, e non è un problema.** Lo stack Wi-Fi maschera le interruzioni per brevi istanti durante il traffico HTTP, quindi qualche tick del timer salta. Ma il contatore dei passi scala **solo quando un impulso esce davvero**: un tick saltato allunga il tempo, non toglie un passo. **Costa tempo, non posizione** — e quindi non invalida la taratura dei passi/mm, che si misura in distanza. Sparisce comunque da sé: nella macchina vera la penna si muove solo a carrelli fermi, ed è il G-code a imporlo

### Step 3 — Configurazione FluidNC

**Stato:** in corso — **la macchina esegue e disegna, anche a lungo.** Versi dei due assi riprovati e corretti, quote Z negative applicate e verificate, origine manuale rodata, programmi caricati e lanciati dalla flash. Il blocco delle stampe lunghe ha **causa confermata sulla macchina** il 2026-10-24: è il canale HTTP che il job si tiene aperto per tutta la durata, e lanciando dalla **seriale USB** non si presenta. Finché il SLICER non invia il programma da sé, i disegni lunghi si lanciano dalla seriale: è un rimedio operativo, non una cura.

**Obiettivo:** FluidNC installato e configurato come firmware definitivo della macchina, con movimento coordinato X/Y e pen-lift sul servo

**Decisioni progettuali:**
- **FluidNC è il firmware definitivo**, lo sketch `cnc2d_dashboard` retrocede a strumento di collaudo hardware. Motivo: interpolazione coordinata, pianificazione dell'accelerazione fra segmenti e interpretazione del G-code sono settimane di lavoro già risolte e collaudate su migliaia di macchine
- **Pen-lift come asse Z vero** tramite il tipo motore `rc_servo`, non tramite l'uscita PWM dello spindle con M3/M5. Supera la decisione originale dello Step 3: trattare la penna come un asse permette al generatore di G-code di gestirla come un movimento qualsiasi
- **Microstepping 1/16** (MS1/MS2/MS3 a VDD su entrambi i driver): a passo intero la risoluzione sarebbe di circa 0,2 mm per passo, uno scalino visibile a occhio sul tratto. A 1/16 si scende attorno ai 0,02 mm. Il valore esatto di `steps_per_mm` dipende dal pignone scelto (vedi Step 5) e va comunque tarato sulla macchina
- **Nessun azzeramento automatico**: niente finecorsa di riferimento, l'origine si imposta a mano con `G92 X0 Y0`. Conseguenza: `soft_limits` resta disattivo, perché FluidNC lo consente solo su macchina azzerata, e la protezione contro le uscite dall'area passa all'interfaccia web
- **Driver mai disabilitati** (`idle_ms: 255`): con l'azzeramento manuale, un asse che si ammorbidisce e viene spostato a mano farebbe perdere la posizione senza che nessuno se ne accorga. Annulla l'idea, discussa e poi scartata, di un auto-spegnimento dei driver dopo inattività
- **Due pulsanti di emergenza** su D13/D14 nell'angolo in basso a sinistra, configurati come finecorsa rigidi: in teoria non vengono premuti mai, se succede FluidNC ferma tutto e va in allarme. Cablati normalmente aperti verso massa — accettabile per un backstop, da rivedere con microswitch veri
- **LED di stato come `user_outputs`**, comandati dall'interfaccia web con M62/M63: verde = tutto bene, giallo = attenzione (non calibrato, posizione non attendibile, in pausa), rosso = errore
- **Azzeramento sui due pulsanti d'angolo, `soft_limits` attivi e `must_home` vero.** Supera la decisione "nessun azzeramento automatico" presa il 2026-09-21. I due pulsanti su D13/D14 esistono già e sono cablati: aggiungendo un blocco `homing` per asse diventano **anche** riferimenti di azzeramento, e questo sblocca `soft_limits`, cioè il **rifiuto dei movimenti fuori area nel pianificatore** invece che nell'interfaccia. Costo in componenti: zero, è una modifica al YAML. Il motivo per cui conta: un limite che vive solo nella UI non è una protezione ma un suggerimento — un comando battuto a mano nella console di FluidNC, un file malformato o un bug nel generatore lo scavalcano. La ripetibilità di un pulsante a cupola è scarsa (±1 mm), ma per la **sicurezza** basta che sia conservativo, non preciso: la dispersione sposta il disegno sul foglio, il margine copre l'incidente. Microswitch veri (±0,03) restano l'upgrade
- **I limiti stanno in due posti diversi perché sono due cose diverse.** Le **corse meccaniche** sono proprietà della macchina e vivono in FluidNC (`max_travel_mm`); il **foglio** è proprietà del lavoro e vive nell'app (`paper` + `sheetOrigin`); il **margine di sicurezza** è un numero proprio, esplicito ed editabile, e il limite effettivo (`corsa − margine`) è calcolato e mostrato, mai salvato. Applicazione della regola già scritta in `webui/js/settings.js`: "due posti in cui scrivere lo stesso numero sono due posti che prima o poi si contraddicono". Azzerando in un angolo basta **un numero per asse** invece di min e max, che è anche la convenzione di FluidNC
- **Il riferimento va sul metallo, il margine nel software.** Parcheggiare "a circa 2÷3 cm dal fondo" a occhio fa diventare l'errore di parcheggio un errore di margine: si crede di essere a 25 mm e si è a 12. Si va in battuta su qualcosa di fisico (errore zero per definizione) e il margine lo sottrae il firmware. Corollario: **i limiti sopravvivono al riavvio, il riferimento no** — un passo-passo senza encoder non può sapere se qualcuno ha spostato il carrello mentre era spento. Serve uno stato `NON AZZERATA` in cui sono permessi solo jog relativi a passo limitato, e nessun movimento assoluto né esecuzione di file

**Criterio di completamento:** la macchina disegna un quadrato e un cerchio con movimento coordinato dei due assi, verificabile a vista sui motori anche senza struttura montata

**Note (cronologia dello step):**
- [2026-09-21] Scritta la configurazione di partenza `firmware/fluidnc/cnc2d-config.yaml` con la mappa dei pin già validata. Restano da tarare `steps_per_mm`, `max_travel_mm` e gli estremi dell'impulso del servo, tutti dipendenti dalla meccanica
- [2026-09-21] Installazione FluidNC avviata dal web installer (`installer.fluidnc.com`, richiede Chrome o Edge perché usa WebSerial). Scelte: versione **v4.1.0** (ultima non pre-release), processore **esp32** (DevKit WROOM-32 a 30 pin), variante **wifi** (l'unica con WebUI), tipo **fresh-install**, interfaccia **WebUI-2** — scelta fra le tre disponibili perché è quella su cui è costruita la documentazione del wiki, e se ne può installare una sola
- [2026-09-21] Da verificare alla prima accensione: la configurazione è stata scritta sullo schema FluidNC 3.x, mentre la versione installata è la 4.1.0. Eventuali nomi di campo cambiati vengono segnalati dal validatore all'avvio
- [2026-09-21] **Lo schema 4.1.0 ha accettato la configurazione scritta sul 3.x senza una sola modifica.** Il dubbio segnalato nella nota precedente è risolto: nessun nome di campo è cambiato fra le due versioni per i costrutti che usiamo
- [2026-09-21] Attivazione della configurazione: il pulsante "Seleziona configurazione" del browser dei file non ha avuto effetto, si è dovuto usare `$Config/Filename=cnc2d-config.yaml` dal terminale. Il comando di modifica a runtime `$/axes/shared_stepper_disable_pin=...` non restituisce nulla sulla 4.1.0, quindi le correzioni alla configurazione si applicano ricaricando il file e riavviando con `$Bye`
- [2026-09-21] WiFi configurato in modalità STA, hostname `cnc2d`, raggiungibile su `http://cnc2d.local` e `http://192.168.1.11`. Da qui in avanti l'installer non serve più: si lavora dalla WebUI-2
- [2026-09-21] LED verificati funzionanti con `M62 P0/P1/P2` e `M63 P0/P1/P2` (P0 verde gpio.18, P1 giallo gpio.19, P2 rosso gpio.2). La variante immediata M64/M65 non è stata necessaria. Il canale per legare le spie allo stato della macchina è quindi disponibile
- [2026-09-21] Microstepping 1/16 verificato su entrambi gli assi: 40 mm comandati (3200 microscatti con `steps_per_mm: 80`) producono un giro esatto dell'albero. A passo intero ne avrebbero prodotti sedici, quindi il test è inequivocabile a occhio. Ponticelli realizzati a catena RST→MS3→MS2→MS1, sfruttando il fatto che RST è già a VDD ed è adiacente a MS3: tre ponticelli cortissimi per driver, nessun filo lungo
- [2026-09-21] **Step completato**: quadrato da 40 mm e cerchio da raggio 20 mm eseguiti correttamente, con ritorno alle coordinate di partenza. Il criterio di completamento è soddisfatto
- [2026-10-06] **`steps_per_mm` nella configurazione è sbagliato di 2,36×, ed è il primo numero da correggere.** `cnc2d-config.yaml` porta ancora `steps_per_mm: 80` con il commento "vale per cinghia GT2 + puleggia 20 denti". La macchina non ha più cinghie: con pignone e cremagliera m1.5 z=20 il giro vale `π · m · z = 94,2478` mm (= 20 denti × passo 4,7124), e con 200 passi × 16 microstep fa **33,953 passi/mm**. Finché quel numero è sbagliato ogni limite inserito è sbagliato dello stesso fattore — si scrive "300 mm di corsa" e la macchina ne percorre 707 — e nessun pannello può intercettarlo, perché il pannello parla in mm e il mm è falso. Il criterio di completamento dello step resta soddisfatto (quadrato e cerchio verificati a vista sui motori), ma le quote erano 2,36× quelle comandate
- [2026-10-19] **`steps_per_mm` corretto nel file: 80 → 33,953.** Il bug era registrato il 2026-10-06 e il numero giusto era già scritto in quella nota; non è stato trovato ora, è stato finalmente applicato. Nel frattempo la dashboard usava il valore giusto (`stepsPerMm()` lo calcola da `MM_PER_REV = π·1,5·20`), quindi le prove di movimento riuscite non lo hanno mai esercitato: il numero sbagliato stava solo nel ramo FluidNC, che non è mai partito. Aggiunto nel file il perché, le varianti per 1/8 e 1/32, e il fatto che dopo la taratura X e Y **non** saranno uguali
- [2026-10-19] **I finecorsa non sono montati, e non si montano per ora** (informazione dell'utente). Questo **rimanda la decisione sull'azzeramento** presa in precedenza: niente blocco `homing:`, `must_home` resta falso, `soft_limits` resta falso. **Discrepanza da segnalare:** la nota del 2026-09-21 diceva "due pulsanti di emergenza su D13/D14 ... cablati normalmente aperti verso massa", quindi il documento li dava per esistenti. Non lo sono. La nota vecchia resta come è, questa la corregge
- [2026-10-19] **Tolti dal file i due `limit_neg_pin` e messo `hard_limits: false`.** Dichiarare un ingresso di finecorsa su un pin senza niente attaccato è **peggio** che non dichiararlo: il pull-up interno dell'ESP32 è da decine di kΩ, quindi il pin resta in alta impedenza e un disturbo captato dai cavi dei motori può farlo leggere come premuto. Sintomo che si sarebbe visto: allarme e stop a metà disegno, senza causa apparente e non riproducibile. Le righe sono commentate nel file, con scritto cosa riattivare il giorno che i microswitch arrivano
- [2026-10-19] **CORSE DEFINITIVE, stabilite dall'utente: X 257,532 e Y 243,041.** Lo scarto di 5 mm fra le due tornate su Y non era imbardata del portale: l'utente era stato **volutamente più conservativo** nella seconda. L'ipotesi dell'imbardata che avevo avanzato è quindi da ritirare — resta un'ipotesi aperta per il test delle diagonali, ma qui non c'entrava. Sono **misure di estremo**, prese per sapere dove non andare, e l'uso previsto sta ben dentro con margini abbondanti: non vanno ritoccate quando il rapporto sarà tarato
- [2026-10-19] **Controprova geometrica delle corse, e torna.** La previsione del 2026-09-26, calcolata dai denti delle cremagliere per il passo nominale, dava 256,613 per il carrello sulla trave e 242,475 per il portale sulle rotaie. Misurate: 257,532 e 243,041, cioè **+0,36% e +0,23%**. Due strade indipendenti che convergono entro quattro decimi di percento
- [2026-10-19] **L'A4 resta fuori, e l'utente conferma che non è un requisito** ("lavoreremo con dei margini abbondanti"). Conferma la decisione del 2026-09-26. Con 257,5 × 243,0 mancano 54 mm su Y per l'A4 verticale e 39,5 su X per l'orizzontale; l'A5 ci sta comodo in entrambi gli orientamenti anche con 5 mm di margine per lato (area utile 247,5 × 233,0). **La macchina è una A5**, e i preset del foglio vanno progettati così
- [2026-10-19] **Corse rimisurate dopo la correzione dei pin, e la ripetibilità dei due assi è molto diversa.** Seconda tornata: **X 257,532** e **Y 243,041**. Contro la prima: X scarta di **−1,090 mm (−0,42%, 37 passi)**, Y di **−5,007 mm (−2,02%, 170 passi)**. Entrambe più corte della prima volta, il che è il verso atteso: il contatore conta i passi **comandati**, quindi spingere contro il fine corsa gonfia il numero (il motore slitta, il contatore no), e la prima tornata era quella esplorativa. Si tengono quindi le **minori**, che sono anche le conservative: sovrastimare una corsa è l'errore pericoloso. **Ma il 2% su Y resta troppo**, e c'è un'ipotesi specifica: Y è il portale su **due rotaie con un motore solo da un lato**, quindi può imbardare, e il punto in cui "arriva in fondo" dipende da quanto è storto quando ci arriva. X, che è un carrello su una trave sola, non ha niente da storcere — ed è l'asse che ripete entro il millimetro. Se l'ipotesi regge, è lo stesso difetto che si misurerà col test delle due diagonali
- [2026-10-19] **CONSEGUENZA DA SAPERE SUBITO: l'A4 non ci sta, in nessun orientamento.** Con 257,5 × 243,0 di corsa: A4 verticale (210 × 297) manca di **54 mm su Y**, A4 orizzontale (297 × 210) manca di **39,5 mm su X**. **L'A5 ci sta comodo in entrambi gli orientamenti**, anche togliendo 5 mm di margine per lato (area utile 247,5 × 233,0). Dove sarebbe l'eventuale recupero: X consuma **292,5 mm** di una trave da 550, Y solo **157 mm** di rotaie da 400 — quindi i 39,5 mm che servono all'A4 orizzontale andrebbero cercati sull'asse X, guardando cosa occupa quei 292 mm. Da decidere se vale la pena: l'alternativa è prendere atto che la macchina è una A5, e progettare la tab Impostazioni e i preset del foglio di conseguenza
- [2026-10-19] **PRIME CORSE MISURATE sulla macchina montata, col nuovo DRO della dashboard: 248,048 mm e 258,622 mm.** **Attenzione all'attribuzione:** sono state misurate *prima* della correzione dei pin, quindi quello che il pannello chiamava X era il motore D25/D33, cioè il portale sulle rotaie, che adesso si chiama Y. I due numeri vanno quindi letti **scambiati**: **corsa X (carrello sulla trave) = 258,622** e **corsa Y (portale sulle rotaie) = 248,048**. Il che torna anche fisicamente: la trave è tagliata a 550 e dà più corsa delle rotaie da 400. Prima della correzione sembrava il contrario, ed era un indizio che non avevo raccolto. Misurate portando ciascun asse a un estremo, azzerando, e andando all'altro estremo (entrambe negative perché il verso percorso era quello negativo; conta il modulo). **Sono provvisorie**: il rapporto non è ancora tarato, quindi sono calcolate col nominale 33,953 passi/mm. Non vanno rifatte, però — l'errore è puramente moltiplicativo, quindi basterà riscalarle per `mmPerRev_tarato / 94,2478` quando la taratura ci sarà. In passi sono 8781 sulla trave e 8422 sulle rotaie, e quelli non cambiano qualunque cosa succeda ai nomi
- [2026-10-19] **`max_rate_mm_per_min` alzato da 2000 a 8000 su X e Y**, conseguenza del rapporto corretto: il 2000 era 2667 microstep/s con 80 passi/mm, ma con 33,953 sono 1132, un settimo di quello che il motore regge (500 passi interi/s = 8000 microstep/s = 235 mm/s ≈ 14100 mm/min). È un **tetto**, non una velocità di lavoro — quella la decide la F del G-code — quindi alzarlo non comporta rischio. **L'accelerazione resta 200** di proposito: agisce su ogni movimento, è quella che scuote il portale, e va alzata per prove successive solo col modulo penna montato, perché è lo sbalzo del modulo a decidere quanta imbardata genera uno strappo
- [2026-10-19] **Senza finecorsa non esiste un riferimento macchina, quindi non esiste protezione sui limiti.** Va detto esplicitamente perché è il costo della scelta: `G92` definisce un'origine di *lavoro*, non un riferimento, e non sopravvive a un riavvio né a un reset. L'unica protezione che resta è il **controllo dell'ingombro del disegno** fatto dall'interfaccia prima di partire. Corollario già scritto il 2026-10-06 e che qui diventa operativo: serve uno stato **NON AZZERATA** in cui l'app permette solo jog relativi a passo limitato e rifiuta di eseguire un programma
- [2026-10-19] **Il file non porta la decisione sull'azzeramento.** `soft_limits: false`, `must_home: false` e nessun blocco `homing:`, mentre la decisione presa dopo dice il contrario (azzeramento sui due pulsanti d'angolo, `soft_limits` attivi, `must_home` vero). È lavoro di solo YAML, non serve la macchina: va fatto prima di accendere FluidNC, altrimenti il primo movimento avviene senza la protezione che la decisione prevedeva
- [2026-10-19] **`max_rate_mm_per_min: 2000` è da rivedere al rialzo**, conseguenza del rapporto corretto: con 33,953 passi/mm sono 1132 microstep/s, contro i ~8000 che il motore ha dimostrato di reggere. Non è un bug, è un limite lasciato dal rapporto sbagliato
- [2026-10-19] **Nota di metodo per la tab Impostazioni, dal nostro stesso collaudo del 2026-09-21:** su FluidNC 4.1.0 il comando di modifica a runtime (`$/axes/...=`) **non restituisce nulla** e non ha effetto; quello che funziona è ricaricare il file e riavviare con `$Bye`. Confermato indirettamente dalla documentazione FluidNC, secondo cui le modifiche `$` vivono solo in memoria volatile e vanno scritte con `$CD=config.yaml` per sopravvivere al riavvio, e secondo cui le definizioni dei pin richiedono comunque un riavvio. Conseguenza di progetto: una tab Impostazioni che scrive nella macchina deve **generare il file e caricarlo**, non toccare le impostazioni a runtime
- [2026-10-06] Conseguenze collaterali del rapporto vero: risoluzione **0,0295 mm per microstep** (il gioco di 0,235 è 8× il passo, quindi è il gioco a dominare, non la risoluzione) e `max_rate_mm_per_min: 2000` corrisponde ora a 1132 microstep/s invece di 2667, cioè **un settimo** di quello che la meccanica regge (il motore è validato a 500 passi interi/s ≈ 235 mm/s). Verifica del rapporto: `G91 G0 X100`, misurare col calibro, correggere in proporzione
- [2026-10-22] **FluidNC 4.1.1 installata sulla macchina definitiva** e configurazione verificata con `$CD` chiave per chiave: nessuna ignorata. Rete STA, `cnc2d.local`, 192.168.1.14. **Tre scoperte ai primi comandi veri.** (a) Il servo non si muoveva: `RcServo` mappa la posizione MACCHINA e tronca fuori dai limiti dell'asse, e senza homing FluidNC dichiara la corsa in negativo — `Axis Z (-21.281, 0.010)` — quindi tutte le quote positive uscivano a 1500 µs. Confermato con `G0 Z-3`, che muove. La Z va usata in negativo: Z0 = tappo, Z−21.271 = contatto. (b) **I due assi andavano al contrario tutti e due**: invertite le spunte nel profilo, da riprovare. (c) Il flash a 921600 si interrompe sul CH340: 115200.
- [2026-10-23] **Le tre cose del giorno prima sono chiuse, e se ne apre una più grossa.** Quote Z negative in produzione e verificate sulla macchina (Z0, Z−18.326, Z−21.271 tutte raggiunte); versi dei due assi riprovati con quattro jog da 25 mm, **giusti**. Risolto anche «Upload filesystem inaccessible», che non era un guasto: le rotte della WebUI sono separate — `/files` è la flash, `/upload` è la SD — e l'upload finiva sulla SD inesistente. Si carica con `curl -T http://IP/flash/nome`, perché la flash è montata in WebDAV. **Ma due stampe lunghe si sono bloccate a metà** rendendo irraggiungibile la WebUI: la casella comandi crea un canale per ogni comando e `$LocalFS/Run` se lo tiene per tutta la durata del job, quindi la connessione HTTP del browser resta aperta per minuti. Da provare lanciando dalla seriale USB, che è insieme prova e rimedio.
- [2026-10-24] **Il blocco delle stampe lunghe è confermato, ed è il canale HTTP.** L'intreccio, fermatosi due volte su due lanciato dalla WebUI, lanciato dalla **seriale USB** a scheda del browser chiusa è arrivato in fondo: sette minuti, nessun reset. Una variabile sola cambiata. Da qui la regola operativa — **i disegni lunghi si lanciano dalla seriale** — e la conferma che lo streaming riga per riga del SLICER non è solo comodità. Procedura provata: browser chiuso, USB collegata a macchina spenta, 12 V riaccesi, monitor seriale a 115200 con fine riga «New Line», `$I` per verificare, `$LocalFS/List`, `$MD`, battuta, `G92 X0 Y0`, `G90 G0 X5 Y5 F1000`, penna, foglio, `$LocalFS/Run=<file>`. **Nota pratica sulla flash:** prima di caricare serve spazio vero, perché il gestore di upload tiene da parte una riserva — 20 KB liberi non bastano per un file da 19,5 KB.
- [2026-10-24] **Il WebSocket di FluidNC è un canale di comando a tutti gli effetti**, e da oggi è quello che usa il nostro programma. Letto nel sorgente: `WSChannel.cpp` mette i frame in arrivo in `push()` e registra il canale in `allChannels` come la UART; `WebUIServer.cpp` lo monta sulla radice. Nessun controllo dell'header `Origin` — i WebSocket non passano per il CORS — quindi la pagina parla con la macchina anche servita da altrove. Provato sulla macchina: collegamento, jog, homing, spostamento a coordinate. È la stessa cura del blocco delle stampe lunghe, vista dal lato del firmware: un canale solo che non si disconnette, invece di uno nuovo per comando.

### Step 4 — GDC CNC 2D SLICER (interfaccia web e generazione G-code)


**Stato:** in corso — **l'applicazione stampa, compone e disegna.** Oltre a mandare il programma (2026-10-25 mattina), regge **più SVG sullo stesso foglio** come livelli ordinati con i **cambi penna** fra l'uno e l'altro, e ha un **editor** con cui modificare e creare tracciati — nodi, maniglie, linee, rettangoli, cerchi, testi, taglio, curve, magneti, griglia, selezione multipla e annulla. Dal 2026-10-26 **un file si apre in un livello per tinta** (ogni colore di bordo e ogni colore di riempimento), le tinte piene spente ma recuperabili: l'importatore non butta più via geometria in silenzio. L'elenco dei livelli è comandabile — occhio, trascinamento per l'ordine, cambio penna sulla riga, selezione multipla, etichetta «edit» — e il riquadro sul foglio lavora su più livelli insieme e ruota senza perdere la collocazione. **Deciso il 2026-10-25: la pagina NON va sull'ESP32**, resta sul PC; cade con questo il tetto dei 113 kB che vincolava ogni aggiunta, e la WebUI di FluidNC resta come rete di sicurezza. Dal 2026-10-26 l’editor sceglie il **singolo tratto** fra due nodi invece della polilinea intera, ha **i suoi livelli** e somma i tratti con Ctrl, e il **cambio penna** è la procedura in sei passi che l’utente aveva in mente. La pagina porta **il numero di versione accanto al titolo**, contato dai commit. Dal 2026-10-27 i **tratti doppi non arrivano alla penna**, il **lavoro si salva in un SVG** che la pagina sa riaprire dov'era, e il tastierino ha i **punti limite della corsa** con le frecce che si fermano un millimetro prima del fine corsa; dal 2026-10-28 un tratto si **taglia e si incolla in un altro livello** senza muoversi di un millimetro sul foglio, e la pagina **parla col telecomando** (Step 9). Quello che manca è scritto nelle note

**Obiettivo:** un'unica pagina web da cui caricare un disegno, vederne l'anteprima sul foglio, generare il G-code e mandarlo in esecuzione

**Decisioni progettuali:**
- **Tutta l'elaborazione nel browser, l'ESP32 solo esegue.** L'ESP32 ha circa 300 KB di RAM utilizzabile: vettorializzare un'immagine e generare G-code è fuori portata. Il browser produce il file, l'ESP32 lo conserva ed esegue — così il disegno prosegue anche se si chiude il portatile o cade il Wi-Fi
- **Vettorializzazione con algoritmi deterministici** (Potrace o equivalente in JavaScript), non con un modello generativo. Alternativa scartata: passare l'immagine a un AI esterna con prompt da copiare e incollare — un modello linguistico non ricalca un'immagine, inventa percorsi plausibili, diversi a ogni tentativo e senza controllo su dove passa la penna. L'AI resta utile a monte, per preparare il soggetto come disegno a tratto
- **Si parte dall'SVG e basta.** I percorsi sono già vettoriali, non serve tracciamento: è il caso d'uso più frequente e costa una frazione del lavoro. Line art e planimetrie (soglia + tracciamento) vengono dopo. Le foto richiedono algoritmi dedicati — stippling, campi di flusso, retinatura — e sono un progetto a sé
- **Interfaccia servita dall'ESP32 come file separati**, non più come stringa dentro lo sketch: il codice resta leggibile e l'interfaccia si aggiorna dal browser senza ricompilare
- **Layout**: colonna menu a sinistra, foglio centrale con formati A4/A5/A6 e dimensioni modificabili, drop box con anteprima, colonna a destra per scorrere l'anteprima del movimento — che durante il disegno vero diventa indicatore di avanzamento. Tab separate per log e impostazioni
- L'anteprima distingue **tratti disegnati e spostamenti a vuoto** con colori diversi: vedere gli spostamenti a vuoto è il modo per accorgersi che il disegno è ordinato male
- **L'interfaccia dovrà essere servita dall'ESP32 per comandare la macchina.** FluidNC espone il suo HTTP senza intestazioni CORS, e una pagina in HTTPS non può comunque interrogare un dispositivo in HTTP semplice: online-ovunque più comando diretto è una combinazione che il browser vieta. Conseguenza operativa: niente framework, niente librerie, niente processo di build, perché la pagina deve stare nella memoria dell'ESP32
- **Il calcolo resta nel browser anche quando la pagina è servita dall'ESP32.** Il microcontrollore consegna il file, il processore del PC o del telefono fa il lavoro. L'ottimizzazione del percorso del logo di prova ha impiegato 1 ms
- **Il criterio dell'ottimizzazione è il tempo, non la distanza.** Un'alzata di penna costa circa mezzo secondo fra movimento del servo e assestamento; cinquanta millimetri di spostamento a 2000 mm/min ne costano uno e mezzo. Saldare i tratti contigui vale quindi più che accorciare gli spostamenti, e viene prima nella catena
- **Modalità finta sempre disponibile**: l'interfaccia simula le risposte della macchina, così ci si lavora senza accendere nulla — che è la maggior parte del tempo
- **Il nome è GDC CNC 2D SLICER** (deciso dall'utente il 2026-10-15). Regge il confronto con quello che l'applicazione fa davvero: non è solo una pulsantiera, converte un disegno in percorsi utensile — che è esattamente il lavoro di uno slicer, con la differenza che il risultato è piano invece che a strati
- **La tab Impostazioni è l'unica fonte di verità dei numeri della macchina** (deciso il 2026-10-15). Oggi gli stessi valori vivono in tre posti che non si parlano: i `#define` del firmware della dashboard, il `cnc2d-config.yaml` di FluidNC e i default dell'anteprima nel browser. Finché è così, tarare la macchina vuol dire ricordarsi di cambiare lo stesso numero tre volte, e il giorno che se ne dimentica uno l'anteprima mostra un disegno che la macchina non fa. La tab deve **contenere i valori, salvarli e poterli esportare**, e anteprima, generatore di G-code e macchina devono leggerli tutti da lì
- **Due passi/mm, uno per asse, non uno globale** (2026-10-15). Le due cremagliere sono stampate separatamente e si sono ritirate di quantità diverse: un valore solo fa uscire i quadrati rettangoli. Oggi il firmware della dashboard ne ha uno solo, calcolato da `MM_PER_REV`; FluidNC li ha già separati per asse

- **Il pannello di controllo manuale entra nel GDC CNC 2D SLICER come sezione di prima classe** (richiesta dell'utente, 2026-10-19). Non è una comodità: senza finecorsa è **l'unico modo** di stabilire un'origine, e tutte le misurazioni di taratura passano da lì. Scritto una volta e mostrato in due posti — una tab dedicata per le sessioni di misura, e lo stesso componente incorporato nei popup di inizio stampa — altrimenti le due copie divergono. Nella tab Disegno l'impalcatura esiste già (`webui/js/jog.js`: pad di jog, selettore del passo, "Imposta origine qui", penna su/giù, STOP), tutta disabilitata, più due pulsanti d'angolo che sono segnaposto
- **Profilo macchina salvabile, sul modello dei profili di stampa** (richiesta dell'utente, 2026-10-19). Il profilo tiene tutto ciò che è proprietà della macchina e si misura una volta: passi/mm per asse, corse, velocità e accelerazioni, inversioni, margine di sicurezza, estremi dell'impulso del servo più i quattro angoli, offset utensile. È il profilo il documento sorgente, e `config.yaml` è il suo **prodotto**: così resta un solo posto in cui si scrive, coerente con la decisione del 2026-10-15
- **Le due misure di inizio stampa non entrano mai nel profilo come default.** L'origine XY e l'altezza di appoggio della penna sono misure *del momento*: dipendono da dove è appoggiato il foglio e da quanto è spesso. Salvarle come default significa, dopo un riavvio, fidarsi di un'origine che non vale più — ed è il modo classico di mandare il carrello contro il telaio. Si conservano come **"ultimo valore usato"**, mostrato nel popup come suggerimento, mai applicato da solo
- **"Imposta origine qui" e "registra questa misura" sono due pulsanti diversi.** Il primo è `G92 X0 Y0`, un atto di inizio stampa. Il secondo prende la lettura corrente del DRO e la scrive in un **campo preciso** del profilo (corsa X, corsa Y, offset utensile...), quindi vive accanto a quel campo nelle impostazioni, non accanto al pad di jog. Nella richiesta dell'utente erano un pulsante solo
- **Differenza con i profili di Bambu Studio, e conta:** una Bambu all'accensione sa dove si trova, perché ha i finecorsa. Questa macchina non lo sa. Il profilo può quindi contenere tutto **tranne la posizione**, ed è esattamente il motivo per cui i due popup di inizio stampa esistono e non si possono ottimizzare via

**Che cosa deve contenere la tab Impostazioni** (lista di lavoro, da completare
mano a mano che le misure arrivano):

| Gruppo | Valori |
|---|---|
| Trasmissione | passi/mm **per asse**, microstep impostati sui ponticelli, inversione di direzione per asse |
| Corse | corsa utile per asse (`max_travel_mm`), origine dell'area di disegno, posizione e formato del foglio nel piano |
| Dinamica | velocità massima e accelerazione per asse, velocità di disegno distinta da quella di spostamento a vuoto |
| Penna | **angolo di battuta** (cuscinetti in fondo ai blocchi inferiori: limite meccanico, il software non scende sotto), **angolo penna appoggiata** (sopra la battuta; è anche l'angolo a cui tenere il servo mentre si infila e si stringe la penna), **angolo penna alzata** (sopra l'appoggio), **angolo di battuta alta** (secondo limite meccanico), raggio del pignone del servo (18,750 → 0,32725 mm/grado, per inserire alzata e appoggio in millimetri invece che in gradi), verso di rotazione, passo della rampa del servo, pausa dopo ogni su/giù (150÷250 ms) |
| Utensile | offset della punta rispetto al riferimento del carrello (X e Y), altezza del piano carta |
| Compensazioni | gioco d'ingranamento per asse, se si deciderà di compensarlo |

**Criterio di completamento:** caricare un SVG, vederlo posizionato nel foglio, generare il G-code e farlo eseguire alla macchina

**Note (cronologia dello step):**
- [2026-09-24] Costruita l'impalcatura completa (`webui/`, dodici file): tre colonne, tab Disegno/Log/Impostazioni, foglio con formati, cursore verticale per scorrere l'anteprima del percorso
- [2026-09-24] Rifatta l'area centrale: il riquadro è ora **il piano della macchina**, fisso, con reticolo da 10 mm e lo zero macchina marcato; il foglio è un rettangolo disegnato dentro, trascinabile col puntatore, e il suo bordo diventa rosso quando esce dall'area. Il disegno è tenuto in coordinate del foglio, quindi lo segue per costruzione
- [2026-09-24] Importazione SVG funzionante: l'appiattimento delle curve lo fa il browser campionando `getPointAtLength` per lunghezza d'arco, e lo stesso campionamento riconosce i sotto-tracciati (due campioni non possono distare più del passo, quindi un salto più lungo è uno stacco di penna dentro lo stesso elemento — il foro di una "o")
- [2026-09-24] Ottimizzazione e G-code funzionanti. Sul logo dell'utente: 11 tratti, 294 punti, spostamenti da 769 a 424 mm, circa 1 min 15 s stimati, calcolo in 1 ms. La stima del tempo usa un profilo trapezoidale per polilinea, perché il look-ahead di FluidNC mantiene la velocità fra segmenti consecutivi
- [2026-09-24] Resta da fare: invio del programma alla macchina, avanzamento in tempo reale, caricamento della pagina sull'ESP32, conversione da fotografia a tracciato
- [2026-10-15] **Battezzata GDC CNC 2D SLICER** su proposta dell'utente, e stabilito che la tab Impostazioni va riprogettata bene prima di riprendere il resto: è lì che finiranno tutte le misure di taratura, e progettarla male significa doverla rifare dopo averci messo dentro i numeri
- [2026-10-15] Registrato che **il firmware della dashboard espone un solo passi/mm** per entrambi gli assi (`stepsPerMm()`, calcolato da `MM_PER_REV`): va separato per asse prima della taratura
- [2026-10-20] **Nomenclatura concordata con l'utente prima di scrivere il codice**, e messa in `misure/impostazioni-glossario.md`. Due profili (macchina e stampa), «mm per giro ingranaggio» per asse, corsa totale / corsa percorribile / margine di sicurezza come tre parole distinte, «punto ai blocchi» e «punto home», «altezza di contatto col foglio». Il glossario si cambia **prima** del codice
- [2026-10-20] **Tab Impostazioni ricostruita** sul modello del profilo: binding per percorso (`data-bind`), etichette di provenienza su ogni campo, generatore di `config.yaml`, esportazione e importazione JSON, taratura del rapporto da una figura disegnata
- [2026-10-20] **Pannello manuale scritto come componente** (`webui/js/panel.js`) e montato in tre posti, come previsto dalla decisione del 2026-10-19. Verificato sulla documentazione FluidNC: `$MD` libera i motori, e **non esiste un comando per riaccenderli** — li riaccende il primo movimento. Conseguenza di progetto: «Homing completato» manda un jog da 0,01 mm e subito dopo `G92`, in quest'ordine
- [2026-10-20] **Tre popup di inizio stampa** (`webui/js/popup.js`), ognuno col suo blocco e col motivo scritto. Il programma si **rigenera dopo il terzo**, perché l'origine del foglio sposta le coordinate e l'altezza di contatto sposta la Z
- [2026-10-20] **La pausa della penna è arrivata nel G-code.** Il numero stava nel profilo dal 19 e il generatore non lo usava
- [2026-10-20] **Resta da fare:** invio del programma alla macchina, caricamento della pagina sull'ESP32, conversione da fotografia a tracciato. L'invio si scrive quando FluidNC sarà acceso: scriverlo adesso sarebbe codice di rete non collaudato su un protocollo mai visto rispondere
- [2026-10-20] **IDEA PARCHEGGIATA — compensare il fuori-piano via software**, proposta dall'utente: una mappa del piano presa con la penna, e il generatore che ritocca la Z punto per punto, come il mesh bed levelling delle stampanti 3D. Non si fa adesso, si decide **dopo la stampa di collaudo**, ma va ricordata perché l'alternativa è rifare il piano. Due cose da sapere quando ci si torna: (1) **i dati li raccoglie già la prova 11** del disegno di collaudo, i nove nodi a gradini *sono* la mappa, basta trascriverli; (2) **la soglia che decide è la banda morta del servo, 0,295 mm** — la compensazione può muovere la penna solo a scatti di circa tre decimi, quindi sotto 0,3 mm di fuori-piano è inutile, fra 0,5 e 1 mm è grossolana, oltre il millimetro è la strada giusta
- [2026-10-19] **Procedura di accensione e taratura scritta per intero** in `misure/accensione-e-taratura.md`, su richiesta dell'utente. Due fasi distinte: **Fase A** (una volta, produce il profilo macchina) e **Fase B** (ogni stampa). Apre con una tabella di cosa esiste davvero oggi, perché è una procedura di arrivo e seguirla adesso non funzionerebbe. Tre cose emerse scrivendola, tutte nuove:
  1. **I tre angoli del servo si rilevano con la dashboard, prima di flashare FluidNC**, e non dopo: la dashboard ha lo slider, lo stato `free` all'accensione e la rampa di avvicinamento, FluidNC nessuno dei tre. Flashare FluidNC cancella la dashboard, quindi l'ordine non è reversibile a costo zero.
  2. **Al primo avvio di FluidNC la penna va togliersi dai morsetti.** FluidNC porta l'asse Z alla posizione zero all'avvio, e con la mappatura prevista lo zero è *penna appoggiata*: con la penna montata la punta scende a premere sul piano. Da osservare al primo avvio; se il movimento è brusco si invertono `min_pulse_us` e `max_pulse_us` così lo zero diventa la posizione alzata e l'avvio è sempre nella direzione innocua.
  3. **L'offset utensile resta a zero, e non è una dimenticanza:** l'origine si imposta portando *la punta della penna* sul punto, quindi l'offset fra riferimento del carrello e punta è già assorbito. Servirebbe solo se i limiti fossero riferiti al carrello, e i limiti sono disattivati. Annulla il requisito "offset utensile nel modello dati, a zero" dello Step 6 come cosa da misurare: resta come campo, ma non c'è niente da metterci finché l'origine la dà la punta
- [2026-10-19] **Per l'asse Z del servo, `max_travel_mm` va messo all'alzata reale in mm** (2÷3), non a 10: così `Z0` è l'appoggio e `Z3` l'alzata, e Z è in millimetri veri di penna invece che in unità arbitrarie. L'angolo di **battuta** non entra nel YAML — vive nel profilo del SLICER come limite, e serve a una cosa sola: il software non deve mai poter comandare una Z che lo raggiunga
- [2026-10-19] **Scritto il modello del profilo, `webui/js/profile.js`.** È lo scheletro su cui poggiano sia il pannello manuale sia la tab Impostazioni, e la decisione del 2026-10-15 ("la tab è l'unica fonte di verità") diventa codice: il profilo è il documento sorgente e `config.yaml` si **genera** da lui con `toYaml()`. Scelte di struttura degne di nota:
  - **`null` non è zero.** I tre angoli del servo partono a `null`, che vuol dire "non ancora misurato": `verifica()` si rifiuta di dare il via libera finché ce n'è uno in giro, invece di far finta che valga zero
  - **Niente valori derivati salvati.** Passi/mm, limiti di lavoro, mm/grado e alzata in mm si ricalcolano sempre dai dati grezzi. Un numero calcolato e poi salvato è un numero che un giorno non corrisponderà più a quello da cui era stato calcolato
  - **La mappa dei pin è una costante del generatore, non un campo.** È cablaggio, non taratura, e un campo modificabile per i pin è solo un modo per rompersi la macchina da un menu — tanto più dopo averli sbagliati davvero stamattina
  - **`fondi()` al caricamento**: il salvato si fonde sui valori di partenza invece di sostituirli, così un profilo salvato con una versione vecchia non lascia campi `undefined` quando il modello cresce
  - **`verifica()` non torna un booleano** ma l'elenco di cosa manca, con gravità: chi lo legge deve poter dire all'utente *che cosa* blocca
  - **`stanoDentro()` vive nel profilo**, non dentro un pulsante: senza finecorsa è l'unica protezione contro un movimento fuori area, e deve essere un posto solo
- [2026-10-19] **Collegata l'area di lavoro al profilo.** `State.data.area` non è più il 300 × 300 inventato ma `Profile.areaUtile()`, cioè corsa meno margine: con i numeri misurati oggi fa **249,5 × 235,0**. Anche i due campi dell'area nella tab Impostazioni ora scrivono nel profilo invece di tenerne una copia — spariranno quando la tab sarà riprogettata, perché corsa e margine vanno inseriti separati, essendo due cose diverse
- [2026-10-19] **Margine di sicurezza messo a 8 mm per asse** nei valori di partenza, non 5: deve coprire l'errore di parcheggio dell'origine manuale, che a occhio vale qualche millimetro. Scenderà quando ci sarà un riferimento fisico o i finecorsa
- [2026-10-19] **La granularità del servo e il gioco della cremagliera sono la stessa cifra, ed è il motivo per cui il pen-lift funziona.** La banda morta di un SG90 è ~10 µs su 2000 µs per 180°, cioè 0,9°, che a raggio 18,750 vale **0,295 mm** alla punta. Il gioco d'ingranamento della coppia è **0,30 mm**. Coincidono: la penna galleggia sul proprio peso esattamente dentro l'intervallo che il servo non sa risolvere. Conseguenza pratica: **non ha senso stringere uno dei due senza l'altro**, e il gioco della cremagliera va lasciato dov'è
- [2026-10-19] **Terzo popup: "inizio foglio", dopo quello dell'altezza penna** (richiesta dell'utente). I tre popup fanno tre cose diverse e tenerli distinti conta, perché il primo e il terzo sembrano lo stesso gesto fatto due volte: il **popup 1** fissa l'origine macchina, un punto prestabilito sempre lo stesso, che dà senso alle coordinate e ai limiti e sparisce il giorno dei finecorsa; il **popup 2** trova la quota di appoggio su *questa* carta; il **popup 3** dice dove è appoggiato il foglio *questa volta*, in coordinate macchina. Il terzo è anche quello che rende vera l'unica protezione disponibile senza finecorsa: sapendo dove è il foglio davvero, il controllo dell'ingombro si fa sulla posizione reale invece che su una presunta. E l'ordine chiesto dall'utente (altezza penna prima dell'inizio foglio) ha un vantaggio concreto: cercando l'angolo del foglio la quota di appoggio è già nota, quindi si può abbassare un attimo e farsi confermare da un puntino
- [2026-10-19] **Il margine di sicurezza nel profilo deve coprire l'errore di parcheggio dell'origine**, non essere un numero di comodo: con un parcheggio a occhio di ±5 mm, un margine di 5 mm non protegge niente. Il modo per stringerlo non è essere più precisi a occhio, è dare al parcheggio un **riferimento fisico** — un blocchetto stampato avvitato alla base contro cui il carrello va in battuta, errore zero per definizione. È l'alternativa economica ai microswitch e si può fare in qualunque momento
- [2026-10-19] **Il flusso di inizio stampa, definito dall'utente:** accendi → *slice* → controllo → *stampa* → popup con il pannello manuale per portare la punta sul punto di origine → "homing completato" → popup con il pannello manuale per portare la punta all'altezza di appoggio → "altezza penna completato" → parte la stampa. Approvato nella sostanza, con tre correzioni: (1) il popup XY deve **alzare la penna prima** di abilitare il jog, altrimenti si trascina la punta sul foglio per tutto il posizionamento; (2) dopo "altezza penna completato" l'app deve **alzare subito**, perché quel popup finisce con la punta che tocca; (3) il programma deve cominciare con alza → vai al primo punto → abbassa, altrimenti traccia una riga dall'origine all'inizio del disegno
- [2026-10-19] **Il punto di origine manuale è un'origine di lavoro, non un riferimento macchina**, e i limiti non vanno agganciati a lui. La frase "da quel punto si setta tutta la macchina" è la trappola che il documento aveva già descritto il 2026-10-06 ("si crede di essere a 25 mm e si è a 12"): la ripetibilità di un posizionamento a occhio è di qualche millimetro, e se i limiti sono riferiti a lui l'errore di parcheggio diventa errore di limite. Per **dove cade il disegno sul foglio** qualche millimetro va benissimo, perché la posizione del foglio è comunque arbitraria. Quindi: origine manuale sì, limiti agganciati a lei no
- [2026-10-17] **Il gruppo Penna della tab Impostazioni diventa quattro angoli più una conversione**, su richiesta dell'utente. Il valore che mancava è l'**angolo di battuta**, cioè quello a cui i cuscinetti arrivano in fondo ai blocchi inferiori: è un limite meccanico, non una preferenza, e il software non deve poter scendere sotto. Sopra c'è l'angolo di appoggio — che è anche quello a cui tenere il servo mentre si infila la penna e si stringono i morsetti, perché è la stessa posizione — e sopra ancora quello di penna alzata. Aggiunta mia: serve anche la **battuta alta**, perché la pista è limitata dalle due parti (15,350 di salita contro 11,000 di discesa), e serve il **raggio del pignone** come unico parametro di conversione, così alzata e appoggio si inseriscono in millimetri e la pagina li traduce in gradi (0,32725 mm/grado a r = 18,750). Senza quel campo ogni numero della sezione penna è in gradi e nessuno è leggibile
- [2026-10-21] **Disegno di collaudo** (`webui/tools/test-macchina.js` e `font-tratto.js`): una stampa su 246 × 233 mm con **undici prove in riquadri numerati**, dalla scala per asse all'ortogonalità al gioco al livello del piano, più ripetibilità e velocità. Genera SVG per guardare o G-code per stampare, e il G-code vero si produce **dopo** la taratura della penna, coi numeri veri. Come si legge sta in `misure/disegno-di-collaudo.md`, prova per prova e con l'ordine di lettura — livello e stacchi per primi, perché se il piano è storto tutto il resto è misurato male
- [2026-10-22] **I programmi devono stare in 64 kB**, ed è il browser dei file di FluidNC a dirlo: la partizione LittleFS è 192 kB e `index.html.gz` della WebUI ne occupa 111. Il collaudo scritto per esteso ne occupava 69 e non ci sarebbe entrato. I due generatori emettono ora **G-code modale** — solo quello che cambia — e il collaudo passa a 44.633 byte, con il percorso verificato stato per stato (2994, zero differenze). Stesso conto per l'autonomia del SLICER: **66 kB compressi contro 64 liberi**, quindi ospitarlo chiede un file unico e la rimozione della WebUI di FluidNC.
- [2026-10-23] **Il generatore produce finalmente quote che la macchina esegue.** La convenzione Z vive in un punto solo (`Profile.zDaGradi()`) e la prendono tutti; i programmi finiscono al **punto home** e non più addosso ai blocchi, che è il difetto che il profilo avvertiva da sempre nel commento di `puntoHome`. Soppresse le righe di sola velocità che non muovono niente. Nati cinque generatori nuovi — cornice dell'area utile (con la procedura della penna dentro il file, via `M0`), prova geometrica, vortice, riempimenti, intreccio — e tutti i file rigenerati. **Il conto sull'ospitare il SLICER è stato rifatto sul sorgente e la conclusione si è irrigidita:** in tutto il server web di FluidNC non c'è una sola intestazione CORS, quindi la pagina **deve** essere servita dall'ESP32, non è una preferenza. Il nostro bundle gzippato è 62.539 byte contro i 111.625 della WebUI: togliendola restano ~113 kB liberi invece di 64.
- [2026-10-24] **L'invio del programma non è più solo una comodità: è la cura di un guasto.** Confermato sulla macchina che il blocco delle stampe lunghe nasce dal canale HTTP che `$LocalFS/Run` si tiene aperto per l'intera durata del job (vedi Step 3). Mandando il G-code **riga per riga** quel canale non esiste: non c'è niente che debba restare appeso per venti minuti. Conseguenza sul progetto dell'invio: lo stato della stampa va ricostruito dal nostro lato contando le righe accettate, non chiedendolo a un comando che blocca, e serve una coda con controllo di flusso sugli `ok` invece di un'unica richiesta lunga.
- [2026-10-24] **L'invio esiste, e il programma è diventato l'interfaccia della macchina.** `sender.js` manda il G-code riga per riga su un WebSocket solo, con al più 16 righe non confermate in volo: il freno è l'`ok`, che FluidNC manda quando la riga è entrata nel pianificatore. Non send-and-wait, che lascerebbe il pianificatore vuoto e la macchina a scatti; non tutto insieme, che riempirebbe la memoria della scheda — il lato in ingresso di quel socket non ha né limite né contropressione. L'interruzione **non è un reset**: accoda alzata e ritorno a casa, così il `G92` sopravvive. Attorno all'invio, la giornata di interfaccia: tastierino a otto direzioni con le quote della penna al centro, fogli personalizzati, fogli più grandi della corsa, rotella sul piano, la tavola di legno disegnata e misurata, colonne ridimensionabili. **Provato sulla macchina:** collegamento, jog, homing, vai al punto. **Non ancora provato:** un programma intero. Prove da 230 a 389 asserzioni.
- [2026-10-24] **L'editor SVG è in pipeline ma non costruito, e c'è una precondizione da sapere prima di cominciarlo:** `SvgImport.parse` appiattisce le curve in polilinee al caricamento, quindi su un disegno importato non esiste più nessuna Bézier a cui attaccare una maniglia. Il primo pezzo di lavoro è un modello di tracciato che TIENE le curve e le appiattisce solo in uscita verso il G-code. Direzione scelta: **modificare prima di creare**.
- [2026-10-25] **Il SLICER ha stampato.** Intreccio all'80 % su foglio 270 × 255, cornice **191,7 × 187,7 mm misurata contro 191,7 × 187,7 previsti**: la catena scala → riadattamento al foglio → G-code non distorce niente, e il criterio del millimetro regge anche passando dall'app. Movimento **continuo**, nessuna esitazione fra un segmento e l'altro: la finestra da 16 righe non lascia a secco il pianificatore e non si tocca. Stima del tempo accettata dall'utente senza cronometro, quindi resta com'è.
- [2026-10-25] **Interruzione e pausa provate sulla macchina, e sono due strumenti diversi.** Lo stop alza la penna, torna a casa e **non perde l'origine** — verificato subito dopo con «vai al punto», che è la prova vera che il `G92` è sopravvissuto. Ha però una latenza: fino a 16 righe sono già nella scheda quando si preme, e il pianificatore si consuma, non si svuota. Nell'intreccio il segmento medio è **8,17 mm** e il mediano **2,71**, quindi fra 4 e 13 cm di inchiostro, **2÷6 secondi** a 1200 mm/min. Accorciarla vorrebbe dire un soft reset, che cancella il `G92`: non si fa. La **pausa** invece è immediata e lascia la penna appoggiata, ed è esattamente quello che serve per il cambio penna.
- [2026-10-25] **L'anteprima cambia dopo «prepara», ed è voluto.** Prima mostra i tracciati nell'ordine del file; `prepare()` fa girare l'ottimizzatore (scarta i doppioni, salda i tratti contigui, riordina) e **riscrive `State.data.art` col percorso ottimizzato**. Da quel momento piano e cursore mostrano quello che la macchina farà davvero: l'inchiostro è identico, l'ordine e gli spostamenti a vuoto no. Un'anteprima che restasse quella di prima sarebbe una bugia proprio nel momento in cui si guarda per decidere se partire.
- [2026-10-25] **RICHIESTA UTENTE — pausa programmata per il cambio penna**, per disegni a più colori. Progetto abbozzato, non costruito: i punti di pausa si segnano **sull'anteprima dopo la preparazione**, e devono poter cadere solo **al confine fra due tracciati**, mai a metà di un tratto. Il motivo è che lì il programma ha già la sequenza giusta — alza, pausa, sposta, abbassa — quindi non c'è nessuno stato da ripristinare alla ripresa: senza quel vincolo bisognerebbe ricordare e rifare posizione e quota prima di riprendere, e un cambio penna a punta abbassata lascia comunque una macchia. Il marcatore va onorato dal **Sender**, non da un `M0` del firmware: così la pausa può alzare la penna e portarla in un punto comodo, e la ripresa è un pulsante dell'interfaccia.
- [2026-10-25] **Il peso della pagina è diventato un vincolo da sorvegliare:** 97.126 byte compressi contro ~113 kB liberi sull'ESP32. Sedici kilobyte di margine, e l'editor SVG è la cosa più grossa che resta da scrivere. La decisione su **dove vive la pagina** va presa prima dell'editor, non dopo: o si divide il bundle e si carica l'editor a richiesta, o sull'ESP32 va solo la parte che comanda la macchina e l'editor resta sul PC.
- [2026-10-25] **La pausa per il cambio penna.** Si segna col cursore dell'anteprima, dopo la preparazione, e si ferma **solo al confine fra due tratti**, mai a metà di uno: lì il programma ha già fatto alza → sposta → abbassa, quindi alla ripresa non c'è nessuno stato da ricostruire — e cambiare penna con la punta appoggiata lascerebbe comunque una macchia. Il segno è un commento `;PAUSA` che **la macchina non vede**: lo riconosce il Sender, quindi lo stesso file resta eseguibile da chi di queste pause non sa niente. Il generatore, dopo ogni segno, **azzera lo stato modale**: senza, una riga come «X120» — che in G-code vuol dire «Y resta dov'è» — avrebbe ripreso da una Y cambiata nel frattempo, e il disegno sarebbe proseguito a qualche centimetro di distanza.
- [2026-10-25] **Otto maniglie e il taglio col tasto destro.** Ai quattro angoli si aggiungono i punti di mezzo dei lati, per deformare lungo un asse solo. Il **ritaglio è un rettangolo a parte** dentro a quello del disegno: `box` dice quanto è grande, il ritaglio quanto se ne vede, e tenendoli separati ritirando la maniglia il disegno torna fuori — non è mai stato cancellato, solo nascosto. Il taglio vero lo fa Liang-Barsky segmento per segmento, e un tratto che esce e rientra si spezza in due, che è giusto: sono alzate di penna vere.
- [2026-10-25] **Lo zero e il punto home segnati sul piano**, perché a cinque millimetri si confondono e il foglio si posiziona rispetto a tutti e due. Scoperto nel farlo che **il pallino rosso che sembrava lo zero era la penna dell'anteprima**, parcheggiata a 0,0 quando non c'è percorso: due cose diverse nello stesso posto e dello stesso colore. Verificato col collaudo, non a occhio, che lo zero dei righelli e lo zero macchina cadono sullo **stesso pixel**, adattati e ingranditi.
- [2026-10-25] **I LIVELLI.** Non c'è più un disegno: c'è un elenco di livelli, ognuno col suo rettangolo, rotazione e ritaglio. **L'ordine è la sequenza della stampa**, e l'unità con cui si ragiona di penne: un livello si disegna tutto di fila, e fra uno e l'altro ci si ferma. L'ottimizzazione ha tre ambiti — tutto / per livello / niente — con «per livello» predefinito; con «tutto» i cambi penna vengono tolti e il registro lo dice, invece di stampare in silenzio qualcosa di diverso da quello che si vede.
- [2026-10-25] **Le curve restano curve.** `svgpath.js` legge l'attributo `d` comando per comando e ne escono nodi con le maniglie; `tracciato.js` è il modello, e `SvgImport.parse` è diventato `appiattisciTutte(parseForme())`. L'appiattimento è l'ultimo passo invece del primo, ed è quello che rende possibile modificare una curva importata. **Chiude la precondizione segnata il 2026-10-24.**
- [2026-10-25] **L'editor esiste.** Sei strumenti, nodi e maniglie trascinabili, doppio clic per passare da spigolo a curva, taglio, testi che restano testi. **La y va in giù** come in un file SVG, perché è quel file che si sta modificando; il ribaltamento resta uno solo, in `toRect`. **La tela non ha formato né dimensioni**: quanto diventa grande il disegno lo decidono le maniglie sul foglio. E modificare una forma **non sposta il disegno sul foglio**: si tiene fermo il legame fra le due coordinate e il rettangolo si adegua, se no spostare un nodo rimpicciolirebbe tutto il resto.
- [2026-10-25] **Magneti e annulla.** Tre aiuti in ordine di forza — nodo vicino, angolo entro sei gradi da un multiplo di 45, allineamento in x o y — con Alt per spegnerli un gesto e Shift per forzare l'angolo. L'annulla è una **pila di istantanee**, con una fotografia per gesto e il rettangolo del livello dentro all'istantanea.
- [2026-10-25] **Quello che all'editor manca ancora**, per quando ci si torna: selezione multipla, agganci a una griglia, e la conversione di un segmento dritto in curva senza passare dal nodo. Un tratto importato dai nostri file **non ha curve** perché i file sono fatti di polilinee: le maniglie si mettono col doppio clic. Su un SVG preso dal web le curve ci sono già.

- [2026-10-26] **I quattro angoli del foglio e il punto home sul tastierino**, con la penna che **si alza prima di partire**: questi pulsanti si premono per guardare dove sta il foglio, e un traverso da duecento millimetri con la punta appoggiata lascia una riga dritta in mezzo al disegno. Un punto fuori corsa spegne il suo pulsante e dice di quanto, perché senza finecorsa non c'è nient'altro che fermi il carrello. Gli angoli sono quattro e non tre: tutti e quattro sono **punti limite**, mentre il punto home non lo è — distinzione dell'utente, che ha corretto la mia.
- [2026-10-26] **Il tastierino è fatto di quadrati concentrici**: 5 × 5 di caselle quadrate con un 3 × 3 al centro, stesso passo e stesso vuoto, quindi concentrici per costruzione e non per aggiustamento (misurato: 300 × 300 e 171 × 171). I quattro angoli del foglio stanno **sul giro**, ognuno dalla parte sua: quello dell'angolo in alto a destra in alto a destra. La posizione diventa l'informazione, come il pallino nel rettangolino e le tacche delle quote. I segni delle tre quote sono una penna che scende verso la riga del piano: la tacca di prima diceva l'altezza ma non di che cosa.
- [2026-10-26] **L'editor ha chiuso le tre cose che mancavano**: selezione multipla (rettangolo e Shift+clic, spostamento e Canc sul gruppo), **griglia in millimetri del foglio** — convertiti con la scala del livello, perché le unità di un file possono valere un millimetro come un metro — e strumento **Curva**, che piega un tratto senza passare dal nodo. Un segmento dritto **è già** una cubica con le maniglie a un terzo e due terzi della corda: scriverle non sposta niente, e da lì il tratto segue il dito. Fra tutte le coppie di maniglie che portano il punto dove lo si tira si prende quella che le sposta di meno.
- [2026-10-26] **La griglia è un interruttore suo, separato dai magneti, e non ha tolleranza.** Accesa, il punto va sempre sull'incrocio più vicino: una griglia che aggancia solo quando le passi vicino lascia i punti in mezzo, cioè non è una griglia. Su una tela vuota la scala non esiste e un'unità vale un millimetro; dalla seconda forma in poi i millimetri sono quelli veri.
- [2026-10-26] **UN LIVELLO PER TINTA.** Si butta via solo lo sfondo — la forma senza bordo che copre tutta la tela —; tutto il resto entra diviso per colore di bordo o di riempimento, un livello per ciascuno. Le tinte piene di un file che ha anche dei bordi **nascono spente**, quindi il risultato di partenza è identico a prima, ma quello che prima spariva in silenzio adesso sta nell'elenco con il suo occhio. I livelli di uno stesso file **si adattano insieme**: il rettangolo si calcola sul disegno intero e si ritaglia per ciascuno, se no le facce di un cubo verrebbero scalate diversamente dai suoi spigoli. **Chiude il difetto che la regola del bordo introduceva il 2026-10-25.**
- [2026-10-26] **L'elenco dei livelli è diventato comandabile.** Occhio e occhio sbarrato (un pallino non dice «visibile»: lo dice solo a chi lo sa già), tre lineette da trascinare con l'ordine che cambia davvero mentre si muove, cambio penna cliccabile dalla riga, spunta di selezione che **commuta** — quindi si può arrivare a non aver scelto niente, e il pulsante torna a dire «Crea» —, doppio clic che apre il riquadro sul foglio, etichetta **edit** sui livelli toccati nell'editor. L'etichetta **confronta e non annulla**: mostra com'era prima e rimette le modifiche, e la fotografia si prende al primo gesto, una volta sola.
- [2026-10-26] **Il riquadro lavora su più livelli e ruota senza perdere niente.** Con più livelli scelti è l'unione dei loro rettangoli e le modifiche si distribuiscono in proporzione, quindi i rapporti fra i disegni restano. Scala e rotazione restano del livello principale: ruotare un gruppo attorno a un centro comune non è ruotare, è ruotare *e spostare*. Quattro **maniglie di rotazione** agli angoli, tonde e fuori dal riquadro perché la forma dica il gesto, con scatto ogni quindici gradi. **Rotazione non distruttiva**: restano fermi centro e scala, i due fattori si scambiano a un quarto di giro e il ritaglio gira insieme.
- [2026-10-26] **Caduto il tetto dei kilobyte, cadono le rinunce che lo servivano:** `build.py` metteva fuori il disegno di esempio a ogni compilazione, e adesso lo tiene; per la scheda resta `--leggero`. La pagina è **505.357 byte** in un file solo. Collaudata **sul file unico** e non più solo sui sorgenti (`dist-test.js`): si apre, carica, genera, apre l'editor.
- [2026-10-26] **Quello che all'editor manca ancora:** niente di quanto era segnato il 25 — selezione multipla, griglia e curve ci sono. Resta da capire, quando servirà, se un comando «separa in segmenti» serve davvero: l'ottimizzatore ricuce le polilinee contigue (152 tracciati dell'isometrico diventano 13 tratti di penna), quindi separare non costa alzate di penna, ma **non toglie i doppioni** — `dedupe` gira prima di `join` e un poligono chiuso non ha la stessa chiave di quattro segmenti separati. Misurato: accendendo anche il livello di occlusione dell'isometrico i tratti passano da 26 a 52.

- [2026-10-26] **Il cambio penna è due popup e nessun conto.** La procedura è quella dettata dall'utente: la macchina arriva al segno, mette la penna in **tappo** e va a **home**; primo popup, «togli la penna»; il servo scende alla **quota di contatto**; secondo popup, «monta la penna nuova» con i due pulsanti «alzata» e «contatto» per provarla e il pulsante che riprende. La versione precedente, scritta la mattina, **rimisurava la quota di contatto della penna nuova e spostava di conseguenza tutte le Z rimaste** nel programma: venticinque righe di aritmetica **cancellate**, perché montando la penna *alla quota che il programma usa già* non c'è più niente da correggere. È la penna che si adatta al programma, non il programma alla penna — e il conto che chiude la questione è che la banda morta del servo (0,9°) vale **0,29 mm** alla punta, mentre la differenza di spessore fra due fogli sta sotto il decimo: si stava correggendo una cosa più piccola di quello che la macchina sa fare.
- [2026-10-26] **«Scegli» prende il tratto, non la linea.** Un clic seleziona **il segmento fra due nodi** e Canc toglie quello: è la richiesta dell'utente dopo aver ripulito a mano un livello dell'isometrico, dove per cancellare un lato bisognava prima spezzare la polilinea aggiungendo due nodi. Togliere un tratto da un percorso chiuso lo riapre dal primo segmento rimosso, così non resta un anello che si richiude da solo. **Ctrl somma i tratti** (ricliccandone uno lo rimette fuori) e un Canc li toglie tutti insieme: dieci linee, un tasto.
- [2026-10-26] **L'editor ha i livelli.** Striscia con occhio e riga selezionabile, come nella tab del foglio: si lavora su un livello per volta e gli altri si vedono in trasparenza sotto o si spengono. Senza, portando un file in due tinte nell'editor si poteva modificare solo la tinta attiva — ed era il caso vero, perché l'isometrico sono due livelli da ripulire. **L'annulla è per livello**, non globale: una pila di istantanee per ciascuno, se no tornare indietro su un livello disfaceva il lavoro fatto sull'altro.
- [2026-10-26] **Quattro cose trovate usando il programma, non provandolo.** (1) Il nodo nuovo cadeva **sulla linea sotto** invece che su quella scelta: dove due linee si incrociano la più vicina cambia a ogni pixel, quindi la selezione è diventata **appiccicosa** — se il clic è ancora entro il raggio di presa, resta scelto il tratto che era scelto. (2) Il nodo troppo vicino a un capo creava un **segmento da un pelo**: entro quattro pixel dal capo non si inserisce più niente. (3) Due **Ctrl+clic** di fila valevano un doppio clic, quindi inserivano un nodo e azzeravano il gruppo — la stessa trappola già chiusa per Shift il giorno prima, riaperta dal tasto nuovo. (4) **L'occhio non spegneva il livello attivo**, per una scelta mia: l'utente ha dato il controesempio che la smonta («se li oscuro tutti e cambio livello comunque vedo quello in cui sono»), quindi adesso lo spegne e un livello spento non si può nemmeno scegliere.
- [2026-10-27] **Il numero di versione è contato, non incrementato.** Accanto al titolo c'è il numero della pagina, e `tools/versione.py` lo ricava da `git log -- webui/` + 1 a ogni compilazione: un numero scritto a mano prima o poi non viene aggiornato, e allora **dice una cosa falsa invece di non dire niente**. Alla domanda «quante versioni abbiamo cambiato in tutto?» la risposta non era da inventare: era nel registro. Oggi la pagina è la **70**, 539.766 byte in un file solo.
- [2026-10-27] **I quattro pulsanti del tastierino sono i PUNTI LIMITE DELLA CORSA, non gli angoli del foglio.** *Supera la decisione del 2026-10-26* — col foglio vero dell'utente (270 × 255 a X −14 Y −9, cioè più grande della campata) gli spigoli della carta stanno fuori corsa e **tutti e quattro i pulsanti erano spenti, sempre**: non per un numero sbagliato, ma perché puntavano alla cosa sbagliata. Si premono per vedere **dove arriva la macchina**, e la macchina ci arriva anche quando sul piano non c'è nessun foglio: adesso dipendono solo dalla corsa, cioè dal profilo. Spostare la carta non li muove di un millimetro, e a muoverli è il margine di sicurezza.
- [2026-10-27] **Il bordo di rispetto del movimento a mano: un millimetro.** I punti limite ci si appoggiano sopra (il basso a sinistra è **1,1** e non 0,0) e **le frecce non lo scavalcano**. Un millimetro sono trentaquattro passi di motore: abbastanza da non arrivarci per arrotondamento, abbastanza poco da non togliere area che serva. Il confronto è con la **partenza** e non in assoluto: se il carrello si trova già oltre — dopo una stampa che usa tutta l'area — le frecce che riportano dentro devono funzionare, se no si resta chiusi fuori. **Non vale per la stampa**, che ha il suo margine nel profilo macchina: sommarli vorrebbe dire togliere due volte lo stesso millimetro.
- [2026-10-27] **Dentro ai rettangolini dei punti limite i due numeri hanno il nome dell'asse.** Erano due cifre incolonnate, e due cifre incolonnate non dicono quale delle due è la X: si poteva solo indovinarlo dall'ordine.
- [2026-10-27] **I tratti doppi non arrivano alla penna.** Due facce adiacenti hanno lo spigolo in comune e nel file è disegnato **due volte**: la penna ci passava sopra due volte, e si vedeva sulla carta. Si tolgono **sul foglio e in millimetri** — tolleranza **0,05 mm**, che è un ottavo della punta di una penna — dopo il ritaglio e a ogni refit, quindi vale anche per quello che si disegna nell'editor. I capi si **appaiano** invece di confrontarli per uguaglianza: lo stesso punto arrivato da due strade differisce nell'ultima cifra. **Il confine, dichiarato:** toglie il doppio *esatto*, non le sovrapposizioni parziali, e la fusione è **per livello** — lo stesso segmento in due livelli resta disegnato due volte, perché sono due penne.
- [2026-10-27] **Il popup del cambio penna si apre da sé.** Prima bisognava premere **Riprendi** — cioè un pulsante che dice di riprendere — sperando che invece si fermasse e chiedesse: alla prima stampa a due colori vera l'utente l'ha premuto con la paura che la stampa ripartisse saltando la procedura. Un pulsante che per essere premuto ha bisogno di sapere che non fa quello che c'è scritto è scritto male. «Più tardi» resta più tardi (non si riapre al respiro dopo) e Riprendi lo riapre. In più il primo passo **aspetta che la testina sia ferma**: quando la finestra compare la macchina ha ancora in coda l'alzata al tappo e il ritorno a casa, e sono i secondi in cui uno allunga la mano.
- [2026-10-27] **Il lavoro si salva: `webui/js/progetto.js`.** Un SVG con dentro due cose diverse — il **disegno** come tracciati veri in millimetri del foglio, che qualunque programma apre, e lo **stato** in `<metadata>`: forme con le loro curve, livelli, occhi, cambi penna, rotazioni, ritagli, foglio. Riaprendolo qui vince `<metadata>`: i tracciati sono un prodotto, e rileggerli vorrebbe dire tornare a segmenti dritti, cioè perdere proprio la parte che si era salvata. **Non ci vanno** i cambi penna messi a mano (sono indici dentro al percorso ottimizzato, e il percorso si ricalcola) né l'angolo del foglio quando è già stato misurato oggi: una misura non si sovrascrive con un'ipotesi scritta in un file.
- [2026-10-28] **Taglia, copia e incolla fra livelli** (`Ctrl+X`, `Ctrl+C`, `Ctrl+V`, più tre pulsanti). Serve a rimettere una linea nel **livello giusto**: l'importazione divide per tinta, e la tinta è il modo in cui chi ha fatto il file ha detto cosa va insieme — non sempre è il modo in cui lo si vuole disegnare. Sul foglio non si muove niente: cambia solo la penna. Ogni livello ha le sue coordinate, quindi la conversione passa per il foglio — mappa di chi dà, inversa di chi riceve, rotazione e ribaltamento della y compresi — scritte come una matrice sola, perché una matrice si inverte e una catena di passi no. I tratti che si toccano **restano attaccati**: dieci tratti di fila sono una polilinea, non dieci alzate di penna. Lo strumento che divide un tratto in due si chiama adesso **Spezza**: due «Taglia» nella stessa barra sarebbero stati due comandi diversi con lo stesso nome.
- [2026-10-28] **Gli appunti si portano dietro la MAPPA, non l'id del livello.** È la differenza che è costata un'ora: chi copia prende le forme in *quelle* coordinate, e un attimo dopo il livello può averne altre — basta il taglio stesso, perché togliendo un tratto a una L resta una riga verticale, che un ingombro largo non ce l'ha più e la cui mappa non è più quella con cui le forme erano state lette. Tenendo l'id, il tratto rientrava **lungo 50 mm invece di 136**. L'ha trovato il collaudo, che confronta i millimetri sul foglio invece di contare i tracciati.
- [2026-10-29] **Il colore della penna viaggia dentro al programma.** Il SLICER sapeva con che colore è disegnato ogni livello e non lo diceva a nessuno: al cambio penna la domanda «quale monto?» aveva la risposta solo nella testa di chi guardava l'elenco. Non bastava spedirlo al telecomando, perché un programma **salvato e riaperto un altro giorno** non se lo sarebbe portato dietro: sta nel G-code, in un commento `;PENNA <colore> <nome del livello>` scritto all'inizio di ogni livello, che il Sender legge come legge già `;PAUSA`. Per la macchina è un commento, quindi il file resta eseguibile da chiunque. **Sta prima della pausa, non dopo**: al cambio il Sender si ferma sul segno e non legge più niente, quindi un colore scritto dopo arriverebbe solo alla ripresa, cioè quando non serve più. Si vede in tre posti: il **pallino nell'elenco dei livelli**, la **riga in cima al secondo passo** del cambio penna, e il campo `penna` nel messaggio. Il colore non diventa un dato a parte: si **ricava dalle tinte delle forme contandole**, perché taglia-e-incolla fra livelli può avercene portata dentro un'altra, e una copia sarebbe un secondo posto dove sta la stessa cosa. Un livello disegnato a mano non ha tinta: lì il colore è **null** e non si mostra niente, che è meglio di un nero inventato — vorrebbe dire «monta la penna nera».

### Step 5 — Struttura meccanica

**Stato:** completato nella struttura (2026-10-15), **ma l'area utile si è ristretta il 2026-10-23**: il pignone del carrello X tocca la cremagliera dell'asse Y sul lato destro prima della fine corsa, e X perde 10 mm prudenziali sui 5 misurati. Area utile 251,232 × 236,064 → **241,232 × 236,064**. È un impedimento meccanico, non una taratura: si recupera spostando la cremagliera di Y. Emersa anche una planarità da sorvegliare sotto la staffa TT di sinistra

**Obiettivo:** struttura a portale che porta la penna su un'area di **circa 242 × 256 mm**, con entrambi gli assi motorizzati e il pen-lift solidale al carrello Y. *(Formato ridimensionato il 2026-10-06: l'obiettivo originale era "tutta l'area di un foglio A4 in orizzontale", ma con cremagliere in un pezzo solo il lato da 297 non entra su nessuno dei due assi — il massimo raggiungibile è 281,6 × 292,8. L'area è equivalente a un A4, la forma è quadrata. Un A4 vero richiede una cremagliera giuntata.)*

**Decisioni progettuali:**
- **Trasmissione a cremagliera e pignone**, non a cinghia. Motivo: si stampa in 3D a costo quasi nullo, mentre le cinghie richiedono cinghia, pulegge e tenditori acquistati. Alternativa scartata: cinghia GT2, che avrebbe gioco quasi nullo e motori fissi — resta la via di ripiego se il gioco della cremagliera risultasse ingestibile, e non richiederebbe di rifare la struttura ma solo i supporti dei motori
- **Motore solidale al carrello**, conseguenza intrinseca della cremagliera: per tenere il motore fermo dovrebbe muoversi la cremagliera, raddoppiando lo spazio necessario. Comporta ~300 g di massa mobile in più sull'asse X, da compensare con velocità moderate
- **Gioco gestito assottigliando il dente della cremagliera di 0,2 mm, non con un precarico a molla.** Supera la decisione del precarico a molla: il gioco effettivo si regola con la profondità di ingranamento (per una cremagliera `j = 2·Δc·tan20°`, quindi 0,2747 mm di avvicinamento azzerano lo 0,2), e il metodo pratico è la striscia di carta da 0,10 mm nel punto più stretto. Una molla avrebbe aggiunto un grado di libertà su un carrello che ne ha già abbastanza. Impostazione precedente: precarico a molla del pignone contro la cremagliera: il motore non è fissato rigido ma su una piastrina che oscilla attorno a un perno, tirata verso i denti da una molla. È la contromisura al gioco fra denti stampati, che su un plotter — che inverte direzione a ogni segmento — si tradurrebbe in contorni che non chiudono e tratti sdoppiati
- **Due vincoli a livelli diversi**: il carrello è catturato dalla guida e non può sollevarsi, il motore resta libero di flottare sul carrello. I due vincoli agiscono su corpi diversi e non si annullano a vicenda
- **Cuscinetti 608ZZ (8 × 22 × 7) per la pinza sui labbri, MR63 (3 × 6 × 2,5) per la guida laterale.** Supera la scelta dei 623ZZ del 2026-09-25: i 608 erano già in casa, e il profilo reale acquistato ha labbri sporgenti che si prestano a essere pinzati da una ruota sopra e una sotto. Otto 608 (due per stazione, due stazioni per fianco) più quattro MR63 dentro il canale. La pressione di contatto di un 608 a 3 N è 27 MPa contro i 150 a cui cede l'alluminio: margine 5×. Impostazione precedente, mantenuta come principio: cuscinetti 623ZZ (3 × 10 × 4) che rotolano su guide metalliche, non cuscinetti lineari su barre tonde. Il diametro è scelto sulla pressione di contatto: a 3 N un Ø10 preme sull'alluminio con 53 MPa contro i 27 di un 608 e gli 86 di un MR62, e l'alluminio cede attorno ai 150. Il foro da 3 mm è M3, **la stessa vite di tutto il resto della macchina** — motore, cremagliera, regolazioni. Le superfici di rotolamento devono essere metallo: l'anello esterno è acciaio temprato e in poche ore scava un solco nella plastica stampata
- **Ruote impilate a coppie, non sfalsate**, possibile perché due Ø10 stanno in 20 mm. La ruota di sopra e quella di sotto pinzano lo stesso punto del canale, quindi la regolazione è diretta invece che a distanza
- **Regolazione con asole M3, non con eccentrici.** Un eccentrico da mezzo millimetro di offset copre un millimetro di corsa; il gioco da recuperare può essere di due o tre. L'asola dà tutta la corsa che serve e usa M3 invece di M8
- **Perni stampati Ø3 per le ruote fisse, viti M3 con tratto liscio per quelle regolabili.** Il conto sul perno stampato dà 5,7 MPa contro i 50 del PLA. Il cuscinetto non deve mai girare sulle creste di un filetto: appoggia su tre punti e balla
- **Un profilo unico a U al posto di due staffe separate.** Le due pareti di un estruso sono parallele per costruzione, mentre due staffe avvitate a mano divergono di qualche decimo lungo la corsa. Questo toglie alla radice il problema dell'iper-vincolo, e sull'asse X rende superflua la regola della guida maestra qui sotto — che resta però valida sull'asse Y, dove le due guide sono per forza pezzi distinti a distanza di 385 mm
- **Una guida comanda, l'altra sostiene** (vale sull'asse Y, dove le guide restano due pezzi separati). La maestra vincola quota verticale, beccheggio, posizione laterale e imbardata; la secondaria vincola solo il rollio e resta libera lateralmente. Due guide montate a mano sul legno non sono mai parallele entro un decimo, e se entrambe vincolassero il laterale quell'errore diventerebbe attrito variabile lungo la corsa — il tipo di errore che non si riesce nemmeno a compensare
- **Un eccentrico per carrello**, sul cuscinetto laterale di contrasto: stampando non si azzecca mai il gioco al primo colpo. Il gioco verticale si regola invece con le asole dei profili superiori, che agiscono su tutta la lunghezza in una volta sola
- **Motore, pignone con cremagliera e cuscinetti occupano bande laterali distinte.** Il corpo del motore è 42 mm e scende quindi 21 mm sotto l'asse, mentre la cremagliera arriva a 15 mm sotto: si sovrappongono in altezza e devono per forza stare affiancati. Circa 110 mm di larghezza complessiva del carrello. Conseguenza: la flangia di fissaggio della cremagliera va su un lato solo, quello opposto al motore
- **Formato A4 in orizzontale**, corsa X ~230 mm (cremagliera da 59 denti, corsa utile ~250) e corsa Y ~317 mm. Supera il formato A5 del 2026-09-21: l'A4 in orizzontale copre l'A4 senza bisogno della corsa X da 317, perché il disegno si ruota di 90° nel software. Il vincolo che teneva la macchina piccola era la massa mobile, e si è rivelato inesistente (tetto 3410 g contro ~1150 stimati). Impostazione precedente: formato massimo A5, corse utili 200 mm su X e 300 mm su Y; un portale corto riduce anche la tendenza del ponte a mettersi di traverso, essendo spinto da un lato solo
- **Ponte in alluminio rigido**: un ponte che non flette non può sbandare
- **Base in compensato da 10 mm, 385 × 455 mm** (acquistata). Rigida e pesante: la massa assorbe le vibrazioni invece di trasmetterle alla penna. Supera l'indicazione precedente dell'MDF da 15-18 mm, scelta prima di sapere cosa si trovasse
- **Ogni millimetro di lunghezza del carrello è un millimetro di corsa in meno**, mentre la larghezza trasversale non costa corsa. Le due dimensioni vanno quindi trattate in modo diverso: stringere in larghezza quanto si vuole, non accorciare lungo la corsa per guadagnare foglio che non serve
- **Pignone modulo 1,5 con 20 denti, tutto stampato in PLA+.** Diametro primitivo 30 mm, 33,95 passi/mm, risoluzione 0,029 mm. La risoluzione non è il fattore limitante — l'errore reale della macchina sarà attorno ai 0,2 mm, dieci volte tanto — quindi quel margine conviene spenderlo in robustezza del dente
- **La compensazione dimensionale sta nello slicer, non nei modelli** (`X-Y contour compensation` a circa −0,10, `hole compensation` a 0). È una proprietà della stampante, non del pezzo: nel modello andrebbe replicata su pignone e cremagliera e si sommerebbe a quella dello slicer
- **Foro sagomato sull'albero, senza grano, da verificare sul campo.** Il calcolo dà 0,6 MPa contro i circa 50 a cui cede il PLA, quindi la coppia non è un problema; i rischi veri sono lo sfilamento assiale e l'arrotondamento dello spigolo del piatto dopo migliaia di inversioni. Verifica prevista: una riga di pennarello che attraversa pignone e albero, controllata dopo un'ora di movimento
- **Cavi mobili da progettare subito**: sette fili fra motore X e servo seguono il carrello per migliaia di cicli, servono catena portacavi o ansa flessibile
- **Motore dell'asse Y sotto la trave, a cavallo dell'anima.** La gabbia del motore è centrata sul piano dell'anima (interno Y da −6,750 a +17,250), quindi il corpo può stare solo sotto il bordo inferiore dell'anima: la quota dell'asse non è un parametro libero, è una conseguenza. Alternative verificate e scartate: **motore sopra il carrello** (costa 44 mm di franco verticale alla macchina, perché il punto più basso passerebbe da −7 a −51 — ma il modulo penna verrebbe più corto, quindi il conto vero è quasi in pari e ha deciso la comodità di attacco del modulo punta); **motore tutto fuori sul lato −Y** con la cremagliera direttamente sotto l'ala, che geometricamente funziona ma porta il baricentro a Y ≈ −37, fuori dalla carreggiata, e l'ala finisce a −42,05 quindi non c'è dove allargare l'appoggio. **Conseguenza accettata: la cremagliera non può stare sull'ala della trave, deve scendere su una base alta ~44 mm**
- **Anti-sollevamento sul bordo inferiore dell'anima, non sotto l'ala.** Due MR63 ad asse Y spingono verso l'alto contro il bordo inferiore dell'anima. Alternativa scartata: una seconda coppia di 608 sotto l'ala, che avrebbe leva migliore (Y −19,45 invece di Y 0) ma cadrebbe esattamente dove scende la cremagliera. Il carico lo giustifica: la forza tangenziale agisce sul punto primitivo a Z −20,881 mentre l'attrito che la contrasta agisce sui 608 a Z 23,500, cioè **44,381 mm di braccio** scaricati sui 60 mm di passo perni — a stallo sono ±5,4 N contro 2,15 N di peso per stazione, e una stazione si stacca
- **Un solo lato dell'asse X motorizzato, l'altro folle.** Il secondo carrello è lo stesso pezzo specchiato a X = 0, con la sede motore predisposta ma vuota. Il conto che ha deciso: con spinta da un solo lato l'estremità libera ritarda della propria deflessione elastica, `EI ≈ 2,6·10⁹ N·mm²` per la sezione a T, e a 0,3 g fa **3÷9 µm con trave da 430** (50÷150 con 1002). Contro i **235 µm di gioco** dell'ingranamento e i **0,83 mrad** di imbardata per carrello: 25÷80 volte meno, e motorizzare il secondo lato non tocca nessuno dei due. E la forza non è mai stata il problema: il pancake dà 8,67 N sul raggio 15,000, cioè **0,86÷1,1 g** di accelerazione disponibile, mentre la configurazione ne chiede 0,02 — **40×** di margine. Se il portale farà fatica sarà sovravincolo o attrito, non coppia. Alternative scartate: un motore con albero di collegamento fra i due lati (squadratura perfetta, meccanica complicata); due motori in serie su un driver (sincronismo garantito ma induttanza doppia); due motori in parallelo (ripartizione di corrente non garantita); due driver con squadratura in firmware (serve un driver libero e una routine). **Da rivedere se:** la spinta a mano sul lato folle varia di più del doppio lungo la corsa (sovravincolo) o è uniformemente oltre ~3 N (precarico dei cuscinetti)
- **Fisso e flottante sul montaggio della trave Y, con i due gradi di libertà in direzioni diverse.** Due staffe che stringono rigidamente le due estremità sovravincolano il portale: il non-parallelismo fra le rotaie diventa precarico, e il sintomo è attrito che cambia lungo la corsa — cioè esattamente quello che farebbe dire "serve il secondo motore". Lato motorizzato = fisso, vincola tutto. Lato folle = **scorrimento lungo l'asse della trave** (permanente, assorbe il non-parallelismo) **più registrazione di squadratura in direzione di corsa** (bloccabile). Le due direzioni non vanno confuse: nel giunto a guance con viti ad asse Y il gioco dei fori Ø4,600 registra in X e in Z, **non** in Y, e Y è la direzione della squadratura — quindi serve l'asola larga con grani laterali sul lato folle
- **La trave Y appoggia sotto l'ala, non sotto l'anima, e il serraggio è nello stesso punto dell'appoggio.** Le viti stanno nell'ala: se si appoggiasse l'anima sul piano e si tirasse l'ala in basso con le viti, si piegherebbe una lamina da 1,500 proprio dove corrono i 608. Corollario costruttivo: il piano che porta le nervature sta **0,500 sotto** il fondo dell'anima, perché non deve toccare — due appoggi in serie dovrebbero essere complanari e non lo saranno
- **Il vuoto dietro al motore si chiude, non si riempie di niente — e il motore si cambia smontando la trave.** Scelta fra accessibilità e piano d'appoggio: il piano lavora ogni secondo che la macchina gira, il motore si cambia forse una volta in due anni. Supera l'indicazione data poche ore prima di tenere il vuoto libero come via d'uscita del motore, che era incompatibile con il piano d'appoggio. Nota tecnica che smonta mezzo argomento: su un pezzo stampato **lo slicer svuota comunque**, quindi un blocco modellato pieno a 15% di infill fa ~37 g contro i ~35 di una scatola progettata a pareti da 4 mm. Il cuneo autoportante a ~27° dalla verticale che è stato scelto è meglio di entrambi: nessun ponte da stampare, materiale dove c'è il momento
- **Formato: ~242 × 256 mm, A4 rinviato.** Le cremagliere stampate danno 242,475 (X, 59 denti) e 256,613 (Y, 62 denti) di corsa. L'**area** è quella di un A4 (62.100 contro 62.370 mm²) ma la **forma** è quadrata, quindi il lato da 297 non entra su nessuno dei due assi. E non entrerebbe nemmeno rifacendo le cremagliere finché si vogliono in un pezzo solo: il piatto da 256 in diagonale (`a + b ≤ 362,04`) ammette al massimo 292,8 di corsa in Y e 281,6 in X. **Per un A4 vero serve una cremagliera giuntata**, con il gradino di passo alla giunzione che si era deciso di evitare. Da rivedere se: il formato A4 diventa un requisito invece di un desiderio

**Criterio di completamento:** gioco misurato sotto 0,1 mm e `steps_per_mm` tarato sulla macchina reale

**Note (cronologia dello step):**
- [2026-09-21] Definito il metodo di taratura in loco, da usare a struttura montata: muovere quasi tutta la corsa (non 100 mm: l'errore di misura è sempre mezzo millimetro, quindi più lunga è la corsa più la taratura è precisa), misurare lo **spostamento del carrello** con un calibro e non la lunghezza della linea disegnata, e partire sempre nello stesso verso per non includere il gioco nella misura. Formula: `nuovi passi/mm = vecchi × comandata / misurata`
- [2026-09-21] Definita la misura del gioco: comandare +200 mm, poi −200 mm, e misurare di quanto il carrello non è tornato al punto di partenza. Sotto 0,1 mm il precarico funziona, sopra 0,3 mm va ristudiato prima di procedere
- [2026-09-24] **Primo pignone stampato e provato.** Foro sagomato disegnato con 0,2 mm di gioco: "entra a fatica ma entra", che è il risultato voluto. Stampata anche la versione a doppia elica: la dentatura è venuta pulita, quindi la stampante regge il modulo 1,5
- [2026-09-24] **Bilancio dell'errore atteso** con questa costruzione: ripetibilità ±0,1÷0,2 mm, precisione assoluta ±0,3÷0,5 mm dopo la taratura. Sotto i due decimi tutto sparisce dentro la larghezza del tratto di un pennarello. L'errore più insidioso non è il gioco ma **l'ortogonalità fra i due assi**: mezzo grado fa 1,3 mm di sbieco sull'angolo di un A5, più di tutti gli altri messi insieme. Si misura confrontando le diagonali di un quadrato disegnato, e il residuo si compensa via software
- [2026-09-24] Segmenti delle cremagliere fissati: asse X un pezzo da 53 denti (249,76 mm) in diagonale sul piatto, asse Y due pezzi da 37 denti (174,36 mm) dritti. Ogni segmento è un multiplo esatto del passo con il primo dente a mezzo passo dall'estremità, così il passo si mantiene attraverso il giunto
- [2026-09-24] Fissaggio della cremagliera: **un solo foro tondo al centro dell'intera cremagliera, asole dappertutto altrove**, una ogni 50 mm alternate sui due lati. Il PLA si dilata tre volte più del legno e su 350 mm cresce di oltre tre decimi: bloccato rigidamente in più punti si inarcherebbe, cambiando l'interasse col pignone nel mezzo della corsa
- [2026-09-24] Geometria del carrello ancora aperta: l'utente ha proposto due staffe a T affacciate avvitate al legno, con il carrello stampato in mezzo. Da chiarire se i cuscinetti appoggiano sull'ala orizzontale o sul gambo verticale. Problema già individuato: le staffe avvitate solo al piede sono mensole che flettono sotto il precarico, che inverte verso a ogni cambio di direzione — rimedio previsto, viti ogni 40-50 mm più un dorso stampato dietro la gamba verticale
- [2026-09-25] **Materiali acquistati**, e il progetto si adatta a quello che si trova in ferramenta invece del contrario: base in compensato 385 × 455 × 10; viti M3 da 10, 16 e 25 mm **con tratto liscio sotto la testa** (indispensabile per i perni dei cuscinetti); angolare forato 23,5 × 23,5 × 1,5; profilo a U 67,5 × 23,5 × 1,5
- [2026-09-25] **Il profilo a U più due angolari formano il canale chiuso già progettato**, con misure che coincidono: interno 64,5 × 22 mm, e due ruote Ø10 impilate ne occupano 20, lasciando 2 mm da recuperare con le asole. Gli angolari bullonati sopra le ali, flangia verso l'interno, lasciano una fessura centrale di 20,5 mm per il collo del carrello. Quattro superfici di rotolamento in due pezzi comprati
- [2026-09-25] **Verifica delle corse sulla base reale**: con un carrello da 90 mm restano circa 325 mm di corsa in Y e 230 in X, contro i 260 × 200 che servono per un A5 con margine. Circa 65 mm di margine in Y — abbastanza da permettersi un carrello fino a 150 mm senza perdere foglio
- [2026-09-25] Geometria del carrello X definita: il carrello abbraccia **una guida centrale sola**, che va bene perché il profilo è largo 67,5 mm. Sull'asse Y non funzionerà: il ponte è largo 385 mm e su una guida sola si metterebbe di traverso
- [2026-09-25] Da verificare con una calamita: i profili sono acciaio o alluminio. Un metro di quel profilo pesa 1,35 kg in acciaio contro 465 g in alluminio, e sul ponte mobile dell'asse X quel peso lo muove il motore a ogni riga
- [2026-09-25] **La guida va rialzata dal pannello**, scoperto disegnando il CAD: le ruote inferiori sporgono sotto il profilo, quindi con la guida appoggiata direttamente al legno striscerebbero sul pannello. Serve un distanziale continuo sotto tutta la guida — non blocchetti isolati, perché il profilo da 1,5 mm flette fra un appoggio e l'altro sotto il precarico
- [2026-09-25] **Conseguenza da non dimenticare: il rialzo della guida alza tutto.** Il carrello sale, quindi sale l'asse del motore, quindi la cremagliera deve salire dello stesso identico valore perché il pignone continui a ingranare. La relazione resta `fondo cremagliera = asse motore − 26,875`: se si rialza la guida di 5 mm e ci si dimentica della cremagliera, il pignone non tocca più i denti
- [2026-09-25] Il rialzo va misurato, non stimato per eccesso: ogni millimetro in più allontana la penna dal piano delle ruote e amplifica l'errore di beccheggio e rollio di circa l'1% al millimetro. Regola: sporgenza reale delle ruote più 2 mm di franco
- [2026-09-26] **Sezione reale del binario ricavata dallo STEP**, e non è un U come si pensava: è un profilo a cappello, 66,4 largo × 23,2 alto, scatola centrale 23,7, canale interno 20,0 × 21,9, fondo e labbri 1,3 mm, pareti 1,85. I labbri sporgono in fuori da X 11,85 a 33,2: sono loro la superficie di rotolamento, pinzata fra un 608 sopra e uno sotto
- [2026-09-26] **Architettura del carrello: U rovesciata che cavalca il binario.** Due fianchi verticali da 3 mm fuori dal binario (X ±35 ÷ ±38, con 1,8 mm di aria dal bordo del labbro), perni Ø8,1 con collare Ø10,1 che puntano verso l'interno, e un ponte a Z ≈ 52 che lega i fianchi al blocco centrale. Verificato sullo STEP: i fianchi sono piastre **continue su tutti gli 80 mm** da Z 10,8 a Z 34,2, quindi l'anello di forza fra perno basso e perno alto sta interamente dentro un unico pezzo di materiale, e le due stazioni sono legate rigidamente
- [2026-09-26] **L'ordine dei pezzi lungo l'asse del motore è obbligato:** corpo motore → flangia → pignone → cremagliera. L'albero esce dal lato flangia, quindi mettendo il motore fuori dai cuscinetti il pignone finirebbe dentro, dove c'è il binario. Conseguenza: il corpo del motore deve stare verso l'interno, cioè sopra il carrello, e questo fissa l'altezza minima dell'asse
- [2026-09-26] **Interasse dei 608 a 23,40 mm** (labbro 1,3 + due raggi da 11 = 23,30), cioè 0,10 mm di gioco nella pinza. Validato: mezzo carrello scorre su tutta la lunghezza in entrambi i versi. Da rifare con il carrello completo, perché con entrambi i lati montati conta la complanarità dei due labbri lungo la corsa
- [2026-09-26] **Doppia elica a 30° su pignone e cremagliera, confermata funzionante.** Verificate sullo STEP la compatibilità geometrica (stesso modulo trasversale, stesso angolo, apice a metà fascia su entrambi) e la dentatura (spessore in testa 1,065 e vano al piede 1,191 sulla cremagliera, spessore su primitiva 2,3562 nominale sul pignone: gioco totale 0,20 tutto sulla cremagliera). Prezzo della doppia elica: il pignone va centrato sull'apice della cremagliera entro **±0,17 mm**, contro i ±2 mm che darebbero i denti retti
- [2026-09-26] **Il pignone non ha vite di fermo, e va bene così.** L'accoppiamento a pressione è talmente serrato che per smontare la prova sono serviti morsetti concatenati. La vite serviva a poter *regolare* la posizione assiale per il centraggio della doppia elica, ma quella regolazione si è spostata sulla cremagliera. Da ricontrollare fra qualche settimana di funzionamento, perché il PLA sotto tensione circonferenziale si rilassa; il sintomo di uno slittamento è un disegno progressivamente sfalsato senza alcun errore segnalato
- [2026-09-26] **Alzare il piano del foglio è la leva più efficace di tutto il progetto**, non un dettaglio ergonomico. Con 0,10 mm di gioco su 60 mm di interasse ruote l'inclinazione è 1,67 mrad, e l'errore sulla punta scala linearmente con l'altezza della penna: 0,250 mm a 150 mm di sbalzo, 0,117 a 70 mm. La risoluzione della trasmissione è 0,029 mm, quindi a 150 mm l'errore geometrico è otto volte la risoluzione. Vincolo: il carrello spazza una striscia larga ±38 mm attorno all'asse del binario da Z 2,7 a Z 74, e il piano non può entrare in quel volume
- [2026-09-26] Metodo per misurare l'attrito, da usare come metrica di qualità confrontabile: cercare l'**angolo minimo a cui il carrello si muove da solo** sul binario inclinato. La tangente è il μ effettivo — 5° = 0,09 (buono), 30° = 0,58 (qualcosa striscia). Con 1,5 kg in movimento, μ 0,09 costa 20 N·mm al pignone e μ 0,58 ne costa 130, su un NEMA 17 che alle velocità di lavoro ne dà 150÷200 utili
- [2026-09-26] **Dati reali del motore** (17HS4023 iMetrx, etichetta): coppia di tenuta **130 mN·m**, corrente nominale **1,0 A/fase**, resistenza **~4,0 Ω/fase** (4,1 V a 1,0 A), peso **204 g**. È un pancake 42 × 42 × **23 mm**, non un NEMA 17 standard: circa **un terzo** della coppia di un 40 mm
- [2026-09-26] **Corrente, calore e coppia sono la stessa manopola.** La coppia scala con la corrente; la corrente che si può dare la decide il PLA della culla. Con P = 2·I²·R sui 74 cm² di superficie del motore, e tenuto conto che la culla come disegnata copre il **51%** di quella superficie: a 0,6 A la carcassa sta a **74 °C con la culla piena** e a **58 °C con la culla alleggerita**. Alleggerire la culla (nervature invece di superfici piene sul fondo e sui due fianchi) vale quindi **0,1 A di corrente in più, cioè il 13% di coppia** — non è rifinitura
- [2026-09-26] **Bilancio di coppia al punto di lavoro** (0,6 A, culla alleggerita): coppia 78 mN·m, e con il fattore 0,85 per la caduta a 21 giri/min su un raggio primitivo di 15 mm restano **4,42 N alla cremagliera**. Togliendo la quota per accelerare, l'angolo di distacco ammesso è 14° a 1,3 kg e 10° a 1,6 kg; **il target con margine 2× è sotto i 7°**. Il fattore 2 non è pignoleria: senza encoder una perdita di passo non viene segnalata da nulla e il disegno esce sbagliato da lì in poi
- [2026-09-26] **Leve in riserva se la coppia risulta stretta**, in ordine di convenienza: (1) togliere massa, che agisce su entrambi i termini; (2) accelerazione da 1000 a 400 mm/s², che restituisce 0,9 N di budget attrito e si paga solo in tempo; (3) pignone z17 invece di z20 — **+18% di forza e risoluzione da 33,95 a 39,9 passi/mm, con la stessa cremagliera** perché dipende solo dal modulo, al costo di rifare la catena delle quote (l'asse scende di 2,25 mm); (4) motore da 40 mm, che triplica la coppia per ~10 € e +140 g
- [2026-09-26] **La massa punisce due volte** (aumenta insieme l'attrito e la forza per accelerare), quindi il test della calamita sui profili pesa più di quanto sembri: la trave da 385 mm vale 174 g in alluminio contro 506 in acciaio, cioè **circa due gradi** di angolo ammesso in meno

- [2026-09-27] **Carrello X completo misurato:** angolo di distacco ~10°, moto costante su tutta la corsa ~15°, massa 290 g. Tradotto in forza sono **0,50 N e 0,76 N** contro i 4,42 N disponibili al pignone: margine 5,8×. Il μ apparente di 0,27 non descrive un attrito grande, descrive un attrito piccolo diviso per un peso ancora più piccolo
- [2026-09-27] **Il drag è attrito interno dei cuscinetti, quindi costante e non proporzionale al carico.** Otto 608ZZ con coppia di spunto 0,3÷1,0 mN·m su raggio 11 danno 0,25÷0,83 N, che copre esattamente il misurato. Conseguenza operativa: **caricando il portale il μ effettivo scende**, perché il numeratore resta fermo e il denominatore cresce. A 1,1 kg totali il μ scende da 0,27 a ~0,082
- [2026-09-27] **Test della calamita fatto: i profili NON sono magnetici, quindi alluminio.** 452 g/m sulla sezione a cappello (167 mm²), contro i 1314 g/m che avrebbe l'acciaio. Chiude il punto aperto dal 2026-09-25
- [2026-09-27] **Il tetto di massa mobile non è più un vincolo di progetto.** Con drag da rotolamento (μ 0,05) il tetto è 3410 g a 0,6 A contro i ~1150 g stimati per la macchina completa. Fra il formato più piccolo e il più grande in tabella ballavano 84 g: la massa ha smesso di essere il criterio di scelta del formato
- [2026-09-27] **Cremagliera v2 controllata sullo STEP, tre difetti trovati e corretti in v3.** (a) Due fori Ø8 passanti dall'alto tagliavano la dentatura fino in testa: a Y=0 mancavano due denti interi a X≈14 (salto di 11,551 invece di 4,712) e uno a X≈256, con la fascia portante che crollava da 17,32 a 9,32 mm; (b) restavano due schegge di dente spesse **0,030 mm**, sotto la larghezza dell'ugello, che sarebbero diventate bave dentro un vano; (c) il Ø2,5 passante avrebbe autofilettato nel PLA impedendo il serraggio, e il cono si apriva solo a Ø4,5, troppo poco per una testa svasata M3
- [2026-09-27] **Cremagliera v3 verificata pulita:** 59 denti, tutti spessi 2,1562 sulla primitiva, tutti i passi 4,7124, nessuna anomalia. Profilo confermato al centesimo a sette altezze (testa 1,0643, primitiva 2,1562, piede 3,5211, pendenza fianco 2·tan20° = 0,728). **Chevron simmetrico a ogni altezza di fascia**: le coppie ±Y danno posizioni identiche fino all'ultima cifra. Lunghezza 284,223 = 60,314 passi, avanzo 1,480 — da portare a **282,743** (60 passi esatti) perché il pezzo resti giuntabile in futuro
- [2026-09-27] **Il rettangolo ruotato a 45° sul piatto è davvero l'ottimo**, verificato: con piatto 256 e larghezza 60 il massimo è 302,04 mm esatti a 45°. Dettaglio controintuitivo da ricordare allo slicer: **ruotare poco peggiora**, fra 5° e 25° l'ingombro ammesso scende sotto i 256 mm che si avrebbero a 0°. O si va a 45 o non si ruota
- [2026-09-27] **Il riempimento non raggiunge mai i denti.** Con ugello 0,4 e 4 perimetri il dente è pieno ovunque (2,52 mm di pareti contro 2,156 di spessore sulla primitiva). Il pattern influenza solo la soletta, che regge 4,4 N su 11 viti: la scelta va fatta sulla **stabilità dimensionale**, non sulla resistenza
- [2026-09-27] **Altezza del pignone ricavata dal carrello:** i fori NEMA sono a Z 58,650 con interasse 31,00 verificato, quindi **asse pignone Z 74,150**, primitiva cremagliera Z 59,150, faccia inferiore della cremagliera Z 47,275. Equazione di vincolo della catena verticale: **D = t_binario + 59,150 − t_cremagliera**, dove D è la distanza dalla faccia inferiore della cremagliera alla primitiva (oggi 11,875). Da confermare sul pezzo reale: l'asse del motore deve venire a filo del cielo del carrello, che in CAD sta a Z 74,159
- [2026-09-27] **La catena delle quote non chiude sui nominali, e va chiusa in montaggio.** Sensibilità: 1 mm di errore in altezza = 0,728 mm di gioco, quindi il budget è ±0,275 mm. Le tolleranze reali sommano ±0,60 mm col multistrato e ±0,89 col massello — due e tre volte il budget. I contributi: taglio del legno ±0,30, **planarità del riporto su 284 mm ±0,50**, movimento stagionale ±0,05 (multistrato di costa) contro ±0,66 (massello di costa), stampa ±0,10, alluminio ±0,10
- [2026-09-27] **Il regolatore della catena verticale sono i fori Ø4,0 del motore con viti M3**: ±0,5 mm di gioco radiale, cioè ±0,364 mm di gioco d'ingranamento. Basta ad assorbire tutto quello che resta dopo aver misurato il legno
- [2026-09-27] **Architettura dell'asse Y aperta.** Frequenze proprie della trave da 437 mm con 430 g al centro: **145 Hz in verticale, 388 Hz in orizzontale** (la direzione di corsa è quella larga del profilo). Freccia 0,013 mm, e comunque **la freccia non tocca l'ingranamento** perché cremagliera e pignone stanno entrambi sulla trave e scendono insieme. La rigidezza non è un criterio di scelta del profilo
- [2026-09-27] **Il piano di simmetria della sezione azzera due errori su tre.** Con penna e pignone sull'asse dell'anima, l'imbardata non sposta la punta (una rotazione non muove ciò che sta sull'asse) e la torsione è nulla per definizione (forza sul piano di simmetria). Fuori asse si paga doppio: a 150 mm di offset sono 0,250 mm di imbardata **più** 0,209 di torsione della trave, contro uno spessore di tratto di 0,3÷0,5 mm
- [2026-09-27] **Il motore non deve contendere lo spazio alla penna nella sezione: può essere sfalsato lungo la corsa.** In sezione si sovrappongono, in pianta stanno a 40÷60 mm di distanza. Così penna, pignone e cremagliera restano tutti sul piano di simmetria
- [2026-09-27] **Un perno stampato non si può ingrossare fra due cuscinetti coassiali**, perché il cuscinetto interno si infila dalla punta e non passerebbe. La soluzione è quella già usata sull'asse X: **due tronchetti contrapposti**, uno per cuscinetto, radicati ciascuno nella propria parete. Lunghezza 8÷10 mm invece di 30, e la freccia scende col cubo: da 0,0149 a 0,0004 mm. Se invece il perno deve restare passante, va tenuto Ø8 pieno e **appoggiato a entrambe le pareti** (0,0009 mm contro 0,0149 a sbalzo, 16× in rigidezza e 4× in resistenza)
- [2026-09-27] **La resistenza dei perni stampati non è mai stata il problema:** un Ø8 a sbalzo su 30 mm rompe a 84 N e ne porta 1, coefficiente 84×. Il motivo per irrigidirli è lo **scorrimento viscoso**: il PLA sotto carico permanente triplica la freccia in un anno, quindi 0,045 mm che si presentano da soli come gioco sul labbro
- [2026-09-27] **Il profilo a cappello dell'asse X non è riutilizzabile sull'asse Y** con la conformazione scelta: è una C con le punte che formano un pezzo esterno, e i cuscinetti non possono fare il giro necessario. Cade l'ipotesi di riusare lo stesso profilo su entrambi gli assi
- [2026-09-28] **Trave Y comprata e misurata sullo STEP.** Alluminio, sezione a T asimmetrica: ala **67,100 × 1,500** (bordi a Y −42,050 e +25,050, quindi 42 mm di ala da un lato dell'anima e 25 dall'altro), anima **3,100** centrata su Y 0, altezza totale **23,500**. Due bande asolate sull'ala, a Y 11,05…15,65 e −11,75…−7,15, larghe 4,6 e piene all'82%
- [2026-09-28] **La prima cosa da verificare su un profilo asolato è dove passano i cuscinetti.** Le piste scelte (Y 18,05…25,05 e −22,95…−15,95) cadono fuori dalle bande asolate con 2,40 e 4,20 mm di margine: un 608 che passa sopra un'asola non fa rumore, fa un salto di quota che la penna disegna. Verificato anche il contrario, che serve per l'anti-sollevamento: il piano Z 0,000 della trave misura 3106,2 mm² su 1002 di lunghezza, cioè **1002 × 3,100 esatti — il bordo inferiore dell'anima è continuo, nessuna asola lo interrompe**
- [2026-09-29] **Schema di guida del carrello Y:** quattro 608 che *appoggiano* sul piano superiore dell'ala (non pinzati), due 608 sotto l'ala in anti-sollevamento, quattro MR63 che pinzano l'anima lateralmente. Il carrello poggia, non è precaricato in verticale: è lo schema giusto, e il gioco sui due inferiori non è gioco di scorrimento ma corsa prima che l'anti-sollevamento intervenga. Passo perni 60,000 come sull'asse X, carreggiata 41,000
- [2026-09-29] **Il perno superiore lungo non era un problema.** Era la preoccupazione dell'utente: un Ø8 stampato da ~52 mm che porta due cuscinetti. In realtà è appoggiato sul tetto per 29 mm al centro e a sbalzo solo 6,45 e 5,55 alle estremità: **0,26 MPa** contro i ~50 del PLA, freccia 0,0004 mm. Cade l'idea del pezzo centrale avvitato fra i cuscinetti
- [2026-09-29] **Difetto che si ripete di versione in versione: i 608 del lato +Y sono a filo esatto del bordo dell'ala** (Y 18,050…25,050 contro bordo 25,050). Il carrello trasla di 0,10 per lato col gioco dei MR63, quindi in esercizio il cuscinetto sborda e rotola sullo spigolo, che su un estruso è anche la zona con raggio di bordo e bave. La fascia pulita è larga 9,40: la posizione giusta è **17,05…24,05**. Segnalato su prova 1, 2, 3 e 4, mai corretto
- [2026-09-29] **Motore sotto o sopra: il conto non era quello che sembrava.** L'argomento dell'utente ("sopra devo alzare la penna di 5 cm") non regge sui numeri — l'attacco del modulo penna è più basso di soli 13 mm col motore sotto, ma col motore sotto tutta la macchina deve stare 19 mm più alta sulla carta, quindi il modulo penna col motore sopra viene **6 mm più corto**, non 50 più lungo. L'argomento che regge davvero è un altro, ed è migliore: **il corpo del motore è alluminio**, quindi quei millimetri di discesa non li fa un braccio stampato in PLA
- [2026-09-30] **La gabbia a cavallo dell'anima forza la quota del motore.** Interno Y da −6,750 a +17,250: il corpo può vivere solo sotto il bordo inferiore dell'anima, e il bordo superiore del motore finisce 0,35 mm sotto il piatto del carrello. Non c'è margine verso l'alto. Da qui discende tutto il resto: la cremagliera non arriva all'ala e deve scendere fino al pignone
- [2026-09-30] **Pattern dei fori motore sbagliato per tre versioni di fila:** 31,000 × **32,000** su prova 2 e 3, poi 31,000 × **31,450** su prova 4. Il NEMA 17 è 31,000 × 31,000. Con Ø4 su M3 ci sono 0,5 di raggio libero, quindi entra comunque — ma l'errore se lo mangia tutto, e proprio su **Z, che è l'asse dell'interasse**: resti senza registrazione del gioco. Su prova 4 la fila inferiore è esatta (−51,500 = −36,000 − 15,500) e **solo la fila superiore è alta di 0,450**. Il carrello X, controllato per confronto, ha 31,000 esatti: la copia non aveva portato la quota perché il carrello X ha una sola fila di due viti, non quattro
- [2026-09-30] **La doppia elica di cremagliera e pignone aveva mano opposta: non potevano ingranare.** Inseguendo un singolo dente al variare di Y, la cremagliera dà pendenza dX/dY **+0,60** e il pignone **−0,576**: stesso angolo di 30°, ma le punte delle V guardano da parti opposte e le tracce dei denti si incrociano a 60° invece di essere parallele nel punto di contatto. Verifica: 74,1 mm³ di compenetrazione che non scende sotto ~35 né ruotando il pignone, né facendolo rotolare davvero (rotazione + traslazione r·θ), né aumentando l'interasse di 0,8 mm. **La correzione è gratuita: si gira la ruota sottosopra** (essendo simmetrica rispetto al piano di mezzeria, ribaltarla inverte la mano senza spostare nient'altro) e la compenetrazione va a **0,000** con una finestra di gioco di ~0,26 mm. Ruotarla sul mozzo, che era l'istinto, cambia la fase e non la mano
- [2026-09-30] **Correzione di un errore mio sul segno dello 0,1 di aria fra cremagliera e ala.** Avevo scritto che stringendo la cremagliera contro l'ala l'ingranamento si stringe: è il contrario. Denti in giù e pignone sotto, quindi tirandola su l'interasse **aumenta** e il gioco cresce. Il margine di montaggio voluto dall'utente va nel verso giusto
- [2026-09-30] **La cremagliera Y non raggiunge le asole della trave:** il suo piano superiore va da Y −13,822 a −42,278, le asole sono a −11,750…−7,150. Vanno forati fori nuovi nell'ala, e la zona giusta è **Y −28…−38** per tre motivi che coincidono: è oltre Y −24,950 dove finisce il carrello (teste delle viti di qualsiasi altezza, montaggio dall'alto), è oltre Y −22,950 quindi fuori dalla pista dei cuscinetti 5 e 6, ed è oltre Y −27,678 dove finisce la gamba verticale, quindi le cave esagonali per i dadi sono accessibili da sotto
- [2026-10-01] **Prima stampa del carrello Y: si solleva.** Premendo con un dito sul retro del motore il carrello si alzava. Causa: niente teneva giù il lato −Y (i 608 lì sopra solo appoggiano), e qualsiasi forza applicata molto sotto l'ala genera un momento enorme. I numeri dicono che non era una sensazione: a stallo il momento di beccheggio è 324 N·mm, cioè **±5,4 N** contro 2,15 N di peso per stazione — una stazione si stacca. In marcia normale non solleva ma **dimezza il carico** su una stazione, ed è quella cedevolezza che poi esce come isteresi nel disegno
- [2026-10-01] **La nuova catena di tolleranze è il rischio principale aperto.** Il progetto dipende ormai da **tre quote della trave comprata, nessuna misurata**: spessore ala 1,500 (presa 608, gioco progettato 0,100), spessore anima 3,100 (MR63 laterali, 0,050), e la novità, **altezza totale 23,500** (MR63 anti-sollevamento, **gioco 0,000**). Prima la presa verticale lavorava su 1,5 mm di lamiera, adesso lavora su tutta l'altezza del profilo — che per di più è fatto di due profili a L imbullonati, quindi ha anche il problema che **le due gambe devono finire a filo sul bordo inferiore**, altrimenti un cuscinetto da 2,5 corre mezzo a sbalzo su un bordo da 3,1
- [2026-10-01] **Altezza della cremagliera Y fissata dalla catena:** con asse pignone a Z −36,000 e raggio operativo 15,119 (il Ø testa 33,237 dà x = +0,079), la primitiva va a **Z −20,881**, la punta del dente a **−22,381**, il dorso contro l'ala a 22,000 → **altezza totale 44,381**. Cresciuta di 7,3 mm rispetto al layout precedente, conseguenza diretta dell'aver abbassato il motore. La lama alta non preoccupa: la forza tangenziale è nel piano della lama e la doppia elica non genera spinta assiale, quindi non c'è niente che la fletta in Y
- [2026-10-01] **Lunghezza della cremagliera Y: due pezzi identici da 37 passi** (174,359 ciascuno, 348,718 totali, ~322 di corsa utile). In un pezzo solo non ci sta: servirebbero ~343 di dentatura, il piatto a 45° con larghezza 28,456 ne ammette 333,6 teorici e ~300 pratici. A 174 mm si stampano **dritti sul piatto**, niente rotazione a 45°. Due regole per il giunto: ogni pezzo multiplo esatto di 4,7124 tagliato su un confine di dente, e **il passo attraverso il giunto lo deve dare l'incastro fra i due pezzi** (maschio/femmina, stesso file) e non la foratura dell'alluminio, che vale ±0,2
- [2026-10-01] **Gioco e scorrevolezza non sono la stessa cosa, e vanno curati con strumenti diversi.** Dopo la prima stampa i giochi nominali sono stati stretti (608 da 0,150 a 0,100, MR63 laterali da 0,100 a 0,050, anti-sollevamento a 0,000). Tarare su una stampa reale è il metodo giusto, ma 0,050 è **sotto la tolleranza di stampa**: la prossima stampa può uscire con 0,15 di gioco o con 0,05 di interferenza, e in nessuno dei due casi c'è modo di aggiustare. Il rimedio al gioco è la **regolazione** (asole), non un nominale più stretto — che aggiunge precarico su tutta la corsa e lo fa pagare dove il profilo è un po' più spesso, con un punto duro. L'attrito è stato il vincolo del progetto per settimane: non va buttato via per una sensazione al tatto
- [2026-10-02] **Il raggio primitivo del pignone è 15,000, non 15,119: l'errore veniva dal bounding box.** Il Ø di testa letto dal bbox era 33,237, da cui si ricavava una correzione di profilo x = +0,079. Misurando i cilindri veri: **testa Ø33,000** (= 1,5 · (10+1) esatto) e **fondo Ø26,250** (= 1,5 · (10−1,25) esatto), cioè un ingranaggio standard senza alcuna correzione. Lo scarto del bbox è 0,1185 per lato, metà esatta di 33,237 − 33,000: su una dentatura a spina di pesce OCC circoscrive le facce NURBS con margine. Conseguenza: **l'altezza della cremagliera Y passa da 44,381 a 44,500**
- [2026-10-02] **Altezza cremagliera Y verificata in tre modi indipendenti.** (a) Catena di quote riferita all'estradosso dell'ala: `estradosso → asse pignone 59,500` (fissato dal carrello stampato), `asse → primitiva 15,000`, `primitiva → punta 1,500` → `H = 46,000 − t_ala`, cioè **44,500** con t = 1,500. (b) Il gioco di testa che ne risulta viene **0,375 = 0,25·m**, il valore normalizzato, senza averlo imposto. (c) Misura diretta sulla geometria dell'utente: ingranaggio ribaltato messo in presa, scansione di fase su un passo intero e bisezione sui bordi della finestra libera → **gioco 0,226 mm** a interasse teorico, che è lo 0,200 già presente nello spessore del dente (misurato: 2,1562 sulla primitiva contro 2,3562 nominali, passo 4,7124, ripetuto identico su 62 denti). Sensibilità misurata **0,69 mm di gioco per mm di interasse** (teoria 0,728)
- [2026-10-02] **Banda di tolleranza della cremagliera: 44,32 … 44,71**, presa forzata a 44,83. Il margine verso il grippaggio dal nominale è solo **0,33 mm**, e `dH/dt_ala = −1` esatto. La direzione della correzione non è simmetrica: **uno spessore sotto il dorso stringe**, quindi si sbaglia corto e si stringe con spessori da 0,1, mai il contrario — limare il dorso su 174 × 28 tenendolo piano è l'operazione che non si vuole fare. E il ritiro del PLA è la trappola: le due parti ritirano insieme e il modulo si auto-compensa, ma **H è riferita a una trave di alluminio che non ritira**, quindi è l'unica quota del sistema dove il ritiro non si cancella (0,4% su 44,5 = 0,18 mm, tutta la banda)
- [2026-10-02] **Orientamento di stampa della cremagliera:** dorso sul piatto e denti in su, perché in quell'orientamento **non serve nessun supporto** (la flangia parte dal piatto e finisce con la faccia rivolta in alto). Il prezzo è che la scalettatura dei layer sul fianco del dente è `h_layer · tan20°` = **0,073 mm con layer da 0,2**: è il motivo per cui un gioco nominale sotto ~0,15 non può funzionare — sarebbe più piccolo della rugosità geometrica del fianco che lo deve rispettare. Per guadagnare precisione si stampa a layer più fini (0,1 → 0,036), non si stringe l'interasse
- [2026-10-03] **Lo spessore dell'anima non va più misurato.** L'asola da 3,140 del carrello X ha accolto la trave vera, quindi l'anima è 3,10 ± poco. Una delle tre quote mai misurate si chiude per via empirica
- [2026-10-04] **Il difetto dei 608 a filo del bordo d'ala si chiude come non-problema, dopo averlo segnalato quattro volte.** Rifacendo il conto: il gioco laterale degli MR63 è 0,050, quindi nel caso peggiore il cuscinetto sborda di **0,050 su 7,000 di larghezza**, cioè lo 0,7% dell'appoggio, e il contatto di rotolamento è una linea lungo la larghezza. Non succede niente. L'insistenza era sbagliata: la nota del 2026-09-29 sopravvalutava l'effetto perché ragionava sullo spigolo senza rapportarlo al gioco che lo può raggiungere
- [2026-10-05] **L'ingombro del carrello Y lungo la trave è 116,000 per estremità, non 82,5.** Misurato montando i due solidi nello stesso sistema e cercando il primo contatto per bisezione: **px = −78,000**, con zona di contatto X −38,00…−36,00 / Z 81,65…85,93. Il contatto non è fra guance e cuscinetti, è **corpo contro corpo** — il carrello Y è largo 80 mm (±40 dal pignone) e la faccia esterna del carrello X sta a 38 dal suo asse rotaia. La stima precedente contava solo le guance (49,5) e i cuscinetti laterali (33,0) e ignorava le due gabbie motore. È il numero che ha spostato la trave da 430 a 550
- [2026-10-05] **La trave Y va a 550, e la ragione non è solo il minimo.** Corsa utile = `L − 2·116 − 2·g`: a 430 sarebbero 188 (si butterebbero 69 mm di cremagliera già stampata), a 500 esattamente i 256,6 della cremagliera attuale, a **550** la capacità sale a 308 e **ci sta anche la cremagliera Y più lunga stampabile in un pezzo solo** (292,8 di corsa). Costa 29 g di massa mobile in più. Supera le indicazioni di 430 e poi 500 date nella stessa sessione
- [2026-10-06] **Interferenza degli MR63 laterali con la rotaia X confermata sull'assieme reale: 8 × 2,81 mm³, cioè 0,500 di penetrazione per lato.** Zona di contatto X −303,4…−302,9, su entrambi i carrelli X. Il dato che la rende diagnostica: **gli MR63 laterali del carrello Y non interferiscono per niente** — lì il gioco modellato è 0,050 e torna. Quindi è il profilo della rotaia TT nel modello a essere sbagliato (luce interna 20,000 contro perni a ±7,500), non i carrelli, che infatti scorrono
- [2026-10-06] **L'assieme non è affidabile sotto il millimetro sugli accoppiamenti di motori e ingranaggi.** Motore e ingranaggio Y piazzati 0,350 sopra l'asse della sede (asse misurato Z 68,535 contro 68,185 richiesto), ingranaggio X 0,466 sotto. Risultato: l'assieme legge l'interasse Y **0,475 troppo stretto** e quello X 0,343 troppo largo, mentre la macchina vera funziona. Quello che invece è affidabile e torna al micron: la trave appoggia a Z 104,1846 contro un fondo asola calcolato a 104,184, le guance si fermano 1,005 sotto l'intradosso dell'ala, e **l'anima della trave sta a Y −33,531 contro il centro dei carrelli a Y −33,51** — 0,021 mm, centrata come da progetto
- [2026-10-06] **Quote del portale assemblato:** interasse rotaie **473,40** (centri X −313,40 e +160,00), facce esterne dei carrelli a X −351,40 e +198,00 → **trave da esterno a esterno 549,40**. Le due rotaie nel CAD sono **sfalsate di 62,08 mm in Y** (centri a Y +62,08 e 0), da allineare. La cremagliera Y è **decentrata di 25,88**: margini 4,5 da un lato e 56,3 dall'altro invece di 30,4 per parte
- [2026-10-06] **Il piano di base non basta più, e il centro dell'area di disegno non è dove si crede.** `base legno` è 385 × 455 e la **rotaia sx è fuori dal piano di 154 mm**. Serve ~570 × 430 con le rotaie allineate e tagliate a 400. E l'area di disegno è centrata su **X −102,6 / Y −87,9**, non su (0,0): il piano va centrato lì. Quota che serve al modulo penna: il punto più basso del carrello Y sta a **Z 46,68** sopra il piano, quindi il piano carta va a **Z ≈ 44,2** — serve una piattaforma alta 44 mm
- [2026-10-07] **Nomenclatura fissata dall'utente, e da qui in avanti è quella:** **staffa TT** = le due rotaie da 400, **staffa LL** = la trave del portale da 550. Serviva perché le due sessioni usavano vocabolari diversi ("trave a T", "rotaia TT") e in una lista di tagli l'ambiguità si paga
- [2026-10-07] **La base deve ospitare anche l'elettronica, e questo la ridimensiona.** Il vincolo che decide: **fra le due rotaie non ci sta niente di più alto di 46,68 mm**, e il piano carta ne usa già 44,2. L'elettronica non può stare dentro la macchina, va in una fascia dietro le rotaie — dove per contro **non c'è nessun limite di altezza**. Due breadboard da 830 punti affiancate chiedono 130 mm di profondità; l'utente ha poi comprato una tavola **600 × 700**, che ne lascia 190
- [2026-10-09] **I tagli li fa l'utente in proprio, con seghetto a pendolo.** La lama giusta è la **T118G** (passo 0,7), e la ragione è geometrica: la staffa LL è alta 23,5 e larga 67,1, quindi si taglia per forza appoggiata sull'ala, e **per 64 dei 67 mm di taglio la lama attraversa l'ala da 1,500 mm**. A passo 0,7 sono 2,1 denti in presa, con la T118A (1,2) sono 1,25 e con la T118B (2,0) sono 0,75 — sotto il dente, il dente aggancia invece di tagliare e strappa il bordo, che è la pista dei 608. Regole: **pendolo a 0** (nel metallo fa strappo), velocità bassa (l'alluminio ad alta velocità si salda sui denti), lubrificante, legno di sacrificio sotto, morsa sull'anima o sulla scatola mai sulle ali, nastro sotto il pattino per non rigare le piste. **Staffa TT tagliata, risultato dichiarato ottimo**
- [2026-10-11] **L'interasse delle rotaie non è una scelta libera: lo quantizzano i fori della staffa LL.** Il profilo ha **22 fori Ø4,6 nell'anima a passo 25,000 esatto**, e i due fori di serraggio delle guance del carrello X sono distanti **esattamente 25,000**, cioè un passo. Montando entrambi i carrelli **sui due fori più esterni** si ottiene l'interasse massimo possibile, **473,400**, e la staffa da 550 lo copre con 0,600 mm di avanzo totale. Supera l'indicazione data il 2026-10-07 di ricavare l'interasse come `lunghezza trave − 76,0` (che dava 474,0): quella formula ignorava che la posizione dei carrelli è discreta
- [2026-10-11] **Prova_2 contro prova_3: la mossa che ha fatto spazio è stata di 25,000 mm.** Nel prova_2 l'interasse era 448,400 e la trave sbordava di 23,3 mm da un lato; spostando il carrello sinistro di un passo-foro si arriva a 473,400 e la trave viene usata tutta
- [2026-10-11] **Il carrello Y non lo ferma il motore né il pignone: lo ferma lo spigolo interno della cremagliera X.** Misurato per bisezione con booleane, un ostacolo alla volta (il metodo si auto-valida: contro il corpo del carrello X trova il contatto a pignone Y = +82,002, cioè faccia a faccia a X 122,000, che riproduce al centesimo l'A = 116 misurato a ottobre). La cremagliera X è larga **38,660 di base ma solo 17,321 di dentatura**: 21,34 mm di flangia di fissaggio sporgono verso il centro macchina, e sono quelli che mangiano la corsa. Col vecchio riporto in legno il margine a fine corsa era **+3,475** a destra e **+1,714** a sinistra se si motorizza anche quel lato: non un margine, il non-toccarsi
- [2026-10-11] **Cremagliera X v5: il rialzo in legno sparisce dentro il pezzo stampato.** Decisione dell'utente. Il pezzo passa da 13,375 a **68,375 mm di altezza totale** (+55,000 esatti), appoggia direttamente sul legno e la cresta dei denti resta dove stava. 59 denti, passo 4,7124 uniforme, corsa 242,475: la dentatura non si è mossa. Il guadagno non previsto: il piede largo sta **solo nei primi 10 mm**, e sopra la sezione si stringe ai 17,321 della dentatura — ma il carrello Y tocca in una fascia a **Z 46,7÷59**, trentasette millimetri più in alto. Quindi l'ostacolo arretra di **21,339 mm** e i margini diventano **+11,5** e **+9,8**
- [2026-10-11] **Il conto della stampa:** 364,82 cm³ di modello (452 g se fosse pieno, ~150 g con 3 perimetri e infill al 15%, 12÷18 ore). In pianta 283 × 38,7, quindi a 45° fa `a+b = 321,7` contro i 362 ammessi dal piatto: ci sta in un pezzo solo, e c'è il precedente della cremagliera Y che era più lunga. Piede sul piatto e denti in su, nessun supporto
- [2026-10-11] **Due numeri miei da correggere.** (a) L'ingombro del carrello X **lungo la rotaia è 82,000**, non 51: i 51 sono la sola gabbia motore, ma i quattro 608 stanno a passo 60,000 e con Ø22 arrivano a 82. Il taglio a 400 resta giusto, ma la corsa meccanica disponibile è **308** e non 339, e il minimo teorico era 334,5 non 303,5. (b) L'interasse è 473,400 e lo danno i fori, non 474,0 dalla lunghezza della trave
- [2026-10-12] **Il ritiro del PLA ora agisce su 68,375 invece che su 13,375.** Allo 0,3% fa ~0,21 mm contro 0,04, ed è la quota dove il ritiro non si auto-compensa perché è riferita all'alluminio. Ma è **sistematico e in una direzione sola: più basso, cioè gioco più largo**, mai verso il grippaggio — la stessa direzione in cui sbaglia uno spessore sottodimensionato. Aspettarsi di dover spessorare di ~0,2 sotto il piede, e considerarlo normale. In cambio sparisce il termine dominante della vecchia catena: la **planarità del riporto su 284 mm, ±0,50**, che da sola valeva il doppio del budget di ±0,275 — la faccia di riferimento non è più una superficie segata ma il piatto della stampante
- [2026-10-15] **Macchina montata.** Tagliata la staffa LL — l'unico taglio del progetto senza seconda possibilità — e assemblato il portale sulla base. I due assi si muovono dalla dashboard vecchia, le quattro frecce vanno nel verso giusto, la struttura è rigida e i motori non faticano. Il disallineamento delle rotaie è stato **risolto in montaggio**, quindi i 22,9 mm di corsa che costava sono recuperati sulla macchina vera (nell'assieme CAD va ancora riportato)
- [2026-10-15] **Gli assi cambiano nome** per allinearsi alla convenzione del foglio: la trave del portale diventa X, le rotaie di base diventano Y. Vedi le Convenzioni in testa alla Pipeline — e attenzione che tutte le note qui sopra usano i nomi vecchi
- [2026-10-15] **Le misure di taratura sono rinviate al modulo penna, per decisione dell'utente.** Non è un rinvio a vuoto: col modulo penna la taratura si fa disegnando una linea lunga e misurandola, che è una misura di tutta la catena in una volta e per asse, invece di una misura del solo passo della cremagliera. Il metodo col calibro resta scritto e valido in `misure/primo-asse.md` per il giorno in cui servisse separare i contributi
- [2026-10-20] **Fissaggio del foglio: nastro di carta, in attesa della stampa di collaudo** (decisione dell'utente). Il vincolo che esclude quasi tutto il resto: fra piano carta (Z 44,2) e punto più basso del carrello (Z 46,68) ci sono **2,5 mm**, quindi dentro la zona spazzata dal carrello non ci sta nessuna calamita e nessuna molletta — solo nastro (0,1 mm), colla stick o qualcosa sotto la superficie. **La piattaforma da 44 mm non è ancora costruita**, quindi il fissaggio è una scelta di progetto della piattaforma e non un accessorio da aggiungere dopo. Proposta sul tavolo, non ancora decisa: telaio da 40 mm + **piano in vetro float da 4 mm su tre appoggi regolabili** — tre e non quattro, perché tre punti definiscono un piano e quattro lo svergolano. Tavola confermata **600 × 700**
- [2026-10-20] **Blocchi di riferimento stampati e montati**, uno per asse, agganciati alle staffe TT e LL. Spostano l'azzeramento da «a occhio» a ripetibile: l'appoggio ripete sotto la risoluzione del calibro, e il margine di sicurezza scende da 8 a 2 mm. Il blocco X è una sella senza viti, tenuta dalla forma; il blocco Y una piastra avvitata con due viti a 22,80 di passo. Misurato quanto si mangiano di corsa: **1,443 mm su X, zero su Y** — il blocco Y sta di fatto sulla battuta
- [2026-10-21] **Il vincolo che esclude calamite e mollette cambia natura, non conclusione.** Eliminata la piattaforma (vedi Step 6), sotto il carrello non ci sono più 2,5 mm ma 46,68: l'argomento del 2026-10-20 non regge più come scritto. A mordere è ora **l'alzata della penna, 2,945 mm**, perché è quello che passa sopra il foglio fra un tratto e l'altro. Stesso ordine di grandezza, stessa decisione: **nastro di carta**, e si rivede dopo la prova 11 del collaudo
- [2026-10-23] **Due cose meccaniche trovate disegnando, non misurando.** (a) **Il pignone del carrello X tocca la cremagliera dell'asse Y** sul lato destro prima che il carrello arrivi in fondo: interferenza 5 mm, se ne tolgono 10 per stare larghi, e l'area utile su X scende a 241,232. Nel profilo è un campo suo, `ostacolo`, tenuto separato dal margine di sicurezza perché si risolve in modo opposto — l'uno smontando, l'altro diventando più precisi. Conseguenza pesante: **il disegno di collaudo non ci sta più** e va riprogettato nella colonna di destra. (b) **Il legno sotto al binario della staffa TT di sinistra si era alzato**, e nel primo disegno vero ha prodotto tratti spezzati nell'angolo in alto a sinistra: non alza la carta, alza il portale, e per la penna è identico a un piano che scende. Sistemato dall'operatore. Da qui la scoperta che la prova 11 del collaudo misura i punti alti e **non** quelli bassi

**Problemi aperti su questo step (al 2026-10-15):**
- ~~Profondità del vano motore da verificare~~ — **risolto il 2026-09-26.** Il motore è un **pancake da 23,1 mm**, non un NEMA 17 standard da 34÷48: il vano da 23,5 mm è quindi corretto e le viti posteriori arrivano eccome al coperchio. Resta però **0,4 mm di gioco assiale**, che è più dei ±0,17 mm di tolleranza di centraggio della doppia elica: il motore va messo **in battuta sulla parete anteriore** (che è il riferimento della quota del pignone) con **due rondelle piane M3 da 0,5 mm** fra coperchio posteriore e parete posteriore, così le viti di dietro lo spingono in avanti invece di tirarlo indietro. Resta da verificare la profondità dei fori filettati posteriori (spesso 4÷5 mm) per scegliere la lunghezza delle viti
- ~~Test della calamita sui profili~~ — **risolto il 2026-09-27: alluminio**, 452 g/m. Toglie di mezzo il rischio peggiore sul peso del portale
- ~~Attrito del carrello completo da caratterizzare~~ — **risolto il 2026-09-27.** 10° di distacco, 15° di moto costante, e la causa è attrito interno dei cuscinetti (costante), non strisciamento (proporzionale). Il carrello è accettabile così com'è
- ~~Profilo della trave Y da comprare~~ — **risolto il 2026-09-28.** Trave a T in alluminio, ala 67,100 × 1,500, anima 3,100, altezza 23,500, due bande asolate. Le piste dei cuscinetti cadono fuori dalle asole con 2,40 e 4,20 mm di margine
- ~~Layout del carrello Y da chiudere~~ — **chiuso nella sostanza il 2026-10-01** attraverso quattro iterazioni (prova 1→4): guida, motore sotto a cavallo dell'anima, anti-sollevamento sull'anima, cremagliera sotto l'ala su base alta. Resta aperto il solo **modulo penna**
- ~~Tre quote della trave Y da misurare~~ — **chiuso per via empirica il 2026-10-03.** L'asola da 3,140 del carrello X ha accolto la trave (anima = 3,10 ± poco) e i tre carrelli stampati scorrono sulla trave vera, quindi ala e altezza totale sono confermate dall'uso. Non serve più il calibro
- ~~Verificare la mano dell'elica anche sull'asse X~~ — **risolto il 2026-10-06.** Nell'assieme entrambi gli ingranaggi sono istanze di `Spur gear (20 teeth)-Mirrored`: la correzione è applicata su tutti e due gli assi
- ~~Fori motore, fila superiore da Z −20,050 a −20,500~~ — **accettato come è il 2026-10-05.** L'utente ha stampato e montato: le viti entrano, perché i 0,500 di scarto stanno esattamente dentro il gioco Ø4,000 su M3. Segnalato tre volte, la prova fisica batte la misura sul CAD per la domanda "ci entra". Resta vero che la flangia motore si carica di sbieco e che il gioco di registrazione è esaurito, ma non è un difetto che blocca
- ~~I 608 del lato +Y a filo del bordo d'ala~~ — **ritirato il 2026-10-04: non era un problema.** Con 0,050 di gioco laterale il cuscinetto sborda di 0,050 su 7,000 di larghezza, lo 0,7% dell'appoggio. Segnalato quattro volte a torto
- ~~Cremagliera Y da disegnare~~ — **risolta e stampata il 2026-10-02**, gioco dichiarato ottimo dall'utente. 62 denti, 289,613 di dentatura, 297,360 di pezzo, in **un pezzo solo** a 45° sul piatto (niente giunto, quindi nessun gradino di passo). Dodici asole 4,600 × 7,300 elongate in Y per la registrazione del parallelismo
- ~~Interferenza cremagliera / fianco del carrello X~~ — **risolto il 2026-10-06**: il carrello X v2 è stampato e funzionante, e le booleane sull'assieme non trovano contatti in quella zona
- ~~Gioco della pinza con il carrello X completo~~ — **risolto il 2026-10-06**: i tre carrelli sono assemblati e scorrono bene
- ~~Quanto alzare il piano del foglio~~ — **risolto il 2026-10-06: Z ≈ 44,2 sopra il piano di base**, perché il punto più basso del carrello Y sta a Z 46,68. Serve una piattaforma alta 44 mm
- ~~PRIORITÀ: misurare col calibro la luce interna fra le due anime della rotaia X. È l'unica misura rimasta e blocca la squadratura del portale. Nel modello è 20,000 con i perni MR63 a ±7,500, cioè 0,500 di interferenza per lato su otto cuscinetti — e i carrelli invece scorrono, quindi il modello è sbagliato. Quel numero è il gioco laterale dell'asse X, e il gioco laterale è l'imbardata del portale: 0,05 → 0,83 mrad → 0,18 mm all'estremità di una trave da 550; 0,5 → 8,3 mrad → 1,8 mm. Va saputo prima di squadrare, non dopo~~ — **chiuso il 2026-10-12, e non come previsto.** La luce da 20,000 è la **quota ufficiale del profilo**: l'informazione è arrivata dall'utente, non dal calibro. Le otto interferenze da 2,81 mm³ nell'assieme hanno quindi una spiegazione sola — nel CAD c'è ancora il **carrello della prima versione**, mentre quello stampato ha i perni MR63 già spostati sulla base delle prime prove. Il ragionamento ("i carrelli scorrono, quindi il modello è sbagliato") era giusto, il colpevole no: era il pezzo che si era mosso, non la rotaia. Resta da registrare **di quanto** sono stati spostati i perni, perché quel numero è il gioco laterale e quindi l'imbardata del portale
- ~~Lista tagli da eseguire (fuori casa, non ci sono gli attrezzi): trave Y a T 1 × 550, rotaia X a TT 2 × 400, tolleranza ±0,5. Avanzi da conservare: 452 mm di trave (una seconda trave intera) e 600 di rotaia. Specificare a chi taglia: stringere in morsa sull'anima per la T e sulla scatola per la TT, mai sulle ali (sono le piste dei 608); lama a denti fini o troncatrice da alluminio, niente flessibile; sbavare i quattro spigoli di ogni taglio, che è l'operazione più importante del lavoro. E non usare le facce di taglio come riferimento: segnare la posizione dei carrelli misurando dal centro della trave~~ — **superata il 2026-10-09: i tagli li fa l'utente.** Comprato un seghetto alternativo a pendolo e quattro lame. **Staffa TT tagliata, risultato ottimo.** Resta da tagliare la staffa LL, rimandata di proposito finché il primo asse non si muove: dalla stecca da 1002 restano 452 mm, meno di un secondo pezzo, quindi è l'unico taglio del progetto senza seconda possibilità
- ~~Piano di base da rifare: circa 570 × 430, centrato su X −102,6 / Y −87,9. Quello attuale è 385 × 455 e la rotaia sx ne sta fuori di 154 mm~~ — **chiuso il 2026-10-12: comprata una tavola 600 × 700**, che copre anche la fascia per l'elettronica. Il layout quotato è nelle note dello step
- **Tre correzioni nell'assieme CAD** prima di ricavarne altre quote: allineare le due rotaie in Y (−62,08 sulla sx), spostare la cremagliera Y di **+25,88** per bilanciare i margini, riaccoppiare motori e ingranaggi sulle loro sedi (oggi sono fuori di 0,15÷0,47 e falsano tutti i numeri di ingranamento)
- **Quale altezza ha la cremagliera Y stampata, 44,500 o 44,625?** Nell'assieme misura 44,625, cioè 0,100 in meno di quanto era stato togliuto invece di 0,225. A 44,625 il gioco è **0,140** invece di 0,226: funziona, ma è sul lato stretto per una coppia stampata dove la scalettatura dei layer sul fianco è già 0,073
- **Carrello X sinistro: specchiare non basta.** Il mirror a X = 0 è la trasformazione giusta (tutto quello che tocca la rotaia è simmetrico, cambiano lato solo vano motore e guance), ma il sinistro deve essere il **lato flottante**: asola dell'anima a **4,500 con due grani M3 di registro laterale per guancia** (±0,700 in Y = la squadratura) e **fori di serraggio asolati in X a 4,600 × 8,000** (lo scorrimento che assorbe il non-parallelismo). Con fori tondi su entrambi i lati si torna a sovravincolare
- **Secondo canale servo da riservare nel fascio cavi adesso.** Tirare un filo in più oggi è gratis, farlo passare dopo in una catena portacavi montata no. Lo chiederà il modulo taglierino
- **Parallelismo cremagliera-binario entro 0,17 mm su tutta la corsa** (conseguenza della doppia elica). Va allineata **al binario**, non al bordo della base: far scorrere il carrello e controllare la distanza pignone-apice in quattro o cinque punti prima di fissare. Sintomo di errore: scorre bene in mezzo e si irrigidisce verso le estremità
- **Piano B se il riporto della cremagliera X esce storto:** buttarlo e appendere la cremagliera a staffe stampate fissate al binario. Vantaggio concettuale: la cremagliera verrebbe riferita allo stesso pezzo su cui corre il pignone, invece che al tavolo
- ~~PRIORITÀ: le tre misure del primo test di movimento~~ — **rinviate per decisione dell'utente il 2026-10-15**, dopo il modulo penna, quando si potranno fare disegnando. La procedura resta in `misure/primo-asse.md`, aggiornata due volte: i 6400 impulsi non si misurano con un calibro da 150, e il passo si ricava a perni (due tondini identici nelle cave, `p = (R30 - R10)/20`, dove il diametro del perno si cancella nella sottrazione). Il gioco, provato a mano a montaggio fatto, è risultato "quasi zero" — resta da quantificarlo
- **Corsa utile reale di ciascun asse, da fermo a fermo.** Basta il metro, ±1 mm. Oggi in `cnc2d-config.yaml` c'è `max_travel_mm: 300.000` su entrambi, con scritto "DA TARARE"
- **Due passi/mm, uno per asse.** Le due cremagliere si sono ritirate di quantità diverse: un valore solo fa uscire i quadrati rettangoli. Da misurare per asse e da separare nel firmware della dashboard, che oggi ne ha uno globale
- ~~La quota a cui è stata tagliata la staffa LL non è registrata~~ — **chiuso il 2026-10-15: 550 mm**, la quota di progetto, senza scarti. Dalla stecca da 1002 restano 452 mm di avanzo
- **Il config di FluidNC non è mai stato provato** sulla macchina montata. Contiene ancora `steps_per_mm: 80.000` (residuo dell'ipotesi a cinghia: sbaglia di 2,36 volte), nessun blocco `homing:`, e i due assi sono stati rinominati il 2026-10-15 senza poterli verificare
- ~~Il reticolo dei fori motore è 31,0000 × 31,4500 invece di 31 quadrato~~ — **chiuso dall'utente il 2026-10-16: non è un errore, è una quota del progetto.** Ha stampato e avvitato con questo reticolo più volte e le viti entrano sempre, perché il gioco Ø4 su M3 vale 0,500 e lo scarto 0,450. E siccome *tutti* i pezzi del progetto portano lo stesso scarto, sono coerenti fra loro. Resta vero solo che la registrazione con le viti è esaurita, quindi l'offset utensile andrà misurato e non registrato — cosa che comunque va fatta
- **Aggiornare il carrello X nell'assieme CAD con la versione stampata.** Finché c'è quello vecchio, ogni controllo di interferenza ripesca le stesse otto collisioni finte degli MR63 — e una vera ci si nasconde dentro
- ~~Le due rotaie nell'assieme sono sfalsate di 31,252 mm in Y, e costano 22,9 mm di corsa~~ — **risolto in montaggio il 2026-10-15.** L'utente ha allineato le rotaie sulla macchina vera, quindi i 22,9 mm sono recuperati. Resta da riportare l'allineamento **nell'assieme CAD**, altrimenti ogni quota che se ne ricava è sbagliata di 31 mm
- **Il margine del carrello Y a fine corsa è 11,5 mm a destra e 9,8 a sinistra** con la cremagliera X v5, contro i 3,5 e 1,7 di prima. È accettabile, ma è il numero da ricontrollare quando il modulo penna aggiungerà materiale sul lato basso del carrello: la fascia critica è **Z 46,7÷59**
- **I 12 V di potenza passano ancora per i rail della breadboard**, dati per ~1 A contro i 2 A di picco dei due motori. Va portato su morsetti a vite quando l'elettronica si fissa alla base

### Step 6 — Modulo penna e interfaccia utensili

**Stato:** **completato quanto alla funzione** — dal 2026-10-23 il modulo disegna, e la procedura di inserimento della penna è rodata e scritta: si porta il servo alla quota di contatto già decisa (`G0 Z-21.271`), si infila la penna finché tocca il foglio e si stringe lì. I quattro angoli (battuta 17°, foglio 25°, alzata 34°, tappo 90°) sono stabili e il tratto esce costante su metri di disegno. Resta da misurare il **gioco**, che nel profilo vale 0,30 mm come valore nominale e non è mai stato rilevato su questa macchina

**Obiettivo:** la penna si appoggia e si solleva in modo ripetibile, con pressione costante, e il modulo è intercambiabile con altri utensili senza ritarare la macchina

**Decisioni progettuali:**
- **Un solo stadio mobile, nessun giunto a gioco morto: è quello che il CAD ha costruito.** *Supera la decisione del 2026-10-16* ("architettura a due stadi sulla stessa pista, con giunto a gioco morto da 6 mm"), non per un ripensamento ma perché l'architettura a due stadi **non è mai stata messa nel CAD**: dalla `prova_1` alla `prova_4` c'è un solo pezzo mobile (`pz2`, 12 cuscinetti) che porta sia la cremagliera sia i morsetti della penna. Rilevato il 2026-10-17 e confermato dall'utente nella stessa sessione, che descrive la taratura come tre angoli di servo — cioè esattamente la presa rigida. Lo schema `modulo-penna/schema.html` (rev. 2) descrive quindi un modulo che non esiste, e porta ora una nota in testa che lo dice. **Conseguenza principale:** l'unica cedevolezza della catena sono i **0,30 mm di gioco d'ingranamento** della coppia cremagliera/pignone — dentro quei 0,30 mm `pz2` si muove senza che il pignone giri, quindi la penna appoggia col proprio peso. È un gioco morto venti volte più piccolo di quello progettato, ma della stessa natura, ed è la ragione per cui l'angolo di appoggio è tarabile invece che critico al centesimo
- **Denti dritti sul pen-lift, non doppia elica** (deciso dall'utente il 2026-10-17, dopo averla impostata a 40° il 2026-10-16). La motivazione è sua ed è migliore di quella che avevo dato io: **l'ingranaggio è avvitato a un braccetto, quindi la sua quota assiale non è un riferimento** — dipende da quanto a fondo il braccetto va sullo spline, dalla profondità della tasca e da due viti M2 in torrette stampate. I denti dritti danno un **range** su quella quota; l'elica lo converte in errore nel piano di rotazione, cioè direttamente in quota della punta. Il progetto ha già il numero, misurato sugli assi X e Y il 2026-09-26: la doppia elica chiede il centraggio sull'apice entro **±0,17 mm**, i denti dritti entro **±2 mm**. Sugli assi il riferimento assiale esiste (il pignone è piantato a pressione sull'albero, e c'è la nota del 2026-09-26 sul motore in battuta con due rondelle); qui non esiste. *Questa decisione sostituisce il motivo che avevo scritto il 2026-10-16* — "il giunto a gioco morto scollega il pignone dalla punta" — che si appoggiava a un giunto che nel CAD non c'è: la conclusione regge, il ragionamento no
- **La quota di appoggio la dà il servo, in presa rigida nei due versi.** *Supera la decisione del 2026-10-01* ("il servo fa solo il sollevamento, la penna scende per peso proprio e galleggia"), su scelta dell'utente del 2026-10-15: il timore è che la catena non sia abbastanza sciolta perché il peso della penna la porti giù, e la preferenza è dare l'altezza e provare. **Conseguenza meccanica:** il gioco morto di 1,5 mm fra naso del braccetto e linguetta della biella va a zero, e il servo resta in coppia mentre si disegna. **Conseguenza sul software:** l'angolo di appoggio diventa un **valore tarato**, che vive nella tab Impostazioni del GDC CNC 2D SLICER e va regolabile a passo fine con la penna appoggiata sul foglio
- **Il numero da tenere d'occhio con la presa rigida è la risoluzione del servo.** Un SG90/MG90S ha una banda morta di circa 10 µs, che su 2000 µs per 180° fa **circa 1° di granularità**. Con il braccetto da 30 mm dell'architettura del 2026-10-01, 1° vale **0,52 mm** alla punta e l'intera corsa di 4 mm sta in 7,6° di servo: otto posizioni distinte in tutto, troppo poche per regolare l'appoggio di una punta in fibra. Per usare 90° di servo sui 4 mm di corsa il braccetto deve scendere a **~2,5 mm**, e lì a dominare diventa il gioco dei giunti. È il vincolo di progetto vero di questa strada, e va risolto nel CAD prima della stampa, non dopo
- **Mitigazione a costo quasi nullo, se la presa rigida si rivela troppo secca: una molla in serie** fra braccetto del servo e carrello della penna. Il servo continua a dare la quota — che è quello che l'utente vuole — ma l'errore di quota si trasforma in un piccolo errore di forza invece che in punta schiacciata o linea mancante. Con una molla morbida (~0,05 N/mm), mezzo millimetro di errore vale 0,025 N su un appoggio di 0,1÷0,3 N
- **Alternativa accantonata (non scartata): discesa per gravità con servo meccanicamente staccato in appoggio.** Restano validi i tre motivi del 2026-10-01 (carta non piana, nessuna taratura di Z, nessun jitter del servo sulla punta). **Da rivedere se:** la linea esce di spessore diverso secondo il punto del foglio, o se tarare l'angolo di appoggio richiede di rifarlo a ogni cambio di foglio. Nota tecnica per quel giorno: la discesa per gravità **non chiede che il servo sia reversibile** — il servo allontana attivamente il braccetto e il carrello scende da solo — quindi quello che decide è l'attrito della guida e dei giunti, non la scioltezza del servo
- **Parallelogramma articolato, non leva basculante.** Il parallelogramma mantiene la morsa **sempre verticale** (penna di qualunque lunghezza, nessuna spazzata della coda) e con le bielle orizzontali nella posizione di disegno è **insensibile al primo ordine al trascinamento della punta**. Il conto che ha escluso la leva: con pivot 46 mm sopra la punta e braccio 30, l'attrito di trascinamento (0,15÷0,3 N) cambia la forza sulla punta del ±45% **e cambia segno col verso di tracciamento** — linee più marcate in una direzione. Alternative scartate: leva basculante su due MR63 (un solo giunto, gioco quasi nullo, ma la geometria obbliga a una penna da ≤46 mm: resta la scelta giusta se si passa a refill D1 da 67 mm con corsa 2,5); tubi telescopici in ottone Ø6 in Ø8 (la soluzione più elegante e la migliore sul trascinamento, ma l'anima da 5,1 mm accetta un refill, non una penna); slitta su aste con bronzine stampate (il gioco della bronzina va diretto sulla punta e genera isteresi)
- **La geometria è forzata dall'ingombro: l'unica colonna libera a tutte le quote è Y > 36,050.** Mappato lo spazio sul piano YZ al centro del carrello: la faccia +Y è uno smusso a ~30° che va da Y 36,05 a Z −15 fino a Y 20,05 a Z −44. Più dentro il tetto lo mette prima lo smusso, poi la parete, poi il bordo d'ala a Y 25,050. Quindi **asse penna a X −42,500 (centro carrello, dentro l'interasse dei 60 mm) e Y ≈ 44**, appena fuori dalla piastra: la penna sta in aria libera a ogni quota, **la si infila dall'alto** e si vede. Dentro (Y ≈ 23) ci sono solo 82 mm, cioè refill D1 e nient'altro
- **Corsa 4 mm, servo MG90S.** *(La pressione dalla zavorra e il gioco morto da 1,5 mm valgono per l'architettura a gravità del 2026-10-01, accantonata il 2026-10-15: con la presa rigida la pressione la dà la quota imposta dal servo e il gioco morto non c'è.)* Coppia richiesta ~9 N·mm contro i 180÷220 disponibili: 20× di margine, quindi il servo si scegle per gli ingranaggi metallici, non per la coppia. Gioco morto di **1,5 mm** fra naso del braccetto e linguetta della biella: è quello che disaccoppia il servo mentre si disegna. Alimentazione 5 V dedicata (spunto ~700 mA) e **150÷250 ms di pausa in firmware** a ogni su/giù, altrimenti a 50 mm/s si sbavano 4 mm di tratto
- **Il modulo è un'interfaccia per una famiglia di utensili, non un pezzo singolo.** Conseguenza della scelta dell'utente di fare più moduli (pennarelli diversi, in prospettiva un taglierino). Requisito che cambia: l'interfaccia deve essere un **riferimento**, non solo un fissaggio — **due spine Ø3 asimmetriche** che definiscono la posizione, con le viti che fanno solo forza, altrimenti l'offset utensile va rimisurato a ogni cambio. Più **connettore invece di fili saldati** e un secondo canale servo riservato nel fascio
- **La sede dell'utensile permette la rotazione (ritegno assiale sì, blocco in rotazione opzionale).** Così la **lama trascinata** si ha gratis: è offset rispetto al suo asse e si orienta da sola seguendo il percorso, zero assi aggiuntivi. Alternativa scartata per ora: lama tangenziale orientata attivamente, che vuole un asse A vero coordinato con X e Y (un servo non basta — ha 180° e il percorso accumula angolo) e la punta **esattamente** sull'asse di rotazione
- **Offset utensile nel modello dati del firmware adesso, a zero.** La punta non sarà dove è il riferimento del carrello: col modulo previsto sta a ~44 mm in Y. Senza il campo, il giorno in cui si monta la penna tutti i limiti e tutti i disegni si spostano di 44 mm

**Criterio di completamento:** la macchina disegna un quadrato e un cerchio su carta, con tratto di spessore costante nei due versi di tracciamento e senza salti all'appoggio

**Note (cronologia dello step):**
- [2026-10-01] Architettura progettata per intero su richiesta dell'utente, poi **rinviata**: la macchina non disegna senza il secondo appoggio dell'asse X, e senza modulo penna si muove comunque e dà già informazioni. Supera la raccomandazione data poche ore prima di fare il modulo penna **prima** del secondo asse X, che si basava sul fatto che la penna è lo strumento di misura della macchina — argomento valido ma secondario rispetto al fatto che senza appoggio il portale non si può muovere
- [2026-10-06] **Il piano carta è fissato: Z ≈ 44,2 sopra il piano di base**, perché il punto più basso del carrello Y nell'assieme sta a Z 46,68. Serve una piattaforma alta 44 mm. E l'area di disegno è centrata su X −102,6 / Y −87,9, non sul centro della macchina
- [2026-10-12] **Il requisito "alimentazione 5 V dedicata" scritto il 2026-10-01 è stato pagato in anticipo, e male.** Il servo collegato al 5 V condiviso ha mandato in brownout l'ESP32 e tenuto fermo il progetto due giorni. Ora il servo ha il suo regolatore (vedi Step 1): quando il modulo penna arriverà, l'alimentazione è già quella giusta, e il secondo canale per il taglierino si attacca allo stesso ramo
- [2026-10-06] **La precisione della punta dipende dall'altezza, non solo dall'ingombro.** Il rollio del carrello si trasferisce sulla punta con braccio ~83 mm: **1 mrad di rollio = 0,083 mm di errore**. Quindi ogni 10 mm che si alza la carta si guadagna il 12% su quell'errore. Il limite è il fondo della gabbia motore, che ha 4,9 mm di PLA sotto all'ingranaggio: portandolo da −57,5 a −55 si guadagnano 2,5 mm gratis
- [2026-10-15] **L'utente sta disegnando il CAD.** Penna scelta: **Tratto Pen, Ø 10 mm**. Fissaggio con **due morsetti a 30÷40 mm di distanza verticale** — scelta giusta per la rigidezza angolare: anche con un decimo di gioco per morsetto l'inclinazione è 0,16°, che a 60 mm sotto vale 0,17 mm, meno del tratto della penna
- [2026-10-15] **L'attacco al carrello X è sui quattro fori del motore**: reticolo quadrato da 31,0 mm, M3, con la bozza Ø22 attorno all'albero. Da verificare quale delle due facce del motore è libera, perché su quella anteriore il modulo deve scavalcare albero e pignone
- [2026-10-15] **Promemoria di posizionamento, visto che Y è motorizzato su un lato solo:** in pianta la punta va il più vicino possibile alla mezzeria dei cuscinetti del carrello X e alla trave. L'errore di posizione è l'imbardata moltiplicata per lo sbalzo, quindi ogni millimetro di sbalzo la moltiplica invece di subirla. Si misura disegnando un quadrato grande e confrontando **le due diagonali**: è anche la misura che dirà se vale la pena motorizzare il lato sinistro, per cui lo spazio è già previsto dalla prova_3
- [2026-10-15] **L'attacco è sulla faccia posteriore del motore:** nessun conflitto con albero, pignone e cremagliera. È però la faccia **più lontana dalla trave**, quindi il modulo nasce allo sbalzo massimo — la direzione in cui l'imbardata si moltiplica. Non c'è alternativa pratica, quindi il vincolo diventa tenere il modulo compatto e portare la punta il più possibile verso il lato trave
- [2026-10-15] **Quota dalla faccia inferiore del carrello X al piano: 45 mm col metro, 46,7 nel CAD.** 1,7 mm di scarto, dentro l'errore di un metro a nastro: le due misure non si contraddicono. E la quota **non serve saperla con precisione**, perché l'aggiustamento è la penna che scorre nei morsetti — motivo per cui i morsetti non vanno usati come riferimento di quota, ma solo come serraggio. Il numero serve invece per l'altezza della piattaforma della carta, e conferma i 44 mm già previsti
- [2026-10-15] **Pignone e cremagliera al posto del braccetto, per il sollevamento: il confronto.** A parità di raggio le due soluzioni hanno la stessa cinematica (corsa = r × angolo), quindi la scelta non è sul rapporto. Decide un altro numero: **il gioco di una coppia stampata, ~0,2 mm**. Su una catena rigida (~5 N/mm) vale **1 N di incertezza sulla forza di appoggio**, cinque volte la forza voluta — presa rigida e ingranaggi stampati sono incompatibili. Con una **molla morbida in serie (~0,05 N/mm)** lo stesso gioco costa **0,01 N**, e con essa diventa irrilevante anche la banda morta del servo (0,9°, che a r = 7,5 vale 0,131 mm, cioè 0,007 N). Conseguenza: la molla in serie non è un accessorio, è ciò che rende praticabile la strada scelta — e una volta che c'è, **il pignone si sceglie sullo spazio disponibile, non sul rapporto**
- [2026-10-15] **Il vero punto debole del pignone non è il pignone: è la guida verticale.** L'attrito della slitta è in serie con la forza di appoggio, quindi 0,1 N di aderenza su 0,2 N voluti sono ±50% e isteresi (la penna preme diverso dopo un'alzata e dopo essere stata spinta su dalla carta). È l'unico punto in cui il parallelogramma del 2026-10-01 resta superiore, perché un perno su cuscinetti ha attrito molto minore di una slitta. Le due cose si possono combinare: parallelogramma o lamine flessibili per **guidare**, pignone e cremagliera per **muovere**
- [2026-10-16] **L'utente sceglie cuscinetti MR63 per lo scorrimento del portapenna, e la scelta ribalta il gruppo molla.** L'attrito della guida passa da ~0,150 N (bussola stampata, μ 0,3 su 0,5 N di carico) a ~0,001 N (cuscinetto che rotola): due ordini di grandezza, e il punto debole segnalato il 2026-10-15 sparisce. Conseguenza non ovvia: **il peso proprio dello stadio flottante basta e avanza**. Un cannotto da 25 g pesa 0,25 N, cioè più dei 0,2 N che si volevano ottenere comprimendo una molla di 4 mm. Una molla che spinge in giù non serve — sommerebbe la sua forza al peso; semmai servirà **in tiro, per alleggerire**, o si toglie materiale dal cannotto
- [2026-10-16] **Architettura a due stadi sulla stessa pista**, conseguenza della precedente. Stadio comandato: 2 cuscinetti, porta la cremagliera, la sua quota è l'angolo del servo. Stadio flottante: 4 cuscinetti in due coppie, porta i morsetti e la penna, appoggia per peso proprio. Fra i due un **giunto a gioco morto da 6 mm** (perno in asola) che impedisce alla quota imposta dal servo di arrivare alla punta. Con esso l'angolo di appoggio torna **non critico** e **il servo si può rilasciare a penna giù** — era l'unico vantaggio che la soluzione a gravità del 2026-10-01 aveva e che la presa rigida aveva perso. La decisione del 2026-10-15 regge quindi nella sostanza (il sollevamento è positivo e comandato), ma la forza d'appoggio torna al peso proprio
- [2026-10-16] **L'interasse fra le due coppie di cuscinetti è la quota che decide la precisione.** Il gioco residuo arriva alla punta amplificato: `errore = gioco × (1 + h/s)`, con h = quanto la punta sta sotto la coppia inferiore e s = interasse. Con 0,05 di gioco e h = 40: s = 15 → 0,18 mm; s = 25 → 0,13; s = 40 → 0,10; s = 55 → 0,09. Non si azzera, si diluisce — conviene spendere in altezza ogni millimetro che l'inviluppo concede
- [2026-10-16] **Due accorgimenti di stampa e montaggio per la pista:** precarico obbligatorio (un perno eccentrico per coppia, come sui carrelli), altrimenti il rotolamento non serve a niente perché il gioco va dritto alla punta; e righe di strato **nel verso dello scorrimento**, perché un cuscinetto da 6 mm che rotola perpendicolare agli strati li scavalca uno per uno
- [2026-10-16] **Primo CAD del modulo (`modulo_tratto-pen_tot_prova_1`), analizzato.** Nessuna interferenza fra i 21 componenti — il contrario degli assiemi precedenti, dove le booleane ripescavano otto collisioni finte. **La guida è vincolata correttamente:** 8 cuscinetti stringono una piastra in Z (spessore 5,000, luce fra i cuscinetti 5,400) e 4 stringono una nervatura in X (larghezza 5,600, luce 6,000); insieme bloccano cinque gradi di libertà e lasciano libera solo la traslazione lungo l'asse della penna. L'imbardata, che è l'errore che si dimentica più spesso, è vincolata
- [2026-10-16] **BUG EREDITATO: il reticolo dei fori motore è 31,0000 × 31,4500, non 31 quadrato.** Verificato su `pz1` e, nello stesso file, **sul carrello: identico, 31,0000 × 31,4500**. È lo stesso scarto di 0,450 registrato il 2026-10-05 sui fori motore del carrello e accettato perché "le viti entrano, i 0,500 di scarto stanno dentro il gioco Ø4 su M3". Allora era un pezzo, ora sono due, e la nota di allora diceva già il punto: **il gioco di registrazione è esaurito**. Conseguenza nuova e peggiore: la posizione di `pz1` sul motore è la posizione della punta, cioè l'offset utensile — e non c'è margine per registrarla con le viti
- [2026-10-16] **Il gioco della guida è 0,200 per lato su tutti e dodici i cuscinetti**, cioè 0,400 totali in entrambe le direzioni. Amplificato dalla leva vale **0,942 mm alla punta** (interasse coppie 35,450, punta 48,022 più in basso, fattore 2,355). I fori Ø3,2 su perni Ø3 danno esattamente 0,200 di ripresa: l'intenzione c'è, ma il margine è zero e i fori sono tondi, quindi il cuscinetto scappa in qualunque direzione mentre si stringe. Ripreso a 0,05 l'errore scende a 0,118 mm
- [2026-10-16] **Bilancio della massa flottante: 44÷61 g, cioè 0,44÷0,60 N, contro i 0,20÷0,29 N previsti.** `pz2` è 67,54 cm³ di solido (25÷42 g stampato secondo i parametri), più penna ~10 g, dodici cuscinetti ~5,4 g, attacchi e coprivite ~4,1 g. La forza d'appoggio si regola con una molla di richiamo **in tiro**, non alleggerendo il pezzo: 25 g di pezzo stampato non si raggiungono svuotando
- [2026-10-16] **Corsa sulla pista: 25,350 mm totali, ma 10,000 esatti in discesa e 15,350 in salita.** La pista è lunga 69,800 e il gruppo cuscinetti ne occupa 44,450. I 10 mm di corsa ci stanno, ma in discesa il margine è **zero**: conviene spostare il gruppo verso l'alto sulla pista finché è un parametro nel CAD e non un pezzo stampato
- [2026-10-16] **Il morsetto, come modellato, non tocca la penna** — ed è giusto, è disegnato aperto. Ma le distanze dicono due cose: la sede in `pz2` è una **parete piana** a 0,500 dalla penna (nessuna faccia cilindrica con asse penna in `pz2`), e l'attacco è un arco Ø12 su una penna Ø10, a 1,000. A morsetti stretti **l'asse della penna si sposta fino a 0,5 mm** rispetto al modello, e il contatto avviene sui due spigoli dell'arco. Una sede a V in `pz2` definirebbe l'asse per costruzione e distribuirebbe il contatto
- [2026-10-16] **I due coprivite sono fuori posizione:** stanno a X 42÷49, a 13,5 mm dal pezzo più vicino, dove non c'è nient'altro, e non hanno nessuna faccia cilindrica (nessun alloggiamento per la vite). Da posizionare e finire
- [2026-10-16] **Interasse dei morsetti: 40,000 mm**, cioè il massimo della forchetta 30÷40 che l'utente aveva indicato. Scelta giusta: la rigidezza angolare cresce con l'interasse
- [2026-10-16] **prova_2 analizzata.** Zero interferenze fra 23 componenti. `pz1` allungato di 6,000 mm sul lato basso: la corsa sulla pista passa da 10,000/15,350 a **16,000 in discesa e 15,350 in salita, 31,350 totali**, ben centrata sui 10 mm di corsa utile. `pz2` alleggerito del 6,6% (da 67,54 a 63,08 cm³). Servo spostato di −6,000 in Y e +3,400 in Z. Aggiunte le due viti dei morsetti
- [2026-10-16] **L'albero del servo è lungo Z, non lungo X.** Ø4,800 a X −37,450, Y −4,080, uscente verso il basso da Z −52,800. Quindi il pignone gira nel piano XY e la cremagliera è una stecca verticale lungo Y con i denti rivolti verso −X — coerente con la zona evidenziata dall'utente sulla faccia di `pz2` a X −16,500
- [2026-10-16] **Il diametro del pignone lo decide una distanza sola:** dall'albero (X −37,450) alla linea primitiva della cremagliera. E siccome il pignone sta sotto Z −52,800, cioè **sotto `pz1` che finisce a Z −41,200**, il suo ingombro laterale non interferisce con il corpo del modulo: si sceglie liberamente. `z28` → cremagliera a filo della faccia (sporgenza 1,45) ma disco Ø45; `z20` → sporgenza 7,45 e Ø33, **ed è il pignone che il progetto già stampa per gli assi**; `z14` → sporgenza 11,95 e Ø24. Con il gioco morto la risoluzione non è un criterio, quindi la scelta è fra sbalzo della cremagliera e ingombro del disco
- [2026-10-16] **Le due viti dei morsetti pesano ~19 g in acciaio** (Ø5,49 × 36,9), cioè **circa un terzo della massa flottante**. Bilancio aggiornato: 62÷70 g = **0,61÷0,69 N**, peggiore della prova_1 nonostante `pz2` sia più leggero, perché prima le viti non erano modellate. La testa sta a X 47, cioè 28,6 mm fuori dalla faccia di `pz2`: accorciare la vite è il risparmio di massa più grosso disponibile, e toglie anche lo sbalzo
- [2026-10-16] **I coprivite restano a X 42÷49**, ora accoppiati alla testa delle viti. L'insieme vite + coprivite sporge quindi di 28,6 mm dal fianco di `pz2`, in aria. Da chiarire se è voluto (una manopola che si raggiunge con le dita) o se vanno riavvicinati
- [2026-10-16] **DECISIONE: l'ingranaggio si attacca al braccetto in dotazione, non si stampa la scanalatura.** Proposta dell'utente, ed è la scelta giusta per una ragione quantitativa: lo spline di un SG90 ha 21 denti in modulo 0,2, cioè denti che sporgono di **0,20 mm** sopra la primitiva (altezza totale 0,45) — metà di una larghezza di estrusione. In PLA non ingrana, o ingrana e si spiana al primo carico. Il braccetto è stampato a iniezione, ha lo spline fatto bene e arriva con la vite di ritegno assiale. Si annega in una tasca dell'ingranaggio, si centra **sul mozzo tondo** (concentrico allo spline) e si indicizza sui bracci, tagliando i due lunghi a filo e tenendo i due corti. La coppia in gioco è ~2 N·mm, che su un braccio da 10 mm fa 0,2 N: due bracci avanzano. Fissaggio con due viti M2 nei fori che il braccetto ha già, meglio della colla perché smontabile. **Dettaglio che non va dimenticato: foro di accesso Ø3 sull'asse**, passante, altrimenti dopo l'incollaggio non si arriva più alla vite del servo e per smontare si distrugge l'ingranaggio
- [2026-10-16] **Il diametro del pignone ora dipende anche dal braccetto.** La tasca non può superare `m·(z − 2,5) − 4` (2 mm di spalla sotto i denti): z14 → 13,25; z20 → 22,25; z24 → 28,25; z28 → 34,25. Da misurare col calibro la campata dei due bracci corti e scegliere di conseguenza. Resta il compromesso dell'altro verso: più denti, meno sporgenza della cremagliera da `pz2` (z20 → 7,45; z28 → 1,45)
- [2026-10-16] **Cremagliera del pen-lift quotata** in `modulo-penna/cremagliera-e-pignone.html`. Modulo 1,5, angolo di pressione 20°: fianchi **rettilinei** — l'evolvente sta tutta nel pignone — quindi bastano tre semilarghezze e due altezze. Semilarghezza 0,63214 alla cresta, 1,17810 alla primitiva, 1,86054 al fondo; addendum 1,500, dedendum 1,875, passo 4,71239. Vano al fondo 0,99131, quindi raccordo massimo 0,496 e consigliato 0,3÷0,4. **Sei denti (28,274) bastano** per i 10 mm di corsa con presa di un dente per lato; larghezza della stecca 2 mm più del pignone, 1 per lato
- [2026-10-16] **Le quote del braccetto non sono standardizzate, e lo spline è incerto di 0,3 mm.** Cercate: nessun produttore pubblica un disegno quotato del braccetto a croce dell'SG90, e le dimensioni cambiano fra i cloni. Sul diametro esterno dello spline le fonti danno 4,6 / 4,8 / 4,9 — per un accoppiamento a contatto è una divergenza inaccettabile. Concorde invece il numero di denti, 21, da cui si deduce il modulo 0,2 (primitivo Ø4,2, esterno Ø4,6). Conseguenza di metodo: il disegno del braccetto è stato fatto **parametrico su sei quote da rilevare col calibro** (`modulo-penna/braccetto-e-ingranaggio.html`), non su valori presi da internet
- [2026-10-16] **Il numero di denti del pignone lo decide la campata dei bracci corti:** `z ≥ (A + 4) / 1,5 + 2,5`, dove A è la campata dopo aver tagliato i due bracci lunghi. Sotto A = 22 il pignone resta lo **z20 già in uso sugli assi**. E il centraggio dell'ingranaggio va fatto **sull'alloggiamento del mozzo** (tornito concentrico allo spline) con 0,2 di gioco, mentre la tasca dei bracci ha 0,4 di gioco e non centra niente: centrare sui bracci importerebbe nell'ingranaggio l'eccentricità dello stampo del braccetto
- [2026-10-16] **MIO ERRORE, segnalato dall'utente: il profilo della cremagliera gliel'avevo dato a gioco zero.** Le quote di accoppiamento avevano il loro gioco (tasca del braccetto A+0,4, mozzo C+0,2, stecca 1 mm per lato più larga del pignone), ma il profilo del dente erano le quote teoriche. **Una coppia stampata a gioco zero non ingrana.** Corretto: gioco di ingranamento **j = 0,30 mm**, scaricato tutto sulla cremagliera assottigliandone i denti sulla primitiva — semilarghezza da 1,17810 a **1,02810**, cresta 0,48214, fondo 1,71055, vano al fondo 1,29131 (che in cambio permette un raccordo fino a 0,645)
- [2026-10-16] **Perché 0,30 e non meno.** La posizione della cremagliera rispetto all'albero del servo è una catena che passa per la sporgenza stampata su `pz2`, la posizione dei cuscinetti e la sede del servo in `pz1`: realisticamente ±0,3 mm. E un errore di interasse cambia il gioco di `2·tan20° = 0,728` volte sé stesso. Con j nominale 0 il gioco reale va da −0,218 a +0,218, cioè **grippa metà delle volte**; con j = 0,30 va da +0,082 a +0,518 e non grippa mai. E qui il gioco **non costa niente**, perché il giunto a gioco morto rende la forza sulla carta indipendente dalla posizione del pignone: conviene esagerare
- [2026-10-16] **Il gioco non si fa mai riducendo il modulo.** Mettere 1,48 invece di 1,50 cambia il passo, quindi i denti si disallineano progressivamente lungo la stecca e un ingranamento buono in mezzo si impunta alle estremità. Si fa sullo spessore del dente o sull'interasse
- [2026-10-16] **Onshape: la feature Spur Gear ufficiale non ha un campo per il gioco** (verificato sul forum Onshape; alcune versioni custom l'hanno aggiunto spostando l'angolo dell'evolvente). È il motivo pratico per cui il gioco va messo nella cremagliera, che è uno sketch a mano e quindi sotto controllo. Parametri del pignone: teeth 20, module 1,5 mm (non diametral pitch), pressure angle 20°, depth 6, root fillet attivo, nessun bore. Tasca, alloggiamento del mozzo, foro di accesso Ø3 e fori M2 come feature separate sul corpo generato
- [2026-10-16] **prova_3: pignone modellato e `pz2` alleggerito del 27%** (da 63,08 a 46,20 cm³). Zero interferenze fra 24 componenti. Pignone z25 confermato nel CAD: centro X −37,500, Ø esterno 40,41 × 40,48, spessore 10,009. Profondità portata a 10 perché l'incavo del braccetto è 7 e con 8 restava 1 mm solo di presa filetto per le M2; con 10 ne restano 3. **Ci sta, ma è il massimo**: sotto l'albero del servo (Z −52,800) e il fondo di `pz2` (Z −63,100) ci sono 10,30 mm, e il disco ne usa 10
- [2026-10-16] **Corsa in discesa di `pz2`: 11,000 mm.** La limitano i cuscinetti inferiori (2 e 8) che arrivano in fondo alla pista; la scansione per collisione conferma il primo contatto a 11,1 mm, stesso evento. Fra prova_2 e prova_3 la pista si è accorciata di 5 mm sul lato basso (da Y −35,978 a −30,978) e la discesa è passata da 16,000 a 11,000: allungare la pista verso il basso è la leva se servisse più corsa. Salita 15,350, corsa totale **26,350**
- [2026-10-16] **La cremagliera vuole 9 denti (42,412).** Con l'origine sulla faccia inferiore di `pz2` (Y −30,000): nella posizione modellata il pignone ingrana a 25,922 dal fondo della stecca, a fine discesa a 36,922, a fine salita a 10,572. Con un dente di presa oltre ciascun estremo servono denti da 5,860 a 41,634, cioè 8,84 passi. **8 denti (37,699) non bastano**
- [2026-10-16] **Il servo non è il vincolo, e questo smonta il timore del montaggio.** A raggio 18,750 valgono 0,3272 mm per grado: l'intera corsa della guida (26,350) sta in **80,5° su ~180 disponibili**, e la corsa utile di 10 mm in 30,6°. Margine di montaggio **±49,7°, cioè ±16,3 mm**. Lo spline ha 21 denti, quindi le posizioni di montaggio sono quantizzate ogni 17,14° = 5,61 mm: con quel margine va bene qualunque dente entro ±2 posizioni da quella ideale
- [2026-10-17] **Il range assiale che i denti dritti concedono, misurato: 4,0 mm in tutto, ma 3,796 sotto e 0,196 sopra.** La stecca è larga 14,000 e il pignone 10,009, quindi la sovrapposizione di fascia tollera 4 mm di sfalsamento assiale — è esattamente il margine che l'utente dice di volersi tenere scegliendo i denti dritti. Non è però centrato: nella posizione modellata il pignone può scendere di 3,8 mm e salire di due decimi. In montaggio il pignone va quindi tenuto **alla quota modellata o più in basso**, mai più in alto; se si vuole il margine da entrambe le parti, basta spostare la fascia dentata di ~1,8 mm verso l'alto in Z
- [2026-10-17] **prova_4 analizzata: la cremagliera è modellata, geometricamente esatta, e a gioco zero.** Unica differenza da `prova_3`: `pz2` cresce di 1,800 in −X (la dentatura) e di 1,43 cm³. Zero interferenze fra tutti gli altri 23 componenti. Passo 4,712, profondità 3,375, fianchi a 20,00°, interasse 18,750: tutto esatto al millesimo. **10 denti** da Y −30,000 a +16,133, cioè 1,24 denti di margine sotto e 0,95 sopra il campo che serve (−24,140 ÷ +11,634). Corsa invariata, 11,000 in discesa e oltre 20 in salita escludendo i cuscinetti. Larghezza della stecca 14,000 contro i 10,009 del pignone, non centrata: sporge 3,796 sotto e **0,196 sopra**, quindi se il pignone deve spostarsi assialmente in montaggio ha margine solo verso il basso
- [2026-10-17] **MIO ERRORE, secondo giro sulle stesse tolleranze: il gioco j = 0,30 non è nel CAD.** Misurato traslando la stecca lungo Y a pignone fermo a passi di 0,025: la finestra senza compenetrazione è larga **0,000 mm** — un punto solo, non un intervallo. La curva è simmetrica attorno a quel punto (0,286 mm³ da una parte, 0,302 dall'altra), quindi i profili sono coniugati esatti: il disegno è giusto, è solo troppo pieno. Le quote disegnate sono le nominali (pianetto di cresta 1,264, vano al fondo 0,991) e non quelle della sezione 2 della scheda (0,964 e 1,291). **Causa probabile:** la scheda metteva le quote con l'offset in una tabella di semilarghezze, che non sono le quote che si disegnano in uno sketch — i pianetti sì. Corretta la scheda con le due quote da cambiare espresse come larghezze
- [2026-10-17] **CORREZIONE DI UN MIO NUMERO: il centro del pignone è X −37,450, non −37,500,** e quindi la primitiva della stecca è a **X −18,700**, non −18,750. L'avevo letto dal bounding box del pignone, che per una dentatura non allineata agli assi non è simmetrico (40,410 × 40,482). Il centro vero si legge dai cilindri di testa (R 20,250) e di fondo (R 16,875), concentrici. Nel CAD la stecca è a −18,700, cioè **giusta**: l'interasse misurato è esattamente 18,750. Il valore −37,450 era già scritto correttamente nella nota del 2026-10-16 sull'albero del servo: l'errore è stato usare il bounding box nella scheda invece di quel numero
- [2026-10-17] **La massa flottante non è più un problema di budget, perché non è più la forza d'appoggio.** Il bilancio aggiornato su `prova_4` dà 46÷56 g con riempimento 35÷50% (0,45÷0,55 N), di cui **19,15 g sono le due viti dei morsetti** in acciaio (9,58 g ciascuna, M6 × ~41). Ma con la presa rigida la forza sulla carta la dà la quota, non il peso: il peso serve solo a essere sollevato, e il servo a r = 18,750 dà 9,4 N contro 0,55, cioè **17× di margine**. Il target 0,20÷0,29 N scritto il 2026-10-16 valeva per l'architettura a gravità e **non si applica più**. Resta un motivo più debole per alleggerire (inerzia e vibrazione sull'alzata), e resta che dentro i 0,30 mm di gioco la penna appoggia col proprio peso: lì 0,55 N è il doppio di quello che si voleva
- [2026-10-17] **I bulloni esagonali nei morsetti: sì, ma il verso del carico decide dov'è la tasca.** La vite non tira, **spinge**: avanza nel filetto e la sua punta preme sul magnete dell'attacco, che schiaccia la penna. La reazione spinge quindi il bullone **verso l'esterno**, cioè fuori da una tasca aperta sul lato della testa. La tasca va aperta verso l'interno (lato penna) e la spalla deve stare sul lato esterno. Misure rilevate: la parete del morsetto va da X 7,50 a X 16,50 (**9,0 mm**), foro Ø5,500 passante, punta della vite a X 6,10. Un dado M6 standard (10,0 sulle facce, 5,0 di spessore) sta in tasca da X 7,50 a 12,70 e lascia **3,80 mm di spalla**: ci sta senza ingrossare niente. Il foro residuo va aperto a Ø6,5. Il fastidio è che la tasca guarda in orizzontale, quindi il dado cade mentre si monta: tasca a 10,1 sulle facce (presa a frizione) e si inserisce prima dell'attacco, che poi lo intrappola
- [2026-10-16] **Pignone grande o piccolo, per la forza del servo: non è un criterio.** Forza alla cremagliera = coppia / raggio. Con 1,8 kg·cm (≈177 N·mm) e r = 18,750 escono **9,4 N**; con r = 10,5 (z14) 16,9 N. Ma la massa flottante da sollevare è 0,55÷0,60 N, quindi il margine è **15×** già col pignone grande. Quello che il pignone grande compra davvero: la cremagliera cade sulla parete di `pz2` invece che su una mensola (meno massa flottante, che è il parametro fuori budget) ed è **1,8× più veloce** nell'alzata (0,051 s contro 0,091 per 10 mm), il che però conta poco contro il tempo di assestamento. Criterio vero: la geometria, non la coppia
- [2026-10-21] **MODULO MONTATO**, cuscinetti compresi: il collo di bottiglia del progetto si è sbloccato. L'utente riferisce accoppiamento cremagliera/pignone buono e cuscinetti che scorrono con gioco vicino a zero — resta da **misurare il gioco d'ingranamento**, che da progetto vale 0,30 mm e **non va ridotto**: è quello che ha preso il posto del giunto a gioco morto, e dentro quella banda la penna appoggia col proprio peso invece che con la quota imposta. Due cose scoperte al montaggio: il servo gira **al contrario** (risolto convertendo in un punto solo per lato della catena), e la prima taratura ha messo la battuta a **1° logico = 2489 µs**, fuori dalla specifica 500÷2400 dell'SG90 — l'ingranaggio è stato calettato col servo già contro il proprio fermo interno. Da rifare spostando l'ingranaggio di un dente di cannula (~19°), che porta la zona di lavoro a 2122÷2289 µs
- [2026-10-21] **La piattaforma da 44 mm è eliminata** (decisione dell'utente). Supera la nota del 2026-10-06, che la dava come necessaria: il piano carta a Z ≈ 44,2 nasceva dal punto più basso del carrello Y a Z 46,68, quando il modulo penna non era ancora disegnato. **Col modulo Tratto Pen montato sulla testina X lo spazio verticale libero è meno di 40 mm**, quindi la piattaforma non ci sta sotto. Il piano resta **unico: la tavola**, e il foglio ci appoggia sopra. Conseguenza sulla taratura: l'angolo di penna abbassata si impone stringendo la penna contro **la tavola**, non contro uno spessore — la quota assoluta non è mai stata un vincolo, perché a regolarla è la penna che scorre nei morsetti (nota del 2026-10-15). CAD aggiornato in arrivo
- [2026-10-22] **Il CAD con il modulo montato, letto numero per numero** (`misure/cad-assieme.md`). Tavola a Z 0, 700 × 600. **Asse della penna X −198,01 · Y −215,78**, ricavato dalla sede a V su `pz2` (tangenza di un Ø10 esattamente sulla bocca: la sede è disegnata per il Tratto Pen). **Sbalzo in Y 70,47 mm** dalla mezzeria del carrello, 50,94 oltre la faccia della trave — in X la punta è centrata a +7,67. **Punto più basso della testina Z 26,68** (16,68 a fondo corsa dello stadio flottante), quindi il vincolo sul foglio resta l'alzata della penna, 2,945 mm. Zona di disegno stimata X −206,20…49,89, Y −217,91…25,16, tutta sulla tavola con 32,8 mm davanti: ±2 mm, perché dipende da quali facce toccano i blocchi
- [2026-10-22] **Battuta misurata 17°** con la striscia di carta, contro i 19 fissati per costruzione il giorno prima: i due gradi sono quello che il modulo aveva ancora da scendere quando il pignone è stato calzato. I 25° di penna abbassata restano, perché non sono battuta + 6 ma l'angolo a cui la penna è stata stretta. **Nasce la posizione tappo a 90°**, che fa due lavori: riposo a fine stampa e all'accensione, e tetto del meccanismo (oltre, lo stadio flottante esce dalle guide). Conseguenza su FluidNC: l'arco dell'asse Z va dal contatto al tappo e non all'alzata, se no `mapConstrain` tronca — `max_travel_mm 21.271`, impulsi 2222 e 1500. **E il parser di FluidNC non accetta commenti in coda a una chiave**, cosa che il nostro config.yaml faceva quasi ovunque: riscritto il generatore, e il file a mano sostituito dalla copia generata
- [2026-10-23] **Il modulo disegna, e la procedura di montaggio della penna è quella definitiva.** Non si cerca la quota giusta muovendo il servo: si porta il servo alla quota **già decisa** e si stringe la penna lì — i 25° non sono una misura, sono un'imposizione, e il profilo lo dice da sempre. Il foglio deve essere sotto durante la stretta, perché la quota è definita *punta sul foglio* e non *punta sulla tavola*. Verificata su più stampe: il tratto resta costante su 4,4 m (vortice) e su 21 m di spirografo per quanto ne ha fatto. **Resta aperto il gioco**, l'ultimo parametro del profilo mai misurato: la rosa mistica dei medaglioni è stata disegnata apposta per leggerlo — nove vertici su cui convergono otto corde ciascuno, e se il punto d'arrivo dipende dalla direzione d'arrivo i vertici chiudono in una rosellina larga quanto il gioco

- [2026-10-26] **Il cambio colore non è un cambio di taratura.** Montando la penna nuova con il servo già **alla quota di contatto del programma in corso**, la procedura di montaggio del 2026-10-23 vale identica a metà stampa: si infila finché tocca il foglio e si stringe lì. Da qui la cancellazione della correzione di Z nel Sender (vedi Step 4), e il conto che la giustifica: 0,9° di banda morta del servo = **0,29 mm** alla punta, dieci volte lo spessore di un foglio.

### Step 7 — Logo e identità visiva della macchina

**Stato:** in corso — **tre varianti costruite e consegnate, nessuna ancora scelta.** Il generatore (`logo/cnc2d.js`) compone le lettere dai contorni veri di **Jost Bold** letti dal file del font e applica le regole misurate sul logo GDC Stuff

**Obiettivo:** un logo della macchina che si legga sul telaio e in fondo a un foglio, derivato dal logo GDC Stuff invece che somigliargli, e **disegnabile dalla macchina stessa**

**Decisioni progettuali:**
- **Le tre lettere di GDC non sono un alfabeto, quindi non si continua l'alfabeto.** Misurate sui percorsi del file: la G ha l'asta a **0,257** dell'altezza maiuscola, la C a **0,181**. Sono tre segni disegnati uno per uno; chiedere al disegno «come sarebbe una N in questo carattere» non ha risposta
- **Si continuano invece i tre modi di interrompere la forma**, che sono trasportabili su qualunque lettera: la **C spezzata** (vuoto di 64,8 su 196,6, un terzo della lettera, e si legge «C» comunque — *chiusura*), la **D piena** senza occhiello (*figura-sfondo* all'estremo), la **D più bassa** delle maiuscole (0,751, allineamento rotto per scelta). Nel logo dell'utente la chiusura c'era già, e non per caso
- **Il font di base è Jost Bold, con i contorni letti dal TTF** e non ridisegnati a mano: upem 1000, maiuscola 700. La **D piena è invece costruita** come mezzo ellisse al rapporto misurato (97 × 147,6), perché la D di Jost è disegnata come asta + pancia e non come esterno + occhiello: riempirla non dà un semicerchio pieno, dà una D con la pancia chiusa
- **La prossimità fa la lettura:** nella variante a riga lo stacco fra parola e numero è il **doppio** dell'avvicinamento fra le lettere, ed è quello che fa leggere «CNC» e «2D» come due cose invece di cinque segni in fila

**Criterio di completamento:** l'utente conferma una variante, e di quella esiste la versione **plottabile** — senza `clipPath`, con le due metà della C come percorsi veri — disegnata dalla macchina su carta

**Note (cronologia dello step):**
- [2026-10-27] **Misurato `gdc master.svg` campionando i percorsi veri**, non a occhio: asta della G 50,6/196,6, della C 35,4/196,6, vuoto della C 64,8, D 97 × 147,6 e **piena**, due filetti 116,55 × 7,14 ai lati di STUFF. Ogni costante del generatore è una di queste misure, in frazione dell'altezza maiuscola.
- [2026-10-27] **Tre varianti, tre usi diversi.** **A — la riga:** `CNC 2D` in fila, da leggere, regge fino a 16 px. **B — il monogramma:** lo schizzo dell'utente messo in squadra, il 2 e la N fusi sulla larghezza di un'asta. **C — la chiusura:** `CNC` grande col `2D` dentro al vuoto della C finale, cioè il difetto trasformato nel posto dove sta il resto del nome; va usata grande, perché a 16 px il «2D» si chiude in una macchia. **La variante B è la mia lettura dello schizzo e va confermata:** nella foto il secondo segno può essere un 2 dentro la N o una N col ricciolo, e ho scelto.

### Step 8 — Miglioramenti della macchina: cavi, box elettronica, alloggiamenti

**Stato:** in corso — **progetto sui numeri del CAD, niente stampato.** Tre fronti aperti dall'utente il 2026-10-27: i cavi dei motori e del servo che strisciano sul piano, il circuito da chiudere in un box con coperchio trasparente, e lo spazio libero a sinistra da trasformare in alloggiamenti

**Obiettivo:** nessun cavo tocca il piano in nessuna posizione dei carrelli; il circuito resta **a vista** dentro un box chiuso; fogli, penne e moduli hanno un posto sulla macchina

**Decisioni progettuali:**
- **Il box va nella striscia da 140,04 mm, non in quella da 147,5.** A sinistra ci sono **due** strisce libere e non una: la prima (X −493,74 … −353,70) ha **altezza libera** perché la trave finisce lì; la seconda (fino a X −206,20) è più larga ma ha il **soffitto a Z 104,18**, dove il portale ci passa sopra. Un box alto 120 nella seconda lo prende in pieno il portale
- **Catena stampata sull'asse Y, cavo piatto sopra la trave per l'asse X.** La faccia superiore della trave è a **Z 127,68** e sopra non c'è niente: un cavo lì è più alto del foglio, della penna e di qualunque cosa appoggi sul piano — **toglie** il cavo dal piano invece di spostarlo. Sull'asse X la catena è scartata non per ingombro ma per massa: 17 maglie sul carrello sono peso nel posto peggiore della macchina, con lo **sbalzo di 70,47 mm** in Y che lo moltiplica sull'imbardata (vedi `cad-assieme.md`)
- **Gli alloggiamenti sono due oggetti, non uno.** I fogli A5 in piano entrano per **mezzo millimetro** (148 contro 147,5) e le penne in piedi non ci stanno sotto un soffitto di 104: quindi un vano **basso** sotto la trave (fogli coricati, moduli) e una rastrelliera **alta** accanto al box, dove l'altezza è libera. Progettare un contenitore unico sarebbe stato scoprirlo a stampa fatta

**Criterio di completamento:** portando i carrelli a tutte e quattro le combinazioni di fine corsa nessun cavo sfiora il piano né si impiglia; il coperchio del box chiude con il circuito dentro e si vede; fogli, penne e moduli stanno al loro posto

**Note (cronologia dello step):**
- [2026-10-27] **`misure/cavi-box-e-alloggiamenti.md`:** le due strisce a sinistra, i percorsi possibili per i due assi, e la catena dimensionata — **passo 16, raggio 30**, che fa 29,9° per giunto e rispetta la regola dei 5÷10 diametri di cavo; **17 maglie su X e 16 su Y**, ansa alta **84 mm**. Tutti i numeri vengono dal STEP, non dallo schermo.
- [2026-10-27] **Tre misure mancano e non si inventano:** la **sezione della rotaia destra** (nel CAD c'è la cremagliera, non la rotaia) e dove ci si può avvitare, l'**ingombro della scheda** con driver e alimentatore, il **diametro vero dei cavi**. E i 140 mm vanno confermati col metro, perché la posizione dei blocchi nel CAD vale ±2 mm.

### Step 9 — Il telecomando della macchina

**Stato:** in corso — **manca solo il firmware.** Il lato SLICER c'è e gira (`webui/js/telecomando.js`, collaudato contro un telecomando finto) e il protocollo è completo: dal 2026-10-29 porta anche il **colore della penna**. La grafica del vetro è disegnata, misurata e approvata nel banco di prova `schermo/mock.html`, dove si **sentono** anche i quattro suoni. Piedini, numeri dei pad e componenti sono verificati sugli **schemi Altium del carrier**. Il firmware non è scritto e **non è compilabile da dentro la sessione**: `downloads.arduino.cc` è bloccato come `docs.arduino.cc`, quindi niente `arduino-cli`, niente core SAMD, niente `Arduino_MKRIoTCarrier` — servirà una tornata di compilazione sulla macchina dell'utente

**Obiettivo:** sapere che cos'è successo alla stampa **senza guardare il portatile**, e poter chiudere il cambio penna **stando alla macchina** — con le mani sulla penna, che è dove la procedura si svolge

**Decisioni progettuali:**
- **L'oggetto è un MKR IoT Carrier Rev2 con dentro un MKR WiFi 1010**, già in casa: display TFT tondo 1,3" 240 × 240, **cinque tasti** capacitivi intorno, cinque LED RGB APA102, **cicalino**, micro SD, batteria 18650 con ricarica via USB. *Supera l'ipotesi presa poche ore prima nella stessa giornata* — un pannello **GC9A01** pilotato dal secondo ESP32 — che funzionava e costava zero ma non aveva tasti né batteria, e voleva cinque fili SPI dal box al coperchio accanto ai cavi dei motori. Il carrier risolve tutte e quattro le cose, e **non è uno schermo: è un telecomando che ha anche uno schermo**
- **Il telecomando è un secondo client del SLICER, non della macchina.** I dati che deve mostrare **non esistono in FluidNC**: la stampa non è un file che l'ESP32 esegue, è il browser che manda una riga alla volta e conta gli `ok`. Percentuale, tempo rimanente, cambi penna, errori e colore della penna vivono in `State.data.stampa` e da nessun'altra parte. Scartate: leggere da FluidNC come secondo client (dà posizione e `Run/Idle/Hold`, cioè la metà facile e non quella che serve) e mettere il display sull'ESP32 montato (vuol dire forkare FluidNC e perdere la corrispondenza con la 4.1.1 verificata il 2026-10-22, dove il `config.yaml` è **generato** e il firmware è quello ufficiale)
- **Un canale solo, in due versi.** Un browser non apre socket TCP: il telecomando fa da **server HTTP**, il SLICER gli manda lo stato con un `POST`, e **la risposta a quel POST riporta il tasto premuto e la carica**. Il telecomando non comincia mai lui una conversazione, non conosce l'indirizzo della macchina e non ci parla: la regola «non comanda FluidNC» così non è disciplina, è **struttura**
- **I tasti non reimplementano niente**: entrano dalla stessa porta da cui entrerebbe un dito sulla pagina — pausa e riprendi al `Sender`, i due passi del cambio penna al `Popup` che già li governa. Due procedure di cambio penna divergerebbero alla prima modifica, e te ne accorgeresti col foglio rovinato
- **Il telecomando non muove la macchina**: ferma, riprende, guida il cambio penna. Mandare un carrello da qualche parte vuol dire guardare delle coordinate, e su 33 mm di vetro le coordinate non ci stanno. L'unica eccezione è il tasto **PROVA** del montaggio, che alza e abbassa il servo — lo stai guardando da venti centimetri con la penna in mano
- **Lo STOP si conferma due volte** (richiesta dell'utente): un tocco che **chiede**, con l'anello che diventa un conto alla rovescia rosso e si svuota, più un **ANNULLA** esplicito; poi un secondo tocco **tenuto un secondo**, con uno spicchio che si riempie al centro del vetro. Lo spicchio è un oggetto diverso dall'anello apposta — l'anello sta sul bordo e dice a che punto è la stampa, lo spicchio sta in mezzo e dice a che punto è il tuo dito — ma girano nello stesso verso. Al SLICER arriva **un `stop` solo, già confermato**: i due tempi sono interfaccia del telecomando
- **Quattro suoni: due allarmi e due motivetti**, e uno solo si ripete. Il punto è capire cosa è successo **senza guardare**. **Cambio penna** (due colpi, **ogni 20 s finché non premi**) e **problema** (uno lungo) devono arrivare *dall'altra stanza*: stanno su **una nota sola**, quella della risonanza del cicalino, e si distinguono per il **ritmo** — una differenza che regge anche attutita da una porta, mentre due altezze diverse, attutite, diventano la stessa cosa. **Partenza** (tre note che salgono) e **fine** (un motivetto che scende e torna su) li senti da vicino e possono permettersi delle note, tutte dentro l'ottava in cui il trasduttore parla (**A7-D8, 3,5-4,7 kHz**); la fine **attacca sulla nota più forte**, così la prima cosa che senti arriva comunque lontano. Nessuno dei quattro chiede un campo nuovo al protocollo: sono **quattro cambi di `stato`** che il POST porta già. *Supera i tre suoni del 2026-10-28* («due note alte», «tre che scendono», «tre basse»), scritti pensando a un cicalino con l'oscillatore dentro: vedi la voce del 2026-10-29 15:03
- **La pila si vede dove serve e non sempre.** Sul telecomando: **sempre sulla schermata Pronta** — quella che hai davanti quando lo prendi in mano — e **sotto al 20% dappertutto**, in rosso, perché lì non è un dato ma un avviso; non sulle due schermate dello stop, dove in mezzo a una domanda è rumore. Nel SLICER: in alto accanto allo stato della macchina, **solo quando il telecomando ha risposto**
- **La micro SD: libro di bordo e casa del SLICER.** Una riga per stampa in CSV (data mandata dal SLICER, che il telecomando un orologio che sopravviva a una batteria scarica non ce l'ha), scritta **a fine stampa e non a ogni messaggio**. E soprattutto: ci può stare **la pagina del SLICER compressa**, che rimette in gioco l'indirizzo unico perso il 2026-10-25 quando la pagina fu tolta dall'ESP32 per mancanza di spazio — **senza toccare la macchina**, perché servire un file non è comandarla. Scartato: **stampare dalla SD**, che romperebbe la regola, rifarebbe col SAMD21 il guasto del canale lungo del 2026-10-23, e comunque non scioglie il legame col portatile — il programma si **rigenera** dopo i tre popup con le misure di quel giorno, quindi il G-code di ieri non vale oggi

**Criterio di completamento:** una stampa a due colori portata a termine **senza toccare il portatile** dopo l'avvio: il cambio penna annunciato dal cicalino, la procedura chiusa dai tasti, e l'anello che racconta il resto

**Note (cronologia dello step):**
- [2026-10-28] **La grafica prima dell'hardware.** `schermo/mock.html` disegna le dieci schermate **due volte**, grande e a grandezza vera: una grafica che funziona solo nel riquadro grande non funziona. Il vincolo che comanda tutto è **0,1376 mm per pixel** (240 px su 33 mm): una riga a 24 px è alta tre millimetri e tre decimi, e nel tondo ci stanno **un simbolo, un numero e due parole**. Il «1 di 2» è stato **disegnato** invece che scritto, poi tolto del tutto quando sono arrivate le etichette dei tasti, che sullo stesso bordo contano di più.
- [2026-10-28] **Numeri confermati dal datasheet ABX00073** (l'utente ha mandato i PDF: `docs.arduino.cc` non è raggiungibile dalla sessione): display **1,3" 240 × 240**, modulo 36 × 40 mm; **5 tasti qTouch** e **5 LED APA102**; libreria **`Arduino_MKRIoTCarrier` 2.0.0 o successiva**, dichiarata come *requisito*. L'ipotesi prudente da cui si era partiti (33 mm) era quella giusta, quindi la grafica non si è toccata.
- [2026-10-28] **Due regali dal pinout.** **D3 è `DISP_BL`**: la retroilluminazione è comandabile, quindi il vetro **si spegne davvero** invece di diventare nero — e il risparmio di batteria passa da speranza a fatto, con la IMU che serve a risvegliarlo prendendolo in mano. E **tutti i piedini del MKR sono occupati** (tasti su A1÷A5, LED su D4/D5, cicalino su D7, SPI condivisa fra display e SD, I²C per i sensori): **liberi restano solo A0 e A6**, sui Grove analogici.
- [2026-10-28] **Come si legge la carica, in ordine di costo:** `analogRead(ADC_BATTERY)` se la variante del MKR lo definisce — **una riga di sketch risponde**, ed è la prima cosa da provare —; poi il PMIC BQ24195L, che dà di sicuro lo **stato** (in carica, carica, in scarica) ma non ha un misuratore di carica a bordo; in ultimo un partitore sul Grove A0. Dalla tensione la percentuale è un'approssimazione, perché la curva di una Li-ion è piatta in mezzo: niente decimali, e si guarda il colore.
- [2026-10-28] **Il lato SLICER è fatto e collaudato** (`webui/js/telecomando.js`, 37 asserzioni contro un telecomando finto). Il messaggio: `POST /stato` con `{v, stato, nome, percento, rimanente, passo, macchina, azzerata, data}`, risposta `{tasto, batteria}`. Battito a **due velocità**: 400 ms con qualcosa in corso, 2 s a riposo — a riposo non c'è niente da raccontare, ma bisogna comunque accorgersi che qualcuno ha premuto. **Indirizzo vuoto = spento**, che è lo stato normale di chi non ce l'ha.
- [2026-10-28] **Quello che manca:** il firmware (`Arduino_MKRIoTCarrier` + `WiFiNINA`), la corrispondenza **numero ↔ posizione** dei cinque pad (si vede premendoli: le posizioni nel mock sono giuste), e il **colore della penna** nel messaggio — il SLICER lo sa, è la tinta del livello, ma va portato fin dentro al G-code per sapere *quale* penna sta disegnando a metà programma.
- [2026-10-29] **Gli schemi Altium del carrier chiudono i numeri dei pad.** L'utente ha mandato anche gli schematici e il `.PcbDoc` (file OLE con dentro record a `|CHIAVE=valore`: leggibili). Dal rame: ogni pad va al suo piedino con una resistenza da **zero ohm** e **nessun condensatore**, e i poligoni dicono dove sta ciascuno. **TOUCH0** in basso a sinistra (A5), **1** in alto a sinistra (A1), **2 in alto** (A2), **3** in alto a destra (A3), **4** in basso a destra (A4); stanno a **60°** uno dall'altro, non a 72 — cinque posti su sei, il vuoto in basso. I LED seguono i pad senza conversioni: nella catena APA102 il dato entra in DL4 e arriva a DL8, e sul rame DL4+n sta accanto al pad n. *Supera il «si vede premendoli» della nota qui sopra.* Resta un'occhiata alla scheda per destra/sinistra: i pad sono rame sulla faccia del vetro, e guardarla specchia i lati — ma l'insieme delle posizioni è simmetrico, quindi **il 2 resta in alto** comunque. `schermo/leggi-schemi.py` rifà tutti questi numeri dai file, perché una tabella copiata a mano fra un mese non si distingue da una indovinata.
- [2026-10-29] **Il cicalino non è quello che si credeva, e ha cambiato i suoni.** M1 è un **ABT-461-RC**, trasduttore magnetico **a comando esterno**: dentro non ha un oscillatore, quindi non suona perché gli dai tensione — suona finché gli fai commutare il piedino (D7 → Q1, un 2N7002K sul lato basso; il trasduttore sta sul 3V3, R8 fra i due è uno zero ohm). E **non ha volume**: o commuta o non commuta. L'unica cosa che cambia quanto si sente è la **frequenza**, perché ha una **risonanza** intorno ai 4 kHz. I 4 kHz esatti sono **da confermare a orecchio** — lo schema dice il tipo, non la frequenza — e una spazzata da 1 a 6 kHz col firmware la trova in dieci secondi.
- [2026-10-29] **La retroilluminazione è un alimentatore, non un transistor.** Dietro a D3 c'è un convertitore a innalzamento (U3/U6 con l'induttanza L6 da 10 µH, dal 3V3) che tira la fila di LED del pannello. Spegnere **ferma il convertitore**, quindi risparmia corrente vera; un'onda quadra lo **attenua**, quindi «acceso ma piano» esiste e costa meno; e R19 tiene quel piedino **a terra a riposo**, quindi all'accensione il vetro è **nero finché non lo alza il firmware** — da sapere prima di crederlo rotto.
- [2026-10-29] **La batteria non arriva allo zoccolo, confermato dal rame.** La rete `VBAT` tocca solo il contatto del portabatteria (J8) e il connettore del cavetto (J11): **nello zoccolo del MKR non entra**. Nessun ADC la può vedere, quindi resta il partitore sul Grove A0 — non è una svista da aggirare con un piedino nascosto. E il **reset del pannello** è attaccato (R9) alla linea di reset del MKR: il vetro si azzera solo azzerando la scheda.
- [2026-10-29] **I quattro suoni si sentono nel banco di prova**, col pulsante accanto a ognuno, e la prova li fa passare per un **filtro centrato sulla risonanza** invece di pareggiarli: una prova che li pareggia direbbe una bugia comoda, e la bugia si scoprirebbe in officina con un motivetto inudibile dall'altra stanza. C'è l'interruttore per togliere il filtro. Il disegnino accanto a ogni suono ha il tempo in orizzontale, l'altezza in verticale e il **pallore sulla resa**; la pagina sputa la tabella `{hertz, millesimi}` già pronta per lo sketch, così non si ricopia a mano un suono scelto bene.
- [2026-10-29] **Lo spazio utile del vetro è un cerchio, e le parole si posano per lo spigolo.** L'utente ha visto parole che toccavano l'anello e la parola in mezzo al vetro. Causa unica: le etichette si posavano per il **punto di appoggio**, ma su un vetro tondo quello che urta è sempre un **angolo** — quello alto per le etichette di sopra, quello basso per quelle di sotto — quindi mettendo sul raggio giusto il punto d'appoggio l'angolo finiva comunque fuori. Adesso si posano per lo spigolo, dentro un cerchio di **raggio 93** (l'anello comincia a 95,5). Corretti di conseguenza IN PAUSA, FERMARE?, lo spicchio del tocco lungo, la penna alzata sotto FATTO, la pila dell'avviso e la frase che spiega perché manca la stima. Tolto «tieni premuto»: il tasto accanto dice già TIENI, ed era la stessa parola due volte a due centimetri di distanza. Il banco adesso **misura** il rettangolo dell'inchiostro di ogni parola — non quello tipografico, che va dall'ascendente al discendente e segnalerebbe come scontro due righe impilate apposta — su trenta schermate.
- [2026-10-29] **Il firmware è scritto** (`schermo/telecomando/telecomando.ino`, un file solo), **non ancora caricato**. L'API non è ricordata: i sorgenti della libreria arrivano da **GitHub**, che il proxy serve anche se `downloads.arduino.cc` no — quindi la cosa che sembrava richiedere una tornata alla cieca è stata fatta sui nomi veri. Tre cose cambiate dal leggerli: **`carrier.begin()` torna `false` se un sensore qualsiasi non risponde** (al telecomando i sensori non servono: si guarda il valore e si tira dritto); il **preflight del CORS** non è una riga — prima di un POST con corpo JSON il browser manda un `OPTIONS`, e senza risposta il POST non parte nemmeno, cioè il telecomando sembra morto pur essendo acceso; **`ADC_BATTERY` esiste** sul MKR WiFi 1010 (pin 32, PB09), quindi la carica si legge con una riga e il partitore sul Grove non serve. Non potendo compilare per la scheda si è fatto il resto: `g++ -Wall -Wextra` contro intestazioni finte (zero avvisi: non prova che funzioni, prova che non ci sono refusi né nomi sbagliati) e uno script che **legge il sorgente**, ricava le parole di ogni schermata e rifà il conto della geometria col font di Adafruit_GFX. Hanno trovato tre difetti prima del caricamento, di cui uno vero: **lo stop in due tempi collassava in uno**, perché il dito che arma la domanda è ancora sul pad e il secondo tempo cominciava a contare insieme al primo. Restano da tarare sulla scheda: la **risonanza** del cicalino, il **rapporto del partitore** della batteria e **destra/sinistra** dei pad.
- [2026-10-29] **Il protocollo è completo: c'è anche la penna.** `POST /stato` porta ora `{v, stato, nome, percento, rimanente, penna, passo, macchina, azzerata, data}`; `penna` è `{colore, nome}` oppure null, e al cambio penna è **già quella nuova**. Non sta nell'impronta che decide cosa non aspetta il prossimo giro: cambia solo all'inizio di un livello, e il livello che chiede una penna diversa comincia subito dopo una pausa — cioè insieme a un cambio di `stato`, che nell'impronta c'è già e porta con sé anche il colore nuovo.

### Step 10 — Progetti da stampare: i magneti della lavagna d'allenamento

**Stato:** in corso — **avviato 2026-10-29, solo impostazione.** Nessun file prodotto; si aspetta dall'utente la lista degli esercizi e le misure dei magneti.

**Obiettivo:** un set di quadrati magnetici stampati, con scritti in modo bello e permanente i nomi degli esercizi, così che preparare l'allenamento del giorno si riduca ad **attaccare i magneti in ordine** sulla lavagna. Fronte **non legato alla macchina CNC**: è un uso del lavoro grafico a servizio dell'attività dell'utente (atleta di beach volley); è il fronte `(stampe)`, la terza sessione.

**Decisioni progettuali:**
- **Come si usa la lavagna** (dalla foto "Dare to Challenge"): la lavagna ha un blocco di righe, una per esercizio; a sinistra i **magneti grandi**, uno per esercizio, con il colore che dice il tipo; a destra, scritti a pennarello, i parametri. I **magneti piccoli** (etichette bianche) definiscono i parametri e sono quattro: **Intenzione, Fase, Rally, Score**.
- **Il colore è il tipo di esercizio:** **verde = competizione**, **azzurro = ripetizione a obiettivo**, **arancione = costruzione**. Il testo di ogni magnete è il **nome dell'esercizio** (esempi visti: «Forza 4», «3», «7», «Out of 8», «In a row», «7-3»).
- **Il flusso** è lo stesso dei progetti da stampare: **mockup per l'approvazione**, poi **un SVG per ciascun magnete** da mandare in stampa.
- **Dimensioni e lista esercizi non sono ancora note:** arrivano dallo staff dell'utente in un file; fino ad allora niente disegno di dettaglio.

**Criterio di completamento:** l'utente approva il mockup, riceve un SVG per ogni magnete (esercizi + parametri), li stampa e li usa sulla lavagna per un allenamento vero.

**Note (cronologia dello step):**
- [2026-10-29] Step aperto. Visto dalla foto della lavagna lo schema colori/parametri; mancano lista esercizi e misure dei magneti.

## Storico sessioni

### [2026-10-29 15:03] (meccanica/firmware) Gli schemi del carrier chiudono tre domande, i suoni diventano quattro, e il colore della penna entra nel G-code

**Riepilogo:** gli schemi Altium del MKR IoT Carrier, che l'utente aveva mandato con la scheda tecnica, hanno chiuso la corrispondenza **numero ↔ posizione dei pad** senza doverli premere, hanno detto che il cicalino è un **trasduttore a comando esterno** (e quindi i tre suoni disegnati il 28 erano progettati su un oggetto che non esiste) e che dietro a D3 c'è un **alimentatore a innalzamento**; poi i suoni sono diventati **quattro e si ascoltano nel banco di prova**, le parole sul vetro hanno smesso di pestarsi, e il **colore della penna** è entrato dentro al G-code, che era l'ultimo buco del protocollo del telecomando.

**Cosa è stato fatto:**

- **Letti gli schemi Altium del carrier** (`MKR`, `DISPLAY`, `CAPACITIVE_SENSOR`, `BUZZER` e il `.PcbDoc`): sono file OLE con dentro record a `|CHIAVE=valore`, quindi leggibili. Ne è uscita la tabella completa pad → piedino → LED, la catena degli APA102, il circuito del cicalino, quello della retroilluminazione, e due conferme (la batteria non entra nello zoccolo; il reset del pannello è quello della scheda). `schermo/leggi-schemi.py` rifà tutti i numeri dai file: una tabella copiata a mano, fra un mese, non si distingue da una indovinata.
- **I cinque pad hanno un numero, e non si scopre premendoli.** TOUCH0 in basso a sinistra, 1 in alto a sinistra, **2 in alto**, 3 in alto a destra, 4 in basso a destra; a **60°** uno dall'altro, non a 72, con il vuoto in basso. Il mock disegnava 72 e adesso disegna i gradi veri. Il LED n è il LED del pad n, confermato da due strade indipendenti (la catena nello schematico, le posizioni nel rame).
- **I quattro suoni**, con la prova nel banco: partenza, cambio penna, fine, problema. La prova li fa passare per un filtro centrato sulla risonanza del cicalino invece di pareggiarli, e la pagina sputa la tabella `{hertz, millesimi}` già pronta per lo sketch.
- **Rimesse a posto le parole sul vetro**, che in alcune schermate toccavano l'anello o la parola in mezzo (vedi il difetto qui sotto), e tolto «tieni premuto», che ripeteva il tasto accanto.
- **Il colore della penna dentro al programma**, con il pallino nell'elenco dei livelli e la riga in cima al secondo passo del cambio penna (dettagli nella nota di Step 4).
- **Collaudo:** 27 file, **896 asserzioni, 0 KO**. Nuovi: `colore-test.js` (22) e `mock-test.js` (10), che misura le parole sul vetro invece di guardarle.

**Bug: parole sovrapposte sul vetro del telecomando**

**Sintomo:** in alcune schermate del mock le etichette dei tasti toccavano l'anello di avanzamento o la parola grossa al centro — `RIPRENDI` in cima sull'anello, `STOP` addosso a «IN PAUSA», `TIENI` dentro «tieni premuto» e sopra lo spicchio del tocco lungo. Trovato dall'utente guardando la pagina.
**Causa:** le etichette si posavano per il **punto di appoggio** del testo. Su un vetro tondo quello che va a sbattere nell'anello non è mai quel punto: è un **angolo** della parola — l'angolo alto per le etichette di sopra, quello basso per quelle di sotto. Mettendo sul raggio giusto il punto d'appoggio, l'angolo finiva comunque di fuori.
**Fix applicato:** si posano per lo **spigolo esterno**, dentro un cerchio di raggio 93 (l'anello comincia a 95,5). Verificato, e non a occhio: il banco adesso prende il rettangolo dell'**inchiostro** di ogni parola — non quello tipografico, che va dall'ascendente al discendente e segnalerebbe come scontro due righe impilate apposta — e su **trenta schermate** (tre stati dei cursori per dieci schermate) chiede che stia nel cerchio libero e non tocchi nessun'altra parola. Verificato anche che la prova avrebbe preso i difetti di prima.

**Bug: il segno della penna veniva riconosciuto in una riga di commento qualsiasi**

**Sintomo:** nessuno sulla macchina — l'ha preso il collaudo appena scritto: su un programma con due livelli il Sender trovava **tre** segni di penna invece di due.
**Causa:** la prima forma dell'espressione accettava qualunque parola come colore, e l'intestazione dei nostri file contiene già `; penna alzata Z-18.33, abbassata Z-21.27`.
**Fix applicato:** il colore deve essere un colore (`#rgb` o un trattino). Sarebbe stato un cambio penna **di colore «alzata»** a metà programma.

**Decisioni prese:**

- Contesto: i tre suoni disegnati il 28 si distinguevano per l'**altezza**, e lo schema dice che il cicalino è un **ABT-461-RC**, trasduttore magnetico a comando esterno con una risonanza intorno ai 4 kHz: non ha volume, e lontano dalla risonanza è un soffio.
  Decisione: **quattro suoni divisi in due famiglie**. Cambio penna e problema devono passare un muro, quindi stanno su **una nota sola** (la risonanza) e si distinguono per il **ritmo** — due colpi contro uno lungo. Partenza e fine li senti da vicino e sono **motivetti**, tutti dentro l'ottava A7-D8, con la fine che attacca sulla nota più forte.
  *Supera la decisione del 2026-10-28* («tre suoni diversi»): erano scritti pensando a un cicalino con l'oscillatore dentro, dove l'altezza è gratis. Nel mezzo della stessa giornata erano diventati «tre ritmi su una nota sola»; la richiesta dell'utente di avere dei motivetti per partenza e fine ha portato alla divisione in due famiglie, che è migliore di entrambe perché distingue i suoni **secondo a che distanza vanno sentiti**.
  Alternative scartate: tenere le altezze accettando che due suoni su tre non si sentano dall'altra stanza — cioè proprio il caso per cui il cicalino esiste.
  Da rivedere se: la risonanza misurata a orecchio cadesse lontano dai 4 kHz; in quel caso si sposta lì tutta l'ottava, ed è un numero solo (`RISONANZA`).

- Contesto: il colore della penna esisteva solo nella pagina, e la schermata del cambio penna del telecomando è costruita intorno a un pallino che dice *quale* montare.
  Decisione: **il colore viaggia dentro al G-code**, in un commento `;PENNA`, scritto **prima** della pausa.
  Alternative scartate: spedirlo e basta nel messaggio al telecomando — un programma salvato e riaperto un altro giorno sarebbe tornato a «guarda l'elenco dei livelli e conta»; e tenere il colore come campo del livello, che sarebbe un secondo posto dove sta la stessa cosa.
  Da rivedere se: servisse una penna **scelta a mano** per i livelli disegnati nell'editor, che non hanno tinta e oggi restano senza colore.

- Contesto: la corrispondenza numero ↔ posizione dei pad era segnata come «si vede premendoli».
  Decisione: si prende **dagli schemi**, ed è scritta nel README e nel mock.
  Da rivedere se: guardando la scheda i lati risultassero specchiati — nel qual caso si scambia 0 con 4 e 1 con 3, e il 2 resta in alto comunque.

**Problemi aperti:**

- **Il firmware non è compilabile da dentro la sessione**: `downloads.arduino.cc` è bloccato dal proxy come lo era `docs.arduino.cc`, quindi niente `arduino-cli`, niente core SAMD, niente `Arduino_MKRIoTCarrier`. Si scriverà alla cieca e servirà **una tornata di compilazione sulla macchina dell'utente**: gli errori probabili non sono nel codice ma nei nomi delle funzioni della libreria, che da qui non si verificano.
- **I 4 kHz della risonanza** sono da confermare a orecchio con una spazzata da 1 a 6 kHz.
- **Destra e sinistra dei pad**, un'occhiata alla scheda.

**File consegnati/modificati:** `schermo/README.md`, `schermo/mock.html`, `schermo/leggi-schemi.py` (nuovo), `webui/js/gcode.js`, `webui/js/sender.js`, `webui/js/artwork.js`, `webui/js/popup.js`, `webui/js/telecomando.js`, `webui/js/svgimport.js`, `webui/css/components.css`. Commit `7464b5b`, `c079843`, `1f70f92`.

**Impatto su Vision/Pipeline:** Vision invariata. Pipeline: **Step 9** — stato aggiornato (manca solo il firmware), riscritta la decisione sui suoni, aggiunte sei note; **Step 4** — una nota sul colore della penna.

---

### [2026-10-29 14:40] (stampe) Si apre il terzo fronte: i magneti della lavagna d'allenamento

**Riepilogo:** nasce la terza conversazione del progetto, dedicata ai **progetti da stampare**: il primo sono i **magneti colorati con i nomi degli esercizi** che lo staff dell'utente usa ogni giorno per comporre il programma d'allenamento sulla lavagna; per ora solo impostazione, letto il documento e scritto il messaggio per le altre due sessioni.

**Cosa è stato fatto:**
- Letto il documento (v59) e lo stato dei branch: la sessione `(stampe)` lavora sul branch `claude/quirky-bohr-u9ktwd`; esiste un altro branch di sessione, `claude/elegant-knuth-0396no`, con modifiche al telecomando (`schermo/`) non ancora nel documento.
- Analizzata la foto della lavagna «Dare to Challenge»: colori dei magneti = tipo di esercizio, magneti piccoli = parametri (Intenzione, Fase, Rally, Score).
- Aggiornate le regole di co-editing (tre sessioni invece di due) e aperto lo **Step 10**.
- Scritto, per l'utente, il messaggio da incollare nelle altre due conversazioni.

**Decisioni prese:**
- Contesto: il fronte non c'entra con la macchina né con i contenuti social, e un terzo scrittore sul documento aumenta i punti di contesa.
- Decisione: terzo fronte con etichetta `(stampe)` e Step 10 suo; stessi accorgimenti di co-editing (fetch/rebase prima di scrivere, voci per fronte, Versione = max + 1).
- Alternative scartate: mettere i magneti sotto lo Step 7 (logo/identità) — è un lavoro con file, flusso e criterio propri.
- Da rivedere se: i disegni dei magneti riusassero stabilmente il logo o la grafica del SLICER, e allora i due fronti andrebbero coordinati.

**File consegnati/modificati:** `documento-sessione-cnc-2d.md` (v60: regole di co-editing, Step 10, questa voce).

**Impatto su Vision/Pipeline:** Vision invariata. Pipeline: aggiunto Step 10; regole di co-editing aggiornate a tre sessioni.

---

### [2026-10-29 07:45] (software+hardware) Quattro difetti trovati stampando sul serio, il lavoro che si salva, e la macchina che prende un telecomando

**Riepilogo:** la prima stampa a due colori vera è riuscita e ha tirato fuori quattro difetti che nessuna prova aveva trovato — i pulsanti degli angoli spenti per sempre, le frecce che potevano far uscire il pignone dalla cremagliera, gli spigoli ripassati due volte dalla penna e il popup del cambio penna che non si apriva da sé; poi l'editor ha imparato a **spostare un tratto da un livello all'altro senza muoverlo sul foglio** e il lavoro a metà si **salva in un SVG**; infine si è aperto un fronte nuovo, il **telecomando**, di cui è già costruita e collaudata la metà che gira nel browser.

**Cosa è stato fatto:**

- **I quattro pulsanti del tastierino rifatti come punti limite della corsa**, rientrati di un millimetro, con i numeri che portano il nome dell'asse. Le frecce si fermano allo stesso bordo di rispetto, confrontando l'arrivo con la **partenza** e non in assoluto.
- **I tratti doppi non arrivano più alla penna**, tolti sul foglio a 0,05 mm, per livello, a ogni ricalcolo. Il registro lo dice all'importazione **e** quando il programma è pronto, che è il momento in cui lo si guarda.
- **Il popup del cambio penna si apre da sé** quando il livello è finito, e il primo passo aspetta che la testina sia ferma al punto home prima di lasciar togliere la penna.
- **`webui/js/progetto.js`**: il lavoro si salva in un SVG con il disegno vero più lo stato in `<metadata>`, e si riapre dov'era. Pulsante «Salva» accanto al titolo della scheda Disegno, dove l'utente l'aveva chiesto.
- **Taglia, copia e incolla fra livelli** nell'editor, con la conversione di coordinate scritta come una matrice sola. Lo strumento che divide un tratto si chiama adesso **Spezza**.
- **Il telecomando**: `schermo/README.md` e il banco di prova `schermo/mock.html` con dieci schermate disegnate due volte (grande e a grandezza vera), e **`webui/js/telecomando.js`**, la metà che gira nel browser, collaudata contro un telecomando finto.
- **Collaudo**: da 22 a **25 file**, da 756 a **864 asserzioni**, zero KO. Tre file nuovi — `limiti-test.js` (punti limite, frecce, tratti doppi, salvataggio), `appunti-test.js` (taglia/incolla fra livelli), `tele-test.js` (il dialogo col telecomando).

**Bug: i pulsanti degli angoli del foglio non si potevano premere**

**Sintomo:** col foglio vero dell'utente — 270 × 255 appoggiato a X −14 Y −9, cioè più grande della campata — tutti e quattro i pulsanti degli angoli erano **spenti, sempre**.
**Causa:** i numeri erano giusti; era sbagliata la cosa a cui puntavano. Gli spigoli della **carta** stanno fuori corsa per costruzione con un foglio così, e un pulsante che punta a un posto irraggiungibile può solo restare spento.
**Fix applicato:** puntano ai **punti limite della corsa**, rientrati di un millimetro. Non dipendono più dal foglio in nessun modo: spostare la carta non li muove, e a muoverli è il margine di sicurezza del profilo. Verificato col collaudo, che adesso controlla proprio il contrario di prima — che spostare il foglio **non** cambi niente.

**Bug: una freccia del tastierino poteva far uscire il pignone dalla cremagliera**

**Sintomo:** segnalato dall'utente — cliccando una freccia con un passo grande vicino al fine corsa, la testina ci va e l'ingranaggio esce dalla cremagliera.
**Causa:** il controllo dell'area esisteva su «Vai al punto» e sui quattro pulsanti — cioè dove si **scrive** una coordinata — e mancava proprio dove al confine ci si arriva **un click alla volta**.
**Fix applicato:** ogni freccia conta dove finirebbe col passo attivo e si spegne se esce, dicendo di quanto; il conto si rifà a ogni cambio di passo. Il confronto è con la partenza, così un carrello già fuori può rientrare. A macchina **non azzerata** le frecce restano accese — senza origine quelle coordinate non vogliono dire niente, e spegnerle lì toglierebbe l'unico modo di fare l'azzeramento.

**Bug: la penna ripassava due volte sugli spigoli in comune**

**Sintomo:** nella stampa a due colori riuscita, su certe linee la penna è passata **due volte**. Visto sulla carta, non nel programma.
**Causa:** due facce adiacenti hanno lo spigolo in comune, e nel file ogni faccia è un contorno chiuso: quel lato sta dentro tutte e due.
**Fix applicato:** i segmenti doppi si scartano, sul foglio e in millimetri, con tolleranza 0,05 mm e **per livello** — lo stesso segmento in due livelli resta disegnato due volte, perché sono due penne. Verificato col collaudo: due quadrati attaccati danno sette movimenti a penna giù invece di otto.

**Bug: il popup del cambio penna non si apriva da solo**

**Sintomo:** alla prima stampa a due colori vera l'utente ha dovuto premere **Riprendi** per far comparire la procedura, «con la paura che la stampa riprendesse saltando la procedura».
**Causa:** scelta mia del 2026-10-26, non un difetto di codice: il popup era l'ingresso del pulsante Riprendi e basta.
**Fix applicato:** si apre da sé appena la stampa arriva al segno; «Più tardi» resta più tardi e Riprendi lo riapre. Un pulsante che per essere premuto ha bisogno di sapere che **non fa quello che c'è scritto** è un pulsante scritto male.

**Bug: il tratto incollato in un altro livello rientrava della lunghezza sbagliata**

**Sintomo:** tagliando il tratto orizzontale di una L e incollandolo in un altro livello, rientrava **lungo 50 mm invece di 136**.
**Causa:** gli appunti si portavano dietro l'**id** del livello di partenza invece della sua mappa. Dopo il taglio al livello restava una riga **verticale** — ingombro largo zero — e lì il rapporto non esiste: `toRect` ripiega su «un'unità vale un millimetro», quindi la mappa non era più quella con cui le forme erano state lette.
**Fix applicato:** gli appunti portano la **matrice**, non chi gliel'ha data. Trovato dal collaudo, che confronta i millimetri sul foglio invece di contare i tracciati — contando i tracciati non si sarebbe visto niente.

**Bug: il SLICER mandava al telecomando cento messaggi in più per stampa**

**Sintomo:** il collaudo contava **otto chiamate in 1,2 s** invece di tre.
**Causa:** avevo messo la **percentuale** fra le cose che non aspettano il prossimo giro. La percentuale cambia cento volte per stampa.
**Fix applicato:** nell'impronta delle cose urgenti restano solo quelle che cambiano la **faccia** del telecomando — stato, passo del cambio penna, macchina, azzeramento. La percentuale la racconta il battito due decimi dopo. Su una scheda con 32 kB di memoria non era un dettaglio.

**Decisioni prese:**

- **Contesto:** col foglio più grande della campata i quattro pulsanti degli angoli erano inutilizzabili, e l'utente ha chiarito a cosa gli servivano. **Decisione:** sono i **punti limite della corsa**, non gli angoli del foglio, e ci si ferma un millimetro prima del fine corsa. *Supera la decisione del 2026-10-26* («i quattro angoli del foglio e il punto home sul tastierino»). **Alternative scartate:** puntare all'angolo della **parte di foglio raggiungibile** — era stato implementato e poi buttato: risolveva il sintomo ma rispondeva a una domanda diversa da quella che l'utente si fa premendoli. **Da rivedere se:** si montassero i finecorsa, nel qual caso il bordo di rispetto a mano potrebbe diventare superfluo.
- **Contesto:** il millimetro di rispetto poteva valere anche per la stampa. **Decisione:** vale **solo per il movimento a mano** di quel pannello; la stampa ha il suo margine di sicurezza nel profilo macchina. **Alternative scartate:** sommarli — vorrebbe dire togliere due volte lo stesso millimetro a un'area che è già stretta.
- **Contesto:** i tratti doppi si potevano segnalare invece che togliere. **Decisione:** si tolgono in automatico, e lo si dice due volte nel registro. **Alternative scartate:** lasciarli e mostrarli nell'editor — l'utente aveva già provato a toglierli a mano e «non li ho visti tutti». **Da rivedere se:** servisse ripassare una linea apposta per marcarla: oggi non si può.
- **Contesto:** salvare il lavoro a metà. **Decisione:** un **SVG** con il disegno come tracciati veri e lo stato in `<metadata>`. **Alternative scartate:** un formato nostro — un file che si apre anche altrove non è un ostaggio: se un giorno questa pagina non ci fosse più, il disegno resta un disegno.
- **Contesto:** l'utente ha proposto uno schermo tondo per la macchina, e nel giro di poche ore l'ipotesi hardware è cambiata. **Decisione:** **MKR IoT Carrier Rev2 + MKR WiFi 1010**, che aveva già in casa. **Alternative scartate:** il pannello **GC9A01** pilotato dal secondo ESP32 — funzionava e costava zero, ma niente tasti, niente batteria, cinque fili SPI dal box al coperchio accanto ai cavi dei motori, e un firmware da scrivere da capo. E scartato per primo mettere il display **sull'ESP32 montato**, che vorrebbe dire forkare FluidNC: i dati lì dentro non ci sono comunque.
- **Contesto:** da dove prende i dati il telecomando. **Decisione:** è un **secondo client del SLICER**, con un canale solo in due versi (`POST` dello stato, risposta col tasto premuto). **Alternative scartate:** leggerli da FluidNC come secondo client — dà posizione e `Run/Idle/Hold`, cioè la metà facile e non quella che serve. **Conseguenza voluta:** il telecomando non conosce nemmeno l'indirizzo della macchina, quindi «non comanda FluidNC» non è disciplina ma struttura.
- **Contesto:** l'utente ha chiesto se la micro SD del carrier servisse come memoria. **Decisione:** sì, per il **libro di bordo** delle stampe e soprattutto per ospitare **la pagina del SLICER compressa**, che rimette in gioco l'indirizzo unico perso il 2026-10-25 — senza toccare la macchina, perché **servire un file non è comandarla**. **Alternative scartate:** **stampare dalla SD** — romperebbe la regola, rifarebbe col SAMD21 il guasto del canale lungo del 2026-10-23, e comunque non scioglie il legame col portatile, perché il programma si rigenera dopo i tre popup con le misure di quel giorno. **Da rivedere se:** la SD diventasse l'unica strada per aprire la pagina — non deve, perché il telecomando è a batteria e dorme.

**Fronti rimandati dall'utente in questa sessione:** la rimozione automatica delle **linee nascoste** (non si fa: era un problema dei cubi prospettici, e la fusione dei tratti doppi copre il caso vero); il **logo**, che l'utente disegna da sé e manderà in SVG — le tre varianti proposte sono state giudicate sbagliate; la misura del **gioco**, rimandata finché non è stampato un `pz2` nuovo del modulo penna con i cuscinetti più stretti; i **cavi** e il **box**, che l'utente progetta da sé dopo prove di stampa dei portacavi snodati.

**Sul circuito, su richiesta dell'utente prima di passare dalla breadboard alla millefori:** la breadboard è la cosa da cambiare e va fatta **prima del box**, perché il box si disegna attorno all'ingombro della scheda. Il motivo non è l'ordine: su questa macchina **un passo perso è silenzioso e permanente** — niente finecorsa, niente retroazione, origine da `G92` — quindi il percorso critico non deve stare su contatti a pressione. In ordine: basetta millefori con zoccoli (senza toccare la mappa dei pin, verificata per settimane), connettori sul bordo per i tre cavi che escono, **servo su un'alimentazione sua** con massa in comune, condensatore sui driver da verificare, interruttore e fusibile. Due cose specifiche del coperchio trasparente: `idle_ms: 255` vuol dire **driver sempre alimentati**, quindi feritoia o coperchio non sigillato; e i trimmer dei driver devono restare raggiungibili. Una decisione da prendere **adesso**: se i finecorsa si metteranno mai, sono due fili in più per asse, e la catena la si sta dimensionando ora per sette.

**File consegnati/modificati:**
- `webui/js/panel.js` — punti limite della corsa, bordo di rispetto di 1 mm, nome dell'asse nei rettangolini
- `webui/js/svgimport.js` — `senzaDoppioni()`; `webui/js/artwork.js` — scarto dei doppi a ogni refit, `incolla()` e la matrice del livello, salvataggio/ripresa del progetto
- `webui/js/progetto.js` **(nuovo)** — salvataggio del lavoro in SVG con `<metadata>`
- `webui/js/editor.js` — appunti, taglia/copia/incolla, `Spezza`; `webui/js/popup.js` — apertura automatica del cambio penna, `provaPenna`, ingressi dal telecomando; `webui/js/sender.js` — messaggio del cambio penna
- `webui/js/telecomando.js` **(nuovo)** — il lato SLICER del dialogo; `webui/js/app.js`, `settings.js`, `state.js`, `index.html`, `css/components.css` — pila in alto, indirizzo nelle impostazioni
- `schermo/README.md` e `schermo/mock.html` **(nuovi)** — progetto e banco di prova del telecomando
- Collaudo (nello scratchpad): `limiti-test.js`, `appunti-test.js`, `tele-test.js` nuovi; `piu-test.js`, `penna-test.js`, `pausa-test.js` aggiornati al comportamento nuovo
- Consegnati all'utente: `dist/cnc2d-ui.html` v71, v72, v73, **v74**; `schermo/mock.html` a ogni revisione della grafica

**Impatto su Vision/Pipeline:** nasce lo **Step 9 — Il telecomando della macchina**, in corso e già a metà. È il primo step che non riguarda né il moto, né il disegno, né la macchina come oggetto: riguarda **come si sta vicino alla macchina mentre lavora**. Lo Step 4 cambia stato per i tratti doppi, il salvataggio del progetto, i punti limite e gli appunti fra livelli.

---

### [2026-10-27 21:05] (software+meccanica) Il cambio penna perde l'aritmetica, l'editor impara a prendere un tratto solo, e si aprono il logo e i cavi

**Riepilogo:** il cambio penna è stato riscritto sulla procedura che l'utente aveva in mente — e nel farlo venticinque righe che spostavano le Z sono state **cancellate**, perché montando la penna alla quota del programma non c'è niente da correggere; poi l'editor è stato rifatto per il lavoro vero (il singolo tratto, i livelli, Ctrl) con quattro difetti trovati dall'utente mentre ripuliva a mano un disegno isometrico; infine sono nati due fronti nuovi, il **logo** della macchina derivato dall'alfabeto di GDC Stuff e il **progetto dei cavi, del box e degli alloggiamenti**.

**Cosa è stato fatto:**

- **Il cambio penna, due volte.** La prima versione (mattina) faceva la cosa «giusta»: rimisurava la quota di contatto della penna nuova e spostava tutte le Z rimaste nel programma. L'utente ha dettato la sua procedura in sei passi — tappo, home, «togli la penna», servo a contatto, «monta la penna nuova» con i due pulsanti di prova, «riprendi» — e quella procedura **rende il conto inutile**: la penna si monta *alla quota che il programma usa già*. Venticinque righe via. Il numero che chiude la questione: la banda morta del servo, 0,9°, vale **0,29 mm** alla punta, mentre fra due fogli di spessore diverso c'è un decimo — si stava correggendo qualcosa di più piccolo di quello che la macchina sa fare.
- **L'editor per il lavoro vero.** «Scegli» prende il **tratto fra due nodi** e non la polilinea; **Ctrl** somma i tratti e un Canc li toglie tutti; l'editor ha **i suoi livelli** con l'occhio, e l'annulla è per livello. Tutto chiesto dall'utente **mentre** ripuliva a mano le facce dell'isometrico, non in astratto.
- **Quattro difetti trovati sullo stesso lavoro** (vedi i blocchi qui sotto): il nodo che finiva sulla linea sotto, il segmento da un pelo, Ctrl che valeva un doppio clic, l'occhio che non spegneva il livello attivo.
- **Il numero di versione accanto al titolo**, contato dai commit che toccano `webui/` invece di essere scritto a mano. Oggi è la **70**.
- **Il logo:** misurato `gdc master.svg` sui percorsi veri, scaricato **Jost Bold** e letti i contorni di C, N, D e 2 dal TTF, scritto un generatore e consegnate tre varianti (riga, monogramma, chiusura) con il provino a 34 e 16 px.
- **La macchina:** `misure/cavi-box-e-alloggiamenti.md`, con le due strisce libere a sinistra, la catena dimensionata e la proposta — catena sull'asse Y, cavo piatto sopra la trave per l'asse X.
- **Collaudo:** 22 file di prova, **756 asserzioni, tutte verdi**, incluse quelle nuove sul cambio penna (`penna-test`), sulla selezione del singolo tratto (`segm-test`) e sul file unico compilato (`dist-test`).

**Bug: il nodo nuovo cade sulla linea sbagliata**

**Sintomo:** su un disegno denso, aggiungendo un nodo a una spezzata selezionata, il nodo compariva **su un'altra linea** — quella che passava sotto al punto cliccato.
**Causa:** la ricerca prendeva ogni volta il tratto più vicino al cursore, e dove due linee si incrociano quale sia il più vicino cambia a ogni pixel.
**Fix applicato:** selezione **appiccicosa** — se il clic cade ancora entro il raggio di presa del tratto già scelto, resta quello; e il nodo si inserisce **nel tratto scelto**, non in quello sotto il cursore. Verificato in `segm-test`.

**Bug: il nodo troppo vicino a un capo crea un segmento invisibile**

**Sintomo:** «alcune volte funzionava liscio, altre volte il punto dove cliccavo attirava a se uno dei lati adiacenti creando un piccolissimo segmento in più».
**Causa:** l'inserimento non aveva alcuna distanza minima dai due capi del tratto.
**Fix applicato:** entro **quattro pixel** da un capo l'inserimento viene rifiutato. Verificato.

**Bug: due Ctrl+clic valgono un doppio clic**

**Sintomo:** sommando tratti con Ctrl, al secondo clic saltava fuori un nodo nuovo e la selezione si azzerava.
**Causa:** il riconoscimento del doppio clic non guardava i modificatori. **È la stessa trappola chiusa il 2026-10-25 per Shift**, riaperta dal tasto appena aggiunto.
**Fix applicato:** un clic con Shift, Ctrl o Cmd non conta mai come metà di un doppio clic. Verificato per entrambi i tasti.

**Bug: l'occhio non spegne il livello su cui si lavora**

**Sintomo:** «se sono su un livello selezionato e clicco l'occhio non si oscura — se li oscuro tutti e cambio livello comunque vedo quello in cui sono».
**Causa:** era una **mia scelta**, non un difetto di codice: tenevo visibile il livello attivo perché lavorarci sopra senza vederlo mi pareva assurdo.
**Fix applicato:** l'occhio spegne anche il livello attivo, e un livello spento non si può selezionare. Il controesempio dell'utente è più forte del mio ragionamento: se spegnere tutto non spegne niente, l'occhio non è un interruttore.

**Decisioni prese:**

- **Contesto:** il cambio penna a metà stampa sembrava richiedere di rimisurare la quota di contatto della penna nuova e di correggere le Z successive.
  **Decisione:** nessuna correzione. La penna nuova si monta **alla quota di contatto che il programma sta già usando**, come al primo montaggio: è la penna che si adatta al programma.
  **Alternative scartate:** rimisurare e traslare le Z rimaste (scritta, funzionante, **rimossa**): aggiunge uno stato da ricordare a metà programma per correggere meno di un terzo di millimetro, sotto la granularità del servo.
  **Da rivedere se:** si monteranno utensili di lunghezza non regolabile nei morsetti (una lama, un modulo rigido), dove la quota non è scegliibile a mano.

- **Contesto:** l'editor selezionava la polilinea intera, e per cancellare un lato di un cubo bisognava spezzarla a mano con due nodi.
  **Decisione:** l'unità di selezione è il **tratto fra due nodi**; Ctrl ne somma più di uno.
  **Alternative scartate:** un comando «separa in segmenti» da dare al livello (segnato il 2026-10-26 come forse inutile): separare non costa alzate di penna perché l'ottimizzatore ricuce, **ma non toglie i doppioni** — e comunque non serviva separare, serviva poter scegliere.
  **Da rivedere se:** servirà cancellare centinaia di tratti alla volta, dove un rettangolo di selezione sui tratti sarebbe più veloce dei clic.

- **Contesto:** «quante versioni abbiamo cambiato della webapp in tutto?»
  **Decisione:** il numero si **conta** dal registro dei commit a ogni compilazione, e si mostra accanto al titolo.
  **Alternative scartate:** un numero scritto a mano nel sorgente — prima o poi non viene aggiornato, e allora dice una cosa falsa invece di non dire niente.

- **Contesto:** fare il logo della macchina partendo dal logo GDC Stuff.
  **Decisione:** non si continua l'alfabeto (non esiste: la G ha l'asta a 0,257 dell'altezza maiuscola, la C a 0,181), si continuano i **tre modi di interrompere la forma** — C spezzata, D piena, D più bassa — sopra i contorni veri di Jost Bold.
  **Alternative scartate:** ridisegnare le lettere a mano imitando la G e la C (tre campioni incoerenti non danno una regola); usare il font così com'è (non sarebbe un logo derivato, sarebbe una scritta).
  **Da rivedere se:** l'utente conferma una lettura dello schizzo diversa dalla variante B, che è una mia interpretazione.

- **Contesto:** i cavi strisciano sul piano e a sinistra c'è spazio libero.
  **Decisione:** **catena stampata sull'asse Y, cavo piatto sopra la trave per l'asse X**, box nella striscia da 140,04 mm ad altezza libera, alloggiamenti divisi in due oggetti (vano basso + rastrelliera alta).
  **Alternative scartate:** catena su entrambi gli assi (17 maglie sul carrello X sono massa nel posto peggiore, con 70,47 mm di sbalzo che la moltiplicano sull'imbardata); un contenitore unico a sinistra (A5 in piano entra per mezzo millimetro, le penne in piedi non ci stanno sotto 104 mm).
  **Da rivedere se:** i diametri veri dei cavi o l'ingombro della scheda, che l'utente deve ancora misurare, non stanno nei numeri assunti.

**File consegnati/modificati:**

- `webui/js/sender.js`, `webui/js/popup.js`, `webui/js/jog.js` — il cambio penna a due popup; **rimossa** la correzione di Z
- `webui/js/editor.js`, `webui/js/artwork.js`, `webui/css/components.css`, `webui/index.html` — selezione del singolo tratto, Ctrl, livelli nell'editor, i quattro fix
- `webui/tools/versione.py` (nuovo), `webui/js/versione.js` (generato), `webui/tools/build.py`, `webui/index.html` — il numero di versione
- `webui/dist/cnc2d-ui.html` — il file unico rigenerato (539.766 byte, versione 70)
- `logo/cnc2d.js`, `logo/jost-glifi.json`, `logo/README.md`, `logo/cnc2d-a-riga.svg`, `logo/cnc2d-b-monogramma.svg`, `logo/cnc2d-c-chiusura.svg` (nuovi)
- `misure/cavi-box-e-alloggiamenti.md` (nuovo)
- Consegnati all'utente: `logo-varianti.png` (il provino a tre dimensioni) e i due documenti sopra

**Impatto su Vision/Pipeline:**

- **Step 4** aggiornato nello stato (editor a livello di tratto, cambio penna, numero di versione) con cinque note nuove.
- **Step 6**: una nota sul fatto che il cambio colore **non è un cambio di taratura**.
- **Due step nuovi**, aperti dall'utente: **Step 7 — Logo e identità visiva della macchina** e **Step 8 — Miglioramenti della macchina: cavi, box elettronica, alloggiamenti**. Sono i primi due step che non riguardano né il moto né il disegno: la macchina funziona, e si comincia a finirla.

---

### [2026-10-26 11:34] (software) L'importatore smette di buttare via geometria, l'elenco dei livelli diventa comandabile, e il tastierino si chiude a quadrati concentrici

**Riepilogo:** un SVG isometrico ha smontato la regola con cui l'importatore distingueva disegno e decorazione — diciannove facce di cubo sparivano perché erano poligoni pieni senza contorno — e da lì è nato **un livello per tinta**; nello stesso giro l'elenco dei livelli è diventato comandabile (occhio, presa per trascinare, penna sulla riga, selezione multipla, etichetta «edit»), il riquadro di selezione ha imparato a lavorare su più livelli e a ruotare senza buttare via niente, e il tastierino è stato rifatto due volte fino a chiudersi su quadrati concentrici.

**Cosa è stato fatto:**

- **I quattro punti notevoli sul tastierino, poi diventati cinque.** Pulsanti che portano la penna al punto home e agli angoli del foglio, con la penna che **si alza prima di partire** (un traverso da duecento millimetri con la punta appoggiata lascia una riga dritta in mezzo al disegno) e con il punto fuori corsa che spegne il suo pulsante dicendo di quanto. Alla prima consegna gli angoli erano tre: l'utente ha fatto notare che gli altri vanno a un **punto limite** e il punto home non lo è, quindi il quarto angolo c'è e home è un'altra cosa, in un altro posto.
- **Editor: le tre cose che mancavano**, segnate il 2026-10-25. Selezione multipla con rettangolo e Shift+clic, spostamento e Canc su tutto il gruppo; **griglia in millimetri del foglio** e non in unità del file; strumento **Curva** che piega un tratto senza passare dal nodo. Aggiunto dopo, per il caso dei cubi: **Togli tratto**, che leva il solo tratto cliccato.
- **Un livello per tinta all'importazione**, e le tinte piene che nascono spente (vedi Decisioni).
- **L'elenco dei livelli rifatto**: occhio e occhio sbarrato al posto dei due pallini, tre lineette da trascinare al posto delle due freccette — con l'ordine che cambia **davvero** mentre si trascina —, cambio penna cliccabile dalla riga, spunta di selezione che commuta (e quindi si può arrivare a **non aver scelto niente**, cosa che prima non si poteva), doppio clic sulla riga che apre il riquadro sul foglio, etichetta **edit** sui livelli toccati nell'editor.
- **Il riquadro di selezione su più livelli**: unione dei rettangoli, modifiche distribuite in proporzione, più **quattro maniglie di rotazione** agli angoli.
- **Il file unico rigenerato** con dentro il disegno di esempio, e `build.py --leggero` per chi dovesse rimettere la pagina sulla scheda.
- **Il tastierino a quadrati concentrici** (vedi Decisioni).
- **Prove da 604 a 712**, con tre collaudi nuovi: `piu-test.js` (62), `elenco-test.js` (32), `dist-test.js` (10, sul file unico invece che sui sorgenti).

**Bug: l'importatore perdeva le facce dei cubi**

**Sintomo:** caricando `iso-cross-2026-10-24-raw.svg` i cubi vengono disegnati senza due spigoli per uno. L'utente ricorda che una versione vecchia del programma le linee le metteva tutte, ma senza tridimensionalità.
**Causa:** contati gli elementi del file, sono 95 in tre tinte — 38 `path` col bordo (facce in alto e di destra), 38 `polygon` pieni `#1a1a1a` (le stesse facce, riempite per nascondere quello che sta dietro) e **19 `polygon` pieni `#ccc` che sono le facce di sinistra e non hanno nessun contorno**. La regola introdotta il 2026-10-25 — «se nel file c'è almeno una forma col bordo, le forme senza bordo sono decorazione» — buttava via tutti e 57 i poligoni, e con loro l'unica geometria che non era duplicata.
**Fix applicato:** si butta via solo lo sfondo (la forma senza bordo che copre tutta la tela); il resto entra diviso per tinta. Verificato che sui file già in repo tratti disegnati e ingombro restano **identici al centesimo**.

**Bug: due Shift+clic di fila passavano per un doppio clic**

**Sintomo:** nell'editor, cliccando due volte con Shift sullo stesso tratto per aggiungerlo e poi toglierlo dalla selezione, il gruppo si azzerava e compariva un nodo in più.
**Causa:** i due clic cadevano dentro i 350 ms del doppio clic, e il doppio clic su un tratto infila un nodo lì e sceglie quella forma sola.
**Fix applicato:** con Shift premuto il doppio clic non si conta. Trovato dal collaudo.

**Bug: la scala in millimetri della griglia valeva un'unità**

**Sintomo:** la griglia dell'editor, chiesta in millimetri del foglio, agganciava a passi sbagliati.
**Causa:** `Artwork.scalaMm` divide il rettangolo sul foglio per l'ingombro nel file, e su un disegno fatto di **un tratto orizzontale solo** — cioè il primo tratto che si traccia su una tela vuota — l'ingombro è alto zero e il rapporto esce 0 o NaN.
**Fix applicato:** in quel caso dice che una scala non c'è, e chi chiama ripiega su un'unità = un millimetro. Trovato dal collaudo.

**Bug: una colonna del tastierino si gonfiava a 110 px**

**Sintomo:** nel primo montaggio a caselle quadrate i pulsanti del centro si sovrapponevano, schiacciati a 13 px, mentre le colonne delle frecce laterali ne occupavano 110.
**Causa:** `1fr` vuol dire `minmax(auto, 1fr)`, e il minimo automatico di una traccia è il min-content di quello che ci sta dentro: un pulsante quadrato alto due righe trasferisce l'altezza in larghezza e detta il minimo della colonna.
**Fix applicato:** `minmax(0, 1fr)` su righe e colonne. Trovato **misurando le tracce**, non leggendo il codice.

**Bug: ruotare buttava via la collocazione**

**Sintomo:** segnalato dall'utente — si colloca il disegno a mano col riquadro, si tocca Rotazione, e il lavoro sparisce: il disegno riparte centrato e grande come all'apertura.
**Causa:** `ruotaDalCampo` azzerava `box` e `ritaglio`. Era scritto come una scelta («un rettangolo pensato per l'altro verso schiaccerebbe il disegno»), ma la conseguenza vera era: ruota e ricomincia.
**Fix applicato:** restano fermi **centro e scala**; a un quarto di giro i due fattori di scala si scambiano, così la deformazione viaggia col disegno; il ritaglio gira insieme, detto in frazioni del rettangolo. Verificato che quattro quarti di giro riportano tutto identico.

**Decisioni prese:**

- **Contesto:** la regola «il bordo distingue il disegno dalla decorazione» risolveva il caso vero dei riferimenti colorati nei nostri SVG (il pallino rosso del punto home) e sbagliava su qualsiasi file misto.
  **Decisione:** **un livello per tinta.** Ogni bordo di un colore e ogni riempimento di un colore diventa un livello suo, con occhio, cestino, posto nell'ordine e cambio penna. Le tinte **piene** di un file che ha anche dei bordi **nascono spente**, quindi si stampa quello che si stampava prima; in un file senza nemmeno un bordo le forme piene sono il disegno e restano accese. I livelli nati da uno stesso file si adattano **insieme**: il rettangolo si calcola sul disegno intero e si ritaglia per ciascuno.
  **Alternative scartate:** (a) tenere la regola e accettare la perdita — era già stata accettata il 25 ottobre «perché si vede subito nell'anteprima», e si è visto che non si vede; (b) riconoscere i doppioni e tenere solo le forme piene che non ricalcano un bordo — elegante su questo file, ma avrebbe fatto tornare a stampare i riferimenti colorati, cioè il bug segnalato dall'utente il 25; (c) una spunta «disegna anche le forme piene» per livello — un'opzione in più al posto di una struttura che c'era già.
  **Supera la decisione del:** [2026-10-25] — la regola del bordo resta come **default** (le tinte piene nascono spente) ma non è più un filtro distruttivo.
  **Da rivedere se:** un file con molte tinte di bordo produce un elenco illeggibile. Oggi il collaudo lo fa: `collaudo.svg` ne genera quattro.
- **Contesto:** l'utente ha chiesto perché gli angoli del foglio fossero tre e il punto home stesse con loro.
  **Decisione:** gli angoli del foglio sono **quattro**, perché tutti e quattro sono **punti limite**; il punto home non lo è — è dove i carrelli si parcheggiano — e sta in un altro posto, con un altro segno.
  **Alternative scartate:** tenerne tre perché il quarto è la battuta contro cui si spinge il foglio. Era il mio ragionamento, ed era un ragionamento sul *gesto di posare il foglio*, non su *che cos'è quel pulsante*.
- **Contesto:** il tastierino con i quattro angoli dentro al blocco di mezzo veniva 5 colonne × 6 righe, e l'utente ha chiesto proporzioni a quadrati concentrici disegnandole sopra a uno screenshot.
  **Decisione:** **5 × 5 di caselle quadrate con un 3 × 3 al centro**, stesso passo e stesso vuoto, concentrici per costruzione. I **quattro angoli del foglio vanno sul giro**, nelle caselle di mezzo delle fasce laterali, ognuno dalla parte sua: quello dell'angolo in alto a destra sta in alto a destra. Misurato: pad 300 × 300, centro 171 × 171, celle 53,59.
  **Alternative scartate:** (a) tenere il 3 × 4 al centro e accettare celle 4:3 — avrebbe disfatto i pulsanti quadrati chiesti il giorno prima; (b) un 4 × 4 al centro — cinque caselle vuote e il raggruppamento peggiore.
  **Conseguenza inattesa, e migliore della ragione per cui è stato fatto:** la posizione del pulsante diventa l'informazione, come il pallino dentro al rettangolino e le tacche delle quote.
- **Contesto:** con più livelli scelti, che cosa fanno i campi laterali.
  **Decisione:** il **riquadro sul foglio** vale per tutto il gruppo e distribuisce le modifiche in proporzione; **scala e rotazione** restano del livello principale, e una nota sotto ai campi lo dice. Le **maniglie di rotazione** si mostrano solo con un livello scelto.
  **Alternative scartate:** ruotare il gruppo attorno a un centro comune — non è ruotare, è ruotare *e spostare*, un'operazione diversa che nessuno ha chiesto.
- **Contesto:** l'etichetta «edit» chiesta dall'utente per segnalare un livello modificato.
  **Decisione:** l'etichetta **confronta**, non annulla: cliccandola si vede com'era prima, ricliccandola tornano le modifiche, e niente si perde. La fotografia la prende l'editor al primo gesto, **una volta sola**, se no mostrerebbe il penultimo stato invece di quello con cui il file è arrivato.
- **Contesto:** la griglia dell'editor e i magneti.
  **Decisione:** **due interruttori separati**, e la griglia **non ha tolleranza**: accesa, il punto va sempre sull'incrocio più vicino. Una griglia che aggancia solo quando le passi vicino lascia i punti in mezzo, cioè non è una griglia — è un terzo tipo di aiuto. Shift e Alt la scavalcano, e il reticolo si disegna solo quando le maglie si distinguono mentre l'aggancio resta acceso comunque.
- **Contesto:** il campo Scala rimette in proporzione un disegno schiacciato a mano.
  **Decisione:** **resta così**, confermato dall'utente. Posizione e ritaglio si conservano, la deformazione no — ed è il modo per tornare regolare.
- **Contesto:** `build.py` toglieva sempre `sample.js` per risparmiare kilobyte sulla memoria dell'ESP32.
  **Decisione:** il disegno di esempio **entra nel file unico**, e chi dovesse rimettere la pagina sulla scheda usa `--leggero`. È la prima conseguenza operativa della decisione del 2026-10-25 sulla pagina che resta sul PC: caduto il tetto, cadono le rinunce che lo servivano.

**Numeri misurati:**

- `iso-cross-2026-10-24-raw.svg`: **95 elementi**, 38 tratto `#ccc` + 38 pieno `#1a1a1a` + 19 pieno `#ccc`. Tenuti prima: 38. Adesso: 95 meno lo sfondo, in tre livelli.
- Con il solo livello dei tratti l'ottimizzatore porta **152 tracciati a 13**, perché ricuce le polilinee contigue: ogni spigolo nel file è un segmento a sé, ma la penna li percorre di fila. Con anche le facce di sinistra: 171 → **26**.
- **Accendendo anche il livello di occlusione si arriva a 52**, cioè il doppio: i doppioni **non** vengono tolti. `dedupe` gira prima di `join`, e un poligono chiuso di quattro punti non ha la stessa chiave di quattro segmenti separati. Verificato misurando, dopo aver supposto il contrario.
- Pagina: **505.357 byte** in un file solo, esempio compreso.
- Prove: **712**, tutte verdi.

**File consegnati/modificati:**

- `webui/js/svgimport.js` — `tinta()` e `colore()`; `saltare()` salta solo lo sfondo; ogni forma porta la sua tinta, `forme.tinte` l'elenco
- `webui/js/artwork.js` — `load()` divide per tinta con adattamento comune, `perTinta()`, `scalaMm()`, selezione multipla (`selezionati`/`scelto`), `unione()`, `collocaA`/`ritagliaA` sul gruppo, `ruotaA()` e `quartoDiGiro()`, `statoRot()`, `segnaOrigine()`/`commutaOrigine()`, `riordinabile()`, elenco rifatto con i segni disegnati
- `webui/js/editor.js` — selezione multipla e banda, griglia e reticolo, strumento Curva (`trattoSotto`, `piega`), strumento Togli tratto, Shift fuori dal doppio clic
- `webui/js/selezione.js` — maniglie di rotazione
- `webui/js/panel.js` — i cinque punti notevoli, i segni della penna e del foglio, tastierino a quadrati concentrici
- `webui/js/paper.js` — doppio clic che apre il riquadro sul gruppo
- `webui/css/components.css`, `webui/css/layout.css`, `webui/index.html`
- `webui/tools/build.py` — `--leggero`; `webui/dist/` rigenerato
- Collaudi nuovi: `piu-test.js`, `elenco-test.js`, `dist-test.js`; riscritto `sfondo-test.js` sulla regola nuova

**Impatto su Vision/Pipeline:** aggiornato lo **Stato dello Step 4** e appese otto note.

---

### [2026-10-25 22:56] (software) I livelli, l'editor, e la decisione di lasciare la pagina sul PC

**Riepilogo:** In una giornata il SLICER è passato da «manda un disegno» a «compone più disegni e li fa»: pausa per il cambio penna, otto maniglie col taglio, livelli ordinati, un modello di tracciato che tiene le curve e un editor per modificarle, con magneti e annulla — e la decisione di non installare la pagina sull'ESP32, che toglie di mezzo il tetto dei 113 kB.

**Cosa è stato fatto:**

- **Il disegno dei due figli, dai modelli 3D alle linee.** `figli-sagome.py` proietta i due modelli di fronte tenendo la profondità minima — la superficie rivolta a chi guarda — e ne traccia le **isoipse**, come le curve di livello di una carta. Il rilievo si racconta con le linee invece che con l'ombra, che è l'unica cosa che un plotter sa fare. Marching squares con interpolazione, cucitura dei segmenti in polilinee, Douglas-Peucker. `figli.js` compone il foglio coi nomi e il logo preso dal file originale. **Stampato, riuscito perfettamente.**
- **La pausa per il cambio penna**, segnata sull'anteprima e onorata dal Sender.
- **Otto maniglie** nel riquadro di modifica, e il **taglio col tasto destro**, non distruttivo.
- **Lo zero e il punto home** segnati sul piano.
- **I livelli**: più SVG sullo stesso foglio, riordinabili, con i cambi penna fra l'uno e l'altro e tre ambiti di ottimizzazione.
- **Il modello di tracciato** che tiene le curve (`svgpath.js`, `tracciato.js`), e l'importatore riscritto sopra.
- **L'editor**: sei strumenti, nodi e maniglie, taglio, testi.
- **Magneti e annulla** con Ctrl+Z.
- **Prove da 433 a 604 asserzioni**, tutte verdi. Nuovi collaudi: `pausa`, `taglio`, `segni`, `livelli`, `forme`, `editor`, `magneti`.

**Bug: il suggerimento che spostava il piano sotto il cursore**

**Sintomo:** con due livelli sovrapposti, il secondo doppio clic non passava mai al livello sotto. Il punto letto dal programma cadeva **cinquanta millimetri** più in là di dove si era cliccato.
**Causa:** aprendo il riquadro di modifica compariva una riga di suggerimento **dentro la didascalia sotto al piano**. La didascalia si allungava, il piano si rimpiccioliva, e la stessa posizione sullo schermo corrispondeva a un altro punto della macchina. Con un livello solo non se ne accorgeva nessuno.
**Fix applicato:** il suggerimento è passato **sopra** al piano, in posizione assoluta, e non cambia più il layout. Verificato.

**Bug: il doppio clic nell'editor non arrivava mai**

**Sintomo:** nell'editor, il doppio clic su un nodo non lo trasformava da spigolo a curva. Mai.
**Causa:** il browser emette `dblclick` **solo se i due clic hanno lo stesso bersaglio**, e la tela si ridisegna a ogni selezione: fra il primo clic e il secondo il quadratino sotto al dito è già un altro elemento.
**Fix applicato:** il doppio clic viene contato dall'editor, e **si decide al rilascio, non alla pressione** — deciderlo alla pressione faceva sparire il trascinamento, perché premere su un nodo appena scelto e tirarlo assomiglia all'inizio di un doppio clic. Chi si muove sta trascinando. Stesso motivo, stesso rimedio, per la ricerca dei nodi: si cercano per posizione e non chiedendo al bersaglio del clic chi sia.

**Bug: l'asse che non si tocca scivolava lo stesso**

**Sintomo:** nessuno visibile. Trascinando il lato destro di un disegno, l'altezza cambiava di qualche centesimo e il lato opposto si spostava.
**Causa:** il ridimensionamento arrotondava al decimo **tutti e quattro** i valori del rettangolo, compresi quelli che la maniglia non tocca.
**Fix applicato:** si arrotonda solo quello che si è mosso. Non è estetica: è deriva, e a forza di trascinamenti il disegno non torna più alle misure che dice di avere — lo stesso errore che la struttura a rettangolo era nata per evitare.

**Bug: con Shift il disegno si poteva solo ingrandire**

**Sintomo:** tenendo Shift e trascinando una maniglia verso l'interno, non succedeva niente.
**Causa:** il fattore di scala era il **massimo** fra i due rapporti; muovendo lungo un asse solo, il rapporto dell'altro resta pari a uno, e il massimo di qualcosa-meno-di-uno e uno è uno.
**Fix applicato:** il puntatore si proietta sulla diagonale del rettangolo di partenza.

**Bug: un `d` sgangherato produceva nodi a NaN**

**Sintomo:** un attributo `d` malformato — o del testo che per caso contiene una lettera di comando, «garbage» ha una «a» dentro, che in SVG è l'arco — produceva un tracciato che non si vede e non si può correggere.
**Causa:** ogni comando leggeva i suoi numeri senza controllare che ci fossero.
**Fix applicato:** ogni comando verifica di avere i suoi argomenti, e dove non capisce si ferma invece di inventare.

**Bug: il Sender aveva cominciato a dipendere dal generatore**

**Sintomo:** il collaudo di `api.js`, che carica `sender.js` da solo, moriva con un `ReferenceError: Gcode is not defined`.
**Causa:** per sapere com'è scritto il commento del cambio penna, `Sender.prepara` importava la costante da `Gcode`.
**Fix applicato:** riconosce la **forma** del commento con un'espressione regolare. Resta collaudabile da solo e accetta anche un «; PAUSA» scritto a mano.

**Misure e numeri nuovi:**

- **Latenza dell'interruzione, misurata sui segmenti veri** dell'intreccio: media 8,17 mm, mediana 2,71 su 902 segmenti, quindi sedici righe in volo valgono **2÷6 secondi** di inchiostro. (Correzione di una stima data a voce: era ottimistica di due o tre volte.)
- **Il disegno dei figli:** 314 tracciati letti, 217 dopo l'ottimizzazione, 8 min 30 s stimati su A5.
- **La pagina compressa** era arrivata a 101 kB contro ~113 liberi; con la decisione di non installarla il numero smette di essere un vincolo.

**Decisioni prese:**

- *Contesto:* restava aperto se installare la pagina sull'ESP32 al posto della WebUI di FluidNC, e il peso cresceva a ogni aggiunta.
  *Decisione:* **la pagina resta sul PC.** Non si installa.
  *Alternative scartate:* installarla per poterla aprire da qualsiasi apparecchio della rete — l'unico guadagno vero, giudicato non abbastanza; e comunque le impostazioni non viaggiano con la pagina, stanno nel browser, quindi un telefono partirebbe vuoto.
  *Conseguenze accettate:* per stampare serve il computer. In cambio cade il tetto dei 113 kB, resta la WebUI di FluidNC come rete di sicurezza, e ogni modifica è un salvataggio di file invece di un caricamento in flash.
  *Da rivedere se:* servirà comandare la macchina dal telefono stando lì davanti, o l'interfaccia smetterà di cambiare ogni giorno.
  *Nota:* **installare la pagina non renderebbe comunque la stampa indipendente dal computer** — il trasporto resta lo stesso WebSocket. L'unico modo sarebbe far eseguire il file dalla memoria, che è la strada che ha fatto cadere la scheda.

- *Contesto:* l'operatore ha chiesto più SVG sullo stesso foglio per comporre, e separatamente come dire al programma quali tratti sono di un colore.
  *Decisione:* **un concetto solo, il livello** — un gruppo di tratti che si disegnano con una penna sola. Da dove viene è un dettaglio: un file intero oggi, un colore dentro a un file domani.
  *Alternative scartate:* due meccanismi separati per i file e per i colori — due elenchi, due ordinamenti e due modi di mettere una pausa.

- *Contesto:* l'operatore proponeva due modalità, «stampa ottimizzata» e «stampa in ordine».
  *Decisione:* **tre ambiti** — tutto / per livello / niente — con «per livello» predefinito.
  *Alternative scartate:* le due modalità come proposte: «in ordine» avrebbe buttato via l'ottimizzazione **anche dentro al singolo livello**, dove riordinare non cambia una virgola del risultato e fa risparmiare parecchio (sul disegno dei figli, cento alzate in meno).
  *Accettata dall'operatore*, che ha indicato «per livello» come quello che userà di più.

- *Contesto:* la spunta «cambia penna prima di questo livello» non si applica al primo livello, che non ha un prima.
  *Decisione:* **la spunta non si tocca riordinando.** È una proprietà del livello, resta scritta anche quando non vale, e rimettendo il livello più in giù torna ad applicarsi.
  *Alternative scartate:* azzerarla quando un livello finisce primo — era la prima stesura, e perde un'informazione a ogni spostamento: riordinare due volte non riporterebbe allo stato di partenza.

- *Contesto:* tagliare un disegno è un'operazione che si sbaglia facilmente.
  *Decisione:* **il ritaglio è un rettangolo a parte**, non una modifica del disegno. Le forme non vengono mai cancellate, solo nascoste, e ritirando la maniglia tornano.
  *Alternative scartate:* tagliare davvero le polilinee — irreversibile, e per rimediare servirebbe ricaricare il file e rifare tutto il resto.

- *Contesto:* un editor deve poter curvare un tratto, e l'importatore appiattiva tutto al caricamento.
  *Decisione:* **leggere il `d` per davvero** e tenere le forme accanto alle polilinee, appiattendo in uscita.
  *Alternative scartate:* restare sul campionamento del browser con `getPointAtLength` — comodo ed esatto, ma produce un dato definitivo da cui non si risale alla curva; tenere tre tipi di curva invece di convertire tutto in cubiche — vorrebbe dire scrivere tre volte ogni cosa che le tocca.

- *Contesto:* serviva un annulla.
  *Decisione:* **una pila di istantanee**, con una fotografia per gesto, e il rettangolo del livello dentro all'istantanea.
  *Alternative scartate:* un elenco di comandi da rifare al contrario — più elegante e più fragile: un comando inverso può sbagliare, una fotografia no. Qui le operazioni sono poche e i disegni piccoli, quindi la memoria non è un problema.

**File consegnati/modificati:**

- `webui/tools/figli-sagome.py`, `webui/tools/figli.js` — **nuovi**; `gcode/figli.svg`
- `webui/js/svgpath.js`, `webui/js/tracciato.js`, `webui/js/editor.js` — **nuovi**
- `webui/js/font-tratto.js` — spostato da `webui/tools/`, serve anche alla pagina
- `webui/js/artwork.js` — riscritto sui livelli, più istantanea/ripristino e il livello vuoto
- `webui/js/svgimport.js` — `parseForme`, `ritaglia`, `toRect`/`fitRect`/`percentuali`
- `webui/js/gcode.js`, `webui/js/sender.js` — il segno `;PAUSA` e lo stato modale azzerato
- `webui/js/selezione.js`, `webui/js/paper.js`, `webui/js/preview.js`, `webui/js/profile.js`, `webui/js/app.js`, `webui/js/jog.js`, `webui/js/sorgenti.js`
- `webui/index.html`, `webui/css/components.css`
- `webui/dist/cnc2d-ui.html` — consegnato all'operatore sette volte in sessione
- Collaudi nello scratchpad: `pausa-test.js` (27), `taglio-test.js` (28), `segni-test.js` (11), `livelli-test.js` (37), `forme-test.js` (22), `editor-test.js` (27), `magneti-test.js` (17)

**Impatto su Vision/Pipeline:** **Step 4** — lo Stato passa a «l'applicazione stampa, compone e disegna», e registra la decisione di **non installare la pagina sull'ESP32**: cade il tetto dei 113 kB che vincolava ogni aggiunta, e resta per sempre la dipendenza dal computer durante la stampa. Aggiunte otto note allo Step 4, fra cui quello che all'editor manca ancora.

---

### [2026-10-25 10:16] (software) La prima stampa lanciata dall'app, l'importatore che disegnava lo sfondo, e il disegno che diventa un rettangolo da trascinare

**Riepilogo:** Un programma intero è partito dal SLICER ed è uscito con la cornice esatta al decimo (191,7 × 187,7), il movimento continuo ha confermato la finestra da 16 righe, l'interruzione ha alzato la penna senza perdere l'origine — e per arrivarci sono stati corretti due bug che non avevano ancora un sintomo visibile e riscritto il modo in cui il disegno sta sul foglio.

**Cosa è stato fatto:**

- **Prima stampa intera lanciata dall'applicazione.** Intreccio all'80 % su foglio 270 × 255 con l'angolo a −14 / −9. Cornice misurata col calibro: **191,7 × 187,7 mm contro 191,7 × 187,7 previsti**. Movimento continuo, nessuna esitazione fra segmenti. Stima del tempo accettata senza cronometro.
- **Interruzione provata sulla macchina.** Penna alzata, ritorno al punto home, e **origine intatta** — verificato subito dopo con «vai al punto», che è l'unica prova che il `G92` sia sopravvissuto. Latenza misurata e spiegata: fino a 16 righe sono già dentro la scheda quando si preme.
- **Pausa provata.** Immediata, penna appoggiata. L'utente l'ha riconosciuta come il meccanismo giusto per il cambio penna nei disegni a più colori, e ha chiesto che si possa **programmare** su un punto dell'anteprima.
- **Righelli attorno al piano** (`webui/js/righelli.js`, nuovo): due bande in basso e a sinistra con lo zero sullo **zero macchina**, passo che si dirada da solo fra 1, 2, 5, 10, 20, 50 mm, e un contatore sempre visibile della posizione del mouse in millimetri macchina, con due trattini che lo seguono sui righelli.
- **Riquadro di modifica del disegno** (`webui/js/selezione.js`, nuovo): doppio clic sul disegno, trascinamento che sposta **il disegno e non il foglio**, quattro maniglie che deformano, Shift che tiene le proporzioni, `Esc` per uscire.
- **Il disegno ha smesso di essere «centrato all'N %»** ed è diventato un rettangolo esplicito in millimetri del foglio (`Artwork.box`, `SvgImport.toRect/fitRect/percentuali`). Scala, rotazione, trascinamento e deformazione cambiano quel rettangolo e le polilinee grezze ci vengono rimappate dentro da capo.
- `applicaVista()` annuncia ora l'evento `vista` invece di chiamare uno per uno chi disegna in pixel sopra al piano.
- **Prove da 389 a 433 asserzioni**, tutte verdi (`sfondo-test.js` 16, `riga-test.js` 28).

**Bug: l'importatore disegnava lo sfondo del file e i riferimenti**

**Sintomo:** caricando `intreccio.svg` l'anteprima mostrava **due cornici quasi sovrapposte** invece di una, a circa un millimetro l'una dall'altra, più un cerchietto in basso a sinistra. Notato dall'utente guardando l'anteprima, non da un collaudo.
**Causa:** il selettore dell'importatore comprende `rect` e `circle`, e niente distingueva un segno da tracciare da una decorazione del file. Tutti i nostri SVG si portano dietro un rettangolo bianco di fondo (242 × 237) — che a schermo evita la trasparenza — e un pallino rosso che segna il punto home. **Secondo danno, invisibile:** il rettangolo di fondo è più grande della cornice vera (240 × 235) e allargava il rettangolo di ingombro, che è il numero con cui si decide la scala. Il disegno usciva circa l'1 % più piccolo del dovuto, e non c'era modo di accorgersene col calibro in mano.
**Fix applicato:** il discriminante è **il bordo, non il riempimento**. Se nel file c'è almeno una forma col bordo il disegno è fatto di linee e le forme senza bordo sono decorazione: si saltano. Se non c'è un solo bordo il disegno è fatto di forme piene — una clipart — e quelle vanno tracciate come contorni: lì si salta solo chi copre l'intera tela. Il log dice quante forme sono state saltate. **Verificato** dal collaudo e poi dalla stampa, uscita con una cornice sola.

**Bug: con Shift il disegno si poteva solo ingrandire**

**Sintomo:** tenendo Shift e trascinando una maniglia in orizzontale verso l'interno, il disegno non si muoveva affatto.
**Causa:** il fattore di scala era `max(w / w0, h / h0)`. Muovendo lungo un asse solo, il rapporto dell'altro resta pari a uno, e il massimo di qualcosa-meno-di-uno e uno è uno.
**Fix applicato:** il puntatore si proietta sulla diagonale del rettangolo di partenza, e la proiezione è il fattore di scala. Un movimento lungo la diagonale scala esatto, uno perpendicolare non fa niente, uno obliquo fa la sua parte. **Trovato dal collaudo, non leggendo il codice.**

**Misure e numeri nuovi:**

- **Cornice stampata dall'app: 191,7 × 187,7 mm, misurata uguale alla previsione.** Chiude la catena scala → riadattamento → G-code → macchina.
- **Latenza dell'interruzione.** Nell'intreccio il segmento con movimento è in media **8,17 mm**, mediano **2,71 mm** su 902 segmenti. Sedici righe in volo valgono quindi fra 4 e 13 cm di inchiostro, cioè **2÷6 secondi** a 1200 mm/min. *Correzione di una stima data a voce prima della prova* («da una frazione di secondo a un paio di secondi»): era ottimistica, il conto sui segmenti veri dice il doppio o il triplo.
- **Peso della pagina: 97.126 byte compressi**, da 87.826. Lo spazio libero sull'ESP32, tolta la WebUI di FluidNC, è ~113 kB.

**Decisioni prese:**

- *Contesto:* bisognava stabilire che cosa, dentro un file SVG, è un segno da tracciare.
  *Decisione:* **il discriminante è il bordo.** File con almeno un bordo = disegno di linee, le forme senza bordo sono decorazione e si saltano; file senza nemmeno un bordo = disegno di forme piene, si tracciano come contorni e si salta solo chi copre l'intera tela.
  *Alternative scartate:* saltare tutte le forme piene — romperebbe la regola dichiarata nell'interfaccia, cioè le clipart non si potrebbero più disegnare; togliere il rettangolo dai nostri file — cura il sintomo nei nostri e lascia il problema in ogni file preso dal mondo, che è poi il caso normale.
  *Da rivedere se:* arriva un file misto in cui una forma piena fa parte davvero di un disegno di linee. Lì quella forma si perde, e servirebbe una scelta per elemento. Si è preferito perché si vede subito nell'anteprima e il log lo dice, mentre lo sfondo disegnato si scopre a stampa finita.

- *Contesto:* per spostare e deformare il disegno col mouse serviva un posto in cui scrivere dove sta.
  *Decisione:* **il disegno è un rettangolo esplicito in millimetri del foglio**, e scala, rotazione, trascinamento e deformazione cambiano lui. Le polilinee grezze si rimappano dentro da capo a ogni modifica.
  *Alternative scartate:* comporre le trasformazioni una sull'altra — accumula errore a ogni giro, e dopo dieci trascinamenti il disegno non torna più alle misure che dice di avere.
  *Conseguenze accettate:* ruotando la collocazione riparte centrata (un rettangolo pensato per l'altro verso schiaccerebbe il disegno); scrivere una percentuale rimette in proporzione **senza ricentrare**; tirando una maniglia oltre l'angolo opposto il disegno si ferma invece di specchiarsi.

- *Contesto:* l'interruzione ha una latenza di qualche secondo, e l'utente ha chiesto se è normale.
  *Decisione:* **si tiene così.** Lo stop smette di alimentare, butta via la coda nostra e accoda alzata e ritorno a casa.
  *Alternative scartate:* un soft reset per svuotare il pianificatore della scheda — cancella il `G92`, cioè l'origine presa a mano, che è il contrario di quello che serve dopo un'interruzione; stringere la finestra sotto le 16 righe — il movimento continuo è stato verificato a 16 sulla macchina, e non si rompe una cosa che funziona per accorciare uno stop che l'utente ha già accettato.
  *Da rivedere se:* servisse fermarsi davvero all'istante, per esempio per un sensore di sicurezza. Lì la strada è la pausa, che è immediata, seguita dall'alzata.

- *Contesto:* i righelli dovevano restare leggibili a qualsiasi ingrandimento.
  *Decisione:* **un SVG a parte, sovrapposto al piano e misurato in pixel**, con lo zero sullo **zero macchina**.
  *Alternative scartate:* disegnarli dentro al piano, dove le unità sono millimetri — tacche e numeri si ingrandirebbero con la rotella, illeggibili da vicino e invisibili da lontano; mettere lo zero sull'angolo del foglio — il foglio si trascina, i blocchi no, e un righello che misura da un riferimento che si muove dà numeri che non si possono ripetere sulla macchina.

**File consegnati/modificati:**

- `webui/js/svgimport.js` — riconoscimento di sfondo e decorazioni; `toRect`, `fitRect`, `percentuali`
- `webui/js/artwork.js` — il rettangolo di collocazione e le due percentuali
- `webui/js/righelli.js` — **nuovo**
- `webui/js/selezione.js` — **nuovo**
- `webui/js/paper.js` — evento `vista`, triplo significato del doppio clic, riquadro che segue il foglio
- `webui/js/app.js`, `webui/index.html`, `webui/css/components.css`
- `webui/dist/cnc2d-ui.html` — ricostruito e consegnato all'utente due volte in sessione
- Collaudi nello scratchpad: `sfondo-test.js` (16), `riga-test.js` (28)

**Impatto su Vision/Pipeline:** **Step 4** — lo Stato passa da «l'applicazione comanda la macchina, resta mandare un programma intero e installare la pagina» a **«l'applicazione stampa»**: delle due cose aperte ne resta una, installare la pagina. Aggiunte cinque note allo Step 4, fra cui la richiesta della **pausa programmata per il cambio penna** col vincolo di progetto (si può interrompere solo al confine fra due tracciati) e il **peso della pagina** come vincolo da sorvegliare prima dell'editor.

---

### [2026-10-24 18:50] (software) Il SLICER manda il programma, e diventa l'interfaccia della macchina

**Riepilogo:** Il buco grosso del programma è chiuso: l'invio del G-code esiste, passa da un WebSocket solo e persistente invece che da una richiesta HTTP per riga, e la pagina ha parlato con la macchina vera — collegamento, jog, homing, «vai al punto» tutti provati sull'ESP32. Attorno a quello, una giornata di interfaccia: tastierino rifatto, fogli personalizzati, fogli più grandi della corsa, rotella e trascinamento sul piano, la tavola di legno disegnata e misurata, colonne laterali ridimensionabili. Le prove passano da 230 a 389 asserzioni.

**Cosa è stato fatto:**

- **L'invio del programma** (`sender.js`, nuovo, e `api.js` riscritto). Il trasporto non è più `/command?commandText=` — una richiesta HTTP per riga, cioè un canale nuovo per riga dentro FluidNC — ma **un WebSocket solo**, aperto una volta, registrato in `allChannels` esattamente come la UART. Letto nel sorgente: `WSChannel.cpp` mette i frame in arrivo in `push()`, i caratteri real-time hanno un instradamento loro, e `WebUIServer.cpp` monta il socket sulla **radice** (`new AsyncWebSocket("/")`).
- **Scoperta che sblocca lo sviluppo:** i WebSocket **non passano per il CORS**, e FluidNC non guarda l'header `Origin`. Quindi la pagina parla con la macchina anche servita da altrove, e l'operatore ha potuto provarla aprendo il file dal disco, senza installare niente sull'ESP32.
- **Provata sulla macchina vera.** Collegamento riuscito (`Collegata a ws://192.168.1.14/`), jog dal pannello, procedura di homing completa, «vai al punto». È il pezzo che non era mai stato provato. **Resta non provato l'invio di un programma intero.**
- **Il tastierino rifatto**, su otto richieste dell'operatore: quadrato per costruzione, otto direzioni (le diagonali sono **un solo** `$J`, due comandi separati farebbero una L), le tre quote della penna al centro con una tacca disegnata in CSS, due frecce da un grado, lo STOP sceso sotto, il passo attivo evidenziato, un quinto posto che è un campo libero, e «vai al punto» scrivendo le coordinate.
- **I fogli personalizzati**: un «+» acceso solo su misure nuove, matita e cestino che compaiono passandoci sopra, e il formato in uso finalmente evidenziato *dai dati* (prima la classe era scritta a mano su A5 nell'HTML: giusta all'avvio e sbagliata appena si ruotava il foglio).
- **I fogli più grandi della corsa**, che sono quelli che l'operatore usa davvero: l'angolo del foglio può stare in negativo, la vista si allarga a contenerlo, l'avviso dice quanto se ne raggiunge invece di gridare «esce dall'area» a ogni foglio, e un rettangolo tratteggiato disegnato **sopra la carta** segna dove la penna arriva.
- **Rotella e trascinamento sul piano**: zoom ancorato al puntatore, trascinamento del fondo per spostarsi, tasto centrale che sposta la vista anche sopra la carta, doppio clic per riadattare.
- **La tavola di legno e l'area di appoggio**, disegnate attorno all'area di lavoro, con i loro otto numeri in Impostazioni e un controllo di coerenza.
- **Le due colonne laterali si ridimensionano** trascinando, con il contenuto che si riadatta (container query, non media query).
- **Il pulsante «Crea / Edit»** e l'elenco di dove trovare disegni, con Book of Shapes come primo.
- **Tolto il disegno di esempio** dal piano: con tre rettangoli da guardare faceva credere che ci fosse qualcosa da stampare.

**Bug: la strada vecchia dell'invio avrebbe riprodotto il guasto appena risolto**

**Sintomo:** nessuno ancora — `api.js` non aveva mai mandato un programma.
**Causa:** mandava ogni comando su `/command`, la rotta su cui FluidNC crea un canale per ogni richiesta; e faceva polling dello stato ogni 500 ms sulla stessa rotta. Un programma da 2500 righe avrebbe creato 2500 canali, e il polling uno ogni mezzo secondo per sempre.
**Fix applicato:** trasporto riscritto sul WebSocket. **Collegamento e comandi singoli verificati sulla macchina**, l'invio di un programma no.

**Bug: `homingFatto()` mandava ancora il jog che il documento dichiara sbagliato dal 2026-10-23**

**Sintomo:** nessuno visibile — il jog non muove niente, ed è proprio quello il problema.
**Causa:** `$J=G91 X0.01 F100` vale 0,34 passi, cioè zero passi arrotondati, e un jog prima del `G92` porterebbe il carrello via dai blocchi. La voce del 2026-10-23 lo registrava come difetto corretto; il **codice** se l'era tenuto.
**Fix applicato:** tolto. Azzera e poi si sposta al punto home, che è anche il movimento che riaccende i motori. **Verificato sulla macchina** dall'operatore e da un'asserzione nuova più stretta: fra `$MD` e `G92` non deve passare nessun comando di movimento.

**Bug: il DRO leggeva `MPos` come se fosse la posizione di lavoro**

**Sintomo:** nessuno osservato, perché prima del WebSocket il DRO non aveva mai letto un rapporto vero con un `G92` attivo.
**Causa:** la posizione di lavoro è `MPos − WCO`, e Grbl manda `WCO` solo ogni tanto per non ripeterlo in ogni riga. Senza la sottrazione il DRO avrebbe mostrato numeri veri riferiti a un'origine che non è la nostra — plausibili e falsi.
**Fix applicato:** si accettano sia `MPos` sia `WPos`, e il `WCO` si ricorda fra un rapporto e l'altro.

**Bug: il ribaltamento dell'asse Y era calcolato dalla finestra**

**Sintomo:** nessuno, finché non è esistito il trascinamento della vista.
**Causa:** quel numero dice dove cade la y zero della macchina nelle coordinate del disegno, e non dipende da dove si sta guardando. Col margine simmetrico i due conti davano lo stesso risultato, quindi il difetto era invisibile — si sarebbe visto al primo trascinamento, facendo scorrere il disegno **sotto** la finestra mentre la finestra scorre sul disegno: il doppio del movimento, nel verso sbagliato.
**Fix applicato:** costante, derivata dalla sola altezza dell'area.

**Bug: il campo dei collegamenti era `type="url"` e bloccava l'invio**

**Sintomo:** incollando `sito.com` e premendo «+» non succedeva niente.
**Causa:** con `type="url"` il browser rifiuta un indirizzo senza schema **prima** di lasciar partire il `submit`, quindi il codice che aggiunge `https://` da sé non veniva mai raggiunto.
**Fix applicato:** `type="text"` con validazione nostra. Trovato provando, non leggendo.

**Due misure nuove, e nessuna delle due era scritta da nessuna parte:**

- **La banda morta del servo vale 0,9°, cioè 0,295 mm.** Conseguenza: i due pulsanti da **0,2 mm** della scheda penna valgono 0,61° e **stanno sotto la banda morta** — spesso non muovono niente. La nota del pannello diceva il contrario. Un grado (0,327 mm) è il primo passo che la penna sente davvero, ed è per questo che le frecce nuove sono da un grado.
- **Un passo di motore vale 0,0295 mm**, quindi i millimetri tondi quasi mai sono un numero intero di passi: il pulsante da **0,1 mm muove 0,0884**, il 12% in meno di quello che c'è scritto sopra. Gli altri tre stanno sotto i 15 micron. Ogni pulsante ora porta il movimento vero nel suggerimento.

**La geometria della tavola, misurata:** tavola 700 × 600 (dal CAD, e quelle dimensioni valgono perché sono di un pezzo di legno); **zero macchina a 280 da sinistra e 20 dal basso**; area di appoggio del foglio **355 × 400**. L'area di lavoro ci cade dentro con 70 mm di carta liberi a sinistra, 44 a destra, 10 sotto e 154 sopra. Le forchette calcolate *prima* di chiedere le misure (zeroX fra 210 e 324, zeroY fra 10 e 174) sono state rispettate, il che conferma anche la lettura delle misure orizzontali.

**E una correzione dell'operatore che vale una nota:** quei 10 mm sotto **non sono un margine risicato**. Il bordo inferiore dell'appoggio è una **battuta fisica**, e ci si spinge contro il foglio per posarlo dritto. Arrivare a filo è il gesto giusto, non un rischio — scritto nel commento del codice e in quello della prova, perché un numero piccolo in fondo a una tabella si rilegge volentieri al contrario.

**Decisioni prese:**

- **Contesto:** come il SLICER manda il G-code alla macchina.
  **Decisione:** **un WebSocket solo e persistente**, con le righe mandate una per una e un **freno a finestra**: al più 16 righe non confermate in volo, e il freno è l'`ok`.
  **Alternative scartate:** `/command` per riga, che è la causa confermata del guasto del 2026-10-23; **send-and-wait** (una riga, aspetta, la prossima), che lascerebbe il pianificatore vuoto e la macchina a scatti fra un segmento e l'altro; **riversare tutto insieme**, che riempirebbe la memoria dell'ESP32 — il lato in ingresso del WebSocket non ha né limite né contropressione, `WS_EVT_DATA` passa il frame a `push()` senza guardare quanto è lungo.
  **Da rivedere se:** la macchina si mostrasse a scatti su disegni molto fitti, nel qual caso la finestra va allargata, non tolta.
  **Costo accettato:** la stampa dipende dalla rete per tutta la sua durata, e chiudere la pagina la interrompe. Col file in memoria non succedeva. In cambio si vede l'avanzamento, si può mettere in pausa, e la macchina non muore.

- **Contesto:** fermare una stampa in corso.
  **Decisione:** **l'interruzione non è un reset.** Si smette di alimentare, si butta via quello che non è partito, e si **accodano** alzata e ritorno a casa, che il pianificatore esegue dopo le righe già dentro.
  **Alternative scartate:** Ctrl-X, che azzera FluidNC **e con lui il `G92`**, cioè l'origine presa a mano sui blocchi — per ricominciare bisognerebbe rifare tutta la procedura.
  **Costo accettato:** le righe già in volo vengono disegnate lo stesso, al più la finestra, cioè qualche millimetro. Detto nel registro.

- **Contesto:** dove installare la pagina sull'ESP32.
  **Decisione:** **deve chiamarsi `index.html.gz` e prende il posto della WebUI di FluidNC.** Non è una preferenza: il gestore generico (`handle_not_found` → `myStreamFile` con `download=true`) serve qualunque file della flash ma con `Content-Disposition: attachment`, quindi una pagina messa lì accanto con un nome suo verrebbe **scaricata** invece che aperta. L'unico percorso che il browser apre è la radice.
  **Alternative scartate:** far convivere le due interfacce, che il sorgente non permette.
  **Rischio gestito:** la rotta WebDAV non dipende da nessuna pagina, quindi si torna indietro sempre — il README del firmware ha il giro completo, copia di sicurezza prima.

- **Contesto:** dove salvare le cose nuove (fogli personalizzati, larghezze delle colonne, collegamenti).
  **Decisione:** **i fogli nel profilo** (al primo livello, fuori da `stampa`, così non spariscono cambiando profilo di stampa); **larghezze e collegamenti in chiavi loro**. Il profilo descrive la **macchina**, si esporta e si rimette su un altro computer: la larghezza di una colonna sullo schermo di chi guarda e un segnalibro non c'entrano niente con una taratura.
  **Da rivedere se:** si volesse un vero «spazio di lavoro» esportabile, che allora sarebbe una terza cosa ancora.

- **Contesto:** l'editor SVG chiesto dall'operatore.
  **Decisione:** per ora **solo il pulsante e la tab**, che dichiara di essere vuota. Costruito prima il resto. E quando si farà, **modificare prima di creare**: per *creare* da zero Inkscape o Boxy fanno meglio di quanto faremo noi in mesi; per **sistemare un disegno destinato a questa macchina** — togliere un tratto doppio, chiudere un buco, riscalare sul foglio sapendo dov'è la battuta — il giro «esporta, reimporta, riguarda» è il fastidio che l'operatore vuole togliere.
  **Precondizione architetturale trovata, e non è un dettaglio:** `SvgImport.parse` **appiattisce le curve in polilinee** appena si carica il file. Un editor con maniglie per le Bézier ha bisogno delle curve vere: su un disegno appiattito una curva è una collana di cento punti e non c'è niente a cui attaccare una maniglia. Quindi il primo pezzo di lavoro è invisibile — un modello di tracciato che tiene le curve e le appiattisce solo in uscita verso il G-code — e senza quello il resto non esiste.
  **Due cose che faremmo meglio di un editor generico**, ed entrambe sono del plotter: il **testo a tratto singolo** (`font-tratto.js` esiste già; un font da stampa è fatto di contorni, e una penna che ripassa un contorno sotto i 6-7 mm fa macchie) e l'**anteprima vera** con ordine dei tratti, alzate e tempo.
  **Alternative scartate:** cominciare dalla tela senza il modello, che vorrebbe dire rifarla.

**File consegnati/modificati:**
- `webui/js/api.js` — riscritto sul WebSocket: finestra di 16 righe, caratteri real-time che scavalcano la coda, righe ricomposte dai frame, `MPos − WCO`, `jogXY`, `homingFatto()` corretta
- `webui/js/sender.js` — **nuovo**: preparazione del programma, scorta di 32 righe, avanzamento contato sugli `ok`, pausa, interruzione pulita
- `webui/js/layout.js`, `webui/js/sorgenti.js` — **nuovi**: colonne ridimensionabili; collegamenti e pulsante Crea/Edit
- `webui/js/panel.js` — tastierino a otto direzioni, quote della penna, frecce da un grado, passo libero, vai al punto
- `webui/js/paper.js` — fogli personalizzati, foglio più grande della corsa, rettangolo raggiungibile, rotella e trascinamento, tavola e appoggio, niente più disegno di esempio
- `webui/js/profile.js` — formati dell'operatore, blocco `tavola` con le misure del 2026-10-24, `tavolaRect`/`appoggioRect`
- `webui/js/popup.js` — il passo 3 cambia gesto quando l'angolo del foglio è fuori dalla corsa
- `webui/js/artwork.js`, `app.js`, `jog.js`, `state.js`, `settings.js` — invio, avanzamento, pulsanti della stampa, campo `stampa`, sezione Tavola
- `webui/index.html`, `webui/css/*` — tab Editor, sezione Tavola, manici, container query
- `firmware/fluidnc/index.html.gz` — **nuovo**: il programma compresso, pronto da installare
- `firmware/fluidnc/README.md` — perché deve chiamarsi `index.html.gz`, e il giro con la copia di sicurezza
- Prove: `api-test.js` e `layout-test.js` nuovi, `panel-test`/`popup-test`/`foglio-test`/`ui-test` ampliati. **Da 230 a 389 asserzioni.**

**Impatto su Vision/Pipeline:** **Step 4** — lo stato passa da «restano invio e ospitare la pagina» a «l'invio c'è e il trasporto è provato sulla macchina; resta da provare un programma intero e da installare la pagina», con le note della giornata. **Step 3** — nota sull'interfaccia che ora comanda la macchina da sé.

---

### [2026-10-24 08:20] (firmware+software) Il blocco delle stampe lunghe è confermato sulla macchina, e il criterio del millimetro è dimostrato

**Riepilogo:** La prova proposta ieri è stata fatta e ha risposto: l'intreccio, che dalla WebUI si era fermato due volte, lanciato dalla seriale USB a scheda del browser chiusa è arrivato in fondo — la causa individuata nel sorgente è confermata sulla macchina, e c'è un rimedio operativo da subito. La cornice da 240 × 235 del foglio appena stampato, misurata col righello, chiude anche la questione del rapporto rimasta aperta ieri.

**Cosa è stato fatto:**

- **Eseguita la prova della seriale**, cambiando **una variabile sola**: stesso file, stessa macchina, stesso foglio, stessa sequenza d'origine — cambia solo il canale da cui parte il comando. Procedura: scheda del browser chiusa, USB collegata a macchina spenta, 12 V riaccesi, monitor seriale dell'Arduino IDE a 115200 con fine riga «New Line», `$I` per verificare il collegamento (FluidNC v4.1.1, `GDC CNC 2D`, IP 192.168.1.14), poi origine manuale e `$LocalFS/Run=i.gcode`. **Disegno completato, circa 7 minuti, nessun reset.**
- **Liberata la flash prima dell'upload.** Con `sp.gcode` dentro restavano 20 KB liberi contro i 19.556 byte dell'intreccio: nominalmente ci stava per 900 byte, che non è un margine, ed è comunque sotto la riserva che il gestore di upload di FluidNC si tiene da parte. Cancellato `sp.gcode` (è in repository, si riscarica) e caricato con `curl -T i.gcode http://192.168.1.14/flash/i.gcode`.
- **Misurata la cornice del foglio stampato:** lato orizzontale **240 mm**, lato verticale **235 mm**. Col righello, leggendo lo stesso bordo delle due linee perché lo spessore della penna si elidesse invece di sommarsi.
- **Verificato che l'intreccio porta già una cornice 240 × 235** (da X0,5 a X240,5 e da Y0,5 a Y235,5): è la ragione per cui quella misura non è costata una stampa in più.

**Bug: due stampe lunghe si bloccano a metà e portano giù il server web — CAUSA CONFERMATA**

**Sintomo:** vedi la voce del 2026-10-23 21:40. L'intreccio si era fermato a circa il 90%, lo spirografo a circa il 10%, con la WebUI irraggiungibile e la necessità di spegnere e riaccendere.
**Causa: confermata sulla macchina.** Lo stesso identico file, lanciato dalla seriale invece che dalla casella comandi della WebUI, è arrivato in fondo. È il canale HTTP che il job si tiene aperto per tutta la durata a far cadere tutto; il canale della UART non si disconnette mai, e il blocco non si presenta. **Onestà sul grado di prova:** è **una corsa sola**, quindi una conferma forte e non una dimostrazione — ma quel file si era bloccato **due volte su due** dalla WebUI, e l'unica variabile cambiata è quella.
**Fix applicato: rimedio operativo, non cura.** I disegni lunghi si lanciano dalla seriale. La cura vera è lo **streaming riga per riga** dal SLICER, che non apre nessun canale destinato a restare appeso per l'intera durata del job — ed è lo stesso lavoro già deciso per altre ragioni (vedi Step 4).

**Decisioni prese:**

- **Contesto:** finché il SLICER non invia il G-code, i disegni lunghi vanno comunque lanciati in qualche modo.
  **Decisione:** **dalla seriale USB, con la scheda del browser chiusa.** Non è una preferenza di comodità: la WebUI è esattamente la configurazione in cui il blocco si riproduce.
  **Alternative scartate:** continuare dalla WebUI accettando il rischio — due stampe perse su due dicono che non è un rischio ma una certezza; telnet sulla porta 23, mai provato e con lo stesso difetto di fondo, un canale di rete che può cadere.
  **Da rivedere se:** il SLICER comincia a mandare il programma da sé, nel qual caso questa regola decade da sola.

- **Contesto:** la correzione del 2026-10-23 21:40 aveva stabilito che il criterio «errore sotto il millimetro» **non era dimostrato**, perché il quadratino da 60 mm letto col righello limita l'errore solo a 2 mm sulla campata massima.
  **Decisione: il criterio è dimostrato.** La cornice da 240 mm sul foglio stampato legge 240. A ±0,5 mm di righello su 240 mm l'errore di scala è limitato allo **0,21%**, che sulla corsa massima di 241,232 mm fa **0,51 mm**. Il lato da 235 legge 235, quindi la conclusione vale su **entrambi gli assi** e non solo su X. **Completa la decisione del 2026-10-23 21:40:** la scelta di non tarare resta quella, cambia che adesso ha sotto una misura invece di un'assunzione.
  **Da rivedere se:** come prima — quote assolute (fori, incastri, sovrastampe su stampato), o uno scarto futuro sopra il millimetro. Resta `tarato: false` nel profilo, perché il rapporto continua a essere il nominale: è dimostrato che l'errore è piccolo, non che non ci sia.

**File consegnati/modificati:** nessun file di progetto — sessione di prova sulla macchina. Aggiornato solo questo documento.

**Impatto su Vision/Pipeline:** **Step 3** — lo stato passa da «resta un blocco vero, causa non confermata» a «causa confermata, rimedio operativo disponibile», con la nota della prova. **Step 4** — l'invio riga per riga acquista una seconda ragione: non più solo ergonomia, ma la cura del blocco.

---

### [2026-10-23 21:40] (firmware+software) La macchina disegna davvero, l'area si accorcia di un centimetro, e due stampe lunghe muoiono a metà

**Riepilogo:** La correzione della Z va in produzione e la macchina fa il suo primo disegno vero (il vortice, 6,5 metri di tratto senza staccare la penna); poi il pignone del carrello si scopre toccare la cremagliera di Y e l'area utile perde 10 mm in X, il che manda fuori misura il disegno di collaudo; e infine due stampe lunghe si bloccano a metà portandosi giù il server web, con una causa individuata nel sorgente ma non ancora risolta.

**Cosa è stato fatto:**

- **La correzione della Z è entrata in tutta la catena** — il problema aperto numero uno della v50. La convenzione vive ora in un punto solo, `Profile.zDaGradi()`, con `zTappo/zAlzata/zContatto` sopra: Z0 = tappo, Z−18,326 = alzata di lavoro, Z−21,271 = punta sul foglio. La prendono profilo, i due generatori, i pulsanti del pannello, il popup dell'altezza di contatto e la riga di avvio. Verificata sulla macchina: tutte e tre le quote raggiunte.
- **I versi dei due assi sono confermati sulla macchina**, con quattro jog da 25 mm. Chiude l'altro problema aperto della v50.
- **Prima stampa vera riuscita**: il vortice di quadrati, 18 quadrati, 4,4 m di tratto, una linea sola. Spessore costante, angoli netti, il cerchio centrale distinto dall'ultimo quadrato.
- Creati nove generatori/disegni nuovi (vedi File), fra cui la cornice dell'area utile con la procedura della penna dentro il file, la prova geometrica, il vortice, i medaglioni, l'intreccio.
- Scritta `misure/comandi-rapidi.md`, la scheda dei comandi che si usano davvero.

**Bug: le quote Z positive venivano troncate**

**Sintomo:** il servo non si muoveva pur avendo gli impulsi giusti nel `config.yaml`; qualunque `G0 Z<positiva>` non faceva niente.
**Causa:** senza homing FluidNC mette lo zero macchina in cima alla corsa e dichiara il resto in negativo (`Axis Z (-21.281, 0.010)`); `RcServo` mappa la posizione MACCHINA con `mapConstrain()`, che **tronca** invece di rifiutare. Ogni quota positiva finiva sullo stesso impulso, quello del tappo. `soft_limits: false` non c'entra: spegne i limiti del pianificatore, non quel troncamento.
**Fix applicato:** convenzione negativa in tutta la catena, `startup_line0: G90 G0 Z0`. **Verificato sulla macchina**, e il collaudo riverificato replay alla mano: 3025 stati confrontati col modello, zero differenze.

**Bug: «Upload filesystem inaccessible» a ogni caricamento**

**Sintomo:** ogni tentativo di caricare un file dalla WebUI rispondeva così, mentre la flash era sana e con spazio libero.
**Causa:** trovata leggendo il sorgente. Il messaggio esce da un punto solo, e l'`error_code` che lo scatena viene impostato **solo nel ramo SD** di `FluidPath` (`!config->_sdCard->config_ok`): per la flash quel costruttore non può fallire. Le rotte sono separate — `/files` è la flash, `/upload` è la SD — quindi l'upload veniva mandato alla SD, che con `cs_pin: NO_PIN` non esiste. Il messaggio diceva il vero.
**Fix applicato:** caricare dal pannello FLASH, oppure saltare del tutto la WebUI con `curl -T file http://IP/flash/nome` — la flash è montata anche in WebDAV, scrivibile, e PUT è fra i metodi dell'header `Allow`. **Verificato**, è la strada usata da lì in poi.

**Bug: la sequenza dell'origine era scritta al contrario, e con un numero impossibile**

**Sintomo:** nessuno — il difetto era nel documento, non sulla macchina.
**Causa:** due errori. Aritmetico: il jog «minimo» di riabilitazione era `$J=G91 X0.01 F100`, ma con 33,953 passi/mm **un passo vale 0,02945 mm**, quindi 0,01 fa 0,34 passi, arrotondati a zero — un jog che non muove niente, e non è detto che riabiliti niente. Di merito: qualunque jog **prima** del `G92` porta il carrello via dai blocchi, e lo zero finisce dove il carrello è arrivato; 0,1 mm sono il doppio della ripetibilità dell'appoggio.
**Fix applicato:** sequenza invertita — `$MD`, appoggio, `G92 X0 Y0`, poi `G90 G0 X5 Y5 F1000`, che è il movimento che riabilita i motori e i cui 5 mm sono contati. **Verificato in uso.**

**Bug: ogni programma finiva addosso ai blocchi**

**Sintomo:** l'ultimo movimento di ogni file generato era `G0 X0 Y0`, cioè esattamente il punto ai blocchi.
**Causa:** il generatore non leggeva il punto home, che nel profilo esiste da sempre proprio per questo — il commento accanto dice «un carrello fermo contro il riferimento prima o poi lo sposta».
**Fix applicato:** `Gcode.build` prende un `ritorno`, `Profile.puntoHome()` lo fornisce, tutti i file rigenerati finiscono a X5 Y5. **Verificato** con due asserzioni nuove, una sulla catena vera via `Artwork.prepare()`.

**Bug: righe di sola velocità che non muovono niente**

**Sintomo:** nei file usciva ogni tanto una riga `F3000` da sola.
**Causa:** quando un tratto comincia dove finisce il precedente, lo spostamento a penna alzata è un no-op e dell'intera riga resta solo la F — proprio la riga che la generazione modale dice di non emettere.
**Fix applicato:** soppressa in entrambi gli emettitori, **con l'accortezza che conta**: sopprimendo la riga lo stato modale della F non si aggiorna, se no la F successiva verrebbe omessa credendola già attiva. Il collaudo cala di 180 byte.

**Bug: il piano si alza sotto la staffa TT di sinistra**

**Sintomo:** nel primo disegno vero, alcuni tratti nell'angolo in alto a sinistra sono usciti spezzati, con la penna che perdeva il contatto e lo riprendeva.
**Causa:** trovata dall'operatore — il legno sotto al binario della staffa TT di sinistra si era alzato. Non alza la carta, alza il **portale**: la punta si solleva rispetto al foglio, che per la penna è identico a un piano che scende.
**Fix applicato:** sistemato dall'operatore. **Ne è uscita una proprietà della prova 11 del collaudo che non era scritta da nessuna parte:** quella prova misura i punti **alti** e non quelli bassi. I trattini si disegnano a quote crescenti, quindi dove la carta è più alta di `e` se ne contano fino a `e` a passi di 0,30; ma dove è più bassa — o dove è il portale a essere più alto — non segna **nessun** trattino, nemmeno quello a quota zero, e da lì in poi due decimi e due millimetri danno lo stesso risultato. Registrato in `misure/disegno-di-collaudo.md` col caso reale.

**Bug: due stampe lunghe si bloccano a metà e portano giù il server web — NON RISOLTO**

**Sintomo:** l'intreccio (6 min) si è fermato a circa il 90%, lo spirografo (18 min) a circa il 10%. In entrambi i casi la WebUI è diventata irraggiungibile, ricaricare la pagina non funzionava, ed è servito spegnere e riaccendere la macchina. I disegni erano corretti fin dove sono arrivati, quindi il G-code non c'entra.
**Causa (individuata nel sorgente, non confermata sulla macchina):** la casella comandi della WebUI crea un **canale nuovo per ogni comando** (`new WebClient()` su `/command`), e `$LocalFS/Run` restituisce `Error::Deferred` — il job **si tiene quel canale** come riferimento. La connessione HTTP del browser resta quindi aperta per tutta la durata del disegno, a fare da uscita del job. Quando il browser o lo stack TCP mollano scatta `onDisconnect`, che prova a distruggere il canale mentre il job lo tiene ancora; nel codice c'è perfino un ramo che logga «Could not queue HTTP command channel for deletion, leaking it». Le segnalazioni pubbliche confermano il pattern: crash sistematico lanciando dalla WebUI e meno frequente via USB, con `ESP_ERR_NO_MEM` nei log.
**Fix applicato: nessuno.** Proposto all'operatore di lanciare dalla **seriale USB** a scheda browser chiusa — il canale della UART non si disconnette mai — che è insieme la prova e il rimedio: se si ferma lo stesso, la seriale stampa il panic che finora ci manca.

**Decisioni prese:**

- **Contesto:** il rapporto mm/giro non è mai stato tarato ed è ancora il nominale 94,2478 (π × 30), un conto geometrico e non una misura; scala ogni quota disegnata, e nessun comando può rivelarlo perché il DRO legge passi diviso quel rapporto.
  **Decisione (dell'utente):** **non si tara.** Il criterio dichiarato è «se l'errore è sotto il millimetro mi va bene».
  **Correzione del 2026-10-23 21:40:** avevo scritto che il criterio era già soddisfatto, basandomi su un quadratino da 60 mm misurato 60,0 **col calibro**. L'operatore ha poi precisato che la misura è **col righello**, quindi la lettura vale ±0,5 mm e non ±0,05: il limite sull'errore passa dallo 0,08% allo **0,83%**, che sulla campata massima di 241 mm fa **2 mm** — il doppio del criterio, non un decimo. **Il criterio NON è dimostrato.** Si chiude con una misura sola, su carta già stampata: il lato della cornice da 240 mm di uno dei disegni fatti. A ±0,5 mm di righello quella campata limita l'errore allo 0,21%, cioè 0,5 mm sul massimo, e il criterio è soddisfatto davvero.
  **Alternative scartate:** una figura di taratura a coppie di linee parallele con avvicinamento monotono, già progettata ma non costruita.
  **Da rivedere se:** si volesse disegnare su quote assolute (fori, incastri, sovrastampe su stampato), o se una misura futura mostrasse scarti sopra il millimetro.
  Resta scritto `tarato: false` nel profilo, perché fra sei mesi si sappia che è un'assunzione.

- **Contesto:** il pignone del carrello X tocca la cremagliera dell'asse Y sul lato destro prima che il carrello arrivi in fondo. Interferenza misurata 5 mm, se ne tolgono 10 per stare larghi.
  **Decisione:** il numero va in un campo **suo**, `corse.<asse>.ostacolo`, non sommato al margine di sicurezza. Il margine copre l'**incertezza** e si riduce diventando più precisi; l'ostacolo è un impedimento **meccanico certo** e si toglie spostando la cremagliera. L'identità del glossario diventa percorribile + margine + ostacolo + scostamento = totale.
  **Alternative scartate:** portare il margine di sicurezza da 2 a 12 — fra sei mesi non si saprebbe più quali millimetri sono recuperabili.
  **Da rivedere se:** la cremagliera di Y viene spostata, o se l'interferenza viene rimisurata con calma (i 10 mm sono prudenziali sui 5 veri).

- **Contesto:** `max_travel_mm` nel `config.yaml` potrebbe seguire l'area utile o la corsa fisica.
  **Decisione:** resta la **corsa fisica**, perché quel campo descrive la macchina; a non uscire dal percorribile ci pensa l'interfaccia prima di generare un programma. Conseguenza pratica: il `config.yaml` sulla macchina non va ricaricato, cambiano solo commenti.
  **Da rivedere se:** si attivassero i `soft_limits`, che oggi sono spenti e renderebbero quel campo una protezione vera.

- **Contesto:** l'invio del G-code dal SLICER chiede di decidere dove gira il programma.
  **Decisione:** **deve essere servito dall'ESP32**, e non è una preferenza. Cercando `Access-Control-Allow-Origin` in tutto il server web di FluidNC: **zero occorrenze**. Senza CORS il browser blocca ogni richiesta da una pagina che non arriva dall'ESP32 stesso, e non è aggirabile dal nostro lato. I numeri tornano: partizione 196.608, WebUI di FluidNC 111.625, il nostro programma gzippato **62.539** — togliendo la sua WebUI restano ~113 kB liberi contro i 64 di adesso. Verificato nel sorgente che FluidNC serve da solo i `.gz` con `Content-Encoding: gzip`.
  **Alternative scartate:** tenere la pagina sul PC e parlare con la macchina — impossibile senza CORS.
  **Da rivedere se:** una versione futura di FluidNC aggiungesse le intestazioni CORS.
  **Rischio accettato:** senza la WebUI di FluidNC, un difetto del nostro programma lascia senza interfaccia grafica — ma non senza macchina: telnet sulla porta 23 e la USB restano, e la WebUI si può ricaricare.

- **Contesto:** il disegno di collaudo ha il campo largo 246 mm e l'area utile è scesa a 241,232.
  **Decisione:** **il collaudo è sospeso** finché non viene rifatta la disposizione della colonna di destra. Le sue scatole hanno coordinate assolute — `scalaX(1,1,244,17)`, `cerchi(173,20,72,72)`, `ripetibilita(149,171,96,23)` — quindi non basta cambiare `P.larghezza`. Aggiunta una guardia nel generatore che confronta il campo con l'area utile del profilo e **rifiuta di scrivere il G-code**; l'SVG lo fa comunque, perché serve a rifare la disposizione e un'immagine non manda un carrello contro niente. Tolto `gcode/collaudo.gcode`, che era già scritto e avrebbe portato il carrello 4,3 mm dentro l'ostacolo.
  **Da rivedere se:** la cremagliera di Y viene spostata e l'area torna a 251 — allora il collaudo com'è tornerebbe valido.

**Lavoro abbandonato rimasto in repository, da sapere:** fra le 19:50 e le 20:19 sono stati creati `trame.js`, `trifoglio.js` e `rosone.js` (cancellando il `medaglioni.js` appena fatto) più un primo `webui/tools/intreccio.js`, poi riscritto da `ac1a39b`. **Non era una sessione parallela:** l'operatore ha riavvolto la conversazione per risparmiare token, perché quei disegni non gli piacevano. Ma **riavvolgere la conversazione non annulla i commit**: i file sono ancora lì, e sono lavoro scartato. Restano in repository `webui/tools/{trame,trifoglio,rosone}.js` e `gcode/{onde,reticolo,trifoglio,rosone}.gcode` con i loro SVG. Da decidere se tenerli come materiale o toglierli.

**File consegnati/modificati:**
- `webui/js/profile.js` — `zDaGradi/zTappo/zAlzata/zContatto`, `puntoHome()`, campo `ostacolo`, `corsaPercorribile` che lo sottrae, migrazione per i profili salvati prima di oggi, due controlli nuovi in `verifica()`, blocco Z e `startup_line0` del `toYaml`
- `webui/js/gcode.js` — convenzione negativa documentata, `opt.ritorno`, soppressione delle righe a vuoto
- `webui/js/artwork.js`, `panel.js`, `popup.js`, `settings.js`, `state.js` — quote macchina, clamp dei passi relativi, soglia del popup contata dal contatto, readout delle tre quote Z
- `webui/index.html` — campi `ostacolo`, readout `quoteZ`, paragrafi di spiegazione
- `webui/tools/` — `cornice.js` (nuovo, generalizzato a rettangolo qualsiasi), `prova-geometrica.js`, `vortice.js`, `riempimenti.js`, `intreccio.js` (nuovi); `test-macchina.js` (guardia sull'area, emettitore allineato)
- `gcode/` — rigenerati tutti; nuovi `cornice`, `rettangolo-home`, `prova-geometrica`, `vortice`, `hilbert`, `spirografo`, `intreccio`, `quadrato-60`, `quadrato-60-diagonali`; **tolto `collaudo.gcode`**
- `firmware/fluidnc/cnc2d-config.yaml` — rigenerato
- `misure/comandi-rapidi.md` — nuovo
- `misure/accensione-e-taratura.md` — A3 riscritta con le quote negative, A4 con la prova del servo e la diagnosi dell'upload, sequenza dell'origine corretta, collaudo sospeso
- `misure/disegno-di-collaudo.md` — il lato cieco della prova 11, e l'avviso che il disegno non si può generare
- `misure/impostazioni-glossario.md` — tabella delle corse e identità con l'ostacolo
- `firmware/fluidnc/README.md`, `gcode/test/README.md` — convenzione Z

**Impatto su Vision/Pipeline:** aggiornati gli stati e le note di **Step 3** (FluidNC funziona, resta il blocco delle stampe lunghe), **Step 4** (la Z, il punto home, la decisione sull'ospitare il SLICER), **Step 5** (l'ostacolo che accorcia X) e **Step 6** (la procedura di inserimento penna funziona).

---

### [2026-10-22 17:18] (firmware) FluidNC è sulla macchina, e i primi comandi veri hanno trovato tre cose che nessun ragionamento aveva trovato

**Riepilogo:** installata FluidNC 4.1.1 sull'ESP32 montato, caricata e verificata riga per riga la configurazione generata dal profilo, e poi — appena si è provato a muovere qualcosa — sono saltati fuori il servo che non si muoveva (gli impulsi erano giusti, era il verso delle coordinate macchina a troncare tutto), i due assi che andavano al contrario tutti e due, e un vincolo di spazio in flash che nessuno aveva previsto e che il disegno di collaudo non rispettava.

**Cosa è stato fatto:**

- **FluidNC 4.1.1 installata** sull'ESP32 montato: variante wifi, fresh-install, WebUI-2. La dashboard è stata cancellata, come previsto
- **Configurazione caricata e verificata con `$CD`**, chiave per chiave: `steps_per_mm` 33.952999 sui due assi, `max_travel_mm` 253.231995 e 238.063995, `rc_servo` su gpio.32 con 2222 e 1500, `max_travel_mm` 21.271 su Z, `startup_line0: G90 G0 Z21.271`, `must_home: false`. **Nessuna chiave ignorata**: il timore dei commenti in coda era fondato ma il file generato è pulito
- **Rete configurata**: STA, hostname `cnc2d`, IP 192.168.1.14, mDNS attivo. Suggerito di mettere il country a `IT` invece di `01`, perché il dominio «mondo» ammette solo i canali 1÷11 e in Europa i router usano spesso il 12 o il 13 — con `01` l'ESP32 non vedrebbe proprio la rete
- **La riga di avvio funziona**: al boot la Z è a 21.270 nel modello, cioè `startup_line0` è stata eseguita
- **Disegno di collaudo e generatore del SLICER riscritti in G-code modale**, per stare nei 64 kB di flash liberi (vedi il bug più sotto)
- **Misurato quanto pesa il SLICER** in vista dell'autonomia dall'interfaccia di FluidNC: 66 kB compressi contro 64 liberi. Non ci sta accanto alla WebUI di FluidNC, che da sola ne occupa 111

**Bug: il servo non si muoveva, e gli impulsi erano giusti**

**Sintomo:** `G0 Z0`, `G0 Z2.945`, `G0 Z21.271` venivano eseguiti — il DRO mostrava le rampe e le quote giuste — ma la penna restava immobile. I 12 V erano accesi e il circuito non era stato toccato.
**Causa:** `RcServo` di FluidNC mappa la **posizione macchina in passi**, non la quota di lavoro, fra i limiti dell'asse, e **tronca** quello che cade fuori (`mapConstrain`). Senza homing FluidNC mette lo zero macchina all'estremo alto e dichiara la corsa in negativo: `Axis Z (-21.281, 0.010)`, cioè `_min_steps = -2128`, `_max_steps = +1`. Tutte le quote che comandavamo (0 … +21.271) cadevano al massimo o sopra, quindi uscivano **tutte a 1500 µs**, che è la posizione tappo. Il servo faceva esattamente quello che gli veniva chiesto: stare fermo.
**Fix applicato:** nessuno ancora nel codice — **la correzione è da fare** (vedi Problemi aperti). Diagnosi **confermata sulla macchina** con `G0 Z-3`, che cade all'85,9% del campo, dà 1602 µs e muove la penna di una decina di gradi. La strada è usare la Z in negativo: `Z0` = posizione tappo, `Z-18.326` = penna alzata, `Z-21.271` = contatto. Gli impulsi nel `config.yaml` restano quelli: è il verso dei numeri che li raggiunge a essere sbagliato.

**Bug: i due assi andavano al contrario tutti e due**

**Sintomo:** `$J=G91 X25` porta il carrello **verso** il suo blocco invece che via; su Y è il meno a fare quello che dovrebbe fare il più.
**Causa:** nessuno dei due versi era mai stato provato con FluidNC. Il `:low` su X era una deduzione — il file stesso lo diceva, *«da confermare al primo avvio guardando il verso»* — e su Y mancava.
**Fix applicato:** invertite tutte e due le spunte nel profilo (X da sì a no, Y da no a sì), `config.yaml` rigenerato. **Da riprovare sulla macchina.**

**Bug: il disegno di collaudo non entrava nella flash**

**Sintomo:** il browser dei file dichiara **64 kB liberi**; il collaudo scritto per esteso ne occupava 69.268. Non ci sarebbe entrato, e lo si sarebbe scoperto a configurazione finita.
**Causa:** la partizione LittleFS è 192 kB e `index.html.gz` della WebUI ne occupa da sola 111.
**Fix applicato:** i due generatori emettono **G-code modale** — solo quello che cambia: la parola G0/G1 resta valida finché non cambia, una coordinata non ripetuta vuol dire «quell'asse resta dov'è», gli zeri in coda si tolgono, e una riga che non cambierebbe niente non si emette affatto. Il collaudo passa da 69.268 a **44.633 byte**. Verificato ri-eseguendo il file con un interprete e confrontando i **2994 stati** con quelli del modello: zero differenze.

**Bug: il flash si interrompeva all'1%**

**Sintomo:** l'immagine da 1,1 MB si fermava all'1% e la scheda restava in boot loop. I file piccoli passavano con l'hash verificato.
**Causa:** il convertitore USB è un **CH340** (`VendorID 0x1a86 ProductID 0x7523`) e a 921600 non regge i trasferimenti lunghi. Lo dice esptool stesso due righe dopo il cambio di baud.
**Fix applicato:** rifatto a **115200**, riuscito. Registrata in A4 la scala di rimedi (cavo corto e porta diretta, poi ESP32 sfilato dalla breadboard) e la nota che conta per chi si spaventa: una scheda interrotta a metà flash non è rotta.

**Decisioni prese:**

- **Contesto:** c'è un secondo ESP32 con FluidNC già installato dal 2026-09-21, e sembrava una scorciatoia.
  **Decisione: si flasha quello montato.** Il `config.yaml` va caricato comunque — quello sul vecchio è di settembre, con `steps_per_mm: 80` e `max_travel_mm: 300` — e il circuito è stato rifatto attorno alla scheda montata, i cui pin sono provati contro questo cablaggio da settimane. Si risparmiavano tre minuti e si rischiava una scheda non verificata su quindici connessioni verificate.
  **Da rivedere se:** la scheda montata dà problemi hardware. Il vecchio ESP32 resta come scorta, e volendo ci si flasha la dashboard per avere lo strumento di misura pronto senza toccare la macchina.

- **Contesto:** l'ultima versione era la 4.1.1, mentre la configurazione era validata sulla 4.1.0.
  **Decisione: 4.1.1.** Il changelog la giustifica: è una patch sulla 4.1.0, nessuna voce tocca i nomi dei campi, e **tre correzioni cadono dentro quello che usiamo** — un bug di generazione dei comandi macro (`Macro::addf`, va_list riusata), un descrittore di upload non rilasciato quando un trasferimento viene abbandonato, e i riavvii del watchdog durante le operazioni sui file. La riga di avvio del servo è una macro e i programmi si caricano dalla WebUI.
  **Alternative scartate:** prendere la 4.1.0 per prudenza. La regola «non l'ultima per inerzia» resta, ma qui il changelog l'ha sciolta invece di confermarla.

- **Contesto:** l'utente ha chiesto quando potrà usare l'interfaccia del progetto invece di quella di FluidNC.
  **Decisione: prima le stampe dalla WebUI di FluidNC, poi il pannello nostro.** Il disegno di collaudo valida tutti i numeri misurati in una settimana: mettere fra l'operatore e la macchina un'interfaccia mai provata vorrebbe dire, al primo disegno storto, non sapere se è la macchina o il software nuovo.
  **Alternative scartate:** collegare subito il SLICER. Oltre al rischio di debug doppio, c'è un vincolo fisico — FluidNC non manda le intestazioni CORS, quindi la pagina deve essere servita dall'ESP32, e il SLICER compresso pesa 66 kB contro 64 liberi.
  **Da rivedere se:** la 4.1.1 nel frattempo manda le intestazioni CORS. Sono trenta secondi di prova e farebbero sparire tutto il problema dello spazio, perché la pagina girerebbe dal PC.

**Problemi aperti a fine sessione:**

1. **La correzione della Z in negativo non è ancora nel codice.** Vanno aggiornati: i due generatori di G-code, `startup_line0` (da `G90 G0 Z21.271` a `G90 G0 Z0`), la quota di contatto nei popup, e i file `gcode/collaudo.gcode` e `gcode/quadrato-50.gcode` già generati. **Finché non è fatto, nessuno dei due programmi disegna**: la penna resterebbe in posizione tappo per tutto il percorso.
2. **L'inversione dei due assi è da riprovare** sulla macchina col `config.yaml` nuovo.
3. **La prova che i motori restano alimentati** (`idle_ms: 255`) non è stata fatta: jog, dieci secondi, e il carrello deve resistere alla mano.
4. **Ospitare il SLICER** chiede di impacchettarlo in un file solo e di togliere la WebUI di FluidNC per fare spazio — con la conseguenza che il nostro pannello dovrà saper caricare i programmi, non solo muovere gli assi.

**File consegnati/modificati:** `webui/js/profile.js`, `webui/js/gcode.js`, `webui/tools/test-macchina.js`, `firmware/fluidnc/cnc2d-config.yaml`, `misure/accensione-e-taratura.md`, `gcode/collaudo.gcode`, `gcode/collaudo.svg`, `gcode/quadrato-50.gcode` (nuovo)

**Impatto su Vision/Pipeline:** note aggiunte allo **Step 3** (FluidNC installata e configurata sulla macchina definitiva, versi corretti, il bug della mappatura del servo) e allo **Step 4** (G-code modale per il vincolo dei 64 kB, e il conto che dice perché il SLICER non ci sta accanto alla WebUI).

---

### [2026-10-22 14:35] (meccanica+software) La misura del gioco d'ingranamento viene scartata, e la macchina è pronta per FluidNC

**Riepilogo:** l'utente ha contestato la misura del gioco d'ingranamento che avevo proposto — «abbiamo deciso che la penna scrive con la forza del servo, non col suo peso» — e aveva ragione: il documento di progetto dice esattamente quello, e la mia procedura si basava su un'architettura che il CAD non ha costruito. La misura è stata tolta; al suo posto resta scritto perché non si fa. Generato il disegno di collaudo coi numeri veri, e riscritta la procedura di flash di FluidNC.

**Cosa è stato fatto:**

- **Tolto il passo A2.1** (misura del gioco d'ingranamento col calibro) e sostituito con una nota che dice perché non c'è, così non torna in lista fra un mese
- **Generato `gcode/collaudo.gcode`** con i numeri veri: contatto Z0, alzata Z2.945, tappo Z21.271. Verificato che tutte le coordinate stiano dentro la corsa percorribile — occupa 245,5 × 232,5 su 251,2 × 236,1, cioè 5,7 mm di margine su X e 3,6 su Y
- **Il generatore del collaudo alza la penna in posizione tappo a fine programma**, come fa il SLICER
- **A4 riscritto** con quello che conta davvero al primo avvio di FluidNC: `$CD` per rileggere la configurazione (il parser ignora le chiavi commentate in coda e non dà errore), il verso degli assi col `:low` su X mai provato, e la prova del servo nei due versi
- **Nuovo passo A4.1: la prima stampa non è il collaudo.** Origine a mano, un quadrato da 50 mm, e solo dopo i venti minuti del disegno grande

**Bug (mio): avevo proposto una misura basata su un'architettura che non esiste**

**Sintomo:** avevo scritto una procedura per misurare col calibro i 0,30 mm di gioco d'ingranamento, dicendo che «la penna appoggia col proprio peso». L'utente ha obiettato che la penna scrive con la forza del servo.
**Causa:** la frase era giusta per l'architettura a due stadi con il giunto a gioco morto da 6 mm — che il CAD **non ha costruito**. Il modulo reale è a presa rigida, come `modulo-penna/schema.html` dice dal 2026-10-17: *«la quota della punta è l'angolo del servo, in presa rigida nei due versi»*. La penna galleggia solo dentro i 0,30 mm, che sono **0,92° di servo** contro una banda morta del servo di ~0,9°: una finestra larga un passo, in cui non ci si può mirare.
**Fix applicato:** procedura tolta. Verificato rileggendo `schema.html` e la decisione del 2026-10-17 nello storico.

**Decisioni prese:**

- **Contesto:** restava da decidere se misurare il gioco d'ingranamento del pen-lift, ultimo numero del modulo non rilevato.
  **Decisione dell'utente, accolta: non si misura.** Tre motivi: nessuna impostazione dipende da quel numero; 0,30 mm a mano hanno un errore paragonabile alla quantità; e soprattutto la condizione che ci farebbe agire — *il tratto cambia spessore secondo il punto del foglio*, dalla decisione del 2026-10-17 — chiede **un altro numero**, cioè quanto è fuori piano la tavola.
  **Cosa fa lo stesso lavoro:** la prova 7 e la prova 11 del disegno di collaudo, che misurano la stessa cosa sulla carta e con la penna vera.
  **Da rivedere se:** la prova 11 mostra il tratto che cambia spessore. Allora si misura la planarità della tavola, non il gioco.

- **Contesto:** l'utente ha chiesto se deve riflashare la dashboard prima di FluidNC.
  **Decisione: no.** Il pulsante *Tappo* e il fondo scala della battuta servono solo finché la dashboard c'è, e flashare FluidNC la cancella. Quello che resta — profilo, `config.yaml`, popup del SLICER — ha già tutto.
  **Resta però una verifica da fare con la dashboard attuale, prima di perderla:** che a 90° lo stadio flottante sia ancora dentro le guide. Quel numero è `max_pulse_us` e la riga di avvio: se è ottimista, a ogni accensione FluidNC ci va contro.

**Errore di data (mio, quinta volta su questo progetto):** scritto `15:05` nell'intestazione e nel titolo della voce prima di chiedere l'ora al sistema, che diceva 14:35. Corretto prima del commit. La regola resta quella di sempre e continuo a saltarla: **l'ora si chiede, non si stima.**

**File consegnati/modificati:** `misure/accensione-e-taratura.md`, `webui/tools/test-macchina.js`, `gcode/collaudo.gcode` (nuovo), `gcode/collaudo.svg` (nuovo)

---

### [2026-10-22 14:20] (meccanica+software) La battuta misurata smentisce il montaggio, nasce la posizione tappo, e FluidNC non accetta i commenti che il nostro config.yaml aveva dappertutto

**Riepilogo:** la prova della striscia di carta dice che la battuta è 17 e non i 19 calzati al montaggio; è nata la posizione tappo a 90°, che fa due lavori (riposo e tetto del meccanismo) e che ha costretto a riaprire la mappatura dell'asse Z di FluidNC; e cercando la sintassi delle righe di avvio è saltato fuori che **FluidNC non accetta commenti in coda a una chiave**, cosa che il nostro `config.yaml` faceva su quasi ogni riga.

**Cosa è stato fatto:**

- **Battuta misurata 17°** con la striscia di carta (l'utente). Supera i 19 fissati per costruzione il 2026-10-21: i due gradi sono quello che il modulo aveva ancora da scendere quando il pignone è stato calzato. I 25° di penna abbassata **non si toccano** — non sono battuta + 6 ma l'angolo a cui la penna è stata stretta, e il disegno a mano del 2026-10-22 lo conferma; semplicemente ora sono battuta + 8, con più riserva verso il basso di quanta ne era prevista
- **Posizione tappo a 90°**, su richiesta dell'utente: la penna ci sale a fine stampa e all'accensione, e c'è spazio per infilare il tappo senza toglierla dai morsetti. Novanta è anche il massimo prima che lo stadio flottante esca dalle guide, quindi lo stesso numero è pure il **tetto** del meccanismo e sostituisce il `PEN_CORSA_SU` di ieri
- **Dashboard:** pulsante *Tappo*, campo dell'angolo in tab Motore, avviso visibile finché la penna è lassù, e **conferma obbligatoria prima di farla scendere** — perché col tappo infilato al foglio ci arriva il tappo
- **SLICER:** `gradiTappo` nel profilo, `tappoMm()`, fine programma che sale al tappo dopo il ritorno all'origine, e il promemoria del tappo nel primo e nel secondo popup di stampa
- **`cnc2d-config.yaml` scritto a mano eliminato**: ora nel repository c'è la copia generata dal profilo. Quello a mano era rimasto indietro di parecchio — `max_travel_mm: 300` su tutti e due gli assi e `direction_pin` senza `:low` su X
- 202 asserzioni verdi su sei suite, firmware compilato

**Bug: il config.yaml aveva commenti che FluidNC non sa leggere**

**Sintomo:** nessuno ancora — FluidNC non è mai stato acceso sulla macchina. Trovato cercando la sintassi delle righe di avvio.
**Causa:** il parser YAML di FluidNC è un sottoinsieme: accetta righe che cominciano con `#` ma **non commenti in coda a una coppia `chiave: valore`**. Una riga come `max_travel_mm: 21.271   # dal contatto al tappo` gli fa ignorare la chiave. Il nostro file, generato e scritto a mano, lo faceva quasi ovunque — compresi `steps_per_mm`, `max_travel_mm` e i due impulsi del servo.
**Fix applicato:** `toYaml()` riscritto, ogni commento su una riga sua, e un'asserzione in `ui-test` che fallisce se ne ricompare uno in coda. Verificato leggendo un `config.yaml` reale di un'altra macchina, che infatti non ne ha nessuno. Da confermare al primo avvio di FluidNC.

**Bug (mio): avevo scritto che 90° erano oltre il fermo meccanico**

**Sintomo:** nella voce di ieri e in un commento del firmware c'era scritto che i 90° di fabbrica di «penna alzata» erano «55° oltre il fermo meccanico superiore».
**Causa:** conto sbagliato. La corsa della guida è 80,5°, la battuta sta a 17, quindi il fermo è a 97,5 e 90 ci sta dentro — è anzi proprio la posizione tappo. Non c'era nessuno stallo.
**Fix applicato:** corretti il commento nel firmware e la voce di ieri (segnalata la discrepanza qui, senza riscriverla). La decisione di portare i valori di fabbrica a 34/25 resta giusta, ma per un altro motivo: sono gli angoli veri di lavoro.

**Errore di data (mio, quarta volta su questo progetto):** avevo scritto `2026-10-23` in sei punti fra firmware, profilo e procedura, senza chiedere l'ora al sistema. Corretti tutti a `2026-10-22` prima del commit.

**Decisioni prese:**

- **Contesto:** la posizione tappo è 21,3 mm sopra il contatto, mentre l'arco dichiarato a FluidNC arrivava solo all'alzata di lavoro (2,9 mm). `mapConstrain` tronca tutto quello che cade fuori, quindi il tappo sarebbe stato irraggiungibile.
  **Decisione:** l'estremo alto dell'asse Z diventa **la posizione tappo**, e l'alzata di lavoro una quota intermedia. `max_travel_mm: 21.271`, `min_pulse_us: 2222` (contatto), `max_pulse_us: 1500` (tappo).
  **Alternative scartate:** mettere Z0 **al tappo** e il contatto in fondo, che avrebbe risolto anche il tuffo all'accensione — scartata perché inverte il verso di Z rispetto alla convenzione CNC, e un G-code in cui Z cala mentre la penna sale si paga più avanti.
  **Da rivedere se:** il tuffo all'accensione (FluidNC parte assumendo Z0, cioè il contatto, e il servo ci va per un istante prima di eseguire `startup_line0`) si rivela un problema vero sulla macchina.

- **Contesto:** servivano gli avvisi sul tappo, e un avviso che non si legge non serve.
  **Decisione:** tre punti, non uno. La dashboard mostra un avviso e **chiede conferma prima di abbassare**; il primo popup di stampa lo dice in testa, prima di tutto il resto; il `config.yaml` lo scrive nel commento della riga di avvio, con la regola pratica — **il tappo si toglie prima di dare corrente**.

**File consegnati/modificati:** `firmware/cnc2d_dashboard/cnc2d_dashboard.ino`, `firmware/fluidnc/cnc2d-config.yaml` (ora generato), `webui/js/profile.js`, `webui/js/gcode.js`, `webui/js/artwork.js`, `webui/js/popup.js`, `misure/accensione-e-taratura.md`, `misure/impostazioni-glossario.md`

**Impatto su Vision/Pipeline:** una nota in **Step 6** con la battuta misurata, la posizione tappo e il bug del parser.

---

### [2026-10-22 13:30] (meccanica) Il CAD con il modulo penna montato, letto numero per numero: dove sta la punta e quanta aria c'è sotto

**Riepilogo:** letto il primo assieme STEP che contiene il modulo penna — ricostruiti albero, trasformazioni e posizioni dai vertici, senza kernel CAD — e ricavati i tre numeri che mancavano: l'asse della penna (X −198,01 · Y −215,78), lo sbalzo in Y (70,47 mm dalla mezzeria del carrello), e il punto più basso della testina (Z 26,68 sopra la tavola, non più i 2,5 mm di franco che si calcolavano con la piattaforma).

**Cosa è stato fatto:**

- **Scritto un lettore di assiemi STEP** (`asm.py` nella cartella di lavoro): ricostruisce l'albero da `NEXT_ASSEMBLY_USAGE_OCCURRENCE`, compone le trasformazioni da `ITEM_DEFINED_TRANSFORMATION` e riporta nel mondo i vertici di ogni pezzo. Serviva perché le rappresentazioni dei pezzi sono vuote e il solido vive in una `ADVANCED_BREP_SHAPE_REPRESENTATION` separata, agganciata da una `SHAPE_REPRESENTATION_RELATIONSHIP`
- **Fissato il sistema di riferimento:** la faccia superiore della tavola è **Z = 0**, la tavola è 700 × 600 × 20. Controprova che la lettura è giusta: il punto più basso del carrello X esce 46,68, lo stesso numero del 2026-10-06
- **Trovato l'asse della penna senza che la penna sia modellata**, dalla sede a V su `pz2`: bocca 10,00, profondità 3,00, e i punti di tangenza di un cerchio Ø10 cadono esattamente sulla bocca — la sede è disegnata per il Tratto Pen. Stessa cosa sulla V del morsetto, che nel CAD è aperta di 3,46 mm
- **Misurato lo sbalzo:** in X la punta è a +7,67 dalla mezzeria del carrello, praticamente centrata; in Y è a **−70,47**, cioè 50,94 mm oltre la faccia vicina della trave. Tutto lo sbalzo è sull'asse motorizzato da un lato solo, quindi è il braccio che moltiplica l'imbardata: è quello che misura la prova 2 del collaudo
- **Stimata la zona di disegno sulla tavola**: X −206,20 … 49,89, Y −217,91 … 25,16, tutta dentro la tavola col lato stretto davanti (32,8 mm). Dichiarata l'incertezza: ±2 mm, perché dipende da quali facce toccano i blocchi, dedotte dalla geometria e non misurate
- Aggiornato il commento in `profile.js` che citava ancora 249,5 × 235,0: la corsa percorribile è **254,09 × 241,04**
- Scritto `misure/cad-assieme.md` con tutte le quote e una tabella di posizioni da cui ripartire al prossimo CAD

**Decisioni prese:** nessuna nuova — la lettura conferma e quantifica quelle del 2026-10-21.

**Note sull'assieme ricevuto:** l'utente ha spostato la cremagliera dell'asse X (nel CAD `cremagliera Y`) e di conseguenza il blocco dell'asse Y, perché prima la punta usciva dalla zona di tavola su cui può appoggiare il foglio. La lettura conferma che ora ci sta. L'utente ha anche avvisato che **i nomi dei pezzi nel CAD sono quelli vecchi e non seguono la convenzione del progetto**: verificato, `blocco  sx asse Y` è il blocco dell'asse X, `blocco front X` quello dell'asse Y, `cremagliera Y` è la cremagliera dell'asse X. Le posizioni sono giuste. La tabella di traduzione è in `misure/cad-assieme.md`.

**Conferme su numeri già registrati:**

- l'**A4 non entra in nessun orientamento**: chiede 297 mm in un verso e il più lungo è 254. Il `foglio A4` nel CAD è un riferimento, non un formato stampabile — sborda di 33 mm a sinistra, 7,5 a destra, 3,8 davanti
- il vincolo sul fissaggio del foglio è quello registrato ieri: non la testina (26,68 mm, o 16,68 a fondo corsa dello stadio flottante) ma **l'alzata della penna, 2,945 mm**

**File consegnati/modificati:** `misure/cad-assieme.md` (nuovo), `webui/js/profile.js`

**Impatto su Vision/Pipeline:** una nota in **Step 6** con i numeri della punta e il rimando al documento.

---

### [2026-10-21 22:34] (meccanica+software) I tre angoli del servo diventano numeri veri, e la piattaforma da 44 mm viene eliminata

**Riepilogo:** il pignone del pen-lift è stato ricalzato sull'albero del servo per portare la battuta da 1° a 19° e rientrare nella specifica elettrica dell'SG90; i tre angoli 19/25/34 sono entrati nel profilo, nel `config.yaml` e nei valori di fabbrica della dashboard, dove la battuta è diventata un fondo scala invariabile; e l'utente ha eliminato la piattaforma da 44 mm, correggendo una procedura che gli chiedeva di tarare contro un piano che non esiste.

**Cosa è stato fatto:**

- **Battuta spostata da 1° a 19°** ricalzando il pignone sull'albero: servo a 19 dalla pagina, modulo appoggiato ai blocchi sotto il suo solo peso, pignone calzato. La battuta è quell'angolo **per costruzione**, non per misura. Alla domanda se fosse meglio mettere prima il numero e poi incastrare, o il contrario: prima il numero, sempre — è l'unico modo di avere una battuta nota senza doverla cercare
- **Chiarito che 19 non è un bersaglio ma il centro di una finestra**: qualunque battuta fra 13° e 30° tiene tutta la corsa di lavoro dentro i 500÷2400 µs dell'SG90, e l'incastro è quantizzato (~19° per spline) quindi sul numero esatto non ci si cade
- I tre angoli **19 / 25 / 34** (2289 / 2222 / 2122 µs) scritti nel profilo del SLICER, nel `cnc2d-config.yaml` scritto a mano (`min_pulse_us` 2222 > `max_pulse_us` 2122, voluto; `max_travel_mm` 2.945, cioè Z in millimetri veri di penna) e nel default `--alzata` del generatore del disegno di collaudo
- **La battuta è ora un fondo scala nella dashboard**: campo dedicato salvato in NVS, `servoGoTo()` che tronca lì, e i soli pulsanti ±1° che scendono di 2° sotto per la verifica con la striscia di carta
- **Badge di provenienza differenziati** per i tre angoli — «al montaggio», «imposto», «calcolato» — perché dire «misurato» a tutti e tre racconterebbe una cosa falsa a chi rilegge il profilo fra un mese
- **A2 riscritto** col metodo per costruzione e le due avvertenze (non premere mentre incastri, non mettere un angolo troppo basso); **A3 corretto**, perché la formula era ancora quella senza inversione; tabella di stato del documento allineata
- 189 asserzioni verdi su sei suite, firmware compilato

**Bug: la penna alzata di fabbrica era oltre il fermo meccanico**

**Sintomo:** a ogni avvio con NVS vergine il servo andava in stallo contro il fine corsa superiore della guida.
**Causa:** `penUpDeg` di fabbrica era 90 gradi logici. La corsa della guida è 26,350 mm = 80,5° di servo, quindi 90 sono **55° oltre il fermo** una volta che la battuta sta a 19.
**Fix applicato:** valori di fabbrica portati a 34 e 25, e tetto a battuta + 80° applicato in `servoGoToLimite()` e sugli slider della pagina. Da confermare sulla macchina al prossimo flash.

**Bug: la procedura di taratura chiedeva un piano che non esiste**

**Sintomo:** il passo A2 diceva di stringere la penna contro uno spessore da 44 mm. Segnalato dall'utente: «nel modello non ci sono e mi sembra che te li sia inventati».
**Causa:** mia. I 44 mm vengono dalla decisione del 2026-10-06 di costruire una **piattaforma** alta 44 mm, mai costruita; riscrivendo A2 ho proposto uno spessore come suo sostituto invece di chiedermi se la piattaforma servisse ancora. Nel documento era scritto nero su bianco che non era stata costruita, e c'era anche la nota del 2026-10-15 che diceva che la quota assoluta non è un vincolo perché a regolarla è la penna che scorre nei morsetti.
**Fix applicato:** A2 ora dice la regola in una riga — il riferimento è il piano su cui il foglio appoggerà davvero quando stampi — e spiega da dove venivano i 44 mm. Verificato: l'utente ha confermato che il piano è unico e la penna lo raggiunge.

**Decisioni prese:**

- **Contesto:** dopo la scoperta che a 1° l'impulso cade fuori specifica, bisognava decidere se spostare il pignone o convivere con la battuta dov'era.
  **Decisione:** spostare il pignone e **mettere il numero nel pannello prima di incastrare**. 19° logici.
  **Alternative scartate:** tenere 1° e misurare dove comincia la zona morta (si sarebbe lavorato per sempre al limite elettrico del servo); riscrivere `SERVO_US_MIN/MAX` per rimappare l'1° su un impulso sano (cambia l'etichetta, non la fisica: il pignone sarebbe rimasto calzato col servo contro il proprio fermo interno).
  **Da rivedere se:** si rismonta il pignone dall'albero, o si cambia servo.

- **Contesto:** la piattaforma da 44 mm era in progetto dal 2026-10-06 e nessuno l'aveva più messa in discussione dopo che il modulo penna è stato disegnato.
  **Decisione dell'utente:** **la piattaforma è eliminata.** Col modulo Tratto Pen attaccato alla testina dell'asse X lo spazio verticale libero è meno di 40 mm, quindi non ci starebbe sotto. Il piano resta unico: la tavola.
  **Supera la decisione del 2026-10-06**, che la dava come necessaria — il vincolo da cui nasceva (carrello Y a Z 46,68) riguardava il carrello, non il modulo penna, che allora non esisteva.
  **Conseguenza registrata:** l'argomento del 2026-10-20 contro calamite e mollette («2,5 mm fra piano carta e carrello») non regge più come scritto; a mordere è ora l'alzata della penna, 2,945 mm. Stesso ordine di grandezza, stessa decisione: nastro di carta, da rivedere dopo la prova 11 del collaudo.

**File consegnati/modificati:** `firmware/cnc2d_dashboard/cnc2d_dashboard.ino`, `firmware/fluidnc/cnc2d-config.yaml`, `webui/js/profile.js`, `webui/js/settings.js`, `webui/tools/test-macchina.js`, `misure/accensione-e-taratura.md`, `misure/impostazioni-glossario.md`

**Impatto su Vision/Pipeline:** due note aggiunte — in **Step 6** l'eliminazione della piattaforma con il motivo e la conseguenza sulla taratura, in **Step 5** il cambio di natura del vincolo sul fissaggio del foglio.

---

### [2026-10-21 16:01] (meccanica+software) Il modulo penna è montato, il servo gira al contrario, e il disegno di collaudo diventa lo strumento che misura tutta la macchina

**Riepilogo:** costruito il disegno di collaudo — undici prove in riquadri numerati su una stampa sola — e montato il modulo penna, che si rivela **invertito**: più gradi, penna più in basso. Risolto convertendo in un punto solo per lato della catena, mentre la prima taratura della battuta finisce fuori dalla specifica elettrica del servo e resta da rifare.

**Cosa è stato fatto:**

- **Due pulsanti da un grado per il servo**, su richiesta dell'utente. Il grado è il passo giusto non per comodità ma perché **è la banda morta dell'SG90**: 10 µs su 2000 per 180°, cioè 0,90° — un comando da mezzo grado può non produrre nessun movimento. Trascinando lo slider si perde il conto, premendo si sa sempre a che angolo si è
- **Disegno di collaudo** (`webui/tools/test-macchina.js`): una stampa su 246 × 233 mm da cui si tirano fuori undici cose. Prima versione a zone libere, poi **riorganizzato in riquadri numerati** su richiesta dell'utente, col numero in una casella all'angolo che rimanda al documento di lettura
- **Due prove aggiunte, chieste dall'utente:** la **ripetibilità** (otto volte la stessa tacca arrivando da lontano, due colonne — una sempre dallo stesso verso, una alternata, e la differenza fra le due bande è una **seconda lettura del gioco** indipendente da quella del pettine) e la **velocità** (quattro righe a 600÷4800 mm/min fra due verticali: una riga che non tocca la verticale ha perso passi). Le righe sono lunghe 100 mm perché con 200 mm/s² servono 16 mm solo per arrivare a 80 mm/s, e su un tratto corto la prova non misurerebbe niente
- **Alfabeto a tratto singolo** (`webui/tools/font-tratto.js`): un font da stampa è fatto di contorni, e una penna che ripassa un contorno disegna una lettera vuota, illeggibile sotto i 6-7 mm
- **Riordino col vicino più prossimo** nel generatore: gli spostamenti a vuoto scendono da 6522 a 2306 mm. I tratti con un avvicinamento imposto non si rovesciano, perché il loro verso di arrivo *è* la misura
- **`misure/disegno-di-collaudo.md`**: cosa misurare, con che strumento, il conto da fare e cosa significa ogni risultato possibile, prova per prova. In cima l'**ordine di lettura**, che non è l'ordine dei numeri — livello e stacchi per primi, perché se il piano è storto tutto il resto è misurato male
- **Passo A2 riscritto** sulla nuova logica: **una misura sola, due conti e un gesto**. La battuta si misura con una striscia di carta fra cuscinetto e blocco invece di aspettare che il servo ronzi, e si segna l'ultimo grado in cui la carta esce ancora, che è il valore conservativo
- **Modulo penna montato dall'utente**, cuscinetti compresi. Riferito: accoppiamento cremagliera/pignone buono, cuscinetti che scorrono con gioco vicino a zero
- **Tavola di base confermata 600 × 700**, come già registrato il 2026-10-12. L'utente l'aveva ricordata 800 × 700: verificato sul documento prima di prenderla per buona
- Verificato **sul sorgente di FluidNC** (`RcServo.cpp`) che l'inversione di un servo si fa **scambiando `min_pulse_us` e `max_pulse_us`**, e che la mappatura è un `mapConstrain` lineare senza controlli sull'ordine dei due estremi. Da cui discende anche che **FluidNC non può comandare il servo fuori da quei due estremi**, qualunque Z arrivi dal G-code

**Bug: il servo va al contrario**

**Sintomo:** premendo «Alza penna» la penna scende, e viceversa.
**Causa:** l'accoppiamento del modulo montato esce invertito rispetto a quello che tutto il progetto dava per scontato: facendo crescere l'angolo fisico del servo la penna **scende**.
**Fix applicato:** si poteva convivere con due convenzioni opposte — il meccanismo in un verso e il resto del progetto nell'altro — e sarebbe stato il modo sicuro di sbagliare un segno fra sei mesi. Invece la conversione sta **in un punto solo per ciascun lato**: `servoApply()` nel firmware, `gradiToUs()` nel profilo. Da lì in avanti i gradi che si vedono, si salvano e si mettono nel profilo sono **logici** — più gradi = penna più in alto — e resta valida ovunque la regola `battuta < abbassata < alzata`. Una spunta per lato, entrambe attive di default, con scritto che devono concordare: se non vanno d'accordo, la dashboard alza e FluidNC abbassa. **Verificato dall'utente** dopo il flash.

**Bug: la prima taratura della battuta cade fuori dalla specifica elettrica del servo**

**Sintomo:** l'utente ha calettato l'ingranaggio con il modulo appoggiato ai blocchi e il servo comandato a **1° logico**, per una ragione corretta: così un comando errato verso lo zero può superare il fermo meccanico di un solo grado invece che di venti.
**Causa:** a 1° logico il firmware manda **2489 µs**, e l'SG90 è specificato 500÷2400. L'ingranaggio è quindi stato inserito con il servo **già contro il proprio fermo interno**, non in una posizione controllata. Conseguenze: i primi gradi della scala sono morti, e «penna abbassata» a 7° finirebbe appiccicata a quella zona morta. Non è inoltre accertato se il modulo avesse smesso di scendere per i cuscinetti o per il servo — la prova della striscia di carta, che li distingue, non è stata fatta.
**Fix applicato: nessuno, in attesa di decisione dell'utente.** Proposta: spostare l'ingranaggio **di un dente di cannula** (~19°), che porta la battuta a ~19° logici e tutta la zona di lavoro da 2322÷2489 µs a 2122÷2289, dentro la corsa buona con margine da entrambe le parti. Il rischio che l'utente voleva evitare resta coperto da `mapConstrain` di FluidNC, che non può comandare sotto l'angolo di appoggio.

**Bug d'ambiente: l'OTA non parte, `espota` riceve un segnaposto**

**Sintomo:** `espota.exe: error: argument -p/--port: invalid int value: '{upload.port.properties.port}'`, a compilazione già riuscita.
**Causa:** l'IDE non ha sostituito la proprietà della porta di rete. È un difetto noto dell'associazione fra sketch e porta, che resta appiccicata da una versione precedente.
**Fix applicato:** riselezionare la porta di rete. **Verificato dall'utente.** La via d'uscita sicura resta il cavo USB, e in alternativa `espota` a mano (hostname `cnc2d`, porta 3232, password `cnc2d2026`).

**Bug d'ambiente: `undefined reference to setup()` a compilazione riuscita**

**Sintomo:** il linker trova il core della ESP32 ma non l'oggetto dello sketch: `main.cpp` chiama `setup()` e `loop()` e nessuno gliele fornisce.
**Causa:** cache di compilazione non coerente — un `core.a` costruito con una versione del core e linkato con un'altra, dopo un aggiornamento del core a 3.3.8. Verificata prima l'integrità dello sketch (setup e loop al livello giusto, graffe bilanciate, un solo delimitatore di raw literal): non era una nostra modifica.
**Fix applicato:** svuotare `AppData\Local\arduino\cores\` e `AppData\Local\Temp\arduino\sketches\`. **Verificato dall'utente.**

**Decisioni prese:**

- **Contesto:** servono tre angoli di servo, e l'utente ha chiesto quanto debba valere il salto fra l'uno e l'altro.
  **Decisione:** **solo la battuta si misura**; «penna abbassata» = battuta + 6° **non si misura, si impone** stringendo la penna a quell'angolo contro il piano di riferimento; «penna alzata» = abbassata + 9° è un conto. Il giorno che si cambia penna si rifà lo stesso gesto allo stesso angolo e non si rimisura niente.
  **Perché quei due numeri:** i 6° (1,96 mm) sono la riserva **verso il basso**, per carta più sottile o penna infilata più corta. I 9° (2,95 mm) sono l'alzata, e il criterio di sotto è la banda morta: con dieci bande morte dentro l'alzata ripete entro il 10%, mentre un'alzata da 1 mm sarebbe tre bande morte, cioè ±30%.
  **Da rivedere se:** la prova 7 del collaudo mostra segni negli spazi fra i trattini — vuol dire che l'alzata non scavalca il fuori-piano e i 9° vanno aumentati.

- **Contesto:** il modulo esce invertito.
  **Decisione:** **una sola conversione per lato della catena**, con i gradi logici ovunque.
  **Alternative scartate:** girare solo lo slider, o convivere con la regola rovesciata (`battuta > abbassata > alzata`) nel profilo. Entrambe avrebbero lasciato due convenzioni opposte nello stesso progetto.

- **Contesto:** serve un primo disegno da cui capire com'è fatta davvero la macchina.
  **Decisione:** **undici prove su una stampa sola**, in riquadri numerati, con un documento che dice come leggerle e **in quale ordine**.
  **Da rivedere se:** la stampa risulta troppo densa da leggere — in quel caso le prove di moto (stacchi, pettine, rettilineità) si spostano su una seconda stampa più piccola.

- **Contesto:** come si fissa il foglio al piano.
  **Decisione:** **nastro di carta**, e si decide il resto **dopo il collaudo**. Il vincolo che esclude quasi tutto: fra piano carta (Z 44,2) e punto più basso del carrello ci sono **2,5 mm**, quindi dentro la zona spazzata non ci sta nessuna calamita e nessuna molletta.
  **Alternative scartate per ora:** calamite (sporgono, e vorrebbero un piano ferroso), mollette (sollevano il bordo), biadesivo (strappa la carta). **Sul tavolo, non decisa:** piattaforma con telaio da 40 mm e **piano in vetro float da 4 mm su tre appoggi regolabili** — tre e non quattro, perché tre punti definiscono un piano e quattro lo svergolano.
  **Da rivedere se:** la prova 11 del collaudo mostra il piano imbarcato o svergolato. Allora il bordo non basta e serve qualcosa che tiri giù tutta la superficie.

- **Contesto:** l'utente propone di compensare il fuori-piano via software, ritoccando la Z punto per punto.
  **Decisione: parcheggiata**, si decide dopo il collaudo. I dati li raccoglie già la prova 11.
  **Da rivedere se:** il fuori-piano misurato supera il millimetro — sotto 0,3 mm la compensazione è inutile perché il servo non sa muoversi più fine della sua banda morta.

**File consegnati/modificati:**

- `webui/tools/test-macchina.js` — **nuovo**, il generatore del disegno di collaudo (SVG o G-code)
- `webui/tools/font-tratto.js` — **nuovo**, alfabeto a tratto singolo
- `misure/disegno-di-collaudo.md` — **nuovo**, come si legge ogni prova e in quale ordine
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` — pulsanti da un grado, inversione del servo in `servoApply()`, spunta e rotta `/api/pen/invert`, flag in NVS
- `firmware/cnc2d_dashboard/README.md` — i due pulsanti e il verso del servo
- `webui/js/profile.js` — `penna.invertito`, conversione in `gradiToUs()`, nota sul `min_pulse_us` maggiore del massimo
- `webui/index.html` — spunta del verso nella scheda Penna
- `misure/accensione-e-taratura.md` — passo A2 riscritto per intero
- `documento-sessione-cnc-2d.md` — questa voce

**Impatto su Vision/Pipeline:** **Step 6 passa da «fermo in attesa dei cuscinetti» a «montato, in taratura»** — il collo di bottiglia di tutto il progetto si è sbloccato. Step 4: aggiunto il generatore del disegno di collaudo fra gli strumenti. Step 5: registrata la decisione sul fissaggio del foglio e il vincolo dei 2,5 mm.

---

### [2026-10-20 20:43] (software) Il SLICER diventa usabile: due profili, il pannello manuale, i tre popup — e i blocchi di homing trasformano otto millimetri di prudenza in due

**Riepilogo:** concordata con l'utente la nomenclatura di ogni numero della macchina e costruito sopra tutto il resto — modello a due profili, tab Impostazioni, pannello manuale riusabile, tre popup di inizio stampa, homing a mano nel firmware — mentre i blocchi di riferimento stampati dall'utente trasformano l'appoggio in una misura ripetibile, e una procedura che avevo scritto io si rivela impossibile.

**Cosa è stato fatto:**

- **Nomenclatura concordata prima di scrivere codice**, su richiesta dell'utente ("dopo che ci siamo allineati sul come chiamare ogni cosa iniziamo a lavorare"). Sei domande, sei risposte, e il risultato sta in `misure/impostazioni-glossario.md`: è il file che si cambia **prima** del codice, non dopo
- **Modello del profilo riscritto (schema 2)**: due profili separati, `macchina` e `stampa`, più una libreria di profili di stampa con nome. Migrazione automatica dallo schema 1, così le corse misurate ieri non si perdono
- **La corsa si conserva in passi**, e la scoperta che l'ha imposto: le due misure del DRO — 257,532 e 243,041 mm — valgono **esattamente 8744 e 8252 passi**, interi a meno di due centesimi. Il DRO non misura millimetri, conta passi e li divide per il rapporto nominale
- **Tab Impostazioni ricostruita** sul profilo: ogni input porta nel `data-bind` il percorso del campo, quindi aggiungere un numero vuol dire aggiungere un input e basta. Ogni campo mostra **da dove viene** (misurato / scelto / calcolato / da misurare), genera `config.yaml`, esporta e importa i profili in JSON, e applica la taratura del rapporto da una figura disegnata
- **La pausa della penna è finita nel G-code**: il numero stava nel profilo dal 19 e il generatore lo ignorava. Senza, a 50 mm/s si sbavano quattro millimetri di tratto a ogni abbassata
- **Homing a mano nel firmware della dashboard**, su richiesta dell'utente e con la sua motivazione, che è migliore di quella che avevo dato io: la coppia di uno stepper basta a spostare il blocco stampato, cioè a spostare **proprio la cosa che definisce la misura**. Due pulsanti, «Libera i motori» e «Homing completato», con l'ordine obbligato — riattiva prima, azzera poi
- **Flag `posNota` nel firmware**: la posizione dice quando non è nota, all'accensione e dopo ogni liberazione dei motori. Un numero sbagliato è peggio di nessun numero
- **Blocchi di riferimento progettati, stampati e montati dall'utente**, uno per asse. Analizzati i due STEP: il blocco Y è una piastra trapezoidale 24,80 × 48,00 × 22,00 con due fori Ø5 a 22,80 di passo; il blocco X è una sella 74,70 × 19,00 × 45,20 **senza nessun foro**, tenuta dalla forma
- **Misurate corsa dall'home e ripetibilità** (vedi Decisioni): il margine di sicurezza scende da 8,0 a 2,0 mm per asse, e l'area di lavoro passa da 249,5 × 235,0 a **254,1 × 241,0**
- **Pannello manuale come componente riusabile** (`webui/js/panel.js`), montato nella barra laterale, in una tab dedicata e dentro i tre popup. Verificato sulla documentazione FluidNC che `$MD` libera i motori e che **nessun comando li riaccende** — li riaccende il primo movimento: quindi «Homing completato» manda un jog da un centesimo di millimetro e subito dopo `G92`
- **Tre popup di inizio stampa** (`webui/js/popup.js`). Ogni passo si sblocca da sé quando la sua condizione diventa vera e, quando è bloccato, **dice perché**. Il controllo che vale di più è quello del passo 2: confermare a penna alzata manderebbe in stampa un disegno fatto a mezz'aria, e non se ne accorgerebbe nessuno finché il foglio non esce bianco
- **Il programma si rigenera dopo il terzo passo**, non prima: l'origine del foglio sposta le coordinate e l'altezza di contatto sposta la Z
- **L'app pubblicata come pagina privata** perché l'utente possa provarla dal browser senza macchina, in modalità finta

**Bug: la ripetibilità dell'homing non si misura col DRO**

**Sintomo:** la procedura che avevo scritto in quattro file diceva «appoggia il carrello al blocco cinque o sei volte azzerando ogni volta, e guarda di quanto ballano i passi». Seguendola non si ottiene nessun numero.
**Causa:** per ripetere l'appoggio bisogna liberare i motori, e liberare i motori è **esattamente il gesto che cancella quello che il contatore sa**. Non c'è ordine delle operazioni che lo aggiri: uno stepper è ad anello aperto, conta gli impulsi che gli arrivano, e di uno spostamento a mano non sa niente. È lo stesso fatto su cui era costruito tutto il resto del lavoro della giornata, applicato male a una misura.
**Fix applicato:** sostituita con due procedure che funzionano — la corsa dall'home si legge col DRO (azzera sul blocco, vai all'altra battuta), la ripetibilità si misura **col calibro**, da un riferimento fisso alla faccia del carrello. Corretta in `profile.js`, nella tab Impostazioni, nel glossario e nella procedura di accensione. **Verificato:** l'utente ha usato il metodo col calibro e ha riportato «le misure sono sempre uguali».

**Bug: l'impulso singolo contava anche a driver spenti**

**Sintomo:** con i driver disabilitati, ogni click del passo singolo incrementava il contatore di 0,0295 mm mentre il motore non si muoveva. La posizione si falsava silenziosamente, un click alla volta.
**Causa:** `handleMotorStep()` non controllava `driverEnabled`. L'A4988 ignora lo STEP quando ENABLE è alto, ma il firmware contava lo stesso.
**Fix applicato:** guardia `driverLiberi()` su tutti i comandi di movimento, che risponde «motori liberi» invece di fingere. **Da confermare sulla macchina:** il firmware è stato flashato, ma questo caso specifico non è stato riprovato.

**Bug: un movimento avviato a driver spenti restava in coda e sarebbe ripartito da solo**

**Sintomo:** avviando un movimento continuo con i driver disabilitati, l'asse risultava «in movimento» per sempre; alla riabilitazione dei driver sarebbe partito da solo.
**Causa:** `serviceMotorISR()` usciva prima di decrementare `stepsRemaining`, quindi il movimento non si chiudeva mai.
**Fix applicato:** stessa guardia, più `setMotorsEnabled(false)` che ferma entrambi i motori prima di spegnerli. **Da confermare sulla macchina.**

**Decisioni prese:**

- **Contesto:** l'utente ha chiesto profili di stampa «un po' come per i profili di stampa di Bambu Studio».
  **Decisione:** **due profili separati**, `macchina` (trasmissione, corse, dinamica, estremi del servo, homing) e `stampa` (foglio, velocità di lavoro, pausa della penna), il secondo in quanti se ne vuole con un nome.
  **Alternative scartate:** un profilo unico, che era la forma del 2026-10-19. Costringeva a rifare le misure della macchina ogni volta che si cambia carta.
  **Da rivedere se:** si scoprisse che qualche numero appartiene a entrambi.

- **Contesto:** il DRO legge millimetri, ma quei millimetri dipendono dal rapporto, che non è ancora tarato.
  **Decisione:** **nel profilo la corsa si conserva in passi**, e i millimetri sono un campo calcolato.
  **Alternative scartate:** salvare i millimetri. Il giorno della taratura il valore in millimetri cambia pur non avendo toccato la macchina: salvandolo si congelerebbe l'interpretazione sbagliata e si butterebbe via la misura.
  **Da rivedere se:** mai — è una proprietà del modo in cui la macchina misura, non una preferenza.

- **Contesto:** gli 8 mm di margine di sicurezza erano stati scelti a occhio per coprire l'errore con cui si parcheggiava l'origine a mano.
  **Decisione:** **margine a 2,0 mm per asse.** Misure dell'utente coi blocchi montati: corsa dall'home 256,089 su X e 243,071 su Y, contro 257,532 e 243,041 da battuta a battuta — quindi il blocco X mangia 1,443 mm e il blocco Y **zero** (misurato −0,030, cioè un passo: rumore). La ripetibilità dell'appoggio non si legge col calibro, registrata 0,05 e non 0 perché «sotto la risoluzione dello strumento» e «zero» sono due cose diverse.
  **Supera la decisione del:** 2026-10-19 (margine 8 mm) — quel termine copriva l'errore di parcheggio, che coi blocchi non esiste più. Restano il gioco della cremagliera (0,30) e l'incertezza su dove sia davvero la battuta lontana, che il conteggio gonfia perché spingendoci contro il motore slitta e il contatore no.
  **Da rivedere se:** la battuta lontana venisse rimisurata con un avvicinamento dolce, che toglierebbe l'unica voce grossa rimasta.

- **Contesto:** richiesta dell'utente, «per cautela».
  **Decisione:** **il punto ai blocchi e il punto home sono due punti distinti.** Lo zero resta il punto ai blocchi; finito l'azzeramento la macchina si sposta da sola al punto home, a 5 mm da entrambi.
  **Motivo (dell'utente):** un carrello lasciato appoggiato al blocco prima o poi lo sposta, e il blocco è proprio la cosa che non si deve muovere. Motivo che viene dietro: allontanandosi sempre nello stesso verso, il gioco viene preso da una parte sola.
  **Da rivedere se:** i 5 mm risultassero scomodi — è un campo del profilo, non una costante.

- **Contesto:** dopo aver misurato l'angolo del foglio, lo si poteva ancora trascinare sullo schermo.
  **Decisione:** **il foglio misurato si blocca**, con un lucchetto che dice quale dei due stati vale; premendolo si scarta la misura.
  **Alternative scartate:** lasciarlo trascinabile. Il disegno sarebbe uscito spostato sulla carta vera senza che niente lo dicesse.

- **Contesto:** l'invio del programma alla macchina è l'ultimo pezzo mancante del SLICER.
  **Decisione:** **si scrive quando FluidNC sarà acceso**, non prima. Il codice dichiara che non c'è invece di far finta, e il programma resta scaricabile.
  **Alternative scartate:** scriverlo adesso al buio. Sarebbe codice di rete non collaudato su un protocollo che non abbiamo mai visto rispondere.

**File consegnati/modificati:**

- `misure/impostazioni-glossario.md` — **nuovo**, i nomi di ogni numero
- `webui/js/profile.js` — riscritto, schema 2 con due profili e migrazione
- `webui/js/panel.js` — **nuovo**, il pannello manuale riusabile
- `webui/js/popup.js` — **nuovo**, i tre popup di inizio stampa
- `webui/js/settings.js` — riscritto sul modello del profilo
- `webui/js/paper.js`, `state.js`, `api.js`, `app.js`, `jog.js`, `artwork.js`, `gcode.js`
- `webui/index.html`, `webui/css/base.css`, `webui/css/components.css`
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` e il suo `README.md` — homing a mano, `posNota`, tre guardie
- `misure/accensione-e-taratura.md` — Fase B riscritta sui gesti veri
- `firmware/fluidnc/cnc2d-config.yaml` — intestazione: da qui in poi è **generato**

**Impatto su Vision/Pipeline:** Step 4 avanza molto (profilo, impostazioni, pannello, popup); restano **invio del programma** e **caricamento della pagina sull'ESP32**. Step 3 invariato: FluidNC non è ancora mai stato acceso sulla macchina montata, e il `config.yaml` adesso si genera dal profilo invece di essere scritto a mano. Step 5: aggiunti i blocchi di riferimento, che spostano l'homing da «a occhio» a «ripetibile».

---

### [2026-10-19 12:38] (meccanica) Il cantiere software si apre, e tre numeri sbagliati vengono a galla: il rapporto della cinghia, i pin degli assi, e un metodo di misura che non teneva

**Riepilogo:** in attesa dei cuscinetti si passa al software, e in una giornata vengono a galla tre errori miei — il rapporto di trasmissione della cinghia rimasto nel ramo FluidNC per tredici giorni dopo essere già stato registrato, i pin dei due assi scambiati dal rinominamento del 15 ottobre, e un metodo di taratura che l'utente ha giustamente bocciato — mentre la macchina consegna le sue **prime due misure vere** (corse 257,532 e 243,041) e il SLICER il suo **modello di profilo**.

**Cosa è stato fatto:**
- **Corretto `steps_per_mm` in `cnc2d-config.yaml`**, da 80,000 a 33,953 su X e Y, con la derivazione nel file
- **Verificato che il file resta YAML valido** dopo la modifica
- **Documentato nel file i tre angoli del servo** da rilevare a penna montata, e perché la dashboard è lo strumento giusto per rilevarli (slider manuale e stato `free` all'accensione)
- **Rilevate due altre divergenze fra decisioni e file**: manca il blocco `homing:` con `soft_limits`/`must_home`, e `max_rate_mm_per_min` è tarato sul rapporto sbagliato
- **Accertato come la tab Impostazioni può scrivere nella macchina**, incrociando il nostro collaudo del 2026-09-21 con la documentazione FluidNC: non con le modifiche a runtime, ma generando il file e caricandolo
- **Tolti dal YAML i due `limit_neg_pin`** e messo `hard_limits: false`, perché i finecorsa non sono montati; `max_rate_mm_per_min` alzato da 2000 a 8000
- **Scritta la procedura completa** `misure/accensione-e-taratura.md`: Fase A (messa in strada, otto passi) e Fase B (routine di ogni stampa), con la tabella dello stato reale in cima, cosa succede all'accensione, i tre popup a confronto e una tabella di diagnosi
- **Modificata la dashboard perché sappia misurare**: posizione per asse con azzeramento (`posSteps` contato nell'ISR) e taratura del rapporto per asse da comandato/misurato. `stepsPerMm()` è diventata per asse in tutti i siti di chiamata, chiudendo il debito aperto il 2026-10-15
- **Ricostruito il banco di compilazione sintattica** dello sketch (iniezione dei prototipi come fa l'IDE Arduino più gli stub delle librerie ESP32): era andato perso con il contenitore, ed è quello che garantisce che un cambio diffuso come `stepsPerMm()` non lasci siti di chiamata dimenticati
- **Aggiunto il terzo popup** (inizio foglio) al flusso di inizio stampa, su richiesta dell'utente
- **PRIME MISURE VERE DELLA MACCHINA**, prese dall'utente col DRO nuovo: corsa **X 257,532** (carrello sulla trave) e **Y 243,041** (portale sulle rotaie). Due tornate: la prima dava 258,622 e 248,048, la seconda — più prudente di proposito — i valori definitivi. Controprova geometrica contro la previsione del 2026-09-26 calcolata dai denti delle cremagliere: **+0,36% e +0,23%**
- **Constatato che la macchina è una A5.** Con quelle corse l'A4 non entra in nessun orientamento (mancano 54 mm su Y in verticale, 39,5 su X in orizzontale); l'A5 ci sta comodo in entrambi anche con margine. L'utente conferma che l'A4 non è un requisito
- **Scritto `webui/js/profile.js`**, il modello del profilo macchina con i conti derivati, `verifica()`, `stanoDentro()`, importazione/esportazione JSON e il **generatore di `config.yaml`** — con cui la decisione del 2026-10-15 ("la tab è l'unica fonte di verità") smette di essere un'intenzione. Collegata l'area di lavoro al profilo: non più 300 × 300 inventati ma **249,5 × 235,0** veri

**Bug: il ramo FluidNC ha girato tre settimane con il rapporto di trasmissione della cinghia**

**Sintomo:** `cnc2d-config.yaml` portava `steps_per_mm: 80.000`, che è la formula di una cinghia GT2 con puleggia a 20 denti. Questa macchina ha cremagliera e pignone m1.5 z20, dove un giro vale `π·1,5·20 = 94,2478` mm, cioè **33,953** passi/mm a 1/16. Con 80 la macchina percorre 2,356 volte quello che le si chiede: un quadrato da 100 mm uscirebbe da 235,6 e finirebbe contro il finecorsa al primo movimento.
**Causa:** valore copiato da un esempio di configurazione quando la macchina era ancora prevista a cinghia, e mai aggiornato al cambio di trasmissione. Non si è manifestato perché **FluidNC non è mai stato acceso sulla macchina montata**: tutte le prove di movimento sono passate dalla dashboard, che calcola il rapporto da `MM_PER_REV` e quindi ha sempre usato il numero giusto. Il bug era già stato trovato e registrato il 2026-10-06, con il numero corretto scritto nella nota: è rimasto non applicato per tredici giorni.
**Fix applicato:** `steps_per_mm: 33.953` su X e Y, con nel file la derivazione, le varianti per 1/8 e 1/32, e l'avvertenza che dopo la taratura i due assi non avranno lo stesso valore (le due cremagliere sono state stampate separatamente). Verificato che il YAML resta valido; **non verificato sulla macchina**, perché FluidNC non è ancora stato acceso.

**Bug: i pin dei due assi erano scambiati dal 2026-10-15**

**Sintomo:** con la pulsantiera della dashboard, le frecce destra/sinistra muovevano la testina **in alto e in basso** sul foglio, e le frecce su/giù la muovevano **a destra e sinistra**.
**Causa:** la mappatura tastiera→asse era giusta (←→ chiamano `x`, ↑↓ chiamano `y`); sbagliato era quale motore fosse `x`. Il 2026-10-15, applicando il rinominamento degli assi, ho scambiato i quattro `#define` dei pin — ma andavano sistemati i **nomi**, non l'abbinamento nome↔pin, che era già giusto. All'origine c'è una mia descrizione sbagliata ("il driver su 4/26 è quello del portale"), e poi ho "corretto" i pin per farli combaciare con la descrizione. L'utente me l'aveva anche detto, nello stesso messaggio: *"non è necessario che cambi nulla nel firmware vecchio, le 4 frecce spostano i carrelli nella direzione corretta"*.
**Fix applicato:** X torna a D4/D26 (carrello sulla trave), Y a D25/D33 (portale sulle rotaie), nella dashboard, in `cnc2d-config.yaml`, nelle etichette dell'interfaccia, nel README e nella tabella delle convenzioni di questo documento. **Verificato dall'utente sulla macchina**, con la spunta "inverti direzione" da rimettere sull'asse X — conseguenza attesa del fatto che le chiavi NVS sono legate al nome dell'asse. Il tempismo è stato fortunato: niente era ancora tarato.

**Bug: avevo inserito in questa voce di storico otto punti appartenenti alla sessione precedente**

**Sintomo:** la voce del 2026-10-17 conteneva, in "Cosa è stato fatto", otto punti relativi a lavoro del 2026-10-19 (la procedura di accensione, la dashboard che misura, il terzo popup, le corse, il bug dei pin, il profilo).
**Causa:** ho ancorato le sostituzioni su una riga di quella voce senza verificare in quale voce stesse. La riga era davvero del 17, i punti aggiunti dopo no.
**Fix applicato:** gli otto punti sono stati spostati in questa voce, e la voce del 2026-10-17 è tornata al suo contenuto. È una correzione di un errore materiale introdotto oggi, non una riscrittura di contenuto passato.

**Decisioni prese:**

- Contesto: l'utente comunica che i finecorsa non sono montati e non li monterà per ora. La decisione precedente prevedeva azzeramento sui due pulsanti d'angolo e `soft_limits` attivi, e una nota del 2026-09-21 li dava per cablati.
  Decisione: **azzeramento rimandato**, `limit_neg_pin` commentati e `hard_limits: false`. Un ingresso di finecorsa dichiarato su un pin non cablato è peggio che non dichiararlo, perché il pull-up interno lascia il pin in alta impedenza e un disturbo lo fa leggere come premuto: allarme a metà disegno, non riproducibile.
  Alternative scartate: lasciare la dichiarazione "pronta" per quando arriveranno i pulsanti. Costa un falso allarme a caso in cambio di due righe risparmiate dopo.
  Da rivedere se: arrivano i microswitch. Nel file c'è scritto cosa riattivare, ed è solo YAML.

- Contesto: l'utente propone il pannello di controllo manuale dentro il SLICER, un profilo macchina salvabile sul modello di Bambu Studio, e due popup di inizio stampa per origine e altezza penna.
  Decisione: **approvato nella sostanza**, con il pannello scritto una volta e mostrato in due posti (tab dedicata + dentro i popup), il profilo come documento sorgente di cui `config.yaml` è il prodotto, e tre correzioni al flusso (penna alzata prima del posizionamento XY, alzata automatica dopo la taratura dell'altezza, preambolo alza/vai/abbassa nel programma).
  Alternative scartate: un unico pulsante "salva le coordinate" come nella richiesta — sono due atti diversi (origine di lavoro e registrazione di una misura) e vanno in due posti diversi; e salvare origine e altezza penna nel profilo come default, che dopo un riavvio farebbe fidare di un'origine non più valida.
  Da rivedere se: arrivano i finecorsa, e allora il primo popup diventa un ciclo di azzeramento automatico e sparisce dal flusso.

- Contesto: avevo proposto di tarare il rapporto di trasmissione comandando 100÷200 mm e misurando col calibro quanto il carrello si era spostato. L'utente obietta che misurare il movimento è troppo vago e che semmai si misurano le linee disegnate.
  Decisione: **il rapporto si tara disegnando**, al passo A6 della procedura, con modulo penna montato. Due linee parallele a interasse comandato 100 mm, si misura esterno-esterno `E` e interno-interno `I`, e l'interasse vero è `(E + I) / 2` — la larghezza del pennarello si elide esattamente. *Annulla l'ordine "prima il rapporto, poi la corsa"* dato poche ore prima nella stessa sessione.
  Il motivo per cui l'obiezione è fondata: inseguire un carrello col calibro contro un riferimento improvvisato dà due o tre decimi di incertezza, cioè proprio l'ordine di grandezza da misurare; una linea disegnata sta ferma, è piana, sta su un tavolo e il calibro ci appoggia le ganasce come vuole lui.
  Quello che non cambia: **serve comunque un metro esterno.** `corsa letta = passi / 33,953` e `passi = denti percorsi × 20`, quindi `corsa letta = denti percorsi × 4,71239` sempre, qualunque sia il passo vero. Il ritiro di stampa si cancella per costruzione e nessuna misura fatta *dentro* la macchina può rivelare l'errore di scala.
  Alternative scartate: il metodo delle due spine sulla cremagliera (`mm/giro = 20 × passo`, esatto, statico, e già scritto in `misure/primo-asse.md`) — resta disponibile se servisse un numero prima della penna, ma dà il passo locale di un pezzo e la cremagliera Y è in due pezzi giuntati.
  Da rivedere se: si dovesse tarare senza poter disegnare.

- Contesto: le due tornate di misura delle corse differiscono di 1,1 mm su X e 5,0 su Y, e avevo ipotizzato l'imbardata del portale.
  Decisione: **corse definitive X 257,532 e Y 243,041**, stabilite dall'utente. Lo scarto su Y era prudenza voluta nella seconda tornata, non imbardata: **l'ipotesi che avevo avanzato è ritirata.** Sono misure di estremo, prese per sapere dove non andare, e non si ritoccano quando il rapporto sarà tarato.
  Conseguenza accettata: **la macchina è una A5.** L'A4 non entra in nessun orientamento e l'utente conferma che non è un requisito ("lavoreremo con dei margini abbondanti"). Conferma la decisione già presa il 2026-09-26.
  Da rivedere se: l'A4 diventasse un requisito — i 39,5 mm mancanti andrebbero cercati su X, che consuma 292,5 mm di una trave da 550 mentre Y ne consuma 157 di rotaie da 400.

**File consegnati/modificati:**
- `firmware/fluidnc/cnc2d-config.yaml` — `steps_per_mm` corretto su X e Y; `limit_neg_pin` commentati e `hard_limits: false`; `max_rate_mm_per_min` da 2000 a 8000; commenti sulla derivazione del rapporto, sulle varianti di microstep, sui tre angoli del servo e su cosa riattivare quando arrivano i finecorsa
- `misure/accensione-e-taratura.md` — **nuovo**: la procedura completa, Fase A (sette passi, con le misure degli assi come A1 perché si possono fare oggi) e Fase B (routine di ogni stampa), con la tabella dello stato reale, cosa succede all'accensione, i tre popup a confronto, quanto fidarsi dell'origine manuale e una tabella di diagnosi
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` — posizione per asse (`posSteps` nell'ISR, azzeramento, riquadro nella tab Controllo), `mmPerRev` per asse salvato in NVS con taratura da comandato/misurato, `stepsPerMm()` resa per asse in tutti i sei siti di chiamata, tre rotte nuove (`/api/motor/zero`, `/api/motor/calib`, `/api/motor/mmrev`)
- `firmware/cnc2d_dashboard/README.md` — sezione "Misurare gli assi": come si prende la corsa, come si tara il rapporto, perché i due assi avranno numeri diversi, e cosa è cambiato nel firmware
- `webui/js/profile.js` — **nuovo**: il modello del profilo macchina, i conti derivati, `verifica()`, `stanoDentro()`, esportazione/importazione JSON e il generatore di `config.yaml`
- `webui/js/state.js`, `webui/js/paper.js`, `webui/index.html` — l'area di lavoro viene dal profilo
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` — pin degli assi corretti (X su D4/D26, Y su D25/D33)
- `documento-sessione-cnc-2d.md` — v42; corretta la tabella delle convenzioni in cima (i pin erano scambiati) e rimessi al loro posto otto punti finiti per errore nella voce del 2026-10-17

**Impatto su Vision/Pipeline:** Step 3 **riaperto** — era segnato completato, e lo era rispetto al suo criterio (quadrato e cerchio a vista sui motori, 2026-09-21), ma il criterio è stato soddisfatto sul banco e non sulla macchina, e il file non porta le decisioni prese dopo; sette note nuove, fra cui quella che segnala la discrepanza sui due pulsanti dati per cablati. Step 4 — cinque decisioni nuove (pannello manuale come sezione di prima classe, profilo macchina salvabile, le due misure di inizio stampa mai salvate come default, i due pulsanti separati, la differenza con Bambu) e quattro note: il flusso di inizio stampa, il terzo popup, il margine che deve coprire l'errore di parcheggio, e l'origine come origine di lavoro. Step 2 — quattro note sulla dashboard che misura e sul bug dei pin, e il debito dei due passi/mm per asse è chiuso nel firmware. Step 6 — stato aggiornato: il CAD è chiuso e lo step è **fermo in attesa dei cuscinetti**, non più "CAD in mano all'utente"; resta il collo di bottiglia, perché senza penna non si tara il rapporto di trasmissione.

---

### [2026-10-17 09:24] (meccanica) prova_4: la cremagliera è esatta e a gioco zero, lo schema descrive una macchina che non esiste, e i denti restano dritti

**Riepilogo:** la cremagliera di `prova_4` è geometricamente perfetta (passo, profondità, fianchi e interasse esatti al millesimo, 10 denti con margine da entrambe le parti) ma il gioco d'ingranamento misurato è 0,000 mm — l'offset j = 0,30 non è arrivato nel CAD; nel verificarlo è emerso che il modulo costruito ha **un solo stadio mobile** e non i due con giunto a gioco morto descritti nello schema, cosa che cambia il senso di tre numeri già registrati.

**Cosa è stato fatto:**
- **`prova_4` analizzata con OCP.** Unica differenza da `prova_3`: `pz2` cresce di 1,800 in −X (la dentatura) e di 1,43 cm³. Zero interferenze fra tutti gli altri componenti; la corsa sulla pista è invariata (11,000 in discesa, limite ancora dei cuscinetti inferiori)
- **Conteggio dei denti confermato con margine.** 10 denti da Y −30,000 a +16,133; il campo che il pignone percorre su tutta la corsa va da −24,140 a +11,634, quindi avanzano 1,24 denti sotto e 0,95 sopra. Il "ne ho fatti un po' di più" dell'utente è esattamente la quantità giusta
- **Misurato il gioco invece di stimarlo.** Traslando la stecca lungo Y a pignone fermo a passi di 0,025 mm e cercando le posizioni senza compenetrazione: finestra larga 0,000 mm. La simmetria della curva attorno a quel punto (0,286 mm³ da una parte, 0,302 dall'altra) dimostra che i profili sono coniugati esatti
- **Rilevata la divergenza fra schema e CAD** sull'architettura (un solo stadio, nessun giunto a gioco morto), e messa una nota in testa a `schema.html` che dice quali sezioni restano valide e quali no
- **Risposto sui bulloni esagonali dei morsetti** misurando la parete (9,0 mm, da X 7,50 a 16,50) e la posizione della punta della vite (X 6,10), da cui la geometria della tasca e il verso in cui va aperta
- **Registrato il nuovo parametro della tab Impostazioni** chiesto dall'utente (angolo di battuta dei cuscinetti) più i tre che ne conseguono

**Bug: il gioco d'ingranamento della cremagliera è ancora zero, al secondo giro**

**Sintomo:** nel CAD di `prova_4` la coppia cremagliera/pignone ha una sola posizione di non-interferenza invece di una finestra: gioco 0,000 mm. Le quote disegnate sono le nominali (pianetto di cresta 1,264, vano al fondo 0,991) invece di quelle con l'offset (0,964 e 1,291).
**Causa:** la scheda consegnata il 2026-10-16 esprimeva il profilo corretto come tabella di **semilarghezze** (0,48214 / 1,02810 / 1,71055). Non sono le quote che si mettono in uno sketch: in uno sketch si quotano i due pianetti e l'angolo dei fianchi. Il profilo nominale ha le stesse semilarghezze meno 0,15, quindi la differenza fra la tabella giusta e quella nominale sono tre terze cifre decimali — facile da non vedere. È una causa accertata sulla forma del documento, non una supposizione sull'utente.
**Fix applicato:** aggiunta alla scheda una sezione 6 che dà **due sole quote da cambiare**, espresse come larghezze misurabili: pianetto di cresta da 1,26424 a 0,96424 e vano al fondo da 0,99131 a 1,29131. Tutto il resto invariato, mezzerie dei denti comprese. Verificato sul disegno, non ancora in stampa.

**Bug: il centro del pignone era sbagliato di 0,050 nella scheda della cremagliera**

**Sintomo:** la scheda dava il centro del pignone a X −37,500 e quindi la primitiva della stecca a X −18,750. Nel CAD la stecca è a −18,700.
**Causa:** avevo letto il centro dal **bounding box** del pignone, che per una dentatura non allineata agli assi non è simmetrico (40,410 × 40,482). Il centro vero, letto dai cilindri di testa (R 20,250) e di fondo (R 16,875) che sono concentrici, è X −37,450. Il numero giusto era già nel documento, nella nota del 2026-10-16 sull'albero del servo.
**Fix applicato:** corretti nella scheda il centro, la primitiva, la linea di fondo e la cresta, con una nota datata che spiega l'errore. Conseguenza fortunata: la stecca nel CAD è **giusta** e non va spostata, l'interasse misurato è esattamente 18,750.

**Decisioni prese:**

- Contesto: lo schema di principio (rev. 2) descrive due stadi sulla stessa pista con un giunto a gioco morto da 6 mm, e tre note del 2026-10-16 ragionano come se quel giunto ci fosse. Il CAD, dalla `prova_1` alla `prova_4`, ha un solo pezzo mobile.
  Decisione: **si prende per buono il CAD.** Un solo stadio mobile, presa rigida, quota data dal servo — che è la strada che l'utente aveva chiesto il 2026-10-15 e che ha appena riconfermato descrivendo la taratura come tre angoli di servo. *Supera la decisione del 2026-10-16* sull'architettura a due stadi.
  Alternative scartate: rimettere il giunto a gioco morto nel CAD adesso. Costa una riprogettazione di `pz2` e dei cuscinetti per risolvere un problema che non si è ancora visto.
  Da rivedere se: alla prima stampa il tratto cambia spessore secondo il punto del foglio. In quel caso la banda morta da aggiungere non è 0,3 mm ma **quanto è fuori piano il piano carta**, che su 300 mm può valere mezzo millimetro: va misurata prima di dimensionare il giunto.

- Contesto: con un solo stadio rigido, non c'è niente che disaccoppi la quota imposta dal servo dalla forza sulla carta.
  Decisione: **i 0,30 mm di gioco d'ingranamento sono l'unica cedevolezza della catena, e sono voluti.** Dentro quei 0,30 mm `pz2` si muove senza che il pignone giri: la penna appoggia col proprio peso (0,45÷0,55 N) e non con la quota. È un giunto a gioco morto di 0,30 mm invece di 6, della stessa natura. Conseguenza operativa: la taratura di *penna abbassata* deve cadere **dentro** quella banda, e il gioco della cremagliera **non va ridotto** cercando precisione.
  Alternative scartate: inseguire il gioco minimo possibile sulla coppia. Sarebbe il contrario di quello che serve, e in più non si tiene: lo stack di tolleranze è ±0,3 mm.
  Da rivedere se: si rimette un giunto vero, e allora il gioco della coppia torna irrilevante in entrambi i versi.

- Contesto: l'utente ha i bulloni esagonali per le viti dei morsetti e chiede se usarli invece del filetto autofilettato nel PLA.
  Decisione: **sì, e la raccomandazione è di metterli.** Un filetto autofilettato in PLA su una vite che si svita a ogni cambio di penna è il caso in cui il PLA cede per primo; e il foro è Ø5,500 su una M6, cioè meno della metà della profondità di filetto, quindi anche il primo serraggio è debole. La tasca va **aperta verso l'interno** (lato penna), con la spalla sul lato esterno, perché la vite spinge e la reazione spinge il dado verso l'esterno. Nella parete da 9,0 mm (X 7,50 ÷ 16,50) un dado M6 da 5,0 di spessore lascia 3,80 mm di spalla.
  Alternative scartate: inserto filettato a caldo (fa lo stesso lavoro ed è tenuto su tutta la lunghezza, quindi non chiede spalla — ma va comprato, e il dado ce l'ha già); scendere a M4 per risparmiare ~9 g sulle viti (il risparmio non serve più, vedi la decisione sulla massa); mettere il dado nell'attacco invertendo il tiro (l'attacco è 10 × 10 mm, un esagono da 10 non ci sta).
  Da rivedere se: il dado scappa dalla tasca in montaggio nonostante la presa a frizione — allora inserto a caldo.

- Contesto: l'utente aveva impostato la doppia elica a 40° sul pignone del pen-lift, e la raccomandazione data il 2026-10-16 era denti dritti ma con un motivo che si appoggiava al giunto a gioco morto.
  Decisione: **denti dritti**, decisa dall'utente, con una motivazione che non dipende dal giunto e che è più forte della mia: l'ingranaggio è **avvitato a un braccetto**, quindi la sua quota assiale non è un riferimento — dipende da quanto a fondo il braccetto va sullo spline, dalla profondità della tasca e da due M2 in torrette stampate. I denti dritti danno un range su quella quota, l'elica lo converte in errore nel piano di rotazione. Il numero che lo conferma era già nel documento, misurato sugli assi X e Y il 2026-09-26: ±0,17 mm di centraggio con la doppia elica contro ±2 mm con i denti dritti. *Sostituisce il motivo scritto il 2026-10-16*, non la conclusione.
  Alternative scartate: doppia elica a 40° con battuta assiale netta nella tasca del braccetto. Costa un riferimento che va costruito e misurato per comprare continuità di ingranamento su una corsa di 26 mm, dove non serve.
  Da rivedere se: il pen-lift passasse a una trasmissione con riferimento assiale vero.

- Contesto: il bilancio della massa flottante è fuori budget da tre sessioni (0,45÷0,55 N contro 0,20÷0,29 N di target).
  Decisione: **il target non si applica più.** Era il target dell'architettura a gravità, dove il peso *era* la forza d'appoggio. Con la presa rigida il peso va solo sollevato, e il servo ha 17× di margine. Il problema si chiude come problema di budget.
  Alternative scartate: continuare a tagliare materiale da `pz2` e accorciare le viti per rientrare in un numero che non è più un vincolo.
  Da rivedere se: la penna appoggia dentro la banda morta di 0,30 mm e 0,55 N si rivelano troppi per la punta in fibra. Allora il peso torna a contare, ma come forza d'appoggio da ridurre, e la leva giusta sono le due viti M6 (19,15 g, un terzo del totale), non lo svuotamento di `pz2`.

**File consegnati/modificati:**
- `modulo-penna/cremagliera-e-pignone.html` — nuova sezione 6 (verifica su `prova_4`, il gioco misurato, le due quote da cambiare, le mezzerie come sono nel CAD, la nota sulla larghezza); corretti centro del pignone, primitiva, linea di fondo e cresta nella sezione 4, con nota datata sull'errore
- `modulo-penna/schema.html` — nota in testa: lo schema descrive l'architettura a due stadi, il CAD ne ha uno; quali sezioni restano valide; cosa ha preso il posto del gioco morto
- `documento-sessione-cnc-2d.md` — v31

**Impatto su Vision/Pipeline:** Step 6 — aggiunte in testa alle decisioni quella sull'unico stadio mobile (supera l'architettura a due stadi del 2026-10-16) e quella sui denti dritti (sostituisce il motivo scritto il 2026-10-16, non la conclusione); sei note nuove. Step 4 — la riga *Penna* della tab Impostazioni passa da due angoli a quattro più il raggio del pignone come parametro di conversione, su richiesta dell'utente, con una nota che spiega il perché di ciascuno.

---

### [2026-10-16 18:38] (meccanica) Dal primo CAD del modulo penna alla cremagliera quotata, passando per un errore mio sulle tolleranze

**Riepilogo:** tre revisioni del CAD del modulo Tratto Pen analizzate con OCP una dopo l'altra, con il peso della parte flottante sceso del 27% e la geometria del pen-lift chiusa: pignone z25 sul braccetto del servo, cremagliera a 9 denti quotata e posizionata, e un gioco di ingranamento che nella prima versione del disegno avevo dimenticato del tutto.

**Cosa è stato fatto:**
- **Analizzate `prova_1`, `prova_2` e `prova_3`** con OCP: interferenze fra tutti i componenti, estrazione dei fori, distanze minime, scansione di collisione lungo la corsa. Tutte e tre pulite, zero interferenze — il contrario degli assiemi di settembre, dove le booleane ripescavano otto collisioni finte
- **Consegnate tre schede di disegno**: lo schema di principio del modulo (due figure, i tre stati del meccanismo), la cremagliera e il pignone quotati, e il braccetto con l'ingranaggio
- **Verificate le quote del braccetto SG90 su internet: non esistono.** Nessun produttore ne pubblica un disegno e le dimensioni cambiano fra i cloni; sul diametro esterno dello spline le fonti divergono di 0,3 mm. Da cui la scelta di fare quel disegno **parametrico su sei quote da rilevare col calibro**
- **Calcolata la corsa che l'utente chiedeva:** `pz2` scende di 11,000 mm, fermato dai cuscinetti inferiori che arrivano in fondo alla pista. Da lì i 9 denti della cremagliera
- **`pz2` alleggerito del 27%** dall'utente (63,08 → 46,20 cm³) dopo il bilancio di massa della sessione precedente

**Bug: il profilo della cremagliera era a gioco zero**

**Sintomo:** le quote del dente che avevo consegnato (semilarghezza 1,17810 alla primitiva) sono le quote teoriche di una coppia a contatto perfetto. Una coppia stampata con quelle quote non ingrana: si impunta.
**Causa:** avevo dato il gioco su tutti gli accoppiamenti tranne quello che conta — tasca del braccetto A+0,4, mozzo C+0,2, stecca 1 mm per lato più larga del pignone, ma il profilo del dente nominale. L'ha intercettato l'utente chiedendo esplicitamente delle tolleranze, non me ne ero accorto.
**Fix applicato:** gioco j = 0,30 mm scaricato tutto sulla cremagliera, semilarghezza alla primitiva da 1,17810 a **1,02810**. Il valore è giustificato: la catena di tolleranze sull'interasse vale ±0,3 e si trasferisce sul gioco moltiplicata per `2·tan20° = 0,728`, quindi a gioco nominale zero si grippa metà delle volte. Verificato sul disegno aggiornato, non ancora in stampa.

**Decisioni prese:**

1. **L'ingranaggio si attacca al braccetto in dotazione, non si stampa la scanalatura.**
   - Contesto: proposta dell'utente, che preferiva non stampare uno spline con denti minuscoli
   - Decisione: braccetto annegato in una tasca, centrato sul mozzo tondo e indicizzato sui bracci, fissato con due viti M2 nei fori che ha già
   - Il numero che la rende obbligata: lo spline dell'SG90 è modulo 0,2, quindi i denti sporgono di **0,20 mm** sopra la primitiva — metà di una larghezza di estrusione. In PLA o non ingrana, o si spiana al primo carico
   - Alternative scartate: stampare la scanalatura; incollare il braccetto di piatto senza tasca (nessun indice contro la rotazione, e nessun accesso alla vite del servo)
   - Da rivedere se: si passa a un servo con spline più grosso

2. **Pignone z25 invece di z20.** *Supera la raccomandazione data poche ore prima nella stessa sessione*, che era z20 per riusare il profilo degli assi.
   - Contesto: noto che l'albero del servo è lungo Z e non lungo X, si è potuto calcolare dove cade la cremagliera in funzione del diametro
   - Decisione: z25, Ø primitivo 37,5. Con questo diametro la linea primitiva cade a X −18,750 e il fondo della cremagliera a −16,875, cioè **0,375 fuori dalla parete di `pz2`**: i denti sono intagliati nel fianco invece che su una mensola
   - Il motivo per cui supera la z20: il pignone sta sulla parte **fissa**, la cremagliera su quella **flottante**. La massa del disco è gratis, quella della mensola no. Il riuso del profilo z20 non valeva niente, perché la feature di Onshape lo genera comunque
   - Alternative scartate: z14 e z20 (mensola da 11,95 e 7,45 mm); z28 (cremagliera a filo ma disco Ø45)
   - Da rivedere se: cambia la posizione del servo

3. **Doppia elica: no sul pen-lift, pur funzionando bene sugli assi.**
   - Contesto: l'utente l'ha impostata a 40° per coerenza con X e Y
   - Decisione dell'utente ancora da confermare; la raccomandazione è denti dritti
   - Motivo: la doppia elica compra continuità di ingranamento, che sugli assi finisce nel tratto disegnato su 300 mm di corsa continua, mentre qui il giunto a gioco morto **scollega del tutto il movimento del pignone dalla punta**. In cambio introduce un vincolo assiale (a 40° uno sfalsamento `d` sposta il dente di 0,839·d, quindi si grippa oltre 0,358 mm con j = 0,30) su una catena che non ha nessuna battuta: quanto a fondo il braccetto va sullo spline, più due quote stampate
   - Da rivedere se: si decide di farla comunque — in quel caso cremagliera elicoidale uguale, mano specchiata, e battuta assiale netta nella tasca del braccetto

4. **La forza del servo non è un criterio nella scelta del diametro.**
   - Contesto: domanda esplicita dell'utente
   - Con 1,8 kg·cm e raggio 18,750 escono 9,4 N alla cremagliera, contro 0,55÷0,60 N di massa flottante da sollevare: **margine 15×** già col pignone grande. Quello che il diametro decide davvero è dove cade la cremagliera e, in second'ordine, la velocità di alzata (1,8× più veloce con z25 che con z14)

**File consegnati/modificati:**
- `modulo-penna/schema.html` — schema di principio, riscritto in revisione 2
- `modulo-penna/cremagliera-e-pignone.html` — profilo, tolleranze, parametri Onshape, stecca finita quotata e posizionata
- `modulo-penna/braccetto-e-ingranaggio.html` — nuovo, parametrico sulle sei quote da calibro
- `documento-sessione-cnc-2d.md` — questa voce e le note dello Step 6

**Impatto su Vision/Pipeline:** solo note dello Step 6, che resta in corso. Corretta inoltre in questa revisione una data sbagliata su cinque note dello Step 6, scritte come 2026-10-17 quando erano del 2026-10-16: avevo messo la data senza chiederla al sistema.

---

### [2026-10-16 12:36] (meccanica) Schema del modulo penna, e i cuscinetti che tolgono di mezzo la molla

**Riepilogo:** disegnato lo schema di principio del modulo Tratto Pen, e riscritto il giorno dopo perché la scelta dell'utente di usare cuscinetti MR63 al posto di bussole striscianti ha spostato l'attrito della guida di due ordini di grandezza, rendendo inutile la molla che la prima versione aveva messo lì apposta per tollerarlo.

**Cosa è stato fatto:**
- **Consegnato `modulo-penna/schema.html`**, schema cinematico in due figure: la catena dal servo alla punta, e i tre stati del meccanismo. Dichiarato esplicitamente che è uno schema di principio e non un disegno di fabbricazione — le quote derivano dai conti, l'impacchettamento dentro l'inviluppo del carrello richiede il CAD, che è dell'utente
- **Rifatto il giorno dopo in revisione 2**, con l'architettura a due stadi su pista comune e il giunto a gioco morto al posto della molla
- Registrate le quote della staffa LL (550), della faccia posteriore del motore e dello scarto 45 / 46,7 mm fra metro e CAD

**Decisioni prese:**

1. **Scorrimento del portapenna su cuscinetti MR63, non su bussole striscianti.**
   - Contesto: la revisione 1 dello schema segnalava la guida verticale come il pezzo critico del modulo, perché il suo attrito è l'unica cosa in serie con la forza di appoggio
   - Decisione dell'utente: gli stessi cuscinetti usati sui carrelli
   - Effetto: attrito da ~0,150 N (μ 0,3 su 0,5 N di carico) a ~0,001 N. Il punto critico sparisce
   - **Conseguenza non prevista, che supera la scelta della molla fatta il 2026-10-15:** con l'attrito a un millesimo di newton il peso proprio basta a far scendere la penna, e un cannotto da 25 g pesa già 0,25 N — più dei 0,2 N che si volevano ottenere comprimendo una molla di 4 mm. Una molla che spinge in giù sommerebbe la sua forza al peso invece di darla. Se servirà, servirà **in tiro, per alleggerire**
   - Da rivedere se: il tratto esce troppo marcato (togliere materiale dal cannotto o aggiungere una molla di richiamo) o troppo debole (zavorra)

2. **Due stadi sulla stessa pista, uniti da un giunto a gioco morto da 6 mm.**
   - Stadio comandato: 2 cuscinetti, porta la cremagliera, quota = angolo del servo. Stadio flottante: 4 cuscinetti in due coppie, porta morsetti e penna, appoggia per peso proprio
   - La decisione del 2026-10-15 regge nella sostanza — il sollevamento resta positivo e comandato dal servo, che era il punto dell'utente — ma la **forza** d'appoggio torna al peso proprio, come nell'architettura del 2026-10-01
   - Due vantaggi recuperati: l'angolo di appoggio torna **non critico**, e **il servo si può rilasciare a penna giù**, cosa che la presa rigida aveva perso

**File consegnati/modificati:**
- `modulo-penna/schema.html` — nuovo, poi riscritto in revisione 2
- `documento-sessione-cnc-2d.md` — questa voce e le note dello Step 6

**Impatto su Vision/Pipeline:** solo Step 6, che resta in corso con il CAD in mano all'utente.

---

### [2026-10-15 19:20] (contenuti) Catalogo completo delle riprese raccolte e primo smistamento per episodio

**Riepilogo:** l'utente ha girato la maggior parte delle riprese fino al montaggio completo della macchina (modulo penna escluso) e ha condiviso l'intera cartella — rinominando ogni file con una descrizione di cosa contiene — per avviare lo smistamento negli episodi della serie; in parallelo si è chiuso il confronto sulle tecniche per un effetto di luce giorno/notte su un timelapse.

**Cosa è stato fatto:**
- **Trascritto in chat l'elenco completo e ordinato delle riprese raccolte finora** (184 file, dalle schermate della cartella locale dell'utente: due riferimenti CAD, i file `IMG_05xx`–`IMG_57xx`/`IMG_E0643`/`LCKK3120` e due riprese finali della macchina), nello stesso ordine della cartella — propedeutico allo smistamento nelle cartelle `EP0`/`EP1`/`EP2`/`EP3`/`MORE` già create dall'utente. Segnalato un salto di numerazione (`IMG_0759` → `IMG_4587`), probabile reset del rullino del telefono, non riprese mancanti
- **Avviato lo smistamento su richiesta puntuale** (l'utente chiede per categoria, non tutto insieme): per l'Ep.0 individuati i clip di "sbrocco" (`IMG_0650`, `IMG_0651`), i video dei componenti (`IMG_5225`–`IMG_5227`), le aperture di Spotify/Claude (`IMG_5231`, `IMG_5228`) e il B-roll generico alla scrivania/pc/tastiera (una dozzina di file tra `IMG_05xx` e `IMG_53xx`–`IMG_53xx`)
- **Discusso l'effetto "timelapse di più giorni" (ciclo luce giorno/notte) su un filmato reale di lavoro al pc:**
  - Valutata la strada Higgsfield (video-to-video generativo): sconsigliata — i modelli generano a clip corte (4-15s), quindi un timelapse lungo andrebbe spezzato e ricucito con rischio di scatti/flicker alle giunzioni, e soprattutto *rigenerano i pixel* frame per frame (rischio concreto di deformare viso/mani/oggetti), in contrasto col principio di autenticità già fissato per la serie
  - Raccomandata la via deterministica: color grading in DaVinci Resolve con keyframe ciclici su temperatura colore/luminosità (caldo-giorno ↔ freddo-notte), che mantiene il girato reale intatto e dà controllo totale sul numero di cicli
  - L'utente ha proposto un'alternativa migliore: **piazzare il telefono e registrare davvero per 2-3 giorni** con un'app a intervalli. Opinione data: è la soluzione preferibile, a patto che nell'inquadratura ci sia una finestra o luce naturale che renda visibile il ciclo giorno/notte — altrimenti il trucco non si vedrebbe

**Decisioni prese:**
- Contesto: come ottenere l'effetto "il tempo passa" su un timelapse di lavoro al pc senza violare il principio "il girato reale resta reale, non va rigenerato via AI"
- Decisione: provare prima la ripresa reale su più giorni (telefono fisso, intervalli, finestra in campo); il color grading in Resolve resta il piano B se la luce naturale non basta
- Alternative scartate: relight via AI generativa (Higgsfield/Kling) — rischio artefatti e incoerente col principio di autenticità della serie
- Da rivedere se: la stanza non ha abbastanza luce naturale per rendere leggibile il ciclo giorno/notte, allora si passa al color grading in Resolve

**File consegnati/modificati:** nessun file nel repository — elenco riprese e smistamento consegnati solo in chat, su richiesta esplicita dell'utente di non salvarli ancora in un file persistente (lo smistamento è in corso, a richiesta per singole categorie)

**Impatto su Vision/Pipeline:** nessuno

---

### [2026-10-15 17:41] (meccanica) Macchina montata, assi rinominati sul foglio, e la penna torna in presa rigida

**Riepilogo:** la struttura è finita — staffa LL tagliata, portale montato, i due assi si muovono senza difficoltà — e con la macchina davanti sono cambiate tre cose di impostazione: i nomi degli assi passano alla convenzione cartesiana del foglio, la penna torna a prendere la quota dal servo invece che per gravità, e la webapp prende un nome, GDC CNC 2D SLICER, con la tab Impostazioni promossa a unica fonte di verità dei numeri di taratura.

**Cosa è stato fatto:**
- **Tagliata la staffa LL e montata tutta la macchina**, modulo penna escluso. Era l'unico taglio del progetto senza seconda possibilità: dalla stecca da 1002 restavano 452 mm, meno di un secondo pezzo
- **Il disallineamento delle rotaie è stato risolto in montaggio**, non in CAD: i 22,9 mm di corsa che costava sono recuperati sulla macchina vera
- **Rinominati gli assi in tutto il codice.** Non era solo nomenclatura: nel firmware e in FluidNC il nome dell'asse *è* la mappatura dei pin, quindi cambiare i commenti e basta avrebbe lasciato i pulsanti attaccati al motore sbagliato. Scambiati i `#define STEP/DIR` della dashboard, i blocchi `x:`/`y:` del config FluidNC — step, direction **e** finecorsa, perché i pulsanti stanno fisicamente sugli assi — e le etichette dei pin nell'interfaccia e nel README. Il cablaggio in breadboard non cambia
- **Scritta la scheda di misura del primo asse** (`misure/primo-asse.md`), poi corretta due volte prima ancora di essere usata. Primo errore mio: avevo chiesto 6400 impulsi e una misura di 188,496 mm, che **in un calibro da 150 non ci sta**. Secondo: il metodo differenziale con le punte del calibro infilate nelle cave cancella l'errore sistematico di appoggio ma non la dispersione, perché una punta piatta in una cava a V appoggia ogni volta a un'altezza diversa. Riscritta col **metodo dei perni** — due tondini identici nelle cave, `p = (R30 - R10)/20`, dove il diametro si cancella nella sottrazione e la campata lunga dimezza l'errore
- **Documentato nel README della dashboard perché i motori fischiano** appena arrivano i 12 V, con la prova che distingue il caso benigno (togliere la spunta ai driver: il fischio deve cessare di colpo) e la tabella dei suoni che invece segnalano un guasto — compreso il ticchettio da hiccup, che è il sintomo inseguito per due giorni col servo
- **Prova di movimento a macchina montata:** motori senza difficoltà anche alla velocità massima, gioco d'ingranamento "quasi zero" a mano, struttura rigida. Numeri grezzi non ancora presi

**Decisioni prese:**

1. **Nomi degli assi secondo la convenzione cartesiana del foglio.**
   - Contesto: in fase di prova X e Y erano assegnati come capitava, e risultavano scambiati rispetto a come li legge chi guarda il foglio
   - Decisione: **X** è la trave del portale (staffa LL), **Y** sono le due rotaie di base (staffe TT)
   - Conseguenza documentale: tutte le voci e le note anteriori a oggi usano i nomi vecchi e **non sono state riscritte**. L'avvertenza è nelle Convenzioni in testa alla Pipeline
   - Da rivedere se: mai. Scoprirlo guardando un disegno ruotato di 90° sarebbe peggio

2. **La quota di appoggio della penna la dà il servo, in presa rigida.**
   - Contesto: l'architettura del 2026-10-01 prevedeva discesa per gravità con servo staccato in appoggio. L'utente teme che la catena non sia abbastanza sciolta perché il peso della penna la porti giù, e preferisce dare l'altezza e provare
   - Decisione: presa rigida nei due versi, angolo di appoggio tarato e salvato nelle impostazioni
   - **Supera la decisione del: 2026-10-01** — scelta dell'utente dopo aver sentito l'argomento opposto
   - Alternativa accantonata, non scartata: discesa per gravità. I tre motivi originali restano validi (carta non piana, nessuna taratura di Z, nessun jitter sulla punta). Nota tecnica per quel giorno: la discesa per gravità **non chiede un servo reversibile** — il servo allontana attivamente il braccetto — quindi il fattore che decide è l'attrito della guida, non la scioltezza del servo
   - Da rivedere se: la linea esce di spessore diverso secondo il punto del foglio, o se l'angolo di appoggio va rifatto a ogni cambio di foglio
   - Vincolo di progetto che la decisione porta con sé: con braccetto da 30 mm, 1° di servo vale 0,52 mm alla punta e la corsa di 4 mm sta in 7,6° — otto posizioni in tutto. Va risolto nel CAD accorciando il braccetto, non dopo la stampa

3. **La webapp si chiama GDC CNC 2D SLICER, e la sua tab Impostazioni è l'unica fonte di verità.**
   - Contesto: gli stessi numeri di taratura vivono oggi in tre posti che non si parlano — i `#define` del firmware, il `cnc2d-config.yaml` e i default dell'anteprima
   - Decisione: la tab Impostazioni contiene, salva ed esporta i valori; anteprima, generatore di G-code e macchina leggono da lì. La lista dei gruppi di valori è nello Step 4
   - Alternativa scartata: continuare a cambiare lo stesso numero in tre file, che è il modo per ritrovarsi un'anteprima che mostra un disegno diverso da quello che la macchina fa

4. **Misure di taratura rinviate dopo il modulo penna.**
   - Contesto: le tre misure erano la priorità dichiarata dal 2026-10-13
   - Decisione dell'utente: aspettare la penna, perché a quel punto la taratura si fa disegnando una linea lunga e misurandola — una misura di tutta la catena, per asse, invece del solo passo della cremagliera
   - Da rivedere se: la linea disegnata non torna e serve separare i contributi; allora si usa la procedura col calibro, che resta scritta

**File consegnati/modificati:**
- `misure/primo-asse.md` — nuovo, poi rivisto due volte (metodo dei perni, limite della dilatazione del PLA)
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` — `#define` STEP/DIR scambiati, etichette dei pin nell'interfaccia
- `firmware/cnc2d_dashboard/README.md` — sezione sul fischio a motore fermo, pin aggiornati
- `firmware/fluidnc/cnc2d-config.yaml` — blocchi `x:`/`y:` scambiati con i rispettivi finecorsa
- `documento-sessione-cnc-2d.md` — questa voce, le Convenzioni, Step 4, 5 e 6

**Impatto su Vision/Pipeline:** aggiunto un blocco **Convenzioni** in testa alla Pipeline (nomi assi, nomi staffe, nome dell'applicazione) valido per tutti gli step. Step 4 rinominato col nome dell'applicazione e arricchito della specifica della tab Impostazioni. Step 5 passa a **completato nella struttura**. Step 6 passa a **in corso** e diventa il collo di bottiglia di tutto il progetto.

---

### [2026-10-13 12:31] (contenuti) Registro episodi ancorato al lavoro reale, archivio firmware storico, tracker costi e primi asset grafici

**Riepilogo:** sul fronte contenuti/serie social sono stati creati e consolidati i tre strumenti di produzione della serie Instagram — registro episodi con script, archivio storico del firmware per rigirare i test passati, tracker costi materiali — e avviato il lavoro sulla grafica (Higgsfield per i concetti, asset overlay costruiti direttamente per le icone precise).

**Cosa è stato fatto:**

- **Serie Instagram (`content/instagram-series.md`):** creato il registro pubblicazione, scritti gli script completi (voice over, note di ripresa, testo overlay) per gli episodi 0-7, incluso un cold open/trailer per l'Ep. 0 (fail reali in stacchi rapidi + "in questa serie..."). Il registro è stato poi **ristrutturato**: aggiunta una colonna "Sessione reale" che collega ogni episodio alla voce corrispondente di questo stesso storico sessioni, e i 5 episodi generici originariamente immaginati per lo Step 5 sono stati sostituiti con 9 episodi ancorati alle sessioni meccaniche reali del 24-27/9 (modulo/pignone, scelta di stampare la cremagliera, calcolo cuscinetti, i quattro errori pre-stampa, bilancio di coppia, falso allarme attrito, salto di formato A5→A4, apertura asse Y). Aggiunti link diretti al codice/file di riferimento per ogni episodio
- **Archivio storico firmware (`firmware/archivio-storico/`):** estratti dalla cronologia git 14 snapshot del firmware dashboard (01-14, dal LED singolo al servo pen-lift), con README che spiega cosa fa ciascuna versione e a quale commit corrisponde — servono per rigirare i test degli episodi passati con il codice esattamente com'era in quel momento, dato che le riprese sono partite dopo il lavoro tecnico vero e proprio
- **Costi materiali (`content/costi-materiali.md` + `.pdf`):** creato il tracker con una colonna "prezzo effettivo" che stima quanto di ogni acquisto (spesso in confezioni multiple/kit misti) è davvero attribuibile alla macchina, al netto di scorte. Processati più round di screenshot di acquisto forniti dall'utente; generata anche una versione PDF stilizzata (reportlab). Aggiornamenti successivi: nuova base in legno che sostituisce quella stimata nello scontrino Brico, viti M4 aggiunte (non in sostituzione) alle M3
- **Consolidamento repository:** il lavoro di questa sessione era partito su un branch separato (`claude/eager-albattani-kv9tn5`); mergiato nel branch di default (`claude/elegant-knuth-0396no`, quello usato dal fronte meccanica) così entrambe le sessioni condividono tutto in un unico posto. Branch ridondante poi cancellato dall'utente su GitHub
- **Workflow Higgsfield/overlay:** definito il workflow di produzione video (DaVinci Resolve Free — niente scripting Python esterno dalla versione 21.1, import OTIO preferibile a FCPXML in quella versione); scelto di usare Higgsfield solo per grafiche concettuali/organiche (schemi, trasformazioni), mai per overlay precisi o per simulare la macchina reale. Costruito e consegnato all'utente un primo asset overlay reale (animazione Ctrl+C/Ctrl+V in stile blueprint, sfondo nero per blend "Screen" in Resolve), renderizzato interamente in locale con HTML/CSS + Playwright (registrazione) + ffmpeg (encoding) — nessuna generazione AI necessaria per questo tipo di grafica precisa

**Decisioni prese:**

- Contesto: come strutturare il registro episodi della serie Instagram
- Decisione: ogni episodio è ancorato a una voce reale dello storico sessioni, non più a un piano narrativo scritto in anticipo
- Alternative scartate: piano narrativo precompilato per tutti gli step (usato inizialmente per Step 5, poi abbandonato perché non rifletteva il lavoro meccanico reale nel frattempo documentato)

- Contesto: dove e come usare Higgsfield nella serie
- Decisione: solo per grafiche concettuali/organiche; per overlay precisi (icone, testo, tasti) costruzione diretta via HTML/CSS + rendering locale, non generazione AI
- Alternative scartate: generare anche gli overlay precisi con Higgsfield — scartato per inaffidabilità nota dei modelli video AI su testo/icone piccole

- Contesto: un timelapse ha un ostacolo (mano + attrezzo) fermo in inquadratura per l'intera durata della clip
- Decisione: raccomandato il taglio diretto della clip invece della rimozione AI, perché l'ostacolo copre l'area per tutta la durata — non esiste nessun frame reale di cosa c'è sotto, quindi un tool di rimozione inventerebbe lavorazione mai filmata, in contrasto con l'autenticità della serie
- Alternative scartate: nessuna di principio — su richiesta esplicita dell'utente, che ha scelto comunque di provare lo strumento "Remove Object from Video" di Higgsfield, sono stati forniti il prompt e le indicazioni per farlo
- Da rivedere se: l'utente decide poi di non usare il risultato della prova Higgsfield nel montaggio finale

**File consegnati/modificati:**

- `content/instagram-series.md` — creato e aggiornato più volte
- `content/costi-materiali.md` — creato e aggiornato più volte
- `content/costi-materiali.pdf` — creato e rigenerato più volte
- `firmware/archivio-storico/01-*.ino` … `14-*.ino` (14 file) + `firmware/archivio-storico/README.md` — creati
- Asset overlay "Ctrl+C/Ctrl+V" (video mp4, stile blueprint) — consegnato direttamente all'utente, non committato nel repository
- Branch `claude/eager-albattani-kv9tn5` — mergiato nel branch di default e poi cancellato

**Impatto su Vision/Pipeline:** nessuno — lavoro sul fronte contenuti/serie social, parallelo alla pipeline tecnica.

---

### [2026-10-13 07:28] (meccanica) Tagli in proprio, cremagliera X con rialzo integrato, e due giorni persi dietro a un servo che non aveva corrente

**Riepilogo:** settimana in cui la macchina è passata dal CAD al banco: l'utente ha comprato il seghetto e tagliato da solo la prima staffa TT, ha riprogettato la cremagliera X inglobando il rialzo in legno, ha scoperto che l'interasse delle rotaie è quantizzato dai fori della trave — e poi si è fermato due giorni su un servo immobile che si è rivelato un problema di alimentazione, chiuso con due 7805 separati e una spina sola.

**Cosa è stato fatto:**

- **Lista tagli consegnata e poi superata dall'utente**, che ha comprato un seghetto a pendolo e ha tagliato in proprio. Scelta della lama motivata sulla geometria del taglio (T118G, passo 0,7, perché per 64 dei 67 mm la lama attraversa l'ala da 1,5 mm) e non sul materiale generico. **Prima staffa TT tagliata, risultato ottimo**
- **Nomenclatura allineata su richiesta dell'utente:** staffa TT = le due da 400, staffa LL = quella da 550
- **Assiemi prova_2 e prova_3 analizzati.** Scoperto che l'interasse delle rotaie non è libero: i fori dell'anima della staffa LL sono a passo 25,000 e i fori di serraggio delle guance distano esattamente un passo, quindi **473,400 è il massimo ottenibile** e la trave da 550 lo copre con 0,600 mm di avanzo. Misurati per bisezione i limiti di corsa del carrello Y contro ogni ostacolo
- **Cremagliera X prova_5 verificata:** rialzo in legno eliminato, pezzo alto 68,375 (+55,000 esatti), 59 denti e passo invariati. Verificato che il restringimento della sezione sopra i primi 10 mm restituisce **21,339 mm** di margine al carrello Y
- **Firmware della dashboard riscritto** per la trasmissione reale (timer hardware, millimetri, microstep impostabili, prove quadrato/cerchio, slider servo) e poi esteso con la rampa del servo
- **Architettura di alimentazione definitiva** progettata e montata dall'utente: una spina, 12 V / 3 A, due L7805CV separati

**Bug: il servo non si muove e la scheda si spegne**

**Sintomo:** a ogni comando del servo si spegnevano il LED dell'ESP32 e quello del modulo di ricarica; il servo immobile. I LED comandati dalla dashboard funzionavano.
**Causa:** servo e logica sullo stesso 5 V del modulo 18650. Lo spunto del servo faceva collassare il ramo, l'ESP32 andava in brownout e smetteva di generare il PWM.
**Fix applicato:** due 7805 indipendenti dai 12 V. **Confermato, tutti i test passano.**

**Bug: lo sketch non compila dopo la riscrittura**

**Sintomo:** `variable or field 'setDir' declared void` e `'Motor' was not declared in this scope`, su righe scritte correttamente.
**Causa:** l'IDE Arduino inserisce i prototipi generati prima della prima funzione del file; spostando le costanti in cima, la prima funzione era finita sopra `struct Motor`.
**Fix applicato:** struct spostate in una sezione "Tipi" in testa. **Confermato.**

**Bug: lo slider della rampa servo etichettato al contrario**

**Sintomo:** l'utente ha provato "il movimento morbido al massimo" e il problema restava.
**Causa:** lo slider si chiamava "Movimento morbido" ma il valore sono i **gradi per passo**, quindi più alto = più duro. Portandolo a 20 chiedeva 2000°/s, cioè il salto secco con un altro nome: la prova più dolce è 1.
**Fix applicato:** rinominato "Passo della rampa — più basso = più morbido", con il nome della condizione accanto al numero e fondo scala ridotto a 10. **Errore di interfaccia mio, non di lettura dell'utente.**

**Quattro errori miei di metodo, non di calcolo**

- **L'alimentazione classificata come causa poco probabile.** Avevo scritto "non aspettarti che sia quello" mettendo in cima la massa mancante. La massa era a posto e l'alimentazione era la causa. L'avevo anche elencata, come ramo del brownout, ma l'ordine di probabilità ha mandato l'utente a cercare altrove per un giro
- **L'ingombro del carrello X lungo la rotaia dato come 51 mm**: sono **82,000**, perché i 51 sono la sola gabbia motore mentre i 608 stanno a passo 60,000 e con Ø22 arrivano a 82
- **L'interasse rotaie dato come `lunghezza trave − 76,0`** = 474,0: è **473,400** e lo quantizzano i fori, non la lunghezza
- **Il controllo di sintassi con g++ non poteva vedere l'errore dei prototipi**, perché g++ non li inietta. Buco del metodo, non sfortuna: il controllo ora emula quel passaggio ed è stato validato facendogli riprodurre l'errore sulla versione vecchia

**Decisioni prese:**

- **Contesto:** il rialzo in legno sotto la cremagliera X era il termine dominante della catena delle quote (planarità ±0,50 su 284 mm, contro un budget di ±0,275). **Decisione (dell'utente):** stamparlo insieme alla cremagliera, pezzo unico alto 68,375. **Alternative scartate:** tenere il riporto in legno curandone la planarità, che non è un'operazione che si fa in casa. **Da rivedere se:** il ritiro del PLA su 68 mm (~0,21 mm, sempre verso il gioco largo) risultasse non compensabile con spessori
- **Contesto:** servo e logica sullo stesso 5 V, e l'utente non vuole più di una spina per accendere la macchina. **Decisione:** una spina da 12 V / 3 A e **due L7805CV indipendenti**, uno per la logica e uno per il servo. **Alternative scartate:** un solo regolatore condiviso (è la configurazione che ha causato il guasto); uno switching LM2596, più efficiente e indicato come upgrade futuro, ma non disponibile — e due lineari separati sono elettricamente più puliti di uno switching condiviso; una seconda presa dedicata al servo, rifiutata dall'utente. **Da rivedere se:** il calore dei due lineari (1,75 W e 0,7 W medi) desse fastidio sulla base
- **Contesto:** l'utente vuole lasciare il circuito su breadboard e fissarla alla base. **Decisione:** **sì per i segnali, no per la potenza** — i due 7805 su millefori saldata, il ramo 12 V su morsetti a vite, breadboard fissata e cavi ancorati. **Alternative scartate:** tutto su breadboard (contatti dati per ~1 A contro 2 A di picco, e la vibrazione del portale rende intermittenti i contatti a frizione: un STEP intermittente si manifesta come errore di quota e manda a cercare il guasto nella meccanica); tutto saldato subito, che toglierebbe la flessibilità proprio mentre il modulo penna deve ancora nascere
- **Contesto:** la staffa LL non è ancora tagliata. **Decisione:** **aspettare il primo test di movimento.** Dalla stecca da 1002 restano 452 mm, meno di un secondo pezzo: è l'unico taglio senza seconda possibilità, e rimandarlo non costa niente

**File consegnati/modificati:**

- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` — riscritto (timer hardware a 20 kHz, interfaccia in millimetri, microstep impostabili, slider servo dal vivo, prove quadrato/cerchio, rampa del servo)
- `firmware/cnc2d_dashboard/README.md` — aggiornato su microstep, millimetri, generazione dei passi e rampa del servo
- `firmware/archivio-storico/15-microstep-millimetri-prove-insieme.ino` e `README.md` — nuovo snapshot
- `gcode/test/README.md` — corretta la nota "40 mm = un giro d'albero", vera con le cinghie e non più con pignone e cremagliera
- STEP analizzati (upload, non in repo): `Assembly_1_prova_2`, `Assembly_1_prova_3`, `cremagliera_X_dx_prova_5`

**Impatto su Vision/Pipeline:**

- **Step 1:** tre decisioni nuove (una spina con due 7805 separati; il 18650 fuori dal progetto; la breadboard definitiva solo per i segnali) e due note, fra cui il bug del brownout
- **Step 2:** sei note nuove, fra cui la riscrittura della dashboard, il bug dei prototipi dell'IDE e la conferma dei microstep a 1/16
- **Step 5:** nove note nuove; blocco dei problemi aperti riscritto con **tre voci chiuse** (la priorità del calibro, la lista tagli, il piano di base) e **cinque nuove**, fra cui la nuova priorità: le tre misure del primo test di movimento
- **Step 6:** una nota — il requisito dell'alimentazione dedicata al servo è stato soddisfatto in anticipo, pagandolo con due giorni di diagnosi

---

### [2026-10-06 18:58] (meccanica) Modulo penna progettato e rinviato, asse X raddoppiato, portale assemblato: la lista tagli e quattro errori di calcolo miei

**Riepilogo:** sessione lunga che ha chiuso l'altezza della cremagliera Y (stampata, gioco ottimo), progettato per intero il modulo penna e poi rinviato, deciso di motorizzare un solo lato dell'asse X con numeri alla mano, portato il carrello X alla v2 in due revisioni (stampato e funzionante), raddoppiato il lato sinistro e misurato il portale assemblato — da cui esce la lista tagli (trave 550, rotaie 2 × 400) e la scoperta che il piano di base non basta più; lungo la strada ho sbagliato quattro conti e li ho corretti tutti con misure booleane invece che con stime.

**Cosa è stato fatto:**

**Bug: altezza della cremagliera Y sbagliata di 0,119 mm**

**Sintomo:** avevo dato H = 44,381 come quota da mandare in stampa.
**Causa:** il Ø di testa dell'ingranaggio l'avevo letto dal **bounding box** (33,237) invece che dai cilindri veri (33,000). Su una dentatura a spina di pesce OCC circoscrive le facce NURBS con 0,1185 di margine per lato, ed è esattamente metà di 33,237 − 33,000: quello scarto l'avevo interpretato come una correzione di profilo x = +0,079, e il raggio operativo come 15,119 invece di 15,000.
**Fix applicato:** **H = 44,500 = 46,000 − t_ala**, verificata tre volte in modo indipendente — catena di quote dall'estradosso dell'ala, gioco di testa che viene 0,375 = 0,25·m senza essere stato imposto, e gioco misurato 0,226 mm mettendo in presa la geometria dell'utente (ribaltata) con scansione di fase e bisezione. Verificato: cremagliera stampata, gioco dichiarato ottimo dall'utente.

**Bug: margine di corsa calcolato sull'estremità sbagliata**

**Sintomo:** avevo detto all'utente che gli restavano 0,320 mm di margine fra guancia e cuscinetto laterale, e che doveva allungare la trave con urgenza.
**Causa:** avevo usato l'estremità del **pezzo** cremagliera invece dell'estremità della **dentatura**. Fra le due ci sono 7,748 mm di base piena, distribuiti in modo asimmetrico (1,874 da un lato, 5,874 dall'altro).
**Fix applicato:** margine vero **4,194 mm**. L'urgenza non c'era. Corretto esplicitamente all'utente.

**Bug: l'argomento del baricentro era sbagliato di segno**

**Sintomo:** avevo detto all'utente di non riempire il vuoto dietro al motore del carrello X perché 50 g a quota 74 avrebbero alzato il baricentro e peggiorato l'effetto pendolo inverso.
**Causa:** avevo guardato il carrello X **da solo**. Il baricentro dell'assieme che si muove davvero sta a **Z ~94**, dominato dalla trave di alluminio a Z 114 e dal carrello Y a ~103; il materiale aggiunto sta a Z ~74, quindi **lo abbassa** di ~1,5 mm.
**Fix applicato:** ritirato. E anche il "non riempirlo" era sopravvalutato: su un pezzo stampato lo slicer svuota comunque, quindi un blocco pieno a 15% di infill fa ~37 g contro i ~35 di una scatola progettata a pareti da 4 mm. Il cuneo autoportante che l'utente ha fatto è meglio di entrambe le mie proposte.

**Bug: ingombro del carrello Y sottostimato di 33,5 mm per estremità**

**Sintomo:** trave Y consigliata prima 430, poi 500, poi 550 nella stessa sessione.
**Causa:** stimavo l'ingombro contando le guance (49,5) e i cuscinetti laterali (33,0 dal pignone), ignorando che a quelle distanze **le due gabbie motore si toccano corpo contro corpo**.
**Fix applicato:** misurato montando i due solidi nello stesso sistema e cercando il primo contatto per bisezione — **px = −78,000**, zona di contatto X −38,00…−36,00 / Z 81,65…85,93. Quindi `A = 38 + 78 = 116,000` per estremità, e `L = corsa + 2A + 2g`. La lezione: su questa macchina le stime da bounding box hanno sbagliato tre volte su tre, le booleane zero.

**Bug: `steps_per_mm` sbagliato di 2,36× in configurazione**

**Sintomo:** nessuno ancora osservabile — la macchina non ha mai girato sotto G-code con la trasmissione definitiva.
**Causa:** `firmware/fluidnc/cnc2d-config.yaml` porta ancora `steps_per_mm: 80`, dimensionato per cinghia GT2 e puleggia a 20 denti. La trasmissione è pignone e cremagliera m1.5 z=20, dove il giro vale `π · m · z = 94,2478` mm.
**Fix applicato:** nessuno — il valore corretto è **33,953** (3200 microstep / 94,2478) ma non è ancora stato scritto. È il primo numero da correggere, perché finché è sbagliato ogni limite di corsa inserito è sbagliato dello stesso fattore e nessun pannello può accorgersene: il pannello parla in mm e il mm è falso.

**Bug: gli MR63 laterali penetrano nella rotaia X di 0,500 per lato**

**Sintomo:** le booleane sull'assieme piazzato trovano 8 interferenze da 2,81 mm³, una per ogni cuscinetto laterale dei due carrelli X, con zona di contatto spessa esattamente 0,500 mm. I carrelli però scorrono bene nella realtà.
**Causa:** non accertata con certezza. L'indizio decisivo è che **gli MR63 laterali del carrello Y non interferiscono per niente** (lì il gioco modellato è 0,050 e torna): quindi è il profilo della rotaia TT nel modello a essere sbagliato — luce interna 20,000 contro perni a ±7,500 — non lo schema di guida.
**Fix applicato:** nessuno — serve il calibro sulla rotaia vera. Vedi Problemi aperti, è l'unica misura rimasta e blocca la squadratura.

**Altre attività:**
- **Modulo penna progettato per intero** (architettura, forze, incastri, servo, interfaccia utensili) e poi **rinviato** dopo l'assemblaggio del portale, su obiezione dell'utente. Confluito nel nuovo Step 6
- **Architettura dei limiti di spazio definita** su richiesta dell'utente: corse in FluidNC, foglio nell'app, margine come numero proprio, e la scoperta che i due pulsanti d'angolo già cablati possono diventare riferimenti di azzeramento sbloccando `soft_limits`. Confluito nello Step 3
- **Carrello X v2 rivisto in due giri** (prova 1 e 2) con misure sulle facce e mappe dello spazio libero; l'utente l'ha stampato e funziona, la staffa Y si alloggia
- **Cremagliera Y misurata dente per dente:** 62 denti, passo 4,71240 su tutti, spessore sulla primitiva 2,15620 su tutti — variazione zero su 290 mm. E verificato che ci sta sul piatto **in un pezzo solo** a 45° (`297,360 + 28,456 = 325,8` contro 362,04), quindi niente giunto e niente gradino di passo
- **Assieme completo analizzato:** 52 istanze piazzate estratte dalla gerarchia doppia dell'export, interferenze su tutte le coppie, interasse rotaie 473,40, trave da esterno a esterno 549,40, due rotaie sfalsate di 62,08 in Y, cremagliera Y decentrata di 25,88, piano di base fuori di 154 mm, area di disegno centrata su X −102,6 / Y −87,9
- **Due voci chiuse come non-problemi** dopo essere state segnalate rispettivamente quattro e tre volte: i 608 a filo del bordo d'ala (lo sbordamento è lo 0,7% della larghezza del cuscinetto) e la fila di fori motore a passo 31,500 (le viti entrano, i 0,500 stanno dentro il gioco Ø4 su M3)

**Decisioni prese:**

- **Contesto:** la penna va mossa su e giù in modo ripetibile su una carta che non è piana. **Decisione:** parallelogramma articolato, discesa per gravità, servo che fa **solo** il sollevamento con 1,5 mm di gioco morto che lo stacca mentre si disegna. **Alternative scartate:** leva basculante su due MR63 (un solo giunto, gioco quasi nullo, ma obbliga a una penna ≤46 mm); tubi telescopici in ottone (la migliore sul trascinamento, ma accetta un refill non una penna); slitta su bronzine stampate (gioco diretto sulla punta); servo in presa rigida nei due versi. **Da rivedere se:** si accetta di lavorare con refill D1 da 67 mm, e allora la leva torna la scelta migliore
- **Contesto:** l'utente vuole più moduli penna per usare pennarelli diversi, e in prospettiva un taglierino. **Decisione:** l'interfaccia diventa un **riferimento** (due spine Ø3 asimmetriche + connettore + secondo canale servo riservato) e la sede utensile permette la rotazione, così la **lama trascinata** si ha gratis. **Alternative scartate:** lama tangenziale orientata attivamente, che vuole un asse A vero coordinato (un servo non basta, accumula angolo) e la punta esattamente sull'asse di rotazione
- **Contesto:** serviva decidere se motorizzare anche il secondo carrello X. **Decisione:** **un solo lato motorizzato, l'altro folle**, stesso pezzo specchiato con la sede motore predisposta ma vuota. **Alternative scartate:** motore unico con albero di collegamento; due motori in serie su un driver; due in parallelo; due driver con squadratura in firmware. Il conto: ritardo elastico 3÷9 µm a 0,3 g con trave 430, contro 235 µm di gioco e 0,83 mrad di imbardata che il secondo motore non tocca; e coppia disponibile 40× quella richiesta. **Da rivedere se:** la spinta a mano sul lato folle varia di più del doppio lungo la corsa, o è uniformemente oltre 3 N
- **Contesto:** due staffe rigide alle estremità della trave sovravincolano il portale. **Decisione:** **fisso e flottante** — lato motorizzato vincola tutto, lato folle ha scorrimento permanente lungo l'asse della trave più registrazione di squadratura bloccabile in direzione di corsa. **Alternative scartate:** vincolare rigidamente entrambi i lati e fidarsi del parallelismo delle rotaie
- **Contesto:** l'utente vuole i limiti di spazio inseriti a mano in un pannello, con due valori per posizione (foglio e fine corsa). **Decisione:** **corse in FluidNC** (`max_travel_mm`, con azzeramento sui due pulsanti esistenti e `soft_limits` attivi), **foglio nell'app**, **margine come numero esplicito suo**, limite effettivo calcolato e mai salvato. **Alternative scartate:** tutto nell'app (un limite che vive solo nella UI non è una protezione ma un suggerimento: una riga battuta nella console di FluidNC lo scavalca); margine sommato dentro ai limiti (il numero mostrato non sarebbe più quello vero)
- **Contesto:** ordine di lavoro fra secondo asse X e modulo penna. **Decisione:** **asse X → tagli e assemblaggio → modulo penna**, su obiezione dell'utente. **Supera la raccomandazione data poche ore prima** nella stessa sessione (modulo penna prima, perché è lo strumento di misura della macchina) — argomento valido ma secondario: senza il secondo appoggio il portale non si può muovere, e una macchina che si muove senza penna dà già informazioni
- **Contesto:** lunghezza di taglio della trave Y. **Decisione:** **550 mm**, rotaie 2 × 400. Non è il minimo (549,40 a filo): a 550 la capacità di corsa sale a 308 e ci sta anche la cremagliera Y più lunga stampabile in un pezzo solo, per 29 g di massa in più. **Supera** le indicazioni di 430 e di 500 date prima nella stessa sessione
- **Contesto:** il formato dichiarato era "A4 in orizzontale". **Decisione:** **~242 × 256 mm**, A4 rinviato. Con cremagliere in un pezzo solo il massimo raggiungibile è 281,6 × 292,8: il lato da 297 non entra su nessuno dei due assi. L'area è equivalente a un A4, la forma è quadrata. **Da rivedere se:** l'A4 diventa un requisito, e allora serve una cremagliera giuntata

**File consegnati/modificati:**
- `documento-sessione-cnc-2d.md` — v16 → v17
- `firmware/fluidnc/cnc2d-config.yaml` — **non modificato**, ma `steps_per_mm` va portato da 80 a 33,953 e va aggiunto il blocco `homing` per asse
- Nessun file di codice toccato: la sessione è stata tutta analisi geometrica su STEP e progettazione
- STEP analizzati (upload, non in repo): `asse_Y_tot_prova_5`, `asse_X_dx_-carrello_v2_prova_1` e `_prova_2`, `Assembly_1_prova_1`, più i file cremagliera X prova 2 e 3 per ricavare la corsa dell'asse X

**Impatto su Vision/Pipeline:**
- **Nuovo Step 6 — Modulo penna e interfaccia utensili** (stato: da fare, architettura decisa). Scorporato dallo Step 5 perché è diventato un sottosistema con decisioni proprie e un criterio di completamento proprio, e perché la scelta di farne una famiglia di utensili ne cambia i requisiti
- **Step 5:** stato da "in corso (progettazione)" a "in corso (assemblaggio)"; **obiettivo ridimensionato** da "tutta l'area di un A4 in orizzontale" a "circa 242 × 256 mm" con la motivazione in nota; cinque decisioni progettuali nuove; dodici note; blocco dei problemi aperti riscritto con **otto voci chiuse** e la nuova priorità unica (luce interna della rotaia X)
- **Step 3:** tre decisioni progettuali nuove, di cui una **supera** "nessun azzeramento automatico" del 2026-09-21; due note, fra cui la discrepanza su `steps_per_mm`. Lo stato resta **completato** perché il criterio (quadrato e cerchio verificati a vista sui motori) era e resta soddisfatto — ma va registrato che le quote eseguite erano 2,36× quelle comandate
- **Vision:** non modificata

---

### [2026-10-01 18:00] (meccanica) Trave Y comprata, carrello Y dalla prova 1 alla 4, e la catena di quote che si sposta tutta sulla trave

**Riepilogo:** comprata e misurata la trave a T dell'asse Y, progettato il carrello Y in quattro iterazioni fino alla prima stampa, trovati e corretti tre errori geometrici (dentature con elica di mano opposta, pattern fori motore, cremagliera che non raggiunge le asole), e deciso di mettere il motore sotto la trave a cavallo dell'anima — scelta che obbliga la cremagliera a scendere su una base alta 44 mm e sposta le tolleranze critiche su tre quote di un profilo comprato e non ancora misurato.

**Cosa è stato fatto:**

- **Trave Y acquistata e rilevata dallo STEP**: alluminio, T asimmetrica, ala 67,100 × 1,500, anima 3,100, altezza totale 23,500, due bande asolate sull'ala. Verificato che le piste dei cuscinetti cadono fuori dalle asole (2,40 e 4,20 mm di margine) e che il bordo inferiore dell'anima è continuo per tutta la lunghezza — condizione che ha poi reso possibile l'anti-sollevamento
- **Carrello Y progettato in quattro versioni** (prova 1 → 4), con controllo booleano di compenetrazione a ogni passo: dall'ultima versione tutte le coppie (ruota, mozzo, dieci cuscinetti, carrello, trave) danno zero
- **Catena verticale chiusa**: asse pignone a Z −36,000, primitiva cremagliera a −20,881, altezza cremagliera 44,381
- **Lunghezza della cremagliera Y decisa**: due pezzi identici da 37 passi, stampati dritti sul piatto

**Bug: le due dentature avevano l'elica di mano opposta**

**Sintomo:** 74,1 mm³ di compenetrazione booleana fra pignone e cremagliera Y nell'assieme. Non scendeva sotto ~35 mm³ né ruotando il pignone sul suo asse, né facendolo rotolare davvero (rotazione + traslazione r·θ), né aumentando l'interasse fino a 0,8 mm.
**Causa:** inseguendo un singolo dente al variare di Y, la cremagliera dà pendenza dX/dY **+0,60** e il pignone **−0,576**. Stesso angolo d'elica (30°), ma le punte delle V guardano da parti opposte: le tracce dei denti si incrociano a 60° invece di essere parallele nel punto di contatto. Probabile origine: la cremagliera Y è stata ricavata da quella X ribaltandola per portare i denti in giù, e quel ribaltamento inverte la mano.
**Fix applicato:** si gira la ruota sottosopra. Essendo simmetrica rispetto al piano di mezzeria, ribaltarla inverte la mano senza spostare nient'altro. Verificato: compenetrazione **0,000 mm³** con finestra di gioco ~0,26 mm. **Non** si risolve ruotandola sul mozzo, che era l'istinto iniziale: quella cambia la fase, non la mano. Da verificare la stessa cosa sull'asse X, dove potrebbe servire l'orientamento opposto.

**Bug: il carrello Y si solleva sotto una forza applicata al motore**

**Sintomo:** alla prima stampa, premendo con un dito sul retro del motore il carrello si alzava dalla trave.
**Causa:** niente teneva giù il lato −Y (i 608 di quel lato solo appoggiano sull'ala) e il motore sta 59 mm sotto il piano di appoggio, quindi qualsiasi forza lì genera un momento grande. Confermato dai numeri: la forza tangenziale agisce sul punto primitivo a Z −20,881, l'attrito che la contrasta sui 608 a Z 23,500, braccio 44,381 mm scaricato sui 60 mm di passo perni → a stallo ±5,4 N contro 2,15 N di peso per stazione.
**Fix applicato:** due MR63 ad asse Y che spingono verso l'alto contro il bordo inferiore dell'anima. Verificato in CAD, da verificare sul pezzo stampato. In marcia normale il momento non solleva ma dimezza il carico su una stazione, ed è quella cedevolezza che si traduce in isteresi nel disegno.

**Bug: pattern dei fori motore sbagliato per tre versioni**

**Sintomo:** interasse fori NEMA 17 misurato 31,000 × 32,000 su prova 2 e 3, 31,000 × 31,450 su prova 4. Il valore corretto è 31,000 × 31,000.
**Causa:** l'utente aveva riprodotto i fori del carrello X, che però ha **una sola fila di due viti** (31,000 in una direzione sola, perché la coppia superiore cadrebbe fuori dal pezzo): la seconda quota non c'era da copiare ed è stata disegnata a mano.
**Fix applicato:** parziale. Su prova 4 la fila inferiore è esatta (−51,500 = −36,000 − 15,500), **la superiore è ancora alta di 0,450** e va portata a −20,500. Non impedisce il montaggio (Ø4 su M3 dà 0,5 di raggio libero) ma consuma tutta la registrazione proprio su Z, che è l'asse dell'interasse.

**Decisioni prese:**

- *Contesto:* dove mettere il motore dell'asse Y. **Decisione:** sotto la trave, con la gabbia centrata sul piano dell'anima. *Alternative scartate:* **motore sopra il carrello** — verificato che l'argomento dei "5 cm di penna in più" non regge (l'attacco del modulo è più basso di soli 13 mm col motore sotto, ma la macchina deve stare 19 mm più alta, quindi il modulo verrebbe 6 mm più corto col motore sopra); ha deciso l'argomento vero, cioè che **il corpo del motore è alluminio** e quei millimetri di discesa non li fa un braccio stampato in PLA. **Motore tutto fuori sul lato −Y** con la cremagliera direttamente sotto l'ala — geometricamente funziona, ma porta il baricentro a Y ≈ −37, fuori dalla carreggiata, e l'ala finisce a −42,05 quindi non c'è dove allargare l'appoggio. *Da rivedere se:* il modulo penna risultasse scomodo da attaccare dietro al motore, o se il franco verticale sotto il portale diventasse critico
- *Contesto:* come impedire al carrello di sollevarsi. **Decisione:** due MR63 ad asse Y sotto il bordo inferiore dell'anima. *Alternative scartate:* una seconda coppia di 608 sotto l'ala, che avrebbe leva migliore (Y −19,45 invece di Y 0) ma cade esattamente dove scende la cremagliera. *Da rivedere se:* l'altezza reale della trave si rivelasse troppo variabile per un gioco di 0,000 — nel qual caso serve comunque l'asola in Z
- *Contesto:* lunghezza della cremagliera Y, servendo ~343 mm di dentatura. **Decisione:** due pezzi identici da 37 passi (174,359), incastro maschio/femmina al giunto, stampati dritti sul piatto. *Alternative scartate:* pezzo unico — il piatto a 45° con larghezza 28,456 ammette 333,6 mm teorici e ~300 pratici, non bastano. *Da rivedere se:* la corsa Y richiesta cambiasse
- *Contesto:* il carrello stampato scorreva con troppo gioco. **Decisione (dell'utente):** stringere i nominali — 608 da 0,150 a 0,100, MR63 laterali da 0,100 a 0,050, anti-sollevamento a 0,000. *Riserva registrata:* 0,050 è sotto la tolleranza di stampa, quindi la prossima stampa può uscire con 0,15 di gioco o 0,05 di interferenza senza modo di aggiustare. Il rimedio strutturale resta l'**asola**, non il nominale più stretto, che aggiunge precarico su tutta la corsa e lo fa pagare dove il profilo è più spesso

**Correzioni a quanto detto in sessione:**
- Avevo scritto che stringendo la cremagliera contro l'ala l'ingranamento si stringe. È il contrario: denti in giù e pignone sotto, quindi tirandola su l'interasse **aumenta**. Il margine di montaggio voluto dall'utente andava nel verso giusto
- Avevo concluso che la coppia pignone-cremagliera "non può ingranare" e che andava specchiata la cremagliera. La diagnosi (mano opposta) era giusta ma la correzione no: basta **girare la ruota sottosopra**, cioè si risolve in montaggio come aveva intuito l'utente, solo con un movimento diverso da quello che pensava

**File consegnati/modificati:**
- `documento-sessione-cnc-2d.md` — versione 16
- STEP analizzati (non in repo): `asse_Y_-_staffa_carrello_prova_1`, `asse_Y_prova_2`, `asse_Y_prova_3`, `asse_Y__prova_4`, più il confronto con `tot_prova_3` (carrello X) e `ingranaggio_e_cremagliera_prova_1`

**Impatto su Vision/Pipeline:** Step 5 — aggiunte due decisioni progettuali (motore Y sotto la trave a cavallo dell'anima; anti-sollevamento sul bordo inferiore dell'anima), 17 note di cronologia, e riscritto il blocco dei problemi aperti: chiusi il profilo della trave Y e il layout del carrello Y, aperta come priorità la misura delle tre quote della trave.

---

### [2026-09-27 17:32] (meccanica) Carrello completo misurato, falso allarme sullo strisciamento, cremagliera chiusa e apertura dell'asse Y

**Riepilogo:** Il carrello X completo scorre e l'attrito che sembrava strisciamento si è rivelato attrito interno dei cuscinetti — cioè costante, quindi destinato a migliorare sotto carico — e con la massa che smette di essere un vincolo il formato sale ad A4 orizzontale; la cremagliera arriva a una versione geometricamente corretta dopo tre difetti trovati sullo STEP, e si apre l'asse Y con due principi che hanno già riscritto lo sketch.

**Cosa è stato fatto:**

- **Carrello X completo stampato e assemblato.** 290 g, distacco ~10°, moto costante ~15°. In forza sono 0,50 e 0,76 N contro 4,42 disponibili: margine 5,8×
- **Test della calamita**: profili non magnetici, quindi alluminio a 452 g/m invece dei 1314 dell'acciaio
- **Controllo dello STEP della cremagliera v2**, tre difetti trovati, e **verifica della v3** che li ha chiusi tutti: 59 denti tutti a 2,1562 sulla primitiva, tutti i passi a 4,7124, chevron simmetrico a ogni altezza di fascia fino all'ultima cifra
- **Ricostruita la catena verticale** dal carrello: asse pignone Z 74,150, primitiva Z 59,150, e l'equazione `D = t_binario + 59,150 − t_cremagliera` che lega le due quote di legno allo spessore stampato
- **Analisi delle tolleranze della catena verticale**, che ha ribaltato una raccomandazione data poche ore prima (vedi sotto)
- **Aperta la progettazione dell'asse Y**: quattro sketch discussi (1, 1.1, 1.2, 2), scritta la specifica del profilo da comprare, e calcolate frequenze proprie (145 Hz verticale, 388 orizzontale) e contributi d'errore del carrello

**Bug: l'attrito del carrello scambiato per strisciamento**

**Sintomo:** angolo di distacco 10° e moto costante 15° su un carrello da 290 g, cioè μ apparente 0,18÷0,27 contro lo 0,01÷0,02 che darebbero dei cuscinetti a sfere. Un test con 300 g aggiunti non ha fatto scendere l'angolo, il che indicava attrito **proporzionale al carico**, cioè radente.
**Causa:** nessun meccanismo di strisciamento esisteva davvero. La verifica diretta — far girare a dito tutti e 12 i cuscinetti e cercare contatti del PLA sul binario — li ha trovati tutti liberi e nessun contatto. Il drag è **attrito interno dei cuscinetti**: otto 608ZZ con coppia di spunto 0,3÷1,0 mN·m su raggio 11 danno 0,25÷0,83 N, che copre esattamente i 0,50÷0,76 misurati. Il test con i 300 g era l'unica misura fatta a occhio su una differenza sottile (15° contro ~8°) ed è stato battuto da un'osservazione binaria.
**Fix applicato:** nessuna modifica al pezzo — il carrello va bene com'è. Cambia l'interpretazione: essendo il drag **costante e non proporzionale**, caricando il portale il μ effettivo **scende** (da 0,27 a ~0,082 a 1,1 kg totali) invece di restare. Metodo migliore per una prossima verifica: tirare il carrello in piano con una bilancia da valigia e leggere i grammi, invece di stimare angoli a occhio.

**Bug: due fori passanti distruggevano la dentatura della cremagliera**

**Sintomo:** sullo STEP della v2, scansione sulla primitiva a Y=0: fra il dente a X 6,586 e il successivo a 18,137 c'erano 11,551 mm invece di 4,712, e un secondo salto di 9,425 a X≈256.
**Causa:** due viti di battuta erano state messe al centro della cremagliera, con fori Ø8 passanti **dall'alto**, che salivano fino a Z 3,375 tagliando i denti fino in testa. Il danno era un intaglio a V centrato sull'apice: a |Y|≥4,5 i denti erano interi, a Y=0 ne mancavano due. Restavano anche due schegge di dente spesse 0,030 mm, sotto la larghezza dell'ugello.
**Fix applicato:** fori rimossi in v3, verificato sullo STEP. Verificato anche che le sole 11 asole laterali bastano: la forza di separazione dell'ingranamento (1,60 N) spinge la cremagliera **verso il legno**, mai in su, e il rollio residuo attorno alla fila di viti vale 0,008 mm, il 4% del gioco.

**Decisioni prese:**

- Contesto: la massa mobile sembrava il vincolo che teneva la macchina piccola. Una volta stabilito che il drag è costante, il tetto è salito da 1283 a 3410 g contro ~1150 stimati, e fra il formato più piccolo e il più grande ballavano 84 g.
  Decisione: **formato A4 in orizzontale**, corsa X ~230 con la cremagliera da 59 denti, corsa Y ~317.
  Alternative scartate: A4 verticale e formato quadro 300×300 — richiedono 317÷320 mm di corsa X, quindi una cremagliera giuntata; e l'A4 verticale non serve, perché per disegnarlo basta ruotare il file di 90° nel software. A5, che non aveva più nessuna ragione di essere.
  Da rivedere se: il portale finito pesa molto più dei ~1150 g stimati.

- Contesto: allungare la corsa X richiederebbe due segmenti di cremagliera.
  Decisione: **un pezzo solo, 282,743 mm (60 passi esatti)**, che resta giuntabile in futuro senza ridisegnare nulla.
  Alternative scartate: segmentare subito. Il rischio al giunto è asimmetrico — largo di 0,10 è un neo estetico in un punto, **stretto di 0,20 inceppa** — ed è un difetto permanente che si scopre dopo aver forato il listello.
  Da rivedere se: serve un formato oltre l'A4.

- Contesto: la catena delle quote verticali non chiude sui nominali. Sensibilità 0,728 mm di gioco per mm di altezza, budget ±0,275, tolleranze reali ±0,60 col multistrato.
  Decisione: **la cremagliera si stampa dopo aver misurato il legno**, impostando D sulle misure reali; il residuo si registra ai fori Ø4 del motore (±0,5 mm = ±0,364 di gioco) con il metodo della carta da 0,10 mm nel punto più stretto.
  **Supera la raccomandazione data poche ore prima nella stessa sessione** («lascia il file com'è e taglia il legno a 55,3»), che valeva solo finché il legno lo tagliava l'utente. Comprandolo già dimensionato, l'unico pezzo controllabile diventa quello stampato.
  Alternative scartate: **stare stretti e comprimere legno o PLA con le viti**. Il PLA a 15 MPa resta elastico e cede 0,02 mm, inutile; il legno di costa a quella pressione si impronta in modo permanente e continua a scorrere per settimane, di una quantità dello stesso ordine dell'intero budget. E stretto è il lato pericoloso: largo si shimma in dieci minuti, stretto va piallato un listello già forato e montato.
  Da rivedere se: il listello arriva imbarcato oltre 0,27 mm su 284 — allora si passa alle staffe stampate sul binario.

- Contesto: legno massello o multistrato per il riporto della cremagliera.
  Decisione: **multistrato, ricavato di costa da un pannello.**
  Alternative scartate: massello, che trasversalmente alla fibra si muove dell'1,2% su un'escursione stagionale — **0,66 mm su 55**, più del doppio dell'intero budget, con la macchina che si inceppa d'inverno e balla d'estate. Il multistrato nel piano si muove 0,05 mm.

- Contesto: scelta del riempimento della cremagliera fra gyroid, nido d'ape e triangoli.
  Decisione: **gyroid 25%, 4 perimetri, layer 0,16 mm.** Con 4 perimetri i denti sono massicci ovunque, quindi il pattern conta solo per la stabilità dimensionale: il gyroid non ha tratti rettilinei lunghi (nessuna direzione di ritiro privilegiata su 284 mm) e non si incrocia mai con se stesso.
  Alternative scartate: nido d'ape, che ripassa ogni cella più volte per layer sprecando tempo per una resistenza non necessaria; griglia (l'impostazione di partenza), che fa passare l'ugello sopra linee già depositate a ogni intersezione.

- Contesto: dove attaccare la trave dell'asse Y. Il piano iniziale erano le 4 viti superiori del motore, lasciate libere apposta.
  Decisione: **la trave Y si attacca al corpo del carrello.** Rafforza il punto già aperto il 2026-09-26 con una ragione nuova e decisiva: il motore sta a 58÷74 °C e il PLA ha la Tg a 60 — una staffa imbullonata sulla sua faccia sarebbe il pezzo di plastica **più caldo e più caricato della macchina**, in condizioni da manuale di scorrimento viscoso, mentre tutto il resto lavora a temperatura ambiente. Accettata dall'utente.
  Alternative scartate: attacco sulle viti del motore. Oltre al termico: rende i due estremi del portale diversi per costruzione (il motore ce l'ha un lato solo), e cambierebbe da entrambe le parti se si aggiunge il secondo motore.

- Contesto: dove mettere penna, motore e cremagliera sul carrello Y.
  Decisione: **tutti sul piano di simmetria della sezione**, con penna al centro dell'impronta dei cuscinetti e motore sfalsato **lungo la corsa** invece che di fianco. Azzera due errori su tre: l'imbardata non sposta ciò che sta sull'asse, e una forza sul piano di simmetria non genera torsione. Corollario: **la sezione deve avere un piano di simmetria**, quindi T e non L.
  Alternative scartate: penna all'estremità di un carrello a C (sketch 2) — 0,250 mm di imbardata più 0,209 di torsione, contro uno spessore di tratto di 0,3÷0,5.
  Da rivedere se: non si trova una T e nemmeno due angolari accoppiabili.

- Contesto: la cremagliera dell'asse Y su una seconda trave dedicata.
  Decisione: **cremagliera e guida sullo stesso corpo rigido**, con la cremagliera su una staffa stampata della trave che porta i cuscinetti.
  Alternative scartate: seconda trave. Farebbe dipendere la profondità d'ingranamento da quanto due pezzi distinti restano paralleli su 437 mm. Una staffa stampata si flette di 0,002 mm: per tenere una cremagliera non serve una trave.

- Contesto: il tratto di perno stampato fra due cuscinetti superiori coassiali, ~30 mm all'aria.
  Decisione: **due tronchetti contrapposti**, uno per cuscinetto, radicati ciascuno nella propria parete — la stessa soluzione già in uso sull'asse X, che mantiene l'accoppiamento Ø8,1/collare Ø10,1 già validato.
  Alternative scartate: **ingrossare il perno in mezzo** (suggerimento sbagliato, corretto dall'utente: il cuscinetto interno si infila dalla punta e non passerebbe oltre un tratto più grosso). Scartato anche il perno d'acciaio, che introdurrebbe un accoppiamento nuovo da mettere a punto per un guadagno che non serve — la resistenza ha già un coefficiente 84×, e il motivo per irrigidire è solo lo scorrimento viscoso.

**File consegnati/modificati:**
- `documento-sessione-cnc-2d.md` — v14 → v15
- Controllati (non modificati da me): `cremagliera_prova_2.step`, `cremagliera_prova_3.step`, `tot_prova_3.step`
- Nessun file di progetto toccato: la sessione è stata di analisi, misura e progettazione

**Impatto su Vision/Pipeline:** Step 5 — l'obiettivo passa da **A5 a A4 in orizzontale**, e la decisione sul formato del 2026-09-21 viene superata (testo precedente conservato). Aggiornato il blocco dei problemi aperti: chiusi il test della calamita, la caratterizzazione dell'attrito e la profondità del vano motore; aperti la misura del legno prima della stampa, il piano B con staffe sul binario, la specifica del profilo Y e il layout del carrello Y.

---

### [2026-09-26 17:48] Carrello validato in stampa, cremagliera verificata, e bilancio di coppia del motore

**Riepilogo:** il carrello a U rovesciata passa tutte le verifiche strutturali sullo STEP e scorre perfettamente in stampa con mezzo set di cuscinetti; la cremagliera modulo 1,5 con gioco 0,2 è disegnata, verificata al centesimo e provata con il pignone a doppia elica; intercettati prima della stampa quattro errori (interasse fori NEMA sbagliato di 2 mm, due perni fuori quota di 5 centesimi, cremagliera asimmetrica rispetto all'apice, dato di coppia del motore sbagliato di 3,3× nell'annuncio); e chiuso il bilancio di coppia, che con un motore pancake da 130 mN·m rende l'angolo di distacco del carrello un passa/non passa sotto i 7°.

**Cosa è stato fatto:**
- **Messa a punto della lettura degli STEP** come strumento di verifica: estrazione dei nomi dei componenti, ingombri, volumi, tutti i cilindri con diametro/asse/direzione, distanze e compenetrazioni fra solidi, sezioni ASCII e sonde puntuali per la continuità del materiale. Su questa base sono state fatte tutte le verifiche sotto
- **Carrello (`tot_prova_3`) verificato e approvato.** Corpo unico, fianchi da 3 mm continui su tutti gli 80 mm fra Z 10,8 e Z 34,2, perno alto annegato con 18 mm di materiale sopra (non a sbalzo come temuto), ponte a Z 52 che lega i fianchi al centro, **0,4 mm di aria dal binario** su tutta la corsa, 12 cuscinetti tangenti senza compenetrazione, 7,95 mm dal legno
- **Prova di stampa del carrello riuscita**: con i cuscinetti di sinistra e quelli centrali, inclinando il binario di ~30° il carrello scorre su tutta la lunghezza e torna indietro senza impuntarsi
- **Cremagliera disegnata, quotata e validata.** Consegnato il disegno con la cella unitaria da 6 punti per il pattern, la tabella nominale/con gioco e il posizionamento rispetto all'asse motore. Verificata sullo STEP dell'utente: passo 4,7124, spessore in testa 1,065, vano al piede 1,191, altezza 3,375 — tutto entro il mezzo centesimo
- **Stampa di prova della cremagliera riuscita e ingranamento con il pignone perfetto**, il che conferma anche che i due V della doppia elica sono concordi
- **Bilancio di coppia chiuso** sui dati reali dell'etichetta del motore (130 mN·m, 1,0 A, ~4,0 Ω, 204 g, pancake da 23 mm): punto di lavoro a 0,6 A con culla alleggerita → 4,42 N alla cremagliera, e target di attrito sotto i 7° di angolo di distacco. Trovato e quantificato il legame **corrente → calore → coppia**: alleggerire la culla del motore vale 0,1 A, cioè il 13% di coppia
- **Verifica del vano motore chiusa**, e il problema aperto segnalato in questa stessa voce risulta inesistente: il motore è un pancake da 23,1 mm, quindi il vano da 23,5 mm va bene. Emersi però 0,4 mm di gioco assiale, che superano i ±0,17 mm di centraggio della doppia elica
- **Montaggio del motore a 2 viti anteriori + 2 posteriori validato coi numeri**: le quattro viti formano un rettangolo di 31 × 40 mm nel piano orizzontale, e i carichi dell'ingranamento si traducono in 1,5 N e 4,1 N per coppia di viti. Confermata anche la scelta di non appendere l'asse Y al motore
- **Trovata un'interferenza geometrica** fra la cremagliera e il fianco del carrello: con il pignone a 1 mm dal fianco, il bordo interno della cremagliera cade 0,8 mm dentro il carrello. Vincolo ricavato: asse pignone a X ≤ −46,8
- **Alimentatore cambiato**: non più il 24 V della striscia LED ma un DVE DSA-36W-12 da **12 V / 3 A / 36 W**. Verificato che tre motori a 0,6 A assorbono 0,85 A (28% della portata) e che la tensione non incide né su coppia né su temperatura, perché l'A4988 regola corrente e non tensione

**Bug: interasse dei fori di fissaggio del motore sbagliato di 2 mm**

**Sintomo:** nessuno ancora — intercettato nel file `tot_prova_2` mentre la stampa di prova era in corso
**Causa:** i fori erano a 33,0 mm di interasse; il NEMA 17 li ha normati a 31,0. Ogni foro fuori di 1 mm, contro i ±0,5 che perdona un foro Ø4 attraversato da una vite M3
**Fix applicato:** corretto a 31,0 in `tot_prova_3`, verificato. Resta uno scarto di 0,62 mm fra il centro del pattern e l'asse del foro Ø37 (0,37 in Y, 0,50 in Z), che però è innocuo perché la cremagliera verrà posizionata a partire dal motore già montato

**Bug: due perni alti fuori quota di 5 centesimi**

**Sintomo:** nessuno — trovato confrontando tutti i cilindri dello STEP fra loro
**Causa:** i due perni della stazione a Y 0 erano Ø8,05 con collare Ø10,05, gli altri sei Ø8,1 / Ø10,1. Uno sketch modificato su una stazione e non sull'altra. Cinque centesimi stanno dentro il campo in cui la tolleranza dei perni era stata tarata, quindi quei due cuscinetti sarebbero venuti più lenti — e sono i perni alti, quelli che portano il peso
**Fix applicato:** uniformati tutti e otto a Ø8,1 — confermato dall'utente

**Bug: dato di coppia contraddittorio nell'annuncio del motore**

**Sintomo:** la descrizione dichiara "coppia elevata (130 mN·m (60 oz.in))", ma i due valori non sono la stessa cosa — 60 oz·in valgono 424 mN·m, cioè 3,3 volte 130
**Causa:** copia-incolla dalla variante da 40 mm, venduta sulla stessa pagina dal medesimo venditore
**Fix applicato:** assunto **130 mN·m**, verificato per coerenza fisica — la coppia scala col volume del rotore, e un 40 mm a 1,7 A dà 40 N·cm, quindi dimezzando il pacco e scendendo a 1,0 A si arriva esattamente a 12÷13 N·cm. Usando il dato sbagliato il bilancio di coppia sarebbe stato sovrastimato di tre volte, con il rischio di scoprirlo solo a macchina montata

**Bug: cremagliera asimmetrica rispetto all'apice del chevron**

**Sintomo:** nessuno in funzionamento, ma margine del pignone ridotto a 0,93 mm su un lato contro 2,66 sull'altro
**Causa:** nel trimmare la larghezza da 17,321 a 15,588 il taglio è stato fatto su un solo lato, lasciando l'apice del V a 8,660 da un bordo e 6,928 dall'altro. Con ±0,17 mm di tolleranza di centraggio, 0,93 è sottile — e soprattutto impedisce di riferire la cremagliera al proprio bordo in fase di montaggio
**Fix applicato:** resa simmetrica — confermato dall'utente

**Decisioni prese:**

- Contesto: la staffa del binario va rialzata di ~5 mm, e con l'asse motore a Z 74,65 la cremagliera cade a 53 mm sopra il piano del legno, servendo un supporto molto alto
- Decisione: **rialzo in legno, e motore lasciato alla quota attuale.** Un listello alto 53 mm avvitato alla base è più rigido di qualunque cosa stampata di quell'altezza, costa due euro e si fa in venti minuti
- Alternative scartate: (a) abbassare il motore infilandolo fra le due stazioni di cuscinetti, che avrebbe portato il supporto a 30 mm ma richiedeva di allargare l'interasse ruote da 60 a 70 mm perché il corpo da 42,3 entrasse nella finestra da 38; (b) motore ad asse verticale con cremagliera a denti laterali, supporto a 15 mm, scartata perché il pignone sarebbe finito in fondo a 24 mm di albero a sbalzo
- Da rivedere se: il listello di legno si muove con l'umidità in modo da alterare l'ingranamento lungo la corsa

- Contesto: serviva decidere se l'alloggiamento del motore fosse un pezzo separato bullonato o integrato nel carrello, e come garantire la regolazione dell'ingranamento in assenza di asole
- Decisione: **alloggiamento integrato nel carrello, e la cremagliera viene posizionata a partire dal motore già montato.** È il motore a dire dove va la cremagliera, non il contrario
- Alternative scartate: alloggiamento bullonato con asole verticali da ±2 mm, che era la raccomandazione iniziale. Diventa superfluo se l'elemento regolabile è la cremagliera
- Conseguenza operativa: la regolazione deve comunque esistere, e si sposta tutta sulla cremagliera — spessori sotto per la profondità di ingranamento, fori Ø5 nel listello per viti M3 per il centraggio laterale della doppia elica, e fori pilota della cremagliera forati **dopo** aver trovato la posizione. Ordine di montaggio: binario → carrello → motore → cremagliera
- Da rivedere se: si rende necessario smontare il motore dopo aver fissato la cremagliera, perché a quel punto non resta margine di recupero

- Contesto: il motore ha quattro fori di fissaggio anche sul coperchio posteriore, e l'utente voleva riservare i fori superiori all'attacco dell'asse Y
- Decisione: **due viti sulla flangia anteriore e due sul coperchio posteriore.** Verificato coi numeri: le quattro viti formano un rettangolo di 31 × 40 mm nel piano orizzontale, e i carichi dell'ingranamento si traducono in 1,5 N e 4,1 N per coppia di viti. Il motore è pienamente vincolato
- Alternative scartate: quattro viti sulla sola flangia anteriore, che avrebbe richiesto di portare la flangia fino a Z 90 occupando lo spazio destinato all'asse Y

- Contesto: il motore è un pancake da 23 mm con 130 mN·m, un terzo di un NEMA 17 da 40, e serviva capire quanto margine di coppia resta
- Decisione: **punto di lavoro a 0,6 A con la culla del motore alleggerita** (4,42 N alla cremagliera, carcassa a 58 °C), e **l'angolo di distacco del carrello diventa un passa/non passa: target sotto i 7°**, non più solo una metrica di qualità
- Alternative tenute in riserva, in ordine: accelerazione a 400 mm/s², pignone z17 (+18% forza *e* risoluzione migliore, stessa cremagliera), secondo motore, motore da 40 mm
- Da rivedere se: l'angolo misurato sul carrello completo supera i 10°

- Contesto: l'utente ha 5 motori e ha proposto di motorizzare anche il lato passivo per raddoppiare la forza sull'asse
- Decisione: **tenuta come riserva, non adottata adesso.** Raddoppia davvero la forza (4,42 → 8,84 N) e porta l'angolo tranquillo da 7° a 17°, al costo di 214 g di massa in più
- Realizzazione preferita se si adotta: **due motori in serie su un solo driver** — zero GPIO in più, zero driver in più, lockstep elettrico perfetto. A 12 V però la caduta resistiva si mangia 6,0 V dei 12 contro i 3,0 di un motore per driver, quindi con un A4988 di scorta conviene la strada dei due driver separati (`motor0`/`motor1` sullo stesso asse in FluidNC). In entrambi i casi i due lati vanno messi in fase meccanicamente al montaggio, facendo scorrere la seconda cremagliera con i motori alimentati
- Avvertenza registrata: **il secondo motore non riduce l'attrito, dà solo la forza per vincerlo.** Se il carrello parte a 20° e si aggiunge il motore, si è nascosto un difetto che continuerà a consumare alluminio e a fare rumore. Misurare prima l'angolo, decidere dopo

**File consegnati/modificati:**
- Disegno quotato della cremagliera m1,5 con gioco 0,2 — pubblicato come artefatto, aggiornato una volta (orientamento di stampa e metodo di fissaggio)
- `documento-sessione-cnc-2d.md` — questa voce, correzioni alle decisioni di Step 5 superate, nuove note di Step 5

**Impatto su Vision/Pipeline:** Step 1 — registrato il cambio di alimentatore (12 V / 3 A), che supera il dato del 2026-09-19. Step 5 — due decisioni progettuali superate (cuscinetti 623ZZ → 608 + MR63; precarico a molla → gioco sul dente più registrazione dell'ingranamento), quindici note nuove di cronologia, e la sezione dei problemi aperti rivista: il vano motore risulta risolto, mentre si aggiungono il parallelismo cremagliera-binario entro 0,17 mm e l'interferenza geometrica fra cremagliera e fianco. Nessun cambio alla Vision.

---

### [2026-09-25 12:17] Materiali acquistati: il progetto si adatta a quello che esiste in ferramenta

**Riepilogo:** scelto il cuscinetto giusto con un calcolo di pressione di contatto (623ZZ, Ø10, foro M3), acquistati i materiali reali, e scoperto che il profilo a U trovato in ferramenta ha esattamente le misure che servono per il canale progettato.

**Cosa è stato fatto:**
- Calcolata la pressione di contatto per nove misure di cuscinetto, da cui la scelta del 623ZZ
- Prodotto un modello 3D navigabile del carrello, con guide semitrasparenti per mostrare le ruote dentro il canale
- Acquistati i materiali: base, viti, angolare forato, profilo a U
- Verificate le corse ottenibili sulla base reale contro quelle necessarie per un A5
- Riviste tre proposte successive di carrello dell'utente, con le correzioni caso per caso

**Decisioni prese:**

- Contesto: i 608 acquistati risultavano troppo grandi (Ø22, metà della larghezza del motore) e gli MR62 disponibili in casa troppo piccoli
- Decisione: **623ZZ, 3 × 10 × 4**. A 3 N di carico preme sull'alluminio con 53 MPa, contro i 150 a cui cede — tre volte di margine. Canale interno 12 mm invece dei 24 richiesti dai 608
- Il motivo che ha pesato di più non è la pressione ma il foro: **3 mm significa M3, la stessa vite di tutto il resto della macchina.** Una sola misura di viteria su tutto il progetto
- Alternative scartate: 624ZZ (Ø13, più margine ma introduce le M4 come seconda misura); restare sugli MR62 (margine risicato e M2 scomode); restare sui 608 (canale da 24 mm, carrello sproporzionato)
- Supera la decisione del 2026-09-24 sui 608

- Contesto: l'utente proponeva un cuscinetto grande montato perpendicolare, in mezzo agli altri, per premere sulla guida
- Decisione: **scartata**
- Motivo: un cuscinetto rotola solo se il suo asse è perpendicolare alla direzione di marcia; con l'asse parallelo alla corsa striscia e si appiattisce in un punto. E un Ø32 in mezzo a quattro Ø22 sporgerebbe di 5 mm, diventando l'unico a toccare e sollevando gli altri
- È stata però recuperata l'intuizione sotto: un cuscinetto centrale su molla è un'alternativa valida all'eccentrico, scartata perché sulla guida serve rigidezza, non cedevolezza

- Contesto: l'utente proponeva superfici di rotolamento in gomma per chiudere il gioco da sole
- Decisione: **scartata sulle guide**
- Motivo: la gomma non elimina il gioco, lo trasforma in cedevolezza. Il carico cambia a ogni accelerazione e inversione, quindi il carrello si sposterebbe in modo variabile lungo tutto il disegno — peggio del gioco, che almeno è costante e compensabile. In più l'attrito di rotolamento si impenna e la gomma prende la forma se la macchina resta ferma
- Dove la cedevolezza serve è già prevista: la molla di precarico del pignone

- Contesto: come fissare i cuscinetti senza annegare nel calcolo degli ingombri di dadi e bulloni
- Decisione: **perni stampati Ø3 per le ruote fisse, viti M3 con tratto liscio per quelle regolabili**, e **asole al posto degli eccentrici**
- Motivo: il perno stampato regge (5,7 MPa contro i 50 del PLA) ma non si regola; l'asola dà tre millimetri di corsa dove un eccentrico ne dà uno. Una vite M8 con dado richiederebbe 30 mm di spazio contro i 7 del cuscinetto
- Supera l'indicazione sull'eccentrico data il 2026-09-24

- Contesto: l'utente proponeva di accorciare il carrello avvicinando le ruote, per guadagnare foglio
- Decisione: **non accorciare**, tenere le ruote a 80-100 mm lungo la corsa
- Motivo: con un decimo di gioco e la penna 60 mm sotto il piano delle ruote, 80 mm di interasse danno 0,075 mm di errore sulla punta e 40 mm ne danno 0,15 — al limite del visibile. E la corsa guadagnata non serve: sulla base reale ne avanzano già 65 mm
- Da rivedere se: la struttura definitiva riducesse la corsa disponibile sotto i 260 mm in Y

**File consegnati/modificati:**
- Pagina pubblicata: modello 3D navigabile del carrello — https://claude.ai/artifact/CTT88x6q9LKyBt84rNhPLA
- Pagina aggiornata: disposizione dei cuscinetti, con la tavola sulla disposizione in larghezza — https://claude.ai/artifact/KyA5zQpxbfWVwYeRFV9S6S

**Impatto su Vision/Pipeline:** Step 5 aggiornato nelle decisioni su cuscinetti, fissaggio, regolazione e base. Aggiunta la decisione del profilo unico a U, che rende superflua sull'asse X la regola della guida maestra (mantenuta per l'asse Y, dove le guide restano due pezzi distinti). Sostituita l'indicazione della base in MDF con il compensato effettivamente acquistato. Aggiunto il principio che lunghezza e larghezza del carrello hanno costi diversi.

---

### [2026-09-24 18:44] Dall'SVG al G-code nell'interfaccia, e progetto meccanico con modulo 1,5

**Riepilogo:** costruita da zero l'interfaccia web che porta un SVG fino al G-code ottimizzato con stima del tempo, e impostato il progetto meccanico — modulo 1,5 stampato, primo pignone provato, carrello su cuscinetti radiali 608 al posto dei cuscinetti lineari previsti.

**Cosa è stato fatto:**
- Servo validato al banco: cablaggio ripassato, prova partendo dal centro della corsa verso gli estremi, nessun ronzio di fondo corsa. Prodotto il G-code di prova con i movimenti della penna (Z-3 alzata, Z-7 abbassata, valori provvisori al centro della corsa)
- Costruita l'interfaccia web in `webui/`: impalcatura, piano macchina fisso con reticolo, foglio trascinabile, importazione SVG, ottimizzazione del percorso, generazione del G-code, stima del tempo
- Consegnate tre pagine pubblicate: anteprima dell'interfaccia, disegno quotato della cremagliera, disposizione dei cuscinetti sul carrello
- Stampato e provato il primo pignone, in versione dritta e a doppia elica
- Definite tutte le quote della cremagliera, i segmenti di stampa e lo schema di fissaggio

**Bug: quota della cremagliera etichettata male**

**Sintomo:** nel primo elenco di quote consegnato, la voce "larghezza del vano al fondo" riportava 3,721 mm.
**Causa:** 3,721 mm è lo spessore del *dente* misurato sulla linea di fondo. Il vano fra due denti è 0,992 mm. Errore di etichetta mio, non di calcolo.
**Fix applicato:** corretto e segnalato all'utente prima che disegnasse lo sketch. Nel disegno quotato definitivo le quote ambigue sono sostituite dalle **coordinate dei sei punti del profilo**, che non si prestano a interpretazioni.

**Bug: orientamento di stampa della cremagliera consigliato male**

**Sintomo:** avevo indicato di stampare la cremagliera coricata su un fianco, per avere il profilo del dente tracciato dall'ugello invece che dalla sovrapposizione degli strati.
**Causa:** il consiglio ignorava la flangia di fissaggio — che in quella posizione resta in aria — e sopravvalutava la debolezza fra gli strati.
**Fix applicato:** rifatto il conto. La forza sul dente è al massimo 9 N, che sulla sezione di base dà 0,08 MPa contro i 20÷30 MPa a cui cede l'adesione fra strati: trecento volte di margine. Consiglio cambiato in **denti in su, flangia sul piatto**, con strati da 0,10 mm perché a 20° di fianco ogni layer arretra di 0,036 mm.

**Decisioni prese:**

- Contesto: il modulo 1 previsto è al limite di quanto una FDM stampa in modo affidabile
- Decisione: **modulo 1,5 con 20 denti**, 33,95 passi/mm, risoluzione 0,029 mm
- Alternative scartate: modulo 1 (denti troppo fragili) e modulo 2 (risoluzione 0,039 mm e dente più alto, che rende l'allineamento col precarico più critico)
- Supera la decisione del 2026-09-21 — la risoluzione non è il fattore limitante, visto che l'errore reale sarà dieci volte maggiore, quindi il margine si spende in robustezza

- Contesto: avevo consigliato di comprare cremagliera e pignone in POM per contenere il gioco
- Decisione: **stampare tutto**, comprese le dentature
- Alternative scartate: acquisto della cremagliera — l'utente ha scelto la stampa, e la prova sul primo pignone ha confermato che le tolleranze reggono
- Da rivedere se: il provino da 25 denti mostrasse un ingranamento inaccettabile

- Contesto: erano stati consigliati cuscinetti lineari LM8UU su barre rettificate, ma l'utente ha acquistato cuscinetti radiali 608
- Decisione: **carrello con 608 che rotolano su guide in alluminio**, 11 per carrello, con una guida maestra e una secondaria libera lateralmente e un eccentrico per il contrasto laterale
- Alternative scartate: cuscinetto grande montato con l'asse parallelo alla corsa — non rotolerebbe, striscerebbe, appiattendosi in un punto; e un Ø32 in mezzo a quattro Ø22 diventerebbe l'unico a toccare, sollevando gli altri
- Supera la decisione del 2026-09-21 sulle guide a barre tonde

- Contesto: il pignone sembrava troppo grande perché i cuscinetti non trovavano spazio
- Decisione: **bande laterali separate** per motore, pignone con cremagliera e cuscinetti
- Alternative scartate: rimpicciolire il pignone — non risolverebbe, perché il vincolo viene dal corpo del motore che resta 42 × 42 comunque

**File consegnati/modificati:**
- `webui/` — nuova: `index.html`, tre fogli di stile, dieci moduli JavaScript, `tools/build.py`, `tools/make-sample.py`, `README.md`
- `gcode/test/quadrato-e-cerchio-penna.gcode` — nuovo, con i movimenti del servo
- `gcode/test/README.md` — aggiornato con le quote provvisorie della penna
- Pagina pubblicata: anteprima dell'interfaccia — https://claude.ai/artifact/Sq9d4MVjUBujRCgK682BXA
- Pagina pubblicata: disegno quotato della cremagliera — https://claude.ai/artifact/5TmiPjPf3sXv4orV8ntco7
- Pagina pubblicata: carrello su cuscinetti 608 — https://claude.ai/artifact/KyA5zQpxbfWVwYeRFV9S6S

**Impatto su Vision/Pipeline:** Step 4 passa da "da fare" a **in corso**, con cinque decisioni progettuali aggiunte e la cronologia dei progressi. Step 5 aggiornato nelle decisioni su guide, pignone e corse: le voci su LM8UU, modulo 1 e corsa Y da 260 mm sono state sostituite, e la sostituzione è motivata qui sopra.

---

### [2026-09-21 11:18] FluidNC installato, configurato e validato: la macchina si muove sotto G-code

**Riepilogo:** FluidNC 4.1.0 installato e messo in rete, configurazione accettata senza modifiche dallo schema 4.x, microstepping 1/16 verificato su entrambi gli assi e primi movimenti coordinati eseguiti — ma solo dopo aver trovato un errore di polarità che avevo introdotto io nella configurazione dell'ENABLE condiviso.

**Cosa è stato fatto:**
- Installazione di FluidNC v4.1.0 dal web installer, variante esp32-wifi, fresh-install con WebUI-2
- Configurazione WiFi in modalità client: hostname `cnc2d`, IP 192.168.1.11, mDNS attivo
- Caricamento e attivazione di `cnc2d-config.yaml`, con verifica riga per riga dell'output del validatore
- Verifica funzionale dei tre LED di stato via `M62`/`M63`
- Realizzazione dei ponticelli di microstepping (MS1/MS2/MS3 a VDD) su entrambi i driver, e verifica a 3,3 V con il multimetro prima di dare corrente
- Esecuzione del quadrato da 40 mm e del cerchio da raggio 20 mm: **Step 3 completato**
- Creati due file di G-code di prova nel repository, con il relativo README

**Bug: i motori non si muovono nonostante gli impulsi siano corretti**

**Sintomo:** FluidNC eseguiva i comandi di movimento in modo apparentemente perfetto — `ok` in risposta, coordinate che avanzavano da 0 a 40.000 alla velocità giusta, stato che passava da `Jog` a `Idle`, nessun errore da nessuna parte — ma i motori restavano completamente immobili e gli alberi molli al tatto. Ripetibile su entrambi gli assi.

**Causa:** nella configurazione avevo scritto `shared_stepper_disable_pin: gpio.27:low`. Il `:low` è sbagliato, e il motivo è controintuitivo: il pin dell'A4988 si chiama ENABLE ed è attivo basso, il che suggerisce appunto `:low`. Ma il campo di FluidNC si chiama *disable*, e ci viene scritto "vero" quando i motori vanno spenti; sull'A4988 si spegne portando il pin ALTO. Visto da FluidNC è quindi un disable **attivo alto**, cioè senza modificatore. Con `:low` la logica si ribalta e FluidNC, volendo tenere i motori sempre energizzati per via di `idle_ms: 255`, teneva il pin alto — cioè li teneva spenti.

**Fix applicato:** rimosso il `:low` dalla configurazione, file ricaricato sull'ESP32 e riavviato. Verificato: i motori ora sono energizzati fin dall'avvio e rispondono ai comandi. La prova diagnostica che ha isolato la causa è stata staccare il filo ENABLE dal lato del driver: l'A4988 ha un pull-down interno su quel pin, quindi scollegato si abilita da solo, e vedere il motore girare in quelle condizioni ha dimostrato che tutto il resto (VMOT, STEP, DIR, taratura del Vref, cablaggio) era a posto e che il guasto era nella polarità in configurazione.

**Bug: due errori di battitura diagnosticati come guasti hardware**

**Sintomo:** in due occasioni distinte, comportamenti che sembravano guasti seri. Primo caso: FluidNC continuava a caricare la configurazione di default ignorando la nostra. Secondo caso: nessun movimento dei motori accompagnato da una disconnessione dell'interfaccia.

**Causa:** nel primo caso il comando inviato era `$Config/Filename=cnc2d-config.yalm` — estensione `.yalm` invece di `.yaml`, con le due lettere centrali invertite. FluidNC cercava un file inesistente e ricadeva sul default, dicendolo chiaramente con `Cannot open configuration file`. Nel secondo caso il comando era `$J=G91 X40 F500v`, con una `v` in fondo: incollando con Ctrl+V, il campo comandi della WebUI in alcuni browser intercetta la scorciatoia a metà e scrive la lettera insieme al testo. Il comando veniva rifiutato con `error:2 Bad GCode number format` e non veniva eseguito nulla.

**Fix applicato:** comandi reinviati corretti. Nessuna modifica al sistema. Registrato nel README dei file di prova, perché la `v` fantasma è un comportamento del browser che si ripresenterà.

**Decisioni prese:**
- Contesto: i file di G-code di prova andavano eseguiti con il servo non ancora tarato
- Decisione: **nessun comando sull'asse Z nei file di prova**. Si muovono solo X e Y
- Alternative scartate: includere un alza/abbassa penna per provare anche il servo. Scartata perché gli estremi `min_pulse_us`/`max_pulse_us` in configurazione sono valori di partenza non verificati, e mandare un SG90 a una posizione arbitraria rischia di portarlo in battuta meccanica, dove assorbe molto e forza gli ingranaggi
- Da rivedere se: dopo la taratura del servo, i file di prova possono essere estesi con i movimenti di penna

**File consegnati/modificati:**
- `firmware/fluidnc/cnc2d-config.yaml` — corretta la polarità di `shared_stepper_disable_pin`, con commento esteso sul perché
- `firmware/fluidnc/README.md` — aggiunta la trappola della polarità dell'ENABLE e la prova diagnostica
- `gcode/test/quadrato-40mm.gcode` — nuovo
- `gcode/test/cerchio-r20.gcode` — nuovo
- `gcode/test/README.md` — nuovo

**Impatto su Vision/Pipeline:** Step 3 passa da "in corso" a **completato**. Aggiunte alle sue note la conferma che lo schema 4.1.0 accetta la configurazione scritta sul 3.x (il dubbio sollevato nella voce delle 09:57 è risolto), la procedura di attivazione effettivamente funzionante e l'esito delle verifiche su LED e microstepping.

---

### [2026-09-21 09:57] Progetto della struttura meccanica e installazione di FluidNC

**Riepilogo:** Progettata la meccanica — portale a cremagliera e pignone stampati in 3D su base di legno, formato A5 — e avviata l'installazione di FluidNC sull'ESP32 con le scelte di versione e interfaccia.

**Cosa è stato fatto:**

- Definita l'architettura meccanica completa e aggiunto lo **Step 5** alla pipeline, che finora non prevedeva nessuno step per la struttura fisica
- Individuato il rischio principale della cremagliera — il gioco fra i denti stampati — e la contromisura: motore su piastrina oscillante con precarico a molla contro la cremagliera
- Chiarito che il vincolo di ritegno del carrello e la libertà di flottare del motore non sono in conflitto, perché agiscono su corpi diversi
- Definito il metodo di taratura in loco di `steps_per_mm` e la misura del gioco
- Avviata l'installazione di FluidNC dal web installer, con le scelte guidate passo per passo

**Decisioni prese:**

- Contesto: come trasmettere il moto ai due assi
- Decisione: **cremagliera e pignone stampati in 3D**, con precarico a molla del pignone
- Alternative scartate: cinghia GT2 con motori fissi, che avrebbe gioco quasi nullo e meno massa mobile, ma richiede componenti acquistati. Resta la via di ripiego, sostituibile senza rifare la struttura
- Da rivedere se: il gioco misurato restasse sopra 0,3 mm anche dopo aver messo a punto il precarico
- Supera l'assunzione implicita del 2026-09-21 09:15, dove `steps_per_mm` era stato ipotizzato a 80 partendo da una trasmissione a cinghia

- Contesto: il formato massimo di lavoro, che fissa le corse e la luce del portale
- Decisione: **A5**, con corse di circa 200 × 260 mm
- Alternative scartate: A4, rimandato — un portale più largo accentua la tendenza del ponte a mettersi di traverso, essendo spinto da un lato solo

- Contesto: quale interfaccia web installare fra WebUI-2, WebUI-3 e FigUI
- Decisione: **WebUI-2**, perché è quella su cui è costruita la documentazione del wiki e nei prossimi giorni servirà leggerla
- Alternative scartate: le altre due, non per demerito ma perché se ne può installare una sola e occupano lo stesso spazio; tenerne una lascia anche memoria libera per la pagina che costruiremo

**File consegnati/modificati:**

- `documento-sessione-cnc-2d.md` — aggiornato alla versione 6, aggiunto lo Step 5

**Impatto su Vision/Pipeline:** Aggiunto **Step 5 — Struttura meccanica**, che copre una parte del progetto finora assente dalla pipeline. Aggiornata la nota sul microstepping dello Step 3, che assumeva una trasmissione a cinghia.

---

### [2026-09-21 09:15] Secondo asse, pen-lift e scelta di FluidNC come firmware definitivo

**Riepilogo:** Completato lo Step 2 con il secondo motore e il controllo del servo, poi presa la decisione architetturale del progetto — FluidNC al posto del firmware custom — e progettata l'interfaccia web che farà da slicer e da pannello di controllo.

**Cosa è stato fatto:**

- Cablato e collaudato l'asse Y (STEP D25, DIR D33, ENABLE condiviso su D27); firmware esteso a due assi con velocità e rampa indipendenti per asse, regolabili da slider
- Aggiunta l'inversione di direzione per asse, salvata in memoria non volatile: serve a rimediare a un asse montato al contrario senza toccare cavi né codice
- Aggiunto il controllo del servo pen-lift su D32 con due posizioni calibrabili, pilotato dal periferico LEDC nativo senza librerie esterne. All'accensione il servo parte rilasciato: uno che va in battuta contro un vincolo meccanico appena riceve corrente assorbe moltissimo
- Scritta la configurazione FluidNC di partenza e riqualificato lo sketch esistente come strumento di collaudo

**Bug: il motore Y gira da solo appena alimentato**

**Sintomo:** al primo collegamento del secondo driver, il motore Y ruotava in continuo verso destra senza nessun comando.
**Causa:** D25 e D33 non erano ancora configurati come uscite nel firmware. Restando ingressi ad alta impedenza raccoglievano il ronzio di rete e il rumore di commutazione, che il driver leggeva come impulsi di STEP.
**Fix applicato:** i pin STEP vengono portati a livello basso come prima istruzione di `setup()`, prima di qualsiasi altra inizializzazione. **Confermato.**

**Decisioni prese:**

- Contesto: per disegnare servono interpretazione del G-code, movimento coordinato dei due assi e pianificazione dell'accelerazione fra segmenti consecutivi — la parte dove si sbaglia in modi difficili da diagnosticare
- Decisione: **FluidNC diventa il firmware definitivo**; lo sketch custom retrocede a banco di collaudo hardware e resta nel repo, perché è lo strumento che ha permesso di trovare un driver con l'ingresso STEP in corto
- Alternative scartate: completare il firmware custom, stimato in settimane di lavoro per riprodurre funzionalità già collaudate su migliaia di macchine
- Nota: il lavoro sul generatore di G-code non dipende da questa scelta, perché produce G-code standard in entrambi i casi
- Da rivedere se: FluidNC si rivelasse troppo rigido per qualche esigenza specifica del pen-lift

- Contesto: come passare da un'immagine al G-code
- Decisione: tutta l'elaborazione nel browser con algoritmi di tracciamento deterministici, partendo dal solo SVG
- Alternative scartate: delegare la vettorializzazione a un modello generativo esterno con prompt da copiare e incollare — un modello linguistico non ricalca un'immagine, inventa percorsi plausibili e non ripetibili; e l'elaborazione a bordo dell'ESP32, fuori portata per la sua RAM

- Contesto: come conoscere l'area di lavoro senza finecorsa di riferimento
- Decisione: **azzeramento manuale** — le dimensioni del foglio si calibrano una volta sola e si salvano, l'origine si ristabilisce a inizio sessione portando il carrello nell'angolo. Due pulsanti nell'angolo in basso a sinistra restano come finecorsa rigidi di emergenza
- Alternative scartate: finecorsa di riferimento su entrambi gli assi, rimandabili in qualsiasi momento perché automatizzerebbero semplicemente la procedura manuale
- Conseguenza: i driver non vanno mai disabilitati, altrimenti un asse spostato a mano farebbe perdere la posizione. Annulla l'idea di un auto-spegnimento dopo inattività, discussa nella stessa sessione

- Contesto: l'alimentazione, dopo aver valutato di alimentare tutto dai 12 V con un regolatore
- Decisione: **si resta sulla batteria 18650** per la logica e il servo, con i motori sui 12 V. Consumo medio ~140 mA a 5 V, che su una cella da 3000 mAh dà una decina di ore — ben oltre le 5-6 richieste
- Alternative scartate: step-down 12 V→5 V per alimentare tutto dalla presa, e regolatore lineare 7805, scartato perché dissiperebbe 5 W con il servo in movimento e andrebbe in protezione termica facendo riavviare l'ESP32

**File consegnati/modificati:**

- `firmware/fluidnc/cnc2d-config.yaml` — creato
- `firmware/fluidnc/README.md` — creato
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` — modificato (due assi, inversione, servo)
- `firmware/cnc2d_dashboard/README.md` — modificato (riqualificato come strumento di collaudo)

**Impatto su Vision/Pipeline:** Step 2 completato. Step 3 riscritto attorno a FluidNC e passato a "in corso". Step 4 riscritto da "software slicer" a "interfaccia web e generazione G-code", con le decisioni di architettura prese in questa sessione.

---

### [2026-09-20 18:18] Motore X funzionante: la causa era l'alimentatore, non il cablaggio

**Riepilogo:** Dopo una lunga diagnosi sistematica si è scoperto che l'alimentatore "24V" riciclato era in realtà un controller per strisce LED RGB con uscite in PWM — causa di tutti i sintomi della sessione e della distruzione di due driver A4988; sostituito con un alimentatore DC 12V/3A e con il terzo modulo, il motore X gira correttamente.

**Cosa è stato fatto:**

- Revisione completa del firmware, con tre difetti reali corretti: il movimento a giro completo bloccava per 3 secondi dentro l'handler HTTP affamando web server e OTA; lo stepping in `loop()` subiva il blocco di `server.handleClient()` producendo cadenze irregolari; DIR veniva riscritto a ogni impulso invece che una volta a inizio movimento
- Aggiunta una tab "Motore" con intervallo dei passi, numero di passi, rampa di accelerazione, abilitazione diretta del driver e forzatura dei singoli pin per la misura col multimetro; ogni movimento registra nel log i passi effettivamente emessi
- Scartata l'ipotesi delle resistenze di shunt sbagliate: lette `R100` sul modulo, quindi il Vref di 0,55 V per 0,69 A/fase era corretto fin dall'inizio
- Diagnosi condotta misurando uno per uno tutti i pin del driver (VDD, MOT, RST, SLP, EN, STEP, DIR) invece di procedere per ipotesi

**Bug: alimentatore di potenza inutilizzabile**

**Sintomo:** VMOT oscillante tra 1 V e 20 V invece che ferma; coppia di tenuta debolissima; passi singoli a volte corretti, rotazione continua mai; comportamento che cambiava toccando i fili.
**Causa:** l'alimentatore riciclato è un controller per strisce LED RGB. Il bianco è il +24V comune, rosso/verde/blu sono uscite di canale pilotate in PWM. Usare il rosso come massa significava alimentare il driver attraverso un interruttore che si apriva e chiudeva continuamente. Confermato misurando sotto carico su tutti e tre i canali.
**Fix applicato:** sostituito con alimentatore switching DC 12V/3A, misurato stabile a 12,2 V. **Confermato.**

**Bug: secondo driver A4988 con ingresso STEP in corto**

**Sintomo:** con l'alimentazione risolta l'albero era finalmente bloccato e il test ENABLE rispondeva, ma nessun comando muoveva il motore e il pin STEP sul driver leggeva sempre 0 V pur avendo continuità verso D4.
**Causa:** ingresso STEP in corto verso massa dentro il chip. Localizzato dividendo il nodo in due metà: lato ESP32 muto, lato driver 0,2 Ω, e sfilando il modulo la breadboard tornava muta. Danno provocato dall'alimentatore RGB.
**Fix applicato:** terzo modulo A4988, collaudato prima dell'installazione. **Confermato.**

**Bug: il motore gira solo con passi singoli (aperto dalla sessione precedente)**

**Sintomo:** vedi voce del 2026-09-20 09:45.
**Causa:** l'alimentatore RGB. L'ipotesi precedente sui pin GPIO16/17 riservati al PSRAM era **sbagliata**.
**Fix applicato:** risolto dalla sostituzione dell'alimentatore. **Confermato** — il motore X ora gira su comando dalla dashboard.

**Decisioni prese:**

- Contesto: l'alimentatore riciclato dalla striscia LED si è rivelato un controller PWM e aveva già distrutto due driver A4988
- Decisione: passare a un alimentatore switching DC **12V/3A**, e rendere obbligatorio un condensatore elettrolitico da 100 µF / 50 V tra VMOT e GND del driver
- Supera la decisione del 2026-09-20 09:45 sull'uso dell'alimentatore 24V riciclato, e corregge il dato allora registrato secondo cui "il filo bianco è il vero 24V+ e il rosso è il GND": il rosso non è una massa, è un'uscita di canale
- Alternative scartate: aprire l'alimentatore per bypassare il controller (pericoloso, è collegato alla rete); impostare il controller su un colore fisso al massimo (il MOSFET di canale non è dimensionato per un carico induttivo e qualsiasi cambio di modalità fermerebbe il motore)
- Da rivedere se: servisse più coppia ad alta velocità, caso in cui si potrebbe passare a 24V con un alimentatore DC vero

- Contesto: due moduli A4988 persi senza accorgersene subito, con ore di diagnosi spese a cercare il guasto altrove
- Decisione: collaudare ogni nuovo modulo prima di alimentarlo, verificando che la continuità tra STEP, DIR, EN e GND sia muta su tutti e tre
- Da rivedere se: si adottasse un driver diverso con pull-down interni sugli ingressi, che renderebbero il test non significativo

**File consegnati/modificati:**

- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` — modificato
- `firmware/cnc2d_dashboard/README.md` — modificato (formula del Vref e dipendenza dalle resistenze di shunt, condensatore di bulk obbligatorio, documentazione della tab Motore)
- `documento-sessione-cnc-2d.md` — aggiornato alla versione 4

**Impatto su Vision/Pipeline:** Step 2 resta "in corso" ma il primo motore è validato; restano il secondo asse e la verifica della velocità di lavoro. Aggiornata la decisione sull'alimentazione di potenza e aggiunto il collaudo di accettazione dei driver.

---

### [2026-09-20 09:45] Dashboard estesa (LED, OTA, log) e avvio debug driver A4988/motore X

**Riepilogo:** Ampliata la dashboard con più LED, aggiornamento firmware via Wi-Fi (OTA) e una tab di log da remoto; avviato lo Step 2 con il cablaggio completo del driver A4988 e del motore X, un primo driver risultato guasto e sostituito, Vref tarato correttamente, ma il motore gira in modo affidabile solo a passi singoli — bug non ancora risolto a fine sessione, in attesa di verifica dopo aver spostato DIR/ENABLE dai pin D16/D17 a D26/D27.

**Cosa è stato fatto:**
- Aggiunti alla dashboard 2 nuovi LED (verde D18, giallo D19) con pulsanti dedicati Rosso/Giallo/Verde; disabilitato il pulsante centrale del joystick (non più usato per il LED)
- Aggiunto supporto ArduinoOTA per aggiornare il firmware via Wi-Fi dopo il primo upload via USB (password uguale a quella dell'AP di emergenza)
- Aggiunta una tab "Log" nella dashboard che mostra via web gli stessi messaggi altrimenti visibili solo sul Serial Monitor — necessaria perché il Serial Monitor via USB non è utilizzabile quando si carica il firmware via OTA
- Collegato fisicamente il driver A4988 al motore X (fase logica: GND/VDD/RESET-SLEEP/STEP/DIR/ENABLE; fase di potenza: VMOT/GND da alimentatore 24V riciclato da striscia LED RGB, identificando con il multimetro che il vero 24V+ è il filo bianco e il GND è il filo rosso, non il contrario)
- Riadattata una scheda "Nano Terminal Adapter" (per Arduino Nano) a morsettiera generica per i collegamenti di potenza, sfruttando la sua natura puramente passiva
- Identificate le due bobine del motore (rosso+blu, nero+verde) via continuità e collegate al driver
- Collegati sulla dashboard i controlli motore: frecce sinistra/destra (passo singolo al click, rotazione continua non bloccante tenendo premuto) e due pulsanti "Giro completo" per un test rapido da 200 passi
- **Bug: primo driver A4988 non muoveva il motore** — Sintomo: nessuna reazione a "Giro completo", solo un leggero ronzio. Causa: sospetto danneggiamento del chip (tutti i controlli di continuità risultati corretti). Fix applicato: sostituito con un secondo modulo di scorta, che ha mostrato un primo movimento (parziale)
- **Bug: Vref bloccato a 0,20V, il trimmer sembrava non avere effetto** — Causa: misura instabile per il motore collegato durante la prova. Fix applicato: misurato a motore scollegato, tarato correttamente a 0,55V
- **Bug: il motore gira solo a passi singoli, non in sequenza continua** — Sintomo: click singoli puliti e senza perdita di passi, ma pressione prolungata o "Giro completo" non muovono il motore (o lo muovono a scatti di ~1/5 di giro senza completare la rotazione). Causa non confermata: un test del "wiggle" ha mostrato che muovere il filo ENABLE (D17) durante il funzionamento fa partire il motore, anche sostituendo il filo o cambiando i fori della breadboard, pur con continuità elettrica corretta a riposo — si sospetta un comportamento specifico dei pin GPIO16/17 su alcune varianti ESP32 con PSRAM (WROVER), non confermato con certezza dalla foto del modulo (etichettato solo "ESP-32"). Fix applicato: spostati DIR (D16→D26) ed ENABLE (D17→D27); esito del test non ancora riportato a fine sessione

**Decisioni prese:**
- Contesto: serviva un modo per vedere i log del firmware una volta passati all'aggiornamento via OTA, dato che il Serial Monitor USB non è più disponibile in quel caso
- Decisione: aggiunta una tab "Log" nella dashboard che replica via HTTP i messaggi altrimenti mandati solo su Serial
- Alternative scartate: nessuna, soluzione diretta senza alternative valutate
- Contesto: servivano morsetti a vite per i collegamenti di potenza (24V e motore) ma non erano disponibili morsetti dedicati
- Decisione: riadattata una scheda "Nano Terminal Adapter" (per Arduino Nano) come morsettiera generica, usando ogni colonna come nodo elettrico indipendente
- Alternative scartate: acquistare morsetti dedicati — scartata per procedere subito con quello che si aveva già disponibile
- Da rivedere se: si rendono disponibili morsetti a vite dedicati, più adatti per un assemblaggio permanente

**File consegnati/modificati:**
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` (modificato: LED aggiuntivi, OTA, log, controlli motore, pin DIR/ENABLE spostati)
- `firmware/cnc2d_dashboard/README.md` (aggiornato di pari passo)

**Impatto su Vision/Pipeline:** Step 2 passato da "da fare" a "in corso"; aggiunte le decisioni progettuali su pin driver, mappatura bobine, alimentatore riciclato e uso della morsettiera adattata. Bug del motore non ancora risolto: da riprendere nella prossima sessione verificando l'esito dello spostamento pin DIR/ENABLE.

---

### [2026-09-19 09:25] Dashboard web ESP32 con controllo LED e configurazione Wi-Fi

**Riepilogo:** Creata e validata una dashboard web autonoma sull'ESP32 (frecce direzionali placeholder, pulsante centrale per il LED, tab Wi-Fi e tab Codice) con provisioning Wi-Fi da browser e fallback ad Access Point di emergenza; testata con successo sia via USB sia a batteria.

**Cosa è stato fatto:**
- Analizzata la fattibilità di una dashboard web ospitata direttamente sull'ESP32 e di un "tab codice" stile Arduino IDE nel browser; chiarito che l'ESP32 non può compilare sketch C++ da solo, quindi il tab Codice sarà usato in futuro per l'upload diretto di file G-code (non di sorgenti da compilare), da attivare dopo aver validato motori/servo (Step 2-3)
- Implementato lo sketch `firmware/cnc2d_dashboard/cnc2d_dashboard.ino`: web server nativo (`WebServer.h`) con pagina unica a 3 tab (Controllo, Wi-Fi, Codice), pulsante centrale che accende/spegne il LED su D2, frecce direzionali presenti ma non collegate
- Aggiunta gestione Wi-Fi via web: credenziali salvate in NVS (`Preferences`), form nella tab Wi-Fi per cambiarle senza ricompilare, fallback automatico ad Access Point `CNC-2D-Setup` se la connessione alla rete salvata fallisce, mDNS (`cnc2d.local`) per raggiungere la dashboard senza dipendere dall'IP assegnato dal router
- **Bug: errore di compilazione "unterminated raw string"**
  **Sintomo:** Arduino IDE segnalava stringa raw non terminata durante la compilazione dello sketch
  **Causa:** l'utente aveva copiato il codice a mano in un nuovo sketch anziché aprire il file `.ino` originale, con probabile perdita dell'ultima riga di chiusura della stringa raw durante il copia-incolla
  **Fix applicato:** scaricato il file raw direttamente da GitHub e incollato per intero — verificato e compilazione riuscita
- Testata l'intera dashboard: provisioning Wi-Fi di casa dalla tab dedicata, raggiungibilità su `http://cnc2d.local`, controllo LED su D2 funzionante sia con ESP32 alimentato da USB sia da batteria 18650+interruttore

**File consegnati/modificati:**
- `firmware/cnc2d_dashboard/cnc2d_dashboard.ino` (nuovo)
- `firmware/cnc2d_dashboard/README.md` (nuovo)

**Impatto su Vision/Pipeline:** Aggiunto il nuovo sotto-step "Step 1.1 — Dashboard web di controllo e test" (completato) all'interno dello Step 1, non previsto esplicitamente nella pipeline originale ma propedeutico al controllo assi (Step 2) e al futuro upload G-code (Step 4).

---

### [2026-09-19 10:03] Bring-up hardware ESP32: alimentazione USB e batteria completati

**Riepilogo:** Verificata la compatibilità dei componenti scelti (batteria, motori, driver, alimentatore), completato il bring-up dell'ESP32 con test LED su D2 sia via USB che via batteria 18650+interruttore; prossimo passo il codice per driver A4988/motori.

**Cosa è stato fatto:**
- Analizzata e corretta la conversazione tecnica avuta con Gemini sulla compatibilità batteria NASTIMA / motori NEMA17 17HS4023 / driver A4988 / alimentatore 24V riciclato da striscia LED (corretta imprecisione sulla corrente nominale motore: 0.7A/fase, non 1.0A; segnalata mancanza di un regolatore dedicato per la logica ESP32; chiarito l'uso del PWM spindle/laser per il pen-lift invece di un asse Z vero)
- Verificato il modulo di carica/boost per 18650 (Type-C, boost 5V, supporto "discharge while charging")
- Pianificata la sequenza di bring-up: GND comune → ESP32 standalone → driver a vuoto → un motore → due motori → config FluidNC
- Montato l'ESP32 su breadboard e identificate le etichette reali sulla scheda fisica (prefisso D, es. D2, VIN, GND — diverse dal pinout generico GPIO/ADC del listing Amazon)
- Test funzionale con sketch Blink su D2 + LED + resistenza 220 ohm via Arduino IDE — riuscito
- Aggiunto interruttore sulla linea 5V+ (tra modulo batteria 18650 e VIN dell'ESP32, non sulla batteria) e verificato il funzionamento su alimentazione a batteria
- Preparato uno sketch base con ArduinoOTA per l'upload firmware via Wi-Fi (il primo upload resta comunque necessario via USB)

**Decisioni prese:**
- Contesto: bisognava scegliere come alimentare la logica ESP32 separatamente dai 24V dei motori
- Decisione: batteria 18650 con modulo boost/carica 5V Type-C, interruttore solo sulla linea 5V+ (non sulla batteria), per permettere la ricarica anche a macchina spenta
- Alternative scartate: alimentare l'ESP32 direttamente dai 24V tramite un regolatore dedicato — scartata per ora in favore della soluzione a batteria separata, più semplice da testare in questa fase
- Da rivedere se: emergono problemi di autonomia o di stabilità della tensione 5V sotto carico Wi-Fi

**File consegnati/modificati:** nessun file di codice consegnato in questa sessione (solo sketch inline in chat: Blink su D2, sketch base ArduinoOTA)

**Impatto su Vision/Pipeline:** Prima creazione del documento — Vision e Pipeline stabilite sulla base delle decisioni già prese nelle sessioni precedenti (non tracciate qui perché antecedenti alla creazione di questo documento).

---
