# GDC CNC 2D SLICER — firmware FluidNC

FluidNC è il firmware definitivo della macchina. Sostituisce interamente lo sketch in
`firmware/cnc2d_dashboard/`, che da qui in poi resta solo come strumento di collaudo
hardware (vedi il suo README).

Porta già risolto tutto quello che mancava al firmware di collaudo: interpretazione del
G-code, movimento coordinato di X e Y, pianificazione dell'accelerazione fra segmenti
consecutivi, gestione della coda dei comandi, allarmi sui finecorsa.

## Prima di installare: il microstepping

Lo sketch di collaudo pilotava i motori a passo intero, con MS1/MS2/MS3 scollegati.
Per disegnare serve una risoluzione più fine: con cinghia GT2 e puleggia a 20 denti,
a passo intero si ottengono 5 passi/mm, cioè uno scalino ogni 0,2 mm — visibile a occhio
sul tratto.

**Collega MS1, MS2 e MS3 di entrambi i driver a VDD** (i 3,3 V, lo stesso nodo del
ponticello RESET+SLEEP). Tutti e tre alti significa microstep 1/16, quindi 80 passi/mm.

| MS1 | MS2 | MS3 | Risoluzione |
|-----|-----|-----|-------------|
| basso | basso | basso | passo intero |
| alto | alto | alto | **1/16** |

Il valore `steps_per_mm` della configurazione assume 1/16: se scegli un microstep diverso,
va ricalcolato.

## Installazione

FluidNC si installa dal browser, senza Arduino IDE: apri il web installer ufficiale,
collega l'ESP32 via USB e segui la procedura. Il primo caricamento richiede il cavo,
come sempre.

Dopo l'installazione l'ESP32 espone un proprio access point per la configurazione Wi-Fi,
poi diventa raggiungibile sulla rete di casa con la sua interfaccia web.

## La configurazione

`cnc2d-config.yaml` va caricato nella memoria dell'ESP32 dalla pagina dei file di FluidNC,
e attivato con `$Config/Filename=cnc2d-config.yaml`.

FluidNC valida il file all'avvio e stampa gli errori sulla console: se un nome di campo è
sbagliato o un pin è in conflitto te lo dice, quindi si procede per correzioni successive
invece che a tentativi.

### Mappa dei pin

| Segnale | GPIO |
|---|---|
| STEP X / DIR X | 4 / 26 |
| STEP Y / DIR Y | 25 / 33 |
| ENABLE (condiviso) | 27 |
| Servo pen-lift | 32 |
| Pulsante emergenza X | 13 |
| Pulsante emergenza Y | 14 |
| LED verde / giallo / rosso | 18 / 19 / 2 |

### Valori da tarare

Tre gruppi, tutti marcati `DA TARARE` nel file:

- **`steps_per_mm`**: dipende da cinghia e puleggia. Si verifica facendo percorrere 100 mm
  alla macchina e misurando quanto si è mossa davvero.
- **`max_travel_mm`**: la corsa utile delle guide, da misurare quando la struttura esiste.
- **`min_pulse_us` / `max_pulse_us`** del servo: si tarano guardando la penna, partendo
  vicino al centro e allargando a piccoli passi.

## Scelte progettuali

**Niente azzeramento automatico.** La macchina non ha finecorsa di riferimento: l'origine
si imposta a mano portando il carrello nell'angolo in basso a sinistra e dando `G92 X0 Y0`.
Le dimensioni del foglio sono note all'interfaccia, quindi è quest'ultima a rifiutare i
disegni che non ci starebbero.

Conseguenza: `soft_limits` resta disattivo, perché FluidNC lo consente solo su una macchina
azzerata. La protezione contro le uscite dall'area è quindi a carico dell'interfaccia, non
del firmware.

**I driver non si disabilitano mai** (`idle_ms: 255`). Con l'azzeramento manuale, un asse
che si ammorbidisce e viene spostato a mano farebbe perdere la posizione senza che nessuno
se ne accorga. I motori restano in coppia per tutto il tempo che la macchina è accesa.

**I due pulsanti nell'angolo sono finecorsa rigidi**, non riferimenti di azzeramento. In
teoria non vengono premuti mai; se succede, FluidNC ferma tutto e va in allarme, da
sbloccare con `$X` e da far seguire da una ricalibrazione dell'origine.

Sono cablati normalmente aperti verso massa: se un filo si stacca perdi la protezione senza
accorgertene. Accettabile per un backstop su questa macchina, da rivedere quando saranno
microswitch veri.

**L'ENABLE condiviso va scritto senza `:low`.** È la trappola che ci è costata
un'oretta di diagnosi. Il pin dell'A4988 si chiama ENABLE ed è attivo basso, quindi
`gpio.27:low` sembra la scrittura giusta — ma il campo di FluidNC si chiama *disable*,
e sull'A4988 si disabilita portando il pin alto. Quindi è un disable attivo alto, cioè
senza modificatore. Con `:low` la logica si ribalta e i motori restano spenti proprio
quando dovrebbero girare.

Il sintomo è insidioso perché tutto il resto sembra funzionare: FluidNC genera gli
impulsi, le coordinate avanzano normalmente sull'interfaccia, lo stato passa da `Jog`
a `Idle` — ma i motori non si muovono e gli alberi restano molli. La prova decisiva è
staccare il filo ENABLE dal lato del driver: l'A4988 ha un pull-down interno su quel
pin, quindi scollegato si abilita da solo. Se così il motore gira, il problema è la
polarità in configurazione e non il cablaggio.

**Lo Z è il servo**, non un asse meccanico. Il G-code alza e abbassa la penna con un
movimento su Z, che è più pulito del pilotaggio via M3/M5 previsto inizialmente e permette
al generatore di G-code di trattare il pen-lift come un movimento qualsiasi.

**Le quote sono negative.** Senza finecorsa FluidNC mette lo zero macchina in cima alla
corsa e dichiara il resto in negativo (`Axis Z (-21.281, 0.010)`), e `RcServo` mappa la
posizione **macchina** con `mapConstrain()`, che tronca invece di rifiutare. Quindi
`G0 Z0` è la **posizione tappo**, `G0 Z-18.326` la penna alzata e `G0 Z-21.271` la punta
sul foglio; una quota positiva viene troncata su Z0 senza dire niente. I numeri veri li
genera il profilo del SLICER — vedi `misure/accensione-e-taratura.md`, sezione A3.

## L'interfaccia: `index.html.gz`

In questa cartella c'è anche `index.html.gz`, cioè il GDC CNC 2D SLICER compresso e
pronto da installare. Si genera con `python3 webui/tools/build.py` seguito da
`gzip -9`, e va rigenerato ogni volta che si tocca qualcosa in `webui/`.

**Perché proprio quel nome, e perché sostituisce la WebUI di FluidNC.** FluidNC serve
`index.html.gz` sulla radice, e quello è l'unico percorso che il browser APRE: il
gestore generico (`handle_not_found`) manda qualunque altro file con
`Content-Disposition: attachment`, quindi una pagina messa lì accanto con un nome suo
verrebbe scaricata invece che aperta. Non c'è una configurazione in cui le due
interfacce convivono: o c'è la loro, o c'è la nostra.

**Prima di sostituirla, salvarla.** La rotta WebDAV funziona anche senza nessuna
interfaccia grafica, quindi si può sempre tornare indietro:

    curl http://INDIRIZZO/flash/index.html.gz -o fluidnc-webui.html.gz   # copia di sicurezza
    curl -X DELETE http://INDIRIZZO/flash/index.html.gz                  # via la vecchia
    curl -T index.html.gz http://INDIRIZZO/flash/index.html.gz           # dentro la nuova

E per tornare alla WebUI di FluidNC basta rimettere la copia:

    curl -T fluidnc-webui.html.gz http://INDIRIZZO/flash/index.html.gz

**Lo spazio.** La partizione è 192 kB. La WebUI di FluidNC ne occupa 111.625 byte, la
nostra 65.183: finché c'è la loro non c'entra anche la nostra, quindi la vecchia va
cancellata PRIMA di caricare. Tolta quella, restano ~113 kB liberi invece di 64, cioè
spazio vero anche per i programmi.

**Se la nostra pagina non funziona non si resta a piedi.** La macchina si comanda dalla
seriale USB e da telnet sulla porta 23, e la rotta WebDAV qui sopra non dipende da
nessuna pagina.
